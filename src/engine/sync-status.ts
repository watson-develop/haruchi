/** 부모 홈 동기화 상태줄(설계 §7 "평소에는 조용히"). 날짜 계산은 UTC 날짜 문자열 비교다. */
export function syncStatus(input: {
  registered: boolean
  outboxCount: number
  lastSyncAt: string | null
  today: string
}): { tone: 'quiet' | 'warn' | 'setup'; lines: string[] } {
  if (!input.registered) return { tone: 'setup', lines: ['이 기기는 아직 연결되지 않았어요'] }

  const lines: string[] = []
  let tone: 'quiet' | 'warn' = 'quiet'

  if (input.outboxCount > 0) {
    tone = 'warn'
    lines.push(`아직 안 올라간 기록 ${input.outboxCount}건`)
  }

  if (input.lastSyncAt === null) {
    if (tone === 'quiet') lines.push('아직 동기화한 적이 없어요')
  } else {
    const last = input.lastSyncAt.slice(0, 10)
    const days = Math.round((Date.parse(input.today) - Date.parse(last)) / (24 * 60 * 60 * 1000))
    if (days >= 3) {
      tone = 'warn'
      lines.push(`서버에 ${days}일째 못 올렸어요`)
    } else if (tone === 'quiet') {
      lines.push(`마지막 동기화: ${days <= 0 ? '오늘' : `${days}일 전`}`)
    }
  }

  return { tone, lines }
}
