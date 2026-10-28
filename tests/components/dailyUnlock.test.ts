import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DailyUnlockCourse, VideoItem } from '@/domain/video'
import DailyUnlockPage from '@/pages/daily-unlock/index.vue'
import { useAppStore } from '@/stores/appStore'
import { ProgressRepository } from '@/features/playback/progressRepository'
import { uniStorage } from '@/infrastructure/storage'

const lifecycle = vi.hoisted(() => ({ onLoad: vi.fn(), onHide: vi.fn(), onUnload: vi.fn() }))
vi.mock('@dcloudio/uni-app', () => ({ onLoad: lifecycle.onLoad, onShow: vi.fn(), onHide: lifecycle.onHide, onUnload: lifecycle.onUnload }))

describe('DailyUnlock page', () => {
  it.each(['folder', 'videos'] as const)('keeps an episode visible when moving beyond the preview batch in %s mode', async (selectionMode) => {
    const videos = Array.from({ length: 60 }, (_, index) => video(String(index + 1), `第${index + 1}集`, `/apps/片刻/课/${index + 1}`))
    uniStorage.write('pianke:course-draft:v1', { name: '顺序', selectionMode, sourceFolderPath: '/apps/片刻/课', dailyEpisodeCount: 1, startEpisodeNumber: 1, episodes: videos.map(item => ({ videoId: item.id, name: item.name, sourceType: item.sourceType, path: item.path })) })
    uni.pageScrollTo = vi.fn()
    const { wrapper, store } = mountDailyUnlock(store => { store.baiduVideos = videos })
    await wrapper.get('[data-testid="restore-draft"]').trigger('click')
    expect(wrapper.findAll('[data-move-down]')).toHaveLength(50)
    await wrapper.get('[data-move-down="baidu:50"]').trigger('click')
    expect(wrapper.findAll('[data-move-down]')).toHaveLength(60)
    expect(wrapper.get('#course-order-51').text()).toContain('第50集')
    if (selectionMode === 'folder') expect(wrapper.get('#course-order-preview').attributes('scroll-into-view')).toBe('course-order-51')
    expect(uni.pageScrollTo).toHaveBeenCalledWith({ selector: selectionMode === 'folder' ? '#course-order-preview' : '#course-order-51', duration: 180 })
    await wrapper.get('[data-testid="create-course"]').trigger('click')
    expect(store.dailyUnlockSettings.courses[0]?.episodes.slice(49, 51).map(item => item.videoId)).toEqual(['baidu:51', 'baidu:50'])
    wrapper.unmount()
  })

  it('keeps a restored folder empty after removing every unavailable episode', async () => {
    uniStorage.write('pianke:course-draft:v1', { name: '空快照', selectionMode: 'folder', sourceFolderPath: '/apps/片刻', dailyEpisodeCount: 1, startEpisodeNumber: 1, episodes: [{ videoId: 'baidu:missing', name: '缺失集', sourceType: 'baidu', path: '/apps/片刻/missing' }] })
    const { wrapper, store } = mountDailyUnlock(store => { store.baiduVideos = [video('new', '新同步视频', '/apps/片刻/new')] })
    await wrapper.get('[data-testid="restore-draft"]').trigger('click')
    await wrapper.get('[data-testid="remove-all-missing-draft-episodes"]').trigger('click')
    expect(wrapper.get('.daily-selection-count').text()).toContain('0 集')
    await wrapper.get('[data-testid="create-course"]').trigger('click')
    expect(store.dailyUnlockSettings.courses).toHaveLength(0)
    expect(wrapper.get('[role="alert"]').text()).toContain('请选择')
    wrapper.unmount()
  })

  it.each(['onHide', 'onUnload', 'back'] as const)('flushes pending edits on %s and prevents a later duplicate write', async (event) => {
    vi.useFakeTimers()
    const { wrapper } = mountDailyUnlock()
    const write = vi.spyOn(uniStorage, 'write')
    await wrapper.get('[data-testid="course-name"]').setValue('初稿')
    await wrapper.get('[data-testid="course-name"]').setValue('最终稿')
    expect(write.mock.calls.filter(call => call[0] === 'pianke:course-draft:v1')).toHaveLength(0)
    if (event === 'back') await wrapper.get('.daily-back').trigger('click')
    else lifecycle[event].mock.calls.forEach(call => call[0]())
    expect(uniStorage.read('pianke:course-draft:v1', null)).toMatchObject({ name: '最终稿' })
    await vi.advanceTimersByTimeAsync(500)
    expect(write.mock.calls.filter(call => call[0] === 'pianke:course-draft:v1')).toHaveLength(1)
    wrapper.unmount()
  })

  it('cancels a pending draft write after successful creation and never resurrects it', async () => {
    vi.useFakeTimers()
    const { wrapper, store } = mountDailyUnlock(store => { store.baiduVideos = [video('1', '第1集', '/apps/片刻/课/1')] })
    await wrapper.get('[data-folder-path="/apps/片刻/课"]').trigger('click')
    await wrapper.get('[data-testid="create-course"]').trigger('click')
    expect(store.dailyUnlockSettings.courses).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(500)
    lifecycle.onHide.mock.calls.forEach(call => call[0]())
    expect(uniStorage.read('pianke:course-draft:v1', null)).toBeNull()
    wrapper.unmount()
  })
  it.each(['folder', 'videos'])('removes missing draft episodes without changing remaining order or library in %s mode', async (selectionMode) => {
    uniStorage.write('pianke:course-draft:v1', { name: '可修复草稿', selectionMode, sourceFolderPath: '/apps/片刻', dailyEpisodeCount: 1, startEpisodeNumber: 1, episodes: ['2', 'missing1', '1', 'missing2'].map(id => ({ videoId: `baidu:${id}`, name: id, sourceType: 'baidu', path: `/apps/片刻/${id}` })) })
    const { wrapper, store } = mountDailyUnlock(store => { store.baiduVideos = [video('1', '1', '/apps/片刻/1'), video('2', '2', '/apps/片刻/2'), video('new', 'new', '/apps/片刻/new')] })
    await wrapper.get('[data-testid="restore-draft"]').trigger('click')
    await wrapper.get('[data-testid="remove-missing-draft-episode"][data-video-id="baidu:missing1"]').trigger('click')
    expect(wrapper.get('[data-testid="draft-missing-sources"]').text()).toContain('1 集')
    await wrapper.get('[data-testid="remove-all-missing-draft-episodes"]').trigger('click')
    expect(wrapper.find('[data-testid="draft-missing-sources"]').exists()).toBe(false)
    await wrapper.get('[data-testid="create-course"]').trigger('click')
    expect(store.dailyUnlockSettings.courses[0]?.episodes.map(e => e.videoId)).toEqual(['baidu:2', 'baidu:1'])
    expect(store.baiduVideos).toHaveLength(3)
    wrapper.unmount()
  })
  it('restores the exact folder selection without adding newly synced videos', async () => {
    uniStorage.write('pianke:course-draft:v1', { name: '快照', selectionMode: 'folder', sourceFolderPath: '/apps/片刻', dailyEpisodeCount: 1, startEpisodeNumber: 1, episodes: [{ videoId: 'baidu:1', name: '第1集', sourceType: 'baidu', path: '/apps/片刻/1' }] })
    const { wrapper, store } = mountDailyUnlock(store => { store.baiduVideos = [video('1', '第1集', '/apps/片刻/1'), video('2', '第2集', '/apps/片刻/2')] })
    await wrapper.get('[data-testid="restore-draft"]').trigger('click')
    expect(wrapper.get('[data-testid="episode-preview"]').text()).not.toContain('第2集')
    await wrapper.get('[data-testid="create-course"]').trigger('click')
    expect(store.dailyUnlockSettings.courses[0]?.episodes).toHaveLength(1)
    wrapper.unmount()
  })
  it('keeps missing restored videos visible and prevents creating a partial course', async () => {
    uniStorage.write('pianke:course-draft:v1', { name: '离线草稿', selectionMode: 'folder', sourceFolderPath: '/课', dailyEpisodeCount: 1, startEpisodeNumber: 1, episodes: [{ videoId: 'baidu:missing', name: '缺失集', sourceType: 'baidu', path: '/课/缺失集' }] })
    const { store, wrapper } = mountDailyUnlock()
    await wrapper.get('[data-testid="restore-draft"]').trigger('click')
    expect(wrapper.get('[data-testid="draft-missing-sources"]').text()).toContain('1 集')
    expect(wrapper.get('[data-testid="episode-preview"]').text()).toContain('缺失集')
    await wrapper.get('[data-testid="create-course"]').trigger('click')
    expect(store.dailyUnlockSettings.courses).toHaveLength(0)
    expect(wrapper.get('[role="alert"]').text()).toContain('来源不可用')
    wrapper.unmount()
  })

  it('persists folder order through repository reload and opens the first chosen episode', async () => {
    const { wrapper, store } = mountDailyUnlock(store => { store.baiduVideos = [video('1', '第1集', '/apps/片刻/课/1'), video('2', '第2集', '/apps/片刻/课/2')] })
    await wrapper.get('[data-folder-path="/apps/片刻/课"]').trigger('click')
    await wrapper.get('[data-move-down="baidu:1"]').trigger('click')
    await wrapper.get('[data-testid="create-course"]').trigger('click')
    const { DailyUnlockRepository } = await import('@/features/daily-unlock/dailyUnlockRepository')
    const { getTodayCourseEpisodes } = await import('@/features/daily-unlock/dailyUnlockPolicy')
    const course = new DailyUnlockRepository(uniStorage).load().courses[0]!
    expect(course.episodes.map(e => e.videoId)).toEqual(['baidu:2', 'baidu:1'])
    expect(getTodayCourseEpisodes(course, store.dailyUnlockNow).map(e => e.videoId)).toEqual(['baidu:2'])
    wrapper.unmount()
  })
  it('restores an autosaved ordered draft and clears it only after creating', async () => {
    const configure = (store: ReturnType<typeof useAppStore>) => { store.baiduVideos = [video('1', '第1集', '/apps/片刻/课/1'), video('2', '第2集', '/apps/片刻/课/2')] }
    const first = mountDailyUnlock(configure)
    await first.wrapper.get('[data-testid="mode-videos"]').trigger('click')
    await first.wrapper.get('[data-testid="course-name"]').setValue('草稿课程')
    await first.wrapper.get('[data-video-id="baidu:1"]').trigger('click')
    await first.wrapper.get('[data-video-id="baidu:2"]').trigger('click')
    await first.wrapper.get('.daily-selection-count').trigger('click')
    await first.wrapper.get('[data-move-up="baidu:2"]').trigger('click')
    await first.wrapper.get('[data-testid="daily-episode-count"]').setValue('2')
    await first.wrapper.get('[data-testid="start-episode-number"]').setValue('2')
    first.wrapper.unmount()
    const second = mountDailyUnlock(configure)
    expect(second.wrapper.get('[data-testid="draft-recovery"]').text()).toContain('草稿课程')
    await second.wrapper.get('[data-testid="restore-draft"]').trigger('click')
    expect((second.wrapper.get('[data-testid="start-episode-number"]').element as HTMLInputElement).value).toBe('2')
    await second.wrapper.get('[data-testid="create-course"]').trigger('click')
    expect(second.store.dailyUnlockSettings.courses[0]?.episodes.map(e => e.videoId)).toEqual(['baidu:2', 'baidu:1'])
    expect(uniStorage.read('pianke:course-draft:v1', null)).toBeNull()
    second.wrapper.unmount()
  })

  it('shows draft storage failure and lets users discard a previous draft', async () => {
    vi.useFakeTimers()
    const first = mountDailyUnlock()
    await first.wrapper.get('[data-testid="course-name"]').setValue('待丢弃')
    first.wrapper.unmount()
    const second = mountDailyUnlock()
    await second.wrapper.get('[data-testid="discard-draft"]').trigger('click')
    expect(uniStorage.read('pianke:course-draft:v1', null)).toBeNull()
    vi.spyOn(uni, 'setStorageSync').mockImplementation(() => { throw new Error('full') })
    await second.wrapper.get('[data-testid="course-name"]').setValue('保存失败的草稿')
    await vi.advanceTimersByTimeAsync(350)
    expect(second.wrapper.get('[data-testid="draft-status"]').text()).toContain('草稿保存失败')
    vi.mocked(uni.setStorageSync).mockRestore()
    await second.wrapper.get('[data-testid="retry-draft-save"]').trigger('click')
    expect(second.wrapper.get('[data-testid="draft-status"]').text()).toContain('草稿已自动保存')
    second.wrapper.unmount()
  })

  it('previews unchanged today and the new tomorrow rate before saving', async () => {
    const now = new Date(2026, 9, 28, 12).getTime()
    const { wrapper } = mountDailyUnlock(store => {
      store.dailyUnlockNow = now
      store.dailyUnlockSettings.courses = [{ id: 'preview', name: '课', createdAt: now, episodes: [1, 2, 3, 4].map(n => ({ videoId: `direct:${n}`, name: `第${n}集`, sourceType: 'direct' as const })) }]
    })
    await wrapper.get('[data-testid="course-more"]').trigger('click')
    await wrapper.get('[data-testid="edit-course"]').trigger('click')
    await wrapper.get('[data-testid="edit-course-count"]').setValue('2')
    expect(wrapper.get('[data-testid="edit-today-preview"]').text()).toContain('第1集')
    expect(wrapper.get('[data-testid="edit-tomorrow-preview"]').text()).toContain('第2集、第3集')
    wrapper.unmount()
  })
  it.each([true, false])('enables daily learning atomically only for the first-use guide: %s', async (guided) => {
    const { store, wrapper } = mountDailyUnlock((appStore) => {
      appStore.baiduVideos = [video('1', '第一集.mp4', '/apps/片刻/听力课/第一集.mp4')]
    })
    lifecycle.onLoad.mock.calls.at(-1)![0](guided ? { learningGuide: '1' } : {})
    await wrapper.get('[data-folder-path="/apps/片刻/听力课"]').trigger('click')
    await wrapper.get('[data-testid="create-course"]').trigger('click')
    expect(store.dailyUnlockSettings.courses).toHaveLength(1)
    expect(store.dailyUnlockSettings.enabled).toBe(guided)
    expect(uniStorage.read<{ enabled: boolean }>('pianke:daily-unlock:v1', { enabled: false }).enabled).toBe(guided)
    wrapper.unmount()
  })

  it('keeps first-use creation and enablement unchanged together when saving fails', async () => {
    const { store, wrapper } = mountDailyUnlock((appStore) => {
      appStore.baiduVideos = [video('1', '第一集.mp4', '/apps/片刻/听力课/第一集.mp4')]
    })
    lifecycle.onLoad.mock.calls.at(-1)![0]({ learningGuide: '1' })
    await wrapper.get('[data-folder-path="/apps/片刻/听力课"]').trigger('click')
    vi.spyOn(uni, 'setStorageSync').mockImplementation(() => { throw new Error('full') })
    await wrapper.get('[data-testid="create-course"]').trigger('click')
    expect(store.dailyUnlockSettings).toEqual({ enabled: false, courses: [] })
    expect(uniStorage.read('pianke:learning-guide:v1', null)).toBeNull()
    expect(wrapper.get('[role="alert"]').text()).toContain('课程保存失败')
    wrapper.unmount()
  })

  it('batch marks a chosen range including locked lessons and restores exact prior records', async () => {
    const { store, wrapper } = mountDailyUnlock((store) => {
      store.dailyUnlockSettings.courses = [{ id: 'batch', name: '补记课', createdAt: Date.now(), episodes: [1, 2, 3].map((n) => ({ videoId: `direct:${n}`, name: `第${n}集`, sourceType: 'direct' as const })) }]
      const repository = new ProgressRepository(uniStorage)
      repository.save('direct:2', 12, 60, Date.now() - 1000)
      store.progressHistory = repository.listHistory()
    })
    const before = JSON.parse(JSON.stringify(store.progressHistory))
    const plan = JSON.stringify(store.dailyUnlockSettings)
    expect(wrapper.find('[data-testid="batch-course"]').exists()).toBe(false)
    await wrapper.get('[data-testid="course-more"]').trigger('click')
    await wrapper.get('[data-testid="batch-course"]').trigger('click')
    expect(wrapper.get('[data-testid="batch-panel"]').text()).toContain('不改变开放安排或播放进度')
    await wrapper.get('[data-testid="batch-start"]').setValue('2')
    await wrapper.get('[data-testid="batch-end"]').setValue('3')
    await wrapper.get('[data-testid="batch-submit"]').trigger('click')
    expect(store.learningHistory.filter((item) => item.completed).map((item) => item.videoId).sort()).toEqual(['direct:2', 'direct:3'])
    expect(JSON.stringify(store.dailyUnlockSettings)).toBe(plan)
    await wrapper.get('[data-testid="batch-undo"]').trigger('click')
    expect(store.progressHistory).toEqual(before)
    expect(store.learningHistory.some((item) => item.completed)).toBe(false)
    expect(wrapper.find('[data-testid="batch-course-undo"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('keeps invalid and failed batch forms available and expires the undo after eight seconds', async () => {
    const { store, wrapper } = mountDailyUnlock((store) => {
      store.dailyUnlockSettings.courses = [{ id: 'batch', name: '补记课', createdAt: Date.now(), episodes: [{ videoId: 'direct:1', name: '第一集', sourceType: 'direct' }] }]
    })
    await wrapper.get('[data-testid="course-more"]').trigger('click')
    await wrapper.get('[data-testid="batch-course"]').trigger('click')
    await wrapper.get('[data-testid="batch-end"]').setValue('0')
    await wrapper.get('[data-testid="batch-submit"]').trigger('click')
    expect(wrapper.get('[data-testid="batch-panel"]').text()).toContain('有效的起止集数')
    await wrapper.get('[data-testid="batch-end"]').setValue('1')
    vi.spyOn(store, 'batchMarkCourseLearned').mockReturnValueOnce({ ok: false, reason: 'storage' })
    await wrapper.get('[data-testid="batch-submit"]').trigger('click')
    expect(wrapper.get('[data-testid="batch-panel"]').text()).toContain('保存失败')
    await wrapper.get('[data-testid="batch-submit"]').trigger('click')
    expect(wrapper.find('[data-testid="batch-course-undo"]').exists()).toBe(true)
    await vi.advanceTimersByTimeAsync(8000)
    expect(wrapper.find('[data-testid="batch-course-undo"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('previews paused backlog and tomorrow separately, supports cancel, and keeps failed resume retryable', async () => {
    const { store, wrapper } = mountDailyUnlock((store) => {
      store.dailyUnlockSettings.courses = [{ id: 'resume', name: '恢复课', createdAt: new Date(2026, 9, 20).getTime(), pausedAt: new Date(2026, 9, 20, 12).getTime(), dailyEpisodeCount: 5, episodes: Array.from({ length: 10 }, (_, n) => ({ videoId: `direct:${n}`, name: `第${n + 1}集`, sourceType: 'direct' as const })) }]
      store.progressHistory = [{ videoId: 'direct:0', positionSeconds: 60, durationSeconds: 60, completed: true, updatedAt: Date.now() }]
    })
    const original = JSON.stringify(store.dailyUnlockSettings)
    await wrapper.get('[data-testid="pause-course"]').trigger('click')
    const preview = wrapper.get('[data-testid="resume-preview"]')
    expect(preview.text()).toContain('今天可学未完成：4 集')
    expect(preview.text()).toContain('明天新开放：5 集')
    expect(preview.text()).toContain('第2集、第3集、第4集 等 4 集')
    expect(preview.text()).not.toContain('第10集')
    await wrapper.get('[data-testid="resume-cancel"]').trigger('click')
    expect(JSON.stringify(store.dailyUnlockSettings)).toBe(original)
    await wrapper.get('[data-testid="pause-course"]').trigger('click')
    vi.spyOn(store, 'updateDailyUnlockCourse').mockReturnValueOnce(false)
    await wrapper.get('[data-testid="resume-confirm"]').trigger('click')
    expect(wrapper.get('[data-testid="resume-preview"]').text()).toContain('保存失败')
    expect(JSON.stringify(store.dailyUnlockSettings)).toBe(original)
    await wrapper.get('[data-testid="resume-confirm"]').trigger('click')
    expect(store.dailyUnlockSettings.courses[0]?.pausedAt).toBeUndefined()
    expect(store.dailyUnlockSettings.courses[0]?.scheduleAnchorUnlockedCount).toBe(5)
    wrapper.unmount()
  })

  it('bounds large course episode rendering and finds courses beyond the first page', async () => {
    const { wrapper } = mountDailyUnlock((store) => {
      store.dailyUnlockSettings.courses = Array.from({ length: 60 }, (_, courseIndex) => ({
        id: `large-${courseIndex}`, name: `课程-${courseIndex}`, createdAt: Date.now(),
        episodes: Array.from({ length: 200 }, (_, index) => ({ videoId: `direct:${courseIndex}-${index}`, name: `第${index + 1}集`, sourceType: 'direct' as const }))
      }))
    })
    expect(wrapper.findAll('[data-testid="course-card"]')).toHaveLength(20)
    expect(wrapper.findAll('.daily-episode-link-row')).toHaveLength(0)
    await wrapper.get('[data-testid="courses-more"]').trigger('click')
    expect(wrapper.findAll('[data-testid="course-card"]')).toHaveLength(40)
    await wrapper.get('[data-testid="course-search"]').setValue('课程-59')
    expect(wrapper.findAll('[data-testid="course-card"]')).toHaveLength(1)
    await wrapper.get('[data-testid="course-episodes-toggle"]').trigger('click')
    expect(wrapper.findAll('.daily-episode-link-row')).toHaveLength(50)
    await wrapper.get('[data-testid="course-episodes-more"]').trigger('click')
    expect(wrapper.findAll('.daily-episode-link-row')).toHaveLength(100)
    await wrapper.get('[data-testid="course-episodes-toggle"]').trigger('click')
    expect(wrapper.findAll('.daily-episode-link-row')).toHaveLength(0)
    await wrapper.get('[data-testid="course-search"]').setValue('')
    expect(wrapper.findAll('[data-testid="course-card"]')).toHaveLength(20)
    wrapper.unmount()
  })

  it('pages a thousand selectable videos without losing selected entries across searches', async () => {
    const { wrapper } = mountDailyUnlock((store) => {
      store.baiduVideos = Array.from({ length: 2000 }, (_, index) => video(String(index), `第${index}集.mp4`, `/apps/片刻/大课/第${index}集.mp4`))
    })
    await wrapper.get('[data-testid="mode-videos"]').trigger('click')
    expect(wrapper.findAll('[data-testid="select-video"]')).toHaveLength(50)
    await wrapper.get('[data-video-id="baidu:0"]').trigger('click')
    await wrapper.get('[data-testid="videos-more"]').trigger('click')
    expect(wrapper.findAll('[data-testid="select-video"]')).toHaveLength(100)
    await wrapper.get('[data-testid="video-search"]').setValue('第1999集')
    expect(wrapper.findAll('[data-testid="select-video"]')).toHaveLength(1)
    await wrapper.get('[data-video-id="baidu:1999"]').trigger('click')
    expect(wrapper.get('.daily-selection-count').text()).toContain('已选 2 集')
    await wrapper.get('[data-testid="video-search"]').setValue('')
    expect(wrapper.findAll('[data-testid="select-video"]')).toHaveLength(50)
    expect(wrapper.get('[data-video-id="baidu:0"]').attributes('aria-pressed')).toBe('true')
    wrapper.unmount()
  })

  it('creates a plan from a later episode and previews only its planned range', async () => {
    const { store, wrapper } = mountDailyUnlock((store) => {
      store.baiduVideos = [1, 2, 3].map((id) => video(String(id), `第${id}集.mp4`, `/apps/片刻/课程/第${id}集.mp4`))
    })
    await wrapper.get('[data-folder-path="/apps/片刻/课程"]').trigger('click')
    await wrapper.get('[data-testid="start-episode-number"]').setValue('2')
    expect(wrapper.get('[data-testid="schedule-preview"]').text()).toContain('今天：第2集.mp4')
    expect(wrapper.get('[data-testid="schedule-preview"]').text()).not.toContain('第1集.mp4')
    await wrapper.get('[data-testid="create-course"]').trigger('click')
    expect(store.dailyUnlockSettings.courses[0]?.startEpisodeNumber).toBe(2)
    expect(wrapper.get('[data-testid="course-card"]').text()).toContain('已学完 0 / 2 集')
    wrapper.unmount()
  })

  it('combines name search with exclusive course status filters using planned learning completion', async () => {
    const { wrapper } = mountDailyUnlock((store) => {
      store.dailyUnlockSettings.courses = [0, 1, 2].map((index) => ({ id: `c${index}`, name: index === 2 ? '已完成英语' : `英语${index}`, createdAt: Date.now(), ...(index === 1 ? { pausedAt: Date.now() } : {}), ...(index === 2 ? { startEpisodeNumber: 2 } : {}), episodes: [{ videoId: `direct:${index}-a`, name: '第一集', sourceType: 'direct' }, { videoId: `direct:${index}-b`, name: '第二集', sourceType: 'direct' }] }))
      store.progressHistory = [{ videoId: 'direct:2-b', positionSeconds: 60, durationSeconds: 60, completed: true, updatedAt: Date.now() }]
    })
    expect(wrapper.findAll('[data-testid="course-card"]')).toHaveLength(3)
    await wrapper.get('[data-course-filter="learning"]').trigger('click')
    expect(wrapper.findAll('[data-testid="course-card"]')).toHaveLength(1)
    expect(wrapper.get('[data-testid="course-card"]').attributes('data-course-id')).toBe('c0')
    await wrapper.get('[data-course-filter="paused"]').trigger('click')
    expect(wrapper.get('[data-testid="course-card"]').attributes('data-course-id')).toBe('c1')
    await wrapper.get('[data-course-filter="completed"]').trigger('click')
    expect(wrapper.get('[data-testid="course-card"]').attributes('data-course-id')).toBe('c2')
    await wrapper.get('[data-testid="course-search"]').setValue('不存在')
    expect(wrapper.findAll('[data-testid="course-card"]')).toHaveLength(0)
    expect(wrapper.text()).toContain('没有匹配的课程')
    wrapper.unmount()
  })

  it('restores a deleted course through the timed undo without deleting video sources', async () => {
    const { store, wrapper } = mountDailyUnlock((store) => {
      store.baiduVideos = [video('1', '第一集.mp4', '/apps/片刻/第一集.mp4')]
      store.dailyUnlockSettings.courses = [{ id: 'undo', name: '可撤销课程', createdAt: Date.now(), episodes: [{ videoId: 'baidu:1', name: '第一集.mp4', sourceType: 'baidu', path: '/apps/片刻/第一集.mp4' }] }]
    })
    vi.mocked(uni.showModal).mockImplementation((options) => {
      options?.success?.({ confirm: true, cancel: false } as UniApp.ShowModalRes)
      return undefined as never
    })
    await wrapper.get('[data-testid="course-more"]').trigger('click')
    await wrapper.get('[data-testid="delete-course"]').trigger('click')
    expect(store.dailyUnlockSettings.courses).toHaveLength(0)
    expect(store.baiduVideos).toHaveLength(1)
    expect(uni.showModal).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('不删除视频、播放历史或学习记录') }))
    await wrapper.get('[data-testid="delete-course-undo"] button').trigger('click')
    expect(store.dailyUnlockSettings.courses[0]?.id).toBe('undo')
    await wrapper.get('[data-testid="course-more"]').trigger('click')
    await wrapper.get('[data-testid="delete-course"]').trigger('click')
    await vi.advanceTimersByTimeAsync(8000)
    expect(wrapper.find('[data-testid="delete-course-undo"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('offers replacement videos without exposing paths and preserves the picker on failure', async () => {
    const { store, wrapper } = mountDailyUnlock((store) => {
      store.baiduVideos = [video('new', '新视频.mp4', '/apps/片刻/新视频.mp4')]
      store.dailyUnlockSettings.courses = [{ id: 'replace', name: '待修复课程', createdAt: Date.now(), episodes: [{ videoId: 'direct:missing', name: '失效视频', sourceType: 'direct' }] }]
    })
    await wrapper.get('[data-testid="course-episodes-toggle"]').trigger('click')
    await wrapper.get('[data-relink-episode="direct:missing"]').trigger('click')
    await wrapper.get('[data-testid="relink-search"]').setValue('新视频')
    const relink = vi.spyOn(store, 'relinkDailyUnlockEpisode').mockReturnValueOnce(false).mockReturnValueOnce(true)
    await wrapper.get('[data-relink-video="baidu:new"]').trigger('click')
    expect(wrapper.get('[data-testid="episode-relink"]').text()).toContain('关联失败')
    expect(wrapper.get('[data-testid="episode-relink"]').html()).not.toContain('/apps/片刻/新视频.mp4')
    await wrapper.get('[data-relink-video="baidu:new"]').trigger('click')
    expect(relink).toHaveBeenCalledWith('replace', 'direct:missing', 'baidu:new')
    expect(wrapper.find('[data-testid="episode-relink"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('puts existing courses first and opens creation on demand without losing its draft', async () => {
    const { wrapper } = mountDailyUnlock((store) => {
      store.dailyUnlockSettings.courses = [{ id: 'existing', name: '已有计划', createdAt: Date.now(), episodes: [{ videoId: 'direct:1', name: '第一课', sourceType: 'direct' }] }]
    })
    expect(wrapper.find('.daily-create').exists()).toBe(false)
    expect(wrapper.get('.daily-content').element.firstElementChild?.classList.contains('daily-course-section')).toBe(true)
    await wrapper.get('[data-testid="new-course"]').trigger('click')
    await wrapper.get('[data-testid="course-name"]').setValue('稍后创建的计划')
    await wrapper.get('[data-testid="cancel-create-course"]').trigger('click')
    expect(wrapper.find('.daily-create').exists()).toBe(false)
    await wrapper.get('[data-testid="new-course"]').trigger('click')
    expect((wrapper.get('[data-testid="course-name"]').element as HTMLInputElement).value).toBe('稍后创建的计划')
  })

  it('uses the premium course shell without main navigation', () => {
    const { wrapper } = mountDailyUnlock()
    expect(wrapper.get('.daily-unlock-page').classes()).toContain('daily-unlock-page--premium')
    expect(wrapper.find('.bottom-nav').exists()).toBe(false)
  })

  it('dismisses course management back to the settings page', async () => {
    vi.stubGlobal('getCurrentPages', () => [{ route: 'pages/settings/index' }, { route: 'pages/daily-unlock/index' }])
    const { wrapper } = mountDailyUnlock()

    await wrapper.get('[aria-label="返回设置"]').trigger('click')

    expect(uni.navigateBack).toHaveBeenCalledWith({ animationType: 'slide-out-bottom' })
    expect(uni.redirectTo).not.toHaveBeenCalled()
  })

  it('returns directly opened course management to settings', async () => {
    vi.stubGlobal('getCurrentPages', () => [{ route: 'pages/daily-unlock/index' }])
    const { wrapper } = mountDailyUnlock()

    await wrapper.get('[aria-label="返回设置"]').trigger('click')

    expect(uni.redirectTo).toHaveBeenCalledWith({ url: '/pages/settings/index' })
    expect(uni.navigateBack).not.toHaveBeenCalled()
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
  it('previews several daily episodes and edits, pauses, and resumes an existing plan', async () => {
    const now = new Date(2026, 9, 27, 12).getTime()
    const { store, wrapper } = mountDailyUnlock((store) => {
      store.dailyUnlockNow = now
      store.baiduVideos = Array.from({ length: 4 }, (_, index) => video(String(index + 1), `第${index + 1}集.mp4`, `/apps/片刻/课程/第${index + 1}集.mp4`))
    })
    await wrapper.get('[data-folder-path="/apps/片刻/课程"]').trigger('click')
    await wrapper.get('[data-testid="daily-episode-count"]').setValue('2')
    expect(wrapper.get('[data-testid="schedule-preview"]').text()).toContain('今天：第1集.mp4、第2集.mp4')
    expect(wrapper.get('[data-testid="schedule-preview"]').text()).toContain('明天：第3集.mp4、第4集.mp4')
    await wrapper.get('[data-testid="create-course"]').trigger('click')
    expect(store.dailyUnlockSettings.courses[0]?.dailyEpisodeCount).toBe(2)
    expect(wrapper.find('.daily-create').exists()).toBe(false)
    expect(wrapper.find('[data-testid="new-course"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="course-card"]').text()).toContain('已学完 0 / 4 集')
    await wrapper.get('[data-testid="course-more"]').trigger('click')
    await wrapper.get('[data-testid="edit-course"]').trigger('click')
    await wrapper.get('[data-testid="edit-course-name"]').setValue('重新安排')
    await wrapper.get('[data-testid="edit-course-count"]').setValue('1')
    await wrapper.get('[data-testid="save-course"]').trigger('click')
    expect(store.dailyUnlockSettings.courses[0]).toMatchObject({ name: '重新安排', dailyEpisodeCount: 1, scheduleAnchorUnlockedCount: 2 })
    expect(wrapper.find('[data-testid="course-edit"]').exists()).toBe(false)
    await wrapper.get('[data-testid="pause-course"]').trigger('click')
    expect(store.dailyUnlockSettings.courses[0]?.pausedAt).toBe(now)
    expect(wrapper.get('[data-testid="course-card"]').text()).toContain('计划已暂停')
    await wrapper.get('[data-testid="pause-course"]').trigger('click')
    expect(wrapper.get('[data-testid="resume-preview"]').text()).toContain('明天新开放：1 集')
    expect(store.dailyUnlockSettings.courses[0]?.pausedAt).toBe(now)
    await wrapper.get('[data-testid="resume-confirm"]').trigger('click')
    expect(store.dailyUnlockSettings.courses[0]?.pausedAt).toBeUndefined()
    expect(wrapper.get('[data-testid="course-card"]').text()).toContain('下一集 2026-10-28 00:00 开放')
  })

  it('preserves edit inputs and reports a failed save', async () => {
    const { store, wrapper } = mountDailyUnlock((store) => {
      store.dailyUnlockSettings.courses = [{ id: 'c', name: '原课程', createdAt: Date.now(), episodes: [{ videoId: 'direct:1', name: '第一集', sourceType: 'direct' }] }]
    })
    await wrapper.get('[data-testid="course-more"]').trigger('click')
    await wrapper.get('[data-testid="edit-course"]').trigger('click')
    await wrapper.get('[data-testid="edit-course-name"]').setValue('新课程')
    vi.spyOn(store, 'updateDailyUnlockCourse').mockReturnValue(false)
    await wrapper.get('[data-testid="save-course"]').trigger('click')
    expect(wrapper.get('[data-testid="course-edit"]').text()).toContain('保存失败')
    expect(store.dailyUnlockSettings.courses[0]?.name).toBe('原课程')
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

    await wrapper.get('[data-testid="new-course"]').trigger('click')
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
    await wrapper.get('[data-testid="course-more"]').trigger('click')
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
