import type { DailyUnlockCourse } from '@/domain/video'

export function formatCourseDate(timestamp: number): string {
  const date = new Date(timestamp)
  if (!Number.isFinite(date.getTime())) return ''
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function parseCourseDate(value: string): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return undefined
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(0)
  date.setFullYear(year, month - 1, day)
  date.setHours(0, 0, 0, 0)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return undefined
  return date.getTime()
}

export function getCourseStartAt(course: DailyUnlockCourse): number {
  return course.startAt ?? course.createdAt
}

/** Paused time freezes whether the first scheduled day has been reached. */
export function hasCourseStarted(course: DailyUnlockCourse, now: number): boolean {
  if (course.scheduleAnchorAt !== undefined) return true
  // Active courses always get an anchor when paused. Without one, an explicit
  // start date belongs to a pre-start pause, even if that date is edited later.
  if (course.startAt !== undefined && course.pausedAt !== undefined) return false
  const effectiveNow = course.pausedAt === undefined ? now : Math.min(now, course.pausedAt)
  const startDate = formatCourseDate(getCourseStartAt(course))
  const currentDate = formatCourseDate(effectiveNow)
  return Boolean(startDate && currentDate && currentDate >= startDate)
}
