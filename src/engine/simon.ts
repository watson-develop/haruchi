/**
 * 「색 순서 기억」(사이먼)의 순서와 판정. 버튼은 0~3(빨강·파랑·초록·노랑) 넷으로 고정이다
 * (사용자 결정 2026-10-13). 순서는 판마다 하나씩 길어지고, 앞부분은 바뀌지 않는다 — 아이가
 * 외운 것 위에 하나만 더 얹는 것이 이 게임의 전부다.
 */
export const BUTTONS = 4

/** 순서 끝에 버튼 하나를 덧붙인다. */
export function extend(seq: number[], rand: () => number): number[] {
  return [...seq, Math.floor(rand() * BUTTONS)]
}

export type Check = 'continue' | 'roundDone' | 'wrong'

/** 지금까지 누른 것(inputs)이 순서의 앞부분과 맞는가. 다 맞게 누르면 roundDone. */
export function check(seq: number[], inputs: number[]): Check {
  for (let i = 0; i < inputs.length; i++) if (inputs[i] !== seq[i]) return 'wrong'
  return inputs.length >= seq.length ? 'roundDone' : 'continue'
}

/** 한 칸을 보여 주는 간격(ms). 길어질수록 조금씩 빨라지고 하한에서 멈춘다. */
export function stepMs(length: number): number {
  return Math.max(380, 700 - (length - 1) * 30)
}
