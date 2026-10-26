<script setup lang="ts">
import { computed, ref } from 'vue'
import { onHide, onLoad, onUnload } from '@dcloudio/uni-app'
import { ArrowLeft, CircleAlert, Gauge, RefreshCw } from '@/components/icons'

import ResumeDialog from '@/components/ResumeDialog.vue'
import {
  readRuntimeBuildEnvironment,
  runtimeConfig
} from '@/config/runtime'
import type { PlaybackProgress, VideoItem } from '@/domain/video'
import { BaiduDriveSource } from '@/features/baidu/baiduDriveSource'
import { BaiduError } from '@/features/baidu/baiduErrors'
import {
  PlaybackResolutionError,
  PlaybackResolver,
  type PlayerPlaybackLoad
} from '@/features/playback/playbackResolver'
import { PlayerLifecycle } from '@/features/playback/playerLifecycle'
import { classifyProgress } from '@/features/playback/progressPolicy'
import { ProgressRepository } from '@/features/playback/progressRepository'
import { uniStorage } from '@/infrastructure/storage'
import { useAppStore } from '@/stores/appStore'

type PlayerStatus = 'loading' | 'ready' | 'not-found' | 'error' | 'unsupported'
type VideoEvent = Event & {
  detail?: { currentTime?: number; duration?: number; errMsg?: string }
}

const VIDEO_CONTEXT_ID = 'pianke-player-video'
const PLAYBACK_RATES = [0.5, 1, 1.25, 1.5, 2] as const

const store = useAppStore()
const progressRepository = new ProgressRepository(uniStorage)
const playbackResolver = new PlaybackResolver(
  new BaiduDriveSource(runtimeConfig.baiduRoot)
)
const status = ref<PlayerStatus>('loading')
const playerError = ref('')
const activeVideo = ref<VideoItem | null>(null)
const playbackUrl = ref('')
const currentTime = ref(0)
const duration = ref(0)
const metadataReady = ref(false)
const playbackBegun = ref(false)
const resumeOpen = ref(false)
const selectedRate = ref<(typeof PLAYBACK_RATES)[number]>(1)
const authorizationExpired = ref(false)
let videoContext: UniNamespace.VideoContext | null = null
let playerLoad: PlayerPlaybackLoad | null = null
let lifecycle: PlayerLifecycle | null = null
let loadGeneration = 0

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

onLoad((query) => {
  void loadFromQuery(query?.id)
})

onHide(() => {
  saveLifecycle('hide')
})

onUnload(() => {
  saveLifecycle('unload')
})

async function loadFromQuery(rawId: unknown): Promise<void> {
  const id = decodeVideoId(rawId)
  const video = id ? findVideo(id) : undefined
  loadGeneration += 1
  const generation = loadGeneration
  resetPlayer(video ?? null)

  if (!video) {
    status.value = 'not-found'
    playerError.value = '找不到视频'
    return
  }

  activeVideo.value = video
  lifecycle = new PlayerLifecycle({
    videoId: video.id,
    save: saveProgress,
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
  playbackUrl.value = ''
  currentTime.value = 0
  duration.value = 0
  metadataReady.value = false
  playbackBegun.value = false
  resumeOpen.value = false
  selectedRate.value = 1
  authorizationExpired.value = false
  playerError.value = ''
  playerLoad = null
  lifecycle = null
  videoContext = null
}

function onLoadedMetadata(event: Event): void {
  duration.value = readDuration(event, duration.value)
  metadataReady.value = duration.value > 0
  lifecycle?.onMetadata(duration.value)
  videoContext = uni.createVideoContext(VIDEO_CONTEXT_ID)
  const progress = savedProgress.value
  resumeOpen.value = Boolean(progress && classifyProgress(
    progress.positionSeconds, duration.value
  ).resumable)
  if (resumeOpen.value) {
    videoContext.pause()
  }
}

function onPlay(): void {
  if (resumeOpen.value) {
    videoContext?.pause()
    return
  }
  playbackBegun.value = true
  lifecycle?.onPlaybackBegin()
}

function onTimeUpdate(event: Event): void {
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
  if (resumeOpen.value) return
  updateCurrentPlayback(event)
  lifecycle?.onPause(currentTime.value, duration.value)
  reloadProgress()
}

function onSeeked(event: Event): void {
  updateCurrentPlayback(event)
  lifecycle?.onSeeked(currentTime.value, duration.value)
  reloadProgress()
}

function onEnded(event: Event): void {
  duration.value = readDuration(event, duration.value)
  currentTime.value = duration.value
  lifecycle?.onEnded(duration.value)
  reloadProgress()
}

function onPlayerError(event: Event): void {
  void handlePlayerError(event)
}

async function handlePlayerError(event: Event): Promise<void> {
  const errorLoad = playerLoad
  const errorGeneration = loadGeneration
  const errorVideoId = activeVideo.value?.id
  const message = readErrorMessage(event)
  if (isUnsupportedFormat(message)) {
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
    playerError.value = '播放失败，请稍后重试'
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
        : '播放失败，请稍后重试'
  }
}

function continuePlayback(): void {
  const position = lifecycle?.continueFrom(
    savedProgress.value?.positionSeconds ?? 0
  ) ?? 0
  currentTime.value = position
  playbackBegun.value = true
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
  selectedRate.value = rate
  videoContext?.playbackRate(rate)
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
  uni.navigateBack()
}

function saveLifecycle(trigger: 'hide' | 'unload'): void {
  if (resumeOpen.value) return
  if (trigger === 'hide') {
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
  const value = getVideoDetail(event)?.errMsg
  return typeof value === 'string' ? value : ''
}

function getVideoDetail(event: Event): VideoEvent['detail'] | undefined {
  return (event as VideoEvent).detail
}

function isAuthorizationPlaybackFailure(message: string): boolean {
  return /(?:^|\D)403(?:\D|$)|forbidden|authorization/iu.test(message)
}

function isUnsupportedFormat(message: string): boolean {
  return /unsupported|format|codec|decode/iu.test(message)
}

function applySafeError(error: unknown): void {
  if (expireAuthorizationIfNeeded(error)) {
    return
  }
  status.value = 'error'
  playerError.value =
    error instanceof PlaybackResolutionError && error.code === 'authorization-required'
      ? '请先连接百度网盘'
      : '无法加载播放地址，请稍后重试'
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
  <view class="player-page">
    <header class="player-header">
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
        <text v-if="activeVideo" class="player-header__source">{{ sourceLabel }}</text>
      </view>
    </header>

    <main class="player-content">
      <view v-if="status === 'ready'" class="player-stage">
        <video
          v-show="!resumeOpen"
          :id="VIDEO_CONTEXT_ID"
          data-testid="player-video"
          class="player-video"
          :src="playbackUrl"
          :header="playerHeader"
          controls
          enable-play-gesture
          show-center-play-btn
          show-fullscreen-btn
          @loadedmetadata="onLoadedMetadata"
          @play="onPlay"
          @timeupdate="onTimeUpdate"
          @pause="onPause"
          @seeked="onSeeked"
          @ended="onEnded"
          @error="onPlayerError"
        />
      </view>

      <view v-else-if="status === 'loading'" class="player-state" aria-live="polite">
        正在准备播放
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
          <button type="button" class="player-action" @click="goBack">返回视频库</button>
        </view>
      </view>

      <template v-if="status === 'ready'">
        <view class="player-details">
          <text class="player-details__label">{{ sourceLabel }}</text>
          <text v-if="activeVideo?.sourceType === 'baidu'" class="player-details__path">
            {{ safePath }}
          </text>
        </view>
        <view class="player-rates" role="group" aria-label="播放速度">
          <Gauge :size="19" aria-hidden="true" />
          <button
            v-for="rate in PLAYBACK_RATES"
            :key="rate"
            type="button"
            data-testid="player-rate"
            class="player-rate"
            :class="{ 'player-rate--active': selectedRate === rate }"
            :aria-pressed="selectedRate === rate"
            @click="setRate(rate)"
          >
            {{ rate }}x
          </button>
        </view>
      </template>
    </main>

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
  min-height: 100vh;
  padding: calc(max(var(--status-bar-height, 0px), env(safe-area-inset-top, 0px)) + 24rpx) 24rpx 48rpx;
  box-sizing: border-box;
  background: $color-bg;
}

.player-header {
  display: grid;
  grid-template-columns: 76rpx minmax(0, 1fr);
  gap: 16rpx;
  align-items: center;
  min-height: 92rpx;
}

.player-back {
  display: flex;
  width: 76rpx;
  height: 76rpx;
  align-items: center;
  justify-content: center;
  margin: 0;
  padding: 0;
  border: 1px solid $color-border;
  border-radius: $radius-control;
  color: $color-text;
  background: $color-surface;
}

.player-header__copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 4rpx;
}

.player-header__title {
  overflow: hidden;
  color: $color-text;
  font-size: 30rpx;
  font-weight: 740;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.player-header__source,
.player-details__label {
  color: $color-muted;
  font-size: 22rpx;
}

.player-content {
  display: flex;
  flex-direction: column;
  gap: 22rpx;
  margin-top: 20rpx;
}

.player-stage {
  position: relative;
  width: 100%;
  height: 0;
  padding-bottom: 56.25%;
  overflow: hidden;
  border-radius: $radius-card;
  background: $color-player;
}

.player-video {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
}

.player-state {
  display: flex;
  min-height: 420rpx;
  align-items: center;
  justify-content: center;
  border: 1px solid $color-border;
  border-radius: $radius-card;
  color: $color-muted;
  background: $color-surface;
}

.player-state--error {
  flex-direction: column;
  gap: 18rpx;
  padding: 36rpx;
  color: $color-text;
  text-align: center;
}

.player-state__path,
.player-details__path {
  overflow-wrap: anywhere;
}

.player-state__path {
  color: $color-muted;
  font-size: 22rpx;
}

.player-state__actions {
  display: flex;
  gap: 14rpx;
}

.player-action,
.player-rate {
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1.3;
  margin: 0;
  border-radius: $radius-control;
}

.player-action {
  display: flex;
  min-height: 70rpx;
  align-items: center;
  justify-content: center;
  gap: 8rpx;
  padding: 10rpx 18rpx;
  border: 1px solid $color-border;
  color: $color-text;
  font-size: 23rpx;
  background: $color-surface;
}

.player-action--primary {
  border-color: $color-primary;
  color: #ffffff;
  background: $color-primary;
}

.player-details {
  display: flex;
  flex-direction: column;
  gap: 8rpx;
}

.player-details__path {
  color: $color-text;
  font-size: 23rpx;
  line-height: 1.5;
}

.player-rates {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10rpx;
}

.player-rate {
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1.3;
  min-width: 78rpx;
  min-height: 60rpx;
  padding: 6rpx 12rpx;
  border: 1px solid $color-border;
  color: $color-text;
  font-size: 21rpx;
  background: $color-surface;
}

.player-rate--active {
  border-color: $color-primary;
  color: $color-primary;
  background: $color-primary-soft;
}
</style>
