/**
 * 「10초 딱!」 미니게임의 판정. 단위는 센티초(1/100초) 정수다 — 화면이 보여 주는 자릿수와
 * 판정이 같은 값을 보게 해서, 「10.00」을 보여 놓고 「딱」이 아니라고 하는 어긋남을 막는다.
 * 스톱워치 관례대로 버림이다(9.999초는 9.99).
 */
export const TARGET_CS = 1000
/** 안 누르고 두고 가도 시계가 영원히 돌지 않게 여기서 멈춘다. */
export const CAP_CS = 2000

export function toCs(ms: number): number {
  return Math.min(CAP_CS, Math.max(0, Math.floor(ms / 10)))
}

export function formatCs(cs: number): string {
  return (cs / 100).toFixed(2)
}

export function diffCs(cs: number): number {
  return Math.abs(cs - TARGET_CS)
}

/** 칭찬만 한다 — 아이 화면은 부정 신호 금지(ux-principles). */
export function verdict(diff: number): string {
  if (diff === 0) return '딱 10초! 🎯'
  if (diff <= 10) return '거의 딱이에요!'
  if (diff <= 50) return '아주 가까워요!'
  return '한 번 더 해 볼까요?'
}

export function isNewBest(diff: number, best: number | null): boolean {
  return best === null || diff < best
}
