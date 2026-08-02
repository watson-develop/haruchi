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
    req.onerror = () => reject(req.error ?? new Error('IndexedDB 열기 실패'))
  })
  return dbPromise
}

function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>) {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode)
        const req = fn(tx.objectStore(store))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error ?? new Error('IndexedDB 요청 실패'))
      })
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
  return { derived: emptyDerived(), settings: { ...DEFAULT_SETTINGS } }
}

export async function putMeta(meta: Meta): Promise<void> {
  await run(STORE_META, 'readwrite', (s) => s.put(meta, META_KEY))
}
