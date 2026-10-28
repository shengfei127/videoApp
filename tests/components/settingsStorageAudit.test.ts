import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it, vi } from 'vitest'
import SettingsPage from '@/pages/settings/index.vue'
import { useAppStore } from '@/stores/appStore'
import { PROGRESS_STORAGE_KEY, LEARNING_STORAGE_KEY } from '@/features/playback/progressRepository'
import { uniStorage } from '@/infrastructure/storage'

vi.mock('@dcloudio/uni-app', () => ({ onShow: vi.fn(), onHide: vi.fn(), onUnload: vi.fn() }))

function mountSettings() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useAppStore(pinia)
  return { store, wrapper: mount(SettingsPage, { global: { plugins: [pinia] } }) }
}

describe('Settings storage audit', () => {
  it('inspects on demand and removes only exact duplicates while preserving older distinct history', async () => {
    const old = { videoId: 'direct:old', positionSeconds: 5, durationSeconds: 60, completed: false, updatedAt: 1 }
    const recent = { ...old, videoId: 'direct:new', updatedAt: Date.now() }
    const learning = { videoId: 'direct:learned', completed: true, durationSeconds: 60, updatedAt: 1 }
    uniStorage.write(PROGRESS_STORAGE_KEY, [old, recent, recent])
    uniStorage.write(LEARNING_STORAGE_KEY, [learning, learning])
    const { store, wrapper } = mountSettings()
    const inspect = vi.spyOn(store, 'inspectLearningStorage')
    expect(inspect).not.toHaveBeenCalled()
    await wrapper.get('[data-testid="settings-local"]').trigger('click')
    expect(inspect).toHaveBeenCalledOnce()
    expect(wrapper.get('[data-testid="storage-audit"]').text()).toContain('播放记录 3 条 · 学习记录 2 条')
    expect(wrapper.get('[data-testid="storage-audit"]').text()).toContain('完全重复 2 条')
    await wrapper.get('[data-testid="storage-compact"]').trigger('click')
    expect(uniStorage.read(PROGRESS_STORAGE_KEY, [])).toEqual([old, recent])
    expect(uniStorage.read(LEARNING_STORAGE_KEY, [])).toEqual([learning])
    expect(wrapper.get('[data-testid="storage-audit-result"]').text()).toContain('已清理 2 条完全重复记录')
    expect(wrapper.get('[data-testid="storage-audit-result"]').text()).toContain('学习状态和播放历史已保留')
    expect(wrapper.find('[data-testid="storage-compact"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('reports read and compaction failures without claiming successful cleanup and allows retry', async () => {
    const { store, wrapper } = mountSettings()
    vi.spyOn(store, 'inspectLearningStorage').mockReturnValueOnce(null).mockReturnValue({ playbackRecords: 2, learningRecords: 0, duplicateRecords: 1, bytes: 2048 })
    await wrapper.get('[data-testid="settings-local"]').trigger('click')
    expect(wrapper.get('[data-testid="storage-audit"]').text()).toContain('读取存储信息失败')
    await wrapper.get('[data-testid="storage-inspect"]').trigger('click')
    expect(wrapper.get('[data-testid="storage-audit"]').text()).toContain('2.0 KB')
    vi.spyOn(store, 'compactLearningStorage').mockReturnValueOnce(null).mockReturnValueOnce({ playbackRecords: 1, learningRecords: 0, duplicateRecords: 0, bytes: 1024, removedRecords: 1, savedBytes: 1024 })
    await wrapper.get('[data-testid="storage-compact"]').trigger('click')
    expect(wrapper.get('[data-testid="storage-audit"]').text()).toContain('整理失败')
    expect(wrapper.find('[data-testid="storage-audit-result"]').exists()).toBe(false)
    await wrapper.get('[data-testid="storage-compact"]').trigger('click')
    expect(wrapper.get('[data-testid="storage-audit-result"]').text()).toContain('节省 1.0 KB')
    wrapper.unmount()
  })
})
