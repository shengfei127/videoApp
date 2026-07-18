import { describe, expect, it } from 'vitest'

import type { BaiduAuthSession } from '@/domain/video'

describe('BaiduAuthSession', () => {
  it('supports the OAuth scopes returned by Baidu', () => {
    const session: BaiduAuthSession = {
      accessToken: 'token',
      expiresAt: 1000,
      scope: ['basic', 'netdisk']
    }

    expect(session.scope).toEqual(['basic', 'netdisk'])
  })
})
