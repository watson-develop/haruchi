import { DEFAULT_SETTINGS, emptyDerived } from './types'
import type { Day, Meta } from './types'

const DB_NAME = 'haruchi'
const DB_VERSION = 1
const STORE_DAYS = 'days'
const STORE_META = 'meta'
const META_KEY = 'current'

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

export function getDay(date: string): Promise<Day | undefined> {
  return run<Day | undefined>(STORE_DAYS, 'readonly', (s) => s.get(date))
}

export async function putDay(day: Day): Promise<void> {
  await run(STORE_DAYS, 'readwrite', (s) => s.put(day))
}

export async function getAllDays(): Promise<Day[]> {
  const all = await run<Day[]>(STORE_DAYS, 'readonly', (s) => s.getAll())
  return all.sort((a, b) => a.date.localeCompare(b.date))
}

export async function getMeta(): Promise<Meta> {
  const meta = await run<Meta | undefined>(STORE_META, 'readonly', (s) => s.get(META_KEY))
  if (meta) return meta
  // settings의 얕은 복사만으로는 friendNames 배열이 DEFAULT_SETTINGS와 공유된다 — 별도로 복사한다.
  return {
    derived: emptyDerived(),
    settings: { ...DEFAULT_SETTINGS, friendNames: [...DEFAULT_SETTINGS.friendNames] },
  }
}

export async function putMeta(meta: Meta): Promise<void> {
  await run(STORE_META, 'readwrite', (s) => s.put(meta, META_KEY))
}

/**
 * 가져오기(복구) 전용: days·meta를 통째로 바꾼다. 병합하지 않는다(설계 §10).
 *
 * 두 스토어를 **한 트랜잭션**에 넣는다 — days만 바뀌고 meta가 남는(또는 반대) 반쪽
 * 상태를 만들지 않기 위해서다. put()은 복제 불가능한 값에 **동기로 던지는데**, 그 시점에
 * clear()는 이미 큐에 들어가 있다. 여기서 tx.abort()를 부르지 않으면 예외가 새는 동안
 * 트랜잭션이 "clear만 하고" 커밋해 기존 데이터가 조용히 사라진다.
 */
export function replaceAll(days: Day[], meta: Meta): Promise<void> {
  return open().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction([STORE_DAYS, STORE_META], 'readwrite')
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
        } catch (e) {
          tx.abort()
          reject(e as Error)
        }
      }),
  )
}
