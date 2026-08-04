# 데이터 초기화 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 부모 화면(`#/report`)에 "모든 기록 지우기"를 추가해 `days`·`meta`를 한 번에 비우고 앱을 설치 직후 상태로 되돌린다.

**Architecture:** 파괴적 쓰기는 이미 검증된 `replaceAll`을 그대로 태운다(`resetAll = replaceAll([], defaultMeta())`). 확인 배너가 쓰는 사실 두 개(`daysSinceExport`·`ungradedSheetCount`)는 `engine/report.ts`의 순수 함수로 만들고 화면은 계산하지 않는다. 화면은 `screens/report.ts` 한 파일만 바뀐다.

**Tech Stack:** TypeScript, 바닐라 DOM(프레임워크 없음), IndexedDB, Vitest + fake-indexeddb, Vite

**설계 문서:** `docs/superpowers/specs/2026-08-04-data-reset-design.md`

## Global Constraints

- **Node는 mise에만 있다.** 모든 npm 명령 앞에 `export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH"`
- **작업 위치는 워크트리다**: `.claude/worktrees/data-reset/`. 브랜치 `worktree-data-reset`(main `26f659d` 기반). 다른 세션이 원래 체크아웃의 `seed-design`에서 `main.ts`·`ui.ts`·`styles/`를 만지고 있다. `git -C`로 다른 경로를 가리키지 않는다
- **`git add .`을 쓰지 않는다.** 항상 명시 경로로 add한다
- **문서를 커밋하기 전에 `npm run format`을 돌린다.** `.prettierignore`가 없어 CI의 `prettier --check .`가 마크다운까지 검사한다
- **테스트는 `src/engine/`과 `src/data/`에만 둔다.** DOM·화면 단위 테스트는 하지 않는다(설계 §12). Task 4는 자동 테스트 대신 수동 확인으로 검증한다
- **`Meta.derived`를 배선하지 않는다.** 파생값을 저장하는 코드를 새로 만들지 않는다
- **`el()` 템플릿에 들어가는 신뢰할 수 없는 값은 `escapeHtml`을 통과시킨다**
- **아이 화면(`#/`·`#/sprint`·`#/map`·`#/ebs`)으로 가는 `navigate`를 새로 만들지 않는다.** 이번 작업이 만드는 `navigate`는 `#/parent` 하나뿐이다
- 커밋 메시지는 한국어. 끝에 `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`

---

## File Structure

| 파일                        | 이번 작업에서의 책임                                                    |
| --------------------------- | ----------------------------------------------------------------------- |
| `src/data/db.ts`            | `defaultMeta()` 추출, `resetAll()` 추가 (Task 1)                        |
| `src/data/db.test.ts`       | `resetAll`·`defaultMeta` 테스트 (Task 1)                                |
| `src/engine/report.ts`      | `daysSinceExport()` 추출 (Task 2), `ungradedSheetCount()` 추가 (Task 3) |
| `src/engine/report.test.ts` | 위 두 함수 테스트 (Task 2·3)                                            |
| `src/screens/report.ts`     | 버튼·확인 배너·초기화 실행 배선 (Task 4)                                |

새 파일은 없다. 화면은 한 파일만 바뀌고 엔진·데이터 계층은 각각 함수 하나씩만 늘어난다.

---

## Task 1: `defaultMeta()` 추출과 `resetAll()`

**Files:**

- Modify: `src/data/db.ts:68-76` (`getMeta`), 파일 끝에 `resetAll` 추가
- Test: `src/data/db.test.ts`

**Interfaces:**

- Consumes: 기존 `replaceAll(days: Day[], meta: Meta): Promise<void>`, `DEFAULT_SETTINGS`, `emptyDerived()`
- Produces:
  - `export function defaultMeta(): Meta` — 한 번도 쓰지 않은 상태의 Meta. 부를 때마다 새 `friendNames` 배열을 준다
  - `export function resetAll(): Promise<void>` — 모든 `days`와 `meta`를 지운다. 원자적(실패 시 기존 데이터 보존)

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/data/db.test.ts`의 import 줄을 바꾼다:

```ts
import {
  getDay,
  putDay,
  getAllDays,
  getMeta,
  putMeta,
  replaceAll,
  resetAll,
  defaultMeta,
} from './db'
```

`describe('db', ...)` 블록 안, 마지막 `it` 뒤에 붙인다:

```ts
it('resetAll이 모든 day와 meta를 지운다', async () => {
  await putDay(sample)
  await putDay({ ...sample, date: '2026-08-01' })
  await putMeta({
    derived: emptyDerived(),
    settings: { ...DEFAULT_SETTINGS, lastExportedAt: '2026-08-01T00:00:00.000Z' },
  })

  await resetAll()

  expect(await getAllDays()).toEqual([])
  const meta = await getMeta()
  expect(meta.settings.lastExportedAt).toBeNull()
  expect(meta.settings.verticalCount).toBe(8)
  expect(meta.derived.facts).toEqual({})
})

it('defaultMeta는 부를 때마다 별개의 friendNames 배열을 준다', () => {
  const a = defaultMeta()
  const b = defaultMeta()
  a.settings.friendNames.push('철수')
  expect(b.settings.friendNames).toEqual(['지호', '민아'])
  expect(DEFAULT_SETTINGS.friendNames).toEqual(['지호', '민아'])
})
```

두 번째 테스트가 중요한 이유: 지금 `getMeta()` 주석이 경계하는 배열 공유를 추출 후에도 유지하는지 본다. `friendNames: [...DEFAULT_SETTINGS.friendNames]`를 `friendNames: DEFAULT_SETTINGS.friendNames`로 잘못 쓰면 초기화가 전역 상수를 오염시킨다.

- [ ] **Step 2: 실패를 확인한다**

```bash
export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH"
npx vitest run src/data/db.test.ts
```

Expected: FAIL — `resetAll`·`defaultMeta`가 `./db`에 없다는 에러(또는 `is not a function`)

- [ ] **Step 3: 최소 구현을 쓴다**

`src/data/db.ts`의 `getMeta`(68-76행)를 다음으로 **교체**한다:

```ts
/**
 * 한 번도 쓰지 않은 상태의 Meta. getMeta의 기본값과 resetAll이 되돌리는 상태가
 * 같은 곳에서 나와야 둘이 갈라지지 않는다.
 *
 * settings의 얕은 복사만으로는 friendNames 배열이 DEFAULT_SETTINGS와 공유된다 —
 * 별도로 복사한다.
 */
export function defaultMeta(): Meta {
  return {
    derived: emptyDerived(),
    settings: { ...DEFAULT_SETTINGS, friendNames: [...DEFAULT_SETTINGS.friendNames] },
  }
}

export async function getMeta(): Promise<Meta> {
  const meta = await run<Meta | undefined>(STORE_META, 'readonly', (s) => s.get(META_KEY))
  if (meta) return meta
  return defaultMeta()
}
```

`src/data/db.ts` **맨 끝**(`replaceAll` 뒤)에 붙인다:

```ts
/**
 * 초기화: 모든 기록과 설정을 지워 앱을 설치 직후 상태로 되돌린다
 * (설계 2026-08-04-data-reset §4). 되돌릴 수 없다.
 *
 * 새 트랜잭션 경로를 만들지 않고 replaceAll을 그대로 태운다 — put()이 동기로 던지는
 * 동안 clear()만 커밋되어 데이터가 조용히 사라지는 함정을 replaceAll이 tx.abort()로
 * 이미 막고 있고 그것이 테스트로 고정돼 있다. 두 번째 파괴적 경로는 같은 함정을
 * 다시 밟을 자리가 된다.
 */
export function resetAll(): Promise<void> {
  return replaceAll([], defaultMeta())
}
```

- [ ] **Step 4: 통과를 확인한다**

```bash
npx vitest run src/data/db.test.ts
```

Expected: PASS — 기존 테스트 전부 + 새 테스트 2개

- [ ] **Step 5: 변이 검증**

`defaultMeta`의 `friendNames: [...DEFAULT_SETTINGS.friendNames]`를 `friendNames: DEFAULT_SETTINGS.friendNames`로 바꾸고 `npx vitest run src/data/db.test.ts`를 돌린다. **`defaultMeta는 부를 때마다…` 테스트가 빨개져야 한다.** 확인 후 원복한다.

- [ ] **Step 6: 커밋**

```bash
git add src/data/db.ts src/data/db.test.ts
git commit -m "$(cat <<'EOF'
feat: resetAll — 기록과 설정을 통째로 비운다

검증된 replaceAll을 그대로 태운다. clear만 커밋되는 함정을 tx.abort()로
막은 경로가 하나뿐이어야 그 함정을 다시 밟지 않는다.

getMeta의 기본 Meta 생성을 defaultMeta()로 뽑았다 — "초기화된 상태"와
"한 번도 안 쓴 상태"가 두 곳에 따로 적히면 갈라진다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `daysSinceExport()` 추출

**Files:**

- Modify: `src/engine/report.ts:115-126` (`weeklyReport` 내부의 `last`·`lastDiff`·`exportOverdue`)
- Test: `src/engine/report.test.ts`

**Interfaces:**

- Consumes: 기존 `diffDays(from: string, to: string): number` (`./dates`), `EXPORT_OVERDUE_DAYS = 30`
- Produces: `export function daysSinceExport(meta: Meta, today: string): number | null` — 마지막 백업 이후 지난 일수. 백업한 적이 없거나 값이 날짜로 파싱되지 않으면 `null`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/engine/report.test.ts`의 import 줄을 바꾼다:

```ts
import {
  weeklyReport,
  completedCount,
  latestCheckupReport,
  pendingGradeDate,
  daysSinceExport,
} from './report'
```

파일 **맨 끝**에 붙인다(`metaWith` 헬퍼와 `TODAY = '2026-08-03'`은 파일 위쪽에 이미 있다):

```ts
describe('daysSinceExport', () => {
  it('백업한 적이 없으면 null이다', () => {
    expect(daysSinceExport(metaWith(null), TODAY)).toBeNull()
  })

  it('마지막 백업으로부터 지난 일수를 준다', () => {
    expect(daysSinceExport(metaWith('2026-07-31T12:00:00.000Z'), TODAY)).toBe(3)
  })

  it('같은 날 백업했으면 0이다', () => {
    expect(daysSinceExport(metaWith('2026-08-03T12:00:00.000Z'), TODAY)).toBe(0)
  })

  it('날짜로 파싱되지 않는 값은 null이다 — NaN을 흘리면 30일 배지가 영원히 안 뜬다', () => {
    expect(daysSinceExport(metaWith('이건-날짜가-아니다'), TODAY)).toBeNull()
  })
})
```

마지막 테스트가 이 함수의 존재 이유다. `validateBackup`은 `lastExportedAt`이 문자열인지만 보고 형식은 검사하지 않아서 `diffDays`가 `NaN`을 낼 수 있는데, `NaN >= 30`은 항상 false라 배지가 **영원히 안 뜨는 쪽으로 조용히** 실패한다.

- [ ] **Step 2: 실패를 확인한다**

```bash
export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH"
npx vitest run src/engine/report.test.ts
```

Expected: FAIL — `daysSinceExport is not a function`

- [ ] **Step 3: 구현하고 `weeklyReport`가 그것을 쓰게 한다**

`src/engine/report.ts`의 `weeklyReport` **앞**(즉 `export type WeeklyReport` 선언 뒤, `weeklyReport` 함수 위)에 추가한다:

```ts
/**
 * 마지막 백업 이후 지난 일수. 백업한 적이 없거나 값이 날짜로 파싱되지 않으면 null.
 *
 * ISO 타임스탬프의 앞 10자리는 UTC 날짜라 KST와 하루 어긋날 수 있다 — 30일 배지에도
 * 초기화 배너에도 하루 오차가 무의미하므로 그대로 쓴다.
 *
 * 파싱되지 않는 값을 null로 접는 것이 이 함수의 존재 이유다. validateBackup은
 * lastExportedAt이 문자열인지만 보고 형식은 검사하지 않아서 diffDays가 NaN을 낼 수
 * 있는데, `NaN >= 30`은 항상 false라 배지가 영원히 안 뜨는 쪽으로 조용히 실패한다.
 * 서버 사본이 없는 이 앱의 유일한 안전망이 꺼지는 것이므로 "백업한 적 없음"과 같게
 * 취급한다.
 */
export function daysSinceExport(meta: Meta, today: string): number | null {
  const last = meta.settings.lastExportedAt
  if (last === null) return null
  const diff = diffDays(last.slice(0, 10), today)
  return Number.isFinite(diff) ? diff : null
}
```

`weeklyReport` 안의 115-126행(`const last = …`부터 `exportOverdue` 계산까지, 그 사이의 주석 블록 전부 포함)을 다음으로 **교체**한다:

```ts
const sinceExport = daysSinceExport(meta, today)
const exportOverdue =
  days.length > 0 && (sinceExport === null || sinceExport >= EXPORT_OVERDUE_DAYS)
```

- [ ] **Step 4: 통과를 확인한다**

```bash
npx vitest run src/engine/report.test.ts
```

Expected: PASS — 새 테스트 4개 + **기존 `exportOverdue` 테스트 전부**(33·182·183·186·194·196·208행). 208행(`'이건-날짜가-아니다'` → `exportOverdue === true`)이 리팩터링이 동작을 안 바꿨다는 증거다.

- [ ] **Step 5: 변이 검증**

`daysSinceExport`의 마지막 줄을 `return diff`로 바꿔(`Number.isFinite` 가드 제거) `npx vitest run src/engine/report.test.ts`를 돌린다. **`날짜로 파싱되지 않는 값은 null이다` 테스트와 208행의 기존 테스트가 둘 다 빨개져야 한다.** 확인 후 원복한다.

- [ ] **Step 6: 커밋**

```bash
git add src/engine/report.ts src/engine/report.test.ts
git commit -m "$(cat <<'EOF'
refactor: daysSinceExport를 뽑는다 — 초기화 배너가 같은 값을 본다

weeklyReport 안에 인라인으로 있던 lastDiff 계산이다. 파싱 불가를 null로
접는 규칙까지 그대로 옮겼다 — NaN을 흘리면 30일 배지가 영원히 안 뜬다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `ungradedSheetCount()`

**Files:**

- Modify: `src/engine/report.ts` (`pendingGradeDate` 바로 뒤에 추가)
- Test: `src/engine/report.test.ts`

**Interfaces:**

- Consumes: `Day` 타입(`sheet`·`grades`·`date`)
- Produces: `export function ungradedSheetCount(days: Day[], today: string): number` — 문제지를 인쇄했지만 채점하지 않은 날의 수(오늘 포함)

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/engine/report.test.ts`의 import에 `ungradedSheetCount`를 더한다:

```ts
import {
  weeklyReport,
  completedCount,
  latestCheckupReport,
  pendingGradeDate,
  daysSinceExport,
  ungradedSheetCount,
} from './report'
```

파일 **맨 끝**에 붙인다:

```ts
describe('ungradedSheetCount', () => {
  // sheet가 비어 있지 않은 날을 만들기 위한 최소 문항 하나. 값 자체는 의미 없고
  // "문제지가 있었다"만 나타낸다. pendingGradeDate 블록과 같은 형태다.
  const item = (): Day['sheet'] => [
    { id: 'v1', kind: 'vertical', tag: 'add2-nocarry', a: 12, b: 3, op: '+', answer: 15 },
  ]
  const paperDay = (date: string, grades?: Record<string, boolean>): Day => ({
    date,
    kind: 'normal',
    sheet: item(),
    ...(grades ? { grades } : {}),
  })

  it('채점 안 된 문제지를 센다', () => {
    const days = [paperDay('2026-08-01'), paperDay('2026-08-02')]
    expect(ungradedSheetCount(days, TODAY)).toBe(2)
  })

  it('오늘 것을 센다 — pendingGradeDate와 정반대다. 아이가 지금 풀고 있는 종이가 대상이다', () => {
    expect(ungradedSheetCount([paperDay(TODAY)], TODAY)).toBe(1)
  })

  it('이미 채점한 날은 세지 않는다', () => {
    const days = [paperDay('2026-08-01', { v1: true }), paperDay('2026-08-02', { v1: false })]
    expect(ungradedSheetCount(days, TODAY)).toBe(0)
  })

  it('sheet가 빈 날(스프린트만 한 날)은 세지 않는다 — 채점할 문항이 없다', () => {
    const days = [{ date: '2026-08-02', kind: 'normal', sheet: [], sprint: [] } as Day]
    expect(ungradedSheetCount(days, TODAY)).toBe(0)
  })

  it('미래 날짜는 세지 않는다 — validateBackup이 날짜 범위를 보지 않아 실재할 수 있다', () => {
    expect(ungradedSheetCount([paperDay('2026-09-01')], TODAY)).toBe(0)
  })

  it('빈 로그는 0이다', () => {
    expect(ungradedSheetCount([], TODAY)).toBe(0)
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

```bash
export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH"
npx vitest run src/engine/report.test.ts
```

Expected: FAIL — `ungradedSheetCount is not a function`

- [ ] **Step 3: 최소 구현을 쓴다**

`src/engine/report.ts`의 `pendingGradeDate` 함수 **바로 뒤**에 붙인다:

```ts
/**
 * 문제지를 인쇄했지만 채점하지 않은 날의 수(오늘 포함). 초기화 배너가
 * "손에 든 종이가 무효가 된다"를 경고하는 근거다(설계 2026-08-04-data-reset §5).
 *
 * pendingGradeDate를 재사용하지 않는다 — 그쪽은 `d.date >= today`를 건너뛴다.
 * "지금 채점하러 가기" 링크가 오늘을 가리키면 매일 아침 거짓말이 되기 때문인데,
 * 초기화 경고는 오늘 아침에 인쇄해 아이가 지금 풀고 있는 종이가 가장 중요한
 * 대상이라 정반대다.
 *
 * date <= today 조건은 가져온 백업에 미래 날짜가 들어 있는 경우를 위한 것이다 —
 * validateBackup은 날짜 형식만 보고 범위는 보지 않는다.
 * sheet.length > 0을 먼저 보므로 스프린트만 한 날(빈 sheet)은 세지 않는다.
 */
export function ungradedSheetCount(days: Day[], today: string): number {
  return days.filter(
    (d) =>
      d.date <= today && d.sheet.length > 0 && (!d.grades || Object.keys(d.grades).length === 0),
  ).length
}
```

- [ ] **Step 4: 통과를 확인한다**

```bash
npx vitest run src/engine/report.test.ts
```

Expected: PASS — 새 테스트 6개 포함 전부

- [ ] **Step 5: 변이 검증**

`d.date <= today`를 `d.date < today`로 바꾸고 돌린다. **`오늘 것을 센다` 테스트만 빨개져야 한다.** 원복한 뒤, 이번엔 `d.sheet.length > 0`을 지우고 돌린다. **`sheet가 빈 날…` 테스트만 빨개져야 한다.** 원복한다.

- [ ] **Step 6: 커밋**

```bash
git add src/engine/report.ts src/engine/report.test.ts
git commit -m "$(cat <<'EOF'
feat: ungradedSheetCount — 초기화가 무효로 만들 종이를 센다

pendingGradeDate는 오늘을 일부러 건너뛴다. 초기화 경고는 오늘 아침에
인쇄해 아이가 지금 풀고 있는 종이가 가장 중요한 대상이라 정반대다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: 화면 배선 — 버튼과 확인 배너

**Files:**

- Modify: `src/screens/report.ts:1` (import), `:149` 뒤(버튼 마크업), `:268` 뒤(핸들러)
- Test: 없음. DOM 테스트는 하지 않는다(설계 §12) — 아래 수동 확인으로 검증한다

**Interfaces:**

- Consumes: `resetAll()` (Task 1), `daysSinceExport(meta, today)` (Task 2), `ungradedSheetCount(days, today)` (Task 3), 기존 `escapeHtml`·`el`·`navigate`·`showError`·`clearError`
- Produces: 없음(말단)

- [ ] **Step 1: import를 넓힌다**

`src/screens/report.ts` 1행:

```ts
import { getAllDays, getMeta, putMeta, replaceAll, resetAll } from '../data/db'
```

4행:

```ts
import {
  weeklyReport,
  latestCheckupReport,
  daysSinceExport,
  ungradedSheetCount,
} from '../engine/report'
```

- [ ] **Step 2: 버튼을 조건부로 그린다**

149행의 `<input type="file" id="import-file" … hidden />` **바로 다음 줄**에 넣는다:

```ts
          ${days.length > 0 ? '<button class="step" id="reset">모든 기록 지우기</button>' : ''}
```

기록이 0일이면 그리지 않는다 — 지울 것이 없는데 파괴 경로를 열어 둘 이유가 없고, 바로 위의 `#share`가 이미 같은 조건부 렌더 패턴이다.

- [ ] **Step 3: 핸들러를 붙인다**

`fileInput.addEventListener('change', …)` 블록이 끝나는 곳(268행 `})` 다음, `renderReport`의 `try` 블록 안 마지막)에 붙인다:

```ts
// 버튼은 기록이 있을 때만 그려지므로 ?. 가 필요하다.
root.querySelector('#reset')?.addEventListener('click', () => {
  const at = location.hash
  clearError()
  // 버튼이 존재한다 = days.length > 0. 날짜는 백업을 거쳐 온 값이라 이스케이프한다.
  const range = `${escapeHtml(days[0]!.date)} ~ ${escapeHtml(days[days.length - 1]!.date)}`
  const ungraded = ungradedSheetCount(days, today)
  const since = daysSinceExport(meta, today)
  // 되돌릴 수 없는 삭제 앞에서는 하루 전 백업도 경고할 값이 있어서 ⚠를 조건부로
  // 붙이지 않는다. 막지는 않는다 — lastExportedAt은 "저장했나요? → 네"라는 사람의
  // 대답으로만 갱신되므로 강제 게이트로 쓰면 거짓 안전감을 준다.
  const backupLine =
    since === null
      ? '⚠ 백업한 적이 없어요'
      : `⚠ 마지막 백업: ${since === 0 ? '오늘' : `${since}일 전`}`
  // 내보내기 확인·가져오기 확인과 같은 #confirm을 쓴다 — 서로 덮어쓸 뿐 동시에 뜨지 않는다.
  const confirm = root.querySelector('#confirm')!
  confirm.replaceChildren(
    el(`
          <div class="banner">
            ${days.length}일치 기록(${range})을 지우고 처음 상태로 되돌립니다.<br />
            <strong>되돌릴 수 없어요.</strong><br />
            ${
              ungraded > 0
                ? `⚠ 아직 채점하지 않은 문제지가 ${ungraded}일치 있어요 — 그 종이는 채점할 수 없게 됩니다.<br />`
                : ''
            }
            ${backupLine}<br />
            <button class="step" id="reset-yes">네, 지울게요</button>
            <button class="step" id="reset-cancel">취소</button>
          </div>
        `),
  )
  confirm.querySelector('#reset-cancel')!.addEventListener('click', () => {
    confirm.replaceChildren()
  })
  const yes = confirm.querySelector<HTMLButtonElement>('#reset-yes')!
  yes.addEventListener('click', () => {
    // 이중 탭 가드. IndexedDB 왕복이 한 프레임보다 길어 두 번 눌릴 수 있다.
    yes.disabled = true
    resetAll()
      .then(() => {
        if (location.hash !== at) return
        navigate('#/parent')
      })
      .catch((e) => {
        // resetAll은 replaceAll을 그대로 태우므로 원자적이다 — 실패해도 기록은 그대로다.
        if (location.hash !== at) return
        yes.disabled = false
        showError(`지우지 못했어요 (기록은 그대로예요): ${(e as Error).message}`)
      })
  })
})
```

- [ ] **Step 4: 정적 검사를 통과시킨다**

```bash
export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH"
npm run build && npm test && npx prettier --check .
```

Expected: 셋 다 통과. `prettier --check`가 실패하면 `npm run format`을 돌리고 다시 확인한다.

- [ ] **Step 5: 실물로 확인한다**

```bash
npm run dev
```

브라우저에서 `http://localhost:5173/haruchi/` 를 연다. (다른 워크트리에서 dev 서버가 이미 떠 있으면 5174가 되고, **origin이 달라 IndexedDB가 갈라진다** — 앱이 비어 보이는 것은 정상이다.)

1. `#/print`를 열어 오늘 문제지를 만든다(이것이 오늘의 `Day`와 `sheet`를 만든다)
2. `#/report`로 간다 → **`모든 기록 지우기` 버튼이 `가져오기 (복구)` 아래에 보인다**
3. 버튼을 누른다 → 배너에 이 셋이 보인다:
   - `1일치 기록(<오늘> ~ <오늘>)을 지우고 처음 상태로 되돌립니다. 되돌릴 수 없어요.`
   - `⚠ 아직 채점하지 않은 문제지가 1일치 있어요 — 그 종이는 채점할 수 없게 됩니다.`
   - `⚠ 백업한 적이 없어요`
4. `취소` → 배너만 사라지고 화면은 그대로다
5. 다시 누르고 `네, 지울게요` → **`#/parent`로 이동하고 `✅ 0일 완료 · 🔥 0일 연속`이 보인다**
6. `#/report`를 다시 연다 → **버튼이 사라져 있다**(기록이 0일이므로)

6번까지 확인되면 이 기능의 전 경로가 실물로 검증된 것이다.

- [ ] **Step 6: 커밋**

```bash
git add src/screens/report.ts
git commit -m "$(cat <<'EOF'
feat: 리포트 화면에 모든 기록 지우기

2단계 확인. 무엇이 사라지는지 숫자로 보여주고, 채점 안 된 문제지와 마지막
백업을 사실로 병기하되 막지는 않는다 — lastExportedAt은 사람의 대답에만
의존해서 강제 게이트로 쓰면 거짓 안전감을 준다.

기록이 0일이면 버튼을 그리지 않는다. 네, 지울게요는 누르는 즉시 disabled다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: HANDOFF 갱신과 머지 준비

**Files:**

- Modify: `docs/superpowers/HANDOFF.md`

**Interfaces:** 없음(문서)

- [ ] **Step 1: HANDOFF에 한 줄 남긴다**

`docs/superpowers/HANDOFF.md`에서 백업·복구를 설명하는 대목 근처에 붙인다:

```markdown
- **초기화(`resetAll`)는 `replaceAll([], defaultMeta())`다.** 파괴적 쓰기 경로를 하나로 유지한다 — `replaceAll`의 `tx.abort()` 함정이 테스트로 고정돼 있어서, 두 번째 경로를 만들면 그 함정을 다시 밟을 자리가 생긴다. 버튼은 `#/report` 하단에 있고 **기록이 0일이면 그려지지 않는다**. 확인 배너는 지울 일수·날짜 범위와 함께 채점 안 된 문제지 수(`ungradedSheetCount`)·마지막 백업(`daysSinceExport`)을 병기하지만 **막지는 않는다** — `lastExportedAt`이 "저장했나요? → 네"에만 의존해 강제 게이트로 쓰면 거짓 안전감을 준다(설계 `specs/2026-08-04-data-reset-design.md`)
```

- [ ] **Step 2: 포맷하고 전체 검사를 돌린다**

```bash
export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH"
npm run format
npx prettier --check . && npm test && npm run build
```

Expected: 셋 다 통과. **동시 세션 중이므로 이 초록불이 내 변경만 보증하지 않는다** — 보고할 때 이 점을 밝힌다.

- [ ] **Step 3: 커밋**

```bash
git add docs/superpowers/HANDOFF.md
git commit -m "$(cat <<'EOF'
docs: HANDOFF에 초기화 경로 — 파괴적 쓰기는 replaceAll 하나뿐

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: 머지는 사람에게 묻는다**

`main`에 push하면 그것이 곧 배포이고 그날 저녁 아이패드로 나간다. 머지·push는 **사용자가 명시적으로 요청할 때만** 한다. 이 시점에서는 브랜치 상태와 검사 결과를 보고하고 멈춘다.

머지 요청을 받으면: `git switch main && git pull` → 충돌 없으면 머지 → `gh run watch`로 배포 결과까지 본다. 충돌이 나면 CLAUDE.md의 rebase-merge 규칙과 예외 조항을 따른다.

---

## Self-Review

**1. 스펙 커버리지**

| 스펙 절                           | 구현 태스크                             |
| --------------------------------- | --------------------------------------- |
| §3 자리(리포트 하단)              | Task 4 Step 2                           |
| §3 렌더 조건(0일이면 미표시)      | Task 4 Step 2, 수동 확인 6번            |
| §3 확인 배너 3줄                  | Task 4 Step 3, 수동 확인 3번            |
| §3 백업 줄 항상 표시·막지 않음    | Task 4 Step 3 (`backupLine`)            |
| §3 이중 탭 가드                   | Task 4 Step 3 (`yes.disabled = true`)   |
| §3 성공 시 `#/parent`             | Task 4 Step 3, 수동 확인 5번            |
| §3 실패 문구·`location.hash` 가드 | Task 4 Step 3 (`.catch`)                |
| §4 `defaultMeta`·`resetAll`       | Task 1                                  |
| §5 `daysSinceExport`              | Task 2                                  |
| §5 `ungradedSheetCount`           | Task 3                                  |
| §6 불변식                         | Global Constraints + Task 4 Step 3 주석 |
| §7 테스트                         | Task 1·2·3의 Step 1과 변이 검증 Step    |
| §8 작업 경로                      | Global Constraints, Task 5 Step 4       |

빠진 요구사항 없음.

**2. 플레이스홀더 스캔**

"TBD"·"적절히 처리"·"위 내용에 대한 테스트 작성" 없음. 모든 코드 단계에 실제 코드 블록이 있다. Task 4는 자동 테스트가 없지만 그것이 이 레포의 규칙(설계 §12)이고, 대신 6단계짜리 구체적 수동 확인 절차가 있다.

**3. 타입 일관성**

- `defaultMeta(): Meta` — Task 1이 정의, Task 1의 `resetAll`이 사용. 다른 태스크는 안 씀
- `resetAll(): Promise<void>` — Task 1이 정의, Task 4가 `.then/.catch`로 사용 ✓
- `daysSinceExport(meta: Meta, today: string): number | null` — Task 2가 정의, Task 4가 `since === null` / `since === 0` / `${since}일 전`로 사용 ✓
- `ungradedSheetCount(days: Day[], today: string): number` — Task 3이 정의, Task 4가 `ungraded > 0` / `${ungraded}일치`로 사용 ✓
- Task 4에서 쓰는 `days`·`meta`·`today`는 `renderReport`가 이미 만들어 둔 지역 변수다(`report.ts:114-116`) ✓

이름 불일치 없음.
