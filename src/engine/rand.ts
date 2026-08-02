/**
 * min..max(양끝 포함)의 정수 하나. rand는 [0,1)을 전제하지만 그것에 기대지 않는다.
 *
 * 이 함수는 vertical.ts와 inverse.ts에 바이트 단위로 같은 사본이 둘 있던 것을 하나로
 * 합친 것이다. 사본이 둘이면 경계 처리가 한쪽에서만 고쳐진다.
 *
 * 클램프가 필요한 이유: rand()가 정확히 1을 내면 min + (max - min + 1) = max + 1이
 * 나온다. Math.random()으로는 닿지 않지만, 테스트가 주입하는 시드 고정 PRNG는
 * 닿는다 — 예컨대 LCG의 `seed / 0x7fffffff`는 seed가 최댓값일 때 정확히 1이다.
 * 실제로 rand: () => 1을 주면 generateVertical('add2-nocarry')가 100 + 100을,
 * generateInverse가 선언한 대역 밖의 값을 만들어 냈다. 세로셈은 두 자리여야 하고
 * □ 채우기는 고정된 난이도 대역 안에 있어야 하므로, 여기서 상한을 막는다.
 */
export function randInt(min: number, max: number, rand: () => number): number {
  return Math.min(max, min + Math.floor(rand() * (max - min + 1)))
}
