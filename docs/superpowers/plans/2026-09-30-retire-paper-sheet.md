# 종이 문제지·채점 은퇴 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 문제지 생성·인쇄·채점 화면과 그 전용 엔진을 걷어내고, 과거 `sheet`·`grades` 데이터는
스키마·백업·동기화 그대로 보존한다.

**Architecture:** 순수 삭제다. 새 로직이 없다. 소비자(화면)부터 끊고 → 엔진을 지우고 →
CSS·주석 잔재를 치우고 → 문서를 고친다. 각 태스크 끝에서 `build`·`test`가 초록이므로
태스크마다 로컬 커밋하고, 마지막에 한 번 push한다(main 직접 — 모든 커밋이 단독 배포 가능).

**Tech Stack:** 바닐라 TS, Vite, Vitest, IndexedDB, Supabase REST.

**Spec:** `docs/superpowers/specs/2026-09-30-retire-paper-sheet-design.md` — 실행자는 스펙과
이 계획을 둘 다 읽는다. 줄 번호는 `~`가 붙은 근사치다(앞 태스크의 삭제로 밀린다) — 항상
인용된 문자열로 찾는다.

## Global Constraints

- 모든 npm 명령 전: `export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH"`
- `git add <명시 경로>`만. `git add .` 금지. `git add -A`로 삭제를 담지 말고 `git rm`을 쓴다
- `types.ts`·`backup.ts`·`merge.ts`·`db.ts`의 **동작**·`sync.ts`의 **동작**·Supabase 스키마는
  바꾸지 않는다. 타입은 하나도 지우지 않는다(스펙 §5)
- 예외 하나: `sync.ts`의 오류 라벨 문자열 `'sheet 다시 만들기'` → `'sheet 덮어쓰기(격리 유지)'`
- 격리 배너 `graded` 문구 「다른 기기가 이미 채점까지 마쳤어요」는 유지
- UI 문구는 `-어요` 체. 새 문구는 이 계획에 적힌 것만
- 커밋 메시지 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- docs 커밋 전 `npm run format`

## Review Focus

1. **옛 해시 북마크** — `#/print`, `#/grade`, `#/grade/2026-09-01`로 진입하면 에러 없이 아이 홈이
   떠야 한다(아이 기기 차단·PIN 게이트 어느 쪽에도 걸리지 않는다). Task 1 Step 6에서 확인
2. **격리된 날이 남아 있는 기기** — 부모 홈 알림에 격리 배너가 그대로 뜨고 「이 기기 것」·
   「다른 기기 것」이 동작해야 한다. `rewrite` 경로는 건드리지 않는다. Task 1 Step 6
3. **과거 종이 기록이 든 백업 가져오기** — `validateBackup`이 여전히 통과해야 한다.
   `backup.test.ts`가 그대로 초록인지로 확인(Task 2 Step 5)
4. **일요일 리포트 인쇄** — `print.css`의 `@page`·`.overlay` 숨김이 남아야 한다. Task 3 Step 3
5. **알림 0개인 부모 홈** — 「오늘」 칸이 빠진 뒤 헤더 바로 밑에 리포트 버튼이 오는 레이아웃이
   깨지지 않아야 한다. Task 1 Step 6

---

### Task 1: 화면·라우트에서 종이 끊기

**Files:**

- Delete: `src/screens/print-sheet.ts`, `src/screens/grade.ts`
- Modify: `src/main.ts`, `src/screens/home-parent.ts`, `src/screens/report.ts`,
  `src/screens/manage.ts`, `src/screens/ebs.ts`

**Interfaces:**

- Consumes: 없음
- Produces: 화면 어디에서도 `engine/compose`·`derive`·`strategy`·`completedCount`·
  `pendingGradeDate`·`ungradedSheetCount`·`ebsBadge`를 import하지 않는 상태(Task 2의 전제)

- [ ] **Step 1: 두 화면 삭제**

```bash
git rm src/screens/print-sheet.ts src/screens/grade.ts
```

- [ ] **Step 2: `src/main.ts`**

1. `const PARENT_HASHES = [...]` → `['#/parent', '#/report', '#/manage']`
2. `const GATED_HASHES = [...]` → `['#/report', '#/manage']`
3. GATED_HASHES 위 주석을 다음으로 교체:

```ts
/**
 * PIN 게이트 대상(2B 스펙 §1·§7 + 기기 상한 설계 §3).
 * #/manage는 파괴적 작업(모든 기록 지우기·가져오기·되돌리기)과 기기 해제,
 * #/report는 **집계(성적) 노출 방지 + 관리 화면 진입점**이다(사용자 결정: 집계도
 * 아이에게 안 보이는 것이 맞다). #/parent는 사용자 결정으로 제외.
 * 게이트가 여기(라우터) 한 곳에 사는 이유: 화면마다 두는 방식은 소속 불변식이
 * 사람 규율에 기대다 실제로 샌 전례가 있다(옛 채점 화면의 삼항연산자 속 navigate —
 * HANDOFF 「역할 분리」).
 */
```

4. `PARENT_WAIT_MS` 주석의 둘째 줄(`안전이 걸린 문제지 생성은 print-sheet.ts가…`) 삭제 →
   `/** 부모 화면이 렌더 전에 기다리는 시간. 안전장치가 아니라 표시용이다(설계 §2). */`
5. 깨어남 재게이트 블록(`// 떠 있는 화면도 다시 게이트한다`): 주석의 `#/grade를 띄운 채
내려놓으면 정답이 렌더된 채 그대로이고` → `#/report를 띄운 채 내려놓으면 집계가 렌더된 채
그대로이고`, `아무것도 안 눌러도 정답이 보인다` → `아무것도 안 눌러도 성적이 보인다`.
   `// 채점 도중은 건너뛴다…` 주석 2줄과 `if (hash.startsWith('#/grade')) { … isGrading … }`
   블록 삭제. 블록 뒤 주석의 `getDeviceState()·isGrading() 쪽 import가` → `getDeviceState()가`
6. `route()` 안: 게이트 실패 주석의 `(#/grade 게이트 중 #/report 스와이프)` →
   `(#/report 게이트 중 #/manage 스와이프)`, `renderGrade가 그대로 돌아 정답 전부가` →
   `게이트 화면이 그대로 렌더된다`로 문장을 맞춘다. `if (hash.startsWith('#/print')) {…}`
   분기와 `else if (hash.startsWith('#/grade')) {…}` 분기 삭제(다음 분기 `#/sprint`가 첫 `if`가 됨)
7. `onPullApplied` 위 주석: `부모 화면(정답이 다 보이는 채점 화면)까지` → `부모 화면까지`.
   「예외는 미커밋 입력을 쥔 화면 둘이다…」 단락 전체를 다음으로 교체:

```ts
 * 예외는 **미커밋 입력을 쥔 화면** 하나, 스프린트다 — 진행 중 세션의 반응시간이 메모리에만
 * 있어 다시 그리면 통째로 사라진다.
```

본문의 `if (hash.startsWith('#/grade')) { … }` 블록 삭제

- [ ] **Step 3: `src/screens/home-parent.ts`**

1. import 정리: `THINKING_ITEMS_PER_DAY`(compose), `completedCount, pendingGradeDate`(report),
   `deriveVerticalCount`(derive) 줄 삭제
2. `noticeRow` 주석: `(격리 N개 + 미채점 + 점검 안내 + 재기준화 + 거부된 행)` →
   `(격리 N개 + 점검 안내 + 램프 + 재기준화 + 거부된 행)`, `매일 하는 인쇄·채점이 화면 밖으로
밀린다 — 재구성 전에 실제로 그랬다` → `리포트 진입이 화면 밖으로 밀린다`
3. `quarantineHtml`: `어느 것으로 채점할지 골라 주세요.` → `어느 기록을 남길지 골라 주세요.`
   (graded 문구는 유지). `fail(e, '이 기기 종이로 맞추지 못했어요.')`은 유지
4. `renderParentHome` 문서 주석을 교체:

```ts
/**
 * 부모 홈(설계 2026-08-04-role-based-ui §4). 알림·리포트·관리 진입이 여기 있다.
 * 종이 문제지·채점은 2026-09-30 은퇴했다(specs/2026-09-30-retire-paper-sheet-design.md).
 */
```

5. `const verticalCount…`부터 `stepHtml` 정의 끝(`</button>\``)까지 삭제: `verticalCount`,
`todayDay`, `printed`, `graded`, `pending`, `sheetCounts`와 주석, 「오늘의 두 단계」 주석,
`printStep`, `gradeStep`, `sheetLine`, `stepHtml`. **`checkupDate`·`wish`·`genie`와 그
주석은 남긴다.** (`todayDay`가 다른 곳에서 쓰이는지 grep — 쓰이지 않아야 한다)
6. `noticeCount`: `(pending ? 1 : 0) +` 줄 삭제
7. 헤더 메타: `${formatDate(today)} · ✅ ${completedCount(days)}일 완료 · 🔥 ${sprintStreak(days, today)}일 연속`
   → `${formatDate(today)} · 🔥 ${sprintStreak(days, today)}일 연속`
8. `<h2 class="psec">오늘</h2>`와 `<div class="today">…</div>` 삭제
9. 알림 안의 `${ pending ? noticeRow(…'채점이 안 됐어요'…) : '' }` 블록 삭제
10. 리포트 버튼 `<small>주간·월간 — 일요일 채점 뒤엔 자동으로 열려요</small>` →
    `<small>주간·월간</small>`
11. 리스너: `#print`, `#grade`(if printed 포함), `#pending` 세 개 삭제. `#pending` 위 주석
    3줄 중 `// #/report는 PIN 게이트 뒤지만…` 한 줄은 `#checkup-notice` 앞에 남긴다
12. 파일에 남은 `표식은 한 날짜에 여러 개 쌓인다(인쇄 + 스프린트 + 채점이 각각 하나)` 주석은
    과거 데이터 설명으로 참이므로 둔다

- [ ] **Step 4: `src/screens/report.ts`(화면)**

1. `import { STRATEGY_CATALOG, STRATEGY_NAMES } from '../engine/strategy'` 삭제
2. `const TAG_LABELS … = { … }` 전체 삭제
3. `shareText`: `` `🔥 ${w.streak}일 연속 · ✅ ${w.completed}일 완료`, `` → `` `🔥 ${w.streak}일 연속`, ``.
   `배운 방법` 줄과 그 위 주석 2줄 삭제
4. `weeklyHtml`: `sampled`·`unsampled`·`typeRows` 계산과 주석 삭제. 스탯에서 `✅ 완료`·
   `배운 방법` 두 줄 삭제. `유형별 정답률` 블록과 `아직 표본이 모자란 유형` 줄 삭제
5. 이 과정에서 안 쓰이게 된 헬퍼(`trow` 등)는 grep해 다른 사용처가 없으면 삭제

- [ ] **Step 5: `src/screens/manage.ts`·`src/screens/ebs.ts`**

manage: `ungradedSheetCount` import와 `const ungraded = …` 삭제. 초기화 확인문에서 `ungraded`를
쓰는 줄(미채점 경고)을 삭제 — 확인문의 나머지 줄(지울 일수·백업)은 유지.

ebs: `TypeState` 타입 import, `deriveTypes` import, `ebsBadge` import 삭제. `topicHtml`의
`types` 매개변수 삭제, `flag`를
`const flag = done ? ' <span class="ebs-flag">🎉 다 뗐어요!</span>' : ''`로. `renderEbs`의
`const types = deriveTypes(days)` 삭제, `topicHtml(t, facts, types)` → `topicHtml(t, facts)`.

- [ ] **Step 6: 검증**

```bash
npm run build && npm test
grep -rn "#/print\|#/grade" src           # 0건
```

dev 서버(`npm run dev`) → `http://localhost:5173/haruchi/#/parent`: 헤더 `날짜 · 🔥 N일 연속`,
「오늘」 칸 없음, 리포트 버튼 부제 「주간·월간」. `#/report`: 스탯 두 개(🔥·반응시간),
유형 정답률 없음. `#/ebs`: 🎉 외 배지 없음. `#/manage` 열림. 주소창에 `#/print`,
`#/grade/2026-09-01` 입력 → 아이 홈. 격리 배너는 개발 origin에 격리 날짜가 없으면 눈으로
못 본다 — 코드 diff로 `wireQuarantine` 경로가 변하지 않았음을 확인하는 것으로 갈음.

- [ ] **Step 7: 커밋**

```bash
git add src/main.ts src/screens/home-parent.ts src/screens/report.ts src/screens/manage.ts src/screens/ebs.ts
git commit -m "feat: 종이 문제지·채점 화면 은퇴 — 인쇄·채점 라우트와 부모 홈 「오늘」 칸 제거"
```

---

### Task 2: 종이 엔진 삭제

**Files:**

- Delete: `src/engine/{compose,vertical,inverse,word,strategy,derive}.ts`와 각 `.test.ts`
- Modify: `src/engine/report.ts`, `report.test.ts`, `ebs.ts`, `ebs.test.ts`, `simulation.test.ts`

**Interfaces:**

- Consumes: Task 1의 "화면이 종이 엔진을 import하지 않음"
- Produces: `WeeklyReport` = `{ streak, fluentTotal, newlyFluent, weekMedianMs, prevWeekMedianMs, slowest, nextCheckup, exportOverdue }`

- [ ] **Step 1: 모듈 삭제**

```bash
git rm src/engine/{compose,vertical,inverse,word,strategy,derive}.ts src/engine/{compose,vertical,inverse,word,strategy,derive}.test.ts
```

- [ ] **Step 2: `engine/report.ts`**

`derive` import 줄 삭제. `completedCount`(주석 포함), `pendingGradeDate`, `ungradedSheetCount`
삭제. `WeeklyReport`에서 `completed`, `types`, `strategiesLearned`(주석 포함) 삭제.
`weeklyReport` 본문에서 `types`/`typeRows`/`strategyStates`/`strategiesLearned`/`strategyRows`
계산과 주석 삭제, 반환에서 `completed`·`types`·`strategiesLearned` 삭제.

`report.test.ts`: import에서 세 함수 삭제, `StrategyId`·`VerticalTag` 타입 import는 남은
사용처가 없으면 삭제. `it('유형별 정답률…')`, `it('배운 방법 수와…')`, `it('전략이 한 번도…')`,
`describe('completedCount')`, `describe('pendingGradeDate')`, `describe('ungradedSheetCount')`
삭제. `it('빈 로그에서…')`의 `w.completed`·`w.types` 단언 삭제. 삭제 후 안 쓰이는 헬퍼
(`paperDay` 등) 삭제.

- [ ] **Step 3: `engine/ebs.ts`**

`import { everMastered, openTags } from './derive'` 삭제. `TypeState`·`VerticalTag` 타입
import 삭제(남은 사용처 확인). `EbsTopic.tags` 필드와 주석, 두 주제의 `tags: [...]` 줄,
`activeVerticalTags`·`ebsBadge`와 주석 삭제. 파일 머리·`EBS_TOPICS` 주석에 배지 언급이 있으면
그 문장만 뺀다.

`ebs.test.ts`: `activeVerticalTags`·`ebsBadge`·`TypeState`·`VERTICAL_ORDER` import,
`it('tags는 VERTICAL_ORDER를…')`, `mastered` 헬퍼, `describe('문제지에 나와요 배지')` 삭제.

- [ ] **Step 4: `simulation.test.ts`**

`describe('다일 시뮬레이션')` 블록과 그것만 쓰던 헬퍼·상수(1–127행 중 종이용) 삭제. import는
`deriveFacts, composeSprint, requeueWrong, FACT_IDS`(facts), checkup, streak, dates,
`DEFAULT_SETTINGS`, 타입 중 **남은 코드가 실제로 쓰는 것만** 남긴다(`tsc`가 판정).
`MUL_STRATEGY_MIN_FLUENT`를 쓰는 테스트(~642)가 있으면 그 `it`을 삭제한다 — 전략 개방은
종이 기능이다. `describe('스프린트 다중일 시뮬레이션')`은 유지.

- [ ] **Step 5: 검증**

```bash
npm run build && npm test
grep -rnE "from '\./(compose|derive|strategy|word|vertical|inverse)'|engine/(compose|derive|strategy|word|vertical|inverse)'" src   # 0건
```

`backup.test.ts`·`merge.test.ts`·`facts.test.ts`·`checkup.test.ts`는 한 줄도 안 바꿨는데
초록이어야 한다(Review Focus 3).

- [ ] **Step 6: 커밋**

```bash
git add src/engine/report.ts src/engine/report.test.ts src/engine/ebs.ts src/engine/ebs.test.ts src/engine/simulation.test.ts
git commit -m "refactor: 종이 엔진 삭제 — compose·derive·strategy·word·vertical·inverse"
```

(`git rm`한 파일은 이미 스테이징돼 있다.)

---

### Task 3: CSS·주석 잔재

**Files:**

- Modify: `src/styles/print.css`, `src/styles/parent.css`, `src/styles/app.css`, `src/ui.ts`,
  `src/data/sync.ts`, `src/data/db.ts`, `src/engine/outbox.ts`, `src/screens/sprint.ts`,
  `src/screens/home-child.ts`, `src/engine/streak.ts`, `src/engine/merge.test.ts`, `src/data/db.test.ts`

- [ ] **Step 1: `ui.ts`**

`export const ITEM_MARKS = …`와 그 주석 삭제. "ITEM_MARKS와 같은 이유로/근거" 문구 세 곳(~531,
~647, ~738)을 `화면끼리 import하지 않으므로(형제) 공유물은 여기 산다`로 바꾼다. ~394
`(#/grade의 O/X 토글 …)` 예시는 `(스프린트 키패드 등)`으로.

- [ ] **Step 2: 호출자 서술 고치기(동작 불변)**

- `sync.ts` ~215: 「다시 만들기」 한 번이 → `rewrite 표식 하나가`
- `sync.ts` ~715·719·725: 「다시 만들기」의 인가된 경로 → `격리 배너 「이 기기 것」의 인가된
경로`. `(print-sheet는 …)` 괄호 문장 삭제
- `sync.ts` ~753·802: 「다시 만들기」 → 「이 기기 것」
- `sync.ts` ~810: 「이 기기 종이 유지」 → 「이 기기 것」
- `sync.ts` ~815: `failed('sheet 다시 만들기', res)` → `failed('sheet 덮어쓰기(격리 유지)', res)`
- `db.ts` ~226, `outbox.ts` ~11: `rewrite`의 호출자 서술을 「이 기기 것」(격리 배너)으로
- `sprint.ts` ~53·~403, `merge.test.ts` ~638, `db.test.ts` ~804: `grade.ts`/「다시 만들기」
  언급을 `옛 채점 화면`/「이 기기 것」으로 과거형 또는 현재 호출자로 고쳐 쓴다
- `home-child.ts` ~15 주석: `🔥만 두고 ✅ 완료일수는 부모 홈으로 보낸다…` 문장 삭제, ~24
  `sprintStreak(streak.ts)·completedCount(report.ts)와` → `sprintStreak(streak.ts)과`
- `streak.ts` ~20-22: `종이까지 포함한 정직한 숫자는 홈 화면의 ✅ N일 완료가 따로 보여준다.` 삭제

- [ ] **Step 3: CSS**

- `print.css`: `.sheet*`, `.v*`(vgrid·vprob·vnum·vcalc·vcarry·vline·vrule·vans), `.inv*`,
  `.strat*`, `.word*`, `.sheet + .sheet`, `body:has(.sheet)`, 문제지용 `width<480` 블록, 120–131
  주석 블록 삭제. **`@page`, 인쇄용 `body`/`#app`, `.overlay` 숨김은 남긴다.** 파일과
  `index.html` 링크 유지
- `parent.css`: `.today`, `.todo*` 규칙 삭제
- `app.css`: `.grade-row`, `.mark*`, `.moods`, `.mood*`, `.ebs-active` 삭제. `.device-row` 주석이
  `.grade-row`를 골격 근거로 들면 그 문장을 규칙 자체 설명으로 바꾼다
- 삭제 전 각 선택자를 `grep -rn "<class>" src index.html`로 세어 TS에 사용처가 0인지 확인

- [ ] **Step 4: 검증**

```bash
npm run build && npm test && npx prettier --check .
grep -rn "ITEM_MARKS\|print-sheet\|grade\.ts\|다시 만들기" src   # 0건
```

dev 서버 `#/report`에서 브라우저 인쇄 미리보기 → 리포트가 여전히 한 장으로 나오고 오버레이가
숨는다(Review Focus 4). 부모 홈·관리·EBS 레이아웃 재확인.

- [ ] **Step 5: 커밋**

```bash
git add src/styles/print.css src/styles/parent.css src/styles/app.css src/ui.ts src/data/sync.ts src/data/db.ts src/engine/outbox.ts src/screens/sprint.ts src/screens/home-child.ts src/engine/streak.ts src/engine/merge.test.ts src/data/db.test.ts
git commit -m "chore: 종이 은퇴 잔재 — 죽은 CSS·ITEM_MARKS·호출자 주석 정리"
```

---

### Task 4: 문서

**Files:** `docs/PRD.md`, `CLAUDE.md`, `docs/design/ux-principles.md`,
`docs/semester2-routine.md`, `docs/superpowers/HANDOFF.md`

- [ ] **Step 1: 스펙 §6의 목록을 그대로 적용한다.** 요지:
  - PRD: §1 루틴 문장(인쇄·채점 → 스프린트), §2 범위에서 「종이 문제지·채점」 제거·비범위에
    `종이 문제지·채점(2026-09-30 은퇴 — 기록은 보존)` 추가, §3 표·근거 문장, §4 제목과 종이
    항목, §5 빈 sheet 문장, §6 PIN 대상 `#/report`·`#/manage`, §7 인쇄 정책 삭제(뒤 절 번호
    당김), §9 색인에서 문제지 조립·유형 개방·전략 카탈로그·문장제 등장인물·문항 번호표 행 삭제
  - CLAUDE.md: 스펙 §6 CLAUDE.md 항목 전부
  - ux-principles: 머리에 `> 2026-09-30 종이 문제지·채점 은퇴. 아래 종이·채점 사례는 원칙의
근거 기록으로 남긴다 — 현재 화면에는 없다.` 추가, 첫 원칙 「종이가 본체, 화면은 보조」를
    `**화면이 본체.** 측정(스프린트)과 거울(지도·리포트)을 맡는다. 종이는 2026-09-30 은퇴했다.`로
  - semester2-routine: 표의 「종이(12분)」 열 값을 `—`로, 월~금 행의 「문제지 14문항」 제거
  - HANDOFF: 맨 위 현재 상태에 은퇴 항목 한 단락(무엇을 지웠나·무엇을 보존했나·스펙 경로)
- [ ] **Step 2:** `npm run format && npx prettier --check . && npm test && npm run build`
- [ ] **Step 3:** `grep -n "#/print\|#/grade\|ITEM_MARKS\|STRATEGY_CATALOG\|WORD_NAMES" CLAUDE.md docs/PRD.md`
      → 은퇴를 기록하는 문장 외 0건
- [ ] **Step 4: 커밋**

```bash
git add docs/PRD.md CLAUDE.md docs/design/ux-principles.md docs/semester2-routine.md docs/superpowers/HANDOFF.md
git commit -m "docs: 종이 문제지·채점 은퇴 — PRD·CLAUDE.md·UX 원칙·루틴·HANDOFF"
```

---

### Task 5: 배포

- [ ] `git log --oneline origin/main..` 로 4(+스펙 1)커밋 확인, `git push`, `gh run watch`로 초록 확인
- [ ] 배포본 부모 홈을 **열어보기만** 한다(스프린트 금지 — `docs/screen-preview.md`)
