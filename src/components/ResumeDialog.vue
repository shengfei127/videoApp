<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { Play, RotateCcw } from 'lucide-vue-next'

import type { PlaybackProgress } from '@/domain/video'
import { classifyProgress } from '@/features/playback/progressPolicy'

const props = defineProps<{
  open: boolean
  progress: PlaybackProgress | null | undefined
}>()

const emit = defineEmits<{
  continue: []
  restart: []
}>()

const visible = computed(() => {
  if (!props.open || !props.progress) {
    return false
  }

  return classifyProgress(
    props.progress.positionSeconds,
    props.progress.durationSeconds
  ).resumable
})

const savedPosition = computed(() =>
  formatDuration(props.progress?.positionSeconds ?? 0)
)
interface FocusableTarget {
  focus?: () => void
  $el?: { focus?: () => void }
}

const continueButton = ref<FocusableTarget | null>(null)

watch(
  visible,
  async (isVisible) => {
    if (!isVisible) {
      return
    }

    await nextTick()
    focusContinueButton()
  },
  { immediate: true }
)

function focusContinueButton(): void {
  const target = continueButton.value
  const focusable =
    typeof target?.focus === 'function' ? target : target?.$el

  if (typeof focusable?.focus === 'function') {
    focusable.focus()
  }
}

function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds))
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
}
</script>

<template>
  <view v-if="visible" class="resume-dialog" role="presentation">
    <view
      class="resume-dialog__panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="resume-dialog-heading"
    >
      <h2 id="resume-dialog-heading" class="resume-dialog__heading">继续播放</h2>
      <text data-testid="resume-saved-position" class="resume-dialog__detail">
        上次看到 {{ savedPosition }}
      </text>
      <view class="resume-dialog__actions">
        <button
          ref="continueButton"
          type="button"
          tabindex="0"
          data-testid="resume-continue"
          class="resume-dialog__action resume-dialog__action--primary"
          @click="emit('continue')"
        >
          <Play :size="19" aria-hidden="true" />
          <text>继续播放</text>
        </button>
        <button
          type="button"
          tabindex="0"
          data-testid="resume-restart"
          class="resume-dialog__action resume-dialog__action--secondary"
          @click="emit('restart')"
        >
          <RotateCcw :size="19" aria-hidden="true" />
          <text>从头播放</text>
        </button>
      </view>
    </view>
  </view>
</template>

<style scoped lang="scss">
@use '@/styles/tokens.scss' as *;

.resume-dialog {
  position: fixed;
  z-index: 10;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  padding: 32rpx;
  background: rgba(13, 16, 14, 0.48);
}

.resume-dialog__panel {
  box-sizing: border-box;
  display: flex;
  width: min(100%, 560rpx);
  min-height: 290rpx;
  flex-direction: column;
  gap: 16rpx;
  justify-content: center;
  padding: 34rpx;
  border: 1px solid $color-border;
  border-radius: $radius-card;
  background: $color-surface;
  box-shadow: $shadow-panel;
}

.resume-dialog__heading {
  color: $color-text;
  font-size: 30rpx;
  font-weight: 740;
  line-height: 1.35;
}

.resume-dialog__detail {
  color: $color-muted;
  font-size: 24rpx;
  line-height: 1.5;
}

.resume-dialog__actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14rpx;
  margin-top: 8rpx;
}

.resume-dialog__action {
  display: flex;
  min-height: 76rpx;
  align-items: center;
  justify-content: center;
  gap: 8rpx;
  margin: 0;
  padding: 12rpx 16rpx;
  border-radius: $radius-control;
  font-size: 23rpx;
  font-weight: 700;
}

.resume-dialog__action--primary {
  border: 1px solid $color-primary;
  color: #ffffff;
  background: $color-primary;
}

.resume-dialog__action--secondary {
  border: 1px solid $color-border;
  color: $color-text;
  background: $color-surface;
}
</style>
