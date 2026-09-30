import { getAllDays, getDeviceState, putDay } from '../data/db'
import type { Day, WordAttempt } from '../data/types'
import { dayKey } from '../engine/dates'
import {
  STORY_GROUPS,
  WORD_GROUP_LABELS,
  WORD_PER_DAY,
  groupOf,
  isCorrect,
  makeProblem,
  pickWordTypes,
  reviewPosition,
  stage,
  type WordGroup,
} from '../engine/word'
import { clearError, el, escapeHtml, navigate, showError } from '../ui'

/**
 * 문장제(아이 소속, specs/2026-09-30-word-problems-design.md §4). navigate 목적지는 '#/'뿐이다.
 *
 * 한 문항을 한 sid로 여러 번 저장한다 — 보여 준 순간, 첫 답, 되짚기 단계마다. 다시 열면 끝나지
 * 않은 문항을 안 한 단계부터 이어 한다(닫아서 피할 수 없고 벌점도 없다). 병합이 더 진행된 벌을
 * 남긴다(merge.ts mergeWord).
 */

/** 저장에 실패한 마지막 스냅샷. sprint.ts의 pending과 같은 이유로 모듈 수준 — 화면을 떠나도 산다. */
let pending: { date: string; att: WordAttempt } | null = null

const ERR = '문장제 기록을 저장하지 못했어요. 다시 들어오면 한 번 더 저장해요.'

async function save(date: string, att: WordAttempt): Promise<void> {
  try {
    // sprint 묶음 선언(스펙 §6). sprint 필드는 싣지 않는다 — putDay가 저장본의 것을 그대로 둔다.
    await putDay({ date, kind: 'normal', sheet: [], word: [att] }, ['sprint'])
    if (pending?.att.sid === att.sid) pending = null
  } catch (e) {
    pending = { date, att }
    showError(ERR, e)
  }
}

export async function renderWord(root: HTMLElement): Promise<void> {
  // 기록의 날짜는 화면이 그려질 때 한 번 정한다(스펙 §4) — 자정을 넘겨도 한 번의 풀이가 두 날로 쪼개지지 않는다.
  const today = dayKey(new Date())
  try {
    if (pending !== null) {
      const p = pending
      await save(p.date, p.att)
    }
    const days = await getAllDays()
    const day = days.find((d) => d.date === today)
    if (!day?.sprint || day.sprint.length === 0) {
      navigate('#/')
      return
    }
    const attempts = [...(day.word ?? [])]
    if (pending !== null && pending.date === today) {
      const p = pending.att
      const i = attempts.findIndex((a) => a.sid === p.sid)
      if (i >= 0) attempts[i] = p
      else attempts.push(p)
    }
    const deviceId = (await getDeviceState()).deviceId
    session(root, today, days, attempts, deviceId)
  } catch (e) {
    showError('문장제를 열지 못했어요.', e)
    root.replaceChildren(el(`<div><button class="step" id="back">← 홈</button></div>`))
    root.querySelector('#back')!.addEventListener('click', () => navigate('#/'))
  }
}

function session(
  root: HTMLElement,
  today: string,
  days: Day[],
  attempts: WordAttempt[],
  deviceId: string,
): void {
  const alive = (): boolean => location.hash.startsWith('#/word')
  const commit = (att: WordAttempt): void => {
    const i = attempts.findIndex((a) => a.sid === att.sid)
    if (i >= 0) attempts[i] = att
    else attempts.push(att)
    void save(today, att)
  }
  /** 저장본이 망가져 그릴 수 없는 되짚기를 만난 문항 — 풀이만 보여 주고 이 세션에서는 다시 열지 않는다. */
  const skipped = new Set<string>()
  const doneCount = (): number => attempts.filter((a) => stage(a) === 'done').length
  const counter = (): string =>
    `<p class="word-count">문장제 ${Math.min(doneCount() + 1, WORD_PER_DAY)} / ${WORD_PER_DAY}</p>`

  function next(): void {
    if (!alive()) return
    const open = attempts.find((a) => stage(a) !== 'done' && !skipped.has(a.sid))
    if (open) {
      if (open.answer === null) question(open)
      else review(open)
      return
    }
    // n = 3 − 오늘의 모든 문항 수(스펙 §4). 끝나지 않은 문항은 위에서 먼저 이어 했다.
    if (attempts.length >= WORD_PER_DAY) {
      finished()
      return
    }
    const doneGroups = new Set(
      attempts.map((a) => groupOf(a.problem.type)).filter((g): g is WordGroup => g !== null),
    )
    const [type] = pickWordTypes(days, 1, doneGroups, Math.random)
    // sid는 보여 주는 순간 하나씩 만든다 — 같은 밀리초에 두 문항이 한 sid가 되지 않게(스펙 §4).
    const att: WordAttempt = {
      sid: `${deviceId}:${Date.now()}`,
      problem: makeProblem(type!, Math.random),
      answer: null,
      exprs: [],
      ms: 0,
      picks: [],
      calcs: [],
    }
    commit(att)
    question(att)
  }

  const exitHtml = '<button class="word-exit" id="exit">← 홈</button>'
  const wireExit = (): void => {
    root.querySelector('#exit')!.addEventListener('click', () => navigate('#/'))
  }

  function question(att: WordAttempt): void {
    const p = att.problem
    const lines = ['']
    let answer = ''
    /** -1 = 답 칸, 0.. = 식 줄. 식부터 쓰게 첫 줄에서 시작한다. */
    let focus = 0
    const shownAt = Date.now()
    const keys = ['7', '8', '9', '+', '4', '5', '6', '−', '1', '2', '3', '×', '⌫', '0', '=']
    root.replaceChildren(
      el(`
        <div class="word">
          ${counter()}
          <p class="word-text">${escapeHtml(p.text)}</p>
          <div class="word-label">식</div>
          <div class="word-lines" id="lines"></div>
          <button class="word-more" id="more">+ 식 한 줄 더</button>
          <div class="word-answer">
            <span class="word-label">답</span>
            <button class="word-field" id="ans"></button>
            <span>${escapeHtml(p.unit)}</span>
          </div>
          <div class="keypad word-pad" id="pad">
            ${keys.map((k) => `<button class="seed-action-button seed-action-button--variant_neutralOutline seed-action-button--size_large" data-k="${k}">${k}</button>`).join('')}
          </div>
          <button class="step word-submit" id="submit">다 풀었어요</button>
          ${exitHtml}
        </div>
      `),
    )
    const paint = (): void => {
      root.querySelector('#lines')!.innerHTML = lines
        .map(
          (l, i) =>
            `<button class="word-field ${focus === i ? 'is-focus' : ''}" data-line="${i}">${escapeHtml(l)}</button>`,
        )
        .join('')
      const ans = root.querySelector<HTMLButtonElement>('#ans')!
      ans.textContent = answer
      ans.classList.toggle('is-focus', focus === -1)
      for (const b of root.querySelectorAll<HTMLButtonElement>('#pad [data-k]'))
        b.disabled = focus === -1 && '+−×='.includes(b.dataset.k!)
      root.querySelector<HTMLButtonElement>('#submit')!.disabled = answer === ''
      root.querySelector<HTMLButtonElement>('#more')!.hidden = lines.length >= 3
    }
    root.querySelector('#lines')!.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-line]')
      if (!t) return
      focus = Number(t.dataset.line)
      paint()
    })
    root.querySelector('#ans')!.addEventListener('click', () => {
      focus = -1
      paint()
    })
    root.querySelector('#more')!.addEventListener('click', () => {
      if (lines.length >= 3) return
      lines.push('')
      focus = lines.length - 1
      paint()
    })
    root.querySelector('#pad')!.addEventListener('click', (e) => {
      const k = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-k]')?.dataset.k
      if (k === undefined) return
      if (focus === -1) {
        if (k === '⌫') answer = answer.slice(0, -1)
        // 최대 3자리 — 단서어 반응 오답(예: 85+27=112)이 잘리면 리포트가 그 실수를 못 센다(스펙 §4).
        else if (/^\d$/.test(k) && answer.length < 3) answer += k
      } else {
        const l = lines[focus]!
        if (k === '⌫') lines[focus] = l.slice(0, -1)
        else if (l.length < 20) lines[focus] = l + k
      }
      paint()
    })
    root.querySelector('#submit')!.addEventListener('click', () => {
      if (answer === '') return
      const answered: WordAttempt = {
        ...att,
        answer: Number(answer),
        exprs: lines.map((l) => l.trim()).filter((l) => l !== ''),
        ms: Date.now() - shownAt,
      }
      commit(answered)
      if (isCorrect(answered)) correct(answered)
      else review(answered)
    })
    wireExit()
    paint()
  }

  function correct(att: WordAttempt): void {
    const g = groupOf(att.problem.type)
    const note =
      g === null
        ? ''
        : g === 'reverse'
          ? '거꾸로 푸는 문제였어요'
          : `${WORD_GROUP_LABELS[g]} 이야기였어요`
    root.replaceChildren(
      el(`
        <div class="word">
          <p class="word-good">맞았어요!</p>
          ${note ? `<p class="word-note">${note}</p>` : ''}
          <button class="step" id="next">다음</button>
          ${exitHtml}
        </div>
      `),
    )
    wireExit()
    root.querySelector('#next')!.addEventListener('click', next)
  }

  function feedback(msg: string, att: WordAttempt): void {
    root.replaceChildren(
      el(`
        <div class="word">
          <p class="word-text">${escapeHtml(att.problem.text)}</p>
          <p class="word-feedback">${msg}</p>
          <button class="step" id="next">다음</button>
          ${exitHtml}
        </div>
      `),
    )
    wireExit()
    root.querySelector('#next')!.addEventListener('click', () => review(att))
  }

  function review(att: WordAttempt): void {
    if (!alive()) return
    const steps = att.problem.review
    const i = reviewPosition(att)
    if (i >= steps.length) {
      solution(att)
      return
    }
    const s = steps[i]!
    const head = `${counter()}<p class="word-q">같이 다시 볼까요?</p><p class="word-text">${escapeHtml(att.problem.text)}</p>`
    if (s.kind === 'story' || s.kind === 'expr') {
      // validateDay는 아는 kind의 빠진 필드를 통과시킨다 — 보기가 없으면 그리지 않고 풀이로 간다.
      const options =
        s.kind === 'story' ? STORY_GROUPS.map((g) => WORD_GROUP_LABELS[g]) : (s.options ?? [])
      if (options.length === 0) {
        skipped.add(att.sid)
        solution(att)
        return
      }
      root.replaceChildren(
        el(`
          <div class="word">
            ${head}
            <p class="word-q">${s.kind === 'story' ? '어떤 이야기일까요?' : '어떤 식일까요?'}</p>
            <div class="word-options">
              ${options.map((o, j) => `<button class="step" data-j="${j}">${escapeHtml(o)}</button>`).join('')}
            </div>
            ${exitHtml}
          </div>
        `),
      )
      wireExit()
      let locked = false
      root.querySelector('.word-options')!.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-j]')
        if (!b || locked) return
        locked = true
        const j = Number(b.dataset.j)
        const nextAtt: WordAttempt = { ...att, picks: [...att.picks, j] }
        commit(nextAtt)
        const right = escapeHtml(options[s.correct] ?? '')
        const tail = s.kind === 'story' ? `${right} 이야기예요` : `${right} 식이에요`
        feedback(j === s.correct ? `맞아요! ${tail}` : tail, nextAtt)
      })
      return
    }
    if (s.kind === 'calc' && !Number.isFinite(s.value)) {
      skipped.add(att.sid)
      solution(att)
      return
    }
    if (s.kind === 'calc') {
      let v = ''
      root.replaceChildren(
        el(`
          <div class="word">
            ${head}
            <p class="word-q">${escapeHtml(s.expr)} = ?</p>
            <div class="word-field is-focus" id="v"></div>
            <div class="keypad" id="pad">
              ${['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0']
                .map(
                  (k) =>
                    `<button class="seed-action-button seed-action-button--variant_neutralOutline seed-action-button--size_large" data-k="${k}">${k}</button>`,
                )
                .join('')}
            </div>
            <button class="step" id="ok" disabled>확인</button>
            ${exitHtml}
          </div>
        `),
      )
      wireExit()
      const paint = (): void => {
        root.querySelector('#v')!.textContent = v
        root.querySelector<HTMLButtonElement>('#ok')!.disabled = v === ''
      }
      root.querySelector('#pad')!.addEventListener('click', (e) => {
        const k = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-k]')?.dataset.k
        if (k === undefined) return
        if (k === '⌫') v = v.slice(0, -1)
        else if (v.length < 3) v += k
        paint()
      })
      let locked = false
      root.querySelector('#ok')!.addEventListener('click', () => {
        if (v === '' || locked) return
        locked = true
        const nextAtt: WordAttempt = { ...att, calcs: [...att.calcs, Number(v)] }
        commit(nextAtt)
        const line = `${escapeHtml(s.expr)} = ${Number(s.value)}`
        feedback(Number(v) === s.value ? `맞아요! ${line}` : line, nextAtt)
      })
      return
    }
    // 모르는 kind는 reviewPosition이 건너뛰므로 여기에 오지 않는다.
    solution(att)
  }

  function solution(att: WordAttempt): void {
    const p = att.problem
    root.replaceChildren(
      el(`
        <div class="word">
          <p class="word-q">이렇게 풀어요</p>
          <ol class="word-steps">
            ${p.steps.map((s) => `<li>${escapeHtml(s.expr)} = ${Number(s.value)}</li>`).join('')}
          </ol>
          <p class="word-note">답: ${Number(p.answer)}${escapeHtml(p.unit)}</p>
          <button class="step" id="next">다음 문제</button>
          ${exitHtml}
        </div>
      `),
    )
    wireExit()
    root.querySelector('#next')!.addEventListener('click', next)
  }

  function finished(): void {
    clearError()
    root.replaceChildren(
      el(`
        <div class="word">
          <p class="word-good">오늘 문장제 끝! ✓</p>
          <p class="word-note">내일 또 만나요</p>
          <button class="step" id="back">← 홈</button>
        </div>
      `),
    )
    root.querySelector('#back')!.addEventListener('click', () => navigate('#/'))
  }

  next()
}
