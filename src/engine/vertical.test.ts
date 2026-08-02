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
})
