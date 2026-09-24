import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pkg from '../package.json';

const REPO_ROOT = path.resolve(import.meta.dir, '..');
const CLI_PATH = path.join(REPO_ROOT, 'bin', 'cli.js');
const STRIP_ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

const runCli = (args: ReadonlyArray<string>, cwd: string) => {
  const result = spawnSync('node', [CLI_PATH, ...args], {
    cwd,
    encoding: 'utf-8',
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
  });
  return {
    stdout: result.stdout ?? '',
    stderr: (result.stderr ?? '').replace(STRIP_ANSI, ''),
    status: result.status,
  };
};

const writeFiles = async (root: string, files: Readonly<Record<string, unknown>>) => {
  for (const [file, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), typeof content === 'string' ? content : JSON.stringify(content));
  }
};

describe('CLI e2e (bin/cli.js)', () => {
  let baseTmpDir = '';
  let tmpDir = '';

  beforeAll(async () => {
    const build = spawnSync('bun', ['run', 'build'], { cwd: REPO_ROOT, encoding: 'utf-8' });
    if (build.status !== 0) {
      throw new Error(`build failed:\n${build.stdout}\n${build.stderr}`);
    }
    baseTmpDir = await mkdtemp(path.join(tmpdir(), 'depsfinder-e2e-'));
  });

  beforeEach(async () => {
    tmpDir = path.join(baseTmpDir, `case-${Math.random().toString(36).slice(2)}`);
    await mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  afterAll(async () => {
    if (baseTmpDir) await rm(baseTmpDir, { recursive: true, force: true });
  });

  test('--help prints usage and exits 0', () => {
    const r = runCli(['--help'], tmpDir);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('USAGE');
    expect(r.stdout).toContain('--ignore');
  });

  test('--version prints the package version and exits 0', () => {
    const r = runCli(['--version'], tmpDir);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(pkg.version);
  });

  test('analyzes the project directory given as an argument', async () => {
    await mkdir(path.join(tmpDir, 'app'));
    await writeFile(path.join(tmpDir, 'app/package.json'), JSON.stringify({ dependencies: { lodash: '^4.0.0' } }));
    const r = runCli(['--json', 'app'], tmpDir);
    expect(r.status).toBe(1);
    expect(JSON.parse(r.stdout).unused).toEqual(['lodash']);
  });

  test('accepts --flag=value', async () => {
    await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ dependencies: { lodash: '^4.0.0' } }));
    const r = runCli(['--json', '--ignore=lodash'], tmpDir);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).ignored).toEqual(['lodash']);
  });

  test('exits 0 on a clean project (no issues)', async () => {
    await writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'clean', version: '1.0.0', dependencies: { lodash: '^4.0.0' } }),
    );
    await mkdir(path.join(tmpDir, 'src'), { recursive: true });
    await writeFile(path.join(tmpDir, 'src/index.ts'), `import _ from 'lodash'; console.log(_);`);

    const r = runCli([], tmpDir);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('No issues found');
  });

  test('exits 1 and reports unused deps', async () => {
    await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 't', version: '1.0.0', dependencies: { lodash: '^4.0.0' } }));
    const r = runCli([], tmpDir);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('Unused Dependencies');
    expect(r.stdout).toContain('lodash');
    expect(r.stdout).not.toContain(String.fromCharCode(27));
  });

  test('warns about source files it cannot read', async () => {
    await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ dependencies: { lodash: '^4.0.0' } }));
    await mkdir(path.join(tmpDir, 'src'));
    await writeFile(path.join(tmpDir, 'src/broken.ts'), "import _ from 'lodash';");
    await chmod(path.join(tmpDir, 'src/broken.ts'), 0o000);
    const r = runCli(['--json'], tmpDir);
    expect(r.stderr).toContain('src/broken.ts');
    expect(JSON.parse(r.stdout).unused).toEqual(['lodash']);
  });

  test('warns about project inputs it cannot use and goes on', async () => {
    await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ dependencies: { lodash: '^4.0.0' } }));
    await mkdir(path.join(tmpDir, 'weird'));
    await writeFile(path.join(tmpDir, 'weird/package.json'), '{"name":');
    await writeFile(path.join(tmpDir, 'weird/index.ts'), "import _ from 'lodash';\nexport default _;");
    const r = runCli(['--json'], tmpDir);
    expect(r.stderr).toContain('warning: could not use weird/package.json');
    expect(r.status).toBe(0);
  });

  test('names each nested package it leaves out, and credits the root with what it does not declare', async () => {
    await writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ workspaces: ['packages/*'], devDependencies: { '@happy-dom/global-registrator': '^20.0.0', dayjs: '^1.0.0' } }),
    );
    await mkdir(path.join(tmpDir, 'packages/shared-ui/src'), { recursive: true });
    await writeFile(path.join(tmpDir, 'packages/shared-ui/package.json'), '{"name":"shared-ui","dependencies":{"dayjs":"1"}}');
    await writeFile(
      path.join(tmpDir, 'packages/shared-ui/src/happydom-setup.ts'),
      "import '@happy-dom/global-registrator';\nimport 'dayjs';",
    );
    const r = runCli(['--json', '-a'], tmpDir);
    expect(r.stderr).toContain('note: left out packages/shared-ui');
    expect(JSON.parse(r.stdout).unused).toEqual(['dayjs']);
  });

  test('warns once about a left-out package whose package.json is broken', async () => {
    await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ workspaces: ['packages/*'] }));
    await mkdir(path.join(tmpDir, 'packages/a'), { recursive: true });
    await writeFile(path.join(tmpDir, 'packages/a/package.json'), '{"name":');
    const r = runCli(['--json'], tmpDir);
    expect(r.stderr.split('could not use packages/a/package.json').length).toBe(2);
  });

  test('--json emits parseable JSON with totalIssues and exits 1 when issues exist', async () => {
    await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 't', version: '1.0.0', dependencies: { lodash: '^4.0.0' } }));
    const r = runCli(['--json'], tmpDir);
    expect(r.status).toBe(1);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.unused).toContain('lodash');
    expect(parsed.totalIssues).toBeGreaterThan(0);
  });

  test('a missing package.json is a run failure (exit 2), not a finding', () => {
    const r = runCli([], tmpDir);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('package.json not found');
    expect(r.stderr).not.toContain('FileNotFound');
    expect(r.stderr).not.toContain('_tag');
  });

  test('formats malformed package.json error without leaking stack trace', async () => {
    await writeFile(path.join(tmpDir, 'package.json'), 'not json {{');
    const r = runCli([], tmpDir);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('Failed to parse');
    expect(r.stderr).not.toContain('at JSON.parse');
    expect(r.stderr).not.toContain('SyntaxError');
  });

  test('malformed package.json error points at the broken position', async () => {
    await writeFile(path.join(tmpDir, 'package.json'), '{ "dependencies": { "a": "1", } }');
    const r = runCli([], tmpDir);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('position');
  });

  test('read failure message carries no "Error:" prefix', async () => {
    await mkdir(path.join(tmpDir, 'package.json'));
    const r = runCli([], tmpDir);
    expect(r.stderr).toContain('EISDIR');
    expect(r.stderr).not.toContain('Error: EISDIR');
  });

  test('an unknown flag fails the run (exit 2) instead of being ignored', async () => {
    await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 't', version: '1.0.0' }));
    const r = runCli(['--bogus'], tmpDir);
    expect(r.stderr).toContain('--bogus');
    expect(r.status).toBe(2);
  });

  test('interactive built-ins such as --wizard are not exposed (they hang or pass vacuously in CI)', async () => {
    await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ dependencies: { lodash: '^4.0.0' } }));
    expect(runCli(['--wizard'], tmpDir).status).toBe(2);
  });

  test('--ignore without a value fails the run (exit 2)', async () => {
    await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 't', version: '1.0.0' }));
    const r = runCli(['--ignore'], tmpDir);
    expect(r.stderr).toContain('--ignore');
    expect(r.status).toBe(2);
  });

  test('--ignore filters unused entries', async () => {
    await writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 't',
        version: '1.0.0',
        dependencies: { 'unused-a': '^1.0.0', 'unused-b': '^1.0.0' },
      }),
    );
    const r = runCli(['--json', '--ignore', 'unused-a'], tmpDir);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.unused).not.toContain('unused-a');
    expect(parsed.unused).toContain('unused-b');
    expect(parsed.ignored).toContain('unused-a');
  });

  test('default does not flag unused peerDependencies', async () => {
    await writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 't',
        version: '1.0.0',
        peerDependencies: { typescript: '^5.0.0' },
      }),
    );
    await mkdir(path.join(tmpDir, 'src'), { recursive: true });
    await writeFile(path.join(tmpDir, 'src/index.ts'), 'export const x = 1;');

    const r = runCli(['--json'], tmpDir);
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.unused).not.toContain('typescript');
    expect(parsed.unusedPeer).toEqual([]);
  });

  test('--check-peer reports unused peerDependencies separately', async () => {
    await writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 't',
        version: '1.0.0',
        peerDependencies: { typescript: '^5.0.0' },
      }),
    );
    await mkdir(path.join(tmpDir, 'src'), { recursive: true });
    await writeFile(path.join(tmpDir, 'src/index.js'), 'export const x = 1;');

    const r = runCli(['--json', '--check-peer'], tmpDir);
    expect(r.status).toBe(1);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.unusedPeer).toContain('typescript');
    expect(parsed.unused).not.toContain('typescript');
  });

  test('text output includes Unused peerDependencies section under --check-peer', async () => {
    await writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 't',
        version: '1.0.0',
        peerDependencies: { typescript: '^5.0.0' },
      }),
    );
    const r = runCli(['-p'], tmpDir);
    expect(r.stdout).toContain('Unused peerDependencies');
    expect(r.stdout).toContain('typescript');
  });

  test('--exclude prevents matching files from contributing imports', async () => {
    await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 't', version: '1.0.0', dependencies: { lodash: '^4.0.0' } }));
    await mkdir(path.join(tmpDir, 'vendor'), { recursive: true });
    await writeFile(path.join(tmpDir, 'vendor/use.ts'), `import _ from 'lodash'; export {};`);

    const r = runCli(['--json', '--exclude', 'vendor/**'], tmpDir);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.unused).toContain('lodash');
  });

  test('--all includes devDependencies in unused check', async () => {
    await writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 't',
        version: '1.0.0',
        devDependencies: { 'unused-dev': '^1.0.0' },
      }),
    );
    await mkdir(path.join(tmpDir, 'src'), { recursive: true });
    await writeFile(path.join(tmpDir, 'src/index.ts'), 'export const x = 1;');

    const r = runCli(['--json', '--all'], tmpDir);
    expect(r.status).toBe(1);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.unused).toContain('unused-dev');
  });

  test('reports misplaced dependency (devDep used in production source)', async () => {
    await writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 't',
        version: '1.0.0',
        devDependencies: { lodash: '^4.0.0' },
      }),
    );
    await mkdir(path.join(tmpDir, 'src'), { recursive: true });
    await writeFile(path.join(tmpDir, 'src/index.ts'), `import _ from 'lodash'; export default _;`);

    const r = runCli(['--json'], tmpDir);
    expect(r.status).toBe(1);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.misplaced.some((d: { packageName: string }) => d.packageName === 'lodash')).toBe(true);
  });

  test('tsconfig usage counts: types, importHelpers, and a missing extends warns', async () => {
    await writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ dependencies: { tslib: '2' }, devDependencies: { '@types/node': '1', '@types/uuid': '1' } }),
    );
    await writeFile(
      path.join(tmpDir, 'tsconfig.json'),
      JSON.stringify({ extends: './missing.json', compilerOptions: { types: ['node'], importHelpers: true } }),
    );

    const r = runCli(['--json', '-a'], tmpDir);
    expect(JSON.parse(r.stdout).unused).toEqual(['@types/uuid']);
    expect(r.stderr).toContain('missing.json');
  });

  test('a devDependency whose import is used only as types is not misplaced; a dependency is not typeOnly', async () => {
    await writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ dependencies: { react: '1', hotscript: '1' }, devDependencies: { '@mui/types': '7' } }),
    );
    await mkdir(path.join(tmpDir, 'src'), { recursive: true });
    await writeFile(
      path.join(tmpDir, 'src/a.ts'),
      [
        "import React from 'react';",
        "import { OverridableStringUnion } from '@mui/types';",
        "import { Pipe, Tuples } from 'hotscript';",
        "export type X = OverridableStringUnion<'a', {}> | Pipe<['a'], [Tuples.Join<''>]>;",
        'export const y = React;',
      ].join('\n'),
    );

    const r = runCli(['--json'], tmpDir);
    expect(JSON.parse(r.stdout)).toMatchObject({ misplaced: [], typeOnly: [], totalIssues: 0 });
  });

  test('a malformed tsconfig.json warns once', async () => {
    await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ devDependencies: { typescript: '1' } }));
    await writeFile(path.join(tmpDir, 'tsconfig.json'), '{ "compilerOptions": { ');

    const r = runCli(['--json', '-a'], tmpDir);
    expect(r.stderr.match(/tsconfig\.json/g)).toHaveLength(1);
  });

  test('--json output larger than one pipe read arrives whole before a failing exit', async () => {
    const dependencies = Object.fromEntries(Array.from({ length: 50000 }, (_, i) => [`unused-package-${i}`, '^1.0.0']));
    await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 't', version: '1.0.0', dependencies }));

    const r = runCli(['--json'], tmpDir);
    expect(r.status).toBe(1);
    expect(JSON.parse(r.stdout).unused.length).toBe(50000);
  });

  describe('packages used without an import', () => {
    test('a package whose binary a script or git hook runs is used', async () => {
      await writeFiles(tmpDir, {
        'package.json': {
          scripts: {
            prepare: 'husky',
            lint: 'cross-env NODE_ENV=ci oxlint src && npm run fmt',
            fmt: 'FORCE=1 pnpm exec prettier . | tee out',
            format: 'biome format',
          },
          dependencies: { husky: '9' },
          devDependencies: {
            oxlint: '1',
            'cross-env': '7',
            prettier: '3',
            'lint-staged': '15',
            '@biomejs/biome': '1',
            fmt: '1',
            'left-pad': '1',
          },
        },
        '.husky/pre-commit': 'npx lint-staged\n',
        'node_modules/@biomejs/biome/package.json': { name: '@biomejs/biome', bin: { biome: 'bin/biome' } },
        'src/a.ts': 'export const a = 1;',
      });

      const r = runCli(['--json', '-a'], tmpDir);
      expect(JSON.parse(r.stdout).unused).toEqual(['fmt', 'left-pad']);
    });

    test("a declared package that satisfies a used package's peer is used, to a fixpoint", async () => {
      await writeFiles(tmpDir, {
        'package.json': {
          scripts: { cycle: 'madge src' },
          dependencies: { next: '14', '@opentelemetry/api': '1', 'react-apexcharts': '1', apexcharts: '3', 'left-pad': '1' },
          devDependencies: { madge: '8', typescript: '5' },
        },
        'node_modules/next/package.json': {
          name: 'next',
          peerDependencies: { '@opentelemetry/api': '^1', react: '^18' },
          peerDependenciesMeta: { '@opentelemetry/api': { optional: true } },
        },
        'node_modules/react-apexcharts/package.json': { name: 'react-apexcharts', peerDependencies: { apexcharts: '^3' } },
        'node_modules/madge/package.json': { name: 'madge', bin: { madge: 'bin/cli.js' }, peerDependencies: { typescript: '^5' } },
        'src/a.js': "import next from 'next'; import Chart from 'react-apexcharts'; export default [next, Chart];",
      });

      const r = runCli(['--json', '-a'], tmpDir);
      expect(JSON.parse(r.stdout)).toMatchObject({ unused: ['left-pad'], misplaced: [] });
    });

    test('without node_modules, binaries match by package name and one note says so', async () => {
      await writeFiles(tmpDir, {
        'package.json': {
          scripts: { a: 'jest', b: 'vite build' },
          devDependencies: { jest: '29', vite: '5', '@vitejs/plugin-react': '4' },
        },
      });

      const r = runCli(['--json', '-a'], tmpDir);
      expect(JSON.parse(r.stdout).unused).toEqual(['@vitejs/plugin-react']);
      expect(r.stderr.match(/node_modules/g)).toHaveLength(1);
    });

    test('tool configs that name a package by string use it', async () => {
      await writeFiles(tmpDir, {
        'package.json': {
          devDependencies: Object.fromEntries(
            [
              '@typescript-eslint/parser',
              'eslint-plugin-relay',
              '@typescript-eslint/eslint-plugin',
              'eslint-config-prettier',
              'eslint-plugin-import',
              'eslint-plugin-unused-imports',
              'eslint-import-resolver-typescript',
              '@babel/preset-env',
              'babel-plugin-macros',
              'tailwindcss',
              'autoprefixer',
              'ts-jest',
              'jest-environment-jsdom',
              'vue-jest',
              'prettier-plugin-tailwindcss',
              '@storybook/addon-a11y',
              '@storybook/builder-vite',
              'serverless-offline',
              '@nx/jest',
              'typescript-plugin-css-modules',
              'terser',
              'left-pad',
            ].map((name) => [name, '1']),
          ),
        },
        '.eslintrc': JSON.stringify({
          parser: '@typescript-eslint/parser',
          plugins: ['relay'],
          extends: ['prettier', 'plugin:@typescript-eslint/recommended'],
          rules: { 'import/no-cycle': 'error' },
          overrides: [{ files: ['*.ts'], rules: { 'unused-imports/no-unused-imports': 'error' } }],
          settings: { 'import/resolver': { typescript: {} } },
        }),
        '.babelrc': { presets: ['@babel/preset-env'], plugins: ['macros'] },
        'postcss.config.js': 'module.exports = { plugins: { tailwindcss: {}, autoprefixer: {} } };',
        'jest.config.ts': "export default { preset: 'ts-jest', testEnvironment: 'jsdom', transform: { '^.+\\\\.vue$': 'vue-jest' } };",
        '.prettierrc.yaml': 'plugins:\n  - prettier-plugin-tailwindcss\n',
        '.storybook/main.ts': "export default { addons: ['@storybook/addon-a11y'], core: { builder: '@storybook/builder-vite' } };",
        'serverless.yml': 'service: s\nplugins:\n  - serverless-offline\n',
        'project.json': { name: 'app', targets: { test: { executor: '@nx/jest:jest' } } },
        'tsconfig.json': { compilerOptions: { plugins: [{ name: 'typescript-plugin-css-modules' }] } },
        'vite.config.ts': "export default { build: { minify: 'terser' } };",
      });

      const r = runCli(['--json', '-a'], tmpDir);
      expect(JSON.parse(r.stdout).unused).toEqual(['left-pad']);
    });

    test('a package.json bin under scripts/ is production source', async () => {
      await writeFiles(tmpDir, {
        'package.json': {
          name: 'tool',
          bin: { tool: 'scripts/cli.js' },
          dependencies: { commander: '12' },
          devDependencies: { kleur: '4' },
        },
        'scripts/cli.js': "const { program } = require('commander'); const k = require('kleur'); program.parse(k);",
      });

      const parsed = JSON.parse(runCli(['--json'], tmpDir).stdout);
      expect(parsed.unused).toEqual([]);
      expect(parsed.misplaced.map((d: { packageName: string }) => d.packageName)).toEqual(['kleur']);
    });
  });
});
