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
