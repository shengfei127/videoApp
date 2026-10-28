import { describe, expect, it } from 'vitest'
import { classifyPlaybackFailure } from '@/features/playback/playbackFailure'
import { BaiduError } from '@/features/baidu/baiduErrors'

describe('playback failure explanations', () => {
  it('distinguishes known network, missing file, and rejected URLs without treating them as revoked login', () => {
    expect(classifyPlaybackFailure(new BaiduError('network', 'NETWORK_FAILURE')).kind).toBe('network')
    expect(classifyPlaybackFailure(new BaiduError('http', 404)).kind).toBe('missing')
    expect(classifyPlaybackFailure(undefined, 'HTTP 403').kind).toBe('forbidden')
    expect(classifyPlaybackFailure(undefined, 'offline').kind).toBe('network')
  })
  it('does not guess expiry or unsupported format from generic decode errors or signed URLs', () => {
    const message = classifyPlaybackFailure(undefined, 'decode error https://private.example/404?token=secret&format=expired')
    expect(message.kind).toBe('unknown')
    expect(message.message).not.toContain('secret')
    expect(classifyPlaybackFailure(undefined, 'unsupported format').kind).toBe('unsupported')
  })
})
