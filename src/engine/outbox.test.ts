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

  it('배열 순서가 아니라 타임스탬프로 최신을 고른다', () => {
    // 늦게 도착한 낡은 표식이 최신 타임스탬프를 덮으면 다른 기기의 진짜 편집이 낡은 것으로 판정된다.
    const folded = foldOutbox([
      {
        target: 'day:2026-08-06',
        bundleAt: { sprint: '2026-08-06T12:00:00.000Z' },
        at: '2026-08-06T12:00:00.000Z',
      },
      {
        target: 'day:2026-08-06',
        bundleAt: { sprint: '2026-08-06T10:00:00.000Z' },
        at: '2026-08-06T10:00:00.000Z',
      },
    ])
    expect(folded[0]!.bundleAt.sprint).toBe('2026-08-06T12:00:00.000Z')
    expect(folded[0]!.at).toBe('2026-08-06T12:00:00.000Z')
  })

  it('rewrite는 OR로 접힌다 — 한 표식이라도 의도를 밝혔으면 유지', () => {
    const folded = foldOutbox([
      { target: 'day:2026-08-10', bundleAt: { sheet: 'T1' }, at: 'T1', rewrite: true },
      { target: 'day:2026-08-10', bundleAt: { grades: 'T2' }, at: 'T2' },
    ])
    expect(folded[0]!.rewrite).toBe(true)
  })

  it('rewrite 없는 표식끼리는 플래그가 생기지 않는다', () => {
    const folded = foldOutbox([{ target: 'day:2026-08-10', bundleAt: { sheet: 'T1' }, at: 'T1' }])
    expect(folded[0]!.rewrite).toBeUndefined()
  })

  it('rewrite는 순서와 무관하게 OR로 접힌다 — 플래그 있는 표식이 나중에 와도 유지', () => {
    const folded = foldOutbox([
      { target: 'day:2026-08-10', bundleAt: { grades: 'T1' }, at: 'T1' },
      { target: 'day:2026-08-10', bundleAt: { sheet: 'T2' }, at: 'T2', rewrite: true },
    ])
    expect(folded[0]!.rewrite).toBe(true)
  })
})
