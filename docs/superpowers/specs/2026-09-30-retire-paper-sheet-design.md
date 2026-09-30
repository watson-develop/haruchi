# 종이 문제지·채점 은퇴 — 설계

2026-09-30. 상태: 적대적 리뷰 2라운드 반영(합의).

## 1. 왜

종이 연습을 루틴에서 뺐다(사용자 결정). 앱은 구구단 스프린트·지도·지니·EBS 서가·리포트·
관리만 남는다. 문제지 생성·인쇄·채점 화면과 그것만을 위해 존재하던 엔진은 죽은 코드다.

**기록은 지우지 않는다**(사용자 결정). `Day.sheet`·`Day.grades`는 원본 로그이고, 백업·동기화가
그 모양을 계속 나른다. 리포트가 과거 종이 성적을 보여주지도 않는다 — 화면에서 사라진다.

## 2. 결정 요약

| 축                                      | 결정                                                  |
| --------------------------------------- | ----------------------------------------------------- |
| 과거 `sheet`·`grades` 데이터            | 보존. 스키마·백업·병합·서버 그대로                    |
| 리포트의 종이 절(유형 정답률·배운 방법) | 제거                                                  |
| `✅ N일 완료`(채점∧스프린트)            | 제거 — 🔥 연속만 남는다                               |
| 부모 홈 「오늘」 칸(인쇄·채점 두 단계)  | 칸째 제거 — 대체 기능을 만들지 않는다                 |
| EBS 「문제지에 나와요」 배지            | 제거. 세로셈 주제 카드와 강좌 링크는 유지             |
| `docs/semester2-routine.md` 종이 칸     | 제거                                                  |
| 종이 엔진 코드                          | 삭제(git에 남는다 — 되살릴 일이 생기면 거기서 꺼낸다) |

## 3. 삭제

**화면·라우트**

- `src/screens/print-sheet.ts`, `src/screens/grade.ts` 삭제
- `src/main.ts`: `#/print`·`#/grade` 렌더 분기, `grade.ts`를 동적 import하는 **나머지 두 곳**
  (깨어남 재게이트 ~72행, `onPullApplied` ~264행)과 "미커밋 입력을 쥔 화면 둘" 예외 주석(~249),
  `PARENT_HASHES`·`GATED_HASHES`의 두 항목 제거. 옛 해시로 들어오면 else 분기(아이 홈)로
  떨어진다 — 부모 해시가 아니므로 아이 기기 차단과도 충돌하지 않는다. 주석 속 `#/grade`
  예시(~61·136·141·149·199)와 `print-sheet.ts` 언급(~149)은 `#/report`·`#/manage`로 고쳐 쓴다.
  `ui.ts` ~394의 "#/grade의 O/X 토글" 주석도 같이
- `src/styles/print.css`: **파일과 `index.html` 링크는 남는다**(일요일 리포트 인쇄가 `@page`·
  인쇄용 `body`/`#app`·`.overlay` 숨김에 기댄다). 지우는 것: `.sheet*`·`.v*`·`.inv*`·`.strat*`·
  `.word*`, `.sheet + .sheet`, `body:has(.sheet)`, 문제지용 `width<480` 블록
- 죽은 화면 CSS: `parent.css`의 `.today`·`.todo*`, `app.css`의 `.grade-row`·`.mark`·`.moods`·
  `.mood`·`.ebs-active`. `.device-row` 주석이 `.grade-row`를 골격 근거로 들므로 근거 문장을
  자립하게 고쳐 쓴다
- `src/ui.ts`: `ITEM_MARKS` 삭제. 다른 주석이 "ITEM_MARKS와 같은 이유로"를 근거로 쓰고
  있으면 근거 문장을 "화면끼리 import하지 않으므로 공유물은 ui.ts에 둔다"로 바꾼다

**엔진**(각 `.test.ts` 포함)

- `compose.ts`·`vertical.ts`·`inverse.ts`·`word.ts`·`strategy.ts`·`derive.ts` 삭제
- `simulation.test.ts`: 「다일 시뮬레이션」(종이) describe 삭제, 「스프린트 다중일
  시뮬레이션」은 유지. 종이 전용 헬퍼·import도 함께 뺀다
- `report.ts`: `completedCount`·`pendingGradeDate`·`ungradedSheetCount` 삭제,
  `WeeklyReport`에서 `completed`·`types`·`strategies`류·`strategiesLearned` 제거.
  `report.test.ts`의 해당 케이스 삭제
- `ebs.ts`: `activeVerticalTags`·`ebsBadge`, `EbsTopic.tags` 필드와 각 주제의 `tags` 값 삭제.
  `ebs.test.ts`의 tags·배지 케이스 삭제(`VERTICAL_ORDER` import가 사라진다)

## 4. 화면 변경

- **부모 홈**(`home-parent.ts`): 「오늘」 `h2`와 `.today` 블록, `stepHtml`, `printed`·`graded`·
  `printStep`·`gradeStep`·`sheetCounts`·`sheetLine`·`verticalCount`, 미채점 알림(`pending`)과
  그 개수 기여, `#print`·`#grade`·`#pending` 리스너 제거. 헤더 메타는 `날짜 · 🔥 N일 연속`.
  리포트 버튼의 부제 「일요일 채점 뒤엔 자동으로 열려요」는 거짓이 되므로(자동 전환의 주인이
  `grade.ts`였다) 「주간·월간」으로 줄인다. 문서 주석의 ✅ 근거(~146)·알림 개수 주석의
  "미채점"(~53)도 정리. 격리 배너는 **유지**(§5)하되 문구의 "어느 것으로 채점할지"는
  「어느 기록을 남길지」로 바꾼다
- **리포트**(`report.ts` 화면): `✅ 완료`·`배운 방법` 스탯, 유형별 정답률 목록과 표본 부족 줄,
  `TAG_LABELS`, 공유 텍스트의 해당 줄 제거
- **관리**(`manage.ts`): 초기화 확인문의 미채점 경고 줄 제거
- **EBS 서가**(`screens/ebs.ts`): 배지 분기와 `deriveTypes` 호출 제거. 🎉 플래그는 유지
- **아이 홈**·`streak.ts`: 동작 변화 없음. `✅ N일 완료`·`completedCount`를 가리키는 주석
  (`home-child.ts` ~15·24, `streak.ts` ~20-22)만 정리
- `rewrite` 경로의 호출자 서술: 「다시 만들기」·`print-sheet`·`grade.ts`를 호출자/근거로 드는
  곳을 격리 배너 「이 기기 것」이 호출자인 것으로 고쳐 쓴다(동작은 유지). 대상 — `sync.ts`
  215·715·719·725·753·802·810 주석, **`sync.ts:815` 실행 코드의 오류 라벨
  `'sheet 다시 만들기'` → `'sheet 덮어쓰기(격리 유지)'`**, `db.ts` ~226, `outbox.ts:11`,
  `main.ts` 143·254
- `grade.ts`를 근거로 드는 남는 파일: `sprint.ts` 53·403, `merge.test.ts:638`, `db.test.ts:804` —
  참조를 빼거나 "옛 채점 화면"으로 과거형 서술. `app.css:347`은 `.mark` 블록과 함께 사라진다.
  `print.css` 120–131 주석 블록은 문제지 규칙과 함께 지운다
- 격리 배너의 `graded` 문구 「다른 기기가 이미 채점까지 마쳤어요」는 **유지** — 과거 데이터에
  대해 여전히 참이다

## 5. 그대로 두는 것과 그 이유

- `types.ts`의 `SheetItem`·`VerticalTag`·`StrategyId`·`Day.sheet`·`Day.grades`·`TypeState` 등:
  보존된 로그를 읽고 검증하는 데 필요하다. **타입은 하나도 지우지 않는다** — 소비자가 0이
  되는 것(`InverseTag`·`WordTag`·`StrategyStep`·`TypeState`·`StrategyState`·`*Item` 등)도
  `Day.sheet`·`Derived`가 내부에서 참조한다. 고아 export `weekdayOf`(dates.ts)·`PullResult`
  (sync.ts)도 무해하므로 둔다
- `validateBackup`·`backupPayload`·`merge.ts`의 `sheet`·`grades` 묶음·`sync.ts`·`db.ts`: 옛 기록이
  기기 간에 계속 오가야 한다. 새 `sheet`가 생기지 않으므로 묶음은 사실상 동결되지만,
  계약을 좁히는 변경은 서버·다른 기기와의 호환 위험만 만든다
- **격리 배너**: 이미 격리된 날이 남아 있을 수 있고, 새 기기 연결 시 옛 기록끼리 충돌할 수도
  있다. 해소 경로를 없애면 그날이 영구히 격리된다
- `Settings`의 종이 설정(`inverseCount` 등): `childName`처럼 읽지 않는 죽은 필드로 남는다
- Supabase 스키마: 변경 없음
- "아이 화면 → 부모 화면 링크 금지" 불변식: 채점 화면이 사라져도 리포트·관리가 남으므로 유지

## 6. 문서

- **PRD**: §1(매일 루틴 문장·존재 이유 중 종이 부분), §2(범위에서 종이 문제지·채점 제거, 비범위에 "종이 문제지
  (2026-09-30 은퇴)" 추가), §3 표(`#/print`·`#/grade` 제거)와 표 위·아래의 근거 문장("채점 화면이 모든 정답을
  표시하므로" → 리포트 집계·관리의 파괴적 작업이 부모 전용), §4(제목 「두 엔진, 두 신호」 →
  스프린트 하나, 종이 문항·하루 문제지·교차 제약 항목 제거), §5(`sheet: []`는 "과거 로그와
  스프린트만 한 날"로), §6(PIN 대상에서
  `#/grade` 제거), §7 인쇄 정책 절 삭제(절 번호 당김), §9 색인(문제지 조립·유형 개방·
  전략 카탈로그·문장제 등장인물·문항 번호표 행 제거)
- **CLAUDE.md**: 5행 소개(인쇄·채점), 재인쇄 불변식·빈 sheet 항목을 "보존 로그" 한 줄로,
  `derive.ts` attempts 잘라내지 말 것(모듈 삭제 — 제거), 두 엔진 절을 스프린트 하나로,
  단일 출처 목록과 ui.ts 역할 목록에서 `ITEM_MARKS`·`STRATEGY_CATALOG`·`WORD_NAMES` 제거
  (`childName`·`friendNames` 죽은 필드 주석은 `WORD_NAMES` 대신 "종이 은퇴로 읽는 곳 없음"),
  머지 예외의 불변식 목록, 화면 소속 목록과 그 근거 문장("채점 화면이 정답을 표시하므로"),
  XSS 불변식의 "인쇄·채점 화면 템플릿" → 리포트 등 남은 화면(보존된 `sheet[]`가 가져오기로
  들어오는 경로는 여전하다)
- `docs/design/ux-principles.md`: PRD가 UX 정책 주인으로 가리키므로 고친다. 첫 원칙 「종이가
  본체」를 은퇴 사실로 바꾸고, 종이·채점 사례(재인쇄 동일성·번호표·정답 병기·일요일 자동
  전환·미채점 배너 등)는 문서 머리에 "2026-09-30 종이 은퇴 — 종이·채점 사례는 기록으로
  남긴다" 한 줄을 두고 본문은 그대로 둔다(원칙의 근거 사례라 지우면 원칙이 빈다)
- `docs/semester2-routine.md`: 표의 종이 칸 제거
- HANDOFF: 은퇴 기록 한 항목
- 과거 스펙들은 시점 기록이라 고치지 않는다

## 7. 검증

- `npm run build`(tsc가 남은 참조를 잡는다), `npm test`, `npx prettier --check .`
- `grep -rn "#/print\|#/grade" src` → 0건
- `grep -rnE "from '\./(compose|derive|strategy|word|vertical|inverse)'|engine/(compose|derive|strategy|word|vertical|inverse)'" src`
  → 0건(삭제 모듈 import. 문자열 리터럴 `'vertical'` 등은 `backup.ts`·`types.ts`에 정당하게 남는다)
- `grep -rn "ITEM_MARKS\|print-sheet\|grade\.ts\|다시 만들기" src` → 0건(주석 잔재 포함)
- dev 서버에서 부모 홈·리포트·EBS·관리를 열어 빈 칸·깨진 레이아웃이 없는지 눈으로 확인.
  `#/print`·`#/grade` 직접 입력 시 아이 홈으로 가는지 확인
- 변이 검증 대상 없음 — 새 로직이 없는 순수 삭제다

## 8. 배포 경로

여러 파일을 지우는 한 커밋이지만 중간 상태가 없다(빌드가 깨진 채 배포될 수 없다 — CI가
막는다). 단독 배포 가능하므로 **main 직접**, 커밋 하나. 스펙 커밋은 별도로 먼저 한다.
