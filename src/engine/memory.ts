/**
 * 「짝 맞추기」의 판과 뒤집기 규칙. 화면은 flip()이 돌려준 결과대로 그리기만 한다.
 *
 * open은 **짝이 확정되지 않은 채** 앞면인 카드들이다(0~2장). 두 장이 안 맞으면 open에 둘이
 * 남고, 화면이 잠깐 보여 준 뒤 closeMiss()로 덮는다 — 그 사이 세 번째 카드를 누르면 두 장은
 * 바로 덮이고 새 카드가 열린다(아이가 덮일 때까지 기다리지 않아도 되게, 사용자 결정 2026-10-13).
 */
export type Card = { face: string; matched: boolean }
export type MemState = { cards: Card[]; open: number[] }
export type FlipResult = 'ignored' | 'opened' | 'match' | 'miss'

/** 난이도 = 카드 수(사용자 결정). 판은 세로 화면에 맞춰 열 수를 정한다. */
export const SIZES = [
  { cols: 3, rows: 4 },
  { cols: 4, rows: 4 },
  { cols: 4, rows: 5 },
] as const

/** 그림 후보 — 가장 큰 판(10쌍)을 채울 만큼. 우리가 쓴 리터럴이라 템플릿에 그대로 넣어도 된다. */
export const ANIMALS = ['🐶', '🐱', '🐰', '🦊', '🐼', '🐨', '🐯', '🦁', '🐸', '🐵'] as const

function shuffled<T>(items: readonly T[], rand: () => number): T[] {
  const a = [...items]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** 그림 pairs개를 무작위로 골라 두 장씩 깔고 섞는다. */
export function deal(pairs: number, rand: () => number): MemState {
  const faces = shuffled(ANIMALS, rand).slice(0, pairs)
  return {
    cards: shuffled([...faces, ...faces], rand).map((face) => ({ face, matched: false })),
    open: [],
  }
}

export function flip(s: MemState, i: number): { state: MemState; result: FlipResult } {
  const card = s.cards[i]
  if (!card || card.matched || s.open.includes(i)) return { state: s, result: 'ignored' }
  // 안 맞은 두 장이 아직 열려 있으면 덮고 새로 시작한다.
  const open = s.open.length === 2 ? [] : s.open
  if (open.length === 0) return { state: { ...s, open: [i] }, result: 'opened' }
  const j = open[0]
  if (s.cards[j].face === card.face) {
    const cards = s.cards.map((c, k) => (k === i || k === j ? { ...c, matched: true } : c))
    return { state: { cards, open: [] }, result: 'match' }
  }
  return { state: { ...s, open: [j, i] }, result: 'miss' }
}

/** 안 맞은 두 장을 덮는다(화면의 타이머가 부른다). */
export function closeMiss(s: MemState): MemState {
  return s.open.length === 2 ? { ...s, open: [] } : s
}

export function isDone(s: MemState): boolean {
  return s.cards.every((c) => c.matched)
}
