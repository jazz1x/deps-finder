import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { analyzeDependencies } from '@/analyzers/dependency-analyzer';
import { findFiles, parseHoistedImports, parseMultipleFiles } from '@/parsers/import-parser';
import { tsconfigImports } from '@/parsers/tsconfig-parser';
import type { PackageJson } from '@/domain/types';
import path from 'node:path';

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
      declarations: 'none',
    };

    // 3. Run Analysis
    const files = findFiles(testDir).found;
    const imports = parseMultipleFiles(files).imports;
    const result = analyzeDependencies(packageJson, imports, {
      sections: ['dependencies'],
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

    const files2 = findFiles(testDir).found;
    const imports2 = parseMultipleFiles(files2).imports;
    const result2 = analyzeDependencies(packageJson, imports2, {
      sections: ['dependencies'],
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
      declarations: 'none',
    };

    const files = findFiles(testDir).found;
    const imports = parseMultipleFiles(files).imports;
    const result = analyzeDependencies(packageJson, imports, {
      sections: ['dependencies'],
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
      declarations: 'none',
    };

    const files = findFiles(testDir).found;
    const imports = parseMultipleFiles(files).imports;
    const result = analyzeDependencies(packageJson, imports, {
      sections: ['dependencies'],
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
      declarations: 'none',
    };

    const files = findFiles(testDir).found;
    const imports = parseMultipleFiles(files).imports;
    const result = analyzeDependencies(packageJson, imports, {
      sections: ['dependencies'],
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
      declarations: 'none',
    };

    const files = findFiles(testDir).found;
    const imports = parseMultipleFiles(files).imports;
    const result = analyzeDependencies(packageJson, imports, {
      sections: ['dependencies'],
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
      declarations: 'none',
    };

    const files = findFiles(testDir).found;
    expect(files.map((f) => f.context)).toEqual(['development']);

    const imports = parseMultipleFiles(files).imports;
    const result = analyzeDependencies(packageJson, imports, {
      sections: ['dependencies'],
      ignoredPackages: [],
    });
    expect(result.misplaced.some((d) => d.packageName === 'happy-dom')).toBe(false);
  });

  test('storybook-static should be excluded', async () => {
    await mkdir(`${testDir}/storybook-static`, { recursive: true });
    await writeFile(`${testDir}/storybook-static/index.js`, `import { action } from '@storybook/addon-actions';`);

    const files = findFiles(testDir).found;
    expect(files.some((f) => f.path.includes('storybook-static'))).toBe(false);
  });

  test('custom directory can be excluded with --exclude', async () => {
    await mkdir(`${testDir}/my-artifact-folder`, { recursive: true });
    await writeFile(`${testDir}/my-artifact-folder/index.js`, `import { something } from 'lib';`);

    const filesDefault = findFiles(testDir).found;
    expect(filesDefault.some((f) => f.path.includes('my-artifact-folder'))).toBe(true);

    const filesExcluded = findFiles(testDir, { excludePatterns: ['my-artifact-folder/**'] }).found;
    expect(filesExcluded.some((f) => f.path.includes('my-artifact-folder'))).toBe(false);
  });

  test('auto-detection can be disabled', async () => {
    await mkdir(`${testDir}/custom-build`, { recursive: true });
    await writeFile(`${testDir}/custom-build/index.js`, `import { something } from 'lib';`);

    const filesDefault = findFiles(testDir).found;
    expect(filesDefault.some((f) => f.path.includes('custom-build'))).toBe(false);

    const filesNoAuto = findFiles(testDir, { noAutoDetect: true }).found;
    expect(filesNoAuto.some((f) => f.path.includes('custom-build'))).toBe(true);
  });
});

const ALL = ['dependencies', 'devDependencies', 'peerDependencies'] as const;

const pkg = (sections: Partial<PackageJson>): PackageJson => ({
  dependencies: [],
  devDependencies: [],
  peerDependencies: [],
  declarations: 'none',
  ...sections,
});

describe('file contexts', () => {
  let testDir = '';

  const write = async (file: string, content: string) => {
    await mkdir(`${testDir}/${file.split('/').slice(0, -1).join('/')}`, { recursive: true });
    await writeFile(`${testDir}/${file}`, content);
  };

  const analyze = (packageJson: PackageJson) => {
    const files = findFiles(testDir);
    const imports = [...parseMultipleFiles(files.found).imports, ...parseHoistedImports(files.packages).imports];
    return analyzeDependencies(packageJson, imports, { sections: ALL, ignoredPackages: [] });
  };

  beforeEach(async () => {
    testDir = `./test-file-contexts-${Math.random().toString(36).slice(2)}`;
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  test('-a counts devDependencies used only by development files, without making them misplaced', async () => {
    await write('src/index.ts', 'export const x = 1;');
    await write('src/a.test.ts', "import sinon from 'sinon';");
    await write('src/Button.stories.tsx', "import { fn } from '@storybook/test';");
    await write('.storybook/main.ts', "import type { StorybookConfig } from '@storybook/nextjs-vite';");
    await write('vitest.config.ts', "import { defineConfig } from 'vitest/config';");
    await write('next.config.mjs', "import analyzer from '@next/bundle-analyzer';");
    await write('scripts/gen.ts', "import { Project } from 'ts-morph';");
    await write('.scripts/run.ts', "import chalk from 'chalk';");
    await write('e2e/flow.ts', "import { test } from '@playwright/test';");

    const result = analyze(
      pkg({
        devDependencies: [
          'sinon',
          '@storybook/test',
          '@storybook/nextjs-vite',
          'vitest',
          '@next/bundle-analyzer',
          'ts-morph',
          'chalk',
          '@playwright/test',
          'big.js',
        ],
      }),
    );

    expect(result.unused).toEqual(['big.js']);
    expect(result.misplaced).toEqual([]);
  });

  test('nested *.config.* and src/scripts/ stay production source', async () => {
    await write('src/config/app.config.ts', "import { z } from 'zod';");
    await write('src/scripts/analytics.ts', "import ora from 'ora';");

    const result = analyze(pkg({ devDependencies: ['zod', 'ora'] }));

    expect(result.misplaced.map((m) => [m.packageName, path.relative(testDir, m.locations[0]!.file)])).toEqual([
      ['zod', 'src/config/app.config.ts'],
      ['ora', 'src/scripts/analytics.ts'],
    ]);
  });

  test('a package.json without a name is not a package boundary', async () => {
    await write('src/components/package.json', '{"sideEffects":false}');
    await write('src/components/build/index.ts', "import 'lodash';");
    await write('src/components/scripts/fmt.ts', "import 'chalk';");
    await write('src/components/theme.config.ts', "import 'zod';");

    const result = analyze(pkg({ dependencies: ['lodash'], devDependencies: ['chalk', 'zod'] }));

    expect(result.unused).toEqual([]);
    expect(result.misplaced.map((m) => m.packageName)).toEqual(['chalk', 'zod']);
  });

  test('a left-out package credits the root only with what it does not declare, as development use', async () => {
    await write('package.json', '{"workspaces":["packages/*","apps/*"]}');
    await write('bun.lock', '');
    await write('src/index.ts', 'export const x = 1;');
    await write('packages/shared-ui/package.json', '{"name":"shared-ui","dependencies":{"react":"18"}}');
    await write('packages/shared-ui/src/happydom-setup.ts', "import { GlobalRegistrator } from '@happy-dom/global-registrator';");
    await write(
      'packages/shared-ui/src/Button.tsx',
      "import 'react';\nimport { match } from 'ts-pattern';\nimport type { Dayjs } from 'dayjs';",
    );
    await write('functions/package.json', '{"name":"functions","devDependencies":{"is-odd":"1"}}');
    await write('functions/package-lock.json', '{}');
    await write('functions/src/index.ts', "import 'is-odd';\nimport 'left-pad';");

    const result = analyze(
      pkg({
        dependencies: ['react', 'is-odd', 'dayjs'],
        devDependencies: ['@happy-dom/global-registrator', 'ts-pattern', 'left-pad'],
      }),
    );

    expect(result.unused).toEqual(['react', 'is-odd']);
    expect(result.misplaced).toEqual([]);
    expect(result.typeOnly).toEqual([]);
  });

  test('a peer-only declaration in a left-out package still credits the root install', async () => {
    await write('package.json', '{"workspaces":["packages/*"]}');
    await write('packages/ui/package.json', '{"name":"ui","peerDependencies":{"react":"^19"}}');
    await write('packages/ui/src/index.ts', "import { useState } from 'react';");

    expect(analyze(pkg({ devDependencies: ['react'] })).unused).toEqual([]);
  });

  test('an Nx lib with a name and dependencies but no install of its own is scanned', async () => {
    await write('libs/common/package.json', '{"name":"@x/common","dependencies":{"dotenv":"16"}}');
    await write('libs/common/project.json', '{}');
    await write('libs/common/src/log.ts', "import 'winston';\nimport 'dotenv';");

    const result = analyze(pkg({ dependencies: ['winston', 'dotenv'] }));

    expect(result.unused).toEqual([]);
  });

  test('a project.json directory is a layout root', async () => {
    await write('apps/api/project.json', '{"name":"api"}');
    await write('apps/api/jest.config.ts', "import 'jest';");
    await write('apps/api/vite.config.ts', "import { nxViteTsPaths } from '@nx/vite';");
    await write('apps/api/dist/main.js', "require('left-pad');");
    await write('apps/api/src/main.ts', "import 'express';");

    const result = analyze(pkg({ dependencies: ['express', 'left-pad'], devDependencies: ['jest', '@nx/vite'] }));

    expect(result.unused).toEqual(['left-pad']);
    expect(result.misplaced).toEqual([]);
  });

  test('an Nx project.json written as JSONC is a layout root', async () => {
    await write('libs/x/project.json', '{ // jsonc\n "name":"x",}');
    await write('libs/x/vite.config.ts', "import { defineConfig } from 'vite';");

    expect(findFiles(testDir).skipped).toEqual([]);
    expect(analyze(pkg({ devDependencies: ['vite'] })).misplaced).toEqual([]);
  });

  test('only an Nx project.json makes a layout root, not a data file of that name', async () => {
    await write('apps/web/project.json', '{"targets":{}}');
    await write('apps/web/dist/main.js', "require('is-odd');");
    await write('apps/docs/project.json', '{"$schema":"../../node_modules/nx/schemas/project-schema.json"}');
    await write('apps/docs/dist/main.js', "require('is-even');");
    await write('src/fixtures/project.json', '{"id":1,"title":"Sample project"}');
    await write('src/fixtures/build/make.ts', "import 'lodash';");
    await write('src/fixtures/schema.config.ts', "import 'zod';");
    await write('src/people/project.json', '{"name":{"first":"x"}}');
    await write('src/people/build/list.ts', "import 'ramda';");

    const result = analyze(pkg({ dependencies: ['lodash', 'is-odd', 'is-even', 'ramda'], devDependencies: ['zod'] }));

    expect(result.unused).toEqual(['is-odd', 'is-even']);
    expect(result.misplaced.map((m) => m.packageName)).toEqual(['zod']);
  });

  test('a named lib without dependencies is scanned, anchored at its own root', async () => {
    await write('libs/ui/package.json', '{"name":"@x/ui","dependencies":{}}');
    await write('libs/ui/src/button.ts', "import 'chalk';");
    await write('libs/ui/vite.config.ts', "import { defineConfig } from 'vite';");
    await write('libs/ui/scripts/release.ts', "import 'execa';");
    await write('libs/ui/dist/index.js', "require('left-pad');");
    await write('libs/ui/build/index.js', "require('is-odd');");
    await write('libs/ui/out/index.js', "require('ramda');");
    await write('libs/ui/coverage/prettify.js', "require('dayjs');");
    await write('libs/ui/test/fixtures/pkg/package.json', '{"name":"fixture"}');
    await write('libs/ui/test/fixtures/pkg/index.ts', "import 'nock';");

    const result = analyze(
      pkg({ dependencies: ['chalk', 'left-pad', 'is-odd', 'ramda', 'dayjs'], devDependencies: ['vite', 'execa', 'nock'] }),
    );

    expect(result.unused).toEqual(['left-pad', 'is-odd', 'ramda', 'dayjs']);
    expect(result.misplaced).toEqual([]);
  });

  test('a named lib inside root scripts/ or .github/ keeps the root tooling rules', async () => {
    await write('scripts/package.json', '{"name":"scripts","type":"module","private":true}');
    await write('scripts/release.ts', "import 'zx';");
    await write('.github/actions/notify/package.json', '{"name":"notify","private":true}');
    await write('.github/actions/notify/index.js', "import '@actions/core';");

    const result = analyze(pkg({ devDependencies: ['zx', '@actions/core'] }));

    expect(result.unused).toEqual([]);
    expect(result.misplaced).toEqual([]);
  });

  test('gitignored generated output is not scanned', async () => {
    await write('.gitignore', '.vercel\n.next/\n.gradle\n');
    await write('src/index.ts', 'export const x = 1;');
    await write('.vercel/output/functions/api.func/index.js', "require('left-pad');");
    await write('apps/web/.next/server/chunk.js', "require('is-odd');");
    await write('.gradle/build/report.js', "require('lodash');");

    const result = analyze(pkg({ dependencies: ['left-pad', 'is-odd', 'lodash'] }));

    expect(result.unused).toEqual(['left-pad', 'is-odd', 'lodash']);
  });

  test('root dotfiles and dot directories are development; nested dot directories are source', async () => {
    await write('.eslintrc.cjs', "module.exports = require('eslint-config-y');");
    await write('.github/scripts/release.mjs', "import '@actions/core';");
    await write('.husky/check.mjs', "import 'lint-staged-x';");
    await write('src/index.ts', "export * from './.generated/client';");
    await write('src/.generated/client.ts', "import 'graphql-request';");

    const result = analyze(pkg({ devDependencies: ['eslint-config-y', '@actions/core', 'lint-staged-x', 'graphql-request'] }));

    expect(result.unused).toEqual([]);
    expect(result.misplaced.map((m) => m.packageName)).toEqual(['graphql-request']);
  });

  test('without a .gitignore, root framework caches are still skipped', async () => {
    await write('src/index.ts', 'export const x = 1;');
    await write('.next/server/chunk.js', "require('left-pad');");

    const result = analyze(pkg({ dependencies: ['left-pad'] }));

    expect(result.unused).toEqual(['left-pad']);
  });

  test('a feature folder named stories/ is source unless its files are stories', async () => {
    await write('src/features/stories/Carousel.ts', "import '@faker-js/faker';");
    await write('src/features/stories/Carousel.stories.ts', "import '@storybook/test';");

    const result = analyze(pkg({ devDependencies: ['@faker-js/faker', '@storybook/test'] }));

    expect(result.misplaced.map((m) => m.packageName)).toEqual(['@faker-js/faker']);
  });

  test('root presets and happy-dom setup files are development', async () => {
    await write('jest.preset.js', "require('@nrwl/jest/preset');");
    await write('src/happydom-setup.ts', "import { GlobalRegistrator } from '@happy-dom/global-registrator';");

    const result = analyze(pkg({ devDependencies: ['@nrwl/jest', '@happy-dom/global-registrator'] }));

    expect(result.unused).toEqual([]);
    expect(result.misplaced).toEqual([]);
  });

  test('build output is excluded only at the project root', async () => {
    await write('dist/index.js', "import 'dist-only';");
    await write('build/index.js', "import 'build-only';");
    await write('out/index.js', "import 'out-only';");
    await write('coverage/lcov-report/prettify.js', "import 'coverage-only';");
    await write('src/dist/index.ts', "import 'lodash';");
    await write('src/build/index.ts', "import 'ramda';");
    await write('src/out/index.ts', "import 'zod';");
    await write('src/coverage/index.ts', "import 'dayjs';");

    const result = analyze(
      pkg({ dependencies: ['lodash', 'ramda', 'zod', 'dayjs', 'dist-only', 'build-only', 'out-only', 'coverage-only'] }),
    );

    expect(result.unused).toEqual(['dist-only', 'build-only', 'out-only', 'coverage-only']);
  });

  test('component scripts count in their file context', async () => {
    await write('src/A.vue', "<script>\nimport store from 'store2';\nimport Vue from 'vue';\n</script>");
    await write('src/Btn.stories.svelte', "<script>\nimport { fn } from '@storybook/test';\n</script>");

    const result = analyze(pkg({ dependencies: ['vue'], devDependencies: ['store2', '@storybook/test'] }));

    expect(result.unused).toEqual([]);
    expect(result.misplaced.map((usage) => usage.packageName)).toEqual(['store2']);
  });
});

describe('compiler settings', () => {
  let testDir = '';

  const write = async (file: string, content: unknown) => {
    await mkdir(path.dirname(path.join(testDir, file)), { recursive: true });
    await writeFile(path.join(testDir, file), typeof content === 'string' ? content : JSON.stringify(content));
  };

  const analyze = (packageJson: PackageJson) => {
    const files = findFiles(testDir);
    const imports = [...parseMultipleFiles(files.found).imports, ...tsconfigImports(files.tsconfigs)];
    return analyzeDependencies(packageJson, imports, { sections: ALL, ignoredPackages: [] });
  };

  beforeEach(async () => {
    testDir = `./test-compiler-settings-${Math.random().toString(36).slice(2)}`;
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  test('types count from every tsconfig at a layout root and from the projects they reference', async () => {
    await write('tsconfig.json', { files: [], references: [{ path: './config/tsconfig.e2e.json' }] });
    await write('tsconfig.spec.json', { compilerOptions: { types: ['jest'] } });
    await write('config/tsconfig.e2e.json', { compilerOptions: { types: ['cypress'] } });
    await write('apps/web/package.json', { name: 'web' });
    await write('apps/web/tsconfig.json', { compilerOptions: { types: ['vitest/globals'] } });
    await write('src/index.js', 'export const x = 1;');

    const result = analyze(pkg({ devDependencies: ['@types/jest', 'cypress', 'vitest', 'typescript'] }));

    expect(result.unused).toEqual([]);
  });

  test('JSX uses the runtime of the tsconfig that governs the file', async () => {
    await write('tsconfig.json', { compilerOptions: { jsx: 'react-jsx' } });
    await write('src/Btn.tsx', 'import type { FC } from "react";\nexport const Btn: FC = () => <button>x</button>;');
    await write('apps/admin/package.json', { name: 'admin' });
    await write('apps/admin/tsconfig.app.json', { compilerOptions: { jsxImportSource: '@emotion/react' } });
    await write('apps/admin/src/Card.tsx', 'export const Card = () => <div css={{ color: "red" }} />;');

    const result = analyze(pkg({ dependencies: ['react', '@emotion/react'], devDependencies: ['typescript'] }));

    expect(result).toMatchObject({ unused: [], typeOnly: [], misplaced: [] });
  });
});
