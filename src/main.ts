import { registerSW } from 'virtual:pwa-register'
import { renderChildHome } from './screens/home-child'
import { clearError, showError } from './ui'
import { kickPush, onPullApplied, pullAndWait, pullOnce } from './data/sync'

const app = document.querySelector<HTMLDivElement>('#app')!

// iOS는 저장공간 압박 시 IndexedDB를 지울 수 있다. persist()가 승인되면 이 origin은
// 그 대상에서 빠진다. 거부돼도 앱 동작은 같으므로 결과를 기다리지도 읽지도 않는다.
// 1년치 반응시간 로그는 모든 파생의 유일한 입력이고 복구 불가능하다 — 비용 0의 보험.
// promise가 reject하면(옵셔널 체이닝이 undefined를 돌려주면 이 catch는 안 걸린다)
// unhandled rejection이 되므로 무시해도 되는 실패임을 명시적으로 삼킨다.
void navigator.storage?.persist?.()?.catch(() => {})

// push 트리거(설계 §3): 시작 시 + 표식 생성 시 + 탭 복귀 시.
// 아이 화면에서도 push는 돈다 — 스프린트 결과가 즉시 올라가는 것이 A-1의 핵심이고,
// push는 화면과 무관하게 배경에서만 돈다(실패해도 아무것도 띄우지 않는다).
//
// pull 트리거(2단계 설계 §2 「언제 내리나」)는 셋이 여기 있고 넷째(부모 화면 진입)는
// route()에 있다. 시작·탭 복귀는 **기다리지 않는다** — 배경에서 돌고, 실제로 로컬을
// 바꿨으면 onPullApplied가 지금 화면을 다시 그린다. 실패는 조용하다(§3).
kickPush()
void pullOnce()
window.addEventListener('haruchi:outbox', kickPush)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return
  kickPush()
  void pullOnce()
})

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

/**
 * 부모 소속 화면(설계 §2의 트리거 표 · CLAUDE.md 「아이 소속 화면은 부모 소속 화면으로
 * 링크하지 않는다」). 이 목록은 **어느 화면이 pull을 기다리는가**만 정한다 — 화면 사이의
 * 이동은 여기서 만들지 않는다.
 */
const PARENT_HASHES = ['#/parent', '#/print', '#/grade', '#/report']

/** 부모 화면이 렌더 전에 기다리는 시간. 안전장치가 아니라 표시용이다(설계 §2) —
 *  안전이 걸린 문제지 생성은 print-sheet.ts가 자기 게이트로 전체 타임아웃을 따로 기다린다. */
const PARENT_WAIT_MS = 3000

/**
 * 화면 하나를 그린다.
 *
 * `pull`이 거짓인 호출은 **배경 pull이 이미 적용된 뒤의 재렌더**다(onPullApplied). 그때
 * 다시 pull하면 방금 끝난 패스를 곧바로 한 번 더 도는 셈이라, 변경이 적용될 때마다 쓸모
 * 없는 왕복이 하나씩 붙는다 — 재렌더는 IndexedDB만 다시 읽으면 된다.
 */
async function route(pull = true): Promise<void> {
  const hash = location.hash || '#/'
  // 지난 화면에서 띄운 에러 배너를 먼저 지운다. 실패가 여전하면 아래에서 다시 뜬다.
  // 지우지 않으면 이미 해결된 실패("채점을 저장하지 못했어요")가 며칠씩 참인 척한다.
  clearError()
  if (pull) {
    // 부모 화면은 낡은 숫자를 먼저 보여 주지 않는다 — 렌더 전에 (제한 시간까지) 기다린다.
    // 아이 화면은 기다리지 않는다: 세션 합집합 덕분에 낡은 로컬로 시작해도 잃는 것이 없고,
    // 아이를 기다리게 하는 값이 없다(설계 §2).
    if (PARENT_HASHES.some((h) => hash.startsWith(h))) await pullAndWait(PARENT_WAIT_MS)
    else void pullOnce()
  }
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

/**
 * 배경 pull이 로컬을 바꿨을 때 지금 화면을 다시 그린다(설계 §2 「배경 pull 후 화면 갱신」).
 * **같은 해시를 다시 라우팅할 뿐 화면을 옮기지 않는다** — 아이가 보던 화면이 이 신호로
 * 바뀌면 부모 화면(정답이 다 보이는 채점 화면)까지 닿는 경로가 생긴다.
 *
 * 예외는 **미커밋 입력을 쥔 화면** 둘이다. 스프린트는 진행 중 세션의 반응시간이 메모리에만
 * 있고(다시 그리면 통째로 사라진다), 채점은 수 분치 O/X가 메모리에만 있다. 채점은 화면에
 * 있다는 것만으로 판정하지 않는다 — 「문제지 없음」 화면에는 쥔 것이 없어서 갱신되는 편이
 * 낫다. grade.ts가 자기 상태를 알고 있으므로 그쪽에 묻는다(report.ts의 importBusy와 같은
 * 모듈 스코프 플래그 — 재렌더로 스코프가 새로 열려도 하나의 진실이 유지된다).
 *
 * 저장 시점의 병합이 이 예외로 놓친 갱신을 수습한다: putDay는 선언한 묶음만 싣고 나머지는
 * 저장본에서 가져오므로, 낡은 화면이 저장해도 그 사이 도착한 다른 묶음을 덮지 않는다.
 */
onPullApplied(() => {
  void (async () => {
    const hash = location.hash || '#/'
    if (hash.startsWith('#/sprint')) return
    if (hash.startsWith('#/grade')) {
      // 화면에 떠 있으면 모듈은 이미 로드돼 있다 — 이 import는 캐시에서 즉시 돌아온다.
      const { isGrading } = await import('./screens/grade')
      if (isGrading()) return
    }
    await route(false)
  })()
})

window.addEventListener('hashchange', () => void route())
void route()
registerUpdatePrompt()
