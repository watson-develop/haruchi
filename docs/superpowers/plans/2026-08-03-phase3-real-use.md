# Phase 3 — 실사용 시작 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 앱을 발행하고, 백업·복구를 붙이고, 주간·월간 리포트 화면과 점검 스프린트를 만들어 실사용을 시작할 수 있는 상태로 만든다.

**Architecture:** 스펙 `docs/superpowers/specs/2026-08-03-phase3-real-use-design.md`를 따른다. 순수 로직은 `engine/`(backup·checkup·report)에 두고 테스트하며, 화면은 얇게 유지한다. 점검 스프린트는 강등 로직 없이 `Day.sprint` 로그에 시도를 넣기만 하고 `deriveFacts`가 재생하며 판정한다. 리포트는 아무것도 저장하지 않고 매번 로그에서 재계산한다.

**Tech Stack:** TypeScript + Vite + vite-plugin-pwa, vitest + fake-indexeddb, 해시 라우팅(main.ts), IndexedDB(data/db.ts).

## Global Constraints

- Node는 mise에만 있다. 모든 셸 명령 앞에: `export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH"`
- git identity 미설정: `git -c user.name="이성호" -c user.email="watson@daangnpay.com" commit …`
- 커밋 전 검사: `npm test` · `npm run build`(tsc 포함) 통과. 문서를 커밋할 때는 `npm run format` 먼저(CI의 `prettier --check`가 `docs/`까지 본다)
- **재인쇄는 같은 문제를 낸다** — `print-sheet.ts`의 sheet 게이트를 건드리지 않는다
- **`Meta.derived`는 계속 아무도 읽지 않는다** — 리포트도 저장 없이 매번 재계산한다
- **곱셈 기호는 U+00D7(`×`)** — 식 id는 `engine/facts.ts`만 만들고 푼다
- **`Day`에 필수 필드를 추가하지 않는다** — 마이그레이션 없음이 이번 Phase의 성립 조건이다
- **`sheet`를 읽는 새 코드는 빈 sheet(`[]`)를 반드시 다룬다** (스프린트만 한 날이 만든다)
- 실패 패턴 준수: ① 자기 자신을 검사하는 테스트 금지 ② 느슨한 상한 금지(실측 기반) ③ 실패할 수 없는 단언 금지 ④ 화면 첫 `await`는 `try` 안 ⑤ 지연 콜백에 취소 경로 ⑥ 이음새를 테스트한다

### 태스크 0 결과 — 이음새 조사 (계획 수립 시 완료)

- **`Day.kind`를 읽고 분기하는 곳은 없다.** 코드의 `.kind` 매치는 전부 `SheetItem.kind`다. `kind:'checkup'` 생산은 아무것도 깨지 않는다
- **`Day.sprint` 독자**: `deriveFacts`(kind 무시 — 설계의 심장), `sprintStreak`(존재만 봄 → 점검도 연속일수로 셈, 의도대로), home의 `completedCount`(존재만 봄), sprint.ts의 `previousMean`(직전 스프린트 날 — 점검 시도도 섞이지만 무해)
- **같은 날 재스프린트는 이미 막혀 있다**: `renderSprint`가 `existing.sprint.length > 0`이면 결과만 보여준다. "점검 한 번으로 끝"이 공짜로 성립한다. 단 `{ ...existing, sprint: attempts }`가 kind를 보존하므로 점검 저장은 kind를 명시로 덮어야 한다
- **`lastExportedAt`**: 읽는 곳도 쓰는 곳도 없다(기본값 `null`뿐). 첫 독자(배지)·첫 필자(내보내기)가 이번에 생긴다
- **`replaceAll` 후 낡은 화면 없음**: 모든 화면이 렌더 때마다 IndexedDB에서 다시 읽는다. 가져오기 후 `navigate('#/')`면 충분하다
- **`grade.ts` 저장 성공 경로**(`navigate('#/')`)에 기대는 테스트는 없다(화면 테스트가 없는 코드베이스다)
- **`main.ts` 라우터**: `hash.startsWith('#/…')` 분기. `#/report`는 기존 접두사와 충돌하지 않는다
- **db의 `run()` 헬퍼는 단일 스토어 전용** — 2-스토어 트랜잭션은 새 함수가 필요하다

---

### Task 1: persist() + 발행

**Files:**

- Modify: `src/main.ts:5` (const app 선언 직후)

**Interfaces:**

- Consumes: 없음
- Produces: 없음 (부수효과뿐)

- [ ] **Step 1: main.ts에 persist 한 줄 추가**

`const app = …` 바로 아래:

```ts
// iOS는 저장공간 압박 시 IndexedDB를 지울 수 있다. persist()가 승인되면 이 origin은
// 그 대상에서 빠진다. 거부돼도 앱 동작은 같으므로 결과를 기다리지도 읽지도 않는다.
// 1년치 반응시간 로그는 모든 파생의 유일한 입력이고 복구 불가능하다 — 비용 0의 보험.
void navigator.storage?.persist?.()
```

- [ ] **Step 2: 검사**

Run: `npm test && npm run build`
Expected: 127개 통과, 빌드 성공

- [ ] **Step 3: 커밋**

```bash
git add src/main.ts
git commit -m "feat: 시작 시 저장 영속성을 요청한다"
```

- [ ] **Step 4: 발행 (사람 개입 필요 — GitHub 로그인)**

```bash
gh auth status || gh auth login
gh repo create haruchi --public --source=. --push
# Pages Source를 GitHub Actions로 설정
gh api -X POST "repos/{owner}/haruchi/pages" -f build_type=workflow
gh run watch
```

배포 확인: `https://<계정>.github.io/haruchi/`가 열리는지. **이 origin은 이후 절대 바꾸지 않는다** — IndexedDB가 origin별로 격리된다. 아이패드 실물 확인 4항목(HANDOFF)은 이 시점부터 사람이 병행한다.

---

### Task 2: 백업 엔진 (`engine/backup.ts`)

**Files:**

- Create: `src/engine/backup.ts`
- Create: `src/engine/backup.test.ts`
- Modify: `src/data/types.ts:123-126` (schemaVersion 주석 — 첫 독자가 생겼다)

**Interfaces:**

- Consumes: `Day`, `Meta` (data/types)
- Produces:
  - `serializeBackup(days: Day[], meta: Meta, exportedAt: string): string` — 들여쓰기 있는 JSON 문자열
  - `validateBackup(raw: unknown): { ok: true; days: Day[]; meta: Meta } | { ok: false; reason: string }`

- [ ] **Step 1: 실패하는 테스트 작성** — `src/engine/backup.test.ts`

```ts
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
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/engine/backup.test.ts`
Expected: FAIL — `./backup` 모듈 없음

- [ ] **Step 3: 구현** — `src/engine/backup.ts`

```ts
import type { Day, Meta } from '../data/types'

/**
 * 백업 파일(설계 §10). 순수 함수만 둔다 — Blob·파일 입출력은 화면(report.ts)의 일이다.
 * schemaVersion을 실제로 읽는 코드베이스 최초의 지점이다.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function serializeBackup(days: Day[], meta: Meta, exportedAt: string): string {
  // 들여쓰기 2칸: export 파일은 데이터를 들여다보는 유일한 수단이다. 5년치가 2.3MB(실측)라
  // 크기는 문제가 아니다.
  return JSON.stringify({ app: 'haruchi', schemaVersion: 1, exportedAt, days, meta }, null, 2)
}

export type BackupValidation = { ok: true; days: Day[]; meta: Meta } | { ok: false; reason: string }

function bad(reason: string): BackupValidation {
  return { ok: false, reason }
}

/** days[i] 하나를 검사한다. 코드가 기대는 필드만 보고, 모르는 여분 필드는 통과시킨다. */
function dayError(raw: unknown, i: number): string | null {
  if (typeof raw !== 'object' || raw === null) return `days[${i}]가 객체가 아니다`
  const d = raw as Record<string, unknown>
  if (typeof d['date'] !== 'string' || !DATE_RE.test(d['date']))
    return `days[${i}].date가 날짜 키(YYYY-MM-DD)가 아니다: ${JSON.stringify(d['date'])}`
  if (d['kind'] !== 'normal' && d['kind'] !== 'checkup')
    return `days[${i}].kind가 알 수 없는 값이다: ${JSON.stringify(d['kind'])}`
  if (!Array.isArray(d['sheet'])) return `days[${i}].sheet가 배열이 아니다`
  if (d['sprint'] !== undefined) {
    if (!Array.isArray(d['sprint'])) return `days[${i}].sprint가 배열이 아니다`
    for (let j = 0; j < d['sprint'].length; j++) {
      const a = d['sprint'][j] as Record<string, unknown> | null
      if (
        typeof a !== 'object' ||
        a === null ||
        typeof a['fact'] !== 'string' ||
        typeof a['correct'] !== 'boolean' ||
        typeof a['ms'] !== 'number'
      )
        return `days[${i}].sprint[${j}]가 시도 형태({fact, correct, ms})가 아니다`
    }
  }
  if (
    d['grades'] !== undefined &&
    (typeof d['grades'] !== 'object' || d['grades'] === null || Array.isArray(d['grades']))
  )
    return `days[${i}].grades가 객체가 아니다`
  return null
}

/**
 * 파싱된 값(JSON.parse의 결과)을 검사한다. 실패 사유는 어디가 왜 틀렸는지 담는다 —
 * "잘못된 파일"이라는 배너만 보고는 아빠가 무엇을 고칠지 알 수 없다(설계 §11).
 */
export function validateBackup(raw: unknown): BackupValidation {
  if (typeof raw !== 'object' || raw === null) return bad('백업 파일이 객체가 아니다')
  const o = raw as Record<string, unknown>
  if (o['app'] !== 'haruchi') return bad(`app이 "haruchi"가 아니다: ${JSON.stringify(o['app'])}`)
  if (o['schemaVersion'] !== 1)
    return bad(
      `지원하지 않는 schemaVersion: ${JSON.stringify(o['schemaVersion'])} — 더 새 버전의 앱으로 여세요`,
    )
  if (!Array.isArray(o['days'])) return bad('days가 배열이 아니다')
  const seen = new Set<string>()
  for (let i = 0; i < o['days'].length; i++) {
    const err = dayError(o['days'][i], i)
    if (err) return bad(err)
    const date = (o['days'][i] as Day).date
    if (seen.has(date)) return bad(`날짜가 중복된다: ${date}`)
    seen.add(date)
  }
  const meta = o['meta']
  if (typeof meta !== 'object' || meta === null) return bad('meta가 객체가 아니다')
  const settings = (meta as Record<string, unknown>)['settings']
  if (typeof settings !== 'object' || settings === null) return bad('meta.settings가 객체가 아니다')
  return { ok: true, days: o['days'] as Day[], meta: meta as Meta }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/engine/backup.test.ts`
Expected: PASS

- [ ] **Step 5: types.ts 주석 갱신**

`src/data/types.ts`의 `schemaVersion` 위 주석(123행 근처)을 바꾼다. 기존 "schemaVersion·algoVersion은 DB에 쓰이기만 하고 읽는 곳이 없다…" 문단을:

```ts
// schemaVersion은 backup.ts의 validateBackup이 읽는다(가져오기 게이트) — DB 쪽 마이그레이션은
// 여전히 배선되어 있지 않다. algoVersion은 쓰이기만 하고 읽는 곳이 없다. 스키마를 바꿀 때는
// 이 값을 올리고 validateBackup·마이그레이션을 함께 손대야 한다.
```

- [ ] **Step 6: 전체 검사 후 커밋**

Run: `npm test && npm run build`

```bash
git add src/engine/backup.ts src/engine/backup.test.ts src/data/types.ts
git commit -m "feat(engine): 백업 직렬화와 필드 단위 검증 추가"
```

---

### Task 3: 원자적 전체 교체 (`db.replaceAll`)

**Files:**

- Modify: `src/data/db.ts` (끝에 함수 추가)
- Modify: `src/data/db.test.ts` (케이스 추가)

**Interfaces:**

- Consumes: 기존 `open()`, `STORE_DAYS`, `STORE_META`, `META_KEY`
- Produces: `replaceAll(days: Day[], meta: Meta): Promise<void>` — 두 스토어를 한 트랜잭션으로 clear→put. 실패 시 기존 데이터 보존

- [ ] **Step 1: 실패하는 테스트 작성** — `src/data/db.test.ts`에 추가 (기존 파일의 픽스처·격리 방식을 따른다)

```ts
describe('replaceAll', () => {
  it('기존 데이터를 통째로 바꾼다', async () => {
    await putDay({ date: '2026-08-01', kind: 'normal', sheet: [] })
    const oldMeta = await getMeta()
    await putMeta({ ...oldMeta, settings: { ...oldMeta.settings, childName: '이전' } })

    const newDay: Day = { date: '2026-09-01', kind: 'normal', sheet: [] }
    const newMeta: Meta = {
      ...oldMeta,
      settings: { ...oldMeta.settings, childName: '이후' },
    }
    await replaceAll([newDay], newMeta)

    expect(await getAllDays()).toEqual([newDay])
    expect((await getMeta()).settings.childName).toBe('이후')
  })

  it('도중에 실패하면 기존 데이터가 그대로 남는다 — 가져오기의 원자성', async () => {
    const oldDay: Day = { date: '2026-08-01', kind: 'normal', sheet: [] }
    await putDay(oldDay)
    const oldMeta = await getMeta()
    await putMeta(oldMeta)

    // 함수는 구조 복제(structured clone)가 안 되므로 put이 동기로 던진다.
    const poisoned = { date: '2026-09-01', kind: 'normal', sheet: [() => {}] } as unknown as Day

    await expect(replaceAll([poisoned], oldMeta)).rejects.toThrow()
    // clear()가 이미 큐에 들어간 뒤였다 — abort하지 않으면 여기서 빈 배열이 나온다.
    expect(await getAllDays()).toEqual([oldDay])
    expect(await getMeta()).toEqual(oldMeta)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/data/db.test.ts`
Expected: FAIL — `replaceAll` 미정의

- [ ] **Step 3: 구현** — `src/data/db.ts` 끝에

```ts
/**
 * 가져오기(복구) 전용: days·meta를 통째로 바꾼다. 병합하지 않는다(설계 §10).
 *
 * 두 스토어를 **한 트랜잭션**에 넣는다 — days만 바뀌고 meta가 남는(또는 반대) 반쪽
 * 상태를 만들지 않기 위해서다. put()은 복제 불가능한 값에 **동기로 던지는데**, 그 시점에
 * clear()는 이미 큐에 들어가 있다. 여기서 tx.abort()를 부르지 않으면 예외가 새는 동안
 * 트랜잭션이 "clear만 하고" 커밋해 기존 데이터가 조용히 사라진다.
 */
export function replaceAll(days: Day[], meta: Meta): Promise<void> {
  return open().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction([STORE_DAYS, STORE_META], 'readwrite')
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB 트랜잭션 실패'))
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB 트랜잭션 중단'))
        try {
          const dayStore = tx.objectStore(STORE_DAYS)
          dayStore.clear()
          for (const day of days) dayStore.put(day)
          const metaStore = tx.objectStore(STORE_META)
          metaStore.clear()
          metaStore.put(meta, META_KEY)
        } catch (e) {
          tx.abort()
          reject(e as Error)
        }
      }),
  )
}
```

주의: `tx.onabort`와 catch의 `reject`가 둘 다 불릴 수 있다 — Promise는 첫 settle만 유효하므로 무해하다.

- [ ] **Step 4: 통과 확인 + 전체 검사**

Run: `npx vitest run src/data/db.test.ts && npm test && npm run build`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/data/db.ts src/data/db.test.ts
git commit -m "feat(data): 가져오기용 원자적 전체 교체 replaceAll 추가"
```

---

### Task 4: 점검 엔진 (`engine/checkup.ts`)

**Files:**

- Create: `src/engine/checkup.ts`
- Create: `src/engine/checkup.test.ts`
- Modify: `src/engine/facts.ts:121` (`function shuffled` → `export function shuffled`)

**Interfaces:**

- Consumes: `deriveFacts`, `shuffled` (facts.ts), `shiftDay` (dates.ts)
- Produces:
  - `CHECKUP_INTERVAL_DAYS = 28`
  - `nextCheckupDate(days: Day[], fluentMs: number): string | null` — fluent 0개면 null
  - `checkupDue(days: Day[], fluentMs: number, today: string): boolean`
  - `composeCheckup(facts: Record<string, FactState>, count: number, rand?: () => number): string[]` — fluent만, 각 한 번씩

- [ ] **Step 1: facts.ts에서 shuffled 내보내기**

`src/engine/facts.ts`의 `function shuffled<T>(…)`를 `export function shuffled<T>(…)`로 바꾼다. 다른 변경 없음.

- [ ] **Step 2: 실패하는 테스트 작성** — `src/engine/checkup.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { checkupDue, nextCheckupDate, composeCheckup } from './checkup'
import { deriveFacts } from './facts'
import { shiftDay } from './dates'
import type { Day, FactState } from '../data/types'

/** 빠른 정답 3연속 → 그 식은 fluent가 된다. */
function fluentDay(date: string, fact: string): Day {
  const a = { fact, correct: true, ms: 800 }
  return { date, kind: 'normal', sheet: [], sprint: [a, a, a] }
}

const FLUENT_MS = 2500

describe('nextCheckupDate / checkupDue', () => {
  it('fluent 식이 없으면 점검은 없다', () => {
    const slow: Day = {
      date: '2026-08-01',
      kind: 'normal',
      sheet: [],
      sprint: [{ fact: '2×3', correct: true, ms: 4000 }],
    }
    expect(nextCheckupDate([slow], FLUENT_MS)).toBeNull()
    expect(checkupDue([slow], FLUENT_MS, '2026-12-31')).toBe(false)
  })

  it('첫 스프린트일 + 28일에 due가 된다', () => {
    const days = [fluentDay('2026-08-01', '2×3')]
    expect(nextCheckupDate(days, FLUENT_MS)).toBe('2026-08-29')
    expect(checkupDue(days, FLUENT_MS, '2026-08-28')).toBe(false)
    expect(checkupDue(days, FLUENT_MS, '2026-08-29')).toBe(true)
    expect(checkupDue(days, FLUENT_MS, '2026-09-15')).toBe(true) // 밀려도 due는 유지
  })

  it('점검을 마친 날이 새 기준점이 된다 — 완료 직후 due가 풀린다', () => {
    const days: Day[] = [
      fluentDay('2026-08-01', '2×3'),
      {
        date: '2026-08-29',
        kind: 'checkup',
        sheet: [],
        sprint: [{ fact: '2×3', correct: true, ms: 900 }],
      },
    ]
    expect(nextCheckupDate(days, FLUENT_MS)).toBe('2026-09-26')
    expect(checkupDue(days, FLUENT_MS, '2026-08-29')).toBe(false)
  })

  it('sprint가 없는 checkup 날은 기준점이 아니다', () => {
    // 방어: 어떤 경로로든 시도 없는 checkup Day가 생겨도 점검을 건너뛴 것으로 치지 않는다.
    const days: Day[] = [
      fluentDay('2026-08-01', '2×3'),
      { date: '2026-08-29', kind: 'checkup', sheet: [] },
    ]
    expect(nextCheckupDate(days, FLUENT_MS)).toBe('2026-08-29')
  })
})

describe('composeCheckup', () => {
  /** 유창 판정일이 judgedAt인 fluent 상태. nextDue = judgedAt + interval (deriveFacts와 같은 규칙). */
  function fluentState(judgedAt: string, interval: 1 | 3 | 7 | 14): FactState {
    return {
      status: 'fluent',
      medianMs: 900,
      streak: 3,
      interval,
      nextDue: shiftDay(judgedAt, interval),
    }
  }
  const learning: FactState = {
    status: 'learning',
    medianMs: null,
    streak: 1,
    interval: 1,
    nextDue: null,
  }
  const fresh: FactState = { status: 'new', medianMs: null, streak: 0, interval: 1, nextDue: null }

  it('fluent만, 각 한 번씩 낸다 — 드릴이 아니라 측정이다', () => {
    const facts = {
      '2×3': fluentState('2026-08-01', 7),
      '3×4': fluentState('2026-08-10', 3),
      '4×5': learning,
      '5×6': fresh,
    }
    const queue = composeCheckup(facts, 30)
    expect([...queue].sort()).toEqual(['2×3', '3×4'])
  })

  it('count를 넘으면 마지막 유창 판정이 오래된 순으로 자른다', () => {
    const facts = {
      '2×3': fluentState('2026-08-20', 1), // 최근
      '3×4': fluentState('2026-08-01', 14), // 가장 오래됨
      '4×5': fluentState('2026-08-10', 7),
    }
    const queue = composeCheckup(facts, 2)
    expect([...queue].sort()).toEqual(['3×4', '4×5'])
  })

  it('fluent가 count보다 적으면 세션이 그만큼 짧다 — learning으로 채우지 않는다', () => {
    const facts = { '2×3': fluentState('2026-08-01', 7), '4×5': learning }
    expect(composeCheckup(facts, 30)).toEqual(['2×3'])
  })

  it('주입한 난수로 결정적이다', () => {
    const facts = {
      '2×3': fluentState('2026-08-01', 7),
      '3×4': fluentState('2026-08-02', 7),
      '4×5': fluentState('2026-08-03', 7),
    }
    const rand = () => 0.5
    expect(composeCheckup(facts, 30, rand)).toEqual(composeCheckup(facts, 30, rand))
  })
})

describe('점검 시도의 판정 반영 — 강등 로직 없음의 증명', () => {
  it('점검에서 틀린 식은 derive만으로 fluent에서 내려온다', () => {
    const log: Day[] = [
      fluentDay('2026-08-01', '2×3'),
      {
        date: '2026-08-29',
        kind: 'checkup',
        sheet: [],
        sprint: [{ fact: '2×3', correct: false, ms: 4000 }],
      },
    ]
    expect(deriveFacts(log.slice(0, 1), FLUENT_MS)['2×3']!.status).toBe('fluent')
    expect(deriveFacts(log, FLUENT_MS)['2×3']!.status).toBe('learning')
  })
})
```

- [ ] **Step 3: 실패 확인**

Run: `npx vitest run src/engine/checkup.test.ts`
Expected: FAIL — `./checkup` 모듈 없음

- [ ] **Step 4: 구현** — `src/engine/checkup.ts`

```ts
import type { Day, FactState } from '../data/types'
import { deriveFacts, shuffled } from './facts'
import { shiftDay } from './dates'

/**
 * 점검 스프린트(스펙 §5). 적응 off로 fluent 식을 한 번씩 재검증한다.
 *
 * 강등 로직은 여기에도 어디에도 없다 — 점검 시도는 Day.sprint에 기록될 뿐이고,
 * deriveFacts가 로그를 재생하며 연속 3회 조건이 깨지면 스스로 내린다.
 *
 * 주기 28일은 재등장 상한 실측(15~16일)보다 길다: 점검 사이에 모든 fluent 식이
 * 일반 로테이션으로도 최소 한 번 검증되고, 점검은 그 위의 동질 조건 스냅샷이다.
 */
export const CHECKUP_INTERVAL_DAYS = 28

function lastCheckupDate(days: Day[]): string | null {
  for (let i = days.length - 1; i >= 0; i--) {
    const d = days[i]!
    // sprint 없는 checkup 날은 점검을 실제로 하지 않은 것이다 — 기준점으로 치지 않는다.
    if (d.kind === 'checkup' && d.sprint && d.sprint.length > 0) return d.date
  }
  return null
}

function firstSprintDate(days: Day[]): string | null {
  for (const d of days) if (d.sprint && d.sprint.length > 0) return d.date
  return null
}

/** 다음 점검 예정일. fluent 식이 하나도 없으면(점검할 것이 없으면) null. */
export function nextCheckupDate(days: Day[], fluentMs: number): string | null {
  const facts = deriveFacts(days, fluentMs)
  if (!Object.values(facts).some((f) => f.status === 'fluent')) return null
  const anchor = lastCheckupDate(days) ?? firstSprintDate(days)
  if (anchor === null) return null
  return shiftDay(anchor, CHECKUP_INTERVAL_DAYS)
}

export function checkupDue(days: Day[], fluentMs: number, today: string): boolean {
  const next = nextCheckupDate(days, fluentMs)
  return next !== null && next <= today
}

/**
 * 점검 세션의 문제 목록: fluent 식 전부, 각 한 번씩, 순서만 섞는다.
 * count를 넘으면 마지막 유창 판정이 오래된 순으로 자른다 — 판정일은
 * nextDue - interval로 FactState에서 역산한다(새 저장 없음).
 * fluent가 count보다 적으면 그만큼 짧은 세션이 된다 — learning으로 채우지 않는다.
 */
export function composeCheckup(
  facts: Record<string, FactState>,
  count: number,
  rand: () => number = Math.random,
): string[] {
  const fluent = Object.keys(facts).filter((id) => facts[id]!.status === 'fluent')
  const judgedAt = (id: string) => shiftDay(facts[id]!.nextDue!, -facts[id]!.interval)
  fluent.sort((p, q) => judgedAt(p).localeCompare(judgedAt(q)))
  return shuffled(fluent.slice(0, count), rand)
}
```

- [ ] **Step 5: 통과 확인 + 전체 검사**

Run: `npx vitest run src/engine/checkup.test.ts && npm test && npm run build`
Expected: PASS

- [ ] **Step 6: 커밋**

```bash
git add src/engine/checkup.ts src/engine/checkup.test.ts src/engine/facts.ts
git commit -m "feat(engine): 점검 스프린트 스케줄과 구성 추가"
```

---

### Task 5: 주간 리포트 엔진 (`engine/report.ts`)

**Files:**

- Create: `src/engine/report.ts`
- Create: `src/engine/report.test.ts`
- Modify: `src/engine/facts.ts:49` (`function median` → `export function median`)
- Modify: `src/screens/home.ts:16-20` (`completedCount`를 report.ts로 옮기고 import)

**Interfaces:**

- Consumes: `deriveFacts`, `median` (facts.ts), `deriveTypes`, `accuracy`, `RECENT_WINDOW`, `OPEN_THRESHOLD` (derive.ts), `sprintStreak`, `diffDays`, `shiftDay`, `nextCheckupDate` (Task 4)
- Produces:

```ts
export const EXPORT_OVERDUE_DAYS = 30
export function completedCount(days: Day[]): number // home.ts에서 이사
export type WeeklyReport = {
  streak: number
  completed: number
  fluentTotal: number
  newlyFluent: string[] // 최근 7일에 fluent가 된 식 id들
  weekMedianMs: number | null
  prevWeekMedianMs: number | null
  types: { tag: string; pct: number | null; warn: boolean }[] // pct null = 표본 부족
  slowest: { fact: string; medianMs: number } | null
  nextCheckup: string | null
  exportOverdue: boolean
}
export function weeklyReport(days: Day[], meta: Meta, today: string): WeeklyReport
```

- [ ] **Step 1: median 내보내기 + completedCount 이사**

`facts.ts`의 `function median`을 `export function median`으로. `home.ts`의 `completedCount` 함수를 지우고 `import { completedCount } from '../engine/report'`로 바꾼다(주석도 함께 이사).

- [ ] **Step 2: 실패하는 테스트 작성** — `src/engine/report.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { weeklyReport, completedCount } from './report'
import { DEFAULT_SETTINGS, emptyDerived } from '../data/types'
import type { Day, Meta, VerticalTag } from '../data/types'

const TODAY = '2026-08-03'

function metaWith(lastExportedAt: string | null): Meta {
  return {
    derived: emptyDerived(),
    settings: { ...DEFAULT_SETTINGS, friendNames: [], lastExportedAt },
  }
}

function sprintDay(date: string, attempts: { fact: string; correct: boolean; ms: number }[]): Day {
  return { date, kind: 'normal', sheet: [], sprint: attempts }
}

const fast = (fact: string) => ({ fact, correct: true, ms: 800 })

describe('weeklyReport', () => {
  it('빈 로그에서 죽지 않고 전부 기본값이다', () => {
    const w = weeklyReport([], metaWith(null), TODAY)
    expect(w.streak).toBe(0)
    expect(w.completed).toBe(0)
    expect(w.newlyFluent).toEqual([])
    expect(w.weekMedianMs).toBeNull()
    expect(w.prevWeekMedianMs).toBeNull()
    expect(w.types).toEqual([])
    expect(w.slowest).toBeNull()
    expect(w.nextCheckup).toBeNull()
    // 데이터가 없으면 백업할 것도 없다 — 배지를 띄우지 않는다.
    expect(w.exportOverdue).toBe(false)
  })

  it('이번 7일에 fluent가 된 식만 newlyFluent에 담는다', () => {
    const days = [
      sprintDay('2026-07-20', [fast('2×3'), fast('2×3'), fast('2×3')]), // 2주 전 정복
      sprintDay('2026-08-01', [fast('3×4'), fast('3×4'), fast('3×4')]), // 이번 주 정복
    ]
    const w = weeklyReport(days, metaWith(null), TODAY)
    expect(w.newlyFluent).toEqual(['3×4'])
    expect(w.fluentTotal).toBe(2)
  })

  it('주간 중앙값은 정답 시도만 세고, 지난주와 나눠 센다', () => {
    const days = [
      // 지난주(7/21~7/27): 2000
      sprintDay('2026-07-25', [
        { fact: '2×3', correct: true, ms: 2000 },
        { fact: '2×4', correct: false, ms: 100 }, // 오답은 제외
      ]),
      // 이번 주(7/28~8/3): 1000·3000 → 중앙값 2000이 아니라 [1000,3000] 짝수 → 2000
      sprintDay('2026-08-01', [
        { fact: '2×3', correct: true, ms: 1000 },
        { fact: '2×5', correct: true, ms: 3000 },
      ]),
    ]
    const w = weeklyReport(days, metaWith(null), TODAY)
    expect(w.weekMedianMs).toBe(2000)
    expect(w.prevWeekMedianMs).toBe(2000)
  })

  it('유형별 정답률: 표본 10회 미만은 pct null·warn 없음, 10회 이상 90% 미만은 warn', () => {
    // 12회 중 8회 정답 = 최근 10회 기준 accuracy가 90% 미만이 되도록 뒤쪽에 오답 배치
    const graded = (date: string, tag: VerticalTag, oks: boolean[]): Day => ({
      date,
      kind: 'normal',
      sheet: oks.map((_, i) => ({
        id: `${date}-${i}`,
        kind: 'vertical' as const,
        tag,
        a: 25,
        b: 17,
        op: '+' as const,
        answer: 42,
      })),
      grades: Object.fromEntries(oks.map((ok, i) => [`${date}-${i}`, ok])),
    })
    const shaky = weeklyReport(
      [
        graded('2026-08-01', 'add2-carry', [
          true,
          true,
          true,
          true,
          true,
          false,
          false,
          false,
          true,
          true,
          true,
          false,
        ]),
      ],
      metaWith(null),
      TODAY,
    )
    const row = shaky.types.find((t) => t.tag === 'add2-carry')!
    expect(row.pct).not.toBeNull()
    expect(row.warn).toBe(true)

    const sparse = weeklyReport(
      [graded('2026-08-01', 'add2-carry', [true, true, false])],
      metaWith(null),
      TODAY,
    )
    const sparseRow = sparse.types.find((t) => t.tag === 'add2-carry')!
    expect(sparseRow.pct).toBeNull()
    expect(sparseRow.warn).toBe(false)
  })

  it('가장 느린 식: 이번 주 정답 시도를 식별로 묶은 중앙값 최대', () => {
    const days = [
      sprintDay('2026-08-01', [
        { fact: '7×8', correct: true, ms: 3000 },
        { fact: '7×8', correct: true, ms: 3400 },
        { fact: '2×3', correct: true, ms: 900 },
        { fact: '9×9', correct: false, ms: 9000 }, // 오답은 후보가 아니다
      ]),
    ]
    const w = weeklyReport(days, metaWith(null), TODAY)
    expect(w.slowest).toEqual({ fact: '7×8', medianMs: 3200 })
  })

  it('30일 미백업이면 배지, 안이면 배지 없음, 한 번도 안 했으면 배지', () => {
    const days = [sprintDay('2026-08-01', [fast('2×3')])]
    expect(weeklyReport(days, metaWith(null), TODAY).exportOverdue).toBe(true)
    expect(weeklyReport(days, metaWith('2026-07-20T10:00:00.000Z'), TODAY).exportOverdue).toBe(
      false,
    )
    expect(weeklyReport(days, metaWith('2026-06-01T10:00:00.000Z'), TODAY).exportOverdue).toBe(true)
  })
})

describe('completedCount', () => {
  it('종이 채점과 스프린트를 둘 다 한 날만 센다', () => {
    const both: Day = {
      date: '2026-08-01',
      kind: 'normal',
      sheet: [],
      grades: { a: true },
      sprint: [fast('2×3')],
    }
    const paperOnly: Day = { date: '2026-08-02', kind: 'normal', sheet: [], grades: { a: true } }
    const sprintOnly: Day = { date: '2026-08-03', kind: 'normal', sheet: [], sprint: [fast('2×3')] }
    expect(completedCount([both, paperOnly, sprintOnly])).toBe(1)
  })
})
```

- [ ] **Step 3: 실패 확인**

Run: `npx vitest run src/engine/report.test.ts`
Expected: FAIL — `./report` 모듈 없음

- [ ] **Step 4: 구현** — `src/engine/report.ts`

```ts
import type { Day, Meta } from '../data/types'
import { deriveFacts, median } from './facts'
import { deriveTypes, accuracy, OPEN_THRESHOLD, RECENT_WINDOW } from './derive'
import { diffDays, shiftDay } from './dates'
import { sprintStreak } from './streak'
import { nextCheckupDate } from './checkup'

/**
 * 리포트 집계(스펙 §4). 아무것도 저장하지 않고 매번 로그에서 재계산한다 —
 * derived를 배선하지 않는 것과 같은 원칙이다. 판정 규칙이 바뀌면 과거 주간도
 * 새 규칙으로 소급 재해석된다. deriveFacts 두 번의 비용은 실측 16ms×2다.
 */

export const EXPORT_OVERDUE_DAYS = 30

/**
 * 종이 채점과 스프린트를 **둘 다** 끝낸 날의 수(설계 §6.8). home.ts에서 이사해 왔다.
 *
 * 🔥 연속일수는 스프린트만으로 인정하는 너그러운 숫자이고, ✅는 정직한 숫자다.
 * sprint 판정은 sprintStreak과 같은 식("있고 비어 있지 않다")을 쓴다 —
 * 어긋나면 같은 날을 두고 화면이 서로 다른 말을 하게 된다.
 */
export function completedCount(days: Day[]): number {
  return days.filter(
    (d) => d.grades && Object.keys(d.grades).length > 0 && d.sprint && d.sprint.length > 0,
  ).length
}

export type WeeklyReport = {
  streak: number
  completed: number
  fluentTotal: number
  newlyFluent: string[]
  weekMedianMs: number | null
  prevWeekMedianMs: number | null
  types: { tag: string; pct: number | null; warn: boolean }[]
  slowest: { fact: string; medianMs: number } | null
  nextCheckup: string | null
  exportOverdue: boolean
}

/**
 * "이번 주" = 오늘로 끝나는 최근 7일, "지난주" = 그 앞 7일(롤링 창). 평일에 열어도
 * 창이 항상 꽉 차 있어 특수 분기가 없고, 일요일에 보면 자연히 한 주가 된다(스펙 §4).
 */
export function weeklyReport(days: Day[], meta: Meta, today: string): WeeklyReport {
  const fluentMs = meta.settings.fluentMs
  const weekStart = shiftDay(today, -6)
  const prevStart = shiftDay(today, -13)
  const inWeek = days.filter((d) => d.date >= weekStart && d.date <= today)
  const inPrev = days.filter((d) => d.date >= prevStart && d.date < weekStart)

  const factsNow = deriveFacts(days, fluentMs)
  const factsBefore = deriveFacts(
    days.filter((d) => d.date < weekStart),
    fluentMs,
  )
  const newlyFluent = Object.keys(factsNow).filter(
    (id) => factsNow[id]!.status === 'fluent' && factsBefore[id]!.status !== 'fluent',
  )
  const fluentTotal = Object.values(factsNow).filter((f) => f.status === 'fluent').length

  const correctMs = (ds: Day[]) =>
    ds
      .flatMap((d) => d.sprint ?? [])
      .filter((a) => a.correct)
      .map((a) => a.ms)

  const types = deriveTypes(days)
  const typeRows = Object.keys(types).map((tag) => {
    const state = types[tag]!
    // accuracy()는 표본 부족을 0으로 돌려준다("아직 증명되지 않음") — 리포트에서 0%로
    // 보여주면 거짓말이 되므로 표본이 찼는지를 따로 본다.
    const sampled = state.attempts.length >= RECENT_WINDOW
    const pct = sampled ? accuracy(state) : null
    return { tag, pct, warn: pct !== null && pct < OPEN_THRESHOLD }
  })

  const byFact = new Map<string, number[]>()
  for (const d of inWeek)
    for (const a of d.sprint ?? []) {
      if (!a.correct) continue
      const arr = byFact.get(a.fact) ?? []
      arr.push(a.ms)
      byFact.set(a.fact, arr)
    }
  let slowest: { fact: string; medianMs: number } | null = null
  for (const [fact, ms] of byFact) {
    const med = median(ms)!
    if (!slowest || med > slowest.medianMs) slowest = { fact, medianMs: med }
  }

  const last = meta.settings.lastExportedAt
  // ISO 타임스탬프의 앞 10자리는 UTC 날짜라 KST와 하루 어긋날 수 있다 — 30일 배지에는
  // 하루 오차가 무의미하므로 그대로 쓴다.
  const exportOverdue =
    days.length > 0 && (last === null || diffDays(last.slice(0, 10), today) >= EXPORT_OVERDUE_DAYS)

  return {
    streak: sprintStreak(days, today),
    completed: completedCount(days),
    fluentTotal,
    newlyFluent,
    weekMedianMs: median(correctMs(inWeek)),
    prevWeekMedianMs: median(correctMs(inPrev)),
    types: typeRows,
    slowest,
    nextCheckup: nextCheckupDate(days, fluentMs),
    exportOverdue,
  }
}
```

- [ ] **Step 5: 통과 확인 + 전체 검사** (home.ts의 import 교체 포함)

Run: `npx vitest run src/engine/report.test.ts && npm test && npm run build`
Expected: PASS — home.ts가 `completedCount`를 report.ts에서 가져와도 기존 동작 불변

- [ ] **Step 6: 커밋**

```bash
git add src/engine/report.ts src/engine/report.test.ts src/engine/facts.ts src/screens/home.ts
git commit -m "feat(engine): 주간 리포트 집계 추가, completedCount를 엔진으로 이사"
```

---

### Task 6: 리포트 화면 (`screens/report.ts`) + 라우터 + 홈 링크

**Files:**

- Create: `src/screens/report.ts`
- Modify: `src/main.ts:63-66` (`#/report` 분기 추가)
- Modify: `src/screens/home.ts` (지도 버튼 아래 리포트 버튼)
- Modify: `src/styles/*.css` 필요 시 (기존 `.step`·`.banner` 클래스 재사용이 원칙 — 새 클래스는 `report-` 접두사)

**Interfaces:**

- Consumes: `weeklyReport`(Task 5), `serializeBackup`·`validateBackup`(Task 2), `replaceAll`(Task 3), `deriveFacts`, `factMapHtml(facts, newlyFluent)`(기존 시그니처 그대로 — 둘째 인자가 강조 집합), `el`·`navigate`·`showError`·`clearError`·`formatDate`(ui.ts), `dayKey`
- Produces: `renderReport(root: HTMLElement): Promise<void>` — main.ts가 부른다

- [ ] **Step 1: 화면 구현** — `src/screens/report.ts`

화면 테스트는 없는 코드베이스다(로직은 Task 5에서 테스트됨). 실패 패턴 ④: 첫 `await`가 `try` 안이어야 한다.

```ts
import { getAllDays, getMeta, putMeta, replaceAll } from '../data/db'
import { dayKey } from '../engine/dates'
import { deriveFacts } from '../engine/facts'
import { weeklyReport } from '../engine/report'
import type { WeeklyReport } from '../engine/report'
import { serializeBackup, validateBackup } from '../engine/backup'
import { factMapHtml } from './fact-map'
import { clearError, el, formatDate, navigate, showError } from '../ui'
import type { Day, Meta } from '../data/types'

/** 유형 태그 → 아빠용 라벨. vertical.ts SPECS·types.ts InverseTag와 1:1이다. */
const TAG_LABELS: Record<string, string> = {
  'add2-nocarry': '받아올림 없는 두 자리 덧셈',
  'sub2-noborrow': '받아내림 없는 두 자리 뺄셈',
  'add2-carry': '받아올림 두 자리 덧셈',
  'sub2-borrow': '받아내림 두 자리 뺄셈',
  'add3-carry1': '세 자리 덧셈 (올림 1번)',
  'add3-carry2': '세 자리 덧셈 (올림 2번)',
  'sub3-borrow1': '세 자리 뺄셈 (내림 1번)',
  'sub3-borrow2': '세 자리 뺄셈 (내림 2번)',
  'sub-zero': '0이 낀 받아내림',
  'inverse-add': '□ 채우기 덧셈',
  'inverse-sub': '□ 채우기 뺄셈',
}

const sec = (ms: number) => `${(ms / 1000).toFixed(1)}초`

function shareText(w: WeeklyReport, today: string): string {
  const lines = [
    `하루치 주간 리포트 — ${formatDate(today, true)}`,
    `🔥 ${w.streak}일 연속 · ✅ ${w.completed}일 완료`,
    `구구단 ${w.fluentTotal}/81 정복${w.newlyFluent.length > 0 ? ` (이번 주 +${w.newlyFluent.length})` : ''}`,
  ]
  if (w.weekMedianMs !== null) {
    const prev = w.prevWeekMedianMs !== null ? ` (지난주 ${sec(w.prevWeekMedianMs)})` : ''
    lines.push(`반응시간 중앙값 ${sec(w.weekMedianMs)}${prev}`)
  }
  return lines.join('\n')
}

function weeklyHtml(w: WeeklyReport, mapHtml: string): string {
  const delta =
    w.weekMedianMs !== null && w.prevWeekMedianMs !== null
      ? w.prevWeekMedianMs - w.weekMedianMs
      : null
  const speedLine =
    w.weekMedianMs === null
      ? '이번 주 스프린트 기록이 아직 없어요'
      : delta !== null && delta >= 50
        ? `지난주보다 ${sec(delta)} 빨라졌어요 🚀 (중앙값 ${sec(w.weekMedianMs)})`
        : `반응시간 중앙값 ${sec(w.weekMedianMs)}`
  const typeRows = w.types
    .map((t) => {
      const label = TAG_LABELS[t.tag] ?? t.tag
      const pct = t.pct === null ? '표본 부족' : `${Math.round(t.pct * 100)}%`
      return `<li>${t.warn ? '⚠️ ' : ''}${label} — ${pct}</li>`
    })
    .join('')
  return `
    <div class="streak">🔥 ${w.streak}일 연속 &nbsp;·&nbsp; ✅ ${w.completed}일 완료</div>
    ${w.newlyFluent.length > 0 ? `<p>이번 주 새로 정복: ${w.newlyFluent.join(', ')}</p>` : ''}
    ${mapHtml}
    <p>${speedLine}</p>
    ${w.slowest ? `<p>가장 느린 식: ${w.slowest.fact} (${sec(w.slowest.medianMs)})</p>` : ''}
    ${w.types.length > 0 ? `<h2>유형별 정답률</h2><ul class="report-types">${typeRows}</ul>` : ''}
    ${w.nextCheckup ? `<p>다음 점검의 날: ${formatDate(w.nextCheckup)}</p>` : ''}
    ${w.exportOverdue ? `<div class="banner">백업한 지 30일이 넘었어요 — 아래에서 내보내기를 눌러주세요</div>` : ''}
  `
}

async function handleExport(days: Day[], meta: Meta, today: string): Promise<void> {
  const json = serializeBackup(days, meta, new Date().toISOString())
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `haruchi-${today}.json`
  a.click()
  // 즉시 revoke하면 일부 브라우저에서 다운로드가 끊긴다 — 넉넉히 뒤로 미룬다.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
  // 다운로드 "완료"는 브라우저가 알려주지 않는다. 여기 기록되는 것은 "시도했음"이다.
  await putMeta({
    ...meta,
    settings: { ...meta.settings, lastExportedAt: new Date().toISOString() },
  })
}

export async function renderReport(root: HTMLElement): Promise<void> {
  try {
    const meta = await getMeta()
    const days = await getAllDays()
    const today = dayKey(new Date())
    const w = weeklyReport(days, meta, today)
    const facts = deriveFacts(days, meta.settings.fluentMs)

    root.replaceChildren(
      el(`
        <div>
          <h1>주간 리포트</h1>
          <div class="date">${formatDate(today, true)}</div>
          ${weeklyHtml(w, factMapHtml(facts, new Set(w.newlyFluent)))}
          <div id="confirm"></div>
          ${typeof navigator.share === 'function' ? '<button class="step" id="share">공유하기</button>' : ''}
          <button class="step" id="export">데이터 내보내기 (백업)</button>
          <button class="step" id="import">가져오기 (복구)</button>
          <input type="file" id="import-file" accept="application/json,.json" hidden />
          <button class="step" id="back">← 홈</button>
        </div>
      `),
    )

    root.querySelector('#back')!.addEventListener('click', () => navigate('#/'))
    root.querySelector('#share')?.addEventListener('click', () => {
      // 사용자가 공유 시트를 닫는 것은 실패가 아니다(AbortError) — 조용히 무시한다.
      navigator.share({ text: shareText(w, today) }).catch(() => {})
    })

    root.querySelector('#export')!.addEventListener('click', () => {
      const at = location.hash
      handleExport(days, meta, today)
        .then(() => {
          if (location.hash !== at) return
          void renderReport(root) // 배지·lastExportedAt 갱신 반영
        })
        .catch((e) => {
          if (location.hash !== at) return
          showError(`내보내지 못했어요: ${(e as Error).message}`)
        })
    })

    const fileInput = root.querySelector<HTMLInputElement>('#import-file')!
    root.querySelector('#import')!.addEventListener('click', () => fileInput.click())
    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0]
      if (!file) return
      const at = location.hash
      void file.text().then((text) => {
        if (location.hash !== at) return
        let raw: unknown
        try {
          raw = JSON.parse(text)
        } catch {
          showError('JSON 파일이 아니에요. 하루치에서 내보낸 파일을 골라주세요.')
          return
        }
        const v = validateBackup(raw)
        if (!v.ok) {
          showError(`백업 파일이 아니에요: ${v.reason}`)
          return
        }
        clearError()
        // 화면 내 2단계 확인: 무엇을 무엇으로 덮는지 숫자로 보여준다(스펙 §3).
        const range =
          v.days.length > 0 ? ` (${v.days[0]!.date} ~ ${v.days[v.days.length - 1]!.date})` : ''
        const confirm = root.querySelector('#confirm')!
        confirm.replaceChildren(
          el(`
            <div class="banner">
              이 백업: ${v.days.length}일치${range}<br />
              현재 기록 ${days.length}일치를 <strong>완전히 대체</strong>합니다. 병합하지 않아요.<br />
              <button class="step" id="confirm-replace">현재 기록을 지우고 복구</button>
              <button class="step" id="confirm-cancel">취소</button>
            </div>
          `),
        )
        confirm.querySelector('#confirm-cancel')!.addEventListener('click', () => {
          confirm.replaceChildren()
          fileInput.value = ''
        })
        confirm.querySelector('#confirm-replace')!.addEventListener('click', () => {
          replaceAll(v.days, v.meta)
            .then(() => {
              if (location.hash !== at) return
              navigate('#/')
            })
            .catch((e) => {
              // replaceAll은 원자적이다 — 실패해도 기존 데이터는 그대로다(db.test가 증명).
              if (location.hash !== at) return
              showError(`복구하지 못했어요 (기존 기록은 그대로예요): ${(e as Error).message}`)
            })
        })
      })
    })
  } catch (e) {
    showError(`리포트를 열지 못했어요: ${(e as Error).message}`)
    root.replaceChildren(el(`<div><button class="step" id="back">← 홈</button></div>`))
    root.querySelector('#back')!.addEventListener('click', () => navigate('#/'))
  }
}
```

- [ ] **Step 2: 라우터 분기** — `src/main.ts`의 `#/map` 분기 다음에

```ts
} else if (hash.startsWith('#/report')) {
  const { renderReport } = await import('./screens/report')
  await renderReport(app)
}
```

- [ ] **Step 3: 홈 링크** — `home.ts`의 지도 버튼 아래

```html
<button class="step" id="report">주간 리포트</button>
```

```ts
root.querySelector('#report')!.addEventListener('click', () => navigate('#/report'))
```

- [ ] **Step 4: 검사 + 수동 확인**

Run: `npm test && npm run build`
수동: `npm run dev` → `http://localhost:5173/haruchi/#/report`에서 (a) 빈 데이터로 죽지 않음 (b) 내보내기 탭 → JSON 다운로드 + 배지 사라짐 (c) 그 파일 가져오기 → 확인 패널 숫자 표시 → 교체 → 홈 (d) 깨진 JSON 파일 → 구체적 사유 배너

- [ ] **Step 5: 커밋**

```bash
git add src/screens/report.ts src/main.ts src/screens/home.ts src/styles
git commit -m "feat(screens): 주간 리포트 화면 — 공유·내보내기·가져오기의 집"
```

---

### Task 7: 일요일 자동 전환 (`grade.ts`) + `weekdayOf`

**Files:**

- Modify: `src/engine/dates.ts` (weekdayOf 추가)
- Modify: `src/engine/dates.test.ts` (케이스 추가)
- Modify: `src/screens/grade.ts:169` (저장 성공 후 이동)

**Interfaces:**

- Consumes: 기존 `parseKey`(dates.ts 내부)
- Produces: `weekdayOf(key: string): number` — 0 = 일요일

- [ ] **Step 1: 실패하는 테스트** — `dates.test.ts`에 추가

```ts
describe('weekdayOf', () => {
  it('요일을 돌려준다 — 0이 일요일', () => {
    expect(weekdayOf('2026-08-02')).toBe(0) // 일
    expect(weekdayOf('2026-08-03')).toBe(1) // 월
    expect(weekdayOf('2026-08-08')).toBe(6) // 토
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/engine/dates.test.ts`
Expected: FAIL — `weekdayOf` 미정의

- [ ] **Step 3: 구현** — `dates.ts`

```ts
/** 날짜 키의 요일. 0 = 일요일. 벽시계가 아니라 키의 요일이다 — 새벽 채점은 전날 몫. */
export function weekdayOf(key: string): number {
  return parseKey(key).getDay()
}
```

- [ ] **Step 4: grade.ts 이동 변경** — 저장 성공 경로의 `navigate('#/')`를

```ts
// 일요일 채점을 저장하면 주간 리포트로 간다(설계 §8) — 아빠가 "리포트 봐야지"를 기억할
// 필요를 없앤다. 오늘이 아니라 **채점한 날**(target)의 요일을 본다: 일요일 것을 월요일에
// 늦게 채점해도 그 주가 막 끝난 참이라 리포트가 맞는 행동이다.
navigate(weekdayOf(target) === 0 ? '#/report' : '#/')
```

import에 `weekdayOf` 추가.

- [ ] **Step 5: 검사 + 커밋**

Run: `npm test && npm run build`

```bash
git add src/engine/dates.ts src/engine/dates.test.ts src/screens/grade.ts
git commit -m "feat(screens): 일요일 채점 저장 후 주간 리포트로 자동 전환"
```

---

### Task 8: 점검 스프린트 배선 (`sprint.ts` + `home.ts`)

**Files:**

- Modify: `src/screens/sprint.ts` (renderSprint·runSession·renderResult)
- Modify: `src/screens/home.ts` (스프린트 버튼 3-상태)

**Interfaces:**

- Consumes: `checkupDue`, `composeCheckup` (Task 4)
- Produces: 화면 동작뿐. `runSession`에 `checkup: boolean` 인자, `renderResult`에 `checkup = false` 인자가 늘어난다 (둘 다 sprint.ts 내부 함수)

- [ ] **Step 1: renderSprint 분기** — `sprint.ts`

import에 `checkupDue, composeCheckup`(../engine/checkup) 추가. 기존 결과-표시 경로와 큐 구성 경로를 다음으로 바꾼다:

```ts
if (existing?.sprint && existing.sprint.length > 0) {
  const facts = deriveFacts(days, meta.settings.fluentMs)
  renderResult(
    root,
    facts,
    new Set(),
    existing.sprint,
    previousMean(days, today),
    null,
    existing.kind === 'checkup',
  )
  return
}

const facts = deriveFacts(days, meta.settings.fluentMs)
// 점검이 due면 오늘 스프린트는 점검이다(스펙 §5). 적응 off — fluent 식을 한 번씩.
const checkup = checkupDue(days, meta.settings.fluentMs, today)
const queue = checkup
  ? composeCheckup(facts, meta.settings.sprintCount)
  : composeSprint({ facts, count: meta.settings.sprintCount, today })
if (queue.length === 0) {
  backOnly(root, '오늘 낼 문제를 만들지 못했어요.')
  return
}

runSession(root, queue, facts, days, today, existing, meta.settings.fluentMs, checkup)
```

- [ ] **Step 2: runSession — 재투입 끄기와 checkup 저장**

시그니처에 `checkup: boolean` 추가. `submit()`의 재투입 블록을:

```ts
// 점검은 측정이지 훈련이 아니다 — 재투입하지 않는다. 틀린 식은 derive가 learning으로
// 내리고 내일의 일반 스프린트가 드릴한다(스펙 §5). 정답 reveal은 점검에서도 보여준다.
if (!checkup && !requeued.has(current)) {
  requeued.add(current)
  queue = requeueWrong(queue, current)
  total++
}
```

`finish()`의 Day 구성을:

```ts
// existing 스프레드는 kind를 보존한다 — 점검이면 명시로 덮는다. kind:'checkup'의
// 유일한 생산 지점이다. 이 표시가 월간 리포트의 점검 세션 식별자다.
const day: Day = existing
  ? { ...existing, kind: checkup ? 'checkup' : existing.kind, sprint: attempts }
  : { date: today, kind: checkup ? 'checkup' : 'normal', sheet: [], sprint: attempts }
```

`finish()` 안의 `renderResult` 호출 **모두**(마지막 호출과 `retrySave` 성공 경로의 호출)에 `checkup` 인자를 넘긴다. `retrySave` 쪽은 onRetry 자리에 `null`을 명시해야 한다: `renderResult(root, after, newly, attempts, previousMean(days, today), null, checkup)`.

- [ ] **Step 3: renderResult — 월간 리포트 버튼**

시그니처 끝에 `checkup = false` 추가. 버튼 영역을:

```ts
${checkup ? '<button class="step" id="report">월간 리포트 보기</button>' : ''}
${onRetry ? '<button class="step" id="retry">저장 다시 시도</button>' : ''}
<button class="step" id="back">← 홈</button>
```

```ts
root.querySelector('#report')?.addEventListener('click', () => navigate('#/report'))
```

- [ ] **Step 4: 홈 버튼 3-상태** — `home.ts`

import에 `checkupDue`(../engine/checkup) 추가. renderHome에서 `sprinted` 아래에 `const checkup = checkupDue(days, meta.settings.fluentMs, today)`를 계산하고, 스프린트 버튼 마크업을:

```ts
${
  todayDay?.kind === 'checkup' && sprinted
    ? `<button class="step done" id="sprint">✓ 오늘 점검 완료<small>정복한 식을 다시 확인했어요</small></button>`
    : checkup
      ? `<button class="step" id="sprint">🔍 점검 스프린트<small>정복한 식을 다시 확인해요</small></button>`
      : `<button class="step ${sprinted ? 'done' : ''}" id="sprint">${sprinted ? '✓ ' : ''}구구단 스프린트<small>${meta.settings.sprintCount}문제 · 3분</small></button>`
}
```

리스너는 그대로 `#/sprint` — 점검 완료 후 탭하면 renderSprint의 기존-결과 경로가 점검 결과를 보여준다.

- [ ] **Step 5: 검사 + 수동 확인**

Run: `npm test && npm run build`
수동: dev 서버에서 IndexedDB에 28일 전 fluent 로그를 만들기 어렵다 — `checkupDue` 단위 테스트(Task 4)가 스케줄을, 여기서는 (a) 일반 날 스프린트가 기존과 동일 (b) 홈 버튼 문구 세 상태가 코드 경로대로인지 눈으로 확인

- [ ] **Step 6: 커밋**

```bash
git add src/screens/sprint.ts src/screens/home.ts
git commit -m "feat(screens): 점검 스프린트 — 적응·재투입 off, kind:'checkup' 저장"
```

---

### Task 9: 월간 리포트 (점검 결과 섹션)

**Files:**

- Modify: `src/engine/report.ts` (latestCheckupReport 추가)
- Modify: `src/engine/report.test.ts` (케이스 추가)
- Modify: `src/screens/report.ts` (월간 섹션 렌더)

**Interfaces:**

- Consumes: `deriveFacts`, `median` (facts.ts)
- Produces:

```ts
export type CheckupReport = {
  date: string
  kept: string[] // 점검 전 fluent였고 점검 후에도 fluent
  dropped: string[] // 점검 전 fluent였는데 점검이 끌어내린 식
  medianMs: number | null // 점검 세션 정답 중앙값
  prevMedianMs: number | null // 직전 점검 세션 (두 번째 점검부터)
}
export function latestCheckupReport(days: Day[], fluentMs: number): CheckupReport | null
```

- [ ] **Step 1: 실패하는 테스트** — `report.test.ts`에 추가

```ts
describe('latestCheckupReport', () => {
  const FLUENT_MS = 2500
  const fluentBy = (date: string, fact: string): Day => ({
    date,
    kind: 'normal',
    sheet: [],
    sprint: [
      { fact, correct: true, ms: 800 },
      { fact, correct: true, ms: 800 },
      { fact, correct: true, ms: 800 },
    ],
  })

  it('점검한 날이 없으면 null', () => {
    expect(latestCheckupReport([fluentBy('2026-08-01', '2×3')], FLUENT_MS)).toBeNull()
  })

  it('점검 세션이 유지/탈락을 가른다', () => {
    const days: Day[] = [
      fluentBy('2026-08-01', '2×3'),
      fluentBy('2026-08-02', '7×8'),
      {
        date: '2026-08-30',
        kind: 'checkup',
        sheet: [],
        sprint: [
          { fact: '2×3', correct: true, ms: 900 },
          { fact: '7×8', correct: false, ms: 5000 },
        ],
      },
    ]
    const r = latestCheckupReport(days, FLUENT_MS)!
    expect(r.date).toBe('2026-08-30')
    expect(r.kept).toEqual(['2×3'])
    expect(r.dropped).toEqual(['7×8'])
    expect(r.medianMs).toBe(900) // 정답 시도만
    expect(r.prevMedianMs).toBeNull()
  })

  it('두 번째 점검부터 직전 점검과 비교한다', () => {
    const checkup = (date: string, ms: number): Day => ({
      date,
      kind: 'checkup',
      sheet: [],
      sprint: [{ fact: '2×3', correct: true, ms }],
    })
    const days = [
      fluentBy('2026-08-01', '2×3'),
      checkup('2026-08-29', 1200),
      checkup('2026-09-26', 950),
    ]
    const r = latestCheckupReport(days, FLUENT_MS)!
    expect(r.date).toBe('2026-09-26')
    expect(r.medianMs).toBe(950)
    expect(r.prevMedianMs).toBe(1200)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/engine/report.test.ts`
Expected: FAIL — `latestCheckupReport` 미정의

- [ ] **Step 3: 구현** — `report.ts`에 추가

```ts
export type CheckupReport = {
  date: string
  kept: string[]
  dropped: string[]
  medianMs: number | null
  prevMedianMs: number | null
}

/**
 * 가장 최근 점검의 재검증 결과(스펙 §6). 점검 전날까지의 fluent 집합과 점검일까지의
 * 집합을 비교한다 — 두 파생의 차이는 정확히 점검 세션의 시도들이다(점검의 날엔 스프린트가
 * 점검 하나뿐이므로). 저장하지 않는다: 판정 규칙이 바뀌면 과거 점검도 소급 재해석된다.
 */
export function latestCheckupReport(days: Day[], fluentMs: number): CheckupReport | null {
  const checkups = days.filter((d) => d.kind === 'checkup' && d.sprint && d.sprint.length > 0)
  const latest = checkups[checkups.length - 1]
  if (!latest) return null

  const before = deriveFacts(
    days.filter((d) => d.date < latest.date),
    fluentMs,
  )
  const upto = deriveFacts(
    days.filter((d) => d.date <= latest.date),
    fluentMs,
  )
  const wasFluent = Object.keys(before).filter((id) => before[id]!.status === 'fluent')

  const sessionMedian = (d: Day) =>
    median((d.sprint ?? []).filter((a) => a.correct).map((a) => a.ms))
  const prev = checkups[checkups.length - 2]

  return {
    date: latest.date,
    kept: wasFluent.filter((id) => upto[id]!.status === 'fluent'),
    dropped: wasFluent.filter((id) => upto[id]!.status !== 'fluent'),
    medianMs: sessionMedian(latest),
    prevMedianMs: prev ? sessionMedian(prev) : null,
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/engine/report.test.ts`
Expected: PASS

- [ ] **Step 5: 화면 섹션** — `screens/report.ts`

`renderReport`에서 `const c = latestCheckupReport(days, meta.settings.fluentMs)`를 계산하고(import 추가), `weeklyHtml(…)` 아래·`#confirm` 위에 삽입:

```ts
${
  c
    ? `
  <h2>월간 — ${formatDate(c.date)} 점검</h2>
  <p>정복 유지 ${c.kept.length}개 · 다시 연습 ${c.dropped.length}개</p>
  ${
    c.dropped.length > 0
      ? `<p>다시 연습할 식: ${c.dropped.join(', ')} — 다음 스프린트가 자동으로 다뤄요</p>`
      : ''
  }
  ${
    c.medianMs !== null
      ? `<p>점검 반응시간 ${sec(c.medianMs)}${c.prevMedianMs !== null ? ` (지난 점검 ${sec(c.prevMedianMs)})` : ''}</p>`
      : ''
  }
`
    : ''
}
```

- [ ] **Step 6: 검사 + 커밋**

Run: `npm test && npm run build`

```bash
git add src/engine/report.ts src/engine/report.test.ts src/screens/report.ts
git commit -m "feat: 월간 리포트 — 점검 재검증 결과 섹션"
```

---

### Task 10: 시뮬레이션 보강 (requeueWrong + 점검)

Phase 2가 명시적으로 미룬 커버리지: 실제 세션은 30+W문제인데 시뮬레이션은 항상 30이었다. 점검의 날 삽입도 함께 건다.

**Files:**

- Modify: `src/engine/simulation.test.ts` (`runSprints` 확장 + 테스트 2개 추가 + worstGap 헬퍼 추출)

**Interfaces:**

- Consumes: `requeueWrong`(facts.ts), `checkupDue`·`composeCheckup`(Task 4)
- Produces: 없음 (테스트 전용)

- [ ] **Step 1: worstGap 헬퍼 추출**

기존 '간격 반복이 오래된 식을 굶기지 않는다' 테스트의 등장-간격 계산(seenOn 구축 + worstGap 루프)을 describe 상단의 헬퍼로 추출한다. 기존 테스트의 단언·상한(18, 21)은 그대로 둔다:

```ts
/** 식별 등장 날짜 인덱스(같은 날 중복은 하루로)와 연속 등장 사이 최대 간격. */
function appearanceGaps(log: Day[]): {
  seenOn: Record<string, number[]>
  worstGap: number
  worstId: string
} {
  const seenOn: Record<string, number[]> = {}
  log.forEach((day, i) => {
    for (const a of day.sprint ?? []) {
      const at = (seenOn[a.fact] ??= [])
      if (at[at.length - 1] !== i) at.push(i)
    }
  })
  let worstGap = 0
  let worstId = ''
  for (const id of Object.keys(seenOn)) {
    const at = seenOn[id]!
    for (let i = 1; i < at.length; i++) {
      if (at[i]! - at[i - 1]! > worstGap) {
        worstGap = at[i]! - at[i - 1]!
        worstId = id
      }
    }
  }
  return { seenOn, worstGap, worstId }
}
```

Run: `npx vitest run src/engine/simulation.test.ts` — 기존 테스트가 여전히 통과하는지(추출이 동작 불변임을) 확인.

- [ ] **Step 2: runSprints 확장**

`queue.map`을 실제 세션 루프로 바꾼다. 새 옵션은 전부 optional — 기존 테스트는 무변경으로 같은 로그를 만든다(재투입 없을 때 루프는 map과 동일하다):

```ts
function runSprints(options: {
  days: number
  seed: number
  correctRate: number
  fluentMs: number
  ms: () => number
  /** 실제 화면처럼 오답을 세션 뒤에 재투입한다(식당 한 번). */
  requeue?: boolean
  /** 28일마다 점검의 날을 끼운다(화면과 같은 checkupDue → composeCheckup 경로). */
  checkups?: boolean
}) {
  const rand = lcg(options.seed)
  const log: Day[] = []
  const fluentCounts: number[] = []

  for (let d = 0; d < options.days; d++) {
    const date = shiftDay('2026-08-01', d)
    const facts = deriveFacts(log, options.fluentMs)
    const isCheckup = Boolean(options.checkups) && checkupDue(log, options.fluentMs, date)
    let queue = isCheckup
      ? composeCheckup(facts, 30, rand)
      : composeSprint({ facts, count: 30, today: date, rand })

    const attempts: SprintAttempt[] = []
    const requeued = new Set<string>()
    while (queue.length > 0) {
      const fact = queue.shift()!
      const correct = rand() < options.correctRate
      attempts.push({ fact, correct, ms: options.ms() })
      // sprint.ts submit()과 같은 규칙: 점검은 재투입하지 않고, 식당 최대 한 번.
      if (!correct && !isCheckup && options.requeue && !requeued.has(fact)) {
        requeued.add(fact)
        queue = requeueWrong(queue, fact)
      }
    }

    log.push({ date, kind: isCheckup ? 'checkup' : 'normal', sheet: [], sprint: attempts })
    fluentCounts.push(
      Object.values(deriveFacts(log, options.fluentMs)).filter((f) => f.status === 'fluent').length,
    )
  }
  return { log, fluentCounts }
}
```

import에 `requeueWrong`(./facts), `checkupDue, composeCheckup`(./checkup), `SprintAttempt` 타입을 추가한다.

Run: `npx vitest run src/engine/simulation.test.ts` — 기존 테스트 무변경 통과 확인.

- [ ] **Step 3: 새 테스트 — 재투입**

```ts
it('재투입을 켜면 세션이 30+W문제가 되고, 굶주림 상한은 유지된다', () => {
  const sim = runSprints({
    days: 60,
    seed: 11,
    correctRate: 0.9,
    fluentMs: 2500,
    ms: () => 1200,
    requeue: true,
  })
  // 재투입이 실제로 모델링됐다는 자기증명 — 오답률 10%면 30문제를 넘는 날이 반드시 있다.
  expect(sim.log.some((d) => (d.sprint?.length ?? 0) > 30)).toBe(true)
  // 식당 한 번만 재투입하므로 상한은 60이다.
  expect(sim.log.every((d) => (d.sprint?.length ?? 0) <= 60)).toBe(true)

  const { worstGap, worstId } = appearanceGaps(sim.log)
  expect(worstGap, `가장 오래 굶은 식: ${worstId}`).toBeLessThanOrEqual(18)
})
```

- [ ] **Step 4: 새 테스트 — 점검 삽입**

```ts
it('4주마다 점검이 끼어도 정복이 무너지지 않고 굶주림 상한이 유지된다', () => {
  const sim = runSprints({
    days: 120,
    seed: 2026,
    correctRate: 0.97,
    fluentMs: 2500,
    ms: () => 1200,
    requeue: true,
    checkups: true,
  })
  // 점검이 실제로 발생했다는 자기증명.
  const checkupDays = sim.log.filter((d) => d.kind === 'checkup').length
  expect(checkupDays).toBeGreaterThanOrEqual(3) // 120일이면 fluent 발생 후 최소 3회

  // 기존 '빠르고 정확한 아이' 테스트와 같은 판정: 봉우리 도달 + 끝자락 바닥.
  expect(sim.fluentCounts).toContain(81)
  for (const n of sim.fluentCounts.slice(-40)) {
    expect(n).toBeGreaterThanOrEqual(75)
  }

  const { worstGap, worstId } = appearanceGaps(sim.log)
  expect(worstGap, `가장 오래 굶은 식: ${worstId}`).toBeLessThanOrEqual(18)
})
```

- [ ] **Step 5: 실행·실측 — 상한이 깨지면 조사부터**

Run: `npx vitest run src/engine/simulation.test.ts`

점검의 날엔 fluent만 나오므로 learning 식의 등장 간격이 하루씩 밀릴 수 있다(28일마다 최대 +1). 실측 상한(15~16)이 17로 나올 수 있고, 그 경우 **원인을 로그로 확인한 뒤** 상한을 19로 올리되(결함 주입값 20 미만 유지) 주석에 새 실측값과 사유를 기록한다. `toContain(81)`·바닥 75 단언이 깨질 때도 같은 절차다 — 점검의 날이 드릴 하루를 대체하므로 정복 도달이 며칠 늦어질 수는 있어도(120일 안에서 흡수돼야 정상) 바닥이 무너지면 결함이다. 확인 없이 상한만 조정하는 것은 실패 패턴 ②다.

- [ ] **Step 6: 전체 검사 + 커밋**

Run: `npm test && npm run build`

```bash
git add src/engine/simulation.test.ts
git commit -m "test(engine): 시뮬레이션에 재투입과 점검의 날을 모델링한다"
```

---

### Task 11: 스테일 주석 정정 + 인수인계 갱신

**Files:**

- Modify: `src/engine/derive.ts:18,24` ("(Phase 3)" 참조 2곳)
- Modify: `src/screens/fact-map.ts:11-12` (인쇄물 언급)
- Modify: `src/data/types.ts:134` (`Meta.derived` 주석의 "Phase 3에서도 그대로다")
- Modify: `docs/superpowers/HANDOFF.md`

**Interfaces:** 없음 (문서·주석만)

- [ ] **Step 1: 주석 정정**

- `derive.ts` 18행: "해결은 잘라내기가 아니라 숙련 사실 자체를 저장하는 쪽(Phase 3)으로 간다" → "…저장하는 쪽으로 간다(실측상 5년치도 비용이 없어 Phase 4 이후로 미룬다)"
- `derive.ts` 24행: "배선은 Phase 3으로 간다" → "배선은 Phase 4 이후로 간다(Phase 3은 리포트·점검에 집중했다)"
- `fact-map.ts` 11-12행: "Phase 3의 주간 리포트가 이 격자를 그대로 인쇄물에 쓴다" → "주간 리포트 화면이 이 격자를 재사용하고, 인쇄물(Phase 4)도 그대로 쓸 수 있다"
- `types.ts` 134행: "Phase 3에서도 그대로다" → "리포트(Phase 3)도 저장 없이 매번 재계산한다 — 그대로다"

- [ ] **Step 2: HANDOFF.md 갱신**

Phase 3 완료를 반영한다: 상태 표(Phase 3 완료, 테스트 수 갱신), "Phase 3이 만든 것" 절 신설(발행 origin, persist, 백업 왕복, 리포트 재계산 원칙, kind:'checkup' 의미, 점검 강등 없음), 미해결 항목에서 해소된 것(발행, 저장 영속성, lastExportedAt) 제거, 아이패드 실물 확인의 현재 상태 기록.

- [ ] **Step 3: 포맷 + 검사 + 커밋**

Run: `npm run format && npm test && npm run build`

```bash
git add -A
git commit -m "docs: Phase 3 완료를 주석과 인수인계에 반영"
```

---

## 최종 리뷰

전 태스크 완료 후 superpowers:requesting-code-review로 Phase 전체 리뷰를 받는다. 특히 이음새: (a) 점검 저장(sprint.ts) × 홈 버튼 3-상태(home.ts) × 월간 리포트(report.ts)가 `kind:'checkup'` 하나를 두고 일관되는지 (b) 가져오기(replaceAll) 후 모든 화면이 새 데이터로 렌더되는지 (c) 스펙 §5의 "점검의 날엔 점검 한 번으로 끝"이 renderSprint의 기존-결과 게이트와 실제로 맞물리는지.
