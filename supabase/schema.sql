-- haruchi 동기화 백엔드 스키마. 단일 출처 — 서버 규칙을 바꿀 때는 이 파일을 고치고
-- Supabase SQL Editor에서 재적용한다. 근거: docs/superpowers/specs/2026-08-06-sync-backend-design.md
--
-- **이 파일은 몇 번을 다시 돌려도 된다**(멱등). 재적용하라고 적어 두고 두 번째 실행에서
-- 죽으면 그 지시가 거짓말이 되므로, 모든 DDL이 다시 실행 가능한 형태여야 한다:
-- 테이블은 if not exists, 함수·트리거는 create or replace(트리거는 PG14+),
-- 정책은 create or replace가 없으므로 drop policy if exists를 앞에 둔다.
-- 검증: 같은 데이터베이스에 이 파일을 연속 두 번 적용해 오류가 없어야 한다(실측 완료).
create extension if not exists pgcrypto;

create table if not exists devices (
  id           text primary key,
  label        text not null,
  key_hash     text not null,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz,
  revoked_at   timestamptz
);

create table if not exists days (
  date           text primary key,
  payload        jsonb not null,
  rev            bigint not null,
  schema_version int not null,
  sheet_at       timestamptz,
  grades_at      timestamptz,
  sprint_at      timestamptz,
  updated_at     timestamptz not null default now(),
  device         text not null
);
-- 2단계: 묶음별 승자 기기(설계 2단계 §1). 옛 클라이언트가 쓴 행은 null → 클라이언트가 ''로 읽는다.
alter table days add column if not exists sheet_by  text;
alter table days add column if not exists grades_by text;
alter table days add column if not exists sprint_by text;
-- pull 커서가 매번 훑는 열.
create index if not exists days_updated_at on days (updated_at);

create table if not exists meta (
  id         int primary key default 1 check (id = 1),
  payload    jsonb not null,
  rev        bigint not null,
  generation bigint not null,
  updated_at timestamptz not null default now(),
  device     text not null
);
-- 2단계: settings LWW의 클라이언트 시계. updated_at(서버 시계)은 pull 커서 전용으로 남는다.
alter table meta add column if not exists settings_at timestamptz;
alter table meta add column if not exists settings_by text;

create table if not exists app_config (
  id         int primary key default 1 check (id = 1),
  pin        text not null,
  updated_at timestamptz not null default now(),
  device     text not null
);

create table if not exists snapshots (
  id        bigserial primary key,
  at        timestamptz not null default now(),
  device    text not null,
  reason    text not null,
  day_count int not null,
  payload   jsonb not null
);

create table if not exists write_log (
  id     bigserial primary key,
  at     timestamptz not null default now(),
  device text not null,
  target text not null,
  action text not null
);

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

-- meta는 행이 항상 존재해야 한다 — generation 카운터가 행과 함께 영속한다(설계 §6).
insert into meta (id, payload, rev, generation, device)
  values (1, '{}'::jsonb, 0, 0, 'schema')
  on conflict (id) do nothing;
-- 백필(멱등): 위 seed insert 뒤에 두어야 신선한 DB에서도 이 행이 걸린다(seed 전이면
-- 0행에 적용되고 신선한 행은 settings_at null로 남는다 — 리뷰 라운드 1에서 실측 확인).
-- null이면 새 기기의 기본 설정과의 타이브레이크가 복권이 된다(설계 §1).
update meta set settings_at = updated_at where settings_at is null;

-- ─── security definer 여섯의 search_path 고정 (2026-08-13) ───────────────────
--
-- 아래 `security definer` 함수 전부에 `set search_path = public, extensions,
-- pg_temp`가 붙어 있다. **이 값은 실측이다** — 운영 Supabase의 pgcrypto는
-- `extensions` 스키마에 있다(`select extnamespace::regnamespace from pg_extension
-- where extname='pgcrypto'` → extensions). 그래서 흔히 쓰는 `public, pg_temp`로
-- 고정하면 `crypt`·`gen_salt`·`gen_random_bytes`가 전부 미해결이 되어
-- **`haruchi_device()`가 죽고 그 순간 모든 RLS가 무너진다.** 값을 바꾸기 전에
-- 그 쿼리를 먼저 돌릴 것.
--
-- **고정 전에는 이 함수들이 호출자의 search_path에 얹혀 돌고 있었다.** 일회용
-- 컨테이너에서 pgcrypto를 `extensions`에 두고 재현하면, 호출자 경로에서 그
-- 스키마를 빼는 순간 `claim_invite`가 `function crypt(text, text) does not exist`로
-- 죽는다. 운영이 멀쩡했던 것은 Supabase가 PostgREST에
-- `db_extra_search_path = public, extensions`를 넣어 두기 때문이다 — 즉 우리
-- 서버 규칙의 동작이 **우리가 소유하지 않은 설정 한 줄에 매달려** 있었다.
-- 고정하면 그 의존이 사라지고, 동시에 `security definer`의 표준 방어(호출자가
-- 앞선 스키마에 동명 객체를 심어 definer 권한으로 실행시키는 것)도 선다.
--
-- 요청 헤더의 기기 키를 확인해 기기 id를 돌려준다. RLS·트리거 공용.
create or replace function haruchi_device() returns text
language sql stable security definer set search_path = public, extensions, pg_temp as $$
  select d.id from devices d
  where d.key_hash = crypt(
    coalesce(current_setting('request.headers', true)::json->>'x-device-key', ''),
    d.key_hash)
    and d.revoked_at is null
$$;

-- updated_at은 서버 시계다(pull 커서용, 설계 §1). *_at(기기 시계)과 역할이 다르다.
create or replace function haruchi_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create or replace trigger days_touch before insert or update on days
  for each row execute function haruchi_touch();
create or replace trigger meta_touch before insert or update on meta
  for each row execute function haruchi_touch();
create or replace trigger config_touch before insert or update on app_config
  for each row execute function haruchi_touch();

-- sheet 불변(설계 §2 C-1 방어 2). 비어 있지 않은 sheet는 rewrite_sheet RPC 밖에서 못 바꾼다.
create or replace function haruchi_guard_sheet() returns trigger
language plpgsql as $$
begin
  if coalesce(old.payload->'sheet', '[]'::jsonb) <> '[]'::jsonb
     and new.payload->'sheet' is distinct from old.payload->'sheet'
     and coalesce(current_setting('haruchi.sheet_rewrite', true), '') <> 'on' then
    raise exception 'sheet_immutable';
  end if;
  return new;
end $$;

create or replace trigger days_guard_sheet before update on days
  for each row execute function haruchi_guard_sheet();

-- 옛 클라이언트(schema_version을 모르는 코드)가 새 버전 행을 통째 PATCH로 되덮는 것을
-- 서버에서 막는다 — 클라이언트 가드는 정작 옛 클라이언트에 실리지 않는다(설계 §1).
create or replace function haruchi_guard_version() returns trigger
language plpgsql as $$
begin
  if new.schema_version < old.schema_version then
    raise exception 'version_downgrade';
  end if;
  return new;
end $$;
create or replace trigger days_guard_version before update on days
  for each row execute function haruchi_guard_version();

-- settings가 값으로 바뀌는데 스탬프가 전진하지 않는 UPDATE 거부. lastExportedAt은
-- 제외한다(기기 로컬 값 — 옛 클라이언트의 내보내기 PATCH가 계속 동작해야 한다).
-- replace_all 내부 UPDATE는 세션 플래그로 면제(rewrite_sheet의 set_config 패턴).
create or replace function haruchi_guard_meta_stamp() returns trigger
language plpgsql as $$
begin
  if coalesce(current_setting('haruchi.bypass_meta_guard', true), '') = 'on' then
    return new;
  end if;
  if (new.payload #- '{settings,lastExportedAt}') is distinct from
     (old.payload #- '{settings,lastExportedAt}')
     and new.settings_at is not distinct from old.settings_at then
    raise exception 'meta_stamp_stale';
  end if;
  return new;
end $$;
create or replace trigger meta_guard_stamp before update on meta
  for each row execute function haruchi_guard_meta_stamp();

-- write_log 자동 기록 + last_seen_at 갱신. 클라이언트 추가 요청 없이 서버가 남긴다.
-- security definer인 이유(둘 다 있어야 last_seen_at이 실제로 갱신된다):
--   1. devices에는 RLS 정책이 하나도 없어(관리는 대시보드에서) 호출자 권한으로는
--      update가 항상 0행에 적용된다 — 조용한 no-op인데 설계(§4 이상 징후 확인)는 이걸
--      감사 흔적이라고 부른다. 없는 흔적을 있다고 믿는 것이 없는 것보다 나쁘다
--   2. 대상 행은 new.device(클라이언트가 만든 임의의 deviceId)가 아니라 haruchi_device()
--      가 키에서 확인해 준 id다. 둘은 서로 모르는 값이라 예전 조건은 애초에 아무 행도
--      맞히지 못했다. write_log.device는 클라이언트가 밝힌 값 그대로 남긴다(그 자체가 기록이다)
create or replace function haruchi_log() returns trigger
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
begin
  insert into write_log (device, target, action)
    values (new.device, 'day:' || new.date, lower(TG_OP));
  update devices set last_seen_at = now() where id = haruchi_device();
  return new;
end $$;

create or replace trigger days_log after insert or update on days
  for each row execute function haruchi_log();

-- 파괴적 쓰기의 유일한 경로(설계 §6). 한 트랜잭션: 자동 스냅샷 → days 교체 → meta 갱신.
-- meta 행은 지우지 않는다. p_payload는 백업 파일과 **같은 모양**이어야 한다 — 최상위
-- schemaVersion 포함(engine/backup.ts의 backupPayload가 그 모양의 주인). 이 계약은
-- v2 클라이언트(태스크 10)의 것이고, 지금 배포된 v1의 serverReplaceAll은 {days, meta}만
-- 보낸다 — schemaVersion이 없는 그 호출은 아래에서 v_ver(교체 전 days의 max)로 안전하게
-- 폴백한다(리터럴 1로 폴백하면 v2 데이터가 v1 라벨을 달고 앉아 옛 기기의 버전 게이트가
-- 뚫린다 — 설계 §1 ②).
-- 2단계: 옛 1인자 시그니처를 명시적으로 drop한다(rewrite_sheet와 같은 이유·같은 패턴).
-- create or replace는 인자 개수가 다르면 대체가 아니라 오버로드를 새로 만든다 —
-- drop 없이는 옛 1인자 시그니처가 남아 옛 앱의 {p_payload: ...} 호출이
-- "function replace_all(p_payload => jsonb) is not unique"로 거부된다(컨테이너 실측).
drop function if exists replace_all(jsonb);
create or replace function replace_all(
  p_payload jsonb, p_settings_at timestamptz default now(), p_settings_by text default ''
) returns void
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  dev text := haruchi_device();
  v_ver int;
begin
  if dev is null then raise exception 'unauthorized'; end if;
  -- 교체 전 days의 max(schema_version)을 delete보다 먼저 캡처한다 — delete 뒤에는
  -- days가 비어 있어 이 값을 다시 구할 수 없다. 스냅샷 버전과 재삽입 폴백이 둘 다 이
  -- 값을 쓴다(같은 트랜잭션 안에서 일관된 "교체 전 최고 버전").
  select coalesce(max(schema_version), 1) into v_ver from days;
  -- 스냅샷 payload는 백업 파일과 **같은 모양**이다(app·schemaVersion·exportedAt 포함).
  -- 되돌리기가 이 값을 validateBackup에 그대로 넣기 때문이다(engine/backup.ts의
  -- backupPayload가 그 모양의 주인) — 여기서만 {days, meta}로 담으면 서버가 만든
  -- 자동 스냅샷만 되돌릴 수 없게 된다.
  insert into snapshots (device, reason, day_count, payload)
    select dev, 'auto', (select count(*) from days),
      jsonb_build_object('app', 'haruchi', 'schemaVersion', v_ver, 'exportedAt', now(),
                         'days', coalesce(jsonb_agg(d.payload), '[]'::jsonb),
                         'meta', (select payload from meta where id = 1))
    from days d;
  -- **delete가 아니라 truncate인 이유**(2026-08-12 실사용에서 실패해 확정). Supabase는
  -- `authenticator` 역할에 safeupdate 확장을 세션 프리로드해 WHERE 없는 UPDATE·DELETE를
  -- 실행기 훅에서 거부한다 — `delete from days`는 SQLSTATE 21000 'DELETE requires a WHERE
  -- clause'로 죽고, PostgREST가 그걸 400으로 내보낸다. **security definer는 면제가 아니다**:
  -- 그것은 권한 검사이고 훅은 세션에 걸리므로, 함수가 소유자 권한으로 돌아도 세션 사용자가
  -- `authenticator`인 한 그대로 산다. 이 함수는 PostgREST 경유로만 불리므로 항상 걸린다.
  --
  -- `where true`로 우회하지 말 것 — 상수 폴딩으로 qual이 사라져 훅이 여전히 "WHERE 없음"으로
  -- 읽는다. `where date is not null`도 PG17이 NOT NULL 제약으로 중복 제거할 수 있어 버전에
  -- 의존한다. truncate는 유틸리티 문이라 훅(UPDATE·DELETE 전용)을 아예 안 탄다.
  --
  -- 동작은 delete와 같다: days에는 DELETE 트리거가 없고(`days_log`는 insert·update 전용),
  -- Postgres의 truncate는 트랜잭션 안에서 롤백되므로 이 함수의 원자성도 그대로다.
  --
  -- **한 가지는 다르다 — truncate는 ACCESS EXCLUSIVE 락을 잡는다**(delete는 ROW EXCLUSIVE라
  -- SELECT와 안 부딪힌다). 다른 기기의 pull이 days를 읽는 중이면 `authenticator`의
  -- `lock_timeout=8s`에 걸려 이 호출이 실패할 수 있다 — 부르는 쪽 셋(초기화·가져오기·
  -- 되돌리기)이 전부 `suspendSync` 안이라 자기 기기와는 안 겹치고, 겹쳐서 실패해도 통째
  -- 롤백이라 손실은 없다(사전 스냅샷 한 벌이 비용).
  --
  -- **이 결함이 스키마 검증을 통과한 이유**: 검증은 throwaway Postgres 컨테이너와 SQL
  -- Editor(`postgres` 역할)에서 돌았는데 둘 다 safeupdate 프리로드가 없다. 밟는 경로는
  -- `authenticator`로 들어오는 진짜 PostgREST 호출뿐이다 — **RPC를 새로 쓸 때는 적용
  -- 가능성이 아니라 그 경로의 실행 가능성을 확인할 것.**
  truncate days;
  insert into days (date, payload, rev, schema_version, device)
    select day->>'date', day, 1, coalesce((p_payload->>'schemaVersion')::int, v_ver), dev
    from jsonb_array_elements(coalesce(p_payload->'days', '[]'::jsonb)) as day;
  perform set_config('haruchi.bypass_meta_guard', 'on', true);
  update meta set payload = coalesce(p_payload->'meta', '{}'::jsonb),
    rev = rev + 1, generation = generation + 1, device = dev,
    settings_at = p_settings_at, settings_by = p_settings_by where id = 1;
  insert into write_log (device, target, action) values (dev, 'all', 'replace_all');
end $$;

-- 다시 만들기 전용(설계 §2 C-1). 채점이 있는 날은 거부 — 지금 클라이언트와 같은 조건.
drop function if exists rewrite_sheet(text, jsonb, bigint);
create or replace function rewrite_sheet(
  p_date text, p_payload jsonb, p_rev bigint,
  p_sheet_at timestamptz default now(), p_sheet_by text default '',
  p_schema_version int default 1
) returns void
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  dev text := haruchi_device();
begin
  if dev is null then raise exception 'unauthorized'; end if;
  if exists (select 1 from days where date = p_date
             and coalesce(payload->'grades', '{}'::jsonb) <> '{}'::jsonb) then
    raise exception 'sheet_rewrite_graded';
  end if;
  perform set_config('haruchi.sheet_rewrite', 'on', true);
  update days set payload = p_payload, rev = p_rev,
    sheet_at = p_sheet_at, sheet_by = p_sheet_by,
    schema_version = greatest(schema_version, p_schema_version), device = dev
    where date = p_date and rev = p_rev - 1;
  if not found then raise exception 'rev_conflict'; end if;
  insert into write_log (device, target, action) values (dev, 'day:' || p_date, 'sheet-rewrite');
end $$;

-- 2C: 등록된 기기가 새 기기 초대 코드를 발급한다(설계 2단계 §5).
-- 코드는 gen_random_bytes 기반이다 — random()은 암호학적 난수가 아니다. 4바이트를
-- 10^6으로 접는 모듈로 편향은 2^32 % 10^6 / 2^32 ≈ 0.0225%로 무시 가능하다.
create or replace function issue_invite() returns text
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  dev  text := haruchi_device();
  code text;
begin
  if dev is null then
    raise exception '등록된 기기만 초대를 만들 수 있어요';
  end if;
  -- 기존 활성 초대를 만료해 둔다(정리 목적). 이게 활성 최대 1을 보증하지는
  -- 않는다 — READ COMMITTED에서 동시 발급 두 세션이면 활성 초대 2개가 남을 수
  -- 있다(실측). 활성 최대 1의 진짜 보증은 여기가 아니라 claim_invite가
  -- order by id desc limit 1로 최신 것만 골라 옛 초대를 청구 불가로 만드는 쪽이다.
  -- (safeupdate: where 필수 — 이 파일의 모든 update가 지키는 계약)
  update invites set expires_at = now()
    where used_at is null and expires_at > now();
  code := lpad(((('x' || encode(gen_random_bytes(4), 'hex'))::bit(32)::bigint) % 1000000)::text, 6, '0');
  insert into invites (code_hash, created_by, expires_at)
    values (crypt(code, gen_salt('bf')), dev, now() + interval '10 minutes');
  insert into write_log (device, target, action) values (dev, 'invite', 'invite-issue');
  return code;
end $$;

-- 2C: 새 기기가 코드로 자기 키를 받는다(설계 2단계 §5). 익명 호출 — 이 기기에는
-- 아직 키가 없다. 성공 시 평문 키를 이 한 번만 돌려주고 서버에는 해시만 남는다.
--
-- **사용자 수준 실패는 예외가 아니라 jsonb 반환이다.** raise exception은 트랜잭션을
-- 통째로 되돌려 fail_count 증가까지 지운다 — 그러면 5회 만료가 영영 안 걸리고
-- 무차별 대입 방어(설계 §5)가 죽는다. 예외는 상태를 남길 필요가 없는 오용
-- (빈 기기 id)에만 쓴다.
create or replace function claim_invite(p_code text, p_device_id text, p_label text)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
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
  -- is distinct from을 쓴다(<>가 아니라). crypt()는 strict라 p_code가 null이면
  -- crypt(null, ...)도 null이고, text <> null은 null이며 plpgsql의 IF는 null을
  -- false로 다뤄 오답 분기를 건너뛰고 그대로 성공 경로로 떨어진다 — p_code=null
  -- 호출이 코드 검증 없이 키를 내주는 구멍이었다(리뷰에서 실측). is distinct
  -- from은 null도 "다르다"로 판정해 오답 분기로 보낸다.
  if inv.code_hash is distinct from crypt(p_code, inv.code_hash) then
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

-- RLS: 키가 맞는 기기에게만, 아니면 전무. devices 테이블 자체는 정책이 없어
-- 클라이언트가 못 읽는다(관리는 대시보드에서).
alter table days enable row level security;
alter table meta enable row level security;
alter table app_config enable row level security;
alter table snapshots enable row level security;
alter table write_log enable row level security;
alter table devices enable row level security;

-- DELETE 정책은 의도적으로 없다(select·insert·update만 열어 둔다):
--   - meta.generation은 절대 지워지면 안 된다 — 오프라인 기기가 지운 데이터를
--     되살리는 것을 막는 단조 증가 카운터라서, 행 자체가 사라지면 그 방어가 없어진다
--     (설계 §6 "meta 행은 절대 지우지 않는 이유").
--   - days DELETE를 열면 sheet 불변 트리거(BEFORE UPDATE에만 걸림)와 replace_all의
--     자동 스냅샷을 둘 다 건너뛰어, 백업 없이 하루 기록이 사라질 수 있다.
--   - snapshots·write_log는 추가 전용(append-only) 감사 이력이라 삭제할 이유가 없다.
-- 이 프로젝트의 어떤 클라이언트도 DELETE를 보내지 않는다(태스크 2–11은 GET·POST·PATCH와
-- replace_all·rewrite_sheet 두 RPC만 쓴다) — 지워도 기능 손실이 없다.
-- Postgres의 create policy는 for에 명령을 하나만 받으므로(콤마로 여러 개를 못 나열한다),
-- 동사별로 정책을 나눈다. select는 using만, insert는 with check만, update는 둘 다 쓴다.
drop policy if exists days_select on days;
create policy days_select on days for select
  using (haruchi_device() is not null);
drop policy if exists days_insert on days;
create policy days_insert on days for insert
  with check (haruchi_device() is not null);
drop policy if exists days_update on days;
create policy days_update on days for update
  using (haruchi_device() is not null) with check (haruchi_device() is not null);

drop policy if exists meta_select on meta;
create policy meta_select on meta for select
  using (haruchi_device() is not null);
drop policy if exists meta_update on meta;
create policy meta_update on meta for update
  using (haruchi_device() is not null) with check (haruchi_device() is not null);

drop policy if exists config_select on app_config;
create policy config_select on app_config for select
  using (haruchi_device() is not null);
drop policy if exists config_insert on app_config;
create policy config_insert on app_config for insert
  with check (haruchi_device() is not null);
drop policy if exists config_update on app_config;
create policy config_update on app_config for update
  using (haruchi_device() is not null) with check (haruchi_device() is not null);

drop policy if exists snapshots_select on snapshots;
create policy snapshots_select on snapshots for select
  using (haruchi_device() is not null);
drop policy if exists snapshots_insert on snapshots;
create policy snapshots_insert on snapshots for insert
  with check (haruchi_device() is not null);

drop policy if exists log_select on write_log;
create policy log_select on write_log for select
  using (haruchi_device() is not null);
drop policy if exists log_insert on write_log;
create policy log_insert on write_log for insert
  with check (haruchi_device() is not null);
