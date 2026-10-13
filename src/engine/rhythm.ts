/**
 * 「리듬 따라 치기」의 리듬 생성과 판정. 리듬은 8분음표 칸 단위의 간격 목록이다 —
 * 간격 2 = 4분음표, 4 = 2분음표, 1 = 8분음표, 3 = 점4분음표.
 *
 * 판정은 **첫 탭을 기준점**으로 맞춘다. 언제 치기 시작했는지는 따지지 않고, 그 뒤 각 탭이
 * 정답 위치에서 얼마나 어긋났는지만 본다 — 아이가 「따라 쳐요!」를 보고 반응하는 시간은
 * 리듬 감각이 아니라서다.
 */
export type Pattern = { level: number; intervals: number[]; eighthMs: number }

/** 레벨 규칙(사용자 결정 2026-10-13: 판마다 자동 상승, 끝 없음). */
export function levelSpec(level: number): { notes: number; allowed: number[]; eighthMs: number } {
  return {
    notes: Math.min(8, 4 + Math.floor((level - 1) / 2)),
    allowed: level <= 1 ? [2] : level === 2 ? [2, 4] : level === 3 ? [1, 2, 4] : [1, 2, 3, 4],
    eighthMs: Math.max(200, 300 - (level - 1) * 10),
  }
}

export function makePattern(level: number, rand: () => number): Pattern {
  const { notes, allowed, eighthMs } = levelSpec(level)
  const intervals = Array.from(
    { length: notes - 1 },
    () => allowed[Math.floor(rand() * allowed.length)],
  )
  return { level, intervals, eighthMs }
}

/** 각 음의 시각(ms) — 첫 음이 0. */
export function offsets(p: Pattern): number[] {
  const out = [0]
  for (const iv of p.intervals) out.push(out[out.length - 1] + iv * p.eighthMs)
  return out
}

/** 별 경계 — 평균 어긋남이 8분음표 한 칸의 몇 할인가. */
const THREE_STAR = 0.15
const TWO_STAR = 0.3

export type Score = {
  /** 음마다 어긋남(ms, +늦음 −빠름). 첫 음은 기준이라 늘 0, 못 친 음은 null. */
  errors: (number | null)[]
  stars: 1 | 2 | 3
}

/** taps는 탭 시각(ms, 아무 기준이나 — 첫 탭과의 차이만 쓴다). 음 수를 넘는 탭은 버린다. */
export function score(p: Pattern, taps: number[]): Score {
  const expected = offsets(p)
  const errors = expected.map((e, i) =>
    i < taps.length && taps.length > 0 ? taps[i] - taps[0] - e : null,
  )
  // 못 친 음은 두 칸 어긋난 것으로 센다 — 별 하나로 떨어질 만큼.
  const abs = errors.slice(1).map((e) => (e === null ? 2 * p.eighthMs : Math.abs(e)))
  const ratio = abs.reduce((a, b) => a + b, 0) / abs.length / p.eighthMs
  return { errors, stars: ratio <= THREE_STAR ? 3 : ratio <= TWO_STAR ? 2 : 1 }
}

/** 별 2개 이상이면 다음 레벨, 아니면 같은 레벨. 떨어지지는 않는다. */
export function nextLevel(level: number, stars: number): number {
  return stars >= 2 ? level + 1 : level
}
