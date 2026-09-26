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
- JS·TS 소스, Vue·Svelte·Astro 컴포넌트, CSS·SCSS·Less 스타일시트를 읽습니다.
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
| `2` | 실행 실패 (잘못된 플래그, `package.json` 없음·손상, unused를 가려야 하는데 의존성이 설치되지 않음, 리포트를 쓰지 못함) |

---

## 동작 원리

```
package.json ──┐
               ├─→  declared deps  ──┐
walk project ──┤                     ├─→  diff  ──→  unused / unusedPeer / misplaced / typeOnly
               └─→  parsed imports  ─┘
```

1. `package.json`을 읽어 선언된 `dependencies`, `optionalDependencies`, `peerDependencies`, `devDependencies`를 가져옵니다. `optionalDependencies`는 `dependencies`처럼 소비자에게 설치되므로 똑같이 다룹니다: 기본으로 미사용 검사를 하고 **Unused Dependencies**에 보고하며, `devDependencies`에도 있어도 misplaced로 보지 않고, 타입으로만 쓰이면 type-only로 보고합니다. `fsevents`처럼 특정 플랫폼 전용이라 아무도 import하지 않는 패키지는 미사용으로 나오니 `--ignore`에 넘기세요.
2. 프로젝트를 돌며 `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.vue`, `.svelte`, `.astro`, `.css`, `.pcss`, `.postcss`, `.scss`, `.less` 파일과 직접 작성한 선언 파일(`.d.ts`, `.d.mts`, `.d.cts`), `tsconfig*.json`을 모읍니다. 숨김 파일과 숨김 디렉토리도 포함합니다. 무시되는 디렉토리는 아예 열어 보지 않으므로 큰 gitignore 캐시도 시간을 들이지 않습니다. 목록을 읽을 수 없는 디렉토리는 읽을 수 없는 소스 파일처럼 stderr에 경고합니다. `.git/`과 `node_modules/`, 프로젝트의 `.gitignore`(루트, 하위 디렉토리, 그리고 git 저장소 최상위까지의 상위 디렉토리의 것 모두와 `.git/info/exclude`. git 규칙 그대로. 다만 대소문자는 늘 구분하므로, macOS·Windows 기본값인 `core.ignorecase`가 켜진 git과 다를 수 있음)가 무시하는 파일, 각 레이아웃 루트(아래 설명)의 빌드 출력인 `dist/`, `build/`, `out/`, `coverage/`, 그리고 프로젝트 루트에서 자동 감지된 출력 디렉토리(루트의 모든 `tsconfig*.json`이 `extends` 체인을 따라 정한 `outDir`과 `declarationDir`. 상대 경로는 그 값을 적은 파일 기준, `${configDir}`는 extends 하는 파일 기준으로 풂. 스크립트의 `--outDir`, `--out-dir`, `--outdir`(`=`나 공백 뒤 값)과 `babel`·`swc`의 `-d`. `*-dist` 같은 이름)는 건너뜁니다. 출력 디렉토리가 프로젝트 루트 자신이거나 그 바깥이면 아무것도 제외하지 않습니다. 이때 두 경로의 심볼릭 링크는 먼저 풉니다. 저장소가 무시하는 디렉토리를 프로젝트로 지정해도 검사하며, 이때는 그 디렉토리 안의 `.gitignore`만 씁니다. 심볼릭 링크 파일은 따라가고, 심볼릭 링크 디렉토리는 따라가지 않습니다. 프로젝트 루트(또는 저장소 안의 그 위 디렉토리)에 `.gitignore`가 없으면 각 레이아웃 루트의 흔한 프레임워크·캐시 디렉토리(`.next/`, `.turbo/`, `.cache/`, `storybook-static/` 등)와 깊이와 상관없이 `.venv/`, `.gradle/`, `.claude/`, `.idea/`, `.vscode/`도 건너뜁니다. `package.json`이 있는 하위 디렉토리가 워크스페이스 멤버이거나(루트 `package.json`의 `workspaces`가 배열이든 `{"packages": [...]}`이든 그 목록에, 또는 루트 `pnpm-workspace.yaml`의 `packages` 목록에 걸리면. `!` 부정 패턴도 따름. `workspaces`에서는 npm처럼 앞의 `!` 패턴에 그 문자열 자체가 걸리는 뒤 패턴(`!packages/b` 뒤의 `packages/b` 같은)이 그 `!` 패턴을 취소하고, `pnpm-workspace.yaml`에서는 pnpm처럼 `!` 패턴이 늘 이김) 자기 lockfile(`package-lock.json`, `npm-shrinkwrap.json`, `yarn.lock`, `pnpm-lock.yaml`, `bun.lock`, `bun.lockb`)이나 `node_modules/`가 있으면 별도 패키지입니다. 그 아래 전체를 이번 실행의 검사에서 빼고, 뺀 디렉토리를 stderr에 알립니다. 다만 그 패키지가 자기 `package.json`의 `dependencies`, `optionalDependencies`, `devDependencies`에 두지 않은 패키지(peer로만 선언하면 그 패키지에는 아무것도 설치되지 않음)를 import하면 Node가 루트 설치에서 찾으므로 루트의 의존성을 사용 중으로 셉니다. 이때는 development 사용으로 세므로 misplaced나 type-only가 되지는 않습니다. `workspaces`나 `pnpm-workspace.yaml`의 형식이 잘못되면 stderr에 알리고 그것 없이 검사를 이어 갑니다. 그 밖의 `package.json`은 `name`과 의존성이 있어도 이번 실행에 포함합니다. 루트 설치에서 의존성을 찾는 Nx식 라이브러리가 그런 경우입니다. 프로젝트 루트와, 검사하는 디렉토리 중 `package.json`에 `name`이 있거나 Nx `project.json`(문자열 `name`이나 `targets`·`$schema` 키가 있는 것)이 있는 곳이 레이아웃 루트이며, 파일은 가장 가까운 것만이 아니라 위에 있는 레이아웃 루트 모두를 기준으로 봅니다. `{"sideEffects": false}`처럼 `name`이 없는 `package.json`은 레이아웃 루트가 아닙니다. 파일마다 **development**와 **production** 중 하나로 표시합니다. development는 시험·spec·스토리·시험 설정 파일, 깊이와 상관없이 `test/`, `tests/`, `__tests__/`, `__mocks__/`, `e2e/`, `cypress/`, `playwright/`, `.storybook/` 아래의 파일, 깊이와 상관없이 `.eslintrc.js` 같은 dotfile, 그리고 레이아웃 루트에만 해당하는 `*.config.*`·`*.preset.*` 파일(`webpack.config.prod.js` 포함), `scripts/` 디렉토리, `.husky/`나 `.github/` 같은 숨김 디렉토리입니다. 다만 검사하는 `package.json`의 `bin`이 가리키는 파일은 사용자에게 배포되므로 production입니다. 나머지는 모두 production이며, `src/app.config.ts`, `src/scripts/`, `src/.generated/`, 그리고 `stories/`라는 이름의 기능 폴더도 여기에 들어갑니다.
3. 파일마다 [oxc](https://oxc.rs)로 파싱해 `import`, `export … from`, `require()`, `import x = require()`, 문자열 리터럴 동적 `import()`를 모으고 패키지 루트로 정규화합니다 (예: `lodash/fp` → `lodash`). 이때 `?query`나 `#fragment` 꼬리는 떼어냅니다 (`x/icon.svg?raw`, `x?url` → `x`). `require.resolve()`, `module.require()`, `import.meta.resolve()`, 그리고 `createRequire(…)`가 만든 함수도 `require()`처럼 셉니다: `const req = createRequire(import.meta.url); req("x")`, `req.resolve("x")`, `createRequire(…)("x")`가 그렇고, `createRequire`는 `module`이나 `node:module`에서 import했거나 객체에서 읽어 온 것(`m.createRequire`, `process.getBuiltinModule("module").createRequire`)입니다. `require.resolve.paths()`는 불러오기가 아닙니다. `${}`가 없는 템플릿 리터럴은 문자열 리터럴로 셉니다. `#name` 지정자는 패키지가 아닙니다: 파일 위로 가장 가까운, `name`이 있는 스캔 대상 `package.json`의 `imports` 필드로 풀고(Node는 종류를 가리지 않고 가장 가까운 것을 쓰므로, 사이에 있는 이름 없는 `{"sideEffects": false}`는 여기서 건너뜀)(Node처럼 정확히 같은 키, 없으면 `*` 앞 접두사가 가장 긴 패턴), 어느 조건 아래든 그 대상이 가리키는 패키지를 모두 import의 종류와 파일의 문맥 그대로 사용으로 셉니다. `./` 대상은 로컬입니다. 맨 이름 지정자는 파일을 컴파일하는 tsconfig(4단계처럼 파일 위로 가장 가까운, tsconfig가 있는 디렉토리에서 `files`나 `include`에서 `exclude`를 뺀 범위가 그 파일을 덮는 것만 대체 없이 고르고, `extends`를 따라감)의 `compilerOptions.paths`와 `baseUrl`로, `?query`나 `#fragment` 꼬리를 뗀 뒤 `tsc`처럼 풉니다. 가장 잘 맞는 paths 키가 대상을 차례로 시도하는데, 있는 선언 파일 대상(`.d.ts`, `.d.mts`, `.d.cts`)은 타입만 돌려놓으므로 지정자는 그 이름의 패키지 사용 그대로이고, tsconfig 디렉토리 아래에서 `node_modules/`를 거쳐 풀리는 대상이나 첫 마디가 기준 디렉토리의 어떤 항목과도 맞지 않는 맨 이름 대상(`lodash-es` 같은)은 그 패키지 사용이고, 나머지는 그 자리에 파일이 있을 때(`.ts`, `.tsx`, `.d.ts`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.json` 확장자나 `index` 파일 포함, `.js`·`.jsx`·`.mjs`·`.cjs`로 적은 경로는 그것을 내보내는 `.ts`·`.tsx`·`.mts`·`.cts` 소스 포함) 로컬입니다. 맞는 키가 있는데 어느 대상도 풀리지 않으면 지정자는 그 이름의 패키지이고, `baseUrl`은 시도하지 않습니다. 맞는 키가 없으면 `baseUrl` 아래 파일로 풀리는 지정자는 로컬이고, tsconfig 디렉토리 아래의 `node_modules/`로 풀리는 지정자는 그 패키지입니다. 그래서 `"utils/*": ["src/utils/*"]`가 있으면 `utils/format`은 선언된 `utils`의 사용이 아니라 로컬입니다. 다만 풀린 로컬 파일이 import하는 파일 위로 가장 가까운 `node_modules`에 설치된, 지정자 이름의 패키지 안에 있으면(거기 링크된 워크스페이스 패키지를 `"@ws/ui": ["../../packages/ui/src/index.ts"]`처럼 소스로 별칭한 경우) 그 패키지 사용입니다. 대상은 `baseUrl`에서, 없으면 `paths`를 둔 tsconfig에서 풉니다. oxc가 파일의 구문 오류에서 멈추면 stderr에 파일과 오류의 줄을 알립니다. 오류 앞의 것은 일부만 셉니다: `import`와 `export` 문, `import()` 호출, 주석 속 타입 import(JSDoc `import("x")`와 `@import`, `/// <reference types="x" />`)입니다. 그 파일의 나머지는 세지 않습니다: 오류 앞이라도 `require()`, `import.meta.resolve()`, `import x = require()`, `declare module "x"`는 세지 않고, 오류 뒤는 아무것도 세지 않습니다. 앰비언트 문맥의 초기화 식 같은 TypeScript 문법 규칙 오류는 파싱을 온전히 남기므로, 파일의 모든 것을 세고 아무것도 알리지 않습니다. deps-finder는 타입 검사기가 아닙니다. 타입 자리의 참조는 type-only 사용으로 셉니다. `import("x").T`와 `typeof import("x")`, `/** */` 주석 안 JSDoc의 `{타입}` 속 `import("x")`와 `@import { T } from "x"`, `/// <reference types="x" />`, 자기 `import`나 `export`가 있는 파일의 `declare module "x"`(없는 파일에서는 앰비언트 모듈 선언이라 아무것도 세지 않음), 그리고 선언 파일 안의 모든 import가 여기에 들어갑니다. 어디에든 TypeScript 소스(선언 파일 포함)나 `tsconfig*.json`이 있으면 `typescript`를 development 사용으로 셉니다. `.js`, `.mjs`, `.cjs` 파일은 JSX를 허용해 파싱하고, `import`나 `export`가 없는 `.js`나 `.cjs` 파일이 모듈로 파싱되지 않으면 Node가 실행하는 대로 CommonJS로 파싱하므로 최상위 `return`은 오류가 아닙니다. 파일은 UTF-8로 읽고, UTF-16 바이트 순서 표시로 시작하면 UTF-16으로 읽습니다. `.vue`와 `.svelte` 컴포넌트는 `<script>` 블록마다(`<script setup>`과 Svelte 모듈 스크립트 포함) `lang` 속성의 언어(`ts`, `tsx`, `jsx`, 없으면 JavaScript)로, `.astro` 컴포넌트는 `---` 프런트매터와 `<script>` 태그를 TypeScript로 파싱합니다. `.vue`와 `.svelte` 파일은 컴파일러가 읽는 대로 최상위 블록만 세고, `.astro` 파일은 Astro가 마크업 어디서든 처리하므로 마크업 어디에 있는 `<script>`·`<style>`이든 셉니다. `.vue` 파일에서 그 밖의 최상위 블록(`<docs>`, `<i18n>` 등)은 통째로 텍스트이고, `<template>` 안의 `{{ }}` 보간이나 속성 값 속 태그도 텍스트입니다. HTML 주석, Vue `<template>`, Svelte 요소(`<svelte:head>` 포함)나 `{ }` 표현식 안의 `<script>`·`<style>`은 마크업이고, Astro 프런트매터 안의 것은 코드입니다. 스스로 닫는 `<script src="…" />`에는 본문이 없습니다. 줄 번호는 컴포넌트 파일 기준입니다. 컴포넌트는 컴파일 결과가 import하는 `vue`, `svelte`, `astro`의 runtime 사용으로 셉니다. 스타일시트와 컴포넌트의 `<style>` 블록(`lang`이 `css`, `postcss`, `scss`, `less`이거나 없을 때)은 PostCSS로 파싱해, `@import`, `@use`, `@forward`의 따옴표나 `url()` 속 대상은 그 파일의 문맥에서 runtime import로 셉니다. `@plugin`, `@config`, `@reference`의 대상은 빌드가 실행하거나 읽기만 하고 결과물에 넣지 않으므로 development 사용으로 셉니다. webpack의 `~` 접두사는 떼어 냅니다(`~bootstrap/scss/x` → `bootstrap`). 상대·절대 경로, URL, `data:`, `sass:` 모듈은 패키지가 아니고, 선언 안의 `url()`은 import가 아니라 에셋입니다. 파싱되지 않는 스타일시트는 stderr에 경고하고 그 import를 세지 않습니다. 파싱되지 않는 컴포넌트 `<style>` 블록은 그 블록만 경고하고, 컴포넌트의 다른 블록은 그대로 셉니다. automatic 런타임(tsconfig `jsx`가 `react-jsx`, `react-jsxdev`, `preserve`, `react-native`이거나 아예 없을 때)에서는 JSX가 있는 파일을 그 JSX 런타임 패키지의 런타임 사용으로 셉니다. `/** @jsxImportSource x */` 프래그마가 있으면 `x`, 없으면 그 파일에 적용되는 `jsxImportSource`, 그것도 없으면 `react`입니다. classic 런타임인 `"jsx": "react"`에서는 팩토리를 직접 import하므로 더 세지 않습니다. `jsxImportSource` 없이 `preserve`나 `react-native`이면 `tsc`가 팩토리 import(`jsxFactory`, 없으면 `React`)도 남기므로, JSX 요소를 그 팩토리의 값 사용으로 셉니다. `/** @jsxRuntime classic */`이나 `/** @jsxRuntime automatic */` 프래그마는 그 파일을 해당 런타임으로 바꾸고, classic 런타임에서 `/** @jsx f */` 프래그마는 팩토리를 `f`로 정합니다. TypeScript가 지우는 import는 type-only로 셉니다. `import type`, 인라인 `type` 지정자로만 된 import, 그리고 TypeScript 소스에서 바인딩을 하나도 값으로 쓰지 않는 import입니다. 타입 참조, 타입 리터럴, 타입 매개변수, `typeof` 타입 쿼리, 인터페이스, `implements` 절, 타입 전용 export, 속성·클래스 멤버·enum 멤버의 키, 레이블은 값 사용이 아니고, 호출, JSX 태그, 데코레이터, 식 안의 `typeof`, `export default`, `export { X }`는 값 사용입니다. 여기서는 스코프를 따지지 않으므로, import한 이름을 다시 쓰는 매개변수나 지역 변수가 있으면 그 import를 남깁니다. 값 사용 여부는 misplaced가 될 `devDependency`의 production import만 확인합니다. 값으로 import한 `dependencies` 항목은 이 방법으로 **Type-Only Imports**에 옮기지 않습니다. 그런 패키지는 다른 의존성의 런타임 peer인 경우가 많기 때문입니다(`@apollo/client`의 `graphql`). 적용되는 tsconfig에 `verbatimModuleSyntax`, `preserveValueImports`, 또는 `preserve`·`error`인 `importsNotUsedAsValues`가 있으면 `import type`과 `export type`만 지웁니다. `emitDecoratorMetadata`가 있으면 내보내는 메타데이터가 타입을 가리킬 수 있으므로 값 사용을 확인하지 않습니다. development 파일이 `describe`, `it`, `test`, `expect`, `beforeEach`, `afterEach`(또는 `it.each`처럼 그 멤버)를 전역으로, 즉 import하지도 않고 호출을 둘러싼 스코프에서 변수·함수·매개변수·클래스로 선언하지도 않은 채 부르면 `@types/jest`, `@types/mocha`, `@types/jasmine`의 development 타입 사용으로 셉니다. 주석과 문자열 속 이름은 세지 않습니다.
4. 각 레이아웃 루트에서 찾은 `tsconfig*.json` 전부와 그 `references[].path`가 가리키는 프로젝트(파일, 또는 `tsconfig.json`이 있는 디렉토리)를 읽고, 모두의 `extends`를 따라갑니다(`tsconfig.base.json`처럼 다른 루트가 extends하는 루트는 그 루트를 통해서만 읽습니다). 상대 경로, 그리고 extends하는 파일의 디렉토리나 그 위 `node_modules`에 설치된 패키지를 따라갑니다. 찾지 못한 extends·references 파일은 stderr에 경고합니다. 각 체인에서 가장 가까운 `compilerOptions.types`의 항목은 그 패키지의 development 타입 사용입니다(`vitest/globals` → `vitest`. 그래서 `tsconfig.spec.json`의 `"types": ["jest"]`도 셈). `@tsconfig/node20` 같은 `extends` 패키지(또는 `node_modules/@tsconfig/node20/`으로 들어가는 상대 경로)는 development 사용이고, 가장 가까운 `compilerOptions.importHelpers: true`는 `tslib`의 production 런타임 사용입니다. 소스 파일의 `jsx`, `jsxImportSource`, `jsxFactory`, `verbatimModuleSyntax`, `preserveValueImports`, `importsNotUsedAsValues`, `emitDecoratorMetadata`는 tsconfig 파일이 있는 가장 가까운 위 디렉토리의 것을 따릅니다. 그중 `files`나 `include`에서 `exclude`를 뺀 범위가 그 파일을 덮는 tsconfig를 쓰고(경로는 그 값을 정한 tsconfig 기준이고, 둘 다 없으면 자기 디렉토리 아래 전부), 없으면 `tsconfig.json`, 그것도 없으면 전부를 씁니다. 옵션은 tsconfig마다 자기 `extends` 체인에서 읽고, 여러 tsconfig가 덮는 파일은 그들이 정한 JSX 런타임을 모두, elision은 import를 가장 많이 남기는 쪽을 받습니다. 값이 `null`인 옵션은 `tsc`처럼 물려받은 값을 지우고, 타입이 맞지 않는 옵션은 무시하되 파일의 나머지는 그대로 씁니다.
5. 선언한 `@types/x`는 `x`나 그 하위 경로를 위의 어느 방식으로든 쓰면 사용 중입니다. `@scope/name`은 `@types/scope__name`, Node 내장 모듈(`fs`든 `node:fs`든, `node:module`의 `builtinModules` 기준)과 `"types": ["node"]`는 `@types/node`, `bun`과 `bun:*`은 `@types/bun`으로 짝짓습니다. 이것만으로 misplaced나 type-only가 되지는 않습니다. `types`를 지정하지 않으면 TypeScript가 모든 `@types` 패키지를 읽지만, `x`를 쓰지 않는 `@types/x`는 그대로 보고합니다.
6. import 없이 쓰는 패키지를 셉니다. 이것으로 misplaced나 type-only가 되는 패키지는 없습니다.
   - **스크립트가 실행하는 바이너리.** 루트와 검사하는 각 레이아웃 루트의 `package.json` `scripts`, `.husky/`의 git 훅(확장자 없는 파일), lint-staged 명령을 따옴표 밖의 `&&`, `||`, `;`, `|`, `&`, 괄호, 백틱, 줄바꿈으로 나눠 명령마다 봅니다. 그래서 `echo "a; eslint"`는 `echo`만 실행합니다. 앞의 `NAME=value` 대입(`NODE_OPTIONS='--a --b'`도), 셸 키워드(`if`, `then`, `else`, `do`, `{` 등)와 실행기(`npx`, `npm exec`, `pnpm exec`, `pnpm dlx`, `yarn exec`, `yarn dlx`, `bunx`, `bun x`, `cross-env`, `env`, `dotenv … --`)는 건너뛰고, 그다음 낱말을 명령으로 봅니다. `npx`, `npm exec`, `pnpm dlx`, `yarn dlx`, `bunx`, `bun x` 뒤의 그 낱말은 `@버전`을 뗀 패키지 이름이기도 합니다(`npx @biomejs/biome`, `npx prettier@3`). `sh -c '…'`와 `bash -c '…'`는 따옴표 안의 스크립트를 실행합니다. `pnpm`, `yarn`, `bun`(`run`이 있든 없든) 뒤의 낱말이 같은 `package.json`의 스크립트 이름이면 바이너리가 아니라 그 스크립트이고, `npm run`과 `pnpm run`은 스크립트만 실행합니다. 명령은 설치된 `package.json`의 `bin`에 그 이름을 둔 선언 패키지를 사용합니다(문자열 `bin`은 스코프를 뺀 패키지 이름). 패키지는 Node처럼 프로젝트 루트와 그 위의 `node_modules`에서 찾습니다. 설치되지 않은 선언 패키지는 자기 이름, 그리고 스코프를 뺀 이름과 맞춥니다.
   - **peer.** 사용 중이고 설치된 의존성이 `peerDependencies`나 `peerDependenciesMeta`에 둔 선언 패키지는 optional이든 아니든 사용 중이며, 그 패키지가 둔 선언 peer도 이어서 사용 중입니다. 프로덕션 코드가 불러오는 패키지의 peer는 프로덕션에도 설치돼야 하므로 type-only로 보고하지 않습니다.
   - unused는 knip·depcheck처럼 설치된 것만 보고 가립니다. lockfile은 읽지 않습니다. 선언한 패키지가 있는데 프로젝트나 그 위의 `node_modules`에 설치된 것이 하나도 없으면 바이너리와 peer를 알 수 없으므로, unused를 가릴 실행(`--ignore`를 빼고 검사할 선언 패키지가 하나라도 있는 실행)은 프로젝트 디렉토리를 적은 오류 한 줄만 내고 리포트 없이 종료 코드 `2`로 끝납니다. 의존성을 먼저 설치하세요. `devDependencies`만 있는 프로젝트의 기본 실행처럼 unused를 검사할 것이 없으면 평소대로 돕니다.
   - **도구 설정.** 각 레이아웃 루트에서 아래 파일과 `package.json` 키를 도구마다의 짧은 이름 규칙으로 읽습니다(JSON·YAML은 데이터로, JS·TS는 실행하지 않고 객체 리터럴에서). `.eslintrc`처럼 확장자 없는 rc 파일은 주석을 허용하는 JSON으로 읽고, 안 되면 YAML로 읽습니다. JS·TS에서 인자가 하나인 호출은 그 인자로(`getAbsolutePath('@storybook/addon-a11y')`), 조건식은 그 식이 낼 수 있는 값 모두로 봅니다(`prod ? 'cssnano' : null`, `prod && 'cssnano'`). 파일 안의 객체를 모두 보므로 `overrides`나 중첩된 블록도 셉니다. 여기서 레이아웃 루트에는 `project.json`만 있는 Nx 프로젝트도 들어갑니다.
     - ESLint(`.eslintrc`, `.eslintrc.json`/`.yaml`/`.yml`/`.js`/`.cjs`, `eslintConfig`): `parser`, `plugins`(`react` → `eslint-plugin-react`, `@scope` → `@scope/eslint-plugin`, `@scope/x` → `@scope/eslint-plugin-x`), `extends`(`airbnb/hooks` → `eslint-config-airbnb`, `@scope` → `@scope/eslint-config`, `plugin:x/y` → 플러그인 `x`), `import/no-cycle` 같은 규칙의 플러그인, `settings["import/resolver"]`(`typescript` → `eslint-import-resolver-typescript`). flat `eslint.config.*`는 import로 읽습니다.
     - Babel(`.babelrc*`, `babel.config.*`, `babel`): `presets`와 `plugins`(`@babel/env` → `@babel/preset-env`, `macros` → `babel-plugin-macros`, `module:x` → `x`, `next/babel` → `next`).
     - PostCSS(`postcss.config.*`, `.postcssrc*`, `postcss`): `plugins`의 키와 항목.
     - Jest(`jest.config.*`, `jest`): `preset`, `testEnvironment`(`jsdom` → `jest-environment-jsdom`), `transform` 값, `setupFiles`, `setupFilesAfterEnv`, `snapshotSerializers`, `reporters`.
     - Prettier(`.prettierrc*`, `prettier.config.*`, `prettier`): `plugins`, 또는 설정 전체가 공유 설정 이름 문자열이면 그 패키지.
     - Stylelint(`.stylelintrc*`, `stylelint.config.*`, `stylelint`)와 commitlint(`.commitlintrc*`, `commitlint.config.*`, `commitlint`): `extends`와 `plugins`.
     - Storybook `.storybook/main.*`: `addons`, `framework`, `core.builder`. `serverless.yml`/`.ts`: `plugins`. Nx `project.json`과 `nx.json`: 각 `executor`(`@nx/jest:jest` → `@nx/jest`). lint-staged(`.lintstagedrc*`, `lint-staged.config.*`, `lint-staged`): 그 명령을 위 스크립트처럼 읽습니다. tsconfig: `compilerOptions.plugins[].name`.
     - 레이아웃 루트의 그 밖의 `*.config.*`·`*.preset.*` JS·TS 파일과 그 밖의 `.json`·`.jsonc`·`.yaml`·`.yml` 파일: `vite.config.ts`의 `minify: 'terser'`나 `.releaserc.json`의 플러그인처럼 패키지 이름과 정확히 같은 문자열. `package.json`, lockfile, `pnpm-workspace.yaml`, tsconfig는 이렇게 읽지 않습니다.
7. 두 집합의 차집합을 구해 네 가지 버킷을 만듭니다: **unused**, **unusedPeer** (`--check-peer` 시), **misplaced**, **typeOnly**. 어느 파일에서 import해도 사용으로 칩니다. **misplaced**와 **typeOnly**는 production 파일만 보므로, 시험이나 도구에서만 쓰는 `devDependency`는 misplaced로 나오지 않습니다.

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

`dependencies`에 있지만 타입으로만 import되는 패키지는 **Type-Only Imports**에 나오고 이슈로 셉니다 — `devDependencies`로 옮길 수 있기 때문입니다. 선언 파일을 배포하는 패키지(`types`나 `typings` 항목, 또는 `exports` 어딘가의 `types` 조건이 있는 것)는 이 검사를 하지 않습니다. 그 패키지를 쓰는 쪽에도 그 타입이 설치되어야 하기 때문입니다. 색은 stdout이 터미널이고 `NO_COLOR`가 비어 있을 때만 씁니다.

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

deps-finder는 정적 AST 스캔을 사용하므로 동적 패턴은 보이지 않습니다: `require(variable)`, `import(expr)`, `${}`가 든 템플릿 리터럴, `eval`, 번들러 플러그인이 만드는 가상 모듈, 위에 적은 도구·키 밖에서 설정 파일에 문자열로만 적힌 패키지 등이 그렇습니다. 러너 설정이 엉뚱한 자리를 시험으로 가리키는 경우(Playwright `testDir`, 스크립트로만 돌리는 `codegen.ts`, 시험에서만 import하는 `src/mocks/`)는 production으로 취급합니다. 도구는 과보고보다 누락 보고를 선호하지만, 그래도 오탐은 발생할 수 있습니다. 그럴 때는 `--ignore <pkg>`가 탈출구이며 — 이슈 리포트도 환영합니다.

import 없이 쓰는 패키지라도 위 방법으로 찾지 못하면 unused로 보고됩니다: 다른 CLI가 제공하는 하위 명령(`nuxt storybook`), `bitbucket-pipelines.yml` 같은 CI 파일에서 실행하는 바이너리, 위 도구 어디에도 속하지 않는 확장자 없는 설정 파일(`.swcrc`), 그리고 일부만 설치됐을 때 설치되지 않은 패키지의, 패키지와 이름이 다른 바이너리(`typescript`의 `tsc`)와 설치되지 않은 패키지의 peer가 그렇습니다. `--ignore`로 넘기세요.

`buffer`, `events` 같은 내장 모듈 이름을 접두사 없이 쓰면, 같은 이름으로 선언된 패키지(번들러가 쓰는 npm 폴리필)와 맞춰 봅니다. Node 내장 모듈을 뜻한다면 `node:buffer`처럼 쓰세요.

`createRequire`는 스코프가 아니라 이름으로 따라갑니다: 나중에 대입한 함수(`let r; r = createRequire(…)`)는 세지 않고, import한 `createRequire`를 가리는 매개변수는 셉니다.

들여쓰기 문법 Sass(`.sass`, `<style lang="sass">`)와 Stylus(`.styl`, `<style lang="stylus">`)는 읽지 않습니다. Sass나 Less의 `@import "name"`이 로컬 partial을 불러오더라도, `name`이라는 패키지가 선언돼 있으면 그 패키지 사용으로 셉니다. 컴포넌트 `<script>`·`<style>`의 `src` 속성(`<style src="pkg/theme.css">`)은 읽지 않습니다. `"outDir": "src"`처럼 분석할 소스가 든 디렉토리를 `outDir`로 잡으면 빌드 출력으로 보고 제외하므로, 그 안의 import는 세지 않습니다.

oxc 네이티브 파서는 중첩 한 단마다 재귀하므로 deps-finder는 스택 256 MB의 워커 스레드에서 돕니다. 그 스택보다 깊게 중첩된 소스는 여전히 프로세스를 죽이고(종료 코드 `132`나 `139`, 위 표 밖의 코드), 보고서는 나오지 않습니다. macOS arm64에서는 객체 리터럴 약 140,000단, 배열이나 괄호 약 160,000단, 타입 인자 약 180,000단을 넘으면 그렇습니다. 이런 파일은 대개 생성물이니 `--exclude`로 빼세요.

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
