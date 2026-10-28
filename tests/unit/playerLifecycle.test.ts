import { describe, expect, it, vi } from 'vitest'

import { PlayerLifecycle } from '@/features/playback/playerLifecycle'

describe('PlayerLifecycle', () => {
  it('keeps playback alive after a failed save and retries the same position without marking it saved', () => {
    const save = vi.fn().mockImplementationOnce(() => { throw new Error('quota') }).mockReturnValue(undefined)
    const onSaveError = vi.fn()
    const onSaved = vi.fn()
    const lifecycle = new PlayerLifecycle({ videoId: 'video-1', save, onSaveError, onSaved, now: () => 1000 })
    lifecycle.onMetadata(600)
    lifecycle.onPlaybackBegin()
    expect(() => lifecycle.onHide(120, 600)).not.toThrow()
    expect(onSaveError).toHaveBeenCalledOnce()
    expect(onSaved).not.toHaveBeenCalled()
    lifecycle.onTimeUpdate(120, 600)
    expect(save).toHaveBeenCalledTimes(2)
    expect(onSaved).toHaveBeenCalledOnce()
  })

  it('does not persist before both metadata and playback have begun', () => {
    const save = vi.fn()
    const lifecycle = new PlayerLifecycle({
      videoId: 'video-1',
      save,
      now: () => 1_000
    })

    lifecycle.onTimeUpdate(100, 600)
    lifecycle.onMetadata(600)
    lifecycle.onTimeUpdate(100, 600)

    expect(save).not.toHaveBeenCalled()
  })

  it('requires loaded metadata even when playback and time updates arrive first', () => {
    const save = vi.fn()
    const lifecycle = new PlayerLifecycle({
      videoId: 'video-1',
      save,
      now: () => 1_000
    })

    lifecycle.onPlaybackBegin()
    lifecycle.onTimeUpdate(100, 600)
    lifecycle.onPause(100, 600)
    lifecycle.onHide(100, 600)
    lifecycle.onUnload(100, 600)
    lifecycle.onEnded(600)

    expect(save).not.toHaveBeenCalled()

    lifecycle.onMetadata(600)
    lifecycle.onTimeUpdate(100, 600)

    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith('video-1', 100, 600, 1_000)
  })

  it('seeks to the saved position when continuing after playback starts', () => {
    const save = vi.fn()
    const lifecycle = new PlayerLifecycle({
      videoId: 'video-1',
      save,
      now: () => 1_000
    })

    lifecycle.onMetadata(600)
    lifecycle.onPlaybackBegin()

    expect(lifecycle.continueFrom(120)).toBe(120)
    expect(save).not.toHaveBeenCalled()
  })

  it('saves zero immediately when restarting before playback begins', () => {
    const save = vi.fn()
    const lifecycle = new PlayerLifecycle({
      videoId: 'video-1',
      save,
      now: () => 1_000
    })

    lifecycle.onMetadata(600)

    expect(lifecycle.restart()).toBe(0)
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith('video-1', 0, 600, 1_000)
  })

  it('does not overwrite saved progress when the page hides before playback begins', () => {
    const save = vi.fn()
    const lifecycle = new PlayerLifecycle({
      videoId: 'video-1',
      save,
      now: () => 1_000
    })
    lifecycle.onMetadata(600)

    lifecycle.onHide(0, 600)
    lifecycle.onUnload(0, 600)

    expect(save).not.toHaveBeenCalled()
  })

  it('persists changed playback position at most once every five seconds', () => {
    let now = 1_000
    const save = vi.fn()
    const lifecycle = new PlayerLifecycle({
      videoId: 'video-1',
      save,
      now: () => now
    })
    lifecycle.onMetadata(600)
    lifecycle.onPlaybackBegin()

    lifecycle.onTimeUpdate(10, 600)
    now += 4_999
    lifecycle.onTimeUpdate(15, 600)
    now += 1
    lifecycle.onTimeUpdate(20, 600)
    now += 5_000
    lifecycle.onTimeUpdate(20, 600)

    expect(save.mock.calls).toEqual([
      ['video-1', 10, 600, 1_000],
      ['video-1', 20, 600, 6_000]
    ])
  })

  it('immediately persists current progress on pause, seeked, hide, and unload', () => {
    let now = 1_000
    const save = vi.fn()
    const lifecycle = new PlayerLifecycle({
      videoId: 'video-1',
      save,
      now: () => now
    })
    lifecycle.onMetadata(600)
    lifecycle.onPlaybackBegin()
    lifecycle.onTimeUpdate(10, 600)
    save.mockClear()

    now += 1
    lifecycle.onPause(11, 600)
    now += 1
    lifecycle.onSeeked(12, 600)
    now += 1
    lifecycle.onHide(13, 600)
    now += 1
    lifecycle.onUnload(14, 600)

    expect(save.mock.calls).toEqual([
      ['video-1', 11, 600, 1_001],
      ['video-1', 12, 600, 1_002],
      ['video-1', 13, 600, 1_003],
      ['video-1', 14, 600, 1_004]
    ])
  })

  it('saves the duration as completed when playback ends', () => {
    const save = vi.fn()
    const lifecycle = new PlayerLifecycle({
      videoId: 'video-1',
      save,
      now: () => 1_000
    })
    lifecycle.onMetadata(600)
    lifecycle.onPlaybackBegin()

    lifecycle.onEnded(600)

    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith('video-1', 600, 600, 1_000)
  })
})
