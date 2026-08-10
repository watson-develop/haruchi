import { describe, it, expect } from 'vitest'
import {
  serializeValue,
  structuralEqual,
  legacyKey,
  materializeSids,
  mergeSprint,
  mergeDay,
  mergeMeta,
  sheetConflict,
  EMPTY_STAMPS,
} from './merge'
import type { Stamped, BundleStamps } from './merge'
import type { SprintAttempt, Day, Meta, Mood } from '../data/types'
import { DEFAULT_SETTINGS, emptyDerived } from '../data/types'

describe('serializeValue', () => {
  it('객체 키 순서를 무시한다 — jsonb 왕복이 키를 재배열해도 같은 문자열', () => {
    expect(serializeValue({ b: 1, a: [2, 3] })).toBe(serializeValue({ a: [2, 3], b: 1 }))
  })
  it('배열 원소 순서는 보존한다 — deriveFacts가 순서 의존이다', () => {
    expect(serializeValue([1, 2])).not.toBe(serializeValue([2, 1]))
  })
  it('중첩 객체도 정렬한다', () => {
    expect(serializeValue({ x: { b: 1, a: 2 } })).toBe(serializeValue({ x: { a: 2, b: 1 } }))
  })
})

describe('legacyKey', () => {
  const t = (fact: string, ms: number): SprintAttempt => ({ fact, correct: true, ms })
  it('같은 다중집합·다른 순서 → 같은 키 (세션 정규화)', () => {
    expect(legacyKey([t('2x3', 900), t('2x4', 1100)])).toBe(
      legacyKey([t('2x4', 1100), t('2x3', 900)]),
    )
  })
  it('다른 내용 → 다른 키', () => {
    expect(legacyKey([t('2x3', 900)])).not.toBe(legacyKey([t('2x3', 901)]))
  })
})

describe('materializeSids', () => {
  const t = (fact: string, ms: number, sid?: string): SprintAttempt =>
    sid === undefined ? { fact, correct: true, ms } : { fact, correct: true, ms, sid }
  it('무sid 최대 연속 구간마다 legacy: sid를 물질화한다', () => {
    const out = materializeSids([t('2x3', 900), t('2x4', 800), t('5x6', 700, 'dev:100')])
    expect(out[0]!.sid).toMatch(/^legacy:/)
    expect(out[0]!.sid).toBe(out[1]!.sid) // 같은 구간 = 같은 세션
    expect(out[2]!.sid).toBe('dev:100') // 기존 sid 불변
  })
  it('결정적이다 — 같은 배열이면 언제 물질화해도 같은 sid (서버 비대칭 왕복의 전제)', () => {
    const arr = [t('2x3', 900), t('2x4', 800)]
    expect(materializeSids(arr)[0]!.sid).toBe(materializeSids(arr.map((x) => ({ ...x })))[0]!.sid)
  })
  it('사실(fact·correct·ms)은 바꾸지 않는다', () => {
    const out = materializeSids([t('2x3', 900)])
    expect(out[0]).toMatchObject({ fact: '2x3', correct: true, ms: 900 })
  })
})

describe('mergeSprint', () => {
  const s = (sid: string, fact: string): SprintAttempt => ({ fact, correct: true, ms: 1000, sid })
  it('sid 합집합 — 두 기기의 세션이 모두 남는다', () => {
    const out = mergeSprint([s('A:100', '2x3')], [s('B:200', '7x8')])!
    expect(out.map((a) => a.sid)).toEqual(['A:100', 'B:200'])
  })
  it('같은 sid 재수신은 한 번만 (pull 여유창 멱등)', () => {
    expect(mergeSprint([s('A:100', '2x3')], [s('A:100', '2x3')])).toHaveLength(1)
  })
  it('같은 sid, 다른 순서로 재수신하면 값 직렬화 사전순 작은 쪽이 남는다', () => {
    const a: SprintAttempt[] = [
      { fact: '2x3', correct: true, ms: 1000, sid: 'A:100' },
      { fact: '2x4', correct: true, ms: 1000, sid: 'A:100' },
    ]
    const b: SprintAttempt[] = [
      { fact: '2x4', correct: true, ms: 1000, sid: 'A:100' },
      { fact: '2x3', correct: true, ms: 1000, sid: 'A:100' },
    ]
    // a의 직렬화("...2x3...2x4...")가 b의 직렬화("...2x4...2x3...")보다 사전순 작다.
    expect(mergeSprint(a, b)).toEqual(a)
    expect(mergeSprint(b, a)).toEqual(a) // 교환법칙 — 인자 순서와 무관하게 작은 쪽
  })
  it('무sid 그룹 둘이 각각 물질화되어 둘 다 남는다 — 옛 기기 둘의 세션 무손실', () => {
    const out = mergeSprint(
      [{ fact: '2x3', correct: true, ms: 900 }],
      [{ fact: '7x8', correct: false, ms: 1500 }],
    )!
    expect(out).toHaveLength(2)
    expect(new Set(out.map((a) => a.sid)).size).toBe(2)
  })
  it('물질화 왕복 — 병합 결과를 원본과 다시 병합해도 증식하지 않는다', () => {
    const a = [{ fact: '2x3', correct: true, ms: 900 }]
    const b = [{ fact: '7x8', correct: false, ms: 1500 }]
    const merged = mergeSprint(a, b)!
    expect(mergeSprint(merged, a)).toHaveLength(2) // 3라운드 B-1의 증식 재현 케이스
    expect(mergeSprint(merged, b)).toHaveLength(2)
  })
  it('그룹 순서: legacy 앞 → 일반(시작 ms순) → 기형 sid 뒤. 그룹 내부는 비정렬 보존', () => {
    const out = mergeSprint(
      [s('B:200', 'x'), s('junk', 'y')],
      // A:100 그룹은 일부러 사전순(오름차순)이 아니게 넣는다 — 그룹 내부 정렬 금지를
      // 실제로 검사하려면 그룹이 원소 2개 이상이면서 정렬돼 있지 않아야 한다.
      [{ fact: 'l1', correct: true, ms: 1 }, s('A:100', '9x9'), s('A:100', '2x3')],
    )!
    const sids = out.map((a) => a.sid!)
    expect(sids[0]!.startsWith('legacy:')).toBe(true)
    expect(sids.slice(1)).toEqual(['A:100', 'A:100', 'B:200', 'junk'])
    // 그룹 내부는 절대 정렬하지 않는다(설계 §1) — A:100 그룹은 입력 순서(9x9 → 2x3,
    // fact 기준 내림차순)를 그대로 유지해야 한다.
    const aGroupFacts = out.filter((a) => a.sid === 'A:100').map((a) => a.fact)
    expect(aGroupFacts).toEqual(['9x9', '2x3'])
  })
  it('둘 다 undefined면 undefined — 스프린트 없는 날에 빈 배열을 만들지 않는다', () => {
    expect(mergeSprint(undefined, undefined)).toBeUndefined()
  })
})

const day = (over: Partial<Day>): Day => ({
  date: '2026-08-10',
  kind: 'normal',
  sheet: [],
  ...over,
})
const st = (v: Day, at: Partial<BundleStamps> = {}): Stamped<Day> => ({
  value: v,
  at: { ...EMPTY_STAMPS, ...at },
})
// `tag: 't'`는 VerticalTag가 아니므로 `as Day['sheet']` 직접 단언이 TS2352로 막힌다.
// 병합은 sheet의 내용을 해석하지 않고 동치 여부만 보므로 태그 값 자체는 상관없다 —
// 「검증하지 않은 값도 통과한다」는 성질을 유지하려고 리터럴은 그대로 두고 unknown을 경유한다.
const sheetA = [
  { id: 'v1', kind: 'vertical', tag: 't', a: 1, b: 2, op: '+', answer: 3 },
] as unknown as Day['sheet']
const sheetB = [
  { id: 'v1', kind: 'vertical', tag: 't', a: 9, b: 9, op: '+', answer: 18 },
] as unknown as Day['sheet']

describe('mergeDay 규칙표', () => {
  it('sheet: 비어 있으면 채워진 쪽이 이긴다 (스탬프 무관 — replace_all의 null 스탬프 행)', () => {
    const m = mergeDay(st(day({})), st(day({ sheet: sheetA })))
    expect(m.value.sheet).toEqual(sheetA)
  })
  it('sheet: 둘 다 있으면 (at, by) LWW 폴백 — 결정적이고 교환적', () => {
    const a = st(day({ sheet: sheetA }), { sheetAt: '2026-08-10T01:00:00.000Z', sheetBy: 'A' })
    const b = st(day({ sheet: sheetB }), { sheetAt: '2026-08-10T02:00:00.000Z', sheetBy: 'B' })
    expect(mergeDay(a, b).value.sheet).toEqual(sheetB)
    expect(mergeDay(b, a).value.sheet).toEqual(sheetB)
  })
  it('grades 묶음(grades·mood·doneAt)은 통째로 움직인다 — 존재한 적 없는 조합 금지', () => {
    const a = st(day({ grades: { v1: true }, mood: 'easy', doneAt: 'T1' }), {
      gradesAt: '2026-08-10T01:00:00.000Z',
      gradesBy: 'A',
    })
    const b = st(day({ grades: { v1: false }, mood: 'hard', doneAt: 'T2' }), {
      gradesAt: '2026-08-10T02:00:00.000Z',
      gradesBy: 'B',
    })
    const m = mergeDay(a, b).value
    expect([m.grades, m.mood, m.doneAt]).toEqual([{ v1: false }, 'hard', 'T2'])
  })
  it('묶음이 한쪽에만 있으면 스탬프가 null이어도 있는 쪽이 이긴다', () => {
    const graded = st(day({ grades: { v1: true } })) // 스탬프 null (업그레이드 직후)
    const bare = st(day({}), { gradesAt: '2026-08-10T09:00:00.000Z', gradesBy: 'B' })
    expect(mergeDay(graded, bare).value.grades).toEqual({ v1: true })
  })
  it('kind 단조 — checkup은 되돌아가지 않는다', () => {
    expect(mergeDay(st(day({ kind: 'checkup' })), st(day({}))).value.kind).toBe('checkup')
    // 양쪽 다 본다 — 한쪽만 검사하면 `kind: a.value.kind`로 퇴화해도 통과한다.
    expect(mergeDay(st(day({})), st(day({ kind: 'checkup' }))).value.kind).toBe('checkup')
    expect(mergeDay(st(day({})), st(day({}))).value.kind).toBe('normal')
  })
  it('모르는 필드: 한쪽에만 있으면 남는다 (미래 스키마 통과)', () => {
    const a = st({ ...day({}), note: 'x' } as Day)
    expect((mergeDay(a, st(day({}))).value as Record<string, unknown>)['note']).toBe('x')
  })
  it('at 동률이면 by 코드포인트 큰 쪽 — 사슬의 두 번째 고리', () => {
    // 이기는 쪽('B')의 값 직렬화가 일부러 **더 크게** 되어 있다({v1:true} > {v1:false}).
    // 그래야 by 규칙이 사라지거나 뒤집혔을 때 마지막 고리(사전순 작은 쪽)와 답이 갈린다.
    const T = '2026-08-10T02:00:00.000Z'
    const a = st(day({ grades: { v1: true } }), { gradesAt: T, gradesBy: 'B' })
    const b = st(day({ grades: { v1: false } }), { gradesAt: T, gradesBy: 'A' })
    expect(mergeDay(a, b).value.grades).toEqual({ v1: true })
    expect(mergeDay(b, a).value.grades).toEqual({ v1: true }) // 인자 순서와 무관
    expect(mergeDay(a, b).at.gradesBy).toBe('B')
  })
  it('at 동률(둘 다 null)·by 동률(둘 다 빈)이면 값 직렬화 사전순 작은 쪽 — 사슬의 끝', () => {
    const a = st(day({ grades: { v1: true } }))
    const b = st(day({ grades: { v1: false } }))
    expect(mergeDay(a, b).value.grades).toEqual(mergeDay(b, a).value.grades)
  })
  it('출력 스탬프는 묶음 승자의 것 — 재스탬프 없음', () => {
    const b = st(day({ grades: { v1: false } }), {
      gradesAt: '2026-08-10T02:00:00.000Z',
      gradesBy: 'B',
    })
    const m = mergeDay(st(day({})), b)
    expect(m.at.gradesAt).toBe('2026-08-10T02:00:00.000Z')
    expect(m.at.gradesBy).toBe('B')
  })
})

describe('sheetConflict', () => {
  it('둘 다 비어 있지 않고 다르면 true', () => {
    expect(sheetConflict(day({ sheet: sheetA }), day({ sheet: sheetB }))).toBe(true)
  })
  it('키 순서만 다른 같은 sheet는 충돌이 아니다 — jsonb 왕복 오탐 금지', () => {
    const reordered = sheetA.map((s) => JSON.parse(serializeValue(s)) as (typeof sheetA)[0])
    expect(sheetConflict(day({ sheet: sheetA }), day({ sheet: reordered }))).toBe(false)
  })
  it('한쪽이 비면 충돌이 아니다', () => {
    expect(sheetConflict(day({}), day({ sheet: sheetA }))).toBe(false)
  })
})

describe('mergeMeta', () => {
  const meta = (fluentMs: number): Meta => ({
    derived: emptyDerived(),
    settings: { ...DEFAULT_SETTINGS, fluentMs },
  })
  const stm = (m: Meta, at?: string | null, by = ''): Stamped<Meta> => ({
    value: m,
    at: { ...EMPTY_STAMPS, settingsAt: at ?? null, settingsBy: by },
  })
  it('settings 통째 LWW', () => {
    const m = mergeMeta(
      stm(meta(2500), '2026-08-10T01:00:00.000Z', 'A'),
      stm(meta(3000), '2026-08-10T02:00:00.000Z', 'B'),
    )
    expect(m.value.settings.fluentMs).toBe(3000)
  })
  it('null 스탬프는 백필된 스탬프에 진다 — 새 기기의 기본 설정이 가족 설정을 못 덮는다', () => {
    const m = mergeMeta(
      stm(meta(9999), null),
      stm(meta(2500), '2026-08-07T00:00:00.000Z', 'b3bf0611'),
    )
    expect(m.value.settings.fluentMs).toBe(2500)
  })
  it('derived는 항상 빈 것으로 정규화', () => {
    const dirty = { ...meta(2500), derived: { facts: { x: 1 } } } as unknown as Meta
    expect(mergeMeta(stm(dirty, 'T'), stm(meta(2500))).value.derived).toEqual(emptyDerived())
  })
  it('lastExportedAt은 동률 판정의 값 직렬화에서 빠진다 — 기기 로컬 강등(설계 §1)', () => {
    // 동률 사슬의 마지막 고리는 settings의 값 직렬화인데, `lastExportedAt`은 기기 로컬
    // 값이라 거기서 제외된다. 제외가 사라지면(strip 삭제) 이 기기에서 언제 백업했는지가
    // 가족 설정의 승패를 정하게 된다.
    //
    // 검사가 성립하려면 갈리는 필드가 직렬화에서 `lastExportedAt`보다 **뒤에** 와야 한다
    // (키를 정렬하므로 앞 키가 먼저 결정한다). `sprintCount`가 그렇다: l < s.
    const withExport = (sprintCount: number, lastExportedAt: string): Meta => ({
      derived: emptyDerived(),
      settings: { ...DEFAULT_SETTINGS, sprintCount, lastExportedAt },
    })
    const a = stm(withExport(30, '2026-01-01T00:00:00.000Z')) // 스탬프·기기 모두 동률
    const b = stm(withExport(20, '2026-12-31T00:00:00.000Z'))
    const m = mergeMeta(a, b)
    // 제외가 살아 있으면 sprintCount("20" < "30")가 결정한다 → b 승.
    // 제외가 없으면 lastExportedAt("2026-01-01" < "2026-12-31")이 먼저 결정한다 → a 승.
    expect(m.value.settings.sprintCount).toBe(20)
    // 그리고 승자의 값이 그대로 실려 나간다(함수 밖에서 방향별로 접붙일 자리다).
    expect(m.value.settings.lastExportedAt).toBe('2026-12-31T00:00:00.000Z')
    expect(mergeMeta(b, a).value.settings.sprintCount).toBe(20) // 인자 순서와 무관
  })
})

// ─────────── 속성 테스트 ───────────
//
// 실행 코드 의존성 0 규칙이 테스트에도 적용되므로 속성 기반 라이브러리를 쓰지 않는다.
// 대신 시드 PRNG(mulberry32)를 직접 두고 케이스를 고정한다 — 실패하면 같은 시드로
// 같은 케이스가 재현된다.

/** mulberry32. 32비트 상태 시드 PRNG — 짧고 결정적이면 충분하다(암호용 아님). */
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

type Rand = () => number
const pick = <T>(r: Rand, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!

const ATS = [
  null,
  '2026-08-10T01:00:00.000Z',
  '2026-08-10T05:00:00.000Z',
  '2026-08-10T09:00:00.000Z',
]
const BYS = ['', 'A1', 'b3bf0611']
const SHEETS = [[] as Day['sheet'], sheetA, sheetB]
const GRADES = [{ v1: true }, { v1: false }, { v1: true, v2: false }]
const MOODS: Mood[] = ['easy', 'ok', 'hard']
const DONES = ['2026-08-10T03:00:00.000Z', '2026-08-10T08:00:00.000Z']
const X1 = ['x1-a', 'x1-b', 42, { deep: [1, 2] }]
const X2 = [null, 'x2-a', true]

/** 세션 풀 — sid 있음·없음·기형(콜론 없음/ms가 NaN)을 모두 담는다. */
type Session = { tag: 'sid' | 'nosid' | 'bad'; atts: readonly SprintAttempt[] }
const SESSIONS: readonly Session[] = [
  {
    tag: 'sid',
    atts: [
      { fact: '2x3', correct: true, ms: 900, sid: 'devA:100' },
      { fact: '2x4', correct: false, ms: 1200, sid: 'devA:100' },
    ],
  },
  { tag: 'sid', atts: [{ fact: '7x8', correct: true, ms: 800, sid: 'devB:200' }] },
  // 무sid — sid 키를 아예 넣지 않는다. `sid: undefined`를 쓰면 serializeValue가
  // 'undefined'를 찍어 JSON 왕복본과 다른 세션으로 갈라진다.
  {
    tag: 'nosid',
    atts: [
      { fact: '3x3', correct: true, ms: 700 },
      { fact: '3x4', correct: true, ms: 750 },
    ],
  },
  { tag: 'nosid', atts: [{ fact: '5x5', correct: false, ms: 1500 }] },
  { tag: 'bad', atts: [{ fact: '9x9', correct: true, ms: 600, sid: 'junk' }] },
  { tag: 'bad', atts: [{ fact: '6x6', correct: true, ms: 650, sid: 'devC:xx' }] },
]

function genSprint(r: Rand, tags: string[]): SprintAttempt[] | undefined {
  const n = Math.floor(r() * 4) // 0..3 세션
  if (n === 0) {
    if (r() < 0.5) {
      tags.push('sprint:없음')
      return undefined
    }
    tags.push('sprint:빈배열')
    return []
  }
  const out: SprintAttempt[] = []
  for (let i = 0; i < n; i++) {
    const s = pick(r, SESSIONS)
    tags.push('sprint:' + s.tag)
    const atts = s.atts.map((a) => ({ ...a }))
    if (atts.length > 1 && r() < 0.5) {
      atts.reverse() // 같은 다중집합·다른 순서
      tags.push('sprint:역순')
    }
    out.push(...atts)
  }
  return out
}

/**
 * 무작위 `Stamped<Day>`. 스탬프는 묶음 존재 여부와 **독립적으로** 뽑는다 — 값 없는
 * 묶음에 스탬프만 남은 상태(**잔류 스탬프**)까지 포함하는 최대 입력 공간이고, 여섯 속성이
 * 전부 이 공간에서 돈다.
 *
 * 한때 두 개의 부분 공간(잔류 스탬프 없음·모르는 필드 없음)이 있었다. 모르는 필드
 * 타이브레이크가 스탬프를 보던 시절 결합·왕복이 그 밖에서 깨졌기 때문인데, 스탬프를
 * 빼면서(설계 §1 규칙표 개정) 둘 다 최대 공간에서 성립하게 되어 제약을 걷어 냈다.
 */
function genDay(r: Rand, tags: string[] = []): Stamped<Day> {
  const rec: Record<string, unknown> = {
    date: '2026-08-10',
    kind: r() < 0.25 ? 'checkup' : 'normal',
  }
  tags.push('kind:' + String(rec['kind']))
  const sheet = pick(r, SHEETS)
  rec['sheet'] = sheet
  tags.push(
    sheet.length === 0 ? 'sheet:빈' : 'sheet:' + String(sheet[0]!.id) + String(sheet[0]!.answer),
  )

  // grades 묶음 — 빈 객체({})는 만들지 않는다: hasGradesBundle이 부재로 판정하는 값이라
  // 「묶음 있음」과 「묶음 없음」 사이의 제3 상태가 되고, 그건 별도 예제 테스트로 고정한다.
  const g = Math.floor(r() * 4)
  const hasGrades = g !== 0
  if (g === 0) tags.push('grades:없음')
  else {
    tags.push('grades:있음')
    if (g !== 3) rec['grades'] = pick(r, GRADES)
    if (g >= 2) {
      rec['mood'] = pick(r, MOODS)
      rec['doneAt'] = pick(r, DONES)
    }
  }

  const sprint = genSprint(r, tags)
  if (sprint !== undefined) rec['sprint'] = sprint

  if (r() < 0.5) {
    rec['x1'] = pick(r, X1)
    tags.push('모르는필드:x1')
  }
  if (r() < 0.3) {
    rec['x2'] = pick(r, X2)
    tags.push('모르는필드:x2')
  }

  const at: BundleStamps = {
    sheetAt: pick(r, ATS),
    sheetBy: pick(r, BYS),
    gradesAt: pick(r, ATS),
    gradesBy: pick(r, BYS),
    sprintAt: pick(r, ATS),
    sprintBy: pick(r, BYS),
  }
  for (const [k, v] of [
    ['sheet', at.sheetAt],
    ['grades', at.gradesAt],
    ['sprint', at.sprintAt],
  ] as const)
    tags.push(`스탬프:${k}:${v === null ? 'null' : '실재'}`)
  return { value: rec as unknown as Day, at }
}

const N = 1000
const rnd = mulberry32(20260809)
/** 최대 입력 공간 — 여섯 속성이 전부 여기서 돈다(부분 공간 없음). */
const PAIRS: [Stamped<Day>, Stamped<Day>][] = []
const TRIPLES: [Stamped<Day>, Stamped<Day>, Stamped<Day>][] = []
const TAGS: string[][] = []
for (let i = 0; i < N; i++) {
  const ta: string[] = []
  const tb: string[] = []
  PAIRS.push([genDay(rnd, ta), genDay(rnd, tb)])
  TAGS.push([...ta, ...tb])
  TRIPLES.push([genDay(rnd), genDay(rnd), genDay(rnd)])
}

/** 실패한 케이스를 그대로 재현 문자열로 남긴다(앞 2건 + 전체 건수). */
function expectNoFailures(fails: string[]): void {
  expect([fails.length, ...fails.slice(0, 2)]).toEqual([0])
}
const dump = (s: Stamped<Day>): string => serializeValue(s)

describe('mergeDay 속성', () => {
  it('생성기 점검 — 1000쌍이 규정된 모양을 실제로 만든다', () => {
    const counts = new Map<string, number>()
    for (const tags of TAGS) for (const t of new Set(tags)) counts.set(t, (counts.get(t) ?? 0) + 1)
    const need = [
      'kind:normal',
      'kind:checkup',
      'sheet:빈',
      'sheet:v13',
      'sheet:v118',
      'grades:있음',
      'grades:없음',
      'sprint:sid',
      'sprint:nosid',
      'sprint:bad',
      'sprint:역순',
      'sprint:없음',
      'sprint:빈배열',
      '모르는필드:x1',
      '모르는필드:x2',
      '스탬프:sheet:null',
      '스탬프:sheet:실재',
      '스탬프:grades:null',
      '스탬프:grades:실재',
      '스탬프:sprint:null',
      '스탬프:sprint:실재',
    ]
    // 각 모양이 1000쌍 중 최소 100쌍에서 나타나야 한다 — 생성기가 조용히 한쪽으로
    // 쏠리면(예: 리팩터링으로 확률이 0이 되면) 아래 속성들이 빈 공간을 검사하게 된다.
    expect(need.filter((t) => (counts.get(t) ?? 0) < 100)).toEqual([])

    // 잔류 스탬프(값 없는 묶음에 스탬프만 남은 상태)가 쌍·삼중 양쪽에 실제로 들어 있다.
    // 결합·왕복이 **이걸 포함한 공간에서** 성립한다는 것이 규칙표 개정으로 얻은 것이다.
    const residual = (s: Stamped<Day>): boolean =>
      (s.at.sheetAt !== null && s.value.sheet.length === 0) ||
      (s.at.gradesAt !== null &&
        !(
          Object.keys(s.value.grades ?? {}).length > 0 ||
          s.value.mood !== undefined ||
          s.value.doneAt !== undefined
        )) ||
      (s.at.sprintAt !== null && !s.value.sprint?.length)
    expect(PAIRS.flat().filter(residual).length).toBeGreaterThan(500)
    expect(TRIPLES.flat().filter(residual).length).toBeGreaterThan(500)
  })

  it('교환: merge(a,b) = merge(b,a)', () => {
    const fails: string[] = []
    for (let i = 0; i < N; i++) {
      const [a, b] = PAIRS[i]!
      const l = serializeValue(mergeDay(a, b))
      const r = serializeValue(mergeDay(b, a))
      if (l !== r) fails.push(`#${i}\na=${dump(a)}\nb=${dump(b)}\nL=${l}\nR=${r}`)
    }
    expectNoFailures(fails)
  })

  it('멱등: merge(a,a) = a (물질화 제외 동치 — sprint는 물질화 후 비교)', () => {
    // sid 물질화와 그룹 정렬은 병합이 하는 정규화다. 그래서 둘로 나눠 본다:
    //   ① 사실 보존 — sprint를 뺀 나머지 값·스탬프가 a 그대로이고, 시도 다중집합도 그대로
    //   ② 정규화된 형태에서의 진짜 멱등 — merge(m,m) = m (m = merge(a,a))
    const bag = (xs: SprintAttempt[] | undefined): string =>
      xs === undefined
        ? 'undefined'
        : xs
            .map((x) => serializeValue({ fact: x.fact, correct: x.correct, ms: x.ms }))
            .sort()
            .join('|')
    const fails: string[] = []
    for (let i = 0; i < N; i++) {
      const a = PAIRS[i]![0]
      const m = mergeDay(a, a)
      const strip = (v: Day): string =>
        serializeValue({ ...(v as unknown as Record<string, unknown>), sprint: undefined })
      if (strip(m.value) !== strip(a.value)) fails.push(`#${i} 값\na=${dump(a)}\nm=${dump(m)}`)
      else if (serializeValue(m.at) !== serializeValue(a.at))
        fails.push(`#${i} 스탬프\na=${dump(a)}\nm=${dump(m)}`)
      else if (bag(m.value.sprint) !== bag(a.value.sprint))
        fails.push(`#${i} 시도 다중집합\na=${dump(a)}\nm=${dump(m)}`)
      else if (serializeValue(mergeDay(m, m)) !== serializeValue(m))
        fails.push(`#${i} 재멱등\nm=${dump(m)}\nmm=${dump(mergeDay(m, m))}`)
    }
    expectNoFailures(fails)
  })

  it('결합: merge(merge(a,b),c) = merge(a,merge(b,c))', () => {
    const fails: string[] = []
    for (let i = 0; i < N; i++) {
      const [a, b, c] = TRIPLES[i]!
      const l = serializeValue(mergeDay(mergeDay(a, b), c))
      const r = serializeValue(mergeDay(a, mergeDay(b, c)))
      if (l !== r) fails.push(`#${i}\na=${dump(a)}\nb=${dump(b)}\nc=${dump(c)}\nL=${l}\nR=${r}`)
    }
    expectNoFailures(fails)
  })

  it('왕복: merge(merge(a,b), a) = merge(a,b)', () => {
    const fails: string[] = []
    for (let i = 0; i < N; i++) {
      const [a, b] = PAIRS[i]!
      const m = mergeDay(a, b)
      const again = serializeValue(mergeDay(m, a))
      if (again !== serializeValue(m))
        fails.push(`#${i}\na=${dump(a)}\nb=${dump(b)}\nm=${dump(m)}\n재=${again}`)
    }
    expectNoFailures(fails)
  })

  it('서버 비대칭 왕복: 무sid b를 물질화 없이 재병합해도 증식 0', () => {
    // 서버는 물질화하지 않으므로 다음 pull에도 무sid 배열이 그대로 온다. 재물질화가
    // 결정적이어야 같은 세션으로 접히고, 아니면 시도가 두 벌로 늘어난다.
    const fails: string[] = []
    for (let i = 0; i < N; i++) {
      const [a, b] = PAIRS[i]!
      const m = mergeDay(a, b)
      const again = mergeDay(m, b)
      const len = (s: Stamped<Day>): number => s.value.sprint?.length ?? -1
      if (
        len(again) !== len(m) ||
        serializeValue(again.value.sprint) !== serializeValue(m.value.sprint)
      )
        fails.push(
          `#${i}\na=${dump(a)}\nb=${dump(b)}\nm.sprint=${serializeValue(m.value.sprint)}\n재.sprint=${serializeValue(again.value.sprint)}`,
        )
    }
    expectNoFailures(fails)
  })

  it('모르는 필드 보존: a에만 있는 필드는 결과에 있다', () => {
    const known = new Set(['date', 'kind', 'sheet', 'grades', 'mood', 'doneAt', 'sprint'])
    const fails: string[] = []
    for (let i = 0; i < N; i++) {
      const [a, b] = PAIRS[i]!
      const aRec = a.value as unknown as Record<string, unknown>
      const bRec = b.value as unknown as Record<string, unknown>
      const mRec = mergeDay(a, b).value as unknown as Record<string, unknown>
      for (const k of Object.keys(aRec)) {
        if (known.has(k) || k in bRec) continue
        if (!(k in mRec) || serializeValue(mRec[k]) !== serializeValue(aRec[k]))
          fails.push(`#${i} ${k}\na=${dump(a)}\nb=${dump(b)}\nm=${serializeValue(mRec[k])}`)
      }
    }
    expectNoFailures(fails)
  })
})

describe('모르는 필드 — 스탬프를 보지 않는다 (설계 §1 규칙표 개정판의 회귀망)', () => {
  // 이 두 삼중·쌍은 규칙표가 스탬프를 보던 시절 결합·왕복을 깨뜨린 **실제 반례**다.
  // 스탬프를 빼는 개정으로 둘 다 성립하게 됐고, 여기 그대로 남겨 회귀망으로 쓴다.
  // 깨졌던 방식은 둘이었다:
  //
  //   ① 승격 — 모르는 필드가 **없는** 레코드(스탬프는 큰)와 병합하면 살아남은 값이
  //      상대의 큰 스탬프를 업고 다음 비교에 나섰다. 잔류 스탬프가 없어도 결합이 깨졌다
  //   ② 소실 — 「묶음이 한쪽에만 있으면 있는 쪽이 이긴다」(공통 규칙 1)가 진 쪽의 더 큰
  //      스탬프를 통째로 버려, 병합 결과의 최대값이 입력들의 최대값보다 작아졌다
  //
  // 뿌리는 하나다: **레코드의 묶음 스탬프 최대값은 그 필드의 스탬프가 아니고, 병합에
  // 대해 단조가 아니다.** 그래서 스탬프 기반 타이브레이크는 같은 절이 요구하는 결합과
  // 양립할 수 없었다. 지금 규칙은 값 직렬화 사전순 하나뿐이라 두 방식 모두 사라진다.
  const T01 = '2026-08-10T01:00:00.000Z'
  const T05 = '2026-08-10T05:00:00.000Z'
  const T09 = '2026-08-10T09:00:00.000Z'
  const x1 = (s: Stamped<Day>): unknown => (s.value as unknown as Record<string, unknown>)['x1']

  it('결합 — 옛 ① 승격 반례에서 이제 양쪽이 같다', () => {
    const a = st(day({ sheet: sheetA }), { sheetAt: T09 }) // x1 없음, 스탬프는 큼
    const b = st({ ...day({ sheet: sheetA }), x1: 'a' } as Day, { sheetAt: T01 })
    const c = st({ ...day({ sheet: sheetA }), x1: 'z' } as Day, { sheetAt: T09 })
    // 스탬프를 보던 시절: 왼쪽 'a', 오른쪽 'z'. 지금은 사전순으로 양쪽 다 'a'.
    expect(x1(mergeDay(mergeDay(a, b), c))).toBe('a')
    expect(x1(mergeDay(a, mergeDay(b, c)))).toBe('a')
    expect(serializeValue(mergeDay(mergeDay(a, b), c))).toBe(
      serializeValue(mergeDay(a, mergeDay(b, c))),
    )
  })
  it('왕복 — 옛 ② 소실 반례에서 이제 재병합이 값을 되돌리지 않는다', () => {
    const a = st({ ...day({ sheet: [], grades: { v1: true } }), x1: 'z' } as Day, { sheetAt: T05 })
    // 잔류 스탬프는 그대로 둔다(grades 묶음이 없는데 gradesAt이 찍혀 있다) — 규칙이
    // 스탬프를 보지 않으므로 이제 이 상태가 모르는 필드에 영향을 주지 못한다.
    const b = st({ ...day({ sheet: sheetA }), x1: 'a' } as Day, { sheetAt: T01, gradesAt: T09 })
    const m = mergeDay(a, b)
    expect(x1(m)).toBe('a') // 사전순: 'a' < 'z'
    expect(m.at.gradesAt).toBe(null) // 잔류 T09는 여전히 사라진다(스탬프 규칙은 그대로)
    expect(x1(mergeDay(m, a))).toBe('a') // 그래도 왕복이 성립한다
    expect(serializeValue(mergeDay(m, a))).toBe(serializeValue(m))
  })
  it('스탬프가 아무리 커도 사전순이 이긴다 — 규칙이 스탬프를 보지 않는다는 직접 증거', () => {
    // 'z'쪽 스탬프를 최대로, 'a'쪽을 null로 준다. 스탬프를 조금이라도 보면 'z'가 이긴다.
    const a = st({ ...day({ sheet: sheetA }), x1: 'z' } as Day, {
      sheetAt: T09,
      gradesAt: T09,
      sprintAt: T09,
    })
    const b = st({ ...day({ sheet: sheetA }), x1: 'a' } as Day)
    expect(x1(mergeDay(a, b))).toBe('a')
    expect(x1(mergeDay(b, a))).toBe('a')
  })
})

describe('grades: {} — 병합이 키를 지우므로 멱등이 성립하지 않는다', () => {
  // **세 번째 제약이자, 생성기가 이 모양을 만들지 않는 이유.** `hasGradesBundle`이 키
  // 개수로 존재를 판정하므로 `grades: {}`는 「묶음 있음」이 아니고, 출력 조립이 키를
  // 통째로 뺀다. 그래서 `merge(a,a) !== a`가 **문자 그대로** 성립하지 않는다 — 값이
  // 바뀌는 정규화이지 sprint 물질화 같은 무해한 것이 아니다. 규칙표 개정이 건드리는
  // 문제가 아니라(스탬프와 무관) 그대로 남겨 두고 여기 못 박는다.
  //
  // 실행 경로에서는 나오지 않는다: `grade.ts:226`이 `grades`와 `doneAt`을 항상 함께 쓰므로
  // `doneAt`이 묶음을 존재하게 만든다.
  it('빈 grades만 있는 날은 묶음이 없는 것으로 보고 결과에서 키가 사라진다', () => {
    const m = mergeDay(st(day({ grades: {} })), st(day({})))
    expect('grades' in (m.value as unknown as Record<string, unknown>)).toBe(false)
  })
  it('그래서 멱등이 깨진다 — merge(a,a)가 a와 다르다', () => {
    const a = st(day({ grades: {} }))
    expect(serializeValue(mergeDay(a, a))).not.toBe(serializeValue(a))
  })
})

// ─────────── mergeMeta 속성 ───────────
//
// 1차 리뷰가 잡은 구멍: 모르는 필드 규칙은 `mergeDay`와 `mergeMeta` **두 함수**에 있었고
// 둘 다 같은 이유로 깨졌는데, 속성 테스트는 `mergeDay`에만 있었다. 같은 생성기 방식으로
// `mergeMeta`도 덮는다. 쌍·삼중 수는 `mergeDay`와 같은 1000 — meta 값이 훨씬 작아
// 추가 비용이 무시할 만하다(전체 파일 실행이 여전히 0.2초대다).

const LAST_EXPORTED = [null, '2026-08-01T00:00:00.000Z', '2026-08-09T00:00:00.000Z']

function genMeta(r: Rand, tags: string[] = []): Stamped<Meta> {
  const settings = {
    ...DEFAULT_SETTINGS,
    fluentMs: pick(r, [2000, 2500, 3000]),
    sprintCount: pick(r, [20, 30]),
    verticalCount: pick(r, [8, 6] as const),
    lastExportedAt: pick(r, LAST_EXPORTED),
  }
  // derived는 항상 빈 것으로 정규화되므로 일부러 더럽혀 넣는다.
  const rec: Record<string, unknown> = {
    derived: r() < 0.3 ? { facts: { '2x3': 1 }, types: {}, strategies: {} } : emptyDerived(),
    settings,
  }
  if (r() < 0.5) {
    rec['m1'] = pick(r, X1)
    tags.push('meta:모르는필드:m1')
  }
  if (r() < 0.3) {
    rec['m2'] = pick(r, X2)
    tags.push('meta:모르는필드:m2')
  }
  const settingsAt = pick(r, ATS)
  tags.push('meta:스탬프:' + (settingsAt === null ? 'null' : '실재'))
  tags.push('meta:lastExportedAt:' + (settings.lastExportedAt === null ? 'null' : '실재'))
  return {
    value: rec as unknown as Meta,
    at: { ...EMPTY_STAMPS, settingsAt, settingsBy: pick(r, BYS) },
  }
}

const META_PAIRS: [Stamped<Meta>, Stamped<Meta>][] = []
const META_TRIPLES: [Stamped<Meta>, Stamped<Meta>, Stamped<Meta>][] = []
const META_TAGS: string[][] = []
for (let i = 0; i < N; i++) {
  const ta: string[] = []
  const tb: string[] = []
  META_PAIRS.push([genMeta(rnd, ta), genMeta(rnd, tb)])
  META_TAGS.push([...ta, ...tb])
  META_TRIPLES.push([genMeta(rnd), genMeta(rnd), genMeta(rnd)])
}

describe('mergeMeta 속성', () => {
  it('생성기 점검 — 규정된 모양이 실제로 나온다', () => {
    const counts = new Map<string, number>()
    for (const tags of META_TAGS)
      for (const t of new Set(tags)) counts.set(t, (counts.get(t) ?? 0) + 1)
    const need = [
      'meta:모르는필드:m1',
      'meta:모르는필드:m2',
      'meta:스탬프:null',
      'meta:스탬프:실재',
      'meta:lastExportedAt:null',
      'meta:lastExportedAt:실재',
    ]
    expect(need.filter((t) => (counts.get(t) ?? 0) < 100)).toEqual([])
    // settings가 실제로 갈리는 쌍이 대부분이어야 LWW가 검사된다.
    const differing = META_PAIRS.filter(
      ([a, b]) => serializeValue(a.value.settings) !== serializeValue(b.value.settings),
    )
    expect(differing.length).toBeGreaterThan(800)
  })

  // 비교는 `lastExportedAt`을 지우고 한다 — **이 필드는 mergeMeta의 계약 밖이다.**
  // 설계 §1: 동기화되는 meta는 「settings 한 묶음(lastExportedAt 제외)」이고, 이 필드는
  // 기기 로컬 값으로 강등되어 pull은 로컬 값을, push는 서버 값을 **함수 밖에서 방향별로
  // 접붙인다.** 그래서 병합이 이 자리에 무엇을 남기든 호출부가 덮어쓴다.
  //
  // 지우지 않으면 교환이 실제로 깨진다(아래 예제 테스트가 그 케이스를 못 박는다):
  // 동률 사슬의 마지막 고리가 값 직렬화인데 거기서 이 필드를 빼 놓았으므로, 나머지가
  // 전부 같고 스탬프도 같으면 사슬이 끝까지 동률이 되어 **먼저 온 인자가 이긴다.**
  const metaNorm = (s: Stamped<Meta>): string =>
    serializeValue({
      value: {
        ...(s.value as unknown as Record<string, unknown>),
        settings: { ...s.value.settings, lastExportedAt: '(기기 로컬)' },
      },
      at: s.at,
    })

  it('교환: merge(a,b) = merge(b,a) (lastExportedAt 제외 — 계약 밖)', () => {
    const fails: string[] = []
    for (let i = 0; i < N; i++) {
      const [a, b] = META_PAIRS[i]!
      const l = metaNorm(mergeMeta(a, b))
      const r = metaNorm(mergeMeta(b, a))
      if (l !== r)
        fails.push(`#${i}\na=${serializeValue(a)}\nb=${serializeValue(b)}\nL=${l}\nR=${r}`)
    }
    expectNoFailures(fails)
  })

  it('결합: merge(merge(a,b),c) = merge(a,merge(b,c)) (lastExportedAt 제외 — 계약 밖)', () => {
    const fails: string[] = []
    for (let i = 0; i < N; i++) {
      const [a, b, c] = META_TRIPLES[i]!
      const l = metaNorm(mergeMeta(mergeMeta(a, b), c))
      const r = metaNorm(mergeMeta(a, mergeMeta(b, c)))
      if (l !== r)
        fails.push(
          `#${i}\na=${serializeValue(a)}\nb=${serializeValue(b)}\nc=${serializeValue(c)}\nL=${l}\nR=${r}`,
        )
    }
    expectNoFailures(fails)
  })

  it('lastExportedAt만 다르면 먼저 온 인자가 이긴다 — 계약 밖이라 호출부가 덮어써야 한다', () => {
    // 이 비교환성은 「lastExportedAt을 동률 판정에서 뺀다」는 설계 결정의 직접적 귀결이다.
    // 함수를 고쳐서 없앨 수 있는 것이 아니라(넣으면 기기 로컬 강등이 무너진다), 호출부의
    // 접붙임 규율로 무해해지는 종류다 — pull/push를 만드는 태스크가 이걸 빠뜨리면
    // 서버로 나가는 값이 인자 순서에 의존하게 된다.
    const mk = (lastExportedAt: string): Stamped<Meta> => ({
      value: { derived: emptyDerived(), settings: { ...DEFAULT_SETTINGS, lastExportedAt } },
      at: { ...EMPTY_STAMPS, settingsAt: '2026-08-10T05:00:00.000Z', settingsBy: 'A1' },
    })
    const a = mk('2026-08-01T00:00:00.000Z')
    const b = mk('2026-08-09T00:00:00.000Z')
    expect(mergeMeta(a, b).value.settings.lastExportedAt).toBe('2026-08-01T00:00:00.000Z')
    expect(mergeMeta(b, a).value.settings.lastExportedAt).toBe('2026-08-09T00:00:00.000Z')
    // 나머지는 전부 같다 — 갈리는 곳이 이 필드 하나뿐임을 못 박는다.
    expect(metaNorm(mergeMeta(a, b))).toBe(metaNorm(mergeMeta(b, a)))
  })

  it('멱등: merge(a,a) = a (derived 정규화 제외)', () => {
    const fails: string[] = []
    for (let i = 0; i < N; i++) {
      const a = META_PAIRS[i]![0]
      const m = mergeMeta(a, a)
      const norm = (s: Stamped<Meta>): string =>
        serializeValue({
          value: { ...(s.value as unknown as Record<string, unknown>), derived: emptyDerived() },
          at: s.at,
        })
      if (norm(m) !== norm(a)) fails.push(`#${i}\na=${serializeValue(a)}\nm=${serializeValue(m)}`)
    }
    expectNoFailures(fails)
  })

  it('모르는 필드 — mergeDay와 같은 반례에서 결합이 성립한다', () => {
    // 리뷰가 손으로 유도한 삼중: a(m1 없음, settingsAt=T09), b(m1='a', T01), c(m1='z', T09).
    // 스탬프를 보던 시절 왼쪽 'a' / 오른쪽 'z'로 갈렸다.
    const T01 = '2026-08-10T01:00:00.000Z'
    const T09 = '2026-08-10T09:00:00.000Z'
    const mk = (m1: string | undefined, at: string | null): Stamped<Meta> => ({
      value: {
        derived: emptyDerived(),
        settings: { ...DEFAULT_SETTINGS },
        ...(m1 === undefined ? {} : { m1 }),
      } as unknown as Meta,
      at: { ...EMPTY_STAMPS, settingsAt: at, settingsBy: '' },
    })
    const get = (s: Stamped<Meta>): unknown => (s.value as unknown as Record<string, unknown>)['m1']
    const a = mk(undefined, T09)
    const b = mk('a', T01)
    const c = mk('z', T09)
    expect(get(mergeMeta(mergeMeta(a, b), c))).toBe('a')
    expect(get(mergeMeta(a, mergeMeta(b, c)))).toBe('a')
    expect(serializeValue(mergeMeta(mergeMeta(a, b), c))).toBe(
      serializeValue(mergeMeta(a, mergeMeta(b, c))),
    )
  })
})
