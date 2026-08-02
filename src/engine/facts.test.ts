import { describe, it, expect } from 'vitest'
import { FACT_IDS, FACT_ORDER, factId, deriveFacts, STREAK_TARGET } from './facts'
import type { Day, SprintAttempt } from '../data/types'

function sprintDay(date: string, attempts: SprintAttempt[]): Day {
  return { date, kind: 'normal', sheet: [], sprint: attempts }
}

function hit(fact: string, ms: number): SprintAttempt {
  return { fact, correct: true, ms }
}

function miss(fact: string): SprintAttempt {
  return { fact, correct: false, ms: 9000 }
}

describe('식 목록', () => {
  it('81개이고 중복이 없다', () => {
    expect(FACT_IDS).toHaveLength(81)
    expect(new Set(FACT_IDS).size).toBe(81)
  })

  it('factId는 곱셈 기호로 조합한다', () => {
    expect(factId(7, 8)).toBe('7×8')
    expect(FACT_IDS).toContain('7×8')
    expect(FACT_IDS).toContain('1×1')
    expect(FACT_IDS).toContain('9×9')
  })

  it('FACT_ORDER는 같은 81개를 교과서 도입 순서로 담는다', () => {
    expect(new Set(FACT_ORDER)).toEqual(new Set(FACT_IDS))
    // 1단이 먼저, 그다음 2 → 5 → 3 → 6 → 4 → 8 → 7 → 9단
    const firstOf = (n: number) => FACT_ORDER.findIndex((id) => id.startsWith(`${n}×`))
    expect(firstOf(1)).toBeLessThan(firstOf(2))
    expect(firstOf(2)).toBeLessThan(firstOf(5))
    expect(firstOf(5)).toBeLessThan(firstOf(3))
    expect(firstOf(3)).toBeLessThan(firstOf(6))
    expect(firstOf(6)).toBeLessThan(firstOf(4))
    expect(firstOf(4)).toBeLessThan(firstOf(8))
    expect(firstOf(8)).toBeLessThan(firstOf(7))
    expect(firstOf(7)).toBeLessThan(firstOf(9))
  })
})

describe('deriveFacts', () => {
  it('기록이 없으면 전부 new다', () => {
    const facts = deriveFacts([], 2500)
    expect(Object.keys(facts)).toHaveLength(81)
    expect(facts['7×8']).toEqual({
      status: 'new',
      medianMs: null,
      streak: 0,
      interval: 1,
      nextDue: null,
    })
  })

  it('연속 3회 정답이고 중앙값이 기준 이하면 fluent다', () => {
    const facts = deriveFacts(
      [sprintDay('2026-08-01', [hit('7×8', 2000), hit('7×8', 2400), hit('7×8', 2200)])],
      2500,
    )
    expect(facts['7×8']!.status).toBe('fluent')
    expect(facts['7×8']!.streak).toBe(3)
    expect(facts['7×8']!.medianMs).toBe(2200)
  })

  it('중앙값이 기준을 1ms라도 넘으면 fluent가 아니다', () => {
    const facts = deriveFacts(
      [sprintDay('2026-08-01', [hit('7×8', 2501), hit('7×8', 2501), hit('7×8', 2501)])],
      2500,
    )
    expect(facts['7×8']!.status).toBe('learning')
  })

  it('정확히 기준값이면 fluent다 (경계는 이하)', () => {
    const facts = deriveFacts(
      [sprintDay('2026-08-01', [hit('7×8', 2500), hit('7×8', 2500), hit('7×8', 2500)])],
      2500,
    )
    expect(facts['7×8']!.status).toBe('fluent')
  })

  it('2회 연속으로는 fluent가 아니다', () => {
    const facts = deriveFacts([sprintDay('2026-08-01', [hit('7×8', 1000), hit('7×8', 1000)])], 2500)
    expect(facts['7×8']!.status).toBe('learning')
    expect(facts['7×8']!.streak).toBe(2)
  })

  it('오답은 learning으로 강등하고 streak와 간격을 되돌린다', () => {
    const facts = deriveFacts(
      [
        sprintDay('2026-08-01', [hit('7×8', 1000), hit('7×8', 1000), hit('7×8', 1000)]),
        sprintDay('2026-08-02', [miss('7×8')]),
      ],
      2500,
    )
    expect(facts['7×8']!.status).toBe('learning')
    expect(facts['7×8']!.streak).toBe(0)
    expect(facts['7×8']!.interval).toBe(1)
    expect(facts['7×8']!.nextDue).toBeNull()
  })

  it('fluent가 된 날 다음 등장일은 하루 뒤다', () => {
    const facts = deriveFacts(
      [sprintDay('2026-08-01', [hit('7×8', 1000), hit('7×8', 1000), hit('7×8', 1000)])],
      2500,
    )
    expect(facts['7×8']!.interval).toBe(1)
    expect(facts['7×8']!.nextDue).toBe('2026-08-02')
  })

  it('fluent를 유지하면 간격이 1 → 3 → 7 → 14로 늘고 14에서 멈춘다', () => {
    const days: Day[] = [
      sprintDay('2026-08-01', [hit('7×8', 1000), hit('7×8', 1000), hit('7×8', 1000)]),
      sprintDay('2026-08-02', [hit('7×8', 1000)]),
      sprintDay('2026-08-05', [hit('7×8', 1000)]),
      sprintDay('2026-08-12', [hit('7×8', 1000)]),
      sprintDay('2026-08-26', [hit('7×8', 1000)]),
    ]
    const at = (n: number) => deriveFacts(days.slice(0, n), 2500)['7×8']!
    expect(at(1).interval).toBe(1)
    expect(at(2).interval).toBe(3)
    expect(at(3).interval).toBe(7)
    expect(at(4).interval).toBe(14)
    expect(at(5).interval).toBe(14)
    expect(at(5).nextDue).toBe('2026-09-09')
  })

  it('스프린트가 없는 날은 건너뛴다', () => {
    const noSprint: Day = { date: '2026-08-01', kind: 'normal', sheet: [] }
    expect(deriveFacts([noSprint], 2500)['7×8']!.status).toBe('new')
  })

  it('같은 days를 두 번 넣어도 같은 결과다', () => {
    const days = [sprintDay('2026-08-01', [hit('7×8', 1000), miss('6×7')])]
    expect(deriveFacts(days, 2500)).toEqual(deriveFacts(days, 2500))
  })

  it('입력 days를 변형하지 않는다', () => {
    const days = [sprintDay('2026-08-01', [hit('7×8', 1000)])]
    const snapshot = JSON.stringify(days)
    deriveFacts(days, 2500)
    expect(JSON.stringify(days)).toBe(snapshot)
  })

  it('알 수 없는 식 id는 건너뛴다 (throw하지 않음)', () => {
    const days = [
      sprintDay('2026-08-01', [
        hit('7x8', 1000), // ASCII x (U+0078), 잘못된 형식 — 건너뜀
        hit('7×8', 1000), // 올바른 형식 — streak=1
        hit('7×8', 1000), // streak=2
        hit('12×13', 1000), // 범위 벗어남 (최대 9×9) — 건너뜀
        hit('7×8', 1000), // streak=3
      ]),
    ]
    // throw하지 않고 성공적으로 파생된다
    const facts = deriveFacts(days, 2500)
    // 올바른 '7×8'은 정상적으로 처리된다: 3회 정답이므로 fluent
    expect(facts['7×8']!.streak).toBe(3)
    expect(facts['7×8']!.status).toBe('fluent')
    expect(facts['7×8']!.medianMs).toBe(1000)
    // 전체 사실은 여전히 정확히 81개
    expect(Object.keys(facts)).toHaveLength(81)
    // 알 수 없는 id로 새로운 항목이 생성되지 않는다
    expect(facts['7x8']).toBeUndefined()
    expect(facts['12×13']).toBeUndefined()
  })

  it('STREAK_TARGET은 3이다', () => {
    expect(STREAK_TARGET).toBe(3)
  })
})
