<script setup lang="ts">
import { ref } from 'vue'
import VideoRow from './VideoRow.vue'
import type { VideoItem } from '@/domain/video'
import { learningTimeLabel, type LearningLesson } from '@/features/daily-unlock/learningPlan'

defineProps<{ lesson: LearningLesson }>()
defineEmits<{ play: [video: VideoItem]; review: [video: VideoItem]; complete: [lesson: LearningLesson]; library: [] }>()
const moreOpen = ref(false)
</script>

<template>
  <view class="learning-lesson" :data-lesson-id="lesson.id">
    <view class="learning-lesson__heading">
      <text class="learning-lesson__title">{{ lesson.courseName }} · 第 {{ lesson.episodeNumber }} 集</text>
      <text v-if="lesson.completed" class="learning-lesson__status">已学完</text>
    </view>
    <VideoRow v-if="lesson.video" :video="lesson.video" display="history" hide-metadata @select="lesson.completed ? $emit('review', $event) : $emit('play', $event)" />
    <view v-else class="learning-lesson__missing">
      <text>{{ lesson.name }}</text><text>视频暂不可用，请到视频库同步或检查来源</text>
      <button class="learning-lesson__action" @click="$emit('library')">前往视频库</button>
    </view>
    <view v-if="!lesson.completed" class="learning-lesson__footer">
      <text v-if="!lesson.completed">{{ learningTimeLabel(lesson) }}<template v-if="lesson.positionSeconds > 0"> · 已看 {{ Math.floor(lesson.positionSeconds / 60) }}:{{ String(Math.floor(lesson.positionSeconds % 60)).padStart(2, '0') }}</template></text>
    </view>
    <view class="learning-lesson__actions">
      <button v-if="lesson.video" class="learning-lesson__primary" :class="{ 'learning-lesson__review': lesson.completed }" data-testid="lesson-primary" @click="lesson.completed ? $emit('review', lesson.video) : $emit('play', lesson.video)">{{ lesson.completed ? '复习本节' : lesson.positionSeconds > 0 ? '继续学习' : '开始学习' }}</button>
      <button class="learning-lesson__action" data-testid="lesson-more" :aria-label="`更多操作：${lesson.name}`" :aria-expanded="moreOpen" @click="moreOpen = !moreOpen">{{ moreOpen ? '收起' : '更多' }}</button>
    </view>
    <view v-if="moreOpen" class="learning-lesson__more">
      <button class="learning-lesson__action" :aria-label="`${lesson.completed ? '撤销学完' : '标记学完'}：${lesson.name}`" @click="$emit('complete', lesson); moreOpen = false">{{ lesson.completed ? '撤销学完' : '标记学完' }}</button>
    </view>
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
.learning-lesson__action, .learning-lesson__review { display: flex; align-items: center; justify-content: center; text-align: center; min-height: 44px; min-width: 44px; padding: 12rpx 16rpx; margin: 0; border: 0; color: $color-primary; background: $color-primary-soft; font-size: 22rpx; line-height: 1.4; border-radius: 8px; }
.learning-lesson__actions { display: flex; align-items: center; margin-top: 12rpx; }
.learning-lesson__actions > * + * { margin-left: 12rpx; }
.learning-lesson__primary { display: flex; align-items: center; justify-content: center; text-align: center; flex: 1; min-width: 0; min-height: 44px; margin: 0; padding: 12rpx; border: 0; border-radius: 8px; background: $color-primary; color: #fff; font-size: 24rpx; line-height: 1.4; }
.learning-lesson__more { margin-top: 12rpx; padding-top: 12rpx; border-top: 1px solid $color-border; }
.learning-lesson__missing { display: flex; align-items: flex-start; flex-direction: column; padding: 16rpx 0; color: $color-muted; font-size: 22rpx; }
</style>
