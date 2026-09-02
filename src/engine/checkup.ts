import type { Day, FactState } from '../data/types'
import { deriveFacts, shuffled } from './facts'
import { shiftDay } from './dates'

/**
 * 점검 스프린트(스펙 §5). 적응 off로 fluent 식을 한 번씩 재검증한다.
 *
 * 강등 로직은 여기에도 어디에도 없다 — 점검 시도는 Day.sprint에 기록될 뿐이고,
 * deriveFacts가 로그를 재생하며 연속 3회 조건이 깨지면 스스로 내린다.
 *
 * 주기 28일은 재등장 상한 실측(15~16일)보다 길다: 점검 사이에 모든 fluent 식이
 * 일반 로테이션으로도 최소 한 번 검증되고, 점검은 그 위의 동질 조건 스냅샷이다.
 */
export const CHECKUP_INTERVAL_DAYS = 28

/**
 * 점검이 돌기 시작하려면 최소 이 개수만큼 fluent 식이 쌓여야 한다.
 *
 * 게이트가 "1개 이상"이던 시절엔 fluent 1개인 아이가 1문제짜리 점검을 받았다 — 드릴이
 * 가장 필요한 어려워하는 아이일수록 fluent가 적게 쌓이므로, 하필 그 아이가 하루를
 * 통째로 잃는다. 게다가 sprintStreak은 스프린트가 있었다는 사실만 보므로 그 하루도
 * 🔥 연속일수로 인정돼, 짧아진 하루가 오히려 보상을 받는다. 측정할 게 어느 정도
 * 쌓인 뒤에 재는 것이 점검의 취지("동질 조건의 측정 스냅샷")에 맞다.
 */
export const CHECKUP_MIN_FLUENT = 10

/**
 * 실제로 점검을 한 날들(날짜 오름차순 — getAllDays가 그렇게 돌려준다). sprint 없는
 * checkup 날은 점검을 실제로 하지 않은 것이라 제외한다.
 *
 * **이 술어의 주인은 여기다.** 점검 스케줄(lastCheckupDate), 월간 리포트
 * (report.ts의 latestCheckupReport), 부모 홈 배너(checkupNoticeDate)가 같은 정의를
 * 봐야 한다 — 사본을 두면 한쪽만 고쳐지는 날 세 화면이 서로 다른 날을 "최근 점검"이라
 * 부른다.
 */
export function checkupDays(days: Day[]): Day[] {
  return days.filter((d) => d.kind === 'checkup' && d.sprint !== undefined && d.sprint.length > 0)
}

/** 마지막으로 실제 점검을 한 날. 없으면 null. */
export function lastCheckupDate(days: Day[]): string | null {
  return checkupDays(days).at(-1)?.date ?? null
}

function firstSprintDate(days: Day[]): string | null {
  for (const d of days) if (d.sprint && d.sprint.length > 0) return d.date
  return null
}

/** 다음 점검 예정일. fluent 식이 CHECKUP_MIN_FLUENT 미만이면(점검할 게 부족하면) null. */
export function nextCheckupDate(days: Day[], fluentMs: number): string | null {
  const facts = deriveFacts(days, fluentMs)
  const fluentCount = Object.values(facts).filter((f) => f.status === 'fluent').length
  if (fluentCount < CHECKUP_MIN_FLUENT) return null
  const anchor = lastCheckupDate(days) ?? firstSprintDate(days)
  if (anchor === null) return null
  return shiftDay(anchor, CHECKUP_INTERVAL_DAYS)
}

export function checkupDue(days: Day[], fluentMs: number, today: string): boolean {
  const next = nextCheckupDate(days, fluentMs)
  return next !== null && next <= today
}

/** 부모 홈 배너가 최근 점검을 안내하는 기간(점검일 포함). */
export const CHECKUP_NOTICE_DAYS = 7

/**
 * 부모 홈 배너에 적을 최근 점검일 — 점검일부터 CHECKUP_NOTICE_DAYS일 동안만.
 * 밖이면 null(설계 `specs/2026-09-02-checkup-notice-design.md` §2-1).
 *
 * **가장 최근 점검 하나만 본다**(lastCheckupDate). `date > today`(가져온 백업의 미래
 * 날짜 — validateBackup은 날짜 범위를 보지 않는다)면 null이고, 그때 기간 안의 옛 점검이
 * 있어도 찾지 않는다 — 미래 날짜 기록은 시계가 틀린 기기에서만 생기는 예외라 그 경우까지
 * 맞추는 분기를 두지 않는다.
 *
 * **fluentMs를 받지 않는다.** 배너는 날짜만 말하므로 파생(deriveFacts)이 필요 없다 —
 * 부모 홈 렌더에 파생 비용을 새로 들이지 않는다(부모 홈은 지금 deriveFacts를 한 번도
 * 부르지 않는다). 저장하지 않는다 — 날짜만으로 결정되므로 기기마다 같은 답이 나온다.
 */
export function checkupNoticeDate(days: Day[], today: string): string | null {
  const date = lastCheckupDate(days)
  if (date === null || date > today) return null
  if (shiftDay(date, CHECKUP_NOTICE_DAYS) <= today) return null
  return date
}

/**
 * 점검 세션의 문제 목록: fluent 식 전부, 각 한 번씩, 순서만 섞는다.
 * count를 넘으면 마지막 유창 판정이 오래된 순으로 자른다 — 판정일은
 * nextDue - interval로 FactState에서 역산한다(새 저장 없음).
 * fluent가 count보다 적으면 그만큼 짧은 세션이 된다 — learning으로 채우지 않는다.
 */
export function composeCheckup(
  facts: Record<string, FactState>,
  count: number,
  rand: () => number = Math.random,
): string[] {
  const fluent = Object.keys(facts).filter((id) => facts[id]!.status === 'fluent')
  const judgedAt = (id: string) => shiftDay(facts[id]!.nextDue!, -facts[id]!.interval)
  fluent.sort((p, q) => judgedAt(p).localeCompare(judgedAt(q)))
  return shuffled(fluent.slice(0, count), rand)
}
