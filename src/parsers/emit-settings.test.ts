import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { JsxRuntime } from '@/domain/types';
import { readTsConfigChains } from '@/utils/tsconfig-reader';
import { emitSettingsOf } from './emit-settings';

describe('emitSettingsOf', () => {
  const testDir = path.resolve('./test-emit-settings');

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  const write = async (file: string, json: unknown) => {
    await mkdir(path.dirname(path.join(testDir, file)), { recursive: true });
    await writeFile(path.join(testDir, file), JSON.stringify(json));
  };

  const settingsOf = (roots: ReadonlyArray<string>, file: string) =>
    emitSettingsOf(readTsConfigChains(roots.map((root) => path.join(testDir, root))).found)(path.join(testDir, file));

  const jsxOf = (roots: ReadonlyArray<string>, file: string) => settingsOf(roots, file).jsx;

  test('without a jsx setting JSX goes through the react runtime', () => {
    expect(jsxOf([], 'src/App.tsx')).toEqual([JsxRuntime.Automatic({ importSource: 'react' })]);
  });

  test('jsx "react" is the classic runtime, whose factory is React unless jsxFactory names another', async () => {
    await write('tsconfig.json', { compilerOptions: { jsx: 'react' } });
    expect(jsxOf(['tsconfig.json'], 'src/App.tsx')).toEqual([JsxRuntime.Classic({ factory: 'React' })]);
    await write('tsconfig.json', { compilerOptions: { jsx: 'react', jsxFactory: 'preact.h' } });
    expect(jsxOf(['tsconfig.json'], 'src/App.tsx')).toEqual([JsxRuntime.Classic({ factory: 'preact' })]);
  });

  test('react-jsxdev takes an inherited jsxImportSource, and a null jsx clears the inherited one', async () => {
    await write('tsconfig.base.json', { compilerOptions: { jsx: 'react', jsxImportSource: '@emotion/react' } });
    await write('tsconfig.json', { extends: './tsconfig.base.json', compilerOptions: { jsx: 'react-jsxdev' } });
    expect(jsxOf(['tsconfig.json'], 'src/App.tsx')).toEqual([JsxRuntime.Automatic({ importSource: '@emotion/react' })]);
    await write('tsconfig.json', { extends: './tsconfig.base.json', compilerOptions: { jsx: null } });
    expect(jsxOf(['tsconfig.json'], 'src/App.tsx')).toEqual([JsxRuntime.Automatic({ importSource: '@emotion/react' })]);
  });

  test('jsx preserve or react-native without a jsxImportSource leaves the factory import to the next compiler', async () => {
    await write('tsconfig.json', { compilerOptions: { jsx: 'preserve', jsxFactory: 'h' } });
    expect(jsxOf(['tsconfig.json'], 'src/App.tsx')).toEqual([JsxRuntime.Preserved({ factory: 'h' })]);
    await write('tsconfig.json', { compilerOptions: { jsx: 'react-native' } });
    expect(jsxOf(['tsconfig.json'], 'src/App.tsx')).toEqual([JsxRuntime.Preserved({ factory: 'React' })]);
  });

  const elisionOf = (file: string) => settingsOf(['tsconfig.json'], file).elision;

  test('verbatimModuleSyntax, preserveValueImports or importsNotUsedAsValues preserve or error keep value imports', async () => {
    await write('tsconfig.json', { compilerOptions: {} });
    expect(elisionOf('src/a.ts')).toBe('unused-bindings');
    for (const options of [
      { verbatimModuleSyntax: true },
      { preserveValueImports: true },
      { importsNotUsedAsValues: 'preserve' },
      { importsNotUsedAsValues: 'error' },
    ]) {
      await write('tsconfig.json', { compilerOptions: options });
      expect(elisionOf('src/a.ts')).toBe('verbatim');
    }
    await write('tsconfig.json', { compilerOptions: { verbatimModuleSyntax: false, importsNotUsedAsValues: 'remove' } });
    expect(elisionOf('src/a.ts')).toBe('unused-bindings');
    await write('tsconfig.json', { compilerOptions: { emitDecoratorMetadata: true } });
    expect(elisionOf('src/a.ts')).toBe('decorator-metadata');
  });

  test('a file follows the tsconfig of the nearest directory that has one', async () => {
    await write('tsconfig.json', { compilerOptions: { jsx: 'react' } });
    await write('apps/web/tsconfig.app.json', { compilerOptions: { jsx: 'preserve', jsxImportSource: 'preact' } });
    const roots = ['tsconfig.json', 'apps/web/tsconfig.app.json'];
    expect(jsxOf(roots, 'apps/web/src/App.tsx')).toEqual([JsxRuntime.Automatic({ importSource: 'preact' })]);
    expect(jsxOf(roots, 'src/App.tsx')).toEqual([JsxRuntime.Classic({ factory: 'React' })]);
  });

  test('among sibling tsconfig files, those whose include or files cover the file decide, each with its own options', async () => {
    await write('tsconfig.json', {
      files: [],
      references: [
        { path: './tsconfig.web.json' },
        { path: './tsconfig.app.json' },
        { path: './tsconfig.spec.json' },
        { path: './tsconfig.tools.json' },
      ],
      compilerOptions: { jsx: 'react' },
    });
    await write('tsconfig.app.json', {
      include: ['src'],
      exclude: ['src/**/*.test.tsx'],
      compilerOptions: { jsx: 'react-jsx', verbatimModuleSyntax: true },
    });
    await write('tsconfig.web.json', { include: ['web/*.tsx'], compilerOptions: { jsx: 'react-jsx', jsxImportSource: 'preact' } });
    await write('tsconfig.tools.json', { files: ['tools/gen.tsx'], compilerOptions: { jsx: 'preserve', jsxImportSource: 'solid-js' } });
    await write('tsconfig.spec.json', {
      include: ['**/*.test.tsx'],
      compilerOptions: { jsx: 'react-jsx', jsxImportSource: '@emotion/react', verbatimModuleSyntax: true },
    });
    const roots = ['tsconfig.json'];
    expect(settingsOf(roots, 'src/App.tsx')).toEqual({ jsx: [JsxRuntime.Automatic({ importSource: 'react' })], elision: 'verbatim' });
    expect(settingsOf(roots, 'web/W.tsx')).toEqual({
      jsx: [JsxRuntime.Automatic({ importSource: 'preact' })],
      elision: 'unused-bindings',
    });
    expect(jsxOf(roots, 'src/App.test.tsx')).toEqual([JsxRuntime.Automatic({ importSource: '@emotion/react' })]);
    expect(settingsOf(roots, 'web/W.test.tsx')).toEqual({
      jsx: [JsxRuntime.Automatic({ importSource: '@emotion/react' }), JsxRuntime.Automatic({ importSource: 'preact' })],
      elision: 'verbatim',
    });
    expect(jsxOf(roots, 'tools/gen.tsx')).toEqual([JsxRuntime.Automatic({ importSource: 'solid-js' })]);
    expect(jsxOf(roots, 'tools/run.tsx')).toEqual([JsxRuntime.Classic({ factory: 'React' })]);
  });
});
