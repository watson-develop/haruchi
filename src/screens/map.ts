import { getAllDays, getMeta } from '../data/db'
import { allFluent, deriveFacts, newlyFluentSince } from '../engine/facts'
import { dayKey } from '../engine/dates'
import { factMapHtml } from './fact-map'
import { el, hapticTap, lampSvg, navigate, showError, unlockAudio } from '../ui'

/**
 * 지도만 보는 화면. 스프린트를 하지 않고도 진척을 확인할 수 있다.
 *
 * 여기의 navigate()는 '← 홈'(#/)과 램프의 '#/genie'(둘 다 아이 소속) 뿐이어야
 * 한다 — 부모 화면으로 가는 경로를 만들지 않는다(CLAUDE.md 불변식). 부모는 2026-08-05부터 이
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

    // 전정복 보상 입구. 판정은 저장 없이 매번 파생 — 유창 기준이 바뀌어
    // 전정복이 깨지면 램프도 티저로 되돌아간다.
    // 미정복이면 실루엣 티저: 이스터에그 예고로 동기를 심는다. 탭하면 꿈틀하고
    // "아직은 비밀"만 말한다 — 정체(지니)는 전정복 전에 보여주지 않는다.
    const lampHtml = allFluent(facts)
      ? `<button class="genie-lamp-invite" id="genie">🪔 램프를 문질러 봐!</button>`
      : `<button class="genie-teaser" id="genie-teaser">
           ${lampSvg('genie-teaser-lamp')}
           <span class="genie-teaser-text">모두 정복하면 무슨 일이 생길까…?</span>
         </button>`

    root.replaceChildren(
      el(`
        <div>
          <h1>구구단 지도</h1>
          ${factMapHtml(facts, fresh, { window: 'today', invite: true })}
          ${lampHtml}
          <button class="step" id="back">← 홈</button>
        </div>
      `),
    )
    root.querySelector('#back')!.addEventListener('click', () => navigate('#/'))
    root.querySelector('#genie')?.addEventListener('click', () => {
      // 제스처 안에서 오디오를 깨워야 다음 화면의 효과음이 난다(iOS) — ui.ts 주석 참고.
      unlockAudio()
      navigate('#/genie')
    })

    const teaser = root.querySelector('#genie-teaser')
    teaser?.addEventListener('click', () => {
      hapticTap()
      // 애니메이션 재시작 트릭: 클래스를 뗐다 붙이는 사이에 리플로를 강제한다.
      teaser.classList.remove('poked')
      void (teaser as HTMLElement).offsetWidth
      teaser.classList.add('poked')
      teaser.querySelector('.genie-teaser-text')!.textContent =
        '아직은 비밀이야! 지도를 다 채우면 만날 수 있어'
    })
  } catch (e) {
    showError('지도를 열지 못했어요.', e)
    root.replaceChildren(el(`<div><button class="step" id="back">← 홈</button></div>`))
    root.querySelector('#back')!.addEventListener('click', () => navigate('#/'))
  }
}
