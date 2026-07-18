import { describe, expect, it, vi } from 'vitest'

import { BaiduDriveSource } from '@/features/baidu/baiduDriveSource'
import { BaiduError } from '@/features/baidu/baiduErrors'

describe('BaiduDriveSource videolist', () => {
  it('requests only the configured app root with the exact paging contract', async () => {
    const transport = vi.fn().mockResolvedValue({ errno: 0, info: [] })
    const source = new BaiduDriveSource('/apps/片刻', transport)

    await source.listPage('sentinel-access-token', 3)

    expect(transport).toHaveBeenCalledOnce()
    expect(transport).toHaveBeenCalledWith({
      method: 'videolist',
      access_token: 'sentinel-access-token',
      parent_path: '/apps/片刻',
      recursion: 1,
      web: 1,
      num: 1000,
      page: 3
    })
  })

  it('discards records outside the configured root and prefix lookalikes', async () => {
    const transport = vi.fn().mockResolvedValue({
      errno: 0,
      info: [
        videoRecord(1, '/apps/片刻/inside.mp4'),
        videoRecord(2, '/apps/其他/outside.mp4'),
        videoRecord(3, '/apps/片刻2/lookalike.mp4')
      ]
    })
    const source = new BaiduDriveSource('/apps/片刻', transport)

    const videos = await source.listPage('token', 1)

    expect(videos.map((video) => video.id)).toEqual(['baidu:1'])
  })

  it('maps safe metadata and chooses the largest token-free HTTPS thumbnail', async () => {
    const transport = vi.fn().mockResolvedValue({
      errno: 0,
      info: [
        {
          ...videoRecord(42, '/apps/片刻/feature.mp4'),
          size: 9_876_543,
          server_mtime: 1_711_111_111,
          duration: 123.5,
          thumbs: {
            url1: 'https://thumb.example/small.jpg',
            url3: 'https://thumb.example/large.jpg?quality=90',
            url4: 'http://thumb.example/insecure.jpg',
            url5:
              'https://thumb.example/secret.jpg?access_token=sentinel-thumb-token'
          }
        }
      ]
    })
    const source = new BaiduDriveSource('/apps/片刻', transport)

    const videos = await source.listPage('token', 1)

    expect(videos).toEqual([
      {
        id: 'baidu:42',
        sourceType: 'baidu',
        sourceId: '42',
        name: 'feature.mp4',
        path: '/apps/片刻/feature.mp4',
        sizeBytes: 9_876_543,
        modifiedAt: 1_711_111_111,
        durationSeconds: 123.5,
        thumbnailUrl: 'https://thumb.example/large.jpg?quality=90'
      }
    ])
    expect(JSON.stringify(videos)).not.toContain('sentinel-thumb-token')
  })

  it('accepts a safe name fallback and missing optional metadata', async () => {
    const transport = vi.fn().mockResolvedValue({
      errno: 0,
      info: [
        {
          fs_id: 9,
          name: 'fallback.webm',
          path: '/apps/片刻/fallback.webm',
          isdir: 0,
          category: 1
        }
      ]
    })
    const source = new BaiduDriveSource('/apps/片刻', transport)

    expect(await source.listPage('token', 1)).toEqual([
      {
        id: 'baidu:9',
        sourceType: 'baidu',
        sourceId: '9',
        name: 'fallback.webm',
        path: '/apps/片刻/fallback.webm'
      }
    ])
  })

  it('deduplicates fs_id and discards folders, non-videos, traversal, and malformed metadata', async () => {
    const valid = videoRecord(1, '/apps/片刻/valid.mp4')
    const transport = vi.fn().mockResolvedValue({
      errno: 0,
      info: [
        valid,
        { ...valid, server_filename: 'duplicate.mp4' },
        { ...videoRecord(2, '/apps/片刻/folder.mp4'), isdir: 1 },
        { ...videoRecord(3, '/apps/片刻/audio.mp4'), category: 2 },
        { ...videoRecord(4, '/apps/片刻/../其他/traversal.mp4') },
        { ...videoRecord(5, '/apps/片刻/string-size.mp4'), size: '1024' },
        {
          ...videoRecord(6, '/apps/片刻/unsafe-time.mp4'),
          server_mtime: Number.MAX_SAFE_INTEGER + 1
        },
        { ...videoRecord(7, '/apps/片刻/negative-duration.mp4'), duration: -1 },
        { ...videoRecord(0, '/apps/片刻/zero-id.mp4') },
        { ...videoRecord(8, 'relative/path.mp4') },
        { ...videoRecord(9, '/apps/片刻/empty-name.mp4'), server_filename: '' },
        null,
        'sentinel-malformed-record'
      ]
    })
    const source = new BaiduDriveSource('/apps/片刻', transport)

    const videos = await source.listPage('token', 1)

    expect(videos.map((video) => video.id)).toEqual(['baidu:1'])
  })

  it.each([
    '/',
    '/apps',
    '/apps/',
    '/apps/片刻/child',
    '/apps/../片刻',
    '/apps/%2e%2e',
    '/apps/片刻?debug=1',
    '/apps/片刻#fragment',
    '/apps/片刻\u0000',
    '/apps/片刻/'
  ])('fails closed for an unsafe app root: %s', (root) => {
    expect(() => new BaiduDriveSource(root, vi.fn())).toThrow()
  })

  it('accepts exactly one safe app-folder segment', () => {
    expect(
      () => new BaiduDriveSource('/apps/My Videos', vi.fn())
    ).not.toThrow()
  })

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN])(
    'rejects an invalid page before transport: %s',
    async (page) => {
      const transport = vi.fn()
      const source = new BaiduDriveSource('/apps/片刻', transport)

      await expect(source.listPage('token', page)).rejects.toThrow()
      expect(transport).not.toHaveBeenCalled()
    }
  )

  it.each(['', '   '])(
    'rejects an empty access token before transport',
    async (accessToken) => {
      const transport = vi.fn()
      const source = new BaiduDriveSource('/apps/片刻', transport)

      await expect(source.listPage(accessToken, 1)).rejects.toThrow()
      expect(transport).not.toHaveBeenCalled()
    }
  )

  it('checks provider errno before mapping and keeps provider text private', async () => {
    const transport = vi.fn().mockResolvedValue({
      errno: 20012,
      request_id: 'request-20012',
      error_msg:
        'sentinel-provider-message access_token=sentinel-provider-token',
      info: [videoRecord(1, '/apps/片刻/must-not-map.mp4')]
    })
    const source = new BaiduDriveSource('/apps/片刻', transport)

    const error = await captureSourceRejection(source.listPage('token', 1))

    expect(error).toMatchObject({
      kind: 'rate-limit',
      code: 20012,
      requestId: 'request-20012',
      diagnostics: { errno: 20012, request_id: 'request-20012' }
    })
    expect(JSON.stringify(error)).not.toContain('sentinel-provider')
  })

  it('rejects a malformed successful provider envelope', async () => {
    const transport = vi.fn().mockResolvedValue({
      errno: 0,
      info: { body: 'sentinel-malformed-body' }
    })
    const source = new BaiduDriveSource('/apps/片刻', transport)

    const error = await captureSourceRejection(source.listPage('token', 1))

    expect(error).toMatchObject({
      kind: 'response',
      code: 'INVALID_RESPONSE',
      diagnostics: {}
    })
    expect(JSON.stringify(error)).not.toContain('sentinel-malformed-body')
  })

  it('wraps an arbitrary transport rejection without exposing it', async () => {
    const transport = vi
      .fn()
      .mockRejectedValue(
        new Error(
          'sentinel-transport-error https://example.test/?access_token=secret'
        )
      )
    const source = new BaiduDriveSource('/apps/片刻', transport)

    const error = await captureSourceRejection(source.listPage('token', 1))

    expect(error).toMatchObject({ kind: 'network', diagnostics: {} })
    expect(JSON.stringify(error)).not.toContain('sentinel-transport-error')
    expect(JSON.stringify(error)).not.toContain('access_token')
  })
})

describe('BaiduDriveSource filemetas playback', () => {
  it('requests one fresh dlink per call and applies only the current token', async () => {
    const transport = vi
      .fn()
      .mockResolvedValueOnce({
        errno: 0,
        list: [
          {
            fs_id: 7,
            path: '/apps/片刻/movie.mp4',
            dlink:
              'https://d.pcs.baidu.com/file/first?foo=1&access_token=stale-token'
          }
        ]
      })
      .mockResolvedValueOnce({
        errno: 0,
        list: [
          {
            fs_id: 7,
            path: '/apps/片刻/movie.mp4',
            dlink: 'https://d.pcs.baidu.com/file/second?bar=2'
          }
        ]
      })
    const source = new BaiduDriveSource('/apps/片刻', transport)

    const first = await source.resolvePlaybackUrl('current-token-one', 7)
    const second = await source.resolvePlaybackUrl('current-token-two', 7)

    expect(transport).toHaveBeenNthCalledWith(1, {
      method: 'filemetas',
      access_token: 'current-token-one',
      fsids: '[7]',
      dlink: 1,
      thumb: 1,
      needmedia: 1
    })
    expect(transport).toHaveBeenNthCalledWith(2, {
      method: 'filemetas',
      access_token: 'current-token-two',
      fsids: '[7]',
      dlink: 1,
      thumb: 1,
      needmedia: 1
    })

    const firstUrl = new URL(first)
    const secondUrl = new URL(second)
    expect(`${firstUrl.origin}${firstUrl.pathname}`).toBe(
      'https://d.pcs.baidu.com/file/first'
    )
    expect(firstUrl.searchParams.get('foo')).toBe('1')
    expect(firstUrl.searchParams.get('access_token')).toBe(
      'current-token-one'
    )
    expect(first).not.toContain('stale-token')
    expect(`${secondUrl.origin}${secondUrl.pathname}`).toBe(
      'https://d.pcs.baidu.com/file/second'
    )
    expect(secondUrl.searchParams.get('access_token')).toBe(
      'current-token-two'
    )
    expect(JSON.stringify(source)).not.toContain('current-token')
    expect(JSON.stringify(source)).not.toContain('d.pcs.baidu.com')
  })

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN])(
    'rejects invalid fs_id %s before transport',
    async (fsId) => {
      const transport = vi.fn()
      const source = new BaiduDriveSource('/apps/片刻', transport)

      await expect(
        source.resolvePlaybackUrl('token', fsId)
      ).rejects.toThrow()
      expect(transport).not.toHaveBeenCalled()
    }
  )

  it.each(['', '   '])(
    'rejects an empty playback token before transport',
    async (accessToken) => {
      const transport = vi.fn()
      const source = new BaiduDriveSource('/apps/片刻', transport)

      await expect(
        source.resolvePlaybackUrl(accessToken, 7)
      ).rejects.toThrow()
      expect(transport).not.toHaveBeenCalled()
    }
  )

  it('accepts one canonical decimal fs_id and matches the returned record', async () => {
    const transport = vi.fn().mockResolvedValue({
      errno: 0,
      list: [
        {
          fs_id: '7',
          path: '/apps/片刻/movie.mp4',
          dlink: 'https://d.pcs.baidu.com/file/string-id'
        }
      ]
    })
    const source = new BaiduDriveSource('/apps/片刻', transport)
    const accessToken = 'current+/=& token'

    const result = await source.resolvePlaybackUrl(
      accessToken,
      '7' as unknown as number
    )

    expect(transport).toHaveBeenCalledWith({
      method: 'filemetas',
      access_token: accessToken,
      fsids: '[7]',
      dlink: 1,
      thumb: 1,
      needmedia: 1
    })
    const url = new URL(result)
    expect(url.protocol).toBe('https:')
    expect(url.searchParams.get('access_token')).toBe(accessToken)
  })

  it.each([
    [
      'mismatched fs_id',
      [
        {
          fs_id: 8,
          path: '/apps/片刻/movie.mp4',
          dlink: 'https://d.pcs.baidu.com/file/mismatch'
        }
      ]
    ],
    [
      'sibling root',
      [
        {
          fs_id: 7,
          path: '/apps/片刻2/movie.mp4',
          dlink: 'https://d.pcs.baidu.com/file/sibling'
        }
      ]
    ],
    [
      'traversal path',
      [
        {
          fs_id: 7,
          path: '/apps/片刻/../其他/movie.mp4',
          dlink: 'https://d.pcs.baidu.com/file/traversal'
        }
      ]
    ],
    [
      'duplicate matching records',
      [
        {
          fs_id: 7,
          path: '/apps/片刻/a.mp4',
          dlink: 'https://d.pcs.baidu.com/file/a'
        },
        {
          fs_id: 7,
          path: '/apps/片刻/b.mp4',
          dlink: 'https://d.pcs.baidu.com/file/b'
        }
      ]
    ],
    [
      'non-http dlink',
      [
        {
          fs_id: 7,
          path: '/apps/片刻/movie.mp4',
          dlink: 'file:///sentinel-local-dlink'
        }
      ]
    ],
    [
      'credentialed dlink',
      [
        {
          fs_id: 7,
          path: '/apps/片刻/movie.mp4',
          dlink: 'https://sentinel-user:sentinel-password@example.test/file'
        }
      ]
    ],
    [
      'malformed dlink',
      [
        {
          fs_id: 7,
          path: '/apps/片刻/movie.mp4',
          dlink: 'sentinel-invalid-url?access_token=sentinel-dlink-token'
        }
      ]
    ]
  ] as const)(
    'fails closed for a %s response',
    async (_case, list) => {
      const transport = vi.fn().mockResolvedValue({ errno: 0, list })
      const source = new BaiduDriveSource('/apps/片刻', transport)

      const error = await captureSourceRejection(
        source.resolvePlaybackUrl('current-token', 7)
      )

      expect(error).toMatchObject({
        kind: 'response',
        code: 'INVALID_RESPONSE',
        diagnostics: {}
      })
      const serialized = JSON.stringify(error)
      expect(serialized).not.toContain('sentinel')
      expect(serialized).not.toContain('access_token')
    }
  )

  it('checks filemetas errno before using a returned dlink', async () => {
    const transport = vi.fn().mockResolvedValue({
      errno: 111,
      request_id: 'request-expired',
      error_msg: 'sentinel-expired-provider-message',
      list: [
        {
          fs_id: 7,
          path: '/apps/片刻/movie.mp4',
          dlink: 'https://example.test/?access_token=sentinel-provider-token'
        }
      ]
    })
    const source = new BaiduDriveSource('/apps/片刻', transport)

    const error = await captureSourceRejection(
      source.resolvePlaybackUrl('current-token', 7)
    )

    expect(error).toMatchObject({
      kind: 'authorization',
      code: 111,
      requestId: 'request-expired'
    })
    expect(JSON.stringify(error)).not.toContain('sentinel')
  })
})

function videoRecord(fsId: number, path: string) {
  return {
    fs_id: fsId,
    server_filename: path.slice(path.lastIndexOf('/') + 1),
    path,
    isdir: 0,
    category: 1,
    size: 1024,
    server_mtime: 1_700_000_000,
    duration: 42
  }
}

async function captureSourceRejection(
  promise: Promise<unknown>
): Promise<BaiduError> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(BaiduError)
    return error as BaiduError
  }

  throw new Error('Expected promise to reject')
}
