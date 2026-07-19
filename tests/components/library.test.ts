import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import DirectLinkSheet from '@/components/DirectLinkSheet.vue'
import VideoRow from '@/components/VideoRow.vue'
import type { VideoItem } from '@/domain/video'
import LibraryPage from '@/pages/library/index.vue'
import { useAppStore } from '@/stores/appStore'

const lifecycle = vi.hoisted(() => ({ onLoad: vi.fn() }))

vi.mock('@dcloudio/uni-app', () => ({ onLoad: lifecycle.onLoad }))

describe('Library page', () => {
  beforeEach(() => {
    lifecycle.onLoad.mockReset()
    vi.stubGlobal('crypto', {
      randomUUID: vi.fn(() => 'library-direct-id')
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('switches a fixed two-option segment between recent videos and folders', async () => {
    const { wrapper } = mountLibrary((store) => {
      store.baiduVideos = nestedVideos()
    })
    const segments = wrapper.findAll('button.library-segment__button')

    expect(segments).toHaveLength(2)
    expect(segments.map((button) => button.text())).toEqual([
      '最近视频',
      '按文件夹'
    ])
    expect(segments[0]?.attributes('aria-pressed')).toBe('true')
    expect(wrapper.findAllComponents(VideoRow)).toHaveLength(2)

    await segments[1]!.trigger('click')

    expect(segments[1]?.attributes('aria-pressed')).toBe('true')
    expect(wrapper.findAll('[data-testid="folder-row"]')).toHaveLength(1)
    expect(wrapper.get('[data-testid="folder-row"]').text()).toContain('课程')
    expect(wrapper.get('[data-testid="folder-row"]').text()).toContain('2 个视频')
  })

  it('filters only the local catalog by name or path without a provider request', async () => {
    const { wrapper } = mountLibrary((store) => {
      store.baiduVideos = [
        video('1', '海边日记.mp4', '/apps/片刻/旅行/海边日记.mp4', 300),
        video('2', '城市漫步.mp4', '/apps/片刻/travel/城市漫步.mp4', 200),
        video('3', '烘焙课.mp4', '/apps/片刻/课程/烘焙课.mp4', 100)
      ]
    })
    const search = wrapper.get('[data-testid="library-search"]')

    await search.setValue('海边')
    expect(wrapper.findAllComponents(VideoRow).map((row) => row.props('video').id)).toEqual([
      'baidu:1'
    ])

    await search.setValue('travel')
    expect(wrapper.findAllComponents(VideoRow).map((row) => row.props('video').id)).toEqual([
      'baidu:2'
    ])
    expect(uni.request).not.toHaveBeenCalled()

    await search.setValue('不存在')
    expect(wrapper.findAllComponents(VideoRow)).toHaveLength(0)
    expect(wrapper.get('[data-testid="library-empty-search"]').text()).toBe(
      '没有找到匹配的视频'
    )
    expect(wrapper.get('[data-testid="library-empty-search"]').classes()).toContain(
      'library-empty-band'
    )
  })

  it('traverses the reconstructed folder tree and returns through breadcrumbs', async () => {
    const { wrapper } = mountLibrary((store) => {
      store.baiduVideos = nestedVideos()
    })
    await wrapper.findAll('button.library-segment__button')[1]!.trigger('click')

    await wrapper.get('[data-testid="folder-row"]').trigger('click')
    expect(wrapper.findAll('[data-testid="breadcrumb"]')).toHaveLength(2)
    expect(wrapper.findAll('[data-testid="breadcrumb"]').map((item) => item.text())).toEqual([
      '片刻',
      '课程'
    ])
    expect(wrapper.get('[data-testid="folder-row"]').text()).toContain('第一章')

    await wrapper.get('[data-testid="folder-row"]').trigger('click')
    expect(wrapper.findAllComponents(VideoRow)).toHaveLength(2)

    await wrapper.findAll('[data-testid="breadcrumb"]')[0]!.trigger('click')
    expect(wrapper.findAll('[data-testid="breadcrumb"]')).toHaveLength(1)
    expect(wrapper.get('[data-testid="folder-row"]').text()).toContain('课程')
  })

  it('disables refresh during cooldown and suppresses duplicate active requests', async () => {
    const pending = deferred<{
      ok: true
      refreshed: boolean
      count: number
      savedAt: number | null
    }>()
    const { store, wrapper } = mountLibrary((appStore) => {
      appStore.authSession = {
        accessToken: 'private-token',
        expiresAt: Date.now() + 60_000,
        scope: ['basic', 'netdisk']
      }
      appStore.syncStatus = 'cooldown'
      appStore.nextSyncAllowedAt = Date.now() + 60_000
      appStore.syncBaidu = vi.fn(() => pending.promise)
    })
    const refresh = wrapper.get('[data-testid="library-refresh"]')

    expect(refresh.attributes('aria-label')).toBe('刷新百度视频目录')
    expect(refresh.attributes('title')).toBe('刷新')
    expect(refresh.attributes('disabled')).toBeDefined()
    await refresh.trigger('click')
    expect(store.syncBaidu).not.toHaveBeenCalled()

    store.syncStatus = 'idle'
    store.nextSyncAllowedAt = null
    await wrapper.vm.$nextTick()
    void refresh.trigger('click')
    void refresh.trigger('click')
    await wrapper.vm.$nextTick()

    expect(store.syncBaidu).toHaveBeenCalledTimes(1)
    pending.resolve({ ok: true, refreshed: true, count: 0, savedAt: Date.now() })
    await flushPromises()
  })

  it('reenables refresh when the cooldown deadline passes', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2030-01-01T00:00:00.000Z'))
    const { wrapper } = mountLibrary((store) => {
      store.authSession = {
        accessToken: 'private-token',
        expiresAt: Date.now() + 120_000,
        scope: ['basic', 'netdisk']
      }
      store.syncStatus = 'cooldown'
      store.nextSyncAllowedAt = Date.now() + 60_000
    })
    const refresh = wrapper.get('[data-testid="library-refresh"]')

    expect(refresh.attributes('disabled')).toBeDefined()
    await vi.advanceTimersByTimeAsync(60_001)
    await wrapper.vm.$nextTick()

    expect(refresh.attributes('disabled')).toBeUndefined()
  })

  it('opens import from Plus and from onLoad openImport=1', async () => {
    const { wrapper } = mountLibrary()
    const sheet = wrapper.getComponent(DirectLinkSheet)

    expect(wrapper.get('[data-testid="library-add"]').attributes('aria-label')).toBe(
      '导入媒体直链'
    )
    expect(sheet.props('open')).toBe(false)
    await wrapper.get('[data-testid="library-add"]').trigger('click')
    expect(sheet.props('open')).toBe(true)

    await sheet.vm.$emit('close')
    expect(sheet.props('open')).toBe(false)
    expect(lifecycle.onLoad).toHaveBeenCalledOnce()
    const handleLoad = lifecycle.onLoad.mock.calls[0]![0]
    handleLoad({ openImport: '1' })
    await wrapper.vm.$nextTick()
    expect(sheet.props('open')).toBe(true)
  })

  it('routes a selected video with an encoded ID', async () => {
    const selected = video(
      '海边 / 第一集?',
      '海边第一集.mp4',
      '/apps/片刻/海边第一集.mp4',
      100
    )
    const { wrapper } = mountLibrary((store) => {
      store.baiduVideos = [selected]
    })

    await wrapper.getComponent(VideoRow).get('button.video-row').trigger('click')

    expect(uni.navigateTo).toHaveBeenCalledWith({
      url: `/pages/player/index?id=${encodeURIComponent(selected.id)}`
    })
  })

  it('reloads the local catalog immediately after direct-link add, edit, and delete', async () => {
    vi.mocked(uni.showModal).mockImplementation((options) => {
      options?.success?.({ confirm: true, cancel: false } as UniApp.ShowModalRes)
      return undefined as never
    })
    const { store, wrapper } = mountLibrary()

    await wrapper.get('[data-testid="library-add"]').trigger('click')
    let sheet = wrapper.getComponent(DirectLinkSheet)
    await sheet.get('[data-testid="direct-url"]').setValue(
      'https://cdn.example.test/original.mp4'
    )
    await sheet.get('[data-testid="direct-name"]').setValue('Original')
    await sheet.get('[data-testid="direct-save"]').trigger('click')

    expect(store.directRecords).toMatchObject([
      { id: 'library-direct-id', name: 'Original', mediaKind: 'mp4' }
    ])
    expect(wrapper.findAllComponents(VideoRow)).toHaveLength(1)

    await wrapper.get('[data-testid="manage-direct-link"]').trigger('click')
    sheet = wrapper.getComponent(DirectLinkSheet)
    await sheet.get('[data-testid="direct-url"]').setValue(
      'https://cdn.example.test/replacement.m3u8'
    )
    await sheet.get('[data-testid="direct-name"]').setValue('Replacement')
    await sheet.get('[data-testid="direct-save"]').trigger('click')

    expect(store.directRecords).toEqual([
      {
        id: 'library-direct-id',
        name: 'Replacement',
        url: 'https://cdn.example.test/replacement.m3u8',
        mediaKind: 'hls',
        addedAt: expect.any(Number)
      }
    ])

    await wrapper.get('[data-testid="manage-direct-link"]').trigger('click')
    sheet = wrapper.getComponent(DirectLinkSheet)
    await sheet.get('[data-testid="direct-delete"]').trigger('click')

    expect(store.directRecords).toEqual([])
    expect(wrapper.findAllComponents(VideoRow)).toHaveLength(0)
  })
})

function mountLibrary(
  configure?: (store: ReturnType<typeof useAppStore>) => void
) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useAppStore(pinia)
  configure?.(store)
  const wrapper = mount(LibraryPage, {
    global: { plugins: [pinia] }
  })

  return { store, wrapper }
}

function nestedVideos(): VideoItem[] {
  return [
    video('1', '第一课.mp4', '/apps/片刻/课程/第一章/第一课.mp4', 200),
    video('2', '第二课.mp4', '/apps/片刻/课程/第一章/第二课.mp4', 100)
  ]
}

function video(
  sourceId: string,
  name: string,
  path: string,
  modifiedAt: number
): VideoItem {
  return {
    id: `baidu:${sourceId}`,
    sourceType: 'baidu',
    sourceId,
    name,
    path,
    modifiedAt
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}
