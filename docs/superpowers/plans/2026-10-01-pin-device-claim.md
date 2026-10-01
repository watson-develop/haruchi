# PIN으로 기기 연결 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 최근 3일 안에 본 부모 기기가 하나도 없을 때만, 부모 PIN을 초대 코드 대신 받아 기기를 등록한다.

**Architecture:** 서버에 `claim_with_pin` RPC(비상 모드 검사 → 전역 실패 카운터 → PIN 비교 →
`claim_invite`와 같은 등록부)와 정책 없는 `pin_guard` 테이블을 더하고, `my_device()`가 호출
기기의 `last_seen_at`을 찍는 하트비트가 된다. 앱은 `sync.ts`의 claim 본문을 RPC 이름만 다른
내부 함수로 뽑아 `claimWithPin`을 얹고, 부모 홈 미등록 블록에 PIN 전용 입력칸을 둔다. 관리
화면 기기 목록 라벨이 「마지막 접속」이 된다.

**Tech Stack:** Supabase(Postgres plpgsql, PostgREST), TypeScript 바닐라 DOM, Vitest(fake-indexeddb).

**Spec:** `docs/superpowers/specs/2026-10-01-pin-device-claim-design.md` — 실행자는 이 계획과 함께
스펙을 읽는다. 스펙의 「왜」를 코드 주석에 옮길 때 그 절 번호를 단다.

## Global Constraints

- 모든 npm 명령 전에: `export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH"`
- **브랜치 작업이다**: `pin-device-claim`. 앱 코드(PIN 버튼)는 서버 RPC가 적용되기 전에 배포되면
  404 → `showError`가 된다. main에는 Task 6에서 스키마 적용·실측 뒤 squash 머지로만 들어간다
- `git add <명시 경로>`만 쓴다. `git add .` 금지
- 커밋 전 `npm run format`(docs 포함 — CI가 마크다운까지 `prettier --check`한다)
- 커밋 메시지 끝: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- `schema.sql`은 멱등이어야 한다(전체 재실행이 적용 방법이다). 모든 `update`에 `where`(safeupdate)
- 사용자 수준 실패는 RPC가 `raise`가 아니라 `jsonb {error}`로 반환한다(카운터 증가가 롤백되지 않게)
- 서버가 준 문자열은 화면에 `textContent`로만 넣는다(`el()` 템플릿 금지 — XSS 경계)
- 문구는 `-어요` 체. 화면 문구에 「3일」·「사흘」 숫자를 쓰지 않는다(「한동안」) — 3일의 원본은
  `schema.sql`의 `claim_with_pin` 하나다
- 서버 오류 문구(스펙 §2.2 그대로):
  - 비상 아님: `부모 기기가 있어요 — 그 기기의 부모 홈 → 「새 기기 추가」로 코드를 받아 주세요. 모르는 기기라면 SQL로 정리해야 해요(README 8절)`
  - 잠김: `PIN 연결이 잠겼어요 — SQL로 풀어야 해요(README 8절)`
  - 미설정: `PIN이 설정되지 않았어요 — 초대 코드로 연결해 주세요`
  - 오답: `PIN이 맞지 않아요 — 초대 코드를 넣으셨다면 위의 「연결하기」를 눌러 주세요`
- DOM·화면 단위 테스트는 쓰지 않는다(레포 규칙). 화면 변경은 dev 서버에서 눈으로 확인한다

## Review Focus

1. **앞자리 0인 PIN**(`0123`) — 숫자로 변환되면 `123`이 되어 영원히 오답이다. 요청 본문의
   `p_pin`이 문자열 그대로여야 한다 → Task 2 테스트 「앞자리 0 PIN을 문자열 그대로 보낸다」
2. **등록 성공 뒤 pull이 실패**(오프라인·5xx) — 등록 자체는 성공으로 끝나야 한다(`pullOnce`는
   삼킨다) → Task 2 성공 테스트가 나머지 요청 전부를 500으로 스텁한다
3. **서버가 200인데 key도 error도 없음** — `{ok:false, reason:'알 수 없는 응답'}` → Task 2 테스트
4. **리팩터가 초대 경로를 깨뜨림** — `claimInvite`는 여전히 `rpc/claim_invite`에 `p_code`를 보내야
   한다 → Task 2 회귀 테스트
5. **두 버튼 교차 연타** — 한 경로 진행 중 다른 버튼이 눌리면 다른 카운터를 태운다. 둘 다
   disable → Task 3 수동 확인 단계(DOM 테스트 없음)

---

### Task 1: 서버 — `pin_guard`·`claim_with_pin`·하트비트

**Files:**

- Modify: `supabase/schema.sql` (invites 블록 뒤 `:92` 부근, `haruchi_log` 주석 `:194-200`,
  `claim_invite` 끝 `:417` 뒤, `my_device` `:442-455`)

**Interfaces:**

- Produces: RPC `claim_with_pin(p_pin text, p_device_id text, p_label text) returns jsonb` —
  성공 `{key: string}`, 실패 `{error: string}`. `my_device()`는 반환 `{child}` 그대로, 부수효과로
  `last_seen_at = now()`

- [ ] **Step 1: 스펙·계획 커밋을 main에 먼저 내보내고 브랜치를 만든다**

main에는 문서만 바뀐 커밋(스펙·이 계획)이 로컬로 쌓여 있다. 문서 커밋은 배포 가능하다(규칙 ③).
브랜치 전에 내보내야 squash 머지 뒤 로컬 main이 origin과 갈라지지 않는다.

```bash
cd /Users/iseongho/workspace/haruchi
export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH"
npx prettier --check . && npm test && npm run build
git push origin main && gh run watch
git switch -c pin-device-claim && pwd
```

Expected: 배포 워크플로 초록, `Switched to a new branch 'pin-device-claim'`

- [ ] **Step 2: `pin_guard` 테이블을 invites RLS 줄 바로 뒤에 넣는다**

`supabase/schema.sql`에서 `alter table invites enable row level security;` 줄 바로 다음에:

```sql

-- PIN 기기 연결(PIN 기기 연결 설계 §2.1). 전역 1행 실패 카운터 — 행마다 두면 공격자가 행을
-- 갈아 가며 우회한다. app_config에 열로 두지 않는 이유: config_update 정책이 등록 기기에게
-- 그 행 갱신을 열어 두므로(RLS는 행 단위) 카운터를 방어 대상이 되돌릴 수 있게 된다.
-- 정책 없음: RPC(security definer)만 접근. 해제는 update로만 — delete하면 claim_with_pin이
-- fail-closed로 영구 잠근다(재적용이 행을 되살린다).
create table if not exists pin_guard (
  id         int primary key default 1 check (id = 1),
  fail_count int not null default 0
);
insert into pin_guard (id) values (1) on conflict (id) do nothing;
alter table pin_guard enable row level security;
```

- [ ] **Step 3: `haruchi_log` 주석에 하트비트 사실을 더한다**

`-- write_log 자동 기록 + last_seen_at 갱신. 클라이언트 추가 요청 없이 서버가 남긴다.` 줄 바로
다음에 한 줄:

```sql
-- last_seen_at은 이제 「마지막 접속」이다 — my_device()도 pull마다 찍는다(PIN 기기 연결 설계
-- §2.3). 쓰기 흔적은 write_log만 본다.
```

- [ ] **Step 4: `claim_with_pin`을 `claim_invite` 함수 끝(`end $$;`) 바로 뒤에 넣는다**

`claim_invite`의 마지막 `return jsonb_build_object('key', key);` 다음 `end $$;` 뒤, 다음 주석
`-- 기기 목록(기기 상한 설계 §2).` 앞에:

```sql

-- PIN 기기 연결(PIN 기기 연결 설계 §2.2). claim_invite의 형제 — 증명 수단만 초대 코드 대신
-- 부모 PIN이고, **최근 3일 안에 본 활성 부모 기기가 없을 때(비상 모드)만** 통한다.
-- 순서가 계약이다:
--   1. id 가드(raise — 상태를 남길 필요가 없는 오용)
--   2. 비상 모드 검사가 맨 앞 — 평소에는 PIN이 한 번도 비교되지 않아 원격 대입도, 일부러
--      잠그기도 불가능하다. 카운터를 읽지도 올리지도 않는다. 락 없이 읽는다(경합해도 결과는
--      「PIN을 아는 사람이 한 대 더 등록」이라 무해). 3일의 유일한 원본이 여기다
--   3. pin_guard for update — 동시 오답의 증가 유실을 막는다. 행이 없으면 잠김(fail-closed:
--      null 카운터는 >= 5를 통과하고 오답 update가 0행에 떨어진다). for update는 읽기 전용
--      트랜잭션에서 오류라 PostgREST GET으로는 비교까지 못 온다 — advisory lock으로 바꾸지 말 것
--   4. 잠김이면 PIN을 비교하지 않는다(정답 여부도 흘리지 않는다)
--   5. PIN 미설정은 카운터를 올리지 않는다
--   6. 오답은 raise가 아니라 반환(raise는 증가를 롤백한다 — claim_invite 주석). is distinct
--      from이 p_pin = null을 오답으로 보낸다. pin-fail 로그는 잠금당 최대 5줄
--   7. 정답이면 0으로
--   8. id 중복 검사는 정답 **뒤** — 앞이면 카운터 없이 임의 id 등록 여부를 탐색할 수 있다.
--      이후는 claim_invite 등록부와 같고, 새 행에 last_seen_at = now()를 넣어 비상 모드를
--      즉시 닫는다(첫 pull 전의 두 번째 PIN 청구를 막는다)
-- 락 순서: pin_guard 행 → advisory. 반대 순서로 잡는 함수를 만들지 말 것(교착).
drop function if exists claim_with_pin(text, text, text);
create function claim_with_pin(p_pin text, p_device_id text, p_label text)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  fails   int;
  cur_pin text;
  key     text;
begin
  if p_device_id is null or p_device_id = '' then
    raise exception '기기 id가 비어 있어요';
  end if;
  if length(p_device_id) > 64 then
    raise exception '기기 id가 너무 길어요';
  end if;
  if exists (select 1 from devices
             where revoked_at is null and not child
               and last_seen_at > now() - interval '3 days') then
    return jsonb_build_object('error',
      '부모 기기가 있어요 — 그 기기의 부모 홈 → 「새 기기 추가」로 코드를 받아 주세요. 모르는 기기라면 SQL로 정리해야 해요(README 8절)');
  end if;
  select fail_count into fails from pin_guard where id = 1 for update;
  if not found or fails >= 5 then
    return jsonb_build_object('error', 'PIN 연결이 잠겼어요 — SQL로 풀어야 해요(README 8절)');
  end if;
  select pin into cur_pin from app_config where id = 1;
  if cur_pin is null or cur_pin = '' then
    return jsonb_build_object('error', 'PIN이 설정되지 않았어요 — 초대 코드로 연결해 주세요');
  end if;
  if cur_pin is distinct from p_pin then
    update pin_guard set fail_count = fail_count + 1 where id = 1;
    insert into write_log (device, target, action) values (p_device_id, 'pin', 'pin-fail');
    return jsonb_build_object('error',
      'PIN이 맞지 않아요 — 초대 코드를 넣으셨다면 위의 「연결하기」를 눌러 주세요');
  end if;
  update pin_guard set fail_count = 0 where id = 1;
  if exists (select 1 from devices where id = p_device_id) then
    return jsonb_build_object('error', '이미 등록된 기기예요');
  end if;
  perform pg_advisory_xact_lock(hashtext('haruchi'), hashtext('devices'));
  if (select count(*) from devices where revoked_at is null) >= 5 then
    return jsonb_build_object('error',
      '기기가 5대라 더 들어올 수 없어요 — 기존 기기의 관리 화면에서 한 대를 해제해 주세요');
  end if;
  key := encode(gen_random_bytes(32), 'base64');
  insert into devices (id, label, key_hash, last_seen_at)
    values (p_device_id, coalesce(nullif(left(trim(p_label), 40), ''), '새 기기'),
            crypt(key, gen_salt('bf')), now());
  insert into write_log (device, target, action) values (p_device_id, 'pin', 'pin-claim');
  return jsonb_build_object('key', key);
end $$;
```

- [ ] **Step 5: `my_device()`를 하트비트로 바꾼다**

지금 본문(`language plpgsql stable security definer ...` ~ `end $$;`)을 통째로 바꾼다. 위 주석
블록 첫 줄 `-- 호출 기기 자신의 표식(아이 기기 설계 §2).` 앞 줄들은 두고, 그 주석 끝에 두 줄을
더한 뒤 함수를 교체:

```sql
-- 하트비트(PIN 기기 연결 설계 §2.3): 호출 기기의 last_seen_at을 찍는다 — 앱이 pull마다 POST로
-- 부른다. 그래서 stable이 아니다(stable이면 PostgREST가 POST도 읽기 전용 트랜잭션으로 돌려
-- update가 오류 → pullDeviceFlag의 catch가 삼켜 하트비트가 소리 없이 사라진다).
drop function if exists my_device();
create function my_device() returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  dev text := haruchi_device();
begin
  if dev is null then
    raise exception '등록된 기기가 아니에요';
  end if;
  update devices set last_seen_at = now() where id = dev;
  return (select jsonb_build_object('child', d.child) from devices d where d.id = dev);
end $$;
```

(원래 있던 `drop function if exists my_device();` 줄은 하나만 남긴다 — 위 블록이 그 줄을 포함한다.)

- [ ] **Step 6: 정적 확인**

```bash
cd /Users/iseongho/workspace/haruchi
grep -c "drop function if exists my_device();" supabase/schema.sql      # 1
grep -n "stable security definer" supabase/schema.sql                  # my_device 줄이 없어야 한다
grep -n "^update\|  update\|    update" supabase/schema.sql | grep -v where   # 새 줄이 나오면 안 된다
tail -3 supabase/schema.sql                                             # notify pgrst 가 마지막에 있다
```

로컬 Postgres가 없으므로 실행 검증은 Task 6(SQL Editor)에서 한다.

- [ ] **Step 7: 커밋**

```bash
git add supabase/schema.sql
git commit -m "feat(db): claim_with_pin — 비상 모드 PIN 기기 연결, my_device 하트비트

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `sync.ts` — `claimWithPin`

**Files:**

- Modify: `src/data/sync.ts:1373-1429` (`claimInvite` 블록)
- Test: `src/data/sync.test.ts` (파일 끝에 describe 추가, import 줄 수정)

**Interfaces:**

- Consumes: Task 1의 RPC 이름 `claim_with_pin`, 파라미터 `p_pin`·`p_device_id`·`p_label`
- Produces:
  - `export type ClaimResult = { ok: true } | { ok: false; reason: string }`
  - `export function claimInvite(code: string, label: string): Promise<ClaimResult>` (시그니처 불변)
  - `export function claimWithPin(pin: string, label: string): Promise<ClaimResult>`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/data/sync.test.ts` import를 바꾼다:

```ts
import {
  claimInvite,
  claimWithPin,
  kickPush,
  onPullApplied,
  pullOnce,
  resumeSync,
  skipUnchangedPush,
  suspendSync,
} from './sync'
```

파일 끝에 추가:

```ts
describe('claimWithPin — PIN 기기 연결(설계 §3.1)', () => {
  beforeEach(async () => {
    await getDay('__init__')
    await resetStores()
  })
  afterEach(async () => {
    // kickPush가 띄운 배경 비행을 끝낸다 — 다음 테스트의 스토어 초기화와 겹치지 않게.
    await suspendSync()
    resumeSync()
    vi.unstubAllGlobals()
  })

  /** 등록 RPC 하나만 answer로 답하고 나머지(pull·push)는 전부 500 — 등록 뒤 pull 실패도 함께 검사된다. */
  function stubClaim(rpc: string, answer: () => Response): ReturnType<typeof vi.fn> {
    const f = vi.fn(async (url: string) =>
      url.endsWith(`/rest/v1/rpc/${rpc}`) ? answer() : json({}, 500),
    )
    vi.stubGlobal('fetch', f)
    return f
  }
  function claimBody(f: ReturnType<typeof vi.fn>, rpc: string): Record<string, unknown> {
    const call = f.mock.calls.find(([url]) => String(url).endsWith(`/rest/v1/rpc/${rpc}`))
    expect(call).toBeDefined()
    return JSON.parse(String((call![1] as RequestInit).body)) as Record<string, unknown>
  }

  it('성공 → rpc/claim_with_pin에 p_pin을 싣고, 키 저장·커서 초기화(첫 등록 계약)', async () => {
    const { deviceId } = await getDeviceState()
    await updateDeviceState((s) => ({ ...s, lastPulledAt: 'OLD', generation: 7 }))
    const f = stubClaim('claim_with_pin', () => json({ key: 'K' }))

    expect(await claimWithPin('1234', '아이패드')).toEqual({ ok: true })

    expect(claimBody(f, 'claim_with_pin')).toEqual({
      p_pin: '1234',
      p_device_id: deviceId,
      p_label: '아이패드',
    })
    const s = await getDeviceState()
    expect(s.deviceKey).toBe('K')
    expect(s.lastPulledAt).toBeNull() // pull이 500으로 실패해도 등록은 성공이다
    expect(s.generation).toBeNull()
  })

  it('앞자리 0 PIN을 문자열 그대로 보낸다', async () => {
    const f = stubClaim('claim_with_pin', () => json({ key: 'K' }))
    await claimWithPin('0123', '')
    expect(claimBody(f, 'claim_with_pin')['p_pin']).toBe('0123')
  })

  it('{error} → {ok:false, reason}, 키는 그대로 없음', async () => {
    stubClaim('claim_with_pin', () => json({ error: 'PIN이 맞지 않아요' }))
    expect(await claimWithPin('9999', '')).toEqual({ ok: false, reason: 'PIN이 맞지 않아요' })
    expect((await getDeviceState()).deviceKey).toBeNull()
  })

  it('200인데 key도 error도 없으면 알 수 없는 응답', async () => {
    stubClaim('claim_with_pin', () => json({}))
    expect(await claimWithPin('1234', '')).toEqual({ ok: false, reason: '알 수 없는 응답' })
  })

  it('HTTP 실패는 던진다(장애 — showError 결)', async () => {
    stubClaim('claim_with_pin', () => json({ message: 'boom' }, 404))
    await expect(claimWithPin('1234', '')).rejects.toThrow()
  })

  it('회귀: claimInvite는 여전히 rpc/claim_invite에 p_code를 보낸다', async () => {
    const f = stubClaim('claim_invite', () => json({ key: 'K' }))
    expect(await claimInvite('123456', 'x')).toEqual({ ok: true })
    const body = claimBody(f, 'claim_invite')
    expect(body['p_code']).toBe('123456')
    expect(body).not.toHaveProperty('p_pin')
  })
})
```

- [ ] **Step 2: 실패 확인**

```bash
export PATH="$HOME/.local/share/mise/installs/node/lts/bin:$PATH"
npx vitest run src/data/sync.test.ts -t "claimWithPin"
```

Expected: FAIL — `claimWithPin`이 export되지 않음(`is not a function` 또는 타입 오류).

- [ ] **Step 3: `claimInvite` 블록을 교체한다**

`src/data/sync.ts`의 `/** 코드로 이 기기를 등록한다(2C 설계 §5).` 주석부터 `claimInvite` 함수의
닫는 `}`까지를 아래로 바꾼다. 본문의 긴 주석 두 개(커서 초기화·시딩 순서)는 **그대로** 옮긴다 —
여기서는 첫 줄만 바뀐다:

```ts
export type ClaimResult = { ok: true } | { ok: false; reason: string }

/** 초대 코드로 이 기기를 등록한다(2C 설계 §5). 결과의 결은 `claim` 참고. */
export function claimInvite(code: string, label: string): Promise<ClaimResult> {
  return claim('claim_invite', { p_code: code }, label)
}

/**
 * 부모 PIN으로 이 기기를 등록한다(PIN 기기 연결 설계 §3.1). 서버가 비상 모드(최근 본 부모
 * 기기 없음)일 때만 통하고, 아니면 `{ok:false}`로 그 사실을 말한다. PIN은 문자열 그대로
 * 보낸다 — 숫자로 바꾸면 앞자리 0이 사라진다.
 */
export function claimWithPin(pin: string, label: string): Promise<ClaimResult> {
  return claim('claim_with_pin', { p_pin: pin }, label)
}

/**
 * 등록 RPC 공통 본문. 익명 호출 — 아직 키가 없다(req()의 x-device-key가 ''로 나가고 서버는
 * 무시한다).
 *
 * 사용자 수준 실패(코드·PIN 불일치·만료·잠김·경쟁 패배)는 서버가 200 + {error}로
 * 돌려준다 — 예외로 던지면 서버의 실패 카운터 증가가 롤백되기 때문이다(schema.sql
 * claim_invite 주석). 그래서 반환 타입이 유니온이다: 던지는 것은 네트워크·서버
 * 장애뿐이고, {ok: false}는 사람이 고칠 수 있는 입력 문제다.
 *
 * 성공 시 키 저장 → 시딩 → pull → push. 두 경로가 이 순서를 공유하는 것이 계약이다 —
 * 복제하면 한쪽만 고쳐지는 순간 조용히 기록이 빈다.
 */
async function claim(
  rpc: 'claim_invite' | 'claim_with_pin',
  proof: { p_code: string } | { p_pin: string },
  label: string,
): Promise<ClaimResult> {
  // 호출자가 syncEnabled() 게이트를 빠뜨렸을 때만 닿는다 — 형제 함수들과 같다.
  if (!configured()) throw new Error('동기화가 설정되지 않았어요')
  const device = await getDeviceState()
  const res = await req(`${SUPABASE_URL}/rest/v1/rpc/${rpc}`, {
    method: 'POST',
    body: JSON.stringify({ ...proof, p_device_id: device.deviceId, p_label: label }),
  })
  if (!res.ok) throw await failed('기기 등록', res)
  const body = (await res.json()) as { key?: string; error?: string }
  if (typeof body.key !== 'string' || body.key === '') {
    return { ok: false, reason: typeof body.error === 'string' ? body.error : '알 수 없는 응답' }
  }
  const key = body.key
  // **커서 셋을 함께 비운다 — 서버 관점에서 claim은 언제나 「첫 등록」이다.**
  // 두 등록 RPC 모두 이미 `devices`에 있는 id를 거부하므로, 성공했다는 것은 서버가 이
  // (… 원래 주석의 나머지 줄 그대로 …)
  await updateDeviceState((s) => ({
    ...s,
    deviceKey: key,
    lastPulledAt: null,
    generation: null,
    seededAt: null,
  }))
  // **pull보다 먼저 시딩한다 — 순서가 시딩 범위를 정한다.**
  // (… 원래 주석의 나머지 줄 그대로 …)
  await seedOutbox()
  await pullOnce()
  kickPush()
  return { ok: true }
}
```

`(… 원래 주석의 나머지 줄 그대로 …)` 자리는 지금 파일의 해당 주석 줄을 한 글자도 바꾸지 않고
옮긴다(첫 주석의 둘째 줄 「`claim_invite`가 이미」만 「두 등록 RPC 모두 이미」로 바뀐다).

- [ ] **Step 4: 통과 확인**

```bash
npx vitest run src/data/sync.test.ts
```

Expected: 전부 PASS(기존 테스트 포함).

- [ ] **Step 5: 변이 검증 — 테스트가 실제로 잡는지**

`claimWithPin` 안의 `'claim_with_pin'`을 `'claim_invite'`로 잠시 바꾸고
`npx vitest run src/data/sync.test.ts -t "claimWithPin"` → 성공·앞자리 0 테스트가 FAIL해야 한다.
원복. 다음으로 `{ p_pin: pin }`을 `{ p_pin: Number(pin) as unknown as string }`으로 잠시 바꿔
「앞자리 0」 테스트만 FAIL하는지 본다. 원복.

- [ ] **Step 6: 전체 검사 후 커밋**

```bash
npm test && npm run build
git add src/data/sync.ts src/data/sync.test.ts
git commit -m "feat(sync): claimWithPin — 등록 본문을 claim으로 뽑아 두 경로가 공유

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: 부모 홈 — PIN 입력칸과 재연결 문구

**Files:**

- Modify: `src/screens/home-parent.ts` (import `:10` 부근, setup 블록 `:100-107`, 코드 등록 핸들러
  `:212-243`, 재연결 주석·다이얼로그 `:300-313`)

**Interfaces:**

- Consumes: `claimInvite`, `claimWithPin`, `ClaimResult` from `../data/sync`

- [ ] **Step 1: `frontend-design` 스킬을 로드한다**(레포 규칙 — UI 모양을 고치는 작업). 그리고
      `docs/reference/karrot-DESIGN.md`의 보이스 절을 읽는다. 아래 문구는 이미 그 규칙을 따른다

- [ ] **Step 2: import에 `claimWithPin`·`type ClaimResult`를 더한다**

`claimInvite,`가 있는 `../data/sync` import 목록에 `claimWithPin,`을 넣고, 같은 import 문에
`type ClaimResult`를 더한다(또는 별도 `import type { ClaimResult } from '../data/sync'`).

- [ ] **Step 3: setup 블록에 PIN 줄을 더한다**

지금:

```ts
              <p class="sync-hint" id="invite-hint">등록된 기기의 부모 홈 → 「새 기기 추가」로 코드를 만들어요</p>
            </div>`
```

바꿀 것:

```ts
              <p class="sync-hint" id="invite-hint">등록된 기기의 부모 홈 → 「새 기기 추가」로 코드를 만들어요</p>
              <p class="sync-hint">부모 기기를 모두 잃었나요? 한동안 어떤 부모 기기도 열리지 않았다면 부모 PIN으로 연결할 수 있어요</p>
              <input id="pin-input" type="password" inputmode="numeric" autocomplete="off" placeholder="부모 PIN" />
              <button id="pin-claim" class="step">PIN으로 연결</button>
              <p class="sync-hint" id="pin-hint"></p>
            </div>`
```

(입력칸을 공유하지 않는 이유는 스펙 §3.2 — 초대 코드를 PIN 버튼으로 다섯 번 누르면 PIN 경로가
영구 잠긴다. maxlength를 두지 않는다 — PIN은 길이 자유.)

- [ ] **Step 4: 코드 등록 핸들러를 두 경로 공용으로 바꾼다**

`// 코드 등록(2C). 실패 둘의 결이 다르다 —` 주석부터 `#invite-claim` 리스너의 닫는 `})`까지를
통째로 바꾼다:

```ts
// 등록(2C·PIN 기기 연결 설계 §3.2). 실패 둘의 결이 다르다 — {ok:false}는 사람이 고칠
// 입력 문제라 안내 줄에만 쓰고(서버가 만든 문자열이라 textContent로만 넣는다 — el()
// 템플릿에 넣지 않는다, XSS 경계), throw는 네트워크·서버 장애라 showError로 띄운다.
// 진행 중에는 **두 버튼을 함께** 막는다 — 한쪽만 막으면 연타가 다른 경로의 실패
// 카운터를 태운다(초대는 fail_count, PIN은 전역 pin_guard).
const runClaim = (
  run: () => Promise<ClaimResult>,
  input: HTMLInputElement,
  hint: HTMLParagraphElement,
): void => {
  const btns = root.querySelectorAll<HTMLButtonElement>('#invite-claim, #pin-claim')
  btns.forEach((b) => (b.disabled = true))
  hint.textContent = '연결하는 중…'
  run()
    .then((r) => {
      if (r.ok) {
        navigate('#/parent') // 같은 해시 재라우팅은 안전하다(상태를 IndexedDB에서 다시 읽는다)
        return
      }
      btns.forEach((b) => (b.disabled = false))
      input.value = ''
      hint.textContent = r.reason
    })
    .catch((e) => {
      btns.forEach((b) => (b.disabled = false))
      showError('기기를 연결하지 못했어요.', e)
      hint.textContent = '연결에 실패했어요 — 잠시 뒤 다시 눌러 주세요'
    })
}
const labelOf = (): string => root.querySelector<HTMLInputElement>('#device-label')!.value.trim()
root.querySelector('#invite-claim')?.addEventListener('click', () => {
  const input = root.querySelector<HTMLInputElement>('#invite-code')!
  const hint = root.querySelector<HTMLParagraphElement>('#invite-hint')!
  // 숫자만 남긴다 — 「123 456」처럼 띄어 적힌 코드를 붙여넣어도 통과해야 한다
  // (maxlength=6이 공백까지 세어 뒤 한 자리를 잘라내는 것도 이걸로 무해해진다).
  const code = input.value.replace(/\D/g, '')
  if (!/^\d{6}$/.test(code)) {
    hint.textContent = '코드는 숫자 6자리예요'
    return
  }
  runClaim(() => claimInvite(code, labelOf()), input, hint)
})
root.querySelector('#pin-claim')?.addEventListener('click', () => {
  const input = root.querySelector<HTMLInputElement>('#pin-input')!
  const hint = root.querySelector<HTMLParagraphElement>('#pin-hint')!
  // PIN은 숫자 전용·길이 자유(README 6.5). 문자열 그대로 보낸다 — 앞자리 0 보존.
  const pin = input.value.replace(/\D/g, '')
  if (pin === '') {
    hint.textContent = 'PIN은 숫자예요'
    return
  }
  runClaim(() => claimWithPin(pin, labelOf()), input, hint)
})
```

- [ ] **Step 5: 재연결 주석·다이얼로그 문구**

주석 줄 `// (sync.ts claimInvite). 다이얼로그가 실비용을 말한다: 새 코드가 필요해진다.`를:

```ts
// (sync.ts claim). 다이얼로그가 실비용을 말한다: 새 코드(비상이면 부모 PIN)가 필요해진다.
```

다이얼로그 description의 `'다시 연결하려면 다른 기기에서 새 초대 코드를 받아야 해요.',`를:

```ts
              '다시 연결하려면 다른 기기의 새 초대 코드가 필요해요. 부모 기기를 모두 잃었다면 부모 PIN으로도 연결할 수 있어요.',
```

(「사흘 뒤」를 쓰지 않는 이유는 스펙 §3.2 — 이 다이얼로그가 뜨는 기기에서 창이 열리는 시점은
일정하지 않다.)

- [ ] **Step 6: 빌드와 눈 확인**

```bash
npm run build && npm test
npm run dev
```

**배포본이 아니라 dev 서버(`http://localhost:5173/haruchi/#/parent`)에서만 본다** — dev origin은
미등록이라 setup 블록이 그대로 보인다. 확인:

1. 초대 코드 줄 아래 PIN 안내·가려진 입력칸·「PIN으로 연결」이 보인다
2. PIN 칸을 비우고 누르면 `#pin-hint`에 「PIN은 숫자예요」, 요청이 나가지 않는다(DevTools Network)
3. PIN `1234` 입력 → 누르는 순간 **두 버튼 모두** disabled가 되고(Elements 패널), 응답(아직 서버에
   RPC가 없으면 404 → 오류 다이얼로그) 뒤 둘 다 풀린다
4. 초대 코드 칸에 `12345` → 「코드는 숫자 6자리예요」(기존 동작 유지)

주의: 3번은 **서버에 스키마가 이미 적용됐다면** 실제 prod RPC를 부른다. dev origin의 기기 id로 PIN
정답을 넣으면 실제로 기기가 등록된다 — 오답·빈 값으로만 확인하고, 정답 확인은 Task 6에서 한다.

- [ ] **Step 7: 커밋**

```bash
npm run format
git add src/screens/home-parent.ts
git commit -m "feat(ui): 부모 홈 미등록 블록에 PIN으로 연결 — 입력칸 분리, 두 버튼 함께 잠금

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: 관리 화면 — 「마지막 접속」

**Files:**

- Modify: `src/screens/manage.ts:712-714`(주석), `:735-737`(라벨), `:783-786`(안내 문구)

- [ ] **Step 1: 주석**

```ts
// claim_invite에 정한 값이다(XSS 경계). last_seen_at은 days 쓰기에서만 갱신되므로
// 「마지막 접속」이 아니라 「마지막 기록 올림」이다.
```

를:

```ts
// claim_invite·claim_with_pin에 정한 값이다(XSS 경계). last_seen_at은 my_device 하트비트가
// pull마다 찍으므로(PIN 기기 연결 설계 §2.3) 「마지막 접속」이다. 고아 행(잃어버린 기기)은
// 이 값이 오래된 부모 기기로 드러난다.
```

- [ ] **Step 2: 라벨**

```ts
seen.textContent = d.lastSeenAt
  ? `마지막 기록 올림: ${formatDate(dayKey(new Date(d.lastSeenAt)))}`
  : '기록 올린 적 없음'
```

를:

```ts
seen.textContent = d.lastSeenAt
  ? `마지막 접속: ${formatDate(dayKey(new Date(d.lastSeenAt)))}`
  : '접속 기록 없음'
```

- [ ] **Step 3: 안내 문구 네 줄을 지운다**

```ts
const note = document.createElement('p')
note.className = 'sync-hint'
note.textContent = '기록을 올리지 않는 기기는 여기 시간이 갱신되지 않아요.'
zone.append(note)
```

전부 삭제. `note`를 다른 곳에서 쓰지 않는지 `grep -n "note" src/screens/manage.ts`로 확인.

- [ ] **Step 4: 검사·커밋**

```bash
npm run build && npm test && npm run format
git add src/screens/manage.ts
git commit -m "feat(ui): 관리 화면 기기 목록 — 마지막 기록 올림 → 마지막 접속

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: 문서

**Files:**

- Modify: `supabase/README.md`(5·6.6·7·8·9절), `docs/PRD.md`(기기 등록·아이 기기 문단),
  `docs/superpowers/specs/2026-09-29-child-device-design.md`(§0),
  `docs/superpowers/specs/2026-08-13-device-cap-manage-design.md`(「마지막 기록 올림」 문단),
  `docs/superpowers/specs/2026-08-06-sync-backend-design.md`(이상 징후 절·위험 목록),
  `docs/superpowers/HANDOFF.md`

- [ ] **Step 1: README 5절** — 「**이후 기기 — SQL이 필요 없다**」 목록(2번 항목) 바로 뒤, `###
두 번째 기기부터` 앞에:

```markdown
**부모 기기를 모두 잃었을 때 — 부모 PIN (SQL이 필요 없다)**

**최근 3일 안에 앱을 연 부모 기기(아이 기기가 아닌 활성 기기)가 하나도 없으면** 새 기기의 부모 홈
「부모 PIN」 칸에 PIN(6.5절)을 넣고 **PIN으로 연결**을 누르면 된다. 부모 기기가 최근에 열렸다면
PIN은 비교되지도 않고 「부모 기기가 있어요」로 거절된다 — 그 기기에서 초대 코드를 받는다. 5회
연속 틀리면 PIN 연결이 잠긴다(해제는 8절). PIN을 설정하지 않았으면 이 길은 없다. 설계:
`docs/superpowers/specs/2026-10-01-pin-device-claim-design.md`.
```

- [ ] **Step 2: README 6.6** — `- 다시 등록한 기기는 새 행이라 표시가 풀려 있다 — 다시 켠다` 줄
      뒤에:

```markdown
- **예외 — 부모 기기가 모두 3일 넘게 쉬면** 아이가 사이트 데이터를 지운 폰(표식 없는 새 기기)으로
  부모 PIN 연결을 할 수 있다(5절 「부모 기기를 모두 잃었을 때」). 매일 쓰는 부모 기기가 있으면 이
  창은 열리지 않는다
```

- [ ] **Step 3: README 7절** — 「「연결 해제」는 서버 관계만 끊는다.」 문단 뒤에:

```markdown
**가족 밖으로 나가는 기기(판 폰 등)를 해제할 때는 PIN도 바꾼다**(6.5절). 등록됐던 기기는 PIN을
캐시하고 있어, 부모 기기가 모두 3일 넘게 쉬는 동안에는 그 PIN으로 다시 들어올 수 있다.
```

- [ ] **Step 4: README 8절** — `## 8. 복구 — 모든 기기를 잃었을 때` 바로 아래 첫 목록 앞에:

````markdown
- **부모 기기를 모두 잃었지만 PIN을 안다 — 앱 안에서 끝난다.** 잃어버린 부모 기기의 서버 행은
  활성으로 남아 있어(서버는 사라짐과 쉼을 구별하지 못한다) **그 기기가 마지막으로 앱을 연 지
  3일이 지나야** PIN 연결이 열린다. 기다릴 수 없으면 잃어버린 기기의 행을 지운다 — 관리 화면
  목록(다른 부모 기기가 있다면)이나 Table Editor `devices`에서 `label`·`last_seen_at`으로 찾는다:

  ```sql
  delete from devices where id = '<기기id>';
  ```

  고아 행은 5대 상한도 차지한다 — 활성 행이 5개면 PIN이 맞아도 상한으로 거절되므로 같은 SQL로
  하나를 지운다.

- **PIN 연결 잠금 해제**(「PIN 연결이 잠겼어요」 — 5회 연속 오답):

  ```sql
  update pin_guard set fail_count = 0 where id = 1;
  ```

  **`delete`로 풀지 않는다** — 행이 없으면 PIN 연결이 영구히 잠긴다(`schema.sql` 재적용이 행을
  되살린다). 누가 틀렸는지는 `select * from write_log where action = 'pin-fail' order by at desc;`
````

- [ ] **Step 5: README 9절 증상표** — 표 끝에 두 행 추가, 기존 두 행 해결란 보강:

새 행:

```markdown
| 「PIN으로 연결」이 「부모 기기가 있어요」를 돌려준다 | 최근 3일 안에 앱을 연 부모 기기가 있다 — 또는 잃어버린 기기의 행이 아직 3일이 안 됐다 | 그 기기에서 초대 코드를 받는다. 모르는 기기거나 잃어버린 기기면 8절대로 행을 지우거나 3일을 기다린다 |
| 「PIN 연결이 잠겼어요」 | PIN을 5회 연속 틀렸다(누군가 대입을 시도했을 수도 있다) | 8절 잠금 해제 SQL. `write_log`의 `pin-fail`로 시도 기록을 본다. 의심스러우면 PIN을 바꾼다 |
```

「이 기기는 아직 연결되지 않았어요」 행 해결란 끝에 ` 부모 기기를 모두 잃었다면 부모 PIN으로 연결한다(5절)`,
「기기 키가 거부됐어요」 행 해결란 끝에 ` 부모 기기가 모두 없으면 새 코드 대신 부모 PIN으로 연결한다(5절)`.

- [ ] **Step 6: PRD** — `**기기 등록**:` 문단을:

```markdown
**기기 등록**: 초대 기반, **상한 5대**(사용자 결정 — 성능 예산 아님). 상한 권위는 서버.
관리 화면(`#/manage`)에서 목록(마지막 접속 시각)·해제, 해제된 기기는 「다시 연결하기」로 복귀.
**최근 3일 안에 앱을 연 부모 기기가 하나도 없을 때만** 초대 코드 대신 부모 PIN으로도 등록할 수
있다(5회 연속 오답이면 잠김, SQL로 해제). 근거: `specs/2026-08-13-device-cap-manage-design.md`,
`specs/2026-10-01-pin-device-claim-design.md`.
```

「아이 기기」 문단 끝(`설계: \`specs/2026-09-29-child-device-design.md\`.`) 뒤에 한 문장:
`부모 기기가 모두 3일 넘게 쉬는 동안에는 표식 없는 새 기기로 부모 PIN 연결이 열린다(받아들인 창 — `specs/2026-10-01-pin-device-claim-design.md`
§0.1).`

- [ ] **Step 7: 스펙 역참조(각 한 줄)**
  - `2026-09-29-child-device-design.md` §0 「완전 차단」 항목 끝: `(2026-10-01 단서: 부모 기기가
모두 3일 넘게 쉬면 표식 없는 새 기기로 PIN 연결이 열린다 — `2026-10-01-pin-device-claim-design.md`
§0.1)`
  - `2026-08-13-device-cap-manage-design.md`의 「마지막 기록 올림」 문단 끝: `(2026-10-01부터
my_device 하트비트로 last_seen_at이 접속 시각이 되어 라벨은 「마지막 접속」이다 —
`2026-10-01-pin-device-claim-design.md` §2.3·§3.3)`
  - `2026-08-06-sync-backend-design.md` 「이상 징후 확인」 문단 끝과 위험 목록의 「`write_log`와
    `last_seen_at`이 사후 확인 수단의 전부다」 줄 끝: `(2026-10-01부터 last_seen_at은 접속 시각이다.
쓰기 흔적은 write_log만 — PIN 기기 연결 설계 §2.3)`

- [ ] **Step 8: HANDOFF** — 마지막 `## ` 절 뒤에 새 절:

```markdown
## PIN으로 기기 연결 (2026-10-01)

아이패드 연동이 끊기고 남은 등록 기기가 아이 폰뿐이라 초대를 발급할 곳이 없었다(SQL로 복구).
**최근 3일 안에 본 부모 기기가 없을 때만** 부모 PIN을 초대 코드 대신 받는다. 설계:
`specs/2026-10-01-pin-device-claim-design.md`(적대적 리뷰 4라운드), 계획:
`plans/2026-10-01-pin-device-claim.md`.

- 서버: `claim_with_pin`, `pin_guard`(정책 없음, 5회 영구 잠금), `my_device()` 하트비트 →
  **`last_seen_at`은 이제 「마지막 접속」**이다(관리 화면 라벨도). 쓰기 흔적은 `write_log`만
- **스키마 재적용 필요**(`schema.sql` 전체). 실측 결과: (Task 6에서 채운다)
- 후속(범위 밖): 아이 기기 키의 REST 권한 — `issue_invite`·`remove_device`·`app_config` 갱신에
  child 가드가 없다(기존 틈, 스펙 §0.1·§6)
```

- [ ] **Step 9: 포맷·커밋**

```bash
npm run format && npx prettier --check .
git add supabase/README.md docs/PRD.md docs/superpowers/HANDOFF.md \
  docs/superpowers/specs/2026-09-29-child-device-design.md \
  docs/superpowers/specs/2026-08-13-device-cap-manage-design.md \
  docs/superpowers/specs/2026-08-06-sync-backend-design.md
git commit -m "docs: PIN 기기 연결 — README·PRD·역참조·HANDOFF

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: 스키마 적용·실측·배포 (사람 + 에이전트)

SQL Editor는 사람만 연다. `curl`(anon 키)은 에이전트가 돌릴 수 있다. **순서를 바꾸지 않는다** —
스키마 → 부모 기기에서 앱 한 번 열기 → 실측 → 머지.

- [ ] **Step 1: 브랜치 push(배포 아님) — 백업**

```bash
git push -u origin pin-device-claim
```

- [ ] **Step 2: (사람) SQL Editor에서 `supabase/schema.sql` 전체를 실행한다** — 이 브랜치의 파일.
      오류 없이 끝나야 한다. 이 순간 하트비트가 시작된다
- [ ] **Step 3: (사람) 부모 기기가 있다면 그 기기에서 앱을 한 번 연다**(스펙 §2.3 적용 직후의 창).
      SQL로 `select id, label, child, revoked_at, last_seen_at from devices;` — 그 기기의
      `last_seen_at`이 방금 시각이면 하트비트가 산다. 안 바뀌었으면 `notify pgrst, 'reload schema';`
      뒤 다시 연다
- [ ] **Step 4: 실측 — 스펙 §5 13항목을 순서대로.** 에이전트용 `curl` 틀(값은
      `src/data/sync-config.ts`):

```bash
URL=https://ozqdaxjtyqaizcfrewed.supabase.co
KEY=sb_publishable_hYp3JpvfdDulSbtWO3qN4Q_pDzeVMmb
pin() { curl -s -X POST "$URL/rest/v1/rpc/claim_with_pin" \
  -H "apikey: $KEY" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d "{\"p_pin\":$1,\"p_device_id\":\"$2\",\"p_label\":\"test\"}"; echo; }
pin '"0000"' test-pin-1        # 오답 예
pin null test-pin-1            # p_pin = null
# 동시 오답 5개(7번 항목)
for i in 1 2 3 4 5; do pin '"0000"' test-pin-par & done; wait
# GET(11번 항목)
curl -s "$URL/rest/v1/rpc/claim_with_pin?p_pin=0000&p_device_id=x&p_label=x" -H "apikey: $KEY" -H "Authorization: Bearer $KEY"; echo
# pin_guard 직접 접근(12번 항목)
curl -s "$URL/rest/v1/pin_guard" -H "apikey: $KEY" -H "Authorization: Bearer $KEY"; echo
curl -s -X PATCH "$URL/rest/v1/pin_guard?id=eq.1" -H "apikey: $KEY" -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" -d '{"fail_count":0}'; echo
```

무대 SQL·해제 SQL·`app_config.pin` 조작·테스트 행 삭제는 사람이 SQL Editor에서 한다(스펙 §5의 무대
만들기 절 — **아이가 아이패드를 쓰지 않는 시간에**, 항목마다
`select max(last_seen_at) from devices where not child and revoked_at is null;`로 무대 확인). 정답
PIN은 에이전트에게 알리지 않아도 된다 — 6번 항목(정답 → `{key}`)은 사람이 `curl`이나 dev 서버 PIN
칸으로 돌리고, **곧바로 테스트 행을 지운다**.

**지금 실제로 부모 기기가 하나도 없는 상태라면**(아이패드가 아직 끊겨 있다면) 무대 SQL 없이 이미 비상
모드다. 그때는 실측 뒤 아이패드 자체를 PIN으로 복구하는 것으로 6번 항목을 대신할 수 있다(Task 6
Step 7 뒤).

결과(항목별 기대값 일치 여부)를 HANDOFF의 「실측 결과」 자리에 적는다.

- [ ] **Step 5: 마무리 확인(SQL)** — `select fail_count from pin_guard;` = 0, 테스트 행 없음
      (`select id from devices where label = 'test';` 0행), `app_config.pin`이 원래 값
- [ ] **Step 6: HANDOFF 실측 결과 커밋 → PR → squash 머지**

```bash
npm run format && npx prettier --check . && npm test && npm run build
git add docs/superpowers/HANDOFF.md
git commit -m "docs: PIN 기기 연결 실측 결과

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push
gh pr create --title "feat: 부모 기기를 모두 잃었을 때 PIN으로 기기 연결" --body "$(cat <<'EOF'
최근 3일 안에 본 부모 기기가 없을 때만 부모 PIN을 초대 코드 대신 받는다.

- 서버: claim_with_pin(비상 모드 → 전역 실패 카운터 → PIN → 등록), pin_guard, my_device 하트비트
- 앱: sync.ts claim 공통화 + claimWithPin, 부모 홈 PIN 입력칸, 관리 화면 「마지막 접속」
- 문서: README 5·6.6·7·8·9절, PRD, 역참조, HANDOFF(실측 결과 포함)

스키마는 이미 적용·실측 완료. 설계: docs/superpowers/specs/2026-10-01-pin-device-claim-design.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
gh pr checks --watch
gh pr merge --squash
gh run watch
```

- [ ] **Step 7: (사람) 아이패드 복구** — 아직 끊겨 있다면 아이패드 부모 홈에서 「다시 연결하기」
      (보이면) → 「부모 PIN」 칸 → **PIN으로 연결**. 「부모 기기가 있어요」가 나오면 8절(고아 행 삭제
      또는 3일 대기)
