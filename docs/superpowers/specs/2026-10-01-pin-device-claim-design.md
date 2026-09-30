# PIN으로 기기 연결 — 부모 기기를 모두 잃었을 때

2026-10-01. 아이패드(`59a58aa5`)의 연동이 끊겼는데 살아 있는 등록 기기는 아이 폰뿐이었다.
아이 기기는 부모 화면이 라우터에서 막혀 「새 기기 추가」(초대 발급)를 누를 수 없으므로, 복구가
SQL Editor(README 8절)로만 가능했다. **최근에 본 부모 기기가 하나도 없는 비상 상황에서만** 부모
PIN을 초대 코드의 대체 증명으로 받아 앱 안에서 복구를 끝낸다.

적대적 리뷰 2라운드를 거쳤다. 1라운드가 「아무 기기나」의 아이 탈출을, 2라운드가 「활성 부모 행
0대」 술어가 실제 분실에서 열리지 않음(고아 행)을 깼다. 아래가 그 뒤의 결정이다.

## 0. 결정 (사용자)

- **증명 수단은 부모 PIN**(`app_config.pin`). 별도 복구 코드·아이 기기 발급 허용·SQL 정리만
  하기는 기각
- **비상 모드에서만 연다.** 비상 = **최근 3일 안에 본 활성 부모 기기가 없음**:
  `not exists (select 1 from devices where revoked_at is null and not child and last_seen_at > now() - interval '3 days')`.
  부모 기기가 살아 있는 평소에는 PIN 경로가 PIN을 비교하지도 않고 거부한다 — 그때는 그 기기의
  초대 코드가 정답이다
- **왜 행 개수가 아니라 시각인가**(리뷰 2라운드): 부모 기기를 잃는 흔한 길(사이트 데이터 삭제·
  고장·분실)은 서버의 옛 행을 활성 그대로 남긴다. 서버는 「기기가 사라졌다」와 「잠깐 쉰다」를
  구별할 수 없고, 앱 안에서는 활성 부모 행을 0으로 만들 수도 없다(`remove_device`가 자기 자신
  해제를 막고, 아이 기기는 관리 화면에 못 들어간다). 「활성 부모 행 0대」 술어는 누군가 SQL을 만진
  뒤에만 열려 목적을 이루지 못한다. 남는 판정 수단은 마지막으로 본 시각뿐이다
- **3일**: 기기를 잃은 부모가 기다리는 시간이자, 부모 기기가 모두 쉬는 동안 창이 열리기까지의
  시간이다. 매일 스프린트를 하는 아이패드가 부모 기기로 등록돼 있어 평소 창이 열릴 일은 드물다.
  값은 `schema.sql`의 `claim_with_pin`에만 산다
- 비상 모드 안에서는 **아무 기기나**: 끊긴 기기(같은 id)도, 앱 데이터가 지워진 기기(새 id)도 같은
  길로 들어온다. 5대 상한·차단 존중은 그대로
- **이게 새로 여는 권한**: 지금 앱에서 등록하려면 「등록된 부모 기기를 손에 쥐는 것」이 필요하다
  (초대 발급 버튼은 PIN 대상이 아닌 부모 홈에 있다). 비상 모드 동안에는 그 물리 요건이 「인터넷
  어디서든 PIN」으로 바뀐다. 평소에는 아무것도 바뀌지 않는다 — PIN이 비교되지 않으므로 원격
  대입도, 일부러 잠그기도 불가능하다
- **잠금은 전역 5회 연속 실패 → 영구, SQL로만 해제.** 성공하면 0으로. 시간 기반 잠금(5회/1시간)은
  4자리 PIN을 평균 약 1000시간(6주)에 뚫리게 두므로 기각. 잠금은 비상 모드 안에서만 쌓인다
- 앱의 해제 버튼은 만들지 않는다. 잠금을 풀 부모 기기가 있으면 그 기기가 초대를 발급하면 된다

### 0.1 아이 기기 결정과의 관계

아이 기기 설계(`2026-09-29-child-device-design.md` §0)는 「PIN을 알아도 못 연다」다. 아이가 사이트
데이터를 지우거나 다른 브라우저를 쓰면 새 id·표식 없는 미등록 기기가 되어 부모 홈의 등록 블록에
닿는다(`src/main.ts` 아이 차단은 `device.child && deviceKey !== null`일 때만). 부모가 아이 폰을
「연결 해제」했다가 다시 붙일 때도 표식이 풀린 새 행이 된다. 아무 때나 PIN으로 받으면 이 두
길이 곧 아이의 탈출구다 — PIN은 아이 앞에서 입력되는 값이다.

비상 모드가 이를 좁힌다: 앱 UI 경로에서 아이의 탈출에는 여전히 부모 기기에서 발급한 초대 코드가
필요하다. **남는 창**은 3일 넘게 어떤 부모 기기도 앱을 열지 않은 동안이다(방학·여행으로 아이패드를
쉬는 경우 포함). 이 창은 받아들인다.

- **UI 경로에서는**이라고 한정하는 이유: 등록된 아이 기기의 키로 REST를 직접 부르면 `issue_invite`·
  `remove_device`·`app_config` 갱신에 child 가드가 없다. 기존부터 있던 틈이고 이 설계가 넓히지
  않는다(초대 발급이 더 쉬운 길이다)
- **창 안에서 아이가 먼저 청구하면** 비상 모드가 닫혀 부모의 PIN 시도가 「부모 기기가 있어요」로
  거부된다. 그 문구에 「모르는 기기라면 README 8절」을 넣어 SQL 경로로 보낸다(§2.2 2)

## 1. 왜 기존 행 덮어쓰기가 필요 없는가

기기 키와 기기 id는 같은 IndexedDB 행(`device/current`)에 산다. 로컬을 잃으면 id도 잃어 새
기기가 되므로 「서버 행은 활성인데 로컬 키만 잃음」은 생기지 않는다. 그 새 기기는 새 id로
청구하고, **옛 id의 고아 행은 활성으로 남는다** — 3일 뒤 비상 판정에서 빠지고(§0), 상한 한 자리를
계속 차지한다(아래 한계). 키 거부는 서버 행이 **지워졌거나**(다른 기기의 「연결 해제」)
**차단됐을 때**(`revoked_at`)뿐이다.

- 지워진 경우: 「다시 연결하기」가 로컬 키를 비운 뒤 같은 id로 청구하면 id 중복 검사에 걸리지
  않는다 — 모자란 것은 초대 코드 하나였다
- 차단된 경우: 의도적 차단이라 PIN으로도 뚫리면 안 된다 — 행이 남아 있어 id 중복 검사가 막는다.
  정답 뒤에 「이미 등록된 기기예요」가 나와 정답 확인 오라클이 되지만, 차단 기기는 pull로 받은
  PIN을 이미 캐시하고 있어(`sync.ts` `DeviceState.pin`) 새로 새는 것은 없다

그래서 새 RPC는 `claim_invite`의 「기존 행을 덮지 않는다」(`schema.sql` claim_invite 주석)를
그대로 지키고, 증명 수단만 바꾼 형제다.

**PIN은 과거에 등록됐던 모든 기기가 안다.** 해제된 뒤 가족 밖으로 나간 기기(판 폰 등)도
`DeviceState.pin`을 캐시하고 있어 비상 모드 동안 그것이 청구 자격증명이 된다. 운영 권고(README):
가족 밖으로 나가는 기기를 해제할 때 PIN을 바꾼다.

**알려진 한계 — 상한**: 고아 행은 5대 상한을 먹는다. 활성 행이 이미 5개(고아 포함)면 PIN 청구가
정답 뒤 상한 거부로 끝나고, 해제할 부모 기기가 없으므로 SQL(README 7절 `delete`)로 간다.

## 2. 서버 (`supabase/schema.sql`, 멱등 유지)

### 2.1 실패 카운터 테이블

```sql
create table if not exists pin_guard (
  id         int primary key default 1 check (id = 1),
  fail_count int not null default 0
);
insert into pin_guard (id) values (1) on conflict (id) do nothing;
-- 정책 없음: RPC(security definer)만 접근.
alter table pin_guard enable row level security;
```

**`app_config`에 열로 두지 않는 이유**: `config_update` 정책이 등록 기기에게 `app_config` 행
갱신을 열어 둔다. RLS는 행 단위라 `pin` 열을 열면 카운터 열도 함께 열린다 — 방어 장치를 방어
대상이 끌 수 있게 된다. 정책 없는 별도 테이블이면 `invites`와 같은 규약(RPC만 접근)이 된다.

**전역 1행인 이유**: 초대처럼 행마다 두면 공격자가 행을 갈아 가며 우회한다. PIN은 하나다.

### 2.2 `claim_with_pin(p_pin text, p_device_id text, p_label text) returns jsonb`

`security definer set search_path = public, extensions, pg_temp`, anon 호출. `drop function if
exists` → `create` 패턴(파일의 다른 RPC와 같다). **이 파일의 모든 update는 `where`를 단다**
(safeupdate — 빠지면 PostgREST 경유 호출이 raise로 롤백돼 카운터가 영영 0이고 경로 전체가
`showError`로 죽는다). 순서가 계약이다:

1. id 가드 — `claim_invite`와 동일(빈 id·64자 초과는 raise. 상태를 남길 필요가 없는 오용)
2. **비상 모드 검사**(§0의 술어). 최근 본 부모 기기가 있으면
   `{error: '부모 기기가 있어요 — 그 기기의 부모 홈 → 「새 기기 추가」로 코드를 받아 주세요. 모르는 기기라면 관리자에게 알려 주세요'}`.
   카운터를 읽지도 올리지도 않는다. **맨 앞인 것이 계약이다**: 평소 상태에서 PIN이 한 번도
   비교되지 않아야 원격 대입과 일부러 잠그기가 둘 다 원천 불가능해진다. 새는 정보는 「이 가족에
   최근 쓴 부모 기기가 있다」 한 비트뿐이다. 락 없이 읽는다 — 이 검사와 등록 사이에 다른 경로로
   부모 기기가 들어와도 결과는 「PIN을 아는 사람이 한 대 더 등록」이라 무해하다
3. `select fail_count into ... from pin_guard where id = 1 for update` — 동시 오답들의 카운터
   증가를 직렬화한다. 이 락이 없으면 READ COMMITTED에서 동시 오답 두 개가 같은 값을 읽고 각자
   +1을 써 하나를 잃는다. **행이 없으면(`not found`) 잠김으로 다룬다**(fail-closed) — 그대로
   두면 null 카운터가 `>= 5` 검사를 통과하고 오답 update가 0행에 떨어져 무제한 대입이 된다.
   `for update`는 읽기 전용 트랜잭션에서 오류를 내므로 PostgREST `GET /rpc/...`로는 비교까지
   닿지 못한다(계약 — 이 줄을 advisory lock 등으로 바꾸지 않는다)
4. 잠김(`fail_count >= 5`)이면 **PIN을 비교하지 않고**
   `{error: 'PIN 연결이 잠겼어요 — 관리자가 SQL로 풀어야 해요'}`. 잠긴 뒤 정답이 통하면 잠금이
   아니다(정답 여부도 흘리지 않는다)
5. PIN 미설정(`app_config` 행 없음 또는 `pin = ''`)이면
   `{error: 'PIN이 설정되지 않았어요 — 초대 코드로 연결해 주세요'}`. 카운터를 올리지 않는다
   (비교할 대상이 없다)
6. 오답(`app_config.pin is distinct from p_pin`)이면
   `update pin_guard set fail_count = fail_count + 1 where id = 1`,
   `write_log (p_device_id, 'pin', 'pin-fail')`,
   `{error: 'PIN이 맞지 않아요 — 초대 코드를 넣으셨다면 위의 「연결하기」를 눌러 주세요'}`.
   **raise가 아니라 반환** — raise는 카운터 증가까지 롤백해 잠금이 영영 안 걸린다(claim_invite
   주석의 교훈). `is distinct from`은 `p_pin = null`을 오답으로 보낸다. 로그는 잠금 전까지만
   쌓이므로 익명 호출자가 남길 수 있는 줄은 잠금당 5줄이다
7. 정답이면 `update pin_guard set fail_count = 0 where id = 1`
8. 이후는 `claim_invite`의 등록부와 같다: id 중복이면 `{error: '이미 등록된 기기예요'}` →
   advisory lock(`hashtext('haruchi'), hashtext('devices')`) → 상한 5 → 키 발급·`devices`
   insert(label 40자 자름, 빈 이름은 '새 기기', **`last_seen_at = now()`** — 새 기기가 곧바로
   비상 모드를 닫는다. 비워 두면 첫 pull 전까지 두 번째 PIN 청구가 들어올 수 있다) →
   `write_log (p_device_id, 'pin', 'pin-claim')` → `{key}`.
   알려진 한계(기존 `claim_invite`끼리도 같다): id 중복 검사가 advisory lock 앞이라 같은 id로 두
   청구가 동시에 오면 늦은 쪽이 PK 위반 raise(409 → `showError`)로 끝난다. 비파괴적

**id 중복 검사가 정답 확인 뒤(8)인 이유**: 앞에 두면 오답 없이 「이미 등록된 기기예요」가
돌아와, 익명 호출자가 카운터를 태우지 않고 임의 id의 등록 여부를 탐색할 수 있다.

**정답 후 등록이 실패하면**(중복·상한) 카운터는 이미 0으로 돌아가 있다. 정답을 아는 사람이라
문제없다.

**락 순서**: `pin_guard` 행 → advisory lock. advisory를 먼저 잡고 `pin_guard`를 잡는 함수가
없으므로 교착이 없다. 앞으로 그런 함수를 만들지 않는다.

**PIN 비교는 평문이다.** `app_config.pin`이 평문으로 저장돼 있고(2B 설계) 등록 기기가 pull로
읽어 가므로 여기서 해시를 도입해도 보호가 늘지 않는다.

`grant`: `schema.sql`에는 명시적 grant가 없다 — `claim_invite`처럼 public 기본 execute 권한에
기댄다.

### 2.3 하트비트 — `my_device()`가 `last_seen_at`을 찍는다

지금 `last_seen_at`은 `days` 쓰기 트리거(`haruchi_log`)에서만 갱신된다. 기록을 쓰지 않는 부모
폰은 활성인데 `null`로 남아 비상 판정에서 「안 보인 기기」가 된다. 그래서:

- `my_device()`를 `stable` → **volatile**(표기 생략)로 바꾸고, 반환 전에
  `update devices set last_seen_at = now() where id = dev;`
- 클라이언트는 이미 pull마다 `POST /rpc/my_device`를 부른다(`sync.ts` `pullDeviceFlag`) — **앱
  변경 없음.** POST라 읽기 전용 트랜잭션이 아니다. 배포된 옛 앱도 같은 호출을 하므로 스키마를
  적용하는 순간 하트비트가 시작된다
- `haruchi_device()`는 `revoked_at is null`인 행만 인정하므로(`schema.sql` haruchi_device) 차단
  기기는 하트비트를 남기지 못한다. 아이 기기의 하트비트는 술어가 `not child`로 거른다
- 비용: pull마다 devices 한 행 update. 기기 5대 × 앱 열 때마다라 무시할 만하다

**적용 직후의 창**: 스키마를 적용한 순간 기록을 안 쓰는 부모 기기들의 `last_seen_at`은 `null`이나
옛 값이다. 매일 기록을 쓰는 아이패드가 활성 부모 기기면 창은 열리지 않는다. 그렇지 않다면 부모
기기에서 앱을 한 번 열 때까지 창이 열려 있다 — 배포 절차에 「적용 직후 부모 기기에서 앱을 한 번
연다」를 넣는다.

### 2.4 잠금 해제 (README 8절에 추가)

```sql
update pin_guard set fail_count = 0 where id = 1;
```

`delete`로 풀지 않는다 — 행이 없으면 fail-closed로 영구 잠긴다(스키마 재적용이 행을 되살린다).

## 3. 앱

### 3.1 `src/data/sync.ts`

`claimInvite`의 본문을 RPC 이름·파라미터·작업 이름을 받는 내부 함수로 뽑고 두 export가 그것을
부른다:

- `claimInvite(code, label)` → `rpc/claim_invite`, `{p_code, p_device_id, p_label}`
- `claimWithPin(pin, label)` → `rpc/claim_with_pin`, `{p_pin, p_device_id, p_label}`

성공 뒤의 상태 초기화(`deviceKey`·`lastPulledAt`·`generation`·`seededAt`) → `seedOutbox` →
`pullOnce` → `kickPush` 순서는 복제하지 않는다. 「claim은 언제나 첫 등록」이라는 그 계약은 PIN
경로에서도 정확히 성립한다(id 중복을 거부하므로 성공 = 서버가 이 기기를 처음 본다).
`claimInvite` 주석의 「새 초대 코드가 필요하다」 전제도 「새 초대 코드나 비상 PIN」으로 고친다.

### 3.2 `src/screens/home-parent.ts` 미등록 블록

- 기존 코드 입력칸·「연결하기」(`#invite-claim`)·안내 줄은 그대로 둔다
- 그 아래 **별도 줄**: 「부모 기기를 모두 잃었나요? 사흘 넘게 어떤 부모 기기도 열리지 않았다면 부모
  PIN으로 연결할 수 있어요」 안내와 PIN 전용 입력칸(`#pin-input`, `type="password"`,
  `inputmode="numeric"`, `autocomplete="off"`, maxlength 없음 — PIN은 길이 자유)·
  **「PIN으로 연결」**(`#pin-claim`)·자기 안내 줄(`#pin-hint`)
- **입력칸을 공유하지 않는 이유**(리뷰 1라운드): 공유하면 초대 코드를 넣고 PIN 버튼을 누르는
  실수 다섯 번이 PIN 경로를 영구 잠근다. 오답 비용이 비대칭이다(초대는 10분 뒤 새 코드, PIN은
  SQL). 자동 판별도 불가능하다 — PIN은 길이 자유라 6자리 PIN과 초대 코드가 같은 모양이다
- 기기 이름은 기존 `#device-label` 하나를 두 경로가 같이 쓴다
- PIN 경로 검증: 숫자만 남긴 뒤 1자리 이상, 아니면 「PIN은 숫자예요」
- 실패 처리는 기존 핸들러와 같은 두 결(`{ok:false}` → 자기 안내 줄 `textContent`, throw →
  `showError`). 두 버튼 모두 진행 중에는 둘 다 disable한다 — 한쪽만 막으면 연타가 다른 경로의
  카운터를 태운다
- **아이 기기**: 이 블록은 부모 홈(`#/parent`)에만 있고 아이 기기에서는 라우터가 부모 화면
  전체를 막는다. 아이 기기는 등록된 상태라 미등록 블록 자체도 그려지지 않는다. 화면 소속 불변식에
  닿지 않는다(표식 없는 새 id로의 탈출은 §0.1이 서버에서 좁힌다)
- **「다시 연결하기」 다이얼로그 문구**(재연결 버튼): 「다시 연결하려면 다른 기기에서 새 초대
  코드를 받아야 해요.」 → 「다시 연결하려면 다른 기기의 새 초대 코드가 필요해요. 부모 기기를 모두
  잃었다면 사흘 뒤 부모 PIN으로도 연결할 수 있어요.」 동기가 된 사례가 정확히 이 다이얼로그를
  거친다. 같은 전제를 적은 재연결 주석도 함께

## 4. 문서

- `supabase/README.md`
  - 5절 「이후 기기」 뒤에 「부모 기기를 모두 잃었을 때 — PIN」 한 문단(비상 조건 3일)
  - 6.6: 「PIN을 알아도 열리지 않는다」에 단서 — 부모 기기가 모두 3일 넘게 쉬면 표식 없는 새
    기기로 PIN 청구가 가능하다(§0.1)
  - 7절: 가족 밖으로 나가는 기기를 해제할 때 PIN을 바꾼다
  - 8절: PIN 경로, 비상 조건, 잠금 해제 SQL(`delete` 금지), 고아 행·상한 한계
  - 9절 증상표: 「PIN 연결이 잠겼어요」, 「부모 기기가 있어요」(모르는 기기·고아 행 → 3일 대기
    또는 SQL), 「아직 연결되지 않았어요」 행에 PIN 경로
  - 스키마 적용(2절)은 기존대로 `schema.sql` 전체 재실행(멱등)
- `docs/PRD.md` 「기기 등록」: 초대 코드, **3일 넘게 본 부모 기기가 없을 때만** 부모 PIN, PIN 5회
  연속 실패 잠금(SQL 해제). 「아이 기기」 문단에 비상 창(§0.1) 한 줄
- `docs/superpowers/specs/2026-09-29-child-device-design.md` §0: 이 스펙으로의 역참조 한 줄
- HANDOFF: 배포 기록, 「스키마 재적용 필요」, §5 실측 결과

**배포 순서**: 스키마를 먼저 적용한다(하트비트는 이 순간 시작된다) → 부모 기기에서 앱을 한 번
연다(§2.3 적용 직후의 창) → 앱을 push한다. 순서가 뒤집히면 PIN 버튼이 404 RPC를 불러
`showError`로 떨어진다(파괴적이지는 않다).

## 5. 테스트

- `src/data/sync.test.ts`: `claimWithPin` — 성공 시 `claimInvite`와 같은 상태 초기화(키 저장,
  커서 셋 null), `{error}` 응답은 `{ok:false, reason}`, 요청이 `rpc/claim_with_pin`으로 가고
  본문에 `p_pin`을 싣는다. 변이 검증: 내부 함수에 RPC 이름·파라미터 키를 잘못 넘기면 빨개지는지
- SQL은 이 레포에 테스트 수단이 없다 — 스키마 적용 뒤, 앱 push 전에 SQL Editor·`curl`(anon 키)로
  실측하고 결과를 HANDOFF에 남긴다.

**무대 만들기**: 비상 모드는 「최근 3일 안에 본 활성 부모 기기 없음」이다. 실제 부모 기기를 건드리지
않고 만들려면 **그 기기들의 앱을 닫아 둔 채** `last_seen_at`을 과거로 돌린다:

```sql
update devices set last_seen_at = now() - interval '4 days' where not child and revoked_at is null;
```

그 기기가 앱을 열면 다음 pull의 하트비트가 되돌려 놓으므로 되돌리기 SQL은 필요 없다. `child`
뒤집기나 `revoked_at`은 쓰지 않는다 — 전자는 그 기기의 pull이 표식을 캐시해 부모 화면을 막고,
후자는 키가 거부돼 「다시 연결하기」로 로컬 키가 지워진다.

**성공 실측 뒤에는 매번 곧바로 테스트 행을 지운다** — 남겨 두면 `last_seen_at = now()`인 부모
기기라 비상 모드가 닫혀 이후 항목이 전부 「부모 기기가 있어요」에서 멈춘다:
`delete from devices where id = '<테스트id>';`

항목(무대 위에서, 순서대로):

1. 비상 무대 밖(무대 SQL 전)에서 오답·정답 → 「부모 기기가 있어요」, `pin_guard`·`write_log` 불변
2. 무대 SQL. 오답 5회 → 모두 「맞지 않아요」, `write_log`에 `pin-fail` 5줄, `fail_count = 5`
3. 6번째에 정답 → 「잠겼어요」
4. 잠긴 채 `update app_config set pin = '' where id = 1` → 「잠겼어요」(순서 4→5). PIN을 되돌린다
5. 잠긴 채 `schema.sql` 전체 재적용 → `fail_count = 5` 유지
6. 해제 SQL 뒤 정답 → `{key}`, `fail_count = 0`, 새 행 `last_seen_at` 채워짐. **테스트 행 삭제**
7. 동시 오답 5개(`curl` 병렬) → `fail_count = 5` 정확히. 해제
8. `p_pin = null` → 「맞지 않아요」(+1). 해제
9. PIN 미설정(`pin = ''`) → 「설정되지 않았어요」, 카운터 불변. PIN을 되돌린다
10. 이미 있는 id로 정답 — **아이 행이나 차단 행의 id로만 재현된다**(활성 부모 행 id는 비상 판정에
    먼저 걸린다). 아이 폰 id로 → 「이미 등록된 기기예요」, 카운터 0
11. `GET /rest/v1/rpc/claim_with_pin?p_pin=...&p_device_id=...&p_label=x` → 오류(읽기 전용
    트랜잭션의 `for update`), 카운터 불변. **비상 무대 위에서만 의미가 있다** — 무대 밖에서는 2번
    단계가 먼저 200을 돌려준다
12. anon 키로 `GET /rest/v1/pin_guard`·`PATCH` → 빈 응답/0행(정책 없음)
13. 하트비트: 부모 기기에서 앱을 열고 `last_seen_at`이 now 근처로 바뀌었는지 → 무대가 닫혔는지
    1번처럼 확인

끝나면 `fail_count = 0`인지, 테스트 행이 남지 않았는지, PIN이 원래 값인지 확인한다.

## 6. 하지 않는 것

- 기존 행 키 교체(§1). 필요한 상황이 생기지 않는다
- 고아 행 자동 정리. 서버는 사라짐과 쉼을 구별할 수 없다 — 3일 술어가 판정에서만 빼 준다
- 앱 안의 잠금 해제·PIN 설정 UI(PIN은 여전히 SQL 전용 설정)
- 시간 기반 자동 잠금 해제
- PIN으로 들어온 기기의 알림·표시. 비상 모드에서는 알릴 부모 기기가 없다. `write_log`의
  `pin-claim`이 이력이다
- 아이 기기 키의 REST 권한 좁히기(`issue_invite`·`remove_device`·`app_config`의 child 가드).
  기존 틈이고 이 설계의 범위 밖이다 — HANDOFF 후속 목록에 올린다
