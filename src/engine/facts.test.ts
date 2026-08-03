import { describe, it, expect } from 'vitest'
import {
  FACT_IDS,
  factId,
  factAnswer,
  deriveFacts,
  STREAK_TARGET,
  composeSprint,
  requeueWrong,
} from './facts'
import type { Day, SprintAttempt, FactState } from '../data/types'

function sprintDay(date: string, attempts: SprintAttempt[]): Day {
  return { date, kind: 'normal', sheet: [], sprint: attempts }
}

function hit(fact: string, ms: number): SprintAttempt {
  return { fact, correct: true, ms }
}

function miss(fact: string): SprintAttempt {
  return { fact, correct: false, ms: 9000 }
}

describe('식 목록', () => {
  it('FACT_IDS는 2×1~9×9, 72개다', () => {
    expect(FACT_IDS).toHaveLength(72)
    expect(new Set(FACT_IDS).size).toBe(72)
    expect(FACT_IDS).toContain('2×1')
    expect(FACT_IDS).toContain('7×8')
    expect(FACT_IDS).toContain('9×9')
    // 1단이 정말 빠졌는지 — 풀 축소가 한쪽만 됐다면 여기서 걸린다
    expect(FACT_IDS).not.toContain('1×1')
    expect(FACT_IDS).not.toContain('1×9')
    // ×1은 남는다 — "2단은 2×1부터"(사용자 결정)
    expect(FACT_IDS).toContain('2×1')
    expect(FACT_IDS).toContain('9×1')
  })

  it('factId는 곱셈 기호로 조합한다', () => {
    expect(factId(7, 8)).toBe('7×8')
    expect(FACT_IDS).toContain('7×8')
    expect(FACT_IDS).toContain('9×9')
  })
})

describe('factAnswer', () => {
  it('식 id에서 곱을 구한다', () => {
    expect(factAnswer('7×8')).toBe(56)
    expect(factAnswer('1×1')).toBe(1)
    expect(factAnswer('9×9')).toBe(81)
  })

  it('factId의 역함수다 — 81식 전부에서 왕복한다', () => {
    for (let a = 1; a <= 9; a++) {
      for (let b = 1; b <= 9; b++) {
        expect(factAnswer(factId(a, b))).toBe(a * b)
      }
    }
  })

  it('ASCII x는 던진다 — 곱셈 기호는 U+00D7이다', () => {
    expect(() => factAnswer('7x8')).toThrowError('factAnswer: 식 id 형식이 아니다: "7x8"')
  })

  it('구분자가 없으면 던진다', () => {
    expect(() => factAnswer('78')).toThrowError('factAnswer: 식 id 형식이 아니다: "78"')
  })

  it('숫자가 아닌 쪽이 있으면 던진다', () => {
    expect(() => factAnswer('a×8')).toThrowError('factAnswer: 식 id 형식이 아니다: "a×8"')
    expect(() => factAnswer('×8')).toThrowError('factAnswer: 식 id 형식이 아니다: "×8"')
  })
})

describe('deriveFacts', () => {
  it('기록이 없으면 전부 new다', () => {
    const facts = deriveFacts([], 2500)
    expect(Object.keys(facts)).toHaveLength(72)
    expect(facts['7×8']).toEqual({
      status: 'new',
      medianMs: null,
      streak: 0,
      interval: 1,
      nextDue: null,
    })
  })

  it('연속 3회 정답이고 중앙값이 기준 이하면 fluent다', () => {
    const facts = deriveFacts(
      [sprintDay('2026-08-01', [hit('7×8', 2000), hit('7×8', 2400), hit('7×8', 2200)])],
      2500,
    )
    expect(facts['7×8']!.status).toBe('fluent')
    expect(facts['7×8']!.streak).toBe(3)
    expect(facts['7×8']!.medianMs).toBe(2200)
  })

  it('중앙값이 기준을 1ms라도 넘으면 fluent가 아니다', () => {
    const facts = deriveFacts(
      [sprintDay('2026-08-01', [hit('7×8', 2501), hit('7×8', 2501), hit('7×8', 2501)])],
      2500,
    )
    expect(facts['7×8']!.status).toBe('learning')
  })

  it('정확히 기준값이면 fluent다 (경계는 이하)', () => {
    const facts = deriveFacts(
      [sprintDay('2026-08-01', [hit('7×8', 2500), hit('7×8', 2500), hit('7×8', 2500)])],
      2500,
    )
    expect(facts['7×8']!.status).toBe('fluent')
  })

  it('2회 연속으로는 fluent가 아니다', () => {
    const facts = deriveFacts([sprintDay('2026-08-01', [hit('7×8', 1000), hit('7×8', 1000)])], 2500)
    expect(facts['7×8']!.status).toBe('learning')
    expect(facts['7×8']!.streak).toBe(2)
  })

  it('오답은 learning으로 강등하고 streak와 간격을 되돌린다', () => {
    const facts = deriveFacts(
      [
        sprintDay('2026-08-01', [hit('7×8', 1000), hit('7×8', 1000), hit('7×8', 1000)]),
        sprintDay('2026-08-02', [miss('7×8')]),
      ],
      2500,
    )
    expect(facts['7×8']!.status).toBe('learning')
    expect(facts['7×8']!.streak).toBe(0)
    expect(facts['7×8']!.interval).toBe(1)
    expect(facts['7×8']!.nextDue).toBeNull()
  })

  it('fluent가 된 날 다음 등장일은 하루 뒤다', () => {
    const facts = deriveFacts(
      [sprintDay('2026-08-01', [hit('7×8', 1000), hit('7×8', 1000), hit('7×8', 1000)])],
      2500,
    )
    expect(facts['7×8']!.interval).toBe(1)
    expect(facts['7×8']!.nextDue).toBe('2026-08-02')
  })

  it('fluent를 유지하면 간격이 1 → 3 → 7 → 14로 늘고 14에서 멈춘다', () => {
    const days: Day[] = [
      sprintDay('2026-08-01', [hit('7×8', 1000), hit('7×8', 1000), hit('7×8', 1000)]),
      sprintDay('2026-08-02', [hit('7×8', 1000)]),
      sprintDay('2026-08-05', [hit('7×8', 1000)]),
      sprintDay('2026-08-12', [hit('7×8', 1000)]),
      sprintDay('2026-08-26', [hit('7×8', 1000)]),
    ]
    const at = (n: number) => deriveFacts(days.slice(0, n), 2500)['7×8']!
    expect(at(1).interval).toBe(1)
    expect(at(2).interval).toBe(3)
    expect(at(3).interval).toBe(7)
    expect(at(4).interval).toBe(14)
    expect(at(5).interval).toBe(14)
    expect(at(5).nextDue).toBe('2026-09-09')
  })

  it('스프린트가 없는 날은 건너뛴다', () => {
    const noSprint: Day = { date: '2026-08-01', kind: 'normal', sheet: [] }
    expect(deriveFacts([noSprint], 2500)['7×8']!.status).toBe('new')
  })

  it('같은 days를 두 번 넣어도 같은 결과다', () => {
    const days = [sprintDay('2026-08-01', [hit('7×8', 1000), miss('6×7')])]
    expect(deriveFacts(days, 2500)).toEqual(deriveFacts(days, 2500))
  })

  it('입력 days를 변형하지 않는다', () => {
    const days = [sprintDay('2026-08-01', [hit('7×8', 1000)])]
    const snapshot = JSON.stringify(days)
    deriveFacts(days, 2500)
    expect(JSON.stringify(days)).toBe(snapshot)
  })

  it('알 수 없는 식 id는 건너뛴다 (throw하지 않음)', () => {
    const days = [
      sprintDay('2026-08-01', [
        hit('7x8', 1000), // ASCII x (U+0078), 잘못된 형식 — 건너뜀
        hit('7×8', 1000), // 올바른 형식 — streak=1
        hit('7×8', 1000), // streak=2
        hit('12×13', 1000), // 범위 벗어남 (최대 9×9) — 건너뜀
        hit('7×8', 1000), // streak=3
      ]),
    ]
    // throw하지 않고 성공적으로 파생된다
    const facts = deriveFacts(days, 2500)
    // 올바른 '7×8'은 정상적으로 처리된다: 3회 정답이므로 fluent
    expect(facts['7×8']!.streak).toBe(3)
    expect(facts['7×8']!.status).toBe('fluent')
    expect(facts['7×8']!.medianMs).toBe(1000)
    // 전체 사실은 여전히 정확히 72개
    expect(Object.keys(facts)).toHaveLength(72)
    // 알 수 없는 id로 새로운 항목이 생성되지 않는다
    expect(facts['7x8']).toBeUndefined()
    expect(facts['12×13']).toBeUndefined()
  })

  it('STREAK_TARGET은 3이다', () => {
    expect(STREAK_TARGET).toBe(3)
  })
})

function lcg(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return s / 0x7fffffff
  }
}

function allNew(): Record<string, FactState> {
  const facts: Record<string, FactState> = {}
  for (const id of FACT_IDS) {
    facts[id] = { status: 'new', medianMs: null, streak: 0, interval: 1, nextDue: null }
  }
  return facts
}

describe('composeSprint', () => {
  it('요청한 개수만큼 낸다', () => {
    const out = composeSprint({ facts: allNew(), count: 30, today: '2026-08-02', rand: lcg(1) })
    expect(out).toHaveLength(30)
  })

  it('첫날에는 소수 식만 쓰고 반복해서 채운다', () => {
    const out = composeSprint({ facts: allNew(), count: 30, today: '2026-08-02', rand: lcg(1) })
    const unique = [...new Set(out)]
    // 15%가 신규 배분이므로 30문제면 서로 다른 식은 5개 이하여야 한다.
    // 30개를 전부 다른 식으로 내면 처음 만나는 아이에게 72식을 한꺼번에 들이미는 셈이다.
    // 어떤 식이 뽑히는지는 이제 무작위라(신규 도입 순서 폐기) 개수만 검증한다.
    expect(unique.length).toBeLessThanOrEqual(5)
  })

  it('learning이 충분하면 60% 가까이를 learning으로 채운다', () => {
    const facts = allNew()
    for (const id of FACT_IDS.slice(0, 40)) {
      facts[id] = { status: 'learning', medianMs: 3000, streak: 1, interval: 1, nextDue: null }
    }
    const out = composeSprint({ facts, count: 30, today: '2026-08-02', rand: lcg(7) })
    // 서로 다른 learning 식의 개수로 센다. 부족분을 채울 때 이미 고른 식이 반복되므로
    // 등장 횟수로 세면 18을 넘는다.
    const uniqueLearning = new Set(out.filter((id) => facts[id]!.status === 'learning'))
    expect(uniqueLearning.size).toBe(18)
  })

  it('due가 지난 fluent만 고르고 아직 이른 fluent는 안 고른다', () => {
    const facts = allNew()
    facts['2×2'] = {
      status: 'fluent',
      medianMs: 900,
      streak: 5,
      interval: 3,
      nextDue: '2026-08-01',
    }
    facts['2×3'] = {
      status: 'fluent',
      medianMs: 900,
      streak: 5,
      interval: 3,
      nextDue: '2026-08-02',
    }
    facts['2×4'] = {
      status: 'fluent',
      medianMs: 900,
      streak: 5,
      interval: 7,
      nextDue: '2026-09-01',
    }
    for (const id of FACT_IDS.slice(0, 40)) {
      if (facts[id]!.status === 'new') {
        facts[id] = { status: 'learning', medianMs: 3000, streak: 1, interval: 1, nextDue: null }
      }
    }
    const out = composeSprint({ facts, count: 30, today: '2026-08-02', rand: lcg(3) })
    expect(out).toContain('2×2')
    expect(out).toContain('2×3') // nextDue === today 는 due 다
    expect(out).not.toContain('2×4')
  })

  it('신규 도입은 rand에 따라 다르고, 같은 rand면 같다 — 무작위이되 결정적', () => {
    const facts = Object.fromEntries(
      FACT_IDS.map((id) => [
        id,
        { status: 'new', medianMs: null, streak: 0, interval: 1, nextDue: null },
      ]),
    ) as Record<string, FactState>
    const q1 = composeSprint({ facts, count: 30, today: '2026-08-04', rand: lcg(1) })
    const q2 = composeSprint({ facts, count: 30, today: '2026-08-04', rand: lcg(1) })
    const q3 = composeSprint({ facts, count: 30, today: '2026-08-04', rand: lcg(2) })
    expect(q1).toEqual(q2) // 같은 시드 → 같은 큐 (결정성)
    // 다른 시드 → 다른 신규 집합. 고정 순서 구현(옛 FACT_ORDER 앞자르기)이면 집합이 같아져 실패한다
    expect(new Set(q1)).not.toEqual(new Set(q3))
  })

  it('같은 입력과 같은 시드면 같은 결과다', () => {
    const a = composeSprint({ facts: allNew(), count: 30, today: '2026-08-02', rand: lcg(99) })
    const b = composeSprint({ facts: allNew(), count: 30, today: '2026-08-02', rand: lcg(99) })
    expect(a).toEqual(b)
  })

  it('낼 수 있는 식이 하나뿐이어도 개수를 채운다', () => {
    const facts = allNew()
    for (const id of FACT_IDS) {
      facts[id] = {
        status: 'fluent',
        medianMs: 900,
        streak: 5,
        interval: 14,
        nextDue: '2027-01-01',
      }
    }
    facts['7×8'] = { status: 'learning', medianMs: 4000, streak: 0, interval: 1, nextDue: null }
    const out = composeSprint({ facts, count: 30, today: '2026-08-02', rand: lcg(5) })
    expect(out).toHaveLength(30)
    expect(out.filter((id) => id === '7×8').length).toBeGreaterThan(0)
  })

  it('count: 0은 빈 배열을 반환하고 예외를 던지지 않는다', () => {
    const out = composeSprint({ facts: allNew(), count: 0, today: '2026-08-02' })
    expect(out).toEqual([])
  })

  it('72식이 전부 fluent이고 아무것도 due가 아니면 가장 빨리 돌아올 식부터 복습한다', () => {
    const facts = allNew()
    for (const id of FACT_IDS) {
      facts[id] = {
        status: 'fluent',
        medianMs: 900,
        streak: 5,
        interval: 14,
        nextDue: '2027-01-01',
      }
    }
    // 9×9를 가장 빨리 돌아올 식으로 설정 (FACT_IDS의 마지막이므로 정렬이 필요함)
    facts['9×9'] = {
      status: 'fluent',
      medianMs: 900,
      streak: 5,
      interval: 14,
      nextDue: '2026-08-05',
    }
    // 2×1을 그 다음으로 설정
    facts['2×1'] = {
      status: 'fluent',
      medianMs: 900,
      streak: 5,
      interval: 14,
      nextDue: '2026-08-10',
    }
    const out = composeSprint({ facts, count: 1, today: '2026-08-02', rand: lcg(42) })
    // 정렬이 작동하지 않으면 FACT_IDS의 처음 fluent 식인 2×1이 나온다.
    // 정렬이 작동하면 nextDue가 가장 빠른 9×9가 나온다.
    expect(out).toEqual(['9×9'])
  })

  it('facts가 비어있으면 특정 메시지와 함께 throw한다', () => {
    expect(() => composeSprint({ facts: {}, count: 5, today: '2026-08-02' })).toThrow(
      'composeSprint: 낼 수 있는 식이 없다',
    )
  })
})

describe('requeueWrong', () => {
  it('틀린 식을 몇 문제 뒤에 다시 넣는다', () => {
    const out = requeueWrong(['a', 'b', 'c', 'd', 'e', 'f'], '7×8', 4)
    expect(out).toEqual(['a', 'b', 'c', 'd', '7×8', 'e', 'f'])
  })

  it('남은 문제가 간격보다 적으면 맨 뒤에 붙인다', () => {
    expect(requeueWrong(['a'], '7×8', 4)).toEqual(['a', '7×8'])
    expect(requeueWrong([], '7×8', 4)).toEqual(['7×8'])
  })

  it('원본 배열을 변형하지 않는다', () => {
    const original = ['a', 'b']
    requeueWrong(original, '7×8', 1)
    expect(original).toEqual(['a', 'b'])
  })
})
