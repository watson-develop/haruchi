// ─────────── 문항 ───────────

export type VerticalTag =
  | 'add2-nocarry'
  | 'sub2-noborrow'
  | 'add2-carry'
  | 'sub2-borrow'
  | 'add3-carry1'
  | 'add3-carry2'
  | 'sub3-borrow1'
  | 'sub3-borrow2'
  | 'sub-zero'

export type InverseTag = 'inverse-add' | 'inverse-sub'

export type InverseTemplate = 'a+?=c' | '?+b=c' | 'a-?=c' | '?-b=c'

export type StrategyId =
  | 'split-place'
  | 'anchor'
  | 'split-subtrahend'
  | 'count-up'
  | 'make-ten'
  | 'round-adjust'
  | 'double'
  | 'minus-one'

export type WordTag = 'mul-group' | 'mul-times'

export type StrategyStep = { text: string; blanks: number[] }

export type VerticalItem = {
  id: string
  kind: 'vertical'
  tag: VerticalTag
  a: number
  b: number
  op: '+' | '−'
  answer: number
}

export type InverseItem = {
  id: string
  kind: 'inverse'
  tag: InverseTag
  template: InverseTemplate
  a?: number
  b?: number
  c: number
  hint?: string
  answer: number
}

export type StrategyItem = {
  id: string
  kind: 'strategy'
  tag: StrategyId
  a: number
  b: number
  op: '+' | '−'
  steps: StrategyStep[]
  answer: number
}

export type WordItem = {
  id: string
  kind: 'word'
  tag: WordTag
  text: string
  needsDrawing: boolean
  expression: string
  unit: string
  answer: number
}

export type SheetItem = VerticalItem | InverseItem | StrategyItem | WordItem

// ─────────── 로그 ───────────

export type Mood = 'easy' | 'ok' | 'hard'

export type SprintAttempt = { fact: string; correct: boolean; ms: number }

export type Day = {
  date: string
  kind: 'normal' | 'checkup'
  sheet: SheetItem[]
  grades?: Record<string, boolean>
  sprint?: SprintAttempt[]
  mood?: Mood
  doneAt?: string
}

// ─────────── 파생 상태 ───────────

export type FactState = {
  status: 'new' | 'learning' | 'fluent'
  medianMs: number | null
  streak: number
  interval: 1 | 3 | 7 | 14
  nextDue: string | null
}

/** 최근 시도의 정오답 이력. 오래된 것이 앞. */
export type TypeState = { attempts: boolean[] }

export type StrategyState = { attempts: boolean[]; introducedAt: string | null }

export type Derived = {
  facts: Record<string, FactState>
  types: Record<string, TypeState>
  strategies: Record<string, StrategyState>
}

export type Settings = {
  childName: string
  friendNames: string[]
  verticalCount: 8 | 6
  inverseCount: number
  sprintCount: number
  fluentMs: number
  lastExportedAt: string | null
  // schemaVersion·algoVersion은 DB에 쓰이기만 하고 읽는 곳이 없다. 마이그레이션은
  // 아직 배선되어 있지 않다 — Phase 2에서 배선. 있다고 가정하고 스키마를 바꾸면 안 된다.
  schemaVersion: number
  algoVersion: number
}

export type Meta = {
  /**
   * 파생 상태 캐시. Phase 1에서는 아무도 채우지 않고 아무도 읽지 않는다 —
   * 화면은 매번 deriveTypes(days)로 로그에서 다시 계산한다. Phase 2에서 배선.
   * 배선하더라도 derived는 언제든 버리고 다시 만들 수 있는 캐시여야 한다.
   */
  derived: Derived
  settings: Settings
}

// ─────────── 기본값 ───────────

export const DEFAULT_SETTINGS: Settings = {
  childName: '',
  friendNames: ['지호', '민아'],
  verticalCount: 8,
  inverseCount: 2,
  sprintCount: 30,
  fluentMs: 2500,
  lastExportedAt: null,
  schemaVersion: 1,
  algoVersion: 1,
}

export function emptyDerived(): Derived {
  return { facts: {}, types: {}, strategies: {} }
}
