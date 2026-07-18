<script setup lang="ts">
import { computed, ref } from 'vue'
import { Film } from 'lucide-vue-next'

const props = defineProps<{
  src?: string
  alt?: string
  name?: string
}>()

const failed = ref(false)
const label = computed(() => props.alt?.trim() || props.name?.trim() || '视频')
const safeSrc = computed(() =>
  failed.value ? undefined : toSafeThumbnailUrl(props.src)
)

function handleImageError(): void {
  failed.value = true
}

function toSafeThumbnailUrl(value: string | undefined): string | undefined {
  if (!value?.trim()) {
    return undefined
  }

  try {
    const url = new URL(value)
    const hasAccessToken = [...url.searchParams.keys()].some(
      (key) => key.toLocaleLowerCase('en-US') === 'access_token'
    )

    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.hash ||
      hasAccessToken
    ) {
      return undefined
    }

    return url.toString()
  } catch {
    return undefined
  }
}
</script>

<template>
  <view class="video-thumbnail">
    <image
      v-if="safeSrc"
      data-testid="video-thumbnail-image"
      class="video-thumbnail__image"
      :src="safeSrc"
      :alt="label"
      :aria-label="`${label}的缩略图`"
      role="img"
      mode="aspectFill"
      :lazy-load="true"
      @error="handleImageError"
    />
    <view
      v-else
      data-testid="video-thumbnail-fallback"
      class="video-thumbnail__fallback"
      role="img"
      :aria-label="`${label}的缩略图不可用`"
    >
      <Film :size="24" :stroke-width="1.8" aria-hidden="true" />
    </view>
  </view>
</template>

<style scoped lang="scss">
@use '@/styles/tokens.scss' as *;

.video-thumbnail {
  position: relative;
  box-sizing: border-box;
  width: 100%;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  border-radius: $radius-control;
  background: $color-player;
}

.video-thumbnail__image,
.video-thumbnail__fallback {
  display: flex;
  width: 100%;
  height: 100%;
}

.video-thumbnail__image {
  object-fit: cover;
}

.video-thumbnail__fallback {
  align-items: center;
  justify-content: center;
  color: $color-surface;
  background: $color-player;
}
</style>
