# Contributing to deps-finder

Thanks for your interest. This document covers what you need to know to send a useful patch.

## Setup

```sh
git clone https://github.com/jazz1x/deps-finder.git
cd deps-finder
bun install
bun run validate   # typecheck + lint + format + tests
```

Requires Node.js ≥ 22.12 (use `.nvmrc`) and [Bun](https://bun.sh).

## Development loop

| Command | Purpose |
|---------|---------|
| `bun test`            | Run the test suite |
| `bun test --watch`    | Re-run tests on file change |
| `bun run typecheck`   | `tsc --noEmit` (TypeScript 7 native compiler) |
| `bun run lint`        | oxlint over `src/` (`.oxlintrc.json`) |
| `bun run format`      | oxfmt `src/` (writes, `.oxfmtrc.json`) |
| `bun run validate`    | typecheck + lint + format check + tests (the canonical gate) |
| `bun run bench`       | Run the parser micro-benchmark |
| `bun run build`       | Emit `dist/` via `tsc -p tsconfig.build.json` |

Typecheck and emit both use `tsc` from `typescript@7`, the Go-based native compiler. It is a devDependency only: deps-finder parses imports itself and never loads the TypeScript API at runtime.

## Project conventions

The project follows strict contracts. Read [CLAUDE.md](CLAUDE.md) `Project contracts` (C1–C6) before adding code:

- Errors are values (`Result.Result<T, E>` from `effect`); no throws.
- Branching on unions is exhaustive (`Match.exhaustive` or `Data.taggedEnum`'s `$match`).
- Functional style only (arrow `const` exports; no `class`).
- Tests are co-located (`foo.ts` ↔ `foo.test.ts`) using `bun:test`.
- No speculative exports — if nothing in `src/` uses it today, do not add it.
- ESM with explicit `.js` suffixes on relative imports.

User-facing strings live in [src/constants/messages.ts](src/constants/messages.ts).

## Pull requests

1. Open an issue first for larger changes so we can agree on direction.
2. One logical change per PR — split refactor / feature / formatting commits.
3. Run `bun run validate` locally before pushing. CI will run the same on Node 22 and 24.
4. Update [README.md](README.md) and [README.ko.md](README.ko.md) together if user-visible behaviour changes (the `--help` output and the README options table must stay in sync — `src/constants/messages.ts:HELP_TEXT` is the source of truth).
5. Commit messages: short imperative subject; the body explains the *why*.

## Reporting bugs

Open a [GitHub issue](https://github.com/jazz1x/deps-finder/issues) with:

- The version (`deps-finder --help` shows nothing useful here — please paste `npm ls deps-finder` output).
- The minimal `package.json` and source layout that reproduces the problem.
- The actual output vs. what you expected.
- For false positives, the package name and how it is actually used (dynamic `require`, virtual module, etc.).

For security issues see [SECURITY.md](SECURITY.md) instead.
