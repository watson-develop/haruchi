import { describe, it, expect } from 'vitest'
import {
  backupPayload,
  serializeBackup,
  validateBackup,
  validateDay,
  SCHEMA_VERSION,
} from './backup'
import { DEFAULT_SETTINGS, emptyDerived } from '../data/types'
import type { Day, Meta } from '../data/types'

const meta: Meta = {
  derived: emptyDerived(),
  settings: { ...DEFAULT_SETTINGS, childName: '서연', friendNames: ['지호'] },
}
const days: Day[] = [
  {
    date: '2026-08-02',
    kind: 'normal',
    sheet: [],
    sprint: [{ fact: '2×3', correct: true, ms: 1200 }],
  },
  { date: '2026-08-03', kind: 'checkup', sheet: [], grades: { v1: true } },
]

/** 검증을 통과하는 파싱 결과. 케이스마다 한 군데씩 손으로 부순다. */
function good(): Record<string, unknown> {
  return JSON.parse(serializeBackup(days, meta, '2026-08-03T20:00:00.000Z'))
}

/** 유효한 payload에서 days[0].sprint만 주어진 시도 배열로 바꾼다. */
function payloadWithSprint(sprint: Record<string, unknown>[]): Record<string, unknown> {
  const g = good()
  ;(g['days'] as Record<string, unknown>[])[0]!['sprint'] = sprint
  return g
}

describe('serializeBackup', () => {
  it('왕복: 직렬화 → 파싱 → 검증이 같은 데이터를 돌려준다', () => {
    expect(validateBackup(good())).toEqual({ ok: true, days, meta })
  })

  it('사람이 읽을 수 있게 들여쓰기가 있다', () => {
    // export 파일은 데이터를 들여다보는 유일한 수단이다(IndexedDB는 CLI로 못 연다).
    expect(serializeBackup(days, meta, 't').includes('\n  ')).toBe(true)
  })
})

describe('backupPayload', () => {
  it('그 자체로 validateBackup을 통과한다 — 서버 스냅샷이 감싸개 없이 검증된다', () => {
    // 스냅샷은 이 모양 그대로 서버에 올라가고(data/sync.ts), 되돌리기는 받은 값을
    // 감싸지 않고 바로 validateBackup에 넣는다. 이 단언이 그 계약이다.
    expect(validateBackup(backupPayload(days, meta, '2026-08-03T20:00:00.000Z'))).toEqual({
      ok: true,
      days,
      meta,
    })
  })

  it('파일과 같은 내용이다 — 파일과 스냅샷의 모양이 갈라지지 않는다', () => {
    const at = '2026-08-03T20:00:00.000Z'
    expect(JSON.parse(serializeBackup(days, meta, at))).toEqual(backupPayload(days, meta, at))
  })

  it('버전을 스스로 밝힌다 — meta.settings를 보지 않는다', () => {
    // meta.settings.schemaVersion(아무도 갱신하지 않는 사본)을 지워도 페이로드의
    // schemaVersion은 그대로여야 한다. 두 값이 갈라지면 되돌리기 게이트가 무력화된다.
    const stale: Meta = { ...meta, settings: { ...meta.settings, schemaVersion: 99 } }
    expect(backupPayload(days, stale, 't').schemaVersion).toBe(SCHEMA_VERSION)
  })
})

describe('validateBackup', () => {
  // 손으로 부순 입력들. 생성기가 거른 값을 같은 술어로 재검사하지 않는다(실패 패턴 1).
  const broken: [string, (g: Record<string, unknown>) => unknown, string][] = [
    ['객체가 아니면', () => '문자열', '객체'],
    ['null이면', () => null, '객체'],
    ['app이 다르면', (g) => ({ ...g, app: 'other' }), 'app'],
    ['schemaVersion이 상한을 넘으면', (g) => ({ ...g, schemaVersion: 3 }), 'schemaVersion'],
    ['days가 배열이 아니면', (g) => ({ ...g, days: {} }), 'days'],
    [
      'date 형식이 아니면',
      (g) => {
        ;(g['days'] as Record<string, unknown>[])[0]!['date'] = '8월2일'
        return g
      },
      'date',
    ],
    [
      'kind가 이상값이면',
      (g) => {
        ;(g['days'] as Record<string, unknown>[])[0]!['kind'] = 'diagnostic'
        return g
      },
      'kind',
    ],
    [
      'sheet가 없으면',
      (g) => {
        delete (g['days'] as Record<string, unknown>[])[0]!['sheet']
        return g
      },
      'sheet',
    ],
    [
      'sprint에 문자열이 섞이면',
      (g) => {
        ;(g['days'] as Record<string, unknown>[])[0]!['sprint'] = ['2×3']
        return g
      },
      'sprint',
    ],
    [
      '날짜가 중복되면',
      (g) => {
        const ds = g['days'] as Record<string, unknown>[]
        ds.push({ ...ds[0]! })
        return g
      },
      '중복',
    ],
    ['meta가 없으면', (g) => ({ ...g, meta: undefined }), 'meta'],
    [
      'settings가 없으면',
      (g) => ({ ...g, meta: { derived: (g['meta'] as Record<string, unknown>)['derived'] } }),
      'settings',
    ],
    [
      'grades 값이 boolean이 아니면',
      (g) => {
        ;(g['days'] as Record<string, unknown>[])[1]!['grades'] = { v1: 'yes' }
        return g
      },
      'grades',
    ],
    [
      'sheet 항목이 객체가 아니면',
      (g) => {
        ;(g['days'] as Record<string, unknown>[])[0]!['sheet'] = ['garbage']
        return g
      },
      'sheet',
    ],
    [
      'sheet 항목의 kind가 알 수 없으면',
      (g) => {
        ;(g['days'] as Record<string, unknown>[])[0]!['sheet'] = [{ id: 'x', kind: 'divide' }]
        return g
      },
      'kind',
    ],
    [
      'sheet 항목의 id가 없으면',
      (g) => {
        ;(g['days'] as Record<string, unknown>[])[0]!['sheet'] = [{ kind: 'vertical' }]
        return g
      },
      'id',
    ],
    [
      'settings.verticalCount가 숫자가 아니면',
      (g) => {
        const meta = g['meta'] as Record<string, unknown>
        const settings = meta['settings'] as Record<string, unknown>
        meta['settings'] = { ...settings, verticalCount: '8' }
        return g
      },
      'verticalCount',
    ],
    [
      'settings.lastExportedAt이 숫자면',
      (g) => {
        const meta = g['meta'] as Record<string, unknown>
        const settings = meta['settings'] as Record<string, unknown>
        meta['settings'] = { ...settings, lastExportedAt: 12345 }
        return g
      },
      'lastExportedAt',
    ],
  ]

  it.each(broken)('%s 거부하고 사유에 위치를 담는다', (_name, mutate, keyword) => {
    const result = validateBackup(mutate(good()))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain(keyword)
  })

  it('모르는 여분 필드는 통과시킨다 — 미래 버전이 필드를 더해도 과거 앱이 읽게', () => {
    const g = good()
    g['futureField'] = true
    ;(g['days'] as Record<string, unknown>[])[0]!['futureField'] = 1
    expect(validateBackup(g).ok).toBe(true)
  })

  it('정상적인 sheet 항목과 미래 여분 필드가 붙은 항목을 통과시킨다', () => {
    const g = good()
    ;(g['days'] as Record<string, unknown>[])[0]!['sheet'] = [
      { id: '1', kind: 'vertical', tag: 'add2-nocarry', a: 1, b: 2, op: '+', answer: 3 },
      {
        id: '2',
        kind: 'vertical',
        tag: 'add2-nocarry',
        a: 1,
        b: 2,
        op: '+',
        answer: 3,
        futureField: 'unknown',
      },
    ]
    expect(validateBackup(g).ok).toBe(true)
  })
})

describe('SCHEMA_VERSION 승격', () => {
  const validPayload = good()

  it('SCHEMA_VERSION은 2다 — backup.ts가 단일 주인', () => {
    expect(SCHEMA_VERSION).toBe(2)
  })

  it('v1 파일도 v2 파일도 받는다 — 상한은 SCHEMA_VERSION', () => {
    const v1 = { ...validPayload, schemaVersion: 1 }
    const v2 = { ...validPayload, schemaVersion: 2 }
    const v3 = { ...validPayload, schemaVersion: 3 }
    expect(validateBackup(v1).ok).toBe(true)
    expect(validateBackup(v2).ok).toBe(true)
    expect(validateBackup(v3).ok).toBe(false)
  })

  it('sid가 있으면 문자열이어야 한다 — 기형 sid가 그룹핑 전제를 깬다', () => {
    const bad = payloadWithSprint([{ fact: '2×3', correct: true, ms: 900, sid: 42 }])
    expect(validateBackup(bad).ok).toBe(false)
  })

  it('sid가 문자열이면 통과한다', () => {
    const ok = payloadWithSprint([{ fact: '2×3', correct: true, ms: 900, sid: 's1' }])
    expect(validateBackup(ok).ok).toBe(true)
  })

  it('sid가 없어도 통과한다 — 선택 필드다', () => {
    const ok = payloadWithSprint([{ fact: '2×3', correct: true, ms: 900 }])
    expect(validateBackup(ok).ok).toBe(true)
  })
})

describe('validateDay', () => {
  const sample = days[0]!

  it('validateDay는 날 하나를 검증한다 — pull 행 단위 검증용', () => {
    expect(validateDay(sample).ok).toBe(true)
    expect(validateDay({ date: 1 }).ok).toBe(false)
  })

  it('유효하면 그 day를 그대로 돌려준다', () => {
    const result = validateDay(sample)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.day).toEqual(sample)
  })

  it('sid가 기형이면 거부하고 사유에 sprint를 담는다', () => {
    const bad = { ...sample, sprint: [{ fact: '2×3', correct: true, ms: 900, sid: 42 }] }
    const result = validateDay(bad)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('sprint')
  })
})
