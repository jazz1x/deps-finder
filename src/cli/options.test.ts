import { describe, expect, test } from 'bun:test';
import { parseCliOptions } from '@/cli/options';
import { HELP_TEXT } from '@/constants/messages';

describe('parseCliOptions', () => {
  test('should parse text format option', () => {
    const options = parseCliOptions(['-t']);
    expect(options.format).toBe('text');
    expect(options.checkAll).toBe(false);
    expect(options.rootDir).toBe('.');
    expect(options.packageJsonPath).toBe('./package.json');
  });

  test('should parse json format option', () => {
    const options = parseCliOptions(['-j']);
    expect(options.format).toBe('json');
    expect(options.checkAll).toBe(false);
  });

  test('should parse long format options', () => {
    const textOptions = parseCliOptions(['--text']);
    expect(textOptions.format).toBe('text');

    const jsonOptions = parseCliOptions(['--json']);
    expect(jsonOptions.format).toBe('json');
  });

  test('should parse checkAll option', () => {
    const options = parseCliOptions(['-a']);
    expect(options.checkAll).toBe(true);

    const longOptions = parseCliOptions(['--all']);
    expect(longOptions.checkAll).toBe(true);
  });

  test('should parse help option', () => {
    const options = parseCliOptions(['-h']);
    expect(options.showHelp).toBe(true);
  });

  test('should use default options when no args provided', () => {
    const options = parseCliOptions([]);
    expect(options.format).toBe('text');
    expect(options.rootDir).toBe('.');
    expect(options.packageJsonPath).toBe('./package.json');
    expect(options.checkAll).toBe(false);
    expect(options.showHelp).toBe(false);
  });

  test('should parse multiple options together', () => {
    const options = parseCliOptions(['-j', '-a']);
    expect(options.format).toBe('json');
    expect(options.checkAll).toBe(true);
  });

  test('should handle long help option', () => {
    const options = parseCliOptions(['--help']);
    expect(options.showHelp).toBe(true);
  });

  test('should handle invalid options', () => {
    const options = parseCliOptions(['--invalid']);
    expect(options.format).toBe('text');
  });

  test('should warn on unknown flags', () => {
    const options = parseCliOptions(['--invalid']);
    expect(options.warnings.some((w) => w.includes('--invalid'))).toBe(true);
  });

  test('should not warn on positional (non-flag) args', () => {
    const options = parseCliOptions(['some-positional']);
    expect(options.warnings).toEqual([]);
  });

  test('should default warnings to empty array', () => {
    const options = parseCliOptions([]);
    expect(options.warnings).toEqual([]);
  });

  test('should parse mixed short and long options', () => {
    const options = parseCliOptions(['-t', '--all']);
    expect(options.format).toBe('text');
    expect(options.checkAll).toBe(true);
  });

  test('should prioritize last format option', () => {
    const options = parseCliOptions(['-t', '-j']);
    expect(options.format).toBe('json');
  });

  test('should have correct default values', () => {
    const options = parseCliOptions([]);
    expect(typeof options.format).toBe('string');
    expect(typeof options.rootDir).toBe('string');
    expect(typeof options.packageJsonPath).toBe('string');
    expect(typeof options.checkAll).toBe('boolean');
  });

  test('should handle multiple checkAll flags', () => {
    const options = parseCliOptions(['-a', '--all']);
    expect(options.checkAll).toBe(true);
  });
});

describe('parseCliOptions with ignore option', () => {
  test('should parse ignore option with single package', () => {
    const options = parseCliOptions(['--ignore', 'storybook']);
    expect(options.ignoredPackages).toEqual(['storybook']);
  });

  test('should parse ignore option with comma-separated packages', () => {
    const options = parseCliOptions(['--ignore', 'storybook,eslint,prettier']);
    expect(options.ignoredPackages).toEqual(['storybook', 'eslint', 'prettier']);
  });

  test('should parse short ignore option', () => {
    const options = parseCliOptions(['-i', '@storybook/nextjs-vite']);
    expect(options.ignoredPackages).toEqual(['@storybook/nextjs-vite']);
  });

  test('should parse multiple ignore options', () => {
    const options = parseCliOptions(['--ignore', 'storybook', '-i', 'eslint']);
    expect(options.ignoredPackages).toContain('storybook');
    expect(options.ignoredPackages).toContain('eslint');
  });

  test('should have empty ignorePackages by default', () => {
    const options = parseCliOptions([]);
    expect(options.ignoredPackages).toEqual([]);
  });

  test('should ignore --ignore without value but warn', () => {
    const options = parseCliOptions(['--ignore', '-j']);
    expect(options.ignoredPackages).toEqual([]);
    expect(options.format).toBe('json');
    expect(options.warnings.some((w) => w.includes('--ignore'))).toBe(true);
  });

  test('should combine ignore with other options', () => {
    const options = parseCliOptions(['-j', '--all', '--ignore', 'storybook,eslint']);
    expect(options.format).toBe('json');
    expect(options.checkAll).toBe(true);
    expect(options.ignoredPackages).toEqual(['storybook', 'eslint']);
  });
});

describe('parseCliOptions with exclude option', () => {
  test('should parse --exclude with single pattern', () => {
    const options = parseCliOptions(['--exclude', 'dist/**']);
    expect(options.excludePatterns).toEqual(['dist/**']);
  });

  test('should parse --exclude with comma-separated patterns', () => {
    const options = parseCliOptions(['--exclude', 'dist/**,build/**,coverage/**']);
    expect(options.excludePatterns).toEqual(['dist/**', 'build/**', 'coverage/**']);
  });

  test('should parse short -e option', () => {
    const options = parseCliOptions(['-e', 'tmp/**']);
    expect(options.excludePatterns).toEqual(['tmp/**']);
  });

  test('should accumulate across multiple -e/--exclude flags', () => {
    const options = parseCliOptions(['--exclude', 'dist/**', '-e', 'build/**']);
    expect(options.excludePatterns).toContain('dist/**');
    expect(options.excludePatterns).toContain('build/**');
  });

  test('should default to empty excludePatterns', () => {
    const options = parseCliOptions([]);
    expect(options.excludePatterns).toEqual([]);
  });

  test('should ignore --exclude when next arg is another flag but warn', () => {
    const options = parseCliOptions(['--exclude', '-j']);
    expect(options.excludePatterns).toEqual([]);
    expect(options.format).toBe('json');
    expect(options.warnings.some((w) => w.includes('--exclude'))).toBe(true);
  });

  test('should ignore --exclude when value is missing but warn', () => {
    const options = parseCliOptions(['--exclude']);
    expect(options.excludePatterns).toEqual([]);
    expect(options.warnings.some((w) => w.includes('--exclude'))).toBe(true);
  });

  test('should combine exclude with other options', () => {
    const options = parseCliOptions(['-j', '--all', '--exclude', 'dist/**,build/**']);
    expect(options.format).toBe('json');
    expect(options.checkAll).toBe(true);
    expect(options.excludePatterns).toEqual(['dist/**', 'build/**']);
  });
});

describe('parseCliOptions with --check-peer option', () => {
  test('should default checkPeer to false', () => {
    const options = parseCliOptions([]);
    expect(options.checkPeer).toBe(false);
  });

  test('should set checkPeer when --check-peer is passed', () => {
    const options = parseCliOptions(['--check-peer']);
    expect(options.checkPeer).toBe(true);
  });

  test('should set checkPeer when -p alias is passed', () => {
    const options = parseCliOptions(['-p']);
    expect(options.checkPeer).toBe(true);
  });

  test('should combine --check-peer with other options', () => {
    const options = parseCliOptions(['-j', '--check-peer', '--ignore', 'foo']);
    expect(options.checkPeer).toBe(true);
    expect(options.format).toBe('json');
    expect(options.ignoredPackages).toEqual(['foo']);
  });

  test('does not silently turn checkAll on when --check-peer is passed alone', () => {
    const options = parseCliOptions(['--check-peer']);
    expect(options.checkAll).toBe(false);
  });
});

describe('parseCliOptions with --no-auto-detect option', () => {
  test('should default noAutoDetect to false', () => {
    const options = parseCliOptions([]);
    expect(options.noAutoDetect).toBe(false);
  });

  test('should set noAutoDetect when flag is passed', () => {
    const options = parseCliOptions(['--no-auto-detect']);
    expect(options.noAutoDetect).toBe(true);
  });

  test('should combine --no-auto-detect with other options', () => {
    const options = parseCliOptions(['--no-auto-detect', '-j', '--exclude', 'dist/**']);
    expect(options.noAutoDetect).toBe(true);
    expect(options.format).toBe('json');
    expect(options.excludePatterns).toEqual(['dist/**']);
  });
});

describe('HELP_TEXT', () => {
  test('should contain usage info', () => {
    expect(HELP_TEXT).toContain('deps-finder');
    expect(HELP_TEXT).toContain('Usage:');
    expect(HELP_TEXT).toContain('-t, --text');
  });
});
