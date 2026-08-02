import { describe, it, expect } from 'vitest'
import { getDay, putDay, getAllDays, getMeta, putMeta } from './db'
import { DEFAULT_SETTINGS, emptyDerived } from './types'
import type { Day } from './types'

const sample: Day = {
  date: '2026-08-02',
  kind: 'normal',
  sheet: [{ id: 'v1', kind: 'vertical', tag: 'add2-carry', a: 47, b: 38, op: '+', answer: 85 }],
}

describe('db', () => {
  it('day를 저장하고 다시 읽는다', async () => {
    await putDay(sample)
    const got = await getDay('2026-08-02')
    expect(got?.sheet[0]?.answer).toBe(85)
  })

  it('없는 day는 undefined를 준다', async () => {
    expect(await getDay('1999-01-01')).toBeUndefined()
  })

  it('전체 day를 날짜 오름차순으로 준다', async () => {
    await putDay({ ...sample, date: '2026-08-01' })
    const all = await getAllDays()
    expect(all.map((d) => d.date)).toEqual(['2026-08-01', '2026-08-02'])
  })

  it('meta가 없으면 기본값을 준다', async () => {
    const meta = await getMeta()
    expect(meta.settings.verticalCount).toBe(8)
    expect(meta.derived.facts).toEqual({})
  })

  it('meta를 저장하고 다시 읽는다', async () => {
    await putMeta({
      derived: emptyDerived(),
      settings: { ...DEFAULT_SETTINGS, childName: '서연' },
    })
    const meta = await getMeta()
    expect(meta.settings.childName).toBe('서연')
  })
})
