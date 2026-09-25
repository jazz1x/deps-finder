import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { chmod, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { MESSAGES } from '@/constants/messages';
import { FileError } from '@/domain/errors';
import { formatSkippedSource } from '@/reporters/error-reporter';
import { type EmitSettings, type FileContext, JsxRuntime } from '@/domain/types';
import { UNCONFIGURED } from './emit-settings';
import { NO_RESOLUTION } from './module-resolution';
import {
  extractImports as extractIn,
  fileContextOf,
  findFiles,
  parseFile,
  parseMultipleFiles,
  shouldAnalyzeFile,
} from '@/parsers/import-parser';

const extractImports = (content: string, file: string) =>
  extractIn(content, file, { context: 'production', emit: UNCONFIGURED, resolution: NO_RESOLUTION });

describe('findFiles', () => {
  const testDir = './test-find-files';

  beforeEach(async () => {
    await mkdir(`${testDir}/src`, { recursive: true });
    await mkdir(`${testDir}/node_modules`, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  test('should find TypeScript files', async () => {
    await writeFile(`${testDir}/src/index.ts`, 'console.log("test");');
    await writeFile(`${testDir}/src/utils.tsx`, 'export const App = () => {};');

    const files = findFiles(`${testDir}/src`).found;

    expect(files.length).toBeGreaterThanOrEqual(1);
    expect(files.some((f) => f.path.includes('index.ts'))).toBe(true);
  });

  test('should find JavaScript files', async () => {
    await writeFile(`${testDir}/src/index.js`, 'console.log("test");');
    await writeFile(`${testDir}/src/component.jsx`, 'export const App = () => {};');

    const files = findFiles(`${testDir}/src`).found;

    expect(files.length).toBeGreaterThanOrEqual(1);
  });

  test('keeps test files, tagged as development', async () => {
    await writeFile(`${testDir}/src/index.ts`, 'console.log("test");');
    await writeFile(`${testDir}/src/index.test.ts`, 'test("test", () => {});');

    const files = findFiles(`${testDir}/src`).found;

    expect(files.map((f) => [path.basename(f.path), f.context]).toSorted()).toEqual([
      ['index.test.ts', 'development'],
      ['index.ts', 'production'],
    ]);
  });

  test('classifies by the path below rootDir', async () => {
    const rootDir = `${testDir}/e2e/app`;
    await mkdir(`${rootDir}/src`, { recursive: true });
    await mkdir(`${rootDir}/e2e`, { recursive: true });
    await writeFile(`${rootDir}/src/index.ts`, 'console.log("app");');
    await writeFile(`${rootDir}/e2e/flow.ts`, 'console.log("e2e");');

    const files = findFiles(rootDir).found;

    expect(files.map((f) => [path.relative(rootDir, f.path), f.context]).toSorted()).toEqual([
      ['e2e/flow.ts', 'development'],
      ['src/index.ts', 'production'],
    ]);
  });

  test('skips a tsconfig outDir written with ./ even when a .gitignore exists', async () => {
    await mkdir(`${testDir}/lib`, { recursive: true });
    await writeFile(`${testDir}/.gitignore`, 'logs\n');
    await writeFile(`${testDir}/tsconfig.json`, '{ "compilerOptions": { "outDir": "./lib" } }');
    await writeFile(`${testDir}/src/index.ts`, '');
    await writeFile(`${testDir}/lib/index.js`, '');

    const files = findFiles(testDir).found;

    expect(files.map((f) => path.relative(testDir, f.path))).toEqual(['src/index.ts', 'tsconfig.json']);
  });

  test('excludes a detected outDir only at the project root', async () => {
    await mkdir(`${testDir}/lib`, { recursive: true });
    await mkdir(`${testDir}/src/lib`, { recursive: true });
    await writeFile(`${testDir}/tsconfig.json`, '{ "compilerOptions": { "outDir": "lib" } }');
    await writeFile(`${testDir}/lib/index.js`, '');
    await writeFile(`${testDir}/src/lib/util.ts`, '');

    const files = findFiles(testDir).found;

    expect(files.map((f) => path.relative(testDir, f.path))).toEqual(['src/lib/util.ts', 'tsconfig.json']);
  });

  test('takes --exclude paths written with ./ or as absolute paths under rootDir', async () => {
    await mkdir(`${testDir}/src/legacy`, { recursive: true });
    await mkdir(`${testDir}/src/old`, { recursive: true });
    await writeFile(`${testDir}/src/index.ts`, '');
    await writeFile(`${testDir}/src/legacy/x.ts`, '');
    await writeFile(`${testDir}/src/old/y.ts`, '');

    const files = findFiles(testDir, {
      excludePatterns: ['./src/legacy/**', `${path.resolve(testDir)}/src/old/**`],
    }).found;

    expect(files.map((f) => path.relative(testDir, f.path))).toEqual(['src/index.ts']);
  });

  test('reports an unreadable .gitignore and a broken tsconfig.json', async () => {
    await writeFile(`${testDir}/src/index.ts`, '');
    await writeFile(`${testDir}/src/.gitignore`, 'index.ts');
    await chmod(`${testDir}/src/.gitignore`, 0o000);
    await writeFile(`${testDir}/tsconfig.json`, '{ "compilerOptions": ');

    const { found, skipped } = findFiles(testDir);

    expect(found.map((f) => path.relative(testDir, f.path))).toEqual(['src/index.ts', 'tsconfig.json']);
    const relativeTo = (e: FileError) => path.relative(testDir, e.path);
    expect(skipped.filter(FileError.$is('ParseFailed')).map(relativeTo)).toEqual(['tsconfig.json']);
    expect(skipped.filter(FileError.$is('ReadFailed')).map(relativeTo)).toEqual(['src/.gitignore']);
    expect(skipped).toHaveLength(2);
  });

  test('includes hand-written .d.ts files', async () => {
    await writeFile(`${testDir}/src/index.d.ts`, 'export declare const x: number;');
    await writeFile(`${testDir}/src/types.d.mts`, 'export type T = string;');

    const files = findFiles(`${testDir}/src`).found;
    expect(files.length).toBe(2);
  });
});

describe('parseFile', () => {
  const testDir = './test-parse-file';

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  test('should return Ok with imports for valid file', async () => {
    const filePath = `${testDir}/test.ts`;
    await writeFile(filePath, "import { a } from 'pkg';");

    const result = parseFile({ path: filePath, context: 'production', emit: UNCONFIGURED, resolution: NO_RESOLUTION });
    expect(result.unreadable).toEqual([]);
    expect(result.imports[0]!.packageName).toBe('pkg');
  });

  test('should return Error for non-existent file', () => {
    const result = parseFile({ path: `${testDir}/non-existent.ts`, context: 'production', emit: UNCONFIGURED, resolution: NO_RESOLUTION });
    expect(result.imports).toEqual([]);
    expect(result.unreadable).toHaveLength(1);
  });
});

describe('parseMultipleFiles', () => {
  const testDir = './test-parse-multiple';

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  test('aggregates imports from multiple files, each tagged with its file context', async () => {
    await writeFile(`${testDir}/a.js`, "import { a } from 'pkg-a';");
    await writeFile(`${testDir}/b.js`, "import { b } from 'pkg-b';");

    const result = parseMultipleFiles([
      { path: `${testDir}/a.js`, context: 'production', emit: UNCONFIGURED, resolution: NO_RESOLUTION },
      { path: `${testDir}/b.js`, context: 'development', emit: UNCONFIGURED, resolution: NO_RESOLUTION },
    ]).imports;
    expect(result.map((r) => [r.packageName, r.context])).toEqual([
      ['pkg-a', 'production'],
      ['pkg-b', 'development'],
    ]);
  });

  test('keeps imports from readable files and reports the unreadable ones', async () => {
    await writeFile(`${testDir}/a.js`, "import { a } from 'pkg-a';");
    await mkdir(`${testDir}/dir.ts`);

    const result = parseMultipleFiles([
      { path: `${testDir}/a.js`, context: 'production', emit: UNCONFIGURED, resolution: NO_RESOLUTION },
      { path: `${testDir}/dir.ts`, context: 'production', emit: UNCONFIGURED, resolution: NO_RESOLUTION },
    ]);
    expect(result.imports.map((i) => i.packageName)).toEqual(['pkg-a']);
    expect(result.unreadable.map((e) => e.path)).toEqual([`${testDir}/dir.ts`]);
  });
});

describe('extractImports type/runtime classification', () => {
  test('should distinguish type-only from runtime imports', () => {
    const content = `
      import type { Pipe } from 'hotscript';
      import { pipe } from '@mobily/ts-belt';
      import React from 'react';
    `;
    const findings = extractImports(content, 'test.ts');

    expect(findings).toContainEqual(expect.objectContaining({ packageName: 'hotscript', importType: 'type-only' }));
    expect(findings).toContainEqual(expect.objectContaining({ packageName: '@mobily/ts-belt', importType: 'runtime' }));
    expect(findings).toContainEqual(expect.objectContaining({ packageName: 'react', importType: 'runtime' }));
    expect(findings).toHaveLength(3);
  });

  test('emits both runtime and type-only entries when a package is dual-imported', () => {
    const content = `
      import type { User } from 'user-lib';
      import { getUser } from 'user-lib';
    `;
    const findings = extractImports(content, 'test.ts');
    const userLibImports = findings.filter((f) => f.packageName === 'user-lib');

    expect(userLibImports).toHaveLength(2);
    expect(userLibImports).toContainEqual(expect.objectContaining({ importType: 'type-only' }));
    expect(userLibImports).toContainEqual(expect.objectContaining({ importType: 'runtime' }));
  });

  test('classifies "import { type X } from" as type-only', () => {
    const findings = extractImports(`import { type SomeType } from 'some-lib';`, 'test.ts');
    expect(findings).toContainEqual(expect.objectContaining({ packageName: 'some-lib', importType: 'type-only' }));
  });

  test('classifies mixed "import { type X, Y } from" as runtime', () => {
    const findings = extractImports(`import { type SomeType, someValue } from 'some-lib';`, 'test.ts');
    expect(findings).toContainEqual(expect.objectContaining({ packageName: 'some-lib', importType: 'runtime' }));
  });

  test('classifies "import { type O, F } from" as runtime', () => {
    const findings = extractImports(`import { type O, F } from '@mobily/ts-belt';`, 'test.ts');
    expect(findings).toContainEqual(expect.objectContaining({ packageName: '@mobily/ts-belt', importType: 'runtime' }));
  });

  test('extracts package name from deep imports correctly', () => {
    const content = `
      import 'core-js/actual';
      import { signIn } from 'next-auth/react';
      import map from 'lodash/map';
      import { Button } from '@radix-ui/react-dialog';
      import format from 'date-fns/format';
      import { of } from 'rxjs/operators';
    `;
    const names = extractImports(content, 'test.ts').map((f) => f.packageName);
    expect(names).toContain('core-js');
    expect(names).toContain('next-auth');
    expect(names).toContain('lodash');
    expect(names).toContain('@radix-ui/react-dialog');
    expect(names).toContain('date-fns');
    expect(names).toContain('rxjs');
  });

  test('reports each occurrence with its line number', () => {
    const content = `import A from 'pkg-a';\nimport B from 'pkg-b';`;
    const findings = extractImports(content, 'test.ts');

    const importA = findings.find((f) => f.packageName === 'pkg-a');
    expect(importA?.line).toBe(1);
    expect(importA?.file).toBe('test.ts');
    expect(importA?.importStatement).toContain("import A from 'pkg-a'");

    const importB = findings.find((f) => f.packageName === 'pkg-b');
    expect(importB?.line).toBe(2);
  });
});

describe('extractImports edge cases', () => {
  test('returns empty array for empty content', () => {
    expect(extractImports('', 'test.ts')).toEqual([]);
  });

  test('returns empty array for whitespace-only content', () => {
    expect(extractImports('   \n\n\t\n', 'test.ts')).toEqual([]);
  });

  test('returns empty array for comment-only content', () => {
    const content = `
      // import { fake } from 'should-not-appear';
      /* import another from 'also-should-not-appear'; */
      // 주석만 있는 파일
    `;
    expect(extractImports(content, 'test.ts')).toEqual([]);
  });

  test('records every occurrence of a duplicated import with distinct line numbers', () => {
    const content = ["import { a } from 'pkg';", "import { b } from 'pkg';", "import { c } from 'pkg';"].join('\n');
    const findings = extractImports(content, 'test.ts').filter((f) => f.packageName === 'pkg');
    expect(findings).toHaveLength(3);
    expect(findings.map((f) => f.line).toSorted()).toEqual([1, 2, 3]);
  });

  test('handles side-effect imports (no specifier)', () => {
    const findings = extractImports("import 'side-effect-pkg';", 'test.ts');
    expect(findings).toHaveLength(1);
    expect(findings[0]?.packageName).toBe('side-effect-pkg');
    expect(findings[0]?.importType).toBe('runtime');
  });

  test('handles single-quote and double-quote import paths identically', () => {
    const single = extractImports("import a from 'pkg-a';", 'test.ts');
    const dbl = extractImports('import a from "pkg-b";', 'test.ts');
    expect(single[0]?.packageName).toBe('pkg-a');
    expect(dbl[0]?.packageName).toBe('pkg-b');
  });

  test('keeps builtin-named imports so a declared polyfill (buffer, events) counts as used', () => {
    const names = extractImports("import { Buffer } from 'buffer';\nimport { EventEmitter } from 'events';", 'test.ts').map(
      (f) => f.packageName,
    );
    expect(names).toEqual(['buffer', 'events']);
  });

  test.each([
    ['export * re-export', "export * from 'pkg';", 'runtime'],
    ['export {} re-export', "export { a } from 'pkg';", 'runtime'],
    ['export type re-export', "export type { T } from 'pkg';", 'type-only'],
    ['literal dynamic import', "export const f = () => import('pkg');", 'runtime'],
    ['$ identifier', "import $ from 'pkg';", 'runtime'],
    ['trailing comma type specifiers', "import {\n  type A,\n  type B,\n} from 'pkg';", 'type-only'],
    ['import type = require', "import type T = require('pkg');", 'type-only'],
    ['/* inside a line comment', "// out/*\nimport a from 'other';\nconst b = require('pkg');\n/** doc */", 'runtime'],
    ['/* inside a string', "const g = 'lib/*';\nconst b = require('pkg');\n/** doc */", 'runtime'],
    ['// inside a string', "const u = 'http://x'; const b = require('pkg');", 'runtime'],
  ])('finds pkg through %s', (_, content, importType) => {
    expect(extractImports(content, 'test.ts').filter((f) => f.packageName === 'pkg')).toEqual([expect.objectContaining({ importType })]);
  });

  test('import text inside a template literal is not an import', () => {
    expect(extractImports("export const s = `import x from 'pkg'`;", 'test.ts')).toEqual([]);
  });

  test('handles imports preceded by a comment containing "//" (URL-like) on a different line', () => {
    const content = `// see http://example.com for context\nimport real from 'real-pkg';`;
    const findings = extractImports(content, 'test.ts');
    expect(findings.map((f) => f.packageName)).toContain('real-pkg');
  });

  test.each(['src/App.js', 'src/App.mjs', 'src/App.cjs'])('JSX in %s hides none of its imports', (file) => {
    const content =
      'import React from "react";\nconst App = () => <div className="a">hi</div>;\nimport { z } from "zod";\nconst c = require("clsx");';
    expect(extractImports(content, file).map((f) => f.packageName)).toEqual(['react', 'zod', 'clsx', 'react']);
  });

  test.each([
    ['require.resolve', 'const p = require.resolve("pkg/sub");'],
    ['module.require', 'const m = module.require("pkg");'],
    ['import.meta.resolve', 'const u = import.meta.resolve("pkg");'],
    ['a createRequire binding', 'import { createRequire } from "node:module";\nconst req = createRequire(import.meta.url);\nreq("pkg");'],
    ['a renamed createRequire', 'import { createRequire as cr } from "module";\nconst r = cr(import.meta.url);\nr("pkg");'],
    ['module.createRequire', 'import module from "node:module";\nconst r = module.createRequire(import.meta.url);\nr("pkg");'],
    ['a namespace createRequire', 'import * as m from "node:module";\nconst r = m.createRequire(import.meta.url);\nr.resolve("pkg");'],
    [
      'a createRequire read off a module object',
      'const m = process.getBuiltinModule?.("module");\nconst createRequire = m?.createRequire;\nconst r = createRequire(x);\nr("pkg");',
    ],
    ['a destructured createRequire', 'const { createRequire: make } = require("node:module");\nconst r = make(x);\nr("pkg");'],
    ['an inline createRequire', 'import { createRequire } from "node:module";\ncreateRequire(import.meta.url)("pkg");'],
    ['a static template require', 'const m = require(`pkg`);'],
    ['a static template import()', 'export const f = () => import(`pkg`);'],
    ['a parenthesised require', 'const m = require(("pkg"));'],
  ])('finds pkg at runtime through %s', (_, content) => {
    expect(extractImports(content, 'src/a.mjs').filter((f) => f.packageName === 'pkg')).toEqual([
      expect.objectContaining({ importType: 'runtime', line: content.split('\n').length }),
    ]);
  });

  test.each([
    ['require.resolve.paths', 'const p = require.resolve.paths("pkg");'],
    ['a call not bound to createRequire', 'const req = make(import.meta.url);\nreq("pkg");\nrequire("other");'],
    ['a createRequire from elsewhere', 'import { createRequire } from "other";\nconst r = createRequire(1);\nr("pkg");'],
    ['another node:module export', 'import * as m from "node:module";\nconst r = m.findPackageJSON(1);\nr("pkg");\nrequire("other");'],
    ['a template with an expression', 'const m = require(`pkg${suffix}`);\nimport(`pkg${suffix}`);'],
    ['two arguments', 'const m = require.resolve("pkg", {});'],
    ['a call on what another call returns', 'export const v = i18n("x")("pkg");\nrequire("other");'],
  ])('does not find pkg through %s', (_, content) => {
    expect(extractImports(content, 'src/a.mjs').filter((f) => f.packageName === 'pkg')).toEqual([]);
  });

  test('a deeply nested expression is walked without exhausting the stack', () => {
    const terms = Array.from({ length: 20_000 }, (_, i) => `"s${i}"`).join(' + ');
    const content = `// we do not require anything\nimport "zod";\nexport const x = ${terms};\nrequire("pkg");`;
    expect(extractImports(content, 'src/gen.ts').map((f) => f.packageName)).toEqual(['zod', 'pkg']);
  });

  test('require() counts as exactly one runtime finding (no duplicate from REQUIRE_REGEX)', () => {
    const result = extractImports("const m = require('lodash');", 'src/index.ts');
    const lodashEntries = result.filter((f) => f.packageName === 'lodash');
    expect(lodashEntries).toHaveLength(1);
    expect(lodashEntries[0]!.importType).toBe('runtime');
  });
});

describe('parseFile error paths', () => {
  const testDir = './test-parse-file-errors';

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  test('returns Error tagged FileNotFound for missing file', () => {
    const { unreadable } = parseFile({
      path: `${testDir}/missing.ts`,
      context: 'production',
      emit: UNCONFIGURED,
      resolution: NO_RESOLUTION,
    });
    expect(unreadable.map(FileError.$is('FileNotFound'))).toEqual([true]);
  });

  test('returns Error tagged ReadFailed when path is a directory', () => {
    const { unreadable } = parseFile({ path: testDir, context: 'production', emit: UNCONFIGURED, resolution: NO_RESOLUTION });
    expect(unreadable.map(FileError.$is('ReadFailed'))).toEqual([true]);
  });
});

describe('fileContextOf', () => {
  test.each([
    'playwright.config.ts',
    'next.config.mjs',
    'jest.preset.js',
    'webpack.config.prod.js',
    'vite.config.base.ts',
    '.eslintrc.cjs',
    'scripts/perf/lib/attach.ts',
    '.storybook/main.ts',
    '.github/scripts/release.js',
    'src/ui/.storybook/preview.tsx',
    'src/.eslintrc.js',
    'src/a.test.ts',
    'src/Button.stories.tsx',
    'src/happydom-setup.ts',
    'test/setup.ts',
    'src/features/__mocks__/api.ts',
    'e2e/flow.ts',
  ])('%s is development', (file) => {
    expect(fileContextOf([])({ path: file, layoutRoots: [''] })).toBe('development');
  });

  test.each([
    'src/index.ts',
    'src/config/app.config.ts',
    'src/scripts/analytics.ts',
    'src/build/index.ts',
    'src/.generated/client.ts',
    'src/features/stories/Carousel.ts',
    'tools/vite.config.ts',
    'scripts.ts',
  ])('%s is production', (file) => {
    expect(fileContextOf([])({ path: file, layoutRoots: [''] })).toBe('production');
  });

  test('a package.json bin target is production under scripts/', () => {
    expect(fileContextOf(['scripts/cli.js'])({ path: 'scripts/cli.js', layoutRoots: [''] })).toBe('production');
  });
});

describe('shouldAnalyzeFile', () => {
  test('analyzes sources, declaration files and tsconfig files', () => {
    expect(shouldAnalyzeFile('src/a.mts')).toBe(true);
    expect(shouldAnalyzeFile('src/b.cts')).toBe(true);
    expect(shouldAnalyzeFile('src/types.d.ts')).toBe(true);
    expect(shouldAnalyzeFile('src/a.d.mts')).toBe(true);
    expect(shouldAnalyzeFile('libs/x/tsconfig.lib.json')).toBe(true);
    expect(shouldAnalyzeFile('src/App.vue')).toBe(true);
    expect(shouldAnalyzeFile('src/App.svelte')).toBe(true);
    expect(shouldAnalyzeFile('src/pages/index.astro')).toBe(true);
    expect(['a.css', 'a.pcss', 'a.postcss', 'a.scss', 'a.less'].every(shouldAnalyzeFile)).toBe(true);
    expect(['a.sass', 'a.styl'].some(shouldAnalyzeFile)).toBe(false);
    expect(shouldAnalyzeFile('package.json')).toBe(false);
  });
});

const typeOnly = (content: string, file = 'src/a.ts') =>
  extractImports(content, file).map((found) => `${found.packageName}:${found.importType}:${found.line}`);

describe('extractImports type positions', () => {
  test('a type import sits beside an import() expression', () => {
    expect(typeOnly('export const lazy = () => import("lazy");\nexport type A = import("zod").ZodType;')).toEqual([
      'lazy:runtime:1',
      'zod:type-only:2',
    ]);
  });

  test('spacing before the parenthesis hides neither import form', () => {
    expect(typeOnly('export const lazy = () => import ("lazy");\nexport type A = import ("zod").ZodType;')).toEqual([
      'lazy:runtime:1',
      'zod:type-only:2',
    ]);
  });

  test('import("x") types and typeof import("x") are type-only', () => {
    expect(typeOnly('export type A = import("zod").ZodType;\nexport type B = typeof import("foo/sub");')).toEqual([
      'zod:type-only:1',
      'foo:type-only:2',
    ]);
  });

  test('JSDoc import("x") is type-only, a commented-out import() is not', () => {
    const content = '/** @type {import("express").Handler} */\nconst h = 1;\n/* import("left-over") */\nmodule.exports = h;';
    expect(typeOnly(content, 'src/a.js')).toEqual(['express:type-only:1']);
    expect(extractImports(content, 'src/a.js')[0]?.importStatement).toBe('import("express")');
  });

  test('a JSDoc @import tag is type-only', () => {
    const content = '/**\n * @import { A } from "alpha"\n * @import * as B from \'beta/sub\'\n */\nexport const f = (x) => x;';
    expect(typeOnly(content, 'src/a.js')).toEqual(['alpha:type-only:2', 'beta:type-only:3']);
  });

  test('/// <reference types> names a type-only package', () => {
    expect(typeOnly('/// <reference types="vite/client" />\nexport const x = 1;')).toEqual(['vite:type-only:1']);
  });

  test('/// <reference> finds types after another attribute', () => {
    expect(typeOnly('/// <reference resolution-mode="import" types="alpha" />\nexport {};')).toEqual(['alpha:type-only:1']);
  });

  test('a comment between import and its parenthesis hides no type import', () => {
    expect(typeOnly('export type A = import /* c */ ("zod").ZodType;')).toEqual(['zod:type-only:1']);
  });

  test('JSDoc prose that mentions import("x") outside a {type} is no usage', () => {
    const content = '/** Loads heavy lazily, e.g. import("heavy"). @type {Map<string, import("zod").ZodType>} */\nexport const v = 1;';
    expect(typeOnly(content, 'src/a.js')).toEqual(['zod:type-only:1']);
  });

  test('declare module is found with any whitespace between the keywords', () => {
    expect(typeOnly('export {};\ndeclare  module "express" {}')).toEqual(['express:type-only:2']);
  });

  test('declare module "x" counts in a module file, not in an ambient script', () => {
    expect(typeOnly('declare module "express" { interface Request { user?: string } }\nexport {};')).toEqual(['express:type-only:1']);
    expect(typeOnly('declare module "untyped-lib" { const x: number; }')).toEqual([]);
  });
});

const uses = (content: string, file: string, emit: EmitSettings = UNCONFIGURED, context: FileContext = 'production') =>
  extractIn(content, file, { context, emit, resolution: NO_RESOLUTION }).map(
    (found) => `${found.packageName}:${found.importType}:${found.line}`,
  );

const typesOf = (content: string) =>
  uses(content, 'test/a.test.js', UNCONFIGURED, 'development').filter((found) => found.startsWith('@types/'));

describe('extractImports test globals', () => {
  test('a development file calling describe/it/expect as globals uses the test runner types', () => {
    const content = 'describe("sum", () => {\n  it.each([1])("adds", (n) => expect(n).toBe(1));\n});';
    expect(uses(content, 'src/sum.test.ts', UNCONFIGURED, 'development')).toEqual([
      '@types/jest:type-only:1',
      '@types/mocha:type-only:1',
      '@types/jasmine:type-only:1',
    ]);
    expect(typesOf('it.each`a`("b", () => {});')).toHaveLength(3);
  });

  test('imported test functions and production files are no global use', () => {
    const imported = 'import { describe, it } from "vitest";\ndescribe("a", () => it("b", () => {}));';
    expect(uses(imported, 'src/a.test.ts', UNCONFIGURED, 'development')).toEqual(['vitest:runtime:1']);
    expect(uses('test("a", () => {});', 'src/a.ts')).toEqual([]);
  });

  test('comments, strings, member calls and locally bound names are no global use', () => {
    expect(typesOf('// run it (twice)\nconst s = "describe(";\n/x/.test("x");')).toEqual([]);
    expect(typesOf('const test = base.extend({});\ntest.describe("a", () => test("b", () => {}));')).toEqual([]);
    expect(typesOf('const { describe, it: spec } = require("node:test");\ndescribe("a", () => spec("b", () => {}));')).toEqual([]);
    expect(typesOf('function expect(v) { return v; }\nexport const run = (it) => it(expect(1));')).toEqual([]);
  });

  test('a name bound in one scope leaves the global of that name in the others', () => {
    expect(
      typesOf('test("sums", () => {\n  const expect = (v) => v;\n  expect(1);\n});\nconst rows = [1].map((test) => test);'),
    ).toHaveLength(3);
    expect(typesOf('for (const it of [1]) { it(); }\nit("runs", () => {});')).toHaveLength(3);
    expect(typesOf('function f() { function test() {} test(); }\ntry {} catch (expect) { expect(); }')).toEqual([]);
    const scoped = [
      'function helper() { const it = 1; return it; }',
      'class C { static { const it = 1; } }',
      'for (let it = 0; it < 1; it++) {}',
      'for (const it in {}) {}',
      'switch (1) { case 1: const it = 1; }',
    ];
    expect(scoped.map((declared) => typesOf(`${declared}\nit("runs", () => {});`).length)).toEqual([3, 3, 3, 3, 3]);
    const bound = [
      'class expect {}\nexpect(1);',
      'const run = function it() { it(); };',
      'function f(expect) { expect(1); }',
      'const f = ([expect]) => expect(1);',
      'const f = (expect = 1) => expect(1);',
      'const f = (...expect) => expect(1);',
    ];
    expect(bound.map((source) => typesOf(source).length)).toEqual([0, 0, 0, 0, 0, 0]);
    const aliased = 'import expect = require("chai");\nexpect(1);';
    expect(uses(aliased, 'src/a.test.ts', UNCONFIGURED, 'development').filter((found) => found.startsWith('@types/'))).toEqual([]);
  });
});

describe('extractImports JSX runtime', () => {
  test('JSX is a runtime import of react/jsx-runtime, even beside a type-only react import', () => {
    const content = 'import type { FC } from "react";\nexport const A: FC = () => (\n  <div>hi</div>\n);';
    expect(uses(content, 'src/A.tsx')).toEqual(['react:type-only:1', 'react:runtime:3']);
    expect(extractImports(content, 'src/A.tsx')[1]?.importStatement).toBe('<div>hi</div>');
  });

  test('a @jsxImportSource pragma overrides the source the settings name', () => {
    const emit: EmitSettings = { ...UNCONFIGURED, jsx: [JsxRuntime.Automatic({ importSource: '@emotion/react' })] };
    expect(uses('/** @jsxImportSource preact */\nexport const A = () => <></>;', 'src/A.jsx', emit)).toEqual(['preact:runtime:2']);
    expect(uses('export const A = () => <b />;', 'src/A.js', emit)).toEqual(['@emotion/react:runtime:1']);
  });

  test('no runtime import without JSX or under the classic runtime', () => {
    expect(uses('export const lt = (a: number) => a < 2;\nexport const id = <T,>(v: T) => v;', 'src/a.tsx')).toEqual([]);
    expect(uses('const _ = require("lodash");\nif (_.a < 1) return;', 'src/x.js')).toEqual(['lodash:runtime:1']);
    expect(
      uses('export const A = () => <div />;', 'src/A.tsx', { ...UNCONFIGURED, jsx: [JsxRuntime.Classic({ factory: 'React' })] }),
    ).toEqual([]);
  });

  test('a @jsxRuntime pragma switches the file to that runtime', () => {
    const emotion = "/** @jsxRuntime classic */\n/** @jsx jsx */\nimport { jsx } from '@emotion/react';\nexport const A = () => <div />;";
    expect(uses(emotion, 'src/A.tsx')).toEqual(['@emotion/react:runtime:3']);
    const automatic = '/** @jsxRuntime automatic */\nexport const A = () => <div />;';
    expect(uses(automatic, 'src/A.tsx', { ...UNCONFIGURED, jsx: [JsxRuntime.Classic({ factory: 'React' })] })).toEqual(['react:runtime:2']);
  });
});

describe('extractImports under verbatimModuleSyntax', () => {
  const content = [
    'import { type Meta } from "reflect-x";',
    'import type { B } from "b";',
    'export { type C } from "c";',
    'export type { D } from "d";',
    'import type E from "e";',
  ].join('\n');

  test('only `import type` and `export type` are erased', () => {
    expect(uses(content, 'src/a.ts', { ...UNCONFIGURED, elision: 'verbatim' })).toEqual([
      'reflect-x:runtime:1',
      'b:type-only:2',
      'e:type-only:5',
      'c:runtime:3',
      'd:type-only:4',
    ]);
  });

  test('without it, inline type specifiers are erased too', () => {
    expect(uses(content, 'src/a.ts')).toEqual([
      'reflect-x:type-only:1',
      'b:type-only:2',
      'e:type-only:5',
      'c:type-only:3',
      'd:type-only:4',
    ]);
  });
});

describe('parseFile source kinds', () => {
  const testDir = './test-parse-file-kinds';

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  const parsed = (file: string) =>
    parseFile({ path: `${testDir}/${file}`, context: 'production', emit: UNCONFIGURED, resolution: NO_RESOLUTION }).imports.map(
      (found) => `${found.packageName}:${found.importType}:${found.context}`,
    );

  test('a declaration file contributes type-only usage in its own context', async () => {
    await writeFile(`${testDir}/types.d.ts`, "import { Properties } from 'csstype';\nexport type P = Properties;");
    expect(parsed('types.d.ts')).toEqual(['csstype:type-only:production', 'typescript:runtime:development']);
  });

  test('TypeScript sources and tsconfig files are development usage of typescript, JavaScript is not', async () => {
    await writeFile(`${testDir}/a.ts`, "import x from 'pkg';");
    await writeFile(`${testDir}/b.js`, "import x from 'pkg';");
    await writeFile(`${testDir}/tsconfig.app.json`, '{}');
    expect(parsed('a.ts')).toEqual(['pkg:runtime:production', 'typescript:runtime:development']);
    expect(parsed('b.js')).toEqual(['pkg:runtime:production']);
    expect(parsed('tsconfig.app.json')).toEqual(['typescript:runtime:development']);
  });

  const located = (file: string) =>
    parseFile({ path: `${testDir}/${file}`, context: 'production', emit: UNCONFIGURED, resolution: NO_RESOLUTION }).imports.map(
      (found) => `${found.line}:${found.packageName}:${found.importType}:${found.importStatement}`,
    );

  test('a Vue component contributes the imports of each script block, parsed in its lang', async () => {
    await writeFile(
      `${testDir}/App.vue`,
      [
        '<template><div>{{ a < b }}</div></template>',
        '<script lang="ts">',
        "import type { Store } from 'pinia';",
        '</script>',
        '<script setup lang="ts">',
        "import dayjs from 'dayjs';",
        'const year: number = dayjs().year();',
        '</script>',
      ].join('\n'),
    );
    expect(located('App.vue')).toEqual([
      "3:pinia:type-only:import type { Store } from 'pinia';",
      "6:dayjs:runtime:import dayjs from 'dayjs';",
      '1:vue:runtime:App.vue',
    ]);
  });

  test('a Svelte component contributes its instance and module scripts', async () => {
    await writeFile(
      `${testDir}/App.svelte`,
      [
        '<script context="module">',
        "import { nanoid } from 'nanoid';",
        '</script>',
        '<script lang="ts">',
        "import { onMount } from 'svelte';",
        '</script>',
        '<p>{nanoid()}</p>',
      ].join('\n'),
    );
    expect(located('App.svelte')).toEqual([
      "2:nanoid:runtime:import { nanoid } from 'nanoid';",
      "5:svelte:runtime:import { onMount } from 'svelte';",
      '1:svelte:runtime:App.svelte',
    ]);
  });

  test('an Astro component contributes its frontmatter and script tags', async () => {
    await writeFile(
      `${testDir}/page.astro`,
      [
        '---',
        "import clsx from 'clsx';",
        'const c: string = clsx();',
        '---',
        '<h1 class={c}>x</h1>',
        '<script>',
        "import 'date-fns';",
        '</script>',
      ].join('\n'),
    );
    expect(located('page.astro')).toEqual([
      "2:clsx:runtime:import clsx from 'clsx';",
      "7:date-fns:runtime:import 'date-fns';",
      '1:astro:runtime:page.astro',
    ]);
  });

  test('a stylesheet contributes the packages its at-rules load', async () => {
    await writeFile(`${testDir}/app.scss`, "// theme\n@use '~bulma/sass' as b;");
    await writeFile(`${testDir}/app.less`, "// theme\n@import (reference) 'antd/lib/style';\n.a { .mixin(); }");
    expect(located('app.scss')).toEqual(["2:bulma:runtime:@use '~bulma/sass' as b"]);
    expect(located('app.less')).toEqual(["2:antd:runtime:@import (reference) 'antd/lib/style'"]);
  });

  test('what @plugin, @config and @reference load is build tooling, what @import loads is content', async () => {
    await writeFile(
      `${testDir}/app.css`,
      ['@import "tailwindcss";', '@plugin "daisyui";', '@config "tw-config";', '@reference "tw-theme";'].join('\n'),
    );
    expect(parsed('app.css')).toEqual([
      'tailwindcss:runtime:production',
      'daisyui:runtime:development',
      'tw-config:runtime:development',
      'tw-theme:runtime:development',
    ]);
  });

  test('a Vue component reads <script lang="tsx"> as TSX and <style lang="less"> as Less', async () => {
    await writeFile(
      `${testDir}/C.vue`,
      [
        '<script lang="tsx">',
        "import c from 'pkg-c';",
        "import type { T } from 'pkg-t';",
        '</script>',
        '<style lang="less">',
        "@import 'pkg-d';",
        '.a { .mixin(); }',
        '</style>',
      ].join('\n'),
    );
    expect(located('C.vue')).toEqual([
      "2:pkg-c:runtime:import c from 'pkg-c';",
      "3:pkg-t:type-only:import type { T } from 'pkg-t';",
      '1:vue:runtime:C.vue',
      "6:pkg-d:runtime:@import 'pkg-d'",
    ]);
  });

  test('a component contributes its style blocks in their lang, and skips Sass and Stylus', async () => {
    await writeFile(
      `${testDir}/App.vue`,
      [
        '<template><p/></template>',
        '<style lang="scss" scoped>',
        "@import 'normalize.css';",
        '.a { .b { color: red; } }',
        '</style>',
        '<style lang="sass">',
        "@import 'bourbon'",
        '</style>',
        '<style>',
        "@import url('animate.css');",
        '</style>',
      ].join('\n'),
    );
    expect(located('App.vue')).toEqual([
      '1:vue:runtime:App.vue',
      "3:normalize.css:runtime:@import 'normalize.css'",
      "10:animate.css:runtime:@import url('animate.css')",
    ]);
  });

  test('a style block that does not parse is skipped alone, and the scripts still count', async () => {
    const file = `${testDir}/App.svelte`;
    await writeFile(file, "<script>\nimport 'nanoid';\n</script>\n<style>\n.a { color: red\n</style>");
    const { imports, unreadable } = parseMultipleFiles([
      { path: file, context: 'production', emit: UNCONFIGURED, resolution: NO_RESOLUTION },
    ]);
    expect(imports.map((found) => found.packageName)).toContain('nanoid');
    expect(unreadable.map(formatSkippedSource)).toEqual([
      MESSAGES.SOURCE_SKIPPED(MESSAGES.STYLE_BLOCK_OF(file), MESSAGES.PARSE_FAILED_AT('Unclosed block', 5)),
    ]);
  });

  test.each([
    ['App.vue', 'vue'],
    ['App.svelte', 'svelte'],
    ['page.astro', 'astro'],
  ])('%s uses %s, which its compiled output imports', async (file, framework) => {
    await writeFile(`${testDir}/${file}`, '<p>x</p>\n');
    expect(located(file)).toEqual([`1:${framework}:runtime:${file}`]);
  });
});
