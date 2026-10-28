<script setup lang="ts">
import { CalendarDays, House, SquarePlay, Settings } from '@/components/icons'

type NavKey = 'home' | 'library' | 'course' | 'settings'

const props = defineProps<{ active: NavKey }>()

const items = [
  { key: 'home', label: '首页', path: '/pages/home/index', icon: House },
  {
    key: 'library',
    label: '视频库',
    path: '/pages/library/index',
    icon: SquarePlay
  },
  {
    key: 'course',
    label: '每日课程',
    path: '/pages/daily-unlock/index',
    icon: CalendarDays
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
  <view class="bottom-nav bottom-nav--premium" role="navigation" aria-label="主导航">
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
  grid-template-columns: repeat(4, minmax(0, 1fr));
  padding: 6rpx 20rpx max(7rpx, env(safe-area-inset-bottom));
  border-top: 1px solid rgba($color-border, 0.8);
  background: rgba($color-surface, 0.98);
}

.bottom-nav__item {
  box-sizing: border-box;
  display: flex;
  min-width: 0;
  min-height: 76rpx;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  margin: 0 4rpx;
  padding: 5rpx 4rpx;
  border: 0;
  border-radius: 0;
  color: $color-muted;
  font-size: 20rpx;
  line-height: 1.2;
  background: transparent;
}

.bottom-nav__item--active {
  color: $color-primary;
  background: transparent;
}

.bottom-nav__label {
  display: block;
  max-width: 100%;
  margin-top: 3rpx;
  overflow: hidden;
  font-weight: 550;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bottom-nav__item:focus-visible {
  outline: 2px solid $color-primary;
  outline-offset: 2px;
}
.bottom-nav__item .app-icon { opacity: .65; }
.bottom-nav__item--active .app-icon { opacity: 1; filter: brightness(.65) sepia(1) saturate(5) hue-rotate(115deg); }
</style>
