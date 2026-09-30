import { describe, it, expect } from 'vitest'
import { weeklyReport, latestCheckupReport, daysSinceExport, wordReport } from './report'
import { makeProblem } from './word'
import { DEFAULT_SETTINGS, emptyDerived } from '../data/types'
import type { Day, Meta, WordAttempt } from '../data/types'

const TODAY = '2026-08-03'

function metaWith(lastExportedAt: string | null): Meta {
  return {
    derived: emptyDerived(),
    settings: { ...DEFAULT_SETTINGS, lastExportedAt },
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
    expect(w.newlyFluent).toEqual([])
    expect(w.weekMedianMs).toBeNull()
    expect(w.prevWeekMedianMs).toBeNull()
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

describe('daysSinceExport', () => {
  it('백업한 적이 없으면 null이다', () => {
    expect(daysSinceExport(metaWith(null), TODAY)).toBeNull()
  })

  it('마지막 백업으로부터 지난 일수를 준다', () => {
    expect(daysSinceExport(metaWith('2026-07-31T12:00:00.000Z'), TODAY)).toBe(3)
  })

  it('같은 날 백업했으면 0이다', () => {
    expect(daysSinceExport(metaWith('2026-08-03T12:00:00.000Z'), TODAY)).toBe(0)
  })

  it('날짜로 파싱되지 않는 값은 null이다 — NaN을 흘리면 30일 배지가 영원히 안 뜬다', () => {
    expect(daysSinceExport(metaWith('이건-날짜가-아니다'), TODAY)).toBeNull()
  })
})

describe('wordReport', () => {
  const TODAY = '2026-10-28'
  let n = 0
  function att(
    type: Parameters<typeof makeProblem>[0],
    ok: boolean,
    over: Partial<WordAttempt> = {},
  ): WordAttempt {
    const p = makeProblem(type, () => 0.5)
    const picks: number[] = []
    const calcs: number[] = []
    for (const s of p.review) {
      if (s.kind === 'story' || s.kind === 'expr') picks.push(s.correct)
      else calcs.push(s.value)
    }
    return {
      sid: `d:${n++}`,
      problem: p,
      answer: ok ? p.answer : p.answer + 1,
      exprs: ['1+1'],
      ms: 1,
      picks: ok ? [] : picks,
      calcs: ok ? [] : calcs,
      ...over,
    }
  }
  const day = (date: string, word: WordAttempt[]): Day => ({
    date,
    kind: 'normal',
    sheet: [],
    sprint: [{ fact: '2×2', correct: true, ms: 1 }],
    word,
  })

  it('이번 주는 최근 7일, 끝난 문항만', () => {
    const r = wordReport(
      [
        day('2026-10-21', [att('join:whole', true)]),
        day('2026-10-22', [att('join:whole', true), att('join:whole', false)]),
        day('2026-10-28', [att('join:whole', false, { answer: null, picks: [], calcs: [] })]),
      ],
      TODAY,
    )
    expect(r.weekDays).toBe(1)
    expect([r.weekCorrect, r.weekTotal]).toEqual([1, 2])
  })

  it('묶음표는 최근 28일, 표본 3 미만 표시, 약한 세부 유형은 n ≥ 4 ∧ ≤ 50%', () => {
    const w = [
      ...Array.from({ length: 4 }, (_, i) => att('change:inc-start', i === 0)),
      att('change:inc-end', true),
      att('join:whole', true),
    ]
    const r = wordReport(
      [day('2026-10-20', w), day('2026-09-01', [att('compare:diff', false)])],
      TODAY,
    )
    const change = r.groups.find((g) => g.group === 'change')!
    expect([change.correct, change.total]).toEqual([2, 5])
    expect(change.weak.map((x) => x.type)).toEqual(['change:inc-start'])
    const join = r.groups.find((g) => g.group === 'join')!
    expect(join.total).toBe(1)
    expect(r.groups.find((g) => g.group === 'compare')!.total).toBe(0)
  })

  it('정답률 75%인 유형은 표본이 충분해도 약하지 않다(경계 위)', () => {
    const w = Array.from({ length: 4 }, (_, i) => att('join:part', i !== 0))
    const r = wordReport([day('2026-10-27', w)], TODAY)
    expect(r.groups.find((g) => g.group === 'join')!.weak).toEqual([])
  })

  it('원인 분포와 단어 반응 추정', () => {
    const p = makeProblem('change:inc-start', () => 0.5)
    const kw = p.wrongs.find((w) => w.cause === 'keyword')!.value
    const good = att('change:inc-start', false)
    const guessed = { ...good, sid: 'k', answer: kw }
    const r = wordReport([day('2026-10-27', [good, guessed, att('join:whole', false)])], TODAY)
    expect(r.causes.slip).toBe(3)
    expect(r.keyword).toEqual({ guessed: 1, trapWrong: 2 })
  })

  it('최근 틀린 문제는 최신순 3개, 모르는 유형은 묶음에 넣지 않는다', () => {
    const odd = {
      ...att('join:whole', false),
      problem: { ...makeProblem('join:whole', () => 0.5), type: 'future:x' },
    }
    const r = wordReport(
      [
        day('2026-10-24', [att('join:whole', false)]),
        day('2026-10-25', [att('join:part', false)]),
        day('2026-10-26', [att('compare:diff', false), odd]),
      ],
      TODAY,
    )
    expect(r.recent.map((x) => x.date)).toEqual(['2026-10-26', '2026-10-26', '2026-10-25'])
    expect(r.groups.reduce((s, g) => s + g.total, 0)).toBe(3)
  })
})
