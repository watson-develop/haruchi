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

// ── 리뷰 라운드 2 "함께 고칠 것 B": 헬퍼가 아니라 실제 사용 지점(출력)을 지키는 테스트 ──
// 재리뷰어가 실증했듯, copula·personJosa 헬퍼 자체를 테스트해도 "그 헬퍼를 실제로
// 부르는 문형"이 도로 옛 코드로 회귀하면(예: TIMES[3]이 copula(g.unit) 대신 하드코딩
// '이에요'로 되돌아가도) 헬퍼 단위 테스트는 여전히 초록이다 — 브리프의 6개 테스트도
// 마찬가지다('서연' 부분 문자열만 보므로 josa로 되돌려도 통과한다). 그래서 시드 루프를
// 도는 composeWordItems의 실제 출력 텍스트에 정규식을 건다.

describe('composeWordItems — 출력 수준 회귀 방지(리뷰 라운드 2 "함께 고칠 것 B")', () => {
  it('생성된 텍스트 어디에도 개·자루·번 뒤에 이에요가 붙지 않는다', () => {
    for (let seed = 1; seed <= 100; seed++) {
      for (const it of composeWordItems({ settings, rand: lcg(seed), seen: new Set() })) {
        expect(it.text, `seed ${seed}: ${it.text}`).not.toMatch(/(개|자루|번)이에요/)
      }
    }
  })

  it('서연(받침 있음)의 모든 등장은 서연이+조사 형태다(서연이가/이는/이를/이의) — 맨 서연은·서연을·서연의·서연가는 없다', () => {
    // 부정형 lookahead 하나로 충분하다: "서연" 뒤에 "이"+(가|는|를|의)가 안 이어지는
    // 자리를 전부 잡는다. 리뷰가 예로 든 '서연은'·'서연을'·'서연의'뿐 아니라, josa의
    // 이/가 분기가 우연히 '이'와 같아서 생기는 "서연이"(뒤에 '가'가 안 붙는 격식체
    // 잔재, personJosa를 josa로 되돌렸을 때 이/가 슬롯에서 나오는 형태)까지 잡는다 —
    // 리뷰가 준 예시보다 한 겹 더 넓게 잡은 것이므로 보고서에 그 이유를 남긴다.
    for (let seed = 1; seed <= 100; seed++) {
      for (const it of composeWordItems({ settings, rand: lcg(seed), seen: new Set() })) {
        expect(it.text, `seed ${seed}: ${it.text}`).not.toMatch(/서연(?!이(가|는|를|의))/)
      }
    }
  })
})
