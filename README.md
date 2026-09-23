# deps-finder

> Catch unused, misplaced, and orphan-peer dependencies in TypeScript projects.

[![npm version](https://img.shields.io/npm/v/deps-finder.svg)](https://www.npmjs.com/package/deps-finder)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node ≥22.12](https://img.shields.io/badge/node-%E2%89%A522.12-brightgreen.svg)](https://nodejs.org)
[![Bun](https://img.shields.io/badge/runtime-bun-black.svg)](https://bun.sh)
[![CI](https://github.com/jazz1x/deps-finder/actions/workflows/ci.yml/badge.svg)](https://github.com/jazz1x/deps-finder/actions/workflows/ci.yml)

deps-finder reads your `package.json`, walks `src/**`, and tells you which declared packages no source file actually imports — and which packages your code does import that live in the wrong section. It runs entirely on your machine, never phones home, and treats `peerDependencies` as a consumer contract by default (since real peers like `typescript` are intentionally never imported by the library itself). Opt in with `--check-peer` when you want orphan-peer detection.

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
- Auto-detects build output directories (`dist`, `build`, etc.) and excludes them.
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
| `--exclude <globs>` | `-e` | Exclude files/dirs by glob (comma-separated, repeatable) |
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
glob src/**  ──┤                     ├─→  diff  ──→  unused / unusedPeer / misplaced / typeOnly
               └─→  parsed imports  ─┘
```

1. Read `package.json` to get declared `dependencies`, `peerDependencies`, and `devDependencies`.
2. Glob the project for `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, `.cjs`, skipping tests and auto-detected build outputs.
3. Parse each file with [oxc](https://oxc.rs) and collect `import`, `export … from`, `require()`, `import x = require()`, and dynamic `import()` with a string literal; resolve to package roots (e.g. `lodash/fp` → `lodash`).
4. Diff the two sets to produce four buckets: **unused**, **unusedPeer** (when `--check-peer`), **misplaced**, **typeOnly**.

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

A `dependencies` entry that is only ever imported as a type is listed under **Type-Only Imports** and counts as an issue: it could live in `devDependencies`. Colours are used only when stdout is a terminal and `NO_COLOR` is unset.

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

deps-finder uses static AST scanning, so dynamic patterns are invisible to it: `require(variable)`, `import(expr)`, `eval`, virtual modules from bundler plugins, packages loaded only via config files outside `src/`. The tool prefers under-reporting over over-reporting, but false positives still happen. When one does, `--ignore <pkg>` is the escape valve — and an issue report is welcome.

Packages that are used without being imported are reported as unused: CLIs run from `package.json` scripts (e.g. `husky` in `prepare`) and packages declared only to satisfy another package's optional peer (e.g. `@opentelemetry/api` for Next.js tracing). Pass them to `--ignore`. Top-level `scripts/` and `*.config.*` files (except bundler configs such as `vite.config`) are treated as dev tooling, not production source.

A bare builtin name such as `buffer` or `events` is matched against a declared package of that name (the npm polyfill a bundler would use). Write `node:buffer` when you mean the Node builtin.

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
