import { describe, expect, it } from 'vitest'
import { buildSync } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { formatCourseDate, getCourseStartAt, hasCourseStarted, parseCourseDate } from '@/features/daily-unlock/courseScheduleDate'

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
  it('waits for the selected start date and releases at local midnight', () => {
    const createdAt = new Date(2026, 10, 3, 12).getTime()
    const startAt = new Date(2026, 10, 6).getTime()
    const plan = { ...course(createdAt, 8), startAt, dailyEpisodeCount: 2 }
    expect(getUnlockedEpisodeCount(plan, createdAt)).toBe(0)
    expect(getTodayCourseEpisodes(plan, startAt - 1)).toEqual([])
    expect(getNextCourseUnlockAt(plan, createdAt)).toBe(startAt)
    expect(getVideoUnlockStatus({ enabled: true, courses: [plan] }, 'video-1', createdAt))
      .toMatchObject({ locked: true, unlockAt: startAt })
    expect(getTodayCourseEpisodes(plan, startAt).map((item) => item.videoId)).toEqual(['video-1', 'video-2'])
    expect(getTodayCourseEpisodes(plan, new Date(2026, 10, 7).getTime()).map((item) => item.videoId)).toEqual(['video-3', 'video-4'])
  })

  it('keeps skipped episodes available before the start date without releasing planned lessons', () => {
    const createdAt = new Date(2026, 10, 3, 12).getTime()
    const startAt = new Date(2026, 10, 6).getTime()
    const plan = { ...course(createdAt, 8), startAt, startEpisodeNumber: 4 }
    expect(getUnlockedEpisodeCount(plan, createdAt)).toBe(3)
    expect(getTodayCourseEpisodes(plan, createdAt)).toEqual([])
    expect(getVideoUnlockStatus({ enabled: true, courses: [plan] }, 'video-3', createdAt).locked).toBe(false)
    expect(getVideoUnlockStatus({ enabled: true, courses: [plan] }, 'video-4', createdAt))
      .toMatchObject({ locked: true, unlockAt: startAt })
    expect(getTodayCourseEpisodes(plan, startAt).map((item) => item.videoId)).toEqual(['video-4'])
  })

  it('changes the rate before starting without pulling lessons forward', () => {
    const createdAt = new Date(2026, 10, 3, 12).getTime()
    const startAt = new Date(2026, 10, 6).getTime()
    const updated = rescheduleDailyUnlockCourse({ ...course(createdAt, 8), startAt }, { dailyEpisodeCount: 3 }, createdAt)
    expect(getTodayCourseEpisodes(updated, new Date(2026, 10, 4).getTime())).toEqual([])
    expect(getNextCourseUnlockAt(updated, createdAt)).toBe(startAt)
    expect(getTodayCourseEpisodes(updated, startAt).map((item) => item.videoId)).toEqual(['video-1', 'video-2', 'video-3'])
  })

  it('moves an unstarted course to a different date without changing its creation time', () => {
    const createdAt = new Date(2026, 10, 3, 12).getTime()
    const plan = { ...course(createdAt, 8), startAt: new Date(2026, 10, 6).getTime() }
    const startAt = new Date(2026, 10, 8).getTime()
    const updated = rescheduleDailyUnlockCourse(plan, { startAt }, createdAt)
    expect(updated.createdAt).toBe(createdAt)
    expect(getTodayCourseEpisodes(updated, plan.startAt)).toEqual([])
    expect(getNextCourseUnlockAt(updated, createdAt)).toBe(startAt)
    expect(getTodayCourseEpisodes(updated, startAt).map((item) => item.videoId)).toEqual(['video-1'])
  })

  it('can bring an unstarted course forward to today without skipping its first batch', () => {
    const now = new Date(2026, 10, 3, 12).getTime()
    const plan = { ...course(now, 8), startAt: new Date(2026, 10, 6).getTime() }
    const updated = rescheduleDailyUnlockCourse(plan, { startAt: new Date(2026, 10, 3).getTime(), dailyEpisodeCount: 2 }, now)
    expect(getTodayCourseEpisodes(updated, now).map((item) => item.videoId)).toEqual(['video-1', 'video-2'])
    expect(getNextCourseUnlockAt(updated, now)).toBe(new Date(2026, 10, 4).getTime())
  })

  it('resumes a course paused before its start on the original date when that date is still ahead', () => {
    const createdAt = new Date(2026, 10, 3, 12).getTime()
    const startAt = new Date(2026, 10, 6).getTime()
    const paused = rescheduleDailyUnlockCourse({ ...course(createdAt, 8), startAt }, { paused: true }, createdAt)
    const resumed = rescheduleDailyUnlockCourse(paused, { paused: false }, new Date(2026, 10, 4, 12).getTime())
    expect(getUnlockedEpisodeCount(paused, new Date(2026, 10, 10).getTime())).toBe(0)
    expect(getTodayCourseEpisodes(resumed, new Date(2026, 10, 5).getTime())).toEqual([])
    expect(getNextCourseUnlockAt(resumed, createdAt)).toBe(startAt)
    expect(getTodayCourseEpisodes(resumed, startAt).map((item) => item.videoId)).toEqual(['video-1'])
  })

  it('starts on the resume day when a course was paused before its planned start', () => {
    const createdAt = new Date(2026, 10, 3, 12).getTime()
    const startAt = new Date(2026, 10, 6).getTime()
    const paused = rescheduleDailyUnlockCourse({ ...course(createdAt, 8), startAt, startEpisodeNumber: 3 }, { paused: true }, createdAt)
    const resumeAt = new Date(2026, 10, 10, 15).getTime()
    const resumed = rescheduleDailyUnlockCourse(paused, { paused: false }, resumeAt)
    expect(getUnlockedEpisodeCount(paused, resumeAt)).toBe(2)
    expect(getTodayCourseEpisodes(resumed, resumeAt).map((item) => item.videoId)).toEqual(['video-3'])
    expect(getUnlockedEpisodeCount(resumed, resumeAt)).toBe(3)
    expect(getTodayCourseEpisodes(resumed, new Date(2026, 10, 11).getTime()).map((item) => item.videoId)).toEqual(['video-4'])
  })

  it('keeps an unstarted course frozen when its rate is edited after the planned start', () => {
    const createdAt = new Date(2026, 10, 3, 12).getTime()
    const plan = { ...course(createdAt, 8), startAt: new Date(2026, 10, 6).getTime() }
    const paused = rescheduleDailyUnlockCourse(plan, { paused: true }, createdAt)
    const editedAt = new Date(2026, 10, 10, 12).getTime()
    const edited = rescheduleDailyUnlockCourse(paused, { dailyEpisodeCount: 2 }, editedAt)
    expect(getUnlockedEpisodeCount(edited, editedAt)).toBe(0)
    expect(getTodayCourseEpisodes(edited, editedAt)).toEqual([])
    expect(getNextCourseUnlockAt(edited, editedAt)).toBeUndefined()
    const resumed = rescheduleDailyUnlockCourse(edited, { paused: false }, editedAt)
    expect(getTodayCourseEpisodes(resumed, editedAt).map((item) => item.videoId)).toEqual(['video-1', 'video-2'])
  })

  it('keeps a pre-start pause when its start date is changed to today', () => {
    const now = new Date(2026, 10, 3, 12).getTime()
    const plan = { ...course(now, 8), startAt: new Date(2026, 10, 6).getTime() }
    const paused = rescheduleDailyUnlockCourse(plan, { paused: true }, now)
    const edited = rescheduleDailyUnlockCourse(paused, { startAt: new Date(2026, 10, 3).getTime() }, now)
    expect(getUnlockedEpisodeCount(edited, now)).toBe(0)
    expect(getTodayCourseEpisodes(edited, now)).toEqual([])
    const resumed = rescheduleDailyUnlockCourse(edited, { paused: false }, now)
    expect(getTodayCourseEpisodes(resumed, now).map((item) => item.videoId)).toEqual(['video-1'])
  })

  it.each([
    [new Date(2026, 1, 28).getTime(), new Date(2026, 2, 1).getTime()],
    [new Date(2026, 11, 31).getTime(), new Date(2027, 0, 1).getTime()]
  ])('uses the chosen start date across a calendar boundary %s -> %s', (startAt, nextDay) => {
    const plan = { ...course(new Date(2026, 0, 1, 12).getTime(), 3), startAt, dailyEpisodeCount: 2 }
    expect(getTodayCourseEpisodes(plan, startAt - 1)).toEqual([])
    expect(getTodayCourseEpisodes(plan, startAt).map((item) => item.videoId)).toEqual(['video-1', 'video-2'])
    expect(getTodayCourseEpisodes(plan, nextDay).map((item) => item.videoId)).toEqual(['video-3'])
    expect(getNextCourseUnlockAt(plan, nextDay)).toBeUndefined()
  })

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

describe('course schedule dates', () => {
  it('parses a date as local midnight and formats it without a UTC shift', () => {
    const timestamp = new Date(2026, 10, 3).getTime()
    expect(parseCourseDate('2026-11-03')).toBe(timestamp)
    expect(formatCourseDate(timestamp)).toBe('2026-11-03')
    expect(formatCourseDate(new Date(2026, 10, 3, 23, 59).getTime())).toBe('2026-11-03')
    expect(parseCourseDate('2028-02-29')).toBe(new Date(2028, 1, 29).getTime())
  })

  it.each(['', '2026-2-03', '2026-02-3', '2026-02-29', '2026-02-30', '2026-13-01', '2026-00-10', '2026-01-00', '2026-11-03T00:00:00Z', ' 2026-11-03'])('rejects invalid or ambiguous date %s', (value) => {
    expect(parseCourseDate(value)).toBeUndefined()
  })

  it('formats invalid timestamps as empty input', () => {
    expect(formatCourseDate(NaN)).toBe('')
    expect(formatCourseDate(Infinity)).toBe('')
  })

  it('uses local calendar days across daylight saving for a selected start date', () => {
    // Changing TZ inside a Vitest worker does not update its native Date zone.
    // Launch a fresh Node process to actually exercise the 23-hour local day.
    const { outputFiles } = buildSync({
      stdin: {
        contents: `
          import { parseCourseDate } from './src/features/daily-unlock/courseScheduleDate';
          import { getTodayCourseEpisodes, getNextCourseUnlockAt } from './src/features/daily-unlock/dailyUnlockPolicy';
          const startAt = parseCourseDate('2026-03-08');
          const nextDay = parseCourseDate('2026-03-09');
          const plan = {
            id: 'dst', name: 'DST', createdAt: new Date(2026, 2, 1, 12).getTime(), startAt,
            episodes: [1, 2, 3].map(n => ({ videoId: 'video-' + n, name: String(n), sourceType: 'direct' }))
          };
          console.log(JSON.stringify({
            elapsed: nextDay - startAt,
            first: getTodayCourseEpisodes(plan, startAt).map(item => item.videoId),
            second: getTodayCourseEpisodes(plan, nextDay).map(item => item.videoId),
            nextMatches: getNextCourseUnlockAt(plan, startAt) === nextDay
          }));
        `,
        resolveDir: process.cwd()
      },
      bundle: true, write: false, platform: 'node', format: 'cjs'
    })
    const output = execFileSync(process.execPath, ['-e', outputFiles[0]!.text], {
      env: { ...process.env, TZ: 'America/New_York' }, encoding: 'utf8', windowsHide: true
    })
    expect(JSON.parse(output)).toEqual({
      elapsed: 23 * 60 * 60 * 1000,
      first: ['video-1'], second: ['video-2'], nextMatches: true
    })
  })

  it('recognizes legacy active courses and keeps pre-start pauses unstarted after their dates pass', () => {
    const now = new Date(2026, 10, 3, 12).getTime()
    const legacy = course(now)
    expect(getCourseStartAt(legacy)).toBe(now)
    expect(hasCourseStarted(legacy, now)).toBe(true)
    const planned = { ...legacy, startAt: new Date(2026, 10, 6).getTime() }
    expect(getCourseStartAt(planned)).toBe(planned.startAt)
    expect(hasCourseStarted(planned, now)).toBe(false)
    const paused = rescheduleDailyUnlockCourse(planned, { paused: true }, now)
    expect(hasCourseStarted(paused, new Date(2026, 10, 10).getTime())).toBe(false)
    const activePaused = rescheduleDailyUnlockCourse(planned, { paused: true }, new Date(2026, 10, 7).getTime())
    expect(hasCourseStarted(activePaused, new Date(2026, 10, 10).getTime())).toBe(true)
  })
})
