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

const writeFiles = async (root: string, files: Readonly<Record<string, unknown>>) => {
  for (const [file, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), typeof content === 'string' ? content : JSON.stringify(content));
  }
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

  test('colours the report and --help on a terminal', async () => {
    await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ dependencies: { lodash: '^4.0.0' } }));
    const onTerminal = async (args: ReadonlyArray<string>) => {
      let output = '';
      const env: Record<string, string | undefined> = { ...process.env, NO_COLOR: undefined, FORCE_COLOR: undefined };
      const proc = Bun.spawn(['node', CLI_PATH, ...args], {
        cwd: tmpDir,
        env,
        terminal: { cols: 200, rows: 50, data: (_terminal, data) => (output += new TextDecoder().decode(data)) },
      });
      await proc.exited;
      return output;
    };
    expect(await onTerminal([])).toContain('\x1b[33mUnused Dependencies:\x1b[0m');
    expect(await onTerminal(['--help'])).toContain('\x1b[1mUSAGE\x1b[0m');
  });

  test('a reader that closes early ends the run with its code and no stack trace', async () => {
    await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'clean' }));
    const proc = Bun.spawn(['node', CLI_PATH, '--json'], { cwd: tmpDir, stdout: 'pipe', stderr: 'pipe' });
    await proc.stdout.cancel();
    expect(await proc.exited).toBe(0);
    expect(await new Response(proc.stderr).text()).not.toContain('EPIPE');
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

  test('counts packages a stylesheet imports, and warns about one it cannot parse', async () => {
    await writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ dependencies: { 'slick-carousel': '1' }, devDependencies: { tailwindcss: '4' } }),
    );
    await mkdir(path.join(tmpDir, 'src'));
    await writeFile(path.join(tmpDir, 'src/global.css'), "@import 'slick-carousel/slick/slick.css';");
    await writeFile(path.join(tmpDir, 'src/broken.css'), '@import "tailwindcss";\n.a { color: red');
    const r = runCli(['--json', '-a'], tmpDir);
    expect(r.stderr).toMatch(/warning: skipped \S*src\/broken\.css \(/);
    expect(JSON.parse(r.stdout).unused).toEqual(['tailwindcss']);
  });

  test('warns about a source with a parse error and counts what the parser kept', async () => {
    await writeFiles(tmpDir, {
      'package.json': { dependencies: { lodash: '4', zod: '3', d: '1', e: '1' } },
      'src/a.ts': 'import lodash from "lodash";\nconst x = {;\nimport { z } from "zod";',
      'src/b.vue': '<script>\nimport { z } from "zod";\nconst y = {;\n</script>',
      'src/d.js': 'const d = require("d");\nreturn d;\nfunction (',
      'src/e.ts': 'declare const x: number = 1;\nrequire("e");',
    });
    const r = runCli(['--json'], tmpDir);
    expect(r.stderr).toMatch(
      /warning: the parser stopped at an error in \S*src\/a\.ts \(Unexpected token at line 2\); only its import and export statements before the error count\./,
    );
    expect(r.stderr).toMatch(/warning: the parser stopped at an error in \S*src\/b\.vue \(\S.* at line 3\)/);
    expect(r.stderr).toMatch(/warning: the parser stopped at an error in \S*src\/d\.js \(Expected function name at line 3\)/);
    expect(r.stderr).toMatch(
      /warning: the parser reported an error in \S*src\/e\.ts \(Initializers are not allowed in ambient contexts\. at line 1\); the imports it read still count\./,
    );
    expect(JSON.parse(r.stdout).unused).toEqual(['d']);
  });

  test('a script without import or export parses as CommonJS, where a top-level return is legal', async () => {
    await writeFiles(tmpDir, {
      'package.json': { dependencies: { lodash: '4', zod: '3' } },
      'login.js': 'const _ = require("lodash");\nif (!_) return;\nrequire("zod");',
      'src/a.js': 'import { z } from "zod";\nreturn;',
    });
    const r = runCli(['--json'], tmpDir);
    expect(r.stderr).not.toContain('login.js');
    expect(r.stderr).toMatch(/warning: the parser reported an error in \S*src\/a\.js/);
    expect(JSON.parse(r.stdout).unused).toEqual([]);
  });

  test('warns about a source directory it cannot read as about a source file', async () => {
    await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ dependencies: { lodash: '^4.0.0' } }));
    await mkdir(path.join(tmpDir, 'src/locked'), { recursive: true });
    await writeFile(path.join(tmpDir, 'src/locked/a.ts'), "import _ from 'lodash';");
    await chmod(path.join(tmpDir, 'src/locked'), 0o000);
    const r = runCli(['--json'], tmpDir);
    await chmod(path.join(tmpDir, 'src/locked'), 0o755);
    expect(r.stderr).toMatch(/warning: skipped \/\S*\/src\/locked \(/);
    expect(r.stderr).toContain('its imports are not counted');
  });

  test('warns about project inputs it cannot use and goes on', async () => {
    await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ dependencies: { lodash: '^4.0.0' } }));
    await mkdir(path.join(tmpDir, 'weird'));
    await writeFile(path.join(tmpDir, 'weird/package.json'), '{"name":');
    await writeFile(path.join(tmpDir, 'weird/index.ts'), "import _ from 'lodash';\nexport default _;");
    const r = runCli(['--json'], tmpDir);
    expect(r.stderr).toContain('warning: could not use weird/package.json');
    expect(r.status).toBe(0);
  });

  test('names each nested package it leaves out, and credits the root with what it does not declare', async () => {
    await writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        workspaces: ['packages/*'],
        devDependencies: { '@happy-dom/global-registrator': '^20.0.0', dayjs: '^1.0.0', zod: '^3.0.0' },
      }),
    );
    await mkdir(path.join(tmpDir, 'packages/shared-ui/src'), { recursive: true });
    await writeFile(
      path.join(tmpDir, 'packages/shared-ui/package.json'),
      '{"name":"shared-ui","dependencies":{"dayjs":"1"},"optionalDependencies":{"zod":"3"}}',
    );
    await writeFile(
      path.join(tmpDir, 'packages/shared-ui/src/happydom-setup.ts'),
      "import '@happy-dom/global-registrator';\nimport 'dayjs';\nimport 'zod';",
    );
    const r = runCli(['--json', '-a'], tmpDir);
    expect(r.stderr).toContain('note: left out packages/shared-ui');
    expect(JSON.parse(r.stdout).unused).toEqual(['dayjs', 'zod']);
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

  test('optionalDependencies ship like dependencies: never misplaced, unused by default', async () => {
    await writeFiles(tmpDir, {
      'package.json': {
        optionalDependencies: { bufferutil: '4', fsevents: '2' },
        devDependencies: { bufferutil: '4', 'utf-8-validate': '6' },
      },
      'src/index.ts': 'export const b = require("bufferutil");\nexport const u = await import("utf-8-validate");',
    });

    const r = runCli(['--json'], tmpDir);
    expect(JSON.parse(r.stdout)).toMatchObject({
      unused: ['fsevents'],
      misplaced: [{ packageName: 'utf-8-validate' }],
      totalIssues: 2,
    });
  });

  test('a # import uses the packages its package.json "imports" maps it to', async () => {
    await writeFiles(tmpDir, {
      'package.json': {
        type: 'module',
        imports: {
          '#dep': 'alpha',
          '#x': { node: { import: 'beta' }, default: './src/x.js' },
          '#lib/*': ['gamma/*'],
          '#lib/own/*': './src/own/*',
          '#tool': 'zeta',
        },
        dependencies: { alpha: '1', beta: '1', gamma: '1', delta: '1' },
        devDependencies: { zeta: '1' },
      },
      'src/index.js': 'import "#dep";\nimport "#x";\nimport "#lib/a.js";\nimport "#lib/own/b.js";\nimport "#tool";',
    });

    const r = runCli(['--json'], tmpDir);
    expect(JSON.parse(r.stdout)).toMatchObject({
      unused: ['delta'],
      misplaced: [{ packageName: 'zeta', locations: [{ line: 5, importStatement: 'import "#tool";' }] }],
      totalIssues: 2,
    });
  });

  test('a tsconfig paths alias or baseUrl file is local; a paths target that is no project file is a package', async () => {
    await writeFiles(tmpDir, {
      'package.json': {
        dependencies: { utils: '1', components: '1', lodash: '4', 'lodash-es': '4', gone: '1', stale: '1', react: '1', preact: '1' },
        devDependencies: { '@app/core': '1' },
      },
      'tsconfig.json': {
        compilerOptions: {
          baseUrl: 'src',
          paths: {
            'utils/*': ['utils/*'],
            '@app/*': ['*'],
            lodash: ['lodash-es'],
            'gone/*': ['gone/*'],
            'stale/*': ['utils/stale/*'],
            react: ['../node_modules/preact/compat'],
          },
        },
      },
      'src/utils/format.ts': 'export const f = 1;',
      'src/utils/data.json': '{}',
      'src/core.ts': 'export const c = 1;',
      'src/components/button.ts': 'export const b = 1;',
      'src/index.ts': [
        'import { f } from "utils/format";',
        'import data from "utils/data.json";',
        'import { c } from "@app/core";',
        'import { b } from "components/button";',
        'import merge from "lodash";',
        'import { g } from "gone/x";',
        'import { s } from "stale/x";',
        'import { h } from "react";',
        'console.log(f, data, c, b, merge, g, s, h);',
      ].join('\n'),
    });

    const r = runCli(['--json', '-a'], tmpDir);
    expect(JSON.parse(r.stdout)).toMatchObject({ unused: ['utils', 'components', 'lodash', 'react', '@app/core'], misplaced: [] });
  });

  test.each([
    [
      'paths outside the tsconfig include',
      {
        'tsconfig.json': { compilerOptions: { baseUrl: '.', paths: { 'utils/*': ['src/utils/*'] } }, include: ['src'] },
        'src/utils/format.ts': 'export const f = 1;',
        'server/index.js': 'import { f } from "utils/format";',
      },
    ],
    [
      'baseUrl outside the tsconfig include',
      {
        'tsconfig.json': { compilerOptions: { baseUrl: 'src' }, include: ['src'] },
        'src/utils/format.ts': 'export const f = 1;',
        'server/index.js': 'import { f } from "utils/format";',
      },
    ],
    [
      'a baseUrl file under node_modules',
      {
        'tsconfig.json': { compilerOptions: { baseUrl: 'node_modules' } },
        'node_modules/utils/package.json': { name: 'utils' },
        'node_modules/utils/format.js': 'export const f = 1;',
        'src/a.ts': 'import { f } from "utils/format";\nconsole.log(f);',
      },
    ],
    [
      'a paths target resolved into node_modules',
      {
        'tsconfig.json': { compilerOptions: { baseUrl: 'node_modules', paths: { 'u/*': ['utils/*'] } } },
        'node_modules/utils/package.json': { name: 'utils' },
        'node_modules/utils/format.js': 'export const f = 1;',
        'src/a.ts': 'import { f } from "u/format";\nconsole.log(f);',
      },
    ],
  ])('%s still loads the package', async (_, files) => {
    await writeFiles(tmpDir, { 'package.json': { dependencies: { utils: '1' } }, ...files });

    const r = runCli(['--json'], tmpDir);
    expect(JSON.parse(r.stdout).unused).toEqual([]);
  });

  test.each([
    [
      'a ?query suffix on a paths or baseUrl file',
      ['utils', 'components'],
      {
        'package.json': { dependencies: { utils: '1', components: '1' } },
        'tsconfig.json': { compilerOptions: { baseUrl: '.', paths: { 'utils/*': ['./src/utils/*'] } } },
        'src/utils/icon.svg': '<svg/>',
        'components/Button.tsx': 'export const B = 1;',
        'src/x.ts': 'import u from "utils/icon.svg?raw";\nimport k from "components/Button?inline";\nconsole.log(u, k);',
      },
    ],
    [
      'a paths or baseUrl file written with .js for its .ts source',
      ['shared', 'utils'],
      {
        'package.json': { dependencies: { shared: '1', utils: '1' } },
        'tsconfig.json': {
          compilerOptions: { module: 'nodenext', paths: { shared: ['./src/shared/index.js'], 'utils/*': ['./src/utils/*'] } },
        },
        'src/shared/index.ts': 'export const s = 1;',
        'src/utils/fmt.ts': 'export const f = 1;',
        'src/x.ts': 'import "shared";\nimport "utils/fmt.js";',
      },
    ],
    [
      'a paths entry that points only at declarations',
      [],
      {
        'package.json': { dependencies: { pkg: '1', react: '1' }, devDependencies: { '@types/react': '1' } },
        'tsconfig.json': { compilerOptions: { paths: { pkg: ['./local/pkg.d.ts'], react: ['./node_modules/@types/react/index.d.ts'] } } },
        'local/pkg.d.ts': 'export declare const x: () => void;',
        'node_modules/@types/react/index.d.ts': 'export declare const useState: () => void;',
        'src/a.ts': 'import { x } from "pkg";\nimport { useState } from "react";\nx();\nuseState();',
      },
    ],
  ])('%s resolves as tsc does', async (_, unused, files) => {
    await writeFiles(tmpDir, files);
    const r = runCli(['--json', '-a'], tmpDir);
    expect(JSON.parse(r.stdout)).toMatchObject({ unused, misplaced: [] });
  });

  test('a project stored under a node_modules directory still resolves its own aliases', async () => {
    await writeFiles(tmpDir, {
      'node_modules/proj/package.json': { dependencies: { react: '1', zod: '1', proj: '1' } },
      'node_modules/proj/tsconfig.json': { compilerOptions: { baseUrl: '.', paths: { '~/*': ['./src/*'] } } },
      'node_modules/proj/src/b.ts': 'export const b = 1;',
      'node_modules/proj/src/a.ts': 'import { b } from "~/b";\nimport "react";\nimport "zod";\nconsole.log(b);',
    });
    const r = runCli(['--json', 'node_modules/proj'], tmpDir);
    expect(JSON.parse(r.stdout).unused).toEqual(['proj']);
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

  test('a devDependency whose import is used only as types is not misplaced; a dependency is not typeOnly', async () => {
    await writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ dependencies: { react: '1', hotscript: '1' }, devDependencies: { '@mui/types': '7' } }),
    );
    await mkdir(path.join(tmpDir, 'src'), { recursive: true });
    await writeFile(
      path.join(tmpDir, 'src/a.ts'),
      [
        "import React from 'react';",
        "import { OverridableStringUnion } from '@mui/types';",
        "import { Pipe, Tuples } from 'hotscript';",
        "export type X = OverridableStringUnion<'a', {}> | Pipe<['a'], [Tuples.Join<''>]>;",
        'export const y = React;',
      ].join('\n'),
    );

    const r = runCli(['--json'], tmpDir);
    expect(JSON.parse(r.stdout)).toMatchObject({ misplaced: [], typeOnly: [], totalIssues: 0 });
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

  test.each([
    ['arrays', `const x = ${'['.repeat(10000)}${']'.repeat(10000)};`],
    ['object literals', `const x = ${'{a:'.repeat(10000)}1${'}'.repeat(10000)};`],
    ['type arguments', `type X = ${'Array<'.repeat(10000)}T${'>'.repeat(10000)};`],
  ])('a source with %s nested 10,000 deep is scanned', async (_, deep) => {
    await writeFiles(tmpDir, {
      'package.json': { dependencies: { zod: '1', unused: '1' } },
      'src/deep.ts': `import "zod";\n${deep}\n`,
    });

    const r = runCli(['--json'], tmpDir);
    expect(r.status).toBe(1);
    expect(JSON.parse(r.stdout).unused).toEqual(['unused']);
  });

  describe('packages used without an import', () => {
    test('a package whose binary a script or git hook runs is used', async () => {
      await writeFiles(tmpDir, {
        'package.json': {
          scripts: {
            prepare: 'husky',
            lint: 'cross-env NODE_ENV=ci oxlint src && npm run fmt',
            fmt: 'FORCE=1 pnpm exec prettier . | tee out',
            format: 'biome format',
          },
          dependencies: { husky: '9' },
          devDependencies: {
            oxlint: '1',
            'cross-env': '7',
            prettier: '3',
            'lint-staged': '15',
            '@biomejs/biome': '1',
            fmt: '1',
            vitest: '3',
            'left-pad': '1',
          },
        },
        'packages/web/package.json': { name: 'web', scripts: { test: 'vitest run' } },
        '.husky/pre-commit': 'npx lint-staged\n',
        'node_modules/@biomejs/biome/package.json': { name: '@biomejs/biome', bin: { biome: 'bin/biome' } },
        'src/a.ts': 'export const a = 1;',
      });

      const r = runCli(['--json', '-a'], tmpDir);
      expect(JSON.parse(r.stdout).unused).toEqual(['fmt', 'left-pad']);
    });

    test("a declared package that satisfies a used package's peer is used, to a fixpoint", async () => {
      await writeFiles(tmpDir, {
        'package.json': {
          scripts: { cycle: 'madge src' },
          dependencies: { next: '14', '@opentelemetry/api': '1', 'react-apexcharts': '1', apexcharts: '3', 'left-pad': '1' },
          devDependencies: { madge: '8', typescript: '5' },
        },
        'node_modules/next/package.json': {
          name: 'next',
          peerDependencies: { '@opentelemetry/api': '^1', react: '^18' },
          peerDependenciesMeta: { '@opentelemetry/api': { optional: true } },
        },
        'node_modules/react-apexcharts/package.json': { name: 'react-apexcharts', peerDependencies: { apexcharts: '^3' } },
        'node_modules/madge/package.json': { name: 'madge', bin: { madge: 'bin/cli.js' }, peerDependencies: { typescript: '^5' } },
        'src/a.js': "import next from 'next'; import Chart from 'react-apexcharts'; export default [next, Chart];",
        'src/b.ts': "import type { ApexOptions } from 'apexcharts'; export type Options = ApexOptions;",
      });

      const r = runCli(['--json', '-a'], tmpDir);
      expect(JSON.parse(r.stdout)).toMatchObject({ unused: ['left-pad'], misplaced: [], typeOnly: [] });
    });

    test('without node_modules, binaries match by package name and one note says so', async () => {
      await writeFiles(tmpDir, {
        'package.json': {
          scripts: { a: 'jest', b: 'vite build' },
          devDependencies: { jest: '29', vite: '5', '@vitejs/plugin-react': '4' },
        },
      });

      const r = runCli(['--json', '-a'], tmpDir);
      expect(JSON.parse(r.stdout).unused).toEqual(['@vitejs/plugin-react']);
      expect(r.stderr.match(/node_modules/g)).toHaveLength(1);
    });

    test('a lint-staged command runs a declared binary', async () => {
      await writeFiles(tmpDir, {
        'package.json': {
          'lint-staged': { '*.css': 'stylelint --fix' },
          devDependencies: { stylelint: '16', 'left-pad': '1' },
        },
      });

      expect(JSON.parse(runCli(['--json', '-a'], tmpDir).stdout).unused).toEqual(['left-pad']);
    });

    test('tool configs that name a package by string use it', async () => {
      await writeFiles(tmpDir, {
        'package.json': {
          devDependencies: Object.fromEntries(
            [
              '@typescript-eslint/parser',
              'eslint-plugin-relay',
              '@typescript-eslint/eslint-plugin',
              'eslint-config-prettier',
              'eslint-plugin-import',
              'eslint-plugin-unused-imports',
              'eslint-import-resolver-typescript',
              '@babel/preset-env',
              'babel-plugin-macros',
              'tailwindcss',
              'autoprefixer',
              'ts-jest',
              'jest-environment-jsdom',
              'vue-jest',
              'prettier-plugin-tailwindcss',
              '@storybook/addon-a11y',
              '@storybook/builder-vite',
              'serverless-offline',
              '@nx/jest',
              '@nx/vite',
              'typescript-plugin-css-modules',
              'terser',
              'jest-junit',
              'stylelint-config-standard',
              '@storybook/react-vite',
              'left-pad',
            ].map((name) => [name, '1']),
          ),
        },
        '.eslintrc': JSON.stringify({
          parser: '@typescript-eslint/parser',
          plugins: ['relay'],
          extends: ['prettier', 'plugin:@typescript-eslint/recommended'],
          rules: { 'import/no-cycle': 'error' },
          overrides: [{ files: ['*.ts'], rules: { 'unused-imports/no-unused-imports': 'error' } }],
          settings: { 'import/resolver': { typescript: {} } },
        }),
        '.babelrc': { presets: ['@babel/preset-env'], plugins: ['macros'] },
        'postcss.config.js': 'module.exports = { plugins: { tailwindcss: {}, autoprefixer: {} } };',
        'jest.config.ts':
          "export default { preset: 'ts-jest', testEnvironment: 'jsdom', transform: { '^.+\\\\.vue$': 'vue-jest' }, reporters: ['default', 'jest-junit'] };",
        '.stylelintrc.json': { extends: ['stylelint-config-standard'] },
        '.prettierrc.yaml': 'plugins:\n  - prettier-plugin-tailwindcss\n',
        '.storybook/main.ts':
          "export default { addons: ['@storybook/addon-a11y'], core: { builder: '@storybook/builder-vite' }, framework: { name: '@storybook/react-vite' } };",
        'serverless.yml': 'service: s\nplugins:\n  - serverless-offline\n',
        'project.json': { name: 'app', targets: { test: { executor: '@nx/jest:jest' } } },
        'libs/ui/project.json': { name: 'ui', targets: { build: { executor: '@nx/vite:build' } } },
        'tsconfig.json': { compilerOptions: { plugins: [{ name: 'typescript-plugin-css-modules' }] } },
        'vite.config.ts': "export default { build: { minify: 'terser' } };",
      });

      const r = runCli(['--json', '-a'], tmpDir);
      expect(JSON.parse(r.stdout).unused).toEqual(['left-pad']);
    });

    test('a package.json bin under scripts/ is production source', async () => {
      await writeFiles(tmpDir, {
        'package.json': {
          name: 'tool',
          bin: { tool: 'scripts/cli.js' },
          dependencies: { commander: '12' },
          devDependencies: { kleur: '4', chalk: '5' },
        },
        'scripts/cli.js': "const { program } = require('commander'); const k = require('kleur'); program.parse(k);",
        'packages/web/package.json': { name: 'web', bin: 'scripts/run.js' },
        'packages/web/scripts/run.js': "require('chalk');",
      });

      const parsed = JSON.parse(runCli(['--json'], tmpDir).stdout);
      expect(parsed.unused).toEqual([]);
      expect(parsed.misplaced.map((d: { packageName: string }) => d.packageName)).toEqual(['kleur', 'chalk']);
    });
  });
});
