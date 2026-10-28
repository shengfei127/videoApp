import { describe, expect, it } from 'vitest'
import { findNextEpisode } from '@/features/playback/nextEpisode'
import type { DailyUnlockCourse, VideoItem } from '@/domain/video'

const videos: VideoItem[] = ['a', 'b', 'c', 'd'].map(id => ({ id, name: id, sourceId: id, sourceType: 'direct', path: `https://example.test/${id}.mp4` }))
const course: DailyUnlockCourse = { id: 'course', name: '课程', createdAt: 1, episodes: videos.map(video => ({ videoId: video.id, name: video.name, sourceType: video.sourceType })) }

describe('findNextEpisode', () => {
  it('selects the first later available unfinished unlocked episode in course order', () => {
    expect(findNextEpisode('a', [course], videos, [{ videoId: 'b', completed: true, positionSeconds: 0, durationSeconds: 100, updatedAt: 1 }], id => id === 'c')?.id).toBe('d')
  })
  it('skips missing sources and never wraps back to earlier episodes', () => {
    expect(findNextEpisode('a', [course], videos.filter(video => video.id !== 'b'), [], () => false)?.id).toBe('c')
    expect(findNextEpisode('d', [course], videos, [], () => false)).toBeNull()
  })
  it('does not infer another course or choose a course for ambiguous membership', () => {
    expect(findNextEpisode('unknown', [course], videos, [], () => false)).toBeNull()
    expect(findNextEpisode('a', [course, { ...course, id: 'other' }], videos, [], () => false)).toBeNull()
    expect(findNextEpisode('a', [course], videos, [], () => true)).toBeNull()
  })
})
