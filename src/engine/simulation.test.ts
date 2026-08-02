import { describe, it, expect } from 'vitest'
import { deriveTypes, openTags } from './derive'
import { composeSheet } from './compose'
import { VERTICAL_ORDER } from './vertical'
import { DEFAULT_SETTINGS } from '../data/types'
import type { Day, SheetItem, VerticalTag } from '../data/types'

/**
 * 여러 날에 걸친 통합 시뮬레이션.
 *
 * 단위 테스트들은 전부 손으로 만든 TypeState 리터럴을 상대로 돌기 때문에,
 * "어제의 채점이 오늘의 문제지를 만든다"는 실제 루프를 아무도 밟지 않았다.
 * 되돌려잠금 결함(열린 유형이 다시 닫히던 버그)이 열두 번의 리뷰를 통과한 이유가 그것이다.
 * 여기서는 화면이 부르는 그대로 deriveTypes → openTags → composeSheet → 채점을
 * 날마다 반복해서 파이프라인 전체를 건다. 설계 §12의 "30일치 가상 로그 골든 테스트".
 */

/** 시드 고정 LCG. 테스트가 흔들리지 않도록 난수를 주입한다(compose.test.ts와 같은 방식). */
function lcg(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return s / 0x7fffffff
  }
}

/** 2026-01-01부터 i일 뒤의 날짜 키. 로그 정렬만 보장하면 되므로 최소 구현. */
function dateKey(i: number): string {
  const d = new Date(2026, 0, 1 + i)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

type SimResult = {
  log: Day[]
  /** 날마다 composeSheet 직전에 관측한 열린 유형 수. */
  openCounts: number[]
  /** 날마다 관측한 열린 유형 목록. */
  openSets: VerticalTag[][]
  /** 열려 있지 않은 유형이 출제된 사건. 비어 있어야 한다. */
  violations: string[]
  /** 유형별 총 출제 수. */
  emitted: Record<string, number>
}

function simulate(options: {
  days: number
  seed: number
  /** 유형별 정답 확률. */
  correctRate: (tag: string, dayIndex: number) => number
  /** true인 날은 채점하지 않는다(부모가 채점을 건너뛴 날). */
  skipGrading?: (dayIndex: number) => boolean
}): SimResult {
  const rand = lcg(options.seed)
  const log: Day[] = []
  const openCounts: number[] = []
  const openSets: VerticalTag[][] = []
  const violations: string[] = []
  const emitted: Record<string, number> = {}

  for (let d = 0; d < options.days; d++) {
    // 화면(print-sheet.ts)이 하는 것과 같은 순서.
    const types = deriveTypes(log)
    const open = openTags(types)
    openCounts.push(open.length)
    openSets.push(open)

    const sheet: SheetItem[] = composeSheet({ settings: DEFAULT_SETTINGS, types, rand })

    for (const item of sheet) {
      if (item.kind !== 'vertical') continue
      emitted[item.tag] = (emitted[item.tag] ?? 0) + 1
      if (!open.includes(item.tag)) {
        violations.push(`day ${d}: ${item.tag}는 열린 집합 [${open.join(', ')}]에 없다`)
      }
    }

    const day: Day = { date: dateKey(d), kind: 'normal', sheet }

    if (!options.skipGrading?.(d)) {
      const grades: Record<string, boolean> = {}
      for (const item of sheet) {
        grades[item.id] = rand() < options.correctRate(item.tag, d)
      }
      day.grades = grades
    }

    log.push(day)
  }

  return { log, openCounts, openSets, violations, emitted }
}

function isNonDecreasing(xs: number[]): boolean {
  return xs.every((x, i) => i === 0 || x >= xs[i - 1]!)
}

describe('다일 시뮬레이션', () => {
  it('열린 유형 수는 날이 갈수록 줄지 않는다 — 되돌려잠금 회귀 가드', () => {
    // 잘하다가 특정 유형에서 흔들리는, 가장 위험한 아이. 되돌려잠금 버그는 정확히
    // 이 상황에서 터졌다: 몇 주 전에 뗀 add2-carry의 최근 창이 90% 밑으로 내려가는 순간
    // 그 뒤 유형이 전부 함께 닫혔다.
    const sim = simulate({
      days: 120,
      seed: 12345,
      correctRate: (tag, day) => (tag === 'add2-carry' && day >= 60 ? 0.4 : 0.97),
    })

    expect(isNonDecreasing(sim.openCounts)).toBe(true)
    // 흔들리기 시작한 뒤에도 최대치를 유지한다(줄지 않을 뿐 아니라 실제로 되돌아가지 않는다).
    const peak = Math.max(...sim.openCounts)
    expect(sim.openCounts.slice(-30).every((n) => n === peak)).toBe(true)
  })

  it('출제된 세로셈 유형은 언제나 그날 열려 있던 집합 안에 있다', () => {
    for (const seed of [1, 7, 4242, 999_983]) {
      const sim = simulate({ days: 90, seed, correctRate: () => 0.85 })
      expect(sim.violations).toEqual([])
    }
  })

  it('95% 이상으로 푸는 아이는 정해진 날 안에 9개 유형에 모두 도달한다', () => {
    const sim = simulate({ days: 200, seed: 2026, correctRate: () => 0.97 })
    const last = sim.openSets[sim.openSets.length - 1]!
    expect(last).toEqual(VERTICAL_ORDER)

    const reachedAt = sim.openCounts.indexOf(VERTICAL_ORDER.length)
    expect(reachedAt).toBeGreaterThan(0)
    // 이 시드에서의 실측은 16일. 상한 40은 정상적인 가중치·임계값 튜닝은 통과시키되
    // 사다리가 사실상 멈추는 회귀는 잡는 선이다. 150은 완전 정지만 잡혀 가드 구실을 못 했다.
    expect(reachedAt).toBeLessThanOrEqual(40)
  })

  it('흔들리는 유형은 닫히는 대신 더 많이 출제된다 — 가중치가 올바른 대응 기제다', () => {
    const sim = simulate({
      days: 140,
      seed: 555,
      correctRate: (tag, day) => (tag === 'add2-carry' && day >= 70 ? 0.35 : 0.97),
    })

    // 마지막 40일만 따로 센다.
    const tail = sim.log.slice(-40)
    const counts: Record<string, number> = {}
    let total = 0
    for (const day of tail) {
      for (const item of day.sheet) {
        if (item.kind !== 'vertical') continue
        counts[item.tag] = (counts[item.tag] ?? 0) + 1
        total++
      }
    }
    const share = (counts['add2-carry'] ?? 0) / total
    // 9유형 균등이면 1/9 ≈ 0.11. 정답률이 낮으면 가중치가 커져 그보다 훨씬 크게 나온다.
    expect(share).toBeGreaterThan(0.3)
  })

  it('채점하지 않은 날이 섞여도 깨지지 않고, 오답으로 세지도 않는다', () => {
    // 사흘에 한 번은 채점을 건너뛴다.
    const skipped = simulate({
      days: 150,
      seed: 31337,
      correctRate: () => 1,
      skipGrading: (d) => d % 3 === 2,
    })

    expect(skipped.violations).toEqual([])
    expect(isNonDecreasing(skipped.openCounts)).toBe(true)

    // 전부 정답인 아이다. 건너뛴 날이 오답으로 세어졌다면 사다리가 멈췄을 것이다.
    expect(skipped.openSets[skipped.openSets.length - 1]).toEqual(VERTICAL_ORDER)

    // 이력에 쌓인 시도 수 == 채점된 날의 문항 수. 건너뛴 날은 한 건도 들어오지 않는다.
    const types = deriveTypes(skipped.log)
    const recorded = Object.values(types).reduce((s, t) => s + t.attempts.length, 0)
    const gradedItems = skipped.log
      .filter((d) => d.grades)
      .reduce((s, d) => s + Object.keys(d.grades!).length, 0)
    expect(recorded).toBe(gradedItems)
    // 전부 정답이므로 오답이 한 건도 없어야 한다.
    expect(Object.values(types).every((t) => t.attempts.every(Boolean))).toBe(true)
  })

  it('전혀 채점하지 않으면 첫 유형에 머무르되 문제지는 계속 나온다', () => {
    const sim = simulate({
      days: 30,
      seed: 8,
      correctRate: () => 1,
      skipGrading: () => true,
    })
    expect(sim.openCounts.every((n) => n === 1)).toBe(true)
    expect(sim.violations).toEqual([])
    expect(sim.log.every((d) => d.sheet.length === 10)).toBe(true)
  })
})
