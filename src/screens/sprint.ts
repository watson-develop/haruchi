import { getAllDays, getDay, getMeta, putDay } from '../data/db'
import { dayKey } from '../engine/dates'
import { composeSprint, deriveFacts, requeueWrong } from '../engine/facts'
import { factMapHtml } from './fact-map'
import { el, navigate, showError } from '../ui'
import type { Day, FactState, SprintAttempt } from '../data/types'

/** 정답을 보여주는 시간. 즉시 넘기면 무엇이 맞았는지 볼 틈이 없다. */
const REVEAL_MS = 1500

/** 틀린 식을 몇 문제 뒤에 다시 넣는가. */
const REQUEUE_GAP = 4

function answerOf(id: string): number {
  const [a, b] = id.split('×').map(Number)
  return a! * b!
}

function progressHtml(total: number, done: number): string {
  return Array.from({ length: total }, (_, i) => `<i class="${i < done ? 'done' : ''}"></i>`).join(
    '',
  )
}

function mean(xs: number[]): number | null {
  if (xs.length === 0) return null
  return xs.reduce((s, x) => s + x, 0) / xs.length
}

/** 어제까지의 정답 반응시간 평균. 오늘과 비교해 "얼마나 빨라졌는지"를 보여준다. */
function previousMean(days: Day[], today: string): number | null {
  const before = days.filter((d) => d.date < today && d.sprint && d.sprint.length > 0)
  const last = before[before.length - 1]
  if (!last?.sprint) return null
  return mean(last.sprint.filter((a) => a.correct).map((a) => a.ms))
}

function backOnly(root: HTMLElement, message: string): void {
  root.replaceChildren(
    el(`<div><p class="date">${message}</p><button class="step" id="back">← 홈</button></div>`),
  )
  root.querySelector('#back')!.addEventListener('click', () => navigate('#/'))
}

export async function renderSprint(root: HTMLElement): Promise<void> {
  const today = dayKey(new Date())

  // 본문 전체를 하나의 try로 감싼다. getMeta/getAllDays가 밖에 있으면 IndexedDB 실패 시
  // 예외가 main.ts의 route()로 올라가고, 거기서는 showError만 부르므로 #app이 빈 채로
  // 남는다 — 북마크로 #/sprint에 바로 들어온 경우 갈 곳이 없어진다.
  try {
    const meta = await getMeta()
    const days = await getAllDays()
    const existing = await getDay(today)

    if (existing?.sprint && existing.sprint.length > 0) {
      const facts = deriveFacts(days, meta.settings.fluentMs)
      renderResult(root, facts, new Set(), existing.sprint, previousMean(days, today))
      return
    }

    const facts = deriveFacts(days, meta.settings.fluentMs)
    const queue = composeSprint({ facts, count: meta.settings.sprintCount, today })
    if (queue.length === 0) {
      backOnly(root, '오늘 낼 문제를 만들지 못했어요.')
      return
    }

    runSession(root, queue, facts, days, today, existing, meta.settings.fluentMs)
  } catch (e) {
    showError(`스프린트를 열지 못했어요: ${(e as Error).message}`)
    backOnly(root, '')
  }
}

function runSession(
  root: HTMLElement,
  initialQueue: string[],
  factsBefore: Record<string, FactState>,
  days: Day[],
  today: string,
  existing: Day | undefined,
  fluentMs: number,
): void {
  const total = initialQueue.length
  let queue = [...initialQueue]
  const attempts: SprintAttempt[] = []
  const requeued = new Set<string>()

  let current = ''
  let typed = ''
  let shownAt = 0
  let firstKeyAt = 0
  let locked = false

  root.replaceChildren(
    el(`
      <div>
        <div class="sprint-progress" id="bar"></div>
        <div class="sprint-q" id="q"></div>
        <div class="sprint-a" id="a"></div>
        <div class="keypad" id="pad">
          ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button data-key="${n}">${n}</button>`).join('')}
          <button data-key="back">←</button>
          <button data-key="0">0</button>
          <button data-key="ok">✓</button>
        </div>
      </div>
    `),
  )

  const bar = root.querySelector<HTMLDivElement>('#bar')!
  const qEl = root.querySelector<HTMLDivElement>('#q')!
  const aEl = root.querySelector<HTMLDivElement>('#a')!

  function paint(): void {
    bar.innerHTML = progressHtml(total, attempts.length)
    qEl.textContent = current.replace('×', ' × ')
    aEl.textContent = typed
    aEl.classList.remove('reveal')
  }

  function next(): void {
    const head = queue.shift()
    if (head === undefined) {
      void finish()
      return
    }
    current = head
    typed = ''
    // 반응시간은 문제가 보인 순간부터 첫 숫자 키까지다. 확인 버튼까지의 시간은
    // 손가락 속도라 노이즈이므로 제외한다.
    shownAt = performance.now()
    firstKeyAt = 0
    locked = false
    paint()
  }

  function submit(): void {
    if (typed === '' || locked) return
    locked = true
    const correct = Number(typed) === answerOf(current)
    const ms = Math.round((firstKeyAt || performance.now()) - shownAt)
    attempts.push({ fact: current, correct, ms })

    if (correct) {
      next()
      return
    }

    // 오답: 빨간 X 대신 정답을 보여주고, 같은 세션 뒤쪽에 다시 넣는다.
    // 즉시 재도전은 단기기억으로 맞히는 것이라 훈련이 되지 않는다.
    aEl.textContent = String(answerOf(current))
    aEl.classList.add('reveal')
    if (!requeued.has(current)) {
      requeued.add(current)
      queue = requeueWrong(queue, current, REQUEUE_GAP)
    }
    window.setTimeout(next, REVEAL_MS)
  }

  root.querySelector('#pad')!.addEventListener('click', (event) => {
    const key = (event.target as HTMLElement).dataset['key']
    if (key === undefined || locked) return
    if (key === 'ok') return submit()
    if (key === 'back') {
      typed = typed.slice(0, -1)
      paint()
      return
    }
    if (typed.length >= 2) return
    if (firstKeyAt === 0) firstKeyAt = performance.now()
    typed += key
    paint()
  })

  async function finish(): Promise<void> {
    // 세션 전체가 끝났을 때만 저장한다. 중간에 나가면 없던 일이 된다 —
    // 부분 세션은 반응시간 통계를 오염시킨다(전화 받다 8초 뒤에 누른 값이 섞인다).
    const day: Day = existing
      ? { ...existing, sprint: attempts }
      : { date: today, kind: 'normal', sheet: [], sprint: attempts }
    try {
      await putDay(day)
    } catch (e) {
      showError(`스프린트 결과를 저장하지 못했어요: ${(e as Error).message}`)
      backOnly(root, '')
      return
    }

    // days는 날짜 오름차순이어야 한다. today가 가장 늦은 날짜이므로 끝에 붙인다.
    const after = deriveFacts([...days.filter((d) => d.date !== today), day], fluentMs)
    const newly = new Set(
      Object.keys(after).filter(
        (id) => after[id]!.status === 'fluent' && factsBefore[id]?.status !== 'fluent',
      ),
    )
    renderResult(root, after, newly, attempts, previousMean(days, today))
  }

  next()
}

function renderResult(
  root: HTMLElement,
  facts: Record<string, FactState>,
  newly: Set<string>,
  attempts: SprintAttempt[],
  prevMean: number | null,
): void {
  const todayMean = mean(attempts.filter((a) => a.correct).map((a) => a.ms))
  let line = '오늘도 해냈어요!'
  if (todayMean !== null && prevMean !== null) {
    const delta = (prevMean - todayMean) / 1000
    line =
      delta >= 0.05
        ? `어제보다 ${delta.toFixed(1)}초 빨라졌어요 🚀`
        : `평균 ${(todayMean / 1000).toFixed(1)}초로 풀었어요`
  } else if (todayMean !== null) {
    line = `평균 ${(todayMean / 1000).toFixed(1)}초로 풀었어요`
  }

  root.replaceChildren(
    el(`
      <div>
        <div class="sprint-done">${line}</div>
        ${newly.size > 0 ? `<div class="sprint-done">새로 정복한 식 ${newly.size}개!</div>` : ''}
        ${factMapHtml(facts, newly)}
        <button class="step" id="back">← 홈</button>
      </div>
    `),
  )
  root.querySelector('#back')!.addEventListener('click', () => navigate('#/'))
}
