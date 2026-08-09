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
