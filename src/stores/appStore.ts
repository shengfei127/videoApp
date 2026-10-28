import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import {
  runtimeConfig,
  type RuntimeBuildEnvironment,
  type RuntimeConfig
} from '@/config/runtime'
import type {
  BaiduAuthSession,
  DailyUnlockCourse,
  DailyUnlockEpisode,
  DailyUnlockSettings,
  DirectVideoRecord,
  PlaybackProgress,
  VideoItem,
  VideoUnlockStatus
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
import { DailyUnlockRepository } from '@/features/daily-unlock/dailyUnlockRepository'
import {
  findCourseConflict,
  getVideoUnlockStatus,
  rescheduleDailyUnlockCourse
} from '@/features/daily-unlock/dailyUnlockPolicy'
import { classifyProgress } from '@/features/playback/progressPolicy'
import { ProgressRepository } from '@/features/playback/progressRepository'
import type { StorageAudit, StorageCompaction } from '@/features/playback/storageAudit'
import { createSecureUuid } from '@/infrastructure/secureRandom'
import { uniStorage } from '@/infrastructure/storage'
import {
  bootstrapMocks as runBootstrapMocks,
  type BootstrapMocksOptions,
  type MockBootstrapData
} from '@/mocks/bootstrap'

const BAIDU_PAGE_SIZE = 1000
const MAX_BAIDU_CATALOG_PAGES = 100

export type AppSyncStatus =
  | 'idle'
  | 'syncing'
  | 'success'
  | 'cooldown'
  | 'error'

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

interface CatalogSearchEntry {
  readonly video: VideoItem
  readonly haystack: string
}

export type SyncBaiduResult =
  | {
      ok: true
      refreshed: boolean
      count: number
      savedAt: number | null
    }
  | {
      ok: false
      reason:
        | 'no-session'
        | 'active'
        | 'failed'
        | 'authorization'
        | 'superseded'
    }
  | { ok: false; reason: 'cooldown'; retryAt: number }

type SyncTransition =
  | { state: 'idle' }
  | { state: 'syncing'; startedAt: number }
  | { state: 'success' }
  | { state: 'cooldown'; retryAt: number }
  | { state: 'error'; error: 'authorization' | 'sync-failed' }

interface AuthSessionRepository {
  getValidSession(now: number): BaiduAuthSession | null
  clearSession(): void
}

interface DirectRecordsRepository {
  list(): DirectVideoRecord[]
}

interface PlaybackProgressRepository {
  batchSetCompleted?(videoIds: string[], updatedAt: number): string
  undoBatchCompleted?(token: string): boolean
  inspectStorage?(): StorageAudit
  compactStorage?(): StorageCompaction
  listLearningHistory?(): PlaybackProgress[]
  listHistory(): PlaybackProgress[]
  listResumable(): PlaybackProgress[]
  clear(): void
  setCompleted?(videoId: string, completed: boolean, updatedAt: number, durationSeconds?: number): PlaybackProgress
  recoverPendingWrites?(): boolean
  relinkVideo?(oldVideoId: string, newVideoId: string, commitCourse: () => void): void
}

interface BaiduCatalogSource {
  listPage(accessToken: string, page: number): Promise<VideoItem[]>
}

type MockBootstrapper = (
  config: Pick<RuntimeConfig, 'useMocks'>,
  options?: BootstrapMocksOptions
) => MockBootstrapData | null

export type CreateDailyUnlockCourseInput = Pick<DailyUnlockCourse, 'name' | 'episodes' | 'sourceFolderPath' | 'dailyEpisodeCount' | 'startEpisodeNumber'>
export interface UpdateDailyUnlockCourseInput {
  name?: string
  dailyEpisodeCount?: number
  paused?: boolean
}

export type DailyUnlockCourseResult =
  | { ok: true; course: DailyUnlockCourse }
  | { ok: false; reason: 'invalid' | 'conflict' | 'storage' }

export interface AppStoreDependencies {
  dailyUnlockRepository: Pick<DailyUnlockRepository, 'load' | 'save'>
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
    const learningRecoveryRequired = ref(false)
    const learningRecords = ref<PlaybackProgress[]>([])
    const learningHistory = computed(() => [...new Map([
      ...learningRecords.value.map((progress) => [progress.videoId, progress] as const),
      ...progressHistory.value.map((progress) => [progress.videoId, progress] as const)
    ]).values()])
    const resumableProgress = ref<PlaybackProgress[]>([])
    const dailyUnlockSettings = ref<DailyUnlockSettings>({ enabled: false, courses: [] })
    const dailyUnlockNow = ref(0)
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
    const searchIndex = computed<CatalogSearchEntry[]>(() =>
      [...mergedVideos.value]
        .sort(compareRecentVideos)
        .map((video) => ({
          video,
          haystack: `${video.name.toLocaleLowerCase('zh-CN')}\n${video.path.toLocaleLowerCase('zh-CN')}`
        }))
    )
    const catalogRecentVideos = computed<VideoItem[]>(() =>
      searchIndex.value.map(({ video }) => ({ ...video }))
    )
    const recentVideos = computed<VideoItem[]>(() => {
      const videosById = new Map(
        mergedVideos.value.map((video) => [video.id, video] as const)
      )
      const seen = new Set<string>()
      return progressHistory.value
        .map((progress) => ({
          video: videosById.get(progress.videoId),
          progress
        }))
        .filter((item): item is { video: VideoItem; progress: PlaybackProgress } => Boolean(item.video))
        .sort((left, right) =>
          compareDescendingTimestamp(left.progress.updatedAt, right.progress.updatedAt) ||
          compareText(left.video.id, right.video.id)
        )
        .filter(({ video }) => {
          if (seen.has(video.id)) return false
          seen.add(video.id)
          return true
        })
        .map(({ video }) => ({ ...video }))
    })
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
        return catalogRecentVideos.value
      }

      return searchIndex.value
        .filter(({ haystack }) => haystack.includes(query))
        .map(({ video }) => ({ ...video }))
    })
    const folderTree = computed(() =>
      buildFolderTree(dependencies.config.baiduRoot, baiduVideos.value)
    )
    let initializationPromise: Promise<void> | null = null
    let syncGeneration = 0

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
            initialized.value = !learningRecoveryRequired.value
            initializationPromise = null
          })
      }

      return initializationPromise
    }

    async function runInitialization(): Promise<void> {
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
        } catch {
          lastError.value = safeError('initialization')
        }
        return
      }

      if (!ensureLearningStorage()) return
      let localLoadFailed = false
      const now = dependencies.now()
      dailyUnlockNow.value = now

      try {
        dailyUnlockSettings.value = cloneDailyUnlockSettings(
          dependencies.dailyUnlockRepository.load()
        )
      } catch {
        dailyUnlockSettings.value = { enabled: false, courses: [] }
        localLoadFailed = true
      }

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
        learningRecords.value = dependencies.progressRepository.listLearningHistory?.().map((progress) => ({ ...progress })) ?? []
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
      if (!session) {
        transitionSync({ state: 'idle' })
        return { ok: false, reason: 'no-session' }
      }

      if (!isValidSessionAt(session, now)) {
        try {
          dependencies.authRepository.clearSession()
        } catch {
          // State still fails closed even when local cleanup is unavailable.
        }
        authSession.value = null
        transitionSync({ state: 'error', error: 'authorization' })
        return { ok: false, reason: 'authorization' }
      }

      if (dependencies.config.useMocks) {
        if (mockBaiduErrorActive.value) {
          transitionSync({ state: 'error', error: 'sync-failed' })
          return { ok: false, reason: 'failed' }
        }

        transitionSync({ state: 'success' })
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
        transitionSync({ state: 'success' })
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
        transitionSync({ state: 'error', error: 'sync-failed' })
        return { ok: false, reason: 'failed' }
      }

      if (!requestStart.started) {
        if (requestStart.reason === 'cooldown') {
          transitionSync({
            state: 'cooldown',
            retryAt: requestStart.retryAt
          })
          return {
            ok: false,
            reason: 'cooldown',
            retryAt: requestStart.retryAt
          }
        }

        transitionSync({ state: 'error', error: 'sync-failed' })
        return { ok: false, reason: 'failed' }
      }

      const generation = syncGeneration
      const accessToken = session.accessToken
      transitionSync({
        state: 'syncing',
        startedAt: requestStart.startedAt
      })

      try {
        const videos = await loadAllBaiduPages(
          dependencies.baiduDriveSource,
          accessToken
        )
        if (!isCurrentSync(generation, accessToken)) {
          return { ok: false, reason: 'superseded' }
        }

        const snapshot = dependencies.catalogCache.saveSuccessful(videos)

        baiduVideos.value = snapshot.videos
        baiduCacheSavedAt.value = snapshot.savedAt
        transitionSync({ state: 'success' })

        return {
          ok: true,
          refreshed: true,
          count: snapshot.videos.length,
          savedAt: snapshot.savedAt
        }
      } catch (error) {
        if (!isCurrentSync(generation, accessToken)) {
          return { ok: false, reason: 'superseded' }
        }

        if (error instanceof BaiduError && error.kind === 'authorization') {
          try {
            dependencies.authRepository.clearSession()
          } catch {
            // The in-memory session is still cleared below.
          }
          authSession.value = null
          transitionSync({ state: 'error', error: 'authorization' })
          return { ok: false, reason: 'authorization' }
        }

        transitionSync({ state: 'error', error: 'sync-failed' })
        return { ok: false, reason: 'failed' }
      }
    }

    function reloadAuthSession(): BaiduAuthSession | null {
      try {
        const now = dependencies.now()
        const session = dependencies.authRepository.getValidSession(now)
        if (!session || !isValidSessionAt(session, now)) {
          const identityChanged = authSession.value !== null
          authSession.value = null
          if (identityChanged) {
            invalidateSync()
          }
          if (session) {
            dependencies.authRepository.clearSession()
          }
          return null
        }

        const identityChanged =
          authSession.value?.accessToken !== session.accessToken
        authSession.value = cloneSession(session)
        if (identityChanged) {
          invalidateSync()
        }
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

    function refreshDailyUnlockClock(now = dependencies.now()): void {
      if (Number.isFinite(now)) {
        dailyUnlockNow.value = now
      }
    }

    function videoUnlockStatus(videoId: string): VideoUnlockStatus {
      return getVideoUnlockStatus(
        dailyUnlockSettings.value,
        videoId,
        dailyUnlockNow.value
      )
    }

    function ensureLearningStorage(): boolean {
      try {
        const recovered = dependencies.progressRepository.recoverPendingWrites?.() ?? false
        if (recovered || learningRecoveryRequired.value) {
          const settings = dependencies.dailyUnlockRepository.load()
          const history = dependencies.progressRepository.listHistory().map((item) => ({ ...item }))
          const learning = dependencies.progressRepository.listLearningHistory?.().map((item) => ({ ...item })) ?? []
          const resumable = dependencies.progressRepository.listResumable().map((item) => ({ ...item }))
          dailyUnlockSettings.value = cloneDailyUnlockSettings(settings)
          progressHistory.value = history
          learningRecords.value = learning
          resumableProgress.value = resumable
          refreshDailyUnlockClock()
        }
        learningRecoveryRequired.value = false
        return true
      } catch {
        learningRecoveryRequired.value = true
        lastError.value = safeError('initialization')
        return false
      }
    }

    async function retryLearningRecovery(): Promise<boolean> {
      if (initializationPromise) await initializationPromise
      const succeeded = ensureLearningStorage()
      if (succeeded && lastError.value?.code === 'initialization') lastError.value = null
      if (succeeded && !initialized.value) await initialize()
      return succeeded && !learningRecoveryRequired.value
    }

    function setDailyUnlockEnabled(enabled: boolean): boolean {
      if (!ensureLearningStorage()) return false
      const next = { ...cloneDailyUnlockSettings(dailyUnlockSettings.value), enabled }
      try {
        dependencies.dailyUnlockRepository.save(next)
      } catch {
        return false
      }
      dailyUnlockSettings.value = next
      refreshDailyUnlockClock()
      return true
    }

    function reloadDailyUnlockSettings(): boolean {
      if (!ensureLearningStorage()) return false
      try {
        dailyUnlockSettings.value = cloneDailyUnlockSettings(dependencies.dailyUnlockRepository.load())
        refreshDailyUnlockClock()
        return true
      } catch {
        return false
      }
    }

    function createDailyUnlockCourse(
      input: CreateDailyUnlockCourseInput,
      options: { enableDailyUnlock?: boolean } = {}
    ): DailyUnlockCourseResult {
      if (!ensureLearningStorage()) return { ok: false, reason: 'storage' }
      const name = typeof input?.name === 'string' ? input.name.trim() : ''
      if (
        !name ||
        name.length > 160 ||
        (input.dailyEpisodeCount !== undefined && (!Number.isInteger(input.dailyEpisodeCount) || input.dailyEpisodeCount < 1 || input.dailyEpisodeCount > 10)) ||
        !Array.isArray(input.episodes) ||
        input.episodes.length === 0 ||
        input.episodes.length > 500
      ) {
        return { ok: false, reason: 'invalid' }
      }
      const episodes: DailyUnlockEpisode[] = []
      if (input.startEpisodeNumber !== undefined && (!Number.isInteger(input.startEpisodeNumber) || input.startEpisodeNumber < 1 || input.startEpisodeNumber > input.episodes.length)) return { ok: false, reason: 'invalid' }
      const seenVideoIds = new Set<string>()
      for (const episode of input.episodes) {
        if (
          !episode ||
          typeof episode.videoId !== 'string' ||
          !episode.videoId.trim() ||
          episode.videoId.length > 512 ||
          typeof episode.name !== 'string' ||
          !episode.name.trim() ||
          episode.name.trim().length > 160 ||
          (episode.sourceType !== 'baidu' && episode.sourceType !== 'direct') ||
          seenVideoIds.has(episode.videoId)
        ) {
          return { ok: false, reason: 'invalid' }
        }
        seenVideoIds.add(episode.videoId)
        if (episode.sourceType === 'baidu' && !episode.path) {
          return { ok: false, reason: 'invalid' }
        }
        episodes.push({
          videoId: episode.videoId,
          name: episode.name.trim(),
          sourceType: episode.sourceType,
          ...(episode.sourceType === 'baidu' ? { path: episode.path } : {})
        })
      }
      const conflict = findCourseConflict(
        dailyUnlockSettings.value.courses,
        episodes.map(({ videoId }) => videoId)
      )
      if (conflict) {
        return { ok: false, reason: 'conflict' }
      }
      let id: string
      try {
        id = createSecureUuid()
      } catch {
        return { ok: false, reason: 'storage' }
      }
      const course: DailyUnlockCourse = {
        id,
        name,
        createdAt: dependencies.now(),
        ...(input.dailyEpisodeCount !== undefined ? { dailyEpisodeCount: input.dailyEpisodeCount } : {}),
        ...(input.startEpisodeNumber !== undefined ? { startEpisodeNumber: input.startEpisodeNumber } : {}),
        ...(input.sourceFolderPath ? { sourceFolderPath: input.sourceFolderPath } : {}),
        episodes
      }
      const next = {
        ...cloneDailyUnlockSettings(dailyUnlockSettings.value),
        courses: [...dailyUnlockSettings.value.courses, course],
        enabled: options.enableDailyUnlock === true || dailyUnlockSettings.value.enabled
      }
      try {
        dependencies.dailyUnlockRepository.save(next)
      } catch {
        return { ok: false, reason: 'storage' }
      }
      dailyUnlockSettings.value = next
      refreshDailyUnlockClock()
      return { ok: true, course: cloneDailyUnlockCourse(course) }
    }

    function updateDailyUnlockCourse(courseId: string, patch: UpdateDailyUnlockCourseInput): boolean {
      if (!ensureLearningStorage()) return false
      const course = dailyUnlockSettings.value.courses.find((item) => item.id === courseId)
      if (!course || !patch ||
        (patch.name !== undefined && (typeof patch.name !== 'string' || !patch.name.trim() || patch.name.trim().length > 160)) ||
        (patch.dailyEpisodeCount !== undefined && (!Number.isInteger(patch.dailyEpisodeCount) || patch.dailyEpisodeCount < 1 || patch.dailyEpisodeCount > 10)) ||
        (patch.paused !== undefined && typeof patch.paused !== 'boolean')) return false
      const updated = rescheduleDailyUnlockCourse(course, patch, dependencies.now())
      const next = {
        ...cloneDailyUnlockSettings(dailyUnlockSettings.value),
        courses: dailyUnlockSettings.value.courses.map((item) => item.id === courseId ? updated : cloneDailyUnlockCourse(item))
      }
      try {
        dependencies.dailyUnlockRepository.save(next)
      } catch {
        return false
      }
      dailyUnlockSettings.value = next
      refreshDailyUnlockClock()
      return true
    }

    function batchMarkCourseLearned(courseId: string, start1: number, end1: number): { ok: true; undoToken: string; count: number } | { ok: false; reason: 'invalid' | 'storage' } {
      if (!ensureLearningStorage()) return { ok: false, reason: 'storage' }
      const course = dailyUnlockSettings.value.courses.find((item) => item.id === courseId)
      if (!course || !Number.isInteger(start1) || !Number.isInteger(end1) || start1 < 1 || end1 < start1 || end1 > course.episodes.length) return { ok: false, reason: 'invalid' }
      if (!dependencies.progressRepository.batchSetCompleted) return { ok: false, reason: 'storage' }
      try {
        const ids = course.episodes.slice(start1 - 1, end1).map((episode) => episode.videoId)
        const undoToken = dependencies.progressRepository.batchSetCompleted(ids, dependencies.now())
        reloadProgress()
        return { ok: true, undoToken, count: ids.length }
      } catch { return { ok: false, reason: 'storage' } }
    }

    function undoBatchLearned(token: string): boolean {
      if (!ensureLearningStorage() || !dependencies.progressRepository.undoBatchCompleted) return false
      try {
        const restored = dependencies.progressRepository.undoBatchCompleted(token)
        if (restored) reloadProgress()
        return restored
      } catch { return false }
    }

    function inspectLearningStorage(): StorageAudit | null {
      if (!ensureLearningStorage()) return null
      try { return dependencies.progressRepository.inspectStorage?.() ?? null } catch { return null }
    }

    function compactLearningStorage(): StorageCompaction | null {
      if (!ensureLearningStorage()) return null
      try {
        const result = dependencies.progressRepository.compactStorage?.() ?? null
        if (result) reloadProgress()
        return result
      } catch { return null }
    }

    function markVideoLearned(videoId: string, completed: boolean): boolean {
      if (!ensureLearningStorage()) return false
      const video = mergedVideos.value.find((item) => item.id === videoId)
      const isCourseVideo = dailyUnlockSettings.value.courses.some((course) => course.episodes.some((episode) => episode.videoId === videoId))
      if ((!video && !isCourseVideo) || typeof completed !== 'boolean' || !dependencies.progressRepository.setCompleted) return false
      if (completed && getVideoUnlockStatus(dailyUnlockSettings.value, videoId, dependencies.now()).locked) return false
      try {
        dependencies.progressRepository.setCompleted(videoId, completed, dependencies.now(), video?.durationSeconds)
        reloadProgress()
        return true
      } catch {
        return false
      }
    }

    function deleteDailyUnlockCourse(courseId: string): boolean {
      if (!ensureLearningStorage()) return false
      if (!dailyUnlockSettings.value.courses.some((course) => course.id === courseId)) {
        return true
      }
      const next = {
        ...cloneDailyUnlockSettings(dailyUnlockSettings.value),
        courses: dailyUnlockSettings.value.courses.filter((course) => course.id !== courseId)
      }
      try {
        dependencies.dailyUnlockRepository.save(next)
      } catch {
        return false
      }
      dailyUnlockSettings.value = next
      return true
    }

    function restoreDailyUnlockCourse(snapshot: DailyUnlockCourse): boolean {
      if (!ensureLearningStorage()) return false
      if (!snapshot || dailyUnlockSettings.value.courses.some((course) => course.id === snapshot.id) ||
        !Array.isArray(snapshot.episodes) || findCourseConflict(dailyUnlockSettings.value.courses, snapshot.episodes.map((episode) => episode.videoId))) return false
      const next = { ...cloneDailyUnlockSettings(dailyUnlockSettings.value), courses: [...dailyUnlockSettings.value.courses, cloneDailyUnlockCourse(snapshot)] }
      try {
        dependencies.dailyUnlockRepository.save(next)
      } catch {
        return false
      }
      dailyUnlockSettings.value = next
      refreshDailyUnlockClock()
      return true
    }

    function relinkDailyUnlockEpisode(courseId: string, oldVideoId: string, newVideoId: string): boolean {
      if (!ensureLearningStorage()) return false
      const course = dailyUnlockSettings.value.courses.find((item) => item.id === courseId)
      const replacement = mergedVideos.value.find((item) => item.id === newVideoId)
      if (!course || !replacement || !course.episodes.some((episode) => episode.videoId === oldVideoId) ||
        oldVideoId === newVideoId || findCourseConflict(dailyUnlockSettings.value.courses, [newVideoId]) || !dependencies.progressRepository.relinkVideo) return false
      const episode: DailyUnlockEpisode = { videoId: replacement.id, name: replacement.name, sourceType: replacement.sourceType,
        ...(replacement.sourceType === 'baidu' ? { path: replacement.path } : {}) }
      const next = cloneDailyUnlockSettings(dailyUnlockSettings.value)
      next.courses = next.courses.map((item) => item.id === courseId ? { ...item, episodes: item.episodes.map((entry) => entry.videoId === oldVideoId ? episode : entry) } : item)
      try {
        dependencies.progressRepository.relinkVideo(oldVideoId, newVideoId, () => dependencies.dailyUnlockRepository.save(next))
      } catch {
        ensureLearningStorage()
        return false
      }
      dailyUnlockSettings.value = next
      reloadProgress()
      return true
    }

    function reloadProgress(): PlaybackProgress[] {
      if (!ensureLearningStorage()) return progressHistory.value.map((item) => ({ ...item }))
      try {
        const history = dependencies.progressRepository
          .listHistory()
          .map((progress) => ({ ...progress }))
        const resumable = dependencies.progressRepository
          .listResumable()
          .map((progress) => ({ ...progress }))
        const learning = dependencies.progressRepository.listLearningHistory?.().map((progress) => ({ ...progress })) ?? []
        progressHistory.value = history
        learningRecords.value = learning
        resumableProgress.value = resumable
      } catch {
        lastError.value = safeError('initialization')
      }

      return progressHistory.value.map((progress) => ({ ...progress }))
    }

    function disconnectBaidu(): boolean {
      try {
        dependencies.authRepository.clearSession()
        authSession.value = null
        invalidateSync()
        return true
      } catch {
        lastError.value = safeError('initialization')
        return false
      }
    }

    function expireBaiduSession(): void {
      try {
        dependencies.authRepository.clearSession()
      } catch {
        // Keep the current process fail-closed when persisted cleanup is unavailable.
      }
      authSession.value = null
      invalidateSync()
      lastError.value = safeError('authorization')
    }

    function clearCatalogCache(): boolean {
      try {
        dependencies.catalogCache.clear()
        baiduVideos.value = []
        baiduCacheSavedAt.value = null
        lastSyncStartedAt.value = null
        nextSyncAllowedAt.value = null
        invalidateSync()
        return true
      } catch {
        lastError.value = safeError('initialization')
        return false
      }
    }

    function clearProgress(): boolean {
      if (!ensureLearningStorage()) return false
      try {
        dependencies.progressRepository.clear()
        learningRecords.value = dependencies.progressRepository.listLearningHistory?.().map((progress) => ({ ...progress })) ?? []
        progressHistory.value = []
        resumableProgress.value = []
        return true
      } catch {
        lastError.value = safeError('initialization')
        return false
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
      transitionSync(
        data.mockBaiduError
          ? { state: 'error', error: 'sync-failed' }
          : { state: 'idle' }
      )
    }

    function transitionSync(transition: SyncTransition): void {
      switch (transition.state) {
        case 'idle':
          syncStatus.value = 'idle'
          lastError.value = null
          lastSyncStartedAt.value = null
          nextSyncAllowedAt.value = null
          return
        case 'syncing':
          syncStatus.value = 'syncing'
          lastError.value = null
          lastSyncStartedAt.value = transition.startedAt
          nextSyncAllowedAt.value =
            transition.startedAt + CATALOG_REFRESH_COOLDOWN_MS
          return
        case 'success':
          syncStatus.value = 'success'
          lastError.value = null
          return
        case 'cooldown':
          syncStatus.value = 'cooldown'
          lastError.value = null
          nextSyncAllowedAt.value = transition.retryAt
          return
        case 'error':
          syncStatus.value = 'error'
          lastError.value = safeError(transition.error)
      }
    }

    function invalidateSync(): void {
      syncGeneration += 1
      transitionSync({ state: 'idle' })
    }

    function isCurrentSync(generation: number, accessToken: string): boolean {
      return (
        generation === syncGeneration &&
        authSession.value?.accessToken === accessToken
      )
    }

    return {
      authSession,
      baiduVideos,
      baiduCacheSavedAt,
      directRecords,
      progressHistory,
      learningHistory,
      learningRecoveryRequired,
      retryLearningRecovery,
      resumableProgress,
      syncStatus,
      lastError,
      initialized,
      lastSyncStartedAt,
      nextSyncAllowedAt,
      searchQuery,
      mergedVideos,
      catalogRecentVideos,
      recentVideos,
      dailyUnlockSettings,
      dailyUnlockNow,
      videoUnlockStatus,
      refreshDailyUnlockClock,
      setDailyUnlockEnabled,
      reloadDailyUnlockSettings,
      createDailyUnlockCourse,
      updateDailyUnlockCourse,
      markVideoLearned,
      batchMarkCourseLearned,
      undoBatchLearned,
      inspectLearningStorage,
      compactLearningStorage,
      deleteDailyUnlockCourse,
      restoreDailyUnlockCourse,
      relinkDailyUnlockEpisode,
      continueWatching,
      searchResults,
      folderTree,
      initialize,
      syncBaidu,
      reloadAuthSession,
      reloadDirectRecords,
      reloadProgress,
      disconnectBaidu,
      expireBaiduSession,
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
    let hasOverlap = false
    for (const video of pageVideos) {
      if (!video || typeof video.sourceId !== 'string') {
        continue
      }

      if (seenSourceIds.has(video.sourceId)) {
        hasOverlap = true
        continue
      }

      seenSourceIds.add(video.sourceId)
      videos.push(video)
      addedOnPage += 1
    }

    if (pageVideos.length < BAIDU_PAGE_SIZE) {
      return videos
    }

    if (hasOverlap || addedOnPage === 0) {
      throw new Error('Overlapping Baidu catalog page')
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

function cloneDailyUnlockCourse(course: DailyUnlockCourse): DailyUnlockCourse {
  return { ...course, episodes: course.episodes.map((episode) => ({ ...episode })) }
}

function cloneDailyUnlockSettings(settings: DailyUnlockSettings): DailyUnlockSettings {
  return { enabled: settings.enabled, courses: settings.courses.map(cloneDailyUnlockCourse) }
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
  dailyUnlockRepository: new DailyUnlockRepository(uniStorage),
  authRepository: new AuthRepository(uniStorage),
  directLinkService: new DirectLinkService(uniStorage),
  progressRepository: new ProgressRepository(uniStorage),
  catalogCache: new CatalogCache(uniStorage, {
    root: runtimeConfig.baiduRoot
  }),
  baiduDriveSource: new BaiduDriveSource(runtimeConfig.baiduRoot),
  config: runtimeConfig,
  now: () => Date.now(),
  bootstrapMocks: runBootstrapMocks
}

export const useAppStore = createAppStore('app', runtimeDependencies)
