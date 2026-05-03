# deps-finder

> Catch unused, misplaced, and orphan-peer dependencies in TypeScript projects.

[![npm version](https://img.shields.io/npm/v/deps-finder.svg)](https://www.npmjs.com/package/deps-finder)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node ≥22](https://img.shields.io/badge/node-%E2%89%A522-brightgreen.svg)](https://nodejs.org)
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

Requires Node.js ≥ 22.

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
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Dependency Analysis Report
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⚠ Unused Dependencies:
  • moment

⚠ Misplaced Dependencies:
  • zod (used in 1 file)
    └─ src/api/schema.ts:5
```

---

## Options

> If `--help` and this table disagree, `--help` wins — please open an issue. The source of truth is [`src/constants/messages.ts:HELP_TEXT`](src/constants/messages.ts).

| Option | Alias | Description |
|--------|-------|-------------|
| `--text` | `-t` | Output as text (default) |
| `--json` | `-j` | Output as JSON |
| `--all` | `-a` | Check `dependencies`, `peerDependencies`, and `devDependencies` |
| `--check-peer` | `-p` | Also check `peerDependencies` (off by default; on with `--all`) — see [peerDependencies note](#peerdependencies-note) |
| `--ignore <pkgs>` | `-i` | Ignore specific packages (comma-separated) |
| `--exclude <globs>` | `-e` | Exclude specific files/dirs (comma-separated globs) |
| `--no-auto-detect` | — | Disable automatic build directory detection |
| `--help` | `-h` | Show help message |

---

## How it works

```
package.json ──┐
               ├─→  declared deps  ──┐
glob src/**  ──┤                     ├─→  diff  ──→  unused / unusedPeer / misplaced / typeOnly
               └─→  parsed imports  ─┘
```

1. Read `package.json` to get declared `dependencies`, `peerDependencies`, and `devDependencies`.
2. Glob `src/**` for `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, while skipping comments and auto-detected build outputs.
3. Parse `import` / `require` / dynamic `import()` statements; resolve to package roots (e.g. `lodash/fp` → `lodash`).
4. Diff the two sets to produce four buckets: **unused**, **unusedPeer** (when `--check-peer`), **misplaced**, **typeOnly**.

---

## Output

**Text format** (default):

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Dependency Analysis Report
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⚠ Unused Dependencies:
  (declared but not imported in source code)
  • moment

⚠ Misplaced Dependencies:
  (in devDependencies but used in source code)
  • zod (used in 1 file)
    └─ src/api/schema.ts:5
       import { z } from 'zod'

  Type Imports Only (TypeScript)
  ○ typescript
  ○ @types/react

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Total Issues: 2
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

With `--check-peer` (or `--all`), an additional section appears for declared peers that no source file imports:

```
⚠ Unused peerDependencies:
  (declared as a consumer contract but not imported in source code)
  • react
```

**JSON format** (`--json`, truncated):

```json
{
  "unused": ["moment"],
  "unusedPeer": ["react"],
  "misplaced": [
    {
      "packageName": "zod",
      "locations": [
        { "file": "src/api/schema.ts", "line": 5, "importStatement": "import { z } from 'zod'" }
      ]
    }
  ],
  "ignored": {
    "typeOnly": ["typescript", "@types/react"],
    "byOption": ["eslint"]
  },
  "totalIssues": 3
}
```

`unusedPeer` is `[]` when `--check-peer` is off (default).

---

## CI integration

Add deps-finder as a non-blocking lint step, or fail the build on any finding:

```yaml
# .github/workflows/lint.yml
- run: npx deps-finder --json > deps-report.json
- run: |
    issues=$(jq '.totalIssues' deps-report.json)
    if [ "$issues" -gt 0 ]; then
      echo "::error::deps-finder found $issues issues"
      exit 1
    fi
```

---

## peerDependencies note

`peerDependencies` are a contract with consumers, not a usage indicator — many real peers (e.g. `typescript`, ESLint plugin peers) are intentionally never imported by the library itself. By default deps-finder skips them. Opt in with `--check-peer` and they appear in a separate **Unused peerDependencies** section.

---

## Honest-use notice

deps-finder uses static AST scanning, so dynamic patterns are invisible to it: `require(variable)`, `import(expr)`, `eval`, virtual modules from bundler plugins, packages loaded only via config files outside `src/`. The tool prefers under-reporting over over-reporting, but false positives still happen. When one does, `--ignore <pkg>` is the escape valve — and an issue report is welcome.

---

## Development

```sh
git clone https://github.com/jazz1x/deps-finder.git
cd deps-finder
bun install
bun run validate   # typecheck + lint + tests
```

The project uses Bun for tests and `tsgo` (the TypeScript 7 native preview compiler) for typecheck and the published build. See [package.json](package.json) for the full script list.

---

## License

[MIT](./LICENSE)
