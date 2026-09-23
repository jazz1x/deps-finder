---

# Toolchain: Bun for development, Node for the product

- Develop with Bun: `bun install`, `bun test`, `bun run <script>`.
- The published CLI runs on Node ≥ 22.12 (`bin/cli.js` → `dist/`, exercised by `src/cli.e2e.test.ts`). Code under `src/` (except tests) must not use `Bun.*` or `bun:*` APIs.

---

# Project contracts (deps-finder)

This is a CLI dependency analyzer. The codebase follows a strict functional style backed by [`effect`](https://effect.website) (v4, pinned RC). New code MUST follow these contracts — they are enforced by review, not the type system.

## C1. Errors are values, never thrown

- Every fallible function returns `Result.Result<T, E>` from `effect`. **Do not throw**, do not return `null`/`undefined` to signal failure, do not use try/catch at call sites.
- `E` is a **tagged union** built with `Data.taggedEnum` and discriminated by `_tag`. Canonical errors live in [src/domain/errors.ts](src/domain/errors.ts). Add new variants there rather than inventing local error shapes.
- Wrap throwing APIs (e.g. `node:fs`) with `Result.try({ try, catch })`, mapping the cause into a domain error variant in `catch`. Decode untrusted data (JSON files) once at the boundary with `Schema` (`readJsonFile(schema)`); code below the boundary never re-checks shapes. See [src/utils/file-reader.ts](src/utils/file-reader.ts).
- Consume Results with `Result.match(result, { onSuccess, onFailure })`, `Result.map`, `Result.flatMap`, `pipe`. The only place that converts a Result back into side effects (exit code, console output) is the entry in [src/index.ts](src/index.ts).

## C2. Branching is a fold

- Branch on tagged unions with `Match` (`Match.value(...).pipe(..., Match.exhaustive)`) or the enum's own `$match`. Use `Match.orElse(...)` only when there is a meaningful default. Open-ended `if/else` ladders and early returns for the same purpose are not accepted.
- Absent values are `Option`; fold them with `Option.map` / `Option.match` / `Option.getOrElse`, not null checks.
- Examples: `OutputFormat` in [src/reporters/console-reporter.ts](src/reporters/console-reporter.ts) (`Match.exhaustive`), `FileError.$match` in [src/reporters/error-reporter.ts](src/reporters/error-reporter.ts).

## C3. Functional style only

- Arrow-function `const` exports. **No `class` declarations** in `src/` — this is why errors use `Data.taggedEnum` rather than `Data.TaggedError`.
- Compose with `pipe(...)` from `effect`; reach for `Array`, `Option`, `Result`, `Record` before reimplementing helpers.
- Inputs are `ReadonlyArray<T>` / `readonly` shapes; produce new values rather than mutating. The one sanctioned exception is collecting inside oxc's `Visitor` in [src/parsers/import-parser.ts](src/parsers/import-parser.ts), kept for a measured 4.5× speedup and confined to one function.

## C4. Tests are co-located, use `bun:test`

- Each source file `foo.ts` has its tests at `foo.test.ts` in the same directory. Cross-cutting end-to-end tests go in [src/integration.test.ts](src/integration.test.ts).
- Use `describe` / `test` from `bun:test`. Assert on Results with `Result.isSuccess`, `Result.isFailure`, `Result.getOrThrow`, or `Result.match` — do **not** unwrap by reading internal fields.
- File-system tests create a fixture directory in `beforeEach` and `rm`/`-rf` it in `afterEach`. See [src/utils/file-reader.test.ts](src/utils/file-reader.test.ts) for the pattern.
- Run `bun run validate` (typecheck + lint + format check + tests) before declaring work done.

## C5. No speculative exports

- Do not add functions, types, or modules "for future use." If nothing in `src/` calls it today, delete it.

## C6. Path & import conventions

- TypeScript sources use ESM with explicit `.js` suffixes on relative imports (`./foo.js`) so the emitted output runs without a bundler.
- Tests use the `@/` alias (see `tsconfig.json` paths) for cross-directory imports; sibling-file imports stay relative (`./foo`) and drop the `.js` suffix because tests run via `bun test` and don't go through the build.
- User-facing strings (CLI help, report headers) are centralised in [src/constants/messages.ts](src/constants/messages.ts) — do not hardcode them in reporters or analyzers.
