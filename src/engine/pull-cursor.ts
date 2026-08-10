/**
 * pull 커서 — 서버 시계로만 전진한다(설계 2단계 §2 「커서」).
 *
 * 이 파일은 순수하다: 네트워크도 저장소도 모른다.
 */

/** 커서 계산에 필요한 것만 본 서버 행. `rejected`는 "검증에 걸려 적용하지 못했다"는 뜻이다. */
export type PulledRow = { updatedAt: string; rejected: boolean }

/**
 * 다음 `lastPulledAt`. 규칙 둘(설계 §2):
 *
 * - **값은 서버 응답의 `updated_at`에서만 온다.** 로컬 시계로 "지금"을 찍으면 시계가 앞선
 *   기기가 그 차이만큼의 행을 영영 못 본다 — 다음 질의가 `updated_at > 미래`가 되기 때문이다.
 * - **거부한 행이 있으면 그 직전에서 멈춘다.** 지나치면 그 행은 서버에서 다시 바뀌기 전까지
 *   영영 재수신되지 않는다(5라운드). 서버 쪽이 고쳐지는 즉시 다음 pull이 다시 받는다.
 *
 * 행이 `updated_at` 오름차순이라는 것이 전제다 — 그래서 "거부 직전까지의 마지막 값"이 곧
 * 적용에 성공한 부분의 최대값이다. 호출부는 적용을 **실제로 시도한 행만** 넘긴다(중간에
 * 멈췄으면 그 뒤 행은 목록에 없어야 커서가 그것들을 건너뛰지 않는다).
 *
 * 겹쳐 받기(`PULL_OVERLAP_MS`) 때문에 결과가 `prev`보다 과거일 수 있다 — 재수신은 병합이
 * 멱등이라 무해하므로 굳이 `max(prev, …)`로 잠그지 않는다.
 */
export function nextCursor(prev: string | null, rows: PulledRow[]): string | null {
  let cursor = prev
  for (const row of rows) {
    if (row.rejected) return cursor
    cursor = row.updatedAt
  }
  return cursor
}
