import { describe, it, expect } from 'vitest'
import { dayKey, shiftDay, diffDays, weekdayOf } from './dates'

describe('dayKey', () => {
  it('오후 시각은 그날로 기록한다', () => {
    expect(dayKey(new Date(2026, 7, 2, 19, 30))).toBe('2026-08-02')
  })

  it('새벽 4시는 그날로 기록한다', () => {
    expect(dayKey(new Date(2026, 7, 2, 4, 0))).toBe('2026-08-02')
  })

  it('새벽 3시 59분은 전날로 기록한다', () => {
    expect(dayKey(new Date(2026, 7, 2, 3, 59))).toBe('2026-08-01')
  })

  it('월 경계를 넘어 전날로 간다', () => {
    expect(dayKey(new Date(2026, 7, 1, 1, 0))).toBe('2026-07-31')
  })

  it('연 경계를 넘어 전날로 간다', () => {
    expect(dayKey(new Date(2027, 0, 1, 2, 0))).toBe('2026-12-31')
  })
})

describe('shiftDay', () => {
  it('앞뒤로 이동한다', () => {
    expect(shiftDay('2026-08-02', 1)).toBe('2026-08-03')
    expect(shiftDay('2026-08-01', -1)).toBe('2026-07-31')
    expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28')
  })
})

describe('diffDays', () => {
  it('두 날짜 키의 차이를 센다', () => {
    expect(diffDays('2026-08-01', '2026-08-03')).toBe(2)
    expect(diffDays('2026-08-03', '2026-08-01')).toBe(-2)
    expect(diffDays('2026-08-02', '2026-08-02')).toBe(0)
  })
})

describe('weekdayOf', () => {
  it('요일을 돌려준다 — 0이 일요일', () => {
    expect(weekdayOf('2026-08-02')).toBe(0) // 일
    expect(weekdayOf('2026-08-03')).toBe(1) // 월
    expect(weekdayOf('2026-08-08')).toBe(6) // 토
  })
})
