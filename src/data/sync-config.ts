/**
 * Supabase 접속 정보. 사람이 채워 커밋한다(supabase/README.md 4단계) — 둘 다 공개 전제라
 * 커밋해도 된다(RLS가 막는다). 기기 키는 절대 여기 두지 않는다 — device 스토어에만 산다.
 * 비어 있으면 동기화 전체가 조용히 꺼진다(배포 안전: 서버 준비 전에 머지돼도 무해).
 *
 * `: string` 표기를 지우지 말 것. 없으면 TypeScript가 값을 리터럴 타입으로 좁혀
 * `configured()`의 `!== ''` 비교가 "겹칠 수 없는 비교"(TS2367)가 되고 빌드가 실패한다 —
 * 값이 비어 있을 때만 통과하다가 사람이 값을 채우는 순간 배포가 막힌다.
 */

/** `/rest/v1` 없는 베이스 주소다 — 호출부가 경로를 붙인다(sync.ts). 끝에 `/`를 두지 않는다. */
export const SUPABASE_URL: string = 'https://ozqdaxjtyqaizcfrewed.supabase.co'
/** 이름은 옛 `anon`을 따르지만 값은 지금 대시보드의 publishable 키다(supabase/README.md 3단계). */
export const SUPABASE_ANON_KEY: string = 'sb_publishable_hYp3JpvfdDulSbtWO3qN4Q_pDzeVMmb'
