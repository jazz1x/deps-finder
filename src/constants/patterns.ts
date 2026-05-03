import { A } from '@mobily/ts-belt';
import { detectBuildDirectories, detectByHeuristic } from '../utils/detect-build-dirs.js';

export const ANALYZABLE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'] as const;

export const PRODUCTION_CONFIG_PATTERNS = [
  /^next\.config\.(js|ts|mjs|cjs)$/,
  /^next-[^/]+\.config\.(js|ts|mjs|cjs)$/,
  /^webpack\.config\.(js|ts|mjs|cjs)$/,
  /^vite\.config\.(js|ts|mjs|cjs)$/,
  /^rollup\.config\.(js|ts|mjs|cjs)$/,
  /^postcss\.config\.(js|ts|mjs|cjs)$/,
  /^tailwind\.config\.(js|ts|mjs|cjs)$/,
  /^esbuild\.config\.(js|ts|mjs|cjs)$/,
] as const;

export const DEV_CONFIG_PATTERNS = [
  'jest.config.',
  'vitest.config.',
  'babel.config.',
  'eslint.config.',
  'prettier.config.',
  'tsup.config.',
  'biome.config.',
] as const;

export const EXCLUDED_DIRECTORY_PATTERNS = [
  'node_modules/',
  'dist/',
  'build/',
  'out/',
  '/test/',
  '/tests/',
  '/__tests__/',
  '/__mocks__/',
  '/stories/',
  '/.storybook/',
  '/coverage/',
  '/e2e/',
  '/cypress/',
  '/playwright/',
] as const;

export const EXCLUDED_FILENAME_PATTERNS = [
  '.test.',
  '.spec.',
  '.stories.',
  '.story.',
  'testing-library.',
  'test-utils.',
  'setupTests.',
  'jest.setup.',
  'vitest.setup.',
  'happydom.',
  'happy-dom.',
  'setup-tests.',
  'test-setup.',
] as const;

export const BUILD_OUTPUT_PATTERNS = [
  'dist/**',
  'build/**',
  'out/**',
  '.next/**',
  '.nuxt/**',
  '.output/**',
  '.vite/**',
  'storybook-static/**',
  '.storybook-static/**',
  '.cache/**',
  'public/**',
  '.docusaurus/**',
  '.vitepress/dist/**',
  '.vitepress/cache/**',
  '.astro/**',
  '.svelte-kit/**',
  '.remix/**',
  '.webpack/**',
  '.parcel-cache/**',
  '.turbo/**',
  'tmp/**',
  'temp/**',
  '.tmp/**',
  '.temp/**',
  'coverage/**',
  '.coverage/**',
] as const;

export const CACHE_PATTERNS = [
  'node_modules/**',
  '.cache/**',
  '.npm/**',
  '.yarn/**',
  '.pnpm/**',
  '.bun/**',
  '.eslintcache',
  '.stylelintcache',
  '**/.DS_Store',
] as const;

export const IDE_PATTERNS = [
  '.vscode/**',
  '.idea/**',
  '.fleet/**',
  '.vim/**',
  '.emacs.d/**',
] as const;

export const TEST_PATTERNS = [
  '**/test/**',
  '**/tests/**',
  '**/__tests__/**',
  '**/__mocks__/**',
  '**/*.test.*',
  '**/*.spec.*',
  '**/setupTests.*',
  '**/jest.setup.*',
  '**/vitest.setup.*',
] as const;

export const STORY_PATTERNS = [
  '**/stories/**',
  '**/.storybook/**',
  '**/*.stories.*',
  '**/*.story.*',
] as const;

export const NODE_BUILTIN_MODULES = [
  'fs',
  'path',
  'http',
  'https',
  'util',
  'events',
  'stream',
  'crypto',
  'os',
  'child_process',
  'url',
  'querystring',
  'buffer',
  'process',
  'assert',
  'zlib',
  'net',
  'tls',
  'dns',
  'dgram',
  'cluster',
  'vm',
  'v8',
  'timers',
  'readline',
  'repl',
  'module',
] as const;

export const BUN_BUILTIN_MODULES = ['bun', 'bun:test', 'bun:sqlite', 'bun:ffi', 'bun:jsc'] as const;

/**
 * Pre-computed lookup set for built-in modules — O(1) membership check.
 * Includes `node:`-prefixed forms of every Node builtin.
 */
export const BUILTIN_MODULE_SET: ReadonlySet<string> = new Set([
  ...NODE_BUILTIN_MODULES,
  ...NODE_BUILTIN_MODULES.map((m) => `node:${m}`),
  ...BUN_BUILTIN_MODULES,
]);

export const IMPORT_REGEX =
  /(?:import(?!\s+type\b)(?!\s*\{[^}]*?\btype\s+\w+\b[^}]*\}))(?:\s+(?:[\w*\s{},]*)\s+from\s+)?\s*['"]([^'"]+)['"]|require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

export const TYPE_ONLY_IMPORT_REGEX = /import\s+type\s+[^'"]+from\s+['"]([^'"]+)['"]/g;

export const MIXED_TYPE_IMPORT_REGEX = /import\s*\{([^}]+)\}\s*from\s+['"]([^'"]+)['"]/g;

export const MULTILINE_COMMENT_REGEX = /\/\*[\s\S]*?\*\//g;
export const SINGLE_LINE_COMMENT_REGEX = /\/\/.*$/gm;

export const getAllExcludedPatterns = (
  projectRoot: string,
  autoDetect = true,
): ReadonlyArray<string> => {
  const staticPatterns = [
    ...BUILD_OUTPUT_PATTERNS,
    ...CACHE_PATTERNS,
    ...IDE_PATTERNS,
    ...TEST_PATTERNS,
    ...STORY_PATTERNS,
    '**/*.d.ts',
  ];

  const dynamicPatterns = autoDetect
    ? [...detectBuildDirectories(projectRoot), ...detectByHeuristic(projectRoot)]
    : [];

  return A.uniq([...staticPatterns, ...dynamicPatterns]);
};
