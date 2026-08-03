import { describe, it, expect } from 'vitest'
import { STRATEGY_CATALOG, STRATEGY_NAMES, MUL_STRATEGY_MIN_FLUENT } from './strategy'
import { carryCount, borrowCount } from './vertical'

function lcg(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return s / 0x7fffffff
  }
}
const byId = Object.fromEntries(STRATEGY_CATALOG.map((s) => [s.id, s]))

describe('카탈로그 공통 성질', () => {
  it('8종이 스펙 도입 순서대로 있다', () => {
    expect(STRATEGY_CATALOG.map((s) => s.id)).toEqual([
      'make-ten',
      'split-place',
      'round-adjust',
      'split-subtrahend',
      'anchor',
      'count-up',
      'double',
      'minus-one',
    ])
  })

  it('모든 전략: steps의 마지막 빈칸이 최종 답이고, 각 빈칸 수는 자리에 맞는 산술 결과다', () => {
    const rand = lcg(7)
    for (const def of STRATEGY_CATALOG) {
      for (let i = 0; i < 50; i++) {
        const { a, b } = def.gen(rand)
        const steps = def.steps(a, b)
        const answer = def.op === '+' ? a + b : def.op === '−' ? a - b : a * b
        const last = steps[steps.length - 1]!
        // 마지막 step의 마지막 빈칸 = 최종 답 (채점 계약)
        expect(last.blanks[last.blanks.length - 1], `${def.id} ${a}${def.op}${b}`).toBe(answer)
        // 각 step의 {} 개수와 blanks 길이가 일치 — 렌더러 계약
        for (const st of steps) {
          expect((st.text.match(/\{\}/g) ?? []).length, `${def.id}: ${st.text}`).toBe(
            st.blanks.length,
          )
        }
      }
    }
  })

  it('applicable은 gen이 만든 수 조합에 참이다 (조건-생성기 정합)', () => {
    const rand = lcg(11)
    for (const def of STRATEGY_CATALOG) {
      for (let i = 0; i < 50; i++) {
        const { a, b } = def.gen(rand)
        expect(def.applicable(a, b), `${def.id} ${a},${b}`).toBe(true)
      }
    }
  })

  it('STRATEGY_NAMES는 8종 전부의 비어 있지 않은 한국어 이름을 담는다', () => {
    for (const def of STRATEGY_CATALOG) {
      expect(typeof STRATEGY_NAMES[def.id], def.id).toBe('string')
      expect(STRATEGY_NAMES[def.id]!.length, def.id).toBeGreaterThan(0)
    }
  })
})

describe('전략별 강한 조건 (독립 술어)', () => {
  const rand = lcg(23)
  const many = (id: string) => Array.from({ length: 80 }, () => byId[id]!.gen(rand))

  it('make-ten: 받아올림 있는 두 자리 덧셈, 보수 이동이 성립한다', () => {
    for (const { a, b } of many('make-ten')) {
      expect(a).toBeGreaterThanOrEqual(11)
      expect(b).toBeLessThanOrEqual(89)
      expect(carryCount(a, b)).toBeGreaterThanOrEqual(1) // 받아올림 없으면 10 만들 이유가 없다
      expect((a % 10) + (b % 10)).toBeGreaterThan(10) // b에서 옮길 몫이 1 이상 남아야 한다
    }
  })

  it('split-place: 받아내림 없는 두 자리 뺄셈', () => {
    for (const { a, b } of many('split-place')) {
      expect(a).toBeGreaterThan(b)
      expect(borrowCount(a, b)).toBe(0)
      expect(Math.floor(b / 10)).toBeGreaterThanOrEqual(1) // 십의 자리가 있어야 자리로 나눈다
    }
  })

  it('round-adjust: 더하는 수의 일의 자리가 8·9', () => {
    for (const { b } of many('round-adjust')) expect([8, 9]).toContain(b % 10)
  })

  it('split-subtrahend: 빼는 수가 두 자리이고 일의 자리가 0이 아니다', () => {
    for (const { a, b } of many('split-subtrahend')) {
      expect(a).toBeGreaterThan(b)
      expect(b).toBeGreaterThanOrEqual(11)
      expect(b % 10).not.toBe(0) // 0이면 두 번째 단계가 "−0"이 된다
    }
  })

  it('anchor: 빼는 수의 일의 자리가 9', () => {
    for (const { a, b } of many('anchor')) {
      expect(b % 10).toBe(9)
      expect(a).toBeGreaterThan(b + 1) // b+1을 먼저 빼므로
    }
  })

  it('count-up: 두 수가 가깝고(차 15 이하) b가 10의 배수가 아니다', () => {
    for (const { a, b } of many('count-up')) {
      expect(a - b).toBeGreaterThanOrEqual(3)
      expect(a - b).toBeLessThanOrEqual(15)
      expect(b % 10).not.toBe(0)
      expect(Math.ceil(b / 10) * 10).toBeLessThan(a) // 중간 정거장(다음 10)이 a 앞에 있어야 한다
    }
  })

  it('double: 곱하는 수가 4 이상의 짝수', () => {
    for (const { a, b } of many('double')) {
      expect(a).toBeGreaterThanOrEqual(2)
      expect(a).toBeLessThanOrEqual(9)
      expect(b % 2).toBe(0)
      expect(b).toBeGreaterThanOrEqual(4) // b=2면 "절반 후 두 배"가 ×1 경유라 무의미
    }
  })

  it('minus-one: 곱하는 수가 9', () => {
    for (const { a, b } of many('minus-one')) {
      expect(b).toBe(9)
      expect(a).toBeGreaterThanOrEqual(2)
    }
  })
})

describe('steps 예시 (스펙 §3 표)', () => {
  it('make-ten 27+15', () => {
    expect(byId['make-ten']!.steps(27, 15)).toEqual([
      { text: '27 + 3 = {}', blanks: [30] },
      { text: '30 + 12 = {}', blanks: [42] },
    ])
  })
  it('split-place 68−25', () => {
    expect(byId['split-place']!.steps(68, 25)).toEqual([
      { text: '60 − 20 = {}', blanks: [40] },
      { text: '8 − 5 = {}', blanks: [3] },
      { text: '합치면  68 − 25 = {}', blanks: [43] },
    ])
  })
  it('anchor 52−19', () => {
    expect(byId['anchor']!.steps(52, 19)).toEqual([
      { text: '52 − 20 = {}', blanks: [32] },
      { text: '32 + 1 = {}', blanks: [33] },
    ])
  })
  it('count-up 63−28', () => {
    expect(byId['count-up']!.steps(63, 28)).toEqual([
      { text: '28에서 30까지 {}', blanks: [2] },
      { text: '30에서 63까지 {}', blanks: [33] },
      { text: '합치면 {}', blanks: [35] },
    ])
  })
  it('double 7×8', () => {
    expect(byId['double']!.steps(7, 8)).toEqual([
      { text: '7 × 4 = {}', blanks: [28] },
      { text: '28 × 2 = {}', blanks: [56] },
    ])
  })
  it('minus-one 7×9', () => {
    expect(byId['minus-one']!.steps(7, 9)).toEqual([
      { text: '10 × 7 = {}', blanks: [70] },
      { text: '70 − 7 = {}', blanks: [63] },
    ])
  })
  it('round-adjust 27+19', () => {
    expect(byId['round-adjust']!.steps(27, 19)).toEqual([
      { text: '27 + 20 = {}', blanks: [47] },
      { text: '47 − 1 = {}', blanks: [46] },
    ])
  })
  it('split-subtrahend 63−28', () => {
    expect(byId['split-subtrahend']!.steps(63, 28)).toEqual([
      { text: '63 − 20 = {}', blanks: [43] },
      { text: '43 − 8 = {}', blanks: [35] },
    ])
  })
})
