import type { Day } from '../data/types'
import { shiftDay } from './dates'
import { doneWordCount, WORD_PER_DAY } from './word'

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
 * 문장제 규칙이 켜지는 날 = 끝난 문장제가 WORD_PER_DAY개 이상인 첫날(스펙 §6). 매번 로그에서
 * 계산한다. 고정 날짜가 아닌 이유: 업데이트는 배너를 눌러야 적용되므로(main.ts) 옛 코드로 돈
 * 날이 소급해 미완료가 된다. 「하나라도」가 아니라 3개인 이유: 첫 문항을 끝낸 순간 그날이 3개를
 * 요구하게 되어 더 했는데 🔥가 줄어든다.
 */
export function wordStart(days: Day[]): string | null {
  let first: string | null = null
  for (const d of days)
    if (doneWordCount(d) >= WORD_PER_DAY && (first === null || d.date < first)) first = d.date
  return first
}

/** 그날이 완료인가. 🔥를 보여 주는 모든 화면(아이 홈·부모 홈·리포트)은 sprintStreak을 거쳐 이 판정을 쓴다. 아이 홈 카드의 「문장제 N개 남았어요」는 wordStart와 무관하게 doneWordCount로 따로 권한다(스펙 §4). */
export function dayDone(d: Day, start: string | null): boolean {
  if (d.sprint === undefined || d.sprint.length === 0) return false
  return start === null || d.date < start || doneWordCount(d) >= WORD_PER_DAY
}

/**
 * 완료한 날(dayDone)의 연속 횟수 — 문장제 도입 전에는 스프린트만, 도입 뒤에는 스프린트 + 문장제 3개.
 *
 * 도입 전의 날을 스프린트만으로 세는 이유: 여행이나 늦은 날에도 3분은
 * 할 수 있어 아이에게 보이는 불꽃이 잘 안 꺼진다.
 *
 * 이틀까지 빠진 것은 봐준다 — 아픈 날은 한 달에 한두 번 반드시 생기고, 그때마다 0이 되면
 * 다시 쌓을 의욕을 잃는다. 주말 이틀을 쉬는 루틴도 여기에 기댄다. 사흘 연속 빠지면 끊는다.
 */
export function sprintStreak(days: Day[], today: string): number {
  const start = wordStart(days)
  const done = new Set(days.filter((d) => dayDone(d, start)).map((d) => d.date))
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
