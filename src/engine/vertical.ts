import type { VerticalItem, VerticalTag } from '../data/types'

/** 교육과정 도입 순서. 앞에서부터 하나씩 열린다. */
export const VERTICAL_ORDER: VerticalTag[] = [
  'add2-nocarry',
  'sub2-noborrow',
  'add2-carry',
  'sub2-borrow',
  'add3-carry1',
  'add3-carry2',
  'sub3-borrow1',
  'sub3-borrow2',
  'sub-zero',
]

export class GenerationError extends Error {
  constructor(public tag: string) {
    super(`문항 생성 실패: ${tag}`)
    this.name = 'GenerationError'
  }
}

/** 덧셈에서 발생하는 받아올림 횟수. */
export function carryCount(a: number, b: number): number {
  let carry = 0
  let count = 0
  while (a > 0 || b > 0) {
    const sum = (a % 10) + (b % 10) + carry
    if (sum >= 10) {
      count++
      carry = 1
    } else {
      carry = 0
    }
    a = Math.floor(a / 10)
    b = Math.floor(b / 10)
  }
  return count
}

/** 뺄셈 a - b 에서 발생하는 받아내림 횟수. a >= b 를 전제한다. */
export function borrowCount(a: number, b: number): number {
  let borrow = 0
  let count = 0
  while (b > 0 || borrow > 0) {
    const digit = (a % 10) - (b % 10) - borrow
    if (digit < 0) {
      count++
      borrow = 1
    } else {
      borrow = 0
    }
    a = Math.floor(a / 10)
    b = Math.floor(b / 10)
  }
  return count
}

type Spec = {
  op: '+' | '−'
  min: number
  max: number
  ok: (a: number, b: number) => boolean
}

const SPECS: Record<VerticalTag, Spec> = {
  'add2-nocarry': { op: '+', min: 10, max: 99, ok: (a, b) => carryCount(a, b) === 0 },
  'sub2-noborrow': { op: '−', min: 10, max: 99, ok: (a, b) => borrowCount(a, b) === 0 },
  'add2-carry': { op: '+', min: 10, max: 99, ok: (a, b) => carryCount(a, b) === 1 },
  'sub2-borrow': { op: '−', min: 10, max: 99, ok: (a, b) => borrowCount(a, b) === 1 },
  'add3-carry1': {
    op: '+',
    min: 100,
    max: 899,
    ok: (a, b) => carryCount(a, b) === 1 && a + b < 1000,
  },
  'add3-carry2': {
    op: '+',
    min: 100,
    max: 899,
    ok: (a, b) => carryCount(a, b) === 2 && a + b < 1000,
  },
  'sub3-borrow1': { op: '−', min: 100, max: 999, ok: (a, b) => borrowCount(a, b) === 1 },
  'sub3-borrow2': { op: '−', min: 100, max: 999, ok: (a, b) => borrowCount(a, b) === 2 },
  'sub-zero': {
    op: '−',
    min: 100,
    max: 999,
    ok: (a, b) => Math.floor(a / 10) % 10 === 0 && borrowCount(a, b) >= 2,
  },
}

/** 주어진 두 수가 해당 유형의 정의를 만족하는지. */
export function satisfies(tag: VerticalTag, a: number, b: number): boolean {
  const spec = SPECS[tag]
  if (spec.op === '−' && a <= b) return false
  return spec.ok(a, b)
}

function randInt(min: number, max: number, rand: () => number): number {
  return min + Math.floor(rand() * (max - min + 1))
}

const MAX_ATTEMPTS = 2000

/**
 * 유형 정의를 만족하는 문항을 기각 표집으로 만든다.
 * 실패하면 GenerationError를 던진다 — 호출부가 더 쉬운 유형으로 폴백한다.
 */
export function generateVertical(
  tag: VerticalTag,
  rand: () => number = Math.random
): Omit<VerticalItem, 'id'> {
  const spec = SPECS[tag]
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const x = randInt(spec.min, spec.max, rand)
    const y = randInt(spec.min, spec.max, rand)
    const a = spec.op === '−' ? Math.max(x, y) : x
    const b = spec.op === '−' ? Math.min(x, y) : y
    if (!satisfies(tag, a, b)) continue
    return { kind: 'vertical', tag, a, b, op: spec.op, answer: spec.op === '+' ? a + b : a - b }
  }
  throw new GenerationError(tag)
}
