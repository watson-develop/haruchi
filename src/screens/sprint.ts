import { getAllDays, getDay, getDeviceState, getMeta, putDay } from '../data/db'
import { checkupDue, composeCheckup } from '../engine/checkup'
import { dayKey } from '../engine/dates'
import {
  composeSprint,
  deriveFacts,
  factAnswer,
  genieState,
  newlyFluentSince,
  peakFluent,
  requeueWrong,
  type GenieState,
} from '../engine/facts'
import { factMapHtml } from './fact-map'
import {
  clearError,
  el,
  genieEntryHtml,
  hapticTap,
  navigate,
  showError,
  wireGenieEntry,
} from '../ui'
import type { Day, FactState, SprintAttempt } from '../data/types'

/** 정답을 보여주는 시간. 즉시 넘기면 무엇이 맞았는지 볼 틈이 없다. */
const REVEAL_MS = 1500

function progressHtml(total: number, done: number): string {
  return Array.from({ length: total }, (_, i) => `<i class="${i < done ? 'done' : ''}"></i>`).join(
    '',
  )
}

function mean(xs: number[]): number | null {
  if (xs.length === 0) return null
  return xs.reduce((s, x) => s + x, 0) / xs.length
}

/** 어제까지의 정답 반응시간 평균. 오늘과 비교해 "얼마나 빨라졌는지"를 보여준다. */
function previousMean(days: Day[], today: string): number | null {
  const before = days.filter((d) => d.date < today && d.sprint && d.sprint.length > 0)
  const last = before[before.length - 1]
  if (!last?.sprint) return null
  return mean(last.sprint.filter((a) => a.correct).map((a) => a.ms))
}

/**
 * 저장에 실패한 **완성된** 세션. 결과 화면이 쥐고 있던 유일한 사본이 클로저였고, 아이가
 * 화면을 떠나면(램프·← 홈·뒤로) 마지막 참조가 끊겨 30문제의 반응시간이 복구 경로 없이
 * 사라졌다 — 실패했다는 신호(에러 배너)까지 다음 화면이 지웠다. 실측으로 재현한 결함이다.
 *
 * 그래서 클로저 밖 모듈 수준에 둔다. `grade.ts`의 `grading`과 같은 패턴이되 **반대로
 * hashchange에서 지우지 않는다** — 화면을 떠나도 살아 있는 것이 이 변수의 존재 이유다.
 * 지우는 것은 저장 성공 하나뿐(`putDay`는 sid 기준 병합이라 재시도가 멱등하다).
 *
 * 새로고침·앱 종료까지는 살아남지 못한다(그러려면 두 번째 저장소가 필요하다 —
 * 이 레포에 localStorage 사용처가 0건이라 별개 결정으로 뒀다, HANDOFF 참조).
 */
type PendingSprint = {
  day: Day
  attempts: SprintAttempt[]
  /** 「오늘 새로!」 강조 — 세션 전 상태와의 차이라 나중에 다시 만들 수 없다. */
  newly: Set<string>
  prevMean: number | null
}
let pending: PendingSprint | null = null

/** 저장 안 된 세션이 있는지 — 다른 모듈이 물어볼 자리(지금은 이 파일만 쓴다). */
export function hasPendingSprint(): boolean {
  return pending !== null
}

function backOnly(root: HTMLElement, message: string): void {
  root.replaceChildren(
    el(`<div><p class="date">${message}</p><button class="step" id="back">← 홈</button></div>`),
  )
  root.querySelector('#back')!.addEventListener('click', () => navigate('#/'))
}

export async function renderSprint(root: HTMLElement): Promise<void> {
  const today = dayKey(new Date())

  // 본문 전체를 하나의 try로 감싼다. getMeta/getAllDays가 밖에 있으면 IndexedDB 실패 시
  // 예외가 main.ts의 route()로 올라가고, 거기서는 showError만 부르므로 #app이 빈 채로
  // 남는다 — 북마크로 #/sprint에 바로 들어온 경우 갈 곳이 없어진다.
  try {
    const meta = await getMeta()
    let days = await getAllDays()
    let existing = await getDay(today)

    // 저장 안 된 세션이 남아 있으면 **새 세션을 시작하기 전에** 먼저 구한다. 여기서
    // 그냥 새로 시작하면 그것이 곧 데이터 유실이다(재현된 결함). 저장에 성공하면
    // days·existing이 낡으므로 다시 읽고 평소 흐름으로 내려간다.
    if (pending !== null) {
      const saved = await savePending()
      if (!saved) {
        // 아직 못 구했다. 오늘 것이면 결과 화면을 다시 띄워 재시도 버튼을 준다.
        // 날짜가 다르면(새벽 4시를 넘겨 앱이 떠 있던 경우) 「오늘 결과」라고 말하면
        // 거짓이므로 화면은 평소대로 두고 다음 진입에서 다시 시도한다.
        if (pending.day.date === today) {
          showResultFor(root, pending, days, meta.settings)
          return
        }
      } else {
        days = await getAllDays()
        existing = await getDay(today)
      }
    }

    if (existing?.sprint && existing.sprint.length > 0) {
      const facts = deriveFacts(days, meta.settings.fluentMs)
      // 재진입은 오늘 세션이 이미 저장본에 있으므로 days 그대로가 맞다.
      const peak = peakFluent(days, meta.settings.fluentMs)
      renderResult(
        root,
        facts,
        genieState(peak, meta.settings.wishGrantedAt),
        peak,
        new Set(newlyFluentSince(days, meta.settings.fluentMs, today)),
        existing.sprint,
        previousMean(days, today),
        null,
      )
      return
    }

    const facts = deriveFacts(days, meta.settings.fluentMs)
    // 점검이 due면 오늘 스프린트는 점검이다(스펙 §5). 적응 off — fluent 식을 한 번씩.
    const checkup = checkupDue(days, meta.settings.fluentMs, today)
    const queue = checkup
      ? composeCheckup(facts, meta.settings.sprintCount)
      : composeSprint({ facts, count: meta.settings.sprintCount, today })
    if (queue.length === 0) {
      backOnly(root, '오늘 낼 문제를 만들지 못했어요. 부모님께 보여 주세요.')
      return
    }

    // 세션 정체성(설계 2단계 §1 「스프린트 세션 보존」). 이 한 줄이 "두 기기가 같은 날
    // 각자 스프린트를 했다"를 병합이 알아볼 수 있게 만든다 — sid가 없으면 병합은 시도
    // 배열 둘을 내용으로만 비교해 한쪽을 통째로 버린다. 시작 시각을 담으므로 그룹 정렬의
    // 근거이기도 하다(merge.ts). **없는 sid를 `undefined`로 적어 넣지 않는다**: 키가
    // 있는데 값이 undefined면 직렬화가 JSON 왕복과 달라져 같은 세션이 둘로 갈린다.
    const sid = `${(await getDeviceState()).deviceId}:${Date.now()}`

    runSession(
      root,
      queue,
      facts,
      days,
      today,
      existing,
      meta.settings.fluentMs,
      meta.settings.wishGrantedAt ?? null,
      checkup,
      sid,
    )
  } catch (e) {
    showError('스프린트를 열지 못했어요.', e)
    backOnly(root, '')
  }
}

/**
 * pending을 저장해 본다. 성공하면 지우고 true. 실패는 조용하다 — 부르는 쪽이 결과
 * 화면을 다시 띄워 사람에게 재시도를 맡긴다(배너를 여기서 띄우면 진입마다 쌓인다).
 */
async function savePending(): Promise<boolean> {
  if (pending === null) return true
  try {
    await putDay(pending.day, ['sprint'])
    pending = null
    return true
  } catch {
    return false
  }
}

/** 저장 안 된 세션의 결과 화면. 파생값은 저장본 + pending.day로 그때그때 다시 만든다. */
function showResultFor(
  root: HTMLElement,
  p: PendingSprint,
  days: Day[],
  settings: { fluentMs: number; wishGrantedAt?: string | null },
): void {
  const merged = [...days.filter((d) => d.date !== p.day.date), p.day]
  const after = deriveFacts(merged, settings.fluentMs)
  const peak = peakFluent(merged, settings.fluentMs)
  showError('스프린트 결과를 저장하지 못했어요. 다시 눌러 주세요.')
  renderResult(
    root,
    after,
    genieState(peak, settings.wishGrantedAt),
    peak,
    p.newly,
    p.attempts,
    p.prevMean,
    () => {
      void savePending().then((ok) => {
        if (!ok) {
          showError('스프린트 결과를 저장하지 못했어요. 다시 눌러 주세요.')
          return
        }
        clearError()
        void renderSprint(root)
      })
    },
  )
}

function runSession(
  root: HTMLElement,
  initialQueue: string[],
  factsBefore: Record<string, FactState>,
  days: Day[],
  today: string,
  existing: Day | undefined,
  fluentMs: number,
  wishGrantedAt: string | null,
  checkup: boolean,
  sid: string,
): void {
  let total = initialQueue.length
  let queue = [...initialQueue]
  const attempts: SprintAttempt[] = []
  const requeued = new Set<string>()

  let current = ''
  let typed = ''
  let shownAt = 0
  let firstKeyAt = 0
  let locked = false

  // 마지막 문제를 틀려 1.5초 reveal이 도는 동안 아이가 홈으로 나가면, 그 타임아웃이
  // 끝난 뒤 next()/finish()가 실행되어 이미 다른 화면으로 바뀐 #app을 덮어써 버릴 수
  // 있다. 더 나쁘게는 — "← 홈"이 이미 같은 해시(#/)로 이동해 놓은 뒤라면
  // navigate('#/')가 hashchange를 일으키지 않아 그 버튼조차 죽는다. 아이패드에
  // 홈 화면 아이콘으로 띄운 상태에는 주소창도 새로고침 버튼도 없으므로, 이 상태에
  // 빠지면 강제 종료 말고는 빠져나갈 길이 없다. 세션이 시작된 해시를 벗어나는 순간
  // 이후의 모든 예약된 콜백을 무력화한다.
  let cancelled = false
  const startHash = location.hash
  const onHashChange = (): void => {
    if (location.hash === startHash) return
    cancelled = true
    window.removeEventListener('hashchange', onHashChange)
  }
  window.addEventListener('hashchange', onHashChange)

  root.replaceChildren(
    el(`
      <div>
        <div class="sprint-top"><button class="sprint-exit" id="exit" aria-label="그만하기">✕</button></div>
        <div class="sprint-progress" id="bar"></div>
        <div class="sprint-q" id="q"></div>
        <div class="sprint-a" id="a"></div>
        <div class="keypad" id="pad">
          ${[1, 2, 3, 4, 5, 6, 7, 8, 9]
            .map(
              (n) =>
                `<button class="seed-action-button seed-action-button--variant_neutralOutline seed-action-button--size_large" data-key="${n}">${n}</button>`,
            )
            .join('')}
          <button class="seed-action-button seed-action-button--variant_neutralOutline seed-action-button--size_large" data-key="back">←</button>
          <button class="seed-action-button seed-action-button--variant_neutralOutline seed-action-button--size_large" data-key="0">0</button>
          <button class="seed-action-button seed-action-button--variant_neutralOutline seed-action-button--size_large" data-key="ok">✓</button>
        </div>
      </div>
    `),
  )

  const bar = root.querySelector<HTMLDivElement>('#bar')!
  const qEl = root.querySelector<HTMLDivElement>('#q')!
  const aEl = root.querySelector<HTMLDivElement>('#a')!

  function paint(): void {
    bar.innerHTML = progressHtml(total, attempts.length)
    qEl.textContent = current.replace('×', ' × ')
    aEl.textContent = typed
    aEl.classList.remove('reveal')
  }

  function next(): void {
    if (cancelled) return
    const head = queue.shift()
    if (head === undefined) {
      void finish()
      return
    }
    current = head
    typed = ''
    // 반응시간은 문제가 보인 순간부터 첫 숫자 키까지다. 확인 버튼까지의 시간은
    // 손가락 속도라 노이즈이므로 제외한다.
    shownAt = performance.now()
    firstKeyAt = 0
    locked = false
    paint()
  }

  function submit(): void {
    if (typed === '' || locked) return
    locked = true
    const correct = Number(typed) === factAnswer(current)
    const ms = Math.round((firstKeyAt || performance.now()) - shownAt)
    attempts.push({ fact: current, correct, ms, sid })

    if (correct) {
      next()
      return
    }

    // 오답: 빨간 X 대신 정답을 보여주고, 같은 세션 뒤쪽에 다시 넣는다.
    // 즉시 재도전은 단기기억으로 맞히는 것이라 훈련이 되지 않는다.
    aEl.textContent = String(factAnswer(current))
    aEl.classList.add('reveal')
    // 점검은 측정이지 훈련이 아니다 — 재투입하지 않는다. 틀린 식은 derive가 learning으로
    // 내리고 내일의 일반 스프린트가 드릴한다(스펙 §5). 정답 reveal은 점검에서도 보여준다.
    if (!checkup && !requeued.has(current)) {
      requeued.add(current)
      // 간격은 requeueWrong의 기본값(4)을 쓴다. 여기서 다시 선언하면 한쪽만 바뀌어도
      // 조용히 어긋난다.
      queue = requeueWrong(queue, current)
      // 진행바의 분모도 같이 늘린다 — 틀리면 문제가 늘어난다는 규칙을 숨기지 않는다.
      // 늘리지 않으면 attempts.length가 원래 total(30)에 닿는 순간 바가 꽉 찬 것처럼
      // 보이는데, 재투입된 문제가 아직 남아 있어 실제로는 안 끝난 상태다.
      total++
    }
    window.setTimeout(next, REVEAL_MS)
  }

  root.querySelector('#pad')!.addEventListener('click', (event) => {
    const key = (event.target as HTMLElement).dataset['key']
    if (key === undefined || locked) return
    if (key === 'ok') return submit()
    if (key === 'back') {
      typed = typed.slice(0, -1)
      paint()
      return
    }
    if (typed.length >= 2) return
    // 숫자가 실제로 입력될 때만 진동한다(번호 버튼 전용 — 사용자 결정). 위의
    // 거부 경로(잠김·2자리 초과)에서 울리면 "입력됐다"는 거짓 신호가 된다.
    hapticTap()
    if (firstKeyAt === 0) firstKeyAt = performance.now()
    typed += key
    paint()
  })

  // 조용한 출구(리뷰 P1-2). 확인창 없음 — 잃는 것은 저장 안 된 세션뿐이고
  // 그것은 "중간에 나가면 없던 일"(위 finish 주석) 정책이 의도한 결과다.
  // navigate가 hashchange를 쏘고 onHashChange가 cancelled를 세워 이후의
  // 예약된 콜백(reveal 타임아웃 등)을 무력화한다 — 새 취소 경로가 아니다.
  root.querySelector('#exit')!.addEventListener('click', () => navigate('#/'))

  async function finish(): Promise<void> {
    // next()에서 이미 걸러지지만, 방어적으로 한 번 더 — finish() 자체가 비동기라
    // await 도중에도 취소될 수 있다(바로 아래 두 번째 검사).
    if (cancelled) return

    // 세션 전체가 끝났을 때만 저장한다. 중간에 나가면 없던 일이 된다 —
    // 부분 세션은 반응시간 통계를 오염시킨다(전화 받다 8초 뒤에 누른 값이 섞인다).
    // existing 스프레드는 kind를 보존한다 — 점검이면 명시로 덮는다. kind:'checkup'의
    // 유일한 생산 지점이다. 이 표시가 월간 리포트의 점검 세션 식별자다.
    //
    // **덮어쓰기가 아니라 이어붙이기다**(설계 2단계 §1). 저장본에 이미 다른 세션이
    // 있으면(다른 기기가 오늘 스프린트를 했고 pull이 그것을 들여왔다) 통째 대입은 그
    // 세션을 이 기기에서 지운다. sid가 세션을 갈라 주므로 합집합은 멱등하고, 병합도
    // sid 기준으로 같은 판단을 한 번 더 한다.
    const sprint = [...(existing?.sprint ?? []), ...attempts]
    const day: Day = existing
      ? { ...existing, kind: checkup ? 'checkup' : existing.kind, sprint }
      : { date: today, kind: checkup ? 'checkup' : 'normal', sheet: [], sprint }
    let saveError: Error | null = null
    try {
      await putDay(day, ['sprint'])
    } catch (e) {
      saveError = e as Error
    }

    // putDay가 성공했든 실패했든 여기까지 온다 — 문제를 전부 풀었으므로 세션 자체는
    // 완성됐다. 다만 그 사이 화면을 떠났다면 결과 화면(#app 전체 교체)도 에러 배너도
    // 다른 화면 위에 그리지 않는다 — 그 화면의 것이 아니다. 리스너도 여기서 정리한다 —
    // 정상 종료 뒤까지 남아 있으면 이후의 무관한 이동에도 반응하는 leak이 된다.
    window.removeEventListener('hashchange', onHashChange)
    if (cancelled) return

    // days는 날짜 오름차순이어야 한다. today가 가장 늦은 날짜이므로 끝에 붙인다.
    // **peak도 같은 배열로 센다** — 이 시점의 day는 아직 저장 전이라 getAllDays()를
    // 다시 부르면 방금 끝난 세션이 빠지고, 지도의 「오늘 새로!」 칸은 차 있는데 램프만
    // 어제 값을 그린다.
    const merged = [...days.filter((d) => d.date !== today), day]
    const after = deriveFacts(merged, fluentMs)
    const peak = peakFluent(merged, fluentMs)
    const state = genieState(peak, wishGrantedAt)
    const newly = new Set(
      Object.keys(after).filter(
        (id) => after[id]!.status === 'fluent' && factsBefore[id]?.status !== 'fluent',
      ),
    )

    // 저장에 실패해도 결과 화면은 그대로 보여주고 재시도 버튼만 덧붙인다. 여기서
    // 홈으로 돌려보내면 아직 메모리에만 있는 30문제의 정답과 반응시간 — 이 앱에서
    // 유일하게 되돌릴 수 없는 데이터 — 이 그대로 사라진다. grade.ts의 저장 실패 처리와
    // 같은 방침이다(화면을 유지하고 다시 누르게 한다).
    async function retrySave(): Promise<void> {
      // 재시도를 기다리는 동안 아이가 홈으로 나갈 수 있다. onHashChange는 이미
      // 해제됐으니 cancelled가 더는 갱신되지 않는다 — 대신 눌렀던 순간의 해시와
      // 비교해, 화면이 바뀌었으면 쓰기만 마치고 DOM·배너는 건드리지 않는다.
      const at = location.hash
      if (!(await savePending())) {
        if (location.hash !== at) return
        showError('스프린트 결과를 저장하지 못했어요. 다시 눌러 주세요.')
        return
      }
      if (location.hash !== at) return
      clearError()
      renderResult(root, after, state, peak, newly, attempts, previousMean(days, today), null)
    }

    // 저장에 실패했으면 **클로저 밖에** 세션을 남긴다. 이 한 줄이 "화면을 떠나면
    // 영영 사라진다"를 막는다 — 결과 화면의 DOM이 사라져도 pending은 남고,
    // #/sprint에 다시 들어오면 renderSprint가 먼저 구한다.
    pending = saveError ? { day, attempts, newly, prevMean: previousMean(days, today) } : null
    if (saveError) showError('스프린트 결과를 저장하지 못했어요. 다시 눌러 주세요.', saveError)
    const onRetry = saveError ? () => void retrySave() : null
    renderResult(root, after, state, peak, newly, attempts, previousMean(days, today), onRetry)
  }

  next()
}

function renderResult(
  root: HTMLElement,
  facts: Record<string, FactState>,
  state: GenieState,
  peak: number,
  newly: Set<string>,
  attempts: SprintAttempt[],
  prevMean: number | null,
  /** 저장에 실패했을 때만 준다. 결과 화면 위에 재시도 버튼을 하나 더 그린다. */
  onRetry: (() => void) | null = null,
): void {
  const todayMean = mean(attempts.filter((a) => a.correct).map((a) => a.ms))
  let line = '오늘도 해냈어요!'
  if (todayMean !== null && prevMean !== null) {
    const delta = (prevMean - todayMean) / 1000
    line =
      delta >= 0.05
        ? `어제보다 ${delta.toFixed(1)}초 빨라졌어요 🚀`
        : `평균 ${(todayMean / 1000).toFixed(1)}초로 풀었어요`
  } else if (todayMean !== null) {
    line = `평균 ${(todayMean / 1000).toFixed(1)}초로 풀었어요`
  }

  root.replaceChildren(
    el(`
      <div>
        <div class="sprint-done">${line}</div>
        ${newly.size > 0 ? `<div class="sprint-done">새로 정복한 식 ${newly.size}개!</div>` : ''}
        ${factMapHtml(facts, newly, { window: 'today', invite: true })}
        ${genieEntryHtml(state, peak)}
        ${onRetry ? '<button class="step" id="retry">저장 다시 시도</button>' : ''}
        <button class="step" id="back">← 홈</button>
      </div>
    `),
  )
  if (onRetry) root.querySelector('#retry')!.addEventListener('click', onRetry)
  root.querySelector('#back')!.addEventListener('click', () => navigate('#/'))
  wireGenieEntry(root)
}
