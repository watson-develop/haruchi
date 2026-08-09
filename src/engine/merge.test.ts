import { describe, it, expect } from 'vitest'
import { serializeValue, structuralEqual, legacyKey } from './merge'
import type { SprintAttempt } from '../data/types'

describe('serializeValue', () => {
  it('객체 키 순서를 무시한다 — jsonb 왕복이 키를 재배열해도 같은 문자열', () => {
    expect(serializeValue({ b: 1, a: [2, 3] })).toBe(serializeValue({ a: [2, 3], b: 1 }))
  })
  it('배열 원소 순서는 보존한다 — deriveFacts가 순서 의존이다', () => {
    expect(serializeValue([1, 2])).not.toBe(serializeValue([2, 1]))
  })
  it('중첩 객체도 정렬한다', () => {
    expect(serializeValue({ x: { b: 1, a: 2 } })).toBe(serializeValue({ x: { a: 2, b: 1 } }))
  })
})

describe('legacyKey', () => {
  const t = (fact: string, ms: number): SprintAttempt => ({ fact, correct: true, ms })
  it('같은 다중집합·다른 순서 → 같은 키 (세션 정규화)', () => {
    expect(legacyKey([t('2x3', 900), t('2x4', 1100)])).toBe(
      legacyKey([t('2x4', 1100), t('2x3', 900)]),
    )
  })
  it('다른 내용 → 다른 키', () => {
    expect(legacyKey([t('2x3', 900)])).not.toBe(legacyKey([t('2x3', 901)]))
  })
})
