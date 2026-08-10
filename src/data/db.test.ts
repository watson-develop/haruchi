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
  seedOutbox,
} from './db'
import type { DeviceState } from './db'
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
      // 없는 스토어를 열면 transaction()이 이 핸들러 안에서 동기로 던진다 — 프라미스
      // 실행자 밖이라 잡지 않으면 아무도 settle하지 않아 훅이 타임아웃까지 매달린다.
      try {
        const db = req.result
        const stores = ['days', 'meta', 'outbox', 'device', 'stamps']
        const tx = db.transaction(stores, 'readwrite')
        for (const name of stores) tx.objectStore(name).clear()
        tx.oncomplete = () => {
          db.close()
          resolve()
        }
        tx.onerror = () => reject(tx.error ?? new Error('스토어 초기화 실패'))
        tx.onabort = () => reject(tx.error ?? new Error('스토어 초기화 중단'))
      } catch (e) {
        reject(e as Error)
      }
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
    await putDeviceState({
      deviceId: 'test',
      deviceKey: 'k',
      lastSyncAt: null,
      seededAt: null,
      generation: null,
      lastPulledAt: null,
      quarantine: [],
    })
    await putDay({ date: '2026-08-06', kind: 'normal', sheet: [] }, ['sprint'])
    await replaceAll([], defaultMeta())
    expect(await getOutbox()).toHaveLength(0)
    expect((await getDeviceState()).deviceKey).toBe('k')
  })
})

describe('seedOutbox', () => {
  // 등록 전에 쌓인 기록에는 표식이 없다 — 시딩이 없으면 1년치가 영원히 안 올라가면서
  // 상태줄은 "마지막 동기화: 오늘"이라고 말한다. 이 describe가 그 구멍을 지킨다.
  const registered: DeviceState = {
    deviceId: 'test',
    deviceKey: 'k',
    lastSyncAt: null,
    seededAt: null,
    generation: null,
    lastPulledAt: null,
    quarantine: [],
  }

  it('등록 전에 있던 모든 day와 meta에 표식을 만든다', async () => {
    await replaceAll(
      [
        {
          date: '2026-08-01',
          kind: 'normal',
          sheet: [],
          sprint: [{ fact: '2×3', correct: true, ms: 900 }],
        },
        { date: '2026-08-02', kind: 'normal', sheet: [], grades: { v1: true } },
      ],
      defaultMeta(),
    ) // replaceAll은 아웃박스를 비운다 — 표식 없이 기록만 있는 상태를 그대로 만든다
    await putDeviceState(registered)
    expect(await getOutbox()).toHaveLength(0)

    expect(await seedOutbox()).toBe(3) // 이틀 + meta
    const targets = (await getOutbox()).map((e) => e.target).sort()
    expect(targets).toEqual(['day:2026-08-01', 'day:2026-08-02', 'meta'])
  })

  it('Day가 실제로 담고 있는 묶음만 표시한다', async () => {
    await replaceAll(
      [
        {
          date: '2026-08-01',
          kind: 'normal',
          sheet: [],
          sprint: [{ fact: '2×3', correct: true, ms: 900 }],
        },
      ],
      defaultMeta(),
    )
    await putDeviceState(registered)
    await seedOutbox()
    const entry = (await getOutbox()).find((e) => e.target === 'day:2026-08-01')!
    // sheet가 비어 있고 채점도 없는 날이다 — 없는 묶음의 *_at을 찍으면 서버에
    // "빈 채점이 최신"이라는 거짓 사실이 남는다.
    expect(Object.keys(entry.bundleAt)).toEqual(['sprint'])
  })

  it('두 번 불러도 표식이 늘지 않는다 — 키를 다시 저장해도 전량 재업로드하지 않는다', async () => {
    await replaceAll([{ date: '2026-08-01', kind: 'normal', sheet: [] }], defaultMeta())
    await putDeviceState(registered)
    await seedOutbox()
    const after = await getOutbox()
    expect(await seedOutbox()).toBe(0)
    expect(await getOutbox()).toEqual(after)
  })

  it('이미 올라간 뒤(아웃박스가 빈 상태)에 다시 불러도 아무것도 만들지 않는다', async () => {
    await replaceAll([{ date: '2026-08-01', kind: 'normal', sheet: [] }], defaultMeta())
    await putDeviceState(registered)
    await seedOutbox()
    // push가 성공해 표식이 사라진 상태를 흉내 낸다
    for (const e of await getOutbox()) await deleteOutboxThrough(e.target, e.key)
    expect(await getOutbox()).toHaveLength(0)
    expect(await seedOutbox()).toBe(0)
    expect(await getOutbox()).toHaveLength(0)
  })

  it('이미 표식이 있는 target은 건너뛴다', async () => {
    await replaceAll([{ date: '2026-08-01', kind: 'normal', sheet: [] }], defaultMeta())
    await putDeviceState(registered)
    await putDay({ date: '2026-08-01', kind: 'normal', sheet: [] }, ['sheet'])
    expect(await seedOutbox()).toBe(1) // meta 하나만
    expect((await getOutbox()).filter((e) => e.target === 'day:2026-08-01')).toHaveLength(1)
  })

  it('replaceAll 뒤에는 다시 시딩한다 — 서버 반영이 실패해도 영구 미업로드가 되지 않는다', async () => {
    // 가져오기·되돌리기의 실패 모드: 로컬 replaceAll은 성공하고 서버 replace_all이
    // 실패한다. replaceAll은 표식을 전부 지우므로, seededAt이 남아 있으면 방금 들여온
    // 기록에 표식이 하나도 없는데 시딩도 다시 안 돌아 **영원히 못 올라간다** — 화면은
    // "다음 동기화 때 올라간다"고 말하는데 거짓이 된다(원래 Critical 2와 같은 종류).
    await putDeviceState({ ...registered, seededAt: '2026-08-01T00:00:00.000Z' })
    await replaceAll(
      [
        { date: '2026-09-01', kind: 'normal', sheet: [] },
        { date: '2026-09-02', kind: 'normal', sheet: [] },
      ],
      defaultMeta(),
    )
    expect(await getOutbox()).toHaveLength(0)
    const device = await getDeviceState()
    expect(device.seededAt).toBeNull()
    // 정체성은 그대로여야 한다 — 백업 내용이 아니다
    expect(device.deviceKey).toBe('k')
    expect(device.deviceId).toBe('test')

    expect(await seedOutbox()).toBe(3) // 들여온 이틀 + meta
    expect((await getOutbox()).map((e) => e.target).sort()).toEqual([
      'day:2026-09-01',
      'day:2026-09-02',
      'meta',
    ])
  })

  it('기기 상태가 없으면(등록 이전) 아무것도 하지 않는다', async () => {
    await replaceAll([{ date: '2026-08-01', kind: 'normal', sheet: [] }], defaultMeta())
    expect(await seedOutbox()).toBe(0)
    expect(await getOutbox()).toHaveLength(0)
  })

  it('시딩·표식·seededAt 기록을 하나의 트랜잭션에서 한다', async () => {
    // 쪼개지면 표식만 남고 seededAt이 안 찍혀 다음 패스가 또 시딩하거나(중복 업로드),
    // 반대로 seededAt만 찍히고 표식이 없어 기록이 영영 안 올라간다.
    await replaceAll([{ date: '2026-08-01', kind: 'normal', sheet: [] }], defaultMeta())
    await putDeviceState(registered)
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
      await seedOutbox()
    } finally {
      IDBDatabase.prototype.transaction = original
    }
    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual(expect.arrayContaining(['days', 'outbox', 'device']))
  })
})

type V2Seed = {
  days: Day[]
  outbox: { target: string; bundleAt: Record<string, string>; at: string }[]
  device: Record<string, unknown> | null
}

/**
 * v2 시절의 데이터베이스를 손으로 만든다 — 스토어 넷(days·meta·outbox·device)만 있고
 * stamps는 없는 상태. 실기기에서 업그레이드가 마주치는 것이 정확히 이 모양이다.
 * 전역 indexedDB가 이미 새 팩토리로 바꿔치기돼 있다고 가정한다.
 */
function buildV2(seed: V2Seed): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('haruchi', 2)
    req.onupgradeneeded = () => {
      const db = req.result
      db.createObjectStore('days', { keyPath: 'date' })
      db.createObjectStore('meta')
      db.createObjectStore('outbox', { autoIncrement: true })
      db.createObjectStore('device')
    }
    req.onsuccess = () => {
      const db = req.result
      const tx = db.transaction(['days', 'outbox', 'device'], 'readwrite')
      for (const d of seed.days) tx.objectStore('days').put(d)
      for (const e of seed.outbox) tx.objectStore('outbox').add(e)
      if (seed.device) tx.objectStore('device').put(seed.device, 'current')
      tx.oncomplete = () => {
        db.close()
        resolve()
      }
      tx.onerror = () => reject(tx.error ?? new Error('v2 시딩 실패'))
      tx.onabort = () => reject(tx.error ?? new Error('v2 시딩 중단'))
    }
    req.onerror = () => reject(req.error ?? new Error('v2 열기 실패'))
  })
}

/**
 * v2 데이터베이스를 만든 뒤 db.ts를 새로 import해 v3로 열게 한다 — 그 import 안의
 * open()이 실제 업그레이드를 돌린다. 이 파일의 다른 테스트가 공유하는 커넥션은 이미
 * v3로 열려 있어 onupgradeneeded가 다시 불리지 않으므로, 격리된 팩토리와 모듈
 * 레지스트리(dbPromise가 null인 새 모듈)가 둘 다 필요하다.
 *
 * seed가 null이면 v2를 만들지 않는다 — oldVersion 0(설치 직후) 경로다.
 */
async function upgradedFromV2<T>(
  seed: V2Seed | null,
  fn: (db: typeof import('./db')) => Promise<T>,
): Promise<T> {
  const originalIndexedDB = globalThis.indexedDB
  globalThis.indexedDB = new IDBFactory() as unknown as IDBFactory
  try {
    if (seed) await buildV2(seed)
    vi.resetModules()
    const fresh = await import('./db')
    return await fn(fresh)
  } finally {
    globalThis.indexedDB = originalIndexedDB
    vi.resetModules()
  }
}

const v2seed: V2Seed = {
  days: [
    sample, // 2026-08-02 — 표식 둘이 걸린 날
    { date: '2026-08-03', kind: 'normal', sheet: [] }, // 표식 없음 = 이미 push된 날
    { date: '2026-08-04', kind: 'normal', sheet: [] }, // 표식은 있으나 bundleAt이 빈 날
    { ...sample, date: '2026-08-05' }, // 방금 인쇄만 하고 아직 못 올린 시트
  ],
  outbox: [
    // 같은 날짜의 표식 둘 — 접기의 두 성질을 동시에 걸어 둔다.
    // ① grades는 뒤 표식이 더 새롭다: 첫 표식만 쓰면 낡은 09:00이 찍히고, 그러면
    //    서버의 더 새 채점이 이겨 아이가 푼 채점이 무음으로 사라진다.
    // ② sprint는 앞 표식에만 있다: 접지 않고 표식마다 그냥 덮어쓰면 뒤 표식이
    //    앞의 sprint 시각을 지워 미푸시 스프린트가 보호받지 못한다.
    {
      target: 'day:2026-08-02',
      bundleAt: { grades: '2026-08-08T09:00:00.000Z', sprint: '2026-08-08T09:00:00.000Z' },
      at: '2026-08-08T09:00:00.000Z',
    },
    {
      target: 'day:2026-08-02',
      bundleAt: { grades: '2026-08-08T10:00:00.000Z' },
      at: '2026-08-08T10:00:00.000Z',
    },
    // seedOutbox가 빈 날에 남긴 모양 — 지킬 로컬 변경이 없다
    { target: 'day:2026-08-04', bundleAt: {}, at: '2026-08-08T10:00:00.000Z' },
    // sheet만 있는 표식 — 인쇄는 했는데 아직 push 전인 날
    {
      target: 'day:2026-08-05',
      bundleAt: { sheet: '2026-08-08T11:00:00.000Z' },
      at: '2026-08-08T11:00:00.000Z',
    },
    // v1·v2 meta 표식은 bundleAt이 항상 비어 있다 — 시딩할 시각이 없다
    { target: 'meta', bundleAt: {}, at: '2026-08-08T10:00:00.000Z' },
  ],
  device: { deviceId: 'dev1', deviceKey: 'k', lastSyncAt: null, seededAt: null },
}

describe('DB v3 업그레이드', () => {
  it('아웃박스 표식이 있는 날짜는 bundleAt으로 스탬프가 시딩된다 — 미푸시 채점 보호', async () => {
    await upgradedFromV2(v2seed, async (db) => {
      const stamps = await db.getStamps('2026-08-02')
      expect(stamps?.gradesAt).toBe('2026-08-08T10:00:00.000Z')
      expect(stamps?.gradesBy).toBe('dev1')
      // 표식에 없는 묶음은 null이어야 한다 — 없는 sheet에 시각을 찍으면
      // "이 기기의 시트가 최신"이라는 거짓 사실로 서버 시트를 밀어낸다.
      expect(stamps?.sheetAt).toBeNull()
      expect(stamps?.sheetBy).toBe('')
    })
  })

  it('같은 날짜의 표식 여럿은 fold해 묶음별 최신 시각으로 시딩한다', async () => {
    await upgradedFromV2(v2seed, async (db) => {
      const stamps = await db.getStamps('2026-08-02')
      // 첫 표식(09:00)이 아니라 접힌 최신값
      expect(stamps?.gradesAt).toBe('2026-08-08T10:00:00.000Z')
      // 앞 표식에만 있던 묶음도 살아남아야 한다(fold는 묶음별 합집합)
      expect(stamps?.sprintAt).toBe('2026-08-08T09:00:00.000Z')
      expect(stamps?.sprintBy).toBe('dev1')
    })
  })

  it('sheet 표식도 시딩된다 — 미푸시 시트 보호(재인쇄 동일성)', async () => {
    // sheet 가지가 없어도 sheetAt은 EMPTY_STAMPS 덕에 null이라, 위 테스트들의
    // `sheetAt이 null이다` 단언만으로는 이 가지가 살아 있는지 알 수 없다. 여기서
    // 실제 값이 서는지를 따로 못 박는다. 스탬프가 null인 채로 첫 pull을 맞으면 아직
    // 못 올린 시트가 서버의 sheet_at 있는 행에 져서 종이와 채점 화면이 어긋난다.
    await upgradedFromV2(v2seed, async (db) => {
      const stamps = await db.getStamps('2026-08-05')
      expect(stamps?.sheetAt).toBe('2026-08-08T11:00:00.000Z')
      expect(stamps?.sheetBy).toBe('dev1')
      // 이 표식에 없는 묶음은 그대로 null
      expect(stamps?.gradesAt).toBeNull()
      expect(stamps?.sprintAt).toBeNull()
    })
  })

  it('표식이 없는 날짜의 스탬프는 없다(null) — 이미 push된 날', async () => {
    await upgradedFromV2(v2seed, async (db) => {
      expect(await db.getStamps('2026-08-03')).toBeNull()
    })
  })

  it('bundleAt이 빈 day 표식은 스탬프를 만들지 않는다 — 지킬 변경이 없다', async () => {
    await upgradedFromV2(v2seed, async (db) => {
      expect(await db.getStamps('2026-08-04')).toBeNull()
    })
  })

  it('meta 표식은 스탬프를 만들지 않는다 — v2 표식의 bundleAt이 비어 있다', async () => {
    await upgradedFromV2(v2seed, async (db) => {
      expect(await db.getStamps('meta')).toBeNull()
    })
  })

  it('day: 접두어가 없는 target은 스탬프를 만들지 않는다 — 날짜 키가 아니다', async () => {
    // 실제 v2의 meta 표식은 bundleAt이 비어 있어 "빈 묶음" 가드에 먼저 걸린다 —
    // 그래서 접두어 검사만 사라져도 위 테스트들은 아무도 안 깨진다. 여기서 따로 못
    // 박는다: 뒤 단계가 meta에 settings 스탬프를 붙이면 'meta' 표식도 bundleAt을 갖게
    // 되는데, 그때 접두어 검사가 없으면 'meta'.slice(4) === '' 라는 엉뚱한 키로
    // 스탬프가 앉아 날짜 스탬프 사이에 쓰레기가 섞인다.
    const seed: V2Seed = {
      ...v2seed,
      outbox: [
        {
          target: 'meta',
          bundleAt: { grades: '2026-08-08T10:00:00.000Z' },
          at: '2026-08-08T10:00:00.000Z',
        },
      ],
    }
    await upgradedFromV2(seed, async (db) => {
      expect(await db.getStamps('meta')).toBeNull()
      expect(await db.getStamps('')).toBeNull()
    })
  })

  it('기기 상태가 없으면 *By는 빈 문자열이다 — 등록 전 기기', async () => {
    await upgradedFromV2({ ...v2seed, device: null }, async (db) => {
      const stamps = await db.getStamps('2026-08-02')
      expect(stamps?.gradesAt).toBe('2026-08-08T10:00:00.000Z')
      expect(stamps?.gradesBy).toBe('')
    })
  })

  it('업그레이드가 기존 days·outbox를 그대로 둔다', async () => {
    await upgradedFromV2(v2seed, async (db) => {
      expect((await db.getAllDays()).map((d) => d.date)).toEqual([
        '2026-08-02',
        '2026-08-03',
        '2026-08-04',
        '2026-08-05',
      ])
      expect(await db.getOutbox()).toHaveLength(5)
    })
  })

  it('새 데이터베이스(oldVersion 0)에서는 시딩할 표식이 없다', async () => {
    await upgradedFromV2(null, async (db) => {
      expect(await db.getOutbox()).toHaveLength(0)
      expect(await db.getStamps('2026-08-02')).toBeNull()
    })
  })
})

describe('DeviceState v3 필드', () => {
  it('옛 상태를 읽으면 generation·lastPulledAt·quarantine이 보정된다', async () => {
    await putDeviceState({
      deviceId: 'old',
      deviceKey: 'k',
      lastSyncAt: null,
      seededAt: null,
    } as unknown as DeviceState)
    const s = await getDeviceState()
    expect(s.deviceId).toBe('old')
    expect(s.generation).toBeNull()
    expect(s.lastPulledAt).toBeNull()
    expect(s.quarantine).toEqual([])
  })

  it('새로 만든 기기 상태에도 세 필드가 들어 있다', async () => {
    const s = await getDeviceState()
    expect(s.generation).toBeNull()
    expect(s.lastPulledAt).toBeNull()
    expect(s.quarantine).toEqual([])
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
