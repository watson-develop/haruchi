import { getAllDays, getDeviceState, getMeta, getOutbox, updateDeviceState } from '../data/db'
import {
  claimInvite,
  configured,
  dismissRebasedNotice,
  isQuarantineGraded,
  issueInvite,
  resolveAdoptServer,
  resolveKeepMine,
  serverStatus,
  syncNotice,
} from '../data/sync'
import { checkupNoticeDate } from '../engine/checkup'
import { THINKING_ITEMS_PER_DAY } from '../engine/compose'
import { dayKey } from '../engine/dates'
import { completedCount, pendingGradeDate } from '../engine/report'
import { deriveVerticalCount } from '../engine/derive'
import { foldOutbox } from '../engine/outbox'
import { sprintStreak } from '../engine/streak'
import { syncStatus } from '../engine/sync-status'
import { clearError, confirmDialog, el, escapeHtml, formatDate, navigate, showError } from '../ui'

/** 상태줄 한 덩어리. 인증 실패를 나중에 알게 되면 이 함수로 같은 자리를 다시 그린다 —
 *  문구·톤 판정은 engine/sync-status.ts가 하고 여기서는 그리기만 한다. */
function statusLineHtml(status: { tone: string; lines: string[] }): string {
  return `<div id="sync-line" class="sync-status ${status.tone === 'warn' ? 'sync-warn' : ''}">
              ${status.lines.map((l) => `<div>${escapeHtml(l)}</div>`).join('')}
            </div>`
}

/** warn 톤 배너 한 장. 이 화면의 경고는 전부 같은 모양이어야 아빠가 하나만 알아보면 된다. */
function warnBanner(inner: string): string {
  return `<div class="banner seed-callout__root seed-callout__root--tone_warning">
            <div class="seed-callout__content">${inner}</div>
          </div>`
}

function warnText(text: string): string {
  return `<span class="seed-callout__description seed-callout__description--tone_warning">${text}</span>`
}

/**
 * 격리 배너(설계 2단계 §2 「sheet 충돌은 병합하지 않고 격리한다」). 두 기기가 같은 날
 * 문제지를 각자 만들면 종이가 물리적으로 둘이고, **어느 것에 아이가 풀었는지는 아빠만
 * 안다** — 그래서 병합 엔진은 고르기를 거부하고 여기로 보낸다. 이 배너가 유일한 탈출구다.
 *
 * `graded`는 서버 쪽에 이미 채점이 있는 경우다. 그때 「유지」는 서버 함수가 거부하므로
 * (`sheet_rewrite_graded`) 애초에 내놓지 않는다 — 누를 수 없는 버튼을 보여 주는 대신
 * 「채택」만 남긴다.
 *
 * 문구는 전부 우리 리터럴이고, 날짜만 escapeHtml을 지난다.
 */
function quarantineHtml(date: string, graded: boolean): string {
  const when = escapeHtml(formatDate(date))
  return warnBanner(`
      ${warnText(
        graded
          ? `${when} — 다른 기기에서 이미 채점까지 마쳤어요. 그 기기 문제지에 맞춰야 해요.`
          : `${when} — 다른 기기에서 문제지를 먼저 만들었어요. 어느 종이로 채점할지 골라 주세요.`,
      )}<br />
      ${graded ? '' : '<button class="step q-keep">이 기기 종이 유지</button>'}
      <button class="step q-adopt">다른 기기 것 채택</button>`)
}

/**
 * 배너 하나를 host에 그리고 버튼을 잇는다. 스스로를 다시 불러 「유지 → 채점 있음」 전환을
 * 같은 자리에서 처리한다 — 화면 전체를 다시 그리면 아빠가 방금 누른 자리를 잃는다.
 *
 * 해소가 끝나면 부모 홈을 통째로 다시 그린다: 격리 목록은 IndexedDB에 있고 화면은 매번
 * 거기서 다시 읽으므로, 실제로 풀렸는지를 화면이 자기 기억이 아니라 저장소에 묻는다.
 */
function wireQuarantine(root: HTMLElement, host: HTMLElement, date: string, graded: boolean): void {
  host.replaceChildren(el(quarantineHtml(date, graded)))
  const at = location.hash
  const busy = (): void => {
    // 누른 뒤 응답까지 몇 초가 걸린다(서버 조회 + push). 버튼을 지워 두 번 눌리는 것을
    // 막는다 — 「유지」와 「채택」이 겹쳐 돌면 방금 고른 것이 뒤집힌다.
    host.replaceChildren(
      el(warnBanner(warnText(`${escapeHtml(formatDate(date))} — 다른 기기와 맞추는 중이에요…`))),
    )
  }
  const fail = (e: unknown, message: string): void => {
    showError(message, e)
    if (location.hash === at) wireQuarantine(root, host, date, graded)
  }
  host.querySelector('.q-keep')?.addEventListener('click', () => {
    busy()
    resolveKeepMine(date)
      .then((result) => {
        if (location.hash !== at) return
        // 그사이 다른 기기가 채점을 마쳤다 — 「유지」는 불가능해졌고 「채택」만 남는다.
        if (result === 'graded') return wireQuarantine(root, host, date, true)
        return renderParentHome(root)
      })
      .catch((e) => fail(e, '이 기기 종이로 맞추지 못했어요.'))
  })
  host.querySelector('.q-adopt')!.addEventListener('click', () => {
    busy()
    resolveAdoptServer(date)
      .then(() => {
        if (location.hash !== at) return
        return renderParentHome(root)
      })
      .catch((e) => fail(e, '다른 기기 문제지를 받아오지 못했어요.'))
  })
}

/**
 * 부모 홈(설계 2026-08-04-role-based-ui §4). 인쇄·채점·리포트가 여기 있다.
 *
 * ✅ 완료일수가 이쪽에 있는 이유: 기본 설계 §6.8이 "관대함(🔥)과 정직함(✅)을 두
 * 숫자로 분리한다"고 정해 뒀는데, 옛 홈은 둘을 한 줄에 나란히 놓아 그 분리를
 * 화면에서 지키지 못했다. 🔥는 아이 홈으로 갔고 여기에는 참고로만 병기한다.
 */
export async function renderParentHome(root: HTMLElement): Promise<void> {
  try {
    const meta = await getMeta()
    const days = await getAllDays()
    const today = dayKey(new Date())
    const device = await getDeviceState()
    const outbox = await getOutbox()
    // 표식은 한 날짜에 여러 개 쌓인다(인쇄 + 스프린트 + 채점이 각각 하나) — 그대로 세면
    // "기록 3건"이 하루를 셋으로 부풀려 실제보다 많이 밀린 것처럼 보인다. push가 올리는
    // 단위(target)로 접어서 센다 — 접기의 주인은 engine/outbox.ts의 foldOutbox 하나다.
    const pendingCount = foldOutbox(outbox).length
    const statusInput = {
      registered: device.deviceKey !== null,
      authFailed: false,
      outboxCount: pendingCount,
      lastSyncAt: device.lastSyncAt,
      today,
    }
    const status = syncStatus(statusInput)
    // sync-config.ts가 비어 있으면(서버 준비 전) 부모 홈은 오늘과 완전히 같아야 한다 —
    // registered 여부만으로 판단하면 미등록 상태가 우연히 setup 톤을 만들어 등록 블록이
    // 새지만, 그건 서버가 없는데 등록을 권하는 셈이라 무의미하다. 그래서 게이트는
    // status.tone이 아니라 sync.ts의 configured()를 그대로 쓴다 — "설정됐다"의 정의는
    // 거기 하나뿐이고(URL과 ANON_KEY 둘 다 요구), 여기서 SUPABASE_URL만 따로 검사하면
    // URL만 채워지고 키가 아직 빈 과도기에 화면은 등록 블록을 그리는데 push는
    // configured() === false로 조용히 no-op돼 어긋난다.
    const syncHtml = !configured()
      ? ''
      : status.tone === 'setup'
        ? `<div class="sync-setup">
              <p>${escapeHtml(status.lines[0]!)}</p>
              <input id="invite-code" inputmode="numeric" autocomplete="off" maxlength="8" placeholder="6자리 코드" />
              <input id="device-label" autocomplete="off" placeholder="이 기기 이름 (예: 엄마 폰)" />
              <button id="invite-claim" class="step">연결하기</button>
              <p class="sync-hint" id="invite-hint">등록된 기기의 부모 홈 → 「새 기기 추가」로 코드를 만들어요</p>
            </div>`
        : `${statusLineHtml(status)}<div class="links"><button id="invite-issue">새 기기 추가</button></div><div id="invite-zone"></div>`
    // 알림 둘(설계 2단계 §2 「내려온 것을 믿지 않는다」·§3 재기준화). 상태를 세우는 곳은
    // 동기화 엔진 하나이고 여기서는 그리기만 한다.
    //
    // `rejected`에는 지울 방법이 없는 키가 섞일 수 있다 — 서버 행의 date 열이 문자열이
    // 아니면 `'알 수 없는 날짜'`로 들어오고, 그 키에 대응하는 날짜가 없어 어떤 pull도
    // 풀어 주지 못한다. 그래서 문구가 "곧 사라져요" 같은 약속을 하지 않는다: 지금 이
    // 기기에 반영되지 못한 것이 있다는 **사실만** 말한다(새로고침하면 목록은 사라지고,
    // 다음 pull이 같은 판정을 다시 내린다 — 상태는 기기 메모리에만 산다).
    const notice = syncNotice()
    const noticeHtml = !configured()
      ? ''
      : `${
          notice.rebased
            ? warnBanner(
                `${warnText('다른 기기에서 기록이 교체되어 이 기기를 맞췄어요.')}<br /><button class="step" id="rebased-ok">확인</button>`,
              )
            : ''
        }${
          notice.rejected.length > 0
            ? warnBanner(
                warnText(
                  `이 앱이 읽지 못한 서버 기록이 있어요: ${notice.rejected.map((k) => escapeHtml(k)).join(', ')} — 그만큼은 이 기기에 반영되지 않았어요.`,
                ),
              )
            : ''
        }`
    const verticalCount = deriveVerticalCount(days)
    const todayDay = days.find((d) => d.date === today)
    const printed = Boolean(todayDay?.sheet.length)
    const graded = Boolean(todayDay?.grades && Object.keys(todayDay.grades).length > 0)
    const pending = pendingGradeDate(days, today)
    // 최근 점검 안내(설계 `specs/2026-09-02-checkup-notice-design.md`). 날짜만 받는다 —
    // 유지·다시 연습 수는 PIN 뒤 리포트에만 둔다. 부모 홈은 PIN 밖이고 아이 홈의
    // 「부모 →」 한 탭으로 열리므로, 여기에 숫자를 실으면 리포트를 게이트한 근거
    // ("집계도 아이에게 안 보이는 것이 맞다", main.ts)를 게이트 밖으로 꺼내는 셈이 된다.
    const checkupDate = checkupNoticeDate(days, today)
    // 인쇄된 종이는 고정된 사실이고 파생값은 다음 종이의 예고다 — 이미 인쇄된 날은
    // 채점(예: 😫 3연속)이 그날의 파생값을 바꿔도 손에 든 종이는 그대로다. printed일 때는
    // sheet를 직접 세어 라벨이 항상 실제 종이와 일치하게 하고, 아직 인쇄 전일 때만
    // deriveVerticalCount 등 파생값을 다음 문제지의 미리보기로 쓴다.
    const sheetCounts = printed
      ? {
          vertical: todayDay!.sheet.filter((it) => it.kind === 'vertical').length,
          inverse: todayDay!.sheet.filter((it) => it.kind === 'inverse').length,
          thinking: todayDay!.sheet.filter((it) => it.kind === 'strategy' || it.kind === 'word')
            .length,
          total: todayDay!.sheet.length,
        }
      : null

    root.replaceChildren(
      el(`
        <div>
          <h1>하루치 · 부모</h1>
          <div class="date">${formatDate(today)}</div>
          <div class="streak">
            ✅ ${completedCount(days)}일 완료 &nbsp;·&nbsp; 🔥 ${sprintStreak(days, today)}일 연속
          </div>
          <div id="quarantine"></div>
          ${
            pending
              ? `<div class="banner seed-callout__root seed-callout__root--tone_warning" id="pending" role="button" tabindex="0"><span class="seed-callout__description seed-callout__description--tone_warning">${formatDate(pending)} 채점이 안 됐어요 — 지금 하기</span></div>`
              : ''
          }
          ${
            // 톤이 informative인 이유: 이 배너는 행동을 요구하지 않는다. 경고 톤은 아빠가
            // 할 일이 있는 것(미채점·격리)에만 쓴다 — 그래야 경고 하나만 알아보면 된다.
            checkupDate
              ? `<div class="banner seed-callout__root seed-callout__root--tone_informative" id="checkup-notice" role="button" tabindex="0"><span class="seed-callout__description seed-callout__description--tone_informative">${formatDate(checkupDate)} 점검 결과가 있어요 · 리포트 보기</span></div>`
              : ''
          }
          <button class="step ${printed ? 'done' : ''}" id="print">
            ${printed ? '✓ ' : ''}문제지 인쇄
            <small>${
              sheetCounts
                ? `세로셈 ${sheetCounts.vertical} + □ 채우기 ${sheetCounts.inverse} + 생각하는 문제 ${sheetCounts.thinking} (${sheetCounts.total}문항 · 2장)`
                : `세로셈 ${verticalCount} + □ 채우기 ${meta.settings.inverseCount} + 생각하는 문제 ${THINKING_ITEMS_PER_DAY} (${verticalCount + meta.settings.inverseCount + THINKING_ITEMS_PER_DAY}문항 · 2장)`
            }</small>
          </button>
          <button class="step ${graded ? 'done' : ''}" id="grade" ${printed ? '' : 'disabled'}>
            ${graded ? '✓ ' : ''}채점하기
            <small>${printed ? '틀린 것만 눌러주세요' : '문제지를 먼저 인쇄해주세요'}</small>
          </button>
          <button class="step" id="report">
            리포트
            <small>주간·월간 — 일요일 채점 뒤엔 자동으로 열려요</small>
          </button>
          ${noticeHtml}
          ${syncHtml}
          <div class="links"><button id="ebs">EBS 강의</button></div>
          <div class="links"><button id="child">← 아이 화면</button></div>
        </div>
      `),
    )

    // 격리는 날짜마다 독립이다 — 하나를 골라도 다른 날의 배너는 그대로 남아야 한다.
    // 그래서 날짜마다 host를 따로 두고 각자 자기 배너만 다시 그린다.
    const zone = root.querySelector<HTMLDivElement>('#quarantine')!
    for (const date of device.quarantine) {
      const host = document.createElement('div')
      zone.append(host)
      // 「채택」만 남는 변형은 렌더를 넘어 남아야 한다 — 배경 pull이 이 화면을 다시 그릴 때
      // 「이 기기 종이 유지」가 되살아나면 아빠는 눌러서 다시 거부당해야 이유를 알게 된다.
      // 판정을 세우는 곳은 동기화 엔진이고(push의 sheet_rewrite_graded 거부·「유지」의 사전
      // 확인) 여기서는 물어볼 뿐이다.
      wireQuarantine(root, host, date, isQuarantineGraded(date))
    }
    root.querySelector('#rebased-ok')?.addEventListener('click', () => {
      dismissRebasedNotice()
      navigate('#/parent') // 같은 해시 재라우팅은 안전하다(상태를 IndexedDB에서 다시 읽는다)
    })
    root.querySelector('#print')!.addEventListener('click', () => navigate('#/print'))
    root.querySelector('#grade')!.addEventListener('click', () => {
      if (!printed) return
      navigate('#/grade')
    })
    root.querySelector('#report')!.addEventListener('click', () => navigate('#/report'))
    root.querySelector('#ebs')!.addEventListener('click', () => navigate('#/ebs'))
    root.querySelector('#child')!.addEventListener('click', () => navigate('#/'))
    // 코드 등록(2C). 실패 둘의 결이 다르다 — {ok:false}는 사람이 고칠 입력 문제라
    // 안내 줄에만 쓰고(서버가 만든 문자열이라 textContent로만 넣는다 — el() 템플릿에
    // 넣지 않는다, XSS 경계), throw는 네트워크·서버 장애라 showError로 띄운다.
    root.querySelector('#invite-claim')?.addEventListener('click', () => {
      const codeInput = root.querySelector<HTMLInputElement>('#invite-code')!
      const labelInput = root.querySelector<HTMLInputElement>('#device-label')!
      const hint = root.querySelector<HTMLParagraphElement>('#invite-hint')!
      // 숫자만 남긴다 — 「123 456」처럼 띄어 적힌 코드를 붙여넣어도 통과해야 한다
      // (maxlength=6이 공백까지 세어 뒤 한 자리를 잘라내는 것도 이걸로 무해해진다).
      const code = codeInput.value.replace(/\D/g, '')
      if (!/^\d{6}$/.test(code)) {
        hint.textContent = '코드는 숫자 6자리예요'
        return
      }
      const btn = root.querySelector<HTMLButtonElement>('#invite-claim')!
      btn.disabled = true // 이중 클릭이 fail_count를 이중으로 태우지 않게
      hint.textContent = '연결하는 중…'
      claimInvite(code, labelInput.value.trim())
        .then((r) => {
          if (r.ok) {
            navigate('#/parent') // 같은 해시 재라우팅은 안전하다(상태를 IndexedDB에서 다시 읽는다)
            return
          }
          btn.disabled = false
          codeInput.value = ''
          hint.textContent = r.reason
        })
        .catch((e) => {
          btn.disabled = false
          showError('기기를 연결하지 못했어요.', e)
          hint.textContent = '연결에 실패했어요 — 잠시 뒤 다시 눌러 주세요'
        })
    })
    // 초대 발급(2C). 코드는 서버가 만든 값 그대로지만 우리 리터럴이 아니므로
    // textContent로만 넣는다(XSS 경계 — el() 템플릿에 넣지 않는다). 버튼은 zone 밖에
    // 살아 남으므로 다시 누르면 서버가 이전 코드를 만료시키고 새 코드가 표시된다.
    root.querySelector('#invite-issue')?.addEventListener('click', () => {
      const inviteZone = root.querySelector<HTMLDivElement>('#invite-zone')!
      const issueBtn = root.querySelector<HTMLButtonElement>('#invite-issue')!
      // 비행 중 재클릭을 막는다. 두 번 나가면 서버가 먼저 것을 만료시키는데 응답 도착
      // 순서는 보장되지 않아, 이미 죽은 코드가 화면에 남을 수 있다 — 아빠는 그것을
      // 새 기기에 넣고 「유효한 초대가 없어요」를 본다.
      issueBtn.disabled = true
      inviteZone.textContent = '코드를 만드는 중…'
      issueInvite()
        .then((r) => {
          issueBtn.disabled = false
          if (!r.ok) {
            // 상한·미등록 등 사람이 볼 사유(기기 상한 설계 §1) — 서버가 만든 문자열이라
            // textContent로만 넣는다(XSS 경계).
            inviteZone.textContent = r.reason
            return
          }
          inviteZone.replaceChildren()
          const codeEl = document.createElement('div')
          codeEl.className = 'invite-code'
          codeEl.textContent = r.code
          const note = document.createElement('p')
          note.className = 'sync-hint'
          note.textContent =
            '10분 안에 새 기기의 부모 홈에서 이 코드를 입력하세요. 다시 누르면 이 코드는 무효가 되고 새 코드가 나와요.'
          inviteZone.append(codeEl, note)
        })
        .catch((e) => {
          issueBtn.disabled = false
          inviteZone.textContent = ''
          // 발급 버튼은 등록된 상태에서만 그려지므로, 여기 실패는 대개 이 기기의 키가
          // 그새 폐기된 예외 상황이다 — 사람 말 문구에 그 가능성을 한 줄 덧붙인다.
          showError('초대 코드를 만들지 못했어요 — 이 기기의 등록이 취소됐을 수 있어요.', e)
        })
    })
    // 키가 아직 통하는지 확인한다. **렌더를 여기 걸지 않는다** — 먼저 그리고, 응답이
    // 오면 상태줄만 바꾼다(서버가 죽어 있어도 부모 홈은 즉시 뜬다).
    //
    // 폐기된 키는 401이 아니라 "행이 하나도 안 보이는 200"으로 온다(sync.ts serverStatus의
    // 주석). 그래서 이 확인이 없으면 키를 폐기당한 기기는 "서버는 멀쩡한데 기록만 안
    // 올라가는" 상태로 몇 주를 보낸다 — 설계 §3이 "부모 홈에 명시한다"고 못 박은 경우다.
    // 미설정·미등록이면 요청 자체가 나가지 않는다(inert 보장).
    if (configured() && device.deviceKey !== null) {
      const at = location.hash
      void serverStatus().then((s) => {
        if (s !== 'unauthorized' || location.hash !== at) return
        const line = root.querySelector('#sync-line')
        line?.replaceWith(el(statusLineHtml(syncStatus({ ...statusInput, authFailed: true }))))
        // 재연결 버튼(기기 상한 설계 §4). **배선이 이 .then 안에 있는 것이 계약이다** —
        // 상태줄은 응답이 도착해 #sync-line을 갈아 끼울 때 비로소 authFailed가 되므로,
        // 렌더 시점에는 이 버튼을 붙일 자리 자체가 없다.
        //
        // 로컬 deviceKey만 지운다. 그 키는 서버가 이미 거부한 값이라 지워도 데이터
        // 손실이 없다. 커서·시딩 리셋은 하지 않는다 — claim 성공이 어차피 전부 비운다
        // (sync.ts claimInvite). 다이얼로그가 실비용을 말한다: 새 코드가 필요해진다.
        const zone = document.createElement('div')
        zone.className = 'links'
        const btn = document.createElement('button')
        btn.textContent = '다시 연결하기'
        btn.addEventListener('click', () => {
          void confirmDialog({
            title: '이 기기를 다시 연결할까요?',
            description: [
              '이 기기의 연결 정보를 지워요.',
              '다시 연결하려면 다른 기기에서 새 초대 코드를 받아야 해요.',
            ],
            confirmLabel: '연결 정보 지우기',
            cancelLabel: '취소',
            tone: 'critical',
          }).then((yes) => {
            if (!yes) return
            btn.disabled = true
            void updateDeviceState((st) => ({ ...st, deviceKey: null }))
              .then(() => navigate('#/parent'))
              .catch((e) => {
                btn.disabled = false
                showError('연결 정보를 지우지 못했어요.', e)
              })
          })
        })
        zone.append(btn)
        // 교체 후의 #sync-line을 다시 찾는다 — 위 replaceWith가 만든 것은 새 노드라
        // `line` 참조는 이미 문서에서 떨어져 있다.
        root.querySelector('#sync-line')?.after(zone)
      })
    }
    // role="button" + tabindex를 준 이상 키보드로도 눌려야 한다 — 역할만 주고 활성화를
    // 막으면 스크린리더에는 버튼이라고 알리면서 실제로는 누를 수 없는 상태가 된다.
    const pendingBanner = root.querySelector<HTMLDivElement>('#pending')
    pendingBanner?.addEventListener('click', () => navigate(`#/grade/${pending}`))
    pendingBanner?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        navigate(`#/grade/${pending}`)
      }
    })
    // 미채점 배너와 같은 관례다. 목적지 #/report는 PIN 게이트 뒤지만 기존 「리포트」
    // 버튼과 같은 경로라 새 게이트 처리가 없다.
    const checkupBanner = root.querySelector<HTMLDivElement>('#checkup-notice')
    checkupBanner?.addEventListener('click', () => navigate('#/report'))
    checkupBanner?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        navigate('#/report')
      }
    })
  } catch (e) {
    // 조회 실패를 전부 여기서 잡는다(옛 home.ts와 같은 패턴). showError는 body에만 붙으므로
    // 주소창 없는 스탠드얼론 PWA에서는 #app 안에도 조작 수단이 있어야 갇히지 않는다.
    // 부모 홈은 아이 홈으로 나갈 길도 함께 남긴다 — 재시도가 계속 실패해도 앱은 살아 있다.
    showError('화면을 열지 못했어요.', e)
    root.replaceChildren(
      el(`
        <div>
          <h1>하루치 · 부모</h1>
          <p class="date">기록을 열지 못했어요.</p>
          <button class="step" id="retry">다시 시도</button>
          <div class="links"><button id="child">← 아이 화면</button></div>
        </div>
      `),
    )
    root.querySelector('#retry')!.addEventListener('click', () => {
      clearError()
      void renderParentHome(root)
    })
    root.querySelector('#child')!.addEventListener('click', () => navigate('#/'))
  }
}
