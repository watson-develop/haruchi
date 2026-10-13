import { describe, expect, it } from 'vitest'
import { CAP_CS, diffCs, formatCs, isNewBest, toCs, verdict } from './stop10'

describe('10초 딱!', () => {
  it('센티초는 버림이고 상한에서 멈춘다', () => {
    expect(toCs(9999)).toBe(999)
    expect(toCs(10000)).toBe(1000)
    expect(toCs(-5)).toBe(0)
    expect(toCs(60000)).toBe(CAP_CS)
  })

  it('보여 준 숫자와 판정이 같다', () => {
    expect(formatCs(toCs(10009))).toBe('10.00')
    expect(verdict(diffCs(toCs(10009)))).toBe('딱 10초! 🎯')
    expect(formatCs(1003)).toBe('10.03')
    expect(diffCs(997)).toBe(3)
  })

  it('문구 구간 경계', () => {
    expect(verdict(1)).toBe('거의 딱이에요!')
    expect(verdict(10)).toBe('거의 딱이에요!')
    expect(verdict(11)).toBe('아주 가까워요!')
    expect(verdict(50)).toBe('아주 가까워요!')
    expect(verdict(51)).toBe('한 번 더 해 볼까요?')
  })

  it('최고 기록은 더 작을 때만 바뀐다', () => {
    expect(isNewBest(30, null)).toBe(true)
    expect(isNewBest(29, 30)).toBe(true)
    expect(isNewBest(30, 30)).toBe(false)
    expect(isNewBest(31, 30)).toBe(false)
  })
})
