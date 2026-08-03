import { describe, it, expect } from 'vitest'
import { checkupDue, nextCheckupDate, composeCheckup } from './checkup'
import { deriveFacts } from './facts'
import { shiftDay } from './dates'
import type { Day, FactState } from '../data/types'

/** 빠른 정답 3연속 → 그 식은 fluent가 된다. */
function fluentDay(date: string, fact: string): Day {
  const a = { fact, correct: true, ms: 800 }
  return { date, kind: 'normal', sheet: [], sprint: [a, a, a] }
}

const FLUENT_MS = 2500

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
    const days = [fluentDay('2026-08-01', '2×3')]
    expect(nextCheckupDate(days, FLUENT_MS)).toBe('2026-08-29')
    expect(checkupDue(days, FLUENT_MS, '2026-08-28')).toBe(false)
    expect(checkupDue(days, FLUENT_MS, '2026-08-29')).toBe(true)
    expect(checkupDue(days, FLUENT_MS, '2026-09-15')).toBe(true) // 밀려도 due는 유지
  })

  it('점검을 마친 날이 새 기준점이 된다 — 완료 직후 due가 풀린다', () => {
    const days: Day[] = [
      fluentDay('2026-08-01', '2×3'),
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
      fluentDay('2026-08-01', '2×3'),
      { date: '2026-08-29', kind: 'checkup', sheet: [] },
    ]
    expect(nextCheckupDate(days, FLUENT_MS)).toBe('2026-08-29')
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
      fluentDay('2026-08-01', '2×3'),
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
