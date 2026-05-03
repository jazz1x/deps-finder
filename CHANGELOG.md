# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.6.0] - 2026-05-03

This is a feature + hardening release. Headline change: a new `--check-peer / -p` flag separates orphan-`peerDependencies` into their own bucket. The release also lands the project's first CI/CD pipelines (PR validation, tag-triggered npm publish with provenance, GitHub Release with auto-generated notes), and adopts the TypeScript 7 native preview compiler (`tsgo`) for typecheck + build.

### ⚠ BREAKING

- **Minimum Node.js raised from `>=20` to `>=22`** via `package.json#engines`. Node 20 entered security-only maintenance in Apr 2026; the test matrix is now `[22, 24]` (active LTS pair).
- **`peerDependencies.typescript` raised from `^5.9.3` to `^6.0.0`**. TypeScript 6 is the current stable. Consumers on TS 5 should pin `deps-finder` to `0.5.x`.
- **`unusedPeer` field added to JSON output**. Strict consumers that fail on unknown JSON keys would need to update their schema — but it is always present (empty array when `--check-peer` is off), so it is parseable as a fixed shape.

### Added

- **`--check-peer / -p` flag**: detects orphan `peerDependencies` (declared but never imported in source). Implied by `--all`. Off by default — `peerDependencies` are a consumer contract and many real peers (e.g. `typescript`, ESLint plugin peers) are intentionally never imported by the library itself. Output shows a dedicated **Unused peerDependencies** section in text mode and a `unusedPeer` array in JSON mode.
- **CLI argument warnings**: `--ignore` / `--exclude` (or any flag requiring a value) given without a value now print `warning: <flag> requires a value but none was provided; flag ignored.` to stderr instead of silently dropping the flag.
- **User-friendly error messages**: missing `package.json`, malformed JSON, and read errors are now reported as actionable single-line messages (e.g. `package.json not found at <path>. Run deps-finder from a directory containing package.json.`) instead of leaking the internal `FileError` tagged-union shape.
- **End-to-end CLI test suite** (`src/cli.e2e.test.ts`): exercises the published `bin/cli.js` directly across exit codes, stdout/stderr formats, and `--all` / `--check-peer` / `--ignore` / `--exclude` interactions.
- **Chaos / fuzz coverage**: a seeded `mulberry32` PRNG fuzzes `extractPackageName`, `extractImports`, `extractDependencies`, `analyzeDependencies`, and the file-reader on 200 random inputs each per run, asserting no throws and contract-shaped returns.

### Changed

- **Performance**: `extractImports` rewritten from O(N·L) to O(N + M·log L) (precomputed newline offsets + binary search per match — the canonical compiler pattern). `isBuiltinModule` switched from per-call array build + linear scan to a module-load-time `Set` lookup. Microbench results (`bun run bench`):

  | input                           | before    | after    | speedup |
  |---------------------------------|----------:|---------:|--------:|
  | 100 lines / 5 imports           | 47.5 µs   | 31.5 µs  |   1.5×  |
  | 1k lines / 97 imports           | 1.31 ms   | 167 µs   |   7.8×  |
  | 10k lines / 968 imports         | 98.9 ms   | 1.90 ms  |  52×    |
  | 1k lines, density 100%          | 15.2 ms   | 1.52 ms  |  10×    |
  | `isBuiltinModule` ×6 mixed      | 3.04 µs   | 30 ns    | 101×    |

- **Build & typecheck switched to `tsgo`** (TypeScript 7 native preview compiler, via `@typescript/native-preview`). `bun run typecheck` and `bun run build` now invoke `tsgo`. `tsc` (TypeScript 6) remains installed for editor TypeScript Server, type-definition resolution, and contributor cross-check.
- **`tsconfig.json` migrated for TypeScript 7 removals**: `moduleResolution: "Node"` → `"bundler"`; `baseUrl: "."` removed (paths now resolve relative to tsconfig); `typeRoots` replaced with explicit `types: ["bun"]`; `incremental: true` removed (was causing emit cache mismatches).
- **`tsconfig.build.json`**: explicit `include: ["./src/**/*.ts"]` and `rootDir: "./src"` (TS 6 no longer auto-infers rootDir or inherits include from extended config).
- **README rewritten** in honne-style structure (12 H2 sections: Features → Install → Quickstart → Options → How it works → Output → CI integration → peerDependencies note → Honest-use → Development → License). Both English and Korean. Options table is derived from `src/constants/messages.ts:HELP_TEXT`. ASCII pipeline diagram added under "How it works".
- **`main()` simplified to a sync arrow `const`**; remaining redundant Korean JSDoc dropped (CLAUDE.md C3 — let identifiers document intent).
- **`O.Some<T>(...)` wrapping dropped** in `src/parsers/import-parser.ts`. `@mobily/ts-belt`'s `O.Option<A>` is structurally `A | null | undefined` and `O.Some(x)` is the identity, so values are returned directly with the callback's return type annotated as `O.Option<ImportDetails>`.

### Fixed

- **Duplicate `require()` findings**: `IMPORT_REGEX` already includes a `require()` alternation, so the separate `REQUIRE_REGEX` pass produced duplicates. Removed the redundant pass and added a regression test in `src/parsers/import-parser.test.ts`.
- **`readPackageJson` threw on `JSON.parse('null')`**: `content.name` dereferenced `null`. Now guarded with `isPlainObject` and mapped to `PARSE_ERROR`, restoring the C1 promise that the function returns a `Result`.

### Removed

- `parseImports` and `parseImportsWithType` (dead since the contracts pass; no caller in `src/`).
- `REQUIRE_REGEX` from `src/constants/patterns.ts` (duplicate of the `require()` alternation already inside `IMPORT_REGEX`).
- `tsconfig.build.tsbuildinfo` is no longer in the published tarball — `package.json#files` tightened from `["dist", "bin"]` to `["dist/**/*.js", "dist/**/*.d.ts", "bin"]`. **Tarball: 72.3 kB → 52.3 kB (-28 %), 40 → 39 files.**

### Infrastructure

- **CI** (`.github/workflows/ci.yml`): runs `bun install --frozen-lockfile && bun run validate && bun run build` on every PR and `main` push. Bun (latest) + Node matrix `[22, 24]`, `fail-fast: false`, Bun-cache, PR-only concurrency cancellation.
- **Release** (`.github/workflows/release.yml`): tag-push `v*.*.*` triggers a verify-tag-vs-`package.json#version` step, then `bun run validate && bun run build && npm publish --provenance --access public`, then a `softprops/action-gh-release@v2` step that creates the GitHub Release with auto-generated notes (`generate_release_notes: true`). `permissions` block is minimal: `contents: write` (Release) + `id-token: write` (npm provenance). `NPM_TOKEN` is referenced only via `${{ secrets.NPM_TOKEN }}`.
- **`prepublishOnly`** upgraded from `bun run build` to `bun run validate && bun run build` so a manual local `npm publish` runs the same gate as CI.
- **`.github/dependabot.yml`** added: weekly bumps for `github-actions` and `npm` (patch + minor grouped to reduce PR noise).
- **`SECURITY.md`** added: vulnerability reporting via GitHub private advisories; scope (CLI / static analysis / no network).
- **`CONTRIBUTING.md`** added: setup, development loop, project conventions linking to `CLAUDE.md` C1–C6, PR checklist.
- **`.nvmrc`** added: pins Node 22 for contributors.
- Repository URLs corrected in `package.json` and READMEs from `plz-salad-not-here/deps-finder` to `jazz1x/deps-finder` (canonical owner).
- `glob` 11.x → 13.x, `@biomejs/biome` 2.3.11 → 2.4.14 (`biome.json#$schema` URL pinned to match), `@types/bun` floating `latest` → pinned `^1.3.13`.

### Quality

- Tests **145 → 226**. Coverage stays at **99.26 / 99.86** (statements / functions). Tarball size **-28 %**. Project Contracts (`CLAUDE.md` §C1–C6) enforced across the codebase: Result-typed errors, exhaustive `ts-pattern`, arrow-`const` style, co-located `bun:test`, no speculative exports, ESM with explicit `.js` suffixes.

### Upgrade notes

If you depend on deps-finder:

1. Ensure your CI runs **Node ≥ 22** and **TypeScript ≥ 6** if you import deps-finder programmatically.
2. If you parse the JSON output, expect a new `unusedPeer: string[]` field. It is always present (`[]` when `--check-peer` is off).
3. To use the new orphan-peer detection, add `--check-peer` (or `--all`, which implies it) to your invocation.
4. CLI text output adds an `Unused peerDependencies:` section *only* when `--check-peer` is active and there are findings.

If you cannot upgrade Node or TypeScript: pin to `deps-finder@~0.5.0`.

## [0.5.0] - 2026-01-13

### Added
- `--exclude` / `-e` flag to specify additional custom exclude patterns
- `--no-auto-detect` flag to disable automatic build directory detection
- Comprehensive build output directory patterns for major frameworks (Next.js, Nuxt, Vite, Storybook, etc.)
- Automatic detection of custom build directories from `tsconfig.json` (outDir) and `package.json` scripts
- Heuristic-based detection for build directories (patterns like `*-static`, `*-dist`, `*-build`)
- Exclude patterns for cache directories (`.cache`, `node_modules`, etc.) and IDE settings
- Result-based file reading utilities in `src/utils/file-reader.ts`
- AsyncResult utilities for future async operations (currently unused)
- Structured error types in `src/domain/errors.ts` (FileError, AnalysisError)
- Comprehensive tests for Result-based file and configuration reading

### Changed
- Refactored error handling to use ts-belt Result types instead of try-catch
- Improved type safety with explicit error types throughout the codebase
- More composable error handling with Result.map, Result.flatMap, and Result.match
- Migrated file reading utilities to a Result-based synchronous API

### Fixed
- Build output directories (storybook-static, .next, .nuxt, etc.) are now properly excluded from analysis
- False positives from framework build outputs are no longer reported as misplaced dependencies

### Improved
- More predictable and type-safe error handling throughout the codebase
- Better error reporting with structured, typed error objects
- Enhanced code quality by replacing imperative try-catch blocks with functional Result types
- More accurate analysis by strictly excluding build artifacts and temporary files
- Better handling of monorepo and custom build setups

## [0.4.1] - 2026-01-12

### Fixed
- Fixed duplicate location entries for the same file:line
- `tailwind.config.*` files are now properly recognized as build config files
- `postcss.config.*` files are now properly recognized as build config files
- Test setup files (`happydom.*`, `test-utils.*`, etc.) are now properly excluded from misplaced analysis
- Improved deduplication logic to prevent showing same import multiple times

### Added
- `deduplicateLocations` utility function for removing duplicate import locations
- More comprehensive build config and test setup file patterns

### Improved
- Better accuracy in distinguishing build/test configuration from production code

## [0.4.0] - 2026-01-12

### Added
- Detailed file locations and line numbers are now shown by default for misplaced dependencies
- Import statements are displayed for each dependency issue
- Enhanced JSON output with location details in `misplaced` field
- Significantly expanded test coverage with more edge cases and integration tests

### Fixed
- `.d.ts` (TypeScript declaration) files are now properly excluded from analysis
- Build tool config files (vite.config, webpack.config, etc.) no longer trigger false positives for misplaced devDependencies
- Fixed duplication of import reporting for mixed type imports
- Fixed side-effect import detection (e.g., `import 'core-js'`) which was previously failing in some cases

### Changed
- `misplaced` field in JSON output is now an object containing `locations` array instead of simple string array
- Refactored codebase to maximize `ts-belt` utility functions usage
- Optimized pipe usage to avoid unnecessary function overhead
- Replaced nested conditionals with `ts-pattern` match for linear control flow
- Improved code organization with better constant grouping

### Improved
- Better error handling and validation throughout the codebase
- Enhanced code readability and maintainability through functional programming patterns
- Updated all dependencies to latest versions
- Synchronized Korean documentation (README.ko.md) with English version

## [0.3.5] - 2025-12-20

### Changed
- **Code Quality Improvements**: Refactored to functional programming patterns
  - Migrated `extractPackageName` to use ts-pattern for cleaner, more maintainable pattern matching
  - Simplified pipe chains by removing unnecessary wrapper functions (currying improvements)
  - Converted `findMisplaced` and `filterIgnored` to curried functions for better composition
  - Removed redundant pipe wrappers in `isExcludedPath` and import parsing logic

### Fixed
- **IMPORT_REGEX Pattern**: Fixed to properly capture side-effect imports
  - Now correctly parses `import 'core-js/actual'` style imports
  - Maintains exclusion of type-only and inline type imports
  - Improved pattern simplicity while preserving all functionality
- **Test File Pattern**: Updated `happy-dom.` to `happydom.` for consistency in excluded filename patterns

### Technical Details
- All 97 tests pass with improved code readability
- More consistent use of ts-belt and ts-pattern throughout the codebase
- Eliminated imperative forEach loops in favor of functional A.forEach

## [0.3.4] - 2025-12-19

### Added
- Deep import path parsing with robust edge case handling
  - Added validation for empty strings, protocols, and malformed scoped packages
  - Deep import paths now correctly extract package names (e.g., `lodash/map` → `lodash`, `@mui/material/Button` → `@mui/material`)
  - All sub-path imports properly mapped to their root packages
  - Comprehensive test coverage for deep imports from popular packages (lodash, core-js, next-auth, @mui/material, @radix-ui, date-fns, rxjs, etc.)

## [0.3.3] - 2025-12-19

### Added
- Type-only dependency detection: Packages used only for types are now reported separately
- Test setup file patterns (testing-library, test-utils, setupTests, etc.) are now properly excluded
- Type guard utilities for safer type narrowing

### Fixed
- Type-only imports no longer incorrectly flagged as runtime dependencies
- Removed all type assertions (as) in favor of proper type guards
- Replaced imperative loops with functional ts-belt patterns

### Changed
- Improved code quality with consistent functional programming patterns
- Enhanced type safety throughout the codebase

## [0.3.2] - 2025-12-19

### Fixed
- Production config files (next.config.*, next-*.config.*, webpack.config.*, etc.) are now properly detected and analyzed
- Config file exclusion logic improved to prevent production configs from being incorrectly filtered out
- File path handling enhanced to work correctly regardless of absolute or relative paths

### Technical Details
- Refactored `isExcludedPath()` to use explicit dev config patterns instead of generic `.config.` pattern
- Improved `shouldAnalyzeFile()` to check production configs before applying exclusion rules
- Added comprehensive tests for config file detection across various path formats

## [0.3.1] - 2025-12-18

### Changed
- Simplified output by removing usage count display
- All output messages are now in English for consistency

### Added
- Comment-aware parsing: Commented-out imports are now properly ignored
- Smart config file detection: Only production configs are checked
  - Checks: next.config.*, next-*.config.*, webpack.config.*, vite.config.*, rollup.config.*, postcss.config.*
  - Ignores: jest.config.*, vitest.config.*, babel.config.*, eslint.config.*, prettier.config.*, tsup.config.*

### Fixed
- Single-line comments (`// import ...`) are now excluded from analysis
- Multi-line comments (`/* import ... */`) are now excluded from analysis
- JSDoc comments with import examples are now excluded from analysis
- Development tool configs (jest, eslint, etc.) are no longer incorrectly flagged

## [0.3.0] - 2025-12-18

### Added
- **Usage Count Statistics**: Each dependency's import/require count is now tracked and displayed
  - Text output shows count in parentheses (e.g., "react (23회 import)")
  - JSON output includes `count` field in the `used` array
  - Used dependencies are sorted by count in descending order
- **Config File Support**: CommonJS `require()` statements in configuration files are now detected
  - Supported files: `*.config.js`, `*.config.ts`, `*.config.cjs`, `*.config.mjs`
  - Includes webpack, Next.js, Babel, and other build tool configurations
- **Improved Type Import Handling**: Mixed import patterns are now correctly processed
  - Type-only imports: `import type { User } from 'pkg'` (excluded from usage)
  - Mixed imports: `import { type User, getValue } from 'pkg'` (counted as used)
  - Ensures packages with both type and runtime imports are correctly identified

### Enhanced
- **Better --ignore Option Display**: Ignored packages are now categorized and clearly displayed
  - Type-only imports: Packages used only with `import type` syntax
  - By default: Built-in modules and local imports
  - By option: Packages explicitly ignored via `--ignore` flag
- **Documentation**: Both English (README.md) and Korean (README.ko.md) versions updated
  - Added usage count examples
  - Config file support documentation
  - Mixed import pattern examples
  - Enhanced --ignore option explanation

### Fixed
- Type-only imports that were incorrectly excluded from detection during analysis
- Config file imports (require statements) that were not being counted in usage statistics
- --ignore option not showing which packages were explicitly ignored

### Changed
- JSON output now includes `used` field with package names and counts
- Text output now displays all used dependencies with their import counts
- Text output now clearly categorizes ignored dependencies by reason

### Improved
- Overall analysis accuracy for mixed import scenarios
- Performance when scanning configuration files
- User experience with clearer output formatting

## [0.2.0] - 2025-12-11

### Added
- **--ignore option**: Ignore specific packages from analysis (comma-separated)
- **Categorized ignored dependencies**: Different reasons for ignored packages

### Enhanced
- Ignored dependency reporting with categorization
- CLI help text with --ignore option documentation

## [0.1.0] - 2025-11-20

### Added
- Initial release
- **Unused Dependencies Detection**: Identify packages declared but not used
- **Misplaced Dependencies Detection**: Find packages in devDependencies that are used in production code
- **Multiple Import Patterns**: Support for ES6, CommonJS, TypeScript imports
- **Type-only Import Detection**: Exclude TypeScript type-only imports
- **Built-in Module Filtering**: Automatically exclude Node.js and Bun built-in modules
- **Text and JSON Output**: Multiple output format options
- **File Pattern Filtering**: Automatic exclusion of test, build, and configuration files
- **Type Safe Implementation**: Built with TypeScript using ADT patterns
- **Comprehensive Tests**: 100% code coverage

## Notes

### Upgrade from 0.2.0 to 0.3.0
No breaking changes. The new features are fully backward compatible:
- JSON output adds new `used` field while keeping existing fields
- Text output is enhanced but doesn't affect usage
- All existing options and behaviors are preserved
