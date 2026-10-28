<script setup lang="ts">
import VideoRow from './VideoRow.vue'
import type { VideoItem } from '@/domain/video'
import { learningTimeLabel, type LearningLesson } from '@/features/daily-unlock/learningPlan'

defineProps<{ lesson: LearningLesson }>()
defineEmits<{ play: [video: VideoItem]; complete: [lesson: LearningLesson]; library: [] }>()
</script>

<template>
  <view class="learning-lesson" :data-lesson-id="lesson.id">
    <view class="learning-lesson__heading">
      <text class="learning-lesson__title">{{ lesson.courseName }} · 第 {{ lesson.episodeNumber }} 集</text>
      <text class="learning-lesson__status">{{ lesson.completed ? '已学完' : lesson.positionSeconds > 0 ? '继续学习' : '待学习' }}</text>
    </view>
    <VideoRow v-if="lesson.video" :video="lesson.video" display="history" @select="$emit('play', $event)" />
    <view v-else class="learning-lesson__missing">
      <text>{{ lesson.name }}</text><text>视频暂不可用，请到视频库同步或检查来源</text>
      <button class="learning-lesson__action" @click="$emit('library')">前往视频库</button>
    </view>
    <view class="learning-lesson__footer">
      <text>{{ learningTimeLabel(lesson) }}<template v-if="lesson.positionSeconds > 0 && !lesson.completed"> · 已看 {{ Math.floor(lesson.positionSeconds / 60) }}:{{ String(Math.floor(lesson.positionSeconds % 60)).padStart(2, '0') }}</template></text>
      <button class="learning-lesson__action" :aria-label="`${lesson.completed ? '撤销学完' : '标记学完'}：${lesson.name}`" @click="$emit('complete', lesson)">{{ lesson.completed ? '撤销学完' : '标记学完' }}</button>
    </view>
    <button v-if="lesson.completed && lesson.video" class="learning-lesson__review" @click="$emit('play', lesson.video)">复习本节</button>
  </view>
</template>

<style scoped lang="scss">
@use '@/styles/tokens.scss' as *;
.learning-lesson { padding: 18rpx; margin-bottom: 12rpx; border: 1px solid $color-border; border-radius: 12px; background: rgba($color-surface, .7); }
.learning-lesson__heading, .learning-lesson__footer { display: flex; align-items: center; justify-content: space-between; }
.learning-lesson__heading > * + *, .learning-lesson__footer > * + * { margin-left: 12rpx; }
.learning-lesson__missing > * + * { margin-top: 10rpx; }
.learning-lesson__title { min-width: 0; overflow-wrap: anywhere; font-size: 23rpx; font-weight: 650; }
.learning-lesson__status { flex-shrink: 0; color: $color-primary; font-size: 21rpx; }
.learning-lesson__footer { flex-wrap: wrap; color: $color-muted; font-size: 21rpx; border-top: 1px solid $color-border; padding-top: 10rpx; }
.learning-lesson__action, .learning-lesson__review { padding: 12rpx 16rpx; margin: 0; border: 0; color: $color-primary; background: $color-primary-soft; font-size: 22rpx; line-height: 1.4; border-radius: 8px; }
.learning-lesson__review { margin-top: 12rpx; width: 100%; }
.learning-lesson__missing { display: flex; align-items: flex-start; flex-direction: column; padding: 16rpx 0; color: $color-muted; font-size: 22rpx; }
</style>
