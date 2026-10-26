import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Android playback packaging', () => {
  it('includes the native video player required by the uni video component', () => {
    const manifest = JSON.parse(readFileSync('src/manifest.json', 'utf8'))
    expect(manifest['app-plus'].modules).toHaveProperty('VideoPlayer')
  })
})
