import { describe, it, expect } from 'vitest'
import { sprintStreak } from './streak'
import type { Day } from '../data/types'

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

  it('이틀 연속 빠지면 거기서 끊는다', () => {
    const days = [
      day('2026-08-01', true),
      day('2026-08-02', true),
      day('2026-08-09', true),
      day('2026-08-10', true),
    ]
    expect(sprintStreak(days, '2026-08-10')).toBe(2)
  })

  it('종이만 하고 스프린트를 안 한 날은 세지 않는다', () => {
    const days = [day('2026-08-09', false), day('2026-08-10', true)]
    expect(sprintStreak(days, '2026-08-10')).toBe(1)
  })

  it('빈 sprint 배열은 안 한 것으로 본다', () => {
    const empty: Day = { date: '2026-08-10', kind: 'normal', sheet: [], sprint: [] }
    expect(sprintStreak([empty], '2026-08-10')).toBe(0)
  })
})
