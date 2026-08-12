# 동기화 2B — 채점 화면 PIN 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 채점 화면(`#/grade`)과 리포트 화면(`#/report`)에 PIN 게이트를 세운다 — 서버 `app_config.pin`을 pull로 받아 캐시하고, 라우터가 진입을 막는다. 설정·변경 UI는 없다(SQL 전용).

**Architecture:** `sync.ts`의 `pullConfig()`가 서버 PIN을 `DeviceState.pin`에 캐시하고, `main.ts`의 `route()`가 게이트 대상 해시에서 `ui.ts`의 `unlockGate()`를 기다린다. 통과 플래그는 포그라운드 세션(배경 진입 시 삭제 + visible 복귀 시 재게이트). 스펙: `docs/superpowers/specs/2026-08-12-sync-phase2b-pin-design.md` — 적대적 리뷰 5라운드 합의본이므로, **구현이 스펙과 갈라질 것 같으면 멈추고 물어라.**

**Tech Stack:** 바닐라 TS + IndexedDB(`fake-indexeddb` 테스트) + Supabase PostgREST. 실행 코드 신규 의존성 0.

## Global Constraints

- 모든 npm 명령 전에: `export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH"`
- `fetch`를 직접 부르지 않는다 — `sync.ts`의 `req()`만 쓴다
- 테스트는 이 계획의 Task 1에 있는 것이 전부다. 게이트·다이얼로그·pullConfig에 테스트를 새로 만들지 마라(스펙 §6 — 설계 §12가 DOM·화면 테스트를 두지 않는다)
- `docs/` 포함 커밋 전 반드시 `npm run format` (prettier가 마크다운도 검사, CI 차단 전례)
- 커밋 메시지는 이 레포 관례(한국어, `feat:`/`docs:` 접두, 본문에 왜)
- `ui.ts`는 `db.ts`를 import하지 않는다(스펙 §2)
- 오버레이는 `.overlay` 클래스(인쇄 격리), 값은 전부 `textContent`(XSS 경계)

## 파일 지도

| 파일                          | 역할                                                | Task |
| ----------------------------- | --------------------------------------------------- | ---- |
| `src/data/db.ts`              | `DeviceState.pin` 필드 + 보존                       | 1    |
| `src/data/db.test.ts`         | pin 기본값·보존 테스트                              | 1    |
| `src/data/sync.ts`            | `pullConfig()` + `pullPass` 배선                    | 2    |
| `src/ui.ts`                   | `unlockGate`·`gateUnlocked`·`lockGate` + 다이얼로그 | 3    |
| `src/main.ts`                 | 라우터 게이트 + visibilitychange 배선               | 4    |
| `supabase/README.md`          | PIN 설정 SQL 절                                     | 5    |
| `docs/superpowers/HANDOFF.md` | 2B 완료 기록                                        | 5    |

---

### Task 1: `DeviceState.pin` — 필드와 보존

**Files:**

- Modify: `src/data/db.ts` (DeviceState 타입 21-37행, `normalizeDeviceState` 667-675행, `freshDeviceState` 724-734행)
- Test: `src/data/db.test.ts`

**Interfaces:**

- Consumes: 기존 `getDeviceState()`·`updateDeviceState(fn)`·`replaceAll`·`replaceFromServer`
- Produces: `DeviceState.pin: string | null` — Task 2가 쓰고 Task 4가 읽는다

- [ ] **Step 1: 실패하는 테스트 둘을 쓴다**

`src/data/db.test.ts`의 `getDeviceState` describe 근처(268행 부근)에 추가. 기존 테스트의 `DeviceState` 리터럴 픽스처들은 타입 확장으로 컴파일이 깨지므로 **이 시점에는 아직 고치지 않는다** — Step 3에서 타입과 함께 고친다.

```ts
it('pin이 없던 기기 상태를 읽으면 null로 채워진다', async () => {
  // v3 이전에 저장된 상태에는 pin 키 자체가 없다 — normalizeDeviceState가 채운다.
  // 필드 넷(seededAt·generation·lastPulledAt·quarantine)이 밟은 길과 같다.
  await putDeviceState({
    deviceId: 'test',
    deviceKey: 'k',
    lastSyncAt: null,
    seededAt: null,
    generation: null,
    lastPulledAt: null,
    quarantine: [],
  } as unknown as DeviceState) // pin 없는 옛 모양을 일부러 만든다
  const state = await getDeviceState()
  expect(state.pin).toBeNull()
})

it('파괴적 경로 둘 다 pin을 보존한다 — 잠금을 푸는 경로가 없다(스펙 §5)', async () => {
  // 보존이 { ...state } 스프레드 한 줄에 기대고 있어, 명시 필드 나열로
  // 리팩터하는 순간 조용히 깨지는 종류다. 이 테스트가 그 보존을 직접 고정한다.
  await updateDeviceState((s) => ({ ...s, pin: '1234' }))
  await replaceAll([], defaultMeta())
  expect((await getDeviceState()).pin).toBe('1234')
  await replaceFromServer([], { value: defaultMeta(), at: { settings: null } }, 1, null)
  expect((await getDeviceState()).pin).toBe('1234')
})
```

`replaceFromServer`의 두 번째 인자 모양은 기존 테스트(933행 부근)의 사용 예를 그대로 따라라 — 위와 다르면 **기존 테스트 쪽이 맞다.**

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/data/db.test.ts -t 'pin'`
Expected: FAIL — `pin`이 `undefined` (타입 오류가 먼저 나면 `as unknown as` 캐스트 확인)

- [ ] **Step 3: 구현**

`src/data/db.ts` 세 곳:

```ts
// DeviceState 타입에 (quarantine 아래):
/** 이 기기가 마지막으로 본 서버 PIN(app_config.pin). null이면 게이트가 없다.
 *  백업·동기화 대상이 아니다 — 기기 로컬 캐시이고 다음 pull이 다시 채운다(2B 스펙 §3). */
pin: string | null
```

```ts
// normalizeDeviceState의 반환 객체에:
pin: state.pin ?? null,
```

```ts
// freshDeviceState의 반환 객체에:
pin: null,
```

`replaceAll`·`replaceFromServer`는 **건드리지 않는다** — 둘 다 `{ ...state, ... }` 스프레드라 pin이 자동 보존된다. 그것이 Step 1 두 번째 테스트가 고정하는 사실이다.

`db.test.ts`의 기존 `DeviceState` 리터럴 픽스처들(275행·295행 부근 등 — `tsc`가 전부 찾아준다)에 `pin: null`을 추가해 컴파일을 살린다.

- [ ] **Step 4: 통과 확인 + 변이 검증**

Run: `npx vitest run src/data/db.test.ts` → 전부 PASS.
변이 1: `normalizeDeviceState`에서 `pin: state.pin ?? null,` 줄을 지운다 → 첫 테스트만 FAIL 확인 → 원복.
변이 2: `replaceAll`의 `{ ...state, seededAt: null, quarantine: [] }`를 `{ deviceId: state.deviceId, deviceKey: state.deviceKey, lastSyncAt: state.lastSyncAt, seededAt: null, generation: state.generation, lastPulledAt: state.lastPulledAt, quarantine: [], pin: null }`로 바꾼다(스프레드 제거를 흉내) → 두 번째 테스트만 FAIL 확인 → 원복.

- [ ] **Step 5: 전체 검증 + 커밋**

```bash
npx vitest run && npx prettier --check . && npm run build
git add src/data/db.ts src/data/db.test.ts
git commit -m "feat: DeviceState에 pin 캐시 슬롯 — 파괴적 경로가 잠금을 풀지 못한다"
```

---

### Task 2: `pullConfig()` — 서버 PIN을 캐시로

**Files:**

- Modify: `src/data/sync.ts` (`pullMeta` 1063행 부근 아래에 신설, `pullPass` 1202-1215행 배선)

**Interfaces:**

- Consumes: Task 1의 `DeviceState.pin`, 기존 `req()`·`updateDeviceState`·`getDeviceState`
- Produces: `pullConfig(): Promise<boolean>` (캐시가 실제로 바뀌었으면 true) — `pullPass`만 부른다, export하지 않는다

- [ ] **Step 1: `pullConfig` 구현**

`pullMeta` 함수 아래에 추가:

```ts
/**
 * app_config(PIN)를 내려받아 DeviceState.pin에 캐시한다(2B 스펙 §3). 반환값은
 * 캐시가 실제로 바뀌었는가 — pullPass가 PullResult.changed에 싣는다. 이것이 없으면
 * SQL로 PIN만 넣은 직후의 pull(다른 변경이 없는 패스)이 재렌더를 못 깨워, 정답이
 * 떠 있는 채점 화면에 잠금이 영영 안 걸린다.
 *
 * 반드시 pullPass의 'unauthorized'·'rebase' 가드 **뒤**에서만 부른다 — 폐기된 키의
 * RLS 응답이 200 + 빈 배열이라, 가드 앞에서 부르면 폐기된 기기가 빈 응답을
 * "PIN 미설정"으로 읽고 캐시를 지워 게이트를 스스로 연다.
 *
 * 실패는 삼키고 캐시를 유지한다 — app_config만의 장애(일시 5xx)가 이 패스의
 * days pull까지 죽이면 push는 되는데 pull만 안 되는 반쪽 동기화가 된다.
 * PIN 캐시가 한 패스 낡는 것은 아무 비용이 아니다.
 *
 * 형식(4자리)은 검증하지 않는다 — PIN은 파생에 쓰이지 않고 === 비교 한 번이라
 * 기형 값이 도달할 넓이가 없고, SQL 전용 설정에서 거부는 옛 PIN을 조용히
 * 유지해 "바꿨는데 안 먹는다"가 된다(스펙 §3). 빈 배열(행 없음 — 최초 설정 전)과
 * pin ''(사람이 SQL로 지움)은 둘 다 null이 되어 게이트가 꺼진다.
 */
async function pullConfig(): Promise<boolean> {
  try {
    const res = await req(`${SUPABASE_URL}/rest/v1/app_config?id=eq.1&select=pin`)
    if (!res.ok) return false
    const row = ((await res.json()) as Record<string, unknown>[])[0]
    const pin = typeof row?.['pin'] === 'string' && row['pin'] ? (row['pin'] as string) : null
    if ((await getDeviceState()).pin === pin) return false
    await updateDeviceState((s) => (s.pin === pin ? s : { ...s, pin }))
    return true
  } catch {
    return false
  }
}
```

- [ ] **Step 2: `pullPass` 배선**

기존:

```ts
if (suspendCount > 0) return { status: 'failed', changed: meta }
return { status: 'ok', changed: (await pullDays()) || meta }
```

변경:

```ts
if (suspendCount > 0) return { status: 'failed', changed: meta }
// PIN 캐시 갱신. 반드시 위 'unauthorized'·'rebase' 가드 뒤 — 자리의 의미는
// pullConfig 주석 참고. 이 줄을 가드 위로 올리면 보안 판정이 깨진다.
const config = await pullConfig()
return { status: 'ok', changed: (await pullDays()) || meta || config }
```

- [ ] **Step 3: 검증 + 커밋**

테스트는 없다(스펙 §6 — `engine/`으로 뽑을 순수 부분이 없다). 컴파일·기존 테스트 회귀·포맷만 본다:

```bash
npx vitest run && npx prettier --check . && npm run build
git add src/data/sync.ts
git commit -m "feat: pull이 app_config의 PIN을 기기 캐시로 내린다"
```

---

### Task 3: `ui.ts` — 게이트 다이얼로그와 포그라운드 플래그

**Files:**

- Modify: `src/ui.ts` (`confirmDialog` 아래 167-292행 부근에 형제 함수로)

**Interfaces:**

- Consumes: 없음 (`db.ts` import 금지 — 스펙 §2)
- Produces: Task 4가 쓰는 셋 — `unlockGate(expected: string): Promise<boolean>` · `gateUnlocked(): boolean` · `lockGate(): void`

- [ ] **Step 1: 플래그와 조회·삭제 함수**

`confirmDialog` 아래에:

```ts
/**
 * PIN 게이트(2B 스펙 §4). 통과 플래그는 포그라운드 세션이다 — main.ts가
 * visibilitychange hidden에서 lockGate()를 불러 지운다. ui.ts는 리스너를 스스로
 * 걸지 않는다(모듈 부작용 금지, window 리스너는 main.ts 소유).
 */
let gatePassed = false
/** 게이트 통과 여부의 동기 조회. main.ts가 #app을 비울지(다이얼로그가 실제로
 *  뜰 때만) 정하는 데 쓴다 — 플래그가 선 재렌더마다 비우면 화면이 깜빡인다. */
export function gateUnlocked(): boolean {
  return gatePassed
}
/** 배경 진입 시 main.ts가 부른다. 다이얼로그가 떠 있는 중이면 no-op이나 다름없다 —
 *  그 비행의 플래그는 어차피 아직 false다. */
export function lockGate(): void {
  gatePassed = false
}
```

- [ ] **Step 2: `unlockGate` 구현**

```ts
/**
 * PIN 입력 다이얼로그. confirmDialog의 형제 — 같은 오버레이 규약(.overlay 인쇄
 * 격리, document.body 부착, settle 1회 resolve, hashchange 자진 취소).
 *
 * 단일 비행: 이미 떠 있으면 같은 Promise를 돌려준다. 게이트는 route() 한가운데서
 * 사람 입력을 무기한 기다리므로, 배경 pull 재렌더(route(false))가 겹치면 다이얼로그가
 * 쌓인다 — pullOnce와 같은 방식으로 흡수한다. 비행 중 도착한 새 expected는 무시된다
 * (감수 — 스펙 §4: 창이 초 단위이고 위협이 여덟 살이다).
 *
 * 틀린 입력은 닫지 않는다 — 입력을 비우고 안내만 바꾼다. 잠금·지연 없음(위협
 * 모델: 아이의 우연한 접근). 입력값은 어디에도 렌더되지 않는다(textContent만).
 */
let gateFlight: Promise<boolean> | null = null
export function unlockGate(expected: string): Promise<boolean> {
  if (gatePassed) return Promise.resolve(true)
  if (gateFlight) return gateFlight
  const flight = new Promise<boolean>((resolve) => {
    const backdrop = document.createElement('div')
    backdrop.className = 'overlay seed-dialog__backdrop'
    backdrop.setAttribute('data-state', 'open')

    const positioner = document.createElement('div')
    positioner.className = 'overlay seed-dialog__positioner'
    positioner.setAttribute('data-state', 'open')

    const content = document.createElement('div')
    content.className = 'seed-dialog__content'
    content.setAttribute('data-state', 'open')
    content.setAttribute('role', 'alertdialog')
    content.setAttribute('aria-modal', 'true')

    const header = document.createElement('div')
    header.className = 'seed-dialog__header'
    const title = document.createElement('h2')
    title.className = 'seed-dialog__title'
    title.textContent = '부모 확인'
    const desc = document.createElement('p')
    desc.className = 'seed-dialog__description'
    desc.textContent = 'PIN을 입력해 주세요'
    const input = document.createElement('input')
    input.className = 'confirm-gate'
    input.type = 'password' // 마스킹 — 옆에 있는 아이에게 평문이 보이면 게이트가 끝이다
    input.setAttribute('inputmode', 'numeric')
    input.setAttribute('maxlength', '4') // UI 제약일 뿐 검증기가 아니다(스펙 §1)
    input.setAttribute('autocomplete', 'off')
    header.append(title, desc, input)
    content.append(header)

    const footer = document.createElement('div')
    footer.className = 'seed-dialog__footer'
    const SIZE = 'seed-action-button--size_large seed-action-button--size_large-layout_withText'
    const cancel = document.createElement('button')
    cancel.className = `seed-action-button seed-action-button--variant_neutralWeak ${SIZE}`
    cancel.textContent = '취소'
    const confirm = document.createElement('button')
    confirm.className = `seed-action-button seed-action-button--variant_brandSolid ${SIZE}`
    confirm.textContent = '확인'
    footer.append(cancel, confirm)
    content.append(footer)
    positioner.append(content)
    document.body.append(backdrop, positioner)

    let settled = false
    const settle = (result: boolean) => {
      if (settled) return
      settled = true
      gateFlight = null
      if (result) gatePassed = true
      backdrop.remove()
      positioner.remove()
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('hashchange', onHashChange)
      resolve(result)
    }
    const submit = () => {
      if (input.value === expected) {
        settle(true)
        return
      }
      input.value = ''
      desc.textContent = '다시 입력해 주세요'
      input.focus()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') settle(false)
      if (e.key === 'Enter') submit()
    }
    // #app 밖에 사는 것은 자기 수명을 스스로 관리한다 — 해시가 바뀌면 취소로 닫는다
    // (confirmDialog와 같은 규약). 호출자(main.ts)는 이 false를 "화면을 떠났다"와
    // 구분하기 위해 캡처한 해시와 지금 해시를 비교한다(스펙 §4).
    const onHashChange = () => settle(false)
    cancel.addEventListener('click', () => settle(false))
    confirm.addEventListener('click', submit)
    positioner.addEventListener('click', (e) => {
      if (e.target === positioner) settle(false)
    })
    document.addEventListener('keydown', onKey)
    window.addEventListener('hashchange', onHashChange)
    input.focus()
  })
  gateFlight = flight
  return flight
}
```

주의: `settle`이 `gateFlight = null`을 **resolve 전에** 지운다 — 다음 게이트가 새 비행을 만들 수 있어야 한다.

- [ ] **Step 3: 검증 + 커밋**

테스트 없음(화면 — 설계 §12). 컴파일·포맷·기존 회귀만:

```bash
npx vitest run && npx prettier --check . && npm run build
git add src/ui.ts
git commit -m "feat: PIN 게이트 다이얼로그 — 포그라운드 세션 플래그, 단일 비행"
```

---

### Task 4: `main.ts` — 라우터 게이트와 visibilitychange 배선

**Files:**

- Modify: `src/main.ts` (import 3행, visibilitychange 핸들러 25-29행, `route()` 91-132행)

**Interfaces:**

- Consumes: Task 1 `getDeviceState().pin`, Task 3 `unlockGate`·`gateUnlocked`·`lockGate`, 기존 `navigate`(ui.ts)·`isGrading`(grade.ts 동적 import)
- Produces: 없음(최상위 배선)

- [ ] **Step 1: import와 게이트 대상 표**

```ts
import { clearError, gateUnlocked, lockGate, navigate, showError, unlockGate } from './ui'
import { getDeviceState } from './data/db'
```

`PARENT_HASHES` 아래에:

```ts
/**
 * PIN 게이트 대상(2B 스펙 §1·§7). #/grade는 정답 노출, #/report는 파괴적 작업
 * (모든 기록 지우기·가져오기·되돌리기). #/parent·#/print는 사용자 결정으로 제외 —
 * 매일 인쇄마다 PIN을 치게 된다. 게이트가 여기(라우터) 한 곳에 사는 이유:
 * 화면마다 두는 방식은 소속 불변식이 사람 규율에 기대다 실제로 샌 전례가 있다
 * (grade.ts의 삼항연산자 속 navigate — HANDOFF 「역할 분리」).
 */
const GATED_HASHES = ['#/grade', '#/report']
```

- [ ] **Step 2: `route()`에 게이트**

`route()`의 pull 블록(96-102행)과 `try` 사이에 삽입:

```ts
// PIN 게이트(2B 스펙 §4). pull 대기 뒤·렌더 앞 — 방금 내려온 PIN으로 판정하는
// 창을 넓힌다(제거는 아니다 — 3초 타임아웃 뒤 도착은 changed 재게이트가 수습).
if (GATED_HASHES.some((h) => hash.startsWith(h))) {
  const pin = (await getDeviceState()).pin
  // pin이 null이면 게이트 없음 — 미설정·pull 전 기기는 오늘과 똑같이 열린다.
  if (pin !== null && !gateUnlocked()) {
    // 다이얼로그는 body 오버레이라 #app을 가리지 않는다 — 비우지 않으면 재게이트
    // 경로에서 정답이 다이얼로그 뒤에 그대로 떠 있다. 플래그가 선 경우(위 조건)는
    // 비우지 않는다 — 배경 pull 재렌더마다 비우면 화면이 깜빡인다.
    app.replaceChildren()
    const ok = await unlockGate(pin)
    if (!ok) {
      // 캡처한 해시와 같을 때만 = 사용자가 취소·포기했고 화면은 그대로일 때만.
      // 집합 소속(GATED_HASHES)으로 판정하면 게이트 화면 사이의 이동(#/grade 게이트
      // 중 #/report 스와이프)까지 부모 홈으로 끌려간다(스펙 §4).
      if (location.hash === hash) navigate('#/parent')
      // 어느 분기든 즉시 종료 — 흘러 내려가면 캡처한 해시로 renderGrade가 그대로
      // 돌아 정답 전부가 #app에 그려진다(스펙 §4 — 게이트가 실패했는데 렌더가
      // 이기면 게이트는 없는 것이다).
      return
    }
  }
}
```

- [ ] **Step 3: visibilitychange 배선**

기존(25-29행):

```ts
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return
  kickPush()
  void pullOnce()
})
```

변경:

```ts
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') {
    // 포그라운드 세션의 끝 — 통과 플래그를 지운다(2B 스펙 §4). 아이패드 홈 화면
    // 앱은 새로고침 없이 며칠씩 떠 있어, 탭 수명 플래그면 게이트가 사실상 일회성이다.
    lockGate()
    return
  }
  kickPush()
  void pullOnce()
  // 떠 있는 화면도 다시 게이트한다(2B 스펙 §4). 플래그만 지우면 반쪽이다 — 아빠가
  // #/grade를 띄운 채 내려놓으면 정답이 렌더된 채 그대로이고, 서버에 변경이 없으면
  // 어떤 route도 돌지 않아 다음날 아이가 집어 들면 아무것도 안 눌러도 정답이 보인다.
  void (async () => {
    const hash = location.hash || '#/'
    if (!GATED_HASHES.some((h) => hash.startsWith(h))) return
    if (gateUnlocked()) return
    // pin 캐시가 없으면 아무것도 안 한다 — 미설정 기기가 매 복귀마다 재렌더되면
    // §1의 「PIN이 없으면 오늘과 똑같이」가 깨진다(리포트 지난달이 wake마다 초기화).
    if ((await getDeviceState()).pin === null) return
    // 채점 도중은 건너뛴다(onPullApplied와 같은 이유 — 재렌더가 메모리의 O/X를
    // 날린다). 잔여 감수: 채점 도중 배경에 들어간 화면은 복귀 시 다시 잠기지 않는다.
    if (hash.startsWith('#/grade')) {
      const { isGrading } = await import('./screens/grade')
      if (isGrading()) return
    }
    // route(false)다 — route()가 아니다. 평소 순서면 pullAndWait(최대 3초)가 게이트보다
    // 먼저 돌아 잠그러 가는 길에 정답이 노출된다. pull은 위에서 이미 pullOnce()로 찼다.
    void route(false)
  })()
})
```

- [ ] **Step 4: 검증 + 커밋**

```bash
npx vitest run && npx prettier --check . && npm run build
git add src/main.ts
git commit -m "feat: 라우터 PIN 게이트 — 채점·리포트 진입과 wake 복귀를 막는다"
```

- [ ] **Step 5: 수동 스모크 (dev 서버)**

`npm run dev` → `http://localhost:5173/haruchi/` (localhost는 배포 origin과 IndexedDB가 분리돼 안전):

1. PIN 캐시 없음: `#/grade`·`#/report`가 오늘처럼 그냥 열린다
2. DevTools 콘솔에서 캐시 주입(`sync-config`가 비어 있어도 게이트는 걸려야 한다 — 스펙 §4 표):
   IndexedDB `haruchi` → `device` → `current` 행의 `pin`을 `'1234'`로 수정(Application 탭) → 새로고침
3. `#/grade` 진입 → 이전 화면이 비워지고 다이얼로그 → 오답 → 안 닫히고 「다시 입력해 주세요」 → 취소 → `#/parent`
4. 재진입 → `1234` → 열린다 → `#/report`도 안 묻고 열린다(플래그 공유)
5. 탭 전환(다른 앱/탭)했다 복귀 → `#/grade`가 다시 묻는다(포그라운드 세션 + wake 재게이트)
6. 다이얼로그 떠 있는 채 뒤로가기 → 부모 홈으로 끌려가지 **않고** 이전 화면으로 간다

---

### Task 5: 문서 — README PIN 절과 HANDOFF 기록

**Files:**

- Modify: `supabase/README.md` (7절 「폐기·재발급」 앞에 새 절)
- Modify: `docs/superpowers/HANDOFF.md` (「동기화 2A」 절 아래에 2B 절)

**Interfaces:**

- Consumes: 스펙 §5의 SQL
- Produces: 없음(문서)

- [ ] **Step 1: README에 PIN 절 추가**

`## 7. 폐기·재발급` 앞에:

````markdown
## 6.5 채점 화면 PIN (선택)

채점 화면(`#/grade`)과 리포트 화면(`#/report`)에 PIN 잠금을 켠다. 앱에는 설정
화면이 없다 — SQL Editor에서 켜고 끄고 바꾼다(분실 복구와 같은 길, 2B 설계 §5).

**정확히 4자리 숫자로 정한다** — 앱의 입력 칸이 4자리 숫자 키패드다. 다른 길이를
넣으면 게이트가 열리지 않는다(고치는 길은 아래 같은 SQL이다).

​```sql
-- 설정·변경
insert into app_config (id, pin, device) values (1, '1234', 'sql')
on conflict (id) do update set pin = excluded.pin, device = 'sql';

-- 잠금 해제
update app_config set pin = '' where id = 1;
​```

각 기기는 다음 pull에서 PIN을 받아 간다(오프라인 검증용 캐시). 초기화·가져오기·
되돌리기는 PIN을 건드리지 않는다.
````

(코드펜스의 제로폭 문자는 붙여넣을 때 제거)

- [ ] **Step 2: HANDOFF에 2B 절 추가**

「동기화 2A」 절 뒤에 — 들어간 것(파일 4 + 문서), 스펙 경로, 적대적 리뷰 5라운드 합의 사실, 사람이 확인할 것(Task 4 Step 5의 스모크 6항목을 실기기에서), PIN을 켜는 방법은 README 6.5절 포인터. 「미해결 항목」의 2B 관련 서술(`app_config` pull 미구현·채점 화면 PIN은 2B)을 완료로 갱신.

- [ ] **Step 3: 포맷 + 커밋**

```bash
npm run format && npx prettier --check .
git add supabase/README.md docs/superpowers/HANDOFF.md
git commit -m "docs: PIN 설정 절차와 2B 완료를 기록한다"
```

---

## 자체 리뷰 체크리스트 (계획 작성자가 이미 수행)

- 스펙 §1 표의 10개 결정 → Task 1(캐시)·2(pull)·3(다이얼로그·플래그)·4(게이트·리다이렉트·wake)·5(SQL 문서)에 전부 대응
- 스펙 §3의 `changed` 합류 → Task 2 Step 2 / 삽입 지점 → 같은 곳 주석 / 실패 삼킴 → Task 2 Step 1
- 스펙 §4의 즉시 종료·캡처 해시 술어·조건부 비우기·단일 비행·마스킹·포그라운드 세션·wake 재게이트(route(false)·pin 조건·isGrading) → Task 3·4
- 스펙 §5 replaceAll/replaceFromServer 보존 → Task 1 (코드 무변경 + 테스트 고정)
- 스펙 §6 테스트 둘 → Task 1 Step 1, 변이 검증 → Task 1 Step 4
- 타입 일관성: `pin: string | null`(T1) = `pullConfig`가 쓰는 값(T2) = `unlockGate(expected: string)`에 null 검사 후 전달(T4)
