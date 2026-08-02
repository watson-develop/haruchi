# 하루치 Phase 1 — 종이 루틴 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 아이패드 홈 화면에서 열어 매일 A4 1장(세로셈 8 + □ 채우기 2)을 인쇄해 풀고, 아빠가 탭 몇 번으로 채점해 데이터가 쌓이는 상태까지 만든다.

**Architecture:** 서버 없는 정적 PWA. 순수 함수로 된 `engine/`이 그날 문항을 만들고, `data/db.ts`가 IndexedDB에 로그를 쌓고, 화면 3개(홈·인쇄·채점)가 해시 라우팅으로 전환된다. 인쇄는 브라우저 `window.print()` + `@media print`로 처리하며 PDF 라이브러리를 쓰지 않는다.

**Tech Stack:** TypeScript(strict) · Vite · vite-plugin-pwa · Vitest · Prettier · npm · Node 24(mise) · IndexedDB · GitHub Pages

설계 문서: `docs/superpowers/specs/2026-08-02-haruchi-design.md`

## Global Constraints

- **런타임 의존성 0개.** `dependencies`는 비어 있어야 한다. 추가는 `devDependencies`에만
- **프레임워크 없음.** React/Vue/Svelte 등을 도입하지 않는다. 바닐라 DOM + 해시 라우팅
- TypeScript `strict: true`
- **`engine/`의 모든 함수는 순수 함수.** DOM·IndexedDB·`Date.now()`에 직접 의존하지 않는다. 시각과 난수는 인자로 주입한다
- **테스트는 `engine/`에 집중.** DOM·화면 단위 테스트는 작성하지 않는다. `data/db.ts`는 저장·조회 왕복이 되는지 확인하는 스모크 수준까지만 (로직 검증은 `engine/`의 몫)
- **하루의 경계는 새벽 4시(로컬).** 날짜 키 생성은 반드시 `engine/dates.ts`의 `dayKey()`를 거친다
- **그날 문항은 생성 시점에 `days[date].sheet`로 고정.** 재인쇄는 저장된 것을 다시 렌더할 뿐 재생성하지 않는다
- **정답을 인쇄물에 출력하지 않는다.** 정답은 채점 화면에만 표시
- **조용히 실패하지 않는다.** 저장·생성 실패는 반드시 화면에 노출한다
- **빈 문제지를 내지 않는다.** 문항 생성 실패 시 더 쉬운 유형으로 폴백
- 배포 base path는 `/haruchi/` (GitHub Pages 프로젝트 사이트). **origin은 확정 후 변경하지 않는다**
- 커밋 메시지는 한국어, Conventional Commits 접두사 사용

---

## File Structure

| 파일 | 책임 |
|---|---|
| `src/data/types.ts` | 전 계층이 공유하는 타입. 로직 없음 |
| `src/data/db.ts` | IndexedDB 래퍼. 밖으로 4함수만 노출 |
| `src/engine/dates.ts` | 새벽 4시 경계의 날짜 키 계산 |
| `src/engine/vertical.ts` | 세로셈 9유형의 판정 술어와 생성기 |
| `src/engine/inverse.ts` | □ 채우기 4템플릿 생성기 |
| `src/engine/derive.ts` | `days[]` → 유형별 상태. 열린 유형 판정 |
| `src/engine/compose.ts` | 그날 문항 조립 + 폴백 |
| `src/main.ts` | 앱 진입, 해시 라우팅, 전역 에러 배너 |
| `src/screens/home.ts` | 오늘 할 일, 이름 첫 설정, 채점 누락 배너 |
| `src/screens/print-sheet.ts` | 1장 렌더 + 인쇄 트리거 |
| `src/screens/grade.ts` | 채점 입력 + mood |
| `src/styles/app.css` | 화면 스타일 |
| `src/styles/print.css` | `@page` A4, `@media print` |

`engine/`은 `data/types.ts`만 import한다. `screens/`는 `engine/`과 `data/`를 쓰지만 그 반대는 없다.

---

### Task 1: 프로젝트 셋업

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `mise.toml`, `.prettierrc`, `index.html`, `src/main.ts`, `src/engine/sanity.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces: `npm test`(Vitest), `npm run dev`(Vite), `npm run build`(tsc --noEmit + vite build) 스크립트

- [ ] **Step 1: Node 버전 고정과 npm 초기화**

`mise.toml`:

```toml
[tools]
node = "24"
```

실행:

```bash
cd ~/workspace/haruchi
mise install
npm init -y
```

- [ ] **Step 2: devDependencies 설치**

```bash
npm install -D typescript vite vite-plugin-pwa vitest prettier fake-indexeddb
```

`fake-indexeddb`는 Task 3의 `db.ts` 스모크 테스트에만 쓰인다. 런타임 의존성이 아니다.

- [ ] **Step 3: 설정 파일 작성**

`package.json`의 `scripts`와 `type`을 다음으로 교체 (`devDependencies`는 Step 2가 채운 값을 유지):

```json
{
  "name": "haruchi",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "format": "prettier --write ."
  }
}
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "types": ["vite/client"]
  },
  "include": ["src", "vite.config.ts"]
}
```

`vite.config.ts`:

```ts
/// <reference types="vitest/config" />
import { defineConfig } from 'vite'

export default defineConfig({
  base: '/haruchi/',
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
```

`.prettierrc`:

```json
{
  "semi": false,
  "singleQuote": true,
  "printWidth": 100
}
```

`index.html`:

```html
<!doctype html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>하루치</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

`src/main.ts`:

```ts
const app = document.querySelector<HTMLDivElement>('#app')
if (app) app.textContent = '하루치'
```

- [ ] **Step 4: 통과를 확인할 테스트 작성**

`src/engine/sanity.test.ts`:

```ts
import { describe, it, expect } from 'vitest'

describe('toolchain', () => {
  it('runs typescript tests', () => {
    const n: number = 1 + 1
    expect(n).toBe(2)
  })
})
```

- [ ] **Step 5: 테스트와 빌드 실행**

```bash
npm test
npm run build
```

Expected: 테스트 1개 PASS, `dist/` 생성.

- [ ] **Step 6: 커밋**

```bash
git add -A
git commit -m "chore: Vite + TypeScript + Vitest 프로젝트 셋업"
```

---

### Task 2: 날짜 유틸 (새벽 4시 경계)

**Files:**
- Create: `src/engine/dates.ts`, `src/engine/dates.test.ts`
- Delete: `src/engine/sanity.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `dayKey(now: Date): string` — `"YYYY-MM-DD"`. 새벽 4시 이전이면 전날 키
  - `shiftDay(key: string, n: number): string` — 날짜 키를 n일 이동
  - `diffDays(from: string, to: string): number` — `to - from` 일수

- [ ] **Step 1: 실패하는 테스트 작성**

`src/engine/dates.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { dayKey, shiftDay, diffDays } from './dates'

describe('dayKey', () => {
  it('오후 시각은 그날로 기록한다', () => {
    expect(dayKey(new Date(2026, 7, 2, 19, 30))).toBe('2026-08-02')
  })

  it('새벽 4시는 그날로 기록한다', () => {
    expect(dayKey(new Date(2026, 7, 2, 4, 0))).toBe('2026-08-02')
  })

  it('새벽 3시 59분은 전날로 기록한다', () => {
    expect(dayKey(new Date(2026, 7, 2, 3, 59))).toBe('2026-08-01')
  })

  it('월 경계를 넘어 전날로 간다', () => {
    expect(dayKey(new Date(2026, 7, 1, 1, 0))).toBe('2026-07-31')
  })

  it('연 경계를 넘어 전날로 간다', () => {
    expect(dayKey(new Date(2027, 0, 1, 2, 0))).toBe('2026-12-31')
  })
})

describe('shiftDay', () => {
  it('앞뒤로 이동한다', () => {
    expect(shiftDay('2026-08-02', 1)).toBe('2026-08-03')
    expect(shiftDay('2026-08-01', -1)).toBe('2026-07-31')
    expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28')
  })
})

describe('diffDays', () => {
  it('두 날짜 키의 차이를 센다', () => {
    expect(diffDays('2026-08-01', '2026-08-03')).toBe(2)
    expect(diffDays('2026-08-03', '2026-08-01')).toBe(-2)
    expect(diffDays('2026-08-02', '2026-08-02')).toBe(0)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/engine/dates.test.ts`
Expected: FAIL — `Failed to resolve import "./dates"`

- [ ] **Step 3: 구현**

`src/engine/dates.ts`:

```ts
/** 하루의 경계. 이 시각 이전은 전날로 기록한다. */
export const DAY_START_HOUR = 4

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function toKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function parseKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** 주어진 시각이 속한 "하루"의 키를 돌려준다. 새벽 4시 이전은 전날. */
export function dayKey(now: Date): string {
  const d = new Date(now.getTime())
  if (d.getHours() < DAY_START_HOUR) d.setDate(d.getDate() - 1)
  return toKey(d)
}

/** 날짜 키를 n일 이동한다. */
export function shiftDay(key: string, n: number): string {
  const d = parseKey(key)
  d.setDate(d.getDate() + n)
  return toKey(d)
}

/** to - from 을 일 단위로 센다. */
export function diffDays(from: string, to: string): number {
  const a = parseKey(from).getTime()
  const b = parseKey(to).getTime()
  return Math.round((b - a) / 86_400_000)
}
```

- [ ] **Step 4: 통과 확인**

```bash
rm src/engine/sanity.test.ts
npx vitest run
```

Expected: `dates.test.ts` 7개 PASS (`it` 블록 기준 — `dayKey` 5, `shiftDay` 1, `diffDays` 1).

- [ ] **Step 5: 커밋**

```bash
git add -A
git commit -m "feat: 새벽 4시 경계 날짜 유틸 추가"
```

---

### Task 3: 타입 정의와 IndexedDB 래퍼

**Files:**
- Create: `src/data/types.ts`, `src/data/db.ts`, `src/data/db.test.ts`
- Modify: `vite.config.ts` (테스트 setup 파일 등록)
- Create: `src/test-setup.ts`

**Interfaces:**
- Consumes: 없음
- Produces:
  - 타입 전부 (`Day`, `SheetItem`, `VerticalItem`, `InverseItem`, `StrategyItem`, `WordItem`, `Derived`, `Settings`, `Meta`, `Mood` 등)
  - `DEFAULT_SETTINGS: Settings`, `emptyDerived(): Derived`
  - `getDay(date: string): Promise<Day | undefined>`
  - `putDay(day: Day): Promise<void>`
  - `getAllDays(): Promise<Day[]>`
  - `getMeta(): Promise<Meta>` — 없으면 기본값
  - `putMeta(meta: Meta): Promise<void>`

- [ ] **Step 1: 타입 정의**

`src/data/types.ts`:

```ts
// ─────────── 문항 ───────────

export type VerticalTag =
  | 'add2-nocarry'
  | 'sub2-noborrow'
  | 'add2-carry'
  | 'sub2-borrow'
  | 'add3-carry1'
  | 'add3-carry2'
  | 'sub3-borrow1'
  | 'sub3-borrow2'
  | 'sub-zero'

export type InverseTag = 'inverse-add' | 'inverse-sub'

export type InverseTemplate = 'a+?=c' | '?+b=c' | 'a-?=c' | '?-b=c'

export type StrategyId =
  | 'split-place'
  | 'anchor'
  | 'split-subtrahend'
  | 'count-up'
  | 'make-ten'
  | 'round-adjust'
  | 'double'
  | 'minus-one'

export type WordTag = 'mul-group' | 'mul-times'

export type StrategyStep = { text: string; blanks: number[] }

export type VerticalItem = {
  id: string
  kind: 'vertical'
  tag: VerticalTag
  a: number
  b: number
  op: '+' | '−'
  answer: number
}

export type InverseItem = {
  id: string
  kind: 'inverse'
  tag: InverseTag
  template: InverseTemplate
  a?: number
  b?: number
  c: number
  hint?: string
  answer: number
}

export type StrategyItem = {
  id: string
  kind: 'strategy'
  tag: StrategyId
  a: number
  b: number
  op: '+' | '−'
  steps: StrategyStep[]
  answer: number
}

export type WordItem = {
  id: string
  kind: 'word'
  tag: WordTag
  text: string
  needsDrawing: boolean
  expression: string
  unit: string
  answer: number
}

export type SheetItem = VerticalItem | InverseItem | StrategyItem | WordItem

// ─────────── 로그 ───────────

export type Mood = 'easy' | 'ok' | 'hard'

export type SprintAttempt = { fact: string; correct: boolean; ms: number }

export type Day = {
  date: string
  kind: 'normal' | 'checkup'
  sheet: SheetItem[]
  grades?: Record<string, boolean>
  sprint?: SprintAttempt[]
  mood?: Mood
  doneAt?: string
}

// ─────────── 파생 상태 ───────────

export type FactState = {
  status: 'new' | 'learning' | 'fluent'
  medianMs: number | null
  streak: number
  interval: 1 | 3 | 7 | 14
  nextDue: string | null
}

/** 최근 시도의 정오답 이력. 오래된 것이 앞. */
export type TypeState = { attempts: boolean[] }

export type StrategyState = { attempts: boolean[]; introducedAt: string | null }

export type Derived = {
  facts: Record<string, FactState>
  types: Record<string, TypeState>
  strategies: Record<string, StrategyState>
}

export type Settings = {
  childName: string
  friendNames: string[]
  verticalCount: 8 | 6
  inverseCount: number
  sprintCount: number
  fluentMs: number
  lastExportedAt: string | null
  schemaVersion: number
  algoVersion: number
}

export type Meta = { derived: Derived; settings: Settings }

// ─────────── 기본값 ───────────

export const DEFAULT_SETTINGS: Settings = {
  childName: '',
  friendNames: ['지호', '민아'],
  verticalCount: 8,
  inverseCount: 2,
  sprintCount: 30,
  fluentMs: 2500,
  lastExportedAt: null,
  schemaVersion: 1,
  algoVersion: 1,
}

export function emptyDerived(): Derived {
  return { facts: {}, types: {}, strategies: {} }
}
```

- [ ] **Step 2: 실패하는 스모크 테스트 작성**

> **테스트 격리 필수.** 아래 5개 테스트를 그대로 쓰면 실행 순서에 의존한다 — 3번은 1번이 쓴 데이터에 기대고,
> 4번은 5번보다 먼저 돌아야만 통과한다. 파일 최상단에 두 object store를 비우는 `beforeEach`를 두고
> (별도 raw `indexedDB` 연결 사용 — `db.ts`에 6번째 export를 추가하지 말 것), 각 테스트가 자기 데이터를
> 직접 준비하게 한다. **각 테스트는 단독 실행(`-t` 필터)으로도 통과해야 한다.**

`src/test-setup.ts`:

```ts
import 'fake-indexeddb/auto'
```

`vite.config.ts`의 `test` 블록에 setup 파일 등록:

```ts
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['src/test-setup.ts'],
  },
```

`src/data/db.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { getDay, putDay, getAllDays, getMeta, putMeta } from './db'
import { DEFAULT_SETTINGS, emptyDerived } from './types'
import type { Day } from './types'

const sample: Day = {
  date: '2026-08-02',
  kind: 'normal',
  sheet: [{ id: 'v1', kind: 'vertical', tag: 'add2-carry', a: 47, b: 38, op: '+', answer: 85 }],
}

describe('db', () => {
  it('day를 저장하고 다시 읽는다', async () => {
    await putDay(sample)
    const got = await getDay('2026-08-02')
    expect(got?.sheet[0]?.answer).toBe(85)
  })

  it('없는 day는 undefined를 준다', async () => {
    expect(await getDay('1999-01-01')).toBeUndefined()
  })

  it('전체 day를 날짜 오름차순으로 준다', async () => {
    await putDay({ ...sample, date: '2026-08-01' })
    const all = await getAllDays()
    expect(all.map((d) => d.date)).toEqual(['2026-08-01', '2026-08-02'])
  })

  it('meta가 없으면 기본값을 준다', async () => {
    const meta = await getMeta()
    expect(meta.settings.verticalCount).toBe(8)
    expect(meta.derived.facts).toEqual({})
  })

  it('meta를 저장하고 다시 읽는다', async () => {
    await putMeta({
      derived: emptyDerived(),
      settings: { ...DEFAULT_SETTINGS, childName: '서연' },
    })
    const meta = await getMeta()
    expect(meta.settings.childName).toBe('서연')
  })
})
```

- [ ] **Step 3: 실패 확인**

Run: `npx vitest run src/data/db.test.ts`
Expected: FAIL — `Failed to resolve import "./db"`

- [ ] **Step 4: 구현**

`src/data/db.ts`:

```ts
import { DEFAULT_SETTINGS, emptyDerived } from './types'
import type { Day, Meta } from './types'

const DB_NAME = 'haruchi'
const DB_VERSION = 1
const STORE_DAYS = 'days'
const STORE_META = 'meta'
const META_KEY = 'current'

let dbPromise: Promise<IDBDatabase> | null = null

/** IndexedDB 연결. 최초 1회만 열고 이후 재사용한다. */
function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_DAYS)) {
        db.createObjectStore(STORE_DAYS, { keyPath: 'date' })
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => {
      // 연결 실패를 영구히 캐싱하지 않는다 — 다음 호출이 재시도할 수 있도록 초기화한다.
      dbPromise = null
      reject(req.error ?? new Error('IndexedDB 열기 실패'))
    }
  })
  return dbPromise
}

function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>) {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode)
        const req = fn(tx.objectStore(store))
        let result: T
        req.onsuccess = () => {
          result = req.result
        }
        req.onerror = () => reject(req.error ?? new Error('IndexedDB 요청 실패'))
        // 요청 성공은 커밋을 보장하지 않는다 — 트랜잭션이 실제로 커밋된 뒤에만 resolve한다.
        tx.oncomplete = () => resolve(result)
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB 트랜잭션 실패'))
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB 트랜잭션 중단'))
      })
  )
}

export function getDay(date: string): Promise<Day | undefined> {
  return run<Day | undefined>(STORE_DAYS, 'readonly', (s) => s.get(date))
}

export async function putDay(day: Day): Promise<void> {
  await run(STORE_DAYS, 'readwrite', (s) => s.put(day))
}

export async function getAllDays(): Promise<Day[]> {
  const all = await run<Day[]>(STORE_DAYS, 'readonly', (s) => s.getAll())
  return all.sort((a, b) => a.date.localeCompare(b.date))
}

export async function getMeta(): Promise<Meta> {
  const meta = await run<Meta | undefined>(STORE_META, 'readonly', (s) => s.get(META_KEY))
  if (meta) return meta
  // settings의 얕은 복사만으로는 friendNames 배열이 DEFAULT_SETTINGS와 공유된다 — 별도로 복사한다.
  return {
    derived: emptyDerived(),
    settings: { ...DEFAULT_SETTINGS, friendNames: [...DEFAULT_SETTINGS.friendNames] },
  }
}

export async function putMeta(meta: Meta): Promise<void> {
  await run(STORE_META, 'readwrite', (s) => s.put(meta, META_KEY))
}
```

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run`
Expected: `db.test.ts` 5개 + `dates.test.ts` 7개 = 12개 PASS.

- [ ] **Step 6: 커밋**

```bash
git add -A
git commit -m "feat: 공용 타입과 IndexedDB 래퍼 추가"
```

---

### Task 4: 세로셈 생성기

**Files:**
- Create: `src/engine/vertical.ts`, `src/engine/vertical.test.ts`

**Interfaces:**
- Consumes: `VerticalTag`, `VerticalItem` (`src/data/types.ts`)
- Produces:
  - `VERTICAL_ORDER: VerticalTag[]` — 도입 순서
  - `carryCount(a: number, b: number): number`
  - `borrowCount(a: number, b: number): number`
  - `satisfies(tag: VerticalTag, a: number, b: number): boolean`
  - `generateVertical(tag: VerticalTag, rand?: () => number): Omit<VerticalItem, 'id'>` — 실패 시 `GenerationError` throw
  - `class GenerationError extends Error`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/engine/vertical.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  VERTICAL_ORDER,
  carryCount,
  borrowCount,
  satisfies,
  generateVertical,
} from './vertical'

describe('carryCount', () => {
  it('받아올림 횟수를 센다', () => {
    expect(carryCount(12, 34)).toBe(0)
    expect(carryCount(47, 38)).toBe(1)
    expect(carryCount(156, 275)).toBe(2)
    expect(carryCount(99, 99)).toBe(2)
  })
})

describe('borrowCount', () => {
  it('받아내림 횟수를 센다', () => {
    expect(borrowCount(58, 23)).toBe(0)
    expect(borrowCount(63, 28)).toBe(1)
    expect(borrowCount(300, 147)).toBe(2)
    expect(borrowCount(503, 276)).toBe(2)
    expect(borrowCount(425, 168)).toBe(2)
  })
})

describe('generateVertical', () => {
  it('모든 유형이 정의를 만족하는 문항만 만든다', () => {
    for (const tag of VERTICAL_ORDER) {
      for (let i = 0; i < 500; i++) {
        const p = generateVertical(tag)
        expect(satisfies(tag, p.a, p.b), `${tag}: ${p.a} ${p.op} ${p.b}`).toBe(true)
        expect(p.answer).toBe(p.op === '+' ? p.a + p.b : p.a - p.b)
        expect(p.answer).toBeGreaterThanOrEqual(0)
        expect(p.answer).toBeLessThan(1000)
        expect(p.tag).toBe(tag)
      }
    }
  })

  it('뺄셈 결과는 음수가 아니다', () => {
    const subs = VERTICAL_ORDER.filter((t) => t.startsWith('sub'))
    for (const tag of subs) {
      for (let i = 0; i < 200; i++) {
        const p = generateVertical(tag)
        expect(p.op).toBe('−')
        expect(p.a).toBeGreaterThan(p.b)
      }
    }
  })

  it('sub-zero는 피감수의 십의 자리가 0이고 받아내림이 2회 이상이다', () => {
    for (let i = 0; i < 300; i++) {
      const p = generateVertical('sub-zero')
      expect(Math.floor(p.a / 10) % 10).toBe(0)
      expect(borrowCount(p.a, p.b)).toBeGreaterThanOrEqual(2)
    }
  })

  it('add2-carry는 받아올림이 정확히 1회다', () => {
    for (let i = 0; i < 300; i++) {
      const p = generateVertical('add2-carry')
      expect(carryCount(p.a, p.b)).toBe(1)
    }
  })
})
```

> **위 "모든 유형" 테스트만으로는 부족하다.** `expect(satisfies(tag, p.a, p.b)).toBe(true)`는 항상 참이다 —
> `generateVertical`이 이미 같은 `satisfies()`로 후보를 걸러 반환하기 때문에, `SPECS`의 술어를 무엇으로
> 바꿔도 통과한다. (실증: `sub3-borrow2`의 술어를 `borrowCount === 2`에서 `=== 1`로 바꿔도 4,500샘플 전부 통과)
>
> 따라서 **9개 태그 각각에 독립 검사를 둔다.** 기대 횟수를 `SPECS`에서 끌어오지 말고 **테스트 안에 리터럴로**
> 박고, `carryCount`/`borrowCount`를 직접 호출해 비교한다. 태그명이 자릿수를 함의하면 자릿수도 단언한다:
> `add2-nocarry` 0, `sub2-noborrow` 0, `add2-carry` 1, `sub2-borrow` 1, `add3-carry1` 1, `add3-carry2` 2,
> `sub3-borrow1` 1, `sub3-borrow2` 2, `sub-zero`는 피감수 십의 자리 0 + 받아내림 2회 이상.
>
> 검사가 실제로 작동하는지는 **변조 실험으로 증명한다** — 술어 하나를 바꿔 테스트가 실패하는 것을 확인하고,
> 되돌려 다시 통과하는 것을 확인한다. 통과하는 테스트 자체는 증거가 아니다.
>
> `borrowCount` 전제조건 테스트도 함께 둔다: `a < b`면 `RangeError`, `a === b`면 0.

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/engine/vertical.test.ts`
Expected: FAIL — `Failed to resolve import "./vertical"`

- [ ] **Step 3: 구현**

`src/engine/vertical.ts`:

```ts
import type { VerticalItem, VerticalTag } from '../data/types'

/** 교육과정 도입 순서. 앞에서부터 하나씩 열린다. */
export const VERTICAL_ORDER: VerticalTag[] = [
  'add2-nocarry',
  'sub2-noborrow',
  'add2-carry',
  'sub2-borrow',
  'add3-carry1',
  'add3-carry2',
  'sub3-borrow1',
  'sub3-borrow2',
  'sub-zero',
]

export class GenerationError extends Error {
  constructor(public tag: string) {
    super(`문항 생성 실패: ${tag}`)
    this.name = 'GenerationError'
  }
}

/** 덧셈에서 발생하는 받아올림 횟수. */
export function carryCount(a: number, b: number): number {
  let carry = 0
  let count = 0
  while (a > 0 || b > 0) {
    const sum = (a % 10) + (b % 10) + carry
    if (sum >= 10) {
      count++
      carry = 1
    } else {
      carry = 0
    }
    a = Math.floor(a / 10)
    b = Math.floor(b / 10)
  }
  return count
}

/**
 * 뺄셈 a - b 에서 발생하는 받아내림 횟수. a >= b 를 전제한다.
 * 전제가 깨지면(a < b) borrow가 무한히 해소되지 않아 루프가 끝나지 않으므로,
 * 조용히 잘못된 값을 내거나 멈추는 대신 즉시 던진다.
 */
export function borrowCount(a: number, b: number): number {
  if (a < b) {
    throw new RangeError(`borrowCount 전제조건 위반: a(${a})는 b(${b})보다 작을 수 없다`)
  }
  let borrow = 0
  let count = 0
  while (b > 0 || borrow > 0) {
    const digit = (a % 10) - (b % 10) - borrow
    if (digit < 0) {
      count++
      borrow = 1
    } else {
      borrow = 0
    }
    a = Math.floor(a / 10)
    b = Math.floor(b / 10)
  }
  return count
}

type Spec = {
  op: '+' | '−'
  min: number
  max: number
  ok: (a: number, b: number) => boolean
}

const SPECS: Record<VerticalTag, Spec> = {
  'add2-nocarry': { op: '+', min: 10, max: 99, ok: (a, b) => carryCount(a, b) === 0 },
  'sub2-noborrow': { op: '−', min: 10, max: 99, ok: (a, b) => borrowCount(a, b) === 0 },
  'add2-carry': { op: '+', min: 10, max: 99, ok: (a, b) => carryCount(a, b) === 1 },
  'sub2-borrow': { op: '−', min: 10, max: 99, ok: (a, b) => borrowCount(a, b) === 1 },
  'add3-carry1': {
    op: '+',
    min: 100,
    max: 899,
    ok: (a, b) => carryCount(a, b) === 1 && a + b < 1000,
  },
  'add3-carry2': {
    op: '+',
    min: 100,
    max: 899,
    ok: (a, b) => carryCount(a, b) === 2 && a + b < 1000,
  },
  'sub3-borrow1': { op: '−', min: 100, max: 999, ok: (a, b) => borrowCount(a, b) === 1 },
  'sub3-borrow2': { op: '−', min: 100, max: 999, ok: (a, b) => borrowCount(a, b) === 2 },
  'sub-zero': {
    op: '−',
    min: 100,
    max: 999,
    ok: (a, b) => Math.floor(a / 10) % 10 === 0 && borrowCount(a, b) >= 2,
  },
}

/** 주어진 두 수가 해당 유형의 정의를 만족하는지. */
export function satisfies(tag: VerticalTag, a: number, b: number): boolean {
  const spec = SPECS[tag]
  if (spec.op === '−' && a <= b) return false
  return spec.ok(a, b)
}

function randInt(min: number, max: number, rand: () => number): number {
  return min + Math.floor(rand() * (max - min + 1))
}

const MAX_ATTEMPTS = 2000

/**
 * 유형 정의를 만족하는 문항을 기각 표집으로 만든다.
 * 실패하면 GenerationError를 던진다 — 호출부가 더 쉬운 유형으로 폴백한다.
 */
export function generateVertical(
  tag: VerticalTag,
  rand: () => number = Math.random
): Omit<VerticalItem, 'id'> {
  const spec = SPECS[tag]
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const x = randInt(spec.min, spec.max, rand)
    const y = randInt(spec.min, spec.max, rand)
    const a = spec.op === '−' ? Math.max(x, y) : x
    const b = spec.op === '−' ? Math.min(x, y) : y
    if (!satisfies(tag, a, b)) continue
    return { kind: 'vertical', tag, a, b, op: spec.op, answer: spec.op === '+' ? a + b : a - b }
  }
  throw new GenerationError(tag)
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/engine/vertical.test.ts`
Expected: 6개 PASS (`carryCount` 1, `borrowCount` 1, `generateVertical` 4). 실패하면 어느 `tag`의 어느 수식이 정의를 어겼는지 메시지에 찍힌다.

- [ ] **Step 5: 커밋**

```bash
git add -A
git commit -m "feat: 세로셈 9유형 생성기와 속성 기반 테스트 추가"
```

---

### Task 5: □ 채우기 생성기

**Files:**
- Create: `src/engine/inverse.ts`, `src/engine/inverse.test.ts`

**Interfaces:**
- Consumes: `InverseItem`, `InverseTemplate`, `InverseTag` (`src/data/types.ts`)
- Produces:
  - `INVERSE_TEMPLATES: InverseTemplate[]`
  - `generateInverse(template: InverseTemplate, rand?: () => number): Omit<InverseItem, 'id'>`
  - `inverseHint(item: Omit<InverseItem, 'id'>): string` — 첫 문항에만 붙일 문장 힌트

- [ ] **Step 1: 실패하는 테스트 작성**

`src/engine/inverse.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { INVERSE_TEMPLATES, generateInverse, inverseHint } from './inverse'

describe('generateInverse', () => {
  it('모든 템플릿에서 답이 자연수이고 1000 미만이다', () => {
    for (const t of INVERSE_TEMPLATES) {
      for (let i = 0; i < 500; i++) {
        const p = generateInverse(t)
        expect(Number.isInteger(p.answer)).toBe(true)
        expect(p.answer).toBeGreaterThan(0)
        expect(p.c).toBeLessThan(1000)
        expect(p.template).toBe(t)
      }
    }
  })

  it('a+?=c 는 a + answer 가 c 다', () => {
    for (let i = 0; i < 300; i++) {
      const p = generateInverse('a+?=c')
      expect(p.a! + p.answer).toBe(p.c)
      expect(p.tag).toBe('inverse-add')
    }
  })

  it('?+b=c 는 answer + b 가 c 다', () => {
    for (let i = 0; i < 300; i++) {
      const p = generateInverse('?+b=c')
      expect(p.answer + p.b!).toBe(p.c)
      expect(p.tag).toBe('inverse-add')
    }
  })

  it('a-?=c 는 a - answer 가 c 다', () => {
    for (let i = 0; i < 300; i++) {
      const p = generateInverse('a-?=c')
      expect(p.a! - p.answer).toBe(p.c)
      expect(p.tag).toBe('inverse-sub')
    }
  })

  it('?-b=c 는 answer - b 가 c 다', () => {
    for (let i = 0; i < 300; i++) {
      const p = generateInverse('?-b=c')
      expect(p.answer - p.b!).toBe(p.c)
      expect(p.answer).toBeLessThan(1000)
      expect(p.tag).toBe('inverse-sub')
    }
  })
})

describe('inverseHint', () => {
  it('템플릿에 맞는 문장을 만든다', () => {
    const p = { ...generateInverse('a+?=c'), a: 27, c: 45, answer: 18 }
    expect(inverseHint(p)).toBe('27에 얼마를 더하면 45가 될까요?')
  })
})
```

> **위 테스트만으로는 난이도가 고정되지 않는다.** 관계식(`a + answer === c`)과 `< 1000` 상한만 지키면
> 어떤 크기의 수든 통과한다. (실증: `?-b=c`의 범위를 `randInt(5, 900)`으로 늘려 답이 959까지 나와도
> `expect(p.answer).toBeLessThan(1000)` 포함 7개 단언이 20,000회 전부 통과)
>
> 따라서 **arm별 도달 범위를 단언한다.** 실제 최댓값이 89인데 `<= 99`를 단언하면 10만큼의 조용한
> 드리프트 창이 남으므로, 아래 값과 정확히 일치시킨다:
>
> | 템플릿 | `a` | `b` | `c` | `answer` |
> |---|---|---|---|---|
> | `a+?=c` | 10–80 | — | 15–99 | 5–89 |
> | `?+b=c` | — | 10–80 | 15–99 | 5–89 |
> | `a-?=c` | 25–99 | — | 10–94 | 5–89 |
> | `?-b=c` | — | 5–40 | 10–59 | 15–99 |
>
> `inverseHint`도 **네 템플릿 모두** 고정 숫자로 문자열을 단언한다 — 한국어 문장의 오타는 테스트가
> 없으면 그대로 배포된다.
>
> ⚠️ **알려진 미해결 사항:** 조사가 고정 문자열이라 `${c}가 될까요?`가 숫자 읽기와 어긋난다
> (27은 "이십칠"이므로 `27이`가 맞다). 끝자리 0·1·3·6·7·8이면 자음으로 끝나 절반 이상이 비문이다.
> `을/를`도 동일. Phase 1 마무리 전 조사 선택 헬퍼로 처리한다.

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/engine/inverse.test.ts`
Expected: FAIL — `Failed to resolve import "./inverse"`

- [ ] **Step 3: 구현**

`src/engine/inverse.ts`:

```ts
import type { InverseItem, InverseTemplate } from '../data/types'

export const INVERSE_TEMPLATES: InverseTemplate[] = ['a+?=c', '?+b=c', 'a-?=c', '?-b=c']

function randInt(min: number, max: number, rand: () => number): number {
  return min + Math.floor(rand() * (max - min + 1))
}

/**
 * □ 채우기 문항을 만든다. 모든 값은 2학년 범위(1000 미만)이고 답은 자연수다.
 * 세로 형식이 아니라 가로식으로 출제한다 — 세로는 자릿수별 역추론이라 2학년에게 과하다.
 */
export function generateInverse(
  template: InverseTemplate,
  rand: () => number = Math.random
): Omit<InverseItem, 'id'> {
  switch (template) {
    case 'a+?=c': {
      const a = randInt(10, 80, rand)
      const answer = randInt(5, 99 - a, rand)
      return { kind: 'inverse', tag: 'inverse-add', template, a, c: a + answer, answer }
    }
    case '?+b=c': {
      const b = randInt(10, 80, rand)
      const answer = randInt(5, 99 - b, rand)
      return { kind: 'inverse', tag: 'inverse-add', template, b, c: answer + b, answer }
    }
    case 'a-?=c': {
      const a = randInt(25, 99, rand)
      const answer = randInt(5, a - 10, rand)
      return { kind: 'inverse', tag: 'inverse-sub', template, a, c: a - answer, answer }
    }
    case '?-b=c': {
      const b = randInt(5, 40, rand)
      const c = randInt(10, 59, rand)
      return { kind: 'inverse', tag: 'inverse-sub', template, b, c, answer: b + c }
    }
  }
}

/** 첫 문항에만 붙이는 문장 힌트. 매번 주면 힌트를 읽고 푸는 습관이 생긴다. */
export function inverseHint(item: Omit<InverseItem, 'id'>): string {
  switch (item.template) {
    case 'a+?=c':
      return `${item.a}에 얼마를 더하면 ${item.c}가 될까요?`
    case '?+b=c':
      return `얼마에 ${item.b}을 더하면 ${item.c}가 될까요?`
    case 'a-?=c':
      return `${item.a}에서 얼마를 빼면 ${item.c}가 될까요?`
    case '?-b=c':
      return `얼마에서 ${item.b}을 빼면 ${item.c}가 될까요?`
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/engine/inverse.test.ts`
Expected: 6개 PASS.

- [ ] **Step 5: 커밋**

```bash
git add -A
git commit -m "feat: □ 채우기 4템플릿 생성기 추가"
```

---

### Task 6: 유형 상태 파생

**Files:**
- Create: `src/engine/derive.ts`, `src/engine/derive.test.ts`

**Interfaces:**
- Consumes: `Day`, `Derived`, `TypeState`, `VerticalTag` (`src/data/types.ts`), `VERTICAL_ORDER` (`src/engine/vertical.ts`)
- Produces:
  - `RECENT_WINDOW = 10`, `OPEN_THRESHOLD = 0.9`
  - `deriveTypes(days: Day[]): Record<string, TypeState>`
  - `accuracy(state: TypeState | undefined): number` — 시도가 10회 미만이면 0
  - `openTags(types: Record<string, TypeState>): VerticalTag[]`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/engine/derive.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { deriveTypes, accuracy, openTags, RECENT_WINDOW } from './derive'
import type { Day, VerticalItem } from '../data/types'

function dayWith(date: string, tag: VerticalItem['tag'], results: boolean[]): Day {
  const sheet: VerticalItem[] = results.map((_, i) => ({
    id: `v${i}`,
    kind: 'vertical',
    tag,
    a: 47,
    b: 38,
    op: '+',
    answer: 85,
  }))
  const grades: Record<string, boolean> = {}
  results.forEach((ok, i) => (grades[`v${i}`] = ok))
  return { date, kind: 'normal', sheet, grades }
}

describe('deriveTypes', () => {
  it('채점된 문항만 이력에 쌓는다', () => {
    const types = deriveTypes([dayWith('2026-08-01', 'add2-carry', [true, false, true])])
    expect(types['add2-carry']?.attempts).toEqual([true, false, true])
  })

  it('채점 안 된 날은 무시한다', () => {
    const d = dayWith('2026-08-01', 'add2-carry', [true])
    delete d.grades
    expect(deriveTypes([d])['add2-carry']).toBeUndefined()
  })

  it('같은 days를 두 번 넣어도 같은 결과를 준다', () => {
    const days = [dayWith('2026-08-01', 'sub2-borrow', [true, false])]
    expect(deriveTypes(days)).toEqual(deriveTypes(days))
  })
})

describe('accuracy', () => {
  it('시도가 10회 미만이면 0이다', () => {
    expect(accuracy({ attempts: Array(9).fill(true) })).toBe(0)
    expect(accuracy(undefined)).toBe(0)
  })

  it('최근 10회만 본다', () => {
    const attempts = [...Array(10).fill(false), ...Array(10).fill(true)]
    expect(accuracy({ attempts })).toBe(1)
  })
})

describe('openTags', () => {
  it('기록이 없으면 첫 유형만 열린다', () => {
    expect(openTags({})).toEqual(['add2-nocarry'])
  })

  it('첫 유형이 90%를 넘으면 두 번째가 열린다', () => {
    const types = { 'add2-nocarry': { attempts: Array(RECENT_WINDOW).fill(true) } }
    expect(openTags(types)).toEqual(['add2-nocarry', 'sub2-noborrow'])
  })

  it('정확히 90%면 열린다 (경계값)', () => {
    const types = {
      'add2-nocarry': { attempts: [false, ...Array(RECENT_WINDOW - 1).fill(true)] },
    }
    expect(openTags(types)).toEqual(['add2-nocarry', 'sub2-noborrow'])
  })

  it('중간 유형이 미달이면 그 뒤는 안 열린다', () => {
    const types = {
      'add2-nocarry': { attempts: Array(RECENT_WINDOW).fill(true) },
      'sub2-noborrow': { attempts: [false, false, ...Array(RECENT_WINDOW - 2).fill(true)] },
    }
    expect(openTags(types)).toEqual(['add2-nocarry', 'sub2-noborrow'])
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/engine/derive.test.ts`
Expected: FAIL — `Failed to resolve import "./derive"`

- [ ] **Step 3: 구현**

`src/engine/derive.ts`:

```ts
import type { Day, TypeState, VerticalTag } from '../data/types'
import { VERTICAL_ORDER } from './vertical'

/** 숙련 판정에 쓰는 최근 시도 개수. */
export const RECENT_WINDOW = 10

/** 다음 유형이 열리는 정답률. */
export const OPEN_THRESHOLD = 0.9

/**
 * 로그에서 유형별 정오답 이력을 뽑는다.
 * days는 날짜 오름차순을 전제한다. 채점되지 않은 날은 건너뛴다.
 */
export function deriveTypes(days: Day[]): Record<string, TypeState> {
  const types: Record<string, TypeState> = {}
  for (const day of days) {
    if (!day.grades) continue
    for (const item of day.sheet) {
      if (item.kind !== 'vertical' && item.kind !== 'inverse') continue
      const graded = day.grades[item.id]
      if (graded === undefined) continue
      const state = (types[item.tag] ??= { attempts: [] })
      state.attempts.push(graded)
    }
  }
  return types
}

/** 최근 RECENT_WINDOW회 정답률. 표본이 부족하면 0으로 본다(아직 증명되지 않음). */
export function accuracy(state: TypeState | undefined): number {
  if (!state) return 0
  const recent = state.attempts.slice(-RECENT_WINDOW)
  if (recent.length < RECENT_WINDOW) return 0
  return recent.filter(Boolean).length / recent.length
}

/**
 * 출제 가능한 유형 목록.
 * 앞에서부터 하나씩 열리며, 열린 유형은 사라지지 않는다(유지 복습).
 */
export function openTags(types: Record<string, TypeState>): VerticalTag[] {
  const open: VerticalTag[] = []
  for (const tag of VERTICAL_ORDER) {
    open.push(tag)
    if (accuracy(types[tag]) < OPEN_THRESHOLD) break
  }
  return open
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/engine/derive.test.ts`
Expected: 9개 PASS (`deriveTypes` 3, `accuracy` 2, `openTags` 4).

- [ ] **Step 5: 커밋**

```bash
git add -A
git commit -m "feat: 유형별 정답률 파생과 열린 유형 판정 추가"
```

---

### Task 7: 하루 문항 조립

**Files:**
- Create: `src/engine/compose.ts`, `src/engine/compose.test.ts`

**Interfaces:**
- Consumes: `generateVertical`, `GenerationError`, `VERTICAL_ORDER` (vertical), `generateInverse`, `inverseHint`, `INVERSE_TEMPLATES` (inverse), `openTags`, `accuracy` (derive), `Settings`, `TypeState`, `SheetItem`
- Produces:
  - `composeSheet(input: { settings: Settings; types: Record<string, TypeState>; rand?: () => number }): SheetItem[]`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/engine/compose.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { composeSheet } from './compose'
import { satisfies } from './vertical'
import { DEFAULT_SETTINGS } from '../data/types'
import type { TypeState } from '../data/types'

const mastered = (): TypeState => ({ attempts: Array(10).fill(true) })

describe('composeSheet', () => {
  it('설정된 문항 수대로 만든다', () => {
    const sheet = composeSheet({ settings: DEFAULT_SETTINGS, types: {} })
    expect(sheet.filter((i) => i.kind === 'vertical')).toHaveLength(8)
    expect(sheet.filter((i) => i.kind === 'inverse')).toHaveLength(2)
    expect(sheet).toHaveLength(10)
  })

  it('verticalCount가 6으로 하향되면 그만큼만 만든다', () => {
    const settings = { ...DEFAULT_SETTINGS, verticalCount: 6 as const }
    const sheet = composeSheet({ settings, types: {} })
    expect(sheet.filter((i) => i.kind === 'vertical')).toHaveLength(6)
    expect(sheet).toHaveLength(8)
  })

  it('문항 id가 모두 다르다', () => {
    const sheet = composeSheet({ settings: DEFAULT_SETTINGS, types: {} })
    expect(new Set(sheet.map((i) => i.id)).size).toBe(sheet.length)
  })

  it('같은 수식이 하루에 중복되지 않는다', () => {
    for (let n = 0; n < 50; n++) {
      const sheet = composeSheet({ settings: DEFAULT_SETTINGS, types: {} })
      const keys = sheet
        .filter((i) => i.kind === 'vertical')
        .map((i) => (i.kind === 'vertical' ? `${i.a}${i.op}${i.b}` : ''))
      expect(new Set(keys).size).toBe(keys.length)
    }
  })

  it('열린 유형만 출제한다', () => {
    const sheet = composeSheet({ settings: DEFAULT_SETTINGS, types: {} })
    for (const item of sheet) {
      if (item.kind === 'vertical') expect(item.tag).toBe('add2-nocarry')
    }
  })

  it('유형이 열리면 그 유형도 섞여 나온다', () => {
    const types = { 'add2-nocarry': mastered(), 'sub2-noborrow': mastered() }
    const tags = new Set<string>()
    for (let n = 0; n < 30; n++) {
      for (const item of composeSheet({ settings: DEFAULT_SETTINGS, types })) {
        if (item.kind === 'vertical') tags.add(item.tag)
      }
    }
    expect(tags.has('add2-carry')).toBe(true)
  })

  it('만들어진 세로셈은 전부 자기 유형 정의를 만족한다', () => {
    const types = {
      'add2-nocarry': mastered(),
      'sub2-noborrow': mastered(),
      'add2-carry': mastered(),
      'sub2-borrow': mastered(),
      'add3-carry1': mastered(),
      'add3-carry2': mastered(),
      'sub3-borrow1': mastered(),
      'sub3-borrow2': mastered(),
    }
    for (let n = 0; n < 50; n++) {
      for (const item of composeSheet({ settings: DEFAULT_SETTINGS, types })) {
        if (item.kind === 'vertical') expect(satisfies(item.tag, item.a, item.b)).toBe(true)
      }
    }
  })

  it('첫 □ 문항에만 힌트가 붙는다', () => {
    const sheet = composeSheet({ settings: DEFAULT_SETTINGS, types: {} })
    const inv = sheet.filter((i) => i.kind === 'inverse')
    expect(inv[0]?.kind === 'inverse' && inv[0].hint).toBeTruthy()
    expect(inv[1]?.kind === 'inverse' && inv[1].hint).toBeUndefined()
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/engine/compose.test.ts`
Expected: FAIL — `Failed to resolve import "./compose"`

- [ ] **Step 3: 구현**

`src/engine/compose.ts`:

```ts
import type { InverseItem, SheetItem, Settings, TypeState, VerticalItem, VerticalTag } from '../data/types'
import { GenerationError, VERTICAL_ORDER, generateVertical } from './vertical'
import { INVERSE_TEMPLATES, generateInverse, inverseHint } from './inverse'
import { accuracy, openTags, RECENT_WINDOW } from './derive'

/** 같은 수식 중복을 피하기 위한 재시도 횟수. */
const DEDUP_ATTEMPTS = 60

function pickWeighted(tags: VerticalTag[], weights: number[], rand: () => number): VerticalTag {
  const total = weights.reduce((s, w) => s + w, 0)
  let r = rand() * total
  for (let i = 0; i < tags.length; i++) {
    r -= weights[i]!
    if (r <= 0) return tags[i]!
  }
  return tags[tags.length - 1]!
}

/**
 * 유형별 가중치. 정답률이 낮을수록 크게 나오고,
 * 가장 최근에 열린 유형에는 도입 가산점을 준다.
 */
function weightsFor(tags: VerticalTag[], types: Record<string, TypeState>): number[] {
  return tags.map((tag, i) => {
    const base = 1 - accuracy(types[tag]) + 0.1
    const isNewest = i === tags.length - 1 && tags.length > 1
    // 도입 가산점은 "아직 판단할 표본이 없는 동안"만 붙인다. 시도 횟수로 재는 이유:
    // accuracy()는 미시도와 표본부족을 둘 다 0으로 돌려주므로 둘을 구분하지 못한다.
    // 이 게이트가 없으면 9개 유형이 전부 열린 뒤 sub-zero가 숙달 후에도 가산점을 영구 유지한다.
    const attemptCount = types[tag]?.attempts.length ?? 0
    const stillIntroducing = attemptCount < RECENT_WINDOW
    return isNewest && stillIntroducing ? base + 0.6 : base
  })
}

/**
 * 요청한 유형으로 문항을 만들되, 생성에 실패하면
 * 도입 순서상 더 앞(= 더 쉬운) 유형으로 폴백한다. 빈 문제지는 내지 않는다.
 */
function generateWithFallback(
  tag: VerticalTag,
  rand: () => number
): Omit<VerticalItem, 'id'> {
  let index = VERTICAL_ORDER.indexOf(tag)
  while (index >= 0) {
    try {
      return generateVertical(VERTICAL_ORDER[index]!, rand)
    } catch (e) {
      if (!(e instanceof GenerationError)) throw e
      index--
    }
  }
  throw new GenerationError(`${tag} (폴백 전부 실패)`)
}

/**
 * 그날 종이 문항을 조립한다.
 * 결과는 호출부가 days[date].sheet에 그대로 저장하며, 재인쇄 시 재생성하지 않는다.
 */
export function composeSheet(input: {
  settings: Settings
  types: Record<string, TypeState>
  rand?: () => number
}): SheetItem[] {
  const rand = input.rand ?? Math.random
  const tags = openTags(input.types)
  const weights = weightsFor(tags, input.types)

  const items: SheetItem[] = []
  const seen = new Set<string>()

  for (let i = 0; i < input.settings.verticalCount; i++) {
    let made: Omit<VerticalItem, 'id'> | null = null
    for (let attempt = 0; attempt < DEDUP_ATTEMPTS; attempt++) {
      const candidate = generateWithFallback(pickWeighted(tags, weights, rand), rand)
      const key = `${candidate.a}${candidate.op}${candidate.b}`
      if (seen.has(key)) continue
      seen.add(key)
      made = candidate
      break
    }
    if (!made) {
      // 중복을 피하지 못하면 중복을 허용하는 대신 빈 자리를 두지 않는다.
      made = generateWithFallback(tags[0]!, rand)
    }
    items.push({ ...made, id: `v${i + 1}` })
  }

  for (let i = 0; i < input.settings.inverseCount; i++) {
    // rand는 주입받는 값이라 정확히 1.0이 올 수 있다. 클램프하지 않으면 인덱스가 범위를 넘어
    // template이 undefined가 되고, 첫 문항이면 inverseHint에서 던져 문제지 전체가 날아간다.
    const templateIndex = Math.min(
      INVERSE_TEMPLATES.length - 1,
      Math.floor(rand() * INVERSE_TEMPLATES.length)
    )
    const template = INVERSE_TEMPLATES[templateIndex]!
    const base = generateInverse(template, rand)
    const item: InverseItem = { ...base, id: `inv${i + 1}` }
    if (i === 0) item.hint = inverseHint(base)
    items.push(item)
  }

  return items
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run`
Expected: 전체 41개 PASS (dates 7 + db 5 + vertical 6 + inverse 6 + derive 9 + compose 8).

- [ ] **Step 5: 커밋**

```bash
git add -A
git commit -m "feat: 하루 문항 조립기와 유형 폴백 추가"
```

---

### Task 8: 앱 셸과 홈 화면

**Files:**
- Create: `src/ui.ts`, `src/screens/home.ts`, `src/styles/app.css`
- Modify: `src/main.ts`, `index.html`

**Interfaces:**
- Consumes: `getMeta`, `putMeta`, `getAllDays` (db), `dayKey` (dates), `Day` (types)
- Produces:
  - `src/ui.ts`: `navigate(hash: string): void`, `showError(message: string): void`, `el(html: string): HTMLElement`, `formatDate(key: string): string`
  - `src/screens/home.ts`: `renderHome(root: HTMLElement): Promise<void>`

> `navigate`/`showError`를 `main.ts`가 아니라 `ui.ts`에 두는 이유: 화면 모듈이 `main.ts`를 import하고 `main.ts`가 다시 화면을 import하면 순환 참조가 생긴다. 지금은 동작하더라도 모듈 초기화 순서에 의존하는 함정이 남는다.

- [ ] **Step 1: 스타일과 앱 셸 작성**

`src/styles/app.css`:

```css
:root {
  --fg: #111;
  --muted: #777;
  --line: #ddd;
  font-family: -apple-system, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif;
}
* {
  box-sizing: border-box;
}
body {
  margin: 0;
  color: var(--fg);
  background: #fafafa;
  -webkit-text-size-adjust: 100%;
}
#app {
  max-width: 560px;
  margin: 0 auto;
  padding: 24px 20px 48px;
}
h1 {
  font-size: 26px;
  letter-spacing: -0.02em;
  margin: 0 0 4px;
}
.date {
  color: var(--muted);
  font-size: 14px;
  margin-bottom: 20px;
}
.streak {
  text-align: center;
  font-size: 17px;
  font-weight: 700;
  margin: 18px 0 22px;
}
.step {
  display: block;
  width: 100%;
  text-align: left;
  background: #fff;
  border: 1.5px solid var(--fg);
  border-radius: 10px;
  padding: 18px 20px;
  margin-bottom: 12px;
  font-size: 18px;
  font-weight: 700;
  color: var(--fg);
  cursor: pointer;
}
.step small {
  display: block;
  font-weight: 400;
  font-size: 13px;
  color: var(--muted);
  margin-top: 4px;
}
.step.done {
  border-color: var(--line);
  color: var(--muted);
}
.banner {
  background: var(--fg);
  color: #fff;
  border-radius: 8px;
  padding: 12px 16px;
  font-size: 14px;
  margin-bottom: 16px;
  cursor: pointer;
}
.error {
  background: #b00020;
  color: #fff;
  padding: 12px 16px;
  font-size: 14px;
  line-height: 1.5;
}
.setup input {
  width: 100%;
  font-size: 18px;
  padding: 12px 14px;
  border: 1.5px solid var(--fg);
  border-radius: 8px;
  margin: 10px 0 14px;
}
```

`index.html`의 `<head>`에 스타일 링크 추가:

```html
    <link rel="stylesheet" href="/src/styles/app.css" />
```

`src/ui.ts` (화면 모듈이 공유하는 유틸. 화면을 import하지 않으므로 순환이 없다):

```ts
/** 상단 고정 에러 배너. 조용한 실패를 만들지 않는다. */
export function showError(message: string): void {
  let bar = document.querySelector<HTMLDivElement>('#error-bar')
  if (!bar) {
    bar = document.createElement('div')
    bar.id = 'error-bar'
    bar.className = 'error'
    document.body.prepend(bar)
  }
  bar.textContent = message
}

export function navigate(hash: string): void {
  location.hash = hash
}

/** HTML 문자열을 엘리먼트 하나로 만든다. */
export function el(html: string): HTMLElement {
  const t = document.createElement('template')
  t.innerHTML = html.trim()
  return t.content.firstElementChild as HTMLElement
}

/** "2026-08-02" → "8월 2일 토요일" */
export function formatDate(key: string, withYear = false): string {
  const [y, m, d] = key.split('-').map(Number)
  const date = new Date(y!, m! - 1, d!)
  const week = ['일', '월', '화', '수', '목', '금', '토'][date.getDay()]
  return `${withYear ? `${y}년 ` : ''}${m}월 ${d}일 ${week}요일`
}
```

`src/main.ts` 전체 교체:

```ts
import { renderHome } from './screens/home'
import { showError } from './ui'

const app = document.querySelector<HTMLDivElement>('#app')!

async function route(): Promise<void> {
  try {
    await renderHome(app)
  } catch (e) {
    showError(`화면을 여는 데 실패했어요: ${(e as Error).message}`)
  }
}

window.addEventListener('hashchange', route)
route()
```

- [ ] **Step 2: 홈 화면 구현**

`src/screens/home.ts`:

```ts
import { getAllDays, getMeta, putMeta } from '../data/db'
import { dayKey } from '../engine/dates'
import type { Day } from '../data/types'
import { el, formatDate, navigate, showError } from '../ui'

/** 채점까지 끝난 날의 수. 스프린트는 Phase 2에서 합류한다. */
function completedCount(days: Day[]): number {
  return days.filter((d) => d.grades && Object.keys(d.grades).length > 0).length
}

/** 채점이 비어 있는 가장 최근 과거 날짜. 없으면 null. */
function pendingGradeDate(days: Day[], today: string): string | null {
  for (let i = days.length - 1; i >= 0; i--) {
    const d = days[i]!
    if (d.date >= today) continue
    if (!d.grades || Object.keys(d.grades).length === 0) return d.date
  }
  return null
}

async function renderSetup(root: HTMLElement): Promise<void> {
  root.replaceChildren(
    el(`
      <div class="setup">
        <h1>하루치</h1>
        <p class="date">아이 이름을 알려주세요. 문장제에 이름이 들어가요.</p>
        <input id="name" placeholder="예: 서연" autocomplete="off" />
        <button class="step" id="save">시작하기</button>
      </div>
    `)
  )
  root.querySelector('#save')!.addEventListener('click', async () => {
    const input = root.querySelector<HTMLInputElement>('#name')!
    const name = input.value.trim()
    if (!name) {
      input.focus()
      return
    }
    try {
      const meta = await getMeta()
      meta.settings.childName = name
      await putMeta(meta)
      await renderHome(root)
    } catch (e) {
      showError(`설정을 저장하지 못했어요: ${(e as Error).message}`)
    }
  })
}

export async function renderHome(root: HTMLElement): Promise<void> {
  const meta = await getMeta()
  if (!meta.settings.childName) return renderSetup(root)

  const days = await getAllDays()
  const today = dayKey(new Date())
  const todayDay = days.find((d) => d.date === today)
  const printed = Boolean(todayDay?.sheet.length)
  const graded = Boolean(todayDay?.grades && Object.keys(todayDay.grades).length > 0)
  const pending = pendingGradeDate(days, today)

  root.replaceChildren(
    el(`
      <div>
        <h1>하루치</h1>
        <div class="date">${formatDate(today)}</div>
        <div class="streak">✅ ${completedCount(days)}일 완료</div>
        ${
          pending
            ? `<div class="banner" id="pending">${formatDate(pending)} 채점이 안 됐어요 — 지금 하기</div>`
            : ''
        }
        <button class="step ${printed ? 'done' : ''}" id="print">
          ${printed ? '✓ ' : ''}문제지 인쇄
          <small>세로셈 ${meta.settings.verticalCount} + □ 채우기 ${meta.settings.inverseCount}</small>
        </button>
        <button class="step ${graded ? 'done' : ''}" id="grade">
          ${graded ? '✓ ' : ''}채점하기
          <small>${printed ? '틀린 것만 눌러주세요' : '문제지를 먼저 인쇄해주세요'}</small>
        </button>
      </div>
    `)
  )

  root.querySelector('#print')!.addEventListener('click', () => navigate('#/print'))
  root.querySelector('#grade')!.addEventListener('click', () => {
    if (!printed) return
    navigate('#/grade')
  })
  root.querySelector('#pending')?.addEventListener('click', () => navigate(`#/grade/${pending}`))
}
```

- [ ] **Step 3: 라우팅 확장**

**라우트는 화면이 생길 때 함께 추가한다.** Step 1의 `route()`는 홈만 처리하며 이 Task에서는 더 늘리지 않는다.
Task 9가 `#/print` 분기를, Task 10이 `#/grade` 분기를 각자 자기 화면과 같은 커밋에 넣는다.

> **없는 모듈로 가는 라우트를 미리 깔면 안 된다.** Vite는 `main.ts` 안의 리터럴 문자열 동적 import를
> transform 시점에 **즉시 해석**하므로, 그 분기가 실행되지 않아도 **dev 서버가 500을 반환한다.**
> `tsc --noEmit`만 실패하는 게 아니라 앱을 실제 URL로 열 수조차 없어져, 이 Task의 브라우저 검증(Step 4)이
> 불가능해진다. 라우트를 화면과 함께 추가하면 빌드도 dev 서버도 한 번도 깨지지 않는다.

Task 9·10이 각자 추가할 최종 형태는 이렇게 된다 (참고용 — 지금 쓰지 말 것):

```ts
async function route(): Promise<void> {
  const hash = location.hash || '#/'
  try {
    if (hash.startsWith('#/print')) {
      const { renderPrint } = await import('./screens/print-sheet')
      await renderPrint(app)
    } else if (hash.startsWith('#/grade')) {
      const { renderGrade } = await import('./screens/grade')
      const date = hash.split('/')[2] || undefined
      await renderGrade(app, date)
    } else {
      await renderHome(app)
    }
  } catch (e) {
    showError(`화면을 여는 데 실패했어요: ${(e as Error).message}`)
  }
}
```

`hash.split('/')[2] || undefined`의 `|| undefined`가 중요하다 — `#/grade/`처럼 슬래시로 끝나면
`split`이 `''`를 주는데, `renderGrade`의 `date ?? dayKey(...)`는 nullish 병합이라 빈 문자열을 통과시켜
`getDay('')`로 조회하게 된다.

- [ ] **Step 4: 타입 검사와 개발 서버 확인**

라우트를 늘리지 않았으므로 **빌드와 dev 서버가 모두 정상이어야 한다.** 먼저 확인:

```bash
npm test          # 57개 통과
npx tsc --noEmit  # 에러 없음
npm run dev
```

브라우저에서 `http://localhost:5173/haruchi/` 를 열어 확인:
- 최초 진입 시 이름 입력 화면이 뜬다
- 이름을 넣고 "시작하기"를 누르면 홈으로 넘어간다
- 새로고침해도 이름 입력 화면이 다시 뜨지 않는다 (IndexedDB에 저장됨)
- `✅ 0일 완료`가 보이고 버튼 2개가 뜬다

- [ ] **Step 5: 커밋**

```bash
git add -A
git commit -m "feat: 앱 셸, 해시 라우팅, 홈 화면과 최초 이름 설정 추가"
```

---

### Task 9: 인쇄 화면

**Files:**
- Create: `src/screens/print-sheet.ts`, `src/styles/print.css`
- Modify: `index.html` (print.css 링크 추가)

**Interfaces:**
- Consumes: `getDay`, `putDay`, `getMeta`, `getAllDays` (db), `dayKey` (dates), `deriveTypes` (derive), `composeSheet` (compose), `el`/`formatDate`/`navigate`/`showError` (ui)
- Produces: `renderPrint(root: HTMLElement): Promise<void>`

- [ ] **Step 1: 인쇄 스타일 작성**

`src/styles/print.css`:

```css
.sheet {
  background: #fff;
  color: #111;
  padding: 30px 36px;
}
.sheet-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  border-bottom: 2px solid #111;
  padding-bottom: 8px;
  margin-bottom: 16px;
}
.sheet-title {
  font-size: 20px;
  font-weight: 800;
}
.sheet-date {
  font-size: 11px;
  color: #555;
  margin-top: 3px;
}
.sheet-name u {
  display: inline-block;
  width: 92px;
  text-decoration: none;
  border-bottom: 1px solid #111;
}
.sheet-sec {
  font-size: 13px;
  font-weight: 700;
  margin: 0 0 12px;
}
.vgrid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 40px;
}
.vprob {
  display: flex;
  gap: 9px;
  align-items: flex-start;
}
.vnum {
  font-size: 11.5px;
  color: #888;
  width: 15px;
  flex: none;
  padding-top: 25px;
}
.vcalc {
  font-size: 24px;
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
}
/* 받아올림·받아내림 숫자를 적는 공간. 좁히지 말 것. */
.vcarry {
  height: 25px;
}
.vline b {
  display: inline-block;
  width: 21px;
  text-align: center;
  font-weight: 400;
}
.vline i {
  display: inline-block;
  width: 27px;
  text-align: center;
  font-style: normal;
}
.vrule {
  border-top: 2px solid #111;
  width: 129px;
  margin-top: 4px;
}
/* 답을 적는 공간. */
.vans {
  height: 38px;
}
.inv {
  border: 1.5px solid #111;
  border-radius: 6px;
  padding: 13px 18px;
  margin-bottom: 10px;
}
.inv-eq {
  font-size: 26px;
  font-weight: 700;
}
.inv-eq .n {
  font-size: 12px;
  color: #888;
  font-weight: 400;
  margin-right: 9px;
  vertical-align: 5px;
}
.inv-box {
  display: inline-block;
  width: 56px;
  height: 37px;
  border: 1.8px solid #111;
  border-radius: 5px;
  vertical-align: -8px;
  margin: 0 6px;
}
.inv-hint {
  font-size: 12.5px;
  color: #666;
  margin-top: 8px;
}

@page {
  size: A4;
  margin: 12mm;
}

@media print {
  body {
    background: #fff;
  }
  #app {
    max-width: none;
    padding: 0;
  }
  .no-print {
    display: none !important;
  }
  .sheet {
    padding: 0;
    page-break-inside: avoid;
  }
}
```

`index.html`의 `<head>`에 추가:

```html
    <link rel="stylesheet" href="/src/styles/print.css" />
```

- [ ] **Step 2: 인쇄 화면 구현**

`src/screens/print-sheet.ts`:

```ts
import { getDay, getMeta, putDay, getAllDays } from '../data/db'
import { dayKey } from '../engine/dates'
import { deriveTypes } from '../engine/derive'
import { composeSheet } from '../engine/compose'
import type { Day, InverseItem, VerticalItem } from '../data/types'
import { el, formatDate, navigate, showError } from '../ui'

function digits(n: number): string {
  return String(n)
    .padStart(3, ' ')
    .split('')
    .map((c) => `<i>${c === ' ' ? '' : c}</i>`)
    .join('')
}

function verticalHtml(item: VerticalItem, index: number): string {
  const marks = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭'
  return `
    <div class="vprob">
      <span class="vnum">${marks[index] ?? index + 1}</span>
      <div class="vcalc">
        <div class="vcarry"></div>
        <div class="vline"><b></b>${digits(item.a)}</div>
        <div class="vline"><b>${item.op}</b>${digits(item.b)}</div>
        <div class="vrule"></div>
        <div class="vans"></div>
      </div>
    </div>`
}

function inverseHtml(item: InverseItem, index: number): string {
  const marks = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭'
  const box = '<span class="inv-box"></span>'
  const eq =
    item.template === 'a+?=c'
      ? `${item.a} + ${box} = ${item.c}`
      : item.template === '?+b=c'
        ? `${box} + ${item.b} = ${item.c}`
        : item.template === 'a-?=c'
          ? `${item.a} − ${box} = ${item.c}`
          : `${box} − ${item.b} = ${item.c}`
  return `
    <div class="inv">
      <div class="inv-eq"><span class="n">${marks[index] ?? index + 1}</span>${eq}</div>
      ${item.hint ? `<div class="inv-hint">${item.hint}</div>` : ''}
    </div>`
}

/**
 * 오늘 문제지를 연다.
 * 이미 만들어진 날이면 저장된 sheet를 그대로 렌더한다 — 재인쇄 시 문제가 달라지면
 * 채점 화면이 어느 종이 기준인지 알 수 없게 된다.
 */
export async function renderPrint(root: HTMLElement): Promise<void> {
  const today = dayKey(new Date())
  let day = await getDay(today)

  if (!day) {
    try {
      const meta = await getMeta()
      const types = deriveTypes(await getAllDays())
      const sheet = composeSheet({ settings: meta.settings, types })
      day = { date: today, kind: 'normal', sheet } satisfies Day
      await putDay(day)
    } catch (e) {
      showError(`문제지를 만들지 못했어요: ${(e as Error).message}`)
      return
    }
  }

  const verticals = day.sheet.filter((i): i is VerticalItem => i.kind === 'vertical')
  const inverses = day.sheet.filter((i): i is InverseItem => i.kind === 'inverse')

  root.replaceChildren(
    el(`
      <div>
        <div class="no-print" style="display:flex;gap:8px;margin-bottom:16px">
          <button class="step" id="back" style="margin:0">← 홈</button>
          <button class="step" id="print" style="margin:0">인쇄하기</button>
        </div>
        <div class="sheet">
          <div class="sheet-head">
            <div>
              <div class="sheet-title">하루치</div>
              <div class="sheet-date">${formatDate(today, true)}</div>
            </div>
            <div class="sheet-name">이름 <u></u></div>
          </div>
          <div class="sheet-sec">1. 계산해 보세요.</div>
          <div class="vgrid">${verticals.map((v, i) => verticalHtml(v, i)).join('')}</div>
          <div class="sheet-sec" style="margin-top:14px">2. □ 안에 알맞은 수를 써넣으세요.</div>
          ${inverses.map((v, i) => inverseHtml(v, verticals.length + i)).join('')}
        </div>
      </div>
    `)
  )

  root.querySelector('#back')!.addEventListener('click', () => navigate('#/'))
  root.querySelector('#print')!.addEventListener('click', () => window.print())
}
```

- [ ] **Step 3: 라우트 추가**

`src/main.ts`의 `route()`에 `#/print` 분기를 넣는다 (Task 8이 홈만 남겨뒀다):

```ts
    if (hash.startsWith('#/print')) {
      const { renderPrint } = await import('./screens/print-sheet')
      await renderPrint(app)
    } else {
      await renderHome(app)
    }
```

- [ ] **Step 4: 개발 서버로 확인**

```bash
npm run dev
```

`http://localhost:5173/haruchi/#/print` 에서 확인:
- 세로셈 8문항이 2열로, □ 채우기 2문항이 아래에 뜬다
- 첫 □ 문항에만 힌트 문장이 있다
- **정답이 어디에도 보이지 않는다**
- "인쇄하기"를 누르면 인쇄 미리보기가 뜨고 상단 버튼 2개는 미리보기에서 사라진다
- 새로고침해도 **같은 문제**가 나온다

- [ ] **Step 5: 커밋**

```bash
git add -A
git commit -m "feat: 문제지 인쇄 화면과 A4 인쇄 스타일 추가"
```

---

### Task 10: 채점 화면

**Files:**
- Create: `src/screens/grade.ts`
- Modify: `src/styles/app.css` (채점 UI 스타일 추가)

**Interfaces:**
- Consumes: `getDay`, `putDay` (db), `dayKey` (dates), `Day`/`Mood`/`SheetItem` (types), `el`/`navigate`/`showError` (ui)
- Produces: `renderGrade(root: HTMLElement, date?: string): Promise<void>`

- [ ] **Step 1: 채점 UI 스타일 추가**

`src/styles/app.css` 끝에 덧붙인다:

```css
.grade-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 8px;
  margin-bottom: 8px;
}
.grade-row .q {
  flex: 1;
  font-size: 17px;
  font-variant-numeric: tabular-nums;
}
.grade-row .ans {
  color: var(--muted);
  font-size: 15px;
}
.mark {
  width: 52px;
  height: 44px;
  font-size: 22px;
  border: 1.5px solid var(--fg);
  border-radius: 8px;
  background: #fff;
  cursor: pointer;
}
.mark.wrong {
  background: var(--fg);
  color: #fff;
}
.moods {
  display: flex;
  gap: 8px;
  margin: 18px 0;
}
.mood {
  flex: 1;
  padding: 14px 6px;
  font-size: 14px;
  border: 1.5px solid var(--line);
  border-radius: 8px;
  background: #fff;
  cursor: pointer;
}
.mood.on {
  border-color: var(--fg);
  font-weight: 700;
}
```

- [ ] **Step 2: 채점 화면 구현**

`src/screens/grade.ts`:

```ts
import { getDay, putDay } from '../data/db'
import { dayKey } from '../engine/dates'
import type { Day, Mood, SheetItem } from '../data/types'
import { el, navigate, showError } from '../ui'

function label(item: SheetItem): string {
  if (item.kind === 'vertical') return `${item.a} ${item.op} ${item.b}`
  if (item.kind === 'inverse') {
    switch (item.template) {
      case 'a+?=c':
        return `${item.a} + □ = ${item.c}`
      case '?+b=c':
        return `□ + ${item.b} = ${item.c}`
      case 'a-?=c':
        return `${item.a} − □ = ${item.c}`
      case '?-b=c':
        return `□ − ${item.b} = ${item.c}`
    }
  }
  return item.kind
}

const MOODS: { key: Mood; text: string }[] = [
  { key: 'easy', text: '😀 여유' },
  { key: 'ok', text: '😐 딱 맞음' },
  { key: 'hard', text: '😫 힘들어함' },
]

/**
 * 채점 화면. 모든 문항이 정답(⭕)이 기본값이고 틀린 것만 눌러 뒤집는다.
 * 보통 두세 번 탭이면 끝난다.
 */
export async function renderGrade(root: HTMLElement, date?: string): Promise<void> {
  const target = date ?? dayKey(new Date())
  const day = await getDay(target)

  if (!day) {
    root.replaceChildren(
      el(`
        <div>
          <h1>채점</h1>
          <p class="date">${target} 문제지가 없어요. 먼저 인쇄해주세요.</p>
          <button class="step" id="back">← 홈</button>
        </div>
      `)
    )
    root.querySelector('#back')!.addEventListener('click', () => navigate('#/'))
    return
  }

  const grades: Record<string, boolean> = {}
  for (const item of day.sheet) grades[item.id] = day.grades?.[item.id] ?? true
  let mood: Mood | undefined = day.mood

  root.replaceChildren(
    el(`
      <div>
        <h1>채점</h1>
        <div class="date">${target} · 틀린 것만 눌러주세요</div>
        <div id="rows"></div>
        <div class="date" style="margin-top:20px">오늘 어땠어?</div>
        <div class="moods">
          ${MOODS.map((m) => `<button class="mood" data-mood="${m.key}">${m.text}</button>`).join('')}
        </div>
        <button class="step" id="save">저장</button>
        <button class="step" id="back">← 홈</button>
      </div>
    `)
  )

  const rows = root.querySelector('#rows')!
  for (const item of day.sheet) {
    const row = el(`
      <div class="grade-row">
        <span class="q">${label(item)}</span>
        <span class="ans">${item.answer}</span>
        <button class="mark" data-id="${item.id}">⭕</button>
      </div>
    `)
    const button = row.querySelector<HTMLButtonElement>('.mark')!
    const paint = () => {
      const ok = grades[item.id]!
      button.textContent = ok ? '⭕' : '❌'
      button.classList.toggle('wrong', !ok)
    }
    button.addEventListener('click', () => {
      grades[item.id] = !grades[item.id]
      paint()
    })
    paint()
    rows.append(row)
  }

  const paintMoods = () => {
    root.querySelectorAll<HTMLButtonElement>('.mood').forEach((b) => {
      b.classList.toggle('on', b.dataset.mood === mood)
    })
  }
  root.querySelectorAll<HTMLButtonElement>('.mood').forEach((b) => {
    b.addEventListener('click', () => {
      mood = b.dataset.mood as Mood
      paintMoods()
    })
  })
  paintMoods()

  root.querySelector('#back')!.addEventListener('click', () => navigate('#/'))
  root.querySelector('#save')!.addEventListener('click', async () => {
    const updated: Day = { ...day, grades, mood, doneAt: new Date().toISOString() }
    try {
      await putDay(updated)
      navigate('#/')
    } catch (e) {
      showError(`채점을 저장하지 못했어요: ${(e as Error).message}`)
    }
  })
}
```

- [ ] **Step 3: 라우트 추가**

`src/main.ts`의 `route()`에 `#/grade` 분기를 넣어 라우터를 완성한다:

```ts
    } else if (hash.startsWith('#/grade')) {
      const { renderGrade } = await import('./screens/grade')
      const date = hash.split('/')[2] || undefined
      await renderGrade(app, date)
    } else {
```

`|| undefined`를 빠뜨리지 말 것 — `#/grade/`처럼 슬래시로 끝나면 `split`이 `''`를 주는데,
아래 `renderGrade`의 `date ?? dayKey(...)`는 nullish 병합이라 빈 문자열을 그대로 통과시켜
`getDay('')`를 조회하고 "문제지가 없어요" 화면에 빈 날짜를 찍는다.

- [ ] **Step 4: 타입 검사와 전체 테스트**

```bash
npm run build
npm test
```

Expected: 타입 오류 없이 `dist/` 생성, 테스트 전체 PASS.

- [ ] **Step 5: 손으로 한 바퀴 확인**

```bash
npm run dev
```

`http://localhost:5173/haruchi/` 에서:
- 인쇄 → 홈으로 돌아오면 "문제지 인쇄"에 `✓`가 붙는다
- 채점 → 전부 ⭕로 뜨고, 몇 개를 눌러 ❌로 바꾸고, `😐`를 누르고 저장
- 홈에서 `✅ 1일 완료`, "채점하기"에 `✓`
- 브라우저 저장소를 비우지 않은 채 새로고침해도 유지된다

- [ ] **Step 6: 커밋**

```bash
git add -A
git commit -m "feat: 채점 화면 추가 — 기본 정답, 틀린 것만 탭"
```

---

### Task 11: PWA 설정

**Files:**
- Modify: `vite.config.ts`, `src/main.ts`, `src/styles/app.css`
- Create: `public/icon-192.png`, `public/icon-512.png`

**Interfaces:**
- Consumes: 없음
- Produces: 홈 화면 추가 가능한 manifest, Service Worker, 새 버전 배너

- [ ] **Step 1: 아이콘 생성**

아이콘은 단색 배경에 흰 글자면 충분하다. macOS 기본 도구로 만든다:

```bash
mkdir -p public
cat > /tmp/icon.svg <<'SVG'
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
  <rect width="512" height="512" rx="96" fill="#111"/>
  <text x="256" y="330" font-size="220" font-family="-apple-system, sans-serif"
        font-weight="800" fill="#fff" text-anchor="middle">치</text>
</svg>
SVG
qlmanage -t -s 512 -o /tmp /tmp/icon.svg && cp /tmp/icon.svg.png public/icon-512.png
sips -z 192 192 public/icon-512.png --out public/icon-192.png
```

`qlmanage`가 실패하면 아무 이미지 편집기로 512×512, 192×192 PNG를 만들어 같은 경로에 둔다.

- [ ] **Step 2: vite-plugin-pwa 설정**

`vite.config.ts` 전체 교체:

```ts
/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: '/haruchi/',
  plugins: [
    VitePWA({
      // 자동 새로고침 금지. 스프린트 도중 리로드되면 세션이 날아간다.
      registerType: 'prompt',
      includeAssets: ['icon-192.png', 'icon-512.png'],
      manifest: {
        name: '하루치',
        short_name: '하루치',
        description: '매일 정해진 분량의 산수 연습',
        lang: 'ko',
        start_url: '/haruchi/',
        scope: '/haruchi/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#fafafa',
        theme_color: '#111111',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['src/test-setup.ts'],
  },
})
```

- [ ] **Step 3: 업데이트 배너 연결**

`src/styles/app.css` 끝에 추가:

```css
.update {
  position: fixed;
  left: 12px;
  right: 12px;
  bottom: 12px;
  background: var(--fg);
  color: #fff;
  border: none;
  border-radius: 10px;
  padding: 14px;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  z-index: 10;
}
```

`src/main.ts`의 `import` 아래에 추가하고, 파일 끝의 `route()` 호출 뒤에 `registerUpdatePrompt()`를 부른다:

```ts
import { registerSW } from 'virtual:pwa-register'

/** 새 버전이 준비되면 배너를 띄운다. 사용자가 누를 때만 새로고침한다. */
function registerUpdatePrompt(): void {
  const update = registerSW({
    onNeedRefresh() {
      const button = document.createElement('button')
      button.className = 'update'
      button.textContent = '새 버전이 있어요 — 눌러서 업데이트'
      button.addEventListener('click', () => void update(true))
      document.body.append(button)
    },
  })
}
```

`tsconfig.json`의 `types`에 PWA 클라이언트 타입을 더한다:

```json
    "types": ["vite/client", "vite-plugin-pwa/client"]
```

- [ ] **Step 4: 빌드와 프리뷰 확인**

```bash
npm run build
npm run preview
```

Expected:
- `dist/manifest.webmanifest`, `dist/sw.js` 생성
- `http://localhost:4173/haruchi/` 에서 앱이 정상 동작
- 브라우저 개발자도구 Application 탭에 Service Worker가 activated 상태로 뜬다

- [ ] **Step 5: 커밋**

```bash
git add -A
git commit -m "feat: PWA manifest와 Service Worker 추가 — 업데이트는 배너로만"
```

---

### Task 12: GitHub Pages 배포

**Files:**
- Create: `.github/workflows/deploy.yml`, `README.md`

**Interfaces:**
- Consumes: `npm test`, `npm run build` (Task 1)
- Produces: `main` push 시 자동 배포되는 GitHub Pages 사이트

- [ ] **Step 1: 워크플로 작성**

`.github/workflows/deploy.yml`:

```yaml
name: deploy

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm test
      - run: npm run build
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 2: README 작성**

`README.md`:

```markdown
# 하루치

초등 2학년 산수 연습 도구. 매일 A4 문제지를 인쇄해 손으로 풀고, 아이패드에서 채점한다.

- 설계: `docs/superpowers/specs/2026-08-02-haruchi-design.md`
- 계획: `docs/superpowers/plans/`

## 개발

```bash
mise install
npm ci
npm run dev      # http://localhost:5173/haruchi/
npm test
npm run build
```

## 배포

`main`에 push하면 GitHub Actions가 테스트 → 빌드 → GitHub Pages 배포를 수행한다.

**배포 URL은 변경하지 않는다.** 데이터가 origin별 IndexedDB에 저장되므로 주소가 바뀌면
기존 기록에 접근할 수 없다. 옮겨야 한다면 옛 주소에서 JSON을 내보내 새 주소에서 가져온다.
```

- [ ] **Step 3: 원격 저장소 연결과 Pages 활성화**

```bash
gh repo create haruchi --public --source=. --remote=origin --push
```

이어서 GitHub 저장소의 **Settings → Pages → Build and deployment → Source**를 `GitHub Actions`로 바꾼다.

- [ ] **Step 4: 배포 확인**

```bash
gh run watch
```

Expected: `deploy` 워크플로 성공. `https://<사용자명>.github.io/haruchi/` 접속 시 앱이 뜬다.

- [ ] **Step 5: 커밋**

```bash
git add -A
git commit -m "ci: GitHub Pages 자동 배포 추가"
git push
```

---

## 완료 후: 첫날 실물 확인

Phase 2로 넘어가기 전에 설계 문서 §14를 실물로 확인한다. 여기서 나온 결과가 Phase 2 계획에 반영된다.

- [ ] 아이패드 Safari로 배포 URL을 열고 **공유 → 홈 화면에 추가**. 아이콘과 이름이 제대로 뜨는지
- [ ] **홈 화면 아이콘으로 연 앱**에서 이름을 설정하고 문제지를 만든 뒤, **Safari 탭**에서 같은 URL을 열어 데이터가 보이는지 확인. 안 보이면 저장소가 분리된 것이므로 **앞으로 홈 화면 아이콘으로만 사용**한다
- [ ] AirPrint로 실제 A4 출력. 받아올림 적는 공간과 답 쓰는 공간이 충분한지 딸이 연필로 풀어 확인. 여백이 잘리면 `print.css`의 `@page margin` 조정
- [ ] 기내 모드로 전환한 뒤 앱을 열어 오프라인 동작 확인
- [ ] 채점을 하루 건너뛰고 다음 날 홈 화면에 "채점이 안 됐어요" 배너가 뜨는지 확인

---

## Phase 1 이후

- **Phase 2** — 구구단 스프린트 (`facts.ts` 유창 판정·간격 반복, 스프린트 화면, 🔥 연속일수 합류)
- **Phase 3** — 전략 존·문장제로 2장 완성, 주간/월간 리포트, JSON 백업, 4주 점검의 날

### Phase 1에서 의도적으로 미룬 것

설계 문서에는 있으나 Phase 1 범위 밖이다. 빠뜨린 것이 아니다.

| 항목 | 스펙 | 어디로 |
|---|---|---|
| 구구단 스프린트 전체 | §6.1 | Phase 2 |
| 🔥 연속일수 (스프린트 기준) | §6.8 | Phase 2 — Phase 1은 `✅ 완료일수`만 표시 |
| 전략 존 · 문장제 (2장) | §6.4, §6.5 | Phase 3 |
| 4주 점검의 날 | §6.7 | Phase 3 — `Day.kind`는 이미 `'checkup'`을 받는다 |
| 주간 · 월간 리포트 | §7 | Phase 3 |
| JSON 내보내기/가져오기 | §10 | Phase 3 |
| **mood 기반 자동 하향** (😫 3연속 → 세로셈 8→6) | §6.8 | Phase 3 — Phase 1은 mood를 **기록만** 한다. `composeSheet`는 이미 `verticalCount: 6`을 처리하므로 판정 로직만 붙이면 된다 |
| 저장 실패 시 오래된 `days` 정리 제안 | §11 | Phase 3 (백업 기능과 함께) |

각 Phase는 이 계획과 같은 형식으로 별도 문서에 쓴다.
