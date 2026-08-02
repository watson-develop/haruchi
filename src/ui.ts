/**
 * 상단 고정 에러 배너. 조용한 실패를 만들지 않는다.
 * 닫기(✕)를 함께 붙인다 — 배너를 지울 수단이 없으면 해결된 실패가 계속 참인 척한다.
 */
export function showError(message: string): void {
  let bar = document.querySelector<HTMLDivElement>('#error-bar')
  if (!bar) {
    bar = document.createElement('div')
    bar.id = 'error-bar'
    bar.className = 'error'

    const text = document.createElement('span')
    text.className = 'error-text'
    bar.append(text)

    const dismiss = document.createElement('button')
    dismiss.className = 'error-dismiss'
    dismiss.textContent = '✕'
    dismiss.setAttribute('aria-label', '오류 알림 닫기')
    dismiss.addEventListener('click', clearError)
    bar.append(dismiss)

    document.body.prepend(bar)
  }
  bar.querySelector('.error-text')!.textContent = message
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

export function navigate(hash: string): void {
  location.hash = hash
}

/** HTML 문자열을 엘리먼트 하나로 만든다. */
export function el(html: string): HTMLElement {
  const t = document.createElement('template')
  t.innerHTML = html.trim()
  return t.content.firstElementChild as HTMLElement
}

/** "2026-08-02" → "8월 2일 토요일" */
export function formatDate(key: string, withYear = false): string {
  const [y, m, d] = key.split('-').map(Number)
  const date = new Date(y!, m! - 1, d!)
  const week = ['일', '월', '화', '수', '목', '금', '토'][date.getDay()]
  return `${withYear ? `${y}년 ` : ''}${m}월 ${d}일 ${week}요일`
}
