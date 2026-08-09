import { describe, it, expect } from 'vitest'
import { serializeValue, structuralEqual, legacyKey, materializeSids, mergeSprint } from './merge'
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

describe('materializeSids', () => {
  const t = (fact: string, ms: number, sid?: string): SprintAttempt =>
    sid === undefined ? { fact, correct: true, ms } : { fact, correct: true, ms, sid }
  it('무sid 최대 연속 구간마다 legacy: sid를 물질화한다', () => {
    const out = materializeSids([t('2x3', 900), t('2x4', 800), t('5x6', 700, 'dev:100')])
    expect(out[0]!.sid).toMatch(/^legacy:/)
    expect(out[0]!.sid).toBe(out[1]!.sid) // 같은 구간 = 같은 세션
    expect(out[2]!.sid).toBe('dev:100') // 기존 sid 불변
  })
  it('결정적이다 — 같은 배열이면 언제 물질화해도 같은 sid (서버 비대칭 왕복의 전제)', () => {
    const arr = [t('2x3', 900), t('2x4', 800)]
    expect(materializeSids(arr)[0]!.sid).toBe(materializeSids(arr.map((x) => ({ ...x })))[0]!.sid)
  })
  it('사실(fact·correct·ms)은 바꾸지 않는다', () => {
    const out = materializeSids([t('2x3', 900)])
    expect(out[0]).toMatchObject({ fact: '2x3', correct: true, ms: 900 })
  })
})

describe('mergeSprint', () => {
  const s = (sid: string, fact: string): SprintAttempt => ({ fact, correct: true, ms: 1000, sid })
  it('sid 합집합 — 두 기기의 세션이 모두 남는다', () => {
    const out = mergeSprint([s('A:100', '2x3')], [s('B:200', '7x8')])!
    expect(out.map((a) => a.sid)).toEqual(['A:100', 'B:200'])
  })
  it('같은 sid 재수신은 한 번만 (pull 여유창 멱등)', () => {
    expect(mergeSprint([s('A:100', '2x3')], [s('A:100', '2x3')])).toHaveLength(1)
  })
  it('같은 sid, 다른 순서로 재수신하면 값 직렬화 사전순 작은 쪽이 남는다', () => {
    const a: SprintAttempt[] = [
      { fact: '2x3', correct: true, ms: 1000, sid: 'A:100' },
      { fact: '2x4', correct: true, ms: 1000, sid: 'A:100' },
    ]
    const b: SprintAttempt[] = [
      { fact: '2x4', correct: true, ms: 1000, sid: 'A:100' },
      { fact: '2x3', correct: true, ms: 1000, sid: 'A:100' },
    ]
    // a의 직렬화("...2x3...2x4...")가 b의 직렬화("...2x4...2x3...")보다 사전순 작다.
    expect(mergeSprint(a, b)).toEqual(a)
    expect(mergeSprint(b, a)).toEqual(a) // 교환법칙 — 인자 순서와 무관하게 작은 쪽
  })
  it('무sid 그룹 둘이 각각 물질화되어 둘 다 남는다 — 옛 기기 둘의 세션 무손실', () => {
    const out = mergeSprint(
      [{ fact: '2x3', correct: true, ms: 900 }],
      [{ fact: '7x8', correct: false, ms: 1500 }],
    )!
    expect(out).toHaveLength(2)
    expect(new Set(out.map((a) => a.sid)).size).toBe(2)
  })
  it('물질화 왕복 — 병합 결과를 원본과 다시 병합해도 증식하지 않는다', () => {
    const a = [{ fact: '2x3', correct: true, ms: 900 }]
    const b = [{ fact: '7x8', correct: false, ms: 1500 }]
    const merged = mergeSprint(a, b)!
    expect(mergeSprint(merged, a)).toHaveLength(2) // 3라운드 B-1의 증식 재현 케이스
    expect(mergeSprint(merged, b)).toHaveLength(2)
  })
  it('그룹 순서: legacy 앞 → 일반(시작 ms순) → 기형 sid 뒤. 그룹 내부는 비정렬 보존', () => {
    const out = mergeSprint(
      [s('B:200', 'x'), s('junk', 'y')],
      [{ fact: 'l1', correct: true, ms: 1 }, s('A:100', 'z')],
    )!
    const sids = out.map((a) => a.sid!)
    expect(sids[0]!.startsWith('legacy:')).toBe(true)
    expect(sids.slice(1)).toEqual(['A:100', 'B:200', 'junk'])
  })
  it('둘 다 undefined면 undefined — 스프린트 없는 날에 빈 배열을 만들지 않는다', () => {
    expect(mergeSprint(undefined, undefined)).toBeUndefined()
  })
})
