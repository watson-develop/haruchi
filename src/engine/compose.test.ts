import { describe, it, expect } from 'vitest'
import { composeSheet } from './compose'
import { GenerationError, satisfies } from './vertical'
import { RECENT_WINDOW } from './derive'
import { DEFAULT_SETTINGS } from '../data/types'
import type { TypeState } from '../data/types'

const mastered = (): TypeState => ({ attempts: Array(10).fill(true) })

describe('composeSheet', () => {
  it('설정된 문항 수대로 만든다', () => {
    const sheet = composeSheet({ settings: DEFAULT_SETTINGS, types: {} })
    expect(sheet.filter((i) => i.kind === 'vertical')).toHaveLength(8)
    expect(sheet.filter((i) => i.kind === 'inverse')).toHaveLength(2)
    expect(sheet).toHaveLength(10)
  })

  it('verticalCount가 6으로 하향되면 그만큼만 만든다', () => {
    const settings = { ...DEFAULT_SETTINGS, verticalCount: 6 as const }
    const sheet = composeSheet({ settings, types: {} })
    expect(sheet.filter((i) => i.kind === 'vertical')).toHaveLength(6)
    expect(sheet).toHaveLength(8)
  })

  it('문항 id가 모두 다르다', () => {
    const sheet = composeSheet({ settings: DEFAULT_SETTINGS, types: {} })
    expect(new Set(sheet.map((i) => i.id)).size).toBe(sheet.length)
  })

  it('같은 수식이 하루에 중복되지 않는다', () => {
    for (let n = 0; n < 50; n++) {
      const sheet = composeSheet({ settings: DEFAULT_SETTINGS, types: {} })
      const keys = sheet
        .filter((i) => i.kind === 'vertical')
        .map((i) => (i.kind === 'vertical' ? `${i.a}${i.op}${i.b}` : ''))
      expect(new Set(keys).size).toBe(keys.length)
    }
  })

  it('열린 유형만 출제한다', () => {
    const sheet = composeSheet({ settings: DEFAULT_SETTINGS, types: {} })
    for (const item of sheet) {
      if (item.kind === 'vertical') expect(item.tag).toBe('add2-nocarry')
    }
  })

  it('유형이 열리면 그 유형도 섞여 나온다', () => {
    const types = { 'add2-nocarry': mastered(), 'sub2-noborrow': mastered() }
    const tags = new Set<string>()
    for (let n = 0; n < 30; n++) {
      for (const item of composeSheet({ settings: DEFAULT_SETTINGS, types })) {
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
      for (const item of composeSheet({ settings: DEFAULT_SETTINGS, types })) {
        if (item.kind === 'vertical') expect(satisfies(item.tag, item.a, item.b)).toBe(true)
      }
    }
  })

  it('첫 □ 문항에만 힌트가 붙는다', () => {
    const sheet = composeSheet({ settings: DEFAULT_SETTINGS, types: {} })
    const inv = sheet.filter((i) => i.kind === 'inverse')
    expect(inv[0]?.kind === 'inverse' && inv[0].hint).toBeTruthy()
    expect(inv[1]?.kind === 'inverse' && inv[1].hint).toBeUndefined()
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
      const sheet = composeSheet({ settings: DEFAULT_SETTINGS, types, rand })
      expect(sheet).toHaveLength(10)

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
    expect(() => composeSheet({ settings: DEFAULT_SETTINGS, types: {}, rand: () => 1 })).toThrow(
      GenerationError,
    )
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
      const sheet = composeSheet({ settings: DEFAULT_SETTINGS, types, rand })
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
    const sheet = composeSheet({ settings: DEFAULT_SETTINGS, types: {}, rand: () => 0 })
    expect(sheet.filter((i) => i.kind === 'vertical')).toHaveLength(8)
    expect(sheet).toHaveLength(10)
    const keys = sheet
      .filter((i) => i.kind === 'vertical')
      .map((i) => (i.kind === 'vertical' ? `${i.a}${i.op}${i.b}` : ''))
    // 폴백 경로가 실제로 발동했다는 증거: 모두 같은 조합으로 수렴한다.
    expect(new Set(keys).size).toBe(1)
  })
})
