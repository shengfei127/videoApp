import { describe, expect, it } from 'vitest'

import type { VideoItem } from '@/domain/video'
import { AUTH_STORAGE_KEY } from '@/features/auth/authRepository'
import {
  CATALOG_CACHE_FRESH_MS,
  CATALOG_CACHE_KEY,
  CATALOG_REFRESH_COOLDOWN_MS,
  CatalogCache
} from '@/features/catalog/catalogCache'
import { DIRECT_VIDEO_STORAGE_KEY } from '@/features/direct-links/directLinkService'
import { PROGRESS_STORAGE_KEY } from '@/features/playback/progressRepository'
import {
  createMemoryStorage,
  type KeyValueStorage
} from '@/infrastructure/storage'

const START = 1_800_000_000_000
const ROOT = '/apps/片刻'

describe('CatalogCache snapshots', () => {
  it('persists and returns a cloned successful Baidu snapshot', () => {
    const storage = createMemoryStorage()
    const videos = [baiduVideo('1')]
    const cache = new CatalogCache(storage, {
      root: ROOT,
      now: () => START
    })

    const saved = cache.saveSuccessful(videos)
    videos[0]!.name = 'mutated input.mp4'
    saved.videos[0]!.name = 'mutated result.mp4'

    expect(cache.load()).toEqual({
      videos: [baiduVideo('1')],
      savedAt: START
    })
    expect(JSON.stringify(storage.read(CATALOG_CACHE_KEY, null))).not.toContain(
      'mutated'
    )
  })

  it('treats age below fifteen minutes as fresh and the exact boundary as stale', () => {
    let now = START
    const cache = new CatalogCache(createMemoryStorage(), {
      root: ROOT,
      now: () => now
    })
    cache.saveSuccessful([baiduVideo('1')])

    now = START + CATALOG_CACHE_FRESH_MS - 1
    expect(cache.load()).toMatchObject({ savedAt: START })
    expect(cache.isFresh(START)).toBe(true)

    now = START + CATALOG_CACHE_FRESH_MS
    expect(cache.load()).toMatchObject({ videos: [baiduVideo('1')] })
    expect(cache.isFresh(START)).toBe(false)
  })

  it('keeps the previous snapshot while recording a request start, then replaces it once', () => {
    let now = START
    const storage = createMemoryStorage()
    const cache = new CatalogCache(storage, { root: ROOT, now: () => now })
    cache.saveSuccessful([baiduVideo('1')])
    const beforeRequest = storage.read<unknown>(CATALOG_CACHE_KEY, null)

    now += CATALOG_REFRESH_COOLDOWN_MS
    expect(cache.beginRequest()).toEqual({ started: true, startedAt: now })
    expect(cache.load()).toEqual({ videos: [baiduVideo('1')], savedAt: START })
    expect(storage.read<Record<string, unknown>>(CATALOG_CACHE_KEY, {})).toMatchObject({
      videos: [baiduVideo('1')],
      savedAt: START,
      requestStartedAt: now
    })
    expect(storage.read(CATALOG_CACHE_KEY, null)).not.toEqual(beforeRequest)

    now += 5_000
    cache.saveSuccessful([baiduVideo('2')])
    expect(cache.load()).toEqual({ videos: [baiduVideo('2')], savedAt: now })
  })

  it('does not replace a valid snapshot if the atomic storage write fails', () => {
    const backing = createMemoryStorage()
    const seed = new CatalogCache(backing, {
      root: ROOT,
      now: () => START
    })
    seed.saveSuccessful([baiduVideo('1')])
    const failingStorage: KeyValueStorage = {
      read: backing.read,
      remove: backing.remove,
      write: () => {
        throw new Error('sentinel-write-failure')
      }
    }
    const cache = new CatalogCache(failingStorage, {
      root: ROOT,
      now: () => START + 1
    })

    expect(() => cache.saveSuccessful([baiduVideo('2')])).toThrow(
      'sentinel-write-failure'
    )
    expect(seed.load()).toEqual({ videos: [baiduVideo('1')], savedAt: START })
  })

  it('persists only the narrow VideoItem fields and never token or dlink extras', () => {
    const storage = createMemoryStorage()
    const cache = new CatalogCache(storage, {
      root: ROOT,
      now: () => START
    })
    const unsafeInput = {
      ...baiduVideo('1'),
      accessToken: 'sentinel-access-token',
      dlink: 'https://d.pcs.baidu.com/file?access_token=sentinel-dlink-token'
    } as VideoItem

    cache.saveSuccessful([unsafeInput])

    const serialized = JSON.stringify(storage.read(CATALOG_CACHE_KEY, null))
    expect(serialized).not.toContain('sentinel')
    expect(serialized).not.toContain('accessToken')
    expect(serialized).not.toContain('dlink')
  })
})

describe('CatalogCache cooldown', () => {
  it('rejects every request during the first sixty seconds, including forced callers', () => {
    let now = START
    const cache = new CatalogCache(createMemoryStorage(), {
      root: ROOT,
      now: () => now
    })

    expect(cache.beginRequest()).toEqual({ started: true, startedAt: START })

    now = START + CATALOG_REFRESH_COOLDOWN_MS - 1
    expect(cache.canRefresh()).toBe(false)
    expect(cache.beginRequest()).toEqual({
      started: false,
      reason: 'cooldown',
      retryAt: START + CATALOG_REFRESH_COOLDOWN_MS
    })

    now = START + CATALOG_REFRESH_COOLDOWN_MS
    expect(cache.canRefresh()).toBe(true)
    expect(cache.beginRequest()).toEqual({ started: true, startedAt: now })
  })

  it('records the request start even before any successful snapshot exists', () => {
    const storage = createMemoryStorage()
    const cache = new CatalogCache(storage, {
      root: ROOT,
      now: () => START
    })

    expect(cache.beginRequest()).toEqual({ started: true, startedAt: START })
    expect(cache.load()).toBeNull()
    expect(storage.read(CATALOG_CACHE_KEY, null)).toEqual({
      videos: [],
      requestStartedAt: START
    })
  })
})

describe('CatalogCache configured root boundary', () => {
  it.each([
    '/apps/其他/sibling.mp4',
    '/apps/片刻2/prefix-lookalike.mp4',
    '/apps/片刻/../其他/traversal.mp4',
    '/apps/片刻/%2e%2e/encoded-traversal.mp4',
    '/apps/片刻/folder%2Fother/encoded-separator.mp4'
  ])('removes a cached video outside the exact configured root: %s', (path) => {
    const storage = createMemoryStorage()
    preserveUnrelatedData(storage)
    storage.write(CATALOG_CACHE_KEY, {
      videos: [{ ...baiduVideo('1'), path }],
      savedAt: START
    })
    const cache = new CatalogCache(storage, {
      root: ROOT,
      now: () => START
    })

    expect(cache.load()).toBeNull()
    expect(storage.read(CATALOG_CACHE_KEY, null)).toBeNull()
    expectUnrelatedDataPreserved(storage)
  })

  it('loads direct and nested files under the exact configured root', () => {
    const storage = createMemoryStorage()
    const directRoot = baiduVideo('1')
    const nested = {
      ...baiduVideo('2'),
      path: `${ROOT}/课程/入门/视频2.mp4`
    }
    storage.write(CATALOG_CACHE_KEY, {
      videos: [directRoot, nested],
      savedAt: START
    })
    const cache = new CatalogCache(storage, {
      root: ROOT,
      now: () => START
    })

    expect(cache.load()).toEqual({
      videos: [directRoot, nested],
      savedAt: START
    })
  })

  it('rejects an out-of-root successful replacement before touching the old snapshot', () => {
    const storage = createMemoryStorage()
    const cache = new CatalogCache(storage, {
      root: ROOT,
      now: () => START
    })
    cache.saveSuccessful([baiduVideo('1')])
    const before = storage.read<unknown>(CATALOG_CACHE_KEY, null)

    expect(() =>
      cache.saveSuccessful([
        {
          ...baiduVideo('2'),
          path: '/apps/其他/outside.mp4'
        }
      ])
    ).toThrow()
    expect(storage.read(CATALOG_CACHE_KEY, null)).toEqual(before)
    expect(cache.load()).toEqual({ videos: [baiduVideo('1')], savedAt: START })
  })

  it.each([
    '/',
    '/apps',
    '/apps/片刻/child',
    '/apps/../片刻',
    '/apps/片刻?debug=1'
  ])('rejects an invalid configured root at construction: %s', (root) => {
    expect(
      () =>
        new CatalogCache(createMemoryStorage(), {
          root,
          now: () => START
        })
    ).toThrow()
  })
})

describe('CatalogCache untrusted storage and isolation', () => {
  it.each([
    null,
    [],
    { videos: 'not-an-array', savedAt: START },
    { videos: [baiduVideo('1')], savedAt: -1 },
    { videos: [baiduVideo('1')], savedAt: START + 1 },
    { videos: [baiduVideo('1')], savedAt: 1.5 },
    { videos: [baiduVideo('1')], requestStartedAt: START + 1 },
    { videos: [baiduVideo('1')], savedAt: START, requestStartedAt: -1 },
    { videos: [baiduVideo('1')], savedAt: START, requestStartedAt: 1.5 },
    {
      videos: [{ ...baiduVideo('1'), sourceType: 'direct' }],
      savedAt: START
    },
    {
      videos: [{ ...baiduVideo('1'), sourceId: '01', id: 'baidu:01' }],
      savedAt: START
    },
    {
      videos: [baiduVideo('1'), baiduVideo('1')],
      savedAt: START
    },
    {
      videos: [{ ...baiduVideo('1'), dlink: 'https://example.test/private' }],
      savedAt: START
    }
  ])('removes one malformed or future cache record without touching other data', (stored) => {
    const storage = createMemoryStorage()
    preserveUnrelatedData(storage)
    storage.write(CATALOG_CACHE_KEY, stored)
    const cache = new CatalogCache(storage, {
      root: ROOT,
      now: () => START
    })

    expect(cache.load()).toBeNull()
    expect(storage.read(CATALOG_CACHE_KEY, null)).toBeNull()
    expectUnrelatedDataPreserved(storage)
  })

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.POSITIVE_INFINITY])(
    'fails closed for an invalid injected clock value: %s',
    (now) => {
      const storage = createMemoryStorage()
      storage.write(CATALOG_CACHE_KEY, {
        videos: [baiduVideo('1')],
        savedAt: START
      })
      preserveUnrelatedData(storage)
      const cache = new CatalogCache(storage, { root: ROOT, now: () => now })

      expect(cache.load()).toBeNull()
      expect(cache.canRefresh()).toBe(false)
      expect(cache.beginRequest()).toEqual({
        started: false,
        reason: 'invalid-clock'
      })
      expectUnrelatedDataPreserved(storage)
    }
  )

  it('clear removes only the catalog cache key', () => {
    const storage = createMemoryStorage()
    preserveUnrelatedData(storage)
    const cache = new CatalogCache(storage, {
      root: ROOT,
      now: () => START
    })
    cache.saveSuccessful([baiduVideo('1')])

    cache.clear()

    expect(storage.read(CATALOG_CACHE_KEY, null)).toBeNull()
    expectUnrelatedDataPreserved(storage)
  })
})

function baiduVideo(sourceId: string): VideoItem {
  return {
    id: `baidu:${sourceId}`,
    sourceType: 'baidu',
    sourceId,
    name: `视频${sourceId}.mp4`,
    path: `/apps/片刻/视频${sourceId}.mp4`,
    sizeBytes: 1_024,
    durationSeconds: 120,
    thumbnailUrl: `https://images.unsplash.com/photo-${sourceId}?auto=format&fit=crop&w=640`,
    modifiedAt: START - Number(sourceId)
  }
}

function preserveUnrelatedData(storage: KeyValueStorage): void {
  storage.write(AUTH_STORAGE_KEY, { keep: 'auth' })
  storage.write(DIRECT_VIDEO_STORAGE_KEY, [{ keep: 'direct' }])
  storage.write(PROGRESS_STORAGE_KEY, [{ keep: 'progress' }])
  storage.write('pianke:unrelated:v1', { keep: true })
}

function expectUnrelatedDataPreserved(storage: KeyValueStorage): void {
  expect(storage.read(AUTH_STORAGE_KEY, null)).toEqual({ keep: 'auth' })
  expect(storage.read(DIRECT_VIDEO_STORAGE_KEY, null)).toEqual([
    { keep: 'direct' }
  ])
  expect(storage.read(PROGRESS_STORAGE_KEY, null)).toEqual([
    { keep: 'progress' }
  ])
  expect(storage.read('pianke:unrelated:v1', null)).toEqual({ keep: true })
}
