import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

export const SAFE_VERIFICATION_ENV = Object.freeze({
  SIDECAR_JOB_RUNNER_ENABLED: 'false',
  SOLDCOMPS_ENABLED: 'false',
});

const ALLOWED_PNPM_SCRIPTS = new Set(['check', 'lint', 'typecheck']);
const ALLOWED_PNPM_EXECUTABLES = new Set(['eslint', 'vitest']);
const BLOCKED_EXECUTABLES = new Set([
  'bun',
  'env',
  'npm',
  'sh',
  'bash',
  'cmd',
  'dash',
  'fish',
  'powershell',
  'pwsh',
  'yarn',
  'zsh',
]);
const SHELL_SYNTAX_PATTERN = /[\n\r;&|<>`'"\\]|\$\(|\$\{/;

function printUsage() {
  console.error(
    [
      'Usage: node ./scripts/run-codex-verification.mjs <run.json path> [--dry-run]',
      '',
      'Executes verification_commands from a Codex run manifest.',
      'Normalizes legacy Vitest `--runInBand` to `--no-file-parallelism`.',
      'Rejects live pricing and sidecar startup commands.',
    ].join('\n')
  );
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const positional = args.filter((arg) => arg !== '--dry-run');

  if (positional.length !== 1) {
    printUsage();
    process.exit(1);
  }

  return {
    dryRun,
    runJsonPath: resolve(process.cwd(), positional[0]),
  };
}

function loadRunManifest(runJsonPath) {
  const manifest = JSON.parse(readFileSync(runJsonPath, 'utf8'));
  if (!Array.isArray(manifest.verification_commands)) {
    throw new Error(`Missing verification_commands array in ${runJsonPath}`);
  }

  return manifest;
}

export function normalizeVerificationCommand(command) {
  const normalized = command.replace(/\s--runInBand\b/g, ' --no-file-parallelism');
  const notes =
    normalized === command ? [] : ['normalized Vitest flag: --runInBand -> --no-file-parallelism'];

  return {
    command,
    normalized,
    notes,
  };
}

export function getBlockedVerificationReason(command) {
  if (typeof command !== 'string' || command.trim().length === 0) {
    return 'verification command must be a non-empty string';
  }

  if (SHELL_SYNTAX_PATTERN.test(command)) {
    return 'shell syntax, quoting, escaping, and command substitution are forbidden';
  }

  const tokens = command.trim().split(/\s+/);
  if (tokens.some((token) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(token))) {
    return 'inline environment assignments are forbidden';
  }

  const executable = tokens[0];
  if (!executable || executable.startsWith('/') || executable.includes('/')) {
    return 'executable paths are forbidden';
  }

  if (BLOCKED_EXECUTABLES.has(executable.toLowerCase())) {
    return `executable "${executable}" is forbidden`;
  }

  const args = tokens.slice(1);
  switch (executable) {
    case 'pnpm':
      return getBlockedPnpmReason(args);
    case 'node':
      return getBlockedNodeReason(args);
    case 'git':
      return args.length === 2 && args[0] === 'diff' && args[1] === '--check'
        ? null
        : 'only git diff --check is allowed';
    default:
      return `executable "${executable}" is not allowed`;
  }
}

export function assertSafeVerificationCommand(command) {
  const reason = getBlockedVerificationReason(command);
  if (reason) {
    throw new Error(`Blocked verification command: ${reason}: ${command}`);
  }
}

export function parseVerificationCommand(command) {
  assertSafeVerificationCommand(command);
  const [executable, ...args] = command.trim().split(/\s+/);
  return { args, executable };
}

export function buildSafeVerificationEnv(baseEnv = process.env) {
  return {
    ...baseEnv,
    ...SAFE_VERIFICATION_ENV,
  };
}

export function runCommand(command, dependencies = {}) {
  const spawn = dependencies.spawn ?? spawnSync;
  const { executable, args } = parseVerificationCommand(command);
  const result = spawn(executable, args, {
    cwd: repoRoot,
    env: buildSafeVerificationEnv(dependencies.env),
    shell: false,
    stdio: 'inherit',
  });

  if (typeof result.status === 'number') {
    return result.status;
  }

  if (result.error) {
    throw result.error;
  }

  return 1;
}

function getBlockedPnpmReason(args) {
  let commandIndex = 0;

  if (args[0] === '--filter' || args[0] === '-F') {
    if (!args[1] || args[1].startsWith('-')) {
      return 'pnpm filter requires a package name';
    }
    commandIndex = 2;
  }

  const command = args[commandIndex];
  if (ALLOWED_PNPM_SCRIPTS.has(command) && args.length === commandIndex + 1) {
    return null;
  }

  if (command !== 'exec') {
    return 'only check, lint, typecheck, and approved pnpm exec tools are allowed';
  }

  const tool = args[commandIndex + 1];
  if (!tool || tool.startsWith('/') || tool.includes('/') || !ALLOWED_PNPM_EXECUTABLES.has(tool)) {
    return 'pnpm exec target is not allowed';
  }

  if (tool === 'vitest' && args[commandIndex + 2] !== 'run') {
    return 'Vitest must use the non-watch run command';
  }

  const toolArgs = args.slice(commandIndex + (tool === 'vitest' ? 3 : 2));
  if (toolArgs.length === 0) {
    return 'approved pnpm exec tools require focused file arguments';
  }

  if (
    toolArgs.some(
      (arg) =>
        !(tool === 'vitest' && arg === '--no-file-parallelism') && !isSafeRepoSourceFile(arg)
    )
  ) {
    return 'pnpm exec arguments must be safe repository source files';
  }

  return null;
}

function getBlockedNodeReason(args) {
  if (
    args[0] !== '--test' ||
    args.length < 2 ||
    args.slice(1).some((arg) => !isSafeRepoSourceFile(arg))
  ) {
    return 'Node verification is limited to node --test files';
  }

  if (args.some((arg) => ['-e', '--eval', '-p', '--print'].includes(arg))) {
    return 'Node eval and print modes are forbidden';
  }

  return null;
}

function isSafeRepoSourceFile(value) {
  return (
    !value.startsWith('/') &&
    !value.split('/').includes('..') &&
    /^[A-Za-z0-9@._/+:-]+\.(?:[cm]?[jt]sx?)$/.test(value)
  );
}

function main() {
  const { dryRun, runJsonPath } = parseArgs(process.argv);
  const manifest = loadRunManifest(runJsonPath);
  const commands = manifest.verification_commands.map(normalizeVerificationCommand);

  if (commands.length === 0) {
    console.log('No verification commands.');
    return;
  }

  for (const { command, normalized, notes } of commands) {
    assertSafeVerificationCommand(normalized);
    console.log(`> ${normalized}`);
    for (const note of notes) {
      console.log(`! ${note}`);
    }

    if (dryRun) {
      if (normalized !== command) {
        console.log(`= original: ${command}`);
      }
      continue;
    }

    const exitCode = runCommand(normalized);
    if (exitCode !== 0) {
      process.exit(exitCode);
    }
  }
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
const modulePath = resolve(fileURLToPath(import.meta.url));

if (entryPath && entryPath === modulePath) {
  main();
}
