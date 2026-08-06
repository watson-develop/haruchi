import { describe, expect, it } from 'vitest'
import { foldOutbox } from './outbox'

describe('foldOutbox', () => {
  it('같은 target을 하나로 접고 bundleAt은 묶음별 최신값의 합집합이다', () => {
    const folded = foldOutbox([
      {
        target: 'day:2026-08-06',
        bundleAt: { sprint: '2026-08-06T10:00:00Z' },
        at: '2026-08-06T10:00:00Z',
      },
      {
        target: 'day:2026-08-06',
        bundleAt: { grades: '2026-08-06T11:00:00Z' },
        at: '2026-08-06T11:00:00Z',
      },
      {
        target: 'day:2026-08-06',
        bundleAt: { sprint: '2026-08-06T12:00:00Z' },
        at: '2026-08-06T12:00:00Z',
      },
    ])
    expect(folded).toEqual([
      {
        target: 'day:2026-08-06',
        bundleAt: { sprint: '2026-08-06T12:00:00Z', grades: '2026-08-06T11:00:00Z' },
        at: '2026-08-06T12:00:00Z',
      },
    ])
  })

  it('다른 target은 섞지 않고 입력 순서를 보존한다', () => {
    const folded = foldOutbox([
      {
        target: 'day:2026-08-05',
        bundleAt: { sheet: '2026-08-05T09:00:00Z' },
        at: '2026-08-05T09:00:00Z',
      },
      { target: 'meta', bundleAt: {}, at: '2026-08-05T09:30:00Z' },
    ])
    expect(folded.map((e) => e.target)).toEqual(['day:2026-08-05', 'meta'])
  })

  it('빈 입력은 빈 출력이다', () => {
    expect(foldOutbox([])).toEqual([])
  })
})
