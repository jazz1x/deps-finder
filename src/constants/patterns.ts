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

export const ROOT_TOOL_CONFIG_PATTERN = /\.(config|preset)\./;

export const ROOT_TOOLING_DIRECTORIES = ['scripts'] as const;

export const DEVELOPMENT_DIRECTORIES = [
  '.storybook',
  'test',
  'tests',
  '__tests__',
  '__mocks__',
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
  'happydom-setup.',
  'happy-dom-setup.',
  'setup-tests.',
  'test-setup.',
] as const;

// .gitignore syntax: a leading slash anchors the entry at rootDir.
export const ALWAYS_EXCLUDED = [
  '.git/',
  'node_modules/',
  '/dist/',
  '/build/',
  '/out/',
  '/coverage/',
] as const;

export const EXCLUDED_WITHOUT_GITIGNORE = [
  '/.next/',
  '/.nuxt/',
  '/.output/',
  '/.vite/',
  '/storybook-static/',
  '/.storybook-static/',
  '/public/',
  '/.docusaurus/',
  '/.vitepress/dist/',
  '/.vitepress/cache/',
  '/.astro/',
  '/.svelte-kit/',
  '/.remix/',
  '/.webpack/',
  '/.parcel-cache/',
  '/.turbo/',
  '/tmp/',
  '/temp/',
  '/.tmp/',
  '/.temp/',
  '/.coverage/',
  '/.cache/',
  '/.npm/',
  '/.yarn/',
  '/.pnpm/',
  '/.bun/',
  '/.vscode/',
  '/.idea/',
  '/.fleet/',
  '/.vim/',
  '/.emacs.d/',
] as const;
