# Supabase 설정 절차 (사람이 한다)

1. https://supabase.com 에서 프로젝트 생성 — 리전 Seoul(ap-northeast-2), 무료 티어
2. SQL Editor에 `schema.sql` 전체를 붙여 넣고 실행
3. 기기 키 발급 (기기마다 반복):
   - 비밀번호 관리자에서 32자 이상 랜덤 문자열 생성 → 관리자에 보관
   - 앱 부모 홈의 미등록 안내에 뜨는 기기 id를 확인
   - SQL Editor에서:
     `insert into devices (id, label, key_hash) values ('<기기id>', '아이패드', crypt('<랜덤키>', gen_salt('bf')));`
   - 앱의 키 입력란에 랜덤 키를 붙여 넣고 저장
4. `src/data/sync-config.ts`에 프로젝트 URL과 anon 키를 채워 커밋
   (Settings → API. **service_role은 절대 아니다** — 복사할 키 이름을 확인할 것)
5. `.github/workflows/ping-supabase.yml`의 URL·anon 키 플레이스홀더를 채워 커밋
6. 확인: 앱에서 문제지 인쇄 → Table Editor의 days에 오늘 행이 생기는지
7. 폐기가 필요하면: `update devices set revoked_at = now() where id = '<기기id>';`
