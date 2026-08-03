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

function lastCheckupDate(days: Day[]): string | null {
  for (let i = days.length - 1; i >= 0; i--) {
    const d = days[i]!
    // sprint 없는 checkup 날은 점검을 실제로 하지 않은 것이다 — 기준점으로 치지 않는다.
    if (d.kind === 'checkup' && d.sprint && d.sprint.length > 0) return d.date
  }
  return null
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
