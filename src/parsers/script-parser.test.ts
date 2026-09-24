import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { invokedCommands, readHookCommands } from './script-parser';

describe('invokedCommands', () => {
  test('each command of a chain, past env assignments and runners', () => {
    expect(invokedCommands('NODE_ENV=ci cross-env A=1 webpack --mode x && tsc | tee log; npx -y jest', [])).toEqual([
      'cross-env',
      'webpack',
      'tsc',
      'tee',
      'npx',
      'jest',
    ]);
  });

  test('a script runner hands on a binary but not a script of the same package.json', () => {
    expect(invokedCommands('npm run fmt && yarn tsc && pnpm build && bun deps-finder', ['fmt', 'build'])).toEqual([
      'npm',
      'yarn',
      'tsc',
      'pnpm',
      'bun',
      'deps-finder',
    ]);
  });

  test('dotenv hands on the command after --, and comments are not commands', () => {
    expect(invokedCommands('# lint-staged\ndotenv -e .env -- next dev # oxlint', [])).toEqual(['dotenv', 'next']);
  });
});

describe('readHookCommands', () => {
  const testDir = './test-script-parser';

  beforeEach(async () => {
    await mkdir(`${testDir}/.husky/_`, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  test('reads the git hooks, not the other files in .husky/', async () => {
    await writeFile(`${testDir}/.husky/pre-commit`, 'npx lint-staged\n');
    await writeFile(`${testDir}/.husky/index.mjs`, 'eslint();\n');
    await writeFile(`${testDir}/.husky/_/husky.sh`, 'prettier\n');

    expect(readHookCommands(testDir, ['x'])).toEqual({
      found: [{ file: path.join(testDir, '.husky', 'pre-commit'), script: 'npx lint-staged\n', scripts: ['x'] }],
      skipped: [],
    });
  });
});
