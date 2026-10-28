export interface PlayerLifecycleOptions {
  videoId: string
  save: (
    videoId: string,
    positionSeconds: number,
    durationSeconds: number,
    updatedAt: number
  ) => unknown
  now?: () => number
  onSaveError?: () => void
  onSaved?: () => void
}

const SAVE_INTERVAL_MS = 5_000

export class PlayerLifecycle {
  private readonly now: () => number
  private metadataDuration = 0
  private metadataReady = false
  private playbackBegun = false
  private lastSavedAt: number | null = null
  private lastSavedPosition: number | null = null
  private saveFailed = false

  constructor(private readonly options: PlayerLifecycleOptions) {
    this.now = options.now ?? Date.now
  }

  onMetadata(durationSeconds: number): void {
    this.metadataDuration = normalizeDuration(durationSeconds)
    this.metadataReady = this.metadataDuration > 0
  }

  onPlaybackBegin(): void {
    this.playbackBegun = true
  }

  continueFrom(positionSeconds: number): number {
    return clampPosition(positionSeconds, this.metadataDuration)
  }

  restart(): number {
    this.saveRestartPosition()
    return 0
  }

  onTimeUpdate(positionSeconds: number, durationSeconds: number): void {
    this.updateDuration(durationSeconds)
    if (!this.canSave()) {
      return
    }

    const position = clampPosition(positionSeconds, this.metadataDuration)
    const now = this.now()
    if (
      !this.saveFailed && (this.lastSavedPosition === position ||
      (this.lastSavedAt !== null && now - this.lastSavedAt < SAVE_INTERVAL_MS))
    ) {
      return
    }

    this.save(position, now)
  }

  onPause(positionSeconds: number, durationSeconds: number): void {
    this.updateDuration(durationSeconds)
    this.saveNow(positionSeconds, this.metadataDuration)
  }

  onSeeked(positionSeconds: number, durationSeconds: number): void {
    this.updateDuration(durationSeconds)
    this.saveNow(positionSeconds, this.metadataDuration)
  }

  onHide(positionSeconds: number, durationSeconds: number): void {
    this.updateDuration(durationSeconds)
    this.saveNow(positionSeconds, this.metadataDuration)
  }

  onUnload(positionSeconds: number, durationSeconds: number): void {
    this.updateDuration(durationSeconds)
    this.saveNow(positionSeconds, this.metadataDuration)
  }

  onEnded(durationSeconds: number): void {
    this.updateDuration(durationSeconds)
    this.saveNow(this.metadataDuration, this.metadataDuration)
  }

  private updateDuration(durationSeconds: number): void {
    const duration = normalizeDuration(durationSeconds)
    if (duration > 0) {
      this.metadataDuration = duration
    }
  }

  private canSave(): boolean {
    return this.metadataReady && this.playbackBegun && this.metadataDuration > 0
  }

  private saveNow(positionSeconds: number, durationSeconds: number): void {
    if (
      !this.metadataReady ||
      !this.playbackBegun ||
      durationSeconds <= 0
    ) {
      return
    }

    this.save(clampPosition(positionSeconds, durationSeconds), this.now())
  }

  private saveRestartPosition(): void {
    if (!this.metadataReady || this.metadataDuration <= 0) {
      return
    }

    this.save(0, this.now())
  }

  private save(positionSeconds: number, updatedAt: number): void {
    try {
      const result = this.options.save(this.options.videoId, positionSeconds, this.metadataDuration, updatedAt)
      if (result === false) throw new Error('Progress save failed')
    } catch {
      this.saveFailed = true
      this.options.onSaveError?.()
      return
    }
    this.saveFailed = false
    this.lastSavedAt = updatedAt
    this.lastSavedPosition = positionSeconds
    this.options.onSaved?.()
  }
}

function normalizeDuration(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0
}

function clampPosition(value: number, duration: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }

  return Math.min(Math.max(value, 0), Math.max(duration, 0))
}
