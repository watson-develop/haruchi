import type { Day, ReviewStep, WordAttempt, WordProblem, WordWrong } from '../data/types'
import { DAN_MAX, DAN_MIN, shuffled } from './facts'

/**
 * 문장제 엔진(specs/2026-09-30-word-problems-design.md). 순수 함수만 둔다.
 * 유형은 연산이 아니라 **상황의 구조**로 나눈다 — id는 `묶음:변형`이고 `:` 앞이 곧 묶음이다.
 * 이 파일이 유형 id·라벨·답 공식의 유일한 주인이다(스펙 §3의 표가 계약).
 */

/** 하루 문장제 수(스펙 §4). */
export const WORD_PER_DAY = 3

export const WORD_GROUPS = ['join', 'change', 'compare', 'mult', 'two', 'reverse'] as const
export type WordGroup = (typeof WORD_GROUPS)[number]

/** 아이용 묶음 이름. story 단계의 보기이자 맞힌 뒤 한 줄의 출처다. */
export const WORD_GROUP_LABELS: Record<WordGroup, string> = {
  join: '모으기',
  change: '바뀌기',
  compare: '비교하기',
  mult: '묶음',
  two: '두 번 계산',
  reverse: '거꾸로',
}

/** story 단계 보기 — 고정 5개·고정 순서(reverse 제외). 저장된 `correct`가 이 인덱스다. */
export const STORY_GROUPS: readonly WordGroup[] = ['join', 'change', 'compare', 'mult', 'two']

export const WORD_TYPES = [
  'join:whole',
  'join:part',
  'change:inc-end',
  'change:dec-end',
  'change:inc-diff',
  'change:dec-diff',
  'change:inc-start',
  'change:dec-start',
  'compare:diff',
  'compare:more',
  'compare:less',
  'compare:rev-less',
  'compare:rev-more',
  'mult:group',
  'mult:times',
  'two:mult-sub',
  'two:mult-add',
  'two:add-sub',
  'reverse:after-sub',
  'reverse:after-add',
  'reverse:wrong-add',
  'reverse:wrong-sub',
] as const
export type WordTypeId = (typeof WORD_TYPES)[number]

/** 부모용 세부 이름(리포트). 모르는 유형은 화면이 `?? '기타'`로 받는다. */
export const WORD_TYPE_LABELS: Record<WordTypeId, string> = {
  'join:whole': '모으기 — 전체',
  'join:part': '모으기 — 한 부분',
  'change:inc-end': '늘어난 뒤',
  'change:dec-end': '줄어든 뒤',
  'change:inc-diff': '얼마나 늘었나',
  'change:dec-diff': '얼마나 줄었나',
  'change:inc-start': '처음을 모를 때(늘어남)',
  'change:dec-start': '처음을 모를 때(줄어듦)',
  'compare:diff': '차이',
  'compare:more': '더 많은 쪽',
  'compare:less': '더 적은 쪽',
  'compare:rev-less': '거꾸로 말할 때(적어요)',
  'compare:rev-more': '거꾸로 말할 때(많아요)',
  'mult:group': '묶음',
  'mult:times': '몇 배',
  'two:mult-sub': '곱하고 빼기',
  'two:mult-add': '곱하고 더하기',
  'two:add-sub': '더하고 빼기',
  'reverse:after-sub': '어떤 수(뺐더니)',
  'reverse:after-add': '어떤 수(더했더니)',
  'reverse:wrong-add': '잘못 계산(더할 것을 뺌)',
  'reverse:wrong-sub': '잘못 계산(뺄 것을 더함)',
}

/** ★ 단서어 함정 유형 — 문장의 동사·비교어가 가리키는 연산과 실제 연산이 반대다(스펙 §3). */
export const KEYWORD_TYPES: ReadonlySet<string> = new Set<WordTypeId>([
  'change:inc-diff',
  'change:inc-start',
  'change:dec-start',
  'compare:rev-less',
  'compare:rev-more',
  'reverse:after-sub',
  'reverse:after-add',
])

export function groupOf(type: string): WordGroup | null {
  if (!(WORD_TYPES as readonly string[]).includes(type)) return null
  return type.slice(0, type.indexOf(':')) as WordGroup
}

export function typesOf(g: WordGroup): WordTypeId[] {
  return WORD_TYPES.filter((t) => t.startsWith(`${g}:`))
}

// ─────────── 조사 (d80bfd1^:src/engine/word.ts에서 되살림 + 숫자) ───────────

/** 한글 음절의 받침 유무. 완성형 밖이면 받침 있음 — 숫자에는 쓰지 않는다(numJosa). */
function hasBatchim(word: string): boolean {
  const code = word.charCodeAt(word.length - 1)
  const isHangul = code >= 0xac00 && code <= 0xd7a3
  return !isHangul || (code - 0xac00) % 28 !== 0
}

/** 앞이 받침 있을 때, 뒤가 없을 때. */
type Pair = '이/가' | '은/는' | '을/를' | '과/와'

export function josa(word: string, pair: Pair): string {
  const [w, wo] = pair.split('/') as [string, string]
  return word + (hasBatchim(word) ? w : wo)
}

/** 받침 있는 이름에 '이'를 끼운 어간(서연 → 서연이). 「~에게」·「~보다」·「~의」 앞에도 쓴다. */
export function personStem(name: string): string {
  return hasBatchim(name) ? `${name}이` : name
}

/** 사람 이름 조사 — 받침 있으면 '이'를 끼우고 받침-없음 조사(서연이가·서연이는·서연이를). */
export function personJosa(name: string, pair: '이/가' | '은/는' | '을/를'): string {
  if (!hasBatchim(name)) return josa(name, pair)
  const [, wo] = pair.split('/') as [string, string]
  return `${personStem(name)}${wo}`
}

/**
 * 숫자 뒤 조사. 옛 hasBatchim은 숫자를 받침 있음으로 봐서 "12을"이 나왔다. 읽기의 끝 글자로
 * 정한다 — 끝자리 2·4·5·9(이·사·오·구)만 받침 없음, 0은 십·백·영이라 받침 있음.
 */
export function numJosa(n: number, pair: Pair): string {
  const [w, wo] = pair.split('/') as [string, string]
  return `${n}${[2, 4, 5, 9].includes(Math.abs(n) % 10) ? wo : w}`
}

// ─────────── 소재 ───────────

/** 가상 이름. 실명 금지, 사물로 읽히는 이름(지우·하루) 금지 — HANDOFF 2026-08-26. */
export const NAMES = ['유나', '민아', '지호', '서연', '도윤'] as const

export const THINGS = [
  { noun: '사탕', unit: '개' },
  { noun: '구슬', unit: '개' },
  { noun: '스티커', unit: '장' },
  { noun: '색종이', unit: '장' },
  { noun: '딱지', unit: '장' },
  { noun: '연필', unit: '자루' },
  { noun: '공책', unit: '권' },
] as const

/** extra-number의 나이 후보. 풀이의 어느 수와도 같지 않은 것을 고른다. */
const AGES = [7, 8, 9]
/** extra-number가 얹히는 확률(거꾸로 묶음 제외). */
const EXTRA_RATE = 0.3

// ─────────── 식 ───────────

type Rand = () => number
type Op = '+' | '−' | '×'
type Step = { x: number; op: Op; y: number }

const val = (s: Step): number => (s.op === '+' ? s.x + s.y : s.op === '−' ? s.x - s.y : s.x * s.y)
/** 식 문자열. 뺄셈은 U+2212. 테스트·화면이 이 모양을 그대로 쓴다. */
const str = (s: Step): string => `${s.x} ${s.op} ${s.y}`

const int = (r: Rand, lo: number, hi: number): number =>
  lo + Math.min(hi - lo, Math.floor(r() * (hi - lo + 1)))
const pick = <T>(r: Rand, xs: readonly T[]): T =>
  xs[Math.min(xs.length - 1, Math.floor(r() * xs.length))]!

/** x + y ≤ 99, 둘 다 ≥ 10. 덧셈·뺄셈 유형 대부분이 이 쌍에서 답 공식을 거꾸로 만든다. */
function sumPair(r: Rand): [number, number] {
  const x = int(r, 10, 89)
  return [x, int(r, 10, 99 - x)]
}

const MULT_PAIRS: [number, number][] = []
for (let a = DAN_MIN; a <= DAN_MAX; a++)
  for (let b = DAN_MIN; b <= DAN_MAX; b++) MULT_PAIRS.push([a, b])

// ─────────── 유형 정의 ───────────

type Ctx = { p: string; q: string; noun: string; u: string; age: string }
type Def = {
  make: (r: Rand) => { n: number[]; steps: Step[] }
  texts: ((c: Ctx, n: number[]) => string)[]
}

// 템플릿 도우미. A는 주인공의 **첫 언급**(extra-number의 「N살 」이 붙는 자리)이다.
const A = (c: Ctx, pair: '이/가' | '은/는' | '을/를'): string => c.age + personJosa(c.p, pair)
const P = (c: Ctx, pair: '이/가' | '은/는' | '을/를'): string => personJosa(c.p, pair)
const Q = (c: Ctx, pair: '이/가' | '은/는' | '을/를'): string => personJosa(c.q, pair)
const O = (c: Ctx, pair: Pair): string => josa(c.noun, pair)
const U = (c: Ctx, n: number, pair: Pair): string => `${n}${josa(c.u, pair)}`

const DEFS: Record<WordTypeId, Def> = {
  'join:whole': {
    make: (r) => {
      const [a, b] = sumPair(r)
      return { n: [a, b], steps: [{ x: a, op: '+', y: b }] }
    },
    texts: [
      (c, [a, b]) =>
        `${A(c, '은/는')} ${O(c, '을/를')} ${a}${c.u} 가지고 있고, ${Q(c, '은/는')} ${b}${c.u} 가지고 있어요. 두 사람이 가진 ${O(c, '은/는')} 모두 몇 ${c.u}일까요?`,
      (c, [a, b]) =>
        `${A(c, '이/가')} 빨간 ${c.noun} ${U(c, a!, '과/와')} 파란 ${c.noun} ${U(c, b!, '을/를')} 샀어요. ${P(c, '이/가')} 산 ${O(c, '은/는')} 모두 몇 ${c.u}일까요?`,
    ],
  },
  'join:part': {
    make: (r) => {
      const [ans, a] = sumPair(r)
      const t = ans + a
      return { n: [t, a], steps: [{ x: t, op: '−', y: a }] }
    },
    texts: [
      (c, [t, a]) =>
        `${A(c, '은/는')} ${O(c, '을/를')} 모두 ${t}${c.u} 가지고 있어요. 그중 ${U(c, a!, '은/는')} 빨간색이고 나머지는 파란색이에요. 파란 ${O(c, '은/는')} 몇 ${c.u}일까요?`,
      (c, [t, a]) =>
        `${A(c, '이/가')} 가진 ${c.noun} ${t}${c.u} 중에서 ${U(c, a!, '은/는')} 새것이에요. 새것이 아닌 ${O(c, '은/는')} 몇 ${c.u}일까요?`,
    ],
  },
  'change:inc-end': {
    make: (r) => {
      const [a, b] = sumPair(r)
      return { n: [a, b], steps: [{ x: a, op: '+', y: b }] }
    },
    texts: [
      (c, [a, b]) =>
        `${A(c, '은/는')} ${O(c, '을/를')} ${a}${c.u} 가지고 있었어요. ${personStem(c.q)}에게서 ${U(c, b!, '을/를')} 더 받았어요. 이제 ${P(c, '이/가')} 가진 ${O(c, '은/는')} 몇 ${c.u}일까요?`,
      (c, [a, b]) =>
        `${A(c, '이/가')} ${O(c, '을/를')} ${a}${c.u} 모았어요. 오늘 ${U(c, b!, '을/를')} 더 모았어요. 모은 ${O(c, '은/는')} 모두 몇 ${c.u}일까요?`,
    ],
  },
  'change:dec-end': {
    make: (r) => {
      const [ans, b] = sumPair(r)
      const a = ans + b
      return { n: [a, b], steps: [{ x: a, op: '−', y: b }] }
    },
    texts: [
      (c, [a, b]) =>
        `${A(c, '은/는')} ${O(c, '을/를')} ${a}${c.u} 가지고 있었어요. ${personStem(c.q)}에게 ${U(c, b!, '을/를')} 주었어요. 남은 ${O(c, '은/는')} 몇 ${c.u}일까요?`,
      (c, [a, b]) =>
        `${A(c, '이/가')} ${O(c, '을/를')} ${a}${c.u} 가지고 있었는데 ${U(c, b!, '을/를')} 썼어요. 남은 ${O(c, '은/는')} 몇 ${c.u}일까요?`,
    ],
  },
  'change:inc-diff': {
    make: (r) => {
      const [ans, a] = sumPair(r)
      const t = a + ans
      return { n: [a, t], steps: [{ x: t, op: '−', y: a }] }
    },
    texts: [
      (c, [a, t]) =>
        `${A(c, '은/는')} ${O(c, '을/를')} ${a}${c.u} 가지고 있었어요. ${personStem(c.q)}에게서 몇 ${josa(c.u, '을/를')} 받았더니 ${U(c, t!, '이/가')} 되었어요. ${personStem(c.q)}에게서 받은 ${O(c, '은/는')} 몇 ${c.u}일까요?`,
      (c, [a, t]) =>
        `${A(c, '은/는')} ${O(c, '을/를')} ${a}${c.u} 모았어요. 오늘 더 모았더니 모두 ${U(c, t!, '이/가')} 되었어요. 오늘 모은 ${O(c, '은/는')} 몇 ${c.u}일까요?`,
    ],
  },
  'change:dec-diff': {
    make: (r) => {
      const [ans, t] = sumPair(r)
      const a = t + ans
      return { n: [a, t], steps: [{ x: a, op: '−', y: t }] }
    },
    texts: [
      (c, [a, t]) =>
        `${A(c, '은/는')} ${O(c, '을/를')} ${a}${c.u} 가지고 있었어요. 동생에게 몇 ${josa(c.u, '을/를')} 주었더니 ${U(c, t!, '이/가')} 남았어요. 동생에게 준 ${O(c, '은/는')} 몇 ${c.u}일까요?`,
      (c, [a, t]) =>
        `${A(c, '은/는')} ${O(c, '을/를')} ${a}${c.u} 가지고 있었는데 몇 ${josa(c.u, '을/를')} 쓰고 나니 ${U(c, t!, '이/가')} 남았어요. 쓴 ${O(c, '은/는')} 몇 ${c.u}일까요?`,
    ],
  },
  'change:inc-start': {
    make: (r) => {
      const [ans, b] = sumPair(r)
      const t = ans + b
      return { n: [b, t], steps: [{ x: t, op: '−', y: b }] }
    },
    texts: [
      (c, [b, t]) =>
        `${A(c, '은/는')} ${O(c, '을/를')} 몇 ${c.u} 가지고 있었어요. ${personStem(c.q)}에게서 ${U(c, b!, '을/를')} 받았더니 ${U(c, t!, '이/가')} 되었어요. ${P(c, '이/가')} 처음에 가지고 있던 ${O(c, '은/는')} 몇 ${c.u}일까요?`,
      (c, [b, t]) =>
        `${A(c, '이/가')} 모은 ${c.noun}에 오늘 ${U(c, b!, '을/를')} 더 모았더니 모두 ${U(c, t!, '이/가')} 되었어요. 오늘 전에 모은 ${O(c, '은/는')} 몇 ${c.u}일까요?`,
    ],
  },
  'change:dec-start': {
    make: (r) => {
      const [t, b] = sumPair(r)
      return { n: [b, t], steps: [{ x: t, op: '+', y: b }] }
    },
    texts: [
      (c, [b, t]) =>
        `${A(c, '은/는')} ${O(c, '을/를')} 몇 ${c.u} 가지고 있었어요. ${personStem(c.q)}에게 ${U(c, b!, '을/를')} 주었더니 ${U(c, t!, '이/가')} 남았어요. ${P(c, '이/가')} 처음에 가지고 있던 ${O(c, '은/는')} 몇 ${c.u}일까요?`,
      (c, [b, t]) =>
        `${A(c, '이/가')} 가지고 있던 ${c.noun} 중에서 ${U(c, b!, '을/를')} 썼더니 ${U(c, t!, '이/가')} 남았어요. 처음에 있던 ${O(c, '은/는')} 몇 ${c.u}일까요?`,
    ],
  },
  'compare:diff': {
    make: (r) => {
      const [ans, b] = sumPair(r)
      const a = b + ans
      return { n: [a, b], steps: [{ x: a, op: '−', y: b }] }
    },
    texts: [
      (c, [a, b]) =>
        `${A(c, '은/는')} ${O(c, '을/를')} ${a}${c.u}, ${Q(c, '은/는')} ${b}${c.u} 가지고 있어요. ${P(c, '은/는')} ${personStem(c.q)}보다 몇 ${c.u} 더 많이 가지고 있을까요?`,
      (c, [a, b]) =>
        `${A(c, '은/는')} ${O(c, '을/를')} ${a}${c.u} 모았고, ${Q(c, '은/는')} ${b}${c.u} 모았어요. 두 사람이 모은 ${c.noun}의 차는 몇 ${c.u}일까요?`,
    ],
  },
  'compare:more': {
    make: (r) => {
      const [b, d] = sumPair(r)
      return { n: [b, d], steps: [{ x: b, op: '+', y: d }] }
    },
    texts: [
      (c, [b, d]) =>
        `${Q(c, '은/는')} ${O(c, '을/를')} ${b}${c.u} 가지고 있어요. ${A(c, '은/는')} ${personStem(c.q)}보다 ${d}${c.u} 더 많이 가지고 있어요. ${P(c, '이/가')} 가진 ${O(c, '은/는')} 몇 ${c.u}일까요?`,
      (c, [b, d]) =>
        `${Q(c, '은/는')} ${O(c, '을/를')} ${b}${c.u} 모았고, ${A(c, '은/는')} ${personStem(c.q)}보다 ${d}${c.u} 더 모았어요. ${P(c, '이/가')} 모은 ${O(c, '은/는')} 몇 ${c.u}일까요?`,
    ],
  },
  'compare:less': {
    make: (r) => {
      const [ans, d] = sumPair(r)
      const b = ans + d
      return { n: [b, d], steps: [{ x: b, op: '−', y: d }] }
    },
    texts: [
      (c, [b, d]) =>
        `${Q(c, '은/는')} ${O(c, '을/를')} ${b}${c.u} 가지고 있어요. ${A(c, '은/는')} ${personStem(c.q)}보다 ${d}${c.u} 더 적게 가지고 있어요. ${P(c, '이/가')} 가진 ${O(c, '은/는')} 몇 ${c.u}일까요?`,
      (c, [b, d]) =>
        `${Q(c, '은/는')} ${O(c, '을/를')} ${b}${c.u} 모았고, ${A(c, '은/는')} ${personStem(c.q)}보다 ${d}${c.u} 덜 모았어요. ${P(c, '이/가')} 모은 ${O(c, '은/는')} 몇 ${c.u}일까요?`,
    ],
  },
  'compare:rev-less': {
    make: (r) => {
      const [a, d] = sumPair(r)
      return { n: [a, d], steps: [{ x: a, op: '+', y: d }] }
    },
    texts: [
      (c, [a, d]) =>
        `${A(c, '은/는')} ${O(c, '을/를')} ${a}${c.u} 가지고 있어요. ${P(c, '이/가')} 가진 ${O(c, '은/는')} ${personStem(c.q)}보다 ${d}${c.u} 적어요. ${Q(c, '이/가')} 가진 ${O(c, '은/는')} 몇 ${c.u}일까요?`,
      (c, [a, d]) =>
        `${A(c, '은/는')} ${O(c, '을/를')} ${a}${c.u} 모았는데, 이것은 ${personStem(c.q)}보다 ${d}${c.u} 적은 거예요. ${Q(c, '이/가')} 모은 ${O(c, '은/는')} 몇 ${c.u}일까요?`,
    ],
  },
  'compare:rev-more': {
    make: (r) => {
      const [ans, d] = sumPair(r)
      const a = ans + d
      return { n: [a, d], steps: [{ x: a, op: '−', y: d }] }
    },
    texts: [
      (c, [a, d]) =>
        `${A(c, '은/는')} ${O(c, '을/를')} ${a}${c.u} 가지고 있어요. ${P(c, '이/가')} 가진 ${O(c, '은/는')} ${personStem(c.q)}보다 ${d}${c.u} 많아요. ${Q(c, '이/가')} 가진 ${O(c, '은/는')} 몇 ${c.u}일까요?`,
      (c, [a, d]) =>
        `${A(c, '은/는')} ${O(c, '을/를')} ${a}${c.u} 모았는데, 이것은 ${personStem(c.q)}보다 ${d}${c.u} 많은 거예요. ${Q(c, '이/가')} 모은 ${O(c, '은/는')} 몇 ${c.u}일까요?`,
    ],
  },
  'mult:group': {
    make: (r) => {
      const [a, b] = pick(r, MULT_PAIRS)
      return { n: [a, b], steps: [{ x: a, op: '×', y: b }] }
    },
    texts: [
      (c, [a, b]) =>
        `${A(c, '이/가')} ${O(c, '을/를')} 한 봉지에 ${a}${c.u}씩 ${b}봉지 샀어요. ${P(c, '이/가')} 산 ${O(c, '은/는')} 모두 몇 ${c.u}일까요?`,
      (c, [a, b]) =>
        `${A(c, '은/는')} ${O(c, '을/를')} 한 상자에 ${a}${c.u}씩 담았어요. ${b}상자에 담은 ${O(c, '은/는')} 모두 몇 ${c.u}일까요?`,
    ],
  },
  'mult:times': {
    make: (r) => {
      // 몇 배는 2~5로 제한(HANDOFF 2026-08: "8배 줄넘기"의 부자연). DAN 경계 안의 부분 범위다.
      const a = int(r, DAN_MIN, DAN_MAX)
      const b = int(r, DAN_MIN, Math.min(5, DAN_MAX))
      return { n: [a, b], steps: [{ x: a, op: '×', y: b }] }
    },
    texts: [
      (c, [a, b]) =>
        `${Q(c, '은/는')} ${O(c, '을/를')} ${a}${c.u} 가지고 있어요. ${A(c, '은/는')} ${personStem(c.q)}의 ${b}배만큼 가지고 있어요. ${P(c, '이/가')} 가진 ${O(c, '은/는')} 몇 ${c.u}일까요?`,
      (c, [a, b]) =>
        `${Q(c, '은/는')} ${O(c, '을/를')} ${a}${c.u} 모았고, ${A(c, '은/는')} 그 ${b}배를 모았어요. ${P(c, '이/가')} 모은 ${O(c, '은/는')} 몇 ${c.u}일까요?`,
    ],
  },
  'two:mult-sub': {
    make: (r) => {
      const [a, b] = pick(
        r,
        MULT_PAIRS.filter(([x, y]) => x * y >= 20),
      )
      const p = a * b
      const t = int(r, 10, p - 10)
      return {
        n: [a, b, t],
        steps: [
          { x: a, op: '×', y: b },
          { x: p, op: '−', y: t },
        ],
      }
    },
    texts: [
      (c, [a, b, t]) =>
        `${A(c, '은/는')} ${O(c, '을/를')} 한 봉지에 ${a}${c.u}씩 ${b}봉지 가지고 있어요. 그중 ${U(c, t!, '을/를')} ${personStem(c.q)}에게 주었어요. 남은 ${O(c, '은/는')} 몇 ${c.u}일까요?`,
      (c, [a, b, t]) =>
        `${A(c, '이/가')} ${O(c, '을/를')} 한 상자에 ${a}${c.u}씩 ${b}상자 샀어요. 그중 ${U(c, t!, '을/를')} 썼어요. 남은 ${O(c, '은/는')} 몇 ${c.u}일까요?`,
    ],
  },
  'two:mult-add': {
    make: (r) => {
      const [a, b] = pick(
        r,
        MULT_PAIRS.filter(([x, y]) => x * y >= 10 && x * y <= 89),
      )
      const p = a * b
      const t = int(r, 10, 99 - p)
      return {
        n: [a, b, t],
        steps: [
          { x: a, op: '×', y: b },
          { x: p, op: '+', y: t },
        ],
      }
    },
    texts: [
      (c, [a, b, t]) =>
        `${A(c, '은/는')} ${O(c, '을/를')} 한 봉지에 ${a}${c.u}씩 ${b}봉지 가지고 있고, 낱개로 ${U(c, t!, '이/가')} 더 있어요. ${P(c, '이/가')} 가진 ${O(c, '은/는')} 모두 몇 ${c.u}일까요?`,
      (c, [a, b, t]) =>
        `${A(c, '이/가')} ${O(c, '을/를')} 한 상자에 ${a}${c.u}씩 ${b}상자 샀고, ${personStem(c.q)}에게서 ${U(c, t!, '을/를')} 더 받았어요. ${P(c, '이/가')} 가진 ${O(c, '은/는')} 모두 몇 ${c.u}일까요?`,
    ],
  },
  'two:add-sub': {
    make: (r) => {
      const [a, b] = sumPair(r)
      const s = a + b
      const t = int(r, 10, s - 10)
      return {
        n: [a, b, t],
        steps: [
          { x: a, op: '+', y: b },
          { x: s, op: '−', y: t },
        ],
      }
    },
    texts: [
      (c, [a, b, t]) =>
        `${A(c, '은/는')} ${O(c, '을/를')} ${a}${c.u} 가지고 있었어요. ${personStem(c.q)}에게서 ${U(c, b!, '을/를')} 받고, 동생에게 ${U(c, t!, '을/를')} 주었어요. 지금 ${P(c, '이/가')} 가진 ${O(c, '은/는')} 몇 ${c.u}일까요?`,
      (c, [a, b, t]) =>
        `${A(c, '이/가')} 빨간 ${c.noun} ${U(c, a!, '과/와')} 파란 ${c.noun} ${U(c, b!, '을/를')} 샀어요. 그중 ${U(c, t!, '을/를')} 썼어요. 남은 ${O(c, '은/는')} 몇 ${c.u}일까요?`,
    ],
  },
  'reverse:after-sub': {
    make: (r) => {
      const [t, b] = sumPair(r)
      return { n: [b, t], steps: [{ x: t, op: '+', y: b }] }
    },
    texts: [
      (_c, [b, t]) =>
        `어떤 수에서 ${numJosa(b!, '을/를')} 뺐더니 ${numJosa(t!, '이/가')} 되었어요. 어떤 수는 얼마일까요?`,
      (_c, [b, t]) =>
        `${numJosa(b!, '을/를')} 빼면 ${numJosa(t!, '이/가')} 되는 수가 있어요. 그 수는 얼마일까요?`,
    ],
  },
  'reverse:after-add': {
    make: (r) => {
      const [ans, b] = sumPair(r)
      const t = ans + b
      return { n: [b, t], steps: [{ x: t, op: '−', y: b }] }
    },
    texts: [
      (_c, [b, t]) =>
        `어떤 수에 ${numJosa(b!, '을/를')} 더했더니 ${numJosa(t!, '이/가')} 되었어요. 어떤 수는 얼마일까요?`,
      (_c, [b, t]) =>
        `${numJosa(b!, '을/를')} 더하면 ${numJosa(t!, '이/가')} 되는 수가 있어요. 그 수는 얼마일까요?`,
    ],
  },
  'reverse:wrong-add': {
    make: (r) => {
      const b = int(r, 10, 44)
      const t = int(r, 10, 99 - 2 * b)
      const x = t + b
      return {
        n: [b, t],
        steps: [
          { x: t, op: '+', y: b },
          { x, op: '+', y: b },
        ],
      }
    },
    texts: [
      (_c, [b, t]) =>
        `어떤 수에 ${numJosa(b!, '을/를')} 더해야 할 것을 잘못해서 뺐더니 ${numJosa(t!, '이/가')} 되었어요. 바르게 계산하면 얼마일까요?`,
      (_c, [b, t]) =>
        `어떤 수에 ${numJosa(b!, '을/를')} 더하는 문제를 잘못 보고 뺐더니 ${numJosa(t!, '이/가')} 나왔어요. 바르게 계산한 값은 얼마일까요?`,
    ],
  },
  'reverse:wrong-sub': {
    make: (r) => {
      const b = int(r, 10, 44)
      const t = int(r, 2 * b + 10, 99)
      const x = t - b
      return {
        n: [b, t],
        steps: [
          { x: t, op: '−', y: b },
          { x, op: '−', y: b },
        ],
      }
    },
    texts: [
      (_c, [b, t]) =>
        `어떤 수에서 ${numJosa(b!, '을/를')} 빼야 할 것을 잘못해서 더했더니 ${numJosa(t!, '이/가')} 되었어요. 바르게 계산하면 얼마일까요?`,
      (_c, [b, t]) =>
        `어떤 수에서 ${numJosa(b!, '을/를')} 빼는 문제를 잘못 보고 더했더니 ${numJosa(t!, '이/가')} 나왔어요. 바르게 계산한 값은 얼마일까요?`,
    ],
  },
}

/**
 * 오답 후보표(스펙 §5). 순서가 곧 우선순위고, 호출부가 식 문자열로 중복을 걸러 최대 2개를 취한다.
 * 1은 늘 있으므로 보기는 최소 2개 — 「다시 뽑기」가 없다.
 */
function candidates(steps: Step[], i: number, keyword: boolean, age: number | null): WordWrong[] {
  const s = steps[i]!
  const out: WordWrong[] = []
  const add = (t: Step, cause: string): void => {
    out.push({ expr: str(t), value: val(t), cause })
  }
  // 1. 연산 바꾸기. 뺄셈은 큰 수 − 작은 수로 써서 값이 늘 0 이상이다(keywordGuess가 이 값을 본다).
  const flip: Step =
    s.op === '+'
      ? { x: Math.max(s.x, s.y), op: '−', y: Math.min(s.x, s.y) }
      : { x: s.x, op: '+', y: s.y }
  add(flip, keyword && i === steps.length - 1 ? 'keyword' : 'op')
  // 2. 한 단계에서 멈춤 — 앞 단계 식을 그대로 답 식으로.
  if (i > 0) add(steps[i - 1]!, 'one-step')
  // 3. 끼워 넣은 수 사용.
  if (age !== null && i === 0) add({ x: s.x, op: s.op, y: age }, 'extra-number')
  // 4. 빼는 순서 뒤집기(작은 수 − 큰 수). 값이 음수라 wrongs에는 안 들어가고 보기로만 남는다.
  if (s.op === '−') add({ x: s.y, op: '−', y: s.x }, 'order')
  return out
}

/** 문제 하나를 만든다. rand만 받는다 — 다른 생성기와 난수 스트림을 공유하지 않는다(스펙 §5). */
export function makeProblem(type: WordTypeId, r: Rand): WordProblem {
  const def = DEFS[type]
  const group = groupOf(type)!
  const { n, steps } = def.make(r)
  const [p, q] = shuffled([...NAMES], r) as [string, string]
  const thing = pick(r, THINGS)
  const used = new Set(steps.flatMap((s) => [s.x, s.y, val(s)]))
  const ageNum =
    group !== 'reverse' && r() < EXTRA_RATE
      ? (shuffled(AGES, r).find((a) => !used.has(a)) ?? null)
      : null
  const ctx: Ctx = {
    p,
    q,
    noun: thing.noun,
    u: thing.unit,
    age: ageNum === null ? '' : `${ageNum}살 `,
  }
  const text = pick(r, def.texts)(ctx, n)

  const review: ReviewStep[] = []
  const wrongs: WordWrong[] = []
  if (group !== 'reverse') review.push({ kind: 'story', correct: STORY_GROUPS.indexOf(group) })
  steps.forEach((s, i) => {
    const right = str(s)
    const taken: WordWrong[] = []
    for (const c of candidates(steps, i, KEYWORD_TYPES.has(type), ageNum)) {
      if (taken.length === 2) break
      if (c.expr === right || taken.some((t) => t.expr === c.expr)) continue
      taken.push(c)
    }
    const options = shuffled([right, ...taken.map((t) => t.expr)], r)
    review.push({ kind: 'expr', options, correct: options.indexOf(right) })
    review.push({ kind: 'calc', expr: right, value: val(s) })
    for (const t of taken) if (t.value >= 0) wrongs.push(t)
  })

  const problem: WordProblem = {
    type,
    text,
    unit: group === 'reverse' ? '' : thing.unit,
    answer: val(steps[steps.length - 1]!),
    steps: steps.map((s) => ({ expr: str(s), value: val(s) })),
    review,
    wrongs,
  }
  if (ageNum !== null) problem.trap = 'extra-number'
  return problem
}

// ─────────── 판정(파생 — 저장하지 않는다, 스펙 §5) ───────────

export type WordStage = 'shown' | 'answered' | 'done'
export type FailedStep = 'story' | 'expr' | 'calc' | 'slip'

/** 저장본의 review 한 칸. 미래 버전의 kind가 올 수 있어 넓게 읽는다. */
type LooseStep = { kind: string; correct?: number; value?: number }

export function isCorrect(a: WordAttempt): boolean {
  return a.answer !== null && a.answer === a.problem.answer
}

/**
 * 되짚기에서 아직 하지 않은 첫 단계의 인덱스(모두 했으면 review.length). 선택 단계는 picks,
 * 계산 단계는 calcs를 차례로 소비한다. 모르는 kind는 건너뛴다 — 이 버전이 물을 수 없는 단계다.
 */
export function reviewPosition(a: WordAttempt): number {
  let pi = 0
  let ci = 0
  const review = a.problem.review as LooseStep[]
  for (let i = 0; i < review.length; i++) {
    const k = review[i]!.kind
    if (k === 'story' || k === 'expr') {
      if (pi >= a.picks.length) return i
      pi++
    } else if (k === 'calc') {
      if (ci >= a.calcs.length) return i
      ci++
    }
  }
  return review.length
}

export function stage(a: WordAttempt): WordStage {
  if (a.answer === null) return 'shown'
  if (isCorrect(a)) return 'done'
  return reviewPosition(a) < a.problem.review.length ? 'answered' : 'done'
}

/** 틀리고 끝난 시도에서 처음 틀린 단계. 맞힌 시도·끝나지 않은 시도는 null. */
export function firstFailedStep(a: WordAttempt): FailedStep | null {
  if (isCorrect(a) || stage(a) !== 'done') return null
  let pi = 0
  let ci = 0
  for (const s of a.problem.review as LooseStep[]) {
    if (s.kind === 'story' || s.kind === 'expr') {
      if (a.picks[pi++] !== s.correct) return s.kind
    } else if (s.kind === 'calc') {
      if (a.calcs[ci++] !== s.value) return 'calc'
    }
  }
  return 'slip'
}

/** ★ 유형에서 첫 답이 「단어만 보고 반대 연산」 값과 같은가(스펙 §5). */
export function keywordGuess(a: WordAttempt): boolean {
  if (!KEYWORD_TYPES.has(a.problem.type) || a.answer === null || isCorrect(a)) return false
  return a.problem.wrongs.some((w) => w.cause === 'keyword' && w.value === a.answer)
}

export function doneWordCount(d: Day): number {
  return (d.word ?? []).filter((w) => stage(w) === 'done').length
}

// ─────────── 출제 ───────────

/** 끝난 기록이 이보다 적은 유형의 가중치 — 한 번 운 좋게 맞혔다고 바로 밀려나지 않게. */
const COLD_WEIGHT = 3
const RECENT = 5

/** 유형 가중치 = 1 + 2 × 최근 5회 첫 시도 오답률. 매번 로그에서 계산한다(저장하지 않는다). */
export function typeWeights(days: Day[]): Record<WordTypeId, number> {
  const hist = new Map<string, boolean[]>()
  const sorted = [...days].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  for (const d of sorted)
    for (const w of d.word ?? []) {
      if (stage(w) !== 'done') continue
      const h = hist.get(w.problem.type) ?? []
      h.push(isCorrect(w))
      hist.set(w.problem.type, h)
    }
  const out = {} as Record<WordTypeId, number>
  for (const t of WORD_TYPES) {
    const h = hist.get(t) ?? []
    if (h.length < 2) {
      out[t] = COLD_WEIGHT
      continue
    }
    const last = h.slice(-RECENT)
    out[t] = 1 + (2 * last.filter((ok) => !ok).length) / last.length
  }
  return out
}

function weightedIndex(ws: number[], r: Rand): number {
  const total = ws.reduce((s, w) => s + w, 0)
  let x = r() * total
  for (let i = 0; i < ws.length; i++) {
    x -= ws[i]!
    if (x < 0) return i
  }
  return ws.length - 1
}

/**
 * n개의 유형을 고른다. 묶음을 먼저(묶음 가중치 = 그 묶음 유형 가중치의 최댓값, 비복원) 뽑고
 * 그 안에서 유형을 뽑는다 — 묶음 크기(2~6)가 노출에 끌려가지 않는다. doneGroups(오늘 이미
 * 나온 묶음)는 뺀다. 남은 묶음이 n보다 적으면 제외를 푼다(6묶음·n ≤ 3이라 실제로는 없다).
 */
export function pickWordTypes(
  days: Day[],
  n: number,
  doneGroups: ReadonlySet<string>,
  r: Rand,
): WordTypeId[] {
  const w = typeWeights(days)
  let groups: WordGroup[] = WORD_GROUPS.filter((g) => !doneGroups.has(g))
  if (groups.length < n) groups = [...WORD_GROUPS]
  const out: WordTypeId[] = []
  for (let k = 0; k < n; k++) {
    const gi = weightedIndex(
      groups.map((g) => Math.max(...typesOf(g).map((t) => w[t]))),
      r,
    )
    const ts = typesOf(groups[gi]!)
    out.push(
      ts[
        weightedIndex(
          ts.map((t) => w[t]),
          r,
        )
      ]!,
    )
    groups = groups.filter((_, i) => i !== gi)
  }
  return out
}
