# EBS 강의 화면 리뉴얼 — 주제 서가 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `#/ebs`를 구간 A~D 로드맵(공급자 축)에서 **주제 축 서가**(사용자 축)로 재편한다 — 아이가 "2단 보고 싶어"로 찾고, 앱이 아는 현재 위치(정복 칸수·배우는 중)를 순수 파생으로 표시한다.

**Architecture:** 주제↔강 카탈로그와 파생 함수를 `engine/ebs.ts`(신규, 순수 함수)에 두고 테스트를 붙인다. `screens/ebs.ts`는 렌더만 한다 — DB에서 `days`를 읽어 `deriveFacts`·`deriveTypes`로 파생한 뒤 카탈로그와 합쳐 그린다. 저장 스키마 무변경, 시청 기록 저장 없음.

**Tech Stack:** TypeScript(바닐라, 프레임워크 없음), vitest.

## 설계 결정 기록 (2026-08-04 인터뷰)

1. **문제**: 현 화면은 매핑 문서 §4의 사본이라 "지금 뭘 볼지"를 답하지 않고, 구간 A~D·"81식 전면 진도 금지" 같은 공급자 언어를 아이 홈 카드 뒤에 두고 있다.
2. **주제 축 + 이정표**: 처방(오늘 볼 강의 하나)이 아니라 서가다. 잠금·흐림 없이 전부 열어 둔다 — 미리 보고 싶으면 보게 둔다.
3. **구구단 카드는 "정복 칸수"**: Phase 4가 신규 식 무작위 도입으로 바꿔서 "배우는 중인 단" 이진 배지는 카드 8장 거의 전부에 붙는 노이즈가 된다. 대신 지도(`fact-map.ts`)와 같은 정의의 유창 칸수(예: 11/18칸)를 보여주고, 전부 유창이면 "🎉 다 뗐어요!". (사용자 선택)
4. **세로셈 카드는 "배우는 중" 배지**: `openTags`가 한 번에 하나만 열므로 "개방됐으나 미숙련" 유형은 항상 최대 1개 — 배지가 정확히 하나로 떨어진다.
5. **강 단위 딥링크는 없다** (2026-08-04 실측): 시청은 강좌 페이지의 레이어 플레이어(`playLayerInfo`)에서 열리고 로그인·수강신청에 묶여 있다. 링크는 강좌 페이지까지만 가고, **카드가 강 번호를 크게 들고** 아이가 EBS 목록에서 같은 숫자를 찾는다.
6. **아빠 참고 구역**: 구간 로드맵 요약·주의사항은 화면 하단 접힌 `<details>`로 내려간다. 텍스트만 — `navigate()` 없음(아이→부모 링크 금지 불변식).
7. **하지 않는 것**: 시청 기록 저장(필요 증거가 생기면 그때 새 사실 로그로), 잠금, 자동 처방.
8. **복습 구역**: 연산 3단계(두 자리 덧뺄, 세로셈 유형 1~4 대응)를 맨 아래 작게 — 강조하지 않는다. (사용자 선택)

## Global Constraints

- 모든 npm 명령 전에: `export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH"`
- 커밋은 identity 플래그로: `git -c user.name="이성호" -c user.email="watson@daangnpay.com" commit …`
- **워크트리에서 실행한다** (superpowers:using-git-worktrees, harness 네이티브 도구). 워크트리에서 `npm ci` 필수. 끝나면 main에 머지하고 워크트리 제거.
- **main 체크아웃에 다른 세션의 미커밋 변경(`src/engine/derive.ts`·`derive.test.ts`)이 있을 수 있다.** 손대지 말 것. 이 계획은 `derive.ts`의 `deriveTypes`·`everMastered`·`openTags`를 **읽기만** 한다 — Task 1 시작 전에 세 export가 여전히 존재하는지 확인하고, 시그니처가 바뀌었으면 멈추고 사용자에게 알린다.
- 테스트는 `src/engine/`에만. DOM·화면 테스트는 만들지 않는다.
- 파생값을 저장하는 코드를 만들지 않는다 — `Meta.derived`는 죽은 필드다.
- **아이 소속 화면이다.** `navigate()` 호출은 `'#/'`(← 홈) 하나뿐이어야 한다. 아빠 참고 구역 포함 어디에도 부모 화면(`#/parent`·`#/print`·`#/grade`·`#/report`)으로 가는 경로를 만들지 않는다.
- XSS 불변식: 이 화면 템플릿에 들어가는 값은 전부 우리가 만든 리터럴(카탈로그 상수)과 엔진이 계산한 숫자뿐이다. 외부에서 온 문자열을 새로 넣게 되면 `escapeHtml`을 거칠 것.
- 커밋 전 `npm run format` — CI의 `prettier --check .`가 마크다운까지 검사한다.
- main push는 곧 배포다. **push는 사용자가 결정한다 — 계획에 포함하지 않는다.**
- 검증의 초록불은 트리 전체를 본다 — 동시 세션 중에는 내 변경만 보증하지 않음을 보고에 밝힌다.

---

### Task 1: `engine/ebs.ts` — 강좌·주제 카탈로그 + `fmtLectures`

**Files:**

- Create: `src/engine/ebs.ts`
- Test: `src/engine/ebs.test.ts`

**Interfaces:**

- Consumes: `DAN_MIN`·`DAN_MAX`(`./facts`), `VerticalTag`(`../data/types`), `VERTICAL_ORDER`(`./vertical`, 테스트만)
- Produces: `EBS_COURSES`, `CourseKey`, `LectureRef`, `EbsTopic`, `EBS_TOPICS`, `courseUrl(course: CourseKey): string`, `fmtLectures(from: number, to: number): string` — Task 2·3이 그대로 쓴다

- [ ] **Step 1: 실행 전 확인** — `src/engine/derive.ts`에 `deriveTypes`·`everMastered`·`openTags` export가 존재하는지 Read로 확인. 없거나 시그니처가 다르면 **멈추고 사용자에게 보고**.

- [ ] **Step 2: 실패하는 테스트 작성** — `src/engine/ebs.test.ts` 생성:

```ts
import { describe, it, expect } from 'vitest'
import { EBS_COURSES, EBS_TOPICS, courseUrl, fmtLectures } from './ebs'
import { DAN_MAX, DAN_MIN } from './facts'
import { VERTICAL_ORDER } from './vertical'

describe('카탈로그 정합성', () => {
  it('모든 ref가 실존 강좌를 가리키고 강 범위가 정방향이다', () => {
    for (const t of EBS_TOPICS)
      for (const r of t.refs) {
        expect(EBS_COURSES[r.course]).toBeDefined()
        expect(r.from).toBeGreaterThanOrEqual(1)
        expect(r.to).toBeGreaterThanOrEqual(r.from)
      }
  })

  it('dans는 풀 경계(DAN_MIN~DAN_MAX) 안이다', () => {
    for (const t of EBS_TOPICS)
      for (const d of t.dans ?? []) {
        expect(d).toBeGreaterThanOrEqual(DAN_MIN)
        expect(d).toBeLessThanOrEqual(DAN_MAX)
      }
  })

  it('tags는 VERTICAL_ORDER를 정확히 한 번씩 분할한다', () => {
    // 복습 카드 4개 + 세 자리 카드 5개 = 9개. 태그가 새거나 겹치면 배지가 길을 잃는다.
    const all = EBS_TOPICS.flatMap((t) => t.tags ?? [])
    expect([...all].sort()).toEqual([...VERTICAL_ORDER].sort())
  })

  it('key는 유일하다', () => {
    const keys = EBS_TOPICS.map((t) => t.key)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('fmtLectures', () => {
  it('한 강이면 "n번"', () => expect(fmtLectures(7, 7)).toBe('7번'))
  it('연속 두 강이면 가운뎃점', () => expect(fmtLectures(1, 2)).toBe('1·2번'))
  it('셋 이상이면 물결', () => expect(fmtLectures(1, 11)).toBe('1~11번'))
  it('경계: 1~4', () => expect(fmtLectures(1, 4)).toBe('1~4번'))
})

describe('courseUrl', () => {
  it('courseId 좌표를 그대로 쓴다', () => {
    expect(courseUrl('yeonsan4')).toBe('https://primary.ebs.co.kr/course/view?courseId=100004642')
  })
})
```

- [ ] **Step 3: 실패 확인** — Run: `npx vitest run src/engine/ebs.test.ts` — Expected: FAIL (`./ebs` 모듈 없음)

- [ ] **Step 4: 구현** — `src/engine/ebs.ts` 생성:

```ts
import type { VerticalTag } from '../data/types'

/**
 * EBS 만점왕 강좌·주제 카탈로그 — 화면(screens/ebs.ts)이 읽는 단일 출처.
 *
 * 이 카탈로그의 원본은 docs/reference/ebs-manjeomwang-lecture-mapping.md §2
 * (강 단위 매핑)다 — 문서가 원본이고 이 상수는 사본이다. EBS 연도판 개편이나
 * 구간 전환으로 문서가 갱신되면 여기도 함께 고친다.
 *
 * 강좌 페이지 URL까지만 링크한다 — EBS에 강 단위 딥링크는 없다(2026-08-04 실측:
 * 시청은 강좌 페이지의 레이어 플레이어에서 열리고 로그인·수강신청에 묶여 있다).
 * 그래서 fmtLectures가 만드는 강 번호가 카드의 주인공이다 — 아이는 카드의 번호를
 * EBS 강의 목록의 같은 번호와 맞춰 찾는다.
 */
export interface EbsCourse {
  name: string
  id: number
  /** drill = 만점왕 연산(계산 훈련) / concept = 만점왕 수학(개념 설명) */
  kind: 'drill' | 'concept'
}

export const EBS_COURSES = {
  yeonsan3: { name: '연산 3단계', id: 100004641, kind: 'drill' },
  yeonsan4: { name: '연산 4단계', id: 100004642, kind: 'drill' },
  yeonsan5: { name: '연산 5단계', id: 100006155, kind: 'drill' },
  yeonsan6: { name: '연산 6단계', id: 100006156, kind: 'drill' },
  suhak22: { name: '수학 2-2', id: 100005136, kind: 'concept' },
  suhak31: { name: '수학 3-1', id: 100006149, kind: 'concept' },
  suhak32: { name: '수학 3-2', id: 100006220, kind: 'concept' },
} as const satisfies Record<string, EbsCourse>

export type CourseKey = keyof typeof EBS_COURSES

export interface LectureRef {
  course: CourseKey
  /** 강 번호 범위(양 끝 포함). from === to면 한 강. */
  from: number
  to: number
}

export interface EbsTopic {
  key: string
  /** 카드 제목 — 아이 언어. */
  title: string
  /** 제목 밑 작은 보조 설명. 없으면 생략. */
  subtitle?: string
  refs: LectureRef[]
  /** 정복 칸수 표시에 쓰는 단 목록(구구단 카드만). 지도와 같은 정의로 센다. */
  dans?: number[]
  /** '배우는 중' 배지 판정에 쓰는 세로셈 유형(세로셈 카드만). */
  tags?: VerticalTag[]
  group: 'gugudan' | 'ahead' | 'review'
}

/**
 * 주제 서가. 화면 순서 = 이 배열 순서(그룹별로 필터해 그린다).
 *
 * dans가 있는 카드만 정복 칸수를 보여준다 — '섞어서' 카드의 dans는 그 강의가
 * 다루는 단의 합집합이라 다른 카드와 겹치는데, 배지가 아니라 칸수 표시이므로
 * 겹쳐도 각 카드의 숫자는 정확하다. '1단·0의 곱'과 '완성'은 풀 밖이거나 새 단이
 * 없어 dans를 두지 않는다.
 */
export const EBS_TOPICS: EbsTopic[] = [
  {
    key: 'mult-what',
    title: '곱셈이 뭐지?',
    subtitle: '묶어 세기 · 몇 배',
    group: 'gugudan',
    refs: [{ course: 'suhak22', from: 10, to: 21 }],
  },
  {
    key: 'dan-2-5',
    title: '2단 · 5단',
    group: 'gugudan',
    dans: [2, 5],
    refs: [{ course: 'yeonsan4', from: 1, to: 2 }],
  },
  {
    key: 'dan-3-6',
    title: '3단 · 6단',
    group: 'gugudan',
    dans: [3, 6],
    refs: [{ course: 'yeonsan4', from: 3, to: 4 }],
  },
  {
    key: 'dan-2356',
    title: '2·3·5·6단 섞어서',
    group: 'gugudan',
    dans: [2, 3, 5, 6],
    refs: [{ course: 'yeonsan4', from: 5, to: 6 }],
  },
  {
    key: 'dan-4-8',
    title: '4단 · 8단',
    group: 'gugudan',
    dans: [4, 8],
    refs: [{ course: 'yeonsan4', from: 7, to: 8 }],
  },
  {
    key: 'dan-7-9',
    title: '7단 · 9단',
    group: 'gugudan',
    dans: [7, 9],
    refs: [{ course: 'yeonsan4', from: 9, to: 10 }],
  },
  {
    key: 'dan-4789',
    title: '4·7·8·9단 섞어서',
    group: 'gugudan',
    dans: [4, 7, 8, 9],
    refs: [{ course: 'yeonsan4', from: 11, to: 12 }],
  },
  {
    key: 'dan-1-0',
    title: '1단 · 0의 곱 · 곱셈표',
    group: 'gugudan',
    refs: [{ course: 'yeonsan4', from: 13, to: 14 }],
  },
  {
    key: 'dan-final',
    title: '곱셈구구 완성',
    group: 'gugudan',
    refs: [{ course: 'yeonsan4', from: 15, to: 16 }],
  },
  {
    key: 'add3',
    title: '세 자리 덧셈·뺄셈',
    group: 'ahead',
    tags: ['add3-carry1', 'add3-carry2', 'sub3-borrow1', 'sub3-borrow2', 'sub-zero'],
    refs: [
      { course: 'yeonsan5', from: 1, to: 11 },
      { course: 'suhak31', from: 1, to: 10 },
    ],
  },
  {
    key: 'division',
    title: '나눗셈',
    group: 'ahead',
    refs: [
      { course: 'yeonsan5', from: 12, to: 17 },
      { course: 'suhak31', from: 18, to: 24 },
    ],
  },
  {
    key: 'mult-big',
    title: '더 큰 곱셈',
    subtitle: '두 자리 수 곱하기',
    group: 'ahead',
    refs: [
      { course: 'yeonsan5', from: 18, to: 25 },
      { course: 'suhak31', from: 25, to: 33 },
    ],
  },
  {
    key: 'mult-div-3-2',
    title: '더 큰 곱셈과 나눗셈',
    subtitle: '3학년 2학기',
    group: 'ahead',
    refs: [
      { course: 'yeonsan6', from: 1, to: 19 },
      { course: 'suhak32', from: 1, to: 17 },
    ],
  },
  {
    key: 'fraction',
    title: '분수',
    subtitle: '분수와 소수',
    group: 'ahead',
    refs: [
      { course: 'yeonsan6', from: 20, to: 24 },
      { course: 'suhak31', from: 42, to: 51 },
      { course: 'suhak32', from: 25, to: 33 },
    ],
  },
  {
    key: 'review-add2',
    title: '두 자리 덧셈·뺄셈',
    group: 'review',
    tags: ['add2-nocarry', 'sub2-noborrow', 'add2-carry', 'sub2-borrow'],
    refs: [
      { course: 'yeonsan3', from: 1, to: 4 },
      { course: 'yeonsan3', from: 7, to: 10 },
    ],
  },
]

export function courseUrl(course: CourseKey): string {
  return `https://primary.ebs.co.kr/course/view?courseId=${EBS_COURSES[course].id}`
}

/** 강 번호 표기: 7 → "7번", 1·2 → "1·2번", 1~11 → "1~11번". 카드의 주인공이므로 여기서 한 번만 정의한다. */
export function fmtLectures(from: number, to: number): string {
  if (from === to) return `${from}번`
  if (to === from + 1) return `${from}·${to}번`
  return `${from}~${to}번`
}
```

- [ ] **Step 5: 통과 확인** — Run: `npx vitest run src/engine/ebs.test.ts` — Expected: PASS 전부

- [ ] **Step 6: 변이 검증** — `fmtLectures`의 `if (to === from + 1)` 분기를 지우고 테스트 실행 → "연속 두 강" 테스트만 빨간지 확인 → 원복. 카탈로그의 `add3` tags에서 `'sub-zero'`를 지우고 실행 → "분할" 테스트만 빨간지 확인 → 원복.

- [ ] **Step 7: 커밋**

```bash
export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH"
npm run format
git add src/engine/ebs.ts src/engine/ebs.test.ts
git -c user.name="이성호" -c user.email="watson@daangnpay.com" commit -m "feat: EBS 주제 카탈로그 — 강좌 좌표·주제↔강 매핑·강 번호 표기"
```

---

### Task 2: `engine/ebs.ts` — 파생: 정복 칸수 + 배우는 중 배지

**Files:**

- Modify: `src/engine/ebs.ts` (함수 추가)
- Test: `src/engine/ebs.test.ts` (테스트 추가)

**Interfaces:**

- Consumes: Task 1의 `EbsTopic`·`EBS_TOPICS`; `factId`·`FACTOR_MIN`·`FACTOR_MAX`(`./facts`); `everMastered`·`openTags`(`./derive`); `FactState`·`TypeState`(`../data/types`)
- Produces: `ebsProgress(topic: EbsTopic, facts: Record<string, FactState>): { fluent: number; total: number } | null`, `activeVerticalTags(types: Record<string, TypeState>): VerticalTag[]`, `ebsBadge(topic: EbsTopic, types: Record<string, TypeState>): boolean` — Task 3의 화면이 그대로 쓴다

- [ ] **Step 1: 실패하는 테스트 추가** — `src/engine/ebs.test.ts`에 추가 (import 줄도 함께 확장):

```ts
import type { FactState, TypeState } from '../data/types'
import { activeVerticalTags, ebsBadge, ebsProgress } from './ebs'
import { factId, FACTOR_MIN, FACTOR_MAX } from './facts'

const fluentFact = (): FactState => ({
  status: 'fluent',
  medianMs: 1500,
  streak: 3,
  interval: 1,
  nextDue: null,
})
const mastered = (): TypeState => ({ attempts: Array.from({ length: 10 }, () => true) })
const topic = (key: string) => EBS_TOPICS.find((t) => t.key === key)!

describe('ebsProgress', () => {
  it('dans가 없는 주제는 null — 칸수를 표시하지 않는다', () => {
    expect(ebsProgress(topic('dan-final'), {})).toBeNull()
    expect(ebsProgress(topic('mult-what'), {})).toBeNull()
  })

  it('단 묶음의 유창 칸수를 센다 — 지도(fact-map)와 같은 정의', () => {
    const facts: Record<string, FactState> = {}
    for (let b = FACTOR_MIN; b <= FACTOR_MAX; b++) facts[factId(2, b)] = fluentFact()
    facts[factId(5, 1)] = fluentFact()
    expect(ebsProgress(topic('dan-2-5'), facts)).toEqual({ fluent: 10, total: 18 })
  })

  it('기록이 없으면 0/전체', () => {
    expect(ebsProgress(topic('dan-2356'), {})).toEqual({ fluent: 0, total: 36 })
  })
})

describe('배우는 중 배지', () => {
  it('기록이 없으면 첫 유형이 열려 있고 복습 카드에 배지가 붙는다', () => {
    expect(activeVerticalTags({})).toEqual(['add2-nocarry'])
    expect(ebsBadge(topic('review-add2'), {})).toBe(true)
    expect(ebsBadge(topic('add3'), {})).toBe(false)
  })

  it('두 자리 4유형을 떼면 배지가 세 자리 카드로 넘어간다', () => {
    const types: Record<string, TypeState> = {
      'add2-nocarry': mastered(),
      'sub2-noborrow': mastered(),
      'add2-carry': mastered(),
      'sub2-borrow': mastered(),
    }
    expect(activeVerticalTags(types)).toEqual(['add3-carry1'])
    expect(ebsBadge(topic('review-add2'), types)).toBe(false)
    expect(ebsBadge(topic('add3'), types)).toBe(true)
  })

  it('전부 떼면 어디에도 배지가 없다', () => {
    const types: Record<string, TypeState> = {}
    for (const tag of VERTICAL_ORDER) types[tag] = mastered()
    expect(activeVerticalTags(types)).toEqual([])
    expect(ebsBadge(topic('review-add2'), types)).toBe(false)
    expect(ebsBadge(topic('add3'), types)).toBe(false)
  })

  it('tags가 없는 주제는 배지가 없다', () => {
    expect(ebsBadge(topic('mult-what'), {})).toBe(false)
    expect(ebsBadge(topic('dan-2-5'), {})).toBe(false)
  })
})
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/engine/ebs.test.ts` — Expected: FAIL (`ebsProgress` 등 미정의)

- [ ] **Step 3: 구현** — `src/engine/ebs.ts`에 추가:

```ts
import type { FactState, TypeState } from '../data/types'
import { factId, FACTOR_MAX, FACTOR_MIN } from './facts'
import { everMastered, openTags } from './derive'

/**
 * 카드의 단 묶음에서 유창 칸수를 센다 — 지도(fact-map.ts)의 칸 세기와 같은 정의라
 * 두 화면의 숫자가 어긋날 수 없다. dans가 없는 카드는 null(표시하지 않음).
 *
 * 이진 배지가 아니라 칸수인 이유: Phase 4의 신규 식 무작위 도입 이후 '배우는 중인
 * 단'은 거의 모든 단에서 동시에 참이라 배지로는 정보가 0이다(2026-08-04 결정).
 */
export function ebsProgress(
  topic: EbsTopic,
  facts: Record<string, FactState>,
): { fluent: number; total: number } | null {
  if (!topic.dans) return null
  let fluent = 0
  for (const dan of topic.dans)
    for (let b = FACTOR_MIN; b <= FACTOR_MAX; b++)
      if (facts[factId(dan, b)]?.status === 'fluent') fluent++
  return { fluent, total: topic.dans.length * (FACTOR_MAX - FACTOR_MIN + 1) }
}

/**
 * 개방됐지만 아직 숙련하지 못한 세로셈 유형. openTags가 앞에서부터 하나씩만 열므로
 * 결과는 최대 1개다 — '배우는 중' 배지가 정확히 한 카드에만 붙는 근거.
 */
export function activeVerticalTags(types: Record<string, TypeState>): VerticalTag[] {
  return openTags(types).filter((tag) => !everMastered(types[tag]))
}

/** 이 카드에 '배우는 중' 배지를 붙일 것인가. */
export function ebsBadge(topic: EbsTopic, types: Record<string, TypeState>): boolean {
  if (!topic.tags) return false
  const active = activeVerticalTags(types)
  return topic.tags.some((tag) => active.includes(tag))
}
```

- [ ] **Step 4: 통과 확인** — Run: `npx vitest run src/engine/ebs.test.ts` — Expected: PASS 전부

- [ ] **Step 5: 변이 검증** — `activeVerticalTags`의 `!everMastered(...)`에서 `!`를 지우고 실행 → 배지 테스트들만 빨간지 확인 → 원복. `ebsProgress`의 `=== 'fluent'`를 `!== 'new'`로 바꾸고 실행 → 칸수 테스트가 빨간지 확인 → 원복.

- [ ] **Step 6: 커밋**

```bash
npm run format
git add src/engine/ebs.ts src/engine/ebs.test.ts
git -c user.name="이성호" -c user.email="watson@daangnpay.com" commit -m "feat: EBS 파생 — 정복 칸수(지도와 동일 정의)·배우는 중 배지"
```

---

### Task 3: 화면 재작성 — `screens/ebs.ts` + `main.ts` + CSS

**Files:**

- Rewrite: `src/screens/ebs.ts` (전체 교체)
- Modify: `src/main.ts` (renderEbs 호출에 `await` — `#/ebs` 분기)
- Modify: `src/styles/app.css` (`.ebs-*` 블록 전체 교체)

**Interfaces:**

- Consumes: Task 1·2의 모든 export; `getAllDays`·`getMeta`(`../data/db`); `deriveFacts`(`../engine/facts`); `deriveTypes`(`../engine/derive`); `el`·`navigate`·`showError`(`../ui`)
- Produces: `renderEbs(root: HTMLElement): Promise<void>` (async로 바뀜 — main.ts가 await)

- [ ] **Step 1: 화면 교체** — `src/screens/ebs.ts` 전체를 다음으로:

```ts
import type { FactState, TypeState } from '../data/types'
import { getAllDays, getMeta } from '../data/db'
import { deriveTypes } from '../engine/derive'
import {
  EBS_COURSES,
  EBS_TOPICS,
  courseUrl,
  ebsBadge,
  ebsProgress,
  fmtLectures,
  type EbsTopic,
} from '../engine/ebs'
import { deriveFacts } from '../engine/facts'
import { el, navigate, showError } from '../ui'

const KIND_LABEL = { drill: '계산 연습', concept: '개념' } as const

/**
 * 주제 카드 하나. 템플릿에 들어가는 값은 전부 카탈로그 리터럴과 엔진이 계산한
 * 숫자뿐이라 escapeHtml이 필요 없다 — 외부 문자열을 넣게 되면 그때는 거칠 것.
 */
function topicHtml(
  topic: EbsTopic,
  facts: Record<string, FactState>,
  types: Record<string, TypeState>,
): string {
  const p = ebsProgress(topic, facts)
  const done = p !== null && p.fluent === p.total
  const flag = done
    ? ' <span class="ebs-flag">🎉 다 뗐어요!</span>'
    : ebsBadge(topic, types)
      ? ' <span class="ebs-active">배우는 중</span>'
      : ''
  const sub = topic.subtitle ? ` <small>${topic.subtitle}</small>` : ''
  const links = topic.refs
    .map((ref) => {
      const c = EBS_COURSES[ref.course]
      return `<a class="ebs-link" href="${courseUrl(ref.course)}" target="_blank" rel="noopener"><b>${fmtLectures(ref.from, ref.to)}</b> ${c.name} <i>${KIND_LABEL[c.kind]}</i></a>`
    })
    .join('')
  const progress =
    p === null || done
      ? ''
      : `<div class="ebs-bar"><i style="width:${Math.round((p.fluent / p.total) * 100)}%"></i></div>
         <div class="ebs-count">정복 ${p.fluent}/${p.total}칸</div>`
  return `
    <section class="ebs-topic">
      <h3>${topic.title}${sub}${flag}</h3>
      <div class="ebs-links">${links}</div>
      ${progress}
    </section>`
}

/**
 * EBS 강의 서가 — 주제 축으로 강의를 고르는 화면(아이·부모 공용, 소속은 아이).
 *
 * 주제↔강 매핑은 engine/ebs.ts 카탈로그가 단일 출처이고, 그 카탈로그의 원본은
 * docs/reference/ebs-manjeomwang-lecture-mapping.md §2다. EBS에는 강 단위
 * 딥링크가 없어(2026-08-04 실측) 링크는 강좌 페이지까지만 가고, 아이는 카드의
 * 강 번호를 EBS 목록의 같은 번호와 맞춰 찾는다.
 *
 * 여기의 navigate()는 '← 홈'(#/) 하나뿐이어야 한다 — 아이 소속 화면이므로
 * 부모 화면으로 가는 경로를 만들지 않는다(CLAUDE.md 불변식). 하단의 '아빠 참고'
 * 접힘 구역은 텍스트만 담는다 — 링크·버튼을 넣게 되면 이 불변식을 다시 볼 것.
 */
export async function renderEbs(root: HTMLElement): Promise<void> {
  try {
    const meta = await getMeta()
    const days = await getAllDays()
    const facts = deriveFacts(days, meta.settings.fluentMs)
    const types = deriveTypes(days)
    const group = (g: EbsTopic['group']) =>
      EBS_TOPICS.filter((t) => t.group === g)
        .map((t) => topicHtml(t, facts, types))
        .join('')

    root.replaceChildren(
      el(`
        <div>
          <h1>EBS 강의 보기</h1>
          <div class="date">보고 싶은 것을 골라서 눌러 보세요</div>
          <h2 class="ebs-group">구구단</h2>
          ${group('gugudan')}
          <h2 class="ebs-group">더 나아가기</h2>
          ${group('ahead')}
          <h2 class="ebs-group">복습하고 싶을 때</h2>
          ${group('review')}
          <details class="ebs-parent">
            <summary>아빠 참고 — 로드맵과 주의사항</summary>
            <ul>
              <li><b>2026년 8월~12월 (2-2 학기)</b> 학교 진도에 맞춰 연산 4단계를 한 묶음씩. 여름방학엔 2·5단(+도입했다면 3·6단)까지만 — 81식 전면 진도는 금지</li>
              <li><b>2026년 11월</b> 7단·9단 정체는 정상 — 강의 재시청 용도로 쓰기</li>
              <li><b>2027년 1~2월 (겨울방학) ★</b> 곱셈구구 완성(15·16번) + 역인출 훈련(앱 담당). 연산 5단계 나눗셈은 미리 열지 않기 — 역인출이 먼저다</li>
              <li><b>2027년 3월~ (3학년)</b> 학교보다 반 박자 늦게, 강의 단위로. 3-2는 절차 부하 정점 — 분량 조절이 관건</li>
              <li>원본: docs/reference/ebs-manjeomwang-lecture-mapping.md §4 (조사일 2026-08-03)</li>
            </ul>
          </details>
          <button class="step" id="back">← 홈</button>
        </div>
      `),
    )
    root.querySelector('#back')!.addEventListener('click', () => navigate('#/'))
  } catch (e) {
    showError(`강의 목록을 열지 못했어요: ${(e as Error).message}`)
    root.replaceChildren(el(`<div><button class="step" id="back">← 홈</button></div>`))
    root.querySelector('#back')!.addEventListener('click', () => navigate('#/'))
  }
}
```

- [ ] **Step 2: main.ts** — `#/ebs` 분기(현재 76~78행 부근)의 `renderEbs(app)`을 `await renderEbs(app)`으로.

- [ ] **Step 3: CSS 교체** — `src/styles/app.css`의 `/* EBS 강의 보기 화면 — 정적 참조 카드 */` 주석부터 `.ebs-caution { ... }` 블록 끝까지를 다음으로 교체:

```css
/* EBS 강의 서가 — 주제 카드. 데이터는 engine/ebs.ts 카탈로그가 단일 출처다 */
.ebs-group {
  font-size: 14px;
  color: var(--muted);
  margin: 20px 0 8px;
}
.ebs-topic {
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 12px 16px;
  margin-bottom: 10px;
}
.ebs-topic h3 {
  font-size: 16px;
  margin: 0 0 6px;
}
.ebs-topic h3 small {
  font-size: 13px;
  font-weight: 400;
  color: var(--muted);
}
.ebs-flag {
  font-size: 13px;
  color: #1f9d55;
}
.ebs-active {
  font-size: 12px;
  font-weight: 400;
  background: #f2760c;
  color: #fff;
  border-radius: 99px;
  padding: 2px 8px;
  vertical-align: middle;
}
.ebs-link {
  display: block;
  padding: 5px 0;
  color: inherit;
  text-decoration: none;
  font-size: 14px;
}
.ebs-link b {
  font-size: 17px;
  margin-right: 6px;
}
.ebs-link i {
  font-style: normal;
  font-size: 12px;
  color: var(--muted);
  margin-left: 4px;
}
.ebs-bar {
  height: 6px;
  background: #eee;
  border-radius: 3px;
  overflow: hidden;
  margin-top: 8px;
}
.ebs-bar i {
  display: block;
  height: 100%;
  background: var(--fg);
}
.ebs-count {
  font-size: 12px;
  color: var(--muted);
  margin-top: 4px;
}
.ebs-parent {
  margin: 20px 0;
  font-size: 13px;
  color: var(--muted);
}
.ebs-parent summary {
  cursor: pointer;
}
.ebs-parent ul {
  margin: 8px 0 0;
  padding-left: 18px;
}
.ebs-parent li {
  margin-bottom: 6px;
}
```

- [ ] **Step 4: 빌드·테스트 확인** — Run: `npm run build && npm test` — Expected: 둘 다 PASS (tsc가 main.ts await·타입 정합까지 검사)

- [ ] **Step 5: 눈 확인** — `npm run dev` 후 `http://localhost:5173/haruchi/#/ebs` 접속. 확인 목록: ① 세 그룹 제목과 15개 카드가 순서대로 ② 카드의 강 번호가 굵게 ③ **빈 DB에서는** 구구단 카드가 전부 "정복 0/N칸", 복습 카드에 '배우는 중' 배지 — 이는 정상이다(기록이 없으면 첫 유형이 열려 있다) ④ 아빠 참고가 접혀 있고 펼치면 텍스트만 ⑤ '← 홈'이 아이 홈으로. **워크트리 dev 서버는 5174 등 다른 포트일 수 있고, 그러면 origin이 달라 IndexedDB가 비어 보인다 — 데이터 유실이 아니다(CLAUDE.md).**

- [ ] **Step 6: navigate 전수 확인** — `grep -n "navigate(" src/screens/ebs.ts` — Expected: `navigate('#/')` 한 건뿐

- [ ] **Step 7: 커밋**

```bash
npm run format
git add src/screens/ebs.ts src/main.ts src/styles/app.css
git -c user.name="이성호" -c user.email="watson@daangnpay.com" commit -m "feat: EBS 화면을 주제 서가로 재편 — 정복 칸수·배우는 중 배지·아빠 참고 접힘"
```

---

### Task 4: 문서 동기화 + 전체 검증

**Files:**

- Modify: `docs/reference/ebs-manjeomwang-lecture-mapping.md` (머리에 앱 화면과의 관계 1문단)
- Modify: `docs/superpowers/HANDOFF.md` (「지금 상태」아래 날짜 문단 1개 추가)

**Interfaces:**

- Consumes: 없음 (문서만)
- Produces: 없음

- [ ] **Step 1: 매핑 문서** — `# EBS 만점왕 동영상 강좌 ↔ 참고 문서 매핑` 제목 바로 아래(§0 이전)에 추가:

```markdown
> **앱 화면과의 관계 (2026-08-04 리뉴얼 이후):** `src/engine/ebs.ts`의 주제 카탈로그가
> 이 문서 §2(강 단위 매핑)의 사본이고, `src/screens/ebs.ts`의 '아빠 참고' 구역이 §4
> (구간별 배정)의 요약 사본이다. 문서가 원본 — EBS 연도판 개편·구간 전환으로 이 문서를
> 갱신하면 두 코드도 함께 고칠 것.
```

(2026-08-04 확인: 이 문서에는 화면을 가리키는 기존 문구가 없다 — 추가만 하면 된다.)

- [ ] **Step 2: HANDOFF** — 「지금 상태」표 아래 날짜 문단들 옆에 추가:

```markdown
2026-08-04: EBS 화면(`#/ebs`)을 주제 서가로 리뉴얼 — 구간 A~D 나열 대신 아이 언어
주제 카드(구구단 8 + 개념·3학년 6 + 복습 1), 정복 칸수(지도와 동일 파생)·'배우는 중'
배지(세로셈 개방 경계), 하단 '아빠 참고' 접힘. 강 단위 딥링크는 EBS에 없음을 실측으로
확인(강좌 페이지 레이어 플레이어) — 카드가 강 번호를 크게 들고 아이가 번호를 맞춰
찾는 설계다. 시청 기록은 저장하지 않는다(필요 증거가 생기면 새 사실 로그로). 계획:
`plans/2026-08-04-ebs-topic-shelf.md`.
```

- [ ] **Step 3: 전체 검증** — Run:

```bash
npm run format
npx prettier --check .
npm test
npm run build
```

Expected: 전부 clean/PASS. **동시 세션이 있으면 이 초록불은 트리 전체 기준이다 — 보고에 밝힌다.**

- [ ] **Step 4: 커밋**

```bash
git add docs/reference/ebs-manjeomwang-lecture-mapping.md docs/superpowers/HANDOFF.md
git -c user.name="이성호" -c user.email="watson@daangnpay.com" commit -m "docs: EBS 리뉴얼 문서 동기화 — 원본↔사본 관계 갱신·인수인계 기록"
```

- [ ] **Step 5: 머지** — superpowers:finishing-a-development-branch 절차대로. main을 최신으로 만들고(`git switch main && git pull`) 워크트리 브랜치를 머지, 충돌 시 CLAUDE.md의 rebase-merge 규칙과 예외(멈추고 노티)를 따른다. **push는 사용자에게 묻는다 — main push가 곧 배포다.**
