import { describe, expect, it } from 'vitest'

import {
  findCourseConflict,
  getUnlockedEpisodeCount,
  getVideoUnlockStatus,
  sortCourseEpisodes,
  snapshotCourseEpisodes
} from '@/features/daily-unlock/dailyUnlockPolicy'

function course(createdAt: number, episodes = 3) {
  return {
    id: 'course-1',
    name: '课程',
    createdAt,
    episodes: Array.from({ length: episodes }, (_, index) => ({
      videoId: `video-${index + 1}`,
      name: `第${index + 1}集.mp4`,
      sourceType: 'baidu' as const,
      path: `/课程/第${index + 1}集.mp4`
    }))
  }
}

describe('dailyUnlockPolicy', () => {
  it('unlocks the first episode on creation day and the next at local midnight', () => {
    const createdAt = new Date(2026, 9, 27, 9, 30).getTime()
    const settings = { enabled: true, courses: [course(createdAt)] }
    const secondRelease = new Date(2026, 9, 28, 0, 0).getTime()

    expect(getUnlockedEpisodeCount(course(createdAt), createdAt)).toBe(1)
    expect(getVideoUnlockStatus(settings, 'video-1', createdAt)).toMatchObject({
      locked: false,
      episodeNumber: 1,
      unlockedCount: 1
    })
    expect(getVideoUnlockStatus(settings, 'video-2', createdAt)).toMatchObject({
      locked: true,
      episodeNumber: 2,
      unlockAt: secondRelease
    })
  })

  it.each([
    [new Date(2026, 1, 28, 23, 59).getTime(), new Date(2026, 2, 1, 0, 0).getTime()],
    [new Date(2026, 11, 31, 23, 59).getTime(), new Date(2027, 0, 1, 0, 0).getTime()]
  ])('counts calendar-day unlocks across date boundary %s -> %s', (createdAt, nextDay) => {
    expect(getUnlockedEpisodeCount(course(createdAt), nextDay)).toBe(2)
  })

  it('uses local calendar days across a daylight-saving transition', () => {
    const originalTimezone = process.env.TZ
    process.env.TZ = 'America/New_York'
    try {
      const createdAt = new Date(2026, 2, 7, 23, 59).getTime()
      const afterMidnight = new Date(2026, 2, 9, 0, 0).getTime()
      expect(afterMidnight - createdAt).toBe(24 * 60 * 60 * 1000 + 60 * 1000)
      expect(getUnlockedEpisodeCount(course(createdAt), afterMidnight)).toBe(3)
    } finally {
      if (originalTimezone === undefined) delete process.env.TZ
      else process.env.TZ = originalTimezone
    }
  })

  it('accumulates missed days without exceeding the course length', () => {
    const createdAt = new Date(2026, 9, 1, 12).getTime()
    expect(getUnlockedEpisodeCount(course(createdAt), new Date(2026, 9, 4).getTime())).toBe(3)
    expect(getUnlockedEpisodeCount(course(createdAt, 2), new Date(2026, 9, 4).getTime())).toBe(2)
    expect(getUnlockedEpisodeCount(course(createdAt), new Date(2026, 8, 30).getTime())).toBe(0)
  })

  it('bypasses locks when disabled and leaves unrelated videos unrestricted', () => {
    const createdAt = new Date(2026, 9, 27).getTime()
    expect(getVideoUnlockStatus({ enabled: false, courses: [course(createdAt)] }, 'video-2', createdAt))
      .toMatchObject({ locked: false, episodeNumber: 2, unlockedCount: 1 })
    expect(getVideoUnlockStatus({ enabled: true, courses: [course(createdAt)] }, 'other', createdAt))
      .toEqual({ locked: false })
  })

  it('sorts course videos naturally with stable path and id ties', () => {
    const videos = [
      { id: 'b', name: '第10集.mp4', path: '/课/第10集.mp4' },
      { id: 'same-b', name: '补充.mp4', path: '/课/b/补充.mp4' },
      { id: 'same-a', name: '补充.mp4', path: '/课/a/补充.mp4' },
      { id: 'a', name: '第2集.mp4', path: '/课/第2集.mp4' }
    ]
    expect(sortCourseEpisodes(videos).map(({ id }) => id)).toEqual([
      'same-a', 'same-b', 'a', 'b'
    ])
  })

  it('does not copy a direct media URL into a course snapshot', () => {
    const snapshots = snapshotCourseEpisodes([{
      id: 'direct:private', sourceId: 'private', sourceType: 'direct',
      name: '私有视频', path: 'https://media.example.test/video.m3u8?token=signed'
    }])
    expect(snapshots).toEqual([{ videoId: 'direct:private', name: '私有视频', sourceType: 'direct' }])
    expect(JSON.stringify(snapshots)).not.toContain('media.example.test')
  })

  it('detects a video already assigned to another course', () => {
    const courses = [course(1000)]
    expect(findCourseConflict(courses, ['video-2', 'new-video'])?.id).toBe('course-1')
    expect(findCourseConflict(courses, ['new-video'])).toBeUndefined()
  })
})
