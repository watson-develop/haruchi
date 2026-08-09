# 동기화 2A(pull·병합) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 모든 기기가 서버에서 기록을 내려받아 병합한다 — 새 기기가 빈 앱이 아니게 된다.

**Architecture:** 순수 병합 엔진(`engine/merge.ts`)이 유일한 병합 주인. 로컬에 묶음
스탬프를 영속(`stamps` 스토어)하고, 쓰기 경로를 둘로 가른다(화면 `putDay` / pull
`applyPulledDay`). push는 항상 서버 행을 읽어 병합 결과를 보낸다. sheet 충돌은 병합하지
않고 날짜 단위 격리 + 부모 홈 배너로 사람이 푼다.

**Tech Stack:** 바닐라 TS + IndexedDB + Supabase REST(fetch 직접, `req()` 경유). 테스트는 vitest + fake-indexeddb.

**설계 원본:** `docs/superpowers/specs/2026-08-09-sync-phase2-design.md` (6판, 적대적
리뷰 5라운드 합의본). 이 계획과 어긋나면 **설계가 맞다.**

## Global Constraints

- 실행 코드 의존성 0개 유지 — 새 npm 패키지 금지
- 테스트는 `src/engine/`과 `src/data/db.test.ts`에만. 화면·네트워크 오케스트레이션은 테스트하지 않는다(설계 §12)
- 모든 커밋 전: `npx prettier --check .` · `npm test` · `npm run build` 통과
- `npm` 명령 전 `export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH"`
- **변이 검증 필수**: 테스트 커밋마다 구현을 일부러 틀리게 바꿔 해당 테스트만 빨개지는지 확인 후 원복
- 네트워크는 `sync.ts`의 `req()`만. `configured()` 게이트 유지 — 미설정이면 모든 진입점 no-op
- `escapeHtml` 없이 `el()` 템플릿에 들어가는 값은 리터럴뿐
- 아이 화면(`#/`·`#/sprint`·`#/map`·`#/ebs`)에 `navigate(부모 화면)` 추가 금지
- **배포 순서(§7): schema.sql을 Supabase에 먼저 적용한 뒤에만 앱을 main에 push한다.** 이 계획의 커밋은 브랜치 `sync-phase2a`에 쌓는다 — 브랜치 push는 배포를 유발하지 않는다

## 파일 구조

| 파일                         | 역할                                                                                         |
| ---------------------------- | -------------------------------------------------------------------------------------------- |
| `supabase/schema.sql`        | 서버 단일 출처 — 열·가드 트리거·RPC 개정 (수정)                                              |
| `src/engine/merge.ts`        | 병합 엔진 전체: 직렬화·sid 물질화·mergeDay/mergeMeta·sheetConflict (신설)                    |
| `src/engine/pull-cursor.ts`  | pull 커서 계산(거부 행 캡 포함) 순수 로직 (신설)                                             |
| `src/engine/backup.ts`       | `SCHEMA_VERSION` 단일 주인으로 승격, v1..2 수용, `validateDay` export (수정)                 |
| `src/engine/outbox.ts`       | `rewrite` 플래그 + OR 접기 (수정)                                                            |
| `src/data/db.ts`             | DB v3: stamps 스토어·업그레이드 시딩·putDay/putMeta 재작업·applyPulled·교체 공통 규정 (수정) |
| `src/data/sync.ts`           | push 병합-우선 재작업·pull 엔진·격리·재기준화·suspendSync (수정)                             |
| `src/screens/sprint.ts`      | sid 찍기 + 이어붙이기 저장 (수정)                                                            |
| `src/screens/print-sheet.ts` | 생성 게이트(버튼 시점 15초) + 「다시 만들기」 rewrite 표식 (수정)                            |
| `src/screens/home-parent.ts` | 격리 배너(유지/채택)·재기준화 알림 (수정)                                                    |
| `src/main.ts`                | pull 트리거 배선(시작·해시·visibilitychange·재렌더) (수정)                                   |

---

### Task 1: 서버 스키마 v2 — 열·가드·RPC 개정

**Files:**

- Modify: `supabase/schema.sql`
- Modify: `supabase/README.md` (적용 안내 한 줄)

**Interfaces:**

- Produces: `days.sheet_by/grades_by/sprint_by`, `meta.settings_at/settings_by`,
  트리거 `days_guard_version`·`meta_guard_stamp`, RPC `replace_all(p_payload, p_settings_at, p_settings_by)`,
  `rewrite_sheet(p_date, p_payload, p_rev, p_sheet_at, p_sheet_by, p_schema_version)`, 인덱스 `days_updated_at`

- [ ] **Step 1: schema.sql에 열·인덱스·백필 추가** (기존 파일 맨 아래가 아니라 해당 테이블 정의 근처, 멱등)

```sql
-- 2단계: 묶음별 승자 기기(설계 2단계 §1). 옛 클라이언트가 쓴 행은 null → 클라이언트가 ''로 읽는다.
alter table days add column if not exists sheet_by  text;
alter table days add column if not exists grades_by text;
alter table days add column if not exists sprint_by text;
-- 2단계: settings LWW의 클라이언트 시계. updated_at(서버 시계)은 pull 커서 전용으로 남는다.
alter table meta add column if not exists settings_at timestamptz;
alter table meta add column if not exists settings_by text;
-- 백필(멱등): null이면 새 기기의 기본 설정과의 타이브레이크가 복권이 된다(설계 §1).
update meta set settings_at = updated_at where settings_at is null;
-- pull 커서가 매번 훑는 열.
create index if not exists days_updated_at on days (updated_at);
```

- [ ] **Step 2: 가드 트리거 둘 추가**

```sql
-- 옛 클라이언트(schema_version을 모르는 코드)가 새 버전 행을 통째 PATCH로 되덮는 것을
-- 서버에서 막는다 — 클라이언트 가드는 정작 옛 클라이언트에 실리지 않는다(설계 §1).
create or replace function haruchi_guard_version() returns trigger
language plpgsql as $$
begin
  if new.schema_version < old.schema_version then
    raise exception 'version_downgrade';
  end if;
  return new;
end $$;
create or replace trigger days_guard_version before update on days
  for each row execute function haruchi_guard_version();

-- settings가 값으로 바뀌는데 스탬프가 전진하지 않는 UPDATE 거부. lastExportedAt은
-- 제외한다(기기 로컬 값 — 옛 클라이언트의 내보내기 PATCH가 계속 동작해야 한다).
-- replace_all 내부 UPDATE는 세션 플래그로 면제(rewrite_sheet의 set_config 패턴).
create or replace function haruchi_guard_meta_stamp() returns trigger
language plpgsql as $$
begin
  if coalesce(current_setting('haruchi.bypass_meta_guard', true), '') = 'on' then
    return new;
  end if;
  if (new.payload #- '{settings,lastExportedAt}') is distinct from
     (old.payload #- '{settings,lastExportedAt}')
     and new.settings_at is not distinct from old.settings_at then
    raise exception 'meta_stamp_stale';
  end if;
  return new;
end $$;
create or replace trigger meta_guard_stamp before update on meta
  for each row execute function haruchi_guard_meta_stamp();
```

- [ ] **Step 3: `replace_all` 개정** — 기존 함수 본문에서 네 가지를 고친다: ① days 재삽입의 `schema_version`을 `coalesce((d.value->>'schemaVersion')::int, 1)`이 아니라 **스냅샷 payload 최상위 `p_payload->>'schemaVersion'`**에서 읽는다. ② 자동 스냅샷의 `'schemaVersion', 1` 리터럴을 `coalesce((select max(schema_version) from days), 1)`로. ③ 시그니처에 `p_settings_at timestamptz default now(), p_settings_by text default ''` 추가, meta UPDATE에 `settings_at = p_settings_at, settings_by = p_settings_by` 포함. ④ meta UPDATE 직전 `perform set_config('haruchi.bypass_meta_guard', 'on', true);` — 함수 트랜잭션 한정(`true` = local)

- [ ] **Step 4: `rewrite_sheet` 개정** — 옛 시그니처를 명시적으로 drop하고 새 시그니처로:

```sql
drop function if exists rewrite_sheet(text, jsonb, bigint);
create or replace function rewrite_sheet(
  p_date text, p_payload jsonb, p_rev bigint,
  p_sheet_at timestamptz default now(), p_sheet_by text default '',
  p_schema_version int default 1
) returns void
```

본문은 기존과 같되 `sheet_at = p_sheet_at, sheet_by = p_sheet_by, schema_version = greatest(schema_version, p_schema_version)`을 쓴다. 옛 앱의 3인자 호출은 default로 해석된다(§7 혼재 호환).

- [ ] **Step 5: 컨테이너 검증** — 일회용 Postgres 16에 전체 파일을 **연속 3회** 적용(멱등) 후 SQL로 확인: `meta_stamp_stale`이 (a) settings 값 변경 + 스탬프 동결에서 발화하고 (b) lastExportedAt만 변경에서 통과하고 (c) v1 pushMeta 모사(payload 전체 PATCH, settings 동값)에서 통과하는지. `version_downgrade` 발화. `replace_all` 후 days.schema_version이 payload 값을 따르고 meta.settings_at이 인자를 따르는지. 옛 3인자 `rewrite_sheet` 호출이 동작하는지

- [ ] **Step 6: `supabase/README.md`의 「2. 스키마 적용」에 한 줄 추가** — "스키마를 고친 뒤에는 같은 파일을 다시 Run하면 된다(멱등). **2A 배포 전에 반드시 먼저 적용한다**(설계 §7)"

- [ ] **Step 7: Commit** — `feat(server): 2A 스키마 — 묶음별 기기 열·가드 트리거·RPC 스탬프 인자`

---

### Task 2: merge.ts 기초 — 직렬화·비교 원자

**Files:**

- Create: `src/engine/merge.ts`
- Test: `src/engine/merge.test.ts`

**Interfaces:**

- Produces:

  ```ts
  export type BundleStamps = {
    sheetAt: string | null
    sheetBy: string
    gradesAt: string | null
    gradesBy: string
    sprintAt: string | null
    sprintBy: string
    settingsAt?: string | null
    settingsBy?: string
  }
  export type Stamped<T> = { value: T; at: BundleStamps }
  export const EMPTY_STAMPS: BundleStamps
  export function serializeValue(v: unknown): string // 객체 키 정렬, 원소 순서 보존
  export function structuralEqual(a: unknown, b: unknown): boolean
  export function legacyKey(run: SprintAttempt[]): string // fnv1a64(각 시도 serializeValue 사전순 정렬 결합)
  ```

- [ ] **Step 1: 실패하는 테스트 작성** (`merge.test.ts`)

```ts
import { describe, it, expect } from 'vitest'
import { serializeValue, structuralEqual, legacyKey } from './merge'
import type { SprintAttempt } from '../data/types'

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
```

- [ ] **Step 2: 실행 — 실패 확인** `npx vitest run src/engine/merge.test.ts` → "Cannot find module './merge'"

- [ ] **Step 3: 구현**

```ts
import type { SprintAttempt } from '../data/types'

export type BundleStamps = {
  sheetAt: string | null
  sheetBy: string
  gradesAt: string | null
  gradesBy: string
  sprintAt: string | null
  sprintBy: string
  settingsAt?: string | null
  settingsBy?: string
}
export type Stamped<T> = { value: T; at: BundleStamps }

export const EMPTY_STAMPS: BundleStamps = {
  sheetAt: null,
  sheetBy: '',
  gradesAt: null,
  gradesBy: '',
  sprintAt: null,
  sprintBy: '',
}

/** 값 직렬화(설계 §1): 객체 키만 정렬, 배열 원소 순서 보존. jsonb 왕복(키 재배열)에 안정. */
export function serializeValue(v: unknown): string {
  if (Array.isArray(v)) return '[' + v.map(serializeValue).join(',') + ']'
  if (v !== null && typeof v === 'object') {
    const o = v as Record<string, unknown>
    return (
      '{' +
      Object.keys(o)
        .sort()
        .map((k) => JSON.stringify(k) + ':' + serializeValue(o[k]))
        .join(',') +
      '}'
    )
  }
  return v === undefined ? 'undefined' : JSON.stringify(v)
}

export function structuralEqual(a: unknown, b: unknown): boolean {
  return serializeValue(a) === serializeValue(b)
}

/** FNV-1a 64비트. 레거시 sid가 시도 30개의 직렬화 전문을 다 담으면 하루 payload가 수십 KB
 *  커지므로 해시로 줄인다 — 내용의 결정적 함수라는 성질은 그대로다(충돌 2^-64, 가족 규모 무시). */
function fnv1a64(s: string): string {
  let h = 0xcbf29ce484222325n
  for (let i = 0; i < s.length; i++) {
    h ^= BigInt(s.charCodeAt(i))
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn
  }
  return h.toString(16).padStart(16, '0')
}

/** 세션 정규화 키(설계 §1). 원소 정렬은 키 계산에만 — 저장 배열은 절대 정렬하지 않는다. */
export function legacyKey(run: SprintAttempt[]): string {
  return fnv1a64(
    run
      .map((a) => serializeValue(a))
      .sort()
      .join('\n'),
  )
}
```

- [ ] **Step 4: 통과 확인 + 변이 검증** — `serializeValue`에서 `.sort()`를 지우면 키-순서 테스트만 빨개지는지, `legacyKey`의 `.sort()`를 지우면 다중집합 테스트만 빨개지는지 확인 후 원복

- [ ] **Step 5: Commit** — `feat(engine): 병합 기초 — 값 직렬화와 세션 정규화 키`

---

### Task 3: merge.ts 스프린트 — sid 물질화와 세션 합집합

**Files:**

- Modify: `src/engine/merge.ts`
- Test: `src/engine/merge.test.ts`

**Interfaces:**

- Consumes: `legacyKey`, `serializeValue` (Task 2)
- Produces:

  ```ts
  export function materializeSids(attempts: SprintAttempt[]): SprintAttempt[]
  export function mergeSprint(
    a: SprintAttempt[] | undefined,
    b: SprintAttempt[] | undefined,
  ): SprintAttempt[] | undefined
  ```

- [ ] **Step 1: 실패하는 테스트**

```ts
import { materializeSids, mergeSprint } from './merge'

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
      [{ fact: 'l1', correct: true, ms: 1 }, s('A:100', 'z')],
    )!
    const sids = out.map((a) => a.sid!)
    expect(sids[0]!.startsWith('legacy:')).toBe(true)
    expect(sids.slice(1)).toEqual(['A:100', 'B:200', 'junk'])
  })
  it('둘 다 undefined면 undefined — 스프린트 없는 날에 빈 배열을 만들지 않는다', () => {
    expect(mergeSprint(undefined, undefined)).toBeUndefined()
  })
})
```

- [ ] **Step 2: 실행 — 실패 확인**

- [ ] **Step 3: 구현**

```ts
export function materializeSids(attempts: SprintAttempt[]): SprintAttempt[] {
  if (attempts.every((a) => typeof a.sid === 'string')) return attempts
  const out: SprintAttempt[] = []
  let i = 0
  while (i < attempts.length) {
    if (typeof attempts[i]!.sid === 'string') {
      out.push(attempts[i]!)
      i++
      continue
    }
    let j = i
    while (j < attempts.length && typeof attempts[j]!.sid !== 'string') j++
    const sid = 'legacy:' + legacyKey(attempts.slice(i, j))
    for (const a of attempts.slice(i, j)) out.push({ ...a, sid })
    i = j
  }
  return out
}

type Group = { sid: string; attempts: SprintAttempt[] }

/** 그룹 전순서(설계 §1): legacy(sid 사전순) → 일반(시작 ms, deviceId) → 기형(sid 사전순). */
function compareGroups(a: Group, b: Group): number {
  const rank = (g: Group): number => {
    if (g.sid.startsWith('legacy:')) return 0
    const ms = Number(g.sid.slice(g.sid.lastIndexOf(':') + 1))
    return Number.isFinite(ms) ? 1 : 2
  }
  const ra = rank(a),
    rb = rank(b)
  if (ra !== rb) return ra - rb
  if (ra === 1) {
    const ms = (g: Group): number => Number(g.sid.slice(g.sid.lastIndexOf(':') + 1))
    if (ms(a) !== ms(b)) return ms(a) - ms(b)
  }
  return a.sid < b.sid ? -1 : a.sid > b.sid ? 1 : 0
}

export function mergeSprint(
  a: SprintAttempt[] | undefined,
  b: SprintAttempt[] | undefined,
): SprintAttempt[] | undefined {
  if (!a?.length && !b?.length) return a === undefined && b === undefined ? undefined : (a ?? b)
  // sid는 세션 정체성이다 — "같은 sid = 같은 세션 = 한 벌만". 두 입력이 같은 sid를
  // 서로 다른 순서로 들고 있으면(legacyKey 동일) 값 직렬화 사전순 작은 쪽을 남긴다.
  const perSid = new Map<string, SprintAttempt[]>()
  for (const arr of [a, b]) {
    if (!arr?.length) continue
    const local = new Map<string, SprintAttempt[]>()
    for (const att of materializeSids(arr)) {
      if (!local.has(att.sid!)) local.set(att.sid!, [])
      local.get(att.sid!)!.push(att)
    }
    for (const [sid, atts] of local) {
      const prev = perSid.get(sid)
      if (!prev || serializeValue(atts) < serializeValue(prev)) perSid.set(sid, atts)
    }
  }
  return [...perSid.entries()]
    .map(([sid, attempts]) => ({ sid, attempts }))
    .sort(compareGroups)
    .flatMap((g) => g.attempts)
}
```

- [ ] **Step 4: 통과 확인 + 변이 검증** — `perSid`의 "작은 쪽" 비교를 큰 쪽으로 뒤집으면 어느 테스트가 빨개지는지 확인(없다면 그 케이스를 추가), `compareGroups`의 rank를 뒤집으면 순서 테스트만 빨개지는지

- [ ] **Step 5: Commit** — `feat(engine): 스프린트 세션 합집합 — sid 물질화·전순서·무손실`

---

### Task 4: merge.ts 본체 — mergeDay·mergeMeta·속성 테스트

**Files:**

- Modify: `src/engine/merge.ts`
- Test: `src/engine/merge.test.ts`

**Interfaces:**

- Consumes: Task 2·3 전부
- Produces:

  ```ts
  export function mergeDay(a: Stamped<Day>, b: Stamped<Day>): Stamped<Day>
  export function mergeMeta(a: Stamped<Meta>, b: Stamped<Meta>): Stamped<Meta>
  export function sheetConflict(a: Day, b: Day): boolean
  ```

- [ ] **Step 1: 예제 테스트 작성** — 규칙표 각 행. 핵심 케이스(전부 작성한다):

```ts
import { mergeDay, mergeMeta, sheetConflict, EMPTY_STAMPS } from './merge'
import type { Stamped, BundleStamps } from './merge'
import type { Day, Meta } from '../data/types'
import { DEFAULT_SETTINGS, emptyDerived } from '../data/types'

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
const sheetA = [
  { id: 'v1', kind: 'vertical', tag: 't', a: 1, b: 2, op: '+', answer: 3 },
] as Day['sheet']
const sheetB = [
  { id: 'v1', kind: 'vertical', tag: 't', a: 9, b: 9, op: '+', answer: 18 },
] as Day['sheet']

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
    const a = st(day({ grades: { v1: true }, mood: 'good', doneAt: 'T1' }), {
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
  })
  it('모르는 필드: 한쪽에만 있으면 남는다 (미래 스키마 통과)', () => {
    const a = st({ ...day({}), note: 'x' } as Day)
    expect((mergeDay(a, st(day({}))).value as Record<string, unknown>)['note']).toBe('x')
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
})
```

- [ ] **Step 2: 속성 테스트 작성** — mulberry32 시드 PRNG로 무작위 `Stamped<Day>` 생성기. 생성 범위: null/실재 스탬프, 빈/두 종류 sheet, grades 유무, sid/무sid/기형 sid 혼합 sprint, 모르는 필드(`x1`·`x2`), 같은 다중집합 다른 순서. **1000쌍**으로:

```ts
describe('mergeDay 속성', () => {
  it('교환: merge(a,b) = merge(b,a)', () => {
    /* serializeValue(mergeDay(a,b)) === serializeValue(mergeDay(b,a)) — value와 at 모두 */
  })
  it('멱등: merge(a,a) = a (물질화 제외 동치 — sprint는 물질화 후 비교)', () => {})
  it('결합: merge(merge(a,b),c) = merge(a,merge(b,c))', () => {})
  it('왕복: merge(merge(a,b), a) = merge(a,b)', () => {})
  it('서버 비대칭 왕복: 무sid b를 물질화 없이 재병합해도 증식 0', () => {
    // merge(merge(a,b), b) 의 sprint 길이 === merge(a,b) 의 sprint 길이
  })
  it('모르는 필드 보존: a에만 있는 필드는 결과에 있다', () => {})
})
```

각 속성의 단언은 실제 코드로 채운다(위 골격의 주석 자리) — `serializeValue`로 전체 비교.

- [ ] **Step 3: 실행 — 실패 확인**

- [ ] **Step 4: 구현**

```ts
const DAY_KNOWN = new Set(['date', 'kind', 'sheet', 'grades', 'mood', 'doneAt', 'sprint'])

type Side = 'a' | 'b'
/** 공통 규칙 2(설계 §1): null at 패배 → by 코드포인트 큰 쪽 → 값 직렬화 작은 쪽. */
function lww(
  aAt: string | null,
  aBy: string,
  aSer: string,
  bAt: string | null,
  bBy: string,
  bSer: string,
): Side {
  if (aAt !== bAt) {
    if (aAt === null) return 'b'
    if (bAt === null) return 'a'
    return aAt > bAt ? 'a' : 'b'
  }
  if (aBy !== bBy) return aBy > bBy ? 'a' : 'b'
  return aSer <= bSer ? 'a' : 'b'
}

function hasGradesBundle(d: Day): boolean {
  return (
    (d.grades !== undefined && Object.keys(d.grades).length > 0) ||
    d.mood !== undefined ||
    d.doneAt !== undefined
  )
}

function maxStampOf(s: Stamped<Day>): string | null {
  const ats = [s.at.sheetAt, s.at.gradesAt, s.at.sprintAt].filter((x): x is string => x !== null)
  return ats.length ? ats.reduce((m, x) => (x > m ? x : m)) : null
}

export function sheetConflict(a: Day, b: Day): boolean {
  return a.sheet.length > 0 && b.sheet.length > 0 && !structuralEqual(a.sheet, b.sheet)
}

export function mergeDay(a: Stamped<Day>, b: Stamped<Day>): Stamped<Day> {
  if (a.value.date !== b.value.date)
    throw new Error(`mergeDay: 다른 날짜 ${a.value.date} vs ${b.value.date}`)

  // sheet — 최초 1회만. 둘 다 실재·상이면 LWW 폴백(실행 경로에선 격리가 먼저 가로챈다).
  const aHasSheet = a.value.sheet.length > 0
  const bHasSheet = b.value.sheet.length > 0
  let sheetSide: Side
  if (aHasSheet !== bHasSheet) sheetSide = aHasSheet ? 'a' : 'b'
  else
    sheetSide = lww(
      a.at.sheetAt,
      a.at.sheetBy,
      serializeValue(a.value.sheet),
      b.at.sheetAt,
      b.at.sheetBy,
      serializeValue(b.value.sheet),
    )
  const sheetW = sheetSide === 'a' ? a : b

  // grades 묶음 — 존재 우선, 둘 다 있으면 LWW.
  const aHasG = hasGradesBundle(a.value)
  const bHasG = hasGradesBundle(b.value)
  let gradesSide: Side
  if (aHasG !== bHasG) gradesSide = aHasG ? 'a' : 'b'
  else
    gradesSide = lww(
      a.at.gradesAt,
      a.at.gradesBy,
      serializeValue([a.value.grades, a.value.mood, a.value.doneAt]),
      b.at.gradesAt,
      b.at.gradesBy,
      serializeValue([b.value.grades, b.value.mood, b.value.doneAt]),
    )
  const gradesW = gradesSide === 'a' ? a : b

  const sprint = mergeSprint(a.value.sprint, b.value.sprint)
  const sprintAt =
    [a.at.sprintAt, b.at.sprintAt]
      .filter((x): x is string => x !== null)
      .sort()
      .pop() ?? null
  const sprintBySide = lww(a.at.sprintAt, a.at.sprintBy, '', b.at.sprintAt, b.at.sprintBy, '')

  // 모르는 필드 — 필드 단위(설계 §1 규칙표): 있으면 남고, 둘 다면 스탬프 최대값 큰 쪽.
  const unknown: Record<string, unknown> = {}
  const aRec = a.value as unknown as Record<string, unknown>
  const bRec = b.value as unknown as Record<string, unknown>
  const aMax = maxStampOf(a)
  const bMax = maxStampOf(b)
  for (const k of new Set([...Object.keys(aRec), ...Object.keys(bRec)])) {
    if (DAY_KNOWN.has(k)) continue
    const inA = k in aRec
    const inB = k in bRec
    if (inA && !inB) unknown[k] = aRec[k]
    else if (!inA && inB) unknown[k] = bRec[k]
    else {
      const side = lww(aMax, '', serializeValue(aRec[k]), bMax, '', serializeValue(bRec[k]))
      unknown[k] = side === 'a' ? aRec[k] : bRec[k]
    }
  }

  const value: Day = {
    ...unknown,
    date: a.value.date,
    kind: a.value.kind === 'checkup' || b.value.kind === 'checkup' ? 'checkup' : 'normal',
    sheet: sheetW.value.sheet,
  } as Day
  if (hasGradesBundle(gradesW.value)) {
    if (gradesW.value.grades !== undefined) value.grades = gradesW.value.grades
    if (gradesW.value.mood !== undefined) value.mood = gradesW.value.mood
    if (gradesW.value.doneAt !== undefined) value.doneAt = gradesW.value.doneAt
  }
  if (sprint !== undefined) value.sprint = sprint

  return {
    value,
    at: {
      sheetAt: sheetW.at.sheetAt,
      sheetBy: sheetW.at.sheetBy,
      gradesAt: gradesW.at.gradesAt,
      gradesBy: gradesW.at.gradesBy,
      sprintAt,
      sprintBy: (sprintBySide === 'a' ? a : b).at.sprintBy,
    },
  }
}

const META_KNOWN = new Set(['derived', 'settings'])

export function mergeMeta(a: Stamped<Meta>, b: Stamped<Meta>): Stamped<Meta> {
  const strip = (s: Settings): Omit<Settings, 'lastExportedAt'> => {
    const { lastExportedAt: _drop, ...rest } = s
    return rest
  }
  const side = lww(
    a.at.settingsAt ?? null,
    a.at.settingsBy ?? '',
    serializeValue(strip(a.value.settings)),
    b.at.settingsAt ?? null,
    b.at.settingsBy ?? '',
    serializeValue(strip(b.value.settings)),
  )
  const w = side === 'a' ? a : b
  const unknown: Record<string, unknown> = {}
  const aRec = a.value as unknown as Record<string, unknown>
  const bRec = b.value as unknown as Record<string, unknown>
  for (const k of new Set([...Object.keys(aRec), ...Object.keys(bRec)])) {
    if (META_KNOWN.has(k)) continue
    if (k in aRec && !(k in bRec)) unknown[k] = aRec[k]
    else if (!(k in aRec) && k in bRec) unknown[k] = bRec[k]
    else {
      const s = lww(
        a.at.settingsAt ?? null,
        '',
        serializeValue(aRec[k]),
        b.at.settingsAt ?? null,
        '',
        serializeValue(bRec[k]),
      )
      unknown[k] = s === 'a' ? aRec[k] : bRec[k]
    }
  }
  return {
    value: { ...unknown, derived: emptyDerived(), settings: { ...w.value.settings } } as Meta,
    at: { ...EMPTY_STAMPS, settingsAt: w.at.settingsAt ?? null, settingsBy: w.at.settingsBy ?? '' },
  }
}
```

(import에 `emptyDerived`·`Settings`·`Meta`·`Day` 추가. `mergeSprint`에서 두 입력의 빈 배열 처리 — 이 코드가 Task 3과 다르게 동작하면 Task 3 쪽이 맞다.)

- [ ] **Step 5: 통과 확인 + 변이 검증 3종** — ① `lww`의 `aBy > bBy`를 `<`로 뒤집기 ② kind 단조를 `a.value.kind`로 바꾸기 ③ 출력 스탬프를 `new Date().toISOString()` 재스탬프로 바꾸기 — 각각 해당 테스트만 빨개지는지

- [ ] **Step 6: Commit** — `feat(engine): mergeDay·mergeMeta — 규칙표와 속성(교환·결합·멱등·왕복) 고정`

---

### Task 5: backup.ts — SCHEMA_VERSION 승격·v2 수용·validateDay

**Files:**

- Modify: `src/engine/backup.ts`
- Modify: `src/data/sync.ts` (SCHEMA_VERSION import로 교체)
- Test: `src/engine/backup.test.ts` (기존 파일에 추가)

**Interfaces:**

- Produces:

  ```ts
  export const SCHEMA_VERSION = 2 // 단일 주인 — sync.ts는 이것을 import
  export function validateDay(raw: unknown): { ok: true; day: Day } | { ok: false; reason: string }
  ```

- [ ] **Step 1: 실패하는 테스트**

```ts
it('v1 파일도 v2 파일도 받는다 — 상한은 SCHEMA_VERSION', () => {
  const v1 = { ...validPayload, schemaVersion: 1 }
  const v2 = { ...validPayload, schemaVersion: 2 }
  const v3 = { ...validPayload, schemaVersion: 3 }
  expect(validateBackup(v1).ok).toBe(true)
  expect(validateBackup(v2).ok).toBe(true)
  expect(validateBackup(v3).ok).toBe(false)
})
it('sid가 있으면 문자열이어야 한다 — 기형 sid가 그룹핑 전제를 깬다', () => {
  const bad = payloadWithSprint([{ fact: '2x3', correct: true, ms: 900, sid: 42 }])
  expect(validateBackup(bad).ok).toBe(false)
})
it('validateDay는 날 하나를 검증한다 — pull 행 단위 검증용', () => {
  expect(validateDay(sample).ok).toBe(true)
  expect(validateDay({ date: 1 }).ok).toBe(false)
})
```

(`validPayload`·`payloadWithSprint`·`sample`은 기존 backup.test.ts의 픽스처를 따라 실제 값으로 작성.)

- [ ] **Step 2: 실행 — 실패 확인**

- [ ] **Step 3: 구현** — `export const SCHEMA_VERSION = 2`. `backupPayload`의 리터럴을 상수로. `validateBackup`의 버전 검사를 `v >= 1 && v <= SCHEMA_VERSION`으로. 내부 day 검증 함수를 `validateDay`로 export(없다면 기존 루프 본문을 추출). sprint 시도 검사에 `('sid' in a ? typeof a.sid === 'string' : true)` 추가. `sync.ts`의 `const SCHEMA_VERSION = 1` 줄을 지우고 `import { SCHEMA_VERSION } from '../engine/backup'`으로

- [ ] **Step 4: 통과 확인 + 변이 검증** — 상한 비교를 `<= 99`로 바꾸면 버전 테스트만 빨개지는지

- [ ] **Step 5: Commit** — `feat(engine): SCHEMA_VERSION 2 — backup.ts가 단일 주인, sid 타입 검증`

---

### Task 6: outbox — rewrite 의도 플래그

**Files:**

- Modify: `src/engine/outbox.ts`
- Test: `src/engine/outbox.test.ts` (기존 파일에 추가)

**Interfaces:**

- Produces: `OutboxEntry.rewrite?: true`, `foldOutbox`가 OR로 접음

- [ ] **Step 1: 실패하는 테스트**

```ts
it('rewrite는 OR로 접힌다 — 한 표식이라도 의도를 밝혔으면 유지', () => {
  const folded = foldOutbox([
    { target: 'day:2026-08-10', bundleAt: { sheet: 'T1' }, at: 'T1', rewrite: true },
    { target: 'day:2026-08-10', bundleAt: { grades: 'T2' }, at: 'T2' },
  ])
  expect(folded[0]!.rewrite).toBe(true)
})
it('rewrite 없는 표식끼리는 플래그가 생기지 않는다', () => {
  const folded = foldOutbox([{ target: 'day:2026-08-10', bundleAt: { sheet: 'T1' }, at: 'T1' }])
  expect(folded[0]!.rewrite).toBeUndefined()
})
```

- [ ] **Step 2: 실행 — 실패 확인**

- [ ] **Step 3: 구현** — `OutboxEntry`에 `rewrite?: true` 추가. `foldOutbox` 병합부에 `if (e.rewrite) cur.rewrite = true`, 신규 생성부에 `...(e.rewrite ? { rewrite: true as const } : {})`

- [ ] **Step 4: 통과 확인 + 변이 검증**

- [ ] **Step 5: Commit** — `feat(engine): 아웃박스 rewrite 의도 플래그 — OR 접기`

---

### Task 7: db.ts DB v3 — stamps 스토어·업그레이드 시딩·device 확장

**Files:**

- Modify: `src/data/db.ts`
- Test: `src/data/db.test.ts`

**Interfaces:**

- Produces:
  ```ts
  export function getStamps(date: string): Promise<BundleStamps | null> // 'meta' 키 포함
  export type DeviceState = {
    deviceId
    deviceKey
    lastSyncAt
    seededAt
    generation: number | null
    lastPulledAt: string | null
    quarantine: string[]
  }
  ```
- 업그레이드: `DB_VERSION = 3`, `stamps` 스토어 생성, **아웃박스 표식을 fold한 뒤** 그 `bundleAt`으로 해당 날짜의 스탬프 시딩(`*By` = 자기 deviceId, 없으면 `''`)

- [ ] **Step 1: 실패하는 테스트** — fake-indexeddb로 v2 상태를 만든 뒤 v3 열기:

```ts
describe('DB v3 업그레이드', () => {
  it('아웃박스 표식이 있는 날짜는 bundleAt으로 스탬프가 시딩된다 — 미푸시 채점 보호', async () => {
    // 별도 IDBFactory에 v2 구조를 손으로 만든다: days에 sample, outbox에
    // { target: 'day:2026-08-02', bundleAt: { grades: '2026-08-08T10:00:00.000Z' }, at: '...' },
    // device에 { deviceId: 'dev1', ... }. 그런 뒤 DB_VERSION 3으로 열어 stamps를 읽는다.
    const stamps = await getStamps('2026-08-02')
    expect(stamps?.gradesAt).toBe('2026-08-08T10:00:00.000Z')
    expect(stamps?.gradesBy).toBe('dev1')
    expect(stamps?.sheetAt).toBeNull() // 표식에 없는 묶음은 null
  })
  it('표식이 없는 날짜의 스탬프는 없다(null) — 이미 push된 날', async () => {
    expect(await getStamps('2026-08-03')).toBeNull()
  })
})
describe('DeviceState v3 필드', () => {
  it('옛 상태를 읽으면 generation·lastPulledAt·quarantine이 보정된다', async () => {
    const s = await getDeviceState()
    expect(s.generation).toBeNull()
    expect(s.lastPulledAt).toBeNull()
    expect(s.quarantine).toEqual([])
  })
})
```

(기존 db.test.ts의 `resetStores` 패턴은 v3 스토어 목록으로 갱신 — `'stamps'` 추가.)

- [ ] **Step 2: 실행 — 실패 확인**

- [ ] **Step 3: 구현** — `DB_VERSION = 3`, `STORE_STAMPS = 'stamps'`. `onupgradeneeded`에서 스토어 생성 + `event.oldVersion < 3`이면 업그레이드 트랜잭션(`req.transaction`) 안에서: outbox 전체 커서로 읽기 → `foldOutbox` → `day:` target마다 `stamps.put({ ...EMPTY_STAMPS, ...(fold.bundleAt.sheet ? { sheetAt: fold.bundleAt.sheet, sheetBy: deviceId } : {}), ... }, date)`. deviceId는 같은 트랜잭션에서 device 스토어를 먼저 읽는다(없으면 `''`). `getDeviceState`의 보정에 세 필드 추가(`generation: state.generation ?? null` 등). `getStamps` export

- [ ] **Step 4: 통과 확인 + 변이 검증** — 시딩에서 fold를 빼고 첫 표식만 쓰게 바꾸면(같은 날짜 표식 2개 케이스를 테스트에 포함할 것) 해당 테스트만 빨개지는지

- [ ] **Step 5: Commit** — `feat(db): DB v3 — stamps 스토어와 업그레이드 시딩(미푸시 변경 보호)`

---

### Task 8: db.ts 쓰기 경로 1 — putDay·putMeta 병합 경유

**Files:**

- Modify: `src/data/db.ts`
- Test: `src/data/db.test.ts`

**Interfaces:**

- Consumes: `mergeDay`·`mergeMeta`·`EMPTY_STAMPS` (Task 4), `SyncBundle`
- Produces:

  ```ts
  export function putDay(day: Day, changed: SyncBundle[], opts?: { rewrite?: true }): Promise<void>
  export function putMeta(meta: Meta, changed: ('settings' | 'export')[]): Promise<void>
  ```

  (putMeta 시그니처 변경 — 기존 호출부 전부 수정: report.ts의 내보내기·되돌리기 → `['export']`, 그 외 설정 저장 경로가 있으면 `['settings']`)

- [ ] **Step 1: 실패하는 테스트**

```ts
describe('putDay 경로 1 — 병합 경유', () => {
  it('미선언 묶음은 저장본이 이긴다 — 낡은 화면 스냅샷이 pull 결과를 못 덮는다', async () => {
    await putDay({ ...sample, sprint: [{ fact: '2x3', correct: true, ms: 900, sid: 'B:100' }] }, [
      'sprint',
    ])
    // 화면이 sprint 없던 시절의 스냅샷으로 grades만 저장
    await putDay({ ...sample, grades: { v1: true } }, ['grades'])
    const stored = await getDay(sample.date)
    expect(stored?.sprint).toHaveLength(1) // sprint 생존
    expect(stored?.grades).toEqual({ v1: true })
  })
  it('선언 묶음은 지금 시각·자기 기기로 스탬프된다', async () => {
    await putDay({ ...sample, grades: { v1: true } }, ['grades'])
    const st = await getStamps(sample.date)
    expect(st?.gradesAt).not.toBeNull()
    expect(st?.gradesBy).not.toBe('')
  })
  it('쓰기·스탬프·표식이 같은 트랜잭션이다 — 표식 쓰기를 가로채 abort시키면 셋 다 남지 않는다', async () => {
    // 기존 db.test.ts의 트랜잭션 가로채기 패턴을 재사용해 outbox.add를 실패시킨 뒤
    // days·stamps 모두 이전 상태 그대로인지 단언한다
  })
  it('rewrite 옵션이 표식에 실린다', async () => {
    await putDay({ ...sample }, ['sheet'], { rewrite: true })
    const entries = await getOutbox()
    expect(entries.some((e) => e.value.rewrite === true)).toBe(true)
  })
})
describe('putMeta 선언 계약', () => {
  it("['export']는 스탬프도 표식도 남기지 않는다 — 내보내기·되돌리기는 로컬 기록", async () => {
    await putMeta({ ...defaultMeta(), settings: { ...DEFAULT_SETTINGS, lastExportedAt: 'T' } }, [
      'export',
    ])
    expect(await getStamps('meta')).toBeNull()
    expect((await getOutbox()).filter((e) => e.value.target === 'meta')).toHaveLength(0)
  })
  it("['settings']는 settingsAt을 찍고 meta 표식을 남긴다", async () => {
    await putMeta(defaultMeta(), ['settings'])
    expect((await getStamps('meta'))?.settingsAt).not.toBeNull()
    expect((await getOutbox()).some((e) => e.value.target === 'meta')).toBe(true)
  })
})
```

(트랜잭션 가로채기 테스트의 주석 자리는 기존 파일의 동일 패턴 코드를 옮겨 실제로 작성한다.)

- [ ] **Step 2: 실행 — 실패 확인**

- [ ] **Step 3: 구현** — `putDay`: 트랜잭션에 `[days, stamps, outbox, device]`. device에서 deviceId 읽기 → 저장본 day+stamps 읽기 → 입력 조립(선언 묶음만 + `date`·`kind`, 모르는 필드 제거 — `DAY_KNOWN` 밖 키는 넣지 않는다. 미선언 sheet는 `[]`, 미선언 grades/sprint는 생략) + 선언 묶음 스탬프 now/deviceId → `mergeDay(stored, input)` → 결과 day·stamps 쓰기 + 표식(기존 `bundlesOf` 로직 유지하되 `opts.rewrite` 전달). 저장본이 없으면 병합 없이 입력을 그대로(스탬프 포함) 쓴다. `putMeta`: `'settings'` 포함 시 meta 스탬프 갱신 + 표식, `'export'`만이면 meta 값만 쓴다

- [ ] **Step 4: 통과 확인 + 변이 검증** — 입력 조립에서 미선언 묶음을 통째로 싣게 바꾸면 첫 테스트만 빨개지는지. **putMeta 호출부 전수 확인**: `grep -rn "putMeta" src/` — report.ts 두 곳(`['export']`), resetAll·replaceAll 내부(교체 경로는 Task 9에서 다룬다 — 이 시점에는 컴파일만 맞춘다)

- [ ] **Step 5: Commit** — `feat(db): putDay·putMeta 병합 경유 — 선언 묶음만 싣고 저장본과 합친다`

---

### Task 9: db.ts 쓰기 경로 2 — applyPulled·통째 교체 공통 규정

**Files:**

- Modify: `src/data/db.ts`
- Test: `src/data/db.test.ts`

**Interfaces:**

- Consumes: `Stamped<Day>`·`mergeDay`·`mergeMeta`
- Produces:
  ```ts
  export function applyPulledDay(incoming: Stamped<Day>): Promise<boolean> // 로컬이 바뀌었나
  export function applyPulledMeta(incoming: Stamped<Meta>): Promise<boolean> // lastExportedAt은 로컬 값 유지
  export function replaceFromServer(
    days: Stamped<Day>[],
    meta: Stamped<Meta>,
    generation: number,
    lastPulledAt: string | null,
  ): Promise<void>
  ```
- `replaceAll`(가져오기·되돌리기): 같은 트랜잭션에서 stamps 전체 clear + `quarantine: []` + 기존 `seededAt: null` 유지
- `replaceFromServer`(재기준화): stamps를 서버 스탬프로, 아웃박스·격리 비움, `seededAt = now`, generation·lastPulledAt 기록

- [ ] **Step 1: 실패하는 테스트**

```ts
describe('applyPulledDay', () => {
  it('승자 스탬프를 보존하고 표식을 남기지 않는다 — 메아리 금지', async () => {
    const incoming = {
      value: { ...sample, grades: { v1: true } },
      at: { ...EMPTY_STAMPS, gradesAt: 'T9', gradesBy: 'other' },
    }
    await applyPulledDay(incoming)
    expect((await getStamps(sample.date))?.gradesAt).toBe('T9') // 수신 시각 재스탬프 금지
    expect(await getOutbox()).toHaveLength(0)
  })
  it('로컬이 안 바뀌면 false — 화면 재렌더 판단의 근거', async () => {
    const incoming = { value: sample, at: { ...EMPTY_STAMPS } }
    await applyPulledDay(incoming)
    expect(await applyPulledDay(incoming)).toBe(false)
  })
})
describe('applyPulledMeta', () => {
  it('lastExportedAt은 로컬 값이 유지된다 — 기기 로컬 강등(설계 §1)', async () => {
    await putMeta(
      { ...defaultMeta(), settings: { ...DEFAULT_SETTINGS, lastExportedAt: 'LOCAL' } },
      ['export'],
    )
    await applyPulledMeta({
      value: {
        ...defaultMeta(),
        settings: { ...DEFAULT_SETTINGS, lastExportedAt: 'SERVER', fluentMs: 3000 },
      },
      at: { ...EMPTY_STAMPS, settingsAt: 'T9', settingsBy: 'other' },
    })
    const meta = await getMeta()
    expect(meta.settings.fluentMs).toBe(3000) // settings는 서버 승자
    expect(meta.settings.lastExportedAt).toBe('LOCAL') // lastExportedAt은 접붙임
  })
})
describe('통째 교체 공통 규정', () => {
  it('replaceAll은 stamps와 격리 목록도 비운다 — 옛 스탬프 + 새 내용 조합 금지', async () => {
    await putDay({ ...sample, grades: { v1: true } }, ['grades'])
    await putDeviceState({ ...(await getDeviceState()), quarantine: ['2026-08-02'] })
    await replaceAll([sample], defaultMeta())
    expect(await getStamps(sample.date)).toBeNull()
    expect((await getDeviceState()).quarantine).toEqual([])
  })
  it('replaceFromServer는 서버 스탬프를 심고 seededAt을 세운다 — 재시딩 눈사태 금지', async () => {
    await replaceFromServer(
      [{ value: sample, at: { ...EMPTY_STAMPS, sheetAt: 'T1', sheetBy: 'x' } }],
      { value: defaultMeta(), at: { ...EMPTY_STAMPS } },
      3,
      'C1',
    )
    expect((await getStamps(sample.date))?.sheetAt).toBe('T1')
    const s = await getDeviceState()
    expect(s.seededAt).not.toBeNull()
    expect(s.generation).toBe(3)
    expect(await getOutbox()).toHaveLength(0)
  })
})
```

- [ ] **Step 2: 실행 — 실패 확인**

- [ ] **Step 3: 구현** — `applyPulledDay`: 트랜잭션 `[days, stamps]`(표식 없음). 저장본 없으면 그대로 쓰고 true. 있으면 merge → 결과가 저장본과 `structuralEqual`(value·stamps 모두)이면 false, 아니면 쓰고 true. `applyPulledMeta`: merge 후 결과 settings의 `lastExportedAt`을 **현재 로컬 meta의 값으로 교체**하고 쓴다. `replaceAll`: 기존 트랜잭션 스토어 목록에 stamps 추가 + clear + device의 quarantine 리셋(기존 seededAt null 유지). `replaceFromServer`: 전체 스토어 트랜잭션 — days·meta·stamps 교체, outbox clear, device `{ generation, lastPulledAt, quarantine: [], seededAt: now }`

- [ ] **Step 4: 통과 확인 + 변이 검증** — applyPulledDay에 표식을 추가하면 메아리 테스트만 빨개지는지

- [ ] **Step 5: Commit** — `feat(db): applyPulled 경로와 통째 교체 공통 규정 — 스탬프 보존·메아리 금지`

---

### Task 10: sync.ts push 재작업 — 항상 병합 결과

**Files:**

- Modify: `src/data/sync.ts`
- Test: 없음(네트워크 오케스트레이션 — 설계 §12). 검증은 전체 스위트 + 빌드 + fetch 스파이 불활성 재확인

**Interfaces:**

- Consumes: `mergeDay`·`mergeMeta`·`sheetConflict`·`Stamped`·`SCHEMA_VERSION`(backup)·`getStamps`·`OutboxEntry.rewrite`
- Produces: `rowToStampedDay(row: unknown): Stamped<Day> | null` (변환 단일 함수 — 검증 실패 시 null), 격리 헬퍼 `quarantineDate(date)`·`clearQuarantine(date)`

- [ ] **Step 1: `rowToStampedDay` 작성** — `validateDay`(Task 5)로 payload 검증, `*_at`·`*_by` → `BundleStamps`(부재·null → null·`''`)

- [ ] **Step 2: `pushDay` 재작업** — 전체 흐름을 이 순서로:

```
서버 행 조회 (payload, rev, schema_version, sheet_at.., sheet_by..)
0행 → meta generation 재확인 → 다르면 재기준화 플래그 세우고 중단 / 같으면 INSERT(rev 1, 병합 없이 로컬 + 로컬 스탬프)
행 있음:
  서버 schema_version > SCHEMA_VERSION → push 포기(표식 유지) — 클라이언트 가드
  server = rowToStampedDay(...) — 검증 실패면 포기(표식 유지)
  local = { value: getDay(date), at: getStamps(date) ?? EMPTY_STAMPS }
  rewrite 플래그 있음:
    서버 grades 있음 → 플래그 소거(표식 재작성) + quarantineDate(date) + 중단
    merged = mergeDay(local, server); payload = { ...merged.value, sheet: local.value.sheet }
    rewrite_sheet RPC (p_sheet_at = local.at.sheetAt, p_sheet_by, p_schema_version = SCHEMA_VERSION)
    응답 본문에 'sheet_rewrite_graded' → 플래그 소거 + 격리 + 중단 (rev 충돌과 본문으로 구분)
  플래그 없음:
    sheetConflict(local.value, server.value) → quarantineDate + 중단 (push 안 함)
    merged = mergeDay(local, server)
    PATCH: payload = merged.value, rev+1, schema_version = SCHEMA_VERSION, 병합 출력 *_at·*_by
    sheet_immutable 거부 → quarantineDate + 중단 (자동 rewrite 추론 삭제)
    0행(rev 충돌) → 재조회부터 재시도 (3회)
```

기존 `pushDay`의 자동 `rewriteSheet` 우회 블록(주석 포함)은 삭제한다. 존재-승리로 이긴 묶음의 스탬프가 null이면 PATCH 직전에 `now/deviceId`로 채운다(설계 §1 예외).

- [ ] **Step 3: `pushMeta` 재작업** — 서버 meta 조회 → `mergeMeta` → 송신 payload의 `settings.lastExportedAt`을 **서버에 있던 값으로 교체**(접붙임) → PATCH에 `settings_at`·`settings_by`(존재-승리 null이면 now/self) 포함

- [ ] **Step 4: 전체 검증** — `npm test`(전체 초록) + `npm run build` + **불활성 재확인**: 1단계 검증 방식대로 `sync-config`를 빈 값으로 가정한 코드 경로 검토(모든 신규 진입점이 `configured()` 뒤에 있는지 그대 확인)

- [ ] **Step 5: Commit** — `feat(sync): push는 항상 병합 결과 — 자동 rewrite 추론 삭제, sheet 충돌 격리`

---

### Task 11: pull 엔진 — 커서·검증·격리 판정·generation 관찰

**Files:**

- Create: `src/engine/pull-cursor.ts`
- Test: `src/engine/pull-cursor.test.ts`
- Modify: `src/data/sync.ts`

**Interfaces:**

- Produces:

  ```ts
  // engine/pull-cursor.ts — 순수
  export function nextCursor(
    prev: string | null,
    rows: { updatedAt: string; rejected: boolean }[],
  ): string | null
  // sync.ts
  export function pullOnce(): Promise<boolean> // 로컬이 하나라도 바뀌었나
  export function suspendSync(): Promise<void> // suspendPush 대체(pull 적용도 멈춤)
  export function resumeSync(): void
  export const PULL_OVERLAP_MS = 5 * 60 * 1000
  ```

- [ ] **Step 1: `nextCursor` 실패하는 테스트**

```ts
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
```

- [ ] **Step 2: 실행 — 실패 확인 → 구현(첫 rejected 이전 행들의 마지막 updatedAt, 없으면 prev) → 통과 + 변이 검증**

- [ ] **Step 3: `sync.ts`에 pull 본체 작성**

```
pullOnce():
  configured() && 키 있음 아니면 false
  suspendCount > 0 이면 false (파괴적 작업 중 — 적용 금지)
  days: GET ?updated_at=gt.(lastPulledAt − 5분)&order=updated_at.asc
    행마다: rowToStampedDay → null(검증 실패)이면 rejected, 경고 상태 세움
      격리 판정: local = getDay(date) 있고 sheetConflict(local, server.value) → quarantineDate, 적용 생략(판정은 계속 — rejected 아님, 커서는 전진)
      격리돼 있는데 conflict가 사라졌으면 clearQuarantine 후 적용 (자연 해제)
      applyPulledDay(server) → changed 집계
    nextCursor로 lastPulledAt 갱신 (서버 응답 updated_at만 사용)
  meta: GET 후 mergeMeta 경로 applyPulledMeta. generation 관찰:
    server.generation !== device.generation:
      device.generation == null → 채택(putDeviceState)
      아니면 rebaseNeeded = true (비행 안에서 재기준화 금지 — 종료 후 별도 태스크)
  app_config: 캐시 갱신(2B 전이지만 pull 자체는 배선 — 로컬 저장만)
  반환: changed
비행 종료 훅: rebaseNeeded면 setTimeout(0)으로 runRebase()
runRebase():
  suspendSync() → serverSnapshot('rebase') → 아웃박스 새 key 재확인(최대 2회 재스냅샷, 초과 시 중단·연기)
  → 서버 days 전체 + meta GET → rowToStampedDay 전부 → replaceFromServer(...)
  → resumeSync() → 부모 홈 알림 상태("다른 기기에서 기록이 교체되어 이 기기를 맞췄어요")
suspendSync/resumeSync: 기존 suspendPush 로직에 pull 적용 게이트 추가(pullOnce 진입·행 적용 루프에서 suspendCount 확인). 기존 suspendPush 호출부(report.ts) 이름 교체
```

INSERT 직전 generation 재확인(Task 10)이 세우는 재기준화 플래그도 같은 `runRebase`로 합류한다.

- [ ] **Step 4: 전체 검증** — `npm test` + `npm run build`. 수동 확인 목록(PR 본문에 남길 것): dev 서버에서 fetch 스파이로 pullOnce가 미설정 시 0회인지

- [ ] **Step 5: Commit** — `feat(sync): pull 엔진 — 커서·행 검증·격리 판정·재기준화`

---

### Task 12: 격리 배너와 rewrite 의도 — 부모 홈·인쇄 화면

**Files:**

- Modify: `src/screens/home-parent.ts`
- Modify: `src/screens/print-sheet.ts`
- Modify: `src/data/sync.ts` (탈출 헬퍼 export)

**Interfaces:**

- Consumes: `getDeviceState().quarantine`, `putDay(day, ['sheet'], { rewrite: true })`, `applyPulledDay`
- Produces: `sync.ts`에 `resolveKeepMine(date): Promise<'ok' | 'graded'>`·`resolveAdoptServer(date): Promise<void>`

- [ ] **Step 1: `sync.ts` 탈출 헬퍼** —
  - `resolveKeepMine(date)`: 서버 행 조회 → grades 있으면 `'graded'` 반환(배너 전환용) → 없으면 `putDay(로컬 Day, ['sheet'], { rewrite: true })`로 표식만 새로 남기고 `clearQuarantine` → push 트리거. push 쪽 rewrite 경로(Task 10)가 송신 조립·거부 처리를 맡는다
  - `resolveAdoptServer(date)`: 서버 행 조회 → `rowToStampedDay` → 로컬 Day의 sprint와 합집합은 `applyPulledDay`가 병합으로 처리하되 sheet·grades는 서버 강제: `applyPulledDay({ value: { ...server.value, sprint: mergeSprint(local?.sprint, server.value.sprint) }, at: server.at })` 후, 로컬에만 있던 sprint 세션이 있었으면 `putDay(적용 결과, ['sprint'])`로 표식 생성 → `clearQuarantine` + 그 날짜 표식의 rewrite 플래그 제거
- [ ] **Step 2: 부모 홈 배너** — `quarantine.length > 0`이면 상태줄 위에 warn 톤 블록: 날짜별 "『{date}』 다른 기기에서 문제지를 먼저 만들었어요 — 어느 종이로 채점할지 골라 주세요" + 버튼 둘 「이 기기 종이 유지」·「다른 기기 것 채택」. `resolveKeepMine`이 `'graded'`를 돌려주면 문구를 "다른 기기에서 이미 채점까지 마쳤어요"로 바꾸고 「채택」만 남긴다. 재기준화 알림 상태가 있으면 한 줄 표시. 모든 문자열은 리터럴, 날짜는 `escapeHtml`
- [ ] **Step 3: 인쇄 화면** — 「다시 만들기」의 `putDay(..., ['sheet'])`를 `putDay(..., ['sheet'], { rewrite: true })`로
- [ ] **Step 4: 검증** — `npm test`·`npm run build`·아이/부모 소속 확인(`grep -n "navigate" src/screens/home-parent.ts src/screens/print-sheet.ts` — 부모 화면끼리만인지)
- [ ] **Step 5: Commit** — `feat(screens): sheet 충돌 격리 배너 — 아빠가 종이를 고른다`

---

### Task 13: pull 트리거 배선 — main·화면·생성 게이트·스프린트 sid

**Files:**

- Modify: `src/main.ts`
- Modify: `src/screens/sprint.ts`
- Modify: `src/screens/print-sheet.ts`
- Modify: `src/data/sync.ts` (알림 콜백)

**Interfaces:**

- Consumes: `pullOnce`
- Produces: `sync.ts`에 `onPullApplied(cb: () => void): void`(재렌더 신호 — notifyOutbox 패턴 재사용), `pullAndWait(timeoutMs: number): Promise<void>`(타임아웃 지나면 그냥 돌아온다 — pull 자체는 계속)

- [ ] **Step 1: `main.ts` 배선** —
  - 앱 시작: `void pullOnce()` (배경)
  - `visibilitychange` visible: `void pullOnce()` (배경)
  - 라우팅: 부모 화면 4개(`#/parent`·`#/print`·`#/grade`·`#/report`) 진입 시 `await pullAndWait(3000)` 후 렌더. 아이 화면은 `void pullOnce()` 후 즉시 렌더
  - `onPullApplied`: 현재 해시가 **재렌더 예외가 아니면** 같은 화면 재라우팅. 예외: `#/sprint`(진행 중 세션), `#/grade`(채점 진행 중 — grade.ts의 진행 중 여부는 모듈 플래그 export로, importBusy 패턴)
- [ ] **Step 2: `sprint.ts`** — 세션 시작 시 `const sid = \`${(await getDeviceState()).deviceId}:${Date.now()}\``, 모든 attempt에 `sid`포함. 저장을 이어붙이기로:`sprint: [...(existing?.sprint ?? []), ...attempts]` (진입 가드는 그대로 — 설계 §1)
- [ ] **Step 3: `print-sheet.ts` 생성 게이트** — 「문제지 만들기」 클릭 핸들러 맨 앞에: `await pullAndWait(15000)` → 오늘 sheet가 생겼으면 생성하지 않고 재렌더 → pull 실패(서버 미도달)면 `confirmDialog("서버 확인이 안 됐어요 — 다른 기기에서 오늘 문제지를 만들었다면 겹칠 수 있어요. 그래도 만들까요?")` → 확인 후에도 **쓰기 직전 `getDay(today)` 재검사**, sheet 있으면 중단·표시
- [ ] **Step 4: 검증** — `npm test`·`npm run build`. 수동 체크리스트(PR 본문): 미설정 상태에서 화면 전이가 오늘과 동일한지(3초 대기 없음 — `configured()` false면 `pullAndWait` 즉시 반환), 아이 화면 `navigate` 추가 없음 재확인
- [ ] **Step 5: Commit** — `feat(app): pull 트리거 배선 — 부모는 기다리고 아이는 배경, 생성 게이트 15초`

---

### Task 14: 문서·전환 절차·PR

**Files:**

- Modify: `CLAUDE.md` (동기화 문단 — 2A 실사용 반영, putMeta 선언 계약 추가, applyPulled 언급)
- Modify: `docs/superpowers/HANDOFF.md` (2A 완료 기록, 2B·2C·2D 대기 목록)
- Modify: `supabase/README.md` (문제 해결 표에 격리 배너·재기준화 항목)

- [ ] **Step 1: CLAUDE.md 동기화 문단 개정** — "1단계(업로드)" 서술을 "2A(pull·병합)까지"로. `putDay(day, changed)` 불변식에 `putMeta(meta, changed)` 추가, "pull 적용은 applyPulled 별도 진입점(표식 없음)" 한 줄, "sheet 충돌은 병합하지 않고 격리한다" 한 줄
- [ ] **Step 2: HANDOFF 갱신 + README 문제 해결 표 2행 추가**
- [ ] **Step 3: 전체 검증** — `npx prettier --check .`·`npm test`·`npm run build`
- [ ] **Step 4: Commit + PR** — 브랜치 push 후 PR 생성. PR 본문에: §7 배포 순서(**머지 전에 schema.sql을 SQL Editor에서 먼저 적용**), 수동 확인 체크리스트(Task 10·13의 항목), 실기기 검증 계획(배포 후 기기 2대로 설계 §2 트리거 표 실측)

---

## 자기 검토 기록 (계획 작성자가 수행)

- 스펙 커버리지: §1(T2–T5·T8), §2(T6·T10–T13), §3(T9·T11), §7(T1 순서·T14 PR), 스키마 요약(T1), 클라이언트 요약(T5–T9), 검증 계획(각 태스크 테스트 + T1 컨테이너) — 2B·2C·2D는 이 계획 범위 밖(별도 계획)
- 미해결 위임: 없음 — "적절히", "TBD" 부재 확인
- 타입 일관성: `Stamped`·`BundleStamps`·`putMeta(meta, changed)`·`applyPulledDay` 서명이 태스크 간 동일함을 확인
