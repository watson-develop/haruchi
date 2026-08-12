import { getDay, getMeta, putDay, getAllDays } from '../data/db'
import { configured, pullAndWait } from '../data/sync'
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
import {
  confirmDialog,
  el,
  escapeHtml,
  formatDate,
  ITEM_MARKS,
  navigate,
  showError,
  toast,
} from '../ui'

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

/** 생성 게이트가 서버를 기다리는 상한(설계 §2 「재인쇄 동일성 — 생성 게이트」). 화면 표시용
 *  3초와 다른 값인 데 이유가 있다 — 여기서 못 기다리면 종이가 두 벌 생긴다. */
const GATE_TIMEOUT_MS = 15_000

/**
 * 오늘 sheet가 실재하는가. "빈 sheet도 없는 것"이라는 판정을 한 곳에만 둔다 —
 * 스프린트만 한 날은 `sheet: []`인 Day로 실재한다(CLAUDE.md 「빈 sheet가 실재한다」).
 *
 * **타입 서술어(`day is Day`)로 쓰지 않는다.** 그러면 거짓 가지에서 TypeScript가 값을
 * `undefined`로 좁히는데, 실제로는 "sheet만 빈 Day"가 거기 있을 수 있다 — 그 Day를
 * 놓치면 새 sheet를 쓰면서 같은 날의 스프린트·kind를 함께 버리게 된다.
 */
function hasSheet(day: Day | undefined): boolean {
  return day !== undefined && day.sheet.length > 0
}

/**
 * 오늘 문제지를 만들어야 하면 만든다 — **문항을 자동으로 쓰는 유일한 자리**(CLAUDE.md의
 * 재인쇄 동일성 불변식). 「다시 만들기」는 이 함수를 지나지 않는다: 그쪽은 아빠가 직접
 * 누르는 갈아 끼움이고 여기는 최초 기입이다.
 *
 * 설계 §2 「생성 게이트」의 네 단계가 그대로 있다:
 *
 * 1. 이미 있으면 아무것도 하지 않는다 — 재인쇄는 pull을 기다리지도 않는다(같은 종이다)
 * 2. pull을 전체 타임아웃으로 기다린다. 그 사이 오늘 sheet가 도착했으면 그것을 보여준다
 * 3. 서버를 확인하지 못했으면(`'failed'`) 경고하고 **명시적 진행 선택**을 요구한다.
 *    `'off'`는 경고하지 않는다 — 서버가 없으면 다른 기기도 없다(PullResult 주석)
 * 4. 확인을 통과해도 **쓰기 직전에 다시 읽는다.** 다이얼로그와 문항 조립 사이는 수 초고,
 *    그 사이 배경 pull이 다른 기기의 종이를 앉힐 수 있다
 *
 * 남는 창(둘이 동시에 만드는 밀리초)은 격리 배너가 받아낸다 — 무음으로 덮지 않는다.
 */
async function ensureSheet(root: HTMLElement, today: string): Promise<'ready' | 'cancelled'> {
  if (hasSheet(await getDay(today))) return 'ready'

  // 미설정 기기에서는 pullAndWait이 즉시 돌아온다 — 그 경우 이 알림도 만들지 않아야
  // 화면 전이가 오늘과 완전히 같다(설계: 동기화가 꺼져 있으면 앱은 오늘과 같다).
  //
  // 나갈 길을 함께 둔다. 서버가 매달리면 이 화면은 15초 동안 아무것도 하지 않는데,
  // 홈 화면 아이콘으로 띄운 스탠드얼론 PWA에는 주소창도 새로고침도 없다(ui.ts navigate
  // 주석). 나가도 게이트는 계속 돌고, 그 사이 화면을 떠났으면 renderPrint가 그리지 않는다.
  if (configured()) {
    root.replaceChildren(
      el(`
        <div>
          <p class="date">다른 기기에 오늘 문제지가 있는지 확인하고 있어요…</p>
          <button class="step" id="back">← 홈</button>
        </div>
      `),
    )
    root.querySelector('#back')!.addEventListener('click', () => navigate('#/parent'))
  }
  const pull = await pullAndWait(GATE_TIMEOUT_MS)
  if (hasSheet(await getDay(today))) return 'ready' // 다른 기기가 만든 오늘 종이가 도착했다

  if (pull.status === 'failed') {
    const go = await confirmDialog({
      title: '서버 확인이 안 됐어요',
      description: [
        '다른 기기에서 오늘 문제지를 이미 만들었다면 종이가 두 벌이 돼요.',
        '그래도 지금 만들까요?',
      ],
      confirmLabel: '그래도 만들기',
      tone: 'critical',
    })
    if (!go) return 'cancelled'
  }

  const sheet = await buildSheet()
  // 쓰기 직전 재검사. 위 조회 이후 여기까지 await가 여럿이고(다이얼로그·문항 조립)
  // 배경 pull은 그동안 계속 돈다 — 마지막으로 읽은 값 위에만 쓴다.
  const latest = await getDay(today)
  if (hasSheet(latest)) {
    toast('다른 기기에서 만든 오늘 문제지를 가져왔어요')
    return 'ready'
  }
  await putDay(
    latest ? { ...latest, sheet } : ({ date: today, kind: 'normal', sheet } satisfies Day),
    ['sheet'],
  )
  return 'ready'
}

/**
 * 생성이 겹치지 않게 한다. 배경 pull의 재렌더(main.ts의 onPullApplied)가 이 화면을 다시
 * 열 수 있고, 두 호출이 각자 "오늘 sheet 없음"을 보면 문항을 두 벌 만들어 나중 것이 앞
 * 것을 덮는다 — 그때 이미 인쇄된 종이가 있으면 재인쇄 동일성이 깨진다. 뒤에 온 호출은
 * 앞선 게이트가 끝나기를 기다렸다가 저장소를 다시 읽는다(모듈 스코프인 이유는
 * report.ts의 importBusy와 같다 — 재렌더마다 새 스코프가 열려도 하나의 진실이어야 한다).
 */
let gate: Promise<'ready' | 'cancelled'> | null = null

async function ensureSheetOnce(root: HTMLElement, today: string): Promise<'ready' | 'cancelled'> {
  if (gate) {
    await gate
    // 앞선 게이트의 판단(취소 포함)을 그대로 물려받지 않는다 — 저장소가 답을 들고 있다.
    return hasSheet(await getDay(today)) ? 'ready' : 'cancelled'
  }
  const running = ensureSheet(root, today)
  gate = running
  try {
    return await running
  } finally {
    if (gate === running) gate = null
  }
}

/**
 * 아빠가 생성 게이트에서 「취소」를 골랐다. 문제지는 만들어지지 않았고 그 사실을 화면이
 * 말해야 한다 — 부모 홈으로 돌려보내면 「문제지 인쇄」 버튼이 여전히 미완료로 보일 뿐
 * 이유를 말하지 않는다. 목적지는 둘 다 부모 소속이다.
 */
function renderNotMade(root: HTMLElement, today: string): void {
  root.replaceChildren(
    el(`
      <div>
        <p class="date">${formatDate(today, true)} 문제지를 아직 만들지 않았어요.</p>
        <p class="date">다른 기기에서 오늘 문제지를 만들었는지 확인한 뒤 다시 눌러 주세요.</p>
        <button class="step" id="retry">다시 시도</button>
        <button class="step" id="back">← 홈</button>
      </div>
    `),
  )
  root.querySelector('#retry')!.addEventListener('click', () => void renderPrint(root))
  root.querySelector('#back')!.addEventListener('click', () => navigate('#/parent'))
}

export async function renderPrint(root: HTMLElement): Promise<void> {
  const today = dayKey(new Date())

  try {
    // sheet가 빈 채로 저장된 날(예: 아직 채우지 않은 checkup day)도 새로 만든 적 없는
    // 날과 똑같이 취급한다 — 빈 문제지를 내지 않기 위함. 이미 채워진 sheet는 여기서
    // 절대 다시 만들지 않는다(재인쇄 시 채점 화면과 어긋나지 않도록). 기존 day가 있으면
    // sheet만 바꿔치기하고 나머지 필드(kind·grades·sprint·mood·doneAt)는 그대로 보존한다.
    // 게이트는 최대 15초를 기다리고 다이얼로그까지 띄운다 — 그동안 아빠가 화면을 떠날 수
    // 있다. 떠난 뒤에 그리면 다른 화면 위에 문제지를 덮어쓴다(sprint.ts·regen과 같은 가드).
    const at = location.hash
    const gated = await ensureSheetOnce(root, today)
    if (location.hash !== at) return
    if (gated === 'cancelled') {
      renderNotMade(root, today)
      return
    }
    const day = await getDay(today)
    if (!day) throw new Error('오늘 문제지를 읽지 못했어요')

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
          <div class="no-print" id="print-hint" style="margin-bottom:8px"></div>
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
    // iOS 홈 화면 앱(standalone)에서는 window.print()가 조용히 아무것도 하지 않는다 —
    // WebKit이 브라우저 크롬 밖에서 인쇄 UI를 내주지 않기 때문이고, 우리가 고칠 수 있는
    // 자리가 아니다(2026-08-12 아이폰 실측). 그래서 부르기는 그대로 부르되, 실패했을 때
    // 아빠가 막다른 길에 서지 않도록 우회로를 같은 화면에 적어 둔다. navigator.standalone은
    // iOS 전용 신호다 — display-mode 미디어 쿼리는 인쇄가 멀쩡한 안드로이드·데스크톱 PWA도
    // 함께 잡아 엉뚱한 곳에 안내를 띄운다.
    const iosStandalone = (navigator as { standalone?: boolean }).standalone === true
    root.querySelector('#print')!.addEventListener('click', () => {
      window.print()
      if (iosStandalone) {
        root
          .querySelector('#print-hint')!
          .replaceChildren(
            el(
              `<div class="banner seed-callout__root seed-callout__root--tone_warning"><span class="seed-callout__description seed-callout__description--tone_warning">인쇄 창이 안 뜨면 화면 아래 <b>공유</b> → <b>프린트</b>로 인쇄해 주세요 — 홈 화면 앱에서는 이 버튼이 동작하지 않아요.</span></div>`,
            ),
          )
      }
    })

    // 문항을 새로 뽑는 유일한 수단. 재인쇄 불변식("같은 날 문제지는 늘 같다")을
    // **아빠만** 깰 수 있게 둔다 — 종이가 이미 아이 손에 있는지는 코드가 알 수 없고,
    // 조용히 다시 만들면 종이와 채점 화면이 어긋나 기록이 오염된다. 채점까지 끝난
    // 날은 아예 거부한다: 그때는 이미 저장된 grades가 다른 문제에 붙어 버린다.
    root.querySelector('#regen')!.addEventListener('click', () => {
      const box = root.querySelector('#confirm')!
      if (day.grades && Object.keys(day.grades).length > 0) {
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
          // rewrite는 "이 종이로 서버를 갈아 끼우겠다"는 **부모의 명시적 의도**다(설계
          // 2단계 §2). 이 표식이 없으면 push는 서버에 다른 sheet가 있을 때 우회를
          // 추론하지 않고 그 날짜를 격리한다 — 여기가 그 의도를 찍는 두 곳 중 하나다
          // (다른 하나는 부모 홈 격리 배너의 「이 기기 종이 유지」). 위 자동 생성
          // (day.sheet가 비었을 때)에는 찍지 않는다: 최초 기입은 갈아 끼움이 아니다.
          .then((sheet) => putDay({ ...day, sheet }, ['sheet'], { rewrite: true }))
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
