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

  const jsxOf = (roots: ReadonlyArray<string>, file: string) =>
    emitSettingsOf(readTsConfigChains(roots.map((root) => path.join(testDir, root))).found)(path.join(testDir, file)).jsx;

  test('without a jsx setting JSX goes through the react runtime', () => {
    expect(jsxOf([], 'src/App.tsx')).toEqual(JsxRuntime.Automatic({ importSource: 'react' }));
  });

  test('jsx "react" is the classic runtime', async () => {
    await write('tsconfig.json', { compilerOptions: { jsx: 'react' } });
    expect(jsxOf(['tsconfig.json'], 'src/App.tsx')).toEqual(JsxRuntime.Classic());
  });

  test('react-jsxdev takes an inherited jsxImportSource', async () => {
    await write('tsconfig.base.json', { compilerOptions: { jsxImportSource: '@emotion/react' } });
    await write('tsconfig.json', { extends: './tsconfig.base.json', compilerOptions: { jsx: 'react-jsxdev' } });
    expect(jsxOf(['tsconfig.json'], 'src/App.tsx')).toEqual(JsxRuntime.Automatic({ importSource: '@emotion/react' }));
  });

  test('a file follows the tsconfig of the nearest directory that has one', async () => {
    await write('tsconfig.json', { compilerOptions: { jsx: 'react' } });
    await write('apps/web/tsconfig.app.json', { compilerOptions: { jsx: 'preserve', jsxImportSource: 'preact' } });
    const roots = ['tsconfig.json', 'apps/web/tsconfig.app.json'];
    expect(jsxOf(roots, 'apps/web/src/App.tsx')).toEqual(JsxRuntime.Automatic({ importSource: 'preact' }));
    expect(jsxOf(roots, 'src/App.tsx')).toEqual(JsxRuntime.Classic());
  });
});
