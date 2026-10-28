<script setup lang="ts">
import { computed, ref } from 'vue'
import { Film } from '@/components/icons'

const props = defineProps<{
  src?: string
  alt?: string
  name?: string
}>()

const failedSrc = ref<string>()
const label = computed(() => props.alt?.trim() || props.name?.trim() || '视频')
const safeSrc = computed(() => {
  const candidate = toSafeThumbnailUrl(props.src)
  return candidate && candidate !== failedSrc.value ? candidate : undefined
})

function handleImageError(): void {
  failedSrc.value = safeSrc.value
}

function toSafeThumbnailUrl(value: string | undefined): string | undefined {
  if (!value?.trim()) {
    return undefined
  }

  try {
    const url = new URL(value)

    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.hash ||
      hasSensitiveQuery(url.searchParams)
    ) {
      return undefined
    }

    return url.toString()
  } catch {
    return undefined
  }
}

function hasSensitiveQuery(searchParams: URLSearchParams): boolean {
  for (const [key, value] of searchParams) {
    if (isSensitiveQueryKey(key) || hasSensitiveQueryValue(value)) {
      return true
    }
  }

  return false
}

function isSensitiveQueryKey(key: string): boolean {
  const normalizedKey = key.toLocaleLowerCase('en-US')
  return (
    normalizedKey === 'token' ||
    normalizedKey.endsWith('_token') ||
    normalizedKey.endsWith('-token') ||
    normalizedKey === 'authorization' ||
    normalizedKey === 'dlink'
  )
}

function hasSensitiveQueryValue(value: string): boolean {
  if (/\bbearer\s+\S+/iu.test(value)) {
    return true
  }

  for (
    let equalsIndex = value.indexOf('=');
    equalsIndex >= 0;
    equalsIndex = value.indexOf('=', equalsIndex + 1)
  ) {
    let keyStart = equalsIndex
    while (
      keyStart > 0 &&
      isQueryKeyCharacter(value.charCodeAt(keyStart - 1))
    ) {
      keyStart -= 1
    }

    if (isSensitiveQueryKey(value.slice(keyStart, equalsIndex))) {
      return true
    }
  }

  return false
}

function isQueryKeyCharacter(charCode: number): boolean {
  return (
    (charCode >= 48 && charCode <= 57) ||
    (charCode >= 65 && charCode <= 90) ||
    (charCode >= 97 && charCode <= 122) ||
    charCode === 45 ||
    charCode === 95
  )
}
</script>

<template>
  <view class="video-thumbnail video-thumbnail--premium">
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
  height: 0;
  padding-bottom: 56.25%;
  overflow: hidden;
  border-radius: $radius-control;
  background: $color-player;
}

.video-thumbnail__image,
.video-thumbnail__fallback {
  position: absolute;
  top: 0;
  left: 0;
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
