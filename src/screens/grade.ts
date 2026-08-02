import { getDay, putDay } from '../data/db'
import { dayKey } from '../engine/dates'
import type { Day, Mood, SheetItem } from '../data/types'
import { el, navigate, showError } from '../ui'

/** 날짜 키 형식(YYYY-MM-DD)만 통과시킨다. 해시에서 온 값은 검증 없이 화면에 찍지 않는다. */
const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/

function label(item: SheetItem): string {
  if (item.kind === 'vertical') return `${item.a} ${item.op} ${item.b}`
  if (item.kind === 'inverse') {
    switch (item.template) {
      case 'a+?=c':
        return `${item.a} + □ = ${item.c}`
      case '?+b=c':
        return `□ + ${item.b} = ${item.c}`
      case 'a-?=c':
        return `${item.a} − □ = ${item.c}`
      case '?-b=c':
        return `□ − ${item.b} = ${item.c}`
    }
  }
  return item.kind
}

/** 종이에 찍힌 문항 번호(①②③…). print-sheet.ts와 같은 표를 쓴다. */
const ITEM_MARKS = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭'

/**
 * 문항 id → 종이에 찍힌 번호.
 *
 * print-sheet.ts는 세로셈을 먼저 다 찍고 그다음 □ 채우기를 찍으면서 번호를 이어 붙인다.
 * 여기서도 같은 순서로 매겨야 종이와 화면의 번호가 어긋나지 않는다 — day.sheet의
 * 원래 순서를 그대로 쓰지 않는 이유다(지금은 우연히 같지만, 그 가정에 기대지 않는다).
 * 종이에 찍히지 않는 종류의 문항은 번호를 갖지 않는다.
 */
function markMap(sheet: SheetItem[]): Map<string, string> {
  const printed = [
    ...sheet.filter((i) => i.kind === 'vertical'),
    ...sheet.filter((i) => i.kind === 'inverse'),
  ]
  const map = new Map<string, string>()
  printed.forEach((item, i) => map.set(item.id, ITEM_MARKS[i] ?? String(i + 1)))
  return map
}

const MOODS: { key: Mood; text: string }[] = [
  { key: 'easy', text: '😀 여유' },
  { key: 'ok', text: '😐 딱 맞음' },
  { key: 'hard', text: '😫 힘들어함' },
]

/** bodyHtml을 그려 넣고 그 안의 #back을 홈으로 연결한다. 실패 화면들이 공유하는 뼈대. */
function renderWithBack(root: HTMLElement, bodyHtml: string): void {
  root.replaceChildren(el(bodyHtml))
  root.querySelector('#back')!.addEventListener('click', () => navigate('#/'))
}

/**
 * 채점 화면. 모든 문항이 정답(⭕)이 기본값이고 틀린 것만 눌러 뒤집는다.
 * 보통 두세 번 탭이면 끝난다.
 */
export async function renderGrade(root: HTMLElement, date?: string): Promise<void> {
  // 해시로 들어온 date는 route()가 location.hash를 그대로 잘라 넘긴 값이라 임의의
  // 문자열(마크업 포함)일 수 있다. 날짜 키 형식이 아니면 원문을 절대 화면에 보간하지
  // 않고 곧장 "문제지 없음" 화면으로 떨어뜨린다.
  if (date !== undefined && !DATE_KEY_RE.test(date)) {
    renderWithBack(
      root,
      `
        <div>
          <h1>채점</h1>
          <p class="date">문제지가 없어요. 먼저 인쇄해주세요.</p>
          <button class="step" id="back">← 홈</button>
        </div>
      `,
    )
    return
  }

  const target = date ?? dayKey(new Date())

  try {
    const day = await getDay(target)

    if (!day) {
      renderWithBack(
        root,
        `
          <div>
            <h1>채점</h1>
            <p class="date">${target} 문제지가 없어요. 먼저 인쇄해주세요.</p>
            <button class="step" id="back">← 홈</button>
          </div>
        `,
      )
      return
    }

    const grades: Record<string, boolean> = {}
    for (const item of day.sheet) grades[item.id] = day.grades?.[item.id] ?? true
    let mood: Mood | undefined = day.mood

    root.replaceChildren(
      el(`
        <div>
          <h1>채점</h1>
          <div class="date">${target} · 틀린 것만 눌러주세요</div>
          <div id="rows"></div>
          <div class="date" style="margin-top:20px">오늘 어땠어?</div>
          <div class="moods">
            ${MOODS.map((m) => `<button class="mood" data-mood="${m.key}">${m.text}</button>`).join('')}
          </div>
          <button class="step" id="save">저장</button>
          <button class="step" id="back">← 홈</button>
        </div>
      `),
    )

    const rows = root.querySelector('#rows')!
    const marks = markMap(day.sheet)
    for (const item of day.sheet) {
      // 종이의 번호를 그대로 보여준다. 번호가 없으면 부모가 수식을 눈으로 맞춰야 하고,
      // 밤 7시에 비슷한 수식 여덟 개 사이에서 잘못 누르기 쉽다.
      const row = el(`
        <div class="grade-row">
          <span class="qnum">${marks.get(item.id) ?? ''}</span>
          <span class="q">${label(item)}</span>
          <span class="ans">${item.answer}</span>
          <button class="mark" data-id="${item.id}">⭕</button>
        </div>
      `)
      const button = row.querySelector<HTMLButtonElement>('.mark')!
      const paint = () => {
        const ok = grades[item.id]!
        button.textContent = ok ? '⭕' : '❌'
        button.classList.toggle('wrong', !ok)
      }
      button.addEventListener('click', () => {
        grades[item.id] = !grades[item.id]
        paint()
      })
      paint()
      rows.append(row)
    }

    const paintMoods = () => {
      root.querySelectorAll<HTMLButtonElement>('.mood').forEach((b) => {
        b.classList.toggle('on', b.dataset.mood === mood)
      })
    }
    root.querySelectorAll<HTMLButtonElement>('.mood').forEach((b) => {
      b.addEventListener('click', () => {
        mood = b.dataset.mood as Mood
        paintMoods()
      })
    })
    paintMoods()

    root.querySelector('#back')!.addEventListener('click', () => navigate('#/'))
    root.querySelector('#save')!.addEventListener('click', async () => {
      const updated: Day = { ...day, grades, mood, doneAt: new Date().toISOString() }
      try {
        await putDay(updated)
        navigate('#/')
      } catch (e) {
        showError(`채점을 저장하지 못했어요: ${(e as Error).message}`)
      }
    })
  } catch (e) {
    // getDay 조회 실패까지 전부 여기서 잡는다. #/grade로 직접 들어온 경우(북마크·새로고침·
    // 홈의 "채점이 안 됐어요" 배너) #app이 비어 있을 수 있으므로, 배너뿐 아니라 항상
    // 홈으로 돌아갈 수단을 #app에 남긴다 — print-sheet.ts와 같은 패턴.
    showError(`채점 화면을 열지 못했어요: ${(e as Error).message}`)
    renderWithBack(
      root,
      `
        <div>
          <button class="step" id="back" style="margin:0">← 홈</button>
        </div>
      `,
    )
  }
}
