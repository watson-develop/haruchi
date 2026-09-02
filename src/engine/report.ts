import type { Day, Meta } from '../data/types'
import { deriveFacts, median, newlyFluentSince } from './facts'
import { deriveTypes, deriveStrategies, accuracy, OPEN_THRESHOLD, RECENT_WINDOW } from './derive'
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
  /** introducedAt이 있는 전략 수(스펙 §3). 도입됐다는 것과 숙련했다는 것은 다르다 —
   *  "배운 방법"은 노출됐다는 뜻이지 정답률이 높다는 뜻이 아니다. */
  strategiesLearned: number
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
 * 실패한다 — 서버 사본이 없는 이 앱의 유일한 안전망이 꺼지는 것이므로 "백업한 적
 * 없음"과 같게(배지를 띄우는 쪽으로) 취급한다.
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

  const types = deriveTypes(days)
  const typeRows = Object.keys(types).map((tag) => {
    const state = types[tag]!
    // accuracy()는 표본 부족을 0으로 돌려준다("아직 증명되지 않음") — 리포트에서 0%로
    // 보여주면 거짓말이 되므로 표본이 찼는지를 따로 본다.
    const sampled = state.attempts.length >= RECENT_WINDOW
    const pct = sampled ? accuracy(state) : null
    return { tag, pct, warn: pct !== null && pct < OPEN_THRESHOLD }
  })

  // 전략도 유형과 같은 원칙으로 days 전체에서 파생한다(주간 창으로 자르지 않는다) —
  // 하루 2문항뿐이라 주간 창 안에서는 표본이 거의 항상 부족해진다. deriveStrategies는
  // 저장하지 않고 매번 재계산하므로 이 파일의 다른 파생과 원가가 같다.
  const strategyStates = deriveStrategies(days)
  const strategiesLearned = Object.values(strategyStates).filter(
    (s) => s.introducedAt !== null,
  ).length
  // 전략 정답률 행 — 세로셈·역연산과 같은 표본 규칙. 하루 2문항이라 표본이 느리게 찬다:
  // 처음 몇 주는 "표본 부족"이 정상이다(스펙 §6 — 결함으로 오인하지 말 것).
  const strategyRows = Object.entries(strategyStates).map(([tag, s]) => {
    const sampled = s.attempts.length >= RECENT_WINDOW
    const recent = s.attempts.slice(-RECENT_WINDOW)
    const pct = sampled ? recent.filter(Boolean).length / recent.length : null
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

  const sinceExport = daysSinceExport(meta, today)
  const exportOverdue =
    days.length > 0 && (sinceExport === null || sinceExport >= EXPORT_OVERDUE_DAYS)

  return {
    streak: sprintStreak(days, today),
    completed: completedCount(days),
    fluentTotal,
    newlyFluent,
    weekMedianMs: median(correctMs(inWeek)),
    prevWeekMedianMs: median(correctMs(inPrev)),
    types: [...typeRows, ...strategyRows],
    strategiesLearned,
    slowest,
    nextCheckup: nextCheckupDate(days, fluentMs),
    exportOverdue,
  }
}

export type CheckupReport = {
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

/**
 * 채점이 비어 있는 가장 최근 과거 날짜. 문제지가 없던 날은 제외한다. 없으면 null.
 * home.ts에서 이사해 왔다(역할 분리, 2026-08-04) — 부모 홈의 미채점 배너가 쓴다.
 * `days`는 날짜 오름차순이어야 한다 — 뒤에서부터 훑는 이 함수는 그 순서를 전제한다.
 */
export function pendingGradeDate(days: Day[], today: string): string | null {
  for (let i = days.length - 1; i >= 0; i--) {
    const d = days[i]!
    if (d.date >= today) continue
    // 스프린트만 하고 문제지는 인쇄하지 않은 날(여행·늦은 밤 — streak.ts가 기대하는 바로
    // 그 날)은 채점할 문항이 하나도 없다. 걸러내지 않으면 배너가 영원히 남는다:
    // renderPrint는 오늘 것만 만들므로 지난 날은 문제지를 나중에도 가질 수 없고,
    // 빈 채점 화면에서 저장해도 grades가 {}라 다시 미채점으로 잡힌다.
    if (d.sheet.length === 0) continue
    if (!d.grades || Object.keys(d.grades).length === 0) return d.date
  }
  return null
}

/**
 * 문제지를 인쇄했지만 채점하지 않은 날의 수(오늘 포함). 초기화 배너가
 * "손에 든 종이가 무효가 된다"를 경고하는 근거다(설계 2026-08-04-data-reset §5).
 *
 * pendingGradeDate를 재사용하지 않는다 — 그쪽은 `d.date >= today`를 건너뛴다.
 * "지금 채점하러 가기" 링크가 오늘을 가리키면 매일 아침 거짓말이 되기 때문인데,
 * 초기화 경고는 오늘 아침에 인쇄해 아이가 지금 풀고 있는 종이가 가장 중요한
 * 대상이라 정반대다.
 *
 * date <= today 조건은 가져온 백업에 미래 날짜가 들어 있는 경우를 위한 것이다 —
 * validateBackup은 날짜 형식만 보고 범위는 보지 않는다.
 * sheet.length > 0을 먼저 보므로 스프린트만 한 날(빈 sheet)은 세지 않는다.
 */
export function ungradedSheetCount(days: Day[], today: string): number {
  return days.filter(
    (d) =>
      d.date <= today && d.sheet.length > 0 && (!d.grades || Object.keys(d.grades).length === 0),
  ).length
}
