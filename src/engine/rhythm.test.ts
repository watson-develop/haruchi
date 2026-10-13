import { describe, expect, it } from 'vitest'
import { levelSpec, makePattern, nextLevel, offsets, score, type Pattern } from './rhythm'

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

const P: Pattern = { level: 3, intervals: [2, 1, 1, 4], eighthMs: 250 }

describe('리듬 따라 치기', () => {
  it('음 시각은 간격의 누적합', () => {
    expect(offsets(P)).toEqual([0, 500, 750, 1000, 2000])
  })

  it('정확히 치면 별 셋 — 늦게 시작해도 첫 탭 기준이라 같다', () => {
    expect(score(P, offsets(P)).stars).toBe(3)
    const late = offsets(P).map((t) => t + 1234)
    expect(score(P, late)).toEqual({ errors: [0, 0, 0, 0, 0], stars: 3 })
  })

  it('어긋남의 부호: +늦음 −빠름', () => {
    expect(score(P, [0, 520, 730, 1000, 2000]).errors).toEqual([0, 20, -20, 0, 0])
  })

  it('별 경계는 평균 어긋남 / 8분음표', () => {
    // 4개 음이 각각 d만큼 어긋나면 평균 = d. 경계 0.15×250 = 37.5, 0.3×250 = 75.
    const off = (d: number) => offsets(P).map((t, i) => (i === 0 ? t : t + d))
    expect(score(P, off(37)).stars).toBe(3)
    expect(score(P, off(38)).stars).toBe(2)
    expect(score(P, off(75)).stars).toBe(2)
    expect(score(P, off(76)).stars).toBe(1)
  })

  it('덜 치면 못 친 음은 null이고 별이 떨어진다', () => {
    const s = score(P, offsets(P).slice(0, 3))
    expect(s.errors).toEqual([0, 0, 0, null, null])
    expect(s.stars).toBe(1)
    expect(score(P, []).stars).toBe(1)
  })

  it('레벨은 별 2개 이상에서만 오른다', () => {
    expect(nextLevel(3, 3)).toBe(4)
    expect(nextLevel(3, 2)).toBe(4)
    expect(nextLevel(3, 1)).toBe(3)
  })

  it('속성: 레벨이 오를수록 음 수·간격 종류는 줄지 않고 빠르기는 느려지지 않는다', () => {
    for (let l = 1; l < 40; l++) {
      const [a, b] = [levelSpec(l), levelSpec(l + 1)]
      expect(b.notes).toBeGreaterThanOrEqual(a.notes)
      expect(a.allowed.every((iv) => b.allowed.includes(iv))).toBe(true)
      expect(b.eighthMs).toBeLessThanOrEqual(a.eighthMs)
    }
    expect(levelSpec(1)).toEqual({ notes: 4, allowed: [2], eighthMs: 300 })
    expect(levelSpec(99).notes).toBe(8)
    expect(levelSpec(99).eighthMs).toBe(200)
  })

  it('속성: 만든 리듬은 그 레벨 규칙을 지킨다', () => {
    const rand = mulberry32(20261013)
    for (let l = 1; l <= 12; l++) {
      const spec = levelSpec(l)
      for (let k = 0; k < 30; k++) {
        const p = makePattern(l, rand)
        expect(p.intervals).toHaveLength(spec.notes - 1)
        expect(p.intervals.every((iv) => spec.allowed.includes(iv))).toBe(true)
        expect(p.eighthMs).toBe(spec.eighthMs)
      }
    }
  })
})
