import { describe, it, expect } from 'vitest'
import { deriveTypes, deriveStrategies, openTags } from './derive'
import { composeSheet } from './compose'
import { VERTICAL_ORDER } from './vertical'
import { STRATEGY_CATALOG } from './strategy'
import { deriveFacts, composeSprint, requeueWrong } from './facts'
import { checkupDue, composeCheckup, CHECKUP_MIN_FLUENT } from './checkup'
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

    const strategies = deriveStrategies(log)
    const facts = deriveFacts(log, DEFAULT_SETTINGS.fluentMs)
    const sheet: SheetItem[] = composeSheet({
      settings: DEFAULT_SETTINGS,
      types,
      strategies,
      facts,
      rand,
    })

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

    // 이력에 쌓인 시도 수 == 채점된 날의 세로셈+역연산 문항 수. 건너뛴 날은 한 건도
    // 들어오지 않는다. sheet 전체(14개)가 아니라 세로셈+역연산(10개)만 비교한다 —
    // deriveTypes는 kind가 'vertical'·'inverse'인 문항만 세고(derive.ts), 전략·문장제는
    // 각자의 파생 함수(deriveStrategies 등)가 따로 관리하는 별개 이력이다. Phase 4 전에는
    // sheet 전체가 세로셈+역연산뿐이라 이 구분이 우연히 드러나지 않았을 뿐이다.
    const types = deriveTypes(skipped.log)
    const recorded = Object.values(types).reduce((s, t) => s + t.attempts.length, 0)
    const gradedItems = skipped.log
      .filter((d) => d.grades)
      .reduce(
        (s, d) => s + d.sheet.filter((i) => i.kind === 'vertical' || i.kind === 'inverse').length,
        0,
      )
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
    expect(sim.log.every((d) => d.sheet.length === 14)).toBe(true)
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

  it('빠르고 정확한 아이는 72식을 모두 정복한다', () => {
    const sim = runSprints({
      days: 120,
      seed: 2026,
      correctRate: 0.97,
      fluentMs: 2500,
      ms: () => 1200,
    })
    // 마지막 날 값 하나로 판정하면 우연에 기댄 테스트가 된다: 실측상 마지막 40일 동안
    // fluentCounts는 68~72 사이를 오르내리고, 정확히 72인 날은 그 40일 중 21일뿐이다
    // (120일째는 그 21일 중 하나로 우연히 걸렸을 뿐이다). 가중치나 구간 계산을 살짝만
    // 바꿔도 어느 날이 봉우리인지는 바뀔 수 있으므로, "적어도 한 번은 72(전 식 정복)에
    // 도달했는가"와 "끝자락에서 무너지지 않았는가"를 나눠 구간으로 본다.
    expect(sim.fluentCounts).toContain(72)

    // 굶주림 결함(예: 특정 식이 재선택 풀에서 영구히 빠지는 되돌려잠금)은 72에 아예
    // 도달하지 못하므로 위 단언에서 이미 걸린다 — 이 claim을 72식 풀에서 실제로
    // 검증했다: composeSprint의 learning/fluentDue/fluentNotDue/fresh 네 필터
    // 전부에서 한 식(9×2)을 영구 배제하는 결함을 주입하고 같은 config(이 시드)로
    // 120일을 재실행하면, fluentCounts는 120일 내내 72에 도달하지 못하고(전체
    // 최댓값 71) 마지막 40일도 68~71 사이에 머문다 — 위 단언에서 확실히 걸린다.
    // 아래 바닥은 뒤늦게 무너지는 형태(간격 반복이 뒤로 갈수록 통째로 무너지는 경우)
    // 까지 잡기 위한 별도 장치다: 재측정(72식 풀, 이 시드, 결함 없는 정상 실행) —
    // 마지막 40일의 실측 최솟값은 68, 최댓값은 72(진폭 4) — 그 진폭만큼(68 - 4 = 64)
    // 여유를 둔 값을 바닥으로 삼는다. 81식이던 이전 실측은 최솟값 78·최댓값 81
    // (진폭 3, 바닥 75)이었다 — 풀이 줄어 진폭이 커진 만큼(3→4) 바닥도 상대적으로
    // 더 내려갔다(75/81 ≈ 92.6% → 64/72 ≈ 88.9%). 숫자를 낮춘 것은 이 실측 때문이지
    // 테스트를 통과시키려는 임의 조정이 아니다.
    const tail = sim.fluentCounts.slice(-40)
    for (const n of tail) {
      expect(n).toBeGreaterThanOrEqual(64)
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
    expect(seen.length).toBe(72)

    // 재등장 간격은 **첫 등장 이후만** 센다. 도입 전의 침묵까지 세면 늦게 도입되는 식
    // 하나만으로 상한을 넘겨 어떤 상한도 의미를 잃는다(신규 도입이 무작위인 지금은
    // 어느 식이 늦게 나올지도 매번 다르다).
    //
    // 연속 등장 사이의 최대 간격으로 잰다. 마지막 등장만 보던 이전 지표는 **간헐적**
    // 굶주림을 통째로 놓쳤다(81식 기준 이전 실측 — 72식 풀에서 재현한 것이 아니라
    // 지표 선택 이유를 설명하는 일화다): 7×8이 10일에 하루만 나오도록 굶겨도 60일
    // 안에 회복되어 마지막 등장 간격은 13, 등장한 식 수는 여전히 81이라 옛(마지막
    // 등장만 보던) 단언이 그대로 통과했다.
    //
    // 건강한 실행 재측정(72식 풀, correctRate 0.97) — 최대 간격은 시드 11에서 60일
    // 15, 120·365·730일 16, 시드 2026·120일에서도 16이다. 건강한 최댓값은 **16**을
    // 쓴다(81식이던 이전 실측 15가 아니라 — 풀이 줄어도 이 값 자체는 낮아지지
    // 않았다. 예상과 달리 측정값이 그렇게 나왔다).
    //
    // 이 상한이 원래 잡으려던 결함은 "식 하나가 재선택 풀에서 빠지는" 표적 굶주림이다
    // — 배분 비중 전역 붕괴가 아니라. 72식 풀에서 실제로 재현했다: 같은 config(시드
    // 11, 60일)로 한 식(2×2)을 20일 창(day 10~30)에서만 매일 선택 큐에서 지우면
    // (재선택 lockout을 흉내) worstGap이 **21**로 뛴다(2×2가 day 9에 마지막으로
    // 보이고 창이 끝난 day 30에야 다시 보인다). 참고로 전역 배분 붕괴 계열도 확인
    // 했다: SHARE_FLUENT(fluent 배분 비중)를 0.25→0.2로 살짝 낮추면(정상적인 배분
    // 튜닝으로 볼 수 있는 범위) worstGap이 17~18로 나온다 — 즉 상한 18은 이 "정상
    // 튜닝" 값과 딱 붙어 있어 여유가 사실상 0~1이다. 0.25→0.1로 크게 낮추면(전역
    // 붕괴 결함) worstGap이 43까지 뛴다.
    //
    // 18은 건강한 최댓값(16) 바로 위, 표적 굶주림 결함(21)과 전역 붕괴 결함(43) 둘
    // 다보다 아래에 있다 — 재측정 후에도 그대로 유지한다. 다만 "정상 튜닝"으로 분류한
    // SHARE_FLUENT=0.2가 17~18을 낸다는 사실 자체가 이 상한의 여유가 넉넉하지
    // 않음을 뜻한다: 값을 낮추기보다, 향후 배분 튜닝이 18에 근접하면 이 상한도 같이
    // 재검토해야 한다는 신호로 남겨 둔다.
    // (등장 횟수 하한은 쓸 수 없다 — 81식 기준 이전 실측에서 건강한 실행의 최솟값이
    // 9/10인데 결함도 7/10까지만 떨어져 두 값이 겹쳤다.)
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
    // 잡지 못한다 — 굶주림 상한(18)도 못 잡는다: 점검이 도는 시점엔 이미 72식이 전부 fluent라
    // 점검이 매일 돌아도 등장 간격은 줄어들지 늘지 않기 때문이다.
    // 재측정(72식 풀, 이 시드): 120일·28일 주기에서 점검은 여전히 4회다(81식이던 이전
    // 실측과 동일 — 풀이 줄어도 첫 anchor 이전에 이미 fluent 게이트를 넘는 속도는
    // 바뀌지 않았다). 상한 6은 정상적인 주기 튜닝(±1~2회)은 통과시키되, 주기가
    // 절반(14일)으로 줄어드는 회귀(약 8회)는 확실히 잡는 자리다 — 그대로 유지한다.
    expect(checkupDays).toBeLessThanOrEqual(6)

    // 기존 '빠르고 정확한 아이' 테스트와 같은 판정: 봉우리 도달 + 끝자락 바닥.
    // 재측정 결과도 그 테스트와 같다(마지막 40일 최솟값 68·최댓값 72) — 같은 바닥 64를 쓴다.
    expect(sim.fluentCounts).toContain(72)
    for (const n of sim.fluentCounts.slice(-40)) {
      expect(n).toBeGreaterThanOrEqual(64)
    }

    const { worstGap, worstId } = appearanceGaps(sim.log)
    expect(worstGap, `가장 오래 굶은 식: ${worstId}`).toBeLessThanOrEqual(18)
  })

  it('정답률이 낮고 반응이 느린 아이도 점검 세션이 1~2문제로 쪼그라들지 않는다', () => {
    // 옛 게이트(fluent 1개 이상)에서는 드릴이 가장 필요한, 더디게 크는 아이일수록
    // 점검일에 fluent가 몇 개뿐이라 그만큼 짧은 세션을 받았다 — 그 하루를 통째로
    // 잃는데 🔥 연속일수는 그걸 정상적인 하루로 보상해줬다. 이 테스트의 프로필로 옛
    // 게이트를 직접 재현해 보면(같은 시드·정답률, 게이트만 "fluent ≥ 1"로) 점검
    // 7회의 문제수가 7,3,4,4,4,7,6으로 나온다 — 3~4문제짜리 점검이 정상적으로 발생한다.
    //
    // CHECKUP_MIN_FLUENT 게이트를 도입한 뒤에는 점검이 시작되는 날 자체가 fluent가 그
    // 상수 이상 쌓인 날이고, composeCheckup은 fluent 전부(최대 count)를 낸다 — 그래서
    // 세션 길이는 구조적으로 CHECKUP_MIN_FLUENT 이상이어야 한다.
    //
    // 재측정(72식 풀, 정답률 0.45, 반응시간 2450ms — fluentMs 2500 바로 아래라 느리지만
    // 겨우 정복은 되는, 진짜 어려워하는 아이, 시드 2026, 200일): 새 게이트에서 점검이
    // **1회**(day 32, 10문제)만 발생한다 — 81식이던 이전 실측(3회, 10·11·10문제)보다
    // 점검 횟수가 줄었다.
    //
    // 원인은 처음 가정("풀이 줄어 정복 시간이 짧아져 점검 사이클도 준다")과 **반대
    // 방향**이었다 — 재측정으로 그 가정이 틀렸음을 확인했다. FACT_IDS 생성 루프의
    // `a`를 임시로 1부터 돌려(72식 관련 다른 코드는 그대로 — composeSprint의 신규
    // 무작위 도입도 유지) 81식으로 같은 조건(시드 2026, correctRate 0.45)을 재실행해
    // 비교한 결과:
    //   - 72식 풀: 첫 점검 **day 32**(10 fluent로 게이트 통과).
    //   - 81식 풀(위 방식으로 재현): 첫 점검 **day 49**(11 fluent), 두 번째 **day 188**
    //     (10 fluent) — 총 2회.
    // 즉 72식 풀이 10-fluent 게이트에 **17일 더 빨리** 도달한다(풀이 작을수록 매일의
    // 신규 배분이 더 적은 후보에 집중되어 초기 습득이 빨라지는 것으로 보인다) — "닻이
    // 늦어졌다"는 가설은 기각한다.
    //
    // 대신 실제 원인은 **점검 이후 회복 실패**다: 점검은 적응 없이(재투입 없이) fluent
    // 식을 전부 재검증하므로, 정답률 0.45인 아이에게는 다수가 그 자리에서 오답 처리되어
    // fluentCount가 즉시 무너진다(72식 풀: day 32 직후 4까지 떨어짐). 72식 풀은 이후
    // 168일 동안 20일 구간별 최댓값이 6→8→8→9→9→8→8→4→4로, **한 번도 다시 10에
    // 도달하지 못한 채** 시뮬레이션이 끝난다 — 그래서 점검이 다시 열리지 않는다. 81식
    // 풀은 같은 붕괴를 겪고도 day 188에 한 번 더 게이트를 재통과했다. 왜 72식 풀만
    // 재도달에 실패하는지(더 적은 절대 식 수가 회복 속도에 실제로 영향을 주는지, 아니면
    // 이 시드·프로필의 우연인지)는 이번 재측정 범위 밖이다 — 정답률이 낮은 아이의 점검
    // 빈도가 실제로 줄어드는 회귀인지는 사람이 판단할 제품 신호로 남겨 둔다.
    //
    // 아래 단언(CHECKUP_MIN_FLUENT 이상)은 게이트 구조상 항상 성립하므로 풀 크기와
    // 무관하게 그대로 둔다. 다만 자기증명(점검이 발생은 한다)이 이제 **표본 1개**에
    // 얹혀 있다 — 이 시드·프로필이 조금만 더 나쁜 쪽으로 밀리면(예: correctRate가
    // 0.45에서 조금만 더 낮아지면) 점검이 한 번도 안 열려 이 테스트가 결함이 아닌
    // 이유로 빨개질 수 있다.
    const sim = runSprints({
      days: 200,
      seed: 2026,
      correctRate: 0.45,
      fluentMs: 2500,
      ms: () => 2450,
      requeue: true,
      checkups: true,
    })
    const checkupLens = sim.log
      .filter((d) => d.kind === 'checkup')
      .map((d) => d.sprint?.length ?? 0)
    expect(checkupLens.length).toBeGreaterThan(0) // 점검이 실제로 발생했다는 자기증명
    for (const len of checkupLens) {
      expect(len).toBeGreaterThanOrEqual(CHECKUP_MIN_FLUENT)
    }
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

describe('전략 도입 다일 시뮬레이션', () => {
  it('꾸준히 하면 비곱셈 6종이 모두 도입되고, 곱셈 2종은 fluent 게이트에 잠긴다', () => {
    // simulate()는 종이만 하고 스프린트가 없다 → fluent 0 → 곱셈 게이트가 닫혀 있어야 한다.
    // 이 단언은 게이트가 "sheet 등장"이 아니라 "fluent"를 보고 있음의 자기증명이다.
    //
    // 자기증명 검증: 비곱셈 6종은 아래 페이스 테스트에서 실측한 대로 15일째 전부
    // 도입된다 — 그 뒤 도입 포인터가 곱셈 후보(double)로 넘어가려는 "시도"는
    // latest.appearances가 3에 닿는 약 18~24일째에 일어난다. 40일은 그 시도가 실제로
    // 일어나고도 한참 남는 여유다. composeStrategyItems의 fluent 게이트 판정
    // (`gated`)을 임시로 무력화하고(`const gated = false && ...`) 같은 시드로
    // 재실행해 확인했다 — 게이트를 지우면 double·minus-one도 40일 안에
    // introducedAt이 채워져 이 테스트가 즉시 실패한다(재현 후 원복 완료, git diff
    // 없음). 즉 이 단언은 "시뮬레이션이 곱셈까지 도달을 못 해서" 우연히 통과하는 게
    // 아니라 실제로 fluent 게이트가 막고 있어서 통과한다.
    const sim = simulate({ days: 40, seed: 77, correctRate: () => 0.9 })
    const s = deriveStrategies(sim.log)
    const nonMul = STRATEGY_CATALOG.filter((d) => d.op !== '×').map((d) => d.id)
    const mul = STRATEGY_CATALOG.filter((d) => d.op === '×').map((d) => d.id)
    for (const id of nonMul) expect(s[id]?.introducedAt, id).not.toBeUndefined()
    for (const id of mul) expect(s[id], id).toBeUndefined()
  })

  it('도입 페이스: 등장 3회 게이트로 3일에 1개꼴 — 6종 도달일 상한·하한', () => {
    // 실측(9개 시드: 78·1·2·3·4·5·100·500·12345 — correctRate가 상수라 어느 수를
    // 뽑을지만 시드가 정하고, 게이트·로테이션 판단 자체는 시드와 무관하게 결정론적이다):
    // 6종 전부 도입된 날은 **모든 시드에서 15일로 동일**하다.
    // (브리프의 손계산 "3일마다 1개 ≈ 16일"은 처음 이틀의 특수 케이스를 놓쳤다 —
    // 아직 아무 전략도 없을 때는 오늘·복습 두 슬롯이 같은 전략(make-ten)을 두 번
    // 내보내 appearances가 하루에 2씩 쌓인다. 그래서 실제로는 1일 빠른 15일이 된다.)
    //
    // 결함 주입값(같은 9개 시드, 전부 결정론적으로 동일 — strategy.ts의
    // `(appearances ?? 0) < 3`의 3을 아래 값으로 바꿔 재실행 후 원복):
    //   게이트 소실(<1):    sixthAt = 6
    //   오프바이원(<2):     sixthAt = 10
    //   정상(<3, 현재 코드): sixthAt = 15
    //   오프바이원(<4):     sixthAt = 19
    //   느슨한 게이트(<5):   sixthAt = 24
    //
    // 문항1 로테이션 도입 후 위 5개 값을 **전부 재측정했고 하나도 바뀌지 않았다** —
    // 로테이션은 "더 열 게 없는 날"에만 작동하는데, 6종이 도입되는 15일 동안은
    // 항상 다음 전략을 열 수 있어 이 구간을 건드리지 않는다(도입 페이스 불변).
    //
    // 하한은 브리프의 15를 그대로 쓴다 — 실측이 정확히 15라 더 낮출 근거가 없고,
    // 가장 가까운 결함(>=2, 10)과 5의 여유가 있다.
    // 상한은 브리프의 20을 그대로 쓸 수 없다 — >=4 오프바이원 결함이 19를 내는데
    // 19 <= 20이라 그 결함이 통과해 버린다(직접 실행해 확인). 17로 낮춘다: 정상
    // 15와는 2의 여유, >=4 결함 19와는 2의 여유로 결함 쪽에 바짝 붙지 않으면서도
    // 확실히 갈라놓는다(>=5 결함 24와는 더 크게 벌어진다).
    const sim = simulate({ days: 25, seed: 78, correctRate: () => 0.9 })
    let sixthAt: number | null = null
    for (let d = 1; d <= 25 && sixthAt === null; d++) {
      const s = deriveStrategies(sim.log.slice(0, d))
      if (Object.values(s).filter((x) => x.introducedAt).length >= 6) sixthAt = d
    }
    expect(sixthAt).not.toBeNull()
    expect(sixthAt!).toBeGreaterThanOrEqual(15)
    expect(sixthAt!).toBeLessThanOrEqual(17)
  })

  it('도입된 전략은 로테이션에서 굶지 않는다 — 연속 미등장 상한과 영구 이탈 상한', () => {
    // appearanceGaps(스프린트용, 위 217행)와 같은 방법을 전략에 적용한다 — 전략별
    // 등장일 인덱스를 모아 (1) 연속 등장 사이 최대 간격과 (2) 마지막 등장 이후
    // 시뮬레이션 끝까지의 거리를 함께 잰다. 두 지표로 나눈 이유는 서로 다른 결함
    // 계열에 걸리기 때문이다 — "연속 간격" 하나만으로는 "도입된 전략이 반짝 등장 후
    // 영영 로테이션에서 빠지는" 결함을 못 잡는다(간격이 애초에 생기지 않는다,
    // seenOn 배열이 그 지점에서 끝나 버리므로). 스프린트 쪽(위 396~403행)이 이미
    // 같은 이유로 두 지표를 쌍으로 쓰고 있다.
    //
    // ⚠️ 아래 숫자는 **문항1 로테이션 도입 후 전부 재측정한 값**이다(사용자 결정:
    // 새 전략을 열 수 없는 날은 문항1도 로테이션에 합류한다 — strategy.ts 참고).
    // 그 변경으로 결함들이 걸리는 지표가 실제로 바뀌었다.
    //
    // 실측(정상 코드, days=40, 9개 시드 79·1·2·3·4·5·100·500·12345 전부 동일 —
    // 결정론적): 연속 간격 worst = 4, 도입 전략 수 = 6,
    // lastGaps = [2, 0, 1, 0, 1, 2](최대 2).
    // (문항1 로테이션 전에는 worst = 5, lastGaps 최대 4였다 — 로테이션이 넓어져
    // 두 지표 모두 좋아졌다. 상한은 그대로 두므로 여유만 늘었다.)
    //
    // 결함 주입 재측정(같은 config, seed 79):
    //   결함 A — 복습 슬롯을 항상 pool[0](최초 도입 전략)으로 고정
    //     (`review = pool.length > 0 ? pool[0]! : today`):
    //     연속 간격 = **13**, lastGaps 최대 = 4.
    //     문항1 로테이션 전에는 이 결함이 연속 간격 1 / lastGaps 최대 35로 나와
    //     **마지막 등장 거리에만** 걸렸다. 이제는 문항1이 모든 도입 전략을 돌기
    //     때문에 어떤 전략도 사라지지 않고, 대신 연속 간격이 튄다 — 걸리는 지표가
    //     바뀐 것이지 결함이 새는 것이 아니다(13 > 8).
    //   결함 B — 복습 슬롯을 무작위 선택
    //     (`review = pool[Math.floor(rand() * pool.length)]!`):
    //     연속 간격 = **10**, lastGaps 최대 = 4 — 연속 간격에 걸린다(10 > 8).
    //   결함 C — **문항1 로테이션을 되돌리고**(`today = … : latest`) 복습 슬롯도
    //     pool[0]으로 고정(= 두 슬롯 모두 못박힘):
    //     연속 간격 = 1(정상보다 작아 안 걸린다!), lastGaps = [0, 35, 32, 29, 26, 0].
    //     **마지막 등장 상한에만 걸린다** — 두 지표를 쌍으로 두는 이유가 이제
    //     이 결함이다. 문항1 고정으로 되돌아가면 6종 중 4종이 40일 창에서 사실상
    //     영영 다시 안 나오는데, 그것이 정확히 이번 변경이 없앤 실패다.
    //
    // 연속 간격 상한 8(유지): 정상 4와 4의 여유, 결함 B(10)·A(13)와 갈라놓는다.
    // 마지막 등장 상한 10(유지): 정상 최대 2와 8의 여유, 결함 C(최소 26)와 16의
    // 여유로 넉넉하게 갈라놓는다. 두 상한 다 낮추지 않았다 — 정상값이 좋아졌다고
    // 상한을 따라 내리면 다음 튜닝이 실패로 잡히고, 결함값과의 거리는 이미 충분하다.
    const sim = simulate({ days: 40, seed: 79, correctRate: () => 0.9 })
    const seenOn: Record<string, number[]> = {}
    sim.log.forEach((day, i) => {
      for (const item of day.sheet) {
        if (item.kind !== 'strategy') continue
        ;(seenOn[item.tag] ??= []).push(i)
      }
    })
    let worst = 0
    for (const at of Object.values(seenOn)) {
      for (let i = 1; i < at.length; i++) worst = Math.max(worst, at[i]! - at[i - 1]!)
    }
    expect(worst).toBeLessThanOrEqual(8)

    // 마지막 등장 단언 — 어떤 전략이 도중에 밀려난 뒤 영영 사라지면 "연속 등장
    // 사이의 간격"은 아예 생기지 않아 위 단언에 안 걸리고, 이쪽에만 걸린다.
    for (const id of Object.keys(seenOn)) {
      const at = seenOn[id]!
      expect(sim.log.length - 1 - at[at.length - 1]!, id).toBeLessThanOrEqual(10)
    }
  })
})
