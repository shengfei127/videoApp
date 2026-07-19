<script setup lang="ts">
import { computed } from 'vue'
import { Cloud, Link, Play, ShieldCheck } from 'lucide-vue-next'

import BottomNav from '@/components/BottomNav.vue'
import VideoRow from '@/components/VideoRow.vue'
import VideoThumbnail from '@/components/VideoThumbnail.vue'
import type { VideoItem } from '@/domain/video'
import type { ContinueWatchingItem } from '@/stores/appStore'
import { useAppStore } from '@/stores/appStore'

const store = useAppStore()

const showSourceActions = computed(
  () => !store.authSession && safeLength(store.directRecords) === 0
)
const continueItem = computed<ContinueWatchingItem | undefined>(() => {
  const items = store.continueWatching
  return Array.isArray(items) ? items[0] : undefined
})
const recentVideos = computed<VideoItem[]>(() => {
  const items = store.recentVideos
  return Array.isArray(items) ? items.slice(0, 6) : []
})
const resumeTimestamp = computed(() =>
  formatTimestamp(continueItem.value?.progress.positionSeconds)
)
const resumePercent = computed(() => progressPercent(continueItem.value))
const syncStatusText = computed(() => {
  switch (store.syncStatus) {
    case 'syncing':
      return '同步状态：正在同步'
    case 'success':
      return '同步状态：已同步'
    case 'cooldown':
      return '同步状态：稍后可同步'
    case 'error':
      return '同步状态：同步异常'
    default:
      return '同步状态：本地就绪'
  }
})
const safeLastErrorText = computed(() => {
  switch (store.lastError?.code) {
    case 'authorization':
      return '百度网盘授权已过期，请重新连接'
    case 'sync-failed':
      return '百度网盘同步失败，请稍后重试'
    case 'initialization':
      return '本地视频资料暂时无法完整加载'
    default:
      return undefined
  }
})

function openSource(path: string): void {
  uni.navigateTo({ url: path })
}

function openPlayer(video: VideoItem): void {
  const id = typeof video?.id === 'string' ? video.id : ''
  if (!id) {
    return
  }

  uni.navigateTo({
    url: `/pages/player/index?id=${encodeURIComponent(id)}`
  })
}

function safeLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0
}

function safeVideoName(video: VideoItem | undefined): string {
  const name = typeof video?.name === 'string' ? video.name.trim() : ''
  return name || '未命名视频'
}

function progressPercent(item: ContinueWatchingItem | undefined): number {
  const position = item?.progress.positionSeconds
  const duration = item?.progress.durationSeconds
  if (
    typeof position !== 'number' ||
    !Number.isFinite(position) ||
    typeof duration !== 'number' ||
    !Number.isFinite(duration) ||
    duration <= 0
  ) {
    return 0
  }

  return Math.min(100, Math.max(0, (position / duration) * 100))
}

function formatTimestamp(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return '00:00'
  }

  const seconds = Math.round(value)
  const hours = Math.floor(seconds / 3_600)
  const minutes = Math.floor((seconds % 3_600) / 60)
  const remainder = seconds % 60

  return hours > 0
    ? `${hours}:${padTime(minutes)}:${padTime(remainder)}`
    : `${padTime(minutes)}:${padTime(remainder)}`
}

function padTime(value: number): string {
  return String(value).padStart(2, '0')
}
</script>

<template>
  <view class="page-shell home-page">
    <view class="home-header">
      <view class="home-header__copy">
        <text class="home-header__title" role="heading" aria-level="1">
          片刻
        </text>
        <text class="home-header__subtitle">播放记录仅保存在本机</text>
      </view>
      <view
        data-testid="sync-status"
        class="home-header__status"
        role="status"
        aria-live="polite"
      >
        <ShieldCheck :size="18" :stroke-width="1.9" aria-hidden="true" />
        <text>{{ syncStatusText }}</text>
      </view>
    </view>

    <view
      v-if="safeLastErrorText"
      class="home-error-band"
      role="status"
      aria-live="polite"
    >
      {{ safeLastErrorText }}
    </view>

    <view
      v-if="continueItem"
      class="home-section"
      data-home-section="continue"
      role="region"
      aria-labelledby="continue-watching-title"
    >
      <text
        id="continue-watching-title"
        class="section-title"
        role="heading"
        aria-level="2"
      >
        接着看
      </text>
      <button
        class="home-resume"
        :aria-label="`继续播放：${safeVideoName(continueItem.video)}`"
        @click="openPlayer(continueItem.video)"
      >
        <view class="home-resume__thumbnail">
          <VideoThumbnail
            :src="continueItem.video.thumbnailUrl"
            :name="safeVideoName(continueItem.video)"
          />
        </view>
        <view class="home-resume__content">
          <text class="home-resume__name">
            {{ safeVideoName(continueItem.video) }}
          </text>
          <text class="home-resume__timestamp">已看到 {{ resumeTimestamp }}</text>
          <view
            class="home-resume__progress"
            role="progressbar"
            aria-label="播放进度"
            aria-valuemin="0"
            aria-valuemax="100"
            :aria-valuenow="Math.round(resumePercent)"
          >
            <view
              class="home-resume__progress-value"
              :style="{ width: `${resumePercent}%` }"
            />
          </view>
          <view class="home-resume__play">
            <Play :size="18" fill="currentColor" aria-hidden="true" />
            <text>继续播放</text>
          </view>
        </view>
      </button>
    </view>

    <view
      v-if="showSourceActions"
      class="home-section home-sources"
      data-home-section="sources"
      role="region"
      aria-labelledby="home-sources-title"
    >
      <text
        id="home-sources-title"
        class="section-title"
        role="heading"
        aria-level="2"
      >
        添加视频来源
      </text>
      <view class="home-source-list">
        <button
          class="home-source-action"
          aria-label="连接百度网盘"
          @click="openSource('/pages/oauth/index')"
        >
          <Cloud :size="24" :stroke-width="1.8" aria-hidden="true" />
          <view class="home-source-action__copy">
            <text class="home-source-action__title">连接百度网盘</text>
            <text class="home-source-action__description">
              读取应用专属目录中的视频
            </text>
          </view>
        </button>
        <button
          class="home-source-action"
          aria-label="导入媒体直链"
          @click="openSource('/pages/library/index?openImport=1')"
        >
          <Link :size="24" :stroke-width="1.8" aria-hidden="true" />
          <view class="home-source-action__copy">
            <text class="home-source-action__title">导入媒体直链</text>
            <text class="home-source-action__description">
              添加 HTTPS MP4 或 M3U8
            </text>
          </view>
        </button>
      </view>
    </view>

    <view
      class="home-section home-recent"
      data-home-section="recent"
      role="region"
      aria-labelledby="recent-videos-title"
    >
      <text
        id="recent-videos-title"
        class="section-title"
        role="heading"
        aria-level="2"
      >
        最近视频
      </text>
      <view v-if="recentVideos.length" class="home-recent__list">
        <VideoRow
          v-for="video in recentVideos"
          :key="video.id"
          :video="video"
          @select="openPlayer"
        />
      </view>
      <view v-else class="home-empty-band" role="status">
        还没有最近视频，添加来源后会显示在这里
      </view>
    </view>
  </view>

  <BottomNav active="home" />
</template>

<style scoped lang="scss">
@use '@/styles/tokens.scss' as *;

.home-page {
  width: 100%;
  max-width: 960rpx;
  margin: 0 auto;
  padding-top: calc(env(safe-area-inset-top) + 24rpx);
  padding-bottom: calc(156rpx + env(safe-area-inset-bottom));
  overflow-x: hidden;
}

.home-header {
  display: flex;
  gap: 20rpx;
  align-items: flex-start;
  justify-content: space-between;
  padding: 8rpx 0 18rpx;
  border-bottom: 1px solid $color-border;
}

.home-header__copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 6rpx;
}

.home-header__title {
  color: $color-text;
  font-size: 44rpx;
  font-weight: 750;
  line-height: 1.15;
}

.home-header__subtitle {
  color: $color-muted;
  font-size: 22rpx;
  line-height: 1.45;
}

.home-header__status {
  display: flex;
  flex: 0 0 auto;
  gap: 8rpx;
  align-items: center;
  padding-top: 8rpx;
  color: $color-primary;
  font-size: 21rpx;
  line-height: 1.4;
  white-space: nowrap;
}

.home-error-band {
  margin-top: 18rpx;
  padding: 18rpx 20rpx;
  border-left: 6rpx solid $color-progress;
  color: $color-text;
  font-size: 23rpx;
  line-height: 1.5;
  background: rgba($color-progress, 0.1);
}

.home-section {
  min-width: 0;
}

.section-title {
  display: block;
}

.home-source-list,
.home-recent__list {
  overflow: hidden;
  border: 1px solid $color-border;
  border-radius: $radius-card;
  background: $color-surface;
}

.home-source-action {
  box-sizing: border-box;
  display: grid;
  grid-template-columns: 48rpx minmax(0, 1fr);
  gap: 20rpx;
  align-items: center;
  width: 100%;
  min-height: 104rpx;
  margin: 0;
  padding: 20rpx 22rpx;
  border: 0;
  border-radius: 0;
  color: $color-primary;
  text-align: left;
  background: transparent;
}

.home-source-action + .home-source-action {
  border-top: 1px solid $color-border;
}

.home-source-action:focus-visible,
.home-resume:focus-visible {
  outline: 2px solid $color-primary;
  outline-offset: 2px;
}

.home-source-action__copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 4rpx;
}

.home-source-action__title {
  color: $color-text;
  font-size: 27rpx;
  font-weight: 700;
  line-height: 1.35;
}

.home-source-action__description {
  overflow: hidden;
  color: $color-muted;
  font-size: 21rpx;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.home-resume {
  box-sizing: border-box;
  display: grid;
  grid-template-columns: minmax(240rpx, 42%) minmax(0, 1fr);
  gap: 22rpx;
  align-items: center;
  width: 100%;
  min-height: 160rpx;
  margin: 0;
  padding: 20rpx;
  border: 1px solid $color-border;
  border-radius: $radius-card;
  color: $color-text;
  text-align: left;
  background: $color-surface;
}

.home-resume__thumbnail,
.home-resume__content {
  min-width: 0;
}

.home-resume__content {
  display: flex;
  flex-direction: column;
  gap: 10rpx;
}

.home-resume__name {
  display: -webkit-box;
  overflow: hidden;
  font-size: 28rpx;
  font-weight: 700;
  line-height: 1.35;
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.home-resume__timestamp {
  color: $color-muted;
  font-size: 22rpx;
  line-height: 1.4;
}

.home-resume__progress {
  width: 100%;
  height: 8rpx;
  overflow: hidden;
  border-radius: 4rpx;
  background: $color-border;
}

.home-resume__progress-value {
  height: 100%;
  border-radius: inherit;
  background: $color-progress;
}

.home-resume__play {
  display: flex;
  gap: 8rpx;
  align-items: center;
  color: $color-primary;
  font-size: 22rpx;
  font-weight: 700;
  line-height: 1.3;
}

.home-recent__list {
  padding: 0 20rpx;
}

.home-recent__list :deep(.video-row + .video-row) {
  border-top: 1px solid $color-border;
}

.home-empty-band {
  padding: 24rpx 20rpx;
  border-top: 1px solid $color-border;
  border-bottom: 1px solid $color-border;
  color: $color-muted;
  font-size: 23rpx;
  line-height: 1.5;
  background: rgba($color-surface, 0.56);
}

@media (max-width: 420px) {
  .home-header {
    flex-direction: column;
    gap: 8rpx;
  }

  .home-header__status {
    padding-top: 0;
  }

  .home-resume {
    grid-template-columns: 220rpx minmax(0, 1fr);
    gap: 18rpx;
    padding: 16rpx;
  }
}
</style>
