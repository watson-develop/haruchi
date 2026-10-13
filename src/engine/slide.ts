/**
 * 숫자 퍼즐(슬라이딩 퍼즐)의 판. cells는 행 우선 배열이고 0이 빈칸이다 — 다 맞춘 판은
 * [1, 2, …, n-1, 0](빈칸이 오른쪽 아래).
 *
 * 섞기는 무작위 순열이 아니라 **다 맞춘 판에서 실제로 둘 수 있는 이동만 무작위로 두는
 * 것**이다. 슬라이딩 퍼즐은 순열의 짝홀이 맞아야 풀리는데(무작위 순열의 절반은 못 푼다),
 * 이렇게 섞으면 못 푸는 판이 원리상 나올 수 없어 짝홀 검사가 필요 없다.
 */
export type Board = { cols: number; rows: number; cells: number[] }

/** 난이도 = 판 크기(사용자 결정 2026-10-13). 4×5는 가로 4칸·세로 5칸 — 사진 속 장난감. */
export const SIZES = [
  { cols: 3, rows: 3 },
  { cols: 4, rows: 4 },
  { cols: 4, rows: 5 },
] as const

export function sizeKey(b: { cols: number; rows: number }): string {
  return `${b.cols}x${b.rows}`
}

export function solvedBoard(cols: number, rows: number): Board {
  const n = cols * rows
  return { cols, rows, cells: Array.from({ length: n }, (_, i) => (i === n - 1 ? 0 : i + 1)) }
}

export function isSolved(b: Board): boolean {
  const n = b.cells.length
  return b.cells.every((v, i) => v === (i === n - 1 ? 0 : i + 1))
}

/**
 * index의 조각을 빈칸 쪽으로 민다. 빈칸과 같은 줄(가로·세로)이면 사이의 조각까지 한꺼번에
 * 밀린다 — 손가락 한 번에 여러 칸. 같은 줄이 아니거나 빈칸 자신이면 null(둘 수 없음).
 */
export function slide(b: Board, index: number): Board | null {
  const blank = b.cells.indexOf(0)
  if (index === blank || index < 0 || index >= b.cells.length) return null
  const [br, bc] = [Math.floor(blank / b.cols), blank % b.cols]
  const [r, c] = [Math.floor(index / b.cols), index % b.cols]
  let step: number
  if (r === br) step = c < bc ? -1 : 1
  else if (c === bc) step = r < br ? -b.cols : b.cols
  else return null
  const cells = [...b.cells]
  // 빈칸에서 index 쪽으로 한 칸씩 걸으며 조각을 빈칸 자리로 당긴다.
  for (let at = blank; at !== index; at += step) cells[at] = cells[at + step]
  cells[index] = 0
  return { ...b, cells }
}

/** 빈칸에 맞닿은 칸들 — 한 칸짜리 이동의 후보. */
function neighbors(b: Board, at: number): number[] {
  const [r, c] = [Math.floor(at / b.cols), at % b.cols]
  const out: number[] = []
  if (r > 0) out.push(at - b.cols)
  if (r < b.rows - 1) out.push(at + b.cols)
  if (c > 0) out.push(at - 1)
  if (c < b.cols - 1) out.push(at + 1)
  return out
}

/**
 * 다 맞춘 판에서 한 칸짜리 이동을 steps번 무작위로 둔다(방금 온 칸으로 바로 되돌아가지
 * 않는다 — 제자리걸음이 섞임을 갉아먹는다). 우연히 다 맞춘 판으로 끝나면 다시 섞는다.
 */
export function shuffle(
  cols: number,
  rows: number,
  rand: () => number,
  steps = cols * rows * 20,
): Board {
  for (;;) {
    let b = solvedBoard(cols, rows)
    let prev = -1
    for (let i = 0; i < steps; i++) {
      const blank = b.cells.indexOf(0)
      const options = neighbors(b, blank).filter((at) => at !== prev)
      const pick = options[Math.floor(rand() * options.length)]
      b = slide(b, pick)!
      prev = blank
    }
    if (!isSolved(b)) return b
  }
}
