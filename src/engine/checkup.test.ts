import { describe, it, expect } from 'vitest'
import {
  checkupDue,
  checkupNoticeDate,
  nextCheckupDate,
  composeCheckup,
  CHECKUP_MIN_FLUENT,
} from './checkup'
import { deriveFacts } from './facts'
import { shiftDay } from './dates'
import type { Day, FactState } from '../data/types'

/**
 * 빠른 정답 3연속으로 facts 전부를 그 날 fluent로 만드는 Day.
 * 게이트가 CHECKUP_MIN_FLUENT(현재 10)라 fluent 1개짜리 픽스처로는 due를 못 만든다 —
 * 여러 식을 한 번에 넘겨 채운다.
 */
function fluentDay(date: string, facts: string[]): Day {
  const sprint = facts.flatMap((fact) => [
    { fact, correct: true, ms: 800 },
    { fact, correct: true, ms: 800 },
    { fact, correct: true, ms: 800 },
  ])
  return { date, kind: 'normal', sheet: [], sprint }
}

/**
 * 게이트를 채우는 데 쓰는 서로 다른 10개 식. 값 자체엔 의미가 없다 — 개수만 중요하다.
 * 단 풀(2×1~9×9) 안에서 골라야 한다 — 1단은 더 이상 풀에 없어 deriveFacts가 조용히
 * 건너뛰므로, 1×n을 쓰면 fluent 개수가 기대보다 적게 나온다(Phase 4에서 실제로 겪은 실패).
 */
const TEN_FACTS = ['2×1', '2×2', '2×4', '2×5', '2×6', '2×7', '2×8', '2×9', '3×1', '3×2']

const FLUENT_MS = 2500

/**
 * 실제로 점검을 한 날. 시도 하나면 충분하다 — checkupDays는 개수만 본다.
 * 이름을 엔진의 checkupDays와 한 글자 차이로 두지 않는다(리뷰 R3 M-3).
 */
const doneCheckup = (date: string): Day => ({
  date,
  kind: 'checkup',
  sheet: [],
  sprint: [{ fact: '2×3', correct: true, ms: 800 }],
})

describe('nextCheckupDate / checkupDue', () => {
  it('fluent 식이 없으면 점검은 없다', () => {
    const slow: Day = {
      date: '2026-08-01',
      kind: 'normal',
      sheet: [],
      sprint: [{ fact: '2×3', correct: true, ms: 4000 }],
    }
    expect(nextCheckupDate([slow], FLUENT_MS)).toBeNull()
    expect(checkupDue([slow], FLUENT_MS, '2026-12-31')).toBe(false)
  })

  it('첫 스프린트일 + 28일에 due가 된다', () => {
    const days = [fluentDay('2026-08-01', TEN_FACTS)]
    expect(nextCheckupDate(days, FLUENT_MS)).toBe('2026-08-29')
    expect(checkupDue(days, FLUENT_MS, '2026-08-28')).toBe(false)
    expect(checkupDue(days, FLUENT_MS, '2026-08-29')).toBe(true)
    expect(checkupDue(days, FLUENT_MS, '2026-09-15')).toBe(true) // 밀려도 due는 유지
  })

  it('점검을 마친 날이 새 기준점이 된다 — 완료 직후 due가 풀린다', () => {
    const days: Day[] = [
      fluentDay('2026-08-01', TEN_FACTS),
      {
        date: '2026-08-29',
        kind: 'checkup',
        sheet: [],
        sprint: [{ fact: '2×3', correct: true, ms: 900 }],
      },
    ]
    expect(nextCheckupDate(days, FLUENT_MS)).toBe('2026-09-26')
    expect(checkupDue(days, FLUENT_MS, '2026-08-29')).toBe(false)
  })

  it('sprint가 없는 checkup 날은 기준점이 아니다', () => {
    // 방어: 어떤 경로로든 시도 없는 checkup Day가 생겨도 점검을 건너뛴 것으로 치지 않는다.
    const days: Day[] = [
      fluentDay('2026-08-01', TEN_FACTS),
      { date: '2026-08-29', kind: 'checkup', sheet: [] },
    ]
    expect(nextCheckupDate(days, FLUENT_MS)).toBe('2026-08-29')
  })
})

describe('CHECKUP_MIN_FLUENT 게이트', () => {
  it('fluent가 상수보다 하나 적으면 점검이 없다', () => {
    const days = [fluentDay('2026-08-01', TEN_FACTS.slice(0, CHECKUP_MIN_FLUENT - 1))]
    expect(nextCheckupDate(days, FLUENT_MS)).toBeNull()
    expect(checkupDue(days, FLUENT_MS, '2026-12-31')).toBe(false)
  })

  it('fluent가 상수에 정확히 도달하면 점검이 돌기 시작한다', () => {
    const days = [fluentDay('2026-08-01', TEN_FACTS.slice(0, CHECKUP_MIN_FLUENT))]
    expect(nextCheckupDate(days, FLUENT_MS)).toBe('2026-08-29')
    expect(checkupDue(days, FLUENT_MS, '2026-08-29')).toBe(true)
  })
})

describe('composeCheckup', () => {
  /** 유창 판정일이 judgedAt인 fluent 상태. nextDue = judgedAt + interval (deriveFacts와 같은 규칙). */
  function fluentState(judgedAt: string, interval: 1 | 3 | 7 | 14): FactState {
    return {
      status: 'fluent',
      medianMs: 900,
      streak: 3,
      interval,
      nextDue: shiftDay(judgedAt, interval),
    }
  }
  const learning: FactState = {
    status: 'learning',
    medianMs: null,
    streak: 1,
    interval: 1,
    nextDue: null,
  }
  const fresh: FactState = { status: 'new', medianMs: null, streak: 0, interval: 1, nextDue: null }

  it('fluent만, 각 한 번씩 낸다 — 드릴이 아니라 측정이다', () => {
    const facts = {
      '2×3': fluentState('2026-08-01', 7),
      '3×4': fluentState('2026-08-10', 3),
      '4×5': learning,
      '5×6': fresh,
    }
    const queue = composeCheckup(facts, 30)
    expect([...queue].sort()).toEqual(['2×3', '3×4'])
  })

  it('count를 넘으면 마지막 유창 판정이 오래된 순으로 자른다', () => {
    const facts = {
      // interval을 서로 다르게 준 이유는 judgedAt 정렬과 생 nextDue 정렬이 다른 집합을
      // 고르게 만들기 위해서다. 값을 '정리'하면 이 테스트가 아무것도 못 잡는 상태로 돌아간다.
      '2×3': fluentState('2026-08-01', 1), // judgedAt 기준: 가장 오래됨(08-01)
      '3×4': fluentState('2026-08-05', 14), // judgedAt 기준: 중간(08-05), nextDue는 08-19로 가장 최신
      '4×5': fluentState('2026-08-10', 1), // judgedAt 기준: 최신(08-10), nextDue는 08-11로 가운데
    }
    const queue = composeCheckup(facts, 2)
    // judgedAt 오름차순 정렬 후 count=2이면 '2×3', '3×4'가 선택되어야 한다.
    expect([...queue].sort()).toEqual(['2×3', '3×4'])
  })

  it('fluent가 count보다 적으면 세션이 그만큼 짧다 — learning으로 채우지 않는다', () => {
    const facts = { '2×3': fluentState('2026-08-01', 7), '4×5': learning }
    expect(composeCheckup(facts, 30)).toEqual(['2×3'])
  })

  it('주입한 난수로 결정적이다', () => {
    const facts = {
      '2×3': fluentState('2026-08-01', 7),
      '3×4': fluentState('2026-08-02', 7),
      '4×5': fluentState('2026-08-03', 7),
    }
    const rand = () => 0.5
    expect(composeCheckup(facts, 30, rand)).toEqual(composeCheckup(facts, 30, rand))
  })
})

describe('점검 시도의 판정 반영 — 강등 로직 없음의 증명', () => {
  it('점검에서 틀린 식은 derive만으로 fluent에서 내려온다', () => {
    const log: Day[] = [
      fluentDay('2026-08-01', ['2×3']),
      {
        date: '2026-08-29',
        kind: 'checkup',
        sheet: [],
        sprint: [{ fact: '2×3', correct: false, ms: 4000 }],
      },
    ]
    expect(deriveFacts(log.slice(0, 1), FLUENT_MS)['2×3']!.status).toBe('fluent')
    expect(deriveFacts(log, FLUENT_MS)['2×3']!.status).toBe('learning')
  })
})

describe('checkupNoticeDate', () => {
  it('점검 기록이 없으면 안내가 없다', () => {
    expect(checkupNoticeDate([], '2026-09-02')).toBeNull()
    // kind가 normal이면 스프린트가 있어도 점검이 아니다.
    expect(checkupNoticeDate([fluentDay('2026-08-29', TEN_FACTS)], '2026-09-02')).toBeNull()
  })

  it('점검 당일에 보인다', () => {
    expect(checkupNoticeDate([doneCheckup('2026-08-29')], '2026-08-29')).toBe('2026-08-29')
  })

  it('점검일 + 6일까지 보인다', () => {
    expect(checkupNoticeDate([doneCheckup('2026-08-29')], '2026-09-04')).toBe('2026-08-29')
  })

  it('점검일 + 7일에는 사라진다 — 경계', () => {
    expect(checkupNoticeDate([doneCheckup('2026-08-29')], '2026-09-05')).toBeNull()
  })

  it('미래 날짜 점검은 안내하지 않는다', () => {
    // 가져온 백업에 시계가 틀린 기기의 미래 날짜가 섞일 수 있다 —
    // validateBackup은 날짜 형식만 보고 범위는 보지 않는다.
    expect(checkupNoticeDate([doneCheckup('2026-09-10')], '2026-09-05')).toBeNull()
  })

  it('점검이 둘이면 최근 것을 기준으로 잰다', () => {
    const days = [doneCheckup('2026-08-29'), doneCheckup('2026-09-26')]
    expect(checkupNoticeDate(days, '2026-09-27')).toBe('2026-09-26')
  })

  it('최근 점검이 미래면 기간 안의 옛 점검도 찾지 않는다', () => {
    // 옛 점검(08-29)은 today(09-01) 기준 +3일이라 기간 안이지만, 이 함수는
    // 가장 최근 점검 하나만 본다(설계 §2-1).
    const days = [doneCheckup('2026-08-29'), doneCheckup('2026-09-26')]
    expect(checkupNoticeDate(days, '2026-09-01')).toBeNull()
  })

  it('sprint가 빈 checkup 날은 점검을 한 날이 아니다', () => {
    const days: Day[] = [{ date: '2026-09-01', kind: 'checkup', sheet: [], sprint: [] }]
    expect(checkupNoticeDate(days, '2026-09-01')).toBeNull()
  })
})
