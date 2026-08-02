import type { FactState } from '../data/types'
import { factId } from '../engine/facts'

/**
 * 81칸 구구단 지도를 HTML 문자열로 만든다.
 *
 * **정복한 칸에만 답이 보인다.** 아직 못 외운 칸은 비어 있어, 벽에 붙여둬도 컨닝이 되지
 * 않고 목표가 "구구단 외우기"에서 "빈칸을 채워 나가기"로 바뀐다. 부수 효과로 3×5를
 * 정복하면 5×3도 같이 칠해져 대각선 대칭이 눈에 보인다.
 *
 * DOM을 건드리지 않고 문자열만 돌려준다 — Phase 3의 주간 리포트가 이 격자를 그대로
 * 인쇄물에 쓴다.
 */
export function factMapHtml(
  facts: Record<string, FactState>,
  newlyFluent: Set<string> = new Set(),
): string {
  const cells: string[] = ['<div class="head">×</div>']
  for (let b = 1; b <= 9; b++) cells.push(`<div class="head">${b}</div>`)

  for (let a = 1; a <= 9; a++) {
    cells.push(`<div class="head">${a}</div>`)
    for (let b = 1; b <= 9; b++) {
      const id = factId(a, b)
      const status = facts[id]?.status ?? 'new'
      if (newlyFluent.has(id)) {
        cells.push(`<div class="cell fresh">${a * b}</div>`)
      } else if (status === 'fluent') {
        cells.push(`<div class="cell fluent">${a * b}</div>`)
      } else if (status === 'learning') {
        cells.push(`<div class="cell learning"></div>`)
      } else {
        cells.push(`<div class="cell"></div>`)
      }
    }
  }

  const fluentCount = Object.values(facts).filter((f) => f.status === 'fluent').length

  return `
    <div class="factmap">${cells.join('')}</div>
    <div class="factmap-legend">
      <span><i style="background:var(--fg);border-color:var(--fg)"></i>정복</span>
      <span><i style="background:#fff;border:2px solid var(--fg)"></i>새로!</span>
      <span><i style="background:#e0e0e0;border-color:#c4c4c4"></i>연습 중</span>
      <span><i></i>아직</span>
    </div>
    <div class="factmap-score">${fluentCount} <em>/ 81 칸</em></div>`
}
