# 부모 홈 점검 결과 배너 — 설계

2026-09-02. 첫 28일 점검이 돌아 구구단 지도의 정복이 21→17로 내려갔고, 아빠가 이를
버그로 오인했다(백업을 `deriveFacts`로 재생해 확인 — 결함 없음). 이 스펙은 "왜
줄었는지"가 화면 어디에도 제때 보이지 않는 공백을 메운다. 적대적 리뷰 3라운드 반영
(R1: Critical 1 · Important 4 · Minor 6, R2: Important 1 · Minor 5, R3: Important 1 · Minor 3 —
아래 각 절에 표시).

## 0. 문제

- 점검(`src/engine/checkup.ts`)은 fluent 식 전부를 한 번씩 다시 묻고, 틀리거나 느린
  식은 `deriveFacts`가 스스로 learning으로 내린다(강등 코드 없음 — 스펙
  `2026-08-03-phase3-real-use-design.md` §5). 그래서 점검일에는 정복 수가 한 번에 여러 개
  줄 수 있다 — 일반 스프린트는 기본 설정(`sprintCount` 30, `SHARE_FLUENT` 0.25)에서
  세션당 fluent 식을 최대 8개만 다시 묻는다(리뷰 M1).
- 그 사실을 설명하는 화면은 리포트(`#/report`)의 「월간 — 점검」 절 하나뿐이다. 아빠는
  아이 홈의 「구구단 지도」 버튼으로 지도를 보고 놀랐고, 리포트까지 내려가지 않았다.
- 아이 화면에 설명을 두는 것은 `docs/design/ux-principles.md` 원칙 2(아이 화면에 부정
  신호 금지)에 걸린다. "4개가 다시 연습으로"는 8살에게 "내가 못했구나"다. 원칙 2와
  3(화면은 사실만)이 충돌하면 **화면을 나눠 푼다**가 이 레포의 정해진 답이다(🔥는
  아이 홈, ✅는 부모 홈).

## 1. 결정 (사용자, 2026-09-02, `/grill-me` 2회)

| 가지      | 결정                                                                               |
| --------- | ---------------------------------------------------------------------------------- |
| 위치      | **부모 홈(`#/parent`)에만.** 아이 화면은 손대지 않는다                             |
| 노출 기간 | **점검일부터 7일**(점검일 포함, 점검일+6까지). 저장 상태 없음                      |
| 탭 동작   | **리포트(`#/report`)로 이동** — 미채점 배너와 같은 관례                            |
| 톤        | **중립(정보).** 경고 배너는 행동이 필요한 것(미채점·격리)만                        |
| 숫자      | **배너에 싣지 않는다.** 유지·다시 연습 수는 PIN 뒤 리포트에만(리뷰 I1 — 아래 근거) |

**숫자를 싣지 않는 근거(리뷰 I1).** 부모 홈은 PIN 밖이고 아이 홈의 「부모 →」 한 탭으로
열린다(`home-child.ts`, `main.ts`의 `GATED_HASHES`는 `#/parent`를 제외). 리포트를 PIN 뒤에
둔 이유가 "집계도 아이에게 안 보이는 것이 맞다"(사용자 결정, `main.ts` 주석)인데, 배너에
"다시 연습 4"를 실으면 그 집계의 핵심 한 줄을 PIN 밖에 7일간 두게 된다. 그래서 배너는
**점검이 있었다는 사실과 날짜만** 말한다 — "점검"이라는 단어 하나로 "지도 숫자가 왜
줄었나"는 설명되고, 자세한 숫자는 한 탭 + PIN 뒤에 있다. 이 결정으로 리뷰 C1(탈락 0
문구가 병합 케이스에서 거짓이 되는 문제)과 M3(현재형 문구와 스냅샷 숫자의 어긋남)은
대상 자체가 사라진다.

## 2. 변경

### 2-1. 엔진 — `checkupNoticeDate` (`src/engine/checkup.ts`)

새 판정은 없다. "실제로 돈 점검"(sprint가 있는 `kind:'checkup'` 날)의 선택 규칙은 지금
**두 벌**이다 — `checkup.ts`의 비공개 `lastCheckupDate`와 `report.ts`의
`latestCheckupReport` 첫 줄 필터(리뷰 R2 M-1). 이 스펙은 그 규칙을 한 곳으로 모으고 그 위에
"지금 배너를 걸 때인가"만 더한다:

```ts
// src/engine/checkup.ts

/** 실제로 점검을 한 날들(날짜 오름차순 — days가 그렇다). sprint 없는 checkup 날은 점검을
 *  하지 않은 것이라 제외한다. **이 술어의 주인은 여기다** — 점검 스케줄(lastCheckupDate),
 *  월간 리포트(latestCheckupReport), 부모 홈 배너가 같은 정의를 봐야 한다. */
export function checkupDays(days: Day[]): Day[] {
  return days.filter((d) => d.kind === 'checkup' && d.sprint !== undefined && d.sprint.length > 0)
}

/** 마지막으로 실제 점검을 한 날. 없으면 null. (기존 비공개 함수 — checkupDays 위로 옮기고 export) */
export function lastCheckupDate(days: Day[]): string | null {
  const last = checkupDays(days).at(-1)
  return last ? last.date : null
}

/** 부모 홈 배너가 최근 점검을 안내하는 기간(점검일 포함). */
export const CHECKUP_NOTICE_DAYS = 7

/**
 * 부모 홈 배너에 적을 최근 점검일 — 점검일부터 CHECKUP_NOTICE_DAYS일 동안만. 밖이면 null.
 *
 * **가장 최근 점검 하나만 본다**(lastCheckupDate). `date > today`(가져온 백업의 미래 날짜
 * — validateBackup은 날짜 범위를 보지 않는다)면 null이고, 그때 기간 안의 옛 점검이 있어도
 * 찾지 않는다 — 미래 날짜 기록은 시계가 틀린 기기에서만 생기는 예외라 그 경우까지 맞추는
 * 분기를 두지 않는다(리뷰 R1 M2).
 *
 * fluentMs를 받지 않는다 — 배너는 날짜만 말하므로 파생(deriveFacts)이 필요 없다. 부모 홈
 * 렌더에 파생 비용을 새로 들이지 않는다(리뷰 R2 M-1). 저장하지 않는다 — 날짜만으로
 * 결정되므로 기기마다 같은 답이 나온다.
 */
export function checkupNoticeDate(days: Day[], today: string): string | null {
  const date = lastCheckupDate(days)
  if (date === null || date > today) return null
  if (shiftDay(date, CHECKUP_NOTICE_DAYS) <= today) return null
  return date
}
```

`report.ts`의 `latestCheckupReport`는 첫 줄의 자체 필터를 `checkupDays(days)`로 바꾼다
(동작 동일 — 기존 테스트가 그대로 통과해야 한다). 이로써 배너의 날짜와 리포트 제목의
날짜가 같은 함수에서 나온다(단일 출처).

### 2-2. 화면 — 부모 홈 (`src/screens/home-parent.ts`)

미채점 배너(`#pending`) 바로 아래에 배너 한 장. 미채점 배너와 같은 구조를 쓰되 톤만
다르다 — `role="button"`과 `tabindex="0"`을 주고, click과 keydown(Enter·Space) 모두
`navigate('#/report')`로 잇는다:

```html
<div
  class="banner seed-callout__root seed-callout__root--tone_informative"
  id="checkup-notice"
  role="button"
  tabindex="0"
>
  <span class="seed-callout__description seed-callout__description--tone_informative">
    9월 2일 수요일 점검 결과가 있어요 · 리포트 보기
  </span>
</div>
```

- 날짜는 `formatDate(checkupDate)` 그대로 — 요일이 붙는다(리뷰 R1 I4). 미채점 배너와 리포트
  제목(`src/screens/report.ts`의 `formatDate(c.date)`)이 같은 형식이라 맞춘다. 두 줄로 접혀도
  괜찮다 — 이 배너에는 숫자가 없어 짧다.
- SEED 콜아웃 톤은 `informative`(정보 안내). `neutral`은 본문과 구분이 약해 배너로서의
  역할(한 번은 눈에 띄어야 한다)을 못 한다. `seed-callout__root--tone_informative`와
  `seed-callout__description--tone_informative` 둘 다 `@seed-design/css`에 있다(리뷰 확인).
  색은 토큰이 아니라 SEED 레시피 클래스로 온다 — 값을 CSS에 베끼지 않는다.
- `#/report`는 PIN 게이트 뒤다(`main.ts`의 `GATED_HASHES`). 미채점 배너가 `#/grade`로
  가는 것과 같은 경로라 새 게이트 처리는 없다.
- 변수 이름은 `checkupDate`로 둔다 — 이 파일에 `notice`(`syncNotice`)가 이미 있다.
- 템플릿에 들어가는 값은 `formatDate(checkupDate)`뿐이다(`date`는 `dayKey` 산출, 또는
  가져오기·pull 모두 `validateDay`의 `DATE_RE`를 지난 값 — 게다가 `formatDate`는 `Number()`로
  파싱해 숫자만 낸다). 식 id·숫자는 싣지 않는다.
- `src/styles/app.css`의 `.banner` 주석은 "callout(warning)이 배경·radius·여백을 준다"라
  경고 전용으로 읽힌다 — informative 배너가 같은 클래스를 쓰게 되므로 "callout 톤
  레시피가"로 고친다(리뷰 R2 M-5).

### 2-3. 문구 (`-어요` 체, `docs/reference/karrot-DESIGN.md`)

`{formatDate(date)} 점검 결과가 있어요 · 리포트 보기` — 상황 분기 없음. "결과가 있어요"는
점검이 실제로 돈 날(sprint가 있는 `kind:'checkup'`)에만 참이고, `checkupDays`가 그
조건으로 고르므로 거짓이 되는 상태가 없다(원칙 3). 다른 기기의 일반 세션이 같은 날에
병합돼 있어도(`merge.ts`는 한쪽이 checkup이면 checkup) 점검 세션은 sid 합집합에서 사라지지
않으므로 여전히 참이다(리뷰 R2 확인).

### 2-4. PRD·HANDOFF

- `docs/PRD.md` **§3**(역할과 화면 소속 — 게이트를 말하는 절)에 한 줄: 점검 결과는
  **리포트 월간 절(PIN 뒤)**에만 숫자로 보이고,
  부모 홈은 점검일부터 7일간 "결과가 있다"고만 안내한다. 아이 화면에는 보이지 않는다
  (원칙 2). 소유자: `src/engine/checkup.ts`의 `checkupNoticeDate`.
- `docs/superpowers/HANDOFF.md`: 이 결정과 근거 두 가지(원칙 2 충돌로 아이 지도 대신 부모
  홈 · PIN 밖이라 숫자 없음)를 현재 상태 절에 한 문단. 「지금 상태」 표의 테스트 개수
  행(`482개 / 22개 파일`)에 이번 증가분을 이어 적는다 — 8케이스가 붙으므로 **482 → 490(+8),
  파일 22 유지**(리뷰 R2 M-4·R3 M-2). `npm test` 실행값으로 확인한 뒤 적는다.

## 3. 테스트 (`src/engine/checkup.test.ts`, `describe('checkupNoticeDate')`)

fluent 식은 하나도 필요 없다(날짜만 본다). 모듈 스코프에 빌더 하나를 둔다 — 기존
`fluentDay`(`kind:'normal'`)는 못 쓴다(리뷰 R1 I2·R2 M-3):

```ts
/** 실제로 점검을 한 날. 시도 하나면 충분하다 — checkupDays는 개수만 본다.
 *  이름을 엔진의 checkupDays와 한 글자 차이로 두지 않는다(리뷰 R3 M-3). */
const doneCheckup = (date: string): Day => ({
  date,
  kind: 'checkup',
  sheet: [],
  sprint: [{ fact: '2×3', correct: true, ms: 800 }],
})
```

| #   | 상황                                                            | 기대                                    |
| --- | --------------------------------------------------------------- | --------------------------------------- |
| 1   | 점검 기록 없음                                                  | null                                    |
| 2   | 점검 `08-29`, today `08-29`                                     | `'2026-08-29'`                          |
| 3   | 점검 `08-29`, today `09-04`(+6)                                 | `'2026-08-29'`                          |
| 4   | 점검 `08-29`, today `09-05`(+7)                                 | null (경계)                             |
| 5   | 점검 `09-10`, today `09-05`                                     | null (미래)                             |
| 6   | 점검 `08-29`와 `09-26`, today `09-27`(최근 점검 +1)             | `'2026-09-26'`                          |
| 7   | 점검 `08-29`와 `09-26`, today `09-01`(옛 점검 +3, 새 점검 이전) | null — 최근 것만 본다(§2-1, 리뷰 R1 M2) |
| 8   | `kind:'checkup'`인데 `sprint: []`인 날 `09-01`만, today `09-01` | null — 점검을 하지 않은 날              |

6·7의 `today` 오프셋(+1·+3)은 3·4의 경계(+6·+7)와 겹치지 않게 골랐다(리뷰 R1 I3) —
그래야 아래 변이 검증에서 "그 테스트만" 빨개진다. 날짜 산술은 리뷰 R2가 `shiftDay`로
실측했다(`08-29+6=09-04`, `+7=09-05`, `09-26+1=09-27`).

`checkupDays`는 따로 테스트하지 않는다 — `lastCheckupDate`(기존 `nextCheckupDate`
테스트 "sprint가 없는 checkup 날은 기준점이 아니다")와 `latestCheckupReport`(기존
`report.test.ts`)와 위 8번이 세 방향에서 같은 술어를 검사한다.

**변이 검증**(각각 "그 테스트만" 빨개져야 한다):

- `<=`를 `<`로 바꾸면 **4번만**
- `CHECKUP_NOTICE_DAYS`를 6으로 바꾸면 **3번만**
- `date > today` 검사를 지우면 **5번과 7번**
- `checkupDays`에서 `.length > 0`만 지우면 **8번만** — 기존 "sprint가 없는 checkup 날은
  기준점이 아니다" 테스트의 픽스처는 `sprint` 키 자체가 없어 `!== undefined`에 걸러지므로
  초록으로 남는다(리뷰 R3 I-1). sprint 절 전체(`d.sprint !== undefined && d.sprint.length > 0`)를
  지우면 **8번 + 그 기준점 테스트**. 두 변이가 `sprint: []`와 `sprint` 부재를 각각 잡는다

확인하고 원복한다.

## 4. 비범위

- 아이 화면(지도·스프린트 결과)의 문구 — 원칙 2. 지도의 숫자가 점검일에 줄어드는 것은
  엔진의 성질이고 이번 범위 밖이다.
- 배너에 숫자·식 목록 — §1 근거. 리포트가 이미 보여준다.
- 배너 닫기·읽음 상태 — 저장 상태가 필요해져 기기마다 갈린다. 7일 자동 소멸로 대신한다.
- 리포트 월간 절로의 앵커 스크롤 — 리포트는 「이번 주」 절(지도·유형별 정답률)이
  먼저라 점검 절은 한 스크롤 아래에 있다(리뷰 2라운드 I-1). 그래도 상단 진입으로 둔다
  (사용자 결정): 배너 문구가 목적지를 예고하고, 리포트는 부모가 매주 보는 화면이라
  구조를 이미 안다. 자동 스크롤은 해시에 표시를 실어야 해 PIN 게이트(`main.ts`)까지
  손대야 한다 — 그 비용이 스크롤 한 번보다 크다.
- `div role="button"` 배너의 pressed 피드백 — SEED 콜아웃의 hover/active는
  `button`·`a`에만 걸린다. 미채점 배너와 같은 상태이고(리뷰 M4), 두 배너를 함께 고칠
  일이라 별도 작업으로 남긴다.

## 5. 검증 (구현 뒤)

- `npm test` · `npx prettier --check .` · `npm run build`
- **사람이 수동으로**(리뷰 M5): dev 서버에서 점검이 든 백업
  `/Users/iseongho/Downloads/haruchi-2026-09-02.json`(레포 밖)을 가져와 부모 홈 배너 확인 —
  문구·날짜 형식, 탭 → PIN → 리포트, 키보드 Enter/Space. 맥 Chrome은 미페어링 기기라
  가져오기의 서버 스냅샷 단계는 돌지 않는다.
- 원칙 2 검토 질문: 아이 홈·지도·스프린트 결과에 변경이 없는지 `git diff --stat`으로 확인
