import type { SprintAttempt, Day, Meta, Settings } from '../data/types'
import { emptyDerived } from '../data/types'

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

const DAY_KNOWN = new Set(['date', 'kind', 'sheet', 'grades', 'mood', 'doneAt', 'sprint'])

type Side = 'a' | 'b'
/** 공통 규칙 2(설계 §1): null at 패배 → by 코드포인트 큰 쪽 → 값 직렬화 작은 쪽. */
function lww(
  aAt: string | null,
  aBy: string,
  aSer: string,
  bAt: string | null,
  bBy: string,
  bSer: string,
): Side {
  if (aAt !== bAt) {
    if (aAt === null) return 'b'
    if (bAt === null) return 'a'
    return aAt > bAt ? 'a' : 'b'
  }
  if (aBy !== bBy) return aBy > bBy ? 'a' : 'b'
  return aSer <= bSer ? 'a' : 'b'
}

function hasGradesBundle(d: Day): boolean {
  return (
    (d.grades !== undefined && Object.keys(d.grades).length > 0) ||
    d.mood !== undefined ||
    d.doneAt !== undefined
  )
}

export function sheetConflict(a: Day, b: Day): boolean {
  return a.sheet.length > 0 && b.sheet.length > 0 && !structuralEqual(a.sheet, b.sheet)
}

export function mergeDay(a: Stamped<Day>, b: Stamped<Day>): Stamped<Day> {
  if (a.value.date !== b.value.date)
    throw new Error(`mergeDay: 다른 날짜 ${a.value.date} vs ${b.value.date}`)

  // sheet — 최초 1회만. 둘 다 실재·상이면 LWW 폴백(실행 경로에선 격리가 먼저 가로챈다).
  const aHasSheet = a.value.sheet.length > 0
  const bHasSheet = b.value.sheet.length > 0
  let sheetSide: Side
  if (aHasSheet !== bHasSheet) sheetSide = aHasSheet ? 'a' : 'b'
  else
    sheetSide = lww(
      a.at.sheetAt,
      a.at.sheetBy,
      serializeValue(a.value.sheet),
      b.at.sheetAt,
      b.at.sheetBy,
      serializeValue(b.value.sheet),
    )
  const sheetW = sheetSide === 'a' ? a : b

  // grades 묶음 — 존재 우선, 둘 다 있으면 LWW.
  const aHasG = hasGradesBundle(a.value)
  const bHasG = hasGradesBundle(b.value)
  let gradesSide: Side
  if (aHasG !== bHasG) gradesSide = aHasG ? 'a' : 'b'
  else
    gradesSide = lww(
      a.at.gradesAt,
      a.at.gradesBy,
      serializeValue([a.value.grades, a.value.mood, a.value.doneAt]),
      b.at.gradesAt,
      b.at.gradesBy,
      serializeValue([b.value.grades, b.value.mood, b.value.doneAt]),
    )
  const gradesW = gradesSide === 'a' ? a : b

  const sprint = mergeSprint(a.value.sprint, b.value.sprint)
  const sprintAt =
    [a.at.sprintAt, b.at.sprintAt]
      .filter((x): x is string => x !== null)
      .sort()
      .pop() ?? null
  const sprintBySide = lww(a.at.sprintAt, a.at.sprintBy, '', b.at.sprintAt, b.at.sprintBy, '')

  // 모르는 필드 — 필드 단위(설계 §1 규칙표): 있으면 남고, 둘 다면 값 직렬화 사전순 작은 쪽.
  // **스탬프를 보지 않는다.** 레코드의 묶음 스탬프 최대값은 그 필드의 스탬프가 아니고
  // 병합에 대해 단조도 아니라, 스탬프를 섞으면 같은 절이 요구하는 결합이 깨진다.
  const unknown: Record<string, unknown> = {}
  const aRec = a.value as unknown as Record<string, unknown>
  const bRec = b.value as unknown as Record<string, unknown>
  for (const k of new Set([...Object.keys(aRec), ...Object.keys(bRec)])) {
    if (DAY_KNOWN.has(k)) continue
    const inA = k in aRec
    const inB = k in bRec
    if (inA && !inB) unknown[k] = aRec[k]
    else if (!inA && inB) unknown[k] = bRec[k]
    else {
      const side = lww(null, '', serializeValue(aRec[k]), null, '', serializeValue(bRec[k]))
      unknown[k] = side === 'a' ? aRec[k] : bRec[k]
    }
  }

  const value: Day = {
    ...unknown,
    date: a.value.date,
    kind: a.value.kind === 'checkup' || b.value.kind === 'checkup' ? 'checkup' : 'normal',
    sheet: sheetW.value.sheet,
  } as Day
  if (hasGradesBundle(gradesW.value)) {
    if (gradesW.value.grades !== undefined) value.grades = gradesW.value.grades
    if (gradesW.value.mood !== undefined) value.mood = gradesW.value.mood
    if (gradesW.value.doneAt !== undefined) value.doneAt = gradesW.value.doneAt
  }
  if (sprint !== undefined) value.sprint = sprint

  return {
    value,
    at: {
      sheetAt: sheetW.at.sheetAt,
      sheetBy: sheetW.at.sheetBy,
      gradesAt: gradesW.at.gradesAt,
      gradesBy: gradesW.at.gradesBy,
      sprintAt,
      sprintBy: (sprintBySide === 'a' ? a : b).at.sprintBy,
    },
  }
}

const META_KNOWN = new Set(['derived', 'settings'])

export function mergeMeta(a: Stamped<Meta>, b: Stamped<Meta>): Stamped<Meta> {
  const strip = (s: Settings): Omit<Settings, 'lastExportedAt'> => {
    const { lastExportedAt: _drop, ...rest } = s
    return rest
  }
  const side = lww(
    a.at.settingsAt ?? null,
    a.at.settingsBy ?? '',
    serializeValue(strip(a.value.settings)),
    b.at.settingsAt ?? null,
    b.at.settingsBy ?? '',
    serializeValue(strip(b.value.settings)),
  )
  const w = side === 'a' ? a : b
  const unknown: Record<string, unknown> = {}
  const aRec = a.value as unknown as Record<string, unknown>
  const bRec = b.value as unknown as Record<string, unknown>
  for (const k of new Set([...Object.keys(aRec), ...Object.keys(bRec)])) {
    if (META_KNOWN.has(k)) continue
    if (k in aRec && !(k in bRec)) unknown[k] = aRec[k]
    else if (!(k in aRec) && k in bRec) unknown[k] = bRec[k]
    else {
      // mergeDay와 같은 규칙 — 스탬프를 보지 않는 값 직렬화 사전순.
      const s = lww(null, '', serializeValue(aRec[k]), null, '', serializeValue(bRec[k]))
      unknown[k] = s === 'a' ? aRec[k] : bRec[k]
    }
  }
  return {
    value: { ...unknown, derived: emptyDerived(), settings: { ...w.value.settings } } as Meta,
    at: { ...EMPTY_STAMPS, settingsAt: w.at.settingsAt ?? null, settingsBy: w.at.settingsBy ?? '' },
  }
}
