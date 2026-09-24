import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { LayoutManifest } from './package-parser';
import { readToolConfigs } from './config-references';

describe('readToolConfigs', () => {
  const testDir = path.resolve('./test-config-references');

  const write = async (file: string, content: unknown) => {
    await mkdir(path.dirname(path.join(testDir, file)), { recursive: true });
    await writeFile(path.join(testDir, file), typeof content === 'string' ? content : JSON.stringify(content));
  };

  const referenced = (manifests: ReadonlyArray<LayoutManifest> = []) =>
    readToolConfigs([testDir], manifests).references.map((use) => use.packageName);

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  test('ESLint short names follow its naming convention', async () => {
    await write(
      '.eslintrc.yml',
      [
        'plugins: [react, "@typescript-eslint", "@nrwl/nx", eslint-plugin-jest]',
        'extends: ["eslint:recommended", "plugin:@next/next/recommended", airbnb/hooks, "@vue", "@nuxtjs/eslint-config-typescript"]',
        'rules: { "import/no-cycle": off, "no-console": off }',
      ].join('\n'),
    );

    expect(referenced()).toEqual([
      'eslint-plugin-react',
      '@typescript-eslint/eslint-plugin',
      '@nrwl/eslint-plugin-nx',
      'eslint-plugin-jest',
      '@next/eslint-plugin-next',
      'eslint-config-airbnb',
      '@vue/eslint-config',
      '@nuxtjs/eslint-config-typescript',
      'eslint-plugin-import',
    ]);
  });

  test('Babel, Jest, commitlint and Nx names, from a JS object literal and package.json', async () => {
    await write(
      'babel.config.js',
      "module.exports = defineConfig({ presets: [['@babel/env', {}]], plugins: ['module:metro-plugin', '@emotion', './local'] });",
    );
    await write('jest.config.ts', "export default { testEnvironment: 'node', transform: { x: ['ts-jest', {}] } } as Config;");
    await write('commitlint.config.cjs', "module.exports = { extends: ['@commitlint/config-conventional', 'lerna'] };");
    await write('project.json', { targets: { test: { executor: '@nx/jest:jest' } } });

    expect(referenced().toSorted()).toEqual([
      '@babel/preset-env',
      '@commitlint/config-conventional',
      '@emotion/babel-plugin',
      '@nx/jest',
      'commitlint-config-lerna',
      'jest-environment-node',
      'metro-plugin',
      'ts-jest',
    ]);
  });

  test('a shared Prettier config named by package.json, and lint-staged commands', () => {
    const manifest: LayoutManifest = {
      path: path.join(testDir, 'package.json'),
      scripts: {},
      bins: [],
      tools: [
        ['prettier', '@company/prettier-config'],
        ['lint-staged', { '*.ts': ['eslint --fix', 'prettier -w'], '*.css': 'stylelint' }],
      ],
    };

    const found = readToolConfigs([], [manifest]);
    expect(found.references.map((use) => use.packageName)).toEqual(['@company/prettier-config']);
    expect(found.commands.map((command) => command.script)).toEqual(['eslint --fix', 'prettier -w', 'stylelint']);
  });

  test('any other root config counts only a string that is exactly a package name', async () => {
    await write('vite.config.ts', "export default { build: { minify: 'terser', outDir: 'dist/app', lib: 'react/jsx' } };");

    expect(referenced()).toEqual(['terser']);
  });

  test('root JSON and YAML configs count exact package names, but not manifests or lockfiles', async () => {
    await write('.oxlintrc.manners.json', { jsPlugins: ['@company/oxlint-rules', './local.js'] });
    await write('codegen.yml', 'generates:\n  out.ts:\n    plugins: [typescript-operations]\n');
    await write('package-lock.json', { packages: { '': { name: 'lockfile-name' } } });
    await write('pnpm-workspace.yaml', 'onlyBuiltDependencies: [esbuild]\n');
    await write('tsconfig.app.json', { compilerOptions: { jsxImportSource: '@emotion/react' } });

    expect(referenced().toSorted()).toEqual(['@company/oxlint-rules', 'typescript-operations']);
  });

  test('an rc file without an extension is JSON with comments, or else YAML', async () => {
    await write('.eslintrc', '// legacy\n{ "plugins": ["react"] }\n');
    await write('.babelrc', 'plugins:\n  - macros\n');

    expect(referenced().toSorted()).toEqual(['babel-plugin-macros', 'eslint-plugin-react']);
  });

  test('a malformed config is skipped with its error', async () => {
    await write('.eslintrc', '{ "plugins": [');

    expect(readToolConfigs([testDir], []).skipped).toMatchObject([{ _tag: 'ParseFailed' }]);
  });
});
