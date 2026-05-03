import { A } from '@mobily/ts-belt';
import { detectBuildDirectories, detectByHeuristic } from '../utils/detect-build-dirs.js';

/**
 * File extensions that are analyzed for imports
 */
export const ANALYZABLE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'] as const;

/**
 * Patterns for production configuration files (runtime dependencies)
 */
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

/**
 * Patterns for development configuration files (devDependencies)
 */
export const DEV_CONFIG_PATTERNS = [
  'jest.config.',
  'vitest.config.',
  'babel.config.',
  'eslint.config.',
  'prettier.config.',
  'tsup.config.',
  'biome.config.',
] as const;

/**
 * Patterns for directories to exclude from analysis (Legacy/Simple substring patterns)
 */
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

/**
 * Patterns for filenames to exclude from analysis (tests, stories, etc.)
 */
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

/**
 * 빌드 출력 디렉토리 패턴
 * 각 프레임워크/도구의 기본 빌드 출력 경로
 */
export const BUILD_OUTPUT_PATTERNS = [
  // 기존 일반적인 패턴
  'dist/**',
  'build/**',
  'out/**',

  // Next.js
  '.next/**',

  // Nuxt
  '.nuxt/**',
  '.output/**',

  // Vite
  '.vite/**',

  // Storybook
  'storybook-static/**',
  '.storybook-static/**',

  // Gatsby
  '.cache/**',
  'public/**', // Gatsby의 빌드 출력

  // Docusaurus
  '.docusaurus/**',

  // VitePress
  '.vitepress/dist/**',
  '.vitepress/cache/**',

  // Astro
  '.astro/**',

  // SvelteKit
  '.svelte-kit/**',

  // Remix
  '.remix/**',

  // Webpack
  '.webpack/**',

  // Parcel
  '.parcel-cache/**',

  // Turbopack
  '.turbo/**',

  // 기타 일반적인 패턴
  'tmp/**',
  'temp/**',
  '.tmp/**',
  '.temp/**',
  'coverage/**',
  '.coverage/**',
] as const;

/**
 * 캐시 디렉토리 패턴
 */
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

/**
 * IDE 및 에디터 설정 디렉토리
 */
export const IDE_PATTERNS = [
  '.vscode/**',
  '.idea/**',
  '.fleet/**',
  '.vim/**',
  '.emacs.d/**',
] as const;

/**
 * 테스트 관련 파일 패턴 (Glob)
 */
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

/**
 * 스토리북 관련 패턴 (Glob)
 */
export const STORY_PATTERNS = [
  '**/stories/**',
  '**/.storybook/**',
  '**/*.stories.*',
  '**/*.story.*',
] as const;

/**
 * Glob patterns for files to completely ignore in file search
 * (Legacy, kept for backward compatibility if needed, but getAllExcludedPatterns is preferred)
 */
export const IGNORE_GLOB_PATTERNS = [
  ...EXCLUDED_DIRECTORY_PATTERNS.map((p) => `**${p}**`),
  '**/*.d.ts',
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/out/**',
  '**/coverage/**',
] as const;

/**
 * Node.js built-in modules to ignore
 */
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

/**
 * Bun built-in modules to ignore
 */
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

/**
 * Regex for matching runtime imports and require statements
 */
export const IMPORT_REGEX =
  /(?:import(?!\s+type\b)(?!\s*\{[^}]*?\btype\s+\w+\b[^}]*\}))(?:\s+(?:[\w*\s{},]*)\s+from\s+)?\s*['"]([^'"]+)['"]|require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

/**
 * Regex for matching require statements specifically
 */
export const REQUIRE_REGEX = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

/**
 * Regex for matching type-only imports
 */
export const TYPE_ONLY_IMPORT_REGEX = /import\s+type\s+[^'"]+from\s+['"]([^'"]+)['"]/g;

/**
 * Regex for matching mixed imports (value and type)
 */
export const MIXED_TYPE_IMPORT_REGEX = /import\s*\{([^}]+)\}\s*from\s+['"]([^'"]+)['"]/g;

export const MULTILINE_COMMENT_REGEX = /\/\*[\s\S]*?\*\//g;
export const SINGLE_LINE_COMMENT_REGEX = /\/\/.*$/gm;

/**
 * 모든 제외 패턴을 통합
 */
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
