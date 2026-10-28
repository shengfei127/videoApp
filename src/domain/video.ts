export type VideoSourceType = 'baidu' | 'direct'

export interface VideoItem {
  id: string
  sourceType: VideoSourceType
  sourceId: string
  name: string
  path: string
  sizeBytes?: number
  durationSeconds?: number
  thumbnailUrl?: string
  modifiedAt?: number
}

export interface DirectVideoRecord {
  id: string
  name: string
  url: string
  mediaKind: 'mp4' | 'hls' | 'unverified'
  addedAt: number
}

export interface PlaybackProgress {
  videoId: string
  positionSeconds: number
  durationSeconds: number
  updatedAt: number
  completed: boolean
}

export interface DailyUnlockEpisode {
  videoId: string
  name: string
  sourceType: VideoSourceType
  path?: string
}

export interface DailyUnlockCourse {
  id: string
  name: string
  createdAt: number
  sourceFolderPath?: string
  episodes: DailyUnlockEpisode[]
}

export interface DailyUnlockSettings {
  enabled: boolean
  courses: DailyUnlockCourse[]
}

export interface VideoUnlockStatus {
  locked: boolean
  courseId?: string
  courseName?: string
  episodeNumber?: number
  unlockedCount?: number
  unlockAt?: number
}
export interface BaiduAuthSession {
  accessToken: string
  expiresAt: number
  scope: string[]
}

export interface VideoFolder {
  name: string
  path: string
  folders: VideoFolder[]
  videos: VideoItem[]
}
