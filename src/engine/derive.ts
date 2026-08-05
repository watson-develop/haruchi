import type { Day, StrategyState, TypeState, VerticalTag } from '../data/types'
import { VERTICAL_ORDER } from './vertical'

/** 숙련 판정에 쓰는 최근 시도 개수. */
export const RECENT_WINDOW = 10

/** 다음 유형이 열리는 정답률. */
export const OPEN_THRESHOLD = 0.9

/**
 * 로그에서 유형별 정오답 이력을 뽑는다.
 * days는 날짜 오름차순을 전제한다. 채점되지 않은 날은 건너뛴다.
 *
 * ⚠️ attempts는 절대 잘라내지 말 것(오래된 앞쪽을 버리는 캡을 걸지 말 것).
 * everMastered()가 "한 번이라도 숙련한 적이 있는가"를 전체 이력 위의 슬라이딩 창으로
 * 판정하기 때문에, 앞쪽을 버리면 이미 연 유형이 다시 닫히는 회귀가 조용히 되살아난다.
 * "attempts가 무한히 자란다"는 지적은 알고 있으며, 해결은 잘라내기가 아니라
 * 숙련 사실 자체를 저장하는 쪽으로 간다(실측상 5년치도 비용이 없어 Phase 4 이후로 미룬다).
 * Phase 2는 곱셈 스프린트만 다뤄 이 이력에 손대지 않았고, 하루 10문항이면 몇 년을 써도
 * 수천 건이라 아직 급하지 않다.
 *
 * inverse 태그(inverse-add·inverse-sub)도 여기서 함께 이력이 쌓이지만, 이 상태를 읽는
 * 곳은 아직 없다 — openTags·composeSheet 모두 VERTICAL_ORDER만 본다. □ 채우기는 고정
 * 개수로 출제되며 숙련도에 따라 조절되지 않는다. Phase 2는 종이 쪽 사다리를 그대로 두고
 * 곱셈에 집중했으므로 배선은 Phase 4 이후로 간다(Phase 3은 리포트·점검에 집중했다).
 */
export function deriveTypes(days: Day[]): Record<string, TypeState> {
  const types: Record<string, TypeState> = {}
  for (const day of days) {
    if (!day.grades) continue
    for (const item of day.sheet) {
      if (item.kind !== 'vertical' && item.kind !== 'inverse') continue
      const graded = day.grades[item.id]
      if (graded === undefined) continue
      const state = (types[item.tag] ??= { attempts: [] })
      state.attempts.push(graded)
    }
  }
  return types
}

/**
 * 로그에서 전략별 상태를 파생한다. deriveTypes와 같은 원칙 — 저장하지 않고 매번 재계산.
 *
 * appearances(등장)와 attempts(채점)를 나눠 세는 이유: 도입 게이트는 숙련 판정이 아니라
 * 노출 페이스 조절이 목적이라, 아빠가 채점을 며칠 밀려도 새 전략 도입이 멈추면 안 된다.
 * days는 날짜 오름차순을 전제한다 — getAllDays()가 그렇게 돌려준다.
 */
export function deriveStrategies(days: Day[]): Record<string, StrategyState> {
  const out: Record<string, StrategyState> = {}
  for (const day of days) {
    for (const item of day.sheet) {
      if (item.kind !== 'strategy') continue
      const state = (out[item.tag] ??= {
        attempts: [],
        introducedAt: day.date,
        appearances: 0,
        lastAppearedAt: null,
      })
      state.appearances += 1
      state.lastAppearedAt = day.date
      const graded = day.grades?.[item.id]
      if (graded !== undefined) state.attempts.push(graded)
    }
  }
  return out
}

/**
 * tag → 마지막으로 sheet에 실린 날짜. 복습 슬롯(compose.ts)이 "얼마나 오래 안
 * 나왔나"를 재는 데 쓴다. deriveTypes와 달리 **채점 안 된 날도 센다** —
 * deriveStrategies의 appearances와 같은 원칙으로, 채점이 밀려도 복습 페이스가
 * 멈추면 안 된다. days는 날짜 오름차순 전제 — 마지막 기록이 이긴다.
 * 세로셈만 본다 — 슬롯은 세로셈 유형에만 있다.
 */
export function deriveLastSeen(days: Day[]): Record<string, string> {
  const lastSeen: Record<string, string> = {}
  for (const day of days) {
    for (const item of day.sheet) {
      if (item.kind !== 'vertical') continue
      lastSeen[item.tag] = day.date
    }
  }
  return lastSeen
}

/** 최근 RECENT_WINDOW회 정답률. 표본이 부족하면 0으로 본다(아직 증명되지 않음). */
export function accuracy(state: TypeState | undefined): number {
  if (!state) return 0
  const recent = state.attempts.slice(-RECENT_WINDOW)
  if (recent.length < RECENT_WINDOW) return 0
  return recent.filter(Boolean).length / recent.length
}

/**
 * 전체 이력 어디에선가 RECENT_WINDOW회 연속 구간이 OPEN_THRESHOLD 이상이었던 적이 있는가.
 *
 * accuracy()의 "지금" 대신 "한 번이라도"를 보는 이유: 슬라이딩 창은 내려갈 수 있으므로
 * 몇 주 전에 뗀 유형도 오늘 8/10이면 미달로 잡힌다. 그것을 문 닫는 신호로 쓰면
 * 그 뒤 유형이 전부 함께 닫혀 아이를 뒤로 되돌린다(설계 §6.2 위반).
 * 흔들리는 유형은 닫는 게 아니라 weightsFor()의 가중치로 더 많이 내보내 다룬다.
 *
 * 전체 이력 위를 도는 슬라이딩 합이라 O(n)이고, attempts를 잘라내면 성립하지 않는다.
 */
export function everMastered(state?: TypeState): boolean {
  if (!state || state.attempts.length < RECENT_WINDOW) return false
  let ok = state.attempts.slice(0, RECENT_WINDOW).filter(Boolean).length
  if (ok / RECENT_WINDOW >= OPEN_THRESHOLD) return true
  for (let i = RECENT_WINDOW; i < state.attempts.length; i++) {
    ok += (state.attempts[i] ? 1 : 0) - (state.attempts[i - RECENT_WINDOW] ? 1 : 0)
    if (ok / RECENT_WINDOW >= OPEN_THRESHOLD) return true
  }
  return false
}

/**
 * 출제 가능한 유형 목록.
 * 앞에서부터 하나씩 열리며, 열린 유형은 사라지지 않는다(유지 복습).
 *
 * "사라지지 않는다"는 everMastered()가 단조롭기 때문에 성립한다 — attempts는 뒤로만
 * 자라고, 한 번 참이 된 판정은 뒤에 무엇이 붙어도 참으로 남는다. 따라서 이 함수의
 * 결과 길이는 날이 갈수록 줄지 않는다. 입력만 보는 순수 함수다.
 */
export function openTags(types: Record<string, TypeState>): VerticalTag[] {
  const open: VerticalTag[] = []
  for (const tag of VERTICAL_ORDER) {
    open.push(tag)
    if (!everMastered(types[tag])) break
  }
  return open
}

/**
 * mood 로그에서 오늘 문제지의 세로셈 문항 수를 파생한다(설계 §6.8 ②).
 * 😫(hard) 3연속 → 6으로 하향, 하향 상태에서 😀(easy) 5연속 → 8로 복구.
 *
 * "연속"은 달력이 아니라 기록의 연속이다 — mood가 없는 날(채점을 안 했거나
 * 기분을 안 고른 날)은 신호의 부재이지 반증이 아니라 연속을 끊지 않는다.
 * 😐(ok)는 끊는다. 재량 결정(2026-08-05, plans/2026-08-05-ux-round1.md).
 *
 * 다른 derive와 같은 원칙 — 저장하지 않고 매번 재계산한다. 규칙(3일/5일)을
 * 바꾸면 과거 mood 전체가 새 규칙으로 소급 재해석된다. Settings.verticalCount는
 * 기본값(8)의 자리로만 남는다 — 이 함수의 결과가 화면·조립의 실효값이다.
 */
export function deriveVerticalCount(days: Day[]): 8 | 6 {
  let count: 8 | 6 = 8
  let run = 0
  for (const day of days) {
    if (!day.mood) continue
    if (count === 8) {
      run = day.mood === 'hard' ? run + 1 : 0
      if (run >= 3) {
        count = 6
        run = 0
      }
    } else {
      run = day.mood === 'easy' ? run + 1 : 0
      if (run >= 5) {
        count = 8
        run = 0
      }
    }
  }
  return count
}
