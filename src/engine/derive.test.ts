import { describe, it, expect } from 'vitest'
import { deriveTypes, accuracy, openTags, RECENT_WINDOW } from './derive'
import type { Day, VerticalItem } from '../data/types'

function dayWith(date: string, tag: VerticalItem['tag'], results: boolean[]): Day {
  const sheet: VerticalItem[] = results.map((_, i) => ({
    id: `v${i}`,
    kind: 'vertical',
    tag,
    a: 47,
    b: 38,
    op: '+',
    answer: 85,
  }))
  const grades: Record<string, boolean> = {}
  results.forEach((ok, i) => (grades[`v${i}`] = ok))
  return { date, kind: 'normal', sheet, grades }
}

describe('deriveTypes', () => {
  it('채점된 문항만 이력에 쌓는다', () => {
    const types = deriveTypes([dayWith('2026-08-01', 'add2-carry', [true, false, true])])
    expect(types['add2-carry']?.attempts).toEqual([true, false, true])
  })

  it('채점 안 된 날은 무시한다', () => {
    const d = dayWith('2026-08-01', 'add2-carry', [true])
    delete d.grades
    expect(deriveTypes([d])['add2-carry']).toBeUndefined()
  })

  it('같은 days를 두 번 넣어도 같은 결과를 준다', () => {
    const days = [dayWith('2026-08-01', 'sub2-borrow', [true, false])]
    expect(deriveTypes(days)).toEqual(deriveTypes(days))
  })
})

describe('accuracy', () => {
  it('시도가 10회 미만이면 0이다', () => {
    expect(accuracy({ attempts: Array(9).fill(true) })).toBe(0)
    expect(accuracy(undefined)).toBe(0)
  })

  it('최근 10회만 본다', () => {
    const attempts = [...Array(10).fill(false), ...Array(10).fill(true)]
    expect(accuracy({ attempts })).toBe(1)
  })
})

describe('openTags', () => {
  it('기록이 없으면 첫 유형만 열린다', () => {
    expect(openTags({})).toEqual(['add2-nocarry'])
  })

  it('첫 유형이 90%를 넘으면 두 번째가 열린다', () => {
    const types = { 'add2-nocarry': { attempts: Array(RECENT_WINDOW).fill(true) } }
    expect(openTags(types)).toEqual(['add2-nocarry', 'sub2-noborrow'])
  })

  it('정확히 90%면 열린다 (경계값)', () => {
    const types = {
      'add2-nocarry': { attempts: [false, ...Array(RECENT_WINDOW - 1).fill(true)] },
    }
    expect(openTags(types)).toEqual(['add2-nocarry', 'sub2-noborrow'])
  })

  it('중간 유형이 미달이면 그 뒤는 안 열린다', () => {
    const types = {
      'add2-nocarry': { attempts: Array(RECENT_WINDOW).fill(true) },
      'sub2-noborrow': { attempts: [false, false, ...Array(RECENT_WINDOW - 2).fill(true)] },
    }
    expect(openTags(types)).toEqual(['add2-nocarry', 'sub2-noborrow'])
  })
})
