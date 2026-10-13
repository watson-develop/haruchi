import { describe, expect, it } from 'vitest'
import { isSolved, shuffle, SIZES, slide, solvedBoard, type Board } from './slide'

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

/**
 * 풀 수 있는가 — 섞기 구현과 **독립적인** 판정(짝홀 공식). 섞기가 한 칸 이동만 쓰는 한
 * 늘 참이어야 한다. 가로가 홀수면 역순 쌍 수가 짝수, 짝수면 (역순 쌍 + 아래에서 센
 * 빈칸 행 번호)가 홀수.
 */
function solvable(b: Board): boolean {
  const tiles = b.cells.filter((v) => v !== 0)
  let inv = 0
  for (let i = 0; i < tiles.length; i++)
    for (let j = i + 1; j < tiles.length; j++) if (tiles[i] > tiles[j]) inv++
  if (b.cols % 2 === 1) return inv % 2 === 0
  const rowFromBottom = b.rows - Math.floor(b.cells.indexOf(0) / b.cols)
  return (inv + rowFromBottom) % 2 === 1
}

describe('숫자 퍼즐', () => {
  it('다 맞춘 판은 빈칸이 오른쪽 아래', () => {
    expect(solvedBoard(3, 3).cells).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 0])
    expect(isSolved(solvedBoard(4, 5))).toBe(true)
  })

  it('짝홀 판정이 실제로 갈라 낸다(검사 도구의 자기 검사)', () => {
    const swapped = solvedBoard(4, 4)
    ;[swapped.cells[0], swapped.cells[1]] = [swapped.cells[1], swapped.cells[0]]
    expect(solvable(solvedBoard(4, 4))).toBe(true)
    expect(solvable(swapped)).toBe(false)
  })

  it('같은 줄이 아니면 못 민다', () => {
    const b = solvedBoard(3, 3) // 빈칸 8
    expect(slide(b, 8)).toBeNull()
    expect(slide(b, 0)).toBeNull()
    expect(slide(b, 7)!.cells).toEqual([1, 2, 3, 4, 5, 6, 7, 0, 8])
    expect(slide(b, 2)!.cells).toEqual([1, 2, 0, 4, 5, 3, 7, 8, 6])
  })

  it('속성: 섞은 판은 순열이고, 풀 수 있고, 다 맞춘 판이 아니다', () => {
    const rand = mulberry32(20261013)
    for (const { cols, rows } of SIZES) {
      for (let k = 0; k < 50; k++) {
        const b = shuffle(cols, rows, rand, 1 + Math.floor(rand() * 60))
        expect([...b.cells].sort((x, y) => x - y)).toEqual(
          Array.from({ length: cols * rows }, (_, i) => i),
        )
        expect(solvable(b)).toBe(true)
        expect(isSolved(b)).toBe(false)
      }
    }
  })

  it('속성: 여러 칸 밀기 = 한 칸씩 여러 번 밀기', () => {
    const rand = mulberry32(7)
    for (const { cols, rows } of SIZES) {
      for (let k = 0; k < 50; k++) {
        const b = shuffle(cols, rows, rand)
        const blank = b.cells.indexOf(0)
        const target = Math.floor(rand() * b.cells.length)
        const multi = slide(b, target)
        const sameRow = Math.floor(target / cols) === Math.floor(blank / cols)
        const sameCol = target % cols === blank % cols
        if (target === blank || (!sameRow && !sameCol)) {
          expect(multi).toBeNull()
          continue
        }
        // 빈칸이 target에 닿을 때까지 빈칸 옆 칸을 하나씩 민다.
        const step = sameRow ? Math.sign(target - blank) : Math.sign(target - blank) * cols
        let one = b
        for (let at = blank + step; ; at += step) {
          one = slide(one, at)!
          if (at === target) break
        }
        expect(multi!.cells).toEqual(one.cells)
      }
    }
  })
})
