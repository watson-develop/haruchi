# sheet 충돌 자동 해소 — 격리·배너 제거 설계

2026-09-30. 상태: 적대적 리뷰 2라운드 합의(1라운드 blocker 1·major 1·minor 4, 2라운드 minor 3 반영). 선행:
`2026-09-30-retire-paper-sheet-design.md`(종이 은퇴 — 새 sheet를 만드는 코드가 없다).

## 1. 왜

종이 은퇴 뒤 `sheet` 충돌은 옛 기록끼리만 난다. 오래 오프라인이던 기기, 옛 백업 가져오기,
업데이트 전 기기가 그 경우다. 사용자 결정은 두 가지다. 충돌은 큰 이슈가 아니고, 사람이 고르는
격리·배너 장치 전체를 걷어낸다.

## 2. 새 규칙 — 서버에 먼저 앉은 sheet가 이긴다

`sheet` 충돌(`merge.ts`의 `sheetConflict` — 양쪽 모두 비어 있지 않고 구조가 다름)이 나면
**서버 것을 자동으로 채택한다.**

- 이 규칙은 서버의 `haruchi_guard_sheet` 트리거와 같은 의미다. 비어 있지 않은 서버 sheet는
  `rewrite_sheet` RPC 밖에서는 바뀌지 않으므로, 클라이언트가 이길 방법이 원래 없다.
  **서버 스키마는 바꾸지 않는다**
- 채택 내용은 지금의 「다른 기기 것」(`resolveAdoptServer`)과 같다. `sheet`·`grades`·`mood`·
  `doneAt`와 그 스탬프는 서버 것을 받는다. 로컬의 어긋난 `grades`는 함께 버려진다(다른
  종이의 채점을 붙여 두지 않는다). 나머지(`sprint` 합집합·`kind` 단조·모르는 필드)는 평소
  병합이다. 로컬에만 있던 `sprint`는 `sprint` 묶음 표식을 남겨 다음 push가 올린다
- **감수하는 손실**: 로컬 sheet와 거기 붙은 grades가 조용히 사라진다. 알림도 없다
  (사용자 결정)

## 3. 호출 지점

지금 `quarantineDate(date)`를 부르는 네 자리가 전부 자동 채택으로 바뀐다(`sync.ts`).

1. push 앞 게이트: `sheetConflict(local, server)`
2. push PATCH가 `sheet_immutable`로 거부됨(조회와 PATCH 사이에 서버 sheet가 생긴 경합)
3. pull 적용 앞 게이트: `sheetConflict(local, incoming)`
4. rewrite RPC 경로의 `sheet_rewrite_graded` 분기 — rewrite 자체가 사라지므로 없어진다

**채택은 저장본 위에서, 한 트랜잭션으로 한다(1라운드 blocker).** push·pull은 시작할 때 로컬을
한 번 읽고(`sync.ts` `pushDay`의 `getDay`, `applyRow`의 `getDay`) 네트워크를 기다린 뒤 게이트에
닿는다. 그 사이 아이가 스프린트를 끝내 `putDay(['sprint'])`를 하면 저장본에 새 세션이 생긴다. 낡은
사본으로 채택 값을 조립해 병합 없이 앉히면 그 세션이 로컬·서버 양쪽에서 영구히 사라진다. 그래서:

- 조립을 **`merge.ts`의 순수 함수 `adoptSheet(local: Stamped<Day>, server: Stamped<Day>): Stamped<Day>`**
  로 뺀다. 내용은 §2 그대로(지금 `resolveAdoptServer`의 조립 코드를 옮긴다)
- `db.ts`의 `adoptServerDay(server)`가 **같은 IDB 트랜잭션 안에서** 저장본과 그 스탬프를 읽어
  `adoptSheet`를 적용하고 쓴다(`applyPulledDay`와 같은 모양. 스토어 목록에 `outbox`는 없다).
  반환값은 앉힌 `Stamped<Day>`. **요청 콜백 안에서 `await`·`Promise`를 쓰지 않고(`adoptSheet`는
  동기 순수 함수), 조립이 던지면 `abort`한다** — `applyPulledDay`의 try/abort와 같은 모양
- 호출부는 **서버 행만 넘긴다.** 로컬 사본을 넘기지 않는다
- 반환된 값의 `sprint`가 서버와 다르면(로컬 전용 세션) `putDay(value, ['sprint'])`로 표식을
  세운다. 이 `putDay`는 저장본과 병합하므로 그사이 더 들어온 세션도 잃지 않는다

push·pull 비행 안에서 부르므로 `suspendSync()`/`resumeSync()`·`kickPush()`로 감싸지 않는다
(감싸면 자기 비행을 기다리다 멈춘다). IDB 트랜잭션만 쓰므로 교착은 없다(리뷰 확인).

채택 뒤의 흐름:

- **push**: 그 날짜는 `true`를 반환해 표식을 소비한다. 채택이 세운 sprint 표식은 key가 이번
  패스의 maxKey보다 커서 `deleteOutboxThrough`에서 살아남고, `kickPush`의 재확인 패스가 올린다
- **push의 `sheet_immutable`**(조회와 PATCH 사이 경합): 별도 재조회 코드를 만들지 않는다.
  **`continue` 한 줄** — rev 루프가 다시 GET하고 1번 게이트가 채택한다. 3회를 넘으면 기존대로
  throw되고 표식이 남아 다음 패스가 처리한다
- **pull**: `'changed'`를 반환한다(화면 재렌더)

## 4. 지우는 것

- `DeviceState.quarantine`·그래디드 표식 필드와 그 읽기·쓰기(`quarantineDate`·`clearQuarantine`·
  `markQuarantineGraded`·`isQuarantineGraded`·`gradedQuarantine` 등)
- `resolveKeepMine`(「이 기기 것」)과 공개 함수 `resolveAdoptServer`(본체는 §3의 내부 함수로 남는다)
- rewrite 전체: `putDay`의 `{ rewrite: true }` 옵션, 아웃박스 `rewrite` 필드와 OR 접기,
  `clearOutboxRewrite`, push의 rewrite RPC 분기(`rewrite_sheet` 호출)
- 부모 홈의 격리 배너(`quarantineHtml`·`wireQuarantine`·`#quarantine` 영역·알림 개수 기여)와
  그 CSS
- 부모 홈 알림 개수의 `device.quarantine.length`, `parent.css`의 `#quarantine` 주석·규칙
- `pullDays`의 `quarantined` 집합과 `applyRow`의 두 번째 인자, 격리 목록을 읽거나 쓰는
  `db.ts`·`sync.ts`의 나머지 자리(구현 시 `quarantine`을 grep해 0이 될 때까지)
- 관련 테스트(격리·rewrite·「유지」 시나리오, `db.test.ts`의 단언 약 20곳). 병합 속성 테스트는 남긴다

**남기는 것**: `adoptServerDay`(db.ts — 병합 없이 앉히는 세 번째 쓰기 경로. 자동 채택이 쓴다),
`sheetConflict`, `mergeDay`의 sheet 규칙(존재 우선 → LWW. 실행 경로에서는 게이트가 먼저
가로챈다), 서버의 트리거·`rewrite_sheet` RPC(쓰는 곳이 없어지지만 SQL 변경은 수동 배포라
건드리지 않는다. `supabase/README.md`에 "쓰이지 않음"을 적는다).

## 5. 이미 격리된 날짜 — 1회 정리

업데이트 전에 격리된 날짜가 기기에 남아 있을 수 있다. 격리 목록을 지우면 그 날짜들은 다음과
같이 된다.

- 아웃박스 표식이 남아 있으면(격리된 push는 `false`를 반환해 표식을 남긴다) 다음 push가 §3의
  1번 게이트에서 자동 채택한다
- 표식이 없으면 서버와 어긋난 채 남는다. 다음에 그 날짜 행이 pull되거나 로컬이 바뀌어 push될
  때까지다

두 번째 경우가 실제로 있다. pull에서 격리된 날짜는 표식이 없을 수 있고, 그 서버 행은 커서
뒤라 다시 내려오지 않는다. 그래서 **1회 정리**를 한다.

- 자리: `pushOutbox`의 **`seedOutbox()` 뒤, `getOutbox()` 앞** — 새 표식이 이번 패스의 대상에
  들어간다. 동기화가 꺼졌거나 미등록이면 `pushOutbox`가 그 앞에서 반환하므로 돌지 않는다
- 방법: 저장본 `DeviceState`에 옛 `quarantine` 키가 있으면, 그 날짜마다 로컬 Day가 있을 때
  `putDay(day, ['sheet'])`로 표식을 세운다("표식만 추가"하는 API가 없어 기존 API 중 가장 작은
  길이다. sheet 스탬프가 새로 찍히지만 push 게이트의 채택이 서버 스탬프로 갈아 끼우므로 해가
  없다). 그다음 `updateDeviceState`로 **`quarantine` 키를 저장본에서 삭제한다**(그래디드 표식은
  메모리 `Set`이라 저장본에 없다)
  — `normalizeDeviceState`가 `...state`로 펼치므로 타입에서만 빼면 키가 계속 남는다. **키의
  부재가 "정리 완료" 표시다.** 옛 키는 날것의 저장본에서 `'quarantine' in state`로 확인한다 —
  `normalizeDeviceState`가 `quarantine`을 `[]`로 채워 넣으면 이 판정이 영원히 참이 되므로 거기서도
  뺀다. 정리는 멱등하다(`putDay`를 끝낸 뒤 키를 지우므로 중단돼도 다시 돌면 표식만 한 번 더 선다)
- 업데이트 전에 남은 `rewrite: true` 표식(아빠가 「이 기기 것」을 눌렀지만 아직 안 올라간 것)은
  새 코드에서 **반대로** 서버 것 채택이 된다. 사용자가 받아들인 손실 범위 안이다. 저장된 표식의
  `rewrite` 필드는 읽는 곳이 없어지므로 무해하다

## 6. 불변식 변경(CLAUDE.md)

- 「`sheet` 충돌은 병합하지 않는다 — 격리하고 부모 홈 배너로 사람이 고른다. 자동 해소를
  새로 만들지 말 것」 → 「`sheet` 충돌은 서버에 먼저 앉은 쪽이 자동으로 이긴다(서버 트리거와
  같은 의미). 로컬의 어긋난 sheet·grades는 버려진다」
- 쓰기 경로 셋(`putDay`/`applyPulled*`/`adoptServerDay`)은 그대로다. `adoptServerDay`의
  호출자가 「아빠가 배너에서 고른 결과」에서 「자동 채택」으로 바뀐다
- 「pull 적용(`applyPulled*`)은 아웃박스 표식을 남기지 않는다」에 예외를 명시한다: **pull 중
  자동 채택이 로컬 전용 sprint에 세우는 표식.** 메아리가 아니다(서버가 모르는 세션이다)
- PRD §6의 격리 문장도 같은 규칙으로

## 7. 테스트

- 새 테스트(RED 먼저, `sync.test.ts`의 기존 fetch 목 패턴을 따른다):
  - push 게이트 충돌 → 로컬이 서버 sheet·grades가 되고, 로컬 전용 sprint에 표식이 남는다
  - pull 게이트 충돌 → 같은 결과, 반환 `'changed'`
  - PATCH `sheet_immutable` → 다음 루프의 GET에서 자동 채택
  - **경합(blocker 회귀망)**: 채택 직전에 저장본에 새 sprint 세션이 들어와 있으면(호출부가 가진
    사본에는 없음) 채택 뒤에도 그 세션이 남고 표식이 선다
  - `adoptSheet` 순수 함수 단위 테스트(`merge.test.ts`): sheet·grades·mood·doneAt와 그 스탬프는
    서버, sprint는 합집합
  - 옛 격리 목록이 있는 기기 → 1회 정리 후 목록이 비고, 그 날짜가 채택된다
- 삭제: 격리·rewrite·「유지」·그래디드 테스트
- 변이 검증: 자동 채택 호출을 빼면 새 테스트만 빨개지는지

## 8. 배포

main 직접, 커밋 하나. 업데이트 전 기기가 올리는 rewrite 표식(`rewrite_sheet` RPC)은 서버가
그대로 받는다. RPC를 지우지 않으므로 옛 기기는 계속 동작한다.

**옛 기기와 섞여 도는 동안 핑퐁이 없다(리뷰 확인).** 옛 기기가 `rewrite_sheet`로 X를 올리면 새
기기는 다음 pull에서 X를 채택하고, 채택 뒤 로컬 sheet가 서버와 같으므로 sheet를 도로 올리지
않는다. 서버에 채점이 있으면 RPC가 거부해(`sheet_rewrite_graded`) 옛 기기만 격리 상태로 남는다
— 그 기기를 업데이트하면 §5 정리가 푼다.
