import { describe, it, expect } from 'vitest'
import type { FactState, TypeState } from '../data/types'
import {
  EBS_COURSES,
  EBS_TOPICS,
  activeVerticalTags,
  courseUrl,
  ebsBadge,
  ebsProgress,
  fmtLectures,
} from './ebs'
import { DAN_MAX, DAN_MIN, FACTOR_MAX, FACTOR_MIN, factId } from './facts'
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
