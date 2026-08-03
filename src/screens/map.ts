import { getAllDays, getMeta } from '../data/db'
import { deriveFacts } from '../engine/facts'
import { factMapHtml } from './fact-map'
import { el, navigate, showError } from '../ui'

/** 지도만 보는 화면. 스프린트를 하지 않고도 진척을 확인할 수 있다. */
export async function renderMap(root: HTMLElement): Promise<void> {
  try {
    const meta = await getMeta()
    const days = await getAllDays()
    const facts = deriveFacts(days, meta.settings.fluentMs)

    root.replaceChildren(
      el(`
        <div>
          <h1>구구단 지도</h1>
          ${factMapHtml(facts)}
          <button class="step" id="back">← 홈</button>
        </div>
      `),
    )
    root.querySelector('#back')!.addEventListener('click', () => navigate('#/'))
  } catch (e) {
    showError(`지도를 열지 못했어요: ${(e as Error).message}`)
    root.replaceChildren(el(`<div><button class="step" id="back">← 홈</button></div>`))
    root.querySelector('#back')!.addEventListener('click', () => navigate('#/'))
  }
}
