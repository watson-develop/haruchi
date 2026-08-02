import type { InverseItem, InverseTemplate } from '../data/types'
import { randInt } from './rand'

export const INVERSE_TEMPLATES: InverseTemplate[] = ['a+?=c', '?+b=c', 'a-?=c', '?-b=c']

/**
 * □ 채우기 문항을 만든다. 모든 값은 2학년 범위(1000 미만)이고 답은 자연수다.
 * 세로 형식이 아니라 가로식으로 출제한다 — 세로는 자릿수별 역추론이라 2학년에게 과하다.
 */
export function generateInverse(
  template: InverseTemplate,
  rand: () => number = Math.random
): Omit<InverseItem, 'id'> {
  switch (template) {
    case 'a+?=c': {
      const a = randInt(10, 80, rand)
      const answer = randInt(5, 99 - a, rand)
      return { kind: 'inverse', tag: 'inverse-add', template, a, c: a + answer, answer }
    }
    case '?+b=c': {
      const b = randInt(10, 80, rand)
      const answer = randInt(5, 99 - b, rand)
      return { kind: 'inverse', tag: 'inverse-add', template, b, c: answer + b, answer }
    }
    case 'a-?=c': {
      const a = randInt(25, 99, rand)
      const answer = randInt(5, a - 10, rand)
      return { kind: 'inverse', tag: 'inverse-sub', template, a, c: a - answer, answer }
    }
    case '?-b=c': {
      const b = randInt(5, 40, rand)
      const c = randInt(10, 59, rand)
      return { kind: 'inverse', tag: 'inverse-sub', template, b, c, answer: b + c }
    }
  }
}

/**
 * 한자어 수 읽기에서 끝자리에 받침이 있는지.
 *
 * 조사는 앞말의 소리로 결정되므로 숫자 그 자체가 아니라 "읽는 소리"의 끝소리를 본다.
 * 십의 자리 위는 소리에 영향을 주지 않는다 — 65는 "육십오", 86은 "팔십육"이라
 * 언제나 끝자리 한 글자가 결정한다.
 *
 *   0 영(ㅇ) 1 일(ㄹ) 2 이(-) 3 삼(ㅁ) 4 사(-)
 *   5 오(-)  6 육(ㄱ) 7 칠(ㄹ) 8 팔(ㄹ) 9 구(-)
 */
const SINO_FINAL_CONSONANT = [true, true, false, true, false, false, true, true, true, false]

export function hasFinalConsonant(n: number): boolean {
  return SINO_FINAL_CONSONANT[Math.abs(n) % 10]!
}

/** 수 뒤에 붙는 주격 조사. 86 → '이', 45 → '가'. */
export function subjectParticle(n: number): '이' | '가' {
  return hasFinalConsonant(n) ? '이' : '가'
}

/** 수 뒤에 붙는 목적격 조사. 65 → '를', 33 → '을'. */
export function objectParticle(n: number): '을' | '를' {
  return hasFinalConsonant(n) ? '을' : '를'
}

/**
 * 첫 문항에만 붙이는 문장 힌트. 매번 주면 힌트를 읽고 푸는 습관이 생긴다.
 *
 * 조사는 반드시 위 헬퍼로 고른다. 종이에 찍혀 아이가 매일 소리 내어 읽는 문장이고,
 * 같은 시기에 국어 시간에 조사를 배운다 — '86가', '17가'가 나가면 안 된다.
 */
export function inverseHint(item: Omit<InverseItem, 'id'>): string {
  const c = `${item.c}${subjectParticle(item.c)}`
  switch (item.template) {
    case 'a+?=c':
      return `${item.a}에 얼마를 더하면 ${c} 될까요?`
    case '?+b=c':
      return `얼마에 ${item.b}${objectParticle(item.b!)} 더하면 ${c} 될까요?`
    case 'a-?=c':
      return `${item.a}에서 얼마를 빼면 ${c} 될까요?`
    case '?-b=c':
      return `얼마에서 ${item.b}${objectParticle(item.b!)} 빼면 ${c} 될까요?`
  }
}
