import { registerSW } from 'virtual:pwa-register'
import { renderChildHome } from './screens/home-child'
import { clearError, showError } from './ui'

const app = document.querySelector<HTMLDivElement>('#app')!

// iOS는 저장공간 압박 시 IndexedDB를 지울 수 있다. persist()가 승인되면 이 origin은
// 그 대상에서 빠진다. 거부돼도 앱 동작은 같으므로 결과를 기다리지도 읽지도 않는다.
// 1년치 반응시간 로그는 모든 파생의 유일한 입력이고 복구 불가능하다 — 비용 0의 보험.
// promise가 reject하면(옵셔널 체이닝이 undefined를 돌려주면 이 catch는 안 걸린다)
// unhandled rejection이 되므로 무시해도 되는 실패임을 명시적으로 삼킨다.
void navigator.storage?.persist?.()?.catch(() => {})

/** 새 버전이 준비되면 배너를 띄운다. 사용자가 업데이트를 누를 때만 새로고침한다. */
function registerUpdatePrompt(): void {
  const update = registerSW({
    onNeedRefresh() {
      showUpdateBanner(update)
    },
  })
}

/**
 * 업데이트 배너를 띄운다. 이미 떠 있으면 중복으로 만들지 않는다.
 * 닫기는 배너만 없애고 절대 새로고침하지 않는다 — 다음 onNeedRefresh에서 다시 뜰 수 있다.
 */
function showUpdateBanner(update: (reloadPage?: boolean) => Promise<void>): void {
  if (document.querySelector('.update')) return

  const banner = document.createElement('div')
  // .overlay는 인쇄에서 숨겨지는 유일한 표식이다(print.css의 @media print) — ui.ts의
  // showError와 같은 규약을 따른다.
  banner.className = 'overlay update'

  const message = document.createElement('span')
  message.className = 'update-text'
  message.textContent = '새 버전이 있어요'
  banner.append(message)

  const applyButton = document.createElement('button')
  applyButton.className = 'update-apply'
  applyButton.textContent = '업데이트'
  applyButton.addEventListener('click', () => void update(true))
  banner.append(applyButton)

  const dismissButton = document.createElement('button')
  dismissButton.className = 'update-dismiss'
  dismissButton.textContent = '닫기'
  dismissButton.setAttribute('aria-label', '업데이트 알림 닫기')
  dismissButton.addEventListener('click', () => banner.remove())
  banner.append(dismissButton)

  document.body.append(banner)
}

async function route(): Promise<void> {
  const hash = location.hash || '#/'
  // 지난 화면에서 띄운 에러 배너를 먼저 지운다. 실패가 여전하면 아래에서 다시 뜬다.
  // 지우지 않으면 이미 해결된 실패("채점을 저장하지 못했어요")가 며칠씩 참인 척한다.
  clearError()
  try {
    if (hash.startsWith('#/print')) {
      const { renderPrint } = await import('./screens/print-sheet')
      await renderPrint(app)
    } else if (hash.startsWith('#/sprint')) {
      const { renderSprint } = await import('./screens/sprint')
      await renderSprint(app)
    } else if (hash.startsWith('#/grade')) {
      const { renderGrade } = await import('./screens/grade')
      const date = hash.split('/')[2] || undefined
      await renderGrade(app, date)
    } else if (hash.startsWith('#/map')) {
      const { renderMap } = await import('./screens/map')
      await renderMap(app)
    } else if (hash.startsWith('#/report')) {
      const { renderReport } = await import('./screens/report')
      await renderReport(app)
    } else if (hash.startsWith('#/ebs')) {
      const { renderEbs } = await import('./screens/ebs')
      await renderEbs(app)
    } else if (hash.startsWith('#/parent')) {
      const { renderParentHome } = await import('./screens/home-parent')
      await renderParentHome(app)
    } else {
      await renderChildHome(app)
    }
  } catch (e) {
    showError('화면을 열지 못했어요. 다시 시도해 주세요.', e)
  }
}

window.addEventListener('hashchange', route)
route()
registerUpdatePrompt()
