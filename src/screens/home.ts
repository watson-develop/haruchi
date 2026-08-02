import { getAllDays, getMeta, putMeta } from '../data/db'
import { dayKey } from '../engine/dates'
import type { Day } from '../data/types'
import { el, formatDate, navigate, showError } from '../ui'

/** 채점까지 끝난 날의 수. 스프린트는 Phase 2에서 합류한다. */
function completedCount(days: Day[]): number {
  return days.filter((d) => d.grades && Object.keys(d.grades).length > 0).length
}

/** 채점이 비어 있는 가장 최근 과거 날짜. 없으면 null. */
function pendingGradeDate(days: Day[], today: string): string | null {
  for (let i = days.length - 1; i >= 0; i--) {
    const d = days[i]!
    if (d.date >= today) continue
    if (!d.grades || Object.keys(d.grades).length === 0) return d.date
  }
  return null
}

async function renderSetup(root: HTMLElement): Promise<void> {
  root.replaceChildren(
    el(`
      <div class="setup">
        <h1>하루치</h1>
        <p class="date">아이 이름을 알려주세요. 문장제에 이름이 들어가요.</p>
        <input id="name" placeholder="예: 서연" autocomplete="off" />
        <button class="step" id="save">시작하기</button>
      </div>
    `)
  )
  root.querySelector('#save')!.addEventListener('click', async () => {
    const input = root.querySelector<HTMLInputElement>('#name')!
    const name = input.value.trim()
    if (!name) {
      input.focus()
      return
    }
    try {
      const meta = await getMeta()
      meta.settings.childName = name
      await putMeta(meta)
      await renderHome(root)
    } catch (e) {
      showError(`설정을 저장하지 못했어요: ${(e as Error).message}`)
    }
  })
}

export async function renderHome(root: HTMLElement): Promise<void> {
  const meta = await getMeta()
  if (!meta.settings.childName) return renderSetup(root)

  const days = await getAllDays()
  const today = dayKey(new Date())
  const todayDay = days.find((d) => d.date === today)
  const printed = Boolean(todayDay?.sheet.length)
  const graded = Boolean(todayDay?.grades && Object.keys(todayDay.grades).length > 0)
  const pending = pendingGradeDate(days, today)

  root.replaceChildren(
    el(`
      <div>
        <h1>하루치</h1>
        <div class="date">${formatDate(today)}</div>
        <div class="streak">✅ ${completedCount(days)}일 완료</div>
        ${
          pending
            ? `<div class="banner" id="pending">${formatDate(pending)} 채점이 안 됐어요 — 지금 하기</div>`
            : ''
        }
        <button class="step ${printed ? 'done' : ''}" id="print">
          ${printed ? '✓ ' : ''}문제지 인쇄
          <small>세로셈 ${meta.settings.verticalCount} + □ 채우기 ${meta.settings.inverseCount}</small>
        </button>
        <button class="step ${graded ? 'done' : ''}" id="grade">
          ${graded ? '✓ ' : ''}채점하기
          <small>${printed ? '틀린 것만 눌러주세요' : '문제지를 먼저 인쇄해주세요'}</small>
        </button>
      </div>
    `)
  )

  root.querySelector('#print')!.addEventListener('click', () => navigate('#/print'))
  root.querySelector('#grade')!.addEventListener('click', () => {
    if (!printed) return
    navigate('#/grade')
  })
  root.querySelector('#pending')?.addEventListener('click', () => navigate(`#/grade/${pending}`))
}
