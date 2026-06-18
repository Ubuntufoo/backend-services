import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

function printUsage() {
  console.error(
    [
      'Usage: node ./scripts/run-codex-verification.mjs <run.json path> [--dry-run]',
      '',
      'Executes verification_commands from a Codex run manifest.',
      'Normalizes legacy Vitest `--runInBand` to `--no-file-parallelism`.',
    ].join('\n'),
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

function normalizeVerificationCommand(command) {
  const normalized = command.replace(/\s--runInBand\b/g, ' --no-file-parallelism');
  const notes = normalized === command ? [] : ['normalized Vitest flag: --runInBand -> --no-file-parallelism'];

  return {
    command,
    normalized,
    notes,
  };
}

function runCommand(command) {
  const result = spawnSync(command, {
    cwd: repoRoot,
    shell: true,
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

function main() {
  const { dryRun, runJsonPath } = parseArgs(process.argv);
  const manifest = loadRunManifest(runJsonPath);
  const commands = manifest.verification_commands.map(normalizeVerificationCommand);

  if (commands.length === 0) {
    console.log('No verification commands.');
    return;
  }

  for (const { command, normalized, notes } of commands) {
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

main();
