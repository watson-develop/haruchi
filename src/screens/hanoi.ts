import { isDone, minMoves, move, SIZES, start, stars, type Pegs } from '../engine/hanoi'
import { el, hapticTap, navigate } from '../ui'

/**
 * 「하노이 탑」 — 왼쪽 기둥의 원판을 오른쪽 기둥으로 모두 옮긴다. 규칙은 전부
 * engine/hanoi.ts가 갖고, 여기는 기둥 탭 두 번(들기 → 놓기)과 그리기뿐이다.
 *
 * 아이 소속 화면. navigate()는 '← 미니게임'(#/games) 하나뿐이어야 한다(CLAUDE.md 불변식).
 *
 * 끌기 대신 탭 두 번인 이유: 초2 손가락에 정확하고, 기둥 칸 전체가 터치 영역이 된다.
 * 놓을 수 없는 자리를 고르면 원판이 살짝 흔들리고 들린 채로 남는다 — 빨강·에러 문구 없이
 * (아이 화면은 부정 신호 금지, ux-principles).
 *
 * 크기별 최고 기록과 마지막 크기는 이 기기의 localStorage에만 산다(다른 미니게임과 같은 결정).
 */
const BEST_KEY = 'haruchi.hanoi.best'
const SIZE_KEY = 'haruchi.hanoi.size'

type Best = { moves: number; ms: number }

const isCount = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0

function readBests(): Record<string, Best> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(BEST_KEY) ?? '{}')
    const out: Record<string, Best> = {}
    if (v && typeof v === 'object') {
      for (const n of SIZES) {
        const b = (v as Record<string, Partial<Best>>)[n]
        if (b && isCount(b.moves) && isCount(b.ms)) out[n] = { moves: b.moves, ms: b.ms }
      }
    }
    return out
  } catch {
    return {}
  }
}

function readSize(): number {
  try {
    const i = SIZES.findIndex((n) => String(n) === localStorage.getItem(SIZE_KEY))
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
  return best ? `최고 기록 ${best.moves}번 · ${formatTime(best.ms)}` : '최고 기록이 아직 없어요'
}

export function renderHanoi(root: HTMLElement): void {
  const bests = readBests()
  let sizeIndex = readSize()

  root.replaceChildren(
    el(`
      <div class="hanoi">
        <h1>하노이 탑</h1>
        <div class="seed-segmented-control__root puzzle-sizes" role="radiogroup" aria-label="원판 수"
             style="--segment-count: ${SIZES.length}">
          <div class="seed-segmented-control__indicator"></div>
          ${SIZES.map(
            (n, i) =>
              `<button class="seed-segmented-control__item" role="radio" data-size="${i}">${n}개</button>`,
          ).join('')}
        </div>
        <div class="puzzle-stats">
          <span id="moves">0번</span>
          <span id="time">0:00</span>
        </div>
        <div class="hanoi-board" id="board">
          ${[0, 1, 2].map((i) => `<button class="hanoi-peg" data-peg="${i}" aria-label="${['왼쪽', '가운데', '오른쪽'][i]} 기둥"></button>`).join('')}
        </div>
        <p class="puzzle-msg" id="msg" aria-live="polite"></p>
        <p class="puzzle-best" id="best"></p>
        <button class="step" id="again">다시 하기</button>
        <button class="step" id="back">← 미니게임</button>
      </div>
    `),
  )
  const sizes = root.querySelector<HTMLElement>('.puzzle-sizes')!
  const boardEl = root.querySelector<HTMLElement>('#board')!
  const pegEls = [...boardEl.querySelectorAll<HTMLButtonElement>('.hanoi-peg')]
  const movesEl = root.querySelector<HTMLElement>('#moves')!
  const timeEl = root.querySelector<HTMLElement>('#time')!
  const msgEl = root.querySelector<HTMLElement>('#msg')!
  const bestEl = root.querySelector<HTMLElement>('#best')!

  let n: number
  let pegs: Pegs
  let lifted: number | null = null // 원판을 든 기둥
  let moves = 0
  let startedAt: number | null = null
  let done = false

  /** 기둥마다 원판을 다시 그린다. 원판 폭은 크기 비율, 색은 크기마다 고정(--d). */
  const paint = (): void => {
    pegs.forEach((peg, i) => {
      pegEls[i].replaceChildren(
        ...peg.map((d, k) => {
          const disk = document.createElement('span')
          disk.className = 'hanoi-disk'
          disk.dataset.d = String(d)
          disk.style.setProperty('--size', String(d / n))
          if (lifted === i && k === peg.length - 1) disk.classList.add('lifted')
          return disk
        }),
      )
    })
  }

  const newGame = (): void => {
    n = SIZES[sizeIndex]
    pegs = start(n)
    lifted = null
    moves = 0
    startedAt = null
    done = false
    boardEl.style.setProperty('--n', String(n))
    paint()
    movesEl.textContent = `0번 / 최소 ${minMoves(n)}번`
    timeEl.textContent = formatTime(0)
    msgEl.textContent = '기둥을 눌러 원판을 들어요'
    bestEl.textContent = bestLine(bests[n])
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
    const prev = bests[n]
    const fresh = !prev || moves < prev.moves || (moves === prev.moves && ms < prev.ms)
    if (fresh) {
      bests[n] = { moves, ms: Math.round(ms) }
      save(BEST_KEY, JSON.stringify(bests))
      bestEl.textContent = bestLine(bests[n])
    }
    msgEl.textContent = `다 옮겼어요! 🎉 ${moves}번 ${'⭐'.repeat(stars(n, moves))}${fresh ? ' 새 기록!' : ''}`
  }

  const clock = setInterval(() => {
    if (!timeEl.isConnected) clearInterval(clock)
    else if (startedAt !== null && !done)
      timeEl.textContent = formatTime(performance.now() - startedAt)
  }, 250)

  const onPeg = (i: number): void => {
    if (done) return
    hapticTap()
    if (lifted === null) {
      if (pegs[i].length === 0) return
      lifted = i
      msgEl.textContent = '놓을 기둥을 눌러요'
    } else if (lifted === i) {
      lifted = null // 같은 기둥 = 내려놓기
      msgEl.textContent = '기둥을 눌러 원판을 들어요'
    } else {
      const next = move(pegs, lifted, i)
      if (!next) {
        msgEl.textContent = '작은 원판 위에는 못 올려요'
        const disk = pegEls[lifted].lastElementChild as HTMLElement
        disk.classList.remove('nope')
        void disk.offsetWidth
        disk.classList.add('nope')
        return
      }
      pegs = next
      lifted = null
      startedAt ??= performance.now()
      moves++
      movesEl.textContent = `${moves}번 / 최소 ${minMoves(n)}번`
      msgEl.textContent = ''
    }
    paint()
    if (isDone(pegs)) finish()
  }

  // 손가락이 닿는 순간 반응한다(click은 떼는 순간이라 늦다). 키보드는 click(detail 0)으로.
  boardEl.addEventListener('pointerdown', (e) => {
    const peg = (e.target as HTMLElement).closest<HTMLElement>('.hanoi-peg')
    if (peg && e.button === 0) onPeg(Number(peg.dataset.peg))
  })
  boardEl.addEventListener('click', (e) => {
    const peg = (e.target as HTMLElement).closest<HTMLElement>('.hanoi-peg')
    if (peg && e.detail === 0) onPeg(Number(peg.dataset.peg))
  })

  sizes.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-size]')
    if (!b) return
    sizeIndex = Number(b.dataset.size)
    save(SIZE_KEY, String(SIZES[sizeIndex]))
    newGame()
  })
  root.querySelector('#again')!.addEventListener('click', newGame)
  root.querySelector('#back')!.addEventListener('click', () => navigate('#/games'))

  newGame()
}
