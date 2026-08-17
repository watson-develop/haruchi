# PIN 게이트 UI 교체 구현계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `unlockGate()`의 SEED 다이얼로그를 풀스크린 키패드 화면(도트 + 고정 배치 숫자
키패드 + 자동 판정)으로 교체한다.

**Architecture:** 게이트의 의미·호출 계약은 전부 유지하고(스펙 §1) `ui.ts`의
`unlockGate()` 내부 DOM과 `app.css` 스타일만 바꾼다. `main.ts`·`db.ts`·`sync.ts`는
한 줄도 건드리지 않는다. 테스트는 없다 — DOM 화면은 테스트하지 않는 레포다(기본 설계
§12, 스펙 §6).

**Tech Stack:** 바닐라 DOM · SEED 토큰(CSS 변수) · IndexedDB(검증 시 주입만)

**Spec:** `docs/superpowers/specs/2026-08-17-pin-gate-ui-design.md` — 이 계획의 모든
결정의 근거. 구현 전에 읽을 것, 특히 §1(유지 계약 표 = 리뷰 체크리스트)과 §2.

## Global Constraints

- 모든 npm 명령 전: `export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH"`
- 커밋은 `git add <명시 경로>`만 — `git add .` 금지
- 커밋 전 반드시 `npm run format` → `npx prettier --check .` 통과(`.prettierignore`가
  없어 CI가 마크다운까지 검사한다)
- **push 금지** — main push = 배포다. 커밋은 로컬에만 쌓고 push는 사용자가 결정한다
- CSS에서 shorthand `font`·`background`·`all` 금지(레이어 함정 — CLAUDE.md). 색·크기
  값을 직접 쓰지 말고 SEED 토큰(`var(--seed-*)`·`var(--fg)`·`var(--muted)`·`var(--line)`)만
- 스펙 §1 표의 계약이 하나라도 움직이면 그 diff는 틀렸다

---

### Task 1: `unlockGate()` 교체 + 스타일

**Files:**

- Modify: `src/ui.ts` — `unlockGate` 함수와 그 doc 주석만(현재 316–418행 부근).
  `gatePassed`·`gateUnlocked`·`lockGate`·`gateFlight`(299–314행)와 모듈의 다른 export는
  무변경
- Modify: `src/styles/app.css` — `.confirm-gate:focus` 블록(~81행) 뒤에 `.pin-gate` 계열
  블록 추가. `.confirm-gate` 자체는 지우지 않는다(confirmDialog의 requireText 게이트가
  계속 쓴다)

**Interfaces:**

- Consumes: `gatePassed`·`gateFlight`(ui.ts 모듈 스코프, 이미 존재), SEED 토큰
- Produces: `unlockGate(expected: string): Promise<boolean>` — 시그니처·의미 불변.
  호출자는 `main.ts:161` 하나뿐이고 무변경

- [ ] **Step 1: `src/ui.ts`의 `unlockGate` 함수를 doc 주석째 아래로 교체**

현재 파일에서 `/**\n * PIN 입력 다이얼로그...`로 시작하는 doc 주석부터 `unlockGate`
함수 끝(`  gateFlight = flight\n  return flight\n}`)까지를 통째로 아래로 바꾼다.
`let gateFlight` 선언은 원본에서 doc 주석과 함수 **사이**에 있다 — 교체 블록에 같은
자리로 포함돼 있으니 블록 전체를 그대로 앉히면 된다.

```ts
/**
 * PIN 게이트(2B 스펙 §4 + UI 교체 스펙 2026-08-17). 풀스크린 키패드 화면 —
 * confirmDialog의 오버레이 규약 중 유지되는 것: .overlay 인쇄 격리, document.body
 * 부착, settle 1회 resolve, hashchange 자진 취소. 백드롭 클릭 취소는 없다(풀스크린 —
 * 취소 경로는 ✕·키패드 취소·Escape 셋).
 *
 * 단일 비행: 이미 떠 있으면 같은 Promise를 돌려준다. 게이트는 route() 한가운데서
 * 사람 입력을 무기한 기다리므로, 배경 pull 재렌더(route(false))가 겹치면 화면이
 * 쌓인다 — pullOnce와 같은 방식으로 흡수한다. 비행 중 도착한 새 expected는 무시된다
 * (감수 — 2B §4: 창이 초 단위이고 위협이 여덟 살이다).
 *
 * 틀린 입력은 닫지 않는다 — 도트를 비우고 안내만 바꾼다. 잠금·지연 없음(위협 모델:
 * 아이의 우연한 접근). 입력값 평문은 어디에도 렌더되지 않는다(도트만). 마지막 자리에서
 * 자동 판정한다 — 확인 버튼이 없다(UI 스펙 §2·§3).
 */
let gateFlight: Promise<boolean> | null = null
export function unlockGate(expected: string): Promise<boolean> {
  if (gatePassed) return Promise.resolve(true)
  if (gateFlight) return gateFlight
  const flight = new Promise<boolean>((resolve) => {
    const root = document.createElement('div')
    root.className = 'overlay pin-gate'
    root.setAttribute('role', 'alertdialog')
    root.setAttribute('aria-modal', 'true')
    root.setAttribute('tabindex', '-1')

    const close = document.createElement('button')
    close.className = 'pin-gate-close'
    close.setAttribute('aria-label', '닫기')
    close.textContent = '✕'

    const title = document.createElement('h2')
    title.className = 'pin-gate-title'
    title.textContent = '부모 확인'

    const desc = document.createElement('p')
    desc.className = 'pin-gate-desc'
    desc.setAttribute('aria-live', 'polite')
    desc.textContent = '비밀번호를 입력하세요'

    const dots = document.createElement('div')
    dots.className = 'pin-gate-dots'
    // 장식이다 — 입력 진행(몇 자리째)은 시각 전용으로 감수한다(UI 스펙 §2:
    // 자리마다 낭독하면 옆의 아이에게 자리수를 세어 주는 것이기도 하다).
    dots.setAttribute('aria-hidden', 'true')
    const dotEls: HTMLElement[] = []
    for (let i = 0; i < expected.length; i++) {
      const dot = document.createElement('i')
      dots.append(dot)
      dotEls.push(dot)
    }

    let entered = ''
    const paint = (): void => {
      dotEls.forEach((dot, i) => dot.classList.toggle('filled', i < entered.length))
    }

    const pad = document.createElement('div')
    pad.className = 'pin-gate-keypad'

    let settled = false
    const settle = (result: boolean): void => {
      if (settled) return
      settled = true
      gateFlight = null
      if (result) gatePassed = true
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('hashchange', onHashChange)
      if (result) {
        // 탭 실드(UI 스펙 §2): 버튼은 즉시 죽이고 DOM 제거만 300ms 늦춘다(iOS 더블탭
        // 인식 창 상한 — 한 프레임으로는 두 번째 탭이 도착하기 전에 오버레이가 이미
        // 없다). 마지막 자리 빠른 연타의 두 번째 탭이 이 오버레이에 삼켜져, 아래에
        // 렌더되는 화면(#/grade의 O/X 토글)에 떨어지지 않는다. resolve는 즉시다 —
        // settled 가드가 있어 「정확히 1회」 규약과 충돌하지 않는다.
        root.querySelectorAll('button').forEach((b) => (b.disabled = true))
        setTimeout(() => root.remove(), 300)
      } else {
        root.remove()
      }
      resolve(result)
    }

    const push = (digit: string): void => {
      if (settled) return
      entered += digit
      paint()
      if (entered.length < expected.length) return
      if (entered === expected) {
        settle(true)
        return
      }
      entered = ''
      paint()
      // 비웠다가 다음 틱에 넣는다(UI 스펙 §2) — 같은 틱의 두 변경은 브라우저가 병합해
      // aria-live가 침묵할 수 있고, 그러면 연속 오답 2회째의 같은 문자열이 공지되지
      // 않는다.
      desc.textContent = ''
      setTimeout(() => {
        if (!settled) desc.textContent = '다시 입력해 주세요'
      }, 50)
    }
    const erase = (): void => {
      entered = entered.slice(0, -1)
      paint()
    }

    for (const key of ['1', '2', '3', '4', '5', '6', '7', '8', '9', '취소', '0', '←']) {
      const b = document.createElement('button')
      b.textContent = key
      if (key === '취소') b.addEventListener('click', () => settle(false))
      else if (key === '←') {
        b.setAttribute('aria-label', '한 자리 지우기')
        b.addEventListener('click', erase)
      } else b.addEventListener('click', () => push(key))
      pad.append(b)
    }

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') settle(false)
      else if (e.key === 'Backspace') erase()
      else if (/^[0-9]$/.test(e.key)) push(e.key)
    }
    const onHashChange = (): void => settle(false)
    close.addEventListener('click', () => settle(false))
    document.addEventListener('keydown', onKey)
    window.addEventListener('hashchange', onHashChange)

    root.append(close, title, desc, dots, pad)
    document.body.append(root)
    root.focus() // 기존 input.focus()의 대체(UI 스펙 §2) — tabindex=-1 루트가 받는다
  })
  gateFlight = flight
  return flight
}
```

- [ ] **Step 2: `src/styles/app.css`에 스타일 추가**

`.confirm-gate:focus { ... }` 블록 바로 뒤에 붙인다:

```css
/*
 * PIN 게이트(UI 스펙 2026-08-17 §2). 풀스크린 오버레이 — SEED 다이얼로그 레시피를
 * 쓰지 않으므로(카드+백드롭 모양이라 풀스크린과 싸운다) 레시피가 지던 짐 셋을 여기서
 * 직접 진다: z-index 100(.update 배너 z:10 위 — 다이얼로그 도입 때 밟은 함정),
 * safe-area(viewport-fit=cover라 inset:0이 상태바·홈 인디케이터 밑까지 깔린다),
 * touch-action(같은 키 더블탭 확대 — 24fe4b0 실측, 전역 수정 80a2910 revert는 사유
 * 미기록이라 오버레이 스코프로 재시도. 실기기에서 탭 반응이 이상하면 이 줄이 용의자다).
 */
.pin-gate {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  flex-direction: column;
  align-items: center;
  background-color: var(--seed-color-bg-layer-default);
  padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom)
    env(safe-area-inset-left);
  touch-action: manipulation;
}
.pin-gate:focus {
  outline-style: none;
}
.pin-gate-close {
  align-self: flex-start;
  margin: var(--seed-dimension-x2);
  padding: var(--seed-dimension-x2);
  border-style: none;
  background-color: transparent;
  color: var(--fg);
  font-size: var(--seed-font-size-t7);
}
.pin-gate-title {
  margin: var(--seed-dimension-x10) 0 0;
  font-size: var(--seed-font-size-t8);
  font-weight: 700;
}
.pin-gate-desc {
  margin: var(--seed-dimension-x2) 0 0;
  min-height: var(--seed-dimension-x6); /* 오답 재공지가 한 틱 비워도 레이아웃이 안 튄다 */
  color: var(--muted);
}
.pin-gate-dots {
  display: flex;
  flex-wrap: wrap; /* SQL로 긴 PIN을 넣어도 화면 폭을 안 넘는다(UI 스펙 §2) */
  justify-content: center;
  gap: var(--seed-dimension-x4);
  margin-top: var(--seed-dimension-x10);
  padding: 0 var(--seed-dimension-x4);
}
.pin-gate-dots i {
  width: var(--seed-dimension-x4);
  height: var(--seed-dimension-x4);
  border-radius: 50%;
  background-color: var(--line);
}
.pin-gate-dots i.filled {
  background-color: var(--fg);
}
/* 스프린트 .keypad를 공유하지 않는다(UI 스펙 §2) — 그쪽 치수(320/420px·64px 버튼)는
 * 여덟 살 손가락 기준으로 고른 아이 화면의 값이라, 공유하면 그 조정이 부모 게이트를
 * 조용히 함께 움직인다. 모양이 닮은 것은 우연이고 주인이 다르다. */
.pin-gate-keypad {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--seed-dimension-x2);
  width: 100%;
  max-width: 360px;
  margin-top: auto; /* 남는 세로 공간을 위로 밀어 키패드를 하단에 붙인다 */
  margin-bottom: var(--seed-dimension-x6);
  padding: 0 var(--seed-dimension-x4);
}
.pin-gate-keypad button {
  height: var(--seed-dimension-x16);
  border-style: none;
  border-radius: var(--seed-radius-r3);
  background-color: transparent;
  color: var(--fg);
  font-family: inherit;
  font-size: var(--seed-font-size-t10);
  font-weight: 700;
}
.pin-gate-keypad button:active {
  background-color: var(--seed-color-bg-layer-basement);
}
```

토큰 실재는 이미 확인돼 있다(`x10`·`t7`·`t8`·`t10`·`r3`·`x16` 전부
`node_modules/@seed-design/css/base.layered.css`에 있음). 의심되면:
`grep -o 'seed-dimension-x10\|seed-font-size-t8' node_modules/@seed-design/css/base.layered.css | sort -u`

- [ ] **Step 3: 전체 검증**

```bash
export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH"
npm run format
npx prettier --check .
npm test
npm run build
```

Expected: 셋 다 통과. `npm test`는 기존 엔진 테스트만 돈다 — 이 diff가 깨뜨릴 테스트는
없어야 정상이고, 깨졌다면 `ui.ts`에서 `unlockGate` 밖을 건드린 것이다.

- [ ] **Step 4: 커밋**

```bash
git add src/ui.ts src/styles/app.css
git commit -m "feat: PIN 게이트를 풀스크린 키패드로 — 도트·자동 판정·탭 실드

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: `supabase/README.md` PIN 절 갱신

**Files:**

- Modify: `supabase/README.md` — §6.5 「채점 화면 PIN (선택)」의 "정확히 4자리" 문단만

**Interfaces:**

- Consumes: 없음 (문서만)
- Produces: 없음 — Task 1과 순서 무관하게 독립 리뷰 가능하나, 커밋은 Task 1 뒤에 한다
  (문서가 코드보다 먼저 미래를 말하지 않게)

- [ ] **Step 1: 문단 교체**

현재 README의 이 문단을:

```markdown
**정확히 4자리 숫자로 정한다** — 앱의 입력 칸이 4자리 숫자 키패드다. 4자리를 넘기면
게이트가 열리지 않는다(입력 칸이 4자리까지만 받는다 — `maxlength`는 상한일 뿐 검증기가
아니라서, `pin`을 4자리보다 짧게 넣으면 그 짧은 값 그대로 비교된다. 고치는 길은 아래 같은
SQL이다).
```

아래로 바꾼다:

```markdown
**숫자로만 정한다 — 길이는 자유다.** 앱의 입력 수단이 숫자 키패드뿐이라, 숫자 아닌
문자가 섞인 PIN은 어느 기기에서도 입력할 수 없다(게이트가 영영 안 열린다 — 잠기는 쪽에
관리 화면 `#/manage`가 포함되고, 복구는 아래 SQL뿐이다). 길이는 게이트 화면의 도트
개수와 판정이 서버 값을 그대로 따라간다 — 4자리보다 길거나 짧아도 된다.
```

- [ ] **Step 2: 포맷·검증·커밋**

```bash
export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH"
npm run format
npx prettier --check .
git add supabase/README.md
git commit -m "docs: PIN 규칙 갱신 — 4자리 고정에서 숫자 전용·길이 자유로

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: 육안 검증 (dev 서버 — 수동)

**Files:** 없음 — 코드를 바꾸지 않는 검증 태스크. 브라우저 조작이 가능한 환경에서
수행하고, 불가능하면 아래 체크리스트를 사용자에게 그대로 전달한다.

- [ ] **Step 1: dev 서버 + PIN 캐시 주입**

```bash
export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH"
npm run dev   # http://localhost:5173/haruchi/
```

localhost origin은 보통 미등록이라 pull이 안 돌고(`syncEnabled()`의 `deviceKey !== null`
검사 때문 — origin 격리 때문이 아니다) PIN 캐시가 저절로 생기지 않는다. 앱을 한 번 연 뒤
브라우저 devtools **콘솔**에서:

```js
await new Promise((ok, no) => {
  const req = indexedDB.open('haruchi')
  req.onsuccess = () => {
    const db = req.result
    const tx = db.transaction('device', 'readwrite')
    const store = tx.objectStore('device')
    const get = store.get('current')
    get.onsuccess = () => {
      const st = get.result
      if (!st) return no(new Error('device 레코드 없음 — 앱을 한 번 열고 다시'))
      if (st.deviceKey !== null)
        console.warn('이 origin은 등록돼 있다 — pull이 주입값을 서버 값으로 덮는다')
      store.put({ ...st, pin: '1234' }, 'current') // 레코드 전체를 되쓴다 — {pin}만 put하면 deviceId 등이 날아간다
    }
    tx.oncomplete = () => {
      db.close()
      ok('주입 완료')
    }
    tx.onerror = () => no(tx.error)
  }
  req.onerror = () => no(req.error)
})
```

- [ ] **Step 2: 체크리스트**

`#/grade`로 이동(주소창에 `http://localhost:5173/haruchi/#/grade`). 확인:

1. 풀스크린 게이트: ✕ / "부모 확인" / "비밀번호를 입력하세요" / 빈 도트 4개 / 하단 키패드
2. 숫자 탭마다 도트가 왼쪽부터 채워진다. `←`가 한 자리 지운다
3. 오답(`9999`): 도트 전부 비워지고 안내가 "다시 입력해 주세요"로 바뀐다. 화면은 닫히지 않는다
4. 정답(`1234`): 채점 화면이 열린다. 마지막 자리 빠른 더블탭에도 O/X가 눌리지 않는다(300ms 실드)
5. ✕·키패드 취소·Escape 셋 다: 게이트가 닫히고 부모 홈(`#/parent`)으로 이동
6. 물리 키보드 0–9·Backspace·Escape 동작
7. 인쇄 미리보기(⌘P)에서 게이트가 보이지 않는다(`.overlay` 격리)

- [ ] **Step 3: 실기기 체크리스트를 사용자에게 전달**

아이패드(standalone PWA)는 에이전트가 검증 불가 — 아래를 보고에 포함한다(스펙 §6의 4):

- safe-area: ✕가 상태바에 안 깔리고 하단 키 줄이 홈 인디케이터와 안 겹친다
- 같은 키 빠른 연타에 화면 확대가 안 튄다
- 업데이트 배너가 떠 있을 때 게이트가 그 위를 덮는다
- touch-action 재시도(80a2910 revert의 재도전): 게이트 화면 안 탭·스크롤 반응이 이상하면
  `.pin-gate`의 `touch-action: manipulation`이 용의자다

- [ ] **Step 4: 배포 전 서버 PIN 소급 확인을 사용자에게 안내**

push(=배포) 전에 Supabase SQL Editor에서:

```sql
select pin from app_config where id = 1;
```

값이 숫자 전용이 아니면 배포 전에 숫자로 바꿔야 한다 — 새 UI는 숫자만 입력받으므로
숫자 아닌 PIN은 모든 기기를 영구히 잠근다(스펙 §4).
