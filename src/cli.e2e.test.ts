import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pkg from '../package.json';

const REPO_ROOT = path.resolve(import.meta.dir, '..');
const CLI_PATH = path.join(REPO_ROOT, 'bin', 'cli.js');
const STRIP_ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

const runCli = (args: ReadonlyArray<string>, cwd: string) => {
  const result = spawnSync('node', [CLI_PATH, ...args], {
    cwd,
    encoding: 'utf-8',
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
  });
  return {
    stdout: result.stdout ?? '',
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
    expect(r.stdout).toContain('USAGE');
    expect(r.stdout).toContain('--ignore');
  });

  test('--version prints the package version and exits 0', () => {
    const r = runCli(['--version'], tmpDir);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(pkg.version);
  });

  test('analyzes the project directory given as an argument', async () => {
    await mkdir(path.join(tmpDir, 'app'));
    await writeFile(path.join(tmpDir, 'app/package.json'), JSON.stringify({ dependencies: { lodash: '^4.0.0' } }));
    const r = runCli(['--json', 'app'], tmpDir);
    expect(r.status).toBe(1);
    expect(JSON.parse(r.stdout).unused).toEqual(['lodash']);
  });

  test('accepts --flag=value', async () => {
    await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ dependencies: { lodash: '^4.0.0' } }));
    const r = runCli(['--json', '--ignore=lodash'], tmpDir);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).ignored).toEqual(['lodash']);
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
    expect(r.stdout).not.toContain(String.fromCharCode(27));
  });

  test('warns about source files it cannot read', async () => {
    await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ dependencies: { lodash: '^4.0.0' } }));
    await mkdir(path.join(tmpDir, 'src'));
    await writeFile(path.join(tmpDir, 'src/broken.ts'), "import _ from 'lodash';");
    await chmod(path.join(tmpDir, 'src/broken.ts'), 0o000);
    const r = runCli(['--json'], tmpDir);
    expect(r.stderr).toContain('src/broken.ts');
    expect(JSON.parse(r.stdout).unused).toEqual(['lodash']);
  });

  test('warns about project inputs it cannot use and goes on', async () => {
    await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ dependencies: { lodash: '^4.0.0' } }));
    await mkdir(path.join(tmpDir, 'weird'));
    await writeFile(path.join(tmpDir, 'weird/package.json'), '{"name":');
    await writeFile(path.join(tmpDir, 'weird/index.ts'), "import _ from 'lodash';");
    const r = runCli(['--json'], tmpDir);
    expect(r.stderr).toContain('warning: could not use weird/package.json');
    expect(r.status).toBe(0);
  });

  test('names each nested package it leaves out, and credits the root with what it does not declare', async () => {
    await writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ workspaces: ['packages/*'], devDependencies: { '@happy-dom/global-registrator': '^20.0.0', dayjs: '^1.0.0' } }),
    );
    await mkdir(path.join(tmpDir, 'packages/shared-ui/src'), { recursive: true });
    await writeFile(path.join(tmpDir, 'packages/shared-ui/package.json'), '{"name":"shared-ui","dependencies":{"dayjs":"1"}}');
    await writeFile(
      path.join(tmpDir, 'packages/shared-ui/src/happydom-setup.ts'),
      "import '@happy-dom/global-registrator';\nimport 'dayjs';",
    );
    const r = runCli(['--json', '-a'], tmpDir);
    expect(r.stderr).toContain('note: left out packages/shared-ui');
    expect(JSON.parse(r.stdout).unused).toEqual(['dayjs']);
  });

  test('warns once about a left-out package whose package.json is broken', async () => {
    await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ workspaces: ['packages/*'] }));
    await mkdir(path.join(tmpDir, 'packages/a'), { recursive: true });
    await writeFile(path.join(tmpDir, 'packages/a/package.json'), '{"name":');
    const r = runCli(['--json'], tmpDir);
    expect(r.stderr.split('could not use packages/a/package.json').length).toBe(2);
  });

  test('--json emits parseable JSON with totalIssues and exits 1 when issues exist', async () => {
    await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 't', version: '1.0.0', dependencies: { lodash: '^4.0.0' } }));
    const r = runCli(['--json'], tmpDir);
    expect(r.status).toBe(1);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.unused).toContain('lodash');
    expect(parsed.totalIssues).toBeGreaterThan(0);
  });

  test('a missing package.json is a run failure (exit 2), not a finding', () => {
    const r = runCli([], tmpDir);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('package.json not found');
    expect(r.stderr).not.toContain('FileNotFound');
    expect(r.stderr).not.toContain('_tag');
  });

  test('formats malformed package.json error without leaking stack trace', async () => {
    await writeFile(path.join(tmpDir, 'package.json'), 'not json {{');
    const r = runCli([], tmpDir);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('Failed to parse');
    expect(r.stderr).not.toContain('at JSON.parse');
    expect(r.stderr).not.toContain('SyntaxError');
  });

  test('malformed package.json error points at the broken position', async () => {
    await writeFile(path.join(tmpDir, 'package.json'), '{ "dependencies": { "a": "1", } }');
    const r = runCli([], tmpDir);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('position');
  });

  test('read failure message carries no "Error:" prefix', async () => {
    await mkdir(path.join(tmpDir, 'package.json'));
    const r = runCli([], tmpDir);
    expect(r.stderr).toContain('EISDIR');
    expect(r.stderr).not.toContain('Error: EISDIR');
  });

  test('an unknown flag fails the run (exit 2) instead of being ignored', async () => {
    await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 't', version: '1.0.0' }));
    const r = runCli(['--bogus'], tmpDir);
    expect(r.stderr).toContain('--bogus');
    expect(r.status).toBe(2);
  });

  test('interactive built-ins such as --wizard are not exposed (they hang or pass vacuously in CI)', async () => {
    await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ dependencies: { lodash: '^4.0.0' } }));
    expect(runCli(['--wizard'], tmpDir).status).toBe(2);
  });

  test('--ignore without a value fails the run (exit 2)', async () => {
    await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 't', version: '1.0.0' }));
    const r = runCli(['--ignore'], tmpDir);
    expect(r.stderr).toContain('--ignore');
    expect(r.status).toBe(2);
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
    await writeFile(path.join(tmpDir, 'src/index.js'), 'export const x = 1;');

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

  test('tsconfig usage counts: types, importHelpers, and a missing extends warns', async () => {
    await writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ dependencies: { tslib: '2' }, devDependencies: { '@types/node': '1', '@types/uuid': '1' } }),
    );
    await writeFile(
      path.join(tmpDir, 'tsconfig.json'),
      JSON.stringify({ extends: './missing.json', compilerOptions: { types: ['node'], importHelpers: true } }),
    );

    const r = runCli(['--json', '-a'], tmpDir);
    expect(JSON.parse(r.stdout).unused).toEqual(['@types/uuid']);
    expect(r.stderr).toContain('missing.json');
  });

  test('a malformed tsconfig.json warns once', async () => {
    await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ devDependencies: { typescript: '1' } }));
    await writeFile(path.join(tmpDir, 'tsconfig.json'), '{ "compilerOptions": { ');

    const r = runCli(['--json', '-a'], tmpDir);
    expect(r.stderr.match(/tsconfig\.json/g)).toHaveLength(1);
  });

  test('--json output larger than one pipe read arrives whole before a failing exit', async () => {
    const dependencies = Object.fromEntries(Array.from({ length: 50000 }, (_, i) => [`unused-package-${i}`, '^1.0.0']));
    await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 't', version: '1.0.0', dependencies }));

    const r = runCli(['--json'], tmpDir);
    expect(r.status).toBe(1);
    expect(JSON.parse(r.stdout).unused.length).toBe(50000);
  });
});
