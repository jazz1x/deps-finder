import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Invoked, invokedCommands, readHookCommands } from './script-parser';

const commands = (script: string, scripts: ReadonlyArray<string>) =>
  invokedCommands(script, scripts).map(Invoked.$match({ Binary: ({ name }) => name, Package: ({ name }) => `package ${name}` }));

describe('invokedCommands', () => {
  test('each command of a chain, past env assignments and runners', () => {
    expect(commands('NODE_ENV=ci cross-env A=1 webpack --mode x && tsc | tee log; npx -y jest@29', [])).toEqual([
      'cross-env',
      'webpack',
      'tsc',
      'tee',
      'npx',
      'package jest',
      'jest@29',
    ]);
  });

  test('a script runner hands on a binary but not a script of the same package.json', () => {
    expect(commands('npm run fmt && yarn tsc && pnpm build && bun deps-finder', ['fmt', 'build'])).toEqual([
      'npm',
      'yarn',
      'tsc',
      'pnpm',
      'bun',
      'deps-finder',
    ]);
  });

  test('dotenv hands on the command after --, and comments are not commands', () => {
    expect(commands('# lint-staged\ndotenv -e .env -- next dev # oxlint', [])).toEqual(['dotenv', 'next']);
  });

  test('separators, spaces and # inside quotes stay in the word', () => {
    expect(commands(`echo "done; eslint #" && echo 'a | prettier' && FOO="a b" NODE_OPTIONS='--x --y' mocha; "jest"`, [])).toEqual([
      'echo',
      'mocha',
      'jest',
    ]);
  });

  test('subshells, groups and shell keywords are not commands', () => {
    expect(commands('(cd a; jest --ci) || { ava; } && if [ -n "$CI" ]; then echo ci; else oxlint src; fi; V=$(node -v) vite', [])).toEqual([
      'cd',
      'jest',
      'ava',
      '[',
      'echo',
      'oxlint',
      'node',
      'vite',
    ]);
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
