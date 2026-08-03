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
  if (
    d['grades'] !== undefined &&
    (typeof d['grades'] !== 'object' || d['grades'] === null || Array.isArray(d['grades']))
  )
    return `days[${i}].grades가 객체가 아니다`
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
  return { ok: true, days: o['days'] as Day[], meta: meta as Meta }
}
