import type { Day, TypeState, VerticalTag } from '../data/types'
import { VERTICAL_ORDER } from './vertical'

/** 숙련 판정에 쓰는 최근 시도 개수. */
export const RECENT_WINDOW = 10

/** 다음 유형이 열리는 정답률. */
export const OPEN_THRESHOLD = 0.9

/**
 * 로그에서 유형별 정오답 이력을 뽑는다.
 * days는 날짜 오름차순을 전제한다. 채점되지 않은 날은 건너뛴다.
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
 * 출제 가능한 유형 목록.
 * 앞에서부터 하나씩 열리며, 열린 유형은 사라지지 않는다(유지 복습).
 */
export function openTags(types: Record<string, TypeState>): VerticalTag[] {
  const open: VerticalTag[] = []
  for (const tag of VERTICAL_ORDER) {
    open.push(tag)
    if (accuracy(types[tag]) < OPEN_THRESHOLD) break
  }
  return open
}
