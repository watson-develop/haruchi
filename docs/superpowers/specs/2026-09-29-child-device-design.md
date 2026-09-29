# 아이 기기 — 부모 화면 완전 차단

2026-09-29. 딸(이서아)의 폰이 생겨 동기화로 등록됐다(기기 목록 label 「이서아」). 그 폰에서
부모 소속 화면 전부를 막는다.

## 0. 결정 (사용자)

- **완전 차단.** 아이 기기에서는 부모 소속 해시(`#/parent`·`#/print`·`#/grade`·`#/report`·
  `#/manage`) 어디에도 들어가지 못한다. PIN으로 여는 경로도 두지 않는다 — PIN을 알아도
  못 연다. 인쇄·채점·관리는 부모 기기에서만 한다
- **표식은 부모 기기의 관리 화면에서 켜고 끈다.** 서버 `devices` 행에 저장되고 아이 기기는
  pull로 받는다. 원격으로 풀 수 있어야 하기 때문이다

## 1. 왜 서버 표식인가

아이 기기에서 부모 화면이 막히므로, 아이 기기 스스로 표식을 끄는 UI는 존재할 수 없다.
기기 로컬 표식이면 해제 = 사이트 데이터 삭제 후 재등록이 된다. 서버 표식이면 부모 기기에서
끄고 아이 기기의 다음 pull이 받는다.

## 2. 서버 (`supabase/schema.sql`, 멱등 유지)

```sql
alter table devices add column if not exists child boolean not null default false;
```

- **`list_devices()`** 응답 객체에 `'child', d.child`를 싣는다
- **`my_device()` 신설** — `security definer`, 반환 `jsonb {child}`. `haruchi_device()`가
  null이면 raise(미등록). `devices`에 RLS 정책이 없어 클라이언트가 자기 행을 읽는 유일한 길이다
- **`set_device_child(p_id text, p_child boolean)` 신설.** 순서가 계약이다(`remove_device`와 같은 틀):
  1. 호출 기기 미등록 → raise
  2. `p_id` null·빈·길이 > 64 → raise, `p_child` null → raise
  3. `p_id is not distinct from dev` → `{error: '지금 쓰는 기기는 바꿀 수 없어요'}`
  4. advisory lock(`hashtext('haruchi'), hashtext('devices')` — `remove_device`·`claim_invite`와 같은 락)
  5. 호출 기기가 **여전히 활성이고 child가 아닌지** 재확인 → 아니면 raise. 이 재확인이
     「부모 기기가 0대가 되는」 경쟁(두 부모 기기가 동시에 서로를 아이로 바꿈)을 막는
     실보증이다. 호출자가 부모로 남는 한 부모 기기는 최소 1대다
  6. `update devices set child = p_child where id = p_id and revoked_at is null` — 0행이면
     `{error: '이미 해제된 기기예요'}`
  7. `write_log`에 `('device:'||p_id, 'device-child' | 'device-parent')`
- **`remove_device`에 가드 하나 추가**: 대상이 `child = true`면 삭제하지 않고
  `{error: '아이 기기는 먼저 「부모 기기로」 바꾼 뒤 해제해 주세요'}`. 이유: 아이 기기가 삭제되면
  그 기기의 pull이 `unauthorized`로 끊겨 표식을 다시 받을 수 없고, 재연결 UI(부모 홈 「다시
  연결하기」)는 막혀 있다 — 영구히 잠긴다. 대상 검사는 락 뒤, delete 앞에 둔다
- 호출 기기가 아이 기기일 때 `set_device_child`·`remove_device`를 부르는 경로는 UI에 없다
  (관리 화면이 막혀 있다). 서버에서 5번이 어차피 거부한다. `remove_device`는 아이 호출자를
  따로 막지 않는다 — 막을 UI 경로가 없고, 필요해지면 그때 추가한다

## 3. 클라이언트가 표식을 받는 길 (`src/data/sync.ts`, `src/data/db.ts`)

- `DeviceState`에 `child: boolean` 추가. 기존 저장본에 없으면 `false`로 읽는다(`pin`과 같은
  기기 로컬 캐시 — 백업·동기화 대상 아님)
- `pullConfig()` 안에서 PIN과 함께 `my_device()`를 부르고 `DeviceState.child`에 캐시한다.
  반환값(바뀌었나)은 PIN 변화와 OR — 바뀌면 `PullResult.changed`가 되어 `onPullApplied`가
  지금 화면을 다시 그린다(→ §4의 라우터 판정이 다시 돈다)
- 위치 규약은 PIN과 같다: **`'unauthorized'`·`'rebase'` 가드 뒤**. 실패(네트워크·5xx·raise)는
  삼키고 캐시를 유지한다 — 한 번 아이 기기로 잠긴 기기는 오프라인이어도 잠긴 채다
  (fail-closed). 반대로 아직 표식을 한 번도 못 받은 기기는 열려 있다(최초 pull 전 창 — §6)
- 두 호출(PIN·my_device)은 서로의 실패에 영향을 주지 않는다

## 4. 차단 (`src/main.ts`, `src/screens/home-child.ts`)

- `route()`에서 **PIN 게이트보다 앞**, `try` 안: `device.deviceKey !== null && device.child`이고
  해시가 `PARENT_HASHES` 중 하나면 `navigate('#/')` 후 `return`. 렌더하지 않는다
  - `deviceKey !== null` 조건: 미등록 기기에 남은 낡은 표식이 기기를 잠그지 않게.
    (아이 기기 삭제는 §2 가드로 막히므로 등록된 채로 표식이 풀리는 경로가 정상 경로다)
  - 라우터 한 곳에 두는 이유는 PIN 게이트와 같다 — 화면마다 두면 삼항연산자 속 `navigate`
    같은 샛길이 샌다. 이 판정 하나가 버튼·주소 직접 입력·뒤로 가기를 모두 덮는다
- 아이 홈의 「부모 →」 버튼: 아이 기기에서는 그리지 않는다. 막는 것은 라우터이고 이것은
  죽은 버튼을 안 보이게 하는 표시 문제다
- 부모 화면이 렌더 전에 `pullAndWait`로 기다리는 흐름은 그대로 둔다 — 기다린 뒤 표식을
  읽으므로 방금 켜진 표식도 반영된다

## 5. 켜고 끄기 (`src/screens/manage.ts`)

「연결된 기기」 각 줄(이 기기 제외, 차단된 기기 제외):

- 줄 이름 뒤에 아이 기기면 ` · 아이 기기` 표기
- 버튼 하나: child면 「부모 기기로」, 아니면 「아이 기기로」
  - 「아이 기기로」는 확인 다이얼로그: 「이 기기에서는 부모 화면(인쇄·채점·리포트·관리)이
    열리지 않아요. 다음에 앱을 열 때부터 적용돼요.」
  - 「부모 기기로」는 확인 없이 바로(여는 방향이라 되돌리기 쉽다)
  - 성공 시 `navigate('#/manage')`로 목록을 다시 읽는다(연결 해제와 같은 규약), 서버
    `{error}`는 `showError(reason)`
- 서버 문자열은 지금처럼 `textContent`로만 넣는다

## 6. 알려진 한계

- **최초 적용 창.** 표식을 켠 뒤 아이 기기가 pull 한 번을 돌기 전까지는 열려 있다. 앱을
  열면(아이 홈 라우팅) pull이 돌고, 적용되면 재렌더된다. 표식을 켠 직후 아이 기기에서
  앱을 한 번 열어 「부모 →」가 사라졌는지 확인하는 것이 운영 절차다
- **서버 대시보드에서 아이 기기 행을 직접 지우면** §2 가드를 우회해 그 기기가 영구 잠긴다.
  복구는 그 기기의 사이트 데이터 삭제 후 재등록
- 아이 기기도 스프린트 기록은 평소대로 push한다 — 기록 권한은 바뀌지 않는다

## 7. 테스트·검증

- `engine/`에 새 순수 로직이 없다(판정은 라우터 한 줄). DOM 테스트는 하지 않는다(설계 §12)
- `schema.sql`: 같은 DB에 두 번 연속 적용해 오류 없음(멱등)
- 실기기: 아이패드 관리 화면에서 「이서아」를 아이 기기로 → 폰에서 앱 열기 → 「부모 →」
  사라짐, `#/parent`·`#/grade` 직접 입력 시 아이 홈으로 → 아이패드에서 「부모 기기로」 →
  폰 재오픈 시 복귀. 「이서아」 연결 해제 시도가 거부되는지

## 8. PRD 영향

§3(역할과 화면 소속)에 「아이 기기에서는 부모 소속 화면 전체가 라우터에서 막힌다」 한 단락,
§6(PIN 게이트) 옆에 표식의 소유자(관리 화면·`devices.child`)를 적는다. 구현 커밋과 같은 커밋.
