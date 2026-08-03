import { describe, it, expect } from 'vitest'
import { serializeBackup, validateBackup } from './backup'
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

describe('serializeBackup', () => {
  it('왕복: 직렬화 → 파싱 → 검증이 같은 데이터를 돌려준다', () => {
    expect(validateBackup(good())).toEqual({ ok: true, days, meta })
  })

  it('사람이 읽을 수 있게 들여쓰기가 있다', () => {
    // export 파일은 데이터를 들여다보는 유일한 수단이다(IndexedDB는 CLI로 못 연다).
    expect(serializeBackup(days, meta, 't').includes('\n  ')).toBe(true)
  })
})

describe('validateBackup', () => {
  // 손으로 부순 입력들. 생성기가 거른 값을 같은 술어로 재검사하지 않는다(실패 패턴 1).
  const broken: [string, (g: Record<string, unknown>) => unknown, string][] = [
    ['객체가 아니면', () => '문자열', '객체'],
    ['null이면', () => null, '객체'],
    ['app이 다르면', (g) => ({ ...g, app: 'other' }), 'app'],
    ['schemaVersion이 2면', (g) => ({ ...g, schemaVersion: 2 }), 'schemaVersion'],
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
