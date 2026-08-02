# 하루치 — 인수인계

마지막 갱신: 2026-08-03

초등 2학년 딸의 산수 연습을 위한 개인용 도구. 매일 종이를 인쇄해 손으로 풀고, 아이패드에서 채점한다. 서버 없는 정적 PWA이고 데이터는 아이패드의 IndexedDB에만 있다.

## 지금 상태

|         |                                                                  |
| ------- | ---------------------------------------------------------------- |
| 브랜치  | `main` (원격 없음 — 아직 발행 전)                                |
| 테스트  | 81개 통과 (8파일)                                                |
| 검사    | `tsc --noEmit` · `npm run build` · `prettier --check` 모두 clean |
| Phase 1 | **완료.** 12개 태스크 + 최종 리뷰 + 수정 웨이브까지 끝           |
| Phase 2 | **계획서 완료, 구현 시작 전**                                    |

## 먼저 읽을 것

1. `docs/superpowers/specs/2026-08-02-haruchi-design.md` — 설계 전체
2. `docs/superpowers/plans/2026-08-03-phase2-multiplication-sprint.md` — 다음에 할 일
3. `docs/superpowers/plans/2026-08-02-phase1-paper-routine.md` — 끝난 일 (리뷰에서 발견된 결함이 본문에 반영돼 있음)

## Phase 1이 만든 것

매일 A4 1장(세로셈 8 + □ 채우기 2)을 인쇄해 풀고, 아빠가 탭 몇 번으로 채점하면 다음날 문제 구성이 조정된다. 홈 화면에 추가하면 오프라인으로 돈다.

**지켜야 할 두 불변식** — 코드 곳곳이 여기에 기대고 있다.

- **재인쇄는 같은 문제를 낸다.** `src/screens/print-sheet.ts`의 `if (!day || day.sheet.length === 0)`이 `sheet`를 쓸 수 있는 유일한 게이트다. 이게 깨지면 아이 손의 종이와 채점 화면이 어긋나 데이터가 조용히 오염된다
- **`derived`는 버릴 수 있는 캐시다.** 실제로 `Meta.derived`를 읽는 코드가 하나도 없고, 매번 `days` 로그에서 재계산한다. 덕분에 판정 규칙을 바꾸면 과거 전체가 새 규칙으로 재해석된다 — 마이그레이션이 필요 없다

## Phase 2로 할 일

구구단 스프린트(아이패드 3분, 반응시간으로 유창도 판정)와 81칸 정복 지도. 계획서에 7개 태스크·34단계가 완성된 코드와 함께 들어 있다.

실행은 `superpowers:subagent-driven-development`로 — Phase 1을 그렇게 했고, 리뷰가 실제 결함을 여럿 잡았다.

## 미해결 항목

- **발행 안 함.** 공개 레포 생성·push·Pages Source 설정이 남았다. 배포처는 **GitHub Pages로 확정**(사용자 결정), 워크플로는 이미 작성·리뷰 완료. `origin`은 `https://<계정>.github.io/haruchi/`가 되며 **한 번 정하면 바꾸지 않는다** (IndexedDB가 origin별로 격리되므로 주소를 바꾸면 딸의 기록에 접근할 수 없다)
- **CI의 `prettier --check`가 `docs/`까지 검사한다.** `.prettierignore`가 없으므로 문서를 커밋하기 전 `npm run format`을 돌릴 것. 안 그러면 마크다운 포맷 흠 하나로 앱 배포가 막힌다
- **확장 이음새 문서 미작성.** 조사 2건이 모두 끝났으므로 바로 쓸 수 있다 — 아래 참고
- `DAN_ORDER`(단 도입 순서)의 출처가 미확인이다. 계획서 해당 위치에 사유가 적혀 있다

## 커리큘럼 조사 (완료, 공시 출처 기반)

- `docs/reference/korean-elementary-math-curriculum.md` — 국가 교육과정. **2026학년도 현재 초등 1~6학년 전 학년이 2022 개정(교육부 고시 제2022-33호) 적용**임을 고시 부칙 원문으로 확인. 수와 연산 성취기준 42개 전문(`[2수01-01]`~~`[6수01-15]`), 1-1~~6-2 전 학기 단원 구성(실물 검정교과서 PDF·교육청 교차검증), 연산별 도입·확장 진행표
- `docs/reference/korean-math-programs-curricula.md` — EBS·소마·기탄·구몬·눈높이. EBS 만점왕 연산이 학기 단위로 교과서와 대응하는 것까지 확인. 구몬은 학년 대응표를 **정책적으로 비공개**

두 문서 모두 확인하지 못한 항목을 "확인 못 함 / 미공개"로 명시해 두었다. 그 목록 자체가 결과다 — 빈칸을 추측으로 채우지 말 것.

## 3~6학년 확장에서 깨지는 지점 (문서화 예정)

- **나눗셈이 첫 번째 벽이고, 시점이 확정됐다.** 개념 도입 **3-1**, 나머지 있는 나눗셈·(두 자리)÷(한 자리) **3-2**, (세 자리)÷(두 자리) **4-1**. `vertical.ts`의 `Spec`은 `op: '+' | '−'`로 닫혀 있고 판정 술어가 `carryCount`/`borrowCount`다. 세로 나눗셈은 레이아웃도 완전히 다르다. 태그 추가가 아니라 새 엔진이다
- **분수·소수는 `answer: number`를 깨뜨린다.** 다만 `answer`는 채점 화면 표시 전용이고 `derive`가 쓰지 않아 파급은 제한적이다
- **`print-sheet.ts`는 문항 종류별 분기 구조**라 새 종류마다 손대야 한다
- 유형이 20개를 넘으면 하루 8문항으로는 회전 전략이 필요해진다
- 마이그레이션은 `Day`에 **필수** 필드가 생길 때 처음 필요해진다. `schemaVersion`/`algoVersion`은 쓰이기만 하고 읽는 곳이 없다

## Phase 1에서 리뷰가 반복해서 잡은 실패 패턴

Phase 2 계획서의 Global Constraints에도 넣어뒀다. 테스트를 쓸 때마다 확인할 것.

1. **자기 자신을 검사하는 테스트** — 생성기가 이미 술어로 거른 값을 같은 술어로 단언하면 무엇을 바꿔도 통과한다
2. **느슨한 상한** — 실측 16에 상한 150이면 완전 정지만 잡힌다
3. **실패할 수 없는 단언** — `expect(x).toBeTruthy()`
4. **화면의 갇힘 경로** — 첫 `await`가 `try` 밖이면 실패 시 `#app`이 빈 채로 남는다. `showError`는 `document.body`에만 붙는다

## 환경

- Node는 mise에만 있다: `export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH"`
- git identity 미설정: `git -c user.name="이성호" -c user.email="watson@daangnpay.com" commit …`
- 개발 서버는 `http://localhost:5173/haruchi/` — 루트는 302다
