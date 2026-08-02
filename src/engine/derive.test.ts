import { describe, it, expect } from 'vitest'
import { deriveTypes, accuracy, openTags, RECENT_WINDOW } from './derive'
import { VERTICAL_ORDER } from './vertical'
import type { Day, TypeState, VerticalItem } from '../data/types'

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

  it('한 번도 숙련한 적 없는 중간 유형이면 그 뒤는 안 열린다', () => {
    const types = {
      'add2-nocarry': { attempts: Array(RECENT_WINDOW).fill(true) },
      'sub2-noborrow': { attempts: [false, false, ...Array(RECENT_WINDOW - 2).fill(true)] },
    }
    expect(openTags(types)).toEqual(['add2-nocarry', 'sub2-noborrow'])
  })

  it('한 번 숙련한 유형은 최근 성적이 떨어져도 다음 유형을 닫지 않는다', () => {
    // 예전에 10/10을 찍었고, 최근 10회는 8/10으로 내려앉은 유형.
    // accuracy()는 0.8이지만 열린 유형은 회수되지 않는다(설계 §6.2).
    const dipped = {
      attempts: [
        ...Array(RECENT_WINDOW).fill(true),
        ...Array(RECENT_WINDOW - 2).fill(true),
        false,
        false,
      ],
    }
    expect(accuracy(dipped)).toBeLessThan(0.9)
    const types = { 'add2-nocarry': dipped }
    expect(openTags(types)).toEqual(['add2-nocarry', 'sub2-noborrow'])
  })

  it('열린 유형은 뒤에 무엇이 붙어도 다시 닫히지 않는다', () => {
    // 9유형이 전부 열린 상태에서 중간 유형 하나가 흔들려도 집합이 무너지지 않는다.
    // 되돌려잠금 결함의 최소 재현: 이전 구현은 여기서 9개가 3개로 줄었다.
    const types: Record<string, TypeState> = {}
    for (const tag of VERTICAL_ORDER) types[tag] = { attempts: Array(RECENT_WINDOW).fill(true) }
    expect(openTags(types)).toEqual(VERTICAL_ORDER)

    types['add2-carry'] = {
      attempts: [...Array(RECENT_WINDOW).fill(true), ...Array(8).fill(true), false, false],
    }
    expect(openTags(types)).toEqual(VERTICAL_ORDER)
  })

  it('표본이 창을 넘게 쌓여도 중간 어딘가에서 숙련했으면 열린다', () => {
    // 앞 10회는 5/10(미달), 그 뒤로 10회 연속 정답 → 어느 창에선가 숙련을 통과한다.
    const types = {
      'add2-nocarry': {
        attempts: [
          ...Array(5).fill(true),
          ...Array(5).fill(false),
          ...Array(RECENT_WINDOW).fill(true),
        ],
      },
    }
    expect(openTags(types)).toEqual(['add2-nocarry', 'sub2-noborrow'])
  })
})
