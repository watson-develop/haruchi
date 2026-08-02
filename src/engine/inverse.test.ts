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
    }
  })

  it('?+b=c 는 answer + b 가 c 다', () => {
    for (let i = 0; i < 300; i++) {
      const p = generateInverse('?+b=c')
      expect(p.answer + p.b!).toBe(p.c)
      expect(p.tag).toBe('inverse-add')
    }
  })

  it('a-?=c 는 a - answer 가 c 다', () => {
    for (let i = 0; i < 300; i++) {
      const p = generateInverse('a-?=c')
      expect(p.a! - p.answer).toBe(p.c)
      expect(p.tag).toBe('inverse-sub')
    }
  })

  it('?-b=c 는 answer - b 가 c 다', () => {
    for (let i = 0; i < 300; i++) {
      const p = generateInverse('?-b=c')
      expect(p.answer - p.b!).toBe(p.c)
      expect(p.answer).toBeLessThan(1000)
      expect(p.tag).toBe('inverse-sub')
    }
  })
})

describe('inverseHint', () => {
  it('템플릿에 맞는 문장을 만든다', () => {
    const p = { ...generateInverse('a+?=c'), a: 27, c: 45, answer: 18 }
    expect(inverseHint(p)).toBe('27에 얼마를 더하면 45가 될까요?')
  })
})
