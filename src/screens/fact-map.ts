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
 *
 * **`newlyFluent`에 기본값을 주지 않는다.** 기본값이 있던 동안 map.ts가 이 인자를
 * 넘기지 않아, 「새로!」 칸이 나올 경로가 없는데 범례는 계속 그 상태를 광고했다
 * (2026-08-13에 발견·수정). 화면 테스트가 없는 레포라 이 결함군의 방어선은 타입뿐이다
 * — 필수 인자로 두면 같은 실수가 컴파일 에러가 된다.
 *
 * **`opts.window`도 같은 이유로 필수다.** 「새로!」의 시간 창은 화면마다 다르고
 * (지도·스프린트 = 오늘, 주간 리포트 = 최근 7일), 범례가 그 기간을 밝히지 않으면
 * 같은 칸이 두 화면에서 다르게 보이는 이유를 알 길이 없다 — 실사용에서 실제로
 * 나온 질문이다(2026-08-13). 호출부는 **창의 의미만** 선언하고 문구는 이 파일이
 * 소유한다. 문구를 호출부가 넘기게 하면 같은 말이 세 곳으로 흩어진다.
 */
export function factMapHtml(
  facts: Record<string, FactState>,
  newlyFluent: Set<string>,
  opts: { window: 'today' | 'week'; invite?: boolean },
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
  // 초대 문구는 아이의 목소리다(반말·격려체) — 기본은 꺼짐이고, 아이 소속 화면(map·sprint)의
  // 호출부에서만 켠다. 이 함수는 부모의 주간 리포트(report.ts)에서도 호출되는데, 거기서
  // 켜지면 담백·판단 없이를 요구하는 부모 어투(brand.md §5)에 아이 말투가 섞인다.
  const invite =
    opts.invite && fluentCount === 0 ? '<div class="factmap-invite">첫 칸을 채워 볼까?</div>' : ''

  // 범례가 자기 창을 밝힌다 — 이 문구의 유일한 주인이 여기다.
  const freshLabel = opts.window === 'today' ? '오늘 새로!' : '이번 주 새로!'

  return `
    <div class="factmap" style="--factmap-cols:${cols}">${cells.join('')}</div>
    <div class="factmap-legend">
      <span><i style="background:var(--seed-color-bg-brand-solid);border-color:var(--seed-color-bg-brand-solid)"></i>정복</span>
      <span><i style="background:var(--seed-color-bg-layer-default);border:2px solid var(--seed-color-bg-brand-solid)"></i>${freshLabel}</span>
      <span><i style="background:var(--seed-color-bg-brand-weak);border-color:var(--seed-color-stroke-brand-weak)"></i>연습 중</span>
      <span><i></i>아직</span>
    </div>
    ${invite}
    <div class="factmap-score">${fluentCount} <em>/ ${FACT_IDS.length} 칸</em></div>`
}
