# 하루치 Phase 2 — 구구단 스프린트 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 아이패드에서 매일 3분간 구구단 30문제를 풀고, 반응시간으로 유창도를 판정하고, 정복한 칸이 채워지는 81칸 지도를 보여준다.

**Architecture:** Phase 1의 구조를 그대로 따른다 — 순수 함수 엔진(`src/engine/facts.ts`)이 로그에서 81식의 상태를 파생하고 그날 출제할 식을 고르며, 화면(`src/screens/sprint.ts`)은 렌더와 입력만 담당한다. `derived`는 여전히 저장하지 않고 매번 `days` 로그에서 재계산한다.

**Tech Stack:** TypeScript(strict) · 바닐라 DOM · Vitest · 런타임 의존성 0

설계 문서: `docs/superpowers/specs/2026-08-02-haruchi-design.md` (§6.1, §7, §6.8)
Phase 1 계획: `docs/superpowers/plans/2026-08-02-phase1-paper-routine.md`

## Global Constraints

- **런타임 의존성 0개.** `dependencies`는 비어 있어야 한다. 추가는 `devDependencies`에만
- **프레임워크 없음.** 바닐라 DOM + 해시 라우팅
- TypeScript `strict: true`
- **`engine/`의 모든 함수는 순수 함수.** DOM·IndexedDB·`Date.now()`에 직접 의존하지 않는다. 시각과 난수는 인자로 주입한다
- **`derived`는 저장하지 않는다.** `Meta.derived`를 읽는 코드를 만들지 말 것 — 매번 `days`에서 재계산한다. 이것이 규칙 변경을 소급 적용 가능하게 하는 유일한 장치다
- **`attempts`/`sprint` 이력을 자르지 말 것.** 파생이 전체 이력을 필요로 한다
- **테스트는 `engine/`에 집중.** DOM·화면 단위 테스트는 작성하지 않는다
- **하루의 경계는 새벽 4시(로컬).** 날짜 키는 반드시 `engine/dates.ts`의 `dayKey()`를 거친다
- **조용히 실패하지 않는다.** 화면은 본문 전체를 하나의 `try`로 감싸고, `catch`에서 `showError`와 함께 `#app`에 동작하는 복귀 수단을 렌더한다 (`src/screens/print-sheet.ts`, `grade.ts` 참고)
- **계약 위반은 시끄럽게 실패한다.** 잘못된 입력을 그럴듯한 출력으로 덮지 않는다
- 커밋 메시지는 한국어, Conventional Commits 접두사 사용
- **인쇄물에 정답을 출력하지 않는다** (Phase 3에서 지도를 인쇄할 때 이 규칙이 다시 걸린다)

### Phase 1에서 반복해서 발견된 실패 패턴 — 이 계획에서 되풀이하지 말 것

리뷰가 12회 중 여러 번 같은 모양을 잡았다. 테스트를 쓸 때 매번 확인하라.

1. **자기 자신을 검사하는 테스트.** 생성기가 이미 술어 `P`로 후보를 걸러 반환하는데 테스트가 다시 `P`를 단언하면, `P`를 무엇으로 바꿔도 통과한다. 기대값은 **구현이 아닌 곳에서 독립적으로** 끌어와 테스트 안에 리터럴로 박는다
2. **느슨한 상한.** 실측이 16인데 상한을 150으로 두면 완전 정지만 잡힌다. 상한은 정상 변동은 통과시키되 회귀는 잡는 선에 둔다
3. **아무것도 고정하지 못하는 단언.** `expect(x).toBeTruthy()`는 대개 실패할 수 없다
4. **화면의 갇힘 경로.** 첫 `await`가 `try` 밖에 있으면 실패 시 `#app`이 빈 채로 남는다. `showError`는 `document.body`에만 붙는다

---

## File Structure

| 파일                            | 책임                                                                     |
| ------------------------------- | ------------------------------------------------------------------------ |
| `src/engine/facts.ts`           | 81식의 id·도입 순서, 로그 → `FactState` 파생, 스프린트 출제, 오답 재투입 |
| `src/engine/facts.test.ts`      | 위의 단위·경계 테스트                                                    |
| `src/engine/streak.ts`          | 스프린트 기준 연속일수                                                   |
| `src/engine/streak.test.ts`     |                                                                          |
| `src/screens/fact-map.ts`       | 81칸 지도를 HTML 문자열로 (Phase 3의 인쇄가 그대로 재사용)               |
| `src/screens/sprint.ts`         | 스프린트 화면 — 키패드, 반응시간 측정, 세션 저장, 결과                   |
| `src/styles/app.css`            | 스프린트·지도 스타일 추가                                                |
| `src/screens/home.ts`           | 세 번째 버튼, 🔥 연속일수, 지도 링크                                     |
| `src/main.ts`                   | `#/sprint`, `#/map` 라우트                                               |
| `src/engine/simulation.test.ts` | 스프린트를 포함한 다중일 시뮬레이션 확장                                 |

`facts.ts`는 `data/types.ts`와 `engine/dates.ts`, `engine/rand.ts`만 import한다. 화면은 엔진을 쓰지만 그 반대는 없다.

---

### Task 1: 81식 상태 파생 (`deriveFacts`)

**Files:**

- Create: `src/engine/facts.ts`, `src/engine/facts.test.ts`

**Interfaces:**

- Consumes: `Day`, `FactState`, `SprintAttempt` (`src/data/types.ts`), `shiftDay` (`src/engine/dates.ts`)
- Produces:
  - `FACT_IDS: string[]` — 81개, `"a×b"` 형식 (예: `"7×8"`). 곱셈 기호는 U+00D7
  - `factId(a: number, b: number): string`
  - `FACT_ORDER: string[]` — 도입 순서로 정렬된 81개 id
  - `STREAK_TARGET = 3`
  - `deriveFacts(days: Day[], fluentMs: number): Record<string, FactState>`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/engine/facts.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { FACT_IDS, FACT_ORDER, factId, deriveFacts, STREAK_TARGET } from './facts'
import type { Day, SprintAttempt } from '../data/types'

function sprintDay(date: string, attempts: SprintAttempt[]): Day {
  return { date, kind: 'normal', sheet: [], sprint: attempts }
}

function hit(fact: string, ms: number): SprintAttempt {
  return { fact, correct: true, ms }
}

function miss(fact: string): SprintAttempt {
  return { fact, correct: false, ms: 9000 }
}

describe('식 목록', () => {
  it('81개이고 중복이 없다', () => {
    expect(FACT_IDS).toHaveLength(81)
    expect(new Set(FACT_IDS).size).toBe(81)
  })

  it('factId는 곱셈 기호로 조합한다', () => {
    expect(factId(7, 8)).toBe('7×8')
    expect(FACT_IDS).toContain('7×8')
    expect(FACT_IDS).toContain('1×1')
    expect(FACT_IDS).toContain('9×9')
  })

  it('FACT_ORDER는 같은 81개를 교과서 도입 순서로 담는다', () => {
    expect(new Set(FACT_ORDER)).toEqual(new Set(FACT_IDS))
    // 1단이 먼저, 그다음 2 → 5 → 3 → 6 → 4 → 8 → 7 → 9단
    const firstOf = (n: number) => FACT_ORDER.findIndex((id) => id.startsWith(`${n}×`))
    expect(firstOf(1)).toBeLessThan(firstOf(2))
    expect(firstOf(2)).toBeLessThan(firstOf(5))
    expect(firstOf(5)).toBeLessThan(firstOf(3))
    expect(firstOf(3)).toBeLessThan(firstOf(6))
    expect(firstOf(6)).toBeLessThan(firstOf(4))
    expect(firstOf(4)).toBeLessThan(firstOf(8))
    expect(firstOf(8)).toBeLessThan(firstOf(7))
    expect(firstOf(7)).toBeLessThan(firstOf(9))
  })
})

describe('deriveFacts', () => {
  it('기록이 없으면 전부 new다', () => {
    const facts = deriveFacts([], 2500)
    expect(Object.keys(facts)).toHaveLength(81)
    expect(facts['7×8']).toEqual({
      status: 'new',
      medianMs: null,
      streak: 0,
      interval: 1,
      nextDue: null,
    })
  })

  it('연속 3회 정답이고 중앙값이 기준 이하면 fluent다', () => {
    const facts = deriveFacts(
      [sprintDay('2026-08-01', [hit('7×8', 2000), hit('7×8', 2400), hit('7×8', 2200)])],
      2500,
    )
    expect(facts['7×8']!.status).toBe('fluent')
    expect(facts['7×8']!.streak).toBe(3)
    expect(facts['7×8']!.medianMs).toBe(2200)
  })

  it('중앙값이 기준을 1ms라도 넘으면 fluent가 아니다', () => {
    const facts = deriveFacts(
      [sprintDay('2026-08-01', [hit('7×8', 2501), hit('7×8', 2501), hit('7×8', 2501)])],
      2500,
    )
    expect(facts['7×8']!.status).toBe('learning')
  })

  it('정확히 기준값이면 fluent다 (경계는 이하)', () => {
    const facts = deriveFacts(
      [sprintDay('2026-08-01', [hit('7×8', 2500), hit('7×8', 2500), hit('7×8', 2500)])],
      2500,
    )
    expect(facts['7×8']!.status).toBe('fluent')
  })

  it('2회 연속으로는 fluent가 아니다', () => {
    const facts = deriveFacts([sprintDay('2026-08-01', [hit('7×8', 1000), hit('7×8', 1000)])], 2500)
    expect(facts['7×8']!.status).toBe('learning')
    expect(facts['7×8']!.streak).toBe(2)
  })

  it('오답은 learning으로 강등하고 streak와 간격을 되돌린다', () => {
    const facts = deriveFacts(
      [
        sprintDay('2026-08-01', [hit('7×8', 1000), hit('7×8', 1000), hit('7×8', 1000)]),
        sprintDay('2026-08-02', [miss('7×8')]),
      ],
      2500,
    )
    expect(facts['7×8']!.status).toBe('learning')
    expect(facts['7×8']!.streak).toBe(0)
    expect(facts['7×8']!.interval).toBe(1)
    expect(facts['7×8']!.nextDue).toBeNull()
  })

  it('fluent가 된 날 다음 등장일은 하루 뒤다', () => {
    const facts = deriveFacts(
      [sprintDay('2026-08-01', [hit('7×8', 1000), hit('7×8', 1000), hit('7×8', 1000)])],
      2500,
    )
    expect(facts['7×8']!.interval).toBe(1)
    expect(facts['7×8']!.nextDue).toBe('2026-08-02')
  })

  it('fluent를 유지하면 간격이 1 → 3 → 7 → 14로 늘고 14에서 멈춘다', () => {
    const days: Day[] = [
      sprintDay('2026-08-01', [hit('7×8', 1000), hit('7×8', 1000), hit('7×8', 1000)]),
      sprintDay('2026-08-02', [hit('7×8', 1000)]),
      sprintDay('2026-08-05', [hit('7×8', 1000)]),
      sprintDay('2026-08-12', [hit('7×8', 1000)]),
      sprintDay('2026-08-26', [hit('7×8', 1000)]),
    ]
    const at = (n: number) => deriveFacts(days.slice(0, n), 2500)['7×8']!
    expect(at(1).interval).toBe(1)
    expect(at(2).interval).toBe(3)
    expect(at(3).interval).toBe(7)
    expect(at(4).interval).toBe(14)
    expect(at(5).interval).toBe(14)
    expect(at(5).nextDue).toBe('2026-09-09')
  })

  it('스프린트가 없는 날은 건너뛴다', () => {
    const noSprint: Day = { date: '2026-08-01', kind: 'normal', sheet: [] }
    expect(deriveFacts([noSprint], 2500)['7×8']!.status).toBe('new')
  })

  it('같은 days를 두 번 넣어도 같은 결과다', () => {
    const days = [sprintDay('2026-08-01', [hit('7×8', 1000), miss('6×7')])]
    expect(deriveFacts(days, 2500)).toEqual(deriveFacts(days, 2500))
  })

  it('입력 days를 변형하지 않는다', () => {
    const days = [sprintDay('2026-08-01', [hit('7×8', 1000)])]
    const snapshot = JSON.stringify(days)
    deriveFacts(days, 2500)
    expect(JSON.stringify(days)).toBe(snapshot)
  })

  it('STREAK_TARGET은 3이다', () => {
    expect(STREAK_TARGET).toBe(3)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/engine/facts.test.ts`
Expected: FAIL — 모듈을 찾을 수 없다는 에러 (`Cannot find module './facts'` 또는 `Failed to resolve import`)

- [ ] **Step 3: 구현**

`src/engine/facts.ts`:

```ts
import type { Day, FactState } from '../data/types'
import { shiftDay } from './dates'

/** 유창 판정에 필요한 연속 정답 횟수. */
export const STREAK_TARGET = 3

/** 곱셈 기호는 U+00D7. ASCII 'x'가 아니다 — 화면과 저장 키가 모두 이 문자를 쓴다. */
export function factId(a: number, b: number): string {
  return `${a}×${b}`
}

/** 1×1 ~ 9×9. 순서쌍이므로 7×8과 8×7은 별개다. */
export const FACT_IDS: string[] = (() => {
  const ids: string[] = []
  for (let a = 1; a <= 9; a++) for (let b = 1; b <= 9; b++) ids.push(factId(a, b))
  return ids
})()

/**
 * 단 도입 순서.
 *
 * ⚠️ **출처 미확인.** 이 배열은 설계 문서에 "교과서 순서"로 적혀 있으나 공시 문서로
 * 검증된 값이 아니다. 곱셈구구 단원 **안에서의** 단 배열은 교육부 고시의 성취기준
 * 수준이 아니라 교과서 편집 결정이며, 출판사마다 다를 수 있다. EBS 만점왕 연산 조사
 * (`docs/reference/korean-math-programs-curricula.md`)도 "4단계(초2) — 2~9단 곱셈구구
 * 전체"까지만 확인되고 내부 순서는 미공개다. 실제 2-2 교과서 목차를 확인하면 고칠 것.
 *
 * 바꾸는 비용은 작다: 이 배열은 **아직 도입되지 않은 식을 다음에 무엇부터 꺼낼지**만
 * 정한다. 이미 나온 식의 상태는 로그에서 파생되므로 순서를 바꿔도 과거 기록은 유효하다.
 *
 * 현재 값의 근거는 경험칙이다 — 2단·5단이 패턴이 뚜렷해 먼저 오고, 병목인 6×7·7×8·
 * 8×6·9×7 부근이 뒤로 밀려 앞에서 자신감을 쌓은 뒤 만나게 된다.
 */
const DAN_ORDER = [1, 2, 5, 3, 6, 4, 8, 7, 9]

export const FACT_ORDER: string[] = DAN_ORDER.flatMap((a) =>
  Array.from({ length: 9 }, (_, i) => factId(a, i + 1)),
)

function median(xs: number[]): number | null {
  if (xs.length === 0) return null
  const sorted = [...xs].sort((p, q) => p - q)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

/** 1 → 3 → 7 → 14 → 14. */
function nextInterval(current: FactState['interval']): FactState['interval'] {
  if (current === 1) return 3
  if (current === 3) return 7
  return 14
}

/**
 * 로그를 시간순으로 재생해 81식의 현재 상태를 만든다.
 *
 * `medianMs`는 **지금 이어지고 있는 연속 정답**(최대 STREAK_TARGET개)의 중앙값이다.
 * 오답이 나오면 연속이 끊기므로 null이 된다. 유창 게이트가 쓰는 값이 그것이기 때문이며,
 * 화면에 보여줄 "평균 반응시간"은 이 값이 아니라 `day.sprint`에서 직접 계산한다.
 *
 * days는 날짜 오름차순을 전제한다 — `getAllDays()`가 그렇게 돌려준다.
 */
export function deriveFacts(days: Day[], fluentMs: number): Record<string, FactState> {
  const facts: Record<string, FactState> = {}
  const run: Record<string, number[]> = {}
  for (const id of FACT_IDS) {
    facts[id] = { status: 'new', medianMs: null, streak: 0, interval: 1, nextDue: null }
    run[id] = []
  }

  for (const day of days) {
    if (!day.sprint) continue
    for (const attempt of day.sprint) {
      const state = facts[attempt.fact]
      const history = run[attempt.fact]
      if (!state || !history) continue // 알 수 없는 식은 무시한다

      if (attempt.correct) {
        state.streak += 1
        history.push(attempt.ms)
        if (history.length > STREAK_TARGET) history.shift()
      } else {
        state.streak = 0
        history.length = 0
      }

      const wasFluent = state.status === 'fluent'
      const med = median(history)
      const isFluent = state.streak >= STREAK_TARGET && med !== null && med <= fluentMs

      state.medianMs = med
      state.status = isFluent ? 'fluent' : 'learning'

      if (isFluent) {
        state.interval = wasFluent ? nextInterval(state.interval) : 1
        state.nextDue = shiftDay(day.date, state.interval)
      } else {
        state.interval = 1
        state.nextDue = null
      }
    }
  }

  return facts
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/engine/facts.test.ts`
Expected: 14개 PASS.

- [ ] **Step 5: 전체 스위트와 타입 검사**

```bash
npx vitest run
npx tsc --noEmit
npx prettier --check .
```

Expected: 기존 81 + 신규 14 = 95개 PASS, 타입·포맷 clean.

- [ ] **Step 6: 커밋**

```bash
git add src/engine/facts.ts src/engine/facts.test.ts
git commit -m "feat(engine): 구구단 81식 상태 파생 추가"
```

---

### Task 2: 스프린트 출제와 오답 재투입

**Files:**

- Modify: `src/engine/facts.ts`
- Modify: `src/engine/facts.test.ts`

**Interfaces:**

- Consumes: `FactState` (types), `FACT_ORDER`/`FACT_IDS` (Task 1), `randInt` (`src/engine/rand.ts`)
- Produces:
  - `composeSprint(input: { facts: Record<string, FactState>; count: number; today: string; rand?: () => number }): string[]`
  - `requeueWrong(remaining: string[], fact: string, gap?: number): string[]`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/engine/facts.test.ts` 끝에 덧붙인다 (`composeSprint`, `requeueWrong`을 import에 추가):

```ts
function lcg(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return s / 0x7fffffff
  }
}

function allNew(): Record<string, FactState> {
  const facts: Record<string, FactState> = {}
  for (const id of FACT_IDS) {
    facts[id] = { status: 'new', medianMs: null, streak: 0, interval: 1, nextDue: null }
  }
  return facts
}

describe('composeSprint', () => {
  it('요청한 개수만큼 낸다', () => {
    const out = composeSprint({ facts: allNew(), count: 30, today: '2026-08-02', rand: lcg(1) })
    expect(out).toHaveLength(30)
  })

  it('첫날에는 도입 순서 앞쪽의 소수 식만 쓰고 반복해서 채운다', () => {
    const out = composeSprint({ facts: allNew(), count: 30, today: '2026-08-02', rand: lcg(1) })
    const unique = [...new Set(out)]
    // 15%가 신규 배분이므로 30문제면 서로 다른 식은 5개 이하여야 한다.
    // 30개를 전부 다른 식으로 내면 처음 만나는 아이에게 81식을 한꺼번에 들이미는 셈이다.
    expect(unique.length).toBeLessThanOrEqual(5)
    for (const id of unique) {
      expect(FACT_ORDER.indexOf(id)).toBeLessThan(unique.length)
    }
  })

  it('learning이 충분하면 60% 가까이를 learning으로 채운다', () => {
    const facts = allNew()
    for (const id of FACT_ORDER.slice(0, 40)) {
      facts[id] = { status: 'learning', medianMs: 3000, streak: 1, interval: 1, nextDue: null }
    }
    const out = composeSprint({ facts, count: 30, today: '2026-08-02', rand: lcg(7) })
    // 서로 다른 learning 식의 개수로 센다. 부족분을 채울 때 이미 고른 식이 반복되므로
    // 등장 횟수로 세면 18을 넘는다.
    const uniqueLearning = new Set(out.filter((id) => facts[id]!.status === 'learning'))
    expect(uniqueLearning.size).toBe(18)
  })

  it('due가 지난 fluent만 고르고 아직 이른 fluent는 안 고른다', () => {
    const facts = allNew()
    facts['2×2'] = {
      status: 'fluent',
      medianMs: 900,
      streak: 5,
      interval: 3,
      nextDue: '2026-08-01',
    }
    facts['2×3'] = {
      status: 'fluent',
      medianMs: 900,
      streak: 5,
      interval: 3,
      nextDue: '2026-08-02',
    }
    facts['2×4'] = {
      status: 'fluent',
      medianMs: 900,
      streak: 5,
      interval: 7,
      nextDue: '2026-09-01',
    }
    for (const id of FACT_ORDER.slice(0, 40)) {
      if (facts[id]!.status === 'new') {
        facts[id] = { status: 'learning', medianMs: 3000, streak: 1, interval: 1, nextDue: null }
      }
    }
    const out = composeSprint({ facts, count: 30, today: '2026-08-02', rand: lcg(3) })
    expect(out).toContain('2×2')
    expect(out).toContain('2×3') // nextDue === today 는 due 다
    expect(out).not.toContain('2×4')
  })

  it('신규는 도입 순서를 건너뛰지 않는다', () => {
    const facts = allNew()
    for (const id of FACT_ORDER.slice(0, 20)) {
      facts[id] = {
        status: 'fluent',
        medianMs: 900,
        streak: 5,
        interval: 14,
        nextDue: '2027-01-01',
      }
    }
    const out = composeSprint({ facts, count: 30, today: '2026-08-02', rand: lcg(11) })
    const newOnes = [...new Set(out.filter((id) => facts[id]!.status === 'new'))]
    for (const id of newOnes) {
      expect(FACT_ORDER.indexOf(id)).toBeLessThan(20 + newOnes.length)
    }
  })

  it('같은 입력과 같은 시드면 같은 결과다', () => {
    const a = composeSprint({ facts: allNew(), count: 30, today: '2026-08-02', rand: lcg(99) })
    const b = composeSprint({ facts: allNew(), count: 30, today: '2026-08-02', rand: lcg(99) })
    expect(a).toEqual(b)
  })

  it('낼 수 있는 식이 하나뿐이어도 개수를 채운다', () => {
    const facts = allNew()
    for (const id of FACT_IDS) {
      facts[id] = {
        status: 'fluent',
        medianMs: 900,
        streak: 5,
        interval: 14,
        nextDue: '2027-01-01',
      }
    }
    facts['7×8'] = { status: 'learning', medianMs: 4000, streak: 0, interval: 1, nextDue: null }
    const out = composeSprint({ facts, count: 30, today: '2026-08-02', rand: lcg(5) })
    expect(out).toHaveLength(30)
    expect(out.filter((id) => id === '7×8').length).toBeGreaterThan(0)
  })
})

describe('requeueWrong', () => {
  it('틀린 식을 몇 문제 뒤에 다시 넣는다', () => {
    const out = requeueWrong(['a', 'b', 'c', 'd', 'e', 'f'], '7×8', 4)
    expect(out).toEqual(['a', 'b', 'c', 'd', '7×8', 'e', 'f'])
  })

  it('남은 문제가 간격보다 적으면 맨 뒤에 붙인다', () => {
    expect(requeueWrong(['a'], '7×8', 4)).toEqual(['a', '7×8'])
    expect(requeueWrong([], '7×8', 4)).toEqual(['7×8'])
  })

  it('원본 배열을 변형하지 않는다', () => {
    const original = ['a', 'b']
    requeueWrong(original, '7×8', 1)
    expect(original).toEqual(['a', 'b'])
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/engine/facts.test.ts`
Expected: FAIL — `composeSprint is not a function` 또는 import 해결 실패

- [ ] **Step 3: 구현**

`src/engine/facts.ts` 끝에 덧붙인다 (`randInt` import 추가):

```ts
import { randInt } from './rand'
```

```ts
/** 배분: learning 60% / due인 fluent 25% / 신규 15%. */
const SHARE_LEARNING = 0.6
const SHARE_FLUENT = 0.25

function shuffled<T>(xs: T[], rand: () => number): T[] {
  const out = [...xs]
  for (let i = out.length - 1; i > 0; i--) {
    const j = randInt(0, i, rand)
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

/**
 * 그날 스프린트에 낼 식 목록. 같은 식이 여러 번 나올 수 있다 — 그것이 드릴이다.
 *
 * 신규는 **배분량만큼만** 새로 꺼낸다. 첫날 30문제를 서로 다른 식으로 채우면 구구단을
 * 처음 만나는 아이에게 81식을 한꺼번에 들이미는 셈이 된다. 대신 소수의 새 식을
 * 반복해서 채운다.
 */
export function composeSprint(input: {
  facts: Record<string, FactState>
  count: number
  today: string
  rand?: () => number
}): string[] {
  const rand = input.rand ?? Math.random
  const { facts, count, today } = input

  const learning = FACT_ORDER.filter((id) => facts[id]?.status === 'learning')
  const fluentDue = FACT_ORDER.filter(
    (id) =>
      facts[id]?.status === 'fluent' && facts[id]!.nextDue !== null && facts[id]!.nextDue! <= today,
  )
  const fluentNotDue = FACT_ORDER.filter(
    (id) =>
      facts[id]?.status === 'fluent' &&
      !(facts[id]!.nextDue !== null && facts[id]!.nextDue! <= today),
  )
  // 신규는 도입 순서를 지켜야 하므로 섞지 않고 앞에서부터 자른다.
  const fresh = FACT_ORDER.filter((id) => facts[id]?.status === 'new')

  const wantLearning = Math.round(count * SHARE_LEARNING)
  const wantFluent = Math.round(count * SHARE_FLUENT)
  const wantNew = count - wantLearning - wantFluent

  const picked: string[] = []
  picked.push(...shuffled(learning, rand).slice(0, wantLearning))
  picked.push(...shuffled(fluentDue, rand).slice(0, wantFluent))
  picked.push(...fresh.slice(0, wantNew))

  // 부족분은 **이미 고른 것들만** 반복해 채운다. 새 식을 더 꺼내지도 않고,
  // 아직 때가 안 된 fluent를 끌어오지도 않는다 — 그러면 간격 반복이 무의미해진다.
  let pools = [
    picked.filter((id) => facts[id]?.status === 'learning'),
    picked.filter((id) => facts[id]?.status === 'new'),
    picked.filter((id) => facts[id]?.status === 'fluent'),
  ].filter((pool) => pool.length > 0)

  if (pools.length === 0) {
    // 81식이 전부 fluent이고 오늘 due인 것이 하나도 없는 상태. 쉬게 두는 대신
    // 가장 먼저 돌아올 식부터 미리 복습한다.
    const soonest = [...fluentNotDue].sort((p, q) =>
      (facts[p]!.nextDue ?? '').localeCompare(facts[q]!.nextDue ?? ''),
    )
    if (soonest.length === 0) {
      // facts가 비었다는 뜻 — 계약 위반이므로 시끄럽게 실패한다.
      throw new Error('composeSprint: 낼 수 있는 식이 없다')
    }
    pools = [soonest]
  }

  let poolIndex = 0
  let cursor = 0
  while (picked.length < count) {
    const pool = pools[poolIndex % pools.length]!
    picked.push(pool[cursor % pool.length]!)
    poolIndex++
    if (poolIndex % pools.length === 0) cursor++
  }

  return shuffled(picked.slice(0, count), rand)
}

/**
 * 틀린 식을 같은 세션 뒤쪽에 다시 넣는다.
 * 즉시 재도전은 단기기억으로 맞히는 것이라 훈련이 되지 않으므로 몇 문제를 사이에 둔다.
 */
export function requeueWrong(remaining: string[], fact: string, gap = 4): string[] {
  const at = Math.min(gap, remaining.length)
  return [...remaining.slice(0, at), fact, ...remaining.slice(at)]
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/engine/facts.test.ts`
Expected: 24개 PASS (Task 1의 14개 + 신규 10개).

- [ ] **Step 5: 전체 확인과 커밋**

```bash
npx vitest run && npx tsc --noEmit && npx prettier --check .
git add src/engine/facts.ts src/engine/facts.test.ts
git commit -m "feat(engine): 스프린트 출제 배분과 오답 재투입 추가"
```

---

### Task 3: 스프린트 기준 연속일수

**Files:**

- Create: `src/engine/streak.ts`, `src/engine/streak.test.ts`

**Interfaces:**

- Consumes: `Day` (types), `shiftDay` (dates)
- Produces: `sprintStreak(days: Day[], today: string): number`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/engine/streak.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { sprintStreak } from './streak'
import type { Day } from '../data/types'

function day(date: string, didSprint: boolean): Day {
  return {
    date,
    kind: 'normal',
    sheet: [],
    ...(didSprint ? { sprint: [{ fact: '2×2', correct: true, ms: 900 }] } : {}),
  }
}

describe('sprintStreak', () => {
  it('기록이 없으면 0이다', () => {
    expect(sprintStreak([], '2026-08-10')).toBe(0)
  })

  it('연속으로 한 날을 센다', () => {
    const days = [day('2026-08-08', true), day('2026-08-09', true), day('2026-08-10', true)]
    expect(sprintStreak(days, '2026-08-10')).toBe(3)
  })

  it('오늘 아직 안 했어도 어제까지의 연속은 유지된다', () => {
    const days = [day('2026-08-08', true), day('2026-08-09', true)]
    expect(sprintStreak(days, '2026-08-10')).toBe(2)
  })

  it('하루 빠진 것은 봐준다', () => {
    const days = [day('2026-08-07', true), day('2026-08-09', true), day('2026-08-10', true)]
    expect(sprintStreak(days, '2026-08-10')).toBe(3)
  })

  it('이틀 연속 빠지면 거기서 끊는다', () => {
    const days = [
      day('2026-08-01', true),
      day('2026-08-02', true),
      day('2026-08-09', true),
      day('2026-08-10', true),
    ]
    expect(sprintStreak(days, '2026-08-10')).toBe(2)
  })

  it('종이만 하고 스프린트를 안 한 날은 세지 않는다', () => {
    const days = [day('2026-08-09', false), day('2026-08-10', true)]
    expect(sprintStreak(days, '2026-08-10')).toBe(1)
  })

  it('빈 sprint 배열은 안 한 것으로 본다', () => {
    const empty: Day = { date: '2026-08-10', kind: 'normal', sheet: [], sprint: [] }
    expect(sprintStreak([empty], '2026-08-10')).toBe(0)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/engine/streak.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

`src/engine/streak.ts`:

```ts
import type { Day } from '../data/types'
import { shiftDay } from './dates'

/** 연속이 끊기기 전까지 봐주는 결석 일수. */
const FORGIVEN_GAPS = 1

/** 되짚어 볼 최대 일수. 아이가 몇 년을 써도 남는 안전장치다. */
const MAX_LOOKBACK = 800

/**
 * 스프린트를 한 날의 연속 횟수.
 *
 * 종이 채점이 아니라 **스프린트 완료**를 기준으로 세는 이유: 여행이나 늦은 날에도 3분은
 * 할 수 있어 아이에게 보이는 불꽃이 잘 안 꺼진다. 종이까지 포함한 정직한 숫자는
 * 홈 화면의 `✅ N일 완료`가 따로 보여준다.
 *
 * 하루 빠진 것은 봐준다 — 아픈 날은 한 달에 한두 번 반드시 생기고, 그때마다 0이 되면
 * 다시 쌓을 의욕을 잃는다. 이틀 연속 빠지면 끊는다.
 */
export function sprintStreak(days: Day[], today: string): number {
  const done = new Set(
    days.filter((d) => d.sprint !== undefined && d.sprint.length > 0).map((d) => d.date),
  )
  if (done.size === 0) return 0

  let streak = 0
  let gaps = 0
  let cursor = today

  for (let i = 0; i < MAX_LOOKBACK; i++) {
    if (done.has(cursor)) {
      streak += 1
      gaps = 0
    } else if (cursor === today) {
      // 오늘은 아직 하루가 끝나지 않았다. 안 한 것을 결석으로 세지 않는다.
    } else {
      gaps += 1
      if (gaps > FORGIVEN_GAPS) break
    }
    cursor = shiftDay(cursor, -1)
  }

  return streak
}
```

- [ ] **Step 4: 통과 확인과 커밋**

```bash
npx vitest run src/engine/streak.test.ts   # 7개 PASS
npx vitest run && npx tsc --noEmit && npx prettier --check .
git add src/engine/streak.ts src/engine/streak.test.ts
git commit -m "feat(engine): 스프린트 기준 연속일수 추가"
```

---

### Task 4: 구구단 정복 지도

**Files:**

- Create: `src/screens/fact-map.ts`
- Modify: `src/styles/app.css`

**Interfaces:**

- Consumes: `FactState` (types), `factId` (facts)
- Produces: `factMapHtml(facts: Record<string, FactState>, newlyFluent?: Set<string>): string`

> 이 함수는 **HTML 문자열만** 돌려준다. DOM에 붙이지 않는다 — Phase 3의 주간 리포트가 같은 격자를 인쇄물에 그대로 쓴다.

- [ ] **Step 1: 스타일 추가**

`src/styles/app.css` 끝에 덧붙인다:

```css
.factmap {
  display: grid;
  grid-template-columns: repeat(10, 1fr);
  gap: 2px;
  max-width: 320px;
  margin: 0 auto 10px;
}
.factmap .head {
  font-size: 10px;
  color: var(--muted);
  text-align: center;
  line-height: 20px;
  font-weight: 700;
}
.factmap .cell {
  aspect-ratio: 1;
  border: 1px solid var(--line);
  border-radius: 2px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  color: #bbb;
}
.factmap .cell.fluent {
  background: var(--fg);
  border-color: var(--fg);
  color: #fff;
  font-weight: 700;
}
.factmap .cell.fresh {
  background: #fff;
  border: 2px solid var(--fg);
  color: var(--fg);
  font-weight: 700;
}
.factmap .cell.learning {
  background: #e0e0e0;
  border-color: #c4c4c4;
}
.factmap-legend {
  display: flex;
  gap: 12px;
  justify-content: center;
  font-size: 10px;
  color: var(--muted);
  margin-bottom: 10px;
}
.factmap-legend i {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 2px;
  vertical-align: -1px;
  margin-right: 3px;
  border: 1px solid var(--line);
}
.factmap-score {
  text-align: center;
  font-size: 20px;
  font-weight: 800;
}
.factmap-score em {
  font-style: normal;
  font-size: 12px;
  color: var(--muted);
  font-weight: 400;
}
```

- [ ] **Step 2: 구현**

`src/screens/fact-map.ts`:

```ts
import type { FactState } from '../data/types'
import { factId } from '../engine/facts'

/**
 * 81칸 구구단 지도를 HTML 문자열로 만든다.
 *
 * **정복한 칸에만 답이 보인다.** 아직 못 외운 칸은 비어 있어, 벽에 붙여둬도 컨닝이 되지
 * 않고 목표가 "구구단 외우기"에서 "빈칸을 채워 나가기"로 바뀐다. 부수 효과로 3×5를
 * 정복하면 5×3도 같이 칠해져 대각선 대칭이 눈에 보인다.
 *
 * DOM을 건드리지 않고 문자열만 돌려준다 — Phase 3의 주간 리포트가 이 격자를 그대로
 * 인쇄물에 쓴다.
 */
export function factMapHtml(
  facts: Record<string, FactState>,
  newlyFluent: Set<string> = new Set(),
): string {
  const cells: string[] = ['<div class="head">×</div>']
  for (let b = 1; b <= 9; b++) cells.push(`<div class="head">${b}</div>`)

  for (let a = 1; a <= 9; a++) {
    cells.push(`<div class="head">${a}</div>`)
    for (let b = 1; b <= 9; b++) {
      const id = factId(a, b)
      const status = facts[id]?.status ?? 'new'
      if (newlyFluent.has(id)) {
        cells.push(`<div class="cell fresh">${a * b}</div>`)
      } else if (status === 'fluent') {
        cells.push(`<div class="cell fluent">${a * b}</div>`)
      } else if (status === 'learning') {
        cells.push(`<div class="cell learning"></div>`)
      } else {
        cells.push(`<div class="cell"></div>`)
      }
    }
  }

  const fluentCount = Object.values(facts).filter((f) => f.status === 'fluent').length

  return `
    <div class="factmap">${cells.join('')}</div>
    <div class="factmap-legend">
      <span><i style="background:var(--fg);border-color:var(--fg)"></i>정복</span>
      <span><i style="background:#fff;border:2px solid var(--fg)"></i>새로!</span>
      <span><i style="background:#e0e0e0;border-color:#c4c4c4"></i>연습 중</span>
      <span><i></i>아직</span>
    </div>
    <div class="factmap-score">${fluentCount} <em>/ 81 칸</em></div>`
}
```

- [ ] **Step 3: 타입 검사와 커밋**

테스트는 쓰지 않는다 — 화면 렌더는 `engine/`이 아니고, 이 함수의 유일한 로직(상태 → 클래스 매핑)은 Task 6의 화면 확인에서 눈으로 검증한다.

```bash
npx tsc --noEmit && npx prettier --check .
git add src/screens/fact-map.ts src/styles/app.css
git commit -m "feat(screens): 구구단 정복 지도 렌더러 추가"
```

---

### Task 5: 스프린트 화면

**Files:**

- Create: `src/screens/sprint.ts`
- Modify: `src/styles/app.css`

**Interfaces:**

- Consumes: `getDay`/`putDay`/`getMeta`/`getAllDays` (db), `dayKey` (dates), `deriveFacts`/`composeSprint`/`requeueWrong` (facts), `factMapHtml` (fact-map), `el`/`navigate`/`showError`/`clearError` (ui)
- Produces: `renderSprint(root: HTMLElement): Promise<void>`

- [ ] **Step 1: 스타일 추가**

`src/styles/app.css` 끝에 덧붙인다:

```css
.sprint-progress {
  display: flex;
  gap: 3px;
  margin-bottom: 28px;
}
.sprint-progress i {
  flex: 1;
  height: 6px;
  border-radius: 3px;
  background: var(--line);
}
.sprint-progress i.done {
  background: var(--fg);
}
.sprint-q {
  font-size: 56px;
  font-weight: 800;
  text-align: center;
  letter-spacing: 0.02em;
  font-variant-numeric: tabular-nums;
}
.sprint-a {
  font-size: 40px;
  font-weight: 700;
  text-align: center;
  height: 56px;
  margin: 12px 0 28px;
  font-variant-numeric: tabular-nums;
}
.sprint-a.reveal {
  color: var(--muted);
}
.keypad {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  max-width: 320px;
  margin: 0 auto;
}
.keypad button {
  aspect-ratio: 3 / 2;
  font-size: 26px;
  font-weight: 700;
  border: 1.5px solid var(--fg);
  border-radius: 10px;
  background: #fff;
  color: var(--fg);
  cursor: pointer;
}
.keypad button:active {
  background: var(--fg);
  color: #fff;
}
.sprint-done {
  text-align: center;
  font-size: 17px;
  font-weight: 700;
  margin: 14px 0 20px;
}
```

- [ ] **Step 2: 구현**

`src/screens/sprint.ts`:

```ts
import { getAllDays, getDay, getMeta, putDay } from '../data/db'
import { dayKey } from '../engine/dates'
import { composeSprint, deriveFacts, requeueWrong } from '../engine/facts'
import { factMapHtml } from './fact-map'
import { el, navigate, showError } from '../ui'
import type { Day, FactState, SprintAttempt } from '../data/types'

/** 정답을 보여주는 시간. 즉시 넘기면 무엇이 맞았는지 볼 틈이 없다. */
const REVEAL_MS = 1500

/** 틀린 식을 몇 문제 뒤에 다시 넣는가. */
const REQUEUE_GAP = 4

function answerOf(id: string): number {
  const [a, b] = id.split('×').map(Number)
  return a! * b!
}

function progressHtml(total: number, done: number): string {
  return Array.from({ length: total }, (_, i) => `<i class="${i < done ? 'done' : ''}"></i>`).join(
    '',
  )
}

function mean(xs: number[]): number | null {
  if (xs.length === 0) return null
  return xs.reduce((s, x) => s + x, 0) / xs.length
}

/** 어제까지의 정답 반응시간 평균. 오늘과 비교해 "얼마나 빨라졌는지"를 보여준다. */
function previousMean(days: Day[], today: string): number | null {
  const before = days.filter((d) => d.date < today && d.sprint && d.sprint.length > 0)
  const last = before[before.length - 1]
  if (!last?.sprint) return null
  return mean(last.sprint.filter((a) => a.correct).map((a) => a.ms))
}

function backOnly(root: HTMLElement, message: string): void {
  root.replaceChildren(
    el(`<div><p class="date">${message}</p><button class="step" id="back">← 홈</button></div>`),
  )
  root.querySelector('#back')!.addEventListener('click', () => navigate('#/'))
}

export async function renderSprint(root: HTMLElement): Promise<void> {
  const today = dayKey(new Date())

  // 본문 전체를 하나의 try로 감싼다. getMeta/getAllDays가 밖에 있으면 IndexedDB 실패 시
  // 예외가 main.ts의 route()로 올라가고, 거기서는 showError만 부르므로 #app이 빈 채로
  // 남는다 — 북마크로 #/sprint에 바로 들어온 경우 갈 곳이 없어진다.
  try {
    const meta = await getMeta()
    const days = await getAllDays()
    const existing = await getDay(today)

    if (existing?.sprint && existing.sprint.length > 0) {
      const facts = deriveFacts(days, meta.settings.fluentMs)
      renderResult(root, facts, new Set(), existing.sprint, previousMean(days, today))
      return
    }

    const facts = deriveFacts(days, meta.settings.fluentMs)
    const queue = composeSprint({ facts, count: meta.settings.sprintCount, today })
    if (queue.length === 0) {
      backOnly(root, '오늘 낼 문제를 만들지 못했어요.')
      return
    }

    runSession(root, queue, facts, days, today, existing, meta.settings.fluentMs)
  } catch (e) {
    showError(`스프린트를 열지 못했어요: ${(e as Error).message}`)
    backOnly(root, '')
  }
}

function runSession(
  root: HTMLElement,
  initialQueue: string[],
  factsBefore: Record<string, FactState>,
  days: Day[],
  today: string,
  existing: Day | undefined,
  fluentMs: number,
): void {
  const total = initialQueue.length
  let queue = [...initialQueue]
  const attempts: SprintAttempt[] = []
  const requeued = new Set<string>()

  let current = ''
  let typed = ''
  let shownAt = 0
  let firstKeyAt = 0
  let locked = false

  root.replaceChildren(
    el(`
      <div>
        <div class="sprint-progress" id="bar"></div>
        <div class="sprint-q" id="q"></div>
        <div class="sprint-a" id="a"></div>
        <div class="keypad" id="pad">
          ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button data-key="${n}">${n}</button>`).join('')}
          <button data-key="back">←</button>
          <button data-key="0">0</button>
          <button data-key="ok">✓</button>
        </div>
      </div>
    `),
  )

  const bar = root.querySelector<HTMLDivElement>('#bar')!
  const qEl = root.querySelector<HTMLDivElement>('#q')!
  const aEl = root.querySelector<HTMLDivElement>('#a')!

  function paint(): void {
    bar.innerHTML = progressHtml(total, attempts.length)
    qEl.textContent = current.replace('×', ' × ')
    aEl.textContent = typed
    aEl.classList.remove('reveal')
  }

  function next(): void {
    const head = queue.shift()
    if (head === undefined) {
      void finish()
      return
    }
    current = head
    typed = ''
    // 반응시간은 문제가 보인 순간부터 첫 숫자 키까지다. 확인 버튼까지의 시간은
    // 손가락 속도라 노이즈이므로 제외한다.
    shownAt = performance.now()
    firstKeyAt = 0
    locked = false
    paint()
  }

  function submit(): void {
    if (typed === '' || locked) return
    locked = true
    const correct = Number(typed) === answerOf(current)
    const ms = Math.round((firstKeyAt || performance.now()) - shownAt)
    attempts.push({ fact: current, correct, ms })

    if (correct) {
      next()
      return
    }

    // 오답: 빨간 X 대신 정답을 보여주고, 같은 세션 뒤쪽에 다시 넣는다.
    // 즉시 재도전은 단기기억으로 맞히는 것이라 훈련이 되지 않는다.
    aEl.textContent = String(answerOf(current))
    aEl.classList.add('reveal')
    if (!requeued.has(current)) {
      requeued.add(current)
      queue = requeueWrong(queue, current, REQUEUE_GAP)
    }
    window.setTimeout(next, REVEAL_MS)
  }

  root.querySelector('#pad')!.addEventListener('click', (event) => {
    const key = (event.target as HTMLElement).dataset['key']
    if (key === undefined || locked) return
    if (key === 'ok') return submit()
    if (key === 'back') {
      typed = typed.slice(0, -1)
      paint()
      return
    }
    if (typed.length >= 2) return
    if (firstKeyAt === 0) firstKeyAt = performance.now()
    typed += key
    paint()
  })

  async function finish(): Promise<void> {
    // 세션 전체가 끝났을 때만 저장한다. 중간에 나가면 없던 일이 된다 —
    // 부분 세션은 반응시간 통계를 오염시킨다(전화 받다 8초 뒤에 누른 값이 섞인다).
    const day: Day = existing
      ? { ...existing, sprint: attempts }
      : { date: today, kind: 'normal', sheet: [], sprint: attempts }
    try {
      await putDay(day)
    } catch (e) {
      showError(`스프린트 결과를 저장하지 못했어요: ${(e as Error).message}`)
      backOnly(root, '')
      return
    }

    // days는 날짜 오름차순이어야 한다. today가 가장 늦은 날짜이므로 끝에 붙인다.
    const after = deriveFacts([...days.filter((d) => d.date !== today), day], fluentMs)
    const newly = new Set(
      Object.keys(after).filter(
        (id) => after[id]!.status === 'fluent' && factsBefore[id]?.status !== 'fluent',
      ),
    )
    renderResult(root, after, newly, attempts, previousMean(days, today))
  }

  next()
}

function renderResult(
  root: HTMLElement,
  facts: Record<string, FactState>,
  newly: Set<string>,
  attempts: SprintAttempt[],
  prevMean: number | null,
): void {
  const todayMean = mean(attempts.filter((a) => a.correct).map((a) => a.ms))
  let line = '오늘도 해냈어요!'
  if (todayMean !== null && prevMean !== null) {
    const delta = (prevMean - todayMean) / 1000
    line =
      delta >= 0.05
        ? `어제보다 ${delta.toFixed(1)}초 빨라졌어요 🚀`
        : `평균 ${(todayMean / 1000).toFixed(1)}초로 풀었어요`
  } else if (todayMean !== null) {
    line = `평균 ${(todayMean / 1000).toFixed(1)}초로 풀었어요`
  }

  root.replaceChildren(
    el(`
      <div>
        <div class="sprint-done">${line}</div>
        ${newly.size > 0 ? `<div class="sprint-done">새로 정복한 식 ${newly.size}개!</div>` : ''}
        ${factMapHtml(facts, newly)}
        <button class="step" id="back">← 홈</button>
      </div>
    `),
  )
  root.querySelector('#back')!.addEventListener('click', () => navigate('#/'))
}
```

> **결과 화면은 정답 개수를 강조하지 않는다.** 속도 변화만 보여준다. 정답 개수를 앞세우면
> 아이가 안전한 식만 빨리 누르고 어려운 식에 시간을 쓰지 않는다. 같은 이유로 **진행 중에는
> 타이머를 표시하지 않는다** — 시간 압박은 인출을 느리게 만들어, 측정하려던 값이 측정 행위
> 때문에 오염된다.

- [ ] **Step 3: 라우트 추가**

`src/main.ts`의 `route()`에 분기를 넣는다 (기존 `#/print`·`#/grade`는 그대로):

```ts
    } else if (hash.startsWith('#/sprint')) {
      const { renderSprint } = await import('./screens/sprint')
      await renderSprint(app)
    } else if (hash.startsWith('#/grade')) {
```

- [ ] **Step 4: 개발 서버로 확인**

```bash
npm run dev
```

`http://localhost:5173/haruchi/#/sprint` 에서 확인:

- 진행바가 30칸이고 한 문제 풀 때마다 한 칸씩 찬다
- 두 자리 답을 입력할 수 있고 `←`로 지워진다
- **타이머가 어디에도 안 보인다**
- 일부러 틀리면 정답이 1.5초 보이고 넘어가며, 그 식이 몇 문제 뒤에 다시 나온다
- 30문제를 끝내면 결과 화면에 속도 문구와 81칸 지도가 뜬다
- 홈으로 갔다가 다시 `#/sprint`로 오면 **다시 풀지 않고 결과 화면이 뜬다**
- 중간에 홈으로 나갔다가 다시 들어오면 **처음부터** 시작한다 (부분 세션은 저장하지 않는다)

- [ ] **Step 5: 커밋**

```bash
npx tsc --noEmit && npx prettier --check . && npx vitest run
git add src/screens/sprint.ts src/styles/app.css src/main.ts
git commit -m "feat(screens): 구구단 스프린트 화면 추가"
```

---

### Task 6: 홈 통합과 🔥 연속일수

**Files:**

- Modify: `src/screens/home.ts`, `src/main.ts`

**Interfaces:**

- Consumes: `sprintStreak` (streak), `deriveFacts` (facts), `factMapHtml` (fact-map)
- Produces: 홈에 세 번째 버튼과 🔥 연속일수, `#/map` 라우트

- [ ] **Step 1: 홈 화면 수정**

`src/screens/home.ts`의 import에 추가:

```ts
import { sprintStreak } from '../engine/streak'
```

`renderHome` 안에서 오늘 상태를 읽는 부분에 스프린트 여부를 더한다:

```ts
const sprinted = Boolean(todayDay?.sprint && todayDay.sprint.length > 0)
```

`✅ N일 완료` 줄을 두 숫자로 바꾼다:

```html
<div class="streak">
  🔥 ${sprintStreak(days, today)}일 연속 &nbsp;·&nbsp; ✅ ${completedCount(days)}일 완료
</div>
```

인쇄 버튼과 채점 버튼 **사이에** 스프린트 버튼을 넣는다 (종이를 먼저 풀고 스프린트를 하는 순서):

```html
<button class="step ${sprinted ? 'done' : ''}" id="sprint">
  ${sprinted ? '✓ ' : ''}구구단 스프린트
  <small>${meta.settings.sprintCount}문제 · 3분</small>
</button>
```

그리고 지도 링크를 채점 버튼 아래에 놓는다:

```html
<button class="step" id="map">구구단 지도 보기</button>
```

핸들러를 잇는다:

```ts
root.querySelector('#sprint')!.addEventListener('click', () => navigate('#/sprint'))
root.querySelector('#map')!.addEventListener('click', () => navigate('#/map'))
```

- [ ] **Step 2: 지도 라우트 추가**

`src/main.ts`의 `route()`에 분기를 넣는다:

```ts
    } else if (hash.startsWith('#/map')) {
      const { renderMap } = await import('./screens/map')
      await renderMap(app)
```

`src/screens/map.ts` 생성:

```ts
import { getAllDays, getMeta } from '../data/db'
import { deriveFacts } from '../engine/facts'
import { factMapHtml } from './fact-map'
import { el, navigate, showError } from '../ui'

/** 지도만 보는 화면. 스프린트를 하지 않고도 진척을 확인할 수 있다. */
export async function renderMap(root: HTMLElement): Promise<void> {
  try {
    const meta = await getMeta()
    const days = await getAllDays()
    const facts = deriveFacts(days, meta.settings.fluentMs)

    root.replaceChildren(
      el(`
        <div>
          <h1>구구단 지도</h1>
          ${factMapHtml(facts)}
          <button class="step" id="back">← 홈</button>
        </div>
      `),
    )
    root.querySelector('#back')!.addEventListener('click', () => navigate('#/'))
  } catch (e) {
    showError(`지도를 열지 못했어요: ${(e as Error).message}`)
    root.replaceChildren(el(`<div><button class="step" id="back">← 홈</button></div>`))
    root.querySelector('#back')!.addEventListener('click', () => navigate('#/'))
  }
}
```

- [ ] **Step 3: 손으로 한 바퀴 확인**

```bash
npm run dev
```

`http://localhost:5173/haruchi/` 에서:

- 홈에 버튼이 넷(인쇄 / 스프린트 / 채점 / 지도)
- 스프린트를 끝내면 홈의 스프린트 버튼에 `✓`, `🔥 1일 연속`
- `구구단 지도 보기`로 들어가면 지금까지의 지도가 보인다
- 새로고침해도 유지된다

- [ ] **Step 4: 커밋**

```bash
npx tsc --noEmit && npx prettier --check . && npx vitest run && npm run build
git add src/screens/home.ts src/screens/map.ts src/main.ts
git commit -m "feat(screens): 홈에 스프린트·지도 연결과 연속일수 표시"
```

---

### Task 7: 스프린트를 포함한 다중일 시뮬레이션

**Files:**

- Modify: `src/engine/simulation.test.ts`

**Interfaces:**

- Consumes: `deriveFacts`/`composeSprint` (facts), `sprintStreak` (streak), 기존 시뮬레이션 헬퍼

> Phase 1의 Critical(`openTags`가 숙달 유형을 회수하던 버그)은 **모듈별 테스트는 전부 통과하는데 여러 날에 걸쳐 맞물릴 때만 드러나는** 종류였다. 스프린트도 같은 위험이 있다 — 간격 반복이 식을 굶기거나, 유창 판정이 영원히 안 나거나, 배분이 한쪽으로 쏠릴 수 있다.

- [ ] **Step 1: 실패하는 테스트 작성**

`src/engine/simulation.test.ts` 끝에 덧붙인다:

```ts
describe('스프린트 다중일 시뮬레이션', () => {
  function runSprints(options: {
    days: number
    seed: number
    correctRate: number
    fluentMs: number
    ms: () => number
  }) {
    const rand = lcg(options.seed)
    const log: Day[] = []
    const fluentCounts: number[] = []

    for (let d = 0; d < options.days; d++) {
      const date = shiftDay('2026-08-01', d)
      const facts = deriveFacts(log, options.fluentMs)
      const queue = composeSprint({ facts, count: 30, today: date, rand })
      const attempts = queue.map((fact) => ({
        fact,
        correct: rand() < options.correctRate,
        ms: options.ms(),
      }))
      log.push({ date, kind: 'normal', sheet: [], sprint: attempts })
      fluentCounts.push(
        Object.values(deriveFacts(log, options.fluentMs)).filter((f) => f.status === 'fluent')
          .length,
      )
    }
    return { log, fluentCounts }
  }

  it('빠르고 정확한 아이는 81식을 모두 정복한다', () => {
    const sim = runSprints({
      days: 120,
      seed: 2026,
      correctRate: 0.97,
      fluentMs: 2500,
      ms: () => 1200,
    })
    expect(sim.fluentCounts[sim.fluentCounts.length - 1]).toBe(81)
  })

  it('정복한 식 수는 날이 갈수록 크게 줄지 않는다', () => {
    const sim = runSprints({
      days: 90,
      seed: 7,
      correctRate: 0.95,
      fluentMs: 2500,
      ms: () => 1500,
    })
    // 간격 반복 중 우연한 오답으로 몇 개가 강등되는 것은 정상이다.
    // 하루 만에 대량으로 무너지면 배분이나 판정이 잘못된 것이다.
    for (let i = 1; i < sim.fluentCounts.length; i++) {
      const drop = sim.fluentCounts[i - 1]! - sim.fluentCounts[i]!
      expect(drop).toBeLessThanOrEqual(6)
    }
  })

  it('느린 아이는 정답이어도 fluent가 되지 않는다', () => {
    const sim = runSprints({
      days: 40,
      seed: 3,
      correctRate: 1,
      fluentMs: 2500,
      ms: () => 4000,
    })
    expect(sim.fluentCounts[sim.fluentCounts.length - 1]).toBe(0)
  })

  it('간격 반복이 오래된 식을 굶기지 않는다', () => {
    const sim = runSprints({
      days: 60,
      seed: 11,
      correctRate: 0.97,
      fluentMs: 2500,
      ms: () => 1200,
    })
    const lastSeen: Record<string, number> = {}
    sim.log.forEach((day, i) => {
      for (const a of day.sprint ?? []) lastSeen[a.fact] = i
    })
    const seen = Object.keys(lastSeen)
    expect(seen.length).toBe(81)
    // 마지막 21일 안에 모든 식이 한 번은 나와야 한다 (최장 간격 14일 + 여유).
    for (const id of seen) {
      expect(sim.log.length - 1 - lastSeen[id]!).toBeLessThanOrEqual(21)
    }
  })

  it('매일 한 아이의 연속일수는 날짜 수와 같다', () => {
    const sim = runSprints({
      days: 30,
      seed: 5,
      correctRate: 0.9,
      fluentMs: 2500,
      ms: () => 1500,
    })
    expect(sprintStreak(sim.log, shiftDay('2026-08-01', 29))).toBe(30)
  })
})
```

`import`에 `deriveFacts`, `composeSprint`, `sprintStreak`, `shiftDay`를 추가한다.

- [ ] **Step 2: 실패 확인 후 통과 확인**

Run: `npx vitest run src/engine/simulation.test.ts`

이 테스트들은 Task 1~3이 이미 구현돼 있으므로 곧바로 통과해야 한다. **통과하지 않으면 그것이 발견이다** — 단위 테스트는 통과하는데 여러 날에 걸치면 깨지는 경우이므로, 테스트를 고치지 말고 보고하라.

- [ ] **Step 3: 전체 확인과 커밋**

```bash
npx vitest run && npx tsc --noEmit && npx prettier --check . && npm run build
git add src/engine/simulation.test.ts
git commit -m "test(engine): 스프린트 다중일 시뮬레이션 추가"
```

---

## 완료 후: 실물 확인

Phase 3으로 넘어가기 전에 아이패드에서 확인한다.

- [ ] 스프린트 30문제를 **아빠가 직접** 끝까지 해본다. 자기 반응시간이 1초 안쪽으로 나오는지 — 측정 코드가 틀렸다면 여기서 드러난다
- [ ] 8살 손가락 기준으로 키패드가 충분히 큰지
- [ ] 3분 안에 끝나는지. 크게 넘으면 `sprintCount`를 줄인다
- [ ] 지도의 검은 칸이 아이에게 실제로 동기가 되는지 — 되지 않으면 Phase 3의 인쇄 지도 설계를 다시 본다

## Phase 2 이후

- **Phase 3** — 전략 존·문장제로 종이 2장 완성, 주간/월간 리포트(지도 인쇄 포함), JSON 백업, 4주 점검의 날, mood 기반 자동 하향

### Phase 2에서 의도적으로 미룬 것

| 항목                                            | 어디로                                                |
| ----------------------------------------------- | ----------------------------------------------------- |
| 지도 인쇄 (냉장고용)                            | Phase 3 — `factMapHtml`을 그대로 재사용한다           |
| 주간 리포트의 "가장 느린 식"                    | Phase 3 — `day.sprint`에서 직접 계산한다              |
| `schemaVersion`/`algoVersion` 마이그레이션 배선 | Phase 3 — `Day`에 필수 필드가 생길 때 처음 필요해진다 |
| `mood` 기반 자동 하향                           | Phase 3                                               |
