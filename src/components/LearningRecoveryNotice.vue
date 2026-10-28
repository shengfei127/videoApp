<script setup lang="ts">
import { ref } from 'vue'
import { useAppStore } from '@/stores/appStore'
const store = useAppStore()
const recovering = ref(false)
async function retry(): Promise<void> {
  if (recovering.value) return
  recovering.value = true
  const recovered = await store.retryLearningRecovery()
  recovering.value = false
  uni.showToast({ title: recovered ? '学习数据已恢复' : '恢复失败，请腾出存储空间后重试', icon: 'none' })
}
</script>
<template>
  <view v-if="store.learningRecoveryRequired" class="learning-recovery" role="alert">
    <text>上次学习数据写入未完成，暂时无法保存新的学习修改。请腾出存储空间后重试恢复。</text>
    <button data-testid="learning-recovery-retry" :disabled="recovering" @click="retry">{{ recovering ? '正在恢复' : '重试恢复' }}</button>
  </view>
</template>
<style scoped lang="scss">
@use '@/styles/tokens.scss' as *;
.learning-recovery { padding: 16px; margin: 12px 0; border: 1px solid $color-border; border-radius: 10px; color: $color-text; background: $color-primary-soft; font-size: 14px; line-height: 1.6; }
.learning-recovery button { max-width: 100%; white-space: normal; overflow-wrap: anywhere; box-sizing: border-box; display: flex; align-items: center; justify-content: center; text-align: center; min-height: 44px; margin: 10px 0 0; padding: 10px 16px; border: 1px solid $color-primary; color: $color-primary; background: $color-surface; font-size: 14px; line-height: 1.4; }
</style>
