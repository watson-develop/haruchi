import type { SprintAttempt, Day, Meta, Settings, WordAttempt } from '../data/types'
import { emptyDerived } from '../data/types'
import { stage } from './word'

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

const DAY_KNOWN = new Set(['date', 'kind', 'sheet', 'grades', 'mood', 'doneAt', 'sprint', 'word'])

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

/** grades 묶음(채점·기분·끝낸 시각)이 실려 있나. **이 술어의 주인은 여기다** — 존재
 *  우선(공통 규칙 1)과 스탬프를 채울지의 판정이 같은 정의를 봐야 한다. sync.ts가 보내기
 *  직전 스탬프를 채울 때 이걸 그대로 쓴다(사본을 두면 묶음의 필드가 하나 늘어나는 날
 *  한쪽만 "묶음 없음"으로 보고 채점이 null 스탬프를 달고 올라간다). */
export function hasGradesBundle(d: Day): boolean {
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

  // sheet — 최초 1회만. 둘 다 실재·상이면 LWW 폴백(실행 경로에선 sync.ts의 자동 채택 게이트가 먼저 가로챈다).
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
  const word = mergeWord(a.value.word, b.value.word)
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
  if (word !== undefined) value.word = word

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

/**
 * sheet 충돌 자동 해소 — 서버 sheet 채택(2026-09-30 설계 §2). 서버 트리거
 * (`haruchi_guard_sheet`)와 같은 의미다: 비어 있지 않은 서버 sheet는 바뀌지 않는다.
 *
 * sheet·grades 묶음(grades·mood·doneAt)과 그 스탬프는 **통째로 서버 것**이다 — 로컬의 어긋난
 * 채점은 서버에 채점이 없어도 버린다(다른 종이의 채점을 붙여 두지 않는다). 나머지(sprint
 * 합집합·kind 단조·모르는 필드)는 평소 병합이다. 스탬프를 지금 시각으로 찍지 않는다 — 남의
 * 값이 이 기기 시각을 업고 서버의 더 새 값을 이기게 된다.
 */
export function adoptSheet(local: Stamped<Day>, server: Stamped<Day>): Stamped<Day> {
  const merged = mergeDay(local, server)
  const value: Day = { ...merged.value, sheet: server.value.sheet }
  delete value.grades
  delete value.mood
  delete value.doneAt
  if (server.value.grades !== undefined) value.grades = server.value.grades
  if (server.value.mood !== undefined) value.mood = server.value.mood
  if (server.value.doneAt !== undefined) value.doneAt = server.value.doneAt
  return {
    value,
    at: {
      ...merged.at,
      sheetAt: server.at.sheetAt,
      sheetBy: server.at.sheetBy,
      gradesAt: server.at.gradesAt,
      gradesBy: server.at.gradesBy,
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

const STAGE_RANK = { shown: 0, answered: 1, done: 2 } as const

/** 같은 sid 두 벌 중 이길 쪽인가 — 진행 단계 → 되짚기 단계 수 → 값 직렬화 작은 쪽(전순서). */
function wordBeats(x: WordAttempt, y: WordAttempt): boolean {
  const rx = STAGE_RANK[stage(x)]
  const ry = STAGE_RANK[stage(y)]
  if (rx !== ry) return rx > ry
  const lx = x.picks.length + x.calcs.length
  const ly = y.picks.length + y.calcs.length
  if (lx !== ly) return lx > ly
  return serializeValue(x) < serializeValue(y)
}

/** sid 끝 ms가 유한수인 것 먼저 그 수 오름차순, 나머지는 뒤에 — 모두 sid 사전순으로 비김을 푼다. */
function compareWordSid(a: WordAttempt, b: WordAttempt): number {
  const tail = (s: string): number => Number(s.slice(s.lastIndexOf(':') + 1))
  const ta = tail(a.sid)
  const tb = tail(b.sid)
  // `:`를 요구한다 — 없으면 lastIndexOf가 -1이라 sid 전체를 숫자로 읽어 '12' 같은 sid가 유한수로 오인된다.
  const fa = a.sid.includes(':') && Number.isFinite(ta)
  const fb = b.sid.includes(':') && Number.isFinite(tb)
  if (fa !== fb) return fa ? -1 : 1
  if (fa && ta !== tb) return ta - tb
  return a.sid < b.sid ? -1 : a.sid > b.sid ? 1 : 0
}

/**
 * 문장제 병합(스펙 §6). 시도가 sid마다 하나라 mergeSprint의 세션 그룹 로직이 필요 없고, 같은
 * sid 두 벌의 선택 규칙이 다르다 — 같은 문항을 보여 줌·답함·되짚기 단계마다 덮어쓰므로
 * 「더 진행된 쪽」이 이긴다. sid가 문자열이라고 가정한다(validateDay가 관문).
 */
export function mergeWord(
  a: WordAttempt[] | undefined,
  b: WordAttempt[] | undefined,
): WordAttempt[] | undefined {
  if (!a?.length && !b?.length) return a === undefined && b === undefined ? undefined : (a ?? b)
  const bySid = new Map<string, WordAttempt>()
  for (const arr of [a, b])
    for (const w of arr ?? []) {
      const prev = bySid.get(w.sid)
      if (prev === undefined || wordBeats(w, prev)) bySid.set(w.sid, w)
    }
  return [...bySid.values()].sort(compareWordSid)
}

/** sprint 묶음(구구단 시도·문장제 시도)이 실려 있나. hasGradesBundle과 같은 이유로 이 술어의 주인은
 *  여기다 — db.ts·sync.ts의 표식·스탬프 판정이 같은 정의를 봐야 문장제만 한 날도 올라간다.
 *  「구구단 스프린트를 했나」를 묻는 곳(streak·checkup·facts·report·sprint 화면)은 이것을 쓰지 않는다. */
export function hasSprintBundle(d: Day): boolean {
  return (d.sprint?.length ?? 0) > 0 || (d.word?.length ?? 0) > 0
}
