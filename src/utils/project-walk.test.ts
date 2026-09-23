import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
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

  test('leaves out a named package that declares dependencies, and reports a broken one', async () => {
    await put('src/index.ts');
    await put('packages/a/package.json', '{"name":"a","devDependencies":{"vite":"7"}}');
    await put('packages/a/src/index.ts');
    await put('libs/b/package.json', '{"name":"b"}');
    await put('libs/b/src/index.ts');
    await put('src/ui/package.json', '{"sideEffects":false}');
    await put('src/ui/index.ts');
    await put('pkgs/bad/package.json', '{"name":');
    await put('pkgs/bad/index.ts');

    expect(walked()).toEqual(['libs/b/src/index.ts', 'pkgs/bad/index.ts', 'src/index.ts', 'src/ui/index.ts']);
    expect(walkProject(testDir, RULES).packages).toEqual(['packages/a']);
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
    await put('.vscode/settings.js');

    expect(walked()).toEqual(['src/index.ts']);

    await put('.gitignore', 'logs\n');

    expect(walked()).toEqual(['.vscode/settings.js', 'src/index.ts']);
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
