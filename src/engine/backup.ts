import type { Day, Meta } from '../data/types'

/**
 * 백업 파일(설계 §10). 순수 함수만 둔다 — Blob·파일 입출력은 화면(manage.ts)의 일이다.
 * schemaVersion을 실제로 읽는 코드베이스 최초의 지점이다.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * 백업/스냅샷 스키마의 단일 주인. 2 = sprint 시도에 `sid?: string`이 추가된 버전(설계
 * 2단계). validateBackup은 1..SCHEMA_VERSION을 모두 받는다 — 구버전 파일도 구조가
 * 맞으면 통과한다. sync.ts는 이 값을 import해서 쓴다(중복 리터럴 금지).
 */
export const SCHEMA_VERSION = 2

type BackupFile = {
  app: 'haruchi'
  schemaVersion: number
  exportedAt: string
  days: Day[]
  meta: Meta
}

/**
 * 백업 내용을 객체로 만든다. 파일(serializeBackup)과 서버 스냅샷(data/sync.ts)이 **같은
 * 모양**을 쓰게 하는 단일 출처다.
 *
 * 스냅샷이 스스로 app·schemaVersion을 밝히므로 되돌리기가 validateBackup에 그대로 넣어
 * 검증할 수 있다. 예전에는 스냅샷이 `{days, meta}`만 담고 화면이 `meta.settings.schemaVersion`
 * 에서 버전을 꺼내 감쌌는데, 그 필드는 아무도 갱신하지 않는 옛 사본이라 버전을 올리는
 * 순간 기존 기기가 전부 낡은 값을 들고 있게 되어 게이트가 영구히 거부하는 상태가 된다 —
 * 한 숫자에 출처가 둘이면 안 된다.
 */
export function backupPayload(days: Day[], meta: Meta, exportedAt: string): BackupFile {
  return { app: 'haruchi', schemaVersion: SCHEMA_VERSION, exportedAt, days, meta }
}

export function serializeBackup(days: Day[], meta: Meta, exportedAt: string): string {
  // 들여쓰기 2칸: export 파일은 데이터를 들여다보는 유일한 수단이다. 5년치가 2.3MB(실측)라
  // 크기는 문제가 아니다.
  return JSON.stringify(backupPayload(days, meta, exportedAt), null, 2)
}

type BackupValidation = { ok: true; days: Day[]; meta: Meta } | { ok: false; reason: string }

function bad(reason: string): BackupValidation {
  return { ok: false, reason }
}

const isStr = (v: unknown): v is string => typeof v === 'string'
const isFin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const allOf = (v: unknown, f: (x: unknown) => boolean): boolean => Array.isArray(v) && v.every(f)

/**
 * 문장제 시도 하나(스펙 §6). **모양은 원소 단위로 깊게, 값의 목록은 보지 않는다** — pull 행도 이
 * 검사를 받고, 거부된 행은 pull 커서를 멈춰 이후 모든 날의 동기화를 막는다. 미래 버전이 새
 * 유형·단계·원인을 더해도 이 버전이 멈추면 안 된다. 화면은 이 값들을 라벨 표로만 내보낸다.
 */
function wordError(raw: unknown, j: number): string | null {
  const at = `word[${j}]`
  if (!isObj(raw)) return `${at}가 객체가 아니다`
  if (!isStr(raw['sid'])) return `${at}.sid가 문자열이 아니다`
  if (raw['answer'] !== null && !Number.isInteger(raw['answer']))
    return `${at}.answer가 정수|null이 아니다`
  if (!allOf(raw['exprs'], isStr)) return `${at}.exprs가 문자열 배열이 아니다`
  if (!isFin(raw['ms'])) return `${at}.ms가 유한수가 아니다`
  if (!allOf(raw['picks'], Number.isInteger)) return `${at}.picks가 정수 배열이 아니다`
  if (!allOf(raw['calcs'], isFin)) return `${at}.calcs가 유한수 배열이 아니다`
  const p = raw['problem']
  if (!isObj(p)) return `${at}.problem이 객체가 아니다`
  if (!isStr(p['type']) || !isStr(p['text']) || !isStr(p['unit']))
    return `${at}.problem의 type·text·unit이 문자열이 아니다`
  if (!isFin(p['answer'])) return `${at}.problem.answer가 유한수가 아니다`
  if ('trap' in p && !isStr(p['trap'])) return `${at}.problem.trap이 문자열이 아니다`
  if (!allOf(p['steps'], (s) => isObj(s) && isStr(s['expr']) && isFin(s['value'])))
    return `${at}.problem.steps 모양이 아니다`
  const stepOk = (s: unknown): boolean =>
    isObj(s) &&
    isStr(s['kind']) &&
    (!('options' in s) || allOf(s['options'], isStr)) &&
    (!('correct' in s) || Number.isInteger(s['correct'])) &&
    (!('expr' in s) || isStr(s['expr'])) &&
    (!('value' in s) || isFin(s['value']))
  if (!allOf(p['review'], stepOk)) return `${at}.problem.review 모양이 아니다`
  if (
    !allOf(
      p['wrongs'],
      (w) => isObj(w) && isStr(w['expr']) && isFin(w['value']) && isStr(w['cause']),
    )
  )
    return `${at}.problem.wrongs 모양이 아니다`
  return null
}

/** day 하나를 검사한다. 코드가 기대는 필드만 보고, 모르는 여분 필드는 통과시킨다. */
function dayError(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return '객체가 아니다'
  const d = raw as Record<string, unknown>
  if (typeof d['date'] !== 'string' || !DATE_RE.test(d['date']))
    return `date가 날짜 키(YYYY-MM-DD)가 아니다: ${JSON.stringify(d['date'])}`
  if (d['kind'] !== 'normal' && d['kind'] !== 'checkup')
    return `kind가 알 수 없는 값이다: ${JSON.stringify(d['kind'])}`
  if (!Array.isArray(d['sheet'])) return 'sheet가 배열이 아니다'
  // sheet 각 항목의 공통 뼈대만 검사. 변형별 필드는 보지 않는다(미래 호환성).
  for (let j = 0; j < d['sheet'].length; j++) {
    const item = d['sheet'][j] as Record<string, unknown> | null
    if (typeof item !== 'object' || item === null || Array.isArray(item))
      return `sheet[${j}]가 객체가 아니다`
    if (typeof item['id'] !== 'string') return `sheet[${j}].id가 문자열이 아니다`
    const kind = item['kind']
    if (kind !== 'vertical' && kind !== 'inverse' && kind !== 'strategy' && kind !== 'word')
      return `sheet[${j}].kind가 알 수 없는 값이다: ${JSON.stringify(kind)}`
  }
  if (d['sprint'] !== undefined) {
    if (!Array.isArray(d['sprint'])) return 'sprint가 배열이 아니다'
    for (let j = 0; j < d['sprint'].length; j++) {
      const a = d['sprint'][j] as Record<string, unknown> | null
      if (
        typeof a !== 'object' ||
        a === null ||
        typeof a['fact'] !== 'string' ||
        typeof a['correct'] !== 'boolean' ||
        typeof a['ms'] !== 'number' ||
        // sid는 v2에서 추가된 선택 필드다 — 있으면 문자열이어야 한다. merge.ts가 sid를
        // 세션 그룹핑 키로 쓰므로, 기형 sid가 여기를 통과하면 그쪽 전제가 깨진다.
        ('sid' in a && typeof a['sid'] !== 'string')
      )
        return `sprint[${j}]가 시도 형태({fact, correct, ms, sid?})가 아니다`
    }
  }
  if (d['grades'] !== undefined) {
    if (typeof d['grades'] !== 'object' || d['grades'] === null || Array.isArray(d['grades']))
      return 'grades가 객체가 아니다'
    // grades의 모든 값이 boolean인지 검사.
    const g = d['grades'] as Record<string, unknown>
    for (const key in g) {
      if (typeof g[key] !== 'boolean')
        return `grades["${key}"]가 boolean이 아니다: ${JSON.stringify(g[key])}`
    }
  }
  if (d['word'] !== undefined) {
    if (!Array.isArray(d['word'])) return 'word가 배열이 아니다'
    for (let j = 0; j < d['word'].length; j++) {
      const err = wordError(d['word'][j], j)
      if (err) return err
    }
  }
  return null
}

type DayValidation = { ok: true; day: Day } | { ok: false; reason: string }

/**
 * day 하나를 검사한다(pull 행 단위 검증용 — 2단계 merge가 서버에서 받은 행 하나씩을
 * 이걸로 거른다). validateBackup의 payload 단위 검사와 같은 술어(dayError)를 쓰므로
 * 파일 전체를 검증하든 서버 행 하나를 검증하든 같은 기준이 적용된다.
 */
export function validateDay(raw: unknown): DayValidation {
  const err = dayError(raw)
  if (err) return { ok: false, reason: err }
  return { ok: true, day: raw as Day }
}

/**
 * 파싱된 값(JSON.parse의 결과)을 검사한다. 실패 사유는 어디가 왜 틀렸는지 담는다 —
 * "잘못된 파일"이라는 배너만 보고는 아빠가 무엇을 고칠지 알 수 없다(설계 §11).
 */
export function validateBackup(raw: unknown): BackupValidation {
  if (typeof raw !== 'object' || raw === null) return bad('백업 파일이 객체가 아니다')
  const o = raw as Record<string, unknown>
  if (o['app'] !== 'haruchi') return bad(`app이 "haruchi"가 아니다: ${JSON.stringify(o['app'])}`)
  const v = o['schemaVersion']
  // v1도 v2도 받는다 — 상한은 SCHEMA_VERSION 하나. 라벨이 아니라 구조로 검증하므로
  // v1로 표시된 파일에 v2 전용 모양(sid)이 섞여 있어도 구조가 맞으면 통과한다.
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > SCHEMA_VERSION)
    return bad(`지원하지 않는 schemaVersion: ${JSON.stringify(v)} — 더 새 버전의 앱으로 여세요`)
  if (!Array.isArray(o['days'])) return bad('days가 배열이 아니다')
  const seen = new Set<string>()
  for (let i = 0; i < o['days'].length; i++) {
    const result = validateDay(o['days'][i])
    if (!result.ok) return bad(`days[${i}]: ${result.reason}`)
    const date = result.day.date
    if (seen.has(date)) return bad(`날짜가 중복된다: ${date}`)
    seen.add(date)
  }
  const meta = o['meta']
  if (typeof meta !== 'object' || meta === null) return bad('meta가 객체가 아니다')
  const settings = (meta as Record<string, unknown>)['settings']
  if (typeof settings !== 'object' || settings === null) return bad('meta.settings가 객체가 아니다')
  const s = settings as Record<string, unknown>

  // 코드가 실제로 읽는 settings 필드들을 검사한다. 읽지 않는 옛 키(childName 등)는 보지 않는다.
  if (typeof s['sprintCount'] !== 'number' || !Number.isFinite(s['sprintCount']))
    return bad(
      `meta.settings.sprintCount가 유한한 숫자가 아니다: ${JSON.stringify(s['sprintCount'])}`,
    )
  if (typeof s['fluentMs'] !== 'number' || !Number.isFinite(s['fluentMs']))
    return bad(`meta.settings.fluentMs가 유한한 숫자가 아니다: ${JSON.stringify(s['fluentMs'])}`)
  if (s['lastExportedAt'] !== null && typeof s['lastExportedAt'] !== 'string')
    return bad(
      `meta.settings.lastExportedAt가 문자열 또는 null이 아니다: ${JSON.stringify(s['lastExportedAt'])}`,
    )
  // 선택 필드 — 키가 없으면 옛 백업이거나 옛 기기가 올린 payload다. 있으면 형식까지 본다:
  // 문자열이기만 하면 통과시키면 손상·조작 값이 부모 홈에 "NaN월 NaN일 undefined요일"을
  // 그린다(ui.ts의 formatDate는 split('-').map(Number)만 한다). pull도 이 검증을 타므로
  // 서버를 경유한 기형 값도 여기서 막힌다.
  if (
    s['wishGrantedAt'] !== undefined &&
    s['wishGrantedAt'] !== null &&
    (typeof s['wishGrantedAt'] !== 'string' || !DATE_RE.test(s['wishGrantedAt']))
  )
    return bad(
      `meta.settings.wishGrantedAt가 YYYY-MM-DD 또는 null이 아니다: ${JSON.stringify(s['wishGrantedAt'])}`,
    )

  return { ok: true, days: o['days'] as Day[], meta: meta as Meta }
}
