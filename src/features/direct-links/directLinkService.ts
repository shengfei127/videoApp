import type { DirectVideoRecord } from '@/domain/video'
import type { KeyValueStorage } from '@/infrastructure/storage'

export type DirectUrlKind = 'mp4' | 'hls' | 'unknown' | 'invalid'

export const DIRECT_VIDEO_STORAGE_KEY = 'pianke:direct-videos:v1'

interface DirectLinkServiceOptions {
  now?: () => number
  uuidFactory?: () => string
}

export function classifyDirectUrl(value: string): DirectUrlKind {
  try {
    const url = new URL(value)

    if (url.protocol !== 'https:') {
      return 'invalid'
    }

    const pathname = url.pathname.toLowerCase()

    if (pathname.endsWith('.mp4')) {
      return 'mp4'
    }

    if (pathname.endsWith('.m3u8')) {
      return 'hls'
    }

    return 'unknown'
  } catch {
    return 'invalid'
  }
}

export function canAcceptUnknownHttpsUrl(
  value: string,
  probeContentType?: string
): boolean {
  if (classifyDirectUrl(value) !== 'unknown' || !probeContentType) {
    return false
  }

  const mediaType = probeContentType.split(';', 1)[0].trim().toLowerCase()

  return [
    'video/mp4',
    'application/vnd.apple.mpegurl',
    'application/x-mpegurl'
  ].includes(mediaType)
}

export class DirectLinkService {
  private readonly now: () => number
  private readonly uuidFactory: () => string

  constructor(
    private readonly storage: KeyValueStorage,
    options: DirectLinkServiceOptions = {}
  ) {
    this.now = options.now ?? Date.now
    this.uuidFactory = options.uuidFactory ?? createDefaultUuid
  }

  add(
    input: { url: string; name?: string },
    probeContentType?: string
  ): DirectVideoRecord {
    const url = this.validateUrl(input.url, probeContentType)
    const record: DirectVideoRecord = {
      id: this.uuidFactory(),
      name: resolveName(input.name, url),
      url: url.href,
      addedAt: this.now()
    }

    this.storage.write(DIRECT_VIDEO_STORAGE_KEY, [...this.list(), record])

    return record
  }

  list(): DirectVideoRecord[] {
    const stored = this.storage.read<unknown>(DIRECT_VIDEO_STORAGE_KEY, [])

    if (!Array.isArray(stored)) {
      return []
    }

    return stored
      .filter(isDirectVideoRecord)
      .sort((left, right) => right.addedAt - left.addedAt)
  }

  update(
    id: string,
    input: { url: string; name?: string },
    probeContentType?: string
  ): DirectVideoRecord {
    const records = this.list()
    const existing = records.find((record) => record.id === id)

    if (!existing) {
      throw new Error('未找到要更新的媒体链接')
    }

    const url = this.validateUrl(input.url, probeContentType)
    const updated: DirectVideoRecord = {
      id: existing.id,
      name: resolveName(input.name, url),
      url: url.href,
      addedAt: existing.addedAt
    }

    this.storage.write(
      DIRECT_VIDEO_STORAGE_KEY,
      records.map((record) => (record.id === id ? updated : record))
    )

    return updated
  }

  remove(id: string): void {
    this.storage.write(
      DIRECT_VIDEO_STORAGE_KEY,
      this.list().filter((record) => record.id !== id)
    )
  }

  clear(): void {
    this.storage.remove(DIRECT_VIDEO_STORAGE_KEY)
  }

  private validateUrl(value: string, probeContentType?: string): URL {
    const kind = classifyDirectUrl(value)

    if (kind === 'invalid') {
      throw new Error('请输入有效的 HTTPS 媒体链接')
    }

    if (kind === 'unknown' && !canAcceptUnknownHttpsUrl(value, probeContentType)) {
      throw new Error('无法确认该链接是可播放的媒体链接')
    }

    return new URL(value)
  }
}

function deriveName(url: URL): string {
  const basename = url.pathname.split('/').filter(Boolean).pop() ?? ''

  try {
    return decodeURIComponent(basename)
  } catch {
    return basename
  }
}

function resolveName(name: string | undefined, url: URL): string {
  return name?.trim() || deriveName(url) || '媒体直链'
}

function createDefaultUuid(): string {
  if (typeof globalThis.crypto?.randomUUID !== 'function') {
    throw new Error('当前环境无法安全生成媒体链接 ID')
  }

  return globalThis.crypto.randomUUID()
}

function isDirectVideoRecord(value: unknown): value is DirectVideoRecord {
  if (!value || typeof value !== 'object') {
    return false
  }

  const record = value as Record<string, unknown>

  return (
    typeof record.id === 'string' &&
    record.id.length > 0 &&
    typeof record.name === 'string' &&
    typeof record.url === 'string' &&
    classifyDirectUrl(record.url) !== 'invalid' &&
    typeof record.addedAt === 'number' &&
    Number.isFinite(record.addedAt)
  )
}
