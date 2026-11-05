import type { Srs } from './types'

export type Grade = 0 | 1 | 2 | 3 // again, hard, good, easy
const DAY = 86_400_000

export const newSrs = (): Srs => ({ ease: 2.5, interval: 0, reps: 0, lapses: 0, dueAt: Date.now() })

/** SM-2 flavoured scheduler with 4 buttons. */
export function schedule(card: Srs, grade: Grade, now = Date.now()): Srs {
  let { ease, interval, reps, lapses } = card
  if (grade === 0) {
    lapses += 1; reps = 0; interval = 0; ease = Math.max(1.3, ease - 0.2)
    return { ease, interval, reps, lapses, dueAt: now + 10 * 60_000, lastReviewedAt: now }
  }
  if (reps === 0) interval = grade === 1 ? 1 : grade === 2 ? 1 : 3
  else if (reps === 1) interval = grade === 1 ? 2 : grade === 2 ? 4 : 6
  else {
    const f = grade === 1 ? 1.2 : grade === 2 ? ease : ease * 1.3
    interval = Math.max(interval + 1, Math.round(interval * f))
  }
  if (grade === 1) ease = Math.max(1.3, ease - 0.15)
  if (grade === 3) ease += 0.15
  reps += 1
  return { ease, interval, reps, lapses, dueAt: now + interval * DAY, lastReviewedAt: now }
}

/** Preview label for the next interval of each button. */
export function previewInterval(card: Srs, grade: Grade): string {
  const n = schedule(card, grade)
  if (grade === 0) return '10 分鐘'
  return n.interval === 1 ? '1 天' : `${n.interval} 天`
}
