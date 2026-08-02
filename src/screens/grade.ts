import { getDay, putDay } from '../data/db'
import { dayKey } from '../engine/dates'
import type { Day, Mood, SheetItem } from '../data/types'
import { el, navigate, showError } from '../ui'

function label(item: SheetItem): string {
  if (item.kind === 'vertical') return `${item.a} ${item.op} ${item.b}`
  if (item.kind === 'inverse') {
    switch (item.template) {
      case 'a+?=c':
        return `${item.a} + □ = ${item.c}`
      case '?+b=c':
        return `□ + ${item.b} = ${item.c}`
      case 'a-?=c':
        return `${item.a} − □ = ${item.c}`
      case '?-b=c':
        return `□ − ${item.b} = ${item.c}`
    }
  }
  return item.kind
}

const MOODS: { key: Mood; text: string }[] = [
  { key: 'easy', text: '😀 여유' },
  { key: 'ok', text: '😐 딱 맞음' },
  { key: 'hard', text: '😫 힘들어함' },
]

/**
 * 채점 화면. 모든 문항이 정답(⭕)이 기본값이고 틀린 것만 눌러 뒤집는다.
 * 보통 두세 번 탭이면 끝난다.
 */
export async function renderGrade(root: HTMLElement, date?: string): Promise<void> {
  const target = date ?? dayKey(new Date())
  const day = await getDay(target)

  if (!day) {
    root.replaceChildren(
      el(`
        <div>
          <h1>채점</h1>
          <p class="date">${target} 문제지가 없어요. 먼저 인쇄해주세요.</p>
          <button class="step" id="back">← 홈</button>
        </div>
      `)
    )
    root.querySelector('#back')!.addEventListener('click', () => navigate('#/'))
    return
  }

  const grades: Record<string, boolean> = {}
  for (const item of day.sheet) grades[item.id] = day.grades?.[item.id] ?? true
  let mood: Mood | undefined = day.mood

  root.replaceChildren(
    el(`
      <div>
        <h1>채점</h1>
        <div class="date">${target} · 틀린 것만 눌러주세요</div>
        <div id="rows"></div>
        <div class="date" style="margin-top:20px">오늘 어땠어?</div>
        <div class="moods">
          ${MOODS.map((m) => `<button class="mood" data-mood="${m.key}">${m.text}</button>`).join('')}
        </div>
        <button class="step" id="save">저장</button>
        <button class="step" id="back">← 홈</button>
      </div>
    `)
  )

  const rows = root.querySelector('#rows')!
  for (const item of day.sheet) {
    const row = el(`
      <div class="grade-row">
        <span class="q">${label(item)}</span>
        <span class="ans">${item.answer}</span>
        <button class="mark" data-id="${item.id}">⭕</button>
      </div>
    `)
    const button = row.querySelector<HTMLButtonElement>('.mark')!
    const paint = () => {
      const ok = grades[item.id]!
      button.textContent = ok ? '⭕' : '❌'
      button.classList.toggle('wrong', !ok)
    }
    button.addEventListener('click', () => {
      grades[item.id] = !grades[item.id]
      paint()
    })
    paint()
    rows.append(row)
  }

  const paintMoods = () => {
    root.querySelectorAll<HTMLButtonElement>('.mood').forEach((b) => {
      b.classList.toggle('on', b.dataset.mood === mood)
    })
  }
  root.querySelectorAll<HTMLButtonElement>('.mood').forEach((b) => {
    b.addEventListener('click', () => {
      mood = b.dataset.mood as Mood
      paintMoods()
    })
  })
  paintMoods()

  root.querySelector('#back')!.addEventListener('click', () => navigate('#/'))
  root.querySelector('#save')!.addEventListener('click', async () => {
    const updated: Day = { ...day, grades, mood, doneAt: new Date().toISOString() }
    try {
      await putDay(updated)
      navigate('#/')
    } catch (e) {
      showError(`채점을 저장하지 못했어요: ${(e as Error).message}`)
    }
  })
}
