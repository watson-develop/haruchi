-- haruchi 동기화 백엔드 스키마. 단일 출처 — 서버 규칙을 바꿀 때는 이 파일을 고치고
-- Supabase SQL Editor에서 재적용한다. 근거: docs/superpowers/specs/2026-08-06-sync-backend-design.md
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

create table if not exists meta (
  id         int primary key default 1 check (id = 1),
  payload    jsonb not null,
  rev        bigint not null,
  generation bigint not null,
  updated_at timestamptz not null default now(),
  device     text not null
);

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

-- meta는 행이 항상 존재해야 한다 — generation 카운터가 행과 함께 영속한다(설계 §6).
insert into meta (id, payload, rev, generation, device)
  values (1, '{}'::jsonb, 0, 0, 'schema')
  on conflict (id) do nothing;

-- 요청 헤더의 기기 키를 확인해 기기 id를 돌려준다. RLS·트리거 공용.
create or replace function haruchi_device() returns text
language sql stable security definer as $$
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

create trigger days_touch before insert or update on days
  for each row execute function haruchi_touch();
create trigger meta_touch before insert or update on meta
  for each row execute function haruchi_touch();
create trigger config_touch before insert or update on app_config
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

create trigger days_guard_sheet before update on days
  for each row execute function haruchi_guard_sheet();

-- write_log 자동 기록 + last_seen_at 갱신. 클라이언트 추가 요청 없이 서버가 남긴다.
create or replace function haruchi_log() returns trigger
language plpgsql as $$
begin
  insert into write_log (device, target, action)
    values (new.device, 'day:' || new.date, lower(TG_OP));
  update devices set last_seen_at = now() where id = new.device;
  return new;
end $$;

create trigger days_log after insert or update on days
  for each row execute function haruchi_log();

-- 파괴적 쓰기의 유일한 경로(설계 §6). 한 트랜잭션: 자동 스냅샷 → days 교체 → meta 갱신.
-- meta 행은 지우지 않는다. p_payload 형식: { "days": Day[], "meta": Meta }
create or replace function replace_all(p_payload jsonb) returns void
language plpgsql security definer as $$
declare
  dev text := haruchi_device();
begin
  if dev is null then raise exception 'unauthorized'; end if;
  insert into snapshots (device, reason, day_count, payload)
    select dev, 'auto', (select count(*) from days),
      jsonb_build_object('days', coalesce(jsonb_agg(d.payload), '[]'::jsonb),
                         'meta', (select payload from meta where id = 1))
    from days d;
  delete from days;
  insert into days (date, payload, rev, schema_version, device)
    select day->>'date', day, 1, 1, dev
    from jsonb_array_elements(coalesce(p_payload->'days', '[]'::jsonb)) as day;
  update meta set payload = coalesce(p_payload->'meta', '{}'::jsonb),
    rev = rev + 1, generation = generation + 1, device = dev where id = 1;
  insert into write_log (device, target, action) values (dev, 'all', 'replace_all');
end $$;

-- 다시 만들기 전용(설계 §2 C-1). 채점이 있는 날은 거부 — 지금 클라이언트와 같은 조건.
create or replace function rewrite_sheet(p_date text, p_payload jsonb, p_rev bigint) returns void
language plpgsql security definer as $$
declare
  dev text := haruchi_device();
begin
  if dev is null then raise exception 'unauthorized'; end if;
  if exists (select 1 from days where date = p_date
             and coalesce(payload->'grades', '{}'::jsonb) <> '{}'::jsonb) then
    raise exception 'sheet_rewrite_graded';
  end if;
  perform set_config('haruchi.sheet_rewrite', 'on', true);
  update days set payload = p_payload, rev = p_rev, sheet_at = now(), device = dev
    where date = p_date and rev = p_rev - 1;
  if not found then raise exception 'rev_conflict'; end if;
  insert into write_log (device, target, action) values (dev, 'day:' || p_date, 'sheet-rewrite');
end $$;

-- RLS: 키가 맞는 기기에게만 전부, 아니면 전무. devices 테이블 자체는 정책이 없어
-- 클라이언트가 못 읽는다(관리는 대시보드에서).
alter table days enable row level security;
alter table meta enable row level security;
alter table app_config enable row level security;
alter table snapshots enable row level security;
alter table write_log enable row level security;
alter table devices enable row level security;

create policy days_all on days for all
  using (haruchi_device() is not null) with check (haruchi_device() is not null);
create policy meta_all on meta for all
  using (haruchi_device() is not null) with check (haruchi_device() is not null);
create policy config_all on app_config for all
  using (haruchi_device() is not null) with check (haruchi_device() is not null);
create policy snapshots_rw on snapshots for all
  using (haruchi_device() is not null) with check (haruchi_device() is not null);
create policy log_rw on write_log for all
  using (haruchi_device() is not null) with check (haruchi_device() is not null);
