import { describe, expect, test } from 'bun:test';
import { Installation, type InstalledPackage, developmentUse } from '@/domain/types';
import { binaryUses, peerUses } from './implied-usage';

const installed = (packages: Readonly<Record<string, Partial<InstalledPackage>>>): Installation =>
  Installation.Installed({
    packages: Object.fromEntries(
      Object.entries(packages).map(([name, found]) => [name, { manifest: `nm/${name}/package.json`, bins: [], peers: [], ...found }]),
    ),
  });

const names = (uses: ReadonlyArray<{ readonly packageName: string }>) => uses.map((use) => use.packageName);

const command = (script: string) => [{ file: 'package.json', script, scripts: [] }];

describe('binaryUses', () => {
  test('an installed package provides the binaries its manifest names', () => {
    const installation = installed({ typescript: { bins: ['tsc', 'tsserver'] } });
    expect(names(binaryUses(command('tsc -p .'), installation, ['typescript']))).toEqual(['typescript']);
    expect(names(binaryUses(command('typescript'), installation, ['typescript']))).toEqual([]);
  });

  test('a package that is not installed provides its name and its unscoped name', () => {
    expect(names(binaryUses(command('biome check && jest'), installed({}), ['@biomejs/biome', 'jest']))).toEqual([
      '@biomejs/biome',
      'jest',
    ]);
    expect(names(binaryUses(command('jest'), Installation.NotInstalled(), ['jest']))).toEqual(['jest']);
  });
});

describe('peerUses', () => {
  const installation = installed({
    next: { peers: ['@opentelemetry/api', 'sass'] },
    sass: { peers: ['chokidar'] },
    unused: { peers: ['left-pad'] },
  });

  test('a declared peer of a used package is used, and so are its own peers', () => {
    const uses = peerUses(installation, ['next', 'sass', 'chokidar', 'left-pad', 'unused'], [developmentUse('next', 'a.ts', '')]);
    expect(names(uses)).toEqual(['sass', 'chokidar']);
    expect(uses[0]).toMatchObject({ context: 'development', importStatement: 'peerDependencies of next' });
  });

  test('peers of a package production code loads are production peer uses', () => {
    const production = { ...developmentUse('next', 'a.ts', ''), context: 'production' as const };
    const typeOnly = { ...developmentUse('unused', 'a.ts', ''), context: 'production' as const, importType: 'type-only' as const };
    const uses = peerUses(installation, ['next', 'sass', 'chokidar', 'left-pad', 'unused'], [production, typeOnly]);
    expect(uses.filter((use) => use.context === 'production')).toMatchObject([
      { packageName: 'sass', importType: 'peer' },
      { packageName: 'chokidar', importType: 'peer' },
    ]);
  });

  test('nothing without an install', () => {
    expect(peerUses(Installation.NotInstalled(), ['next', 'sass'], [developmentUse('next', 'a.ts', '')])).toEqual([]);
  });
});
