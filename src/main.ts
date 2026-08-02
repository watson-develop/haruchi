import { renderHome } from './screens/home'
import { showError } from './ui'

const app = document.querySelector<HTMLDivElement>('#app')!

async function route(): Promise<void> {
  const hash = location.hash || '#/'
  try {
    if (hash.startsWith('#/print')) {
      const { renderPrint } = await import('./screens/print-sheet')
      await renderPrint(app)
    } else if (hash.startsWith('#/grade')) {
      const { renderGrade } = await import('./screens/grade')
      const date = hash.split('/')[2]
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
