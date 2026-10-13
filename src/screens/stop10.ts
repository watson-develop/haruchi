import { CAP_CS, diffCs, formatCs, isNewBest, TARGET_CS, toCs, verdict } from '../engine/stop10'
import { el, hapticTap, navigate } from '../ui'

/**
 * 「10초 딱!」 미니게임 — 숫자를 보면서 정확히 10.00초에 멈춘다.
 *
 * 아이 소속 화면. navigate()는 '← 홈'(#/) 하나뿐이어야 한다(CLAUDE.md 불변식).
 *
 * 최고 기록은 이 기기의 localStorage에만 산다(사용자 결정 2026-10-13) — 이 레포의 첫
 * localStorage 사용처다. Day 로그·backupPayload·동기화와 무관한 기기 로컬 놀이 기록이라
 * 기기를 바꾸면 사라져도 된다. 저장이 막힌 환경(사생활 보호 모드)에서도 게임은 돌아야
 * 하므로 읽기·쓰기를 전부 삼킨다.
 *
 * 판정은 화면이 마지막으로 그린 숫자가 아니라 pointerdown의 timeStamp 차이로 낸다 —
 * rAF는 프레임 단위로 뛰지만 손가락이 닿은 순간은 그보다 정밀하다.
 */
const BEST_KEY = 'haruchi.stop10.best'

function readBest(): number | null {
  try {
    const raw = localStorage.getItem(BEST_KEY)
    const v = Number(raw)
    return raw !== null && Number.isInteger(v) && v >= 0 ? v : null
  } catch {
    return null
  }
}

function writeBest(diff: number): void {
  try {
    localStorage.setItem(BEST_KEY, String(diff))
  } catch {
    // 저장 못 해도 이번 판의 결과는 이미 화면에 있다.
  }
}

function bestLine(best: number | null): string {
  return best === null ? '최고 기록이 아직 없어요' : `최고 기록 ${formatCs(best)}초 차이`
}

export function renderStop10(root: HTMLElement): void {
  let best = readBest()
  root.replaceChildren(
    el(`
      <div class="stop10">
        <h1>10초 딱!</h1>
        <p class="stop10-goal">${formatCs(TARGET_CS)}초에 멈춰 보세요</p>
        <div class="stop10-clock" id="clock">${formatCs(0)}</div>
        <p class="stop10-verdict" id="verdict" aria-live="polite"></p>
        <button class="stop10-btn" id="go">시작</button>
        <p class="stop10-best" id="best">${bestLine(best)}</p>
        <button class="step" id="back">← 홈</button>
      </div>
    `),
  )
  const clock = root.querySelector<HTMLElement>('#clock')!
  const verdictEl = root.querySelector<HTMLElement>('#verdict')!
  const go = root.querySelector<HTMLButtonElement>('#go')!
  const bestEl = root.querySelector<HTMLElement>('#best')!

  let startedAt: number | null = null

  const tick = (now: number): void => {
    // 화면을 떠나면 #app이 통째로 갈리므로 연결이 끊긴 것으로 루프를 끝낸다.
    if (startedAt === null || !clock.isConnected) return
    const cs = toCs(now - startedAt)
    clock.textContent = formatCs(cs)
    if (cs >= CAP_CS) stop(now)
    else requestAnimationFrame(tick)
  }

  const start = (t: number): void => {
    startedAt = t
    clock.classList.remove('hit')
    verdictEl.textContent = ''
    go.textContent = '멈춰!'
    requestAnimationFrame(tick)
  }

  const stop = (t: number): void => {
    const cs = toCs(t - startedAt!)
    startedAt = null
    const diff = diffCs(cs)
    clock.textContent = formatCs(cs)
    clock.classList.toggle('hit', diff <= 10)
    const fresh = isNewBest(diff, best)
    if (fresh) {
      best = diff
      writeBest(diff)
      bestEl.textContent = bestLine(best)
    }
    verdictEl.textContent = `${verdict(diff)} ${fresh ? '🎉 새 기록!' : `${formatCs(diff)}초 차이`}`
    go.textContent = '다시 하기'
  }

  const press = (t: number): void => {
    hapticTap()
    // 누를 때마다 눌림 애니메이션을 처음부터 다시 건다 — 클래스를 뗐다 붙이기만 하면
    // 브라우저가 같은 프레임으로 합쳐 버리므로 사이에 리플로(offsetWidth)를 끼운다.
    go.classList.remove('pressed')
    void go.offsetWidth
    go.classList.add('pressed')
    if (startedAt === null) start(t)
    else stop(t)
  }

  // 터치는 손가락이 닿는 순간(pointerdown)에 잰다 — click은 떼는 순간이라 늦다.
  go.addEventListener('pointerdown', (e) => {
    if (e.button === 0) press(e.timeStamp)
  })
  // 키보드(Enter·Space)는 pointerdown이 없어 click으로 들어온다. detail 0이 키보드다.
  go.addEventListener('click', (e) => {
    if (e.detail === 0) press(e.timeStamp)
  })
  root.querySelector('#back')!.addEventListener('click', () => navigate('#/'))
}
