import { makePattern, nextLevel, offsets, score, type Pattern } from '../engine/rhythm'
import { el, hapticTap, navigate, playBuk, replayPress, unlockAudio } from '../ui'

/**
 * 「리듬 따라 치기」 — 앱이 북소리로 들려준 리듬을 북(한국 전통 북) 버튼으로 똑같이 두드린다. 리듬 생성·판정·
 * 레벨 규칙은 전부 engine/rhythm.ts가 갖고, 여기는 재생·입력·그리기뿐이다.
 *
 * 아이 소속 화면. navigate()는 '← 미니게임'(#/games) 하나뿐이어야 한다(CLAUDE.md 불변식).
 *
 * 지금 레벨·최고 레벨은 이 기기의 localStorage에만 산다(10초 딱!과 같은 결정 — 동기화·백업
 * 밖). 읽은 값은 1 이상 정수만 통과시키고, 저장 실패는 삼킨다.
 *
 * 상태는 넷: idle(들어 보기 대기) → playing(들려주는 중) → input(따라 치는 중) → result.
 * 듣기는 ▶ 버튼, 치기는 북 — 둘을 나눠서(사용자 결정) 북은 언제 쳐도 소리가 나는
 * 장난감이고, 기록되는 것은 input 상태의 탭뿐이다(들려주는 중에는 북이 조용하다). 리듬은 소리와 빛을 함께 낸다 — 아이패드 소리가 꺼져 있어도 점이 켜지는 것을
 * 눈으로 따라갈 수 있다.
 */
const LEVEL_KEY = 'haruchi.rhythm.level'
const PEAK_KEY = 'haruchi.rhythm.peak'
/** 마지막 탭 뒤 이만큼 조용하면 다 친 것으로 본다. */
const IDLE_END_MS = 2000

function readLevel(key: string): number {
  try {
    const v = Number(localStorage.getItem(key))
    return Number.isInteger(v) && v >= 1 ? v : 1
  } catch {
    return 1
  }
}

function save(key: string, value: number): void {
  try {
    localStorage.setItem(key, String(value))
  } catch {
    // 저장 못 해도 이번 판은 계속된다.
  }
}

const VERDICT = { 3: '완벽해요!', 2: '잘했어요!', 1: '한 번 더 들어 볼까요?' } as const

export function renderRhythm(root: HTMLElement): void {
  let level = readLevel(LEVEL_KEY)
  let peak = Math.max(level, readLevel(PEAK_KEY))

  root.replaceChildren(
    el(`
      <div class="rhythm">
        <h1>리듬 따라 치기</h1>
        <p class="rhythm-level" id="level"></p>
        <div class="rhythm-line" id="line"></div>
        <p class="rhythm-msg" id="msg" aria-live="polite">들어 보고 똑같이 두드려요</p>
        <button class="seed-action-button seed-action-button--variant_brandSolid seed-action-button--size_large seed-action-button--size_large-layout_withText rhythm-play" id="play">▶ 들어 보기</button>
        <button class="buk" id="drum" aria-label="북">
          <span class="buk-body"></span>
          <span class="buk-head"><span class="buk-label" id="drum-label"></span></span>
        </button>
        <button class="step" id="reset">처음부터</button>
        <button class="step" id="back">← 미니게임</button>
      </div>
    `),
  )
  const levelEl = root.querySelector<HTMLElement>('#level')!
  const line = root.querySelector<HTMLElement>('#line')!
  const msg = root.querySelector<HTMLElement>('#msg')!
  const drum = root.querySelector<HTMLButtonElement>('#drum')!
  const label = root.querySelector<HTMLElement>('#drum-label')!
  const reset = root.querySelector<HTMLButtonElement>('#reset')!
  const playBtn = root.querySelector<HTMLButtonElement>('#play')!

  let state: 'idle' | 'playing' | 'input' | 'result' = 'idle'
  let pattern: Pattern = makePattern(level, Math.random)
  let taps: number[] = []
  let idleTimer = 0
  let playId = 0 // 다시 듣기가 이전 재생의 늦은 타이머를 무효로 만든다

  const showLevel = (): void => {
    levelEl.textContent = peak > level ? `레벨 ${level} · 최고 레벨 ${peak}` : `레벨 ${level}`
    // hidden 속성은 .step의 display: block에 진다 — 인라인 display로 숨긴다.
    reset.style.display = level === 1 ? 'none' : ''
  }

  /** 리듬 줄: 음마다 점 하나, 시간 비율대로 놓는다. */
  const drawLine = (): void => {
    const at = offsets(pattern)
    const total = at[at.length - 1]
    line.replaceChildren(
      ...at.map((t) => {
        const dot = document.createElement('span')
        dot.className = 'rhythm-dot'
        dot.style.left = `${(t / total) * 100}%`
        return dot
      }),
    )
  }

  const play = (): void => {
    unlockAudio()
    clearTimeout(idleTimer)
    const id = ++playId
    state = 'playing'
    playBtn.disabled = true
    playBtn.textContent = '♪ 듣는 중'
    label.textContent = ''
    msg.textContent = '잘 들어 보세요'
    drawLine()
    const at = offsets(pattern)
    const dots = [...line.querySelectorAll<HTMLElement>('.rhythm-dot')]
    // 소리는 오디오 시계로, 빛은 타이머로 — 같은 시각에 맞춰 둘 다 0.3초 뒤에 시작한다.
    const LEAD = 300
    at.forEach((t, i) => {
      playBuk((LEAD + t) / 1000)
      setTimeout(() => {
        if (!line.isConnected || id !== playId) return
        dots[i].classList.remove('lit')
        void dots[i].offsetWidth
        dots[i].classList.add('lit')
      }, LEAD + t)
    })
    setTimeout(
      () => {
        if (!line.isConnected || id !== playId) return
        state = 'input'
        taps = []
        dots.forEach((d) => d.classList.remove('lit'))
        playBtn.disabled = false
        playBtn.textContent = '▶ 다시 듣기'
        label.textContent = '두드려요!'
        msg.textContent = '북을 따라 쳐요!'
      },
      LEAD + at[at.length - 1] + 500,
    )
  }

  const finish = (): void => {
    clearTimeout(idleTimer)
    state = 'result'
    const { errors, stars } = score(pattern, taps)
    // 친 위치를 리듬 줄 위에 겹친다 — 정답 점보다 오른쪽이면 늦게, 왼쪽이면 빨리 친 것.
    const at = offsets(pattern)
    const total = at[at.length - 1]
    errors.forEach((err, i) => {
      if (err === null) return
      const mark = document.createElement('span')
      mark.className = 'rhythm-tap'
      mark.style.left = `${Math.min(105, Math.max(-5, ((at[i] + err) / total) * 100))}%`
      line.append(mark)
    })
    const up = nextLevel(level, stars)
    msg.textContent = `${VERDICT[stars]} ${'⭐'.repeat(stars)}${up > level ? ` 레벨 ${up}로!` : ''}`
    if (up > level) {
      level = up
      peak = Math.max(peak, level)
      save(LEVEL_KEY, level)
      save(PEAK_KEY, peak)
      showLevel()
    }
    pattern = makePattern(level, Math.random)
    label.textContent = ''
    playBtn.textContent = stars >= 2 ? '▶ 다음 리듬' : '▶ 새 리듬 듣기'
  }

  const press = (t: number): void => {
    if (state === 'playing') return
    replayPress(drum)
    hapticTap()
    playBuk()
    if (state === 'input') {
      taps.push(t)
      clearTimeout(idleTimer)
      if (taps.length >= pattern.intervals.length + 1) finish()
      else idleTimer = window.setTimeout(() => line.isConnected && finish(), IDLE_END_MS)
    }
  }

  // 손가락이 닿는 순간을 잰다(click은 떼는 순간이라 늦다). 키보드는 click(detail 0)으로.
  drum.addEventListener('pointerdown', (e) => {
    if (e.button === 0) press(e.timeStamp)
  })
  drum.addEventListener('click', (e) => {
    if (e.detail === 0) press(e.timeStamp)
  })
  playBtn.addEventListener('click', () => {
    if (state !== 'playing') play()
  })
  reset.addEventListener('click', () => {
    if (state === 'playing') return
    clearTimeout(idleTimer)
    level = 1
    save(LEVEL_KEY, level)
    pattern = makePattern(level, Math.random)
    state = 'idle'
    label.textContent = ''
    playBtn.textContent = '▶ 들어 보기'
    msg.textContent = '들어 보고 똑같이 두드려요'
    drawLine()
    showLevel()
  })
  root.querySelector('#back')!.addEventListener('click', () => navigate('#/games'))

  showLevel()
  drawLine()
}
