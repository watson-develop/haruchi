import { backupPayload, SCHEMA_VERSION, validateBackup, validateDay } from '../engine/backup'
import { foldOutbox } from '../engine/outbox'
import {
  EMPTY_STAMPS,
  hasGradesBundle,
  mergeDay,
  mergeMeta,
  sheetConflict,
  structuralEqual,
} from '../engine/merge'
import type { BundleStamps, Stamped } from '../engine/merge'
import { nextCursor } from '../engine/pull-cursor'
import type { PulledRow } from '../engine/pull-cursor'
import type { Day, Meta } from './types'
import {
  adoptServerDay,
  applyPulledDay,
  applyPulledMeta,
  clearOutboxRewrite,
  deleteOutboxThrough,
  getAllDays,
  getDay,
  getDeviceState,
  getMeta,
  getOutbox,
  getStamps,
  putDay,
  replaceFromServer,
  seedOutbox,
  updateDeviceState,
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

/** 응답 본문에서 잘라 오는 최대 길이. PostgREST의 오류 JSON은 이보다 훨씬 짧고, 게이트웨이가
 *  HTML 오류 페이지를 돌려주는 경우에 배너가 통째로 잠기는 것만 막으면 된다. */
const ERROR_BODY_MAX = 300

/**
 * 실패 응답을 Error로 바꾼다. **상태 코드만 남기지 않는다.**
 *
 * PostgREST는 4xx·5xx 본문에 `{code, message, details, hint}`를 담아 실패 사유를 문장으로
 * 말해 준다. 그것을 버리면 **서버가 이미 진단한 실패가 클라이언트에서 진단 불가능한 실패로
 * 강등된다** — 2026-08-12에 `replace_all`이 400으로 죽었을 때 원인(`delete from days`가
 * Supabase의 safeupdate에 막힘, SQLSTATE 21000)은 오직 이 본문에만 있었고, 상태 코드만
 * 남긴 탓에 Postgres 로그를 파야 했다.
 *
 * 본문 읽기 실패는 삼킨다 — 진단을 도우려다 원래 오류를 가리면 안 된다. 호출자는 이미
 * 응답을 소비하지 않기로 하고 던지는 자리에서만 이걸 부른다(성공 경로와 본문을 다투지 않는다).
 */
async function failed(label: string, res: Response): Promise<Error> {
  let detail = ''
  try {
    const body = (await res.text()).trim()
    if (body) detail = ` ${body.slice(0, ERROR_BODY_MAX)}`
  } catch {
    // 본문을 못 읽어도 상태 코드는 남는다.
  }
  return new Error(`${label} 실패: ${res.status}${detail}`)
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
let pullFlight: Promise<PullResult> | null = null
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
    const at = new Date().toISOString()
    await updateDeviceState((s) => ({ ...s, lastSyncAt: at }))
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

/** 격리 목록에 날짜를 넣는다(설계 §2). 멱등 — 이미 있으면 아무것도 쓰지 않는다.
 *  읽기와 쓰기가 한 트랜잭션이어야 한다: 이 사이에 끝난 다른 비행의 커서·lastSyncAt이
 *  낡은 사본에 덮여 사라진다(`updateDeviceState` 주석). */
export async function quarantineDate(date: string): Promise<void> {
  await updateDeviceState((s) =>
    s.quarantine.includes(date) ? s : { ...s, quarantine: [...s.quarantine, date] },
  )
}

/** 격리 해제. 아빠가 배너에서 고르거나(2단계 §2), pull이 자연 해제를 관찰했을 때. */
export async function clearQuarantine(date: string): Promise<void> {
  gradedQuarantine.delete(date) // 충돌이 끝났으면 「채점까지 마쳤다」는 사실도 함께 끝난다
  await updateDeviceState((s) =>
    s.quarantine.includes(date) ? { ...s, quarantine: s.quarantine.filter((d) => d !== date) } : s,
  )
}

/**
 * "이 날짜는 **서버에 이미 채점이 있다**" — 격리 배너가 「유지」를 내놓으면 안 되는 날짜.
 *
 * 이 사실을 관찰하는 곳은 둘이고 둘 다 동기화 엔진 안이다: 「유지」의 사전 확인
 * (`resolveKeepMine`)과 push의 `sheet_rewrite_graded` 거부(`pushDay`). 화면은 그때 한 번
 * 배너를 「채택」만 남는 변형으로 바꾸지만, **그 변형이 렌더에 남지 않는 것이 결함이었다** —
 * 배경 pull 재렌더가 부모 홈을 다시 그리면 「이 기기 종이 유지」가 되살아나 아빠가 눌러서
 * 다시 거부당해야 원인을 알게 된다. 상태를 세우는 곳이 엔진 하나여야 한다는 규칙
 * (`syncNotice` 주석)을 그대로 따라 여기 둔다.
 *
 * `rejected`·`rebased`와 같이 기기 메모리에만 산다 — 새로고침하면 사라지고, 그때는 「유지」를
 * 다시 눌러 `resolveKeepMine`의 사전 확인이 같은 판정을 즉시 내린다(누르면 서버를 본다).
 */
const gradedQuarantine = new Set<string>()

export function markQuarantineGraded(date: string): void {
  gradedQuarantine.add(date)
}

export function isQuarantineGraded(date: string): boolean {
  return gradedQuarantine.has(date)
}

/**
 * 서버의 그 날짜 행. 격리 탈출 두 갈래가 **같은 눈으로** 서버를 본다 — 「유지」의 채점
 * 사전 확인과 「채택」의 원본이 다른 경로로 행을 읽으면 판정과 적용이 어긋난다.
 *
 * 'invalid'는 "행은 있는데 이 앱이 못 읽는다"이고 'none'과 다르다 — 「채택」은 읽지 못한
 * 것을 받을 수 없고, 「유지」는 채점이 있는지 알 수 없어 push의 판정에 맡겨야 한다.
 */
type ServerDay = { kind: 'none' } | { kind: 'invalid' } | { kind: 'ok'; day: Stamped<Day> }

async function serverDay(date: string): Promise<ServerDay> {
  const res = await req(`${SUPABASE_URL}/rest/v1/days?date=eq.${date}&select=${DAY_SELECT}`)
  if (!res.ok) throw await failed('days 조회', res)
  const rows = (await res.json()) as unknown[]
  if (rows.length === 0) return { kind: 'none' }
  const day = rowToStampedDay(rows[0])
  if (!day || day.value.date !== date) return { kind: 'invalid' }
  return { kind: 'ok', day }
}

/**
 * 격리 탈출 ①「이 기기 종이 유지」(설계 2단계 §2 「격리 탈출」).
 *
 * ① 서버 행을 읽어 **서버 grades 존재를 먼저 확인**한다 — 있으면 「유지」는 불가능하다
 * (서버 함수가 거부한다). push를 시도조차 하지 않고 `'graded'`를 돌려주어 배너를
 * 「채택」만 남는 변형으로 바꾼다. ② 없으면 rewrite 의도 표식만 새로 남긴다 — 그 플래그가
 * 격리의 push 금지와 격리 판정 양쪽을 면제하는 유일한 통로다. 송신 payload 조립(병합
 * 출력에 sheet만 로컬 강제)과 거부 처리는 push 쪽(`pushDay`)의 몫이다. ③ **격리 해제는
 * 여기서 하지 않는다** — push가 성공한 뒤에 푼다(pushDay). 미리 풀면 오프라인에서 배너가
 * 사라져 아빠는 골랐다고 믿는데 서버는 그대로인 상태가 된다.
 *
 * 표식을 남긴 뒤 push 비행이 끝날 때까지 기다린다 — 부르는 화면이 **최종 상태**를 다시
 * 그리게 하기 위해서다(격리가 풀렸으면 배너가 사라지고, 못 풀렸으면 남는다).
 */
export async function resolveKeepMine(date: string): Promise<'ok' | 'graded'> {
  if (!(await syncEnabled())) throw new Error('아직 이 기기가 서버에 연결되지 않았어요')
  const server = await serverDay(date)
  if (server.kind === 'ok' && Object.keys(server.day.value.grades ?? {}).length > 0) {
    markQuarantineGraded(date) // 재렌더에도 「채택」만 남게 한다
    return 'graded'
  }
  const day = await getDay(date)
  // 지킬 종이가 없다. 격리는 "둘 다 실재하고 다르다"에서만 서므로 이미 사라진 충돌이다.
  if (!day || day.sheet.length === 0) {
    await clearQuarantine(date)
    return 'ok'
  }
  await putDay(day, ['sheet'], { rewrite: true })
  // 서버에 그 날짜 행 자체가 없으면 충돌도 없다(다른 기기의 파괴적 교체 뒤에 남은 격리).
  // pushDay의 INSERT 경로는 격리를 풀지 않으므로 여기서 푼다 — 안 풀면 영원히 남는다.
  if (server.kind === 'none') await clearQuarantine(date)
  kickPush()
  await flight
  return 'ok'
}

/**
 * 격리 탈출 ②「다른 기기 것 채택」(설계 2단계 §2 「격리 탈출」).
 *
 * sheet·grades는 서버 것을 받는다 — **로컬의 어긋난 grades는 함께 버려진다.** 다른
 * 문제지의 정답표에 채점이 붙은 채로 남는 것이야말로 재인쇄 동일성이 막으려는 오염이다.
 * 나머지는 평소 병합 그대로다(sprint 합집합·kind 단조·모르는 필드). 스탬프는 서버 것을
 * 보존한다 — 지금 시각으로 다시 찍으면 남의 값이 이 기기 시각을 업고 서버의 더 새 값을
 * 이긴다.
 *
 * 로컬에만 있던 sprint 세션이 있으면 그 묶음 표식을 남겨 다음 push가 올린다. 그리고
 * **잔존 rewrite 플래그를 반드시 지운다** — 남으면 이미 뒤집힌 의도로 다음 push가 상대
 * 종이를 도로 덮거나 거부돼 그 날짜를 다시 격리한다.
 *
 * 전체를 `suspendSync`로 감싼다: 서버 행을 읽고 로컬에 앉히는 사이에 rewrite 표식을 든
 * push가 돌면, 방금 버리기로 한 이 기기 종이가 서버로 올라가 두 기기가 서로 반대로
 * 수렴한다(다음 pull이 같은 날을 다시 격리한다 — 데이터를 잃지는 않지만 아빠가 고른 것이
 * 뒤집힌다). 격리 자체가 pull 적용을 막고 있으므로 pull 쪽은 해제 순간까지 조용하다.
 */
export async function resolveAdoptServer(date: string): Promise<void> {
  if (!(await syncEnabled())) throw new Error('아직 이 기기가 서버에 연결되지 않았어요')
  await suspendSync()
  try {
    const server = await serverDay(date)
    if (server.kind !== 'ok') throw new Error(`다른 기기 문제지를 읽지 못했어요: ${date}`)
    const stored = await getDay(date)
    const local: Stamped<Day> = stored
      ? { value: stored, at: (await getStamps(date)) ?? EMPTY_STAMPS }
      : { value: { date, kind: 'normal', sheet: [] }, at: EMPTY_STAMPS }
    const merged = mergeDay(local, server.day)
    const value: Day = { ...merged.value, sheet: server.day.value.sheet }
    // grades 묶음은 세 필드다(hasGradesBundle) — 통째로 서버 것으로 갈아 끼운다. 하나만
    // 남겨도 "다른 종이의 기분·끝낸 시각"이 남는다.
    delete value.grades
    delete value.mood
    delete value.doneAt
    if (server.day.value.grades !== undefined) value.grades = server.day.value.grades
    if (server.day.value.mood !== undefined) value.mood = server.day.value.mood
    if (server.day.value.doneAt !== undefined) value.doneAt = server.day.value.doneAt
    const at: BundleStamps = {
      ...merged.at,
      sheetAt: server.day.at.sheetAt,
      sheetBy: server.day.at.sheetBy,
      gradesAt: server.day.at.gradesAt,
      gradesBy: server.day.at.gradesBy,
    }
    await adoptServerDay({ value, at })
    // 로컬에만 있던 sprint 세션은 서버가 모른다 — 그 묶음의 표식을 남겨 다음 push가 올린다.
    if (!structuralEqual(value.sprint, server.day.value.sprint)) await putDay(value, ['sprint'])
    await clearOutboxRewrite(date)
    await clearQuarantine(date)
  } finally {
    resumeSync()
  }
  kickPush()
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
  if (!res.ok) throw await failed('meta 조회', res)
  const rows = (await res.json()) as { generation?: unknown }[]
  const server = rows[0]?.generation
  if (typeof server !== 'number') return true // 스키마 미적용 — 판정할 근거가 없다
  if (device.generation === null) {
    await updateDeviceState((s) => ({ ...s, generation: server }))
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
    if (!cur.ok) throw await failed('days 조회', cur)
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
      if (res.status !== 409) throw await failed('days 생성', res)
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
      //
      // **아래 거부 분기와 정확히 같은 세 가지를 한다.** 두 분기가 관찰하는 사실이
      // 같기 때문이다("서버에 이미 채점이 있어 이 다시 만들기는 영영 못 앉는다") —
      // 결론이 같은데 한쪽만 뒤처리를 하면 그 차이가 그대로 결함이 된다. rewrite 표식을
      // 안 지우면 설계 356-357이 막으라는 영구 미동기가 되고(매 패스가 이 GET을 다시
      // 태우며 그 날짜의 채점·스프린트도 함께 묶여 못 올라간다), 「채점까지 마쳤다」를
      // 안 세우면 배너가 「이 기기 종이 유지」를 계속 내놔 아빠가 눌러서 거부당해야
      // 원인을 안다. 경합 없이 닿는다: 다른 기기가 채점해 올린 날에 이 기기가
      // 「다시 만들기」를 누르면 곧장 여기다(print-sheet는 로컬 채점만 본다).
      if (Object.keys(server.value.grades ?? {}).length > 0) {
        await clearOutboxRewrite(date)
        await quarantineDate(date)
        markQuarantineGraded(date)
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
          if (!after.ok) throw await failed('days 타임스탬프 갱신', after)
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
      // 설계는 여기서 **rewrite 플래그까지 소거**하라고 한다(356-357) — 안 그러면 그
      // 플래그가 격리 판정을 면제하는 탓에 배너 없이 매 패스 거부만 반복되는 영구
      // 미동기가 된다. 표식 자체는 남긴다: 같은 표식에 접혀 온 채점·스프린트가 아직
      // 안 올라갔을 수 있다(clearOutboxRewrite가 그 둘을 구분한다).
      //
      // 이 비행이 읽어간 스냅샷 뒤에 새로 찍힌 rewrite(진행 중에 아빠가 「다시 만들기」)도
      // 함께 지워진다 — deleteOutboxThrough의 maxKey 같은 보호가 없다. 그 창은 밀리초고,
      // 잃는 쪽이 안전한 방향이다: 의도가 사라지면 그 날짜는 격리·배너로 떨어져 아빠가
      // 다시 고른다(반대로 남기면 물어보지 않고 상대 종이를 덮는다).
      if (body.includes('sheet_rewrite_graded')) {
        await clearOutboxRewrite(date)
        await quarantineDate(date)
        // 배너가 이 사실을 렌더마다 다시 말하게 한다 — 여기서 세우지 않으면 다음 재렌더가
        // 「이 기기 종이 유지」를 되살려 아빠가 같은 거부를 다시 받아야 원인을 안다.
        markQuarantineGraded(date)
        return false
      }
      if (body.includes('rev_conflict')) continue
      throw await failed('sheet 다시 만들기', res)
    }

    // sheet 충돌은 병합하지 않는다 — 종이는 이미 물리적으로 둘이고, 어느 것에 아이가
    // 풀었는지는 아빠만 안다(설계 §2). 판정은 구조적 동치의 부정이다(jsonb 키 순서 무시).
    // **rewrite 표식을 단 push도 여기 닿는다** — 위 게이트의 조건은 플래그가 아니라
    // 「플래그 + 실제 sheet 충돌」이라, 서버 sheet가 이미 우리 것과 같거나 비어 있으면
    // 그냥 통과해 이 줄에 온다. 다만 그때는 `sheetConflict`가 거짓이므로 이 조건이 서지
    // 않는다: 여기서 격리되는 것은 언제나 "의도 없는 충돌"뿐이다.
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
      throw await failed('days 갱신', res)
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
    if (!cur.ok) throw await failed('meta 조회', cur)
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
    if (!res.ok) throw await failed('meta 갱신', res)
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

/**
 * 페이지 이어받기 지점 — 직전 페이지의 **마지막 행**. `updatedAt`은 서버가 준 **원문**이지
 * `serverStamp`로 정규화한 값이 아니다: 정규화는 마이크로초를 밀리초로 자르므로
 * `updated_at.gt.<잘린 값>`이 그 행 자신을 다시 포함하고, `updated_at.eq.`는 거짓이 되어
 * date 타이브레이크도 서지 않는다 — 같은 페이지를 40번 다시 받는다.
 */
type PageKey = { updatedAt: string; date: string }

/** 날짜 키의 모양. 키셋 필터에 그대로 실리는 값이라, 콤마·괄호가 들어오면 PostgREST의
 *  `or=(…)` 문법 자체가 깨진다 — 모양이 다르면 이어받기를 포기하고 다음 pull에 맡긴다. */
const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/

function pageKeyOf(row: Record<string, unknown>): PageKey | null {
  const updatedAt = row['updated_at']
  const date = row['date']
  if (typeof updatedAt !== 'string' || typeof date !== 'string' || !DATE_KEY_RE.test(date))
    return null
  return { updatedAt, date }
}

/**
 * days 한 페이지. `after`가 있으면 **키셋**으로 이어 받는다.
 *
 * **offset 페이징은 행을 영영 잃는다.** 한 패스가 여러 페이지에 걸치는 동안 다른 기기가
 * 이미 지나간 행을 하나 쓰면 그 행의 `updated_at`이 최대값이 되어 정렬 **끝**으로 옮겨
 * 가고, 뒤의 모든 행이 한 칸씩 당겨진다. 다음 `offset`은 한 행 늦게 시작하므로 그 경계의
 * 행 하나가 이 패스에서 안 보이고, 커서는 그 위를 지나가 버려 **다시는 받지 않는다.**
 * 500행이 넘는 첫 pull 도중에 아이가 스프린트를 끝내는 것이 바로 그 상황이다.
 *
 * 키셋 조건이 `(updated_at, date)` 복합인 이유는 `replace_all`이 모든 행을 한 트랜잭션에서
 * 써서 `updated_at`이 전부 같기 때문이다 — `updated_at.gt` 하나로는 첫 페이지에서
 * 영원히 제자리를 돈다. `date`는 PK라 전순서를 완성한다.
 */
async function getDayPage(
  since: string | null,
  after: PageKey | null,
): Promise<Record<string, unknown>[]> {
  // 값마다 인코딩한다 — PostgREST의 timestamptz 원문에는 `+00:00`이 들어 있고 질의
  // 문자열의 `+`는 공백으로 읽힌다. 구조 문자(괄호·콤마)는 인코딩하지 않는다.
  let filter = ''
  if (after !== null) {
    const t = encodeURIComponent(after.updatedAt)
    filter = `or=(updated_at.gt.${t},and(updated_at.eq.${t},date.gt.${after.date}))&`
  } else if (since !== null) {
    filter = `updated_at=gt.${encodeURIComponent(since)}&`
  }
  const res = await req(
    `${SUPABASE_URL}/rest/v1/days?${filter}select=${PULL_DAY_SELECT}` +
      `&order=updated_at.asc,date.asc&limit=${PULL_PAGE}`,
  )
  if (!res.ok) throw await failed('days pull', res)
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

/** 커서는 **서버 응답의 `updated_at`으로만** 전진한다. 읽기와 쓰기가 한 트랜잭션이다 —
 *  같은 레코드를 격리 판정·lastSyncAt·seededAt도 갱신하므로 오래된 사본으로 덮으면
 *  그것들이 사라진다(가져오기 직후의 `seededAt`이 그렇게 되면 전량 재시딩이 된다). */
async function saveCursor(cursor: string | null): Promise<void> {
  await updateDeviceState((s) => (s.lastPulledAt === cursor ? s : { ...s, lastPulledAt: cursor }))
}

async function pullDays(): Promise<boolean> {
  const device = await getDeviceState()
  let cursor = device.lastPulledAt
  const quarantined = new Set(device.quarantine)
  const since = overlapSince(cursor)
  let changed = false
  let after: PageKey | null = null
  for (let page = 0; page < PULL_MAX_PAGES; page++) {
    const rows = await getDayPage(since, after)
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
    const next = pageKeyOf(rows[rows.length - 1]!)
    if (next === null) break // 이어받을 지점을 못 세운다 — 나머지는 다음 pull이 받는다
    after = next
  }
  return changed
}

/**
 * meta pull. 두 가지를 함께 한다 — **generation 관찰**(설계 §3)과 settings 적용.
 *
 * generation이 어긋나면 `'rebase'`를 돌려주고 이 패스의 나머지(days 적용)를 하지 않는다:
 * 어차피 재기준화가 로컬 전체를 서버 상태로 갈아 끼우므로, 그 전에 행을 적용하는 것은
 * 곧 버려질 쓰기이고 그 사이 화면이 두 번 깜빡인다.
 *
 * 행이 하나도 안 보이면 `'unauthorized'`다 — **이 패스는 서버 상태를 말할 수 없다.**
 * `meta`는 스키마가 시딩해 항상 정확히 한 줄이므로 "200인데 빈 배열"은 키가 거부됐다는
 * 뜻으로만 설명된다(`serverStatus`의 주석과 같은 판정). 예전에는 여기서 조용히 `false`를
 * 돌려주고 뒤이은 `pullDays`가 정당하게 0행을 받아 패스 전체가 `status: 'ok'`로 끝났는데,
 * 그것은 **다른 아이패드의 문제지가 이 기기에 영영 안 보이는 바로 그 경우**를 "서버 확인
 * 완료"로 보고하는 것이었다 — 생성 게이트가 경고 없이 두 번째 문제지를 만든다.
 */
async function pullMeta(): Promise<boolean | 'rebase' | 'unauthorized'> {
  const res = await req(
    `${SUPABASE_URL}/rest/v1/meta?id=eq.1&select=payload,generation,settings_at,settings_by`,
  )
  if (!res.ok) throw await failed('meta pull', res)
  const row = ((await res.json()) as Record<string, unknown>[])[0]
  // 폐기된 키의 RLS 응답은 200 + 빈 배열이다(위 주석). 조용히 끝내지 않는다 — 이 패스는
  // 서버를 못 본 것이고, 부르는 쪽은 그 사실을 알아야 한다.
  if (!row) return 'unauthorized'

  const device = await getDeviceState()
  const server = row['generation']
  if (typeof server === 'number' && device.generation !== server) {
    // 처음 관찰(로컬이 null)은 재기준화 없이 채택한다(설계 §3 「초기값」) — 1단계 기기가
    // 하나라 서버 상태가 곧 그 기기 상태였고, 첫 관찰을 "증가"로 오인해 통째 교체하는
    // 쪽이 훨씬 큰 사고다.
    if (device.generation === null) {
      await updateDeviceState((s) => ({ ...s, generation: server }))
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
 * app_config(PIN)를 내려받아 DeviceState.pin에 캐시한다(2B 스펙 §3). 반환값은
 * 캐시가 실제로 바뀌었는가 — pullPass가 PullResult.changed에 싣는다. 이것이 없으면
 * SQL로 PIN만 넣은 직후의 pull(다른 변경이 없는 패스)이 재렌더를 못 깨워, 정답이
 * 떠 있는 채점 화면에 잠금이 영영 안 걸린다.
 *
 * 반드시 pullPass의 'unauthorized'·'rebase' 가드 **뒤**에서만 부른다 — 폐기된 키의
 * RLS 응답이 200 + 빈 배열이라, 가드 앞에서 부르면 폐기된 기기가 빈 응답을
 * "PIN 미설정"으로 읽고 캐시를 지워 게이트를 스스로 연다.
 *
 * 실패는 삼키고 캐시를 유지한다 — app_config만의 장애(일시 5xx)가 이 패스의
 * days pull까지 죽이면 push는 되는데 pull만 안 되는 반쪽 동기화가 된다.
 * PIN 캐시가 한 패스 낡는 것은 아무 비용이 아니다.
 *
 * 형식(4자리)은 검증하지 않는다 — PIN은 파생에 쓰이지 않고 === 비교 한 번이라
 * 기형 값이 도달할 넓이가 없고, SQL 전용 설정에서 거부는 옛 PIN을 조용히
 * 유지해 "바꿨는데 안 먹는다"가 된다(스펙 §3). 빈 배열(행 없음 — 최초 설정 전)과
 * pin ''(사람이 SQL로 지움)은 둘 다 null이 되어 게이트가 꺼진다.
 */
async function pullConfig(): Promise<boolean> {
  try {
    const res = await req(`${SUPABASE_URL}/rest/v1/app_config?id=eq.1&select=pin`)
    if (!res.ok) return false
    const row = ((await res.json()) as Record<string, unknown>[])[0]
    const pin = typeof row?.['pin'] === 'string' && row['pin'] ? (row['pin'] as string) : null
    if ((await getDeviceState()).pin === pin) return false
    await updateDeviceState((s) => (s.pin === pin ? s : { ...s, pin }))
    return true
  } catch {
    return false
  }
}

/**
 * 한 번의 pull 결과. **두 사실이 서로 다른 질문에 답한다.**
 *
 * - `changed` — 로컬이 하나라도 바뀌었나. 화면을 다시 그릴지의 근거(설계 §2 「배경 pull 후
 *   화면 갱신」)
 * - `status` — 서버 상태를 확인했다고 말할 수 있나. 재인쇄 생성 게이트(설계 §2)가
 *   「pull 성공 + 오늘 sheet 존재 → 그것을 보여준다 / pull 실패 → 경고 후 명시적 진행
 *   선택」으로 **갈라지는** 근거다
 *   - `'ok'` 서버까지 다녀왔다 · `'failed'` 못 닿았거나 이 패스로는 서버 상태를 말할 수
 *     없다(파괴적 작업 중·재기준화 대기) · `'off'` 동기화가 꺼져 있다
 *   - **`'off'`는 경고 대상이 아니다.** 서버가 없으면 다른 기기도 없으므로 오늘 문제지를
 *     먼저 만든 기기도 있을 수 없다 — 여기서 경고하면 동기화를 안 쓰는 기기의 화면 흐름이
 *     오늘과 달라진다
 *
 * 불리언 하나로 두 사실을 실을 수 없다는 것이 이 타입의 이유다. 모듈 전역에 "마지막 pull
 * 결과"를 두는 방법은 쓰지 않았다 — 단일 비행이라 여러 호출자가 한 비행을 공유하는데,
 * 전역이면 **내가 기다린 비행이 아닌** 배경 pull의 결과를 읽을 수 있다. 반환값은 기다린
 * 그 비행에 묶인다.
 */
export type PullResult = { status: 'ok' | 'failed' | 'off'; changed: boolean }

/**
 * 한 번의 pull. 단일 비행이다 — 트리거가 넷(앱 시작·부모 화면 진입·아이 화면 진입·탭
 * 복귀)이라 겹치는 것이 정상이고, 겹친 호출은 **도는 비행을 그대로 기다린다**.
 *
 * 실패는 조용하다(§3) — 커서가 전진하지 않는 것 자체가 재시도 신호다. 그래서 이 함수는
 * 거부하지 않는다: 배경 호출(`void pullOnce()`)이 처리되지 않은 거부를 만들면 안 된다.
 * 실패 사실은 예외가 아니라 `status`로 전달된다.
 */
export function pullOnce(): Promise<PullResult> {
  if (pullFlight) return pullFlight
  let applied = false
  const pass = (async () => {
    try {
      const result = await pullPass()
      applied = result.changed
      return result
    } catch {
      return { status: 'failed' as const, changed: false }
    }
  })()
  pullFlight = pass
  void pass.finally(() => {
    if (pullFlight === pass) pullFlight = null
    // 재렌더 신호는 **비행이 끝난 뒤** 쏜다. 비행 안에서 쏘면 그 자리에서 시작된 재렌더가
    // `pullOnce`를 다시 불러 아직 안 끝난 같은 비행을 기다리고, 그 화면은 자기가 방금
    // 신호를 받은 이유(적용된 변경)를 두 번 그린다.
    if (applied) notifyPullApplied()
    // 비행 종료 훅 — 관찰한 비행 안에서 재기준화를 시작하면 교착한다(설계 §3의 0).
    scheduleRebase()
  })
  return pass
}

/**
 * pull이 **로컬을 실제로 바꿨을 때만** 쏘는 재렌더 신호(설계 §2 「배경 pull 후 화면 갱신」).
 * 표식 알림(`db.ts`의 `notifyOutbox`)과 같은 방식이다 — window 이벤트라 화면·main이 서로를
 * import하지 않고도 듣는다(형제 규칙). 재기준화가 로컬을 통째로 갈아 끼운 뒤에도 쏜다:
 * 그때야말로 화면에 있는 모든 수치가 낡았고, 부모 홈의 대기 건수 배지·재기준화 알림이
 * 다시 그려져야 하는 순간이다.
 *
 * **무엇을 그릴지는 듣는 쪽이 정한다** — 여기서는 화면을 바꾸지 않는다(아이 화면이 부모
 * 화면으로 넘어가는 경로를 이 신호가 만들면 안 된다).
 */
const PULL_APPLIED_EVENT = 'haruchi:pull-applied'

function notifyPullApplied(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(PULL_APPLIED_EVENT))
}

export function onPullApplied(cb: () => void): void {
  if (typeof window === 'undefined') return
  window.addEventListener(PULL_APPLIED_EVENT, cb)
}

/**
 * pull 한 번을 **기다리되 붙잡히지는 않는다**(설계 §2 「언제 내리나」). 타임아웃은
 * "그만 기다린다"이지 "취소한다"가 아니다 — 비행은 계속 돌고, 늦게 도착하면 위 재렌더
 * 신호가 화면을 갱신한다. 그래서 타임아웃으로 돌아갈 때의 결과는 `'failed'`다: 그 시점의
 * 호출자에게 참인 사실은 "아직 서버를 확인하지 못했다"이고, 생성 게이트는 그 사실 위에서
 * 아빠에게 물어야 한다.
 *
 * **미설정 기기는 즉시 돌아온다.** 여기서 타이머를 걸면 서버를 안 쓰는 기기의 화면 전이가
 * 3초씩 늦어진다 — 동기화가 꺼져 있을 때 앱이 오늘과 완전히 같아야 한다는 규칙이 이
 * 함수의 첫 줄에 있다. (`pullOnce`도 미등록이면 no-op이지만, 그쪽은 IndexedDB를 한 번
 * 읽는다 — 설정조차 없는 기기에서는 그 읽기도 만들지 않는다.)
 */
export function pullAndWait(timeoutMs: number): Promise<PullResult> {
  if (!configured()) return Promise.resolve({ status: 'off', changed: false })
  const pull = pullOnce()
  return new Promise<PullResult>((resolve) => {
    let settled = false
    const settle = (result: PullResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    const timer = setTimeout(() => settle({ status: 'failed', changed: false }), timeoutMs)
    void pull.then(settle, () => settle({ status: 'failed', changed: false }))
  })
}

async function pullPass(): Promise<PullResult> {
  // 미설정·미등록이면 네트워크를 만지지 않는다. syncEnabled가 configured를 포함한다.
  if (!(await syncEnabled())) return { status: 'off', changed: false }
  // 파괴적 작업이 도는 중에는 적용하지 않는다(설계 §3 공통 규정).
  if (suspendCount > 0) return { status: 'failed', changed: false }
  const meta = await pullMeta()
  // 서버에는 닿았지만 이 패스는 서버 상태를 로컬에 반영하지 않았다 — 곧 재기준화가
  // 통째로 갈아 끼운다. 그 전까지 "서버를 확인했다"고 말할 수 없다. 키가 거부된 패스도
  // 같다: days 조회가 정당하게 0행을 돌려주므로 여기서 안 끊으면 "확인 완료"가 된다.
  if (meta === 'rebase' || meta === 'unauthorized') return { status: 'failed', changed: false }
  // 파괴적 작업이 비행 중에 시작됐다. meta는 적용됐을 수 있으니 그 사실은 싣는다.
  if (suspendCount > 0) return { status: 'failed', changed: meta }
  // PIN 캐시 갱신. 반드시 위 'unauthorized'·'rebase' 가드 뒤 — 자리의 의미는
  // pullConfig 주석 참고. 이 줄을 가드 위로 올리면 보안 판정이 깨진다.
  const config = await pullConfig()
  return { status: 'ok', changed: (await pullDays()) || meta || config }
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
  if (!res.ok) throw await failed('meta 조회', res)
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
  let after: PageKey | null = null
  // **테이블을 끝까지 봤나.** 여기서 못 읽은 것은 `replaceFromServer`가 로컬에서
  // 지워 버린다 — 페이지 상한에 걸려 멈춘 것과 마지막 페이지를 받아 끝난 것을 구분하지
  // 않으면, 잘린 목록이 그대로 "서버 전체"로 쓰여 로컬 기록이 통째로 사라진다. 오늘의
  // 데이터(20,000행 ≈ 55년)로는 닿지 않지만, 사용자 동작 없이 로컬을 파괴하는 유일한
  // 경로라 여기만은 잘림을 실패로 다룬다(연기가 반쪽 교체보다 낫다 — 이 함수의 규정).
  let complete = false
  for (let page = 0; page < PULL_MAX_PAGES; page++) {
    const rows = await getDayPage(null, after)
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
    if (rows.length < PULL_PAGE) {
      complete = true
      break
    }
    // 이어받을 지점을 못 세웠다 = 나머지를 못 읽었다. pullDays에서는 "다음 pull이 받는다"로
    // 충분하지만 여기서는 잘림이다.
    const next = pageKeyOf(rows[rows.length - 1]!)
    if (next === null) break
    after = next
  }
  if (!complete) return null
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
 * 2. **서버 상태를 먼저 확보한다.** 설계가 요구하는 것은 "스냅샷이 **지우기**보다 앞"이지
 *    "모든 것보다 앞"이 아니다. 못 쓸 서버 상태(네트워크 실패·meta 부재/기형)를 만나면
 *    이 함수는 플래그를 다시 세우고 물러나는데, 스냅샷이 먼저면 그 물러남마다 5년치
 *    payload가 한 벌씩 `snapshots`에 쌓인다 — 보존 정책이 없는 append-only 테이블이고,
 *    트리거가 살아 있는 한 매 pull이 같은 관찰을 다시 만들어 무한히 늘어난다
 * 3. **그다음 스냅샷**. 재기준화는 오프라인 신규 기록을 자동으로 살리지 않는다(감수 목록) —
 *    이 스냅샷이 그것들의 유일한 복구 경로다. 실패하면 교체하지 않는다(throw로 빠진다)
 * 4. 스냅샷 이후 로컬 변경(= 아웃박스 새 key)이 있으면 다시 찍는다. suspendSync는 로컬
 *    쓰기를 막지 않으므로 아이가 그 사이 스프린트를 끝낼 수 있다. 최대 2회 재스냅샷,
 *    넘으면 중단하고 연기한다
 * 5. `replaceFromServer` — days·meta·stamps·아웃박스·격리 목록·커서가 한 트랜잭션에서
 *    서버 상태가 된다
 *
 * 2에서 받아 둔 서버 상태를 재스냅샷 사이에 다시 읽지 않는 것은 의도다 — 그 사이 서버가
 * 또 바뀌었다면 커서가 그 자리에 남아 다음 pull이 이어받는다.
 *
 * 실패는 플래그를 다시 세워 다음 비행 종료 훅으로 넘긴다 — 반쪽 상태를 만드는 것보다
 * 늦는 편이 낫다.
 */
export async function runRebase(): Promise<void> {
  // **가드는 첫 await보다 앞이다.** `rebaseNeeded`를 세우는 곳이 둘(pullMeta·pushDay),
  // 소비하는 비행 종료 훅도 둘이라 두 태스크가 같은 순간에 여기 들어올 수 있다 — 가드가
  // await 뒤에 있으면 둘 다 통과해 스냅샷을 두 번 찍고 로컬을 두 번 갈아 끼운다.
  if (rebasing) return
  rebasing = true
  // suspendSync를 실제로 걸었을 때만 푼다 — 아래 이른 return에서 풀면 카운터가 음수 쪽으로
  // 새어 다른 파괴적 작업의 정지가 무력해진다(resumeSync가 0에서 멈추므로 값은 안 깨지지만,
  // 남의 정지를 대신 푸는 것은 그 자체가 사고다).
  let suspended = false
  try {
    if (!(await syncEnabled())) return
    await suspendSync()
    suspended = true
    const state = await fetchServerState()
    if (!state) {
      rebaseNeeded = true
      return
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      const before = await outboxMaxKey()
      await serverSnapshot('rebase', { days: await getAllDays(), meta: await getMeta() })
      if ((await outboxMaxKey()) !== before) continue // 그 사이 로컬이 바뀌었다 — 다시 찍는다
      await replaceFromServer(state.days, state.meta, state.generation, state.cursor)
      // 이 교체가 방금 관찰들을 전부 흡수했다 — 대기 중인 플래그는 여기서 버린다.
      takeRebaseNeeded()
      rebasedNotice = true
      // 로컬 전체가 방금 바뀌었다. 지금 떠 있는 화면의 모든 수치가 낡았고, 아웃박스도
      // 비워졌으니 부모 홈의 대기 건수 배지가 이 신호 없이는 옛 숫자로 남는다
      // (`replaceFromServer`는 트랜잭션 하나로 비우고 알리지 않는다).
      notifyPullApplied()
      return
    }
    rebaseNeeded = true // 재스냅샷 2회를 넘겼다 — 중단·연기(설계 §3의 3)
  } catch {
    rebaseNeeded = true // 조용한 재시도. 다음 비행 종료 훅이 다시 집는다
  } finally {
    if (suspended) resumeSync()
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
  if (!res.ok) throw await failed('스냅샷', res)
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
  if (!res.ok) throw await failed('replace_all', res)
  // **이 기기가 방금 올린 generation에 대해 자기를 재기준화하지 않게 한다**(설계 §3).
  // `replace_all`은 서버 generation을 올리는데 `replaceAll`은 로컬 `generation`을 일부러
  // 보존한다 — 그대로 두면 다음 pull이 "다른 기기가 교체했다"로 읽어(로컬이 null이 아니므로
  // 초기값 분기로도 안 간다) 매 초기화·가져오기·되돌리기마다 자기 업로드에 맞추는 재기준화가
  // 한 번씩 돈다: 아직 못 올린 로컬 쓰기가 버려지고, 방금 복구한 아빠가 「다른 기기에서
  // 기록이 교체되어…」라는 거짓 알림을 받고, 2MB 스냅샷이 append-only 테이블에 쌓인다.
  //
  // null로 되돌리는 것이 옳은 이유: 이 기기가 그 generation의 **출처**다. null이면 다음
  // pull이 §3 「초기값」 분기를 타 서버 값을 재기준화 없이 채택한다 — "아직 관찰한 적
  // 없다"가 지금 참인 상태이고, 새 값을 여기서 추측해 적어 넣는 것보다 정직하다(RPC는
  // 새 generation을 돌려주지 않는다).
  //
  // 부르는 곳 셋(초기화·가져오기·되돌리기)이 전부 `suspendSync` 안에서 부르므로 이 쓰기도
  // 그 창 안이다 — 진행 중인 비행이 낡은 사본으로 덮을 수 없다. 게다가 `updateDeviceState`가
  // 읽기·쓰기를 한 트랜잭션에 묶으므로 다른 필드도 잃지 않는다.
  await updateDeviceState((s) => ({ ...s, generation: null }))
}

/** 새 기기 초대 코드를 발급한다(2C 설계 §5). 등록된 기기에서만 성공한다 —
 *  서버의 issue_invite가 haruchi_device()로 확인한다. */
export async function issueInvite(): Promise<string> {
  // 호출자가 syncEnabled() 게이트를 빠뜨렸을 때만 닿는다 — 조용히 빈 코드를 돌려주면
  // 아빠가 없는 코드를 새 기기에 받아 적는다(형제 함수들과 같은 이유로 실패로 알린다).
  if (!configured()) throw new Error('동기화가 설정되지 않았어요')
  const res = await req(`${SUPABASE_URL}/rest/v1/rpc/issue_invite`, {
    method: 'POST',
    body: JSON.stringify({}),
  })
  if (!res.ok) throw await failed('초대 발급', res)
  return (await res.json()) as string
}

/**
 * 코드로 이 기기를 등록한다(2C 설계 §5). 익명 호출 — 아직 키가 없다(req()의
 * x-device-key가 ''로 나가고 서버는 무시한다).
 *
 * 사용자 수준 실패(코드 불일치·만료·5회 초과·경쟁 패배)는 서버가 200 + {error}로
 * 돌려준다 — 예외로 던지면 서버의 fail_count 증가가 롤백되기 때문이다(schema.sql
 * claim_invite 주석). 그래서 반환 타입이 유니온이다: 던지는 것은 네트워크·서버
 * 장애뿐이고, {ok: false}는 사람이 고칠 수 있는 입력 문제다.
 *
 * 성공 시 키 저장 → **pull 먼저**(설계 §5 :514 — 로컬이 비어 있으니 서버 채택이
 * 곧 초기화다) → push(로컬에만 있던 기록이 있으면 그때 올라간다 — kickPush의
 * seedOutbox가 심는다).
 */
export async function claimInvite(
  code: string,
  label: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  // 호출자가 syncEnabled() 게이트를 빠뜨렸을 때만 닿는다 — 형제 함수들과 같다.
  if (!configured()) throw new Error('동기화가 설정되지 않았어요')
  const device = await getDeviceState()
  const res = await req(`${SUPABASE_URL}/rest/v1/rpc/claim_invite`, {
    method: 'POST',
    body: JSON.stringify({ p_code: code, p_device_id: device.deviceId, p_label: label }),
  })
  if (!res.ok) throw await failed('기기 등록', res)
  const body = (await res.json()) as { key?: string; error?: string }
  if (typeof body.key !== 'string' || body.key === '') {
    return { ok: false, reason: typeof body.error === 'string' ? body.error : '알 수 없는 응답' }
  }
  const key = body.key
  // **커서 셋을 함께 비운다 — 서버 관점에서 claim은 언제나 「첫 등록」이다.**
  // `claim_invite`가 이미 `devices`에 있는 id를 거부하므로, 성공했다는 것은 서버가 이
  // 기기를 처음 본다는 뜻이다. 그런데 기기 쪽에는 옛 등록의 커서가 남아 있을 수 있다
  // (README 복구 절: `devices` 행을 지우고 다시 코드를 받는 경로). 그 상태로 두면
  // `lastPulledAt`이 서버의 옛 행들을 건너뛰고, `seededAt`이 서 있어 `seedOutbox`가
  // 로컬 기록을 올릴 대상으로 심지 않는다 — 양쪽 다 조용히 기록이 비는 방향이다.
  // `generation: null`은 다음 pull이 서버 값을 「초기값」으로 채택하게 한다(설계 §3).
  await updateDeviceState((s) => ({
    ...s,
    deviceKey: key,
    lastPulledAt: null,
    generation: null,
    seededAt: null,
  }))
  await pullOnce()
  kickPush()
  return { ok: true }
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
  if (!res.ok) throw await failed('스냅샷 목록', res)
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
  if (!res.ok) throw await failed('스냅샷 조회', res)
  const rows = (await res.json()) as { payload: unknown }[]
  if (rows.length === 0) throw new Error('스냅샷이 없다')
  return rows[0]!.payload
}
