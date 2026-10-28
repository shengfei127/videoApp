import { describe, expect, it } from 'vitest'
import { createMemoryStorage, type KeyValueStorage } from '@/infrastructure/storage'
import { DAILY_UNLOCK_STORAGE_KEY } from '@/features/daily-unlock/dailyUnlockRepository'
import { LEARNING_STORAGE_KEY, PROGRESS_STORAGE_KEY } from '@/features/playback/progressRepository'
import { describeLearningBackup, exportLearningBackup, parseLearningBackup, restoreLearningBackup } from '@/features/backup/learningBackup'

function populatedStorage() {
  const storage = createMemoryStorage()
  storage.write(DAILY_UNLOCK_STORAGE_KEY, { enabled: true, courses: [{ id: 'course-1', name: '听力课程', createdAt: 100, dailyEpisodeCount: 2, startEpisodeNumber: 2, episodes: [
    { videoId: 'direct:1', name: '第一集', sourceType: 'direct' },
    { videoId: 'baidu:2', name: '第二集', sourceType: 'baidu', path: '/apps/片刻/第二集.mp4' }
  ] }] })
  storage.write(PROGRESS_STORAGE_KEY, [{ videoId: 'baidu:2', positionSeconds: 120, durationSeconds: 600, updatedAt: 200, completed: false }])
  storage.write(LEARNING_STORAGE_KEY, [{ videoId: 'direct:1', durationSeconds: 0, completed: true, updatedAt: 300 }])
  storage.write('pianke:auth:v1', { accessToken: 'PRIVATE_AUTH_VALUE' })
  storage.write('pianke:direct-links:v1', [{ url: 'https://example.test/private.mp4?secret=PRIVATE_MEDIA_VALUE' }])
  return storage
}

describe('learning backup', () => {
  it('round trips Unicode plans, starting episode, actual progress, and unknown-duration learning without source secrets', () => {
    const source = populatedStorage()
    const serialized = exportLearningBackup(source, 500)
    expect(serialized).not.toContain('PRIVATE_')
    expect(serialized).not.toContain('https://')
    expect(serialized).not.toContain('accessToken')
    const backup = parseLearningBackup('\uFEFF' + serialized)
    expect(describeLearningBackup(backup)).toEqual({ courses: 1, playback: 1, learned: 1 })
    const target = createMemoryStorage()
    target.write('pianke:auth:v1', { accessToken: 'KEEP_ME' })
    target.write('pianke:direct-links:v1', [{ id: 'already-here' }])
    restoreLearningBackup(target, backup)
    expect(target.read(DAILY_UNLOCK_STORAGE_KEY, null)).toEqual(source.read(DAILY_UNLOCK_STORAGE_KEY, null))
    expect(target.read(PROGRESS_STORAGE_KEY, null)).toEqual(source.read(PROGRESS_STORAGE_KEY, null))
    expect(target.read(LEARNING_STORAGE_KEY, null)).toEqual(source.read(LEARNING_STORAGE_KEY, null))
    expect(target.read('pianke:auth:v1', null)).toEqual({ accessToken: 'KEEP_ME' })
    expect(target.read('pianke:direct-links:v1', null)).toEqual([{ id: 'already-here' }])
  })

  it.each([
    (data: any) => { data.version = 99 },
    (data: any) => { data.auth = { accessToken: 'not-supported' } },
    (data: any) => { data.courses.courses[0].episodes[0].path = 'https://private.test/video' },
    (data: any) => { data.courses.courses[0].episodes[1].path = '/../invalid' },
    (data: any) => { data.courses.courses[0].startEpisodeNumber = 100 },
    (data: any) => { data.courses.courses.push(data.courses.courses[0]) },
    (data: any) => { data.playback.push(data.playback[0]) },
    (data: any) => { data.playback[0].positionSeconds = 1000 },
    (data: any) => { data.playback[0].url = 'https://private.test/video' },
    (data: any) => { data.learning[0].completed = 'yes' },
    (data: any) => { data.learning[0].updatedAt = -1 }
  ])('rejects malformed or lossy data instead of silently importing a subset (%#)', (mutate) => {
    const data = JSON.parse(exportLearningBackup(populatedStorage(), 500))
    mutate(data)
    expect(() => parseLearningBackup(JSON.stringify(data))).toThrow('备份内容无效')
  })

  it('rejects invalid JSON and excessively large text before writing', () => {
    expect(() => parseLearningBackup('{broken')).toThrow()
    expect(() => parseLearningBackup(' '.repeat(8_000_001))).toThrow('备份过大')
    expect(() => parseLearningBackup('学'.repeat(2_666_667))).toThrow('备份过大')
  })

  it('restores all previous data after a later storage write fails', () => {
    const source = populatedStorage()
    const backup = parseLearningBackup(exportLearningBackup(source, 500))
    const target = createMemoryStorage()
    target.write(DAILY_UNLOCK_STORAGE_KEY, { enabled: false, courses: [] })
    target.write(PROGRESS_STORAGE_KEY, [{ videoId: 'old', marker: 'keep-original' }])
    let failOnce = true
    const failing: KeyValueStorage = { ...target, write(key, value) {
      if (key === LEARNING_STORAGE_KEY && failOnce) { failOnce = false; throw new Error('disk full') }
      target.write(key, value)
    } }
    expect(() => restoreLearningBackup(failing, backup)).toThrow('原学习数据已保留')
    expect(target.read(DAILY_UNLOCK_STORAGE_KEY, null)).toEqual({ enabled: false, courses: [] })
    expect(target.read(PROGRESS_STORAGE_KEY, null)).toEqual([{ videoId: 'old', marker: 'keep-original' }])
    expect(target.read(LEARNING_STORAGE_KEY, null)).toBeNull()
  })
})
