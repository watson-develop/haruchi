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
