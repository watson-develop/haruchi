import { isSolved, shuffle, SIZES, sizeKey, slide, type Board } from '../engine/slide'
import { el, hapticTap, navigate } from '../ui'

/**
 * 숫자 퍼즐(슬라이딩 퍼즐) — 조각을 밀어 1부터 차례로 맞춘다. 난이도는 판 크기
 * (engine/slide.ts SIZES). 판·섞기·완성 판정은 전부 엔진이 갖고, 여기는 그리기와 탭뿐이다.
 *
 * 아이 소속 화면. navigate()는 '← 미니게임'(#/games) 하나뿐이어야 한다(CLAUDE.md 불변식).
 *
 * 크기별 최고 기록과 마지막으로 고른 크기는 이 기기의 localStorage에만 산다(10초 딱!과 같은
 * 결정 — 동기화·백업 밖). 읽은 값은 모양을 검증하고, 저장 실패는 삼킨다. 풀던 판은 화면을
 * 떠나면 사라진다(사용자 결정).
 *
 * 조각 DOM은 숫자마다 하나씩 판이 끝날 때까지 살아 있고, 이동은 각 조각의 위치(transform)만
 * 바꾼다 — 그래서 CSS 전이가 미끄러지는 모습을 그린다.
 */
const BEST_KEY = 'haruchi.puzzle.best'
const SIZE_KEY = 'haruchi.puzzle.size'

type Best = { ms: number; moves: number }

const isCount = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0

function readBests(): Record<string, Best> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(BEST_KEY) ?? '{}')
    const out: Record<string, Best> = {}
    if (v && typeof v === 'object') {
      for (const s of SIZES) {
        const b = (v as Record<string, Partial<Best>>)[sizeKey(s)]
        if (b && isCount(b.ms) && isCount(b.moves)) out[sizeKey(s)] = { ms: b.ms, moves: b.moves }
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
  return best ? `최고 기록 ${formatTime(best.ms)} · ${best.moves}번` : '최고 기록이 아직 없어요'
}

export function renderPuzzle(root: HTMLElement): void {
  const bests = readBests()
  let sizeIndex = readSize()

  root.replaceChildren(
    el(`
      <div class="puzzle">
        <h1>숫자 퍼즐</h1>
        <div class="seed-segmented-control__root puzzle-sizes" role="radiogroup" aria-label="난이도"
             style="--segment-count: ${SIZES.length}">
          <div class="seed-segmented-control__indicator"></div>
          ${SIZES.map(
            (s, i) =>
              `<button class="seed-segmented-control__item" role="radio" data-size="${i}">${s.cols}×${s.rows}</button>`,
          ).join('')}
        </div>
        <div class="puzzle-stats">
          <span id="time">0:00</span>
          <span id="moves">0번</span>
        </div>
        <div class="puzzle-frame"><div class="puzzle-board" id="board"></div></div>
        <p class="puzzle-msg" id="msg" aria-live="polite"></p>
        <p class="puzzle-best" id="best"></p>
        <button class="step" id="reshuffle">다시 섞기</button>
        <button class="step" id="back">← 미니게임</button>
      </div>
    `),
  )
  const sizes = root.querySelector<HTMLElement>('.puzzle-sizes')!
  const boardEl = root.querySelector<HTMLElement>('#board')!
  const timeEl = root.querySelector<HTMLElement>('#time')!
  const movesEl = root.querySelector<HTMLElement>('#moves')!
  const msgEl = root.querySelector<HTMLElement>('#msg')!
  const bestEl = root.querySelector<HTMLElement>('#best')!

  let board: Board
  let tiles: HTMLButtonElement[] = [] // 숫자 n의 조각 = tiles[n]
  let moves = 0
  let startedAt: number | null = null // 첫 이동에서 시계가 선다
  let done = false

  const place = (): void => {
    board.cells.forEach((n, at) => {
      if (n === 0) return
      tiles[n].style.transform =
        `translate(${(at % board.cols) * 100}%, ${Math.floor(at / board.cols) * 100}%)`
    })
  }

  const newGame = (): void => {
    const { cols, rows } = SIZES[sizeIndex]
    board = shuffle(cols, rows, Math.random)
    moves = 0
    startedAt = null
    done = false
    boardEl.style.setProperty('--cols', String(cols))
    boardEl.style.setProperty('--rows', String(rows))
    boardEl.parentElement!.style.setProperty('--frame-ratio', String(cols / rows))
    boardEl.classList.remove('solved')
    // 크기가 바뀌면 이전 위치에서 미끄러져 오지 않게 전이 없이 제자리에 놓는다.
    boardEl.classList.add('instant')
    tiles = [document.createElement('button')] // [0]은 빈칸 자리라 쓰지 않는다
    for (let n = 1; n < cols * rows; n++) {
      const t = document.createElement('button')
      t.className = 'puzzle-tile'
      t.textContent = String(n)
      t.dataset.n = String(n)
      tiles.push(t)
    }
    boardEl.replaceChildren(...tiles.slice(1))
    place()
    void boardEl.offsetWidth
    boardEl.classList.remove('instant')
    timeEl.textContent = formatTime(0)
    movesEl.textContent = '0번'
    msgEl.textContent = ''
    bestEl.textContent = bestLine(bests[sizeKey(board)])
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
    boardEl.classList.add('solved')
    const key = sizeKey(board)
    const prev = bests[key]
    const fresh = !prev || ms < prev.ms
    if (fresh) {
      bests[key] = { ms: Math.round(ms), moves }
      save(BEST_KEY, JSON.stringify(bests))
      bestEl.textContent = bestLine(bests[key])
    }
    msgEl.textContent = `다 맞췄어요! 🎉 ${formatTime(ms)} · ${moves}번${fresh ? ' · 새 기록!' : ''}`
  }

  // 시계는 첫 이동부터. 화면을 떠나면 연결이 끊긴 것으로 멈춘다.
  const clock = setInterval(() => {
    if (!timeEl.isConnected) clearInterval(clock)
    else if (startedAt !== null && !done)
      timeEl.textContent = formatTime(performance.now() - startedAt)
  }, 250)

  // 손가락이 닿는 순간 민다(click은 떼는 순간이라 늦다). 키보드는 click(detail 0)으로 들어온다.
  const onTile = (e: Event): void => {
    if (done) return
    const t = (e.target as HTMLElement).closest<HTMLElement>('.puzzle-tile')
    if (!t) return
    const next = slide(board, board.cells.indexOf(Number(t.dataset.n)))
    if (!next) return
    hapticTap()
    board = next
    startedAt ??= performance.now()
    moves++
    movesEl.textContent = `${moves}번`
    place()
    if (isSolved(board)) finish()
  }
  boardEl.addEventListener('pointerdown', (e) => {
    if (e.button === 0) onTile(e)
  })
  boardEl.addEventListener('click', (e) => {
    if (e.detail === 0) onTile(e)
  })

  sizes.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-size]')
    if (!b) return
    sizeIndex = Number(b.dataset.size)
    save(SIZE_KEY, sizeKey(SIZES[sizeIndex]))
    newGame()
  })
  root.querySelector('#reshuffle')!.addEventListener('click', newGame)
  root.querySelector('#back')!.addEventListener('click', () => navigate('#/games'))

  newGame()
}
