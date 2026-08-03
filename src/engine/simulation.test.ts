import { describe, it, expect } from 'vitest'
import { deriveTypes, openTags } from './derive'
import { composeSheet } from './compose'
import { VERTICAL_ORDER } from './vertical'
import { deriveFacts, composeSprint, requeueWrong } from './facts'
import { checkupDue, composeCheckup } from './checkup'
import { sprintStreak } from './streak'
import { shiftDay } from './dates'
import { DEFAULT_SETTINGS } from '../data/types'
import type { Day, SheetItem, SprintAttempt, VerticalTag } from '../data/types'

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

describe('스프린트 다중일 시뮬레이션', () => {
  /** 식별 등장 날짜 인덱스(같은 날 중복은 하루로)와 연속 등장 사이 최대 간격. */
  function appearanceGaps(log: Day[]): {
    seenOn: Record<string, number[]>
    worstGap: number
    worstId: string
  } {
    const seenOn: Record<string, number[]> = {}
    log.forEach((day, i) => {
      for (const a of day.sprint ?? []) {
        const at = (seenOn[a.fact] ??= [])
        if (at[at.length - 1] !== i) at.push(i)
      }
    })
    let worstGap = 0
    let worstId = ''
    for (const id of Object.keys(seenOn)) {
      const at = seenOn[id]!
      for (let i = 1; i < at.length; i++) {
        if (at[i]! - at[i - 1]! > worstGap) {
          worstGap = at[i]! - at[i - 1]!
          worstId = id
        }
      }
    }
    return { seenOn, worstGap, worstId }
  }

  function runSprints(options: {
    days: number
    seed: number
    correctRate: number
    fluentMs: number
    ms: () => number
    /** 실제 화면처럼 오답을 세션 뒤에 재투입한다(식당 한 번). */
    requeue?: boolean
    /** 28일마다 점검의 날을 끼운다(화면과 같은 checkupDue → composeCheckup 경로). */
    checkups?: boolean
  }) {
    const rand = lcg(options.seed)
    const log: Day[] = []
    const fluentCounts: number[] = []

    for (let d = 0; d < options.days; d++) {
      const date = shiftDay('2026-08-01', d)
      const facts = deriveFacts(log, options.fluentMs)
      const isCheckup = Boolean(options.checkups) && checkupDue(log, options.fluentMs, date)
      let queue = isCheckup
        ? composeCheckup(facts, 30, rand)
        : composeSprint({ facts, count: 30, today: date, rand })

      const attempts: SprintAttempt[] = []
      const requeued = new Set<string>()
      while (queue.length > 0) {
        const fact = queue.shift()!
        const correct = rand() < options.correctRate
        attempts.push({ fact, correct, ms: options.ms() })
        // sprint.ts submit()과 같은 규칙: 점검은 재투입하지 않고, 식당 최대 한 번.
        if (!correct && !isCheckup && options.requeue && !requeued.has(fact)) {
          requeued.add(fact)
          queue = requeueWrong(queue, fact)
        }
      }

      log.push({ date, kind: isCheckup ? 'checkup' : 'normal', sheet: [], sprint: attempts })
      fluentCounts.push(
        Object.values(deriveFacts(log, options.fluentMs)).filter((f) => f.status === 'fluent')
          .length,
      )
    }
    return { log, fluentCounts }
  }

  it('빠르고 정확한 아이는 81식을 모두 정복한다', () => {
    const sim = runSprints({
      days: 120,
      seed: 2026,
      correctRate: 0.97,
      fluentMs: 2500,
      ms: () => 1200,
    })
    // 마지막 날 값 하나로 판정하면 우연에 기댄 테스트가 된다: 실측상 마지막 40일 동안
    // fluentCounts는 78~81 사이를 오르내리고, 정확히 81인 날은 그 40일 중 21일뿐이다
    // (120일째는 그 21일 중 하나로 우연히 걸렸을 뿐이다). 가중치나 구간 계산을 살짝만
    // 바꿔도 어느 날이 봉우리인지는 바뀔 수 있으므로, "적어도 한 번은 81(전 식 정복)에
    // 도달했는가"와 "끝자락에서 무너지지 않았는가"를 나눠 구간으로 본다.
    expect(sim.fluentCounts).toContain(81)

    // 굶주림 결함(예: 특정 식이 재선택 풀에서 영구히 빠지는 되돌려잠금)은 81에 아예
    // 도달하지 못하므로 위 단언에서 이미 걸린다 — 실제로 그런 결함을 주입해 재현해보면
    // 최고치가 79~80에 머물고 마지막 40일 동안 한 번도 81을 찍지 못한다. 아래 바닥은
    // 뒤늦게 무너지는 형태(간격 반복이 뒤로 갈수록 통째로 무너지는 경우)까지 잡기 위한
    // 별도 장치다: 마지막 40일의 실측 최솟값은 78, 최댓값은 81(진폭 3) — 그 진폭만큼
    // (78 - 3 = 75) 여유를 둔 값을 바닥으로 삼는다.
    const tail = sim.fluentCounts.slice(-40)
    for (const n of tail) {
      expect(n).toBeGreaterThanOrEqual(75)
    }
  })

  it('정복한 식 수는 날이 갈수록 크게 줄지 않는다', () => {
    const sim = runSprints({
      days: 90,
      seed: 7,
      correctRate: 0.95,
      fluentMs: 2500,
      ms: () => 1500,
    })
    // 간격 반복 중 우연한 오답으로 몇 개가 강등되는 것은 정상이다.
    // 하루 만에 대량으로 무너지면 배분이나 판정이 잘못된 것이다.
    for (let i = 1; i < sim.fluentCounts.length; i++) {
      const drop = sim.fluentCounts[i - 1]! - sim.fluentCounts[i]!
      expect(drop).toBeLessThanOrEqual(6)
    }
  })

  it('느린 아이는 정답이어도 fluent가 되지 않는다', () => {
    const sim = runSprints({
      days: 40,
      seed: 3,
      correctRate: 1,
      fluentMs: 2500,
      ms: () => 4000,
    })
    expect(sim.fluentCounts[sim.fluentCounts.length - 1]).toBe(0)
  })

  it('간격 반복이 오래된 식을 굶기지 않는다', () => {
    const sim = runSprints({
      days: 60,
      seed: 11,
      correctRate: 0.97,
      fluentMs: 2500,
      ms: () => 1200,
    })
    // 식별자별 등장 날짜(오름차순). 같은 날 여러 번 나와도 하루로 센다.
    const { seenOn, worstGap, worstId } = appearanceGaps(sim.log)
    const seen = Object.keys(seenOn)
    expect(seen.length).toBe(81)

    // 재등장 간격은 **첫 등장 이후만** 센다. 도입 전의 침묵까지 세면 9×9(20일째쯤
    // 도입된다)만으로 20이 나와 어떤 상한도 의미를 잃는다.
    //
    // 연속 등장 사이의 최대 간격으로 잰다. 마지막 등장만 보던 이전 지표는 **간헐적**
    // 굶주림을 통째로 놓쳤다: 7×8이 10일에 하루만 나오도록 굶겨도 60일 안에 회복되어
    // 마지막 등장 간격은 13, 등장한 식 수는 여전히 81이라 옛 단언이 그대로 통과했다.
    // 실측(시드 11, correctRate 0.97) — 건강한 실행의 최대 간격은 60·120·365·730일에서
    // 모두 15로 평평하고 시드 2026·120일에서 16, 같은 굶주림 결함은 20을 낸다.
    // 18은 그 사이에 있어, 정상적인 배분 튜닝은 통과시키되 결함은 잡는다.
    // (등장 횟수 하한은 쓸 수 없다 — 건강한 실행의 최솟값이 9/10인데 결함도 7/10까지만
    // 떨어져 두 값이 겹친다.)
    expect(worstGap, `가장 오래 굶은 식: ${worstId}`).toBeLessThanOrEqual(18)

    // 마지막 등장 단언도 남긴다 — 두 지표가 잡는 결함이 다르다. 어떤 식이 도중에
    // 영영 사라지면 "연속 등장 사이의 간격"은 아예 생기지 않아 위 단언에 걸리지 않고,
    // 이쪽에만 걸린다. 최장 간격 14일 + 여유.
    for (const id of seen) {
      const at = seenOn[id]!
      expect(sim.log.length - 1 - at[at.length - 1]!).toBeLessThanOrEqual(21)
    }
  })

  it('재투입을 켜면 세션이 30+W문제가 되고, 굶주림 상한은 유지된다', () => {
    const sim = runSprints({
      days: 60,
      seed: 11,
      correctRate: 0.9,
      fluentMs: 2500,
      ms: () => 1200,
      requeue: true,
    })
    // 재투입이 실제로 모델링됐다는 자기증명 — 오답률 10%면 30문제를 넘는 날이 반드시 있다.
    expect(sim.log.some((d) => (d.sprint?.length ?? 0) > 30)).toBe(true)
    // 식당 한 번만 재투입하므로 상한은 60이다.
    expect(sim.log.every((d) => (d.sprint?.length ?? 0) <= 60)).toBe(true)

    const { worstGap, worstId } = appearanceGaps(sim.log)
    expect(worstGap, `가장 오래 굶은 식: ${worstId}`).toBeLessThanOrEqual(18)
  })

  it('4주마다 점검이 끼어도 정복이 무너지지 않고 굶주림 상한이 유지된다', () => {
    const sim = runSprints({
      days: 120,
      seed: 2026,
      correctRate: 0.97,
      fluentMs: 2500,
      ms: () => 1200,
      requeue: true,
      checkups: true,
    })
    // 점검이 실제로 발생했다는 자기증명.
    const checkupDays = sim.log.filter((d) => d.kind === 'checkup').length
    expect(checkupDays).toBeGreaterThanOrEqual(3) // 120일이면 fluent 발생 후 최소 3회
    // 상한도 함께 둔다. 하한만 있으면 "점검이 28일보다 훨씬 자주 도는" 회귀(예: 주기 계산이
    // 잘못되어 CHECKUP_INTERVAL_DAYS가 실제로 반영되지 않는 경우)를 이 테스트 안에서 아무도
    // 잡지 못한다 — 굶주림 상한(18)도 못 잡는다: 점검이 도는 시점엔 이미 81식이 전부 fluent라
    // (아래 peakAt은 23일경), 점검이 매일 돌아도 등장 간격은 줄어들지 늘지 않기 때문이다.
    // 실측(이 시드): 120일·28일 주기에서 점검은 4회. 상한 6은 정상적인 주기 튜닝(±1~2회)은
    // 통과시키되, 주기가 절반(14일)으로 줄어드는 회귀(약 8회)는 확실히 잡는 자리다.
    expect(checkupDays).toBeLessThanOrEqual(6)

    // 기존 '빠르고 정확한 아이' 테스트와 같은 판정: 봉우리 도달 + 끝자락 바닥.
    expect(sim.fluentCounts).toContain(81)
    for (const n of sim.fluentCounts.slice(-40)) {
      expect(n).toBeGreaterThanOrEqual(75)
    }

    const { worstGap, worstId } = appearanceGaps(sim.log)
    expect(worstGap, `가장 오래 굶은 식: ${worstId}`).toBeLessThanOrEqual(18)
  })

  it('매일 한 아이의 연속일수는 날짜 수와 같다', () => {
    const sim = runSprints({
      days: 30,
      seed: 5,
      correctRate: 0.9,
      fluentMs: 2500,
      ms: () => 1500,
    })
    expect(sprintStreak(sim.log, shiftDay('2026-08-01', 29))).toBe(30)
  })
})
