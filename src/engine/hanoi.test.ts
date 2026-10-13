import { describe, expect, it } from 'vitest'
import { canMove, isDone, minMoves, move, SIZES, start, stars, type Pegs } from './hanoi'

/** mulberry32 — merge.test.ts와 같은 시드 PRNG. 실패하면 같은 시드로 재현된다. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 재귀 최적해 — 엔진과 독립적으로 이동 목록만 만든다. */
function solve(n: number, from = 0, to = 2, via = 1, out: [number, number][] = []) {
  if (n === 0) return out
  solve(n - 1, from, via, to, out)
  out.push([from, to])
  solve(n - 1, via, to, from, out)
  return out
}

describe('하노이 탑', () => {
  it('시작은 왼쪽에 큰 것부터 쌓인다', () => {
    expect(start(3)).toEqual([[3, 2, 1], [], []])
    expect(isDone(start(3))).toBe(false)
  })

  it('완료는 모든 원판이 오른쪽 기둥에 있을 때만 — 가운데에 남아 있으면 아니다', () => {
    expect(isDone([[], [1], [3, 2]])).toBe(false)
    expect(isDone([[], [3, 2, 1], []])).toBe(false)
    expect(isDone([[], [], [3, 2, 1]])).toBe(true)
  })

  it('빈 기둥·같은 기둥·작은 원판 위로는 못 옮긴다', () => {
    const p: Pegs = [[3, 1], [2], []]
    expect(canMove(p, 2, 0)).toBe(false) // 빈 기둥
    expect(canMove(p, 0, 0)).toBe(false) // 같은 기둥
    expect(canMove(p, 1, 0)).toBe(false) // 2를 1 위에
    expect(move(p, 1, 0)).toBeNull()
    expect(move(p, 0, 1)).toEqual([[3], [2, 1], []])
    expect(p).toEqual([[3, 1], [2], []]) // 원본은 그대로
  })

  it('재귀 최적해는 정확히 2ⁿ−1번에 끝나고 별 셋', () => {
    for (const n of SIZES) {
      let p = start(n)
      const moves = solve(n)
      for (const [f, t] of moves) p = move(p, f, t)!
      expect(isDone(p)).toBe(true)
      expect(moves).toHaveLength(minMoves(n))
      expect(stars(n, moves.length)).toBe(3)
    }
  })

  it('별 경계 — 최소 7번: 7은 셋, 10은 둘(≤10.5), 11은 하나', () => {
    expect(stars(3, 7)).toBe(3)
    expect(stars(3, 10)).toBe(2)
    expect(stars(3, 11)).toBe(1)
  })

  it('속성: 무작위 이동 — 큰 원판은 작은 원판 위에 오지 않고 원판 수는 보존된다', () => {
    const rand = mulberry32(20261013)
    for (const n of SIZES) {
      let p = start(n)
      for (let step = 0; step < 300; step++) {
        const next = move(p, Math.floor(rand() * 3), Math.floor(rand() * 3))
        if (next) p = next
        for (const peg of p)
          for (let i = 1; i < peg.length; i++) expect(peg[i]).toBeLessThan(peg[i - 1])
        expect(p.flat().sort((a, b) => a - b)).toEqual(Array.from({ length: n }, (_, i) => i + 1))
      }
    }
  })
})
