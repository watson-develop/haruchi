import { describe, it, expect } from 'vitest'
import {
  VERTICAL_ORDER,
  carryCount,
  borrowCount,
  satisfies,
  generateVertical,
} from './vertical'

describe('carryCount', () => {
  it('받아올림 횟수를 센다', () => {
    expect(carryCount(12, 34)).toBe(0)
    expect(carryCount(47, 38)).toBe(1)
    expect(carryCount(156, 275)).toBe(2)
    expect(carryCount(99, 99)).toBe(2)
  })
})

describe('borrowCount', () => {
  it('받아내림 횟수를 센다', () => {
    expect(borrowCount(58, 23)).toBe(0)
    expect(borrowCount(63, 28)).toBe(1)
    expect(borrowCount(300, 147)).toBe(2)
    expect(borrowCount(503, 276)).toBe(2)
    expect(borrowCount(425, 168)).toBe(2)
  })

  it('a < b이면 즉시 던진다 (무한 루프 대신)', () => {
    expect(() => borrowCount(3, 5)).toThrow(RangeError)
    expect(() => borrowCount(47, 52)).toThrow(RangeError)
    expect(() => borrowCount(9, 100)).toThrow(RangeError)
    expect(() => borrowCount(100, 101)).toThrow(RangeError)
  })

  it('a === b이면 0을 반환한다 (경계값, 던지지 않는다)', () => {
    expect(borrowCount(0, 0)).toBe(0)
    expect(borrowCount(58, 58)).toBe(0)
  })
})

describe('generateVertical', () => {
  it('모든 유형이 정의를 만족하는 문항만 만든다', () => {
    for (const tag of VERTICAL_ORDER) {
      for (let i = 0; i < 500; i++) {
        const p = generateVertical(tag)
        expect(satisfies(tag, p.a, p.b), `${tag}: ${p.a} ${p.op} ${p.b}`).toBe(true)
        expect(p.answer).toBe(p.op === '+' ? p.a + p.b : p.a - p.b)
        expect(p.answer).toBeGreaterThanOrEqual(0)
        expect(p.answer).toBeLessThan(1000)
        expect(p.tag).toBe(tag)
      }
    }
  })

  it('뺄셈 결과는 음수가 아니다', () => {
    const subs = VERTICAL_ORDER.filter((t) => t.startsWith('sub'))
    for (const tag of subs) {
      for (let i = 0; i < 200; i++) {
        const p = generateVertical(tag)
        expect(p.op).toBe('−')
        expect(p.a).toBeGreaterThan(p.b)
      }
    }
  })

  it('sub-zero는 피감수의 십의 자리가 0이고 받아내림이 2회 이상이다', () => {
    for (let i = 0; i < 300; i++) {
      const p = generateVertical('sub-zero')
      expect(Math.floor(p.a / 10) % 10).toBe(0)
      expect(borrowCount(p.a, p.b)).toBeGreaterThanOrEqual(2)
    }
  })

  it('add2-carry는 받아올림이 정확히 1회다', () => {
    for (let i = 0; i < 300; i++) {
      const p = generateVertical('add2-carry')
      expect(carryCount(p.a, p.b)).toBe(1)
    }
  })

  // 아래 7개는 satisfies()/SPECS를 거치지 않고 carryCount/borrowCount를
  // 독립적인 오라클로 직접 호출해, 하드코딩한 기대값과 대조한다.
  // (위 '모든 유형이 정의를 만족하는...' 테스트는 satisfies()가 SPECS.ok를
  //  그대로 재사용하므로 SPECS 자체가 틀리면 통과해버리는 동어반복이다.)

  it('add2-nocarry는 받아올림이 없고 두 자리 수끼리의 덧셈이다', () => {
    for (let i = 0; i < 300; i++) {
      const p = generateVertical('add2-nocarry')
      expect(carryCount(p.a, p.b)).toBe(0)
      expect(p.a).toBeGreaterThanOrEqual(10)
      expect(p.a).toBeLessThanOrEqual(99)
      expect(p.b).toBeGreaterThanOrEqual(10)
      expect(p.b).toBeLessThanOrEqual(99)
    }
  })

  it('sub2-noborrow는 받아내림이 없고 두 자리 수끼리의 뺄셈이다', () => {
    for (let i = 0; i < 300; i++) {
      const p = generateVertical('sub2-noborrow')
      expect(borrowCount(p.a, p.b)).toBe(0)
      expect(p.a).toBeGreaterThanOrEqual(10)
      expect(p.a).toBeLessThanOrEqual(99)
      expect(p.b).toBeGreaterThanOrEqual(10)
      expect(p.b).toBeLessThanOrEqual(99)
    }
  })

  it('sub2-borrow는 받아내림이 정확히 1회이고 두 자리 수끼리의 뺄셈이다', () => {
    for (let i = 0; i < 300; i++) {
      const p = generateVertical('sub2-borrow')
      expect(borrowCount(p.a, p.b)).toBe(1)
      expect(p.a).toBeGreaterThanOrEqual(10)
      expect(p.a).toBeLessThanOrEqual(99)
      expect(p.b).toBeGreaterThanOrEqual(10)
      expect(p.b).toBeLessThanOrEqual(99)
    }
  })

  it('add3-carry1은 받아올림이 정확히 1회이고 세 자리 수끼리의 덧셈이다', () => {
    for (let i = 0; i < 300; i++) {
      const p = generateVertical('add3-carry1')
      expect(carryCount(p.a, p.b)).toBe(1)
      expect(p.a).toBeGreaterThanOrEqual(100)
      expect(p.a).toBeLessThanOrEqual(999)
      expect(p.b).toBeGreaterThanOrEqual(100)
      expect(p.b).toBeLessThanOrEqual(999)
    }
  })

  it('add3-carry2는 받아올림이 정확히 2회이고 세 자리 수끼리의 덧셈이다', () => {
    for (let i = 0; i < 300; i++) {
      const p = generateVertical('add3-carry2')
      expect(carryCount(p.a, p.b)).toBe(2)
      expect(p.a).toBeGreaterThanOrEqual(100)
      expect(p.a).toBeLessThanOrEqual(999)
      expect(p.b).toBeGreaterThanOrEqual(100)
      expect(p.b).toBeLessThanOrEqual(999)
    }
  })

  it('sub3-borrow1은 받아내림이 정확히 1회이고 세 자리 수끼리의 뺄셈이다', () => {
    for (let i = 0; i < 300; i++) {
      const p = generateVertical('sub3-borrow1')
      expect(borrowCount(p.a, p.b)).toBe(1)
      expect(p.a).toBeGreaterThanOrEqual(100)
      expect(p.a).toBeLessThanOrEqual(999)
      expect(p.b).toBeGreaterThanOrEqual(100)
      expect(p.b).toBeLessThanOrEqual(999)
    }
  })

  it('sub3-borrow2는 받아내림이 정확히 2회이고 세 자리 수끼리의 뺄셈이다', () => {
    for (let i = 0; i < 300; i++) {
      const p = generateVertical('sub3-borrow2')
      expect(borrowCount(p.a, p.b)).toBe(2)
      expect(p.a).toBeGreaterThanOrEqual(100)
      expect(p.a).toBeLessThanOrEqual(999)
      expect(p.b).toBeGreaterThanOrEqual(100)
      expect(p.b).toBeLessThanOrEqual(999)
    }
  })
})
