# 기기 상한 5대와 관리 화면 — 설계

**결정(사용자, 2026-08-13):** 등록 기기는 활성 5대가 최대다. 5대를 넘겨야 하면 기존
기기를 해제하고 들어온다 — 해제·목록은 앱 안의 관리 화면이 담당한다(SQL 불필요).
해제는 `devices` **행 삭제**다(사용자 선택 — 그 기기가 새 초대 코드로 재등록할 수
있어야 5대 로테이션이 앱 안에서 완결된다).

전제가 되는 사실(2C까지의 코드): `claim_invite`는 이미 `devices`에 있는 기기 id를
거부한다. `haruchi_device()`는 매 요청마다 전 기기를 bcrypt로 대조하므로(행마다
`crypt` 1회, 인덱스 불가) 기기 수가 곧 모든 요청의 인증 비용이다 — **5라는 숫자는
UX 취향이 아니라 이 구조의 성능 예산이다**(`anon`에 `statement_timeout=3s`).

## §1 상한 — 권위는 서버, 숫자의 단일 출처는 schema.sql

활성 기기 = `revoked_at is null`인 행. SQL로 `revoked_at`만 마킹된 기기(README
7단계의 폐기)는 자리를 차지하지 않는다.

- **`claim_invite`가 권위다.** 활성 5대면
  `{"error": "기기가 5대라 더 들어올 수 없어요 — 기존 기기의 관리 화면에서 한 대를 해제해 주세요"}`.
  검사 위치는 **코드 검증 뒤 · `used_at` 마킹 앞**:
  - 코드를 맞혀야 상한 상태가 보인다 — 익명 폴링으로 "가족이 가득 찼나"를 볼 수 없다
  - 초대가 소모되지 않는다 — 한 대 해제한 뒤 **같은 코드로** 재시도가 통한다(10분 내)
  - 동시성: 상한 검사끼리의 경쟁은 없다. 활성 초대가 최대 1이고 claim은 그 행을
    `for update`로 잡으므로, 동시에 성공할 수 있는 claim은 언제나 1개다 — 5대 검사
    두 개가 나란히 통과해 6대가 되는 창 자체가 없다
- **`issue_invite`도 5대면 발급을 거부한다** — 아빠가 발급 시점에, 발급하는 기기
  화면에서 바로 안다. 코드 6자리를 옮겨 적고 나서야 실패를 보는 것보다 낫다.
  이를 위해 **반환을 jsonb로 바꾼다**: `{"code": "123456"}` 또는 `{"error": "..."}`.
  `claim_invite`와 같은 계약(사용자 수준 실패 = jsonb, 예외 = 미등록 같은 오용)이
  되고, 2C가 남긴 사마귀(미등록 발급 실패가 PostgREST JSON 덩어리로 뜨던 것)도
  같이 사라진다
- 상수 5는 `schema.sql`에만 산다. 클라이언트는 숫자를 모른다 — 오류 문구가 "5대"를
  담아 내려오고 화면은 그것을 그대로 보여 준다. 바꾸는 날 고칠 곳이 한 곳이다

**반환 타입 변경은 `create or replace`가 못 한다.** `drop function if exists
issue_invite()`를 앞에 둔다 — Task 1 리뷰가 파킹해 둔 M4(새 RPC에 drop 부재 →
인자·타입을 바꾸는 날 오버로드 함정)가 여기서 실제가 됐다. `claim_invite`는 시그니처
불변이라 drop이 필요 없지만 **같은 이유로 둘 다 drop을 앞에 두어 멱등 규약을
맞춘다**(파일 머리의 계약: 몇 번을 다시 돌려도 된다).

## §2 RPC 둘 신설 — `list_devices`·`remove_device`

`devices`에는 계속 **RLS 정책이 없다**(대시보드·RPC 전용 — 정책을 열면 anon 키로
기기 목록·key_hash가 노출된다). 접근은 `security definer` RPC만, 여섯 형제와 같은
`set search_path = public, extensions, pg_temp` 고정.

- **`list_devices() returns jsonb`** — `haruchi_device()` null이면 raise(미등록).
  활성·폐기 구분 없이 전 행을 `created_at` 순으로:
  `[{"id","label","created_at","last_seen_at","revoked_at"}]`. `key_hash`는 절대
  싣지 않는다. "이 기기" 표시는 클라이언트가 자기 `deviceId`와 대조해 그린다 —
  서버는 호출자가 누군지 이미 알지만(=`haruchi_device()`), 행에 표식을 심으면
  같은 응답이 기기마다 달라져 캐시·디버깅이 흐려진다
- **`remove_device(p_id text) returns jsonb`** — `haruchi_device()` null이면 raise.
  - `p_id = haruchi_device()`면 `{"error": "지금 쓰는 기기는 여기서 해제할 수 없어요"}`
    — **자기 자신 삭제 금지**가 "활성 기기 항상 1대 이상"을 만든다. 이 보장이 없으면
    마지막 기기가 자멸해 전 기기 폐기 상태가 되고, 복구가 SQL(README 8절)로 돌아간다
  - `delete from devices where id = p_id` (**where 필수** — safeupdate). 0행이면
    `{"error": "이미 해제된 기기예요"}`
  - 성공 시 `write_log (device, 'device:'||p_id, 'device-remove')` 기록 후 `{"ok": true}`
  - 해제된 기기의 진행 중 push·pull은 다음 요청부터 RLS에서 빈 응답을 받는다 —
    기존 「폐기된 키」와 같은 경로로 `authFailed` 배너에 수렴한다(§4)

## §3 관리 화면 `#/manage` 신설 — 리포트에서 「데이터 관리」를 빼 온다

사용자 결정: 관리를 리포트 안의 절이 아니라 **별도 메뉴**로 뺀다.

- **이동**: 리포트의 「데이터 관리」 절 전체(내보내기·가져오기·모든 기록 지우기·
  서버 백업에서 되돌리기)가 `src/screens/manage.ts`로 옮겨 간다. 리포트에는 진입
  버튼 하나(「데이터·기기 관리」)만 남는다. 도우미(`snapshotNotice`·`dayCount` 등)는
  데이터 관리와 함께 옮긴다 — **화면끼리 import하지 않는다**(형제 규칙). 리포트와
  관리가 공유하게 되는 것이 생기면 그때 `ui.ts`로 올린다
- **추가**: 「연결된 기기」 절. `list_devices()` 결과를 라벨·마지막 접속(상대 시각)·
  「이 기기」 표식과 함께 그리고, 자기 자신이 아닌 행에 「연결 해제」 버튼. 해제는
  확인 다이얼로그(`confirmDialog` 규약) 뒤에만. 서버가 만든 문자열(label 포함)은
  **`textContent`로만** 넣는다 — label은 `claim_invite`에 임의 문자열로 들어올 수
  있는 값이다(XSS 경계)
- **게이트·소속**: `GATED_HASHES`에 `#/manage` 추가 — PIN 게이트·wake 재게이트가
  라우터에서 자동으로 걸린다(2B 구조 그대로). 소속은 부모다. 새 `navigate` 목적지는
  report→manage, manage→report 둘뿐 — 아이 화면에서 오는 경로를 만들지 않는다
- **동기화 꺼짐**(미설정·미등록)이면 「연결된 기기」 절을 그리지 않는다 — 데이터
  관리(로컬 작업)는 그대로 동작한다. 미등록 기기에서 `list_devices`를 부르지 않는다

## §4 「다시 연결하기」 — 해제된 기기의 복귀 경로를 앱 안으로

해제된 기기는 서버 행이 없는데 **로컬 `deviceKey`가 남아 「등록됨」으로 보인다** —
코드 입력칸이 그려지지 않아, 지금은 DevTools로 `deviceKey`를 지워야 재등록할 수
있다(README 8절). 5대 로테이션을 앱 안에서 완결하려면 이 구멍을 닫아야 한다.

- 부모 홈의 `authFailed` 상태줄에 **「다시 연결하기」 버튼**을 단다. 누르면 확인
  다이얼로그(「이 기기의 연결 정보를 지우고 처음부터 다시 연결합니다」) 뒤
  `deviceKey: null`로 지우고 재렌더 → 코드 입력칸이 돌아온다. 키는 이미 서버가
  거부한 값이라 지워도 잃는 것이 없다. 커서·시딩 리셋은 건드리지 않는다 —
  claim 성공이 어차피 셋 다 비운다(2C `claimInvite`)
- 상태줄 문구는 「기기 키가 거부됐어요 — 아래에서 다시 연결할 수 있어요」로 바꾼다
  (지금 문구는 SQL 절차를 가리킨다 — 버튼이 생기면 거짓말이 된다).
  `sync-status.ts`의 문자열과 테스트를 함께 고친다
- SQL로 `revoked_at`만 마킹된 기기(의도적 차단)가 이 버튼을 눌러도: claim이
  「이미 등록된 기기예요」로 거부한다 — 차단은 유지되고, 안내 문구가 README를
  가리킨다. **차단을 우회하는 경로가 아니다**
- README 8절의 「같은 기기 재등록」 DevTools 절차는 이 버튼으로 대체·간소화한다

## §5 혼재 기간 (스키마 먼저 → 앱 배포)

순서는 2A·2B·2C와 같다: **스키마 먼저(SQL Editor), 앱 배포는 그 직후.**

- `issue_invite`의 반환이 text → jsonb로 바뀌므로, 혼재 기간(새 스키마 + 옛 앱)에
  「새 기기 추가」를 누르면 옛 앱이 jsonb를 문자열로 읽어 **화면에
  `[object Object]`류가 뜬다.** 깨지는 것은 그 표시 하나이고 서버 상태는 오염되지
  않는다(발급 자체는 성공 — 새 코드가 유효하게 존재한다). 창은 배포 몇 분이고,
  이 창에서 기기 등록을 하지 않으면 된다 — README 적용 절차에 한 줄로 명시
- `claim_invite`·기존 경로는 시그니처 불변이라 혼재 무해. `list_devices`·
  `remove_device`는 옛 앱이 부르지 않는다

## 스키마 변경 요약 (`supabase/schema.sql` — 멱등 유지)

- `issue_invite`: `drop function if exists` + jsonb 반환 재작성, 활성 5대 검사
- `claim_invite`: `drop function if exists` 추가(규약 통일), 코드 검증 뒤 활성 5대
  검사(`used_at` 마킹 앞)
- `list_devices()`·`remove_device(p_id)` 신설 — `security definer` +
  `search_path = public, extensions, pg_temp`, write_log 기록(remove)
- 모든 신규 `update`/`delete`에 where(safeupdate) — 이번 신규 DML은
  `remove_device`의 delete 1건

## 클라이언트 변경 요약

- `sync.ts`: `issueInvite` 반환을 `{ok: true, code} | {ok: false, reason}`으로
  (`claimInvite`와 같은 유니온), `listDevices()`·`removeDevice(id)` 신설 — 전부
  `req()` 경유, `configured()` 가드
- `screens/manage.ts` 신설: 데이터 관리 절 이동 + 연결된 기기 절
- `screens/report.ts`: 데이터 관리 절 제거, 진입 버튼 추가
- `screens/home-parent.ts`: 발급 실패 분기 수정(`{ok:false}` → `#invite-zone`에
  reason을 textContent로), `authFailed` 상태줄에 「다시 연결하기」
- `main.ts`: `GATED_HASHES`·라우팅 표에 `#/manage`
- `engine/sync-status.ts`: authFailed 문구 교체(+테스트)
- `supabase/README.md`: 5대 상한·관리 화면·재연결 버튼 반영, 8절 간소화

## 불변식 확인 (CLAUDE.md 대조)

- **아이/부모 소속**: `#/manage`는 부모 소속, 새 navigate는 report↔manage뿐.
  PIN 게이트 대상에 추가
- **XSS 경계**: label·서버 오류 문구는 전부 textContent. `el()` 템플릿에 넣지 않는다
- **재인쇄 동일성·derived 비배선·putDay 선언 계약**: 이 설계는 `days`·`meta`를
  건드리지 않는다 — 무관
- **claim_invite의 jsonb 계약**(2C): 유지·확장. 상한 거부도 jsonb다 — raise면
  `fail_count`류 상태 변화가 롤백된다는 같은 이유가 이 함수 전체를 계속 지배한다
- **단일 출처**: 상한 상수는 schema.sql 한 곳. 병합·동기화 의미는 건드리지 않는다

## 감수한 것

- 상한 5는 하드코딩 — 바꾸려면 SQL 재적용(현실적으로 가족 규모에서 바뀔 일이 없다)
- 해제된 기기가 배너를 보기까지 최대 한 pull·push 주기의 지연(즉시 통지는 서버 푸시
  채널이 없어 불가 — 다음 요청에서 안다)
- `remove_device`는 등록 기기 전부가 부를 수 있다 — 가족 위협 모델(PIN 게이트 뒤
  화면에서만 노출)에서 수용. 기기별 권한 등급은 만들지 않는다
- 혼재 기간의 `[object Object]` 표시(§5) — 창이 분 단위이고 상태 오염 없음
- `list_devices`가 폐기(마킹) 행도 돌려준다 — 화면이 「차단됨」으로 구분 표기.
  목록에서 숨기면 5대 계산과 화면이 어긋나 보인다… 반대로 폐기 행은 자리를 차지하지
  않으므로(활성만 계산) 화면에 「자리 차지 안 함」이 드러나야 한다

## 검증 계획

- 스키마: 일회용 postgres:17(운영과 같은 pgcrypto=`extensions` 배치 + 호출자
  search_path에서 extensions 제거) — 멱등 3회 / 상한: 4→5대 성공, 5대에서 claim·
  issue 거부, 해제 후 같은 코드 재claim 성공 / remove: 자기 자신 거부·타 기기
  삭제·0행·write_log / list: key_hash 부재 확인
- 클라이언트: 기존 테스트 회귀 + `sync-status.ts` 문구 테스트 갱신. 화면 테스트는
  두지 않는다(설계 §12) — 수동 스모크 목록을 계획서에
- 상한 검사 위치의 변이 검증: 검사를 `used_at` 마킹 **뒤**로 옮기면 "해제 후 같은
  코드 재시도" 시나리오가 빨개져야 한다
