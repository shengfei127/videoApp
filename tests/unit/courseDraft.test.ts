import { describe, expect, it, vi } from 'vitest'
import { createDraftSaveQueue } from '@/features/daily-unlock/courseDraft'
import { COURSE_DRAFT_KEY, clearCourseDraft, readCourseDraft, saveCourseDraft, type CourseDraft } from '@/features/daily-unlock/courseDraft'
import { createMemoryStorage } from '@/infrastructure/storage'

const draft: CourseDraft = {
  name: '我的课程', selectionMode: 'videos', sourceFolderPath: '',
  dailyEpisodeCount: '', startEpisodeNumber: '2',
  episodes: [
    { videoId: 'direct:2', name: '第2集', sourceType: 'direct' },
    { videoId: 'baidu:1', name: '第1集', sourceType: 'baidu', path: '/apps/课程/第1集.mp4' }
  ]
}

describe('course drafts', () => {
  it('coalesces writes, flushes the latest state immediately, and cancels obsolete saves', () => {
    vi.useFakeTimers()
    try {
      let name = 'first'
      const saved: string[] = []
      const queue = createDraftSaveQueue(() => { saved.push(name); return true })
      queue.schedule()
      name = 'latest'
      queue.schedule()
      vi.advanceTimersByTime(349)
      expect(saved).toEqual([])
      queue.flush()
      expect(saved).toEqual(['latest'])
      queue.schedule()
      queue.cancel()
      vi.advanceTimersByTime(500)
      queue.flush()
      expect(saved).toEqual(['latest'])
    } finally { vi.useRealTimers() }
  })

  it('retains failed writes for explicit retry or the next leave lifecycle', () => {
    vi.useFakeTimers()
    try {
      const save = vi.fn().mockReturnValueOnce(false).mockReturnValue(true)
      const queue = createDraftSaveQueue(save)
      queue.schedule()
      vi.advanceTimersByTime(350)
      expect(save).toHaveBeenCalledTimes(1)
      queue.flush()
      queue.flush()
      expect(save).toHaveBeenCalledTimes(2)
    } finally { vi.useRealTimers() }
  })
  it('round-trips incomplete fields and the chosen episode order, then clears only its own key', () => {
    const storage = createMemoryStorage()
    storage.write('other', 1)
    expect(readCourseDraft(storage)).toBeUndefined()
    saveCourseDraft(storage, draft)
    expect(readCourseDraft(storage)).toEqual(draft)
    clearCourseDraft(storage)
    expect(readCourseDraft(storage)).toBeUndefined()
    expect(storage.read('other', 0)).toBe(1)
  })

  it('whitelists metadata and strips direct URLs and credentials', () => {
    const storage = createMemoryStorage()
    const unsafe = { ...draft, accessToken: 'secret', episodes: [{ ...draft.episodes[0]!, path: 'https://media.test/signed?token=secret', url: 'https://media.test', password: 'secret' }, draft.episodes[1]!] }
    saveCourseDraft(storage, unsafe)
    expect(readCourseDraft(storage)).toEqual(draft)
    expect(JSON.stringify(storage.read(COURSE_DRAFT_KEY, null))).not.toContain('secret')
  })

  it.each([null, {}, { ...draft, selectionMode: 'unknown' }, { ...draft, sourceFolderPath: '//secret.test/file' }, { ...draft, episodes: [{ ...draft.episodes[1], path: '/file?token=secret' }] }, { ...draft, episodes: [draft.episodes[0], draft.episodes[0]] }, { ...draft, name: 'a'.repeat(81) }, { ...draft, dailyEpisodeCount: 'x'.repeat(33) }, { ...draft, episodes: Array.from({ length: 501 }, (_, n) => ({ ...draft.episodes[0], videoId: `direct:${n}` })) }])('rejects malformed or oversized saved data', (value) => {
    const storage = createMemoryStorage()
    storage.write(COURSE_DRAFT_KEY, value)
    expect(readCourseDraft(storage)).toBeUndefined()
  })

  it('propagates storage failures so the page can report them', () => {
    const storage = createMemoryStorage()
    storage.write = () => { throw new Error('full') }
    storage.remove = () => { throw new Error('full') }
    expect(() => saveCourseDraft(storage, draft)).toThrow('full')
    expect(() => clearCourseDraft(storage)).toThrow('full')
  })
})
