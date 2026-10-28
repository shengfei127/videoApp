import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it, vi } from 'vitest'

import BottomNav from '@/components/BottomNav.vue'
import VideoRow from '@/components/VideoRow.vue'
import type { VideoItem } from '@/domain/video'
import HomePage from '@/pages/home/index.vue'
import { useAppStore } from '@/stores/appStore'

vi.mock('@dcloudio/uni-app', () => ({ onShow: vi.fn(), onHide: vi.fn(), onUnload: vi.fn() }))

describe('BottomNav', () => {
  it('keeps fixed accessible destinations and redirects only inactive items once', async () => {
    const wrapper = mount(BottomNav, { props: { active: 'home' } })
    const items = wrapper.findAll('button.bottom-nav__item')
    const destinations = [
      ['首页', '/pages/home/index'],
      ['视频库', '/pages/library/index'],
      ['设置', '/pages/settings/index']
    ] as const

    expect(wrapper.get('.bottom-nav').classes()).toContain('bottom-nav--premium')
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

  it('marks a locked course episode without displaying any media URL', () => {
    const video: VideoItem = {
      id: 'direct:locked',
      sourceType: 'direct',
      sourceId: 'locked',
      name: '第2集.m3u8',
      path: 'https://media.example.test/lesson.m3u8?sign=secret'
    }
    const wrapper = mount(VideoRow, {
      props: {
        video,
        unlockStatus: {
          locked: true,
          courseId: 'course-1',
          courseName: '听力课',
          episodeNumber: 2,
          unlockedCount: 1,
          unlockAt: new Date(2026, 9, 28).getTime()
        }
      }
    })

    expect(wrapper.get('button.video-row').attributes('aria-label')).toContain('第2集')
    expect(wrapper.text()).toContain('待解锁')
    expect(wrapper.text()).toContain('2026-10-28 00:00')
    expect(wrapper.text()).not.toContain('media.example.test')
    expect(wrapper.text()).not.toContain('secret')
  })

  it('shows a valid absolute Baidu path whose directory name contains sign', () => {
    const path = '/apps/\u7247\u523b/design/episode.mp4'
    const video: VideoItem = {
      id: 'baidu:design-episode',
      sourceType: 'baidu',
      sourceId: 'design-episode',
      name: 'Design episode.mp4',
      path
    }
    const wrapper = mount(VideoRow, { props: { video } })

    expect(wrapper.get('.video-row__metadata').text()).toContain(path)
  })
})

describe('Home page', () => {
  it('renders missed lessons in small batches and resets the batch after collapsing', async () => {
    const { wrapper } = mountHome((store) => {
      store.dailyUnlockNow = new Date(2026, 9, 28).getTime()
      store.dailyUnlockSettings = { enabled: true, courses: [{ id: 'large-plan', name: '长期学习计划', createdAt: new Date(2026, 0, 1).getTime(), episodes: Array.from({ length: 100 }, (_, index) => ({ videoId: `direct:${index}`, name: `第${index + 1}集`, sourceType: 'direct' as const })) }] }
    })
    expect(wrapper.findAll('.learning-lesson')).toHaveLength(0)
    await wrapper.get('[data-backlog-course="large-plan"]').trigger('click')
    expect(wrapper.findAll('.learning-lesson')).toHaveLength(20)
    await wrapper.get('[data-backlog-more="large-plan"]').trigger('click')
    expect(wrapper.findAll('.learning-lesson')).toHaveLength(40)
    await wrapper.get('[data-backlog-course="large-plan"]').trigger('click')
    await wrapper.get('[data-backlog-course="large-plan"]').trigger('click')
    expect(wrapper.findAll('.learning-lesson')).toHaveLength(20)
    wrapper.unmount()
  })

  it('groups missed lessons by course and offers a timed undo after a lesson disappears', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 28, 12))
    const { wrapper, store } = mountHome((store) => {
      store.dailyUnlockNow = Date.now()
      store.dailyUnlockSettings = { enabled: true, courses: [0, 1].map((index) => ({
        id: `course-${index}`, name: '同名课程', createdAt: new Date(2026, 9, 25).getTime(),
        episodes: [{ videoId: `direct:${index}`, name: `课程${index}`, sourceType: 'direct' }]
      })) }
    })
    expect(wrapper.findAll('[data-backlog-course]')).toHaveLength(2)
    expect(wrapper.find('[data-testid="backlog-lessons"]').exists()).toBe(false)
    await wrapper.get('[data-backlog-course="course-0"]').trigger('click')
    expect(wrapper.findAll('[data-testid="backlog-lessons"]')).toHaveLength(1)
    await wrapper.get('[data-lesson-id="direct:0"] [data-testid="lesson-more"]').trigger('click')
    await wrapper.get('[aria-label="标记学完：课程0"]').trigger('click')
    expect(wrapper.find('[data-backlog-course="course-0"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="learning-undo"]').text()).toContain('课程0')
    expect(store.progressHistory).toEqual([])
    await wrapper.get('[data-testid="learning-undo"] button').trigger('click')
    expect(wrapper.find('[data-lesson-id="direct:0"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="learning-undo"]').exists()).toBe(false)
    await wrapper.get('[data-lesson-id="direct:0"] [data-testid="lesson-more"]').trigger('click')
    await wrapper.get('[aria-label="标记学完：课程0"]').trigger('click')
    await vi.advanceTimersByTimeAsync(8000)
    expect(wrapper.find('[data-testid="learning-undo"]').exists()).toBe(false)
    expect(store.learningHistory.find((item) => item.videoId === 'direct:0')?.completed).toBe(true)
    wrapper.unmount()
    vi.useRealTimers()
  })

  it('continues the most recently watched missed lesson across courses', () => {
    const now = new Date(2026, 9, 28, 12).getTime()
    const { wrapper } = mountHome((store) => {
      store.dailyUnlockNow = now
      store.baiduVideos = [0, 1].map((index) => ({ id: `baidu:recent-${index}`, sourceId: `recent-${index}`, sourceType: 'baidu', name: `课程${index}`, path: `/课程/${index}.mp4`, durationSeconds: 600 }))
      store.dailyUnlockSettings = { enabled: true, courses: store.baiduVideos.map((video, index) => ({ id: `course-${index}`, name: video.name, createdAt: new Date(2026, 9, 26).getTime(), episodes: [{ videoId: video.id, name: video.name, sourceType: 'baidu', path: video.path }] })) }
      store.progressHistory = store.baiduVideos.map((video, index) => ({ videoId: video.id, positionSeconds: 60, durationSeconds: 600, completed: false, updatedAt: now - (1 - index) * 1000 }))
    })
    expect(wrapper.get('[data-testid="continue-learning"]').text()).toContain('课程1')
    expect(wrapper.get('[data-testid="continue-learning"]').text()).not.toContain('课程0')
    wrapper.unmount()
  })

  it('keeps missed lessons accessible, avoids duplicate resume rows, and persists completion with undo', async () => {
    const now = new Date(2026, 9, 28, 12).getTime()
    vi.spyOn(Date, 'now').mockReturnValue(now)
    const videos: VideoItem[] = Array.from({ length: 4 }, (_, index) => ({ id: `baidu:lesson-${index}`, sourceType: 'baidu', sourceId: `lesson-${index}`, name: `第${index + 1}课`, path: `/课程/第${index + 1}课.mp4`, durationSeconds: 600 }))
    const { wrapper, store } = mountHome((store) => {
      store.dailyUnlockNow = now
      store.baiduVideos = videos
      store.dailyUnlockSettings = { enabled: true, courses: [{ id: 'plan', name: '学习计划', createdAt: new Date(2026, 9, 26, 12).getTime(), episodes: videos.map((video) => ({ videoId: video.id, name: video.name, sourceType: video.sourceType, path: video.path })) }] }
      const progress = { videoId: videos[0]!.id, positionSeconds: 120, durationSeconds: 600, completed: false, updatedAt: now }
      store.progressHistory = [progress]
      store.resumableProgress = [progress]
    })
    expect(wrapper.get('[data-testid="continue-learning"]').text()).toContain('剩余 8 分钟')
    expect(wrapper.find('.home-resume').exists()).toBe(false)
    expect(wrapper.findAll('[data-lesson-id="baidu:lesson-0"]')).toHaveLength(1)
    const backlogButton = wrapper.findAll('button').find((button) => button.text().includes('待补学'))!
    await backlogButton.trigger('click')
    expect(wrapper.get('[data-testid="backlog-lessons"]').text()).toContain('第2课')
    await wrapper.get('[data-lesson-id="baidu:lesson-2"] [data-testid="lesson-more"]').trigger('click')
    await wrapper.get('[aria-label="标记学完：第3课"]').trigger('click')
    expect(wrapper.text()).toContain('今日学习已完成')
    expect(wrapper.text()).toContain('复习本节')
    expect(store.learningHistory.find((progress) => progress.videoId === videos[2]!.id)?.completed).toBe(true)
    expect(store.progressHistory.some((progress) => progress.videoId === videos[2]!.id)).toBe(false)
    await wrapper.get('[data-lesson-id="baidu:lesson-2"] .learning-lesson__review').trigger('click')
    expect(uni.navigateTo).toHaveBeenCalledWith({ url: '/pages/player/index?id=baidu%3Alesson-2&restart=1' })
    await wrapper.get('[data-lesson-id="baidu:lesson-2"] [data-testid="lesson-more"]').trigger('click')
    await wrapper.get('[aria-label="撤销学完：第3课"]').trigger('click')
    expect(wrapper.find('.home-learning-done').exists()).toBe(false)
    await wrapper.findAll('button').find((button) => button.text().includes('查看明日安排'))!.trigger('click')
    expect(wrapper.get('[data-testid="tomorrow-lessons"]').text()).toContain('第4课')
    expect(wrapper.get('[data-testid="tomorrow-lessons"]').find('button').exists()).toBe(false)
    wrapper.unmount()
  })

  it('shows today scheduled lessons, completion, missing sources, and updates after midnight', async () => {
    const now = new Date(2026, 9, 28, 12).getTime()
    const video: VideoItem = { id: 'baidu:today', sourceType: 'baidu', sourceId: 'today', name: '今日第一课', path: '/课程/第一课.mp4' }
    const { wrapper, store } = mountHome((store) => {
      store.dailyUnlockNow = now
      store.baiduVideos = [video]
      store.dailyUnlockSettings = { enabled: true, courses: [{
        id: 'course-today', name: '每日听力', createdAt: now,
        episodes: [
          { videoId: video.id, name: video.name, sourceType: 'baidu' },
          { videoId: 'baidu:tomorrow', name: '明日第二课', sourceType: 'baidu' }
        ]
      }] }
      store.progressHistory = [{ videoId: video.id, completed: true, positionSeconds: 600, durationSeconds: 600, updatedAt: now }]
    })
    const section = wrapper.get('[data-home-section="today"]')
    expect(section.text()).toContain('每日听力 · 第 1 集')
    expect(section.text()).toContain('已学完')
    expect(section.text()).not.toContain('明日第二课')
    await section.get('button.video-row').trigger('click')
    expect(uni.navigateTo).toHaveBeenCalledWith({ url: '/pages/player/index?id=baidu%3Atoday&restart=1' })
    store.refreshDailyUnlockClock(new Date(2026, 9, 29).getTime())
    await wrapper.vm.$nextTick()
    expect(section.text()).toContain('明日第二课')
    expect(section.text()).toContain('视频暂不可用')
    expect(section.find('button.video-row').exists()).toBe(false)
    store.dailyUnlockSettings.enabled = false
    await wrapper.vm.$nextTick()
    expect(section.text()).toContain('在设置中开启每日课程')
    wrapper.unmount()
  })

  it('keeps unseen catalog videos out of recent videos and explains the empty history', () => {
    const video: VideoItem = {
      id: 'baidu:unwatched',
      sourceType: 'baidu',
      sourceId: 'unwatched',
      name: '还没看过.mp4',
      path: '/apps/片刻/还没看过.mp4'
    }
    const { wrapper } = mountHome((store) => {
      store.baiduVideos = [video]
    })

    expect(wrapper.findAllComponents(VideoRow)).toHaveLength(0)
    expect(wrapper.find('[data-home-section="recent"]').exists()).toBe(false)
  })

  it('keeps the first-run home aligned to the design without a large onboarding panel', () => {
    const { wrapper } = mountHome()

    expect(wrapper.text()).toContain('片刻')
    expect(wrapper.find('.home-brand-mark').exists()).toBe(true)
    expect(wrapper.find('.home-resume').exists()).toBe(false)
    expect(wrapper.find('.home-sources').exists()).toBe(false)
    expect(wrapper.find('#recent-videos-title').exists()).toBe(false)
    expect(wrapper.get('button[aria-label="首页"]').attributes('aria-current')).toBe('page')
  })

  it('matches the designed header controls and resume card layout', () => {
    const video: VideoItem = {
      id: 'baidu:resume-header',
      sourceType: 'baidu',
      sourceId: 'resume-header',
      name: '海边的第一天.mp4',
      path: '/apps/片刻/海边的第一天.mp4',
      durationSeconds: 600
    }
    const { wrapper } = mountHome((store) => {
      store.baiduVideos = [video]
      store.resumableProgress = [
        { videoId: video.id, positionSeconds: 120, durationSeconds: 600, updatedAt: 10, completed: false }
      ]
    })

    expect(wrapper.find('button.home-header__icon-button').exists()).toBe(true)
    expect(wrapper.find('.home-header__status').exists()).toBe(false)
    expect(wrapper.get('.home-resume').classes()).toContain('home-resume--hero')
    expect(wrapper.find('.home-resume__controls').exists()).toBe(true)
  })

  it('keeps stale cached videos out of the source onboarding panel', () => {
    const { store, wrapper } = mountHome((appStore) => {
      appStore.baiduVideos = [
        {
          id: 'baidu:stale-cache',
          sourceType: 'baidu',
          sourceId: 'stale-cache',
          name: '缓存中的旧视频.mp4',
          path: '/apps/片刻/缓存中的旧视频.mp4'
        }
      ]
    })

    expect(store.authSession).toBeNull()
    expect(store.directRecords).toEqual([])
    expect(store.mergedVideos).toHaveLength(1)
    expect(wrapper.find('.home-sources').exists()).toBe(false)
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
    expect(wrapper.get('[data-home-section="today"]').classes()).toContain('home-today--after-resume')
    const resume = wrapper.get('[data-home-section="continue"]')
    expect(resume.text()).toContain('接着看')
    expect(resume.text()).toContain('06:26')
    expect(wrapper.get('.home-resume__eyebrow').text()).toBe('接着看')
    expect(wrapper.get('.home-resume__timestamp').text()).toBe('06:26 / 26:00')
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
      store.progressHistory = [
        ...baiduVideos.map((video, index) => ({
          videoId: video.id,
          positionSeconds: index === 0 ? 600 : 120,
          durationSeconds: 600,
          updatedAt: 200 - index,
          completed: index === 0
        })),
        {
          videoId: `direct:${directId}`,
          positionSeconds: 30,
          durationSeconds: 600,
          updatedAt: 300,
          completed: false
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

    expect(wrapper.text()).toContain('最近看过')
    expect(rows).toHaveLength(6)
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
