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
  getStamps,
  deleteOutboxThrough,
  getDeviceState,
  putDeviceState,
  updateDeviceState,
  seedOutbox,
  applyPulledDay,
  applyPulledMeta,
  replaceFromServer,
  clearOutboxRewrite,
  adoptServerDay,
} from './db'
import type { DeviceState } from './db'
import { EMPTY_STAMPS } from '../engine/merge'
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
    await putMeta(
      {
        derived: emptyDerived(),
        settings: { ...DEFAULT_SETTINGS, childName: '서연' },
      },
      ['settings'],
    )
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
    await putMeta({ ...oldMeta, settings: { ...oldMeta.settings, childName: '이전' } }, [
      'settings',
    ])

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
    await putMeta({ ...base, settings: { ...base.settings, childName: '기존이름' } }, ['settings'])
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
    await putMeta({ ...base, settings: { ...base.settings, childName: '기존이름' } }, ['settings'])
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
    await putMeta(
      {
        derived: emptyDerived(),
        settings: { ...DEFAULT_SETTINGS, lastExportedAt: '2026-08-01T00:00:00.000Z' },
      },
      ['export'],
    )

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

  it('putDay가 days·stamps·outbox·device를 정확히 하나의 트랜잭션으로 연다', async () => {
    // 앞의 "표식을 남긴다" 테스트는 끝 상태만 본다 — day 쓰기와 표식 쓰기가 트랜잭션
    // 둘로 갈라져도 둘 다 성공하면 같은 끝 상태가 나와 구별하지 못한다. 여기서는
    // IDBDatabase.prototype.transaction 자체를 가로채 putDay 한 번이 정말 트랜잭션을
    // 하나만 여는지, 그 하나가 네 스토어를 함께 묶는지를 직접 검사한다. 트랜잭션이
    // 갈라지면 day 쓰기는 커밋되고 표식만 실패하는 경우가 생길 수 있는데, 그 기록은
    // 표식이 없어 영원히 안 올라간다 — 이 테스트가 막는 게 바로 그 상황이다.
    // stamps·device가 같은 tx에 들어가는 이유는 병합 경유이기 때문이다: 저장본과 그
    // 스탬프를 읽어 합친 결과를 쓰는 사이에 다른 쓰기가 끼어들면 그 쓰기가 사라진다.
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
    expect(calls[0]).toEqual(expect.arrayContaining(['days', 'stamps', 'outbox', 'device']))
    expect(calls[0]).toHaveLength(4)
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
    await putMeta(defaultMeta(), ['settings'])
    const entries = await getOutbox()
    expect(entries.some((e) => e.target === 'meta')).toBe(true)
  })

  it('getDeviceState가 deviceId를 한 번만 만든다', async () => {
    const a = await getDeviceState()
    const b = await getDeviceState()
    expect(a.deviceId).toBe(b.deviceId)
    expect(a.deviceKey).toBeNull()
  })

  it('pin이 없던 기기 상태를 읽으면 null로 채워진다', async () => {
    // v3 이전에 저장된 상태에는 pin 키 자체가 없다 — normalizeDeviceState가 채운다.
    // 필드 넷(seededAt·generation·lastPulledAt·quarantine)이 밟은 길과 같다.
    await putDeviceState({
      deviceId: 'test',
      deviceKey: 'k',
      lastSyncAt: null,
      seededAt: null,
      generation: null,
      lastPulledAt: null,
      quarantine: [],
    } as unknown as DeviceState) // pin 없는 옛 모양을 일부러 만든다
    const state = await getDeviceState()
    expect(state.pin).toBeNull()
  })

  it('파괴적 경로 둘 다 pin을 보존한다 — 잠금을 푸는 경로가 없다(스펙 §5)', async () => {
    // 보존이 { ...state } 스프레드 한 줄에 기대고 있어, 명시 필드 나열로
    // 리팩터하는 순간 조용히 깨지는 종류다. 이 테스트가 그 보존을 직접 고정한다.
    await updateDeviceState((s) => ({ ...s, pin: '1234' }))
    await replaceAll([], defaultMeta())
    expect((await getDeviceState()).pin).toBe('1234')
    await replaceFromServer([], { value: defaultMeta(), at: { ...EMPTY_STAMPS } }, 1, null)
    expect((await getDeviceState()).pin).toBe('1234')
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
      pin: null,
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
    pin: null,
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

describe('putDay 경로 1 — 병합 경유', () => {
  it('미선언 묶음은 저장본이 이긴다 — 낡은 화면 스냅샷이 pull 결과를 못 덮는다', async () => {
    await putDay({ ...sample, sprint: [{ fact: '2x3', correct: true, ms: 900, sid: 'B:100' }] }, [
      'sprint',
    ])
    // 화면이 sprint 없던 시절의 스냅샷으로 grades만 저장
    await putDay({ ...sample, grades: { v1: true } }, ['grades'])
    const stored = await getDay(sample.date)
    expect(stored?.sprint).toHaveLength(1) // sprint 생존
    expect(stored?.grades).toEqual({ v1: true })
  })

  it('저장본이 없으면 병합 없이 입력을 그대로 쓴다 — 미선언 sprint는 생략, 미선언 sheet는 빈 배열', async () => {
    // 미선언 묶음을 "빈 값"으로 싣는 것과 "아예 넣지 않는 것"은 다르다: mergeSprint는
    // ([], undefined) → []를 준다. 빈 배열을 실으면 스프린트를 한 적 없는 날에
    // sprint: []가 생겨 "빈 세션이 실재한다"는 거짓이 서버까지 간다.
    await putDay(
      { ...sample, grades: { v1: true }, sprint: [{ fact: '2×3', correct: true, ms: 900 }] },
      ['grades'],
    )
    const stored = await getDay(sample.date)
    expect(stored?.grades).toEqual({ v1: true })
    expect('sprint' in stored!).toBe(false)
    expect(stored?.sheet).toEqual([])
  })

  it('미선언 sheet는 저장본이 비어 있어도 되살아나지 않는다 — 존재 규칙이 스탬프보다 세다', async () => {
    // mergeDay의 sheet 규칙은 "한쪽에만 있으면 그쪽"이라 스탬프를 보지 않는다. 그래서
    // 미선언 sheet를 입력에서 빼지 않고 통째로 실으면, 저장본의 빈 sheet를 낡은 화면
    // 스냅샷의 옛 sheet가 이겨 되살린다 — 가져오기로 시트가 갈린 날에 종이와 채점 화면이
    // 어긋나는 경로다(재인쇄 동일성). 스탬프가 null인 것만으로는 못 막는 유일한 묶음이다.
    await replaceAll([{ date: sample.date, kind: 'normal', sheet: [] }], defaultMeta())
    await putDay({ ...sample, sprint: [{ fact: '2×3', correct: true, ms: 900 }] }, ['sprint'])
    const stored = await getDay(sample.date)
    expect(stored?.sheet).toEqual([])
    expect(stored?.sprint).toHaveLength(1)
  })

  it('미선언 grades 묶음은 저장본에 없어도 되살아나지 않는다 — 존재 규칙이 스탬프보다 세다', async () => {
    // sheet와 같은 함정이 grades에도 있다: mergeDay의 grades 판정은 **존재 우선**이라
    // (hasGradesBundle) 저장본에 채점이 없으면 입력 쪽 채점이 스탬프와 무관하게 이긴다.
    // 그래서 gradesAt이 null이라는 것만으로는 무임승차를 못 막는다.
    //
    // 실행 경로: 「다른 기기 것 채택」이 로컬 채점을 **의도적으로 버린 뒤**(adoptServerDay),
    // 채택 이전 스냅샷을 들고 있던 채점 화면이 sprint만 저장하는 상황. 선언 묶음만 싣지
    // 않으면 아빠가 방금 버리기로 한 채점이 되살아나 다른 문제지의 정답표에 앉는다.
    await replaceAll([{ date: sample.date, kind: 'normal', sheet: sample.sheet }], defaultMeta())
    await putDay(
      {
        ...sample,
        grades: { v1: true },
        mood: 'ok',
        doneAt: '2026-08-02T09:00:00.000Z',
        sprint: [{ fact: '2×3', correct: true, ms: 900 }],
      },
      ['sprint'],
    )
    const stored = await getDay(sample.date)
    expect(stored?.grades).toBeUndefined()
    expect(stored?.mood).toBeUndefined()
    expect(stored?.doneAt).toBeUndefined()
    expect(stored?.sprint).toHaveLength(1) // 선언한 묶음은 실렸다
    expect((await getStamps(sample.date))?.gradesAt).toBeNull()
  })

  it('빈 선언은 거부한다 — 서버로 영영 안 가는 쓰기를 만들지 않는다', async () => {
    // 선언이 곧 아웃박스 표식이다(같은 트랜잭션). 빈 배열이면 로컬에는 쓰이고 표식은
    // 없어, 그 변경은 이 기기 밖으로 나가지 못한다. CLAUDE.md의 불변식을 코드가 강제한다.
    expect(() => putDay(sample, [])).toThrow()
    expect(await getDay(sample.date)).toBeUndefined()
    expect(await getOutbox()).toHaveLength(0)
  })

  it('DAY_KNOWN 밖 필드는 입력에서 빠지고 저장본 쪽 값이 남는다', async () => {
    // 모르는 필드는 어떤 묶음에도 속하지 않는다 — 선언할 수 없으니 호출자에게 권한이
    // 없다. 새 버전이 만든 필드를 옛 화면의 저장이 지우지 않게 하는 방어다.
    await replaceAll([{ ...sample, futureField: 'from-storage' } as unknown as Day], defaultMeta())
    await putDay({ ...sample, futureField: 'from-caller' } as unknown as Day, ['sheet'])
    const stored = (await getDay(sample.date)) as unknown as Record<string, unknown>
    expect(stored.futureField).toBe('from-storage')
  })

  it('선언 묶음은 지금 시각·자기 기기로 스탬프된다', async () => {
    await putDeviceState({
      deviceId: 'dev-a',
      deviceKey: null,
      lastSyncAt: null,
      seededAt: null,
      generation: null,
      lastPulledAt: null,
      quarantine: [],
      pin: null,
    })
    await putDay({ ...sample, grades: { v1: true } }, ['grades'])
    const st = await getStamps(sample.date)
    expect(st?.gradesAt).not.toBeNull()
    expect(st?.gradesBy).toBe('dev-a')
    // 선언하지 않은 묶음은 null이어야 한다 — 시각을 세우면 "이 기기의 시트가 최신"이라는
    // 거짓 사실이 서서 서버·다른 기기의 실재하는 시트를 밀어낸다.
    expect(st?.sheetAt).toBeNull()
    expect(st?.sheetBy).toBe('')
    expect(st?.sprintAt).toBeNull()
  })

  it('미선언 묶음의 기존 스탬프는 다음 쓰기 뒤에도 살아남는다 — 아직 못 올린 시트를 지키는 값이다', async () => {
    // mergeDay가 돌려준 스탬프가 아니라 이번 입력의 스탬프를 그냥 쓰면, 채점을 저장하는
    // 순간 sheetAt이 null로 돌아간다. 그 상태로 첫 pull을 맞으면 아직 못 올린 시트가
    // 서버의 sheet_at 있는 행에 져서 종이와 채점 화면이 어긋난다(재인쇄 동일성).
    await putDay(sample, ['sheet'])
    const first = await getStamps(sample.date)
    expect(first?.sheetAt).toEqual(expect.any(String))
    await putDay({ ...sample, grades: { v1: true } }, ['grades'])
    const after = await getStamps(sample.date)
    expect(after?.sheetAt).toBe(first?.sheetAt)
    expect(after?.gradesAt).toEqual(expect.any(String))
  })

  it('쓰기·스탬프·표식이 같은 트랜잭션이다 — 표식 쓰기를 가로채 abort시키면 셋 다 남지 않는다', async () => {
    await putDay(sample, ['sheet'])
    const before = await getDay(sample.date)
    const stampsBefore = await getStamps(sample.date)

    // 표식 쓰기(outbox.add)만 골라 가로채 트랜잭션을 중단시킨다. day·stamps 쓰기는
    // 이미 큐에 들어간 뒤다 — 갈라진 트랜잭션이었다면 그 둘만 커밋돼 "표식 없는 채점"이
    // 남고, 그 채점은 영원히 서버로 안 올라간다.
    const originalAdd = IDBObjectStore.prototype.add
    IDBObjectStore.prototype.add = function (
      this: IDBObjectStore,
      ...args: [unknown, IDBValidKey?]
    ): IDBRequest<IDBValidKey> {
      const req = originalAdd.apply(this, args) as IDBRequest<IDBValidKey>
      if (this.name === 'outbox') this.transaction.abort()
      return req
    }
    try {
      await expect(putDay({ ...sample, grades: { v1: true } }, ['grades'])).rejects.toThrow()
    } finally {
      IDBObjectStore.prototype.add = originalAdd
    }

    expect(await getDay(sample.date)).toEqual(before)
    expect((await getDay(sample.date))?.grades).toBeUndefined()
    expect(await getStamps(sample.date)).toEqual(stampsBefore)
    expect((await getStamps(sample.date))?.gradesAt).toBeNull()
    expect(await getOutbox()).toHaveLength(1) // 첫 putDay의 표식만
  })

  it('rewrite 옵션이 표식에 실린다', async () => {
    await putDay({ ...sample }, ['sheet'], { rewrite: true })
    const entries = await getOutbox()
    expect(entries.some((e) => e.rewrite === true)).toBe(true)
  })

  it('rewrite를 주지 않으면 표식에 rewrite가 없다', async () => {
    await putDay({ ...sample }, ['sheet'])
    const entries = await getOutbox()
    expect(entries.every((e) => e.rewrite === undefined)).toBe(true)
  })
})

describe('putMeta 선언 계약', () => {
  it('빈 선언은 거부한다 — putDay와 같은 계약', async () => {
    expect(() => putMeta(defaultMeta(), [])).toThrow()
    expect(await getStamps('meta')).toBeNull()
  })

  it("['export']는 스탬프도 표식도 남기지 않는다 — 내보내기·되돌리기는 로컬 기록", async () => {
    await putMeta({ ...defaultMeta(), settings: { ...DEFAULT_SETTINGS, lastExportedAt: 'T' } }, [
      'export',
    ])
    expect(await getStamps('meta')).toBeNull()
    expect((await getOutbox()).filter((e) => e.target === 'meta')).toHaveLength(0)
    // 그래도 값은 남아야 한다 — 되돌리기 토스트가 이 값을 다시 읽는다.
    expect((await getMeta()).settings.lastExportedAt).toBe('T')
  })

  it("['settings']는 settingsAt을 찍고 meta 표식을 남긴다", async () => {
    await putDeviceState({
      deviceId: 'dev-b',
      deviceKey: null,
      lastSyncAt: null,
      seededAt: null,
      generation: null,
      lastPulledAt: null,
      quarantine: [],
      pin: null,
    })
    await putMeta(defaultMeta(), ['settings'])
    // `?.settingsAt`은 스탬프 레코드 자체가 없어도 undefined라 not.toBeNull()을 통과한다 —
    // 실제 값이 섰는지를 봐야 이 단언이 무언가를 검사한다.
    const st = await getStamps('meta')
    expect(st).not.toBeNull()
    expect(st?.settingsAt).toEqual(expect.any(String))
    expect(st?.settingsBy).toBe('dev-b')
    expect((await getOutbox()).some((e) => e.target === 'meta')).toBe(true)
  })

  it("['settings'] 표식의 bundleAt은 비어 있다 — meta에는 묶음이 없다", async () => {
    // v3 업그레이드 시딩이 'day:' 접두어가 아닌 target을 건너뛰는 근거이자, push가
    // target만 보고 meta 전체를 다시 읽는다는 계약이다.
    await putMeta(defaultMeta(), ['settings'])
    const entry = (await getOutbox()).find((e) => e.target === 'meta')!
    expect(entry.bundleAt).toEqual({})
  })
})

const devA: DeviceState = {
  deviceId: 'dev-a',
  deviceKey: 'k',
  lastSyncAt: null,
  seededAt: null,
  generation: null,
  lastPulledAt: null,
  quarantine: [],
  pin: null,
}

describe('applyPulledDay — pull 적용 경로(경로 2)', () => {
  it('승자 스탬프를 보존하고 표식을 남기지 않는다 — 메아리 금지', async () => {
    // pull은 "다른 기기가 무엇을 바꿨는지 알게 된 것"이지 이 기기의 변경이 아니다.
    // 수신 시각으로 다시 찍으면 남의 값이 이 기기 시각을 업고 서버의 더 새 값을 이기고,
    // 표식을 남기면 방금 받은 행을 그대로 되쏘아 영원히 도는 메아리가 된다.
    const incoming = {
      value: { ...sample, grades: { v1: true } },
      at: { ...EMPTY_STAMPS, gradesAt: 'T9', gradesBy: 'other' },
    }
    expect(await applyPulledDay(incoming)).toBe(true)
    expect((await getDay(sample.date))?.grades).toEqual({ v1: true })
    const st = await getStamps(sample.date)
    expect(st?.gradesAt).toBe('T9') // 수신 시각 재스탬프 금지
    expect(st?.gradesBy).toBe('other')
    expect(await getOutbox()).toHaveLength(0)
  })

  it('아웃박스 스토어를 트랜잭션에 아예 넣지 않는다 — 실수로도 표식을 남길 수 없다', async () => {
    // 앞 테스트는 "표식이 없다"는 끝 상태만 본다. 스토어가 트랜잭션에 들어 있는 한
    // 나중에 한 줄 추가하는 것으로 메아리가 되살아난다 — 아예 못 여는 구조인지를 본다.
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
      await applyPulledDay({ value: sample, at: { ...EMPTY_STAMPS, sheetAt: 'T1', sheetBy: 'o' } })
    } finally {
      IDBDatabase.prototype.transaction = original
    }
    expect(calls).toHaveLength(1)
    expect([...calls[0]!].sort()).toEqual(['days', 'stamps'])
  })

  it('이긴 쪽의 스탬프만 갈아 끼운다 — 수신 스탬프를 통째로 쓰지 않는다', async () => {
    // 병합이 묶음마다 다른 쪽을 뽑는데 스탬프를 수신 것으로(또는 수신 시각으로) 통째
    // 덮으면, 아직 못 올린 로컬 시트·채점의 시각이 null로 돌아가 다음 pull에 진다.
    await putDeviceState(devA)
    // 시계를 고정해 두 시각을 확실히 갈라 놓는다 — 실제 시계로는 로컬 쓰기와 pull 적용이
    // 같은 밀리초에 떨어질 수 있어, 수신 시각 재스탬프가 우연히 같은 문자열을 만들어
    // 이 단언을 통과해 버린다(Date만 가짜로 둔다 — 타이머까지 세우면 IndexedDB가 멈춘다).
    vi.useFakeTimers({ toFake: ['Date'] })
    let before: Awaited<ReturnType<typeof getStamps>>
    let changed: boolean
    try {
      vi.setSystemTime(new Date('2026-08-10T00:00:00.000Z'))
      await putDay({ ...sample, grades: { v1: true } }, ['sheet', 'grades'])
      before = await getStamps(sample.date)
      vi.setSystemTime(new Date('2026-08-10T05:00:00.000Z'))
      changed = await applyPulledDay({
        value: {
          date: sample.date,
          kind: 'normal',
          sheet: [],
          sprint: [{ fact: '2×3', correct: true, ms: 900, sid: 'other:100' }],
        },
        at: { ...EMPTY_STAMPS, sprintAt: 'T5', sprintBy: 'other' },
      })
    } finally {
      vi.useRealTimers()
    }
    expect(changed).toBe(true)
    const st = await getStamps(sample.date)
    expect(before?.sheetAt).toBe('2026-08-10T00:00:00.000Z')
    expect(st?.sheetAt).toBe(before?.sheetAt)
    expect(st?.sheetBy).toBe('dev-a')
    expect(st?.gradesAt).toBe(before?.gradesAt)
    expect(st?.gradesBy).toBe('dev-a')
    expect(st?.sprintAt).toBe('T5') // 이 묶음만 서버 승자
    expect(st?.sprintBy).toBe('other')
    const day = await getDay(sample.date)
    expect(day?.sheet).toHaveLength(1)
    expect(day?.grades).toEqual({ v1: true })
    expect(day?.sprint).toHaveLength(1)
  })

  it('값이 같아도 스탬프가 새로우면 쓰고 true — 값만 비교하면 스탬프가 뒤처진다', async () => {
    // 같은 내용에 더 새 스탬프가 붙은 행을 무시하면, 이 기기의 스탬프만 낡은 채 남아
    // 이후 병합이 다른 기기와 다르게 풀린다(수렴 실패). 내용이 같아도 상태는 다르다.
    await putDay(sample, ['sheet'])
    const changed = await applyPulledDay({
      value: sample,
      at: { ...EMPTY_STAMPS, sheetAt: '2099-01-01T00:00:00.000Z', sheetBy: 'other' },
    })
    expect(changed).toBe(true)
    const st = await getStamps(sample.date)
    expect(st?.sheetAt).toBe('2099-01-01T00:00:00.000Z')
    expect(st?.sheetBy).toBe('other')
  })

  it('로컬이 안 바뀌면 false — 화면 재렌더 판단의 근거', async () => {
    const incoming = { value: sample, at: { ...EMPTY_STAMPS } }
    expect(await applyPulledDay(incoming)).toBe(true)
    expect(await applyPulledDay(incoming)).toBe(false)
  })
})

describe('clearOutboxRewrite — 의도만 지우고 표식은 남긴다', () => {
  it('rewrite 플래그만 지우고 표식과 bundleAt은 그대로 둔다', async () => {
    // 표식을 통째로 지우면 같은 표식에 접혀 온 채점·스프린트가 영영 안 올라간다.
    // 지워야 하는 것은 "이 종이로 서버를 갈아 끼우겠다"는 의도 하나뿐이다.
    await putDay({ ...sample, sheet: sample.sheet }, ['sheet'], { rewrite: true })
    await clearOutboxRewrite(sample.date)
    const entries = await getOutbox()
    expect(entries).toHaveLength(1)
    expect(entries[0]!.target).toBe(`day:${sample.date}`)
    expect(entries[0]!.rewrite).toBeUndefined()
    expect(Object.keys(entries[0]!.bundleAt)).toEqual(['sheet'])
  })

  it('다른 날짜의 rewrite는 건드리지 않는다', async () => {
    // 격리 해소는 날짜 하나의 결정이다. 전부 지우면 아빠가 방금 「다시 만들기」를 누른
    // 다른 날의 의도까지 사라져 그 종이가 서버에 올라가지 못한다.
    await putDay({ ...sample, date: '2026-08-02' }, ['sheet'], { rewrite: true })
    await putDay({ ...sample, date: '2026-08-03' }, ['sheet'], { rewrite: true })
    await clearOutboxRewrite('2026-08-02')
    const byTarget = new Map((await getOutbox()).map((e) => [e.target, e]))
    expect(byTarget.get('day:2026-08-02')!.rewrite).toBeUndefined()
    expect(byTarget.get('day:2026-08-03')!.rewrite).toBe(true)
  })

  it('같은 날짜에 표식이 여럿이면 전부 지운다', async () => {
    // 하나라도 남으면 그 표식이 다음 push에서 같은 의도로 상대 종이를 도로 덮는다.
    await putDay(sample, ['sheet'], { rewrite: true })
    await putDay(sample, ['sheet'], { rewrite: true })
    await clearOutboxRewrite(sample.date)
    const entries = await getOutbox()
    expect(entries).toHaveLength(2)
    expect(entries.map((e) => e.rewrite)).toEqual([undefined, undefined])
  })

  it('rewrite가 없는 표식은 그대로 남는다', async () => {
    await putDay(sample, ['grades'])
    await clearOutboxRewrite(sample.date)
    const entries = await getOutbox()
    expect(entries).toHaveLength(1)
    expect(Object.keys(entries[0]!.bundleAt)).toEqual(['grades'])
  })
})

describe('adoptServerDay — 「다른 기기 것 채택」의 쓰기', () => {
  it('병합하지 않고 통째로 앉힌다 — 로컬의 어긋난 grades가 남지 않는다', async () => {
    // 격리된 날은 로컬 sheet가 서버와 다르다. 그 위에 병합을 태우면 더 새 스탬프를 든
    // 로컬 sheet·grades가 이겨 「채택」이 아무것도 바꾸지 못한다(다른 문제지의 정답표에
    // 채점이 붙은 채로 남는다). 그래서 이 경로만 병합을 타지 않는다.
    await putDeviceState(devA)
    await putDay({ ...sample, grades: { v1: false } }, ['sheet', 'grades'])
    const serverSheet: Day['sheet'] = [
      { id: 'v9', kind: 'vertical', tag: 'add2-carry', a: 12, b: 34, op: '+', answer: 46 },
    ]
    await adoptServerDay({
      value: { date: sample.date, kind: 'normal', sheet: serverSheet },
      at: { ...EMPTY_STAMPS, sheetAt: 'T1', sheetBy: 'other' },
    })
    const day = await getDay(sample.date)
    expect(day?.sheet).toEqual(serverSheet)
    expect(day?.grades).toBeUndefined()
    const st = await getStamps(sample.date)
    expect(st?.sheetAt).toBe('T1') // 스탬프는 서버 것 보존
    expect(st?.sheetBy).toBe('other')
    expect(st?.gradesAt).toBeNull()
  })

  it('표식을 남기지 않는다 — 받은 것을 되쏘지 않는다', async () => {
    await adoptServerDay({
      value: { date: sample.date, kind: 'normal', sheet: [] },
      at: { ...EMPTY_STAMPS },
    })
    expect(await getOutbox()).toHaveLength(0)
  })
})

describe('applyPulledMeta — pull 적용 경로', () => {
  it('lastExportedAt은 로컬 값이 유지된다 — 기기 로컬 강등(설계 §1)', async () => {
    // mergeMeta는 lastExportedAt에 대해 교환법칙이 성립하지 않는다(완전 동률에서 첫
    // 인자가 남는다) — 그래서 접붙임은 병합 함수 밖, 적용 직전의 방향별 후처리다.
    // 빠지면 「저장 안 했어요」 되돌리기가 다음 pull마다 서버 값으로 부활한다.
    await putMeta(
      { ...defaultMeta(), settings: { ...DEFAULT_SETTINGS, lastExportedAt: 'LOCAL' } },
      ['export'],
    )
    const changed = await applyPulledMeta({
      value: {
        ...defaultMeta(),
        settings: { ...DEFAULT_SETTINGS, lastExportedAt: 'SERVER', fluentMs: 3000 },
      },
      at: { ...EMPTY_STAMPS, settingsAt: 'T9', settingsBy: 'other' },
    })
    expect(changed).toBe(true)
    const meta = await getMeta()
    expect(meta.settings.fluentMs).toBe(3000) // settings는 서버 승자
    expect(meta.settings.lastExportedAt).toBe('LOCAL') // lastExportedAt은 접붙임
    expect((await getStamps('meta'))?.settingsAt).toBe('T9')
    expect(await getOutbox()).toHaveLength(0) // 메아리 금지
  })

  it('설정이 같아도 스탬프가 새로우면 쓰고 true — 값만 비교하면 스탬프가 뒤처진다', async () => {
    // applyPulledDay와 같은 이유(수렴). 여기가 빠지면 settingsAt만 앞선 서버 행을
    // 버리게 되고, 이 기기의 낡은 settingsAt이 남아 다음 설정 변경 경쟁을 다르게 푼다.
    await putDeviceState({ ...devA, deviceId: 'dev-b' })
    await putMeta(defaultMeta(), ['settings'])
    const changed = await applyPulledMeta({
      value: defaultMeta(),
      at: { ...EMPTY_STAMPS, settingsAt: '2099-01-01T00:00:00.000Z', settingsBy: 'other' },
    })
    expect(changed).toBe(true)
    const st = await getStamps('meta')
    expect(st?.settingsAt).toBe('2099-01-01T00:00:00.000Z')
    expect(st?.settingsBy).toBe('other')
  })

  it('meta·stamps만 여는 트랜잭션이다 — 아웃박스를 열 수 없다', async () => {
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
      await applyPulledMeta({ value: defaultMeta(), at: { ...EMPTY_STAMPS } })
    } finally {
      IDBDatabase.prototype.transaction = original
    }
    expect(calls).toHaveLength(1)
    expect([...calls[0]!].sort()).toEqual(['meta', 'stamps'])
  })

  it('로컬이 안 바뀌면 false', async () => {
    const incoming = {
      value: { ...defaultMeta(), settings: { ...DEFAULT_SETTINGS, fluentMs: 3000 } },
      at: { ...EMPTY_STAMPS, settingsAt: 'T9', settingsBy: 'other' },
    }
    expect(await applyPulledMeta(incoming)).toBe(true)
    expect(await applyPulledMeta(incoming)).toBe(false)
  })
})

describe('통째 교체 공통 규정', () => {
  it('replaceAll은 stamps와 격리 목록도 비운다 — 옛 스탬프 + 새 내용 조합 금지', async () => {
    // 스탬프만 남으면 방금 들여온 새 내용이 지워진 기록의 옛 시각을 업는다 —
    // 서버의 실재하는 값이 그 유령 시각에 져서 무음으로 덮인다.
    await putDay({ ...sample, grades: { v1: true } }, ['grades'])
    await putDeviceState({ ...(await getDeviceState()), quarantine: ['2026-08-02'] })
    await replaceAll([sample], defaultMeta())
    expect(await getStamps(sample.date)).toBeNull()
    expect((await getDeviceState()).quarantine).toEqual([])
    expect((await getDeviceState()).seededAt).toBeNull() // 기존 계약 유지
  })

  it('resetAll도 스탬프를 지운다', async () => {
    await putDay(sample, ['sheet'])
    await putMeta(defaultMeta(), ['settings'])
    await resetAll()
    expect(await getStamps(sample.date)).toBeNull()
    expect(await getStamps('meta')).toBeNull()
  })

  it('replaceAll이 스탬프를 지우는 트랜잭션은 하나다', async () => {
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
      await replaceAll([sample], defaultMeta())
    } finally {
      IDBDatabase.prototype.transaction = original
    }
    expect(calls).toHaveLength(1)
    expect([...calls[0]!].sort()).toEqual(['days', 'device', 'meta', 'outbox', 'stamps'])
  })

  it('replaceFromServer는 서버 스탬프를 심고 seededAt을 세운다 — 재시딩 눈사태 금지', async () => {
    // seededAt이 null로 남으면 방금 서버로 맞춘 기기가 "아직 안 시딩됐다"고 보고
    // 서버 사본 전체를 도로 업로드한다.
    await replaceFromServer(
      [{ value: sample, at: { ...EMPTY_STAMPS, sheetAt: 'T1', sheetBy: 'x' } }],
      { value: defaultMeta(), at: { ...EMPTY_STAMPS, settingsAt: 'S1', settingsBy: 'x' } },
      3,
      'C1',
    )
    expect((await getStamps(sample.date))?.sheetAt).toBe('T1')
    expect((await getStamps(sample.date))?.sheetBy).toBe('x')
    expect((await getStamps('meta'))?.settingsAt).toBe('S1')
    const s = await getDeviceState()
    expect(s.seededAt).not.toBeNull()
    expect(s.generation).toBe(3)
    expect(s.lastPulledAt).toBe('C1')
    expect(s.quarantine).toEqual([])
    expect(await getOutbox()).toHaveLength(0)
  })

  it('replaceFromServer는 옛 날짜·옛 스탬프·표식을 남기지 않고 정체성은 지킨다', async () => {
    await putDeviceState({ ...devA, quarantine: ['2026-08-02'], seededAt: 'OLD' })
    await putDay({ ...sample, grades: { v1: true } }, ['sheet', 'grades'])
    expect(await getOutbox()).toHaveLength(1)
    await replaceFromServer(
      [{ value: { date: '2026-09-01', kind: 'normal', sheet: [] }, at: { ...EMPTY_STAMPS } }],
      { value: defaultMeta(), at: { ...EMPTY_STAMPS } },
      7,
      null,
    )
    expect((await getAllDays()).map((d) => d.date)).toEqual(['2026-09-01'])
    expect(await getStamps(sample.date)).toBeNull()
    expect(await getOutbox()).toHaveLength(0)
    const s = await getDeviceState()
    expect(s.deviceId).toBe('dev-a')
    expect(s.deviceKey).toBe('k') // 정체성은 백업 내용이 아니다
    expect(s.quarantine).toEqual([])
    expect(s.lastPulledAt).toBeNull()
  })

  it('replaceFromServer는 전 스토어를 한 트랜잭션으로 연다', async () => {
    // 쪼개지면 days만 서버로 바뀌고 stamps는 옛 것이 남는 반쪽 상태가 실재한다.
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
      await replaceFromServer([], { value: defaultMeta(), at: { ...EMPTY_STAMPS } }, 1, null)
    } finally {
      IDBDatabase.prototype.transaction = original
    }
    expect(calls).toHaveLength(1)
    expect([...calls[0]!].sort()).toEqual(['days', 'device', 'meta', 'outbox', 'stamps'])
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

describe('updateDeviceState — 읽기·쓰기가 한 트랜잭션', () => {
  const registered: DeviceState = {
    deviceId: 'dev-u',
    deviceKey: 'k',
    lastSyncAt: null,
    seededAt: null,
    generation: null,
    lastPulledAt: null,
    quarantine: [],
    pin: null,
  }

  it('get과 put이 트랜잭션 하나다 — 쪼개지면 그 사이 다른 비행의 쓰기가 사라진다', async () => {
    // 이 파일에서 유일하게 구조를 고정하는 단언이다. `getDeviceState()` 뒤에
    // `putDeviceState()`를 잇는 옛 모양은 그 사이에 await가 있어, 앱 시작에 동시에 뜨는
    // push·pull 두 비행이 서로의 필드를 통째로 덮는다(가져오기 직후의 seededAt이 그렇게
    // 되돌아가면 다음 push가 기록 전체를 재시딩한다).
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
      await updateDeviceState((s) => ({ ...s, lastPulledAt: 'P' }))
    } finally {
      IDBDatabase.prototype.transaction = original
    }
    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual(['device'])
  })

  it('함수는 호출자 사본이 아니라 저장본 위에서 돈다', async () => {
    await putDeviceState({ ...registered, seededAt: 'S', quarantine: ['2026-08-01'] })
    await updateDeviceState((s) => ({ ...s, generation: 7 }))
    const s = await getDeviceState()
    expect(s.generation).toBe(7)
    expect(s.seededAt).toBe('S') // 함께 실려 있던 다른 필드도 그대로
    expect(s.quarantine).toEqual(['2026-08-01'])
  })

  it('동시에 다른 필드를 고치면 둘 다 남는다 — 읽고-고쳐-쓰기 경합', async () => {
    await putDeviceState(registered)
    await Promise.all([
      updateDeviceState((s) => ({ ...s, seededAt: 'S' })),
      updateDeviceState((s) => ({ ...s, lastPulledAt: 'P' })),
    ])
    const s = await getDeviceState()
    expect(s.seededAt).toBe('S')
    expect(s.lastPulledAt).toBe('P')
  })

  it('받은 객체를 그대로 돌려주면 쓰지 않는다 — 「이미 그 상태였다」', async () => {
    await putDeviceState(registered)
    const original = IDBObjectStore.prototype.put
    let puts = 0
    IDBObjectStore.prototype.put = function (
      this: IDBObjectStore,
      ...args: [unknown, IDBValidKey?]
    ): IDBRequest<IDBValidKey> {
      if (this.name === 'device') puts++
      return original.apply(this, args) as IDBRequest<IDBValidKey>
    }
    try {
      await updateDeviceState((s) => s)
    } finally {
      IDBObjectStore.prototype.put = original
    }
    expect(puts).toBe(0)
  })

  it('상태가 없으면(등록 전) 초기값을 만들어 그 위에 적용한다', async () => {
    await updateDeviceState((s) => ({ ...s, generation: 3 }))
    const s = await getDeviceState()
    expect(s.generation).toBe(3)
    expect(s.deviceId).toEqual(expect.any(String))
    expect(s.deviceKey).toBeNull()
    expect(s.quarantine).toEqual([])
  })

  it('옛 상태를 고쳐도 나중에 생긴 필드가 보정된 채 저장된다', async () => {
    await putDeviceState({
      deviceId: 'old',
      deviceKey: 'k',
      lastSyncAt: null,
    } as unknown as DeviceState)
    await updateDeviceState((s) => ({ ...s, lastSyncAt: 'T' }))
    const s = await getDeviceState()
    expect(s.lastSyncAt).toBe('T')
    expect(s.quarantine).toEqual([])
    expect(s.generation).toBeNull()
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
