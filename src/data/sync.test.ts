import { describe, it, expect } from 'vitest'
import { skipUnchangedPush } from './sync'
import { EMPTY_STAMPS } from '../engine/merge'
import type { Stamped } from '../engine/merge'
import type { Day } from './types'

const DAY: Day = {
  date: '2026-08-01',
  kind: 'normal',
  sheet: [{ id: '1', kind: 'vertical', tag: 'add2-nocarry', a: 10, b: 16, op: '+', answer: 26 }],
}
const stamped = (day: Day, at: Partial<Stamped<Day>['at']> = {}): Stamped<Day> => ({
  value: day,
  at: { ...EMPTY_STAMPS, ...at },
})
const AT = '2026-08-10T00:00:00.000Z'

describe('skipUnchangedPush — §6 무변경 push 생략', () => {
  it('값·스탬프가 서버와 같으면 생략한다', () => {
    const at = { sheetAt: AT, sheetBy: 'd1' }
    expect(
      skipUnchangedPush(stamped(DAY, at), stamped(DAY, at), 'd1', '2026-08-13T00:00:00Z'),
    ).toBe(true)
  })

  it('스탬프 all-null 행은 생략하지 않는다 — sendStamps의 null 보정이 나가야 한다', () => {
    // 1단계 업로드(2026-08-07)가 남긴 실재 상태: 서버·로컬 둘 다 스탬프 null +
    // 비어 있지 않은 sheet. merged.at끼리 비교하는 구현(잘못)은 여기서 true가 된다 —
    // 그러면 null 보정 PATCH가 영영 안 나가 그 묶음이 이후 모든 LWW에서 진다.
    expect(skipUnchangedPush(stamped(DAY), stamped(DAY), 'd1', '2026-08-13T00:00:00Z')).toBe(false)
  })

  it('빈 묶음(grades {}·sprint [])은 비교 전에 벗긴다 — 서버 행은 이미 벗겨져 있다', () => {
    // rowToStampedDay는 withoutEmptyBundles를 지난 값을 준다. 좌변을 생으로 비교하면
    // 빈 묶음이 실린 날짜가 영원히 「다름」이 되어 매 로테이션마다 다시 올라간다.
    const withEmpty: Day = { ...DAY, grades: {}, sprint: [] }
    const at = { sheetAt: AT, sheetBy: 'd1' }
    expect(
      skipUnchangedPush(stamped(withEmpty, at), stamped(DAY, at), 'd1', '2026-08-13T00:00:00Z'),
    ).toBe(true)
  })

  it('값이 다르면 생략하지 않는다', () => {
    const at = { sheetAt: AT, sheetBy: 'd1' }
    const other: Day = { ...DAY, grades: { '1': true }, mood: 'ok' }
    expect(
      skipUnchangedPush(
        stamped(other, { ...at, gradesAt: AT, gradesBy: 'd1' }),
        stamped(DAY, at),
        'd1',
        AT,
      ),
    ).toBe(false)
  })
})
