import type { Day, Meta } from '../data/types'

/**
 * 백업 파일(설계 §10). 순수 함수만 둔다 — Blob·파일 입출력은 화면(report.ts)의 일이다.
 * schemaVersion을 실제로 읽는 코드베이스 최초의 지점이다.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function serializeBackup(days: Day[], meta: Meta, exportedAt: string): string {
  // 들여쓰기 2칸: export 파일은 데이터를 들여다보는 유일한 수단이다. 5년치가 2.3MB(실측)라
  // 크기는 문제가 아니다.
  return JSON.stringify({ app: 'haruchi', schemaVersion: 1, exportedAt, days, meta }, null, 2)
}

export type BackupValidation = { ok: true; days: Day[]; meta: Meta } | { ok: false; reason: string }

function bad(reason: string): BackupValidation {
  return { ok: false, reason }
}

/** days[i] 하나를 검사한다. 코드가 기대는 필드만 보고, 모르는 여분 필드는 통과시킨다. */
function dayError(raw: unknown, i: number): string | null {
  if (typeof raw !== 'object' || raw === null) return `days[${i}]가 객체가 아니다`
  const d = raw as Record<string, unknown>
  if (typeof d['date'] !== 'string' || !DATE_RE.test(d['date']))
    return `days[${i}].date가 날짜 키(YYYY-MM-DD)가 아니다: ${JSON.stringify(d['date'])}`
  if (d['kind'] !== 'normal' && d['kind'] !== 'checkup')
    return `days[${i}].kind가 알 수 없는 값이다: ${JSON.stringify(d['kind'])}`
  if (!Array.isArray(d['sheet'])) return `days[${i}].sheet가 배열이 아니다`
  // sheet 각 항목의 공통 뼈대만 검사. 변형별 필드는 보지 않는다(미래 호환성).
  for (let j = 0; j < d['sheet'].length; j++) {
    const item = d['sheet'][j] as Record<string, unknown> | null
    if (typeof item !== 'object' || item === null || Array.isArray(item))
      return `days[${i}].sheet[${j}]가 객체가 아니다`
    if (typeof item['id'] !== 'string')
      return `days[${i}].sheet[${j}].id가 문자열이 아니다`
    const kind = item['kind']
    if (kind !== 'vertical' && kind !== 'inverse' && kind !== 'strategy' && kind !== 'word')
      return `days[${i}].sheet[${j}].kind가 알 수 없는 값이다: ${JSON.stringify(kind)}`
  }
  if (d['sprint'] !== undefined) {
    if (!Array.isArray(d['sprint'])) return `days[${i}].sprint가 배열이 아니다`
    for (let j = 0; j < d['sprint'].length; j++) {
      const a = d['sprint'][j] as Record<string, unknown> | null
      if (
        typeof a !== 'object' ||
        a === null ||
        typeof a['fact'] !== 'string' ||
        typeof a['correct'] !== 'boolean' ||
        typeof a['ms'] !== 'number'
      )
        return `days[${i}].sprint[${j}]가 시도 형태({fact, correct, ms})가 아니다`
    }
  }
  if (d['grades'] !== undefined) {
    if (typeof d['grades'] !== 'object' || d['grades'] === null || Array.isArray(d['grades']))
      return `days[${i}].grades가 객체가 아니다`
    // grades의 모든 값이 boolean인지 검사.
    const g = d['grades'] as Record<string, unknown>
    for (const key in g) {
      if (typeof g[key] !== 'boolean')
        return `days[${i}].grades["${key}"]가 boolean이 아니다: ${JSON.stringify(g[key])}`
    }
  }
  return null
}

/**
 * 파싱된 값(JSON.parse의 결과)을 검사한다. 실패 사유는 어디가 왜 틀렸는지 담는다 —
 * "잘못된 파일"이라는 배너만 보고는 아빠가 무엇을 고칠지 알 수 없다(설계 §11).
 */
export function validateBackup(raw: unknown): BackupValidation {
  if (typeof raw !== 'object' || raw === null) return bad('백업 파일이 객체가 아니다')
  const o = raw as Record<string, unknown>
  if (o['app'] !== 'haruchi') return bad(`app이 "haruchi"가 아니다: ${JSON.stringify(o['app'])}`)
  if (o['schemaVersion'] !== 1)
    return bad(
      `지원하지 않는 schemaVersion: ${JSON.stringify(o['schemaVersion'])} — 더 새 버전의 앱으로 여세요`,
    )
  if (!Array.isArray(o['days'])) return bad('days가 배열이 아니다')
  const seen = new Set<string>()
  for (let i = 0; i < o['days'].length; i++) {
    const err = dayError(o['days'][i], i)
    if (err) return bad(err)
    const date = (o['days'][i] as Day).date
    if (seen.has(date)) return bad(`날짜가 중복된다: ${date}`)
    seen.add(date)
  }
  const meta = o['meta']
  if (typeof meta !== 'object' || meta === null) return bad('meta가 객체가 아니다')
  const settings = (meta as Record<string, unknown>)['settings']
  if (typeof settings !== 'object' || settings === null) return bad('meta.settings가 객체가 아니다')
  const s = settings as Record<string, unknown>

  // 코드가 실제로 읽는 settings 필드들을 검사한다.
  if (typeof s['childName'] !== 'string') return bad('meta.settings.childName이 문자열이 아니다')
  if (!Array.isArray(s['friendNames'])) return bad('meta.settings.friendNames가 배열이 아니다')
  for (let j = 0; j < (s['friendNames'] as unknown[]).length; j++) {
    if (typeof (s['friendNames'] as unknown[])[j] !== 'string')
      return bad(`meta.settings.friendNames[${j}]가 문자열이 아니다`)
  }
  if (typeof s['verticalCount'] !== 'number' || !Number.isFinite(s['verticalCount']))
    return bad(`meta.settings.verticalCount가 유한한 숫자가 아니다: ${JSON.stringify(s['verticalCount'])}`)
  if (typeof s['inverseCount'] !== 'number' || !Number.isFinite(s['inverseCount']))
    return bad(`meta.settings.inverseCount가 유한한 숫자가 아니다: ${JSON.stringify(s['inverseCount'])}`)
  if (typeof s['sprintCount'] !== 'number' || !Number.isFinite(s['sprintCount']))
    return bad(`meta.settings.sprintCount가 유한한 숫자가 아니다: ${JSON.stringify(s['sprintCount'])}`)
  if (typeof s['fluentMs'] !== 'number' || !Number.isFinite(s['fluentMs']))
    return bad(`meta.settings.fluentMs가 유한한 숫자가 아니다: ${JSON.stringify(s['fluentMs'])}`)
  if (s['lastExportedAt'] !== null && typeof s['lastExportedAt'] !== 'string')
    return bad(`meta.settings.lastExportedAt가 문자열 또는 null이 아니다: ${JSON.stringify(s['lastExportedAt'])}`)

  return { ok: true, days: o['days'] as Day[], meta: meta as Meta }
}
