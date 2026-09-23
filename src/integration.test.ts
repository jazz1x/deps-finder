import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { analyzeDependencies } from '@/analyzers/dependency-analyzer';
import { findFiles, parseMultipleFiles } from '@/parsers/import-parser';
import type { PackageJson } from '@/domain/types';

describe('Integration Tests', () => {
  const baseTestDir = './test-integration';
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

  test('should handle a complex project structure correctly', async () => {
    // 1. Setup File Structure
    await mkdir(`${testDir}/src/components`, { recursive: true });
    await mkdir(`${testDir}/src/utils`, { recursive: true });
    await mkdir(`${testDir}/tests`, { recursive: true });

    // src/index.ts
    await writeFile(
      `${testDir}/src/index.ts`,
      `
      import React from 'react';
      import { map } from 'lodash';
      console.log(map([1, 2], x => x * 2));
      `,
    );

    // src/components/Button.tsx
    await writeFile(
      `${testDir}/src/components/Button.tsx`,
      `
      import styled from 'styled-components';
      import type { JsonObject } from 'type-fest'; 
      export const Button = styled.button;
      `,
    );

    // src/utils/helpers.ts
    await writeFile(`${testDir}/src/utils/helpers.ts`, `import { format } from 'date-fns';`);

    // tests/button.test.ts
    await writeFile(`${testDir}/tests/button.test.ts`, `import { describe, it } from 'jest';`);

    // next.config.js
    await writeFile(`${testDir}/next.config.js`, `const compression = require('compression'); module.exports = {};`);

    // 2. Setup Package.json
    const packageJson: PackageJson = {
      dependencies: ['react', 'lodash', 'styled-components', 'date-fns', 'unused-dep'],
      devDependencies: ['type-fest', 'jest', 'typescript', 'compression'],
      peerDependencies: [],
    };

    // 3. Run Analysis
    const files = findFiles(testDir);
    const imports = parseMultipleFiles(files).imports;
    const result = analyzeDependencies(packageJson, imports, {
      checkAll: false,
      ignoredPackages: [],
    });

    // 4. Assertions
    expect(result.unused).toContain('unused-dep');
    expect(result.unused).not.toContain('react');
    expect(result.unused).not.toContain('lodash');

    expect(result.typeOnly).not.toContain('type-fest');

    expect(result.misplaced.some((d) => d.packageName === 'compression')).toBe(false);

    // Add misplaced dependency
    await writeFile(`${testDir}/src/utils/oops.ts`, `import { something } from 'typescript';`);

    const files2 = findFiles(testDir);
    const imports2 = parseMultipleFiles(files2).imports;
    const result2 = analyzeDependencies(packageJson, imports2, {
      checkAll: false,
      ignoredPackages: [],
    });

    expect(result2.misplaced.some((d) => d.packageName === 'typescript')).toBe(true);
    const tsUsage = result2.misplaced.find((d) => d.packageName === 'typescript');
    expect(tsUsage?.locations[0]!.file).toContain('src/utils/oops.ts');
  });

  test('should report type-only dependencies correctly', async () => {
    await writeFile(`${testDir}/index.ts`, `import type { A } from 'dep-a';`);

    const packageJson: PackageJson = {
      dependencies: ['dep-a'],
      devDependencies: [],
      peerDependencies: [],
    };

    const files = findFiles(testDir);
    const imports = parseMultipleFiles(files).imports;
    const result = analyzeDependencies(packageJson, imports, {
      checkAll: false,
      ignoredPackages: [],
    });

    expect(result.typeOnly).toContain('dep-a');
    expect(result.unused).not.toContain('dep-a');
  });

  test('should handle circular dependencies gracefully', async () => {
    await writeFile(`${testDir}/a.ts`, `import { b } from './b'; export const a = 1;`);
    await writeFile(`${testDir}/b.ts`, `import { a } from './a'; import { x } from 'pkg-x'; export const b = 2;`);

    const packageJson: PackageJson = {
      dependencies: ['pkg-x'],
      devDependencies: [],
      peerDependencies: [],
    };

    const files = findFiles(testDir);
    const imports = parseMultipleFiles(files).imports;
    const result = analyzeDependencies(packageJson, imports, {
      checkAll: false,
      ignoredPackages: [],
    });

    expect(result.unused).not.toContain('pkg-x');
  });

  test('tailwind.config.js packages should not be misplaced', async () => {
    await writeFile(`${testDir}/tailwind.config.js`, `const colors = require('tailwindcss/colors');`);

    const packageJson: PackageJson = {
      dependencies: [],
      devDependencies: ['tailwindcss'],
      peerDependencies: [],
    };

    const files = findFiles(testDir);
    const imports = parseMultipleFiles(files).imports;
    const result = analyzeDependencies(packageJson, imports, {
      checkAll: false,
      ignoredPackages: [],
    });

    expect(result.misplaced.some((d) => d.packageName === 'tailwindcss')).toBe(false);
  });

  test('postcss.config.js packages should not be misplaced', async () => {
    await writeFile(`${testDir}/postcss.config.js`, `module.exports = { plugins: { tailwindcss: {}, autoprefixer: {} } };`);
    await writeFile(`${testDir}/postcss.config.cjs`, `const autoprefixer = require('autoprefixer');`);

    const packageJson: PackageJson = {
      dependencies: [],
      devDependencies: ['autoprefixer'],
      peerDependencies: [],
    };

    const files = findFiles(testDir);
    const imports = parseMultipleFiles(files).imports;
    const result = analyzeDependencies(packageJson, imports, {
      checkAll: false,
      ignoredPackages: [],
    });

    expect(result.misplaced.some((d) => d.packageName === 'autoprefixer')).toBe(false);
  });

  test('happydom.ts packages should not be misplaced', async () => {
    await writeFile(`${testDir}/happydom.ts`, `import { GlobalWindow } from 'happy-dom';`);

    const packageJson: PackageJson = {
      dependencies: [],
      devDependencies: ['happy-dom'],
      peerDependencies: [],
    };

    const files = findFiles(testDir);
    expect(files.length).toBe(0);

    const imports = parseMultipleFiles(files).imports;
    const result = analyzeDependencies(packageJson, imports, {
      checkAll: false,
      ignoredPackages: [],
    });
    expect(result.misplaced.some((d) => d.packageName === 'happy-dom')).toBe(false);
  });

  test('storybook-static should be excluded', async () => {
    await mkdir(`${testDir}/storybook-static`, { recursive: true });
    await writeFile(`${testDir}/storybook-static/index.js`, `import { action } from '@storybook/addon-actions';`);

    const files = findFiles(testDir);
    expect(files.some((f) => f.includes('storybook-static'))).toBe(false);
  });

  test('custom directory can be excluded with --exclude', async () => {
    await mkdir(`${testDir}/my-artifact-folder`, { recursive: true });
    await writeFile(`${testDir}/my-artifact-folder/index.js`, `import { something } from 'lib';`);

    const filesDefault = findFiles(testDir);
    expect(filesDefault.some((f) => f.includes('my-artifact-folder'))).toBe(true);

    const filesExcluded = findFiles(testDir, { excludePatterns: ['my-artifact-folder/**'] });
    expect(filesExcluded.some((f) => f.includes('my-artifact-folder'))).toBe(false);
  });

  test('auto-detection can be disabled', async () => {
    await mkdir(`${testDir}/custom-build`, { recursive: true });
    await writeFile(`${testDir}/custom-build/index.js`, `import { something } from 'lib';`);

    const filesDefault = findFiles(testDir);
    expect(filesDefault.some((f) => f.includes('custom-build'))).toBe(false);

    const filesNoAuto = findFiles(testDir, { noAutoDetect: true });
    expect(filesNoAuto.some((f) => f.includes('custom-build'))).toBe(true);
  });
});
