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
