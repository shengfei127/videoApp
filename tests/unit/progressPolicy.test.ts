import { describe, expect, it } from 'vitest'

import { classifyProgress } from '@/features/playback/progressPolicy'

describe('classifyProgress', () => {
  it.each([
    [29, 600, { completed: false, resumable: false }],
    [120, 600, { completed: false, resumable: true }],
    [570, 600, { completed: true, resumable: false }],
    [571, 600, { completed: true, resumable: false }],
    [120, 0, { completed: false, resumable: false }]
  ])(
    'classifies position %i for duration %i',
    (positionSeconds, durationSeconds, expected) => {
      expect(classifyProgress(positionSeconds, durationSeconds)).toEqual(expected)
    }
  )
})
