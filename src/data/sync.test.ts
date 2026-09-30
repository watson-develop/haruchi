import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import {
  kickPush,
  onPullApplied,
  pullOnce,
  resumeSync,
  skipUnchangedPush,
  suspendSync,
} from './sync'
import {
  defaultMeta,
  deleteOutboxThrough,
  getDay,
  getDeviceState,
  getOutbox,
  getStamps,
  putDay,
  updateDeviceState,
} from './db'
import { SCHEMA_VERSION } from '../engine/backup'
import { EMPTY_STAMPS } from '../engine/merge'
import type { Stamped } from '../engine/merge'
import type { Day } from './types'

const DAY: Day = {
  date: '2026-08-01',
  kind: 'normal',
  sheet: [{ id: '1', kind: 'vertical', tag: 'add2-nocarry', a: 10, b: 16, op: '+', answer: 26 }],
}
const stamped = (day: Day, at: Partial<Stamped<Day>['at']> = {}): Stamped<Day> => ({
  value: day,
  at: { ...EMPTY_STAMPS, ...at },
})
const AT = '2026-08-10T00:00:00.000Z'

describe('skipUnchangedPush — §6 무변경 push 생략', () => {
  it('값·스탬프가 서버와 같으면 생략한다', () => {
    const at = { sheetAt: AT, sheetBy: 'd1' }
    expect(
      skipUnchangedPush(stamped(DAY, at), stamped(DAY, at), 'd1', '2026-08-13T00:00:00Z'),
    ).toBe(true)
  })

  it('스탬프 all-null 행은 생략하지 않는다 — sendStamps의 null 보정이 나가야 한다', () => {
    // 1단계 업로드(2026-08-07)가 남긴 실재 상태: 서버·로컬 둘 다 스탬프 null +
    // 비어 있지 않은 sheet. merged.at끼리 비교하는 구현(잘못)은 여기서 true가 된다 —
    // 그러면 null 보정 PATCH가 영영 안 나가 그 묶음이 이후 모든 LWW에서 진다.
    expect(skipUnchangedPush(stamped(DAY), stamped(DAY), 'd1', '2026-08-13T00:00:00Z')).toBe(false)
  })

  it('빈 묶음(grades {}·sprint [])은 비교 전에 벗긴다 — 서버 행은 이미 벗겨져 있다', () => {
    // rowToStampedDay는 withoutEmptyBundles를 지난 값을 준다. 좌변을 생으로 비교하면
    // 빈 묶음이 실린 날짜가 영원히 「다름」이 되어 매 로테이션마다 다시 올라간다.
    const withEmpty: Day = { ...DAY, grades: {}, sprint: [] }
    const at = { sheetAt: AT, sheetBy: 'd1' }
    expect(
      skipUnchangedPush(stamped(withEmpty, at), stamped(DAY, at), 'd1', '2026-08-13T00:00:00Z'),
    ).toBe(true)
  })

  it('값이 다르면 생략하지 않는다', () => {
    const at = { sheetAt: AT, sheetBy: 'd1' }
    const other: Day = { ...DAY, grades: { '1': true }, mood: 'ok' }
    expect(
      skipUnchangedPush(
        stamped(other, { ...at, gradesAt: AT, gradesBy: 'd1' }),
        stamped(DAY, at),
        'd1',
        AT,
      ),
    ).toBe(false)
  })
})

// ── sheet 충돌 자동 해소(2026-09-30 설계 §3·§5) — fake-indexeddb + fetch 목 ──

/** db.test.ts와 같은 방식 — 캐시된 커넥션은 두고 스토어 내용만 비운다. */
function resetStores(): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('haruchi')
    req.onsuccess = () => {
      try {
        const db = req.result
        const stores = ['days', 'meta', 'outbox', 'device', 'stamps']
        const tx = db.transaction(stores, 'readwrite')
        for (const name of stores) tx.objectStore(name).clear()
        tx.oncomplete = () => {
          db.close()
          resolve()
        }
        tx.onerror = () => reject(tx.error ?? new Error('스토어 초기화 실패'))
      } catch (e) {
        reject(e as Error)
      }
    }
    req.onerror = () => reject(req.error ?? new Error('DB 열기 실패'))
  })
}

const D = '2026-08-01'
const LOCAL_SHEET: Day['sheet'] = [{ id: 'L', kind: 'vertical' }]
const SERVER_SHEET: Day['sheet'] = [{ id: 'S', kind: 'vertical' }]
const SERVER_AT = '2026-08-01T00:00:00.000Z'

/** 서버 days 행. 비어 있지 않은 sheet에는 그 종이의 채점이 붙어 있다. */
function serverRow(sheet: Day['sheet']): Record<string, unknown> {
  const graded = sheet.length > 0
  return {
    date: D,
    updated_at: '2026-08-02T00:00:00.000Z',
    payload: { date: D, kind: 'normal', sheet, ...(graded ? { grades: { S: true } } : {}) },
    rev: 1,
    schema_version: SCHEMA_VERSION,
    sheet_at: SERVER_AT,
    sheet_by: 'srv',
    grades_at: graded ? SERVER_AT : null,
    grades_by: graded ? 'srv' : null,
    sprint_at: null,
    sprint_by: null,
  }
}

const json = (v: unknown, status = 200): Response => new Response(JSON.stringify(v), { status })

/** 로컬: 서버와 다른 sheet + 그 채점 + 로컬 전용 sprint 세션. 등록·시딩 완료 기기. */
async function seedConflictingLocal(): Promise<void> {
  await getDeviceState()
  await updateDeviceState((s) => ({ ...s, deviceKey: 'k', seededAt: 'S', generation: 1 }))
  await putDay(
    {
      date: D,
      kind: 'normal',
      sheet: LOCAL_SHEET,
      grades: { L: false },
      sprint: [{ fact: '2x3', correct: true, ms: 900, sid: 'loc:1' }],
    },
    ['sheet', 'grades', 'sprint'],
  )
}

/**
 * push를 차고 채택이 보일 때까지 기다린 뒤 비행을 끝낸다. 곧장 suspendSync를 부르면
 * pushOutbox가 첫 줄에서 멈춰 버리므로(정지 중) 먼저 결과를 기다린다. 뒤따르는 재확인
 * 패스가 정지로 끊겨도 표식은 남는다 — 단언은 그 표식을 본다.
 */
async function pushUntilAdopted(): Promise<void> {
  kickPush()
  await vi.waitFor(expectAdopted)
  await suspendSync()
  resumeSync()
}

async function expectAdopted(): Promise<void> {
  const day = await getDay(D)
  expect(day?.sheet).toEqual(SERVER_SHEET)
  expect(day?.grades).toEqual({ S: true })
  expect(day?.sprint?.map((a) => a.sid)).toEqual(['loc:1'])
  expect((await getStamps(D))?.sheetBy).toBe('srv')
}

async function sprintMarked(): Promise<boolean> {
  return (await getOutbox()).some((e) => e.target === `day:${D}` && e.bundleAt.sprint)
}

describe('sheet 충돌 자동 해소', () => {
  beforeEach(async () => {
    await getDay('__init__')
    await resetStores()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  /** push용 목: GET은 rows()가 주는 행, PATCH는 patch()가 정한다(기본 500 — 남은 표식을 관찰). */
  function stubPush(rows: () => unknown[], patch: () => Response = () => json({}, 500)): void {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === 'PATCH') return patch()
        if (url.includes('/rest/v1/days?date=eq.')) return json(rows())
        return json({}, 500)
      }),
    )
  }

  it('push 게이트 충돌 → 서버 sheet·grades 채택, 로컬 전용 sprint는 표식', async () => {
    await seedConflictingLocal()
    stubPush(() => [serverRow(SERVER_SHEET)])
    await pushUntilAdopted()
    await expectAdopted()
    expect(await sprintMarked()).toBe(true)
  })

  it('PATCH sheet_immutable → 다음 루프의 GET에서 자동 채택', async () => {
    await seedConflictingLocal()
    let gets = 0
    let patches = 0
    stubPush(
      // 첫 조회는 빈 sheet(충돌 없음) — 조회와 PATCH 사이에 다른 기기가 sheet를 앉혔다.
      () => [serverRow(gets++ === 0 ? [] : SERVER_SHEET)],
      () => (patches++ === 0 ? json({ message: 'sheet_immutable' }, 400) : json({}, 500)),
    )
    await pushUntilAdopted()
    await expectAdopted()
    expect(await sprintMarked()).toBe(true)
  })

  it('옛 quarantine 키 → 1회 정리: 키가 사라지고 그 날짜가 채택된다', async () => {
    await seedConflictingLocal()
    // pull에서 격리됐던 날은 표식이 없을 수 있다 — 표식을 비워 그 상태를 만든다.
    await deleteOutboxThrough(`day:${D}`, Number.MAX_SAFE_INTEGER)
    await updateDeviceState((s) => ({ ...s, quarantine: [D] }) as typeof s)
    stubPush(() => [serverRow(SERVER_SHEET)])
    await pushUntilAdopted()
    expect('quarantine' in (await getDeviceState())).toBe(false)
    await expectAdopted()
  })

  it("pull 게이트 충돌 → 같은 결과, 재렌더 신호('changed')", async () => {
    await seedConflictingLocal()
    await deleteOutboxThrough(`day:${D}`, Number.MAX_SAFE_INTEGER)
    vi.stubGlobal('window', new EventTarget())
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/rest/v1/meta?'))
          return json([
            { payload: defaultMeta(), generation: 1, settings_at: null, settings_by: null },
          ])
        if (url.includes('/rest/v1/days?')) return json([serverRow(SERVER_SHEET)])
        return json({}, 500)
      }),
    )
    let applied = 0
    onPullApplied(() => applied++)
    await pullOnce()
    await expectAdopted()
    expect(await sprintMarked()).toBe(true)
    expect(applied).toBe(1)
  })
})
