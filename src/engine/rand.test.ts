import { describe, it, expect } from 'vitest'
import { randInt } from './rand'

describe('randInt', () => {
  it('rand()가 정확히 1이어도 max를 넘지 않는다', () => {
    // Math.random()으로는 닿지 않지만 시드 고정 PRNG는 닿는다 —
    // LCG의 seed / 0x7fffffff는 seed가 최댓값일 때 정확히 1이다.
    // 클램프가 없던 시절 이 자리에서 max + 1이 새어 나갔다.
    expect(randInt(10, 99, () => 1)).toBe(99)
    expect(randInt(100, 899, () => 1)).toBe(899)
    expect(randInt(100, 999, () => 1)).toBe(999)
    expect(randInt(5, 5, () => 1)).toBe(5)
  })

  it('rand()가 0이면 min이다', () => {
    expect(randInt(10, 99, () => 0)).toBe(10)
    expect(randInt(100, 899, () => 0)).toBe(100)
  })

  it('[0,1) 안에서는 min..max를 균등하게 나눈다', () => {
    expect(randInt(0, 9, () => 0.5)).toBe(5)
    expect(randInt(0, 9, () => 0.99)).toBe(9)
    expect(randInt(0, 9, () => 0.09)).toBe(0)
    expect(randInt(10, 19, () => 0.5)).toBe(15)
  })

  it('결과는 언제나 정수이고 대역 안이다', () => {
    let seed = 7
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed / 0x7fffffff
    }
    for (let i = 0; i < 5000; i++) {
      const n = randInt(10, 99, rand)
      expect(Number.isInteger(n)).toBe(true)
      expect(n).toBeGreaterThanOrEqual(10)
      expect(n).toBeLessThanOrEqual(99)
    }
  })
})
