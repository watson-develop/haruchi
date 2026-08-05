/**
 * 상단 고정 에러 배너. 조용한 실패를 만들지 않는다.
 * 닫기(✕)를 함께 붙인다 — 배너를 지울 수단이 없으면 해결된 실패가 계속 참인 척한다.
 */
export function showError(message: string, detail?: unknown): void {
  let bar = document.querySelector<HTMLDivElement>('#error-bar')
  if (!bar) {
    bar = document.createElement('div')
    bar.id = 'error-bar'
    // .overlay는 인쇄에서 숨겨지는 유일한 표식이다(print.css의 @media print).
    // 새 오버레이를 만들 때마다 이 클래스를 붙이면 종이 오염이 구조로 막힌다.
    bar.className = 'overlay seed-callout__root seed-callout__root--tone_critical'
    bar.setAttribute('role', 'alert')

    // 사람 말(위)과 기술 상세(아래, 작게)를 나눈다(리뷰 P1-4) — 상세는 아빠의
    // 디버깅용이지 사용자의 읽을거리가 아니다. 둘 다 textContent — XSS 경계.
    const content = document.createElement('div')
    content.className = 'error-content'
    const text = document.createElement('span')
    text.className = 'error-text seed-callout__description'
    const detailLine = document.createElement('small')
    detailLine.className = 'error-detail'
    content.append(text, detailLine)
    bar.append(content)

    const dismiss = document.createElement('button')
    dismiss.className = 'error-dismiss seed-callout__closeButton'
    dismiss.textContent = '✕'
    dismiss.setAttribute('aria-label', '오류 알림 닫기')
    dismiss.addEventListener('click', clearError)
    bar.append(dismiss)

    document.body.prepend(bar)
  }
  bar.querySelector('.error-text')!.textContent = message
  bar.querySelector('.error-detail')!.textContent =
    detail == null ? '' : detail instanceof Error ? detail.message : String(detail)
}

/**
 * 에러 배너를 없앤다. 성공한 렌더 경로의 첫머리에서 부른다.
 *
 * 자동 해제와 ✕를 둘 다 둔 이유: 자동 해제만으로는 화면 전환 없이 같은 화면에 머무는
 * 동안(예: 채점 저장 실패 후 재시도 성공) 배너가 남고, ✕만으로는 부모가 직접 눌러야
 * 사라진다. 아이패드에 며칠씩 떠 있는 앱이라 "지난 실패가 계속 참인 척하는" 상태를
 * 만들지 않는 쪽을 택했다.
 */
export function clearError(): void {
  document.querySelector('#error-bar')?.remove()
}

/**
 * 사라지는 성공 피드백. `showError`와 짝이지만 같은 것의 변종이 아니다 —
 * 실패는 남아야 하고(부모가 놓치면 데이터가 조용히 어긋난다) 성공은 사라져도 된다.
 * 그래서 여기에는 critical 톤이 없다. 실패는 전부 showError로 간다.
 *
 * 명령형인 이유: 선언형은 상태를 둘 자리가 필요한데 바닐라 DOM에는 그 자리가 없다.
 * 화면은 #app을 replaceChildren으로 갈아 끼우므로 상태를 들고 있을 수 없다.
 */
export function toast(message: string, opts: { tone?: 'neutral' | 'positive' } = {}): void {
  const region = document.querySelector<HTMLDivElement>('#toast-region') ?? createToastRegion()

  // SEED snackbar recipe의 variant는 default|positive|critical이다(설치본 확인 완료).
  // 우리 tone 'neutral'이 SEED의 'default'에 해당한다. critical은 이 함수에 없다 —
  // 실패는 전부 showError로 간다.
  const variant = opts.tone === 'positive' ? 'positive' : 'default'

  const bar = document.createElement('div')
  bar.className = `seed-snackbar__root seed-snackbar__root--variant_${variant}`
  bar.setAttribute('role', 'status')
  // snackbar 레시피는 .seed-snackbar__root:not([data-open])를 기본("닫힘") 상태로
  // 두는데, 이 규칙의 특정도(0,2,0)가 기본 규칙(0,1,0)보다 높아 항상 이긴다 —
  // data-open을 안 달면 mount 직후 opacity:0으로 forwards 고정돼 enter 애니메이션이
  // 재생될 기회조차 없다(설치본 snackbar.layered.css 확인). 만들자마자 달아
  // 그 규칙을 피한다.
  bar.setAttribute('data-open', '')

  const message_ = document.createElement('span')
  message_.className = 'seed-snackbar__message'
  message_.textContent = message
  bar.append(message_)

  region.append(bar)

  // 노출 3초(브리프의 계약, Task 8이 기대)는 그대로 두고 그 뒤에 뚝 끊지 않는다 —
  // data-open을 떼면 :not([data-open])이 다시 이겨 exit 애니메이션이 재생된다.
  // 그 길이가 --seed-duration-d2(0.1s = 100ms, 설치본 확인)라 그만큼만 더 기다렸다가
  // 실제로 지운다. region 정리(마지막 토스트면 region까지 지움)는 이 완전한 제거
  // 시점에 해야 childElementCount가 살아있는 다른 토스트를 정확히 반영한다.
  setTimeout(() => {
    bar.removeAttribute('data-open')
    setTimeout(() => {
      bar.remove()
      if (region.childElementCount === 0) region.remove()
    }, 100)
  }, 3000)
}

function createToastRegion(): HTMLDivElement {
  const region = document.createElement('div')
  region.id = 'toast-region'
  // .overlay는 인쇄에서 숨겨지는 유일한 표식이다(print.css의 @media print) —
  // showError·update 배너와 같은 규약을 따른다.
  region.className = 'overlay seed-snackbar-region'
  document.body.append(region)
  return region
}

/**
 * 확인 다이얼로그. Promise<boolean>을 돌려주므로 호출부가 흐름을 끊지 않고 쓴다.
 *
 * Promise가 한 번만 resolve되는 성질이 이중 클릭 가드를 겸한다 — 손으로 만든
 * 가져오기 확인 패널에 그 가드가 없어 인수인계에 이월돼 있었다(이후 report.ts에서
 * 이 함수로 교체됐다). 되돌릴 수 없는 전체 교체를 두 번 태우는 사고를 여기서
 * 구조로 막는다.
 */
export function confirmDialog(opts: {
  title: string
  description?: string | string[]
  confirmLabel: string
  cancelLabel?: string
  tone?: 'neutral' | 'critical'
}): Promise<boolean> {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div')
    backdrop.className = 'overlay seed-dialog__backdrop'
    backdrop.setAttribute('data-state', 'open')

    const positioner = document.createElement('div')
    positioner.className = 'overlay seed-dialog__positioner'
    positioner.setAttribute('data-state', 'open')

    const content = document.createElement('div')
    content.className = 'seed-dialog__content'
    content.setAttribute('data-state', 'open')
    content.setAttribute('role', 'alertdialog')
    content.setAttribute('aria-modal', 'true')

    const header = document.createElement('div')
    header.className = 'seed-dialog__header'
    const title = document.createElement('h2')
    title.className = 'seed-dialog__title'
    title.textContent = opts.title
    header.append(title)
    // 여러 줄을 받을 수 있다(배열) — 줄마다 별도 <p>로 렌더한다. header가
    // flex column + gap이라(레시피 확인) 여러 개를 나란히 둬도 title과 같은
    // 간격으로 떨어진다. 모든 줄이 textContent로 들어간다 — innerHTML 금지가
    // 이 함수의 XSS 경계다.
    const descLines = opts.description == null ? [] : ([] as string[]).concat(opts.description)
    for (const line of descLines) {
      const desc = document.createElement('p')
      desc.className = 'seed-dialog__description'
      desc.textContent = line
      header.append(desc)
    }
    content.append(header)

    const footer = document.createElement('div')
    footer.className = 'seed-dialog__footer'

    const cancel = document.createElement('button')
    cancel.className = 'seed-action-button seed-action-button--variant_neutralWeak'
    cancel.textContent = opts.cancelLabel ?? '취소'

    const confirm = document.createElement('button')
    const variant = opts.tone === 'critical' ? 'criticalSolid' : 'brandSolid'
    confirm.className = `seed-action-button seed-action-button--variant_${variant}`
    confirm.textContent = opts.confirmLabel

    footer.append(cancel, confirm)
    content.append(footer)
    positioner.append(content)
    document.body.append(backdrop, positioner)

    // settle을 거치므로 어느 경로로 닫히든(확인·취소·배경 클릭·Esc·화면 전환) 정확히
    // 한 번만 resolve된다 — 이게 이 함수의 이중 클릭 가드다.
    let settled = false
    const settle = (result: boolean) => {
      if (settled) return
      settled = true
      backdrop.remove()
      positioner.remove()
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('hashchange', onHashChange)
      resolve(result)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') settle(false)
    }
    // 다이얼로그는 document.body에 붙어 화면(#app) 교체로 사라지지 않는다 — 해시가
    // 바뀌면(예: 다른 파괴적 작업이 먼저 끝나 navigate()가 불려 화면이 넘어간 경우)
    // 무조건 취소로 닫는다. 안 그러면 이전 화면에서 뜬 확인창이 새 화면 위에 그대로
    // 남아, 이미 끝난(또는 다른) 맥락의 작업을 뒤늦게 확정시킬 수 있다 — 이 함수를
    // 쓰는 모든 호출부에 해당하는 일반적인 안전장치라 여기(공통 함수)에 둔다.
    const onHashChange = () => settle(false)

    cancel.addEventListener('click', () => settle(false))
    confirm.addEventListener('click', () => settle(true))
    // backdrop이 아니라 positioner에 건다: 둘 다 position:fixed inset:0이고
    // DOM에서 positioner가 뒤에 append되므로(같은 --dialog-z-index) 스택 순서상
    // 항상 위에 그려진다 — backdrop은 화면 전체가 positioner에 가려져 클릭이
    // 닿지 않는다(설치본 dialog.layered.css 확인). e.target이 positioner
    // 자신일 때만 닫아야 content 안(제목·버튼 등) 클릭이 버블링돼 오작동으로
    // 닫히는 걸 막는다.
    positioner.addEventListener('click', (e) => {
      if (e.target === positioner) settle(false)
    })
    document.addEventListener('keydown', onKey)
    window.addEventListener('hashchange', onHashChange)

    confirm.focus()
  })
}

/**
 * 해시 이동. 이미 같은 해시면 대입은 hashchange를 일으키지 않으므로 직접 이벤트를 쏜다.
 *
 * 그러지 않으면 #/에 있는 동안 그려진 "← 홈" 버튼은 눌러도 아무 일도 일어나지 않는
 * 죽은 버튼이 된다. 아이패드에 홈 화면 아이콘으로 띄운 스탠드얼론 앱에는 주소창도
 * 새로고침 버튼도 없어서, 조작 수단이 하나도 듣지 않는 화면에 갇히면 강제 종료 말고는
 * 빠져나갈 길이 없다. 지금 그런 화면이 실제로 있지는 않지만, 대가가 두 줄이고
 * 실패했을 때의 값이 이만큼 크면 미리 막아 두는 쪽이 맞다.
 *
 * main.ts의 route()는 같은 해시로 다시 불려도 안전하다 — 화면마다 #app을
 * replaceChildren으로 통째로 갈아 끼우고 상태는 매번 IndexedDB에서 다시 읽는다.
 */
export function navigate(hash: string): void {
  if (location.hash === hash) window.dispatchEvent(new HashChangeEvent('hashchange'))
  else location.hash = hash
}

/**
 * el()이 innerHTML을 쓰므로, 신뢰할 수 없는 값을 템플릿에 넣기 전에 반드시 통과시킨다.
 * 가져오기(복구)로 들어온 백업 파일의 내용이 대표적이다 — 스키마 검증은 타입만 보장하고
 * 문자열의 내용은 보장하지 않는다.
 *
 * 인자가 `string`이 아니라 `unknown`인 이유: `validateBackup`(engine/backup.ts)은
 * `sheet[]` 항목의 `id`와 `kind`만 검사하고 **변형별 필드는 의도적으로 전부 미검증**이다
 * (미래 호환 트레이드오프). 그래서 타입상 `number`인 `a`·`b`·`c`·`answer`에도 가져오기로
 * 임의 문자열이 들어올 수 있다 — "숫자니까 안전하다"는 판단이 정확히 구멍이 되는 자리다.
 * 호출부가 `escapeHtml(String(x))`를 매번 쓰는 대신 여기서 String()으로 좁혀,
 * 렌더 지점에서는 `escapeHtml(...)` 한 형태만 보고 "이스케이프됐다"를 알 수 있게 한다.
 * 손상된 값은 이상하게 보일 뿐(`[object Object]`) 렌더가 죽지는 않는다 — 재인쇄·채점
 * 화면이 열리는 쪽을 택한다.
 *
 * `&`를 가장 먼저 치환한다 — 나중에 하면 아래 치환들이 만든 엔티티(`&lt;` 등)의 `&`까지
 * 다시 걸려 이중 이스케이프(`&amp;lt;`)가 된다.
 */
export function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** HTML 문자열을 엘리먼트 하나로 만든다. */
export function el(html: string): HTMLElement {
  const t = document.createElement('template')
  t.innerHTML = html.trim()
  return t.content.firstElementChild as HTMLElement
}

/**
 * 종이에 찍히는 문항 번호. 인쇄 순서(세로셈→역연산→전략→문장제)대로 앞에서부터 붙는다.
 *
 * 왜 ui.ts인가: 이 표를 봐야 하는 곳은 인쇄 화면(print-sheet.ts)과 채점 화면(grade.ts)
 * **둘 다**이고, 두 표가 어긋나면 종이의 번호와 채점 화면의 번호가 안 맞는다 — 이 앱이
 * 막으려는 바로 그 실패다. 한쪽 화면에 두고 다른 화면이 import하면 화면이 화면에
 * 의존하게 되고(둘은 형제다), 계획서 Architecture가 화면 테스트를 금지하므로 두 사본이
 * 어긋나도 잡아줄 테스트가 없다. ui.ts는 두 화면이 이미 함께 쓰는 유일한 모듈이라,
 * "한 곳에서 export하고 둘이 import한다"를 구조로 강제할 수 있는 자리다.
 */
export const ITEM_MARKS = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭'

/** "2026-08-02" → "8월 2일 토요일" */
export function formatDate(key: string, withYear = false): string {
  const [y, m, d] = key.split('-').map(Number)
  const date = new Date(y!, m! - 1, d!)
  const week = ['일', '월', '화', '수', '목', '금', '토'][date.getDay()]
  return `${withYear ? `${y}년 ` : ''}${m}월 ${d}일 ${week}요일`
}
