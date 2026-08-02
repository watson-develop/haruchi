import { beforeEach, describe, it, expect } from 'vitest'
import { getDay, putDay, getAllDays, getMeta, putMeta } from './db'
import { DEFAULT_SETTINGS, emptyDerived } from './types'
import type { Day } from './types'

const sample: Day = {
  date: '2026-08-02',
  kind: 'normal',
  sheet: [{ id: 'v1', kind: 'vertical', tag: 'add2-carry', a: 47, b: 38, op: '+', answer: 85 }],
}

/**
 * db.ts는 커넥션을 모듈 스코프에 캐시하므로 indexedDB 전역을 테스트마다 바꿔치기해도
 * 그 캐시된 핸들은 그대로 남는다. 그래서 전역을 바꾸는 대신 같은 데이터베이스에 별도
 * 커넥션으로 접속해 스토어 내용만 비운다.
 */
function resetStores(): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('haruchi')
    req.onsuccess = () => {
      const db = req.result
      const tx = db.transaction(['days', 'meta'], 'readwrite')
      tx.objectStore('days').clear()
      tx.objectStore('meta').clear()
      tx.oncomplete = () => {
        db.close()
        resolve()
      }
      tx.onerror = () => reject(tx.error ?? new Error('스토어 초기화 실패'))
      tx.onabort = () => reject(tx.error ?? new Error('스토어 초기화 중단'))
    }
    req.onerror = () => reject(req.error ?? new Error('DB 열기 실패'))
  })
}

beforeEach(async () => {
  // 첫 실행 시 db.ts의 커넥션·오브젝트 스토어가 아직 없을 수 있으므로 먼저 만들어 둔다.
  await getDay('__init__')
  await resetStores()
})

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
    await putDay(sample)
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

  it('getMeta 기본값의 friendNames는 DEFAULT_SETTINGS와 별개의 배열이다', async () => {
    const meta = await getMeta()
    meta.settings.friendNames.push('철수')
    const again = await getMeta()
    expect(again.settings.friendNames).toEqual(DEFAULT_SETTINGS.friendNames)
    expect(DEFAULT_SETTINGS.friendNames).toEqual(['지호', '민아'])
  })
})
