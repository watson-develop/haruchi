import {
  getAllDays,
  getDeviceState,
  getMeta,
  getOutbox,
  putMeta,
  updateDeviceState,
} from '../data/db'
import {
  claimInvite,
  claimWithPin,
  configured,
  dismissRebasedNotice,
  issueInvite,
  serverStatus,
  syncNotice,
  type ClaimResult,
} from '../data/sync'
import { checkupNoticeDate } from '../engine/checkup'
import { FACT_IDS, genieState, peakFluent } from '../engine/facts'
import { dayKey } from '../engine/dates'
import { foldOutbox } from '../engine/outbox'
import { sprintStreak } from '../engine/streak'
import { syncStatus } from '../engine/sync-status'
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

/** 상태줄 한 덩어리. 인증 실패를 나중에 알게 되면 이 함수로 같은 자리를 다시 그린다 —
 *  문구·톤 판정은 engine/sync-status.ts가 하고 여기서는 그리기만 한다. */
function statusLineHtml(status: { tone: string; lines: string[] }): string {
  return `<div id="sync-line" class="sync-status ${status.tone === 'warn' ? 'sync-warn' : ''}">
              ${status.lines.map((l) => `<div>${escapeHtml(l)}</div>`).join('')}
            </div>`
}

/**
 * 알림 한 줄(설계 `specs/2026-09-03-parent-home-layout-design.md`). 이 화면의 알림은
 * 전부 이 모양이다 — 성격은 **문구와 동작 이름**이 나르고, 색은 「데이터가 위험하거나
 * 막혀 있는가」(`risk`) 하나만 구분한다. 리포트 화면도 같은 어휘를 쓴다.
 *
 * 색을 아끼는 이유: 이 화면에는 알림이 네 종류까지 동시에 뜬다(점검 안내 +
 * 램프 + 재기준화 + 거부된 행). 각자 다른 톤의 슬래브를 쓰면 무엇이 급한지가
 * 오히려 사라지고, 리포트 진입이 화면 밖으로 밀린다.
 *
 * `text`와 `action`은 **이미 이스케이프된 마크업**이어야 한다. 이 함수는 검사하지 않는다.
 */
function noticeRow(kind: 'risk' | 'plain', text: string, action = ''): string {
  return `<div class="notice notice--${kind}">
            <span class="notice-text">${text}</span>${action}
          </div>`
}

/**
 * 알림 안의 인라인 동작. **진짜 `<button>`이다** — 옛 배너는 `div role="button"`이라
 * 키보드 핸들러를 손으로 붙여야 했고 눌림 피드백도 없었다(SEED 콜아웃의 active는
 * button·a에만 걸린다). 라벨은 눌렀을 때 실제로 일어나는 일을 말한다.
 */
function noticeAction(label: string, hook: { id: string }): string {
  return `<button class="notice-act" id="${hook.id}">${label}</button>`
}

/**
 * 부모 홈(설계 2026-08-04-role-based-ui §4). 알림·리포트·관리 진입이 여기 있다.
 * 종이 문제지·채점은 2026-09-30 은퇴했다(specs/2026-09-30-retire-paper-sheet-design.md).
 */
export async function renderParentHome(root: HTMLElement): Promise<void> {
  try {
    const meta = await getMeta()
    const days = await getAllDays()
    const today = dayKey(new Date())
    const device = await getDeviceState()
    const outbox = await getOutbox()
    // 표식은 한 날짜에 여러 개 쌓인다(스프린트를 할 때마다 하나씩) — 그대로
    // 세면 "기록 2건"이 하루를 둘로 부풀려 실제보다 많이 밀린 것처럼 보인다. push가 올리는
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
              <div class="sync-setup-pin">
                <p class="sync-hint">부모 기기를 모두 잃었나요? 한동안 어떤 부모 기기도 열리지 않았다면 부모 PIN으로 연결할 수 있어요</p>
                <input id="pin-input" type="password" inputmode="numeric" autocomplete="off" placeholder="부모 PIN" />
                <button id="pin-claim" class="step">PIN으로 연결</button>
                <p class="sync-hint" id="pin-hint"></p>
              </div>
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
    const syncNoticesHtml = !configured()
      ? ''
      : `${
          notice.rebased
            ? noticeRow(
                'plain',
                '다른 기기에서 기록이 교체되어 이 기기를 맞췄어요.',
                noticeAction('확인', { id: 'rebased-ok' }),
              )
            : ''
        }${
          notice.rejected.length > 0
            ? noticeRow(
                'plain',
                `이 앱이 읽지 못한 서버 기록이 있어요: ${notice.rejected.map((k) => escapeHtml(k)).join(', ')} — 그만큼은 이 기기에 반영되지 않았어요.`,
              )
            : ''
        }`
    // 최근 점검 안내(설계 `specs/2026-09-02-checkup-notice-design.md`). 날짜만 받는다 —
    // 유지·다시 연습 수는 PIN 뒤 리포트에만 둔다. 부모 홈은 PIN 밖이고 아이 홈의
    // 「부모 →」 한 탭으로 열리므로, 여기에 숫자를 실으면 리포트를 게이트한 근거
    // ("집계도 아이에게 안 보이는 것이 맞다", main.ts)를 게이트 밖으로 꺼내는 셈이 된다.
    const checkupDate = checkupNoticeDate(days, today)
    // 소원 기록(설계 `specs/2026-09-03-genie-contract-gauge-design.md`). wishGrantedAt이
    // 있으면 트로피라 peak와 무관하므로 로그 재생을 건너뛴다 — 부모 홈이 deriveFacts류를
    // 부르는 첫 사례이고, 안 불러도 되는 날은 안 부른다.
    const wish = meta.settings.wishGrantedAt ?? null
    const genie = genieState(wish === null ? peakFluent(days, meta.settings.fluentMs) : 0, wish)

    // 알림 개수는 아빠에게 실제 정보다 — 몇 개를 처리해야 이 화면이 조용해지는지 말한다.
    const syncNoticeCount = !configured()
      ? 0
      : (notice.rebased ? 1 : 0) + (notice.rejected.length > 0 ? 1 : 0)
    const noticeCount = (checkupDate ? 1 : 0) + (genie === 'lit' ? 1 : 0) + syncNoticeCount

    root.replaceChildren(
      el(`
        <div>
          <header class="phead">
            <h1>하루치 · 부모</h1>
            <p class="phead-meta">${formatDate(today)} · 🔥 ${sprintStreak(days, today)}일 연속</p>
          </header>

          ${noticeCount > 0 ? `<h2 class="psec">알림 ${noticeCount}</h2>` : ''}
          <div class="notices">
            ${
              checkupDate
                ? noticeRow(
                    'plain',
                    `${formatDate(checkupDate)} 점검 결과가 있어요`,
                    noticeAction('리포트 보기', { id: 'checkup-notice' }),
                  )
                : ''
            }
            ${
              genie === 'lit'
                ? noticeRow(
                    'plain',
                    `🪔 램프가 켜졌어요 — 구구단 ${FACT_IDS.length}칸을 다 채웠어요`,
                    noticeAction('소원 들어줬어요', { id: 'wish-grant' }),
                  )
                : ''
            }
            ${syncNoticesHtml}
          </div>

          <button class="step" id="report">
            리포트
            <small>주간·월간</small>
          </button>

          <div class="ptail">
            ${
              genie === 'trophy'
                ? `<p class="ptail-note">🪔 소원 들어줬어요 · ${escapeHtml(formatDate(wish!))} ${noticeAction('되돌리기', { id: 'wish-revert' })}</p>`
                : ''
            }
            ${syncHtml}
            <nav class="pmenu">
              <button id="ebs">EBS 강의</button>
              <button id="child">아이 화면</button>
            </nav>
          </div>
        </div>
      `),
    )

    root.querySelector('#rebased-ok')?.addEventListener('click', () => {
      dismissRebasedNotice()
      navigate('#/parent') // 같은 해시 재라우팅은 안전하다(상태를 IndexedDB에서 다시 읽는다)
    })
    root.querySelector('#report')!.addEventListener('click', () => navigate('#/report'))
    root.querySelector('#ebs')!.addEventListener('click', () => navigate('#/ebs'))
    root.querySelector('#child')!.addEventListener('click', () => navigate('#/'))
    // 등록(2C·PIN 기기 연결 설계 §3.2). 실패 둘의 결이 다르다 — {ok:false}는 사람이 고칠
    // 입력 문제라 안내 줄에만 쓰고(서버가 만든 문자열이라 textContent로만 넣는다 — el()
    // 템플릿에 넣지 않는다, XSS 경계), throw는 네트워크·서버 장애라 showError로 띄운다.
    // 진행 중에는 **두 버튼을 함께** 막는다 — 한쪽만 막으면 연타가 다른 경로의 실패
    // 카운터를 태운다(초대는 fail_count, PIN은 전역 pin_guard).
    const runClaim = (
      run: () => Promise<ClaimResult>,
      input: HTMLInputElement,
      hint: HTMLParagraphElement,
    ): void => {
      const btns = root.querySelectorAll<HTMLButtonElement>('#invite-claim, #pin-claim')
      btns.forEach((b) => (b.disabled = true))
      hint.textContent = '연결하는 중…'
      run()
        .then((r) => {
          if (r.ok) {
            navigate('#/parent') // 같은 해시 재라우팅은 안전하다(상태를 IndexedDB에서 다시 읽는다)
            return
          }
          btns.forEach((b) => (b.disabled = false))
          input.value = ''
          hint.textContent = r.reason
        })
        .catch((e) => {
          btns.forEach((b) => (b.disabled = false))
          showError('기기를 연결하지 못했어요.', e)
          hint.textContent = '연결에 실패했어요 — 잠시 뒤 다시 눌러 주세요'
        })
    }
    const labelOf = (): string =>
      root.querySelector<HTMLInputElement>('#device-label')!.value.trim()
    root.querySelector('#invite-claim')?.addEventListener('click', () => {
      const input = root.querySelector<HTMLInputElement>('#invite-code')!
      const hint = root.querySelector<HTMLParagraphElement>('#invite-hint')!
      // 숫자만 남긴다 — 「123 456」처럼 띄어 적힌 코드를 붙여넣어도 통과해야 한다
      // (maxlength=6이 공백까지 세어 뒤 한 자리를 잘라내는 것도 이걸로 무해해진다).
      const code = input.value.replace(/\D/g, '')
      if (!/^\d{6}$/.test(code)) {
        hint.textContent = '코드는 숫자 6자리예요'
        return
      }
      runClaim(() => claimInvite(code, labelOf()), input, hint)
    })
    root.querySelector('#pin-claim')?.addEventListener('click', () => {
      const input = root.querySelector<HTMLInputElement>('#pin-input')!
      const hint = root.querySelector<HTMLParagraphElement>('#pin-hint')!
      // PIN은 숫자 전용·길이 자유(README 6.5). 문자열 그대로 보낸다 — 앞자리 0 보존.
      // 숫자 아닌 문자는 벗기지 않고 거부한다(초대 코드와 다르다): 「12a4」를 「124」로 보내면
      // 전역 pin_guard의 5회 중 한 칸을 태운다 — 초대 코드는 실패 횟수가 코드마다라 무해했다.
      const pin = input.value.trim()
      if (!/^\d+$/.test(pin)) {
        hint.textContent = 'PIN은 숫자예요'
        return
      }
      runClaim(() => claimWithPin(pin, labelOf()), input, hint)
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
        // (sync.ts claim). 다이얼로그가 실비용을 말한다: 새 코드(비상이면 부모 PIN)가 필요해진다.
        const zone = document.createElement('div')
        zone.className = 'links'
        const btn = document.createElement('button')
        btn.textContent = '다시 연결하기'
        btn.addEventListener('click', () => {
          void confirmDialog({
            title: '이 기기를 다시 연결할까요?',
            description: [
              '이 기기의 연결 정보를 지워요.',
              '다시 연결하려면 다른 기기의 새 초대 코드가 필요해요. 부모 기기를 모두 잃었다면 부모 PIN으로도 연결할 수 있어요.',
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
    // 알림의 동작은 진짜 `<button>`이라 Enter·Space가 브라우저에서 온다 — 옛
    // `div role="button"` 배너에 손으로 붙이던 keydown 핸들러가 통째로 사라졌다.
    // #/report는 PIN 게이트 뒤지만 아래 「리포트」 버튼과 같은 경로라 새 처리가 없다.
    root.querySelector('#checkup-notice')?.addEventListener('click', () => navigate('#/report'))
    // 소원 기록. **렌더 시점 meta를 되쓰지 않는다** — 이 화면이 떠 있는 동안 pull이 다른
    // 기기의 settings를 앉혔을 수 있고, 낡은 스냅샷을 통째로 쓰면 그 값이 더 새 settingsAt을
    // 달고 서버로 올라가 전 기기에서 뒤집힌다(mergeMeta는 settings를 통째로 LWW한다).
    // manage.ts의 백업 되돌리기가 같은 이유로 같은 패턴을 쓴다.
    const setWish = (value: string | null, label: string): void => {
      void getMeta()
        .then((cur) =>
          putMeta({ ...cur, settings: { ...cur.settings, wishGrantedAt: value } }, ['settings']),
        )
        .then(() => {
          toast(label, {
            tone: 'positive',
            durationMs: 8000,
            action:
              value === null
                ? undefined
                : {
                    label: '안 들어줬어요',
                    onClick: () => setWish(null, '소원 기록을 되돌렸어요'),
                  },
          })
          navigate('#/parent') // 같은 해시 재라우팅은 안전하다(상태를 IndexedDB에서 다시 읽는다)
        })
        .catch((e) => showError('소원 기록을 남기지 못했어요.', e))
    }
    root.querySelector('#wish-grant')?.addEventListener('click', () => {
      setWish(dayKey(new Date()), '소원 들어줬어요')
    })
    root.querySelector('#wish-revert')?.addEventListener('click', () => {
      setWish(null, '소원 기록을 되돌렸어요')
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
