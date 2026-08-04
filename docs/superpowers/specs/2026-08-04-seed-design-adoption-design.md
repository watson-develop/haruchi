# SEED 디자인 시스템 도입 — 설계

2026-08-04

화면을 SEED(당근 디자인 시스템) 위에 다시 세운다. 목표는 **통일된 UX**이고, 수단은 SEED의 토큰·레시피와 그 권고를 따르는 것이다. 인쇄물은 이 작업의 대상이 아니며, 한 픽셀도 바뀌면 안 된다.

## 1. 왜 SEED인가 — 그리고 왜 TDS가 아닌가

두 후보를 조사했고 **라이선스에서 갈렸다**.

- **TDS Mobile(토스)은 쓸 수 없다.** `@toss/tds-mobile@2.5.1`이 공개 npm에 있지만 `license` 필드가 비어 있다(라이선스 미표기 = 권리 유보가 기본). 공식 문서가 범위를 명시한다 — "토스가 TDS 사용을 허가하는 건 **앱인토스 서비스를 제공하기 위한 제한적인 권한**이에요." 하루치는 앱인토스 미니앱이 아니다. **취향이 아니라 조건이므로 다시 검토하지 않는다.**
- **SEED는 Apache-2.0이고, `@seed-design/css`는 순수 CSS다.** `dependencies`·`peerDependencies`가 모두 0이라 React가 필요 없다. 레시피 클래스는 평범한 BEM(`seed-action-button--variant_brandSolid`)이고 상태 스타일이 `:is(:hover, [data-hover])` 형태라 **네이티브 의사클래스가 살아 있다** — 정적 컴포넌트는 JS 0줄로 굴러간다. 프레임워크 없음·런타임 의존성 0이라는 이 레포의 전제와 충돌하지 않는 유일한 형태다.

**TDS에서 가져오는 것은 코드가 아니라 API 사상이다** — 오버레이를 명령형 한 줄로 부르는 방식(§6). 아이디어를 보고 우리 손으로 구현하는 것이고, 코드·에셋·피그마를 가져오지 않는다.

검증한 안전성: `base.css`에 `url()`·`@import`·`@font-face`가 하나도 없어 **외부 요청을 만들지 않는다**(오프라인 PWA에 안전). 패키지에 `preinstall`/`postinstall` 훅이 없어 `npm ci`가 아무것도 실행하지 않는다. `LICENSE` 파일이 동봉돼 있다.

## 2. 도입 형태

`@seed-design/css`를 `dependencies`에 넣는다. **이 레포 최초의 런타임 의존성 항목**이지만 산출물은 CSS뿐이고 실행 코드는 번들에 들어가지 않는다.

`app.css` 최상단:

```css
@layer seed-base, seed-components; /* 레이어 순서 고정 */
@import '@seed-design/css/base.layered.css';
```

레시피는 화면 작업 단위로 필요한 것만 `@import '@seed-design/css/recipes/<name>.layered.css'`로 붙인다. `all.css`(416KB)를 통째로 넣지 않는다.

**`.layered.css` 판을 쓰는 것이 이 설계의 핵심 결정이다.** SEED가 `@layer seed-base`·`@layer seed-components`로 감싼 판을 함께 배포하는데, **레이어에 든 CSS는 레이어 밖 CSS에게 특정도와 무관하게 진다.** 그래서 우리 CSS는 아무 장치 없이 항상 이기고, `!important`가 필요 없다.

일반 판을 쓰면 팔레트가 `:root[data-seed-color-mode="system"][data-seed-user-color-scheme="light"]` 같은 (0,3,0) 셀렉터에 정의돼 있어 나중의 덮어쓰기가 특정도 싸움으로 번진다.

**비용(gzip):** 현재 CSS 번들 2,534 → SEED base 7,505이 더해져 약 10KB. 전송량 4배지만 PWA precache라 최초 1회다. `base.css`가 정의하는 커스텀 프로퍼티는 566개이고 우리가 쓰는 것은 그중 20~30개다 — 나머지는 죽은 무게이며, 이 대가를 알고 받아들인다.

## 3. 브랜드 색 — 지금은 당근 색, 나중에 교체

**지금은 당근 브랜드 색을 그대로 쓴다.** 컴포넌트가 안정화된 뒤 원하는 브랜드 색을 입힌다(사용자 결정).

이 계획이 싼 이유는 SEED의 참조 구조 때문이다:

```
--seed-color-palette-carrot-600: #f60                          ← 원값
  ↓
--seed-color-bg-brand-solid: var(--seed-color-palette-carrot-600)   ← 시맨틱
  ↓
.seed-action-button--variant_brandSolid { background: var(--seed-color-bg-brand-solid) }
```

**나중의 교체는 팔레트 한 블록을 재정의하면 끝난다.** 시맨틱 토큰과 레시피는 손대지 않는다. `.layered.css`를 쓰므로 우리 `:root` 블록이 특정도와 무관하게 이긴다.

참고로 `--kid-accent`가 `#f2760c`이고 당근이 `#f60`이라 아이 화면 톤은 크게 흔들리지 않는다.

## 4. 토큰 매핑

| 지금      | 값        | SEED 토큰                          | 라이트 실값 |
| --------- | --------- | ---------------------------------- | ----------- |
| `--fg`    | `#111`    | `--seed-color-fg-neutral`          | `#1a1c20`   |
| `--muted` | `#777`    | `--seed-color-fg-neutral-muted`    | `#555d6d`   |
| `--line`  | `#ddd`    | `--seed-color-stroke-neutral-weak` | `#dcdee3`   |
| body 배경 | `#fafafa` | `--seed-color-bg-layer-basement`   | `#f3f4f5`   |
| 카드 배경 | `#fff`    | `--seed-color-bg-layer-default`    | `#fff`      |

손으로 고른 값과 당근이 정한 값이 거의 같다 — `--line`은 사실상 동일하다.

**`--muted` 매핑은 접근성 결함을 하나 고친다.** 흰 배경 기준 명도 대비 실측:

| 색                                 | 대비     | 본문 AA(4.5)     |
| ---------------------------------- | -------- | ---------------- |
| 지금 `--muted` `#777`              | **4.48** | 실패 (0.02 차이) |
| SEED `fg-neutral-subtle` `#868b94` | 3.42     | 실패             |
| SEED `fg-neutral-muted` `#555d6d`  | **6.62** | 통과             |

날짜·정답 표시·EBS 부가정보가 전부 이 색에 13~15px이다. SEED의 두 후보 중 **`-subtle`이 아니라 `-muted`를 골라야 하는 이유**가 이것이다.

**SEED가 고쳐주지 않는 것도 있다.** `.ebs-active` 배지는 주황 배경에 12px 흰 글자인데 대비가 **2.85**다. 당근 `#f60`으로 바꿔도 **2.94**로 여전히 미달이다. 토큰 교체로 해결되지 않으므로 별도로 처리한다 — 글자를 키우거나(18px+ 또는 14px bold면 3:1 기준 적용), 배경을 진한 단계(`carrot-800` 이상)로 내리거나, 글자를 검게 한다. **구현 시 결정하고 근거를 코드 옆에 남긴다.**

## 5. 색 역할 어휘 — 가장 큰 변화

지금 `app.css`는 `--fg`(#111) **하나로 의미가 다른 다섯 가지**를 칠하고 있다.

```
.banner            미채점 알림    background: var(--fg)
.update            업데이트 있음   background: var(--fg)
.mark.wrong        오답 표시      background: var(--fg)
.factmap .fluent   구구단 정복    background: var(--fg)
.keypad :active    누르는 중      background: var(--fg)
```

**색으로 의미를 구분할 수 없다.** SEED의 Role 어휘(Property → Role → Variant → State)로 옮기면 갈라진다.

| 하루치의 의미   | 지금                | SEED 역할     |
| --------------- | ------------------- | ------------- |
| 오늘 할 일 강조 | `--kid-accent` 주황 | `brand`       |
| 구구단 정복     | `--fg` 검정         | `brand`       |
| 완료            | `--kid-done` 초록   | `positive`    |
| 미채점 알림     | `--fg` 검정         | `warning`     |
| 업데이트 있음   | `--fg` 검정         | `informative` |
| 오답 표시       | `--fg` 검정         | `critical`    |
| 오류 배너       | `#b00020`           | `critical`    |
| 배우는 중       | 회색                | `neutral`     |

**오답을 `critical`(빨강)로 두는 판단의 근거:** 채점 화면(`#/grade`)은 **부모 소속**이다. 아이가 보는 화면이 아니므로 빨강이 아이에게 주는 정서적 부담을 걱정할 자리가 아니고, 부모가 훑을 때 오답이 즉시 눈에 띄는 편이 이득이다. 아이 화면(지도·EBS)에서는 오답 개념 자체를 쓰지 않는다.

## 6. 오버레이 — 신규 둘, 기존 하나 유지

TDS의 명령형 API 사상을 따른다. 선언형은 상태를 둘 자리가 필요한데 바닐라 DOM에는 그 자리가 없다.

```ts
toast(message: string, opts?: { tone?: 'neutral' | 'positive' }): void
confirmDialog(opts: {
  title: string
  description?: string
  confirmLabel: string
  cancelLabel?: string
  tone?: 'neutral' | 'critical'
}): Promise<boolean>
```

- **`toast()` — 신규.** 사라지는 성공 피드백. 지금 앱에는 성공을 알리는 채널이 아예 없다(실패만 말하고 성공은 침묵한다). SEED `snackbar` 레시피. **`critical` 톤을 두지 않는 것이 의도다** — 실패는 전부 `showError()`로 가고, 사라지는 실패 알림이라는 것은 아래 근거대로 이 앱에 있어서는 안 된다.
- **`confirmDialog()` — 신규.** `report.ts`가 손으로 만든 확인 패널(`#confirm-replace`)을 대체한다. HANDOFF에 이월된 **이중 클릭 가드 부재**가 여기서 해소된다(Promise가 한 번만 resolve된다). SEED `dialog` 레시피.
- **`showError()` — 의미 그대로, 껍데기만 `callout`(tone: critical).** 호출부 13곳은 건드리지 않는다. **자동으로 사라지지 않는 성질이 의도된 설계이므로 토스트로 흡수하지 않는다** — 주석의 근거대로 "아이패드에 며칠씩 떠 있는 앱이라 지난 실패가 계속 참인 척하는 상태를 만들지 않는다". 실패는 남아야 하고 성공은 사라져도 된다. 둘은 같은 것의 변종이 아니다.

**레이아웃 협응.** `.update` 배너가 하단 고정이라 토스트와 겹칠 수 있다. 이미 이 레포가 쓰는 관용구를 그대로 쓴다 — `body:has(.update) .toast { bottom: ... }`. `#app`의 아래 여백을 조건부로 늘리는 기존 `:has()` 규칙과 같은 방식이므로 새 장치가 늘지 않는다.

**상태는 `data-*` 계약으로 우리가 토글한다.** 레시피가 기대하는 것: `data-disabled`·`data-checked`·`data-open`·`data-state`·`data-loading`. 호버·포커스는 네이티브 의사클래스가 이미 잡으므로 손대지 않는다.

## 7. 인쇄물 불변식 — 실제 누수 두 곳

**종이는 한 픽셀도 바뀌면 안 된다.** 확인한 결과 경계 자체는 깨끗하다 — 종이 클래스(`.sheet*`·`.v*`·`.inv*`·`.strat*`·`.word*`·`.n`)는 전부 `print-sheet.ts` 안에만 있고 `app.css`는 그중 하나도 정의하지 않는다. 그러나 누수가 둘 있다.

**누수 ① — `print.css:129`가 화면 변수를 참조한다.**

```css
.strat-zone {
  border: 2px solid var(--fg, #000);
}
```

`--fg`를 SEED 토큰으로 재정의하면 **종이의 전략 존 테두리 색이 따라 바뀐다.** fallback이 이미 `#000`이라 원래 의도가 "검정"이었다.
→ **그 줄을 `#000` 리터럴로 고정한다.** `print.css`가 화면 변수를 참조하는 유일한 줄이고, 끊으면 종이가 화면 변경으로부터 완전히 격리된다.

**누수 ② — 새 오버레이는 종이에 찍힌다.**

`@media print`가 숨기는 것은 `.no-print`·`#error-bar`·`.update` **셋뿐**이다. 주석이 이 실패를 이미 겪었다고 증언한다 — "`.no-print`만 숨기면 에러 배너와 업데이트 배너가 아이 문제지 위에 빨간 띠·검은 띠로 찍혀 나온다."
→ **모든 오버레이에 공통 클래스 `.overlay`를 주고 인쇄 숨김 목록을 `.overlay` 하나로 줄인다.** 다음에 추가되는 오버레이가 자동으로 안전해진다 — 목록에 넣는 것을 기억하는 대신 구조가 막는다.

**`print-sheet.ts`에서 바꿔도 되는 클래스는 `.step`·`.banner`·`.no-print` 셋뿐이다.** 나머지는 종이다.

## 8. 타이포와 간격

**px → rem.** SEED 권고: "고정 픽셀값(px) 대신 rem과 같은 상대 단위를 사용하여 사용자의 폰트 크기 설정을 존중". 지금 `app.css`는 전부 px다. SEED 타이포 토큰은 `clamp()` 기반에 `--seed-font-size-multiplier`가 물려 있어 **아이패드의 큰 글씨 설정이 실제로 먹기 시작한다**(지금은 무시된다).

**스케일:** t1~t14 = 11 12 13 14 16 18 20 22 24 26 28 32 40 48px. 지금 쓰는 값 중 **17·15·10·56px**가 스케일 밖이다. 앞의 셋은 붙은 칸(18·14·11)으로 옮긴다.

**`.sprint-q` 56px → t14(48px).** SEED 권고가 "토큰과 컴포넌트 외 독자적 정의 지양"이고, t11~t14는 "sm 브레이크포인트 이상 권장"인데 아이패드는 해당된다. **되돌리기 지점:** 이것은 아이가 보는 문제 숫자라 크기 자체가 설계였다. 아이패드 실물에서 작아 보이면 이 한 줄만 되돌린다.

**간격 토큰:** global-gutter `x4`(16px) · component-default `x3`(12px) · between-text `x1.5`(6px) · nav-to-title `x5`(20px) · screen-bottom `x14`(56px) · between-chips `x2`(8px). `#app` 패딩 `24px 20px 48px`이 여기에 맞춰 바뀐다.

## 9. 화면별 변경

| 화면          | 바뀌는 것                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------- |
| `home-parent` | `.step`→`list-item`, `.banner`→`callout`(warning), `.links`→`action-button`(ghost)          |
| `home-child`  | `.step`→`list-item`, `--kid-accent`→`bg-brand-solid` · `--kid-done`→`fg-positive`로 재정의  |
| `grade`       | `.grade-row`→`list-item`, `.mark`→`action-button`, `.moods`→`segmented-control`             |
| `sprint`      | `.keypad`→`action-button`(크기는 8살 손가락 기준 유지), `.sprint-q`→t14, 진행바는 고유 유지 |
| `report`      | `.report-types`→`list-item`, 가져오기 확인 패널→`confirmDialog()`                           |
| `ebs`         | `.ebs-topic`→토큰만(SEED에 카드 레시피 없음), `.ebs-active`→`badge`, 진행바 고유 유지       |
| `fact-map`    | 10×10 격자 구조 유지, 칸 색만 역할로 — 정복 `brand` / 배우는 중 `neutral`                   |
| `map`         | 래퍼라 거의 없음                                                                            |
| `print-sheet` | `.step`·`.banner`·`.no-print` 셋만                                                          |

**`kid.css`는 파일로 남는다.** 값이 SEED 토큰을 가리키게 바뀔 뿐이고, "아이 홈 색은 `kid.css`에만 있다 · `app.css`에 아이용 색을 넣지 말 것"이라는 기존 경계는 그대로다 — 부모 화면·인쇄물 톤 오염을 막는 장치이므로 이번 작업이 없애지 않는다.

**`.mark`의 variant 지정(정밀):** O 미선택 `neutralOutline` → O 선택 `neutralSolid`, X 미선택 `neutralOutline` → X 선택 `criticalSolid`. size는 지금의 52×44px 터치 영역을 유지하도록 `large` + 폭 override.

**SEED로 갈아탈 수 없는 것이 절반이다.** `.factmap` 10×10 지도 · `.sprint-progress` 선형 진행바 · `.ebs-bar` 진행바 · `.keypad` 숫자 키패드 · `.ebs-topic` 카드 — SEED에 대응 레시피가 없다(선형 progress가 아예 없고 `progress-circle`뿐이며, 카드도 없다). **이것들이 이 앱의 정체성이고 디자인 시스템이 대신 정해줄 수 없다.** 통일성은 레시피 개수가 아니라 토큰에서 나오므로, 이들도 색·간격·radius·타이포는 전부 SEED 토큰을 쓴다.

## 10. 작업 경로

**브랜치.** CLAUDE.md ③의 "이 커밋 하나가 그대로 배포돼도 괜찮은가 → 아니오"에 해당한다. 9개 화면을 다시 짜는 중간 상태가 아이패드로 나가면 화면마다 톤이 다르다. 브랜치에서 완성하고 한 번에 머지한다. 워크트리는 다른 세션이 없으므로 과하다.

## 11. 검증

**테스트가 이 작업을 지켜주지 않는다.** 설계 §12가 DOM·화면 테스트를 금지하므로, 9개 화면을 전부 다시 짜도 `npm test` 283개는 전부 초록이다. 이 사실을 전제로 셋을 둔다.

1. **브라우저 실물 확인.** 화면마다 열어 눈으로 본다. HANDOFF에 "Chrome 확장이 연결되지 않아" 못 봤다고 이월된 6항목(빈 데이터 렌더 / 30일 배지 소멸 / 가져오기 패널·전체 교체 / 깨진 JSON 사유 배너 / 일요일 채점 후 `#/report` 자동 전환 / 홈 스프린트 버튼 3-상태)도 이때 함께 본다.
2. **인쇄 회귀 — 기계적으로 확인한다.** 절차: (a) 브랜치를 만들기 **전에** main에서 `#/print`를 열어 `document.querySelectorAll('.sheet')`의 `outerHTML`을 파일로 저장한다 (b) 작업이 끝난 뒤 **같은 날짜**로 같은 것을 저장한다 (c) `diff`가 비어야 통과다. 종이 클래스의 마크업이 한 글자도 바뀌지 않았는지가 판정 기준이고, 눈으로 보는 것으로는 부족하다. 날짜가 같아야 `sheet`가 같으므로 두 스냅샷은 **같은 IndexedDB 상태**에서 떠야 한다(재인쇄 동일성 게이트가 이를 보장한다 — 채점이 없는 날이면 `sheet`가 새로 써지지 않는다).
3. **소속 불변식.** 브랜치 diff에서 `navigate(` 호출부를 전부 세어 머지 전후 목적지가 같은지 확인한다. **삼항연산자·템플릿 리터럴·변수에 담긴 해시까지 본다** — `grade.ts:188`이 삼항연산자 속에 숨어 있어 리터럴 검색에 안 걸린 전례가 있다.

추가로 **XSS 재점검**이 필요하다. 템플릿을 다시 쓰면 `escapeHtml`을 거치지 않은 값이 `el()`에 들어갈 기회가 새로 생긴다. 인쇄·채점 화면 템플릿에 이스케이프 없이 들어가는 값은 우리가 만든 리터럴뿐이어야 한다.

## 12. 되돌리기 지점과 미결정

**되돌리기 지점**

- `.sprint-q` 48px — 아이패드에서 작아 보이면 이 한 줄만 되돌린다(§8)
- 브랜드 색 — 팔레트 한 블록으로 언제든 교체한다(§3)
- 도입 전체 — `npm uninstall @seed-design/css` + `@import` 두 줄 제거

**미결정**

- `.ebs-active` 배지 대비 미달(2.85)을 어떤 방법으로 고칠지 — 글자 크기 / 배경 명도 / 글자색 중 구현 시 결정(§4)
- 다크모드를 켤지. SEED는 `data-seed-color-mode`로 지원하지만 이 앱은 지금 라이트 전용이고, 켜면 종이 미리보기와 화면의 관계를 다시 봐야 한다. **이번 범위 밖으로 둔다.**
