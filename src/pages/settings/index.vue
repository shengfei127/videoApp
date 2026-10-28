<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  Cloud,
  CalendarDays,
  Folder,
  ChevronRight,
  Database,
  History,
  Link,
  LogOut,
  ShieldCheck,
  Trash2
} from '@/components/icons'

import BottomNav from '@/components/BottomNav.vue'
import { runtimeConfig } from '@/config/runtime'
import { getNextCourseUnlockAt } from '@/features/daily-unlock/dailyUnlockPolicy'
import { useDailyUnlockClock } from '@/features/daily-unlock/dailyUnlockClock'
import { useAppStore } from '@/stores/appStore'

const appVersion = __PIANKE_APP_VERSION__
const store = useAppStore()
const expandedSection = ref('')
function toggleSection(section: string): void {
  expandedSection.value = expandedSection.value === section ? '' : section
}

const connectionStatus = computed(() =>
  store.authSession ? '已连接' : '未连接'
)
const expiresText = computed(() =>
  store.authSession
    ? formatDateTime(store.authSession.expiresAt)
    : '连接后显示'
)
const cacheText = computed(() =>
  store.baiduCacheSavedAt === null
    ? '尚未同步'
    : formatDateTime(store.baiduCacheSavedAt)
)

const dailyUnlockCourses = computed(() => store.dailyUnlockSettings.courses)
const dailyUnlockSummary = computed(() => {
  if (!dailyUnlockCourses.value.length) return '0 门课程'
  return `${dailyUnlockCourses.value.length} 门课程`
})
const nextDailyUnlockText = computed(() => {
  const timestamps = dailyUnlockCourses.value
    .map((course) => getNextCourseUnlockAt(course, store.dailyUnlockNow))
    .filter((value): value is number => typeof value === 'number')
  if (!timestamps.length) return '创建课程后按本机自然日解锁'
  return `下次解锁 ${formatDateTime(Math.min(...timestamps))}`
})

useDailyUnlockClock((now) => store.refreshDailyUnlockClock(now))

function toggleDailyUnlock(): void {
  const succeeded = store.setDailyUnlockEnabled(!store.dailyUnlockSettings.enabled)
  if (!succeeded) {
    uni.showToast({ title: '每日解锁设置保存失败', icon: 'none' })
  }
}

function openDailyUnlockManager(): void {
  uni.navigateTo({ url: '/pages/daily-unlock/index' })
}

function connectBaidu(): void {
  uni.navigateTo({ url: '/pages/oauth/index' })
}

function requestDisconnect(): void {
  let settled = false
  uni.showModal({
    title: '断开百度网盘',
    content: '将删除本机保存的百度授权，直链、目录缓存和播放历史会保留。',
    confirmText: '断开',
    confirmColor: '#c44732',
    cancelText: '取消',
    success: ({ confirm }) => {
      if (settled) {
        return
      }
      settled = true

      if (!confirm) {
        return
      }

      showDestructiveResult(
        () => store.disconnectBaidu(),
        '已断开百度网盘',
        '断开失败，请稍后重试'
      )
    }
  })
}

function requestClearCache(): void {
  let settled = false
  uni.showModal({
    title: '清除目录缓存',
    content: '只清除已同步到本机的百度视频目录，不会断开授权或删除播放历史。',
    confirmText: '清除',
    confirmColor: '#c44732',
    cancelText: '取消',
    success: ({ confirm }) => {
      if (settled) {
        return
      }
      settled = true

      if (!confirm) {
        return
      }

      showDestructiveResult(
        () => store.clearCatalogCache(),
        '目录缓存已清除',
        '目录缓存清除失败，请稍后重试'
      )
    }
  })
}

function requestClearHistory(): void {
  let settled = false
  uni.showModal({
    title: '清除播放历史',
    content: '将永久删除本机保存的全部播放位置和续播记录。',
    confirmText: '继续',
    confirmColor: '#c44732',
    cancelText: '取消',
    success: ({ confirm }) => {
      if (settled) {
        return
      }
      settled = true

      if (confirm) {
        requestSecondHistoryConfirmation()
      }
    }
  })
}

function requestSecondHistoryConfirmation(): void {
  let settled = false
  uni.showModal({
    title: '再次确认清除',
    content: '播放历史清除后无法恢复。确认永久清除？',
    confirmText: '永久清除',
    confirmColor: '#c44732',
    cancelText: '取消',
    success: ({ confirm }) => {
      if (settled) {
        return
      }
      settled = true

      if (!confirm) {
        return
      }

      showDestructiveResult(
        () => store.clearProgress(),
        '播放历史已清除',
        '播放历史清除失败，请稍后重试'
      )
    }
  })
}

function showDestructiveResult(
  action: () => boolean,
  successTitle: string,
  failureTitle: string
): void {
  let succeeded = false
  try {
    succeeded = action()
  } catch {
    succeeded = false
  }

  uni.showToast({
    title: succeeded ? successTitle : failureTitle,
    icon: 'none'
  })
}

function formatDateTime(value: number): string {
  if (!Number.isFinite(value) || value < 0) {
    return '时间未知'
  }

  try {
    return new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(new Date(value))
  } catch {
    // App service engines without Intl still support local Date accessors.
    const date = new Date(value)
    if (!Number.isFinite(date.getTime())) return '时间未知'
    const pad = (part: number): string => String(part).padStart(2, '0')
    return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
  }
}
</script>

<template>
  <view class="page-shell settings-page settings-page--premium">
    <header class="settings-header">
      <text class="settings-header__title">设置</text>

    </header>

    <main class="settings-content settings-menu">
      <section class="settings-section" aria-labelledby="settings-baidu-title">
        <button class="settings-menu-row" :aria-expanded="expandedSection === 'baidu'" @click="toggleSection('baidu')">
          <Cloud :size="23" aria-hidden="true" />
          <view class="settings-menu-row__copy"><text id="settings-baidu-title">百度网盘</text><text class="settings-menu-row__detail">{{ connectionStatus }}</text></view>
          <ChevronRight :size="18" aria-hidden="true" />
        </button>
        <view v-show="expandedSection === 'baidu'" class="settings-expanded">
        <view class="settings-band">
          <view class="settings-row">
            <text class="settings-row__label">连接状态</text>
            <text class="settings-row__value settings-row__value--strong">
              {{ connectionStatus }}
            </text>
          </view>
          <view class="settings-row">
            <text class="settings-row__label">应用目录</text>
            <text class="settings-row__value">{{ runtimeConfig.baiduRoot }}</text>
          </view>
          <view class="settings-row">
            <text class="settings-row__label">授权有效期</text>
            <text class="settings-row__value">{{ expiresText }}</text>
          </view>
          <view class="settings-row">
            <text class="settings-row__label">上次目录缓存</text>
            <text class="settings-row__value">{{ cacheText }}</text>
          </view>
        </view>
        <button
          v-if="store.authSession"
          type="button"
          data-testid="settings-disconnect"
          class="settings-action settings-action--danger"
          aria-label="断开百度网盘连接"
          @click="requestDisconnect"
        >
          <LogOut :size="19" aria-hidden="true" />
          <text>断开连接</text>
        </button>
        <button
          v-else
          type="button"
          class="settings-action settings-action--primary"
          aria-label="连接百度网盘"
          @click="connectBaidu"
        >
          <Cloud :size="19" aria-hidden="true" />
          <text>连接百度网盘</text>
        </button>
        </view>
      </section>

      <section class="settings-section" aria-labelledby="settings-daily-unlock-title">
        <button class="settings-menu-row" :aria-expanded="expandedSection === 'daily'" @click="toggleSection('daily')">
          <CalendarDays :size="23" aria-hidden="true" />
          <view class="settings-menu-row__copy"><text id="settings-daily-unlock-title">每日课程</text><text class="settings-menu-row__detail">课程管理与提醒</text></view>
          <ChevronRight :size="18" aria-hidden="true" />
        </button>
        <view v-show="expandedSection === 'daily'" class="settings-expanded">
        <view class="settings-band daily-unlock-band">
          <view class="daily-unlock-row">
            <view class="daily-unlock-copy">
              <text class="daily-unlock-title">每日解锁课程</text>
              <text class="daily-unlock-description">开启后，每门课程每日零点解锁下一集（按本机自然日计算）</text>
            </view>
            <button
              type="button"
              role="switch"
              data-testid="daily-unlock-toggle"
              class="daily-unlock-switch"
              :class="{ 'daily-unlock-switch--on': store.dailyUnlockSettings.enabled }"
              :aria-checked="store.dailyUnlockSettings.enabled"
              aria-label="每日解锁课程"
              @click="toggleDailyUnlock"
            >
              <view class="daily-unlock-switch__thumb" />
            </button>
          </view>
          <view class="daily-unlock-status">
            <text>{{ dailyUnlockSummary }}</text>
            <text>{{ nextDailyUnlockText }}</text>
          </view>
        </view>
        <button
          type="button"
          data-testid="daily-unlock-manage"
          class="settings-action settings-action--secondary daily-unlock-manage"
          @click="openDailyUnlockManager"
        >
          <History :size="18" aria-hidden="true" />
          <text>管理课程</text>
        </button>
        </view>
      </section>

      <section class="settings-section" aria-labelledby="settings-local-title">
        <button class="settings-menu-row" :aria-expanded="expandedSection === 'local'" @click="toggleSection('local')">
          <Folder :size="23" aria-hidden="true" />
          <view class="settings-menu-row__copy"><text id="settings-local-title">本地数据</text><text class="settings-menu-row__detail">视频缓存与存储</text></view>
          <ChevronRight :size="18" aria-hidden="true" />
        </button>
        <view v-show="expandedSection === 'local'" class="settings-expanded">
        <view class="settings-band">
          <view class="settings-row">
            <view class="settings-row__label-with-icon">
              <Link :size="18" aria-hidden="true" />
              <text>媒体直链</text>
            </view>
            <text class="settings-row__value">
              {{ store.directRecords.length }} 条
            </text>
          </view>
          <view class="settings-row">
            <view class="settings-row__label-with-icon">
              <History :size="18" aria-hidden="true" />
              <text>播放历史</text>
            </view>
            <text class="settings-row__value">
              {{ store.progressHistory.length }} 条
            </text>
          </view>
        </view>
        <view class="settings-action-row">
          <button
            type="button"
            data-testid="settings-clear-cache"
            class="settings-action settings-action--secondary"
            aria-label="清除百度目录缓存"
            @click="requestClearCache"
          >
            <Database :size="18" aria-hidden="true" />
            <text>清除目录缓存</text>
          </button>
          <button
            type="button"
            data-testid="settings-clear-history"
            class="settings-action settings-action--danger"
            aria-label="永久清除本机播放历史"
            @click="requestClearHistory"
          >
            <Trash2 :size="18" aria-hidden="true" />
            <text>清除播放历史</text>
          </button>
        </view>
        </view>
      </section>

      <section class="settings-section" aria-labelledby="settings-privacy-title">
        <button class="settings-menu-row" :aria-expanded="expandedSection === 'privacy'" @click="toggleSection('privacy')">
          <ShieldCheck :size="23" aria-hidden="true" />
          <view class="settings-menu-row__copy"><text id="settings-privacy-title">隐私保护</text><text class="settings-menu-row__detail">权限与数据安全</text></view>
          <ChevronRight :size="18" aria-hidden="true" />
        </button>
        <view v-show="expandedSection === 'privacy'" class="settings-privacy-band">
          <text>播放进度和媒体直链仅保存在本机。</text>
          <text>百度授权仅用于访问应用专属目录，不显示或记录访问凭证。</text>
        </view>
      </section>

      <button class="settings-menu-row settings-menu-row--short" aria-label="清除百度目录缓存" @click="requestClearCache">
        <Trash2 :size="23" aria-hidden="true" />
        <view class="settings-menu-row__copy"><text>清除缓存</text></view>
        <text class="settings-menu-row__detail">{{ store.baiduVideos.length }} 个视频</text>
      </button>
      <button class="settings-menu-row settings-menu-row--short" :aria-expanded="expandedSection === 'about'" @click="toggleSection('about')">
        <text class="settings-info-icon" aria-hidden="true">i</text>
        <view class="settings-menu-row__copy"><text>关于片刻</text></view>
        <ChevronRight :size="18" aria-hidden="true" />
      </button>
      <view v-show="expandedSection === 'about'" class="settings-version" aria-label="应用版本"><text>片刻</text><text>版本 {{ appVersion }}</text></view>
    </main>

    <BottomNav active="settings" />
  </view>
</template>

<style scoped lang="scss">
@use '@/styles/tokens.scss' as *;

.settings-page {
  padding-top: calc(max(var(--status-bar-height, 0px), env(safe-area-inset-top, 0px)) + 24rpx);
}

.settings-header {
  display: flex;
  min-height: 92rpx;
  flex-direction: column;
  justify-content: center;
}

.settings-header > * + * { margin-top: 4rpx; }

.settings-header__title {
  font-size: 36rpx;
  font-weight: 760;
  line-height: 1.2;
}

.settings-header__subtitle {
  color: $color-muted;
  font-size: 21rpx;
  line-height: 1.35;
}

.settings-content {
  display: flex;
  flex-direction: column;
  margin-top: 20rpx;
}

.settings-content > * + * { margin-top: 0; }

.settings-section {
  display: flex;
  flex-direction: column;
}

.settings-section > * + * { margin-top: 0; }

.settings-section__heading,
.settings-row,
.settings-row__label-with-icon,
.settings-action,
.settings-version {
  display: flex;
  align-items: center;
}

.settings-action-row {
  display: grid;
}

.settings-section__heading {
  color: $color-text;
  font-size: 27rpx;
  font-weight: 720;
}

.settings-section__heading .app-icon { margin-right: 10rpx; }

.settings-band {
  border-top: 1px solid $color-border;
  border-bottom: 1px solid $color-border;
  background: rgba($color-surface, 0.64);
}

.daily-unlock-band {
  padding: 18rpx;
}

.daily-unlock-row,
.daily-unlock-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.daily-unlock-switch { margin-left: 18rpx; }

.daily-unlock-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.daily-unlock-copy > * + * { margin-top: 6rpx; }

.daily-unlock-title {
  color: $color-text;
  font-size: 24rpx;
  font-weight: 700;
}

.daily-unlock-description,
.daily-unlock-status {
  color: $color-muted;
  font-size: 21rpx;
  line-height: 1.45;
}

.daily-unlock-status {
  align-items: flex-start;
  flex-direction: column;
  margin-top: 16rpx;
  padding-top: 14rpx;
  border-top: 1px solid $color-border;
}

.daily-unlock-status > * + * { margin-top: 4rpx; }

.daily-unlock-switch {
  position: relative;
  flex: 0 0 auto;
  width: 92rpx;
  height: 52rpx;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: #c9cfca;
  transition: background-color 160ms ease;
}

.daily-unlock-switch--on {
  background: $color-primary;
}

.daily-unlock-switch__thumb {
  position: absolute;
  top: 6rpx;
  left: 6rpx;
  width: 40rpx;
  height: 40rpx;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 2rpx 8rpx rgba(26, 41, 34, 0.2);
  transition: transform 160ms ease;
}

.daily-unlock-switch--on .daily-unlock-switch__thumb {
  transform: translateX(40rpx);
}

.daily-unlock-manage {
  width: 100%;
  margin: 0;
}

.daily-unlock-switch:focus-visible,
.daily-unlock-manage:focus-visible {
  outline: 2px solid $color-primary;
  outline-offset: 3px;
}

.settings-row {
  box-sizing: border-box;
  justify-content: space-between;
  min-height: 78rpx;
  padding: 14rpx 18rpx;
}

.settings-row + .settings-row {
  border-top: 1px solid $color-border;
}

.settings-row__label,
.settings-row__label-with-icon {
  min-width: 0;
  color: $color-muted;
  font-size: 23rpx;
  line-height: 1.4;
}

.settings-row__label-with-icon .app-icon { margin-right: 10rpx; }

.settings-row__value {
  max-width: 62%;
  margin-left: 24rpx;
  overflow-wrap: anywhere;
  color: $color-text;
  font-size: 23rpx;
  line-height: 1.4;
  text-align: right;
}

.settings-row__value--strong {
  color: $color-primary;
  font-weight: 720;
}

.settings-action-row {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  margin: -6rpx;
}

.settings-action {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  min-height: 74rpx;
  margin: 6rpx;
  padding: 12rpx 18rpx;
  border: 1px solid $color-border;
  border-radius: $radius-control;
  font-size: 22rpx;
  font-weight: 700;
  line-height: 1.3;
}

.settings-action .app-icon { margin-right: 8rpx; }

.settings-action--primary {
  border-color: $color-primary;
  color: #ffffff;
  background: $color-primary;
}

.settings-action--secondary {
  color: $color-primary;
  background: $color-primary-soft;
}

.settings-action--danger {
  border-color: #e4b9b1;
  color: #a43b2c;
  background: #fff6f4;
}

.settings-privacy-band {
  display: flex;
  flex-direction: column;
  padding: 20rpx 18rpx;
  border-top: 1px solid $color-border;
  border-bottom: 1px solid $color-border;
  color: $color-muted;
  font-size: 22rpx;
  line-height: 1.55;
  background: rgba($color-surface, 0.5);
}

.settings-privacy-band > * + * { margin-top: 10rpx; }

.settings-version {
  justify-content: space-between;
  padding: 4rpx 2rpx 16rpx;
  color: $color-muted;
  font-size: 21rpx;
}

@media (max-width: 420px) {
  .settings-action-row {
    grid-template-columns: minmax(0, 1fr);
  }

  .settings-row {
    align-items: center;
    flex-direction: row;
  }

  .settings-row__value {
    max-width: 62%;
    text-align: right;
  }
}

.settings-content { margin-top: 12rpx; }
.settings-header { min-height: 78rpx; }
.settings-menu-row { display: flex; align-items: center; width: 100%; min-height: 132rpx; margin: 0; padding: 24rpx 0; border: 0; border-bottom: 1px solid rgba($color-border, .65); border-radius: 0; color: $color-text; text-align: left; background: transparent; line-height: 1.35; }
.settings-menu-row__copy { display: flex; min-width: 0; flex: 1; flex-direction: column; margin: 0 28rpx; font-size: 27rpx; font-weight: 600; }
.settings-menu-row__detail { margin-top: 5rpx; color: $color-muted; font-size: 22rpx; font-weight: 400; }
.settings-menu-row--short { min-height: 98rpx; border-bottom: 0; padding: 20rpx 0; }
.settings-expanded { padding: 8rpx 0 24rpx; }
.settings-info-icon { display: flex; align-items: center; justify-content: center; width: 19px; height: 19px; border: 2px solid currentColor; border-radius: 50%; font-size: 15px; font-family: serif; line-height: 1; }
</style>
