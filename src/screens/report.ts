import { getAllDays, getMeta, putMeta, replaceAll, resetAll } from '../data/db'
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
    ${w.types.length > 0 ? `<h2>유형별 정답률</h2><ul class="report-types">${typeRows}</ul>` : ''}
    ${w.nextCheckup ? `<p>다음 점검의 날: ${formatDate(w.nextCheckup)}</p>` : ''}
    ${w.exportOverdue ? `<div class="banner">백업한 지 30일이 넘었어요 — 아래에서 내보내기를 눌러주세요</div>` : ''}
  `
}

/**
 * 다운로드만 트리거한다. Download API에는 완료 신호가 없어 코드는 아빠가 실제로
 * 파일 앱에 저장했는지 알 방법이 없다 — `lastExportedAt`은 여기서 갱신하지 않는다.
 * (예전에는 여기서 무조건 갱신했다. 그러면 네이티브 저장 시트를 취소해도 30일 배지가
 * 사라져, 서버 사본이 없는 이 앱의 유일한 안전망이 거짓말을 하는 상태가 된다.
 * 반대로 아예 갱신하지 않으면 배지가 영구히 떠서 무시하게 된다. 그래서 사람에게
 * "저장했나요?"를 한 번 묻고, 대답에 따라서만 기록한다 — renderReport의 #export
 * 클릭 핸들러가 그 확인 UI를 그린다.)
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

// #export-yes 확인 후 배지 갱신을 위해 renderReport가 자기 자신을 다시 부른다(같은
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
          <h1>주간 리포트</h1>
          <div class="date">${formatDate(today, true)}</div>
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
          <div id="confirm"></div>
          ${typeof navigator.share === 'function' ? '<button class="step" id="share">공유하기</button>' : ''}
          <button class="step" id="export">데이터 내보내기 (백업)</button>
          <button class="step" id="import">가져오기 (복구)</button>
          <input type="file" id="import-file" accept="application/json,.json" hidden />
          ${days.length > 0 ? '<button class="step" id="reset">모든 기록 지우기</button>' : ''}
          <button class="step" id="back">← 홈</button>
        </div>
      `),
    )

    root.querySelector('#back')!.addEventListener('click', () => navigate('#/parent'))
    root.querySelector('#share')?.addEventListener('click', () => {
      // 사용자가 공유 시트를 닫는 것은 실패가 아니다(AbortError) — 조용히 무시한다.
      navigator.share({ text: shareText(w, today) }).catch(() => {})
    })

    const confirmEl = root.querySelector('#confirm')!
    // #confirm은 내보내기 확인과 초기화 확인이 공유하는 컨테이너다. 한쪽이 다른 쪽
    // 위에 새 패널을 그리면 replaceChildren이 이전 패널의 DOM과 그 안의 리스너를
    // 통째로 없애는데, 그 패널이 들고 있던 상태(예: resetBusy)를 정리하지 않으면
    // 그 상태를 해제할 버튼 자체가 사라져 잠금이 고착된다 — 초기화 확인 배너가 뜬
    // 채로 "데이터 내보내기"를 누르면 #confirm이 export 배너로 덮이며 #reset-yes/
    // #reset-cancel이 사라지고, resetBusy를 false로 되돌릴 방법이 없어 "가져오기"
    // 버튼이 토스트도 에러도 없이 영구히 비활성으로 남았다(리뷰에서 발견). 아래 두
    // 함수를 #confirm을 채우거나 비우는 유일한 통로로 삼아 "누가 덮든 이전 패널이
    // 자기 정리를 한다"를 구조로 보장한다. cleanup 참조가 이전과 같으면(같은 패널이
    // 자기 자신을 다시 그리는 경우, 예: 초기화 배너가 떠 있는 채로 "모든 기록
    // 지우기"를 또 눌러 배너를 새로 그리는 기존 동작) 정리를 건너뛴다 — 안 그러면
    // 매 재클릭마다 자기 플래그를 껐다 켜는 사이에 버튼이 순간적으로 풀리는
    // 타이밍 버그가 생긴다.
    let confirmCleanup: (() => void) | null = null
    const showConfirmPanel = (node: HTMLElement, cleanup: (() => void) | null): void => {
      if (confirmCleanup && confirmCleanup !== cleanup) confirmCleanup()
      confirmCleanup = cleanup
      confirmEl.replaceChildren(node)
    }
    const clearConfirmPanel = (): void => {
      confirmCleanup?.()
      confirmCleanup = null
      confirmEl.replaceChildren()
    }

    root.querySelector('#export')!.addEventListener('click', () => {
      const at = location.hash
      try {
        triggerDownload(days, meta, today)
      } catch (e) {
        showError(`내보내지 못했어요: ${(e as Error).message}`)
        return
      }
      clearError()
      toast('백업 파일을 저장했어요', { tone: 'positive' })
      // 다운로드 "완료"는 브라우저가 알려주지 않는다 — 사람에게 저장했는지 물어서만
      // lastExportedAt을 갱신한다(triggerDownload의 주석 참고). 초기화 확인과 같은
      // #confirm을 쓴다 — showConfirmPanel이 겹침을 정리한다(가져오기는 confirmDialog
      // 오버레이로 빠져 있어 이 컨테이너를 안 쓴다). 이 배너는 지울 상태가 없어
      // cleanup은 null이다.
      showConfirmPanel(
        el(`
          <div class="banner">
            파일 앱(또는 다운로드 폴더)에 저장했나요?<br />
            <button class="step" id="export-yes">네, 저장했어요</button>
            <button class="step" id="export-no">아니요</button>
          </div>
        `),
        null,
      )
      confirmEl.querySelector('#export-no')!.addEventListener('click', () => {
        clearConfirmPanel()
      })
      confirmEl.querySelector('#export-yes')!.addEventListener('click', () => {
        putMeta({
          ...meta,
          settings: { ...meta.settings, lastExportedAt: new Date().toISOString() },
        })
          .then(() => {
            if (location.hash !== at) return
            toast('저장 확인을 기록했어요', { tone: 'positive' })
            void renderReport(root) // 배지 갱신 반영
          })
          .catch((e) => {
            if (location.hash !== at) return
            showError(`저장 확인을 기록하지 못했어요: ${(e as Error).message}`)
          })
      })
    })

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
    const setImportBusy = (v: boolean) => {
      importBusy = v
      const resetBtn = root.querySelector<HTMLButtonElement>('#reset')
      if (resetBtn) resetBtn.disabled = v
    }
    const setResetBusy = (v: boolean) => {
      resetBusy = v
      const importBtnNow = root.querySelector<HTMLButtonElement>('#import')
      if (importBtnNow) importBtnNow.disabled = v
    }
    // 이 렌더가 시작되는 시점에 이미(예: 화면을 떠났다가 다시 들어왔는데 이전
    // 렌더에서 시작한 가져오기·초기화가 아직 진행 중인 경우) importBusy/resetBusy가
    // true일 수 있다 — 새로 그려진 버튼은 HTML 템플릿상 기본으로 활성 상태이므로,
    // 여기서 한 번 동기화하지 않으면 진행 중인 작업이 있는데도 새 렌더의 버튼이
    // 눌려 두 번째 흐름이 시작될 수 있다. #reset은 기록이 있을 때만 그려지므로 ?.가
    // 필요하다.
    importBtn.disabled = resetBusy
    const resetBtnInit = root.querySelector<HTMLButtonElement>('#reset')
    if (resetBtnInit) resetBtnInit.disabled = importBusy
    // showConfirmPanel에 매번 같은 함수 참조를 넘기기 위해 클릭 핸들러 밖에서 한 번만
    // 만든다 — 초기화 패널이 자기 자신을 다시 그릴 때(재클릭) cleanup 참조가 같아야
    // showConfirmPanel이 "겹쳐 그리기"가 아니라 "자기 재그리기"로 인식해 정리를
    // 건너뛴다.
    const resetPanelCleanup = () => setResetBusy(false)
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
      const at = location.hash
      void file
        .text()
        .then(async (text) => {
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
          // 백업의 날짜는 validateBackup이 형식만 볼 뿐 내용은 검사하지 않는 값이라
          // 임의 문자열일 수 있다 — confirmDialog의 description은 textContent로만
          // 들어가므로(el() 보간이 아니다) 이스케이프 없이 그대로 넘겨도 안전하다.
          const range =
            v.days.length > 0 ? ` (${v.days[0]!.date} ~ ${v.days[v.days.length - 1]!.date})` : ''
          const ok = await confirmDialog({
            title: '현재 기록을 지우고 복구할까요?',
            description: [
              `이 백업: ${v.days.length}일치${range}`,
              `현재 기록 ${days.length}일치를 완전히 대체합니다. 병합하지 않아요.`,
              '되돌릴 수 없어요.',
            ],
            confirmLabel: '복구',
            cancelLabel: '취소',
            tone: 'critical',
          })
          // confirmDialog는 해시가 바뀌면(예: 이 대기 중에 초기화가 먼저 끝나 #/parent로
          // 넘어간 경우) 스스로 false로 닫힌다(ui.ts) — 그래서 이 경로는 "사용자가
          // 취소를 눌렀을 때"와 "다른 파괴적 작업이 먼저 끝나 화면이 넘어갔을 때"를
          // 함께 처리한다.
          if (!ok) {
            setImportBusy(false)
            return
          }
          return replaceAll(v.days, v.meta)
            .then(() => {
              setImportBusy(false)
              if (location.hash !== at) return
              toast('복구했어요', { tone: 'positive' })
              navigate('#/parent')
            })
            .catch((e) => {
              setImportBusy(false)
              // replaceAll은 원자적이다 — 실패해도 기존 데이터는 그대로다(db.test가 증명).
              if (location.hash !== at) return
              showError(`복구하지 못했어요 (기존 기록은 그대로예요): ${(e as Error).message}`)
            })
        })
        .catch((e) => {
          // 파일을 고른 뒤 읽기 자체가 실패하는 경우(권한 취소, iCloud 미다운로드 등) —
          // 여기 .catch가 없으면 사용자는 파일을 골랐는데 아무 반응도 못 본다.
          setImportBusy(false)
          if (location.hash !== at) return
          showError(`파일을 읽지 못했어요: ${(e as Error).message}`)
        })
    })

    // 버튼은 기록이 있을 때만 그려지므로 ?. 가 필요하다.
    root.querySelector('#reset')?.addEventListener('click', () => {
      if (importBusy) return
      setResetBusy(true)
      const at = location.hash
      clearError()
      // 버튼이 존재한다 = days.length > 0. 날짜는 백업을 거쳐 온 값이라 이스케이프한다.
      const range = `${escapeHtml(days[0]!.date)} ~ ${escapeHtml(days[days.length - 1]!.date)}`
      const ungraded = ungradedSheetCount(days, today)
      const since = daysSinceExport(meta, today)
      // 되돌릴 수 없는 삭제 앞에서는 하루 전 백업도 경고할 값이 있어서 ⚠를 조건부로 붙이지
      // 않는다. 막지는 않는다 — lastExportedAt은 "저장했나요? → 네"라는 사람의 대답으로만
      // 갱신되므로(triggerDownload 주석) 강제 게이트로 쓰면 거짓 안전감을 준다.
      const backupLine =
        since === null
          ? '⚠ 백업한 적이 없어요'
          : `⚠ 마지막 백업: ${since === 0 ? '오늘' : `${since}일 전`}`
      // 내보내기 확인과 같은 #confirm을 쓴다 — showConfirmPanel이 겹침을 정리한다
      // (resetPanelCleanup, 위 선언부 주석 참고).
      showConfirmPanel(
        el(`
          <div class="banner">
            ${days.length}일치 기록(${range})을 지우고 처음 상태로 되돌립니다.<br />
            <strong>되돌릴 수 없어요.</strong><br />
            ${
              ungraded > 0
                ? `⚠ 아직 채점하지 않은 문제지가 ${ungraded}일치 있어요 — 그 종이는 채점할 수 없게 됩니다.<br />`
                : ''
            }
            ${backupLine}<br />
            <button class="step" id="reset-yes">네, 지울게요</button>
            <button class="step" id="reset-cancel">취소</button>
          </div>
        `),
        resetPanelCleanup,
      )
      confirmEl.querySelector('#reset-cancel')!.addEventListener('click', () => {
        clearConfirmPanel()
      })
      const yes = confirmEl.querySelector<HTMLButtonElement>('#reset-yes')!
      yes.addEventListener('click', () => {
        // 이중 탭 가드. IndexedDB 왕복이 한 프레임보다 길어 두 번 눌릴 수 있다.
        yes.disabled = true
        resetAll()
          .then(() => {
            setResetBusy(false)
            if (location.hash !== at) return
            navigate('#/parent')
          })
          .catch((e) => {
            // resetAll은 replaceAll을 그대로 태우므로 원자적이다 — 실패해도 기록은 그대로다.
            setResetBusy(false)
            if (location.hash !== at) return
            yes.disabled = false
            showError(`지우지 못했어요 (기록은 그대로예요): ${(e as Error).message}`)
          })
      })
    })
  } catch (e) {
    showError(`리포트를 열지 못했어요: ${(e as Error).message}`)
    root.replaceChildren(el(`<div><button class="step" id="back">← 홈</button></div>`))
    root.querySelector('#back')!.addEventListener('click', () => navigate('#/parent'))
  }
}
