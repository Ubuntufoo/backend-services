import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

const forbiddenPaths = [
  'src',
  'tests',
  'public',
  'Dockerfile',
  'eslint.config.js',
  'package-lock.json',
  'package.json.bak',
  'smoke-test-trading.mjs',
  'tsconfig.eslint.json',
  'vitest.config.ts',
  'services/ebay-service/package.json',
  'services/ebay-service/tsconfig.json',
  'services/ebay-service/src',
  'services/ebay-service/tests',
  'services/gemini-service/package.json',
  'services/gemini-service/tsconfig.json',
  'services/gemini-service/src',
  'services/gemini-service/tests',
  'services/job-runner/package.json',
  'services/job-runner/tsconfig.json',
  'services/job-runner/src',
  'services/job-runner/tests',
  'services/r2-service/package.json',
  'services/r2-service/tsconfig.json',
  'services/r2-service/src',
  'services/r2-service/tests',
  'services/sidecar/pnpm-lock.yaml'
];

const violations = forbiddenPaths.filter((path) => existsSync(resolve(repoRoot, path)));

if (violations.length > 0) {
  console.error('Canonical layout check failed. Remove the duplicate or placeholder runtime paths below:');
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

console.log('Canonical layout check passed.');
