import { describe, expect, it } from 'vitest'
import type { DailyUnlockCourse, PlaybackProgress, VideoItem } from '@/domain/video'
import { buildLearningPlan, learningTimeLabel } from '@/features/daily-unlock/learningPlan'
import { rescheduleDailyUnlockCourse } from '@/features/daily-unlock/dailyUnlockPolicy'

const day = (offset: number) => new Date(2026, 9, 27 + offset, 12).getTime()

function course(count = 5, dailyEpisodeCount = 1): DailyUnlockCourse {
  return {
    id: 'course', name: '听力课', createdAt: day(0), dailyEpisodeCount,
    episodes: Array.from({ length: count }, (_, i) => ({
      videoId: `video-${i + 1}`, name: `第${i + 1}课`, sourceType: 'direct' as const
    }))
  }
}

function video(id: string, durationSeconds?: number): VideoItem {
  return { id, sourceId: id, sourceType: 'direct', name: id, path: 'https://example.test/video.mp4', durationSeconds }
}

function progress(videoId: string, completed: boolean, positionSeconds = 120, durationSeconds = 600): PlaybackProgress {
  return { videoId, completed, positionSeconds, durationSeconds, updatedAt: day(0) }
}

describe('learning plan', () => {
  it('separates today, unfinished past lessons, and tomorrow without forcing backlog completion', () => {
    const plan = buildLearningPlan({ enabled: true, courses: [course()] }, day(2), [], [progress('video-1', true)])
    expect(plan.today.map((item) => item.id)).toEqual(['video-3'])
    expect(plan.backlog.map((item) => item.id)).toEqual(['video-2'])
    expect(plan.tomorrow.map((item) => item.id)).toEqual(['video-4'])
    expect(new Set([...plan.today, ...plan.backlog].map((item) => item.id)).size).toBe(2)
  })

  it('keeps a completed final lesson available for review only on its scheduled day', () => {
    const settings = { enabled: true, courses: [course(1)] }
    const history = [progress('video-1', true)]
    const today = buildLearningPlan(settings, day(0), [], history)
    expect(today.today[0]?.completed).toBe(true)
    expect(today.backlog).toEqual([])
    expect(today.tomorrow).toEqual([])
    expect(buildLearningPlan(settings, day(1), [], history).today).toEqual([])
  })

  it('uses measured playback duration before catalog estimates and rounds remaining time up', () => {
    const plan = buildLearningPlan({ enabled: true, courses: [course()] }, day(0), [video('video-1', 900)], [progress('video-1', false, 121, 600)])
    expect(plan.today[0]?.remainingSeconds).toBe(479)
    expect(learningTimeLabel(plan.today[0]!)).toBe('剩余 8 分钟')
  })

  it('does not invent duration for missing sources or zero-duration progress', () => {
    const plan = buildLearningPlan({ enabled: true, courses: [course()] }, day(0), [], [progress('video-1', false, 0, 0)])
    expect(plan.today[0]).toMatchObject({ name: '第1课', video: undefined, remainingSeconds: undefined })
    expect(learningTimeLabel(plan.today[0]!)).toBe('时长待获取')
    const catalogPlan = buildLearningPlan({ enabled: true, courses: [course()] }, day(0), [video('video-1', 61)], [])
    expect(learningTimeLabel(catalogPlan.today[0]!)).toBe('约 2 分钟')
  })

  it('handles manually completed unknown-duration lessons without estimating a duration', () => {
    const plan = buildLearningPlan({ enabled: true, courses: [course()] }, day(0), [], [{ ...progress('video-1', true, 0, 0), manualCompleted: true }])
    expect(plan.today[0]?.remainingSeconds).toBeUndefined()
    expect(learningTimeLabel(plan.today[0]!)).toBe('已学完')
  })

  it('places in-progress daily lessons first and completed ones last for multi-episode schedules', () => {
    const plan = buildLearningPlan({ enabled: true, courses: [course(7, 3)] }, day(0), [], [progress('video-1', true), progress('video-3', false)])
    expect(plan.today.map((item) => item.id)).toEqual(['video-3', 'video-2', 'video-1'])
    expect(plan.backlog).toEqual([])
    expect(plan.tomorrow.map((item) => item.id)).toEqual(['video-4', 'video-5', 'video-6'])
  })

  it('preserves released unfinished content during pause without planning new lessons', () => {
    const paused = rescheduleDailyUnlockCourse(course(), { paused: true }, day(1))
    const plan = buildLearningPlan({ enabled: true, courses: [paused] }, day(4), [], [progress('video-1', true)])
    expect(plan.today).toEqual([])
    expect(plan.tomorrow).toEqual([])
    expect(plan.backlog.map((item) => item.id)).toEqual(['video-2'])
  })

  it('hides scheduled learning when the feature is disabled', () => {
    expect(buildLearningPlan({ enabled: false, courses: [course()] }, day(2), [], [])).toEqual({ today: [], backlog: [], tomorrow: [] })
  })
})
