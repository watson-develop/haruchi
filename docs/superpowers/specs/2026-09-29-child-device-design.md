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
- **공통 가드 `부모 호출자`**: 락을 잡은 뒤 호출 기기가 **활성이고 child가 아닌지** 확인하고,
  아니면 raise. 쓰기 뒤에는 `count(*) where revoked_at is null and not child >= 1`을 확인해 아니면
  raise(롤백). `set_device_child`·`remove_device` 둘 다 이 두 검사를 한다. 낡은 관리 화면(다른
  부모 기기가 방금 이 기기를 아이로 바꾼 뒤)이 그대로 남아 있을 수 있으므로 「UI 경로가 없다」에
  기대지 않는다(리뷰 1라운드 #2)
- **`set_device_child(p_id text, p_child boolean)` 신설.** 순서가 계약이다(`remove_device`와 같은 틀):
  1. 호출 기기 미등록 → raise
  2. `p_id` null·빈·길이 > 64 → raise, `p_child` null → raise
  3. `p_id is not distinct from dev` → `{error: '지금 쓰는 기기는 바꿀 수 없어요'}`
  4. advisory lock(`hashtext('haruchi'), hashtext('devices')` — `remove_device`·`claim_invite`와 같은 락)
  5. 부모 호출자 재확인(위 공통 가드) → 아니면 raise
  6. `update devices set child = p_child where id = p_id and revoked_at is null` — 0행이면
     `{error: '이미 해제된 기기예요'}`
  7. 부모 기기 ≥ 1 확인(공통 가드) → 아니면 raise
  8. `write_log`에 `('device:'||p_id, 'device-child' | 'device-parent')`
- **`remove_device`에 공통 가드를 넣는다**(락 뒤 부모 호출자 재확인, delete 뒤 부모 ≥ 1).
  아이 대상 삭제는 **막지 않는다** — 아이 기기가 잠긴 채 남지 않는 보증은 서버가 아니라
  클라이언트의 「unauthorized면 표식을 지운다」(§3)가 진다. 서버에서 막으면 「부모 기기로」 직후
  해제(폰이 아직 못 받음)·대시보드 차단(`revoked_at`) 경로가 여전히 새고, 오히려 차단된 아이
  행을 앱에서 못 지우게 된다(리뷰 1라운드 #1·#3)

## 3. 클라이언트가 표식을 받는 길 (`src/data/sync.ts`, `src/data/db.ts`)

- `DeviceState`에 `child: boolean` 추가. 기존 저장본에 없으면 `false`로 읽는다(`pin`과 같은
  기기 로컬 캐시 — 백업·동기화 대상 아님)
- **새 함수 `pullDeviceFlag(): Promise<boolean>`** — `pullConfig()`(PIN)와 별개 함수, 별개
  try. `my_device()`를 불러 `DeviceState.child`에 캐시하고 바뀌었는지를 돌려준다. 실패
  (네트워크·5xx·raise·형식 불일치)는 삼키고 캐시를 유지한다 — 한 번 잠긴 기기는 오프라인이어도
  잠긴 채다(fail-closed)
- **`pullPass`의 자리**: `pullMeta()` 직후 —
  - `'unauthorized'`면 **`child`를 false로 지우고**(바뀌었으면 changed) 끝낸다. 서버가 이 키를
    모르면 더는 관리되는 기기가 아니고, 아이는 자기 키를 스스로 거부당하게 만들 수 없다.
    이것이 해제·차단·재등록 전 공백 등 **모든 「서버가 잊은 아이 기기」의 복구 경로**다
    (리뷰 1라운드 #1·#3)
  - 그 외(`'rebase'` 포함)면 `pullDeviceFlag()`를 부른다. 재기준화 대기는 generation 문제이지
    키 신뢰 문제가 아니라, 재기준화가 계속 실패해도 표식은 내려와야 한다(리뷰 1라운드 #4).
    그 뒤 기존 흐름(rebase 가드 → suspend 가드 → pullConfig → pullDays)은 그대로
  - 반환 `changed`에 OR한다 → `onPullApplied`가 지금 화면을 다시 그린다(§4 판정 재실행)
- **`pullMeta`의 unauthorized 판정을 좁힌다**: 응답이 배열이 아니면 throw(패스 실패, 캐시
  유지). `'unauthorized'`는 **배열이고 비어 있을 때만** — `serverStatus`(`sync.ts:135`)와 같은
  기준. 이 결과가 이제 잠금을 푸므로, JSON 객체로 200을 주는 프록시·포털이 폰을 열지 못하게
  한다(리뷰 2라운드 #2)
- `DeviceState.child`: `normalizeDeviceState`는 `child === true`만 true(없으면 false),
  `freshDeviceState`는 `child: false`. 기존 저장 경로(초기화·가져오기·재기준화·시딩)는 전부
  `...s` 전개라 보존된다(리뷰 확인)
- **재등록**: 새 서버 행은 `child = false`다. 로컬 캐시는 `claimInvite`가 건드리지 않고 다음
  pull이 false로 덮는다. 즉 재등록한 아이 기기는 표식을 다시 켜야 한다

## 4. 차단 (`src/main.ts`, `src/screens/home-child.ts`)

- `route()`에서 **PIN 게이트보다 앞**, `try` 안: `configured() && device.deviceKey !== null && device.child`이고
  해시가 `PARENT_HASHES` 중 하나면 `navigate('#/')` 후 `return`. 렌더하지 않는다
  - `deviceKey !== null` 조건: 미등록 기기에 남은 낡은 표식이 기기를 잠그지 않게.
  - `configured()` 조건: 새 배포에서 동기화 설정을 비우면 pull이 영영 돌지 않아 표식을 풀
    방법이 없다 — 동기화가 꺼지면 이 기능도 꺼진다(리뷰 1라운드 #7)
  - 라우터 한 곳에 두는 이유는 PIN 게이트와 같다 — 화면마다 두면 삼항연산자 속 `navigate`
    같은 샛길이 샌다. 이 판정 하나가 버튼·주소 직접 입력·뒤로 가기를 모두 덮는다
- 아이 홈의 「부모 →」 버튼: 아이 기기에서는 그리지 않는다. 막는 것은 라우터이고 이것은
  죽은 버튼을 안 보이게 하는 표시 문제다
- **예외 하나(수용)**: 폰에서 `#/grade` 채점이 진행 중(`isGrading()`)일 때 표식이 도착하면
  `onPullApplied`가 재렌더를 건너뛰어 그 화면이 남는다. 다음 이동부터 막힌다. 아이 기기에서
  아빠가 채점 중인데 동시에 아이 기기로 바꾸는 상황이라 수용한다
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
- 아이 기기 줄의 「연결 해제」 확인 다이얼로그에 한 줄 추가: 「해제하면 이 기기에서 부모
  화면이 다시 열려요(PIN이 있으면 PIN으로 막혀요).」(리뷰 2라운드 #1)
- 서버 문자열은 지금처럼 `textContent`로만 넣는다

## 6. 알려진 한계

- **최초 적용 창.** 표식을 켠 뒤 아이 기기가 pull 한 번을 돌기 전까지는 열려 있다. 앱을
  열면(아이 홈 라우팅) pull이 돌고, 적용되면 재렌더된다. 표식을 켠 직후 아이 기기에서
  앱을 한 번 열어 「부모 →」가 사라졌는지 확인하는 것이 운영 절차다
- **해제·차단(대시보드 `revoked_at`)된 아이 기기**는 다음 pull에서 `unauthorized` → 표식이
  지워져 부모 화면이 열린다. **이미 받은 기록(오늘 문제지 포함)이 로컬에 남아 있어 채점 화면이
  정답을 보여줄 수 있다.** 남는 방어는 캐시된 PIN 게이트뿐이다(`#/grade`·`#/report`·
  `#/manage`). 수용 — 해제는 「이 기기를 더는 관리하지 않는다」는 결정이고, 다이얼로그가 이를
  말한다(§5). 폰을 계속 아이 기기로 두려면 해제하지 않는다
- **차단 해제(`revoked_at`을 다시 null로)**하면 옛 키가 다시 통해 다음 pull이 `child = true`를
  복원한다 — 다시 잠기는 것이 정상이다
- **아이가 폰의 웹사이트 데이터를 지우면** IndexedDB 전체가 사라져 미등록 빈 기기가 된다.
  부모 화면이 열리지만 기록이 없어 정답이 없다(인쇄는 빈 칸). 해악 없음
- **최초 서버(meta 행 없음)**: `pullMeta`가 `unauthorized`로 읽혀 표식이 지워진다. 새 배포의
  첫 push 전 창에만 있는 일이라 수용
- 아이 기기도 스프린트 기록은 평소대로 push한다 — 기록 권한은 바뀌지 않는다

## 7. 테스트·검증

- `engine/`에 새 순수 로직이 없다(판정은 라우터 한 줄). DOM 테스트는 하지 않는다(설계 §12)
- `schema.sql`: 같은 DB에 두 번 연속 적용해 오류 없음(멱등)
- 실기기: 아이패드 관리 화면에서 「이서아」를 아이 기기로 → 폰에서 앱 열기 → 「부모 →」
  사라짐, `#/parent`·`#/grade` 직접 입력 시 아이 홈으로 → 아이패드에서 「부모 기기로」 →
  폰 재오픈 시 복귀. 서버: 아이 기기 호출자·자기 자신·부모 0대가 되는 전환/해제가 거부되는지
  (SQL 직접 호출). 재등록 후 표식이 풀려 있는지

## 8. PRD 영향

§3(역할과 화면 소속)에 「아이 기기에서는 부모 소속 화면 전체가 라우터에서 막힌다」 한 단락,
§6(PIN 게이트) 옆에 표식의 소유자(관리 화면·`devices.child`)를 적는다. 구현 커밋과 같은 커밋.
