import { describe, it, expect } from 'vitest'
import { dayDone, sprintStreak, wordStart } from './streak'
import { makeProblem } from './word'
import type { Day, WordAttempt } from '../data/types'

function day(date: string, didSprint: boolean): Day {
  return {
    date,
    kind: 'normal',
    sheet: [],
    ...(didSprint ? { sprint: [{ fact: '2×2', correct: true, ms: 900 }] } : {}),
  }
}

describe('sprintStreak', () => {
  it('기록이 없으면 0이다', () => {
    expect(sprintStreak([], '2026-08-10')).toBe(0)
  })

  it('연속으로 한 날을 센다', () => {
    const days = [day('2026-08-08', true), day('2026-08-09', true), day('2026-08-10', true)]
    expect(sprintStreak(days, '2026-08-10')).toBe(3)
  })

  it('오늘 아직 안 했어도 어제까지의 연속은 유지된다', () => {
    const days = [day('2026-08-08', true), day('2026-08-09', true)]
    expect(sprintStreak(days, '2026-08-10')).toBe(2)
  })

  it('하루 빠진 것은 봐준다', () => {
    const days = [day('2026-08-07', true), day('2026-08-09', true), day('2026-08-10', true)]
    expect(sprintStreak(days, '2026-08-10')).toBe(3)
  })

  it('이틀 연속 빠진 것은 봐준다 — 주말 이틀을 쉬어도 불꽃이 안 꺼진다', () => {
    // 금(07)까지 하고 토·일(08·09) 쉬고 월(10)에 복귀. 공백 2일은 용서 범위다.
    const days = [day('2026-08-06', true), day('2026-08-07', true), day('2026-08-10', true)]
    expect(sprintStreak(days, '2026-08-10')).toBe(3)
  })

  it('사흘 연속 빠지면 거기서 끊는다', () => {
    const days = [
      day('2026-08-01', true),
      day('2026-08-02', true),
      day('2026-08-09', true),
      day('2026-08-10', true),
    ]
    expect(sprintStreak(days, '2026-08-10')).toBe(2)
  })

  it('주말에 인접한 평일 병결까지 겹치면 끊긴다 — 수용된 잔여 리스크(스펙 §2-3)', () => {
    // 목(06)까지 하고 금(07) 병결 + 토·일(08·09) 쉼 = 공백 3일. 월(10)에 복귀하면 1이다.
    const days = [day('2026-08-05', true), day('2026-08-06', true), day('2026-08-10', true)]
    expect(sprintStreak(days, '2026-08-10')).toBe(1)
  })

  it('스프린트가 없는 날은 세지 않는다', () => {
    const days = [day('2026-08-09', false), day('2026-08-10', true)]
    expect(sprintStreak(days, '2026-08-10')).toBe(1)
  })

  it('빈 sprint 배열은 안 한 것으로 본다', () => {
    const empty: Day = { date: '2026-08-10', kind: 'normal', sheet: [], sprint: [] }
    expect(sprintStreak([empty], '2026-08-10')).toBe(0)
  })
})

describe('dayDone·wordStart — 문장제 도입(스펙 §6)', () => {
  const P = makeProblem('join:whole', () => 0.5)
  const done = (i: number): WordAttempt => ({
    sid: `d:${i}`,
    problem: P,
    answer: P.answer,
    exprs: [],
    ms: 1,
    picks: [],
    calcs: [],
  })
  const wd = (date: string, sprint: boolean, words: number): Day => ({
    ...day(date, sprint),
    ...(words > 0 ? { word: Array.from({ length: words }, (_, i) => done(i)) } : {}),
  })

  it('wordStart는 끝난 문장제가 3개 이상인 첫날', () => {
    expect(wordStart([wd('2026-10-01', true, 2), wd('2026-10-02', true, 3)])).toBe('2026-10-02')
    expect(wordStart([wd('2026-10-01', true, 1)])).toBeNull()
  })

  it('첫날 1~2문항만 끝내도 🔥가 줄지 않는다', () => {
    const before = [wd('2026-10-01', true, 0), wd('2026-10-02', true, 0), wd('2026-10-03', true, 0)]
    const base = sprintStreak(before, '2026-10-03')
    expect(sprintStreak([...before.slice(0, 2), wd('2026-10-03', true, 1)], '2026-10-03')).toBe(
      base,
    )
  })

  it('wordStart 이후는 스프린트 + 3문항이어야 완료, 그 전 날은 스프린트만', () => {
    const start = '2026-10-02'
    expect(dayDone(wd('2026-10-01', true, 0), start)).toBe(true)
    expect(dayDone(wd('2026-10-02', true, 2), start)).toBe(false)
    expect(dayDone(wd('2026-10-02', true, 3), start)).toBe(true)
    expect(dayDone(wd('2026-10-02', false, 3), start)).toBe(false)
    expect(dayDone({ ...wd('2026-10-03', true, 3), kind: 'checkup' }, start)).toBe(true)
    expect(dayDone({ ...wd('2026-10-03', true, 2), kind: 'checkup' }, start)).toBe(false)
  })

  it('도입 뒤 문장제를 건너뛴 날은 결석으로 센다', () => {
    const days = [
      wd('2026-10-01', true, 3),
      wd('2026-10-02', true, 0),
      wd('2026-10-03', true, 0),
      wd('2026-10-04', true, 0),
      wd('2026-10-05', true, 3),
    ]
    expect(sprintStreak(days, '2026-10-05')).toBe(1)
  })
})
