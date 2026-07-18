import type { VideoItem } from '@/domain/video'
import {
  normalizeBaiduError,
  toBaiduError,
  toBaiduResponseError,
  toBaiduValidationError
} from './baiduErrors'
import {
  baiduTransport,
  type BaiduTransport
} from './baiduTransport'

const SAFE_APP_ROOT = /^\/apps\/[\p{L}\p{N} _-]{1,20}$/u
const CONTROL_CHARACTER = /[\u0000-\u001F\u007F]/u

export class BaiduDriveSource {
  private readonly root: string

  constructor(
    root: string,
    private readonly transport: BaiduTransport = baiduTransport
  ) {
    if (
      typeof root !== 'string' ||
      CONTROL_CHARACTER.test(root) ||
      !SAFE_APP_ROOT.test(root)
    ) {
      throw toBaiduValidationError()
    }

    this.root = root
  }

  async listPage(accessToken: string, page: number): Promise<VideoItem[]> {
    if (
      typeof accessToken !== 'string' ||
      !accessToken.trim() ||
      !Number.isSafeInteger(page) ||
      page <= 0
    ) {
      throw toBaiduValidationError()
    }

    try {
      const response = await this.transport({
        method: 'videolist',
        access_token: accessToken,
        parent_path: this.root,
        recursion: 1,
        web: 1,
        num: 1000,
        page
      })
      const info = readProviderArray(response, 'info')
      const seen = new Set<number>()
      const videos: VideoItem[] = []

      for (const entry of info) {
        const video = mapVideoRecord(entry, this.root)
        if (!video) {
          continue
        }

        const fsId = Number(video.sourceId)
        if (seen.has(fsId)) {
          continue
        }

        seen.add(fsId)
        videos.push(video)
      }

      return videos
    } catch (error) {
      throw normalizeBaiduError(error)
    }
  }

  async resolvePlaybackUrl(
    accessToken: string,
    fsId: number | string
  ): Promise<string> {
    const normalizedFsId = normalizeFsId(fsId)
    if (
      typeof accessToken !== 'string' ||
      !accessToken.trim() ||
      normalizedFsId === undefined
    ) {
      throw toBaiduValidationError()
    }

    try {
      const response = await this.transport({
        method: 'filemetas',
        access_token: accessToken,
        fsids: JSON.stringify([normalizedFsId]),
        dlink: 1,
        thumb: 1,
        needmedia: 1
      })
      const list = readProviderArray(response, 'list')
      const matches = list.filter(
        (candidate) =>
          isRecord(candidate) &&
          normalizeFsId(candidate.fs_id) === normalizedFsId
      )

      if (matches.length !== 1) {
        throw toBaiduResponseError()
      }

      const entry = matches[0]
      if (
        !isRecord(entry) ||
        typeof entry.path !== 'string' ||
        !isPathWithinRoot(entry.path, this.root) ||
        typeof entry.dlink !== 'string'
      ) {
        throw toBaiduResponseError()
      }

      return addAccessToken(entry.dlink, accessToken)
    } catch (error) {
      throw normalizeBaiduError(error)
    }
  }
}

function readProviderArray(response: unknown, key: 'info' | 'list'): unknown[] {
  if (!isRecord(response) || !Number.isSafeInteger(response.errno)) {
    throw toBaiduResponseError()
  }

  const errno = response.errno as number
  if (errno !== 0) {
    throw toBaiduError(errno, response.request_id)
  }

  const value = response[key]
  if (!Array.isArray(value)) {
    throw toBaiduResponseError()
  }

  return value
}

function normalizeFsId(value: unknown): number | undefined {
  if (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value > 0
  ) {
    return value
  }

  if (typeof value !== 'string' || !/^[1-9]\d*$/u.test(value)) {
    return undefined
  }

  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && String(parsed) === value
    ? parsed
    : undefined
}

function addAccessToken(dlink: string, accessToken: string): string {
  if (!dlink || CONTROL_CHARACTER.test(dlink)) {
    throw toBaiduResponseError()
  }

  let url: URL
  try {
    url = new URL(dlink)
  } catch {
    throw toBaiduResponseError()
  }

  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw toBaiduResponseError()
  }

  for (const key of Array.from(url.searchParams.keys())) {
    if (key.toLowerCase() === 'access_token') {
      url.searchParams.delete(key)
    }
  }
  url.searchParams.set('access_token', accessToken)
  return url.toString()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function mapVideoRecord(value: unknown, root: string): VideoItem | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  const fsId = readFsId(value.fs_id)
  const name = readName(value.server_filename, value.name)
  const path = typeof value.path === 'string' ? value.path : undefined
  const size = readOptionalNumber(value, 'size', isSafeIntegerMetadata)
  const modifiedAt = readOptionalNumber(
    value,
    'server_mtime',
    isSafeIntegerMetadata
  )
  const duration = readOptionalNumber(value, 'duration', isSafeNumberMetadata)

  if (
    fsId === undefined ||
    name === undefined ||
    path === undefined ||
    !isPathWithinRoot(path, root) ||
    value.isdir !== 0 ||
    value.category !== 1 ||
    size.invalid ||
    modifiedAt.invalid ||
    duration.invalid
  ) {
    return undefined
  }

  const thumbnailUrl = largestSafeThumbnail(value.thumbs ?? value.thumb)

  return {
    id: `baidu:${fsId}`,
    sourceType: 'baidu',
    sourceId: String(fsId),
    name,
    path,
    ...(size.value !== undefined ? { sizeBytes: size.value } : {}),
    ...(modifiedAt.value !== undefined
      ? { modifiedAt: modifiedAt.value }
      : {}),
    ...(duration.value !== undefined
      ? { durationSeconds: duration.value }
      : {}),
    ...(thumbnailUrl ? { thumbnailUrl } : {})
  }
}

function readFsId(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && typeof value === 'number' && value > 0
    ? value
    : undefined
}

function readName(...values: unknown[]): string | undefined {
  return values.find(
    (value): value is string =>
      typeof value === 'string' &&
      Boolean(value.trim()) &&
      !CONTROL_CHARACTER.test(value)
  )
}

function isPathWithinRoot(path: string, root: string): boolean {
  if (
    CONTROL_CHARACTER.test(path) ||
    path.includes('\\') ||
    (path !== root && !path.startsWith(`${root}/`))
  ) {
    return false
  }

  const segments = path.split('/').slice(1)
  return segments.every(
    (segment) => Boolean(segment) && segment !== '.' && segment !== '..'
  )
}

interface OptionalNumber {
  readonly value?: number
  readonly invalid: boolean
}

function readOptionalNumber(
  record: Record<string, unknown>,
  key: string,
  validate: (value: number) => boolean
): OptionalNumber {
  if (!(key in record)) {
    return { invalid: false }
  }

  const value = record[key]
  return typeof value === 'number' && validate(value)
    ? { value, invalid: false }
    : { invalid: true }
}

function isSafeIntegerMetadata(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0
}

function isSafeNumberMetadata(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER
}

interface ThumbnailCandidate {
  readonly url: string
  readonly rank: number
  readonly order: number
}

function largestSafeThumbnail(value: unknown): string | undefined {
  const candidates: ThumbnailCandidate[] = []
  collectThumbnailCandidates(value, candidates)

  return candidates
    .filter((candidate) => isSafeThumbnailUrl(candidate.url))
    .sort((left, right) => right.rank - left.rank || left.order - right.order)[0]
    ?.url
}

function collectThumbnailCandidates(
  value: unknown,
  candidates: ThumbnailCandidate[],
  key = ''
): void {
  if (typeof value === 'string') {
    candidates.push({
      url: value,
      rank: rankThumbnailKey(key),
      order: candidates.length
    })
    return
  }

  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      collectThumbnailCandidates(entry, candidates, String(index + 1))
    )
    return
  }

  if (!isRecord(value)) {
    return
  }

  if (typeof value.url === 'string') {
    const width = readPositiveNumber(value.width)
    const height = readPositiveNumber(value.height)
    candidates.push({
      url: value.url,
      rank:
        width !== undefined && height !== undefined
          ? width * height
          : rankThumbnailKey(key),
      order: candidates.length
    })
    return
  }

  for (const [childKey, child] of Object.entries(value)) {
    collectThumbnailCandidates(child, candidates, childKey)
  }
}

function rankThumbnailKey(key: string): number {
  const suffix = key.match(/(\d+)(?!.*\d)/u)?.[1]
  return suffix ? Number(suffix) : 0
}

function readPositiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined
}

function isSafeThumbnailUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !Array.from(url.searchParams.keys()).some(
        (key) => key.toLowerCase() === 'access_token'
      )
    )
  } catch {
    return false
  }
}
