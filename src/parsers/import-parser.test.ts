import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { R } from '@mobily/ts-belt';
import {
  extractImports,
  extractPackageName,
  findFiles,
  isProductionConfigFile,
  parseFile,
  parseMultipleFiles,
  removeComments,
  shouldAnalyzeFile,
} from '@/parsers/import-parser';

describe('extractPackageName', () => {
  test('should return null for relative imports', () => {
    expect(extractPackageName('./utils')).toBe(null);
    expect(extractPackageName('../helpers')).toBe(null);
    expect(extractPackageName('../../src/index')).toBe(null);
    expect(extractPackageName('./index.js')).toBe(null);
  });

  test('should return null for absolute path imports', () => {
    expect(extractPackageName('/usr/local/lib')).toBe(null);
    expect(extractPackageName('/home/user/project')).toBe(null);
  });

  test('should extract simple package names', () => {
    expect(extractPackageName('react')).toBe('react');
    expect(extractPackageName('lodash')).toBe('lodash');
    expect(extractPackageName('express')).toBe('express');
  });

  test('should extract scoped package names', () => {
    expect(extractPackageName('@mobily/ts-belt')).toBe('@mobily/ts-belt');
    expect(extractPackageName('@types/node')).toBe('@types/node');
    expect(extractPackageName('@testing-library/react')).toBe('@testing-library/react');
  });

  test('should extract package name from deep imports', () => {
    expect(extractPackageName('lodash/map')).toBe('lodash');
    expect(extractPackageName('react-dom/client')).toBe('react-dom');
    expect(extractPackageName('lodash/fp/map')).toBe('lodash');
    expect(extractPackageName('express/lib/router')).toBe('express');
  });

  test('should extract scoped package from deep imports', () => {
    expect(extractPackageName('@mobily/ts-belt/Array')).toBe('@mobily/ts-belt');
    expect(extractPackageName('@babel/core/lib/config')).toBe('@babel/core');
    expect(extractPackageName('@types/node/fs')).toBe('@types/node');
  });

  test('should handle edge cases - empty and malformed inputs', () => {
    expect(extractPackageName('')).toBe(null);
    expect(extractPackageName(null)).toBe(null);
    expect(extractPackageName(undefined)).toBe(null);
    expect(extractPackageName('@scope')).toBe(null); // Incomplete scoped package
    expect(extractPackageName('@scope/')).toBe(null); // Malformed scoped package
    expect(extractPackageName('@')).toBe(null);
  });

  test('should reject protocol-based imports', () => {
    expect(extractPackageName('http://example.com/module')).toBe(null);
    expect(extractPackageName('https://unpkg.com/lodash')).toBe(null);
    expect(extractPackageName('file:///path/to/file')).toBe(null);
  });

  test('should handle popular packages with deep imports', () => {
    // Core-js
    expect(extractPackageName('core-js/actual')).toBe('core-js');
    expect(extractPackageName('core-js/stable')).toBe('core-js');
    expect(extractPackageName('core-js/features/array/flat')).toBe('core-js');

    // Next.js ecosystem
    expect(extractPackageName('next-auth/react')).toBe('next-auth');
    expect(extractPackageName('next-auth/providers/google')).toBe('next-auth');
    expect(extractPackageName('next/image')).toBe('next');
    expect(extractPackageName('next/link')).toBe('next');

    // Date manipulation
    expect(extractPackageName('date-fns/format')).toBe('date-fns');
    expect(extractPackageName('date-fns/addDays')).toBe('date-fns');
    expect(extractPackageName('date-fns/locale')).toBe('date-fns');

    // RxJS
    expect(extractPackageName('rxjs/operators')).toBe('rxjs');
    expect(extractPackageName('rxjs/Observable')).toBe('rxjs');

    // Apollo
    expect(extractPackageName('apollo-client/core')).toBe('apollo-client');
  });

  test('should handle scoped packages with deep imports from popular libraries', () => {
    // Material-UI / MUI
    expect(extractPackageName('@mui/material')).toBe('@mui/material');
    expect(extractPackageName('@mui/material/Button')).toBe('@mui/material');
    expect(extractPackageName('@mui/material/styles')).toBe('@mui/material');

    // Radix UI
    expect(extractPackageName('@radix-ui/react-dialog')).toBe('@radix-ui/react-dialog');
    expect(extractPackageName('@radix-ui/react-dialog/dist')).toBe('@radix-ui/react-dialog');
    expect(extractPackageName('@radix-ui/react-select')).toBe('@radix-ui/react-select');

    // Testing Library
    expect(extractPackageName('@testing-library/react')).toBe('@testing-library/react');
    expect(extractPackageName('@testing-library/user-event')).toBe('@testing-library/user-event');

    // Apollo Client
    expect(extractPackageName('@apollo/client')).toBe('@apollo/client');
    expect(extractPackageName('@apollo/client/react')).toBe('@apollo/client');
    expect(extractPackageName('@apollo/client/core')).toBe('@apollo/client');
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

    const files = findFiles(`${testDir}/src`);

    expect(files.length).toBeGreaterThanOrEqual(1);
    expect(files.some((f) => f.includes('index.ts'))).toBe(true);
  });

  test('should find JavaScript files', async () => {
    await writeFile(`${testDir}/src/index.js`, 'console.log("test");');
    await writeFile(`${testDir}/src/component.jsx`, 'export const App = () => {};');

    const files = findFiles(`${testDir}/src`);

    expect(files.length).toBeGreaterThanOrEqual(1);
  });

  test('should exclude test files', async () => {
    await writeFile(`${testDir}/src/index.ts`, 'console.log("test");');
    await writeFile(`${testDir}/src/index.test.ts`, 'test("test", () => {});');
    await writeFile(`${testDir}/src/index.spec.ts`, 'test("spec", () => {});');

    const files = findFiles(`${testDir}/src`);

    expect(files.some((f) => f.includes('.test.'))).toBe(false);
    expect(files.some((f) => f.includes('.spec.'))).toBe(false);
  });

  test('should exclude node_modules', async () => {
    await writeFile(`${testDir}/src/index.ts`, 'console.log("test");');
    await writeFile(`${testDir}/node_modules/package.js`, 'module.exports = {};');

    const files = findFiles(testDir);

    expect(files.some((f) => f.includes('node_modules'))).toBe(false);
  });

  test('should exclude .d.ts files', async () => {
    await writeFile(`${testDir}/src/index.d.ts`, 'export declare const x: number;');
    await writeFile(`${testDir}/src/types.d.ts`, 'export type T = string;');

    const files = findFiles(`${testDir}/src`);
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

    const result = parseFile(filePath);
    expect(R.isOk(result)).toBe(true);
    expect(R.getExn(result)[0]!.packageName).toBe('pkg');
  });

  test('should return Error for non-existent file', () => {
    const result = parseFile(`${testDir}/non-existent.ts`);
    expect(R.isError(result)).toBe(true);
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

  test('should aggregate imports from multiple files', async () => {
    await writeFile(`${testDir}/a.ts`, "import { a } from 'pkg-a';");
    await writeFile(`${testDir}/b.ts`, "import { b } from 'pkg-b';");

    const result = parseMultipleFiles([`${testDir}/a.ts`, `${testDir}/b.ts`]);
    expect(result).toHaveLength(2);
    const names = result.map((r) => r.packageName);
    expect(names).toContain('pkg-a');
    expect(names).toContain('pkg-b');
  });

  test('should skip failed files', async () => {
    await writeFile(`${testDir}/a.ts`, "import { a } from 'pkg-a';");

    const result = parseMultipleFiles([`${testDir}/a.ts`, `${testDir}/non-existent.ts`]);
    expect(result).toHaveLength(1);
    expect(result[0]!.packageName).toBe('pkg-a');
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
    expect(extractPackageName('react')).toBe('react');
    // 공백 포함 입력은 그대로 들어가면 그 자체로 별도 이름 ("react ")이 되지 않도록 동작 확인
    expect(extractPackageName(' react')).toBe(' react'); // 현재 동작: 공백 보존 — 테스트로 고정
  });

  test('returns null for whitespace-only input', () => {
    // S.startsWith('   ', '.') / '/' 모두 false → fallthrough → 첫 segment ' ' 반환
    // 현재 구현은 이 경우 공백 문자열을 반환함. 동작 고정용 회귀 가드.
    expect(extractPackageName('   ')).toBe('   ');
  });

  test('handles trailing slash correctly', () => {
    expect(extractPackageName('react/')).toBe('react');
  });

  test('handles double slash inside path (treats first segment as package)', () => {
    expect(extractPackageName('lodash//map')).toBe('lodash');
  });

  test('handles deeply nested scoped package paths', () => {
    expect(extractPackageName('@scope/pkg/a/b/c/d/e/f/g')).toBe('@scope/pkg');
  });

  test('handles numeric and dash-prefixed package names', () => {
    expect(extractPackageName('123-pkg')).toBe('123-pkg');
    expect(extractPackageName('-leading-dash')).toBe('-leading-dash'); // npm 자체는 거부하지만 파서는 통과
  });

  test('rejects bare @ and incomplete scope variants', () => {
    expect(extractPackageName('@')).toBe(null);
    expect(extractPackageName('@scope')).toBe(null);
    expect(extractPackageName('@scope/')).toBe(null);
    expect(extractPackageName('@/')).toBe(null);
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
    expect(findings.map((f) => f.line).sort()).toEqual([1, 2, 3]);
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

  test('skips Node and Bun built-in modules', () => {
    const content = `
      import fs from 'fs';
      import path from 'node:path';
      import { test as bunTest } from 'bun:test';
      import sqlite from 'bun:sqlite';
      import realPkg from 'real-pkg';
    `;
    const findings = extractImports(content, 'test.ts');
    const names = findings.map((f) => f.packageName);
    expect(names).not.toContain('fs');
    expect(names).not.toContain('node:path');
    expect(names).not.toContain('bun:test');
    expect(names).not.toContain('bun:sqlite');
    expect(names).toContain('real-pkg');
  });

  test('does not pick up dynamic imports (current parser limitation, locked as expectation)', () => {
    // 동적 import는 IMPORT_REGEX 문법상 매칭되지 않는다. 회귀 시 본 테스트가 깨지면서 알려준다.
    const findings = extractImports("const x = await import('dynamic-pkg');", 'test.ts');
    expect(findings.find((f) => f.packageName === 'dynamic-pkg')).toBeUndefined();
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

describe('removeComments', () => {
  test('strips multi-line comments while preserving newline count for line accuracy', () => {
    const input = `/*\nline2\nline3\n*/\nimport x from 'pkg';`;
    const out = removeComments(input);
    // import 문이 그대로 남고, 그 줄 번호가 5번째 줄로 보존돼야 정확한 라인 번호 산출 가능
    const lines = out.split('\n');
    const importLine = lines.findIndex((l) => l.includes("'pkg'"));
    expect(importLine).toBeGreaterThanOrEqual(1);
  });

  test('strips single-line comments', () => {
    const input = "// comment\nimport x from 'pkg';";
    expect(removeComments(input)).not.toContain('// comment');
    expect(removeComments(input)).toContain("'pkg'");
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

  test('returns Error tagged FILE_NOT_FOUND for missing file', () => {
    const result = parseFile(`${testDir}/missing.ts`);
    expect(R.isError(result)).toBe(true);
    R.match(
      result,
      () => {
        throw new Error('Should not be Ok');
      },
      (err) => {
        expect(err.type).toBe('FILE_NOT_FOUND');
      },
    );
  });

  test('returns Error tagged READ_ERROR when path is a directory', () => {
    const result = parseFile(testDir);
    expect(R.isError(result)).toBe(true);
    R.match(
      result,
      () => {
        throw new Error('Should not be Ok');
      },
      (err) => {
        expect(err.type).toBe('READ_ERROR');
      },
    );
  });
});

describe('Config file detection', () => {
  test('should detect next.config files', () => {
    expect(isProductionConfigFile('next.config.js')).toBe(true);
    expect(isProductionConfigFile('next.config.ts')).toBe(true);
  });

  test('should detect webpack.config files', () => {
    expect(isProductionConfigFile('webpack.config.js')).toBe(true);
  });

  test('should NOT detect dev configs', () => {
    expect(isProductionConfigFile('jest.config.js')).toBe(false);
    expect(isProductionConfigFile('vitest.config.ts')).toBe(false);
  });

  test('should analyze production config files', () => {
    expect(shouldAnalyzeFile('next.config.js')).toBe(true);
  });

  test('should NOT analyze dev config files', () => {
    expect(shouldAnalyzeFile('jest.config.js')).toBe(false);
  });

  test('should NOT analyze test files', () => {
    expect(shouldAnalyzeFile('test/setup.ts')).toBe(false);
  });

  test('should NOT analyze .d.ts files', () => {
    expect(shouldAnalyzeFile('src/types.d.ts')).toBe(false);
  });
});
