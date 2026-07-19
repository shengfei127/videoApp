import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { VideoItem } from '@/domain/video'
import PlayerPage from '@/pages/player/index.vue'
import { useAppStore } from '@/stores/appStore'

const lifecycle = vi.hoisted(() => ({
  onLoad: vi.fn(),
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
  baiduRoots: [] as string[],
  resolvePlaybackUrl: vi.fn(),
  pendingDlinks: [] as Array<{
    promise: Promise<string>
    resolve: (value: string) => void
  }>,
  videoContext: {
    seek: vi.fn(),
    play: vi.fn(),
    playbackRate: vi.fn(),
    requestFullScreen: vi.fn()
  }
}))

vi.mock('@dcloudio/uni-app', () => ({
  onLoad: lifecycle.onLoad,
  onHide: lifecycle.onHide,
  onUnload: lifecycle.onUnload
}))
vi.mock('@/config/runtime', () => ({ runtimeConfig: pageMocks.config }))
vi.mock('@/features/baidu/baiduDriveSource', () => ({
  BaiduDriveSource: class {
    constructor(root: string) {
      pageMocks.baiduRoots.push(root)
    }

    resolvePlaybackUrl = pageMocks.resolvePlaybackUrl
  }
}))

describe('Player page', () => {
  beforeEach(() => {
    lifecycle.onLoad.mockReset()
    lifecycle.onHide.mockReset()
    lifecycle.onUnload.mockReset()
    pageMocks.resolvePlaybackUrl.mockReset()
    Object.values(pageMocks.videoContext).forEach((fn) => fn.mockReset())
    Object.assign(uni, {
      createVideoContext: vi.fn(
        () => pageMocks.videoContext as unknown as UniNamespace.VideoContext
      )
    })
  })

  it('uses the configured Baidu app root for the player drive source', () => {
    mountPlayer()

    expect(new Set(pageMocks.baiduRoots)).toEqual(
      new Set([pageMocks.config.baiduRoot])
    )
  })

  it('loads a direct source without rendering its private URL, uses native player controls, and saves lifecycle progress', async () => {
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
    expect(player.attributes('controls')).toBeDefined()
    expect(player.attributes('enable-play-gesture')).toBeDefined()
    expect(player.attributes('show-center-play-btn')).toBeDefined()
    expect(player.attributes('show-fullscreen-btn')).toBeDefined()
    expect(player.attributes('enable-fullscreen')).toBeUndefined()
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
    expect(wrapper.get('[role="alert"]').text()).toContain('播放失败')
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

  it('sets one of the fixed playback rates with the native video context', async () => {
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
  return { store, wrapper }
}

async function loadPlayer(id: string): Promise<void> {
  expect(lifecycle.onLoad).toHaveBeenCalled()
  const handler = lifecycle.onLoad.mock.calls.at(-1)?.[0]
  handler?.({ id: encodeURIComponent(id) })
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
