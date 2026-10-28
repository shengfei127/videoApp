import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { VideoItem } from '@/domain/video'
import { BaiduError } from '@/features/baidu/baiduErrors'
import { PLAYER_PREFERENCES_KEY } from '@/features/playback/playerPreferences'
import PlayerPage from '@/pages/player/index.vue'
import { useAppStore } from '@/stores/appStore'

const lifecycle = vi.hoisted(() => ({
  onBackPress: vi.fn(),
  onLoad: vi.fn(),
  onShow: vi.fn(),
  onHide: vi.fn(),
  onUnload: vi.fn()
}))
const pageMocks = vi.hoisted(() => ({
  config: {
    baiduAppKey: 'public-player-key',
    baiduAppFolder: 'player-root',
    baiduRoot: '/apps/player-root',
    baiduRedirectUri: 'https://localhost/pianke/oauth/baidu',
    useMocks: false
  },
  platform: 'app',
  baiduRoots: [] as string[],
  resolvePlaybackUrl: vi.fn(),
  pendingDlinks: [] as Array<{
    promise: Promise<string>
    resolve: (value: string) => void
  }>,
  videoContext: {
    seek: vi.fn(),
    play: vi.fn(),
    pause: vi.fn(),
    playbackRate: vi.fn(),
    requestFullScreen: vi.fn()
  }
}))

vi.mock('@dcloudio/uni-app', () => ({
  onBackPress: lifecycle.onBackPress,
  onLoad: lifecycle.onLoad,
  onShow: lifecycle.onShow,
  onHide: lifecycle.onHide,
  onUnload: lifecycle.onUnload
}))
vi.mock('@/config/runtime', () => ({
  runtimeConfig: pageMocks.config,
  readRuntimeBuildEnvironment: () => ({ uniPlatform: pageMocks.platform })
}))
vi.mock('@/features/baidu/baiduDriveSource', () => ({
  BaiduDriveSource: class {
    constructor(root: string) {
      pageMocks.baiduRoots.push(root)
    }

    resolvePlaybackUrl = pageMocks.resolvePlaybackUrl
  }
}))

describe('Player page', () => {
  it.each([['back', 'h5'], ['home', 'h5'], ['back', 'app'], ['home', 'app']])('preserves failed exit intent and retries saving before leaving for %s on %s', async (intent, platform) => {
    pageMocks.platform = platform
    const { wrapper, store } = mountNextLessonPlayer()
    await loadPlayer('direct:first')
    await flushPromises()
    const media = wrapper.get('[data-testid="player-video"]')
    await media.trigger('loadedmetadata', { detail: { duration: 600 } })
    await media.trigger('play')
    const write = vi.spyOn(uni, 'setStorageSync').mockImplementation(() => { throw new Error('quota') })
    await media.trigger('ended', { detail: { duration: 600 } })
    await wrapper.get(`[data-testid="${intent === 'back' ? 'player-back' : 'player-return-learning'}"]`).trigger('click')
    expect(uni.navigateBack).not.toHaveBeenCalled()
    expect(uni.redirectTo).not.toHaveBeenCalled()
    expect(wrapper.get('[data-testid="player-exit-dialog"]').text()).toContain('仍然离开')
    await wrapper.get('[data-testid="player-exit-retry"]').trigger('click')
    expect(uni.redirectTo).not.toHaveBeenCalled()
    expect(uni.navigateBack).not.toHaveBeenCalled()
    await media.trigger('pause', { detail: { currentTime: 0, duration: 600 } })
    write.mockRestore()
    await wrapper.get('[data-testid="player-exit-retry"]').trigger('click')
    expect(store.progressHistory[0]).toMatchObject({ positionSeconds: 600, completed: true })
    if (intent === 'home') expect(uni.redirectTo).toHaveBeenCalledWith(expect.objectContaining({ url: '/pages/home/index' }))
    else expect(uni.navigateBack).toHaveBeenCalledOnce()
  })

  it('retries an unsaved restart at zero before playback has begun', async () => {
    pageMocks.platform = 'h5'
    const { wrapper, store } = mountNextLessonPlayer()
    store.progressHistory = [{ videoId: 'direct:first', positionSeconds: 120, durationSeconds: 600, updatedAt: 1, completed: false }]
    await loadPlayer('direct:first')
    await flushPromises()
    await wrapper.get('[data-testid="player-video"]').trigger('loadedmetadata', { detail: { duration: 600 } })
    const write = vi.spyOn(uni, 'setStorageSync').mockImplementation(() => { throw new Error('quota') })
    await wrapper.get('[data-testid="resume-restart"]').trigger('click')
    await wrapper.get('[data-testid="player-back"]').trigger('click')
    expect(uni.navigateBack).not.toHaveBeenCalled()
    write.mockRestore()
    await wrapper.get('[data-testid="player-exit-retry"]').trigger('click')
    expect(uni.navigateBack).toHaveBeenCalledOnce()
    expect(store.progressHistory[0]?.positionSeconds).toBe(0)
  })

  it('allows leaving despite persistent save failures without reopening the prompt on API back', async () => {
    pageMocks.platform = 'h5'
    const { wrapper } = mountNextLessonPlayer()
    await loadPlayer('direct:first')
    await flushPromises()
    const media = wrapper.get('[data-testid="player-video"]')
    await media.trigger('loadedmetadata', { detail: { duration: 600 } })
    await media.trigger('play')
    const write = vi.spyOn(uni, 'setStorageSync').mockImplementation(() => { throw new Error('quota') })
    await media.trigger('timeupdate', { detail: { currentTime: 42, duration: 600 } })
    const back = lifecycle.onBackPress.mock.calls.at(-1)![0]
    expect(back({ from: 'backbutton' })).toBe(true)
    await wrapper.vm.$nextTick()
    await wrapper.get('[data-testid="player-exit-anyway"]').trigger('click')
    expect(uni.navigateBack).toHaveBeenCalledOnce()
    expect(back({ from: 'navigateBack' })).toBe(false)
    write.mockRestore()
  })

  it.each([0, 1])('returns a directly opened player home when page count is %s', async (count) => {
    vi.stubGlobal('getCurrentPages', () => Array.from({ length: count }, () => ({})))
    const { wrapper } = mountPlayer()
    await loadPlayer('missing')
    await wrapper.get('[data-testid="player-back"]').trigger('click')
    expect(uni.navigateBack).not.toHaveBeenCalled()
    expect(uni.redirectTo).toHaveBeenCalledWith(expect.objectContaining({ url: '/pages/home/index' }))
  })

  it('falls back home after back navigation fails and allows retry after home navigation fails', async () => {
    const { wrapper } = mountPlayer()
    await loadPlayer('missing')
    await wrapper.get('[data-testid="player-back"]').trigger('click')
    vi.mocked(uni.navigateBack).mock.calls[0]![0]!.fail?.({ errMsg: 'failed' })
    expect(uni.redirectTo).toHaveBeenCalledOnce()
    vi.mocked(uni.redirectTo).mock.calls[0]![0].fail?.({ errMsg: 'failed' })
    expect(uni.showToast).toHaveBeenCalledWith(expect.objectContaining({ title: '无法返回，请重试' }))
    await wrapper.get('[data-testid="player-back"]').trigger('click')
    expect(uni.navigateBack).toHaveBeenCalledTimes(2)
  })

  it.each([false, true])('excludes manually learned lessons even with no playback history (cleared: %s)', async (clearHistory) => {
    const { store, wrapper } = mountNextLessonPlayer()
    expect(store.markVideoLearned('direct:second', true)).toBe(true)
    if (clearHistory) expect(store.clearProgress()).toBe(true)
    expect(store.progressHistory.some(item => item.videoId === 'direct:second')).toBe(false)
    expect(store.learningHistory.find(item => item.videoId === 'direct:second')?.completed).toBe(true)
    await loadPlayer('direct:first')
    await flushPromises()
    const media = wrapper.get('[data-testid="player-video"]')
    await media.trigger('loadedmetadata', { detail: { duration: 600 } })
    await media.trigger('play')
    await media.trigger('ended', { detail: { duration: 600 } })
    expect(wrapper.find('[data-testid="player-next-episode"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="player-return-learning"]').exists()).toBe(true)
  })
  it.each(['h5', 'app'])('replaces the player route for the next lesson without autoplay on %s', async (platform) => {
    pageMocks.platform = platform
    const { store, wrapper, pinia } = mountNextLessonPlayer()
    await loadPlayer('direct:first')
    await flushPromises()
    expect(wrapper.find('[data-testid="player-next-episode"]').exists()).toBe(false)
    const media = wrapper.get('[data-testid="player-video"]')
    await media.trigger('loadedmetadata', { detail: { duration: 600 } })
    await media.trigger('play')
    await media.trigger('ended', { detail: { duration: 600 } })
    const button = wrapper.get('[data-testid="player-next-episode"]')
    await button.trigger('click')
    await button.trigger('click')
    expect(uni.redirectTo).toHaveBeenCalledOnce()
    expect(uni.redirectTo).toHaveBeenCalledWith(expect.objectContaining({ url: '/pages/player/index?id=direct%3Asecond' }))
    expect(uni.navigateTo).not.toHaveBeenCalled()
    await media.trigger('pause', { detail: { currentTime: 0, duration: 600 } })
    lifecycle.onUnload.mock.calls.at(-1)![0]()
    await media.trigger('timeupdate', { detail: { currentTime: 1, duration: 600 } })
    expect(store.progressHistory.find(progress => progress.videoId === 'direct:first')).toMatchObject({ completed: true, positionSeconds: 600 })
    wrapper.unmount()
    // The router creates a fresh page from the URL, as it also does on refresh.
    const nextWrapper = mount(PlayerPage, { global: { plugins: [pinia] } })
    const url = vi.mocked(uni.redirectTo).mock.calls[0]![0].url
    const queryId = new URLSearchParams(url.split('?')[1]).get('id')!
    await loadPlayer(queryId)
    await flushPromises()
    expect(nextWrapper.get('.player-header__title').text()).toBe('第二节')
    await nextWrapper.get('[data-testid="player-video"]').trigger('loadedmetadata', { detail: { duration: 900 } })
    expect(pageMocks.videoContext.play).not.toHaveBeenCalled()
    expect(store.progressHistory.some(progress => progress.videoId === 'direct:second')).toBe(false)
    nextWrapper.unmount()
  })

  it('keeps the ended lesson and allows retry after route replacement fails', async () => {
    const { wrapper } = mountNextLessonPlayer()
    await loadPlayer('direct:first')
    await flushPromises()
    const media = wrapper.get('[data-testid="player-video"]')
    await media.trigger('loadedmetadata', { detail: { duration: 600 } })
    await media.trigger('play')
    await media.trigger('ended', { detail: { duration: 600 } })
    await wrapper.get('[data-testid="player-next-episode"]').trigger('click')
    const options = vi.mocked(uni.redirectTo).mock.calls[0]![0]
    options.fail?.({ errMsg: 'redirectTo:fail' })
    expect(uni.showToast).toHaveBeenCalledWith({ title: '无法打开下一节，请重试', icon: 'none' })
    expect(wrapper.get('.player-header__title').text()).toBe('第一节')
    await wrapper.get('[data-testid="player-next-episode"]').trigger('click')
    expect(uni.redirectTo).toHaveBeenCalledTimes(2)
  })

  it('keeps ended progress and retries before switching when saving fails', async () => {
    const { store, wrapper } = mountNextLessonPlayer()
    await loadPlayer('direct:first')
    await flushPromises()
    const media = wrapper.get('[data-testid="player-video"]')
    await media.trigger('loadedmetadata', { detail: { duration: 600 } })
    await media.trigger('play')
    const write = vi.spyOn(uni, 'setStorageSync').mockImplementation(() => { throw new Error('quota') })
    await media.trigger('ended', { detail: { duration: 600 } })
    await wrapper.get('[data-testid="player-next-episode"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('.player-header__title').text()).toBe('第一节')
    expect(wrapper.find('[data-testid="player-save-retry"]').exists()).toBe(true)
    expect(uni.redirectTo).not.toHaveBeenCalled()
    write.mockRestore()
    await wrapper.get('[data-testid="player-next-episode"]').trigger('click')
    await flushPromises()
    expect(uni.redirectTo).toHaveBeenCalledWith(expect.objectContaining({ url: '/pages/player/index?id=direct%3Asecond' }))
    expect(store.progressHistory.find(progress => progress.videoId === 'direct:first')?.completed).toBe(true)
  })

  it('rechecks a removed candidate before a stale next button can switch lessons', async () => {
    const { store, wrapper } = mountNextLessonPlayer()
    await loadPlayer('direct:first')
    await flushPromises()
    const media = wrapper.get('[data-testid="player-video"]')
    await media.trigger('loadedmetadata', { detail: { duration: 600 } })
    await media.trigger('play')
    await media.trigger('ended', { detail: { duration: 600 } })
    const button = wrapper.get('[data-testid="player-next-episode"]')
    store.directRecords = store.directRecords.filter(record => record.id !== 'second')
    await button.trigger('click')
    await flushPromises()
    expect(wrapper.get('.player-header__title').text()).toBe('第一节')
    expect(wrapper.find('[data-testid="player-next-episode"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="player-return-learning"]').exists()).toBe(true)
  })

  it.each(['completed', 'locked'])('does not switch after the suggested lesson becomes %s', async (change) => {
    const { store, wrapper } = mountNextLessonPlayer()
    await loadPlayer('direct:first')
    await flushPromises()
    const media = wrapper.get('[data-testid="player-video"]')
    await media.trigger('loadedmetadata', { detail: { duration: 600 } })
    await media.trigger('play')
    await media.trigger('ended', { detail: { duration: 600 } })
    const button = wrapper.get('[data-testid="player-next-episode"]')
    if (change === 'completed') {
      store.progressHistory.push({ videoId: 'direct:second', positionSeconds: 600, durationSeconds: 600, updatedAt: Date.now(), completed: true })
    } else {
      store.dailyUnlockSettings.courses[0]!.dailyEpisodeCount = 1
    }
    await button.trigger('click')
    await flushPromises()
    expect(wrapper.get('.player-header__title').text()).toBe('第一节')
    expect(wrapper.find('[data-testid="player-next-episode"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="player-return-learning"]').exists()).toBe(true)
  })
  it('shows progress-save failure without stopping playback and retries after storage recovers', async () => {
    pageMocks.platform = 'h5'
    const video = directVideo('https://media.example.test/movie.mp4')
    const { wrapper } = mountPlayer((store) => {
      store.directRecords = [{ id: video.sourceId, name: video.name, url: video.path, mediaKind: 'mp4', addedAt: 1 }]
    })
    await loadPlayer(video.id)
    await flushPromises()
    const media = wrapper.get('[data-testid="player-video"]')
    await media.trigger('loadedmetadata', { detail: { duration: 600 } })
    await media.trigger('play')
    const write = vi.spyOn(uni, 'setStorageSync').mockImplementationOnce(() => { throw new Error('quota exceeded') })
    await media.trigger('timeupdate', { detail: { currentTime: 120, duration: 600 } })
    expect(wrapper.get('[role="alert"]').text()).toContain('播放进度尚未保存')
    expect(wrapper.find('[data-testid="player-video"]').exists()).toBe(true)
    await wrapper.get('[data-testid="player-save-retry"]').trigger('click')
    expect(wrapper.find('[data-testid="player-save-retry"]').exists()).toBe(false)
    expect(write).toHaveBeenCalledTimes(2)
    expect(JSON.parse(uni.getStorageSync('pianke:progress:v1'))[0].positionSeconds).toBe(120)
  })

  it.each([['HTTP 404', '找不到视频文件'], ['network failure', '网络连接失败'], ['decode error', '暂时无法确定原因']])('offers a course source action for %s without exposing raw details', async (error, expected) => {
    const video = directVideo('https://media.example.test/movie.mp4?token=private')
    const { wrapper } = mountPlayer((store) => {
      store.directRecords = [{ id: video.sourceId, name: video.name, url: video.path, mediaKind: 'mp4', addedAt: 1 }]
      store.dailyUnlockSettings = { enabled: true, courses: [{ id: 'course', name: '课程', createdAt: Date.now(), episodes: [{ videoId: video.id, name: video.name, sourceType: 'direct' }] }] }
    })
    await loadPlayer(video.id)
    await flushPromises()
    await wrapper.get('[data-testid="player-video"]').trigger('error', { detail: { errMsg: `${error} https://media.example.test/secret` } })
    expect(wrapper.get('[role="alert"]').text()).toContain(expected)
    expect(wrapper.html()).not.toContain('media.example.test')
    await wrapper.get('[data-testid="player-source-action"]').trigger('click')
    expect(uni.navigateTo).toHaveBeenCalledWith({ url: '/pages/daily-unlock/index' })
  })

  it.each(['h5', 'app'])('seeks by ten seconds within metadata bounds and returns home when ended on %s', async (platform) => {
    pageMocks.platform = platform
    const video = directVideo('https://media.example.test/movie.mp4')
    const { wrapper } = mountPlayer((store) => {
      store.directRecords = [{ id: video.sourceId, name: video.name, url: video.path, mediaKind: 'mp4', addedAt: 1 }]
    })
    await loadPlayer(video.id)
    await flushPromises()
    await wrapper.get('[aria-label="前进 10 秒"]').trigger('click')
    expect(pageMocks.videoContext.seek).not.toHaveBeenCalled()
    const media = wrapper.get('[data-testid="player-video"]')
    await media.trigger('loadedmetadata', { detail: { duration: 25 } })
    await media.trigger('play')
    await wrapper.get('[aria-label="后退 10 秒"]').trigger('click')
    expect(pageMocks.videoContext.seek).toHaveBeenLastCalledWith(0)
    await wrapper.get('[aria-label="前进 10 秒"]').trigger('click')
    expect(pageMocks.videoContext.seek).toHaveBeenLastCalledWith(10)
    await media.trigger('timeupdate', { detail: { currentTime: 23, duration: 25 } })
    await wrapper.get('[aria-label="前进 10 秒"]').trigger('click')
    expect(pageMocks.videoContext.seek).toHaveBeenLastCalledWith(25)
    await media.trigger('ended', { detail: { duration: 25 } })
    expect(wrapper.text()).toContain('本节播放完毕')
    await wrapper.get('[data-testid="player-return-learning"]').trigger('click')
    expect(uni.redirectTo).toHaveBeenCalledWith(expect.objectContaining({ url: '/pages/home/index' }))
  })

  it('applies remembered speed to a newly loaded video and saves later changes', async () => {
    pageMocks.platform = 'h5'
    uni.setStorageSync(PLAYER_PREFERENCES_KEY, JSON.stringify({ rate: 1.5 }))
    const video = directVideo('https://media.example.test/movie.mp4')
    const { wrapper } = mountPlayer((store) => {
      store.directRecords = [{ id: video.sourceId, name: video.name, url: video.path, mediaKind: 'mp4', addedAt: 1 }]
    })
    await loadPlayer(video.id)
    await flushPromises()
    expect(wrapper.get('[data-testid="player-rate-menu"]').text()).toBe('1.5x')
    await wrapper.get('[data-testid="player-video"]').trigger('loadedmetadata', { detail: { duration: 600 } })
    expect(pageMocks.videoContext.playbackRate).toHaveBeenLastCalledWith(1.5)
    await wrapper.get('[data-testid="player-rate-menu"]').trigger('click')
    await wrapper.findAll('[data-testid="player-rate"]')[4]!.trigger('click')
    expect(JSON.parse(uni.getStorageSync(PLAYER_PREFERENCES_KEY))).toEqual({ rate: 2 })
  })

  it('uses the immersive player shell', () => {
    const { wrapper } = mountPlayer()
    expect(wrapper.get('.player-page').classes()).toContain('player-page--immersive')
  })


  afterEach(() => {
    vi.useRealTimers()
  })

  beforeEach(() => {
    lifecycle.onBackPress.mockReset()
    vi.stubGlobal('getCurrentPages', () => [{}, {}])
    lifecycle.onLoad.mockReset()
    lifecycle.onShow.mockReset()
    lifecycle.onHide.mockReset()
    lifecycle.onUnload.mockReset()
    pageMocks.platform = 'app'
    pageMocks.resolvePlaybackUrl.mockReset()
    Object.values(pageMocks.videoContext).forEach((fn) => fn.mockReset())
    Object.assign(uni, {
      createVideoContext: vi.fn(
        () => pageMocks.videoContext as unknown as UniNamespace.VideoContext
      )
    })
  })

  it('starts playback before metadata and clamps custom seek commands after metadata', async () => {
    pageMocks.platform = 'h5'
    const video = directVideo('https://media.example.test/movie.mp4')
    const { wrapper } = mountPlayer((store) => {
      store.directRecords = [{ id: video.sourceId, name: video.name, url: video.path, mediaKind: 'mp4', addedAt: 1 }]
    })
    await loadPlayer(video.id)
    await flushPromises()
    await wrapper.get('[data-testid="player-toggle-playback"]').trigger('click')
    expect(pageMocks.videoContext.play).toHaveBeenCalledOnce()
    const media = wrapper.get('[data-testid="player-video"]')
    await media.trigger('loadedmetadata', {detail:{duration: 600}})
    await media.trigger('play')
    await wrapper.get('[data-testid="player-toggle-playback"]').trigger('click')
    expect(pageMocks.videoContext.pause).toHaveBeenCalled()
    await wrapper.get('[data-testid="player-seek-rail"]').trigger('change', {detail:{value:800}})
    expect(pageMocks.videoContext.seek).toHaveBeenLastCalledWith(600)
    await wrapper.get('[aria-label="后退 10 秒"]').trigger('click')
    expect(pageMocks.videoContext.seek).toHaveBeenLastCalledWith(590)
    await wrapper.get('[aria-label="全屏播放"]').trigger('click')
    expect(pageMocks.videoContext.requestFullScreen).toHaveBeenCalledWith({direction:90})
  })

  it('uses native cover controls and cycles playback speed on Android', async () => {
    const video = directVideo('https://media.example.test/movie.mp4')
    const { wrapper } = mountPlayer((store) => {
      store.directRecords = [{ id: video.sourceId, name: video.name, url: video.path, mediaKind: 'mp4', addedAt: 1 }]
    })
    await loadPlayer(video.id)
    await flushPromises()
    expect(wrapper.find('cover-image[data-testid="player-toggle-playback"]').exists()).toBe(true)
    await wrapper.get('[data-testid="player-rate-menu"]').trigger('click')
    expect(pageMocks.videoContext.playbackRate).toHaveBeenLastCalledWith(1.25)
  })

  it('uses the configured Baidu app root for the player drive source', () => {
    mountPlayer()

    expect(new Set(pageMocks.baiduRoots)).toEqual(
      new Set([pageMocks.config.baiduRoot])
    )
  })

  it('places a custom seek rail and transport controls over the immersive video stage', async () => {
    const video = directVideo('https://media.example.test/movie.mp4')
    const { wrapper } = mountPlayer((store) => {
      store.directRecords = [{ id: video.sourceId, name: video.name, url: video.path, mediaKind: 'mp4', addedAt: 1 }]
    })

    await loadPlayer(video.id)
    await flushPromises()

    expect(wrapper.get('.player-stage').find('[data-testid="player-seek-rail"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="player-toggle-playback"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="player-rate-menu"]').text()).toContain('1.0x')
  })

  it('loads a direct source behind custom immersive controls and saves lifecycle progress', async () => {
    const privateUrl =
      'https://media.example.test/movie.mp4?access_token=do-not-render&signature=private'
    const video = directVideo(privateUrl)
    const { store, wrapper } = mountPlayer((appStore) => {
      appStore.directRecords = [
        {
          id: video.sourceId,
          name: video.name,
          url: privateUrl,
          mediaKind: 'mp4',
          addedAt: 1
        }
      ]
    })

    await loadPlayer(video.id)
    await flushPromises()

    const player = wrapper.get('[data-testid="player-video"]')
    expect(player.attributes('controls')).not.toBe('true')
    expect(player.attributes('enable-play-gesture')).toBeDefined()
    expect(wrapper.find('[data-testid="player-toggle-playback"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('媒体直链')
    expect(wrapper.text()).not.toContain(privateUrl)
    expect(wrapper.text()).not.toContain('access_token')
    expect(wrapper.text()).not.toContain('signature=private')

    await player.trigger('loadedmetadata', { detail: { duration: 600 } })
    await player.trigger('play')
    await player.trigger('timeupdate', { detail: { currentTime: 42, duration: 600 } })
    expect(store.progressHistory).toEqual([
      expect.objectContaining({ videoId: video.id, positionSeconds: 42 })
    ])
    await player.trigger('pause', { detail: { currentTime: 44, duration: 600 } })
    expect(store.progressHistory[0]).toMatchObject({ positionSeconds: 44 })

    const hideHandler = lifecycle.onHide.mock.calls[0]![0]
    hideHandler()
    expect(store.progressHistory[0]).toMatchObject({ positionSeconds: 44 })
  })

  it('passes the documented Baidu player User-Agent header only and safely retries one 403 with a fresh dlink', async () => {
    const video = baiduVideo()
    pageMocks.resolvePlaybackUrl
      .mockResolvedValueOnce('https://d.pcs.baidu.com/file/first?access_token=private-one')
      .mockResolvedValueOnce('https://d.pcs.baidu.com/file/second?access_token=private-two')
    const { store, wrapper } = mountPlayer((appStore) => {
      appStore.baiduVideos = [video]
      appStore.authSession = validSession()
    })

    await loadPlayer(video.id)
    await flushPromises()

    const player = wrapper.get('[data-testid="player-video"]')
    expect(player.attributes('header')).toBe('[object Object]')
    expect(wrapper.text()).toContain('原始画质')
    expect(player.attributes('src')).toContain('private-one')
    expect(wrapper.text()).not.toContain('private-one')
    expect(wrapper.text()).not.toContain('private-two')
    expect(wrapper.text()).not.toContain('access_token')

    await player.trigger('error', { detail: { errMsg: 'HTTP 403' } })
    await flushPromises()
    expect(pageMocks.resolvePlaybackUrl).toHaveBeenCalledTimes(2)
    expect(wrapper.get('[data-testid="player-video"]').attributes('src')).toContain(
      '/second'
    )
    expect(wrapper.get('[data-testid="player-video"]').attributes('src')).toContain(
      'private-two'
    )

    await player.trigger('error', { detail: { errMsg: 'HTTP 403' } })
    await flushPromises()
    expect(pageMocks.resolvePlaybackUrl).toHaveBeenCalledTimes(2)
    expect(wrapper.get('[role="alert"]').text()).toContain('无法刷新播放地址')
  })

  it('saves native playback when Android supplies duration through timeupdate only', async () => {
    const video = baiduVideo()
    pageMocks.resolvePlaybackUrl.mockResolvedValue('https://d.pcs.baidu.com/file/native')
    const { store, wrapper } = mountPlayer((appStore) => {
      appStore.baiduVideos = [video]
      appStore.authSession = validSession()
    })
    await loadPlayer(video.id)
    await flushPromises()
    const player = wrapper.get('[data-testid="player-video"]')
    await player.trigger('play')
    await player.trigger('timeupdate', { detail: { currentTime: 42, duration: 600 } })
    expect(store.progressHistory[0]).toMatchObject({ videoId: video.id, positionSeconds: 42 })
  })

  it('offers native resume before a first timeupdate or pause can overwrite saved progress', async () => {
    const video = baiduVideo()
    pageMocks.resolvePlaybackUrl.mockResolvedValue('https://d.pcs.baidu.com/file/native')
    const { store, wrapper } = mountPlayer((appStore) => {
      appStore.baiduVideos = [video]
      appStore.authSession = validSession()
      appStore.progressHistory = [{ videoId: video.id, positionSeconds: 120,
        durationSeconds: 600, updatedAt: 1, completed: false }]
    })
    await loadPlayer(video.id)
    await flushPromises()
    const player = wrapper.get('[data-testid="player-video"]')
    await player.trigger('play')
    await player.trigger('timeupdate', { detail: { currentTime: 1, duration: 600 } })
    expect(wrapper.find('[data-testid="resume-continue"]').exists()).toBe(true)
    expect(pageMocks.videoContext.pause).toHaveBeenCalled()
    expect(player.attributes('style')).toContain('display: none')
    await player.trigger('pause', { detail: { currentTime: 1, duration: 600 } })
    expect(store.progressHistory[0]?.positionSeconds).toBe(120)
    await wrapper.get('[data-testid="resume-continue"]').trigger('click')
    expect(pageMocks.videoContext.seek).toHaveBeenCalledWith(120)
    expect(pageMocks.videoContext.play).toHaveBeenCalled()
  })

  it('omits the browser-forbidden Baidu User-Agent header on H5', async () => {
    pageMocks.platform = 'h5'
    const video = baiduVideo()
    pageMocks.resolvePlaybackUrl.mockResolvedValue(
      'https://d.pcs.baidu.com/file/h5?access_token=private-h5'
    )
    const { wrapper } = mountPlayer((appStore) => {
      appStore.baiduVideos = [video]
      appStore.authSession = validSession()
    })

    await loadPlayer(video.id)
    await flushPromises()

    expect(
      wrapper.get('[data-testid="player-video"]').attributes('header')
    ).toBeUndefined()
  })

  it('expires a locally stale Baidu session without clearing cached or local media data', async () => {
    const video = baiduVideo()
    const expiredSession = {
      ...validSession(),
      expiresAt: Date.now() - 1
    }
    const { store, wrapper } = mountPlayer((appStore) => {
      appStore.baiduVideos = [video]
      appStore.authSession = expiredSession
      appStore.directRecords = [
        {
          id: 'direct-preserved',
          name: 'Preserved.m3u8',
          url: 'https://media.example.test/preserved.m3u8',
          mediaKind: 'hls',
          addedAt: 1
        }
      ]
      appStore.progressHistory = [
        {
          videoId: video.id,
          positionSeconds: 120,
          durationSeconds: 600,
          updatedAt: 1,
          completed: false
        }
      ]
    })

    await loadPlayer(video.id)
    await flushPromises()

    expect(store.authSession).toBeNull()
    expect(store.baiduVideos).toHaveLength(1)
    expect(store.directRecords).toHaveLength(1)
    expect(store.progressHistory).toHaveLength(1)
    expect(wrapper.get('[role="alert"]').text()).toContain('重新连接百度网盘')
    expect(wrapper.find('[data-testid="player-reconnect"]').exists()).toBe(true)
  })

  it('expires a revoked Baidu session during initial resolution and the one 403 refresh', async () => {
    const initial = baiduVideo()
    pageMocks.resolvePlaybackUrl.mockRejectedValueOnce(
      new BaiduError('authorization', 110)
    )
    const first = mountPlayer((appStore) => {
      appStore.baiduVideos = [initial]
      appStore.authSession = validSession()
    })

    await loadPlayer(initial.id)
    await flushPromises()

    expect(first.store.authSession).toBeNull()
    expect(first.wrapper.get('[role="alert"]').text()).toContain(
      '重新连接百度网盘'
    )

    const refreshed = baiduVideo()
    pageMocks.resolvePlaybackUrl
      .mockResolvedValueOnce('https://d.pcs.baidu.com/file/current?access_token=private')
      .mockRejectedValueOnce(new BaiduError('authorization', -6))
    const second = mountPlayer((appStore) => {
      appStore.baiduVideos = [refreshed]
      appStore.authSession = validSession()
    })

    await loadPlayer(refreshed.id)
    await flushPromises()
    await second.wrapper.get('[data-testid="player-video"]').trigger('error', {
      detail: { errMsg: 'HTTP 403' }
    })
    await flushPromises()

    expect(second.store.authSession).toBeNull()
    expect(second.wrapper.get('[role="alert"]').text()).toContain(
      '重新连接百度网盘'
    )
  })

  it('blocks a locked deep link before creating or resolving a player load, then rechecks on unlock', async () => {
    vi.useFakeTimers()
    const video = baiduVideo()
    pageMocks.resolvePlaybackUrl.mockResolvedValue('https://d.pcs.baidu.com/allowed.m3u8')
    const createdAt = Date.now()
    const nextMidnight = new Date(createdAt)
    nextMidnight.setDate(nextMidnight.getDate() + 1)
    nextMidnight.setHours(0, 0, 0, 0)
    const { store, wrapper } = mountPlayer((appStore) => {
      appStore.baiduVideos = [video]
      appStore.authSession = { ...validSession(), expiresAt: createdAt + 2 * 24 * 60 * 60 * 1000 }
      appStore.dailyUnlockNow = createdAt
      appStore.dailyUnlockSettings = {
        enabled: true,
        courses: [{
          id: 'locked-course',
          name: '听力课',
          createdAt,
          episodes: [
            { videoId: 'direct:previous', name: '第1集.m3u8', sourceType: 'direct' },
            { videoId: video.id, name: video.name, sourceType: 'baidu', path: video.path }
          ]
        }]
      }
    })

    await loadPlayer(video.id, '1')
    await flushPromises()

    expect(pageMocks.resolvePlaybackUrl).not.toHaveBeenCalled()
    expect(wrapper.get('[data-testid="player-locked"]').text()).toContain('听力课')
    expect(wrapper.get('[data-testid="player-locked"]').text()).toContain('第2集')
    expect(wrapper.get('[data-testid="player-locked"]').text()).toContain('00:00 解锁')
    expect(wrapper.text()).not.toContain('never-render')

    store.dailyUnlockSettings.courses[0]!.pausedAt = createdAt
    await wrapper.vm.$nextTick()
    expect(wrapper.get('[data-testid="player-locked"]').text()).toContain('课程已暂停')
    expect(wrapper.get('[data-testid="player-locked"]').text()).not.toContain('可以开始播放')
    delete store.dailyUnlockSettings.courses[0]!.pausedAt

    vi.setSystemTime(nextMidnight)
    store.refreshDailyUnlockClock()
    await wrapper.vm.$nextTick()
    expect(wrapper.get('[data-testid="player-unlocked"]').text()).toContain('已解锁')
    await wrapper.get('[data-testid="player-start-unlocked"]').trigger('click')
    await flushPromises()
    expect(pageMocks.resolvePlaybackUrl).toHaveBeenCalledOnce()
    await wrapper.get('[data-testid="player-video"]').trigger('loadedmetadata', { detail: { duration: 600 } })
    expect(pageMocks.videoContext.seek).toHaveBeenCalledWith(0)
    expect(wrapper.find('[data-testid="resume-continue"]').exists()).toBe(false)
  })

  it('does not retry a direct link after a 403 playback error', async () => {
    const video = directVideo('https://media.example.test/movie.mp4')
    const { wrapper } = mountPlayer((appStore) => {
      appStore.directRecords = [
        {
          id: video.sourceId,
          name: video.name,
          url: video.path,
          mediaKind: 'mp4',
          addedAt: 1
        }
      ]
    })

    await loadPlayer(video.id)
    await flushPromises()
    await wrapper.get('[data-testid="player-video"]').trigger('error', {
      detail: { errMsg: 'HTTP 403' }
    })
    await flushPromises()

    expect(pageMocks.resolvePlaybackUrl).not.toHaveBeenCalled()
    expect(wrapper.get('[role="alert"]').text()).toContain('播放地址拒绝访问')
    expect(wrapper.find('[data-testid="player-retry"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="player-reconnect"]').exists()).toBe(false)
  })

  it('does not let an old Baidu 403 refresh overwrite a newly loaded video', async () => {
    const first = baiduVideo()
    const second: VideoItem = {
      ...baiduVideo(),
      id: 'baidu:8',
      sourceId: '8',
      name: 'Second.mp4',
      path: '/apps/片刻/Second.mp4'
    }
    const staleRefresh = deferred<string>()
    pageMocks.resolvePlaybackUrl
      .mockResolvedValueOnce('https://d.pcs.baidu.com/file/first?access_token=one')
      .mockImplementationOnce(() => staleRefresh.promise)
      .mockResolvedValueOnce('https://d.pcs.baidu.com/file/second?access_token=two')
    const { wrapper } = mountPlayer((appStore) => {
      appStore.baiduVideos = [first, second]
      appStore.authSession = validSession()
    })

    await loadPlayer(first.id)
    await flushPromises()
    await wrapper.get('[data-testid="player-video"]').trigger('error', {
      detail: { errMsg: 'HTTP 403' }
    })
    await Promise.resolve()

    await loadPlayer(second.id)
    await flushPromises()
    expect(wrapper.get('[data-testid="player-video"]').attributes('src')).toContain(
      '/second'
    )

    staleRefresh.resolve(
      'https://d.pcs.baidu.com/file/stale?access_token=old-video-token'
    )
    await flushPromises()

    expect(wrapper.get('.player-header__title').text()).toBe(second.name)
    expect(wrapper.get('[data-testid="player-video"]').attributes('src')).toContain(
      '/second'
    )
    expect(wrapper.text()).not.toContain('old-video-token')
  })

  it('shows a resumable dialog, continues from the saved second, and restart saves zero immediately', async () => {
    const video = directVideo('https://media.example.test/movie.mp4')
    const { store, wrapper } = mountPlayer((appStore) => {
      appStore.directRecords = [
        {
          id: video.sourceId,
          name: video.name,
          url: video.path,
          mediaKind: 'mp4',
          addedAt: 1
        }
      ]
      appStore.progressHistory = [
        {
          videoId: video.id,
          positionSeconds: 120,
          durationSeconds: 600,
          updatedAt: 1,
          completed: false
        }
      ]
      appStore.resumableProgress = [...appStore.progressHistory]
    })

    await loadPlayer(video.id)
    await flushPromises()
    await wrapper.get('[data-testid="player-video"]').trigger('loadedmetadata', {
      detail: { duration: 600 }
    })

    await wrapper.get('[data-testid="resume-continue"]').trigger('click')
    expect(pageMocks.videoContext.seek).toHaveBeenCalledWith(120)
    expect(pageMocks.videoContext.play).toHaveBeenCalledOnce()

    lifecycle.onHide.mock.calls[0]![0]()
    expect(store.progressHistory[0]).toMatchObject({ positionSeconds: 120 })

    store.progressHistory = [
      {
        videoId: video.id,
        positionSeconds: 120,
        durationSeconds: 600,
        updatedAt: 1,
        completed: false
      }
    ]
    store.resumableProgress = [...store.progressHistory]
    await loadPlayer(video.id)
    await flushPromises()
    await wrapper.get('[data-testid="player-video"]').trigger('loadedmetadata', {
      detail: { duration: 600 }
    })
    await wrapper.get('[data-testid="resume-restart"]').trigger('click')
    expect(pageMocks.videoContext.seek).toHaveBeenCalledWith(0)
    expect(store.progressHistory[0]).toMatchObject({ positionSeconds: 0 })
  })

  it('starts an explicit review at zero once without showing resume or overwriting progress on metadata', async () => {
    const video = directVideo('https://media.example.test/movie.mp4')
    const { store, wrapper } = mountPlayer((appStore) => {
      appStore.directRecords = [{ id: video.sourceId, name: video.name, url: video.path, mediaKind: 'mp4', addedAt: 1 }]
      appStore.progressHistory = [{ videoId: video.id, positionSeconds: 120, durationSeconds: 600, updatedAt: 1, completed: true }]
    })
    await loadPlayer(video.id, '1')
    await flushPromises()
    const media = wrapper.get('[data-testid="player-video"]')
    await media.trigger('loadedmetadata', { detail: { duration: 0 } })
    expect(pageMocks.videoContext.seek).not.toHaveBeenCalled()
    await media.trigger('loadedmetadata', { detail: { duration: 600 } })
    expect(wrapper.find('[data-testid="resume-continue"]').exists()).toBe(false)
    expect(pageMocks.videoContext.seek).toHaveBeenCalledOnce()
    expect(pageMocks.videoContext.seek).toHaveBeenCalledWith(0)
    expect(pageMocks.videoContext.play).toHaveBeenCalledOnce()
    expect(store.progressHistory[0]).toMatchObject({ completed: true, positionSeconds: 120 })
    await media.trigger('loadedmetadata', { detail: { duration: 600 } })
    expect(pageMocks.videoContext.seek).toHaveBeenCalledTimes(1)
    expect(wrapper.find('[data-testid="resume-continue"]').exists()).toBe(false)
  })

  it('only treats the exact restart query value as review mode', async () => {
    const video = directVideo('https://media.example.test/movie.mp4')
    const { wrapper } = mountPlayer((store) => {
      store.directRecords = [{ id: video.sourceId, name: video.name, url: video.path, mediaKind: 'mp4', addedAt: 1 }]
      store.progressHistory = [{ videoId: video.id, positionSeconds: 120, durationSeconds: 600, updatedAt: 1, completed: false }]
    })
    await loadPlayer(video.id, 'true')
    await flushPromises()
    await wrapper.get('[data-testid="player-video"]').trigger('loadedmetadata', { detail: { duration: 600 } })
    expect(wrapper.find('[data-testid="resume-continue"]').exists()).toBe(true)
    expect(pageMocks.videoContext.seek).not.toHaveBeenCalled()
  })

  it('uses a safe not-found state for malformed or absent IDs and a path-only unsupported state', async () => {
    const video = baiduVideo()
    const { wrapper } = mountPlayer((appStore) => {
      appStore.baiduVideos = [video]
      appStore.authSession = validSession()
    })

    await loadPlayer('%E0%A4%A')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('找不到视频')
    expect(wrapper.text()).not.toContain('private')

    await loadPlayer(video.id)
    await flushPromises()
    await wrapper.get('[data-testid="player-video"]').trigger('error', {
      detail: { errMsg: 'unsupported format' }
    })
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('设备无法播放此视频格式')
    expect(wrapper.text()).toContain(video.path)
    expect(wrapper.find('[data-testid="player-back"]').exists()).toBe(true)
  })

  it('does not expose a direct-link URL in an unsupported-format state', async () => {
    const privateUrl =
      'https://media.example.test/direct.mp4?access_token=direct-private&signature=direct-signature'
    const video = directVideo(privateUrl)
    const { wrapper } = mountPlayer((appStore) => {
      appStore.directRecords = [
        {
          id: video.sourceId,
          name: video.name,
          url: privateUrl,
          mediaKind: 'mp4',
          addedAt: 1
        }
      ]
    })

    await loadPlayer(video.id)
    await flushPromises()
    await wrapper.get('[data-testid="player-video"]').trigger('error', {
      detail: { errMsg: 'unsupported format' }
    })
    await flushPromises()

    expect(wrapper.get('[role="alert"]').text()).toContain('设备无法播放此视频格式')
    expect(wrapper.text()).toContain('媒体直链文件')
    expect(wrapper.text()).not.toContain(privateUrl)
    expect(wrapper.text()).not.toContain('access_token')
    expect(wrapper.text()).not.toContain('direct-signature')
  })

  it('sets one of the fixed playback rates with the video context', async () => {
    pageMocks.platform = 'h5'
    const video = directVideo('https://media.example.test/movie.mp4')
    const { wrapper } = mountPlayer((appStore) => {
      appStore.directRecords = [
        {
          id: video.sourceId,
          name: video.name,
          url: video.path,
          mediaKind: 'mp4',
          addedAt: 1
        }
      ]
    })
    await loadPlayer(video.id)
    await flushPromises()
    await wrapper.get('[data-testid="player-video"]').trigger('loadedmetadata', {
      detail: { duration: 600 }
    })

    await wrapper.get('[data-testid="player-rate-menu"]').trigger('click')
    expect(wrapper.findAll('[data-testid="player-rate"]')).toHaveLength(5)
    await wrapper.findAll('[data-testid="player-rate"]')[3]!.trigger('click')
    expect(pageMocks.videoContext.playbackRate).toHaveBeenCalledWith(1.5)
  })
})

function mountPlayer(configure?: (store: ReturnType<typeof useAppStore>) => void) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useAppStore(pinia)
  configure?.(store)
  const wrapper = mount(PlayerPage, { global: { plugins: [pinia] } })
  return { store, wrapper, pinia }
}

function mountNextLessonPlayer() {
  return mountPlayer(store => {
    store.directRecords = ['first', 'second'].map((id, index) => ({ id, name: index ? '第二节' : '第一节', url: `https://media.example.test/${id}.mp4`, mediaKind: 'mp4', addedAt: 1 }))
    store.dailyUnlockSettings = { enabled: true, courses: [{ id: 'course', name: '课程', createdAt: Date.now(), dailyEpisodeCount: 2, episodes: store.directRecords.map(record => ({ videoId: `direct:${record.id}`, name: record.name, sourceType: 'direct' })) }] }
  })
}

async function loadPlayer(id: string, restart?: unknown): Promise<void> {
  expect(lifecycle.onLoad).toHaveBeenCalled()
  const handler = lifecycle.onLoad.mock.calls.at(-1)?.[0]
  handler?.({ id: encodeURIComponent(id), restart })
  await Promise.resolve()
}

function directVideo(path: string): VideoItem {
  return {
    id: 'direct:movie-1',
    sourceType: 'direct',
    sourceId: 'movie-1',
    name: 'Movie.mp4',
    path
  }
}

function baiduVideo(): VideoItem {
  return {
    id: 'baidu:7',
    sourceType: 'baidu',
    sourceId: '7',
    name: 'Episode.mp4',
    path: '/apps/片刻/Episode.mp4'
  }
}

function validSession() {
  return {
    accessToken: 'private-baidu-token',
    expiresAt: Date.now() + 60_000,
    scope: ['basic', 'netdisk']
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}
