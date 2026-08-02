import { registerSW } from 'virtual:pwa-register'
import { renderHome } from './screens/home'
import { showError } from './ui'

const app = document.querySelector<HTMLDivElement>('#app')!

/** 새 버전이 준비되면 배너를 띄운다. 사용자가 누를 때만 새로고침한다. */
function registerUpdatePrompt(): void {
  const update = registerSW({
    onNeedRefresh() {
      const button = document.createElement('button')
      button.className = 'update'
      button.textContent = '새 버전이 있어요 — 눌러서 업데이트'
      button.addEventListener('click', () => void update(true))
      document.body.append(button)
    },
  })
}

async function route(): Promise<void> {
  const hash = location.hash || '#/'
  try {
    if (hash.startsWith('#/print')) {
      const { renderPrint } = await import('./screens/print-sheet')
      await renderPrint(app)
    } else if (hash.startsWith('#/grade')) {
      const { renderGrade } = await import('./screens/grade')
      const date = hash.split('/')[2] || undefined
      await renderGrade(app, date)
    } else {
      await renderHome(app)
    }
  } catch (e) {
    showError(`화면을 여는 데 실패했어요: ${(e as Error).message}`)
  }
}

window.addEventListener('hashchange', route)
route()
registerUpdatePrompt()
