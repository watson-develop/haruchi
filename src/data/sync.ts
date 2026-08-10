import { backupPayload, SCHEMA_VERSION, validateBackup, validateDay } from '../engine/backup'
import { foldOutbox } from '../engine/outbox'
import { EMPTY_STAMPS, hasGradesBundle, mergeDay, mergeMeta, sheetConflict } from '../engine/merge'
import type { BundleStamps, Stamped } from '../engine/merge'
import { nextCursor } from '../engine/pull-cursor'
import type { PulledRow } from '../engine/pull-cursor'
import type { Day, Meta } from './types'
import {
  applyPulledDay,
  applyPulledMeta,
  deleteOutboxThrough,
  getAllDays,
  getDay,
  getDeviceState,
  getMeta,
  getOutbox,
  getStamps,
  putDeviceState,
  replaceFromServer,
  seedOutbox,
} from './db'
import type { DeviceState } from './db'
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './sync-config'

/**
 * 요청 하나의 상한. 응답 없이 매달린 fetch는 실패보다 나쁘다 — 배너도 안 뜨고 화면도
 * 안 그려진 채 사람이 기다리게 된다(최종 리뷰 5: `#/report`가 첫 렌더를 여기 걸고 있었다).
 * 넉넉히 두되 반드시 끝나게 한다. 아이패드가 대기 상태에서 깨어나 잠깐 느린 경우가
 * 정상 범위이므로 3초 같은 값은 오히려 멀쩡한 동기화를 죽인다.
 */
const TIMEOUT_MS = 15_000

async function headers(): Promise<Record<string, string>> {
  const device = await getDeviceState()
  return {
    apikey: SUPABASE_ANON_KEY,
    'x-device-key': device.deviceKey ?? '',
    'Content-Type': 'application/json',
  }
}

/**
 * 이 파일의 유일한 네트워크 출구. 헤더를 붙이고 타임아웃을 건다 — fetch를 직접 부르는
 * 곳을 남기지 않아야 "어떤 요청은 영원히 안 끝난다"가 다시 생기지 않는다.
 */
async function req(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    return await fetch(url, {
      ...init,
      headers: { ...(await headers()), ...((init.headers as Record<string, string>) ?? {}) },
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 설정이 비어 있으면 어떤 요청도 내지 않는다. SUPABASE_URL이 ''이면 fetch 경로가
 * 상대 주소가 되어 배포 사이트 자신에게 요청이 날아간다 — 서버가 준비되기 전에
 * 배포돼도 이 브랜치가 오늘과 똑같이 동작한다는 보장이 여기서 나온다.
 * "설정됐다"의 정의는 여기 하나뿐이다 — syncEnabled도 이걸 그대로 쓴다.
 *
 * home-parent.ts도 부모 홈에 상태줄·등록 블록을 그릴지 판단할 때 이 함수를 그대로
 * 쓴다(export). 화면이 SUPABASE_URL만 따로 검사하면 URL은 채웠는데 ANON_KEY가 아직
 * 비어 있는 과도기에 화면은 "설정됨"으로, push는 "설정 안 됨"으로 갈라져 등록 블록이
 * 뜨는데 저장한 키가 조용히 no-op된다 — 정의가 하나여야 하는 이유가 바로 이 어긋남이다.
 */
export function configured(): boolean {
  return SUPABASE_URL !== '' && SUPABASE_ANON_KEY !== ''
}

export async function syncEnabled(): Promise<boolean> {
  if (!configured()) return false
  return (await getDeviceState()).deviceKey !== null
}

export type ServerStatus = 'ok' | 'offline' | 'unauthorized'

/**
 * 서버가 깨어 있는지, 그리고 이 기기의 키가 아직 통하는지 본다.
 *
 * **폐기된 키는 401로 오지 않는다.** RLS는 "행을 안 보여주는" 방식으로 막으므로 응답은
 * 200 + `[]`다(설계 §4의 전부-아니면-전무). 그런데 `meta` 행은 스키마가 시딩해 **항상
 * 정확히 한 줄** 존재한다 — 그래서 "200인데 빈 배열"은 키가 거부됐다는 뜻으로만 설명된다.
 * 이 구분이 없으면 키를 폐기당한 기기가 "서버는 온라인, push는 rev 충돌 3회"로만 보여
 * 아빠가 원인을 알 수 없다(최종 리뷰 7).
 */
export async function serverStatus(): Promise<ServerStatus> {
  if (!configured()) return 'offline' // 미설정은 "오프라인"이 정답이다 — 조회할 서버가 없다
  try {
    const res = await req(`${SUPABASE_URL}/rest/v1/meta?select=id`)
    if (res.status === 401 || res.status === 403) return 'unauthorized'
    if (!res.ok) return 'offline'
    const rows = (await res.json()) as unknown
    return Array.isArray(rows) && rows.length === 0 ? 'unauthorized' : 'ok'
  } catch {
    return 'offline'
  }
}

/** 파괴적 경로의 게이트("백업을 만들 수 있는가"). 인증 실패도 진행하면 안 되므로 ok만 참이다. */
export async function serverOnline(): Promise<boolean> {
  return (await serverStatus()) === 'ok'
}

/** 지금 도는 push 비행. 단일 비행 보장과 suspendSync의 대기 대상을 겸한다. */
let flight: Promise<void> | null = null
/** 지금 도는 pull 비행. push와 같은 이유로 하나만 돈다 — 트리거가 넷이라(설계 §2의 표)
 *  앱 시작·탭 복귀·화면 진입이 겹치면 같은 행을 서로 다른 순서로 적용하게 된다. */
let pullFlight: Promise<boolean> | null = null
let suspendCount = 0

/**
 * 파괴적 작업(초기화·가져오기·되돌리기·재기준화)이 도는 동안 **push와 pull 적용을 함께**
 * 멈춘다(설계 2단계 §3 「로컬 통째 교체 공통 규정」). **진행 중인 비행이 있으면 끝날
 * 때까지 기다린다** — 이미 나간 요청은 취소할 수 없으니 "지우기 전에 먼저 끝내게 두는
 * 것"이 유일하게 안전한 순서다.
 *
 * 막는 사고 둘:
 *
 * - pushDay가 지우기 직전의 Day를 읽어 둔 채 `serverReplaceAll`이 서버를 비운 뒤에
 *   POST하면, 로컬에 없는 날이 서버에 남는다(최종 리뷰 4).
 * - **push 정지만으로는 부족하다**(2단계 §3): clear와 `serverReplaceAll` 사이에 배경
 *   pull이 도착하면 방금 지운 날이 로컬에 되살아나고, 표식 없는 그 행들을 seedOutbox가
 *   다음 push에서 전량 재업로드한다.
 *
 * 표식은 하나도 잃지 않는다 — 멈춘 동안 push가 안 돌 뿐이고, resumeSync 뒤 다음
 * 기회에 그대로 올라간다. pull도 커서를 전진시키지 않은 채 멈추므로 다음 pull이 같은
 * 행부터 다시 받는다.
 */
export async function suspendSync(): Promise<void> {
  suspendCount++
  await flight
  await pullFlight
}

export function resumeSync(): void {
  suspendCount = Math.max(0, suspendCount - 1)
}

/**
 * 아웃박스를 비운다. 단일 비행 — 도는 중의 재요청은 no-op이 된다. 그 no-op된 요청이
 * 대표하던 새 표식은 사라지지 않지만(setter가 원래 표식을 남겼으므로), 이 비행이 그
 * 표식을 반영하지 못한 채 끝날 수 있다 — 그래서 한 패스가 **실패 없이** 끝나면 아웃박스가
 * 여전히 안 비었는지 한 번 더 확인해 한 패스만 더 돌린다(while이 아니다). 실패가 있었던
 * 패스 뒤에는 재확인하지 않는다 — 실패한 push를 곧바로 다시 돌리면 오프라인일 때 요청이
 * 폭주한다; 표식이 그대로 남는 것 자체가 실패를 표현하는 방식이다(§3 조용한 재시도).
 */
export function kickPush(): void {
  if (flight || suspendCount > 0) return
  const pass = (async () => {
    try {
      if (!(await pushOutbox())) return
      const remaining = await getOutbox()
      if (remaining.length > 0) await pushOutbox() // 재확인 — 최대 한 번만
    } catch {
      // 실패는 아웃박스에 남는 것으로 표현된다 — 여기서 알리지 않는다(§3 조용한 재시도)
    }
  })()
  flight = pass
  void pass.finally(() => {
    if (flight === pass) flight = null
    // 비행 종료 훅(설계 §3의 0). INSERT 직전 generation 재확인이 세운 플래그를 여기서
    // 소비한다 — 비행 **안에서** 시작하면 suspendSync의 비행 대기가 자기에게 걸려 교착한다.
    scheduleRebase()
  })
}

/**
 * 한 패스. 돌려주는 값은 "이 패스가 아무것도 남기지 않고 끝났나"다 — 실패한 target도,
 * 건너뛴(격리된) target도 없었을 때만 참이다. kickPush의 재확인 한 번이 이 값에 걸린다.
 *
 * **한 target의 실패가 다른 target을 막지 않는다.** 예전에는 첫 실패가 throw로 루프를
 * 끊었는데, 실패한 표식은 아웃박스 맨 앞 key에 그대로 남으므로 이후 모든 패스가 같은
 * 자리에서 다시 죽었다 — 「다시 만들기」 한 번이 그 뒤의 모든 날·모든 스프린트를 영원히
 * 못 올라가게 만들 수 있었다(최종 리뷰 1). 올릴 수 있는 것은 반드시 올라가야 한다.
 *
 * **건너뜀은 실패가 아니다.** push가 거짓을 돌려주는 것은 "이 target은 지금 올리면 안
 * 된다"(sheet 충돌 격리·서버가 더 새 스키마·검증 실패)라는 뜻이고, 그때는 표식을 지우지
 * 않는다 — 지우면 아빠가 격리를 풀었을 때 올릴 것이 사라진다. 실패와 달리 다음 패스가
 * 같은 자리에서 조용히 같은 판정을 다시 내린다.
 */
async function pushOutbox(): Promise<boolean> {
  if (!(await syncEnabled())) return false
  // 등록 전부터 있던 기록에 표식을 만든다(최종 리뷰 2). 멱등하고, 시딩이 끝난 기기에서는
  // device 스토어 한 번 읽는 비용이 전부다.
  await seedOutbox()
  const raw = await getOutbox()
  if (raw.length === 0) return true
  // push 시작 시점의 최대 key — 이후 생긴 표식은 지우지 않는다(설계 §3, Fable 리뷰 5)
  const maxKey = raw[raw.length - 1]!.key
  let allOk = true
  let pushedAny = false
  for (const entry of foldOutbox(raw)) {
    // 파괴적 작업이 시작됐다 — 남은 target은 표식을 남긴 채 다음 기회로 미룬다.
    if (suspendCount > 0) return false
    try {
      const pushed =
        entry.target === 'meta'
          ? await pushMeta()
          : await pushDay(entry.target.slice('day:'.length), entry.rewrite === true)
      if (!pushed) {
        allOk = false // 건너뜀 — 표식을 지우지 않는다
        continue
      }
      await deleteOutboxThrough(entry.target, maxKey)
      pushedAny = true
    } catch {
      // 조용히 넘어간다 — 표식이 남는 것이 실패 신호다(§3). 다음 target을 계속 시도한다.
      allOk = false
    }
  }
  // 서버에 한 번이라도 닿았을 때만 "마지막 동기화"를 갱신한다. 전부 실패한 패스에서
  // 갱신하면 상태줄이 "마지막 동기화: 오늘"이라고 거짓말을 한다 — 백업된 줄 알고
  // 방치하게 만드는, 이 설계가 최악이라고 부른 실패 모드다.
  if (pushedAny) {
    const device = await getDeviceState()
    await putDeviceState({ ...device, lastSyncAt: new Date().toISOString() })
  }
  return allOk
}

/** 오류 응답의 본문. 한 번만 읽을 수 있으므로 문자열로 받아 두고 여러 토큰을 검사한다. */
async function bodyText(res: Response): Promise<string> {
  try {
    return await res.text()
  } catch {
    return ''
  }
}

/**
 * 서버 시각 문자열을 로컬 스탬프와 **같은 표기**로 맞춘다. PostgREST는 timestamptz를
 * `2026-08-09T12:34:56.7+00:00`로 돌려주고 우리는 `new Date().toISOString()`(=`...Z`,
 * 밀리초 3자리)로 쓴다 — 같은 순간인데 코드포인트 비교가 갈린다(`+`(0x2B) < `0` < `Z`).
 * 병합의 LWW가 문자열 비교라 표기가 하나여야 한다: 서버에서 들어오는 입구에서 정규화한다.
 * 마이크로초는 밀리초로 잘린다 — 그 아래의 동률은 공통 규칙 2의 나머지 사슬이 받는다.
 */
function serverStamp(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const ms = Date.parse(v)
  return Number.isNaN(ms) ? null : new Date(ms).toISOString()
}

function stampBy(v: unknown): string {
  return typeof v === 'string' ? v : '' // null·부재는 ''(모름) — 옛 클라이언트가 쓴 행
}

/**
 * 빈 묶음은 "없음"이다 — `sprint: []`·`grades: {}`를 그대로 들이지 않는다.
 *
 * **영구 오염이 되는 경로가 실재한다.** 저장본이 없는 날에 `applyPulledDay`는 받은 값을
 * 그대로 심는데(합칠 상대가 없다), 그렇게 앉은 `sprint: []`는 이후 어떤 pull로도 사라지지
 * 않는다: `mergeSprint([], [])`가 `[]`를 돌려주고 `mergeDay`가 그것을 다시 붙이기 때문이다.
 * 그러면 "스프린트를 한 적 없는 날"과 "빈 세션이 실재하는 날"이 구분되지 않는다(존재
 * 우선인 공통 규칙 1이 값 자체로 판정하므로, 이 거짓 존재는 병합 결과까지 바꾼다).
 *
 * `validateDay`는 값을 **참조로** 돌려주므로 얕은 복사 위에서만 지운다.
 */
function withoutEmptyBundles(day: Day): Day {
  const out: Day = { ...day }
  if (out.sprint !== undefined && out.sprint.length === 0) delete out.sprint
  if (out.grades !== undefined && Object.keys(out.grades).length === 0) delete out.grades
  return out
}

/**
 * 서버 `days` 행 → `Stamped<Day>`. **이 변환은 여기 한 곳에만 있다**(설계 §1) — push의
 * 병합 입력도, pull의 적용 입력도 같은 함수를 지난다.
 *
 * payload는 백업 파일과 같은 등급으로 검증한다(설계 §2 「내려온 것을 믿지 않는다」).
 * 검증에 걸리면 null — 부르는 쪽은 그 행을 쓰지 않는다. `validateDay`는 값을 **참조로**
 * 돌려주므로 아무도 이 객체를 고치지 않는다.
 */
export function rowToStampedDay(row: unknown): Stamped<Day> | null {
  if (typeof row !== 'object' || row === null || Array.isArray(row)) return null
  const r = row as Record<string, unknown>
  const v = validateDay(r['payload'])
  if (!v.ok) return null
  return {
    // 스탬프는 **정확히 여섯 키**여야 한다. applyPulledDay가 `structuralEqual(merged.at,
    // 저장본 스탬프)`로 "바뀌었나"를 판정하는데, 여기서 키가 하나라도 더 실리면 그 비교가
    // 영원히 거짓이라 같은 행을 받을 때마다 쓰기와 재렌더가 일어난다.
    value: withoutEmptyBundles(v.day),
    at: {
      ...EMPTY_STAMPS,
      sheetAt: serverStamp(r['sheet_at']),
      sheetBy: stampBy(r['sheet_by']),
      gradesAt: serverStamp(r['grades_at']),
      gradesBy: stampBy(r['grades_by']),
      sprintAt: serverStamp(r['sprint_at']),
      sprintBy: stampBy(r['sprint_by']),
    },
  }
}

/** 서버 `meta` 행 → `Stamped<Meta>`. 스키마가 시딩한 빈 행(`payload = {}`)은 null이다 —
 *  settings가 없는 값을 mergeMeta에 넣으면 그 자리에서 죽는다. 깊은 검증은 pull의 몫이다. */
function rowToStampedMeta(row: unknown): Stamped<Meta> | null {
  if (typeof row !== 'object' || row === null || Array.isArray(row)) return null
  const payload = (row as Record<string, unknown>)['payload']
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null
  const settings = (payload as Record<string, unknown>)['settings']
  if (typeof settings !== 'object' || settings === null || Array.isArray(settings)) return null
  return {
    value: payload as Meta,
    at: {
      ...EMPTY_STAMPS,
      settingsAt: serverStamp((row as Record<string, unknown>)['settings_at']),
      settingsBy: stampBy((row as Record<string, unknown>)['settings_by']),
    },
  }
}

/**
 * 보내기 직전의 스탬프. 병합 출력의 스탬프를 그대로 쓰되(설계 §1 — 병합은 편집이 아니다),
 * **존재-승리로 이긴 묶음의 스탬프가 null이면 지금·이 기기로 채운다**(같은 절의 예외).
 * 최초 기입은 종합이 아니라 편집이다 — 채우지 않으면 "실재하는 묶음인데 아무도 주인이라고
 * 말하지 않는" 행이 서버에 앉고, 그 null은 이후 모든 LWW에서 진다.
 */
function sendStamps(v: Stamped<Day>, deviceId: string, now: string): BundleStamps {
  const at = { ...v.at }
  if (at.sheetAt === null && v.value.sheet.length > 0) {
    at.sheetAt = now
    at.sheetBy = deviceId
  }
  if (at.gradesAt === null && hasGradesBundle(v.value)) {
    at.gradesAt = now
    at.gradesBy = deviceId
  }
  if (at.sprintAt === null && (v.value.sprint?.length ?? 0) > 0) {
    at.sprintAt = now
    at.sprintBy = deviceId
  }
  return at
}

/** 행에 실을 스탬프 열. 값은 병합 출력이지 아웃박스 표식이 아니다 — 표식이 선언한 묶음이
 *  병합에서 질 수 있고, 그때 서버에 로컬이 채택하지 않은 시각을 남기면 안 된다. */
function stampColumns(at: BundleStamps): Record<string, string | null> {
  return {
    sheet_at: at.sheetAt,
    sheet_by: at.sheetBy,
    grades_at: at.gradesAt,
    grades_by: at.gradesBy,
    sprint_at: at.sprintAt,
    sprint_by: at.sprintBy,
  }
}

const DAY_SELECT =
  'payload,rev,schema_version,sheet_at,sheet_by,grades_at,grades_by,sprint_at,sprint_by'

/**
 * 재기준화 요구(설계 §3). INSERT 직전 generation 재확인이 어긋나면 여기 서고, pull
 * 엔진의 `runRebase`가 **비행이 끝난 뒤** 가져간다 — 관찰한 비행 안에서 시작하면
 * suspendSync의 비행 대기가 자기 자신에게 걸려 교착한다(§3의 0번).
 */
let rebaseNeeded = false

export function takeRebaseNeeded(): boolean {
  const v = rebaseNeeded
  rebaseNeeded = false
  return v
}

/**
 * 부모 홈이 읽는 알림 상태(설계 §2 「내려온 것을 믿지 않는다」·§3 재기준화 알림). 화면이
 * 그리는 것은 Task 12지만 **상태를 세우는 곳은 동기화 엔진 하나여야** push와 pull이 같은
 * 사실을 두 벌로 말하지 않는다.
 *
 * - `rejected` — 이 앱이 다루지 못한 서버 행의 키(날짜, 또는 `'meta'`). pull은 검증에
 *   걸린 행에서, push는 「서버가 더 새 스키마」·「행 검증 실패」에서 세운다. 그냥 건너뛰면
 *   아빠는 한 날짜만 영원히 안 맞는 것을 알 방법이 없다.
 * - `rebased` — 다른 기기의 파괴적 교체를 따라 이 기기를 맞췄다는 사실(§3의 마지막 줄).
 *
 * 기기 메모리에만 산다(새로고침하면 사라진다) — 사실 자체는 서버가 들고 있고, 다음 pull이
 * 같은 판정을 다시 내린다.
 */
export type SyncNotice = { rejected: string[]; rebased: boolean }

const rejected = new Set<string>()
let rebasedNotice = false

export function syncNotice(): SyncNotice {
  return { rejected: [...rejected].sort(), rebased: rebasedNotice }
}

/** 아빠가 재기준화 알림을 읽었다. `rejected`에는 짝이 없다 — 그쪽은 다음 pull이 스스로 푼다. */
export function dismissRebasedNotice(): void {
  rebasedNotice = false
}

function markRejected(key: string): void {
  rejected.add(key)
}

function clearRejected(key: string): void {
  rejected.delete(key)
}

/** 격리 목록에 날짜를 넣는다(설계 §2). 멱등 — 이미 있으면 아무것도 쓰지 않는다. */
export async function quarantineDate(date: string): Promise<void> {
  const device = await getDeviceState()
  if (device.quarantine.includes(date)) return
  await putDeviceState({ ...device, quarantine: [...device.quarantine, date] })
}

/** 격리 해제. 아빠가 배너에서 고르거나(2단계 §2), pull이 자연 해제를 관찰했을 때. */
export async function clearQuarantine(date: string): Promise<void> {
  const device = await getDeviceState()
  if (!device.quarantine.includes(date)) return
  await putDeviceState({ ...device, quarantine: device.quarantine.filter((d) => d !== date) })
}

/**
 * INSERT 직전의 generation 재확인(설계 §2 「push 충돌 경로」). "조회 0행"은 "아직 없는
 * 날"일 수도 있지만 "다른 기기가 방금 통째로 지운 날"일 수도 있다 — 후자에 INSERT하면
 * 지운 기록이 되살아난다.
 *
 * 처음 관찰(로컬 generation이 null)은 재기준화 없이 서버 값을 채택한다(§3 초기값 —
 * 첫 관찰을 "증가"로 오인해 통째 교체하는 쪽이 더 큰 사고다).
 */
async function generationMatches(device: DeviceState): Promise<boolean> {
  const res = await req(`${SUPABASE_URL}/rest/v1/meta?id=eq.1&select=generation`)
  if (!res.ok) throw new Error(`meta 조회 실패: ${res.status}`)
  const rows = (await res.json()) as { generation?: unknown }[]
  const server = rows[0]?.generation
  if (typeof server !== 'number') return true // 스키마 미적용 — 판정할 근거가 없다
  if (device.generation === null) {
    await putDeviceState({ ...(await getDeviceState()), generation: server })
    return true
  }
  return device.generation === server
}

/**
 * 하루치 push. **보내는 것은 언제나 병합 결과다**(설계 §2) — 서버 행 전체를 읽어
 * `mergeDay`한 뒤 그 출력을 쓴다. 통째 PATCH는 다른 기기가 그사이 쓴 것을 지운다.
 *
 * 돌려주는 값은 "표식을 지워도 되나"다. 거짓이면 **올리지 않았고 표식은 남는다** —
 * 격리·서버 상위 스키마·행 검증 실패가 그 경우다. 실패는 throw로 구분된다.
 *
 * rev 프로토콜(설계 §3): INSERT rev=1, PATCH는 `?rev=eq.N` + `rev=N+1`. upsert 금지. 3회.
 */
async function pushDay(date: string, rewrite: boolean): Promise<boolean> {
  const day = await getDay(date)
  if (!day) return true // 표식만 남고 Day가 지워진 경우(초기화 직후) — 보낼 것이 없다
  const device = await getDeviceState()
  // 격리된 날짜는 올리지 않는다. rewrite 의도 표식만 이 금지를 면제한다 — 그 면제가
  // 「이 기기 종이 유지」로 격리를 빠져나가는 유일한 통로다(설계 §2 「격리 탈출」).
  if (!rewrite && device.quarantine.includes(date)) return false
  const local: Stamped<Day> = { value: day, at: (await getStamps(date)) ?? EMPTY_STAMPS }

  for (let attempt = 0; attempt < 3; attempt++) {
    const now = new Date().toISOString()
    const cur = await req(`${SUPABASE_URL}/rest/v1/days?date=eq.${date}&select=${DAY_SELECT}`)
    if (!cur.ok) throw new Error(`days 조회 실패: ${cur.status}`)
    const rows = (await cur.json()) as Record<string, unknown>[]

    if (rows.length === 0) {
      if (!(await generationMatches(device))) {
        rebaseNeeded = true
        return false
      }
      // 상대가 없으니 병합할 것도 없다 — 로컬 값과 로컬 스탬프를 그대로 심는다.
      const res = await req(`${SUPABASE_URL}/rest/v1/days`, {
        method: 'POST',
        body: JSON.stringify({
          date,
          payload: local.value,
          rev: 1,
          schema_version: SCHEMA_VERSION,
          device: device.deviceId,
          ...stampColumns(sendStamps(local, device.deviceId, now)),
        }),
      })
      if (res.ok) return true
      if (res.status !== 409) throw new Error(`days 생성 실패: ${res.status}`)
      continue // PK 충돌 — 다른 기기가 먼저 만듦. 재조회해 PATCH 경로로
    }

    const row = rows[0]!
    const rev = row['rev']
    // rev가 숫자가 아니면 rev+1이 NaN이 되어 `rev=eq.NaN`이라는 뜻 없는 요청이 나간다.
    if (typeof rev !== 'number') throw new Error(`days 행에 rev가 없다: ${date}`)
    // 클라이언트 가드: 서버 행이 우리보다 새 스키마면 손대지 않는다. (진짜 가드는
    // 서버의 days_guard_version이다 — 옛 클라이언트에는 이 코드가 실리지 않으므로.)
    if (typeof row['schema_version'] === 'number' && row['schema_version'] > SCHEMA_VERSION) {
      // 조용히 넘어가지 않는다 — 이 날짜는 이 기기에서 영원히 안 올라가는 상태이므로
      // 부모 홈이 그 사실을 말해야 한다(pull의 거부 행과 같은 상태를 쓴다).
      markRejected(date)
      return false
    }
    const server = rowToStampedDay(row)
    // 검증에 걸린 행은 병합 입력이 될 수 없다. 표식을 남겨 두면 서버 쪽이 고쳐지는 즉시
    // 다음 패스가 올린다.
    if (!server || server.value.date !== date) {
      markRejected(date)
      return false
    }

    // **RPC로 가는 조건은 플래그가 아니라 「플래그 + 실제 sheet 충돌」이다.** rewrite_sheet는
    // "비어 있지 않은 서버 sheet를 다른 값으로 바꾼다"는, 트리거가 막는 일 하나를 인가받아
    // 하는 통로다 — 서버 sheet가 이미 우리 것과 같거나 비어 있으면 바꿀 것이 없고, 평범한
    // PATCH가 트리거에 걸리지도 않는다(그쪽 조건이 "옛 sheet가 비어 있지 않고 새 sheet와
    // 다르다"이므로 세 경우 모두 거짓이다). 오히려 **평범한 PATCH만이** 아직 못 올린 묶음
    // 스탬프를 올릴 수 있다 — RPC는 sheet 스탬프만 찍기 때문이다.
    //
    // 이 게이트가 없으면 자기 자신 때문에 격리된다: RPC가 성공한 뒤 스탬프 PATCH가
    // 실패하거나 0행이면 서버 payload에는 **방금 우리가 올린 채점**이 있고, 아래 사전
    // 확인이 그것을 "다른 기기가 채점했다"로 읽는다. 그러면 표식은 rewrite를 단 채 남고
    // grades_at은 영원히 null인 — 1차 수정이 닫은 것과 같은 종류의 — 손실이 된다.
    if (rewrite && sheetConflict(local.value, server.value)) {
      // 「다시 만들기」의 인가된 경로. 채점이 있는 날은 서버가 거부하므로 먼저 물어본다 —
      // 조건은 서버 함수(rewrite_sheet)의 것과 같은 "grades 객체가 비어 있지 않다"다.
      if (Object.keys(server.value.grades ?? {}).length > 0) {
        await quarantineDate(date)
        return false
      }
      // 송신 payload는 병합 출력에 sheet만 로컬로 강제한 것이다(설계 §2) — "sprint만
      // 얹는" 조립은 서버의 kind·모르는 필드를 통째 교체로 되돌린다. 로컬에는 쓰지 않는다.
      const rewritten = mergeDay(local, server)
      const payload = { ...rewritten.value, sheet: local.value.sheet }
      const sheetAt = local.at.sheetAt ?? now
      const res = await req(`${SUPABASE_URL}/rest/v1/rpc/rewrite_sheet`, {
        method: 'POST',
        body: JSON.stringify({
          p_date: date,
          p_payload: payload,
          p_rev: rev + 1,
          // 인자를 **생략하면** 서버 default(now())가 서고, 명시적 null을 보내면 열이
          // null로 덮인다. 어느 쪽도 안 된다 — 시계는 쓴 기기의 것이어야 한다(설계 §1).
          p_sheet_at: sheetAt,
          p_sheet_by: local.at.sheetAt === null ? device.deviceId : local.at.sheetBy,
          p_schema_version: SCHEMA_VERSION,
        }),
      })
      if (res.ok) {
        // **RPC는 sheet 스탬프만 찍는다**(schema.sql의 rewrite_sheet는 payload·rev·
        // sheet_at·sheet_by·schema_version만 건드린다). 그런데 지금 올라간 payload에는
        // 같은 표식에 접혀 온 채점·스프린트가 함께 실려 있을 수 있다 — foldOutbox가
        // rewrite를 OR로 합치므로 「다시 만들기」 뒤에 채점한 날이 한 표식이 된다.
        // 그 묶음의 *_at을 따로 올리지 않으면 값만 서버에 앉고 시각은 null·옛것으로
        // 남아, 더 낡은 채점을 든 세 번째 기기가 모든 LWW를 이겨 방금 한 채점을 덮는다.
        // payload를 건드리지 않으므로 sheet 불변 트리거에는 걸리지 않는다.
        const at = sendStamps(rewritten, device.deviceId, now)
        const rest: Record<string, string> = {}
        // null은 싣지 않는다 — "그 묶음이 없다"는 뜻이고, 보내면 서버의 실재하는 스탬프를
        // null로 덮는다. sendStamps를 지난 뒤의 null은 존재하지 않는 묶음뿐이다.
        if (at.gradesAt !== null) {
          rest['grades_at'] = at.gradesAt
          rest['grades_by'] = at.gradesBy
        }
        if (at.sprintAt !== null) {
          rest['sprint_at'] = at.sprintAt
          rest['sprint_by'] = at.sprintBy
        }
        if (Object.keys(rest).length > 0) {
          const after = await req(
            `${SUPABASE_URL}/rest/v1/days?date=eq.${date}&rev=eq.${rev + 1}`,
            {
              method: 'PATCH',
              headers: { Prefer: 'return=representation' },
              body: JSON.stringify({ rev: rev + 2, device: device.deviceId, ...rest }),
            },
          )
          if (!after.ok) throw new Error(`days 타임스탬프 갱신 실패: ${after.status}`)
          // 0행이면 그사이 다른 기기가 rev를 옮겼다 — 다시 읽어 병합부터. sheet는 이미
          // 우리 것으로 올라갔으므로 다음 바퀴의 RPC는 같은 값을 다시 쓰고 지나간다.
          if (((await after.json()) as unknown[]).length === 0) continue
        }
        // 「이 기기 종이 유지」의 ③ — 성공한 탈출은 격리를 푼다(설계 §2 「격리 탈출」).
        // 여기서 안 풀면 배너가 이미 없는 충돌을 계속 띄우고, 그 날짜의 평범한 push는
        // 격리 게이트에서 영원히 되돌아간다(이 반환값은 pushOutbox 밖으로 나가지 않아
        // 화면이 성공을 알 방법이 없다).
        await clearQuarantine(date)
        return true
      }
      const body = await bodyText(res)
      // 거부와 rev 충돌은 **본문으로** 구분한다(일괄 !res.ok 금지). 채점이 있는 날로
      // 판명되면 격리로 보낸다 — 아빠에게 물어야 하는 상황이지 재시도할 상황이 아니다
      // (설계 §2 「격리 탈출」). 이 거부는 위 사전 확인과 RPC 사이에 다른 기기의 채점이
      // 도착한 경우에만 난다; 다음 패스부터는 사전 확인이 RPC 전에 같은 판정을 내린다.
      //
      // 설계는 여기서 **rewrite 플래그까지 소거**하라고 한다. 지금 그 수단이 없다 —
      // 아웃박스 표식을 고치는 db 함수가 없고(표식을 통째로 지우면 같은 표식에 실려 온
      // 채점·스프린트가 영영 안 올라간다), 그래서 남는 비용은 격리가 풀릴 때까지 패스마다
      // GET 한 번이다(RPC 재시도는 사전 확인이 막는다). **격리를 해소하는 쪽(Task 12)이
      // 그 날짜의 rewrite 플래그를 반드시 제거해야 한다** — 안 그러면 「채택」 직후 다음
      // push가 같은 판정으로 그 날짜를 도로 격리한다.
      if (body.includes('sheet_rewrite_graded')) {
        await quarantineDate(date)
        return false
      }
      if (body.includes('rev_conflict')) continue
      throw new Error(`sheet 다시 만들기 실패: ${res.status}`)
    }

    // sheet 충돌은 병합하지 않는다 — 종이는 이미 물리적으로 둘이고, 어느 것에 아이가
    // 풀었는지는 아빠만 안다(설계 §2). 판정은 구조적 동치의 부정이다(jsonb 키 순서 무시).
    // rewrite 표식이 있으면 위에서 이미 RPC로 갔으므로, 여기 닿는 것은 면제 대상이 아니다.
    if (sheetConflict(local.value, server.value)) {
      await quarantineDate(date)
      return false
    }

    const merged = mergeDay(local, server)
    const res = await req(`${SUPABASE_URL}/rest/v1/days?date=eq.${date}&rev=eq.${rev}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        payload: merged.value,
        rev: rev + 1,
        schema_version: SCHEMA_VERSION,
        device: device.deviceId,
        ...stampColumns(sendStamps(merged, device.deviceId, now)),
      }),
    })
    if (!res.ok) {
      // 트리거가 sheet 불변으로 거부했다 = 서버에 다른 sheet가 있다. **여기서 「다시
      // 만들기」를 추론하지 않는다** — 부모의 의도는 표식의 rewrite 플래그로만 온다.
      // 추론이 하던 일은 격리가 대신한다(설계 §2).
      if ((await bodyText(res)).includes('sheet_immutable')) {
        await quarantineDate(date)
        return false
      }
      throw new Error(`days 갱신 실패: ${res.status}`)
    }
    const updated = (await res.json()) as unknown[]
    if (updated.length > 0) {
      // rewrite 의도로 들어왔는데 충돌이 없어 평범한 경로로 끝났다면, 그 의도는 이미
      // 이뤄져 있다(서버 sheet가 우리 것). 격리를 남기면 그 날짜의 다음 push가 맨 위
      // 격리 게이트에서 영원히 되돌아간다 — RPC 성공 경로에서 격리를 푸는 것과 같은
      // 이유다. 격리된 날짜가 rewrite 없이 여기 닿는 경로는 없으므로(맨 위 게이트가
      // 먼저 돌려보낸다) 이 조건이 도달 가능한 전부다.
      if (rewrite) await clearQuarantine(date)
      return true
    }
    // 0행이면 rev 충돌 — 다시 읽어 병합부터
  }
  throw new Error(`rev 충돌 3회: ${date}`)
}

/**
 * meta push. days와 같은 규칙(서버를 읽어 `mergeMeta` 후 그 출력을 PATCH)이되 두 가지가
 * 다르다.
 *
 * - **`lastExportedAt`은 서버에 있던 값을 되돌려 붙인다.** 이 필드는 기기 로컬 값으로
 *   강등됐고(설계 §1), 접붙임은 `mergeMeta` 밖의 **방향별 후처리**다 — pull은 로컬 값을,
 *   push는 서버 값을 붙인다. 병합 함수 안에서 처리하면 순수성이 깨지고, 접붙임이 없으면
 *   서버에 남는 값이 인자 순서에 따라 달라진다(그 필드에 대해 병합은 교환법칙이 없다).
 *   필드를 지우지 않는 이유는 우리 pull의 검증이다 — `validateBackup`이 부재를 거부한다.
 * - **`settings_at`이 전진하지 않으면 서버 트리거가 거부한다**(meta_guard_stamp).
 *   존재-승리로 이겼는데 스탬프가 null이면 지금·이 기기로 찍는다(설계 §1 예외) — 이
 *   예외가 없으면 빈 서버에 처음 올리는 push가 영구히 거부된다.
 */
async function pushMeta(): Promise<boolean> {
  const local: Stamped<Meta> = {
    value: await getMeta(),
    at: (await getStamps('meta')) ?? EMPTY_STAMPS,
  }
  const device = await getDeviceState()
  for (let attempt = 0; attempt < 3; attempt++) {
    const now = new Date().toISOString()
    const cur = await req(
      `${SUPABASE_URL}/rest/v1/meta?id=eq.1&select=payload,rev,settings_at,settings_by`,
    )
    if (!cur.ok) throw new Error(`meta 조회 실패: ${cur.status}`)
    const rows = (await cur.json()) as Record<string, unknown>[]
    const row = rows[0]
    const rev = typeof row?.['rev'] === 'number' ? (row['rev'] as number) : 0 // 행은 스키마가 시딩한다
    const server = rowToStampedMeta(row)
    const merged = server ? mergeMeta(local, server) : local
    const payload: Meta = {
      ...merged.value,
      settings: {
        ...merged.value.settings,
        lastExportedAt: server?.value.settings?.lastExportedAt ?? null,
      },
    }
    const settingsAt = merged.at.settingsAt ?? null
    const res = await req(`${SUPABASE_URL}/rest/v1/meta?id=eq.1&rev=eq.${rev}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        payload,
        rev: rev + 1,
        device: device.deviceId,
        settings_at: settingsAt ?? now,
        settings_by: settingsAt === null ? device.deviceId : (merged.at.settingsBy ?? ''),
      }),
    })
    if (!res.ok) throw new Error(`meta 갱신 실패: ${res.status}`)
    if (((await res.json()) as unknown[]).length > 0) return true
  }
  throw new Error('meta rev 충돌 3회')
}

/**
 * 겹쳐 받기(설계 §2 「커서」). Postgres의 `now()`는 **트랜잭션 시작 시각**이라, 커밋이 늦은
 * 행은 자기보다 나중에 시작한 트랜잭션의 행보다 작은 `updated_at`을 달고 커서 뒤에 숨는다.
 * 5분을 겹쳐 받아 그 창을 덮는다 — 재수신은 병합이 멱등이라 무해하고, `applyPulledDay`가
 * 바뀐 것이 없으면 거짓을 돌려주므로 화면도 다시 그리지 않는다.
 */
export const PULL_OVERLAP_MS = 5 * 60 * 1000

/** 한 요청에 받을 행 수. 서버 설정에 기대지 않고 우리가 정한다 — 응답이 잘렸는지를
 *  "받은 행 수 == 이 값"으로 판정할 수 있어야 페이지를 이어 받을지 알 수 있다. */
const PULL_PAGE = 500
/** 한 pull이 이어 받는 페이지 상한. 무한 루프 방지용 — 넘으면 다음 pull이 이어서 받는다. */
const PULL_MAX_PAGES = 40

const PULL_DAY_SELECT = `date,updated_at,${DAY_SELECT}`

/**
 * 커서에서 실제 질의 하한을 만든다. 커서가 망가졌으면(파싱 불가) 필터를 걸지 않는다 —
 * 전량을 다시 받는 편이 "아무것도 못 받는 상태"보다 낫고, 적용은 멱등이다.
 */
function overlapSince(cursor: string | null): string | null {
  if (cursor === null) return null
  const ms = Date.parse(cursor)
  if (Number.isNaN(ms)) return null
  return new Date(ms - PULL_OVERLAP_MS).toISOString()
}

async function getDayPage(
  since: string | null,
  offset: number,
): Promise<Record<string, unknown>[]> {
  const filter = since === null ? '' : `updated_at=gt.${encodeURIComponent(since)}&`
  // 정렬 둘째 키가 `date`인 이유: `replace_all`은 모든 행을 한 트랜잭션에서 쓰므로
  // `updated_at`이 전부 같다. 그때 `updated_at` 하나로는 순서가 정해지지 않아 offset
  // 페이징이 행을 건너뛰거나 두 번 줄 수 있다. `date`는 PK라 전순서를 완성한다.
  const res = await req(
    `${SUPABASE_URL}/rest/v1/days?${filter}select=${PULL_DAY_SELECT}` +
      `&order=updated_at.asc,date.asc&limit=${PULL_PAGE}&offset=${offset}`,
  )
  if (!res.ok) throw new Error(`days pull 실패: ${res.status}`)
  return (await res.json()) as Record<string, unknown>[]
}

/** 이 행을 어떻게 처리했나. `rejected`만 커서를 멈춘다(설계 §2 — 지나치면 영영 재수신 불가). */
type RowOutcome = 'rejected' | 'changed' | 'unchanged'

/**
 * 서버 행 하나의 적용. **격리 판정이 `applyPulledDay` 앞에 있다**(설계 §2).
 *
 * 왜 여기인가: `applyPulledDay`는 트랜잭션에 `days`·`stamps`만 넣는다 — 아웃박스 표식을
 * 실수로도 못 남기게 하는 구조적 보장이다. 격리 목록은 `device` 스토어에 있어서 그 함수가
 * 물어보려면 스토어를 하나 더 열어야 하고, 그러면 그 보장이 깨진다. 판정은 pull 루프의 일이다.
 *
 * **격리가 막는 것은 적용이지 판정이 아니다**(설계 §2, 4라운드). 격리된 날짜의 행도 계속
 * 받아 매번 다시 판정하므로, 상대 기기가 해소해 서버가 한 sheet로 수렴하면 조건이 사라져
 * 자연 해제된다. 행을 통째로 건너뛰는 구현은 그 자연 해제를 없앤다.
 */
async function applyRow(
  row: Record<string, unknown>,
  quarantined: ReadonlySet<string>,
): Promise<RowOutcome> {
  const key = typeof row['date'] === 'string' ? row['date'] : '알 수 없는 날짜'
  const incoming = rowToStampedDay(row)
  // payload의 날짜와 행의 키가 어긋난 행은 어느 날에 심을지 판정할 수 없다 — push가
  // 같은 조건으로 올리기를 거부하는 것과 짝이다.
  if (!incoming || incoming.value.date !== key) {
    markRejected(key)
    return 'rejected'
  }
  const date = incoming.value.date
  // 서버가 우리보다 새 스키마로 쓴 행은 **적용은 하되**(검증을 통과했고 mergeDay가 모르는
  // 필드를 보존한다) 경고는 세운다 — 그 날짜의 로컬 변경은 push가 거부해 못 올라간다.
  // 커서를 멈추지는 않는다: 앱을 새로 배포하기 전까지 그 뒤의 모든 날이 함께 멈춘다.
  const version = row['schema_version']
  if (typeof version === 'number' && version > SCHEMA_VERSION) markRejected(date)
  else clearRejected(date)

  const local = await getDay(date)
  if (local && sheetConflict(local, incoming.value)) {
    await quarantineDate(date)
    return 'unchanged' // 적용만 생략한다 — 커서는 전진한다(거부가 아니다)
  }
  // 충돌이 사라졌으면 자연 해제. 목록은 pull 시작 시점의 사본이다 — 이 루프가 넣은
  // 날짜는 위에서 이미 돌아갔고, 아빠가 배너로 푼 날짜라면 풀 것이 없다.
  if (quarantined.has(date)) await clearQuarantine(date)
  return (await applyPulledDay(incoming)) ? 'changed' : 'unchanged'
}

/** 커서는 **서버 응답의 `updated_at`으로만** 전진한다. 쓰기 직전에 기기 상태를 다시 읽는다 —
 *  같은 레코드를 격리 판정·lastSyncAt도 갱신하므로 오래된 사본으로 덮으면 그것들이 사라진다. */
async function saveCursor(cursor: string | null): Promise<void> {
  const device = await getDeviceState()
  if (device.lastPulledAt === cursor) return
  await putDeviceState({ ...device, lastPulledAt: cursor })
}

async function pullDays(): Promise<boolean> {
  const device = await getDeviceState()
  let cursor = device.lastPulledAt
  const quarantined = new Set(device.quarantine)
  const since = overlapSince(cursor)
  let changed = false
  let offset = 0
  for (let page = 0; page < PULL_MAX_PAGES; page++) {
    const rows = await getDayPage(since, offset)
    // **적용을 실제로 시도한 행만** 커서 계산에 넣는다 — 중간에 멈췄으면 그 뒤 행은
    // 목록에 없어야 커서가 그것들을 건너뛰지 않는다.
    const seen: PulledRow[] = []
    let stopped = false
    for (const row of rows) {
      // 파괴적 작업이 비행 중에 시작됐다(가져오기·초기화·재기준화). 남은 행은 적용하지
      // 않고 커서도 그 자리에 둔다 — 다음 pull이 같은 행부터 다시 받는다.
      if (suspendCount > 0) {
        stopped = true
        break
      }
      const updatedAt = serverStamp(row['updated_at'])
      if (updatedAt === null) {
        // 커서를 세울 근거가 없는 행은 지나칠 수 없다(지나치면 그 뒤 행들의 재수신 근거도 잃는다).
        markRejected(typeof row['date'] === 'string' ? row['date'] : '알 수 없는 날짜')
        stopped = true
        break
      }
      const outcome = await applyRow(row, quarantined)
      seen.push({ updatedAt, rejected: outcome === 'rejected' })
      if (outcome === 'rejected') {
        stopped = true
        break
      }
      if (outcome === 'changed') changed = true
    }
    cursor = nextCursor(cursor, seen)
    await saveCursor(cursor)
    if (stopped || rows.length < PULL_PAGE) break
    offset += rows.length
  }
  return changed
}

/**
 * meta pull. 두 가지를 함께 한다 — **generation 관찰**(설계 §3)과 settings 적용.
 *
 * generation이 어긋나면 `'rebase'`를 돌려주고 이 패스의 나머지(days 적용)를 하지 않는다:
 * 어차피 재기준화가 로컬 전체를 서버 상태로 갈아 끼우므로, 그 전에 행을 적용하는 것은
 * 곧 버려질 쓰기이고 그 사이 화면이 두 번 깜빡인다.
 */
async function pullMeta(): Promise<boolean | 'rebase'> {
  const res = await req(
    `${SUPABASE_URL}/rest/v1/meta?id=eq.1&select=payload,generation,settings_at,settings_by`,
  )
  if (!res.ok) throw new Error(`meta pull 실패: ${res.status}`)
  const row = ((await res.json()) as Record<string, unknown>[])[0]
  // 폐기된 키의 RLS 응답도 200 + 빈 배열이다 — 그 판정은 serverStatus의 몫이고,
  // 여기서는 "받을 것이 없었다"로 조용히 끝낸다.
  if (!row) return false

  const device = await getDeviceState()
  const server = row['generation']
  if (typeof server === 'number' && device.generation !== server) {
    // 처음 관찰(로컬이 null)은 재기준화 없이 채택한다(설계 §3 「초기값」) — 1단계 기기가
    // 하나라 서버 상태가 곧 그 기기 상태였고, 첫 관찰을 "증가"로 오인해 통째 교체하는
    // 쪽이 훨씬 큰 사고다.
    if (device.generation === null) {
      await putDeviceState({ ...(await getDeviceState()), generation: server })
    } else {
      rebaseNeeded = true
      return 'rebase'
    }
  }

  const stamped = rowToStampedMeta(row)
  // meta payload도 백업 파일과 같은 등급으로 검증한다(설계 §2, 5라운드) — 기형 settings가
  // 앉으면 스프린트 판정이 전 기기에서 오염된다. 모양의 주인은 backupPayload 하나이므로
  // 그 모양으로 감싸 validateBackup에 그대로 넣는다(검증 사본을 만들지 않는다).
  if (!stamped || !validateBackup(backupPayload([], stamped.value, new Date().toISOString())).ok) {
    markRejected('meta')
    return false
  }
  clearRejected('meta')
  return await applyPulledMeta(stamped)
}

/**
 * 한 번의 pull. 돌려주는 값은 **로컬이 하나라도 바뀌었나**다 — 화면을 다시 그릴지를 이
 * 값으로 정한다(설계 §2 「배경 pull 후 화면 갱신」).
 *
 * 단일 비행이다. 트리거가 넷(앱 시작·부모 화면 진입·아이 화면 진입·탭 복귀)이라 겹치는
 * 것이 정상이고, 겹친 호출은 **도는 비행을 그대로 기다린다**.
 *
 * 실패는 조용하다(§3) — 커서가 전진하지 않는 것 자체가 재시도 신호다. 그래서 이 함수는
 * 거부하지 않는다: 배경 호출(`void pullOnce()`)이 처리되지 않은 거부를 만들면 안 된다.
 */
export function pullOnce(): Promise<boolean> {
  if (pullFlight) return pullFlight
  const pass = (async () => {
    try {
      return await pullPass()
    } catch {
      return false
    }
  })()
  pullFlight = pass
  void pass.finally(() => {
    if (pullFlight === pass) pullFlight = null
    // 비행 종료 훅 — 관찰한 비행 안에서 재기준화를 시작하면 교착한다(설계 §3의 0).
    scheduleRebase()
  })
  return pass
}

async function pullPass(): Promise<boolean> {
  // 미설정·미등록이면 네트워크를 만지지 않는다. syncEnabled가 configured를 포함한다.
  if (!(await syncEnabled())) return false
  // 파괴적 작업이 도는 중에는 적용하지 않는다(설계 §3 공통 규정).
  if (suspendCount > 0) return false
  const meta = await pullMeta()
  if (meta === 'rebase') return false
  if (suspendCount > 0) return meta
  return (await pullDays()) || meta
}

/**
 * 서버 전체 상태(재기준화 입력). 재기준화는 병합이 아니라 **교체**라 여기서 못 읽은 것은
 * 로컬에서도 사라진다 — 그래서 meta를 못 읽거나 검증에 걸리면 아무것도 하지 않고 null이다
 * (연기가 반쪽 교체보다 낫다).
 */
async function fetchServerState(): Promise<{
  days: Stamped<Day>[]
  meta: Stamped<Meta>
  generation: number
  cursor: string | null
} | null> {
  const res = await req(
    `${SUPABASE_URL}/rest/v1/meta?id=eq.1&select=payload,generation,settings_at,settings_by`,
  )
  if (!res.ok) throw new Error(`meta 조회 실패: ${res.status}`)
  const row = ((await res.json()) as Record<string, unknown>[])[0]
  if (!row) return null
  const generation = row['generation']
  const meta = rowToStampedMeta(row)
  if (typeof generation !== 'number' || !meta) return null
  if (!validateBackup(backupPayload([], meta.value, new Date().toISOString())).ok) {
    markRejected('meta')
    return null
  }
  clearRejected('meta')

  const days: Stamped<Day>[] = []
  const seen: PulledRow[] = []
  for (let page = 0; page < PULL_MAX_PAGES; page++) {
    const rows = await getDayPage(null, page * PULL_PAGE)
    for (const r of rows) {
      const updatedAt = serverStamp(r['updated_at'])
      const stamped = rowToStampedDay(r)
      const key = typeof r['date'] === 'string' ? r['date'] : '알 수 없는 날짜'
      if (!stamped || stamped.value.date !== key) {
        markRejected(key)
        // 커서만 여기서 멈춘다(nextCursor). 나머지 행은 계속 모은다 — 교체본에서 빠지는
        // 것은 이 행 하나뿐이고, 커서가 뒤에 남으므로 다음 pull이 다시 받아 재판정한다.
        seen.push({ updatedAt: updatedAt ?? '', rejected: true })
        continue
      }
      clearRejected(key)
      days.push(stamped)
      if (updatedAt !== null) seen.push({ updatedAt, rejected: false })
    }
    if (rows.length < PULL_PAGE) break
  }
  return { days, meta, generation, cursor: nextCursor(null, seen) }
}

/** 아웃박스의 마지막 key. "스냅샷 이후 로컬이 바뀌었나"의 신호다(설계 §3의 3). */
async function outboxMaxKey(): Promise<number> {
  const raw = await getOutbox()
  return raw.length === 0 ? 0 : raw[raw.length - 1]!.key
}

/** 재기준화가 도는 중인가. 재진입은 스냅샷을 두 번 찍고 교체를 두 번 하는 일이라 막는다. */
let rebasing = false

/**
 * 재기준화(설계 §3). 다른 기기가 파괴적 교체를 해서 `generation`이 달라진 것을 관찰했을 때,
 * 로컬 전체를 서버 상태로 맞춘다.
 *
 * 순서에 이유가 있다:
 *
 * 1. `suspendSync` — push도 pull 적용도 멈춘다. 진행 중인 비행은 기다린다
 * 2. **먼저 스냅샷**. 재기준화는 오프라인 신규 기록을 자동으로 살리지 않는다(감수 목록) —
 *    이 스냅샷이 그것들의 유일한 복구 경로다. 실패하면 교체하지 않는다(throw로 빠진다)
 * 3. 스냅샷 이후 로컬 변경(= 아웃박스 새 key)이 있으면 다시 찍는다. suspendSync는 로컬
 *    쓰기를 막지 않으므로 아이가 그 사이 스프린트를 끝낼 수 있다. 최대 2회 재스냅샷,
 *    넘으면 중단하고 연기한다
 * 4. 서버 전체를 받아 `replaceFromServer` — days·meta·stamps·아웃박스·격리 목록·커서가
 *    한 트랜잭션에서 서버 상태가 된다
 *
 * 실패는 플래그를 다시 세워 다음 비행 종료 훅으로 넘긴다 — 반쪽 상태를 만드는 것보다
 * 늦는 편이 낫다.
 */
export async function runRebase(): Promise<void> {
  if (rebasing) return
  if (!(await syncEnabled())) return
  rebasing = true
  await suspendSync()
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const before = await outboxMaxKey()
      await serverSnapshot('rebase', { days: await getAllDays(), meta: await getMeta() })
      if ((await outboxMaxKey()) !== before) continue // 그 사이 로컬이 바뀌었다 — 다시 찍는다
      const state = await fetchServerState()
      if (!state) {
        rebaseNeeded = true
        return
      }
      await replaceFromServer(state.days, state.meta, state.generation, state.cursor)
      // 이 교체가 방금 관찰들을 전부 흡수했다 — 대기 중인 플래그는 여기서 버린다.
      takeRebaseNeeded()
      rebasedNotice = true
      return
    }
    rebaseNeeded = true // 재스냅샷 2회를 넘겼다 — 중단·연기(설계 §3의 3)
  } catch {
    rebaseNeeded = true // 조용한 재시도. 다음 비행 종료 훅이 다시 집는다
  } finally {
    resumeSync()
    rebasing = false
  }
}

/**
 * 비행이 끝난 자리에서 재기준화를 예약한다. `setTimeout(0)`인 이유는 `suspendSync`가
 * 비행을 기다리기 때문이다 — 비행의 `finally` 안에서 곧바로 부르면 그 비행이 자기
 * 자신을 기다린다(설계 §3의 0).
 *
 * 이미 돌고 있으면 플래그를 **소비하지 않는다**. 소비해 놓고 재진입 가드에 막히면 그
 * 관찰이 통째로 사라진다.
 */
function scheduleRebase(): void {
  if (rebasing) return
  if (!takeRebaseNeeded()) return
  setTimeout(() => void runRebase(), 0)
}

export async function serverSnapshot(
  // 'rebase' — 다른 기기의 파괴적 교체를 따라가기 직전의 이 기기 상태(설계 §3의 2).
  // 재기준화가 자동으로 살리지 못하는 오프라인 신규 기록의 유일한 복구 경로다.
  reason: 'reset' | 'import' | 'restore' | 'rebase',
  payload: { days: Day[]; meta: Meta },
): Promise<{ id: number; at: string; dayCount: number }> {
  // 호출자는 항상 syncEnabled()로 먼저 게이트한다 — 여기 닿는다는 것은 그 게이트를
  // 빠뜨렸다는 뜻이다. 조용히 성공한 척하면(빈 스냅샷 등) 백업이 있다고 잘못 믿게 되므로
  // 크게 실패시킨다.
  if (!configured()) throw new Error('동기화가 설정되지 않았어요')
  const device = await getDeviceState()
  const res = await req(`${SUPABASE_URL}/rest/v1/snapshots`, {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      device: device.deviceId,
      reason,
      day_count: payload.days.length,
      // 백업 파일과 **같은 모양**으로 올린다(app·schemaVersion·exportedAt 포함) — 되돌리기가
      // 감싸개 없이 validateBackup에 그대로 넣고, 버전은 스냅샷이 스스로 밝힌다.
      // 모양의 단일 출처는 engine/backup.ts의 backupPayload다(최종 리뷰 8).
      payload: backupPayload(payload.days, payload.meta, new Date().toISOString()),
    }),
  })
  if (!res.ok) throw new Error(`스냅샷 실패: ${res.status}`)
  const [row] = (await res.json()) as { id: number; at: string; day_count: number }[]
  return { id: row!.id, at: row!.at, dayCount: row!.day_count }
}

export async function serverReplaceAll(payload: { days: Day[]; meta: Meta }): Promise<void> {
  // 호출자가 syncEnabled() 게이트를 빠뜨렸을 때만 닿는다 — 파괴적 RPC라 조용히
  // 넘어가면 안 된다.
  if (!configured()) throw new Error('동기화가 설정되지 않았어요')
  const now = new Date().toISOString()
  const device = await getDeviceState()
  const stamps = await getStamps('meta')
  const settingsAt = stamps?.settingsAt ?? null
  const res = await req(`${SUPABASE_URL}/rest/v1/rpc/replace_all`, {
    method: 'POST',
    body: JSON.stringify({
      // **백업 파일과 같은 모양으로 보낸다**(backupPayload가 그 모양의 주인). RPC는
      // 재삽입할 행의 schema_version을 `p_payload->>'schemaVersion'`에서 읽는다 —
      // 최상위 버전이 없으면 v2 데이터가 v1 라벨을 달고 앉고, 그러면 옛 클라이언트의
      // 통째 PATCH가 days_guard_version을 1→1로 통과해 v2 payload를 되덮는다.
      p_payload: backupPayload(payload.days, payload.meta, now),
      // 인자를 생략하면 서버 default(now()·'')가 서지만, **명시적 null은 열을 null로
      // 덮는다** — 그 열이 다음 병합의 근거라 지우면 안 된다. 로컬 스탬프가 없으면
      // (통째 교체가 stamps를 비운 직후가 그렇다) 지금·이 기기로 대신한다.
      p_settings_at: settingsAt ?? now,
      p_settings_by: settingsAt === null ? device.deviceId : (stamps?.settingsBy ?? ''),
    }),
  })
  if (!res.ok) throw new Error(`replace_all 실패: ${res.status}`)
}

export async function listSnapshots(
  limit: number,
): Promise<{ id: number; at: string; reason: string; dayCount: number }[]> {
  // 호출자가 syncEnabled() 게이트를 빠뜨렸을 때만 닿는다 — 빈 목록을 돌려주면
  // "스냅샷이 없다"로 오독될 수 있어 실패로 알린다.
  if (!configured()) throw new Error('동기화가 설정되지 않았어요')
  const res = await req(
    `${SUPABASE_URL}/rest/v1/snapshots?select=id,at,reason,day_count&order=id.desc&limit=${limit}`,
  )
  if (!res.ok) throw new Error(`스냅샷 목록 실패: ${res.status}`)
  const rows = (await res.json()) as { id: number; at: string; reason: string; day_count: number }[]
  return rows.map((r) => ({ id: r.id, at: r.at, reason: r.reason, dayCount: r.day_count }))
}

/**
 * 스냅샷 내용. 타입을 붙이지 않고 unknown으로 돌려준다 — 서버에서 온 값이고, 모양을
 * 약속하는 것은 validateBackup 하나여야 한다(화면이 Day[]라고 믿고 쓰기 시작하면
 * 검증 전에 신뢰가 생긴다).
 */
export async function getSnapshotPayload(id: number): Promise<unknown> {
  // 호출자가 syncEnabled() 게이트를 빠뜨렸을 때만 닿는다.
  if (!configured()) throw new Error('동기화가 설정되지 않았어요')
  const res = await req(`${SUPABASE_URL}/rest/v1/snapshots?id=eq.${id}&select=payload`)
  if (!res.ok) throw new Error(`스냅샷 조회 실패: ${res.status}`)
  const rows = (await res.json()) as { payload: unknown }[]
  if (rows.length === 0) throw new Error('스냅샷이 없다')
  return rows[0]!.payload
}
