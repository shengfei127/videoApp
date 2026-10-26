import packageMetadata from '../../package.json'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import SettingsPage from '@/pages/settings/index.vue'
import { useAppStore } from '@/stores/appStore'

describe('Settings page', () => {
  beforeEach(() => {
    vi.mocked(uni.showModal).mockReset()
    vi.mocked(uni.showToast).mockReset()
  })

  it('renders the build-injected application version without a page literal', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/pages/settings/index.vue'),
      'utf8'
    )
    const { wrapper } = mountSettings()

    expect(source).toContain('__PIANKE_APP_VERSION__')
    expect(source).not.toMatch(/APP_VERSION\s*=\s*['"]\d/u)
    expect(wrapper.text()).toContain('版本 ' + packageMetadata.version)
  })

  it('shows source metadata and privacy state without rendering credentials or URLs', () => {
    const privateToken = 'PRIVATE_ACCESS_TOKEN_MUST_NOT_RENDER'
    const { wrapper } = mountSettings((store) => {
      store.authSession = {
        accessToken: privateToken,
        expiresAt: Date.UTC(2030, 0, 2, 3, 4),
        scope: ['basic', 'netdisk']
      }
      store.directRecords = [
        {
          id: 'direct-1',
          name: 'Private stream',
          url: 'https://private.example.test/live.m3u8?access_token=hidden',
          mediaKind: 'hls',
          addedAt: 1000
        },
        {
          id: 'direct-2',
          name: 'Movie',
          url: 'https://private.example.test/movie.mp4?dlink=signed',
          mediaKind: 'mp4',
          addedAt: 900
        }
      ]
      store.baiduCacheSavedAt = Date.UTC(2029, 11, 1, 2, 3)
    })

    expect(wrapper.text()).toContain('已连接')
    expect(wrapper.text()).toContain('/apps/片刻')
    expect(wrapper.text()).toContain('授权有效期')
    expect(wrapper.text()).toContain('2030')
    expect(wrapper.text()).toContain('2 条')
    expect(wrapper.text()).toContain('上次目录缓存')
    expect(wrapper.text()).toContain('2029')
    expect(wrapper.text()).toContain('播放进度和媒体直链仅保存在本机')
    expect(wrapper.text()).toContain(packageMetadata.version)

    for (const secret of [
      privateToken,
      'private.example.test',
      'access_token=hidden',
      'dlink=signed'
    ]) {
      expect(wrapper.html()).not.toContain(secret)
    }
  })

  it('disconnects only Baidu after confirmation and keeps local data', async () => {
    confirmEveryModal()
    const { store, wrapper } = mountSettings(seedAllSlices)

    const button = wrapper.get('[data-testid="settings-disconnect"]')
    expect(button.attributes('aria-label')).toBe('断开百度网盘连接')
    await button.trigger('click')

    expect(uni.showModal).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '断开百度网盘',
        confirmText: '断开'
      })
    )
    expect(store.authSession).toBeNull()
    expect(store.baiduVideos).toHaveLength(1)
    expect(store.directRecords).toHaveLength(1)
    expect(store.progressHistory).toHaveLength(1)
  })

  it('keeps the connection and history when clearing only catalog cache', async () => {
    confirmEveryModal()
    const { store, wrapper } = mountSettings(seedAllSlices)

    const button = wrapper.get('[data-testid="settings-clear-cache"]')
    expect(button.attributes('aria-label')).toBe('清除百度目录缓存')
    await button.trigger('click')

    expect(uni.showModal).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '清除目录缓存',
        confirmText: '清除'
      })
    )
    expect(store.baiduVideos).toEqual([])
    expect(store.baiduCacheSavedAt).toBeNull()
    expect(store.authSession).not.toBeNull()
    expect(store.directRecords).toHaveLength(1)
    expect(store.progressHistory).toHaveLength(1)
  })

  it('requires two explicit confirmations before clearing only progress', async () => {
    vi.mocked(uni.showModal)
      .mockImplementationOnce((options) => {
        options?.success?.({ confirm: true, cancel: false } as UniApp.ShowModalRes)
        return undefined as never
      })
      .mockImplementationOnce((options) => {
        options?.success?.({ confirm: false, cancel: true } as UniApp.ShowModalRes)
        return undefined as never
      })
    const { store, wrapper } = mountSettings(seedAllSlices)
    const button = wrapper.get('[data-testid="settings-clear-history"]')

    expect(button.attributes('aria-label')).toBe('永久清除本机播放历史')
    await button.trigger('click')

    expect(uni.showModal).toHaveBeenCalledTimes(2)
    expect(store.progressHistory).toHaveLength(1)

    vi.mocked(uni.showModal).mockReset()
    confirmEveryModal()
    await button.trigger('click')

    expect(uni.showModal).toHaveBeenCalledTimes(2)
    expect(vi.mocked(uni.showModal).mock.calls.map(([options]) => options?.title)).toEqual([
      '清除播放历史',
      '再次确认清除'
    ])
    expect(store.progressHistory).toEqual([])
    expect(store.resumableProgress).toEqual([])
    expect(store.authSession).not.toBeNull()
    expect(store.baiduVideos).toHaveLength(1)
    expect(store.directRecords).toHaveLength(1)
  })

  it('does nothing when a destructive confirmation is cancelled', async () => {
    vi.mocked(uni.showModal).mockImplementation((options) => {
      options?.success?.({ confirm: false, cancel: true } as UniApp.ShowModalRes)
      return undefined as never
    })
    const { store, wrapper } = mountSettings(seedAllSlices)

    await wrapper.get('[data-testid="settings-disconnect"]').trigger('click')
    await wrapper.get('[data-testid="settings-clear-cache"]').trigger('click')
    await wrapper.get('[data-testid="settings-clear-history"]').trigger('click')

    expect(store.authSession).not.toBeNull()
    expect(store.baiduVideos).toHaveLength(1)
    expect(store.progressHistory).toHaveLength(1)
  })

  it.each([
    [
      'disconnect',
      '[data-testid="settings-disconnect"]',
      '断开失败，请稍后重试',
      '已断开百度网盘'
    ],
    [
      'cache',
      '[data-testid="settings-clear-cache"]',
      '目录缓存清除失败，请稍后重试',
      '目录缓存已清除'
    ],
    [
      'history',
      '[data-testid="settings-clear-history"]',
      '播放历史清除失败，请稍后重试',
      '播放历史已清除'
    ]
  ] as const)(
    'shows only a safe failure toast when %s persistence fails',
    async (action, selector, failureTitle, successTitle) => {
      confirmEveryModal()
      const { store, wrapper } = mountSettings(seedAllSlices)
      const actionMock = vi.fn(() => false)
      if (action === 'disconnect') {
        store.disconnectBaidu = actionMock
      } else if (action === 'cache') {
        store.clearCatalogCache = actionMock
      } else {
        store.clearProgress = actionMock
      }

      await wrapper.get(selector).trigger('click')

      expect(actionMock).toHaveBeenCalledOnce()
      expect(uni.showToast).toHaveBeenCalledWith({
        title: failureTitle,
        icon: 'none'
      })
      expect(vi.mocked(uni.showToast).mock.calls).not.toContainEqual([
        expect.objectContaining({ title: successTitle })
      ])
    }
  )

  it.each([
    ['disconnectBaidu', '[data-testid="settings-disconnect"]'],
    ['clearCatalogCache', '[data-testid="settings-clear-cache"]']
  ] as const)(
    'runs %s only once when a system modal repeats its callback',
    async (action, selector) => {
      let callback: ((result: UniApp.ShowModalRes) => void) | undefined
      vi.mocked(uni.showModal).mockImplementation((options) => {
        callback = options?.success
        return undefined as never
      })
      const { store, wrapper } = mountSettings(seedAllSlices)
      const actionMock = vi.fn(() => true)
      store[action] = actionMock

      await wrapper.get(selector).trigger('click')
      callback?.({ confirm: true, cancel: false })
      callback?.({ confirm: true, cancel: false })

      expect(actionMock).toHaveBeenCalledOnce()
      expect(uni.showToast).toHaveBeenCalledTimes(1)
    }
  )

  it('guards both history confirmations against repeated callbacks', async () => {
    const callbacks: Array<(result: UniApp.ShowModalRes) => void> = []
    vi.mocked(uni.showModal).mockImplementation((options) => {
      if (options?.success) {
        callbacks.push(options.success)
      }
      return undefined as never
    })
    const { store, wrapper } = mountSettings(seedAllSlices)
    const clearProgress = vi.fn(() => true)
    store.clearProgress = clearProgress

    await wrapper.get('[data-testid="settings-clear-history"]').trigger('click')
    callbacks[0]?.({ confirm: true, cancel: false })
    callbacks[0]?.({ confirm: true, cancel: false })
    expect(uni.showModal).toHaveBeenCalledTimes(2)

    callbacks[1]?.({ confirm: true, cancel: false })
    callbacks[1]?.({ confirm: true, cancel: false })

    expect(clearProgress).toHaveBeenCalledOnce()
    expect(uni.showToast).toHaveBeenCalledTimes(1)
  })
})

function mountSettings(
  configure?: (store: ReturnType<typeof useAppStore>) => void
) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useAppStore(pinia)
  configure?.(store)
  const wrapper = mount(SettingsPage, {
    global: { plugins: [pinia] }
  })

  return { store, wrapper }
}

function seedAllSlices(store: ReturnType<typeof useAppStore>): void {
  store.authSession = {
    accessToken: 'private-token',
    expiresAt: Date.now() + 60_000,
    scope: ['basic', 'netdisk']
  }
  store.baiduVideos = [
    {
      id: 'baidu:1',
      sourceType: 'baidu',
      sourceId: '1',
      name: 'Cached.mp4',
      path: '/apps/片刻/Cached.mp4'
    }
  ]
  store.baiduCacheSavedAt = 1000
  store.directRecords = [
    {
      id: 'direct-1',
      name: 'Direct',
      url: 'https://cdn.example.test/direct.mp4',
      mediaKind: 'mp4',
      addedAt: 1000
    }
  ]
  store.progressHistory = [
    {
      videoId: 'baidu:1',
      positionSeconds: 120,
      durationSeconds: 600,
      updatedAt: 1000,
      completed: false
    }
  ]
  store.resumableProgress = [...store.progressHistory]
}

function confirmEveryModal(): void {
  vi.mocked(uni.showModal).mockImplementation((options) => {
    options?.success?.({ confirm: true, cancel: false } as UniApp.ShowModalRes)
    return undefined as never
  })
}
