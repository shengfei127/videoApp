import { describe, expect, it } from 'vitest'
import { createMemoryStorage, type KeyValueStorage } from '@/infrastructure/storage'
import { LEARNING_TRANSACTION_KEY } from '@/infrastructure/learningTransaction'
import { ProgressRepository, PROGRESS_STORAGE_KEY, LEARNING_STORAGE_KEY } from '@/features/playback/progressRepository'
import { compactLearningStorage, inspectLearningStorage } from '@/features/playback/storageAudit'

const playback = { videoId: 'missing-source', positionSeconds: 20, durationSeconds: 100, completed: false, updatedAt: 1 }
const learned = { videoId: 'missing-source', completed: true, updatedAt: 2, durationSeconds: 100 }

describe('learning storage audit', () => {
  it('retains duplicate malformed objects and records stored under the wrong key', () => {
    const storage = createMemoryStorage()
    const brokenPlayback = [
      { videoId: 'x', completed: 'bad' },
      { ...playback, positionSeconds: -1 },
      { ...playback, positionSeconds: 101 },
      { ...playback, updatedAt: 'yesterday' },
      { ...playback, manualCompleted: 'bad' },
      learned
    ].flatMap((item) => [item, item])
    const brokenLearning = [
      { videoId: 'x', completed: 'bad' },
      { ...learned, durationSeconds: -1 },
      { ...learned, completed: 1 },
      { ...learned, updatedAt: null }
    ].flatMap((item) => [item, item])
    storage.write(PROGRESS_STORAGE_KEY, [...brokenPlayback, playback, playback])
    storage.write(LEARNING_STORAGE_KEY, [...brokenLearning, learned, learned])
    expect(inspectLearningStorage(storage).duplicateRecords).toBe(2)
    expect(compactLearningStorage(storage).removedRecords).toBe(2)
    expect(storage.read(PROGRESS_STORAGE_KEY, [])).toEqual([...brokenPlayback, playback])
    expect(storage.read(LEARNING_STORAGE_KEY, [])).toEqual([...brokenLearning, learned])
    expect(compactLearningStorage(storage).removedRecords).toBe(0)
  })

  it('removes exact duplicates while retaining differing records and their effective order', () => {
    const storage = createMemoryStorage()
    const differing = { ...playback, positionSeconds: 30 }
    storage.write(PROGRESS_STORAGE_KEY, [playback, differing, playback])
    storage.write(LEARNING_STORAGE_KEY, [learned, learned])
    const before = inspectLearningStorage(storage)
    expect(before).toMatchObject({ playbackRecords: 3, learningRecords: 2, duplicateRecords: 2 })
    const after = compactLearningStorage(storage)
    expect(after).toMatchObject({ playbackRecords: 2, learningRecords: 1, duplicateRecords: 0, removedRecords: 2 })
    expect(after.savedBytes).toBeGreaterThan(0)
    expect(after.bytes + after.savedBytes).toBe(before.bytes)
    expect(storage.read(PROGRESS_STORAGE_KEY, [])).toEqual([differing, playback])
  })

  it('preserves courses, authentication, unrelated keys and malformed data', () => {
    const storage = createMemoryStorage()
    const courses = { title: '课程😀', videos: ['missing-source'] }
    storage.write('pianke:daily-unlock:v1', courses)
    storage.write('auth', { token: 'test-only' })
    storage.write(PROGRESS_STORAGE_KEY, [null, null, playback, playback])
    storage.write(LEARNING_STORAGE_KEY, { invalid: true })
    compactLearningStorage(storage)
    expect(storage.read('pianke:daily-unlock:v1', null)).toEqual(courses)
    expect(storage.read('auth', null)).toEqual({ token: 'test-only' })
    expect(storage.read(PROGRESS_STORAGE_KEY, [])).toEqual([null, null, playback])
    expect(storage.read(LEARNING_STORAGE_KEY, null)).toEqual({ invalid: true })
    const expected = [courses, [null, null, playback], { invalid: true }].reduce((sum, value) => sum + Buffer.byteLength(JSON.stringify(value), 'utf8'), 0)
    expect(inspectLearningStorage(storage).bytes).toBe(expected)
  })

  it('does not write when clean or absent and is idempotent', () => {
    const memory = createMemoryStorage()
    let writes = 0
    const storage: KeyValueStorage = { ...memory, write(key, value) { writes++; memory.write(key, value) } }
    compactLearningStorage(storage)
    expect(writes).toBe(0)
    memory.write(PROGRESS_STORAGE_KEY, [playback, playback])
    compactLearningStorage(storage)
    writes = 0
    expect(compactLearningStorage(storage)).toMatchObject({ removedRecords: 0, savedBytes: 0 })
    expect(writes).toBe(0)
  })

  it('rolls back both arrays if a compaction write fails', () => {
    const memory = createMemoryStorage()
    memory.write(PROGRESS_STORAGE_KEY, [playback, playback])
    memory.write(LEARNING_STORAGE_KEY, [learned, learned])
    let fail = true
    const storage: KeyValueStorage = { ...memory, write(key, value) {
      if (key === LEARNING_STORAGE_KEY && fail) { fail = false; throw new Error('quota') }
      memory.write(key, value)
    } }
    expect(() => compactLearningStorage(storage)).toThrow('原学习数据已保留')
    expect(memory.read(PROGRESS_STORAGE_KEY, [])).toEqual([playback, playback])
    expect(memory.read(LEARNING_STORAGE_KEY, [])).toEqual([learned, learned])
    expect(memory.read(LEARNING_TRANSACTION_KEY, null)).toBeNull()
  })

  it('recovers a pending transaction before inspection', () => {
    const storage = createMemoryStorage()
    storage.write(PROGRESS_STORAGE_KEY, [])
    storage.write(LEARNING_TRANSACTION_KEY, { version: 1, originals: [{ key: PROGRESS_STORAGE_KEY, value: [playback] }] })
    expect(inspectLearningStorage(storage).playbackRecords).toBe(1)
    expect(storage.read(LEARNING_TRANSACTION_KEY, null)).toBeNull()
  })

  it('keeps repeated playback and learning updates bounded by video count', () => {
    const storage = createMemoryStorage()
    const repository = new ProgressRepository(storage)
    for (let iteration = 0; iteration < 300; iteration++) {
      const id = `video-${iteration % 3}`
      repository.save(id, iteration % 100, 100, iteration)
      repository.setCompleted(id, iteration % 2 === 0, iteration)
    }
    expect(inspectLearningStorage(storage)).toMatchObject({ playbackRecords: 3, learningRecords: 3, duplicateRecords: 0 })
    expect(compactLearningStorage(storage).removedRecords).toBe(0)
  })
})
