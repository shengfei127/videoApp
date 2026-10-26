<script setup lang="ts">
import { onUnmounted, ref } from 'vue'
import { onReady } from '@dcloudio/uni-app'
import {
  ArrowLeft,
  CircleAlert,
  Cloud,
  LoaderCircle,
  RefreshCw,
  ShieldCheck
} from '@/components/icons'

import { runtimeConfig } from '@/config/runtime'
import type { BaiduAuthSession } from '@/domain/video'
import { AuthRepository } from '@/features/auth/authRepository'
import {
  buildAuthorizeUrl,
  createOAuthState,
  parseOAuthCallback
} from '@/features/auth/oauth'
import {
  openOAuthWebview,
  type OAuthPendingState,
  type OAuthWebviewHandle
} from '@/features/auth/oauthWebview'
import { uniStorage } from '@/infrastructure/storage'
import { useAppStore } from '@/stores/appStore'

type OAuthPageStatus = 'opening' | 'missing-key' | 'cancelled' | 'error' | 'success'

const store = useAppStore()
const authRepository = new AuthRepository(uniStorage)
const status = ref<OAuthPageStatus>('opening')
const errorMessage = ref('')
let webviewHandle: OAuthWebviewHandle | null = null
let started = false
let disposed = false

onReady(() => {
  startAuthorization()
})

onUnmounted(() => {
  disposed = true
  webviewHandle?.close()
  webviewHandle = null
})

function startAuthorization(): void {
  if (started || disposed) {
    return
  }

  const appKey = runtimeConfig.baiduAppKey.trim()
  if (!appKey) {
    status.value = 'missing-key'
    errorMessage.value = '尚未配置百度 AppKey'
    return
  }

  started = true
  status.value = 'opening'
  errorMessage.value = ''

  try {
    const state = createOAuthState()
    const authorizeUrl = buildAuthorizeUrl(
      {
        appKey,
        redirectUri: runtimeConfig.baiduRedirectUri
      },
      state
    )

    webviewHandle = openOAuthWebview({
      authorizeUrl,
      redirectUri: runtimeConfig.baiduRedirectUri,
      mockMode: runtimeConfig.useMocks,
      createPendingState: () =>
        authRepository.createPending(state, Date.now()),
      consumePendingState: () => authRepository.consumePending(Date.now()),
      clearPendingState: () => authRepository.clearPending(),
      onCallback: completeAuthorization,
      onCancel: handleCancellation,
      onCallbackFailure: handleFailure
    })

    if (!webviewHandle.enabled && status.value === 'opening') {
      handleFailure()
    }
  } catch {
    clearPendingSafely()
    handleFailure()
  }
}

async function completeAuthorization(
  callbackUrl: string,
  pending: OAuthPendingState
): Promise<void> {
  const now = Date.now()
  const previousSession = readPreviousSession(now)
  let savedNewSession = false

  try {
    const session = parseOAuthCallback(
      callbackUrl,
      runtimeConfig.baiduRedirectUri,
      pending.state,
      now
    )
    authRepository.saveSession(session)
    savedNewSession = true
    store.reloadAuthSession()
    const syncResult = await store.syncBaidu(true)
    if (
      !syncResult.ok &&
      (syncResult.reason === 'authorization' ||
        syncResult.reason === 'no-session')
    ) {
      throw new Error('OAuth session was rejected during initial sync')
    }

    if (disposed) {
      return
    }

    status.value = 'success'
    errorMessage.value = ''
    uni.redirectTo({ url: '/pages/home/index' })
  } catch (error) {
    if (savedNewSession) {
      restoreSession(previousSession)
      store.reloadAuthSession()
    }
    throw error
  }
}

function readPreviousSession(now: number): BaiduAuthSession | null {
  try {
    return authRepository.getValidSession(now)
  } catch {
    return null
  }
}

function restoreSession(session: BaiduAuthSession | null): void {
  try {
    if (session) {
      authRepository.saveSession(session)
    } else {
      authRepository.clearSession()
    }
  } catch {
    try {
      authRepository.clearSession()
    } catch {
      // The original callback failure remains the only public error.
    }
  }
}

function handleCancellation(): void {
  if (disposed || status.value === 'success') {
    return
  }

  clearPendingSafely()
  status.value = 'cancelled'
  errorMessage.value = '已取消百度网盘授权'
}

function handleFailure(): void {
  if (disposed || status.value === 'success') {
    return
  }

  clearPendingSafely()
  status.value = 'error'
  errorMessage.value = '百度网盘授权失败，请重试'
}

function retry(): void {
  webviewHandle?.close()
  webviewHandle = null
  clearPendingSafely()
  started = false
  status.value = 'opening'
  errorMessage.value = ''
  startAuthorization()
}

function goBack(): void {
  uni.navigateBack()
}

function clearPendingSafely(): void {
  try {
    authRepository.clearPending()
  } catch {
    // Cleanup failures must not expose stored OAuth data in the page state.
  }
}
</script>

<template>
  <view class="oauth-page">
    <header class="oauth-header">
      <button
        type="button"
        data-testid="oauth-back"
        class="oauth-icon-button"
        aria-label="返回"
        title="返回"
        @click="goBack"
      >
        <ArrowLeft :size="22" aria-hidden="true" />
      </button>
      <view class="oauth-header__copy">
        <text class="oauth-header__title">连接百度网盘</text>
        <text class="oauth-header__path">{{ runtimeConfig.baiduRoot }}</text>
      </view>
    </header>

    <main class="oauth-content">
      <view v-if="status === 'opening'" class="oauth-status" aria-live="polite">
        <LoaderCircle
          class="oauth-status__spinner"
          :size="30"
          aria-hidden="true"
        />
        <text class="oauth-status__title">正在打开百度授权</text>
        <text class="oauth-status__detail">完成后将自动返回片刻</text>
      </view>

      <view v-else-if="status === 'success'" class="oauth-status" aria-live="polite">
        <ShieldCheck :size="32" aria-hidden="true" />
        <text class="oauth-status__title">授权已完成</text>
      </view>

      <view v-else class="oauth-status">
        <CircleAlert :size="32" aria-hidden="true" />
        <text class="oauth-status__title" role="alert">{{ errorMessage }}</text>
        <text v-if="status === 'missing-key'" class="oauth-status__detail">
          请在本机环境配置中填写公开 AppKey
        </text>
        <view class="oauth-actions">
          <button
            v-if="status === 'error' || status === 'cancelled'"
            type="button"
            class="oauth-action oauth-action--primary"
            aria-label="重新发起百度授权"
            @click="retry"
          >
            <RefreshCw :size="19" aria-hidden="true" />
            <text>重试</text>
          </button>
          <button
            type="button"
            class="oauth-action oauth-action--secondary"
            aria-label="返回上一页"
            @click="goBack"
          >
            <Cloud :size="19" aria-hidden="true" />
            <text>返回</text>
          </button>
        </view>
      </view>
    </main>
  </view>
</template>

<style scoped lang="scss">
@use '@/styles/tokens.scss' as *;

.oauth-page {
  box-sizing: border-box;
  min-height: 100vh;
  padding: calc(var(--status-bar-height, 0px) + 24rpx) 24rpx 32rpx;
  background: $color-bg;
}

.oauth-header {
  display: grid;
  grid-template-columns: 76rpx minmax(0, 1fr);
  gap: 16rpx;
  align-items: center;
  min-height: 92rpx;
}

.oauth-icon-button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 76rpx;
  height: 76rpx;
  margin: 0;
  padding: 0;
  border: 1px solid $color-border;
  border-radius: $radius-control;
  color: $color-text;
  background: $color-surface;
}

.oauth-header__copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 4rpx;
}

.oauth-header__title {
  font-size: 31rpx;
  font-weight: 740;
  line-height: 1.3;
}

.oauth-header__path {
  overflow: hidden;
  color: $color-muted;
  font-size: 21rpx;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.oauth-content {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: calc(100vh - 180rpx);
}

.oauth-status {
  box-sizing: border-box;
  display: flex;
  width: min(100%, 620rpx);
  flex-direction: column;
  gap: 14rpx;
  align-items: center;
  padding: 34rpx 28rpx;
  border: 1px solid $color-border;
  border-radius: $radius-card;
  color: $color-primary;
  text-align: center;
  background: $color-surface;
}

.oauth-status__spinner {
  animation: oauth-spin 0.9s linear infinite;
}

.oauth-status__title {
  color: $color-text;
  font-size: 28rpx;
  font-weight: 720;
  line-height: 1.4;
  overflow-wrap: anywhere;
}

.oauth-status__detail {
  color: $color-muted;
  font-size: 22rpx;
  line-height: 1.5;
}

.oauth-actions,
.oauth-action {
  display: flex;
  align-items: center;
}

.oauth-actions {
  flex-wrap: wrap;
  justify-content: center;
  gap: 12rpx;
  margin-top: 10rpx;
}

.oauth-action {
  box-sizing: border-box;
  gap: 8rpx;
  justify-content: center;
  min-width: 152rpx;
  min-height: 74rpx;
  margin: 0;
  padding: 12rpx 20rpx;
  border: 1px solid $color-primary;
  border-radius: $radius-control;
  font-size: 23rpx;
  font-weight: 700;
}

.oauth-action--primary {
  color: #ffffff;
  background: $color-primary;
}

.oauth-action--secondary {
  color: $color-primary;
  background: $color-primary-soft;
}

@keyframes oauth-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
