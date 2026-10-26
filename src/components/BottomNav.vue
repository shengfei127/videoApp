<script setup lang="ts">
import { House, LibraryBig, Settings } from '@/components/icons'

type NavKey = 'home' | 'library' | 'settings'

const props = defineProps<{ active: NavKey }>()

const items = [
  { key: 'home', label: '首页', path: '/pages/home/index', icon: House },
  {
    key: 'library',
    label: '视频库',
    path: '/pages/library/index',
    icon: LibraryBig
  },
  {
    key: 'settings',
    label: '设置',
    path: '/pages/settings/index',
    icon: Settings
  }
] as const

function navigate(key: NavKey, path: string): void {
  if (key === props.active) {
    return
  }

  uni.redirectTo({ url: path })
}
</script>

<template>
  <view class="bottom-nav" role="navigation" aria-label="主导航">
    <button
      v-for="item in items"
      :key="item.key"
      class="bottom-nav__item"
      :class="{ 'bottom-nav__item--active': item.key === active }"
      :aria-label="item.label"
      :aria-current="item.key === active ? 'page' : undefined"
      @click="navigate(item.key, item.path)"
    >
      <component
        :is="item.icon"
        :size="22"
        :stroke-width="1.9"
        aria-hidden="true"
      />
      <text class="bottom-nav__label">{{ item.label }}</text>
    </button>
  </view>
</template>

<style scoped lang="scss">
@use '@/styles/tokens.scss' as *;

.bottom-nav {
  position: fixed;
  z-index: 20;
  right: 0;
  bottom: 0;
  left: 0;
  box-sizing: border-box;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8rpx;
  padding: 8rpx 24rpx max(8rpx, env(safe-area-inset-bottom));
  border-top: 1px solid $color-border;
  background: $color-surface;
}

.bottom-nav__item {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 4rpx;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-width: 0;
  min-height: 88rpx;
  margin: 0;
  padding: 8rpx 6rpx;
  border: 0;
  border-radius: $radius-control;
  color: $color-muted;
  font-size: 22rpx;
  line-height: 1.2;
  background: transparent;
}

.bottom-nav__item--active {
  color: $color-primary;
  background: $color-primary-soft;
}

.bottom-nav__item:focus-visible {
  outline: 2px solid $color-primary;
  outline-offset: 2px;
}

.bottom-nav__label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
