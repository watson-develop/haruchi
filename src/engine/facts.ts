import type { Day, FactState } from '../data/types'
import { shiftDay } from './dates'

/** 유창 판정에 필요한 연속 정답 횟수. */
export const STREAK_TARGET = 3

/** 곱셈 기호는 U+00D7. ASCII 'x'가 아니다 — 화면과 저장 키가 모두 이 문자를 쓴다. */
export function factId(a: number, b: number): string {
  return `${a}×${b}`
}

/** 1×1 ~ 9×9. 순서쌍이므로 7×8과 8×7은 별개다. */
export const FACT_IDS: string[] = (() => {
  const ids: string[] = []
  for (let a = 1; a <= 9; a++) for (let b = 1; b <= 9; b++) ids.push(factId(a, b))
  return ids
})()

/**
 * 단 도입 순서.
 *
 * ⚠️ **출처 미확인.** 이 배열은 설계 문서에 "교과서 순서"로 적혀 있으나 공시 문서로
 * 검증된 값이 아니다. 곱셈구구 단원 **안에서의** 단 배열은 교육부 고시의 성취기준
 * 수준이 아니라 교과서 편집 결정이며, 출판사마다 다를 수 있다. EBS 만점왕 연산 조사
 * (`docs/reference/korean-math-programs-curricula.md`)도 "4단계(초2) — 2~9단 곱셈구구
 * 전체"까지만 확인되고 내부 순서는 미공개다. 실제 2-2 교과서 목차를 확인하면 고칠 것.
 *
 * 바꾸는 비용은 작다: 이 배열은 **아직 도입되지 않은 식을 다음에 무엇부터 꺼낼지**만
 * 정한다. 이미 나온 식의 상태는 로그에서 파생되므로 순서를 바꿔도 과거 기록은 유효하다.
 *
 * 현재 값의 근거는 경험칙이다 — 2단·5단이 패턴이 뚜렷해 먼저 오고, 병목인 6×7·7×8·
 * 8×6·9×7 부근이 뒤로 밀려 앞에서 자신감을 쌓은 뒤 만나게 된다.
 */
const DAN_ORDER = [1, 2, 5, 3, 6, 4, 8, 7, 9]

export const FACT_ORDER: string[] = DAN_ORDER.flatMap((a) =>
  Array.from({ length: 9 }, (_, i) => factId(a, i + 1)),
)

function median(xs: number[]): number | null {
  if (xs.length === 0) return null
  const sorted = [...xs].sort((p, q) => p - q)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

/** 1 → 3 → 7 → 14 → 14. */
function nextInterval(current: FactState['interval']): FactState['interval'] {
  if (current === 1) return 3
  if (current === 3) return 7
  return 14
}

/**
 * 로그를 시간순으로 재생해 81식의 현재 상태를 만든다.
 *
 * `medianMs`는 **지금 이어지고 있는 연속 정답**(최대 STREAK_TARGET개)의 중앙값이다.
 * 오답이 나오면 연속이 끊기므로 null이 된다. 유창 게이트가 쓰는 값이 그것이기 때문이며,
 * 화면에 보여줄 "평균 반응시간"은 이 값이 아니라 `day.sprint`에서 직접 계산한다.
 *
 * days는 날짜 오름차순을 전제한다 — `getAllDays()`가 그렇게 돌려준다.
 */
export function deriveFacts(days: Day[], fluentMs: number): Record<string, FactState> {
  const facts: Record<string, FactState> = {}
  const run: Record<string, number[]> = {}
  for (const id of FACT_IDS) {
    facts[id] = { status: 'new', medianMs: null, streak: 0, interval: 1, nextDue: null }
    run[id] = []
  }

  for (const day of days) {
    if (!day.sprint) continue
    for (const attempt of day.sprint) {
      const state = facts[attempt.fact]
      const history = run[attempt.fact]
      if (!state || !history) continue // 알 수 없는 식은 의도적으로 무시한다. 모든 화면이 이 함수에서 파생하므로,
      // 여기서 throw하면 기기의 복구 경로 없이 앱 전체가 열리지 않는다. "계약 위반은 시끄럽게 실패한다"의 의도적 예외.

      if (attempt.correct) {
        state.streak += 1
        history.push(attempt.ms)
        if (history.length > STREAK_TARGET) history.shift()
      } else {
        state.streak = 0
        history.length = 0
      }

      const wasFluent = state.status === 'fluent'
      const med = median(history)
      const isFluent = state.streak >= STREAK_TARGET && med !== null && med <= fluentMs

      state.medianMs = med
      state.status = isFluent ? 'fluent' : 'learning'

      if (isFluent) {
        state.interval = wasFluent ? nextInterval(state.interval) : 1
        state.nextDue = shiftDay(day.date, state.interval)
      } else {
        state.interval = 1
        state.nextDue = null
      }
    }
  }

  return facts
}
