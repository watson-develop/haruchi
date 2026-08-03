import type {
  FactState,
  StrategyId,
  StrategyItem,
  StrategyState,
  StrategyStep,
} from '../data/types'
import { randInt } from './rand'
import { carryCount, borrowCount } from './vertical'

/**
 * 전략 카탈로그(설계 §6.4, 스펙 §3). 배열 순서가 곧 도입 순서다.
 *
 * 렌더러·채점·리포트는 이 카탈로그의 내부를 모른다 — steps의 {}와 blanks만 안다.
 * 새 전략 추가 = 항목 추가. 인쇄 코드는 손대지 않는다.
 *
 * 도입 순서의 근거: make-ten은 2-1 교과의 핵심이라 이미 친숙하다(첫 성공 경험 —
 * Phase 2가 1단을 앞세웠던 것과 같은 원리). 덧셈·뺄셈을 교차시키고, 발상 전환이
 * 큰 count-up("빼기를 채우기로")은 뒤로. 곱셈 2종은 fluent 게이트 뒤에 있다.
 * 순서를 바꾸는 비용은 낮다 — "다음에 무엇을 꺼낼지"만 정한다.
 */
export type StrategyDef = {
  id: StrategyId
  op: '+' | '−' | '×'
  name: string
  gen(rand: () => number): { a: number; b: number }
  applicable(a: number, b: number): boolean
  steps(a: number, b: number): StrategyStep[]
}

/** 곱셈 전략(double·minus-one)이 열리는 fluent 최소치. 구구단표가 머리에 없으면
 *  7×4×2는 우회로가 아니라 짐이다 — CHECKUP_MIN_FLUENT(checkup.ts)와 같은 발상. */
export const MUL_STRATEGY_MIN_FLUENT = 10

const MAX_ATTEMPTS = 2000

/** applicable을 만족할 때까지 기각 표집한다. vertical.ts의 generateVertical과 같은 방식. */
function sample(
  def: Pick<StrategyDef, 'applicable'>,
  lo: number,
  hi: number,
  rand: () => number,
  shape?: (x: number, y: number) => { a: number; b: number },
): { a: number; b: number } {
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const x = randInt(lo, hi, rand)
    const y = randInt(lo, hi, rand)
    const { a, b } = shape ? shape(x, y) : { a: x, b: y }
    if (def.applicable(a, b)) return { a, b }
  }
  throw new Error(`전략 생성 실패: 표집 한도 초과`)
}

export const STRATEGY_CATALOG: StrategyDef[] = [
  {
    id: 'make-ten',
    op: '+',
    name: '10 만들어 더하기',
    applicable: (a, b) =>
      a >= 11 && a <= 89 && b >= 11 && b <= 89 && carryCount(a, b) >= 1 && (a % 10) + (b % 10) > 10,
    gen(rand) {
      return sample(this, 11, 89, rand)
    },
    steps(a, b) {
      const c = 10 - (a % 10) // a를 다음 10으로 채우는 보수
      return [
        { text: `${a} + ${c} = {}`, blanks: [a + c] },
        { text: `${a + c} + ${b - c} = {}`, blanks: [a + b] },
      ]
    },
  },
  {
    id: 'split-place',
    op: '−',
    name: '자리로 나누어 빼기',
    // b % 10 !== 0을 안 두면 일의 자리 단계가 "x − 0"이 되고(예: 21−20), 십의 자리가
    // 같으면 그 단계가 "x − x = 0"이 된다(예: 38−35). 둘 다 산술적으로는 맞지만
    // "자리로 나누어 빼기"라는 전략 자체가 무의미해진다 — 어느 자리도 실제로 나눌
    // 필요가 없다. split-subtrahend가 같은 이유로 b % 10 !== 0을 두는 것과 짝이다.
    applicable: (a, b) =>
      a > b &&
      b >= 11 &&
      a <= 99 &&
      borrowCount(a, b) === 0 &&
      b % 10 !== 0 &&
      Math.floor(a / 10) !== Math.floor(b / 10),
    gen(rand) {
      return sample(this, 11, 99, rand, (x, y) => ({ a: Math.max(x, y), b: Math.min(x, y) }))
    },
    steps(a, b) {
      const a10 = Math.floor(a / 10) * 10
      const b10 = Math.floor(b / 10) * 10
      return [
        { text: `${a10} − ${b10} = {}`, blanks: [a10 - b10] },
        { text: `${a % 10} − ${b % 10} = {}`, blanks: [(a % 10) - (b % 10)] },
        { text: `합치면 ${a} − ${b} = {}`, blanks: [a - b] },
      ]
    },
  },
  {
    id: 'round-adjust',
    op: '+',
    name: '어림하고 고치기',
    applicable: (a, b) => a >= 11 && a <= 89 && b >= 18 && b <= 89 && [8, 9].includes(b % 10),
    gen(rand) {
      return sample(this, 11, 89, rand)
    },
    steps(a, b) {
      const r = 10 - (b % 10) // 1 또는 2
      return [
        { text: `${a} + ${b + r} = {}`, blanks: [a + b + r] },
        { text: `${a + b + r} − ${r} = {}`, blanks: [a + b] },
      ]
    },
  },
  {
    id: 'split-subtrahend',
    op: '−',
    name: '빼는 수 가르기',
    applicable: (a, b) => a > b && b >= 11 && b <= 89 && a <= 99 && b % 10 !== 0,
    gen(rand) {
      return sample(this, 11, 99, rand, (x, y) => ({ a: Math.max(x, y), b: Math.min(x, y) }))
    },
    steps(a, b) {
      const b10 = Math.floor(b / 10) * 10
      return [
        { text: `${a} − ${b10} = {}`, blanks: [a - b10] },
        { text: `${a - b10} − ${b % 10} = {}`, blanks: [a - b] },
      ]
    },
  },
  {
    id: 'anchor',
    op: '−',
    name: '기준수 만들어 빼기',
    applicable: (a, b) => b % 10 === 9 && b >= 9 && a > b + 1 && a <= 99,
    gen(rand) {
      return sample(this, 9, 99, rand, (x, y) => ({ a: Math.max(x, y), b: Math.min(x, y) }))
    },
    steps(a, b) {
      return [
        { text: `${a} − ${b + 1} = {}`, blanks: [a - b - 1] },
        { text: `${a - b - 1} + 1 = {}`, blanks: [a - b] },
      ]
    },
  },
  {
    id: 'count-up',
    op: '−',
    name: '채워 세기',
    applicable: (a, b) => {
      const next10 = Math.ceil(b / 10) * 10
      return a - b >= 3 && a - b <= 15 && b % 10 !== 0 && next10 < a && b >= 11
    },
    gen(rand) {
      return sample(this, 11, 99, rand, (x, y) => ({ a: Math.max(x, y), b: Math.min(x, y) }))
    },
    steps(a, b) {
      const next10 = Math.ceil(b / 10) * 10
      return [
        { text: `${b}에서 ${next10}까지 {}`, blanks: [next10 - b] },
        { text: `${next10}에서 ${a}까지 {}`, blanks: [a - next10] },
        { text: `합치면 {}`, blanks: [a - b] },
      ]
    },
  },
  {
    id: 'double',
    op: '×',
    name: '두 배 하기',
    applicable: (a, b) => a >= 2 && a <= 9 && b % 2 === 0 && b >= 4 && b <= 9,
    gen(rand) {
      return sample(this, 2, 9, rand)
    },
    steps(a, b) {
      return [
        { text: `${a} × ${b / 2} = {}`, blanks: [a * (b / 2)] },
        { text: `${a * (b / 2)} × 2 = {}`, blanks: [a * b] },
      ]
    },
  },
  {
    id: 'minus-one',
    op: '×',
    name: '하나 빼기',
    applicable: (a, b) => b === 9 && a >= 2 && a <= 9,
    gen(rand) {
      return sample(this, 2, 9, rand, (x) => ({ a: x, b: 9 }))
    },
    steps(a, _b) {
      return [
        { text: `10 × ${a} = {}`, blanks: [10 * a] },
        { text: `${10 * a} − ${a} = {}`, blanks: [9 * a] },
      ]
    },
  },
]

export const STRATEGY_NAMES: Record<string, string> = Object.fromEntries(
  STRATEGY_CATALOG.map((s) => [s.id, s.name]),
)

/** 같은 수식 두 방법 배치 확률(설계 §6.4 "섞는다"). 낮게 — 매일이면 패턴이 되어 신선함이 죽는다. */
const SAME_EXPR_CHANCE = 0.2

/** 후보 중 lastAppearedAt이 가장 오래된 것(동률이면 카탈로그 순서가 앞선 것 — 결정적). */
function longestUnseen(
  candidates: StrategyDef[],
  strategies: Record<string, StrategyState>,
): StrategyDef {
  return candidates.reduce((oldest, s) =>
    (strategies[s.id]!.lastAppearedAt ?? '') < (strategies[oldest.id]!.lastAppearedAt ?? '')
      ? s
      : oldest,
  )
}

/**
 * 그날 전략 2문항. 문항1 = 오늘의 방법, 문항2 = 어제의 방법(유지 복습).
 *
 * 게이트는 등장 횟수다(숙련이 아니라 노출 페이스 조절 — 채점이 밀려도 멈추지 않는다).
 * 곱셈 전략은 fluent가 MUL_STRATEGY_MIN_FLUENT 미만이면 열리지 않는다 — 그 앞에서
 * 도입이 멈추고 기존 전략들로 로테이션한다.
 *
 * **"오늘의 방법"은 새 방법이 있을 때만 고정석이다**(사용자 결정, 2026-08-03 — 스펙 §3의
 * "문항1 = 최신 도입"을 갱신한다). 문항1의 의도는 갓 도입한 방법에 집중 노출을 주는
 * 것인데, 더 열 게 없으면(카탈로그 소진이거나 곱셈 게이트가 닫혀 있으면) 그 의도는 이미
 * 달성된 상태다. 그런데도 문항1을 마지막 전략에 계속 못박아 두면 그 전략만 매일 나온다 —
 * 실측: 8종 도입 후 minus-one이 60일 중 40일, 게다가 minus-one의 유효 문제는 총 8개
 * (b === 9, 2 ≤ a ≤ 9)뿐이라 같은 문제가 계속 재등장했다. 곱셈 게이트가 영영 안 열리는
 * 아이(정답률 0.45 실측)는 count-up이 15일째부터 영구 고정됐다. 그래서 새 전략을 열 수
 * 없는 날은 **문항1도 로테이션에 합류**한다 — 두 문항 모두 도입된 것 중 가장 오래
 * 안 나온 순서로 고른다.
 */
export function composeStrategyItems(input: {
  strategies: Record<string, StrategyState>
  facts: Record<string, FactState>
  rand: () => number
  seen: Set<string>
}): StrategyItem[] {
  const { strategies, facts, rand, seen } = input
  const fluentCount = Object.values(facts).filter((f) => f.status === 'fluent').length

  const introduced = STRATEGY_CATALOG.filter((s) => strategies[s.id]?.introducedAt)
  const latest = introduced[introduced.length - 1]

  let today: StrategyDef
  if (!latest) {
    today = STRATEGY_CATALOG[0]!
  } else if ((strategies[latest.id]!.appearances ?? 0) < 3) {
    // 갓 도입한 전략은 등장 3회를 채울 때까지 문항1에 머문다 — 도입 페이스를 정하는
    // 것이 이 게이트이므로, 아래 로테이션이 이 구간을 건드리면 페이스가 바뀐다.
    today = latest
  } else {
    const next = STRATEGY_CATALOG[STRATEGY_CATALOG.indexOf(latest) + 1]
    const gated = next && next.op === '×' && fluentCount < MUL_STRATEGY_MIN_FLUENT
    // 열 수 있는 새 전략이 있으면 문항1은 그 자리다(도입 페이스 불변).
    // 없으면 문항1도 로테이션 — 위 주석의 "고정석" 문단 참고.
    today = next && !gated ? next : longestUnseen(introduced, strategies)
  }

  // 어제의 방법: 오늘 전략을 뺀 도입 전략 중 lastAppearedAt이 가장 오래된 것.
  // (문항1이 로테이션에 합류한 날에는 자연히 "두 번째로 오래된 것"이 된다.)
  const pool = introduced.filter((s) => s.id !== today.id)
  const review = pool.length > 0 ? longestUnseen(pool, strategies) : today

  const first = genAvoiding(today, rand, seen)
  let second: { a: number; b: number }
  if (
    review.id !== today.id &&
    review.op === today.op &&
    review.applicable(first.a, first.b) &&
    rand() < SAME_EXPR_CHANCE
  ) {
    // 같은 수식 두 방법 — 답이 똑같이 나오는 것을 눈으로 본다(설계 §6.4).
    second = { a: first.a, b: first.b }
  } else {
    second = genAvoiding(review, rand, seen)
  }

  const make = (def: StrategyDef, ab: { a: number; b: number }, id: string): StrategyItem => ({
    id,
    kind: 'strategy',
    tag: def.id,
    a: ab.a,
    b: ab.b,
    op: def.op,
    steps: def.steps(ab.a, ab.b),
    answer: def.op === '+' ? ab.a + ab.b : def.op === '−' ? ab.a - ab.b : ab.a * ab.b,
  })
  return [make(today, first, 's1'), make(review, second, 's2')]
}

/** seen에 없는 수 조합을 뽑는다. 몇 번 부딪히면 폴백(split-subtrahend — 원문 "언제나 안전"). */
function genAvoiding(
  def: StrategyDef,
  rand: () => number,
  seen: Set<string>,
): { a: number; b: number } {
  for (let i = 0; i < 20; i++) {
    try {
      const ab = def.gen(rand)
      const key = `${ab.a}${def.op}${ab.b}`
      if (seen.has(key)) continue
      seen.add(key)
      return ab
    } catch {
      break // 표집 실패 → 폴백
    }
  }
  // 함정 주의: 이 폴백은 split-subtrahend가 뽑은 (a,b)를 반환하지만, 호출자(위)는
  // 이 값을 "원래 def"(호출한 today/review)의 op·steps로 렌더한다 — split-subtrahend의
  // steps로 렌더하지 않는다. 8종 중 7종은 steps(a,b)가 실제로 a,b에서 답을 계산하는
  // 대수적 항등식이라, (a,b) 자체가 split-subtrahend의 applicable을 만족하지 않아도
  // 산술은 맞는다. 단 하나 minus-one만 예외다 — steps(a,_b)가 b를 무시하고 9*a를 답으로
  // 고정한다(applicable이 b===9만 검사하기 때문). 폴백이 minus-one에 걸리면 마지막
  // 빈칸(9a)이 answer(a×b)와 어긋나 채점 계약이 깨진다.
  //
  // 도달 가능성 — 아래 두 근거는 리뷰에서 틀렸다고 정정됐다: "seen에 +/− 키만 쌓인다"는
  // 이 함수 자신이 double·minus-one일 때 ×키를 등록하므로 거짓이고, "minus-one.gen이 안
  // 던진다"는 이 루프의 두 출구 중 catch→break 하나만 배제할 뿐, seen 충돌로 20회를 다
  // 쓰고 떨어지는 출구는 막지 못한다. 실제 근거는 서로소성 + 기수다: minus-one의 키 공간은
  // `2×9`~`9×9` 8개뿐이고 double은 b가 항상 짝수라 이 8개와 절대 겹치지 않는다.
  //
  // 하루 sheet의 전략 문항은 2개(s1·s2)이고, 이 함수가 minus-one용으로 불릴 때 다른 한
  // 문항은 반드시 **다른** 전략이다. 근거를 정확히 적는다 — "today !== review를
  // composeStrategyItems가 보장한다"는 과한 전제였다(pool이 비면 review = today가 되고,
  // 도입된 전략이 1종뿐인 1~3일차에 실제로 그렇게 된다). 실제 근거는 카탈로그 위치다:
  // minus-one은 마지막 항목이라 그것이 도입돼 있다면 앞의 7종도 이미 도입돼 있고, 따라서
  // pool이 비는 경우(도입 1종)에 minus-one이 걸릴 수 없다. 슬롯이 문항1이든 문항2든
  // 무관하다 — 문항1도 로테이션에 합류하면서 minus-one이 review로 나올 수 있게 됐지만,
  // 이 논증은 슬롯이 아니라 "다른 한 문항이 minus-one이 아니다"에만 기댄다.
  // 그 다른 한 문항이 double이면 키가 `a×짝수`라 서로소이고, 비곱셈이면 op 문자가 달라
  // 겹치지 않는다(compose.ts가 앞서 넣은 세로셈 키도 +/−다). 그러므로 이 함수가
  // minus-one용으로 불릴 때 seen에는 그 8개 중 어느 것도 없고, 첫 표집이 항상 충돌 없이
  // 통과하므로 이 폴백은 minus-one에서 도달하지 않는다 — 현재 설계(하루 2문항, seen을
  // 이 함수 밖에서 재사용하지 않음) 전제다.
  const fallback = STRATEGY_CATALOG.find((s) => s.id === 'split-subtrahend')!
  const ab = fallback.gen(rand)
  // 렌더링은 fallback.op가 아니라 원래 def.op로 이뤄지므로(위 함정 주의 참고), 등록도
  // def.op로 해야 실제 sheet 수식과 seen의 키가 일치한다 — 아니면 중복 회피가 새는 채로
  // 다음 문항이 이 (a,b)를 다시 뽑을 수 있다(리뷰 발견, fallback.op였던 버그).
  seen.add(`${ab.a}${def.op}${ab.b}`)
  return ab
}
