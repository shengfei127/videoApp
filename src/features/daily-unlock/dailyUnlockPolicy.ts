import type {
  DailyUnlockCourse,
  DailyUnlockEpisode,
  DailyUnlockSettings,
  VideoItem,
  VideoUnlockStatus
} from '@/domain/video'

// Android's App service engine can omit Intl entirely.
const NATURAL_COLLATOR = typeof Intl !== 'undefined' && typeof Intl.Collator === 'function'
  ? new Intl.Collator('zh-CN', { numeric: true })
  : undefined

function compareNaturally(left: string, right: string): number {
  if (NATURAL_COLLATOR) return NATURAL_COLLATOR.compare(left, right)

  const leftParts = left.match(/\d+|\D+/g) ?? []
  const rightParts = right.match(/\d+|\D+/g) ?? []
  for (let index = 0; index < Math.min(leftParts.length, rightParts.length); index += 1) {
    const a = leftParts[index]!
    const b = rightParts[index]!
    if (a === b) continue
    if (/^\d+$/.test(a) && /^\d+$/.test(b)) {
      // Compare digit strings without losing precision on long episode numbers.
      const aDigits = a.replace(/^0+(?=\d)/, '')
      const bDigits = b.replace(/^0+(?=\d)/, '')
      if (aDigits.length !== bDigits.length) return aDigits.length - bDigits.length
      if (aDigits !== bDigits) return aDigits < bDigits ? -1 : 1
    } else {
      const compared = a.localeCompare(b)
      if (compared) return compared
    }
  }
  return leftParts.length - rightParts.length
}

export function getUnlockedEpisodeCount(
  course: DailyUnlockCourse,
  now: number
): number {
  if (
    !Number.isFinite(course.createdAt) ||
    !Number.isFinite(now) ||
    !Array.isArray(course.episodes) ||
    course.episodes.length === 0
  ) {
    return 0
  }

  const effectiveNow = course.pausedAt === undefined ? now : Math.min(now, course.pausedAt)
  const createdDay = localDayOrdinal(course.scheduleAnchorAt ?? course.createdAt)
  const currentDay = localDayOrdinal(effectiveNow)
  const elapsedDays = currentDay - createdDay
  const count = course.scheduleAnchorAt === undefined
    ? (course.startEpisodeNumber ?? 1) - 1 + Math.max(0, elapsedDays + 1) * dailyRate(course)
    : (course.scheduleAnchorUnlockedCount ?? 0) + Math.max(0, elapsedDays) * dailyRate(course)
  return Math.min(
    course.episodes.length,
    Math.max(0, count)
  )
}

export function getTodayCourseEpisode(course: DailyUnlockCourse, now: number): DailyUnlockEpisode | undefined {
  return getTodayCourseEpisodes(course, now)[0]
}

export function getTodayCourseEpisodes(course: DailyUnlockCourse, now: number): DailyUnlockEpisode[] {
  if (course.pausedAt !== undefined || !Number.isFinite(now) || now < course.createdAt) return []
  const end = getUnlockedEpisodeCount(course, now)
  const start = course.scheduleAnchorAt !== undefined && localDayOrdinal(now) === localDayOrdinal(course.scheduleAnchorAt)
    ? course.scheduleAnchorTodayStart ?? end
    : getUnlockedEpisodeCount(course, localMidnightAfter(now, 0) - 1)
  return course.episodes.slice(Math.max(start, (course.startEpisodeNumber ?? 1) - 1), end)
}

export function rescheduleDailyUnlockCourse(
  course: DailyUnlockCourse,
  patch: { name?: string; dailyEpisodeCount?: number; paused?: boolean },
  now: number
): DailyUnlockCourse {
  const next = { ...course, ...(patch.name !== undefined ? { name: patch.name.trim() } : {}) }
  const rateChanged = patch.dailyEpisodeCount !== undefined && patch.dailyEpisodeCount !== dailyRate(course)
  const pauseChanged = patch.paused !== undefined && patch.paused !== (course.pausedAt !== undefined)
  if (!rateChanged && !pauseChanged) return next
  const unlocked = getUnlockedEpisodeCount(course, now)
  const today = getTodayCourseEpisodes(course, now)
  next.scheduleAnchorAt = now
  next.scheduleAnchorUnlockedCount = unlocked
  next.scheduleAnchorTodayStart = unlocked - today.length
  next.dailyEpisodeCount = patch.dailyEpisodeCount ?? dailyRate(course)
  if (patch.paused === true || (patch.paused === undefined && course.pausedAt !== undefined)) next.pausedAt = now
  else delete next.pausedAt
  return next
}

function dailyRate(course: DailyUnlockCourse): number {
  return course.dailyEpisodeCount ?? 1
}

function episodeUnlockAt(course: DailyUnlockCourse, index: number): number {
  if (course.scheduleAnchorAt !== undefined) {
    const remainingIndex = index - (course.scheduleAnchorUnlockedCount ?? 0)
    return localMidnightAfter(course.scheduleAnchorAt, Math.floor(remainingIndex / dailyRate(course)) + 1)
  }
  return localMidnightAfter(course.createdAt, Math.floor((index - ((course.startEpisodeNumber ?? 1) - 1)) / dailyRate(course)))
}

export function getVideoUnlockStatus(
  settings: DailyUnlockSettings,
  videoId: string,
  now: number
): VideoUnlockStatus {
  const course = settings.courses.find((candidate) =>
    candidate.episodes.some((episode) => episode.videoId === videoId)
  )
  if (!course) {
    return { locked: false }
  }

  const index = course.episodes.findIndex((episode) => episode.videoId === videoId)
  const episodeNumber = index + 1
  const unlockedCount = getUnlockedEpisodeCount(course, now)
  return {
    locked: settings.enabled && episodeNumber > unlockedCount,
    courseId: course.id,
    courseName: course.name,
    episodeNumber,
    unlockedCount,
    ...(episodeNumber > unlockedCount && course.pausedAt === undefined
      ? { unlockAt: episodeUnlockAt(course, index) }
      : {})
  }
}

export function getNextCourseUnlockAt(
  course: DailyUnlockCourse,
  now: number
): number | undefined {
  const unlockedCount = getUnlockedEpisodeCount(course, now)
  if (unlockedCount >= course.episodes.length || course.pausedAt !== undefined) {
    return undefined
  }
  return episodeUnlockAt(course, unlockedCount)
}

export function sortCourseEpisodes<T extends Pick<VideoItem, 'id' | 'name' | 'path'>>(
  videos: readonly T[]
): T[] {
  return [...videos].sort(
    (left, right) =>
      compareNaturally(left.name, right.name) ||
      compareNaturally(left.path, right.path) ||
      compareNaturally(left.id, right.id)
  )
}

export function findCourseConflict(
  courses: readonly DailyUnlockCourse[],
  videoIds: readonly string[]
): DailyUnlockCourse | undefined {
  const requested = new Set(videoIds)
  return courses.find((course) =>
    course.episodes.some((episode) => requested.has(episode.videoId))
  )
}

function localDayOrdinal(timestamp: number): number {
  const date = new Date(timestamp)
  return Math.floor(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000
  )
}

function localMidnightAfter(timestamp: number, days: number): number {
  const date = new Date(timestamp)
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + days,
    0,
    0,
    0,
    0
  ).getTime()
}

export function snapshotCourseEpisodes(videos: readonly VideoItem[]): DailyUnlockEpisode[] {
  return sortCourseEpisodes(videos).map((video) => ({
    videoId: video.id,
    name: video.name.trim() || '未命名视频',
    sourceType: video.sourceType,
    ...(video.sourceType === 'baidu' ? { path: video.path } : {})
  }))
}
