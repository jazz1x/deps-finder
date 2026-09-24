# deps-finder

> Catch unused, misplaced, and orphan-peer dependencies in TypeScript projects.

[![npm version](https://img.shields.io/npm/v/deps-finder.svg)](https://www.npmjs.com/package/deps-finder)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node ≥22.12](https://img.shields.io/badge/node-%E2%89%A522.12-brightgreen.svg)](https://nodejs.org)
[![Bun](https://img.shields.io/badge/runtime-bun-black.svg)](https://bun.sh)
[![CI](https://github.com/jazz1x/deps-finder/actions/workflows/ci.yml/badge.svg)](https://github.com/jazz1x/deps-finder/actions/workflows/ci.yml)

deps-finder reads your `package.json`, walks the project's source files, and tells you which declared packages no source file actually imports — and which packages your code does import that live in the wrong section. It runs entirely on your machine, never phones home, and treats `peerDependencies` as a consumer contract by default (since real peers like `typescript` are intentionally never imported by the library itself). Opt in with `--check-peer` when you want orphan-peer detection.

[한국어](./README.ko.md) · English

---

## Table of contents

- [Features](#features)
- [Install](#install)
- [Quickstart](#quickstart)
- [Options](#options)
- [How it works](#how-it-works)
- [Output](#output)
- [CI integration](#ci-integration)
- [Honest-use notice](#honest-use-notice)
- [Development](#development)
- [License](#license)

---

## Features

- Detects **unused** dependencies — declared in `package.json`, never imported.
- Detects **misplaced** dependencies — used in source but living in `devDependencies`.
- Detects **orphan peers** — declared as `peerDependencies` but never imported (opt-in via `--check-peer`).
- Reports **type-only** imports separately so they don't pollute the unused list.
- Reads JS and TS sources, Vue, Svelte and Astro components, and CSS, SCSS and Less stylesheets.
- Honours `.gitignore` and auto-detects build output directories (`dist`, `build`, etc.) at the project root, and excludes them.
- Checks one package per run. In a monorepo, run it inside each workspace package.
- Outputs colorized text or machine-readable JSON.
- **Friendly errors and warnings** — actionable messages when files are missing, JSON is malformed, or a flag is given without its required value.

---

## Install

```sh
npm install -D deps-finder
```

Or run once without installing:

```sh
npx deps-finder
```

Requires Node.js ≥ 22.12.

---

## Quickstart

```sh
# from the project root (where package.json lives)
deps-finder

# JSON output for CI / scripts
deps-finder --json

# also check peerDependencies and devDependencies
deps-finder --all

# monorepo: one run per workspace package
deps-finder apps/web
```

Expected output (truncated):

```
⚠  Unused Dependencies:
  • moment

⚠  Misplaced Dependencies:
  • zod (used in 1 file)
    └─ src/api/schema.ts:5
```

---

## Options

```sh
deps-finder [options] [<root>]
```

`<root>` is the project directory that holds `package.json` (default: the current directory).

> If `--help` and this table disagree, `--help` wins — please open an issue. The source of truth is [`src/cli/command.ts`](src/cli/command.ts).

| Option | Alias | Description |
|--------|-------|-------------|
| `--text` | `-t` | Output as text (default) |
| `--json` | `-j` | Output as JSON |
| `--all` | `-a` | Also report unused `devDependencies` and `peerDependencies` (peers only under `unusedPeer`; misplaced checks stay on) |
| `--check-peer` | `-p` | Also check `peerDependencies` (off by default; on with `--all`) — see [peerDependencies note](#peerdependencies-note) |
| `--ignore <pkgs>` | `-i` | Ignore packages (comma-separated, repeatable, `--ignore=a,b`) |
| `--exclude <patterns>` | `-e` | Exclude files/dirs by `.gitignore`-style pattern; `./src/x` and absolute paths under the project are anchored at its root (comma-separated, repeatable) |
| `--no-auto-detect` | — | Disable automatic build directory detection |
| `--version` | `-v` | Print the version |
| `--help` | `-h` | Show help message |

Unknown flags and flags missing their value are errors, not warnings.

**Exit codes**

| Code | Meaning |
|------|---------|
| `0` | No issues |
| `1` | Issues found |
| `2` | The run failed (bad flags, missing or malformed `package.json`) |

---

## How it works

```
package.json ──┐
               ├─→  declared deps  ──┐
walk project ──┤                     ├─→  diff  ──→  unused / unusedPeer / misplaced / typeOnly
               └─→  parsed imports  ─┘
```

1. Read `package.json` to get declared `dependencies`, `peerDependencies`, and `devDependencies`.
2. Walk the project for `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.vue`, `.svelte`, `.astro`, `.css`, `.pcss`, `.postcss`, `.scss`, `.less`, hand-written declaration files (`.d.ts`, `.d.mts`, `.d.cts`) and `tsconfig*.json`, hidden files and directories included. An ignored directory is never listed, so a large gitignored cache costs nothing; a directory that cannot be listed is a stderr warning, as an unreadable source file is. The walk skips `.git/` and `node_modules/`, anything the project's `.gitignore` files ignore (the root one, nested ones, and those in parent directories up to the git repository's top, plus `.git/info/exclude`; git's rules, always matched case-sensitively, unlike git with `core.ignorecase` on, the macOS and Windows default), build outputs at each layout root (see below): `dist/`, `build/`, `out/` and `coverage/`, and the auto-detected output dirs at the project root (`outDir` and `declarationDir` of every root `tsconfig*.json` through its `extends` chain, a relative value resolved from the file that sets it and `${configDir}` from the extending one; `--outDir`, `--out-dir` and `--outdir` in scripts, with `=` or a space, and `-d` of `babel` and `swc`; `*-dist`-style names). An output dir that is the project root itself, or outside it, excludes nothing; symlinks in either path are resolved first. A project directory that its repository ignores is still scanned, with only its own `.gitignore` files. Symlinked files are followed; symlinked directories are not. A project without a `.gitignore` at its root (or above it in the repository) also skips common framework and cache dirs at each layout root (`.next/`, `.turbo/`, `.cache/`, `storybook-static/` and the like) and `.venv/`, `.gradle/`, `.claude/`, `.idea/` and `.vscode/` at any depth. A subdirectory with a `package.json` is a separate package when it is a workspace member (matched by the root `package.json` `workspaces`, as an array or as `{"packages": [...]}`, or by the `packages` list of a root `pnpm-workspace.yaml`, `!` negations included: in `workspaces` a later pattern that an earlier `!` pattern itself matches (such as `packages/b` after `!packages/b`) cancels that `!` pattern, as npm does, and in `pnpm-workspace.yaml` a `!` pattern always wins, as pnpm does) or when it has its own lockfile (`package-lock.json`, `npm-shrinkwrap.json`, `yarn.lock`, `pnpm-lock.yaml`, `bun.lock`, `bun.lockb`) or `node_modules/`. Its whole tree is left out of this run's checks and stderr names it. Its imports of packages that its own `package.json` does not list in `dependencies` or `devDependencies` (a peer-only declaration installs nothing there) still mark the root's dependency as used, because Node falls back to the root install for them; they count as development use, so they never make a dependency misplaced or type-only. A malformed `workspaces` or `pnpm-workspace.yaml` is reported on stderr, and the scan goes on without it. Any other `package.json` stays part of this run, even one with a `name` and dependencies, such as an Nx-style lib that resolves from the root install. The project root and every scanned directory with a `package.json` that has a `name`, or with an Nx `project.json` (one with a string `name`, or a `targets` or `$schema` key), are layout roots; a file is matched against every layout root above it, not only the nearest. A `package.json` without a `name`, such as `{"sideEffects": false}`, is not a layout root. Each file is tagged **development** or **production**. Development files are tests, specs, stories, and test setup files; anything under `test/`, `tests/`, `__tests__/`, `__mocks__/`, `e2e/`, `cypress/`, `playwright/` or `.storybook/` at any depth; dotfiles such as `.eslintrc.js` at any depth; and, only at a layout root, `*.config.*` and `*.preset.*` files (`webpack.config.prod.js` included), the `scripts/` directory and hidden directories such as `.husky/` or `.github/`, except a file that a scanned `package.json` names in `bin`, which ships to users. Everything else is production, including `src/app.config.ts`, `src/scripts/`, `src/.generated/` and a feature folder named `stories/`.
3. Parse each file with [oxc](https://oxc.rs) and collect `import`, `export … from`, `require()`, `import x = require()`, and dynamic `import()` with a string literal; resolve to package roots (e.g. `lodash/fp` → `lodash`). Type positions count as type-only usage: `import("x").T` and `typeof import("x")`, JSDoc `import("x")` inside a `{type}` and `@import { T } from "x"` in `/** */` comments, `/// <reference types="x" />`, `declare module "x"` in a file with its own `import` or `export` (in a file without one it declares an ambient module and counts for nothing), and every import in a declaration file. A TypeScript source (a declaration file included) or a `tsconfig*.json` anywhere in the walk counts as development use of `typescript`. `.js`, `.mjs` and `.cjs` files are parsed with JSX allowed. A file is read as UTF-8, or as UTF-16 when it starts with that byte order mark. In a `.vue` or `.svelte` component, each `<script>` block (`<script setup>` and Svelte's module script too) is parsed in the language of its `lang` attribute (`ts`, `tsx`, `jsx`, else JavaScript); in an `.astro` component, the `---` frontmatter and each `<script>` tag are parsed as TypeScript. In a `.vue` or `.svelte` file only top-level blocks count, as their compilers read them; in an `.astro` file a `<script>` or `<style>` anywhere in the markup counts, as Astro processes it there. In a `.vue` file every other top-level block, such as `<docs>` or `<i18n>`, is opaque text, and so is a tag in a `{{ }}` interpolation or an attribute value of the `<template>`; a `<script>` or `<style>` inside an HTML comment, a Vue `<template>`, or a Svelte element (`<svelte:head>` included) or `{ }` expression is markup, and one in Astro frontmatter is code. A self-closing `<script src="…" />` has no body. Line numbers point into the component. A component counts as runtime use of `vue`, `svelte` or `astro`, which its compiled output imports. Stylesheets and component `<style>` blocks (`lang` `css`, `postcss`, `scss`, `less` or none) are parsed with PostCSS: the quoted or `url()` target of `@import`, `@use` and `@forward` is a runtime import in the file's own context, and that of `@plugin`, `@config` and `@reference`, which the build runs or reads without emitting it, is development use, with webpack's `~` prefix dropped (`~bootstrap/scss/x` → `bootstrap`). Relative and absolute paths, URLs, `data:` and `sass:` modules are not packages, and `url()` inside a declaration is an asset, not an import. A stylesheet that does not parse is a stderr warning, and its imports are not counted; a component `<style>` block that does not parse is warned about alone, and the component's other blocks still count. A file holding JSX is runtime use of its JSX runtime package under the automatic runtime (tsconfig `jsx` set to `react-jsx`, `react-jsxdev`, `preserve` or `react-native`, or not set at all): a `/** @jsxImportSource x */` pragma names `x`, else the governing `jsxImportSource`, else `react`. Under `"jsx": "react"`, the classic runtime, the factory is imported explicitly and nothing is added. Under `preserve` or `react-native` without a `jsxImportSource`, `tsc` also keeps the factory import (`jsxFactory`, else `React`), so a JSX element counts as a value use of it. A `/** @jsxRuntime classic */` or `/** @jsxRuntime automatic */` pragma switches the file to that runtime, and under the classic runtime a `/** @jsx f */` pragma names the factory `f`. An import counts as type-only when TypeScript erases it: `import type`, an import made only of inline `type` specifiers, and, in a TypeScript source, an import none of whose bindings is used as a value. A type reference, a type literal, a type parameter, a `typeof` type query, an interface, an `implements` clause, a type-only export, a property, class member or enum key, or a label is no value use; a call, a JSX tag, a decorator, `typeof` in an expression, `export default` or `export { X }` is. Scopes are not tracked here, so a parameter or local variable that reuses an imported name keeps the import. Only the production imports of a `devDependency` that would be misplaced are checked for value use. A `dependencies` entry imported as a value is never moved to **Type-Only Imports** this way: such a package is often a runtime peer of another dependency (`graphql` for `@apollo/client`). When the governing tsconfig sets `verbatimModuleSyntax`, `preserveValueImports` or `importsNotUsedAsValues` to `preserve` or `error`, only `import type` and `export type` are erased; with `emitDecoratorMetadata` no import is checked for value use, since the emitted metadata can name a type. A development file that calls `describe`, `it`, `test`, `expect`, `beforeEach` or `afterEach` (or a member of one, such as `it.each`) as a global, one it neither imports nor declares as a variable, function, parameter or class in a scope around the call, counts as development type use of `@types/jest`, `@types/mocha` and `@types/jasmine`; the names in comments and strings do not count.
4. Read every `tsconfig*.json` the walk finds at a layout root, the projects their `references[].path` name (a file, or a directory holding `tsconfig.json`), and the `extends` chains of all of them (a root that another root extends, such as `tsconfig.base.json`, is read only through that one), through relative paths and through packages installed in `node_modules` at the extending file's directory or above. An extended or referenced file that cannot be found is a warning on stderr. In each chain the nearest `compilerOptions.types` counts each entry as development type use of that package (`vitest/globals` → `vitest`, so `"types": ["jest"]` in `tsconfig.spec.json` counts); an `extends` package such as `@tsconfig/node20` (or a relative path into `node_modules/@tsconfig/node20/`) is development use; the nearest `compilerOptions.importHelpers: true` is production runtime use of `tslib`. A source file follows the tsconfig files of the nearest directory above it that has any for `jsx`, `jsxImportSource`, `jsxFactory`, `verbatimModuleSyntax`, `preserveValueImports`, `importsNotUsedAsValues` and `emitDecoratorMetadata`: those whose `files` or `include`, less `exclude`, cover it (paths are relative to the tsconfig that sets them, and a tsconfig with neither covers everything under its own directory), else `tsconfig.json`, else all of them. Each tsconfig reads these options from its own `extends` chain, and a file that several of them cover gets every JSX runtime they set and the elision that keeps the most imports. A `null` option clears the inherited one, as in `tsc`, and an option with a value of the wrong type is ignored while the rest of the file is still used.
5. A declared `@types/x` counts as used when `x` or any subpath of it is used in any of the ways above: `@types/scope__name` for `@scope/name`, `@types/node` for any Node builtin (`fs` or `node:fs`, from `node:module`'s `builtinModules`) and for `"types": ["node"]`, `@types/bun` for `bun` and `bun:*`. This alone never makes it misplaced or type-only. An `@types/x` whose `x` is never used is still reported, even though TypeScript loads every `@types` package when `types` is not set.
6. Count the packages a project uses without importing them. None of these makes a package misplaced or type-only.
   - **Binaries run by scripts.** The `scripts` of the root `package.json` and of every scanned layout root, the git hooks in `.husky/` (its files without an extension) and lint-staged commands are split into commands on `&&`, `||`, `;`, `|`, `&`, parentheses, backticks and newlines outside quotes, so `echo "a; eslint"` runs only `echo`. Leading `NAME=value` assignments (`NODE_OPTIONS='--a --b'` too), shell keywords (`if`, `then`, `else`, `do`, `{` and the like) and runners (`npx`, `npm exec`, `pnpm exec`, `pnpm dlx`, `yarn exec`, `yarn dlx`, `bunx`, `bun x`, `cross-env`, `env`, `dotenv … --`) are skipped, and the next word is the command. After `npx`, `npm exec`, `pnpm dlx`, `yarn dlx`, `bunx` and `bun x` that word also names a package, less any `@version` (`npx @biomejs/biome`, `npx prettier@3`). `sh -c '…'` and `bash -c '…'` run their quoted script. After `pnpm`, `yarn` or `bun` (with or without `run`), a word that names a script of the same `package.json` is that script, not a binary; `npm run` and `pnpm run` run only scripts. A command uses the declared package whose installed `package.json` lists it in `bin` (a string `bin` is named after the package without its scope). Packages are looked up in `node_modules` at the project root and above, as Node resolves them. A declared package that is not installed is matched by its own name and by its name without the scope.
   - **Peers.** A declared package that a used, installed dependency lists in `peerDependencies` or `peerDependenciesMeta`, optional or not, is used, and so are the declared peers of that one in turn. A peer of a package that production code loads is never reported type-only, since production needs it installed.
   - When packages are declared but none is installed in a `node_modules` at or above the project, stderr says once that binaries were matched by name and peers were not checked.
   - **Tool configs.** At each layout root, these files and `package.json` keys are read (JSON and YAML as data, JS and TS from their object literals without running them), with each tool's short-name convention. An rc file without an extension, such as `.eslintrc`, is read as JSON with comments, or else as YAML. In JS and TS, a call with one argument stands for that argument (`getAbsolutePath('@storybook/addon-a11y')`), and a condition for each value it can take (`prod ? 'cssnano' : null`, `prod && 'cssnano'`). Every object in the file counts, so `overrides` and nested blocks do too. Layout roots here include Nx projects that hold only a `project.json`.
     - ESLint (`.eslintrc`, `.eslintrc.json`/`.yaml`/`.yml`/`.js`/`.cjs`, `eslintConfig`): `parser`, `plugins` (`react` → `eslint-plugin-react`, `@scope` → `@scope/eslint-plugin`, `@scope/x` → `@scope/eslint-plugin-x`), `extends` (`airbnb/hooks` → `eslint-config-airbnb`, `@scope` → `@scope/eslint-config`, `plugin:x/y` → the plugin `x`), the plugin of a rule such as `import/no-cycle`, and `settings["import/resolver"]` (`typescript` → `eslint-import-resolver-typescript`). A flat `eslint.config.*` is read through its imports.
     - Babel (`.babelrc*`, `babel.config.*`, `babel`): `presets` and `plugins` (`@babel/env` → `@babel/preset-env`, `macros` → `babel-plugin-macros`, `module:x` → `x`, `next/babel` → `next`).
     - PostCSS (`postcss.config.*`, `.postcssrc*`, `postcss`): the keys and entries of `plugins`.
     - Jest (`jest.config.*`, `jest`): `preset`, `testEnvironment` (`jsdom` → `jest-environment-jsdom`), `transform` values, `setupFiles`, `setupFilesAfterEnv`, `snapshotSerializers` and `reporters`.
     - Prettier (`.prettierrc*`, `prettier.config.*`, `prettier`): `plugins`, or the whole config when it is a string naming a shared config.
     - Stylelint (`.stylelintrc*`, `stylelint.config.*`, `stylelint`) and commitlint (`.commitlintrc*`, `commitlint.config.*`, `commitlint`): `extends` and `plugins`.
     - Storybook `.storybook/main.*`: `addons`, `framework` and `core.builder`. `serverless.yml`/`.ts`: `plugins`. Nx `project.json` and `nx.json`: each `executor` (`@nx/jest:jest` → `@nx/jest`). lint-staged (`.lintstagedrc*`, `lint-staged.config.*`, `lint-staged`): its commands, read as scripts above. tsconfig: `compilerOptions.plugins[].name`.
     - Any other `*.config.*` or `*.preset.*` JS or TS file, and any other `.json`, `.jsonc`, `.yaml` or `.yml` file, at a layout root: a string that is exactly a package name, such as `minify: 'terser'` in `vite.config.ts` or a plugin in `.releaserc.json`. `package.json`, lockfiles, `pnpm-workspace.yaml` and tsconfigs are not read this way.
7. Diff the two sets to produce four buckets: **unused**, **unusedPeer** (when `--check-peer`), **misplaced**, **typeOnly**. An import from any file counts as usage. **misplaced** and **typeOnly** look only at production files, so a `devDependency` used only in tests or tooling is never misplaced.

---

## Output

**Text format** (default):

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Dependency Analysis Report
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⚠  Unused Dependencies:
  (declared but not imported in source code)

  • moment

⚠  Misplaced Dependencies:
  (in devDependencies but used in source code)

  • zod (used in 1 file)
    └─ src/api/schema.ts:5
       import { z } from 'zod';

ℹ️  Type-Only Imports:
  (used only for type definitions)

  ○ type-fest

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Total Issues: 3
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

A `dependencies` entry that is only ever imported as a type is listed under **Type-Only Imports** and counts as an issue: it could live in `devDependencies`. A package that publishes declarations (a `types` or `typings` entry, or a `types` condition anywhere in `exports`) skips this check, because its consumers need those types installed. Colours are used only when stdout is a terminal and `NO_COLOR` is unset.

With `--check-peer` (or `--all`), an additional section appears for declared peers that no source file imports:

```
⚠  Unused peerDependencies:
  (declared as a consumer contract but not imported in source code)

  • react-dom
```

**JSON format** (`--json --check-peer`; `file` paths are absolute):

```json
{
  "unused": ["moment"],
  "unusedPeer": ["react-dom"],
  "misplaced": [
    {
      "packageName": "zod",
      "locations": [
        { "file": "/path/to/project/src/api/schema.ts", "line": 5, "importStatement": "import { z } from 'zod';" }
      ]
    }
  ],
  "typeOnly": ["type-fest"],
  "ignored": [],
  "totalIssues": 4
}
```

`unusedPeer` is `[]` when `--check-peer` is off (default). `ignored` lists the packages passed to `--ignore`.

---

## CI integration

Fail the build on any finding:

```yaml
- run: npx deps-finder
```

Or keep a report without blocking on findings, while still failing when the run itself breaks (exit `2`):

```yaml
- run: npx deps-finder --json > deps-report.json || [ $? -eq 1 ]
```

---

## peerDependencies note

`peerDependencies` are a contract with consumers, not a usage indicator — many real peers (e.g. `typescript`, ESLint plugin peers) are intentionally never imported by the library itself. By default deps-finder skips them. Opt in with `--check-peer` and they appear in a separate **Unused peerDependencies** section.

---

## Honest-use notice

deps-finder uses static AST scanning, so dynamic patterns are invisible to it: `require(variable)`, `import(expr)`, `eval`, virtual modules from bundler plugins, packages a config names only as a string outside the tools and keys listed above. Test files that a runner config points at from an unusual place (a Playwright `testDir`, a `codegen.ts` run only from a script, `src/mocks/` imported only by tests) are treated as production. The tool prefers under-reporting over over-reporting, but false positives still happen. When one does, `--ignore <pkg>` is the escape valve — and an issue report is welcome.

A package used without an import is still reported as unused when nothing above finds it: a subcommand another CLI provides (`nuxt storybook`), a binary run from CI files such as `bitbucket-pipelines.yml`, a config file without an extension that no tool above owns (`.swcrc`), and, when nothing declared is installed, a binary named unlike its package (`tsc` from `typescript`) or a peer. Pass it to `--ignore`.

A bare builtin name such as `buffer` or `events` is matched against a declared package of that name (the npm polyfill a bundler would use). Write `node:buffer` when you mean the Node builtin.

Indented Sass (`.sass`, `<style lang="sass">`) and Stylus (`.styl`, `<style lang="stylus">`) are not read. A Sass or Less `@import "name"` that loads a local partial counts as use of a declared package called `name`. The `src` attribute of a component's `<script>` or `<style>` (`<style src="pkg/theme.css">`) is not read.
---

## Development

```sh
git clone https://github.com/jazz1x/deps-finder.git
cd deps-finder
bun install
bun run validate   # typecheck + lint + format + tests
```

The project uses Bun for tests and `tsc` from TypeScript 7 for typecheck and the published build. See [package.json](package.json) for the full script list.

---

## License

[MIT](./LICENSE)
