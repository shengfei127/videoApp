import { describe, expect, it, vi } from 'vitest'

import {
  canAcceptUnknownHttpsUrl,
  classifyDirectUrl,
  DirectLinkService,
  DIRECT_VIDEO_STORAGE_KEY
} from '@/features/direct-links/directLinkService'
import { createMemoryStorage } from '@/infrastructure/storage'

describe('classifyDirectUrl', () => {
  it.each([
    ['https://cdn.example.test/live/playlist.M3U8?signature=abc#segment', 'hls'],
    ['https://cdn.example.test/videos/clip.MP4?expires=123', 'mp4'],
    ['http://cdn.example.test/videos/clip.mp4', 'invalid'],
    ['https://example.test/watch/123', 'unknown'],
    ['not a URL', 'invalid']
  ])('classifies %s as %s', (value, expected) => {
    expect(classifyDirectUrl(value)).toBe(expected)
  })
})

describe('canAcceptUnknownHttpsUrl', () => {
  it.each([
    ['https://cdn.example.test/stream?token=abc', 'Video/MP4; charset=utf-8', true],
    ['https://cdn.example.test/stream', 'application/vnd.apple.mpegurl; charset=UTF-8', true],
    ['https://cdn.example.test/stream', 'APPLICATION/X-MPEGURL', true],
    ['https://cdn.example.test/stream', 'text/html', false],
    ['http://cdn.example.test/stream', 'video/mp4', false],
    ['not a URL', 'application/vnd.apple.mpegurl', false]
  ])('accepts %s with %s: %s', (url, contentType, expected) => {
    expect(canAcceptUnknownHttpsUrl(url, contentType)).toBe(expected)
  })
})

describe('DirectLinkService', () => {
  it('persists a normalized known media URL with an injected UUID and fallback name', () => {
    const storage = createMemoryStorage()
    const service = new DirectLinkService(storage, {
      now: () => 1000,
      uuidFactory: () => 'direct-1'
    })

    const record = service.add({
      url: 'HTTPS://cdn.example.test/videos/hello%20world.MP4?signature=abc'
    })

    expect(record).toEqual({
      id: 'direct-1',
      name: 'hello world.MP4',
      url: 'https://cdn.example.test/videos/hello%20world.MP4?signature=abc',
      mediaKind: 'mp4',
      addedAt: 1000
    })
    expect(storage.read(DIRECT_VIDEO_STORAGE_KEY, [])).toEqual([record])
  })

  it('keeps a malformed encoded basename as the direct-link name', () => {
    const service = new DirectLinkService(createMemoryStorage(), {
      now: () => 1000,
      uuidFactory: () => 'direct-1'
    })
    const addMalformedLink = () =>
      service.add({ url: 'https://cdn.example.test/%zz.mp4' })

    expect(addMalformedLink).not.toThrow()
    expect(service.list()).toMatchObject([{ name: '%zz.mp4' }])
  })

  it('trims a supplied name and falls back to the decoded basename or default title', () => {
    let sequence = 0
    const service = new DirectLinkService(createMemoryStorage(), {
      now: () => 1000,
      uuidFactory: () => `direct-${++sequence}`
    })

    expect(
      service.add({
        url: 'https://cdn.example.test/videos/clip.mp4',
        name: '  My clip  '
      }).name
    ).toBe('My clip')
    expect(
      service.add(
        { url: 'https://cdn.example.test/' },
        'video/mp4'
      ).name
    ).toBe('媒体直链')
  })

  it('rejects invalid links and unknown HTTPS links without a supported probe', () => {
    const service = new DirectLinkService(createMemoryStorage(), {
      now: () => 1000,
      uuidFactory: () => 'direct-1'
    })

    expect(() =>
      service.add({ url: 'http://cdn.example.test/videos/clip.mp4' })
    ).toThrow('有效的 HTTPS 媒体链接')
    expect(() => service.add({ url: 'not a URL' })).toThrow(
      '有效的 HTTPS 媒体链接'
    )
    expect(() =>
      service.add({ url: 'https://example.test/watch/123' })
    ).toThrow('媒体链接')
  })

  it('allows an unknown HTTPS link only when its probe has a supported media type', () => {
    const service = new DirectLinkService(createMemoryStorage(), {
      now: () => 1000,
      uuidFactory: () => 'direct-1'
    })

    expect(
      service.add(
        { url: 'https://cdn.example.test/stream?token=abc' },
        'application/x-mpegurl; charset=utf-8'
      )
    ).toMatchObject({
      id: 'direct-1',
      url: 'https://cdn.example.test/stream?token=abc',
      mediaKind: 'hls'
    })
  })

  it('drops an unverified persisted ordinary HTTPS webpage', () => {
    const storage = createMemoryStorage()
    storage.write(DIRECT_VIDEO_STORAGE_KEY, [
      {
        id: 'webpage',
        name: 'Webpage',
        url: 'https://example.test/watch',
        addedAt: 1000
      }
    ])

    expect(new DirectLinkService(storage).list()).toEqual([])
  })

  it('accepts a persisted extensionless HTTPS record with a verified media kind', () => {
    const storage = createMemoryStorage()
    storage.write(DIRECT_VIDEO_STORAGE_KEY, [
      {
        id: 'hls-stream',
        name: 'HLS stream',
        url: 'https://cdn.example.test/stream?token=abc',
        mediaKind: 'hls',
        addedAt: 1000
      }
    ])

    expect(new DirectLinkService(storage).list()).toMatchObject([
      { id: 'hls-stream', mediaKind: 'hls' }
    ])
  })

  it('lists only valid persisted records in descending addedAt order', () => {
    const storage = createMemoryStorage()
    storage.write(DIRECT_VIDEO_STORAGE_KEY, [
      {
        id: 'oldest',
        name: 'Oldest',
        url: 'https://cdn.example.test/oldest.mp4',
        mediaKind: 'mp4',
        addedAt: 1000
      },
      null,
      {
        id: 'invalid-url',
        name: 'Invalid URL',
        url: 'http://cdn.example.test/invalid.mp4',
        addedAt: 4000
      },
      {
        id: 'newest',
        name: 'Newest',
        url: 'https://cdn.example.test/newest.m3u8',
        mediaKind: 'hls',
        addedAt: 3000
      },
      {
        id: 'invalid-timestamp',
        name: 'Invalid timestamp',
        url: 'https://cdn.example.test/invalid.mp4',
        addedAt: Number.NaN
      },
      {
        id: 'middle',
        name: 'Middle',
        url: 'https://cdn.example.test/middle.mp4',
        mediaKind: 'mp4',
        addedAt: 2000
      }
    ])
    const service = new DirectLinkService(storage)

    expect(service.list().map((record) => record.id)).toEqual([
      'newest',
      'middle',
      'oldest'
    ])
  })

  it('updates a record while preserving its id and addedAt', () => {
    const storage = createMemoryStorage()
    const service = new DirectLinkService(storage, {
      now: () => 1000,
      uuidFactory: () => 'direct-1'
    })
    const original = service.add({
      url: 'https://cdn.example.test/original.mp4',
      name: 'Original'
    })

    const updated = service.update(
      original.id,
      {
        url: 'https://cdn.example.test/replacement.m3u8?sig=abc',
        name: '  Replacement  '
      }
    )

    expect(updated).toEqual({
      id: original.id,
      name: 'Replacement',
      url: 'https://cdn.example.test/replacement.m3u8?sig=abc',
      mediaKind: 'hls',
      addedAt: original.addedAt
    })
    expect(service.list()).toEqual([updated])
  })

  it('throws a user-facing error when updating an absent id', () => {
    const service = new DirectLinkService(createMemoryStorage(), {
      uuidFactory: () => 'direct-1'
    })

    expect(() =>
      service.update('missing', {
        url: 'https://cdn.example.test/replacement.mp4'
      })
    ).toThrow('未找到')
  })

  it('drops a persisted known-extension record whose media kind does not match', () => {
    const storage = createMemoryStorage()
    storage.write(DIRECT_VIDEO_STORAGE_KEY, [
      {
        id: 'mismatched',
        name: 'Mismatched',
        url: 'https://cdn.example.test/clip.mp4',
        mediaKind: 'hls',
        addedAt: 1000
      }
    ])

    expect(new DirectLinkService(storage).list()).toEqual([])
  })

  it('drops an invalid media kind while preserving valid persisted records', () => {
    const storage = createMemoryStorage()
    storage.write<unknown>(DIRECT_VIDEO_STORAGE_KEY, [
      {
        id: 'invalid-kind',
        name: 'Invalid kind',
        url: 'https://cdn.example.test/invalid.mp4',
        mediaKind: 'webm',
        addedAt: 2000
      },
      {
        id: 'valid-kind',
        name: 'Valid kind',
        url: 'https://cdn.example.test/valid.mp4',
        mediaKind: 'mp4',
        addedAt: 1000
      }
    ])

    expect(
      new DirectLinkService(storage)
        .list()
        .map(({ id, mediaKind }) => ({ id, mediaKind }))
    ).toEqual([{ id: 'valid-kind', mediaKind: 'mp4' }])
  })

  it('removes only the requested record and clears only direct-link storage', () => {
    const storage = createMemoryStorage()
    const service = new DirectLinkService(storage, {
      now: () => 1000,
      uuidFactory: (() => {
        let index = 0
        return () => `direct-${++index}`
      })()
    })
    const keep = service.add({ url: 'https://cdn.example.test/keep.mp4' })
    const remove = service.add({ url: 'https://cdn.example.test/remove.mp4' })
    storage.write('unrelated', { preserved: true })

    service.remove(remove.id)

    expect(service.list()).toEqual([keep])
    expect(storage.read('unrelated', null)).toEqual({ preserved: true })

    service.clear()

    expect(service.list()).toEqual([])
    expect(storage.read('unrelated', null)).toEqual({ preserved: true })
  })

  it('ignores malformed direct-link storage without changing unrelated storage', () => {
    const storage = createMemoryStorage()
    storage.write(DIRECT_VIDEO_STORAGE_KEY, { unexpected: true })
    storage.write('unrelated', { preserved: true })
    const service = new DirectLinkService(storage, {
      now: () => 1000,
      uuidFactory: () => 'direct-1'
    })

    expect(service.list()).toEqual([])
    expect(() =>
      service.add({ url: 'https://cdn.example.test/new.mp4' })
    ).not.toThrow()
    expect(service.list()).toMatchObject([{ id: 'direct-1' }])
    expect(storage.read('unrelated', null)).toEqual({ preserved: true })
  })

  it('uses crypto.randomUUID by default', () => {
    const randomUUID = vi.fn(() => 'crypto-uuid')
    vi.stubGlobal('crypto', { randomUUID })
    const service = new DirectLinkService(createMemoryStorage(), {
      now: () => 1000
    })

    expect(
      service.add({ url: 'https://cdn.example.test/default-id.mp4' }).id
    ).toBe('crypto-uuid')
    expect(randomUUID).toHaveBeenCalledOnce()
  })

  it('throws a clear user-facing error when crypto.randomUUID is unavailable', () => {
    vi.stubGlobal('crypto', {})
    const service = new DirectLinkService(createMemoryStorage(), {
      now: () => 1000
    })

    expect(() =>
      service.add({ url: 'https://cdn.example.test/default-id.mp4' })
    ).toThrow('无法安全生成')
  })
})
