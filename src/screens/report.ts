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
      putMeta({
        ...meta,
        settings: { ...meta.settings, lastExportedAt: new Date().toISOString() },
      })
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
          // 파일은 이미 내려갔다 — 이건 백업 실패가 아니라 기록 실패다.
          showError('백업 기록을 남기지 못했어요.', e)
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
        .then((cur) => putMeta({ ...cur, settings: { ...cur.settings, lastExportedAt: prev } }))
        .then(() => {
          toast('백업 기록을 되돌렸어요')
          if (location.hash === at) void renderReport(root)
        })
        .catch((e) => {
          if (location.hash !== at) return
          showError('백업 기록을 되돌리지 못했어요.', e)
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
              showError('복구하지 못했어요 (기존 기록은 그대로예요).', e)
            })
        })
        .catch((e) => {
          // 파일을 고른 뒤 읽기 자체가 실패하는 경우(권한 취소, iCloud 미다운로드 등) —
          // 여기 .catch가 없으면 사용자는 파일을 골랐는데 아무 반응도 못 본다.
          setImportBusy(false)
          if (location.hash !== at) return
          showError('파일을 읽지 못했어요.', e)
        })
    })

    // 버튼은 기록이 있을 때만 그려지므로 ?. 가 필요하다.
    root.querySelector('#reset')?.addEventListener('click', () => {
      if (importBusy) return
      setResetBusy(true)
      const at = location.hash
      clearError()
      // 버튼이 존재한다 = days.length > 0. confirmDialog는 모든 줄을 textContent로 넣으므로
      // (ui.ts) 이스케이프하지 않는다 — 여기서 escapeHtml을 거치면 &amp; 같은 문자열이
      // 글자 그대로 보인다(가져오기 확인이 같은 이유로 그대로 넘긴다).
      const range = `${days[0]!.date} ~ ${days[days.length - 1]!.date}`
      const ungraded = ungradedSheetCount(days, today)
      const since = daysSinceExport(meta, today)
      // 되돌릴 수 없는 삭제 앞에서는 하루 전 백업도 경고할 값이 있어서 ⚠를 조건부로 붙이지
      // 않는다. 막지는 않는다 — lastExportedAt은 "내보내기를 눌렀다"에 되돌리기가 붙은
      // 값이라(위 #export 핸들러 주석) 강제 게이트로 쓰면 거짓 안전감을 준다.
      const backupLine =
        since === null
          ? '⚠ 백업한 적이 없어요'
          : `⚠ 마지막 백업: ${since === 0 ? '오늘' : `${since}일 전`}`
      // 되돌릴 수 없는 전체 삭제라 가져오기 확인과 같은 컴포넌트·같은 tone을 쓴다.
      // confirmDialog가 취소·배경 클릭·Esc·화면 전환을 전부 false로 모아 주므로 취소
      // 핸들러가 따로 필요 없고, settle이 정확히 한 번만 resolve해 이중 탭 가드
      // (예전의 yes.disabled)도 필요 없다.
      void confirmDialog({
        title: '모든 기록을 지울까요?',
        description: [
          `${days.length}일치 기록(${range})을 지우고 처음 상태로 되돌립니다.`,
          '되돌릴 수 없어요.',
          ...(ungraded > 0
            ? [
                `⚠ 아직 채점하지 않은 문제지가 ${ungraded}일치 있어요 — 그 종이는 채점할 수 없게 됩니다.`,
              ]
            : []),
          backupLine,
        ],
        confirmLabel: '네, 지울게요',
        cancelLabel: '취소',
        tone: 'critical',
      }).then((ok) => {
        if (!ok) {
          setResetBusy(false)
          return
        }
        return resetAll()
          .then(() => {
            setResetBusy(false)
            if (location.hash !== at) return
            navigate('#/parent')
          })
          .catch((e) => {
            // resetAll은 replaceAll을 그대로 태우므로 원자적이다 — 실패해도 기록은 그대로다.
            setResetBusy(false)
            if (location.hash !== at) return
            showError('지우지 못했어요 (기록은 그대로예요).', e)
          })
      })
    })
  } catch (e) {
    showError('리포트를 열지 못했어요.', e)
    root.replaceChildren(el(`<div><button class="step" id="back">← 홈</button></div>`))
    root.querySelector('#back')!.addEventListener('click', () => navigate('#/parent'))
  }
}
