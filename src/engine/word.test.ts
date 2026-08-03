import { describe, it, expect } from 'vitest'
import { composeWordItems, josa, personJosa, copula } from './word'
import { DEFAULT_SETTINGS } from '../data/types'
import type { Settings } from '../data/types'

function lcg(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return s / 0x7fffffff
  }
}
const settings: Settings = { ...DEFAULT_SETTINGS, childName: '서연', friendNames: ['지호', '민아'] }

describe('josa', () => {
  it('받침 있는 이름과 없는 이름 양쪽', () => {
    expect(josa('서연', '이/가')).toBe('서연이')
    expect(josa('민아', '이/가')).toBe('민아가')
    expect(josa('지호', '은/는')).toBe('지호는')
    expect(josa('서연', '은/는')).toBe('서연은')
    expect(josa('사탕', '을/를')).toBe('사탕을')
    expect(josa('색종이', '을/를')).toBe('색종이를')
  })
})

describe('composeWordItems', () => {
  it('묶어 세기(그림 칸) 1 + 몇 배 1, id는 w1·w2', () => {
    const items = composeWordItems({ settings, rand: lcg(1), seen: new Set() })
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({ id: 'w1', tag: 'mul-group', needsDrawing: true })
    expect(items[1]).toMatchObject({ id: 'w2', tag: 'mul-times', needsDrawing: false })
  })

  it('expression과 answer가 일치하고 수 범위를 지킨다 (몇 배의 배수는 2~5)', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const [group, times] = composeWordItems({ settings, rand: lcg(seed), seen: new Set() })
      for (const it of [group!, times!]) {
        const m = /^([2-9])×([2-9])$/.exec(it.expression)
        expect(m, it.expression).not.toBeNull()
        expect(Number(m![1]) * Number(m![2])).toBe(it.answer)
      }
      // 몇 배: expression은 `기준량×배수`이고 배수(뒤)는 2~5
      const mult = Number(times!.expression.split('×')[1])
      expect(mult).toBeGreaterThanOrEqual(2)
      expect(mult).toBeLessThanOrEqual(5)
    }
  })

  it('하루 두 문항 중 하나엔 반드시 딸 이름이 들어간다', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const items = composeWordItems({ settings, rand: lcg(seed), seen: new Set() })
      expect(
        items.some((it) => it.text.includes('서연')),
        `seed ${seed}`,
      ).toBe(true)
    }
  })

  it('두 문항이 같은 곱셈식을 쓰지 않고, seen의 기존 수식을 피한다', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const seen = new Set<string>(['3×4']) // 전략 존이 이미 3×4를 쓴 날이라고 치자
      const [g, t] = composeWordItems({ settings, rand: lcg(seed), seen })
      expect(g!.expression).not.toBe(t!.expression)
      expect(g!.expression).not.toBe('3×4')
      expect(t!.expression).not.toBe('3×4')
    }
  })

  it('수사+단위 직결 문구("2주머니")가 없다', () => {
    for (let seed = 1; seed <= 60; seed++) {
      for (const it of composeWordItems({ settings, rand: lcg(seed), seen: new Set() })) {
        // 숫자 뒤에 담는 단위가 바로 붙는 패턴 금지 — "봉지 3개" 형태만 허용
        expect(it.text, `seed ${seed}: ${it.text}`).not.toMatch(
          /\d(봉지|주머니|필통|접시|묶음|상자|줄)/,
        )
      }
    }
  })

  it('unit이 답 칸 단위로 들어 있다', () => {
    const [g, t] = composeWordItems({ settings, rand: lcg(2), seen: new Set() })
    expect(g!.unit.length).toBeGreaterThan(0)
    expect(t!.unit.length).toBeGreaterThan(0)
  })
})

// ── 리뷰 라운드 2 반영: 사람용 조사·계사·딸 이름 불변식(정체 비교) ──

describe('personJosa', () => {
  it('받침 있는 이름은 이름+이+조사(서연이가/서연이는/서연이를) — 사용자 결정', () => {
    expect(personJosa('서연', '이/가')).toBe('서연이가')
    expect(personJosa('서연', '은/는')).toBe('서연이는')
    expect(personJosa('서연', '을/를')).toBe('서연이를')
  })

  it('받침 없는 이름은 josa와 동일하다(민아가/지호는)', () => {
    expect(personJosa('민아', '이/가')).toBe('민아가')
    expect(personJosa('지호', '은/는')).toBe('지호는')
  })

  it("'나'의 주격은 불규칙 활용 '내가'다 — 규칙대로면 '나가'(동사 나가다로 오독)가 된다", () => {
    expect(personJosa('나', '이/가')).toBe('내가')
    expect(personJosa('나', '은/는')).toBe('나는')
    expect(personJosa('나', '을/를')).toBe('나를')
  })
})

describe('copula', () => {
  it('받침 없는 단위(개·자루)는 예요, 받침 있는 단위(장)는 이에요', () => {
    expect(copula('개')).toBe('예요')
    expect(copula('자루')).toBe('예요')
    expect(copula('장')).toBe('이에요')
  })
})

describe('composeWordItems — childName이 빈 문자열(출하 기본값)', () => {
  // childName: ''일 때 child는 '나'로 떨어진다(word.ts). 여기서 bare '나' 부분 문자열로
  // 검사하면 GROUP_TEMPLATES[2]의 "나누어 주려고"에 우연히 걸린다 — 그게 바로 리뷰가
  // 잡은 버그(문항1이 실제로는 다른 사람 얘기인데도 '나'를 포함한 걸로 오판)였다.
  // personJosa('나', ·)의 세 결과형(내가/나는/나를)만 "아이 본인이 실제 주인공"임을
  // 가리키는 유일한 표식이므로, 그 형태로만 확인한다.
  const emptyChildSettings: Settings = { ...DEFAULT_SETTINGS, childName: '' }

  it('딸 이름이 없어도 하루 한 문항 이상 주인공이 아이다(내가/나는/나를 형태로 검증)', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const items = composeWordItems({
        settings: emptyChildSettings,
        rand: lcg(seed),
        seen: new Set(),
      })
      const hasChild = items.some((it) =>
        ['내가', '나는', '나를'].some((form) => it.text.includes(form)),
      )
      expect(hasChild, `seed ${seed}: ${items.map((it) => it.text).join(' | ')}`).toBe(true)
    }
  })
})
