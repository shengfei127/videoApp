<script setup lang="ts">
import { computed } from 'vue'
import {
  Cloud,
  Database,
  History,
  Link,
  LogOut,
  ShieldCheck,
  Trash2
} from 'lucide-vue-next'

import BottomNav from '@/components/BottomNav.vue'
import { runtimeConfig } from '@/config/runtime'
import { useAppStore } from '@/stores/appStore'

const appVersion = __PIANKE_APP_VERSION__
const store = useAppStore()

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
    return '时间未知'
  }
}
</script>

<template>
  <view class="page-shell settings-page">
    <header class="settings-header">
      <text class="settings-header__title">设置</text>
      <text class="settings-header__subtitle">来源、存储与隐私</text>
    </header>

    <main class="settings-content">
      <section class="settings-section" aria-labelledby="settings-baidu-title">
        <view class="settings-section__heading">
          <Cloud :size="21" aria-hidden="true" />
          <text id="settings-baidu-title">百度网盘</text>
        </view>
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
      </section>

      <section class="settings-section" aria-labelledby="settings-local-title">
        <view class="settings-section__heading">
          <Database :size="21" aria-hidden="true" />
          <text id="settings-local-title">本机数据</text>
        </view>
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
      </section>

      <section class="settings-section" aria-labelledby="settings-privacy-title">
        <view class="settings-section__heading">
          <ShieldCheck :size="21" aria-hidden="true" />
          <text id="settings-privacy-title">隐私</text>
        </view>
        <view class="settings-privacy-band">
          <text>播放进度和媒体直链仅保存在本机。</text>
          <text>百度授权仅用于访问应用专属目录，不显示或记录访问凭证。</text>
        </view>
      </section>

      <view class="settings-version" aria-label="应用版本">
        <text>片刻</text>
        <text>版本 {{ appVersion }}</text>
      </view>
    </main>

    <BottomNav active="settings" />
  </view>
</template>

<style scoped lang="scss">
@use '@/styles/tokens.scss' as *;

.settings-page {
  padding-top: max(24rpx, env(safe-area-inset-top));
}

.settings-header {
  display: flex;
  min-height: 92rpx;
  flex-direction: column;
  justify-content: center;
  gap: 4rpx;
}

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
  gap: 30rpx;
  margin-top: 20rpx;
}

.settings-section {
  display: flex;
  flex-direction: column;
  gap: 14rpx;
}

.settings-section__heading,
.settings-row,
.settings-row__label-with-icon,
.settings-action,
.settings-action-row,
.settings-version {
  display: flex;
  align-items: center;
}

.settings-section__heading {
  gap: 10rpx;
  color: $color-text;
  font-size: 27rpx;
  font-weight: 720;
}

.settings-band {
  border-top: 1px solid $color-border;
  border-bottom: 1px solid $color-border;
  background: rgba($color-surface, 0.64);
}

.settings-row {
  box-sizing: border-box;
  justify-content: space-between;
  gap: 24rpx;
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

.settings-row__label-with-icon {
  gap: 10rpx;
}

.settings-row__value {
  max-width: 62%;
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
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12rpx;
}

.settings-action {
  box-sizing: border-box;
  gap: 9rpx;
  justify-content: center;
  min-width: 0;
  min-height: 74rpx;
  margin: 0;
  padding: 12rpx 18rpx;
  border: 1px solid $color-border;
  border-radius: $radius-control;
  font-size: 22rpx;
  font-weight: 700;
  line-height: 1.3;
}

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
  gap: 10rpx;
  padding: 20rpx 18rpx;
  border-top: 1px solid $color-border;
  border-bottom: 1px solid $color-border;
  color: $color-muted;
  font-size: 22rpx;
  line-height: 1.55;
  background: rgba($color-surface, 0.5);
}

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
    align-items: flex-start;
    flex-direction: column;
    gap: 6rpx;
  }

  .settings-row__value {
    max-width: 100%;
    text-align: left;
  }
}
</style>
