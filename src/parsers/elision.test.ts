import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { type EmitSettings, JsxRuntime, type PackageJson, type SourceFile } from '@/domain/types';
import { UNCONFIGURED } from '@/parsers/emit-settings';
import { parseMultipleFiles } from '@/parsers/import-parser';
import { elideTypeOnlyImports } from './elision';

const pkg = (sections: Partial<PackageJson>): PackageJson => ({
  dependencies: [],
  devDependencies: [],
  peerDependencies: [],
  declarations: 'none',
  ...sections,
});

describe('elideTypeOnlyImports', () => {
  const testDir = './test-elision';

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  const elided = async (files: Record<string, string>, packageJson: PackageJson, emit: EmitSettings = UNCONFIGURED) => {
    await Promise.all(Object.entries(files).map(([file, content]) => writeFile(path.join(testDir, file), content)));
    const sources = Object.keys(files).map((file): SourceFile => ({ path: path.join(testDir, file), context: 'production', emit }));
    return elideTypeOnlyImports(packageJson, parseMultipleFiles(sources).imports, sources)
      .imports.filter((found) => found.packageName !== 'typescript')
      .map((found) => `${found.packageName}:${found.importType}:${path.basename(found.file)}:${found.line}`);
  };

  test('an import whose bindings appear only in type positions is type-only', async () => {
    const content = [
      "import { OverridableStringUnion } from '@mui/types';",
      "import { Pipe, Tuples } from 'hotscript';",
      "import * as Shapes from 'shapes';",
      "import Base from 'base';",
      "import { unused } from 'unused-binding';",
      "import { make } from 'maker';",
      "import { Cast } from 'cast';",
      "import { Shared, Spec } from 'shared-types';",
      'export type { Shared };',
      'export { type Spec };',
      "export type X = OverridableStringUnion<'a', {}> | Pipe<['a'], [Tuples.Join<''>]>;",
      'interface Round extends Shapes.Circle { Cast: string }',
      'export type { Round };',
      'export class K implements Base { m = make() as typeof Base; }',
      'export const c = make() as Cast;',
    ].join('\n');
    const packageJson = pkg({
      dependencies: ['hotscript', 'shapes', 'base', 'unused-binding', 'maker', 'cast', 'shared-types'],
      devDependencies: ['@mui/types'],
    });
    expect(await elided({ 'a.ts': content }, packageJson)).toEqual([
      '@mui/types:type-only:a.ts:1',
      'hotscript:type-only:a.ts:2',
      'shapes:type-only:a.ts:3',
      'base:type-only:a.ts:4',
      'unused-binding:type-only:a.ts:5',
      'maker:runtime:a.ts:6',
      'cast:type-only:a.ts:7',
      'shared-types:type-only:a.ts:8',
      'shared-types:type-only:a.ts:8',
    ]);
  });

  test('a binding in any value position keeps the import', async () => {
    const content = [
      "import { Tag } from 'jsx-lib';",
      "import { dec } from 'decorator-lib';",
      "import { probe } from 'typeof-lib';",
      "import Main from 'default-lib';",
      "import { short } from 'shorthand-lib';",
      "import { Again } from 'reexport-lib';",
      "import { key } from 'key-only-lib';",
      "import 'side-effect-lib';",
      'export const el = <Tag />;',
      '@dec class C {}',
      'export const kind = typeof probe;',
      'export default Main;',
      'export const o = { short, key: 1 }; o.key;',
      'export { Again };',
    ].join('\n');
    const deps = ['jsx-lib', 'decorator-lib', 'typeof-lib', 'default-lib', 'shorthand-lib', 'reexport-lib', 'key-only-lib'];
    expect(await elided({ 'a.tsx': content }, pkg({ dependencies: [...deps, 'side-effect-lib'] }))).toEqual([
      'jsx-lib:runtime:a.tsx:1',
      'decorator-lib:runtime:a.tsx:2',
      'typeof-lib:runtime:a.tsx:3',
      'default-lib:runtime:a.tsx:4',
      'shorthand-lib:runtime:a.tsx:5',
      'reexport-lib:runtime:a.tsx:6',
      'key-only-lib:type-only:a.tsx:7',
      'side-effect-lib:runtime:a.tsx:8',
      'reexport-lib:runtime:a.tsx:6',
      'react:runtime:a.tsx:9',
    ]);
  });

  test('the classic JSX factory is a value use', async () => {
    const files = {
      'a.tsx': "import React from 'react';\nexport const A = () => <div />;",
      'b.tsx': "import React from 'react';\nexport const B = () => <></>;",
      'c.tsx': "/** @jsx h */\nimport { h } from 'preact';\nexport const C = () => <p />;",
    };
    const classic = { ...UNCONFIGURED, jsx: JsxRuntime.Classic({ factory: 'React' }) };
    expect(await elided(files, pkg({ devDependencies: ['react', 'preact'] }), classic)).toEqual([
      'react:runtime:a.tsx:1',
      'react:runtime:b.tsx:1',
      'preact:runtime:c.tsx:2',
    ]);
  });

  test('verbatim and decorator metadata keep imports, and so does JavaScript', async () => {
    const content = "import { T } from 'lib';\nexport type X = T;";
    const packageJson = pkg({ dependencies: ['lib'] });
    expect(await elided({ 'a.ts': content }, packageJson, { ...UNCONFIGURED, elision: 'verbatim' })).toEqual(['lib:runtime:a.ts:1']);
    expect(await elided({ 'a.ts': content }, packageJson, { ...UNCONFIGURED, elision: 'decorator-metadata' })).toEqual([
      'lib:runtime:a.ts:1',
    ]);
    expect(await elided({ 'b.js': "import { T } from 'lib';" }, packageJson)).toEqual(['lib:runtime:b.js:1']);
  });

  test('a misplaced devDependency keeps only its value locations', async () => {
    const files = { 'a.ts': "import { f } from 'dev-lib';\nf();", 'b.ts': "import { T } from 'dev-lib';\nexport type X = T;" };
    expect(await elided(files, pkg({ devDependencies: ['dev-lib'] }))).toEqual(['dev-lib:runtime:a.ts:1', 'dev-lib:type-only:b.ts:1']);
  });
});
