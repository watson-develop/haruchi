# 동기화 2C — 초대 기반 기기 등록 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 새 기기 등록을 「기존 기기가 6자리 코드를 발급 → 새 기기가 코드로 키를 받는다」로 바꾼다 — 평문 키를 사람이 만지지 않는다(스펙 §5, 사용자 결정 2026-08-09).

**Architecture:** 서버에 `invites` 테이블(RLS 켜고 정책 없음 — RPC 전용)과 RPC 둘을 더한다. `issue_invite()`는 등록된 기기만 부르고 6자리 코드를 돌려준다(10분 유효, 활성 최대 1). `claim_invite(p_code, p_device_id, p_label)`는 익명 호출 — 성공하면 32바이트 키를 생성해 해시만 저장하고 평문을 이 한 번만 돌려준다. 클라이언트는 `sync.ts`에 `issueInvite`·`claimInvite`를 더하고, 부모 홈의 키 붙여넣기 입력을 코드 입력으로 교체한다. 등록 직후는 **pull 먼저**(로컬이 비어 있으니 서버 채택이 곧 초기화 — 스펙 §5 :514).

**Tech Stack:** Postgres(pgcrypto — 이미 로드됨) + PostgREST RPC + 바닐라 TS. 실행 코드 신규 의존성 0.

## Global Constraints

- 모든 npm 명령 전에: `export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH"`
- `fetch`를 직접 부르지 않는다 — `sync.ts`의 `req()`만 쓴다
- **schema.sql은 멱등을 유지한다** — 같은 DB에 연속 3회 적용해 오류 0이어야 한다(파일 머리 주석의 계약)
- **모든 `update`/`delete`에 `where`가 있어야 한다** — 운영 Supabase는 `safeupdate`가 `authenticator` 세션에 프리로드돼 있고 `security definer`도 면제가 아니다(`replace_all`이 이걸로 실사용 첫날 죽었다 — HANDOFF 「`replace_all`이 실사용 첫날 죽어 있었다」). 일회용 컨테이너 검증은 safeupdate가 없어 이걸 못 잡는다 — **눈으로 전수 확인이 게이트다**
- **`claim_invite`의 사용자 수준 실패(코드 불일치·만료·경쟁 패배)는 `raise exception`이 아니라 jsonb 반환이다** — 예외는 트랜잭션을 통째로 되돌려 `fail_count`++까지 지운다. 5회 만료가 영영 안 걸린다
- 테스트는 새로 만들지 않는다 — 순수 로직이 전부 서버(SQL)와 화면(DOM)에 있다(설계 §12). 검증은 컨테이너 SQL 시나리오 + 수동 스모크
- `docs/` 포함 커밋 전 반드시 `npm run format` (prettier가 마크다운도 검사, CI 차단 전례)
- 커밋 메시지는 이 레포 관례(한국어, `feat:`/`docs:` 접두, 본문에 왜)
- 아이/부모 소속 불변식: 이 계획의 화면 변경은 전부 부모 홈 안이다 — 새 `navigate(...)` 목적지를 만들지 않는다
- **2C 배포 순서: 스키마 먼저(SQL Editor), 앱 배포는 그다음**(스펙 §7). 선행조건(2A 앱 배포)은 이미 충족됐다

## 파일 지도

| 파일                          | 역할                                                | Task |
| ----------------------------- | --------------------------------------------------- | ---- |
| `supabase/schema.sql`         | `invites` + `issue_invite()` + `claim_invite()`     | 1    |
| `src/data/sync.ts`            | `issueInvite`·`claimInvite` 클라이언트              | 2    |
| `src/screens/home-parent.ts`  | 발급 버튼(등록됨) + 코드 입력(미등록)               | 3    |
| `supabase/README.md`          | 5단계 재작성(초대 흐름) + 복구 절                   | 4    |
| `docs/superpowers/HANDOFF.md` | 2C 기록 + **`pushMeta` 첫 실행 판정** + 스모크 목록 | 5    |

## 계획이 스펙에 더한 결정 둘 (근거 포함)

1. **키 붙여넣기 UI를 제거하고 코드 입력으로 교체한다.** 스펙 :503의 목적("평문 키를
   사람이 만지지 않는다")이 사용자 결정이고, 붙여넣기 UI가 남으면 그 목적이 안 닫힌다.
   첫 기기(발급할 기기가 아직 없다)와 전 기기 폐기 복구는 같은 SQL 한 줄 — `invites`에
   아는 코드의 해시를 직접 insert — 로 해결된다(스펙 :541 "SQL 수동 insert를 README
   복구 절로"). 재등록(기기 id가 이미 `devices`에 있음)은 `devices` 행을 지우고 같은
   길을 탄다.
2. **코드·키 난수는 `gen_random_bytes`다.** Postgres `random()`은 암호학적 난수가
   아니다. pgcrypto가 이미 로드돼 있어 비용이 없다.

---

### Task 1: `supabase/schema.sql` — `invites`와 RPC 둘

**Files:**

- Modify: `supabase/schema.sql` (`write_log` 테이블 아래에 `invites`, `rewrite_sheet` 아래에 RPC 둘, RLS 절에 invites 추가)

**Interfaces:**

- Consumes: 기존 `haruchi_device()`·`devices`·`write_log`·pgcrypto
- Produces: `issue_invite() returns text`(6자리 코드), `claim_invite(p_code text, p_device_id text, p_label text) returns jsonb`(`{"key": "..."}` 또는 `{"error": "..."}`) — Task 2가 부른다

- [ ] **Step 1: `invites` 테이블 + RLS**

`write_log` 테이블 정의 아래에:

```sql
-- 2C: 기기 등록 초대(설계 2단계 §5). 행은 쌓여도 지우지 않는다 — 언제 누가 발급하고
-- 누가 썼는지가 그대로 감사 이력이다(snapshots·write_log와 같은 성질).
create table if not exists invites (
  id         bigserial primary key,
  code_hash  text not null,            -- crypt(6자리, salt) — 평문 코드는 저장하지 않는다
  created_by text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,     -- 발급 +10분
  fail_count int not null default 0,   -- 5회면 즉시 만료
  used_at    timestamptz,
  used_by    text
);
-- 정책 없음: RPC(security definer)만 접근. 빠지면 anon 키로 code_hash 오프라인 대입
-- 또는 아는 코드의 해시 직접 INSERT로 기기 등록이 가능해진다(설계 §5).
alter table invites enable row level security;
```

- [ ] **Step 2: `issue_invite()`**

`rewrite_sheet` 함수 아래에:

```sql
-- 2C: 등록된 기기가 새 기기 초대 코드를 발급한다(설계 2단계 §5).
-- 코드는 gen_random_bytes 기반이다 — random()은 암호학적 난수가 아니다. 4바이트를
-- 10^6으로 접는 모듈로 편향은 2^32 % 10^6 / 2^32 ≈ 0.007%로 무시 가능하다.
create or replace function issue_invite() returns text
language plpgsql security definer as $$
declare
  dev  text := haruchi_device();
  code text;
begin
  if dev is null then
    raise exception '등록된 기기만 초대를 만들 수 있어요';
  end if;
  -- 기존 활성 초대 전부 만료 — 같은 트랜잭션이라 동시 발급에도 활성은 최대 1이다.
  -- (safeupdate: where 필수 — 이 파일의 모든 update가 지키는 계약)
  update invites set expires_at = now()
    where used_at is null and expires_at > now();
  code := lpad(((('x' || encode(gen_random_bytes(4), 'hex'))::bit(32)::bigint) % 1000000)::text, 6, '0');
  insert into invites (code_hash, created_by, expires_at)
    values (crypt(code, gen_salt('bf')), dev, now() + interval '10 minutes');
  insert into write_log (device, target, action) values (dev, 'invite', 'invite-issue');
  return code;
end $$;
```

- [ ] **Step 3: `claim_invite()`**

```sql
-- 2C: 새 기기가 코드로 자기 키를 받는다(설계 2단계 §5). 익명 호출 — 이 기기에는
-- 아직 키가 없다. 성공 시 평문 키를 이 한 번만 돌려주고 서버에는 해시만 남는다.
--
-- **사용자 수준 실패는 예외가 아니라 jsonb 반환이다.** raise exception은 트랜잭션을
-- 통째로 되돌려 fail_count 증가까지 지운다 — 그러면 5회 만료가 영영 안 걸리고
-- 무차별 대입 방어(설계 §5)가 죽는다. 예외는 상태를 남길 필요가 없는 오용
-- (빈 기기 id)에만 쓴다.
create or replace function claim_invite(p_code text, p_device_id text, p_label text)
returns jsonb language plpgsql security definer as $$
declare
  inv invites%rowtype;
  key text;
begin
  if p_device_id is null or p_device_id = '' then
    raise exception '기기 id가 비어 있어요';
  end if;
  if exists (select 1 from devices where id = p_device_id) then
    -- 재등록은 수동 경로(supabase/README.md 복구 절)다 — 여기서 기존 행을 덮으면
    -- 코드를 아는 사람이 등록된 기기의 키를 갈아치울 수 있다.
    return jsonb_build_object('error', '이미 등록된 기기예요');
  end if;
  -- for update가 동시 claim을 직렬화한다. 락 대기 후 재평가(EvalPlanQual)에서
  -- 먼저 온 쪽이 used_at을 채웠으면 조건에서 떨어져 inv가 비고, 아래 not found
  -- 가드가 이중 방어다(설계 §5 "0행이면 경쟁 패배 거부").
  select * into inv from invites
    where used_at is null and expires_at > now() and fail_count < 5
    order by id desc limit 1
    for update;
  if inv.id is null then
    return jsonb_build_object('error', '유효한 초대가 없어요 — 등록된 기기에서 새로 만들어 주세요');
  end if;
  if inv.code_hash <> crypt(p_code, inv.code_hash) then
    update invites
      set fail_count = fail_count + 1,
          expires_at = case when fail_count + 1 >= 5 then now() else expires_at end
      where id = inv.id;
    return jsonb_build_object('error', '코드가 맞지 않아요');
  end if;
  update invites set used_at = now(), used_by = p_device_id
    where id = inv.id and used_at is null;
  if not found then
    return jsonb_build_object('error', '유효한 초대가 없어요 — 등록된 기기에서 새로 만들어 주세요');
  end if;
  key := encode(gen_random_bytes(32), 'base64');
  insert into devices (id, label, key_hash)
    values (p_device_id, coalesce(nullif(trim(p_label), ''), '새 기기'), crypt(key, gen_salt('bf')));
  insert into write_log (device, target, action) values (p_device_id, 'invite', 'invite-claim');
  return jsonb_build_object('key', key);
end $$;
```

- [ ] **Step 4: safeupdate 전수 확인**

새로 넣은 SQL의 `update`/`delete` 전부에 `where`가 있는지 눈으로 센다(이 Task 기준 update 3, delete 0). `grep -n "update \|delete from" supabase/schema.sql`로 파일 전체를 다시 세고, 결과를 커밋 본문에 적는다.

- [ ] **Step 5: 일회용 Postgres로 검증**

```bash
docker run -d --name haruchi-2c -e POSTGRES_PASSWORD=x -p 54329:5432 postgres:17
sleep 3
for i in 1 2 3; do docker exec -i haruchi-2c psql -U postgres -f - < supabase/schema.sql; done
```

3회 전부 오류 0이어야 한다(멱등 계약). 이어서 시나리오(psql로 실행, 각 결과를 확인):

```sql
-- 준비: 발급자 기기 심기
insert into devices (id, label, key_hash) values ('issuer', '테스트', crypt('k', gen_salt('bf')));
select issue_invite();                     -- 예상: 예외 '등록된 기기만 초대를 만들 수 있어요' (request.headers 없음)
-- set_config로 request.headers를 흉내 내면 haruchi_device()가 'issuer'를 돌려준다 —
-- 컨테이너에서도 issue_invite의 성공 경로(코드 발급·기존 활성 초대 만료·write_log 기록)를
-- 실제로 돌릴 수 있다. insert로 초대를 심는 아래 흉내는 issue_invite를 아예 부르지 않는
-- 경로만 남기고 싶을 때(즉 거부 분기만 볼 때)에 한해 쓴다.
select set_config('request.headers', '{"x-device-key":"k"}', false);
select issue_invite();                     -- 예상: 성공 — 6자리 코드 반환
select action from write_log where target = 'invite' order by id desc limit 1;  -- 'invite-issue'
select set_config('request.headers', '', false);  -- 이후 시나리오는 다시 익명(관리자 insert)으로
insert into invites (code_hash, created_by, expires_at)
  values (crypt('123456', gen_salt('bf')), 'issuer', now() + interval '10 minutes');

-- 1) 성공: key가 나오고 devices에 행이 생기고 used_at이 찬다
select claim_invite('123456', 'new-device', '엄마 폰');
select id, label from devices where id = 'new-device';
select used_at is not null, used_by from invites order by id desc limit 1;

-- 2) 재사용 거부: 같은 코드 다시 → error (used_at이 이미 참)
select claim_invite('123456', 'other', '');

-- 3) 중복 기기 거부
insert into invites (code_hash, created_by, expires_at)
  values (crypt('654321', gen_salt('bf')), 'issuer', now() + interval '10 minutes');
select claim_invite('654321', 'new-device', '');   -- 예상: '이미 등록된 기기예요'

-- 4) 5회 만료: 틀린 코드 5번 → fail_count 5·expires_at 과거, 6번째는 '유효한 초대가 없어요'
select claim_invite('000000', 'x1', ''); select claim_invite('000000', 'x1', '');
select claim_invite('000000', 'x1', ''); select claim_invite('000000', 'x1', '');
select claim_invite('000000', 'x1', '');
select fail_count, expires_at <= now() from invites order by id desc limit 1;  -- 5, true
select claim_invite('654321', 'x1', '');           -- 예상: '유효한 초대가 없어요'

-- 5) 만료 거부: 새 초대를 과거 만료로 심고 claim → '유효한 초대가 없어요'
insert into invites (code_hash, created_by, expires_at)
  values (crypt('111111', gen_salt('bf')), 'issuer', now() - interval '1 second');
select claim_invite('111111', 'x2', '');

-- p_code null·빈 문자열 — crypt()는 strict라 crypt(null, hash)가 null이고
-- plpgsql IF는 null을 false로 다룬다. is distinct from이 아니라 <>로 비교하면
-- 오답 분기를 건너뛰고 그대로 키를 내주는 구멍이 된다(리뷰에서 실측·수정).
insert into invites (code_hash, created_by, expires_at)
  values (crypt('222222', gen_salt('bf')), 'issuer', now() + interval '10 minutes');
select claim_invite(null, 'x-null', '');   -- 예상: {"error": "코드가 맞지 않아요"}, fail_count 1
select claim_invite('', 'x-empty', '');    -- 예상: error, fail_count 2

-- 6) RLS 차단: 익명 롤로 직접 접근이 전부 막히는지
create role anon_test nologin; grant usage on schema public to anon_test;
grant select, insert, update on invites to anon_test;  -- 권한이 있어도 RLS(정책 없음)가 막아야 한다
set role anon_test;
select count(*) from invites;                       -- 예상: 0행 (RLS)
insert into invites (code_hash, created_by, expires_at)
  values ('h', 'evil', now() + interval '10 minutes');  -- 예상: RLS 위반 오류
reset role;
```

**주의 — 4번은 fail_count가 진짜 남는지의 검증이다.** `claim_invite`가 어느 실패든 `raise exception`으로 구현돼 있으면 fail_count가 매번 0으로 롤백돼 4번이 절대 통과하지 못한다. 이 시나리오가 Global Constraints의 jsonb 계약에 대한 변이 검증이다.

끝나면 `docker rm -f haruchi-2c`.

- [ ] **Step 6: 커밋**

```bash
git add supabase/schema.sql
git commit -m "feat: 초대 기반 기기 등록의 서버 쪽 — invites 테이블과 RPC 둘"
```

커밋 본문에: jsonb 반환 계약의 이유(fail_count 롤백), safeupdate 전수 확인 결과, 컨테이너 시나리오 통과 목록.

---

### Task 2: `src/data/sync.ts` — `issueInvite`·`claimInvite`

**Files:**

- Modify: `src/data/sync.ts` (`serverSnapshot` 근처, 다른 RPC 호출들 옆에)

**Interfaces:**

- Consumes: 기존 `req()`·`failed()`·`configured()`·`getDeviceState()`·`updateDeviceState()`·`pullOnce()`·`kickPush()`
- Produces: `issueInvite(): Promise<string>` · `claimInvite(code: string, label: string): Promise<{ ok: true } | { ok: false; reason: string }>` — Task 3이 부른다

- [ ] **Step 1: 구현**

```ts
/** 새 기기 초대 코드를 발급한다(2C 설계 §5). 등록된 기기에서만 성공한다 —
 *  서버의 issue_invite가 haruchi_device()로 확인한다. */
export async function issueInvite(): Promise<string> {
  if (!configured()) throw new Error('동기화가 설정되지 않았어요')
  const res = await req(`${SUPABASE_URL}/rest/v1/rpc/issue_invite`, {
    method: 'POST',
    body: JSON.stringify({}),
  })
  if (!res.ok) throw await failed('초대 발급', res)
  return (await res.json()) as string
}

/**
 * 코드로 이 기기를 등록한다(2C 설계 §5). 익명 호출 — 아직 키가 없다(req()의
 * x-device-key가 ''로 나가고 서버는 무시한다).
 *
 * 사용자 수준 실패(코드 불일치·만료·5회 초과·경쟁 패배)는 서버가 200 + {error}로
 * 돌려준다 — 예외로 던지면 서버의 fail_count 증가가 롤백되기 때문이다(schema.sql
 * claim_invite 주석). 그래서 반환 타입이 유니온이다: 던지는 것은 네트워크·서버
 * 장애뿐이고, {ok: false}는 사람이 고칠 수 있는 입력 문제다.
 *
 * 성공 시 키 저장 → **pull 먼저**(설계 §5 :514 — 로컬이 비어 있으니 서버 채택이
 * 곧 초기화다) → push(로컬에만 있던 기록이 있으면 그때 올라간다 — kickPush의
 * seedOutbox가 심는다).
 */
export async function claimInvite(
  code: string,
  label: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!configured()) throw new Error('동기화가 설정되지 않았어요')
  const device = await getDeviceState()
  const res = await req(`${SUPABASE_URL}/rest/v1/rpc/claim_invite`, {
    method: 'POST',
    body: JSON.stringify({ p_code: code, p_device_id: device.deviceId, p_label: label }),
  })
  if (!res.ok) throw await failed('기기 등록', res)
  const body = (await res.json()) as { key?: string; error?: string }
  if (typeof body.key !== 'string' || body.key === '') {
    return { ok: false, reason: typeof body.error === 'string' ? body.error : '알 수 없는 응답' }
  }
  const key = body.key
  await updateDeviceState((s) => ({ ...s, deviceKey: key }))
  await pullOnce()
  kickPush()
  return { ok: true }
}
```

주의: `req()`의 헤더 구성(`x-device-key: device.deviceKey ?? ''`)과 `failed()`는 이미 있다 — 새로 만들지 마라. RPC 호출 모양은 같은 파일의 `replace_all` 호출(1474행 부근)을 따른다.

- [ ] **Step 2: 검증 + 커밋**

```bash
npx vitest run && npx prettier --check . && npm run build
git add src/data/sync.ts
git commit -m "feat: 초대 발급과 코드 등록의 클라이언트 쪽 — 등록 직후 pull 먼저"
```

---

### Task 3: `src/screens/home-parent.ts` — 화면 양쪽

**Files:**

- Modify: `src/screens/home-parent.ts` (setup 톤 블록 142-148행, 키 저장 핸들러 259-269행, 등록됨 상태에 발급 UI 추가)

**Interfaces:**

- Consumes: Task 2의 `issueInvite`·`claimInvite`, 기존 `configured()`·`escapeHtml`·`navigate`·`el`
- Produces: 없음(화면)

- [ ] **Step 1: 미등록 쪽 — 키 붙여넣기를 코드 입력으로 교체**

`syncHtml`의 setup 톤 분기를:

```ts
? `<div class="sync-setup">
      <p>${escapeHtml(status.lines[0]!)}</p>
      <input id="invite-code" inputmode="numeric" autocomplete="off" maxlength="6" placeholder="6자리 코드" />
      <input id="device-label" autocomplete="off" placeholder="이 기기 이름 (예: 엄마 폰)" />
      <button id="invite-claim" class="step">연결하기</button>
      <p class="sync-hint" id="invite-hint">등록된 기기의 부모 홈 → 「새 기기 추가」로 코드를 만들어요</p>
    </div>`
```

기기 id 표시 줄(`sync-device-id`)은 지운다 — 코드 흐름에서는 사람이 기기 id를 옮겨 적을 일이 없다(claim이 자기 id를 직접 보낸다). 복구 절(README)만 기기 id가 필요한데, 그 경로는 DevTools에서 읽는다고 README에 적는다(Task 4).

- [ ] **Step 2: 미등록 쪽 — 핸들러 교체**

기존 `#device-key-save` 핸들러를 지우고:

```ts
// 코드 등록(2C). 실패 둘의 결이 다르다 — {ok:false}는 사람이 고칠 입력 문제라
// 안내 줄에만 쓰고, throw는 네트워크·서버 장애라 showError로 띄운다.
root.querySelector('#invite-claim')?.addEventListener('click', () => {
  const codeInput = root.querySelector<HTMLInputElement>('#invite-code')!
  const labelInput = root.querySelector<HTMLInputElement>('#device-label')!
  const hint = root.querySelector<HTMLParagraphElement>('#invite-hint')!
  const code = codeInput.value.trim()
  if (!/^\d{6}$/.test(code)) {
    hint.textContent = '코드는 숫자 6자리예요'
    return
  }
  const btn = root.querySelector<HTMLButtonElement>('#invite-claim')!
  btn.disabled = true // 이중 클릭이 fail_count를 이중으로 태우지 않게
  hint.textContent = '연결하는 중…'
  claimInvite(code, labelInput.value.trim())
    .then((r) => {
      if (r.ok) {
        navigate('#/parent') // 같은 해시 재라우팅은 안전하다(상태를 IndexedDB에서 다시 읽는다)
        return
      }
      btn.disabled = false
      codeInput.value = ''
      hint.textContent = r.reason
    })
    .catch((e) => {
      btn.disabled = false
      showError('기기를 연결하지 못했어요.', e)
      hint.textContent = '연결에 실패했어요 — 잠시 뒤 다시 눌러 주세요'
    })
})
```

- [ ] **Step 3: 등록된 쪽 — 「새 기기 추가」**

등록된 상태의 `syncHtml`(= `statusLineHtml(status)` 분기)을 다음으로 바꾼다.
**버튼은 표시 영역(`#invite-zone`) 밖에 둔다** — 안에 두면 발급 성공·실패가 영역을
갈아 끼울 때 버튼이 함께 사라져 재발급·재시도가 화면 이탈 없이는 불가능해진다:

```ts
: `${statusLineHtml(status)}<div class="links"><button id="invite-issue">새 기기 추가</button></div><div id="invite-zone"></div>`
```

(`.links button`은 기존 CSS를 재사용한다 — 새 버튼 CSS를 만들지 않는다.)

핸들러:

```ts
// 초대 발급(2C). 코드는 서버가 만든 값 그대로지만 우리 리터럴이 아니므로
// textContent로만 넣는다(XSS 경계 — el() 템플릿에 넣지 않는다). 버튼은 zone 밖에
// 살아 남으므로 다시 누르면 서버가 이전 코드를 만료시키고 새 코드가 표시된다.
root.querySelector('#invite-issue')?.addEventListener('click', () => {
  const zone = root.querySelector<HTMLDivElement>('#invite-zone')!
  zone.textContent = '코드를 만드는 중…'
  issueInvite()
    .then((code) => {
      zone.replaceChildren()
      const codeEl = document.createElement('div')
      codeEl.className = 'invite-code'
      codeEl.textContent = code
      const note = document.createElement('p')
      note.className = 'sync-hint'
      note.textContent =
        '10분 안에 새 기기의 부모 홈에서 이 코드를 입력하세요. 다시 누르면 이 코드는 무효가 되고 새 코드가 나와요.'
      zone.append(codeEl, note)
    })
    .catch((e) => {
      zone.textContent = ''
      showError('초대 코드를 만들지 못했어요.', e)
    })
})
```

`.invite-code`는 `src/styles/app.css`에 한 줄 수준으로(큰 글자·자간 — SEED 토큰 사용, 예: `font-size: 2rem; letter-spacing: 0.3em; color: var(--seed-color-fg-neutral);`). shorthand `font:` 금지(CSS 레이어 전략 — CLAUDE.md).

- [ ] **Step 4: 검증 + 커밋**

```bash
npx vitest run && npx prettier --check . && npm run build
git add src/screens/home-parent.ts src/styles/app.css
git commit -m "feat: 부모 홈에서 초대 코드로 기기를 등록한다 — 키 붙여넣기 제거"
```

- [ ] **Step 5: 수동 스모크 (dev 서버, 운영 서버 상대)**

`npm run dev` → `http://localhost:5173/haruchi/#/parent` (localhost는 배포 origin과 IndexedDB가 분리돼 미등록 상태다 — 그 자체가 새 기기 시나리오):

**스키마가 운영에 아직 안 들어갔으면 이 스모크는 머지 후로 미룬다**(Global Constraints의 배포 순서). 들어간 뒤:

1. 미등록 localhost: 코드 입력 UI가 보인다(키 붙여넣기 없음)
2. 5자리 입력 → 「코드는 숫자 6자리예요」, 요청 안 나감(Network 탭)
3. 실기기(등록된 아이패드)에서 「새 기기 추가」 → 6자리 코드 표시
4. localhost에 코드 입력 → 연결 → 부모 홈이 등록 상태로 다시 그려지고 pull이 서버 기록을 내려받는다
5. 같은 코드 재입력(다른 브라우저 프로필) → 「유효한 초대가 없어요…」
6. 서버 확인: `devices`에 새 행(라벨 포함), `write_log`에 `invite-issue`·`invite-claim`

---

### Task 4: `supabase/README.md` — 5단계 재작성 + 복구 절

**Files:**

- Modify: `supabase/README.md` (5단계 전체 교체, 7단계 「폐기·재발급」 뒤에 복구 절)

**Interfaces:**

- Consumes: Task 1의 SQL, Task 3의 화면 문구
- Produces: 없음(문서)

- [ ] **Step 1: 5단계 교체**

기존 5단계(openssl 키 생성 → SQL insert → 붙여넣기)를 다음 구조로 교체한다:

- **첫 기기**: 아직 발급할 기기가 없다 — SQL Editor에서 초대를 직접 심는다:

  ```sql
  insert into invites (code_hash, created_by, expires_at)
    values (crypt('원하는6자리', gen_salt('bf')), 'sql', now() + interval '10 minutes');
  ```

  실행한 쿼리 탭을 지운다(기존 5단계 5번과 같은 이유 — 평문 코드가 스니펫으로 남는다.
  코드는 키보다 수명이 짧지만 10분 창 안에서는 유효하다). 그 기기의 부모 홈에서 코드 입력.

- **이후 기기**: 등록된 기기의 부모 홈 → 「새 기기 추가」 → 코드를 새 기기에 입력.
  SQL이 아예 필요 없다.
- 「두 번째 기기부터 — 등록 전에 로컬 확인」 절은 **그대로 유지**한다(등록 방법이
  바뀌어도 등록의 의미 — 로컬 전체가 올라감 — 는 같다). 문구 중 "키를 넣기 전에"는
  "코드를 넣기 전에"로.

- [ ] **Step 2: 복구 절 추가**

7단계 「폐기·재발급」 뒤에 「복구 — 모든 기기를 잃었을 때」:

- 전 기기 폐기·분실: 첫 기기와 같은 SQL로 초대를 심고 기기에서 코드 입력
- 같은 기기 재등록(claim이 「이미 등록된 기기예요」를 돌려줄 때): 그 기기의 행을 지우고
  같은 길을 탄다 —

  ```sql
  delete from devices where id = '<기기id>';
  ```

  기기 id는 그 기기 DevTools → Application → IndexedDB → `haruchi` → `device` →
  `deviceId`에서 읽는다(화면에는 더 이상 표시하지 않는다)

- [ ] **Step 3: 포맷 + 커밋**

```bash
npm run format && npx prettier --check .
git add supabase/README.md
git commit -m "docs: 기기 등록 절차를 초대 코드 흐름으로 다시 쓴다"
```

---

### Task 5: HANDOFF — 2C 기록과 `pushMeta` 첫 실행 판정

**Files:**

- Modify: `docs/superpowers/HANDOFF.md` (2B 절 뒤에 2C 절, 「서버 쓰기 경로 감사」 표 갱신)

**Interfaces:**

- Consumes: Task 1-4의 결과
- Produces: 없음(문서)

- [ ] **Step 1: 2C 절 작성**

들어간 것(스키마·sync.ts·부모 홈·README), 계획이 스펙에 더한 결정 둘(키 붙여넣기 제거·gen_random_bytes)과 근거, jsonb 반환 계약의 이유, 남은 사람 확인(Task 3 Step 5 스모크 — 스키마 적용 후).

- [ ] **Step 2: `pushMeta` 첫 실행 판정을 명시한다**

「서버 쓰기 경로 감사」가 못박은 항목이다: _"설정을 서버로 올리는 UI가 생기는 날이 `pushMeta`의 첫 실행일이다(2C의 기기 라벨이 유력한 후보). 그 작업 계획에 「`pushMeta` 첫 실행」을 명시 항목으로 넣을 것."_

**판정: 2C는 `pushMeta`를 깨우지 않는다.** 기기 라벨은 `claim_invite`의 인자로 서버 `devices.label`에 직접 앉고, 클라이언트 `Settings`에 들어가지 않는다 — `putMeta` 호출이 하나도 늘지 않고 meta 아웃박스 항목이 여전히 생성 불가다. `pushMeta`의 `rev` 폴백 0 결함은 계속 도달 불가 상태로 잠들어 있다. 이 판정과 근거를 감사 절에 한 문단으로 남기고, 감사 표의 미실행 목록에 「2C 이후에도 변화 없음」을 적는다. `issue_invite`·`claim_invite`는 새 서버 쓰기 경로이므로 감사 표에 행 둘을 추가한다(실행 여부는 스모크 후 기록).

- [ ] **Step 3: 포맷 + 커밋**

```bash
npm run format && npx prettier --check .
git add docs/superpowers/HANDOFF.md
git commit -m "docs: 2C 완료 기록 — pushMeta는 여전히 깨어나지 않는다는 판정 포함"
```

---

## 자체 리뷰 체크리스트 (계획 작성자가 이미 수행)

- 스펙 §5의 요구 전부에 대응: 6자리·10분(T1 issue) / 활성 최대 1·한 트랜잭션(T1 issue의 update+insert) / 익명 claim·원자적 사용 처리·`where used_at is null` 0행 거부(T1 claim) / fail_count 5회 만료(T1 claim + 시나리오 4) / 32바이트 키·해시 저장·평문 1회 반환(T1 claim) / `p_device_id` 중복 거부(T1 claim) / RLS 정책 없음(T1 Step 1 + 시나리오 6) / 등록 직후 pull 먼저(T2 claimInvite) / write_log(T1 둘 다) / 전 기기 폐기 복구 README(T4)
- HANDOFF가 요구한 「`pushMeta` 첫 실행」 명시 항목 → T5 Step 2 (판정: 깨우지 않는다)
- safeupdate 교훈 → Global Constraints + T1 Step 4 전수 확인
- `raise exception` 롤백 함정 → Global Constraints + T1 주석 + 시나리오 4가 변이 검증
- 멱등 계약 → T1 Step 5의 3회 연속 적용
- 아이/부모 소속: 새 navigate 없음(T3은 부모 홈 내부만)
- 타입 일관성: `claim_invite returns jsonb {key|error}`(T1) = `claimInvite`의 파싱(T2) = 화면의 `{ok, reason}` 분기(T3)
