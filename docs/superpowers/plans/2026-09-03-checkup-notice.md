# 부모 홈 점검 결과 배너 — 구현계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 부모 홈(`#/parent`)에 "최근 점검이 있었다"를 점검일부터 7일간 알리는 정보 톤
배너를 넣어, 구구단 지도의 정복 수가 점검일에 여러 개 줄어드는 이유를 아빠가 제때 알게 한다.

**Architecture:** 판정은 새로 만들지 않는다. "실제로 점검을 한 날"의 술어가 지금
`checkup.ts`와 `report.ts`에 두 벌로 흩어져 있으므로 `checkupDays()` 하나로 모으고, 그 위에
날짜만 보는 `checkupNoticeDate(days, today)`를 얹는다. 화면은 기존 미채점 배너와 같은 구조를
톤만 바꿔 쓴다. 저장하는 값은 없다(파생 비배선 원칙 그대로).

**Tech Stack:** TypeScript(프레임워크 없음, 바닐라 DOM), Vitest, SEED Design CSS 레시피,
Vite. 실행 코드 의존성 0개 — 새 패키지를 추가하지 않는다.

**Spec:** `docs/superpowers/specs/2026-09-02-checkup-notice-design.md`
(적대적 리뷰 3라운드 반영 완료: R1 C1·I4·M6, R2 I1·M5, R3 I1·M3)

## Global Constraints

- **Node는 mise에만 있다.** 모든 npm 명령 앞에:
  `export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH"`
- **`git add`는 명시 경로만.** `git add .` 금지. 레포에 이 작업과 무관한 미추적
  `.idea/`가 있다 — 다른 세션 것으로 보고 손대지 않는다.
- **커밋 전에 `npm run format`(또는 대상 파일에 `npx prettier --write`)을 돌린다.**
  `.prettierignore`가 없어 CI의 `prettier --check .`가 마크다운까지 검사한다.
- **테스트 기준값(2026-09-03 실측): 482개 통과 / 22개 파일.** 이 계획이 8개를 더해
  **490개 / 22개 파일**이 되어야 한다(파일 수 불변 — 기존 `checkup.test.ts`에 붙는다).
- **아이 화면 파일을 건드리지 않는다**: `src/screens/home-child.ts`·`map.ts`·`sprint.ts`·
  `ebs.ts`·`genie.ts`. 최종 `git diff --stat`으로 확인한다(UX 원칙 2).
- **문구는 `-어요` 체**(`docs/reference/karrot-DESIGN.md`). 배너 문구는 정확히
  `{formatDate(날짜)} 점검 결과가 있어요 · 리포트 보기` — 숫자·식 id를 싣지 않는다.
- **색 값을 CSS에 베끼지 않는다.** SEED 레시피 클래스와 `var(--seed-*)` 토큰만 쓴다.
- **작업 경로: main 직접.** 세 커밋 각각이 단독 배포 가능하다(CLAUDE.md 「작업 경로」 ③).
  push는 곧 배포이므로 마지막에 `gh run watch`로 결과까지 본다.

---

### Task 1: 문서 선행 커밋 — 스펙과 「정복 규칙」 설명서

이 커밋에는 코드가 없다. 스펙과 규칙 설명서가 뒤 커밋들의 근거이므로 먼저 앉힌다.

**Files:**

- Commit (already written, uncommitted): `docs/superpowers/specs/2026-09-02-checkup-notice-design.md`
- Commit (already written, uncommitted): `docs/design/mastery-rules-plain.md`
- Commit (already modified, uncommitted): `docs/PRD.md` — §4 끝의 `mastery-rules-plain.md` 포인터 두 줄

**Interfaces:**

- Consumes: 없음
- Produces: 뒤 태스크가 인용하는 스펙 경로. 코드 인터페이스 없음.

- [ ] **Step 1: 세 파일이 이미 작업 트리에 있는지 확인**

```bash
cd /Users/iseongho/workspace/haruchi
git status --short docs/
```

Expected: `M docs/PRD.md`, `?? docs/design/mastery-rules-plain.md`,
`?? docs/superpowers/specs/2026-09-02-checkup-notice-design.md` 세 줄.
(`.idea/`가 함께 보이면 무시한다 — 이 작업의 것이 아니다.)

- [ ] **Step 2: 포맷 검사**

```bash
export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH"
npx prettier --check .
```

Expected: `All matched files use Prettier code style!`
실패하면 `npx prettier --write <그 파일>` 후 다시 확인.

- [ ] **Step 3: 커밋**

```bash
git add docs/superpowers/specs/2026-09-02-checkup-notice-design.md docs/design/mastery-rules-plain.md docs/PRD.md
git commit -m "$(cat <<'EOF'
docs: 정복 규칙 쉬운 말 설명서 + 부모 홈 점검 배너 스펙

첫 28일 점검(2026-09-02)에서 정복이 21→17로 줄어 버그로 오인된 일이 계기다.
백업을 deriveFacts로 재생해 결함이 없음을 확인했고, 진짜 공백은 "왜 줄었는지"를
제때 말해 주는 화면이 리포트 월간 절 하나뿐이라는 것이었다.

- docs/design/mastery-rules-plain.md: 정복 판정·해제·1→3→7→14 사다리·두 재확인
  경로(일반 25% due / 점검 28일 전수)를 사람 말로. 값의 주인은 여전히 코드라고 명시
- specs/2026-09-02-checkup-notice-design.md: 부모 홈 배너 설계. 적대적 리뷰 3라운드
  반영 — 배너에 숫자를 싣지 않는다(부모 홈은 PIN 밖이고 아이 홈에서 한 탭이다)
- PRD §4에 설명서 포인터 두 줄

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: 엔진 — `checkupDays` · `checkupNoticeDate` (TDD)

**Files:**

- Modify: `src/engine/checkup.ts` — `lastCheckupDate`(27-34행) 교체, 파일 끝나기 전
  `checkupDue`(51-55행) 뒤에 상수·새 함수 추가
- Modify: `src/engine/report.ts` — import(6행)와 `latestCheckupReport` 첫 줄(171행)
- Test: `src/engine/checkup.test.ts` — import(2행), 모듈 스코프 빌더(28행 뒤), 파일 끝에
  새 `describe`

**Interfaces:**

- Consumes: `shiftDay(key: string, n: number): string`(`./dates`, 이미 import돼 있다),
  `Day`(`../data/types`)
- Produces:
  - `export function checkupDays(days: Day[]): Day[]`
  - `export function lastCheckupDate(days: Day[]): string | null` (기존 비공개 함수의 export)
  - `export const CHECKUP_NOTICE_DAYS = 7`
  - `export function checkupNoticeDate(days: Day[], today: string): string | null`
    — Task 3의 `home-parent.ts`가 이것 하나만 쓴다

- [ ] **Step 1: 테스트 파일에 import와 모듈 스코프 빌더를 넣는다**

`src/engine/checkup.test.ts` 2행을 교체:

```ts
import {
  checkupDue,
  checkupNoticeDate,
  nextCheckupDate,
  composeCheckup,
  CHECKUP_MIN_FLUENT,
} from './checkup'
```

28행 `const FLUENT_MS = 2500` 바로 뒤(빈 줄 하나 두고)에 추가:

```ts
/**
 * 실제로 점검을 한 날. 시도 하나면 충분하다 — checkupDays는 개수만 본다.
 * 이름을 엔진의 checkupDays와 한 글자 차이로 두지 않는다(리뷰 R3 M-3).
 */
const doneCheckup = (date: string): Day => ({
  date,
  kind: 'checkup',
  sheet: [],
  sprint: [{ fact: '2×3', correct: true, ms: 800 }],
})
```

- [ ] **Step 2: 실패하는 테스트 8개를 파일 끝에 붙인다**

`src/engine/checkup.test.ts` 맨 끝(162행 `})` 뒤)에 추가:

```ts
describe('checkupNoticeDate', () => {
  it('점검 기록이 없으면 안내가 없다', () => {
    expect(checkupNoticeDate([], '2026-09-02')).toBeNull()
    // kind가 normal이면 스프린트가 있어도 점검이 아니다.
    expect(checkupNoticeDate([fluentDay('2026-08-29', TEN_FACTS)], '2026-09-02')).toBeNull()
  })

  it('점검 당일에 보인다', () => {
    expect(checkupNoticeDate([doneCheckup('2026-08-29')], '2026-08-29')).toBe('2026-08-29')
  })

  it('점검일 + 6일까지 보인다', () => {
    expect(checkupNoticeDate([doneCheckup('2026-08-29')], '2026-09-04')).toBe('2026-08-29')
  })

  it('점검일 + 7일에는 사라진다 — 경계', () => {
    expect(checkupNoticeDate([doneCheckup('2026-08-29')], '2026-09-05')).toBeNull()
  })

  it('미래 날짜 점검은 안내하지 않는다', () => {
    // 가져온 백업에 시계가 틀린 기기의 미래 날짜가 섞일 수 있다 —
    // validateBackup은 날짜 형식만 보고 범위는 보지 않는다.
    expect(checkupNoticeDate([doneCheckup('2026-09-10')], '2026-09-05')).toBeNull()
  })

  it('점검이 둘이면 최근 것을 기준으로 잰다', () => {
    const days = [doneCheckup('2026-08-29'), doneCheckup('2026-09-26')]
    expect(checkupNoticeDate(days, '2026-09-27')).toBe('2026-09-26')
  })

  it('최근 점검이 미래면 기간 안의 옛 점검도 찾지 않는다', () => {
    // 옛 점검(08-29)은 today(09-01) 기준 +3일이라 기간 안이지만, 이 함수는
    // 가장 최근 점검 하나만 본다(설계 §2-1).
    const days = [doneCheckup('2026-08-29'), doneCheckup('2026-09-26')]
    expect(checkupNoticeDate(days, '2026-09-01')).toBeNull()
  })

  it('sprint가 빈 checkup 날은 점검을 한 날이 아니다', () => {
    const days: Day[] = [{ date: '2026-09-01', kind: 'checkup', sheet: [], sprint: [] }]
    expect(checkupNoticeDate(days, '2026-09-01')).toBeNull()
  })
})
```

- [ ] **Step 3: 테스트가 실패하는지 확인**

```bash
export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH"
npx vitest run src/engine/checkup.test.ts
```

Expected: FAIL — `checkupNoticeDate is not a function` 또는 import 해석 실패
(`No matching export`). 8개 전부 빨강.

- [ ] **Step 4: `checkup.ts`의 `lastCheckupDate`를 `checkupDays` 위로 다시 세운다**

`src/engine/checkup.ts` 27-34행(현재 `function lastCheckupDate` 블록 전체)을 교체:

```ts
/**
 * 실제로 점검을 한 날들(날짜 오름차순 — getAllDays가 그렇게 돌려준다). sprint 없는
 * checkup 날은 점검을 실제로 하지 않은 것이라 제외한다.
 *
 * **이 술어의 주인은 여기다.** 점검 스케줄(lastCheckupDate), 월간 리포트
 * (report.ts의 latestCheckupReport), 부모 홈 배너(checkupNoticeDate)가 같은 정의를
 * 봐야 한다 — 사본을 두면 한쪽만 고쳐지는 날 세 화면이 서로 다른 날을 "최근 점검"이라
 * 부른다.
 */
export function checkupDays(days: Day[]): Day[] {
  return days.filter((d) => d.kind === 'checkup' && d.sprint !== undefined && d.sprint.length > 0)
}

/** 마지막으로 실제 점검을 한 날. 없으면 null. */
export function lastCheckupDate(days: Day[]): string | null {
  return checkupDays(days).at(-1)?.date ?? null
}
```

- [ ] **Step 5: `checkupNoticeDate`를 `checkupDue` 뒤에 추가**

`src/engine/checkup.ts`의 `checkupDue` 블록(`return next !== null && next <= today` 다음
`}`)과 그 아래 `composeCheckup` 주석 사이에 삽입:

```ts
/** 부모 홈 배너가 최근 점검을 안내하는 기간(점검일 포함). */
export const CHECKUP_NOTICE_DAYS = 7

/**
 * 부모 홈 배너에 적을 최근 점검일 — 점검일부터 CHECKUP_NOTICE_DAYS일 동안만.
 * 밖이면 null(설계 `specs/2026-09-02-checkup-notice-design.md` §2-1).
 *
 * **가장 최근 점검 하나만 본다**(lastCheckupDate). `date > today`(가져온 백업의 미래
 * 날짜 — validateBackup은 날짜 범위를 보지 않는다)면 null이고, 그때 기간 안의 옛 점검이
 * 있어도 찾지 않는다 — 미래 날짜 기록은 시계가 틀린 기기에서만 생기는 예외라 그 경우까지
 * 맞추는 분기를 두지 않는다.
 *
 * **fluentMs를 받지 않는다.** 배너는 날짜만 말하므로 파생(deriveFacts)이 필요 없다 —
 * 부모 홈 렌더에 파생 비용을 새로 들이지 않는다(부모 홈은 지금 deriveFacts를 한 번도
 * 부르지 않는다). 저장하지 않는다 — 날짜만으로 결정되므로 기기마다 같은 답이 나온다.
 */
export function checkupNoticeDate(days: Day[], today: string): string | null {
  const date = lastCheckupDate(days)
  if (date === null || date > today) return null
  if (shiftDay(date, CHECKUP_NOTICE_DAYS) <= today) return null
  return date
}
```

- [ ] **Step 6: 테스트가 통과하는지 확인**

```bash
export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH"
npx vitest run src/engine/checkup.test.ts
```

Expected: PASS — 이 파일의 테스트 전부 초록(기존 것 포함).

- [ ] **Step 7: `report.ts`가 같은 술어를 쓰게 한다**

`src/engine/report.ts` 6행:

```ts
import { checkupDays, nextCheckupDate } from './checkup'
```

171행(`latestCheckupReport` 첫 줄):

```ts
const checkups = checkupDays(days)
```

(그 아래 `checkups[checkups.length - 1]`·`checkups[checkups.length - 2]`는 그대로 둔다 —
`filter`가 순서를 보존하므로 동작이 같다.)

- [ ] **Step 8: 전체 테스트와 빌드**

```bash
export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH"
npm test && npm run build
```

Expected: `Tests  490 passed (490)`, `Test Files  22 passed (22)`, 빌드 성공.
490이 아니면 멈추고 원인을 보고한다(기존 테스트가 깨졌다는 뜻일 수 있다).

- [ ] **Step 9: 변이 검증 — 네 번 고치고 네 번 원복**

각 변이마다 `npx vitest run src/engine/checkup.test.ts`를 돌려 **지정된 테스트만**
빨개지는지 확인하고 반드시 원복한다.

| 변이                                                                   | 빨개져야 하는 것                                                                    |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `checkupNoticeDate`의 `<=`를 `<`로                                     | 「점검일 + 7일에는 사라진다」 하나                                                  |
| `CHECKUP_NOTICE_DAYS`를 `6`으로                                        | 「점검일 + 6일까지 보인다」 하나                                                    |
| `date > today` 검사 삭제                                               | 「미래 날짜 점검」 + 「최근 점검이 미래면」 둘                                      |
| `checkupDays`에서 `&& d.sprint.length > 0`만 삭제                      | 「sprint가 빈 checkup 날」 하나 — 아래 주의                                         |
| `checkupDays`에서 sprint 절 전체(`d.sprint !== undefined && ...`) 삭제 | 「sprint가 빈 checkup 날」 + 기존 「sprint가 없는 checkup 날은 기준점이 아니다」 둘 |

**주의(리뷰 R3 I-1):** 마지막 두 줄은 다른 변이다. 기존 「기준점이 아니다」 테스트의
픽스처는 `sprint` 키 **자체가 없어서** `!== undefined`에 걸러진다 — `.length > 0`만
지우면 그 테스트는 초록으로 남는 것이 정상이다. 두 변이가 `sprint: []`와 `sprint` 부재를
각각 잡는다.

- [ ] **Step 10: 포맷 후 커밋**

```bash
export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH"
npx prettier --write src/engine/checkup.ts src/engine/checkup.test.ts src/engine/report.ts
npx prettier --check . && npm test
git add src/engine/checkup.ts src/engine/checkup.test.ts src/engine/report.ts
git commit -m "$(cat <<'EOF'
feat(engine): checkupNoticeDate — 최근 점검일을 7일간 알린다

"실제로 점검을 한 날"의 술어가 checkup.ts의 비공개 lastCheckupDate와 report.ts의
latestCheckupReport 첫 줄 필터에 두 벌로 있었다. checkupDays() 하나로 모으고 그 위에
날짜만 보는 checkupNoticeDate(days, today)를 얹는다.

- fluentMs를 받지 않는다 — 배너는 날짜만 말하므로 부모 홈에 deriveFacts 비용을
  새로 들이지 않는다(부모 홈은 지금 파생을 한 번도 부르지 않는다)
- 미래 날짜 점검(시계 틀린 기기의 백업)은 null. 가장 최근 하나만 본다
- 테스트 8개 + 변이 검증 5종. sprint:[]와 sprint 부재는 서로 다른 변이가 잡는다

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: 화면 — 부모 홈 배너 + PRD·HANDOFF

이 레포는 DOM·화면 단위 테스트를 하지 않는다(설계 §12). 검증은 타입 검사(`npm run build`)와
사람의 실기기·dev 확인이다. 사용자에게 보이는 정책이 바뀌므로 PRD·HANDOFF를 **같은 커밋**에서
갱신한다(CLAUDE.md 「문서」).

**Files:**

- Modify: `src/screens/home-parent.ts` — import(12행 뒤), `pending` 계산 뒤(181행),
  배너 HTML(207행 블록 뒤), 배선(383-388행 뒤)
- Modify: `src/styles/app.css` — `.banner` 위 주석(301-303행)
- Modify: `docs/PRD.md` — §3 아래 정책 한 줄
- Modify: `docs/superpowers/HANDOFF.md` — 「지금 상태」 표의 테스트 행, 현재 상태 문단

**Interfaces:**

- Consumes: `checkupNoticeDate(days, today): string | null`(Task 2), 기존
  `formatDate(key: string): string`(`../ui` — 요일까지 붙여 "9월 2일 수요일"을 낸다),
  `navigate(hash: string): void`
- Produces: 없음(터미널 태스크)

- [ ] **Step 1: import 추가**

`src/screens/home-parent.ts`의 `} from '../data/sync'`(12행) 바로 다음 줄에:

```ts
import { checkupNoticeDate } from '../engine/checkup'
```

- [ ] **Step 2: 날짜 계산**

181행 `const pending = pendingGradeDate(days, today)` 바로 뒤에:

```ts
// 최근 점검 안내(설계 `specs/2026-09-02-checkup-notice-design.md`). 날짜만 받는다 —
// 유지·다시 연습 수는 PIN 뒤 리포트에만 둔다. 부모 홈은 PIN 밖이고 아이 홈의
// 「부모 →」 한 탭으로 열리므로, 여기에 숫자를 실으면 리포트를 게이트한 근거
// ("집계도 아이에게 안 보이는 것이 맞다", main.ts)를 게이트 밖으로 꺼내는 셈이 된다.
const checkupDate = checkupNoticeDate(days, today)
```

- [ ] **Step 3: 배너 HTML을 미채점 배너 바로 아래에 넣는다**

`id="pending"` 삼항이 끝나는 `}` 다음 줄, `<button class="step ${printed ...} id="print">`
앞에 삽입:

```ts
          ${
            checkupDate
              ? `<div class="banner seed-callout__root seed-callout__root--tone_informative" id="checkup-notice" role="button" tabindex="0"><span class="seed-callout__description seed-callout__description--tone_informative">${formatDate(checkupDate)} 점검 결과가 있어요 · 리포트 보기</span></div>`
              : ''
          }
```

톤이 `informative`인 이유: 이 배너는 행동을 요구하지 않는다. 경고 톤은 아빠가 할 일이
있는 것(미채점·격리)에만 쓴다 — 그래야 경고 하나만 알아보면 된다.

- [ ] **Step 4: 배선 — 클릭과 키보드**

`pendingBanner?.addEventListener('keydown', ...)` 블록이 닫히는 `})` 바로 뒤에:

```ts
// 미채점 배너와 같은 관례(role="button" + tabindex를 준 이상 키보드로도 눌려야 한다).
// 목적지 #/report는 PIN 게이트 뒤지만 기존 「리포트」 버튼과 같은 경로라
// 새 게이트 처리가 없다.
const checkupBanner = root.querySelector<HTMLDivElement>('#checkup-notice')
checkupBanner?.addEventListener('click', () => navigate('#/report'))
checkupBanner?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    navigate('#/report')
  }
})
```

- [ ] **Step 5: `.banner` 주석이 warning 전용으로 읽히지 않게 고친다**

`src/styles/app.css`의 `.banner` 바로 위 주석 세 줄을 교체:

```css
/* callout 톤 레시피가 배경·radius·여백을 준다(seed-callout__root--tone_*: 경고는
 * warning, 최근 점검 안내는 informative). 여기 남는 것은 이 앱에서만 정하는 간격과,
 * div라 callout이 못 주는 커서뿐이다 — recipe의 button/a 커서 규칙은 이 배너(div)엔
 * 안 걸린다. */
```

- [ ] **Step 6: 타입 검사와 테스트**

```bash
export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH"
npm run build && npm test
```

Expected: 빌드 성공, `Tests  490 passed (490)`.

- [ ] **Step 7: 아이 화면을 건드리지 않았는지 확인**

```bash
git diff --stat
```

Expected: `home-parent.ts`·`app.css`만(문서는 아직 안 고쳤다). `home-child.ts`·`map.ts`·
`sprint.ts`·`ebs.ts`·`genie.ts`가 목록에 있으면 원복한다(UX 원칙 2).

- [ ] **Step 8: PRD §3 아래에 정책 한 줄**

`docs/PRD.md`에서 §3 표 아래 "이에 더해 `#/grade`·`#/report`·`#/manage`는 **PIN 게이트**
뒤에 있다(§6)."로 시작하는 문단 끝에 이어 붙인다:

```markdown
점검 결과의 **숫자**(유지·다시 연습)는 그 게이트 뒤(리포트 월간 절)에만 있다 — 부모 홈은
점검일부터 7일간 "결과가 있다"고만 안내한다. 부모 홈이 PIN 밖이기 때문이다.
소유자: `src/engine/checkup.ts`의 `checkupNoticeDate`.
```

- [ ] **Step 9: HANDOFF 갱신 두 곳**

(1) 「지금 상태」 표의 테스트 행(13행) 맨 끝에 이어 적는다:

```
, 482 → 490(+8)이 `checkupNoticeDate`(부모 홈 점검 배너 — 파일 수는 22 유지)다
```

(2) 「지금 상태」 표 바로 뒤, `2026-08-26:`으로 시작하는 문단 **앞에** 한 문단 추가
(이 절은 최신이 위다):

```markdown
2026-09-03: 부모 홈에 최근 점검 안내 배너(스펙 `specs/2026-09-02-checkup-notice-design.md`).
첫 28일 점검(2026-09-02)이 정복을 21→17로 내렸고 그것이 버그로 오인됐다 — 백업을
`deriveFacts`로 재생해 결함이 없음을 확인했고(일반 스프린트는 세션당 fluent 식을 최대
8개만 다시 묻는데 점검은 전수라 하루에 여러 개가 내려간다), 진짜 공백은 그 사실을 말해
주는 화면이 리포트 월간 절 하나뿐이라는 것이었다. **원래 요청은 아이 지도에 한 줄이었지만
UX 원칙 2(아이 화면에 부정 신호 금지)에 걸려 부모 홈으로 옮겼고, 부모 홈이 PIN 밖이라
숫자도 뺐다** — 리포트를 게이트한 근거("집계도 아이에게 안 보이는 것이 맞다", `main.ts`)를
게이트 밖으로 꺼내지 않기 위해서다. 엔진 쪽 부수 효과로 "실제로 점검을 한 날" 술어의
사본 두 벌(`checkup.ts`의 비공개 `lastCheckupDate`, `report.ts`의 필터)이
`checkupDays()` 하나로 합쳐졌다. 적대적 리뷰 3라운드에서 나온 것 중 방향을 바꾼 둘:
① 배너에 "21개 중 17 유지"를 실으면 두 기기 병합 케이스에서 그 숫자가 거짓이 될 수
있었다(`tested`에 fluent가 아니던 식이 섞인다), ② 변이 검증 문장이 `sprint: []`와
`sprint` 키 부재를 한 변이로 뭉쳐, 주장한 "그 테스트만 빨개진다"가 실제로는 성립하지
않았다.
```

- [ ] **Step 10: 포맷·전체 검사 후 커밋**

```bash
export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH"
npm run format
npx prettier --check . && npm test && npm run build
git add src/screens/home-parent.ts src/styles/app.css docs/PRD.md docs/superpowers/HANDOFF.md
git commit -m "$(cat <<'EOF'
feat: 부모 홈에 최근 점검 안내 배너 — 정복이 왜 줄었는지 제때 말한다

첫 점검(2026-09-02)이 정복을 21→17로 내렸고 그것이 버그로 오인됐다. 설명하는 화면이
리포트 월간 절 하나뿐이라 아빠가 지도만 보고 놀랐다.

- 점검일부터 7일간 부모 홈에 정보 톤 배너, 탭하면 #/report(미채점 배너와 같은 관례)
- 숫자는 싣지 않는다 — 부모 홈은 PIN 밖이고 아이 홈에서 한 탭이다. 유지·다시 연습
  수는 게이트 뒤 리포트에만 둔다
- 아이 화면은 손대지 않았다(UX 원칙 2 — 아이에게 부정 신호 금지)
- app.css .banner 주석이 warning 전용으로 읽히던 것을 톤 무관으로

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 11: push = 배포. 결과까지 본다**

```bash
git push
gh run watch
```

Expected: `prettier --check` → `npm test` → `npm run build` → Pages 배포 전부 초록.

---

## 사람이 할 확인 (배포 후)

에이전트가 대신할 수 없는 것. 맥 Chrome은 미페어링 기기라 아이패드 실데이터가 없고,
서버는 RLS로 막혀 있다.

1. 아이패드에서 부모 홈을 연다 — 「9월 2일 수요일 점검 결과가 있어요 · 리포트 보기」
   배너가 미채점 배너 아래에 파란 톤으로 보이는가. (9월 8일까지 보이고 9월 9일에 사라진다.)
2. 탭 → PIN 키패드 → 리포트가 열리는가. 리포트에서 월간 절까지 한 번 스크롤하면
   「점검한 21개 중 유지 17 · 다시 연습 4」가 있는가.
3. 아이 홈 → 지도에 변화가 없는가(배너가 새어 나오지 않았는가).

## 후속으로 남긴 것

- 지니 보상 조건 재설계 — 브레인스토밍 중 사용자가 보류(2026-09-03). "완벽한 정복"이
  영구 상태가 아닌데 램프는 현재 72칸 전부를 요구한다. 제시한 세 안(수집형·단별 축하·
  임계 완화)은 전부 거절됐으므로, 재개할 때 어느 점이 마음에 안 들었는지부터 묻는다.
- `div role="button"` 배너의 pressed 피드백 없음 — SEED 콜아웃의 hover/active는
  `button`·`a`에만 걸린다. 미채점 배너와 같은 상태라 두 배너를 함께 고칠 일이다.
