import type { FactState, TypeState, VerticalTag } from '../data/types'
import { everMastered, openTags } from './derive'
import { factId, FACTOR_MAX, FACTOR_MIN } from './facts'

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
  /** '문제지에 나와요' 배지 판정에 쓰는 세로셈 유형(세로셈 카드만). */
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
  if (!topic.dans?.length) return null
  let fluent = 0
  for (const dan of topic.dans)
    for (let b = FACTOR_MIN; b <= FACTOR_MAX; b++)
      if (facts[factId(dan, b)]?.status === 'fluent') fluent++
  return { fluent, total: topic.dans.length * (FACTOR_MAX - FACTOR_MIN + 1) }
}

/**
 * 개방됐지만 아직 숙련하지 못한 세로셈 유형. openTags가 앞에서부터 하나씩만 열므로
 * 결과는 최대 1개다 — '문제지에 나와요' 배지가 정확히 한 카드에만 붙는 근거.
 */
export function activeVerticalTags(types: Record<string, TypeState>): VerticalTag[] {
  return openTags(types).filter((tag) => !everMastered(types[tag]))
}

/** 이 카드에 '문제지에 나와요' 배지를 붙일 것인가. */
export function ebsBadge(topic: EbsTopic, types: Record<string, TypeState>): boolean {
  if (!topic.tags) return false
  const active = activeVerticalTags(types)
  return topic.tags.some((tag) => active.includes(tag))
}
