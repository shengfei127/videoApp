export interface ProgressClassification {
  completed: boolean
  resumable: boolean
}

export function classifyProgress(
  positionSeconds: number,
  durationSeconds: number
): ProgressClassification {
  if (!Number.isFinite(positionSeconds) || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return { completed: false, resumable: false }
  }

  const completed =
    positionSeconds / durationSeconds >= 0.95 ||
    durationSeconds - positionSeconds <= 30

  return {
    completed,
    resumable:
      !completed && positionSeconds >= 30 && durationSeconds - positionSeconds > 30
  }
}
