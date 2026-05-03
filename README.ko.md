# deps-finder

> TypeScript 프로젝트의 미사용·잘못 배치된 의존성, 그리고 고아(peer) 의존성을 잡아냅니다.

[![npm version](https://img.shields.io/npm/v/deps-finder.svg)](https://www.npmjs.com/package/deps-finder)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node ≥22](https://img.shields.io/badge/node-%E2%89%A522-brightgreen.svg)](https://nodejs.org)
[![Bun](https://img.shields.io/badge/runtime-bun-black.svg)](https://bun.sh)
[![CI](https://github.com/jazz1x/deps-finder/actions/workflows/ci.yml/badge.svg)](https://github.com/jazz1x/deps-finder/actions/workflows/ci.yml)

deps-finder는 `package.json`을 읽고 `src/**`를 순회하면서, 선언되어 있지만 어떤 소스 파일도 import하지 않는 패키지와, 코드에서 실제로 import하지만 잘못된 섹션에 들어 있는 패키지를 알려줍니다. 전부 로컬에서만 동작하며, 외부로 데이터를 보내지 않습니다. 또한 `peerDependencies`는 기본적으로 소비자(consumer)와의 계약으로 취급합니다 — `typescript`처럼 라이브러리 자체가 의도적으로 import하지 않는 진짜 peer가 흔하기 때문입니다. 고아 peer 탐지가 필요하면 `--check-peer`로 옵트인하세요.

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
- 빌드 출력 디렉토리(`dist`, `build` 등)를 자동 감지해 제외합니다.
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

Node.js ≥ 22이 필요합니다.

---

## 빠른 시작

```sh
# from the project root (where package.json lives)
deps-finder

# JSON output for CI / scripts
deps-finder --json

# also check peerDependencies and devDependencies
deps-finder --all
```

예상 출력 (일부 생략):

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

## 옵션

> `--help`와 이 표가 다르다면 `--help`가 정답입니다 — 이슈를 열어 주세요. 기준 소스는 [`src/constants/messages.ts:HELP_TEXT`](src/constants/messages.ts)입니다.

| 옵션 | 별칭 | 설명 |
|------|------|------|
| `--text` | `-t` | 텍스트로 출력 (기본값) |
| `--json` | `-j` | JSON으로 출력 |
| `--all` | `-a` | `dependencies`, `peerDependencies`, `devDependencies` 모두 검사 |
| `--check-peer` | `-p` | `peerDependencies`도 함께 검사 (기본 off, `--all` 시 on) — [peerDependencies 안내](#peerdependencies-안내) 참고 |
| `--ignore <pkgs>` | `-i` | 특정 패키지 무시 (쉼표로 구분) |
| `--exclude <globs>` | `-e` | 특정 파일/디렉토리 제외 (쉼표로 구분된 glob) |
| `--no-auto-detect` | — | 빌드 디렉토리 자동 감지 비활성화 |
| `--help` | `-h` | 도움말 표시 |

---

## 동작 원리

```
package.json ──┐
               ├─→  declared deps  ──┐
glob src/**  ──┤                     ├─→  diff  ──→  unused / unusedPeer / misplaced / typeOnly
               └─→  parsed imports  ─┘
```

1. `package.json`을 읽어 선언된 `dependencies`, `peerDependencies`, `devDependencies`를 가져옵니다.
2. `src/**`에서 `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`를 글롭(glob)하며, 주석과 자동 감지된 빌드 출력은 건너뜁니다.
3. `import` / `require` / 동적 `import()` 구문을 파싱해 패키지 루트로 정규화합니다 (예: `lodash/fp` → `lodash`).
4. 두 집합의 차집합을 구해 네 가지 버킷을 만듭니다: **unused**, **unusedPeer** (`--check-peer` 시), **misplaced**, **typeOnly**.

---

## 출력

**텍스트 형식** (기본값):

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

`--check-peer` (또는 `--all`)을 켜면, 어떤 소스에서도 import하지 않은 declared peer가 별도 섹션으로 보입니다:

```
⚠ Unused peerDependencies:
  (declared as a consumer contract but not imported in source code)
  • react
```

**JSON 형식** (`--json`, 일부 생략):

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

`unusedPeer`는 `--check-peer`가 꺼져 있는 기본 상태에선 `[]`입니다.

---

## CI 통합

deps-finder를 비차단(non-blocking) 린트 단계로 추가하거나, 결과가 있을 때 빌드를 실패시키도록 구성할 수 있습니다:

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

## peerDependencies 안내

`peerDependencies`는 사용 지표가 아니라 소비자와의 계약입니다 — 실제 peer(예: `typescript`, ESLint 플러그인의 peer 등)는 라이브러리 자신이 의도적으로 import하지 않는 경우가 많습니다. deps-finder는 기본적으로 이를 검사 대상에서 제외합니다. `--check-peer`로 옵트인하면 별도의 **Unused peerDependencies** 섹션에 표시됩니다.

---

## 정직한 사용 안내

deps-finder는 정적 AST 스캔을 사용하므로 동적 패턴은 보이지 않습니다: `require(variable)`, `import(expr)`, `eval`, 번들러 플러그인이 만드는 가상 모듈, `src/` 바깥의 설정 파일을 통해서만 로드되는 패키지 등이 그렇습니다. 도구는 과보고보다 누락 보고를 선호하지만, 그래도 오탐은 발생할 수 있습니다. 그럴 때는 `--ignore <pkg>`가 탈출구이며 — 이슈 리포트도 환영합니다.

---

## 개발

```sh
git clone https://github.com/jazz1x/deps-finder.git
cd deps-finder
bun install
bun run validate   # typecheck + lint + tests
```

테스트는 Bun을, 타입체크와 배포 빌드는 `tsgo` (TypeScript 7 native preview 컴파일러)를 사용합니다. 전체 스크립트 목록은 [package.json](package.json)을 참고하세요.

---

## 라이선스

[MIT](./LICENSE)
