// ─────────── 문항 ───────────

/**
 * 종이 문제지 문항 — **보존된 과거 기록의 모양일 뿐이다.** 종이는 2026-09-30 은퇴했고
 * (`specs/2026-09-30-retire-paper-sheet-design.md`) 새 문항을 만드는 코드가 없다. 변형별
 * 필드(세로셈 a·b·op, □ 채우기 template, 전략 steps, 문장제 text…)는 아무도 읽지 않고
 * `validateBackup`도 검사하지 않으므로 타입으로 나누지 않는다. 필드의 원래 정의가 필요하면
 * git 이력의 이 파일을 본다.
 */
export type SheetItem = {
  id: string
  kind: 'vertical' | 'inverse' | 'strategy' | 'word'
  [field: string]: unknown
}

// ─────────── 로그 ───────────

export type Mood = 'easy' | 'ok' | 'hard'

// sid: 세션 정체성(engine/merge.ts가 쓴다). 세션 하나에 하나, 없으면 병합 시
// `legacy:<hash>`로 물질화된다(기존 아이패드 기록에는 아직 없다).
export type SprintAttempt = { fact: string; correct: boolean; ms: number; sid?: string }

// ─────────── 문장제 (specs/2026-09-30-word-problems-design.md) ───────────

/**
 * 되짚기 한 단계. 저장본의 `kind`는 미래 버전이 새 값을 더할 수 있어 읽는 쪽은 모르는
 * `kind`를 건너뛴다(스펙 §6 검증 — 값 목록을 대조하지 않는다).
 */
export type ReviewStep =
  | { kind: 'story'; correct: number }
  | { kind: 'expr'; options: string[]; correct: number }
  | { kind: 'calc'; expr: string; value: number }

/** 예상 오답. `cause`는 저장본에서 미래 값이 올 수 있어 string이다. */
export type WordWrong = { expr: string; value: number; cause: string }

/** 문제 한 개 — 생성 시점에 통째로 박제된다(엔진이 바뀌어도 그날 본 문장·보기가 남는다). */
export type WordProblem = {
  type: string
  /** 없으면 키 자체를 넣지 않는다 — undefined를 적으면 서버 왕복 값과 영영 달라진다. */
  trap?: 'extra-number'
  text: string
  unit: string
  answer: number
  steps: { expr: string; value: number }[]
  review: ReviewStep[]
  wrongs: WordWrong[]
}

/**
 * 문장제 시도 하나. **원인·정답 여부를 저장하지 않는다** — 사실(무엇을 고르고 무엇을 썼나)만
 * 남기고 해석은 engine/word.ts가 매번 계산한다(derived 비배선과 같은 원칙).
 * sid는 문항 하나에 하나. 같은 sid로 여러 번 덮어쓰며(보여 줌 → 답함 → 되짚기 단계마다)
 * 병합은 더 진행된 쪽을 남긴다(engine/merge.ts의 mergeWord).
 */
export type WordAttempt = {
  sid: string
  problem: WordProblem
  /** 첫 답. null = 보여 줬지만 아직 답하지 않았다. */
  answer: number | null
  exprs: string[]
  ms: number
  picks: number[]
  calcs: number[]
}

export type Day = {
  date: string
  kind: 'normal' | 'checkup'
  sheet: SheetItem[]
  grades?: Record<string, boolean>
  sprint?: SprintAttempt[]
  mood?: Mood
  doneAt?: string
  word?: WordAttempt[]
}

// ─────────── 파생 상태 ───────────

export type FactState = {
  status: 'new' | 'learning' | 'fluent'
  medianMs: number | null
  streak: number
  interval: 1 | 3 | 7 | 14
  nextDue: string | null
}

export type Derived = {
  facts: Record<string, FactState>
  /** 은퇴한 종이 엔진의 파생 자리 — 모양 호환으로만 남는다(배선하지 않는다). */
  types: Record<string, unknown>
  strategies: Record<string, unknown>
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
