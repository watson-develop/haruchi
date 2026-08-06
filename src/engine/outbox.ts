/**
 * 아웃박스 표식(설계 §3). payload를 담지 않는다 — push가 현재 값을 다시 읽는다.
 * bundleAt이 없으면 push가 어느 *_at을 갱신할지 알 수 없어 LWW가 무너진다(Fable 리뷰 2).
 */
export type SyncBundle = 'sheet' | 'grades' | 'sprint'

export type OutboxEntry = {
  target: string
  bundleAt: Partial<Record<SyncBundle, string>>
  at: string
}

/** target별 하나로 접는다. bundleAt은 묶음별 최신값 합집합 — 접기가 정보를 잃으면 안 된다. */
export function foldOutbox(entries: OutboxEntry[]): OutboxEntry[] {
  const byTarget = new Map<string, OutboxEntry>()
  for (const e of entries) {
    const cur = byTarget.get(e.target)
    if (!cur) {
      byTarget.set(e.target, { target: e.target, bundleAt: { ...e.bundleAt }, at: e.at })
      continue
    }
    for (const [bundle, at] of Object.entries(e.bundleAt) as [SyncBundle, string][]) {
      if (!cur.bundleAt[bundle] || cur.bundleAt[bundle] < at) cur.bundleAt[bundle] = at
    }
    if (cur.at < e.at) cur.at = e.at
  }
  return [...byTarget.values()]
}
