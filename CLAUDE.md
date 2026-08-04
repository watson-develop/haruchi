# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

초등 2학년 산수 연습 도구. 매일 A4 문제지를 인쇄해 손으로 풀고, 아이패드(PWA)에서 채점한다.
서버가 없고 데이터는 아이패드의 IndexedDB에만 있다.

## 환경

Node는 mise에만 있고 기본 PATH에 없다. 모든 npm 명령 전에:

```bash
export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH"
```

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

## 아키텍처

프레임워크 없음(바닐라 DOM), 런타임 의존성 0개, 해시 라우팅. `src/main.ts`가 해시를 보고
화면 모듈을 동적 import한다 — 화면마다 `#app`을 `replaceChildren`으로 통째로 갈아 끼우고
상태는 매번 IndexedDB에서 다시 읽으므로, 같은 해시로 다시 라우팅해도 안전하다.

- `src/engine/` — **앱의 본체이고 전부 순수 함수다.** DOM·저장소를 모른다. 테스트는 여기에만 있다
- `src/screens/` — 렌더 + 이벤트만. 화면끼리 import하지 않는다(형제 관계)
- `src/data/db.ts` — IndexedDB 래퍼. 앱의 나머지는 IndexedDB라는 사실을 몰라야 한다
- `src/ui.ts` — 두 화면 이상이 공유하는 것의 자리(`escapeHtml`·`navigate`·`el`·`ITEM_MARKS`)

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
  **읽지 않는 죽은 필드**다 — 스키마 호환으로만 남아 있다)

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
- `docs/superpowers/specs/` — 설계 전체 + Phase 3·4 설계
- `docs/reference/` — 교육과정·학습지 커리큘럼·통합 사다리·EBS 강좌 매핑 조사 자료.
  `screens/ebs.ts`는 EBS 매핑 문서의 **사본**이다(문서가 원본)

## 배포

`main`에 push하면 GitHub Actions가 `prettier --check` → `npm test` → `npm run build` →
Pages 배포를 수행한다. 셋 중 하나라도 실패하면 배포되지 않는다.
