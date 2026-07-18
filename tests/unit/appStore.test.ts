import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { createPinia } from 'pinia'
import { describe, expect, it, vi } from 'vitest'

import type { RuntimeConfig } from '@/config/runtime'
import type { DirectVideoRecord, VideoItem } from '@/domain/video'
import { AuthRepository, AUTH_STORAGE_KEY } from '@/features/auth/authRepository'
import { BaiduError } from '@/features/baidu/baiduErrors'
import {
  CATALOG_REFRESH_COOLDOWN_MS,
  CatalogCache
} from '@/features/catalog/catalogCache'
import {
  DIRECT_VIDEO_STORAGE_KEY,
  DirectLinkService
} from '@/features/direct-links/directLinkService'
import { ProgressRepository } from '@/features/playback/progressRepository'
import { createMemoryStorage } from '@/infrastructure/storage'
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
})

describe('app store derived catalog', () => {
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

  it('sorts all sources newest first with deterministic Chinese numeric ties', async () => {
    const context = createTestContext('getters-recent')
    const directRecords: DirectVideoRecord[] = [
      directRecord('old', '旧视频.mp4', NOW - 200),
      directRecord('ten', '第10集.mp4', NOW),
      directRecord('two', '第2集.mp4', NOW)
    ]
    context.storage.write(DIRECT_VIDEO_STORAGE_KEY, directRecords)
    context.cache.saveSuccessful([baiduVideo('1', NOW - 100)])

    await context.store.initialize()

    expect(context.store.recentVideos.map((video) => video.id)).toEqual([
      'direct:two',
      'direct:ten',
      'baidu:1',
      'direct:old'
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
      context.store.recentVideos.map((video) => video.id)
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

    context.store.disconnectBaidu()

    expect(context.store.authSession).toBeNull()
    expect(context.store.baiduVideos).toHaveLength(1)
    expect(context.store.directRecords).toHaveLength(1)
    expect(context.store.progressHistory).toHaveLength(1)
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

    context.store.clearCatalogCache()

    expect(context.store.baiduVideos).toEqual([])
    expect(context.store.baiduCacheSavedAt).toBeNull()
    expect(context.store.authSession).not.toBeNull()
    expect(context.store.directRecords).toHaveLength(1)
    expect(context.store.progressHistory).toHaveLength(1)

    context.store.clearProgress()

    expect(context.store.progressHistory).toEqual([])
    expect(context.store.resumableProgress).toEqual([])
    expect(context.store.authSession).not.toBeNull()
    expect(context.store.directRecords).toHaveLength(1)
  })
})

describe('mock catalog bootstrap', () => {
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
    const first = bootstrapMocks(config, { scenario: 'resume' })!
    const second = bootstrapMocks(config, { scenario: 'resume' })!

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
    const firstRun = bootstrapMocks(config, { scenario: 'first-run' })!
    const library = bootstrapMocks(config, { scenario: 'library' })!
    const resume = bootstrapMocks(config, { scenario: 'resume' })!
    const baiduError = bootstrapMocks(config, { scenario: 'baidu-error' })!
    const unknown = bootstrapMocks(config, {
      scenario: '../../unknown?access_token=sentinel'
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
      { search: '?unrelated=1&scenario=resume' }
    )

    expect(result?.scenario).toBe('resume')
    expect(result?.progressHistory).toHaveLength(1)
  })

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
      mockScenario: 'resume'
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
      mockScenario: 'baidu-error'
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
  const cache = new CatalogCache(storage, now)
  const listPage = vi.fn().mockResolvedValue([])
  const dependencies: AppStoreDependencies = {
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
