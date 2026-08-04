/**
 * 상단 고정 에러 배너. 조용한 실패를 만들지 않는다.
 * 닫기(✕)를 함께 붙인다 — 배너를 지울 수단이 없으면 해결된 실패가 계속 참인 척한다.
 */
export function showError(message: string): void {
  let bar = document.querySelector<HTMLDivElement>('#error-bar')
  if (!bar) {
    bar = document.createElement('div')
    bar.id = 'error-bar'
    // .overlay는 인쇄에서 숨겨지는 유일한 표식이다(print.css의 @media print).
    // 새 오버레이를 만들 때마다 이 클래스를 붙이면 종이 오염이 구조로 막힌다.
    bar.className = 'overlay seed-callout__root seed-callout__root--tone_critical'
    bar.setAttribute('role', 'alert')

    const text = document.createElement('span')
    text.className = 'error-text seed-callout__description'
    bar.append(text)

    const dismiss = document.createElement('button')
    dismiss.className = 'error-dismiss seed-callout__closeButton'
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
