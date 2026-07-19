import type { BaiduAuthSession, VideoItem } from '@/domain/video'
import { BaiduError } from '@/features/baidu/baiduErrors'

export type PlaybackResolutionErrorCode =
  | 'not-found'
  | 'authorization-required'
  | 'unsupported-source'
  | 'retry-not-authorized'
  | 'retry-exhausted'

export class PlaybackResolutionError extends Error {
  constructor(readonly code: PlaybackResolutionErrorCode) {
    super(messageFor(code))
    this.name = 'PlaybackResolutionError'
  }

  toJSON(): Record<string, string> {
    return {
      name: this.name,
      code: this.code,
      message: this.message
    }
  }
}

export interface BaiduPlaybackSource {
  resolvePlaybackUrl(
    accessToken: string,
    fsId: string | number
  ): Promise<string>
}

export interface PlaybackResolverOptions {
  now?: () => number
}

export class PlaybackResolver {
  private readonly now: () => number

  constructor(
    private readonly baiduDriveSource: BaiduPlaybackSource,
    options: PlaybackResolverOptions = {}
  ) {
    this.now = options.now ?? Date.now
  }

  async resolve(
    item: VideoItem | null | undefined,
    session: BaiduAuthSession | null | undefined
  ): Promise<string> {
    if (!item || !item.id || !item.sourceId) {
      throw new PlaybackResolutionError('not-found')
    }

    if (item.sourceType === 'direct') {
      if (!item.path) {
        throw new PlaybackResolutionError('not-found')
      }
      return item.path
    }

    if (item.sourceType !== 'baidu') {
      throw new PlaybackResolutionError('unsupported-source')
    }

    if (!isValidBaiduSession(session, this.now())) {
      throw new PlaybackResolutionError('authorization-required')
    }

    return this.baiduDriveSource.resolvePlaybackUrl(
      session.accessToken,
      item.sourceId
    )
  }

  createPlayerLoad(
    item: VideoItem | null | undefined,
    session: BaiduAuthSession | null | undefined
  ): PlayerPlaybackLoad {
    return new PlayerPlaybackLoad(this, item, session)
  }
}

function isValidBaiduSession(
  session: BaiduAuthSession | null | undefined,
  now: number
): session is BaiduAuthSession {
  return Boolean(
    session &&
      session.accessToken.trim() &&
      Number.isFinite(session.expiresAt) &&
      session.expiresAt > now &&
      session.scope.includes('basic') &&
      session.scope.includes('netdisk')
  )
}

export class PlayerPlaybackLoad {
  private retryConsumed = false

  constructor(
    private readonly resolver: PlaybackResolver,
    private readonly item: VideoItem | null | undefined,
    private readonly session: BaiduAuthSession | null | undefined
  ) {}

  resolve(): Promise<string> {
    return this.resolver.resolve(this.item, this.session)
  }

  retryAfterAuthorizationFailure(failure: unknown): Promise<string> {
    if (this.retryConsumed) {
      return Promise.reject(new PlaybackResolutionError('retry-exhausted'))
    }

    if (!isAuthorizationFailure(failure)) {
      return Promise.reject(new PlaybackResolutionError('retry-not-authorized'))
    }

    this.retryConsumed = true
    return this.resolver.resolve(this.item, this.session)
  }
}

function isAuthorizationFailure(error: unknown): boolean {
  return (
    error instanceof BaiduError &&
    (error.kind === 'authorization' ||
      (error.kind === 'http' && error.code === 403))
  )
}

function messageFor(code: PlaybackResolutionErrorCode): string {
  switch (code) {
    case 'not-found':
      return 'The requested video is unavailable.'
    case 'authorization-required':
      return 'A Baidu authorization is required to play this video.'
    case 'unsupported-source':
      return 'This video source is unsupported.'
    case 'retry-not-authorized':
      return 'This playback error cannot be retried automatically.'
    case 'retry-exhausted':
      return 'The playback address could not be refreshed.'
  }
}
