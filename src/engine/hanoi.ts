/**
 * 「하노이 탑」의 판과 규칙. 기둥 셋, 원판은 1(가장 작음)~n. 각 기둥은 아래→위 순서의 배열이라
 * 맨 위 원판이 배열 끝이다. 시작은 모두 왼쪽 기둥, 목표는 모두 오른쪽 기둥.
 */
export type Pegs = [number[], number[], number[]]

/** 난이도 = 원판 수(사용자 결정 2026-10-13). */
export const SIZES = [3, 4, 5] as const

export function start(n: number): Pegs {
  return [Array.from({ length: n }, (_, i) => n - i), [], []]
}

/** from 맨 위 원판을 to로 옮길 수 있는가 — 빈 기둥이 아니고, 더 작은 원판 위가 아니어야 한다. */
export function canMove(p: Pegs, from: number, to: number): boolean {
  if (from === to) return false
  const disk = p[from].at(-1)
  const top = p[to].at(-1)
  return disk !== undefined && (top === undefined || disk < top)
}

/** 옮긴 새 판. 옮길 수 없으면 null. */
export function move(p: Pegs, from: number, to: number): Pegs | null {
  if (!canMove(p, from, to)) return null
  const next = p.map((peg) => [...peg]) as Pegs
  next[to].push(next[from].pop()!)
  return next
}

export function isDone(p: Pegs): boolean {
  return p[0].length === 0 && p[1].length === 0
}

export function minMoves(n: number): number {
  return 2 ** n - 1
}

/** 최소 그대로면 셋, 1.5배 이하면 둘, 그 밖은 하나. */
export function stars(n: number, moves: number): 1 | 2 | 3 {
  const min = minMoves(n)
  return moves <= min ? 3 : moves <= min * 1.5 ? 2 : 1
}
