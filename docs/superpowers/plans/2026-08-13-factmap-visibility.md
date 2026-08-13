# 구구단 지도 가시성 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `#/map`에서 「새로!」(오늘 정복)가 실제로 그려지게 하고, 「연습 중」을 「아직」과 눈으로 구분되게 한다.

**Architecture:** `engine/facts.ts`에 `newlyFluentSince`(경계 이전 파생과 전체 파생의 차집합)를 추출해 리포트·지도·스프린트 재진입이 공유한다. CSS는 연습 중 칸에 브랜드 약색 배경+테두리 두 채널.

**Tech Stack:** 바닐라 TS, vitest, SEED 디자인 토큰. 스펙: `docs/superpowers/specs/2026-08-13-factmap-visibility-design.md` (적대적 리뷰 2라운드 합의본).

## Global Constraints

- 모든 npm 명령 전 `export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH"` (에이전트 셸은 mise를 타지 않는다)
- 테스트는 `src/engine/`에만 둔다 — DOM·화면 테스트 금지 (설계 §12)
- 색 값을 CSS에 베끼지 않는다 — SEED **역할 토큰**만 (`--seed-color-palette-*` 직참조 금지, app.css의 static-white 기각 전례)
- 아이 화면(`#/map`·`#/sprint`)에서 부모 화면으로 가는 `navigate(...)`를 만들지 않는다
- main 직접 커밋 경로: `git add <명시 경로>`만, 커밋마다 `npx prettier --check .` · `npm test` · `npm run build` 통과. 각 커밋은 단독 배포 가능해야 한다
- `Meta.derived`를 채우지 않는다 — 모든 상태는 매번 로그에서 재계산

---

### Task 1: 엔진 — `newlyFluentSince` 추출 (TDD)

**Files:**

- Modify: `src/engine/facts.ts` (deriveFacts 뒤, 118행 부근에 함수 추가)
- Modify: `src/engine/report.ts:8-15` (상단 주석), `:78-85` (newlyFluent 계산 교체)
- Test: `src/engine/facts.test.ts`

**Interfaces:**

- Produces: `newlyFluentSince(days: Day[], fluentMs: number, since: string): string[]` — Task 2가 import한다. 반환 순서는 `FACT_IDS` 순서.

- [ ] **Step 1: 실패하는 테스트 5개 작성**

`src/engine/facts.test.ts` — 기존 헬퍼 `sprintDay`/`hit`/`miss`(13-23행)를 그대로 쓴다. import 목록에 `newlyFluentSince` 추가. 파일 끝에:

```ts
describe('newlyFluentSince', () => {
  // fluent 조건: 연속 정답 STREAK_TARGET(3)회 && 그 중앙값 <= fluentMs.
  // 연속은 날짜를 넘어 이어진다 — 아래 픽스처들이 이를 이용한다.
  it('since 당일 기록으로 비로소 fluent가 된 식을 담는다', () => {
    const days = [
      sprintDay('2026-08-12', [hit('7×8', 1000)]),
      sprintDay('2026-08-13', [hit('7×8', 1000), hit('7×8', 1000)]),
    ]
    expect(newlyFluentSince(days, 2500, '2026-08-13')).toEqual(['7×8'])
  })

  it('since 이전에 이미 fluent였던 식은 당일 또 맞혀도 담지 않는다', () => {
    const days = [
      sprintDay('2026-08-12', [hit('7×8', 1000), hit('7×8', 1000), hit('7×8', 1000)]),
      sprintDay('2026-08-13', [hit('7×8', 1000)]),
    ]
    expect(newlyFluentSince(days, 2500, '2026-08-13')).toEqual([])
  })

  it('아직 fluent가 아닌 식은 담지 않는다', () => {
    const days = [sprintDay('2026-08-13', [hit('7×8', 1000)])]
    expect(newlyFluentSince(days, 2500, '2026-08-13')).toEqual([])
  })

  it('since 이전 기록이 없으면 현재 fluent 전부가 나온다 (FACT_IDS 순서)', () => {
    // 기대값은 리터럴로 박는다 — deriveFacts로 계산하면 구현과 기대가
    // 같은 함수를 공유하는 반쪽 항진명제가 된다 (스펙 §4 리뷰 M-3).
    const days = [
      sprintDay('2026-08-13', [
        hit('7×8', 1000),
        hit('7×8', 1000),
        hit('7×8', 1000),
        hit('3×4', 1000),
        hit('3×4', 1000),
        hit('3×4', 1000),
      ]),
    ]
    expect(newlyFluentSince(days, 2500, '2026-08-13')).toEqual(['3×4', '7×8'])
  })

  it('since 이전엔 fluent였다가 이후 강등된 식은 담지 않는다', () => {
    const days = [
      sprintDay('2026-08-12', [hit('7×8', 1000), hit('7×8', 1000), hit('7×8', 1000)]),
      sprintDay('2026-08-13', [miss('7×8')]),
    ]
    expect(newlyFluentSince(days, 2500, '2026-08-13')).toEqual([])
  })
})
```

- [ ] **Step 2: 실패 확인**

```bash
npx vitest run src/engine/facts.test.ts
```

기대: `newlyFluentSince` import 실패(또는 not a function)로 새 5개가 전부 FAIL, 기존 테스트는 PASS.

- [ ] **Step 3: 구현**

`src/engine/facts.ts`의 `deriveFacts` 바로 뒤에:

```ts
/**
 * since 이후의 기록으로 **비로소** fluent가 된 식 id 목록 —
 * (전체 파생의 fluent) − (date < since 인 날만의 파생의 fluent).
 * 반환 순서는 FACT_IDS 순서(deriveFacts 키 순서)다.
 *
 * 리포트(주간: since = weekStart), 지도(#/map: since = today),
 * 스프린트 재진입 결과 화면(since = today)이 공유한다 — 「새로!」 계산의
 * 단일 출처. 저장하지 않고 매번 재계산한다(derived 비배선과 같은 원칙).
 */
export function newlyFluentSince(days: Day[], fluentMs: number, since: string): string[] {
  const now = deriveFacts(days, fluentMs)
  const before = deriveFacts(
    days.filter((d) => d.date < since),
    fluentMs,
  )
  return Object.keys(now).filter(
    (id) => now[id]!.status === 'fluent' && before[id]!.status !== 'fluent',
  )
}
```

- [ ] **Step 4: 통과 확인**

```bash
npx vitest run src/engine/facts.test.ts
```

기대: 전부 PASS.

- [ ] **Step 5: 변이 검증 (스펙 §4 — 순서대로, 각각 원복)**

- 변이 ①: 구현의 `d.date < since` → `d.date <= since`. `npx vitest run src/engine/facts.test.ts` → **1번·4번 테스트만** 빨개져야 한다. 원복.
- 변이 ②: return 문을 `return Object.keys(now).filter((id) => now[id]!.status === 'fluent')`로 (before 차감 제거). → **2번만** 빨개져야 한다 (5번의 강등된 식은 현재 fluent가 아니라 이 변이로도 반환되지 않는다 — 초록이 정상). 원복.
- 변이 ③: 필터를 대칭차로 — `(now[id]!.status === 'fluent') !== (before[id]!.status === 'fluent')`. → **5번만** 빨개져야 한다 (1~4번 초록). 원복.

셋 중 하나라도 예측과 다르면 멈추고 테스트를 고친 뒤 다시 돈다.

- [ ] **Step 6: `engine/report.ts` 리팩터링 (동작 불변)**

`weeklyReport`의 78-85행:

```ts
const factsNow = deriveFacts(days, fluentMs)
const factsBefore = deriveFacts(
  days.filter((d) => d.date < weekStart),
  fluentMs,
)
const newlyFluent = Object.keys(factsNow).filter(
  (id) => factsNow[id]!.status === 'fluent' && factsBefore[id]!.status !== 'fluent',
)
```

를 다음으로 교체 (`factsNow`는 아래 `fluentTotal`이 계속 쓰므로 유지):

```ts
const factsNow = deriveFacts(days, fluentMs)
const newlyFluent = newlyFluentSince(days, fluentMs, weekStart)
```

import에 `newlyFluentSince` 추가 (2행의 `from './facts'` 목록에).

상단 주석(11-14행)의 횟수를 갱신 — "총 여섯 번" 문장을:

```
 * derived를 배선하지 않는 것과 같은 원칙이다. 판정 규칙이 바뀌면 과거 주간도
 * 새 규칙으로 소급 재해석된다. `#/report`를 한 번 열 때 deriveFacts는 총 일곱 번
 * 돈다 — weeklyReport 안에서 넷(factsNow·newlyFluentSince가 안에서 부르는 둘·
 * nextCheckupDate가 숨겨서 부르는 것 하나), renderReport의 지도용 하나,
 * latestCheckupReport 안에서 둘(before·upto).
 * 5년치 로그(54,750 시도)에서 1회 16ms이므로 일곱 번이어도 아이패드에서 보이지 않는다.
```

- [ ] **Step 7: 전체 검사 + 커밋**

```bash
npx prettier --check . && npm test && npm run build
git add src/engine/facts.ts src/engine/facts.test.ts src/engine/report.ts
git commit -m "feat: 「새로!」 계산을 newlyFluentSince로 추출 — 리포트·지도·재진입의 단일 출처"
```

`report.test.ts`의 기존 newlyFluent 테스트(33행·43-49행)가 **수정 없이** 통과해야 한다 — 리팩터링 동작 불변의 증거. 실패하면 리팩터링이 틀린 것이다(테스트를 고치지 말 것).

---

### Task 2: 화면·CSS — 지도·재진입에 오늘 창, 연습 중 두 채널

**Files:**

- Modify: `src/screens/map.ts` (import, 26행)
- Modify: `src/screens/sprint.ts` (import, 51행)
- Modify: `src/screens/fact-map.ts:55` (범례 연습 중 인라인 색)
- Modify: `src/styles/app.css:396-400` (`.factmap .cell.learning`)

**Interfaces:**

- Consumes: Task 1의 `newlyFluentSince(days, fluentMs, since)`

- [ ] **Step 1: `map.ts` — 오늘 정복을 fresh로**

import 수정:

```ts
import { deriveFacts, newlyFluentSince } from '../engine/facts'
import { dayKey } from '../engine/dates'
```

`renderMap` 본문에서 `deriveFacts` 호출 다음 줄에:

```ts
const fresh = new Set(newlyFluentSince(days, meta.settings.fluentMs, dayKey(new Date())))
```

26행의 호출을 교체:

```ts
${factMapHtml(facts, fresh, { invite: true })}
```

- [ ] **Step 2: `sprint.ts` — 재진입 분기도 같은 창 (스펙 §2-2b)**

import의 `from '../engine/facts'` 목록에 `newlyFluentSince` 추가. 51행:

```ts
renderResult(root, facts, new Set(), existing.sprint, previousMean(days, today), null)
```

을 다음으로 교체:

```ts
renderResult(
  root,
  facts,
  new Set(newlyFluentSince(days, meta.settings.fluentMs, today)),
  existing.sprint,
  previousMean(days, today),
  null,
)
```

완료 직후 결과 화면(세션 기준 `newly`, 315행 부근)은 **건드리지 않는다**.

- [ ] **Step 3: CSS — 연습 중 두 채널**

`src/styles/app.css`의 `.factmap .cell.learning` 블록(396-400행)을 주석까지 교체:

```css
/* 연습 중은 옅은 브랜드 두 채널(배경+테두리) — carrot-100 배경만으로는 흰
 * 바탕과 채널별 0·13·19 차이라, iPhone True Tone이 흰색을 따뜻하게 밀면
 * 「아직」과 다시 같은 색이 된다(2026-08-13 실기기 실패의 재현 메커니즘).
 * 테두리(carrot-300)가 두 번째 시각 채널로 남는다. 그래도 부족하면 배경을
 * --seed-color-bg-brand-weak-pressed(carrot-200)로 올린다 — pressed 토큰을
 * 정적 상태에 쓰는 의미 비용은 인지된 선택(팔레트 직참조는 기각 전례). */
.factmap .cell.learning {
  background: var(--seed-color-bg-brand-weak);
  border-color: var(--seed-color-stroke-brand-weak);
}
```

- [ ] **Step 4: 범례 동기화**

`src/screens/fact-map.ts:55` — TS 템플릿 리터럴 안의 한 줄이다:

```ts
<span><i style="background:var(--seed-color-bg-layer-fill);border-color:var(--seed-color-stroke-neutral-weak)"></i>연습 중</span>
```

의 인라인 스타일을 다음으로 교체 (범례 견본과 실제 칸이 다른 색이면 범례가 거짓말이 된다):

```ts
<span><i style="background:var(--seed-color-bg-brand-weak);border-color:var(--seed-color-stroke-brand-weak)"></i>연습 중</span>
```

- [ ] **Step 5: 전체 검사 + 육안 확인**

```bash
npx prettier --check . && npm test && npm run build
npm run dev   # http://localhost:5173/haruchi/
```

`#/map`에서: 연습 중 칸이 옅은 주황+주황 테두리로 「아직」과 구분되는지, 범례 견본이 칸과 같은 색인지. 오늘 스프린트 기록이 있는 상태라면 그 칸이 「새로!」(흰 바탕+굵은 주황 테두리+주황 숫자)인지, `#/sprint` 재진입 결과 화면과 지도가 같은 칸을 같은 상태로 보여주는지(스펙 I-1 모순 해소).

- [ ] **Step 6: 커밋 + 배포 확인**

```bash
git add src/screens/map.ts src/screens/sprint.ts src/screens/fact-map.ts src/styles/app.css
git commit -m "fix: 지도에 오늘 정복 「새로!」를 실제로 그리고 연습 중을 브랜드 약색으로 구분한다"
git push && gh run watch
```

---

## 배포 후 사람 확인 (자동화 불가 — 사용자에게 안내)

스펙 §5: **연습 중 색 판정은 실기기에서 한다.** 배포 후 iPhone(True Tone 켠 상태) `#/map`에서 연습 중 칸이 「아직」과 구분되는지 확인. 부족하면 `.cell.learning`의 배경만 `--seed-color-bg-brand-weak-pressed`로 올려(범례도 함께) 한 번 더 — 이 fallback 판단은 사용자 몫.
