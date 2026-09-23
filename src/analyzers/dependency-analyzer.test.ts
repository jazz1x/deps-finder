import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { analyzeDependencies } from '@/analyzers/dependency-analyzer';
import type { FileContext, ImportDetails, ImportType, PackageJson } from '@/domain/types';
import { findFiles, parseMultipleFiles } from '@/parsers/import-parser';

describe('dependency-analyzer', () => {
  const baseTestDir = './test-analyze-deps';

  // Helper to get unique test dir
  const getTestDir = () => `${baseTestDir}-${Math.random().toString(36).slice(2)}`;
  let testDir = '';

  beforeEach(async () => {
    testDir = getTestDir();
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    if (testDir) {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  test('should find unused dependencies', async () => {
    await writeFile(`${testDir}/index.ts`, `import { pipe } from '@mobily/ts-belt';\nconsole.log(pipe);`);

    const packageJson: PackageJson = {
      dependencies: ['@mobily/ts-belt', 'unused-package'],
      devDependencies: [],
      peerDependencies: [],
    };

    const files = findFiles(testDir).found;
    const imports = parseMultipleFiles(files).imports;
    const result = analyzeDependencies(packageJson, imports, {
      sections: ['dependencies'],
      ignoredPackages: [],
    });

    expect(result.unused).toContain('unused-package');
    expect(result.unused).not.toContain('@mobily/ts-belt');
    expect(result.unused.length).toBe(1);
    expect(result.totalIssues).toBe(1);
  });

  test('should find misplaced dependencies in devDependencies', async () => {
    await writeFile(`${testDir}/index.ts`, `import express from 'express';\nconsole.log(express);`);

    const packageJson: PackageJson = {
      dependencies: [],
      devDependencies: ['express', 'typescript'],
      peerDependencies: [],
    };

    const files = findFiles(testDir).found;
    const imports = parseMultipleFiles(files).imports;
    const result = analyzeDependencies(packageJson, imports, {
      sections: ['dependencies'],
      ignoredPackages: [],
    });

    expect(result.misplaced.some((d) => d.packageName === 'express')).toBe(true);
    expect(result.misplaced.some((d) => d.packageName === 'typescript')).toBe(false);
    expect(result.totalIssues).toBe(1);

    // Check details
    const expressUsage = result.misplaced.find((d) => d.packageName === 'express');
    expect(expressUsage?.locations.length).toBe(1);
    expect(expressUsage?.locations[0]!.file).toContain('index.ts');
  });

  test('should not check devDependencies for unused by default', async () => {
    await writeFile(`${testDir}/index.ts`, `console.log('test');`);

    const packageJson: PackageJson = {
      dependencies: [],
      devDependencies: ['typescript', 'jest'],
      peerDependencies: [],
    };

    const files = findFiles(testDir).found;
    const imports = parseMultipleFiles(files).imports;
    const result = analyzeDependencies(packageJson, imports, {
      sections: ['dependencies'],
      ignoredPackages: [],
    });

    expect(result.unused).toEqual([]);
    expect(result.totalIssues).toBe(0);
  });

  test('should check devDependencies for unused when checkAll is true', async () => {
    await writeFile(`${testDir}/index.ts`, `console.log('test');`);

    const packageJson: PackageJson = {
      dependencies: [],
      devDependencies: ['typescript', 'jest'],
      peerDependencies: [],
    };

    const files = findFiles(testDir).found;
    const imports = parseMultipleFiles(files).imports;
    const result = analyzeDependencies(packageJson, imports, {
      sections: ['dependencies', 'devDependencies', 'peerDependencies'],
      ignoredPackages: [],
    });

    expect(result.unused).toContain('typescript');
    expect(result.unused).toContain('jest');
    expect(result.unused.length).toBe(2);
    expect(result.totalIssues).toBe(2);
  });

  test('should return correctly filtered result when ignoredPackages are provided', async () => {
    await writeFile(`${testDir}/index.ts`, `console.log('test');`);

    const packageJson: PackageJson = {
      dependencies: ['react', 'eslint'],
      devDependencies: [],
      peerDependencies: [],
    };

    const files = findFiles(testDir).found;
    const imports = parseMultipleFiles(files).imports;
    const result = analyzeDependencies(packageJson, imports, {
      sections: ['dependencies'],
      ignoredPackages: ['eslint'],
    });

    expect(result.unused).toContain('react');
    expect(result.unused).not.toContain('eslint');
    expect(result.totalIssues).toBe(1);
  });

  test('should categorize type-only imports correctly', async () => {
    await writeFile(
      `${testDir}/index.ts`,
      `
      import type { SomeType } from 'type-only-lib';
      import { runtimeFn } from 'runtime-lib';
      import { type MixedType, otherFn } from 'mixed-lib';
      import { onlyRuntime } from 'only-runtime-lib';
    `,
    );

    const packageJson: PackageJson = {
      dependencies: ['type-only-lib', 'runtime-lib', 'mixed-lib', 'only-runtime-lib', 'unused-lib'],
      devDependencies: [],
      peerDependencies: [],
    };

    const files = findFiles(testDir).found;
    const imports = parseMultipleFiles(files).imports;
    const result = analyzeDependencies(packageJson, imports, {
      sections: ['dependencies'],
      ignoredPackages: [],
    });

    expect(result.typeOnly).toContain('type-only-lib');
    expect(result.typeOnly).not.toContain('runtime-lib');
    expect(result.typeOnly).not.toContain('mixed-lib');

    expect(result.unused).toContain('unused-lib');
    expect(result.unused).not.toContain('runtime-lib');
    expect(result.unused).not.toContain('mixed-lib');
    expect(result.unused).not.toContain('only-runtime-lib');

    expect(result.totalIssues).toBe(2); // unused-lib + type-only-lib
  });

  test('should handle package with both type and runtime usage', async () => {
    await writeFile(
      `${testDir}/index.ts`,
      `
      import type { User } from 'common-lib';
      import { getUser } from 'common-lib';
    `,
    );

    const packageJson: PackageJson = {
      dependencies: ['common-lib'],
      devDependencies: [],
      peerDependencies: [],
    };

    const files = findFiles(testDir).found;
    const imports = parseMultipleFiles(files).imports;
    const result = analyzeDependencies(packageJson, imports, {
      sections: ['dependencies'],
      ignoredPackages: [],
    });

    expect(result.unused).not.toContain('common-lib');
    expect(result.misplaced.some((d) => d.packageName === 'common-lib')).toBe(false);
    expect(result.typeOnly).not.toContain('common-lib'); // Should not be type-only as it has runtime usage
    expect(result.totalIssues).toBe(0);
  });

  test('should count total issues correctly with typeOnly imports', async () => {
    await writeFile(
      `${testDir}/index.ts`,
      `
      import type { TypeOnly } from 'type-lib';
      import { runtime } from 'runtime-lib';
    `,
    );

    const packageJson: PackageJson = {
      dependencies: ['type-lib', 'runtime-lib', 'unused-lib'],
      devDependencies: ['dev-lib'],
      peerDependencies: [],
    };

    const files = findFiles(testDir).found;
    const imports = parseMultipleFiles(files).imports;
    const result = analyzeDependencies(packageJson, imports, {
      sections: ['dependencies'],
      ignoredPackages: [],
    });

    expect(result.typeOnly).toContain('type-lib');
    expect(result.unused).toContain('unused-lib');
    expect(result.misplaced.some((d) => d.packageName === 'dev-lib')).toBe(false); // Not used at runtime
    expect(result.misplaced.length).toBe(0);
    expect(result.totalIssues).toBe(2); // type-lib (typeOnly) + unused-lib (unused)
  });

  test('should allow devDependencies usage in build config files', async () => {
    await writeFile(`${testDir}/vite.config.ts`, `import { defineConfig } from 'vite';`);

    const packageJson: PackageJson = {
      dependencies: [],
      devDependencies: ['vite'],
      peerDependencies: [],
    };

    const files = findFiles(testDir).found;
    const imports = parseMultipleFiles(files).imports;
    const result = analyzeDependencies(packageJson, imports, {
      sections: ['dependencies'],
      ignoredPackages: [],
    });

    expect(result.misplaced.some((d) => d.packageName === 'vite')).toBe(false);
    expect(result.totalIssues).toBe(0);
  });

  test('should detect misplaced dependency if used in both config and source file', async () => {
    // Create src dir FIRST
    await mkdir(`${testDir}/src`, { recursive: true });

    await writeFile(`${testDir}/vite.config.ts`, `import { defineConfig } from 'vite';`);
    await writeFile(`${testDir}/src/index.ts`, `import { something } from 'vite';`);

    const packageJson: PackageJson = {
      dependencies: [],
      devDependencies: ['vite'],
      peerDependencies: [],
    };

    const files = findFiles(testDir).found;
    const imports = parseMultipleFiles(files).imports;
    const result = analyzeDependencies(packageJson, imports, {
      sections: ['dependencies'],
      ignoredPackages: [],
    });

    expect(result.misplaced.some((d) => d.packageName === 'vite')).toBe(true);

    // It should only show the src/index.ts usage, not vite.config.ts
    const viteUsage = result.misplaced.find((d) => d.packageName === 'vite');
    expect(viteUsage?.locations.length).toBe(1);
    expect(viteUsage?.locations[0]!.file).toContain('index.ts');
  });
});

describe('dependency-analyzer: peerDependencies', () => {
  const baseTestDir = './test-analyze-peer';
  const getTestDir = () => `${baseTestDir}-${Math.random().toString(36).slice(2)}`;
  let testDir = '';

  beforeEach(async () => {
    testDir = getTestDir();
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    if (testDir) await rm(testDir, { recursive: true, force: true });
  });

  const peerOnlyPkg: PackageJson = {
    dependencies: [],
    devDependencies: [],
    peerDependencies: ['typescript', 'react'],
  };

  test('default: peerDependencies are not flagged as unused', async () => {
    await writeFile(`${testDir}/index.ts`, 'export const x = 1;');
    const files = findFiles(testDir).found;
    const imports = parseMultipleFiles(files).imports;

    const result = analyzeDependencies(peerOnlyPkg, imports, {
      sections: ['dependencies'],
      ignoredPackages: [],
    });

    expect(result.unused).not.toContain('typescript');
    expect(result.unused).not.toContain('react');
    expect(result.unusedPeer).toEqual([]);
    expect(result.totalIssues).toBe(0);
  });

  test('--check-peer: peerDeps not imported are reported in unusedPeer (not in unused)', async () => {
    await writeFile(`${testDir}/index.ts`, "import React from 'react'; export default React;");
    const files = findFiles(testDir).found;
    const imports = parseMultipleFiles(files).imports;

    const result = analyzeDependencies(peerOnlyPkg, imports, {
      sections: ['dependencies', 'peerDependencies'],
      ignoredPackages: [],
    });

    expect(result.unusedPeer).toContain('typescript');
    expect(result.unusedPeer).not.toContain('react');
    expect(result.unused).not.toContain('typescript');
    expect(result.totalIssues).toBe(1);
  });

  test('--all implies --check-peer (peerDeps reported when not imported)', async () => {
    await writeFile(`${testDir}/index.ts`, 'export const x = 1;');
    const files = findFiles(testDir).found;
    const imports = parseMultipleFiles(files).imports;

    const result = analyzeDependencies(peerOnlyPkg, imports, {
      sections: ['dependencies', 'devDependencies', 'peerDependencies'],
      ignoredPackages: [],
    });

    expect(result.unusedPeer).toContain('typescript');
    expect(result.unusedPeer).toContain('react');
  });

  test('peerDep imported as type-only counts as used (not in unusedPeer)', async () => {
    await writeFile(`${testDir}/index.ts`, "import type { Component } from 'react'; export type C = Component;");
    const files = findFiles(testDir).found;
    const imports = parseMultipleFiles(files).imports;

    const result = analyzeDependencies(peerOnlyPkg, imports, {
      sections: ['dependencies', 'peerDependencies'],
      ignoredPackages: [],
    });

    expect(result.unusedPeer).not.toContain('react');
  });

  test('--ignore filters peerDeps too', async () => {
    await writeFile(`${testDir}/index.ts`, 'export const x = 1;');
    const files = findFiles(testDir).found;
    const imports = parseMultipleFiles(files).imports;

    const result = analyzeDependencies(peerOnlyPkg, imports, {
      sections: ['dependencies', 'peerDependencies'],
      ignoredPackages: ['typescript'],
    });

    expect(result.unusedPeer).not.toContain('typescript');
    expect(result.unusedPeer).toContain('react');
  });

  test('peerDep is never reported as misplaced (peerDeps are a consumer contract)', async () => {
    await writeFile(`${testDir}/index.ts`, "import React from 'react'; export default React;");
    const files = findFiles(testDir).found;
    const imports = parseMultipleFiles(files).imports;

    const result = analyzeDependencies(peerOnlyPkg, imports, {
      sections: ['dependencies', 'peerDependencies'],
      ignoredPackages: [],
    });

    expect(result.misplaced.some((d) => d.packageName === 'react')).toBe(false);
  });
});

const ALL = ['dependencies', 'devDependencies', 'peerDependencies'] as const;

const use = (
  packageName: string,
  importType: ImportType = 'runtime',
  file = 'src/a.ts',
  line = 1,
  context: FileContext = 'production',
): ImportDetails => ({
  packageName,
  importType,
  context,
  file,
  line,
  importStatement: `import x from '${packageName}'`,
});

const pkg = (sections: Partial<PackageJson>): PackageJson => ({
  dependencies: [],
  devDependencies: [],
  peerDependencies: [],
  ...sections,
});

describe('dependency-analyzer: section classification', () => {
  test('--all reports an unused peer once, under unusedPeer only', () => {
    const result = analyzeDependencies(pkg({ peerDependencies: ['react'] }), [], { sections: ALL, ignoredPackages: [] });
    expect(result.unused).toEqual([]);
    expect(result.unusedPeer).toEqual(['react']);
    expect(result.totalIssues).toBe(1);
  });

  test('--all still reports misplaced devDependencies', () => {
    const result = analyzeDependencies(pkg({ devDependencies: ['chalk'] }), [use('chalk')], { sections: ALL, ignoredPackages: [] });
    expect(result.misplaced.map((m) => m.packageName)).toEqual(['chalk']);
  });

  test('a devDependency used only for types is correctly placed, even with --all', () => {
    const result = analyzeDependencies(pkg({ devDependencies: ['zod'] }), [use('zod', 'type-only')], {
      sections: ALL,
      ignoredPackages: [],
    });
    expect(result.typeOnly).toEqual([]);
    expect(result.totalIssues).toBe(0);
  });

  test('a package declared in two sections is reported unused once', () => {
    const result = analyzeDependencies(pkg({ dependencies: ['lodash'], devDependencies: ['lodash'] }), [], {
      sections: ALL,
      ignoredPackages: [],
    });
    expect(result.unused).toEqual(['lodash']);
  });

  test('an unused peer kept in devDependencies is reported once, as a peer', () => {
    const result = analyzeDependencies(pkg({ devDependencies: ['x'], peerDependencies: ['x'] }), [], {
      sections: ALL,
      ignoredPackages: [],
    });
    expect(result.unused).toEqual([]);
    expect(result.unusedPeer).toEqual(['x']);
  });

  test('a package also listed in dependencies is not misplaced', () => {
    const result = analyzeDependencies(pkg({ dependencies: ['lodash'], devDependencies: ['lodash'] }), [use('lodash')], {
      sections: ['dependencies'],
      ignoredPackages: [],
    });
    expect(result.misplaced).toEqual([]);
  });

  test('a peer kept in devDependencies for local development is not misplaced', () => {
    const result = analyzeDependencies(pkg({ peerDependencies: ['react'], devDependencies: ['react'] }), [use('react')], {
      sections: ['dependencies'],
      ignoredPackages: [],
    });
    expect(result.misplaced).toEqual([]);
  });

  test('development usage counts as used but never decides misplaced or typeOnly', () => {
    const result = analyzeDependencies(
      pkg({ dependencies: ['zod'], devDependencies: ['chalk'] }),
      [
        use('zod', 'type-only'),
        use('zod', 'runtime', 'src/a.test.ts', 1, 'development'),
        use('chalk', 'runtime', 'scripts/x.ts', 1, 'development'),
      ],
      { sections: ALL, ignoredPackages: [] },
    );
    expect(result.unused).toEqual([]);
    expect(result.misplaced).toEqual([]);
    expect(result.typeOnly).toEqual(['zod']);
  });

  test('a type-only import from a development file is not typeOnly', () => {
    const result = analyzeDependencies(pkg({ dependencies: ['dayjs'] }), [use('dayjs', 'type-only', 'src/a.test.ts', 1, 'development')], {
      sections: ALL,
      ignoredPackages: [],
    });
    expect(result.typeOnly).toEqual([]);
  });

  test('misplaced locations are ordered by file then line', () => {
    const result = analyzeDependencies(
      pkg({ devDependencies: ['chalk'] }),
      [use('chalk', 'runtime', 'src/b.ts', 3), use('chalk', 'runtime', 'src/a.ts', 9), use('chalk', 'runtime', 'src/a.ts', 2)],
      {
        sections: ['dependencies'],
        ignoredPackages: [],
      },
    );
    expect(result.misplaced[0]?.locations.map((l) => `${l.file}:${l.line}`)).toEqual(['src/a.ts:2', 'src/a.ts:9', 'src/b.ts:3']);
  });
});
