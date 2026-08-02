import { describe, it, expect } from 'vitest'
import {
  INVERSE_TEMPLATES,
  generateInverse,
  hasFinalConsonant,
  inverseHint,
  objectParticle,
  subjectParticle,
} from './inverse'

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

describe('조사 헬퍼', () => {
  it('한자어 끝소리에 받침이 있는 수를 가려낸다', () => {
    // 영·일·삼·육·칠·팔은 받침이 있고, 이·사·오·구는 없다.
    for (const n of [0, 1, 3, 6, 7, 8]) expect(hasFinalConsonant(n)).toBe(true)
    for (const n of [2, 4, 5, 9]) expect(hasFinalConsonant(n)).toBe(false)
    // 십의 자리 위는 소리에 영향을 주지 않는다: 86은 "팔십육"이라 끝소리가 육.
    for (const n of [10, 20, 30, 86, 17, 33, 100, 999]) {
      expect(hasFinalConsonant(n)).toBe(hasFinalConsonant(n % 10))
    }
  })

  it('주격 조사 이/가를 고른다', () => {
    expect(subjectParticle(86)).toBe('이') // 팔십육
    expect(subjectParticle(17)).toBe('이') // 십칠
    expect(subjectParticle(30)).toBe('이') // 삼십
    expect(subjectParticle(45)).toBe('가') // 사십오
    expect(subjectParticle(52)).toBe('가') // 오십이
    expect(subjectParticle(99)).toBe('가') // 구십구
  })

  it('목적격 조사 을/를 고른다', () => {
    expect(objectParticle(33)).toBe('을') // 삼십삼
    expect(objectParticle(18)).toBe('을') // 십팔
    expect(objectParticle(65)).toBe('를') // 육십오
    expect(objectParticle(24)).toBe('를') // 이십사
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
    // 27은 "이십칠" — 받침이 있으므로 '27이'다. 예전에는 '27가'로 나갔다.
    expect(inverseHint(p)).toBe('45에서 얼마를 빼면 27이 될까요?')
  })

  it('?-b=c 템플릿에 맞는 문장을 만든다', () => {
    const p = { ...generateInverse('?-b=c'), b: 18, c: 27, answer: 45 }
    expect(inverseHint(p)).toBe('얼마에서 18을 빼면 27이 될까요?')
  })

  it('c의 끝소리에 따라 이/가가 갈린다', () => {
    const withFinal = { ...generateInverse('a+?=c'), a: 21, c: 86, answer: 65 }
    expect(inverseHint(withFinal)).toBe('21에 얼마를 더하면 86이 될까요?')
    const withoutFinal = { ...generateInverse('a+?=c'), a: 21, c: 85, answer: 64 }
    expect(inverseHint(withoutFinal)).toBe('21에 얼마를 더하면 85가 될까요?')
  })

  it('b의 끝소리에 따라 을/를이 갈린다', () => {
    const withFinal = { ...generateInverse('?+b=c'), b: 33, c: 50, answer: 17 }
    expect(inverseHint(withFinal)).toBe('얼마에 33을 더하면 50이 될까요?')
    const withoutFinal = { ...generateInverse('?+b=c'), b: 65, c: 86, answer: 21 }
    expect(inverseHint(withoutFinal)).toBe('얼마에 65를 더하면 86이 될까요?')
  })

  it('생성기가 만든 모든 힌트에 조사 오류가 한 건도 없다', () => {
    // 결함 당시 16,000건 중 10,882건(68.0%)이 틀렸다.
    // 문장에 나타나는 "수 + 조사" 쌍을 전부 긁어 규칙과 대조한다.
    const wrong: string[] = []
    for (const t of INVERSE_TEMPLATES) {
      for (let i = 0; i < 4000; i++) {
        const hint = inverseHint(generateInverse(t))
        for (const [pair, digits, particle] of hint.matchAll(/(\d+)(이|가|을|를)/g)) {
          const n = Number(digits)
          const expected =
            particle === '이' || particle === '가' ? subjectParticle(n) : objectParticle(n)
          if (particle !== expected) wrong.push(pair)
        }
      }
    }
    expect(wrong).toEqual([])
  })
})
