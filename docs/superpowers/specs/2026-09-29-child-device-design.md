# 아이 기기 — 부모 화면 완전 차단

2026-09-29. 딸(이서아)의 폰이 생겨 동기화로 등록됐다(기기 목록 label 「이서아」). 그 폰에서
부모 소속 화면 전부를 막는다.

## 0. 결정 (사용자)

- **완전 차단.** 아이 기기에서는 부모 소속 해시(`#/parent`·`#/print`·`#/grade`·`#/report`·
  `#/manage`) 어디에도 들어가지 못한다. PIN으로 여는 경로도 두지 않는다 — PIN을 알아도
  못 연다. 인쇄·채점·관리는 부모 기기에서만 한다(2026-10-01 단서: 부모 기기가 모두 3일 넘게
  쉬면 표식 없는 새 기기로 PIN 연결이 열린다 — `2026-10-01-pin-device-claim-design.md` §0.1)
- **표식은 Supabase SQL로 켜고 끈다**(2026-09-29 사용자 결정 — 화면 토글 대신 데이터 보정).
  PIN(`app_config.pin`)과 같은 「SQL 전용 설정」 규약이다. 서버 `devices` 행에 저장되고 아이
  기기는 pull로 받는다. 앱 안의 전환 UI·전환 RPC는 만들지 않는다 — 한 번 켜면 거의 바뀌지
  않는 값이다. 자주 바꾸게 되면 그때 관리 화면 토글을 추가한다

## 1. 왜 서버 표식인가

아이 기기에서 부모 화면이 막히므로, 아이 기기 스스로 표식을 끄는 UI는 존재할 수 없다.
기기 로컬 표식이면 해제 = 사이트 데이터 삭제 후 재등록이 된다. 서버 표식이면 SQL로 끄고
아이 기기의 다음 pull이 받는다.

## 2. 서버 (`supabase/schema.sql`, 멱등 유지)

```sql
alter table devices add column if not exists child boolean not null default false;
```

- **`list_devices()`** 응답 객체에 `'child', d.child`를 싣는다
- **`my_device()` 신설** — `security definer`, 반환 `jsonb {child}`. `haruchi_device()`가
  null이면 raise(미등록). `devices`에 RLS 정책이 없어 클라이언트가 자기 행을 읽는 유일한 길이다
- 켜고 끄기는 SQL 한 줄(`supabase/README.md`에 절 추가):

  ```sql
  update devices set child = true where label = '이서아';   -- 끌 때는 false
  ```

- `remove_device`는 바꾸지 않는다. 아이 대상 해제를 서버에서 막지 않는다 — 아이 기기가 잠긴 채
  남지 않는 보증은 클라이언트의 「unauthorized면 표식을 지운다」(§3)가 진다(리뷰 1라운드 #1·#3).
  전환 RPC가 없으므로 「부모 기기 0대」 경쟁(리뷰 1라운드 #2)도 앱 경로에서는 생기지 않는다 —
  SQL로 부모 기기를 잘못 표식하면 같은 SQL로 되돌린다

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

## 5. 표시 (`src/screens/manage.ts`)

「연결된 기기」 목록(읽기 전용):

- 줄 이름 뒤에 아이 기기면 ` · 아이 기기` 표기 — SQL이 먹었는지 부모 기기에서 확인하는 자리
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
- 실기기: SQL로 「이서아」 `child = true` → 아이패드 관리 화면에 「· 아이 기기」 → 폰에서 앱
  열기 → 「부모 →」 사라짐, `#/parent`·`#/grade` 직접 입력 시 아이 홈으로 → SQL로 `false` →
  폰 재오픈 시 복귀
- 적용 순서 무관: 스키마 전에 앱이 배포되면 `my_device` 404 → 실패 삼킴(캐시 false 유지),
  `list_devices`의 `child` 없음 → false

## 8. PRD 영향

§3(역할과 화면 소속)에 「아이 기기에서는 부모 소속 화면 전체가 라우터에서 막힌다」 한 단락,
§6(PIN 게이트) 옆에 표식의 소유자(SQL·`devices.child`, `supabase/README.md`)를 적는다. 구현 커밋과 같은 커밋.
