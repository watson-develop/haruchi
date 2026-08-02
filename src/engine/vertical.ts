import type { VerticalItem, VerticalTag } from '../data/types'
import { randInt } from './rand'

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

/**
 * 뺄셈 a - b 에서 발생하는 받아내림 횟수. a >= b 를 전제한다.
 * 전제가 깨지면(a < b) borrow가 무한히 해소되지 않아 루프가 끝나지 않으므로,
 * 조용히 잘못된 값을 내거나 멈추는 대신 즉시 던진다.
 */
export function borrowCount(a: number, b: number): number {
  if (a < b) {
    throw new RangeError(`borrowCount 전제조건 위반: a(${a})는 b(${b})보다 작을 수 없다`)
  }
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
  // add3-*의 max 899와 a + b < 1000은 함께 "큰 수 + 큰 수"를 의도적으로 배제한다.
  // 2학년 과정은 합이 1000 미만이어야 하므로(네 자리는 3학년), 세 자리끼리 더하려면
  // 적어도 한쪽이 작아야 한다 — 500 + 500조차 이미 1000이다. 즉 이 상한은 임의로
  // 좁게 잡은 값이 아니라 수학적으로 강제되는 결과다. 후임자가 "899는 너무 좁다"며
  // 999로 넓히면 ok()의 a + b < 1000 때문에 기각률만 올라가고 나오는 문제는 그대로다.
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

/**
 * 주어진 두 수가 해당 유형의 정의를 만족하는지.
 *
 * 자릿수 대역(min·max)까지 본다. 받아올림 횟수만 보면 이 함수는 자기가 정의한다고
 * 주장하는 태그보다 약해진다 — satisfies('add2-nocarry', 100, 100)이 참이 되어
 * "두 자리 덧셈"이 세 자리를 통과시킨다. 공개 API이므로 태그의 정의를 온전히 담는다.
 */
export function satisfies(tag: VerticalTag, a: number, b: number): boolean {
  const spec = SPECS[tag]
  if (a < spec.min || a > spec.max || b < spec.min || b > spec.max) return false
  if (spec.op === '−' && a <= b) return false
  return spec.ok(a, b)
}

const MAX_ATTEMPTS = 2000

/**
 * 유형 정의를 만족하는 문항을 기각 표집으로 만든다.
 * 실패하면 GenerationError를 던진다 — 호출부가 더 쉬운 유형으로 폴백한다.
 */
export function generateVertical(
  tag: VerticalTag,
  rand: () => number = Math.random,
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
