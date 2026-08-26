import { describe, it, expect } from 'vitest'
import { composeWordItems, josa, personJosa, copula, WORD_NAMES } from './word'
import type { WordNames } from './word'
import type { WordItem } from '../data/types'

function lcg(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return s / 0x7fffffff
  }
}
// 주입 이름을 따로 두는 이유: 아래 "서연이+조사" 출력 회귀 테스트는 받침 없는 이름으로는
// 아무것도 검사하지 못하는데, child 슬롯이 받침 있는 이름인 상황도 함께 지켜야 한다
// (프로덕션 child '유나'는 받침이 없다). 이름이 인자인 이유가 이것이다.
const names: WordNames = { child: '서연', friends: ['지호', '민아'] }

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
    const items = composeWordItems({ names, rand: lcg(1), seen: new Set() })
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({ id: 'w1', tag: 'mul-group', needsDrawing: true })
    expect(items[1]).toMatchObject({ id: 'w2', tag: 'mul-times', needsDrawing: false })
  })

  it('expression과 answer가 일치하고 수 범위를 지킨다 (몇 배의 배수는 2~5)', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const [group, times] = composeWordItems({ names, rand: lcg(seed), seen: new Set() })
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
    for (let seed = 1; seed <= 600; seed++) {
      const items = composeWordItems({ names, rand: lcg(seed), seen: new Set() })
      expect(
        items.some((it) => it.text.includes('서연')),
        `seed ${seed}`,
      ).toBe(true)
    }
  })

  it('두 문항이 같은 곱셈식을 쓰지 않고, seen의 기존 수식을 피한다', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const seen = new Set<string>(['3×4']) // 전략 존이 이미 3×4를 쓴 날이라고 치자
      const [g, t] = composeWordItems({ names, rand: lcg(seed), seen })
      expect(g!.expression).not.toBe(t!.expression)
      expect(g!.expression).not.toBe('3×4')
      expect(t!.expression).not.toBe('3×4')
    }
  })

  it('수사+단위 직결 문구("2주머니")가 없다', () => {
    for (let seed = 1; seed <= 60; seed++) {
      for (const it of composeWordItems({ names, rand: lcg(seed), seen: new Set() })) {
        // 숫자 뒤에 담는 단위가 바로 붙는 패턴 금지 — "봉지 3개" 형태만 허용
        expect(it.text, `seed ${seed}: ${it.text}`).not.toMatch(
          /\d(봉지|주머니|필통|접시|묶음|상자|줄)/,
        )
      }
    }
  })

  it('unit이 답 칸 단위로 들어 있다', () => {
    const [g, t] = composeWordItems({ names, rand: lcg(2), seen: new Set() })
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

describe('composeWordItems — child가 빈 문자열', () => {
  // child: ''일 때 '나'로 떨어진다(word.ts). 여기서 bare '나' 부분 문자열로
  // 검사하면 GROUP_TEMPLATES[2]의 "나누어 주려고"에 우연히 걸린다 — 그게 바로 리뷰가
  // 잡은 버그(문항1이 실제로는 다른 사람 얘기인데도 '나'를 포함한 걸로 오판)였다.
  // personJosa('나', ·)의 세 결과형(내가/나는/나를)만 "아이 본인이 실제 주인공"임을
  // 가리키는 유일한 표식이므로, 그 형태로만 확인한다.
  //
  // Task 4 추가: TIMES의 리본 문형은 p를 주격·목적격 자리 없이 소유격("{p}의 리본은")
  // 으로만 쓴다 — personStem(p)만 타고 personJosa(p, ...)를 한 번도 안 부른다. 그래서
  // child가 '나'일 때 이 문형은 내가/나는/나를을 하나도 안 내고 '나의'만 낸다(seed 10에서
  // 실제로 FAIL로 드러남). '나의'는 '나가'(동사 오독) 같은 문제가 없는 정상 소유격이라
  // personStem에 예외를 추가할 이유는 없고 — 오히려 '내'로 축약하면 '내의'(속옷)와
  // 충돌한다 — 검증 쪽 표식 목록을 넓히는 것이 맞다.
  const emptyChild: WordNames = { child: '', friends: ['지호', '민아'] }

  it('딸 이름이 없어도 하루 한 문항 이상 주인공이 아이다(내가/나는/나를/나의 형태로 검증)', () => {
    for (let seed = 1; seed <= 600; seed++) {
      const items = composeWordItems({ names: emptyChild, rand: lcg(seed), seen: new Set() })
      const hasChild = items.some((it) =>
        ['내가', '나는', '나를', '나의'].some((form) => it.text.includes(form)),
      )
      expect(hasChild, `seed ${seed}: ${items.map((it) => it.text).join(' | ')}`).toBe(true)
    }
  })
})

describe('WORD_NAMES — 프로덕션 이름', () => {
  // 시드 상한이 600인 이유: 유령 인물 오염(무인물 문형이 뽑힌 날 person이 seen에 등록되어
  // 문항2의 child 강제가 풀리는 경로)은 그 인물이 우연히 child와 같은 이름일 때만 발현해서
  // 드물다. 변이 주입 실측(2026-08-26, 리본 문형의 hasPerson: false 제거): 프로덕션 인물
  // 풀에서 1..200은 위반 0건, 1..500에서 8건, 1..1000에서 24건이 나왔다. 인물이 5명이라
  // 우연 일치 확률이 1/5로 낮은 것이 원인이다 — 범위를 줄이면 이 테스트는 조용히 눈을 감는다.
  it('딸 이름이 실제 문장제 텍스트에 그대로 들어간다(받침 없는 이름이라 접미사 없이)', () => {
    for (let seed = 1; seed <= 600; seed++) {
      const items = composeWordItems({ names: WORD_NAMES, rand: lcg(seed), seen: new Set() })
      expect(
        items.some((it) => it.text.includes(WORD_NAMES.child)),
        `seed ${seed}: ${items.map((it) => it.text).join(' | ')}`,
      ).toBe(true)
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
      for (const it of composeWordItems({ names, rand: lcg(seed), seen: new Set() })) {
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
      for (const it of composeWordItems({ names, rand: lcg(seed), seen: new Set() })) {
        expect(it.text, `seed ${seed}: ${it.text}`).not.toMatch(/서연(?!이(가|는|를|의))/)
      }
    }
  })
})

describe('WORD_NAMES — 받침 있는 친구 이름의 조사(프로덕션 풀)', () => {
  it('서연·도윤은 언제나 이름+이+조사 형태로만 나온다', () => {
    // 주입 이름이 아니라 프로덕션 WORD_NAMES로 돈다 — 받침 있는 이름이 실제 카탈로그에
    // 들어왔으므로, 여기서 깨지면 아이가 받는 종이가 깨진 것이다.
    for (let seed = 1; seed <= 200; seed++) {
      for (const it of composeWordItems({ names: WORD_NAMES, rand: lcg(seed), seen: new Set() })) {
        expect(it.text, `seed ${seed}: ${it.text}`).not.toMatch(/서연(?!이(가|는|를|의))/)
        expect(it.text, `seed ${seed}: ${it.text}`).not.toMatch(/도윤(?!이(가|는|를|의))/)
      }
    }
  })

  it('받침 있는 친구가 실제로 등장한다 — 위 검사가 공허하지 않다는 증거', () => {
    const seen: string[] = []
    for (let seed = 1; seed <= 200; seed++) {
      for (const it of composeWordItems({ names: WORD_NAMES, rand: lcg(seed), seen: new Set() })) {
        if (it.text.includes('서연') || it.text.includes('도윤')) seen.push(it.text)
      }
    }
    expect(seen.length, '200시드에서 받침 있는 친구가 한 번도 안 나왔다').toBeGreaterThan(0)
  })
})

describe('묶어 세기 — 길이·시간 소재(스펙 §2-1)', () => {
  // 200시드를 돌며 새 문형이 실제로 나오는지(존재성)와, 나온 것이 규칙을 지키는지(전칭)를
  // 함께 본다. 존재성이 없으면 전칭 검사는 항진명제가 된다.
  function groupItems(): WordItem[] {
    const out: WordItem[] = []
    for (let seed = 1; seed <= 200; seed++) {
      const [g] = composeWordItems({ names: WORD_NAMES, rand: lcg(seed), seen: new Set() })
      out.push(g!)
    }
    return out
  }

  it('cm 문항의 답 칸 단위는 cm다 — GOODS의 개·장·자루가 새지 않는다', () => {
    const cmItems = groupItems().filter((it) => it.text.includes('cm'))
    expect(cmItems.length, '200시드에서 길이 문형이 한 번도 안 나왔다').toBeGreaterThan(0)
    for (const it of cmItems) {
      expect(it.unit, it.text).toBe('cm')
    }
  })

  it('분 문항의 답 칸 단위는 분이다', () => {
    const minItems = groupItems().filter((it) => /\d분씩/.test(it.text))
    expect(minItems.length, '200시드에서 시간 문형이 한 번도 안 나왔다').toBeGreaterThan(0)
    for (const it of minItems) {
      expect(it.unit, it.text).toBe('분')
    }
  })

  it('기존 사물 문항의 단위는 그대로 GOODS에서 온다', () => {
    const goodsUnits = new Set(['개', '자루', '장'])
    const others = groupItems().filter((it) => it.unit !== 'cm' && it.unit !== '분')
    expect(others.length).toBeGreaterThan(0)
    for (const it of others) {
      expect(goodsUnits.has(it.unit), `${it.unit}: ${it.text}`).toBe(true)
    }
  })

  it('expression과 answer는 새 문형에서도 일치한다', () => {
    for (const it of groupItems()) {
      const m = /^([2-9])×([2-9])$/.exec(it.expression)
      expect(m, it.expression).not.toBeNull()
      expect(Number(m![1]) * Number(m![2])).toBe(it.answer)
    }
  })
})

describe('몇 배 — 길이·시간 소재(스펙 §2-1)', () => {
  function timesItems(): WordItem[] {
    const out: WordItem[] = []
    for (let seed = 1; seed <= 200; seed++) {
      const [, t] = composeWordItems({ names: WORD_NAMES, rand: lcg(seed), seen: new Set() })
      out.push(t!)
    }
    return out
  }

  it('cm 문항의 계사는 예요다 — copula의 이에요가 새지 않는다', () => {
    const cmItems = timesItems().filter((it) => it.text.includes('cm'))
    expect(cmItems.length, '200시드에서 길이 몇 배 문형이 한 번도 안 나왔다').toBeGreaterThan(0)
    for (const it of cmItems) {
      expect(it.text, it.text).not.toMatch(/cm이에요/)
      expect(it.unit, it.text).toBe('cm')
    }
  })

  it('그림 문항의 단위는 분이다', () => {
    const drawItems = timesItems().filter((it) => it.text.includes('그림을'))
    expect(drawItems.length, '200시드에서 그림 문형이 한 번도 안 나왔다').toBeGreaterThan(0)
    for (const it of drawItems) {
      expect(it.unit, it.text).toBe('분')
    }
  })

  it('expression과 answer는 새 문형에서도 일치하고 배수는 2~5다', () => {
    for (const it of timesItems()) {
      const m = /^([2-9])×([2-5])$/.exec(it.expression)
      expect(m, it.expression).not.toBeNull()
      expect(Number(m![1]) * Number(m![2])).toBe(it.answer)
    }
  })
})
