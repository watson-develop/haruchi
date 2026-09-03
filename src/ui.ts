// 72라는 수와 램프 상태 타입의 주인은 engine이다 — 여기에 리터럴로 베끼지 않는다.
// ui.ts가 갖는 유일한 import다. engine은 DOM을 모르므로 순환하지 않는다.
import { FACT_IDS, type GenieState } from './engine/facts'

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
 *
 * `action`은 "묻지 않고 낙관적으로 실행한 뒤 되돌릴 기회를 준다"는 패턴을 위한 것이다
 * (내보내기의 lastExportedAt 기록 — report.ts 참고). 그래서 여기에는 확인 다이얼로그와
 * 달리 hashchange 처리가 없다: confirmDialog는 화면이 넘어가면 이전 맥락의 작업을
 * 뒤늦게 확정시키지 않으려고 스스로 닫히지만, 되돌리기는 어느 화면에서 눌리든 항상
 * 올바른 연산이라 화면을 옮겼다고 기회를 뺏는 쪽이 손해다.
 */
export function toast(
  message: string,
  opts: {
    tone?: 'neutral' | 'positive'
    action?: { label: string; onClick: () => void }
    durationMs?: number
  } = {},
): void {
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

  // 액션이 있을 때만 __content로 감싼다. .seed-snackbar__root가 display:flex이고
  // __content가 flex-grow:1 + justify-content:space-between이라(설치본
  // snackbar.layered.css 확인) 감싸는 것만으로 메시지와 버튼이 양끝으로 갈린다.
  // __actionButton은 :after로 44px 히트 영역을 확보해 둬 아이패드 터치에 맞는다.
  // 액션이 없으면 감싸지 않는다 — __content가 padding-inline을 더하므로 전부
  // 감싸면 기존 토스트가 미세하게 움직인다.
  let actionButton: HTMLButtonElement | null = null
  if (opts.action) {
    const content = document.createElement('div')
    content.className = 'seed-snackbar__content'
    actionButton = document.createElement('button')
    actionButton.className = 'seed-snackbar__actionButton'
    actionButton.textContent = opts.action.label
    content.append(message_, actionButton)
    bar.append(content)
  } else {
    bar.append(message_)
  }

  region.append(bar)

  // 노출이 끝나면 뚝 끊지 않는다 — data-open을 떼면 :not([data-open])이 다시 이겨
  // exit 애니메이션이 재생된다. 그 길이가 --seed-duration-d2(0.1s = 100ms, 설치본
  // 확인)라 그만큼만 더 기다렸다가 실제로 지운다. region 정리(마지막 토스트면
  // region까지 지움)는 이 완전한 제거 시점에 해야 childElementCount가 살아있는
  // 다른 토스트를 정확히 반영한다.
  //
  // settled는 액션 탭과 자동 해제가 서로를 두 번 실행하지 않게 막는다
  // (confirmDialog의 settle과 같은 이중탭 방어). 액션을 누르면 예약된 타이머를
  // 함께 취소해 이미 없앤 bar를 다시 만지지 않는다.
  let settled = false
  let timer = 0
  const dismiss = (): void => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    bar.removeAttribute('data-open')
    setTimeout(() => {
      bar.remove()
      if (region.childElementCount === 0) region.remove()
    }, 100)
  }
  // 기본 3초는 브리프의 계약이다(Task 8이 기대). 되돌릴 기회를 주는 토스트만 이걸
  // 넘긴다 — 읽고 판단할 시간이 필요하기 때문이다.
  timer = window.setTimeout(dismiss, opts.durationMs ?? 3000)

  const onAction = opts.action?.onClick
  actionButton?.addEventListener('click', () => {
    if (settled) return
    dismiss()
    onAction?.()
  })
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
  requireText?: string
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

    // 오조작 방지 입력(설계 §6 3단계). 버튼 한 번은 실수로 눌리지만 글자를 실수로 칠 수는 없다.
    // input.value 는 어디에도 렌더되지 않는다 — XSS 경계(innerHTML 금지)는 그대로다.
    let gate: HTMLInputElement | null = null
    if (opts.requireText) {
      const hint = document.createElement('p')
      hint.className = 'seed-dialog__description'
      hint.textContent = `계속하려면 "${opts.requireText}"를 입력하세요`
      gate = document.createElement('input')
      gate.className = 'confirm-gate'
      gate.setAttribute('inputmode', 'text')
      gate.setAttribute('autocomplete', 'off')
      header.append(hint, gate)
    }

    const footer = document.createElement('div')
    footer.className = 'seed-dialog__footer'

    // action-button 레시피의 base 클래스는 --seed-box-padding-*를 initial로 선언만 하고,
    // 실제 값(높이·radius·패딩·font-size)은 --size_X와 --size_X-layout_Y 컴파운드가
    // 채운다(설치본 action-button.layered.css 확인). variant만 붙이면 색만 입고 크기는
    // 전부 initial로 남아 글자에 배경색만 칠한 띠가 된다 — 실제로 그랬다.
    // large(높이 x13 = 52px)를 쓰는 이유는 medium이 40px이라 아이패드 터치 최소
    // 권장(44px)에 못 미치기 때문이다. .step 버튼들과의 크기 감각도 large가 맞는다.
    const SIZE = 'seed-action-button--size_large seed-action-button--size_large-layout_withText'

    const cancel = document.createElement('button')
    cancel.className = `seed-action-button seed-action-button--variant_neutralWeak ${SIZE}`
    cancel.textContent = opts.cancelLabel ?? '취소'

    const confirm = document.createElement('button')
    const variant = opts.tone === 'critical' ? 'criticalSolid' : 'brandSolid'
    confirm.className = `seed-action-button seed-action-button--variant_${variant} ${SIZE}`
    confirm.textContent = opts.confirmLabel

    // requireText가 있으면 정확히 일치할 때까지 확인을 막는다 — trim·대소문자 무시
    // 없이 정확히 일치해야 한다(느슨하면 이 게이트를 두는 의미가 없다).
    if (gate) {
      confirm.disabled = true
      gate.addEventListener('input', () => {
        confirm.disabled = gate!.value !== opts.requireText
      })
    }

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

    // 게이트가 있으면 확인 버튼은 비활성으로 시작하므로 포커스를 받지 못한다,
    // 사용자가 바로 입력할 수 있게 입력란에 준다.
    ;(gate ?? confirm).focus()
  })
}

/**
 * PIN 게이트(2B 스펙 §4). 통과 플래그는 포그라운드 세션이다 — main.ts가
 * visibilitychange hidden에서 lockGate()를 불러 지운다. ui.ts는 리스너를 스스로
 * 걸지 않는다(모듈 부작용 금지, window 리스너는 main.ts 소유).
 */
let gatePassed = false
/** 게이트 통과 여부의 동기 조회. main.ts가 #app을 비울지(다이얼로그가 실제로
 *  뜰 때만) 정하는 데 쓴다 — 플래그가 선 재렌더마다 비우면 화면이 깜빡인다. */
export function gateUnlocked(): boolean {
  return gatePassed
}
/** 배경 진입 시 main.ts가 부른다. 다이얼로그가 떠 있는 중이면 no-op이나 다름없다 —
 *  그 비행의 플래그는 어차피 아직 false다. */
export function lockGate(): void {
  gatePassed = false
}

/**
 * PIN 게이트(2B 스펙 §4 + UI 교체 스펙 2026-08-17). 풀스크린 키패드 화면 —
 * confirmDialog의 오버레이 규약 중 유지되는 것: .overlay 인쇄 격리, document.body
 * 부착, settle 1회 resolve, hashchange 자진 취소. 백드롭 클릭 취소는 없다(풀스크린 —
 * 취소 경로는 ✕·키패드 취소·Escape 셋).
 *
 * 단일 비행: 이미 떠 있으면 같은 Promise를 돌려준다. 게이트는 route() 한가운데서
 * 사람 입력을 무기한 기다리므로, 배경 pull 재렌더(route(false))가 겹치면 화면이
 * 쌓인다 — pullOnce와 같은 방식으로 흡수한다. 비행 중 도착한 새 expected는 무시된다
 * (감수 — 2B §4: 창이 초 단위이고 위협이 여덟 살이다).
 *
 * 틀린 입력은 닫지 않는다 — 도트를 비우고 안내만 바꾼다. 잠금·지연 없음(위협 모델:
 * 아이의 우연한 접근). 입력값 평문은 어디에도 렌더되지 않는다(도트만). 마지막 자리에서
 * 자동 판정한다 — 확인 버튼이 없다(UI 스펙 §2·§3).
 */
let gateFlight: Promise<boolean> | null = null
export function unlockGate(expected: string): Promise<boolean> {
  if (gatePassed) return Promise.resolve(true)
  if (gateFlight) return gateFlight
  const flight = new Promise<boolean>((resolve) => {
    const root = document.createElement('div')
    root.className = 'overlay pin-gate'
    root.setAttribute('role', 'alertdialog')
    root.setAttribute('aria-modal', 'true')
    root.setAttribute('aria-labelledby', 'pin-gate-title')
    root.setAttribute('tabindex', '-1')

    const close = document.createElement('button')
    close.className = 'pin-gate-close'
    close.setAttribute('aria-label', '닫기')
    close.textContent = '✕'

    const title = document.createElement('h2')
    title.className = 'pin-gate-title'
    title.id = 'pin-gate-title'
    title.textContent = '부모 확인'

    const desc = document.createElement('p')
    desc.className = 'pin-gate-desc'
    desc.setAttribute('aria-live', 'polite')
    desc.textContent = '비밀번호를 입력하세요'

    const dots = document.createElement('div')
    dots.className = 'pin-gate-dots'
    // 장식이다 — 입력 진행(몇 자리째)은 시각 전용으로 감수한다(UI 스펙 §2:
    // 자리마다 낭독하면 옆의 아이에게 자리수를 세어 주는 것이기도 하다).
    dots.setAttribute('aria-hidden', 'true')
    const dotEls: HTMLElement[] = []
    for (let i = 0; i < expected.length; i++) {
      const dot = document.createElement('i')
      dots.append(dot)
      dotEls.push(dot)
    }

    let entered = ''
    const paint = (): void => {
      dotEls.forEach((dot, i) => dot.classList.toggle('filled', i < entered.length))
    }

    const pad = document.createElement('div')
    pad.className = 'pin-gate-keypad'

    let settled = false
    const settle = (result: boolean): void => {
      if (settled) return
      settled = true
      gateFlight = null
      if (result) gatePassed = true
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('hashchange', onHashChange)
      if (result) {
        // 탭 실드(UI 스펙 §2): 버튼은 즉시 죽이고 DOM 제거만 300ms 늦춘다(iOS 더블탭
        // 인식 창 상한 — 한 프레임으로는 두 번째 탭이 도착하기 전에 오버레이가 이미
        // 없다). 마지막 자리 빠른 연타의 두 번째 탭이 이 오버레이에 삼켜져, 아래에
        // 렌더되는 화면(#/grade의 O/X 토글)에 떨어지지 않는다. resolve는 즉시다 —
        // settled 가드가 있어 「정확히 1회」 규약과 충돌하지 않는다.
        root.querySelectorAll('button').forEach((b) => (b.disabled = true))
        // id를 즉시 떼어 둔다 — 300ms 동안 옛 노드가 DOM에 남는 창에 새 게이트가 뜨면
        // 같은 id(pin-gate-title)가 잠시 둘이 되고, aria-labelledby는 문서에서 먼저
        // 나오는 쪽(사라져 가는 옛 노드)을 집는다. 옛 노드는 버튼이 전부 disabled인
        // 유령이라 이름을 잃어도 잃을 것이 없다.
        title.removeAttribute('id')
        setTimeout(() => root.remove(), 300)
      } else {
        root.remove()
      }
      resolve(result)
    }

    const push = (digit: string): void => {
      if (settled) return
      entered += digit
      paint()
      if (entered.length < expected.length) return
      if (entered === expected) {
        settle(true)
        return
      }
      entered = ''
      paint()
      // 비웠다가 다음 틱에 넣는다(UI 스펙 §2) — 같은 틱의 두 변경은 브라우저가 병합해
      // aria-live가 침묵할 수 있고, 그러면 연속 오답 2회째의 같은 문자열이 공지되지
      // 않는다.
      desc.textContent = ''
      setTimeout(() => {
        if (!settled) desc.textContent = '다시 입력해 주세요'
      }, 50)
    }
    const erase = (): void => {
      entered = entered.slice(0, -1)
      paint()
    }

    for (const key of ['1', '2', '3', '4', '5', '6', '7', '8', '9', '취소', '0', '←']) {
      const b = document.createElement('button')
      b.textContent = key
      if (key === '취소') b.addEventListener('click', () => settle(false))
      else if (key === '←') {
        b.setAttribute('aria-label', '한 자리 지우기')
        b.addEventListener('click', erase)
      } else
        b.addEventListener('click', () => {
          // 숫자 탭에만 진동(스프린트 키패드와 같은 규칙 — 취소·지우기는 안 울린다).
          // 물리 키보드 입력(onKey→push)은 제외 — 데스크톱에서 의미가 없다.
          hapticTap()
          push(key)
        })
      pad.append(b)
    }

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') settle(false)
      else if (e.key === 'Backspace') erase()
      else if (/^[0-9]$/.test(e.key)) push(e.key)
    }
    const onHashChange = (): void => settle(false)
    close.addEventListener('click', () => settle(false))
    document.addEventListener('keydown', onKey)
    window.addEventListener('hashchange', onHashChange)

    root.append(close, title, desc, dots, pad)
    document.body.append(root)
    root.focus() // 기존 input.focus()의 대체(UI 스펙 §2) — tabindex=-1 루트가 받는다
  })
  gateFlight = flight
  return flight
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

// ─────────── 지니 효과음 (Web Audio 합성 — 파일 에셋 없음) ───────────
// map.ts(램프 탭에서 깨움)와 genie.ts(재생)가 공유해서 여기 산다(ITEM_MARKS와 같은 근거).
// 모든 실패는 조용히 삼킨다 — 소리는 장식이고, 오디오가 없어도 연출은 계속돼야 한다.

let audioCtx: AudioContext | null = null

/**
 * 사용자 제스처 핸들러 안에서 불러 오디오를 깨워 둔다. iOS는 제스처 밖에서 만든
 * AudioContext를 suspended로 묶는다 — 램프 탭(제스처)에서 깨우면 이후 화면 전환
 * 뒤의 재생도 살아 있다. URL 직접 진입처럼 제스처가 없었으면 그냥 무음이다(장식).
 */
export function unlockAudio(): void {
  try {
    audioCtx ??= new AudioContext()
    if (audioCtx.state === 'suspended') void audioCtx.resume()
  } catch {
    audioCtx = null
  }
}

/** 펑 — 연기 터지는 노이즈 버스트 + 낮은 쿵. genie.ts가 연기 타이밍에 맞춰 부른다. */
export function playPoof(): void {
  if (audioCtx?.state !== 'running') return
  const ctx = audioCtx
  const t = ctx.currentTime
  const dur = 0.4
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length)
  const noise = ctx.createBufferSource()
  noise.buffer = buf
  const filter = ctx.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.setValueAtTime(1200, t)
  filter.frequency.exponentialRampToValueAtTime(200, t + dur)
  const noiseGain = ctx.createGain()
  noiseGain.gain.setValueAtTime(0.45, t)
  noiseGain.gain.exponentialRampToValueAtTime(0.001, t + dur)
  noise.connect(filter).connect(noiseGain).connect(ctx.destination)
  noise.start(t)
  const thump = ctx.createOscillator()
  thump.type = 'sine'
  thump.frequency.setValueAtTime(180, t)
  thump.frequency.exponentialRampToValueAtTime(60, t + 0.25)
  const thumpGain = ctx.createGain()
  thumpGain.gain.setValueAtTime(0.35, t)
  thumpGain.gain.exponentialRampToValueAtTime(0.001, t + 0.3)
  thump.connect(thumpGain).connect(ctx.destination)
  thump.start(t)
  thump.stop(t + 0.3)
}

/** 반짝 — 지니 등장의 마법 아르페지오(C5→E6, 5음 상승). */
export function playSparkle(): void {
  if (audioCtx?.state !== 'running') return
  const ctx = audioCtx
  const t = ctx.currentTime
  const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5]
  for (const [i, freq] of notes.entries()) {
    const start = t + i * 0.09
    const osc = ctx.createOscillator()
    osc.type = 'triangle'
    osc.frequency.setValueAtTime(freq, start)
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0, start)
    gain.gain.linearRampToValueAtTime(0.18, start + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.35)
    osc.connect(gain).connect(ctx.destination)
    osc.start(start)
    osc.stop(start + 0.35)
  }
}

// ─────────── 탭 햅틱 ───────────

let hapticSwitch: HTMLLabelElement | null = null

/**
 * 짧은 탭 진동 — 스프린트 숫자 키가 쓴다. **제스처 핸들러 안에서만 부를 것.**
 *
 * 안드로이드는 표준 Vibration API. 아이폰 사파리는 그 API가 없어서 iOS 17.4+가
 * 네이티브 스위치(checkbox[switch]) 토글에 내는 햅틱을 빌린다 — 숨긴 스위치를
 * 제스처 스택 안에서 click하면 진동만 남는다(비공식이지만 널리 쓰이는 기법이고,
 * 막히면 그냥 무음이 된다). 아이패드는 진동 모터가 없어 어느 경로든 자연히
 * 무음. 햅틱은 장식이라 모든 실패를 조용히 삼킨다.
 */
export function hapticTap(): void {
  try {
    if (navigator.vibrate) {
      navigator.vibrate(10)
      return
    }
    if (!hapticSwitch) {
      const input = document.createElement('input')
      input.type = 'checkbox'
      input.setAttribute('switch', '')
      hapticSwitch = document.createElement('label')
      hapticSwitch.ariaHidden = 'true'
      hapticSwitch.style.display = 'none'
      hapticSwitch.append(input)
      document.body.append(hapticSwitch)
    }
    hapticSwitch.click()
  } catch {
    hapticSwitch = null
  }
}

/**
 * 지니 입구 블록 — 상태 셋(engine/facts.ts의 genieState가 판정한다).
 *
 * - teaser: 실루엣 램프가 peak만큼 차오르고 계약 문구를 말한다. 탭하면 꿈틀 + 둘째 줄
 * - lit:    빛나는 초대. 탭하면 #/genie
 * - trophy: 가득 찬 램프(빛나지 않는다). 탭하면 #/genie — 지니는 나오되 소원을 다시
 *           약속하지 않는다. 누를 게 없는 죽은 블록을 두지 않는 이유이자, 아빠가 아이보다
 *           먼저 「소원 들어줬어요」를 눌러도 아이가 연출을 잃지 않는 이유다
 *
 * 지도(map.ts)와 스프린트 결과(sprint.ts)가 같은 블록을 쓴다 — ITEM_MARKS와 같은 이유로
 * 여기가 단일 출처다. **아이 소속 화면 전용**: navigate 목적지는 #/genie 하나뿐이라
 * 소속 불변식을 깨지 않는다. 부모 리포트에는 넣지 않는다(아이 말투·보상 연출).
 * 렌더 뒤 반드시 wireGenieEntry(root)로 핸들러를 붙일 것.
 */
export function genieEntryHtml(state: GenieState, peak: number): string {
  if (state === 'lit') {
    return `<button class="genie-lamp-invite" id="genie">🪔 램프를 문질러 봐!</button>`
  }
  if (state === 'trophy') {
    return `<button class="genie-trophy" id="genie">
              ${gaugeHtml(FACT_IDS.length, '요술 램프 — 소원을 들어줬어요')}
              <span class="genie-teaser-text">지니가 소원을 들어줬어</span>
            </button>`
  }
  return `<button class="genie-teaser" id="genie-teaser">
            ${gaugeHtml(peak, `요술 램프 — ${FACT_IDS.length}칸 중 ${peak}칸`)}
            <span class="genie-teaser-text">구구단 ${FACT_IDS.length}칸을 다 채우면 지니가 소원을 들어줘!</span>
          </button>`
}

/**
 * 램프 게이지 — 실루엣 위에 원색 램프를 겹치고 바닥부터 peak만큼만 보인다.
 *
 * clip-path를 SVG가 아니라 이 span에 건다. iOS Safari가 SVG 루트의 clip-path를 사용자
 * 좌표계로 해석한 이력이 있어, HTML 박스에 걸면 그 의문 자체가 사라진다.
 * aria-label은 여기(role="img")에 둔다 — 바깥 button에 두면 자손 이름을 통째로 대체해
 * 계약 문구가 낭독되지 않는다.
 *
 * label과 peak는 우리 리터럴과 숫자 연산의 결과뿐이라 이스케이프 경계가 아니다.
 * 사람이 입력한 문자열을 여기 넣지 말 것.
 */
function gaugeHtml(peak: number, label: string): string {
  return `<span class="genie-gauge" role="img" aria-label="${label}" style="--genie-clip:${lampClipTop(peak)}%">
            ${lampSvg('genie-gauge-base')}
            <span class="genie-gauge-fill" aria-hidden="true">${lampSvg('genie-gauge-lamp')}</span>
          </span>`
}

/** genieEntryHtml의 짝 — 초대·트로피는 #/genie로, 티저는 꿈틀 + 둘째 줄. */
export function wireGenieEntry(root: HTMLElement): void {
  root.querySelector('#genie')?.addEventListener('click', () => {
    // 제스처 안에서 오디오를 깨워야 다음 화면(#/genie)의 효과음이 난다(iOS).
    unlockAudio()
    navigate('#/genie')
  })
  const teaser = root.querySelector('#genie-teaser')
  teaser?.addEventListener('click', () => {
    hapticTap()
    // 애니메이션 재시작 트릭: 클래스를 뗐다 붙이는 사이에 리플로를 강제한다.
    teaser.classList.remove('poked')
    void (teaser as HTMLElement).offsetWidth
    teaser.classList.add('poked')
    // 계약 문구를 **교체하지 않는다** — 8살이 가장 먼저 하는 행동(램프 누르기)이 이
    // 블록의 존재 이유인 한 줄을 지우면 안 된다. 둘째 줄로 덧붙이고, 두 번째 탭부터는
    // 꿈틀만 한다.
    if (!teaser.querySelector('.genie-teaser-hint')) {
      const hint = document.createElement('span')
      hint.className = 'genie-teaser-hint'
      hint.textContent = '지니가 램프 안에서 기다리고 있어'
      teaser.querySelector('.genie-teaser-text')!.append(hint)
    }
  })
}

/**
 * lampSvg 그림의 세로 경계 — viewBox(0 0 220 110) 안에서 램프가 실제로 그려진 범위다.
 * 위 20%·아래 7%가 빈 공간이라, 게이지를 박스 기준으로 자르면 peak 1~5는 아무것도 안
 * 보이고 57~71은 이미 가득 차 보인다 — 게이지를 둔 이유(60→72 정체 구간을 견디게 한다)가
 * 바로 그 구간에서 무력해진다. **아래 SVG 경로를 고치면 이 세 값도 함께 고칠 것.**
 */
const LAMP_VIEW_H = 110
const LAMP_ART_TOP = 22
const LAMP_ART_BOTTOM = 102

/**
 * peak를 clip-path inset의 상단 %로. peak 0 → 92.7%(전부 가림) · 1 → 91.7% · 21 → 71.5% ·
 * 60 → 32.1% · 72 → 20.0%(전부 보임). 1칸은 그림 높이의 1/72이고 최소 두께를 만들지
 * 않는다 — 게이지가 실제보다 차 보이면 화면이 거짓말을 한다(원칙 3).
 */
function lampClipTop(peak: number): number {
  // 0칸은 그림을 통째로 가린다. 아래 식이 주는 92.7%는 그림 바닥(102/110 = 92.727%)보다
  // 소수점 한 자리만큼 위라, 반올림 때문에 바닥 한 줄이 새어 4배로 확대하면 보인다.
  if (peak <= 0) return 100
  const filled = Math.min(peak / FACT_IDS.length, 1)
  const top = LAMP_ART_TOP + (LAMP_ART_BOTTOM - LAMP_ART_TOP) * (1 - filled)
  return Math.round((1000 * top) / LAMP_VIEW_H) / 10
}

/**
 * 요술 램프 SVG — 지니 보상 화면(genie.ts)과 위 genieEntryHtml(티저)이 공유한다.
 * ITEM_MARKS와 같은 이유로 여기 산다: 화면끼리는 import하지 않고(형제), 화면
 * 테스트가 없어 사본이 어긋나도 잡을 수 없으므로 한 곳에서 export한다.
 * 실루엣(티저)은 이 마크업 그대로에 CSS filter만 얹는다 — 모양의 주인은 여기 하나.
 */
export function lampSvg(className: string): string {
  return `
    <svg class="${className}" viewBox="0 0 220 110" role="img" aria-label="요술 램프">
      <path d="M60 55 C 60 35, 150 35, 150 55 C 150 80, 120 92, 100 92 C 80 92, 60 80, 60 55 Z" fill="#f4b942" />
      <path d="M150 52 C 175 45, 195 35, 205 22 C 195 40, 180 55, 155 62 Z" fill="#f4b942" />
      <path d="M62 50 C 40 45, 38 70, 60 72" fill="none" stroke="#f4b942" stroke-width="8" stroke-linecap="round" />
      <ellipse cx="105" cy="38" rx="26" ry="8" fill="#e0a832" />
      <circle cx="105" cy="30" r="6" fill="#e0a832" />
      <path d="M85 92 L 125 92 L 118 102 L 92 102 Z" fill="#e0a832" />
      <path d="M80 55 q 10 -12 26 -8" stroke="#ffe9b0" stroke-width="6" fill="none" stroke-linecap="round" />
    </svg>
  `
}

/** "2026-08-02" → "8월 2일 토요일" */
export function formatDate(key: string, withYear = false): string {
  const [y, m, d] = key.split('-').map(Number)
  const date = new Date(y!, m! - 1, d!)
  const week = ['일', '월', '화', '수', '목', '금', '토'][date.getDay()]
  return `${withYear ? `${y}년 ` : ''}${m}월 ${d}일 ${week}요일`
}
