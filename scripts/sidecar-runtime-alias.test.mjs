import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const sidecarRoot = resolve(repoRoot, 'services/sidecar');
const networkGuard = resolve(repoRoot, 'scripts/sidecar-no-network-guard.cjs');
const offlineEnv = Object.freeze({
  APIFY_ENABLED: 'false',
  EBAY_ACCESS_TOKEN: '',
  EBAY_APP_ACCESS_TOKEN: '',
  EBAY_CLIENT_ID: '',
  EBAY_CLIENT_SECRET: '',
  EBAY_ENABLED: 'false',
  EBAY_PUBLISH_ENABLED: 'false',
  EBAY_REDIRECT_URI: '',
  EBAY_REFRESH_TOKEN: '',
  EBAY_USER_ACCESS_TOKEN: '',
  EBAY_USER_REFRESH_TOKEN: '',
  NO_UPDATE_NOTIFIER: '1',
  NODE_OPTIONS: `--require=${networkGuard}`,
  PATH: process.env.PATH,
  SIDECAR_JOB_RUNNER_ENABLED: 'false',
  SOLDCOMPS_ENABLED: 'false',
  WATCHER_ENABLED: 'false',
});

describe('Sidecar TypeScript runtime aliases', () => {
  it('keeps duplicated shared compiler options equal', () => {
    const base = JSON.parse(readFileSync(resolve(repoRoot, 'tsconfig.base.json'), 'utf8'));
    const sidecar = JSON.parse(
      readFileSync(resolve(sidecarRoot, 'tsconfig.json'), 'utf8')
    );
    const sharedKeys = [
      'target',
      'module',
      'moduleResolution',
      'strict',
      'esModuleInterop',
      'skipLibCheck',
      'forceConsistentCasingInFileNames',
      'declaration',
      'declarationMap',
      'sourceMap',
    ];

    for (const key of sharedKeys) {
      assert.deepEqual(
        sidecar.compilerOptions[key],
        base.compilerOptions[key],
        `Sidecar tsconfig shared option ${key} drifted: sidecar=${JSON.stringify(sidecar.compilerOptions[key])} base=${JSON.stringify(base.compilerOptions[key])}`
      );
    }
  });

  it('resolves aliases and forwards literal -- arguments', () => {
    const result = spawnSync(
      resolve(sidecarRoot, 'node_modules/.bin/tsx'),
      [
        resolve(sidecarRoot, 'src/scripts/cleanup-ebay-sandbox.ts'),
        '--',
        '--runtime-alias-probe',
      ],
      {
        cwd: sidecarRoot,
        encoding: 'utf8',
        env: offlineEnv,
        timeout: 10_000,
      }
    );
    const output = `${result.stdout}${result.stderr}`;

    assert.equal(result.error, undefined);
    assert.equal(result.status, 1);
    assert.match(output, /Unknown argument: --runtime-alias-probe/);
    assert.doesNotMatch(output, /ERR_MODULE_NOT_FOUND|toReversed/);
  });

  it('imports HTTP and stdio entrypoints without starting a service', () => {
    const expression = [
      "const http = await import('./src/server-http.ts');",
      "const stdio = await import('./src/index.ts');",
      "if (typeof http.isSidecarJobRunnerEnabled !== 'function') process.exit(1);",
      "if (typeof stdio.EbayMcpServer !== 'function') process.exit(1);",
      "if (typeof stdio.main !== 'function') process.exit(1);",
    ].join(' ');
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', '--input-type=module', '--eval', expression],
      {
        cwd: sidecarRoot,
        encoding: 'utf8',
        env: offlineEnv,
        timeout: 10_000,
      }
    );
    const output = `${result.stdout}${result.stderr}`;

    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, output);
    assert.doesNotMatch(output, /ERR_MODULE_NOT_FOUND|toReversed/);
  });

  it('imports setup only on demand and preserves direct setup exit codes', () => {
    const source = readFileSync(resolve(sidecarRoot, 'src/index.ts'), 'utf8');
    assert.doesNotMatch(source, /^import .*scripts\/setup/m);

    const expression = [
      "const module = await import('./src/index.ts');",
      'let setupCalls = 0;',
      "await module.main(['setup'], { runSetup: async () => { setupCalls += 1; } });",
      'if (setupCalls !== 1) process.exit(2);',
      'const exitCodes = [];',
      "await module.runDirectEntrypoint(['setup'], { runMain: async () => {}, exit: (code) => exitCodes.push(code) });",
      "await module.runDirectEntrypoint(['setup'], { runMain: async () => { throw new Error('expected'); }, exit: (code) => exitCodes.push(code), logSetupError: () => {} });",
      "if (exitCodes.join(',') !== '0,1') process.exit(3);",
    ].join(' ');
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', '--input-type=module', '--eval', expression],
      {
        cwd: sidecarRoot,
        encoding: 'utf8',
        env: offlineEnv,
        timeout: 10_000,
      }
    );
    const output = `${result.stdout}${result.stderr}`;

    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, output);
    assert.doesNotMatch(output, /Network access blocked|ERR_MODULE_NOT_FOUND|toReversed/);
  });

  it('validates environment only behind the hard network guard', () => {
    const result = spawnSync(
      resolve(sidecarRoot, 'node_modules/.bin/tsx'),
      [resolve(sidecarRoot, 'src/scripts/validate-env.ts')],
      {
        cwd: sidecarRoot,
        encoding: 'utf8',
        env: offlineEnv,
        timeout: 10_000,
      }
    );
    const output = `${result.stdout}${result.stderr}`;

    assert.equal(result.error, undefined);
    assert.ok(result.status === 0 || result.status === 1, output);
    assert.doesNotMatch(
      output,
      /Network access blocked|ERR_MODULE_NOT_FOUND|toReversed/
    );
  });

  it('fails fast across every blocked networking surface', () => {
    const probes = [
      ["require('node:http').get('http://example.com')", 'http.get'],
      ["require('node:https').get('https://example.com')", 'https.get'],
      ["require('node:net').connect({ host: '127.0.0.1', port: 9 })", 'net.connect'],
      ["require('node:tls').connect({ host: '127.0.0.1', port: 9 })", 'tls.connect'],
      ["require('node:dns').lookup('example.com', () => {})", 'dns.lookup'],
      ["fetch('https://example.com')", 'fetch'],
    ];

    for (const [expression, surface] of probes) {
      const result = spawnSync(process.execPath, ['--eval', expression], {
        cwd: repoRoot,
        encoding: 'utf8',
        env: offlineEnv,
        timeout: 10_000,
      });
      const output = `${result.stdout}${result.stderr}`;

      assert.equal(result.status, 1, `${surface} unexpectedly succeeded`);
      assert.match(
        output,
        new RegExp(`Network access blocked by sidecar-no-network-guard: ${surface.replace('.', '\\.')}`)
      );
    }
  });
});
