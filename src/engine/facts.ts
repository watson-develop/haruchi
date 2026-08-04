import type { Day, FactState } from '../data/types'
import { shiftDay } from './dates'
import { randInt } from './rand'

/** 유창 판정에 필요한 연속 정답 횟수. */
export const STREAK_TARGET = 3

/** 곱셈 기호는 U+00D7. ASCII 'x'가 아니다 — 화면과 저장 키가 모두 이 문자를 쓴다. */
export function factId(a: number, b: number): string {
  return `${a}×${b}`
}

/**
 * 풀 경계 — 단일 출처. 지도 화면(fact-map.ts)과 공유 문구(report.ts)가 행·열·칸 수를
 * 전부 이 값(과 아래 FACT_IDS.length)에서 유도한다. 화면이 경계를 따로 알면(과거에
 * DAN_MIN/DAN_MAX를 fact-map.ts에 복제해 뒀던 것처럼) 여기 값이 바뀌는 날 화면만
 * 조용히 어긋난다. 아래 FACT_IDS 생성 루프도 이 상수를 쓴다 — 상수만 export하고
 * 루프가 여전히 리터럴이면 이 주석은 거짓말이 된다.
 */
export const DAN_MIN = 2
export const DAN_MAX = 9
export const FACTOR_MIN = 1
export const FACTOR_MAX = 9

/**
 * 2×1 ~ 9×9. 순서쌍이므로 7×8과 8×7은 별개다.
 *
 * 0단·1단은 풀에 없다: 규칙이 하나뿐이라 반복 인출 훈련의 대상이 아니다(0단을 뺐던
 * Phase 2의 사유를 1단에도 적용 — 사용자 결정, 2026-08-03). 곱하는 수 ×1은 남긴다 —
 * 외우는 구구단이 "2×1은 2"부터 시작하기 때문이다. 지도는 8행(2~9단)×9열이 된다.
 *
 * 1단·0의 곱은 앱의 공백이 아니라 역할 분담이다: 2-2 곱셈구구 단원 17차시와 EBS
 * 연산 4단계 13~14강이 다룬다(스펙 §2 "1단·0은 학교 몫" —
 * docs/reference/ebs-manjeomwang-lecture-mapping.md §3 해석 3).
 *
 * 과거 로그의 1×n 시도는 deriveFacts가 모르는 id로 조용히 건너뛴다(원래 설계).
 * 마이그레이션은 필요 없다.
 */
export const FACT_IDS: string[] = (() => {
  const ids: string[] = []
  for (let a = DAN_MIN; a <= DAN_MAX; a++)
    for (let b = FACTOR_MIN; b <= FACTOR_MAX; b++) ids.push(factId(a, b))
  return ids
})()

// 교과서 도입 순서(교육청 지도서의 2→5→3·6→4·8→7→9)는 Phase 4에서 폐기했다 —
// 신규 식을 무작위로 도입한다(사용자 결정, 2026-08-03). 순서 근거 조사는
// docs/reference/integrated-arithmetic-ladder.md §2에 사실 기록으로 남아 있다.

export function median(xs: number[]): number | null {
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
 * 로그를 시간순으로 재생해 72식의 현재 상태를 만든다.
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
      if (!state || !history) continue // 알 수 없는 식은 의도적으로 무시한다. 모든 화면이 이 함수에서 파생하므로,
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
        state.nextDue = shiftDay(day.date, state.interval)
      } else {
        state.interval = 1
        state.nextDue = null
      }
    }
  }

  return facts
}

/** 배분: learning 60% / due인 fluent 25% / 신규 15%. */
const SHARE_LEARNING = 0.6
const SHARE_FLUENT = 0.25

export function shuffled<T>(xs: T[], rand: () => number): T[] {
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
 * 처음 만나는 아이에게 72식을 한꺼번에 들이미는 셈이 된다. 대신 소수의 새 식을
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

  const learning = FACT_IDS.filter((id) => facts[id]?.status === 'learning')
  const fluentDue = FACT_IDS.filter(
    (id) =>
      facts[id]?.status === 'fluent' && facts[id]!.nextDue !== null && facts[id]!.nextDue! <= today,
  )
  const fluentNotDue = FACT_IDS.filter(
    (id) =>
      facts[id]?.status === 'fluent' &&
      !(facts[id]!.nextDue !== null && facts[id]!.nextDue! <= today),
  )
  // 신규 도입은 무작위다 — 교과서 순서를 폐기했으므로(위 결정 기록) 섞어서 앞에서 자른다.
  // rand가 주입되므로 그날 큐는 여전히 결정적으로 sheet/세션에 고정된다.
  const fresh = shuffled(
    FACT_IDS.filter((id) => facts[id]?.status === 'new'),
    rand,
  )

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

  if (picked.length < count && pools.length === 0) {
    // 72식이 전부 fluent이고 오늘 due인 것이 하나도 없는 상태. 쉬게 두는 대신
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

/** factId()가 만드는 id의 형태. 곱셈 기호는 U+00D7이고 양쪽은 1~9다. */
const FACT_ID_RE = /^([1-9])×([1-9])$/

/**
 * 식 id → 정답. factId()의 역함수다.
 *
 * id 형식을 아는 곳을 엔진 한 군데로 묶어 둔다 — 화면이 따로 `split('×')`를 하면
 * 인코딩이 바뀌는 날 화면 쪽만 조용히 어긋난다.
 *
 * 형식이 어긋나면 **던진다**. deriveFacts가 모르는 id를 건너뛰는 것과 반대인데,
 * 비대칭은 의도적이다: deriveFacts는 이미 저장된, 손상됐을 수 있는 과거 로그를 재생하므로
 * 거기서 던지면 기기에 복구 경로가 없다. 이 함수의 입력은 방금 composeSprint가 만든
 * id뿐이라 형식이 어긋났다면 엔진이 스스로 모순된 것이고, 아직 잃을 기록도 없다.
 * 반대로 여기서 NaN을 돌려주면 모든 비교가 거짓이 되어 그 세션 30문제가 통째로 오답으로
 * 기록되고, 잘라내지 않는 로그에 조작된 이력이 영구히 남는다.
 */
export function factAnswer(id: string): number {
  const m = FACT_ID_RE.exec(id)
  if (!m) throw new Error(`factAnswer: 식 id 형식이 아니다: ${JSON.stringify(id)}`)
  return Number(m[1]) * Number(m[2])
}
