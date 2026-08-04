# 역할별 화면 분리 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 홈 화면 하나를 아이 홈(`#/`)과 부모 홈(`#/parent`) 둘로 나눠, 아이에게는 오늘 할 일만 크게 보이고 정답이 있는 화면은 부모 쪽에만 남게 한다.

**Architecture:** 역할을 저장하지 않는다 — 지금 보고 있는 주소가 곧 역할이다. `screens/home.ts`를 `home-child.ts`와 `home-parent.ts`로 가르고, `main.ts`의 기본 분기를 아이 홈으로 바꾼다. 아이 홈 전용 색·카드는 새 스타일시트 `styles/kid.css`에 가둬 부모 화면과 인쇄물 톤이 물들지 않게 한다.

**Tech Stack:** TypeScript(strict) · Vite · vitest · 프레임워크 없는 DOM 렌더(`ui.ts`의 `el()`) · 해시 라우팅

**설계 문서:** `docs/superpowers/specs/2026-08-04-role-based-ui-design.md` (이 계획의 근거. 절 번호는 전부 이 문서를 가리킨다)

## Global Constraints

이 절은 **모든 태스크의 요구사항에 암묵적으로 포함된다.**

- **화면 단위 테스트를 만들지 않는다** — 기본 설계 §12 "DOM·화면 단위 테스트 (개인 앱에 비용 대비 값이 나오지 않음)". 화면 태스크의 검증은 ① `npm test`가 기존 254개 그대로 통과(회귀 없음) ② `npm run build`(내부에서 `tsc --noEmit` 실행) ③ `npx prettier --check .` ④ 브라우저 육안 확인이다. 화면 테스트를 새로 만들지 말 것.
- **저장 스키마를 바꾸지 않는다** — `Settings`에도 `Day`에도 새 필드가 없다. `validateBackup`도 손대지 않는다.
- **Node는 mise에만 있다.** 모든 명령 앞에 한 번 실행: `export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH"`
- **`prettier --check`가 `docs/`까지 검사한다**(`.prettierignore`가 없다). 커밋 전 반드시 `npm run format`. 이걸 빼먹으면 마크다운 포맷 흠 하나로 배포가 막힌다.
- **`el()`은 `innerHTML`을 쓴다.** 신뢰할 수 없는 값은 `ui.ts`의 `escapeHtml`을 통과시켜야 한다. 이 계획에서 템플릿에 넣는 값은 전부 우리가 만든 리터럴과 설정 숫자뿐이라 새로 이스케이프할 대상은 없다 — **다만 값을 하나라도 추가한다면 확인할 것.**
- **색은 두 개만.** `kid.css`의 `--kid-accent: #f2760c`(주황)와 `--kid-done: #1f9d55`(초록). 세 번째 색을 도입하지 말 것(§6).
- **커밋 메시지는 한국어**, 본문에 "왜"를 적고 끝에 `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- **git 사용자 정보가 설정돼 있지 않을 수 있다.** 실패하면 `git -c user.name="이성호" -c user.email="watson@daangnpay.com" commit ...`

## File Structure

| 파일                                                  | 책임                                     | 상태     |
| ----------------------------------------------------- | ---------------------------------------- | -------- |
| `src/engine/report.ts`                                | 리포트 집계 + `pendingGradeDate`         | 수정     |
| `src/engine/report.test.ts`                           | 위 함수들의 단위 테스트                  | 수정     |
| `src/screens/home-parent.ts`                          | 부모 홈 렌더 (`#/parent`)                | **신규** |
| `src/screens/home-child.ts`                           | 아이 홈 렌더 (`#/`)                      | **신규** |
| `src/screens/home.ts`                                 | —                                        | **삭제** |
| `src/styles/kid.css`                                  | 아이 홈 전용 색·카드                     | **신규** |
| `src/styles/app.css`                                  | 공통 화면 스타일 + 부모 홈 보조 링크 줄  | 수정     |
| `index.html`                                          | `kid.css` 연결                           | 수정     |
| `src/main.ts`                                         | 라우팅 (`#/parent` 추가, 기본 분기 교체) | 수정     |
| `src/screens/{grade,print-sheet,report}.ts`           | "← 홈"의 목적지를 `#/parent`로           | 수정     |
| `docs/superpowers/HANDOFF.md`                         | 역할 분리 사실과 확인 항목 기록          | 수정     |
| `docs/superpowers/specs/2026-08-02-haruchi-design.md` | §7 홈 그림에서 새 스펙으로 넘김          | 수정     |

**`.step`·`.streak`·`.banner`의 처리**: 이 셋은 `app.css`에 있고 다른 화면도 쓴다. 부모 홈은 그대로 쓰고, **아이 홈은 가져다 쓰지 않고 `kid.css`에 `.kid-*`로 새로 만든다**(설계 §9). 유일한 예외가 아이 홈의 오류 화면인데, 이유는 태스크 3에 적어 뒀다.

**태스크 순서의 근거**: 부모 홈을 **먼저** 만든다(태스크 2). 아이 홈을 먼저 만들면 기본 분기가 아이 홈으로 바뀌는 순간 인쇄·채점으로 가는 길이 앱에서 사라져, 태스크 사이에 앱이 망가진 상태로 남는다. 부모 홈이 이미 있으면 태스크 3에서 기본을 아이 홈으로 바꿔도 기능 손실이 없다.

---

### Task 0: 이음새 확인 (코드 변경 없음)

HANDOFF 교훈 6번("가장 값진 결함은 태스크 사이의 이음새에 있다 — 새 코드가 쓸 필드를 이미 읽고 있는 모든 곳을 나열하는 단계를 태스크 0으로 둘 것")에 따른다. 계획이 쓰인 시점과 실행 시점 사이에 코드가 달라졌을 수 있으니, **아래 예상값과 실제가 다르면 멈추고 보고할 것.**

**Files:** 없음 (조사만)

**Interfaces:**

- Consumes: 없음
- Produces: 이후 태스크가 전제하는 사실들의 확인

- [ ] **Step 1: `navigate('#/')` 호출 지점을 센다**

Run:

```bash
grep -rn "navigate('#/')" src/screens/
```

Expected: 13줄이 잡힌다. 그중 `src/screens/sprint.ts:105`는 **주석 안**이므로 실제 호출은 12곳이다.

| 파일             | 실제 호출 수 | 태스크 4에서 바꾸나 |
| ---------------- | ------------ | ------------------- |
| `ebs.ts`         | 1            | 아니오 (아이 소속)  |
| `map.ts`         | 2            | 아니오 (아이 소속)  |
| `sprint.ts`      | 2            | 아니오 (아이 소속)  |
| `grade.ts`       | 2            | **예 → `#/parent`** |
| `print-sheet.ts` | 2            | **예 → `#/parent`** |
| `report.ts`      | 3            | **예 → `#/parent`** |

즉 **바꾸는 것은 7곳뿐이고 5곳은 그대로 둔다.** 아이 소속 화면(스프린트·지도·EBS)은 이미 아이 홈으로 가고 있다.

- [ ] **Step 2: `renderHome`을 쓰는 곳을 찾는다**

Run:

```bash
grep -rn "renderHome" src/
```

Expected: 3곳 — `main.ts`의 import와 기본 분기 호출, `home.ts` 안의 재시도 경로(`void renderHome(root)`). 이 셋이 전부여야 한다.

- [ ] **Step 3: `report.ts`에 이름 충돌이 없는지 본다**

Run:

```bash
grep -n "^export" src/engine/report.ts
```

Expected: `EXPORT_OVERDUE_DAYS`, `completedCount`, `WeeklyReport`, `weeklyReport`, `CheckupReport`, `latestCheckupReport`. **`pendingGradeDate`는 없어야 한다**(있으면 이미 옮겨진 것이니 태스크 1을 건너뛰고 보고).

- [ ] **Step 4: 기준선을 기록한다**

Run:

```bash
export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH"
npm test 2>&1 | tail -3
```

Expected: `Tests  254 passed (254)`. 이 숫자가 태스크 1 이후 258이 되고, 이후 태스크에서는 변하지 않아야 한다.

---

### Task 1: `pendingGradeDate`를 엔진으로 옮기고 테스트를 붙인다

지금은 `home.ts` 안에 있어 테스트가 하나도 없다. "빈 `sheet`인 날은 제외"라는 규칙이 들어 있는데(스프린트만 한 날에 미채점 배너가 영원히 남던 문제의 수정 흔적), 그 규칙을 고정하는 것이 아무것도 없다. 부모 홈으로 옮기기 전에 엔진으로 빼고 테스트를 건다.

**Files:**

- Modify: `src/engine/report.ts` (파일 끝에 추가)
- Modify: `src/engine/report.test.ts` (파일 끝에 추가)
- Modify: `src/screens/home.ts:1-23` (지역 함수를 지우고 엔진에서 import)

**Interfaces:**

- Consumes: `Day` 타입(`src/data/types.ts`)
- Produces: `export function pendingGradeDate(days: Day[], today: string): string | null` — `src/engine/report.ts`에서 내보낸다. 태스크 2의 부모 홈이 이것을 쓴다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/engine/report.test.ts` 맨 끝에 추가한다. 파일 상단의 import에 `pendingGradeDate`를 더한다:

```ts
import { weeklyReport, completedCount, latestCheckupReport, pendingGradeDate } from './report'
```

그리고 파일 끝에:

```ts
describe('pendingGradeDate', () => {
  // sheet가 비어 있지 않은 날을 만들기 위한 최소 문항 하나. 값 자체는 의미 없고
  // "문제지가 있었다"만 나타낸다.
  const item = (): Day['sheet'] => [
    { id: 'v1', kind: 'vertical', tag: 'add2-nocarry', a: 12, b: 3, op: '+', answer: 15 },
  ]
  const paperDay = (date: string, grades?: Record<string, boolean>): Day => ({
    date,
    kind: 'normal',
    sheet: item(),
    ...(grades ? { grades } : {}),
  })

  it('채점이 비어 있는 가장 최근 과거 날짜를 돌려준다', () => {
    const days = [paperDay('2026-08-01'), paperDay('2026-08-02')]
    expect(pendingGradeDate(days, '2026-08-03')).toBe('2026-08-02')
  })

  it('오늘과 미래는 후보가 아니다 — 오늘 것은 저녁에 채점하므로 배너를 띄우면 매일 아침 거짓말이 된다', () => {
    const days = [paperDay('2026-08-03'), paperDay('2026-08-04')]
    expect(pendingGradeDate(days, '2026-08-03')).toBeNull()
  })

  it('sheet가 빈 날(스프린트만 한 날)은 건너뛴다 — 채점할 문항이 없어 배너가 영원히 남는다', () => {
    const days = [
      paperDay('2026-08-01'),
      { date: '2026-08-02', kind: 'normal', sheet: [], sprint: [] } as Day,
    ]
    expect(pendingGradeDate(days, '2026-08-03')).toBe('2026-08-01')
  })

  it('이미 채점한 날은 건너뛰고, 후보가 하나도 없으면 null이다', () => {
    const days = [paperDay('2026-08-01', { v1: true }), paperDay('2026-08-02', { v1: false })]
    expect(pendingGradeDate(days, '2026-08-03')).toBeNull()
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run:

```bash
export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH"
npx vitest run src/engine/report.test.ts 2>&1 | tail -20
```

Expected: FAIL — `pendingGradeDate is not a function` 또는 import 오류.

- [ ] **Step 3: 구현을 엔진으로 옮긴다**

`src/engine/report.ts` 맨 끝에 추가한다(`home.ts`에 있던 것을 주석까지 그대로 옮기고, 이사 사실 한 줄만 덧붙인다 — `completedCount`가 같은 방식으로 이사해 온 선례가 바로 위에 있다):

```ts
/**
 * 채점이 비어 있는 가장 최근 과거 날짜. 문제지가 없던 날은 제외한다. 없으면 null.
 * home.ts에서 이사해 왔다(역할 분리, 2026-08-04) — 부모 홈의 미채점 배너가 쓴다.
 */
export function pendingGradeDate(days: Day[], today: string): string | null {
  for (let i = days.length - 1; i >= 0; i--) {
    const d = days[i]!
    if (d.date >= today) continue
    // 스프린트만 하고 문제지는 인쇄하지 않은 날(여행·늦은 밤 — streak.ts가 기대하는 바로
    // 그 날)은 채점할 문항이 하나도 없다. 걸러내지 않으면 배너가 영원히 남는다:
    // renderPrint는 오늘 것만 만들므로 지난 날은 문제지를 나중에도 가질 수 없고,
    // 빈 채점 화면에서 저장해도 grades가 {}라 다시 미채점으로 잡힌다.
    if (d.sheet.length === 0) continue
    if (!d.grades || Object.keys(d.grades).length === 0) return d.date
  }
  return null
}
```

- [ ] **Step 4: `home.ts`가 엔진 것을 쓰게 한다**

`src/screens/home.ts`에서 지역 함수 `pendingGradeDate`(10~23행)를 통째로 지우고, 5행의 import를 바꾼다:

```ts
import { completedCount, pendingGradeDate } from '../engine/report'
```

같은 파일 7행의 `import type { Day } from '../data/types'`는 이제 쓰이지 않으므로 지운다.

- [ ] **Step 5: 테스트가 통과하는지 확인한다**

Run:

```bash
export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH"
npm test 2>&1 | tail -3 && npm run build 2>&1 | tail -2
```

Expected: `Tests  258 passed (258)` (254 + 신규 4), 빌드 성공.

- [ ] **Step 6: 변이 검증 — 테스트가 실제로 무언가를 지키는지 확인한다**

HANDOFF 교훈 7번("테스트가 자기가 검사한다고 주장하는 것을 실제로는 검사하지 못한다")에 따라, 구현을 일부러 틀리게 바꿔 각 테스트가 빨개지는지 본다. **하나씩 바꾸고 매번 원복한다.**

```bash
export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH"
# 변이 A: 빈 sheet 가드를 지운다 → 3번째 테스트가 빨개져야 한다
# src/engine/report.ts에서 `if (d.sheet.length === 0) continue` 줄을 지우고:
npx vitest run src/engine/report.test.ts 2>&1 | grep -E "Tests |FAIL"
# 원복

# 변이 B: 과거 판정을 뒤집는다(`>=` → `>`) → 2번째 테스트가 빨개져야 한다
# `if (d.date >= today) continue` 를 `if (d.date > today) continue` 로 바꾸고:
npx vitest run src/engine/report.test.ts 2>&1 | grep -E "Tests |FAIL"
# 원복
```

Expected: 변이 A와 B 각각에서 **정확히 그 테스트만** 실패한다. 아무것도 안 빨개지면 그 테스트는 공허하므로 픽스처를 고칠 것.

- [ ] **Step 7: 커밋**

```bash
export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH"
npm run format
git add src/engine/report.ts src/engine/report.test.ts src/screens/home.ts
git commit -m "$(cat <<'EOF'
refactor: pendingGradeDate를 화면에서 엔진으로 옮기고 테스트를 붙인다

역할 분리(부모 홈으로 이사)의 준비 작업. 화면 안에 있어서 지금까지 테스트가
하나도 없었는데, "빈 sheet인 날은 제외"라는 규칙을 담고 있다 — 스프린트만 한
날에 미채점 배너가 영원히 남던 문제의 수정 흔적이다. 그 규칙을 고정하는 것이
아무것도 없었다.

completedCount가 같은 방식으로 home.ts에서 이사해 온 선례를 따른다.
테스트 4개(가장 최근 미채점일 / 오늘·미래 제외 / 빈 sheet 제외 / 없으면 null)를
변이 검증으로 확인했다 — 빈 sheet 가드를 지우거나 과거 판정을 뒤집으면 각각
해당 테스트만 빨개진다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: 부모 홈을 신설한다 (`#/parent`)

기존 홈은 그대로 두고 부모 홈을 **추가**한다. 이 태스크가 끝나도 앱의 기본 화면은 아직 기존 홈이다 — 기능 손실 없이 다음 태스크로 넘어가기 위해서다.

**Files:**

- Create: `src/screens/home-parent.ts`
- Modify: `src/styles/app.css` (파일 끝에 `.links` 추가)
- Modify: `src/main.ts` (라우트 한 분기 추가)

**Interfaces:**

- Consumes: `pendingGradeDate`(태스크 1), `completedCount`·`sprintStreak`·`dayKey`·`THINKING_ITEMS_PER_DAY`, `ui.ts`의 `el`·`formatDate`·`navigate`·`showError`·`clearError`
- Produces: `export async function renderParentHome(root: HTMLElement): Promise<void>` — `src/screens/home-parent.ts`. 태스크 3·4가 `#/parent`로 보내는 대상이다.

- [ ] **Step 1: 부모 홈 파일을 만든다**

`src/screens/home-parent.ts`:

```ts
import { getAllDays, getMeta } from '../data/db'
import { THINKING_ITEMS_PER_DAY } from '../engine/compose'
import { dayKey } from '../engine/dates'
import { completedCount, pendingGradeDate } from '../engine/report'
import { sprintStreak } from '../engine/streak'
import { clearError, el, formatDate, navigate, showError } from '../ui'

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
    const todayDay = days.find((d) => d.date === today)
    const printed = Boolean(todayDay?.sheet.length)
    const graded = Boolean(todayDay?.grades && Object.keys(todayDay.grades).length > 0)
    const pending = pendingGradeDate(days, today)

    root.replaceChildren(
      el(`
        <div>
          <h1>하루치 · 부모</h1>
          <div class="date">${formatDate(today)}</div>
          <div class="streak">
            ✅ ${completedCount(days)}일 완료 &nbsp;·&nbsp; 🔥 ${sprintStreak(days, today)}일 연속
          </div>
          ${
            pending
              ? `<div class="banner" id="pending">${formatDate(pending)} 채점이 안 됐어요 — 지금 하기</div>`
              : ''
          }
          <button class="step ${printed ? 'done' : ''}" id="print">
            ${printed ? '✓ ' : ''}문제지 인쇄
            <small>세로셈 ${meta.settings.verticalCount} + □ 채우기 ${meta.settings.inverseCount} + 생각하는 문제 ${THINKING_ITEMS_PER_DAY} (${meta.settings.verticalCount + meta.settings.inverseCount + THINKING_ITEMS_PER_DAY}문항 · 2장)</small>
          </button>
          <button class="step ${graded ? 'done' : ''}" id="grade">
            ${graded ? '✓ ' : ''}채점하기
            <small>${printed ? '틀린 것만 눌러주세요' : '문제지를 먼저 인쇄해주세요'}</small>
          </button>
          <button class="step" id="report">주간 리포트</button>
          <div class="links">
            <button id="map">구구단 지도</button><span class="sep">·</span><button id="ebs">EBS 강의</button>
          </div>
          <div class="links"><button id="child">← 아이 화면</button></div>
        </div>
      `),
    )

    root.querySelector('#print')!.addEventListener('click', () => navigate('#/print'))
    root.querySelector('#grade')!.addEventListener('click', () => {
      if (!printed) return
      navigate('#/grade')
    })
    root.querySelector('#report')!.addEventListener('click', () => navigate('#/report'))
    root.querySelector('#map')!.addEventListener('click', () => navigate('#/map'))
    root.querySelector('#ebs')!.addEventListener('click', () => navigate('#/ebs'))
    root.querySelector('#child')!.addEventListener('click', () => navigate('#/'))
    root.querySelector('#pending')?.addEventListener('click', () => navigate(`#/grade/${pending}`))
  } catch (e) {
    // 조회 실패를 전부 여기서 잡는다(옛 home.ts와 같은 패턴). showError는 body에만 붙으므로
    // 주소창 없는 스탠드얼론 PWA에서는 #app 안에도 조작 수단이 있어야 갇히지 않는다.
    // 부모 홈은 아이 홈으로 나갈 길도 함께 남긴다 — 재시도가 계속 실패해도 앱은 살아 있다.
    showError(`화면을 불러오지 못했어요: ${(e as Error).message}`)
    root.replaceChildren(
      el(`
        <div>
          <h1>하루치 · 부모</h1>
          <p class="date">기록을 여는 데 실패했어요.</p>
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
```

- [ ] **Step 2: 보조 링크 줄 스타일을 더한다**

`src/styles/app.css` 맨 끝에 추가한다:

```css
/* 부모 홈 하단의 보조 링크 줄(설계 2026-08-04-role-based-ui §4).
 * 카드(.step)보다 가볍게 — 매일 누르는 버튼이 아니라 가끔 들르는 곳이다. */
.links {
  margin-top: 16px;
  font-size: 14px;
}
.links button {
  background: none;
  border: none;
  padding: 4px 0;
  font: inherit;
  color: var(--muted);
  text-decoration: underline;
  cursor: pointer;
}
.links .sep {
  color: var(--line);
  margin: 0 8px;
}
```

- [ ] **Step 3: 라우트를 연결한다**

`src/main.ts`의 `route()` 안, `#/ebs` 분기 **다음**에 추가한다(기존 `else` 앞):

```ts
    } else if (hash.startsWith('#/parent')) {
      const { renderParentHome } = await import('./screens/home-parent')
      await renderParentHome(app)
    } else {
```

주의: `#/print` 검사가 위에 있지만 `'#/parent'.startsWith('#/print')`는 거짓이므로 충돌하지 않는다.

- [ ] **Step 4: 빌드와 회귀를 확인한다**

Run:

```bash
export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH"
npm test 2>&1 | tail -3 && npm run build 2>&1 | tail -2
```

Expected: `Tests  258 passed (258)`(태스크 1과 동일 — 화면 태스크는 테스트를 늘리지 않는다), 빌드 성공.

- [ ] **Step 5: 브라우저로 눈으로 확인한다**

Run:

```bash
export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH"
npm run dev
```

`http://localhost:5173/haruchi/#/parent`를 연다. 확인할 것:

- 제목이 `하루치 · 부모`이고 `✅ n일 완료 · 🔥 n일 연속`이 보인다
- `문제지 인쇄`·`채점하기`·`주간 리포트` 세 버튼이 있고 각각 해당 화면으로 간다
- 하단 `구구단 지도 · EBS 강의`, `← 아이 화면`이 밑줄 링크로 보이고 각각 이동한다
- `#/`(기존 홈)은 아직 옛 화면 그대로다 — 이 태스크에서는 정상이다

- [ ] **Step 6: 커밋**

```bash
export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH"
npm run format
git add src/screens/home-parent.ts src/styles/app.css src/main.ts
git commit -m "$(cat <<'EOF'
feat: 부모 홈(#/parent)을 신설한다

역할 분리의 1단계. 기존 홈은 그대로 두고 부모 홈을 추가만 한다 — 아이 홈을
먼저 만들면 기본 분기가 바뀌는 순간 인쇄·채점으로 가는 길이 사라져 태스크
사이에 앱이 망가진 상태로 남는다.

- 인쇄·채점·리포트를 담고, 지도·EBS는 한 줄 링크로 둔다(부모도 진도를
  확인하지만 아이 홈처럼 카드로 크게 두지는 않는다)
- ✅ 완료일수가 이쪽으로 온다. 기본 설계 §6.8이 "관대함(🔥)과 정직함(✅)을
  두 숫자로 분리한다"고 정해 뒀는데 옛 홈은 둘을 한 줄에 놓아 그 분리를
  화면에서 지키지 못했다
- 미채점 배너도 이쪽 — 아이 홈에 있으면 아이가 아빠 할 일을 독촉받는다
- 오류 경로에 재시도와 "← 아이 화면"을 둘 다 남긴다(주소창 없는 PWA)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: 아이 홈을 신설하고 기본 화면으로 만든다 (`#/`)

**Files:**

- Create: `src/screens/home-child.ts`
- Create: `src/styles/kid.css`
- Modify: `index.html` (스타일시트 연결)
- Modify: `src/main.ts` (기본 분기 교체, import 교체)
- Delete: `src/screens/home.ts`

**Interfaces:**

- Consumes: `checkupDue`·`sprintStreak`·`dayKey`, `ui.ts`의 `el`·`formatDate`·`navigate`·`showError`·`clearError`
- Produces: `export async function renderChildHome(root: HTMLElement): Promise<void>` — `src/screens/home-child.ts`. `main.ts`의 기본 분기가 부른다.

- [ ] **Step 1: 아이 홈 전용 스타일시트를 만든다**

`src/styles/kid.css`:

```css
/* 아이 홈 전용(설계 2026-08-04-role-based-ui §6).
 *
 * app.css에 섞지 않는다 — 색과 큰 카드는 아이 화면에만 있어야 하고, 파일 경계가
 * 그 보장을 대신한다. 부모 화면과 인쇄물의 담백한 톤이 실수로 물들지 않는다.
 * 클래스는 전부 .kid- 접두사를 쓴다. 색은 둘뿐이다 — 늘리면 "오늘 뭘 눌러야
 * 하는지"가 오히려 흐려진다.
 */
:root {
  --kid-accent: #f2760c;
  --kid-done: #1f9d55;
}

.kid-streak {
  text-align: center;
  font-size: 22px;
  font-weight: 800;
  margin: 26px 0 22px;
}

/* 오늘 할 일 하나. 화면에서 가장 큰 것이어야 한다. */
.kid-main {
  display: block;
  width: 100%;
  border: none;
  border-radius: 22px;
  background: var(--kid-accent);
  color: #fff;
  padding: 40px 24px;
  font-size: 26px;
  font-weight: 800;
  text-align: center;
  cursor: pointer;
}
.kid-main small {
  display: block;
  margin-top: 10px;
  font-size: 15px;
  font-weight: 600;
  opacity: 0.92;
}
/* 완료는 비활성이 아니라 성취다 — 회색으로 죽이지 않고 초록으로 바꾼다. */
.kid-main.done {
  background: var(--kid-done);
}

.kid-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-top: 16px;
}
.kid-card {
  border: 2px solid var(--line);
  border-radius: 16px;
  background: #fff;
  padding: 24px 14px;
  font-size: 16px;
  font-weight: 700;
  color: var(--fg);
  cursor: pointer;
}

/* 부모 진입. 목적 4(부모 도구를 눈에서 치우기)를 지키되, 아빠가 찾아
 * 헤매지 않을 만큼은 보이게 한다. */
.kid-parent {
  display: block;
  margin: 30px 0 0 auto;
  background: none;
  border: none;
  padding: 6px;
  font: inherit;
  font-size: 13px;
  color: var(--muted);
  cursor: pointer;
}
```

- [ ] **Step 2: `index.html`에 연결한다**

`print.css` 줄 다음에 추가한다:

```html
<link rel="stylesheet" href="/src/styles/kid.css" />
```

- [ ] **Step 3: 아이 홈 파일을 만든다**

`src/screens/home-child.ts`:

```ts
import { getAllDays, getMeta } from '../data/db'
import { checkupDue } from '../engine/checkup'
import { dayKey } from '../engine/dates'
import { sprintStreak } from '../engine/streak'
import { clearError, el, formatDate, navigate, showError } from '../ui'

/**
 * 아이 홈(설계 2026-08-04-role-based-ui §3). 앱의 기본 화면이다.
 *
 * 인쇄·채점·리포트 버튼이 **없다** — 채점 화면은 모든 문항의 정답을 표시하므로
 * 아이가 거기 닿는 경로를 화면에서 없앤다. 다만 잠금이 아니라 분리라서,
 * 주소를 알고 치면 여전히 열린다(설계 §8의 한계).
 *
 * 🔥만 두고 ✅ 완료일수는 부모 홈으로 보낸다 — 기본 설계 §6.8의 "관대함과
 * 정직함을 두 숫자로 분리"가 화면에서도 지켜진다.
 */
export async function renderChildHome(root: HTMLElement): Promise<void> {
  try {
    const meta = await getMeta()
    const days = await getAllDays()
    const today = dayKey(new Date())
    const todayDay = days.find((d) => d.date === today)
    // "sprint가 있고 비어 있지 않다" — sprintStreak(streak.ts)·completedCount(report.ts)와
    // 같은 식을 써야 한다. 어긋나면 같은 날을 두고 화면이 서로 다른 말을 한다.
    const sprinted = Boolean(todayDay?.sprint && todayDay.sprint.length > 0)
    const checkup = checkupDue(days, meta.settings.fluentMs, today)

    // 스프린트 카드 3-상태(옛 home.ts 로직 그대로). 점검 due는 오늘 스프린트가 끝난
    // 직후에도 참이 될 수 있어(그 세션이 첫 fluent를 만들면 게이트가 그때 열린다),
    // 오늘 이미 했으면 광고하지 않는다 — 눌러도 기존 결과 화면이 뜨므로 버튼이 거짓말이 된다.
    const card =
      todayDay?.kind === 'checkup' && sprinted
        ? { done: true, label: '✓ 오늘 점검 끝!', sub: '정복한 식을 다시 확인했어요' }
        : checkup && !sprinted
          ? { done: false, label: '🔍 점검 스프린트', sub: '정복한 식을 다시 확인해요' }
          : sprinted
            ? { done: true, label: '✓ 오늘 끝!', sub: '내일 또 만나요' }
            : {
                done: false,
                label: '▶ 구구단 스프린트',
                sub: `${meta.settings.sprintCount}문제 · 3분`,
              }

    root.replaceChildren(
      el(`
        <div>
          <h1>하루치</h1>
          <div class="date">${formatDate(today)}</div>
          <div class="kid-streak">🔥 ${sprintStreak(days, today)}일 연속</div>
          <button class="kid-main ${card.done ? 'done' : ''}" id="sprint">
            ${card.label}
            <small>${card.sub}</small>
          </button>
          <div class="kid-row">
            <button class="kid-card" id="map">구구단 지도</button>
            <button class="kid-card" id="ebs">EBS 강의</button>
          </div>
          <button class="kid-parent" id="parent">부모 →</button>
        </div>
      `),
    )

    root.querySelector('#sprint')!.addEventListener('click', () => navigate('#/sprint'))
    root.querySelector('#map')!.addEventListener('click', () => navigate('#/map'))
    root.querySelector('#ebs')!.addEventListener('click', () => navigate('#/ebs'))
    root.querySelector('#parent')!.addEventListener('click', () => navigate('#/parent'))
  } catch (e) {
    // 홈은 기본 경로이자 PWA의 start_url이라 여기서 던지면 #app이 빈 채로 남는다.
    // showError는 body에만 붙으므로, 홈 화면으로만 띄운 스탠드얼론 앱에는 주소창도
    // 새로고침 버튼도 없다 — #app 안에 살아 있는 조작 수단을 남긴다. 홈에서는
    // 돌아갈 곳이 없으므로 이동이 아니라 재시도다.
    showError(`화면을 불러오지 못했어요: ${(e as Error).message}`)
    root.replaceChildren(
      el(`
        <div>
          <h1>하루치</h1>
          <p class="date">기록을 여는 데 실패했어요.</p>
          <button class="step" id="retry">다시 시도</button>
        </div>
      `),
    )
    root.querySelector('#retry')!.addEventListener('click', () => {
      clearError()
      void renderChildHome(root)
    })
  }
}
```

> **오류 경로가 `.kid-*`가 아니라 `class="step"`을 쓰는 것은 의도다.** 실패 화면은 설계된 아이 화면이 아니라 마지막 탈출구이고, 여기까지 아이용 스타일을 복제하면 kid.css가 두 벌이 된다. 리뷰에서 지적하지 말 것.

- [ ] **Step 4: 라우팅의 기본 분기를 바꾸고 옛 홈을 지운다**

`src/main.ts`의 홈 import를 바꾼다(태스크 2에서 이미 편집한 파일이라 줄 번호에 기대지 말고 내용으로 찾을 것 — `import { renderHome } from './screens/home'`):

```ts
import { renderChildHome } from './screens/home-child'
```

그리고 `route()` 끝의 기본 분기를 바꾼다:

```ts
    } else {
      await renderChildHome(app)
    }
```

옛 파일을 지운다:

```bash
git rm src/screens/home.ts
```

- [ ] **Step 5: 빌드와 회귀를 확인한다**

Run:

```bash
export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH"
npm test 2>&1 | tail -3 && npm run build 2>&1 | tail -2
grep -rn "screens/home'" src/ || echo "옛 home.ts 참조 없음 — 정상"
```

Expected: `Tests  258 passed (258)`, 빌드 성공, 옛 참조 없음.

- [ ] **Step 6: 브라우저로 눈으로 확인한다**

`npm run dev` 후 `http://localhost:5173/haruchi/`를 연다.

- 🔥 연속일수만 보이고 ✅는 **없다**
- 주황색 큰 카드에 `▶ 구구단 스프린트`(오늘 했으면 초록 `✓ 오늘 끝!`)
- 아래 작은 카드 둘(`구구단 지도`·`EBS 강의`)이 나란히
- 오른쪽 아래 작은 `부모 →`가 `#/parent`로 간다
- **인쇄·채점·리포트 버튼이 보이지 않는다**

- [ ] **Step 7: 커밋**

```bash
export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH"
npm run format
git add src/screens/home-child.ts src/styles/kid.css index.html src/main.ts
git commit -m "$(cat <<'EOF'
feat: 아이 홈을 신설해 기본 화면으로 삼고 옛 home.ts를 지운다

역할 분리의 2단계. 부모 홈이 이미 있으므로 기본을 아이 홈으로 바꿔도 기능
손실이 없다.

- 오늘 할 일(스프린트) 하나를 화면에서 가장 큰 것으로 두고, 지도·EBS는 작은
  카드로 내린다. 인쇄·채점·리포트는 아예 없다 — 채점 화면은 모든 문항의
  정답을 표시하므로 아이가 닿는 경로를 화면에서 없앤다
- 🔥만 남기고 ✅는 부모 홈으로 보냈다(기본 설계 §6.8)
- 완료 상태를 회색이 아니라 초록으로 — 아이 화면에서 완료는 비활성이 아니라
  성취다
- 색·카드는 kid.css에 가둔다. app.css에 섞으면 부모 화면과 인쇄물 톤이
  물들 수 있고, 파일 경계가 그 보장을 대신한다

역할은 저장하지 않는다 — 지금 보고 있는 주소가 곧 역할이다. 그래서 PWA
아이콘·새로고침·재시작이 구조적으로 항상 아이 홈에 떨어진다(manifest의
start_url이 이미 해시 없는 /haruchi/라 손댈 것이 없다).

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: 부모 화면의 "← 홈"을 부모 홈으로 되돌린다

지금 인쇄·채점·리포트의 "← 홈"이 `#/`로 가므로, 태스크 3 이후에는 **아빠가 채점을 마치고 홈을 눌러도 아이 화면으로 떨어진다.** 부모 흐름이 매번 끊긴다.

**규칙: 화면은 자기 소속 홈으로 돌아간다.** 아이 소속(스프린트·지도·EBS)은 이미 `#/`로 가므로 **건드리지 않는다.**

**Files:**

- Modify: `src/screens/grade.ts:62`, `src/screens/grade.ts:180`
- Modify: `src/screens/print-sheet.ts:189`, `src/screens/print-sheet.ts:240`
- Modify: `src/screens/report.ts:155`, `src/screens/report.ts:253`, `src/screens/report.ts:272`

**Interfaces:**

- Consumes: `#/parent` 라우트(태스크 2)
- Produces: 없음(동작 변경만)

- [ ] **Step 1: 바꿀 7곳을 확인한다**

Run:

```bash
grep -n "navigate('#/')" src/screens/grade.ts src/screens/print-sheet.ts src/screens/report.ts
```

Expected: 7줄(grade 2 · print-sheet 2 · report 3). 행 번호는 앞선 태스크의 편집으로 달라질 수 있으니 **줄 번호가 아니라 내용으로 찾을 것.**

- [ ] **Step 2: 세 파일에서 목적지를 바꾼다**

세 파일에 한해 `navigate('#/')`를 `navigate('#/parent')`로 바꾼다:

```bash
perl -pi -e "s{navigate\('#/'\)}{navigate('#/parent')}g" \
  src/screens/grade.ts src/screens/print-sheet.ts src/screens/report.ts
```

주의: `report.ts:253`은 백업 복구 성공 후의 이동이다. 복구를 실행한 사람이 부모이므로 이것도 `#/parent`가 맞다.

- [ ] **Step 3: 아이 소속 화면이 안 바뀌었는지 확인한다**

Run:

```bash
grep -c "navigate('#/parent')" src/screens/grade.ts src/screens/print-sheet.ts src/screens/report.ts
grep -n "navigate('#/')" src/screens/sprint.ts src/screens/map.ts src/screens/ebs.ts
```

Expected: 첫 명령이 `2 / 2 / 3`. 둘째 명령은 `sprint.ts` 3줄(그중 105행은 주석) · `map.ts` 2줄 · `ebs.ts` 1줄이 **그대로** 남아 있어야 한다. 아이 소속 화면이 `#/parent`로 바뀌었다면 되돌릴 것.

- [ ] **Step 4: 버튼 문구를 소속에 맞춘다**

세 부모 화면의 버튼 문구 `← 홈`은 이제 부모 홈을 가리키므로 그대로 두어도 거짓말은 아니다. **문구는 바꾸지 않는다** — 이 태스크의 범위를 목적지 변경으로 한정한다.

- [ ] **Step 5: 빌드와 회귀를 확인한다**

Run:

```bash
export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH"
npm test 2>&1 | tail -3 && npm run build 2>&1 | tail -2
```

Expected: `Tests  258 passed (258)`, 빌드 성공.

- [ ] **Step 6: 브라우저로 왕복을 확인한다**

`npm run dev` 후 아래를 순서대로 눌러 본다.

| 경로                            | 기대                                        |
| ------------------------------- | ------------------------------------------- |
| `#/parent` → 문제지 인쇄 → ← 홈 | `#/parent`로 돌아온다                       |
| `#/parent` → 채점하기 → ← 홈    | `#/parent`로 돌아온다                       |
| `#/parent` → 주간 리포트 → ← 홈 | `#/parent`로 돌아온다                       |
| `#/` → 구구단 스프린트 → ← 홈   | `#/`(아이 홈)로 돌아온다                    |
| `#/` → 구구단 지도 → ← 홈       | `#/`로 돌아온다                             |
| `#/` → EBS 강의 → ← 홈          | `#/`로 돌아온다                             |
| `#/parent` → 구구단 지도 → ← 홈 | `#/`로 떨어진다 (**의도된 마찰** — 설계 §5) |

- [ ] **Step 7: 커밋**

```bash
export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH"
npm run format
git add src/screens/grade.ts src/screens/print-sheet.ts src/screens/report.ts
git commit -m "$(cat <<'EOF'
fix: 부모 화면의 "← 홈"을 부모 홈으로 되돌린다

홈이 둘로 갈리면서 생긴 이음새. 그대로 두면 아빠가 채점을 마치고 홈을 눌러도
아이 화면으로 떨어져 부모 흐름이 매번 끊긴다.

규칙은 "화면은 자기 소속 홈으로 돌아간다"이다. 인쇄·채점·리포트 7곳을
#/parent로 바꾸고, 아이 소속(스프린트·지도·EBS 5곳)은 이미 #/로 가므로
건드리지 않는다. report.ts의 백업 복구 성공 후 이동도 부모 몫이라 함께 바꿨다.

부모 홈에서 연 지도·EBS는 나올 때 아이 홈으로 떨어진다 — 소속이 아이이기
때문이다. 없애려면 "어디서 왔는지" 상태를 되살려야 해서 받아들인 마찰이다
(설계 §5).

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: 문서를 실제와 맞춘다

코드가 바뀌었는데 문서가 옛 홈을 설명하고 있으면, 다음 세션이 "문서에 맞추겠다"며 되돌릴 위험이 있다.

**Files:**

- Modify: `docs/superpowers/specs/2026-08-02-haruchi-design.md` (§7 홈)
- Modify: `docs/superpowers/HANDOFF.md`

**Interfaces:**

- Consumes: 태스크 1~4의 결과
- Produces: 없음

- [ ] **Step 1: 기본 설계 §7의 홈 절을 새 스펙으로 넘긴다**

`docs/superpowers/specs/2026-08-02-haruchi-design.md`에서 `### 홈` 아래 ASCII 그림과 설명(그림 블록 + "위에서부터 순서대로…" 문단)을 아래로 교체한다:

```markdown
### 홈

> **2026-08-04: 홈이 역할별로 둘로 갈렸다.** 아래 그림은 갈리기 전의 모습이며, 버튼 옆 역할 표시(아빠/딸)가 분리의 근거가 됐다. **현재 구조는 `2026-08-04-role-based-ui-design.md`가 정본이다** — 아이 홈(`#/`)과 부모 홈(`#/parent`), 그리고 "화면은 자기 소속 홈으로 돌아간다" 규칙이 거기 있다. 이 절을 근거로 홈을 하나로 되돌리지 말 것.
```

(그림 블록 자체는 설계 시점 기록으로 남긴다 — DAN_ORDER 철회를 기록한 방식과 같다.)

- [ ] **Step 2: HANDOFF에 역할 분리를 기록한다**

`docs/superpowers/HANDOFF.md`의 "Phase 4가 만든 것" 절 **뒤**에 새 절을 넣는다:

```markdown
## 역할 분리 (2026-08-04)

홈이 둘로 갈렸다. **아이 홈 `#/`**(🔥 · 스프린트 큰 카드 · 지도 · EBS)와 **부모 홈 `#/parent`**(✅ · 미채점 배너 · 인쇄 · 채점 · 리포트). 설계는 `specs/2026-08-04-role-based-ui-design.md`.

- **역할을 저장하지 않는다.** 지금 보고 있는 주소가 곧 역할이다. 덕분에 "아이 화면이 기본"이 규칙이 아니라 구조로 보장된다 — PWA `start_url`이 해시 없는 `/haruchi/`라 아이콘·새로고침·재시작이 전부 `#/`로 떨어진다. **역할을 `Settings`에 저장하는 코드를 새로 만들지 말 것**
- **화면은 자기 소속 홈으로 돌아간다.** 인쇄·채점·리포트는 `#/parent`, 스프린트·지도·EBS는 `#/`. 새 화면을 만들 때 "← 홈"의 목적지를 소속에 맞춰 정할 것
- **부모 홈에서 연 지도·EBS는 나올 때 아이 홈으로 떨어진다.** 소속이 아이이기 때문이며, 없애려면 "어디서 왔는지" 상태를 되살려야 해서 받아들인 마찰이다
- **분리는 실수를 막을 뿐 의도를 막지 못한다.** 잠금이 없으므로 주소(`#/grade`)를 알고 치면 정답이 보이는 화면이 열린다. 사용자가 PIN을 검토하고 기각한 결과다
- **아이 홈 색은 `kid.css`에만 있다**(`--kid-accent` 주황 · `--kid-done` 초록). `app.css`에 아이용 색을 넣지 말 것 — 파일 경계가 부모 화면·인쇄물 톤 오염을 막는 유일한 장치다
- `pendingGradeDate`가 `home.ts`에서 `engine/report.ts`로 이사했다(테스트 4개, 변이 검증 완료)

**사람이 확인할 것** — 화면 테스트가 없어 코드로는 확인되지 않는다.

- 두 홈의 버튼이 각각 맞는 화면으로 가는지
- 여섯 화면의 "← 홈"이 소속대로 돌아오는지
- 아이패드 실물에서 주황·초록 대비가 충분한지(색값은 출발점이지 확정이 아니다)
```

- [ ] **Step 3: HANDOFF의 낡아진 서술을 고친다**

같은 문서에서 `home.ts`를 현재형으로 가리키는 두 줄을 고친다.

- Phase 2 절의 "**스프린트만 한 날은 `sheet: []`인 `Day`를 만든다.**" 항목: `` `home.ts`의 `pendingGradeDate` `` → `` `engine/report.ts`의 `pendingGradeDate` ``
- "미해결 항목" 절의 Phase 3 리뷰 항목에 나오는 `홈 버튼 3-상태(`home.ts`)` → `홈 버튼 3-상태(`home-child.ts`)`

Run(수정 후 확인):

```bash
grep -n "home\.ts" docs/superpowers/HANDOFF.md
```

Expected: 남은 `home.ts` 언급이 없거나, 있다면 전부 "옛 파일"임이 문맥에서 분명한 과거형 서술이어야 한다.

- [ ] **Step 4: 포맷과 커밋**

```bash
export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH"
npm run format
npx prettier --check . 2>&1 | tail -1
git add docs/
git commit -m "$(cat <<'EOF'
docs: 역할 분리를 기본 설계와 인수인계에 반영한다

코드가 바뀌었는데 문서가 옛 홈을 설명하고 있으면 다음 세션이 "문서에
맞추겠다"며 되돌릴 위험이 있다.

- 기본 설계 §7의 홈 그림은 설계 시점 기록으로 남기되, 현재 구조의 정본이
  2026-08-04-role-based-ui-design.md임을 머리에 달았다("이 절을 근거로 홈을
  하나로 되돌리지 말 것")
- HANDOFF에 역할 분리 절 추가: 역할을 저장하지 않는다는 원칙, "화면은 자기
  소속 홈으로 돌아간다" 규칙, 부모 홈→지도·EBS의 의도된 마찰, 잠금이 없어
  실수만 막는다는 한계, kid.css 경계, 사람이 확인할 항목 셋
- home.ts를 현재형으로 가리키던 두 줄을 새 파일 이름으로 정정

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## 완료 조건

전부 끝난 뒤 아래가 모두 참이어야 한다.

- [ ] `npm test` — 258개 통과(기존 254 + 신규 4)
- [ ] `npm run build` — `tsc --noEmit` 포함 성공
- [ ] `npx prettier --check .` — 통과
- [ ] `src/screens/home.ts`가 없고, 어디에서도 참조되지 않는다
- [ ] `#/`가 아이 홈, `#/parent`가 부모 홈을 띄운다
- [ ] 아이 홈에 인쇄·채점·리포트 버튼이 없다
- [ ] 부모 화면 셋의 "← 홈"이 `#/parent`로, 아이 화면 셋은 `#/`로 돌아온다
- [ ] `git status`가 깨끗하다
