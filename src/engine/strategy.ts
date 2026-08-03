import type { FactState, StrategyId, StrategyItem, StrategyState, StrategyStep } from '../data/types'
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
    // b % 10 !== 0을 안 두면 일의 자리 단계가 "x − 0"이 되고(예: 21−20), 십의 자리가
    // 같으면 그 단계가 "x − x = 0"이 된다(예: 38−35). 둘 다 산술적으로는 맞지만
    // "자리로 나누어 빼기"라는 전략 자체가 무의미해진다 — 어느 자리도 실제로 나눌
    // 필요가 없다. split-subtrahend가 같은 이유로 b % 10 !== 0을 두는 것과 짝이다.
    applicable: (a, b) =>
      a > b &&
      b >= 11 &&
      a <= 99 &&
      borrowCount(a, b) === 0 &&
      b % 10 !== 0 &&
      Math.floor(a / 10) !== Math.floor(b / 10),
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
      return [
        { text: `${a} × ${b / 2} = {}`, blanks: [a * (b / 2)] },
        { text: `${a * (b / 2)} × 2 = {}`, blanks: [a * b] },
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
      return [
        { text: `10 × ${a} = {}`, blanks: [10 * a] },
        { text: `${10 * a} − ${a} = {}`, blanks: [9 * a] },
      ]
    },
  },
]

export const STRATEGY_NAMES: Record<string, string> = Object.fromEntries(
  STRATEGY_CATALOG.map((s) => [s.id, s.name]),
)

/** 같은 수식 두 방법 배치 확률(설계 §6.4 "섞는다"). 낮게 — 매일이면 패턴이 되어 신선함이 죽는다. */
const SAME_EXPR_CHANCE = 0.2

/**
 * 그날 전략 2문항. 문항1 = 오늘의 방법(최신 도입, 게이트 통과 시 새 전략),
 * 문항2 = 어제의 방법(이전 도입 중 가장 오래 안 나온 것 — 유지 복습).
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

  let today: StrategyDef
  if (!latest) {
    today = STRATEGY_CATALOG[0]!
  } else if ((strategies[latest.id]!.appearances ?? 0) >= 3) {
    const next = STRATEGY_CATALOG[STRATEGY_CATALOG.indexOf(latest) + 1]
    const gated = next && next.op === '×' && fluentCount < MUL_STRATEGY_MIN_FLUENT
    today = next && !gated ? next : latest
  } else {
    today = latest
  }

  // 어제의 방법: 오늘 전략을 뺀 도입 전략 중 lastAppearedAt이 가장 오래된 것.
  const pool = introduced.filter((s) => s.id !== today.id)
  const review =
    pool.length > 0
      ? pool.reduce((oldest, s) =>
          (strategies[s.id]!.lastAppearedAt ?? '') < (strategies[oldest.id]!.lastAppearedAt ?? '')
            ? s
            : oldest,
        )
      : today

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
  // 함정 주의: 이 폴백은 split-subtrahend가 뽑은 (a,b)를 반환하지만, 호출자(위)는
  // 이 값을 "원래 def"(호출한 today/review)의 op·steps로 렌더한다 — split-subtrahend의
  // steps로 렌더하지 않는다. 8종 중 7종은 steps(a,b)가 실제로 a,b에서 답을 계산하므로
  // (a,b) 자체가 split-subtrahend의 applicable을 만족하지 않아도 산술은 맞는다.
  // 단 하나 minus-one만 예외다 — steps(a,_b)가 b를 무시하고 9*a를 답으로 고정한다
  // (applicable이 b===9만 검사하기 때문). 폴백이 minus-one에 걸리면 마지막 빈칸(9a)이
  // answer(a×b)와 어긋나 채점 계약이 깨진다. 현재는 도달 불가능하다 — 이 함수가 도는
  // seen에는 세로셈·역연산의 +/− 키만 쌓이므로 ×인 minus-one의 키와 충돌할 수 없고,
  // minus-one.gen 자체도 항상 성공해(수용률 100%) 이 폴백 분기를 타지 않는다. 그래도
  // 호출자 쪽 가정이 깨지기 쉬우니(예: 향후 곱셈 문항이 seen을 공유하게 되면) 여기 남긴다.
  const fallback = STRATEGY_CATALOG.find((s) => s.id === 'split-subtrahend')!
  const ab = fallback.gen(rand)
  seen.add(`${ab.a}${fallback.op}${ab.b}`)
  return ab
}
