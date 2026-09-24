export const TYPESCRIPT_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts'] as const;

export const COMPONENT_EXTENSIONS = ['.vue', '.svelte', '.astro'] as const;

// Indented Sass (.sass) and Stylus (.styl) are not read.
export const STYLESHEET_EXTENSIONS = ['.css', '.pcss', '.postcss', '.scss', '.less'] as const;

export const ANALYZABLE_EXTENSIONS = [
  ...TYPESCRIPT_EXTENSIONS,
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  ...COMPONENT_EXTENSIONS,
  ...STYLESHEET_EXTENSIONS,
] as const;

export const DECLARATION_FILE_PATTERN = /\.d\.[cm]?ts$/;

export const TSCONFIG_FILE_PATTERN = /^tsconfig.*\.json$/;

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

// .gitignore syntax. An entry without a leading slash matches at any depth.
export const ALWAYS_EXCLUDED = ['.git/', 'node_modules/'] as const;

// A leading slash anchors the entry at every layout root (see project-walk.ts).
export const BUILD_OUTPUT_DIRECTORIES = ['/dist/', '/build/', '/out/', '/coverage/'] as const;

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
  '.vscode/',
  '.idea/',
  '.venv/',
  '.gradle/',
  '.claude/',
  '/.fleet/',
  '/.vim/',
  '/.emacs.d/',
] as const;
