import type { DailyUnlockEpisode } from '@/domain/video'
import type { KeyValueStorage } from '@/infrastructure/storage'

export const COURSE_DRAFT_KEY = 'pianke:course-draft:v1'
export interface CourseDraft {
  name: string
  selectionMode: 'folder' | 'videos'
  sourceFolderPath: string
  episodes: DailyUnlockEpisode[]
  dailyEpisodeCount: number | string
  startEpisodeNumber: number | string
}

export function readCourseDraft(storage: KeyValueStorage): CourseDraft | undefined {
  return sanitizeDraft(storage.read<unknown>(COURSE_DRAFT_KEY, null))
}

export function saveCourseDraft(storage: KeyValueStorage, draft: CourseDraft): void {
  const sanitized = sanitizeDraft(draft)
  if (!sanitized) throw new Error('课程草稿信息无效')
  storage.write(COURSE_DRAFT_KEY, sanitized)
}

export function clearCourseDraft(storage: KeyValueStorage): void {
  storage.remove(COURSE_DRAFT_KEY)
}

/** Read the latest form only when saving; failed writes remain eligible for retry. */
export function createDraftSaveQueue(save: () => boolean, delay = 350) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let pending = false
  function clearTimer(): void {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
  }
  function flush(): void {
    clearTimer()
    if (pending && save()) pending = false
  }
  return {
    schedule(): void { pending = true; clearTimer(); timer = setTimeout(flush, delay) },
    flush,
    cancel(): void { clearTimer(); pending = false }
  }
}

function sanitizeDraft(value: unknown): CourseDraft | undefined {
  if (!isRecord(value) || !isText(value.name, 80) ||
    (value.selectionMode !== 'folder' && value.selectionMode !== 'videos') ||
    (value.sourceFolderPath !== '' && !isSafePath(value.sourceFolderPath)) ||
    !isNumericInput(value.dailyEpisodeCount) || !isNumericInput(value.startEpisodeNumber) ||
    !Array.isArray(value.episodes) || value.episodes.length > 500) return undefined

  const episodes: DailyUnlockEpisode[] = []
  const seen = new Set<string>()
  for (const episode of value.episodes) {
    if (!isRecord(episode) || !isText(episode.videoId, 512) || !episode.videoId.trim() ||
      !isText(episode.name, 160) || !episode.name.trim() || seen.has(episode.videoId) ||
      (episode.sourceType !== 'baidu' && episode.sourceType !== 'direct') ||
      (episode.sourceType === 'baidu' && !isSafePath(episode.path))) return undefined
    seen.add(episode.videoId)
    episodes.push({
      videoId: episode.videoId, name: episode.name, sourceType: episode.sourceType,
      ...(episode.sourceType === 'baidu' ? { path: episode.path as string } : {})
    })
  }
  return {
    name: value.name, selectionMode: value.selectionMode,
    sourceFolderPath: value.sourceFolderPath as string,
    dailyEpisodeCount: value.dailyEpisodeCount, startEpisodeNumber: value.startEpisodeNumber,
    episodes
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function isText(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length <= max && !/[\u0000-\u001f\u007f]/u.test(value)
}

function isNumericInput(value: unknown): value is number | string {
  return typeof value === 'number' ? Number.isFinite(value) : isText(value, 32)
}

function isSafePath(value: unknown): value is string {
  return isText(value, 2048) && value.startsWith('/') &&
    !/[\\?#]/u.test(value) && !value.includes('://') &&
    value.split('/').slice(1).every((segment) => Boolean(segment) && segment !== '.' && segment !== '..')
}
