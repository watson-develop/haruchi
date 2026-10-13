import { describe, expect, it } from 'vitest'
import { closeMiss, deal, flip, isDone, SIZES, type MemState } from './memory'

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

/** 손으로 만든 판: 🐶🐱🐶🐱 */
const fixed = (): MemState => ({
  cards: ['🐶', '🐱', '🐶', '🐱'].map((face) => ({ face, matched: false })),
  open: [],
})

describe('짝 맞추기', () => {
  it('속성: 깐 카드는 그림마다 정확히 두 장', () => {
    const rand = mulberry32(1)
    for (const { cols, rows } of SIZES) {
      for (let k = 0; k < 30; k++) {
        const s = deal((cols * rows) / 2, rand)
        expect(s.cards).toHaveLength(cols * rows)
        const count = new Map<string, number>()
        for (const c of s.cards) count.set(c.face, (count.get(c.face) ?? 0) + 1)
        expect([...count.values()].every((n) => n === 2)).toBe(true)
        expect(count.size).toBe((cols * rows) / 2)
      }
    }
  })

  it('같은 그림 두 장이면 짝, 다르면 둘 다 열린 채 miss', () => {
    let r = flip(fixed(), 0)
    expect(r.result).toBe('opened')
    r = flip(r.state, 2)
    expect(r.result).toBe('match')
    expect(r.state.cards[0].matched && r.state.cards[2].matched).toBe(true)
    expect(r.state.open).toEqual([])

    const miss = flip(flip(fixed(), 0).state, 1)
    expect(miss.result).toBe('miss')
    expect(miss.state.open).toEqual([0, 1])
    expect(closeMiss(miss.state).open).toEqual([])
  })

  it('miss가 열려 있을 때 세 번째를 누르면 둘은 덮이고 새 카드만 열린다', () => {
    const miss = flip(flip(fixed(), 0).state, 1).state
    const r = flip(miss, 3)
    expect(r.result).toBe('opened')
    expect(r.state.open).toEqual([3])
  })

  it('짝 맞은 카드·이미 열린 카드는 무시', () => {
    const matched = flip(flip(fixed(), 0).state, 2).state
    expect(flip(matched, 0).result).toBe('ignored')
    const one = flip(fixed(), 1).state
    expect(flip(one, 1)).toEqual({ state: one, result: 'ignored' })
  })

  it('속성: 무작위 탭 — 짝은 풀리지 않고, 미확정 앞면은 2장 이하, 완료는 다 찾았을 때만', () => {
    const rand = mulberry32(20261013)
    for (const { cols, rows } of SIZES) {
      for (let game = 0; game < 20; game++) {
        let s = deal((cols * rows) / 2, rand)
        let matched = 0
        for (let step = 0; step < 2000 && !isDone(s); step++) {
          const r = flip(s, Math.floor(rand() * s.cards.length))
          const now = r.state.cards.filter((c) => c.matched).length
          expect(now).toBeGreaterThanOrEqual(matched)
          expect(r.state.open.length).toBeLessThanOrEqual(2)
          expect(r.state.open.every((i) => !r.state.cards[i].matched)).toBe(true)
          expect(isDone(r.state)).toBe(now === s.cards.length)
          matched = now
          s = rand() < 0.5 ? closeMiss(r.state) : r.state
        }
        expect(isDone(s)).toBe(true)
      }
    }
  })
})
