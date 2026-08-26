import type { Day } from '../data/types'
import { shiftDay } from './dates'

/**
 * 연속이 끊기기 전까지 봐주는 결석 일수.
 *
 * 2로 둔 이유는 주말이다 — 2학기 루틴(스펙 `2026-08-26-semester2-plan-design.md` §3)이
 * 토·일 스프린트를 "자유"로 두므로, 1이면 주말을 쉰 아이가 월요일마다 불꽃이 꺼진 홈을
 * 본다. 주말에 인접한 평일 병결(금 또는 월)까지 겹치면 공백 3일이 되어 여전히 끊기는데,
 * 그 잔여 리스크는 수용된 결정이다(같은 스펙 §2-3) — 실사용에서 아프면 3으로 올린다.
 */
const FORGIVEN_GAPS = 2

/** 되짚어 볼 최대 일수. 아이가 몇 년을 써도 남는 안전장치다. */
const MAX_LOOKBACK = 800

/**
 * 스프린트를 한 날의 연속 횟수.
 *
 * 종이 채점이 아니라 **스프린트 완료**를 기준으로 세는 이유: 여행이나 늦은 날에도 3분은
 * 할 수 있어 아이에게 보이는 불꽃이 잘 안 꺼진다. 종이까지 포함한 정직한 숫자는
 * 홈 화면의 `✅ N일 완료`가 따로 보여준다.
 *
 * 이틀까지 빠진 것은 봐준다 — 아픈 날은 한 달에 한두 번 반드시 생기고, 그때마다 0이 되면
 * 다시 쌓을 의욕을 잃는다. 주말 이틀을 쉬는 루틴도 여기에 기댄다. 사흘 연속 빠지면 끊는다.
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
