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

export const ROOT_TOOL_CONFIG_PATTERN = /\.config\.[cm]?[jt]sx?$/;

export const ROOT_TOOLING_DIRECTORIES = ['scripts'] as const;

export const DEVELOPMENT_DIRECTORIES = [
  'test',
  'tests',
  '__tests__',
  '__mocks__',
  'stories',
  'e2e',
  'cypress',
  'playwright',
] as const;

export const DEVELOPMENT_FILENAME_PATTERNS = [
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
  '**/node_modules/**',
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

const VCS_PATTERNS = ['.git/**'] as const;

export const getAllExcludedPatterns = (
  projectRoot: string,
  autoDetect = true,
): ReadonlyArray<string> => {
  const staticPatterns = [
    ...BUILD_OUTPUT_PATTERNS,
    ...CACHE_PATTERNS,
    ...IDE_PATTERNS,
    ...VCS_PATTERNS,
    '**/*.d.ts',
  ];

  const dynamicPatterns = autoDetect
    ? [...detectBuildDirectories(projectRoot), ...detectByHeuristic(projectRoot)]
    : [];

  return Array.dedupe([...staticPatterns, ...dynamicPatterns]);
};
