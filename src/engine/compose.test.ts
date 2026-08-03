import { describe, it, expect } from 'vitest'
import { composeSheet } from './compose'
import { GenerationError, satisfies } from './vertical'
import { RECENT_WINDOW } from './derive'
import { DEFAULT_SETTINGS } from '../data/types'
import type { StrategyItem, TypeState, VerticalItem, WordItem } from '../data/types'

const mastered = (): TypeState => ({ attempts: Array(10).fill(true) })

/** 시드 고정 LCG. compose.test.ts 밖(simulation.test.ts 등)과 같은 방식. */
function lcg(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return s / 0x7fffffff
  }
}

describe('composeSheet', () => {
  it('설정된 문항 수대로 만든다', () => {
    const sheet = composeSheet({ settings: DEFAULT_SETTINGS, types: {}, strategies: {}, facts: {} })
    expect(sheet.filter((i) => i.kind === 'vertical')).toHaveLength(8)
    expect(sheet.filter((i) => i.kind === 'inverse')).toHaveLength(2)
    expect(sheet).toHaveLength(14)
  })

  it('verticalCount가 6으로 하향되면 그만큼만 만든다', () => {
    const settings = { ...DEFAULT_SETTINGS, verticalCount: 6 as const }
    const sheet = composeSheet({ settings, types: {}, strategies: {}, facts: {} })
    expect(sheet.filter((i) => i.kind === 'vertical')).toHaveLength(6)
    expect(sheet).toHaveLength(12)
  })

  it('문항 id가 모두 다르다', () => {
    const sheet = composeSheet({ settings: DEFAULT_SETTINGS, types: {}, strategies: {}, facts: {} })
    expect(new Set(sheet.map((i) => i.id)).size).toBe(sheet.length)
  })

  it('같은 수식이 하루에 중복되지 않는다', () => {
    for (let n = 0; n < 50; n++) {
      const sheet = composeSheet({ settings: DEFAULT_SETTINGS, types: {}, strategies: {}, facts: {} })
      const keys = sheet
        .filter((i) => i.kind === 'vertical')
        .map((i) => (i.kind === 'vertical' ? `${i.a}${i.op}${i.b}` : ''))
      expect(new Set(keys).size).toBe(keys.length)
    }
  })

  it('열린 유형만 출제한다', () => {
    const sheet = composeSheet({ settings: DEFAULT_SETTINGS, types: {}, strategies: {}, facts: {} })
    for (const item of sheet) {
      if (item.kind === 'vertical') expect(item.tag).toBe('add2-nocarry')
    }
  })

  it('유형이 열리면 그 유형도 섞여 나온다', () => {
    const types = { 'add2-nocarry': mastered(), 'sub2-noborrow': mastered() }
    const tags = new Set<string>()
    for (let n = 0; n < 30; n++) {
      for (const item of composeSheet({ settings: DEFAULT_SETTINGS, types, strategies: {}, facts: {} })) {
        if (item.kind === 'vertical') tags.add(item.tag)
      }
    }
    expect(tags.has('add2-carry')).toBe(true)
  })

  it('만들어진 세로셈은 전부 자기 유형 정의를 만족한다', () => {
    const types = {
      'add2-nocarry': mastered(),
      'sub2-noborrow': mastered(),
      'add2-carry': mastered(),
      'sub2-borrow': mastered(),
      'add3-carry1': mastered(),
      'add3-carry2': mastered(),
      'sub3-borrow1': mastered(),
      'sub3-borrow2': mastered(),
    }
    for (let n = 0; n < 50; n++) {
      for (const item of composeSheet({ settings: DEFAULT_SETTINGS, types, strategies: {}, facts: {} })) {
        if (item.kind === 'vertical') expect(satisfies(item.tag, item.a, item.b)).toBe(true)
      }
    }
  })

  it('첫 □ 문항에만 힌트가 붙는다', () => {
    const sheet = composeSheet({ settings: DEFAULT_SETTINGS, types: {}, strategies: {}, facts: {} })
    const inv = sheet.filter((i) => i.kind === 'inverse')
    expect(inv[0]?.kind === 'inverse' && inv[0].hint).toBeTruthy()
    expect(inv[1]?.kind === 'inverse' && inv[1].hint).toBeUndefined()
  })

  it('하루 14문항: 세로셈 8 + 역연산 2 + 전략 2 + 문장제 2, id 순서 고정', () => {
    const sheet = composeSheet({
      settings: DEFAULT_SETTINGS,
      types: {},
      strategies: {},
      facts: {},
      rand: lcg(1),
    })
    expect(sheet.map((i) => i.id)).toEqual([
      'v1',
      'v2',
      'v3',
      'v4',
      'v5',
      'v6',
      'v7',
      'v8',
      'inv1',
      'inv2',
      's1',
      's2',
      'w1',
      'w2',
    ])
    expect(sheet.filter((i) => i.kind === 'strategy')).toHaveLength(2)
    expect(sheet.filter((i) => i.kind === 'word')).toHaveLength(2)
  })

  it('하향 조정(세로셈 6)이어도 전략·문장제는 2+2 고정', () => {
    const sheet = composeSheet({
      settings: { ...DEFAULT_SETTINGS, verticalCount: 6 },
      types: {},
      strategies: {},
      facts: {},
      rand: lcg(2),
    })
    expect(sheet).toHaveLength(12)
    expect(sheet.filter((i) => i.kind === 'strategy')).toHaveLength(2)
    expect(sheet.filter((i) => i.kind === 'word')).toHaveLength(2)
  })

  it('전략·문장제 수식이 세로셈과 중복 집합을 공유한다', () => {
    // 같은 rand로 두 번 만들면 같은 sheet — 그중 수식 키가 sheet 안에서 유일해야 한다
    const sheet = composeSheet({
      settings: DEFAULT_SETTINGS,
      types: {},
      strategies: {},
      facts: {},
      rand: lcg(3),
    })
    const keys = sheet
      .filter((i): i is VerticalItem | StrategyItem => i.kind === 'vertical' || i.kind === 'strategy')
      .map((i) => `${i.a}${i.op}${i.b}`)
    const wordKeys = sheet.filter((i): i is WordItem => i.kind === 'word').map((i) => i.expression)
    const all = [...keys, ...wordKeys]
    // "같은 수식 두 방법"(전략 2문항이 의도적으로 같은 식)만 예외다
    const strategyPair = sheet.filter((i) => i.kind === 'strategy') as StrategyItem[]
    const intended =
      strategyPair.length === 2 &&
      strategyPair[0]!.a === strategyPair[1]!.a &&
      strategyPair[0]!.b === strategyPair[1]!.b
    expect(new Set(all).size).toBe(intended ? all.length - 1 : all.length)
  })

  it('rand()가 간헐적으로 정확히 1을 내도 난이도 대역을 벗어나지 않는다', () => {
    // 이 테스트는 원래 배열 길이와 item.kind만 보고 있었다 — 둘 다 실패할 수 없는
    // 단언이라, rand()가 1일 때 randInt가 max + 1을 내던 결함(100 + 100 세로셈,
    // 대역 밖 □ 채우기)을 그대로 통과시켰다. 실제 피연산자 값까지 본다.
    //
    // 시드 고정 PRNG는 정확히 1에 닿는다(LCG의 seed / 0x7fffffff). 현실적인 형태는
    // 상수 1이 아니라 가끔 1이 섞이는 쪽이므로 그렇게 주입한다.
    let seed = 20260802
    let n = 0
    const rand = () => {
      if (n++ % 7 === 0) return 1
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed / 0x7fffffff
    }

    const types = {
      'add2-nocarry': mastered(),
      'sub2-noborrow': mastered(),
      'add2-carry': mastered(),
    }
    for (let round = 0; round < 50; round++) {
      const sheet = composeSheet({ settings: DEFAULT_SETTINGS, types, strategies: {}, facts: {}, rand })
      expect(sheet).toHaveLength(14)

      const verticals = sheet.filter((i) => i.kind === 'vertical')
      expect(verticals).toHaveLength(8)
      for (const item of verticals) {
        if (item.kind !== 'vertical') continue
        expect(satisfies(item.tag, item.a, item.b), `${item.a}${item.op}${item.b}`).toBe(true)
      }

      const inv = sheet.filter((i) => i.kind === 'inverse')
      expect(inv).toHaveLength(2)
      for (const item of inv) {
        if (item.kind !== 'inverse') continue
        // inverse.ts가 선언한 난이도 대역. 결함 당시 b=41 c=60 answer=101이 나왔다.
        expect(item.c).toBeGreaterThanOrEqual(10)
        expect(item.c).toBeLessThanOrEqual(99)
        expect(item.answer).toBeGreaterThanOrEqual(5)
        expect(item.answer).toBeLessThanOrEqual(99)
        if (item.a !== undefined) {
          expect(item.a).toBeGreaterThanOrEqual(10)
          expect(item.a).toBeLessThanOrEqual(99)
        }
        if (item.b !== undefined) {
          expect(item.b).toBeGreaterThanOrEqual(5)
          expect(item.b).toBeLessThanOrEqual(80)
        }
      }
    }
  })

  it('rand()가 계속 1이면 대역 밖 문항을 내는 대신 시끄럽게 실패한다', () => {
    // 상수 1은 어떤 PRNG도 만들지 않는 퇴화 입력이다. 수정 전에는 여기서
    // "100+100" 여덟 개짜리 문제지가 조용히 나왔다 — add2-nocarry(두 자리)로 태깅된 채.
    // 클램프 뒤에는 99 + 99가 되고 이는 받아올림 2회라 정의를 만족하지 못하므로
    // 기각 표집이 끝까지 실패한다. 조용한 오답보다 던지는 쪽이 낫다.
    expect(() =>
      composeSheet({ settings: DEFAULT_SETTINGS, types: {}, strategies: {}, facts: {}, rand: () => 1 }),
    ).toThrow(GenerationError)
  })

  it('최신 유형도 RECENT_WINDOW회 이상 시도했으면 도입 가산점을 잃는다', () => {
    // add2-nocarry: 완전히 숙련(정답률 1.0) → 다음 유형을 연다.
    // sub2-noborrow: 정확히 RECENT_WINDOW회를 다 채웠지만 정답률 0.5로 미숙련.
    //   표본은 충분하므로(under-sampled가 아니므로) 도입 가산점(+0.6)을 받으면 안 된다.
    //   가산점이 남아있다면(버그) sub2-noborrow 비중이 1.2/1.3≈0.923이 되고,
    //   가산점이 없으면(수정 후) 0.6/0.7≈0.857이 된다.
    const types = {
      'add2-nocarry': mastered(),
      'sub2-noborrow': {
        attempts: [...Array(5).fill(true), ...Array(5).fill(false)],
      } satisfies TypeState,
    }
    expect(types['sub2-noborrow'].attempts).toHaveLength(RECENT_WINDOW)

    let seed = 42
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed / 0x7fffffff
    }

    const counts: Record<string, number> = { 'add2-nocarry': 0, 'sub2-noborrow': 0 }
    for (let n = 0; n < 300; n++) {
      const sheet = composeSheet({ settings: DEFAULT_SETTINGS, types, strategies: {}, facts: {}, rand })
      for (const item of sheet) {
        if (item.kind === 'vertical') counts[item.tag] = (counts[item.tag] ?? 0) + 1
      }
    }

    const total = counts['add2-nocarry']! + counts['sub2-noborrow']!
    const ratio = counts['sub2-noborrow']! / total
    // 기대값(가산점 없음) 0.857 근방. 버그가 있었다면(가산점 있음) 0.923 근방이었을 것.
    expect(ratio).toBeGreaterThan(0.75)
    expect(ratio).toBeLessThan(0.9)
  })

  it('중복 회피에 실패하면 중복을 허용하고서라도 문항 수를 채운다', () => {
    // rand가 상수를 반환하면 generateVertical은 매번 같은 (a,b)를 만들어
    // DEDUP_ATTEMPTS를 모두 소진시킨다. 그래도 빈 문제지를 내지 않아야 한다.
    //
    // 세로셈·역연산 구간(v1..v8, inv1..inv2)에만 이 퇴화 입력을 먹인다. 실측(임시
    // 계측 스크립트로 확인): 이 구간은 DEFAULT_SETTINGS·types:{}에서 rand() 호출을
    // 정확히 1283회 쓴다. 상수 0을 문제지 전체(전략까지)에 계속 먹이면
    // composeStrategyItems가 실제로 던진다 — make-ten.applicable은 a=b=11(상수 rand의
    // randInt(11,89,·) 결과)에서 항상 거짓이라 표집 한도(2000회)를 소진하고, 이어지는
    // split-subtrahend 폴백도 a=b=11이라 a>b가 거짓이라 똑같이 소진한다(둘 다 실측
    // 확인). 이건 세로셈 dedup 폴백과는 무관한 별개 경로이므로, 세로셈·역연산 구간을
    // 넉넉히 지난 뒤(1283의 약 4배인 5000회 이후)에는 실제 다변 난수로 바꿔 전략·문장제가
    // 정상적으로 완성되게 한다 — 세로셈 폴백 자체의 증거(수렴한 단일 조합)는 그대로 본다.
    let calls = 0
    const real = lcg(99)
    const rand = () => {
      calls++
      return calls <= 5000 ? 0 : real()
    }
    const sheet = composeSheet({ settings: DEFAULT_SETTINGS, types: {}, strategies: {}, facts: {}, rand })
    expect(sheet.filter((i) => i.kind === 'vertical')).toHaveLength(8)
    expect(sheet).toHaveLength(14)
    const keys = sheet
      .filter((i) => i.kind === 'vertical')
      .map((i) => (i.kind === 'vertical' ? `${i.a}${i.op}${i.b}` : ''))
    // 폴백 경로가 실제로 발동했다는 증거: 모두 같은 조합으로 수렴한다.
    expect(new Set(keys).size).toBe(1)
  })
})
