import { describe, expect, it } from 'vitest'

import type { PlaybackProgress } from '@/domain/video'
import { ProgressRepository, PROGRESS_STORAGE_KEY, LEARNING_STORAGE_KEY } from '@/features/playback/progressRepository'
import { createMemoryStorage, uniStorage } from '@/infrastructure/storage'

describe('ProgressRepository', () => {
  it('batches learning without changing playback and restores prior true, false and absent statuses', () => {
    const storage = createMemoryStorage()
    const repository = new ProgressRepository(storage)
    repository.save('a', 30, 600, 10)
    repository.setCompleted('a', false, 20)
    repository.setCompleted('b', true, 20)
    const before = storage.read(LEARNING_STORAGE_KEY, [])
    const playback = storage.read(PROGRESS_STORAGE_KEY, [])
    const token = repository.batchSetCompleted(['a', 'b', 'c'], 30)
    expect(['a', 'b', 'c'].map((id) => repository.get(id)?.completed)).toEqual([true, true, true])
    expect(storage.read(PROGRESS_STORAGE_KEY, [])).toEqual(playback)
    expect(repository.undoBatchCompleted(token)).toBe(true)
    expect(storage.read(LEARNING_STORAGE_KEY, [])).toEqual(before)
    expect(repository.get('c')).toBeUndefined()
    expect(repository.undoBatchCompleted(token)).toBe(false)
  })

  it('refuses stale undo after playback or manual learning changes and preserves unrelated edits', () => {
    const storage = createMemoryStorage()
    const repository = new ProgressRepository(storage)
    let token = repository.batchSetCompleted(['a'], 30)
    repository.save('a', 10, 600, 30)
    expect(repository.undoBatchCompleted(token)).toBe(false)
    token = repository.batchSetCompleted(['a'], 40)
    repository.setCompleted('a', false, 40)
    expect(repository.undoBatchCompleted(token)).toBe(false)
    token = repository.batchSetCompleted(['a'], 50)
    repository.setCompleted('other', true, 60)
    expect(repository.undoBatchCompleted(token)).toBe(true)
    expect(repository.get('other')?.completed).toBe(true)
    const old = repository.batchSetCompleted(['a'], 70)
    repository.batchSetCompleted(['b'], 80)
    expect(repository.undoBatchCompleted(old)).toBe(false)
  })

  it('rolls back failed batch and undo writes, keeping a failed undo retryable', () => {
    const memory = createMemoryStorage()
    let fail = false
    const storage = { ...memory, write<T>(key: string, value: T) {
      memory.write(key, value)
      if (fail && key === LEARNING_STORAGE_KEY) { fail = false; throw new Error('disk') }
    } }
    const repository = new ProgressRepository(storage)
    repository.setCompleted('a', false, 10)
    const before = memory.read(LEARNING_STORAGE_KEY, [])
    fail = true
    expect(() => repository.batchSetCompleted(['a', 'b'], 20)).toThrow()
    expect(memory.read(LEARNING_STORAGE_KEY, [])).toEqual(before)
    const token = repository.batchSetCompleted(['a', 'b'], 30)
    fail = true
    expect(() => repository.undoBatchCompleted(token)).toThrow()
    expect(repository.get('b')?.completed).toBe(true)
    expect(repository.undoBatchCompleted(token)).toBe(true)
    expect(memory.read(LEARNING_STORAGE_KEY, [])).toEqual(before)
  })

  it('keeps repeated playback and learning writes bounded per video', () => {
    const storage = createMemoryStorage()
    const repository = new ProgressRepository(storage)
    for (let index = 1; index <= 200; index++) {
      repository.save('a', index, 600, index * 2)
      repository.setCompleted('a', index % 2 === 0, index * 2 + 1)
      const token = repository.batchSetCompleted(['a', 'b'], index * 2 + 1)
      repository.undoBatchCompleted(token)
    }
    expect(storage.read<unknown[]>(PROGRESS_STORAGE_KEY, [])).toHaveLength(1)
    expect(storage.read<unknown[]>(LEARNING_STORAGE_KEY, [])).toHaveLength(1)
    expect(repository.inspectStorage().duplicateRecords).toBe(0)
  })
  it('moves learning and playback together and restores originals if course persistence fails', () => {
    const storage = createMemoryStorage()
    const repository = new ProgressRepository(storage)
    repository.save('old', 120, 600, 1000)
    repository.setCompleted('old', true, 2000)
    expect(() => repository.relinkVideo('old', 'new', () => { throw new Error('course storage') })).toThrow('原学习数据已保留')
    expect(repository.get('old')).toMatchObject({ positionSeconds: 120, completed: true, updatedAt: 1000 })
    expect(repository.get('new')).toBeUndefined()
    repository.relinkVideo('old', 'new', () => {})
    expect(repository.get('old')).toBeUndefined()
    expect(repository.get('new')).toMatchObject({ positionSeconds: 120, completed: true, updatedAt: 1000 })
    repository.save('occupied', 30, 600, 2500)
    expect(() => repository.relinkVideo('new', 'occupied', () => {})).toThrow()
    expect(repository.get('new')?.completed).toBe(true)
  })
  it('keeps manual learning separate from playback history and preserves watch ordering', () => {
    const storage = createMemoryStorage()
    const repository = new ProgressRepository(storage)
    repository.save('older', 100, 600, 1000)
    repository.save('newer', 200, 600, 2000)
    repository.setCompleted('older', true, 4000)
    repository.setCompleted('unwatched', true, 5000, 900)
    const restored = new ProgressRepository(storage)
    expect(restored.listHistory().map((item) => [item.videoId, item.updatedAt])).toEqual([['newer', 2000], ['older', 1000]])
    expect(restored.listLearningHistory().find((item) => item.videoId === 'unwatched')?.completed).toBe(true)
    restored.setCompleted('older', false, 6000)
    expect(restored.listHistory()[1]).toMatchObject({ videoId: 'older', updatedAt: 1000, completed: false })
    restored.clear()
    expect(restored.listHistory()).toEqual([])
    expect(restored.get('unwatched')?.completed).toBe(true)
  })

  it('keeps legacy manual-only records as learning rather than synthetic watch events', () => {
    const storage = createMemoryStorage()
    storage.write(PROGRESS_STORAGE_KEY, [
      { videoId: 'manual-only', positionSeconds: 0, durationSeconds: 600, updatedAt: 1000, completed: true, manualCompleted: true },
      { videoId: 'actually-watched', positionSeconds: 120, durationSeconds: 600, updatedAt: 900, completed: true, manualCompleted: true }
    ])
    const repository = new ProgressRepository(storage)
    expect(repository.listHistory().map((item) => item.videoId)).toEqual(['actually-watched'])
    expect(repository.listLearningHistory()).toHaveLength(2)
    repository.clear()
    expect(repository.get('manual-only')?.completed).toBe(true)
    expect(repository.listHistory()).toEqual([])
  })

  it('retains automatically completed learning during review until explicitly undone', () => {
    const repository = new ProgressRepository(createMemoryStorage())
    repository.save('lesson', 600, 600, 1000)
    repository.save('lesson', 40, 600, 2000)
    expect(repository.get('lesson')).toMatchObject({ completed: true, positionSeconds: 40 })
    expect(repository.listResumable()).toEqual([])
    repository.setCompleted('lesson', false, 3000)
    repository.save('lesson', 120, 600, 4000)
    expect(repository.get('lesson')).toMatchObject({ completed: false, positionSeconds: 120 })
    expect(repository.listResumable()).toHaveLength(1)
    repository.save('lesson', 600, 600, 5000)
    expect(repository.get('lesson')?.completed).toBe(true)
  })

  it('persists manual completion without inventing duration and supports undo', () => {
    const storage = createMemoryStorage()
    const repository = new ProgressRepository(storage)
    repository.setCompleted('unknown-duration', true, 1000)
    expect(new ProgressRepository(storage).get('unknown-duration')).toMatchObject({ completed: true, manualCompleted: true, durationSeconds: 0, positionSeconds: 0 })
    expect(repository.listResumable()).toEqual([])
    repository.setCompleted('unknown-duration', false, 2000)
    expect(repository.get('unknown-duration')).toMatchObject({ completed: false, durationSeconds: 0 })
  })

  it('preserves actual position on completion, excludes learned video from resume, and retains completion on review', () => {
    const repository = new ProgressRepository(createMemoryStorage())
    repository.save('lesson', 120, 600, 1000)
    repository.setCompleted('lesson', true, 2000)
    expect(repository.get('lesson')).toMatchObject({ positionSeconds: 120, durationSeconds: 600, completed: true })
    expect(repository.listResumable()).toEqual([])
    repository.save('lesson', 180, 600, 3000)
    expect(repository.get('lesson')).toMatchObject({ completed: true, positionSeconds: 180 })
    repository.setCompleted('lesson', false, 4000)
    expect(repository.listResumable()).toHaveLength(1)
  })

  it('keeps completed progress in history but excludes it from resumable results', () => {
    const repository = new ProgressRepository(createMemoryStorage())

    repository.save('video-1', 590, 600, 1000)

    expect(repository.get('video-1')).toEqual({
      videoId: 'video-1',
      positionSeconds: 590,
      durationSeconds: 600,
      updatedAt: 1000,
      completed: true
    })
    expect(repository.listHistory()).toHaveLength(1)
    expect(repository.listResumable()).toEqual([])
  })

  it('rounds seconds and clamps positions within the duration', () => {
    const repository = new ProgressRepository(createMemoryStorage())

    repository.save('video-1', -4.7, 600.4, 1000)
    expect(repository.get('video-1')).toMatchObject({
      positionSeconds: 0,
      durationSeconds: 600
    })

    repository.save('video-1', 600.6, 599.5, 1001)
    expect(repository.get('video-1')).toMatchObject({
      positionSeconds: 600,
      durationSeconds: 600
    })
  })

  it('does not expose progress that fails the resume policy', () => {
    const repository = new ProgressRepository(createMemoryStorage())

    repository.save('too-early', 29, 600, 1000)
    repository.save('resumable', 120, 600, 1001)

    expect(repository.listResumable().map((progress) => progress.videoId)).toEqual([
      'resumable'
    ])
  })

  it('lists history in descending updatedAt order', () => {
    const repository = new ProgressRepository(createMemoryStorage())

    repository.save('oldest', 120, 600, 1000)
    repository.save('newest', 120, 600, 3000)
    repository.save('middle', 120, 600, 2000)

    expect(repository.listHistory().map((progress) => progress.videoId)).toEqual([
      'newest',
      'middle',
      'oldest'
    ])
  })

  it('removes only the requested video progress', () => {
    const repository = new ProgressRepository(createMemoryStorage())

    repository.save('keep', 120, 600, 1000)
    repository.save('remove', 180, 600, 1001)
    repository.remove('remove')

    expect(repository.get('remove')).toBeUndefined()
    expect(repository.get('keep')).toMatchObject({ videoId: 'keep' })
  })

  it('clears only the progress storage key', () => {
    const repository = new ProgressRepository(uniStorage)
    uni.setStorageSync('unrelated', JSON.stringify({ preserved: true }))
    repository.save('video-1', 120, 600, 1000)

    repository.clear()

    expect(uni.getStorageSync(PROGRESS_STORAGE_KEY)).toBeUndefined()
    expect(uniStorage.read('unrelated', null)).toEqual({ preserved: true })
  })

  it('ignores malformed stored records without changing unrelated values', () => {
    const storage = createMemoryStorage()
    const validProgress: PlaybackProgress = {
      videoId: 'valid',
      positionSeconds: 120,
      durationSeconds: 600,
      updatedAt: 1000,
      completed: false
    }
    storage.write(PROGRESS_STORAGE_KEY, [
      validProgress,
      null,
      {
        videoId: 'invalid-position',
        positionSeconds: '120',
        durationSeconds: 600,
        updatedAt: 1000,
        completed: false
      },
      {
        videoId: 'outside-duration',
        positionSeconds: 601,
        durationSeconds: 600,
        updatedAt: 1000,
        completed: false
      }
    ])
    storage.write('unrelated', { preserved: true })
    const repository = new ProgressRepository(storage)

    expect(() => repository.listHistory()).not.toThrow()
    expect(repository.listHistory()).toEqual([validProgress])
    expect(repository.listResumable()).toEqual([validProgress])
    expect(storage.read('unrelated', null)).toEqual({ preserved: true })

    storage.write(PROGRESS_STORAGE_KEY, { not: 'an array' })
    expect(repository.listHistory()).toEqual([])
    expect(storage.read('unrelated', null)).toEqual({ preserved: true })
  })
})
