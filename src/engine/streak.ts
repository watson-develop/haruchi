import type { Day } from '../data/types'
import { shiftDay } from './dates'

/** 연속이 끊기기 전까지 봐주는 결석 일수. */
const FORGIVEN_GAPS = 1

/** 되짚어 볼 최대 일수. 아이가 몇 년을 써도 남는 안전장치다. */
const MAX_LOOKBACK = 800

/**
 * 스프린트를 한 날의 연속 횟수.
 *
 * 종이 채점이 아니라 **스프린트 완료**를 기준으로 세는 이유: 여행이나 늦은 날에도 3분은
 * 할 수 있어 아이에게 보이는 불꽃이 잘 안 꺼진다. 종이까지 포함한 정직한 숫자는
 * 홈 화면의 `✅ N일 완료`가 따로 보여준다.
 *
 * 하루 빠진 것은 봐준다 — 아픈 날은 한 달에 한두 번 반드시 생기고, 그때마다 0이 되면
 * 다시 쌓을 의욕을 잃는다. 이틀 연속 빠지면 끊는다.
 */
export function sprintStreak(days: Day[], today: string): number {
  const done = new Set(
    days.filter((d) => d.sprint !== undefined && d.sprint.length > 0).map((d) => d.date),
  )
  if (done.size === 0) return 0

  let streak = 0
  let gaps = 0
  let cursor = today

  for (let i = 0; i < MAX_LOOKBACK; i++) {
    if (done.has(cursor)) {
      streak += 1
      gaps = 0
    } else if (cursor === today) {
      // 오늘은 아직 하루가 끝나지 않았다. 안 한 것을 결석으로 세지 않는다.
    } else {
      gaps += 1
      if (gaps > FORGIVEN_GAPS) break
    }
    cursor = shiftDay(cursor, -1)
  }

  return streak
}
