import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dir, '..');
const CLI_PATH = path.join(REPO_ROOT, 'bin', 'cli.js');
const STRIP_ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

const runCli = (args: ReadonlyArray<string>, cwd: string) => {
  const result = spawnSync('node', [CLI_PATH, ...args], {
    cwd,
    encoding: 'utf-8',
    env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
  });
  return {
    stdout: (result.stdout ?? '').replace(STRIP_ANSI, ''),
    stderr: (result.stderr ?? '').replace(STRIP_ANSI, ''),
    status: result.status,
  };
};

describe('CLI e2e (bin/cli.js)', () => {
  let baseTmpDir = '';
  let tmpDir = '';

  beforeAll(async () => {
    const build = spawnSync('bun', ['run', 'build'], { cwd: REPO_ROOT, encoding: 'utf-8' });
    if (build.status !== 0) {
      throw new Error(`build failed:\n${build.stdout}\n${build.stderr}`);
    }
    baseTmpDir = await mkdtemp(path.join(tmpdir(), 'depsfinder-e2e-'));
  });

  beforeEach(async () => {
    tmpDir = path.join(baseTmpDir, `case-${Math.random().toString(36).slice(2)}`);
    await mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  afterAll(async () => {
    if (baseTmpDir) await rm(baseTmpDir, { recursive: true, force: true });
  });

  test('--help prints usage and exits 0', () => {
    const r = runCli(['--help'], tmpDir);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('Usage: deps-finder');
    expect(r.stdout).toContain('--ignore');
  });

  test('exits 0 on a clean project (no issues)', async () => {
    await writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'clean', version: '1.0.0', dependencies: { lodash: '^4.0.0' } }),
    );
    await mkdir(path.join(tmpDir, 'src'), { recursive: true });
    await writeFile(path.join(tmpDir, 'src/index.ts'), `import _ from 'lodash'; console.log(_);`);

    const r = runCli([], tmpDir);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('No issues found');
  });

  test('exits 1 and reports unused deps', async () => {
    await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 't', version: '1.0.0', dependencies: { lodash: '^4.0.0' } }));
    const r = runCli([], tmpDir);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('Unused Dependencies');
    expect(r.stdout).toContain('lodash');
  });

  test('--json emits parseable JSON with totalIssues and exits 1 when issues exist', async () => {
    await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 't', version: '1.0.0', dependencies: { lodash: '^4.0.0' } }));
    const r = runCli(['--json'], tmpDir);
    expect(r.status).toBe(1);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.unused).toContain('lodash');
    expect(parsed.totalIssues).toBeGreaterThan(0);
  });

  test('formats missing package.json error without leaking tagged-union shape', () => {
    const r = runCli([], tmpDir);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('package.json not found');
    expect(r.stderr).not.toContain('FILE_NOT_FOUND');
    expect(r.stderr).not.toContain('type:');
  });

  test('formats malformed package.json error without leaking stack trace', async () => {
    await writeFile(path.join(tmpDir, 'package.json'), 'not json {{');
    const r = runCli([], tmpDir);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('Failed to parse');
    expect(r.stderr).not.toContain('at JSON.parse');
    expect(r.stderr).not.toContain('SyntaxError');
  });

  test('warns on unknown flag but still runs', async () => {
    await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 't', version: '1.0.0' }));
    const r = runCli(['--bogus'], tmpDir);
    expect(r.stderr).toContain('warning:');
    expect(r.stderr).toContain('--bogus');
    expect(r.status).toBe(0);
  });

  test('warns when --ignore is missing its value', async () => {
    await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 't', version: '1.0.0' }));
    const r = runCli(['--ignore'], tmpDir);
    expect(r.stderr).toContain('warning:');
    expect(r.stderr).toContain('--ignore');
  });

  test('--ignore filters unused entries', async () => {
    await writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 't',
        version: '1.0.0',
        dependencies: { 'unused-a': '^1.0.0', 'unused-b': '^1.0.0' },
      }),
    );
    const r = runCli(['--json', '--ignore', 'unused-a'], tmpDir);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.unused).not.toContain('unused-a');
    expect(parsed.unused).toContain('unused-b');
    expect(parsed.ignored).toContain('unused-a');
  });

  test('default does not flag unused peerDependencies', async () => {
    await writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 't',
        version: '1.0.0',
        peerDependencies: { typescript: '^5.0.0' },
      }),
    );
    await mkdir(path.join(tmpDir, 'src'), { recursive: true });
    await writeFile(path.join(tmpDir, 'src/index.ts'), 'export const x = 1;');

    const r = runCli(['--json'], tmpDir);
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.unused).not.toContain('typescript');
    expect(parsed.unusedPeer).toEqual([]);
  });

  test('--check-peer reports unused peerDependencies separately', async () => {
    await writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 't',
        version: '1.0.0',
        peerDependencies: { typescript: '^5.0.0' },
      }),
    );
    await mkdir(path.join(tmpDir, 'src'), { recursive: true });
    await writeFile(path.join(tmpDir, 'src/index.ts'), 'export const x = 1;');

    const r = runCli(['--json', '--check-peer'], tmpDir);
    expect(r.status).toBe(1);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.unusedPeer).toContain('typescript');
    expect(parsed.unused).not.toContain('typescript');
  });

  test('text output includes Unused peerDependencies section under --check-peer', async () => {
    await writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 't',
        version: '1.0.0',
        peerDependencies: { typescript: '^5.0.0' },
      }),
    );
    const r = runCli(['-p'], tmpDir);
    expect(r.stdout).toContain('Unused peerDependencies');
    expect(r.stdout).toContain('typescript');
  });

  test('--exclude prevents matching files from contributing imports', async () => {
    await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 't', version: '1.0.0', dependencies: { lodash: '^4.0.0' } }));
    await mkdir(path.join(tmpDir, 'vendor'), { recursive: true });
    await writeFile(path.join(tmpDir, 'vendor/use.ts'), `import _ from 'lodash'; export {};`);

    const r = runCli(['--json', '--exclude', 'vendor/**'], tmpDir);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.unused).toContain('lodash');
  });

  test('--all includes devDependencies in unused check', async () => {
    await writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 't',
        version: '1.0.0',
        devDependencies: { 'unused-dev': '^1.0.0' },
      }),
    );
    await mkdir(path.join(tmpDir, 'src'), { recursive: true });
    await writeFile(path.join(tmpDir, 'src/index.ts'), 'export const x = 1;');

    const r = runCli(['--json', '--all'], tmpDir);
    expect(r.status).toBe(1);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.unused).toContain('unused-dev');
  });

  test('reports misplaced dependency (devDep used in production source)', async () => {
    await writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 't',
        version: '1.0.0',
        devDependencies: { lodash: '^4.0.0' },
      }),
    );
    await mkdir(path.join(tmpDir, 'src'), { recursive: true });
    await writeFile(path.join(tmpDir, 'src/index.ts'), `import _ from 'lodash'; export default _;`);

    const r = runCli(['--json'], tmpDir);
    expect(r.status).toBe(1);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.misplaced.some((d: { packageName: string }) => d.packageName === 'lodash')).toBe(true);
  });
});
