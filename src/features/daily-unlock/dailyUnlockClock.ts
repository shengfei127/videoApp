import { onHide, onShow, onUnload } from '@dcloudio/uni-app'
import { onUnmounted } from 'vue'

export function scheduleDailyUnlockRefresh(
  refresh: (now: number) => void,
  now: () => number = Date.now
): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  let cancelled = false

  const schedule = (): void => {
    if (cancelled) return
    const currentTime = now()
    const currentDate = new Date(currentTime)
    const nextMidnight = new Date(
      currentDate.getFullYear(),
      currentDate.getMonth(),
      currentDate.getDate() + 1,
      0,
      0,
      0,
      0
    ).getTime()
    timer = setTimeout(() => {
      refresh(now())
      schedule()
    }, Math.max(1, nextMidnight - currentTime))
    const timerWithUnref = timer as unknown as { unref?: () => void }
    timerWithUnref.unref?.()
  }

  schedule()

  return () => {
    cancelled = true
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
    }
  }
}

export function useDailyUnlockClock(refresh: (now: number) => void): void {
  let cancelScheduledRefresh: (() => void) | undefined

  const stop = (): void => {
    cancelScheduledRefresh?.()
    cancelScheduledRefresh = undefined
  }
  const refreshOnShow = (): void => {
    stop()
    refresh(Date.now())
    cancelScheduledRefresh = scheduleDailyUnlockRefresh(refresh)
  }

  onShow(refreshOnShow)
  onHide(stop)
  onUnload(stop)
  onUnmounted(stop)
}
