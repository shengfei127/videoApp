import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import BackupPanel from '@/components/BackupPanel.vue'
import { exportLearningBackup } from '@/features/backup/learningBackup'
import { LEARNING_STORAGE_KEY } from '@/features/playback/progressRepository'
import { DAILY_UNLOCK_STORAGE_KEY } from '@/features/daily-unlock/dailyUnlockRepository'
import { createMemoryStorage, uniStorage } from '@/infrastructure/storage'
import { BACKUP_HISTORY_KEY } from '@/features/backup/backupHistory'

describe('BackupPanel', () => {
  it('regenerates copied backups and never reuses stale output after export failure', async () => {
    const clipboard = vi.fn((options) => options.success())
    Object.assign(uni, { setClipboardData: clipboard })
    const wrapper = mount(BackupPanel)
    await wrapper.get('[data-testid="backup-copy"]').trigger('click')
    expect(JSON.parse(clipboard.mock.calls[0]![0].data).learning).toEqual([])
    uniStorage.write(LEARNING_STORAGE_KEY, [{ videoId: 'direct:learned', completed: true, updatedAt: 100, durationSeconds: 0 }])
    await wrapper.get('[data-testid="backup-copy"]').trigger('click')
    expect(JSON.parse(clipboard.mock.calls[1]![0].data).learning).toHaveLength(1)
    uniStorage.write(DAILY_UNLOCK_STORAGE_KEY, { enabled: true, courses: [{ invalid: true }] })
    await wrapper.get('[data-testid="backup-copy"]').trigger('click')
    expect(clipboard).toHaveBeenCalledTimes(2)
    expect(wrapper.get('[role="alert"]').text()).toContain('备份内容无效')
    expect(wrapper.find('[data-testid="backup-export-text"]').exists()).toBe(false)
  })

  it('records a copy only after success and preserves the prior success on callback failure', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(new Date(2026, 9, 28, 8, 30).getTime())
    const clipboard = vi.fn()
    Object.assign(uni, { setClipboardData: clipboard })
    const wrapper = mount(BackupPanel)
    await wrapper.get('[data-testid="backup-copy"]').trigger('click')
    expect(wrapper.text()).toContain('尚未保存或复制')
    expect(uniStorage.read(BACKUP_HISTORY_KEY, null)).toBeNull()
    clipboard.mock.calls[0]![0].success()
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('尚未保存为文件')
    expect(wrapper.get('[data-testid="backup-history"]').text()).toContain('2026-10-28 08:30')
    const previous = uniStorage.read(BACKUP_HISTORY_KEY, null)
    await wrapper.get('[data-testid="backup-copy"]').trigger('click')
    clipboard.mock.calls[1]![0].fail()
    await wrapper.vm.$nextTick()
    expect(uniStorage.read(BACKUP_HISTORY_KEY, null)).toEqual(previous)
    expect(wrapper.get('[role="alert"]').text()).toContain('复制失败')
    wrapper.unmount()
    expect(mount(BackupPanel).get('[data-testid="backup-history"]').text()).toContain('上次成功复制')
  })

  it('describes H5 downloads as requested, never confirmed saved', async () => {
    vi.stubGlobal('plus', undefined)
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:backup')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const wrapper = mount(BackupPanel)
    await wrapper.get('[data-testid="backup-export"]').trigger('click')
    expect(click).toHaveBeenCalledOnce()
    expect(wrapper.text()).toContain('本页无法确认下载结果')
    expect(uniStorage.read<Record<string, unknown>>(BACKUP_HISTORY_KEY, {})).toHaveProperty('downloadRequestedAt')
    expect(uniStorage.read<Record<string, unknown>>(BACKUP_HISTORY_KEY, {})).not.toHaveProperty('savedAt')
  })

  it('verifies native file contents before recording successful save', async () => {
    let written = ''
    let corrupted = false
    const nativeFile = {
      toLocalURL: () => '_doc/learning-backups/test.json',
      file: (success: (file: unknown) => void) => success({}),
      createWriter: (success: (writer: any) => void) => {
        const writer = { onwrite: () => {}, onerror: () => {}, write: (value: string) => { written = value; writer.onwrite() } }
        success(writer)
      }
    }
    vi.stubGlobal('plus', { io: {
      PRIVATE_DOC: 1,
      requestFileSystem: (_type: number, success: (fs: unknown) => void) => success({ root: { getDirectory: (_name: string, _options: unknown, done: (dir: unknown) => void) => done({ getFile: (_file: string, _opts: unknown, finish: (file: unknown) => void) => finish(nativeFile) }) } }),
      FileReader: class { result = ''; onloadend = () => {}; onerror = () => {}; readAsText() { this.result = corrupted ? 'truncated' : written; this.onloadend() } }
    } })
    const wrapper = mount(BackupPanel)
    await wrapper.get('[data-testid="backup-export"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('文件已保存并校验内容')
    const previous = uniStorage.read(BACKUP_HISTORY_KEY, null)
    corrupted = true
    await wrapper.get('[data-testid="backup-export"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('文件保存失败')
    expect(wrapper.find('.backup-panel__path').exists()).toBe(false)
    expect(uniStorage.read(BACKUP_HISTORY_KEY, null)).toEqual(previous)
  })

  it('previews a complete backup, requires confirmation, and invalidates preview when text changes', async () => {
    const storage = createMemoryStorage()
    storage.write(LEARNING_STORAGE_KEY, [{ videoId: 'direct:learned', completed: true, updatedAt: 100, durationSeconds: 0 }])
    const text = exportLearningBackup(storage, 200)
    const wrapper = mount(BackupPanel)
    const input = wrapper.get('[data-testid="backup-import-text"]')
    expect(input.attributes('maxlength')).toBe('-1')
    await input.setValue(text)
    await wrapper.get('[data-testid="backup-inspect"]').trigger('click')
    expect(wrapper.get('[data-testid="backup-preview"]').text()).toContain('1 节已学完')
    expect(uniStorage.read(LEARNING_STORAGE_KEY, null)).toBeNull()
    await wrapper.get('[data-testid="backup-restore"]').trigger('click')
    expect(uni.showModal).toHaveBeenCalledOnce()
    const options = vi.mocked(uni.showModal).mock.calls[0]![0]!
    options.success?.({ confirm: false, cancel: true, errMsg: '' })
    expect(uniStorage.read(LEARNING_STORAGE_KEY, null)).toBeNull()
    await input.setValue('{}')
    expect(wrapper.find('[data-testid="backup-preview"]').exists()).toBe(false)
    await input.setValue(text)
    await wrapper.get('[data-testid="backup-inspect"]').trigger('click')
    await wrapper.get('[data-testid="backup-restore"]').trigger('click')
    const confirmed = vi.mocked(uni.showModal).mock.calls[1]![0]!
    confirmed.success?.({ confirm: true, cancel: false, errMsg: '' })
    await wrapper.vm.$nextTick()
    expect(uniStorage.read(LEARNING_STORAGE_KEY, [])).toHaveLength(1)
    expect(wrapper.emitted('restored')).toHaveLength(1)
    expect(wrapper.find('[data-testid="backup-preview"]').exists()).toBe(false)
  })
})
