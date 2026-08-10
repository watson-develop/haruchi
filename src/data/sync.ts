import { backupPayload, SCHEMA_VERSION } from '../engine/backup'
import { foldOutbox } from '../engine/outbox'
import type { SyncBundle } from '../engine/outbox'
import type { Day, Meta } from './types'
import {
  deleteOutboxThrough,
  getDay,
  getDeviceState,
  getMeta,
  getOutbox,
  putDeviceState,
  seedOutbox,
} from './db'
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
 * 한 패스. 돌려주는 값은 "실패한 target이 하나도 없었나"다.
 *
 * **한 target의 실패가 다른 target을 막지 않는다.** 예전에는 첫 실패가 throw로 루프를
 * 끊었는데, 실패한 표식은 아웃박스 맨 앞 key에 그대로 남으므로 이후 모든 패스가 같은
 * 자리에서 다시 죽었다 — 「다시 만들기」 한 번이 그 뒤의 모든 날·모든 스프린트를 영원히
 * 못 올라가게 만들 수 있었다(최종 리뷰 1). 올릴 수 있는 것은 반드시 올라가야 한다.
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
      if (entry.target === 'meta') await pushMeta()
      else await pushDay(entry.target.slice('day:'.length), entry.bundleAt)
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

/** 서버 트리거(haruchi_guard_sheet)가 거부한 응답인가. 본문을 한 번만 읽는다. */
async function isSheetImmutable(res: Response): Promise<boolean> {
  try {
    return (await res.text()).includes('sheet_immutable')
  } catch {
    return false
  }
}

/**
 * 「다시 만들기」의 인가된 경로(스키마의 rewrite_sheet RPC). 비어 있지 않은 sheet를 다른
 * 값으로 바꾸는 것은 평범한 PATCH로는 트리거가 막는다 — 그 예외는 이 RPC 하나뿐이다.
 *
 * 채점이 있는 날은 서버가 거부하는데(`sheet_rewrite_graded`), 그것은 지금 클라이언트가
 * 로컬에서 하는 판단과 **같은 규칙**이라 버그가 아니라 정상적인 결과다. 실패로 던지면
 * 표식이 남아 다음 기회에 다시 시도되고, 그동안 다른 날은 계속 올라간다.
 */
async function rewriteSheet(date: string, day: Day, rev: number): Promise<void> {
  const res = await req(`${SUPABASE_URL}/rest/v1/rpc/rewrite_sheet`, {
    method: 'POST',
    body: JSON.stringify({ p_date: date, p_payload: day, p_rev: rev }),
  })
  if (!res.ok) throw new Error(`sheet 다시 만들기 실패: ${res.status}`)
}

/** rev 프로토콜(설계 §3): INSERT rev=1, PATCH는 ?rev=eq.N + rev=N+1. upsert 금지. 3회 시도. */
async function pushDay(date: string, bundleAt: Partial<Record<SyncBundle, string>>): Promise<void> {
  const day = await getDay(date)
  if (!day) return // 표식만 남고 Day가 지워진 경우(초기화 직후) — 보낼 것이 없다
  const device = await getDeviceState()
  const stamps: Record<string, string> = {}
  if (bundleAt.sheet) stamps['sheet_at'] = bundleAt.sheet
  if (bundleAt.grades) stamps['grades_at'] = bundleAt.grades
  if (bundleAt.sprint) stamps['sprint_at'] = bundleAt.sprint

  for (let attempt = 0; attempt < 3; attempt++) {
    const cur = await req(`${SUPABASE_URL}/rest/v1/days?date=eq.${date}&select=rev`)
    if (!cur.ok) throw new Error(`days 조회 실패: ${cur.status}`)
    const rows = (await cur.json()) as { rev: number }[]

    if (rows.length === 0) {
      const res = await req(`${SUPABASE_URL}/rest/v1/days`, {
        method: 'POST',
        body: JSON.stringify({
          date,
          payload: day,
          rev: 1,
          schema_version: SCHEMA_VERSION,
          device: device.deviceId,
          ...stamps,
        }),
      })
      if (res.ok) return
      if (res.status !== 409) throw new Error(`days 생성 실패: ${res.status}`)
      continue // PK 충돌 — 다른 기기가 먼저 만듦. 재조회해 PATCH 경로로
    }

    const rev = rows[0]!.rev
    const res = await req(`${SUPABASE_URL}/rest/v1/days?date=eq.${date}&rev=eq.${rev}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        payload: day,
        rev: rev + 1,
        schema_version: SCHEMA_VERSION,
        device: device.deviceId,
        ...stamps,
      }),
    })
    if (!res.ok) {
      // 서버가 sheet 불변 트리거로 거부했다 = 서버에 이미 다른(비어 있지 않은) sheet가
      // 있다 = 이 push는 「다시 만들기」다. 인가된 경로로 우회한다.
      //
      // 판정을 클라이언트에서 다시 하지 않고 **서버의 대답**으로 하는 이유: "sheet가
      // 달라졌는가"의 주인은 트리거이고(단일 출처), jsonb는 키 순서를 보존하지 않아
      // 클라이언트의 문자열 비교는 같은 sheet도 다르다고 답한다 — 그 오판은 채점이 있는
      // 날을 rewrite_sheet로 보내 영구히 거부당하게 만든다.
      //
      // 표식에 sheet가 없는데 이 오류가 났다면 우리가 모르는 경로로 sheet가 바뀐 것이므로
      // 우회하지 않고 그대로 실패시킨다 — 재인쇄 불변식 근처에서 추측하지 않는다.
      if (bundleAt.sheet && (await isSheetImmutable(res))) {
        await rewriteSheet(date, day, rev + 1)
        const rest = { ...stamps }
        delete rest['sheet_at'] // sheet_at은 RPC가 서버에서 직접 찍는다
        if (Object.keys(rest).length === 0) return
        // 같은 표식에 실려 온 다른 묶음의 타임스탬프는 따로 올린다 — payload는 그대로라
        // 트리거에 걸리지 않는다. 이걸 빠뜨리면 스프린트·채점의 *_at이 조용히 사라져
        // 2단계 병합이 그 묶음을 "더 낡았다"로 판정한다(설계 §3의 bundles 규칙).
        const after = await req(`${SUPABASE_URL}/rest/v1/days?date=eq.${date}&rev=eq.${rev + 1}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify({ rev: rev + 2, device: device.deviceId, ...rest }),
        })
        if (!after.ok) throw new Error(`days 타임스탬프 갱신 실패: ${after.status}`)
        if (((await after.json()) as unknown[]).length > 0) return
        continue // 0행이면 그사이 rev가 바뀐 것 — 다시 읽어 처음부터
      }
      throw new Error(`days 갱신 실패: ${res.status}`)
    }
    const updated = (await res.json()) as unknown[]
    if (updated.length > 0) return // 0행이면 rev 충돌 — 재시도
  }
  throw new Error(`rev 충돌 3회: ${date}`)
}

async function pushMeta(): Promise<void> {
  const meta = await getMeta()
  const device = await getDeviceState()
  for (let attempt = 0; attempt < 3; attempt++) {
    const cur = await req(`${SUPABASE_URL}/rest/v1/meta?id=eq.1&select=rev`)
    if (!cur.ok) throw new Error(`meta 조회 실패: ${cur.status}`)
    const rows = (await cur.json()) as { rev: number }[]
    const rev = rows[0]?.rev ?? 0 // 행은 스키마가 시딩한다 — 없으면 스키마 미적용
    const res = await req(`${SUPABASE_URL}/rest/v1/meta?id=eq.1&rev=eq.${rev}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ payload: meta, rev: rev + 1, device: device.deviceId }),
    })
    if (!res.ok) throw new Error(`meta 갱신 실패: ${res.status}`)
    if (((await res.json()) as unknown[]).length > 0) return
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
  const res = await req(`${SUPABASE_URL}/rest/v1/rpc/replace_all`, {
    method: 'POST',
    body: JSON.stringify({ p_payload: payload }),
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
