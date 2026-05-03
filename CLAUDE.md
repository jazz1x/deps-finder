---

# Runtime: Bun

Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Bun automatically loads .env, so don't use dotenv.

## Bun APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile.
- `Bun.$`ls`` instead of execa.

For more, read `node_modules/bun-types/docs/**.md`.

---

# Project contracts (deps-finder)

This is a CLI dependency analyzer. The codebase follows a strict functional style backed by `@mobily/ts-belt` and `ts-pattern`. New code MUST follow these contracts — they are enforced by review, not the type system.

## C1. Errors are values, never thrown

- Every fallible function returns `R.Result<T, E>` from `@mobily/ts-belt`. **Do not throw**, do not return `null`/`undefined` to signal failure, do not use try/catch at call sites. (If async ever shows up in this codebase, mirror the pattern with `AR.AsyncResult<T, E>` — but don't add async helpers speculatively, see C5.)
- `E` is a **tagged union** discriminated by a literal `type` field. Canonical errors live in [src/domain/errors.ts](src/domain/errors.ts) (`FileError`, `AnalysisError`, `AppError`). Add new variants there rather than inventing local error shapes.
- Wrap throwing APIs (e.g. `node:fs`, `JSON.parse`) with `R.fromExecution(...)` and immediately `R.mapError(...)` into a domain error variant. See [src/utils/file-reader.ts](src/utils/file-reader.ts) for the canonical pattern.
- Consume Results with `R.match(result, onOk, onError)`, `R.map`, `R.flatMap`, `pipe`. The only place that converts a Result back into side effects (process exit, console output) is the entry in [src/index.ts](src/index.ts).

## C2. Pattern matching is exhaustive

- Use `match(...)` from `ts-pattern` for any branching on union types, format flags, or shape-dependent values.
- Every `match` chain MUST end with `.exhaustive()` when the input is a closed union, or `.otherwise(...)` when there is a meaningful default. Open-ended `if/else` ladders for the same purpose are not accepted.
- Examples: discriminating `OutputFormat` in [src/reporters/console-reporter.ts](src/reporters/console-reporter.ts) (`.exhaustive()`), CLI flag dispatch in [src/cli/options.ts](src/cli/options.ts) (`.otherwise()`).

## C3. Functional style only

- Arrow-function `const` exports. **No `class` declarations** in `src/`.
- Compose with `pipe(...)` from `@mobily/ts-belt`; reach for `A.*`, `S.*`, `R.*`, `AR.*` namespaces before reimplementing array/string/result helpers. If a ts-belt helper exists, use it.
- Inputs are `ReadonlyArray<T>` / `readonly` shapes; produce new values rather than mutating. Reducers (`A.reduce`, `A.reduceWithIndex`) are preferred over imperative loops with accumulators.

## C4. Tests are co-located, use `bun:test`

- Each source file `foo.ts` has its tests at `foo.test.ts` in the same directory. Cross-cutting end-to-end tests go in [src/integration.test.ts](src/integration.test.ts).
- Use `describe` / `test` from `bun:test`. Assert on Results with `R.isOk`, `R.isError`, `R.getExn`, or `R.match` — do **not** unwrap by destructuring internal fields.
- File-system tests create a fixture directory in `beforeEach` and `rm`/`-rf` it in `afterEach`. See [src/utils/file-reader.test.ts](src/utils/file-reader.test.ts) for the pattern.
- Run `bun run validate` (typecheck + lint + tests) before declaring work done.

## C5. No speculative exports

- Do not add functions, types, or modules "for future use." If nothing in `src/` calls it today, delete it.
- Type guards live in [src/utils/type-guards.ts](src/utils/type-guards.ts) and are added on demand. Same rule for sync/async pairs in `file-reader.ts`: only ship the variant the codebase actually consumes.

## C6. Path & import conventions

- TypeScript sources use ESM with explicit `.js` suffixes on relative imports (`./foo.js`) so the emitted output runs without a bundler.
- Tests use the `@/` alias (see `tsconfig.json` paths) for cross-directory imports; sibling-file imports stay relative (`./foo`) and drop the `.js` suffix because tests run via `bun test` and don't go through the build.
- User-facing strings (CLI help, report headers) are centralised in [src/constants/messages.ts](src/constants/messages.ts) — do not hardcode them in reporters or analyzers.
