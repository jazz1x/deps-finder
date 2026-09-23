import { Array } from 'effect';
import { detectBuildDirectories, detectByHeuristic } from '../utils/detect-build-dirs.js';

export const ANALYZABLE_EXTENSIONS = [
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
] as const;

export const DECLARATION_FILE_PATTERN = /\.d\.[cm]?ts$/;

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

export const TOOL_CONFIG_PATTERN = /\.config\.[cm]?[jt]sx?$/;

export const ROOT_TOOLING_DIRECTORIES = ['scripts/'] as const;

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

  return Array.dedupe([...staticPatterns, ...dynamicPatterns]);
};
