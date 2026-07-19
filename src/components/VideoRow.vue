<script setup lang="ts">
import { computed } from 'vue'

import type { VideoItem } from '@/domain/video'

import VideoThumbnail from './VideoThumbnail.vue'

const props = defineProps<{
  video: VideoItem
  progressSeconds?: number
  durationSeconds?: number
}>()

const emit = defineEmits<{
  select: [video: VideoItem]
}>()

const displayName = computed(() => {
  const name = typeof props.video?.name === 'string' ? props.video.name.trim() : ''
  return name || '未命名视频'
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
    :aria-label="`播放视频：${displayName}`"
    @click="selectVideo"
  >
    <view class="video-row__thumbnail">
      <VideoThumbnail
        :src="video?.thumbnailUrl"
        :name="displayName"
      />
    </view>
    <view class="video-row__content">
      <text class="video-row__name video-row__name--two-lines">
        {{ displayName }}
      </text>
      <text class="video-row__metadata" :title="metadata">
        {{ metadata }}
      </text>
    </view>
  </button>
</template>

<style scoped lang="scss">
@use '@/styles/tokens.scss' as *;

.video-row {
  box-sizing: border-box;
  display: grid;
  grid-template-columns: 208rpx minmax(0, 1fr);
  gap: 20rpx;
  align-items: center;
  width: 100%;
  min-width: 0;
  min-height: 88rpx;
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
.video-row__content {
  min-width: 0;
}

.video-row__thumbnail {
  width: 208rpx;
}

.video-row__content {
  display: flex;
  flex-direction: column;
  gap: 10rpx;
}

.video-row__name {
  overflow: hidden;
  font-size: 28rpx;
  font-weight: 650;
  line-height: 1.35;
  overflow-wrap: anywhere;
}

.video-row__name--two-lines {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.video-row__metadata {
  display: block;
  overflow: hidden;
  color: $color-muted;
  font-size: 22rpx;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
