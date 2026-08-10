import { backupPayload, SCHEMA_VERSION, validateDay } from '../engine/backup'
import { foldOutbox } from '../engine/outbox'
import { EMPTY_STAMPS, mergeDay, mergeMeta, sheetConflict } from '../engine/merge'
import type { BundleStamps, Stamped } from '../engine/merge'
import type { Day, Meta } from './types'
import {
  deleteOutboxThrough,
  getDay,
  getDeviceState,
  getMeta,
  getOutbox,
  getStamps,
  putDeviceState,
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

/** 지금 도는 push 비행. 단일 비행 보장과 suspendPush의 대기 대상을 겸한다. */
let flight: Promise<void> | null = null
let suspendCount = 0

/**
 * 파괴적 작업(초기화·가져오기·되돌리기)이 도는 동안 push를 멈춘다. **진행 중인 비행이
 * 있으면 끝날 때까지 기다린다** — 이미 나간 요청은 취소할 수 없으니 "지우기 전에 먼저
 * 끝내게 두는 것"이 유일하게 안전한 순서다.
 *
 * 막는 사고: pushDay가 지우기 직전의 Day를 읽어 둔 채 `serverReplaceAll`이 서버를 비운
 * 뒤에 POST하면, 로컬에 없는 날이 서버에 남는다. 1단계에는 pull이 없어 그 어긋남을
 * 되돌릴 방법도 없다(최종 리뷰 4).
 *
 * 표식은 하나도 잃지 않는다 — 멈춘 동안 push가 안 돌 뿐이고, resumePush 뒤 다음
 * 기회에 그대로 올라간다.
 */
export async function suspendPush(): Promise<void> {
  suspendCount++
  await flight
}

export function resumePush(): void {
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
    value: v.day,
    at: {
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

/** grades 묶음이 실려 있나. 주인은 `merge.ts`의 `hasGradesBundle`이고 여기 있는 것은
 *  네트워크 계층이 같은 세 필드를 보는 사본이다 — 규칙을 바꿀 일이 생기면 저쪽이 먼저다. */
function hasGradesBundle(d: Day): boolean {
  return (
    (d.grades !== undefined && Object.keys(d.grades).length > 0) ||
    d.mood !== undefined ||
    d.doneAt !== undefined
  )
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
    if (typeof row['schema_version'] === 'number' && row['schema_version'] > SCHEMA_VERSION)
      return false
    const server = rowToStampedDay(row)
    // 검증에 걸린 행은 병합 입력이 될 수 없다. 표식을 남겨 두면 서버 쪽이 고쳐지는 즉시
    // 다음 패스가 올린다.
    if (!server || server.value.date !== date) return false

    if (rewrite) {
      // 「다시 만들기」의 인가된 경로. 채점이 있는 날은 서버가 거부하므로 먼저 물어본다 —
      // 조건은 서버 함수(rewrite_sheet)의 것과 같은 "grades 객체가 비어 있지 않다"다.
      if (Object.keys(server.value.grades ?? {}).length > 0) {
        await quarantineDate(date)
        return false
      }
      // 송신 payload는 병합 출력에 sheet만 로컬로 강제한 것이다(설계 §2) — "sprint만
      // 얹는" 조립은 서버의 kind·모르는 필드를 통째 교체로 되돌린다. 로컬에는 쓰지 않는다.
      const payload = { ...mergeDay(local, server).value, sheet: local.value.sheet }
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
      if (res.ok) return true
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
    if (updated.length > 0) return true // 0행이면 rev 충돌 — 다시 읽어 병합부터
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

export async function serverSnapshot(
  reason: 'reset' | 'import' | 'restore',
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
