import type { FactState } from '../data/types'
import { DAN_MAX, DAN_MIN, FACT_IDS, FACTOR_MAX, FACTOR_MIN, factId } from '../engine/facts'

/**
 * 칸 수는 풀 정의(engine/facts.ts)에서 유도한다 — 2단부터 9단 × ×1부터 ×9.
 *
 * **정복한 칸에만 답이 보인다.** 아직 못 외운 칸은 비어 있어, 벽에 붙여둬도 컨닝이 되지
 * 않고 목표가 "구구단 외우기"에서 "빈칸을 채워 나가기"로 바뀐다. 부수 효과로 3×5를
 * 정복하면 5×3도 같이 칠해져 대각선 대칭이 눈에 보인다.
 *
 * DOM을 건드리지 않고 문자열만 돌려준다 — 주간 리포트 화면이 이 격자를 재사용하고,
 * 인쇄물(추후)도 그대로 쓸 수 있다.
 */
export function factMapHtml(
  facts: Record<string, FactState>,
  newlyFluent: Set<string> = new Set(),
): string {
  // 열 수 = ×머리글 1칸 + 인자 칸(FACTOR_MIN..FACTOR_MAX). app.css의 .factmap은
  // grid-template-columns를 이 값으로 못 읽으므로(CSS가 TS 상수를 모른다) 아래
  // 인라인 --factmap-cols로 넘긴다 — 10을 CSS에 다시 박아두지 않기 위해서다.
  const cols = FACTOR_MAX - FACTOR_MIN + 2
  const cells: string[] = ['<div class="head">×</div>']
  for (let b = FACTOR_MIN; b <= FACTOR_MAX; b++) cells.push(`<div class="head">${b}</div>`)

  for (let a = DAN_MIN; a <= DAN_MAX; a++) {
    cells.push(`<div class="head">${a}</div>`)
    for (let b = FACTOR_MIN; b <= FACTOR_MAX; b++) {
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
    <div class="factmap" style="--factmap-cols:${cols}">${cells.join('')}</div>
    <div class="factmap-legend">
      <span><i style="background:var(--seed-color-bg-brand-solid);border-color:var(--seed-color-bg-brand-solid)"></i>정복</span>
      <span><i style="background:var(--seed-color-bg-layer-default);border:2px solid var(--seed-color-bg-brand-solid)"></i>새로!</span>
      <span><i style="background:var(--seed-color-bg-layer-fill);border-color:var(--seed-color-stroke-neutral-weak)"></i>연습 중</span>
      <span><i></i>아직</span>
    </div>
    <div class="factmap-score">${fluentCount} <em>/ ${FACT_IDS.length} 칸</em></div>`
}
