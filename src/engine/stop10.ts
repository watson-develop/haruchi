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

/** 랩 목록에 남기는 최근 기록 수(사용자 결정 2026-10-13). */
export const LAP_MAX = 10

/** 새 기록을 맨 앞에 넣고 LAP_MAX개만 남긴다. 최고 기록은 랩이 밀려나도 따로 산다. */
export function pushLap(laps: number[], cs: number): number[] {
  return [cs, ...laps].slice(0, LAP_MAX)
}

/** 10초 기준 부호 붙은 차이 — 「+0.03」은 늦게, 「−0.05」는 일찍 멈춘 것. */
export function formatSigned(cs: number): string {
  if (cs === TARGET_CS) return '±0.00'
  return `${cs > TARGET_CS ? '+' : '−'}${formatCs(diffCs(cs))}`
}
