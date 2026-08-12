import { getAllDays, getMeta, putMeta, replaceAll, resetAll, defaultMeta } from '../data/db'
import {
  syncEnabled,
  serverOnline,
  serverSnapshot,
  serverReplaceAll,
  listSnapshots,
  getSnapshotPayload,
  suspendSync,
  resumeSync,
} from '../data/sync'
import { dayKey } from '../engine/dates'
import { deriveFacts, FACT_IDS } from '../engine/facts'
import {
  weeklyReport,
  latestCheckupReport,
  daysSinceExport,
  ungradedSheetCount,
} from '../engine/report'
import type { WeeklyReport } from '../engine/report'
import { STRATEGY_CATALOG, STRATEGY_NAMES } from '../engine/strategy'
import { serializeBackup, validateBackup } from '../engine/backup'
import { factMapHtml } from './fact-map'
import {
  clearError,
  confirmDialog,
  el,
  escapeHtml,
  formatDate,
  navigate,
  showError,
  toast,
} from '../ui'
import type { Day, Meta } from '../data/types'

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

/**
 * 기록 구간을 "2026-08-01 ~ 2026-08-05"로 적되, 하루치뿐이면 날짜 하나만 낸다 —
 * "(2026-08-05 ~ 2026-08-05)"은 범위가 아니라 오작동으로 읽힌다.
 *
 * 날짜는 백업 파일에서 온 값일 수 있고 validateBackup은 형식만 본다. 두 호출부가 모두
 * confirmDialog의 description으로 넘기는데 그쪽은 textContent 전용이라(ui.ts) 여기서
 * 이스케이프하지 않는다 — el() 템플릿에 이 값을 넣는 코드를 새로 쓰면 그때는
 * escapeHtml이 필요하다.
 */
/** 하루 분량의 정본은 "하루치"다(brand.md §6 용어 사전) — "1일치"는 사전에 없는 말이다. */
const dayCount = (n: number) => (n === 1 ? '하루치' : `${n}일치`)

/** 서버 스냅샷의 reason 코드 → 사람이 읽을 라벨(설계 §6). 'reset'·'import'는 이 화면이
 *  만들고, 'auto'·'generation-conflict'는 서버 트리거·2단계 병합이 만든다 — 클라이언트가
 *  안 만든 값도 목록에 나타날 수 있어 셋 다 미리 둔다. 모르는 값은 원문을 그대로 보여준다
 *  (렌더가 죽는 것보다 이상하게 보이는 쪽을 택한다, backup.ts dayError와 같은 판단). */
const SNAPSHOT_REASON_LABELS: Record<string, string> = {
  reset: '초기화 전',
  import: '가져오기 전',
  restore: '되돌리기 전',
  // 다른 기기의 파괴적 교체를 따라 이 기기를 맞추기 직전(설계 2단계 §3). 재기준화가
  // 자동으로 살리지 못하는 오프라인 신규 기록은 **이 스냅샷으로만** 되찾을 수 있다.
  rebase: '기기 맞추기 전',
  auto: '자동',
  'generation-conflict': '동기화 충돌',
}

/** "2026-08-06T09:15:00Z" → "08/06 09:15". 파싱에 실패하면(형식이 깨진 서버 값) 원문을
 *  그대로 돌려준다 — 호출부가 항상 escapeHtml을 한 번 더 거치므로 el()에 안전하게 들어간다. */
function formatSnapshotAt(at: string): string {
  const d = new Date(at)
  if (Number.isNaN(d.getTime())) return at
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * 스냅샷 목록 → 되돌리기 카드들. 홈 카드와 같은 모양(.step + <small>)을 그대로 쓴다 —
 * 이 화면에 이미 있는 패턴이라 새 CSS가 필요 없다.
 *
 * at·reason·dayCount·id 전부 서버(sync.ts listSnapshots)에서 온 값이다 — 백업 파일과
 * 같은 신뢰 등급이라(과제 브리프) el()의 innerHTML에 들어가기 전 전부 escapeHtml을
 * 거친다. id는 속성 문맥(따옴표)에 들어가므로 숫자라도 예외 없이 escapeHtml한다.
 */
function snapshotsHtml(
  snaps: { id: number; at: string; reason: string; dayCount: number }[],
): string {
  const rows = snaps
    .map((s) => {
      const label = escapeHtml(SNAPSHOT_REASON_LABELS[s.reason] ?? s.reason)
      const at = escapeHtml(formatSnapshotAt(s.at))
      const count = escapeHtml(dayCount(s.dayCount))
      return `
        <button class="step snapshot-restore" data-snapshot-id="${escapeHtml(s.id)}">
          ${at} · ${label} · ${count}
          <small>탭해서 이 시점으로 되돌리기</small>
        </button>
      `
    })
    .join('')
  return `<h2>서버 백업에서 되돌리기</h2>${rows}`
}

function dateRange(days: Day[]): string {
  if (days.length === 0) return ''
  const first = days[0]!.date
  const last = days[days.length - 1]!.date
  return first === last ? first : `${first} ~ ${last}`
}

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
          `<div class="banner seed-callout__root seed-callout__root--tone_warning"><span class="seed-callout__description seed-callout__description--tone_warning">백업한 지 30일이 넘었어요 — 아래에서 내보내기를 눌러주세요</span></div>`
        : ''
    }
  `
}

/**
 * 다운로드만 트리거한다. Download API에는 완료 신호가 없어 코드는 아빠가 실제로
 * 파일 앱에 저장했는지 알 방법이 없다 — `lastExportedAt`은 여기서 갱신하지 않고
 * 호출부(renderReport의 #export 핸들러)가 정책까지 함께 쥔다.
 *
 * 그 정책의 역사: 처음에는 여기서 무조건 갱신했는데, 네이티브 저장 시트를 취소해도
 * 30일 배지가 사라져 서버 사본이 없는 이 앱의 유일한 안전망이 거짓말을 했다. 다음에는
 * "저장했나요?"를 묻고 대답으로만 기록했는데, 드문 취소를 잡으려고 흔한 성공에 매번
 * 탭을 물리는 구조였다. 지금은 낙관적으로 기록하고 토스트 액션으로 되돌린다 —
 * 배지가 거짓일 수 있는 창구는 남지만 정정 경로가 있다(#export 핸들러 주석 참고).
 */
function triggerDownload(days: Day[], meta: Meta, today: string): void {
  const json = serializeBackup(days, meta, new Date().toISOString())
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `haruchi-${today}.json`
  a.click()
  // 즉시 revoke하면 일부 브라우저에서 다운로드가 끊긴다 — 넉넉히 뒤로 미룬다.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

// 내보내기·되돌리기 후 배지 갱신을 위해 renderReport가 자기 자신을 다시 부른다(같은
// #/report 안에서 재렌더 — 해시가 안 바뀐다). importBusy/resetBusy가 함수 스코프
// 지역 변수였다면 그 재렌더마다 새 스코프가 false로 열려 "가져오기 진행 중에 재렌더
// → 새 스코프의 importBusy=false → 가져오기 버튼이 다시 눌려 복구가 두 번 돈다"
// 사고가 났다(최종 브랜치 리뷰에서 발견). 모듈 스코프로 옮겨 여러 renderReport 호출에
// 걸쳐 하나의 진실을 유지한다. 페이지를 새로고침하면(뒤로가기 없이 앱을 새로
// 로드하면) 모듈이 다시 초기화돼 false로 돌아가므로, 새로고침 자체가 영구 잠금의
// 탈출구이기도 하다.
//
// DOM 노드는 여기 담지 않는다 — 재렌더로 죽은 노드를 만지게 되기 때문이다. 아래
// setImportBusy/setResetBusy가 저장해 둔 참조가 아니라 매번 root.querySelector로
// "지금 화면의 버튼"을 새로 찾는 이유가 이것이다: 예전 렌더의 클로저가 나중에
// resolve돼 setResetBusy를 불러도, 그 시점에 실제로 화면에 떠 있는(root에 붙어
// 있는) #import 버튼을 찾아 고치므로 최신 렌더가 항상 정확한 상태를 반영한다.
let importBusy = false
let resetBusy = false

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
          ${weeklyHtml(w, factMapHtml(facts, new Set(w.newlyFluent)))}
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
          <h2>데이터 관리</h2>
          <button class="step" id="export">데이터 내보내기 (백업)</button>
          <button class="step" id="import">가져오기 (복구)</button>
          <input type="file" id="import-file" accept="application/json,.json" hidden />
          ${days.length > 0 ? '<button class="step danger" id="reset">모든 기록 지우기</button>' : ''}
          <div id="snapshots"></div>
          <button class="step" id="back">← 홈</button>
        </div>
      `),
    )

    root.querySelector('#back')!.addEventListener('click', () => navigate('#/parent'))
    root.querySelector('#share')?.addEventListener('click', () => {
      // 사용자가 공유 시트를 닫는 것은 실패가 아니다(AbortError) — 조용히 무시한다.
      navigator.share({ text: shareText(w, today) }).catch(() => {})
    })

    root.querySelector('#export')!.addEventListener('click', () => {
      const at = location.hash
      try {
        triggerDownload(days, meta, today)
      } catch (e) {
        showError('내보내지 못했어요.', e)
        return
      }
      clearError()
      // 다운로드 "완료"는 브라우저가 알려주지 않는다(triggerDownload의 주석 참고) —
      // 저장 시트를 취소했는지 알 방법이 없다. 예전에는 사람에게 "저장했나요?"를
      // 물어 대답으로만 기록했는데, 그 비관적 기본값은 드문 실패(취소)를 잡으려고
      // 흔한 성공에 매번 탭을 물리고, 반복되면 "네"를 확인 없이 누르는 습관을 만들어
      // 보증 자체를 형해화한다. 낙관적으로 먼저 기록하고 되돌릴 기회를 주는 쪽으로
      // 뒤집었다 — lastExportedAt은 되돌릴 수 있는 값이고, 되돌릴 수 있는 한 물어볼
      // 이유가 없다.
      const prev = meta.settings.lastExportedAt
      putMeta(
        {
          ...meta,
          settings: { ...meta.settings, lastExportedAt: new Date().toISOString() },
        },
        ['export'],
      )
        .then(() => {
          if (location.hash !== at) return
          toast('백업했어요', {
            tone: 'positive',
            durationMs: 8000,
            action: { label: '저장 안 했어요', onClick: () => revertExport(prev, at) },
          })
          void renderReport(root) // 30일 배지 갱신 반영
        })
        .catch((e) => {
          if (location.hash !== at) return
          // 파일은 이미 내려갔다 — 이건 백업 실패가 아니라 기록 실패다. 무엇이
          // 안전한지를 먼저 말한다(brand.md §5 "실패에는 언제나 현재 상태를 병기").
          showError('백업 기록을 남기지 못했어요 (파일은 내려받았어요).', e)
        })
    })

    // 되돌리기는 렌더 시점의 meta가 아니라 지금의 meta를 다시 읽어 고친다. 이 클로저는
    // 토스트가 살아 있는 8초 동안 대기하는데, 그 사이 초기화(resetAll)가 끝났다면 낡은
    // meta를 되쓰는 순간 방금 지운 상태를 덮는다 — importBusy/resetBusy는 가져오기와
    // 초기화가 서로를 막게 할 뿐 내보내기는 막지 않으므로 실재하는 경합이다.
    // prev는 string | null이다(types.ts) — undefined로 되돌리면 validateBackup이
    // 거부하므로(backup.ts) 한 번도 백업한 적 없던 경우는 반드시 null로 돌아간다.
    const revertExport = (prev: string | null, at: string): void => {
      void getMeta()
        .then((cur) =>
          putMeta({ ...cur, settings: { ...cur.settings, lastExportedAt: prev } }, ['export']),
        )
        .then(() => {
          toast('백업 기록을 되돌렸어요')
          if (location.hash === at) void renderReport(root)
        })
        .catch((e) => {
          if (location.hash !== at) return
          showError('백업 기록을 되돌리지 못했어요 (백업 파일은 그대로예요).', e)
        })
    }

    const fileInput = root.querySelector<HTMLInputElement>('#import-file')!
    const importBtn = root.querySelector<HTMLButtonElement>('#import')!
    // confirmDialog는 화면 전체를 덮는 오버레이라 열려 있는 동안은 아래의 "가져오기"
    // 버튼을 누를 수 없다 — 하지만 change 이벤트가 뜬 뒤(file.text() 읽기·JSON.parse·
    // validateBackup)부터 confirmDialog가 실제로 뜨기까지는 오버레이가 없는 짧은 틈이
    // 있고, 그 틈에 "가져오기"를 다시 눌러 파일을 또 고르면 독립된 두 흐름이 각자
    // confirmDialog를 띄울 수 있다(둘 다 한 번씩만 resolve되므로 둘 다 확인하면
    // replaceAll이 두 번 돈다). importBusy가 그 틈을 막는다.
    //
    // importBusy·resetBusy는 같은 IndexedDB 스토어(days/meta)를 건드리는 가져오기
    // 복구(replaceAll)와 초기화(resetAll)가 서로를 막게 하는 공유 가드이기도 하다 —
    // 가져오기가 file.text()를 기다리는 사이 초기화가 먼저 끝나 화면이 넘어가면,
    // 그 위에 남아 있던 confirmDialog를 뒤늦게 확인해 방금 지운 기록을 낡은 백업으로
    // 되살리는 경합이 있었다(병합 리뷰에서 발견). setImportBusy/setResetBusy가 상대
    // 버튼의 disabled를 함께 묶어 애초에 두 흐름이 겹쳐 시작하지 못하게 막는다 —
    // 확인 UX·resetAll/replaceAll 호출 방식 자체는 손대지 않는다(버튼 활성 여부만).
    // importBusy/resetBusy 자체는 모듈 스코프다(파일 상단 선언부 주석 참고) — 여기서는
    // 대입만 한다. 상대 버튼도 저장해 둔 참조(예전의 importBtn)가 아니라 매번
    // root.querySelector로 다시 찾는다: 이 두 함수의 클로저는 재렌더를 넘어 살아남는
    // 프라미스 체인(file.text()·replaceAll·resetAll) 안에서 나중에 불릴 수 있는데,
    // 그때 root는 같은 컨테이너 노드라도 자식은 최신 렌더의 것으로 이미 바뀌어 있다.
    // 저장된 참조를 쓰면 이미 화면에서 사라진 옛 버튼을 고치는 무의미한 부작용이 되고,
    // 최신 렌더의 진짜 버튼은 갱신되지 않아 영구히 비활성으로 남을 수 있다.
    // 되돌리기 버튼도 이 두 플래그 중 하나만 서 있어도(가져오기·초기화·되돌리기 셋 중
    // 아무거나 진행 중) 눌려 보이면 안 된다 — 클릭 핸들러의 importBusy||resetBusy 가드가
    // 실제 실행은 막아 데이터가 위험해지지는 않지만, 눌러도 조용히 아무 일도 안 일어나는
    // 버튼은 아빠가 "안 눌리나?" 하고 다시 누르게 만드는 나쁜 신호다 — 겉모습을 실제
    // 상태에 맞춘다(리뷰 지적).
    const syncSnapshotButtons = (): void => {
      const disabled = importBusy || resetBusy
      root.querySelectorAll<HTMLButtonElement>('.snapshot-restore').forEach((b) => {
        b.disabled = disabled
      })
    }
    // 자기 버튼도 함께 잠근다. 예전에는 상대 버튼만 잠갔는데, 파괴적 흐름이 시작하자마자
    // 하는 첫 일이 `await suspendSync()`(진행 중인 push가 끝나기를 기다린다 — 등록 직후
    // 1년치를 올리는 중이면 분 단위가 될 수 있다)라, 그 사이 눌린 것처럼 보이지 않는
    // 자기 버튼을 아빠가 한 번 더 누르면 같은 흐름이 둘 시작됐다. 겉모습(disabled)이
    // 실제 상태를 바로 반영해야 그 창이 애초에 안 생긴다.
    const syncBusyButtons = (): void => {
      const disabled = importBusy || resetBusy
      const resetBtn = root.querySelector<HTMLButtonElement>('#reset')
      if (resetBtn) resetBtn.disabled = disabled
      const importBtnNow = root.querySelector<HTMLButtonElement>('#import')
      if (importBtnNow) importBtnNow.disabled = disabled
      syncSnapshotButtons()
    }
    const setImportBusy = (v: boolean) => {
      importBusy = v
      syncBusyButtons()
    }
    const setResetBusy = (v: boolean) => {
      resetBusy = v
      syncBusyButtons()
    }
    /**
     * 파괴적 흐름 셋이 공통으로 내는 첫 신호. 확인 다이얼로그가 뜨기까지는 최소한
     * `suspendSync()`(진행 중인 push 대기)와 `serverSnapshot()` 왕복이 있고, 등록 직후
     * 1년치를 올리는 중이라면 분 단위가 될 수 있다 — 되돌릴 수 없는 버튼을 누른 뒤의
     * 몇 분짜리 침묵은 그 자체로 결함이다(눌리긴 한 건지 알 수 없다).
     *
     * 이 화면이 이미 쓰는 일시적 상태 표시(toast)를 그대로 쓴다 — 새 패턴을 만들지
     * 않는다. 토스트는 3초 뒤 사라지지만 그 뒤로도 세 버튼이 전부 비활성이라
     * "진행 중"은 계속 보인다.
     */
    const preparingToast = (): void => toast('준비하고 있어요 — 잠시만 기다려 주세요')
    // 이 렌더가 시작되는 시점에 이미(예: 화면을 떠났다가 다시 들어왔는데 이전
    // 렌더에서 시작한 가져오기·초기화가 아직 진행 중인 경우) importBusy/resetBusy가
    // true일 수 있다 — 새로 그려진 버튼은 HTML 템플릿상 기본으로 활성 상태이므로,
    // 여기서 한 번 동기화하지 않으면 진행 중인 작업이 있는데도 새 렌더의 버튼이
    // 눌려 두 번째 흐름이 시작될 수 있다.
    syncBusyButtons()
    importBtn.addEventListener('click', () => {
      if (importBusy || resetBusy) return
      // 값을 먼저 비운다 — 안 그러면 브라우저가 같은 파일 재선택을 change로 안 알려줘
      // 복구가 조용히 안 된다. 클릭 시점에 매번 비우는 것으로 취소 후 재시도까지 잡는다.
      fileInput.value = ''
      fileInput.click()
    })
    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0]
      if (!file) return
      setImportBusy(true)
      preparingToast()
      const at = location.hash
      void file
        .text()
        .then(async (text) => {
          // 파괴적 작업이 도는 동안 push와 pull 적용을 멈춘다(그리고 진행 중인 push가 끝나기를
          // 기다린다) — 안 그러면 pushDay가 교체 직전의 Day를 읽어 두었다가
          // serverReplaceAll이 서버를 비운 **뒤에** 올려, 로컬에 없는 날이 서버에
          // 남는다. 1단계에는 pull이 없어 그 어긋남은 되돌릴 수 없다(최종 리뷰 4).
          await suspendSync()
          try {
            return await runImport(text)
          } finally {
            // 어느 경로로 끝나든 반드시 푼다 — 안 풀면 push가 앱을 새로 열 때까지 멈춘다.
            resumeSync()
          }
        })
        .catch((e) => {
          // 파일을 고른 뒤 읽기 자체가 실패하는 경우(권한 취소, iCloud 미다운로드 등) —
          // 여기 .catch가 없으면 사용자는 파일을 골랐는데 아무 반응도 못 본다.
          setImportBusy(false)
          if (location.hash !== at) return
          showError('파일을 읽지 못했어요.', e)
        })

      /** 고른 파일의 내용으로 복구를 진행한다. 위 then이 push 정지 안에서 부른다. */
      async function runImport(text: string): Promise<void> {
        if (location.hash !== at) {
          setImportBusy(false)
          return
        }
        let raw: unknown
        try {
          raw = JSON.parse(text)
        } catch {
          setImportBusy(false)
          showError('JSON 파일이 아니에요. 하루치에서 내보낸 파일을 골라주세요.')
          return
        }
        const v = validateBackup(raw)
        if (!v.ok) {
          setImportBusy(false)
          showError(`백업 파일이 아니에요: ${v.reason}`)
          return
        }
        clearError()
        const range = v.days.length > 0 ? ` (${dateRange(v.days)})` : ''

        // 동기화가 켜져 있으면: 온라인 확인(navigator.onLine이 아니라 serverOnline() —
        // 와이파이가 있어도 Supabase 무료 플랜이 잠들어 있으면 백업을 못 만든다) →
        // 서버에 지금 상태(교체당할 쪽)를 사전 스냅샷으로 올리고(실패하면 아무것도
        // 지우지 않고 중단) → 타이핑 확인 → 로컬 → 서버 순으로 간다(설계 §6, reset과
        // 같은 순서). 꺼져 있으면(미등록·config 비움) 기존 로컬 흐름 그대로 — 회귀 없음.
        const enabled = await syncEnabled()
        const snapshotLine: string[] = []
        if (enabled) {
          if (!(await serverOnline())) {
            setImportBusy(false)
            if (location.hash !== at) return
            showError('서버에 연결할 수 없어요. 백업을 만들 수 없는 동안은 가져올 수 없어요.')
            return
          }
          try {
            const snap = await serverSnapshot('import', { days, meta })
            snapshotLine.push(`방금 서버에 ${dayCount(snap.dayCount)} 백업을 만들었어요`)
          } catch (e) {
            // 여기서 실패하면 아무것도 지우지 않는다 — replaceAll을 아직 부르지 않았다.
            setImportBusy(false)
            if (location.hash !== at) return
            showError('서버에 백업을 만들지 못했어요. 가져오지 않았어요.', e)
            return
          }
        }

        const ok = await confirmDialog({
          title: '현재 기록을 지우고 복구할까요?',
          description: [
            `이 백업: ${dayCount(v.days.length)}${range}`,
            `지금 기록 ${dayCount(days.length)}를 통째로 대체해요. 두 기록을 합치지 않아요.`,
            '되돌릴 수 없어요.',
            ...snapshotLine,
          ],
          confirmLabel: '복구',
          cancelLabel: '취소',
          tone: 'critical',
          requireText: enabled ? '지우기' : undefined, // 동기화 전에는 기존 UX 그대로
        })
        // confirmDialog는 해시가 바뀌면(예: 이 대기 중에 초기화가 먼저 끝나 #/parent로
        // 넘어간 경우) 스스로 false로 닫힌다(ui.ts) — 그래서 이 경로는 "사용자가
        // 취소를 눌렀을 때"와 "다른 파괴적 작업이 먼저 끝나 화면이 넘어갔을 때"를
        // 함께 처리한다.
        if (!ok) {
          setImportBusy(false)
          return
        }
        let localDone = false
        try {
          await replaceAll(v.days, v.meta) // 4. 로컬 먼저 — 서버 반영이 실패해도 데이터를 잃지 않는다
          localDone = true
          if (enabled) await serverReplaceAll(v) // 5. RPC가 자동 스냅샷을 겸한다
          setImportBusy(false)
          if (location.hash !== at) return
          toast('복구했어요', { tone: 'positive' })
          navigate('#/parent')
        } catch (e) {
          setImportBusy(false)
          if (location.hash !== at) return
          if (localDone) {
            // 로컬은 이미 복구했다 — 서버 반영만 실패했을 뿐 데이터를 잃지는 않았다
            // (헷갈리지만 설계 §6이 감수하기로 한 실패 모드).
            //
            // "다음에 올라간다"가 실제로 참인 이유: replaceAll이 seededAt을 함께 비우므로
            // 다음 push가 방금 들여온 기록으로 아웃박스를 다시 채운다. 다만 그 push는
            // 날짜별 갱신이라, 파일에 없어서 지워졌어야 할 서버의 날은 그대로 남는다 —
            // 그 사실도 함께 말한다(설계 §6: 실패에는 현재 상태를 병기).
            showError(
              '로컬은 복구했지만 서버 반영에 실패했어요 (복구한 기록은 다음 동기화 때 올라가요. 서버에 지우지 못한 날이 남아 있을 수 있어요).',
              e,
            )
          } else {
            // replaceAll은 원자적이다 — 실패해도 기존 데이터는 그대로다(db.test가 증명).
            showError('복구하지 못했어요 (기존 기록은 그대로예요).', e)
          }
        }
      }
    })

    // 버튼은 기록이 있을 때만 그려지므로 ?. 가 필요하다.
    root.querySelector('#reset')?.addEventListener('click', () => {
      // 자기 자신(resetBusy)도 본다. 예전에는 importBusy만 봐서, 확인 다이얼로그가 뜨기
      // 전의 대기 동안 이 버튼을 한 번 더 누르면 초기화 흐름이 둘 시작됐다 —
      // serverSnapshot('reset')이 두 줄 만들어지고 확인 다이얼로그가 두 개 겹쳤다.
      // 다른 두 흐름(가져오기·되돌리기)은 처음부터 둘 다 보고 있었다.
      if (importBusy || resetBusy) return
      setResetBusy(true)
      preparingToast()
      const at = location.hash
      clearError()
      // 버튼이 존재한다 = days.length > 0이므로 dateRange는 빈 문자열을 내지 않는다.
      const range = dateRange(days)
      const ungraded = ungradedSheetCount(days, today)
      const since = daysSinceExport(meta, today)
      // 되돌릴 수 없는 삭제 앞에서는 하루 전 백업도 경고할 값이 있어서 ⚠를 조건부로 붙이지
      // 않는다. 막지는 않는다 — lastExportedAt은 "내보내기를 눌렀다"에 되돌리기가 붙은
      // 값이라(위 #export 핸들러 주석) 강제 게이트로 쓰면 거짓 안전감을 준다.
      // 두 갈래를 같은 문장 꼴로 맞춘다 — 한쪽만 "마지막 백업: 오늘" 같은 라벨:값
      // 조각이면 다른 줄들 사이에서 혼자 다른 화자처럼 읽힌다.
      const backupLine =
        since === null
          ? '⚠ 아직 백업한 적이 없어요'
          : `⚠ 마지막 백업은 ${since === 0 ? '오늘' : `${since}일 전`}이에요`
      // 되돌릴 수 없는 전체 삭제라 가져오기 확인과 같은 컴포넌트·같은 tone을 쓴다.
      // confirmDialog가 취소·배경 클릭·Esc·화면 전환을 전부 false로 모아 주므로 취소
      // 핸들러가 따로 필요 없고, settle이 정확히 한 번만 resolve해 이중 탭 가드
      // (예전의 yes.disabled)도 필요 없다.
      void (async () => {
        // 파괴적 작업이 도는 동안 push와 pull 적용을 멈춘다(진행 중인 push는 끝나기를 기다린다) —
        // 안 그러면 pushDay가 지우기 직전의 Day를 읽어 두었다가 serverReplaceAll이
        // 서버를 비운 **뒤에** 올려, 방금 지운 날이 서버에 되살아난다(최종 리뷰 4).
        await suspendSync()
        try {
          // 동기화가 켜져 있으면: 온라인 확인(navigator.onLine이 아니라 serverOnline() —
          // 와이파이가 있어도 Supabase 무료 플랜이 잠들어 있으면 백업을 못 만드는데, 그게
          // 바로 지우면 안 되는 상태다) → 서버 사전 스냅샷(실패하면 아무것도 지우지 않고
          // 중단) → 타이핑 확인 → 로컬 → 서버 순으로 간다(설계 §6 "순서 자체가
          // 안전장치다"). 꺼져 있으면(미등록·config 비움) 기존 로컬 흐름 그대로 — 회귀 없음.
          const enabled = await syncEnabled()
          const snapshotLine: string[] = []
          if (enabled) {
            if (!(await serverOnline())) {
              setResetBusy(false)
              if (location.hash !== at) return
              showError('서버에 연결할 수 없어요. 백업을 만들 수 없는 동안은 지울 수 없어요.')
              return
            }
            try {
              const snap = await serverSnapshot('reset', { days, meta })
              snapshotLine.push(`방금 서버에 ${dayCount(snap.dayCount)} 백업을 만들었어요`)
            } catch (e) {
              // 여기서 실패하면 아무것도 지우지 않는다 — resetAll을 아직 부르지 않았다.
              setResetBusy(false)
              if (location.hash !== at) return
              showError('서버에 백업을 만들지 못했어요. 지우지 않았어요.', e)
              return
            }
          }

          const ok = await confirmDialog({
            title: '모든 기록을 지울까요?',
            description: [
              `${dayCount(days.length)} 기록(${range})이 사라지고 처음 상태로 돌아가요.`,
              ...(ungraded > 0
                ? [
                    `⚠ 아직 채점하지 않은 문제지가 ${dayCount(ungraded)} 있어요 — 그 종이는 채점할 수 없게 돼요`,
                  ]
                : []),
              backupLine,
              ...snapshotLine,
            ],
            confirmLabel: '네, 지울게요',
            cancelLabel: '취소',
            tone: 'critical',
            requireText: enabled ? '지우기' : undefined, // 동기화 전에는 기존 UX 그대로
          })
          if (!ok) {
            setResetBusy(false)
            return
          }
          let localDone = false
          try {
            await resetAll() // 4. 로컬 먼저 — 서버 삭제가 실패해도 데이터를 잃지 않는다
            localDone = true
            if (enabled) await serverReplaceAll({ days: [], meta: defaultMeta() }) // 5. RPC가 자동 스냅샷을 겸한다
            setResetBusy(false)
            if (location.hash !== at) return
            navigate('#/parent')
          } catch (e) {
            setResetBusy(false)
            if (location.hash !== at) return
            if (localDone) {
              // 로컬은 이미 지웠다 — 서버 삭제만 실패했을 뿐 데이터를 잃지는 않았다(헷갈리지만
              // 설계 §6이 감수하기로 한 실패 모드 — 서버에 남은 사본은 다음에 다시 지우면 된다).
              showError(
                '로컬은 지웠지만 서버 정리에 실패했어요 (서버에 기록이 남아 있을 수 있어요).',
                e,
              )
            } else {
              // resetAll은 replaceAll을 그대로 태우므로 원자적이다 — 실패해도 기록은 그대로다.
              showError('지우지 못했어요 (기록은 그대로예요).', e)
            }
          }
        } finally {
          // 어느 경로로 끝나든 반드시 푼다 — 안 풀면 push가 앱을 새로 열 때까지 멈춘다.
          resumeSync()
        }
      })()
    })

    /**
     * 스냅샷 목록을 그리고 되돌리기를 배선한다. 첫 렌더에 끼우지 않고 나중에 채우는
     * 이유는 §5다 — 서버가 느리거나 죽어 있으면 목록을 기다리는 동안 리포트 전체가
     * 빈 화면으로 남는다. 목록은 이 화면의 부가 기능이고, 리포트 본문은 로컬 데이터만으로
     * 이미 완성돼 있다.
     *
     * 초기화·가져오기와 같은 IndexedDB 스토어(days/meta)를 건드리는 파괴적 교체라 같은
     * importBusy/resetBusy 가드를 그대로 같이 쓴다 — 복구·초기화·가져오기 셋이 서로를
     * 막는 기존 구조를 셋으로 늘릴 뿐 새로 만들지 않는다.
     */
    const mountSnapshots = (
      snaps: { id: number; at: string; reason: string; dayCount: number }[],
    ): void => {
      const box = root.querySelector('#snapshots')
      if (!box) return
      box.replaceChildren(el(`<div>${snapshotsHtml(snaps)}</div>`))
      box.querySelectorAll<HTMLButtonElement>('.snapshot-restore').forEach((btn) => {
        btn.addEventListener('click', () => {
          if (importBusy || resetBusy) return
          const id = Number(btn.dataset.snapshotId)
          // 목록에 이미 보여준 값(시각·사유·일수, listSnapshots)으로 먼저 묻는다 — 이
          // 확인 단계에서는 스냅샷 내용을 받지 않는다(getSnapshotPayload는 확인 뒤에만).
          const snap = snaps.find((s) => s.id === id)
          if (!snap) return // 방어적: 렌더된 버튼과 snaps 배열이 어긋날 수는 없지만.
          setImportBusy(true)
          preparingToast()
          const at = location.hash
          clearError()
          void (async () => {
            // 파괴적 작업이 도는 동안 push와 pull 적용을 멈춘다 — 진행 중인 push가 지우기 직전의
            // Day를 서버에 올려 되살리는 것을 막는다(초기화·가져오기와 같은 이유).
            await suspendSync()
            try {
              // 초기화·가져오기와 **같은 규칙**을 적용한다: 지워질 것의 스냅샷이 서버에
              // 생기기 전에는 아무것도 지우지 않는다. replace_all의 자동 스냅샷에 기대면
              // 안 된다 — 그것은 이미 서버에 있는 것만 담으므로, 아직 안 올라간 로컬
              // 기록(1단계에서는 흔한 상태다)은 어디에도 남지 않고 사라진다(최종 리뷰 3).
              if (!(await serverOnline())) {
                if (location.hash === at)
                  showError('서버에 연결할 수 없어요. 백업을 만들 수 없는 동안은 되돌릴 수 없어요.')
                return
              }
              let preSnapshot: { dayCount: number }
              try {
                preSnapshot = await serverSnapshot('restore', { days, meta })
              } catch (e) {
                if (location.hash === at)
                  showError('서버에 백업을 만들지 못했어요. 되돌리지 않았어요.', e)
                return
              }

              const ok = await confirmDialog({
                title: '이 시점으로 되돌릴까요?',
                description: [
                  `${formatSnapshotAt(snap.at)} · ${SNAPSHOT_REASON_LABELS[snap.reason] ?? snap.reason} · ${dayCount(snap.dayCount)}`,
                  `지금 기록 ${dayCount(days.length)}를 통째로 대체해요. 두 기록을 합치지 않아요.`,
                  '되돌릴 수 없어요.',
                  `방금 서버에 ${dayCount(preSnapshot.dayCount)} 백업을 만들었어요`,
                ],
                confirmLabel: '되돌리기',
                cancelLabel: '취소',
                tone: 'critical',
                requireText: '되돌리기',
              })
              if (!ok) return

              let payload: unknown
              try {
                payload = await getSnapshotPayload(id)
              } catch (e) {
                if (location.hash === at)
                  showError('스냅샷을 불러오지 못했어요. 되돌리지 않았어요.', e)
                return
              }
              // 스냅샷도 신뢰하지 않는다 — 서버에서 온 값은 백업 파일과 같은 등급이다.
              // 감싸개가 없다: 스냅샷 payload가 백업 파일과 같은 모양(app·schemaVersion
              // 포함)으로 저장되므로 그대로 검증한다. 옛 모양({days, meta}만 담긴
              // 스냅샷)은 app이 없어 여기서 거부된다 — 조용히 잘못 해석되는 것보다
              // 사유를 밝히고 멈추는 쪽이다(최종 리뷰 8).
              const v = validateBackup(payload)
              if (!v.ok) {
                if (location.hash === at) showError(`스냅샷이 백업 형식이 아니에요: ${v.reason}`)
                return
              }
              let localDone = false
              try {
                await replaceAll(v.days, v.meta) // 4. 로컬 먼저
                localDone = true
                await serverReplaceAll({ days: v.days, meta: v.meta }) // 5. RPC가 자동 스냅샷을 겸한다
                if (location.hash !== at) return
                toast('되돌렸어요', { tone: 'positive' })
                navigate('#/parent')
              } catch (e) {
                if (location.hash !== at) return
                if (localDone) {
                  // 가져오기와 같은 이유로 "다음에 올라간다"가 참이다 — replaceAll이
                  // seededAt을 비워 다음 push가 아웃박스를 다시 채운다(위 주석 참고).
                  showError(
                    '로컬은 되돌렸지만 서버 반영에 실패했어요 (되돌린 기록은 다음 동기화 때 올라가요. 서버에 지우지 못한 날이 남아 있을 수 있어요).',
                    e,
                  )
                } else {
                  showError('되돌리지 못했어요 (기존 기록은 그대로예요).', e)
                }
              }
            } finally {
              // 어느 경로로 끝나든(취소·실패·성공) 반드시 푼다 — 안 풀면 이 기기의
              // push가 앱을 새로 열 때까지 영영 멈춘다.
              setImportBusy(false)
              resumeSync()
            }
          })()
        })
      })
      syncSnapshotButtons()
    }

    // 스냅샷 목록은 렌더를 막지 않는다(§5). 동기화가 꺼져 있으면(미등록·config 비움)
    // 요청 자체가 나가지 않고 이 자리는 영원히 비어 있다 — 오늘 배포된 화면과 완전히
    // 같다(과제 비타협 조건). 여기서 확인한 값은 목록을 그릴지 판단하는 데만 쓴다 —
    // 클릭 시점에는 각 흐름이 온라인을 다시 확인한다(그 사이 연결이 끊길 수 있다).
    void (async () => {
      const at = location.hash
      if (!(await syncEnabled()) || !(await serverOnline())) return
      const snaps = await listSnapshots(5).catch(() => [])
      if (snaps.length === 0 || location.hash !== at) return
      mountSnapshots(snaps)
    })()
  } catch (e) {
    showError('리포트를 열지 못했어요.', e)
    root.replaceChildren(el(`<div><button class="step" id="back">← 홈</button></div>`))
    root.querySelector('#back')!.addEventListener('click', () => navigate('#/parent'))
  }
}
