import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DailyUnlockCourse, VideoItem } from '@/domain/video'
import DailyUnlockPage from '@/pages/daily-unlock/index.vue'
import { useAppStore } from '@/stores/appStore'

vi.mock('@dcloudio/uni-app', () => ({ onShow: vi.fn(), onHide: vi.fn(), onUnload: vi.fn() }))

describe('DailyUnlock page', () => {
  it('uses the premium course shell and main navigation', () => {
    const { wrapper } = mountDailyUnlock()
    expect(wrapper.get('.daily-unlock-page').classes()).toContain('daily-unlock-page--premium')
    expect(wrapper.find('.bottom-nav').exists()).toBe(false)
  })


  afterEach(() => { vi.useRealTimers() })

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 27, 12))
    vi.mocked(uni.showModal).mockReset()
    vi.mocked(uni.showToast).mockReset()
    vi.mocked(uni.navigateBack).mockReset()
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => 'course-test-id') })
  })

  it('shows a thumbnail in the manual video selection rows', async () => {
    const { wrapper } = mountDailyUnlock((appStore) => {
      appStore.baiduVideos = [{
        ...video('thumbnail', '带缩略图.mp4', '/apps/片刻/带缩略图.mp4'),
        thumbnailUrl: 'https://images.example.test/thumbnail.jpg'
      }]
    })

    await wrapper.get('[data-testid="mode-videos"]').trigger('click')

    expect(wrapper.find('[data-video-id="baidu:thumbnail"] .video-thumbnail--premium').exists()).toBe(true)
  })
  it('snapshots a folder including nested videos in natural episode order', async () => {
    const { store, wrapper } = mountDailyUnlock((appStore) => {
      appStore.dailyUnlockNow = new Date(2026, 9, 27, 12).getTime()
      appStore.baiduVideos = [
        video('10', '第10集.mp4', '/apps/片刻/课程/子目录/第10集.mp4'),
        video('2', '第2集.mp4', '/apps/片刻/课程/第2集.mp4')
      ]
    })

    await wrapper.get('[data-testid="course-name"]').setValue('日语听力')
    await wrapper.get('[data-folder-path="/apps/片刻/课程"]').trigger('click')
    expect(wrapper.get('[data-testid="episode-preview"]').text()).toContain('1. 第2集.mp4')
    expect(wrapper.get('[data-testid="episode-preview"]').text()).toContain('2. 第10集.mp4')
    await wrapper.get('[data-testid="create-course"]').trigger('click')

    expect(store.dailyUnlockSettings.courses[0]).toMatchObject({
      id: 'course-test-id',
      name: '日语听力',
      sourceFolderPath: '/apps/片刻/课程',
      episodes: [
        { videoId: 'baidu:2', name: '第2集.mp4', sourceType: 'baidu' },
        { videoId: 'baidu:10', name: '第10集.mp4', sourceType: 'baidu' }
      ]
    })
    expect(wrapper.get('[data-testid="course-card"]').text()).toContain('已开放 1 / 2 集')
    expect(wrapper.get('[data-testid="course-card"]').text()).toContain('下一集 2026-10-28 00:00 开放')
    expect(wrapper.get('.daily-course-progress__value').attributes('style')).toContain('width: 50%')
  })

  it('lets users select Baidu and direct videos while keeping signed URLs out of course storage', async () => {
    const signedUrl = 'https://media.example.test/lesson.m3u8?sign=private-value'
    const { store, wrapper } = mountDailyUnlock((appStore) => {
      appStore.dailyUnlockNow = new Date(2026, 9, 27, 12).getTime()
      appStore.baiduVideos = [video('1', '百度第一集.mp4', '/apps/片刻/百度第一集.mp4')]
      appStore.directRecords = [{
        id: 'direct-1', name: '直链第二集.mp4', url: signedUrl,
        mediaKind: 'hls', addedAt: 1
      }]
    })

    await wrapper.get('[data-testid="mode-videos"]').trigger('click')
    await wrapper.get('[data-testid="course-name"]').setValue('混合课')
    await wrapper.get('[data-video-id="baidu:1"]').trigger('click')
    await wrapper.get('[data-video-id="direct:direct-1"]').trigger('click')
    await wrapper.get('[data-testid="create-course"]').trigger('click')

    const saved = store.dailyUnlockSettings.courses[0]!
    expect(saved.episodes.map(({ videoId }) => videoId)).toEqual([
      'baidu:1', 'direct:direct-1'
    ])
    expect(saved.episodes[1]).toEqual({
      videoId: 'direct:direct-1', name: '直链第二集.mp4', sourceType: 'direct'
    })
    expect(JSON.stringify(store.dailyUnlockSettings)).not.toContain('private-value')
    expect(wrapper.html()).not.toContain(signedUrl)
  })

  it('names a conflicting course and preserves it when deletion is cancelled', async () => {
    const existingCourse: DailyUnlockCourse = {
      id: 'existing-course',
      name: '原课程',
      createdAt: new Date(2026, 9, 27, 8).getTime(),
      episodes: [{
        videoId: 'baidu:1', name: '已占用.mp4', sourceType: 'baidu',
        path: '/apps/片刻/已占用.mp4'
      }]
    }
    const { store, wrapper } = mountDailyUnlock((appStore) => {
      appStore.dailyUnlockNow = new Date(2026, 9, 27, 12).getTime()
      appStore.baiduVideos = [video('1', '已占用.mp4', '/apps/片刻/已占用.mp4')]
      appStore.dailyUnlockSettings = { enabled: true, courses: [existingCourse] }
    })

    await wrapper.get('[data-testid="mode-videos"]').trigger('click')
    await wrapper.get('[data-testid="course-name"]').setValue('重复课程')
    await wrapper.get('[data-video-id="baidu:1"]').trigger('click')
    expect(wrapper.get('[role="alert"]').text()).toContain('原课程')
    await wrapper.get('[data-testid="create-course"]').trigger('click')
    expect(uni.showToast).toHaveBeenCalledWith(expect.objectContaining({ title: expect.stringContaining('原课程') }))
    expect(store.dailyUnlockSettings.courses).toEqual([existingCourse])

    vi.mocked(uni.showModal).mockImplementation((options) => {
      options?.success?.({ confirm: false, cancel: true } as UniApp.ShowModalRes)
      return undefined as never
    })
    await wrapper.get('[data-testid="delete-course"]').trigger('click')
    expect(uni.showModal).toHaveBeenCalledWith(expect.objectContaining({ title: '删除每日课程' }))
    expect(store.dailyUnlockSettings.courses).toEqual([existingCourse])
  })

  it('creates from a folder without requiring a manually entered name and resets selection', async () => {
    const { store, wrapper } = mountDailyUnlock((appStore) => {
      appStore.baiduVideos = [video('1', '第一集.mp4', '/apps/片刻/听力课/第一集.mp4')]
    })
    await wrapper.get('[data-folder-path="/apps/片刻/听力课"]').trigger('click')
    expect((wrapper.get('[data-testid="course-name"]').element as HTMLInputElement).value).toBe('听力课')
    await wrapper.get('[data-testid="create-course"]').trigger('click')
    expect(store.dailyUnlockSettings.courses[0]?.name).toBe('听力课')
    expect(wrapper.find('[data-testid="episode-preview"]').exists()).toBe(false)
    expect(uni.showToast).toHaveBeenCalledWith(expect.objectContaining({ title: '课程已创建' }))
  })

  it('shows a visible error when manual selection has no name, then allows retry', async () => {
    const { store, wrapper } = mountDailyUnlock((appStore) => {
      appStore.baiduVideos = [video('1', '第一集.mp4', '/apps/片刻/第一集.mp4')]
    })
    await wrapper.get('[data-testid="mode-videos"]').trigger('click')
    await wrapper.get('[data-video-id="baidu:1"]').trigger('click')
    await wrapper.get('[data-testid="create-course"]').trigger('click')
    expect(wrapper.get('[role="alert"]').text()).toBe('请先填写课程名称')
    expect(uni.showToast).toHaveBeenCalledWith(expect.objectContaining({ title: '请先填写课程名称' }))
    expect(store.dailyUnlockSettings.courses).toHaveLength(0)
    await wrapper.get('[data-testid="course-name"]').setValue('听力')
    await wrapper.get('[data-testid="create-course"]').trigger('click')
    expect(store.dailyUnlockSettings.courses).toHaveLength(1)
  })

  it('explains missing videos instead of silently disabling submission', async () => {
    const { store, wrapper } = mountDailyUnlock()
    await wrapper.get('[data-testid="course-name"]').setValue('空课')
    await wrapper.get('[data-testid="create-course"]').trigger('click')
    expect(wrapper.get('[role="alert"]').text()).toContain('请选择')
    expect(uni.showToast).toHaveBeenCalledWith(expect.objectContaining({ title: expect.stringContaining('请选择') }))
    expect(store.dailyUnlockSettings.courses).toHaveLength(0)
  })

  it('keeps the form and shows feedback on a storage failure', async () => {
    const { store, wrapper } = mountDailyUnlock((appStore) => {
      appStore.baiduVideos = [video('1', '第一集.mp4', '/apps/片刻/听力课/第一集.mp4')]
    })
    vi.spyOn(store, 'createDailyUnlockCourse').mockReturnValue({ ok: false, reason: 'storage' })
    await wrapper.get('[data-folder-path="/apps/片刻/听力课"]').trigger('click')
    await wrapper.get('[data-testid="create-course"]').trigger('click')
    expect(wrapper.get('[role="alert"]').text()).toBe('课程保存失败，请稍后重试')
    expect(uni.showToast).toHaveBeenCalledWith(expect.objectContaining({ title: '课程保存失败，请稍后重试' }))
    expect(wrapper.find('[data-testid="episode-preview"]').exists()).toBe(true)
    expect(store.dailyUnlockSettings.courses).toHaveLength(0)
  })

  it('registers the course manager as a custom-navigation page', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const pages = JSON.parse(readFileSync(resolve(process.cwd(), 'src/pages.json'), 'utf8')) as {
      pages: Array<{ path: string; style?: { navigationStyle?: string } }>
    }
    expect(pages.pages).toContainEqual({
      path: 'pages/daily-unlock/index', style: { navigationStyle: 'custom' }
    })
  })
})

function mountDailyUnlock(configure?: (store: ReturnType<typeof useAppStore>) => void) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useAppStore(pinia)
  configure?.(store)
  return {
    store,
    wrapper: mount(DailyUnlockPage, { global: { plugins: [pinia] } })
  }
}

function video(sourceId: string, name: string, path: string): VideoItem {
  return { id: `baidu:${sourceId}`, sourceType: 'baidu', sourceId, name, path }
}
