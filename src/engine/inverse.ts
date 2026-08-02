import type { InverseItem, InverseTemplate } from '../data/types'

export const INVERSE_TEMPLATES: InverseTemplate[] = ['a+?=c', '?+b=c', 'a-?=c', '?-b=c']

function randInt(min: number, max: number, rand: () => number): number {
  return min + Math.floor(rand() * (max - min + 1))
}

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

/** 첫 문항에만 붙이는 문장 힌트. 매번 주면 힌트를 읽고 푸는 습관이 생긴다. */
export function inverseHint(item: Omit<InverseItem, 'id'>): string {
  switch (item.template) {
    case 'a+?=c':
      return `${item.a}에 얼마를 더하면 ${item.c}가 될까요?`
    case '?+b=c':
      return `얼마에 ${item.b}을 더하면 ${item.c}가 될까요?`
    case 'a-?=c':
      return `${item.a}에서 얼마를 빼면 ${item.c}가 될까요?`
    case '?-b=c':
      return `얼마에서 ${item.b}을 빼면 ${item.c}가 될까요?`
  }
}
