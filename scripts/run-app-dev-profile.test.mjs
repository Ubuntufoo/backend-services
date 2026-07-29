import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildStartupProfileEnv,
  runStartupProfile,
  STARTUP_PROFILES,
} from './run-app-dev-profile.mjs';

describe('sidecar startup profiles', () => {
  it('resolves the three documented safety-lock combinations', () => {
    assert.deepEqual(STARTUP_PROFILES['app:dev'], {
      SIDECAR_JOB_RUNNER_ENABLED: 'true',
      SOLDCOMPS_ENABLED: 'true',
    });
    assert.deepEqual(STARTUP_PROFILES['app:dev:no-pricing'], {
      SIDECAR_JOB_RUNNER_ENABLED: 'true',
      SOLDCOMPS_ENABLED: 'false',
    });
    assert.deepEqual(STARTUP_PROFILES['dev:safe'], {
      SIDECAR_JOB_RUNNER_ENABLED: 'false',
      SOLDCOMPS_ENABLED: 'false',
    });
  });

  it('overrides ambient lock values without exposing other environment values', () => {
    const env = buildStartupProfileEnv('dev:safe', {
      SECRET_VALUE: 'not-printed',
      SIDECAR_JOB_RUNNER_ENABLED: 'true',
      SOLDCOMPS_ENABLED: 'true',
    });

    assert.equal(env.SECRET_VALUE, 'not-printed');
    assert.equal(env.SIDECAR_JOB_RUNNER_ENABLED, 'false');
    assert.equal(env.SOLDCOMPS_ENABLED, 'false');
  });

  it('supports a dry run that prints only profile state and never starts the server', () => {
    const lines = [];
    let spawnCalled = false;
    const exitCode = runStartupProfile('app:dev:no-pricing', {
      dryRun: true,
      spawn: () => {
        spawnCalled = true;
        return { status: 0 };
      },
      writeLine: (line) => lines.push(line),
    });

    assert.equal(exitCode, 0);
    assert.equal(spawnCalled, false);
    assert.deepEqual(lines, [
      'Startup profile: app:dev:no-pricing',
      'SIDECAR_JOB_RUNNER_ENABLED=true',
      'SOLDCOMPS_ENABLED=false',
      'Dry run: sidecar server not started.',
    ]);
  });

  it('passes the resolved profile locks to the sidecar child', () => {
    let childOptions;
    const exitCode = runStartupProfile('app:dev', {
      env: {},
      spawn: (_command, _args, options) => {
        childOptions = options;
        return { status: 0 };
      },
      writeLine: () => {},
    });

    assert.equal(exitCode, 0);
    assert.equal(childOptions.env.SIDECAR_JOB_RUNNER_ENABLED, 'true');
    assert.equal(childOptions.env.SOLDCOMPS_ENABLED, 'true');
    assert.equal(childOptions.shell, false);
  });
});
