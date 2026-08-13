import { getAllDays, getMeta } from '../data/db'
import { deriveFacts, newlyFluentSince } from '../engine/facts'
import { dayKey } from '../engine/dates'
import { factMapHtml } from './fact-map'
import { el, navigate, showError } from '../ui'

/**
 * 지도만 보는 화면. 스프린트를 하지 않고도 진척을 확인할 수 있다.
 *
 * 여기의 navigate()는 '← 홈'(#/) 하나뿐이어야 한다 — 아이 소속 화면이므로 부모
 * 화면으로 가는 경로를 만들지 않는다(CLAUDE.md 불변식). 부모는 2026-08-05부터 이
 * 화면으로 들어오는 입구 자체가 없다(specs/2026-08-05-parent-map-entry-removal-design.md)
 * — 그렇다고 여기에 리포트 등 부모 화면으로 가는 링크를 더해 "접근을 되살리지"
 * 말 것. 부모는 리포트(report.ts) 안에서 같은 factMapHtml을 이미(그리고 더 나은
 * 형태로) 보고 있으므로 그쪽이 그 필요를 채운다.
 */
export async function renderMap(root: HTMLElement): Promise<void> {
  try {
    const meta = await getMeta()
    const days = await getAllDays()
    const facts = deriveFacts(days, meta.settings.fluentMs)
    const fresh = new Set(newlyFluentSince(days, meta.settings.fluentMs, dayKey(new Date())))

    root.replaceChildren(
      el(`
        <div>
          <h1>구구단 지도</h1>
          ${factMapHtml(facts, fresh, { invite: true })}
          <button class="step" id="back">← 홈</button>
        </div>
      `),
    )
    root.querySelector('#back')!.addEventListener('click', () => navigate('#/'))
  } catch (e) {
    showError('지도를 열지 못했어요.', e)
    root.replaceChildren(el(`<div><button class="step" id="back">← 홈</button></div>`))
    root.querySelector('#back')!.addEventListener('click', () => navigate('#/'))
  }
}
