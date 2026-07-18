import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import {
  runtimeConfig,
  type RuntimeBuildEnvironment,
  type RuntimeConfig
} from '@/config/runtime'
import type {
  BaiduAuthSession,
  DirectVideoRecord,
  PlaybackProgress,
  VideoItem
} from '@/domain/video'
import { AuthRepository } from '@/features/auth/authRepository'
import { BaiduDriveSource } from '@/features/baidu/baiduDriveSource'
import { BaiduError } from '@/features/baidu/baiduErrors'
import {
  CATALOG_REFRESH_COOLDOWN_MS,
  CatalogCache
} from '@/features/catalog/catalogCache'
import { buildFolderTree } from '@/features/catalog/folderTree'
import { DirectLinkService } from '@/features/direct-links/directLinkService'
import { classifyProgress } from '@/features/playback/progressPolicy'
import { ProgressRepository } from '@/features/playback/progressRepository'
import { uniStorage } from '@/infrastructure/storage'
import {
  bootstrapMocks as runBootstrapMocks,
  type BootstrapMocksOptions,
  type MockBootstrapData
} from '@/mocks/bootstrap'

const BAIDU_PAGE_SIZE = 1000
const MAX_BAIDU_CATALOG_PAGES = 1000

export type AppSyncStatus = 'idle' | 'syncing' | 'success' | 'error'

export type AppSafeErrorCode =
  | 'initialization'
  | 'authorization'
  | 'sync-failed'

export interface AppSafeError {
  readonly code: AppSafeErrorCode
  readonly message: string
}

export interface ContinueWatchingItem {
  readonly video: VideoItem
  readonly progress: PlaybackProgress
}

export type SyncBaiduResult =
  | {
      ok: true
      refreshed: boolean
      count: number
      savedAt: number | null
    }
  | { ok: false; reason: 'no-session' | 'active' | 'failed' | 'authorization' }
  | { ok: false; reason: 'cooldown'; retryAt: number }

interface AuthSessionRepository {
  getValidSession(now: number): BaiduAuthSession | null
  clearSession(): void
}

interface DirectRecordsRepository {
  list(): DirectVideoRecord[]
}

interface PlaybackProgressRepository {
  listHistory(): PlaybackProgress[]
  listResumable(): PlaybackProgress[]
  clear(): void
}

interface BaiduCatalogSource {
  listPage(accessToken: string, page: number): Promise<VideoItem[]>
}

type MockBootstrapper = (
  config: Pick<RuntimeConfig, 'useMocks'>,
  options?: BootstrapMocksOptions
) => MockBootstrapData | null

export interface AppStoreDependencies {
  authRepository: AuthSessionRepository
  directLinkService: DirectRecordsRepository
  progressRepository: PlaybackProgressRepository
  catalogCache: CatalogCache
  baiduDriveSource: BaiduCatalogSource
  config: RuntimeConfig
  now: () => number
  bootstrapMocks?: MockBootstrapper
  mockScenario?: string
  mockEnvironment?: RuntimeBuildEnvironment
}

export function createAppStore(
  storeId: string,
  dependencies: AppStoreDependencies
) {
  if (!storeId.trim()) {
    throw new Error('App store id is required')
  }

  return defineStore(storeId, () => {
    const authSession = ref<BaiduAuthSession | null>(null)
    const baiduVideos = ref<VideoItem[]>([])
    const baiduCacheSavedAt = ref<number | null>(null)
    const directRecords = ref<DirectVideoRecord[]>([])
    const progressHistory = ref<PlaybackProgress[]>([])
    const resumableProgress = ref<PlaybackProgress[]>([])
    const syncStatus = ref<AppSyncStatus>('idle')
    const lastError = ref<AppSafeError | null>(null)
    const initialized = ref(false)
    const lastSyncStartedAt = ref<number | null>(null)
    const nextSyncAllowedAt = ref<number | null>(null)
    const mockBaiduErrorActive = ref(false)
    const searchQuery = ref('')
    const mergedVideos = computed<VideoItem[]>(() => [
      ...baiduVideos.value.map((video) => ({ ...video })),
      ...directRecords.value.map(normalizeDirectVideo)
    ])
    const recentVideos = computed<VideoItem[]>(() =>
      [...mergedVideos.value].sort(compareRecentVideos)
    )
    const continueWatching = computed<ContinueWatchingItem[]>(() => {
      const videosById = new Map(
        mergedVideos.value.map((video) => [video.id, video] as const)
      )

      return resumableProgress.value
        .map((progress): ContinueWatchingItem | null => {
          const video = videosById.get(progress.videoId)
          return video
            ? { video: { ...video }, progress: { ...progress } }
            : null
        })
        .filter((item): item is ContinueWatchingItem => item !== null)
        .sort(
          (left, right) =>
            compareDescendingTimestamp(
              left.progress.updatedAt,
              right.progress.updatedAt
            ) || compareText(left.video.id, right.video.id)
        )
    })
    const searchResults = computed<VideoItem[]>(() => {
      const query = searchQuery.value.trim().toLocaleLowerCase('zh-CN')
      if (!query) {
        return recentVideos.value
      }

      return recentVideos.value.filter(
        (video) =>
          video.name.toLocaleLowerCase('zh-CN').includes(query) ||
          video.path.toLocaleLowerCase('zh-CN').includes(query)
      )
    })
    const folderTree = computed(() =>
      buildFolderTree(dependencies.config.baiduRoot, baiduVideos.value)
    )
    let initializationPromise: Promise<void> | null = null

    function initialize(): Promise<void> {
      if (initialized.value) {
        return Promise.resolve()
      }

      if (!initializationPromise) {
        initializationPromise = runInitialization()
          .catch(() => {
            lastError.value = safeError('initialization')
          })
          .finally(() => {
            initialized.value = true
            initializationPromise = null
          })
      }

      return initializationPromise
    }

    async function runInitialization(): Promise<void> {
      let localLoadFailed = false
      const now = dependencies.now()

      try {
        const session = dependencies.authRepository.getValidSession(now)
        if (session && isValidSessionAt(session, now)) {
          authSession.value = cloneSession(session)
        } else {
          authSession.value = null
          if (session) {
            dependencies.authRepository.clearSession()
          }
        }
      } catch {
        authSession.value = null
        localLoadFailed = true
      }

      try {
        directRecords.value = dependencies.directLinkService
          .list()
          .map((record) => ({ ...record }))
      } catch {
        localLoadFailed = true
      }

      try {
        progressHistory.value = dependencies.progressRepository
          .listHistory()
          .map((progress) => ({ ...progress }))
      } catch {
        localLoadFailed = true
      }

      try {
        resumableProgress.value = dependencies.progressRepository
          .listResumable()
          .map((progress) => ({ ...progress }))
      } catch {
        localLoadFailed = true
      }

      try {
        const cached = dependencies.catalogCache.load()
        if (cached) {
          baiduVideos.value = cached.videos
          baiduCacheSavedAt.value = cached.savedAt
        }
      } catch {
        localLoadFailed = true
      }

      if (dependencies.config.useMocks) {
        try {
          const mockData = (
            dependencies.bootstrapMocks ?? runBootstrapMocks
          )(dependencies.config, {
            ...(dependencies.mockScenario !== undefined
              ? { scenario: dependencies.mockScenario }
              : {}),
            ...(dependencies.mockEnvironment !== undefined
              ? { environment: dependencies.mockEnvironment }
              : {})
          })

          if (!mockData) {
            lastError.value = safeError('initialization')
            return
          }

          applyMockData(mockData)
          if (localLoadFailed && !mockData.mockBaiduError) {
            lastError.value = safeError('initialization')
          }
        } catch {
          lastError.value = safeError('initialization')
        }
        return
      }

      if (
        authSession.value &&
        (baiduCacheSavedAt.value === null ||
          !dependencies.catalogCache.isFresh(baiduCacheSavedAt.value))
      ) {
        await syncBaidu(false)
      }

      if (localLoadFailed) {
        lastError.value = safeError('initialization')
      }
    }

    async function syncBaidu(force = false): Promise<SyncBaiduResult> {
      if (syncStatus.value === 'syncing') {
        return { ok: false, reason: 'active' }
      }

      const now = dependencies.now()
      const session = authSession.value
      if (!session || !isValidSessionAt(session, now)) {
        if (session) {
          try {
            dependencies.authRepository.clearSession()
          } catch {
            // State still fails closed even when local cleanup is unavailable.
          }
        }
        authSession.value = null
        return { ok: false, reason: 'no-session' }
      }

      if (dependencies.config.useMocks) {
        if (mockBaiduErrorActive.value) {
          syncStatus.value = 'error'
          lastError.value = safeError('sync-failed')
          return { ok: false, reason: 'failed' }
        }

        return {
          ok: true,
          refreshed: false,
          count: baiduVideos.value.length,
          savedAt: baiduCacheSavedAt.value
        }
      }

      if (
        !force &&
        baiduCacheSavedAt.value !== null &&
        dependencies.catalogCache.isFresh(baiduCacheSavedAt.value)
      ) {
        return {
          ok: true,
          refreshed: false,
          count: baiduVideos.value.length,
          savedAt: baiduCacheSavedAt.value
        }
      }

      let requestStart: ReturnType<CatalogCache['beginRequest']>
      try {
        requestStart = dependencies.catalogCache.beginRequest()
      } catch {
        syncStatus.value = 'error'
        lastError.value = safeError('sync-failed')
        return { ok: false, reason: 'failed' }
      }

      if (!requestStart.started) {
        if (requestStart.reason === 'cooldown') {
          nextSyncAllowedAt.value = requestStart.retryAt
          return {
            ok: false,
            reason: 'cooldown',
            retryAt: requestStart.retryAt
          }
        }

        syncStatus.value = 'error'
        lastError.value = safeError('sync-failed')
        return { ok: false, reason: 'failed' }
      }

      lastSyncStartedAt.value = requestStart.startedAt
      nextSyncAllowedAt.value =
        requestStart.startedAt + CATALOG_REFRESH_COOLDOWN_MS
      syncStatus.value = 'syncing'

      try {
        const videos = await loadAllBaiduPages(
          dependencies.baiduDriveSource,
          session.accessToken
        )
        const snapshot = dependencies.catalogCache.saveSuccessful(videos)

        baiduVideos.value = snapshot.videos
        baiduCacheSavedAt.value = snapshot.savedAt
        syncStatus.value = 'success'
        lastError.value = null

        return {
          ok: true,
          refreshed: true,
          count: snapshot.videos.length,
          savedAt: snapshot.savedAt
        }
      } catch (error) {
        syncStatus.value = 'error'

        if (error instanceof BaiduError && error.kind === 'authorization') {
          try {
            dependencies.authRepository.clearSession()
          } catch {
            // The in-memory session is still cleared below.
          }
          authSession.value = null
          lastError.value = safeError('authorization')
          return { ok: false, reason: 'authorization' }
        }

        lastError.value = safeError('sync-failed')
        return { ok: false, reason: 'failed' }
      }
    }

    function reloadAuthSession(): BaiduAuthSession | null {
      try {
        const now = dependencies.now()
        const session = dependencies.authRepository.getValidSession(now)
        if (!session || !isValidSessionAt(session, now)) {
          authSession.value = null
          if (session) {
            dependencies.authRepository.clearSession()
          }
          return null
        }

        authSession.value = cloneSession(session)
        return cloneSession(session)
      } catch {
        lastError.value = safeError('initialization')
        return authSession.value ? cloneSession(authSession.value) : null
      }
    }

    function reloadDirectRecords(): DirectVideoRecord[] {
      try {
        const records = dependencies.directLinkService
          .list()
          .map((record) => ({ ...record }))
        directRecords.value = records
      } catch {
        lastError.value = safeError('initialization')
      }

      return directRecords.value.map((record) => ({ ...record }))
    }

    function reloadProgress(): PlaybackProgress[] {
      try {
        const history = dependencies.progressRepository
          .listHistory()
          .map((progress) => ({ ...progress }))
        const resumable = dependencies.progressRepository
          .listResumable()
          .map((progress) => ({ ...progress }))
        progressHistory.value = history
        resumableProgress.value = resumable
      } catch {
        lastError.value = safeError('initialization')
      }

      return progressHistory.value.map((progress) => ({ ...progress }))
    }

    function disconnectBaidu(): void {
      try {
        dependencies.authRepository.clearSession()
        authSession.value = null
      } catch {
        lastError.value = safeError('initialization')
      }
    }

    function clearCatalogCache(): void {
      try {
        dependencies.catalogCache.clear()
        baiduVideos.value = []
        baiduCacheSavedAt.value = null
        lastSyncStartedAt.value = null
        nextSyncAllowedAt.value = null
      } catch {
        lastError.value = safeError('initialization')
      }
    }

    function clearProgress(): void {
      try {
        dependencies.progressRepository.clear()
        progressHistory.value = []
        resumableProgress.value = []
      } catch {
        lastError.value = safeError('initialization')
      }
    }

    function applyMockData(data: MockBootstrapData): void {
      authSession.value = data.authSession
        ? cloneSession(data.authSession)
        : null
      baiduVideos.value = data.baiduVideos.map((video) => ({ ...video }))
      baiduCacheSavedAt.value = data.baiduCacheSavedAt
      directRecords.value = data.directRecords.map((record) => ({ ...record }))
      progressHistory.value = data.progressHistory.map((progress) => ({
        ...progress
      }))
      resumableProgress.value = data.progressHistory
        .filter((progress) =>
          classifyProgress(
            progress.positionSeconds,
            progress.durationSeconds
          ).resumable
        )
        .map((progress) => ({ ...progress }))
      mockBaiduErrorActive.value = data.mockBaiduError
      syncStatus.value = data.mockBaiduError ? 'error' : 'idle'
      lastError.value = data.mockBaiduError
        ? safeError('sync-failed')
        : null
    }

    return {
      authSession,
      baiduVideos,
      baiduCacheSavedAt,
      directRecords,
      progressHistory,
      resumableProgress,
      syncStatus,
      lastError,
      initialized,
      lastSyncStartedAt,
      nextSyncAllowedAt,
      searchQuery,
      mergedVideos,
      recentVideos,
      continueWatching,
      searchResults,
      folderTree,
      initialize,
      syncBaidu,
      reloadAuthSession,
      reloadDirectRecords,
      reloadProgress,
      disconnectBaidu,
      clearCatalogCache,
      clearProgress
    }
  })
}

async function loadAllBaiduPages(
  source: BaiduCatalogSource,
  accessToken: string
): Promise<VideoItem[]> {
  const seenSourceIds = new Set<string>()
  const videos: VideoItem[] = []

  for (let page = 1; page <= MAX_BAIDU_CATALOG_PAGES; page += 1) {
    const pageVideos = await source.listPage(accessToken, page)
    if (!Array.isArray(pageVideos) || pageVideos.length > BAIDU_PAGE_SIZE) {
      throw new Error('Invalid Baidu catalog page')
    }

    let addedOnPage = 0
    for (const video of pageVideos) {
      if (
        !video ||
        typeof video.sourceId !== 'string' ||
        seenSourceIds.has(video.sourceId)
      ) {
        continue
      }

      seenSourceIds.add(video.sourceId)
      videos.push(video)
      addedOnPage += 1
    }

    if (pageVideos.length < BAIDU_PAGE_SIZE) {
      return videos
    }

    if (addedOnPage === 0) {
      throw new Error('Repeated Baidu catalog page')
    }
  }

  throw new Error('Baidu catalog page limit exceeded')
}

function isValidSessionAt(
  session: BaiduAuthSession,
  now: number
): boolean {
  return (
    Number.isSafeInteger(now) &&
    now >= 0 &&
    typeof session.accessToken === 'string' &&
    Boolean(session.accessToken.trim()) &&
    Number.isSafeInteger(session.expiresAt) &&
    session.expiresAt > now &&
    Array.isArray(session.scope) &&
    session.scope.includes('basic') &&
    session.scope.includes('netdisk')
  )
}

function cloneSession(session: BaiduAuthSession): BaiduAuthSession {
  return { ...session, scope: [...session.scope] }
}

function normalizeDirectVideo(record: DirectVideoRecord): VideoItem {
  return {
    id: `direct:${record.id}`,
    sourceType: 'direct',
    sourceId: record.id,
    name: record.name,
    path: record.url,
    modifiedAt: record.addedAt
  }
}

function compareRecentVideos(left: VideoItem, right: VideoItem): number {
  const timestampOrder = compareDescendingTimestamp(
    left.modifiedAt ?? 0,
    right.modifiedAt ?? 0
  )

  return (
    timestampOrder ||
    compareText(left.name, right.name) ||
    compareText(left.path, right.path) ||
    compareText(left.id, right.id)
  )
}

function compareDescendingTimestamp(left: number, right: number): number {
  return left === right ? 0 : left > right ? -1 : 1
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, 'zh-CN', { numeric: true })
}

function safeError(code: AppSafeErrorCode): AppSafeError {
  switch (code) {
    case 'authorization':
      return {
        code,
        message: '百度网盘授权已过期，请重新连接'
      }
    case 'sync-failed':
      return {
        code,
        message: '百度网盘同步失败，请稍后重试'
      }
    default:
      return {
        code,
        message: '本地视频资料暂时无法完整加载'
      }
  }
}

const runtimeDependencies: AppStoreDependencies = {
  authRepository: new AuthRepository(uniStorage),
  directLinkService: new DirectLinkService(uniStorage),
  progressRepository: new ProgressRepository(uniStorage),
  catalogCache: new CatalogCache(uniStorage, {
    root: runtimeConfig.baiduRoot
  }),
  baiduDriveSource: new BaiduDriveSource(runtimeConfig.baiduRoot),
  config: runtimeConfig,
  now: Date.now,
  bootstrapMocks: runBootstrapMocks
}

export const useAppStore = createAppStore('app', runtimeDependencies)
