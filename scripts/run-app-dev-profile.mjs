import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

export const STARTUP_PROFILES = Object.freeze({
  'app:dev': Object.freeze({
    SIDECAR_JOB_RUNNER_ENABLED: 'true',
    SOLDCOMPS_ENABLED: 'true',
  }),
  'app:dev:no-pricing': Object.freeze({
    SIDECAR_JOB_RUNNER_ENABLED: 'true',
    SOLDCOMPS_ENABLED: 'false',
  }),
  'dev:safe': Object.freeze({
    SIDECAR_JOB_RUNNER_ENABLED: 'false',
    SOLDCOMPS_ENABLED: 'false',
  }),
});

export function resolveStartupProfile(profileName) {
  const profile = STARTUP_PROFILES[profileName];
  if (!profile) {
    throw new Error(
      `Unknown startup profile "${profileName}". Expected one of: ${Object.keys(STARTUP_PROFILES).join(', ')}.`
    );
  }

  return profile;
}

export function buildStartupProfileEnv(profileName, baseEnv = process.env) {
  return {
    ...baseEnv,
    ...resolveStartupProfile(profileName),
  };
}

export function printStartupProfile(profileName, writeLine = console.log) {
  const profile = resolveStartupProfile(profileName);
  writeLine(`Startup profile: ${profileName}`);
  writeLine(`SIDECAR_JOB_RUNNER_ENABLED=${profile.SIDECAR_JOB_RUNNER_ENABLED}`);
  writeLine(`SOLDCOMPS_ENABLED=${profile.SOLDCOMPS_ENABLED}`);
}

export function runStartupProfile(profileName, dependencies = {}) {
  const spawn = dependencies.spawn ?? spawnSync;
  const writeLine = dependencies.writeLine ?? console.log;
  const dryRun = dependencies.dryRun ?? false;
  const env = buildStartupProfileEnv(profileName, dependencies.env);

  printStartupProfile(profileName, writeLine);
  if (dryRun) {
    writeLine('Dry run: sidecar server not started.');
    return 0;
  }

  const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  const result = spawn(pnpmCommand, ['--filter', 'sidecar', 'dev'], {
    cwd: repoRoot,
    env,
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

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const positional = args.filter((arg) => arg !== '--dry-run');

  if (positional.length !== 1) {
    console.error(
      `Usage: node ./scripts/run-app-dev-profile.mjs <${Object.keys(STARTUP_PROFILES).join('|')}> [--dry-run]`
    );
    process.exitCode = 1;
    return;
  }

  process.exitCode = runStartupProfile(positional[0], { dryRun });
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
const modulePath = resolve(fileURLToPath(import.meta.url));

if (entryPath && entryPath === modulePath) {
  main();
}
