import type { DailyUnlockCourse, DailyUnlockEpisode, DailyUnlockSettings } from '@/domain/video'
import type { KeyValueStorage } from '@/infrastructure/storage'

export const DAILY_UNLOCK_STORAGE_KEY = 'pianke:daily-unlock:v1'
const MAX_COURSES = 100
const MAX_EPISODES_PER_COURSE = 500
const MAX_NAME_LENGTH = 160
const MAX_ID_LENGTH = 512
const MAX_PATH_LENGTH = 2_048
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u
const DEFAULT_SETTINGS: DailyUnlockSettings = { enabled: false, courses: [] }

export class DailyUnlockRepository {
  constructor(private readonly storage: KeyValueStorage) {}

  load(): DailyUnlockSettings {
    const stored = this.storage.read<unknown>(DAILY_UNLOCK_STORAGE_KEY, null)
    return sanitizeSettings(stored)
  }

  save(settings: DailyUnlockSettings): void {
    if (!isRecord(settings) || typeof settings.enabled !== 'boolean') {
      throw new Error('每日解锁设置无效')
    }
    const sanitized = sanitizeSettings(settings)
    if (sanitized.courses.length !== settings.courses.length) {
      throw new Error('每日课程信息无效')
    }
    this.storage.write(DAILY_UNLOCK_STORAGE_KEY, sanitized)
  }
}

function sanitizeSettings(value: unknown): DailyUnlockSettings {
  if (!isRecord(value)) return { ...DEFAULT_SETTINGS, courses: [] }
  const enabled = value.enabled === true
  if (!Array.isArray(value.courses)) return { enabled: false, courses: [] }

  const courses: DailyUnlockCourse[] = []
  const seenCourseIds = new Set<string>()
  const seenVideoIds = new Set<string>()
  for (const item of value.courses.slice(0, MAX_COURSES)) {
    const course = sanitizeCourse(item)
    if (!course || seenCourseIds.has(course.id)) continue
    if (course.episodes.some((episode) => seenVideoIds.has(episode.videoId))) continue
    seenCourseIds.add(course.id)
    for (const episode of course.episodes) seenVideoIds.add(episode.videoId)
    courses.push(course)
  }
  return { enabled, courses }
}

function sanitizeCourse(value: unknown): DailyUnlockCourse | null {
  if (
    !isRecord(value) ||
    !isValidId(value.id) ||
    !isValidName(value.name) ||
    !Number.isSafeInteger(value.createdAt) ||
    (value.createdAt as number) < 0 ||
    !Number.isFinite(new Date(value.createdAt as number).getTime()) ||
    !Array.isArray(value.episodes) ||
    value.episodes.length === 0 ||
    value.episodes.length > MAX_EPISODES_PER_COURSE
  ) {
    return null
  }

  let sourceFolderPath: string | undefined
  if (value.sourceFolderPath !== undefined) {
    if (!isSafeBaiduPath(value.sourceFolderPath)) return null
    sourceFolderPath = value.sourceFolderPath
  }

  const episodes: DailyUnlockEpisode[] = []
  const episodeIds = new Set<string>()
  for (const item of value.episodes) {
    const episode = sanitizeEpisode(item)
    if (!episode || episodeIds.has(episode.videoId)) return null
    episodeIds.add(episode.videoId)
    episodes.push(episode)
  }

  return {
    id: value.id,
    name: value.name.trim(),
    createdAt: value.createdAt as number,
    ...(sourceFolderPath ? { sourceFolderPath } : {}),
    episodes
  }
}

function sanitizeEpisode(value: unknown): DailyUnlockEpisode | null {
  if (
    !isRecord(value) ||
    !isValidId(value.videoId) ||
    !isValidName(value.name) ||
    (value.sourceType !== 'baidu' && value.sourceType !== 'direct')
  ) {
    return null
  }

  if (value.sourceType === 'direct') {
    if (value.path !== undefined) return null
  } else if (!isSafeBaiduPath(value.path)) {
    return null
  }

  return {
    videoId: value.videoId,
    name: value.name.trim(),
    sourceType: value.sourceType,
    ...(value.sourceType === 'baidu' ? { path: value.path as string } : {})
  }
}

function isSafeBaiduPath(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_PATH_LENGTH ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\') ||
    value.includes('?') ||
    value.includes('#') ||
    value.includes('://') ||
    CONTROL_CHARACTERS.test(value)
  ) {
    return false
  }
  return value.split('/').slice(1).every((segment) => segment && segment !== '.' && segment !== '..')
}

function isValidId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_ID_LENGTH && !CONTROL_CHARACTERS.test(value)
}

function isValidName(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value.trim()) && value.trim().length <= MAX_NAME_LENGTH && !CONTROL_CHARACTERS.test(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
