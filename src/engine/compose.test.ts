import { describe, it, expect } from 'vitest'
import { composeSheet } from './compose'
import { satisfies } from './vertical'
import { DEFAULT_SETTINGS } from '../data/types'
import type { TypeState } from '../data/types'

const mastered = (): TypeState => ({ attempts: Array(10).fill(true) })

describe('composeSheet', () => {
  it('설정된 문항 수대로 만든다', () => {
    const sheet = composeSheet({ settings: DEFAULT_SETTINGS, types: {} })
    expect(sheet.filter((i) => i.kind === 'vertical')).toHaveLength(8)
    expect(sheet.filter((i) => i.kind === 'inverse')).toHaveLength(2)
    expect(sheet).toHaveLength(10)
  })

  it('verticalCount가 6으로 하향되면 그만큼만 만든다', () => {
    const settings = { ...DEFAULT_SETTINGS, verticalCount: 6 as const }
    const sheet = composeSheet({ settings, types: {} })
    expect(sheet.filter((i) => i.kind === 'vertical')).toHaveLength(6)
    expect(sheet).toHaveLength(8)
  })

  it('문항 id가 모두 다르다', () => {
    const sheet = composeSheet({ settings: DEFAULT_SETTINGS, types: {} })
    expect(new Set(sheet.map((i) => i.id)).size).toBe(sheet.length)
  })

  it('같은 수식이 하루에 중복되지 않는다', () => {
    for (let n = 0; n < 50; n++) {
      const sheet = composeSheet({ settings: DEFAULT_SETTINGS, types: {} })
      const keys = sheet
        .filter((i) => i.kind === 'vertical')
        .map((i) => (i.kind === 'vertical' ? `${i.a}${i.op}${i.b}` : ''))
      expect(new Set(keys).size).toBe(keys.length)
    }
  })

  it('열린 유형만 출제한다', () => {
    const sheet = composeSheet({ settings: DEFAULT_SETTINGS, types: {} })
    for (const item of sheet) {
      if (item.kind === 'vertical') expect(item.tag).toBe('add2-nocarry')
    }
  })

  it('유형이 열리면 그 유형도 섞여 나온다', () => {
    const types = { 'add2-nocarry': mastered(), 'sub2-noborrow': mastered() }
    const tags = new Set<string>()
    for (let n = 0; n < 30; n++) {
      for (const item of composeSheet({ settings: DEFAULT_SETTINGS, types })) {
        if (item.kind === 'vertical') tags.add(item.tag)
      }
    }
    expect(tags.has('add2-carry')).toBe(true)
  })

  it('만들어진 세로셈은 전부 자기 유형 정의를 만족한다', () => {
    const types = {
      'add2-nocarry': mastered(),
      'sub2-noborrow': mastered(),
      'add2-carry': mastered(),
      'sub2-borrow': mastered(),
      'add3-carry1': mastered(),
      'add3-carry2': mastered(),
      'sub3-borrow1': mastered(),
      'sub3-borrow2': mastered(),
    }
    for (let n = 0; n < 50; n++) {
      for (const item of composeSheet({ settings: DEFAULT_SETTINGS, types })) {
        if (item.kind === 'vertical') expect(satisfies(item.tag, item.a, item.b)).toBe(true)
      }
    }
  })

  it('첫 □ 문항에만 힌트가 붙는다', () => {
    const sheet = composeSheet({ settings: DEFAULT_SETTINGS, types: {} })
    const inv = sheet.filter((i) => i.kind === 'inverse')
    expect(inv[0]?.kind === 'inverse' && inv[0].hint).toBeTruthy()
    expect(inv[1]?.kind === 'inverse' && inv[1].hint).toBeUndefined()
  })
})
