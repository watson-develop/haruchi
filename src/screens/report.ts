import { getAllDays, getMeta } from '../data/db'
import { dayKey } from '../engine/dates'
import { deriveFacts, FACT_IDS } from '../engine/facts'
import { weeklyReport, latestCheckupReport, wordReport } from '../engine/report'
import type { WeeklyReport, WordReport } from '../engine/report'
import { WORD_GROUP_LABELS, WORD_TYPE_LABELS } from '../engine/word'
import type { FailedStep } from '../engine/word'
import { el, escapeHtml, factMapHtml, formatDate, navigate, showError } from '../ui'

const sec = (ms: number) => `${(ms / 1000).toFixed(1)}초`

function shareText(w: WeeklyReport, wr: WordReport, today: string): string {
  const lines = [
    `하루치 주간 리포트 — ${formatDate(today, true)}`,
    `🔥 ${w.streak}일 연속`,
    // 분모는 engine/facts.ts의 풀 정의(FACT_IDS)에서 유도한다 — 리터럴 "72"를 두면
    // 풀 경계가 바뀌는 날 이 문구만 조용히 틀린 값을 보여준다.
    `구구단 ${w.fluentTotal}/${FACT_IDS.length} 정복${w.newlyFluent.length > 0 ? ` (이번 주 +${w.newlyFluent.length})` : ''}`,
  ]
  if (w.weekMedianMs !== null) {
    const prev = w.prevWeekMedianMs !== null ? ` (지난주 ${sec(w.prevWeekMedianMs)})` : ''
    lines.push(`반응시간 중앙값 ${sec(w.weekMedianMs)}${prev}`)
  }
  if (wr.weekTotal > 0) {
    const weak = wr.groups.flatMap((g) => g.weak.map((t) => typeLabel(t.type)))
    lines.push(
      `문장제 ${wr.weekCorrect}/${wr.weekTotal}${weak.length > 0 ? ` · 약한 유형: ${weak.join(', ')}` : ''}`,
    )
  }
  return lines.join('\n')
}

/**
 * 숫자 한 칸. 리포트는 **읽는 화면**이라 숫자가 곧 내용이다 — 재구성 전에는 이것들이
 * 전부 같은 무게의 `<p>` 문단으로 쌓여 있어서 무엇이 중요한지가 사라졌다.
 * `value`·`label`은 이미 이스케이프된 마크업이어야 한다.
 */
function stat(value: string, label: string): string {
  return `<div class="stat"><span class="stat-v">${value}</span><span class="stat-k">${label}</span></div>`
}

function weeklyHtml(w: WeeklyReport, mapHtml: string): string {
  const delta =
    w.weekMedianMs !== null && w.prevWeekMedianMs !== null
      ? w.prevWeekMedianMs - w.weekMedianMs
      : null

  return `
    <div class="stats">
      ${stat(`${w.streak}일`, '🔥 연속')}
      ${stat(w.weekMedianMs === null ? '—' : sec(w.weekMedianMs), '반응시간')}
    </div>
    ${
      w.weekMedianMs === null
        ? '<p class="rnote">이번 주 스프린트 기록이 아직 없어요</p>'
        : delta !== null && delta >= 50
          ? `<p class="rnote">지난주보다 ${sec(delta)} 빨라졌어요 🚀</p>`
          : ''
    }
    ${mapHtml}
    ${w.newlyFluent.length > 0 ? `<p class="rnote">이번 주 새로 정복 — ${w.newlyFluent.join(', ')}</p>` : ''}
    ${
      w.slowest
        ? // w.slowest.fact는 백업 파일의 sprint[].fact에서 올 수 있다 — validateBackup은
          // typeof === 'string'만 보고 형식은 검사하지 않는다. el()이 innerHTML을 쓰므로
          // 여기서 반드시 이스케이프한다.
          `<p class="rnote">가장 느린 식 — ${escapeHtml(w.slowest.fact)} · ${sec(w.slowest.medianMs)}</p>`
        : ''
    }
    ${w.nextCheckup ? `<p class="rnote is-muted">다음 점검의 날 — ${formatDate(w.nextCheckup)}</p>` : ''}
  `
}

const STEP_LABELS: Record<FailedStep, string> = {
  story: '이야기 구조',
  expr: '식 세우기',
  calc: '계산',
  slip: '실수',
}
const typeLabel = (t: string): string => (WORD_TYPE_LABELS as Record<string, string>)[t] ?? '기타'

/** 문장제 절(스펙 §7). 문자열은 전부 여기서 이스케이프한다 — text는 엔진이 이미 잘라 왔다. */
function wordHtml(r: WordReport): string {
  if (r.groups.every((g) => g.total === 0) && r.weekTotal === 0)
    return '<p class="rnote">문장제 기록이 아직 없어요</p>'
  const rows = r.groups
    .map((g) => {
      const bar =
        g.total < 3
          ? '<span class="wbar-few">표본 부족</span>'
          : `<span class="wbar"><i style="width:${Math.round((100 * g.correct) / g.total)}%"></i></span>`
      const weak = g.weak
        .map(
          (t) =>
            `<li class="wrow wrow--sub">└ ${escapeHtml(typeLabel(t.type))} ${t.correct}/${t.total} ← 약해요</li>`,
        )
        .join('')
      return `<li class="wrow"><span>${WORD_GROUP_LABELS[g.group]}</span>${bar}<span>${g.correct}/${g.total}</span></li>${weak}`
    })
    .join('')
  const c = r.causes
  const recent = r.recent
    .map(
      (x) => `<li>${formatDate(x.date)} ${escapeHtml(x.text)}…<br>
        ${x.exprs.length > 0 ? `식 ${escapeHtml(x.exprs.join(', '))} · ` : ''}${Number(x.answer)} → ${Number(x.correct)}${escapeHtml(x.unit)} · ${STEP_LABELS[x.step]}에서 막혔어요</li>`,
    )
    .join('')
  return `
    <div class="stats">
      ${stat(`${r.weekDays}일`, '이번 주')}
      ${stat(`${r.weekCorrect}/${r.weekTotal}`, '첫 시도 정답')}
    </div>
    <h3 class="psec">최근 4주 유형별</h3>
    <ul class="wrows">${rows}</ul>
    <h3 class="psec">어디서 틀렸나</h3>
    <p class="rnote">이야기 구조 ${c.story} · 식 세우기 ${c.expr} · 계산 ${c.calc} · 실수 ${c.slip}</p>
    <p class="rnote is-muted">거꾸로 문제에는 이야기 구조 단계가 없어요 · 단어만 보고 연산 추정 ${r.keyword.guessed} / 함정 유형 오답 ${r.keyword.trapWrong}</p>
    ${recent ? `<h3 class="psec">최근 틀린 문제</h3><ul class="wrecent">${recent}</ul>` : ''}
    <p class="rnote is-muted">약한 유형이 더 자주 나와서 정답률이 실제보다 낮게 보일 수 있어요</p>
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
    const wr = wordReport(days, today)

    root.replaceChildren(
      el(`
        <div>
          <header class="phead">
            <h1>리포트</h1>
            <p class="phead-meta">${formatDate(today, true)}</p>
          </header>

          <h2 class="rsec">이번 주</h2>
          ${weeklyHtml(w, factMapHtml(facts, new Set(w.newlyFluent), { window: 'week' }))}

          <h2 class="rsec">문장제</h2>
          ${wordHtml(wr)}

          ${
            c
              ? `
            <h2 class="rsec">월간 — ${formatDate(c.date)} 점검</h2>
            <div class="stats">
              ${stat(String(c.kept.length), '유지')}
              ${stat(String(c.dropped.length), '다시 연습')}
              ${stat(c.medianMs === null ? '—' : sec(c.medianMs), '반응시간')}
            </div>
            <p class="rnote is-muted">이 점검이 물어본 식 ${c.tested}개${c.prevMedianMs !== null ? ` · 지난 점검 반응시간 ${sec(c.prevMedianMs)}` : ''}</p>
            ${
              c.dropped.length > 0
                ? // 식 id는 개별 항목이라 쉼표로 이은 문장보다 칩이 낫다 — 몇 개인지가
                  // 세지 않아도 보이고, 다음 주에 무엇이 드릴될지가 한눈에 들어온다.
                  `<h3 class="psec">다시 연습할 식</h3>
                   <ul class="chips">${c.dropped.map((f) => `<li>${escapeHtml(f)}</li>`).join('')}</ul>
                   <p class="rnote is-muted">다음 스프린트가 자동으로 다뤄요</p>`
                : '<p class="rnote">점검한 식을 모두 유지했어요</p>'
            }
          `
              : ''
          }

          ${
            w.exportOverdue
              ? // 되돌릴 수 없는 삭제는 아니지만, 서버 사본이 없는 이 앱에서 유일한
                // 안전망이 낡아간다는 신호다. 부모 홈의 알림과 같은 모양을 쓰고 —
                // 옛 문구는 "데이터·기기 관리에서 내보내기를 눌러주세요"라고 길을
                // 설명만 했다 — 그 길로 가는 버튼을 알림 안에 둔다.
                `<div class="notice notice--risk">
                   <span class="notice-text">백업한 지 30일이 넘었어요</span>
                   <button class="notice-act" id="backup">내보내러 가기</button>
                 </div>`
              : ''
          }

          <div class="ptail">
            <nav class="pmenu">
              ${typeof navigator.share === 'function' ? '<button id="share">공유하기</button>' : ''}
              <button id="manage">데이터·기기 관리</button>
              <button id="back">← 홈</button>
            </nav>
          </div>
        </div>
      `),
    )
    root.querySelector('#backup')?.addEventListener('click', () => navigate('#/manage'))

    root.querySelector('#back')!.addEventListener('click', () => navigate('#/parent'))
    // 데이터 관리는 2026-08-13에 #/manage로 떠났다(기기 상한 설계 §3 — 사용자 결정:
    // 리포트 안의 절이 아니라 별도 메뉴). 여기 남은 것은 진입 버튼 하나다.
    root.querySelector('#manage')!.addEventListener('click', () => navigate('#/manage'))
    root.querySelector('#share')?.addEventListener('click', () => {
      // 사용자가 공유 시트를 닫는 것은 실패가 아니다(AbortError) — 조용히 무시한다.
      navigator.share({ text: shareText(w, wr, today) }).catch(() => {})
    })
  } catch (e) {
    showError('리포트를 열지 못했어요.', e)
    root.replaceChildren(el(`<div><button class="step" id="back">← 홈</button></div>`))
    root.querySelector('#back')!.addEventListener('click', () => navigate('#/parent'))
  }
}
