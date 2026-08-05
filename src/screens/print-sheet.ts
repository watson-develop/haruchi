import { getDay, getMeta, putDay, getAllDays } from '../data/db'
import { dayKey } from '../engine/dates'
import {
  deriveTypes,
  deriveStrategies,
  deriveLastSeen,
  deriveVerticalCount,
} from '../engine/derive'
import { deriveFacts } from '../engine/facts'
import { composeSheet } from '../engine/compose'
import { STRATEGY_NAMES } from '../engine/strategy'
import type { Day, InverseItem, StrategyItem, VerticalItem, WordItem } from '../data/types'
import { el, escapeHtml, formatDate, ITEM_MARKS, navigate, showError } from '../ui'

/**
 * 문항의 수·기호는 전부 escapeHtml을 거친다 — 타입은 number여도 백업 가져오기로
 * 임의 문자열이 들어올 수 있기 때문이다(validateBackup은 sheet 항목의 id·kind만 본다).
 * 이 파일에서 escapeHtml 없이 템플릿에 들어가는 값은 우리가 만든 리터럴뿐이어야 한다.
 */
function digits(n: number): string {
  return String(n)
    .padStart(3, ' ')
    .split('')
    .map((c) => `<i>${c === ' ' ? '' : escapeHtml(c)}</i>`)
    .join('')
  // 한 글자씩 <i>로 감싸므로 태그가 만들어지지는 않지만, 안전 여부를 "고립된 <는
  // 파서가 글자로 취급한다"는 세부 동작에 기대게 두지 않는다.
}

function verticalHtml(item: VerticalItem, index: number): string {
  return `
    <div class="vprob">
      <span class="vnum">${ITEM_MARKS[index] ?? index + 1}</span>
      <div class="vcalc">
        <div class="vcarry"></div>
        <div class="vline"><b></b>${digits(item.a)}</div>
        <div class="vline"><b>${escapeHtml(item.op)}</b>${digits(item.b)}</div>
        <div class="vrule"></div>
        <div class="vans"></div>
      </div>
    </div>`
}

function inverseHtml(item: InverseItem, index: number): string {
  const box = '<span class="inv-box"></span>'
  const a = escapeHtml(item.a)
  const b = escapeHtml(item.b)
  const c = escapeHtml(item.c)
  const eq =
    item.template === 'a+?=c'
      ? `${a} + ${box} = ${c}`
      : item.template === '?+b=c'
        ? `${box} + ${b} = ${c}`
        : item.template === 'a-?=c'
          ? `${a} − ${box} = ${c}`
          : `${box} − ${b} = ${c}`
  return `
    <div class="inv">
      <div class="inv-eq"><span class="n">${ITEM_MARKS[index] ?? index + 1}</span>${eq}</div>
      ${item.hint ? `<div class="inv-hint">${escapeHtml(item.hint)}</div>` : ''}
    </div>`
}

/**
 * 전략 문항. steps의 {}를 손글씨 빈칸으로 치환한다 — 렌더러는 전략 종류를 모른다.
 * steps[].text는 백업 가져오기로 임의 문자열일 수 있어 이스케이프한다(치환 전에 —
 * 치환 후에 하면 우리가 만든 <span>까지 이스케이프된다).
 */
function strategyHtml(item: StrategyItem, index: number): string {
  const rows = item.steps
    .map(
      (s) =>
        `<div class="strat-step">${escapeHtml(s.text).replaceAll('{}', '<span class="strat-blank"></span>')}</div>`,
    )
    .join('')
  return `
    <div class="strat">
      <div class="strat-head">
        <span class="n">${ITEM_MARKS[index] ?? index + 1}</span>
        <span class="strat-expr">${escapeHtml(item.a)} ${escapeHtml(item.op)} ${escapeHtml(item.b)}</span>
        <span class="strat-name">${escapeHtml(STRATEGY_NAMES[item.tag] ?? item.tag)}</span>
      </div>
      ${rows}
    </div>`
}

/** 문장제. text·unit은 백업 경유 가능 값이라 이스케이프. 정답은 인쇄하지 않는다. */
function wordHtml(item: WordItem, index: number): string {
  return `
    <div class="word">
      <div class="word-text"><span class="n">${ITEM_MARKS[index] ?? index + 1}</span>${escapeHtml(item.text)}</div>
      ${
        // 라벨 없는 빈 네모는 아이에게 "여기 뭘 하라는 건지" 알려주지 못한다 —
        // 아빠가 먼저 이유를 물었다(2026-08-04). 이 칸의 목적(설계 §6.5: 묶어 세기를
        // 그림으로 나타내기)을 종이 위에서 말해 준다.
        item.needsDrawing
          ? '<div class="word-canvas-label">묶어 세기를 그림으로 나타내 보세요</div><div class="word-canvas"></div>'
          : ''
      }
      <div class="word-answer">
        <div class="word-row"><span class="word-label">식</span><u class="word-line"></u></div>
        <div class="word-row"><span class="word-label">답</span><u class="word-line short"></u> ${escapeHtml(item.unit)}</div>
      </div>
    </div>`
}

/**
 * 오늘 문제지를 연다.
 * 이미 만들어진 날이면 저장된 sheet를 그대로 렌더한다 — 재인쇄 시 문제가 달라지면
 * 채점 화면이 어느 종이 기준인지 알 수 없게 된다.
 */
/** 오늘 상태로 문항을 새로 뽑는다. 저장은 하지 않는다 — 부르는 쪽이 정한다. */
async function buildSheet(): Promise<Day['sheet']> {
  const meta = await getMeta()
  const days = await getAllDays()
  const types = deriveTypes(days)
  const strategies = deriveStrategies(days)
  const facts = deriveFacts(days, meta.settings.fluentMs)
  return composeSheet({
    // 세로셈 문항 수는 설정이 아니라 mood 로그의 파생이다(설계 §6.8 ②,
    // derive.ts의 deriveVerticalCount 주석 참고). home-parent.ts의 문항 수
    // 라벨도 같은 파생을 쓴다 — 한쪽만 바꾸면 화면이 거짓말한다.
    settings: { ...meta.settings, verticalCount: deriveVerticalCount(days) },
    types,
    strategies,
    facts,
    lastSeen: deriveLastSeen(days),
    today: dayKey(new Date()),
  })
}

export async function renderPrint(root: HTMLElement): Promise<void> {
  const today = dayKey(new Date())

  try {
    let day = await getDay(today)

    // sheet가 빈 채로 저장된 날(예: 아직 채우지 않은 checkup day)도 새로 만든 적 없는
    // 날과 똑같이 취급한다 — 빈 문제지를 내지 않기 위함. 이미 채워진 sheet는 여기서
    // 절대 다시 만들지 않는다(재인쇄 시 채점 화면과 어긋나지 않도록). 기존 day가 있으면
    // sheet만 바꿔치기하고 나머지 필드(kind·grades·sprint·mood·doneAt)는 그대로 보존한다.
    if (!day || day.sheet.length === 0) {
      const sheet = await buildSheet()
      day = day ? { ...day, sheet } : ({ date: today, kind: 'normal', sheet } satisfies Day)
      await putDay(day)
    }

    const verticals = day.sheet.filter((i): i is VerticalItem => i.kind === 'vertical')
    const inverses = day.sheet.filter((i): i is InverseItem => i.kind === 'inverse')
    const strategies = day.sheet.filter((i): i is StrategyItem => i.kind === 'strategy')
    const words = day.sheet.filter((i): i is WordItem => i.kind === 'word')

    // Phase 4 배포 직전에 만들어진 날은 sheet에 전략·문장제가 없다(10문항, 구 버전
    // composeSheet). 그런 옛 sheet를 재인쇄할 때 빈 2장을 뽑지 않도록, 두 종류가
    // 하나도 없으면 2장 자체를 만들지 않는다. 빈 sheet([])도 같은 조건으로 걸린다.
    const page2 =
      strategies.length + words.length > 0
        ? `
      <div class="sheet">
        <div class="sheet-head">
          <div>
            <div class="sheet-title">하루치 · 2장</div>
            <div class="sheet-date">${formatDate(today, true)}</div>
          </div>
          <div class="sheet-name">이름 <u></u></div>
        </div>
        <div class="sheet-sec">3. 방법을 따라 풀어 보세요.</div>
        <div class="strat-zone">
          <div class="strat-zone-label">천천히 생각하는 칸</div>
          ${strategies.map((s, i) => strategyHtml(s, verticals.length + inverses.length + i)).join('')}
        </div>
        <div class="sheet-sec" style="margin-top:14px">4. 읽고 답해 보세요.</div>
        ${words.map((w, i) => wordHtml(w, verticals.length + inverses.length + strategies.length + i)).join('')}
      </div>`
        : ''

    root.replaceChildren(
      el(`
        <div>
          <div class="no-print" style="display:flex;gap:8px;margin-bottom:8px">
            <button class="step" id="back" style="margin:0">← 홈</button>
            <button class="step" id="print" style="margin:0">인쇄하기</button>
            <button class="step danger" id="regen" style="margin:0 0 0 auto">다시 만들기</button>
          </div>
          <div class="no-print" id="confirm" style="margin-bottom:16px"></div>
          <div class="sheet">
            <div class="sheet-head">
              <div>
                <div class="sheet-title">하루치 · 1장</div>
                <div class="sheet-date">${formatDate(today, true)}</div>
              </div>
              <div class="sheet-name">이름 <u></u></div>
            </div>
            <div class="sheet-sec">1. 계산해 보세요.</div>
            <div class="vgrid">${verticals.map((v, i) => verticalHtml(v, i)).join('')}</div>
            <div class="sheet-sec" style="margin-top:14px">2. □ 안에 알맞은 수를 써넣으세요.</div>
            ${inverses.map((v, i) => inverseHtml(v, verticals.length + i)).join('')}
          </div>
          ${page2}
        </div>
      `),
    )

    root.querySelector('#back')!.addEventListener('click', () => navigate('#/parent'))
    root.querySelector('#print')!.addEventListener('click', () => window.print())

    // 문항을 새로 뽑는 유일한 수단. 재인쇄 불변식("같은 날 문제지는 늘 같다")을
    // **아빠만** 깰 수 있게 둔다 — 종이가 이미 아이 손에 있는지는 코드가 알 수 없고,
    // 조용히 다시 만들면 종이와 채점 화면이 어긋나 기록이 오염된다. 채점까지 끝난
    // 날은 아예 거부한다: 그때는 이미 저장된 grades가 다른 문제에 붙어 버린다.
    root.querySelector('#regen')!.addEventListener('click', () => {
      const box = root.querySelector('#confirm')!
      if (day!.grades && Object.keys(day!.grades).length > 0) {
        box.replaceChildren(
          el(
            `<div class="banner seed-callout__root seed-callout__root--tone_warning"><span class="seed-callout__description seed-callout__description--tone_warning">이미 채점한 날이라 다시 만들 수 없어요 — 채점 결과가 다른 문제에 붙게 돼요.</span></div>`,
          ),
        )
        return
      }
      box.replaceChildren(
        el(`
          <div class="banner seed-callout__root seed-callout__root--tone_warning">
            <div class="seed-callout__content">
              <span class="seed-callout__description seed-callout__description--tone_warning">문항을 새로 뽑습니다. <strong>이미 인쇄해서 아이가 풀고 있다면 종이와 달라져요.</strong></span><br />
              <button class="step" id="regen-yes">새로 만들기</button>
              <button class="step" id="regen-no">취소</button>
            </div>
          </div>
        `),
      )
      box.querySelector('#regen-no')!.addEventListener('click', () => box.replaceChildren())
      box.querySelector('#regen-yes')!.addEventListener('click', () => {
        const at = location.hash
        buildSheet()
          .then((sheet) => putDay({ ...day!, sheet }))
          .then(() => {
            // 화면을 떠난 뒤 도착한 응답이 남의 화면을 덮어쓰지 않게 한다(sprint.ts와 같은 가드).
            if (location.hash !== at) return
            return renderPrint(root)
          })
          .catch((e) => showError('문제지를 다시 만들지 못했어요.', e))
      })
    })
  } catch (e) {
    // getDay 조회 실패부터 문항 생성·저장 실패까지 전부 여기서 잡는다. #/print로 직접
    // 들어온 경우(북마크·새로고침) #app이 비어 있을 수 있으므로, 배너뿐 아니라 항상
    // 홈으로 돌아갈 수단을 #app에 남긴다.
    showError('문제지를 만들지 못했어요.', e)
    root.replaceChildren(
      el(`
        <div>
          <button class="step" id="back" style="margin:0">← 홈</button>
        </div>
      `),
    )
    root.querySelector('#back')!.addEventListener('click', () => navigate('#/parent'))
  }
}
