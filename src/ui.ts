/** 상단 고정 에러 배너. 조용한 실패를 만들지 않는다. */
export function showError(message: string): void {
  let bar = document.querySelector<HTMLDivElement>('#error-bar')
  if (!bar) {
    bar = document.createElement('div')
    bar.id = 'error-bar'
    bar.className = 'error'
    document.body.prepend(bar)
  }
  bar.textContent = message
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
