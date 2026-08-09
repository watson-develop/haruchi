import type { SprintAttempt } from '../data/types'

export type BundleStamps = {
  sheetAt: string | null
  sheetBy: string
  gradesAt: string | null
  gradesBy: string
  sprintAt: string | null
  sprintBy: string
  settingsAt?: string | null
  settingsBy?: string
}
export type Stamped<T> = { value: T; at: BundleStamps }

export const EMPTY_STAMPS: BundleStamps = {
  sheetAt: null,
  sheetBy: '',
  gradesAt: null,
  gradesBy: '',
  sprintAt: null,
  sprintBy: '',
}

/** 값 직렬화(설계 §1): 객체 키만 정렬, 배열 원소 순서 보존. jsonb 왕복(키 재배열)에 안정. */
export function serializeValue(v: unknown): string {
  if (Array.isArray(v)) return '[' + v.map(serializeValue).join(',') + ']'
  if (v !== null && typeof v === 'object') {
    const o = v as Record<string, unknown>
    return (
      '{' +
      Object.keys(o)
        .sort()
        .map((k) => JSON.stringify(k) + ':' + serializeValue(o[k]))
        .join(',') +
      '}'
    )
  }
  return v === undefined ? 'undefined' : JSON.stringify(v)
}

export function structuralEqual(a: unknown, b: unknown): boolean {
  return serializeValue(a) === serializeValue(b)
}

/** FNV-1a 64비트. 레거시 sid가 시도 30개의 직렬화 전문을 다 담으면 하루 payload가 수십 KB
 *  커지므로 해시로 줄인다 — 내용의 결정적 함수라는 성질은 그대로다(충돌 2^-64, 가족 규모 무시). */
function fnv1a64(s: string): string {
  let h = 0xcbf29ce484222325n
  for (let i = 0; i < s.length; i++) {
    h ^= BigInt(s.charCodeAt(i))
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn
  }
  return h.toString(16).padStart(16, '0')
}

/** 세션 정규화 키(설계 §1). 원소 정렬은 키 계산에만 — 저장 배열은 절대 정렬하지 않는다. */
export function legacyKey(run: SprintAttempt[]): string {
  return fnv1a64(
    run
      .map((a) => serializeValue(a))
      .sort()
      .join('\n'),
  )
}

export function materializeSids(attempts: SprintAttempt[]): SprintAttempt[] {
  if (attempts.every((a) => typeof a.sid === 'string')) return attempts
  const out: SprintAttempt[] = []
  let i = 0
  while (i < attempts.length) {
    if (typeof attempts[i]!.sid === 'string') {
      out.push(attempts[i]!)
      i++
      continue
    }
    let j = i
    while (j < attempts.length && typeof attempts[j]!.sid !== 'string') j++
    const sid = 'legacy:' + legacyKey(attempts.slice(i, j))
    for (const a of attempts.slice(i, j)) out.push({ ...a, sid })
    i = j
  }
  return out
}

type Group = { sid: string; attempts: SprintAttempt[] }

/** 그룹 전순서(설계 §1): legacy(sid 사전순) → 일반(시작 ms, deviceId) → 기형(sid 사전순). */
function compareGroups(a: Group, b: Group): number {
  const rank = (g: Group): number => {
    if (g.sid.startsWith('legacy:')) return 0
    const ms = Number(g.sid.slice(g.sid.lastIndexOf(':') + 1))
    return Number.isFinite(ms) ? 1 : 2
  }
  const ra = rank(a),
    rb = rank(b)
  if (ra !== rb) return ra - rb
  if (ra === 1) {
    const ms = (g: Group): number => Number(g.sid.slice(g.sid.lastIndexOf(':') + 1))
    if (ms(a) !== ms(b)) return ms(a) - ms(b)
  }
  return a.sid < b.sid ? -1 : a.sid > b.sid ? 1 : 0
}

export function mergeSprint(
  a: SprintAttempt[] | undefined,
  b: SprintAttempt[] | undefined,
): SprintAttempt[] | undefined {
  if (!a?.length && !b?.length) return a === undefined && b === undefined ? undefined : (a ?? b)
  // sid는 세션 정체성이다 — "같은 sid = 같은 세션 = 한 벌만". 두 입력이 같은 sid를
  // 서로 다른 순서로 들고 있으면(legacyKey 동일) 값 직렬화 사전순 작은 쪽을 남긴다.
  const perSid = new Map<string, SprintAttempt[]>()
  for (const arr of [a, b]) {
    if (!arr?.length) continue
    const local = new Map<string, SprintAttempt[]>()
    for (const att of materializeSids(arr)) {
      if (!local.has(att.sid!)) local.set(att.sid!, [])
      local.get(att.sid!)!.push(att)
    }
    for (const [sid, atts] of local) {
      const prev = perSid.get(sid)
      if (!prev || serializeValue(atts) < serializeValue(prev)) perSid.set(sid, atts)
    }
  }
  return [...perSid.entries()]
    .map(([sid, attempts]) => ({ sid, attempts }))
    .sort(compareGroups)
    .flatMap((g) => g.attempts)
}
