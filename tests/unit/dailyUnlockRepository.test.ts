import { describe, expect, it } from 'vitest'
import type { DailyUnlockCourse, DailyUnlockSettings } from '@/domain/video'

import {
  DAILY_UNLOCK_STORAGE_KEY,
  DailyUnlockRepository
} from '@/features/daily-unlock/dailyUnlockRepository'
import { createMemoryStorage } from '@/infrastructure/storage'

const validCourse: DailyUnlockCourse = {
  id: 'course-1',
  name: '入门课程',
  createdAt: 1_800_000_000_000,
  sourceFolderPath: '/apps/片刻/课程',
  episodes: [
    { videoId: 'baidu:1', name: '第1集.mp4', sourceType: 'baidu', path: '/apps/片刻/课程/第1集.mp4' },
    { videoId: 'direct:2', name: '第2集.mp4', sourceType: 'direct' }
  ]
}

describe('DailyUnlockRepository', () => {
  it('round trips a selected start date and keeps legacy courses without a date unchanged', () => {
    const storage = createMemoryStorage()
    const repository = new DailyUnlockRepository(storage)
    const course = { ...validCourse, startAt: new Date(2026, 10, 8).getTime() }
    repository.save({ enabled: true, courses: [course] })
    expect(repository.load().courses).toEqual([course])
    repository.save({ enabled: true, courses: [validCourse] })
    expect(repository.load().courses).toEqual([validCourse])
  })

  it.each([-1, NaN, Infinity, 8_640_000_000_000_001, 1.5, '2026-11-08', null])('rejects an invalid selected start timestamp (%s)', (startAt) => {
    const storage = createMemoryStorage()
    const repository = new DailyUnlockRepository(storage)
    const settings = { enabled: true, courses: [{ ...validCourse, startAt }] } as unknown as DailyUnlockSettings
    expect(() => repository.save(settings)).toThrow('每日课程信息无效')
    storage.write(DAILY_UNLOCK_STORAGE_KEY, settings)
    expect(repository.load().courses).toEqual([])
  })

  it('preserves start timestamps when restoring on a device in another timezone', () => {
    const storage = createMemoryStorage()
    const repository = new DailyUnlockRepository(storage)
    const course = { ...validCourse, startAt: Date.UTC(2026, 10, 8, 5) }
    repository.save({ enabled: true, courses: [course] })
    expect(repository.load().courses).toEqual([course])
  })

  it('persists scheduling changes and rejects incomplete or invalid schedule fields', () => {
    const storage = createMemoryStorage()
    const repository = new DailyUnlockRepository(storage)
    const course = { ...validCourse, dailyEpisodeCount: 2, pausedAt: validCourse.createdAt, scheduleAnchorAt: validCourse.createdAt, scheduleAnchorUnlockedCount: 2, scheduleAnchorTodayStart: 0 }
    repository.save({ enabled: true, courses: [course] })
    expect(repository.load().courses).toEqual([course])
    expect(() => repository.save({ enabled: true, courses: [{ ...course, dailyEpisodeCount: 0 }] })).toThrow()
    expect(() => repository.save({ enabled: true, courses: [{ ...course, scheduleAnchorTodayStart: 3 }] })).toThrow()
    expect(() => repository.save({ enabled: true, courses: [{ ...course, scheduleAnchorAt: undefined }] })).toThrow()
  })
  it('defaults to disabled with no courses and round-trips valid settings', () => {
    const storage = createMemoryStorage()
    const repository = new DailyUnlockRepository(storage)
    expect(repository.load()).toEqual({ enabled: false, courses: [] })

    const settings: DailyUnlockSettings = { enabled: true, courses: [validCourse] }
    repository.save(settings)
    expect(repository.load()).toEqual(settings)
  })

  it('falls back safely for malformed storage and preserves unrelated keys', () => {
    const storage = createMemoryStorage()
    storage.write('unrelated', { keep: true })
    storage.write(DAILY_UNLOCK_STORAGE_KEY, { enabled: 'yes', courses: 'bad' })
    const repository = new DailyUnlockRepository(storage)

    expect(repository.load()).toEqual({ enabled: false, courses: [] })
    expect(storage.read('unrelated', null)).toEqual({ keep: true })
  })

  it('drops a course whose creation date is outside the JavaScript date range', () => {
    const storage = createMemoryStorage()
    storage.write(DAILY_UNLOCK_STORAGE_KEY, {
      enabled: true,
      courses: [{ ...validCourse, createdAt: 8_640_000_000_000_001 }]
    })

    expect(new DailyUnlockRepository(storage).load()).toEqual({
      enabled: true,
      courses: []
    })
  })

  it('keeps valid unique courses while dropping malformed and overlapping courses', () => {
    const storage = createMemoryStorage()
    storage.write(DAILY_UNLOCK_STORAGE_KEY, {
      enabled: true,
      courses: [
        validCourse,
        { ...validCourse, id: 'duplicate-course-id' },
        {
          ...validCourse,
          id: 'invalid-episode',
          episodes: [{ ...validCourse.episodes[0], name: '' }]
        },
        {
          ...validCourse,
          id: 'duplicate-video-id',
          episodes: [{ ...validCourse.episodes[0], videoId: 'baidu:1' }]
        },
        { ...validCourse, id: 'valid-course-2', episodes: [{ videoId: 'baidu:3', name: '第3集.mp4', sourceType: 'baidu', path: '/apps/片刻/课程/第3集.mp4' }] }
      ]
    })
    const repository = new DailyUnlockRepository(storage)

    expect(repository.load()).toEqual({
      enabled: true,
      courses: [validCourse, { ...validCourse, id: 'valid-course-2', episodes: [{ videoId: 'baidu:3', name: '第3集.mp4', sourceType: 'baidu', path: '/apps/片刻/课程/第3集.mp4' }] }]
    })
  })
})
