import { afterEach, describe, expect, it, vi } from 'vitest'

import { scheduleDailyUnlockRefresh } from '@/features/daily-unlock/dailyUnlockClock'

afterEach(() => {
  vi.useRealTimers()
})

describe('scheduleDailyUnlockRefresh', () => {
  it('refreshes at the next local midnight and schedules another refresh', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 27, 23, 59, 59, 500))
    const refresh = vi.fn()
    const cancel = scheduleDailyUnlockRefresh(refresh)

    await vi.advanceTimersByTimeAsync(500)
    expect(refresh).toHaveBeenCalledOnce()
    expect(new Date(Date.now()).getHours()).toBe(0)

    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000)
    expect(refresh).toHaveBeenCalledTimes(2)
    cancel()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels the pending midnight refresh', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 27, 23, 59, 59, 500))
    const refresh = vi.fn()
    const cancel = scheduleDailyUnlockRefresh(refresh)
    cancel()

    await vi.advanceTimersByTimeAsync(1_000)
    expect(refresh).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
})
