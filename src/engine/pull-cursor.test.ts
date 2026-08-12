import { describe, it, expect } from 'vitest'
import { nextCursor } from './pull-cursor'

describe('nextCursor', () => {
  it('거부 행이 없으면 마지막 행의 updatedAt — 서버 시계로만 전진', () => {
    expect(
      nextCursor('C0', [
        { updatedAt: 'C1', rejected: false },
        { updatedAt: 'C2', rejected: false },
      ]),
    ).toBe('C2')
  })
  it('거부 행이 있으면 그 직전에서 멈춘다 — 지나치면 영영 재수신 안 된다', () => {
    expect(
      nextCursor('C0', [
        { updatedAt: 'C1', rejected: false },
        { updatedAt: 'C2', rejected: true },
        { updatedAt: 'C3', rejected: false },
      ]),
    ).toBe('C1')
  })
  it('첫 행부터 거부면 커서를 움직이지 않는다', () => {
    expect(nextCursor('C0', [{ updatedAt: 'C1', rejected: true }])).toBe('C0')
  })
  it('행이 없으면 그대로', () => {
    expect(nextCursor('C0', [])).toBe('C0')
  })
})
