import { getAllDays, getMeta } from '../data/db'
import { THINKING_ITEMS_PER_DAY } from '../engine/compose'
import { dayKey } from '../engine/dates'
import { completedCount, pendingGradeDate } from '../engine/report'
import { deriveVerticalCount } from '../engine/derive'
import { sprintStreak } from '../engine/streak'
import { clearError, el, formatDate, navigate, showError } from '../ui'

/**
 * 부모 홈(설계 2026-08-04-role-based-ui §4). 인쇄·채점·리포트가 여기 있다.
 *
 * ✅ 완료일수가 이쪽에 있는 이유: 기본 설계 §6.8이 "관대함(🔥)과 정직함(✅)을 두
 * 숫자로 분리한다"고 정해 뒀는데, 옛 홈은 둘을 한 줄에 나란히 놓아 그 분리를
 * 화면에서 지키지 못했다. 🔥는 아이 홈으로 갔고 여기에는 참고로만 병기한다.
 */
export async function renderParentHome(root: HTMLElement): Promise<void> {
  try {
    const meta = await getMeta()
    const days = await getAllDays()
    const today = dayKey(new Date())
    const verticalCount = deriveVerticalCount(days)
    const todayDay = days.find((d) => d.date === today)
    const printed = Boolean(todayDay?.sheet.length)
    const graded = Boolean(todayDay?.grades && Object.keys(todayDay.grades).length > 0)
    const pending = pendingGradeDate(days, today)
    // 인쇄된 종이는 고정된 사실이고 파생값은 다음 종이의 예고다 — 이미 인쇄된 날은
    // 채점(예: 😫 3연속)이 그날의 파생값을 바꿔도 손에 든 종이는 그대로다. printed일 때는
    // sheet를 직접 세어 라벨이 항상 실제 종이와 일치하게 하고, 아직 인쇄 전일 때만
    // deriveVerticalCount 등 파생값을 다음 문제지의 미리보기로 쓴다.
    const sheetCounts = printed
      ? {
          vertical: todayDay!.sheet.filter((it) => it.kind === 'vertical').length,
          inverse: todayDay!.sheet.filter((it) => it.kind === 'inverse').length,
          thinking: todayDay!.sheet.filter((it) => it.kind === 'strategy' || it.kind === 'word')
            .length,
          total: todayDay!.sheet.length,
        }
      : null

    root.replaceChildren(
      el(`
        <div>
          <h1>하루치 · 부모</h1>
          <div class="date">${formatDate(today)}</div>
          <div class="streak">
            ✅ ${completedCount(days)}일 완료 &nbsp;·&nbsp; 🔥 ${sprintStreak(days, today)}일 연속
          </div>
          ${
            pending
              ? `<div class="banner seed-callout__root seed-callout__root--tone_warning" id="pending" role="button" tabindex="0"><span class="seed-callout__description seed-callout__description--tone_warning">${formatDate(pending)} 채점이 안 됐어요 — 지금 하기</span></div>`
              : ''
          }
          <button class="step ${printed ? 'done' : ''}" id="print">
            ${printed ? '✓ ' : ''}문제지 인쇄
            <small>${
              sheetCounts
                ? `세로셈 ${sheetCounts.vertical} + □ 채우기 ${sheetCounts.inverse} + 생각하는 문제 ${sheetCounts.thinking} (${sheetCounts.total}문항 · 2장)`
                : `세로셈 ${verticalCount} + □ 채우기 ${meta.settings.inverseCount} + 생각하는 문제 ${THINKING_ITEMS_PER_DAY} (${verticalCount + meta.settings.inverseCount + THINKING_ITEMS_PER_DAY}문항 · 2장)`
            }</small>
          </button>
          <button class="step ${graded ? 'done' : ''}" id="grade" ${printed ? '' : 'disabled'}>
            ${graded ? '✓ ' : ''}채점하기
            <small>${printed ? '틀린 것만 눌러주세요' : '문제지를 먼저 인쇄해주세요'}</small>
          </button>
          <button class="step" id="report">
            리포트
            <small>주간·월간 — 일요일 채점 뒤엔 자동으로 열려요</small>
          </button>
          <div class="links"><button id="ebs">EBS 강의</button></div>
          <div class="links"><button id="child">← 아이 화면</button></div>
        </div>
      `),
    )

    root.querySelector('#print')!.addEventListener('click', () => navigate('#/print'))
    root.querySelector('#grade')!.addEventListener('click', () => {
      if (!printed) return
      navigate('#/grade')
    })
    root.querySelector('#report')!.addEventListener('click', () => navigate('#/report'))
    root.querySelector('#ebs')!.addEventListener('click', () => navigate('#/ebs'))
    root.querySelector('#child')!.addEventListener('click', () => navigate('#/'))
    // role="button" + tabindex를 준 이상 키보드로도 눌려야 한다 — 역할만 주고 활성화를
    // 막으면 스크린리더에는 버튼이라고 알리면서 실제로는 누를 수 없는 상태가 된다.
    const pendingBanner = root.querySelector<HTMLDivElement>('#pending')
    pendingBanner?.addEventListener('click', () => navigate(`#/grade/${pending}`))
    pendingBanner?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        navigate(`#/grade/${pending}`)
      }
    })
  } catch (e) {
    // 조회 실패를 전부 여기서 잡는다(옛 home.ts와 같은 패턴). showError는 body에만 붙으므로
    // 주소창 없는 스탠드얼론 PWA에서는 #app 안에도 조작 수단이 있어야 갇히지 않는다.
    // 부모 홈은 아이 홈으로 나갈 길도 함께 남긴다 — 재시도가 계속 실패해도 앱은 살아 있다.
    showError('화면을 열지 못했어요.', e)
    root.replaceChildren(
      el(`
        <div>
          <h1>하루치 · 부모</h1>
          <p class="date">기록을 열지 못했어요.</p>
          <button class="step" id="retry">다시 시도</button>
          <div class="links"><button id="child">← 아이 화면</button></div>
        </div>
      `),
    )
    root.querySelector('#retry')!.addEventListener('click', () => {
      clearError()
      void renderParentHome(root)
    })
    root.querySelector('#child')!.addEventListener('click', () => navigate('#/'))
  }
}
