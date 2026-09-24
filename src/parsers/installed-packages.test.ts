import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Installation } from '@/domain/types';
import { readInstallation } from './installed-packages';

const install = async (dir: string, manifest: Readonly<Record<string, unknown>>) => {
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'package.json'), JSON.stringify(manifest));
};

describe('readInstallation', () => {
  const testDir = path.resolve('./test-installed-packages');

  beforeEach(async () => {
    await mkdir(`${testDir}/app`, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  test('resolves each package from the nearest node_modules at or above the project', async () => {
    await install(`${testDir}/node_modules/@biomejs/biome`, { name: '@biomejs/biome', bin: 'bin/biome' });
    await install(`${testDir}/node_modules/next`, {
      peerDependencies: { react: '*' },
      peerDependenciesMeta: { sass: { optional: true } },
    });
    await install(`${testDir}/app/node_modules/next`, { bin: { next: 'dist/bin/next' } });

    const { installation } = readInstallation(`${testDir}/app`, ['@biomejs/biome', 'next', 'absent']);
    expect(installation).toEqual(
      Installation.Installed({
        packages: {
          '@biomejs/biome': {
            manifest: `${testDir}/node_modules/@biomejs/biome/package.json`,
            bins: ['biome'],
            peers: [],
          },
          next: { manifest: `${testDir}/app/node_modules/next/package.json`, bins: ['next'], peers: [] },
        },
      }),
    );
  });

  test('a node_modules above that holds none of the declared packages is not an install', async () => {
    await install(`${testDir}/node_modules/unrelated`, { name: 'unrelated' });

    expect(readInstallation(`${testDir}/app`, ['absent']).installation).toEqual(Installation.NotInstalled());
  });

  test('a project that declares nothing needs no install', () => {
    expect(readInstallation(`${testDir}/app`, []).installation).toEqual(Installation.Installed({ packages: {} }));
  });

  test('peers come from peerDependencies and peerDependenciesMeta', async () => {
    await install(`${testDir}/app/node_modules/next`, {
      peerDependencies: { react: '*' },
      peerDependenciesMeta: { react: { optional: false }, sass: { optional: true } },
    });

    const { installation } = readInstallation(`${testDir}/app`, ['next']);
    expect(installation).toMatchObject({ packages: { next: { peers: ['react', 'sass'] } } });
  });
});
