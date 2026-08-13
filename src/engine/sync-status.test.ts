import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { syncStatus } from './sync-status'

// 이 파일은 "ISO 순간 → 로컬 날짜 키" 변환을 검사한다. 실행 환경의 시간대에 따라
// 결과가 달라지면 검사 자체가 의미를 잃으므로(CI는 UTC, 아빠의 기기는 KST) 시간대를
// 고정한다. Node는 process.env.TZ 변경을 즉시 반영한다. 같은 워커가 다른 테스트
// 파일을 이어서 돌 수 있으므로 끝나면 원래 값으로 되돌린다.
// (tsconfig에 node 타입이 없어 process를 직접 부르지 못한다 — 이 파일에서 쓰는 만큼만 좁게 연다)
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } })
  .process.env
const originalTZ = env['TZ']
beforeAll(() => {
  env['TZ'] = 'Asia/Seoul'
})
afterAll(() => {
  env['TZ'] = originalTZ
})

const base = { registered: true, authFailed: false, outboxCount: 0, today: '2026-08-06' }

describe('syncStatus', () => {
  it('미등록이면 setup 안내 한 줄이다', () => {
    expect(syncStatus({ ...base, registered: false, lastSyncAt: null })).toEqual({
      tone: 'setup',
      lines: ['이 기기는 아직 연결되지 않았어요'],
    })
  })

  it('밀린 것이 없으면 조용한 한 줄이다', () => {
    expect(syncStatus({ ...base, lastSyncAt: '2026-08-06T09:00:00Z' })).toEqual({
      tone: 'quiet',
      lines: ['마지막 동기화: 오늘'],
    })
  })

  it('밀린 기록이 있으면 경고한다', () => {
    // 최근 동기화(2일 전)와 밀린 기록이 겹쳐도 "마지막 동기화" 줄이 새지 않아야 한다 —
    // 밀린 기록 경고 옆에 안심하라는 줄이 함께 뜨면 서로 모순돼 보인다
    expect(syncStatus({ ...base, outboxCount: 3, lastSyncAt: '2026-08-04T09:00:00Z' })).toEqual({
      tone: 'warn',
      lines: ['아직 안 올라간 기록 3건'],
    })
  })

  it('3일 이상 서버에 못 닿으면 일수를 밝힌다', () => {
    const s = syncStatus({ ...base, outboxCount: 1, lastSyncAt: '2026-08-01T09:00:00Z' })
    expect(s.lines).toContain('서버에 5일째 못 올렸어요')
  })

  it('3일째부터 경고한다(경계값)', () => {
    // 경계가 밀리면 서버가 멈춘 것을 며칠 늦게 알게 된다
    expect(syncStatus({ ...base, lastSyncAt: '2026-08-03T09:00:00Z' })).toEqual({
      tone: 'warn',
      lines: ['서버에 3일째 못 올렸어요'],
    })
  })

  it('2일째는 아직 경고하지 않는다(경계값)', () => {
    // 경계가 밀리면 서버가 멈춘 것을 며칠 늦게 알게 된다
    expect(syncStatus({ ...base, lastSyncAt: '2026-08-04T09:00:00Z' })).toEqual({
      tone: 'quiet',
      lines: ['마지막 동기화: 2일 전'],
    })
  })

  it('동기화 이력이 아예 없고 밀린 것도 없으면 경고하지 않는다(방금 등록한 기기)', () => {
    expect(syncStatus({ ...base, lastSyncAt: null })).toEqual({
      tone: 'quiet',
      lines: ['아직 동기화한 적이 없어요'],
    })
  })

  it('일수는 UTC가 아니라 로컬 날짜로 센다', () => {
    // KST 오전 9시 이전에 동기화한 순간. UTC로는 아직 전날(8/5 20:00Z)이라, ISO 문자열
    // 앞 10글자를 자르던 옛 구현은 "1일 전"이라고 했다 — 실제로는 오늘 아침이다.
    expect(syncStatus({ ...base, lastSyncAt: '2026-08-05T20:00:00Z' })).toEqual({
      tone: 'quiet',
      lines: ['마지막 동기화: 오늘'],
    })
  })

  it('로컬 기준 3일째여야 경고한다 — UTC로 자르면 이틀 만에 뜬다', () => {
    // KST 8/4 오전 5시 = 8/3 20:00Z. UTC 날짜로 세면 3일차라 경고가 뜨지만
    // 로컬로는 아직 이틀째다 — 경고가 하루 일찍 뜨면 멀쩡한 서버를 의심하게 된다.
    expect(syncStatus({ ...base, lastSyncAt: '2026-08-03T20:00:00Z' })).toEqual({
      tone: 'quiet',
      lines: ['마지막 동기화: 2일 전'],
    })
  })

  it('인증 실패를 가장 먼저, 경고 톤으로 말한다', () => {
    // 폐기된 키는 200 + 빈 배열로 오므로(sync.ts serverStatus) 이 줄이 없으면
    // "안 올라간 기록"만 쌓이고 원인은 화면 어디에도 나타나지 않는다.
    expect(
      syncStatus({ ...base, authFailed: true, outboxCount: 2, lastSyncAt: '2026-08-06T09:00:00Z' }),
    ).toEqual({
      tone: 'warn',
      lines: ['기기 키가 거부됐어요 — 아래에서 다시 연결할 수 있어요', '아직 안 올라간 기록 2건'],
    })
  })

  it('인증 실패 옆에는 "마지막 동기화" 안심 줄을 붙이지 않는다', () => {
    expect(syncStatus({ ...base, authFailed: true, lastSyncAt: '2026-08-06T09:00:00Z' })).toEqual({
      tone: 'warn',
      lines: ['기기 키가 거부됐어요 — 아래에서 다시 연결할 수 있어요'],
    })
  })
})
