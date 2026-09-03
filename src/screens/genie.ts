import { getAllDays, getMeta } from '../data/db'
import { genieState, peakFluent } from '../engine/facts'
import { el, lampSvg, navigate, playPoof, playSparkle, showError } from '../ui'

/**
 * 구구단 전정복 보상 화면 — 램프에서 지니가 펑 하고 나온다.
 *
 * 아이 소속 화면. navigate()는 '← 지도'(#/map)와 가드의 '#/' 둘뿐이어야 한다 —
 * 부모 화면으로 가는 경로를 만들지 않는다(CLAUDE.md 불변식).
 *
 * 진입 가드: 렌더 때마다 genieState로 재판정한다(engine/facts.ts가 그 판정의 유일한
 * 주인 — 화면이 따로 판정하면 램프는 켜졌는데 여기가 닫히는 어긋남이 생긴다).
 * teaser면 닫히므로 URL 직접 진입(#/genie 즐겨찾기)도 막힌다.
 *
 * lit과 trophy는 같은 연출이고 **말풍선만 다르다**. 소원은 한 번짜리라, 이미 들어준
 * 뒤에 지니가 또 "소원을 말해봐"라고 하면 화면이 지키지 못할 약속을 하는 것이다
 * (ux-principles 원칙 3). 트로피에서도 지니가 나오는 덕에 아빠가 아이보다 먼저
 * 「소원 들어줬어요」를 눌러도 아이는 연출을 잃지 않는다.
 *
 * 연출은 전부 CSS(app.css의 genie-* keyframes)다. 등장(genie-rise, 1회)과
 * 둥실거림(genie-float, 무한)을 래퍼 두 겹으로 나눈 이유: 한 요소에 transform
 * 애니메이션 둘을 겹치면 나중 것이 앞 것을 통째로 덮는다.
 */
export async function renderGenie(root: HTMLElement): Promise<void> {
  try {
    const meta = await getMeta()
    const days = await getAllDays()
    const state = genieState(peakFluent(days, meta.settings.fluentMs), meta.settings.wishGrantedAt)
    if (state === 'teaser') {
      navigate('#/')
      return
    }
    const bubble =
      state === 'trophy'
        ? '소원을 들어줬지!<br /><strong>고마워, 또 놀러 와</strong>'
        : '구구단을 모두 정복했구나!<br /><strong>원하는 소원을 말해봐!</strong>'

    root.replaceChildren(
      el(`
        <div class="genie-scene">
          <span class="genie-star"></span><span class="genie-star"></span>
          <span class="genie-star"></span><span class="genie-star"></span>
          <span class="genie-star"></span><span class="genie-star"></span>
          <div class="genie-flash"></div>
          <div class="genie-stage">
            <div class="genie-bubble">${bubble}</div>
            <div class="genie-rise">
              <div class="genie-float">
                <svg class="genie-svg" viewBox="0 0 200 240" role="img" aria-label="웃고 있는 지니">
                  <path d="M100 235 C 60 225, 60 190, 95 185 C 120 181, 128 160, 112 150"
                        fill="none" stroke="#5bd0c8" stroke-width="14" stroke-linecap="round" />
                  <path d="M65 150 C 65 110, 135 110, 135 150 C 135 172, 65 172, 65 150 Z" fill="#5bd0c8" />
                  <circle cx="62" cy="140" r="10" fill="#5bd0c8" />
                  <circle cx="138" cy="140" r="10" fill="#5bd0c8" />
                  <circle cx="100" cy="75" r="42" fill="#6ee0d8" />
                  <path d="M100 33 C 96 18, 112 12, 118 22"
                        fill="none" stroke="#2b6f8f" stroke-width="10" stroke-linecap="round" />
                  <circle cx="58" cy="88" r="6" fill="#f4b942" />
                  <circle cx="142" cy="88" r="6" fill="#f4b942" />
                  <path d="M80 72 q 8 -10 16 0" fill="none" stroke="#1c3a4a" stroke-width="4" stroke-linecap="round" />
                  <path d="M104 72 q 8 -10 16 0" fill="none" stroke="#1c3a4a" stroke-width="4" stroke-linecap="round" />
                  <path d="M86 92 q 14 14 28 0" fill="none" stroke="#1c3a4a" stroke-width="4" stroke-linecap="round" />
                  <circle cx="70" cy="90" r="5" fill="#ff9e9e" opacity="0.7" />
                  <circle cx="130" cy="90" r="5" fill="#ff9e9e" opacity="0.7" />
                </svg>
              </div>
            </div>
            <div class="genie-smoke">
              <span class="genie-puff"></span><span class="genie-puff"></span><span class="genie-puff"></span>
            </div>
            ${lampSvg('genie-lamp')}
          </div>
          <button class="step genie-back" id="back">← 돌아가기</button>
        </div>
      `),
    )
    root.querySelector('#back')!.addEventListener('click', () => navigate('#/map'))

    // 효과음 — CSS 타이밍(연기 1.0s·등장 1.2s)에 맞춘다. 오디오가 잠겨 있으면
    // (URL 직접 진입 등 제스처 없음) 재생 함수가 스스로 무음 처리한다.
    // 타이머 안에서 해시를 재확인한다 — 1초 안에 화면을 떠났으면 다른 화면
    // 위에서 펑 소리가 나면 안 된다.
    setTimeout(() => {
      if (location.hash.startsWith('#/genie')) playPoof()
    }, 1000)
    setTimeout(() => {
      if (location.hash.startsWith('#/genie')) playSparkle()
    }, 1300)
  } catch (e) {
    showError('지니를 부르지 못했어요.', e)
    root.replaceChildren(el(`<div><button class="step" id="back">← 홈</button></div>`))
    root.querySelector('#back')!.addEventListener('click', () => navigate('#/'))
  }
}
