import { el, navigate } from '../ui'

/**
 * 미니게임 메뉴. 아이 홈의 「🎮 미니게임」 카드 하나가 여기로 온다 — 게임이 늘어도 홈 카드
 * 줄이 붐비지 않게(사용자 결정 2026-10-13).
 *
 * 아이 소속 화면. navigate()는 '← 홈'(#/)과 게임 둘(#/stop10·#/puzzle)뿐이어야 한다
 * (CLAUDE.md 불변식).
 */
export function renderGames(root: HTMLElement): void {
  root.replaceChildren(
    el(`
      <div>
        <h1>미니게임</h1>
        <button class="step" id="stop10">⏱️ 10초 딱!<small>숫자를 보면서 10초에 멈춰요</small></button>
        <button class="step" id="puzzle">🧩 숫자 퍼즐<small>조각을 밀어서 1부터 차례로 맞춰요</small></button>
        <button class="step" id="back">← 홈</button>
      </div>
    `),
  )
  root.querySelector('#stop10')!.addEventListener('click', () => navigate('#/stop10'))
  root.querySelector('#puzzle')!.addEventListener('click', () => navigate('#/puzzle'))
  root.querySelector('#back')!.addEventListener('click', () => navigate('#/'))
}
