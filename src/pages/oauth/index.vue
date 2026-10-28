<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'
import {
  ArrowLeft,
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

type OAuthPageStatus = 'idle' | 'opening' | 'missing-key' | 'cancelled' | 'error' | 'success'

const store = useAppStore()
const authRepository = new AuthRepository(uniStorage)
const status = ref<OAuthPageStatus>('idle')
const errorMessage = ref('')
let webviewHandle: OAuthWebviewHandle | null = null
let started = false
let disposed = false

const connectionTitle = computed(() => store.authSession ? '已连接百度网盘' : '连接百度网盘')

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
  <view class="oauth-page oauth-page--premium">
    <header class="oauth-header">
      <button type="button" data-testid="oauth-back" class="oauth-icon-button" aria-label="返回" @click="goBack"><ArrowLeft :size="22" aria-hidden="true" /></button>
      <text class="oauth-header__title">连接百度网盘</text>
    </header>
    <main class="oauth-content">
      <view class="oauth-brand-mark oauth-cloud" aria-hidden="true">
        <view class="oauth-cloud__ring oauth-cloud__ring--top" />
        <view class="oauth-cloud__ring oauth-cloud__ring--left" />
        <view class="oauth-cloud__ring oauth-cloud__ring--right" />
        <view class="oauth-cloud__base" />
        <view class="oauth-cloud__dot" />
        <view v-if="store.authSession || status === 'success'" class="oauth-cloud__check">✓</view>
      </view>
      <view class="oauth-status" aria-live="polite">
        <text v-if="errorMessage" class="oauth-status__title" role="alert">{{ errorMessage }}</text>
        <text v-else class="oauth-status__title">{{ status === 'opening' ? '正在打开百度授权' : status === 'success' ? '授权已完成' : connectionTitle }}</text>
        <text class="oauth-status__detail">{{ status === 'opening' ? '完成后将自动返回片刻' : '连接网盘 · 同步视频目录' }}</text>
      </view>
      <button type="button" data-testid="oauth-start" class="oauth-action oauth-action--primary" :disabled="status === 'opening'" :aria-label="status === 'error' || status === 'cancelled' ? '重新发起百度授权' : '授权并同步'" @click="status === 'idle' ? startAuthorization() : retry()">{{ status === 'opening' ? '正在授权…' : '授权并同步' }}</button>
      <LoaderCircle v-if="status === 'opening'" class="oauth-status__spinner" :size="18" aria-hidden="true" />
      <RefreshCw v-else class="oauth-sync-symbol" :size="17" aria-hidden="true" />
      <view class="oauth-privacy"><ShieldCheck :size="19" aria-hidden="true" /><text>仅访问片刻应用目录中的视频，
播放记录和课程进度保存在本机。</text></view>
    </main>
  </view>
</template>

<style scoped lang="scss">
@use '@/styles/tokens.scss' as *;
.oauth-page { box-sizing: border-box; min-height: 100vh; padding: calc(max(var(--status-bar-height, 0px), env(safe-area-inset-top, 0px)) + 22rpx) 40rpx 40rpx; background: $color-surface; }
.oauth-header { display: flex; align-items: center; min-height: 80rpx; }
.oauth-icon-button { box-sizing: border-box; flex: 0 0 auto; min-width: 44px; min-height: 44px; display: flex; width: 38rpx; height: 70rpx; align-items: center; justify-content: center; margin: 0 20rpx 0 0; padding: 0; border: 0; background: transparent; }
.oauth-header__title { font-size: 30rpx; font-weight: 650; }
.oauth-content { display: flex; flex-direction: column; align-items: center; padding-top: 100rpx; }
.oauth-cloud { position: relative; width: 230rpx; height: 190rpx; margin-bottom: 65rpx; }
.oauth-cloud__ring { position: absolute; box-sizing: border-box; border: 26rpx solid #3ca9e8; border-radius: 50%; }
.oauth-cloud__ring--top { top: 0; left: 50rpx; width: 130rpx; height: 130rpx; }
.oauth-cloud__ring--left { top: 58rpx; left: 8rpx; width: 108rpx; height: 108rpx; }
.oauth-cloud__ring--right { top: 64rpx; right: 6rpx; width: 102rpx; height: 102rpx; }
.oauth-cloud__base { position: absolute; bottom: 25rpx; left: 58rpx; width: 113rpx; height: 28rpx; background: #3ca9e8; }
.oauth-cloud__dot { position: absolute; top: 78rpx; left: 129rpx; width: 29rpx; height: 29rpx; border-radius: 50%; background: #ff9b7f; }
.oauth-cloud__check { position: absolute; right: -4rpx; bottom: 0; display: flex; align-items: center; justify-content: center; width: 78rpx; height: 78rpx; border: 12rpx solid $color-surface; border-radius: 50%; color: #fff; background: $color-primary; font-size: 42rpx; }
.oauth-status { display: flex; flex-direction: column; align-items: center; text-align: center; }
.oauth-status__title { color: $color-text; font-size: 34rpx; font-weight: 650; line-height: 1.45; }
.oauth-status__detail { margin-top: 12rpx; color: $color-muted; font-size: 26rpx; }
.oauth-action { box-sizing: border-box; padding: 14rpx 24rpx; white-space: normal; overflow-wrap: anywhere; text-align: center; line-height: 1.4; display: flex; align-items: center; justify-content: center; width: 100%; min-height: max(44px, 94rpx); margin: 48rpx 0 0; border: 0; border-radius: 999px; color: #fff; font-size: 30rpx; font-weight: 600; background: $color-primary; }
.oauth-action:disabled { opacity: .65; }
.oauth-sync-symbol, .oauth-status__spinner { margin: 34rpx 0; opacity: .55; }
.oauth-status__spinner { animation: oauth-spin .9s linear infinite; }
.oauth-privacy { display: flex; align-items: center; width: 100%; box-sizing: border-box; padding: 26rpx; border-radius: 12px; color: $color-muted; font-size: 22rpx; line-height: 1.7; background: #efede5; }
.oauth-privacy text { margin-left: 18rpx; white-space: pre-line; }
@keyframes oauth-spin { to { transform: rotate(360deg); } }
</style>
