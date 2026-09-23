import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ALWAYS_EXCLUDED, BUILD_OUTPUT_DIRECTORIES, EXCLUDED_WITHOUT_GITIGNORE } from '@/constants/patterns';
import { FileError } from '@/domain/errors';
import { shouldAnalyzeFile } from '@/parsers/import-parser';
import { walkProject } from './project-walk';

const RULES = {
  always: ALWAYS_EXCLUDED,
  atLayoutRoots: BUILD_OUTPUT_DIRECTORIES,
  withoutGitignore: EXCLUDED_WITHOUT_GITIGNORE,
  isSource: shouldAnalyzeFile,
};

const tagOf = FileError.$match({
  FileNotFound: () => 'FileNotFound',
  ReadFailed: () => 'ReadFailed',
  ParseFailed: () => 'ParseFailed',
});

const skippedIn = (root: string) => walkProject(root, RULES).skipped.map((e) => [tagOf(e), path.relative(root, e.path)]);

describe('walkProject', () => {
  let testDir = '';

  const put = async (file: string, content = '') => {
    await mkdir(path.dirname(path.join(testDir, file)), { recursive: true });
    await writeFile(path.join(testDir, file), content);
  };

  const walked = (root = testDir) =>
    walkProject(root, RULES)
      .found.map((source) => source.path)
      .toSorted();

  beforeEach(async () => {
    testDir = await mkdtemp(path.join(tmpdir(), 'depsfinder-walk-'));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  test('skips node_modules at any depth and .git', async () => {
    await put('src/index.ts');
    await put('node_modules/a/index.js');
    await put('packages/a/node_modules/b/index.js');
    await put('.git/hooks/hook.js');

    expect(walked()).toEqual(['src/index.ts']);
  });

  const packagesOf = (root = testDir) =>
    walkProject(root, RULES)
      .packages.map((leftOut) => leftOut.dir)
      .toSorted();

  test('leaves out array-form workspace members, honouring negation', async () => {
    await put('package.json', '{"workspaces":["!packages/keep","./packages/*/"]}');
    await put('pnpm-workspace.yaml', 'packages:\n# none yet\n');
    await put('packages/a/package.json', '{"name":"a"}');
    await put('packages/a/index.ts');
    await put('packages/keep/package.json', '{"name":"keep"}');
    await put('packages/keep/index.ts');
    await put('packages/group/nested/package.json', '{"name":"nested"}');
    await put('packages/group/nested/index.ts');
    await put('packages/docs/index.ts');

    expect(packagesOf()).toEqual(['packages/a']);
    expect(walked()).toEqual(['packages/docs/index.ts', 'packages/group/nested/index.ts', 'packages/keep/index.ts']);
    expect(skippedIn(testDir)).toEqual([]);
  });

  test('leaves out object-form workspace members', async () => {
    await put('package.json', '{"workspaces":{"packages":["apps/*"],"nohoist":["**/x"]}}');
    await put('pnpm-workspace.yaml', '# none yet\n');
    await put('apps/web/package.json', '{"name":"web"}');
    await put('apps/web/index.ts');

    expect(packagesOf()).toEqual(['apps/web']);
    expect(walked()).toEqual([]);
    expect(skippedIn(testDir)).toEqual([]);
  });

  test('a globstar workspace glob also claims its base directory', async () => {
    await put('package.json', '{"workspaces":["libs/**"]}');
    await put('libs/package.json', '{"name":"libs"}');
    await put('libs/top.ts');

    expect(packagesOf()).toEqual(['libs']);
    expect(walked()).toEqual([]);
  });

  test('leaves out pnpm-workspace.yaml members, honouring negation', async () => {
    await put('pnpm-workspace.yaml', "packages:\n  - '!**/test/**'\n  - 'packages/**'\n");
    await put('packages/a/package.json', '{}');
    await put('packages/a/index.ts');
    await put('packages/b/test/pkg/package.json', '{"name":"pkg"}');
    await put('packages/b/test/pkg/index.ts');

    expect(packagesOf()).toEqual(['packages/a']);
    expect(walked()).toEqual(['packages/b/test/pkg/index.ts']);
  });

  test('npm: a later positive re-includes a negated member, and a leading slash is stripped', async () => {
    await put('package.json', '{"workspaces":["packages/*","!packages/b","packages/b","/tools/x"]}');
    await put('packages/a/package.json', '{"name":"a"}');
    await put('packages/b/package.json', '{"name":"b"}');
    await put('tools/x/package.json', '{"name":"x"}');

    expect(packagesOf()).toEqual(['packages/a', 'packages/b', 'tools/x']);
  });

  test('pnpm: a negation wins wherever it sits', async () => {
    await put('pnpm-workspace.yaml', "packages:\n  - 'packages/*'\n  - '!packages/b'\n  - 'packages/b'\n");
    await put('packages/a/package.json', '{"name":"a"}');
    await put('packages/b/package.json', '{"name":"b"}');

    expect(packagesOf()).toEqual(['packages/a']);
  });

  test('a null workspaces field declares no members', async () => {
    await put('package.json', '{"workspaces":null}');
    await put('packages/a/package.json', '{"name":"a"}');
    await put('packages/a/index.ts');

    expect(walked()).toEqual(['packages/a/index.ts']);
    expect(skippedIn(testDir)).toEqual([]);
  });

  test('warns about a malformed workspace declaration instead of guessing', async () => {
    await put('package.json', '{"workspaces":"packages/*"}');
    await put('pnpm-workspace.yaml', 'packages: [a\n');
    await put('packages/a/package.json', '{"name":"a"}');
    await put('packages/a/index.ts');

    expect(packagesOf()).toEqual([]);
    expect(skippedIn(testDir)).toEqual([
      ['ParseFailed', 'package.json#workspaces'],
      ['ParseFailed', 'pnpm-workspace.yaml'],
    ]);
  });

  test('a YAML warning becomes a skipped input instead of a process warning', async () => {
    const emitWarning = spyOn(process, 'emitWarning');
    await put('pnpm-workspace.yaml', 'packages: !custom\n  - packages/*\n');
    await put('packages/a/package.json', '{"name":"a"}');

    const skipped = skippedIn(testDir);
    emitWarning.mockRestore();

    expect(skipped).toEqual([['ParseFailed', 'pnpm-workspace.yaml']]);
    expect(emitWarning).not.toHaveBeenCalled();
  });

  test.each(['package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lock', 'bun.lockb', 'node_modules/'])(
    'leaves out a nested project with its own %s',
    async (install) => {
      await put('examples/demo/package.json', '{}');
      await put(install.endsWith('/') ? `examples/demo/${install}x/index.js` : `examples/demo/${install}`);
      await put('examples/demo/index.ts');

      expect(packagesOf()).toEqual(['examples/demo']);
      expect(walked()).toEqual([]);
    },
  );

  test('scans named libs that resolve from the root, and reports a broken manifest', async () => {
    await put('libs/common/package.json', '{"name":"c","dependencies":{"x":"1"},"peerDependencies":null}');
    await put('libs/common/src/index.ts');
    await put('src/ui/package.json', '{"sideEffects":false}');
    await put('src/ui/index.ts');
    await put('vendor/yarn.lock');
    await put('vendor/index.ts');
    await put('pkgs/bad/package.json', '{"name":');
    await put('pkgs/bad/index.ts');

    expect(packagesOf()).toEqual([]);
    expect(walked()).toEqual(['libs/common/src/index.ts', 'pkgs/bad/index.ts', 'src/ui/index.ts', 'vendor/index.ts']);
    expect(skippedIn(testDir)).toEqual([['ParseFailed', 'pkgs/bad/package.json']]);
  });

  test('honours root and nested .gitignore files, deeper rules winning', async () => {
    await put('.gitignore', 'generated/\n*.gen.ts\n');
    await put('tools/.gitignore', 'cache/\n!keep.gen.ts\n');
    await put('src/index.ts');
    await put('src/api.gen.ts');
    await put('generated/client.ts');
    await put('tools/cache/chunk.js');
    await put('tools/keep.gen.ts');

    expect(walked()).toEqual(['src/index.ts', 'tools/keep.gen.ts']);
  });

  test('uses the built-in cache and IDE exclusions only when no .gitignore exists', async () => {
    await put('src/index.ts');
    await put('apps/web/package.json', '{"name":"web"}');
    await put('apps/web/.next/server/chunk.js');
    await put('apps/web/public/sw.js');
    await put('src/public/icon.ts');
    await put('src/.vscode/settings.js');
    await put('tools/.claude/worktrees/feat/src/index.ts');
    await put('tools/py/.venv/lib/site-packages/x.js');
    await put('android/.gradle/cache.js');
    await put('tools/.idea/x.js');

    expect(walked()).toEqual(['src/index.ts', 'src/public/icon.ts']);

    await put('.gitignore', 'logs\n');

    expect(walked()).toEqual([
      'android/.gradle/cache.js',
      'apps/web/.next/server/chunk.js',
      'apps/web/public/sw.js',
      'src/.vscode/settings.js',
      'src/index.ts',
      'src/public/icon.ts',
      'tools/.claude/worktrees/feat/src/index.ts',
      'tools/.idea/x.js',
      'tools/py/.venv/lib/site-packages/x.js',
    ]);
  });

  test('applies .gitignore files above rootDir up to the repository top, and info/exclude', async () => {
    await mkdir(path.join(testDir, '.git/info'), { recursive: true });
    await put('.git/info/exclude', 'scratch/\n');
    await put('.gitignore', '.next\ngenerated/\n');
    await put('apps/web/.gitignore', '*.log\n');
    await put('apps/web/src/index.ts');
    await put('apps/web/.next/server/chunk.js');
    await put('apps/web/generated/g.ts');
    await put('apps/web/scratch/x.ts');

    expect(walked(path.join(testDir, 'apps/web'))).toEqual(['src/index.ts']);
  });

  test('reports an unreadable .gitignore above rootDir and an unreadable info/exclude', async () => {
    await put('.git/info/exclude', 'scratch/\n');
    await put('.gitignore', 'generated/\n');
    await put('apps/web/src/index.ts');
    await chmod(path.join(testDir, '.git/info/exclude'), 0o000);
    await chmod(path.join(testDir, '.gitignore'), 0o000);

    expect(skippedIn(path.join(testDir, 'apps/web'))).toEqual([
      ['ReadFailed', '../../.git/info/exclude'],
      ['ReadFailed', '../../.gitignore'],
    ]);
  });

  test('scans a rootDir that its repository ignores', async () => {
    await mkdir(path.join(testDir, '.git'));
    await put('.gitignore', 'sandbox/\n');
    await put('sandbox/src/index.ts');

    expect(walked(path.join(testDir, 'sandbox'))).toEqual(['src/index.ts']);
  });

  test('reads no info/exclude from a linked worktree, whose .git is a file', async () => {
    await put('.git', 'gitdir: /elsewhere/.git/worktrees/wt\n');
    await put('src/index.ts');

    expect(skippedIn(testDir)).toEqual([]);
  });

  test('matches .gitignore patterns case-sensitively, whatever core.ignorecase says', async () => {
    await put('.gitignore', 'Generated/\n');
    await put('src/generated/x.ts');

    expect(walked()).toEqual(['src/generated/x.ts']);
  });

  test('follows symlinked files, including a symlinked .gitignore', async () => {
    const outside = await mkdtemp(path.join(tmpdir(), 'depsfinder-walk-outside-'));
    await writeFile(path.join(outside, 's.ts'), '');
    await writeFile(path.join(outside, 'ignore'), 'gen/\n');
    await put('src/index.ts');
    await put('gen/x.ts');
    await symlink(path.join(outside, 's.ts'), path.join(testDir, 'src/shared.ts'));
    await symlink(path.join(outside, 'ignore'), path.join(testDir, '.gitignore'));

    const found = walked();
    await rm(outside, { recursive: true, force: true });

    expect(found).toEqual(['src/index.ts', 'src/shared.ts']);
  });

  test('reports a dangling symlink', async () => {
    await put('src/index.ts');
    await symlink(path.join(testDir, 'missing.ts'), path.join(testDir, 'src/gone.ts'));

    expect(skippedIn(testDir)).toEqual([['FileNotFound', 'src/gone.ts']]);
  });

  test('ignores a dangling symlink to a file it would not analyze', async () => {
    await put('src/index.ts');
    await symlink('/nonexistent/README.md', path.join(testDir, 'docs-link.md'));
    await symlink('../nope', path.join(testDir, 'src/brokendir'));

    expect(skippedIn(testDir)).toEqual([]);
  });

  test('reports an unreadable .gitignore and an unreadable directory', async () => {
    await put('src/index.ts');
    await put('src/.gitignore', 'index.ts');
    await put('locked/a.ts');
    await chmod(path.join(testDir, 'src/.gitignore'), 0o000);
    await chmod(path.join(testDir, 'locked'), 0o000);

    const { found, skipped } = walkProject(testDir, RULES);
    await chmod(path.join(testDir, 'locked'), 0o755);

    expect(found.map((source) => source.path)).toEqual(['src/index.ts']);
    expect(skipped.every(FileError.$is('ReadFailed'))).toBe(true);
    expect(skipped.map((e) => path.relative(testDir, e.path)).toSorted()).toEqual(['locked', 'src/.gitignore']);
  });
});
