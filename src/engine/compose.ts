import type {
  FactState,
  InverseItem,
  SheetItem,
  Settings,
  StrategyState,
  TypeState,
  VerticalItem,
  VerticalTag,
} from '../data/types'
import { GenerationError, VERTICAL_ORDER, generateVertical } from './vertical'
import { INVERSE_TEMPLATES, generateInverse, inverseHint } from './inverse'
import { accuracy, openTags, RECENT_WINDOW } from './derive'
import { composeStrategyItems } from './strategy'
import { composeWordItems, WORD_NAMES } from './word'

/** 같은 수식 중복을 피하기 위한 재시도 횟수. */
const DEDUP_ATTEMPTS = 60

/**
 * 하루 "생각하는 문제"(문제지 2장째) 문항 수 — 전략 2 + 문장제 2.
 *
 * 세로셈·역연산과 달리 설정으로 조절되지 않는 고정값이라, 홈 화면이 미리보기 문구를
 * 만들 때 읽을 곳이 여기밖에 없다. 화면 테스트가 없는 프로젝트라 이 상수가 실제 sheet와
 * 어긋나도 컴파일러는 모른다 — compose.test.ts가 둘을 대조해서 그 구멍을 막는다.
 */
export const THINKING_ITEMS_PER_DAY = 4

function pickWeighted(tags: VerticalTag[], weights: number[], rand: () => number): VerticalTag {
  const total = weights.reduce((s, w) => s + w, 0)
  let r = rand() * total
  for (let i = 0; i < tags.length; i++) {
    r -= weights[i]!
    if (r <= 0) return tags[i]!
  }
  return tags[tags.length - 1]!
}

/**
 * 유형별 가중치. 정답률이 낮을수록 크게 나오고,
 * 가장 최근에 열린 유형에는 도입 가산점을 준다.
 * 도입 가산점은 표본이 RECENT_WINDOW회 미만일 때만 준다 — 표본이 다 찰 때까지의
 * "아직 증명되지 않음" 구간에 대한 도입 보정일 뿐, 영구 특혜가 아니다.
 */
function weightsFor(tags: VerticalTag[], types: Record<string, TypeState>): number[] {
  return tags.map((tag, i) => {
    const base = 1 - accuracy(types[tag]) + 0.1
    const isNewest = i === tags.length - 1 && tags.length > 1
    const attemptCount = types[tag]?.attempts.length ?? 0
    const stillIntroducing = attemptCount < RECENT_WINDOW
    return isNewest && stillIntroducing ? base + 0.6 : base
  })
}

/**
 * 요청한 유형으로 문항을 만들되, 생성에 실패하면
 * 도입 순서상 더 앞(= 더 쉬운) 유형으로 폴백한다. 빈 문제지는 내지 않는다.
 */
function generateWithFallback(tag: VerticalTag, rand: () => number): Omit<VerticalItem, 'id'> {
  let index = VERTICAL_ORDER.indexOf(tag)
  while (index >= 0) {
    try {
      return generateVertical(VERTICAL_ORDER[index]!, rand)
    } catch (e) {
      if (!(e instanceof GenerationError)) throw e
      index--
    }
  }
  throw new GenerationError(`${tag} (폴백 전부 실패)`)
}

/**
 * 그날 종이 문항을 조립한다.
 * 결과는 호출부가 days[date].sheet에 그대로 저장하며, 재인쇄 시 재생성하지 않는다.
 */
export function composeSheet(input: {
  settings: Settings
  types: Record<string, TypeState>
  strategies: Record<string, StrategyState>
  facts: Record<string, FactState>
  /** deriveLastSeen(days). 복습 슬롯이 간격을 재는 데 쓴다(Task 3). */
  lastSeen: Record<string, string>
  /** 오늘의 dayKey. 엔진은 new Date()를 부르지 않는다. */
  today: string
  rand?: () => number
}): SheetItem[] {
  const rand = input.rand ?? Math.random
  const tags = openTags(input.types)
  const weights = weightsFor(tags, input.types)

  const items: SheetItem[] = []
  const seen = new Set<string>()

  for (let i = 0; i < input.settings.verticalCount; i++) {
    let made: Omit<VerticalItem, 'id'> | null = null
    for (let attempt = 0; attempt < DEDUP_ATTEMPTS; attempt++) {
      const candidate = generateWithFallback(pickWeighted(tags, weights, rand), rand)
      const key = `${candidate.a}${candidate.op}${candidate.b}`
      if (seen.has(key)) continue
      seen.add(key)
      made = candidate
      break
    }
    if (!made) {
      // 중복을 피하지 못하면 중복을 허용하는 대신 빈 자리를 두지 않는다.
      made = generateWithFallback(tags[0]!, rand)
    }
    items.push({ ...made, id: `v${i + 1}` })
  }

  for (let i = 0; i < input.settings.inverseCount; i++) {
    // rand()가 [0,1) 밖(특히 정확히 1)을 내도 배열 경계를 벗어나지 않도록 클램프한다.
    // pickWeighted는 누적 감산으로 이미 이 경계를 안전하게 처리하지만, 여기는 별도 인덱싱이라
    // 같은 보장이 없었다.
    const templateIndex = Math.min(
      INVERSE_TEMPLATES.length - 1,
      Math.floor(rand() * INVERSE_TEMPLATES.length),
    )
    const template = INVERSE_TEMPLATES[templateIndex]!
    const base = generateInverse(template, rand)
    const item: InverseItem = { ...base, id: `inv${i + 1}` }
    if (i === 0) item.hint = inverseHint(base)
    items.push(item)
  }

  // 전략 2문항 — seen(수식 중복 집합)을 세로셈과 공유한다. 키 형식 `${a}${op}${b}`이
  // 세로셈과 같은 형식이라, 이미 나온 27+15가 전략에서 다시 나오는 것을 자동으로 막는다.
  //
  // 아래 두 존의 문항 수는 설정과 무관하게 고정이고, 그 합이 THINKING_ITEMS_PER_DAY다.
  // 홈 화면의 미리보기 문구가 그 상수를 읽는다 — 문구가 조용히 낡는 것을 막으려면
  // 여기가 단일 출처여야 한다(화면 테스트가 없으므로 compose.test.ts가 이 상수와
  // 실제 sheet를 대조한다).
  items.push(
    ...composeStrategyItems({ strategies: input.strategies, facts: input.facts, rand, seen }),
  )
  // 문장제 2문항 — 곱셈식·소재·인물 중복도 seen에서 함께 관리된다.
  items.push(...composeWordItems({ names: WORD_NAMES, rand, seen }))

  return items
}
