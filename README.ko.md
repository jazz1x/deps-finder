# deps-finder

> TypeScript 프로젝트의 미사용·잘못 배치된 의존성, 그리고 고아(peer) 의존성을 잡아냅니다.

[![npm version](https://img.shields.io/npm/v/deps-finder.svg)](https://www.npmjs.com/package/deps-finder)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node ≥22.12](https://img.shields.io/badge/node-%E2%89%A522.12-brightgreen.svg)](https://nodejs.org)
[![Bun](https://img.shields.io/badge/runtime-bun-black.svg)](https://bun.sh)
[![CI](https://github.com/jazz1x/deps-finder/actions/workflows/ci.yml/badge.svg)](https://github.com/jazz1x/deps-finder/actions/workflows/ci.yml)

deps-finder는 `package.json`을 읽고 프로젝트의 소스 파일을 순회하면서, 선언되어 있지만 어떤 소스 파일도 import하지 않는 패키지와, 코드에서 실제로 import하지만 잘못된 섹션에 들어 있는 패키지를 알려줍니다. 전부 로컬에서만 동작하며, 외부로 데이터를 보내지 않습니다. 또한 `peerDependencies`는 기본적으로 소비자(consumer)와의 계약으로 취급합니다 — `typescript`처럼 라이브러리 자체가 의도적으로 import하지 않는 진짜 peer가 흔하기 때문입니다. 고아 peer 탐지가 필요하면 `--check-peer`로 옵트인하세요.

한국어 · [English](./README.md)

---

## 목차

- [주요 기능](#주요-기능)
- [설치](#설치)
- [빠른 시작](#빠른-시작)
- [옵션](#옵션)
- [동작 원리](#동작-원리)
- [출력](#출력)
- [CI 통합](#ci-통합)
- [peerDependencies 안내](#peerdependencies-안내)
- [정직한 사용 안내](#정직한-사용-안내)
- [개발](#개발)
- [라이선스](#라이선스)

---

## 주요 기능

- **미사용(unused)** 의존성 감지 — `package.json`에 선언되어 있지만 어디서도 import하지 않는 패키지.
- **잘못 배치된(misplaced)** 의존성 감지 — 소스에서 사용 중이지만 `devDependencies`에 들어 있는 패키지.
- **고아 peer(orphan peers)** 감지 — `peerDependencies`에 선언되었지만 import되지 않음 (`--check-peer`로 옵트인).
- **타입 전용(type-only)** import는 별도로 보고하여 미사용 목록을 오염시키지 않습니다.
- `.gitignore`를 따르고, 프로젝트 루트의 빌드 출력 디렉토리(`dist`, `build` 등)를 자동 감지해 제외합니다.
- 한 번에 패키지 하나를 검사합니다. 모노레포에서는 워크스페이스 패키지마다 그 안에서 실행하세요.
- 컬러 텍스트 또는 머신 판독 가능한 JSON으로 출력합니다.
- **친절한 에러·경고 메시지** — 파일이 없거나 JSON이 잘못됐거나 플래그에 값을 빠뜨린 경우, 어떻게 고치면 되는지 알려주는 한 줄 메시지로 출력합니다.

---

## 설치

```sh
npm install -D deps-finder
```

설치 없이 한 번만 실행하려면:

```sh
npx deps-finder
```

Node.js ≥ 22.12가 필요합니다.

---

## 빠른 시작

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

예상 출력 (일부 생략):

```
⚠  Unused Dependencies:
  • moment

⚠  Misplaced Dependencies:
  • zod (used in 1 file)
    └─ src/api/schema.ts:5
```

---

## 옵션

```sh
deps-finder [options] [<root>]
```

`<root>`는 `package.json`이 있는 프로젝트 디렉토리입니다 (기본값: 현재 디렉토리).

> `--help`와 이 표가 다르다면 `--help`가 정답입니다 — 이슈를 열어 주세요. 기준 소스는 [`src/cli/command.ts`](src/cli/command.ts)입니다.

| 옵션 | 별칭 | 설명 |
|------|------|------|
| `--text` | `-t` | 텍스트로 출력 (기본값) |
| `--json` | `-j` | JSON으로 출력 |
| `--all` | `-a` | 미사용 `devDependencies`·`peerDependencies`도 보고 (peer는 `unusedPeer`에만, misplaced 검사는 그대로) |
| `--check-peer` | `-p` | `peerDependencies`도 함께 검사 (기본 off, `--all` 시 on) — [peerDependencies 안내](#peerdependencies-안내) 참고 |
| `--ignore <pkgs>` | `-i` | 패키지 무시 (쉼표로 구분, 반복 가능, `--ignore=a,b`) |
| `--exclude <patterns>` | `-e` | `.gitignore` 형식 패턴으로 파일/디렉토리 제외. `./src/x`와 프로젝트 안의 절대 경로는 프로젝트 루트 기준으로 맞춥니다 (쉼표로 구분, 반복 가능) |
| `--no-auto-detect` | — | 빌드 디렉토리 자동 감지 비활성화 |
| `--version` | `-v` | 버전 출력 |
| `--help` | `-h` | 도움말 표시 |

모르는 플래그나 값이 빠진 플래그는 경고가 아니라 오류입니다.

**종료 코드**

| 코드 | 의미 |
|------|------|
| `0` | 이슈 없음 |
| `1` | 이슈 발견 |
| `2` | 실행 실패 (잘못된 플래그, `package.json` 없음·손상) |

---

## 동작 원리

```
package.json ──┐
               ├─→  declared deps  ──┐
walk project ──┤                     ├─→  diff  ──→  unused / unusedPeer / misplaced / typeOnly
               └─→  parsed imports  ─┘
```

1. `package.json`을 읽어 선언된 `dependencies`, `peerDependencies`, `devDependencies`를 가져옵니다.
2. 프로젝트를 돌며 `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, `.cjs` 파일과 직접 작성한 선언 파일(`.d.ts`, `.d.mts`, `.d.cts`), `tsconfig*.json`을 모읍니다. 숨김 파일과 숨김 디렉토리도 포함합니다. `.git/`과 `node_modules/`, 프로젝트의 `.gitignore`(루트, 하위 디렉토리, 그리고 git 저장소 최상위까지의 상위 디렉토리의 것 모두와 `.git/info/exclude`. git 규칙 그대로. 다만 대소문자는 늘 구분하므로, macOS·Windows 기본값인 `core.ignorecase`가 켜진 git과 다를 수 있음)가 무시하는 파일, 각 레이아웃 루트(아래 설명)의 빌드 출력인 `dist/`, `build/`, `out/`, `coverage/`, 그리고 프로젝트 루트에서 자동 감지된 출력 디렉토리(tsconfig `outDir`, 스크립트의 `--outDir`, `*-dist` 같은 이름)는 건너뜁니다. 저장소가 무시하는 디렉토리를 프로젝트로 지정해도 검사하며, 이때는 그 디렉토리 안의 `.gitignore`만 씁니다. 심볼릭 링크 파일은 따라가고, 심볼릭 링크 디렉토리는 따라가지 않습니다. 프로젝트 루트(또는 저장소 안의 그 위 디렉토리)에 `.gitignore`가 없으면 각 레이아웃 루트의 흔한 프레임워크·캐시 디렉토리(`.next/`, `.turbo/`, `.cache/`, `storybook-static/` 등)와 깊이와 상관없이 `.venv/`, `.gradle/`, `.claude/`, `.idea/`, `.vscode/`도 건너뜁니다. `package.json`이 있는 하위 디렉토리가 워크스페이스 멤버이거나(루트 `package.json`의 `workspaces`가 배열이든 `{"packages": [...]}`이든 그 목록에, 또는 루트 `pnpm-workspace.yaml`의 `packages` 목록에 걸리면. `!` 부정 패턴도 따름. `workspaces`에서는 npm처럼 앞의 `!` 패턴에 그 문자열 자체가 걸리는 뒤 패턴(`!packages/b` 뒤의 `packages/b` 같은)이 그 `!` 패턴을 취소하고, `pnpm-workspace.yaml`에서는 pnpm처럼 `!` 패턴이 늘 이김) 자기 lockfile(`package-lock.json`, `npm-shrinkwrap.json`, `yarn.lock`, `pnpm-lock.yaml`, `bun.lock`, `bun.lockb`)이나 `node_modules/`가 있으면 별도 패키지입니다. 그 아래 전체를 이번 실행의 검사에서 빼고, 뺀 디렉토리를 stderr에 알립니다. 다만 그 패키지가 자기 `package.json`의 `dependencies`나 `devDependencies`에 두지 않은 패키지(peer로만 선언하면 그 패키지에는 아무것도 설치되지 않음)를 import하면 Node가 루트 설치에서 찾으므로 루트의 의존성을 사용 중으로 셉니다. 이때는 development 사용으로 세므로 misplaced나 type-only가 되지는 않습니다. `workspaces`나 `pnpm-workspace.yaml`의 형식이 잘못되면 stderr에 알리고 그것 없이 검사를 이어 갑니다. 그 밖의 `package.json`은 `name`과 의존성이 있어도 이번 실행에 포함합니다. 루트 설치에서 의존성을 찾는 Nx식 라이브러리가 그런 경우입니다. 프로젝트 루트와, 검사하는 디렉토리 중 `package.json`에 `name`이 있거나 Nx `project.json`(문자열 `name`이나 `targets`·`$schema` 키가 있는 것)이 있는 곳이 레이아웃 루트이며, 파일은 가장 가까운 것만이 아니라 위에 있는 레이아웃 루트 모두를 기준으로 봅니다. `{"sideEffects": false}`처럼 `name`이 없는 `package.json`은 레이아웃 루트가 아닙니다. 파일마다 **development**와 **production** 중 하나로 표시합니다. development는 시험·spec·스토리·시험 설정 파일, 깊이와 상관없이 `test/`, `tests/`, `__tests__/`, `__mocks__/`, `e2e/`, `cypress/`, `playwright/`, `.storybook/` 아래의 파일, 깊이와 상관없이 `.eslintrc.js` 같은 dotfile, 그리고 레이아웃 루트에만 해당하는 `*.config.*`·`*.preset.*` 파일(`webpack.config.prod.js` 포함), `scripts/` 디렉토리, `.husky/`나 `.github/` 같은 숨김 디렉토리입니다. 나머지는 모두 production이며, `src/app.config.ts`, `src/scripts/`, `src/.generated/`, 그리고 `stories/`라는 이름의 기능 폴더도 여기에 들어갑니다.
3. 파일마다 [oxc](https://oxc.rs)로 파싱해 `import`, `export … from`, `require()`, `import x = require()`, 문자열 리터럴 동적 `import()`를 모으고 패키지 루트로 정규화합니다 (예: `lodash/fp` → `lodash`). 타입 자리의 참조는 type-only 사용으로 셉니다. `import("x").T`와 `typeof import("x")`, `/** */` 주석 안 JSDoc의 `import("x")`와 `@import { T } from "x"`, `/// <reference types="x" />`, 자기 `import`나 `export`가 있는 파일의 `declare module "x"`(없는 파일에서는 앰비언트 모듈 선언이라 아무것도 세지 않음), 그리고 선언 파일 안의 모든 import가 여기에 들어갑니다. 어디에든 TypeScript 소스(선언 파일 포함)나 `tsconfig*.json`이 있으면 `typescript`를 development 사용으로 셉니다.
4. 루트의 `tsconfig.json`과 `tsconfig.base.json`을 읽고 `extends`를 따라갑니다. 상대 경로, 그리고 extends하는 파일의 디렉토리나 그 위 `node_modules`에 설치된 패키지를 따라갑니다. 찾지 못한 extends 파일은 stderr에 경고합니다. 가장 가까운 `compilerOptions.types`의 항목은 그 패키지의 development 타입 사용입니다(`vitest/globals` → `vitest`). `@tsconfig/node20` 같은 `extends` 패키지는 development 사용이고, 가장 가까운 `compilerOptions.importHelpers: true`는 `tslib`의 production 런타임 사용입니다.
5. 선언한 `@types/x`는 `x`나 그 하위 경로를 위의 어느 방식으로든 쓰면 사용 중입니다. `@scope/name`은 `@types/scope__name`, Node 내장 모듈(`fs`든 `node:fs`든, `node:module`의 `builtinModules` 기준)과 `"types": ["node"]`는 `@types/node`, `bun`과 `bun:*`은 `@types/bun`으로 짝짓습니다. 이것만으로 misplaced나 type-only가 되지는 않습니다. `types`를 지정하지 않으면 TypeScript가 모든 `@types` 패키지를 읽지만, `x`를 쓰지 않는 `@types/x`는 그대로 보고합니다.
6. 두 집합의 차집합을 구해 네 가지 버킷을 만듭니다: **unused**, **unusedPeer** (`--check-peer` 시), **misplaced**, **typeOnly**. 어느 파일에서 import해도 사용으로 칩니다. **misplaced**와 **typeOnly**는 production 파일만 보므로, 시험이나 도구에서만 쓰는 `devDependency`는 misplaced로 나오지 않습니다.

---

## 출력

**텍스트 형식** (기본값):

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

`dependencies`에 있지만 타입으로만 import되는 패키지는 **Type-Only Imports**에 나오고 이슈로 셉니다 — `devDependencies`로 옮길 수 있기 때문입니다. 색은 stdout이 터미널이고 `NO_COLOR`가 비어 있을 때만 씁니다.

`--check-peer` (또는 `--all`)을 켜면, 어떤 소스에서도 import하지 않은 declared peer가 별도 섹션으로 보입니다:

```
⚠  Unused peerDependencies:
  (declared as a consumer contract but not imported in source code)

  • react-dom
```

**JSON 형식** (`--json --check-peer`, `file` 경로는 절대 경로):

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

`unusedPeer`는 `--check-peer`가 꺼져 있는 기본 상태에선 `[]`입니다. `ignored`에는 `--ignore`로 넘긴 패키지가 들어갑니다.

---

## CI 통합

이슈가 하나라도 있으면 빌드를 실패시키려면:

```yaml
- run: npx deps-finder
```

이슈로는 막지 않고 리포트만 남기되, 실행 자체가 실패하면(종료 코드 `2`) 막으려면:

```yaml
- run: npx deps-finder --json > deps-report.json || [ $? -eq 1 ]
```

---

## peerDependencies 안내

`peerDependencies`는 사용 지표가 아니라 소비자와의 계약입니다 — 실제 peer(예: `typescript`, ESLint 플러그인의 peer 등)는 라이브러리 자신이 의도적으로 import하지 않는 경우가 많습니다. deps-finder는 기본적으로 이를 검사 대상에서 제외합니다. `--check-peer`로 옵트인하면 별도의 **Unused peerDependencies** 섹션에 표시됩니다.

---

## 정직한 사용 안내

deps-finder는 정적 AST 스캔을 사용하므로 동적 패턴은 보이지 않습니다: `require(variable)`, `import(expr)`, `eval`, 번들러 플러그인이 만드는 가상 모듈, 설정 파일에 문자열(플러그인·프리셋 이름)로만 적힌 패키지 등이 그렇습니다. 러너 설정이 엉뚱한 자리를 시험으로 가리키는 경우(Playwright `testDir`, 스크립트로만 돌리는 `codegen.ts`, 시험에서만 import하는 `src/mocks/`)는 production으로 취급합니다. 도구는 과보고보다 누락 보고를 선호하지만, 그래도 오탐은 발생할 수 있습니다. 그럴 때는 `--ignore <pkg>`가 탈출구이며 — 이슈 리포트도 환영합니다.

import 없이 쓰이는 패키지는 unused로 보고됩니다: `package.json` 스크립트에서 실행하는 CLI(예: `prepare`의 `husky`), 다른 패키지의 optional peer를 채우려고만 선언한 패키지(예: Next.js 추적용 `@opentelemetry/api`)가 그렇습니다. `--ignore`로 넘기세요.

`buffer`, `events` 같은 내장 모듈 이름을 접두사 없이 쓰면, 같은 이름으로 선언된 패키지(번들러가 쓰는 npm 폴리필)와 맞춰 봅니다. Node 내장 모듈을 뜻한다면 `node:buffer`처럼 쓰세요.

---

## 개발

```sh
git clone https://github.com/jazz1x/deps-finder.git
cd deps-finder
bun install
bun run validate   # typecheck + lint + format + tests
```

테스트는 Bun을, 타입체크와 배포 빌드는 TypeScript 7의 `tsc`를 사용합니다. 전체 스크립트 목록은 [package.json](package.json)을 참고하세요.

---

## 라이선스

[MIT](./LICENSE)
