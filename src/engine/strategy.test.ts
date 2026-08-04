import { describe, it, expect } from 'vitest'
import {
  STRATEGY_CATALOG,
  STRATEGY_NAMES,
  MUL_STRATEGY_MIN_FLUENT,
  composeStrategyItems,
} from './strategy'
import { carryCount, borrowCount } from './vertical'
import type { FactState, StrategyState } from '../data/types'

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
      expect(b % 10).not.toBe(0) // 0이면 일의 자리 단계가 "x − 0"이 된다(리뷰 발견 1)
      expect(Math.floor(a / 10)).not.toBe(Math.floor(b / 10)) // 같으면 십의 자리 단계가 "x − x = 0"이 된다
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

// 위 "강한 조건" 테스트들은 gen이 만든(=이미 applicable을 통과한) 값만 본다 — 절이
// 지워지는 변이(예: split-place의 자리 가드 삭제)를 못 잡는다. applicable(a,b) === false를
// 직접 단언해 그 구멍을 메운다. Task 5가 composeStrategyItems에서 applicable을
// 외부 수쌍에 직접 부르기 시작하면 이 방향의 보증이 실제로 쓰인다.
describe('applicable이 거부해야 하는 수쌍 (음의 방향)', () => {
  const rejects: Array<{ id: string; a: number; b: number; why: string }> = [
    // 컨트롤러가 준 예시는 (35,30)였으나 35·30은 십의 자리도 같아(3=3) 두 가드를
    // 동시에 위반한다 — b % 10 !== 0 가드 하나만 지우는 변이를 놓친다(직접 검증함,
    // task-4-report.md 참고). (51,20)은 십의 자리가 달라(5≠2) 일의 자리 가드만 고립한다.
    { id: 'split-place', a: 51, b: 20, why: '일의 자리가 0 — "1 − 0" 단계가 무의미(리뷰 발견 1)' },
    {
      id: 'split-place',
      a: 38,
      b: 35,
      why: '십의 자리가 같음(3=3) — "30 − 30 = 0" 단계가 무의미(리뷰 발견 1)',
    },
    { id: 'make-ten', a: 23, b: 14, why: '받아올림이 없다(carryCount=0) — 10 만들 이유가 없다' },
    // 재리뷰에서 (27,15)가 부적절함이 지적됐다: b=15는 b>=18도 위반하고 b%10도
    // {8,9} 밖이라 두 절을 동시에 위반한다 — [8,9].includes(b%10) 하나만 지우는
    // 변이가 b>=18 경로로 여전히 false를 반환해 이 행을 통과시켜 버린다. (27,25)는
    // b=25>=18을 만족하면서 일의 자리만 8·9가 아니므로 그 절 하나만 고립한다.
    {
      id: 'round-adjust',
      a: 27,
      b: 25,
      why: 'b의 일의 자리가 5 — 8·9가 아니면 어림할 이유가 없다',
    },
    { id: 'anchor', a: 52, b: 18, why: 'b의 일의 자리가 8 — 9가 아니면 기준수가 안 맞는다' },
    {
      id: 'count-up',
      a: 63,
      b: 28,
      // 다섯 절 중 `a - b <= 15` 하나만 위반한다(차 35, b%10=8≠0, next10=30<63, b=28>=11) —
      // 격리 성립. 스펙 원문이 예시로 쓰던 조합이지만 교육과정 리뷰가 근접 쌍(62−58)으로
      // 교체했다: 차가 크면 중간 빈칸("30에서 63까지")이 그 자체로 두 자리 뺄셈이 되어
      // 전략의 이점이 사라진다. 그래서 여기 거부 표에만 남는다.
      why: '차가 35로 15를 넘는다 — 세어가기엔 너무 멀다',
    },
    { id: 'double', a: 7, b: 9, why: 'b가 홀수 — 절반을 정수로 나눌 수 없다' },
    { id: 'minus-one', a: 7, b: 8, why: 'b가 9가 아니다 — "10배에서 하나 빼기"가 성립하지 않는다' },
    {
      id: 'split-subtrahend',
      a: 63,
      b: 20,
      why: 'b의 일의 자리가 0 — 두 번째 단계가 "x − 0"이 된다',
    },
  ]
  for (const { id, a, b, why } of rejects) {
    it(`${id}(${a},${b})는 거부된다 — ${why}`, () => {
      expect(byId[id]!.applicable(a, b), why).toBe(false)
    })
  }

  it('split-place(68,25)는 여전히 허용된다 — 새 가드가 정상 케이스를 막지 않는다', () => {
    expect(byId['split-place']!.applicable(68, 25)).toBe(true)
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
      { text: '합치면 68 − 25 = {}', blanks: [43] },
    ])
  })
  it('anchor 52−19', () => {
    expect(byId['anchor']!.steps(52, 19)).toEqual([
      { text: '52 − 20 = {}', blanks: [32] },
      { text: '32 + 1 = {}', blanks: [33] },
    ])
  })
  it('count-up 62−58 — applicable 영역 안의 근접 쌍 (63−28은 차 35라 gen이 만들지 않는다)', () => {
    // 테스트 이름이 "applicable 영역 안"이라고 주장하므로 그것부터 검사한다 — 이 줄이
    // 없으면 예시가 다시 영역 밖으로 흘러가도(예전 63−28처럼) 아무도 알아채지 못한다.
    expect(byId['count-up']!.applicable(62, 58)).toBe(true)
    expect(byId['count-up']!.steps(62, 58)).toEqual([
      { text: '58에서 60까지 {}', blanks: [2] },
      { text: '60에서 62까지 {}', blanks: [2] },
      { text: '합치면 {}', blanks: [4] },
    ])
  })
  it('double 7×8 — 두 배 step은 덧셈 표기다', () => {
    expect(byId['double']!.steps(7, 8)).toEqual([
      { text: '7 × 4 = {}', blanks: [28] },
      { text: '28 + 28 = {}', blanks: [56] },
    ])
  })
  it('minus-one 7×9 — 첫 step은 묶어 세기 표기다', () => {
    expect(byId['minus-one']!.steps(7, 9)).toEqual([
      { text: '10씩 7묶음 = {}', blanks: [70] },
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

const NO_FACTS: Record<string, FactState> = {}
const fluent = (n: number): Record<string, FactState> =>
  Object.fromEntries(
    Array.from({ length: n }, (_, i) => [
      `${2 + (i % 8)}×${1 + Math.floor(i / 8)}`,
      { status: 'fluent', medianMs: 900, streak: 3, interval: 7, nextDue: '2026-09-01' },
    ]),
  )
const st = (introducedAt: string, appearances: number, lastAppearedAt: string): StrategyState => ({
  attempts: [],
  introducedAt,
  appearances,
  lastAppearedAt,
})

describe('composeStrategyItems', () => {
  it('첫날: 아무 전략도 도입 전이면 make-ten 2문항', () => {
    const items = composeStrategyItems({
      strategies: {},
      facts: NO_FACTS,
      rand: lcg(3),
      seen: new Set(),
    })
    expect(items).toHaveLength(2)
    expect(items.map((i) => i.tag)).toEqual(['make-ten', 'make-ten'])
    expect(items.map((i) => i.id)).toEqual(['s1', 's2'])
  })

  it('등장 3회 게이트: 2회면 새 전략이 안 열리고, 3회면 열린다', () => {
    const base = { facts: NO_FACTS, rand: lcg(5), seen: new Set<string>() }
    const at2 = composeStrategyItems({
      ...base,
      strategies: { 'make-ten': st('2026-08-04', 2, '2026-08-05') },
    })
    expect(at2[0]!.tag).toBe('make-ten') // 아직 최신이 make-ten

    const at3 = composeStrategyItems({
      ...base,
      seen: new Set(),
      strategies: { 'make-ten': st('2026-08-04', 3, '2026-08-06') },
    })
    expect(at3[0]!.tag).toBe('split-place') // 다음 전략이 오늘의 방법으로
    expect(at3[1]!.tag).toBe('make-ten') // 이전 것은 어제의 방법으로
  })

  it('어제의 방법은 가장 오래 안 나온 전략이다 — 항상-첫-전략 구현은 실패한다', () => {
    const items = composeStrategyItems({
      strategies: {
        'make-ten': st('2026-08-04', 5, '2026-08-10'), // 최근에 나옴
        'split-place': st('2026-08-07', 4, '2026-08-08'), // 가장 오래 안 나옴 ← 정답
        'round-adjust': st('2026-08-09', 2, '2026-08-09'), // 최신 (오늘의 방법)
      },
      facts: NO_FACTS,
      rand: lcg(9),
      seen: new Set(),
    })
    expect(items[0]!.tag).toBe('round-adjust')
    expect(items[1]!.tag).toBe('split-place') // make-ten(첫 전략)이면 그럴듯한 오답
  })

  it('곱셈 게이트: 6종을 다 돌아도 fluent 9개면 곱셈 전략이 한 문항도 안 나오고, 10개면 double이 열린다', () => {
    const sixDone = {
      'make-ten': st('2026-08-04', 9, '2026-08-20'),
      'split-place': st('2026-08-07', 8, '2026-08-21'),
      'round-adjust': st('2026-08-10', 7, '2026-08-22'),
      'split-subtrahend': st('2026-08-13', 6, '2026-08-23'),
      anchor: st('2026-08-16', 5, '2026-08-24'),
      'count-up': st('2026-08-19', 3, '2026-08-25'),
    }
    const at9 = composeStrategyItems({
      strategies: sixDone,
      facts: fluent(9),
      rand: lcg(13),
      seen: new Set(),
    })
    // 이 테스트가 증명하려는 것은 "게이트가 닫혀 있다"이다. 예전에는 그것을
    // `at9[0].tag === 'count-up'`("막혀서 최신 유지")로 표현했지만, 새 전략을 열 수 없는
    // 날은 문항1도 로테이션에 합류하므로(사용자 결정) 더는 그 형태로 쓸 수 없다.
    // 게이트가 실제로 주장하는 명제를 직접 단언한다 — **어느 슬롯에도** 곱셈이 없다.
    expect(at9.every((i) => i.op !== '×')).toBe(true)
    // 위 단언만으로는 "문항1이 여전히 count-up에 못박혀 있는" 구현도 통과한다. 게이트가
    // 닫힌 날의 두 문항이 lastAppearedAt이 가장 오래된 둘이라는 것까지 고정한다 —
    // sixDone은 make-ten(08-20) < split-place(08-21) < … 순이다.
    expect(at9.map((i) => i.tag)).toEqual(['make-ten', 'split-place'])

    const at10 = composeStrategyItems({
      strategies: sixDone,
      facts: fluent(10),
      rand: lcg(13),
      seen: new Set(),
    })
    expect(at10[0]!.tag).toBe('double')
  })

  it('8종 완료 정착기: 문항1이 minus-one에 고정되지 않고 가장 오래 안 나온 순으로 로테이션한다', () => {
    // 카탈로그 소진(next === undefined) 분기 — 곱셈 게이트 대기 픽스처(위 at9)와 별개의
    // 정착기 경로다(스펙 §7 "8종 완료·게이트 대기 픽스처"의 앞쪽 절반). 그럴듯한 오답
    // 둘을 모두 갈라놓는 픽스처: 문항1을 최신에 못박는 구현은 items[0]이 minus-one이
    // 되고, "항상 첫 전략" 구현은 make-ten이 된다 — 정답은 둘 다와 다른 전략이도록
    // lastAppearedAt을 배치했다(round-adjust가 가장 오래, split-subtrahend가 그다음).
    const allEight = {
      'make-ten': st('2026-08-01', 9, '2026-08-20'),
      'split-place': st('2026-08-02', 8, '2026-08-21'),
      'round-adjust': st('2026-08-03', 7, '2026-08-14'), // 가장 오래 안 나옴 → 문항1
      'split-subtrahend': st('2026-08-04', 6, '2026-08-15'), // 그다음 → 문항2
      anchor: st('2026-08-05', 5, '2026-08-22'),
      'count-up': st('2026-08-06', 4, '2026-08-23'),
      double: st('2026-08-07', 3, '2026-08-24'),
      'minus-one': st('2026-08-08', 3, '2026-08-25'), // 최신, 등장 3회 완료 — 열 것이 없다
    }
    const items = composeStrategyItems({
      strategies: allEight,
      // 8종이 도입됐다면 곱셈 게이트는 이미 통과한 상태다 — 픽스처도 그 상태로 맞춘다.
      // (이 분기 자체는 next가 undefined라 fluent와 무관하게 로테이션으로 떨어진다.)
      facts: fluent(10),
      rand: lcg(21),
      seen: new Set(),
    })
    expect(items.map((i) => i.tag)).toEqual(['round-adjust', 'split-subtrahend'])
  })

  it('생성물이 seen에 등록되고, 이미 있는 수식은 피한다', () => {
    const seen = new Set<string>()
    const items = composeStrategyItems({ strategies: {}, facts: NO_FACTS, rand: lcg(17), seen })
    for (const it of items) {
      expect(seen.has(`${it.a}${it.op}${it.b}`)).toBe(true)
    }
    // 두 문항이 같은 수식을 쓰는 경우는 "같은 수식 두 방법"(전략이 다를 때)뿐이다.
    // 여기서는 둘 다 make-ten이므로 반드시 다른 수식이어야 한다.
    expect(`${items[0]!.a}+${items[0]!.b}`).not.toBe(`${items[1]!.a}+${items[1]!.b}`)
  })
})

// composeStrategyItems 안에서 review.applicable(first.a, first.b)를 부르는 "같은 수식
// 두 방법" 분기(§6.4)는 브리프의 5개 테스트 중 어느 것도 밟지 않는다 — 5개 픽스처 전부
// today.op !== review.op라 review.op === today.op 가드에서 항상 막히기 때문이다(리뷰
// 지적). 이 가드는 이 함수에서 한 전략이 만든 수쌍을 다른 전략의 applicable에 넘기는
// 유일한 지점이라 별도로 다룬다.
//
// rand()는 [0,1) 실수를 순서대로 소비한다(randInt가 rand()*range를 내림). 아래 값들은
// randInt(lo,hi,rand) = lo + floor(rand()*(hi-lo+1))를 손으로 거꾸로 풀어 만들었다 —
// 예: round-adjust(11..89)에서 a=34를 얻으려면 34-11=23이 필요하므로 rand() ∈
// [23/79, 24/79)를 고른다. lcg 같은 연속 시드 대신 스크립트 rand를 쓰는 이유는 몇 번째
// draw가 어떤 값인지 소비 순서에 좌우되지 않고 직접 통제하기 위해서다(각 케이스 아래
// 계산 주석 참고, 실제 실행으로 (a,b)를 확인했다).
function scripted(values: number[]): () => number {
  let i = 0
  return () => {
    // 스텁 소진 시 조용히 undefined/NaN을 내는 대신 바로 던진다 — 변이로 draw 횟수가
    // 늘어나면(예: 가드가 사라져 추가 rand() 호출이 생기면) 그 자체가 실패로 드러나야 한다.
    if (i >= values.length) throw new Error(`rand 스텁 소진: ${i}번째 호출`)
    return values[i++]!
  }
}

describe('첫날 같은 전략 2문항 — seen 재추첨 가드 (도입 1종 구간의 계약)', () => {
  it('두 문항이 같은 전략이어도 seen 가드가 같은 수식을 재추첨시킨다 — 가드 삭제를 잡는다', () => {
    // 도입된 전략이 1종뿐인 1~3일차에는 pool이 비어 review = today가 된다 — 같은 전략
    // 2문항. 이때 수식이 달라야 한다는 계약은 genAvoiding의 seen 가드 하나가 지킨다.
    // 위 "생성물이 seen에 등록되고…" 테스트는 lcg 픽스처라 가드를 지워도 우연히 다른
    // 수식이 나와 통과한다(HANDOFF 후속 목록에서 지적된 공허함) — 여기서는 scripted
    // rand로 같은 수쌍을 두 번 겨냥해 가드가 실제로 재추첨을 강제하는 것을 고정한다.
    //
    // make-ten.gen은 randInt(11,89)를 두 번(x, y) 소비한다. 값 계산(모두 실행 확인):
    // 0.3 → 11+floor(0.3*79) = 34, 0.35 → 38, 0.575 → 56, 0.46 → 47.
    // make-ten.applicable: (34,38)은 4+8=12>10, (56,47)은 6+7=13>10 — 둘 다 참.
    // 정상 코드: 문항1이 (34,38)을 등록 → 문항2의 첫 표집 (34,38)이 seen에 걸려
    // 재추첨 → (56,47). 가드를 지운 구현: 문항2도 (34,38)을 그대로 쓴다 — 3·4번째
    // 값에서 즉시 갈린다(scripted는 소진 시 던지므로 draw 수 변화도 실패로 드러난다).
    const items = composeStrategyItems({
      strategies: {},
      facts: NO_FACTS,
      rand: scripted([0.3, 0.35, 0.3, 0.35, 0.575, 0.46]),
      seen: new Set(),
    })
    expect(items.map((i) => i.tag)).toEqual(['make-ten', 'make-ten'])
    expect(items[0]!.a).toBe(34)
    expect(items[0]!.b).toBe(38)
    expect(items[1]!.a).toBe(56)
    expect(items[1]!.b).toBe(47)
  })
})

describe('같은 수식 두 방법 — review.applicable(first.a, first.b) 경로', () => {
  it('가드 3개(op 일치·applicable·확률)를 모두 통과하면 같은 (a,b)를 쓰고 채점 계약을 지킨다', () => {
    // today=round-adjust, review=make-ten (둘 다 '+'). round-adjust.gen 첫 시도: a=34
    // (rand=0.3 → 11+floor(0.3*79)=34), b=38(rand=0.35 → 11+floor(0.35*79)=38) → b%10=8,
    // round-adjust.applicable(34,38) 성립. make-ten.applicable(34,38): carryCount(34,38)=1,
    // (4+8)=12>10 → 참 → 세 번째 draw(0.1<0.2)로 같은 수식 분기 진입.
    const strategies: Record<string, StrategyState> = {
      'make-ten': st('2026-08-01', 5, '2026-08-01'),
      'round-adjust': st('2026-08-09', 2, '2026-08-09'),
    }
    const items = composeStrategyItems({
      strategies,
      facts: NO_FACTS,
      rand: scripted([0.3, 0.35, 0.1]),
      seen: new Set(),
    })
    expect(items[0]!.tag).toBe('round-adjust')
    expect(items[1]!.tag).toBe('make-ten')
    expect(items[0]!.a).toBe(34)
    expect(items[0]!.b).toBe(38)
    expect(items[1]!.a).toBe(items[0]!.a) // 같은 수식
    expect(items[1]!.b).toBe(items[0]!.b)
    // 이 경로가 지키려는 핵심 계약: 다른 전략의 steps로 렌더돼도 채점 답은 그대로다.
    const lastStep = items[1]!.steps[items[1]!.steps.length - 1]!
    expect(lastStep.blanks[lastStep.blanks.length - 1]).toBe(items[1]!.answer)
  })

  it('확률에 안 걸리면(rand >= 0.2) 각자 다른 수식을 쓴다 — 확률 가드 삭제를 잡는다', () => {
    // 위와 같은 today/review, 첫 두 draw도 같아 first=(34,38)까지는 동일. 세 번째
    // draw=0.9(>=0.2)라 분기가 안 열려야 한다 — 그러면 make-ten.gen이 독립적으로 돌아
    // 네·다섯 번째 draw(0.575→56, 0.46→47)로 (56,47)을 낸다: carryCount(56,47)=2,
    // (6+7)=13>10 → make-ten.applicable(56,47) 참.
    const strategies: Record<string, StrategyState> = {
      'make-ten': st('2026-08-01', 5, '2026-08-01'),
      'round-adjust': st('2026-08-09', 2, '2026-08-09'),
    }
    const items = composeStrategyItems({
      strategies,
      facts: NO_FACTS,
      rand: scripted([0.3, 0.35, 0.9, 0.575, 0.46]),
      seen: new Set(),
    })
    expect(items[0]!.a).toBe(34)
    expect(items[0]!.b).toBe(38)
    expect(items[1]!.a).toBe(56)
    expect(items[1]!.b).toBe(47)
    expect(items[1]!.a !== items[0]!.a || items[1]!.b !== items[0]!.b).toBe(true)
  })

  it('전략이 다르면(op 다름) applicable이 우연히 참이어도 같은 수식을 쓰지 않는다 — op 가드 삭제를 잡는다', () => {
    // today=split-place('−'), review=make-ten('+') — op가 다르므로 정상 코드는 review.op
    // === today.op에서 막혀 applicable·rand를 아예 안 부른다. split-place.gen 첫 시도:
    // {38,25}(rand=0.31→38, rand=0.16→25, shape가 max/min으로 정렬). 이 (38,25)는
    // make-ten.applicable도 우연히 참이다(carryCount(38,25)=1, (8+5)=13>10) — op가 다른데도
    // applicable만으로는 걸러지지 않는다는 것을 보여준다. 세 번째 draw=0.1은 정상 코드에서는
    // make-ten.gen의 첫 draw(x=18)로 쓰이고, 네 번째(0.435)는 y=45로 쓰여 (18,45)를 낸다
    // (carryCount(18,45)=1, (8+5)=13>10 → applicable 참, 첫 시도 성공).
    const strategies: Record<string, StrategyState> = {
      'make-ten': st('2026-08-01', 5, '2026-08-01'),
      'split-place': st('2026-08-09', 2, '2026-08-09'),
    }
    const items = composeStrategyItems({
      strategies,
      facts: NO_FACTS,
      rand: scripted([0.31, 0.16, 0.1, 0.435]),
      seen: new Set(),
    })
    expect(items[0]!.tag).toBe('split-place')
    expect(items[1]!.tag).toBe('make-ten')
    expect(items[0]!.a).toBe(38)
    expect(items[0]!.b).toBe(25)
    expect(items[1]!.a).toBe(18)
    expect(items[1]!.b).toBe(45)
    expect(items[1]!.a !== items[0]!.a || items[1]!.b !== items[0]!.b).toBe(true)
  })

  it('review가 이 수쌍에 안 맞으면(applicable 거짓) op가 같아도 같은 수식을 쓰지 않는다 — applicable 가드 삭제를 잡는다', () => {
    // today=round-adjust, review=make-ten (둘 다 '+', op 가드는 통과). round-adjust.gen이
    // {41,48}을 낸다(rand=0.385→41, rand=0.475→48, b%10=8). make-ten.applicable(41,48):
    // carryCount(41,48)=0(받아올림 없음) → 거짓 — op가 같아도 이 수쌍엔 안 맞는다. 정상
    // 코드는 여기서 막혀 rand()를 안 부르고 make-ten.gen이 독립적으로 돌아 세·네 번째
    // draw(0.15→22, 0.865→79)로 (22,79)를 낸다(carryCount(22,79)=2, (2+9)=11>10 → 참).
    const strategies: Record<string, StrategyState> = {
      'make-ten': st('2026-08-01', 5, '2026-08-01'),
      'round-adjust': st('2026-08-09', 2, '2026-08-09'),
    }
    const items = composeStrategyItems({
      strategies,
      facts: NO_FACTS,
      rand: scripted([0.385, 0.475, 0.15, 0.865]),
      seen: new Set(),
    })
    expect(items[0]!.tag).toBe('round-adjust')
    expect(items[1]!.tag).toBe('make-ten')
    expect(items[0]!.a).toBe(41)
    expect(items[0]!.b).toBe(48)
    expect(items[1]!.a).toBe(22)
    expect(items[1]!.b).toBe(79)
    expect(items[1]!.a !== items[0]!.a || items[1]!.b !== items[0]!.b).toBe(true)
  })
})
