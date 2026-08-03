import { getAllDays, getMeta, putMeta } from '../data/db'
import { dayKey } from '../engine/dates'
import { completedCount } from '../engine/report'
import { sprintStreak } from '../engine/streak'
import type { Day } from '../data/types'
import { clearError, el, formatDate, navigate, showError } from '../ui'

/** 채점이 비어 있는 가장 최근 과거 날짜. 문제지가 없던 날은 제외한다. 없으면 null. */
function pendingGradeDate(days: Day[], today: string): string | null {
  for (let i = days.length - 1; i >= 0; i--) {
    const d = days[i]!
    if (d.date >= today) continue
    // 스프린트만 하고 문제지는 인쇄하지 않은 날(여행·늦은 밤 — streak.ts가 기대하는 바로
    // 그 날)은 채점할 문항이 하나도 없다. 걸러내지 않으면 배너가 영원히 남는다:
    // renderPrint는 오늘 것만 만들므로 지난 날은 문제지를 나중에도 가질 수 없고,
    // 빈 채점 화면에서 저장해도 grades가 {}라 다시 미채점으로 잡힌다.
    if (d.sheet.length === 0) continue
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
    `),
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
  try {
    const meta = await getMeta()
    if (!meta.settings.childName) return renderSetup(root)

    const days = await getAllDays()
    const today = dayKey(new Date())
    const todayDay = days.find((d) => d.date === today)
    const printed = Boolean(todayDay?.sheet.length)
    const graded = Boolean(todayDay?.grades && Object.keys(todayDay.grades).length > 0)
    const sprinted = Boolean(todayDay?.sprint && todayDay.sprint.length > 0)
    const pending = pendingGradeDate(days, today)

    root.replaceChildren(
      el(`
        <div>
          <h1>하루치</h1>
          <div class="date">${formatDate(today)}</div>
          <div class="streak">
            🔥 ${sprintStreak(days, today)}일 연속 &nbsp;·&nbsp; ✅ ${completedCount(days)}일 완료
          </div>
          ${
            pending
              ? `<div class="banner" id="pending">${formatDate(pending)} 채점이 안 됐어요 — 지금 하기</div>`
              : ''
          }
          <button class="step ${printed ? 'done' : ''}" id="print">
            ${printed ? '✓ ' : ''}문제지 인쇄
            <small>세로셈 ${meta.settings.verticalCount} + □ 채우기 ${meta.settings.inverseCount}</small>
          </button>
          <button class="step ${sprinted ? 'done' : ''}" id="sprint">
            ${sprinted ? '✓ ' : ''}구구단 스프린트
            <small>${meta.settings.sprintCount}문제 · 3분</small>
          </button>
          <button class="step ${graded ? 'done' : ''}" id="grade">
            ${graded ? '✓ ' : ''}채점하기
            <small>${printed ? '틀린 것만 눌러주세요' : '문제지를 먼저 인쇄해주세요'}</small>
          </button>
          <button class="step" id="map">구구단 지도 보기</button>
        </div>
      `),
    )

    root.querySelector('#print')!.addEventListener('click', () => navigate('#/print'))
    root.querySelector('#sprint')!.addEventListener('click', () => navigate('#/sprint'))
    root.querySelector('#grade')!.addEventListener('click', () => {
      if (!printed) return
      navigate('#/grade')
    })
    root.querySelector('#map')!.addEventListener('click', () => navigate('#/map'))
    root.querySelector('#pending')?.addEventListener('click', () => navigate(`#/grade/${pending}`))
  } catch (e) {
    // getMeta·getAllDays 조회 실패를 전부 여기서 잡는다 — print-sheet.ts·grade.ts와 같은 패턴.
    // 홈은 기본 경로이자 PWA의 start_url이라 여기서 던지면 #app이 빈 채로 남는다.
    // showError는 body에만 붙으므로, 홈 화면 전용으로 만든 앱을 스탠드얼론으로 띄운
    // 부모에게는 주소창도 새로고침 버튼도 없다 — 강제 종료 말고는 빠져나갈 길이 없어진다.
    // 그래서 배너와 별개로 항상 #app 안에 살아 있는 조작 수단을 남긴다. 홈에서는
    // 돌아갈 곳이 없으므로 이동이 아니라 재시도다.
    showError(`화면을 불러오지 못했어요: ${(e as Error).message}`)
    root.replaceChildren(
      el(`
        <div>
          <h1>하루치</h1>
          <p class="date">기록을 여는 데 실패했어요.</p>
          <button class="step" id="retry">다시 시도</button>
        </div>
      `),
    )
    root.querySelector('#retry')!.addEventListener('click', () => {
      clearError()
      void renderHome(root)
    })
  }
}
