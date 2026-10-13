import { describe, expect, it } from 'vitest'
import { BUTTONS, check, extend, stepMs } from './simon'

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

describe('색 순서 기억', () => {
  it('속성: 순서는 매번 정확히 하나씩 늘고 앞부분은 그대로, 값은 0..3', () => {
    const rand = mulberry32(20261013)
    for (let game = 0; game < 20; game++) {
      let seq: number[] = []
      for (let n = 1; n <= 30; n++) {
        const next = extend(seq, rand)
        expect(next).toHaveLength(n)
        expect(next.slice(0, -1)).toEqual(seq)
        expect(Number.isInteger(next[n - 1]) && next[n - 1] >= 0 && next[n - 1] < BUTTONS).toBe(
          true,
        )
        seq = next
      }
    }
  })

  it('판정: 덜 누르면 continue, 다 맞으면 roundDone, 하나라도 틀리면 wrong', () => {
    const seq = [2, 0, 3]
    expect(check(seq, [])).toBe('continue')
    expect(check(seq, [2, 0])).toBe('continue')
    expect(check(seq, [2, 0, 3])).toBe('roundDone')
    expect(check(seq, [1])).toBe('wrong')
    expect(check(seq, [2, 0, 1])).toBe('wrong')
  })

  it('속성: 보여 주는 간격은 줄기만 하고 하한에서 멈춘다', () => {
    for (let n = 1; n < 50; n++) expect(stepMs(n + 1)).toBeLessThanOrEqual(stepMs(n))
    expect(stepMs(1)).toBe(700)
    expect(stepMs(99)).toBe(380)
  })
})
