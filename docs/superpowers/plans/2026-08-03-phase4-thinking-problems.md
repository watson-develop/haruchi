# Phase 4 — 생각하는 문제 + 구구단 풀 개편 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 종이 2장째(전략 존 2문항 + 문장제 2문항)를 만들고, 구구단 풀을 2×1~9×9(72식)·무작위 도입으로 개편한다.

**Architecture:** 스펙 `docs/superpowers/specs/2026-08-03-phase4-thinking-problems-design.md`를 따른다. 전략은 선언적 카탈로그(`engine/strategy.ts`) — 렌더러는 `steps`만 안다. 상태는 전부 로그 재생 파생(`deriveStrategies`)이고 아무것도 저장하지 않는다. 문장제는 템플릿 조합(`engine/word.ts`)이며 텍스트가 생성 시점에 `sheet`에 박제된다.

**Tech Stack:** TypeScript + Vite + vitest, 해시 라우팅, IndexedDB. 화면 테스트 없음(로직은 엔진에서).

## Global Constraints

- Node는 mise에만 있다: 모든 셸 명령 앞에 `export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH"`
- git identity 미설정: `git -c user.name="이성호" -c user.email="watson@daangnpay.com" commit …`
- 커밋 전 `npm test` · `npm run build`(tsc 포함) 통과. 문서 커밋 전 `npm run format`(CI가 `docs/`까지 prettier 검사)
- **재인쇄는 같은 문제를 낸다** — `sheet`는 생성 시점에 못박고 재인쇄는 렌더만. `print-sheet.ts`의 `if (!day || day.sheet.length === 0)` 게이트를 건드리지 않는다
- **상태는 전부 파생** — `deriveStrategies`는 저장하지 않는다. `Meta.derived`는 아무도 읽지 않는다(배선 금지)
- **`Day`에 필수 필드를 추가하지 않는다** (마이그레이션 없음이 성립 조건)
- **곱셈 기호는 U+00D7(`×`)** — 식 id는 `engine/facts.ts`만 만들고 푼다
- **`sheet`를 읽는 새 코드는 빈 sheet(`[]`)를 다룬다** (스프린트만 한 날이 만든다)
- **빈 문제지는 절대 내지 않는다** — 생성 실패는 폴백으로
- **`el()`은 `innerHTML`을 쓴다** — 신뢰할 수 없는 값은 `escapeHtml`. 이번 Phase의 인쇄·채점 값은 전부 엔진 생성이지만, 백업 가져오기로 임의 문자열이 `sheet`에 들어올 수 있는 필드(문장제 `text`·`unit`, 전략 `steps[].text`)는 **렌더 지점에서 이스케이프**한다
- 실패 패턴 금지: ① 자기 자신을 검사하는 테스트(생성기가 거른 값을 같은 술어로 단언) ② 느슨한 상한(실측 없이 임계값 조정 금지) ③ 실패할 수 없는 단언 ④ 화면 첫 `await`는 `try` 안 ⑤ 지연 콜백에 취소 경로 ⑥ 이음새를 테스트
- **Phase 3 교훈**: 각 단언마다 "구현이 그럴듯하게 틀렸다면 이 값이 무엇이 되는가"를 자문. 같으면 픽스처를 고칠 것. 논리 수정 후엔 **변이 검증**(구현을 일부러 틀리게 → 테스트 실패 확인 → 원복)
- 주석은 **한국어**, "무엇을 하는가"가 아니라 **"왜 이 선택인가"**

### 태스크 0 결과 — 이음새 조사 (계획 수립 시 완료)

- **`FACT_IDS`/`FACT_ORDER` 독자**: `facts.ts` 내부(derive·compose), `facts.test.ts`(81 하드코딩·FACT_ORDER 순서 테스트 다수 — **재작성 대상**), `checkup.test.ts`(TEN_FACTS는 2×3 등 2단 이상만 써서 무사), simulation(81 단언 3곳)
- **81 하드코딩**: `fact-map.ts`(주석·"/ 81 칸"), `screens/report.ts`("구구단 N/81"), `facts.ts` 주석들
- **`composeSheet` 호출부**: `print-sheet.ts`, `compose.test.ts`, `simulation.test.ts`, (derive.ts는 import 없음 — grep에 걸린 것은 주석)
- **`sheet` 독자**: `print-sheet.ts`(vertical/inverse만 필터 — 새 kind는 **조용히 안 찍힘**, Task 8 전까지의 중간 상태), `grade.ts`(`markMap`이 vertical→inverse만 번호 매김), `deriveTypes`(vertical/inverse만 — 전략·문장제 무시, 의도대로), `home.ts`(`sheet.length`만), `backup.ts`(id+kind만 검사 — strategy/word kind는 **이미 허용 목록에 있음**, 무변경)
- **`ITEM_MARKS`**: `grade.ts`에 ⑭까지 있음. `print-sheet.ts`의 `verticalHtml`/`inverseHtml`에 같은 문자열이 **중복 정의**돼 있다(각 함수 안 `marks`) — Task 8에서 한 곳으로 모은다
- **조사(助詞) 헬퍼**: `inverse.ts`에 숫자용(`hasFinalConsonant(n)`)이 이미 있다. 문장제는 **한글 명사용**이 필요해 `word.ts`에 별도로 만든다(숫자용과 로직이 다름 — 유니코드 받침 계산)
- **시뮬레이션 제약**: `simulate()`(종이 루프)는 스프린트가 없어 fluent가 0 → **곱셈 전략 2종은 시뮬레이션에서 영영 안 열린다.** 다일 단언은 "비곱셈 6종 도달 + 곱셈 잠김"으로 하고, 곱셈 게이트는 fluent 픽스처 단위 테스트로 검증한다
- **`StrategyState`**: `attempts`·`introducedAt`만 있다. 로테이션("가장 오래 안 나온 것")에 `lastAppearedAt`, 게이트에 `appearances`가 필요 — **파생 전용 필드 2개 추가**(저장 안 되므로 마이그레이션 없음)

---

### Task 1: 구구단 풀 개편 — 엔진과 실측 재유도

**Files:**

- Modify: `src/engine/facts.ts` (FACT_IDS·DAN_ORDER·FACT_ORDER·composeSprint·주석)
- Modify: `src/engine/facts.test.ts` (81·FACT_ORDER 기반 테스트 재작성)
- Modify: `src/engine/simulation.test.ts` (81→72, 바닥·상한 실측 재유도)

**Interfaces:**

- Consumes: 기존 `factId`, `shuffled`, `deriveFacts`
- Produces: `FACT_IDS: string[]` (72식, `2×1`~`9×9`), `FACT_ORDER` **삭제**, `composeSprint` 시그니처 불변(신규 선택만 무작위화). 이후 태스크는 `FACT_ORDER`를 import할 수 없다

- [ ] **Step 1: facts.ts 수정**

`FACT_IDS`를 바꾼다:

```ts
/**
 * 2×1 ~ 9×9. 순서쌍이므로 7×8과 8×7은 별개다.
 *
 * 0단·1단은 풀에 없다: 규칙이 하나뿐이라 반복 인출 훈련의 대상이 아니다(0단을 뺐던
 * Phase 2의 사유를 1단에도 적용 — 사용자 결정, 2026-08-03). 곱하는 수 ×1은 남긴다 —
 * 외우는 구구단이 "2×1은 2"부터 시작하기 때문이다. 지도는 8행(2~9단)×9열이 된다.
 *
 * 과거 로그의 1×n 시도는 deriveFacts가 모르는 id로 조용히 건너뛴다(원래 설계).
 * 마이그레이션은 필요 없다.
 */
export const FACT_IDS: string[] = (() => {
  const ids: string[] = []
  for (let a = 2; a <= 9; a++) for (let b = 1; b <= 9; b++) ids.push(factId(a, b))
  return ids
})()
```

`DAN_ORDER`와 `FACT_ORDER`를 **삭제**하고, 그 자리에 결정 기록을 남긴다:

```ts
// 교과서 도입 순서(교육청 지도서의 2→5→3·6→4·8→7→9)는 Phase 4에서 폐기했다 —
// 신규 식을 무작위로 도입한다(사용자 결정, 2026-08-03). 순서 근거 조사는
// docs/reference/integrated-arithmetic-ladder.md §2에 사실 기록으로 남아 있다.
```

`composeSprint`에서 `FACT_ORDER` 참조 3곳을 `FACT_IDS`로 바꾸고, 신규 선택을 무작위화한다:

```ts
const learning = FACT_IDS.filter((id) => facts[id]?.status === 'learning')
const fluentDue = FACT_IDS.filter(/* 기존 조건 그대로 */)
const fluentNotDue = FACT_IDS.filter(/* 기존 조건 그대로 */)
// 신규 도입은 무작위다 — 교과서 순서를 폐기했으므로(위 결정 기록) 섞어서 앞에서 자른다.
// rand가 주입되므로 그날 큐는 여전히 결정적으로 sheet/세션에 고정된다.
const fresh = shuffled(
  FACT_IDS.filter((id) => facts[id]?.status === 'new'),
  rand,
)
```

`fresh.slice(0, wantNew)`는 그대로다. `deriveFacts` 주석의 "81식"을 "72식"으로, 파일 상단 "81칸(9×9)" 주석은 Step 1의 새 주석으로 대체된다.

- [ ] **Step 2: facts.test.ts 재작성 — 실패 확인부터**

Run: `npx vitest run src/engine/facts.test.ts`
Expected: FAIL — 81 기대·`FACT_ORDER` import가 깨진다

바꿀 것:

```ts
it('FACT_IDS는 2×1~9×9, 72개다', () => {
  expect(FACT_IDS).toHaveLength(72)
  expect(new Set(FACT_IDS).size).toBe(72)
  expect(FACT_IDS).toContain('2×1')
  expect(FACT_IDS).toContain('7×8')
  expect(FACT_IDS).toContain('9×9')
  // 1단이 정말 빠졌는지 — 풀 축소가 한쪽만 됐다면 여기서 걸린다
  expect(FACT_IDS).not.toContain('1×1')
  expect(FACT_IDS).not.toContain('1×9')
  // ×1은 남는다 — "2단은 2×1부터"(사용자 결정)
  expect(FACT_IDS).toContain('2×1')
  expect(FACT_IDS).toContain('9×1')
})
```

`FACT_ORDER` 순서 테스트(교과 순서 검증)는 **삭제**하고 무작위 도입 성질로 대체한다:

```ts
it('신규 도입은 rand에 따라 다르고, 같은 rand면 같다 — 무작위이되 결정적', () => {
  const facts = Object.fromEntries(
    FACT_IDS.map((id) => [
      id,
      { status: 'new', medianMs: null, streak: 0, interval: 1, nextDue: null },
    ]),
  ) as Record<string, FactState>
  const q1 = composeSprint({ facts, count: 30, today: '2026-08-04', rand: lcg(1) })
  const q2 = composeSprint({ facts, count: 30, today: '2026-08-04', rand: lcg(1) })
  const q3 = composeSprint({ facts, count: 30, today: '2026-08-04', rand: lcg(2) })
  expect(q1).toEqual(q2) // 같은 시드 → 같은 큐 (결정성)
  // 다른 시드 → 다른 신규 집합. 고정 순서 구현(옛 FACT_ORDER 앞자르기)이면 집합이 같아져 실패한다
  expect(new Set(q1)).not.toEqual(new Set(q3))
})
```

(`lcg`는 이 파일에 이미 있는 시드 고정 난수 헬퍼를 쓴다. 없으면 `simulation.test.ts`의 것을 복사한다 — `function lcg(seed){ let s=seed; return ()=>{ s=(s*1103515245+12345)&0x7fffffff; return s/0x7fffffff } }`.)

기존 왕복·derive·requeue 테스트에서 `FACT_ORDER.slice(...)`로 픽스처를 만들던 곳은 `FACT_IDS.slice(...)`로 바꾼다 — 순서 의미가 없어졌으므로 어떤 부분집합이든 픽스처로 유효하다. "9×9를 가장 빨리 돌아올 식으로" 테스트의 "FACT_ORDER의 처음 fluent 식인 1×1" 주석·기대값은 `FACT_IDS`의 첫 원소 `2×1` 기준으로 고친다.

- [ ] **Step 3: facts 테스트 통과 확인**

Run: `npx vitest run src/engine/facts.test.ts`
Expected: PASS

- [ ] **Step 4: simulation.test.ts 실측 재유도**

81 기반 단언 3곳을 72로 바꾸되, **바닥·상한은 추측하지 말고 재측정한다**:

1. `expect(sim.fluentCounts).toContain(81)` → `toContain(72)`
2. 바닥 75(= 실측 최소 78 − 진폭 3) → 임시 로그로 마지막 40일의 최소·최대를 찍어 같은 공식(최소 − 진폭)으로 재유도, 주석의 실측값 갱신
3. `expect(seen.length).toBe(81)` → `toBe(72)`
4. 굶주림 상한 18(실측 15~16, 결함 주입 20) → 재측정. 풀이 줄었으니 같거나 낮아질 것으로 예상되지만 **측정값이 근거다**. 상한이 바뀌면 주석에 새 실측값·결함 주입값·사유를 기록. 결함 주입값 미만 유지
5. 저성취 점검 테스트(`correctRate 0.45`)의 점검 길이 하한도 재측정 — 풀 축소로 fluent 도달이 빨라져 수치가 움직일 수 있다

Run: `npx vitest run src/engine/simulation.test.ts`
Expected: PASS (재측정 반영 후)

- [ ] **Step 5: 전체 검사 + 변이 검증**

Run: `npm test && npm run build`

변이 검증: `composeSprint`의 `shuffled(...)`를 임시로 제거(정렬된 `FACT_IDS` 그대로)하면 Step 2의 무작위 도입 테스트가 실패하는지 확인 후 원복. 실패하지 않으면 그 테스트는 아무것도 못 잡는 것이다.

- [ ] **Step 6: 커밋**

```bash
git add src/engine/facts.ts src/engine/facts.test.ts src/engine/simulation.test.ts
git commit -m "feat(engine): 구구단 풀을 2×1~9×9로 줄이고 신규 도입을 무작위화한다"
```

---

### Task 2: 풀 개편 — 지도와 리포트 문구

**Files:**

- Modify: `src/screens/fact-map.ts`
- Modify: `src/screens/report.ts` (shareText의 "/81")

**Interfaces:**

- Consumes: `FACT_IDS`(Task 1), `factId`
- Produces: `factMapHtml` 시그니처 불변 — 렌더만 8행×9열

- [ ] **Step 1: fact-map.ts를 풀 상수에서 유도**

하드코딩 1..9 루프를 바꾼다. 행은 2단부터 9단, 열은 ×1부터 ×9:

```ts
/** 풀 경계. FACT_IDS(2×1~9×9)와 함께 움직여야 하므로 여기서 한 번만 정의한다. */
const DAN_MIN = 2
const DAN_MAX = 9

export function factMapHtml(
  facts: Record<string, FactState>,
  newlyFluent: Set<string> = new Set(),
): string {
  const cells: string[] = ['<div class="head">×</div>']
  for (let b = 1; b <= 9; b++) cells.push(`<div class="head">${b}</div>`)

  for (let a = DAN_MIN; a <= DAN_MAX; a++) {
    cells.push(`<div class="head">${a}</div>`)
    for (let b = 1; b <= 9; b++) {
      // (기존 셀 분기 그대로)
    }
  }
  const fluentCount = Object.values(facts).filter((f) => f.status === 'fluent').length
  // ... 범례 그대로 ...
  return `... <div class="factmap-score">${fluentCount} <em>/ 72 칸</em></div>`
}
```

파일 상단 주석의 "81칸"을 "72칸(2단부터 9단 × ×1부터 ×9)"으로 고친다. CSS의 `.factmap` 그리드 열 수가 하드코딩돼 있으면(10열: 헤더+9) 행 수만 줄었으므로 무변경 — 확인만 한다.

- [ ] **Step 2: report.ts 문구**

`shareText`의 `` `구구단 ${w.fluentTotal}/81 정복…` ``을 `/72`로.

- [ ] **Step 3: 검사 + 수동 확인**

Run: `npm test && npm run build`
수동: `npm run dev` → `#/map`이 8행×9열로 그려지는지, 점수가 "/ 72 칸"인지. 서버는 종료.

- [ ] **Step 4: 커밋**

```bash
git add src/screens/fact-map.ts src/screens/report.ts
git commit -m "feat(screens): 구구단 지도를 72칸으로 바꾼다"
```

---

### Task 3: deriveStrategies — 전략 상태 파생

**Files:**

- Modify: `src/data/types.ts` (`StrategyState`에 파생 전용 필드 2개)
- Modify: `src/engine/derive.ts` (`deriveStrategies` 추가)
- Modify: `src/engine/derive.test.ts` (테스트 추가)

**Interfaces:**

- Consumes: `Day`, `StrategyId`(types)
- Produces: `deriveStrategies(days: Day[]): Record<string, StrategyState>` — 키는 등장한 전략 id만. `StrategyState`는 `{ attempts: boolean[]; introducedAt: string | null; appearances: number; lastAppearedAt: string | null }`이 된다

- [ ] **Step 1: types.ts의 StrategyState 확장**

```ts
export type StrategyState = {
  attempts: boolean[]
  introducedAt: string | null
  /** sheet 등장 횟수. 채점 여부와 무관 — 도입 게이트는 노출 페이스 조절이 목적이다. */
  appearances: number
  /** 마지막 등장일. "어제의 방법" 로테이션(가장 오래 안 나온 것)의 근거. */
  lastAppearedAt: string | null
}
```

파생 전용 확장이다 — `Meta.derived`는 아무도 읽지 않고 `emptyDerived()`는 빈 레코드만 만들므로 저장 형태에 영향이 없다(마이그레이션 없음). `emptyDerived`가 `StrategyState`를 직접 생성하지 않는지 확인한다(빈 `{}`라면 무변경).

- [ ] **Step 2: 실패하는 테스트** — `derive.test.ts`에 추가

```ts
describe('deriveStrategies', () => {
  const strat = (date: string, id: string, itemId: string): Day => ({
    date,
    kind: 'normal',
    sheet: [
      {
        id: itemId,
        kind: 'strategy',
        tag: id as StrategyId,
        a: 27,
        b: 15,
        op: '+',
        steps: [{ text: '27 + 3 = {}', blanks: [30] }],
        answer: 42,
      },
    ],
  })

  it('등장·도입일·마지막 등장일을 로그에서 파생한다', () => {
    const days = [
      strat('2026-08-04', 'make-ten', 's1'),
      strat('2026-08-05', 'make-ten', 's1'),
      strat('2026-08-06', 'split-place', 's1'),
    ]
    const s = deriveStrategies(days)
    expect(s['make-ten']).toEqual({
      attempts: [],
      introducedAt: '2026-08-04',
      appearances: 2,
      lastAppearedAt: '2026-08-05',
    })
    expect(s['split-place']!.introducedAt).toBe('2026-08-06')
  })

  it('appearances는 채점과 무관하고 attempts는 채점된 것만 담는다', () => {
    const graded = { ...strat('2026-08-04', 'make-ten', 's1'), grades: { s1: false } }
    const ungraded = strat('2026-08-05', 'make-ten', 's1')
    const s = deriveStrategies([graded, ungraded])
    expect(s['make-ten']!.appearances).toBe(2) // 채점 안 된 날도 등장은 등장
    expect(s['make-ten']!.attempts).toEqual([false]) // 채점된 것만
  })

  it('빈 sheet(스프린트만 한 날)와 다른 kind는 건너뛴다', () => {
    const sprintOnly: Day = { date: '2026-08-04', kind: 'normal', sheet: [], sprint: [] }
    expect(deriveStrategies([sprintOnly])).toEqual({})
  })
})
```

Run: `npx vitest run src/engine/derive.test.ts` — Expected: FAIL (`deriveStrategies` 미정의)

- [ ] **Step 3: 구현** — `derive.ts`에 추가

```ts
/**
 * 로그에서 전략별 상태를 파생한다. deriveTypes와 같은 원칙 — 저장하지 않고 매번 재계산.
 *
 * appearances(등장)와 attempts(채점)를 나눠 세는 이유: 도입 게이트는 숙련 판정이 아니라
 * 노출 페이스 조절이 목적이라, 아빠가 채점을 며칠 밀려도 새 전략 도입이 멈추면 안 된다.
 * days는 날짜 오름차순을 전제한다 — getAllDays()가 그렇게 돌려준다.
 */
export function deriveStrategies(days: Day[]): Record<string, StrategyState> {
  const out: Record<string, StrategyState> = {}
  for (const day of days) {
    for (const item of day.sheet) {
      if (item.kind !== 'strategy') continue
      const state = (out[item.tag] ??= {
        attempts: [],
        introducedAt: day.date,
        appearances: 0,
        lastAppearedAt: null,
      })
      state.appearances += 1
      state.lastAppearedAt = day.date
      const graded = day.grades?.[item.id]
      if (graded !== undefined) state.attempts.push(graded)
    }
  }
  return out
}
```

- [ ] **Step 4: 통과 확인 + 전체 검사**

Run: `npx vitest run src/engine/derive.test.ts && npm test && npm run build`

- [ ] **Step 5: 커밋**

```bash
git add src/data/types.ts src/engine/derive.ts src/engine/derive.test.ts
git commit -m "feat(engine): 전략 상태 파생 deriveStrategies 추가"
```

---

### Task 4: 전략 카탈로그 — 8종의 생성·조건·steps

**Files:**

- Create: `src/engine/strategy.ts`
- Create: `src/engine/strategy.test.ts`

**Interfaces:**

- Consumes: `StrategyId`, `StrategyStep`(types), `randInt`(rand.ts), `carryCount`, `borrowCount`(vertical.ts — 독립 술어로 테스트에서도 쓴다)
- Produces:

```ts
export type StrategyDef = {
  id: StrategyId
  op: '+' | '−' | '×'
  name: string
  gen(rand: () => number): { a: number; b: number }
  applicable(a: number, b: number): boolean
  steps(a: number, b: number): StrategyStep[]
}
export const STRATEGY_CATALOG: StrategyDef[] // 배열 순서 = 도입 순서
export const STRATEGY_NAMES: Record<string, string> // id → 이름 (grade.ts가 씀)
export const MUL_STRATEGY_MIN_FLUENT = 10
```

- [ ] **Step 1: 실패하는 테스트** — `strategy.test.ts`

각 전략의 성질을 **독립 술어**로 검사한다. `gen`이 만든 값을 같은 `applicable`로 재검사하면 자기검사다 — 대신 `carryCount`/`borrowCount`/직접 산술로 확인한다.

```ts
import { describe, it, expect } from 'vitest'
import { STRATEGY_CATALOG, STRATEGY_NAMES, MUL_STRATEGY_MIN_FLUENT } from './strategy'
import { carryCount, borrowCount } from './vertical'

function lcg(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return s / 0x7fffffff
  }
}
const byId = Object.fromEntries(STRATEGY_CATALOG.map((s) => [s.id, s]))

describe('카탈로그 공통 성질', () => {
  it('8종이 스펙 도입 순서대로 있다', () => {
    expect(STRATEGY_CATALOG.map((s) => s.id)).toEqual([
      'make-ten',
      'split-place',
      'round-adjust',
      'split-subtrahend',
      'anchor',
      'count-up',
      'double',
      'minus-one',
    ])
  })

  it('모든 전략: steps의 마지막 빈칸이 최종 답이고, 각 빈칸 수는 자리에 맞는 산술 결과다', () => {
    const rand = lcg(7)
    for (const def of STRATEGY_CATALOG) {
      for (let i = 0; i < 50; i++) {
        const { a, b } = def.gen(rand)
        const steps = def.steps(a, b)
        const answer = def.op === '+' ? a + b : def.op === '−' ? a - b : a * b
        const last = steps[steps.length - 1]!
        // 마지막 step의 마지막 빈칸 = 최종 답 (채점 계약)
        expect(last.blanks[last.blanks.length - 1], `${def.id} ${a}${def.op}${b}`).toBe(answer)
        // 각 step의 {} 개수와 blanks 길이가 일치 — 렌더러 계약
        for (const st of steps) {
          expect((st.text.match(/\{\}/g) ?? []).length, `${def.id}: ${st.text}`).toBe(
            st.blanks.length,
          )
        }
      }
    }
  })

  it('applicable은 gen이 만든 수 조합에 참이다 (조건-생성기 정합)', () => {
    const rand = lcg(11)
    for (const def of STRATEGY_CATALOG) {
      for (let i = 0; i < 50; i++) {
        const { a, b } = def.gen(rand)
        expect(def.applicable(a, b), `${def.id} ${a},${b}`).toBe(true)
      }
    }
  })

  it('STRATEGY_NAMES는 8종 전부의 비어 있지 않은 한국어 이름을 담는다', () => {
    for (const def of STRATEGY_CATALOG) {
      expect(typeof STRATEGY_NAMES[def.id], def.id).toBe('string')
      expect(STRATEGY_NAMES[def.id]!.length, def.id).toBeGreaterThan(0)
    }
  })
})
```

전략별 강한 조건 — 독립 술어 사용이 핵심이다:

```ts
describe('전략별 강한 조건 (독립 술어)', () => {
  const rand = lcg(23)
  const many = (id: string) => Array.from({ length: 80 }, () => byId[id]!.gen(rand))

  it('make-ten: 받아올림 있는 두 자리 덧셈, 보수 이동이 성립한다', () => {
    for (const { a, b } of many('make-ten')) {
      expect(a).toBeGreaterThanOrEqual(11)
      expect(b).toBeLessThanOrEqual(89)
      expect(carryCount(a, b)).toBeGreaterThanOrEqual(1) // 받아올림 없으면 10 만들 이유가 없다
      expect((a % 10) + (b % 10)).toBeGreaterThan(10) // b에서 옮길 몫이 1 이상 남아야 한다
    }
  })

  it('split-place: 받아내림 없는 두 자리 뺄셈', () => {
    for (const { a, b } of many('split-place')) {
      expect(a).toBeGreaterThan(b)
      expect(borrowCount(a, b)).toBe(0)
      expect(Math.floor(b / 10)).toBeGreaterThanOrEqual(1) // 십의 자리가 있어야 자리로 나눈다
    }
  })

  it('round-adjust: 더하는 수의 일의 자리가 8·9', () => {
    for (const { b } of many('round-adjust')) expect([8, 9]).toContain(b % 10)
  })

  it('split-subtrahend: 빼는 수가 두 자리이고 일의 자리가 0이 아니다', () => {
    for (const { a, b } of many('split-subtrahend')) {
      expect(a).toBeGreaterThan(b)
      expect(b).toBeGreaterThanOrEqual(11)
      expect(b % 10).not.toBe(0) // 0이면 두 번째 단계가 "−0"이 된다
    }
  })

  it('anchor: 빼는 수의 일의 자리가 9', () => {
    for (const { a, b } of many('anchor')) {
      expect(b % 10).toBe(9)
      expect(a).toBeGreaterThan(b + 1) // b+1을 먼저 빼므로
    }
  })

  it('count-up: 두 수가 가깝고(차 15 이하) b가 10의 배수가 아니다', () => {
    for (const { a, b } of many('count-up')) {
      expect(a - b).toBeGreaterThanOrEqual(3)
      expect(a - b).toBeLessThanOrEqual(15)
      expect(b % 10).not.toBe(0)
      expect(Math.ceil(b / 10) * 10).toBeLessThan(a) // 중간 정거장(다음 10)이 a 앞에 있어야 한다
    }
  })

  it('double: 곱하는 수가 4 이상의 짝수', () => {
    for (const { a, b } of many('double')) {
      expect(a).toBeGreaterThanOrEqual(2)
      expect(a).toBeLessThanOrEqual(9)
      expect(b % 2).toBe(0)
      expect(b).toBeGreaterThanOrEqual(4) // b=2면 "절반 후 두 배"가 ×1 경유라 무의미
    }
  })

  it('minus-one: 곱하는 수가 9', () => {
    for (const { a, b } of many('minus-one')) {
      expect(b).toBe(9)
      expect(a).toBeGreaterThanOrEqual(2)
    }
  })
})
```

steps 산술 스팟 체크 — 스펙 표의 예시 그대로:

```ts
describe('steps 예시 (스펙 §3 표)', () => {
  it('make-ten 27+15', () => {
    expect(byId['make-ten']!.steps(27, 15)).toEqual([
      { text: '27 + 3 = {}', blanks: [30] },
      { text: '30 + 12 = {}', blanks: [42] },
    ])
  })
  it('split-place 68−25', () => {
    expect(byId['split-place']!.steps(68, 25)).toEqual([
      { text: '60 − 20 = {}', blanks: [40] },
      { text: '8 − 5 = {}', blanks: [3] },
      { text: '합치면  68 − 25 = {}', blanks: [43] },
    ])
  })
  it('anchor 52−19', () => {
    expect(byId['anchor']!.steps(52, 19)).toEqual([
      { text: '52 − 20 = {}', blanks: [32] },
      { text: '32 + 1 = {}', blanks: [33] },
    ])
  })
  it('count-up 62−58 — applicable 영역 안의 근접 쌍 (63−28은 차 35라 gen이 만들지 않는다)', () => {
    expect(byId['count-up']!.steps(62, 58)).toEqual([
      { text: '58에서 60까지 {}', blanks: [2] },
      { text: '60에서 62까지 {}', blanks: [2] },
      { text: '합치면 {}', blanks: [4] },
    ])
  })
  it('double 7×8 — 두 배 step은 덧셈 표기다', () => {
    expect(byId['double']!.steps(7, 8)).toEqual([
      { text: '7 × 4 = {}', blanks: [28] },
      { text: '28 + 28 = {}', blanks: [56] },
    ])
  })
  it('minus-one 7×9 — 첫 step은 묶어 세기 표기다', () => {
    expect(byId['minus-one']!.steps(7, 9)).toEqual([
      { text: '10씩 7묶음 = {}', blanks: [70] },
      { text: '70 − 7 = {}', blanks: [63] },
    ])
  })
  it('round-adjust 27+19', () => {
    expect(byId['round-adjust']!.steps(27, 19)).toEqual([
      { text: '27 + 20 = {}', blanks: [47] },
      { text: '47 − 1 = {}', blanks: [46] },
    ])
  })
  it('split-subtrahend 63−28', () => {
    expect(byId['split-subtrahend']!.steps(63, 28)).toEqual([
      { text: '63 − 20 = {}', blanks: [43] },
      { text: '43 − 8 = {}', blanks: [35] },
    ])
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/engine/strategy.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현** — `src/engine/strategy.ts`

```ts
import type { StrategyId, StrategyStep } from '../data/types'
import { randInt } from './rand'
import { carryCount, borrowCount } from './vertical'

/**
 * 전략 카탈로그(설계 §6.4, 스펙 §3). 배열 순서가 곧 도입 순서다.
 *
 * 렌더러·채점·리포트는 이 카탈로그의 내부를 모른다 — steps의 {}와 blanks만 안다.
 * 새 전략 추가 = 항목 추가. 인쇄 코드는 손대지 않는다.
 *
 * 도입 순서의 근거: make-ten은 2-1 교과의 핵심이라 이미 친숙하다(첫 성공 경험 —
 * Phase 2가 1단을 앞세웠던 것과 같은 원리). 덧셈·뺄셈을 교차시키고, 발상 전환이
 * 큰 count-up("빼기를 채우기로")은 뒤로. 곱셈 2종은 fluent 게이트 뒤에 있다.
 * 순서를 바꾸는 비용은 낮다 — "다음에 무엇을 꺼낼지"만 정한다.
 */
export type StrategyDef = {
  id: StrategyId
  op: '+' | '−' | '×'
  name: string
  gen(rand: () => number): { a: number; b: number }
  applicable(a: number, b: number): boolean
  steps(a: number, b: number): StrategyStep[]
}

/** 곱셈 전략(double·minus-one)이 열리는 fluent 최소치. 구구단표가 머리에 없으면
 *  7×4×2는 우회로가 아니라 짐이다 — CHECKUP_MIN_FLUENT(checkup.ts)와 같은 발상. */
export const MUL_STRATEGY_MIN_FLUENT = 10

const MAX_ATTEMPTS = 2000

/** applicable을 만족할 때까지 기각 표집한다. vertical.ts의 generateVertical과 같은 방식. */
function sample(
  def: Pick<StrategyDef, 'applicable'>,
  lo: number,
  hi: number,
  rand: () => number,
  shape?: (x: number, y: number) => { a: number; b: number },
): { a: number; b: number } {
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const x = randInt(lo, hi, rand)
    const y = randInt(lo, hi, rand)
    const { a, b } = shape ? shape(x, y) : { a: x, b: y }
    if (def.applicable(a, b)) return { a, b }
  }
  throw new Error(`전략 생성 실패: 표집 한도 초과`)
}

export const STRATEGY_CATALOG: StrategyDef[] = [
  {
    id: 'make-ten',
    op: '+',
    name: '10 만들어 더하기',
    applicable: (a, b) =>
      a >= 11 && a <= 89 && b >= 11 && b <= 89 && carryCount(a, b) >= 1 && (a % 10) + (b % 10) > 10,
    gen(rand) {
      return sample(this, 11, 89, rand)
    },
    steps(a, b) {
      const c = 10 - (a % 10) // a를 다음 10으로 채우는 보수
      return [
        { text: `${a} + ${c} = {}`, blanks: [a + c] },
        { text: `${a + c} + ${b - c} = {}`, blanks: [a + b] },
      ]
    },
  },
  {
    id: 'split-place',
    op: '−',
    name: '자리로 나누어 빼기',
    applicable: (a, b) => a > b && b >= 11 && a <= 99 && borrowCount(a, b) === 0,
    gen(rand) {
      return sample(this, 11, 99, rand, (x, y) => ({ a: Math.max(x, y), b: Math.min(x, y) }))
    },
    steps(a, b) {
      const a10 = Math.floor(a / 10) * 10
      const b10 = Math.floor(b / 10) * 10
      return [
        { text: `${a10} − ${b10} = {}`, blanks: [a10 - b10] },
        { text: `${a % 10} − ${b % 10} = {}`, blanks: [(a % 10) - (b % 10)] },
        { text: `합치면  ${a} − ${b} = {}`, blanks: [a - b] },
      ]
    },
  },
  {
    id: 'round-adjust',
    op: '+',
    name: '어림하고 고치기',
    applicable: (a, b) => a >= 11 && a <= 89 && b >= 18 && b <= 89 && [8, 9].includes(b % 10),
    gen(rand) {
      return sample(this, 11, 89, rand)
    },
    steps(a, b) {
      const r = 10 - (b % 10) // 1 또는 2
      return [
        { text: `${a} + ${b + r} = {}`, blanks: [a + b + r] },
        { text: `${a + b + r} − ${r} = {}`, blanks: [a + b] },
      ]
    },
  },
  {
    id: 'split-subtrahend',
    op: '−',
    name: '빼는 수 가르기',
    applicable: (a, b) => a > b && b >= 11 && b <= 89 && a <= 99 && b % 10 !== 0,
    gen(rand) {
      return sample(this, 11, 99, rand, (x, y) => ({ a: Math.max(x, y), b: Math.min(x, y) }))
    },
    steps(a, b) {
      const b10 = Math.floor(b / 10) * 10
      return [
        { text: `${a} − ${b10} = {}`, blanks: [a - b10] },
        { text: `${a - b10} − ${b % 10} = {}`, blanks: [a - b] },
      ]
    },
  },
  {
    id: 'anchor',
    op: '−',
    name: '기준수 만들어 빼기',
    applicable: (a, b) => b % 10 === 9 && b >= 9 && a > b + 1 && a <= 99,
    gen(rand) {
      return sample(this, 9, 99, rand, (x, y) => ({ a: Math.max(x, y), b: Math.min(x, y) }))
    },
    steps(a, b) {
      return [
        { text: `${a} − ${b + 1} = {}`, blanks: [a - b - 1] },
        { text: `${a - b - 1} + 1 = {}`, blanks: [a - b] },
      ]
    },
  },
  {
    id: 'count-up',
    op: '−',
    name: '채워 세기',
    applicable: (a, b) => {
      const next10 = Math.ceil(b / 10) * 10
      return a - b >= 3 && a - b <= 15 && b % 10 !== 0 && next10 < a && b >= 11
    },
    gen(rand) {
      return sample(this, 11, 99, rand, (x, y) => ({ a: Math.max(x, y), b: Math.min(x, y) }))
    },
    steps(a, b) {
      const next10 = Math.ceil(b / 10) * 10
      return [
        { text: `${b}에서 ${next10}까지 {}`, blanks: [next10 - b] },
        { text: `${next10}에서 ${a}까지 {}`, blanks: [a - next10] },
        { text: `합치면 {}`, blanks: [a - b] },
      ]
    },
  },
  {
    id: 'double',
    op: '×',
    name: '두 배 하기',
    applicable: (a, b) => a >= 2 && a <= 9 && b % 2 === 0 && b >= 4 && b <= 9,
    gen(rand) {
      return sample(this, 2, 9, rand)
    },
    steps(a, b) {
      // 두 배 step은 덧셈으로 찍는다 — 두 자리 × 한 자리 표기는 3-1이라 배운 적 없는 형식이다(스펙 §3)
      const half = a * (b / 2)
      return [
        { text: `${a} × ${b / 2} = {}`, blanks: [half] },
        { text: `${half} + ${half} = {}`, blanks: [a * b] },
      ]
    },
  },
  {
    id: 'minus-one',
    op: '×',
    name: '하나 빼기',
    applicable: (a, b) => b === 9 && a >= 2 && a <= 9,
    gen(rand) {
      return sample(this, 2, 9, rand, (x) => ({ a: x, b: 9 }))
    },
    steps(a, _b) {
      // 10단은 곱셈구구 밖 — 같은 값을 2-1 묶어 세기 표기로 묻는다(스펙 §3)
      return [
        { text: `10씩 ${a}묶음 = {}`, blanks: [10 * a] },
        { text: `${10 * a} − ${a} = {}`, blanks: [9 * a] },
      ]
    },
  },
]

export const STRATEGY_NAMES: Record<string, string> = Object.fromEntries(
  STRATEGY_CATALOG.map((s) => [s.id, s.name]),
)
```

- [ ] **Step 4: 통과 확인 + 전체 검사**

Run: `npx vitest run src/engine/strategy.test.ts && npm test && npm run build`

주의: `anchor`의 `steps` 예시(52−19)와 `applicable(b >= 9)`가 맞물리는지, `round-adjust`의 `b >= 18` 하한이 예시(b=19)와 맞는지 산술을 손으로 검산할 것. 테스트가 곧 검산이다.

- [ ] **Step 5: 커밋**

```bash
git add src/engine/strategy.ts src/engine/strategy.test.ts
git commit -m "feat(engine): 전략 8종 카탈로그 — 생성·조건·빈칸 뼈대"
```

---

### Task 5: 전략 선택 — 도입 게이트·로테이션·같은 수식

**Files:**

- Modify: `src/engine/strategy.ts` (`composeStrategyItems` 추가)
- Modify: `src/engine/strategy.test.ts` (테스트 추가)

**Interfaces:**

- Consumes: `STRATEGY_CATALOG`, `MUL_STRATEGY_MIN_FLUENT`(Task 4), `deriveStrategies` 결과(Task 3), `FactState`(types)
- Produces:

```ts
export function composeStrategyItems(input: {
  strategies: Record<string, StrategyState> // deriveStrategies 결과
  facts: Record<string, FactState> // 곱셈 게이트용
  rand: () => number
  seen: Set<string> // compose 공유 중복 집합. 키 형식: `${a}${op}${b}` (compose.ts와 동일)
}): StrategyItem[] // 항상 2개, id 's1'·'s2'
```

- [ ] **Step 1: 실패하는 테스트** — `strategy.test.ts`에 추가

```ts
import { composeStrategyItems } from './strategy'
import type { FactState, StrategyState } from '../data/types'

const NO_FACTS: Record<string, FactState> = {}
const fluent = (n: number): Record<string, FactState> =>
  Object.fromEntries(
    Array.from({ length: n }, (_, i) => [
      `${2 + (i % 8)}×${1 + Math.floor(i / 8)}`,
      { status: 'fluent', medianMs: 900, streak: 3, interval: 7, nextDue: '2026-09-01' },
    ]),
  )
const st = (introducedAt: string, appearances: number, lastAppearedAt: string): StrategyState => ({
  attempts: [],
  introducedAt,
  appearances,
  lastAppearedAt,
})

describe('composeStrategyItems', () => {
  it('첫날: 아무 전략도 도입 전이면 make-ten 2문항', () => {
    const items = composeStrategyItems({
      strategies: {},
      facts: NO_FACTS,
      rand: lcg(3),
      seen: new Set(),
    })
    expect(items).toHaveLength(2)
    expect(items.map((i) => i.tag)).toEqual(['make-ten', 'make-ten'])
    expect(items.map((i) => i.id)).toEqual(['s1', 's2'])
  })

  it('등장 3회 게이트: 2회면 새 전략이 안 열리고, 3회면 열린다', () => {
    const base = { facts: NO_FACTS, rand: lcg(5), seen: new Set<string>() }
    const at2 = composeStrategyItems({
      ...base,
      strategies: { 'make-ten': st('2026-08-04', 2, '2026-08-05') },
    })
    expect(at2[0]!.tag).toBe('make-ten') // 아직 최신이 make-ten

    const at3 = composeStrategyItems({
      ...base,
      seen: new Set(),
      strategies: { 'make-ten': st('2026-08-04', 3, '2026-08-06') },
    })
    expect(at3[0]!.tag).toBe('split-place') // 다음 전략이 오늘의 방법으로
    expect(at3[1]!.tag).toBe('make-ten') // 이전 것은 어제의 방법으로
  })

  it('어제의 방법은 가장 오래 안 나온 전략이다 — 항상-첫-전략 구현은 실패한다', () => {
    const items = composeStrategyItems({
      strategies: {
        'make-ten': st('2026-08-04', 5, '2026-08-10'), // 최근에 나옴
        'split-place': st('2026-08-07', 4, '2026-08-08'), // 가장 오래 안 나옴 ← 정답
        'round-adjust': st('2026-08-09', 2, '2026-08-09'), // 최신 (오늘의 방법)
      },
      facts: NO_FACTS,
      rand: lcg(9),
      seen: new Set(),
    })
    expect(items[0]!.tag).toBe('round-adjust')
    expect(items[1]!.tag).toBe('split-place') // make-ten(첫 전략)이면 그럴듯한 오답
  })

  it('곱셈 게이트: 6종을 다 돌아도 fluent 9개면 double이 안 열리고, 10개면 열린다', () => {
    const sixDone = {
      'make-ten': st('2026-08-04', 9, '2026-08-20'),
      'split-place': st('2026-08-07', 8, '2026-08-21'),
      'round-adjust': st('2026-08-10', 7, '2026-08-22'),
      'split-subtrahend': st('2026-08-13', 6, '2026-08-23'),
      anchor: st('2026-08-16', 5, '2026-08-24'),
      'count-up': st('2026-08-19', 3, '2026-08-25'),
    }
    const at9 = composeStrategyItems({
      strategies: sixDone,
      facts: fluent(9),
      rand: lcg(13),
      seen: new Set(),
    })
    // 게이트 대기 = 정착기: 문항1도 로테이션한다(count-up 고정이면 그럴듯한 오답)
    expect(at9[0]!.tag).toBe('make-ten') // 가장 오래 안 나옴 (08-20)
    expect(at9[1]!.tag).toBe('split-place') // 그다음 (08-21)

    const at10 = composeStrategyItems({
      strategies: sixDone,
      facts: fluent(10),
      rand: lcg(13),
      seen: new Set(),
    })
    expect(at10[0]!.tag).toBe('double')
  })

  it('정착기: 8종 완료 후 문항1은 최신(minus-one) 고정이 아니라 로테이션한다', () => {
    const allDone = {
      'make-ten': st('2026-08-04', 9, '2026-09-02'),
      'split-place': st('2026-08-07', 8, '2026-09-03'),
      'round-adjust': st('2026-08-10', 7, '2026-09-04'),
      'split-subtrahend': st('2026-08-13', 6, '2026-09-05'),
      anchor: st('2026-08-16', 5, '2026-08-30'), // 가장 오래 안 나옴 ← 문항1
      'count-up': st('2026-08-19', 4, '2026-08-31'), // 그다음 ← 문항2
      double: st('2026-08-22', 4, '2026-09-06'),
      'minus-one': st('2026-08-25', 3, '2026-09-07'), // 최신 — 여기 고정되면 그럴듯한 오답
    }
    const items = composeStrategyItems({
      strategies: allDone,
      facts: fluent(20),
      rand: lcg(21),
      seen: new Set(),
    })
    expect(items[0]!.tag).toBe('anchor')
    expect(items[1]!.tag).toBe('count-up')
  })

  it('생성물이 seen에 등록되고, 이미 있는 수식은 피한다', () => {
    const seen = new Set<string>()
    const items = composeStrategyItems({ strategies: {}, facts: NO_FACTS, rand: lcg(17), seen })
    for (const it of items) {
      expect(seen.has(`${it.a}${it.op}${it.b}`)).toBe(true)
    }
    // 두 문항이 같은 수식을 쓰는 경우는 "같은 수식 두 방법"(전략이 다를 때)뿐이다.
    // 여기서는 둘 다 make-ten이므로 반드시 다른 수식이어야 한다.
    expect(`${items[0]!.a}+${items[0]!.b}`).not.toBe(`${items[1]!.a}+${items[1]!.b}`)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/engine/strategy.test.ts`
Expected: FAIL — `composeStrategyItems` 미정의

- [ ] **Step 3: 구현** — `strategy.ts`에 추가

```ts
import type { FactState, StrategyItem, StrategyState } from '../data/types'

/** 같은 수식 두 방법 배치 확률(설계 §6.4 "섞는다"). 낮게 — 매일이면 패턴이 되어 신선함이 죽는다. */
const SAME_EXPR_CHANCE = 0.2

/**
 * 그날 전략 2문항. 문항1 = 오늘의 방법(최신 도입, 게이트 통과 시 새 전략),
 * 문항2 = 어제의 방법(이전 도입 중 가장 오래 안 나온 것 — 유지 복습).
 * 다음 도입이 없으면(8종 완료·곱셈 게이트 대기) 정착기 — 문항1도 로테이션한다.
 *
 * 게이트는 등장 횟수다(숙련이 아니라 노출 페이스 조절 — 채점이 밀려도 멈추지 않는다).
 * 곱셈 전략은 fluent가 MUL_STRATEGY_MIN_FLUENT 미만이면 열리지 않는다 — 그 앞에서
 * 도입이 멈추고 기존 전략들로 로테이션한다.
 */
export function composeStrategyItems(input: {
  strategies: Record<string, StrategyState>
  facts: Record<string, FactState>
  rand: () => number
  seen: Set<string>
}): StrategyItem[] {
  const { strategies, facts, rand, seen } = input
  const fluentCount = Object.values(facts).filter((f) => f.status === 'fluent').length

  const introduced = STRATEGY_CATALOG.filter((s) => strategies[s.id]?.introducedAt)
  const latest = introduced[introduced.length - 1]

  const oldestOf = (defs: StrategyDef[]): StrategyDef =>
    defs.reduce((oldest, s) =>
      (strategies[s.id]!.lastAppearedAt ?? '') < (strategies[oldest.id]!.lastAppearedAt ?? '')
        ? s
        : oldest,
    )

  let today: StrategyDef
  if (!latest) {
    today = STRATEGY_CATALOG[0]!
  } else if ((strategies[latest.id]!.appearances ?? 0) >= 3) {
    const next = STRATEGY_CATALOG[STRATEGY_CATALOG.indexOf(latest) + 1]
    const gated = next && next.op === '×' && fluentCount < MUL_STRATEGY_MIN_FLUENT
    // 정착기: 열 것이 없으면(8종 완료 또는 곱셈 게이트 대기) 문항1도 로테이션한다.
    // 이 분기가 latest로 남으면 문항1이 영원히 최신 전략에 고정된다(스펙 §3).
    today = next && !gated ? next : oldestOf(introduced)
  } else {
    today = latest
  }

  // 어제의 방법: 오늘 전략을 뺀 도입 전략 중 lastAppearedAt이 가장 오래된 것.
  const pool = introduced.filter((s) => s.id !== today.id)
  const review = pool.length > 0 ? oldestOf(pool) : today

  const first = genAvoiding(today, rand, seen)
  let second: { a: number; b: number }
  if (
    review.id !== today.id &&
    review.op === today.op &&
    review.applicable(first.a, first.b) &&
    rand() < SAME_EXPR_CHANCE
  ) {
    // 같은 수식 두 방법 — 답이 똑같이 나오는 것을 눈으로 본다(설계 §6.4).
    second = { a: first.a, b: first.b }
  } else {
    second = genAvoiding(review, rand, seen)
  }

  const make = (def: StrategyDef, ab: { a: number; b: number }, id: string): StrategyItem => ({
    id,
    kind: 'strategy',
    tag: def.id,
    a: ab.a,
    b: ab.b,
    op: def.op,
    steps: def.steps(ab.a, ab.b),
    answer: def.op === '+' ? ab.a + ab.b : def.op === '−' ? ab.a - ab.b : ab.a * ab.b,
  })
  return [make(today, first, 's1'), make(review, second, 's2')]
}

/** seen에 없는 수 조합을 뽑는다. 몇 번 부딪히면 폴백(split-subtrahend — 원문 "언제나 안전"). */
function genAvoiding(
  def: StrategyDef,
  rand: () => number,
  seen: Set<string>,
): { a: number; b: number } {
  for (let i = 0; i < 20; i++) {
    try {
      const ab = def.gen(rand)
      const key = `${ab.a}${def.op}${ab.b}`
      if (seen.has(key)) continue
      seen.add(key)
      return ab
    } catch {
      break // 표집 실패 → 폴백
    }
  }
  const fallback = STRATEGY_CATALOG.find((s) => s.id === 'split-subtrahend')!
  const ab = fallback.gen(rand)
  seen.add(`${ab.a}${fallback.op}${ab.b}`)
  return ab
}
```

**타입 확장 (이 Step의 첫 작업)**: `types.ts`의 `StrategyItem.op`가 `'+' | '−'`로 닫혀 있다 — 곱셈 전략에 `'×'`가 필요하므로 **먼저 `StrategyItem.op`를 `'+' | '−' | '×'`로 넓힌 뒤** 위 코드를 넣는다(위 `op: def.op`는 확장 후에만 컴파일된다). 저장 필드지만 유니온 확장은 기존 데이터를 전부 통과시키므로 마이그레이션 없음. `backup.ts`의 sheet 검증은 `id`+`kind`만 보므로 무관하다.

폴백이 `genAvoiding` 안에서 다시 실패하면 예외가 위로 전파된다 — `composeSheet` 호출자는 화면(try 안)이고, `split-subtrahend`의 조건은 두 자리 뺄셈 전수의 상당 부분이라 실전에서 소진 불가. 주석으로 남긴다.

- [ ] **Step 4: 통과 확인 + 전체 검사 + 변이 검증**

Run: `npx vitest run src/engine/strategy.test.ts && npm test && npm run build`

변이 검증 2건 (각각 임시 변경 → 해당 테스트 실패 확인 → 원복):

1. 로테이션의 `reduce`를 `pool[0]`으로 바꾸면 "가장 오래 안 나온 전략" 테스트가 실패해야 한다
2. 게이트 조건에서 `fluentCount < MUL_STRATEGY_MIN_FLUENT`를 제거하면 곱셈 게이트 테스트(9개 케이스)가 실패해야 한다
3. 정착기 분기를 `today = latest`로 되돌리면 정착기(8종 완료) 테스트와 곱셈 게이트 대기 테스트가 실패해야 한다

- [ ] **Step 5: 커밋**

```bash
git add src/engine/strategy.ts src/engine/strategy.test.ts src/data/types.ts
git commit -m "feat(engine): 전략 도입 게이트·로테이션·같은 수식 배치"
```

---

### Task 6: 문장제 — 템플릿·조사·이름 규칙

**Files:**

- Create: `src/engine/word.ts`
- Create: `src/engine/word.test.ts`

**Interfaces:**

- Consumes: `Settings`(childName·friendNames), `WordItem`(types), `randInt`(rand.ts)
- Produces:

```ts
export function composeWordItems(input: {
  settings: Settings
  rand: () => number
  seen: Set<string> // 수식 키 `${a}×${b}` 공유 + 내부적으로 소재/인물 키
}): WordItem[] // 항상 2개, id 'w1'(mul-group, needsDrawing)·'w2'(mul-times)
export function josa(word: string, pair: '이/가' | '은/는' | '을/를'): string // 테스트용 export
```

- [ ] **Step 1: 실패하는 테스트** — `word.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { composeWordItems, josa } from './word'
import { DEFAULT_SETTINGS } from '../data/types'
import type { Settings } from '../data/types'

function lcg(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return s / 0x7fffffff
  }
}
const settings: Settings = { ...DEFAULT_SETTINGS, childName: '서연', friendNames: ['지호', '민아'] }

describe('josa', () => {
  it('받침 있는 이름과 없는 이름 양쪽', () => {
    expect(josa('서연', '이/가')).toBe('서연이')
    expect(josa('민아', '이/가')).toBe('민아가')
    expect(josa('지호', '은/는')).toBe('지호는')
    expect(josa('서연', '은/는')).toBe('서연은')
    expect(josa('사탕', '을/를')).toBe('사탕을')
    expect(josa('색종이', '을/를')).toBe('색종이를')
  })
})

describe('composeWordItems', () => {
  it('묶어 세기(그림 칸) 1 + 몇 배 1, id는 w1·w2', () => {
    const items = composeWordItems({ settings, rand: lcg(1), seen: new Set() })
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({ id: 'w1', tag: 'mul-group', needsDrawing: true })
    expect(items[1]).toMatchObject({ id: 'w2', tag: 'mul-times', needsDrawing: false })
  })

  it('expression과 answer가 일치하고 수 범위를 지킨다 (몇 배의 배수는 2~5)', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const [group, times] = composeWordItems({ settings, rand: lcg(seed), seen: new Set() })
      for (const it of [group!, times!]) {
        const m = /^([2-9])×([2-9])$/.exec(it.expression)
        expect(m, it.expression).not.toBeNull()
        expect(Number(m![1]) * Number(m![2])).toBe(it.answer)
      }
      // 몇 배: expression은 `기준량×배수`이고 배수(뒤)는 2~5
      const mult = Number(times!.expression.split('×')[1])
      expect(mult).toBeGreaterThanOrEqual(2)
      expect(mult).toBeLessThanOrEqual(5)
    }
  })

  it('하루 두 문항 중 하나엔 반드시 딸 이름이 들어간다', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const items = composeWordItems({ settings, rand: lcg(seed), seen: new Set() })
      expect(
        items.some((it) => it.text.includes('서연')),
        `seed ${seed}`,
      ).toBe(true)
    }
  })

  it('두 문항이 같은 곱셈식을 쓰지 않고, seen의 기존 수식을 피한다', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const seen = new Set<string>(['3×4']) // 전략 존이 이미 3×4를 쓴 날이라고 치자
      const [g, t] = composeWordItems({ settings, rand: lcg(seed), seen })
      expect(g!.expression).not.toBe(t!.expression)
      expect(g!.expression).not.toBe('3×4')
      expect(t!.expression).not.toBe('3×4')
    }
  })

  it('수사+단위 직결 문구("2주머니")가 없다', () => {
    for (let seed = 1; seed <= 60; seed++) {
      for (const it of composeWordItems({ settings, rand: lcg(seed), seen: new Set() })) {
        // 숫자 뒤에 담는 단위가 바로 붙는 패턴 금지 — "봉지 3개" 형태만 허용
        expect(it.text, `seed ${seed}: ${it.text}`).not.toMatch(
          /\d(봉지|주머니|필통|접시|묶음|상자|줄)/,
        )
      }
    }
  })

  it('unit이 답 칸 단위로 들어 있다', () => {
    const [g, t] = composeWordItems({ settings, rand: lcg(2), seen: new Set() })
    expect(g!.unit.length).toBeGreaterThan(0)
    expect(t!.unit.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/engine/word.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현** — `src/engine/word.ts`

브레인스토밍 시뮬레이션에서 검증한 구조를 옮긴다. 요지: 소재 목록(이름·세는 단위·담는 단위), 한글 받침 조사, 태그당 문형 4개(소재 슬롯형 + 활동형), 몇 배의 배수 2~5, 하루 한 문항 이상 딸 이름.

```ts
import type { Settings, WordItem } from '../data/types'
import { randInt } from './rand'

/**
 * 문장제(설계 §6.5, 스펙 §4). 텍스트는 생성 시점에 완성되어 sheet에 박제된다 —
 * 이름을 나중에 바꿔도 이미 만든 날의 문제지는 변하지 않는다(재인쇄 불변식).
 */

/** 받침 유무로 조사를 고른다. 마지막 글자가 한글 음절이 아니면 받침 있음으로 취급. */
export function josa(word: string, pair: '이/가' | '은/는' | '을/를'): string {
  const code = word.charCodeAt(word.length - 1)
  const isHangul = code >= 0xac00 && code <= 0xd7a3
  const batchim = !isHangul || (code - 0xac00) % 28 !== 0
  const [w, wo] = pair.split('/') as [string, string]
  return word + (batchim ? w : wo)
}

type Goods = { n: string; unit: string; pack: string }
const GOODS: Goods[] = [
  { n: '사탕', unit: '개', pack: '봉지' },
  { n: '구슬', unit: '개', pack: '주머니' },
  { n: '연필', unit: '자루', pack: '필통' },
  { n: '딸기', unit: '개', pack: '접시' },
  { n: '색종이', unit: '장', pack: '묶음' },
  { n: '쿠키', unit: '개', pack: '상자' },
  { n: '귤', unit: '개', pack: '봉지' },
  { n: '스티커', unit: '장', pack: '줄' },
]

// 소재 슬롯형은 (인물, 소재, 묶음수 a, 낱개수 b)를 받는다. 수사+단위 직결 금지 —
// "봉지 3개" 형태로만 쓴다(시뮬레이션이 "3봉지"의 부자연을 잡았다).
type GroupTpl = { text(p: string, g: Goods, a: number, b: number): string; key(g: Goods): string }
const GROUP_TEMPLATES: GroupTpl[] = [
  {
    key: (g) => g.n,
    text: (p, g, a, b) =>
      `${josa(p, '이/가')} ${josa(g.n, '을/를')} ${g.pack} 한 개에 ${b}${g.unit}씩 담았더니 ${g.pack} ${a}개가 되었어요. ${josa(g.n, '은/는')} 모두 몇 ${g.unit}일까요?`,
  },
  {
    key: (g) => g.n,
    text: (p, g, a, b) =>
      `${g.pack} 한 개에 ${josa(g.n, '이/가')} ${b}${g.unit}씩 들어 있어요. ${g.pack} ${a}개에는 모두 몇 ${g.unit} 들어 있을까요?`,
  },
  {
    key: (g) => g.n,
    text: (p, g, a, b) =>
      `${josa(p, '이/가')} 친구들에게 ${josa(g.n, '을/를')} ${b}${g.unit}씩 나누어 주려고 해요. 친구가 ${a}명이라면 ${josa(g.n, '이/가')} 모두 몇 ${g.unit} 필요할까요?`,
  },
  {
    key: (g) => g.n,
    text: (p, g, a, b) =>
      `${josa(p, '은/는')} 하루에 ${josa(g.n, '을/를')} ${b}${g.unit}씩 먹어요. ${a}일 동안 모두 몇 ${g.unit} 먹을까요?`,
  },
]

// 몇 배: (주인공 p, 비교 대상 f, 소재, 배수 a, 기준량 b). 활동형은 소재가 문형에 내장.
type TimesTpl = {
  text(p: string, f: string, g: Goods, a: number, b: number): string
  key(g: Goods): string
  unit(g: Goods): string
}
const TIMES_TEMPLATES: TimesTpl[] = [
  {
    key: (g) => g.n,
    unit: (g) => g.unit,
    text: (p, f, g, a, b) =>
      `${josa(f, '은/는')} ${josa(g.n, '을/를')} ${b}${g.unit} 가지고 있어요. ${josa(p, '은/는')} ${f}의 ${a}배를 가지고 있어요. ${josa(p, '은/는')} ${josa(g.n, '을/를')} 몇 ${g.unit} 가지고 있을까요?`,
  },
  {
    key: () => '종이배',
    unit: () => '개',
    text: (p, f, _g, a, b) =>
      `${josa(f, '이/가')} 접은 종이배는 ${b}개예요. ${josa(p, '이/가')} 접은 종이배는 ${f}의 ${a}배예요. ${josa(p, '은/는')} 종이배를 몇 개 접었을까요?`,
  },
  {
    key: () => '줄넘기',
    unit: () => '번',
    text: (p, f, _g, a, b) =>
      `${josa(f, '은/는')} 줄넘기를 ${b}번 넘었어요. ${josa(p, '은/는')} ${f}의 ${a}배만큼 넘었어요. ${josa(p, '은/는')} 줄넘기를 몇 번 넘었을까요?`,
  },
  {
    key: (g) => g.n,
    unit: (g) => g.unit,
    text: (p, f, g, a, b) =>
      `${josa(f, '이/가')} 모은 ${josa(g.n, '은/는')} ${b}${g.unit}이에요. ${josa(p, '은/는')} ${f}의 ${a}배를 모았어요. ${josa(p, '이/가')} 모은 ${josa(g.n, '은/는')} 몇 ${g.unit}일까요?`,
  },
]

function pick<T>(arr: T[], rand: () => number): T {
  return arr[randInt(0, arr.length - 1, rand)]!
}

const ATTEMPTS = 60

/**
 * 하루 2문항: 묶어 세기(그림 칸) + 몇 배. 규칙 —
 * 두 문항 중 하나엔 반드시 딸 이름(몰입, 설계 §6.5), 같은 식·소재를 쓰지 않고
 * seen(공유 중복 집합)의 수식도 피한다. 몇 배의 배수는 2~5(시뮬레이션에서
 * "8배 줄넘기"의 부자연 확인 — 폭 커버는 스프린트의 몫이다).
 */
export function composeWordItems(input: {
  settings: Settings
  rand: () => number
  seen: Set<string>
}): WordItem[] {
  const { settings, rand, seen } = input
  const child = settings.childName || '나'
  const friends = settings.friendNames.length > 0 ? settings.friendNames : ['친구']
  const people = [child, ...friends]

  // 문항1: 묶어 세기. b개씩 a묶음 → 식은 "b×a"(하나에 든 수 × 묶음 수 — 교과 표기).
  let group: WordItem | null = null
  for (let i = 0; i < ATTEMPTS && !group; i++) {
    const a = randInt(2, 9, rand)
    const b = randInt(2, 9, rand)
    const expr = `${b}×${a}`
    if (seen.has(expr)) continue
    const g = pick(GOODS, rand)
    const tpl = pick(GROUP_TEMPLATES, rand)
    const person = pick(people, rand)
    seen.add(expr)
    seen.add(`w-goods:${tpl.key(g)}`)
    seen.add(`w-person:${person}`)
    group = {
      id: 'w1',
      kind: 'word',
      tag: 'mul-group',
      text: tpl.text(person, g, a, b),
      needsDrawing: true,
      expression: expr,
      unit: g.unit,
      answer: a * b,
    }
  }

  // 문항2: 몇 배. 기준량 b(2~9) × 배수 a(2~5). 문항1에 딸이 없었으면 주인공은 딸이다.
  let times: WordItem | null = null
  for (let i = 0; i < ATTEMPTS && !times; i++) {
    const a = randInt(2, 5, rand)
    const b = randInt(2, 9, rand)
    const expr = `${b}×${a}`
    if (seen.has(expr)) continue
    const g = pick(GOODS, rand)
    const tpl = pick(TIMES_TEMPLATES, rand)
    if (seen.has(`w-goods:${tpl.key(g)}`)) continue
    const childRequired = !group || !group.text.includes(child)
    const person = childRequired ? child : pick(people, rand)
    const others = people.filter((p) => p !== person)
    const friend = pick(others.length > 0 ? others : ['친구'], rand)
    seen.add(expr)
    times = {
      id: 'w2',
      kind: 'word',
      tag: 'mul-times',
      text: tpl.text(person, friend, g, a, b),
      needsDrawing: false,
      expression: expr,
      unit: tpl.unit(g),
      answer: a * b,
    }
  }

  // ATTEMPTS 소진은 seen이 사실상 전 조합을 덮은 경우뿐(하루 sheet에서는 불가능).
  // 그래도 남으면 시끄럽게 실패한다 — 빈 문제지 금지는 호출자(화면 try)가 지킨다.
  if (!group || !times) throw new Error('composeWordItems: 문장제 조합을 찾지 못했다')
  return [group, times]
}
```

- [ ] **Step 4: 통과 확인 + 전체 검사**

Run: `npx vitest run src/engine/word.test.ts && npm test && npm run build`

- [ ] **Step 5: 문장 눈검사 — 출력 찍어보기**

임시 스크립트로 20일치 텍스트를 출력해 **직접 읽는다**(어색한 조사·문형이 테스트를 뚫을 수 있다 — 이건 사람 눈이 게이트다):

```bash
npx esbuild src/engine/word.ts --bundle --format=esm --outfile=/tmp/haruchi-word.mjs --log-level=error
npx esbuild src/data/types.ts --bundle --format=esm --outfile=/tmp/haruchi-types.mjs --log-level=error
node --input-type=module -e "
import { composeWordItems } from '/tmp/haruchi-word.mjs'
import { DEFAULT_SETTINGS } from '/tmp/haruchi-types.mjs'
let s = 5
const rand = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff }
for (let d = 0; d < 20; d++)
  for (const it of composeWordItems({ settings: { ...DEFAULT_SETTINGS, childName: '서연' }, rand, seen: new Set() }))
    console.log(it.text)
"
```

어색한 문장이 보이면 문형을 고치고 보고서에 전후를 기록한다.

- [ ] **Step 6: 커밋**

```bash
git add src/engine/word.ts src/engine/word.test.ts
git commit -m "feat(engine): 문장제 템플릿 — 조사 처리·이름 규칙·배수 제한"
```

---

### Task 7: compose 통합 — 하루 14문항

**Files:**

- Modify: `src/engine/compose.ts` (시그니처 확장 + 전략·문장제 조립)
- Modify: `src/engine/compose.test.ts`
- Modify: `src/screens/print-sheet.ts` (호출부만 — 렌더는 Task 8)
- Modify: `src/engine/simulation.test.ts` (호출부만)

**Interfaces:**

- Consumes: `composeStrategyItems`(Task 5), `composeWordItems`(Task 6), `deriveStrategies`(Task 3), `deriveFacts`(facts)
- Produces:

```ts
export function composeSheet(input: {
  settings: Settings
  types: Record<string, TypeState>
  strategies: Record<string, StrategyState>
  facts: Record<string, FactState>
  rand?: () => number
}): SheetItem[] // [v1..v8, inv1..inv2, s1..s2, w1..w2] = 14 (하향 시 12)
```

- [ ] **Step 1: 실패하는 테스트** — `compose.test.ts`에 추가·갱신

기존 테스트의 호출부를 새 시그니처로 바꾼다(`strategies: {}`, `facts: {}` 추가 — 기존 단언은 유지). 새 테스트:

```ts
it('하루 14문항: 세로셈 8 + 역연산 2 + 전략 2 + 문장제 2, id 순서 고정', () => {
  const sheet = composeSheet({
    settings: DEFAULT_SETTINGS,
    types: {},
    strategies: {},
    facts: {},
    rand: lcg(1),
  })
  expect(sheet.map((i) => i.id)).toEqual([
    'v1',
    'v2',
    'v3',
    'v4',
    'v5',
    'v6',
    'v7',
    'v8',
    'inv1',
    'inv2',
    's1',
    's2',
    'w1',
    'w2',
  ])
  expect(sheet.filter((i) => i.kind === 'strategy')).toHaveLength(2)
  expect(sheet.filter((i) => i.kind === 'word')).toHaveLength(2)
})

it('하향 조정(세로셈 6)이어도 전략·문장제는 2+2 고정', () => {
  const sheet = composeSheet({
    settings: { ...DEFAULT_SETTINGS, verticalCount: 6 },
    types: {},
    strategies: {},
    facts: {},
    rand: lcg(2),
  })
  expect(sheet).toHaveLength(12)
  expect(sheet.filter((i) => i.kind === 'strategy')).toHaveLength(2)
  expect(sheet.filter((i) => i.kind === 'word')).toHaveLength(2)
})

it('전략·문장제 수식이 세로셈과 중복 집합을 공유한다', () => {
  // 같은 rand로 두 번 만들면 같은 sheet — 그중 수식 키가 sheet 안에서 유일해야 한다
  const sheet = composeSheet({
    settings: DEFAULT_SETTINGS,
    types: {},
    strategies: {},
    facts: {},
    rand: lcg(3),
  })
  const keys = sheet
    .filter((i): i is VerticalItem | StrategyItem => i.kind === 'vertical' || i.kind === 'strategy')
    .map((i) => `${i.a}${i.op}${i.b}`)
  const wordKeys = sheet.filter((i): i is WordItem => i.kind === 'word').map((i) => i.expression)
  const all = [...keys, ...wordKeys]
  // "같은 수식 두 방법"(전략 2문항이 의도적으로 같은 식)만 예외다
  const strategyPair = sheet.filter((i) => i.kind === 'strategy') as StrategyItem[]
  const intended =
    strategyPair.length === 2 &&
    strategyPair[0]!.a === strategyPair[1]!.a &&
    strategyPair[0]!.b === strategyPair[1]!.b
  expect(new Set(all).size).toBe(intended ? all.length - 1 : all.length)
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/engine/compose.test.ts`
Expected: FAIL — 시그니처 불일치·14문항 아님

- [ ] **Step 3: compose.ts 구현**

`composeSheet`의 입력 타입에 `strategies`·`facts`를 추가하고, 함수 끝(역연산 push 뒤)에:

```ts
// 전략 2문항 — seen(수식 중복 집합)을 세로셈과 공유한다. 키 형식 `${a}${op}${b}`.
items.push(
  ...composeStrategyItems({ strategies: input.strategies, facts: input.facts, rand, seen }),
)
// 문장제 2문항 — 곱셈식·소재·인물 중복도 seen에서 관리된다.
items.push(...composeWordItems({ settings: input.settings, rand, seen }))
```

기존 `seen`은 세로셈 dedup에 이미 쓰인다 — 같은 Set을 그대로 전달한다(형식이 같으므로 세로셈 `27+15`와 전략 `27+15`가 자동으로 충돌·회피된다).

- [ ] **Step 4: 호출부 갱신**

`print-sheet.ts`:

```ts
const days = await getAllDays()
const types = deriveTypes(days)
const strategies = deriveStrategies(days)
const facts = deriveFacts(days, meta.settings.fluentMs)
const sheet = composeSheet({ settings: meta.settings, types, strategies, facts })
```

(기존 `deriveTypes(await getAllDays())`를 위처럼 풀어 쓴다. import에 `deriveStrategies`·`deriveFacts` 추가.)

`simulation.test.ts`의 `simulate()` 안 `composeSheet({ settings, types, rand })` 호출을:

```ts
const strategies = deriveStrategies(log)
const facts = deriveFacts(log, DEFAULT_SETTINGS.fluentMs)
const sheet: SheetItem[] = composeSheet({
  settings: DEFAULT_SETTINGS,
  types,
  strategies,
  facts,
  rand,
})
```

기존 종이 시뮬레이션 단언 중 `d.sheet.length === 10`이 있으면 14로 바뀐다 — "전혀 채점하지 않으면" 테스트의 `sheet.length === 10` 단언을 14로 갱신. 채점 루프는 sheet 전체를 돌므로 전략·문장제도 자동으로 채점 모델에 들어간다(`correctRate(tag, day)`에 전략·word 태그가 전달된다 — 기존 콜백은 태그를 구분하지 않으면 그대로 동작).

- [ ] **Step 5: 통과 확인 + 전체 검사**

Run: `npx vitest run src/engine/compose.test.ts src/engine/simulation.test.ts && npm test && npm run build`

시뮬레이션의 세로셈 관련 실측 단언(유형 도달일 40 등)은 전략·문장제 추가로 **바뀌지 않아야 정상**이다(세로셈 생성 경로의 rand 소비가 늘지만 유형 선택 자체는 독립) — 만약 깨지면 rand 소비 순서 변화가 원인이니, 실측을 다시 떠서 주석과 함께 갱신한다(추측 금지).

- [ ] **Step 6: 커밋**

```bash
git add src/engine/compose.ts src/engine/compose.test.ts src/screens/print-sheet.ts src/engine/simulation.test.ts
git commit -m "feat(engine): 하루 조립에 전략 2 + 문장제 2를 더한다"
```

---

### Task 8: 인쇄 — 2페이지 렌더

**Files:**

- Modify: `src/screens/print-sheet.ts` (2장 렌더 + strategyHtml·wordHtml)
- Modify: `src/styles/print.css`

**Interfaces:**

- Consumes: `StrategyItem`·`WordItem`(types), `STRATEGY_NAMES`(strategy.ts), `escapeHtml`(ui.ts)
- Produces: 화면 렌더만 — 인쇄 버튼 한 번에 단면 2장

- [ ] **Step 1: 렌더 함수 추가** — `print-sheet.ts`

`verticalHtml`/`inverseHtml` 안에 중복 정의된 `marks` 문자열을 파일 상단 상수 `const MARKS = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭'`로 모으고 두 함수가 그것을 쓰게 한다(동작 불변 리팩터).

```ts
import { STRATEGY_NAMES } from '../engine/strategy'
import { escapeHtml } from '../ui'
import type { StrategyItem, WordItem } from '../data/types'

/**
 * 전략 문항. steps의 {}를 손글씨 빈칸으로 치환한다 — 렌더러는 전략 종류를 모른다.
 * steps[].text는 백업 가져오기로 임의 문자열일 수 있어 이스케이프한다(치환 전에 —
 * 치환 후에 하면 우리가 만든 <span>까지 이스케이프된다).
 */
function strategyHtml(item: StrategyItem, index: number): string {
  const rows = item.steps
    .map(
      (s) =>
        `<div class="strat-step">${escapeHtml(s.text).replaceAll('{}', '<span class="strat-blank"></span>')}</div>`,
    )
    .join('')
  return `
    <div class="strat">
      <div class="strat-head">
        <span class="n">${MARKS[index] ?? index + 1}</span>
        <span class="strat-expr">${item.a} ${item.op} ${item.b}</span>
        <span class="strat-name">${escapeHtml(STRATEGY_NAMES[item.tag] ?? item.tag)}</span>
      </div>
      ${rows}
    </div>`
}

/** 문장제. text·unit은 백업 경유 가능 값이라 이스케이프. 정답은 인쇄하지 않는다. */
function wordHtml(item: WordItem, index: number): string {
  return `
    <div class="word">
      <div class="word-text"><span class="n">${MARKS[index] ?? index + 1}</span>${escapeHtml(item.text)}</div>
      ${item.needsDrawing ? '<div class="word-canvas"></div>' : ''}
      <div class="word-answer">식: <u class="word-line"></u> &nbsp; 답: <u class="word-line short"></u> ${escapeHtml(item.unit)}</div>
    </div>`
}
```

- [ ] **Step 2: 2장 렌더** — `renderPrint`의 템플릿

sheet 필터에 두 종류를 더하고, 두 번째 `.sheet` 블록을 만든다. **전략·문장제가 없는 옛 sheet(10문항)면 2장을 아예 만들지 않는다** — Phase 4 배포 직전 날의 재인쇄가 빈 2장을 뽑지 않게:

```ts
const strategies = day.sheet.filter((i): i is StrategyItem => i.kind === 'strategy')
const words = day.sheet.filter((i): i is WordItem => i.kind === 'word')
const page2 =
  strategies.length + words.length > 0
    ? `
  <div class="sheet">
    <div class="sheet-head">
      <div>
        <div class="sheet-title">하루치 · 2장</div>
        <div class="sheet-date">${formatDate(today, true)}</div>
      </div>
      <div class="sheet-name">이름 <u></u></div>
    </div>
    <div class="sheet-sec">3. 방법을 따라 풀어 보세요.</div>
    <div class="strat-zone">
      <div class="strat-zone-label">천천히 생각하는 칸</div>
      ${strategies.map((s, i) => strategyHtml(s, verticals.length + inverses.length + i)).join('')}
    </div>
    <div class="sheet-sec" style="margin-top:14px">4. 읽고 답해 보세요.</div>
    ${words.map((w, i) => wordHtml(w, verticals.length + inverses.length + strategies.length + i)).join('')}
  </div>`
    : ''
```

기존 1장 `.sheet` 뒤에 `${page2}`를 붙인다.

- [ ] **Step 3: print.css**

```css
/* 2장: 화면에서는 이어 보이고 인쇄에서는 새 페이지다 */
.sheet + .sheet {
  margin-top: 24px;
}
@media print {
  .sheet + .sheet {
    page-break-before: always;
    margin-top: 0;
  }
}

/* 전략 존 — "천천히 생각하는 칸"의 시각적 분리(설계 §8). 배경색 대신 테두리(잉크). */
.strat-zone {
  border: 2px solid var(--fg, #000);
  border-radius: 6px;
  padding: 10px 12px 6px;
}
.strat-zone-label {
  font-size: 11px;
  color: #666;
  margin-bottom: 6px;
}
.strat {
  margin-bottom: 12px;
}
.strat-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 6px;
}
.strat-expr {
  font-size: 20px;
  font-weight: 700;
}
.strat-name {
  font-size: 12px;
  color: #666;
}
.strat-step {
  font-size: 17px;
  margin: 8px 0 0 26px; /* 손글씨 공간 — 문제집처럼 좁게 주지 않는다 */
}
.strat-blank {
  display: inline-block;
  width: 44px;
  height: 24px;
  border-bottom: 1.5px solid #000;
  vertical-align: -4px;
}

/* 문장제 */
.word {
  margin: 12px 0;
}
.word-text {
  font-size: 15px;
  line-height: 1.7;
}
.word-canvas {
  height: 84px; /* 묶어 세기 그림 칸 — 테두리만(잉크 최소화) */
  border: 1px solid #bbb;
  border-radius: 4px;
  margin: 8px 0 6px 22px;
}
.word-answer {
  font-size: 15px;
  margin: 6px 0 0 22px;
}
.word-line {
  display: inline-block;
  width: 120px;
  text-decoration: none;
  border-bottom: 1.5px solid #000;
  height: 20px;
}
.word-line.short {
  width: 64px;
}
```

(`.n`은 기존 문항 번호 스타일을 그대로 쓴다 — `inv-eq .n`과 같은 클래스가 있으면 재사용, 없으면 `.strat-head .n, .word-text .n { margin-right: 6px }` 정도만 추가.)

- [ ] **Step 4: 검사 + 수동 확인**

Run: `npm test && npm run build`
수동: `npm run dev` → `#/print`에서 (a) 2장이 화면에 이어 보이고 (b) 인쇄 미리보기(⌘P)에서 정확히 2페이지로 나뉘며 (c) 전략 빈칸·그림 칸·답 칸이 손글씨 크기로 넉넉한지. **실제 A4 인쇄는 사람 확인 항목**으로 보고서에 남긴다. 서버 종료.

- [ ] **Step 5: 커밋**

```bash
git add src/screens/print-sheet.ts src/styles/print.css
git commit -m "feat(screens): 2장 인쇄 — 전략 존과 문장제 레이아웃"
```

---

### Task 9: 채점 — 새 문항 종류의 번호·라벨

**Files:**

- Modify: `src/screens/grade.ts`

**Interfaces:**

- Consumes: `STRATEGY_NAMES`(strategy.ts), `escapeHtml`(ui.ts)
- Produces: 화면 동작만

- [ ] **Step 1: markMap 확장**

인쇄 순서와 같은 순서로 번호를 매긴다:

```ts
const printed = [
  ...sheet.filter((i) => i.kind === 'vertical'),
  ...sheet.filter((i) => i.kind === 'inverse'),
  ...sheet.filter((i) => i.kind === 'strategy'),
  ...sheet.filter((i) => i.kind === 'word'),
]
```

주석의 "종이에 찍히지 않는 종류의 문항은 번호를 갖지 않는다"는 문장을 "모든 종류가 종이에 찍힌다(Phase 4) — 인쇄 순서(세로셈→역연산→전략→문장제)와 여기 순서가 같아야 종이와 화면 번호가 어긋나지 않는다"로 갱신.

- [ ] **Step 2: label 확장**

```ts
function label(item: SheetItem): string {
  if (item.kind === 'vertical') return `${item.a} ${item.op} ${item.b}`
  if (item.kind === 'inverse') {
    /* 기존 그대로 */
  }
  if (item.kind === 'strategy')
    return `${item.a} ${item.op} ${item.b} (${STRATEGY_NAMES[item.tag] ?? item.tag})`
  if (item.kind === 'word') return `문장제 ${item.expression}`
  return item.kind
}
```

정답 표시는 기존 코드가 `item.answer`를 쓰고 있으므로 자동으로 동작한다 — 채점 화면에서 전략·문장제 문항이 **정답과 함께** 뜨는지 Step 3에서 확인. `label` 결과가 `el()` 템플릿에 들어가는 자리에서 이스케이프되는지 확인하고, 안 되어 있으면 보간 지점에 `escapeHtml`을 적용한다(문장제 `expression`·전략 `tag`는 백업 경유 가능 값).

- [ ] **Step 3: 검사 + 수동 확인**

Run: `npm test && npm run build`
수동: dev 서버에서 오늘 문제지 생성 → `#/grade`에 ①~⑭ 전 문항이 정답과 함께 뜨는지, 전략·문장제를 ✕로 바꿔 저장이 되는지. 서버 종료.

- [ ] **Step 4: 커밋**

```bash
git add src/screens/grade.ts
git commit -m "feat(screens): 채점 화면에 전략·문장제 번호와 라벨"
```

---

### Task 10: 리포트 — 배운 방법 N/8 + 전략 정답률

**Files:**

- Modify: `src/engine/report.ts` (`WeeklyReport`에 필드 추가)
- Modify: `src/engine/report.test.ts`
- Modify: `src/screens/report.ts` (표시)

**Interfaces:**

- Consumes: `deriveStrategies`(Task 3), `STRATEGY_CATALOG`·`STRATEGY_NAMES`(Task 4)
- Produces: `WeeklyReport.strategiesLearned: number` 추가, `WeeklyReport.types`에 전략 행이 합류(`tag`가 StrategyId인 행)

- [ ] **Step 1: 실패하는 테스트** — `report.test.ts`에 추가

```ts
it('배운 방법 수와 전략 정답률 행이 리포트에 들어간다', () => {
  const stratDay = (date: string, id: string, correct: boolean, n: number): Day => ({
    date,
    kind: 'normal',
    sheet: [
      {
        id: `s-${date}-${n}`,
        kind: 'strategy',
        tag: id as StrategyId,
        a: 27,
        b: 15,
        op: '+',
        steps: [{ text: '27 + 3 = {}', blanks: [30] }],
        answer: 42,
      },
    ],
    grades: { [`s-${date}-${n}`]: correct },
  })
  // make-ten 12회(그중 최근 10회에 오답 4개 → 60%: warn), split-place 3회(표본 부족)
  const days = [
    ...Array.from({ length: 12 }, (_, i) =>
      stratDay(`2026-07-${String(10 + i).padStart(2, '0')}`, 'make-ten', i < 8, i),
    ),
    ...Array.from({ length: 3 }, (_, i) => stratDay(`2026-07-2${5 + i}`, 'split-place', true, i)),
  ]
  const w = weeklyReport(days, metaWith(null), '2026-08-03')
  expect(w.strategiesLearned).toBe(2)

  const makeTen = w.types.find((t) => t.tag === 'make-ten')!
  expect(makeTen.pct).not.toBeNull()
  expect(makeTen.warn).toBe(true) // 최근 10회 중 정답 6 → 60% < 90%
  const splitPlace = w.types.find((t) => t.tag === 'split-place')!
  expect(splitPlace.pct).toBeNull() // 표본 부족 — 0%로 거짓말하지 않는다
  expect(splitPlace.warn).toBe(false)
})

it('전략이 한 번도 안 나왔으면 strategiesLearned 0, 전략 행 없음', () => {
  const w = weeklyReport([], metaWith(null), '2026-08-03')
  expect(w.strategiesLearned).toBe(0)
  expect(w.types.filter((t) => t.tag.startsWith('make-') || t.tag === 'anchor')).toEqual([])
})
```

(`make-ten` 12회의 오답 배치를 검산할 것: `i < 8`이 정답이므로 attempts = [T×8, F×4], 최근 10회 = [T×6, F×4] → 60%. 이 검산이 어긋나면 픽스처를 고치지 임계값을 건드리지 않는다.)

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/engine/report.test.ts`
Expected: FAIL — `strategiesLearned` 없음

- [ ] **Step 3: 구현**

`report.ts`의 `WeeklyReport`에 `strategiesLearned: number` 추가. `weeklyReport` 안에서:

```ts
const strategyStates = deriveStrategies(days)
const strategiesLearned = Object.values(strategyStates).filter(
  (s) => s.introducedAt !== null,
).length
// 전략 정답률 행 — 세로셈·역연산과 같은 표본 규칙. 하루 2문항이라 표본이 느리게 찬다:
// 처음 몇 주는 "표본 부족"이 정상이다(스펙 §6 — 결함으로 오인하지 말 것).
const strategyRows = Object.entries(strategyStates).map(([tag, s]) => {
  const sampled = s.attempts.length >= RECENT_WINDOW
  const recent = s.attempts.slice(-RECENT_WINDOW)
  const pct = sampled ? recent.filter(Boolean).length / recent.length : null
  return { tag, pct, warn: pct !== null && pct < OPEN_THRESHOLD }
})
```

`types: [...typeRows, ...strategyRows]`로 합치고 반환에 `strategiesLearned` 추가.

`screens/report.ts`:

- `TAG_LABELS`에 전략 8종 추가 — `strategy.ts`의 `STRATEGY_NAMES`를 import해 스프레드한다: `const TAG_LABELS = { ...기존, ...STRATEGY_NAMES }` (이름의 단일 출처는 카탈로그다 — 라벨을 두 곳에 쓰지 않는다)
- 딸 쪽 상단(연속일수 줄 근처)에 `배운 방법 ${w.strategiesLearned} / 8` 표시. `shareText`에도 같은 줄 추가

- [ ] **Step 4: 통과 확인 + 전체 검사**

Run: `npx vitest run src/engine/report.test.ts && npm test && npm run build`

- [ ] **Step 5: 커밋**

```bash
git add src/engine/report.ts src/engine/report.test.ts src/screens/report.ts
git commit -m "feat: 주간 리포트에 배운 방법과 전략 정답률"
```

---

### Task 11: 시뮬레이션 — 전략 도입 다일 검증

**Files:**

- Modify: `src/engine/simulation.test.ts`

**Interfaces:**

- Consumes: `deriveStrategies`, `STRATEGY_CATALOG` — 신규 export 없음

- [ ] **Step 1: 새 테스트 추가**

Task 7에서 `simulate()`가 이미 전략·문장제를 sheet에 포함하고 채점까지 한다. 다일 성질을 단언한다:

```ts
describe('전략 도입 다일 시뮬레이션', () => {
  it('꾸준히 하면 비곱셈 6종이 모두 도입되고, 곱셈 2종은 fluent 게이트에 잠긴다', () => {
    // simulate()는 종이만 하고 스프린트가 없다 → fluent 0 → 곱셈 게이트가 닫혀 있어야 한다.
    // 이 단언은 게이트가 "sheet 등장"이 아니라 "fluent"를 보고 있음의 자기증명이다.
    const sim = simulate({ days: 40, seed: 77, correctRate: () => 0.9 })
    const s = deriveStrategies(sim.log)
    const nonMul = STRATEGY_CATALOG.filter((d) => d.op !== '×').map((d) => d.id)
    const mul = STRATEGY_CATALOG.filter((d) => d.op === '×').map((d) => d.id)
    for (const id of nonMul) expect(s[id]?.introducedAt, id).not.toBeUndefined()
    for (const id of mul) expect(s[id], id).toBeUndefined()
  })

  it('도입 페이스: 등장 3회 게이트로 약 3일에 1개 — 6종 도달이 15~20일 사이다', () => {
    // 기대 산술: 새 전략은 매일 문항1로 나오므로 3일마다 하나 = 6종째 도입일 ≈ 16일.
    // 상한 20은 게이트가 "appearances>=3"보다 느슨해지는 회귀(예: >=5)를 잡고,
    // 하한 15는 게이트가 사라지는 회귀(매일 새 전략)를 잡는다. 실측으로 확정할 것.
    const sim = simulate({ days: 25, seed: 78, correctRate: () => 0.9 })
    let sixthAt: number | null = null
    for (let d = 1; d <= 25 && sixthAt === null; d++) {
      const s = deriveStrategies(sim.log.slice(0, d))
      if (Object.values(s).filter((x) => x.introducedAt).length >= 6) sixthAt = d
    }
    expect(sixthAt).not.toBeNull()
    expect(sixthAt!).toBeGreaterThanOrEqual(15)
    expect(sixthAt!).toBeLessThanOrEqual(20)
  })

  it('도입된 전략은 로테이션에서 굶지 않는다 — 연속 미등장 상한', () => {
    const sim = simulate({ days: 40, seed: 79, correctRate: () => 0.9 })
    // 전략별 등장일 인덱스를 모아 최대 공백을 잰다 (appearanceGaps와 같은 방법을 전략에)
    const seenOn: Record<string, number[]> = {}
    sim.log.forEach((day, i) => {
      for (const item of day.sheet) {
        if (item.kind !== 'strategy') continue
        ;(seenOn[item.tag] ??= []).push(i)
      }
    })
    let worst = 0
    for (const at of Object.values(seenOn)) {
      for (let i = 1; i < at.length; i++) worst = Math.max(worst, at[i]! - at[i - 1]!)
    }
    // 도입기엔 신규가 문항1을 점유해 공백 ≈ 도입 전략 수(5~6일). 6종 도입 뒤엔 정착기
    // (시뮬레이션은 fluent 0이라 곱셈 게이트 대기)로 두 슬롯이 모두 로테이션해 공백이
    // ~3일로 줄어야 한다 — 정착기 분기가 빠지면 count-up이 문항1을 영구 점유해
    // 나머지가 굶는 쪽으로 실측이 어긋난다(스펙 §3 정착기 규칙의 다일 검증).
    // 실측을 먼저 찍고, 실측 + 여유로 상한을 확정한다(추측 금지 — 아래 Step 2).
    expect(worst).toBeLessThanOrEqual(8)
  })
})
```

- [ ] **Step 2: 실측으로 상한 확정**

세 테스트를 돌려 실측값(6종 도달일, 최대 공백)을 임시 로그로 찍는다. 위 코드의 15·20·8은 **자리 표시가 아니라 예상값**이다 — 실측이 다르면: (a) 원인을 이해하고 (b) 실측 ± 결함-구별 여유로 다시 잡고 (c) 주석에 실측값·잡으려는 회귀·왜 그 값인지 기록한다. 실측 없이 넘기지 않는다.

Run: `npx vitest run src/engine/simulation.test.ts`
Expected: PASS (실측 확정 후)

- [ ] **Step 3: 변이 검증**

`composeStrategyItems`의 게이트 `>= 3`을 임시로 `>= 1`로 바꾸면 도입 페이스 테스트(하한 15)가 실패하는지 확인 후 원복.

- [ ] **Step 4: 전체 검사 + 커밋**

Run: `npm test && npm run build`

```bash
git add src/engine/simulation.test.ts
git commit -m "test(engine): 전략 도입·로테이션 다일 시뮬레이션"
```

---

### Task 12: 문서 — 주석 정정과 인수인계

**Files:**

- Modify: `docs/superpowers/HANDOFF.md`
- Modify: 스테일 주석 (아래)

- [ ] **Step 1: 스테일 주석 정정**

- `src/engine/facts.ts`: Task 1에서 처리 확인(81 언급·DAN_ORDER 잔재가 없는지 grep으로 재확인: `grep -n "81\|DAN_ORDER\|FACT_ORDER" src/engine/facts.ts`)
- `src/screens/fact-map.ts`: "인쇄물(Phase 4)도 그대로 쓸 수 있다" 주석 — 인쇄물 리포트는 이번에도 안 만들었으므로 "인쇄물(추후)"로 정정
- `src/engine/derive.ts`: "inverse 태그 배선은 Phase 4 이후로 간다" — 이번에도 안 했으므로 사실 유지 확인만

- [ ] **Step 2: HANDOFF.md 갱신**

상태 표(테스트 개수 — 실제 실행값으로), "Phase 4가 만든 것" 절 신설:

- 구구단 풀 72식·무작위 도입 (사용자 결정, 1단 기록은 derive가 조용히 무시)
- 전략 카탈로그가 단일 출처(이름·순서·게이트) — 새 전략 추가는 카탈로그 항목 추가뿐
- 도입 게이트는 등장 횟수(채점 아님 — 이유), 곱셈 2종은 fluent 10 게이트
- 문장제 텍스트는 sheet에 박제 — 이름 변경이 과거에 소급되지 않는다
- 2장 인쇄: 옛 10문항 sheet는 2장을 만들지 않는다(재인쇄 불변식 우선)
- 남은 사람 확인: **실제 A4 인쇄 품질**(빈칸 크기·그림 칸·페이지 나눔), 배포 후 아이 반응

미해결 항목에서 해소된 것(세로셈만 있던 반쪽 구성)을 갱신하고, "이번에 하지 않은 것"(인쇄물 리포트·문장제 정답률·세로셈 품질)을 스펙 §9에서 옮겨 적는다.

- [ ] **Step 3: 포맷 + 검사 + 커밋**

Run: `npm run format && npm test && npm run build`

```bash
git add -A
git commit -m "docs: Phase 4 완료를 주석과 인수인계에 반영"
```

---

## 최종 리뷰

전 태스크 완료 후 superpowers:requesting-code-review로 전체 브랜치 리뷰를 받는다. 특히:

- **이음새**: (a) `composeSheet`의 공유 `seen`이 세로셈·전략·문장제 사이에서 실제로 한 집합인지 (b) 인쇄 순서(`print-sheet`) × 번호(`grade.ts markMap`) × id 순서(`compose`)가 셋 다 일치하는지 (c) 풀 72로 줄인 뒤 checkup·report·map이 전부 새 풀 기준인지
- **파라미터 범위 실행**: Phase 3 최종 리뷰의 교훈 — 코드 읽기만으로 끝내지 말고, 시뮬레이션을 여러 정답률(0.9뿐 아니라 0.5·0.7)로 돌려 전략 도입·로테이션이 저성취 아이에게도 성립하는지 실측할 것
- **문장 품질**: 문장제 20일치 출력을 실제로 읽을 것 — 조사·문형 어색함은 테스트가 못 잡는다
