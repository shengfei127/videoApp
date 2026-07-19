import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AuthRepository } from '@/features/auth/authRepository'
import type {
  OAuthPendingState,
  OpenOAuthWebviewOptions
} from '@/features/auth/oauthWebview'
import { uniStorage } from '@/infrastructure/storage'
import OAuthPage from '@/pages/oauth/index.vue'
import { useAppStore } from '@/stores/appStore'

const oauthPageMocks = vi.hoisted(() => ({
  config: {
    baiduAppKey: 'public-app-key',
    baiduAppFolder: '片刻',
    baiduRoot: '/apps/片刻',
    baiduRedirectUri: 'https://localhost/pianke/oauth/baidu',
    useMocks: false
  },
  openOAuthWebview: vi.fn()
}))

vi.mock('@/config/runtime', () => ({ runtimeConfig: oauthPageMocks.config }))
vi.mock('@/features/auth/oauthWebview', () => ({
  openOAuthWebview: oauthPageMocks.openOAuthWebview
}))

describe('OAuth page', () => {
  beforeEach(() => {
    Object.assign(oauthPageMocks.config, {
      baiduAppKey: 'public-app-key',
      baiduAppFolder: '片刻',
      baiduRoot: '/apps/片刻',
      baiduRedirectUri: 'https://localhost/pianke/oauth/baidu',
      useMocks: false
    })
    oauthPageMocks.openOAuthWebview.mockReset()
    vi.stubGlobal('crypto', {
      randomUUID: vi.fn(() => 'secure-state-uuid')
    })
  })

  it('shows the exact missing-AppKey state and never opens a WebView', async () => {
    oauthPageMocks.config.baiduAppKey = '   '
    const { wrapper } = mountOAuth()
    await flushPromises()

    expect(wrapper.get('[role="alert"]').text()).toBe(
      '尚未配置百度 AppKey'
    )
    expect(oauthPageMocks.openOAuthWebview).not.toHaveBeenCalled()

    await wrapper.get('[data-testid="oauth-back"]').trigger('click')
    expect(uni.navigateBack).toHaveBeenCalledOnce()
  })

  it('passes mock mode through the full callback flow and redirects home', async () => {
    oauthPageMocks.config.useMocks = true
    const close = vi.fn()
    oauthPageMocks.openOAuthWebview.mockImplementation(
      (options: OpenOAuthWebviewOptions) => {
        expect(options.mockMode).toBe(true)
        const pending = options.createPendingState()
        queueCallback(options, pending, validCallback(pending.state))
        return { enabled: true, close }
      }
    )
    const { store, wrapper } = mountOAuth()
    store.syncBaidu = vi.fn().mockResolvedValue({
      ok: true,
      refreshed: true,
      count: 0,
      savedAt: Date.now()
    })

    await vi.waitFor(() => {
      expect(uni.redirectTo).toHaveBeenCalledWith({
        url: '/pages/home/index'
      })
    })

    expect(store.reloadAuthSession()).toMatchObject({
      accessToken: 'private-oauth-token',
      scope: ['basic', 'netdisk']
    })
    expect(store.syncBaidu).toHaveBeenCalledWith(true)
    expect(wrapper.html()).not.toContain('private-oauth-token')
  })

  it('creates and consumes one pending state for a valid App callback', async () => {
    let captured: OpenOAuthWebviewOptions | undefined
    oauthPageMocks.openOAuthWebview.mockImplementation(
      (options: OpenOAuthWebviewOptions) => {
        captured = options
        const pending = options.createPendingState()
        queueCallback(options, pending, validCallback(pending.state))
        return { enabled: true, close: vi.fn() }
      }
    )
    const { store } = mountOAuth()
    store.syncBaidu = vi.fn().mockResolvedValue({
      ok: true,
      refreshed: true,
      count: 0,
      savedAt: Date.now()
    })

    await vi.waitFor(() => expect(uni.redirectTo).toHaveBeenCalledOnce())

    expect(captured?.mockMode).toBe(false)
    const authorizeUrl = new URL(captured!.authorizeUrl)
    expect(authorizeUrl.searchParams.get('client_id')).toBe('public-app-key')
    expect(authorizeUrl.searchParams.get('state')).toBe('secure-state-uuid')
    expect(authorizeUrl.searchParams.get('scope')).toBe('basic,netdisk')
    expect(new AuthRepository(uniStorage).consumePending(Date.now())).toBeNull()
    expect(store.authSession?.accessToken).toBe('private-oauth-token')
  })

  it('does not save a failed callback and renders only a safe error', async () => {
    const rawSecret = 'RAW_CALLBACK_TOKEN_MUST_NOT_RENDER'
    oauthPageMocks.openOAuthWebview.mockImplementation(
      (options: OpenOAuthWebviewOptions) => {
        const pending = options.createPendingState()
        const consumed = options.consumePendingState()
        Promise.resolve()
          .then(() =>
            options.onCallback(
              `${oauthPageMocks.config.baiduRedirectUri}#access_token=${rawSecret}&expires_in=3600&scope=basic+netdisk&state=wrong-state`,
              consumed ?? pending
            )
          )
          .catch(() => options.onCallbackFailure?.())
        return { enabled: true, close: vi.fn() }
      }
    )
    const { store, wrapper } = mountOAuth()
    store.syncBaidu = vi.fn()

    await vi.waitFor(() => {
      expect(wrapper.get('[role="alert"]').text()).toBe(
        '百度网盘授权失败，请重试'
      )
    })

    expect(wrapper.html()).not.toContain(rawSecret)
    expect(new AuthRepository(uniStorage).getValidSession(Date.now())).toBeNull()
    expect(store.syncBaidu).not.toHaveBeenCalled()
    expect(uni.redirectTo).not.toHaveBeenCalled()
  })

  it('clears pending state on cancellation without saving a session', async () => {
    oauthPageMocks.openOAuthWebview.mockImplementation(
      (options: OpenOAuthWebviewOptions) => {
        options.createPendingState()
        options.clearPendingState()
        Promise.resolve().then(() => options.onCancel?.())
        return { enabled: true, close: vi.fn() }
      }
    )
    const { store, wrapper } = mountOAuth()
    store.syncBaidu = vi.fn()

    await vi.waitFor(() => {
      expect(wrapper.get('[role="alert"]').text()).toBe(
        '已取消百度网盘授权'
      )
    })

    const repository = new AuthRepository(uniStorage)
    expect(repository.consumePending(Date.now())).toBeNull()
    expect(repository.getValidSession(Date.now())).toBeNull()
    expect(store.syncBaidu).not.toHaveBeenCalled()
    expect(uni.redirectTo).not.toHaveBeenCalled()
  })

  it('closes the active OAuth handle when the page unmounts', async () => {
    const close = vi.fn()
    oauthPageMocks.openOAuthWebview.mockReturnValue({ enabled: true, close })
    const { wrapper } = mountOAuth()
    await flushPromises()

    wrapper.unmount()

    expect(close).toHaveBeenCalledOnce()
  })

  it('still renders a safe failure when pending cleanup throws', async () => {
    let captured: OpenOAuthWebviewOptions | undefined
    oauthPageMocks.openOAuthWebview.mockImplementation(
      (options: OpenOAuthWebviewOptions) => {
        captured = options
        return { enabled: true, close: vi.fn() }
      }
    )
    const { wrapper } = mountOAuth()
    await flushPromises()
    vi.spyOn(uni, 'removeStorageSync').mockImplementation(() => {
      throw new Error('PRIVATE_STORAGE_VALUE_MUST_NOT_RENDER')
    })

    expect(() => captured?.onCallbackFailure?.()).not.toThrow()
    await wrapper.vm.$nextTick()

    expect(wrapper.get('[role="alert"]').text()).toBe(
      '百度网盘授权失败，请重试'
    )
    expect(wrapper.html()).not.toContain('PRIVATE_STORAGE_VALUE_MUST_NOT_RENDER')
  })
})

function mountOAuth() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useAppStore(pinia)
  const wrapper = mount(OAuthPage, {
    global: { plugins: [pinia] }
  })

  return { store, wrapper }
}

function queueCallback(
  options: OpenOAuthWebviewOptions,
  pending: OAuthPendingState,
  callbackUrl: string
): void {
  Promise.resolve().then(async () => {
    const consumed = options.consumePendingState()
    await options.onCallback(callbackUrl, consumed ?? pending)
  })
}

function validCallback(state: string): string {
  const url = new URL(oauthPageMocks.config.baiduRedirectUri)
  url.hash = new URLSearchParams({
    access_token: 'private-oauth-token',
    expires_in: '3600',
    scope: 'basic netdisk',
    state
  }).toString()
  return url.toString()
}
