import type { Day, Meta } from '../data/types'
import { deriveFacts, median } from './facts'
import { deriveTypes, accuracy, OPEN_THRESHOLD, RECENT_WINDOW } from './derive'
import { diffDays, shiftDay } from './dates'
import { sprintStreak } from './streak'
import { nextCheckupDate } from './checkup'

/**
 * 리포트 집계(스펙 §4). 아무것도 저장하지 않고 매번 로그에서 재계산한다 —
 * derived를 배선하지 않는 것과 같은 원칙이다. 판정 규칙이 바뀌면 과거 주간도
 * 새 규칙으로 소급 재해석된다. deriveFacts 두 번의 비용은 실측 16ms×2다.
 */

export const EXPORT_OVERDUE_DAYS = 30

/**
 * 종이 채점과 스프린트를 **둘 다** 끝낸 날의 수(설계 §6.8). home.ts에서 이사해 왔다.
 *
 * 🔥 연속일수는 스프린트만으로 인정하는 너그러운 숫자이고, ✅는 정직한 숫자다.
 * sprint 판정은 sprintStreak과 같은 식("있고 비어 있지 않다")을 쓴다 —
 * 어긋나면 같은 날을 두고 화면이 서로 다른 말을 하게 된다.
 */
export function completedCount(days: Day[]): number {
  return days.filter(
    (d) => d.grades && Object.keys(d.grades).length > 0 && d.sprint && d.sprint.length > 0,
  ).length
}

export type WeeklyReport = {
  streak: number
  completed: number
  fluentTotal: number
  newlyFluent: string[]
  weekMedianMs: number | null
  prevWeekMedianMs: number | null
  types: { tag: string; pct: number | null; warn: boolean }[]
  slowest: { fact: string; medianMs: number } | null
  nextCheckup: string | null
  exportOverdue: boolean
}

/**
 * "이번 주" = 오늘로 끝나는 최근 7일, "지난주" = 그 앞 7일(롤링 창). 평일에 열어도
 * 창이 항상 꽉 차 있어 특수 분기가 없고, 일요일에 보면 자연히 한 주가 된다(스펙 §4).
 */
export function weeklyReport(days: Day[], meta: Meta, today: string): WeeklyReport {
  const fluentMs = meta.settings.fluentMs
  const weekStart = shiftDay(today, -6)
  const prevStart = shiftDay(today, -13)
  const inWeek = days.filter((d) => d.date >= weekStart && d.date <= today)
  const inPrev = days.filter((d) => d.date >= prevStart && d.date < weekStart)

  const factsNow = deriveFacts(days, fluentMs)
  const factsBefore = deriveFacts(
    days.filter((d) => d.date < weekStart),
    fluentMs,
  )
  const newlyFluent = Object.keys(factsNow).filter(
    (id) => factsNow[id]!.status === 'fluent' && factsBefore[id]!.status !== 'fluent',
  )
  const fluentTotal = Object.values(factsNow).filter((f) => f.status === 'fluent').length

  const correctMs = (ds: Day[]) =>
    ds
      .flatMap((d) => d.sprint ?? [])
      .filter((a) => a.correct)
      .map((a) => a.ms)

  const types = deriveTypes(days)
  const typeRows = Object.keys(types).map((tag) => {
    const state = types[tag]!
    // accuracy()는 표본 부족을 0으로 돌려준다("아직 증명되지 않음") — 리포트에서 0%로
    // 보여주면 거짓말이 되므로 표본이 찼는지를 따로 본다.
    const sampled = state.attempts.length >= RECENT_WINDOW
    const pct = sampled ? accuracy(state) : null
    return { tag, pct, warn: pct !== null && pct < OPEN_THRESHOLD }
  })

  const byFact = new Map<string, number[]>()
  for (const d of inWeek)
    for (const a of d.sprint ?? []) {
      if (!a.correct) continue
      const arr = byFact.get(a.fact) ?? []
      arr.push(a.ms)
      byFact.set(a.fact, arr)
    }
  let slowest: { fact: string; medianMs: number } | null = null
  for (const [fact, ms] of byFact) {
    const med = median(ms)!
    if (!slowest || med > slowest.medianMs) slowest = { fact, medianMs: med }
  }

  const last = meta.settings.lastExportedAt
  // ISO 타임스탬프의 앞 10자리는 UTC 날짜라 KST와 하루 어긋날 수 있다 — 30일 배지에는
  // 하루 오차가 무의미하므로 그대로 쓴다.
  const exportOverdue =
    days.length > 0 && (last === null || diffDays(last.slice(0, 10), today) >= EXPORT_OVERDUE_DAYS)

  return {
    streak: sprintStreak(days, today),
    completed: completedCount(days),
    fluentTotal,
    newlyFluent,
    weekMedianMs: median(correctMs(inWeek)),
    prevWeekMedianMs: median(correctMs(inPrev)),
    types: typeRows,
    slowest,
    nextCheckup: nextCheckupDate(days, fluentMs),
    exportOverdue,
  }
}

export type CheckupReport = {
  date: string
  kept: string[]
  dropped: string[]
  medianMs: number | null
  prevMedianMs: number | null
}

/**
 * 가장 최근 점검의 재검증 결과(스펙 §6). 점검 전날까지의 fluent 집합과 점검일까지의
 * 집합을 비교한다 — 두 파생의 차이는 정확히 점검 세션의 시도들이다(점검의 날엔 스프린트가
 * 점검 하나뿐이므로). 저장하지 않는다: 판정 규칙이 바뀌면 과거 점검도 소급 재해석된다.
 */
export function latestCheckupReport(days: Day[], fluentMs: number): CheckupReport | null {
  const checkups = days.filter((d) => d.kind === 'checkup' && d.sprint && d.sprint.length > 0)
  const latest = checkups[checkups.length - 1]
  if (!latest) return null

  const before = deriveFacts(
    days.filter((d) => d.date < latest.date),
    fluentMs,
  )
  const upto = deriveFacts(
    days.filter((d) => d.date <= latest.date),
    fluentMs,
  )
  const wasFluent = Object.keys(before).filter((id) => before[id]!.status === 'fluent')

  const sessionMedian = (d: Day) =>
    median((d.sprint ?? []).filter((a) => a.correct).map((a) => a.ms))
  const prev = checkups[checkups.length - 2]

  return {
    date: latest.date,
    kept: wasFluent.filter((id) => upto[id]!.status === 'fluent'),
    dropped: wasFluent.filter((id) => upto[id]!.status !== 'fluent'),
    medianMs: sessionMedian(latest),
    prevMedianMs: prev ? sessionMedian(prev) : null,
  }
}
