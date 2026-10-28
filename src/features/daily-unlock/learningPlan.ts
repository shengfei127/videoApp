import type { DailyUnlockCourse, DailyUnlockSettings, PlaybackProgress, VideoItem } from '@/domain/video'
import { getTodayCourseEpisodes, getUnlockedEpisodeCount } from './dailyUnlockPolicy'

export interface LearningLesson {
  id: string
  courseName: string
  episodeNumber: number
  name: string
  video?: VideoItem
  completed: boolean
  positionSeconds: number
  remainingSeconds?: number
}

export function buildLearningPlan(settings: DailyUnlockSettings, now: number, videos: VideoItem[], history: PlaybackProgress[]) {
  const today: LearningLesson[] = []
  const backlog: LearningLesson[] = []
  const tomorrow: LearningLesson[] = []
  if (!settings.enabled) return { today, backlog, tomorrow }
  const byId = new Map(videos.map((video) => [video.id, video]))
  const progressById = new Map(history.map((progress) => [progress.videoId, progress]))
  const date = new Date(now)
  const nextDay = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime()
  function lesson(course: DailyUnlockCourse, index: number): LearningLesson {
    const episode = course.episodes[index]!
    const video = byId.get(episode.videoId)
    const progress = progressById.get(episode.videoId)
    const duration = progress && progress.durationSeconds > 0 ? progress.durationSeconds : video?.durationSeconds
    const position = Math.max(0, progress?.positionSeconds ?? 0)
    return {
      id: episode.videoId, courseName: course.name, episodeNumber: index + 1,
      name: episode.name, video, completed: progress?.completed === true, positionSeconds: position,
      remainingSeconds: duration !== undefined && Number.isFinite(duration) && duration > 0
        ? progress?.completed ? 0 : Math.max(0, duration - position) : undefined
    }
  }
  for (const course of settings.courses) {
    const todayIds = new Set(getTodayCourseEpisodes(course, now).map((episode) => episode.videoId))
    const tomorrowIds = new Set(getTodayCourseEpisodes(course, nextDay).map((episode) => episode.videoId))
    const unlocked = getUnlockedEpisodeCount(course, now)
    course.episodes.forEach((episode, index) => {
      if (todayIds.has(episode.videoId)) today.push(lesson(course, index))
      else if (index < unlocked && !progressById.get(episode.videoId)?.completed) backlog.push(lesson(course, index))
      if (tomorrowIds.has(episode.videoId)) tomorrow.push(lesson(course, index))
    })
  }
  // In-progress lessons lead, completed lessons remain available for review.
  today.sort((a, b) => Number(a.completed) - Number(b.completed) || Number(b.positionSeconds > 0) - Number(a.positionSeconds > 0))
  return { today, backlog, tomorrow }
}

export function learningTimeLabel(lesson: LearningLesson): string {
  if (lesson.completed) return '已学完'
  if (lesson.remainingSeconds === undefined) return '时长待获取'
  return `${lesson.positionSeconds > 0 ? '剩余' : '约'} ${Math.max(1, Math.ceil(lesson.remainingSeconds / 60))} 分钟`
}
