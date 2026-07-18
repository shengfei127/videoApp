import { describe, expect, it } from 'vitest'

import type { PlaybackProgress } from '@/domain/video'
import { ProgressRepository, PROGRESS_STORAGE_KEY } from '@/features/playback/progressRepository'
import { createMemoryStorage, uniStorage } from '@/infrastructure/storage'

describe('ProgressRepository', () => {
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
