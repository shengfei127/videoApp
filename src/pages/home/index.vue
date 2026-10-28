<script setup lang="ts">
import { computed, ref } from 'vue'
import { Play, Search } from '@/components/icons'

import BottomNav from '@/components/BottomNav.vue'
import VideoRow from '@/components/VideoRow.vue'
import VideoThumbnail from '@/components/VideoThumbnail.vue'
import type { VideoItem } from '@/domain/video'
import type { ContinueWatchingItem } from '@/stores/appStore'
import { useAppStore } from '@/stores/appStore'

const store = useAppStore()

const resumeItems = computed<ContinueWatchingItem[]>(() => {
  const items = store.continueWatching
  return Array.isArray(items) ? items.slice(0, 3) : []
})
const activeResumeIndex = ref(0)
const continueItem = computed<ContinueWatchingItem | undefined>(() =>
  resumeItems.value[activeResumeIndex.value] ?? resumeItems.value[0]
)
const recentVideos = computed<VideoItem[]>(() => {
  const items = store.recentVideos
  return Array.isArray(items) ? items.slice(0, 6) : []
})
const resumeTimestamp = computed(() =>
  formatTimestamp(continueItem.value?.progress.positionSeconds)
)
const resumeDuration = computed(() =>
  formatTimestamp(continueItem.value?.progress.durationSeconds)
)
const resumePercent = computed(() => progressPercent(continueItem.value))
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

function selectResume(index: number): void {
  if (index >= 0 && index < resumeItems.value.length) {
    activeResumeIndex.value = index
  }
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
      <view class="home-header__brand">
        <image class="home-brand-mark" src="/static/brand/pianke-logo.png" mode="aspectFit" alt="片刻 Logo" />
        <text class="home-header__title" role="heading" aria-level="1">片刻</text>
      </view>
      <view class="home-header__actions">
        <button type="button" class="home-header__icon-button" aria-label="搜索视频" @click="openSource('/pages/library/index')">
          <Search :size="23" :stroke-width="1.9" aria-hidden="true" />
        </button>
      </view>
    </view>

    <view v-if="safeLastErrorText" class="home-error-band" role="status" aria-live="polite">{{ safeLastErrorText }}</view>

    <view v-if="continueItem" class="home-section home-resume-section" data-home-section="continue" role="region" aria-label="接着看">
      <button class="home-resume home-resume--hero" :aria-label="`继续播放：${safeVideoName(continueItem.video)}`" @click="openPlayer(continueItem.video)">
        <view class="home-resume__thumbnail">
          <VideoThumbnail :src="continueItem.video.thumbnailUrl" :name="safeVideoName(continueItem.video)" />
        </view>
        <view class="home-resume__content">
          <text class="home-resume__name">{{ safeVideoName(continueItem.video) }}</text>
          <text class="home-resume__eyebrow">接着看</text>
          <view class="home-resume__controls">
            <view class="home-resume__play" aria-hidden="true"><Play :size="19" fill="currentColor" /></view>
            <view class="home-resume__progress" role="progressbar" aria-label="播放进度" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="Math.round(resumePercent)">
              <view class="home-resume__progress-value" :style="{ width: `${resumePercent}%` }" />
            </view>
            <text class="home-resume__timestamp">{{ resumeTimestamp }} / {{ resumeDuration }}</text>
          </view>
        </view>
      </button>
      <view v-if="resumeItems.length > 1" class="home-resume__dots" aria-label="继续播放列表">
        <button v-for="(item, index) in resumeItems" :key="item.video.id" type="button" class="home-resume__dot" :class="{ 'home-resume__dot--active': activeResumeIndex === index }" :aria-label="`播放${safeVideoName(item.video)}`" :aria-current="activeResumeIndex === index ? 'true' : undefined" @click="selectResume(index)" />
      </view>
    </view>

    <view class="home-section home-recent" data-home-section="recent" role="region" aria-labelledby="recent-videos-title">
      <view class="home-section-heading">
        <text id="recent-videos-title" class="section-title" role="heading" aria-level="2">最近看过</text>
        <button type="button" class="home-section-heading__more" aria-label="查看全部最近视频" @click="openSource('/pages/library/index')">›</button>
      </view>
      <view v-if="recentVideos.length" class="home-recent__list">
        <VideoRow v-for="video in recentVideos" :key="video.id" :video="video" display="history" @select="openPlayer" />
      </view>
      <view v-else class="home-empty-band" role="status">看过视频后会显示在这里</view>
    </view>
  </view>
  <BottomNav active="home" />
</template>

<style scoped lang="scss">
@use '@/styles/tokens.scss' as *;

.home-page {
  overflow-x: hidden;
  padding-top: calc(max(var(--status-bar-height, 0px), env(safe-area-inset-top, 0px)) + 16rpx);
}

.home-header,
.home-header__brand,
.home-header__actions {
  display: flex;
  align-items: center;
}

.home-header {
  justify-content: space-between;
  padding: 6rpx 0 12rpx;
}

.home-header__brand { min-width: 0; }

.home-brand-mark {
  width: 52rpx;
  height: 52rpx;
  flex: 0 0 auto;
  margin-right: 10rpx;
  border-radius: 50%;
}

.home-header__title {
  color: $color-text;
  font-size: 42rpx;
  font-weight: 680;
  letter-spacing: 0.02em;
  line-height: 1.2;
}

.home-header__icon-button {
  position: relative;
  display: flex;
  width: 60rpx;
  height: 60rpx;
  align-items: center;
  justify-content: center;
  margin: 0 0 0 12rpx;
  padding: 0;
  border: 0;
  border-radius: 50%;
  color: $color-text;
  background: transparent;
}

.home-error-band {
  margin-top: 10rpx;
  padding: 18rpx 20rpx;
  border: 1px solid rgba($color-progress, 0.25);
  border-left: 5rpx solid $color-progress;
  border-radius: 9px;
  color: $color-text;
  font-size: 22rpx;
  line-height: 1.5;
  background: rgba($color-progress, 0.08);
}

.home-section { min-width: 0; }

.section-title {
  margin: 28rpx 0 14rpx;
  color: $color-text;
  font-size: 25rpx;
  font-weight: 650;
}

.home-resume {
  position: relative;
  display: block;
  box-sizing: border-box;
  height: 330rpx;
  width: calc(100% + 44rpx);
  margin-left: -22rpx;
  margin-top: 0;
  margin-bottom: 0;
  padding: 0;
  overflow: hidden;
  border: 0;
  border-radius: 8px;
  color: #fff;
  text-align: left;
  background: $color-player;
  box-shadow: 0 8rpx 20rpx rgba(22, 47, 37, 0.12);
}

.home-resume__thumbnail {
  position: absolute;
  inset: 0;
  width: 100%;
  overflow: hidden;
}

.home-resume__thumbnail :deep(.video-thumbnail) {
  height: 100%;
  padding-bottom: 0;
  border-radius: 0;
}

.home-resume__thumbnail :deep(.video-thumbnail)::after {
  position: absolute;
  inset: 28% 0 0;
  background: linear-gradient(180deg, rgba(3, 18, 15, 0) 0%, rgba(3, 18, 15, 0.76) 100%);
  content: '';
}

.home-resume__content {
  position: absolute;
  right: 18rpx;
  bottom: 28rpx;
  left: 30rpx;
  display: flex;
  flex-direction: column;
}

.home-resume__eyebrow {
  color: rgba(255, 255, 255, 0.8);
  font-size: 18rpx;
  line-height: 1.2;
}

.home-resume__name {
  display: -webkit-box;
  margin-top: 4rpx;
  overflow: hidden;
  color: #fff;
  font-size: 42rpx;
  font-weight: 700;
  line-height: 1.3;
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 1;
}

.home-resume__controls { display: flex; align-items: center; margin-top: 9rpx; }

.home-resume__play {
  display: flex;
  width: 46rpx;
  height: 46rpx;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  color: $color-primary;
  background: #fff;
}

.home-resume__progress {
  height: 5rpx;
  min-width: 0;
  flex: 1;
  margin: 0 12rpx;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.42);
}

.home-resume__progress-value { height: 100%; border-radius: inherit; background: #fff; }

.home-resume__timestamp {
  flex: 0 0 auto;
  color: rgba(255, 255, 255, 0.92);
  font-size: 18rpx;
  line-height: 1.2;
}

.home-resume__dots { display: flex; justify-content: center; padding: 10rpx 0 0; }

.home-resume__dot {
  width: 13rpx;
  height: 13rpx;
  margin: 0 5rpx;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: #c4c8bd;
}

.home-resume__dot--active { background: $color-primary; }

.home-section-heading { display: flex; align-items: center; justify-content: space-between; }
.home-section-heading .section-title { margin-top: 23rpx; margin-bottom: 10rpx; }

.home-section-heading__more {
  width: 44rpx;
  height: 48rpx;
  margin: 14rpx 0 8rpx;
  padding: 0;
  border: 0;
  color: $color-text;
  font-size: 36rpx;
  line-height: 1;
  background: transparent;
}

.home-resume:focus-visible,
.home-header__icon-button:focus-visible,
.home-section-heading__more:focus-visible {
  outline: 2px solid $color-primary;
  outline-offset: 2px;
}

.home-recent__list { padding: 0 0 4rpx; }
.home-recent__list :deep(.video-row + .video-row) { border-top: 0; }
.home-recent__list :deep(.video-row) { grid-template-columns: 170rpx minmax(0, 1fr); min-height: 118rpx; padding: 10rpx 0; }
.home-recent__list :deep(.video-row__thumbnail) { width: 170rpx; border-radius: 6px; }
.home-recent__list :deep(.video-row__content) { margin-left: 16rpx; }
.home-recent__list :deep(.video-row__name) { font-size: 28rpx; -webkit-line-clamp: 1; }
.home-recent__list :deep(.video-row__metadata) { margin-top: 4rpx; font-size: 22rpx; }

.home-empty-band {
  padding: 28rpx 20rpx;
  border: 1px dashed $color-border;
  border-radius: 11px;
  color: $color-muted;
  font-size: 21rpx;
  line-height: 1.5;
  text-align: center;
  background: rgba($color-surface, 0.54);
}

@media (max-width: 420px) {
  .home-resume__timestamp { font-size: 17rpx; }
}
</style>
