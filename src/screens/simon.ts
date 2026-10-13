import { check, extend, stepMs } from '../engine/simon'
import { el, hapticTap, navigate, playTone, unlockAudio } from '../ui'

/**
 * 「색 순서 기억」(사이먼) — 앱이 빛과 소리로 보여 준 색 순서를 그대로 누른다. 맞히면 순서가
 * 하나 길어지고, 틀리면 그 판이 끝난다. 순서·판정·속도는 engine/simon.ts가 갖는다.
 *
 * 아이 소속 화면. navigate()는 '← 미니게임'(#/games) 하나뿐이어야 한다(CLAUDE.md 불변식).
 *
 * 최고 단계는 이 기기의 localStorage에만 산다(다른 미니게임과 같은 결정 — 동기화·백업 밖).
 *
 * 상태는 넷: idle → showing(보여 주는 중) → input(따라 누르는 중) → over. 색 버튼은 언제
 * 눌러도 빛나고 소리가 난다(리듬의 북과 같은 결정) — 판정에 들어가는 것은 input의 탭뿐이다.
 */
const BEST_KEY = 'haruchi.simon.best'
const NAMES = ['빨강', '파랑', '초록', '노랑']

function readBest(): number {
  try {
    const v = Number(localStorage.getItem(BEST_KEY))
    return Number.isInteger(v) && v > 0 ? v : 0
  } catch {
    return 0
  }
}

function saveBest(v: number): void {
  try {
    localStorage.setItem(BEST_KEY, String(v))
  } catch {
    // 저장 못 해도 이번 판의 결과는 화면에 있다.
  }
}

export function renderSimon(root: HTMLElement): void {
  let best = readBest()

  root.replaceChildren(
    el(`
      <div class="simon">
        <h1>색 순서 기억</h1>
        <p class="rhythm-level" id="round">빛나는 순서를 기억해요</p>
        <div class="simon-pad" id="pad">
          ${NAMES.map((n, i) => `<button class="simon-btn" data-c="${i}" aria-label="${n}"></button>`).join('')}
        </div>
        <p class="rhythm-msg" id="msg" aria-live="polite"></p>
        <button class="seed-action-button seed-action-button--variant_brandSolid seed-action-button--size_large seed-action-button--size_large-layout_withText rhythm-play" id="start">▶ 시작</button>
        <p class="puzzle-best" id="best"></p>
        <button class="step" id="back">← 미니게임</button>
      </div>
    `),
  )
  const pad = root.querySelector<HTMLElement>('#pad')!
  const btns = [...pad.querySelectorAll<HTMLButtonElement>('.simon-btn')]
  const roundEl = root.querySelector<HTMLElement>('#round')!
  const msg = root.querySelector<HTMLElement>('#msg')!
  const start = root.querySelector<HTMLButtonElement>('#start')!
  const bestEl = root.querySelector<HTMLElement>('#best')!

  let state: 'idle' | 'showing' | 'input' | 'over' = 'idle'
  let seq: number[] = []
  let inputs: number[] = []
  let showId = 0 // 새 판이 이전 판의 늦은 타이머를 무효로 만든다

  const showBest = (): void => {
    bestEl.textContent = best > 0 ? `최고 기록 ${best}단계` : '최고 기록이 아직 없어요'
  }

  /** 버튼 하나를 ms 동안 켠다. 같은 버튼이 연달아 와도 다시 켜지게 리플로를 끼운다. */
  const light = (i: number, ms: number): void => {
    const b = btns[i]
    b.classList.remove('lit')
    void b.offsetWidth
    b.classList.add('lit')
    setTimeout(() => b.classList.remove('lit'), ms)
  }

  /** 순서를 처음부터 보여 준다. 끝나면 then(). 소리는 오디오 시계, 빛은 타이머로 같은 시각에. */
  const show = (then: () => void): void => {
    const id = ++showId
    const step = stepMs(seq.length)
    const on = Math.round(step * 0.6)
    const LEAD = 500
    seq.forEach((c, k) => {
      playTone(c, (LEAD + k * step) / 1000, on / 1000)
      setTimeout(
        () => {
          if (pad.isConnected && id === showId) light(c, on)
        },
        LEAD + k * step,
      )
    })
    setTimeout(
      () => {
        if (pad.isConnected && id === showId) then()
      },
      LEAD + seq.length * step,
    )
  }

  const nextRound = (): void => {
    seq = extend(seq, Math.random)
    inputs = []
    state = 'showing'
    roundEl.textContent = `${seq.length}단계`
    msg.textContent = '잘 보세요'
    show(() => {
      state = 'input'
      msg.textContent = '같은 순서로 눌러요!'
    })
  }

  const gameOver = (): void => {
    state = 'over'
    const reached = seq.length - 1
    const fresh = reached > best
    if (fresh) {
      best = reached
      saveBest(best)
      showBest()
    }
    msg.textContent =
      reached > 0
        ? `${reached}단계까지 기억했어요! 🎉${fresh ? ' 새 기록!' : ''}`
        : '한 번 더 해 볼까요?'
    // 정답 순서를 한 번 다시 보여 준다 — 어디서 헷갈렸는지 눈으로 확인하게.
    show(() => {
      start.disabled = false
      start.textContent = '▶ 다시 시작'
    })
  }

  const press = (c: number): void => {
    unlockAudio()
    hapticTap()
    playTone(c, 0, 0.25)
    light(c, 220)
    if (state !== 'input') return
    inputs.push(c)
    const r = check(seq, inputs)
    if (r === 'wrong') gameOver()
    else if (r === 'roundDone') {
      state = 'showing'
      msg.textContent = '맞았어요!'
      setTimeout(() => pad.isConnected && nextRound(), 600)
    }
  }

  // 손가락이 닿는 순간 반응한다(click은 떼는 순간이라 늦다). 키보드는 click(detail 0)으로.
  pad.addEventListener('pointerdown', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('.simon-btn')
    if (b && e.button === 0) press(Number(b.dataset.c))
  })
  pad.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('.simon-btn')
    if (b && e.detail === 0) press(Number(b.dataset.c))
  })
  start.addEventListener('click', () => {
    if (state === 'showing' || state === 'input') return
    unlockAudio()
    seq = []
    start.disabled = true
    start.textContent = '▶ 시작'
    nextRound()
  })
  root.querySelector('#back')!.addEventListener('click', () => navigate('#/games'))

  showBest()
}
