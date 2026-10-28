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

  const createdDay = localDayOrdinal(course.createdAt)
  const currentDay = localDayOrdinal(now)
  return Math.min(
    course.episodes.length,
    Math.max(0, currentDay - createdDay + 1)
  )
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
    ...(episodeNumber > unlockedCount
      ? { unlockAt: localMidnightAfter(course.createdAt, index) }
      : {})
  }
}

export function getNextCourseUnlockAt(
  course: DailyUnlockCourse,
  now: number
): number | undefined {
  const unlockedCount = getUnlockedEpisodeCount(course, now)
  if (unlockedCount >= course.episodes.length) {
    return undefined
  }
  return localMidnightAfter(course.createdAt, unlockedCount)
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
