import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import DirectLinkSheet from '@/components/DirectLinkSheet.vue'
import VideoRow from '@/components/VideoRow.vue'
import type { VideoItem } from '@/domain/video'
import LibraryPage from '@/pages/library/index.vue'
import { useAppStore } from '@/stores/appStore'

const lifecycle = vi.hoisted(() => ({ onLoad: vi.fn(), onShow: vi.fn(), onHide: vi.fn(), onUnload: vi.fn(), onReady: vi.fn(), onPageScroll: vi.fn() }))

vi.mock('@dcloudio/uni-app', () => ({ onLoad: lifecycle.onLoad, onShow: lifecycle.onShow, onHide: lifecycle.onHide, onUnload: lifecycle.onUnload, onReady: lifecycle.onReady, onPageScroll: lifecycle.onPageScroll }))

describe('Library page', () => {
  it('retries the same position after a transient save failure and deduplicates only success', async () => {
    vi.useFakeTimers()
    const { wrapper } = mountLibrary((store) => { store.baiduVideos = nestedVideos() })
    await wrapper.get('[data-testid="folder-row"]').trigger('click')
    await wrapper.get('[data-testid="folder-row"]').trigger('click')
    lifecycle.onReady.mock.calls.at(-1)![0]()
    await flushPromises()
    await vi.advanceTimersByTimeAsync(0)
    lifecycle.onPageScroll.mock.calls.at(-1)![0]({ scrollTop: 700 })
    const write = vi.spyOn(uni, 'setStorageSync').mockImplementationOnce(() => { throw new Error('temporary quota') })
    expect(() => lifecycle.onHide.mock.calls.at(-1)![0]()).not.toThrow()
    expect(uni.getStorageSync('pianke.library-position.v1')).toBeUndefined()
    lifecycle.onUnload.mock.calls.at(-1)![0]()
    expect(JSON.parse(uni.getStorageSync('pianke.library-position.v1'))).toMatchObject({ folderPath: '/apps/片刻/课程/第一章', scrollTop: 700 })
    wrapper.unmount()
    expect(write.mock.calls.filter(([key]) => key === 'pianke.library-position.v1')).toHaveLength(2)
  })

  it('restores folder, loaded range, pending search and scroll after destruction', async () => {
    vi.useFakeTimers()
    const populate = (store: ReturnType<typeof useAppStore>) => {
      store.baiduVideos = Array.from({ length: 120 }, (_, i) => video(String(i), `课程 ${i}.mp4`, `/apps/片刻/课程/第一章/课程 ${i}.mp4`, i))
    }
    const first = mountLibrary(populate)
    await first.wrapper.get('[data-testid="folder-row"]').trigger('click')
    await first.wrapper.get('[data-testid="folder-row"]').trigger('click')
    await first.wrapper.get('[data-testid="library-load-more"]').trigger('click')
    lifecycle.onReady.mock.calls.at(-1)![0]()
    await flushPromises()
    await vi.advanceTimersByTimeAsync(0)
    lifecycle.onPageScroll.mock.calls.at(-1)![0]({ scrollTop: 650 })
    first.wrapper.unmount()
    const second = mountLibrary(populate)
    expect(second.wrapper.findAll('[data-testid="breadcrumb"]').at(-1)?.text()).toContain('第一章')
    expect(second.wrapper.findAllComponents(VideoRow)).toHaveLength(100)
    lifecycle.onReady.mock.calls.at(-1)![0]()
    await flushPromises()
    await vi.advanceTimersByTimeAsync(0)
    expect(uni.pageScrollTo).toHaveBeenCalledWith({ scrollTop: 650, duration: 0 })
    await second.wrapper.get('[data-testid="library-search"]').setValue('课程 119')
    second.wrapper.unmount()
    const third = mountLibrary(populate)
    expect(third.store.searchQuery).toBe('课程 119')
    expect(third.wrapper.findAllComponents(VideoRow)).toHaveLength(1)
    third.wrapper.unmount()
  })

  it('falls back to a surviving ancestor when the catalog changes', async () => {
    const { wrapper, store } = mountLibrary((store) => { store.baiduVideos = nestedVideos() })
    await wrapper.get('[data-testid="folder-row"]').trigger('click')
    await wrapper.get('[data-testid="folder-row"]').trigger('click')
    store.baiduVideos = [video('3', '第三课.mp4', '/apps/片刻/课程/第三课.mp4', 300)]
    await wrapper.vm.$nextTick()
    expect(wrapper.findAll('[data-testid="breadcrumb"]').at(-1)?.text()).toContain('课程')
    expect(wrapper.findAllComponents(VideoRow)).toHaveLength(1)
    wrapper.unmount()
  })

  it('waits for catalog hydration before resolving a saved folder and scroll', async () => {
    vi.useFakeTimers()
    uni.setStorageSync('pianke.library-position.v1', JSON.stringify({ version: 1, activeView: 'folders', folderPath: '/apps/片刻/课程/第一章', searchQuery: '', visibleLimit: 100, scrollTop: 450 }))
    const { wrapper, store } = mountLibrary((store) => { store.initialized = false })
    lifecycle.onReady.mock.calls.at(-1)![0]()
    await flushPromises()
    expect(uni.pageScrollTo).not.toHaveBeenCalled()
    store.baiduVideos = nestedVideos()
    store.initialized = true
    await flushPromises()
    await vi.advanceTimersByTimeAsync(0)
    expect(wrapper.findAll('[data-testid="breadcrumb"]').at(-1)?.text()).toContain('第一章')
    expect(uni.pageScrollTo).toHaveBeenLastCalledWith({ scrollTop: 450, duration: 0 })
    wrapper.unmount()
  })

  it('keeps scroll updates in memory and saves only once on departure', async () => {
    vi.useFakeTimers()
    const { wrapper } = mountLibrary()
    lifecycle.onReady.mock.calls.at(-1)![0]()
    await flushPromises()
    await vi.advanceTimersByTimeAsync(0)
    const write = vi.spyOn(uni, 'setStorageSync')
    for (let i = 0; i < 100; i++) lifecycle.onPageScroll.mock.calls.at(-1)![0]({ scrollTop: i })
    expect(write).not.toHaveBeenCalled()
    for (const [callback] of lifecycle.onHide.mock.calls) callback()
    wrapper.unmount()
    expect(write.mock.calls.filter(([key]) => key === 'pianke.library-position.v1')).toHaveLength(1)
  })

  it('restores after the H5 router resets scroll following page readiness', async () => {
    vi.useFakeTimers()
    uni.setStorageSync('pianke.library-position.v1', JSON.stringify({ version: 1, activeView: 'recent', folderPath: '/apps/片刻', searchQuery: '', visibleLimit: 50, scrollTop: 700 }))
    const { wrapper } = mountLibrary()
    lifecycle.onReady.mock.calls.at(-1)![0]()
    await flushPromises()
    // uni H5 onReady runs from mounted; router scrollBehavior runs after nextTick.
    expect(uni.pageScrollTo).not.toHaveBeenCalled()
    lifecycle.onPageScroll.mock.calls.at(-1)![0]({ scrollTop: 0 })
    await vi.advanceTimersByTimeAsync(0)
    expect(uni.pageScrollTo).toHaveBeenLastCalledWith({ scrollTop: 700, duration: 0 })
    wrapper.unmount()
  })

  it('guides first-time users from adding videos to selecting a course', async () => {
    const { wrapper, store } = mountLibrary()
    expect(wrapper.find('[data-testid="library-learning-guide"]').exists()).toBe(false)
    lifecycle.onLoad.mock.calls[0]![0]({ learningGuide: '1' })
    await wrapper.vm.$nextTick()
    await wrapper.get('[data-testid="library-learning-add"]').trigger('click')
    expect(wrapper.getComponent(DirectLinkSheet).props('open')).toBe(true)
    store.baiduVideos = nestedVideos()
    await wrapper.vm.$nextTick()
    await wrapper.get('[data-testid="library-learning-next"]').trigger('click')
    expect(uni.navigateTo).toHaveBeenLastCalledWith({ url: '/pages/daily-unlock/index?learningGuide=1' })
    wrapper.unmount()
  })

  it('bounds a 2000-video catalog and searches the final entry without loading earlier batches', async () => {
    vi.useFakeTimers()
    const { wrapper, store } = mountLibrary((store) => {
      store.baiduVideos = Array.from({ length: 2000 }, (_, index) =>
        video(String(index), `批量视频 ${index}.mp4`, `/apps/片刻/课程/批量视频 ${index}.mp4`, 3000 - index)
      )
    })
    expect(wrapper.findAllComponents(VideoRow)).toHaveLength(50)
    expect(wrapper.get('[data-testid="folder-row"]').text()).toContain('2000 个视频')
    await wrapper.get('[data-testid="library-load-more"]').trigger('click')
    expect(wrapper.findAllComponents(VideoRow)).toHaveLength(100)
    await wrapper.get('[data-testid="library-search"]').setValue('批量视频 1999.mp4')
    await vi.advanceTimersByTimeAsync(200)
    expect(wrapper.findAllComponents(VideoRow)).toHaveLength(1)
    expect(wrapper.getComponent(VideoRow).props('video').id).toBe('baidu:1999')
    expect(uni.request).not.toHaveBeenCalled()
    await wrapper.get('[data-testid="library-search"]').setValue('')
    await vi.advanceTimersByTimeAsync(200)
    expect(wrapper.findAllComponents(VideoRow)).toHaveLength(50)
    await wrapper.findAll('button.library-segment__button')[1]!.trigger('click')
    await wrapper.get('[data-testid="folder-row"]').trigger('click')
    expect(wrapper.findAllComponents(VideoRow)).toHaveLength(50)
    await wrapper.get('[data-testid="library-load-more"]').trigger('click')
    expect(wrapper.findAllComponents(VideoRow)).toHaveLength(100)
    await wrapper.findAll('button.library-segment__button')[0]!.trigger('click')
    expect(wrapper.findAllComponents(VideoRow)).toHaveLength(50)
    store.baiduVideos = store.baiduVideos.slice(0, 12)
    await wrapper.vm.$nextTick()
    expect(wrapper.get('[data-testid="folder-row"]').text()).toContain('12 个视频')
    expect(wrapper.findAllComponents(VideoRow)).toHaveLength(12)
    wrapper.unmount()
  })

  it('uses the premium branded library shell', () => {
    const { wrapper } = mountLibrary()
    expect(wrapper.get('.library-page').classes()).toContain('library-page--premium')
    expect(wrapper.get('.library-header').classes()).toContain('library-header--premium')
  })


  beforeEach(() => {
    lifecycle.onLoad.mockReset()
    lifecycle.onShow.mockReset()
    lifecycle.onHide.mockReset()
    lifecycle.onUnload.mockReset()
    lifecycle.onReady.mockReset()
    lifecycle.onPageScroll.mockReset()
    uni.pageScrollTo = vi.fn()
    vi.stubGlobal('crypto', {
      randomUUID: vi.fn(() => 'library-direct-id')
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows the recent video grid followed by the folder collection', () => {
    const { wrapper } = mountLibrary((store) => {
      store.baiduVideos = nestedVideos()
    })

    expect(wrapper.find('.library-video-grid').exists()).toBe(true)
    expect(wrapper.get('.library-folder-section').text()).toContain('文件夹')
    expect(wrapper.get('.library-folder-section').findAll('[data-testid="folder-row"]').length).toBeGreaterThan(0)
  })

  it('switches a fixed two-option segment between recent videos and folders', async () => {
    const { wrapper } = mountLibrary((store) => {
      store.baiduVideos = nestedVideos()
    })
    const segments = wrapper.findAll('button.library-segment__button')

    expect(segments).toHaveLength(2)
    expect(segments.map((button) => button.text())).toEqual([
      '最近',
      '文件夹'
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
    vi.useFakeTimers()
    const { store, wrapper } = mountLibrary((store) => {
      store.baiduVideos = [
        video('1', '海边日记.mp4', '/apps/片刻/旅行/海边日记.mp4', 300),
        video('2', '城市漫步.mp4', '/apps/片刻/travel/城市漫步.mp4', 200),
        video('3', '烘焙课.mp4', '/apps/片刻/课程/烘焙课.mp4', 100)
      ]
    })
    const search = wrapper.get('[data-testid="library-search"]')

    await search.setValue('海边')
    expect(store.searchQuery).toBe('')
    await vi.advanceTimersByTimeAsync(200)
    await wrapper.vm.$nextTick()
    expect(wrapper.findAllComponents(VideoRow).map((row) => row.props('video').id)).toEqual([
      'baidu:1'
    ])

    await search.setValue('travel')
    await vi.advanceTimersByTimeAsync(200)
    await wrapper.vm.$nextTick()
    expect(wrapper.findAllComponents(VideoRow).map((row) => row.props('video').id)).toEqual([
      'baidu:2'
    ])
    expect(uni.request).not.toHaveBeenCalled()

    await search.setValue('不存在')
    await vi.advanceTimersByTimeAsync(200)
    await wrapper.vm.$nextTick()
    expect(wrapper.findAllComponents(VideoRow)).toHaveLength(0)
    expect(wrapper.get('[data-testid="library-empty-search"]').text()).toBe(
      '没有找到匹配的视频'
    )
    expect(wrapper.get('[data-testid="library-empty-search"]').classes()).toContain(
      'library-empty-band'
    )
  })

  it('renders recent videos in batches of 50 and loads more explicitly', async () => {
    const { wrapper } = mountLibrary((store) => {
      store.baiduVideos = Array.from({ length: 120 }, (_, index) =>
        video(
          String(index + 1),
          `最近视频 ${index + 1}.mp4`,
          `/apps/片刻/最近视频 ${index + 1}.mp4`,
          1_000 - index
        )
      )
    })

    expect(wrapper.findAllComponents(VideoRow)).toHaveLength(50)
    const loadMore = wrapper.get('[data-testid="library-load-more"]')
    expect(loadMore.text()).toContain('加载更多')

    await loadMore.trigger('click')
    expect(wrapper.findAllComponents(VideoRow)).toHaveLength(100)
    await wrapper.get('[data-testid="library-load-more"]').trigger('click')
    expect(wrapper.findAllComponents(VideoRow)).toHaveLength(120)
    expect(wrapper.find('[data-testid="library-load-more"]').exists()).toBe(false)
  })

  it('limits current-folder videos and resets the batch when navigating folders', async () => {
    const { wrapper } = mountLibrary((store) => {
      store.baiduVideos = Array.from({ length: 120 }, (_, index) =>
        video(
          String(index + 1),
          `课程 ${index + 1}.mp4`,
          `/apps/片刻/课程/课程 ${index + 1}.mp4`,
          1_000 - index
        )
      )
    })
    await wrapper.findAll('button.library-segment__button')[1]!.trigger('click')
    await wrapper.get('[data-testid="folder-row"]').trigger('click')

    expect(wrapper.findAllComponents(VideoRow)).toHaveLength(50)
    await wrapper.get('[data-testid="library-load-more"]').trigger('click')
    expect(wrapper.findAllComponents(VideoRow)).toHaveLength(100)

    await wrapper.findAll('[data-testid="breadcrumb"]')[0]!.trigger('click')
    await wrapper.get('[data-testid="folder-row"]').trigger('click')

    expect(wrapper.findAllComponents(VideoRow)).toHaveLength(50)
  })

  it('renders sibling folders in batches of 50', async () => {
    const { wrapper } = mountLibrary((store) => {
      store.baiduVideos = Array.from({ length: 120 }, (_, index) =>
        video(
          String(index + 1),
          `目录视频 ${index + 1}.mp4`,
          `/apps/片刻/目录 ${index + 1}/目录视频 ${index + 1}.mp4`,
          1_000 - index
        )
      )
    })
    await wrapper.findAll('button.library-segment__button')[1]!.trigger('click')

    expect(wrapper.findAll('[data-testid="folder-row"]')).toHaveLength(50)
    await wrapper.get('[data-testid="library-load-more"]').trigger('click')
    expect(wrapper.findAll('[data-testid="folder-row"]')).toHaveLength(100)
    await wrapper.get('[data-testid="library-load-more"]').trigger('click')
    expect(wrapper.findAll('[data-testid="folder-row"]')).toHaveLength(120)
    expect(wrapper.find('[data-testid="library-load-more"]').exists()).toBe(false)
  })

  it('shares each folder batch between folders first and videos second', async () => {
    const { wrapper } = mountLibrary((store) => {
      const folderVideos = Array.from({ length: 60 }, (_, index) =>
        video(
          String(index + 1),
          `分组视频 ${index + 1}.mp4`,
          `/apps/片刻/分组 ${index + 1}/分组视频 ${index + 1}.mp4`,
          2_000 - index
        )
      )
      const rootVideos = Array.from({ length: 60 }, (_, index) =>
        video(
          String(index + 1_001),
          `根视频 ${index + 1}.mp4`,
          `/apps/片刻/根视频 ${index + 1}.mp4`,
          1_000 - index
        )
      )
      store.baiduVideos = [...folderVideos, ...rootVideos]
    })
    await wrapper.findAll('button.library-segment__button')[1]!.trigger('click')

    expect(wrapper.findAll('[data-testid="folder-row"]')).toHaveLength(50)
    expect(wrapper.findAllComponents(VideoRow)).toHaveLength(0)

    await wrapper.get('[data-testid="library-load-more"]').trigger('click')
    expect(wrapper.findAll('[data-testid="folder-row"]')).toHaveLength(60)
    expect(wrapper.findAllComponents(VideoRow)).toHaveLength(40)

    await wrapper.get('[data-testid="library-load-more"]').trigger('click')
    expect(wrapper.findAll('[data-testid="folder-row"]')).toHaveLength(60)
    expect(wrapper.findAllComponents(VideoRow)).toHaveLength(60)
    expect(wrapper.find('[data-testid="library-load-more"]').exists()).toBe(false)
  })

  it('debounces search, resets its batch immediately, and loads matching results in batches', async () => {
    vi.useFakeTimers()
    const { store, wrapper } = mountLibrary((appStore) => {
      appStore.baiduVideos = Array.from({ length: 120 }, (_, index) =>
        video(
          String(index + 1),
          `${index < 80 ? '目标' : '其他'} ${index + 1}.mp4`,
          `/apps/片刻/批量/${index + 1}.mp4`,
          1_000 - index
        )
      )
    })
    const search = wrapper.get('[data-testid="library-search"]')

    await search.setValue('目标')
    expect(store.searchQuery).toBe('')
    await vi.advanceTimersByTimeAsync(199)
    expect(store.searchQuery).toBe('')
    await vi.advanceTimersByTimeAsync(1)
    await wrapper.vm.$nextTick()

    expect(store.searchQuery).toBe('目标')
    expect(wrapper.findAllComponents(VideoRow)).toHaveLength(50)
    await wrapper.get('[data-testid="library-load-more"]').trigger('click')
    expect(wrapper.findAllComponents(VideoRow)).toHaveLength(80)

    await search.setValue('其他')
    expect(wrapper.findAllComponents(VideoRow)).toHaveLength(50)
    await vi.advanceTimersByTimeAsync(200)
    await wrapper.vm.$nextTick()
    expect(store.searchQuery).toBe('其他')
    expect(wrapper.findAllComponents(VideoRow)).toHaveLength(40)
  })

  it('cancels a pending debounced search when unmounted', async () => {
    vi.useFakeTimers()
    const { store, wrapper } = mountLibrary()

    await wrapper.get('[data-testid="library-search"]').setValue('不会提交')
    wrapper.unmount()
    await vi.advanceTimersByTimeAsync(250)

    expect(store.searchQuery).toBe('')
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

  it('keeps every catalog video visible and blocks a locked episode before navigation', async () => {
    const first = video('1', '第1集.mp4', '/apps/片刻/课程/第1集.mp4', 200)
    const second = video('2', '第2集.mp4', '/apps/片刻/课程/第2集.mp4', 100)
    const createdAt = new Date(2026, 9, 27, 10).getTime()
    const { store, wrapper } = mountLibrary((appStore) => {
      appStore.baiduVideos = [first, second]
      appStore.dailyUnlockNow = createdAt
      appStore.dailyUnlockSettings = {
        enabled: true,
        courses: [{
          id: 'course-1', name: '课程', createdAt,
          episodes: [
            { videoId: first.id, name: first.name, sourceType: 'baidu', path: first.path },
            { videoId: second.id, name: second.name, sourceType: 'baidu', path: second.path }
          ]
        }]
      }
    })

    expect(wrapper.findAllComponents(VideoRow)).toHaveLength(2)
    const lockedRow = wrapper.findAllComponents(VideoRow).find((row) => row.props('video').id === second.id)!
    expect(lockedRow.text()).toContain('第2集待解锁')
    await lockedRow.get('button.video-row').trigger('click')

    expect(uni.navigateTo).not.toHaveBeenCalled()
    expect(uni.showToast).toHaveBeenCalledWith({
      title: '第2集将于 2026-10-28 00:00 解锁', icon: 'none'
    })
    expect(store.videoUnlockStatus(second.id).locked).toBe(true)
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
  store.initialized = true
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
