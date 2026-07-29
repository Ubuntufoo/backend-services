import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  assertSafeVerificationCommand,
  buildSafeVerificationEnv,
  parseVerificationCommand,
  runCommand,
} from './run-codex-verification.mjs';

describe('Codex verification safety', () => {
  it('allows focused typecheck and mocked unit-test commands', () => {
    assert.doesNotThrow(() => assertSafeVerificationCommand('pnpm --filter sidecar typecheck'));
    assert.doesNotThrow(() =>
      assertSafeVerificationCommand(
        'pnpm --filter sidecar exec vitest run tests/unit/server-http.test.ts'
      )
    );
    assert.doesNotThrow(() =>
      assertSafeVerificationCommand(
        'pnpm --filter sidecar exec eslint src/scripts/smoke-soldcomps-pricing.ts tests/unit/scripts/price-one-listing.test.ts'
      )
    );
    assert.doesNotThrow(() =>
      assertSafeVerificationCommand(
        'pnpm --filter sidecar exec vitest run tests/unit/server-http.test.ts tests/unit/scripts/smoke-soldcomps-pricing.test.ts'
      )
    );
    assert.doesNotThrow(() =>
      assertSafeVerificationCommand('node --test scripts/run-codex-verification.test.mjs')
    );
    assert.doesNotThrow(() => assertSafeVerificationCommand('git diff --check'));
  });

  it('rejects live pricing, confirmation, and queue-processing startup commands', () => {
    const blockedCommands = [
      'pnpm pricing:smoke-soldcomps -- --confirm-live-soldcomps',
      'pnpm --filter sidecar pricing:price-one -- Single-000011',
      'pnpm pricing:smoke-apify',
      'tsx services/sidecar/src/scripts/smoke-soldcomps-pricing.ts',
      'pnpm dev',
      'pnpm --filter sidecar dev',
      'pnpm --filter sidecar dev:stdio',
      'pnpm app:dev:no-pricing',
      'pnpm dev:safe',
      'node scripts/run-app-dev-profile.mjs app:dev',
      'node services/sidecar/build/index.js',
      'tsx services/sidecar/src/server-http.ts',
      'SOLDCOMPS_ENABLED=true pnpm --filter sidecar typecheck',
      'pnpm --filter sidecar typecheck; SOLDCOMPS_ENABLED=true pnpm app:dev',
      'env SOLDCOMPS_ENABLED=true pnpm --filter sidecar typecheck',
      '/usr/bin/env SOLDCOMPS_ENABLED=true pnpm --filter sidecar typecheck',
      'sh -c pnpm --filter sidecar typecheck',
      'bash -c "pnpm --filter sidecar typecheck"',
      "zsh -c 'pnpm --filter sidecar typecheck'",
      'pnpm exec sh -c pnpm --filter sidecar typecheck',
      'pnpm --filter sidecar exec node -e process.env.SOLDCOMPS_ENABLED=true',
      'node -e process.env.SOLDCOMPS_ENABLED=true',
      'node --test $(printf scripts/run-codex-verification.test.mjs)',
      'node --test --import=data:text/javascript,process.env.SOLDCOMPS_ENABLED=true scripts/run-codex-verification.test.mjs',
      'pnpm --filter sidecar exec vitest run --config scripts/unsafe.config.mjs tests/unit/server-http.test.ts',
      'pnpm --filter sidecar exec eslint --config scripts/unsafe.config.mjs src/server-http.ts',
      'npm run typecheck',
      'yarn typecheck',
      'bun run typecheck',
    ];

    for (const command of blockedCommands) {
      assert.throws(() => assertSafeVerificationCommand(command), /Blocked verification command/);
    }
  });

  it('forces both safety locks off for child commands', () => {
    const childEnv = buildSafeVerificationEnv({
      KEEP_ME: 'yes',
      SIDECAR_JOB_RUNNER_ENABLED: 'true',
      SOLDCOMPS_ENABLED: 'true',
    });

    assert.equal(childEnv.KEEP_ME, 'yes');
    assert.equal(childEnv.SIDECAR_JOB_RUNNER_ENABLED, 'false');
    assert.equal(childEnv.SOLDCOMPS_ENABLED, 'false');

    let captured;
    const exitCode = runCommand('pnpm --filter sidecar typecheck', {
      env: childEnv,
      spawn: (executable, args, options) => {
        captured = { args, executable, options };
        return { status: 0 };
      },
    });

    assert.equal(exitCode, 0);
    assert.equal(captured.executable, 'pnpm');
    assert.deepEqual(captured.args, ['--filter', 'sidecar', 'typecheck']);
    assert.equal(captured.options.shell, false);
    assert.equal(captured.options.env.SIDECAR_JOB_RUNNER_ENABLED, 'false');
    assert.equal(captured.options.env.SOLDCOMPS_ENABLED, 'false');
  });

  it('parses only a validated executable and argument vector', () => {
    assert.deepEqual(parseVerificationCommand('pnpm --filter sidecar typecheck'), {
      args: ['--filter', 'sidecar', 'typecheck'],
      executable: 'pnpm',
    });
  });
});
