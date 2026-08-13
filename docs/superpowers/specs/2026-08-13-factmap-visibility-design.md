# 구구단 지도 가시성 — 설계

2026-08-13. 실기기 스크린샷(iPhone, `#/map`)에서 관찰된 두 문제를 고친다.
적대적 리뷰 2라운드 반영(R1: Important 3 · Minor 4, R2: Important 1 ·
Minor 3 — 아래 각 절에 표시).

## 0. 문제와 원인

**A. 「새로!」가 지도 화면에서 절대 나오지 않는다 (버그).**
`src/screens/map.ts:26`이 `factMapHtml(facts, undefined, …)`로 호출한다 —
`newlyFluent`가 기본값 빈 Set이 되어 `#/map`에서는 `fresh` 칸이 나올 수 있는
경로 자체가 없다. `fresh`가 실제로 그려지는 곳은 스프린트 결과 화면(그 세션에서
정복한 식, `sprint.ts:315`)과 부모 리포트(최근 7일, `screens/report.ts:264`)
둘뿐이다.
그런데 범례는 `factMapHtml` 안에서 무조건 찍히므로, 지도 화면은 절대 나올 수
없는 상태를 범례에 광고한다.

**B. 「연습 중」과 「아직」이 구분되지 않는다.**
`app.css`에서 아직 = 투명 배경 + `--seed-color-stroke-neutral-weak` 테두리,
연습 중(`.learning`) = `--seed-color-bg-layer-fill` 배경 + 같은 테두리. 옅은
회색 한 끗 차이라 실기기에서 같은 색으로 보인다.

## 1. 결정 (사용자, 2026-08-13)

- **지도 화면의 「새로!」 = 오늘 정복한 식.** 오늘 날짜의 기록을 뺀 파생과
  전체 파생을 비교해, 오늘에 이르러 fluent가 된 식만 `fresh`로 그린다.
  하루가 지나면 정복(솔리드)으로 가라앉는다.
- **「연습 중」 = 옅은 브랜드 색, 두 채널.** 배경 `--seed-color-bg-brand-weak`
  (carrot-100) **그리고** 테두리 `--seed-color-stroke-brand-weak`(carrot-300).
  색 위계가 생긴다: 아직(흰+회색 테두리) → 연습 중(옅은 주황+주황 테두리) →
  새로!(흰 바탕 + 주황 굵은 테두리 + 주황 숫자) → 정복(주황 솔리드).
  배경만으로 안 하는 이유(리뷰 I-3): carrot-100(#fff2ec)은 흰색(#ffffff)과
  채널별 차이가 0·13·19에 불과해, iPhone True Tone/Night Shift가 흰 바탕을
  따뜻하게 밀면 이 스펙이 고치려는 "실기기에서 같은 색" 실패가 재현된다.
  테두리가 두 번째 시각 채널로 남는다. 그래도 부족하면 배경을 한 단계 진한
  `--seed-color-bg-brand-weak-pressed`(carrot-200)로 올린다(§5 실기기 확인이
  판정). pressed 상태 토큰을 정적 상태에 쓰는 의미 비용은 인지하고 선택한다
  — 팔레트 직참조(`--seed-color-palette-carrot-200`)는 이 레포가 이미 기각한
  관례(app.css의 static-white 직참조 기각 주석)라 역할 토큰 중에서 고른 것.
  채택 시 그 사정을 CSS 주석으로 남긴다.

「새로!」의 의미는 화면마다 다르게 유지한다 — 스프린트 결과 = 그 세션,
리포트 = 최근 7일, 지도 = 오늘. 세 화면의 시간 창이 다른 것은 각 화면의
질문이 다르기 때문이다(방금 뭘 해냈나 / 이번 주 뭘 해냈나 / 오늘 뭘 해냈나).
~~범례 문구는 세 화면 공통으로 「새로!」를 유지한다(화면별 문구 파라미터는
YAGNI로 기각).~~ **번복 — 2026-08-13 배포 직후 실사용이 근거를 무너뜨렸다.**
기각의 근거는 "아무도 두 창을 나란히 볼 수 없다"였다. 링크 기준으로는 참이지만
(부모 화면에 `#/map` 진입로 없음), 아이 홈(`home-child.ts`)에 지도 버튼이 있어
아빠가 그 경로로 들어가면 그만이다. **실제로 같은 날 `#/map`과 `#/report`를
나란히 찍은 스크린샷에서 같은 세 칸(2×2·2×7·2×9)이 한쪽은 정복, 한쪽은 새로!로
나왔고, 사용자가 "의도된 거냐"고 물었다.** 값은 양쪽 다 맞다 — 창이 다를 뿐이다.
비용은 화면 어디에도 **기간이 적혀 있지 않다**는 것이다.

**그래서 범례가 자기 창을 밝힌다:** 지도·스프린트 결과 = 「오늘 새로!」,
주간 리포트 = 「이번 주 새로!」. 창을 통일하지 않는 이유는 위와 같다(각 화면의
질문이 다르다). 호출부는 **창의 의미**(`'today'`|`'week'`)를 선언하고 **문구는
`fact-map.ts`가 소유한다** — 문구를 호출부가 넘기면 같은 말이 세 곳에 흩어진다.
선언은 **필수**로 둔다: 기본값을 주면 호출부가 빠뜨렸을 때 범례가 틀린 기간을
말하는데, 그것이 이 스펙이 고친 원래 버그(`newlyFluent` 기본값)와 같은 형태다.

**스프린트 재진입 화면도 오늘 창으로 고친다(리뷰 I-1).** 오늘 이미 스프린트를
마친 뒤 `#/sprint`에 다시 들어오면 결과 화면을 재표시하는데, 이 분기는
`new Set()`을 넘겨 문제 A(나올 수 없는 상태를 범례가 광고)가 그대로 남고,
직후에 연 `#/map`과 같은 칸이 몇 초 간격으로 다르게 보이는 모순이 생긴다.
이 분기(`sprint.ts:49-52`, `days`·`meta`·`today` 모두 스코프에 있음)도
`newlyFluentSince(days, fluentMs, today)`로 채운다. 스프린트는 기기당 하루
한 번이므로(오늘 완료 시 재진입은 결과 재표시) 오늘 창 = 그 세션 — 직후
결과 화면(세션 기준)과 값이 같아 의미 충돌이 없다. 예외는 두 기기가 같은
날 각자 스프린트를 해 병합된 경우뿐인데, 그때 오늘 창이 두 세션의 정복을
합쳐 보여주는 것은 "오늘 뭘 해냈나"라는 질문에 오히려 더 맞는 답이다.

## 2. 변경

### 2-1. 엔진 — `newlyFluentSince` 추출 (단일 출처)

`report.ts:78-85`의 newlyFluent 계산(“경계 이전 days만으로 파생한 결과와 전체
파생을 비교”)을 `src/engine/facts.ts`에 함수로 뺀다:

```ts
/** since 이후의 기록으로 비로소 fluent가 된 식 id 목록.
 *  (전체 파생 fluent) − (date < since 인 날만의 파생 fluent). */
export function newlyFluentSince(days: Day[], fluentMs: number, since: string): string[]
```

- `weeklyReport`(`engine/report.ts`)는 이 함수를 `since = weekStart`로 호출하도록
  교체한다 — 동작 불변(기존 `report.test.ts`가 그대로 통과해야 한다).
- 반환 순서는 기존과 동일하게 `deriveFacts` 키 순서(= `FACT_IDS` 순서)를 따른다.
- `engine/report.ts` 상단의 "deriveFacts 총 여섯 번" 주석을 실제 횟수로 갱신한다
  (리뷰 M-1 — `newlyFluentSince`가 내부에서 2회를 돌리므로 weeklyReport 경유
  총 횟수가 는다. 성능은 무의미하지만 주석이 거짓이 되면 안 된다).

### 2-2. 지도 화면 — 오늘 정복을 넘긴다

`src/screens/map.ts`:

```ts
const today = dayKey(new Date())
const fresh = new Set(newlyFluentSince(days, meta.settings.fluentMs, today))
…
${factMapHtml(facts, fresh, { window: 'today', invite: true })}
```

오늘 기록이 없으면 빈 Set — 기존과 같은 그림이다. `fresh`가 `fluent`보다
우선하는 렌더 순서(`fact-map.ts:31`)는 그대로 둔다. `window: 'today'`는 §1의
번복으로 필수가 된 선언이다 — 이 화면의 범례가 「오늘 새로!」로 뜬다.

### 2-2b. 스프린트 재진입 분기 — 같은 창으로 (리뷰 I-1)

`src/screens/sprint.ts:51`의 `new Set()`을:

```ts
renderResult(
  root,
  facts,
  new Set(newlyFluentSince(days, meta.settings.fluentMs, today)),
  existing.sprint,
  previousMean(days, today),
  null,
)
```

직후 결과 화면(스프린트 완료 직후, 세션 기준 `newly`)은 건드리지 않는다.

### 2-3. CSS·범례 — 연습 중 색

- `app.css` `.factmap .cell.learning`: `background: var(--seed-color-bg-brand-weak)`,
  `border-color: var(--seed-color-stroke-brand-weak)` (§1의 두 채널).
- `fact-map.ts` 범례의 연습 중 인라인 색도 같은 토큰으로 맞춘다(범례 견본과
  실제 칸이 다른 색이면 범례가 거짓말이 된다).
- 값을 베끼지 않고 토큰을 가리킨다 — 근거는 CLAUDE.md 단일 출처 규칙 하나다.
  (리뷰 M-2: "다크모드가 따라온다"는 틀린 근거라 지웠다 — `index.html`이
  `data-seed-color-mode="light-only"`로 고정돼 있어 다크 토큰은 적용되지 않는다.)

### 2-4. 범례가 자기 창을 밝힌다 (§1 번복분)

`factMapHtml`의 `opts`에 **필수** 필드를 더한다:

```ts
opts: { window: 'today' | 'week'; invite?: boolean },
```

문구는 이 파일이 소유한다 — 호출부는 의미만 선언한다:

```ts
const freshLabel = opts.window === 'today' ? '오늘 새로!' : '이번 주 새로!'
```

호출부 셋: `map.ts` `'today'` · `renderResult`(`sprint.ts`, 완료 직후와 재진입
**둘 다 이 한 곳을 지난다**) `'today'` · `report.ts` `'week'`. 기본값을 주지
않으므로 새 호출부가 선언을 빠뜨리면 컴파일이 죽는다(`TS2741`).

범례 폭은 320px에서 실측했다 — 가장 긴 조합(리포트, 「이번 주 새로!」)이
내용 202px / 컨테이너 288px로 한 줄에 들어가고 가로 스크롤이 생기지 않는다.

## 3. 건드리지 않는 것

- 스프린트 **완료 직후** 결과 화면의 `newly`(세션 기준) — 그대로.
  (재진입 분기만 §2-2b에서 고친다.)
- 리포트의 주간 창 — 의미 그대로, 계산만 공유 함수로.
- `fresh`/`fluent`/`learning`의 렌더 분기 구조(`fact-map.ts`) — 그대로.
- 아이/부모 화면 소속과 navigate 경로 — 변경 없음.

## 4. 테스트 (engine만 — 설계 §12)

`facts.test.ts`에 `newlyFluentSince` 직접 테스트:

1. 오늘 스프린트로 비로소 fluent가 된 식 → 포함
2. 어제까지로 이미 fluent였던 식 → 제외 (오늘 또 맞혀도)
3. 아직 fluent가 아닌 식 → 제외
4. `since` 이전 기록이 하나도 없으면 = 현재 fluent 전부 — 기대값은
   `deriveFacts`로 계산하지 말고 **리터럴 id 배열로 박는다**(리뷰 M-3:
   구현과 기대가 같은 함수를 공유하면 반쪽 항진명제가 된다)
5. `since` 이전엔 fluent였는데 이후 기록으로 강등된 식 → 제외 (리뷰 M-4:
   이 테스트가 없으면 대칭차(XOR)형 오구현 — before에만 fluent인 식을
   포함시키는 — 을 하나도 못 잡는다. 강등 시맨틱의 문서화이기도 하다:
   어제 fluent → 오늘 강등 = fresh 아님, learning으로 표시)

`report.test.ts` 기존 newlyFluent 테스트는 수정 없이 통과해야 한다(리팩터링
동작 불변의 증거).

변이 검증(리뷰 I-2 — 라운드 1 초안의 변이 계획은 틀렸었다: `<`→`<=`는
before 집합을 키우는 방향이라 제외를 단언하는 2·3번은 어떤 픽스처로도
초록으로 남는다):

- 변이 ①: 경계 비교 `<`→`<=` → **1번**(그리고 픽스처에 since 당일 기록이
  있으면 4번)이 빨개져야 한다
- 변이 ②: before 차감을 통째로 제거(현재 fluent 전부 반환) → **2번만**
  빨개져야 한다 (5번의 강등된 식은 현재 fluent가 아니라 이 변이로도
  반환되지 않는다 — R2 리뷰 F1이 잡은 사실)
- 변이 ③: 차집합을 대칭차로(`fluent(now) XOR fluent(before)` — before에만
  fluent인 식도 포함) → **5번만** 빨개져야 한다(1~4번은 초록 유지 — 이것이
  5번 테스트의 고유 가치를 증명한다)

## 5. 검증

`npx prettier --check .` · `npm test` · `npm run build` 통과 후 육안 확인:

- dev 서버 `#/map`: 오늘 스프린트로 정복한 직후 그 칸이 「새로!」로 보이고,
  `#/sprint` 재진입 결과 화면에서도 같은 칸이 「새로!」인지(I-1의 모순 해소)
- **연습 중 색 판정은 실기기에서 한다(리뷰 I-3)** — 배포 후 iPhone,
  **True Tone 켠 상태**로 `#/map`에서 연습 중 칸이 아직 칸과 구분되는지.
  이 스펙의 출발점이 "모니터에선 다른데 실기기에서 같은 색"이었으므로
  모니터 확인은 판정이 아니다. 부족하면 §1의 fallback(carrot-200 배경)으로
  올려 한 번 더 확인한다.
