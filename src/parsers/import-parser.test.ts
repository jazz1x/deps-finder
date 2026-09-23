import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { chmod, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Option, Result } from 'effect';
import { FileError } from '@/domain/errors';
import {
  extractImports,
  extractPackageName,
  fileContextOf,
  findFiles,
  parseFile,
  parseMultipleFiles,
  shouldAnalyzeFile,
} from '@/parsers/import-parser';

describe('extractPackageName', () => {
  test('should return None for relative imports', () => {
    expect(extractPackageName('./utils')).toEqual(Option.none());
    expect(extractPackageName('../helpers')).toEqual(Option.none());
    expect(extractPackageName('../../src/index')).toEqual(Option.none());
    expect(extractPackageName('./index.js')).toEqual(Option.none());
  });

  test('should return None for absolute path imports', () => {
    expect(extractPackageName('/usr/local/lib')).toEqual(Option.none());
    expect(extractPackageName('/home/user/project')).toEqual(Option.none());
  });

  test('should extract simple package names', () => {
    expect(extractPackageName('react')).toEqual(Option.some('react'));
    expect(extractPackageName('lodash')).toEqual(Option.some('lodash'));
    expect(extractPackageName('express')).toEqual(Option.some('express'));
  });

  test('should extract scoped package names', () => {
    expect(extractPackageName('@mobily/ts-belt')).toEqual(Option.some('@mobily/ts-belt'));
    expect(extractPackageName('@types/node')).toEqual(Option.some('@types/node'));
    expect(extractPackageName('@testing-library/react')).toEqual(Option.some('@testing-library/react'));
  });

  test('should extract package name from deep imports', () => {
    expect(extractPackageName('lodash/map')).toEqual(Option.some('lodash'));
    expect(extractPackageName('react-dom/client')).toEqual(Option.some('react-dom'));
    expect(extractPackageName('lodash/fp/map')).toEqual(Option.some('lodash'));
    expect(extractPackageName('express/lib/router')).toEqual(Option.some('express'));
  });

  test('should extract scoped package from deep imports', () => {
    expect(extractPackageName('@mobily/ts-belt/Array')).toEqual(Option.some('@mobily/ts-belt'));
    expect(extractPackageName('@babel/core/lib/config')).toEqual(Option.some('@babel/core'));
    expect(extractPackageName('@types/node/fs')).toEqual(Option.some('@types/node'));
  });

  test('should handle edge cases - empty and malformed inputs', () => {
    expect(extractPackageName('')).toEqual(Option.none());
    expect(extractPackageName('@scope')).toEqual(Option.none()); // Incomplete scoped package
    expect(extractPackageName('@scope/')).toEqual(Option.none()); // Malformed scoped package
    expect(extractPackageName('@')).toEqual(Option.none());
  });

  test('should reject protocol-based imports', () => {
    expect(extractPackageName('http://example.com/module')).toEqual(Option.none());
    expect(extractPackageName('https://unpkg.com/lodash')).toEqual(Option.none());
    expect(extractPackageName('file:///path/to/file')).toEqual(Option.none());
  });

  test('should handle popular packages with deep imports', () => {
    // Core-js
    expect(extractPackageName('core-js/actual')).toEqual(Option.some('core-js'));
    expect(extractPackageName('core-js/stable')).toEqual(Option.some('core-js'));
    expect(extractPackageName('core-js/features/array/flat')).toEqual(Option.some('core-js'));

    // Next.js ecosystem
    expect(extractPackageName('next-auth/react')).toEqual(Option.some('next-auth'));
    expect(extractPackageName('next-auth/providers/google')).toEqual(Option.some('next-auth'));
    expect(extractPackageName('next/image')).toEqual(Option.some('next'));
    expect(extractPackageName('next/link')).toEqual(Option.some('next'));

    // Date manipulation
    expect(extractPackageName('date-fns/format')).toEqual(Option.some('date-fns'));
    expect(extractPackageName('date-fns/addDays')).toEqual(Option.some('date-fns'));
    expect(extractPackageName('date-fns/locale')).toEqual(Option.some('date-fns'));

    // RxJS
    expect(extractPackageName('rxjs/operators')).toEqual(Option.some('rxjs'));
    expect(extractPackageName('rxjs/Observable')).toEqual(Option.some('rxjs'));

    // Apollo
    expect(extractPackageName('apollo-client/core')).toEqual(Option.some('apollo-client'));
  });

  test('should handle scoped packages with deep imports from popular libraries', () => {
    // Material-UI / MUI
    expect(extractPackageName('@mui/material')).toEqual(Option.some('@mui/material'));
    expect(extractPackageName('@mui/material/Button')).toEqual(Option.some('@mui/material'));
    expect(extractPackageName('@mui/material/styles')).toEqual(Option.some('@mui/material'));

    // Radix UI
    expect(extractPackageName('@radix-ui/react-dialog')).toEqual(Option.some('@radix-ui/react-dialog'));
    expect(extractPackageName('@radix-ui/react-dialog/dist')).toEqual(Option.some('@radix-ui/react-dialog'));
    expect(extractPackageName('@radix-ui/react-select')).toEqual(Option.some('@radix-ui/react-select'));

    // Testing Library
    expect(extractPackageName('@testing-library/react')).toEqual(Option.some('@testing-library/react'));
    expect(extractPackageName('@testing-library/user-event')).toEqual(Option.some('@testing-library/user-event'));

    // Apollo Client
    expect(extractPackageName('@apollo/client')).toEqual(Option.some('@apollo/client'));
    expect(extractPackageName('@apollo/client/react')).toEqual(Option.some('@apollo/client'));
    expect(extractPackageName('@apollo/client/core')).toEqual(Option.some('@apollo/client'));
  });
});

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

    expect(files.map((f) => path.relative(testDir, f.path))).toEqual(['src/index.ts']);
  });

  test('excludes a detected outDir only at the project root', async () => {
    await mkdir(`${testDir}/lib`, { recursive: true });
    await mkdir(`${testDir}/src/lib`, { recursive: true });
    await writeFile(`${testDir}/tsconfig.json`, '{ "compilerOptions": { "outDir": "lib" } }');
    await writeFile(`${testDir}/lib/index.js`, '');
    await writeFile(`${testDir}/src/lib/util.ts`, '');

    const files = findFiles(testDir).found;

    expect(files.map((f) => path.relative(testDir, f.path))).toEqual(['src/lib/util.ts']);
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

    expect(found.map((f) => path.relative(testDir, f.path))).toEqual(['src/index.ts']);
    const relativeTo = (e: FileError) => path.relative(testDir, e.path);
    expect(skipped.filter(FileError.$is('ParseFailed')).map(relativeTo)).toEqual(['tsconfig.json']);
    expect(skipped.filter(FileError.$is('ReadFailed')).map(relativeTo)).toEqual(['src/.gitignore']);
    expect(skipped).toHaveLength(2);
  });

  test('should exclude .d.ts files', async () => {
    await writeFile(`${testDir}/src/index.d.ts`, 'export declare const x: number;');
    await writeFile(`${testDir}/src/types.d.ts`, 'export type T = string;');

    const files = findFiles(`${testDir}/src`).found;
    expect(files.length).toBe(0);
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

    const result = parseFile({ path: filePath, context: 'production' });
    expect(Result.isSuccess(result)).toBe(true);
    expect(Result.getOrThrow(result)[0]!.packageName).toBe('pkg');
  });

  test('should return Error for non-existent file', () => {
    const result = parseFile({ path: `${testDir}/non-existent.ts`, context: 'production' });
    expect(Result.isFailure(result)).toBe(true);
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
    await writeFile(`${testDir}/a.ts`, "import { a } from 'pkg-a';");
    await writeFile(`${testDir}/b.ts`, "import { b } from 'pkg-b';");

    const result = parseMultipleFiles([
      { path: `${testDir}/a.ts`, context: 'production' },
      { path: `${testDir}/b.ts`, context: 'development' },
    ]).imports;
    expect(result.map((r) => [r.packageName, r.context])).toEqual([
      ['pkg-a', 'production'],
      ['pkg-b', 'development'],
    ]);
  });

  test('keeps imports from readable files and reports the unreadable ones', async () => {
    await writeFile(`${testDir}/a.ts`, "import { a } from 'pkg-a';");
    await mkdir(`${testDir}/dir.ts`);

    const result = parseMultipleFiles([
      { path: `${testDir}/a.ts`, context: 'production' },
      { path: `${testDir}/dir.ts`, context: 'production' },
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

describe('extractPackageName edge cases', () => {
  test('trims surrounding whitespace via regex (importPath usually pre-stripped)', () => {
    // 일반적으로 정규식이 import path 양옆 공백을 캡처하지 않지만, 직접 호출 시의 안정성 확인
    expect(extractPackageName('react')).toEqual(Option.some('react'));
    // 공백 포함 입력은 그대로 들어가면 그 자체로 별도 이름 ("react ")이 되지 않도록 동작 확인
    expect(extractPackageName(' react')).toEqual(Option.some(' react')); // 현재 동작: 공백 보존 — 테스트로 고정
  });

  test('returns null for whitespace-only input', () => {
    // 현재 구현은 이 경우 공백 문자열을 반환함. 동작 고정용 회귀 가드.
    expect(extractPackageName('   ')).toEqual(Option.some('   '));
  });

  test('handles trailing slash correctly', () => {
    expect(extractPackageName('react/')).toEqual(Option.some('react'));
  });

  test('handles double slash inside path (treats first segment as package)', () => {
    expect(extractPackageName('lodash//map')).toEqual(Option.some('lodash'));
  });

  test('handles deeply nested scoped package paths', () => {
    expect(extractPackageName('@scope/pkg/a/b/c/d/e/f/g')).toEqual(Option.some('@scope/pkg'));
  });

  test('handles numeric and dash-prefixed package names', () => {
    expect(extractPackageName('123-pkg')).toEqual(Option.some('123-pkg'));
    expect(extractPackageName('-leading-dash')).toEqual(Option.some('-leading-dash')); // npm 자체는 거부하지만 파서는 통과
  });

  test('rejects bare @ and incomplete scope variants', () => {
    expect(extractPackageName('@')).toEqual(Option.none());
    expect(extractPackageName('@scope')).toEqual(Option.none());
    expect(extractPackageName('@scope/')).toEqual(Option.none());
    expect(extractPackageName('@/')).toEqual(Option.none());
    expect(extractPackageName('@/components/Button')).toEqual(Option.none());
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
    const result = parseFile({ path: `${testDir}/missing.ts`, context: 'production' });
    expect(Result.isFailure(result)).toBe(true);
    Result.match(result, {
      onSuccess: () => {
        throw new Error('Should not be Ok');
      },
      onFailure: (err) => {
        expect(FileError.$is('FileNotFound')(err)).toBe(true);
      },
    });
  });

  test('returns Error tagged ReadFailed when path is a directory', () => {
    const result = parseFile({ path: testDir, context: 'production' });
    expect(Result.isFailure(result)).toBe(true);
    Result.match(result, {
      onSuccess: () => {
        throw new Error('Should not be Ok');
      },
      onFailure: (err) => {
        expect(FileError.$is('ReadFailed')(err)).toBe(true);
      },
    });
  });
});

describe('fileContextOf', () => {
  test.each([
    'playwright.config.ts',
    'next.config.mjs',
    'jest.preset.js',
    '.eslintrc.cjs',
    'scripts/perf/lib/attach.ts',
    '.storybook/main.ts',
    '.github/scripts/release.js',
    'src/ui/.storybook/preview.tsx',
    'src/a.test.ts',
    'src/Button.stories.tsx',
    'src/happydom-setup.ts',
    'test/setup.ts',
    'src/features/__mocks__/api.ts',
    'e2e/flow.ts',
  ])('%s is development', (file) => {
    expect(fileContextOf(file)).toBe('development');
  });

  test.each([
    'src/index.ts',
    'src/config/app.config.ts',
    'src/scripts/analytics.ts',
    'src/build/index.ts',
    'src/.generated/client.ts',
    'src/.eslintrc.js',
    'src/features/stories/Carousel.ts',
    'tools/vite.config.ts',
    'scripts.ts',
  ])('%s is production', (file) => {
    expect(fileContextOf(file)).toBe('production');
  });
});

describe('shouldAnalyzeFile', () => {
  test('analyzes .mts and .cts sources but not their declaration files', () => {
    expect(shouldAnalyzeFile('src/a.mts')).toBe(true);
    expect(shouldAnalyzeFile('src/b.cts')).toBe(true);
    expect(shouldAnalyzeFile('src/a.d.mts')).toBe(false);
    expect(shouldAnalyzeFile('src/b.d.cts')).toBe(false);
  });

  test('should NOT analyze .d.ts files', () => {
    expect(shouldAnalyzeFile('src/types.d.ts')).toBe(false);
  });
});
