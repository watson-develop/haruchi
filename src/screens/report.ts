import { getAllDays, getMeta } from '../data/db'
import { dayKey } from '../engine/dates'
import { deriveFacts, FACT_IDS } from '../engine/facts'
import { weeklyReport, latestCheckupReport } from '../engine/report'
import type { WeeklyReport } from '../engine/report'
import { STRATEGY_CATALOG, STRATEGY_NAMES } from '../engine/strategy'
import { factMapHtml } from './fact-map'
import { el, escapeHtml, formatDate, navigate, showError } from '../ui'

/** 유형 태그 → 아빠용 라벨. vertical.ts SPECS·types.ts InverseTag와 1:1이다.
 *  전략 8종은 손으로 옮겨 적지 않는다 — STRATEGY_NAMES(strategy.ts)를 스프레드한다.
 *  이름의 단일 출처는 카탈로그다: 이름이 바뀌면 여기가 아니라 거기만 고치면 된다. */
const TAG_LABELS: Record<string, string> = {
  'add2-nocarry': '받아올림 없는 두 자리 덧셈',
  'sub2-noborrow': '받아내림 없는 두 자리 뺄셈',
  'add2-carry': '받아올림 두 자리 덧셈',
  'sub2-borrow': '받아내림 두 자리 뺄셈',
  'add3-carry1': '세 자리 덧셈 (올림 1번)',
  'add3-carry2': '세 자리 덧셈 (올림 2번)',
  'sub3-borrow1': '세 자리 뺄셈 (내림 1번)',
  'sub3-borrow2': '세 자리 뺄셈 (내림 2번)',
  'sub-zero': '0이 낀 받아내림',
  'inverse-add': '□ 채우기 덧셈',
  'inverse-sub': '□ 채우기 뺄셈',
  ...STRATEGY_NAMES,
}

const sec = (ms: number) => `${(ms / 1000).toFixed(1)}초`

function shareText(w: WeeklyReport, today: string): string {
  const lines = [
    `하루치 주간 리포트 — ${formatDate(today, true)}`,
    `🔥 ${w.streak}일 연속 · ✅ ${w.completed}일 완료`,
    // 분모는 engine/facts.ts의 풀 정의(FACT_IDS)에서 유도한다 — 리터럴 "72"를 두면
    // 풀 경계가 바뀌는 날 이 문구만 조용히 틀린 값을 보여준다.
    `구구단 ${w.fluentTotal}/${FACT_IDS.length} 정복${w.newlyFluent.length > 0 ? ` (이번 주 +${w.newlyFluent.length})` : ''}`,
    // 분모는 마찬가지로 strategy.ts의 카탈로그(STRATEGY_CATALOG)에서 유도한다 — 전략이
    // 늘어나는 날 리터럴 "8"만 조용히 틀려지는 것을 막는다.
    `배운 방법 ${w.strategiesLearned} / ${STRATEGY_CATALOG.length}`,
  ]
  if (w.weekMedianMs !== null) {
    const prev = w.prevWeekMedianMs !== null ? ` (지난주 ${sec(w.prevWeekMedianMs)})` : ''
    lines.push(`반응시간 중앙값 ${sec(w.weekMedianMs)}${prev}`)
  }
  return lines.join('\n')
}

function weeklyHtml(w: WeeklyReport, mapHtml: string): string {
  const delta =
    w.weekMedianMs !== null && w.prevWeekMedianMs !== null
      ? w.prevWeekMedianMs - w.weekMedianMs
      : null
  const speedLine =
    w.weekMedianMs === null
      ? '이번 주 스프린트 기록이 아직 없어요'
      : delta !== null && delta >= 50
        ? `지난주보다 ${sec(delta)} 빨라졌어요 🚀 (중앙값 ${sec(w.weekMedianMs)})`
        : `반응시간 중앙값 ${sec(w.weekMedianMs)}`
  const typeRows = w.types
    .map((t) => {
      // TAG_LABELS에 없는 태그는 t.tag 원문이 그대로 라벨이 된다. 이 태그는 백업 파일의
      // sheet[].tag에서 온 값일 수 있는데 validateBackup은 그 필드를 검사하지 않는다
      // (스펙 §11 결정 — 검증은 타입만, 렌더 지점에서 이스케이프). el()이 innerHTML을
      // 쓰므로 여기서 반드시 이스케이프한다.
      const label = escapeHtml(TAG_LABELS[t.tag] ?? t.tag)
      const pct = t.pct === null ? '표본 부족' : `${Math.round(t.pct * 100)}%`
      return `<li>${t.warn ? '⚠️ ' : ''}${label} — ${pct}</li>`
    })
    .join('')
  return `
    <div class="streak">🔥 ${w.streak}일 연속 &nbsp;·&nbsp; ✅ ${w.completed}일 완료</div>
    <p>배운 방법 ${w.strategiesLearned} / ${STRATEGY_CATALOG.length}</p>
    ${w.newlyFluent.length > 0 ? `<p>이번 주 새로 정복: ${w.newlyFluent.join(', ')}</p>` : ''}
    ${mapHtml}
    <p>${speedLine}</p>
    ${
      w.slowest
        ? // w.slowest.fact는 백업 파일의 sprint[].fact에서 올 수 있다 — validateBackup은
          // typeof === 'string'만 보고 형식은 검사하지 않는다. el()이 innerHTML을 쓰므로
          // 여기서 반드시 이스케이프한다.
          `<p>가장 느린 식: ${escapeHtml(w.slowest.fact)} (${sec(w.slowest.medianMs)})</p>`
        : ''
    }
    ${w.types.length > 0 ? `<h3>유형별 정답률</h3><ul class="report-types">${typeRows}</ul>` : ''}
    ${w.nextCheckup ? `<p>다음 점검의 날: ${formatDate(w.nextCheckup)}</p>` : ''}
    ${
      w.exportOverdue
        ? // 되돌릴 수 없는 삭제는 아니지만 서버 사본이 없는 이 앱에서 유일한 안전망이
          // 낡아간다는 주의 신호다 — tone은 warning(print-sheet.ts의 재인쇄 경고와 동일 선례).
          `<div class="banner seed-callout__root seed-callout__root--tone_warning"><span class="seed-callout__description seed-callout__description--tone_warning">백업한 지 30일이 넘었어요 — 데이터·기기 관리에서 내보내기를 눌러주세요</span></div>`
        : ''
    }
  `
}

export async function renderReport(root: HTMLElement): Promise<void> {
  try {
    const meta = await getMeta()
    const days = await getAllDays()
    const today = dayKey(new Date())
    const w = weeklyReport(days, meta, today)
    const facts = deriveFacts(days, meta.settings.fluentMs)
    const c = latestCheckupReport(days, meta.settings.fluentMs)

    root.replaceChildren(
      el(`
        <div>
          <h1>리포트</h1>
          <div class="date">${formatDate(today, true)}</div>
          <h2>이번 주</h2>
          ${weeklyHtml(w, factMapHtml(facts, new Set(w.newlyFluent), { window: 'week' }))}
          ${
            c
              ? `
            <h2>월간 — ${formatDate(c.date)} 점검</h2>
            <p>점검한 ${c.tested}개 중 유지 ${c.kept.length} · 다시 연습 ${c.dropped.length}</p>
            ${
              c.dropped.length > 0
                ? `<p>다시 연습할 식: ${c.dropped.join(', ')} — 다음 스프린트가 자동으로 다뤄요</p>`
                : ''
            }
            ${
              c.medianMs !== null
                ? `<p>점검 반응시간 ${sec(c.medianMs)}${c.prevMedianMs !== null ? ` (지난 점검 ${sec(c.prevMedianMs)})` : ''}</p>`
                : ''
            }
          `
              : ''
          }
          ${typeof navigator.share === 'function' ? '<button class="step" id="share">공유하기</button>' : ''}
          <button class="step" id="manage">데이터·기기 관리<small>내보내기·가져오기·기기 연결</small></button>
          <button class="step" id="back">← 홈</button>
        </div>
      `),
    )

    root.querySelector('#back')!.addEventListener('click', () => navigate('#/parent'))
    // 데이터 관리는 2026-08-13에 #/manage로 떠났다(기기 상한 설계 §3 — 사용자 결정:
    // 리포트 안의 절이 아니라 별도 메뉴). 여기 남은 것은 진입 버튼 하나다.
    root.querySelector('#manage')!.addEventListener('click', () => navigate('#/manage'))
    root.querySelector('#share')?.addEventListener('click', () => {
      // 사용자가 공유 시트를 닫는 것은 실패가 아니다(AbortError) — 조용히 무시한다.
      navigator.share({ text: shareText(w, today) }).catch(() => {})
    })
  } catch (e) {
    showError('리포트를 열지 못했어요.', e)
    root.replaceChildren(el(`<div><button class="step" id="back">← 홈</button></div>`))
    root.querySelector('#back')!.addEventListener('click', () => navigate('#/parent'))
  }
}
