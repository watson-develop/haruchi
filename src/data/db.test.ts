import { beforeEach, describe, it, expect } from 'vitest'
import {
  getDay,
  putDay,
  getAllDays,
  getMeta,
  putMeta,
  replaceAll,
  resetAll,
  defaultMeta,
} from './db'
import { DEFAULT_SETTINGS, emptyDerived } from './types'
import type { Day, Meta } from './types'

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

describe('replaceAll', () => {
  it('기존 데이터를 통째로 바꾼다', async () => {
    await putDay({ date: '2026-08-01', kind: 'normal', sheet: [] })
    const oldMeta = await getMeta()
    await putMeta({ ...oldMeta, settings: { ...oldMeta.settings, childName: '이전' } })

    const newDay: Day = { date: '2026-09-01', kind: 'normal', sheet: [] }
    const newMeta: Meta = {
      ...oldMeta,
      settings: { ...oldMeta.settings, childName: '이후' },
    }
    await replaceAll([newDay], newMeta)

    expect(await getAllDays()).toEqual([newDay])
    expect((await getMeta()).settings.childName).toBe('이후')
  })

  it('도중에 실패하면 기존 데이터가 그대로 남는다 — 가져오기의 원자성 (days 오염)', async () => {
    const oldDay: Day = { date: '2026-08-01', kind: 'normal', sheet: [] }
    await putDay(oldDay)
    // oldMeta를 getMeta()의 "스토어 비어있음" 기본 폴백과 다르게 만든다 — 안 그러면
    // meta 스토어가 실제로 지워져도 getMeta()가 구조적으로 같은 기본값을 다시 만들어내서
    // toEqual(oldMeta)가 롤백 여부와 무관하게 항상 통과해버린다.
    const base = await getMeta()
    await putMeta({ ...base, settings: { ...base.settings, childName: '기존이름' } })
    const oldMeta = await getMeta()

    // 함수는 구조 복제(structured clone)가 안 되므로 put이 동기로 던진다.
    const poisoned = { date: '2026-09-01', kind: 'normal', sheet: [() => {}] } as unknown as Day
    // 새 meta를 기존 meta와 다른 값으로 줘야 meta 단언이 항진명제가 되지 않는다 —
    // 같은 객체를 넘기면 "롤백됐다"와 "커밋됐다"를 구별할 수 없다.
    const newMeta: Meta = { ...oldMeta, settings: { ...oldMeta.settings, childName: '새이름' } }

    await expect(replaceAll([poisoned], newMeta)).rejects.toThrow()
    // clear()가 이미 큐에 들어간 뒤였다 — abort하지 않으면 여기서 빈 배열이 나온다.
    expect(await getAllDays()).toEqual([oldDay])
    expect(await getMeta()).toEqual(oldMeta)
  })

  it('도중에 실패하면 기존 데이터가 그대로 남는다 — 가져오기의 원자성 (meta 오염)', async () => {
    // days는 정상이라 dayStore.clear()·put()이 이미 트랜잭션 큐에 들어간 뒤,
    // metaStore.put()에서 던진다 — 큐에 쌓인 days 쓰기까지 롤백되는지를 검증한다.
    // (days 오염 케이스는 poisoned가 dayStore.put에서 던지므로 metaStore는 아예
    // 큐에 들어가지 않는다 — 그래서 반대 방향 증명이 별도로 필요하다.)
    const oldDay: Day = { date: '2026-08-01', kind: 'normal', sheet: [] }
    await putDay(oldDay)
    // 위와 같은 이유로 oldMeta를 기본 폴백과 구별되는 값으로 고정한다.
    const base = await getMeta()
    await putMeta({ ...base, settings: { ...base.settings, childName: '기존이름' } })
    const oldMeta = await getMeta()

    const normalNewDay: Day = { date: '2026-09-01', kind: 'normal', sheet: [] }
    const poisonedMeta = {
      ...oldMeta,
      settings: { ...oldMeta.settings, poison: () => {} },
    } as unknown as Meta

    await expect(replaceAll([normalNewDay], poisonedMeta)).rejects.toThrow()
    // dayStore.clear()/put(normalNewDay)이 이미 큐에 들어갔더라도 롤백돼야 한다 —
    // 새로 넣으려던 day가 아니라 기존 day만 남아 있어야 한다.
    expect(await getAllDays()).toEqual([oldDay])
    expect(await getMeta()).toEqual(oldMeta)
  })
})

describe('resetAll', () => {
  it('모든 day와 meta를 지운다', async () => {
    await putDay(sample)
    await putDay({ ...sample, date: '2026-08-01' })
    await putMeta({
      derived: emptyDerived(),
      settings: { ...DEFAULT_SETTINGS, lastExportedAt: '2026-08-01T00:00:00.000Z' },
    })

    await resetAll()

    expect(await getAllDays()).toEqual([])
    const meta = await getMeta()
    expect(meta.settings.lastExportedAt).toBeNull()
    expect(meta.settings.verticalCount).toBe(8)
    expect(meta.derived.facts).toEqual({})
  })

  it('defaultMeta는 부를 때마다 별개의 friendNames 배열을 준다', () => {
    const a = defaultMeta()
    const b = defaultMeta()
    a.settings.friendNames.push('철수')
    expect(b.settings.friendNames).toEqual(['지호', '민아'])
    expect(DEFAULT_SETTINGS.friendNames).toEqual(['지호', '민아'])
  })
})
