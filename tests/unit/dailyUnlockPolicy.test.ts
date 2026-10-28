import { describe, expect, it } from 'vitest'

import {
  findCourseConflict,
  getTodayCourseEpisode,
  getTodayCourseEpisodes,
  getNextCourseUnlockAt,
  rescheduleDailyUnlockCourse,
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
  it('starts at the selected episode without scheduling earlier episodes', () => {
    const now = new Date(2026, 9, 28, 12).getTime()
    const plan = { ...course(now, 15), startEpisodeNumber: 11 }
    expect(getTodayCourseEpisodes(plan, now).map((episode) => episode.videoId)).toEqual(['video-11'])
    expect(getUnlockedEpisodeCount(plan, now)).toBe(11)
    expect(getVideoUnlockStatus({ enabled: true, courses: [plan] }, 'video-1', now).locked).toBe(false)
    expect(getVideoUnlockStatus({ enabled: true, courses: [plan] }, 'video-12', now).unlockAt).toBe(new Date(2026, 9, 29).getTime())
    expect(getTodayCourseEpisodes(plan, new Date(2026, 9, 29).getTime())[0]?.videoId).toBe('video-12')
    const changed = rescheduleDailyUnlockCourse(plan, { dailyEpisodeCount: 2 }, now)
    expect(getTodayCourseEpisodes(changed, now)[0]?.videoId).toBe('video-11')
    expect(getTodayCourseEpisodes(changed, new Date(2026, 9, 29).getTime()).map((episode) => episode.videoId)).toEqual(['video-12', 'video-13'])
  })
  it('supports several daily episodes and a partial final day', () => {
    const plan = { ...course(new Date(2026, 9, 27, 8).getTime(), 5), dailyEpisodeCount: 2 }
    expect(getTodayCourseEpisodes(plan, new Date(2026, 9, 27, 12).getTime()).map((item) => item.videoId)).toEqual(['video-1', 'video-2'])
    expect(getTodayCourseEpisodes(plan, new Date(2026, 9, 29).getTime()).map((item) => item.videoId)).toEqual(['video-5'])
    expect(getTodayCourseEpisodes(plan, new Date(2026, 9, 30).getTime())).toEqual([])
    expect(getNextCourseUnlockAt(plan, new Date(2026, 9, 27, 12).getTime())).toBe(new Date(2026, 9, 28).getTime())
  })

  it('changes the rate tomorrow without relocking released episodes or losing today lessons', () => {
    const now = new Date(2026, 9, 28, 12).getTime()
    const plan = { ...course(new Date(2026, 9, 27, 8).getTime(), 20), dailyEpisodeCount: 3 }
    const updated = rescheduleDailyUnlockCourse(plan, { dailyEpisodeCount: 1, name: ' 新名称 ' }, now)
    expect(updated.name).toBe('新名称')
    expect(getUnlockedEpisodeCount(updated, now)).toBe(6)
    expect(getTodayCourseEpisodes(updated, now).map((item) => item.videoId)).toEqual(['video-4', 'video-5', 'video-6'])
    expect(getTodayCourseEpisodes(updated, new Date(2026, 9, 29).getTime()).map((item) => item.videoId)).toEqual(['video-7'])
    expect(getVideoUnlockStatus({ enabled: true, courses: [updated] }, 'video-8', now).unlockAt).toBe(new Date(2026, 9, 30).getTime())
  })

  it('freezes a paused plan and resumes tomorrow without accumulating missed releases', () => {
    const now = new Date(2026, 9, 28, 12).getTime()
    const plan = course(new Date(2026, 9, 27, 8).getTime(), 10)
    const paused = rescheduleDailyUnlockCourse(plan, { paused: true }, now)
    const later = new Date(2026, 10, 5, 12).getTime()
    expect(getUnlockedEpisodeCount(paused, later)).toBe(2)
    expect(getTodayCourseEpisodes(paused, later)).toEqual([])
    expect(getNextCourseUnlockAt(paused, later)).toBeUndefined()
    expect(getVideoUnlockStatus({ enabled: true, courses: [paused] }, 'video-3', later)).toMatchObject({ locked: true })
    expect(getVideoUnlockStatus({ enabled: true, courses: [paused] }, 'video-3', later).unlockAt).toBeUndefined()
    const resumed = rescheduleDailyUnlockCourse(paused, { paused: false }, later)
    expect(getUnlockedEpisodeCount(resumed, later)).toBe(2)
    expect(getTodayCourseEpisodes(resumed, later)).toEqual([])
    expect(getNextCourseUnlockAt(resumed, later)).toBe(new Date(2026, 10, 6).getTime())
    expect(getTodayCourseEpisodes(resumed, new Date(2026, 10, 6).getTime())[0]?.videoId).toBe('video-3')
  })
  it('selects only the episode scheduled for the current local day', () => {
    const createdAt = new Date(2026, 9, 27, 23, 59).getTime()
    const plan = course(createdAt, 2)
    expect(getTodayCourseEpisode(plan, createdAt)?.videoId).toBe('video-1')
    expect(getTodayCourseEpisode(plan, new Date(2026, 9, 28).getTime())?.videoId).toBe('video-2')
    expect(getTodayCourseEpisode(plan, new Date(2026, 9, 29).getTime())).toBeUndefined()
    expect(getTodayCourseEpisode(plan, new Date(2026, 9, 26).getTime())).toBeUndefined()
    expect(getTodayCourseEpisode(plan, NaN)).toBeUndefined()
  })
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
