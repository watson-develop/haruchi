import { describe, it, expect } from 'vitest'
import { INVERSE_TEMPLATES, generateInverse, inverseHint } from './inverse'

describe('generateInverse', () => {
  it('모든 템플릿에서 답이 자연수이고 1000 미만이다', () => {
    for (const t of INVERSE_TEMPLATES) {
      for (let i = 0; i < 500; i++) {
        const p = generateInverse(t)
        expect(Number.isInteger(p.answer)).toBe(true)
        expect(p.answer).toBeGreaterThan(0)
        expect(p.c).toBeLessThan(1000)
        expect(p.template).toBe(t)
      }
    }
  })

  it('a+?=c 는 a + answer 가 c 다', () => {
    for (let i = 0; i < 300; i++) {
      const p = generateInverse('a+?=c')
      expect(p.a! + p.answer).toBe(p.c)
      expect(p.tag).toBe('inverse-add')
      // 난이도 대역 고정: a 10-80, answer 5-89, c 15-99 (inverse.ts의 randInt 인자에서 유도)
      expect(p.a).toBeGreaterThanOrEqual(10)
      expect(p.a).toBeLessThanOrEqual(80)
      expect(p.answer).toBeGreaterThanOrEqual(5)
      expect(p.answer).toBeLessThanOrEqual(89)
      expect(p.c).toBeGreaterThanOrEqual(15)
      expect(p.c).toBeLessThanOrEqual(99)
    }
  })

  it('?+b=c 는 answer + b 가 c 다', () => {
    for (let i = 0; i < 300; i++) {
      const p = generateInverse('?+b=c')
      expect(p.answer + p.b!).toBe(p.c)
      expect(p.tag).toBe('inverse-add')
      // 난이도 대역 고정: b 10-80, answer 5-89, c 15-99
      expect(p.b).toBeGreaterThanOrEqual(10)
      expect(p.b).toBeLessThanOrEqual(80)
      expect(p.answer).toBeGreaterThanOrEqual(5)
      expect(p.answer).toBeLessThanOrEqual(89)
      expect(p.c).toBeGreaterThanOrEqual(15)
      expect(p.c).toBeLessThanOrEqual(99)
    }
  })

  it('a-?=c 는 a - answer 가 c 다', () => {
    for (let i = 0; i < 300; i++) {
      const p = generateInverse('a-?=c')
      expect(p.a! - p.answer).toBe(p.c)
      expect(p.tag).toBe('inverse-sub')
      // 난이도 대역 고정: a 25-99, answer 5-89, c 10-94
      expect(p.a).toBeGreaterThanOrEqual(25)
      expect(p.a).toBeLessThanOrEqual(99)
      expect(p.answer).toBeGreaterThanOrEqual(5)
      expect(p.answer).toBeLessThanOrEqual(89)
      expect(p.c).toBeGreaterThanOrEqual(10)
      expect(p.c).toBeLessThanOrEqual(94)
    }
  })

  it('?-b=c 는 answer - b 가 c 다', () => {
    for (let i = 0; i < 300; i++) {
      const p = generateInverse('?-b=c')
      expect(p.answer - p.b!).toBe(p.c)
      expect(p.answer).toBeLessThan(1000)
      expect(p.tag).toBe('inverse-sub')
      // 난이도 대역 고정: b 5-40, c 10-59, answer 15-99 (두 피연산자를 독립 추출하는 유일한 arm)
      expect(p.b).toBeGreaterThanOrEqual(5)
      expect(p.b).toBeLessThanOrEqual(40)
      expect(p.c).toBeGreaterThanOrEqual(10)
      expect(p.c).toBeLessThanOrEqual(59)
      expect(p.answer).toBeGreaterThanOrEqual(15)
      expect(p.answer).toBeLessThanOrEqual(99)
    }
  })
})

describe('inverseHint', () => {
  it('a+?=c 템플릿에 맞는 문장을 만든다', () => {
    const p = { ...generateInverse('a+?=c'), a: 27, c: 45, answer: 18 }
    expect(inverseHint(p)).toBe('27에 얼마를 더하면 45가 될까요?')
  })

  it('?+b=c 템플릿에 맞는 문장을 만든다', () => {
    const p = { ...generateInverse('?+b=c'), b: 18, c: 45, answer: 27 }
    expect(inverseHint(p)).toBe('얼마에 18을 더하면 45가 될까요?')
  })

  it('a-?=c 템플릿에 맞는 문장을 만든다', () => {
    const p = { ...generateInverse('a-?=c'), a: 45, c: 27, answer: 18 }
    expect(inverseHint(p)).toBe('45에서 얼마를 빼면 27가 될까요?')
  })

  it('?-b=c 템플릿에 맞는 문장을 만든다', () => {
    const p = { ...generateInverse('?-b=c'), b: 18, c: 27, answer: 45 }
    expect(inverseHint(p)).toBe('얼마에서 18을 빼면 27가 될까요?')
  })
})
