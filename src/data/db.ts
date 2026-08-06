import { DEFAULT_SETTINGS, emptyDerived } from './types'
import type { Day, Meta } from './types'
import type { SyncBundle, OutboxEntry } from '../engine/outbox'

const DB_NAME = 'haruchi'
const DB_VERSION = 2
const STORE_DAYS = 'days'
const STORE_META = 'meta'
const STORE_OUTBOX = 'outbox'
const STORE_DEVICE = 'device'
const META_KEY = 'current'
const DEVICE_KEY = 'current'

export type DeviceState = { deviceId: string; deviceKey: string | null; lastSyncAt: string | null }

let dbPromise: Promise<IDBDatabase> | null = null

/** IndexedDB 연결. 최초 1회만 열고 이후 재사용한다. */
function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_DAYS)) {
        db.createObjectStore(STORE_DAYS, { keyPath: 'date' })
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META)
      }
      if (!db.objectStoreNames.contains(STORE_OUTBOX)) {
        db.createObjectStore(STORE_OUTBOX, { autoIncrement: true })
      }
      if (!db.objectStoreNames.contains(STORE_DEVICE)) {
        db.createObjectStore(STORE_DEVICE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => {
      // 연결 실패를 영구히 캐싱하지 않는다 — 다음 호출이 재시도할 수 있도록 초기화한다.
      dbPromise = null
      reject(req.error ?? new Error('IndexedDB 열기 실패'))
    }
  })
  return dbPromise
}

function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>) {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode)
        const req = fn(tx.objectStore(store))
        let result: T
        req.onsuccess = () => {
          result = req.result
        }
        req.onerror = () => reject(req.error ?? new Error('IndexedDB 요청 실패'))
        // 요청 성공은 커밋을 보장하지 않는다 — 트랜잭션이 실제로 커밋된 뒤에만 resolve한다.
        tx.oncomplete = () => resolve(result)
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB 트랜잭션 실패'))
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB 트랜잭션 중단'))
      }),
  )
}

/** 표식이 커밋된 뒤에만 알린다. 테스트(node) 환경 가드. */
function notifyOutbox(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('haruchi:outbox'))
}

export function getDay(date: string): Promise<Day | undefined> {
  return run<Day | undefined>(STORE_DAYS, 'readonly', (s) => s.get(date))
}

/**
 * Day를 쓰고 같은 트랜잭션으로 아웃박스에 표식을 남긴다(설계 §3 — 쪼개면 "쓰기는 됐는데
 * 표식이 없어 영원히 안 올라가는 기록"이 생긴다). changed는 이번에 실제로 바꾼 묶음이다 —
 * push가 이 묶음의 *_at만 갱신한다. 빈 배열 금지(올릴 이유가 없는 쓰기는 없다).
 */
export function putDay(day: Day, changed: SyncBundle[]): Promise<void> {
  const at = new Date().toISOString()
  const bundleAt: OutboxEntry['bundleAt'] = {}
  for (const b of changed) bundleAt[b] = at
  return open().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction([STORE_DAYS, STORE_OUTBOX], 'readwrite')
        tx.oncomplete = () => {
          notifyOutbox()
          resolve()
        }
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB 트랜잭션 실패'))
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB 트랜잭션 중단'))
        tx.objectStore(STORE_DAYS).put(day)
        tx.objectStore(STORE_OUTBOX).add({ target: `day:${day.date}`, bundleAt, at })
      }),
  )
}

export async function getAllDays(): Promise<Day[]> {
  const all = await run<Day[]>(STORE_DAYS, 'readonly', (s) => s.getAll())
  return all.sort((a, b) => a.date.localeCompare(b.date))
}

/**
 * 한 번도 쓰지 않은 상태의 Meta. getMeta의 기본값과 resetAll이 되돌리는 상태가 같은
 * 곳에서 나와야 둘이 갈라지지 않는다.
 *
 * settings의 얕은 복사만으로는 friendNames 배열이 DEFAULT_SETTINGS와 공유된다 — 별도로 복사한다.
 */
export function defaultMeta(): Meta {
  return {
    derived: emptyDerived(),
    settings: { ...DEFAULT_SETTINGS, friendNames: [...DEFAULT_SETTINGS.friendNames] },
  }
}

export async function getMeta(): Promise<Meta> {
  const meta = await run<Meta | undefined>(STORE_META, 'readonly', (s) => s.get(META_KEY))
  if (meta) return meta
  return defaultMeta()
}

/**
 * Meta를 쓰고 같은 트랜잭션으로 아웃박스에 target 'meta' 표식을 남긴다(putDay와 같은 이유
 * — 쓰기와 표식이 갈라지면 조용히 안 올라간다). meta는 묶음(SyncBundle)이 아니라 설정
 * 하나뿐이라 bundleAt은 항상 빈 객체다 — push가 target으로 meta 전체를 다시 읽는다.
 */
export function putMeta(meta: Meta): Promise<void> {
  const at = new Date().toISOString()
  return open().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction([STORE_META, STORE_OUTBOX], 'readwrite')
        tx.oncomplete = () => {
          notifyOutbox()
          resolve()
        }
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB 트랜잭션 실패'))
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB 트랜잭션 중단'))
        tx.objectStore(STORE_META).put(meta, META_KEY)
        tx.objectStore(STORE_OUTBOX).add({ target: 'meta', bundleAt: {}, at })
      }),
  )
}

/** 아웃박스 전체를 key 오름차순으로 준다. push가 오래된 표식부터 순서대로 접어 올린다. */
export function getOutbox(): Promise<(OutboxEntry & { key: number })[]> {
  return open().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_OUTBOX, 'readonly')
        const out: (OutboxEntry & { key: number })[] = []
        const req = tx.objectStore(STORE_OUTBOX).openCursor()
        req.onsuccess = () => {
          const cursor = req.result
          if (!cursor) return
          out.push({ ...(cursor.value as OutboxEntry), key: cursor.key as number })
          cursor.continue()
        }
        req.onerror = () => reject(req.error ?? new Error('IndexedDB 요청 실패'))
        tx.oncomplete = () => resolve(out)
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB 트랜잭션 실패'))
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB 트랜잭션 중단'))
      }),
  )
}

/**
 * target에 대해 key가 maxKey 이하인 표식만 지운다. push가 읽어간 스냅샷 이후에 새 표식이
 * 끼어들 수 있으므로(진행 중에 다른 화면이 저장) maxKey를 넘는 항목은 절대 건드리지
 * 않는다 — 넘겨서 지우면 아직 안 올라간 변경이 표식 없이 사라진다(설계 §3, Fable 리뷰 5).
 */
export function deleteOutboxThrough(target: string, maxKey: number): Promise<void> {
  return open().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_OUTBOX, 'readwrite')
        const req = tx.objectStore(STORE_OUTBOX).openCursor()
        req.onsuccess = () => {
          const cursor = req.result
          if (!cursor) return
          const key = cursor.key as number
          const value = cursor.value as OutboxEntry
          if (key <= maxKey && value.target === target) cursor.delete()
          cursor.continue()
        }
        req.onerror = () => reject(req.error ?? new Error('IndexedDB 요청 실패'))
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB 트랜잭션 실패'))
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB 트랜잭션 중단'))
      }),
  )
}

/** 없으면 deviceId를 새로 만들어 저장한 뒤 돌려준다 — 이 기기의 첫 동기화 호출이 만든다. */
export async function getDeviceState(): Promise<DeviceState> {
  const state = await run<DeviceState | undefined>(STORE_DEVICE, 'readonly', (s) =>
    s.get(DEVICE_KEY),
  )
  if (state) return state
  const fresh: DeviceState = {
    deviceId: crypto.randomUUID().slice(0, 8),
    deviceKey: null,
    lastSyncAt: null,
  }
  await putDeviceState(fresh)
  return fresh
}

export async function putDeviceState(state: DeviceState): Promise<void> {
  await run(STORE_DEVICE, 'readwrite', (s) => s.put(state, DEVICE_KEY))
}

/**
 * 가져오기(복구) 전용: days·meta·outbox를 통째로 바꾼다. 병합하지 않는다(설계 §10).
 * device는 건드리지 않는다 — deviceId·deviceKey는 이 기기 자체의 정체성이지 백업
 * 내용이 아니다.
 *
 * 세 스토어를 **한 트랜잭션**에 넣는다 — days만 바뀌고 meta가 남는(또는 반대) 반쪽
 * 상태를 만들지 않기 위해서다. put()은 복제 불가능한 값에 **동기로 던지는데**, 그 시점에
 * clear()는 이미 큐에 들어가 있다. 여기서 tx.abort()를 부르지 않으면 예외가 새는 동안
 * 트랜잭션이 "clear만 하고" 커밋해 기존 데이터가 조용히 사라진다.
 *
 * 아웃박스는 낡은 표식을 비우기만 한다 — 전체 교체 후에는 교체 전 상태를 가리키던
 * 표식이 무의미하다(push해도 이미 없는 값을 읽으려 든다).
 */
export function replaceAll(days: Day[], meta: Meta): Promise<void> {
  return open().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction([STORE_DAYS, STORE_META, STORE_OUTBOX], 'readwrite')
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB 트랜잭션 실패'))
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB 트랜잭션 중단'))
        try {
          const dayStore = tx.objectStore(STORE_DAYS)
          dayStore.clear()
          for (const day of days) dayStore.put(day)
          const metaStore = tx.objectStore(STORE_META)
          metaStore.clear()
          metaStore.put(meta, META_KEY)
          tx.objectStore(STORE_OUTBOX).clear()
        } catch (e) {
          tx.abort()
          reject(e as Error)
        }
      }),
  )
}

/**
 * 초기화: 모든 기록과 설정을 지워 앱을 설치 직후 상태로 되돌린다
 * (설계 2026-08-04-data-reset §4). 되돌릴 수 없다.
 *
 * 새 트랜잭션 경로를 만들지 않고 replaceAll을 그대로 태운다 — put()이 동기로 던지는
 * 동안 clear()만 커밋되어 데이터가 조용히 사라지는 함정을 replaceAll이 tx.abort()로
 * 이미 막고 있고 그것이 테스트로 고정돼 있다. 두 번째 파괴적 경로는 같은 함정을
 * 다시 밟을 자리가 된다.
 */
export function resetAll(): Promise<void> {
  return replaceAll([], defaultMeta())
}
