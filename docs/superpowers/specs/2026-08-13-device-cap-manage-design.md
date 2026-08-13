# 기기 상한 5대와 관리 화면 — 설계

**결정(사용자, 2026-08-13):** 등록 기기는 활성 5대가 최대다. 5대를 넘겨야 하면 기존
기기를 해제하고 들어온다 — 해제·목록은 앱 안의 관리 화면이 담당한다(SQL 불필요).
해제는 `devices` **행 삭제**다(사용자 선택 — 그 기기가 새 초대 코드로 재등록할 수
있어야 5대 로테이션이 앱 안에서 완결된다). `#/report`의 PIN 게이트는 **유지**한다
(사용자 결정 — 집계도 아이에게 안 보이는 것이 맞다).

> 이 문서는 적대적 리뷰 1라운드(Critical 3·Important 12·Minor 8)를 반영한 판이다.
> 원판과 달라진 핵심: 동시성 보장을 advisory lock으로 다시 세웠고(§1·§2), 「5 =
> 성능 예산」 근거를 폐기했으며(§0), 로테이션의 전량 재업로드를 감수가 아니라
> **무변경 push 생략**으로 근본 해소한다(§6).

## §0 상한 5의 근거 — 사용자 결정이다, 성능 예산이 아니다

5는 가족 규모에 대한 **사용자 결정**이다. 원판은 "5 = `haruchi_device()` bcrypt
스캔의 성능 예산"을 근거로 댔지만 이는 성립하지 않는다 — 그 스캔의 대상은 활성이
아니라 `devices` **전 행**이고, SQL로 `revoked_at`만 마킹된 행(README 7단계)은
상한에서 빠져도 스캔에서는 빠지지 않는다. 성능 서술은 분리해 정직하게 적는다:

- 인증 비용은 **총 행 수**에 비례한다(행마다 bcrypt 1회, `anon`
  `statement_timeout=3s`). 앱 경로의 해제는 행을 지우므로 총 행을 늘리지 않는다
- SQL 폐기(마킹) 행은 비용만 내는 죽은 무게다 — README 7단계에 "차단이 목적을
  다하면 행을 지우라"를 덧붙인다(폐기 이력은 `write_log`가 이미 갖고 있다)

## §1 상한 — 권위는 서버, 직렬화는 advisory lock

활성 기기 = `revoked_at is null`인 행. 상수 5는 `schema.sql`에만 산다 — 클라이언트는
숫자를 모르고, 오류 문구가 "5대"를 담아 내려와 화면이 그대로 보여 준다.

**동시성 — 초대 락은 기기 수를 지키지 못한다.** 활성 초대는 최대 1이 _보증되지
않는다_(동시 발급 두 세션이면 2개 — `schema.sql`의 issue_invite 주석이 실측으로
적어 둔 사실이다). 활성 초대가 2개면 동시 claim 둘이 서로 다른 초대 행을 잠가
나란히 통과할 수 있고, 상한 검사는 `devices`를 잠그지 않으므로 TOCTOU다(4대 →
동시 2 claim → 6대). 그래서 **기기 수를 바꾸거나 읽고-결정하는 두 RPC가 같은
advisory lock을 잡는다**:

```sql
perform pg_advisory_xact_lock(hashtext('haruchi-devices'));
```

- `claim_invite`: 상한 검사 직전에. 트랜잭션 커밋·롤백에서 자동 해제
- `remove_device`(§2): 삭제 직전에. 같은 키라 claim↔remove·remove↔remove가 전부
  직렬화된다
- `haruchi_device()`·일반 push·pull은 잡지 않는다 — 기기 **수**를 바꾸는 곳만이다.
  이 락의 임계 구역은 카운트 + insert/delete 몇 ms라 경합 비용이 없다

**검사 순서와 위치** (claim_invite 안):

1. `p_device_id` null·빈 문자열 → raise (기존)
2. 중복 기기 → `{error "이미 등록된 기기예요"}` (기존)
3. 초대 행 `for update` + 코드 검증(`is distinct from`) (기존)
4. **advisory lock → 활성 5대면
   `{"error": "기기가 5대라 더 들어올 수 없어요 — 기존 기기의 관리 화면에서 한 대를 해제해 주세요"}`**
   — 코드 검증 **뒤**(코드를 맞혀야 상한 상태가 보인다 — 익명 폴링으로 "가족이
   가득 찼나"를 볼 수 없다) · `used_at` 마킹 **앞**(초대가 소모되지 않아 한 대
   해제한 뒤 **같은 코드로** 재시도가 통한다)
5. `used_at` 마킹 → 키 생성 → insert (기존)

**`issue_invite`도 5대면 발급을 거부한다** — 아빠가 발급 시점에, 발급하는 기기
화면에서 바로 안다. 문구는 claim과 **같은 문자열**(상한 메시지의 단일 출처는 이
두 곳뿐이고 같은 말을 한다). 발급 쪽은 advisory lock을 잡지 않는다 — 발급은 기기
수를 바꾸지 않고, 여기 검사는 조기 안내일 뿐 권위가 아니다(경쟁으로 새치기당해도
claim의 검사가 막는다).

**`issue_invite`의 반환을 jsonb로 바꾼다**: `{"code": "123456"}` 또는
`{"error": "..."}`. **미등록(`haruchi_device()` null)도 raise가 아니라
`{error "등록된 기기만 초대를 만들 수 있어요"}`다** — 이 함수의 사용자 수준 실패
전부가 jsonb가 되어야 "PostgREST JSON 덩어리가 화면에 뜨던" 2C의 사마귀가 실제로
사라진다(raise를 남기면 `failed()`가 본문을 붙여 그대로 재현된다). 예외는 이제
장애(네트워크·서버 오류)뿐이다.

**반환 타입 변경은 `create or replace`가 못 한다.** `drop function if exists
issue_invite()`를 앞에 둔다. `claim_invite`·신설 둘도 같은 규약으로 `drop function
if exists`를 앞에 두어(시그니처가 안 변해도) 인자·타입을 바꾸는 날의 오버로드
함정(Task 1 리뷰 M4)을 구조로 막는다. 멱등 계약(몇 번을 다시 돌려도 된다)은
drop+create 쌍으로 유지된다.

## §2 RPC 둘 신설 — `list_devices`·`remove_device`

`devices`에는 계속 **RLS 정책이 없다**(정책을 열면 anon 키로 기기 목록·key_hash가
노출된다). 접근은 `security definer` RPC만, 여섯 형제와 같은
`set search_path = public, extensions, pg_temp` 고정. plpgsql 지역 변수는 기존
관례대로 `dev`(컬럼명 `device`와의 이름 충돌 회피 — `replace_all`과 동일).

- **`list_devices() returns jsonb`** — `haruchi_device()` null이면 raise(미등록 —
  UI가 syncEnabled로 막아 도달 불가, 도달하면 프로그래밍 오류라 장애로 다룬다).
  전 행을 `created_at` 순으로, **0행이면 `[]`**(`coalesce(jsonb_agg(...), '[]')` —
  `replace_all`의 기존 패턴):
  `[{"id","label","created_at","last_seen_at","revoked_at"}]`. `key_hash`는 절대
  싣지 않는다. "이 기기" 표시는 클라이언트가 자기 `deviceId`와 대조해 그린다
- **`remove_device(p_id text) returns jsonb`** — 순서가 계약이다:
  1. `haruchi_device()` null → raise
  2. **`p_id is null or p_id = ''` → raise** — 2C의 `p_code=NULL` 우회(crypt strict
     × plpgsql `IF NULL`=false)와 같은 계열을 입구에서 끊는다. 이 가드 덕에 아래
     비교들이 3값 논리에서 안전해지지만, 자기 자신 비교는 그래도
     `is not distinct from`으로 쓴다 — 가드를 옮기는 리팩터가 우회를 되살리지
     않게(방어를 순서에 의존시키지 않는다)
  3. `p_id`가 자기 자신 → `{"error": "지금 쓰는 기기는 여기서 해제할 수 없어요"}`
  4. `perform pg_advisory_xact_lock(hashtext('haruchi-devices'));`
  5. `delete from devices where id = p_id` (**where 필수** — safeupdate). 0행이면
     `{"error": "이미 해제된 기기예요"}`
  6. **삭제 후 `select count(*) from devices where revoked_at is null`이 0이면
     raise(롤백)** — 「활성 기기 항상 1대 이상」의 실보증은 자기 자신 금지가
     아니라 **이 검사 + 락**이다. 자기 금지만으로는 A→B 삭제와 B→A 삭제가 서로
     다른 행을 잠가 동시에 커밋될 수 있다(활성 0대). 락이 둘을 직렬화하고, 뒤에
     온 쪽이 이 검사에서 죽는다
  7. `write_log (dev, 'device:'||p_id, 'device-remove')` → `{"ok": true}`
- 해제된 기기의 이후 요청: SELECT는 RLS로 빈 응답, INSERT/UPDATE는 with-check
  위반 4xx — 경로는 다르지만 둘 다 기존 「폐기된 키」와 같은 `authFailed` 배너로
  수렴한다(§4)

## §3 관리 화면 `#/manage` 신설 — 리포트에서 「데이터 관리」를 빼 온다

사용자 결정: 관리를 리포트 안의 절이 아니라 **별도 메뉴**로 뺀다.

- **이동**: 리포트의 「데이터 관리」 절 전체(내보내기·가져오기·모든 기록 지우기·
  서버 백업에서 되돌리기)가 `src/screens/manage.ts`로 옮겨 간다. 리포트에는 진입
  버튼 하나(「데이터·기기 관리」)만 남는다. 도우미(`snapshotNotice`·`dayCount` 등)는
  데이터 관리와 함께 옮긴다 — **화면끼리 import하지 않는다**(형제 규칙). 리포트와
  관리가 공유하게 되는 것이 생기면 그때 `ui.ts`로 올린다
- **이동의 알려진 부수효과 — 30일 배너 문구.** 리포트의 주간 절이 만드는
  `exportOverdue` 배너("백업한 지 30일이 넘었어요 — **아래에서** 내보내기를
  눌러주세요")는 리포트에 남는데 내보내기는 떠난다. 문구를 「데이터·기기 관리에서
  내보내기를 눌러주세요」로 고친다
- **추가**: 「연결된 기기」 절. `list_devices()` 결과를 그린다:
  - 라벨 · **「마지막 기록 올림」**(last_seen_at — `days` 쓰기에서만 갱신되는
    값이므로 「마지막 접속」이라고 부르면 거짓말이다. pull만 하는 기기는 영원히
    null이고, null은 「기록 올린 적 없음」으로 표기) · 「이 기기」 표식 ·
    `revoked_at` 있는 행은 「차단됨 — 자리 차지 안 함」
  - 자기 자신이 아닌 행에 「연결 해제」 버튼 + 확인 다이얼로그(`confirmDialog`
    규약). 다이얼로그가 해제의 실의미를 말한다: 「이 기기는 더 이상 동기화되지
    않아요. 기기에 저장된 기록은 지워지지 않고, 새 초대 코드로 다시 연결할 수
    있어요」
  - **XSS 경계 — `label`만이 아니라 `id`도 서버가 보관한 임의 문자열이다**
    (`p_device_id`는 익명 호출자가 정한 값). 화면에 넣을 때는 textContent,
    **속성에 넣을 때는 `escapeHtml`**(기존 `data-snapshot-id` 패턴). 서버도
    `claim_invite`에서 `label`을 `left(trim(p_label), 40)`으로 자른다 — 무제한
    문자열이 목록 렌더를 깨지 않게
- **게이트·소속**: `GATED_HASHES`에 `#/manage` 추가. **`#/report`도 게이트에
  남는다**(사용자 결정) — `main.ts`의 게이트 주석에서 report의 근거를 「집계(성적)
  노출 방지 + 관리 화면 진입점」으로 고쳐 적는다(파괴적 작업은 떠났으므로 옛
  근거는 거짓이 된다). `PARENT_HASHES`에도 `#/manage`를 추가한다 — 부모 화면
  진입은 `pullAndWait`(최대 3초)로 최신 상태를 기다렸다 그리는 기존 규칙을 따른다.
  새 `navigate` 목적지는 report→manage, manage→report 둘뿐
- **동기화 꺼짐**(미설정·미등록)이면 「연결된 기기」 절을 그리지 않는다 — 데이터
  관리(로컬 작업)는 그대로 동작한다

## §4 「다시 연결하기」 — 해제된 기기의 복귀 경로를 앱 안으로

해제된 기기는 서버 행이 없는데 **로컬 `deviceKey`가 남아 「등록됨」으로 보인다** —
코드 입력칸이 그려지지 않아, 지금은 DevTools로 `deviceKey`를 지워야 재등록할 수
있다(README 8절). 5대 로테이션을 앱 안에서 완결하려면 이 구멍을 닫아야 한다.

- 부모 홈의 `authFailed` 상태줄에 **「다시 연결하기」 버튼**을 단다. 상태줄은
  `serverStatus()` 응답이 도착한 `.then`에서 `#sync-line`을 갈아 끼울 때 생기므로
  **버튼 배선도 그 안에서 한다**(렌더 시점에는 버튼이 없다)
- 누르면 확인 다이얼로그 → `deviceKey: null` → 재렌더(코드 입력칸 복귀). 문구가
  이 버튼의 실비용을 말해야 한다: 「이 기기의 연결 정보를 지워요. **다시 연결하려면
  다른 기기에서 새 초대 코드를 받아야 해요.**」 — 오탐(일시 장애를 폐기로 오독)이나
  오독으로 눌렀을 때 잃는 것이 정확히 그것이다(키 자체는 서버가 거부한 값이라
  지워도 데이터 손실은 없다)
- 상태줄 문구는 「기기 키가 거부됐어요 — 아래에서 다시 연결할 수 있어요」로 바꾼다
  (`sync-status.ts` 문자열 + 테스트 갱신 — 지금 문구는 SQL 절차를 가리키므로 버튼이
  생기면 거짓이 된다)
- SQL로 `revoked_at`만 마킹된 기기(의도적 차단)가 이 버튼을 눌렀다면: claim이
  「이미 등록된 기기예요」를 돌려주고 **화면에는 그 서버 문자열이 그대로 뜬다** —
  차단은 유지된다(우회 경로가 아니다). README를 가리키는 별도 안내는 만들지
  않는다 — 그 상황의 주체는 차단한 사람(아빠)이고 문서가 그 경로를 다룬다
- README 8절의 「같은 기기 재등록」 DevTools 절차는 이 버튼으로 대체·간소화한다

## §5 재등록과 커서 — quarantine도 함께 비운다

`claimInvite`(2C)는 성공 시 `lastPulledAt`·`generation`·`seededAt`을 비운다.
여기에 **`quarantine: []`를 추가한다** — claim의 의미가 "서버 관점의 첫 등록"이라면
로컬 파괴 3경로(`replaceFromServer` 등)와 같은 대칭으로 격리 목록도 리셋이 맞다.
비우지 않으면 격리된 날짜의 push 거부가 재등록을 넘어 살아남는데, 그 격리는 이미
존재하지 않는 옛 서버 관계에 대한 판정이다. (재등록 직후 전량 pull이 격리를 새로
판정한다 — 진짜 충돌이면 다시 격리된다.)

## §6 무변경 push 생략 — 로테이션이 전량 재업로드를 부르지 않게

**문제**: 로테이션의 정상 경로(해제 → 다시 연결하기 → 재claim)에서 재등록 기기의
로컬 `days`는 가족 전체 기록이다. `seedOutbox`가 그 전부에 표식을 만들고, push가
날짜마다 GET+PATCH를 돌아 **내용이 같은 행의 `updated_at`을 전부 갱신**하면 다른
기기 전부가 다음 pull에서 전량을 다시 내려받는다(2C가 「시딩 순서」로 피한 그
폭풍이, 이 설계의 표준 흐름에서는 매 로테이션마다 돌아온다).

**해소**: `pushDay`가 서버 행을 읽은 뒤(기존 GET) **병합 결과가 서버 행과 같으면
PATCH를 보내지 않고 성공으로 처리해 표식만 지운다.**

- 같음의 정의: 병합 출력의 `value`(Day payload)와 묶음 스탬프(`sheetAt`·`gradesAt`·
  `sprintAt`와 각 `*By`)가 서버 행과 전부 동일. 비교 함수는 순수하므로
  `engine/`에 두고 테스트를 붙인다(직렬화 비교가 아니라 구조 비교 — 키 순서에
  속지 않게)
- 안전성: PATCH를 생략해도 잃는 것이 없다 — 올릴 차이가 없다는 것이 생략 조건
  그 자체다. 로컬 쓰기는 원래 pushDay가 하지 않는다
- 효과: 재등록 push는 N회 GET(읽기)로 끝나고 `updated_at` 갱신 0, 다른 기기 재pull 0. 부모 홈의 「안 올라간 기록 N건」은 잠깐 크게 보였다가 표식이 지워지며 줄어든다
  — 이 일시 표시는 감수한다(진행 그 자체다)
- `pushMeta`도 같은 생략을 적용한다(같은 구조·같은 이유 — 재등록마다 meta 표식이
  다시 생긴다는 것이 HANDOFF 2C 절에 적혀 있다)

## §7 혼재 기간 — 창은 「각 기기가 업데이트를 탭할 때까지」다

순서는 2A·2B·2C와 같다: **스키마 먼저(SQL Editor), 앱 배포는 그 직후.** 다만 이
앱은 PWA라 **혼재 창이 배포 몇 분이 아니다** — 각 기기는 「새 버전이 있어요」
배너의 업데이트를 탭하기 전까지 옛 번들을 돈다(README 4단계 5번). 기기가 5대까지
늘면 낡은 앱을 든 기기 수도 는다.

- **새 스키마 + 옛 앱**: 「새 기기 추가」를 누르면 옛 `issueInvite`가 jsonb를
  문자열로 읽어 화면에 `[object Object]`류가 뜬다. 서버 상태는 오염되지 않는다
  (발급은 성공 — 유효한 코드가 존재하나 화면에 안 보인다). 각 기기에서 업데이트를
  탭하면 끝난다 — README 적용 절차에 "적용 후 각 기기에서 업데이트 배너를 탭"
  한 줄
- **새 앱 + 옛 스키마**(사람이 SQL 적용을 잊은 경우): 방어를 클라이언트에 한 줄
  둔다 — `issueInvite`가 응답이 **문자열이면 옛 스키마로 보고
  `{ok: true, code: 그 문자열}`로 받아들인다**. 관리 화면의 `list_devices`·
  `remove_device`는 PostgREST 404로 죽는데, 이는 「연결된 기기」 절에 「서버
  준비가 덜 됐어요」류 오류 표시로 수렴시킨다(절만 죽고 데이터 관리는 산다)
- 스키마 적용은 **SQL Editor에서 파일 전체를 한 번에 Run**한다(구간을 나누면
  drop과 create 사이에 함수가 없는 창이 실재한다). 파일 끝에
  `notify pgrst, 'reload schema';`를 추가한다 — 함수 시그니처 변경을 PostgREST가
  즉시 알게 하는 명시적 신호다. Supabase가 DDL 이벤트 트리거로 자동 통지하는
  것이 보통이지만, **우리가 소유하지 않은 설정에 동작을 매달지 않는다**
  (`db_extra_search_path` 전례 — HANDOFF)

## 스키마 변경 요약 (`supabase/schema.sql` — 멱등 유지)

- `issue_invite`: `drop function if exists` + jsonb 반환 재작성(미등록도 `{error}`),
  활성 5대 검사(문구는 claim과 동일 문자열)
- `claim_invite`: `drop function if exists` 추가, advisory lock + 활성 5대 검사
  (코드 검증 뒤 · `used_at` 마킹 앞), `p_label`을 `left(trim(...), 40)`으로 절단
- `list_devices()`·`remove_device(p_id)` 신설(§2의 순서 계약 그대로) —
  `security definer` + `search_path` 고정, `drop function if exists` 선행
- 파일 끝 `notify pgrst, 'reload schema';`
- safeupdate: 신규 DML은 `remove_device`의 delete 1건 — where 있음. **컨테이너
  검증은 safeupdate 부재를 증명하지 못하므로**(HANDOFF `replace_all` 교훈) 운영
  적용 후 실제 PostgREST 경로(`authenticator`)로 remove 1회를 스모크에 넣는다

## 클라이언트 변경 요약

- `engine/`: 병합 출력 ↔ 서버 행 동일성 비교 함수 신설(+테스트, §6)
- `sync.ts`: `issueInvite` 반환 유니온화(+옛 스키마 문자열 폴백), `listDevices()`·
  `removeDevice(id)` 신설, `pushDay`·`pushMeta`에 무변경 생략(§6), `claimInvite`에
  `quarantine: []`(§5)
- `screens/manage.ts` 신설: 데이터 관리 이동 + 연결된 기기 절(§3)
- `screens/report.ts`: 데이터 관리 절 제거, 진입 버튼, 30일 배너 문구
- `screens/home-parent.ts`: 발급 실패 분기(`{ok:false}` reason 표시), 「다시
  연결하기」(§4 — `.then` 안 배선)
- `main.ts`: `GATED_HASHES`·`PARENT_HASHES`에 `#/manage`, report 게이트 근거 주석
  갱신
- `engine/sync-status.ts`: authFailed 문구 교체(+테스트)

## 문서 갱신 대상 (구현 계획에 태스크로)

- `supabase/README.md`: 5대 상한·관리 화면 / §5 「두 번째 기기부터」의 화면 경로
  (리포트 → 관리) / §6.5 게이트 목록에 `#/manage` / §7 폐기 절에 "차단이 끝나면
  행을 지우라" + 「같은 기기 재등록」은 관리 화면·재연결 버튼으로 / §9 표의
  「기기 키 거부」 행 증상·해결 / §9 표의 되돌리기 위치 / 적용 절차(전체 Run +
  각 기기 업데이트 탭)
- `CLAUDE.md`: 아이/부모 소속 불변식의 부모 목록에 `#/manage` 추가(이 목록이
  유일한 방어선이라고 선언된 곳이다)
- `HANDOFF.md`: 2C 절 「알려진 트레이드오프」 중 "복구 UI가 앱에 없다" 항목이 이
  설계로 닫힘을 기록

## 불변식 확인 (CLAUDE.md 대조)

- **아이/부모 소속**: `#/manage`는 부모 소속(목록 갱신 포함), 새 navigate는
  report↔manage뿐. `#/report`·`#/manage` 둘 다 PIN 게이트
- **XSS 경계**: label·id·서버 오류 문구 — textContent와 속성 `escapeHtml`(§3)
- **재인쇄 동일성·derived 비배선·putDay 선언 계약**: `days`·`meta`의 의미를
  건드리지 않는다. §6의 push 생략은 쓰기를 **줄이는** 쪽이고 병합 의미는
  `merge.ts` 그대로다
- **claim_invite의 jsonb 계약**(2C): 유지·확장. 상한 거부도 jsonb — raise면
  `fail_count`류 상태 변화가 롤백된다는 같은 이유가 이 함수 전체를 계속 지배한다
- **단일 출처**: 상한 상수·상한 문구는 schema.sql 한 곳(두 함수가 같은 문자열)

## 감수한 것

- 상한 5는 하드코딩 — 바꾸려면 SQL 재적용
- 해제된 기기가 배너를 보기까지 최대 한 pull·push 주기의 지연
- `remove_device`는 등록 기기 전부가 부를 수 있다(PIN 게이트 뒤 화면에서만 노출)
  — 가족 위협 모델에서 수용, 기기별 권한 등급은 만들지 않는다
- 「연결 해제」는 서버 관계만 끊는다 — **그 기기의 로컬 기록은 남는다**(다이얼로그
  문구가 말한다). 지우고 싶으면 그 기기에서 「모든 기록 지우기」(미등록 상태라
  로컬만 지운다)
- 해제된 기기의 PIN 캐시는 마지막으로 본 값으로 남는다 — pull이 멈추므로 PIN
  회전이 닿지 않는다. 가족 위협 모델에서 수용(그 기기는 이미 가족이 손에 쥔
  기기다)
- 상한 도달 시 초대가 소모되지 않는 것은 **코드를 아는 사람에게 10분짜리 재시도
  창**이기도 하다 — 해제로 자리가 나는 순간을 먼저 채갈 수 있다. 가족 위협
  모델에서 수용
- 혼재 기간의 `[object Object]` 표시(§7) — 상태 오염 없음, 각 기기의 업데이트
  탭으로 종료
- `list_devices`는 폐기(마킹) 행도 돌려주고 화면이 「차단됨 — 자리 차지 안 함」으로
  구분한다
- 재등록 직후 「안 올라간 기록 N건」이 잠깐 크게 보인다(§6) — 표식이 지워지며
  줄어드는 진행 표시다

## 검증 계획

- **스키마 — 일회용 postgres:17, 운영과 같은 배치**(pgcrypto=`extensions` +
  호출자 search_path에서 extensions 제거): 멱등 3회 / 상한: 4→5대 성공, 5대에서
  claim·issue 거부(같은 문구), 해제 후 같은 코드 재claim 성공 / remove: 자기 자신
  거부·`p_id` null·빈 문자열 raise·타 기기 삭제·0행·write_log / list: `[]`(0행 대신
  등록 1대 상태에서 형태 확인)·key_hash 부재
- **동시성 — psql 두 세션**: ① 활성 초대 2개 + 4대 상태에서 동시 claim → 5대에서
  멈추는지(advisory lock의 변이 검증: 락을 지우면 6대가 되는지 — C1의 EPQ 흘러내림
  가설도 이 실험이 판정한다) ② 2대 상태에서 상호 remove 동시 실행 → 한쪽이
  raise로 죽고 활성 1대가 남는지(락 제거 변이: 0대가 되는지)
- **운영 적용 후**: PostgREST(`authenticator`) 실경로로 remove 1회(safeupdate 실증
  — 컨테이너는 이를 증명하지 못한다), `notify pgrst` 뒤 새 시그니처 즉시 반영 확인
- **클라이언트**: §6 동일성 비교 함수의 엔진 테스트(+변이: 스탬프 하나를 비교에서
  빼면 빨개지는지) / `sync-status.ts` 문구 테스트 갱신 / 상한 검사 위치의 변이
  검증(검사를 `used_at` 마킹 뒤로 옮기면 "해제 후 같은 코드 재시도"가 빨개져야
  한다) / 화면 테스트는 두지 않는다(설계 §12) — 수동 스모크 목록을 계획서에
