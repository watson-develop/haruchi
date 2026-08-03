import { getAllDays, getMeta, putMeta, replaceAll } from '../data/db'
import { dayKey } from '../engine/dates'
import { deriveFacts } from '../engine/facts'
import { weeklyReport, latestCheckupReport } from '../engine/report'
import type { WeeklyReport } from '../engine/report'
import { serializeBackup, validateBackup } from '../engine/backup'
import { factMapHtml } from './fact-map'
import { clearError, el, escapeHtml, formatDate, navigate, showError } from '../ui'
import type { Day, Meta } from '../data/types'

/** 유형 태그 → 아빠용 라벨. vertical.ts SPECS·types.ts InverseTag와 1:1이다. */
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
}

const sec = (ms: number) => `${(ms / 1000).toFixed(1)}초`

function shareText(w: WeeklyReport, today: string): string {
  const lines = [
    `하루치 주간 리포트 — ${formatDate(today, true)}`,
    `🔥 ${w.streak}일 연속 · ✅ ${w.completed}일 완료`,
    `구구단 ${w.fluentTotal}/81 정복${w.newlyFluent.length > 0 ? ` (이번 주 +${w.newlyFluent.length})` : ''}`,
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
          <button class="step" id="back">← 홈</button>
        </div>
      `),
    )

    root.querySelector('#back')!.addEventListener('click', () => navigate('#/'))
    root.querySelector('#share')?.addEventListener('click', () => {
      // 사용자가 공유 시트를 닫는 것은 실패가 아니다(AbortError) — 조용히 무시한다.
      navigator.share({ text: shareText(w, today) }).catch(() => {})
    })

    root.querySelector('#export')!.addEventListener('click', () => {
      const at = location.hash
      try {
        triggerDownload(days, meta, today)
      } catch (e) {
        showError(`내보내지 못했어요: ${(e as Error).message}`)
        return
      }
      clearError()
      // 다운로드 "완료"는 브라우저가 알려주지 않는다 — 사람에게 저장했는지 물어서만
      // lastExportedAt을 갱신한다(triggerDownload의 주석 참고). 가져오기 확인 패널과
      // 같은 #confirm을 쓴다 — 서로 덮어쓸 뿐 동시에 뜨지는 않는다.
      const confirm = root.querySelector('#confirm')!
      confirm.replaceChildren(
        el(`
          <div class="banner">
            파일 앱(또는 다운로드 폴더)에 저장했나요?<br />
            <button class="step" id="export-yes">네, 저장했어요</button>
            <button class="step" id="export-no">아니요</button>
          </div>
        `),
      )
      confirm.querySelector('#export-no')!.addEventListener('click', () => {
        confirm.replaceChildren()
      })
      confirm.querySelector('#export-yes')!.addEventListener('click', () => {
        putMeta({
          ...meta,
          settings: { ...meta.settings, lastExportedAt: new Date().toISOString() },
        })
          .then(() => {
            if (location.hash !== at) return
            void renderReport(root) // 배지 갱신 반영
          })
          .catch((e) => {
            if (location.hash !== at) return
            showError(`저장 확인을 기록하지 못했어요: ${(e as Error).message}`)
          })
      })
    })

    const fileInput = root.querySelector<HTMLInputElement>('#import-file')!
    root.querySelector('#import')!.addEventListener('click', () => {
      // 값을 먼저 비운다 — 안 그러면 내보내기 배너가 가져오기 확인 패널을 덮은 뒤(둘이
      // #confirm을 공유한다) 같은 파일을 다시 골라도 change가 안 떠서 복구가 조용히
      // 안 된다. 취소 핸들러만 비우던 것으로는 이 경로를 못 잡는다.
      fileInput.value = ''
      fileInput.click()
    })
    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0]
      if (!file) return
      const at = location.hash
      void file
        .text()
        .then((text) => {
          if (location.hash !== at) return
          let raw: unknown
          try {
            raw = JSON.parse(text)
          } catch {
            showError('JSON 파일이 아니에요. 하루치에서 내보낸 파일을 골라주세요.')
            return
          }
          const v = validateBackup(raw)
          if (!v.ok) {
            showError(`백업 파일이 아니에요: ${v.reason}`)
            return
          }
          clearError()
          // 화면 내 2단계 확인: 무엇을 무엇으로 덮는지 숫자로 보여준다(스펙 §3).
          const range =
            v.days.length > 0 ? ` (${v.days[0]!.date} ~ ${v.days[v.days.length - 1]!.date})` : ''
          const confirm = root.querySelector('#confirm')!
          confirm.replaceChildren(
            el(`
            <div class="banner">
              이 백업: ${v.days.length}일치${range}<br />
              현재 기록 ${days.length}일치를 <strong>완전히 대체</strong>합니다. 병합하지 않아요.<br />
              <button class="step" id="confirm-replace">현재 기록을 지우고 복구</button>
              <button class="step" id="confirm-cancel">취소</button>
            </div>
          `),
          )
          confirm.querySelector('#confirm-cancel')!.addEventListener('click', () => {
            confirm.replaceChildren()
            fileInput.value = ''
          })
          confirm.querySelector('#confirm-replace')!.addEventListener('click', () => {
            replaceAll(v.days, v.meta)
              .then(() => {
                if (location.hash !== at) return
                navigate('#/')
              })
              .catch((e) => {
                // replaceAll은 원자적이다 — 실패해도 기존 데이터는 그대로다(db.test가 증명).
                if (location.hash !== at) return
                showError(`복구하지 못했어요 (기존 기록은 그대로예요): ${(e as Error).message}`)
              })
          })
        })
        .catch((e) => {
          // 파일을 고른 뒤 읽기 자체가 실패하는 경우(권한 취소, iCloud 미다운로드 등) —
          // 여기 .catch가 없으면 사용자는 파일을 골랐는데 아무 반응도 못 본다.
          if (location.hash !== at) return
          showError(`파일을 읽지 못했어요: ${(e as Error).message}`)
        })
    })
  } catch (e) {
    showError(`리포트를 열지 못했어요: ${(e as Error).message}`)
    root.replaceChildren(el(`<div><button class="step" id="back">← 홈</button></div>`))
    root.querySelector('#back')!.addEventListener('click', () => navigate('#/'))
  }
}
