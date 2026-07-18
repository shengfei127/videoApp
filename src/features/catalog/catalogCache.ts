import type { VideoItem } from '@/domain/video'
import type { KeyValueStorage } from '@/infrastructure/storage'

export const CATALOG_CACHE_KEY = 'pianke:catalog-cache:v1'
export const CATALOG_CACHE_FRESH_MS = 15 * 60 * 1000
export const CATALOG_REFRESH_COOLDOWN_MS = 60 * 1000

const UINT64_MAX = '18446744073709551615'
const CONTROL_CHARACTER = /[\u0000-\u001F\u007F]/u
const SAFE_APP_ROOT = /^\/apps\/[\p{L}\p{N} _-]{1,20}$/u
const RECORD_KEYS = new Set(['videos', 'savedAt', 'requestStartedAt'])
const VIDEO_KEYS = new Set([
  'id',
  'sourceType',
  'sourceId',
  'name',
  'path',
  'sizeBytes',
  'durationSeconds',
  'thumbnailUrl',
  'modifiedAt'
])

export interface CatalogCacheSnapshot {
  videos: VideoItem[]
  savedAt: number
}

export type CatalogRequestStartResult =
  | { started: true; startedAt: number }
  | { started: false; reason: 'cooldown'; retryAt: number }
  | { started: false; reason: 'invalid-clock' }

export interface CatalogCacheOptions {
  root: string
  now?: () => number
}

interface PersistedCatalogCache {
  videos: VideoItem[]
  savedAt?: number
  requestStartedAt?: number
}

export class CatalogCache {
  private readonly root: string
  private readonly now: () => number

  constructor(
    private readonly storage: KeyValueStorage,
    options: CatalogCacheOptions
  ) {
    if (!options || !isSafeAppRoot(options.root)) {
      throw new Error('Catalog cache root is invalid')
    }

    this.root = options.root
    this.now = options.now ?? Date.now
  }

  load(): CatalogCacheSnapshot | null {
    const record = this.readRecord()

    if (!record || record.savedAt === undefined) {
      return null
    }

    return {
      videos: cloneVideos(record.videos),
      savedAt: record.savedAt
    }
  }

  isFresh(savedAt: number): boolean {
    const now = this.now()
    return (
      isSafeTimestamp(now) &&
      isSafeTimestamp(savedAt) &&
      savedAt <= now &&
      now - savedAt < CATALOG_CACHE_FRESH_MS
    )
  }

  canRefresh(): boolean {
    const now = this.now()
    if (!isSafeTimestamp(now)) {
      return false
    }

    const requestStartedAt = this.readRecord()?.requestStartedAt
    return (
      requestStartedAt === undefined ||
      now - requestStartedAt >= CATALOG_REFRESH_COOLDOWN_MS
    )
  }

  beginRequest(): CatalogRequestStartResult {
    const now = this.now()
    if (!isSafeTimestamp(now)) {
      return { started: false, reason: 'invalid-clock' }
    }

    const record = this.readRecord()
    const requestStartedAt = record?.requestStartedAt
    if (
      requestStartedAt !== undefined &&
      now - requestStartedAt < CATALOG_REFRESH_COOLDOWN_MS
    ) {
      return {
        started: false,
        reason: 'cooldown',
        retryAt: requestStartedAt + CATALOG_REFRESH_COOLDOWN_MS
      }
    }

    this.storage.write(CATALOG_CACHE_KEY, {
      videos: cloneVideos(record?.videos ?? []),
      ...(record?.savedAt !== undefined ? { savedAt: record.savedAt } : {}),
      requestStartedAt: now
    } satisfies PersistedCatalogCache)

    return { started: true, startedAt: now }
  }

  saveSuccessful(videos: readonly VideoItem[]): CatalogCacheSnapshot {
    const now = this.now()
    if (!isSafeTimestamp(now)) {
      throw new Error('Catalog cache clock is invalid')
    }

    const sanitizedVideos = sanitizeVideos(videos, false, this.root)
    if (!sanitizedVideos) {
      throw new Error('Catalog cache videos are invalid')
    }

    const requestStartedAt = this.readRecord()?.requestStartedAt
    const record: PersistedCatalogCache = {
      videos: sanitizedVideos,
      savedAt: now,
      ...(requestStartedAt !== undefined ? { requestStartedAt } : {})
    }

    this.storage.write(CATALOG_CACHE_KEY, record)

    return { videos: cloneVideos(sanitizedVideos), savedAt: now }
  }

  clear(): void {
    this.storage.remove(CATALOG_CACHE_KEY)
  }

  private readRecord(): PersistedCatalogCache | null {
    const now = this.now()
    if (!isSafeTimestamp(now)) {
      return null
    }

    const stored = this.storage.read<unknown>(CATALOG_CACHE_KEY, null)
    const record = validateRecord(stored, now, this.root)

    if (!record) {
      this.storage.remove(CATALOG_CACHE_KEY)
      return null
    }

    return record
  }
}

function validateRecord(
  value: unknown,
  now: number,
  root: string
): PersistedCatalogCache | null {
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => !RECORD_KEYS.has(key)) ||
    !Array.isArray(value.videos)
  ) {
    return null
  }

  const videos = sanitizeVideos(value.videos, true, root)
  if (!videos) {
    return null
  }

  const savedAt = readOptionalTimestamp(value, 'savedAt', now)
  const requestStartedAt = readOptionalTimestamp(
    value,
    'requestStartedAt',
    now
  )

  if (
    savedAt.invalid ||
    requestStartedAt.invalid ||
    (savedAt.value === undefined && videos.length > 0)
  ) {
    return null
  }

  return {
    videos,
    ...(savedAt.value !== undefined ? { savedAt: savedAt.value } : {}),
    ...(requestStartedAt.value !== undefined
      ? { requestStartedAt: requestStartedAt.value }
      : {})
  }
}

function sanitizeVideos(
  values: readonly unknown[],
  rejectUnknownKeys: boolean,
  root: string
): VideoItem[] | null {
  const seen = new Set<string>()
  const videos: VideoItem[] = []

  for (const value of values) {
    const video = sanitizeVideo(value, rejectUnknownKeys, root)
    if (!video || seen.has(video.sourceId)) {
      return null
    }

    seen.add(video.sourceId)
    videos.push(video)
  }

  return videos
}

function sanitizeVideo(
  value: unknown,
  rejectUnknownKeys: boolean,
  root: string
): VideoItem | null {
  if (
    !isRecord(value) ||
    (rejectUnknownKeys &&
      Object.keys(value).some((key) => !VIDEO_KEYS.has(key))) ||
    value.sourceType !== 'baidu' ||
    !isCanonicalFsId(value.sourceId) ||
    value.id !== `baidu:${value.sourceId}` ||
    !isSafeText(value.name) ||
    !isPathWithinRoot(value.path, root)
  ) {
    return null
  }

  const sizeBytes = value.sizeBytes
  const durationSeconds = value.durationSeconds
  const thumbnailUrl = value.thumbnailUrl
  const modifiedAt = value.modifiedAt

  if (
    !isOptionalSafeInteger(value, 'sizeBytes') ||
    !isOptionalSafeNumber(value, 'durationSeconds') ||
    !isOptionalSafeInteger(value, 'modifiedAt') ||
    !isOptionalSafeThumbnail(value)
  ) {
    return null
  }

  return {
    id: value.id,
    sourceType: 'baidu',
    sourceId: value.sourceId,
    name: value.name,
    path: value.path,
    ...(typeof sizeBytes === 'number' ? { sizeBytes } : {}),
    ...(typeof durationSeconds === 'number'
      ? { durationSeconds }
      : {}),
    ...(typeof thumbnailUrl === 'string' ? { thumbnailUrl } : {}),
    ...(typeof modifiedAt === 'number' ? { modifiedAt } : {})
  }
}

function cloneVideos(videos: readonly VideoItem[]): VideoItem[] {
  return videos.map((video) => ({ ...video }))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isCanonicalFsId(value: unknown): value is string {
  if (typeof value !== 'string' || !/^[1-9]\d*$/u.test(value)) {
    return false
  }

  return (
    value.length < UINT64_MAX.length ||
    (value.length === UINT64_MAX.length && value <= UINT64_MAX)
  )
}

function isSafeText(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    Boolean(value.trim()) &&
    !CONTROL_CHARACTER.test(value)
  )
}

function isSafeAppRoot(value: unknown): value is string {
  return typeof value === 'string' && SAFE_APP_ROOT.test(value)
}

function isPathWithinRoot(value: unknown, root: string): value is string {
  return (
    isSafeAbsolutePath(value) &&
    value.startsWith(`${root}/`) &&
    value.length > root.length + 1
  )
}

function isSafeAbsolutePath(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    !value.startsWith('/') ||
    value === '/' ||
    CONTROL_CHARACTER.test(value) ||
    value.includes('\\') ||
    value.includes('?') ||
    value.includes('#') ||
    hasAmbiguousPercentEscape(value)
  ) {
    return false
  }

  return value
    .split('/')
    .slice(1)
    .every((segment) => Boolean(segment) && segment !== '.' && segment !== '..')
}

function hasAmbiguousPercentEscape(path: string): boolean {
  for (let index = 0; index < path.length; index += 1) {
    if (
      path[index] === '%' &&
      path[index + 1] !== undefined &&
      /[0-9A-F]/iu.test(path[index + 1]!)
    ) {
      return true
    }
  }

  return false
}

function isOptionalSafeInteger(
  record: Record<string, unknown>,
  key: 'sizeBytes' | 'modifiedAt'
): boolean {
  const value = record[key]
  return (
    !(key in record) ||
    (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)
  )
}

function isOptionalSafeNumber(
  record: Record<string, unknown>,
  key: 'durationSeconds'
): boolean {
  const value = record[key]
  return (
    !(key in record) ||
    (typeof value === 'number' &&
      Number.isFinite(value) &&
      value >= 0 &&
      value <= Number.MAX_SAFE_INTEGER)
  )
}

function isOptionalSafeThumbnail(record: Record<string, unknown>): boolean {
  if (!('thumbnailUrl' in record)) {
    return true
  }

  if (typeof record.thumbnailUrl !== 'string') {
    return false
  }

  try {
    const url = new URL(record.thumbnailUrl)
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.hash &&
      !Array.from(url.searchParams.keys()).some(
        (key) => key.toLowerCase() === 'access_token'
      )
    )
  } catch {
    return false
  }
}

interface OptionalTimestamp {
  value?: number
  invalid: boolean
}

function readOptionalTimestamp(
  record: Record<string, unknown>,
  key: 'savedAt' | 'requestStartedAt',
  now: number
): OptionalTimestamp {
  if (!(key in record)) {
    return { invalid: false }
  }

  const value = record[key]
  if (!isSafeTimestamp(value) || value > now) {
    return { invalid: true }
  }

  return { value, invalid: false }
}

function isSafeTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}
