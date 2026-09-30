import type { Day, Meta } from '../data/types'
import { deriveFacts, median, newlyFluentSince } from './facts'
import { diffDays, shiftDay } from './dates'
import { sprintStreak } from './streak'
import { checkupDays, nextCheckupDate } from './checkup'

/**
 * 리포트 집계(스펙 §4). 아무것도 저장하지 않고 매번 로그에서 재계산한다 —
 * derived를 배선하지 않는 것과 같은 원칙이다. 판정 규칙이 바뀌면 과거 주간도
 * 새 규칙으로 소급 재해석된다. `#/report`를 한 번 열 때 deriveFacts는 총 일곱 번
 * 돈다 — weeklyReport 안에서 넷(factsNow·newlyFluentSince가 안에서 부르는 둘·
 * nextCheckupDate가 숨겨서 부르는 것 하나), renderReport의 지도용 하나,
 * latestCheckupReport 안에서 둘(before·upto).
 * 5년치 로그(54,750 시도)에서 1회 16ms이므로 일곱 번이어도 아이패드에서 보이지 않는다.
 */

const EXPORT_OVERDUE_DAYS = 30

export type WeeklyReport = {
  streak: number
  fluentTotal: number
  newlyFluent: string[]
  weekMedianMs: number | null
  prevWeekMedianMs: number | null
  slowest: { fact: string; medianMs: number } | null
  nextCheckup: string | null
  exportOverdue: boolean
}

/**
 * 마지막 백업 이후 지난 일수. 백업한 적이 없거나 값이 날짜로 파싱되지 않으면 null.
 *
 * ISO 타임스탬프의 앞 10자리는 UTC 날짜라 KST와 하루 어긋날 수 있다 — 30일 배지에도
 * 초기화 배너에도 하루 오차가 무의미하므로 그대로 쓴다.
 *
 * 파싱되지 않는 값을 null로 접는 것이 이 함수의 존재 이유다. validateBackup은
 * lastExportedAt을 typeof === 'string'까지만 보고 형식은 검사하지 않아서 diffDays가
 * NaN을 낼 수 있는데, `NaN >= 30`은 항상 false라 배지가 영원히 안 뜨는 쪽으로 조용히
 * 실패한다 — 서버 스냅샷과 나란히 서는 오프라인 안전망(파일 백업)이 꺼지는 것이므로
 * "백업한 적 없음"과 같게(배지를 띄우는 쪽으로) 취급한다.
 */
export function daysSinceExport(meta: Meta, today: string): number | null {
  const last = meta.settings.lastExportedAt
  if (last === null) return null
  const diff = diffDays(last.slice(0, 10), today)
  return Number.isFinite(diff) ? diff : null
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
  const newlyFluent = newlyFluentSince(days, fluentMs, weekStart)
  const fluentTotal = Object.values(factsNow).filter((f) => f.status === 'fluent').length

  const correctMs = (ds: Day[]) =>
    ds
      .flatMap((d) => d.sprint ?? [])
      .filter((a) => a.correct)
      .map((a) => a.ms)

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

  const sinceExport = daysSinceExport(meta, today)
  const exportOverdue =
    days.length > 0 && (sinceExport === null || sinceExport >= EXPORT_OVERDUE_DAYS)

  return {
    streak: sprintStreak(days, today),
    fluentTotal,
    newlyFluent,
    weekMedianMs: median(correctMs(inWeek)),
    prevWeekMedianMs: median(correctMs(inPrev)),
    slowest,
    nextCheckup: nextCheckupDate(days, fluentMs),
    exportOverdue,
  }
}

type CheckupReport = {
  date: string
  /** 그 점검 세션이 실제로 물어본 식의 수 — kept·dropped의 분모(화면에 함께 보여준다). */
  tested: number
  kept: string[]
  dropped: string[]
  medianMs: number | null
  prevMedianMs: number | null
}

/**
 * 가장 최근 점검의 재검증 결과(스펙 §6). 점검 전날까지의 fluent 집합과 점검일까지의
 * 집합을 비교한다 — 두 파생의 차이는 정확히 점검 세션의 시도들이다(점검의 날엔 스프린트가
 * 점검 하나뿐이므로). 저장하지 않는다: 판정 규칙이 바뀌면 과거 점검도 소급 재해석된다.
 *
 * kept는 **그 세션이 실제로 물어본 식**으로 한정한다. composeCheckup은 fluent가 count를
 * 넘으면 오래된 판정부터 잘라내므로, "이전에 fluent였던 전부"를 분모로 쓰면 그날 아예
 * 안 물어본 식까지 "유지"로 세게 된다(구구단을 다 뗀 뒤가 정확히 이 상태다) — 점검을
 * "동질 조건의 측정 스냅샷"으로 삼는 취지(스펙 §5)에 어긋난다. dropped는 손댈 필요가
 * 없다: 상태가 바뀌려면 그 식에 시도가 있어야 하므로, 이미 그 세션에서 물어본 것만
 * 나온다(before/upto의 차이가 정확히 latest 하루뿐이므로).
 */
export function latestCheckupReport(days: Day[], fluentMs: number): CheckupReport | null {
  // "실제로 점검을 한 날"의 술어는 checkup.ts가 소유한다 — 점검 스케줄·이 리포트·
  // 부모 홈 배너가 같은 날을 "최근 점검"이라 불러야 한다.
  const checkups = checkupDays(days)
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
  const tested = new Set((latest.sprint ?? []).map((a) => a.fact))

  const sessionMedian = (d: Day) =>
    median((d.sprint ?? []).filter((a) => a.correct).map((a) => a.ms))
  const prev = checkups[checkups.length - 2]

  return {
    date: latest.date,
    tested: tested.size,
    kept: wasFluent.filter((id) => tested.has(id) && upto[id]!.status === 'fluent'),
    dropped: wasFluent.filter((id) => upto[id]!.status !== 'fluent'),
    medianMs: sessionMedian(latest),
    prevMedianMs: prev ? sessionMedian(prev) : null,
  }
}
