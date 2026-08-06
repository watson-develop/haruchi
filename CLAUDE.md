# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

초등 2학년 산수 연습 도구. 매일 A4 문제지를 인쇄해 손으로 풀고, 아이패드(PWA)에서 채점한다.
서버가 없고 데이터는 아이패드의 IndexedDB에만 있다.

**단, 동기화 백엔드가 설계 승인돼 있다**(2026-08-06,
`docs/superpowers/specs/2026-08-06-sync-backend-design.md`) — Supabase를 복제본으로 붙여
손실 방어와 다기기 쓰기를 여는 설계다. 구현이 시작되면 위 문장과 이 문서의 아키텍처·불변식
절을 함께 갱신할 것. 그 전까지 이 문서의 나머지는 현행 그대로 유효하고, **동기화 관련 코드를
새로 쓸 때는 반드시 그 설계 문서를 따른다** — 특히 병합 로직은 `engine/merge.ts` 단일 출처,
파생값(`derived`) 비동기화, `putDay`의 병합 경유가 그 문서가 정한 규칙이다.

## 환경

Node는 mise에만 있고 기본 PATH에 없다. 모든 npm 명령 전에:

```bash
export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH"
```

**이 줄은 에이전트용이고 계속 필요하다.** 2026-08-05에 사람 터미널에는
`eval "$(mise activate zsh)"`를 `~/.zshrc`에 넣어 `npm`이 그냥 되게 했지만,
에이전트의 셸은 로그인 셸이 아니라 그 설정을 타지 않는다(같은 날 실측: `which npm`
→ not found, `MISE_SHELL` 미설정). 사람이 터미널에서 직접 돌릴 때만 export가
불필요하다.

## 명령

```bash
npm ci
npm run dev            # http://localhost:5173/haruchi/  (루트는 302)
npm test               # vitest run — 전체
npm run test:watch
npm run build          # tsc --noEmit && vite build
npm run format         # prettier --write .
npx prettier --check . # CI가 도는 것과 같은 검사
```

단일 파일·단일 테스트:

```bash
npx vitest run src/engine/facts.test.ts
npx vitest run -t "유창 판정"        # 테스트 이름으로 필터
```

**docs/ 를 커밋하기 전에 반드시 `npm run format`을 돌린다.** `.prettierignore`가 없어 CI의
`prettier --check .`가 마크다운까지 검사하고, 문서 포맷 흠 하나로 앱 배포 전체가 막힌다.

## 작업 경로 — main 직접 / 브랜치 / 워크트리

두 축은 독립이다. **워크트리는 작업 공간**의 문제이고, **브랜치는 이력과 배포**의 문제다.
순서대로 두 번 묻는다.

```
① 통째로 버릴 수 있는 시도인가?                    → 워크트리
② 다른 세션이 이 체크아웃에서 돌고 있고,
   내가 여러 파일을 한동안 만질 참인가?             → 워크트리
③ 이 커밋 하나가 그대로 배포돼도 괜찮은가?
     예    → main 직접
     아니오 → 브랜치
```

②에 단서가 붙은 이유: 동시 실행 중이어도 **한 파일·한 커밋·배포 가능**한 일이면 워크트리는
과하다. `git add <명시 경로>`만으로 충분히 막힌다. 워크트리가 값을 내는 것은 여러 파일을
오래 만질 때다.

③이 크기가 아니라 위험을 재는 기준인 이유: main에 push하면 그것이 곧 배포다. main의 모든
커밋은 그날 저녁 아이패드로 나간다. 이력도 이 규칙을 따라왔다 — 149커밋 중 머지는 2개
(`phase2-multiplication-sprint`·`phase3-real-use`)뿐이고, 나머지는 각자 배포 가능한 단독
커밋이었다.

### main 직접

1. `git add <명시 경로>` — **`git add .`을 쓰지 않는다**
2. `npx prettier --check .` · `npm test` · `npm run build` 통과 확인
3. push = 배포. `gh run watch`로 결과까지 본다

### 브랜치

1. `git switch -c <name>`
2. 중간 커밋은 깨져 있어도 된다. **브랜치 push는 배포를 유발하지 않는다**
   (`deploy.yml`이 `branches: [main]`만 본다) — 백업 목적의 push는 안전하다
3. main에 머지하기 직전에 전체 검사를 통과시킨다

### 워크트리

1. **harness 네이티브 도구로 만든다.** `git worktree add`를 직접 쓰지 않는다 — 네이티브
   도구가 배치·브랜치·정리를 소유하는데 우회하면 harness가 모르는 상태가 생긴다
2. `npm ci` (node_modules는 공유되지 않는다)
3. **`docs/`를 포함해 전부 워크트리 안에서 커밋한다.** 워크트리는 독립 체크아웃이고 문서도
   그 안에서 관리된다 — "문서는 공유물이니 main에서 커밋한다" 같은 규칙은 없다. 2026-08-04
   EBS 작업에서 실제로 이 착각이 나 문서 커밋이 main 체크아웃으로 새어 나갔고, 그 커밋은
   워크트리에서 돌린 검증의 대상이 아니어서 `prettier --check` 실패를 달고 main에 앉았다
   (cherry-pick으로 브랜치에 옮기고 main을 되돌려 복구). 커밋 전에 `pwd`로 자리를 확인하고,
   `git -C`로 다른 경로를 가리키지 않는다
4. 끝나면 main에 머지하고 워크트리를 제거한다. 버릴 시도였다면 그냥 제거

### 머지와 충돌 (브랜치·워크트리 공통)

레포 설정이 **squash merge 전용**으로 잠겨 있다(2026-08-05, merge commit·rebase merge
비활성). PR 하나가 main 커밋 하나가 되고, 커밋 메시지는 PR 제목·본문이 그대로 쓰인다 —
**PR 제목을 `feat: ...` 커밋 메시지 규격으로 쓴다.** 브랜치의 "깨져 있어도 되는" 중간
커밋이 main 이력에 남지 않으므로, 규칙 ③(main의 모든 커밋은 배포 가능)이 PR 경로에서도
유지된다.

1. 브랜치를 push하고 PR을 연다(PR에서도 CI 검사가 돈다)
2. 충돌이 없으면 `gh pr merge <n> --squash`
3. **충돌이 나면 브랜치 쪽에서 `git merge main`으로 해소한다.** 이때 생기는 머지 커밋은
   squash가 지우므로 이력을 더럽히지 않고, 이력 재작성이 없으니 force push도 다른 세션
   걱정도 없다. push된 브랜치를 `git rebase main`으로 옮기는 방식은 쓰지 않는다
4. 아래 예외에 걸리면 **해소를 진행하지 말고 멈춰서 알린다**

**예외 — 멈추고 노티할 것**

- **충돌이 이 레포의 불변식에 닿는다.** 재인쇄 동일성 게이트, `derived` 비배선, 단일 출처
  (`FACT_IDS`·`ITEM_MARKS`·`STRATEGY_CATALOG`·`WORD_NAMES`) — 어느 쪽 의도가 맞는지는 코드만
  봐서는 판정할 수 없다
- **의미적 충돌.** git이 충돌로 잡지 않는데 합치면 깨지는 경우. 한쪽이 `facts.ts`의 풀 경계를
  바꾸고 다른 쪽이 그 값을 쓰는 화면을 추가한 상황이 여기 해당한다

노티는 **무엇이 충돌했는지 · 왜 예외로 판단했는지 · 해소안 후보**(어느 쪽 의도를 채택할지 /
브랜치 재작성)를 함께 낸다. 임의로 고르지 않는다.

`git rebase -i`는 이 환경에서 지원되지 않는다. squash 머지 체제에서는 필요할 일도 없고,
정말 필요해지면 사용자에게 요청한다.

### 동시 세션에서 지킬 것

- **낯선 파일·커밋은 다른 세션 것으로 보고 손대지 않는다.** 보고만 한다
- **검증은 항상 트리 전체를 본다.** 동시 세션 중에는 `prettier --check .`·`npm test`의 초록불이
  내 변경만 보증하지 않는다 — 보고할 때 이 점을 밝힌다
- **`.claude/worktrees/`는 반드시 `.gitignore`에 있어야 한다.** `prettier --check .`의 기본
  ignore-path가 `.gitignore`라, 빠지면 남의 워크트리 안 문서 하나가 로컬 검사를 통째로 막는다
- **dev 서버를 둘 띄우면 5173·5174가 다른 origin이라 IndexedDB가 갈라진다.** 두 번째
  워크트리에서 앱이 비어 보이는 것은 정상이다 — "데이터가 날아갔다"로 오인하지 말 것

## 아키텍처

프레임워크 없음(바닐라 DOM), 해시 라우팅. **실행 코드(JS) 의존성은 여전히 0개다** —
`package.json`의 `dependencies`에 있는 `@seed-design/css`(당근의 SEED 디자인 시스템,
Apache-2.0)는 **CSS만 내는 빌드 시점 의존성**이고 React·JS를 전혀 가져오지 않는다
(`dependencies`·`peerDependencies` 둘 다 0). `src/main.ts`가 해시를 보고 화면 모듈을 동적
import한다 — 화면마다 `#app`을 `replaceChildren`으로 통째로 갈아 끼우고 상태는 매번
IndexedDB에서 다시 읽으므로, 같은 해시로 다시 라우팅해도 안전하다.

- `src/engine/` — **앱의 본체이고 전부 순수 함수다.** DOM·저장소를 모른다. 테스트는 여기에만 있다
- `src/screens/` — 렌더 + 이벤트만. 화면끼리 import하지 않는다(형제 관계)
- `src/data/db.ts` — IndexedDB 래퍼. 앱의 나머지는 IndexedDB라는 사실을 몰라야 한다
- `src/ui.ts` — 두 화면 이상이 공유하는 것의 자리(`escapeHtml`·`navigate`·`el`·`ITEM_MARKS`)

### CSS 레이어 전략

`src/styles/app.css` 최상단에 `@layer seed-base, seed-components;` 선언이 있다. 레이어에
든 SEED CSS는 레이어 밖에 있는 우리 CSS에게 **특정도와 무관하게 진다** — `!important`가
필요 없다. 우리 규칙 몇 줄이면 SEED 레시피 위에 원하는 대로 얹을 수 있다는 뜻이다.

**그런데 이건 양날이다.** 네이티브 요소 리셋에 `font: inherit`처럼 shorthand 속성을 쓰면,
"레이어 밖이 항상 이긴다"는 바로 그 이유 때문에 SEED 레시피가 설정한 font-size·
font-weight·line-height까지 함께 덮어써 **도입하려던 타이포를 무력화한다**(SEED 도입
과정에서 segmented-control 컴포넌트가 실제로 이렇게 죽었다가 되살아났다). **리셋은 개별
속성으로 좁게 쓰고, `font`·`background`·`all` 같은 shorthand로 뭉뚱그리지 말 것.**

### 로그는 사실, 파생은 해석 — 이 프로젝트에서 가장 중요한 규칙

`Day` 로그(`days` 스토어)만이 원본이고, 모든 상태는 매번 로그에서 재계산한다
(`deriveFacts`·`deriveTypes`·`deriveStrategies`·`weeklyReport`…). **`Meta.derived`는
아무도 채우지 않고 아무도 읽지 않으며, 배선하지 않는 것이 설계다.** 덕분에 유창 기준이나
간격 사다리를 고치면 과거 기록 전체가 새 규칙으로 소급 재해석된다 — 마이그레이션이 필요
없는 이유가 오직 이것뿐이다. 파생값을 저장하는 코드를 새로 만들지 말 것.

같은 이유로 `derive.ts`의 `attempts` 이력을 **잘라내지 말 것**(`everMastered`가 전체 이력
위의 슬라이딩 창을 본다). 5년치 실측으로 비용이 없음이 확인돼 있다.

### 깨뜨리면 안 되는 불변식

- **재인쇄는 같은 문제를 낸다.** `print-sheet.ts`의 `if (!day || day.sheet.length === 0)`이
  `sheet`를 자동으로 새로 쓸 수 있는 유일한 게이트다. 깨지면 아이 손의 종이와 채점 화면이
  어긋나 데이터가 조용히 오염된다. 예외는 아빠가 직접 누르는 `다시 만들기` 버튼 하나뿐이고
  (채점이 있는 날은 거부), **자동 재생성을 새로 만들지 말 것**
- **빈 `sheet`가 실재한다.** 스프린트만 한 날은 `sheet: []`인 `Day`가 된다. `sheet`를 읽는
  코드를 새로 쓸 때마다 빈 sheet를 어떻게 다룰지 정할 것
- **`escapeHtml`을 거치지 않은 값이 `el()` 템플릿에 들어가면 XSS다.** `validateBackup`이
  `sheet[]`의 변형별 필드를 의도적으로 미검증하므로 타입이 `number`인 필드(`a`·`b`·`answer`)에도
  가져오기로 임의 문자열이 들어올 수 있다. 인쇄·채점 화면 템플릿에 이스케이프 없이 들어가는
  값은 우리가 만든 리터럴뿐이어야 한다
- **배포 URL(`https://watson-develop.github.io/haruchi/`)을 바꾸지 않는다.** IndexedDB가
  origin별로 격리되므로 주소가 바뀌면 딸의 기록에 접근할 수 없다. `vite.config.ts`의
  `base: '/haruchi/'`도 같은 이유로 고정이다
- **단일 출처를 복제하지 말 것.** 식 id 형식과 구구단 풀 경계는 `engine/facts.ts`
  (`factId`·`FACT_IDS`·`DAN_MIN`…), 문항 번호표(①②③…)는 `ui.ts`의 `ITEM_MARKS`,
  전략 카탈로그는 `engine/strategy.ts`의 `STRATEGY_CATALOG`, 문장제 등장인물 이름은
  `engine/word.ts`의 `WORD_NAMES`가 유일한 주인이다(`Settings.childName`·`friendNames`는
  **읽지 않는 죽은 필드**다 — 스키마 호환으로만 남아 있다). **SEED 토큰도 같은 규칙이다**
  — 색·크기 값을 우리 CSS에 직접 베끼지 말고 `var(--seed-color-fg-neutral)`처럼 토큰을
  가리킨다. 값을 복사하면 SEED가 다크모드나 브랜드 색을 바꿀 때 우리 쪽만 낡은 값으로
  남는다
- **아이 소속 화면은 부모 소속 화면으로 링크하지 않는다.** 채점 화면이 모든 문항의 정답을
  표시하므로, 아이 화면에서 그쪽으로 가는 경로가 하나라도 생기면 정답이 노출된다. 소속은
  아이(`#/`·`#/sprint`·`#/map`·`#/ebs`)와 부모(`#/parent`·`#/print`·`#/grade`·`#/report`)로
  고정이다. 확인할 때는 "← 홈"만이 아니라 **`navigate(...)` 호출 전부**를 본다 — 화면과 화면을
  잇는 버튼도, 삼항연산자 속에 숨은 목적지도 포함한다. 스프린트 결과 화면의 "월간 리포트 보기"
  버튼이 네 번 탭 만에 아이를 채점 화면으로 데려간 전례가 있다. 잠금·PIN이 없으므로
  (사용자 결정) 이 규칙이 유일한 방어선이다

### 두 엔진, 두 신호

구구단 스프린트는 **반응시간**으로(`facts.ts`: 중앙값 ≤ `fluentMs` 3회 연속 → fluent,
간격 1→3→7→14), 종이 문항은 **정오답**으로(`derive.ts`: 최근 10회 90% → 다음 유형 개방)
굴러간다. 하루 문제지는 `compose.ts`가 조립한다 — 세로셈 8 + □ 채우기 2 + 전략 2 +
문장제 2 = 14문항, 2장. 인쇄 순서 = `compose.ts`의 id 순서 = `grade.ts`의 번호 순서가
셋 다 일치해야 한다.

## 테스트

- 테스트는 `engine/`에만 둔다. **DOM·화면 단위 테스트는 하지 않는다**(설계 §12). 그래서
  화면 두 곳이 어긋나는 결함은 테스트가 못 잡는다 — 구조로(단일 출처 export) 막는다
- 생성기는 속성 기반으로 검사한다(1000회 생성해 유형 정의를 실제로 만족하는지)
- **변이 검증을 습관으로 둘 것**: 구현을 일부러 틀리게 바꿔 그 테스트만 빨개지는지 확인하고
  원복한다. 이 레포에서 반복해서 잡힌 결함이 "테스트가 자기가 검사한다고 주장하는 것을
  실제로는 검사하지 못함"이다(자기 자신을 검사하는 테스트, 항진명제 단언, 느슨한 상한)

## 문서

- `docs/superpowers/HANDOFF.md` — **작업 시작 전에 읽을 것.** 현재 상태, Phase별 결정과 그
  근거, 미해결 항목, 리뷰가 "나중에"로 분류한 후속 작업 목록
- `docs/superpowers/specs/` — 설계 전체 + Phase 3·4 설계. 동기화 백엔드 설계
  (`2026-08-06-sync-backend-design.md`)는 쉬운 말 버전(`-plain.md`)이 따로 있다 — 둘이
  어긋나면 원문이 맞다
- `docs/reference/` — 교육과정·학습지 커리큘럼·통합 사다리·EBS 강좌 매핑 조사 자료.
  `screens/ebs.ts`는 EBS 매핑 문서의 **사본**이다(문서가 원본)

## 배포

`main`에 push하면 GitHub Actions가 `prettier --check` → `npm test` → `npm run build` →
Pages 배포를 수행한다. 셋 중 하나라도 실패하면 배포되지 않는다.
