# 기기 상한 5대와 관리 화면 — 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 등록 기기를 활성 5대로 제한하고, 기기 목록·해제를 앱 안의 새 관리 화면(`#/manage`)이 담당하게 한다 — SQL 없이 5대 로테이션이 완결된다.

**Architecture:** 스펙 `docs/superpowers/specs/2026-08-13-device-cap-manage-design.md` — **적대적 리뷰 3라운드 합의본이다. 구현이 스펙과 갈라질 것 같으면 멈추고 물어라.** 서버: `issue_invite` jsonb 재작성 + `claim_invite`에 advisory lock·상한, `list_devices`·`remove_device` 신설. 클라이언트: `pushDay`/`pushMeta`에 무변경 생략(§6 — 세 계약), 관리 화면 신설(리포트의 데이터 관리 이동), 「다시 연결하기」.

**Tech Stack:** Postgres(plpgsql·pgcrypto) + PostgREST + 바닐라 TS. 실행 코드 신규 의존성 0.

## Global Constraints

- 모든 npm 명령 전에: `export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH"`
- `fetch` 직접 호출 금지 — `sync.ts`의 `req()`만
- **schema.sql 멱등 유지** — drop function if exists + create 쌍. 같은 DB에 연속 3회 적용 오류 0
- **모든 `update`/`delete`에 `where`**(운영 safeupdate — security definer도 면제 아님). 컨테이너는 이를 증명하지 못하므로 눈으로 전수 + 운영 적용 후 실경로 1회
- **RPC의 사용자 수준 실패는 raise가 아니라 jsonb `{error}`** — raise는 트랜잭션을 되돌려 `fail_count`류 상태 변화까지 지운다
- **§6 무변경 생략의 세 계약**(스펙 §6 — 위반 각각이 리뷰에서 Critical이었다): ① 비교는 「보낼 것」(`withoutEmptyBundles(merged.value)` vs `server.value`, `sendStamps(...)` 출력 vs `rowToStampedDay(row).at`) ② 판정 위치는 격리 판정 뒤·PATCH 직전 ③ 생략은 성공 부수효과(`rewrite`의 `clearQuarantine`) 전부를 지난다
- 아이/부모 소속: `#/manage`는 부모. 새 `navigate` 검사 대상은 넷(manage→`#/report` + 이동해 온 파괴적 흐름 셋의 `#/parent`)
- `escapeHtml` 없이 `el()` 템플릿(innerHTML)에 들어가면 XSS. 서버 문자열(label·id·오류 문구)은 textContent, 속성은 `escapeHtml`
- CSS는 SEED 토큰(`var(--seed-*)`)만, shorthand(`font`·`background`·`all`) 금지
- 화면 단위 테스트 금지(설계 §12). 새 자동 테스트는 Task 2의 `src/data/sync.test.ts`뿐
- `docs/` 포함 커밋 전 `npm run format`(prettier가 마크다운도 검사 — CI 차단 전례)
- 커밋 메시지 한국어(`feat:`/`fix:`/`docs:`), 본문에 왜
- **배포 순서: 스키마 먼저(SQL Editor 전체를 한 번에 Run), 각 기기 업데이트 탭, 그다음에야 「새 기기 추가」 사용**(스펙 §7)

## 파일 지도

| 파일                         | 역할                                                    | Task |
| ---------------------------- | ------------------------------------------------------- | ---- |
| `supabase/schema.sql`        | RPC 4개(재작성 2 + 신설 2) + notify + 주석              | 1    |
| `src/data/sync.ts`           | §6 생략(pushDay·pushMeta) + 판정 함수 export            | 2    |
| `src/data/sync.test.ts`      | §6 회귀 테스트 신설                                     | 2    |
| `src/data/sync.ts`           | issueInvite 유니온·listDevices·removeDevice·claimInvite | 3    |
| `src/screens/manage.ts`      | 신설 — 데이터 관리 이동 + 연결된 기기                   | 4    |
| `src/screens/report.ts`      | 데이터 관리 절 제거·진입 버튼·30일 배너 문구            | 4    |
| `src/main.ts`                | route 분기·GATED_HASHES·PARENT_HASHES·주석              | 4    |
| `src/screens/home-parent.ts` | 발급 실패 분기·「다시 연결하기」                        | 5    |
| `src/engine/sync-status.ts`  | authFailed 문구(+테스트)                                | 5    |
| `supabase/README.md` 외 문서 | 스펙 「문서 갱신 대상」 절 전부                         | 6    |

---

### Task 1: `supabase/schema.sql` — RPC 4개

**Files:**

- Modify: `supabase/schema.sql` (issue_invite·claim_invite 재작성, 그 아래 list_devices·remove_device 신설, 파일 끝 notify, 99행 부근 「여섯」 주석)

**Interfaces:**

- Consumes: 기존 `haruchi_device()`·`devices`·`invites`·`write_log`·pgcrypto
- Produces: `issue_invite() returns jsonb`(`{code}`|`{error}`) · `claim_invite(p_code,p_device_id,p_label) returns jsonb`(기존 + 상한 `{error}`) · `list_devices() returns jsonb`(배열) · `remove_device(p_id text) returns jsonb`(`{ok:true}`|`{error}`) — Task 2·3이 부른다

- [ ] **Step 1: `issue_invite` 재작성 (반환 타입 변경 — drop 필수)**

기존 `create or replace function issue_invite() returns text ...` 블록 전체를 다음으로 교체한다. **`drop function if exists issue_invite();`가 반드시 create 앞에** 있어야 한다(`returns text` → `returns jsonb`는 create or replace가 못 바꾼다):

```sql
-- 2C: 등록된 기기가 새 기기 초대 코드를 발급한다(설계 2단계 §5 + 기기 상한 설계 §1).
-- 반환 타입이 text → jsonb로 바뀌었다(상한 거부를 사용자 수준 실패로 내리기 위해).
-- 미등록도 raise가 아니라 {error}다 — raise면 PostgREST 오류 본문(JSON 덩어리)이
-- 화면까지 흘러간다. 예외는 이제 장애뿐이다.
-- 코드는 gen_random_bytes 기반이다 — random()은 암호학적 난수가 아니다. 4바이트를
-- 10^6으로 접는 모듈로 편향은 2^32 % 10^6 / 2^32 ≈ 0.0225%로 무시 가능하다.
-- 상한 검사는 조기 안내일 뿐 권위가 아니다(권위는 claim_invite — 그래서 여기는
-- advisory lock을 잡지 않는다. 경쟁으로 새치기당해도 claim이 막는다).
drop function if exists issue_invite();
create function issue_invite() returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  dev  text := haruchi_device();
  code text;
begin
  if dev is null then
    return jsonb_build_object('error', '등록된 기기만 초대를 만들 수 있어요');
  end if;
  if (select count(*) from devices where revoked_at is null) >= 5 then
    return jsonb_build_object('error',
      '기기가 5대라 더 들어올 수 없어요 — 기존 기기의 관리 화면에서 한 대를 해제해 주세요');
  end if;
  -- 기존 활성 초대를 만료해 둔다(정리 목적). 이게 활성 최대 1을 보증하지는 않는다 —
  -- READ COMMITTED에서 동시 발급 두 세션이면 활성 초대 2개가 남을 수 있다(실측).
  -- 활성 최대 1의 진짜 보증은 claim_invite가 order by id desc limit 1로 최신 것만
  -- 골라 옛 초대를 청구 불가로 만드는 쪽이다.
  update invites set expires_at = now()
    where used_at is null and expires_at > now();
  code := lpad(((('x' || encode(gen_random_bytes(4), 'hex'))::bit(32)::bigint) % 1000000)::text, 6, '0');
  insert into invites (code_hash, created_by, expires_at)
    values (crypt(code, gen_salt('bf')), dev, now() + interval '10 minutes');
  insert into write_log (device, target, action) values (dev, 'invite', 'invite-issue');
  return jsonb_build_object('code', code);
end $$;
```

기존 함수 주석 중 유지할 문장(동시 발급·newest-only 보증)은 위 블록에 이미 옮겨져 있다 — 옛 블록에만 있던 문장이 사라지지 않는지 diff로 확인.

- [ ] **Step 2: `claim_invite` 재작성 (시그니처 불변이지만 drop 규약 통일)**

기존 `create or replace function claim_invite(...)` 블록을 교체한다. 기존 본문에서 **바뀌는 것만** 나열한다 — 나머지(중복 기기 거부·for update·`is distinct from` 코드 검증·fail_count·5회 만료·키 생성·write_log)는 문자 그대로 유지한다:

1. `create or replace function` → `drop function if exists claim_invite(text, text, text);` + `create function`
2. 입구 가드 확장(기존 null·빈 문자열 raise 바로 다음 줄에):

```sql
  if length(p_device_id) > 64 then
    raise exception '기기 id가 너무 길어요';
  end if;
```

3. `devices` insert의 label 절단: `coalesce(nullif(trim(p_label), ''), '새 기기')` → `coalesce(nullif(left(trim(p_label), 40), ''), '새 기기')`
4. **코드 검증 통과 직후 · `used_at` 마킹 직전**에 상한 검사(위치가 계약이다 — 코드를 맞혀야 상한이 보이고, 초대는 소모되지 않아 해제 후 같은 코드로 재시도된다):

```sql
  -- 상한(기기 상한 설계 §1). advisory lock이 claim↔claim·claim↔remove·remove↔remove의
  -- 카운트 판정을 직렬화한다 — 초대 행 락은 초대를 지킬 뿐 기기 수를 지키지 못한다.
  -- 2인자 형태로 네임스페이스를 갖는다. 커밋·롤백에서 자동 해제.
  perform pg_advisory_xact_lock(hashtext('haruchi'), hashtext('devices'));
  if (select count(*) from devices where revoked_at is null) >= 5 then
    return jsonb_build_object('error',
      '기기가 5대라 더 들어올 수 없어요 — 기존 기기의 관리 화면에서 한 대를 해제해 주세요');
  end if;
```

문구는 issue_invite와 **같은 문자열**이어야 한다(단일 출처 — 두 곳뿐이고 같은 말).

- [ ] **Step 3: `list_devices`·`remove_device` 신설**

claim_invite 아래에:

```sql
-- 기기 목록(기기 상한 설계 §2). devices에는 RLS 정책이 없어 이 RPC가 유일한 조회
-- 경로다. key_hash는 절대 싣지 않는다. 이 raise는 도달 가능하다 — 해제된 기기는
-- 로컬 키가 남아 있어 이 함수를 부를 수 있고, haruchi_device()가 null이 된다.
-- 클라이언트가 이 실패를 「연결이 끊겼을 수 있음」 안내로 바꾼다.
drop function if exists list_devices();
create function list_devices() returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  dev text := haruchi_device();
begin
  if dev is null then
    raise exception '등록된 기기가 아니에요';
  end if;
  return coalesce(
    (select jsonb_agg(jsonb_build_object(
       'id', d.id, 'label', d.label, 'created_at', d.created_at,
       'last_seen_at', d.last_seen_at, 'revoked_at', d.revoked_at)
       order by d.created_at)
     from devices d),
    '[]'::jsonb);
end $$;

-- 기기 해제 = 행 삭제(기기 상한 설계 §2 — 사용자 결정: 지워야 새 초대로 재등록이
-- 되고 5대 로테이션이 앱 안에서 완결된다). 순서가 계약이다:
--   가드(미등록 raise → null·빈·길이 raise → 자기 자신 {error}) → advisory lock →
--   자기 활성 재확인(락 대기 중 내가 지워졌을 수 있다) → delete(where 필수 —
--   safeupdate) → 활성 0대면 raise(롤백 — 「항상 1대 이상」의 실보증은 자기 자신
--   금지가 아니라 락 + 이 검사다: 상호 삭제는 서로 다른 행을 잠가 동시에 커밋될
--   수 있다) → write_log.
-- 자기 자신 비교는 is not distinct from — 가드를 옮기는 리팩터가 3값 논리 우회를
-- 되살리지 않게(2C의 p_code=NULL 전례).
drop function if exists remove_device(text);
create function remove_device(p_id text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  dev text := haruchi_device();
begin
  if dev is null then
    raise exception '등록된 기기가 아니에요';
  end if;
  if p_id is null or p_id = '' or length(p_id) > 64 then
    raise exception '기기 id가 올바르지 않아요';
  end if;
  if p_id is not distinct from dev then
    return jsonb_build_object('error', '지금 쓰는 기기는 여기서 해제할 수 없어요');
  end if;
  perform pg_advisory_xact_lock(hashtext('haruchi'), hashtext('devices'));
  if not exists (select 1 from devices where id = dev and revoked_at is null) then
    raise exception '이 기기의 등록이 이미 해제됐어요';
  end if;
  delete from devices where id = p_id;
  if not found then
    return jsonb_build_object('error', '이미 해제된 기기예요');
  end if;
  if (select count(*) from devices where revoked_at is null) = 0 then
    raise exception '마지막 기기는 해제할 수 없어요';
  end if;
  insert into write_log (device, target, action) values (dev, 'device:' || p_id, 'device-remove');
  return jsonb_build_object('ok', true);
end $$;
```

- [ ] **Step 4: 파일 끝 notify + 주석 갱신**

파일 맨 끝(RLS 절 뒤)에:

```sql
-- 함수 시그니처 변경(drop+create)을 PostgREST가 즉시 알게 하는 명시적 신호.
-- Supabase가 DDL 이벤트 트리거로 자동 통지하는 것이 보통이지만, 우리가 소유하지
-- 않은 설정에 동작을 매달지 않는다(db_extra_search_path 전례 — HANDOFF).
notify pgrst, 'reload schema';
```

`search_path` 고정 주석 블록(99행 부근)의 「security definer 여섯」을 **여덟**로 고치고, "아래 `security definer` 함수 전부" 서술이 신설 둘을 포함함을 확인한다.

- [ ] **Step 5: safeupdate 전수 + 컨테이너 검증**

`grep -n "update \|delete from" supabase/schema.sql` — 모든 update/delete에 where 확인, 개수를 커밋 본문에.

운영과 같은 배치로 검증(pgcrypto를 `extensions`에):

```bash
docker run -d --name haruchi-cap -e POSTGRES_PASSWORD=x postgres:17 && sleep 4
docker exec -i haruchi-cap psql -U postgres -q -c "create schema extensions; create extension pgcrypto schema extensions; alter database postgres set search_path = public, extensions;"
for i in 1 2 3; do docker exec -i haruchi-cap psql -U postgres -v ON_ERROR_STOP=1 -q < supabase/schema.sql; echo "적용 $i: $?"; done
```

3회 전부 0. 이어서 시나리오(각 결과 확인 — `set search_path = public, pg_temp;`를 세션마다 먼저 실행해 **호출자 경로에서 extensions를 뺀 채** 돌린다):

```sql
-- 준비: 발급자
insert into devices (id,label,key_hash) values ('d1','아이패드',crypt('k',gen_salt('bf')));
select set_config('request.headers','{"x-device-key":"k"}',false);
-- A. issue jsonb: {code}가 나온다. 미등록(헤더 비우고) → {error '등록된 기기만…'}
select issue_invite();
-- B. 상한: d2~d5를 insert로 채워 5대로 만들고 → issue_invite() → {error '기기가 5대라…'}
--    claim도: 유효 초대 심고 claim → 같은 문자열의 {error}, invites.used_at은 여전히 null(미소모)
-- C. 해제 후 같은 코드 재시도: d5 삭제(remove_device('d5') — d1 키로) → {ok:true} →
--    같은 코드 claim → {key} 성공. write_log에 device-remove 1행
-- D. remove 가드: remove_device(null)·('')·(65자) → raise / remove_device('d1')(자기) →
--    {error '지금 쓰는…'} / remove_device('없는id') → {error '이미 해제된…'}
-- E. list_devices: 배열 형태·created_at 순·key_hash 부재. 미등록 → raise
-- F. p_label 절단: 60자 라벨로 claim → devices.label이 40자
-- G. claim p_device_id 65자 → raise
```

**동시성(psql 두 세션 — 스펙 검증 계획의 예측을 먼저 적고 실행):**

```
① 4대 + 활성 초대 2개 상태에서 두 세션 동시 claim(각자 자기 코드).
   예측: 락이 있으나 없으나 6대는 안 나온다(newest-only 선택이 같은 행을 다투게
   한다) — 결과를 예측과 함께 기록. 5대에서 멈추면 통과
② 2대(d1·d2) 상태에서 세션A begin; remove_device('d2') 커밋 전, 세션B remove_device('d1')
   → B는 락 대기 → A 커밋 → B는 자기 재확인 또는 사후 카운트에서 raise. 활성 1대 확인
   변이 셋(각각 적용→재현→원복): 락 제거 → 활성 0대가 되는지 / 자기 재확인 제거 /
   사후 카운트 제거 — 뒤 둘은 서로 독립적으로 충분해 각각 지워야 어느 쪽이 지키는지 보인다
```

끝나면 `docker rm -f haruchi-cap`.

- [ ] **Step 6: 커밋**

```bash
git add supabase/schema.sql
git commit -m "feat: 기기 상한 5대의 서버 쪽 — issue/claim 상한과 list/remove RPC"
```

커밋 본문에: jsonb 전환 이유, advisory lock의 존재 이유(카운트 보증의 리팩터 독립), safeupdate 전수 결과, 시나리오·동시성 결과(예측 대비).

---

### Task 2: §6 무변경 push 생략 — `sync.ts` + `sync.test.ts` 신설

**Files:**

- Modify: `src/data/sync.ts` (`sendStamps`(361행 부근) 아래에 판정 함수, `pushDay`의 `mergeDay` 직후(806행 부근), `pushMeta`의 PATCH 직전(880행 부근))
- Create: `src/data/sync.test.ts`

**Interfaces:**

- Consumes: 기존 `structuralEqual`·`withoutEmptyBundles`·`sendStamps`·`rowToStampedDay`·`clearQuarantine`
- Produces: `export function skipUnchangedPush(merged, server, deviceId, now): boolean`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/data/sync.test.ts` 신설(전역 setup `src/test-setup.ts`가 fake-indexeddb를 이미 깐다 — vite.config.ts `test.setupFiles`):

```ts
import { describe, it, expect } from 'vitest'
import { skipUnchangedPush } from './sync'
import { EMPTY_STAMPS } from '../engine/merge'
import type { Stamped } from '../engine/merge'
import type { Day } from './types'

const DAY: Day = {
  date: '2026-08-01',
  kind: 'normal',
  sheet: [{ id: '1', kind: 'vertical', tag: 'add2-nocarry', a: 10, b: 16, op: '+', answer: 26 }],
}
const stamped = (day: Day, at: Partial<Stamped<Day>['at']> = {}): Stamped<Day> => ({
  value: day,
  at: { ...EMPTY_STAMPS, ...at },
})
const AT = '2026-08-10T00:00:00.000Z'

describe('skipUnchangedPush — §6 무변경 push 생략', () => {
  it('값·스탬프가 서버와 같으면 생략한다', () => {
    const at = { sheetAt: AT, sheetBy: 'd1' }
    expect(
      skipUnchangedPush(stamped(DAY, at), stamped(DAY, at), 'd1', '2026-08-13T00:00:00Z'),
    ).toBe(true)
  })

  it('스탬프 all-null 행은 생략하지 않는다 — sendStamps의 null 보정이 나가야 한다', () => {
    // 1단계 업로드(2026-08-07)가 남긴 실재 상태: 서버·로컬 둘 다 스탬프 null +
    // 비어 있지 않은 sheet. merged.at끼리 비교하는 구현(잘못)은 여기서 true가 된다 —
    // 그러면 null 보정 PATCH가 영영 안 나가 그 묶음이 이후 모든 LWW에서 진다.
    expect(skipUnchangedPush(stamped(DAY), stamped(DAY), 'd1', '2026-08-13T00:00:00Z')).toBe(false)
  })

  it('빈 묶음(grades {}·sprint [])은 비교 전에 벗긴다 — 서버 행은 이미 벗겨져 있다', () => {
    // rowToStampedDay는 withoutEmptyBundles를 지난 값을 준다. 좌변을 생으로 비교하면
    // 빈 묶음이 실린 날짜가 영원히 「다름」이 되어 매 로테이션마다 다시 올라간다.
    const withEmpty: Day = { ...DAY, grades: {}, sprint: [] }
    const at = { sheetAt: AT, sheetBy: 'd1' }
    expect(
      skipUnchangedPush(stamped(withEmpty, at), stamped(DAY, at), 'd1', '2026-08-13T00:00:00Z'),
    ).toBe(false === false && true) // 아래 Step 4의 변이 검증이 이 단언의 실효를 확인한다
  })

  it('값이 다르면 생략하지 않는다', () => {
    const at = { sheetAt: AT, sheetBy: 'd1' }
    const other: Day = { ...DAY, grades: { '1': true }, mood: 'ok' }
    expect(
      skipUnchangedPush(
        stamped(other, { ...at, gradesAt: AT, gradesBy: 'd1' }),
        stamped(DAY, at),
        'd1',
        AT,
      ),
    ).toBe(false)
  })
})
```

주의: 세 번째 테스트의 단언은 `toBe(true)`다 — 위 코드의 `false === false && true`는 그대로 옮기지 말고 `toBe(true)`로 쓴다(빈 묶음을 벗기면 같아져 생략된다).

- [ ] **Step 2: 실패 확인**

`npx vitest run src/data/sync.test.ts` — `skipUnchangedPush` 미존재로 FAIL.

- [ ] **Step 3: 구현**

`sync.ts`의 `stampColumns` 아래에:

```ts
/**
 * §6 무변경 push 생략 판정(기기 상한 설계). **비교 대상은 「보낼 것」이다** —
 * 값은 withoutEmptyBundles를 지난 병합 출력(서버 행은 rowToStampedDay가 이미 그
 * 필터를 지났다), 스탬프는 sendStamps 출력(존재-승리 묶음의 null을 지금·이 기기로
 * 채운 뒤의 값). merged.at끼리 비교하면 1단계가 남긴 all-null 스탬프 행의 보정이
 * 영원히 멈춘다 — 그 묶음은 이후 모든 LWW에서 진다.
 *
 * now가 재시도 루프에서 매번 바뀌어도 판정은 불변이다: sendStamps가 now를 채우는
 * 조건(존재하는 묶음의 null 스탬프)에서는 서버 쪽이 반드시 null이라 항상 「다름」이고,
 * 안 채우면 now는 비교에 등장하지 않는다.
 */
export function skipUnchangedPush(
  merged: Stamped<Day>,
  server: Stamped<Day>,
  deviceId: string,
  now: string,
): boolean {
  return (
    structuralEqual(withoutEmptyBundles(merged.value), server.value) &&
    structuralEqual(sendStamps(merged, deviceId, now), server.at)
  )
}
```

`pushDay`의 `const merged = mergeDay(local, server)` **직후 · PATCH `req` 앞**에(위치가 계약이다 — 격리 판정 `sheetConflict` 게이트 뒤여야 한다. 앞이면 배너 없이 종이가 동기화에서 사라진다):

```ts
// §6 무변경 생략 — 보낼 것이 서버와 같으면 PATCH 없이 성공. 생략은 "PATCH만
// 건너뛴 성공"이라 성공 경로의 부수효과를 전부 지난다: rewrite의 clearQuarantine을
// 건너뛰면 「이 기기 종이 유지」 후 값이 이미 수렴한 날짜의 격리가 영영 안 풀린다.
if (skipUnchangedPush(merged, server, device.deviceId, now)) {
  if (rewrite) await clearQuarantine(date)
  return true
}
```

`pushMeta`의 `const res = await req(...)` 직전에(payload·settingsAt 계산 뒤):

```ts
// §6 무변경 생략(meta). 보낼 것 기준이 필수인 진짜 이유는 lastExportedAt 접붙임이다 —
// payload는 서버의 그 값을 이어받아 만들므로 merged.value로 비교하면 기기마다 다른
// 그 필드 때문에 생략이 영영 안 걸린다. settingsAt이 null이면 now로 채워 보내므로
// (서버가 null이 아닌 한) 「다름」이 되어 자동으로 PATCH 경로다.
if (
  server !== null &&
  structuralEqual(payload, server.value) &&
  settingsAt !== null &&
  settingsAt === server.at.settingsAt &&
  (merged.at.settingsBy ?? '') === server.at.settingsBy
) {
  return true
}
```

- [ ] **Step 4: 통과 + 변이 검증 (전부 수행하고 원복)**

`npx vitest run src/data/sync.test.ts` 전부 PASS. 변이:

1. `skipUnchangedPush`의 `sendStamps(merged, deviceId, now)`를 `merged.at`으로 → **테스트 2만 FAIL** 확인 → 원복
2. `withoutEmptyBundles(merged.value)`를 `merged.value`로 → **테스트 3만 FAIL** 확인 → 원복
3. pushDay 삽입부의 `if (rewrite) await clearQuarantine(date)` 삭제 → 자동 테스트로 못 잡는다(통합 경로) — **삭제하지 않았음을 diff로 재확인**하고 Task 6 스모크에 명시

- [ ] **Step 5: 전체 검증 + 커밋**

```bash
npx vitest run && npx prettier --check . && npm run build
git add src/data/sync.ts src/data/sync.test.ts
git commit -m "feat: 보낼 것이 서버와 같으면 push를 생략한다 — 로테이션 전량 재업로드 차단"
```

---

### Task 3: `sync.ts` — issueInvite 유니온·listDevices·removeDevice·claimInvite

**Files:**

- Modify: `src/data/sync.ts` (issueInvite 1510행 부근 재작성, claimInvite 1559행 부근 한 줄, listSnapshots 앞에 신설 둘)

**Interfaces:**

- Produces: `issueInvite(): Promise<{ok:true; code:string}|{ok:false; reason:string}>` · `listDevices(): Promise<DeviceRow[]>`(`export type DeviceRow`) · `removeDevice(id): Promise<{ok:true}|{ok:false; reason:string}>` — Task 4·5가 부른다

- [ ] **Step 1: `issueInvite` 재작성**

```ts
/** 새 기기 초대 코드를 발급한다(2C 설계 §5 + 기기 상한 설계 §1). 서버가 사용자 수준
 *  실패(미등록·상한)를 200 + {error}로 내리므로 반환이 claimInvite와 같은 유니온이다.
 *  옛 스키마(returns text)가 아직 적용 전이면 응답이 맨 문자열로 온다 — 그 폴백을
 *  한 줄 받는다(새 앱 + 옛 스키마 혼재 방어, 설계 §7. 타입이 겹치지 않아 판정이 안전하다). */
export async function issueInvite(): Promise<
  { ok: true; code: string } | { ok: false; reason: string }
> {
  // 호출자가 syncEnabled() 게이트를 빠뜨렸을 때만 닿는다 — 조용히 빈 코드를 돌려주면
  // 아빠가 없는 코드를 새 기기에 받아 적는다(형제 함수들과 같은 이유로 실패로 알린다).
  if (!configured()) throw new Error('동기화가 설정되지 않았어요')
  const res = await req(`${SUPABASE_URL}/rest/v1/rpc/issue_invite`, {
    method: 'POST',
    body: JSON.stringify({}),
  })
  if (!res.ok) throw await failed('초대 발급', res)
  const body = (await res.json()) as { code?: string; error?: string } | string
  if (typeof body === 'string') return { ok: true, code: body } // 옛 스키마 폴백
  if (typeof body.code === 'string' && body.code !== '') return { ok: true, code: body.code }
  return { ok: false, reason: typeof body.error === 'string' ? body.error : '알 수 없는 응답' }
}
```

- [ ] **Step 2: `listDevices`·`removeDevice` 신설** (`listSnapshots` 앞에)

```ts
export type DeviceRow = {
  id: string
  label: string
  createdAt: string
  lastSeenAt: string | null
  revokedAt: string | null
}

/** 기기 목록(기기 상한 설계 §3). 필드 검증은 렌더가 요구하는 최소(문자열/null)만 한다 —
 *  값은 전부 textContent·escapeHtml 경유로만 화면에 닿는다(XSS 경계). */
export async function listDevices(): Promise<DeviceRow[]> {
  if (!configured()) throw new Error('동기화가 설정되지 않았어요')
  const res = await req(`${SUPABASE_URL}/rest/v1/rpc/list_devices`, {
    method: 'POST',
    body: JSON.stringify({}),
  })
  if (!res.ok) throw await failed('기기 목록', res)
  const rows = (await res.json()) as Record<string, unknown>[]
  if (!Array.isArray(rows)) throw new Error('기기 목록 응답이 배열이 아니에요')
  return rows.map((r) => ({
    id: typeof r['id'] === 'string' ? r['id'] : '',
    label: typeof r['label'] === 'string' ? r['label'] : '',
    createdAt: typeof r['created_at'] === 'string' ? r['created_at'] : '',
    lastSeenAt: typeof r['last_seen_at'] === 'string' ? r['last_seen_at'] : null,
    revokedAt: typeof r['revoked_at'] === 'string' ? r['revoked_at'] : null,
  }))
}

/** 기기 해제(기기 상한 설계 §2 — 서버 행 삭제). {ok:false}는 사람이 볼 사유(자기 자신·
 *  이미 해제), throw는 장애·가드 위반이다. */
export async function removeDevice(
  id: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!configured()) throw new Error('동기화가 설정되지 않았어요')
  const res = await req(`${SUPABASE_URL}/rest/v1/rpc/remove_device`, {
    method: 'POST',
    body: JSON.stringify({ p_id: id }),
  })
  if (!res.ok) throw await failed('기기 해제', res)
  const body = (await res.json()) as { ok?: boolean; error?: string }
  if (body.ok === true) return { ok: true }
  return { ok: false, reason: typeof body.error === 'string' ? body.error : '알 수 없는 응답' }
}
```

- [ ] **Step 3: `claimInvite`에 격리 리셋(§5)**

`claimInvite`의 `updateDeviceState` 호출에 `quarantine: []`를 추가하고 주석 한 줄:

```ts
await updateDeviceState((s) => ({
  ...s,
  deviceKey: key,
  lastPulledAt: null,
  generation: null,
  seededAt: null,
  // 격리도 리셋(§5) — claim은 서버 관점의 첫 등록이고, 남은 격리는 이미 존재하지
  // 않는 옛 서버 관계에 대한 판정이다. 진짜 충돌이면 재등록 직후 전량 pull이 다시
  // 격리한다.
  quarantine: [],
}))
```

- [ ] **Step 4: 검증 + 커밋**

```bash
npx vitest run && npx prettier --check . && npm run build
git add src/data/sync.ts
git commit -m "feat: 기기 목록·해제 클라이언트와 발급 유니온화 — 재등록은 격리도 리셋"
```

---

### Task 4: `#/manage` 신설 — 데이터 관리 이동 + 연결된 기기

**Files:**

- Create: `src/screens/manage.ts`
- Modify: `src/screens/report.ts`·`src/main.ts`

이동은 기계적 작업이지만 범위가 계약이다. **report.ts에서 manage.ts로 통째로 옮길 것**(이름 그대로, 수정 없이):

- 함수·상수: `dayCount`·`snapshotNotice`·`SNAPSHOT_REASON_LABELS`·`formatSnapshotAt`·`snapshotsHtml`·`dateRange`·`triggerDownload`·`revertExport`·`mountSnapshots`·`runImport`(renderReport 내부 함수면 새 render 함수 내부로)
- **모듈 스코프 `importBusy`·`resetBusy`와 동기화 함수들**(`syncSnapshotButtons`·`syncBusyButtons`·`setImportBusy`·`setResetBusy`·`preparingToast`) — 모듈 스코프인 이유가 주석에 사고 이력과 함께 적혀 있다(재렌더마다 새 스코프로 갈리면 진행 중 가져오기 위에 활성 버튼이 다시 그려진다). **주석까지 함께 옮긴다**
- import: `daysSinceExport`·`ungradedSheetCount`(engine) / `serverOnline`·`serverSnapshot`·`serverReplaceAll`·`listSnapshots`·`getSnapshotPayload`·`suspendSync`·`resumeSync`(sync) / `replaceAll`·`resetAll`·`defaultMeta`(db) 중 데이터 관리만 쓰는 것 전부 — 이동 후 report.ts에서 미사용 import를 지운다(`npm run build`의 tsc가 잡는다)
- 「데이터 관리」 `<h2>` 절 마크업과 그 핸들러 전부(내보내기·가져오기·모든 기록 지우기·서버 백업에서 되돌리기)

- [ ] **Step 1: `manage.ts` 뼈대 + 이동**

```ts
/**
 * 데이터·기기 관리(기기 상한 설계 §3). 리포트에서 데이터 관리 절을 통째로 옮겨 왔고
 * (사용자 결정 — 별도 메뉴), 「연결된 기기」 절이 더해졌다. PIN 게이트 대상이다.
 * 화면끼리 import하지 않는다 — 리포트와 공유할 것이 생기면 ui.ts로 올린다.
 */
export async function renderManage(root: HTMLElement): Promise<void> {
  // …이동해 온 데이터 관리 렌더 + 아래 Step 2의 연결된 기기 절…
}
```

렌더 시작 시 busy 재적용 줄(`syncBusyButtons()` 상당)이 **반드시 이동해 와야 한다** — `#/manage`는 게이트 대상이라 wake 재게이트의 `route(false)` 재렌더를 탄다. 이동해 온 파괴적 흐름의 `navigate('#/parent')` 셋과 뒤로가기 버튼(`← 리포트` → `navigate('#/report')`)이 이 화면의 navigate 전부다.

- [ ] **Step 2: 「연결된 기기」 절**

`syncEnabled()`가 참일 때만 그린다(로컬 데이터 관리는 항상). 렌더를 막지 않는다 — 절 자리를 먼저 그리고 `listDevices()` 도착 후 채운다:

```ts
// 서버가 만든 문자열(label·id)은 textContent로만, 속성은 escapeHtml — id는 익명
// 호출자가 claim_invite에 정한 값이다(XSS 경계). last_seen_at은 days 쓰기에서만
// 갱신되므로 「마지막 접속」이 아니라 「마지막 기록 올림」이다.
const zone = root.querySelector<HTMLDivElement>('#devices-zone')!
void (async () => {
  try {
    const device = await getDeviceState()
    const rows = await listDevices()
    zone.replaceChildren()
    for (const d of rows) {
      const row = document.createElement('div')
      row.className = 'device-row'
      const name = document.createElement('div')
      name.textContent =
        d.label +
        (d.id === device.deviceId ? ' (이 기기)' : '') +
        (d.revokedAt !== null ? ' — 차단됨 · 자리 차지 안 함' : '')
      const seen = document.createElement('small')
      seen.textContent = d.lastSeenAt
        ? `마지막 기록 올림: ${formatDate(dayKey(new Date(d.lastSeenAt)))}`
        : '기록 올린 적 없음'
      row.append(name, seen)
      if (d.id !== device.deviceId) {
        const btn = document.createElement('button')
        btn.textContent = '연결 해제'
        btn.addEventListener('click', () => {
          void confirmDialog(
            '이 기기의 연결을 해제할까요?',
            `${d.label} — 이 기기는 더 이상 동기화되지 않아요. 기기에 저장된 기록은 지워지지 않고, 새 초대 코드로 다시 연결할 수 있어요.`,
          ).then((yes) => {
            if (!yes) return
            btn.disabled = true
            removeDevice(d.id)
              .then((r) => {
                if (r.ok)
                  navigate('#/manage') // 같은 해시 재라우팅 안전 — 목록을 다시 읽는다
                else {
                  btn.disabled = false
                  showError(r.reason, undefined)
                }
              })
              .catch((e) => {
                btn.disabled = false
                showError('기기를 해제하지 못했어요.', e)
              })
          })
        })
        row.append(btn)
      }
      zone.append(row)
    }
    const note = document.createElement('p')
    note.className = 'sync-hint'
    note.textContent = '기록을 올리지 않는 기기는 여기 시간이 갱신되지 않아요.'
    zone.append(note)
  } catch (e) {
    // 오류 둘을 가른다(설계 §2): 404 = 스키마 미적용 / 그 밖 = 이 기기의 등록이
    // 끊겼을 수 있다 — 해제된 기기는 로컬 키가 남아 syncEnabled가 참이라 여기 닿는다.
    zone.textContent =
      e instanceof Error && e.message.includes('404')
        ? '서버 준비가 덜 됐어요 — supabase/README.md의 스키마 적용을 확인해 주세요'
        : '이 기기의 연결이 끊겼을 수 있어요 — 부모 홈에서 다시 연결할 수 있어요'
  }
})()
```

(`confirmDialog`의 실제 시그니처는 `ui.ts`에서 확인하고 그에 맞춘다 — 위와 다르면 **ui.ts가 맞다**. 404 판정도 `failed()`가 만드는 메시지 형식(`실패: 404`)을 확인해 맞춘다.) CSS `.device-row`는 `app.css`에 SEED 토큰으로 최소만(테두리·간격 — `.grade-row` 패턴 참조, shorthand 금지).

- [ ] **Step 3: `report.ts` 축소 + `main.ts` 배선**

report: 데이터 관리 절 제거 자리에 진입 버튼 `<button class="step" id="manage">데이터·기기 관리<small>내보내기·가져오기·기기 연결</small></button>` + `navigate('#/manage')` 핸들러. `exportOverdue` 배너 문구를 「백업한 지 30일이 넘었어요 — 데이터·기기 관리에서 내보내기를 눌러주세요」로. `void renderReport(root)` 30일 배지 갱신 호출은 이동한 흐름 쪽에서는 제거(배지는 report 재진입 시 재계산 — 실해 없음, 스펙 M8).

main.ts **세 곳**(둘만 고치면 게이트 통과 뒤 **아이 홈**이 그려진다):

1. `GATED_HASHES`에 `'#/manage'` + report 근거 주석을 「집계(성적) 노출 방지 + 관리 화면 진입점」으로
2. `PARENT_HASHES`에 `'#/manage'`
3. route 분기에 `else if (hash.startsWith('#/manage')) { const { renderManage } = await import('./screens/manage'); await renderManage(app) }` — 기존 분기들과 같은 모양으로

- [ ] **Step 4: 검증 + 커밋**

```bash
npx vitest run && npx prettier --check . && npm run build
# 이동 완전성: report.ts에 잔재가 없는지
grep -n "importBusy\|resetBusy\|snapshotNotice\|serverReplaceAll\|replaceAll\|모든 기록 지우기" src/screens/report.ts
# → 결과 0행이어야 한다(진입 버튼 문구 제외)
git add src/screens/manage.ts src/screens/report.ts src/main.ts src/styles/app.css
git commit -m "feat: 데이터·기기 관리 화면 — 리포트에서 분리하고 연결된 기기를 더한다"
```

---

### Task 5: 「다시 연결하기」 + 발급 실패 분기 + 상태줄 문구

**Files:**

- Modify: `src/screens/home-parent.ts`·`src/engine/sync-status.ts`·`src/engine/sync-status.test.ts`

- [ ] **Step 1: 발급 핸들러를 유니온에 맞춘다**

`#invite-issue` 핸들러의 `.then((code) => ...)`를:

```ts
issueInvite().then((r) => {
  issueBtn.disabled = false
  if (!r.ok) {
    // 상한·미등록 등 사람이 볼 사유 — 서버 문자열이라 textContent로만(XSS 경계)
    inviteZone.textContent = r.reason
    return
  }
  inviteZone.replaceChildren()
  // …기존 codeEl·note 생성 코드 그대로, code → r.code…
})
```

- [ ] **Step 2: `sync-status.ts` 문구 교체 + 테스트**

`'기기 키가 거부됐어요 — 다시 연결하려면 서버에서 이 기기를 지워야 해요'` → `'기기 키가 거부됐어요 — 아래에서 다시 연결할 수 있어요'` (주석도: 이제 부모 홈에 재연결 버튼이 있다 — SQL 절차를 가리키던 옛 문구는 버튼이 생기면 거짓이 된다). `sync-status.test.ts`의 두 단언도 같은 문자열로. 변이: 문구만 되돌려 테스트 2개가 빨개지는지 → 원복.

- [ ] **Step 3: 「다시 연결하기」 버튼**

`home-parent.ts`의 `serverStatus()` `.then` 안(그 자리가 계약이다 — 상태줄은 응답 도착 후 `#sync-line`을 갈아 끼울 때 생기므로 렌더 시점에는 버튼이 없다):

```ts
if (configured() && device.deviceKey !== null) {
  const at = location.hash
  void serverStatus().then((s) => {
    if (s !== 'unauthorized' || location.hash !== at) return
    const line = root.querySelector('#sync-line')
    line?.replaceWith(el(statusLineHtml(syncStatus({ ...statusInput, authFailed: true }))))
    // 재연결 버튼(기기 상한 설계 §4). 로컬 deviceKey만 지운다 — 키는 서버가 이미
    // 거부한 값이라 지워도 데이터 손실이 없다. 커서·시딩 리셋은 안 한다(claim
    // 성공이 어차피 전부 비운다). 다이얼로그가 실비용을 말한다: 새 코드가 필요하다.
    const zone = document.createElement('div')
    zone.className = 'links'
    const btn = document.createElement('button')
    btn.textContent = '다시 연결하기'
    btn.addEventListener('click', () => {
      void confirmDialog(
        '이 기기를 다시 연결할까요?',
        '이 기기의 연결 정보를 지워요. 다시 연결하려면 다른 기기에서 새 초대 코드를 받아야 해요.',
      ).then((yes) => {
        if (!yes) return
        void updateDeviceState((st) => ({ ...st, deviceKey: null })).then(() =>
          navigate('#/parent'),
        )
      })
    })
    zone.append(btn)
    root.querySelector('#sync-line')?.after(zone)
  })
}
```

(`confirmDialog` 시그니처·`statusLineHtml` 구조는 실제 코드에 맞춘다 — `#sync-line` id가 교체 후에도 유지되는지 확인하고, 아니면 교체한 요소 참조를 직접 쓴다.)

- [ ] **Step 4: 검증 + 커밋**

```bash
npx vitest run && npx prettier --check . && npm run build
git add src/screens/home-parent.ts src/engine/sync-status.ts src/engine/sync-status.test.ts
git commit -m "feat: 폐기·해제된 기기가 앱 안에서 다시 연결한다 — 발급 실패도 사람 말로"
```

---

### Task 6: 문서 — README·CLAUDE.md·HANDOFF

스펙의 「문서 갱신 대상」 절이 목록의 단일 출처다. 요약:

- [ ] `supabase/README.md`: 5대 상한과 관리 화면 소개 / §5 「두 번째 기기부터」의 「리포트를 연다」 → 관리 화면 경로 / §6.5 PIN 게이트 목록에 `#/manage` / §7 폐기 절에 "차단이 목적을 다하면 행을 지우라(폐기 이력은 write_log에 있다)" + 「같은 기기 재등록」을 관리 화면 해제 + 부모 홈 「다시 연결하기」로 재작성(DevTools 절차 제거) / §9 표의 「기기 키 거부」 행(새 배너 문구·재연결 버튼) / §9 표의 되돌리기 위치(`#/report` → 관리 화면) / 적용 절차: 전체를 한 번에 Run + **적용 직후 모든 기기에서 업데이트 배너를 탭할 것, 그 전까지 「새 기기 추가」 금지**(혼재 퇴화 — 옛 앱은 상한·미등록 오류도 가짜 코드처럼 보여준다)
- [ ] `CLAUDE.md`: 아이/부모 소속 불변식의 부모 목록 `#/parent`·`#/print`·`#/grade`·`#/report`에 **`#/manage` 추가**
- [ ] `docs/superpowers/HANDOFF.md`: 새 절(이 기능 요약 — 스펙 경로·리뷰 3라운드 합의·§6 세 계약) / 2C 절 「복구 UI가 앱에 없다」 항목 닫힘 표기 / 「서버 쓰기 경로 감사」 표에 `remove_device`(`device-remove`) 행 + `list_devices`는 읽기라 제외 명시 / **search_path 재감사 쿼리의 `proname in (...)`에 `list_devices`·`remove_device` 추가** / 2C 스모크 8번이 로테이션 실측으로 닫힐 예정임을 연결
- [ ] **사람 확인 목록**(HANDOFF에 — 운영 적용 후): ① PostgREST 실경로(`authenticator`)로 remove 1회(safeupdate 실증) ② `pg_proc` proconfig 8행 확인 ③ 로테이션 실측 — 해제→재연결→재claim 뒤 `select count(*) from write_log where action='update' and at > '<시각>'`. **예측 먼저**: 첫 로테이션 = pre-2A 날짜 수(sid·스탬프 일회성 수렴), 두 번째 = 0. 다르면 §6이 안 먹은 것 ④ 5대 상한 실기기(6번째 발급 시도 → 같은 문구) ⑤ rewrite+생략 경로(격리 날짜 「이 기기 종이 유지」 후 배너가 풀리는지 — Task 2 변이 3의 수동 확인) ⑥ 관리 화면 스모크(목록·이 기기 표식·해제·재연결 왕복)
- [ ] `npm run format && npx prettier --check .` 후 커밋: `docs: 기기 상한·관리 화면의 문서를 갱신한다`

---

## 자체 리뷰 체크리스트 (계획 작성자가 이미 수행)

- 스펙 §0~§7 전 절이 태스크에 대응: §0·§1(T1) / §2(T1·T3) / §3(T4) / §4·상태줄(T5) / §5(T3 Step 3) / §6(T2) / §7(T3 Step 1 폴백 + T6 README)
- §6 세 계약 → T2의 판정 함수 주석·삽입 위치 지시·clearQuarantine 통과 + 변이 3종
- 리뷰 3라운드의 미해결 넷(I1~I4) 전부 반영: list_devices 오류 분기(T4 Step 2 catch) / TOCTOU 가설·예측 기록(T1 Step 5 동시성 ①) / 테스트 자리 = sync.test.ts(T2) / withoutEmptyBundles 좌변(T2)
- 타입 일관성: `issueInvite`·`removeDevice` 유니온(T3) = 화면 분기(T4·T5) / `DeviceRow`(T3) = 목록 렌더(T4) / `skipUnchangedPush` 시그니처(T2) = pushDay·pushMeta 호출부
- 상한 문구 문자열이 T1의 두 함수에서 동일함을 명시
- 배포 순서와 혼재 금지 문구가 Global Constraints와 T6 README에 있음
