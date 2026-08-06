import { beforeEach, describe, it, expect, vi } from 'vitest'
import {
  getDay,
  putDay,
  getAllDays,
  getMeta,
  putMeta,
  replaceAll,
  resetAll,
  defaultMeta,
  getOutbox,
  deleteOutboxThrough,
  getDeviceState,
  putDeviceState,
} from './db'
import { IDBFactory } from 'fake-indexeddb'
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
      const tx = db.transaction(['days', 'meta', 'outbox', 'device'], 'readwrite')
      tx.objectStore('days').clear()
      tx.objectStore('meta').clear()
      tx.objectStore('outbox').clear()
      tx.objectStore('device').clear()
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
    await putDay(sample, ['sheet'])
    const got = await getDay('2026-08-02')
    expect(got?.sheet[0]?.answer).toBe(85)
  })

  it('없는 day는 undefined를 준다', async () => {
    expect(await getDay('1999-01-01')).toBeUndefined()
  })

  it('전체 day를 날짜 오름차순으로 준다', async () => {
    await putDay(sample, ['sheet'])
    await putDay({ ...sample, date: '2026-08-01' }, ['sheet'])
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
    await putDay({ date: '2026-08-01', kind: 'normal', sheet: [] }, ['sheet'])
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
    await putDay(oldDay, ['sheet'])
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
    await putDay(oldDay, ['sheet'])
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
    await putDay(sample, ['sheet'])
    await putDay({ ...sample, date: '2026-08-01' }, ['sheet'])
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

describe('outbox', () => {
  it('putDay가 같은 트랜잭션으로 표식을 남긴다', async () => {
    await putDay({ date: '2026-08-06', kind: 'normal', sheet: [] }, ['sprint'])
    const entries = await getOutbox()
    expect(entries).toHaveLength(1)
    expect(entries[0]!.target).toBe('day:2026-08-06')
    expect(Object.keys(entries[0]!.bundleAt)).toEqual(['sprint'])
  })

  it('putDay가 days·outbox를 정확히 하나의 트랜잭션으로 연다', async () => {
    // 앞의 "표식을 남긴다" 테스트는 끝 상태만 본다 — day 쓰기와 표식 쓰기가 트랜잭션
    // 둘로 갈라져도 둘 다 성공하면 같은 끝 상태가 나와 구별하지 못한다. 여기서는
    // IDBDatabase.prototype.transaction 자체를 가로채 putDay 한 번이 정말 트랜잭션을
    // 하나만 여는지, 그 하나가 days와 outbox를 함께 묶는지를 직접 검사한다. 트랜잭션이
    // 갈라지면 day 쓰기는 커밋되고 표식만 실패하는 경우가 생길 수 있는데, 그 기록은
    // 표식이 없어 영원히 안 올라간다 — 이 테스트가 막는 게 바로 그 상황이다.
    const original = IDBDatabase.prototype.transaction
    const calls: string[][] = []
    IDBDatabase.prototype.transaction = function (
      this: IDBDatabase,
      storeNames: string | string[],
      ...rest: [IDBTransactionMode?]
    ): IDBTransaction {
      calls.push(([] as string[]).concat(storeNames))
      return original.call(this, storeNames, ...rest)
    }
    try {
      await putDay({ date: '2026-08-06', kind: 'normal', sheet: [] }, ['sprint'])
    } finally {
      IDBDatabase.prototype.transaction = original
    }
    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual(expect.arrayContaining(['days', 'outbox']))
    expect(calls[0]).toHaveLength(2)
  })

  it('deleteOutboxThrough는 maxKey 이하만 지운다', async () => {
    await putDay({ date: '2026-08-06', kind: 'normal', sheet: [] }, ['sprint'])
    const [first] = await getOutbox()
    await putDay({ date: '2026-08-06', kind: 'normal', sheet: [] }, ['grades'])
    await deleteOutboxThrough('day:2026-08-06', first!.key)
    const rest = await getOutbox()
    expect(rest).toHaveLength(1)
    expect(Object.keys(rest[0]!.bundleAt)).toEqual(['grades'])
  })

  it('putMeta가 meta 표식을 남긴다', async () => {
    await putMeta(defaultMeta())
    const entries = await getOutbox()
    expect(entries.some((e) => e.target === 'meta')).toBe(true)
  })

  it('getDeviceState가 deviceId를 한 번만 만든다', async () => {
    const a = await getDeviceState()
    const b = await getDeviceState()
    expect(a.deviceId).toBe(b.deviceId)
    expect(a.deviceKey).toBeNull()
  })

  it('replaceAll이 아웃박스를 비우고 device 스토어는 남긴다', async () => {
    await putDeviceState({ deviceId: 'test', deviceKey: 'k', lastSyncAt: null })
    await putDay({ date: '2026-08-06', kind: 'normal', sheet: [] }, ['sprint'])
    await replaceAll([], defaultMeta())
    expect(await getOutbox()).toHaveLength(0)
    expect((await getDeviceState()).deviceKey).toBe('k')
  })
})

describe('open() 업그레이드 차단', () => {
  it('다른 연결이 옛 버전을 붙들고 있으면 명확한 메시지로 거부한다', async () => {
    // 이 파일의 다른 테스트는 전부 이미 v2로 열려 캐시된 db.ts의 커넥션을 공유한다 —
    // 그 커넥션으로는 업그레이드가 다시 일어나지 않아 blocked를 재현할 수 없다. 완전히
    // 새 fake-indexeddb 팩토리와, dbPromise가 null인 새로 import한 db 모듈로 격리해야
    // "버전 1을 쥔 옛 연결이 남아 있는 채로 버전 2 업그레이드가 시작되는" 상황을 만들 수 있다.
    const originalIndexedDB = globalThis.indexedDB
    const freshFactory = new IDBFactory()
    globalThis.indexedDB = freshFactory as unknown as IDBFactory

    // 옛 v1 연결 — onversionchange를 달지 않는다. 실기기에서 다른 탭·창이 새 코드를
    // 모르는 채로 계속 열려 있는 상황과 같다(그래서 스스로 닫지 않는다).
    const staleConnection = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = freshFactory.open('haruchi', 1)
      req.onupgradeneeded = () => {
        ;(req.result as unknown as IDBDatabase).createObjectStore('days', { keyPath: 'date' })
      }
      req.onsuccess = () => resolve(req.result as unknown as IDBDatabase)
      req.onerror = () => reject(req.error)
    })

    try {
      vi.resetModules()
      const fresh = await import('./db')
      await expect(fresh.getDay('x')).rejects.toThrow(
        '다른 탭이나 창에서 앱이 열려 있어요. 모두 닫고 다시 열어 주세요.',
      )
    } finally {
      staleConnection.close()
      globalThis.indexedDB = originalIndexedDB
      vi.resetModules()
    }
  })
})
