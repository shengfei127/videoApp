import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it, vi } from 'vitest'

import BottomNav from '@/components/BottomNav.vue'
import VideoRow from '@/components/VideoRow.vue'
import type { VideoItem } from '@/domain/video'
import HomePage from '@/pages/home/index.vue'
import { useAppStore } from '@/stores/appStore'

describe('BottomNav', () => {
  it('keeps fixed accessible destinations and redirects only inactive items once', async () => {
    const wrapper = mount(BottomNav, { props: { active: 'home' } })
    const items = wrapper.findAll('button.bottom-nav__item')
    const destinations = [
      ['首页', '/pages/home/index'],
      ['视频库', '/pages/library/index'],
      ['设置', '/pages/settings/index']
    ] as const

    expect(items).toHaveLength(destinations.length)
    expect(items.map((item) => item.attributes('aria-label'))).toEqual(
      destinations.map(([label]) => label)
    )
    expect(items[0]?.attributes('aria-current')).toBe('page')
    expect(items.every((item) => item.classes().includes('bottom-nav__item'))).toBe(true)

    for (const [index, [, path]] of destinations.entries()) {
      vi.mocked(uni.redirectTo).mockClear()
      await items[index]!.trigger('click')

      if (index === 0) {
        expect(uni.redirectTo).not.toHaveBeenCalled()
      } else {
        expect(uni.redirectTo).toHaveBeenCalledTimes(1)
        expect(uni.redirectTo).toHaveBeenCalledWith({ url: path })
      }
    }
  })
})

describe('VideoRow', () => {
  it('emits one selection from one tappable root while keeping long names and safe metadata', async () => {
    const video: VideoItem = {
      id: 'direct:private-stream',
      sourceType: 'direct',
      sourceId: 'private-stream',
      name: '这是一段需要稳定占据两行而不能挤压缩略图轨道的特别特别长的视频文件名.mp4',
      path: 'https://media.example.test/private.m3u8?access_token=never-render-this',
      durationSeconds: 3_661,
      thumbnailUrl: 'https://images.example.test/private-stream.jpg'
    }
    const wrapper = mount(VideoRow, { props: { video } })
    const root = wrapper.get('button.video-row')

    expect(wrapper.findAll('button')).toHaveLength(1)
    expect(root.attributes('aria-label')).toContain(video.name)
    expect(wrapper.get('.video-row__name').text()).toBe(video.name)
    expect(wrapper.get('.video-row__name').classes()).toContain(
      'video-row__name--two-lines'
    )
    expect(wrapper.text()).toContain('媒体直链')
    expect(wrapper.text()).toContain('1:01:01')
    expect(wrapper.text()).not.toContain('media.example.test')
    expect(wrapper.text()).not.toContain('access_token')
    expect(wrapper.text()).not.toContain('never-render-this')

    await root.trigger('click')

    expect(wrapper.emitted('select')).toEqual([[video]])
  })

  it('formats optional saved progress and duration without exposing source secrets', () => {
    const video: VideoItem = {
      id: 'baidu:episode-1',
      sourceType: 'baidu',
      sourceId: 'episode-1',
      name: '第一集.mp4',
      path: '/apps/片刻/第一集.mp4'
    }
    const wrapper = mount(VideoRow, {
      props: { video, progressSeconds: 90, durationSeconds: 600 }
    })

    expect(wrapper.get('.video-row__metadata').text()).toContain('已看到 01:30')
    expect(wrapper.get('.video-row__metadata').text()).toContain('时长 10:00')
  })
})

describe('Home page', () => {
  it('shows both first-run source actions early and uses their exact routes', async () => {
    const { wrapper } = mountHome()
    const actions = wrapper.findAll('button.home-source-action')

    expect(wrapper.text()).toContain('片刻')
    expect(actions.map((action) => action.text())).toEqual([
      expect.stringContaining('连接百度网盘'),
      expect.stringContaining('导入媒体直链')
    ])
    expect(wrapper.get('button[aria-label="首页"]').attributes('aria-current')).toBe(
      'page'
    )

    await actions[0]!.trigger('click')
    expect(uni.navigateTo).toHaveBeenCalledTimes(1)
    expect(uni.navigateTo).toHaveBeenLastCalledWith({ url: '/pages/oauth/index' })

    vi.mocked(uni.navigateTo).mockClear()
    await actions[1]!.trigger('click')
    expect(uni.navigateTo).toHaveBeenCalledTimes(1)
    expect(uni.navigateTo).toHaveBeenLastCalledWith({
      url: '/pages/library/index?openImport=1'
    })
  })

  it('puts resume first with the saved timestamp, clamped progress, and encoded player route', async () => {
    const video: VideoItem = {
      id: 'baidu:海边 / 第一集?',
      sourceType: 'baidu',
      sourceId: '海边 / 第一集?',
      name: '海边的第一天.mp4',
      path: '/apps/片刻/海边的第一天.mp4',
      durationSeconds: 1_560,
      thumbnailUrl: 'https://images.example.test/coast.jpg',
      modifiedAt: 100
    }
    const { store, wrapper } = mountHome((appStore) => {
      appStore.baiduVideos = [video]
      appStore.resumableProgress = [
        {
          videoId: video.id,
          positionSeconds: 386,
          durationSeconds: 1_560,
          updatedAt: 200,
          completed: false
        }
      ]
      appStore.syncStatus = 'success'
    })

    expect(store.continueWatching).toHaveLength(1)
    const sections = wrapper.findAll('[data-home-section]')
    expect(sections[0]?.attributes('data-home-section')).toBe('continue')
    expect(sections[0]?.text()).toContain('接着看')
    expect(sections[0]?.text()).toContain('06:26')
    const progress = wrapper.get('[role="progressbar"]')
    expect(progress.attributes('aria-valuemin')).toBe('0')
    expect(progress.attributes('aria-valuemax')).toBe('100')
    expect(progress.attributes('aria-valuenow')).toBe('25')

    await wrapper.get('button.home-resume').trigger('click')

    expect(uni.navigateTo).toHaveBeenCalledTimes(1)
    expect(uni.navigateTo).toHaveBeenCalledWith({
      url: `/pages/player/index?id=${encodeURIComponent(video.id)}`
    })
  })

  it('limits recent videos to six, routes rows to the player, and redacts sensitive state', async () => {
    const baiduVideos = Array.from({ length: 7 }, (_, index): VideoItem => ({
      id: `baidu:recent ${index}`,
      sourceType: 'baidu',
      sourceId: `recent ${index}`,
      name: `最近视频 ${index}.mp4`,
      path: `/apps/片刻/最近视频 ${index}.mp4`,
      modifiedAt: index
    }))
    const directId = 'private?id'
    const privateToken = 'AUTH_TOKEN_MUST_NOT_RENDER'
    const { wrapper } = mountHome((store) => {
      store.authSession = {
        accessToken: privateToken,
        expiresAt: Date.now() + 60_000,
        scope: ['basic', 'netdisk']
      }
      store.baiduVideos = baiduVideos
      store.directRecords = [
        {
          id: directId,
          name: '私密直播',
          url: 'https://media.example.test/live.m3u8?dlink=signed&access_token=secret',
          mediaKind: 'hls',
          addedAt: 100
        }
      ]
      store.syncStatus = 'error'
      store.lastError = {
        code: 'sync-failed',
        message:
          'raw Error: https://provider.example/dlink?access_token=never-render-this'
      }
    })
    const rows = wrapper.findAllComponents(VideoRow)

    expect(wrapper.text()).toContain('最近视频')
    expect(rows).toHaveLength(6)
    expect(wrapper.get('[data-testid="sync-status"]').text()).toBe(
      '同步状态：同步异常'
    )
    expect(wrapper.text()).toContain('百度网盘同步失败，请稍后重试')
    expect(wrapper.text()).toContain('媒体直链')
    for (const secret of [
      privateToken,
      'media.example.test',
      'raw Error',
      'access_token',
      'never-render-this',
      'dlink=signed'
    ]) {
      expect(wrapper.html()).not.toContain(secret)
    }

    await rows[0]!.get('button.video-row').trigger('click')

    expect(uni.navigateTo).toHaveBeenCalledTimes(1)
    expect(uni.navigateTo).toHaveBeenCalledWith({
      url: `/pages/player/index?id=${encodeURIComponent(`direct:${directId}`)}`
    })
  })
})

function mountHome(
  configure?: (store: ReturnType<typeof useAppStore>) => void
) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useAppStore(pinia)
  configure?.(store)

  return {
    store,
    wrapper: mount(HomePage, {
      global: { plugins: [pinia] }
    })
  }
}
