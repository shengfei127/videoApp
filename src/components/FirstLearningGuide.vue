<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { uniStorage } from '@/infrastructure/storage'
import { markLearningGuideCompleted, readLearningGuideStatus, skipLearningGuide } from '@/features/onboarding/learningGuide'

const props = defineProps<{ hasVideos: boolean; hasCourses: boolean }>()
const emit = defineEmits<{ 'visibility-change': [visible: boolean] }>()
const status = ref(readLearningGuideStatus(uniStorage))
const error = ref('')
const visible = computed(() => !props.hasCourses && status.value === 'active')
watch(() => props.hasCourses, (hasCourses) => {
  if (hasCourses && status.value !== 'completed' && markLearningGuideCompleted(uniStorage)) status.value = 'completed'
}, { immediate: true })
watch(visible, (value) => emit('visibility-change', value), { immediate: true })

function start(): void {
  uni.navigateTo({ url: props.hasVideos ? '/pages/daily-unlock/index?learningGuide=1' : '/pages/library/index?learningGuide=1' })
}
function skip(): void {
  if (skipLearningGuide(uniStorage)) { status.value = 'skipped'; error.value = '' }
  else error.value = '暂未能保存设置，请稍后再试'
}
</script>

<template>
  <view v-if="visible" class="first-learning-guide" data-testid="learning-guide">
    <text class="first-learning-guide__title">开始你的第一份学习计划</text>
    <view class="first-learning-guide__steps" aria-label="创建学习计划的三个步骤">
      <text :class="{ 'first-learning-guide__done': hasVideos }">1 添加视频{{ hasVideos ? ' ✓' : '' }}</text>
      <text>2 选择课程</text><text>3 设置每日集数</text>
    </view>
    <text class="first-learning-guide__hint">{{ hasVideos ? '视频已准备好，选择想学的内容和每天的节奏。' : '先添加媒体直链或连接百度网盘，再选择课程内容。' }}</text>
    <view class="first-learning-guide__actions">
      <button data-testid="learning-guide-start" class="first-learning-guide__primary" @click="start">{{ hasVideos ? '选择课程' : '添加视频' }}</button>
      <button data-testid="learning-guide-skip" @click="skip">暂时跳过</button>
    </view>
    <text v-if="error" class="first-learning-guide__error" role="alert">{{ error }}</text>
  </view>
</template>

<style scoped lang="scss">
@use '@/styles/tokens.scss' as *;
.first-learning-guide { padding: 20rpx; margin: 14rpx 0; border: 1px solid $color-border; border-radius: 12px; background: $color-primary-soft; }
.first-learning-guide__title { display: block; font-size: 28rpx; font-weight: 650; color: $color-text; }
.first-learning-guide__steps { display: flex; flex-wrap: wrap; margin: 10rpx 0; color: $color-text; font-size: 23rpx; }
.first-learning-guide__steps text { margin: 6rpx 20rpx 6rpx 0; }
.first-learning-guide__done { color: $color-primary; }
.first-learning-guide__hint { display: block; font-size: 22rpx; line-height: 1.5; color: $color-muted; }
.first-learning-guide__actions { display: flex; flex-wrap: wrap; margin-top: 12rpx; }
.first-learning-guide button { max-width: 100%; white-space: normal; overflow-wrap: anywhere; box-sizing: border-box; display: flex; align-items: center; justify-content: center; text-align: center; min-height: 44px; min-width: 44px; margin: 6rpx 12rpx 0 0; padding: 12rpx 18rpx; border: 1px solid $color-primary; border-radius: 8px; color: $color-primary; background: transparent; font-size: 23rpx; line-height: 1.4; }
.first-learning-guide .first-learning-guide__primary { background: $color-primary; color: #fff; }
.first-learning-guide__error { display: block; margin-top: 10rpx; color: #b23b2f; font-size: 22rpx; }
</style>
