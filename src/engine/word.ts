import type { Settings, WordItem } from '../data/types'
import { randInt } from './rand'

/**
 * 문장제(설계 §6.5, 스펙 §4). 텍스트는 생성 시점에 완성되어 sheet에 박제된다 —
 * 이름을 나중에 바꿔도 이미 만든 날의 문제지는 변하지 않는다(재인쇄 불변식).
 */

/** 받침 유무로 조사를 고른다. 마지막 글자가 한글 음절이 아니면 받침 있음으로 취급. */
export function josa(word: string, pair: '이/가' | '은/는' | '을/를'): string {
  const code = word.charCodeAt(word.length - 1)
  const isHangul = code >= 0xac00 && code <= 0xd7a3
  const batchim = !isHangul || (code - 0xac00) % 28 !== 0
  const [w, wo] = pair.split('/') as [string, string]
  return word + (batchim ? w : wo)
}

// edible: "하루에 ~을 먹어요" 문형이 고를 수 있는 소재인지. 눈검사(Step 5)에서
// "색종이를 먹어요"·"구슬을 먹어요"가 나온 것을 잡았다 — 문형은 소재를 가리지 않는데
// 먹는 동사만 소재를 가린다. false인 소재는 그 문형에서 제외한다(아래 GROUP_TEMPLATES).
type Goods = { n: string; unit: string; pack: string; edible: boolean }
const GOODS: Goods[] = [
  { n: '사탕', unit: '개', pack: '봉지', edible: true },
  { n: '구슬', unit: '개', pack: '주머니', edible: false },
  { n: '연필', unit: '자루', pack: '필통', edible: false },
  { n: '딸기', unit: '개', pack: '접시', edible: true },
  { n: '색종이', unit: '장', pack: '묶음', edible: false },
  { n: '쿠키', unit: '개', pack: '상자', edible: true },
  { n: '귤', unit: '개', pack: '봉지', edible: true },
  { n: '스티커', unit: '장', pack: '줄', edible: false },
]

// 소재 슬롯형은 (인물, 소재, 묶음수 a, 낱개수 b)를 받는다. 수사+단위 직결 금지 —
// "봉지 3개" 형태로만 쓴다(시뮬레이션이 "3봉지"의 부자연을 잡았다).
// eligible이 없으면 모든 소재가 맞는다(담다·나누다는 소재를 안 가린다) — 먹다만 가린다.
type GroupTpl = {
  text(p: string, g: Goods, a: number, b: number): string
  key(g: Goods): string
  eligible?(g: Goods): boolean
}
const GROUP_TEMPLATES: GroupTpl[] = [
  {
    key: (g) => g.n,
    text: (p, g, a, b) =>
      `${josa(p, '이/가')} ${josa(g.n, '을/를')} ${g.pack} 한 개에 ${b}${g.unit}씩 담았더니 ${g.pack} ${a}개가 되었어요. ${josa(g.n, '은/는')} 모두 몇 ${g.unit}일까요?`,
  },
  {
    key: (g) => g.n,
    text: (p, g, a, b) =>
      `${g.pack} 한 개에 ${josa(g.n, '이/가')} ${b}${g.unit}씩 들어 있어요. ${g.pack} ${a}개에는 모두 몇 ${g.unit} 들어 있을까요?`,
  },
  {
    key: (g) => g.n,
    text: (p, g, a, b) =>
      `${josa(p, '이/가')} 친구들에게 ${josa(g.n, '을/를')} ${b}${g.unit}씩 나누어 주려고 해요. 친구가 ${a}명이라면 ${josa(g.n, '이/가')} 모두 몇 ${g.unit} 필요할까요?`,
  },
  {
    key: (g) => g.n,
    eligible: (g) => g.edible,
    text: (p, g, a, b) =>
      `${josa(p, '은/는')} 하루에 ${josa(g.n, '을/를')} ${b}${g.unit}씩 먹어요. ${a}일 동안 모두 몇 ${g.unit} 먹을까요?`,
  },
]

// 몇 배: (주인공 p, 비교 대상 f, 소재, 배수 a, 기준량 b). 활동형은 소재가 문형에 내장.
type TimesTpl = {
  text(p: string, f: string, g: Goods, a: number, b: number): string
  key(g: Goods): string
  unit(g: Goods): string
}
const TIMES_TEMPLATES: TimesTpl[] = [
  {
    key: (g) => g.n,
    unit: (g) => g.unit,
    text: (p, f, g, a, b) =>
      `${josa(f, '은/는')} ${josa(g.n, '을/를')} ${b}${g.unit} 가지고 있어요. ${josa(p, '은/는')} ${f}의 ${a}배를 가지고 있어요. ${josa(p, '은/는')} ${josa(g.n, '을/를')} 몇 ${g.unit} 가지고 있을까요?`,
  },
  {
    key: () => '종이배',
    unit: () => '개',
    text: (p, f, _g, a, b) =>
      `${josa(f, '이/가')} 접은 종이배는 ${b}개예요. ${josa(p, '이/가')} 접은 종이배는 ${f}의 ${a}배예요. ${josa(p, '은/는')} 종이배를 몇 개 접었을까요?`,
  },
  {
    key: () => '줄넘기',
    unit: () => '번',
    text: (p, f, _g, a, b) =>
      `${josa(f, '은/는')} 줄넘기를 ${b}번 넘었어요. ${josa(p, '은/는')} ${f}의 ${a}배만큼 넘었어요. ${josa(p, '은/는')} 줄넘기를 몇 번 넘었을까요?`,
  },
  {
    key: (g) => g.n,
    unit: (g) => g.unit,
    text: (p, f, g, a, b) =>
      `${josa(f, '이/가')} 모은 ${josa(g.n, '은/는')} ${b}${g.unit}이에요. ${josa(p, '은/는')} ${f}의 ${a}배를 모았어요. ${josa(p, '이/가')} 모은 ${josa(g.n, '은/는')} 몇 ${g.unit}일까요?`,
  },
]

function pick<T>(arr: T[], rand: () => number): T {
  return arr[randInt(0, arr.length - 1, rand)]!
}

const ATTEMPTS = 60

/**
 * 하루 2문항: 묶어 세기(그림 칸) + 몇 배. 규칙 —
 * 두 문항 중 하나엔 반드시 딸 이름(몰입, 설계 §6.5), 같은 식·소재를 쓰지 않고
 * seen(공유 중복 집합)의 수식도 피한다. 몇 배의 배수는 2~5(시뮬레이션에서
 * "8배 줄넘기"의 부자연 확인 — 폭 커버는 스프린트의 몫이다).
 */
export function composeWordItems(input: {
  settings: Settings
  rand: () => number
  seen: Set<string>
}): WordItem[] {
  const { settings, rand, seen } = input
  const child = settings.childName || '나'
  const friends = settings.friendNames.length > 0 ? settings.friendNames : ['친구']
  const people = [child, ...friends]

  // 문항1: 묶어 세기. b개씩 a묶음 → 식은 "b×a"(하나에 든 수 × 묶음 수 — 교과 표기).
  let group: WordItem | null = null
  for (let i = 0; i < ATTEMPTS && !group; i++) {
    const a = randInt(2, 9, rand)
    const b = randInt(2, 9, rand)
    const expr = `${b}×${a}`
    if (seen.has(expr)) continue
    // 문형을 먼저 뽑고, 그 문형이 받을 수 있는 소재로만 좁혀서 뽑는다(먹다 문형은
    // 식용 소재만 — 순서를 바꾸면 "구슬을 먹어요"가 다시 나올 수 있다).
    const tpl = pick(GROUP_TEMPLATES, rand)
    const pool = GOODS.filter((x) => !tpl.eligible || tpl.eligible(x))
    const g = pick(pool, rand)
    const person = pick(people, rand)
    seen.add(expr)
    seen.add(`w-goods:${tpl.key(g)}`)
    seen.add(`w-person:${person}`)
    group = {
      id: 'w1',
      kind: 'word',
      tag: 'mul-group',
      text: tpl.text(person, g, a, b),
      needsDrawing: true,
      expression: expr,
      unit: g.unit,
      answer: a * b,
    }
  }

  // 문항2: 몇 배. 기준량 b(2~9) × 배수 a(2~5). 문항1에 딸이 없었으면 주인공은 딸이다.
  let times: WordItem | null = null
  for (let i = 0; i < ATTEMPTS && !times; i++) {
    const a = randInt(2, 5, rand)
    const b = randInt(2, 9, rand)
    const expr = `${b}×${a}`
    if (seen.has(expr)) continue
    const g = pick(GOODS, rand)
    const tpl = pick(TIMES_TEMPLATES, rand)
    if (seen.has(`w-goods:${tpl.key(g)}`)) continue
    const childRequired = !group || !group.text.includes(child)
    const person = childRequired ? child : pick(people, rand)
    const others = people.filter((p) => p !== person)
    const friend = pick(others.length > 0 ? others : ['친구'], rand)
    seen.add(expr)
    times = {
      id: 'w2',
      kind: 'word',
      tag: 'mul-times',
      text: tpl.text(person, friend, g, a, b),
      needsDrawing: false,
      expression: expr,
      unit: tpl.unit(g),
      answer: a * b,
    }
  }

  // ATTEMPTS 소진은 seen이 사실상 전 조합을 덮은 경우뿐(하루 sheet에서는 불가능).
  // 그래도 남으면 시끄럽게 실패한다 — 빈 문제지 금지는 호출자(화면 try)가 지킨다.
  if (!group || !times) throw new Error('composeWordItems: 문장제 조합을 찾지 못했다')
  return [group, times]
}
