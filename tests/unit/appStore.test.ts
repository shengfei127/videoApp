import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { createPinia } from 'pinia'
import { describe, expect, it, vi } from 'vitest'

import type { RuntimeConfig } from '@/config/runtime'
import type { DirectVideoRecord, VideoItem } from '@/domain/video'
import { AuthRepository, AUTH_STORAGE_KEY } from '@/features/auth/authRepository'
import { BaiduError } from '@/features/baidu/baiduErrors'
import {
  CATALOG_CACHE_KEY,
  CATALOG_REFRESH_COOLDOWN_MS,
  CatalogCache
} from '@/features/catalog/catalogCache'
import {
  DIRECT_VIDEO_STORAGE_KEY,
  DirectLinkService
} from '@/features/direct-links/directLinkService'
import { DailyUnlockRepository } from '@/features/daily-unlock/dailyUnlockRepository'
import {
  PROGRESS_STORAGE_KEY,
  ProgressRepository
} from '@/features/playback/progressRepository'
import {
  createMemoryStorage,
  type KeyValueStorage
} from '@/infrastructure/storage'
import {
  bootstrapMocks,
  type BootstrapMocksOptions
} from '@/mocks/bootstrap'
import {
  createAppStore,
  type AppStoreDependencies
} from '@/stores/appStore'

const NOW = 1_800_000_000_000
const CONFIG: RuntimeConfig = {
  baiduAppKey: '',
  baiduAppFolder: '片刻',
  baiduRoot: '/apps/片刻',
  baiduRedirectUri: 'https://localhost/pianke/oauth/baidu',
  useMocks: false
}
const H5_DEVELOPMENT = {
  uniPlatform: 'h5',
  nodeEnv: 'development',
  devServer: true
} as const

describe('app store initialization', () => {
  it('is concurrency-safe and idempotent', async () => {
    const context = createTestContext('initialize-concurrent')
    context.authRepository.saveSession(validSession())
    const page = deferred<VideoItem[]>()
    context.listPage.mockReturnValue(page.promise)

    const first = context.store.initialize()
    const second = context.store.initialize()

    expect(context.listPage).toHaveBeenCalledOnce()
    expect(context.store.syncStatus).toBe('syncing')

    page.resolve([])
    await Promise.all([first, second])
    await context.store.initialize()

    expect(context.listPage).toHaveBeenCalledOnce()
    expect(context.store.initialized).toBe(true)
  })

  it('loads valid local data and skips the provider for a fresh cache', async () => {
    const context = createTestContext('initialize-fresh')
    context.authRepository.saveSession(validSession())
    context.directLinkService.add({
      name: '直播',
      url: 'https://media.example/live.m3u8'
    })
    context.progressRepository.save('baidu:1', 120, 600, NOW - 50)
    context.cache.saveSuccessful([baiduVideo('1', NOW - 100)])

    await context.store.initialize()

    expect(context.store.authSession).toEqual(validSession())
    expect(context.store.baiduVideos).toEqual([baiduVideo('1', NOW - 100)])
    expect(context.store.baiduCacheSavedAt).toBe(NOW)
    expect(context.store.directRecords).toHaveLength(1)
    expect(context.store.progressHistory).toHaveLength(1)
    expect(context.store.resumableProgress).toHaveLength(1)
    expect(context.listPage).not.toHaveBeenCalled()
  })

  it('keeps a stale cache visible while initialization refreshes it', async () => {
    const context = createTestContext('initialize-stale')
    context.authRepository.saveSession(validSession())
    context.cache.saveSuccessful([baiduVideo('1', NOW - 1_000)])
    context.advance(15 * 60 * 1000)
    const page = deferred<VideoItem[]>()
    context.listPage.mockReturnValue(page.promise)

    const initialization = context.store.initialize()

    expect(context.store.baiduVideos.map((video) => video.sourceId)).toEqual(['1'])
    expect(context.store.baiduCacheSavedAt).toBe(NOW)
    expect(context.store.syncStatus).toBe('syncing')

    page.resolve([baiduVideo('2', context.now())])
    await initialization

    expect(context.store.baiduVideos.map((video) => video.sourceId)).toEqual(['2'])
    expect(context.store.baiduCacheSavedAt).toBe(context.now())
  })

  it('never requests Baidu without a valid session', async () => {
    const context = createTestContext('initialize-no-session')
    context.cache.saveSuccessful([baiduVideo('1', NOW - 1_000)])
    context.advance(15 * 60 * 1000)

    await context.store.initialize()

    expect(context.store.authSession).toBeNull()
    expect(context.store.baiduVideos).toHaveLength(1)
    expect(context.listPage).not.toHaveBeenCalled()
  })

  it('clears only expired auth and preserves cached, direct, and progress data', async () => {
    const context = createTestContext('initialize-expired-auth')
    context.authRepository.saveSession(validSession(NOW))
    context.directLinkService.add({
      name: '直播',
      url: 'https://media.example/live.m3u8'
    })
    context.progressRepository.save('baidu:1', 120, 600, NOW - 50)
    context.cache.saveSuccessful([baiduVideo('1', NOW - 100)])

    await context.store.initialize()

    expect(context.store.authSession).toBeNull()
    expect(context.storage.read(AUTH_STORAGE_KEY, null)).toBeNull()
    expect(context.store.baiduVideos).toHaveLength(1)
    expect(context.store.directRecords).toHaveLength(1)
    expect(context.store.progressHistory).toHaveLength(1)
    expect(context.listPage).not.toHaveBeenCalled()
  })

  it('keeps valid local slices visible when another repository throws', async () => {
    const context = createTestContext('initialize-partial-failure', {
      authRepository: {
        getValidSession: () => {
          throw new Error('sentinel-auth-storage-failure')
        },
        clearSession: vi.fn()
      }
    })
    context.directLinkService.add({
      name: '直播',
      url: 'https://media.example/live.m3u8'
    })
    context.progressRepository.save('baidu:1', 120, 600, NOW - 50)
    context.cache.saveSuccessful([baiduVideo('1', NOW - 100)])

    await expect(context.store.initialize()).resolves.toBeUndefined()

    expect(context.store.baiduVideos).toHaveLength(1)
    expect(context.store.directRecords).toHaveLength(1)
    expect(context.store.progressHistory).toHaveLength(1)
    expect(context.store.lastError).toMatchObject({ code: 'initialization' })
    expect(JSON.stringify(context.store.lastError)).not.toContain('sentinel')
  })
})

describe('app store Baidu synchronization', () => {
  it('paginates sequentially, deduplicates sourceId, and replaces cache after completion', async () => {
    const context = createTestContext('sync-pagination')
    context.authRepository.saveSession(validSession())
    context.cache.saveSuccessful([baiduVideo('9000', NOW - 500)])
    await context.store.initialize()
    context.listPage.mockReset()
    const firstPage = Array.from({ length: 1000 }, (_, index) =>
      baiduVideo(String(index + 1), NOW - index)
    )
    context.listPage
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce([
        baiduVideo('1000', NOW - 1000),
        baiduVideo('1001', NOW - 1001)
      ])

    const result = await context.store.syncBaidu(true)

    expect(result).toEqual({
      ok: true,
      refreshed: true,
      count: 1001,
      savedAt: NOW
    })
    expect(context.listPage.mock.calls).toEqual([
      ['private-placeholder-token', 1],
      ['private-placeholder-token', 2]
    ])
    expect(context.store.baiduVideos).toHaveLength(1001)
    expect(context.cache.load()?.videos).toHaveLength(1001)
    expect(context.store.syncStatus).toBe('success')
  })

  it('preserves the previous snapshot atomically when a later page fails', async () => {
    const context = createTestContext('sync-atomic-failure')
    context.authRepository.saveSession(validSession())
    context.cache.saveSuccessful([baiduVideo('9000', NOW - 500)])
    await context.store.initialize()
    context.listPage.mockReset()
    context.advance(CATALOG_REFRESH_COOLDOWN_MS)
    context.listPage
      .mockResolvedValueOnce(
        Array.from({ length: 1000 }, (_, index) =>
          baiduVideo(String(index + 1), context.now() - index)
        )
      )
      .mockRejectedValueOnce(
        new Error(
          'sentinel-page-two-error access_token=private-placeholder-token'
        )
      )

    const result = await context.store.syncBaidu(true)

    expect(result).toEqual({ ok: false, reason: 'failed' })
    expect(context.store.baiduVideos.map((video) => video.sourceId)).toEqual([
      '9000'
    ])
    expect(context.store.baiduCacheSavedAt).toBe(NOW)
    expect(context.cache.load()).toMatchObject({
      videos: [{ sourceId: '9000' }],
      savedAt: NOW
    })
    expect(context.store.syncStatus).toBe('error')
    expect(JSON.stringify(context.store.lastError)).not.toContain('sentinel')
    expect(JSON.stringify(context.store.lastError)).not.toContain('access_token')
  })

  it('returns typed non-success results for no session, active sync, and cooldown', async () => {
    const noSession = createTestContext('sync-no-session')
    expect(await noSession.store.syncBaidu(true)).toEqual({
      ok: false,
      reason: 'no-session'
    })
    expect(noSession.listPage).not.toHaveBeenCalled()

    const active = createTestContext('sync-active')
    active.authRepository.saveSession(validSession())
    await active.store.initialize()
    active.listPage.mockReset()
    active.advance(CATALOG_REFRESH_COOLDOWN_MS)
    const page = deferred<VideoItem[]>()
    active.listPage.mockReturnValue(page.promise)
    const first = active.store.syncBaidu(true)
    expect(await active.store.syncBaidu(true)).toEqual({
      ok: false,
      reason: 'active'
    })
    page.resolve([])
    await first

    const cooldown = createTestContext('sync-cooldown')
    cooldown.authRepository.saveSession(validSession())
    cooldown.listPage.mockResolvedValue([])
    await cooldown.store.initialize()
    expect(await cooldown.store.syncBaidu(true)).toEqual({
      ok: false,
      reason: 'cooldown',
      retryAt: NOW + CATALOG_REFRESH_COOLDOWN_MS
    })
    expect(cooldown.listPage).toHaveBeenCalledOnce()
  })

  it('allows a forced refresh exactly sixty seconds after request start', async () => {
    const context = createTestContext('sync-cooldown-boundary')
    context.authRepository.saveSession(validSession())
    context.listPage.mockResolvedValue([])
    await context.store.initialize()

    context.advance(CATALOG_REFRESH_COOLDOWN_MS - 1)
    expect(await context.store.syncBaidu(true)).toMatchObject({
      ok: false,
      reason: 'cooldown'
    })

    context.advance(1)
    expect(await context.store.syncBaidu(true)).toMatchObject({
      ok: true,
      refreshed: true
    })
    expect(context.listPage).toHaveBeenCalledTimes(2)
  })

  it('stops a malformed repeated full page without looping or persisting partial data', async () => {
    const context = createTestContext('sync-repeated-page')
    context.authRepository.saveSession(validSession())
    context.cache.saveSuccessful([baiduVideo('9000', NOW - 500)])
    await context.store.initialize()
    context.listPage.mockReset()
    context.advance(CATALOG_REFRESH_COOLDOWN_MS)
    const repeated = Array.from({ length: 1000 }, (_, index) =>
      baiduVideo(String(index + 1), context.now() - index)
    )
    context.listPage.mockResolvedValue(repeated)

    const result = await context.store.syncBaidu(true)

    expect(result).toEqual({ ok: false, reason: 'failed' })
    expect(context.listPage).toHaveBeenCalledTimes(2)
    expect(context.store.baiduVideos.map((video) => video.sourceId)).toEqual([
      '9000'
    ])
    expect(context.cache.load()?.videos.map((video) => video.sourceId)).toEqual([
      '9000'
    ])
  })

  it('aborts a full page with any cross-page overlap before requesting another page', async () => {
    const context = createTestContext('sync-overlapping-page')
    context.authRepository.saveSession(validSession())
    context.cache.saveSuccessful([baiduVideo('9000', NOW - 500)])
    await context.store.initialize()
    context.listPage.mockReset()
    const firstPage = fullBaiduPage(1)
    const secondPage = [
      ...firstPage.slice(0, 999),
      baiduVideo('1001', NOW - 1001)
    ]
    context.listPage
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce(secondPage)
      .mockResolvedValueOnce([])

    const result = await context.store.syncBaidu(true)

    expect(result).toEqual({ ok: false, reason: 'failed' })
    expect(context.listPage).toHaveBeenCalledTimes(2)
    expect(context.store.baiduVideos.map((video) => video.sourceId)).toEqual([
      '9000'
    ])
    expect(context.cache.load()?.videos.map((video) => video.sourceId)).toEqual([
      '9000'
    ])
  })

  it('stops at one hundred unique full pages without issuing page 101', async () => {
    const context = createTestContext('sync-page-bound')
    context.authRepository.saveSession(validSession())
    context.cache.saveSuccessful([baiduVideo('9000', NOW - 500)])
    await context.store.initialize()
    context.listPage.mockReset()
    context.listPage.mockImplementation(async (_token, page: number) => {
      if (page > 100) {
        throw new Error('sentinel-page-101-requested')
      }
      return fullBaiduPage(page)
    })

    const result = await context.store.syncBaidu(true)

    expect(result).toEqual({ ok: false, reason: 'failed' })
    expect(context.listPage).toHaveBeenCalledTimes(100)
    expect(context.listPage).toHaveBeenLastCalledWith(
      'private-placeholder-token',
      100
    )
    expect(context.store.baiduVideos.map((video) => video.sourceId)).toEqual([
      '9000'
    ])
    expect(JSON.stringify(context.store.lastError)).not.toContain('sentinel')
  })

  it('clears only auth on authorization failure and keeps every local data slice', async () => {
    const context = createTestContext('sync-authorization-error')
    context.authRepository.saveSession(validSession())
    context.directLinkService.add({
      name: '直播',
      url: 'https://media.example/live.m3u8'
    })
    context.progressRepository.save('baidu:1', 120, 600, NOW - 50)
    context.cache.saveSuccessful([baiduVideo('1', NOW - 100)])
    await context.store.initialize()
    context.listPage.mockReset()
    context.advance(CATALOG_REFRESH_COOLDOWN_MS)
    context.listPage.mockRejectedValue(new BaiduError('authorization', 110))

    const result = await context.store.syncBaidu(true)

    expect(result).toEqual({ ok: false, reason: 'authorization' })
    expect(context.store.authSession).toBeNull()
    expect(context.storage.read(AUTH_STORAGE_KEY, null)).toBeNull()
    expect(context.store.baiduVideos).toHaveLength(1)
    expect(context.store.directRecords).toHaveLength(1)
    expect(context.store.progressHistory).toHaveLength(1)
    expect(context.store.lastError).toMatchObject({ code: 'authorization' })
  })

  it('ignores an old authorization failure after disconnecting and loading a new session', async () => {
    const context = createTestContext('sync-superseded-authorization')
    const replacementSession = {
      ...validSession(),
      accessToken: 'replacement-token'
    }
    context.authRepository.saveSession(validSession())
    context.cache.saveSuccessful([baiduVideo('1', NOW)])
    await context.store.initialize()
    context.listPage.mockReset()
    const page = deferred<VideoItem[]>()
    context.listPage.mockReturnValue(page.promise)
    const clearSession = vi.spyOn(context.authRepository, 'clearSession')

    const oldRequest = context.store.syncBaidu(true)
    expect(context.store.disconnectBaidu()).toBe(true)
    context.authRepository.saveSession(replacementSession)
    expect(context.store.reloadAuthSession()).toEqual(replacementSession)

    page.reject(new BaiduError('authorization', 110))

    await expect(oldRequest).resolves.toEqual({
      ok: false,
      reason: 'superseded'
    })
    expect(clearSession).toHaveBeenCalledOnce()
    expect(context.store.authSession).toEqual(replacementSession)
    expect(context.storage.read(AUTH_STORAGE_KEY, null)).toEqual(
      replacementSession
    )
    expect(context.store.syncStatus).toBe('idle')
    expect(context.store.lastError).toBeNull()
  })

  it('does not restore catalog data when an old success returns after cache clear', async () => {
    const context = createTestContext('sync-superseded-cache-clear')
    context.authRepository.saveSession(validSession())
    context.cache.saveSuccessful([baiduVideo('1', NOW)])
    await context.store.initialize()
    context.listPage.mockReset()
    const page = deferred<VideoItem[]>()
    context.listPage.mockReturnValue(page.promise)

    const oldRequest = context.store.syncBaidu(true)
    expect(context.store.clearCatalogCache()).toBe(true)
    page.resolve([baiduVideo('2', NOW)])

    await expect(oldRequest).resolves.toEqual({
      ok: false,
      reason: 'superseded'
    })
    expect(context.cache.load()).toBeNull()
    expect(context.store.baiduVideos).toEqual([])
    expect(context.store.baiduCacheSavedAt).toBeNull()
    expect(context.store.syncStatus).toBe('idle')
    expect(context.store.lastError).toBeNull()
  })

  it('keeps a replacement session catalog when the old success returns later', async () => {
    const context = createTestContext('sync-superseded-session-reload')
    const replacementSession = {
      ...validSession(),
      accessToken: 'replacement-token'
    }
    const replacementVideo = baiduVideo('2', NOW)
    context.authRepository.saveSession(validSession())
    context.cache.saveSuccessful([baiduVideo('1', NOW)])
    await context.store.initialize()
    context.listPage.mockReset()
    const oldPage = deferred<VideoItem[]>()
    context.listPage
      .mockReturnValueOnce(oldPage.promise)
      .mockResolvedValueOnce([replacementVideo])

    const oldRequest = context.store.syncBaidu(true)
    context.authRepository.saveSession(replacementSession)
    expect(context.store.reloadAuthSession()).toEqual(replacementSession)
    context.advance(CATALOG_REFRESH_COOLDOWN_MS)

    const replacementResult = await context.store.syncBaidu(true)
    oldPage.resolve([baiduVideo('3', NOW)])
    const oldResult = await oldRequest

    expect(replacementResult).toMatchObject({
      ok: true,
      refreshed: true,
      count: 1
    })
    expect(oldResult).toEqual({ ok: false, reason: 'superseded' })
    expect(context.listPage.mock.calls).toEqual([
      ['private-placeholder-token', 1],
      ['replacement-token', 1]
    ])
    expect(context.store.authSession).toEqual(replacementSession)
    expect(context.store.baiduVideos).toEqual([replacementVideo])
    expect(context.cache.load()?.videos).toEqual([replacementVideo])
    expect(context.store.syncStatus).toBe('success')
    expect(context.store.lastError).toBeNull()
  })
})

describe('app store sync state transitions', () => {
  it('clears a stale error immediately for an accepted request and keeps active state stable', async () => {
    const context = createTestContext('state-accepted-active')
    context.authRepository.saveSession(validSession())
    context.cache.saveSuccessful([baiduVideo('1', NOW)])
    await context.store.initialize()
    context.listPage.mockReset()
    setStaleSyncError(context)
    const page = deferred<VideoItem[]>()
    context.listPage.mockReturnValue(page.promise)

    const activeRequest = context.store.syncBaidu(true)

    expect(context.store.syncStatus).toBe('syncing')
    expect(context.store.lastError).toBeNull()
    expect(await context.store.syncBaidu(true)).toEqual({
      ok: false,
      reason: 'active'
    })
    expect(context.store.syncStatus).toBe('syncing')
    expect(context.store.lastError).toBeNull()

    page.resolve([])
    await expect(activeRequest).resolves.toMatchObject({ ok: true })
    expect(context.store.syncStatus).toBe('success')
    expect(context.store.lastError).toBeNull()
  })

  it('turns a fresh-cache non-refresh into defined success and clears stale sync error', async () => {
    const context = createTestContext('state-fresh')
    context.authRepository.saveSession(validSession())
    context.cache.saveSuccessful([baiduVideo('1', NOW)])
    await context.store.initialize()
    setStaleSyncError(context)

    const result = await context.store.syncBaidu(false)

    expect(result).toMatchObject({ ok: true, refreshed: false })
    expect(context.store.syncStatus).toBe('success')
    expect(context.store.lastError).toBeNull()
    expect(context.listPage).not.toHaveBeenCalled()
  })

  it('sets cooldown state and retryAt without retaining a stale generic error', async () => {
    const context = createTestContext('state-cooldown')
    context.authRepository.saveSession(validSession())
    context.listPage.mockResolvedValue([])
    await context.store.initialize()
    setStaleSyncError(context)

    const result = await context.store.syncBaidu(true)

    expect(result).toEqual({
      ok: false,
      reason: 'cooldown',
      retryAt: NOW + CATALOG_REFRESH_COOLDOWN_MS
    })
    expect(context.store.syncStatus).toBe('cooldown')
    expect(context.store.nextSyncAllowedAt).toBe(
      NOW + CATALOG_REFRESH_COOLDOWN_MS
    )
    expect(context.store.lastError).toBeNull()
  })

  it('returns idle with no error when no session ever existed', async () => {
    const context = createTestContext('state-no-session')
    setStaleSyncError(context)

    expect(await context.store.syncBaidu(true)).toEqual({
      ok: false,
      reason: 'no-session'
    })
    expect(context.store.syncStatus).toBe('idle')
    expect(context.store.lastError).toBeNull()
  })

  it('treats a session that expires after initialization as authorization failure', async () => {
    const context = createTestContext('state-expired-session')
    context.authRepository.saveSession(validSession(NOW + 1000))
    context.cache.saveSuccessful([baiduVideo('1', NOW)])
    await context.store.initialize()
    context.advance(1000)
    setStaleSyncError(context)

    expect(await context.store.syncBaidu(true)).toEqual({
      ok: false,
      reason: 'authorization'
    })
    expect(context.store.authSession).toBeNull()
    expect(context.store.syncStatus).toBe('error')
    expect(context.store.lastError).toMatchObject({ code: 'authorization' })
  })

  it('makes mock success clear stale state while mock error remains explicit', async () => {
    const success = createTestContext('state-mock-success', {
      config: { ...CONFIG, useMocks: true },
      bootstrapMocks,
      mockScenario: 'resume',
      mockEnvironment: H5_DEVELOPMENT
    })
    await success.store.initialize()
    setStaleSyncError(success)

    expect(await success.store.syncBaidu(true)).toMatchObject({
      ok: true,
      refreshed: false
    })
    expect(success.store.syncStatus).toBe('success')
    expect(success.store.lastError).toBeNull()

    const failure = createTestContext('state-mock-failure', {
      config: { ...CONFIG, useMocks: true },
      bootstrapMocks,
      mockScenario: 'baidu-error',
      mockEnvironment: H5_DEVELOPMENT
    })
    await failure.store.initialize()

    expect(await failure.store.syncBaidu(true)).toEqual({
      ok: false,
      reason: 'failed'
    })
    expect(failure.store.syncStatus).toBe('error')
    expect(failure.store.lastError).toMatchObject({ code: 'sync-failed' })
  })

  it('resets stale sync state after disconnect or catalog clear', async () => {
    const disconnected = createTestContext('state-disconnect')
    disconnected.authRepository.saveSession(validSession())
    disconnected.cache.saveSuccessful([baiduVideo('1', NOW)])
    await disconnected.store.initialize()
    setStaleSyncError(disconnected)

    disconnected.store.disconnectBaidu()

    expect(disconnected.store.syncStatus).toBe('idle')
    expect(disconnected.store.lastError).toBeNull()

    const cleared = createTestContext('state-cache-clear')
    cleared.cache.saveSuccessful([baiduVideo('1', NOW)])
    await cleared.store.initialize()
    setStaleSyncError(cleared)

    cleared.store.clearCatalogCache()

    expect(cleared.store.syncStatus).toBe('idle')
    expect(cleared.store.lastError).toBeNull()
  })
})

describe('app store daily unlock settings', () => {
  it('updates course rate and pauses without relocking released lessons', async () => {
    const context = createTestContext('edit-course')
    await context.store.initialize()
    const result = context.store.createDailyUnlockCourse({
      name: '课程', dailyEpisodeCount: 2,
      episodes: Array.from({ length: 8 }, (_, i) => ({ videoId: `direct:${i}`, name: `第${i + 1}课`, sourceType: 'direct' as const }))
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    context.store.setDailyUnlockEnabled(true)
    expect(context.store.videoUnlockStatus('direct:1').locked).toBe(false)
    expect(context.store.updateDailyUnlockCourse(result.course.id, { name: '新课程', dailyEpisodeCount: 1 })).toBe(true)
    expect(context.store.videoUnlockStatus('direct:1').locked).toBe(false)
    expect(context.store.updateDailyUnlockCourse(result.course.id, { paused: true })).toBe(true)
    context.advance(3 * 86_400_000)
    context.store.refreshDailyUnlockClock()
    expect(context.store.videoUnlockStatus('direct:2').locked).toBe(true)
    expect(context.store.updateDailyUnlockCourse(result.course.id, { paused: false })).toBe(true)
    expect(context.store.videoUnlockStatus('direct:2').locked).toBe(true)
    context.advance(86_400_000)
    context.store.refreshDailyUnlockClock()
    expect(context.store.videoUnlockStatus('direct:2').locked).toBe(false)
    expect(context.store.videoUnlockStatus('direct:3').locked).toBe(true)
    expect(new DailyUnlockRepository(context.storage).load().courses[0]).toMatchObject({ name: '新课程', dailyEpisodeCount: 1 })
    expect(context.store.updateDailyUnlockCourse(result.course.id, { dailyEpisodeCount: 0 })).toBe(false)
    const confirmed = JSON.parse(JSON.stringify(context.store.dailyUnlockSettings))
    vi.spyOn(context.storage, 'write').mockImplementation(() => { throw new Error('storage') })
    expect(context.store.updateDailyUnlockCourse(result.course.id, { name: '不能保存' })).toBe(false)
    expect(context.store.dailyUnlockSettings).toEqual(confirmed)
  })

  it('manually completes and restores a learned lesson with durable progress', async () => {
    const context = createTestContext('manual-completion')
    await context.store.initialize()
    context.store.createDailyUnlockCourse({ name: '课程', episodes: [
      { videoId: 'direct:first', name: '第一课', sourceType: 'direct' },
      { videoId: 'direct:locked', name: '第二课', sourceType: 'direct' }
    ] })
    context.store.setDailyUnlockEnabled(true)
    expect(context.store.markVideoLearned('direct:locked', true)).toBe(false)
    expect(context.store.markVideoLearned('missing', true)).toBe(false)
    expect(context.store.markVideoLearned('direct:first', true)).toBe(true)
    expect(context.store.progressHistory[0]).toMatchObject({ videoId: 'direct:first', completed: true, durationSeconds: 0 })
    expect(context.progressRepository.get('direct:first')?.completed).toBe(true)
    expect(context.store.markVideoLearned('direct:first', false)).toBe(true)
    expect(context.store.progressHistory[0]?.completed).toBe(false)
    const previous = structuredClone(context.progressRepository.listHistory())
    vi.spyOn(context.progressRepository, 'setCompleted').mockImplementation(() => { throw new Error('storage') })
    expect(context.store.markVideoLearned('direct:first', true)).toBe(false)
    expect(context.store.progressHistory).toEqual(previous)
  })

  it('restores courses after restart and keeps them through cache and history clearing', async () => {
    const context = createTestContext('daily-unlock-restart')
    await context.store.initialize()
    expect(context.store.createDailyUnlockCourse({
      name: '保留课程',
      episodes: [
        { videoId: 'baidu:1', name: '第1集.mp4', sourceType: 'baidu', path: '/apps/片刻/第1集.mp4' },
        { videoId: 'baidu:2', name: '第2集.mp4', sourceType: 'baidu', path: '/apps/片刻/第2集.mp4' }
      ]
    }).ok).toBe(true)
    expect(context.store.setDailyUnlockEnabled(true)).toBe(true)
    const expected = JSON.parse(JSON.stringify(context.store.dailyUnlockSettings))
    const restored = createTestContext('daily-unlock-restored', {
      dailyUnlockRepository: new DailyUnlockRepository(context.storage)
    })
    await restored.store.initialize()
    expect(restored.store.dailyUnlockSettings).toEqual(expected)
    expect(restored.store.videoUnlockStatus('baidu:2').locked).toBe(true)
    expect(restored.store.clearCatalogCache()).toBe(true)
    expect(restored.store.clearProgress()).toBe(true)
    expect(restored.store.dailyUnlockSettings).toEqual(expected)
    expect(context.storage.read('pianke:daily-unlock:v1', null)).toEqual(expected)
  })

  it('stores direct course episodes without copying signed media URLs', async () => {
    const context = createTestContext('daily-unlock-direct-snapshot')
    await context.store.initialize()

    const result = context.store.createDailyUnlockCourse({
      name: '短期课程',
      episodes: [
        {
          videoId: 'direct:lesson-1',
          name: '第1课.m3u8',
          sourceType: 'direct',
          path: 'https://media.example/lesson.m3u8?sign=private-value'
        }
      ]
    })

    expect(result.ok).toBe(true)
    expect(JSON.stringify(context.storage.read('pianke:daily-unlock:v1', null)))
      .not.toContain('private-value')
    expect(context.store.dailyUnlockSettings.courses[0]?.episodes[0]).toEqual({
      videoId: 'direct:lesson-1',
      name: '第1课.m3u8',
      sourceType: 'direct'
    })
  })

  it('persists the switch and course, detects conflicts, and releases locks after deletion', async () => {
    const context = createTestContext('daily-unlock-course-state')
    await context.store.initialize()

    expect(context.store.dailyUnlockSettings).toEqual({ enabled: false, courses: [] })
    expect(context.store.setDailyUnlockEnabled(true)).toBe(true)
    const first = context.store.createDailyUnlockCourse({
      name: '第1季',
      episodes: [
        { videoId: 'baidu:lesson-1', name: '第1集.mp4', sourceType: 'baidu', path: '/apps/片刻/第1集.mp4' },
        { videoId: 'baidu:lesson-2', name: '第2集.mp4', sourceType: 'baidu', path: '/apps/片刻/第2集.mp4' }
      ]
    })

    expect(first.ok).toBe(true)
    expect(context.store.dailyUnlockSettings.enabled).toBe(true)
    expect(context.store.videoUnlockStatus('baidu:lesson-1').locked).toBe(false)
    expect(context.store.videoUnlockStatus('baidu:lesson-2')).toMatchObject({
      locked: true,
      episodeNumber: 2,
      courseName: '第1季'
    })
    expect(context.store.createDailyUnlockCourse({
      name: '重复课程',
      episodes: [{ videoId: 'baidu:lesson-2', name: '重复.mp4', sourceType: 'baidu', path: '/apps/片刻/重复.mp4' }]
    })).toEqual({ ok: false, reason: 'conflict' })

    expect(context.store.setDailyUnlockEnabled(false)).toBe(true)
    expect(context.store.dailyUnlockSettings.courses).toHaveLength(1)
    expect(context.store.videoUnlockStatus('baidu:lesson-2').locked).toBe(false)
    expect(context.store.setDailyUnlockEnabled(true)).toBe(true)
    const courseId = context.store.dailyUnlockSettings.courses[0]!.id
    expect(context.store.deleteDailyUnlockCourse(courseId)).toBe(true)
    expect(context.store.dailyUnlockSettings.courses).toEqual([])
    expect(context.store.videoUnlockStatus('baidu:lesson-2')).toEqual({ locked: false })
    expect(context.storage.read('pianke:daily-unlock:v1', null)).toEqual({
      enabled: true,
      courses: []
    })
  })

  it('keeps the confirmed state when local daily-unlock persistence fails', async () => {
    const save = vi.fn(() => { throw new Error('sentinel-storage-error') })
    const context = createTestContext('daily-unlock-persistence-failure', {
      dailyUnlockRepository: {
        load: () => ({ enabled: false, courses: [] }),
        save
      }
    })
    await context.store.initialize()

    expect(context.store.setDailyUnlockEnabled(true)).toBe(false)
    expect(context.store.dailyUnlockSettings).toEqual({ enabled: false, courses: [] })
    expect(context.store.createDailyUnlockCourse({
      name: '保存失败',
      episodes: [{ videoId: 'direct:one', name: '第一课.mp4', sourceType: 'direct' }]
    })).toEqual({ ok: false, reason: 'storage' })
    expect(context.store.dailyUnlockSettings.courses).toEqual([])
    expect(save).toHaveBeenCalledTimes(2)
  })
})
describe('app store derived catalog', () => {
  it('deduplicates watched videos using the most recent history entry', () => {
    const { store } = createTestContext('recent-history-deduplication')
    store.baiduVideos = [baiduVideo('1', NOW), baiduVideo('2', NOW)]
    store.progressHistory = [
      { videoId: 'baidu:1', positionSeconds: 10, durationSeconds: 600, updatedAt: NOW - 20, completed: false },
      { videoId: 'baidu:2', positionSeconds: 20, durationSeconds: 600, updatedAt: NOW - 10, completed: false },
      { videoId: 'baidu:1', positionSeconds: 30, durationSeconds: 600, updatedAt: NOW, completed: false }
    ]
    expect(store.recentVideos.map(({ id }) => id)).toEqual(['baidu:1', 'baidu:2'])
  })

  it('reuses a pre-normalized search index when only the query changes', () => {
    const context = createTestContext('getters-search-index')
    const videos = [
      baiduVideo('1', NOW),
      baiduVideo('2', NOW - 1)
    ]
    const catalogStrings = new Set(
      videos.flatMap((video) => [video.name, video.path])
    )
    const original = String.prototype.toLocaleLowerCase
    let catalogNormalizations = 0
    vi.spyOn(String.prototype, 'toLocaleLowerCase').mockImplementation(
      function (this: string, locales?: Intl.LocalesArgument) {
        const value = String(this)
        if (catalogStrings.has(value)) {
          catalogNormalizations += 1
        }
        return original.call(value, locales)
      }
    )
    context.store.baiduVideos = videos

    context.store.searchQuery = '视频1'
    expect(context.store.searchResults).toHaveLength(1)
    expect(catalogNormalizations).toBe(4)

    context.store.searchQuery = '视频2'
    expect(context.store.searchResults).toHaveLength(1)
    expect(catalogNormalizations).toBe(4)

    const thirdVideo = baiduVideo('3', NOW - 2)
    catalogStrings.add(thirdVideo.name)
    catalogStrings.add(thirdVideo.path)
    context.store.baiduVideos = [...videos, thirdVideo]
    expect(context.store.searchResults).toHaveLength(1)
    expect(catalogNormalizations).toBe(10)
  })

  it('never exposes a tampered cached video outside the configured Baidu root', async () => {
    const context = createTestContext('getters-tampered-cache')
    const outside = {
      ...baiduVideo('1', NOW - 100),
      path: '/apps/其他/泄漏.mp4'
    }
    context.storage.write(CATALOG_CACHE_KEY, {
      root: CONFIG.baiduRoot,
      videos: [outside],
      savedAt: NOW
    })

    await context.store.initialize()

    expect(context.store.baiduVideos).toEqual([])
    expect(context.store.mergedVideos).toEqual([])
    expect(context.store.recentVideos).toEqual([])
    context.store.searchQuery = '泄漏'
    expect(context.store.searchResults).toEqual([])
    expect(context.store.folderTree.videos).toEqual([])
    expect(context.store.folderTree.folders).toEqual([])
    expect(context.storage.read(CATALOG_CACHE_KEY, null)).toBeNull()
  })

  it('normalizes direct records and merges both sources without mutating repository data', async () => {
    const context = createTestContext('getters-merged')
    const direct = context.directLinkService.add({
      name: '城市直播',
      url: 'https://media.example/live.m3u8'
    })
    const originalDirect = structuredClone(direct)
    context.cache.saveSuccessful([baiduVideo('1', NOW - 100)])

    await context.store.initialize()

    expect(context.store.mergedVideos).toEqual(
      expect.arrayContaining([
        baiduVideo('1', NOW - 100),
        {
          id: `direct:${direct.id}`,
          sourceType: 'direct',
          sourceId: direct.id,
          name: direct.name,
          path: direct.url,
          modifiedAt: direct.addedAt
        }
      ])
    )
    expect(context.store.directRecords[0]).toEqual(originalDirect)
    expect(direct).toEqual(originalDirect)
  })

  it('shows only watched catalog videos in recentVideos while preserving the complete catalog list', async () => {
    const context = createTestContext('getters-recent-history')
    context.storage.write(DIRECT_VIDEO_STORAGE_KEY, [
      directRecord('watched', '看过的直播.mp4', NOW - 300)
    ])
    context.cache.saveSuccessful([
      { ...baiduVideo('10', NOW), name: '未看过.mp4' },
      { ...baiduVideo('11', NOW - 100), name: '看过的旧视频.mp4' }
    ])
    context.progressRepository.save('baidu:11', 10, 600, NOW - 50)
    context.progressRepository.save('direct:watched', 600, 600, NOW - 10)
    context.progressRepository.save('baidu:99', 120, 600, NOW)

    await context.store.initialize()

    expect(context.store.recentVideos.map((video) => video.id)).toEqual([
      'direct:watched', 'baidu:11'
    ])
    expect(context.store.catalogRecentVideos.map((video) => video.id)).toEqual([
      'baidu:10', 'baidu:11', 'direct:watched'
    ])
  })
  it('joins only resumable progress to existing videos and sorts by progress time', async () => {
    const context = createTestContext('getters-continue')
    context.storage.write(DIRECT_VIDEO_STORAGE_KEY, [
      directRecord('live', '直播.m3u8', NOW - 300)
    ])
    context.cache.saveSuccessful([
      baiduVideo('1', NOW - 100),
      baiduVideo('2', NOW - 200)
    ])
    context.progressRepository.save('baidu:1', 120, 600, NOW - 30)
    context.progressRepository.save('direct:live', 180, 600, NOW - 10)
    context.progressRepository.save('orphan', 240, 600, NOW)
    context.progressRepository.save('baidu:2', 10, 600, NOW - 5)

    await context.store.initialize()

    expect(
      context.store.continueWatching.map(({ video, progress }) => ({
        videoId: video.id,
        progressVideoId: progress.videoId,
        updatedAt: progress.updatedAt
      }))
    ).toEqual([
      {
        videoId: 'direct:live',
        progressVideoId: 'direct:live',
        updatedAt: NOW - 10
      },
      {
        videoId: 'baidu:1',
        progressVideoId: 'baidu:1',
        updatedAt: NOW - 30
      }
    ])
  })

  it('searches local name and path case-insensitively and treats whitespace as recent', async () => {
    const context = createTestContext('getters-search')
    context.storage.write(DIRECT_VIDEO_STORAGE_KEY, [
      directRecord(
        'live',
        'Evening LIVE.m3u8',
        NOW,
        'https://media.example/Channels/City.m3u8'
      )
    ])
    context.cache.saveSuccessful([
      {
        ...baiduVideo('1', NOW - 100),
        name: '中文课程.mp4',
        path: `${CONFIG.baiduRoot}/专题/中文课程.mp4`
      }
    ])

    await context.store.initialize()
    context.store.searchQuery = '  channels/city  '
    expect(context.store.searchResults.map((video) => video.id)).toEqual([
      'direct:live'
    ])

    context.store.searchQuery = 'evening live'
    expect(context.store.searchResults.map((video) => video.id)).toEqual([
      'direct:live'
    ])

    context.store.searchQuery = '  中文  '
    expect(context.store.searchResults.map((video) => video.id)).toEqual([
      'baidu:1'
    ])

    context.store.searchQuery = '   '
    expect(context.store.searchResults.map((video) => video.id)).toEqual(
      context.store.catalogRecentVideos.map((video) => video.id)
    )
    expect(context.listPage).not.toHaveBeenCalled()
  })

  it('derives a Baidu-only folder tree at the configured exact root', async () => {
    const context = createTestContext('getters-folder-tree')
    context.storage.write(DIRECT_VIDEO_STORAGE_KEY, [
      directRecord('live', '直链目录/直播.m3u8', NOW)
    ])
    context.cache.saveSuccessful([
      {
        ...baiduVideo('1', NOW - 100),
        name: '第1集.mp4',
        path: `${CONFIG.baiduRoot}/课程2/第1集.mp4`
      }
    ])

    await context.store.initialize()

    expect(context.store.folderTree).toMatchObject({
      name: '片刻',
      path: CONFIG.baiduRoot,
      videos: []
    })
    expect(context.store.folderTree.folders.map((folder) => folder.name)).toEqual([
      '课程2'
    ])
    expect(JSON.stringify(context.store.folderTree)).not.toContain('直链目录')
  })
})

describe('app store local reload and clear actions', () => {
  it('reloads auth, direct records, and progress without recreating the store', async () => {
    const context = createTestContext('actions-reload')
    await context.store.initialize()
    context.authRepository.saveSession(validSession())
    const direct = context.directLinkService.add({
      name: '新直播',
      url: 'https://media.example/new.m3u8'
    })
    context.progressRepository.save(`direct:${direct.id}`, 120, 600, NOW)

    context.store.reloadAuthSession()
    context.store.reloadDirectRecords()
    context.store.reloadProgress()

    expect(context.store.authSession).toEqual(validSession())
    expect(context.store.directRecords.map((record) => record.id)).toEqual([
      direct.id
    ])
    expect(context.store.progressHistory.map((progress) => progress.videoId)).toEqual([
      `direct:${direct.id}`
    ])
  })

  it('disconnects by clearing only auth and preserving cache, direct records, and progress', async () => {
    const context = createTestContext('actions-disconnect')
    context.authRepository.saveSession(validSession())
    context.directLinkService.add({
      name: '直播',
      url: 'https://media.example/live.m3u8'
    })
    context.progressRepository.save('baidu:1', 120, 600, NOW)
    context.cache.saveSuccessful([baiduVideo('1', NOW)])
    await context.store.initialize()

    expect(context.store.disconnectBaidu()).toBe(true)

    expect(context.store.authSession).toBeNull()
    expect(context.store.baiduVideos).toHaveLength(1)
    expect(context.store.directRecords).toHaveLength(1)
    expect(context.store.progressHistory).toHaveLength(1)
  })

  it('fails closed on an expired-session cleanup failure while preserving every non-auth slice', async () => {
    const context = createFailingRemovalContext(
      'actions-expire-failure',
      AUTH_STORAGE_KEY
    )
    await context.store.initialize()

    context.store.expireBaiduSession()

    expect(context.store.authSession).toBeNull()
    expect(context.store.lastError).toMatchObject({ code: 'authorization' })
    expectUnrelatedSlicesPreserved(context)
  })

  it('clears cache or history independently and keeps unrelated state visible', async () => {
    const context = createTestContext('actions-clear')
    context.authRepository.saveSession(validSession())
    context.directLinkService.add({
      name: '直播',
      url: 'https://media.example/live.m3u8'
    })
    context.progressRepository.save('baidu:1', 120, 600, NOW)
    context.cache.saveSuccessful([baiduVideo('1', NOW)])
    await context.store.initialize()

    expect(context.store.clearCatalogCache()).toBe(true)

    expect(context.store.baiduVideos).toEqual([])
    expect(context.store.baiduCacheSavedAt).toBeNull()
    expect(context.store.authSession).not.toBeNull()
    expect(context.store.directRecords).toHaveLength(1)
    expect(context.store.progressHistory).toHaveLength(1)

    expect(context.store.clearProgress()).toBe(true)

    expect(context.store.progressHistory).toEqual([])
    expect(context.store.resumableProgress).toEqual([])
    expect(context.store.authSession).not.toBeNull()
    expect(context.store.directRecords).toHaveLength(1)
  })

  it('returns false and preserves every domain when auth persistence removal fails', async () => {
    const context = createFailingRemovalContext(
      'actions-disconnect-failure',
      AUTH_STORAGE_KEY
    )
    await context.store.initialize()

    expect(context.store.disconnectBaidu()).toBe(false)

    expect(context.store.authSession).toEqual(validSession())
    expect(context.authRepository.getValidSession(NOW)).toEqual(validSession())
    expectUnrelatedSlicesPreserved(context)
  })

  it('returns false and preserves every domain when cache persistence removal fails', async () => {
    const context = createFailingRemovalContext(
      'actions-cache-failure',
      CATALOG_CACHE_KEY
    )
    await context.store.initialize()
    const previousVideos = context.store.baiduVideos.map((video) => ({ ...video }))
    const previousSavedAt = context.store.baiduCacheSavedAt

    expect(context.store.clearCatalogCache()).toBe(false)

    expect(context.store.baiduVideos).toEqual(previousVideos)
    expect(context.store.baiduCacheSavedAt).toBe(previousSavedAt)
    expect(context.cache.load()).toMatchObject({
      videos: previousVideos,
      savedAt: previousSavedAt
    })
    expect(context.store.authSession).toEqual(validSession())
    expect(context.store.directRecords).toHaveLength(1)
    expect(context.store.progressHistory).toHaveLength(1)
  })

  it('returns false and preserves every domain when progress persistence removal fails', async () => {
    const context = createFailingRemovalContext(
      'actions-progress-failure',
      PROGRESS_STORAGE_KEY
    )
    await context.store.initialize()
    const previousHistory = context.store.progressHistory.map((item) => ({ ...item }))

    expect(context.store.clearProgress()).toBe(false)

    expect(context.store.progressHistory).toEqual(previousHistory)
    expect(context.store.resumableProgress).toEqual(previousHistory)
    expect(context.progressRepository.listHistory()).toEqual(previousHistory)
    expect(context.store.authSession).toEqual(validSession())
    expect(context.store.baiduVideos).toHaveLength(1)
    expect(context.store.directRecords).toHaveLength(1)
  })
})

describe('mock catalog bootstrap', () => {
  it('bootstraps an allowed mock before reading or mutating any real local data', async () => {
    const context = createMockIsolationContext(
      'mock-first-success',
      bootstrapMocks
    )

    await context.store.initialize()

    expect(context.bootstrap).toHaveBeenCalledOnce()
    expect(context.now).not.toHaveBeenCalled()
    expect(context.getValidSession).not.toHaveBeenCalled()
    expect(context.listDirect).not.toHaveBeenCalled()
    expect(context.listHistory).not.toHaveBeenCalled()
    expect(context.listResumable).not.toHaveBeenCalled()
    expect(context.loadCache).not.toHaveBeenCalled()
    expect(context.readStorage).not.toHaveBeenCalled()
    expect(context.writeStorage).not.toHaveBeenCalled()
    expect(context.removeStorage).not.toHaveBeenCalled()
    expect(context.listPage).not.toHaveBeenCalled()
    expect(context.store.baiduVideos).toHaveLength(3)
    expect(context.store.lastError).toBeNull()
  })

  it.each(['null', 'throw'] as const)(
    'fails safely when mock bootstrap returns %s without falling through to local data',
    async (failure) => {
      const bootstrap = vi.fn(() => {
        if (failure === 'throw') {
          throw new Error('sentinel-mock-bootstrap-failure')
        }
        return null
      })
      const context = createMockIsolationContext(
        `mock-first-${failure}`,
        bootstrap
      )

      await expect(context.store.initialize()).resolves.toBeUndefined()

      expect(context.now).not.toHaveBeenCalled()
      expect(context.getValidSession).not.toHaveBeenCalled()
      expect(context.listDirect).not.toHaveBeenCalled()
      expect(context.listHistory).not.toHaveBeenCalled()
      expect(context.listResumable).not.toHaveBeenCalled()
      expect(context.loadCache).not.toHaveBeenCalled()
      expect(context.readStorage).not.toHaveBeenCalled()
      expect(context.writeStorage).not.toHaveBeenCalled()
      expect(context.removeStorage).not.toHaveBeenCalled()
      expect(context.listPage).not.toHaveBeenCalled()
      expect(context.store.baiduVideos).toEqual([])
      expect(context.store.directRecords).toEqual([])
      expect(context.store.progressHistory).toEqual([])
      expect(context.store.lastError).toMatchObject({ code: 'initialization' })
      expect(JSON.stringify(context.store.lastError)).not.toContain('sentinel')
    }
  )

  it('returns null without inspecting options when mocks are disabled', () => {
    const options = Object.defineProperty({}, 'scenario', {
      get: () => {
        throw new Error('sentinel-options-inspection')
      }
    }) as BootstrapMocksOptions

    expect(
      bootstrapMocks({ ...CONFIG, useMocks: false }, options)
    ).toBeNull()
  })

  it('returns deterministic deep clones for the resume scenario', () => {
    const config = { ...CONFIG, useMocks: true }
    const first = bootstrapMocks(config, {
      scenario: 'resume',
      environment: H5_DEVELOPMENT
    })!
    const second = bootstrapMocks(config, {
      scenario: 'resume',
      environment: H5_DEVELOPMENT
    })!

    expect(first.scenario).toBe('resume')
    expect(first.baiduVideos).toHaveLength(3)
    expect(first.directRecords).toHaveLength(1)
    expect(first.progressHistory).toHaveLength(1)
    expect(first.baiduVideos.every((video) => video.path.startsWith('/apps/片刻/')))
      .toBe(true)
    expect(first.baiduVideos.some((video) => video.path.split('/').length === 4))
      .toBe(true)
    expect(first.baiduVideos.some((video) => video.path.split('/').length > 4))
      .toBe(true)
    expect(
      first.baiduVideos.every((video) => {
        const thumbnail = new URL(video.thumbnailUrl!)
        return (
          thumbnail.protocol === 'https:' &&
          thumbnail.hostname === 'images.unsplash.com' &&
          !thumbnail.hash
        )
      })
    ).toBe(true)
    expect(first.directRecords[0]).toMatchObject({
      mediaKind: 'hls',
      url: expect.stringMatching(/^https:\/\/.*\.m3u8$/u)
    })
    expect(first.progressHistory[0]).toMatchObject({
      completed: false,
      videoId: expect.stringMatching(/^baidu:/u)
    })

    first.baiduVideos[0]!.name = 'mutated.mp4'
    first.directRecords[0]!.name = 'mutated direct'
    first.progressHistory[0]!.positionSeconds = 0
    first.authSession!.scope.push('mutated')

    expect(second.baiduVideos[0]!.name).not.toBe('mutated.mp4')
    expect(second.directRecords[0]!.name).not.toBe('mutated direct')
    expect(second.progressHistory[0]!.positionSeconds).toBeGreaterThan(0)
    expect(second.authSession!.scope).not.toContain('mutated')
  })

  it('supports all scenarios, safely falls back for unknown input, and exposes no provider secrets', () => {
    const config = { ...CONFIG, useMocks: true }
    const firstRun = bootstrapMocks(config, {
      scenario: 'first-run',
      environment: H5_DEVELOPMENT
    })!
    const library = bootstrapMocks(config, {
      scenario: 'library',
      environment: H5_DEVELOPMENT
    })!
    const resume = bootstrapMocks(config, {
      scenario: 'resume',
      environment: H5_DEVELOPMENT
    })!
    const baiduError = bootstrapMocks(config, {
      scenario: 'baidu-error',
      environment: H5_DEVELOPMENT
    })!
    const unknown = bootstrapMocks(config, {
      scenario: '../../unknown?access_token=sentinel',
      environment: H5_DEVELOPMENT
    })!

    expect(firstRun).toMatchObject({
      scenario: 'first-run',
      authSession: null,
      baiduVideos: [],
      directRecords: [],
      progressHistory: []
    })
    expect(library).toMatchObject({ scenario: 'library', mockBaiduError: false })
    expect(library.progressHistory).toEqual([])
    expect(resume.progressHistory).toHaveLength(1)
    expect(baiduError).toMatchObject({
      scenario: 'baidu-error',
      mockBaiduError: true
    })
    expect(unknown.scenario).toBe('first-run')

    const serialized = JSON.stringify([
      firstRun,
      library,
      resume,
      baiduError,
      unknown
    ])
    expect(serialized).not.toContain('sentinel')
    expect(serialized).not.toContain('SecretKey')
    expect(serialized).not.toContain('SignKey')
    expect(serialized).not.toContain('dlink')
    expect(serialized).not.toContain('access_token')
  })

  it('chooses a valid H5 query scenario when no scenario is injected', () => {
    const result = bootstrapMocks(
      { ...CONFIG, useMocks: true },
      {
        search: '?unrelated=1&scenario=resume',
        environment: H5_DEVELOPMENT
      }
    )

    expect(result?.scenario).toBe('resume')
    expect(result?.progressHistory).toHaveLength(1)
  })

  it.each([
    [
      'H5 development release build',
      { uniPlatform: 'h5', nodeEnv: 'development', devServer: false }
    ],
    [
      'H5 production release build',
      { uniPlatform: 'h5', nodeEnv: 'production', devServer: false }
    ],
    [
      'App dev server',
      { uniPlatform: 'app-plus', nodeEnv: 'development', devServer: true }
    ],
    [
      'App production build',
      { uniPlatform: 'app-plus', nodeEnv: 'production', devServer: false }
    ],
    ['missing platform', { nodeEnv: 'development', devServer: true }],
    [
      'unknown platform',
      { uniPlatform: 'unknown', nodeEnv: 'development', devServer: true }
    ],
    ['missing dev server flag', { uniPlatform: 'h5', nodeEnv: 'development' }]
  ] as const)(
    'returns before inspecting a scenario in %s',
    (_case, environment) => {
      let inspectedScenario = false
      const options = {
        environment,
        get scenario() {
          inspectedScenario = true
          return 'resume'
        }
      } as BootstrapMocksOptions

      expect(
        bootstrapMocks({ ...CONFIG, useMocks: true }, options)
      ).toBeNull()
      expect(inspectedScenario).toBe(false)
    }
  )

  it('does not call mock bootstrap in the store when runtime mocks are disabled', async () => {
    const mockBootstrap = vi.fn()
    const context = createTestContext('mocks-disabled-store', {
      bootstrapMocks: mockBootstrap
    })

    await context.store.initialize()

    expect(mockBootstrap).not.toHaveBeenCalled()
    expect(context.listPage).not.toHaveBeenCalled()
  })

  it('applies the resume scenario only in memory and never calls the provider', async () => {
    const context = createTestContext('mocks-resume-store', {
      config: { ...CONFIG, useMocks: true },
      bootstrapMocks,
      mockScenario: 'resume',
      mockEnvironment: H5_DEVELOPMENT
    })

    await context.store.initialize()

    expect(context.store.authSession?.accessToken).toBe(
      'mock-placeholder-token-not-a-real-credential'
    )
    expect(context.store.baiduVideos).toHaveLength(3)
    expect(context.store.directRecords).toHaveLength(1)
    expect(context.store.continueWatching).toHaveLength(1)
    expect(context.listPage).not.toHaveBeenCalled()
    expect(await context.store.syncBaidu(true)).toMatchObject({
      ok: true,
      refreshed: false,
      count: 3
    })
    expect(context.listPage).not.toHaveBeenCalled()
    expect(context.cache.load()).toBeNull()
    expect(context.directLinkService.list()).toEqual([])
    expect(context.progressRepository.listHistory()).toEqual([])
  })

  it('maps the baidu-error scenario to a safe state without raw provider errors', async () => {
    const context = createTestContext('mocks-error-store', {
      config: { ...CONFIG, useMocks: true },
      bootstrapMocks,
      mockScenario: 'baidu-error',
      mockEnvironment: H5_DEVELOPMENT
    })

    await context.store.initialize()

    expect(context.store.syncStatus).toBe('error')
    expect(context.store.lastError).toMatchObject({ code: 'sync-failed' })
    expect(context.store.baiduVideos).toHaveLength(3)
    expect(context.listPage).not.toHaveBeenCalled()
    expect(await context.store.syncBaidu(true)).toEqual({
      ok: false,
      reason: 'failed'
    })
    expect(context.listPage).not.toHaveBeenCalled()
    expect(JSON.stringify(context.store.lastError)).not.toContain('token')
    expect(JSON.stringify(context.store.lastError)).not.toContain('dlink')
  })

  it('refuses a manually forged mock config on an App dev server', async () => {
    const context = createTestContext('mocks-app-denied-store', {
      config: { ...CONFIG, useMocks: true },
      bootstrapMocks,
      mockScenario: 'resume',
      mockEnvironment: {
        uniPlatform: 'app-plus',
        nodeEnv: 'development',
        devServer: true
      }
    })

    await context.store.initialize()

    expect(context.store.baiduVideos).toEqual([])
    expect(context.store.directRecords).toEqual([])
    expect(context.store.progressHistory).toEqual([])
    expect(context.store.lastError).toMatchObject({ code: 'initialization' })
    expect(context.listPage).not.toHaveBeenCalled()
  })
})

describe('application catalog bootstrap', () => {
  it('initializes the real app store from onLaunch while retaining the token style import', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/App.vue'), 'utf8')

    expect(source).toContain('<script setup lang="ts">')
    expect(source).toContain("import { onLaunch } from '@dcloudio/uni-app'")
    expect(source).toContain("import { useAppStore } from '@/stores/appStore'")
    expect(source).toMatch(/onLaunch\(\(\) => \{\s*void useAppStore\(\)\.initialize\(\)\s*\}\)/u)
    expect(source).toContain("@use '@/styles/tokens.scss' as *;")
  })
})

interface TestContext {
  storage: ReturnType<typeof createMemoryStorage>
  authRepository: AuthRepository
  directLinkService: DirectLinkService
  progressRepository: ProgressRepository
  cache: CatalogCache
  listPage: ReturnType<typeof vi.fn>
  now: () => number
  advance: (milliseconds: number) => void
  store: ReturnType<ReturnType<typeof createAppStore>>
}

function createMockIsolationContext(
  storeId: string,
  bootstrapper: NonNullable<AppStoreDependencies['bootstrapMocks']>
) {
  const storage = createMemoryStorage()
  storage.write(AUTH_STORAGE_KEY, validSession(NOW))
  storage.write(DIRECT_VIDEO_STORAGE_KEY, { malformed: 'direct-records' })
  storage.write(PROGRESS_STORAGE_KEY, { malformed: 'progress-records' })
  storage.write(CATALOG_CACHE_KEY, {
    root: '/apps/其他',
    videos: [],
    savedAt: NOW
  })

  const authRepository = new AuthRepository(storage)
  const directLinkService = new DirectLinkService(storage)
  const progressRepository = new ProgressRepository(storage)
  const dailyUnlockRepository = new DailyUnlockRepository(storage)
  const catalogCache = new CatalogCache(storage, {
    root: CONFIG.baiduRoot,
    now: () => NOW
  })
  const getValidSession = vi.spyOn(authRepository, 'getValidSession')
  const listDirect = vi.spyOn(directLinkService, 'list')
  const listHistory = vi.spyOn(progressRepository, 'listHistory')
  const listResumable = vi.spyOn(progressRepository, 'listResumable')
  const loadCache = vi.spyOn(catalogCache, 'load')
  const readStorage = vi.spyOn(storage, 'read')
  const writeStorage = vi.spyOn(storage, 'write')
  const removeStorage = vi.spyOn(storage, 'remove')
  const now = vi.fn(() => NOW)
  const listPage = vi.fn().mockResolvedValue([])
  const bootstrap = vi.fn(bootstrapper)
  const useStore = createAppStore(`test:${storeId}`, {
    dailyUnlockRepository,
    authRepository,
    directLinkService,
    progressRepository,
    catalogCache,
    baiduDriveSource: { listPage },
    config: { ...CONFIG, useMocks: true },
    now,
    bootstrapMocks: bootstrap,
    mockScenario: 'resume',
    mockEnvironment: H5_DEVELOPMENT
  })

  return {
    store: useStore(createPinia()),
    bootstrap,
    now,
    getValidSession,
    listDirect,
    listHistory,
    listResumable,
    loadCache,
    readStorage,
    writeStorage,
    removeStorage,
    listPage
  }
}

function createTestContext(
  storeId: string,
  overrides: Partial<AppStoreDependencies> = {}
): TestContext {
  const storage = createMemoryStorage()
  let currentTime = NOW
  const now = () => currentTime
  const authRepository = new AuthRepository(storage)
  const directLinkService = new DirectLinkService(storage, { now })
  const progressRepository = new ProgressRepository(storage)
  const dailyUnlockRepository = new DailyUnlockRepository(storage)
  const cache = new CatalogCache(storage, {
    root: CONFIG.baiduRoot,
    now
  })
  const listPage = vi.fn().mockResolvedValue([])
  const dependencies: AppStoreDependencies = {
    dailyUnlockRepository,
    authRepository,
    directLinkService,
    progressRepository,
    catalogCache: cache,
    baiduDriveSource: { listPage },
    config: CONFIG,
    now,
    ...overrides
  }
  const useStore = createAppStore(`test:${storeId}`, dependencies)
  const store = useStore(createPinia())

  return {
    storage,
    authRepository,
    directLinkService,
    progressRepository,
    cache,
    listPage,
    now,
    advance: (milliseconds) => {
      currentTime += milliseconds
    },
    store
  }
}

function createFailingRemovalContext(
  storeId: string,
  failingKey: string
) {
  const backingStorage = createMemoryStorage()
  let failRemoval = false
  const storage: KeyValueStorage = {
    read: <T>(key: string, fallback: T): T =>
      backingStorage.read(key, fallback),
    write: <T>(key: string, value: T): void =>
      backingStorage.write(key, value),
    remove: (key: string): void => {
      if (failRemoval && key === failingKey) {
        throw new Error(`sentinel-remove-failure:${key}`)
      }
      backingStorage.remove(key)
    }
  }
  const authRepository = new AuthRepository(storage)
  const directLinkService = new DirectLinkService(storage, { now: () => NOW })
  const progressRepository = new ProgressRepository(storage)
  const dailyUnlockRepository = new DailyUnlockRepository(storage)
  const cache = new CatalogCache(storage, {
    root: CONFIG.baiduRoot,
    now: () => NOW
  })
  authRepository.saveSession(validSession())
  directLinkService.add({
    name: '保留的直播',
    url: 'https://media.example/preserved.m3u8'
  })
  progressRepository.save('baidu:1', 120, 600, NOW)
  cache.saveSuccessful([baiduVideo('1', NOW)])
  failRemoval = true
  const useStore = createAppStore(`test:${storeId}`, {
    dailyUnlockRepository,
    authRepository,
    directLinkService,
    progressRepository,
    catalogCache: cache,
    baiduDriveSource: { listPage: vi.fn().mockResolvedValue([]) },
    config: CONFIG,
    now: () => NOW
  })

  return {
    store: useStore(createPinia()),
    authRepository,
    directLinkService,
    progressRepository,
    cache
  }
}

function expectUnrelatedSlicesPreserved(
  context: ReturnType<typeof createFailingRemovalContext>
): void {
  expect(context.store.baiduVideos).toHaveLength(1)
  expect(context.store.directRecords).toHaveLength(1)
  expect(context.store.progressHistory).toHaveLength(1)
  expect(context.cache.load()?.videos).toHaveLength(1)
  expect(context.directLinkService.list()).toHaveLength(1)
  expect(context.progressRepository.listHistory()).toHaveLength(1)
}

function setStaleSyncError(context: TestContext): void {
  context.store.syncStatus = 'error'
  context.store.lastError = {
    code: 'sync-failed',
    message: 'stale sync error'
  }
}

function validSession(expiresAt = NOW + 24 * 60 * 60 * 1000) {
  return {
    accessToken: 'private-placeholder-token',
    expiresAt,
    scope: ['basic', 'netdisk']
  }
}

function baiduVideo(sourceId: string, modifiedAt: number): VideoItem {
  return {
    id: `baidu:${sourceId}`,
    sourceType: 'baidu',
    sourceId,
    name: `视频${sourceId}.mp4`,
    path: `${CONFIG.baiduRoot}/视频${sourceId}.mp4`,
    modifiedAt
  }
}

function fullBaiduPage(page: number): VideoItem[] {
  const firstSourceId = (page - 1) * 1000 + 1
  return Array.from({ length: 1000 }, (_, index) =>
    baiduVideo(String(firstSourceId + index), NOW - index)
  )
}

function directRecord(
  id: string,
  name: string,
  addedAt: number,
  url = `https://media.example/${id}.m3u8`
): DirectVideoRecord {
  return { id, name, url, mediaKind: 'hls', addedAt }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })

  return { promise, resolve, reject }
}
