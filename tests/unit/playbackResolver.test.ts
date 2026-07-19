import { describe, expect, it, vi } from 'vitest'

import type { BaiduAuthSession, VideoItem } from '@/domain/video'
import { BaiduError } from '@/features/baidu/baiduErrors'
import {
  PlaybackResolutionError,
  PlaybackResolver
} from '@/features/playback/playbackResolver'

const session: BaiduAuthSession = {
  accessToken: 'private-access-token',
  expiresAt: 1_900_000_000_000,
  scope: ['basic', 'netdisk']
}

const directVideo: VideoItem = {
  id: 'direct:movie',
  sourceType: 'direct',
  sourceId: 'movie',
  name: 'Movie.mp4',
  path: 'https://media.example.test/Movie.mp4?signature=preserve-this-exactly'
}

const baiduVideo: VideoItem = {
  id: 'baidu:9007199254740992',
  sourceType: 'baidu',
  sourceId: '9007199254740992',
  name: 'Episode.mp4',
  path: '/apps/片刻/Episode.mp4'
}

describe('PlaybackResolver', () => {
  it('returns a saved direct HTTPS URL unchanged', async () => {
    const resolvePlaybackUrl = vi.fn()
    const resolver = new PlaybackResolver({ resolvePlaybackUrl })

    await expect(resolver.resolve(directVideo, null)).resolves.toBe(
      directVideo.path
    )
    expect(resolvePlaybackUrl).not.toHaveBeenCalled()
  })

  it('gets a fresh Baidu dlink for every resolve call', async () => {
    const resolvePlaybackUrl = vi
      .fn()
      .mockResolvedValueOnce('https://d.pcs.baidu.com/file/first?access_token=one')
      .mockResolvedValueOnce('https://d.pcs.baidu.com/file/second?access_token=two')
    const resolver = new PlaybackResolver({ resolvePlaybackUrl })

    await expect(resolver.resolve(baiduVideo, session)).resolves.toContain('/first')
    await expect(resolver.resolve(baiduVideo, session)).resolves.toContain('/second')

    expect(resolvePlaybackUrl).toHaveBeenNthCalledWith(
      1,
      session.accessToken,
      baiduVideo.sourceId
    )
    expect(resolvePlaybackUrl).toHaveBeenNthCalledWith(
      2,
      session.accessToken,
      baiduVideo.sourceId
    )
  })

  it('allows one Baidu 403 re-resolution for a player load and then stops', async () => {
    const resolvePlaybackUrl = vi
      .fn()
      .mockResolvedValueOnce('https://d.pcs.baidu.com/file/expired?access_token=one')
      .mockResolvedValueOnce('https://d.pcs.baidu.com/file/fresh?access_token=two')
    const resolver = new PlaybackResolver({ resolvePlaybackUrl })
    const load = resolver.createPlayerLoad(baiduVideo, session)

    await expect(load.resolve()).resolves.toContain('/expired')
    await expect(
      load.retryAfterAuthorizationFailure(new BaiduError('http', 403))
    ).resolves.toContain('/fresh')
    await expect(
      load.retryAfterAuthorizationFailure(new BaiduError('http', 403))
    ).rejects.toMatchObject({
      name: 'PlaybackResolutionError',
      code: 'retry-exhausted'
    })
    expect(resolvePlaybackUrl).toHaveBeenCalledTimes(2)
  })

  it('stops after a failed single retry instead of recursively resolving', async () => {
    const resolvePlaybackUrl = vi
      .fn()
      .mockRejectedValue(new BaiduError('http', 403))
    const resolver = new PlaybackResolver({ resolvePlaybackUrl })
    const load = resolver.createPlayerLoad(baiduVideo, session)

    await expect(load.resolve()).rejects.toMatchObject({
      name: 'BaiduError',
      kind: 'http',
      code: 403
    })
    await expect(
      load.retryAfterAuthorizationFailure(new BaiduError('http', 403))
    ).rejects.toMatchObject({
      name: 'BaiduError',
      kind: 'http',
      code: 403
    })
    await expect(
      load.retryAfterAuthorizationFailure(new BaiduError('http', 403))
    ).rejects.toMatchObject({
      name: 'PlaybackResolutionError',
      code: 'retry-exhausted'
    })
    expect(resolvePlaybackUrl).toHaveBeenCalledTimes(2)
  })

  it('uses typed, token-safe errors for missing videos and required Baidu sessions', async () => {
    const resolver = new PlaybackResolver({ resolvePlaybackUrl: vi.fn() })

    await expect(resolver.resolve(null, session)).rejects.toBeInstanceOf(
      PlaybackResolutionError
    )
    await expect(resolver.resolve(null, session)).rejects.toMatchObject({
      code: 'not-found'
    })
    await expect(resolver.resolve(baiduVideo, null)).rejects.toMatchObject({
      name: 'PlaybackResolutionError',
      code: 'authorization-required'
    })

    try {
      await resolver.resolve(null, {
        ...session,
        accessToken: 'sentinel-private-token'
      })
    } catch (error) {
      expect(JSON.stringify(error)).not.toContain('sentinel-private-token')
    }
  })

  it.each([
    ['expired', { ...session, expiresAt: 1_700_000_000_000 }],
    ['missing basic scope', { ...session, scope: ['netdisk'] }],
    ['missing netdisk scope', { ...session, scope: ['basic'] }]
  ] as Array<[string, BaiduAuthSession]>)(
    'rejects a %s Baidu session before resolving a dlink',
    async (_case, invalidSession) => {
      const resolvePlaybackUrl = vi.fn()
      const resolver = new PlaybackResolver(
        { resolvePlaybackUrl },
        { now: () => 1_800_000_000_000 }
      )

      await expect(resolver.resolve(baiduVideo, invalidSession)).rejects.toMatchObject({
        name: 'PlaybackResolutionError',
        code: 'authorization-required'
      })
      expect(resolvePlaybackUrl).not.toHaveBeenCalled()
    }
  )
})
