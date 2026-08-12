import { getDay, putDay } from '../data/db'
import { dayKey, weekdayOf } from '../engine/dates'
import { STRATEGY_NAMES } from '../engine/strategy'
import type { Day, Mood, SheetItem } from '../data/types'
import { el, escapeHtml, formatDate, ITEM_MARKS, navigate, showError, toast } from '../ui'

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
  if (item.kind === 'strategy')
    return `${item.a} ${item.op} ${item.b} (${STRATEGY_NAMES[item.tag] ?? item.tag})`
  return `문장제 ${item.expression}`
}

/**
 * 문항 id → 종이에 찍힌 번호.
 *
 * print-sheet.ts는 세로셈을 먼저 다 찍고 그다음 □ 채우기를 찍으면서 번호를 이어 붙인다.
 * 여기서도 같은 순서로 매겨야 종이와 화면의 번호가 어긋나지 않는다 — day.sheet의
 * 원래 순서를 그대로 쓰지 않는 이유다(지금은 우연히 같지만, 그 가정에 기대지 않는다).
 * 모든 종류가 종이에 찍힌다(Phase 4) — 인쇄 순서(세로셈→역연산→전략→문장제)와
 * 여기 순서가 같아야 종이와 화면 번호가 어긋나지 않는다.
 *
 * 번호표 자체(ITEM_MARKS)는 ui.ts에서 가져온다 — 인쇄 화면과 사본을 두면 둘이 어긋나도
 * 알 길이 없다(화면 테스트가 없다). 여기서 지켜야 하는 것은 **순서**뿐이다.
 */
function markMap(sheet: SheetItem[]): Map<string, string> {
  const printed = [
    ...sheet.filter((i) => i.kind === 'vertical'),
    ...sheet.filter((i) => i.kind === 'inverse'),
    ...sheet.filter((i) => i.kind === 'strategy'),
    ...sheet.filter((i) => i.kind === 'word'),
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
  root.querySelector('#back')!.addEventListener('click', () => navigate('#/parent'))
}

/**
 * 채점이 진행 중인가 — 배경 pull이 이 화면을 다시 그려도 되는지의 유일한 근거
 * (설계 2단계 §2 「배경 pull 후 화면 갱신」의 예외). 참인 동안 화면에는 **저장되지 않은
 * O/X와 기분**이 메모리에만 있고, 재렌더는 그것을 통째로 버린다.
 *
 * 모듈 스코프인 이유는 report.ts의 importBusy와 같다 — renderGrade가 여러 번 불려도 하나의
 * 진실이 유지돼야 하고, 함수 지역이면 그 사실을 밖에서 물어볼 방법이 없다. DOM은 담지
 * 않는다(죽은 노드를 만지게 된다).
 *
 * 끄는 자리가 셋이다: 채점을 저장했을 때(더는 쥔 것이 없다), 문항이 없어 채점 화면 자체가
 * 서지 않을 때, 그리고 화면을 떠났을 때. 마지막 것이 없으면 부모가 채점을 중간에 두고
 * 나갔다가 나중에 돌아왔을 때 그 사이의 갱신이 전부 막힌다 — 그래서 모듈이 로드될 때 딱
 * 한 번 hashchange를 듣는다(렌더마다 붙이면 리스너가 쌓인다).
 */
let grading = false

export function isGrading(): boolean {
  return grading
}

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    if (!location.hash.startsWith('#/grade')) grading = false
  })
}

/**
 * 채점 화면. 모든 문항이 정답(○)이 기본값이고 틀린 것만 눌러 뒤집는다.
 * 보통 두세 번 탭이면 끝난다.
 */
export async function renderGrade(root: HTMLElement, date?: string): Promise<void> {
  // 이 렌더가 만들 화면이 채점을 쥐게 될지는 아직 모른다 — 아래에서 실제로 문항을 그린
  // 뒤에만 참으로 세운다. 여기 오는 경로는 해시 이동뿐이고(진행 중이면 재렌더가 막힌다)
  // 그때 이전 세션은 이미 끝났다.
  grading = false
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

    // 기록이 아예 없는 날뿐 아니라, 스프린트만 하고 문제지는 인쇄하지 않은 날(sheet가 빈
    // Day — sprint.ts가 만든다)도 여기로 떨어뜨린다. 그러지 않으면 손으로 친 해시로
    // 문항이 0개인 채점 화면에 들어가 저장까지 할 수 있고, 그 결과는 grades: {} 라
    // 여전히 미채점으로 남는다.
    if (!day || day.sheet.length === 0) {
      renderWithBack(
        root,
        `
          <div>
            <h1>채점</h1>
            <p class="date">${formatDate(target)} 문제지가 없어요. 먼저 인쇄해주세요.</p>
            <button class="step" id="back">← 홈</button>
          </div>
        `,
      )
      return
    }

    const grades: Record<string, boolean> = {}
    for (const item of day.sheet) grades[item.id] = day.grades?.[item.id] ?? true
    let mood: Mood | undefined = day.mood
    // 이 순간부터 저장되지 않은 채점이 메모리에 있다 — 배경 pull은 이 화면을 다시 그리지
    // 않는다(설계 §2). 기본값(전부 ○)뿐이어도 참이다: 어디까지가 아빠가 확인한 것인지
    // 화면 밖에서는 알 수 없다.
    grading = true

    root.replaceChildren(
      el(`
        <div>
          <h1>채점</h1>
          <div class="date">${formatDate(target)} · 틀린 것만 눌러주세요</div>
          <div id="rows"></div>
          <div class="date" style="margin-top:20px">오늘 어땠어? (다음 문제지부터 반영돼요)</div>
          <div class="moods seed-segmented-control__root" style="--segment-count:${MOODS.length}">
            <div class="seed-segmented-control__indicator" style="opacity:0"></div>
            ${MOODS.map((m) => `<button class="mood seed-segmented-control__item" data-mood="${m.key}">${m.text}</button>`).join('')}
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
      // label()은 전략 tag(STRATEGY_NAMES 조회 실패 시 tag 원문)·문장제 expression을
      // 그대로 담을 수 있다 — 둘 다 백업 가져오기로 임의 문자열이 될 수 있는 값이라
      // el()의 innerHTML에 들어가기 전에 escapeHtml을 거친다.
      //
      // answer(타입은 number)와 id(검증되는 것은 "문자열"이라는 사실뿐)도 같은 이유로
      // 이스케이프한다. 특히 id는 **속성값** 안에 들어가므로 따옴표 하나만 새어 나가도
      // 속성을 깨고 나온다(`x" onfocus="…" autofocus="` → 진짜 이벤트 핸들러가 붙는다).
      // marks의 값은 우리가 만든 ITEM_MARKS/인덱스라 이스케이프 대상이 아니다.
      // 문장제는 정답에 단위를 이어 붙인다(스펙 §6 "답 32개" — 아빠가 종이의
      // "답: ___ 개"와 눈으로 맞춘다). unit도 백업 경유 가능 문자열이라 이스케이프.
      const row = el(`
        <div class="grade-row">
          <span class="qnum">${marks.get(item.id) ?? ''}</span>
          <span class="q">${escapeHtml(label(item))}</span>
          <span class="ans">${escapeHtml(item.answer)}${item.kind === 'word' ? escapeHtml(item.unit) : ''}</span>
          <button
            class="mark seed-action-button seed-action-button--variant_neutralWeak seed-action-button--size_large"
            data-id="${escapeHtml(item.id)}"
          >○</button>
        </div>
      `)
      const button = row.querySelector<HTMLButtonElement>('.mark')!
      // 맞음은 연회색(neutralWeak), 틀림은 앱의 강조색인 주황(brandSolid)이다.
      //
      // 빨강(criticalSolid)을 쓰지 않는 이유: 빨강이 허용됐던 근거는 "채점 화면은
      // 부모 소속이라 아이가 안 본다" 하나뿐이었는데, 2026-08-05 실사용 확인 결과
      // "때따라 다르다"(리뷰 P3-2)였다. 아이가 볼 수 있는 화면이면 brand.md §3의
      // "아이 화면 빨강 금지"가 여기에도 걸린다 — 틀림은 벌이 아니다.
      //
      // 뜻은 글리프(○/✕)가 지고 색은 주목만 담당하므로, "부모가 훑을 때 오답이
      // 즉시 눈에 띈다"는 원래 의도는 그대로다. 기본값인 맞음을 가장 조용하게 둔
      // 것도 의도다 — 잘 푼 날 화면이 덩어리로 뒤덮이지 않는다.
      //
      // **감수한 것(2026-08-05 사용자 결정, 회색조 안과 실물 비교 후).** brand.md
      // §7 기준 ②는 브랜드 색을 "가장 중요한 액션에만" 쓰라고 하는데 채점 토글은
      // 거기 해당하지 않고, 현재 당근 주황 위 흰 글리프는 2.94:1로 §7 기준 ①(3:1)에
      // 근소하게 미달이다 — 아이 홈 큰 카드와 같은 수치이고 같은 원인(#f60 고정)이다.
      // 톤 일관성을 택했고, **브랜드 색을 고르는 날 §7 기준 ①이 3:1을 요구하므로
      // 이 지점도 함께 풀린다**(HANDOFF 대비 이월 항목에 묶어 뒀다). 브랜드 색이
      // 바뀌면 이 버튼은 토큰을 가리키므로 자동으로 따라온다.
      //
      // 이모지(⭕/❌)를 쓰지 않는 것이 핵심이다. 이모지는 자체 색을 가져 CSS color가
      // 듣지 않으므로, 배경만 바꾸면 연회색 칸 위에 빨간 동그라미가 그대로 남는다.
      const paint = () => {
        const ok = grades[item.id]!
        button.textContent = ok ? '○' : '✕'
        button.classList.remove(
          'seed-action-button--variant_neutralWeak',
          'seed-action-button--variant_brandSolid',
        )
        button.classList.add(
          ok ? 'seed-action-button--variant_neutralWeak' : 'seed-action-button--variant_brandSolid',
        )
      }
      button.addEventListener('click', () => {
        grades[item.id] = !grades[item.id]
        paint()
      })
      paint()
      rows.append(row)
    }

    // segmented-control 레시피의 선택 계약은 data-state="checked"가 아니라
    // [data-checked] 존재 여부다(설치본 CSS 확인 — :is(:checked, [data-checked])).
    // __indicator는 --segment-index로 스스로를 옮기므로 선택이 바뀔 때마다 갱신한다.
    // 아직 아무 기분도 안 골랐으면(day.mood 미설정) indicator를 숨긴다 — 안 그러면
    // 선택하지 않았는데도 첫 항목이 골라진 것처럼 보인다.
    const indicator = root.querySelector<HTMLElement>('.seed-segmented-control__indicator')!
    const paintMoods = () => {
      root.querySelectorAll<HTMLButtonElement>('.mood').forEach((b) => {
        b.toggleAttribute('data-checked', b.dataset.mood === mood)
      })
      const index = MOODS.findIndex((m) => m.key === mood)
      if (index === -1) {
        indicator.style.opacity = '0'
      } else {
        indicator.style.opacity = '1'
        indicator.style.setProperty('--segment-index', String(index))
      }
    }
    root.querySelectorAll<HTMLButtonElement>('.mood').forEach((b) => {
      b.addEventListener('click', () => {
        mood = b.dataset.mood as Mood
        paintMoods()
      })
    })
    paintMoods()

    root.querySelector('#back')!.addEventListener('click', () => navigate('#/parent'))
    root.querySelector('#save')!.addEventListener('click', async () => {
      const updated: Day = { ...day, grades, mood, doneAt: new Date().toISOString() }
      try {
        await putDay(updated, ['grades'])
        // 저장됐다 — 더는 메모리에만 있는 것이 없으므로 배경 pull의 재렌더를 막지 않는다.
        // 아래 navigate가 해시를 바꾸면 모듈 리스너도 같은 일을 하지만, 일요일이 아니어도
        // (같은 #/parent로 가도) 여기서 이미 참이 아니게 해 둔다.
        grading = false
        // toast는 body 소속이라 화면 전환(아래 navigate) 뒤에도 3초 떠 있다 — 전환
        // 자체가 피드백을 겸하지만 시선이 가는 곳이 아니다(리뷰 P2-5).
        toast('채점을 저장했어요', { tone: 'positive' })
        // 일요일 채점을 저장하면 주간 리포트로 간다(설계 §8) — 아빠가 "리포트 봐야지"를 기억할
        // 필요를 없앤다. 오늘이 아니라 **채점한 날**(target)의 요일을 본다: 일요일 것을 월요일에
        // 늦게 채점해도 그 주가 막 끝난 참이라 리포트가 맞는 행동이다.
        navigate(weekdayOf(target) === 0 ? '#/report' : '#/parent')
      } catch (e) {
        showError('채점을 저장하지 못했어요. 다시 눌러 주세요.', e)
      }
    })
  } catch (e) {
    grading = false // 화면이 서지 못했다 — 쥐고 있는 채점도 없다
    // getDay 조회 실패까지 전부 여기서 잡는다. #/grade로 직접 들어온 경우(북마크·새로고침·
    // 홈의 "채점이 안 됐어요" 배너) #app이 비어 있을 수 있으므로, 배너뿐 아니라 항상
    // 홈으로 돌아갈 수단을 #app에 남긴다 — print-sheet.ts와 같은 패턴.
    showError('채점 화면을 열지 못했어요.', e)
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
