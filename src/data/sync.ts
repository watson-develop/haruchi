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
} from './db'
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './sync-config'

const SCHEMA_VERSION = 1

async function headers(): Promise<Record<string, string>> {
  const device = await getDeviceState()
  return {
    apikey: SUPABASE_ANON_KEY,
    'x-device-key': device.deviceKey ?? '',
    'Content-Type': 'application/json',
  }
}

/**
 * 설정이 비어 있으면 어떤 요청도 내지 않는다. SUPABASE_URL이 ''이면 fetch 경로가
 * 상대 주소가 되어 배포 사이트 자신에게 요청이 날아간다 — 서버가 준비되기 전에
 * 배포돼도 이 브랜치가 오늘과 똑같이 동작한다는 보장이 여기서 나온다.
 * "설정됐다"의 정의는 여기 하나뿐이다 — syncEnabled도 이걸 그대로 쓴다.
 */
function configured(): boolean {
  return SUPABASE_URL !== '' && SUPABASE_ANON_KEY !== ''
}

export async function syncEnabled(): Promise<boolean> {
  if (!configured()) return false
  return (await getDeviceState()).deviceKey !== null
}

/** GET이 2xx면 서버가 깨어 있고 키가 유효하다. navigator.onLine으로는 알 수 없는 정보다. */
export async function serverOnline(): Promise<boolean> {
  if (!configured()) return false // 미설정은 "오프라인"이 정답이다 — 조회할 서버가 없다
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/meta?select=id`, { headers: await headers() })
    return res.ok
  } catch {
    return false
  }
}

let pushing = false

/**
 * 아웃박스를 비운다. 단일 비행 — 도는 중의 재요청은 `pushing`에 걸려 no-op이 된다. 그
 * no-op된 요청이 대표하던 새 표식은 사라지지 않지만(setter가 원래 표식을 남겼으므로),
 * 이 비행이 그 표식을 반영하지 못한 채 끝날 수 있다 — 그래서 한 패스가 **성공적으로**
 * 끝나면 아웃박스가 여전히 안 비었는지 한 번 더 확인해 한 패스만 더 돌린다(while이
 * 아니다). 실패한 패스 뒤에는 재확인하지 않는다 — 실패한 push를 곧바로 다시 돌리면
 * 오프라인일 때 요청이 폭주한다; 표식이 그대로 남는 것 자체가 실패를 표현하는 방식이다
 * (§3 조용한 재시도). `pushing`은 재확인 패스가 끝날 때까지 true를 유지해 그 사이의
 * kickPush() 호출도 계속 한 비행으로 묶인다.
 */
export function kickPush(): void {
  if (pushing) return
  pushing = true
  void (async () => {
    try {
      await pushOutbox()
      const remaining = await getOutbox()
      if (remaining.length > 0) await pushOutbox() // 재확인 — 최대 한 번만
    } catch {
      // 실패는 아웃박스에 남는 것으로 표현된다 — 여기서 알리지 않는다(§3 조용한 재시도)
    } finally {
      pushing = false
    }
  })()
}

async function pushOutbox(): Promise<void> {
  if (!(await syncEnabled())) return
  const raw = await getOutbox()
  if (raw.length === 0) return
  // push 시작 시점의 최대 key — 이후 생긴 표식은 지우지 않는다(설계 §3, Fable 리뷰 5)
  const maxKey = raw[raw.length - 1]!.key
  const folded = foldOutbox(raw)
  for (const entry of folded) {
    if (entry.target === 'meta') await pushMeta()
    else await pushDay(entry.target.slice('day:'.length), entry.bundleAt)
    await deleteOutboxThrough(entry.target, maxKey)
  }
  const device = await getDeviceState()
  await putDeviceState({ ...device, lastSyncAt: new Date().toISOString() })
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
    const cur = await fetch(`${SUPABASE_URL}/rest/v1/days?date=eq.${date}&select=rev`, {
      headers: await headers(),
    })
    if (!cur.ok) throw new Error(`days 조회 실패: ${cur.status}`)
    const rows = (await cur.json()) as { rev: number }[]

    if (rows.length === 0) {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/days`, {
        method: 'POST',
        headers: await headers(),
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
    const res = await fetch(`${SUPABASE_URL}/rest/v1/days?date=eq.${date}&rev=eq.${rev}`, {
      method: 'PATCH',
      headers: { ...(await headers()), Prefer: 'return=representation' },
      body: JSON.stringify({
        payload: day,
        rev: rev + 1,
        schema_version: SCHEMA_VERSION,
        device: device.deviceId,
        ...stamps,
      }),
    })
    if (!res.ok) throw new Error(`days 갱신 실패: ${res.status}`)
    const updated = (await res.json()) as unknown[]
    if (updated.length > 0) return // 0행이면 rev 충돌 — 재시도
  }
  throw new Error(`rev 충돌 3회: ${date}`)
}

async function pushMeta(): Promise<void> {
  const meta = await getMeta()
  const device = await getDeviceState()
  for (let attempt = 0; attempt < 3; attempt++) {
    const cur = await fetch(`${SUPABASE_URL}/rest/v1/meta?id=eq.1&select=rev`, {
      headers: await headers(),
    })
    if (!cur.ok) throw new Error(`meta 조회 실패: ${cur.status}`)
    const rows = (await cur.json()) as { rev: number }[]
    const rev = rows[0]?.rev ?? 0 // 행은 스키마가 시딩한다 — 없으면 스키마 미적용
    const res = await fetch(`${SUPABASE_URL}/rest/v1/meta?id=eq.1&rev=eq.${rev}`, {
      method: 'PATCH',
      headers: { ...(await headers()), Prefer: 'return=representation' },
      body: JSON.stringify({ payload: meta, rev: rev + 1, device: device.deviceId }),
    })
    if (!res.ok) throw new Error(`meta 갱신 실패: ${res.status}`)
    if (((await res.json()) as unknown[]).length > 0) return
  }
  throw new Error('meta rev 충돌 3회')
}

export async function serverSnapshot(
  reason: 'reset' | 'import',
  payload: { days: Day[]; meta: Meta },
): Promise<{ id: number; at: string; dayCount: number }> {
  // 호출자는 항상 syncEnabled()로 먼저 게이트한다 — 여기 닿는다는 것은 그 게이트를
  // 빠뜨렸다는 뜻이다. 조용히 성공한 척하면(빈 스냅샷 등) 백업이 있다고 잘못 믿게 되므로
  // 크게 실패시킨다.
  if (!configured()) throw new Error('동기화가 설정되지 않았어요')
  const device = await getDeviceState()
  const res = await fetch(`${SUPABASE_URL}/rest/v1/snapshots`, {
    method: 'POST',
    headers: { ...(await headers()), Prefer: 'return=representation' },
    body: JSON.stringify({
      device: device.deviceId,
      reason,
      day_count: payload.days.length,
      payload,
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
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/replace_all`, {
    method: 'POST',
    headers: await headers(),
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
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/snapshots?select=id,at,reason,day_count&order=id.desc&limit=${limit}`,
    { headers: await headers() },
  )
  if (!res.ok) throw new Error(`스냅샷 목록 실패: ${res.status}`)
  const rows = (await res.json()) as { id: number; at: string; reason: string; day_count: number }[]
  return rows.map((r) => ({ id: r.id, at: r.at, reason: r.reason, dayCount: r.day_count }))
}

export async function getSnapshotPayload(id: number): Promise<{ days: Day[]; meta: Meta }> {
  // 호출자가 syncEnabled() 게이트를 빠뜨렸을 때만 닿는다.
  if (!configured()) throw new Error('동기화가 설정되지 않았어요')
  const res = await fetch(`${SUPABASE_URL}/rest/v1/snapshots?id=eq.${id}&select=payload`, {
    headers: await headers(),
  })
  if (!res.ok) throw new Error(`스냅샷 조회 실패: ${res.status}`)
  const rows = (await res.json()) as { payload: { days: Day[]; meta: Meta } }[]
  if (rows.length === 0) throw new Error('스냅샷이 없다')
  return rows[0]!.payload
}
