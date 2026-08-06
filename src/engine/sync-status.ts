import { dayKey, diffDays } from './dates'

/**
 * 부모 홈 동기화 상태줄(설계 §7 "평소에는 조용히").
 *
 * 날짜 비교는 **양쪽 다 로컬 날짜 키**로 한다. `today`는 호출부가 `dayKey(new Date())`로
 * 만든 값인데, 예전에는 `lastSyncAt`(ISO 순간)의 앞 10글자를 잘라 UTC 날짜와 비교했다 —
 * KST 오전 9시 이전에 동기화하면 UTC로는 아직 전날이라 하루 낡게 세어져, 3일 경고가
 * 이틀 만에 뜨고 "오늘"이 "1일 전"으로 보였다. dates.ts의 dayKey·diffDays를 그대로 써서
 * 이 화면이 쓰는 하루의 정의(새벽 4시 경계)까지 앱의 나머지와 일치시킨다.
 */
export function syncStatus(input: {
  registered: boolean
  /** 서버가 이 기기의 키를 거부했다(sync.ts serverStatus의 'unauthorized'). */
  authFailed: boolean
  outboxCount: number
  lastSyncAt: string | null
  today: string
}): { tone: 'quiet' | 'warn' | 'setup'; lines: string[] } {
  if (!input.registered) return { tone: 'setup', lines: ['이 기기는 아직 연결되지 않았어요'] }

  const lines: string[] = []
  let tone: 'quiet' | 'warn' = 'quiet'

  // 인증 실패를 가장 먼저 말한다(설계 §3: "조용히 넘기면 아빠는 동기화되는 줄 알고 몇
  // 주를 보낸다"). 폐기된 키는 RLS 특성상 401이 아니라 "행이 하나도 안 보이는 200"으로
  // 나타나서, 이 줄이 없으면 그 상태가 "안 올라간 기록 N건"으로만 보인다 — 원인은
  // 안 보이고 증상만 쌓인다.
  if (input.authFailed) {
    tone = 'warn'
    lines.push('기기 키가 거부됐어요 — 새 키를 발급해 주세요')
  }

  if (input.outboxCount > 0) {
    tone = 'warn'
    lines.push(`아직 안 올라간 기록 ${input.outboxCount}건`)
  }

  if (input.lastSyncAt === null) {
    if (tone === 'quiet') lines.push('아직 동기화한 적이 없어요')
  } else {
    const at = new Date(input.lastSyncAt)
    // 형식이 깨진 값(옛 기기·손댄 저장소)은 "센 적 없음"으로 다룬다 — NaN일 전이라고
    // 쓰느니 아무 말도 하지 않는 편이 낫다.
    if (!Number.isNaN(at.getTime())) {
      const days = diffDays(dayKey(at), input.today)
      if (days >= 3) {
        tone = 'warn'
        lines.push(`서버에 ${days}일째 못 올렸어요`)
      } else if (tone === 'quiet') {
        lines.push(`마지막 동기화: ${days <= 0 ? '오늘' : `${days}일 전`}`)
      }
    } else if (tone === 'quiet') {
      lines.push('아직 동기화한 적이 없어요')
    }
  }

  return { tone, lines }
}
