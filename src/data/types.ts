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
  // 곱셈 전략(double·minus-one)을 담기 위해 '×'를 더한다 — 유니온 확장은 기존
  // 저장 데이터를 전부 통과시키므로 마이그레이션이 필요 없다(Phase 4 Task 5).
  op: '+' | '−' | '×'
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

// sid: 세션 정체성(engine/merge.ts가 쓴다). 세션 하나에 하나, 없으면 병합 시
// `legacy:<hash>`로 물질화된다(기존 아이패드 기록에는 아직 없다).
export type SprintAttempt = { fact: string; correct: boolean; ms: number; sid?: string }

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

/** 배선하지 않는 `derived`와 보존된 데이터의 모양으로만 남아 있다. */
export type StrategyState = {
  attempts: boolean[]
  introducedAt: string | null
  appearances: number
  lastAppearedAt: string | null
}

export type Derived = {
  facts: Record<string, FactState>
  types: Record<string, TypeState>
  strategies: Record<string, StrategyState>
}

export type Settings = {
  sprintCount: number
  fluentMs: number
  lastExportedAt: string | null
  /**
   * 아빠가 소원을 들어준 날(`dayKey` 형식) — 없거나 null이면 아직이다.
   *
   * **파생이 아니다.** 로그를 다시 읽어 만들 수 없는, 아빠가 앱 밖에서 한 행동의 기록이라
   * derived 비배선 원칙의 예외가 아니라 애초에 대상이 아니다. 이 값이 있으면 램프는
   * 트로피가 되고 지니는 소원을 다시 약속하지 않는다(engine/facts.ts의 genieState).
   *
   * 선택 필드다 — 옛 기기의 저장본과 옛 백업·서버 payload에는 키가 없고 getMeta는
   * 기본값을 채우지 않는다. 읽는 쪽은 전부 `?? null`을 거친다. 형식은 validateBackup이
   * 지킨다(빈 문자열도 거부 — formatDate가 NaN을 그린다).
   */
  wishGrantedAt?: string | null
}

export type Meta = {
  /**
   * 파생 상태 캐시. **배선하지 않는 것이 설계다** — 아무도 채우지 않고 아무도 읽지 않으며,
   * 화면은 매번 days에서 deriveFacts로 다시 계산한다.
   * 리포트(Phase 3)도 저장 없이 매번 재계산한다 — 그대로다.
   *
   * 미룬 일이 아니라 지키는 성질이다: derived는 로그에서 언제든 다시 만들 수 있는
   * 버릴 수 있는 캐시이고, 그 덕분에 유창 기준이나 간격 사다리를 고치면 과거 기록이
   * 새 규칙으로 다시 계산되어 소급 적용된다. 마이그레이션 없이 규칙을 바꿀 수 있는
   * 이유가 오직 이것뿐이다. 여기에 값을 저장하는 순간 규칙을 바꿀 때마다 저장된
   * 파생값을 옮겨야 하고, 옮기지 못한 기록은 옛 규칙으로 굳는다.
   *
   * 필드는 스키마 호환을 위해 남아 있을 뿐이다 — 읽는 코드를 만들지 말 것.
   */
  derived: Derived
  settings: Settings
}

// ─────────── 기본값 ───────────

export const DEFAULT_SETTINGS: Settings = {
  sprintCount: 30,
  fluentMs: 2500,
  lastExportedAt: null,
  wishGrantedAt: null,
}

export function emptyDerived(): Derived {
  return { facts: {}, types: {}, strategies: {} }
}
