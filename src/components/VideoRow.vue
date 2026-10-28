<script setup lang="ts">
import { computed } from 'vue'

import type { VideoItem, VideoUnlockStatus } from '@/domain/video'

import VideoThumbnail from './VideoThumbnail.vue'

const props = defineProps<{
  video: VideoItem
  progressSeconds?: number
  durationSeconds?: number
  unlockStatus?: VideoUnlockStatus
  display?: 'row' | 'card' | 'history'
}>()

const emit = defineEmits<{
  select: [video: VideoItem]
}>()

const displayName = computed(() => {
  const name = typeof props.video?.name === 'string' ? props.video.name.trim() : ''
  return name || '未命名视频'
})

const lockLabel = computed(() => {
  if (!props.unlockStatus?.locked) return ''
  const episode = props.unlockStatus.episodeNumber
  return typeof episode === 'number' ? `第${episode}集待解锁` : '课程暂未解锁'
})
const unlockAtLabel = computed(() => {
  const timestamp = props.unlockStatus?.unlockAt
  if (!props.unlockStatus?.locked || typeof timestamp !== 'number') return ''
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${padTime(date.getMonth() + 1)}-${padTime(date.getDate())} 00:00`
})
const durationLabel = computed(() => formatDuration(
  props.durationSeconds ?? props.video?.durationSeconds
))
const cardMetadata = computed(() => {
  const path = typeof props.video?.path === 'string' ? props.video.path : ''
  if (props.video?.sourceType === 'direct') return '媒体直链'
  if (!isSafeLocalPath(path)) return '百度网盘'
  const segments = path.split('/').filter(Boolean)
  return segments.length > 1 ? segments[segments.length - 2] : '百度网盘'
})
const metadata = computed(() => {
  const parts = [safeSourceMetadata(props.video)]
  const progress = formatDuration(props.progressSeconds)
  const duration = formatDuration(
    props.durationSeconds ?? props.video?.durationSeconds
  )

  if (progress) {
    parts.push(`已看到 ${progress}`)
  }

  if (duration) {
    parts.push(`时长 ${duration}`)
  }

  return parts.join(' · ')
})

function selectVideo(): void {
  emit('select', props.video)
}

function safeSourceMetadata(video: VideoItem): string {
  if (video?.sourceType === 'direct') {
    return '媒体直链'
  }

  const path = typeof video?.path === 'string' ? video.path.trim() : ''
  if (!isSafeLocalPath(path)) {
    return '百度网盘'
  }

  return `百度网盘 · ${path}`
}

function isSafeLocalPath(path: string): boolean {
  return Boolean(
    path &&
      path.startsWith('/') &&
      !path.startsWith('//') &&
      !/[\u0000-\u001f\u007f]/u.test(path) &&
      !path.includes('://') &&
      !path.includes('?') &&
      !path.includes('#')
  )
}

function formatDuration(value: number | undefined): string | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return undefined
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
  <button
    class="video-row"
    :class="{ 'video-row--card': display === 'card', 'video-row--history': display === 'history' }"
    :aria-label="unlockStatus?.locked ? `播放视频：${displayName}（${lockLabel}）` : `播放视频：${displayName}`"
    @click="selectVideo"
  >
    <view class="video-row__thumbnail">
      <VideoThumbnail
        :src="video?.thumbnailUrl"
        :name="displayName"
      />
      <text v-if="display && durationLabel" class="video-row__duration">{{ durationLabel }}</text>
    </view>
    <view class="video-row__content">
      <text class="video-row__name video-row__name--two-lines">
        {{ displayName }}
      </text>
      <text class="video-row__metadata" :title="display === 'card' ? cardMetadata : metadata">
        <template v-if="display === 'card'">{{ durationLabel || '—' }}　▰ {{ cardMetadata }}</template>
        <template v-else-if="display === 'history'">{{ cardMetadata }}</template>
        <template v-else>{{ metadata }}</template>
      </text>
      <view v-if="unlockStatus?.locked" class="video-row__unlock" aria-label="待解锁">
        <text class="video-row__unlock-badge">{{ lockLabel }}</text>
        <text v-if="unlockAtLabel" class="video-row__unlock-time">{{ unlockAtLabel }} 解锁</text>
      </view>
    </view>
    <text v-if="display === 'history'" class="video-row__chevron" aria-hidden="true">›</text>
  </button>
</template>

<style scoped lang="scss">
@use '@/styles/tokens.scss' as *;

.video-row {
  box-sizing: border-box;
  display: grid;
  grid-template-columns: 208rpx minmax(0, 1fr);
  align-items: center;
  width: 100%;
  min-width: 0;
  min-height: 100rpx;
  margin: 0;
  padding: 14rpx 0;
  border: 0;
  border-radius: 0;
  color: $color-text;
  text-align: left;
  background: transparent;
}

.video-row:focus-visible {
  outline: 2px solid $color-primary;
  outline-offset: 2px;
}

.video-row__thumbnail,
.video-row__content { min-width: 0; }

.video-row--card {
  display: flex;
  min-height: 0;
  flex-direction: column;
  align-items: stretch;
  padding: 0;
}

.video-row--card .video-row__thumbnail {
  position: relative;
  width: 100%;
  border-radius: 6px;
}

.video-row--card .video-row__content { margin: 8rpx 2rpx 0; }

.video-row--card .video-row__name {
  font-size: 22rpx;
  font-weight: 650;
  line-height: 1.3;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.video-row--card .video-row__metadata {
  margin-top: 3rpx;
  font-size: 17rpx;
}

.video-row__duration {
  position: absolute;
  right: 8rpx;
  bottom: 7rpx;
  padding: 2rpx 7rpx;
  border-radius: 4px;
  color: #fff;
  font-size: 16rpx;
  line-height: 1.25;
  background: rgba(0, 0, 0, 0.62);
}

.video-row__thumbnail {
  width: 208rpx;
  overflow: hidden;
  border-radius: 12px;
}

.video-row__content {
  display: flex;
  min-width: 0;
  flex-direction: column;
  margin-left: 18rpx;
}

.video-row__name {
  overflow: hidden;
  color: $color-text;
  font-size: 24rpx;
  font-weight: 620;
  line-height: 1.38;
  overflow-wrap: anywhere;
}

.video-row__name--two-lines {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.video-row__metadata {
  display: block;
  margin-top: 6rpx;
  overflow: hidden;
  color: $color-muted;
  font-size: 19rpx;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.video-row__unlock {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  margin-top: 7rpx;
}

.video-row__unlock-badge {
  padding: 4rpx 10rpx;
  border-radius: 999px;
  color: #7a5126;
  font-size: 17rpx;
  font-weight: 650;
  background: #f4e8cf;
}

.video-row__unlock-time {
  margin: 6rpx 0 0 8rpx;
  color: $color-muted;
  font-size: 17rpx;
}
.video-row--history { position: relative; padding-right: 30rpx; }
.video-row--history .video-row__thumbnail { position: relative; }
.video-row__chevron { position: absolute; right: 3rpx; top: 50%; transform: translateY(-50%); color: $color-muted; font-size: 34rpx; font-weight: 400; }
</style>
