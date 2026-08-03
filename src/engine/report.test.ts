import { describe, it, expect } from 'vitest'
import { weeklyReport, completedCount, latestCheckupReport } from './report'
import { DEFAULT_SETTINGS, emptyDerived } from '../data/types'
import type { Day, Meta, StrategyId, VerticalTag } from '../data/types'

const TODAY = '2026-08-03'

function metaWith(lastExportedAt: string | null): Meta {
  return {
    derived: emptyDerived(),
    settings: { ...DEFAULT_SETTINGS, friendNames: [], lastExportedAt },
  }
}

function sprintDay(date: string, attempts: { fact: string; correct: boolean; ms: number }[]): Day {
  return { date, kind: 'normal', sheet: [], sprint: attempts }
}

const fast = (fact: string) => ({ fact, correct: true, ms: 800 })

describe('weeklyReport', () => {
  it('빈 로그에서 죽지 않고 전부 기본값이다', () => {
    const w = weeklyReport([], metaWith(null), TODAY)
    expect(w.streak).toBe(0)
    expect(w.completed).toBe(0)
    expect(w.newlyFluent).toEqual([])
    expect(w.weekMedianMs).toBeNull()
    expect(w.prevWeekMedianMs).toBeNull()
    expect(w.types).toEqual([])
    expect(w.slowest).toBeNull()
    expect(w.nextCheckup).toBeNull()
    // 데이터가 없으면 백업할 것도 없다 — 배지를 띄우지 않는다.
    expect(w.exportOverdue).toBe(false)
  })

  it('이번 7일에 fluent가 된 식만 newlyFluent에 담는다', () => {
    const days = [
      sprintDay('2026-07-20', [fast('2×3'), fast('2×3'), fast('2×3')]), // 2주 전 정복
      sprintDay('2026-08-01', [fast('3×4'), fast('3×4'), fast('3×4')]), // 이번 주 정복
    ]
    const w = weeklyReport(days, metaWith(null), TODAY)
    expect(w.newlyFluent).toEqual(['3×4'])
    expect(w.fluentTotal).toBe(2)
  })

  // brief 원본 픽스처는 이번 주(1000,3000→중앙값 2000)와 지난주(2000)가 우연히 같은 값이 되어,
  // inWeek/inPrev 필터가 통째로 바뀌거나 경계 부등호(>= vs >)가 틀려도 테스트가 통과했다.
  // 두 주의 값을 다르게 만들고, 네 경계(prevStart 포함·weekStart 전날 제외·weekStart 포함·
  // today 포함)를 모두 실제 데이터로 찍어 펜스포스트 오류를 잡도록 픽스처를 고쳤다.
  it('주간 중앙값은 정답 시도만 세고, 지난주와 나눠 센다(경계 포함)', () => {
    const days = [
      // prevStart(7/21) 경계, 지난주에 포함돼야 한다.
      sprintDay('2026-07-21', [
        { fact: '2×3', correct: true, ms: 4000 },
        { fact: '2×4', correct: false, ms: 1 }, // 오답은 제외
      ]),
      // weekStart(7/28) 바로 전날, 지난주의 마지막 날.
      sprintDay('2026-07-27', [{ fact: '2×5', correct: true, ms: 8000 }]),
      // weekStart(7/28) 경계, 이번 주의 첫날.
      sprintDay('2026-07-28', [{ fact: '2×6', correct: true, ms: 1000 }]),
      // today(8/3), 이번 주의 마지막 날.
      sprintDay('2026-08-03', [{ fact: '2×7', correct: true, ms: 3000 }]),
    ]
    const w = weeklyReport(days, metaWith(null), TODAY)
    // 지난주 정답: [4000, 8000] → 중앙값 6000
    expect(w.prevWeekMedianMs).toBe(6000)
    // 이번 주 정답: [1000, 3000] → 중앙값 2000
    expect(w.weekMedianMs).toBe(2000)
  })

  it('유형별 정답률: 표본 10회 미만은 pct null·warn 없음, 10회 이상 90% 미만은 warn', () => {
    // 12회 중 8회 정답 = 최근 10회 기준 accuracy가 90% 미만이 되도록 뒤쪽에 오답 배치
    const graded = (date: string, tag: VerticalTag, oks: boolean[]): Day => ({
      date,
      kind: 'normal',
      sheet: oks.map((_, i) => ({
        id: `${date}-${i}`,
        kind: 'vertical' as const,
        tag,
        a: 25,
        b: 17,
        op: '+' as const,
        answer: 42,
      })),
      grades: Object.fromEntries(oks.map((ok, i) => [`${date}-${i}`, ok])),
    })
    const shaky = weeklyReport(
      [
        graded('2026-08-01', 'add2-carry', [
          true,
          true,
          true,
          true,
          true,
          false,
          false,
          false,
          true,
          true,
          true,
          false,
        ]),
      ],
      metaWith(null),
      TODAY,
    )
    const row = shaky.types.find((t) => t.tag === 'add2-carry')!
    expect(row.pct).not.toBeNull()
    expect(row.warn).toBe(true)

    const sparse = weeklyReport(
      [graded('2026-08-01', 'add2-carry', [true, true, false])],
      metaWith(null),
      TODAY,
    )
    const sparseRow = sparse.types.find((t) => t.tag === 'add2-carry')!
    expect(sparseRow.pct).toBeNull()
    expect(sparseRow.warn).toBe(false)
  })

  it('배운 방법 수와 전략 정답률 행이 리포트에 들어간다', () => {
    const stratDay = (date: string, id: string, correct: boolean, n: number): Day => ({
      date,
      kind: 'normal',
      sheet: [
        {
          id: `s-${date}-${n}`,
          kind: 'strategy',
          tag: id as StrategyId,
          a: 27,
          b: 15,
          op: '+',
          steps: [{ text: '27 + 3 = {}', blanks: [30] }],
          answer: 42,
        },
      ],
      grades: { [`s-${date}-${n}`]: correct },
    })
    // make-ten 12회(그중 최근 10회에 오답 4개 → 60%: warn), split-place 3회(표본 부족)
    const days = [
      ...Array.from({ length: 12 }, (_, i) =>
        stratDay(`2026-07-${String(10 + i).padStart(2, '0')}`, 'make-ten', i < 8, i),
      ),
      ...Array.from({ length: 3 }, (_, i) => stratDay(`2026-07-2${5 + i}`, 'split-place', true, i)),
    ]
    const w = weeklyReport(days, metaWith(null), '2026-08-03')
    expect(w.strategiesLearned).toBe(2)

    const makeTen = w.types.find((t) => t.tag === 'make-ten')!
    expect(makeTen.pct).not.toBeNull()
    // 브리프는 not.toBeNull()만 요구하지만, 그것만으로는 "최근 10회"가 아니라 "전체 12회"
    // 정답률(8/12 ≈ 66.7%)을 계산해도 통과한다(둘 다 90% 미만이라 warn도 true로 같다).
    // 정확한 60%를 찍어야 RECENT_WINDOW 슬라이딩이 실제로 적용됐음을 구분한다.
    expect(makeTen.pct).toBeCloseTo(0.6, 5)
    expect(makeTen.warn).toBe(true) // 최근 10회 중 정답 6 → 60% < 90%
    const splitPlace = w.types.find((t) => t.tag === 'split-place')!
    expect(splitPlace.pct).toBeNull() // 표본 부족 — 0%로 거짓말하지 않는다
    expect(splitPlace.warn).toBe(false)
  })

  it('전략이 한 번도 안 나왔으면 strategiesLearned 0, 전략 행 없음', () => {
    const w = weeklyReport([], metaWith(null), '2026-08-03')
    expect(w.strategiesLearned).toBe(0)
    expect(w.types.filter((t) => t.tag.startsWith('make-') || t.tag === 'anchor')).toEqual([])
  })

  it('가장 느린 식: 이번 주 정답 시도를 식별로 묶은 중앙값 최대', () => {
    const days = [
      sprintDay('2026-08-01', [
        { fact: '7×8', correct: true, ms: 3000 },
        { fact: '7×8', correct: true, ms: 3400 },
        { fact: '2×3', correct: true, ms: 900 },
        { fact: '9×9', correct: false, ms: 9000 }, // 오답은 후보가 아니다
      ]),
    ]
    const w = weeklyReport(days, metaWith(null), TODAY)
    expect(w.slowest).toEqual({ fact: '7×8', medianMs: 3200 })
  })

  it('30일 미백업이면 배지, 안이면 배지 없음, 한 번도 안 했으면 배지', () => {
    const days = [sprintDay('2026-08-01', [fast('2×3')])]
    expect(weeklyReport(days, metaWith(null), TODAY).exportOverdue).toBe(true)
    expect(weeklyReport(days, metaWith('2026-07-20T10:00:00.000Z'), TODAY).exportOverdue).toBe(
      false,
    )
    expect(weeklyReport(days, metaWith('2026-06-01T10:00:00.000Z'), TODAY).exportOverdue).toBe(true)
  })

  // brief의 세 케이스(14일/63일/null)는 경계값 30을 실제로 지나가지 않는다 — >= 30을 > 30으로
  // 잘못 써도 통과한다. 오늘(8/3)에서 정확히 30일·29일 전 시점을 직접 찍어 경계를 검사한다.
  it('30일 경계: 정확히 30일 지나면 배지, 29일이면 배지 없음', () => {
    const days = [sprintDay('2026-08-01', [fast('2×3')])]
    // 2026-07-04 → 2026-08-03: 정확히 30일 경과.
    expect(weeklyReport(days, metaWith('2026-07-04T10:00:00.000Z'), TODAY).exportOverdue).toBe(true)
    // 2026-07-05 → 2026-08-03: 29일 경과.
    expect(weeklyReport(days, metaWith('2026-07-05T10:00:00.000Z'), TODAY).exportOverdue).toBe(
      false,
    )
  })

  // validateBackup은 lastExportedAt을 typeof === 'string'까지만 보고 날짜 형식은 안 본다.
  // diffDays가 이런 값에서 NaN을 내면 `NaN >= 30`은 항상 false라 배지가 영영 안 뜬다 —
  // 서버 사본이 없는 앱의 유일한 안전망이 조용히 꺼지는 것이다. 값이 이상하면 "백업한
  // 적 없음"과 같게(배지를 띄우는 쪽으로) 취급해야 한다. 구현이 NaN을 그대로 통과시키면
  // 이 단언이 실패한다(false를 받게 된다).
  it('lastExportedAt이 날짜로 파싱되지 않으면 "백업한 적 없음"과 같이 배지를 띄운다', () => {
    const days = [sprintDay('2026-08-01', [fast('2×3')])]
    expect(weeklyReport(days, metaWith('이건-날짜가-아니다'), TODAY).exportOverdue).toBe(true)
  })
})

describe('latestCheckupReport', () => {
  const FLUENT_MS = 2500
  const fluentBy = (date: string, fact: string): Day => ({
    date,
    kind: 'normal',
    sheet: [],
    sprint: [
      { fact, correct: true, ms: 800 },
      { fact, correct: true, ms: 800 },
      { fact, correct: true, ms: 800 },
    ],
  })

  it('점검한 날이 없으면 null', () => {
    expect(latestCheckupReport([fluentBy('2026-08-01', '2×3')], FLUENT_MS)).toBeNull()
  })

  it('점검 세션이 유지/탈락을 가른다', () => {
    const days: Day[] = [
      fluentBy('2026-08-01', '2×3'),
      fluentBy('2026-08-02', '7×8'),
      {
        date: '2026-08-30',
        kind: 'checkup',
        sheet: [],
        sprint: [
          { fact: '2×3', correct: true, ms: 900 },
          { fact: '7×8', correct: false, ms: 5000 },
        ],
      },
    ]
    const r = latestCheckupReport(days, FLUENT_MS)!
    expect(r.date).toBe('2026-08-30')
    expect(r.tested).toBe(2)
    expect(r.kept).toEqual(['2×3'])
    expect(r.dropped).toEqual(['7×8'])
    expect(r.medianMs).toBe(900) // 정답 시도만
    expect(r.prevMedianMs).toBeNull()
  })

  // 실측(스펙 §5·§6 모순): composeCheckup은 fluent가 sprintCount를 넘으면 오래된 판정부터
  // 잘라내므로, 점검 세션이 fluent 전부를 물어보지 않는 날이 정상적으로 생긴다. 옛
  // 구현은 kept를 "이전에 fluent였던 전부 중 지금도 fluent"로 셌는데, 그러면 그날 아예
  // 안 물어본 4×5까지 "유지"로 잡힌다 — kept와 tested가 다른 모집단이 되어 화면이
  // 검증하지 않은 것을 검증했다고 말하는 상태다. 이 테스트는 물어보지 않은 fluent 식이
  // kept의 분모 밖에 있음을 직접 확인한다(구현이 옛 방식으로 되돌아가면 kept에 4×5가
  // 섞여 들어와 실패한다).
  it('그 세션이 물어보지 않은 fluent 식은 kept에 들어가지 않는다', () => {
    const days: Day[] = [
      fluentBy('2026-08-01', '2×3'),
      fluentBy('2026-08-02', '7×8'),
      fluentBy('2026-08-03', '4×5'), // 점검에서 물어보지 않을 것이다(count 제한으로 잘렸다고 가정)
      {
        date: '2026-08-30',
        kind: 'checkup',
        sheet: [],
        sprint: [
          { fact: '2×3', correct: true, ms: 900 },
          { fact: '7×8', correct: false, ms: 5000 },
          // 4×5는 없음 — 이전에 fluent였지만 이 세션은 묻지 않았다.
        ],
      },
    ]
    const r = latestCheckupReport(days, FLUENT_MS)!
    expect(r.tested).toBe(2)
    expect(r.kept).toEqual(['2×3'])
    expect(r.dropped).toEqual(['7×8'])
  })

  // brief 원본 픽스처는 점검이 둘뿐이라 "직전 것"과 "가장 오래된 것"이 같은 원소를
  // 가리켰다 — checkups[length-2]를 checkups[0](항상 가장 오래된 것)으로 잘못 짜도
  // 통과했다. 세 번째 점검을 더해 직전(950)과 최초(1200)를 서로 다른 값으로 갈랐다.
  it('세 번째 점검부터 직전 점검과 비교한다(최초 점검이 아니라)', () => {
    const checkup = (date: string, ms: number): Day => ({
      date,
      kind: 'checkup',
      sheet: [],
      sprint: [{ fact: '2×3', correct: true, ms }],
    })
    const days = [
      fluentBy('2026-08-01', '2×3'),
      checkup('2026-08-29', 1200),
      checkup('2026-09-26', 950),
      checkup('2026-10-24', 700),
    ]
    const r = latestCheckupReport(days, FLUENT_MS)!
    expect(r.date).toBe('2026-10-24')
    expect(r.medianMs).toBe(700)
    expect(r.prevMedianMs).toBe(950)
  })
})

describe('completedCount', () => {
  it('종이 채점과 스프린트를 둘 다 한 날만 센다', () => {
    const both: Day = {
      date: '2026-08-01',
      kind: 'normal',
      sheet: [],
      grades: { a: true },
      sprint: [fast('2×3')],
    }
    const paperOnly: Day = { date: '2026-08-02', kind: 'normal', sheet: [], grades: { a: true } }
    const sprintOnly: Day = { date: '2026-08-03', kind: 'normal', sheet: [], sprint: [fast('2×3')] }
    expect(completedCount([both, paperOnly, sprintOnly])).toBe(1)
  })
})
