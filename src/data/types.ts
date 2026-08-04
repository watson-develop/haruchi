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

export type StrategyState = {
  attempts: boolean[]
  introducedAt: string | null
  /** sheet 등장 횟수. 채점 여부와 무관 — 도입 게이트는 노출 페이스 조절이 목적이다. */
  appearances: number
  /** 마지막 등장일. "어제의 방법" 로테이션(가장 오래 안 나온 것)의 근거. */
  lastAppearedAt: string | null
}

export type Derived = {
  facts: Record<string, FactState>
  types: Record<string, TypeState>
  strategies: Record<string, StrategyState>
}

export type Settings = {
  /**
   * **읽지 않는 필드다.** 이름 입력 화면이 2026-08-04에 제거되면서(설계 §6.5) 이 값을
   * 쓸 수 있는 UI가 사라졌고, 기기에 남은 옛 값을 고칠 방법도 없어졌다. 문장제의
   * 등장인물은 `engine/word.ts`의 `WORD_NAMES`가 유일한 출처다 — 이름을 바꾸려면
   * 거기를 고친다. 두 필드는 `validateBackup`이 형식을 검사하므로 스키마 호환을 위해
   * 남는다(`derived`와 같은 취급 — 읽는 코드를 새로 만들지 말 것).
   */
  childName: string
  friendNames: string[]
  verticalCount: 8 | 6
  inverseCount: number
  sprintCount: number
  fluentMs: number
  lastExportedAt: string | null
  // schemaVersion은 backup.ts의 validateBackup이 읽는다(가져오기 게이트) — DB 쪽 마이그레이션은
  // 여전히 배선되어 있지 않다. algoVersion은 쓰이기만 하고 읽는 곳이 없다. 스키마를 바꿀 때는
  // 이 값을 올리고 validateBackup·마이그레이션을 함께 손대야 한다.
  schemaVersion: number
  algoVersion: number
}

export type Meta = {
  /**
   * 파생 상태 캐시. **배선하지 않는 것이 설계다** — 아무도 채우지 않고 아무도 읽지 않으며,
   * 화면은 매번 days에서 deriveTypes·deriveFacts로 다시 계산한다.
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
