import type { Day, TypeState, VerticalTag } from '../data/types'
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
 * 숙련 사실 자체를 저장하는 쪽(Phase 3)으로 간다. Phase 2는 곱셈 스프린트만 다뤄
 * 이 이력에 손대지 않았고, 하루 10문항이면 몇 년을 써도 수천 건이라 아직 급하지 않다.
 *
 * inverse 태그(inverse-add·inverse-sub)도 여기서 함께 이력이 쌓이지만, 이 상태를 읽는
 * 곳은 아직 없다 — openTags·composeSheet 모두 VERTICAL_ORDER만 본다. □ 채우기는 고정
 * 개수로 출제되며 숙련도에 따라 조절되지 않는다. Phase 2는 종이 쪽 사다리를 그대로 두고
 * 곱셈에 집중했으므로 배선은 Phase 3으로 간다.
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
function everMastered(state?: TypeState): boolean {
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
