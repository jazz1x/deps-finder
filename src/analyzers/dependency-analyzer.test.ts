import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { O } from '@mobily/ts-belt';
import { analyzeDependencies } from '@/analyzers/dependency-analyzer';
import type { PackageJson } from '@/domain/types';
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
      name: O.Some('test'),
      version: O.Some('1.0.0'),
      dependencies: O.Some({
        '@mobily/ts-belt': '^3.0.0',
        'unused-package': '^1.0.0',
      }),
      devDependencies: O.None,
      peerDependencies: O.None,
    };

    const files = findFiles(testDir);
    const imports = parseMultipleFiles(files);
    const result = analyzeDependencies(packageJson, imports, {
      checkAll: false,
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
      name: O.Some('test'),
      version: O.Some('1.0.0'),
      dependencies: O.None,
      devDependencies: O.Some({
        express: '^4.0.0',
        typescript: '^5.0.0',
      }),
      peerDependencies: O.None,
    };

    const files = findFiles(testDir);
    const imports = parseMultipleFiles(files);
    const result = analyzeDependencies(packageJson, imports, {
      checkAll: false,
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
      name: O.Some('test'),
      version: O.Some('1.0.0'),
      dependencies: O.None,
      devDependencies: O.Some({
        typescript: '^5.0.0',
        jest: '^29.0.0',
      }),
      peerDependencies: O.None,
    };

    const files = findFiles(testDir);
    const imports = parseMultipleFiles(files);
    const result = analyzeDependencies(packageJson, imports, {
      checkAll: false,
      ignoredPackages: [],
    });

    expect(result.unused).toEqual([]);
    expect(result.totalIssues).toBe(0);
  });

  test('should check devDependencies for unused when checkAll is true', async () => {
    await writeFile(`${testDir}/index.ts`, `console.log('test');`);

    const packageJson: PackageJson = {
      name: O.Some('test'),
      version: O.Some('1.0.0'),
      dependencies: O.None,
      devDependencies: O.Some({
        typescript: '^5.0.0',
        jest: '^29.0.0',
      }),
      peerDependencies: O.None,
    };

    const files = findFiles(testDir);
    const imports = parseMultipleFiles(files);
    const result = analyzeDependencies(packageJson, imports, {
      checkAll: true,
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
      name: O.Some('test'),
      version: O.Some('1.0.0'),
      dependencies: O.Some({
        react: '^18.0.0',
        eslint: '^8.0.0',
      }),
      devDependencies: O.None,
      peerDependencies: O.None,
    };

    const files = findFiles(testDir);
    const imports = parseMultipleFiles(files);
    const result = analyzeDependencies(packageJson, imports, {
      checkAll: false,
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
      name: O.Some('test'),
      version: O.Some('1.0.0'),
      dependencies: O.Some({
        'type-only-lib': '^1.0.0',
        'runtime-lib': '^1.0.0',
        'mixed-lib': '^1.0.0',
        'only-runtime-lib': '^1.0.0',
        'unused-lib': '^1.0.0',
      }),
      devDependencies: O.None,
      peerDependencies: O.None,
    };

    const files = findFiles(testDir);
    const imports = parseMultipleFiles(files);
    const result = analyzeDependencies(packageJson, imports, {
      checkAll: false,
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
      name: O.Some('test'),
      version: O.Some('1.0.0'),
      dependencies: O.Some({
        'common-lib': '^1.0.0',
      }),
      devDependencies: O.None,
      peerDependencies: O.None,
    };

    const files = findFiles(testDir);
    const imports = parseMultipleFiles(files);
    const result = analyzeDependencies(packageJson, imports, {
      checkAll: false,
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
      name: O.Some('test'),
      version: O.Some('1.0.0'),
      dependencies: O.Some({
        'type-lib': '^1.0.0',
        'runtime-lib': '^1.0.0',
        'unused-lib': '^1.0.0',
      }),
      devDependencies: O.Some({
        'dev-lib': '^1.0.0',
      }),
      peerDependencies: O.None,
    };

    const files = findFiles(testDir);
    const imports = parseMultipleFiles(files);
    const result = analyzeDependencies(packageJson, imports, {
      checkAll: false,
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
      name: O.Some('test'),
      version: O.Some('1.0.0'),
      dependencies: O.None,
      devDependencies: O.Some({
        vite: '^4.0.0',
      }),
      peerDependencies: O.None,
    };

    const files = findFiles(testDir);
    const imports = parseMultipleFiles(files);
    const result = analyzeDependencies(packageJson, imports, {
      checkAll: false,
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
      name: O.Some('test'),
      version: O.Some('1.0.0'),
      dependencies: O.None,
      devDependencies: O.Some({
        vite: '^4.0.0',
      }),
      peerDependencies: O.None,
    };

    const files = findFiles(testDir);
    const imports = parseMultipleFiles(files);
    const result = analyzeDependencies(packageJson, imports, {
      checkAll: false,
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
    name: O.Some('lib'),
    version: O.Some('1.0.0'),
    dependencies: O.None,
    devDependencies: O.None,
    peerDependencies: O.Some({
      typescript: '^5.0.0',
      react: '^18.0.0',
    }),
  };

  test('default: peerDependencies are not flagged as unused', async () => {
    await writeFile(`${testDir}/index.ts`, 'export const x = 1;');
    const files = findFiles(testDir);
    const imports = parseMultipleFiles(files);

    const result = analyzeDependencies(peerOnlyPkg, imports, {
      checkAll: false,
      checkPeer: false,
      ignoredPackages: [],
    });

    expect(result.unused).not.toContain('typescript');
    expect(result.unused).not.toContain('react');
    expect(result.unusedPeer).toEqual([]);
    expect(result.totalIssues).toBe(0);
  });

  test('--check-peer: peerDeps not imported are reported in unusedPeer (not in unused)', async () => {
    await writeFile(`${testDir}/index.ts`, "import React from 'react'; export default React;");
    const files = findFiles(testDir);
    const imports = parseMultipleFiles(files);

    const result = analyzeDependencies(peerOnlyPkg, imports, {
      checkAll: false,
      checkPeer: true,
      ignoredPackages: [],
    });

    expect(result.unusedPeer).toContain('typescript');
    expect(result.unusedPeer).not.toContain('react');
    expect(result.unused).not.toContain('typescript');
    expect(result.totalIssues).toBe(1);
  });

  test('--all implies --check-peer (peerDeps reported when not imported)', async () => {
    await writeFile(`${testDir}/index.ts`, 'export const x = 1;');
    const files = findFiles(testDir);
    const imports = parseMultipleFiles(files);

    const result = analyzeDependencies(peerOnlyPkg, imports, {
      checkAll: true,
      checkPeer: false,
      ignoredPackages: [],
    });

    expect(result.unusedPeer).toContain('typescript');
    expect(result.unusedPeer).toContain('react');
  });

  test('peerDep imported as type-only counts as used (not in unusedPeer)', async () => {
    await writeFile(`${testDir}/index.ts`, "import type { Component } from 'react'; export type C = Component;");
    const files = findFiles(testDir);
    const imports = parseMultipleFiles(files);

    const result = analyzeDependencies(peerOnlyPkg, imports, {
      checkAll: false,
      checkPeer: true,
      ignoredPackages: [],
    });

    expect(result.unusedPeer).not.toContain('react');
  });

  test('--ignore filters peerDeps too', async () => {
    await writeFile(`${testDir}/index.ts`, 'export const x = 1;');
    const files = findFiles(testDir);
    const imports = parseMultipleFiles(files);

    const result = analyzeDependencies(peerOnlyPkg, imports, {
      checkAll: false,
      checkPeer: true,
      ignoredPackages: ['typescript'],
    });

    expect(result.unusedPeer).not.toContain('typescript');
    expect(result.unusedPeer).toContain('react');
  });

  test('peerDep is never reported as misplaced (peerDeps are a consumer contract)', async () => {
    await writeFile(`${testDir}/index.ts`, "import React from 'react'; export default React;");
    const files = findFiles(testDir);
    const imports = parseMultipleFiles(files);

    const result = analyzeDependencies(peerOnlyPkg, imports, {
      checkAll: false,
      checkPeer: true,
      ignoredPackages: [],
    });

    expect(result.misplaced.some((d) => d.packageName === 'react')).toBe(false);
  });
});
