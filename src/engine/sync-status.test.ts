import { describe, expect, it } from 'vitest'
import { syncStatus } from './sync-status'

describe('syncStatus', () => {
  it('미등록이면 setup 안내 한 줄이다', () => {
    expect(
      syncStatus({ registered: false, outboxCount: 0, lastSyncAt: null, today: '2026-08-06' }),
    ).toEqual({ tone: 'setup', lines: ['이 기기는 아직 연결되지 않았어요'] })
  })

  it('밀린 것이 없으면 조용한 한 줄이다', () => {
    expect(
      syncStatus({
        registered: true,
        outboxCount: 0,
        lastSyncAt: '2026-08-06T09:00:00Z',
        today: '2026-08-06',
      }),
    ).toEqual({ tone: 'quiet', lines: ['마지막 동기화: 오늘'] })
  })

  it('밀린 기록이 있으면 경고한다', () => {
    const s = syncStatus({
      registered: true,
      outboxCount: 3,
      lastSyncAt: '2026-08-04T09:00:00Z',
      today: '2026-08-06',
    })
    expect(s.tone).toBe('warn')
    expect(s.lines).toContain('아직 안 올라간 기록 3건')
  })

  it('3일 이상 서버에 못 닿으면 일수를 밝힌다', () => {
    const s = syncStatus({
      registered: true,
      outboxCount: 1,
      lastSyncAt: '2026-08-01T09:00:00Z',
      today: '2026-08-06',
    })
    expect(s.lines).toContain('서버에 5일째 못 올렸어요')
  })

  it('동기화 이력이 아예 없고 밀린 것도 없으면 경고하지 않는다(방금 등록한 기기)', () => {
    expect(
      syncStatus({ registered: true, outboxCount: 0, lastSyncAt: null, today: '2026-08-06' }),
    ).toEqual({ tone: 'quiet', lines: ['아직 동기화한 적이 없어요'] })
  })
})
