# 하루치

초등 2학년 산수 연습 도구. 매일 A4 문제지를 인쇄해 손으로 풀고, 아이패드에서 채점한다.

- 설계: `docs/superpowers/specs/` (전체 설계 + Phase별 설계)
- 인수인계: `docs/superpowers/HANDOFF.md`
- 조사 자료: `docs/reference/` (교육과정·학습지 커리큘럼·통합 사다리·EBS 강좌 매핑)

## 개발

```bash
mise install
npm ci
npm run dev      # http://localhost:5173/haruchi/
npm test
npm run build
```

## 배포

`main`에 push하면 GitHub Actions가 테스트 → 빌드 → GitHub Pages 배포를 수행한다.

**배포 URL은 변경하지 않는다.** 데이터가 origin별 IndexedDB에 저장되므로 주소가 바뀌면
기존 기록에 접근할 수 없다.

JSON 내보내기·가져오기는 주간 리포트 화면(`#/report`)에 있다(Phase 3). 이론상
백업 파일로 기록을 옮길 수는 있지만, 가져오기는 병합이 아니라 **전체 교체**이고
실기기 검증도 아직 절반뿐이다 — 주소를 바꾸지 않는 것이 여전히 첫 번째 보호책이다.

## 동기화 (선택)

Supabase에 기록을 이중화하고 여러 기기가 같은 기록을 본다. `src/data/sync-config.ts`가
비어 있으면 **모든 네트워크 진입점이 no-op**이라 앱은 서버 없이 그대로 돈다. 설정 절차는
`supabase/README.md`.

## 채점 화면 잠금 (선택)

채점 화면(`#/grade`)은 그날 모든 문항의 정답을 보여준다. 평소 이 화면을 지키는 것은
**아이 화면에서 부모 화면으로 가는 링크를 만들지 않는다**는 규칙 하나이고, 주소를 알고
치면 열린다. PIN을 켜면 `#/grade`와 `#/report`(기록 지우기·가져오기가 있는 화면) 둘이
잠긴다.

**앱에는 PIN 설정 화면이 없다.** 동기화를 쓰는 경우에만 쓸 수 있고, Supabase SQL Editor에서
켜고 끄고 바꾼다:

```sql
-- 설정·변경 (4자리 숫자)
insert into app_config (id, pin, device) values (1, '1234', 'sql')
on conflict (id) do update set pin = excluded.pin, device = 'sql';

-- 잠금 해제
update app_config set pin = '' where id = 1;
```

각 기기는 다음 동기화에서 PIN을 받아 캐시하므로 **오프라인에서도 잠긴다.** 한 번 통과하면
앱을 배경으로 보내기 전까지 다시 묻지 않는다. 초기화·가져오기·되돌리기는 PIN을 건드리지
않는다. 자세한 내용은 `supabase/README.md` §6.5.

**위협 모델은 아이의 우연한 접근이다** — 무차별 대입 방어도, 잠금도, 해시 저장도 없다.
