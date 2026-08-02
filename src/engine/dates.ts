/** 하루의 경계. 이 시각 이전은 전날로 기록한다. */
export const DAY_START_HOUR = 4

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function toKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function parseKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** 주어진 시각이 속한 "하루"의 키를 돌려준다. 새벽 4시 이전은 전날. */
export function dayKey(now: Date): string {
  const d = new Date(now.getTime())
  if (d.getHours() < DAY_START_HOUR) d.setDate(d.getDate() - 1)
  return toKey(d)
}

/** 날짜 키를 n일 이동한다. */
export function shiftDay(key: string, n: number): string {
  const d = parseKey(key)
  d.setDate(d.getDate() + n)
  return toKey(d)
}

/** to - from 을 일 단위로 센다. */
export function diffDays(from: string, to: string): number {
  const a = parseKey(from).getTime()
  const b = parseKey(to).getTime()
  return Math.round((b - a) / 86_400_000)
}
