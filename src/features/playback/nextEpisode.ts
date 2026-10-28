import type { DailyUnlockCourse, PlaybackProgress, VideoItem } from '@/domain/video'

/** Only advance within an unambiguous course, preserving its configured order. */
export function findNextEpisode(
  currentVideoId: string,
  courses: readonly DailyUnlockCourse[],
  videos: readonly VideoItem[],
  progress: readonly PlaybackProgress[],
  isLocked: (videoId: string) => boolean
): VideoItem | null {
  const matches = courses.filter(course => course.episodes.some(episode => episode.videoId === currentVideoId))
  if (matches.length !== 1) return null
  const course = matches[0]!
  const currentIndex = course.episodes.findIndex(episode => episode.videoId === currentVideoId)
  const completed = new Set(progress.filter(item => item.completed).map(item => item.videoId))
  const available = new Map(videos.map(video => [video.id, video]))
  for (const episode of course.episodes.slice(currentIndex + 1)) {
    if (episode.videoId === currentVideoId || completed.has(episode.videoId) || isLocked(episode.videoId)) continue
    const video = available.get(episode.videoId)
    if (video) return video
  }
  return null
}
