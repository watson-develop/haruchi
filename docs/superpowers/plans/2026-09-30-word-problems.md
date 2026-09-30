# 문장제 단계형 연습 — 구현계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 스프린트 뒤 하루 3문항의 단계형 문장제(`#/word`)를 붙이고, 틀린 단계를 기록해 부모 리포트에 보여 준다.

**Architecture:** 순수 엔진 `src/engine/word.ts`(유형 카탈로그·문제 생성·판정·출제)가 본체다. 기록은
`Day.word`(`WordAttempt[]`)로 기존 `sprint` 묶음에 편입되어 서버 스키마 변경 없이 동기화되고, 병합은
`merge.ts`의 `mergeWord`가 sid 단위로 "더 진행된 쪽"을 남긴다. 🔥는 `streak.ts`의 `dayDone` 하나가 판정한다.

**Tech Stack:** TypeScript, 바닐라 DOM, IndexedDB(fake-indexeddb로 테스트), vitest, SEED CSS 토큰.

**Spec:** `docs/superpowers/specs/2026-09-30-word-problems-design.md` (적대적 리뷰 3라운드 합의). 실행자는 이 계획과
스펙을 함께 읽는다. 둘이 어긋나면 멈추고 알린다.

## Global Constraints

- 모든 npm 명령 전에: `export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH"` (CLAUDE.md 「환경」)
- 작업은 브랜치 `word-problems`에서 한다. main에 직접 커밋하지 않는다. 끝나면 PR → `gh pr merge <n> --squash`
- `git add <명시 경로>`만. **`git add .` 금지**
- docs를 커밋하기 전에 `npm run format`
- 새 `putDay` 호출은 전부 `['sprint']`를 선언한다(스펙 §6). `applyPulled*`에는 손대지 않는다
- 파생값을 저장하지 않는다 — 원인·정답 여부·가중치는 매번 로그에서 계산(`Meta.derived` 비배선)
- `el()`/`innerHTML`에 들어가는 `problem` 안의 모든 문자열과 `exprs`는 `escapeHtml`을 거친다(스펙 §6 XSS)
- `WORD_TYPE_LABELS`·`WORD_GROUP_LABELS`를 거치지 않은 `type`·`kind`·`cause` 원문을 화면에 내지 않는다
- 곱셈 인수 범위는 `engine/facts.ts`의 `DAN_MIN`·`DAN_MAX`를 import한다(리터럴 2·9 금지)
- 색·크기는 `var(--seed-*)` 토큰. CSS 리셋에 `font`·`background`·`all` 축약형 금지
- 아이 화면 `#/word`의 `navigate()` 목적지는 `'#/'`뿐
- 문구는 `-어요` 체. 「틀렸어요」 금지(`docs/reference/karrot-DESIGN.md`)
- 실명 금지. 이름 풀은 `유나`·`민아`·`지호`·`서연`·`도윤`(옛 `WORD_NAMES`의 가상 이름). `지우`·`하루` 금지
- UI 태스크(6)는 코드를 열기 전에 `frontend-design` 스킬을 로드한다(CLAUDE.md 「UI 화면 작업」)
- 배포 URL·`vite.config.ts`의 `base`를 바꾸지 않는다. `SCHEMA_VERSION`을 올리지 않는다(스펙 §6)

## Review Focus

1. **같은 문항의 여러 벌이 만날 때**(재시도 저장·두 기기·옛 앱): 더 진행된 벌(보여 줌 < 답함 < 되짚기 단계 수)이
   남아야 한다 → Task 3의 `mergeWord 진행 순위` 테스트와 `옛 규칙 공존` 테스트
2. **가져오기·pull로 들어온 기형·미래 기록**(모르는 `type`·`kind`·`cause`, 범위 밖 `picks`, sid 없음): 미래 값은
   통과, 기형은 거부, 판정 함수는 던지지 않음 → Task 2 `firstFailedStep 방어`, Task 4 `validateDay word` 테스트
3. **문장제 첫날의 🔥**: 1~2문항만 끝낸 날 🔥가 줄지 않아야 한다 → Task 5 `wordStart는 3개 이상` 테스트
4. **문장제만 바뀐 날의 업로드**: `word`만 추가한 `putDay(…, ['sprint'])`가 표식·스탬프를 남겨야 한다 → Task 4 테스트
5. **되짚기 도중 닫고 다시 열기**: 이미 한 단계를 다시 묻지 않고 다음 단계부터 → Task 2 `reviewPosition` 테스트

---

## 파일 지도

| 파일                                                                                        | 책임                                                             | 태스크 |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------ |
| `src/data/types.ts`                                                                         | `WordAttempt`·`WordProblem`·`ReviewStep`·`WordWrong`, `Day.word` | 1      |
| `src/engine/word.ts` (신규)                                                                 | 카탈로그·조사·문제 생성(1) / 판정·가중치·출제(2)                 | 1, 2   |
| `src/engine/word.test.ts` (신규)                                                            | 엔진 속성·표 테스트                                              | 1, 2   |
| `src/engine/merge.ts`                                                                       | `mergeWord`·`hasSprintBundle`·`DAY_KNOWN`·`mergeDay`             | 3      |
| `src/engine/merge.test.ts`                                                                  | 진행 순위·속성·옛 규칙 공존                                      | 3      |
| `src/engine/backup.ts`                                                                      | `validateDay`의 `word` 검사                                      | 4      |
| `src/data/db.ts`, `src/data/sync.ts`                                                        | 묶음 판정을 `hasSprintBundle`로, 빈 `word` 제거, 채택 표식       | 4      |
| `src/engine/streak.ts`                                                                      | `wordStart`·`dayDone`, `sprintStreak`이 `dayDone` 사용           | 5      |
| `src/screens/home-child.ts`, `checkup.ts`                                                   | 홈 ② 상태, 낡은 주석                                             | 5      |
| `src/screens/word.ts` (신규), `main.ts`, `sprint.ts`, `src/styles/kid.css`                  | 아이 화면·라우팅·결과 화면 버튼                                  | 6      |
| `src/engine/report.ts`, `src/screens/report.ts`, `src/styles/parent.css`                    | `wordReport`·리포트 절                                           | 7      |
| `docs/PRD.md`, `docs/superpowers/HANDOFF.md`, `docs/reference/learning-science-evidence.md` | 문서                                                             | 8      |

---

### Task 0: 브랜치

- [ ] **Step 1: 브랜치를 만든다**

```bash
cd /Users/iseongho/workspace/haruchi
git switch main && git pull --ff-only
git switch -c word-problems
```

---

### Task 1: 데이터 타입 + 엔진 전반부(카탈로그·조사·문제 생성)

**Files:**

- Modify: `src/data/types.ts` (`Day` 정의 위에 타입 추가, `Day`에 필드 추가)
- Create: `src/engine/word.ts`
- Test: `src/engine/word.test.ts`

**Interfaces:**

- Produces (types.ts): `ReviewStep`, `WordWrong`, `WordProblem`, `WordAttempt`, `Day.word?: WordAttempt[]`
- Produces (word.ts): `WORD_PER_DAY`, `WORD_GROUPS`, `WordGroup`, `WORD_GROUP_LABELS`, `STORY_GROUPS`, `WORD_TYPES`,
  `WordTypeId`, `WORD_TYPE_LABELS`, `KEYWORD_TYPES`, `groupOf(type: string): WordGroup | null`, `typesOf(g)`,
  `josa`, `personJosa`, `numJosa`, `THINGS`, `NAMES`, `makeProblem(type: WordTypeId, r: () => number): WordProblem`

- [ ] **Step 1: 타입을 추가한다**

`src/data/types.ts`에서 `export type Day = {` 바로 위에 넣는다:

```ts
// ─────────── 문장제 (specs/2026-09-30-word-problems-design.md) ───────────

/**
 * 되짚기 한 단계. 저장본의 `kind`는 미래 버전이 새 값을 더할 수 있어 읽는 쪽은 모르는
 * `kind`를 건너뛴다(스펙 §6 검증 — 값 목록을 대조하지 않는다).
 */
export type ReviewStep =
  | { kind: 'story'; correct: number }
  | { kind: 'expr'; options: string[]; correct: number }
  | { kind: 'calc'; expr: string; value: number }

/** 예상 오답. `cause`는 저장본에서 미래 값이 올 수 있어 string이다. */
export type WordWrong = { expr: string; value: number; cause: string }

/** 문제 한 개 — 생성 시점에 통째로 박제된다(엔진이 바뀌어도 그날 본 문장·보기가 남는다). */
export type WordProblem = {
  type: string
  /** 없으면 키 자체를 넣지 않는다 — undefined를 적으면 서버 왕복 값과 영영 달라진다. */
  trap?: 'extra-number'
  text: string
  unit: string
  answer: number
  steps: { expr: string; value: number }[]
  review: ReviewStep[]
  wrongs: WordWrong[]
}

/**
 * 문장제 시도 하나. **원인·정답 여부를 저장하지 않는다** — 사실(무엇을 고르고 무엇을 썼나)만
 * 남기고 해석은 engine/word.ts가 매번 계산한다(derived 비배선과 같은 원칙).
 * sid는 문항 하나에 하나. 같은 sid로 여러 번 덮어쓰며(보여 줌 → 답함 → 되짚기 단계마다)
 * 병합은 더 진행된 쪽을 남긴다(engine/merge.ts의 mergeWord).
 */
export type WordAttempt = {
  sid: string
  problem: WordProblem
  /** 첫 답. null = 보여 줬지만 아직 답하지 않았다. */
  answer: number | null
  exprs: string[]
  ms: number
  picks: number[]
  calcs: number[]
}
```

그리고 `Day` 타입의 `doneAt?: string` 아래에 한 줄:

```ts
  word?: WordAttempt[]
```

- [ ] **Step 2: 실패하는 테스트를 쓴다**

`src/engine/word.test.ts`를 만든다:

```ts
import { describe, it, expect } from 'vitest'
import {
  KEYWORD_TYPES,
  NAMES,
  STORY_GROUPS,
  THINGS,
  WORD_GROUPS,
  WORD_TYPES,
  groupOf,
  josa,
  makeProblem,
  numJosa,
} from './word'
import { DAN_MAX, DAN_MIN } from './facts'
import type { WordProblem } from '../data/types'

/** mulberry32 — merge.test.ts와 같은 시드 PRNG. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 생성기의 필드를 믿지 않고 식 문자열을 직접 계산한다(스펙 §8). */
function evalExpr(e: string): number {
  const m = /^(\d+) ([+−×]) (\d+)$/.exec(e)
  if (!m) throw new Error(`식 모양이 아니다: ${e}`)
  const x = Number(m[1])
  const y = Number(m[3])
  return m[2] === '+' ? x + y : m[2] === '−' ? x - y : x * y
}

const SEEDS = Array.from({ length: 300 }, (_, i) => i + 1)
function all(): { type: string; seed: number; p: WordProblem }[] {
  return WORD_TYPES.flatMap((type) =>
    SEEDS.map((seed) => ({ type, seed, p: makeProblem(type, mulberry32(seed)) })),
  )
}
const PROBLEMS = all()

describe('카탈로그', () => {
  it('모든 유형 id의 앞부분이 묶음이다', () => {
    for (const t of WORD_TYPES) expect(WORD_GROUPS).toContain(groupOf(t))
  })
  it('모르는 유형은 묶음이 없다', () => {
    expect(groupOf('future:thing')).toBeNull()
    expect(groupOf('join')).toBeNull()
  })
  it('★ 유형은 전부 한 단계 문제다', () => {
    for (const t of KEYWORD_TYPES) {
      const p = makeProblem(t as (typeof WORD_TYPES)[number], mulberry32(1))
      expect(p.steps).toHaveLength(1)
    }
  })
})

describe('numJosa — 숫자 읽기의 끝 글자 받침', () => {
  // 끝자리 읽기(0은 십·백·영 — 모두 받침 있음). 구현의 숫자 표와 독립인 경로로 josa()의 한글 받침 계산을 쓴다.
  const READ = ['십', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구']
  it('0~999 전부 을/를·이/가가 읽기와 맞다', () => {
    for (let n = 0; n <= 999; n++) {
      const last = READ[n % 10]!
      expect(numJosa(n, '을/를')).toBe(`${n}${josa(last, '을/를').slice(1)}`)
      expect(numJosa(n, '이/가')).toBe(`${n}${josa(last, '이/가').slice(1)}`)
    }
  })
})

describe('makeProblem — 모든 유형 × 300 시드', () => {
  it('모범 풀이 식을 테스트가 계산하면 적힌 값이고, 마지막 값이 답이다', () => {
    for (const { p } of PROBLEMS) {
      for (const s of p.steps) expect(evalExpr(s.expr)).toBe(s.value)
      expect(p.steps[p.steps.length - 1]!.value).toBe(p.answer)
    }
  })

  it('수 범위 — 덧셈·뺄셈 피연산자·중간값·답 10~99, 곱셈 인수는 DAN 범위', () => {
    for (const { type, p } of PROBLEMS) {
      for (const s of p.steps) {
        const [x, op, y] = s.expr.split(' ')
        if (op === '×') {
          expect(Number(x)).toBeGreaterThanOrEqual(DAN_MIN)
          expect(Number(x)).toBeLessThanOrEqual(DAN_MAX)
          expect(Number(y)).toBeGreaterThanOrEqual(DAN_MIN)
          expect(Number(y)).toBeLessThanOrEqual(DAN_MAX)
        } else {
          for (const v of [Number(x), Number(y), s.value]) {
            expect(v, `${type} ${s.expr}`).toBeGreaterThanOrEqual(10)
            expect(v, `${type} ${s.expr}`).toBeLessThanOrEqual(99)
          }
        }
      }
      if (type.startsWith('two:mult')) expect(p.steps[0]!.value).toBeGreaterThanOrEqual(10)
      if (!type.startsWith('mult:')) {
        expect(p.answer).toBeGreaterThanOrEqual(10)
        expect(p.answer).toBeLessThanOrEqual(99)
      }
    }
  })

  it('review 순서 — (story) 뒤에 단계마다 expr 바로 다음 calc', () => {
    for (const { type, p } of PROBLEMS) {
      const kinds = p.review.map((s) => s.kind)
      const tail = p.steps.flatMap(() => ['expr', 'calc'])
      expect(kinds).toEqual(type.startsWith('reverse:') ? tail : ['story', ...tail])
    }
  })

  it('story 정답은 그 문제의 묶음이다', () => {
    for (const { type, p } of PROBLEMS) {
      const s = p.review[0]!
      if (s.kind === 'story') expect(STORY_GROUPS[s.correct]).toBe(groupOf(type))
    }
  })

  it('expr 단계 — 보기 2~3개, 식이 서로 다르고, 정답 인덱스의 식이 모범 풀이의 그 단계 식이다', () => {
    for (const { p } of PROBLEMS) {
      const exprs = p.review.filter((s) => s.kind === 'expr')
      expect(exprs).toHaveLength(p.steps.length)
      exprs.forEach((s, i) => {
        if (s.kind !== 'expr') return
        expect(s.options.length).toBeGreaterThanOrEqual(2)
        expect(s.options.length).toBeLessThanOrEqual(3)
        expect(new Set(s.options).size).toBe(s.options.length)
        expect(s.options[s.correct]).toBe(p.steps[i]!.expr)
        expect(evalExpr(s.options[s.correct]!)).toBe(p.steps[i]!.value)
      })
    }
  })

  it('뺄셈 정답 단계는 보기 3개', () => {
    for (const { p } of PROBLEMS) {
      const exprs = p.review.filter((s) => s.kind === 'expr')
      exprs.forEach((s, i) => {
        if (s.kind === 'expr' && p.steps[i]!.expr.includes('−')) expect(s.options).toHaveLength(3)
      })
    }
  })

  it('정답 인덱스가 늘 같은 자리에 있지 않다', () => {
    const idx = new Set<number>()
    for (const { p } of PROBLEMS)
      for (const s of p.review) if (s.kind === 'expr') idx.add(s.correct)
    expect(idx.size).toBeGreaterThan(1)
  })

  it('calc 단계는 정답 식과 그 값이다', () => {
    for (const { p } of PROBLEMS) {
      const calcs = p.review.filter((s) => s.kind === 'calc')
      calcs.forEach((s, i) => {
        if (s.kind !== 'calc') return
        expect(s.expr).toBe(p.steps[i]!.expr)
        expect(s.value).toBe(p.steps[i]!.value)
      })
    }
  })

  it('★ 유형의 keyword 오답은 0 이상이고 정답과 다르다, 비★는 keyword가 없다', () => {
    for (const { type, p } of PROBLEMS) {
      const kw = p.wrongs.filter((w) => w.cause === 'keyword')
      if (KEYWORD_TYPES.has(type)) {
        expect(kw).toHaveLength(1)
        expect(kw[0]!.value).toBeGreaterThanOrEqual(0)
        expect(kw[0]!.value).not.toBe(p.answer)
        expect(evalExpr(kw[0]!.expr)).toBe(kw[0]!.value)
      } else expect(kw).toHaveLength(0)
    }
  })

  it('wrongs에 음수 값이 없다', () => {
    for (const { p } of PROBLEMS)
      for (const w of p.wrongs) expect(w.value).toBeGreaterThanOrEqual(0)
  })

  it('extra-number — 거꾸로 묶음엔 없고, 있으면 문장에 「N살」이 있고 N이 풀이의 어느 수와도 다르다', () => {
    let seen = 0
    for (const { type, p } of PROBLEMS) {
      if (p.trap === undefined) {
        expect('trap' in p).toBe(false)
        continue
      }
      seen++
      expect(type.startsWith('reverse:')).toBe(false)
      const m = /(\d+)살 /.exec(p.text)
      expect(m, p.text).not.toBeNull()
      const age = Number(m![1])
      const tokens = p.steps.flatMap((s) => [...s.expr.split(' '), String(s.value)])
      expect(tokens).not.toContain(String(age))
    }
    expect(seen).toBeGreaterThan(0)
  })

  it('문장에 NaN·undefined·null이 없다', () => {
    for (const { p } of PROBLEMS) expect(p.text).not.toMatch(/NaN|undefined|null/)
  })

  it('숫자 바로 뒤 조사가 읽기와 맞다', () => {
    const READ = ['십', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구']
    for (const { p } of PROBLEMS) {
      for (const m of p.text.matchAll(/(\d+)(을|를|이|가|은|는)(?=[\s,.?])/g)) {
        const n = Number(m[1])
        const pair =
          m[2] === '을' || m[2] === '를'
            ? '을/를'
            : m[2] === '이' || m[2] === '가'
              ? '이/가'
              : '은/는'
        expect(`${n}${m[2]}`, p.text).toBe(`${n}${josa(READ[n % 10]!, pair).slice(1)}`)
      }
    }
  })

  it('이름·사물·단위 뒤에 틀린 조사가 없다', () => {
    const pairs = ['이/가', '은/는', '을/를', '과/와'] as const
    const wrong = (w: string, pair: (typeof pairs)[number]): string => {
      const [a, b] = pair.split('/') as [string, string]
      return josa(w, pair) === w + a ? w + b : w + a
    }
    const words = [...THINGS.map((t) => t.noun), ...THINGS.map((t) => t.unit)]
    const bad = words.flatMap((w) => pairs.map((pair) => wrong(w, pair)))
    // 사람 이름: 받침 있으면 '이'를 끼운 꼴만 맞다(서연이가) — 끼우지 않은 꼴 전부가 틀림.
    // 받침 없으면 받침-있음 조사가 틀림(유나이·유나은·유나을).
    for (const n of NAMES) {
      if (josa(n, '이/가') === `${n}이`) bad.push(`${n}가`, `${n}는`, `${n}를`, `${n}은`, `${n}을`)
      else bad.push(`${n}이 `, `${n}은`, `${n}을`)
    }
    for (const { p } of PROBLEMS)
      for (const b of bad) expect(p.text, `${b} in ${p.text}`).not.toContain(b)
  })

  it('모든 유형이 생성된다 — 템플릿이 둘 이상 쓰인다', () => {
    for (const t of WORD_TYPES) {
      // 수·이름·사물·단위를 지운 뼈대가 둘 이상이어야 템플릿이 둘 이상 쓰인 것이다(소재만 달라서는 안 된다).
      const strip = (text: string): string => {
        let x = text.replace(/\d+/g, '#')
        for (const n of NAMES) x = x.replaceAll(n, '@')
        for (const th of THINGS) x = x.replaceAll(th.noun, '$')
        for (const th of THINGS) x = x.replaceAll(th.unit, '%')
        return x
      }
      const texts = new Set(SEEDS.map((s) => strip(makeProblem(t, mulberry32(s)).text)))
      expect(texts.size, t).toBeGreaterThan(1)
    }
  })
})
```

- [ ] **Step 3: 테스트가 실패하는지 확인한다**

Run: `npx vitest run src/engine/word.test.ts`
Expected: FAIL — `Failed to resolve import "./word"`

- [ ] **Step 4: 엔진 전반부를 쓴다**

`src/engine/word.ts`를 만든다:

```ts
import type { ReviewStep, WordProblem, WordWrong } from '../data/types'
import { DAN_MAX, DAN_MIN, shuffled } from './facts'

/**
 * 문장제 엔진(specs/2026-09-30-word-problems-design.md). 순수 함수만 둔다.
 * 유형은 연산이 아니라 **상황의 구조**로 나눈다 — id는 `묶음:변형`이고 `:` 앞이 곧 묶음이다.
 * 이 파일이 유형 id·라벨·답 공식의 유일한 주인이다(스펙 §3의 표가 계약).
 */

/** 하루 문장제 수(스펙 §4). */
export const WORD_PER_DAY = 3

export const WORD_GROUPS = ['join', 'change', 'compare', 'mult', 'two', 'reverse'] as const
export type WordGroup = (typeof WORD_GROUPS)[number]

/** 아이용 묶음 이름. story 단계의 보기이자 맞힌 뒤 한 줄의 출처다. */
export const WORD_GROUP_LABELS: Record<WordGroup, string> = {
  join: '모으기',
  change: '바뀌기',
  compare: '비교하기',
  mult: '묶음',
  two: '두 번 계산',
  reverse: '거꾸로',
}

/** story 단계 보기 — 고정 5개·고정 순서(reverse 제외). 저장된 `correct`가 이 인덱스다. */
export const STORY_GROUPS: readonly WordGroup[] = ['join', 'change', 'compare', 'mult', 'two']

export const WORD_TYPES = [
  'join:whole',
  'join:part',
  'change:inc-end',
  'change:dec-end',
  'change:inc-diff',
  'change:dec-diff',
  'change:inc-start',
  'change:dec-start',
  'compare:diff',
  'compare:more',
  'compare:less',
  'compare:rev-less',
  'compare:rev-more',
  'mult:group',
  'mult:times',
  'two:mult-sub',
  'two:mult-add',
  'two:add-sub',
  'reverse:after-sub',
  'reverse:after-add',
  'reverse:wrong-add',
  'reverse:wrong-sub',
] as const
export type WordTypeId = (typeof WORD_TYPES)[number]

/** 부모용 세부 이름(리포트). 모르는 유형은 화면이 `?? '기타'`로 받는다. */
export const WORD_TYPE_LABELS: Record<WordTypeId, string> = {
  'join:whole': '모으기 — 전체',
  'join:part': '모으기 — 한 부분',
  'change:inc-end': '늘어난 뒤',
  'change:dec-end': '줄어든 뒤',
  'change:inc-diff': '얼마나 늘었나',
  'change:dec-diff': '얼마나 줄었나',
  'change:inc-start': '처음을 모를 때(늘어남)',
  'change:dec-start': '처음을 모를 때(줄어듦)',
  'compare:diff': '차이',
  'compare:more': '더 많은 쪽',
  'compare:less': '더 적은 쪽',
  'compare:rev-less': '거꾸로 말할 때(적어요)',
  'compare:rev-more': '거꾸로 말할 때(많아요)',
  'mult:group': '묶음',
  'mult:times': '몇 배',
  'two:mult-sub': '곱하고 빼기',
  'two:mult-add': '곱하고 더하기',
  'two:add-sub': '더하고 빼기',
  'reverse:after-sub': '어떤 수(뺐더니)',
  'reverse:after-add': '어떤 수(더했더니)',
  'reverse:wrong-add': '잘못 계산(더할 것을 뺌)',
  'reverse:wrong-sub': '잘못 계산(뺄 것을 더함)',
}

/** ★ 단서어 함정 유형 — 문장의 동사·비교어가 가리키는 연산과 실제 연산이 반대다(스펙 §3). */
export const KEYWORD_TYPES: ReadonlySet<string> = new Set<WordTypeId>([
  'change:inc-diff',
  'change:inc-start',
  'change:dec-start',
  'compare:rev-less',
  'compare:rev-more',
  'reverse:after-sub',
  'reverse:after-add',
])

export function groupOf(type: string): WordGroup | null {
  if (!(WORD_TYPES as readonly string[]).includes(type)) return null
  return type.slice(0, type.indexOf(':')) as WordGroup
}

export function typesOf(g: WordGroup): WordTypeId[] {
  return WORD_TYPES.filter((t) => t.startsWith(`${g}:`))
}

// ─────────── 조사 (d80bfd1^:src/engine/word.ts에서 되살림 + 숫자) ───────────

/** 한글 음절의 받침 유무. 완성형 밖이면 받침 있음 — 숫자에는 쓰지 않는다(numJosa). */
function hasBatchim(word: string): boolean {
  const code = word.charCodeAt(word.length - 1)
  const isHangul = code >= 0xac00 && code <= 0xd7a3
  return !isHangul || (code - 0xac00) % 28 !== 0
}

/** 앞이 받침 있을 때, 뒤가 없을 때. */
type Pair = '이/가' | '은/는' | '을/를' | '과/와'

export function josa(word: string, pair: Pair): string {
  const [w, wo] = pair.split('/') as [string, string]
  return word + (hasBatchim(word) ? w : wo)
}

/** 받침 있는 이름에 '이'를 끼운 어간(서연 → 서연이). 「~에게」·「~보다」·「~의」 앞에도 쓴다. */
export function personStem(name: string): string {
  return hasBatchim(name) ? `${name}이` : name
}

/** 사람 이름 조사 — 받침 있으면 '이'를 끼우고 받침-없음 조사(서연이가·서연이는·서연이를). */
export function personJosa(name: string, pair: '이/가' | '은/는' | '을/를'): string {
  if (!hasBatchim(name)) return josa(name, pair)
  const [, wo] = pair.split('/') as [string, string]
  return `${personStem(name)}${wo}`
}

/**
 * 숫자 뒤 조사. 옛 hasBatchim은 숫자를 받침 있음으로 봐서 "12을"이 나왔다. 읽기의 끝 글자로
 * 정한다 — 끝자리 2·4·5·9(이·사·오·구)만 받침 없음, 0은 십·백·영이라 받침 있음.
 */
export function numJosa(n: number, pair: Pair): string {
  const [w, wo] = pair.split('/') as [string, string]
  return `${n}${[2, 4, 5, 9].includes(Math.abs(n) % 10) ? wo : w}`
}

// ─────────── 소재 ───────────

/** 가상 이름. 실명 금지, 사물로 읽히는 이름(지우·하루) 금지 — HANDOFF 2026-08-26. */
export const NAMES = ['유나', '민아', '지호', '서연', '도윤'] as const

export const THINGS = [
  { noun: '사탕', unit: '개' },
  { noun: '구슬', unit: '개' },
  { noun: '스티커', unit: '장' },
  { noun: '색종이', unit: '장' },
  { noun: '딱지', unit: '장' },
  { noun: '연필', unit: '자루' },
  { noun: '공책', unit: '권' },
] as const

/** extra-number의 나이 후보. 풀이의 어느 수와도 같지 않은 것을 고른다. */
const AGES = [7, 8, 9]
/** extra-number가 얹히는 확률(거꾸로 묶음 제외). */
const EXTRA_RATE = 0.3

// ─────────── 식 ───────────

type Rand = () => number
type Op = '+' | '−' | '×'
type Step = { x: number; op: Op; y: number }

const val = (s: Step): number => (s.op === '+' ? s.x + s.y : s.op === '−' ? s.x - s.y : s.x * s.y)
/** 식 문자열. 뺄셈은 U+2212. 테스트·화면이 이 모양을 그대로 쓴다. */
const str = (s: Step): string => `${s.x} ${s.op} ${s.y}`

const int = (r: Rand, lo: number, hi: number): number =>
  lo + Math.min(hi - lo, Math.floor(r() * (hi - lo + 1)))
const pick = <T>(r: Rand, xs: readonly T[]): T =>
  xs[Math.min(xs.length - 1, Math.floor(r() * xs.length))]!

/** x + y ≤ 99, 둘 다 ≥ 10. 덧셈·뺄셈 유형 대부분이 이 쌍에서 답 공식을 거꾸로 만든다. */
function sumPair(r: Rand): [number, number] {
  const x = int(r, 10, 89)
  return [x, int(r, 10, 99 - x)]
}

const MULT_PAIRS: [number, number][] = []
for (let a = DAN_MIN; a <= DAN_MAX; a++)
  for (let b = DAN_MIN; b <= DAN_MAX; b++) MULT_PAIRS.push([a, b])

// ─────────── 유형 정의 ───────────

type Ctx = { p: string; q: string; noun: string; u: string; age: string }
type Def = {
  make: (r: Rand) => { n: number[]; steps: Step[] }
  texts: ((c: Ctx, n: number[]) => string)[]
}

// 템플릿 도우미. A는 주인공의 **첫 언급**(extra-number의 「N살 」이 붙는 자리)이다.
const A = (c: Ctx, pair: '이/가' | '은/는' | '을/를'): string => c.age + personJosa(c.p, pair)
const P = (c: Ctx, pair: '이/가' | '은/는' | '을/를'): string => personJosa(c.p, pair)
const Q = (c: Ctx, pair: '이/가' | '은/는' | '을/를'): string => personJosa(c.q, pair)
const O = (c: Ctx, pair: Pair): string => josa(c.noun, pair)
const U = (c: Ctx, n: number, pair: Pair): string => `${n}${josa(c.u, pair)}`

const DEFS: Record<WordTypeId, Def> = {
  'join:whole': {
    make: (r) => {
      const [a, b] = sumPair(r)
      return { n: [a, b], steps: [{ x: a, op: '+', y: b }] }
    },
    texts: [
      (c, [a, b]) =>
        `${A(c, '은/는')} ${O(c, '을/를')} ${a}${c.u} 가지고 있고, ${Q(c, '은/는')} ${b}${c.u} 가지고 있어요. 두 사람이 가진 ${O(c, '은/는')} 모두 몇 ${c.u}일까요?`,
      (c, [a, b]) =>
        `${A(c, '이/가')} 빨간 ${c.noun} ${U(c, a!, '과/와')} 파란 ${c.noun} ${U(c, b!, '을/를')} 샀어요. ${P(c, '이/가')} 산 ${O(c, '은/는')} 모두 몇 ${c.u}일까요?`,
    ],
  },
  'join:part': {
    make: (r) => {
      const [ans, a] = sumPair(r)
      const t = ans + a
      return { n: [t, a], steps: [{ x: t, op: '−', y: a }] }
    },
    texts: [
      (c, [t, a]) =>
        `${A(c, '은/는')} ${O(c, '을/를')} 모두 ${t}${c.u} 가지고 있어요. 그중 ${U(c, a!, '은/는')} 빨간색이고 나머지는 파란색이에요. 파란 ${O(c, '은/는')} 몇 ${c.u}일까요?`,
      (c, [t, a]) =>
        `${A(c, '이/가')} 가진 ${c.noun} ${t}${c.u} 중에서 ${U(c, a!, '은/는')} 새것이에요. 새것이 아닌 ${O(c, '은/는')} 몇 ${c.u}일까요?`,
    ],
  },
  'change:inc-end': {
    make: (r) => {
      const [a, b] = sumPair(r)
      return { n: [a, b], steps: [{ x: a, op: '+', y: b }] }
    },
    texts: [
      (c, [a, b]) =>
        `${A(c, '은/는')} ${O(c, '을/를')} ${a}${c.u} 가지고 있었어요. ${personStem(c.q)}에게서 ${U(c, b!, '을/를')} 더 받았어요. 이제 ${P(c, '이/가')} 가진 ${O(c, '은/는')} 몇 ${c.u}일까요?`,
      (c, [a, b]) =>
        `${A(c, '이/가')} ${O(c, '을/를')} ${a}${c.u} 모았어요. 오늘 ${U(c, b!, '을/를')} 더 모았어요. 모은 ${O(c, '은/는')} 모두 몇 ${c.u}일까요?`,
    ],
  },
  'change:dec-end': {
    make: (r) => {
      const [ans, b] = sumPair(r)
      const a = ans + b
      return { n: [a, b], steps: [{ x: a, op: '−', y: b }] }
    },
    texts: [
      (c, [a, b]) =>
        `${A(c, '은/는')} ${O(c, '을/를')} ${a}${c.u} 가지고 있었어요. ${personStem(c.q)}에게 ${U(c, b!, '을/를')} 주었어요. 남은 ${O(c, '은/는')} 몇 ${c.u}일까요?`,
      (c, [a, b]) =>
        `${A(c, '이/가')} ${O(c, '을/를')} ${a}${c.u} 가지고 있었는데 ${U(c, b!, '을/를')} 썼어요. 남은 ${O(c, '은/는')} 몇 ${c.u}일까요?`,
    ],
  },
  'change:inc-diff': {
    make: (r) => {
      const [ans, a] = sumPair(r)
      const t = a + ans
      return { n: [a, t], steps: [{ x: t, op: '−', y: a }] }
    },
    texts: [
      (c, [a, t]) =>
        `${A(c, '은/는')} ${O(c, '을/를')} ${a}${c.u} 가지고 있었어요. ${personStem(c.q)}에게서 몇 ${josa(c.u, '을/를')} 받았더니 ${U(c, t!, '이/가')} 되었어요. ${personStem(c.q)}에게서 받은 ${O(c, '은/는')} 몇 ${c.u}일까요?`,
      (c, [a, t]) =>
        `${A(c, '은/는')} ${O(c, '을/를')} ${a}${c.u} 모았어요. 오늘 더 모았더니 모두 ${U(c, t!, '이/가')} 되었어요. 오늘 모은 ${O(c, '은/는')} 몇 ${c.u}일까요?`,
    ],
  },
  'change:dec-diff': {
    make: (r) => {
      const [ans, t] = sumPair(r)
      const a = t + ans
      return { n: [a, t], steps: [{ x: a, op: '−', y: t }] }
    },
    texts: [
      (c, [a, t]) =>
        `${A(c, '은/는')} ${O(c, '을/를')} ${a}${c.u} 가지고 있었어요. 동생에게 몇 ${josa(c.u, '을/를')} 주었더니 ${U(c, t!, '이/가')} 남았어요. 동생에게 준 ${O(c, '은/는')} 몇 ${c.u}일까요?`,
      (c, [a, t]) =>
        `${A(c, '은/는')} ${O(c, '을/를')} ${a}${c.u} 가지고 있었는데 몇 ${josa(c.u, '을/를')} 쓰고 나니 ${U(c, t!, '이/가')} 남았어요. 쓴 ${O(c, '은/는')} 몇 ${c.u}일까요?`,
    ],
  },
  'change:inc-start': {
    make: (r) => {
      const [ans, b] = sumPair(r)
      const t = ans + b
      return { n: [b, t], steps: [{ x: t, op: '−', y: b }] }
    },
    texts: [
      (c, [b, t]) =>
        `${A(c, '은/는')} ${O(c, '을/를')} 몇 ${c.u} 가지고 있었어요. ${personStem(c.q)}에게서 ${U(c, b!, '을/를')} 받았더니 ${U(c, t!, '이/가')} 되었어요. ${P(c, '이/가')} 처음에 가지고 있던 ${O(c, '은/는')} 몇 ${c.u}일까요?`,
      (c, [b, t]) =>
        `${A(c, '이/가')} 모은 ${c.noun}에 오늘 ${U(c, b!, '을/를')} 더 모았더니 모두 ${U(c, t!, '이/가')} 되었어요. 오늘 전에 모은 ${O(c, '은/는')} 몇 ${c.u}일까요?`,
    ],
  },
  'change:dec-start': {
    make: (r) => {
      const [t, b] = sumPair(r)
      return { n: [b, t], steps: [{ x: t, op: '+', y: b }] }
    },
    texts: [
      (c, [b, t]) =>
        `${A(c, '은/는')} ${O(c, '을/를')} 몇 ${c.u} 가지고 있었어요. ${personStem(c.q)}에게 ${U(c, b!, '을/를')} 주었더니 ${U(c, t!, '이/가')} 남았어요. ${P(c, '이/가')} 처음에 가지고 있던 ${O(c, '은/는')} 몇 ${c.u}일까요?`,
      (c, [b, t]) =>
        `${A(c, '이/가')} 가지고 있던 ${c.noun} 중에서 ${U(c, b!, '을/를')} 썼더니 ${U(c, t!, '이/가')} 남았어요. 처음에 있던 ${O(c, '은/는')} 몇 ${c.u}일까요?`,
    ],
  },
  'compare:diff': {
    make: (r) => {
      const [ans, b] = sumPair(r)
      const a = b + ans
      return { n: [a, b], steps: [{ x: a, op: '−', y: b }] }
    },
    texts: [
      (c, [a, b]) =>
        `${A(c, '은/는')} ${O(c, '을/를')} ${a}${c.u}, ${Q(c, '은/는')} ${b}${c.u} 가지고 있어요. ${P(c, '은/는')} ${personStem(c.q)}보다 몇 ${c.u} 더 많이 가지고 있을까요?`,
      (c, [a, b]) =>
        `${A(c, '은/는')} ${O(c, '을/를')} ${a}${c.u} 모았고, ${Q(c, '은/는')} ${b}${c.u} 모았어요. 두 사람이 모은 ${c.noun}의 차는 몇 ${c.u}일까요?`,
    ],
  },
  'compare:more': {
    make: (r) => {
      const [b, d] = sumPair(r)
      return { n: [b, d], steps: [{ x: b, op: '+', y: d }] }
    },
    texts: [
      (c, [b, d]) =>
        `${Q(c, '은/는')} ${O(c, '을/를')} ${b}${c.u} 가지고 있어요. ${A(c, '은/는')} ${personStem(c.q)}보다 ${d}${c.u} 더 많이 가지고 있어요. ${P(c, '이/가')} 가진 ${O(c, '은/는')} 몇 ${c.u}일까요?`,
      (c, [b, d]) =>
        `${Q(c, '은/는')} ${O(c, '을/를')} ${b}${c.u} 모았고, ${A(c, '은/는')} ${personStem(c.q)}보다 ${d}${c.u} 더 모았어요. ${P(c, '이/가')} 모은 ${O(c, '은/는')} 몇 ${c.u}일까요?`,
    ],
  },
  'compare:less': {
    make: (r) => {
      const [ans, d] = sumPair(r)
      const b = ans + d
      return { n: [b, d], steps: [{ x: b, op: '−', y: d }] }
    },
    texts: [
      (c, [b, d]) =>
        `${Q(c, '은/는')} ${O(c, '을/를')} ${b}${c.u} 가지고 있어요. ${A(c, '은/는')} ${personStem(c.q)}보다 ${d}${c.u} 더 적게 가지고 있어요. ${P(c, '이/가')} 가진 ${O(c, '은/는')} 몇 ${c.u}일까요?`,
      (c, [b, d]) =>
        `${Q(c, '은/는')} ${O(c, '을/를')} ${b}${c.u} 모았고, ${A(c, '은/는')} ${personStem(c.q)}보다 ${d}${c.u} 덜 모았어요. ${P(c, '이/가')} 모은 ${O(c, '은/는')} 몇 ${c.u}일까요?`,
    ],
  },
  'compare:rev-less': {
    make: (r) => {
      const [a, d] = sumPair(r)
      return { n: [a, d], steps: [{ x: a, op: '+', y: d }] }
    },
    texts: [
      (c, [a, d]) =>
        `${A(c, '은/는')} ${O(c, '을/를')} ${a}${c.u} 가지고 있어요. ${P(c, '이/가')} 가진 ${O(c, '은/는')} ${personStem(c.q)}보다 ${d}${c.u} 적어요. ${Q(c, '이/가')} 가진 ${O(c, '은/는')} 몇 ${c.u}일까요?`,
      (c, [a, d]) =>
        `${A(c, '은/는')} ${O(c, '을/를')} ${a}${c.u} 모았는데, 이것은 ${personStem(c.q)}보다 ${d}${c.u} 적은 거예요. ${Q(c, '이/가')} 모은 ${O(c, '은/는')} 몇 ${c.u}일까요?`,
    ],
  },
  'compare:rev-more': {
    make: (r) => {
      const [ans, d] = sumPair(r)
      const a = ans + d
      return { n: [a, d], steps: [{ x: a, op: '−', y: d }] }
    },
    texts: [
      (c, [a, d]) =>
        `${A(c, '은/는')} ${O(c, '을/를')} ${a}${c.u} 가지고 있어요. ${P(c, '이/가')} 가진 ${O(c, '은/는')} ${personStem(c.q)}보다 ${d}${c.u} 많아요. ${Q(c, '이/가')} 가진 ${O(c, '은/는')} 몇 ${c.u}일까요?`,
      (c, [a, d]) =>
        `${A(c, '은/는')} ${O(c, '을/를')} ${a}${c.u} 모았는데, 이것은 ${personStem(c.q)}보다 ${d}${c.u} 많은 거예요. ${Q(c, '이/가')} 모은 ${O(c, '은/는')} 몇 ${c.u}일까요?`,
    ],
  },
  'mult:group': {
    make: (r) => {
      const [a, b] = pick(r, MULT_PAIRS)
      return { n: [a, b], steps: [{ x: a, op: '×', y: b }] }
    },
    texts: [
      (c, [a, b]) =>
        `${A(c, '이/가')} ${O(c, '을/를')} 한 봉지에 ${a}${c.u}씩 ${b}봉지 샀어요. ${P(c, '이/가')} 산 ${O(c, '은/는')} 모두 몇 ${c.u}일까요?`,
      (c, [a, b]) =>
        `${A(c, '은/는')} ${O(c, '을/를')} 한 상자에 ${a}${c.u}씩 담았어요. ${b}상자에 담은 ${O(c, '은/는')} 모두 몇 ${c.u}일까요?`,
    ],
  },
  'mult:times': {
    make: (r) => {
      // 몇 배는 2~5로 제한(HANDOFF 2026-08: "8배 줄넘기"의 부자연). DAN 경계 안의 부분 범위다.
      const a = int(r, DAN_MIN, DAN_MAX)
      const b = int(r, DAN_MIN, Math.min(5, DAN_MAX))
      return { n: [a, b], steps: [{ x: a, op: '×', y: b }] }
    },
    texts: [
      (c, [a, b]) =>
        `${Q(c, '은/는')} ${O(c, '을/를')} ${a}${c.u} 가지고 있어요. ${A(c, '은/는')} ${personStem(c.q)}의 ${b}배만큼 가지고 있어요. ${P(c, '이/가')} 가진 ${O(c, '은/는')} 몇 ${c.u}일까요?`,
      (c, [a, b]) =>
        `${Q(c, '은/는')} ${O(c, '을/를')} ${a}${c.u} 모았고, ${A(c, '은/는')} 그 ${b}배를 모았어요. ${P(c, '이/가')} 모은 ${O(c, '은/는')} 몇 ${c.u}일까요?`,
    ],
  },
  'two:mult-sub': {
    make: (r) => {
      const [a, b] = pick(
        r,
        MULT_PAIRS.filter(([x, y]) => x * y >= 20),
      )
      const p = a * b
      const t = int(r, 10, p - 10)
      return {
        n: [a, b, t],
        steps: [
          { x: a, op: '×', y: b },
          { x: p, op: '−', y: t },
        ],
      }
    },
    texts: [
      (c, [a, b, t]) =>
        `${A(c, '은/는')} ${O(c, '을/를')} 한 봉지에 ${a}${c.u}씩 ${b}봉지 가지고 있어요. 그중 ${U(c, t!, '을/를')} ${personStem(c.q)}에게 주었어요. 남은 ${O(c, '은/는')} 몇 ${c.u}일까요?`,
      (c, [a, b, t]) =>
        `${A(c, '이/가')} ${O(c, '을/를')} 한 상자에 ${a}${c.u}씩 ${b}상자 샀어요. 그중 ${U(c, t!, '을/를')} 썼어요. 남은 ${O(c, '은/는')} 몇 ${c.u}일까요?`,
    ],
  },
  'two:mult-add': {
    make: (r) => {
      const [a, b] = pick(
        r,
        MULT_PAIRS.filter(([x, y]) => x * y >= 10 && x * y <= 89),
      )
      const p = a * b
      const t = int(r, 10, 99 - p)
      return {
        n: [a, b, t],
        steps: [
          { x: a, op: '×', y: b },
          { x: p, op: '+', y: t },
        ],
      }
    },
    texts: [
      (c, [a, b, t]) =>
        `${A(c, '은/는')} ${O(c, '을/를')} 한 봉지에 ${a}${c.u}씩 ${b}봉지 가지고 있고, 낱개로 ${U(c, t!, '이/가')} 더 있어요. ${P(c, '이/가')} 가진 ${O(c, '은/는')} 모두 몇 ${c.u}일까요?`,
      (c, [a, b, t]) =>
        `${A(c, '이/가')} ${O(c, '을/를')} 한 상자에 ${a}${c.u}씩 ${b}상자 샀고, ${personStem(c.q)}에게서 ${U(c, t!, '을/를')} 더 받았어요. ${P(c, '이/가')} 가진 ${O(c, '은/는')} 모두 몇 ${c.u}일까요?`,
    ],
  },
  'two:add-sub': {
    make: (r) => {
      const [a, b] = sumPair(r)
      const s = a + b
      const t = int(r, 10, s - 10)
      return {
        n: [a, b, t],
        steps: [
          { x: a, op: '+', y: b },
          { x: s, op: '−', y: t },
        ],
      }
    },
    texts: [
      (c, [a, b, t]) =>
        `${A(c, '은/는')} ${O(c, '을/를')} ${a}${c.u} 가지고 있었어요. ${personStem(c.q)}에게서 ${U(c, b!, '을/를')} 받고, 동생에게 ${U(c, t!, '을/를')} 주었어요. 지금 ${P(c, '이/가')} 가진 ${O(c, '은/는')} 몇 ${c.u}일까요?`,
      (c, [a, b, t]) =>
        `${A(c, '이/가')} 빨간 ${c.noun} ${U(c, a!, '과/와')} 파란 ${c.noun} ${U(c, b!, '을/를')} 샀어요. 그중 ${U(c, t!, '을/를')} 썼어요. 남은 ${O(c, '은/는')} 몇 ${c.u}일까요?`,
    ],
  },
  'reverse:after-sub': {
    make: (r) => {
      const [t, b] = sumPair(r)
      return { n: [b, t], steps: [{ x: t, op: '+', y: b }] }
    },
    texts: [
      (_c, [b, t]) =>
        `어떤 수에서 ${numJosa(b!, '을/를')} 뺐더니 ${numJosa(t!, '이/가')} 되었어요. 어떤 수는 얼마일까요?`,
      (_c, [b, t]) =>
        `${numJosa(b!, '을/를')} 빼면 ${numJosa(t!, '이/가')} 되는 수가 있어요. 그 수는 얼마일까요?`,
    ],
  },
  'reverse:after-add': {
    make: (r) => {
      const [ans, b] = sumPair(r)
      const t = ans + b
      return { n: [b, t], steps: [{ x: t, op: '−', y: b }] }
    },
    texts: [
      (_c, [b, t]) =>
        `어떤 수에 ${numJosa(b!, '을/를')} 더했더니 ${numJosa(t!, '이/가')} 되었어요. 어떤 수는 얼마일까요?`,
      (_c, [b, t]) =>
        `${numJosa(b!, '을/를')} 더하면 ${numJosa(t!, '이/가')} 되는 수가 있어요. 그 수는 얼마일까요?`,
    ],
  },
  'reverse:wrong-add': {
    make: (r) => {
      const b = int(r, 10, 44)
      const t = int(r, 10, 99 - 2 * b)
      const x = t + b
      return {
        n: [b, t],
        steps: [
          { x: t, op: '+', y: b },
          { x, op: '+', y: b },
        ],
      }
    },
    texts: [
      (_c, [b, t]) =>
        `어떤 수에 ${numJosa(b!, '을/를')} 더해야 할 것을 잘못해서 뺐더니 ${numJosa(t!, '이/가')} 되었어요. 바르게 계산하면 얼마일까요?`,
      (_c, [b, t]) =>
        `어떤 수에 ${numJosa(b!, '을/를')} 더하는 문제를 잘못 보고 뺐더니 ${numJosa(t!, '이/가')} 나왔어요. 바르게 계산한 값은 얼마일까요?`,
    ],
  },
  'reverse:wrong-sub': {
    make: (r) => {
      const b = int(r, 10, 44)
      const t = int(r, 2 * b + 10, 99)
      const x = t - b
      return {
        n: [b, t],
        steps: [
          { x: t, op: '−', y: b },
          { x, op: '−', y: b },
        ],
      }
    },
    texts: [
      (_c, [b, t]) =>
        `어떤 수에서 ${numJosa(b!, '을/를')} 빼야 할 것을 잘못해서 더했더니 ${numJosa(t!, '이/가')} 되었어요. 바르게 계산하면 얼마일까요?`,
      (_c, [b, t]) =>
        `어떤 수에서 ${numJosa(b!, '을/를')} 빼는 문제를 잘못 보고 더했더니 ${numJosa(t!, '이/가')} 나왔어요. 바르게 계산한 값은 얼마일까요?`,
    ],
  },
}

/**
 * 오답 후보표(스펙 §5). 순서가 곧 우선순위고, 호출부가 식 문자열로 중복을 걸러 최대 2개를 취한다.
 * 1은 늘 있으므로 보기는 최소 2개 — 「다시 뽑기」가 없다.
 */
function candidates(steps: Step[], i: number, keyword: boolean, age: number | null): WordWrong[] {
  const s = steps[i]!
  const out: WordWrong[] = []
  const add = (t: Step, cause: string): void => {
    out.push({ expr: str(t), value: val(t), cause })
  }
  // 1. 연산 바꾸기. 뺄셈은 큰 수 − 작은 수로 써서 값이 늘 0 이상이다(keywordGuess가 이 값을 본다).
  const flip: Step =
    s.op === '+'
      ? { x: Math.max(s.x, s.y), op: '−', y: Math.min(s.x, s.y) }
      : { x: s.x, op: '+', y: s.y }
  add(flip, keyword && i === steps.length - 1 ? 'keyword' : 'op')
  // 2. 한 단계에서 멈춤 — 앞 단계 식을 그대로 답 식으로.
  if (i > 0) add(steps[i - 1]!, 'one-step')
  // 3. 끼워 넣은 수 사용.
  if (age !== null && i === 0) add({ x: s.x, op: s.op, y: age }, 'extra-number')
  // 4. 빼는 순서 뒤집기(작은 수 − 큰 수). 값이 음수라 wrongs에는 안 들어가고 보기로만 남는다.
  if (s.op === '−') add({ x: s.y, op: '−', y: s.x }, 'order')
  return out
}

/** 문제 하나를 만든다. rand만 받는다 — 다른 생성기와 난수 스트림을 공유하지 않는다(스펙 §5). */
export function makeProblem(type: WordTypeId, r: Rand): WordProblem {
  const def = DEFS[type]
  const group = groupOf(type)!
  const { n, steps } = def.make(r)
  const [p, q] = shuffled([...NAMES], r) as [string, string]
  const thing = pick(r, THINGS)
  const used = new Set(steps.flatMap((s) => [s.x, s.y, val(s)]))
  const ageNum =
    group !== 'reverse' && r() < EXTRA_RATE
      ? (shuffled(AGES, r).find((a) => !used.has(a)) ?? null)
      : null
  const ctx: Ctx = {
    p,
    q,
    noun: thing.noun,
    u: thing.unit,
    age: ageNum === null ? '' : `${ageNum}살 `,
  }
  const text = pick(r, def.texts)(ctx, n)

  const review: ReviewStep[] = []
  const wrongs: WordWrong[] = []
  if (group !== 'reverse') review.push({ kind: 'story', correct: STORY_GROUPS.indexOf(group) })
  steps.forEach((s, i) => {
    const right = str(s)
    const taken: WordWrong[] = []
    for (const c of candidates(steps, i, KEYWORD_TYPES.has(type), ageNum)) {
      if (taken.length === 2) break
      if (c.expr === right || taken.some((t) => t.expr === c.expr)) continue
      taken.push(c)
    }
    const options = shuffled([right, ...taken.map((t) => t.expr)], r)
    review.push({ kind: 'expr', options, correct: options.indexOf(right) })
    review.push({ kind: 'calc', expr: right, value: val(s) })
    for (const t of taken) if (t.value >= 0) wrongs.push(t)
  })

  const problem: WordProblem = {
    type,
    text,
    unit: group === 'reverse' ? '' : thing.unit,
    answer: val(steps[steps.length - 1]!),
    steps: steps.map((s) => ({ expr: str(s), value: val(s) })),
    review,
    wrongs,
  }
  if (ageNum !== null) problem.trap = 'extra-number'
  return problem
}
```

`shuffled`(`facts.ts`)는 입력을 복사해 섞으므로 `AGES`·`NAMES`를 그대로 넘겨도 안전하다.

- [ ] **Step 5: 테스트가 통과하는지 확인한다**

Run: `npx vitest run src/engine/word.test.ts`
Expected: PASS. 실패하면 템플릿 문장·범위를 고친다(테스트를 느슨하게 만들지 않는다). 「이름·사물·단위 뒤에 틀린
조사」 테스트가 정상 문장을 오탐하면 그 오탐 문자열을 확인하고 테스트의 판정만 좁힌다 — 이유를 주석으로 남긴다.

- [ ] **Step 6: 변이 검증**

`numJosa`의 `[2, 4, 5, 9]`를 `[2, 4, 5]`로 바꿔 `numJosa` 테스트와 「숫자 바로 뒤 조사」 테스트가 빨개지는지 본다.
`candidates`의 1번에서 `'keyword'`를 `'op'`로 바꿔 「★ 유형의 keyword 오답」 테스트가 빨개지는지 본다. 둘 다 원복.

- [ ] **Step 7: 전체 테스트·타입 검사 후 커밋**

```bash
npx vitest run && npx tsc --noEmit
git add src/data/types.ts src/engine/word.ts src/engine/word.test.ts
git commit -m "feat(word): 문장제 유형 카탈로그·조사·문제 생성

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: 엔진 후반부 — 판정·이어 하기 위치·가중치·출제

**Files:**

- Modify: `src/engine/word.ts` (파일 끝에 추가)
- Test: `src/engine/word.test.ts` (파일 끝에 추가)

**Interfaces:**

- Consumes: Task 1의 `makeProblem`, `WORD_TYPES`, `typesOf`, `KEYWORD_TYPES`, `WORD_GROUPS`
- Produces: `WordStage`, `isCorrect(a)`, `stage(a): WordStage`, `reviewPosition(a): number`,
  `FailedStep`, `firstFailedStep(a): FailedStep | null`, `keywordGuess(a): boolean`, `doneWordCount(d: Day): number`,
  `typeWeights(days): Record<WordTypeId, number>`,
  `pickWordTypes(days: Day[], n: number, doneGroups: ReadonlySet<string>, r): WordTypeId[]`

- [ ] **Step 1: 실패하는 테스트를 쓴다** — `src/engine/word.test.ts` 끝에 추가하고, 파일 위 import에
      `doneWordCount, firstFailedStep, isCorrect, keywordGuess, pickWordTypes, reviewPosition, stage, typeWeights`와
      `import type { Day, WordAttempt } from '../data/types'`를 더한다(기존 `WordProblem` import와 합친다).

```ts
function attempt(p: WordProblem, over: Partial<WordAttempt> = {}): WordAttempt {
  return { sid: 'd:1', problem: p, answer: null, exprs: [], ms: 0, picks: [], calcs: [], ...over }
}
/** review를 전부 맞게 푼 picks·calcs. */
function perfect(p: WordProblem): { picks: number[]; calcs: number[] } {
  const picks: number[] = []
  const calcs: number[] = []
  for (const s of p.review) {
    if (s.kind === 'story' || s.kind === 'expr') picks.push(s.correct)
    else calcs.push(s.value)
  }
  return { picks, calcs }
}
const TWO = makeProblem('two:mult-sub', mulberry32(7)) // story expr calc expr calc
const REV = makeProblem('reverse:after-add', mulberry32(7)) // expr calc

describe('판정', () => {
  it('stage — 보여 줌·답함(되짚기 미완)·끝남', () => {
    expect(stage(attempt(TWO))).toBe('shown')
    expect(stage(attempt(TWO, { answer: TWO.answer }))).toBe('done')
    const wrong = TWO.answer + 1
    expect(stage(attempt(TWO, { answer: wrong }))).toBe('answered')
    expect(stage(attempt(TWO, { answer: wrong, picks: [0, 0], calcs: [1] }))).toBe('answered')
    expect(stage(attempt(TWO, { answer: wrong, ...perfect(TWO) }))).toBe('done')
  })

  it('reviewPosition — 한 단계씩 저장된 뒤 다음 단계를 가리킨다(되짚기 중간에 닫고 다시 열기)', () => {
    const wrong = TWO.answer + 1
    const { picks, calcs } = perfect(TWO)
    expect(reviewPosition(attempt(TWO, { answer: wrong }))).toBe(0)
    expect(reviewPosition(attempt(TWO, { answer: wrong, picks: picks.slice(0, 1) }))).toBe(1)
    expect(reviewPosition(attempt(TWO, { answer: wrong, picks: picks.slice(0, 2) }))).toBe(2)
    expect(
      reviewPosition(
        attempt(TWO, { answer: wrong, picks: picks.slice(0, 2), calcs: calcs.slice(0, 1) }),
      ),
    ).toBe(3)
    expect(reviewPosition(attempt(TWO, { answer: wrong, picks, calcs }))).toBe(TWO.review.length)
  })

  it('firstFailedStep — 처음 틀린 단계, 모두 맞으면 slip, 맞힌 문항·미완은 null', () => {
    const wrong = TWO.answer + 1
    const ok = perfect(TWO)
    expect(firstFailedStep(attempt(TWO, { answer: TWO.answer }))).toBeNull()
    expect(firstFailedStep(attempt(TWO, { answer: wrong }))).toBeNull()
    expect(firstFailedStep(attempt(TWO, { answer: wrong, ...ok }))).toBe('slip')
    const badStory = [(ok.picks[0]! + 1) % 5, ...ok.picks.slice(1)]
    expect(firstFailedStep(attempt(TWO, { answer: wrong, picks: badStory, calcs: ok.calcs }))).toBe(
      'story',
    )
    const badCalc = [ok.calcs[0]! + 1, ok.calcs[1]!]
    expect(firstFailedStep(attempt(TWO, { answer: wrong, picks: ok.picks, calcs: badCalc }))).toBe(
      'calc',
    )
    const exprStep = REV.review[0]!
    if (exprStep.kind !== 'expr') throw new Error('reverse는 expr로 시작한다')
    const badExpr = (exprStep.correct + 1) % exprStep.options.length
    const r = perfect(REV)
    expect(
      firstFailedStep(attempt(REV, { answer: REV.answer + 1, picks: [badExpr], calcs: r.calcs })),
    ).toBe('expr')
  })

  it('firstFailedStep 방어 — 범위 밖 인덱스는 틀림, 모르는 kind는 건너뜀, 던지지 않는다', () => {
    const wrong = TWO.answer + 1
    const ok = perfect(TWO)
    expect(
      firstFailedStep(
        attempt(TWO, { answer: wrong, picks: [99, ...ok.picks.slice(1)], calcs: ok.calcs }),
      ),
    ).toBe('story')
    const future = { ...TWO, review: [{ kind: 'draw' } as never, ...TWO.review] }
    expect(firstFailedStep(attempt(future, { answer: wrong, ...ok }))).toBe('slip')
    expect(stage(attempt(future, { answer: wrong, ...ok }))).toBe('done')
  })

  it('keywordGuess — ★ 유형에서 첫 답이 keyword 오답 값일 때만', () => {
    const p = makeProblem('change:inc-start', mulberry32(3))
    const kw = p.wrongs.find((w) => w.cause === 'keyword')!
    expect(keywordGuess(attempt(p, { answer: kw.value }))).toBe(true)
    expect(keywordGuess(attempt(p, { answer: p.answer }))).toBe(false)
    expect(keywordGuess(attempt(p, { answer: kw.value + 1 }))).toBe(false)
    const plain = makeProblem('join:whole', mulberry32(3))
    expect(keywordGuess(attempt(plain, { answer: plain.wrongs[0]!.value }))).toBe(false)
  })

  it('isCorrect·doneWordCount', () => {
    const p = makeProblem('join:whole', mulberry32(1))
    expect(isCorrect(attempt(p))).toBe(false)
    expect(isCorrect(attempt(p, { answer: p.answer }))).toBe(true)
    const day: Day = {
      date: '2026-10-01',
      kind: 'normal',
      sheet: [],
      word: [
        attempt(p, { sid: 'a', answer: p.answer }),
        attempt(p, { sid: 'b' }),
        attempt(p, { sid: 'c', answer: p.answer + 1 }),
      ],
    }
    expect(doneWordCount(day)).toBe(1)
  })
})

describe('가중치·출제', () => {
  /** 유형마다 끝난 기록을 count개(맞힘 여부 fn). */
  function history(fn: (type: string) => boolean, count = 2): Day[] {
    const word = WORD_TYPES.flatMap((t) =>
      Array.from({ length: count }, (_, i) => {
        const p = makeProblem(t, mulberry32(i + 1))
        const ok = fn(t)
        return attempt(p, {
          sid: `${t}:${i}`,
          answer: ok ? p.answer : p.answer + 1,
          ...(ok ? {} : perfect(p)),
        })
      }),
    )
    return [{ date: '2026-10-01', kind: 'normal', sheet: [], word }]
  }

  it('기록 2개 미만은 3, 그 뒤는 1 + 2 × 최근 오답률', () => {
    const w0 = typeWeights([])
    for (const t of WORD_TYPES) expect(w0[t]).toBe(3)
    const w = typeWeights(history((t) => t !== 'compare:rev-less'))
    expect(w['compare:rev-less']).toBe(3)
    expect(w['join:whole']).toBe(1)
  })

  it('끝나지 않은 문항은 세지 않는다', () => {
    const p = makeProblem('join:whole', mulberry32(1))
    const days: Day[] = [
      {
        date: '2026-10-01',
        kind: 'normal',
        sheet: [],
        word: [attempt(p, { sid: 'a' }), attempt(p, { sid: 'b', answer: p.answer + 1 })],
      },
    ]
    expect(typeWeights(days)['join:whole']).toBe(3)
  })

  it('pickWordTypes — 묶음이 서로 다르고 doneGroups를 피한다', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const r = mulberry32(seed)
      const ts = pickWordTypes([], 3, new Set(['change']), r)
      expect(ts).toHaveLength(3)
      const gs = ts.map(groupOf)
      expect(new Set(gs).size).toBe(3)
      expect(gs).not.toContain('change')
      const one = pickWordTypes([], 1, new Set(['join', 'change', 'compare', 'mult', 'two']), r)
      expect(one.map(groupOf)).toEqual(['reverse'])
    }
  })

  it('약한 유형이 더 자주 나온다', () => {
    // 모든 유형 기록 2개 맞힘(가중치 1), compare:rev-less만 전부 틀림(3).
    // 기대: 묶음 3/(3+5) × 묶음 안 3/(3+4) ≈ 0.16. 가중치 균등이면 1/6 × 1/5 ≈ 0.033.
    const days = history((t) => t !== 'compare:rev-less')
    let hit = 0
    const N = 3000
    for (let seed = 1; seed <= N; seed++)
      if (pickWordTypes(days, 1, new Set(), mulberry32(seed))[0] === 'compare:rev-less') hit++
    expect(hit / N).toBeGreaterThan(0.1)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/engine/word.test.ts`
Expected: FAIL — `stage is not exported` 류

- [ ] **Step 3: 구현** — `src/engine/word.ts` 끝에 추가하고, 파일 첫 줄 import를
      `import type { Day, ReviewStep, WordAttempt, WordProblem, WordWrong } from '../data/types'`로 바꾼다.

```ts
// ─────────── 판정(파생 — 저장하지 않는다, 스펙 §5) ───────────

export type WordStage = 'shown' | 'answered' | 'done'
export type FailedStep = 'story' | 'expr' | 'calc' | 'slip'

/** 저장본의 review 한 칸. 미래 버전의 kind가 올 수 있어 넓게 읽는다. */
type LooseStep = { kind: string; correct?: number; value?: number }

export function isCorrect(a: WordAttempt): boolean {
  return a.answer !== null && a.answer === a.problem.answer
}

/**
 * 되짚기에서 아직 하지 않은 첫 단계의 인덱스(모두 했으면 review.length). 선택 단계는 picks,
 * 계산 단계는 calcs를 차례로 소비한다. 모르는 kind는 건너뛴다 — 이 버전이 물을 수 없는 단계다.
 */
export function reviewPosition(a: WordAttempt): number {
  let pi = 0
  let ci = 0
  const review = a.problem.review as LooseStep[]
  for (let i = 0; i < review.length; i++) {
    const k = review[i]!.kind
    if (k === 'story' || k === 'expr') {
      if (pi >= a.picks.length) return i
      pi++
    } else if (k === 'calc') {
      if (ci >= a.calcs.length) return i
      ci++
    }
  }
  return review.length
}

export function stage(a: WordAttempt): WordStage {
  if (a.answer === null) return 'shown'
  if (isCorrect(a)) return 'done'
  return reviewPosition(a) < a.problem.review.length ? 'answered' : 'done'
}

/** 틀리고 끝난 시도에서 처음 틀린 단계. 맞힌 시도·끝나지 않은 시도는 null. */
export function firstFailedStep(a: WordAttempt): FailedStep | null {
  if (isCorrect(a) || stage(a) !== 'done') return null
  let pi = 0
  let ci = 0
  for (const s of a.problem.review as LooseStep[]) {
    if (s.kind === 'story' || s.kind === 'expr') {
      if (a.picks[pi++] !== s.correct) return s.kind
    } else if (s.kind === 'calc') {
      if (a.calcs[ci++] !== s.value) return 'calc'
    }
  }
  return 'slip'
}

/** ★ 유형에서 첫 답이 「단어만 보고 반대 연산」 값과 같은가(스펙 §5). */
export function keywordGuess(a: WordAttempt): boolean {
  if (!KEYWORD_TYPES.has(a.problem.type) || a.answer === null || isCorrect(a)) return false
  return a.problem.wrongs.some((w) => w.cause === 'keyword' && w.value === a.answer)
}

export function doneWordCount(d: Day): number {
  return (d.word ?? []).filter((w) => stage(w) === 'done').length
}

// ─────────── 출제 ───────────

/** 끝난 기록이 이보다 적은 유형의 가중치 — 한 번 운 좋게 맞혔다고 바로 밀려나지 않게. */
const COLD_WEIGHT = 3
const RECENT = 5

/** 유형 가중치 = 1 + 2 × 최근 5회 첫 시도 오답률. 매번 로그에서 계산한다(저장하지 않는다). */
export function typeWeights(days: Day[]): Record<WordTypeId, number> {
  const hist = new Map<string, boolean[]>()
  const sorted = [...days].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  for (const d of sorted)
    for (const w of d.word ?? []) {
      if (stage(w) !== 'done') continue
      const h = hist.get(w.problem.type) ?? []
      h.push(isCorrect(w))
      hist.set(w.problem.type, h)
    }
  const out = {} as Record<WordTypeId, number>
  for (const t of WORD_TYPES) {
    const h = hist.get(t) ?? []
    if (h.length < 2) {
      out[t] = COLD_WEIGHT
      continue
    }
    const last = h.slice(-RECENT)
    out[t] = 1 + (2 * last.filter((ok) => !ok).length) / last.length
  }
  return out
}

function weightedIndex(ws: number[], r: Rand): number {
  const total = ws.reduce((s, w) => s + w, 0)
  let x = r() * total
  for (let i = 0; i < ws.length; i++) {
    x -= ws[i]!
    if (x < 0) return i
  }
  return ws.length - 1
}

/**
 * n개의 유형을 고른다. 묶음을 먼저(묶음 가중치 = 그 묶음 유형 가중치의 최댓값, 비복원) 뽑고
 * 그 안에서 유형을 뽑는다 — 묶음 크기(2~6)가 노출에 끌려가지 않는다. doneGroups(오늘 이미
 * 나온 묶음)는 뺀다. 남은 묶음이 n보다 적으면 제외를 푼다(6묶음·n ≤ 3이라 실제로는 없다).
 */
export function pickWordTypes(
  days: Day[],
  n: number,
  doneGroups: ReadonlySet<string>,
  r: Rand,
): WordTypeId[] {
  const w = typeWeights(days)
  let groups: WordGroup[] = WORD_GROUPS.filter((g) => !doneGroups.has(g))
  if (groups.length < n) groups = [...WORD_GROUPS]
  const out: WordTypeId[] = []
  for (let k = 0; k < n; k++) {
    const gi = weightedIndex(
      groups.map((g) => Math.max(...typesOf(g).map((t) => w[t]))),
      r,
    )
    const ts = typesOf(groups[gi]!)
    out.push(
      ts[
        weightedIndex(
          ts.map((t) => w[t]),
          r,
        )
      ]!,
    )
    groups = groups.filter((_, i) => i !== gi)
  }
  return out
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/engine/word.test.ts`
Expected: PASS

- [ ] **Step 5: 변이 검증**

`typeWeights`에서 `out[t] = 1 + ...`를 `out[t] = 1`로, cold도 `1`로 바꿔 「약한 유형이 더 자주 나온다」가 빨개지는지
본다(기대 약 0.033 < 0.1). `firstFailedStep`의 `return 'slip'`을 `return 'calc'`로 바꿔 slip 단언이 빨개지는지 본다.
둘 다 원복.

- [ ] **Step 6: 커밋**

```bash
npx vitest run && npx tsc --noEmit
git add src/engine/word.ts src/engine/word.test.ts
git commit -m "feat(word): 판정·이어 하기 위치·가중치·출제

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: 병합 — `mergeWord`·`hasSprintBundle`

**Files:**

- Modify: `src/engine/merge.ts`
- Test: `src/engine/merge.test.ts`

**Interfaces:**

- Consumes: `stage` (Task 2), `WordAttempt` (Task 1)
- Produces: `mergeWord(a?: WordAttempt[], b?: WordAttempt[]): WordAttempt[] | undefined`,
  `hasSprintBundle(d: Day): boolean`

- [ ] **Step 1: 실패하는 테스트** — `src/engine/merge.test.ts`에 추가. import에 `mergeWord`, `hasSprintBundle`,
      `serializeValue`(이미 있으면 생략)와 `import { makeProblem } from './word'`,
      `import type { WordAttempt } from '../data/types'`를 더한다.

`describe('mergeMeta', ...)` 블록 앞에 새 describe:

```ts
describe('mergeWord', () => {
  const P = makeProblem('join:whole', () => 0.5)
  const w = (sid: string, over: Partial<WordAttempt> = {}): WordAttempt => ({
    sid,
    problem: P,
    answer: null,
    exprs: [],
    ms: 0,
    picks: [],
    calcs: [],
    ...over,
  })
  const wrong = P.answer + 1
  const shown = w('d:100')
  const answered = w('d:100', { answer: wrong, exprs: ['1+1'], ms: 4000 })
  const oneStep = w('d:100', { answer: wrong, exprs: ['1+1'], ms: 4000, picks: [0] })
  const done = w('d:100', { answer: P.answer, exprs: ['1+1'], ms: 4000 })

  it('없음·빈 배열', () => {
    expect(mergeWord(undefined, undefined)).toBeUndefined()
    expect(mergeWord([], undefined)).toEqual([])
    expect(mergeWord(undefined, [])).toEqual([])
  })

  it('같은 sid는 더 진행된 쪽 — 순서와 무관', () => {
    for (const [lo, hi] of [
      [shown, answered],
      [answered, oneStep],
      [shown, done],
    ] as const) {
      expect(mergeWord([lo], [hi])).toEqual([hi])
      expect(mergeWord([hi], [lo])).toEqual([hi])
    }
  })

  it('다른 sid는 합집합, 끝 ms 오름차순, 비숫자 꼬리는 뒤에 sid 사전순', () => {
    const a = w('d:300'),
      b = w('e:200'),
      x = w('zz'),
      y = w('aa')
    expect(mergeWord([a, x], [b, y])!.map((v) => v.sid)).toEqual(['e:200', 'd:300', 'aa', 'zz'])
  })
})

describe('hasSprintBundle', () => {
  it('sprint나 word 중 하나라도 비어 있지 않으면 참', () => {
    const base: Day = { date: '2026-10-01', kind: 'normal', sheet: [] }
    expect(hasSprintBundle(base)).toBe(false)
    expect(hasSprintBundle({ ...base, sprint: [], word: [] })).toBe(false)
    expect(hasSprintBundle({ ...base, sprint: [{ fact: '2×3', correct: true, ms: 1 }] })).toBe(true)
    const P = makeProblem('join:whole', () => 0.5)
    expect(
      hasSprintBundle({
        ...base,
        word: [{ sid: 's', problem: P, answer: null, exprs: [], ms: 0, picks: [], calcs: [] }],
      }),
    ).toBe(true)
  })
})

describe('mergeDay — word', () => {
  it('DAY_KNOWN에 있다: 두 기기의 다른 문항이 둘 다 남는다(모르는 필드 LWW면 하나를 잃는다)', () => {
    const P = makeProblem('join:whole', () => 0.5)
    const mk = (sid: string): WordAttempt => ({
      sid,
      problem: P,
      answer: P.answer,
      exprs: [],
      ms: 1,
      picks: [],
      calcs: [],
    })
    const base: Day = { date: '2026-10-01', kind: 'normal', sheet: [] }
    const m = mergeDay(
      { value: { ...base, word: [mk('a:1')] }, at: EMPTY_STAMPS },
      { value: { ...base, word: [mk('b:2')] }, at: EMPTY_STAMPS },
    )
    expect(m.value.word!.map((x) => x.sid)).toEqual(['a:1', 'b:2'])
  })
})

describe('옛 앱 공존(스펙 §6) — 옛 규칙은 모르는 필드를 값 직렬화가 작은 쪽으로 통째 고른다', () => {
  // merge.ts의 모르는 필드 분기(lww(null,'',serA,null,'',serB))를 그대로 옮긴 것이다.
  const oldPick = <T>(x: T, y: T): T => (serializeValue(x) <= serializeValue(y) ? x : y)
  const P = makeProblem('two:mult-sub', () => 0.5)
  const wrong = P.answer + 1
  const base = {
    sid: 'd:100',
    problem: P,
    exprs: [] as string[],
    ms: 0,
    picks: [] as number[],
    calcs: [] as number[],
  }

  it('같은 원소가 진행된 경우 — 진행된 쪽이 이긴다(잃지 않음)', () => {
    const chain = [
      { ...base, answer: null },
      { ...base, answer: wrong, exprs: ['5×4'], ms: 4521 },
      { ...base, answer: wrong, exprs: ['5×4'], ms: 4521, picks: [0] },
      { ...base, answer: wrong, exprs: ['5×4'], ms: 4521, picks: [0, 1] },
      { ...base, answer: wrong, exprs: ['5×4'], ms: 4521, picks: [0, 1], calcs: [20] },
    ]
    for (let i = 0; i + 1 < chain.length; i++) {
      expect(oldPick([chain[i]], [chain[i + 1]])).toEqual([chain[i + 1]])
      expect(oldPick([chain[i + 1]], [chain[i]])).toEqual([chain[i + 1]])
    }
  })

  it('끼워 넣기(같은 자리에 다른 sid) — 옛 규칙은 한쪽을 잃는다: 수용한 한계를 문서화', () => {
    const a = { ...base, sid: 'a:200', answer: P.answer }
    const early = { ...base, sid: 'b:100', answer: P.answer }
    const got = oldPick([a], [early, a])
    expect(got.length === 2 || got[0]!.sid === 'a:200').toBe(true)
    expect(mergeWord([a], [early, a])!.map((x) => x.sid)).toEqual(['b:100', 'a:200'])
  })
})
```

그리고 속성 검사 입력 공간에 word를 넣는다. `genSprint` 아래에 추가:

```ts
const WORD_P = makeProblem('join:whole', mulberry32(1))
const WORDS: { tag: string; w: WordAttempt }[] = [
  {
    tag: 'w1:보여줌',
    w: { sid: 'd:100', problem: WORD_P, answer: null, exprs: [], ms: 0, picks: [], calcs: [] },
  },
  {
    tag: 'w1:답함',
    w: {
      sid: 'd:100',
      problem: WORD_P,
      answer: WORD_P.answer + 1,
      exprs: ['1'],
      ms: 9,
      picks: [],
      calcs: [],
    },
  },
  {
    tag: 'w1:한단계',
    w: {
      sid: 'd:100',
      problem: WORD_P,
      answer: WORD_P.answer + 1,
      exprs: ['1'],
      ms: 9,
      picks: [0],
      calcs: [],
    },
  },
  {
    tag: 'w1:맞힘',
    w: {
      sid: 'd:100',
      problem: WORD_P,
      answer: WORD_P.answer,
      exprs: [],
      ms: 9,
      picks: [],
      calcs: [],
    },
  },
  {
    tag: 'w2',
    w: {
      sid: 'e:50',
      problem: WORD_P,
      answer: WORD_P.answer,
      exprs: [],
      ms: 3,
      picks: [],
      calcs: [],
    },
  },
  {
    tag: 'w3:비숫자',
    w: { sid: 'x', problem: WORD_P, answer: null, exprs: [], ms: 0, picks: [], calcs: [] },
  },
]

function genWord(r: Rand, tags: string[]): WordAttempt[] | undefined {
  const n = Math.floor(r() * 4)
  if (n === 0) {
    if (r() < 0.5) {
      tags.push('word:없음')
      return undefined
    }
    tags.push('word:빈배열')
    return []
  }
  const out: WordAttempt[] = []
  for (let i = 0; i < n; i++) {
    const s = pick(r, WORDS)
    tags.push('word:' + s.tag)
    out.push(s.w)
  }
  return out
}
```

`genDay` 안 `if (sprint !== undefined) rec['sprint'] = sprint` 다음 줄에:

```ts
const word = genWord(r, tags)
if (word !== undefined) rec['word'] = word
```

**주의:** 같은 배열 안에 같은 sid가 둘 들어갈 수 있다(`w1:*` 둘). mergeWord는 그중 더 진행된 것 하나만 남긴다 —
결합·멱등 속성이 이 경우에도 성립해야 한다. genDay를 쓰는 기존 속성 테스트가 태그 커버리지를 단언하면
(`tags` 목록 확인) 새 태그가 한 번 이상 나오는지 그 목록에 `word:` 태그들을 더한다.

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/engine/merge.test.ts`
Expected: FAIL — `mergeWord is not exported`

- [ ] **Step 3: 구현** — `src/engine/merge.ts`:

import 첫 줄을 바꾼다:

```ts
import type { SprintAttempt, Day, Meta, Settings, WordAttempt } from '../data/types'
import { emptyDerived } from '../data/types'
import { stage } from './word'
```

`export function mergeSprint(` 정의가 끝난 바로 뒤에 추가:

```ts
const STAGE_RANK = { shown: 0, answered: 1, done: 2 } as const

/** 같은 sid 두 벌 중 이길 쪽인가 — 진행 단계 → 되짚기 단계 수 → 값 직렬화 작은 쪽(전순서). */
function wordBeats(x: WordAttempt, y: WordAttempt): boolean {
  const rx = STAGE_RANK[stage(x)]
  const ry = STAGE_RANK[stage(y)]
  if (rx !== ry) return rx > ry
  const lx = x.picks.length + x.calcs.length
  const ly = y.picks.length + y.calcs.length
  if (lx !== ly) return lx > ly
  return serializeValue(x) < serializeValue(y)
}

/** sid 끝 ms가 유한수인 것 먼저 그 수 오름차순, 나머지는 뒤에 — 모두 sid 사전순으로 비김을 푼다. */
function compareWordSid(a: WordAttempt, b: WordAttempt): number {
  const tail = (s: string): number => Number(s.slice(s.lastIndexOf(':') + 1))
  const ta = tail(a.sid)
  const tb = tail(b.sid)
  // `:`를 요구한다 — 없으면 lastIndexOf가 -1이라 sid 전체를 숫자로 읽어 '12' 같은 sid가 유한수로 오인된다.
  const fa = a.sid.includes(':') && Number.isFinite(ta)
  const fb = b.sid.includes(':') && Number.isFinite(tb)
  if (fa !== fb) return fa ? -1 : 1
  if (fa && ta !== tb) return ta - tb
  return a.sid < b.sid ? -1 : a.sid > b.sid ? 1 : 0
}

/**
 * 문장제 병합(스펙 §6). 시도가 sid마다 하나라 mergeSprint의 세션 그룹 로직이 필요 없고, 같은
 * sid 두 벌의 선택 규칙이 다르다 — 같은 문항을 보여 줌·답함·되짚기 단계마다 덮어쓰므로
 * 「더 진행된 쪽」이 이긴다. sid가 문자열이라고 가정한다(validateDay가 관문).
 */
export function mergeWord(
  a: WordAttempt[] | undefined,
  b: WordAttempt[] | undefined,
): WordAttempt[] | undefined {
  if (!a?.length && !b?.length) return a === undefined && b === undefined ? undefined : (a ?? b)
  const bySid = new Map<string, WordAttempt>()
  for (const arr of [a, b])
    for (const w of arr ?? []) {
      const prev = bySid.get(w.sid)
      if (prev === undefined || wordBeats(w, prev)) bySid.set(w.sid, w)
    }
  return [...bySid.values()].sort(compareWordSid)
}
```

`hasGradesBundle` 아래에 추가:

```ts
/** sprint 묶음(구구단 시도·문장제 시도)이 실려 있나. hasGradesBundle과 같은 이유로 이 술어의 주인은
 *  여기다 — db.ts·sync.ts의 표식·스탬프 판정이 같은 정의를 봐야 문장제만 한 날도 올라간다.
 *  「구구단 스프린트를 했나」를 묻는 곳(streak·checkup·facts·report·sprint 화면)은 이것을 쓰지 않는다. */
export function hasSprintBundle(d: Day): boolean {
  return (d.sprint?.length ?? 0) > 0 || (d.word?.length ?? 0) > 0
}
```

`DAY_KNOWN` 줄을 바꾼다:

```ts
const DAY_KNOWN = new Set(['date', 'kind', 'sheet', 'grades', 'mood', 'doneAt', 'sprint', 'word'])
```

`mergeDay` 안 `const sprint = mergeSprint(a.value.sprint, b.value.sprint)` 다음 줄에:

```ts
const word = mergeWord(a.value.word, b.value.word)
```

그리고 `if (sprint !== undefined) value.sprint = sprint` 다음 줄에:

```ts
if (word !== undefined) value.word = word
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/engine/merge.test.ts`
Expected: PASS (기존 교환·결합·멱등·왕복 속성 포함)

- [ ] **Step 5: 변이 검증**

(a) `DAY_KNOWN`에서 `'word'`를 빼 「mergeDay — word」가 빨개지는지, (b) `wordBeats`의 `return rx > ry`를
`return rx < ry`로 바꿔 「같은 sid는 더 진행된 쪽」이 빨개지는지, (c) `compareWordSid`의 `fa !== fb` 분기를 지워
속성 테스트(교환)나 정렬 테스트가 빨개지는지 본다. 모두 원복.

- [ ] **Step 6: 커밋**

```bash
npx vitest run && npx tsc --noEmit
git add src/engine/merge.ts src/engine/merge.test.ts
git commit -m "feat(word): 문장제 병합 — sid별 더 진행된 쪽, sprint 묶음 술어

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: 검증·저장·동기화 배선

**Files:**

- Modify: `src/engine/backup.ts` (`dayError`)
- Modify: `src/data/db.ts` (`declaredDay`, `bundlesOf`)
- Modify: `src/data/sync.ts` (`withoutEmptyBundles`, `sendStamps`, `adoptServerSheet`)
- Test: `src/engine/backup.test.ts`, `src/data/db.test.ts`, `src/data/sync.test.ts`

**Interfaces:**

- Consumes: `hasSprintBundle`, `structuralEqual` (merge.ts), `makeProblem` (테스트)
- Produces: 없음(배선)

- [ ] **Step 1: 실패하는 테스트**

`src/engine/backup.test.ts` 끝에 추가(import에 `import { makeProblem } from './word'`):

```ts
describe('validateDay — word', () => {
  const P = makeProblem('two:mult-sub', () => 0.5)
  const ok = {
    sid: 'd:1',
    problem: P,
    answer: 12,
    exprs: ['5×4'],
    ms: 900,
    picks: [0],
    calcs: [20],
  }
  const day = (word: unknown): unknown => ({ date: '2026-10-01', kind: 'normal', sheet: [], word })

  it('정상 기록과 미래 값(모르는 type·kind·cause)은 통과한다', () => {
    expect(validateDay(day([ok])).ok).toBe(true)
    expect(validateDay(day([{ ...ok, answer: null }])).ok).toBe(true)
    const future = {
      ...ok,
      problem: {
        ...P,
        type: 'future:x',
        review: [...P.review, { kind: 'draw' }],
        wrongs: [{ expr: 'a', value: 1, cause: 'new' }],
      },
    }
    expect(validateDay(day([future])).ok).toBe(true)
  })

  it('기형은 거부한다', () => {
    const bads: unknown[] = [
      'x',
      [null],
      [{ ...ok, sid: undefined }],
      [{ ...ok, sid: 3 }],
      [{ ...ok, answer: 1.5 }],
      [{ ...ok, answer: Number.NaN }],
      [{ ...ok, exprs: [1] }],
      [{ ...ok, ms: Infinity }],
      [{ ...ok, picks: [0.5] }],
      [{ ...ok, calcs: [null] }],
      [{ ...ok, problem: null }],
      [{ ...ok, problem: { ...P, text: 1 } }],
      [{ ...ok, problem: { ...P, answer: '3' } }],
      [{ ...ok, problem: { ...P, steps: [{ expr: 1, value: 2 }] } }],
      [{ ...ok, problem: { ...P, review: [null] } }],
      [{ ...ok, problem: { ...P, review: [{ kind: 'expr', options: [1], correct: 0 }] } }],
      [{ ...ok, problem: { ...P, review: [{ kind: 'story', correct: 0.5 }] } }],
      [{ ...ok, problem: { ...P, wrongs: [{ expr: 'a', value: 'b', cause: 'c' }] } }],
      [{ ...ok, problem: { ...P, trap: 1 } }],
    ]
    for (const b of bads) expect(validateDay(day(b)).ok, JSON.stringify(b).slice(0, 80)).toBe(false)
  })
})
```

`src/data/db.test.ts`의 `describe('putDay 경로 1 — 병합 경유', ...)` 안 끝에 추가(import에
`import { makeProblem } from '../engine/word'`, `import type { WordAttempt } from './types'`):

```ts
it('word만 바꾼 putDay(sprint 선언)는 저장·sprint 스탬프·표식을 남기고, 다른 sid와 합쳐진다', async () => {
  const P = makeProblem('join:whole', () => 0.5)
  const w = (sid: string): WordAttempt => ({
    sid,
    problem: P,
    answer: null,
    exprs: [],
    ms: 0,
    picks: [],
    calcs: [],
  })
  await putDay({ date: sample.date, kind: 'normal', sheet: [], word: [w('d:1')] }, ['sprint'])
  await putDay({ date: sample.date, kind: 'normal', sheet: [], word: [w('d:2')] }, ['sprint'])
  const stored = await getDay(sample.date)
  expect(stored?.word?.map((x) => x.sid)).toEqual(['d:1', 'd:2'])
  expect((await getStamps(sample.date))?.sprintAt).not.toBeNull()
  expect(
    (await getOutbox()).some((e) => e.target === `day:${sample.date}` && e.bundleAt.sprint),
  ).toBe(true)
})

it('sprint 선언에 빈 word는 싣지 않는다', async () => {
  await putDay({ date: sample.date, kind: 'normal', sheet: [], word: [] }, ['sprint'])
  expect('word' in (await getDay(sample.date))!).toBe(false)
})
```

`src/data/sync.test.ts`의 `describe('skipUnchangedPush — §6 무변경 push 생략', ...)` 안에 추가:

```ts
it('빈 word([])도 비교 전에 벗긴다', () => {
  const at = { sheetAt: AT, sheetBy: 'd1' }
  expect(
    skipUnchangedPush(
      stamped({ ...DAY, word: [] }, at),
      stamped(DAY, at),
      'd1',
      '2026-08-13T00:00:00Z',
    ),
  ).toBe(true)
})
```

`describe('sheet 충돌 자동 해소', ...)` 안에 추가(import에 `makeProblem`):

```ts
it('채택은 로컬 전용 word를 보존한다', async () => {
  await seedConflictingLocal()
  const P = makeProblem('join:whole', () => 0.5)
  await putDay(
    {
      date: D,
      kind: 'normal',
      sheet: [],
      word: [{ sid: 'w:1', problem: P, answer: P.answer, exprs: [], ms: 1, picks: [], calcs: [] }],
    },
    ['sprint'],
  )
  stubPush(() => [serverRow(SERVER_SHEET)])
  await pushUntilAdopted()
  expect((await getDay(D))?.word?.map((w) => w.sid)).toEqual(['w:1'])
})
```

`skipUnchangedPush(merged, server, deviceId, now)`는 둘이 같으면 `true`(생략)다 — 같은 describe의 첫 테스트와 같은 모양.

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/engine/backup.test.ts src/data/db.test.ts src/data/sync.test.ts`
Expected: FAIL — 기형 word 통과, word 미저장, 빈 word 미제거

- [ ] **Step 3: 구현**

`src/engine/backup.ts` — `dayError` 위에 도우미를 두고, `dayError`의 `grades` 검사 뒤·`return null` 앞에 word 검사를
넣는다:

```ts
const isStr = (v: unknown): v is string => typeof v === 'string'
const isFin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const allOf = (v: unknown, f: (x: unknown) => boolean): boolean => Array.isArray(v) && v.every(f)

/**
 * 문장제 시도 하나(스펙 §6). **모양은 원소 단위로 깊게, 값의 목록은 보지 않는다** — pull 행도 이
 * 검사를 받고, 거부된 행은 pull 커서를 멈춰 이후 모든 날의 동기화를 막는다. 미래 버전이 새
 * 유형·단계·원인을 더해도 이 버전이 멈추면 안 된다. 화면은 이 값들을 라벨 표로만 내보낸다.
 */
function wordError(raw: unknown, j: number): string | null {
  const at = `word[${j}]`
  if (!isObj(raw)) return `${at}가 객체가 아니다`
  if (!isStr(raw['sid'])) return `${at}.sid가 문자열이 아니다`
  if (raw['answer'] !== null && !Number.isInteger(raw['answer']))
    return `${at}.answer가 정수|null이 아니다`
  if (!allOf(raw['exprs'], isStr)) return `${at}.exprs가 문자열 배열이 아니다`
  if (!isFin(raw['ms'])) return `${at}.ms가 유한수가 아니다`
  if (!allOf(raw['picks'], Number.isInteger)) return `${at}.picks가 정수 배열이 아니다`
  if (!allOf(raw['calcs'], isFin)) return `${at}.calcs가 유한수 배열이 아니다`
  const p = raw['problem']
  if (!isObj(p)) return `${at}.problem이 객체가 아니다`
  if (!isStr(p['type']) || !isStr(p['text']) || !isStr(p['unit']))
    return `${at}.problem의 type·text·unit이 문자열이 아니다`
  if (!isFin(p['answer'])) return `${at}.problem.answer가 유한수가 아니다`
  if ('trap' in p && !isStr(p['trap'])) return `${at}.problem.trap이 문자열이 아니다`
  if (!allOf(p['steps'], (s) => isObj(s) && isStr(s['expr']) && isFin(s['value'])))
    return `${at}.problem.steps 모양이 아니다`
  const stepOk = (s: unknown): boolean =>
    isObj(s) &&
    isStr(s['kind']) &&
    (!('options' in s) || allOf(s['options'], isStr)) &&
    (!('correct' in s) || Number.isInteger(s['correct'])) &&
    (!('expr' in s) || isStr(s['expr'])) &&
    (!('value' in s) || isFin(s['value']))
  if (!allOf(p['review'], stepOk)) return `${at}.problem.review 모양이 아니다`
  if (
    !allOf(
      p['wrongs'],
      (w) => isObj(w) && isStr(w['expr']) && isFin(w['value']) && isStr(w['cause']),
    )
  )
    return `${at}.problem.wrongs 모양이 아니다`
  return null
}
```

`dayError` 안 (`return null` 바로 앞):

```ts
if (d['word'] !== undefined) {
  if (!Array.isArray(d['word'])) return 'word가 배열이 아니다'
  for (let j = 0; j < d['word'].length; j++) {
    const err = wordError(d['word'][j], j)
    if (err) return err
  }
}
```

`src/data/db.ts` — import에 `hasSprintBundle`을 더한다(merge.ts에서 이미 `mergeDay`·`EMPTY_STAMPS`를 가져오는 줄).
`declaredDay`의 sprint 줄을 바꾼다:

```ts
if (changed.includes('sprint')) {
  // sprint 묶음 = 구구단 시도 + 문장제 시도(스펙 §6). 빈 word는 싣지 않는다 — sprint의 빈 배열과
  // 같은 이유로 "빈 묶음이 실재한다"는 거짓이 서버까지 간다.
  if (day.sprint !== undefined) input.sprint = day.sprint
  if (day.word !== undefined && day.word.length > 0) input.word = day.word
}
```

`bundlesOf`의 sprint 줄:

```ts
if (hasSprintBundle(day)) bundleAt.sprint = at
```

`src/data/sync.ts` — merge.ts import 줄에 `hasSprintBundle`을 더한다(`structuralEqual`은 이미 있다). 그리고:

`withoutEmptyBundles`에 한 줄:

```ts
if (out.word !== undefined && out.word.length === 0) delete out.word
```

`sendStamps`의 sprint 조건:

```ts
  if (at.sprintAt === null && hasSprintBundle(v.value)) {
```

`adoptServerSheet`:

```ts
async function adoptServerSheet(server: Stamped<Day>): Promise<void> {
  const { value } = await adoptServerDay(server)
  if (
    !structuralEqual(value.sprint, server.value.sprint) ||
    !structuralEqual(value.word, server.value.word)
  )
    await putDay(value, ['sprint'])
}
```

그 함수 위 JSDoc의 「앉힌 값의 sprint가 서버와 다르면」을 「앉힌 값의 sprint·word가 서버와 다르면」으로 고친다.

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/engine/backup.test.ts src/data/db.test.ts src/data/sync.test.ts`
Expected: PASS

- [ ] **Step 5: 남은 `.sprint` 목록 확인(스펙 §6 「두 표의 합」)**

Run: `grep -rn "\.sprint\b\|sprint?" src --include=*.ts | grep -v "\.test\.ts"`

각 줄이 스펙 §6의 「바꾸는 자리」 또는 「바꾸지 않는 자리」 중 하나에 들어가는지 대조한다. 어느 쪽에도 없는 줄이
있으면 **멈추고 알린다**(그 자리가 "sprint 묶음이 있나"를 묻는지 "구구단을 했나"를 묻는지는 사람이 정한다).

- [ ] **Step 6: 변이 검증**

`declaredDay`의 word 줄을 지워 db 테스트가, `withoutEmptyBundles`의 word 줄을 지워 skip 테스트가, `wordError`의
`picks` 검사를 지워 기형 테스트가 빨개지는지 본다. 원복.

- [ ] **Step 7: 커밋**

```bash
npx vitest run && npx tsc --noEmit
git add src/engine/backup.ts src/engine/backup.test.ts src/data/db.ts src/data/db.test.ts src/data/sync.ts src/data/sync.test.ts
git commit -m "feat(word): word 검증과 sprint 묶음 배선(저장·push·채택)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: 🔥 `dayDone` + 아이 홈

**Files:**

- Modify: `src/engine/streak.ts`
- Modify: `src/screens/home-child.ts`
- Modify: `src/engine/checkup.ts` (주석 한 문장)
- Test: `src/engine/streak.test.ts`

**Interfaces:**

- Consumes: `doneWordCount`, `WORD_PER_DAY` (Task 2)
- Produces: `wordStart(days: Day[]): string | null`, `dayDone(d: Day, start: string | null): boolean`

- [ ] **Step 1: 실패하는 테스트** — `src/engine/streak.test.ts` 끝에(import에 `dayDone, wordStart`,
      `makeProblem`, `WordAttempt`):

```ts
describe('dayDone·wordStart — 문장제 도입(스펙 §6)', () => {
  const P = makeProblem('join:whole', () => 0.5)
  const done = (i: number): WordAttempt => ({
    sid: `d:${i}`,
    problem: P,
    answer: P.answer,
    exprs: [],
    ms: 1,
    picks: [],
    calcs: [],
  })
  const wd = (date: string, sprint: boolean, words: number): Day => ({
    ...day(date, sprint),
    ...(words > 0 ? { word: Array.from({ length: words }, (_, i) => done(i)) } : {}),
  })

  it('wordStart는 끝난 문장제가 3개 이상인 첫날', () => {
    expect(wordStart([wd('2026-10-01', true, 2), wd('2026-10-02', true, 3)])).toBe('2026-10-02')
    expect(wordStart([wd('2026-10-01', true, 1)])).toBeNull()
  })

  it('첫날 1~2문항만 끝내도 🔥가 줄지 않는다', () => {
    const before = [wd('2026-10-01', true, 0), wd('2026-10-02', true, 0), wd('2026-10-03', true, 0)]
    const base = sprintStreak(before, '2026-10-03')
    expect(sprintStreak([...before.slice(0, 2), wd('2026-10-03', true, 1)], '2026-10-03')).toBe(
      base,
    )
  })

  it('wordStart 이후는 스프린트 + 3문항이어야 완료, 그 전 날은 스프린트만', () => {
    const start = '2026-10-02'
    expect(dayDone(wd('2026-10-01', true, 0), start)).toBe(true)
    expect(dayDone(wd('2026-10-02', true, 2), start)).toBe(false)
    expect(dayDone(wd('2026-10-02', true, 3), start)).toBe(true)
    expect(dayDone(wd('2026-10-02', false, 3), start)).toBe(false)
    expect(dayDone({ ...wd('2026-10-03', true, 3), kind: 'checkup' }, start)).toBe(true)
    expect(dayDone({ ...wd('2026-10-03', true, 2), kind: 'checkup' }, start)).toBe(false)
  })

  it('도입 뒤 문장제를 건너뛴 날은 결석으로 센다', () => {
    const days = [
      wd('2026-10-01', true, 3),
      wd('2026-10-02', true, 0),
      wd('2026-10-03', true, 0),
      wd('2026-10-04', true, 0),
      wd('2026-10-05', true, 3),
    ]
    expect(sprintStreak(days, '2026-10-05')).toBe(1)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/engine/streak.test.ts`
Expected: FAIL — `dayDone is not exported`

- [ ] **Step 3: 구현** — `src/engine/streak.ts`:

import 추가:

```ts
import { doneWordCount, WORD_PER_DAY } from './word'
```

`sprintStreak` 위에 추가:

```ts
/**
 * 문장제 규칙이 켜지는 날 = 끝난 문장제가 WORD_PER_DAY개 이상인 첫날(스펙 §6). 매번 로그에서
 * 계산한다. 고정 날짜가 아닌 이유: 업데이트는 배너를 눌러야 적용되므로(main.ts) 옛 코드로 돈
 * 날이 소급해 미완료가 된다. 「하나라도」가 아니라 3개인 이유: 첫 문항을 끝낸 순간 그날이 3개를
 * 요구하게 되어 더 했는데 🔥가 줄어든다.
 */
export function wordStart(days: Day[]): string | null {
  let first: string | null = null
  for (const d of days)
    if (doneWordCount(d) >= WORD_PER_DAY && (first === null || d.date < first)) first = d.date
  return first
}

/** 그날이 완료인가. 🔥와 아이 홈이 같은 판정을 쓴다(어긋나면 같은 날을 두고 화면이 다른 말을 한다). */
export function dayDone(d: Day, start: string | null): boolean {
  if (d.sprint === undefined || d.sprint.length === 0) return false
  return start === null || d.date < start || doneWordCount(d) >= WORD_PER_DAY
}
```

`sprintStreak`의 `done` 계산을 바꾼다:

```ts
const start = wordStart(days)
const done = new Set(days.filter((d) => dayDone(d, start)).map((d) => d.date))
```

그리고 JSDoc 첫 단락 「스프린트를 한 날의 연속 횟수」를 「완료한 날(dayDone)의 연속 횟수 — 문장제 도입 전에는
스프린트만, 도입 뒤에는 스프린트 + 문장제 3개」로 고친다. 「**스프린트 완료만** 세는 이유」 단락은 「도입 전의
날을 스프린트만으로 세는 이유」로 읽히게 첫 문장만 고친다.

`src/engine/checkup.ts`의 주석 「게다가 sprintStreak은 스프린트가 있었다는 사실만 보므로 그 하루도 🔥
연속일수로 인정돼」를 「게다가 sprintStreak은 (문장제 도입 전에는) 스프린트가 있었다는 사실만 보므로 그 하루도
🔥 연속일수로 인정돼」로 고친다.

`src/screens/home-child.ts`:

import에 `import { doneWordCount, WORD_PER_DAY } from '../engine/word'`.

`const sprinted = ...` 위의 주석과 그 아래를 이렇게 바꾼다:

```ts
// "오늘 구구단 스프린트를 했나" — 카드 상태의 첫 갈래다. 🔥 완료 판정은 streak.ts의 dayDone이
// 따로 한다(문장제 도입 전 날은 스프린트만으로 완료). 홈은 도입 전이라도 문장제를 먼저 권한다
// (스펙 §4 ② — 그래야 첫날 홈이 문장제를 보여 준다).
const sprinted = Boolean(todayDay?.sprint && todayDay.sprint.length > 0)
const wordsLeft = sprinted ? Math.max(0, WORD_PER_DAY - doneWordCount(todayDay!)) : 0
```

`const card = ...` 삼항을 바꾼다(각 상태에 `to`를 더한다):

```ts
const card =
  sprinted && wordsLeft > 0
    ? {
        done: false,
        to: '#/word',
        label: '✏️ 문장제 풀기',
        sub: `스프린트 끝! 문장제 ${wordsLeft}개 남았어요`,
      }
    : todayDay?.kind === 'checkup' && sprinted
      ? { done: true, to: '#/sprint', label: '✓ 오늘 점검 끝!', sub: '눌러서 구구단 지도 보기' }
      : checkup && !sprinted
        ? {
            done: false,
            to: '#/sprint',
            label: '🔍 점검 스프린트',
            sub: '정복한 식을 다시 확인해요',
          }
        : sprinted
          ? {
              done: true,
              to: '#/sprint',
              label: '✓ 오늘 끝!',
              sub: '내일 또 만나요 · 구구단 지도 보기',
            }
          : {
              done: false,
              to: '#/sprint',
              label: '▶ 구구단 스프린트',
              sub: `${meta.settings.sprintCount}문제 · 3분`,
            }
```

리스너:

```ts
root.querySelector('#sprint')!.addEventListener('click', () => navigate(card.to))
```

(`card.to`는 `'#/word'`·`'#/sprint'` 두 리터럴뿐 — 부모 화면으로 가는 목적지가 없다.)

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/engine/streak.test.ts src/engine/simulation.test.ts src/engine/report.test.ts`
Expected: PASS

- [ ] **Step 5: 변이 검증**

`wordStart`의 `>= WORD_PER_DAY`를 `>= 1`로 바꿔 「첫날 1~2문항만 끝내도」가 빨개지는지 본다. 원복.

- [ ] **Step 6: 커밋**

```bash
npx vitest run && npx tsc --noEmit
git add src/engine/streak.ts src/engine/streak.test.ts src/engine/checkup.ts src/screens/home-child.ts
git commit -m "feat(word): 🔥 완료 판정 dayDone(문장제 도입일 파생)과 아이 홈 문장제 카드

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: 아이 화면 `#/word` + 라우팅 + 결과 화면 버튼

**먼저 `frontend-design` 스킬을 로드하고 `docs/reference/karrot-DESIGN.md`의 보이스·상태 절을 읽는다.** 아래 코드는
동작의 계약이다 — 스킬을 따른 시각적 다듬기(간격·타이포·상태 표현)는 SEED 토큰 안에서 자유롭게 하되, 흐름·저장
시점·`navigate` 목적지·이스케이프는 바꾸지 않는다.

**Files:**

- Create: `src/screens/word.ts`
- Modify: `src/main.ts` (라우트 한 갈래, `onPullApplied` 예외)
- Modify: `src/screens/sprint.ts` (`renderResult`에 문장제 버튼)
- Modify: `src/styles/kid.css`

**Interfaces:**

- Consumes: `makeProblem`, `pickWordTypes`, `groupOf`, `stage`, `reviewPosition`, `isCorrect`, `doneWordCount`,
  `STORY_GROUPS`, `WORD_GROUP_LABELS`, `WORD_PER_DAY`, `WordGroup` (Task 1·2)
- Produces: `renderWord(root: HTMLElement): Promise<void>`

- [ ] **Step 1: 화면을 쓴다** — `src/screens/word.ts`:

```ts
import { getAllDays, getDeviceState, putDay } from '../data/db'
import type { Day, WordAttempt } from '../data/types'
import { dayKey } from '../engine/dates'
import {
  STORY_GROUPS,
  WORD_GROUP_LABELS,
  WORD_PER_DAY,
  groupOf,
  isCorrect,
  makeProblem,
  pickWordTypes,
  reviewPosition,
  stage,
  type WordGroup,
} from '../engine/word'
import { clearError, el, escapeHtml, navigate, showError } from '../ui'

/**
 * 문장제(아이 소속, specs/2026-09-30-word-problems-design.md §4). navigate 목적지는 '#/'뿐이다.
 *
 * 한 문항을 한 sid로 여러 번 저장한다 — 보여 준 순간, 첫 답, 되짚기 단계마다. 다시 열면 끝나지
 * 않은 문항을 안 한 단계부터 이어 한다(닫아서 피할 수 없고 벌점도 없다). 병합이 더 진행된 벌을
 * 남긴다(merge.ts mergeWord).
 */

/** 저장에 실패한 마지막 스냅샷. sprint.ts의 pending과 같은 이유로 모듈 수준 — 화면을 떠나도 산다. */
let pending: { date: string; att: WordAttempt } | null = null

const ERR = '문장제 기록을 저장하지 못했어요. 다시 들어오면 한 번 더 저장해요.'

async function save(date: string, att: WordAttempt): Promise<void> {
  try {
    // sprint 묶음 선언(스펙 §6). sprint 필드는 싣지 않는다 — putDay가 저장본의 것을 그대로 둔다.
    await putDay({ date, kind: 'normal', sheet: [], word: [att] }, ['sprint'])
    if (pending?.att.sid === att.sid) pending = null
  } catch (e) {
    pending = { date, att }
    showError(ERR, e)
  }
}

export async function renderWord(root: HTMLElement): Promise<void> {
  // 기록의 날짜는 화면이 그려질 때 한 번 정한다(스펙 §4) — 자정을 넘겨도 한 번의 풀이가 두 날로 쪼개지지 않는다.
  const today = dayKey(new Date())
  try {
    if (pending !== null) {
      const p = pending
      await save(p.date, p.att)
    }
    const days = await getAllDays()
    const day = days.find((d) => d.date === today)
    if (!day?.sprint || day.sprint.length === 0) {
      navigate('#/')
      return
    }
    const attempts = [...(day.word ?? [])]
    if (pending !== null && pending.date === today) {
      const p = pending.att
      const i = attempts.findIndex((a) => a.sid === p.sid)
      if (i >= 0) attempts[i] = p
      else attempts.push(p)
    }
    const deviceId = (await getDeviceState()).deviceId
    session(root, today, days, attempts, deviceId)
  } catch (e) {
    showError('문장제를 열지 못했어요.', e)
    root.replaceChildren(el(`<div><button class="step" id="back">← 홈</button></div>`))
    root.querySelector('#back')!.addEventListener('click', () => navigate('#/'))
  }
}

function session(
  root: HTMLElement,
  today: string,
  days: Day[],
  attempts: WordAttempt[],
  deviceId: string,
): void {
  const alive = (): boolean => location.hash.startsWith('#/word')
  const commit = (att: WordAttempt): void => {
    const i = attempts.findIndex((a) => a.sid === att.sid)
    if (i >= 0) attempts[i] = att
    else attempts.push(att)
    void save(today, att)
  }
  const doneCount = (): number => attempts.filter((a) => stage(a) === 'done').length
  const counter = (): string =>
    `<p class="word-count">문장제 ${Math.min(doneCount() + 1, WORD_PER_DAY)} / ${WORD_PER_DAY}</p>`

  function next(): void {
    if (!alive()) return
    const open = attempts.find((a) => stage(a) !== 'done')
    if (open) {
      if (open.answer === null) question(open)
      else review(open)
      return
    }
    // n = 3 − 오늘의 모든 문항 수(스펙 §4). 끝나지 않은 문항은 위에서 먼저 이어 했다.
    if (attempts.length >= WORD_PER_DAY) {
      finished()
      return
    }
    const doneGroups = new Set(
      attempts.map((a) => groupOf(a.problem.type)).filter((g): g is WordGroup => g !== null),
    )
    const [type] = pickWordTypes(days, 1, doneGroups, Math.random)
    // sid는 보여 주는 순간 하나씩 만든다 — 같은 밀리초에 두 문항이 한 sid가 되지 않게(스펙 §4).
    const att: WordAttempt = {
      sid: `${deviceId}:${Date.now()}`,
      problem: makeProblem(type!, Math.random),
      answer: null,
      exprs: [],
      ms: 0,
      picks: [],
      calcs: [],
    }
    commit(att)
    question(att)
  }

  function question(att: WordAttempt): void {
    const p = att.problem
    const lines = ['']
    let answer = ''
    /** -1 = 답 칸, 0.. = 식 줄. 식부터 쓰게 첫 줄에서 시작한다. */
    let focus = 0
    const shownAt = Date.now()
    const keys = ['7', '8', '9', '+', '4', '5', '6', '−', '1', '2', '3', '×', '⌫', '0', '=']
    root.replaceChildren(
      el(`
        <div class="word">
          ${counter()}
          <p class="word-text">${escapeHtml(p.text)}</p>
          <div class="word-label">식</div>
          <div class="word-lines" id="lines"></div>
          <button class="word-more" id="more">+ 식 한 줄 더</button>
          <div class="word-answer">
            <span class="word-label">답</span>
            <button class="word-field" id="ans"></button>
            <span>${escapeHtml(p.unit)}</span>
          </div>
          <div class="keypad word-pad" id="pad">
            ${keys.map((k) => `<button class="seed-action-button seed-action-button--variant_neutralOutline seed-action-button--size_large" data-k="${k}">${k}</button>`).join('')}
          </div>
          <button class="step word-submit" id="submit">다 풀었어요</button>
          <button class="word-exit" id="exit">← 홈</button>
        </div>
      `),
    )
    const paint = (): void => {
      root.querySelector('#lines')!.innerHTML = lines
        .map(
          (l, i) =>
            `<button class="word-field ${focus === i ? 'is-focus' : ''}" data-line="${i}">${escapeHtml(l)}</button>`,
        )
        .join('')
      const ans = root.querySelector<HTMLButtonElement>('#ans')!
      ans.textContent = answer
      ans.classList.toggle('is-focus', focus === -1)
      for (const b of root.querySelectorAll<HTMLButtonElement>('#pad [data-k]'))
        b.disabled = focus === -1 && '+−×='.includes(b.dataset.k!)
      root.querySelector<HTMLButtonElement>('#submit')!.disabled = answer === ''
      root.querySelector<HTMLButtonElement>('#more')!.hidden = lines.length >= 3
    }
    root.querySelector('#lines')!.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-line]')
      if (!t) return
      focus = Number(t.dataset.line)
      paint()
    })
    root.querySelector('#ans')!.addEventListener('click', () => {
      focus = -1
      paint()
    })
    root.querySelector('#more')!.addEventListener('click', () => {
      if (lines.length >= 3) return
      lines.push('')
      focus = lines.length - 1
      paint()
    })
    root.querySelector('#pad')!.addEventListener('click', (e) => {
      const k = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-k]')?.dataset.k
      if (k === undefined) return
      if (focus === -1) {
        if (k === '⌫') answer = answer.slice(0, -1)
        // 최대 3자리 — 단서어 반응 오답(예: 85+27=112)이 잘리면 리포트가 그 실수를 못 센다(스펙 §4).
        else if (/^\d$/.test(k) && answer.length < 3) answer += k
      } else {
        const l = lines[focus]!
        if (k === '⌫') lines[focus] = l.slice(0, -1)
        else if (l.length < 20) lines[focus] = l + k
      }
      paint()
    })
    root.querySelector('#submit')!.addEventListener('click', () => {
      if (answer === '') return
      const answered: WordAttempt = {
        ...att,
        answer: Number(answer),
        exprs: lines.map((l) => l.trim()).filter((l) => l !== ''),
        ms: Date.now() - shownAt,
      }
      commit(answered)
      if (isCorrect(answered)) correct(answered)
      else review(answered)
    })
    root.querySelector('#exit')!.addEventListener('click', () => navigate('#/'))
    paint()
  }

  function correct(att: WordAttempt): void {
    const g = groupOf(att.problem.type)
    const note =
      g === null
        ? ''
        : g === 'reverse'
          ? '거꾸로 푸는 문제였어요'
          : `${WORD_GROUP_LABELS[g]} 이야기였어요`
    root.replaceChildren(
      el(`
        <div class="word">
          <p class="word-good">맞았어요!</p>
          ${note ? `<p class="word-note">${note}</p>` : ''}
          <button class="step" id="next">다음</button>
        </div>
      `),
    )
    root.querySelector('#next')!.addEventListener('click', next)
  }

  function feedback(msg: string, att: WordAttempt): void {
    root.replaceChildren(
      el(`
        <div class="word">
          <p class="word-text">${escapeHtml(att.problem.text)}</p>
          <p class="word-feedback">${msg}</p>
          <button class="step" id="next">다음</button>
        </div>
      `),
    )
    root.querySelector('#next')!.addEventListener('click', () => review(att))
  }

  function review(att: WordAttempt): void {
    if (!alive()) return
    const steps = att.problem.review
    const i = reviewPosition(att)
    if (i >= steps.length) {
      solution(att)
      return
    }
    const s = steps[i]!
    const head = `${counter()}<p class="word-q">같이 다시 볼까요?</p><p class="word-text">${escapeHtml(att.problem.text)}</p>`
    if (s.kind === 'story' || s.kind === 'expr') {
      const options = s.kind === 'story' ? STORY_GROUPS.map((g) => WORD_GROUP_LABELS[g]) : s.options
      root.replaceChildren(
        el(`
          <div class="word">
            ${head}
            <p class="word-q">${s.kind === 'story' ? '어떤 이야기일까요?' : '어떤 식일까요?'}</p>
            <div class="word-options">
              ${options.map((o, j) => `<button class="step" data-j="${j}">${escapeHtml(o)}</button>`).join('')}
            </div>
          </div>
        `),
      )
      let locked = false
      root.querySelector('.word-options')!.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-j]')
        if (!b || locked) return
        locked = true
        const j = Number(b.dataset.j)
        const nextAtt: WordAttempt = { ...att, picks: [...att.picks, j] }
        commit(nextAtt)
        const right = escapeHtml(options[s.correct] ?? '')
        const tail = s.kind === 'story' ? `${right} 이야기예요` : `${right} 식이에요`
        feedback(j === s.correct ? `맞아요! ${tail}` : tail, nextAtt)
      })
      return
    }
    if (s.kind === 'calc') {
      let v = ''
      root.replaceChildren(
        el(`
          <div class="word">
            ${head}
            <p class="word-q">${escapeHtml(s.expr)} = ?</p>
            <div class="word-field is-focus" id="v"></div>
            <div class="keypad" id="pad">
              ${['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0']
                .map(
                  (k) =>
                    `<button class="seed-action-button seed-action-button--variant_neutralOutline seed-action-button--size_large" data-k="${k}">${k}</button>`,
                )
                .join('')}
            </div>
            <button class="step" id="ok" disabled>확인</button>
          </div>
        `),
      )
      const paint = (): void => {
        root.querySelector('#v')!.textContent = v
        root.querySelector<HTMLButtonElement>('#ok')!.disabled = v === ''
      }
      root.querySelector('#pad')!.addEventListener('click', (e) => {
        const k = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-k]')?.dataset.k
        if (k === undefined) return
        if (k === '⌫') v = v.slice(0, -1)
        else if (v.length < 3) v += k
        paint()
      })
      let locked = false
      root.querySelector('#ok')!.addEventListener('click', () => {
        if (v === '' || locked) return
        locked = true
        const nextAtt: WordAttempt = { ...att, calcs: [...att.calcs, Number(v)] }
        commit(nextAtt)
        const line = `${escapeHtml(s.expr)} = ${s.value}`
        feedback(Number(v) === s.value ? `맞아요! ${line}` : line, nextAtt)
      })
      return
    }
    // 모르는 kind는 reviewPosition이 건너뛰므로 여기에 오지 않는다.
    solution(att)
  }

  function solution(att: WordAttempt): void {
    const p = att.problem
    root.replaceChildren(
      el(`
        <div class="word">
          <p class="word-q">이렇게 풀어요</p>
          <ol class="word-steps">
            ${p.steps.map((s) => `<li>${escapeHtml(s.expr)} = ${Number(s.value)}</li>`).join('')}
          </ol>
          <p class="word-note">답: ${Number(p.answer)}${escapeHtml(p.unit)}</p>
          <button class="step" id="next">다음 문제</button>
        </div>
      `),
    )
    root.querySelector('#next')!.addEventListener('click', next)
  }

  function finished(): void {
    clearError()
    root.replaceChildren(
      el(`
        <div class="word">
          <p class="word-good">오늘 문장제 끝! ✓</p>
          <p class="word-note">내일 또 만나요</p>
          <button class="step" id="back">← 홈</button>
        </div>
      `),
    )
    root.querySelector('#back')!.addEventListener('click', () => navigate('#/'))
  }

  next()
}
```

**주의:** `ReviewStep`의 `story` 갈래에는 `options`가 없다 — 위 코드는 `s.kind === 'story'`에서 `STORY_GROUPS`를 쓰고
`s.options`는 `expr`에서만 읽는다. TypeScript가 좁히기를 못 하면 `s.kind === 'expr' ? s.options : ...` 순서로 바꾼다.

- [ ] **Step 2: 라우팅** — `src/main.ts`:

`} else if (hash.startsWith('#/genie')) {` 줄을 찾아, 그 줄 **바로 앞**에 아래 세 줄 + 새 `} else if` 머리를 넣는다
(결과적으로 `#/map` 갈래 본문 → `} else if (#/word) {…}` → `} else if (#/genie) {…}` 순서가 된다):

```ts
    } else if (hash.startsWith('#/word')) {
      // 아이 소속(문장제). 게이트 대상 아님 — 부모 화면으로 가는 경로가 없다.
      const { renderWord } = await import('./screens/word')
      await renderWord(app)
    } else if (hash.startsWith('#/genie')) {
```

(원래의 `} else if (hash.startsWith('#/genie')) {` 줄은 이 블록의 마지막 줄로 대체된다 — 두 번 쓰지 않는다.)

`onPullApplied` 안:

```ts
if (hash.startsWith('#/sprint') || hash.startsWith('#/word')) return
```

그 위 JSDoc의 「예외는 **미커밋 입력을 쥔 화면** 하나, 스프린트다」를 「예외는 **미커밋 입력을 쥔 화면** — 스프린트와
문장제다. 문장제는 입력 중인 식·답과 되짚기 위치가 메모리에만 있다」로 고친다.

- [ ] **Step 3: 결과 화면 버튼** — `src/screens/sprint.ts`:

import에 `import { doneWordCount, WORD_PER_DAY } from '../engine/word'`.

`renderResult`의 `onRetry` 매개변수 **앞에** 매개변수를 하나 더한다:

```ts
  /** 오늘 남은 문장제 수. 0이면 버튼을 그리지 않는다(결과 화면은 재진입·재시도 화면이기도 하다). */
  wordsLeft: number,
```

템플릿의 `${onRetry ? ...}` 줄 **앞에**:

```ts
        ${wordsLeft > 0 ? `<button class="step" id="word">✏️ 문장제 ${wordsLeft}개 풀러 가기</button>` : ''}
```

리스너(`#back` 리스너 앞):

```ts
root.querySelector('#word')?.addEventListener('click', () => navigate('#/word'))
```

파일 안 `renderResult(` 호출 네 곳 모두에 `onRetry` 인자 **앞에** 남은 수를 넣는다. 도우미를 파일 위쪽(`mean` 아래)에:

```ts
function wordsLeftOf(day: Day | undefined): number {
  return day === undefined ? WORD_PER_DAY : Math.max(0, WORD_PER_DAY - doneWordCount(day))
}
```

- 재진입(`if (existing?.sprint && ...)` 안): `wordsLeftOf(existing)`
- `showResultFor`: `wordsLeftOf(p.day)`
- `finish()`의 `retrySave` 안: `wordsLeftOf(day)`
- `finish()` 끝: `wordsLeftOf(day)`

- [ ] **Step 4: CSS** — `src/styles/kid.css` 끝에 추가(값은 전부 SEED 토큰):

```css
/* 문장제(#/word). 스프린트 .keypad를 그대로 쓰되 연산자 열이 있어 4열이다. */
.word-count {
  color: var(--seed-color-fg-neutral-muted);
  font-size: var(--seed-font-size-t4);
  line-height: var(--seed-line-height-t4);
  margin: 0 0 var(--seed-dimension-x2);
}
.word-text {
  font-size: var(--seed-font-size-t7);
  line-height: var(--seed-line-height-t7);
  font-weight: 600;
  margin: 0 0 var(--seed-dimension-x5);
  word-break: keep-all;
}
.word-label {
  font-weight: 700;
  margin: var(--seed-dimension-x2) 0;
}
.word-lines {
  display: grid;
  gap: var(--seed-dimension-x2);
}
.word-field {
  display: block;
  min-height: var(--seed-dimension-x12);
  width: 100%;
  border: 2px solid var(--seed-color-stroke-neutral-weak);
  border-radius: var(--seed-radius-r3);
  background: var(--seed-color-bg-layer-default);
  font-size: var(--seed-font-size-t8);
  line-height: var(--seed-line-height-t8);
  font-variant-numeric: tabular-nums;
  text-align: left;
  padding: 0 var(--seed-dimension-x3);
}
.word-field.is-focus {
  border-color: var(--seed-color-stroke-brand-solid);
}
.word-more {
  border: none;
  background: none;
  color: var(--seed-color-fg-brand);
  font-weight: 700;
  padding: var(--seed-dimension-x2) 0;
}
.word-answer {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: var(--seed-dimension-x2);
  margin: var(--seed-dimension-x3) 0 var(--seed-dimension-x4);
}
.word-pad {
  grid-template-columns: repeat(4, 1fr);
}
.word-submit {
  margin-top: var(--seed-dimension-x4);
  text-align: center;
  font-weight: 700;
}
.word-exit {
  border: none;
  background: none;
  color: var(--seed-color-fg-neutral-muted);
  margin-top: var(--seed-dimension-x3);
}
.word-q {
  font-size: var(--seed-font-size-t6);
  line-height: var(--seed-line-height-t6);
  font-weight: 700;
  margin: var(--seed-dimension-x3) 0;
}
.word-options {
  display: grid;
  gap: var(--seed-dimension-x2);
}
.word-good {
  font-size: var(--seed-font-size-t9);
  line-height: var(--seed-line-height-t9);
  font-weight: 800;
  text-align: center;
  color: var(--seed-color-fg-positive);
  margin: var(--seed-dimension-x8) 0 var(--seed-dimension-x3);
}
.word-note,
.word-feedback {
  text-align: center;
  font-size: var(--seed-font-size-t6);
  line-height: var(--seed-line-height-t6);
  margin: 0 0 var(--seed-dimension-x6);
}
.word-steps {
  font-size: var(--seed-font-size-t7);
  line-height: var(--seed-line-height-t7);
  font-variant-numeric: tabular-nums;
}
```

사용한 토큰 이름이 설치된 SEED에 있는지 확인한다:

```bash
for t in fg-neutral-muted stroke-brand-solid fg-brand fg-positive stroke-neutral-weak bg-layer-default; do
  grep -rq -- "--seed-color-$t:" node_modules/@seed-design/css || echo "없음: $t"
done
for t in t4 t6 t7 t8 t9; do grep -rq -- "--seed-font-size-$t:" node_modules/@seed-design/css || echo "없음: $t"; done
grep -rq -- "--seed-dimension-x12:" node_modules/@seed-design/css || echo "없음: x12"
```

없는 토큰은 가장 가까운 있는 토큰으로 바꾼다(값을 베끼지 않는다).

- [ ] **Step 5: 타입·빌드·전체 테스트**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: 모두 통과

- [ ] **Step 6: 소속 규칙 확인**

Run: `grep -n "navigate(" src/screens/word.ts src/screens/home-child.ts src/screens/sprint.ts`
Expected: 목적지가 `'#/'`·`'#/word'`·`'#/sprint'`·`'#/map'`·`'#/ebs'`·`'#/parent'`(아이 홈의 기존 부모 버튼만) 외에 없다.
`word.ts`는 `'#/'`뿐.

- [ ] **Step 7: 실물 확인(개발 서버 — 배포본 금지)**

`docs/screen-preview.md`를 따른다(배포본에서 풀면 딸의 기록에 섞인다). `npm run dev` → `http://localhost:5173/haruchi/`.
개발 origin의 IndexedDB에서 오늘 스프린트를 한 번 끝낸 뒤:

1. 결과 화면에 「✏️ 문장제 3개 풀러 가기」가 보이고 누르면 `#/word`
2. 한 문항을 일부러 틀림 → 「같이 다시 볼까요?」 → story(보기 5개) → expr → calc → 풀이 → 다음 문제
3. 되짚기 expr 단계에서 「← 홈」 없이 탭을 새로고침 → 같은 문항의 **calc 단계부터** 이어짐(story·expr을 다시 묻지 않음)
4. 3문항을 끝내면 「오늘 문장제 끝!」, 아이 홈 카드가 「✓ 오늘 끝!」, 🔥 숫자가 줄지 않음
5. 아이패드 폭(768px)과 폰 폭(375px)에서 키패드가 넘치지 않음
6. 콘솔 에러 0

확인 결과를 커밋 메시지 본문이 아니라 최종 보고에 적는다. 3번이 실패하면 멈추고 알린다.

- [ ] **Step 8: 커밋**

```bash
git add src/screens/word.ts src/main.ts src/screens/sprint.ts src/styles/kid.css
git commit -m "feat(word): 문장제 아이 화면 #/word — 답 먼저, 틀리면 되짚기, 단계마다 저장

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: 부모 리포트 — `wordReport`와 문장제 절

**Files:**

- Modify: `src/engine/report.ts`
- Modify: `src/screens/report.ts`
- Modify: `src/styles/parent.css`
- Test: `src/engine/report.test.ts`

**Interfaces:**

- Consumes: `firstFailedStep`, `keywordGuess`, `isCorrect`, `stage`, `groupOf`, `typesOf`, `WORD_GROUPS`,
  `KEYWORD_TYPES`, `WORD_TYPES`, `FailedStep`, `WordGroup`, `WordTypeId` (Task 1·2)
- Produces: `WordReport` 타입, `wordReport(days: Day[], today: string): WordReport`

- [ ] **Step 1: 실패하는 테스트** — `src/engine/report.test.ts` 끝에(import에 `wordReport`, `makeProblem`,
      `WordAttempt`):

```ts
describe('wordReport', () => {
  const TODAY = '2026-10-28'
  let n = 0
  function att(
    type: Parameters<typeof makeProblem>[0],
    ok: boolean,
    over: Partial<WordAttempt> = {},
  ): WordAttempt {
    const p = makeProblem(type, () => 0.5)
    const picks: number[] = []
    const calcs: number[] = []
    for (const s of p.review) {
      if (s.kind === 'story' || s.kind === 'expr') picks.push(s.correct)
      else calcs.push(s.value)
    }
    return {
      sid: `d:${n++}`,
      problem: p,
      answer: ok ? p.answer : p.answer + 1,
      exprs: ['1+1'],
      ms: 1,
      picks: ok ? [] : picks,
      calcs: ok ? [] : calcs,
      ...over,
    }
  }
  const day = (date: string, word: WordAttempt[]): Day => ({
    date,
    kind: 'normal',
    sheet: [],
    sprint: [{ fact: '2×2', correct: true, ms: 1 }],
    word,
  })

  it('이번 주는 최근 7일, 끝난 문항만', () => {
    const r = wordReport(
      [
        day('2026-10-21', [att('join:whole', true)]),
        day('2026-10-22', [att('join:whole', true), att('join:whole', false)]),
        day('2026-10-28', [att('join:whole', false, { answer: null, picks: [], calcs: [] })]),
      ],
      TODAY,
    )
    expect(r.weekDays).toBe(1)
    expect([r.weekCorrect, r.weekTotal]).toEqual([1, 2])
  })

  it('묶음표는 최근 28일, 표본 3 미만 표시, 약한 세부 유형은 n ≥ 4 ∧ ≤ 50%', () => {
    const w = [
      ...Array.from({ length: 4 }, (_, i) => att('change:inc-start', i === 0)),
      att('change:inc-end', true),
      att('join:whole', true),
    ]
    const r = wordReport(
      [day('2026-10-20', w), day('2026-09-01', [att('compare:diff', false)])],
      TODAY,
    )
    const change = r.groups.find((g) => g.group === 'change')!
    expect([change.correct, change.total]).toEqual([2, 5])
    expect(change.weak.map((x) => x.type)).toEqual(['change:inc-start'])
    const join = r.groups.find((g) => g.group === 'join')!
    expect(join.total).toBe(1)
    expect(r.groups.find((g) => g.group === 'compare')!.total).toBe(0)
  })

  it('원인 분포와 단어 반응 추정', () => {
    const p = makeProblem('change:inc-start', () => 0.5)
    const kw = p.wrongs.find((w) => w.cause === 'keyword')!.value
    const good = att('change:inc-start', false)
    const guessed = { ...good, sid: 'k', answer: kw }
    const r = wordReport([day('2026-10-27', [good, guessed, att('join:whole', false)])], TODAY)
    expect(r.causes.slip).toBe(3)
    expect(r.keyword).toEqual({ guessed: 1, trapWrong: 2 })
  })

  it('최근 틀린 문제는 최신순 3개, 모르는 유형은 묶음에 넣지 않는다', () => {
    const odd = {
      ...att('join:whole', false),
      problem: { ...makeProblem('join:whole', () => 0.5), type: 'future:x' },
    }
    const r = wordReport(
      [
        day('2026-10-24', [att('join:whole', false)]),
        day('2026-10-25', [att('join:part', false)]),
        day('2026-10-26', [att('compare:diff', false), odd]),
      ],
      TODAY,
    )
    expect(r.recent.map((x) => x.date)).toEqual(['2026-10-26', '2026-10-26', '2026-10-25'])
    expect(r.groups.reduce((s, g) => s + g.total, 0)).toBe(3)
  })
})
```

`recent`의 `step`은 `firstFailedStep`의 결과다. 테스트의 `att(…, false)`는 되짚기를 전부 맞게 채우므로 `'slip'`이다.

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/engine/report.test.ts`
Expected: FAIL — `wordReport is not exported`

- [ ] **Step 3: 구현** — `src/engine/report.ts`:

import 추가:

```ts
import {
  KEYWORD_TYPES,
  WORD_GROUPS,
  firstFailedStep,
  groupOf,
  isCorrect,
  keywordGuess,
  stage,
  typesOf,
  type FailedStep,
  type WordGroup,
  type WordTypeId,
} from './word'
import type { WordAttempt } from '../data/types'
```

파일 끝에:

```ts
/** 약한 세부 유형 기준(스펙 §7) — 절대 기준. 상대 기준은 어떤 분포에서도 누군가를 약하다고 만든다. */
const WEAK_MIN_N = 4
const WEAK_MAX_RATE = 0.5
const RECENT_WRONG = 3
const TEXT_HEAD = 30

export type WordReport = {
  weekDays: number
  weekCorrect: number
  weekTotal: number
  groups: {
    group: WordGroup
    correct: number
    total: number
    weak: { type: WordTypeId; correct: number; total: number }[]
  }[]
  causes: Record<FailedStep, number>
  keyword: { guessed: number; trapWrong: number }
  recent: {
    date: string
    text: string
    exprs: string[]
    answer: number
    correct: number
    unit: string
    step: FailedStep
  }[]
}

/**
 * 문장제 집계(스펙 §7). 끝난 문항만 센다. 이번 주 = 최근 7일, 나머지는 최근 28일 — 하루 3문항이면
 * 주 최대 21문항이라 유형 칸 대부분이 한두 문항이다. 저장하지 않는다(매번 로그에서).
 * 문자열(text·exprs·unit)은 이스케이프하지 않은 원문이다 — 화면이 자른 뒤 이스케이프한다.
 */
export function wordReport(days: Day[], today: string): WordReport {
  const weekStart = shiftDay(today, -6)
  const monthStart = shiftDay(today, -27)
  const done: { date: string; w: WordAttempt; order: number }[] = []
  let order = 0
  for (const d of days)
    for (const w of d.word ?? [])
      if (stage(w) === 'done') done.push({ date: d.date, w, order: order++ })

  const week = done.filter((x) => x.date >= weekStart && x.date <= today)
  const month = done.filter((x) => x.date >= monthStart && x.date <= today)

  const groups = WORD_GROUPS.map((group) => {
    const inGroup = month.filter((x) => groupOf(x.w.problem.type) === group)
    const weak = typesOf(group)
      .map((type) => {
        const xs = inGroup.filter((x) => x.w.problem.type === type)
        return { type, correct: xs.filter((x) => isCorrect(x.w)).length, total: xs.length }
      })
      .filter((t) => t.total >= WEAK_MIN_N && t.correct / t.total <= WEAK_MAX_RATE)
    return {
      group,
      correct: inGroup.filter((x) => isCorrect(x.w)).length,
      total: inGroup.length,
      weak,
    }
  })

  const wrong = month.filter((x) => !isCorrect(x.w))
  const causes: Record<FailedStep, number> = { story: 0, expr: 0, calc: 0, slip: 0 }
  for (const x of wrong) {
    const s = firstFailedStep(x.w)
    if (s !== null) causes[s]++
  }
  const trap = wrong.filter((x) => KEYWORD_TYPES.has(x.w.problem.type))

  const recent = [...wrong]
    .sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : b.order - a.order))
    .slice(0, RECENT_WRONG)
    .map((x) => ({
      date: x.date,
      text: x.w.problem.text.slice(0, TEXT_HEAD),
      exprs: x.w.exprs,
      answer: x.w.answer as number,
      correct: x.w.problem.answer,
      unit: x.w.problem.unit,
      step: firstFailedStep(x.w) ?? 'slip',
    }))

  return {
    weekDays: new Set(week.map((x) => x.date)).size,
    weekCorrect: week.filter((x) => isCorrect(x.w)).length,
    weekTotal: week.length,
    groups,
    causes,
    keyword: { guessed: trap.filter((x) => keywordGuess(x.w)).length, trapWrong: trap.length },
    recent,
  }
}
```

`src/screens/report.ts`:

import 추가:

```ts
import { wordReport } from '../engine/report'
import type { WordReport } from '../engine/report'
import { WORD_GROUP_LABELS, WORD_TYPE_LABELS } from '../engine/word'
import type { FailedStep } from '../engine/word'
```

(기존 `import { weeklyReport, latestCheckupReport } from '../engine/report'`에 합친다.)

`weeklyHtml` 아래에 추가:

```ts
const STEP_LABELS: Record<FailedStep, string> = {
  story: '이야기 구조',
  expr: '식 세우기',
  calc: '계산',
  slip: '실수',
}
const typeLabel = (t: string): string => (WORD_TYPE_LABELS as Record<string, string>)[t] ?? '기타'

/** 문장제 절(스펙 §7). 문자열은 전부 여기서 이스케이프한다 — text는 엔진이 이미 잘라 왔다. */
function wordHtml(r: WordReport): string {
  if (r.groups.every((g) => g.total === 0) && r.weekTotal === 0)
    return '<p class="rnote">문장제 기록이 아직 없어요</p>'
  const rows = r.groups
    .map((g) => {
      const bar =
        g.total < 3
          ? '<span class="wbar-few">표본 부족</span>'
          : `<span class="wbar"><i style="width:${Math.round((100 * g.correct) / g.total)}%"></i></span>`
      const weak = g.weak
        .map(
          (t) =>
            `<li class="wrow wrow--sub">└ ${escapeHtml(typeLabel(t.type))} ${t.correct}/${t.total} ← 약해요</li>`,
        )
        .join('')
      return `<li class="wrow"><span>${WORD_GROUP_LABELS[g.group]}</span>${bar}<span>${g.correct}/${g.total}</span></li>${weak}`
    })
    .join('')
  const c = r.causes
  const recent = r.recent
    .map(
      (x) => `<li>${formatDate(x.date)} ${escapeHtml(x.text)}…<br>
        ${x.exprs.length > 0 ? `식 ${escapeHtml(x.exprs.join(', '))} · ` : ''}${Number(x.answer)} → ${Number(x.correct)}${escapeHtml(x.unit)} · ${STEP_LABELS[x.step]}에서 막혔어요</li>`,
    )
    .join('')
  return `
    <div class="stats">
      ${stat(`${r.weekDays}일`, '이번 주')}
      ${stat(`${r.weekCorrect}/${r.weekTotal}`, '첫 시도 정답')}
    </div>
    <h3 class="psec">최근 4주 유형별</h3>
    <ul class="wrows">${rows}</ul>
    <h3 class="psec">어디서 틀렸나</h3>
    <p class="rnote">이야기 구조 ${c.story} · 식 세우기 ${c.expr} · 계산 ${c.calc} · 실수 ${c.slip}</p>
    <p class="rnote is-muted">거꾸로 문제에는 이야기 구조 단계가 없어요 · 단어만 보고 연산 추정 ${r.keyword.guessed} / 함정 유형 오답 ${r.keyword.trapWrong}</p>
    ${recent ? `<h3 class="psec">최근 틀린 문제</h3><ul class="wrecent">${recent}</ul>` : ''}
    <p class="rnote is-muted">약한 유형이 더 자주 나와서 정답률이 실제보다 낮게 보일 수 있어요</p>
  `
}
```

`shareText`의 시그니처를 `shareText(w: WeeklyReport, wr: WordReport, today: string)`로 바꾸고 `return` 앞에:

```ts
if (wr.weekTotal > 0) {
  const weak = wr.groups.flatMap((g) => g.weak.map((t) => typeLabel(t.type)))
  lines.push(
    `문장제 ${wr.weekCorrect}/${wr.weekTotal}${weak.length > 0 ? ` · 약한 유형: ${weak.join(', ')}` : ''}`,
  )
}
```

`renderReport` 안 `const c = latestCheckupReport(...)` 다음 줄에 `const wr = wordReport(days, today)`. 템플릿에서
`${weeklyHtml(...)}` 다음 줄에:

```ts
          <h2 class="rsec">문장제</h2>
          ${wordHtml(wr)}
```

공유 호출을 `shareText(w, wr, today)`로.

`src/styles/parent.css` 끝에:

```css
/* 문장제 절(리포트). */
.wrows {
  list-style: none;
  padding: 0;
  margin: 0;
}
.wrow {
  display: grid;
  grid-template-columns: 5.5em 1fr auto;
  align-items: center;
  gap: var(--seed-dimension-x2);
  padding: var(--seed-dimension-x1) 0;
  font-variant-numeric: tabular-nums;
}
.wrow--sub {
  display: block;
  color: var(--seed-color-fg-critical);
  font-size: var(--seed-font-size-t3);
  padding-left: var(--seed-dimension-x3);
}
.wbar {
  display: block;
  height: var(--seed-dimension-x2);
  border-radius: var(--seed-radius-r1);
  background: var(--seed-color-bg-neutral-weak);
  overflow: hidden;
}
.wbar i {
  display: block;
  height: 100%;
  background: var(--seed-color-bg-brand-solid);
}
.wbar-few {
  color: var(--seed-color-fg-neutral-muted);
  font-size: var(--seed-font-size-t3);
}
.wrecent {
  padding-left: var(--seed-dimension-x4);
  font-size: var(--seed-font-size-t3);
  line-height: var(--seed-line-height-t4);
}
```

Task 6 Step 4와 같은 방법으로 토큰 이름(`fg-critical`, `bg-neutral-weak`, `radius-r1`, `font-size-t3`,
`dimension-x1`)을 확인하고 없으면 가까운 것으로 바꾼다.

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/engine/report.test.ts && npx tsc --noEmit && npm run build`
Expected: PASS

- [ ] **Step 5: 변이 검증**

`WEAK_MAX_RATE`를 `0.9`로 바꿔 약한 유형 단언이 빨개지는지(`change:inc-end`가 끼거나 목록이 달라짐) 확인하고,
`recent`의 정렬 비교를 뒤집어 최신순 단언이 빨개지는지 본다. 원복.

- [ ] **Step 6: 실물 확인** — 개발 서버에서 Task 6 Step 7로 몇 문항을 푼 뒤 `#/report`(PIN이 없으면 바로 열림)에서
      문장제 절이 보이고, 최근 틀린 문제의 문장이 30자에서 잘리고 `…`가 붙는지, 375px 폭에서 줄이 넘치지 않는지 본다.

- [ ] **Step 7: 커밋**

```bash
git add src/engine/report.ts src/engine/report.test.ts src/screens/report.ts src/styles/parent.css
git commit -m "feat(word): 부모 리포트 문장제 절 — 묶음표·약한 유형·막힌 단계·최근 틀린 문제

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: 문서·최종 검증·PR

**Files:**

- Modify: `docs/PRD.md`, `docs/superpowers/HANDOFF.md`, `docs/reference/learning-science-evidence.md`

- [ ] **Step 1: PRD** (`docs/PRD.md`, 사용자에게 보이는 정책이 바뀌었으므로 갱신 — CLAUDE.md 「문서」)

§1 첫 단락의 「매일 아이패드(PWA)에서 3분 구구단 스프린트를 하고,」를 「매일 아이패드(PWA)에서 3분 구구단
스프린트와 문장제 3문항을 하고,」로.

§2 **범위** 첫 줄의 「아이패드 스프린트(구구단 반응시간) +」 뒤에 「문장제 단계형 연습(하루 3문항, 틀리면 되짚기) +」를
넣는다.

§3 표의 아이 행을:

```
| 아이 | `#/` `#/sprint` `#/word` `#/map` `#/ebs` `#/genie` | 아이 홈 · 스프린트 · 문장제 · 구구단 지도 · EBS 서가 · 지니 보상 |
```

(`npm run format`이 표 폭을 다시 맞춘다.)

§4 제목을 「학습 정책 — 스프린트·문장제」로 바꾸고, 첫 불릿 아래에 추가:

```markdown
- **문장제(아이패드)**: 스프린트 뒤 하루 3문항, 서로 다른 구조 묶음(모으기·바뀌기·비교하기·묶음·두 번 계산·
  거꾸로)에서 하나씩. 답 먼저 — 틀리면 이야기 구조 → 식 → 계산 순으로 되짚고, 처음 틀린 단계를 리포트가
  계산한다(저장하지 않는다). 약한 유형이 더 자주 나온다. 소유자: `src/engine/word.ts`. 근거:
  `specs/2026-09-30-word-problems-design.md`
- **🔥 연속**: 문장제 3문항을 처음 끝낸 날부터는 스프린트 + 문장제 3문항이 그날의 완료다(그 전 날은 스프린트만).
  아이 홈·부모 홈·리포트가 같은 판정을 쓴다. 소유자: `src/engine/streak.ts`의 `dayDone`·`wordStart`
```

§8 단일 출처 색인 표에 한 행:

```
| 문장제 유형·답 공식·판정 | `src/engine/word.ts` |
```

- [ ] **Step 2: learning-science-evidence** — §3 「미착수 후보」 표에서 「문장제 스키마 회전」 행을 지우고, 차용한
      항목 표(같은 문서의 위쪽 표 — 「(은퇴)」 행들이 있는 표)에 추가한다:

```
| 문장제 구조 섞기 + 되짚기 구조 이름 붙이기 (`engine/word.ts`, 2026-10) | 스키마 기반 지도가 최상위 조합의 핵심 — 네트워크 메타분석 2025 [^network] |
```

- [ ] **Step 3: HANDOFF** — 「지금 상태」 표의 「종이 은퇴」 행 아래에 한 행을 넣는다:

```
| 문장제               | **2026-10 문장제 단계형 연습 출시.** 스프린트 뒤 하루 3문항(`#/word`, 아이 소속), 답 먼저·틀리면 되짚기(이야기 구조 → 식 → 계산), 단계마다 저장·이어 하기. 기록 `Day.word`는 sprint 묶음의 일원이라 서버 스키마 변경 없음, 병합은 `mergeWord`(sid별 더 진행된 쪽). 🔥는 문장제 3문항을 처음 끝낸 날부터 스프린트+문장제(`dayDone`). 옛 버전 앱과는 `SCHEMA_VERSION`을 올리지 않고 공존 — 같은 자리에 다른 sid가 끼워 넣어지는 경우만 잃는다(수용). 확장 ②(그림형 응용 + `box:max`)·③(단위 소재)은 별도 스펙. 설계 `specs/2026-09-30-word-problems-design.md`, 계획 `plans/2026-09-30-word-problems.md` |
```

같은 문서 「미해결」 류 절에 한 줄(절 이름은 문서를 열어 가장 맞는 곳):

```markdown
- 문장제 첫 반응(아이패드 실물): 되짚기가 지루하지 않은지, 키패드로 식 쓰기가 되는지, 1년 뒤 `getAllDays()` 체감 속도(문항 박제로 하루 ~3KB)
```

- [ ] **Step 4: 포맷·전체 검증**

```bash
npm run format
npx prettier --check . && npx vitest run && npm run build
git status --short
```

Expected: 셋 다 통과. `git status`에 이 계획이 만든 파일 외의 변경이 있으면 **다른 세션 것으로 보고 손대지 않고**
보고한다.

- [ ] **Step 5: 커밋·push·PR**

```bash
git add docs/PRD.md docs/superpowers/HANDOFF.md docs/reference/learning-science-evidence.md
git commit -m "docs: 문장제 — PRD·HANDOFF·근거 문서 갱신

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u origin word-problems
gh pr create --title "feat: 문장제 단계형 연습 — 하루 3문항, 틀리면 되짚기, 부모 리포트" --body "$(cat <<'EOF'
스펙: docs/superpowers/specs/2026-09-30-word-problems-design.md (적대적 리뷰 3라운드 합의)
계획: docs/superpowers/plans/2026-09-30-word-problems.md

- 엔진 `engine/word.ts`: 22유형(6묶음), 오답 후보표, 판정·가중치·출제
- 기록 `Day.word`: sprint 묶음 편입, `mergeWord`(sid별 더 진행된 쪽), 서버 스키마 변경 없음
- 🔥 `dayDone`: 문장제 3문항을 처음 끝낸 날부터 스프린트+문장제
- 아이 화면 `#/word`, 결과 화면·아이 홈 진입, 부모 리포트 문장제 절

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
gh pr checks --watch
```

- [ ] **Step 6: 머지** — CI가 초록이면 사람의 확인을 받고 `gh pr merge <n> --squash`. 머지 = 배포이므로
      **머지는 사용자 승인 뒤에만** 한다. 머지 후 `gh run watch`로 배포까지 본다.
