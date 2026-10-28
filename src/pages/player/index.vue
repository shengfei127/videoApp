<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { onBackPress, onHide, onLoad, onUnload } from '@dcloudio/uni-app'
import { ArrowLeft, CircleAlert, Pause, Maximize, Play, RefreshCw, RotateCcw } from '@/components/icons'

import ResumeDialog from '@/components/ResumeDialog.vue'
import {
  readRuntimeBuildEnvironment,
  runtimeConfig
} from '@/config/runtime'
import type { PlaybackProgress, VideoItem, VideoUnlockStatus } from '@/domain/video'
import { BaiduDriveSource } from '@/features/baidu/baiduDriveSource'
import { BaiduError } from '@/features/baidu/baiduErrors'
import { useDailyUnlockClock } from '@/features/daily-unlock/dailyUnlockClock'
import {
  PlaybackResolutionError,
  PlaybackResolver,
  type PlayerPlaybackLoad
} from '@/features/playback/playbackResolver'
import { classifyPlaybackFailure } from '@/features/playback/playbackFailure'
import { findNextEpisode } from '@/features/playback/nextEpisode'
import { PlayerLifecycle } from '@/features/playback/playerLifecycle'
import { classifyProgress } from '@/features/playback/progressPolicy'
import { ProgressRepository } from '@/features/playback/progressRepository'
import { PLAYBACK_RATES, isPlaybackRate, readPlaybackRate, savePlaybackRate } from '@/features/playback/playerPreferences'
import { uniStorage } from '@/infrastructure/storage'
import { useAppStore } from '@/stores/appStore'

type PlayerStatus = 'loading' | 'ready' | 'not-found' | 'error' | 'unsupported' | 'locked' | 'unlocked'
type VideoEvent = Event & {
  detail?: { currentTime?: number; duration?: number; errMsg?: string }
}

const VIDEO_CONTEXT_ID = 'pianke-player-video'

const store = useAppStore()
const progressRepository = new ProgressRepository(uniStorage)
const playbackResolver = new PlaybackResolver(
  new BaiduDriveSource(runtimeConfig.baiduRoot)
)
const status = ref<PlayerStatus>('loading')
const playerError = ref('')
const progressSaveFailed = ref(false)
type ExitIntent = 'back' | 'home'
const pendingExit = ref<ExitIntent | null>(null)
let exitNavigationPending = false
const requestedVideoId = ref('')
const courseForVideo = computed(() => store.dailyUnlockSettings.courses.find((course) => course.episodes.some((episode) => episode.videoId === requestedVideoId.value)))
const activeVideo = ref<VideoItem | null>(null)
const playbackUrl = ref('')
const currentTime = ref(0)
const duration = ref(0)
const metadataReady = ref(false)
const playbackBegun = ref(false)
const resumeOpen = ref(false)
const selectedRate = ref(readPlaybackRate(uniStorage))
const playbackEnded = ref(false)
const nextEpisode = computed(() => playbackEnded.value && activeVideo.value
  ? findNextEpisode(activeVideo.value.id, store.dailyUnlockSettings.courses, store.mergedVideos,
    store.learningHistory, (id) => store.videoUnlockStatus(id).locked)
  : null)
const nativePlayer = supportsPrivilegedPlayerHeaders()
const nativeFullscreen = ref(false)
const rateMenuOpen = ref(false)
const isPlaying = ref(false)
const authorizationExpired = ref(false)
const lockStatus = ref<VideoUnlockStatus | null>(null)
let videoContext: UniNamespace.VideoContext | null = null
let playerLoad: PlayerPlaybackLoad | null = null
let lifecycle: PlayerLifecycle | null = null
let loadGeneration = 0
let reviewStartPending = false
let initialMetadataHandled = false
let nextNavigationPending = false
let pageUnloaded = false

const activeUnlockStatus = computed(() => {
  const videoId = activeVideo.value?.id
  return videoId ? store.videoUnlockStatus(videoId) : null
})
watch(activeUnlockStatus, (nextStatus) => {
  if (!nextStatus || (status.value !== 'locked' && status.value !== 'unlocked')) return
  lockStatus.value = nextStatus
  status.value = nextStatus.locked ? 'locked' : 'unlocked'
})
const lockDescription = computed(() => {
  const current = lockStatus.value
  if (!current) return '这集暂未开放'
  const episodeText = current.episodeNumber ? `第${current.episodeNumber}集` : '本集'
  const courseText = current.courseName ? `「${current.courseName}」` : '当前课程'
  return current.unlockAt
    ? `${courseText} ${episodeText} 将于 ${formatLocalUnlockTime(current.unlockAt)} 解锁`
    : current.locked
      ? `${courseText} ${episodeText} 暂未开放，课程已暂停，请到设置恢复学习计划`
      : `${courseText} ${episodeText} 已解锁，可以开始播放`
})

const savedProgress = computed<PlaybackProgress | null>(() => {
  const videoId = activeVideo.value?.id
  if (!videoId) {
    return null
  }

  return (
    store.progressHistory.find((progress) => progress.videoId === videoId) ??
    progressRepository.get(videoId) ??
    null
  )
})
const playerHeader = computed(() =>
  supportsPrivilegedPlayerHeaders() &&
  activeVideo.value?.sourceType === 'baidu'
    ? { 'User-Agent': 'pan.baidu.com' }
    : undefined
)
const sourceLabel = computed(() =>
  activeVideo.value?.sourceType === 'baidu' ? '原始画质' : '媒体直链'
)
const safePath = computed(() =>
  activeVideo.value?.sourceType === 'baidu' ? activeVideo.value.path : ''
)
const unsupportedSource = computed(() =>
  activeVideo.value?.sourceType === 'baidu'
    ? safePath.value
    : activeVideo.value
      ? '媒体直链文件'
      : ''
)

function supportsPrivilegedPlayerHeaders(): boolean {
  const platform = readRuntimeBuildEnvironment().uniPlatform
  return platform === 'app' || platform === 'app-plus'
}

useDailyUnlockClock((now) => store.refreshDailyUnlockClock(now))

onLoad((query) => {
  reviewStartPending = query?.restart === '1'
  void loadFromQuery(query?.id)
})

onBackPress((event) => {
  // Only our approved API back bypasses the guard; hardware back is intercepted.
  if (event.from === 'navigateBack' && exitNavigationPending) return false
  goBack()
  return true
})

onHide(() => {
  saveLifecycle('hide')
})

onUnload(() => {
  saveLifecycle('unload')
  pageUnloaded = true
  loadGeneration += 1
})

async function loadFromQuery(rawId: unknown): Promise<void> {
  const id = decodeVideoId(rawId)
  requestedVideoId.value = id ?? ''
  const video = id ? findVideo(id) : undefined
  loadGeneration += 1
  const generation = loadGeneration
  resetPlayer(video ?? null)

  if (!video) {
    status.value = 'not-found'
    playerError.value = '找不到视频，请同步视频库或重新关联课程视频'
    return
  }

  activeVideo.value = video
  store.refreshDailyUnlockClock(Date.now())
  const unlock = store.videoUnlockStatus(video.id)
  lockStatus.value = unlock
  if (unlock.locked) {
    status.value = 'locked'
    return
  }
  lifecycle = new PlayerLifecycle({
    videoId: video.id,
    save: saveProgress,
    onSaveError: () => { progressSaveFailed.value = true },
    onSaved: () => { progressSaveFailed.value = false },
    now: Date.now
  })
  status.value = 'loading'
  playerLoad = playbackResolver.createPlayerLoad(
    video,
    video.sourceType === 'baidu' ? store.authSession : null
  )

  try {
    const url = await playerLoad.resolve()
    if (generation !== loadGeneration) {
      return
    }
    playbackUrl.value = url
    videoContext = uni.createVideoContext(VIDEO_CONTEXT_ID)
    status.value = 'ready'
  } catch (error) {
    if (generation !== loadGeneration) {
      return
    }
    if (expireAuthorizationIfNeeded(error)) {
      return
    }
    applySafeError(error)
  }
}

function resetPlayer(video: VideoItem | null): void {
  activeVideo.value = video
  status.value = 'loading'
  lockStatus.value = null
  playbackUrl.value = ''
  currentTime.value = 0
  duration.value = 0
  metadataReady.value = false
  initialMetadataHandled = false
  playbackBegun.value = false
  resumeOpen.value = false
  selectedRate.value = readPlaybackRate(uniStorage)
  playbackEnded.value = false
  rateMenuOpen.value = false
  isPlaying.value = false
  authorizationExpired.value = false
  playerError.value = ''
  progressSaveFailed.value = false
  pendingExit.value = null
  exitNavigationPending = false
  playerLoad = null
  lifecycle = null
  videoContext = null
}

function onLoadedMetadata(event: Event): void {
  if (!isCurrentVideoEvent(event)) return
  duration.value = readDuration(event, duration.value)
  metadataReady.value = duration.value > 0
  lifecycle?.onMetadata(duration.value)
  videoContext = uni.createVideoContext(VIDEO_CONTEXT_ID)
  if (!metadataReady.value || initialMetadataHandled) return
  initialMetadataHandled = true
  videoContext.playbackRate(selectedRate.value)
  if (reviewStartPending) {
    reviewStartPending = false
    currentTime.value = 0
    resumeOpen.value = false
    videoContext.seek(0)
    videoContext.play()
    return
  }
  const progress = savedProgress.value
  resumeOpen.value = Boolean(progress && classifyProgress(
    progress.positionSeconds, duration.value
  ).resumable)
  if (resumeOpen.value) {
    videoContext.pause()
  }
}

function onPlay(event: Event): void {
  if (!isCurrentVideoEvent(event)) return
  if (resumeOpen.value) {
    videoContext?.pause()
    isPlaying.value = false
    return
  }
  isPlaying.value = true
  playbackEnded.value = false
  playbackBegun.value = true
  lifecycle?.onPlaybackBegin()
}

function onTimeUpdate(event: Event): void {
  if (!isCurrentVideoEvent(event)) return
  // App's native video reports duration in timeupdate, without loadedmetadata.
  if (!metadataReady.value && supportsPrivilegedPlayerHeaders() && readDuration(event, 0) > 0) {
    onLoadedMetadata(event)
  }
  if (resumeOpen.value) {
    return
  }
  currentTime.value = readCurrentTime(event, currentTime.value)
  duration.value = readDuration(event, duration.value)
  lifecycle?.onTimeUpdate(currentTime.value, duration.value)
  reloadProgress()
}

function onPause(event: Event): void {
  if (!isCurrentVideoEvent(event)) return
  isPlaying.value = false
  if (resumeOpen.value) return
  updateCurrentPlayback(event)
  lifecycle?.onPause(currentTime.value, duration.value)
  reloadProgress()
}

function onSeeked(event: Event): void {
  if (!isCurrentVideoEvent(event)) return
  updateCurrentPlayback(event)
  lifecycle?.onSeeked(currentTime.value, duration.value)
  reloadProgress()
}

function onEnded(event: Event): void {
  if (!isCurrentVideoEvent(event)) return
  isPlaying.value = false
  duration.value = readDuration(event, duration.value)
  currentTime.value = duration.value
  lifecycle?.onEnded(duration.value)
  reloadProgress()
  playbackEnded.value = true
  if (nativeFullscreen.value) {
    videoContext?.exitFullScreen()
    nativeFullscreen.value = false
  }
}

function onPlayerError(event: Event): void {
  if (!isCurrentVideoEvent(event)) return
  void handlePlayerError(event)
}

async function handlePlayerError(event: Event): Promise<void> {
  const errorLoad = playerLoad
  const errorGeneration = loadGeneration
  const errorVideoId = activeVideo.value?.id
  const message = readErrorMessage(event)
  const failure = classifyPlaybackFailure(undefined, message)
  if (failure.kind === 'unsupported') {
    status.value = 'unsupported'
    playerError.value = '设备无法播放此视频格式'
    return
  }

  if (
    activeVideo.value?.sourceType !== 'baidu' ||
    !isAuthorizationPlaybackFailure(message) ||
    !errorLoad
  ) {
    status.value = 'error'
    playerError.value = failure.message
    return
  }

  try {
    const url = await errorLoad.retryAfterAuthorizationFailure(
      new BaiduError('http', 403)
    )
    if (
      errorGeneration !== loadGeneration ||
      activeVideo.value?.id !== errorVideoId ||
      playerLoad !== errorLoad
    ) {
      return
    }
    playbackUrl.value = url
    videoContext = uni.createVideoContext(VIDEO_CONTEXT_ID)
    status.value = 'ready'
  } catch (error) {
    if (
      errorGeneration !== loadGeneration ||
      activeVideo.value?.id !== errorVideoId ||
      playerLoad !== errorLoad
    ) {
      return
    }
    if (expireAuthorizationIfNeeded(error)) {
      return
    }
    status.value = 'error'
    playerError.value =
      error instanceof PlaybackResolutionError && error.code === 'retry-exhausted'
        ? '无法刷新播放地址，请返回后重试'
        : classifyPlaybackFailure(error).message
  }
}

function continuePlayback(): void {
  const position = lifecycle?.continueFrom(
    savedProgress.value?.positionSeconds ?? 0
  ) ?? 0
  currentTime.value = position
  playbackBegun.value = true
  isPlaying.value = true
  lifecycle?.onPlaybackBegin()
  resumeOpen.value = false
  videoContext?.seek(position)
  videoContext?.play()
}

function restartPlayback(): void {
  const position = lifecycle?.restart() ?? 0
  currentTime.value = position
  resumeOpen.value = false
  videoContext?.seek(position)
  reloadProgress()
}

function setRate(rate: (typeof PLAYBACK_RATES)[number]): void {
  if (!isPlaybackRate(rate)) return
  selectedRate.value = rate
  videoContext?.playbackRate(rate)
  if (!savePlaybackRate(uniStorage, rate)) {
    uni.showToast({ title: '本次倍速已生效，未能保存设置', icon: 'none' })
  }
}

function toggleRateMenu(): void {
  rateMenuOpen.value = !rateMenuOpen.value
}

function togglePlayback(): void {
  if (resumeOpen.value) return
  videoContext ??= uni.createVideoContext(VIDEO_CONTEXT_ID)
  if (isPlaying.value) videoContext.pause()
  else videoContext.play()
}

function seekBy(offsetSeconds: number): void {
  if (!metadataReady.value || resumeOpen.value || status.value !== 'ready' || !Number.isFinite(offsetSeconds)) return
  const nextTime = Math.min(duration.value, Math.max(0, currentTime.value + offsetSeconds))
  currentTime.value = nextTime
  playbackEnded.value = false
  videoContext?.seek(nextTime)
  lifecycle?.onSeeked(nextTime, duration.value)
  reloadProgress()
}

function seekFromSlider(event: { detail?: { value?: number } }): void {
  const value = event.detail?.value
  if (typeof value !== 'number' || !Number.isFinite(value) || !metadataReady.value || resumeOpen.value || duration.value <= 0) return
  playbackEnded.value = false
  currentTime.value = Math.max(0, Math.min(duration.value, value))
  videoContext?.seek(currentTime.value)
  lifecycle?.onSeeked(currentTime.value, duration.value)
  reloadProgress()
}

function cycleNativeRate(): void {
  const index = PLAYBACK_RATES.indexOf(selectedRate.value)
  setRate(PLAYBACK_RATES[(index + 1) % PLAYBACK_RATES.length]!)
}

function seekNativeRail(event: { detail?: { x?: number } }): void {
  const x = event.detail?.x
  if (typeof x !== 'number' || duration.value <= 0) return
  const width = uni.getSystemInfoSync().windowWidth
  if (!width) return
  const ratio = Math.max(0, Math.min(1, (x - width * .18) / (width * .64)))
  seekFromSlider({ detail: { value: ratio * duration.value } })
}

function requestFullscreen(): void {
  videoContext?.requestFullScreen({ direction: 90 })
}

const progressPercent = computed(() =>
  duration.value > 0 ? Math.min(100, Math.max(0, currentTime.value / duration.value * 100)) : 0
)
const currentTimeLabel = computed(() => formatPlaybackTime(currentTime.value))
const durationLabel = computed(() => formatPlaybackTime(duration.value))

function formatPlaybackTime(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '00:00'
  const seconds = Math.floor(value)
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainder = seconds % 60
  const pad = (part: number) => String(part).padStart(2, '0')
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(remainder)}` : `${pad(minutes)}:${pad(remainder)}`
}

function formatLocalUnlockTime(timestamp: number): string {
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} 00:00`
}

function retry(): void {
  const id = activeVideo.value?.id
  if (id) {
    void loadFromQuery(encodeURIComponent(id))
  }
}

function reconnectBaidu(): void {
  uni.navigateTo({ url: '/pages/oauth/index' })
}

function goBack(): void {
  requestExit('back')
}

function returnToLearning(): void {
  requestExit('home')
}

function requestExit(intent: ExitIntent): void {
  if (pageUnloaded || nextNavigationPending || exitNavigationPending || pendingExit.value) return
  saveLifecycle('hide')
  if (progressSaveFailed.value) {
    pendingExit.value = intent
    isPlaying.value = false
    videoContext?.pause()
    if (nativeFullscreen.value) {
      videoContext?.exitFullScreen()
      nativeFullscreen.value = false
    }
    return
  }
  navigateAway(intent)
}

function retryExitSave(): void {
  const intent = pendingExit.value
  if (!intent || exitNavigationPending) return
  // Keep the original lifecycle and position while the user frees storage.
  saveLifecycle('hide')
  if (!progressSaveFailed.value) navigateAway(intent)
}

function leaveWithoutSaving(): void {
  if (pendingExit.value && !exitNavigationPending) navigateAway(pendingExit.value)
}

function navigateAway(intent: ExitIntent): void {
  exitNavigationPending = true
  const fail = () => {
    if (pageUnloaded) return
    exitNavigationPending = false
    uni.showToast({ title: '无法返回，请重试', icon: 'none' })
  }
  const home = () => {
    try {
      uni.redirectTo({ url: '/pages/home/index', fail })
    } catch {
      fail()
    }
  }
  if (intent === 'home' || typeof getCurrentPages !== 'function' || getCurrentPages().length <= 1) {
    home()
    return
  }
  try {
    uni.navigateBack({ fail: home })
  } catch {
    home()
  }
}

function playNextEpisode(): void {
  if (nextNavigationPending || exitNavigationPending || pendingExit.value || pageUnloaded || !playbackEnded.value || status.value !== 'ready') return
  const suggestedId = nextEpisode.value?.id
  if (!suggestedId) return
  // Keep the current lifecycle alive until its final position is safely saved.
  saveLifecycle('hide')
  if (progressSaveFailed.value) return
  store.refreshDailyUnlockClock(Date.now())
  if (nextEpisode.value?.id !== suggestedId) return
  // Replace this player so refresh opens the same lesson and Back still returns
  // to the page that opened the course, without accumulating player pages.
  nextNavigationPending = true
  const fail = () => {
    if (pageUnloaded) return
    nextNavigationPending = false
    uni.showToast({ title: '无法打开下一节，请重试', icon: 'none' })
  }
  try {
    uni.redirectTo({
      url: `/pages/player/index?id=${encodeURIComponent(suggestedId)}`,
      fail
    })
  } catch {
    fail()
  }
}

function saveLifecycle(trigger: 'hide' | 'unload'): void {
  if (pageUnloaded || nextNavigationPending || exitNavigationPending || resumeOpen.value) return
  // Restart can fail before play begins; retry that explicit zero write too.
  if (progressSaveFailed.value && !playbackBegun.value && metadataReady.value) {
    lifecycle?.restart()
  } else if (trigger === 'hide') {
    lifecycle?.onHide(currentTime.value, duration.value)
  } else {
    lifecycle?.onUnload(currentTime.value, duration.value)
  }
  reloadProgress()
}

function saveProgress(
  videoId: string,
  positionSeconds: number,
  durationSeconds: number,
  updatedAt: number
): void {
  progressRepository.save(videoId, positionSeconds, durationSeconds, updatedAt)
}

function reloadProgress(): void {
  store.reloadProgress()
}

function findVideo(id: string): VideoItem | undefined {
  return store.mergedVideos.find((video) => video.id === id)
}

function decodeVideoId(rawId: unknown): string | undefined {
  if (typeof rawId !== 'string' || !rawId || rawId.length > 512) {
    return undefined
  }
  try {
    const decoded = decodeURIComponent(rawId)
    return decoded && !/[\u0000-\u001f\u007f]/u.test(decoded)
      ? decoded
      : undefined
  } catch {
    return undefined
  }
}

function updateCurrentPlayback(event: Event): void {
  currentTime.value = readCurrentTime(event, currentTime.value)
  duration.value = readDuration(event, duration.value)
}

function readCurrentTime(event: Event, fallback: number): number {
  const value = getVideoDetail(event)?.currentTime
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : fallback
}

function readDuration(event: Event, fallback: number): number {
  const value = getVideoDetail(event)?.duration
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : fallback
}

function readErrorMessage(event: Event): string {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline'
  const value = getVideoDetail(event)?.errMsg
  if (typeof value !== 'string' && (event.target as HTMLVideoElement | null)?.error?.code === 2) return 'network failure'
  return typeof value === 'string' ? value : ''
}

function getVideoDetail(event: Event): VideoEvent['detail'] | undefined {
  return (event as VideoEvent).detail
}

function isCurrentVideoEvent(event: Event): boolean {
  if (pageUnloaded || nextNavigationPending || exitNavigationPending || pendingExit.value) return false
  const target = (event.currentTarget ?? event.target) as { dataset?: { videoId?: string } } | null
  const eventVideoId = target?.dataset?.videoId
  return !eventVideoId || eventVideoId === activeVideo.value?.id
}

function isAuthorizationPlaybackFailure(message: string): boolean {
  return classifyPlaybackFailure(undefined, message).kind === 'forbidden'
}

function applySafeError(error: unknown): void {
  if (expireAuthorizationIfNeeded(error)) return
  const failure = classifyPlaybackFailure(error)
  status.value = failure.kind === 'unsupported' ? 'unsupported' : 'error'
  playerError.value = failure.message
}

function manageVideoSource(): void {
  uni.navigateTo({ url: courseForVideo.value ? '/pages/daily-unlock/index' : '/pages/library/index' })
}

function retryProgressSave(): void {
  if (resumeOpen.value || !metadataReady.value) return
  lifecycle?.onPause(currentTime.value, duration.value)
  reloadProgress()
}

function expireAuthorizationIfNeeded(error: unknown): boolean {
  if (
    !(
      (error instanceof PlaybackResolutionError &&
        error.code === 'authorization-required') ||
      (error instanceof BaiduError && error.kind === 'authorization')
    )
  ) {
    return false
  }

  loadGeneration += 1
  store.expireBaiduSession()
  authorizationExpired.value = true
  status.value = 'error'
  playerError.value = '百度网盘授权已过期，请重新连接百度网盘'
  return true
}
</script>

<template>
  <view class="player-page player-page--immersive">
    <header v-if="!nativePlayer || status !== 'ready' || resumeOpen" class="player-header">
      <button
        type="button"
        data-testid="player-back"
        class="player-back"
        aria-label="返回"
        title="返回"
        @click="goBack"
      >
        <ArrowLeft :size="22" aria-hidden="true" />
      </button>
      <view class="player-header__copy">
        <text class="player-header__title">{{ activeVideo?.name ?? '播放视频' }}</text>
      </view>
      <button v-if="status === 'ready'" type="button" data-testid="player-rate-menu" class="player-rate-menu" :aria-expanded="rateMenuOpen" aria-label="播放速度" @click="toggleRateMenu">{{ selectedRate === 1 ? '1.0' : selectedRate }}x</button>

    </header>

    <view v-if="!pendingExit && progressSaveFailed && (!nativePlayer || status !== 'ready' || resumeOpen)" class="player-save-warning" role="alert">
      <text>播放进度尚未保存，请检查存储空间后重试</text>
      <button data-testid="player-save-retry" @click="retryProgressSave">重试保存</button>
    </view>
    <main class="player-content">
      <view v-if="status === 'ready'" class="player-stage">
        <video
          :key="activeVideo?.id"
          :data-video-id="activeVideo?.id"
          v-show="!resumeOpen && !pendingExit"
          :id="VIDEO_CONTEXT_ID"
          data-testid="player-video"
          class="player-video"
          :src="playbackUrl"
          :header="playerHeader"
          :controls="nativeFullscreen"
          :show-center-play-btn="false"
          :show-fullscreen-btn="false"
          object-fit="contain"
          enable-play-gesture
          @loadedmetadata="onLoadedMetadata"
          @play="onPlay"
          @timeupdate="onTimeUpdate"
          @pause="onPause"
          @seeked="onSeeked"
          @ended="onEnded"
          @error="onPlayerError"
          @fullscreenchange="nativeFullscreen = Boolean($event.detail?.fullScreen)"
        >
          <cover-view v-if="nativePlayer && progressSaveFailed && !resumeOpen" class="native-save-warning" data-testid="player-save-retry" @click="retryProgressSave">进度未保存 · 点击重试保存</cover-view>
          <template v-if="nativePlayer && !resumeOpen && !nativeFullscreen">
            <cover-view class="native-title player-header__title">{{ activeVideo?.name ?? '播放视频' }}</cover-view>
            <cover-image data-testid="player-back" class="native-back" src="/static/icons/ArrowLeftWhite.png" @click="goBack" />
            <cover-view data-testid="player-rate-menu" class="native-rate" @click="cycleNativeRate">{{ selectedRate === 1 ? '1.0' : selectedRate }}x</cover-view>
            <cover-view class="native-current">{{ currentTimeLabel }}</cover-view>
            <cover-view class="native-duration">{{ durationLabel }}</cover-view>
            <cover-view class="native-track" />
            <cover-view class="native-track-value" :style="{ width: `${progressPercent * 0.64}%` }" />
            <cover-view class="native-knob" :style="{ left: `${18 + progressPercent * 0.64}%` }" />
            <cover-view data-testid="player-seek-rail" class="native-seek-hit" @click="seekNativeRail" />
            <cover-view class="native-rewind" aria-label="后退 10 秒" @click="seekBy(-10)">↶ 10</cover-view>
            <cover-image data-testid="player-toggle-playback" class="native-play" :src="isPlaying ? '/static/icons/PauseWhite.png' : '/static/icons/PlayWhite.png'" :aria-label="isPlaying ? '暂停播放' : '开始播放'" @click="togglePlayback" />
            <cover-view class="native-forward" aria-label="前进 10 秒" @click="seekBy(10)">10 ↷</cover-view>
            <cover-image class="native-fullscreen" src="/static/icons/MaximizeWhite.png" aria-label="全屏播放" @click="requestFullscreen" />
            <cover-view v-if="playbackEnded" class="native-ended-title">本节播放完毕</cover-view>
            <cover-view v-if="nextEpisode" data-testid="player-next-title" class="native-next-title">下一节：{{ nextEpisode.name }}</cover-view>
            <cover-view v-if="nextEpisode" data-testid="player-next-episode" class="native-ended-return native-next-button" @click="playNextEpisode">播放下一节</cover-view>
            <cover-view v-if="playbackEnded" data-testid="player-return-learning" class="native-ended-return" :class="{ 'native-ended-return--secondary': nextEpisode }" @click="returnToLearning">返回今日学习</cover-view>
          </template>
        </video>
        <view v-if="playbackEnded && !nativePlayer" class="player-ended" role="status">
          <text>本节播放完毕</text>
          <text v-if="nextEpisode" data-testid="player-next-title" class="player-next-title">下一节：{{ nextEpisode.name }}</text>
          <button v-if="nextEpisode" data-testid="player-next-episode" class="player-action player-action--primary" @click="playNextEpisode">播放下一节</button>
          <button data-testid="player-return-learning" class="player-action player-action--primary" @click="returnToLearning">返回今日学习</button>
        </view>
        <view v-if="!nativePlayer && !resumeOpen" class="player-controls" aria-label="视频播放控制">
          <view class="player-controls__timeline-row">
            <text class="player-controls__time">{{ currentTimeLabel }}</text>
            <slider data-testid="player-seek-rail" class="player-controls__seek-rail" :min="0" :max="Math.max(1, Math.floor(duration))" :value="Math.floor(currentTime)" :disabled="duration <= 0" :block-size="10" activeColor="#ffffff" backgroundColor="rgba(255,255,255,0.3)" blockColor="#ffffff" aria-label="播放进度" @change="seekFromSlider" />
            <text class="player-controls__time">{{ durationLabel }}</text>
          </view>
          <view class="player-controls__transport">
            <button type="button" class="player-transport-button" aria-label="后退 10 秒" @click="seekBy(-10)"><RotateCcw :size="24" aria-hidden="true" /><text>10</text></button>
            <button type="button" data-testid="player-toggle-playback" class="player-transport-button player-transport-button--primary" :aria-label="isPlaying ? '暂停播放' : '开始播放'" @click="togglePlayback">
              <Pause v-if="isPlaying" :size="30" aria-hidden="true" /><Play v-else :size="30" fill="currentColor" aria-hidden="true" />
            </button>
            <button type="button" class="player-transport-button player-transport-button--forward" aria-label="前进 10 秒" @click="seekBy(10)"><RotateCcw :size="24" aria-hidden="true" /><text>10</text></button>
            <button type="button" class="player-transport-button player-transport-button--aux" aria-label="全屏播放" @click="requestFullscreen"><Maximize :size="21" aria-hidden="true" /></button>
          </view>
        </view>
        <view v-if="rateMenuOpen" class="player-rate-menu__panel" role="group" aria-label="播放速度选项">
          <button v-for="rate in PLAYBACK_RATES" :key="rate" type="button" data-testid="player-rate" class="player-rate-option" :class="{ 'player-rate-option--active': selectedRate === rate }" :aria-pressed="selectedRate === rate" @click="setRate(rate); rateMenuOpen = false">{{ rate }}x</button>
        </view>
      </view>

      <view v-else-if="status === 'loading'" class="player-state" aria-live="polite">
        正在准备播放
      </view>

      <view v-else-if="status === 'locked'" class="player-state player-state--locked" data-testid="player-locked">
        <CircleAlert :size="30" aria-hidden="true" />
        <text role="status">课程内容尚未解锁</text>
        <text class="player-state__lock-detail">{{ lockDescription }}</text>
        <text class="player-state__lock-note">到达本机自然日零点后会自动更新状态</text>
        <button type="button" class="player-action" @click="goBack">返回视频库</button>
      </view>

      <view v-else-if="status === 'unlocked'" class="player-state player-state--locked" data-testid="player-unlocked">
        <CircleAlert :size="30" aria-hidden="true" />
        <text role="status">课程已解锁</text>
        <text class="player-state__lock-detail">{{ lockDescription }}</text>
        <button type="button" data-testid="player-start-unlocked" class="player-action player-action--primary" @click="retry">开始播放</button>
      </view>

      <view v-else class="player-state player-state--error">
        <CircleAlert :size="30" aria-hidden="true" />
        <text role="alert">{{ playerError }}</text>
        <text v-if="status === 'unsupported' && unsupportedSource" class="player-state__path">
          {{ unsupportedSource }}
        </text>
        <view class="player-state__actions">
          <button
            v-if="status === 'error' && !authorizationExpired"
            type="button"
            data-testid="player-retry"
            class="player-action player-action--primary"
            @click="retry"
          >
            <RefreshCw :size="18" aria-hidden="true" />
            重试
          </button>
          <button
            v-if="status === 'error' && authorizationExpired"
            type="button"
            data-testid="player-reconnect"
            class="player-action player-action--primary"
            @click="reconnectBaidu"
          >
            重新连接百度网盘
          </button>
          <button type="button" data-testid="player-source-action" class="player-action" @click="manageVideoSource">{{ courseForVideo ? '重新关联课程视频' : '检查视频来源' }}</button>
          <button type="button" class="player-action" @click="goBack">返回视频库</button>
        </view>
      </view>

      <text v-if="status === 'ready'" class="player-details__label player-visually-hidden">{{ sourceLabel }}</text>
    </main>

    <view v-if="pendingExit" class="player-exit-overlay">
      <view class="player-exit-dialog" data-testid="player-exit-dialog" role="dialog" aria-modal="true" aria-label="播放进度尚未保存">
        <text class="player-exit-title">播放进度尚未保存</text>
        <text>请检查存储空间后重试。仍然离开可能丢失本次播放进度。</text>
        <button data-testid="player-exit-retry" class="player-action player-action--primary" @click="retryExitSave">重试保存</button>
        <button data-testid="player-exit-anyway" class="player-action" @click="leaveWithoutSaving">仍然离开</button>
      </view>
    </view>
    <ResumeDialog
      :open="resumeOpen && metadataReady"
      :progress="savedProgress"
      @continue="continuePlayback"
      @restart="restartPlayback"
    />
  </view>
</template>

<style scoped lang="scss">
@use '@/styles/tokens.scss' as *;

.player-page {
  position: relative;
  box-sizing: border-box;
  width: 100%;
  height: 100vh;
  min-height: 100vh;
  padding: 0;
  overflow: hidden;
  color: #f8f5ed;
  background: $color-player;
}

.player-header {
  position: absolute;
  z-index: 4;
  top: max(20rpx, env(safe-area-inset-top, 0px));
  right: 24rpx;
  left: 24rpx;
  display: flex;
  align-items: center;
  min-height: 82rpx;
  padding: 0 12rpx;
  border-radius: 12px;
  background: linear-gradient(180deg, rgba(0, 18, 16, 0.6), rgba(0, 18, 16, 0));
}

.player-back {
  display: flex;
  width: 56rpx;
  height: 60rpx;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  margin: 0 12rpx 0 0;
  padding: 0;
  border: 0;
  color: #fff;
  background: transparent;
}

.player-header__copy { display: flex; min-width: 0; flex: 1; flex-direction: column; }
.player-header__title { overflow: hidden; color: #fff; font-size: 27rpx; font-weight: 650; line-height: 1.35; text-overflow: ellipsis; white-space: nowrap; }
.player-rate-menu,
.player-more { display: flex; align-items: center; justify-content: center; box-sizing: border-box; min-height: 44px; flex: 0 0 auto; margin-left: 12rpx; padding: 8rpx 10rpx; border: 0; color: #fff; font-size: 22rpx; line-height: 1.4; background: transparent; }
.player-more { font-size: 32rpx; line-height: 1; }

.player-content { position: absolute; inset: 0; margin: 0; }
.player-stage { position: absolute; inset: 0; overflow: hidden; background: #020807; }
.player-video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }

.player-ended { position: absolute; z-index: 4; top: 42%; left: 10%; right: 10%; padding: 24rpx; border-radius: 12px; background: rgba(0, 28, 24, .94); text-align: center; color: #fff; font-size: 28rpx; }
.player-ended .player-action { margin-top: 20rpx; }
.player-next-title { display: block; margin-top: 12rpx; overflow-wrap: anywhere; }
.player-controls {
  position: absolute;
  z-index: 3;
  right: 25rpx;
  bottom: calc(28rpx + env(safe-area-inset-bottom));
  left: 25rpx;
  color: #fff;
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.45);
}

.player-controls__timeline-row { display: flex; align-items: center; }
.player-controls__time { flex: 0 0 auto; font-size: 18rpx; font-variant-numeric: tabular-nums; }
.player-controls__seek-rail { position: relative; height: 30rpx; flex: 1; margin: 0 14rpx; cursor: pointer; }
.player-controls__seek-track { position: absolute; top: 13rpx; right: 0; left: 0; height: 4rpx; border-radius: 999px; background: rgba(255, 255, 255, 0.34); }
.player-controls__seek-value { height: 100%; border-radius: inherit; background: #fff; }
.player-controls__seek-knob { position: absolute; top: 8rpx; width: 13rpx; height: 13rpx; border-radius: 50%; background: #fff; transform: translateX(-50%); }
.player-controls__transport { display: flex; align-items: center; justify-content: center; margin-top: 16rpx; }
.player-transport-button { position: relative; display: flex; width: 70rpx; height: 66rpx; align-items: center; justify-content: center; margin: 0 14rpx; padding: 0; border: 0; color: #fff; font-size: 27rpx; background: transparent; }
.player-transport-button--primary { width: 74rpx; font-size: 34rpx; }
.player-transport-button--forward { transform: scaleX(-1); }
.player-transport-button--forward > text { transform: scaleX(-1); }
.player-transport-button > text { position: absolute; top: 26rpx; font-size: 14rpx; font-weight: 700; }
.player-transport-button--aux { width: 54rpx; margin-left: 28rpx; font-size: 29rpx; }
.player-rate-menu__panel { position: absolute; z-index: 5; top: 96rpx; right: 26rpx; display: flex; padding: 8rpx; border: 1px solid rgba(255,255,255,.18); border-radius: 10px; background: rgba(0, 28, 24, .92); }
.player-rate-option { display: flex; align-items: center; justify-content: center; box-sizing: border-box; min-height: 44px; min-width: 64rpx; margin: 0 3rpx; padding: 9rpx 5rpx; border: 0; border-radius: 6px; color: rgba(255,255,255,.78); font-size: 18rpx; line-height: 1.4; background: transparent; }
.player-rate-option--active { color: #fff; background: rgba(0,100,90,.8); }
.player-visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; }

.player-state {
  box-sizing: border-box;
  display: flex;
  min-height: 100vh;
  align-items: center;
  justify-content: center;
  color: rgba(248, 245, 237, 0.7);
  background: $color-player;
}

.player-state--error,
.player-state--locked {
  min-height: 420rpx;
  flex-direction: column;
  padding: 36rpx 28rpx;
  color: #f7f5ed;
  text-align: center;
}

.player-state--error > text,
.player-state--locked > text {
  margin-top: 14rpx;
}

.player-state__lock-detail {
  max-width: 90%;
  color: rgba(247, 245, 237, 0.9);
  font-size: 23rpx;
  line-height: 1.5;
}

.player-state__lock-note {
  color: rgba(247, 245, 237, 0.62);
  font-size: 20rpx;
  line-height: 1.45;
}

.player-state__path,
.player-details__path {
  overflow-wrap: anywhere;
}

.player-state__path {
  margin-top: 14rpx;
  color: rgba(247, 245, 237, 0.62);
  font-size: 20rpx;
}

.player-state__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  margin-top: 22rpx;
}

.player-action {
  box-sizing: border-box;
  display: flex;
  min-height: 70rpx;
  align-items: center;
  justify-content: center;
  margin: 0 6rpx;
  padding: 10rpx 18rpx;
  border: 1px solid rgba(247, 245, 237, 0.2);
  border-radius: 14px;
  color: #f7f5ed;
  font-size: 21rpx;
  line-height: 1.3;
  text-align: center;
  white-space: normal;
  background: rgba(255, 255, 255, 0.08);
}

.player-action--primary {
  border-color: #118264;
  color: #fff;
  background: #087858;
}

.player-action .app-icon {
  margin-right: 8rpx;
  filter: brightness(0) invert(1);
}


.player-header .app-icon, .player-controls .app-icon { filter: brightness(0) invert(1); }
.player-controls { padding-top: 36rpx; }
.player-state--error, .player-state--locked { min-height: 100vh; }
.player-controls__seek-rail { margin: 0 14rpx; height: auto; }

/* App video is native: cover components keep the controls above its surface. */
.native-title, .native-rate, .native-current, .native-duration, .native-rewind, .native-forward { position: absolute; z-index: 4; color: #fff; background-color: transparent; line-height: 32px; }
.native-title { top: 32px; left: 14%; width: 62%; height: 34px; font-size: 15px; }
.native-back { position: absolute; top: 36px; left: 5%; width: 22px; height: 22px; }
.native-rate { top: 32px; right: 5%; width: 48px; height: 44px; line-height: 44px; font-size: 14px; text-align: center; }
.native-current, .native-duration { bottom: 84px; height: 30px; font-size: 11px; }
.native-current { left: 5%; }
.native-duration { right: 5%; }
.native-track, .native-track-value { position: absolute; left: 18%; bottom: 98px; height: 2px; background-color: #647e79; }
.native-track { width: 64%; }
.native-track-value { background-color: #fff; }
.native-knob { position: absolute; bottom: 95px; width: 8px; height: 8px; border-radius: 4px; background-color: #fff; }
.native-seek-hit { position: absolute; left: 18%; bottom: 80px; width: 64%; height: 38px; background-color: rgba(0,0,0,0); }
.native-rewind, .native-forward { bottom: 30px; width: 58px; height: 44px; line-height: 44px; text-align: center; font-size: 18px; }
.native-rewind { left: 20%; }
.native-forward { right: 20%; }
.native-play { position: absolute; left: 46%; bottom: 34px; width: 30px; height: 30px; }
.native-ended-title { position: absolute; top: 42%; left: 12%; width: 76%; height: 42px; line-height: 42px; text-align: center; color: #fff; background-color: #00241f; font-size: 18px; }
.native-ended-return { position: absolute; top: 50%; left: 22%; width: 56%; height: 46px; line-height: 46px; text-align: center; color: #fff; background-color: #087858; border-radius: 10px; font-size: 16px; }
.native-next-title { position: absolute; top: 49%; left: 12%; width: 76%; height: 30px; line-height: 30px; text-align: center; color: #fff; background-color: #00241f; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.native-next-button { top: 55%; }
.native-ended-return--secondary { top: 65%; background-color: #23453e; }
.native-fullscreen { position: absolute; right: 5%; bottom: 37px; width: 22px; height: 22px; }
.player-exit-overlay { position: fixed; inset: 0; z-index: 100; display: flex; align-items: center; justify-content: center; padding: 24px; background: rgba(0, 0, 0, .72); }
.player-exit-dialog { width: 100%; max-width: 360px; padding: 24px; border-radius: 16px; background: #092f28; color: #fff; font-size: 16px; }
.player-exit-title { display: block; margin-bottom: 12px; font-size: 20px; font-weight: 600; }
.player-exit-dialog button { display: flex; width: 100%; min-height: 44px; margin-top: 12px; }
.player-save-warning { position: fixed; z-index: 60; left: 12px; right: 12px; top: calc(env(safe-area-inset-top, 0px) + 58px); padding: 12px; border-radius: 8px; background: #fff4d6; color: #593900; font-size: 14px; display: flex; flex-wrap: wrap; align-items: center; }
.player-save-warning button { display: flex; align-items: center; justify-content: center; box-sizing: border-box; min-height: 44px; margin: 4px 0 0 8px; padding: 8px 12px; font-size: 14px; line-height: 1.4; text-align: center; white-space: normal; }
.native-save-warning { position: absolute; left: 10%; right: 10%; top: 22%; height: 44px; line-height: 44px; text-align: center; font-size: 14px; background-color: #fff4d6; color: #593900; }
.player-state__actions { flex-wrap: wrap; }
.player-state__actions .player-action { min-height: 44px; white-space: normal; }
@media (max-width: 360px) { .player-state__actions { flex-direction: column; } .player-state__actions .player-action { width: 100%; margin-left: 0; } }
</style>
