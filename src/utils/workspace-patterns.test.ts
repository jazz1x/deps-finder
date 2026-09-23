import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { readWorkspacePatterns } from './workspace-patterns';

describe('readWorkspacePatterns', () => {
  let testDir = '';

  beforeEach(async () => {
    testDir = `./test-workspace-patterns-${Math.random().toString(36).slice(2)}`;
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  test('reads package.json workspaces in array and object form', async () => {
    await writeFile(`${testDir}/package.json`, JSON.stringify({ workspaces: ['apps/*'] }));
    expect(readWorkspacePatterns(testDir)).toEqual(['apps/*']);

    await writeFile(`${testDir}/package.json`, JSON.stringify({ workspaces: { packages: ['libs/*'] } }));
    expect(readWorkspacePatterns(testDir)).toEqual(['libs/*']);
  });

  test('reads the packages list of pnpm-workspace.yaml and stops at the next key', async () => {
    await writeFile(
      `${testDir}/pnpm-workspace.yaml`,
      ['packages:', '  - "web"', "  - 'packages/*' # libs", '  - apps/*', '', 'allowBuilds:', '  - esbuild'].join('\n'),
    );

    expect(readWorkspacePatterns(testDir)).toEqual(['web', 'packages/*', 'apps/*']);
  });

  test('a project without a workspace declaration has no workspace patterns', async () => {
    await writeFile(`${testDir}/package.json`, JSON.stringify({ name: 'x' }));
    await writeFile(`${testDir}/pnpm-workspace.yaml`, 'allowBuilds:\n  esbuild: true\n');

    expect(readWorkspacePatterns(testDir)).toEqual([]);
  });
});
