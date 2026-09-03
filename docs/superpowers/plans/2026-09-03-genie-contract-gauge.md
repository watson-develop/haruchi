# 지니 계약 공개 · 차오르는 램프 · 소원 기록 — 구현계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 아이가 지니 보상의 조건·보상·진척을 알게 하고(계약 공개 + 역대 최고 게이지),
72칸 도달 뒤 소원을 한 번만 주는 상태 기계를 만든다.

**Architecture:** 정복 판정(`deriveFacts`)은 그대로 두고, 같은 시도 처리 함수
(`applyAttempt`)를 공유하는 새 순수 함수 `peakFluent`(역대 최고 정복 수)를 더한다. 화면은
`genieState(peak, wishGrantedAt)` 하나로 `teaser`/`lit`/`trophy`를 판정한다. 소원을 들어준
사실만 `Settings.wishGrantedAt`에 저장한다 — 그것은 파생이 아니라 아빠의 행동이다.

**Tech Stack:** TypeScript, 바닐라 DOM, vitest, IndexedDB, SEED CSS 토큰. 실행 코드 의존성 0.

**Spec:** `docs/superpowers/specs/2026-09-03-genie-contract-gauge-design.md`

## Global Constraints

- **Node 경로**: 모든 npm 명령 전에 `export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH"`
- **파생값을 저장하지 않는다.** `peakFluent`·`genieState`는 매번 계산한다. `Meta.derived`에
  아무것도 쓰지 않는다. `wishGrantedAt`은 파생이 아니라 사람의 행동이라 예외가 아니다
- **단일 출처**: 72는 `FACT_IDS.length`, 램프 모양은 `ui.ts`의 `lampSvg`, 색은
  `var(--seed-*)` 토큰(hex 리터럴 금지, 단 SVG 안의 기존 리터럴은 그대로)
- **아이 소속 화면은 부모 화면으로 링크하지 않는다.** 이 작업이 만드는 `navigate` 목적지는
  `#/genie` 하나뿐
- **`putMeta(meta, changed)`는 바꾼 묶음을 선언한다.** 소원 기록은 `['settings']`
- **테스트는 `src/engine/`에만.** DOM·화면 테스트는 하지 않는다
- **커밋 전 `npm run format`**, `npx prettier --check .`가 CI와 같은 검사
- 아이 문구는 반말·격려체, 부모 문구는 해요체
- 인라인 style에 넣는 값은 반드시 `number` 연산의 결과여야 한다(문자열이면 XSS 경계)

---

### Task 1: 엔진 — `applyAttempt` 추출 · `peakFluent` · `genieState`

**Files:**

- Modify: `src/engine/facts.ts` (deriveFacts 73~117행 부근)
- Test: `src/engine/facts.test.ts` (파일 끝에 describe 3개 추가)

**Interfaces:**

- Consumes: 기존 `FACT_IDS`, `STREAK_TARGET`, `median`, `nextInterval`, `shiftDay`
- Produces:
  - `export function peakFluent(days: Day[], fluentMs: number): number`
  - `export type GenieState = 'teaser' | 'lit' | 'trophy'`
  - `export function genieState(peak: number, wishGrantedAt: string | null | undefined): GenieState`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/engine/facts.test.ts` 끝에 붙인다. 파일 상단 import에 `peakFluent`, `genieState`를 더한다.

```ts
// ── peakFluent 헬퍼 ──

/** 시도 배열에 같은 sid를 붙인다. 세션 경계 테스트용. */
function withSid(attempts: SprintAttempt[], id: string): SprintAttempt[] {
  return attempts.map((a) => ({ ...a, sid: id }))
}

/** 시드 고정 난수(속성 테스트용). */
function rng(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return s / 0x7fffffff
  }
}

describe('peakFluent', () => {
  it('빈 로그는 0이다', () => {
    expect(peakFluent([], 2500)).toBe(0)
  })

  it('sprint 키가 없는 날만 있으면 0이다', () => {
    // sprintDay는 sprint: []를 만들므로 여기서는 리터럴로 만든다 — 두 모양은 다르다.
    const days: Day[] = [{ date: '2026-08-01', kind: 'normal', sheet: [] }]
    expect(peakFluent(days, 2500)).toBe(0)
  })

  it('sprint가 빈 배열인 날만 있으면 0이다', () => {
    expect(peakFluent([sprintDay('2026-08-01', [])], 2500)).toBe(0)
  })

  it('내려간 뒤에도 최고값을 기억한다 (현재 값과 다르다)', () => {
    // 경계값 2500으로 fluent를 만든다 — 유창 게이트가 <= 인지 < 인지를 이 픽스처가 가른다.
    const day1 = sprintDay('2026-08-01', [
      hit('2×3', 2500),
      hit('2×3', 2500),
      hit('2×3', 2500),
      hit('2×4', 2500),
      hit('2×4', 2500),
      hit('2×4', 2500),
      hit('2×5', 2500),
      hit('2×5', 2500),
      hit('2×5', 2500),
    ])
    const day2 = sprintDay('2026-08-02', [miss('2×5')])
    const days = [day1, day2]
    expect(peakFluent(days, 2500)).toBe(3)
    const now = Object.values(deriveFacts(days, 2500)).filter((f) => f.status === 'fluent').length
    expect(now).toBe(2)
  })

  it('점검이 깎아도 최고값은 점검 전 값이다', () => {
    const day1 = sprintDay('2026-08-01', [
      hit('2×3', 2500),
      hit('2×3', 2500),
      hit('2×3', 2500),
      hit('2×4', 2500),
      hit('2×4', 2500),
      hit('2×4', 2500),
    ])
    const checkup: Day = {
      date: '2026-08-02',
      kind: 'checkup',
      sheet: [],
      sprint: [miss('2×3'), miss('2×4')],
    }
    expect(peakFluent([day1, checkup], 2500)).toBe(2)
    expect(
      Object.values(deriveFacts([day1, checkup], 2500)).filter((f) => f.status === 'fluent').length,
    ).toBe(0)
  })

  it('같은 날 두 세션이면 세션 경계마다 센다 (날 끝만 보지 않는다)', () => {
    const a = withSid(
      [
        hit('2×3', 1000),
        hit('2×3', 1000),
        hit('2×3', 1000),
        hit('2×4', 1000),
        hit('2×4', 1000),
        hit('2×4', 1000),
        hit('2×5', 1000),
        hit('2×5', 1000),
        hit('2×5', 1000),
      ],
      'd1:100',
    )
    const b = withSid([miss('2×4'), miss('2×5')], 'd2:200')
    const days = [sprintDay('2026-08-01', [...a, ...b])]
    expect(peakFluent(days, 2500)).toBe(3) // a 세션 끝에 3
    expect(Object.values(deriveFacts(days, 2500)).filter((f) => f.status === 'fluent').length).toBe(
      1,
    ) // 날 끝은 1
  })

  it('sid가 없는 옛 기록은 하루가 한 세션이다', () => {
    const days = [
      sprintDay('2026-08-01', [
        hit('2×3', 1000),
        hit('2×3', 1000),
        hit('2×3', 1000),
        hit('2×4', 1000),
        hit('2×4', 1000),
        hit('2×4', 1000),
        hit('2×5', 1000),
        hit('2×5', 1000),
        hit('2×5', 1000),
        miss('2×4'),
        miss('2×5'),
      ]),
    ]
    expect(peakFluent(days, 2500)).toBe(1) // 날 끝 한 번만
  })

  it('알 수 없는 식 id가 섞여도 던지지 않는다', () => {
    const days = [
      sprintDay('2026-08-01', [
        hit('7x8', 1000), // ASCII x — 건너뜀
        hit('2×3', 1000),
        hit('12×13', 1000),
        hit('2×3', 1000),
        hit('2×3', 1000),
      ]),
    ]
    expect(peakFluent(days, 2500)).toBe(1)
  })

  it('속성: 현재 fluent 수 이상이고, 날별 재계산의 최댓값과 같다', () => {
    const rand = rng(2026)
    for (let trial = 0; trial < 200; trial++) {
      const days: Day[] = []
      for (let d = 0; d < 6; d++) {
        const attempts: SprintAttempt[] = []
        for (let i = 0; i < 12; i++) {
          const id = FACT_IDS[Math.floor(rand() * FACT_IDS.length)]!
          const r = rand()
          // 오답과 느린 정답을 반드시 섞는다 — 전부 정답이면 peak가 마지막 값과 같아져
          // "마지막 값을 돌려주는" 변이를 이 테스트가 못 잡는다.
          attempts.push(r < 0.25 ? miss(id) : hit(id, r < 0.5 ? 4000 : 1000))
        }
        days.push(sprintDay(shiftDay('2026-08-01', d), attempts)) // sid 없음 = 경계가 날 끝뿐
      }
      const fast = peakFluent(days, 2500)
      const nowCount = Object.values(deriveFacts(days, 2500)).filter(
        (f) => f.status === 'fluent',
      ).length
      expect(fast).toBeGreaterThanOrEqual(nowCount)
      let slow = 0
      for (let k = 1; k <= days.length; k++) {
        const n = Object.values(deriveFacts(days.slice(0, k), 2500)).filter(
          (f) => f.status === 'fluent',
        ).length
        if (n > slow) slow = n
      }
      expect(fast).toBe(slow)
    }
  })
})

describe('genieState', () => {
  it('소원 전에는 peak가 전부일 때만 lit이다', () => {
    expect(genieState(0, null)).toBe('teaser')
    expect(genieState(FACT_IDS.length - 1, null)).toBe('teaser')
    expect(genieState(FACT_IDS.length, null)).toBe('lit')
    expect(genieState(FACT_IDS.length, undefined)).toBe('lit')
  })

  it('소원을 들어준 뒤에는 peak와 무관하게 trophy다', () => {
    expect(genieState(FACT_IDS.length, '2026-11-03')).toBe('trophy')
    expect(genieState(10, '2026-11-03')).toBe('trophy')
    expect(genieState(0, '2026-11-03')).toBe('trophy')
  })
})
```

`src/engine/facts.test.ts` 상단 import를 이렇게 고친다(`shiftDay` 추가 필요):

```ts
import {
  FACT_IDS,
  factId,
  factAnswer,
  deriveFacts,
  STREAK_TARGET,
  composeSprint,
  requeueWrong,
  newlyFluentSince,
  allFluent,
  peakFluent,
  genieState,
} from './facts'
import { shiftDay } from './dates'
```

- [ ] **Step 2: 실패를 확인한다**

```bash
export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH"
npx vitest run src/engine/facts.test.ts
```

Expected: FAIL — `peakFluent`·`genieState`가 export되지 않았다는 오류.

- [ ] **Step 3: `deriveFacts`에서 `applyAttempt`를 뽑고 `peakFluent`·`genieState`를 더한다**

`src/engine/facts.ts`의 `deriveFacts`(73행부터)를 **통째로** 아래로 바꾼다. 그 아래
`newlyFluentSince`·`allFluent`는 그대로 두고, `allFluent` 뒤에 `peakFluent`·`genieState`를
붙인다.

```ts
/**
 * 시도 하나를 상태에 접는다 — **유창 판정의 유일한 주인**.
 * deriveFacts와 peakFluent가 같은 이 함수를 접으므로 기준(STREAK_TARGET·중앙값·사다리)을
 * 고치면 둘이 함께 움직인다. 사본을 만들면 게이지와 지도가 다른 규칙으로 판정한다.
 *
 * 알 수 없는 식 id를 **여기서** 건너뛴다. 호출부에 남기면 새 호출부가 그걸 빠뜨리고,
 * 실기기 로그의 1×n 시도(아래 FACT_IDS 주석)에서 던져 화면이 통째로 에러가 된다.
 */
function applyAttempt(
  facts: Record<string, FactState>,
  run: Record<string, number[]>,
  attempt: SprintAttempt,
  date: string,
  fluentMs: number,
): void {
  const state = facts[attempt.fact]
  const history = run[attempt.fact]
  if (!state || !history) return // 알 수 없는 식은 의도적으로 무시한다. 모든 화면이 이 함수에서 파생하므로,
  // 여기서 throw하면 기기의 복구 경로 없이 앱 전체가 열리지 않는다. "계약 위반은 시끄럽게 실패한다"의 의도적 예외.

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
    state.nextDue = shiftDay(date, state.interval)
  } else {
    state.interval = 1
    state.nextDue = null
  }
}

/** 72식의 초기 상태와 연속 정답 버퍼. deriveFacts와 peakFluent가 같은 출발점을 쓴다. */
function emptyFactState(): { facts: Record<string, FactState>; run: Record<string, number[]> } {
  const facts: Record<string, FactState> = {}
  const run: Record<string, number[]> = {}
  for (const id of FACT_IDS) {
    facts[id] = { status: 'new', medianMs: null, streak: 0, interval: 1, nextDue: null }
    run[id] = []
  }
  return { facts, run }
}

export function deriveFacts(days: Day[], fluentMs: number): Record<string, FactState> {
  const { facts, run } = emptyFactState()
  for (const day of days) {
    if (!day.sprint) continue
    for (const attempt of day.sprint) applyAttempt(facts, run, attempt, day.date, fluentMs)
  }
  return facts
}
```

`allFluent` 아래에 붙인다:

```ts
/**
 * 역대 최고 정복 수 — 지니 램프의 게이지와 점등 조건(genieState)이 쓴다.
 *
 * **세션 경계마다** 센다(날 끝이 아니라). 두 기기의 같은 날 세션은 mergeSprint가 sid
 * 시작 시각 순으로 이어 붙이므로, 날 끝만 보면 아이패드 세션 끝에 아이가 본 20이
 * 뒤에 붙은 다른 기기 세션 때문에 17로 낮아진다 — 게이지가 아이가 본 값보다 내려간다.
 * 경계마다 세면 한 기기에서는 "아이가 화면에서 본 값의 최댓값"과 정확히 같다(같은 날
 * 두 기기가 섞이면 근사다 — 화면이 본 순서와 저장 순서가 다를 수 있다).
 *
 * 저장하지 않는다(derived 비배선과 같은 원칙) — 로그가 잘리거나 fluentMs가 오르면
 * 이 값도 소급해 내려간다. 그래도 소원을 들어준 사실은 genieState가 따로 들고 있다.
 */
export function peakFluent(days: Day[], fluentMs: number): number {
  const { facts, run } = emptyFactState()
  let peak = 0
  let live = 0 // 지금 fluent인 식 수. applyAttempt 전후의 status 차이로만 움직인다.

  for (const day of days) {
    if (!day.sprint || day.sprint.length === 0) continue
    for (let i = 0; i < day.sprint.length; i++) {
      const attempt = day.sprint[i]!
      const before = facts[attempt.fact]?.status
      applyAttempt(facts, run, attempt, day.date, fluentMs)
      const after = facts[attempt.fact]?.status
      if (before !== after) {
        if (after === 'fluent') live += 1
        else if (before === 'fluent') live -= 1
      }
      // 세션 경계 = 다음 시도의 sid가 다른 지점, 그리고 날 끝.
      const next = day.sprint[i + 1]
      if (next === undefined || next.sid !== attempt.sid) {
        if (live > peak) peak = live
      }
    }
  }
  return peak
}

/** 지니와 램프의 세 상태. */
export type GenieState = 'teaser' | 'lit' | 'trophy'

/**
 * 램프·지니 상태의 **단일 출처**. 화면 셋(#/map · 스프린트 결과 · #/genie)과 부모 홈이
 * 같은 함수를 부른다 — 한 화면이 따로 판정하면 램프는 켜졌는데 #/genie가 닫히는
 * 어긋남이 생기고, 화면 테스트가 없어 잡을 수 없다.
 *
 * 오늘 allFluent인지는 보지 않는다. 정복은 최근 성적이라 도달 뒤에도 3일 중 1일쯤은
 * 72가 아니고, 그때마다 램프가 꺼지면 "채우면 소원"이라는 약속이 거짓이 된다.
 */
export function genieState(peak: number, wishGrantedAt: string | null | undefined): GenieState {
  if (wishGrantedAt != null) return 'trophy'
  return peak >= FACT_IDS.length ? 'lit' : 'teaser'
}
```

`facts.ts` 최상단 import에 `SprintAttempt`를 더한다:

```ts
import type { Day, FactState, SprintAttempt } from '../data/types'
```

- [ ] **Step 4: 테스트 통과를 확인한다**

```bash
export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH"
npx vitest run src/engine/facts.test.ts
```

Expected: PASS (기존 `deriveFacts` 테스트 전부 포함).

- [ ] **Step 5: 변이 검증 2종을 실측한다**

각각 따로 넣고 돌린 뒤 **반드시 원복**한다. 결과를 계획서에 적지 말고 눈으로 확인한다.

1. `applyAttempt`의 `med <= fluentMs` → `med < fluentMs`.
   기대: `내려간 뒤에도 최고값을 기억한다`·`점검이 깎아도`·기존 `정확히 기준값이면 fluent다`가
   **함께** 빨개진다(주인이 하나라는 증거). 속성 테스트는 두 함수가 같이 움직이므로
   **초록으로 남는 것이 정상**이다.
2. `peakFluent`의 `if (live > peak) peak = live` → `peak = live`(마지막 경계 값).
   기대: `내려간 뒤에도`·`점검이 깎아도`·`같은 날 두 세션`·속성 테스트가 빨개진다.

- [ ] **Step 6: 커밋**

```bash
export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH"
npm run format
git add src/engine/facts.ts src/engine/facts.test.ts
git commit -m "$(cat <<'EOF'
feat(engine): peakFluent·genieState — 역대 최고 정복 수와 램프 상태

deriveFacts의 시도 처리를 applyAttempt로 뽑아 유창 판정의 주인을 하나로 두고,
peakFluent가 같은 함수를 접어 세션 경계마다 최고값을 센다. 날 끝만 보면 두 기기의
같은 날 세션이 합쳐질 때 게이지가 아이가 본 값보다 내려간다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Uv3n5QXvBtiKYtJCGtbVqq
EOF
)"
```

---

### Task 2: 저장 — `Settings.wishGrantedAt`과 백업 검증

**Files:**

- Modify: `src/data/types.ts` (`Settings` 타입, `DEFAULT_SETTINGS`)
- Modify: `src/engine/backup.ts` (`validateBackup`의 settings 검사 끝)
- Test: `src/engine/backup.test.ts`

**Interfaces:**

- Consumes: 없음
- Produces: `Settings.wishGrantedAt?: string | null` — `'YYYY-MM-DD'` 또는 `null`/부재

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/engine/backup.test.ts`에 붙인다. 이 파일이 이미 쓰는 유효 payload 생성 헬퍼의 이름을
먼저 확인하고(`grep -n "validateBackup(" src/engine/backup.test.ts | head`), 그 헬퍼로
settings를 덮어써 6케이스를 만든다. 헬퍼가 없으면 아래처럼 직접 만든다.

```ts
describe('wishGrantedAt 검증', () => {
  const payload = (wish: unknown): unknown => ({
    app: 'haruchi',
    schemaVersion: 1,
    exportedAt: '2026-11-03T10:00:00.000Z',
    days: [],
    meta: {
      derived: { facts: {}, types: {}, strategies: {} },
      settings: { ...DEFAULT_SETTINGS, ...(wish === undefined ? {} : { wishGrantedAt: wish }) },
    },
  })

  it('키가 없으면 통과한다 (옛 백업·옛 기기)', () => {
    const s = { ...DEFAULT_SETTINGS } as Record<string, unknown>
    delete s['wishGrantedAt']
    const raw = payload(undefined) as Record<string, unknown>
    ;((raw['meta'] as Record<string, unknown>)['settings'] as Record<string, unknown>) = s
    expect(validateBackup(raw).ok).toBe(true)
  })

  it('null이면 통과한다', () => {
    expect(validateBackup(payload(null)).ok).toBe(true)
  })

  it('YYYY-MM-DD면 통과한다', () => {
    expect(validateBackup(payload('2026-11-03')).ok).toBe(true)
  })

  it('빈 문자열은 거부한다', () => {
    expect(validateBackup(payload('')).ok).toBe(false)
  })

  it('형식이 다른 문자열은 거부한다 (formatDate가 NaN을 그린다)', () => {
    expect(validateBackup(payload('11월 3일')).ok).toBe(false)
  })

  it('숫자는 거부한다', () => {
    expect(validateBackup(payload(20261103)).ok).toBe(false)
  })
})
```

파일 상단 import에 `DEFAULT_SETTINGS`가 없으면 더한다:
`import { DEFAULT_SETTINGS } from '../data/types'`

- [ ] **Step 2: 실패를 확인한다**

```bash
export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH"
npx vitest run src/engine/backup.test.ts
```

Expected: FAIL — 거부해야 할 세 케이스(`''`·`'11월 3일'`·숫자)가 통과한다.

- [ ] **Step 3: 타입과 검증을 더한다**

`src/data/types.ts`의 `Settings`에서 `lastExportedAt` 바로 아래에 넣는다:

```ts
  lastExportedAt: string | null
  /**
   * 아빠가 소원을 들어준 날(`dayKey` 형식) — 없으면 아직이다.
   *
   * **파생이 아니다.** 로그를 다시 읽어 만들 수 없는, 아빠가 앱 밖에서 한 행동의 기록이라
   * derived 비배선 원칙의 예외가 아니라 애초에 대상이 아니다. 이 값이 있으면 램프는
   * 트로피가 되고 지니는 소원을 다시 약속하지 않는다(engine/facts.ts의 genieState).
   *
   * 선택 필드다 — 옛 기기의 저장본과 옛 백업·서버 payload에는 키가 없다. 읽는 쪽은
   * 전부 `?? null`을 거친다. 형식은 validateBackup이 지킨다(빈 문자열도 거부).
   */
  wishGrantedAt?: string | null
```

`DEFAULT_SETTINGS`의 `lastExportedAt: null,` 아래에:

```ts
  wishGrantedAt: null,
```

`src/engine/backup.ts`의 `lastExportedAt` 검사 **바로 뒤**, `return { ok: true, ... }` 앞에:

```ts
// 선택 필드 — 키가 없으면 옛 백업·옛 기기다. 있으면 형식까지 본다: 문자열이기만 하면
// 통과시키면 손상·조작 payload가 부모 홈에 "NaN월 NaN일 undefined요일"을 그린다
// (ui.ts의 formatDate는 split('-').map(Number)만 한다). pull도 이 검증을 타므로
// 서버를 경유한 기형 값도 여기서 막힌다.
if (
  s['wishGrantedAt'] !== undefined &&
  s['wishGrantedAt'] !== null &&
  (typeof s['wishGrantedAt'] !== 'string' || !DATE_RE.test(s['wishGrantedAt']))
)
  return bad(
    `meta.settings.wishGrantedAt가 YYYY-MM-DD 또는 null이 아니다: ${JSON.stringify(s['wishGrantedAt'])}`,
  )
```

- [ ] **Step 4: 통과를 확인한다**

```bash
export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH"
npx vitest run src/engine/backup.test.ts && npm test
```

Expected: 전부 PASS.

- [ ] **Step 5: 커밋**

```bash
export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH"
npm run format
git add src/data/types.ts src/engine/backup.ts src/engine/backup.test.ts
git commit -m "$(cat <<'EOF'
feat: Settings.wishGrantedAt — 소원을 들어준 날을 기록한다

선택 필드라 옛 백업·옛 기기의 payload는 그대로 통과한다. 문자열이기만 하면
통과시키지 않고 YYYY-MM-DD까지 보는 이유는 pull도 같은 검증을 타기 때문이다 —
기형 값이 들어오면 부모 홈이 "NaN월 NaN일"을 그린다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Uv3n5QXvBtiKYtJCGtbVqq
EOF
)"
```

---

### Task 3: 아이 화면 블록 — 게이지 램프와 세 상태

**Files:**

- Modify: `src/ui.ts` (`genieEntryHtml`·`wireGenieEntry` 약 634~669행, `lampSvg` 위에 상수 추가)
- Modify: `src/styles/app.css` (약 1105~1140행의 `.genie-teaser*` 규칙, reduced-motion 목록)

**Interfaces:**

- Consumes: Task 1의 `GenieState`, `FACT_IDS`
- Produces:
  - `genieEntryHtml(state: GenieState, peak: number): string`
  - `wireGenieEntry(root: HTMLElement): void` (시그니처 불변)

- [ ] **Step 1: `ui.ts`의 지니 블록을 바꾼다**

`src/ui.ts` 상단 import에 더한다:

```ts
import { FACT_IDS, type GenieState } from './engine/facts'
```

(이미 `./engine/...`을 import하는 줄이 있으면 그 곁에 둔다. `ui.ts`가 engine을 부르는 것은
방향이 맞다 — engine은 DOM을 모르고 ui는 engine을 안다.)

`genieEntryHtml`·`wireGenieEntry`를 통째로 아래로 바꾼다:

```ts
/**
 * 지니 입구 블록 — 상태 셋(engine/facts.ts의 genieState가 판정한다).
 *
 * - teaser: 실루엣 램프가 peak만큼 차오르고 계약 문구를 말한다. 탭하면 꿈틀 + 둘째 줄
 * - lit:    빛나는 초대. 탭하면 #/genie
 * - trophy: 가득 찬 램프(빛나지 않음). 탭하면 #/genie — 지니는 나오되 소원을 다시
 *           약속하지 않는다. 죽은 버튼을 두지 않는 이유이자, 아빠가 아이보다 먼저
 *           「소원 들어줬어요」를 눌러도 아이가 연출을 잃지 않는 이유다
 *
 * 지도(map.ts)와 스프린트 결과(sprint.ts)가 같은 블록을 쓴다 — ITEM_MARKS와 같은 이유로
 * 여기가 단일 출처다. **아이 소속 화면 전용**: navigate 목적지는 #/genie 하나뿐이라
 * 소속 불변식을 깨지 않는다. 렌더 뒤 반드시 wireGenieEntry(root)로 핸들러를 붙일 것.
 */
export function genieEntryHtml(state: GenieState, peak: number): string {
  if (state === 'lit') {
    return `<button class="genie-lamp-invite" id="genie">🪔 램프를 문질러 봐!</button>`
  }
  if (state === 'trophy') {
    return `<button class="genie-trophy" id="genie">
              ${gaugeHtml(FACT_IDS.length, '요술 램프 — 소원을 들어줬어요')}
              <span class="genie-teaser-text">지니가 소원을 들어줬어</span>
            </button>`
  }
  return `<button class="genie-teaser" id="genie-teaser">
            ${gaugeHtml(peak, `요술 램프 — ${FACT_IDS.length}칸 중 ${peak}칸`)}
            <span class="genie-teaser-text">구구단 ${FACT_IDS.length}칸을 다 채우면 지니가 소원을 들어줘!</span>
          </button>`
}

/**
 * 램프 게이지 — 실루엣 위에 원색 램프를 겹치고 바닥부터 peak만큼만 보인다.
 *
 * clip-path를 SVG가 아니라 이 span에 건다. iOS Safari가 SVG 루트의 clip-path를 사용자
 * 좌표계로 해석한 이력이 있어, HTML 박스에 걸면 그 의문 자체가 사라진다.
 * aria-label은 여기(role="img")에 둔다 — 바깥 button에 두면 자손 이름을 대체해
 * 계약 문구가 낭독되지 않는다.
 */
function gaugeHtml(peak: number, label: string): string {
  return `<span class="genie-gauge" role="img" aria-label="${label}" style="--genie-clip:${lampClipTop(peak)}%">
            ${lampSvg('genie-gauge-base')}
            <span class="genie-gauge-fill" aria-hidden="true">${lampSvg('genie-gauge-lamp')}</span>
          </span>`
}

/** genieEntryHtml의 짝 — 초대·트로피는 #/genie로, 티저는 꿈틀 + 둘째 줄. */
export function wireGenieEntry(root: HTMLElement): void {
  root.querySelector('#genie')?.addEventListener('click', () => {
    // 제스처 안에서 오디오를 깨워야 다음 화면(#/genie)의 효과음이 난다(iOS).
    unlockAudio()
    navigate('#/genie')
  })
  const teaser = root.querySelector('#genie-teaser')
  teaser?.addEventListener('click', () => {
    hapticTap()
    // 애니메이션 재시작 트릭: 클래스를 뗐다 붙이는 사이에 리플로를 강제한다.
    teaser.classList.remove('poked')
    void (teaser as HTMLElement).offsetWidth
    teaser.classList.add('poked')
    // 계약 문구를 **교체하지 않는다** — 8살이 가장 먼저 하는 행동이 이 블록의 존재
    // 이유인 한 줄을 지우면 안 된다. 둘째 줄로 덧붙이고, 두 번째 탭부터는 꿈틀만.
    if (!teaser.querySelector('.genie-teaser-hint')) {
      const hint = document.createElement('span')
      hint.className = 'genie-teaser-hint'
      hint.textContent = '지니가 램프 안에서 기다리고 있어'
      teaser.querySelector('.genie-teaser-text')!.append(hint)
    }
  })
}
```

`lampSvg` 바로 **위**에 상수와 계산 함수를 둔다(모양의 주인 곁):

```ts
/**
 * lampSvg 그림의 세로 경계 — viewBox(0 0 220 110) 안에서 램프가 실제로 그려진 범위다.
 * 위 20%·아래 7%가 빈 공간이라, 게이지를 박스 기준으로 자르면 peak 1~5는 아무것도
 * 안 보이고 57~71은 이미 가득 차 보인다 — 게이지를 둔 이유(60→72 정체 구간을 견디게
 * 한다)가 바로 그 구간에서 무력해진다. **SVG 경로를 고치면 이 세 값도 함께 고친다.**
 */
const LAMP_VIEW_H = 110
const LAMP_ART_TOP = 22
const LAMP_ART_BOTTOM = 102

/**
 * peak를 clip-path inset의 상단 %로. peak 0 → 92.7%(전부 가림), 21 → 71.5%,
 * 60 → 32.1%, 72 → 20.0%(전부 보임). 1칸은 그림 높이의 1/72이고 최소 두께를 만들지
 * 않는다 — 게이지가 실제보다 차 보이면 화면이 거짓말을 한다.
 */
function lampClipTop(peak: number): number {
  const filled = Math.min(Math.max(peak / FACT_IDS.length, 0), 1)
  const top = LAMP_ART_TOP + (LAMP_ART_BOTTOM - LAMP_ART_TOP) * (1 - filled)
  return Math.round((1000 * top) / LAMP_VIEW_H) / 10
}
```

- [ ] **Step 2: CSS를 바꾼다**

`src/styles/app.css`에서 `.genie-teaser-lamp` 규칙(약 1122행)을 **지우고** 그 자리에 아래를
넣는다. `.genie-teaser`·`.genie-teaser-text` 규칙은 그대로 둔다.

```css
/* 게이지 래퍼 — 실루엣(base) 위에 원색(fill)을 겹친다. position:relative가 없으면
 * .genie-teaser의 flex가 SVG 둘을 나란히 놓는다. display:block은 inline SVG의
 * 베이스라인 여백을 없앤다(여백이 남으면 clip 계산이 그림과 어긋난다). */
.genie-gauge {
  position: relative;
  display: block;
  width: 64px;
  flex-shrink: 0;
}
.genie-gauge svg {
  display: block;
  width: 100%;
}
.genie-gauge-base {
  filter: grayscale(1) brightness(0.45) opacity(0.85);
}
/* --genie-clip은 ui.ts의 lampClipTop이 만든 숫자 + '%'다. 단위가 빠지면 inset()이
 * 무효가 되어 위층이 통째로 보이고, 모든 아이에게 가득 찬 램프가 뜬다. */
.genie-gauge-fill {
  position: absolute;
  inset: 0;
  -webkit-clip-path: inset(var(--genie-clip) 0 0 0);
  clip-path: inset(var(--genie-clip) 0 0 0);
}
/* 탭 반응은 계약 문구를 지우지 않고 둘째 줄로 붙는다(ui.ts의 wireGenieEntry). */
.genie-teaser-hint {
  display: block;
  margin-top: var(--seed-dimension-x1);
  color: var(--seed-color-fg-neutral-subtle);
}
/* 트로피 — 램프는 가득 찼고 빛나지 않는다. 누르면 지니가 나오므로 버튼이다.
 * genie-glow도, 티저의 점선 테두리도 물려받지 않는다. */
.genie-trophy {
  display: flex;
  width: 100%;
  align-items: center;
  gap: var(--seed-dimension-x3);
  margin: var(--seed-dimension-x4) 0 var(--seed-dimension-x3);
  padding: var(--seed-dimension-x3) var(--seed-dimension-x4);
  border: none;
  border-radius: var(--seed-radius-r2);
  background: var(--seed-color-bg-layer-default);
  cursor: pointer;
}
```

같은 파일에서 두 셀렉터를 고친다:

1. reduced-motion 목록(약 1102행)의 `.genie-teaser.poked .genie-teaser-lamp` →
   `.genie-teaser.poked .genie-gauge`
2. 꿈틀 규칙(약 1132행)의 `.genie-teaser.poked .genie-teaser-lamp` →
   `.genie-teaser.poked .genie-gauge`

(주석에 적힌 특정도 설명 "`.genie-teaser-lamp`만 넣으면 …"의 클래스 이름도 함께 고친다.)

- [ ] **Step 3: 타입 검사로 호출부가 깨진 것을 확인한다**

```bash
export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH"
npx tsc --noEmit
```

Expected: FAIL — `map.ts`·`sprint.ts`가 `genieEntryHtml(boolean)`을 부른다는 오류 2건.
이것이 Task 4의 출발점이다. **여기서 커밋하지 않는다** — 빌드가 깨진 상태다.

---

### Task 4: 아이 화면 배선 — 지도 · 스프린트 결과 · `#/genie`

**Files:**

- Modify: `src/screens/map.ts:20-35`
- Modify: `src/screens/sprint.ts` (55~~75행 재진입, 270~~315행 종료 경로, 314행 `renderResult`)
- Modify: `src/screens/genie.ts:20-40`

**Interfaces:**

- Consumes: `genieEntryHtml(state, peak)`, `peakFluent`, `genieState`
- Produces: 없음(화면 종단)

- [ ] **Step 1: `map.ts`를 고친다**

import 줄:

```ts
import { deriveFacts, genieState, newlyFluentSince, peakFluent } from '../engine/facts'
```

(`allFluent`는 더 이상 이 화면이 쓰지 않는다 — 지운다.)

`facts`를 만드는 줄 아래에 더하고, `genieEntryHtml` 호출을 바꾼다:

```ts
const facts = deriveFacts(days, meta.settings.fluentMs)
const peak = peakFluent(days, meta.settings.fluentMs)
const state = genieState(peak, meta.settings.wishGrantedAt)
const fresh = new Set(newlyFluentSince(days, meta.settings.fluentMs, dayKey(new Date())))
```

```ts
          ${genieEntryHtml(state, peak)}
```

- [ ] **Step 2: `sprint.ts`를 고친다**

import에서 `allFluent`를 빼고 `genieState`·`peakFluent`를 넣는다:

```ts
import {
  composeSprint,
  deriveFacts,
  factAnswer,
  genieState,
  newlyFluentSince,
  peakFluent,
  requeueWrong,
} from '../engine/facts'
```

`renderResult`의 시그니처에 두 인자를 더한다(`facts` 바로 뒤):

```ts
function renderResult(
  root: HTMLElement,
  facts: Record<string, FactState>,
  state: GenieState,
  peak: number,
  newly: Set<string>,
  attempts: SprintAttempt[],
  prevMean: number | null,
  onRetry: (() => void) | null = null,
): void {
```

`GenieState` 타입 import를 더한다: `import type { GenieState } from '../engine/facts'`
(값 import 줄과 합쳐도 된다 — `import { ..., type GenieState } from '../engine/facts'`).

본문의 호출을 바꾼다:

```ts
        ${genieEntryHtml(state, peak)}
```

**호출부 셋을 각각 고친다. 로그가 다르다는 것이 요점이다.**

① 재진입 경로(약 61~72행, 오늘 이미 한 날) — 저장본 `days`가 맞다:

```ts
const days = await getAllDays()
const facts = deriveFacts(days, meta.settings.fluentMs)
const peak = peakFluent(days, meta.settings.fluentMs)
renderResult(
  root,
  facts,
  genieState(peak, meta.settings.wishGrantedAt),
  peak,
  new Set(newlyFluentSince(days, meta.settings.fluentMs, today)),
  existing.sprint!,
  previousMean(days, today),
)
```

(기존 인자 순서를 유지하되 `facts` 뒤에 `state`·`peak`를 끼운다. 실제 변수명은 그 자리의
코드를 따른다.)

②·③ 세션 종료 경로(약 277~310행) — `after`를 만든 것과 **같은 배열**로 계산한다.
`getAllDays()`를 다시 부르면 방금 끝난 세션이 아직 저장 전이라 빠진다:

```ts
// days는 날짜 오름차순이어야 한다. today가 가장 늦은 날짜이므로 끝에 붙인다.
const merged = [...days.filter((d) => d.date !== today), day]
const after = deriveFacts(merged, fluentMs)
const peak = peakFluent(merged, fluentMs)
const state = genieState(peak, meta.settings.wishGrantedAt)
```

그리고 두 `renderResult(...)` 호출에 `state, peak`를 `after` 뒤에 넣는다:

```ts
renderResult(root, after, state, peak, newly, attempts, previousMean(days, today), null)
```

```ts
renderResult(root, after, state, peak, newly, attempts, previousMean(days, today), onRetry)
```

`runSession`이 `meta`를 못 받고 있으면 `fluentMs`처럼 `wishGrantedAt`도 인자로 넘긴다 —
`runSession(root, queue, facts, days, today, existing, meta.settings.fluentMs, checkup, sid)`
호출에 `meta.settings.wishGrantedAt ?? null`을 더하고 시그니처에
`wishGrantedAt: string | null`을 더하는 쪽이 가장 좁은 변경이다.

- [ ] **Step 3: `genie.ts`의 가드와 말풍선을 고친다**

import:

```ts
import { deriveFacts, genieState, peakFluent } from '../engine/facts'
```

(`deriveFacts`가 더 이상 필요 없으면 지운다 — `peakFluent`만 쓴다면 `deriveFacts` 제거.)

가드와 말풍선:

```ts
const meta = await getMeta()
const days = await getAllDays()
const state = genieState(peakFluent(days, meta.settings.fluentMs), meta.settings.wishGrantedAt)
if (state === 'teaser') {
  navigate('#/')
  return
}
// 연출은 같고 말풍선만 다르다. 소원은 한 번짜리라, 이미 들어준 뒤에 지니가 또
// "소원을 말해봐"라고 하면 화면이 지키지 못할 약속을 하는 것이다(원칙 3).
const bubble =
  state === 'trophy'
    ? '소원을 들어줬지!<br /><strong>고마워, 또 놀러 와</strong>'
    : '구구단을 모두 정복했구나!<br /><strong>원하는 소원을 말해봐!</strong>'
```

템플릿 안의 말풍선을 `${bubble}`로 바꾼다. 주석의 "진입 가드" 문단도 새 조건으로 고친다.

- [ ] **Step 4: 빌드와 테스트를 확인한다**

```bash
export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH"
npm run build && npm test
```

Expected: 둘 다 PASS.

- [ ] **Step 5: 커밋**

```bash
export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH"
npm run format
git add src/ui.ts src/styles/app.css src/screens/map.ts src/screens/sprint.ts src/screens/genie.ts
git commit -m "$(cat <<'EOF'
feat: 램프가 계약을 말하고 역대 최고만큼 차오른다

티저가 「72칸을 다 채우면 지니가 소원을 들어줘!」라고 직접 말하고, 실루엣 램프가
peakFluent만큼 채워진다. 채움은 박스가 아니라 그림 경계(y 22~102)에 사상한다 —
박스 기준이면 1~5칸은 안 보이고 57~71칸은 이미 가득 차 보여, 게이지를 둔 이유인
정체 구간에서 아무것도 안 움직인다.

트로피 상태에서도 #/genie가 열리고 말풍선만 바뀐다. 아빠가 아이보다 먼저
「소원 들어줬어요」를 눌러도 아이가 연출을 잃지 않는다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Uv3n5QXvBtiKYtJCGtbVqq
EOF
)"
```

---

### Task 5: 부모 홈 — 소원 기록과 되돌리기

**Files:**

- Modify: `src/screens/home-parent.ts` (import, 렌더 준비부 약 200~~210행, 알림 영역 약 265~~287행,
  `.ptail` 약 296행, 핸들러 약 320~330행)

**Interfaces:**

- Consumes: `peakFluent`, `genieState`, `putMeta`, `toast`, `dayKey`, `formatDate`
- Produces: 없음(화면 종단)

- [ ] **Step 1: import를 더한다**

```ts
import {
  getAllDays,
  getDeviceState,
  getMeta,
  getOutbox,
  putMeta,
  updateDeviceState,
} from '../data/db'
import { genieState, peakFluent } from '../engine/facts'
```

`'../ui'` import 줄에 `toast`를 더한다.

- [ ] **Step 2: 상태를 계산한다**

`const checkupDate = checkupNoticeDate(days, today)` 아래에 넣는다:

```ts
// 소원 기록(설계 `specs/2026-09-03-genie-contract-gauge-design.md`). wishGrantedAt이
// 있으면 트로피라 peak와 무관하므로 재생을 건너뛴다 — 부모 홈이 deriveFacts류를
// 부르는 첫 사례이고, 안 불러도 되는 날은 안 부른다.
const wish = meta.settings.wishGrantedAt ?? null
const genie = genieState(wish === null ? peakFluent(days, meta.settings.fluentMs) : 0, wish)
```

`noticeCount` 식에 `+ (genie === 'lit' ? 1 : 0)`을 더한다:

```ts
const noticeCount =
  device.quarantine.length +
  (pending ? 1 : 0) +
  (checkupDate ? 1 : 0) +
  (genie === 'lit' ? 1 : 0) +
  syncNoticeCount
```

- [ ] **Step 3: 알림 한 줄과 트로피 줄을 그린다**

알림 영역의 `checkupDate` 블록 **아래**, `${syncNoticesHtml}` 위에:

```ts
            ${
              genie === 'lit'
                ? noticeRow(
                    'plain',
                    `🪔 램프가 켜졌어요 — 구구단 ${FACT_IDS.length}칸을 다 채웠어요`,
                    noticeAction('소원 들어줬어요', { id: 'wish-grant' }),
                  )
                : ''
            }
```

「지니가 나왔어요」가 아니다 — 아이가 `#/genie`를 열었는지 앱은 모른다(원칙 3).
`FACT_IDS`를 import에 더한다: `import { FACT_IDS, genieState, peakFluent } from '../engine/facts'`

`.ptail` 안, `${syncHtml}` **위**에(알림 개수에 들지 않으므로 알림 영역 밖이다):

```ts
            ${
              genie === 'trophy'
                ? `<p class="ptail-note">🪔 소원 들어줬어요 · ${escapeHtml(formatDate(wish!))} ${noticeAction('되돌리기', { id: 'wish-revert' })}</p>`
                : ''
            }
```

- [ ] **Step 4: 핸들러를 붙인다**

`root.querySelector('#checkup-notice')?...` 줄 아래에:

```ts
// 소원 기록. **렌더 시점 meta를 되쓰지 않는다** — 이 화면이 떠 있는 동안 pull이
// 다른 기기의 settings를 앉혔을 수 있고, 낡은 스냅샷을 통째로 쓰면 그 값이 더 새
// settingsAt을 달고 서버로 올라가 전 기기에서 뒤집힌다(mergeMeta는 settings를
// 통째로 LWW한다). manage.ts의 백업 되돌리기가 같은 이유로 같은 패턴을 쓴다.
const setWish = (value: string | null, label: string): void => {
  void getMeta()
    .then((cur) =>
      putMeta({ ...cur, settings: { ...cur.settings, wishGrantedAt: value } }, ['settings']),
    )
    .then(() => {
      toast(label, {
        tone: 'positive',
        durationMs: 8000,
        action:
          value === null
            ? undefined
            : { label: '안 들어줬어요', onClick: () => setWish(null, '소원 기록을 되돌렸어요') },
      })
      navigate('#/parent') // 같은 해시 재라우팅은 안전하다(상태를 IndexedDB에서 다시 읽는다)
    })
    .catch((e) => showError('소원 기록을 남기지 못했어요.', e))
}
root.querySelector('#wish-grant')?.addEventListener('click', () => {
  setWish(dayKey(new Date()), '소원 들어줬어요')
})
root.querySelector('#wish-revert')?.addEventListener('click', () => {
  setWish(null, '소원 기록을 되돌렸어요')
})
```

`dayKey`가 import에 없으면 더한다: `import { dayKey } from '../engine/dates'`(이미 있다).

- [ ] **Step 5: 빌드·테스트·포맷을 확인한다**

```bash
export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH"
npm run build && npm test && npx prettier --check .
```

Expected: 전부 PASS.

- [ ] **Step 6: 커밋**

```bash
export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH"
npm run format
git add src/screens/home-parent.ts
git commit -m "$(cat <<'EOF'
feat: 부모 홈에서 소원을 들어줬다고 기록한다

램프가 켜지면 알림 한 줄이 뜨고, 누르면 Settings.wishGrantedAt에 날짜가 남아
전 기기의 램프가 트로피가 된다. 되돌리기는 토스트 8초와 트로피 줄 두 곳에 있다.

렌더 시점 meta가 아니라 지금의 meta를 다시 읽어 필드 하나만 얹는다 — 화면이 떠
있는 동안 pull된 설정을 낡은 스냅샷이 더 새 스탬프로 덮는 것을 막는다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Uv3n5QXvBtiKYtJCGtbVqq
EOF
)"
```

---

### Task 6: 문서 갱신과 최종 검증

**Files:**

- Modify: `docs/PRD.md` (§2 범위, §3 표, §4 학습 정책)
- Modify: `docs/design/mastery-rules-plain.md` (마지막 절)
- Modify: `docs/superpowers/HANDOFF.md` (맨 위 연대기 + 열린 항목)

- [ ] **Step 1: PRD를 고친다**

§2 범위의 `전정복 보상(지니)`를 `전정복 보상(지니 — 조건·보상·진척을 아이에게 공개, 소원은
한 번)`으로.

§3 표의 부모 홈 행 설명에 `소원 기록`을 더한다.

§4 「학습 정책」의 마지막 문단 뒤에 한 줄:

```markdown
- **지니 보상**: 램프의 게이지와 점등은 **역대 최고 정복 수**가 정한다(오늘의 정복 수가
  아니다 — 정복은 최근 성적이라 도달 뒤에도 오르내린다). 상태 판정 소유자는
  `src/engine/facts.ts`의 `peakFluent`·`genieState`, 소원을 들어준 사실은
  `Settings.wishGrantedAt`(아빠가 부모 홈에서 기록, 되돌릴 수 있다).
  근거: `specs/2026-09-03-genie-contract-gauge-design.md`
```

- [ ] **Step 2: `mastery-rules-plain.md`의 마지막 절을 고친다**

「이 설계가 의도한 것과 그 대가」의 `지니도 한 번 켜지면 끝이 아니라 다음 점검까지의
상태다.` 문장을 아래로 바꾼다:

```markdown
지니는 예외다 — **램프는 한 번이라도 72칸에 닿으면 그 뒤로 꺼지지 않는다**(역대 최고를
보므로). 아빠가 소원을 들어주고 부모 홈에서 기록하면 트로피가 되고, 그 뒤에도 램프를
누르면 지니는 나오되 소원을 다시 약속하지 않는다. 지도의 숫자는 여전히 오늘의 정복
수라서, 지도가 줄어든 날에도 램프는 그대로다.
```

- [ ] **Step 3: HANDOFF에 항목을 더한다**

맨 위 연대기에 한 문단(2026-09-03 날짜의 기존 항목 위):

```markdown
2026-09-03: 지니 보상 재설계(스펙 `specs/2026-09-03-genie-contract-gauge-design.md`, 계획
`plans/2026-09-03-genie-contract-gauge.md`). 브레인스토밍이 진단을 두 번 바꿨다 — ① "램프가
켜졌다 꺼진다"(유지)로 보고 조건을 만지는 세 안을 냈다가 전부 거절 ② 사용자가 "문제를 잘못
짚었다"고 정정, 도달 불가로 인한 동기 상실이 걱정 ③ 실제 원인은 **아이가 보상의 존재·조건·
거리를 전혀 모른다**는 것(서프라이즈로 설계돼 있었다). 실제 엔진에 학습곡선 아이를 붙인
시뮬레이션으로 도달 가능성을 재서 전제를 뒤집었다: 구조적 하한 18일(`composeSprint`가 새 식을
하루 4개만 꺼낸다), 실측 보정(28일차 17칸)으로 **첫 전정복 83~~98일차 = 2026년 10월 말~~11월
초**, L 0.40이면 400일에도 42칸 정체(절벽), 결석은 비선형(주 6일 131일차·주 5일 317일차).
그래서 조건은 한 줄도 안 건드리고 전달만 고쳤다 — 티저가 계약을 말하고, 실루엣 램프가 **역대
최고 정복 수**(`peakFluent`)만큼 차오르고, 소원은 아빠가 부모 홈에서 기록한다
(`Settings.wishGrantedAt`). 적대적 리뷰 2라운드에서 방향을 바꾼 둘: ① `peakFluent`를 날 단위로
세면 두 기기의 같은 날 세션이 `mergeSprint`로 이어 붙을 때 게이지가 아이가 본 값보다 내려간다
— **세션 경계(sid 전환)**마다 세는 것으로 바꿨다 ② 게이지를 박스 기준으로 자르면 램프 그림이
viewBox의 y 22~~102에만 있어 1~~5칸은 안 보이고 57~71칸은 이미 가득 차 보인다 — 게이지를 둔
이유(60→72 정체 구간)가 바로 그 구간에서 무력해져 **그림 경계에 사상**하도록 고쳤다.
```

「열린 것」 목록에 둘을 더한다:

```markdown
- **`brand.md` §5가 낡았다.** 아이 어투를 해요체 청유("~해 보세요")로 적었는데 코드는 반말이다
  (`fact-map.ts`의 「첫 칸을 채워 볼까?」, `ui.ts`의 「램프를 문질러 봐!」). 문서를 코드에 맞춰
  고쳐야 한다 — 이 커밋에서는 손대지 않았다
- **스프린트 저장 실패 + 램프 점등이 겹치면 세션을 잃는다.** 결과 화면에서 저장이 실패한 채
  아이가 램프를 눌러 `#/genie`로 가면, 가드가 저장본(오늘 세션 없음)으로 판정해 `#/`로
  튕기고 재시도 버튼과 메모리의 30문제가 사라진다. `allFluent` 시절부터 있던 결함이고 이번
  범위 밖이다
```

- [ ] **Step 4: 전체 검증**

```bash
export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH"
npm run format
npx prettier --check . && npm test && npm run build
```

Expected: 셋 다 PASS.

- [ ] **Step 5: 커밋**

```bash
git add docs/PRD.md docs/design/mastery-rules-plain.md docs/superpowers/HANDOFF.md
git commit -m "$(cat <<'EOF'
docs: 지니 보상 재설계 — PRD·정복 규칙·HANDOFF 갱신

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Uv3n5QXvBtiKYtJCGtbVqq
EOF
)"
```

- [ ] **Step 6: 수동 확인 안내 (배포 전)**

`main`에 push하면 곧 배포다. push 전에 사용자에게 알린다:

> 동기화를 끈 로컬 빌드에서 확인할 것: `src/data/sync-config.ts`를 빈 문자열로 두고
> `npm run dev` → `#/manage` 가져오기로 peak 1 · 21 · 60 · 72 백업을 올려
> ① 게이지가 그림 **안에서** 움직이는지 ② `lit`의 `#/genie` ③ 부모 홈 알림 →
> 「소원 들어줬어요」 → 트로피 → 트로피 램프 탭 → 말풍선 「소원을 들어줬지!」 →
> 되돌리기 → `lit` 복귀. **등록된 기기에서 조작 백업을 가져오지 않는다** — 가져오기는
> 서버까지 교체한다.

---

## Self-Review

**Spec coverage.** §3 상태 기계 → Task 1. §4 `peakFluent`·`applyAttempt`·테스트 8종·변이
2종 → Task 1. §5-1 시그니처·계산 로그·`genie.ts` → Task 3·4. §5-2 상태별 표시·문구 →
Task 3. §5-3 게이지·CSS·접근성 → Task 3. §6 부모 홈 → Task 5. §7 저장·검증 → Task 2.
§11 문서 → Task 6. §12 검증 → 각 Task의 마지막 + Task 6.

**빠진 것.** 없음. §9 「건드리지 않는 것」은 계획이 그 파일들을 아예 열지 않는 것으로
지킨다.

**타입 일관성.** `GenieState`는 Task 1이 export하고 Task 3(`ui.ts`)·Task 4(`sprint.ts`)가
import한다. `peakFluent(days, fluentMs): number`·`genieState(peak, wishGrantedAt): GenieState`의
이름과 인자 순서가 Task 1·3·4·5에서 같다. `genieEntryHtml(state, peak)`의 인자 순서가
Task 3의 정의와 Task 4의 두 호출부에서 같다. `Settings.wishGrantedAt`은 Task 2가 만들고
Task 4·5가 `?? null`로 읽는다.
