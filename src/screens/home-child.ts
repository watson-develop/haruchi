import { getAllDays, getMeta } from '../data/db'
import { checkupDue } from '../engine/checkup'
import { dayKey } from '../engine/dates'
import { sprintStreak } from '../engine/streak'
import { clearError, el, formatDate, navigate, showError } from '../ui'

/**
 * 아이 홈(설계 2026-08-04-role-based-ui §3). 앱의 기본 화면이다.
 *
 * 인쇄·채점·리포트 버튼이 **없다** — 채점 화면은 모든 문항의 정답을 표시하므로
 * 아이가 거기 닿는 경로를 화면에서 없앤다. 다만 잠금이 아니라 분리라서,
 * 주소를 알고 치면 여전히 열린다(설계 §8의 한계).
 *
 * 🔥만 두고 ✅ 완료일수는 부모 홈으로 보낸다 — 기본 설계 §6.8의 "관대함과
 * 정직함을 두 숫자로 분리"가 화면에서도 지켜진다.
 */
export async function renderChildHome(root: HTMLElement): Promise<void> {
  try {
    const meta = await getMeta()
    const days = await getAllDays()
    const today = dayKey(new Date())
    const todayDay = days.find((d) => d.date === today)
    // "sprint가 있고 비어 있지 않다" — sprintStreak(streak.ts)·completedCount(report.ts)와
    // 같은 식을 써야 한다. 어긋나면 같은 날을 두고 화면이 서로 다른 말을 한다.
    const sprinted = Boolean(todayDay?.sprint && todayDay.sprint.length > 0)
    const checkup = checkupDue(days, meta.settings.fluentMs, today)

    // 스프린트 카드 3-상태(옛 home.ts 로직 그대로). 점검 due는 오늘 스프린트가 끝난
    // 직후에도 참이 될 수 있어(그 세션이 첫 fluent를 만들면 게이트가 그때 열린다),
    // 오늘 이미 했으면 광고하지 않는다 — 눌러도 기존 결과 화면이 뜨므로 버튼이 거짓말이 된다.
    const card =
      todayDay?.kind === 'checkup' && sprinted
        ? { done: true, label: '✓ 오늘 점검 끝!', sub: '정복한 식을 다시 확인했어요' }
        : checkup && !sprinted
          ? { done: false, label: '🔍 점검 스프린트', sub: '정복한 식을 다시 확인해요' }
          : sprinted
            ? { done: true, label: '✓ 오늘 끝!', sub: '내일 또 만나요' }
            : {
                done: false,
                label: '▶ 구구단 스프린트',
                sub: `${meta.settings.sprintCount}문제 · 3분`,
              }

    root.replaceChildren(
      el(`
        <div>
          <h1>하루치</h1>
          <div class="date">${formatDate(today)}</div>
          <div class="kid-streak">🔥 ${sprintStreak(days, today)}일 연속</div>
          <button class="kid-main ${card.done ? 'done' : ''}" id="sprint">
            ${card.label}
            <small>${card.sub}</small>
          </button>
          <div class="kid-row">
            <button class="kid-card" id="map">구구단 지도</button>
            <button class="kid-card" id="ebs">EBS 강의</button>
          </div>
          <button class="kid-parent" id="parent">부모 →</button>
        </div>
      `),
    )

    root.querySelector('#sprint')!.addEventListener('click', () => navigate('#/sprint'))
    root.querySelector('#map')!.addEventListener('click', () => navigate('#/map'))
    root.querySelector('#ebs')!.addEventListener('click', () => navigate('#/ebs'))
    root.querySelector('#parent')!.addEventListener('click', () => navigate('#/parent'))
  } catch (e) {
    // 홈은 기본 경로이자 PWA의 start_url이라 여기서 던지면 #app이 빈 채로 남는다.
    // showError는 body에만 붙으므로, 홈 화면으로만 띄운 스탠드얼론 앱에는 주소창도
    // 새로고침 버튼도 없다 — #app 안에 살아 있는 조작 수단을 남긴다. 홈에서는
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
      void renderChildHome(root)
    })
  }
}
