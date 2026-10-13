import { closeMiss, deal, flip, isDone, SIZES, type MemState } from '../engine/memory'
import { el, hapticTap, navigate } from '../ui'

/**
 * 「짝 맞추기」 — 뒤집힌 동물 카드에서 같은 그림 두 장을 찾는다. 뒤집기 규칙은 전부
 * engine/memory.ts가 갖고, 여기는 결과대로 카드의 앞·뒷면 클래스를 바꾸는 것뿐이다.
 *
 * 아이 소속 화면. navigate()는 '← 미니게임'(#/games) 하나뿐이어야 한다(CLAUDE.md 불변식).
 *
 * 크기별 최고 기록과 마지막 크기는 이 기기의 localStorage에만 산다(다른 미니게임과 같은
 * 결정 — 동기화·백업 밖). 읽은 값은 모양을 검증하고, 저장 실패는 삼킨다.
 */
const BEST_KEY = 'haruchi.memory.best'
const SIZE_KEY = 'haruchi.memory.size'
/** 안 맞은 두 장을 보여 주는 시간. 그 사이 다른 카드를 누르면 바로 덮인다(엔진 flip). */
const MISS_SHOW_MS = 800

type Best = { ms: number; flips: number }

const sizeKey = (s: { cols: number; rows: number }): string => String(s.cols * s.rows)
const isCount = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0

function readBests(): Record<string, Best> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(BEST_KEY) ?? '{}')
    const out: Record<string, Best> = {}
    if (v && typeof v === 'object') {
      for (const s of SIZES) {
        const b = (v as Record<string, Partial<Best>>)[sizeKey(s)]
        if (b && isCount(b.ms) && isCount(b.flips)) out[sizeKey(s)] = { ms: b.ms, flips: b.flips }
      }
    }
    return out
  } catch {
    return {}
  }
}

function readSize(): number {
  try {
    const i = SIZES.findIndex((s) => sizeKey(s) === localStorage.getItem(SIZE_KEY))
    return i < 0 ? 0 : i
  } catch {
    return 0
  }
}

function save(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // 저장 못 해도 이번 판은 화면에 그대로다.
  }
}

function formatTime(ms: number): string {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function bestLine(best: Best | undefined): string {
  return best ? `최고 기록 ${formatTime(best.ms)} · ${best.flips}번` : '최고 기록이 아직 없어요'
}

export function renderMemory(root: HTMLElement): void {
  const bests = readBests()
  let sizeIndex = readSize()

  root.replaceChildren(
    el(`
      <div class="memory">
        <h1>짝 맞추기</h1>
        <div class="seed-segmented-control__root puzzle-sizes" role="radiogroup" aria-label="카드 수"
             style="--segment-count: ${SIZES.length}">
          <div class="seed-segmented-control__indicator"></div>
          ${SIZES.map(
            (s, i) =>
              `<button class="seed-segmented-control__item" role="radio" data-size="${i}">${s.cols * s.rows}장</button>`,
          ).join('')}
        </div>
        <div class="puzzle-stats">
          <span id="time">0:00</span>
          <span id="flips">0번</span>
        </div>
        <div class="memory-board" id="board"></div>
        <p class="puzzle-msg" id="msg" aria-live="polite"></p>
        <p class="puzzle-best" id="best"></p>
        <button class="step" id="again">다시 하기</button>
        <button class="step" id="back">← 미니게임</button>
      </div>
    `),
  )
  const sizes = root.querySelector<HTMLElement>('.puzzle-sizes')!
  const boardEl = root.querySelector<HTMLElement>('#board')!
  const timeEl = root.querySelector<HTMLElement>('#time')!
  const flipsEl = root.querySelector<HTMLElement>('#flips')!
  const msgEl = root.querySelector<HTMLElement>('#msg')!
  const bestEl = root.querySelector<HTMLElement>('#best')!

  let state: MemState
  let cardEls: HTMLButtonElement[] = []
  let flips = 0
  let startedAt: number | null = null
  let done = false
  let missTimer = 0

  /** 엔진 상태를 카드 클래스로 옮긴다 — 앞면 = 짝 맞음 또는 미확정으로 열림. */
  const paint = (): void => {
    state.cards.forEach((c, i) => {
      cardEls[i].classList.toggle('open', c.matched || state.open.includes(i))
      cardEls[i].classList.toggle('matched', c.matched)
      cardEls[i].setAttribute(
        'aria-label',
        c.matched || state.open.includes(i) ? c.face : '덮인 카드',
      )
    })
  }

  const newGame = (): void => {
    clearTimeout(missTimer)
    const { cols, rows } = SIZES[sizeIndex]
    state = deal((cols * rows) / 2, Math.random)
    flips = 0
    startedAt = null
    done = false
    boardEl.style.setProperty('--cols', String(cols))
    boardEl.style.setProperty('--rows', String(rows))
    cardEls = state.cards.map((c, i) => {
      const b = document.createElement('button')
      b.className = 'memory-card'
      b.dataset.i = String(i)
      // 앞면 그림은 엔진의 ANIMALS 리터럴뿐이라 이스케이프가 필요 없다.
      b.innerHTML = `<span class="memory-inner"><span class="memory-back"></span><span class="memory-front">${c.face}</span></span>`
      return b
    })
    boardEl.replaceChildren(...cardEls)
    paint()
    timeEl.textContent = formatTime(0)
    flipsEl.textContent = '0번'
    msgEl.textContent = ''
    bestEl.textContent = bestLine(bests[sizeKey(SIZES[sizeIndex])])
    sizes.style.setProperty('--segment-index', String(sizeIndex))
    sizes.querySelectorAll<HTMLElement>('[data-size]').forEach((b) => {
      const on = Number(b.dataset.size) === sizeIndex
      b.toggleAttribute('data-checked', on)
      b.setAttribute('aria-checked', String(on))
    })
  }

  const finish = (): void => {
    done = true
    const ms = performance.now() - startedAt!
    timeEl.textContent = formatTime(ms)
    const key = sizeKey(SIZES[sizeIndex])
    const prev = bests[key]
    const fresh = !prev || ms < prev.ms
    if (fresh) {
      bests[key] = { ms: Math.round(ms), flips }
      save(BEST_KEY, JSON.stringify(bests))
      bestEl.textContent = bestLine(bests[key])
    }
    msgEl.textContent = `다 찾았어요! 🎉 ${formatTime(ms)} · ${flips}번${fresh ? ' · 새 기록!' : ''}`
  }

  const clock = setInterval(() => {
    if (!timeEl.isConnected) clearInterval(clock)
    else if (startedAt !== null && !done)
      timeEl.textContent = formatTime(performance.now() - startedAt)
  }, 250)

  const onCard = (e: Event): void => {
    if (done) return
    const card = (e.target as HTMLElement).closest<HTMLElement>('.memory-card')
    if (!card) return
    const { state: next, result } = flip(state, Number(card.dataset.i))
    if (result === 'ignored') return
    hapticTap()
    clearTimeout(missTimer)
    state = next
    startedAt ??= performance.now()
    flips++
    flipsEl.textContent = `${flips}번`
    paint()
    if (result === 'miss') {
      missTimer = window.setTimeout(() => {
        if (!boardEl.isConnected) return
        state = closeMiss(state)
        paint()
      }, MISS_SHOW_MS)
    } else if (result === 'match' && isDone(state)) {
      finish()
    }
  }
  // 손가락이 닿는 순간 뒤집는다(click은 떼는 순간이라 늦다). 키보드는 click(detail 0)으로.
  boardEl.addEventListener('pointerdown', (e) => {
    if (e.button === 0) onCard(e)
  })
  boardEl.addEventListener('click', (e) => {
    if (e.detail === 0) onCard(e)
  })

  sizes.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-size]')
    if (!b) return
    sizeIndex = Number(b.dataset.size)
    save(SIZE_KEY, sizeKey(SIZES[sizeIndex]))
    newGame()
  })
  root.querySelector('#again')!.addEventListener('click', newGame)
  root.querySelector('#back')!.addEventListener('click', () => navigate('#/games'))

  newGame()
}
