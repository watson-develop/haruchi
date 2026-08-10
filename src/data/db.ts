import { DEFAULT_SETTINGS, emptyDerived } from './types'
import type { Day, Meta } from './types'
import { foldOutbox } from '../engine/outbox'
import type { SyncBundle, OutboxEntry } from '../engine/outbox'
import { EMPTY_STAMPS, mergeDay } from '../engine/merge'
import type { BundleStamps } from '../engine/merge'

const DB_NAME = 'haruchi'
const DB_VERSION = 3
const STORE_DAYS = 'days'
const STORE_META = 'meta'
const STORE_OUTBOX = 'outbox'
const STORE_DEVICE = 'device'
const STORE_STAMPS = 'stamps'
const META_KEY = 'current'
const DEVICE_KEY = 'current'
/** stamps 스토어에서 meta의 스탬프가 앉는 키. 날짜 키와 같은 스토어를 쓰지만 형식이 달라
 *  섞이지 않는다(YYYY-MM-DD가 아니다) — v3 시딩이 `day:` 접두어만 보는 이유와 같은 짝이다. */
const META_STAMPS_KEY = 'meta'

export type DeviceState = {
  deviceId: string
  deviceKey: string | null
  lastSyncAt: string | null
  /**
   * 등록 전부터 있던 기록 전체를 아웃박스에 넣은 시각. null이면 아직 안 했다.
   * 이 한 값이 seedOutbox를 정확히 한 번만 돌게 한다(키를 다시 저장해도 전량
   * 재업로드하지 않는다). device 스토어에 사는 이유는 설계 §3의 표: 기기마다 다른 값이다.
   */
  seededAt: string | null
  /** 마지막으로 관찰한 서버 generation. null이면 아직 한 번도 못 봤다(설계 2단계 §3). */
  generation: number | null
  /** pull 커서 — 서버 응답의 최대 updated_at으로만 갱신한다(클라이언트 시계를 안 믿는다). */
  lastPulledAt: string | null
  /** 격리된 날짜 목록. 자동 해소하지 않고 배너로 알린다(설계 2단계 §2). */
  quarantine: string[]
}

let dbPromise: Promise<IDBDatabase> | null = null

/**
 * v3 업그레이드 1회: 아직 아웃박스에 표식이 남아 있는 날짜의 스탬프를 그 표식의
 * bundleAt으로 채운다(설계 2단계 §1, 4라운드 Critical).
 *
 * **왜 필요한가.** 스탬프가 null이면 병합에서 "모름"이라 서버의 실재하는 `grades_at`에
 * 반드시 진다. 아직 못 올린 로컬 채점이 있는 날에 그대로 첫 pull이 들어오면, 아이가 푼
 * 채점이 서버의 더 낡은 값으로 무음으로 덮인다. 표식이 남아 있다는 것이 바로 "아직 안
 * 올라간 로컬 변경이 있다"는 뜻이므로, 그 날짜만 골라 시각을 세워 준다.
 *
 * **왜 접은 뒤인가.** 한 날짜에 표식이 여럿 쌓여 있는 것이 정상이다(채점하다 저장할
 * 때마다 하나씩). 그중 첫 표식으로 찍으면 낡은 시각이 서고, 그러면 그 사이에 다른
 * 기기가 올린 더 새 값이 이겨 결국 같은 사고가 난다. foldOutbox가 묶음별 최신값으로
 * 접어 준다.
 *
 * **표식이 없는 날짜는 건드리지 않는다.** 이미 push된 날이라 null(=진다)이 옳다 —
 * 첫 pull이 같은 내용으로 수렴시킨다. bundleAt이 빈 표식(빈 날에 seedOutbox가 남긴
 * 모양)과 meta 표식도 마찬가지로 세울 시각이 없다.
 *
 * 반드시 **버전 변경 트랜잭션 안에서만** 돈다 — 스토어 생성과 시딩이 한 트랜잭션이라
 * 중간에 끊기면 버전 상승까지 통째로 롤백되고, 다음 열기가 v2 상태에서 다시 시작한다.
 */
function seedStamps(tx: IDBTransaction): void {
  // deviceId를 먼저 읽는다 — *By가 "누가 이 시각을 찍었나"이므로 자기 기기여야 한다.
  // 아직 등록 전이라 상태가 없으면 ''(모름)이다. 서버의 옛 행도 ''로 읽히므로 일관된다.
  const deviceReq = tx.objectStore(STORE_DEVICE).get(DEVICE_KEY)
  deviceReq.onsuccess = () => {
    const deviceId = (deviceReq.result as DeviceState | undefined)?.deviceId ?? ''
    const entries: OutboxEntry[] = []
    const cursorReq = tx.objectStore(STORE_OUTBOX).openCursor()
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result
      if (cursor) {
        entries.push(cursor.value as OutboxEntry)
        cursor.continue()
        return
      }
      // 아웃박스를 끝까지 읽은 뒤에 접는다 — 중간에 접으면 뒤에 올 최신 표식을 놓친다.
      const stamps = tx.objectStore(STORE_STAMPS)
      for (const folded of foldOutbox(entries)) {
        if (!folded.target.startsWith('day:')) continue
        const { sheet, grades, sprint } = folded.bundleAt
        if (!sheet && !grades && !sprint) continue
        stamps.put(
          {
            ...EMPTY_STAMPS,
            ...(sheet ? { sheetAt: sheet, sheetBy: deviceId } : {}),
            ...(grades ? { gradesAt: grades, gradesBy: deviceId } : {}),
            ...(sprint ? { sprintAt: sprint, sprintBy: deviceId } : {}),
          },
          folded.target.slice('day:'.length),
        )
      }
    }
  }
}

/** IndexedDB 연결. 최초 1회만 열고 이후 재사용한다. */
function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = (event) => {
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
      if (!db.objectStoreNames.contains(STORE_STAMPS)) {
        db.createObjectStore(STORE_STAMPS)
      }
      // 버전 변경 트랜잭션은 여기서만 얻을 수 있다 — 새로 열면 에러이고, 이 밖에서
      // 비동기로 하면 트랜잭션이 이미 커밋된 뒤라 시딩이 조용히 일어나지 않는다.
      const tx = req.transaction
      if (tx && event.oldVersion < 3) seedStamps(tx)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => {
      // 연결 실패를 영구히 캐싱하지 않는다 — 다음 호출이 재시도할 수 있도록 초기화한다.
      dbPromise = null
      reject(req.error ?? new Error('IndexedDB 열기 실패'))
    }
    // 버전 2로 올리면서 업그레이드가 처음으로 실제로 일어난다 — 이전까지는 DB_VERSION이
    // 계속 1이라 onupgradeneeded도, 그것을 막는 blocked도 실제 기기에서 일어난 적이
    // 없었다. 다른 탭·창(또는 재설치 전 남아있던 페이지)이 옛 연결을 쥐고 있으면 여기서
    // 막힌다 — onsuccess도 onerror도 끝내 안 불려서 이 프라미스가 영원히 끝나지 않고,
    // 그걸 기다리는 화면은 에러 배너도 없이 그냥 빈 채로 멈춘다.
    req.onblocked = () => {
      dbPromise = null
      reject(new Error('다른 탭이나 창에서 앱이 열려 있어요. 모두 닫고 다시 열어 주세요.'))
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
 * 호출자가 선언한 묶음만 남긴 입력 Day를 만든다(설계 2단계 §1).
 *
 * **왜 호출자의 객체를 그대로 쓰지 않는가.** 화면은 getDay로 읽은 스냅샷을 들고 한참
 * 작업한다. 그 사이 pull이 다른 기기의 값을 적용했다면, 화면이 한 묶음만 고쳐 통째로
 * 저장하는 순간 그 값이 조용히 사라진다. 선언한 묶음만 실으면 나머지는 mergeDay가
 * 저장본 쪽에서 가져온다. 미선언 묶음의 스탬프가 null인 것만으로 막히지 않는 자리가
 * 실재한다 — sheet는 **존재 규칙**(한쪽에만 있으면 그쪽)이 스탬프보다 세서, 저장본의
 * 빈 sheet를 낡은 스냅샷의 옛 sheet가 그냥 이긴다(재인쇄 동일성이 깨지는 경로다).
 *
 * **왜 미선언 sheet는 `[]`이고 미선언 grades·sprint는 아예 넣지 않는가.** mergeDay의
 * 존재 규칙이 그렇게 읽는다. sheet는 Day의 필수 필드라 뺄 수 없고 "길이 0 = 없음"이
 * 그 부재 표현이다. 반면 sprint에 빈 배열을 실으면 mergeSprint([], undefined)가 `[]`를
 * 주므로, 스프린트를 한 적 없는 날에 `sprint: []`가 생겨 "빈 세션이 실재한다"는 거짓이
 * 서버까지 간다. grades도 `{}`를 실으면 병합 결과에 빈 채점이 앉을 수 있다.
 *
 * **모르는 필드는 뺀다.** 어떤 묶음에도 속하지 않아 선언할 수 없는 값이다 — 호출자에게
 * 권한이 없다. 새 버전이 만든 필드를 옛 화면의 저장이 지우지 못하게 하는 방어이기도
 * 하다(mergeDay가 저장본 쪽 값을 그대로 남긴다).
 *
 * kind는 묶음이 아니라 늘 싣는다 — mergeDay가 "한쪽이라도 checkup이면 checkup"으로
 * 합치므로 스프린트 저장이 점검 표시를 세우는 유일한 경로가 유지된다.
 */
function declaredDay(day: Day, changed: SyncBundle[]): Day {
  const input: Day = {
    date: day.date,
    kind: day.kind,
    sheet: changed.includes('sheet') ? day.sheet : [],
  }
  if (changed.includes('grades')) {
    // grades 묶음은 세 필드다(mergeDay의 hasGradesBundle) — 채점·기분·끝낸 시각.
    if (day.grades !== undefined) input.grades = day.grades
    if (day.mood !== undefined) input.mood = day.mood
    if (day.doneAt !== undefined) input.doneAt = day.doneAt
  }
  if (changed.includes('sprint') && day.sprint !== undefined) input.sprint = day.sprint
  return input
}

/**
 * Day를 **저장본과 병합해** 쓰고, 같은 트랜잭션으로 스탬프와 아웃박스 표식을 남긴다
 * (설계 §3·2단계 §1 — 쪼개면 "쓰기는 됐는데 표식이 없어 영원히 안 올라가는 기록"이 생기고,
 * 병합을 거치지 않으면 낡은 화면 스냅샷이 방금 pull한 값을 지운다).
 *
 * changed는 이번에 실제로 바꾼 묶음이다 — 이 선언이 (1) 무엇을 저장본 위에 얹을지,
 * (2) 어느 스탬프를 지금·이 기기로 찍을지, (3) push가 어느 *_at을 갱신할지를 한꺼번에
 * 정한다. 빈 배열 금지(올릴 이유가 없는 쓰기는 없다). 실제로 바꾼 것과 다르게 적으면
 * 그 변경은 로컬에만 남고 서버로 가지 않는다.
 *
 * opts.rewrite는 부모가 「다시 만들기」로 시트를 의도적으로 갈아 끼웠다는 뜻이다 —
 * push가 충돌 격리와 구분한다.
 *
 * 트랜잭션에 device·stamps가 함께 들어가는 이유: 저장본과 그 스탬프를 읽어 합친 결과를
 * 쓰는 사이에 다른 쓰기가 끼어들면 그 쓰기가 통째로 사라진다(read-modify-write).
 */
export function putDay(day: Day, changed: SyncBundle[], opts?: { rewrite?: true }): Promise<void> {
  const at = new Date().toISOString()
  const bundleAt: OutboxEntry['bundleAt'] = {}
  for (const b of changed) bundleAt[b] = at
  return open().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(
          [STORE_DAYS, STORE_STAMPS, STORE_OUTBOX, STORE_DEVICE],
          'readwrite',
        )
        tx.oncomplete = () => {
          notifyOutbox()
          resolve()
        }
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB 트랜잭션 실패'))
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB 트랜잭션 중단'))

        // 표식은 day·stamps 쓰기를 큐에 넣은 **뒤에** 남긴다. 표식 쓰기가 실패해
        // 트랜잭션이 깨지면 앞의 두 쓰기도 함께 롤백돼야 한다는 성질을 테스트가 그
        // 순서로 검증한다(표식을 먼저 넣으면 그 뒤가 아예 실행되지 않아 증명이 약해진다).
        const mark = (): void => {
          tx.objectStore(STORE_OUTBOX).add({
            target: `day:${day.date}`,
            bundleAt,
            at,
            ...(opts?.rewrite ? { rewrite: true as const } : {}),
          })
        }

        const deviceReq = tx.objectStore(STORE_DEVICE).get(DEVICE_KEY)
        deviceReq.onsuccess = () => {
          // 아직 등록 전이면 ''(모름) — v3 시딩과 서버의 옛 행이 쓰는 값과 같다.
          const deviceId = (deviceReq.result as DeviceState | undefined)?.deviceId ?? ''
          const input = declaredDay(day, changed)
          // 선언하지 않은 묶음은 반드시 null로 남긴다 — 시각을 찍으면 "이 기기 값이
          // 최신"이라는 거짓 사실이 서서 저장본·서버의 실재하는 값을 밀어낸다.
          const inputStamps: BundleStamps = {
            ...EMPTY_STAMPS,
            ...(changed.includes('sheet') ? { sheetAt: at, sheetBy: deviceId } : {}),
            ...(changed.includes('grades') ? { gradesAt: at, gradesBy: deviceId } : {}),
            ...(changed.includes('sprint') ? { sprintAt: at, sprintBy: deviceId } : {}),
          }

          const dayStore = tx.objectStore(STORE_DAYS)
          const stampsStore = tx.objectStore(STORE_STAMPS)
          const storedReq = dayStore.get(day.date)
          storedReq.onsuccess = () => {
            const stored = storedReq.result as Day | undefined
            if (!stored) {
              // 합칠 상대가 없다. 입력을 그대로 쓴다 — 미선언 묶음은 애초에 없던
              // 상태로 시작하고(잃을 것이 없다), 그 스탬프도 null 그대로다.
              dayStore.put(input)
              stampsStore.put(inputStamps, day.date)
              mark()
              return
            }
            const stampReq = stampsStore.get(day.date)
            stampReq.onsuccess = () => {
              const storedStamps = (stampReq.result as BundleStamps | undefined) ?? EMPTY_STAMPS
              // mergeDay는 이긴 쪽의 스탬프를 그대로 돌려준다 — 여기서 다시 찍지 않는다.
              const merged = mergeDay(
                { value: stored, at: storedStamps },
                { value: input, at: inputStamps },
              )
              dayStore.put(merged.value)
              stampsStore.put(merged.at, day.date)
              mark()
            }
          }
        }
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
 * Meta를 쓴다. changed가 무엇을 바꿨는지 선언한다 — putDay와 같은 계약이지만 값이 다르다.
 *
 * - `'settings'` — 진짜 설정 변경. 같은 트랜잭션으로 meta 스탬프(settingsAt·settingsBy)를
 *   찍고 아웃박스에 target 'meta' 표식을 남긴다. meta는 묶음(SyncBundle)이 여럿이 아니라
 *   설정 하나뿐이라 표식의 bundleAt은 항상 빈 객체다 — push가 target으로 meta 전체를 다시
 *   읽는다. (이 빈 bundleAt은 v3 업그레이드 시딩이 meta 표식을 건너뛰는 근거이기도 하다.)
 * - `'export'` — `lastExportedAt`만 움직였다. **이 값은 기기별 로컬 기록이다**(설계 §3의
 *   표, mergeMeta가 비교에서 아예 떼어낸다). 스탬프도 표식도 남기지 않는다 — 백업 파일을
 *   내려받은 사실은 다른 기기에 올릴 것이 없고, 표식을 남기면 매 내보내기가 무의미한
 *   설정 push를 유발하며 settingsAt까지 밀어 올려 다른 기기의 진짜 설정 변경을 이긴다.
 *
 * 어느 쪽이든 값 자체는 쓴다 — 되돌리기 토스트가 방금 쓴 값을 다시 읽는다.
 */
export function putMeta(meta: Meta, changed: ('settings' | 'export')[]): Promise<void> {
  const at = new Date().toISOString()
  const settingsChanged = changed.includes('settings')
  return open().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(
          settingsChanged ? [STORE_META, STORE_STAMPS, STORE_OUTBOX, STORE_DEVICE] : [STORE_META],
          'readwrite',
        )
        tx.oncomplete = () => {
          if (settingsChanged) notifyOutbox()
          resolve()
        }
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB 트랜잭션 실패'))
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB 트랜잭션 중단'))
        tx.objectStore(STORE_META).put(meta, META_KEY)
        if (!settingsChanged) return

        const deviceReq = tx.objectStore(STORE_DEVICE).get(DEVICE_KEY)
        deviceReq.onsuccess = () => {
          const deviceId = (deviceReq.result as DeviceState | undefined)?.deviceId ?? ''
          const stampsStore = tx.objectStore(STORE_STAMPS)
          const cur = stampsStore.get(META_STAMPS_KEY)
          cur.onsuccess = () => {
            // 기존 레코드를 이어 쓴다 — meta 스탬프에 지금 서는 것은 settings뿐이지만
            // 통째로 갈아 끼우면 나중에 다른 값이 붙을 때 조용히 지운다.
            const prev = (cur.result as BundleStamps | undefined) ?? EMPTY_STAMPS
            stampsStore.put({ ...prev, settingsAt: at, settingsBy: deviceId }, META_STAMPS_KEY)
            tx.objectStore(STORE_OUTBOX).add({ target: 'meta', bundleAt: {}, at })
          }
        }
      }),
  )
}

/**
 * 날짜(또는 meta의 스탬프를 뜻하는 `'meta'`) 하나의 묶음 스탬프. 없으면 null —
 * "이 기기가 언제 썼는지 모른다"는 뜻이고, 병합에서 시각이 실재하는 쪽에 진다.
 */
export function getStamps(date: string): Promise<BundleStamps | null> {
  return run<BundleStamps | undefined>(STORE_STAMPS, 'readonly', (s) => s.get(date)).then(
    (v) => v ?? null,
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
  // seededAt·generation·lastPulledAt·quarantine은 나중에 생긴 필드다 — 그 전에 저장된
  // 상태에는 키 자체가 없으므로 여기서 채워 타입이 실제 값과 어긋나지 않게 한다
  // (그런 기기는 아직 시딩 전·pull 전이고 격리된 날짜도 없는 것이 맞다).
  if (state)
    return {
      ...state,
      seededAt: state.seededAt ?? null,
      generation: state.generation ?? null,
      lastPulledAt: state.lastPulledAt ?? null,
      quarantine: state.quarantine ?? [],
    }
  const fresh: DeviceState = {
    deviceId: crypto.randomUUID().slice(0, 8),
    deviceKey: null,
    lastSyncAt: null,
    seededAt: null,
    generation: null,
    lastPulledAt: null,
    quarantine: [],
  }
  await putDeviceState(fresh)
  return fresh
}

/** Day가 실제로 담고 있는 묶음만 고른다. 없는 묶음의 *_at을 찍으면 나중에 pull이 붙을 때
 *  "빈 채점이 최신"이라는 거짓 사실이 서버에 남는다. */
function bundlesOf(day: Day, at: string): OutboxEntry['bundleAt'] {
  const bundleAt: OutboxEntry['bundleAt'] = {}
  if (day.sheet.length > 0) bundleAt.sheet = at
  if (day.grades && Object.keys(day.grades).length > 0) bundleAt.grades = at
  if (day.sprint && day.sprint.length > 0) bundleAt.sprint = at
  return bundleAt
}

/**
 * 등록 직후 1회: 이미 저장돼 있던 모든 Day와 meta에 아웃박스 표식을 남긴다.
 *
 * 표식은 putDay·putMeta만 만든다. 그래서 기기를 등록하기 **전에** 쌓인 1년치 기록은
 * 표식이 없어 영원히 서버에 올라가지 않는데, 그러면서 상태줄은 "마지막 동기화: 오늘"이라고
 * 말한다 — 이 브랜치가 지키려는 바로 그 기록이 백업된 줄 알고 방치되는, 설계가 최악이라고
 * 부른 실패 모드다(A-1).
 *
 * 규칙 셋:
 * - **멱등하다.** device.seededAt이 서 있으면 아무것도 하지 않고, 이미 표식이 있는
 *   target은 건너뛴다. 키를 다시 저장해도 전량 재업로드가 일어나지 않는다
 * - **한 트랜잭션이다.** days 순회·표식 추가·seededAt 기록이 모두 같은 tx 안이라
 *   절반만 시딩된 상태가 생길 수 없다
 * - **호출은 sync.ts가 한다.** 설정이 비어 있으면 push 자체가 시작되지 않으므로
 *   이 함수도 돌지 않는다(inert 보장)
 *
 * 돌려주는 값은 새로 남긴 표식 수다(0이면 이미 시딩됐거나 올릴 기록이 없었다).
 */
export function seedOutbox(): Promise<number> {
  return open().then(
    (db) =>
      new Promise<number>((resolve, reject) => {
        const tx = db.transaction([STORE_DAYS, STORE_OUTBOX, STORE_DEVICE], 'readwrite')
        let added = 0
        tx.oncomplete = () => {
          if (added > 0) notifyOutbox()
          resolve(added)
        }
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB 트랜잭션 실패'))
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB 트랜잭션 중단'))

        const deviceStore = tx.objectStore(STORE_DEVICE)
        const outboxStore = tx.objectStore(STORE_OUTBOX)
        const deviceReq = deviceStore.get(DEVICE_KEY)
        deviceReq.onsuccess = () => {
          const state = deviceReq.result as DeviceState | undefined
          // 기기 상태가 아직 없으면 등록 자체가 없었다는 뜻이라 시딩할 이유가 없다.
          if (!state || state.seededAt) return
          const at = new Date().toISOString()
          const existing = new Set<string>()
          const outboxCursor = outboxStore.openCursor()
          outboxCursor.onsuccess = () => {
            const cursor = outboxCursor.result
            if (cursor) {
              existing.add((cursor.value as OutboxEntry).target)
              cursor.continue()
              return
            }
            // 아웃박스를 다 읽은 뒤에야 days를 훑는다 — 중복 판정에 필요한 집합이 그때 완성된다.
            const dayCursor = tx.objectStore(STORE_DAYS).openCursor()
            dayCursor.onsuccess = () => {
              const c = dayCursor.result
              if (c) {
                const day = c.value as Day
                const target = `day:${day.date}`
                if (!existing.has(target)) {
                  outboxStore.add({ target, bundleAt: bundlesOf(day, at), at })
                  added++
                }
                c.continue()
                return
              }
              // meta는 항상 올린다 — 한 번도 쓴 적이 없으면 기본값이 올라갈 뿐이고,
              // 서버 meta 행이 이 가족의 설정으로 채워지는 것은 그것대로 맞다.
              if (!existing.has('meta')) {
                outboxStore.add({ target: 'meta', bundleAt: {}, at })
                added++
              }
              deviceStore.put({ ...state, seededAt: at }, DEVICE_KEY)
            }
          }
        }
      }),
  )
}

export async function putDeviceState(state: DeviceState): Promise<void> {
  await run(STORE_DEVICE, 'readwrite', (s) => s.put(state, DEVICE_KEY))
}

/**
 * 가져오기(복구) 전용: days·meta·outbox를 통째로 바꾼다. 병합하지 않는다(설계 §10).
 * 기기의 정체성(deviceId·deviceKey·lastSyncAt)은 건드리지 않는다 — 백업 내용이 아니다.
 *
 * 네 스토어를 **한 트랜잭션**에 넣는다 — days만 바뀌고 meta가 남는(또는 반대) 반쪽
 * 상태를 만들지 않기 위해서다. put()은 복제 불가능한 값에 **동기로 던지는데**, 그 시점에
 * clear()는 이미 큐에 들어가 있다. 여기서 tx.abort()를 부르지 않으면 예외가 새는 동안
 * 트랜잭션이 "clear만 하고" 커밋해 기존 데이터가 조용히 사라진다.
 *
 * 아웃박스는 낡은 표식을 비우기만 한다 — 전체 교체 후에는 교체 전 상태를 가리키던
 * 표식이 무의미하다(push해도 이미 없는 값을 읽으려 든다).
 *
 * **그래서 device.seededAt도 같은 트랜잭션에서 비운다.** 표식을 전부 지우면서 "이미
 * 시딩했다"는 표시만 남겨 두면, 방금 들여온 기록에는 표식이 하나도 없는데 seedOutbox가
 * 다시 돌지도 않아 **영원히 못 올라가는 기록**이 된다. 로컬 교체는 성공하고 서버
 * replace_all이 실패한 경우가 정확히 그 상태다. 비워 두면 다음 push가 지금 DB에 있는
 * 것으로 아웃박스를 다시 채운다. 별도 쓰기로 빼지 않는 이유는 위 abort 함정과 같다 —
 * 트랜잭션이 갈라지면 "표식은 지웠는데 seededAt은 남은" 반쪽 상태가 실재하게 된다.
 */
export function replaceAll(days: Day[], meta: Meta): Promise<void> {
  return open().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction([STORE_DAYS, STORE_META, STORE_OUTBOX, STORE_DEVICE], 'readwrite')
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
          // 기기 상태는 통째로 갈아 끼우지 않고 seededAt만 되돌린다 — 정체성은 그대로 둔다.
          // 상태가 없으면(등록 전) 시딩된 적도 없으니 아무것도 하지 않는다.
          const deviceStore = tx.objectStore(STORE_DEVICE)
          const deviceReq = deviceStore.get(DEVICE_KEY)
          deviceReq.onsuccess = () => {
            const state = deviceReq.result as DeviceState | undefined
            if (state) deviceStore.put({ ...state, seededAt: null }, DEVICE_KEY)
          }
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
