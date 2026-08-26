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

  it('종이만 하고 스프린트를 안 한 날은 세지 않는다', () => {
    const days = [day('2026-08-09', false), day('2026-08-10', true)]
    expect(sprintStreak(days, '2026-08-10')).toBe(1)
  })

  it('빈 sprint 배열은 안 한 것으로 본다', () => {
    const empty: Day = { date: '2026-08-10', kind: 'normal', sheet: [], sprint: [] }
    expect(sprintStreak([empty], '2026-08-10')).toBe(0)
  })
})
