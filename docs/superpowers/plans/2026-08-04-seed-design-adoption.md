# SEED 디자인 시스템 도입 — 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 하루치의 9개 화면을 SEED 토큰·레시피 위에 다시 세우고, 없던 오버레이(토스트·확인 다이얼로그)를 추가한다. 인쇄물은 한 픽셀도 바뀌지 않는다.

**Architecture:** `@seed-design/css`의 `.layered.css` 판을 `dependencies`로 들여와 우리 CSS가 레이어 밖에서 항상 이기게 한다. 색은 SEED 역할 어휘(`brand`/`positive`/`warning`/`critical`/`neutral`)로 다시 표현하고, 폭·간격은 md·lg 슬롯을 채워 아이패드 전 해상도를 덮는다. 오버레이는 TDS의 명령형 API 사상을 따라 `ui.ts`에 함수로 둔다.

**Tech Stack:** 바닐라 DOM + TypeScript + Vite. `@seed-design/css@^2.3.0`(Apache-2.0, 의존성 0, 순수 CSS). 프레임워크·런타임 JS 의존성 없음.

**설계 문서:** `docs/superpowers/specs/2026-08-04-seed-design-adoption-design.md` — 모든 판단의 근거가 여기 있다. 태스크가 "왜"를 묻게 되면 스펙을 본다.

## Global Constraints

- **작업은 브랜치 `seed-design`에서 한다.** main에 직접 커밋하지 않는다. 브랜치 push는 배포를 유발하지 않으므로 백업 목적의 push는 안전하다.
- **`print.css`와 종이 마크업은 대상이 아니다.** `print-sheet.ts`에서 바꿔도 되는 클래스는 `.step`·`.banner`·`.no-print` 셋뿐. 종이 클래스(`.sheet*`·`.v*`·`.inv*`·`.strat*`·`.word*`·`.n`)는 한 글자도 건드리지 않는다.
- **기존 CSS 값은 근거가 아니다.** 지금 값들은 설계된 것이 아니라 그때그때 고른 것이다(스펙 §0). SEED 정책과 충돌하면 SEED가 이긴다. "지금 26px이니까 유지한다"는 무효, "SEED 스케일에서 이 자리는 t10이다"만 유효.
- **단, SEED 정책을 따른다는 것은 토큰 스케일 안에서 고른다는 뜻이지 컴포넌트 기본값을 무조건 쓴다는 뜻이 아니다.** 8살이 쓰는 자리(키패드)는 같은 `--seed-dimension-*` 스케일에서 더 큰 칸을 고른다.
- **아이 화면은 부모 화면으로 링크하지 않는다.** 아이(`#/`·`#/sprint`·`#/map`·`#/ebs`) · 부모(`#/parent`·`#/print`·`#/grade`·`#/report`). 새로 만드는 오버레이의 액션 버튼도 이 규칙에 걸린다.
- **`escapeHtml`을 거치지 않은 값이 `el()` 템플릿에 들어가면 XSS다.** 템플릿을 다시 쓰는 태스크마다 이스케이프를 재확인한다.
- **파생값을 저장하지 않는다.** `Meta.derived`는 아무도 채우지 않는다. 이 작업은 로직을 건드리지 않지만, 화면을 고치다 상태를 저장하고 싶어지면 멈춘다.
- **매 태스크의 검증 사이클**(이 레포는 DOM·화면 테스트를 금지하므로 단위 테스트가 이 작업을 지켜주지 않는다):
  1. `export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH"`
  2. `npx prettier --check .` — 통과
  3. `npm test` — **17파일 283개 통과**(이 작업으로 숫자가 변하면 안 된다. 변했다면 엔진을 건드린 것이다)
  4. `npm run build` — 통과
  5. 브라우저 실물 확인 — 태스크마다 확인 항목이 명시돼 있다
  6. `git add <명시 경로>` 후 커밋. **`git add .`을 쓰지 않는다**
- **버전 값 고정:** `@seed-design/css` `^2.3.0`. 브레이크포인트 `base 0 / sm 480 / md 768 / lg 1280 / xl 1440`. 타이포 t1~t14 = `11 12 13 14 16 18 20 22 24 26 28 32 40 48px`. 간격 `x1`=4 `x2`=8 `x3`=12 `x4`=16 `x5`=20 `x6`=24 `x7`=28 `x8`=32 `x9`=36 `x10`=40 `x12`=48 `x13`=52 `x14`=56 `x16`=64px(x11·x15는 없다). radius `r1`=4 `r2`=8 `r3`=12 `r4`=16 `r5`=20 `r6`=24 `full`=9999px.

---

## File Structure

**신규**

- 없음. 오버레이는 `src/ui.ts`에 들어간다 — 두 화면 이상이 공유하는 것의 자리이고(CLAUDE.md), `showError`가 이미 거기 있어 형제 함수가 된다.

**수정**

| 파일                                                        | 책임                                                  | 태스크   |
| ----------------------------------------------------------- | ----------------------------------------------------- | -------- |
| `package.json`                                              | `dependencies`에 `@seed-design/css`                   | 1        |
| `src/styles/app.css`                                        | SEED import·토큰 매핑·반응형 슬롯·화면 스타일         | 1,2,5~10 |
| `src/styles/kid.css`                                        | 색 변수 제거, 아이 화면 전용 레이아웃만 남김          | 5        |
| `src/styles/print.css`                                      | 누수 차단 2곳 **(종이 규칙 자체는 불변)**             | 1,2      |
| `src/ui.ts`                                                 | `toast`·`confirmDialog` 추가, `showError` 껍데기 교체 | 2,3,4    |
| `src/screens/*.ts`                                          | 마크업을 SEED 레시피 클래스로                         | 5~10     |
| `docs/superpowers/HANDOFF.md`                               | 색 격리 규칙 갱신                                     | 12       |
| `docs/superpowers/specs/2026-08-04-role-based-ui-design.md` | 같음                                                  | 12       |
| `CLAUDE.md`                                                 | "런타임 의존성 0개" 서술 정정                         | 12       |

---

### Task 0: 브랜치와 인쇄 기준 스냅샷

**이 태스크가 먼저인 이유:** 인쇄 회귀 검증은 **작업 전 스냅샷**이 있어야 성립한다. 브랜치를 만든 뒤에 뜨면 이미 늦다.

**Files:**

- Create: `/private/tmp/.../scratchpad/print-before.html` (레포 밖 — 커밋하지 않는다)

**Interfaces:**

- Produces: `print-before.html` — Task 11이 비교 대상으로 쓴다

- [ ] **Step 1: main이 깨끗한지 확인**

```bash
cd /Users/iseongho/workspace/haruchi
git status --short          # docs 외 변경이 없어야 한다
git log --oneline -1
```

- [ ] **Step 2: dev 서버를 띄운다**

```bash
export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH"
npm run dev
```

`http://localhost:5173/haruchi/` 에서 뜬다. 루트는 302다.

- [ ] **Step 3: 인쇄 화면을 열어 종이 마크업을 저장한다**

브라우저로 `http://localhost:5173/haruchi/#/print` 를 연 뒤 아래를 실행한다:

```js
Array.from(document.querySelectorAll('.sheet'))
  .map((el) => el.outerHTML)
  .join('\n<!-- SHEET BREAK -->\n')
```

결과를 스크래치패드의 `print-before.html`로 저장한다.

**주의:** `sheet`가 비어 있는 날이면(스프린트만 한 날) 비교가 무의미하다. `.sheet`가 0개면 홈에서 오늘 문제지를 먼저 만들고 다시 뜬다. 몇 개를 떴는지 기록해 둔다 — Task 11이 같은 개수를 기대한다.

- [ ] **Step 4: 브랜치를 만든다**

```bash
git switch -c seed-design
git status --short
```

- [ ] **Step 5: 커밋할 것이 없음을 확인한다**

이 태스크는 레포에 아무것도 남기지 않는다. `print-before.html`은 스크래치패드에 있고 커밋 대상이 아니다.

---

### Task 1: SEED 설치 · 토큰 매핑 · 반응형 기반

**한 태스크인 이유:** 셋이 하나의 되돌리기 단위다. 토큰만 넣고 반응형을 안 채우면 아이패드에서 gutter가 모바일 값으로 앉아 SEED 권고 위반 상태가 된다.

**Files:**

- Modify: `package.json`
- Modify: `src/styles/app.css` (최상단 + `:root` + `#app`)
- Modify: `src/styles/print.css:129`

**Interfaces:**

- Produces: `--seed-*` 토큰 전역, `--fg`/`--muted`/`--line`이 SEED를 가리킴. Task 2~10이 전부 이것에 기댄다.

- [ ] **Step 1: 패키지를 설치한다**

```bash
export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH"
cd /Users/iseongho/workspace/haruchi
npm install @seed-design/css
```

`package.json`에 `dependencies` 키가 새로 생기고 `"@seed-design/css": "^2.3.0"`이 들어간다. devDependencies로 가지 않게 확인한다(`-D` 없이 설치).

- [ ] **Step 2: `app.css` 최상단에 SEED를 붙인다**

`src/styles/app.css`의 **맨 첫 줄부터** 넣는다. `@layer` 선언은 `@import`보다 앞에 와도 되는 유일한 규칙이라 이 순서가 맞다:

```css
/* SEED 디자인 시스템(당근, Apache-2.0). layered 판을 쓰는 이유는 설계 §2 —
 * 레이어에 든 CSS는 레이어 밖 우리 CSS에게 특정도와 무관하게 진다.
 * 덕분에 아래 우리 규칙들이 !important 없이 항상 이기고, 나중에 브랜드 색을
 * 갈아끼울 때도 :root 한 블록이면 끝난다. */
@layer seed-base, seed-components;
@import '@seed-design/css/base.layered.css';
```

- [ ] **Step 3: `:root`의 색 세 개를 SEED 토큰으로 돌린다**

`src/styles/app.css`의 기존 `:root` 블록을 이렇게 바꾼다:

```css
:root {
  /* 값을 직접 쓰지 않고 SEED 역할 토큰을 가리킨다. 화면 코드는 계속
   * var(--fg)를 쓰므로 이 세 줄이 앱 전체의 색을 바꾼다.
   * --muted가 fg-neutral-subtle(#868b94, 대비 3.42)이 아니라
   * fg-neutral-muted(#555d6d, 대비 6.62)인 이유: 이 색이 13~15px 본문에
   * 쓰이는데 subtle은 WCAG AA(4.5)를 못 넘는다. 옛 #777도 4.48로 실패였다. */
  --fg: var(--seed-color-fg-neutral);
  --muted: var(--seed-color-fg-neutral-muted);
  --line: var(--seed-color-stroke-neutral-weak);
  font-family: -apple-system, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif;
}
```

`body`의 `background: #fafafa`를 `var(--seed-color-bg-layer-basement)`로 바꾼다.

- [ ] **Step 4: `#app`에 반응형 폭과 gutter를 넣는다**

```css
/*
 * 하루치는 base·sm 구간에서 돈 적이 없다 — iPad 10.9"(세로 820·가로 1180),
 * Pro 12.9"(1024·1366), Pro 13" M4(1032·1376) 전부 md 아니면 lg다.
 * lg가 최상위이고 xl(1440)에 닿는 아이패드는 없어서 xl 슬롯은 두지 않는다.
 * gutter 기본값 x4(16px)는 SEED의 '모바일' 값이라 md 이상에 그대로 쓰면
 * 오히려 권고 위반이다(레이아웃 문서: md 이상 24px). 설계 §8.1.
 */
#app {
  max-width: 560px;
  margin: 0 auto;
  padding: var(--seed-dimension-x6) var(--seed-dimension-x4) var(--seed-dimension-x14);
}
@media (width >= 768px) {
  #app {
    max-width: 720px;
    padding-left: var(--seed-dimension-x6);
    padding-right: var(--seed-dimension-x6);
  }
}
@media (width >= 1280px) {
  #app {
    max-width: 840px;
  }
}
```

- [ ] **Step 5: 인쇄 누수 ①을 막는다**

`src/styles/print.css`의 `.strat-zone` 규칙에서 화면 변수 참조를 끊는다:

```css
/* 종이는 화면 토큰을 따라가지 않는다. var(--fg)를 두면 app.css가 --fg를
 * SEED 토큰으로 돌리는 순간 인쇄물의 테두리 색이 함께 바뀐다.
 * fallback이 원래 #000이었으므로 의도는 검정이었다. */
.strat-zone {
  border: 2px solid #000;
}
```

`print.css` 전체에서 `var(--fg`·`var(--muted`·`var(--line`을 다시 검색해 **0건**임을 확인한다:

```bash
grep -n 'var(--fg\|var(--muted\|var(--line' src/styles/print.css
```

- [ ] **Step 6: 검증 사이클을 돌린다**

```bash
export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH"
npx prettier --check . && npm test && npm run build
```

기대: prettier 통과 · **17파일 283개 통과** · build 통과.

- [ ] **Step 7: 브라우저로 확인한다**

`#/`, `#/parent`, `#/grade`를 연다. 확인 항목:

- 색이 전체적으로 아주 살짝 바뀌었지만 레이아웃이 무너진 곳이 없다
- 보조 텍스트(날짜·정답 표시)가 전보다 **진해졌다** (`#777` → `#555d6d`)
- 창 폭을 820 → 1024 → 1376px로 늘리며 `#app`이 **560 → 720 → 840**으로 커진다
- `#/print`를 열어 **종이 미리보기가 눈으로 봐서 이전과 같다**

- [ ] **Step 8: 커밋**

```bash
git add package.json package-lock.json src/styles/app.css src/styles/print.css
git commit -m "feat: SEED 토큰 도입과 반응형 기반 — 화면 코드는 그대로

@seed-design/css(Apache-2.0, 의존성 0, 순수 CSS)를 layered 판으로 들여온다.
--fg/--muted/--line이 SEED 역할 토큰을 가리키게 되어 세 줄이 앱 전체 색을 바꾼다.
--muted 매핑은 접근성 결함도 함께 고친다 — 옛 #777은 대비 4.48로 AA 미달이었다.

#app을 560/720/840으로, gutter를 16/24px로 채워 아이패드 md·lg를 덮는다.
print.css의 var(--fg) 참조를 #000으로 끊어 종이를 화면 변경에서 격리한다."
```

---

### Task 2: 오버레이 기반 — `.overlay` 공통 클래스와 인쇄 격리

**이 태스크가 오버레이 셋보다 먼저인 이유:** 인쇄 숨김을 **구조로** 만들어 두면, 이후 토스트·다이얼로그가 추가될 때 목록에 넣는 것을 기억할 필요가 없다. 반대로 하면 잊는 순간 아이 문제지에 찍힌다(주석이 증언하는 기존 사고).

**Files:**

- Modify: `src/ui.ts` (`showError`)
- Modify: `src/styles/app.css` (`.error*` 삭제, 레시피 import)
- Modify: `src/styles/print.css` (`@media print` 숨김 목록)

**Interfaces:**

- Produces: 모든 오버레이가 다는 공통 클래스 `.overlay`. Task 3·4가 이것을 붙인다.
- Consumes: Task 1의 SEED 토큰.

- [ ] **Step 1: callout 레시피를 import한다**

`src/styles/app.css`의 `@import` 줄 아래에 추가한다:

```css
@import '@seed-design/css/recipes/callout.layered.css';
```

- [ ] **Step 2: `showError`가 callout 클래스와 `.overlay`를 쓰게 한다**

`src/ui.ts`의 `showError`를 바꾼다. **의미는 그대로다** — 자동으로 사라지지 않고, 호출부 13곳은 건드리지 않는다:

```ts
export function showError(message: string): void {
  let bar = document.querySelector<HTMLDivElement>('#error-bar')
  if (!bar) {
    bar = document.createElement('div')
    bar.id = 'error-bar'
    // .overlay는 인쇄에서 숨겨지는 유일한 표식이다(print.css의 @media print).
    // 새 오버레이를 만들 때마다 이 클래스를 붙이면 종이 오염이 구조로 막힌다.
    bar.className = 'overlay seed-callout__root seed-callout__root--tone_critical'
    bar.setAttribute('role', 'alert')

    const text = document.createElement('span')
    text.className = 'error-text seed-callout__description'
    bar.append(text)

    const dismiss = document.createElement('button')
    dismiss.className = 'error-dismiss seed-callout__closeButton'
    dismiss.textContent = '✕'
    dismiss.setAttribute('aria-label', '오류 알림 닫기')
    dismiss.addEventListener('click', clearError)
    bar.append(dismiss)

    document.body.prepend(bar)
  }
  bar.querySelector('.error-text')!.textContent = message
}
```

`clearError`와 주석은 그대로 둔다.

- [ ] **Step 3: `.update` 배너에도 `.overlay`를 붙인다**

`.update`를 만드는 곳(`src/main.ts`에서 PWA 업데이트를 다루는 자리)을 찾아 `className`에 `overlay`를 추가한다:

```bash
grep -rn "'update'\|\"update\"\|className = 'update" src/main.ts src/ui.ts
```

찾은 지점의 클래스 문자열을 `'overlay update'`로 바꾼다.

- [ ] **Step 4: 인쇄 숨김 목록을 `.overlay` 하나로 줄인다**

`src/styles/print.css`의 `@media print` 블록에서:

```css
/*
   * 화면 전용 오버레이는 전부 종이에서 뺀다. 목록을 나열하면 새 오버레이가
   * 추가될 때마다 여기에 넣는 것을 기억해야 하고, 잊으면 아이 문제지 위에
   * 띠가 찍힌다(에러 배너·업데이트 배너에서 실제로 겪은 사고).
   * .overlay 하나로 줄여 다음 오버레이가 자동으로 안전해지게 한다.
   */
.no-print,
.overlay {
  display: none !important;
}
```

`#error-bar`·`.update` 나열은 지운다 — 둘 다 이제 `.overlay`를 갖는다.

- [ ] **Step 5: `app.css`의 낡은 `.error*` 규칙을 정리한다**

`.error`·`.error-text`·`.error-dismiss`에서 **색·배경·패딩은 지운다**(callout이 준다). 위치만 남긴다:

```css
/* callout이 색·여백·타이포를 전부 준다. 여기 남는 것은 '화면 맨 위에 고정'
 * 이라는 배치뿐이다 — 그건 SEED가 정해줄 수 없는 이 앱의 결정이다. */
.error-text {
  flex: 1;
}
```

- [ ] **Step 6: 검증 사이클**

```bash
export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH"
npx prettier --check . && npm test && npm run build
```

- [ ] **Step 7: 브라우저로 확인한다**

에러 배너를 강제로 띄워 본다 — `#/report`에서 JSON이 아닌 파일을 골라 "JSON 파일이 아니에요" 배너를 낸다. 확인 항목:

- 배너가 뜨고, 빨간 계열이고, ✕로 닫힌다
- `#/print`에서 브라우저 인쇄 미리보기(⌘P)를 열어 **배너가 종이에 없다**

- [ ] **Step 8: 커밋**

```bash
git add src/ui.ts src/styles/app.css src/styles/print.css src/main.ts
git commit -m "feat: 오버레이 공통 클래스 .overlay — 종이 오염을 구조로 막는다

인쇄 숨김 목록을 나열에서 .overlay 하나로 줄인다. 새 오버레이가 추가될 때
목록에 넣는 것을 기억할 필요가 없어진다 — 잊으면 아이 문제지에 띠가 찍히는
사고가 이미 한 번 있었다.

showError는 의미 그대로 두고 껍데기만 SEED callout(tone: critical)으로 바꾼다.
자동으로 사라지지 않는 성질이 의도된 설계라 토스트로 흡수하지 않는다."
```

---

### Task 3: `toast()`

**Files:**

- Modify: `src/ui.ts`
- Modify: `src/styles/app.css`

**Interfaces:**

- Consumes: Task 2의 `.overlay` 규약.
- Produces: `toast(message: string, opts?: { tone?: 'neutral' | 'positive' }): void` — Task 8이 쓴다.

- [ ] **Step 1: snackbar 레시피를 import한다**

`src/styles/app.css`:

```css
@import '@seed-design/css/recipes/snackbar.layered.css';
@import '@seed-design/css/recipes/snackbar-region.layered.css';
```

- [ ] **Step 2: region에 위치를 준다**

`snackbar-region` 레시피는 `left`·`right`·`bottom`·`z-index`를 주지만 **`position`은 주지 않는다**(React판이 따로 붙인다). 우리가 준다:

```css
/* 레시피가 bottom을 calc(safe-area + var(--snackbar-region-offset, 0px))로
 * 두고 transition까지 걸어 놨다. 아래 한 줄로 '토스트가 하단 고정 배너를
 * 피한다'가 공짜로 된다 — 업데이트 배너가 뜨고 질 때 부드럽게 따라 움직인다. */
.seed-snackbar-region {
  position: fixed;
}
body:has(.update) {
  --snackbar-region-offset: 68px;
}
```

- [ ] **Step 3: `toast()`를 구현한다**

`src/ui.ts`의 `clearError` 아래에 넣는다:

```ts
/**
 * 사라지는 성공 피드백. `showError`와 짝이지만 같은 것의 변종이 아니다 —
 * 실패는 남아야 하고(부모가 놓치면 데이터가 조용히 어긋난다) 성공은 사라져도 된다.
 * 그래서 여기에는 critical 톤이 없다. 실패는 전부 showError로 간다.
 *
 * 명령형인 이유: 선언형은 상태를 둘 자리가 필요한데 바닐라 DOM에는 그 자리가 없다.
 * 화면은 #app을 replaceChildren으로 갈아 끼우므로 상태를 들고 있을 수 없다.
 */
export function toast(message: string, opts: { tone?: 'neutral' | 'positive' } = {}): void {
  let region = document.querySelector<HTMLDivElement>('#toast-region')
  if (!region) {
    region = document.createElement('div')
    region.id = 'toast-region'
    region.className = 'overlay seed-snackbar-region'
    document.body.append(region)
  }

  // SEED snackbar의 variant는 default|positive|critical이다. 우리 tone
  // 'neutral'이 SEED의 'default'에 해당한다.
  const variant = opts.tone === 'positive' ? 'positive' : 'default'

  const bar = document.createElement('div')
  bar.className = `seed-snackbar__root seed-snackbar__root--variant_${variant}`
  bar.setAttribute('role', 'status')

  const message_ = document.createElement('span')
  message_.className = 'seed-snackbar__message'
  message_.textContent = message
  bar.append(message_)

  region.append(bar)
  setTimeout(() => {
    bar.remove()
    if (region!.childElementCount === 0) region!.remove()
  }, 3000)
}
```

**`textContent`를 쓰는 이유:** `el()`의 `innerHTML` 경로를 타지 않으므로 이스케이프가 필요 없다. 문자열을 템플릿에 끼워 넣고 싶어지면 `escapeHtml`을 거친다.

- [ ] **Step 4: 검증 사이클**

```bash
export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH"
npx prettier --check . && npm test && npm run build
```

- [ ] **Step 5: 브라우저로 확인한다**

콘솔에서 직접 부른다:

```js
// 화면 모듈이 동적 import되므로 전역에 없다. 확인용으로만 임시 노출한다.
import('/src/ui.ts').then((m) => {
  m.toast('저장했어요', { tone: 'positive' })
})
```

확인 항목:

- 하단 가운데에 뜨고 **3초 뒤 사라진다**
- 사라진 뒤 `#toast-region`이 DOM에서 제거된다
- `#/print`에서 토스트를 띄운 채 ⌘P — **종이에 없다**

- [ ] **Step 6: 커밋**

```bash
git add src/ui.ts src/styles/app.css
git commit -m "feat: toast() — 앱에 없던 성공 피드백 채널

지금까지 실패만 말하고 성공은 침묵했다. 채점을 저장해도 내보내기를 해도
아무 반응이 없었다.

레이아웃 협응은 SEED가 이미 갖고 있었다 — snackbar-region의
--snackbar-region-offset 한 줄로 토스트가 업데이트 배너를 피한다."
```

---

### Task 4: `confirmDialog()`

**Files:**

- Modify: `src/ui.ts`
- Modify: `src/styles/app.css`

**Interfaces:**

- Consumes: Task 2의 `.overlay` 규약.
- Produces: `confirmDialog(opts): Promise<boolean>` — Task 8이 `report.ts`에서 쓴다.

- [ ] **Step 1: dialog 레시피를 import하고 z-index를 올린다**

`src/styles/app.css`:

```css
@import '@seed-design/css/recipes/dialog.layered.css';
```

```css
/* dialog 레시피의 --dialog-z-index 기본값이 2인데 이 앱의 업데이트 배너가
 * z-index: 10이다. 그대로 두면 확인 다이얼로그가 배너 뒤로 숨는다. */
.seed-dialog__backdrop,
.seed-dialog__positioner {
  --dialog-z-index: 100;
}
```

- [ ] **Step 2: `confirmDialog()`를 구현한다**

`src/ui.ts`의 `toast` 아래에 넣는다:

```ts
/**
 * 확인 다이얼로그. Promise<boolean>을 돌려주므로 호출부가 흐름을 끊지 않고 쓴다.
 *
 * Promise가 한 번만 resolve되는 성질이 이중 클릭 가드를 겸한다 — 손으로 만든
 * 확인 패널(#confirm-replace)에 그 가드가 없어 인수인계에 이월돼 있었다.
 * 되돌릴 수 없는 전체 교체를 두 번 태우는 사고를 여기서 구조로 막는다.
 */
export function confirmDialog(opts: {
  title: string
  description?: string
  confirmLabel: string
  cancelLabel?: string
  tone?: 'neutral' | 'critical'
}): Promise<boolean> {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div')
    backdrop.className = 'overlay seed-dialog__backdrop'
    backdrop.setAttribute('data-state', 'open')

    const positioner = document.createElement('div')
    positioner.className = 'overlay seed-dialog__positioner'
    positioner.setAttribute('data-state', 'open')

    const content = document.createElement('div')
    content.className = 'seed-dialog__content'
    content.setAttribute('data-state', 'open')
    content.setAttribute('role', 'alertdialog')
    content.setAttribute('aria-modal', 'true')

    const header = document.createElement('div')
    header.className = 'seed-dialog__header'
    const title = document.createElement('h2')
    title.className = 'seed-dialog__title'
    title.textContent = opts.title
    header.append(title)
    if (opts.description) {
      const desc = document.createElement('p')
      desc.className = 'seed-dialog__description'
      desc.textContent = opts.description
      header.append(desc)
    }
    content.append(header)

    const footer = document.createElement('div')
    footer.className = 'seed-dialog__footer'

    const cancel = document.createElement('button')
    cancel.className = 'seed-action-button seed-action-button--variant_neutralWeak'
    cancel.textContent = opts.cancelLabel ?? '취소'

    const confirm = document.createElement('button')
    const variant = opts.tone === 'critical' ? 'criticalSolid' : 'brandSolid'
    confirm.className = `seed-action-button seed-action-button--variant_${variant}`
    confirm.textContent = opts.confirmLabel

    footer.append(cancel, confirm)
    content.append(footer)
    positioner.append(content)
    document.body.append(backdrop, positioner)

    // settle을 거치므로 어느 경로로 닫히든 정확히 한 번만 resolve된다.
    let settled = false
    const settle = (result: boolean) => {
      if (settled) return
      settled = true
      backdrop.remove()
      positioner.remove()
      document.removeEventListener('keydown', onKey)
      resolve(result)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') settle(false)
    }

    cancel.addEventListener('click', () => settle(false))
    confirm.addEventListener('click', () => settle(true))
    backdrop.addEventListener('click', () => settle(false))
    document.addEventListener('keydown', onKey)

    confirm.focus()
  })
}
```

- [ ] **Step 3: action-button 레시피를 import한다**

다이얼로그 버튼이 쓴다. `src/styles/app.css`:

```css
@import '@seed-design/css/recipes/action-button.layered.css';
```

- [ ] **Step 4: 검증 사이클**

```bash
export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH"
npx prettier --check . && npm test && npm run build
```

- [ ] **Step 5: 브라우저로 확인한다**

```js
import('/src/ui.ts').then(async (m) => {
  console.log(
    await m.confirmDialog({
      title: '현재 기록을 지우고 복구할까요?',
      description: '되돌릴 수 없어요.',
      confirmLabel: '복구',
      tone: 'critical',
    }),
  )
})
```

확인 항목:

- 배경이 어두워지고 가운데 뜬다
- **확인 `true` / 취소 `false` / 배경 클릭 `false` / Esc `false`** 네 경로 모두 정확히 한 번 resolve된다
- 확인 버튼을 **연타해도 `true`가 한 번만 찍힌다**
- 업데이트 배너가 떠 있어도 다이얼로그가 **위에** 있다

- [ ] **Step 6: 커밋**

```bash
git add src/ui.ts src/styles/app.css
git commit -m "feat: confirmDialog() — Promise가 이중 클릭 가드를 겸한다

손으로 만든 확인 패널(#confirm-replace)에 이중 클릭 가드가 없어 인수인계에
이월돼 있었다. Promise가 한 번만 resolve되는 성질이 그 가드다.

dialog 레시피의 z-index 기본값이 2라 업데이트 배너(10) 뒤로 숨는 것을
100으로 올려 막는다."
```

---

### Task 5: 부모 홈 · 아이 홈

**Files:**

- Modify: `src/screens/home-parent.ts`
- Modify: `src/screens/home-child.ts`
- Modify: `src/styles/app.css` (`.step`·`.banner`·`.links`)
- Modify: `src/styles/kid.css` (색 변수 제거)

**Interfaces:**

- Consumes: Task 1의 토큰, Task 4의 `action-button` import.

- [ ] **Step 1: list-item·callout 레시피 import를 확인한다**

`callout`은 Task 2에서 이미 들어왔다. `list-item`을 추가한다:

```css
@import '@seed-design/css/recipes/list-item.layered.css';
```

- [ ] **Step 2: `.step`을 SEED 위에 다시 쓴다**

`app.css`의 `.step` 블록에서 색·테두리·radius·글자를 지우고 SEED 토큰으로 다시 쓴다:

```css
/* 홈의 큰 카드. list-item 레시피가 배치와 상태를 주고, 여기서는 이 앱에만
 * 있는 것(전체 폭 버튼, 세로 리듬)만 얹는다. */
.step {
  display: block;
  width: 100%;
  text-align: left;
  background: var(--seed-color-bg-layer-default);
  border: 1.5px solid var(--seed-color-stroke-neutral-weak);
  border-radius: var(--seed-radius-r3);
  padding: var(--seed-dimension-x5) var(--seed-dimension-x5);
  margin-bottom: var(--seed-dimension-x3);
  font-size: var(--seed-font-size-t6);
  line-height: var(--seed-line-height-t6);
  font-weight: 700;
  color: var(--fg);
  cursor: pointer;
}
.step small {
  display: block;
  font-weight: 400;
  font-size: var(--seed-font-size-t3);
  line-height: var(--seed-line-height-t3);
  color: var(--muted);
  margin-top: var(--seed-dimension-x1);
}
.step.done {
  border-color: var(--seed-color-stroke-neutral-weak);
  color: var(--muted);
}
```

- [ ] **Step 3: `.banner`를 callout(warning)으로 바꾼다**

미채점 알림은 "주의가 필요한 안내"다 — SEED 역할 어휘로 `warning`이다(설계 §5). `home-parent.ts`에서 배너를 만드는 자리의 클래스를 바꾼다:

```ts
// class="banner" → class="banner seed-callout__root seed-callout__root--tone_warning"
```

`app.css`의 `.banner`에서 `background: var(--fg)`·`color: #fff`를 **지운다**(callout이 준다). 남기는 것은 `margin-bottom`과 `cursor: pointer`뿐이다.

- [ ] **Step 4: `.links`를 ghost 버튼으로 바꾼다**

```css
.links button {
  background: none;
  border: none;
  padding: var(--seed-dimension-x1) 0;
  font: inherit;
  font-size: var(--seed-font-size-t4);
  color: var(--muted);
  text-decoration: underline;
  cursor: pointer;
}
```

- [ ] **Step 5: `kid.css`에서 색 변수 둘을 없앤다**

`:root { --kid-accent; --kid-done; }` 블록을 **통째로 삭제**하고, 쓰던 자리를 역할 토큰으로 바꾼다. 파일 상단 주석도 갱신한다:

```css
/* 아이 홈 전용 레이아웃(설계 2026-08-04-role-based-ui §6).
 *
 * 색은 이제 전부 SEED 역할 토큰에서 온다 — 옛 --kid-accent/--kid-done은
 * 없앴다. 이 파일에 남는 것은 아이 화면에만 있는 '크기와 배치'뿐이다:
 * 화면에서 가장 큰 카드 하나, 2열 그리드.
 */
.kid-main {
  display: block;
  width: 100%;
  border: none;
  border-radius: var(--seed-radius-r5);
  background: var(--seed-color-bg-brand-solid);
  color: var(--seed-color-fg-neutral-inverted);
  padding: var(--seed-dimension-x10) var(--seed-dimension-x6);
  font-size: var(--seed-font-size-t10);
  line-height: var(--seed-line-height-t10);
  font-weight: 800;
  text-align: center;
  cursor: pointer;
}
/* 완료는 비활성이 아니라 성취다 — 회색으로 죽이지 않고 positive로 바꾼다. */
.kid-main.done {
  background: var(--seed-color-bg-positive-solid);
}
```

`.kid-streak`·`.kid-row`·`.kid-card`·`.kid-parent`의 px 값도 토큰으로 바꾼다(`22px`→`t8`, `16px`→`t5`, `13px`→`t3`, `gap: 12px`→`x3`, `border-radius: 16px`→`r4`).

**주의:** `--seed-color-bg-positive-solid`가 실재하는지 먼저 확인한다:

```bash
grep -o '\--seed-color-bg-positive-solid' node_modules/@seed-design/css/base.css | head -1
```

없으면 `--seed-color-fg-positive`를 배경으로 쓰지 말고, 있는 토큰 이름을 `grep '\--seed-color-bg-positive' node_modules/@seed-design/css/base.css | sort -u`로 찾아 쓴다.

- [ ] **Step 6: 검증 사이클**

```bash
export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH"
npx prettier --check . && npm test && npm run build
```

- [ ] **Step 7: 브라우저로 확인한다**

`#/`와 `#/parent`. 확인 항목:

- 아이 홈의 큰 카드가 주황이고, 오늘 할 일을 끝내면 초록으로 바뀐다
- 부모 홈의 미채점 배너가 **검정이 아니라 노랑 계열**이다
- **두 홈의 버튼이 각각 맞는 화면으로 간다** — 아이 홈은 스프린트·지도·EBS, 부모 홈은 인쇄·채점·리포트
- 820·1024·1376px에서 레이아웃이 무너지지 않는다

- [ ] **Step 8: 커밋**

```bash
git add src/screens/home-parent.ts src/screens/home-child.ts src/styles/app.css src/styles/kid.css
git commit -m "feat: 두 홈을 SEED 역할 어휘로 — 미채점 알림은 warning이다

--fg 검정 하나가 알림·완료·강조를 겸하던 것을 역할로 가른다.
kid.css의 색 변수 둘(--kid-accent/--kid-done)을 없앴다 — 색이 전부 SEED에서
오므로 이 파일에는 아이 화면 전용 크기와 배치만 남는다."
```

---

### Task 6: 채점 화면

**Files:**

- Modify: `src/screens/grade.ts`
- Modify: `src/styles/app.css` (`.grade-row`·`.mark`·`.moods`)

**Interfaces:**

- Consumes: Task 1 토큰, Task 4 `action-button` import.

- [ ] **Step 1: segmented-control 레시피를 import한다**

```css
@import '@seed-design/css/recipes/segmented-control.layered.css';
```

- [ ] **Step 2: `.grade-row`에 560px 캡을 신설한다**

**이 캡이 이 태스크의 핵심이다.** `#app`이 md에서 720, lg에서 840이 되는데 `.grade-row`는 `flex`라 그대로 늘어나면 문제 텍스트와 O/X 버튼 사이가 700px 가까이 벌어진다. 부모가 14문항을 연달아 누르는 화면이라 그 거리가 그대로 피로가 된다.

```css
/* #app이 md·lg에서 720·840으로 넓어지지만 이 행만은 따라가지 않는다.
 * flex라 넓어지면 문제 텍스트와 O/X 버튼이 멀어지고, 14문항을 연달아
 * 누르는 화면이라 그 거리가 그대로 피로가 된다(Fitts).
 * 넓히면 나빠지는 유일한 자리다 — 설계 §8.1. */
.grade-row {
  display: flex;
  align-items: center;
  gap: var(--seed-dimension-x3);
  max-width: 560px;
  padding: var(--seed-dimension-x3) var(--seed-dimension-x3);
  background: var(--seed-color-bg-layer-default);
  border: 1px solid var(--seed-color-stroke-neutral-weak);
  border-radius: var(--seed-radius-r2);
  margin-bottom: var(--seed-dimension-x2);
}
.grade-row .qnum {
  flex: none;
  width: 20px;
  color: var(--muted);
  font-size: var(--seed-font-size-t4);
}
.grade-row .q {
  flex: 1;
  font-size: var(--seed-font-size-t5);
  font-variant-numeric: tabular-nums;
}
.grade-row .ans {
  color: var(--muted);
  font-size: var(--seed-font-size-t4);
}
```

- [ ] **Step 3: O/X 버튼을 action-button으로 바꾼다**

`grade.ts`에서 `.mark` 버튼을 만드는 자리의 클래스를 바꾼다. **O는 neutral, X는 critical이다** — 채점 화면은 부모 소속이라 빨강이 아이에게 부담을 주지 않고, 부모가 훑을 때 오답이 즉시 눈에 띄는 편이 이득이다(설계 §5).

```ts
// 미선택: 'mark seed-action-button seed-action-button--variant_neutralOutline
//          seed-action-button--size_large'
// O 선택: variant_neutralSolid
// X 선택: variant_criticalSolid
```

`app.css`의 `.mark`에서 색·테두리·radius를 지우고 폭만 남긴다:

```css
/* SEED large가 높이 x13(52px)을 준다. 폭만 이 앱이 정한다 — 한 행에 O·X
 * 둘이 들어가고 문제 텍스트를 밀어내지 않을 만큼. */
.mark {
  width: 52px;
}
```

- [ ] **Step 4: 기분 선택을 segmented-control로 바꾼다**

`.moods`/`.mood`의 색·테두리를 지우고 segmented-control 클래스를 붙인다. 선택 상태는 `data-state="checked"`로 준다(레시피의 `data-*` 계약).

- [ ] **Step 5: 이스케이프를 재확인한다**

`grade.ts`에서 `el()` 템플릿에 들어가는 값을 전부 훑는다. `a`·`b`·`answer`는 타입이 `number`여도 가져오기로 임의 문자열이 들어올 수 있으므로 **반드시 `escapeHtml`을 거쳐야 한다**:

```bash
grep -n 'el(`' src/screens/grade.ts
```

각 템플릿의 `${...}` 자리가 `escapeHtml(...)`이거나 우리가 만든 리터럴(`ITEM_MARKS`)인지 확인한다.

- [ ] **Step 6: 검증 사이클**

```bash
export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH"
npx prettier --check . && npm test && npm run build
```

- [ ] **Step 7: 브라우저로 확인한다**

`#/grade`. 확인 항목:

- **X를 누르면 빨강이 된다**(전에는 검정)
- **창을 1376px로 넓혀도 행이 560px에서 멈춘다** — 이 태스크의 핵심 확인
- 문항 번호(①②③…)가 종이와 같은 순서다
- 기분 3택이 하나만 선택된다
- 저장하면 평일은 `#/parent`, 일요일은 `#/report`로 간다

- [ ] **Step 8: 커밋**

```bash
git add src/screens/grade.ts src/styles/app.css
git commit -m "feat: 채점 화면 — 오답은 critical, 행은 560px에서 멈춘다

#app이 md·lg에서 넓어지지만 .grade-row만 따라가지 않는다. flex라 넓어지면
문제와 O/X 사이가 700px 가까이 벌어지고 14문항을 연달아 누르는 화면이라
그대로 피로가 된다. 넓히면 나빠지는 유일한 자리다."
```

---

### Task 7: 스프린트 화면

**Files:**

- Modify: `src/screens/sprint.ts`
- Modify: `src/styles/app.css` (`.keypad`·`.sprint-*`)

- [ ] **Step 1: 키패드를 넓히고 버튼을 키운다**

```css
/*
 * SEED action-button의 최대 size인 large가 x13(52px)인데, 여기는 8살이
 * 쓰는 자리다. HANDOFF가 "8살 손가락 기준으로 키패드가 충분히 큰지"를
 * 아직 미확인으로 이월해 둔 상태라, 확인도 안 된 크기를 더 줄일 근거가 없다.
 * 컴포넌트 기본값 대신 같은 스케일에서 한 칸 큰 x16(64px)을 고른다 —
 * 스케일 안의 값이므로 SEED 정책 위반이 아니다(설계 §0 단서).
 */
.keypad {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--seed-dimension-x2);
  max-width: 320px;
  margin: 0 auto;
}
@media (width >= 768px) {
  .keypad {
    max-width: 420px;
  }
}
.keypad button {
  height: var(--seed-dimension-x16);
  font-size: var(--seed-font-size-t10);
  font-weight: 700;
}
```

`.keypad button`에 `aspect-ratio: 3/2`가 있으면 지운다 — 높이를 토큰으로 고정하므로 충돌한다.

- [ ] **Step 2: 키패드 버튼에 action-button 클래스를 붙인다**

`sprint.ts`에서 키패드 버튼을 만드는 자리:

```ts
// class="seed-action-button seed-action-button--variant_neutralOutline"
```

- [ ] **Step 3: 문제 숫자를 t14로 내린다**

```css
/* 56px은 스케일 밖이었고 설계된 값도 아니었다(§0). t14가 SEED 최댓값이다. */
.sprint-q {
  font-size: var(--seed-font-size-t14);
  line-height: var(--seed-line-height-t14);
  font-weight: 800;
  text-align: center;
  letter-spacing: 0.02em;
  font-variant-numeric: tabular-nums;
}
.sprint-a {
  font-size: var(--seed-font-size-t13);
  line-height: var(--seed-line-height-t13);
  font-weight: 700;
  text-align: center;
  height: var(--seed-dimension-x14);
  margin: var(--seed-dimension-x3) 0 var(--seed-dimension-x7);
  font-variant-numeric: tabular-nums;
}
```

- [ ] **Step 4: 진행바는 토큰만 바꾼다**

SEED에 선형 progress 레시피가 없다(`progress-circle`뿐). 구조는 그대로 두고 색만:

```css
.sprint-progress i {
  flex: 1;
  height: 6px;
  border-radius: 3px;
  background: var(--seed-color-bg-layer-fill);
}
.sprint-progress i.done {
  background: var(--seed-color-bg-brand-solid);
}
```

- [ ] **Step 5: 검증 사이클**

```bash
export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH"
npx prettier --check . && npm test && npm run build
```

- [ ] **Step 6: 브라우저로 확인한다**

`#/sprint`. 확인 항목:

- **820px에서 키패드 버튼 높이가 64px, 1024px 이상에서 폭 420px** — 개발자도구로 실측한다
- 문제 숫자가 48px이다. **아빠 눈으로 봐서 아이가 읽기에 충분한지 판단한다** — 작으면 기록해 두고 Task 11에서 다룬다
- 진행바가 채워질 때 주황이다
- **결과 화면에서 부모 화면으로 가는 버튼이 없다** — 전에 "월간 리포트 보기"가 아이를 채점 화면으로 데려간 전례가 있다

- [ ] **Step 7: 커밋**

```bash
git add src/screens/sprint.ts src/styles/app.css
git commit -m "feat: 스프린트 — 키패드를 x16(64px)으로, 문제 숫자를 t14로

SEED action-button의 최대 large가 52px인데 여기는 8살이 쓰는 자리다.
키패드가 충분히 큰지가 아직 미확인 항목이라 확인 전에 줄일 근거가 없어
같은 스케일에서 한 칸 큰 x16을 골랐다 — 스케일 안이므로 정책 위반이 아니다."
```

---

### Task 8: 리포트 화면 — `confirmDialog`·`toast` 배선

**Files:**

- Modify: `src/screens/report.ts`
- Modify: `src/styles/app.css` (`.report-types`)

**Interfaces:**

- Consumes: Task 3의 `toast`, Task 4의 `confirmDialog`.

- [ ] **Step 1: import를 추가한다**

`src/screens/report.ts` 상단:

```ts
import {
  clearError,
  confirmDialog,
  el,
  escapeHtml,
  formatDate,
  navigate,
  showError,
  toast,
} from '../ui'
```

- [ ] **Step 2: 손으로 만든 확인 패널을 `confirmDialog`로 바꾼다**

`#confirm-replace` 버튼과 그 패널 마크업을 지우고, 파일을 고른 직후 흐름에서 부른다:

```ts
const ok = await confirmDialog({
  title: '현재 기록을 지우고 복구할까요?',
  description:
    '지금 아이패드에 있는 기록이 전부 사라지고 파일의 내용으로 바뀌어요. 되돌릴 수 없어요.',
  confirmLabel: '복구',
  cancelLabel: '취소',
  tone: 'critical',
})
if (!ok) return
```

**`fileInput.value`를 비우는 기존 로직은 그대로 둔다** — 확인 배너가 패널을 덮은 뒤 같은 파일을 재선택해도 `change`가 뜨게 하는 장치이고, 최종 리뷰 수정 웨이브에서 들어간 것이다.

- [ ] **Step 3: 성공 경로에 `toast`를 붙인다**

지금까지 침묵하던 자리 셋:

```ts
// 내보내기 성공 직후
toast('백업 파일을 저장했어요', { tone: 'positive' })

// "저장했나요? → 네" 기록 직후
toast('저장 확인을 기록했어요', { tone: 'positive' })

// 복구(replaceAll) 성공 직후
toast('복구했어요', { tone: 'positive' })
```

- [ ] **Step 4: `.report-types`를 토큰으로 바꾼다**

```css
.report-types li {
  padding: var(--seed-dimension-x2) var(--seed-dimension-x3);
  background: var(--seed-color-bg-layer-default);
  border: 1px solid var(--seed-color-stroke-neutral-weak);
  border-radius: var(--seed-radius-r2);
  margin-bottom: var(--seed-dimension-x1);
  font-size: var(--seed-font-size-t4);
}
```

- [ ] **Step 5: 검증 사이클**

```bash
export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH"
npx prettier --check . && npm test && npm run build
```

- [ ] **Step 6: 브라우저로 확인한다 — 인수인계 이월 항목을 여기서 턴다**

`#/report`. 확인 항목:

- 내보내기 → 파일이 떨어지고 **토스트가 뜬다**
- **"저장했나요? → 네" 이후 30일 배지가 실제로 사라진다**(이월 항목)
- **가져오기: JSON이 아닌 파일** → "JSON 파일이 아니에요" 배너(이월 항목)
- **가져오기: 깨진 JSON** → 사유 배너(이월 항목)
- **가져오기: 정상 파일** → 확인 다이얼로그가 뜨고, 취소하면 아무 일도 없다
- **확인을 연타해도 복구가 한 번만 돈다**
- 복구 후 모든 화면이 새 데이터로 렌더된다

**복구는 되돌릴 수 없다.** 시험 전에 반드시 내보내기로 백업을 먼저 만든다.

- [ ] **Step 7: 커밋**

```bash
git add src/screens/report.ts src/styles/app.css
git commit -m "feat: 리포트 — 확인 패널을 confirmDialog로, 성공 경로에 toast

손으로 만든 #confirm-replace 패널을 걷어낸다. 이중 클릭 가드 부재가
Promise의 성질로 해소된다.

내보내기·저장 확인·복구 세 곳이 지금까지 침묵했다 — 실패만 말하고 성공은
아무 말도 안 했다."
```

---

### Task 9: EBS · 구구단 지도 · 지도 래퍼

**Files:**

- Modify: `src/screens/ebs.ts`
- Modify: `src/screens/fact-map.ts`
- Modify: `src/screens/map.ts`
- Modify: `src/styles/app.css` (`.ebs-*`·`.factmap*`)

- [ ] **Step 1: badge 레시피를 import한다**

```css
@import '@seed-design/css/recipes/badge.layered.css';
```

- [ ] **Step 2: `.ebs-active` 배지를 neutral로 바꾼다**

**brand(주황)를 쓰지 않는 것이 이 스텝의 요점이다.** SEED 역할 문서가 `brand`를 "브랜드 인식·화면에서 가장 중요한 액션"으로 한정하는데, "문제지에 나와요"는 브랜드도 액션도 아니고 사실 전달이다. 게다가 brand 조합은 대비가 2.68~2.94로 미달이고 neutral은 15.49다.

`ebs.ts`에서:

```ts
// class="ebs-active seed-badge__root seed-badge__root--tone_neutral-variant_weak"
```

`app.css`의 `.ebs-active`에서 `background: #f2760c`·`color: #fff`·`border-radius: 99px`·`padding`을 **전부 지운다**(badge가 준다).

- [ ] **Step 3: 구구단 지도를 md에서 넓힌다**

```css
/*
 * 320px에 10열이라 칸 하나가 32px이고 글자가 10px이었다. 아이가 아이패드를
 * 들고 보는 화면인데 작다. md에서 480px면 칸이 48px이 된다.
 */
.factmap {
  display: grid;
  grid-template-columns: repeat(10, 1fr);
  gap: 2px;
  max-width: 320px;
  margin: 0 auto var(--seed-dimension-x2);
}
@media (width >= 768px) {
  .factmap {
    max-width: 480px;
  }
}
.factmap .cell {
  aspect-ratio: 1;
  border: 1px solid var(--seed-color-stroke-neutral-weak);
  border-radius: var(--seed-radius-r1);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--seed-font-size-t1);
  color: var(--muted);
}
/* 정복은 brand — 아이 화면에서 '해냈다'를 표시하는 가장 중요한 상태다. */
.factmap .cell.fluent {
  background: var(--seed-color-bg-brand-solid);
  border-color: var(--seed-color-bg-brand-solid);
  color: var(--seed-color-fg-neutral-inverted);
  font-weight: 700;
}
.factmap .cell.fresh {
  background: var(--seed-color-bg-layer-default);
  border: 2px solid var(--seed-color-bg-brand-solid);
  color: var(--seed-color-fg-brand);
  font-weight: 700;
}
/* 배우는 중은 neutral — 아직 아무 주장도 하지 않는 상태다. */
.factmap .cell.learning {
  background: var(--seed-color-bg-layer-fill);
  border-color: var(--seed-color-stroke-neutral-weak);
}
```

- [ ] **Step 4: `.ebs-*` 나머지를 토큰으로 바꾼다**

`.ebs-group`·`.ebs-topic`·`.ebs-link`·`.ebs-bar`·`.ebs-count`·`.ebs-parent`의 px·색을 토큰으로. `.ebs-flag`의 `#1f9d55`는 `var(--seed-color-fg-positive)`로. `.ebs-bar i`의 `var(--fg)`는 `var(--seed-color-bg-brand-solid)`로(진행 표시는 brand다).

`.ebs-topic`은 SEED에 카드 레시피가 없으므로 구조를 유지하고 토큰만 쓴다.

- [ ] **Step 5: 이스케이프를 재확인한다**

```bash
grep -n 'el(`' src/screens/ebs.ts src/screens/fact-map.ts
```

- [ ] **Step 6: 검증 사이클**

```bash
export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH"
npx prettier --check . && npm test && npm run build
```

- [ ] **Step 7: 브라우저로 확인한다**

`#/ebs`와 `#/map`. 확인 항목:

- **"문제지에 나와요" 배지가 회색 계열이고 글자가 또렷하다**(주황 배경 흰 글자가 아니다)
- **1024px에서 지도 칸이 48px이다** — 개발자도구로 실측
- 정복 칸이 주황, 배우는 중이 회색으로 **구분된다**
- **EBS·지도 화면의 "← 홈"이 아이 홈(`#/`)으로 간다** — 부모 홈이 아니다

- [ ] **Step 8: 커밋**

```bash
git add src/screens/ebs.ts src/screens/fact-map.ts src/screens/map.ts src/styles/app.css
git commit -m "feat: EBS·지도 — 배지를 neutral로, 지도 칸을 md에서 48px로

'문제지에 나와요'는 브랜드도 액션도 아니라 사실 전달이다. SEED 역할 규칙대로
neutral을 쓰니 대비가 2.85에서 15.49가 됐다 — 정책을 따르는 것이 접근성
결함을 함께 없앴다.

지도는 320px에 10열이라 칸이 32px이었다. 아이가 들고 보는 화면이다."
```

---

### Task 10: 인쇄 화면의 화면 부분만

**Files:**

- Modify: `src/screens/print-sheet.ts` — **`.step`·`.banner`·`.no-print`만**

**절대 건드리지 않을 것:** `.sheet*`·`.vgrid`·`.vprob`·`.vnum`·`.vcalc`·`.vcarry`·`.vline`·`.vrule`·`.vans`·`.inv*`·`.strat*`·`.word*`·`.n`

- [ ] **Step 1: 손댈 자리를 먼저 확정한다**

```bash
grep -n 'class="step\|class="banner\|class="no-print' src/screens/print-sheet.ts
```

여기 나온 줄 **말고는 이 파일에서 아무것도 바꾸지 않는다.**

- [ ] **Step 2: 클래스만 바꾼다**

`.step`·`.banner`는 Task 5에서 이미 SEED 위에 재정의됐으므로 **마크업을 바꿀 것이 없을 수도 있다.** 배너가 `callout` 클래스를 필요로 하면 `home-parent.ts`와 같은 형태로 맞춘다.

- [ ] **Step 3: 검증 사이클**

```bash
export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH"
npx prettier --check . && npm test && npm run build
```

- [ ] **Step 4: 종이 마크업이 안 바뀌었음을 diff로 확인한다**

```bash
git diff src/screens/print-sheet.ts
```

diff에 `sheet`·`vgrid`·`inv`·`strat`·`word` 문자열이 **한 줄도 없어야 한다.** 있으면 되돌린다.

- [ ] **Step 5: 브라우저로 확인한다**

`#/print`. 확인 항목:

- 화면 위쪽의 버튼·배너가 새 톤이다
- **종이 미리보기(⌘P)가 눈으로 봐서 이전과 같다**

- [ ] **Step 6: 커밋**

```bash
git add src/screens/print-sheet.ts
git commit -m "feat: 인쇄 화면의 화면 부분만 SEED로 — 종이는 불변"
```

---

### Task 11: 전체 검증

**이 태스크는 코드를 바꾸지 않는다.** 발견된 결함은 여기서 고치고 별도 커밋한다.

- [ ] **Step 1: 인쇄 회귀 — 기계적으로 확인한다**

브라우저로 `#/print`를 열고 **Task 0과 같은 날짜**에서:

```js
Array.from(document.querySelectorAll('.sheet'))
  .map((el) => el.outerHTML)
  .join('\n<!-- SHEET BREAK -->\n')
```

`print-after.html`로 저장한 뒤:

```bash
diff /private/tmp/.../scratchpad/print-before.html /private/tmp/.../scratchpad/print-after.html
```

**출력이 비어야 통과다.** 한 글자라도 다르면 원인을 찾아 되돌린다. `.sheet` 개수도 Task 0에서 기록한 것과 같아야 한다.

- [ ] **Step 2: 소속 불변식 — `navigate` 호출부를 전부 센다**

```bash
git diff main...seed-design -- src/screens src/ui.ts src/main.ts | grep -n 'navigate('
grep -rn 'navigate(' src/screens src/ui.ts src/main.ts
```

목적지를 하나씩 대조한다. **문자열 리터럴만 보지 않는다** — 삼항연산자·템플릿 리터럴·변수에 담긴 해시·`location.hash` 대입까지 본다. `grade.ts`의 `navigate(weekdayOf(target) === 0 ? '#/report' : '#/parent')`가 리터럴 검색에 안 걸린 전례가 있다.

판정: 아이 화면(`#/`·`#/sprint`·`#/map`·`#/ebs`)에서 부모 화면(`#/parent`·`#/print`·`#/grade`·`#/report`)으로 가는 경로가 **하나도 없어야 한다.** 새로 만든 오버레이의 버튼도 대상이다.

- [ ] **Step 3: XSS 재점검**

```bash
grep -rn 'el(`' src/screens/*.ts
```

각 템플릿의 `${...}` 자리가 `escapeHtml(...)`이거나 우리가 만든 리터럴(`ITEM_MARKS` 등)인지 확인한다. `a`·`b`·`c`·`answer`는 타입이 `number`여도 가져오기로 임의 문자열이 들어올 수 있다.

- [ ] **Step 4: 해상도·방향 확인**

브라우저 창을 **820 · 1024 · 1180 · 1376px** 폭으로 맞춘다. 확인 항목:

| 대상         | 820 (md) | 1024 (md) | 1376 (lg) |
| ------------ | -------- | --------- | --------- |
| `#app`       | 720      | 720       | **840**   |
| `.factmap`   | 480      | 480       | 480       |
| `.keypad`    | 420      | 420       | 420       |
| `.grade-row` | **560**  | **560**   | **560**   |

- [ ] **Step 5: 인수인계 이월 항목 중 남은 것을 본다**

Task 8에서 못 턴 것:

- **빈 데이터 렌더** — 새 프로필(다른 브라우저 프로필이나 시크릿 창)에서 모든 화면을 연다. 깨지는 곳이 없어야 한다
- **일요일 채점 후 `#/report` 자동 전환**
- **홈 스프린트 버튼 3-상태**(점검 due·점검 완료·일반)

- [ ] **Step 6: 발견된 것을 고치고 커밋한다**

고칠 것이 있으면 각각 별도 커밋으로 낸다. 없으면 이 태스크는 커밋 없이 끝난다.

---

### Task 12: 문서 갱신과 머지

**Files:**

- Modify: `docs/superpowers/HANDOFF.md`
- Modify: `docs/superpowers/specs/2026-08-04-role-based-ui-design.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: HANDOFF의 색 격리 규칙을 갱신한다**

「역할 분리」절의 _"아이 홈 색은 `kid.css`에만 있다(`--kid-accent` 주황 · `--kid-done` 초록). `app.css`에 아이용 색을 넣지 말 것"_ 항목을 바꾼다. 두 변수는 없어졌고, 아이·부모 화면이 같은 SEED 역할 토큰을 쓰므로 **색이 새는 것 자체가 불가능해졌다.** `kid.css`에 남는 것은 아이 화면 전용 크기·배치라고 적는다.

「지금 상태」의 테스트·검사 줄과 미해결 항목도 이 작업 결과로 갱신한다.

- [ ] **Step 2: `role-based-ui` 스펙의 같은 항목을 갱신한다**

§6의 색 관련 서술에 "2026-08-04 SEED 도입으로 대체됨"을 명시하고 새 스펙을 가리킨다.

- [ ] **Step 3: CLAUDE.md의 의존성 서술을 정정한다**

「아키텍처」 첫 줄 *"프레임워크 없음(바닐라 DOM), 런타임 의존성 0개"*를 사실에 맞게 고친다 — 실행 코드 의존성은 여전히 0이고, `@seed-design/css`는 CSS만 내는 빌드 시점 의존성이라는 것을 함께 적는다. 「단일 출처」 절에도 **SEED 토큰을 우리 CSS로 복사하지 말 것**을 추가한다.

- [ ] **Step 4: 포맷하고 검증한다**

```bash
export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH"
npm run format
npx prettier --check . && npm test && npm run build
```

**`npm run format`을 빼먹으면 배포가 막힌다.** `.prettierignore`가 없어 CI가 마크다운까지 검사한다.

- [ ] **Step 5: 커밋**

```bash
git add docs/superpowers/HANDOFF.md docs/superpowers/specs/2026-08-04-role-based-ui-design.md CLAUDE.md
git commit -m "docs: SEED 도입에 맞춰 색 격리 규칙과 의존성 서술을 갱신한다"
```

- [ ] **Step 6: main에 머지한다**

```bash
git switch main && git pull
git merge seed-design       # 충돌이 없으면 그대로
```

**충돌이 나면 rebase-merge가 기본이다.** 단, 브랜치가 이미 origin에 push돼 있거나 충돌이 이 레포의 불변식(재인쇄 동일성·`derived` 비배선·단일 출처)에 닿으면 **멈추고 알린다.**

- [ ] **Step 7: 머지 후 전체 검증을 다시 돌린다**

```bash
export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH"
npx prettier --check . && npm test && npm run build
```

- [ ] **Step 8: push하고 배포를 확인한다**

```bash
git push
gh run watch
```

**push = 배포다.** 실패하면 배포되지 않는다.

- [ ] **Step 9: 브랜치를 정리한다**

```bash
git branch -d seed-design
```

---

## Self-Review

**스펙 커버리지**

| 스펙 절                  | 태스크                                                            |
| ------------------------ | ----------------------------------------------------------------- |
| §1 왜 SEED인가           | 1 (설치)                                                          |
| §2 도입 형태 (layered)   | 1                                                                 |
| §3 브랜드 색 — 나중 교체 | 해당 없음(후속 작업)                                              |
| §4 토큰 매핑·대비        | 1, 9(배지)                                                        |
| §5 색 역할 어휘          | 5, 6, 7, 8, 9                                                     |
| §6 오버레이 3종          | 2(showError), 3(toast), 4(confirmDialog), 8(배선)                 |
| §7 인쇄 누수 ①②          | 1(①), 2(②), 10, 11                                                |
| §8 타이포·간격           | 1, 5~9                                                            |
| §8.1 반응형              | 1(`#app`), 6(`.grade-row`), 7(`.keypad`), 9(`.factmap`), 11(확인) |
| §9 화면별                | 5~10                                                              |
| §10 작업 경로(브랜치)    | 0, 12                                                             |
| §11 검증 4종             | 0(기준 스냅샷), 11                                                |
| §12 후속 문서 갱신       | 12                                                                |

빠진 절 없음.

**타입 일관성**

- `toast(message, opts?)` — Task 3에서 정의, Task 8에서 사용. 시그니처 일치
- `confirmDialog(opts): Promise<boolean>` — Task 4에서 정의, Task 8에서 사용. 일치
- `.overlay` — Task 2에서 규약 확립, Task 3·4에서 부착. 일치
- SEED 슬롯 클래스명은 실제 패키지에서 확인한 것이다: `seed-callout__root`·`seed-snackbar__root`·`seed-snackbar__message`·`seed-snackbar-region`·`seed-dialog__backdrop|positioner|content|header|title|description|footer`·`seed-badge__root`·`seed-action-button`

**남은 불확실성 (구현 중 확인할 것)**

- `--seed-color-bg-positive-solid`의 존재 — Task 5 Step 5에 확인 명령을 넣어 뒀다
- `.update` 배너를 만드는 정확한 위치 — Task 2 Step 3에 grep을 넣어 뒀다
- `--snackbar-region-offset: 68px`의 값 — 업데이트 배너 실측 높이(약 56px + bottom 12px)에서 왔다. Task 3 브라우저 확인에서 겹치면 조정한다
