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
        modifiedAt: 1_711_111_111_000,
        durationSeconds: 123.5,
        thumbnailUrl: 'https://thumb.example/large.jpg?quality=90'
      }
    ])
    expect(JSON.stringify(videos)).not.toContain('sentinel-thumb-token')
  })

  it('converts documented server_mtime seconds to milliseconds and keeps duration in seconds', async () => {
    const transport = vi.fn().mockResolvedValue({
      errno: 0,
      info: [
        {
          ...videoRecord(44, '/apps/片刻/timestamp.mp4'),
          server_mtime: 1_595_921_251,
          duration: 3_601.5
        }
      ]
    })
    const source = new BaiduDriveSource('/apps/片刻', transport)

    const videos = await source.listPage('token', 1)

    expect(videos[0]).toMatchObject({
      modifiedAt: 1_595_921_251_000,
      durationSeconds: 3_601.5
    })
  })

  it.each([
    -1,
    1.5,
    Math.floor(Number.MAX_SAFE_INTEGER / 1000) + 1
  ])('discards a record with unsafe server_mtime seconds: %s', async (serverMtime) => {
    const transport = vi.fn().mockResolvedValue({
      errno: 0,
      info: [
        {
          ...videoRecord(45, '/apps/片刻/unsafe-time.mp4'),
          server_mtime: serverMtime
        }
      ]
    })
    const source = new BaiduDriveSource('/apps/片刻', transport)

    await expect(source.listPage('token', 1)).resolves.toEqual([])
  })

  it.each([
    '#Access_Token=sentinel-fragment-token',
    '#access%5Ftoken=sentinel-encoded-fragment-token',
    '#credential=sentinel-fragment-credential'
  ])(
    'rejects a credential-bearing thumbnail fragment and uses the safe fallback: %s',
    async (fragment) => {
      const transport = vi.fn().mockResolvedValue({
        errno: 0,
        info: [
          {
            ...videoRecord(43, '/apps/片刻/fragment.mp4'),
            thumbs: {
              url1: 'https://thumb.example/safe.jpg',
              url9: `https://thumb.example/unsafe.jpg${fragment}`
            }
          }
        ]
      })
      const source = new BaiduDriveSource('/apps/片刻', transport)

      const videos = await source.listPage('token', 1)

      expect(videos[0]?.thumbnailUrl).toBe(
        'https://thumb.example/safe.jpg'
      )
      expect(JSON.stringify(videos)).not.toContain('sentinel')
    }
  )

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

  it('preserves canonical uint64 fs_id strings and deduplicates as strings', async () => {
    const aboveSafeInteger = '9007199254740992'
    const uint64Max = '18446744073709551615'
    const transport = vi.fn().mockResolvedValue({
      errno: 0,
      info: [
        videoRecord(aboveSafeInteger, '/apps/片刻/large.mp4'),
        videoRecord(aboveSafeInteger, '/apps/片刻/duplicate.mp4'),
        videoRecord(uint64Max, '/apps/片刻/max.mp4'),
        videoRecord('18446744073709551616', '/apps/片刻/overflow.mp4')
      ]
    })
    const source = new BaiduDriveSource('/apps/片刻', transport)

    const videos = await source.listPage('token', 1)

    expect(videos.map((video) => video.id)).toEqual([
      `baidu:${aboveSafeInteger}`,
      `baidu:${uint64Max}`
    ])
    expect(videos.map((video) => video.sourceId)).toEqual([
      aboveSafeInteger,
      uint64Max
    ])
  })

  it.each(unsafeEncodedProviderPaths)(
    'discards an ambiguous encoded provider path: %s',
    async (path) => {
      const transport = vi.fn().mockResolvedValue({
        errno: 0,
        info: [
          videoRecord(1, '/apps/片刻/安全 100% 完成.mp4'),
          videoRecord(2, path)
        ]
      })
      const source = new BaiduDriveSource('/apps/片刻', transport)

      const videos = await source.listPage('token', 1)

      expect(videos.map((video) => video.path)).toEqual([
        '/apps/片刻/安全 100% 完成.mp4'
      ])
    }
  )

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
  it.each(unsafeEncodedProviderPaths)(
    'rejects an ambiguous encoded filemetas path: %s',
    async (path) => {
      const transport = vi.fn().mockResolvedValue({
        errno: 0,
        list: [
          {
            fs_id: 7,
            path,
            dlink: 'https://d.pcs.baidu.com/file/encoded-path'
          }
        ]
      })
      const source = new BaiduDriveSource('/apps/片刻', transport)

      const error = await captureSourceRejection(
        source.resolvePlaybackUrl('current-token', 7)
      )

      expect(error).toMatchObject({
        kind: 'response',
        code: 'INVALID_RESPONSE',
        diagnostics: {}
      })
      expect(JSON.stringify(error)).not.toContain(path)
    }
  )

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

  it.each([
    'http://d.pcs.baidu.com/file/insecure',
    'https://downloads.example.test/file/foreign',
    'https://d.pcs.baidu.com.evil.example/file/suffix-lookalike',
    'https://evil-d.pcs.baidu.com/file/prefix-lookalike',
    'https://d.pcs.baidu.com./file/trailing-dot',
    'https://127.0.0.1/file/ip-literal',
    'https://[::1]/file/ipv6-literal',
    'https://localhost/file/localhost',
    'https://sentinel-user:sentinel-password@d.pcs.baidu.com/file/userinfo',
    'https://d.pcs.baidu.com:444/file/non-default-port',
    'https://d.pcs.baidu.com/file/fragment#sentinel-fragment'
  ])('rejects a non-official dlink before adding the token: %s', async (dlink) => {
    const sentinelToken = 'sentinel-current-token-DO-NOT-LEAK'
    const transport = vi.fn().mockResolvedValue({
      errno: 0,
      list: [
        {
          fs_id: 7,
          path: '/apps/片刻/movie.mp4',
          dlink
        }
      ]
    })
    const source = new BaiduDriveSource('/apps/片刻', transport)

    const error = await captureSourceRejection(
      source.resolvePlaybackUrl(sentinelToken, 7)
    )
    const serialized = [
      error.message,
      String(error),
      JSON.stringify(error),
      JSON.stringify(error.diagnostics)
    ].join('\n')

    expect(error).toMatchObject({
      kind: 'response',
      code: 'INVALID_RESPONSE',
      diagnostics: {}
    })
    expect(serialized).not.toContain(sentinelToken)
    expect(serialized).not.toContain(dlink)
  })

  it('preserves an official dlink signature and replaces token variants exactly once', async () => {
    const transport = vi.fn().mockResolvedValue({
      errno: 0,
      list: [
        {
          fs_id: 7,
          path: '/apps/片刻/movie.mp4',
          dlink:
            'https://d.pcs.baidu.com:443/file/official?sign=a%2Bb&timestamp=123&Access_Token=stale-one&access_token=stale-two'
        }
      ]
    })
    const source = new BaiduDriveSource('/apps/片刻', transport)

    const result = await source.resolvePlaybackUrl('current-token', 7)
    const url = new URL(result)
    const tokenKeys = Array.from(url.searchParams.keys()).filter(
      (key) => key.toLowerCase() === 'access_token'
    )

    expect(url.protocol).toBe('https:')
    expect(url.hostname).toBe('d.pcs.baidu.com')
    expect(url.port).toBe('')
    expect(url.searchParams.get('sign')).toBe('a+b')
    expect(url.searchParams.get('timestamp')).toBe('123')
    expect(tokenKeys).toEqual(['access_token'])
    expect(url.searchParams.get('access_token')).toBe('current-token')
    expect(result).not.toContain('stale-one')
    expect(result).not.toContain('stale-two')
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

  it.each(['9007199254740992', '18446744073709551615'])(
    'requests and matches the lossless uint64 fs_id %s',
    async (fsId) => {
      const transport = vi.fn().mockResolvedValue({
        errno: 0,
        list: [
          {
            fs_id: fsId,
            path: '/apps/片刻/large.mp4',
            dlink: 'https://d.pcs.baidu.com/file/large'
          }
        ]
      })
      const source = new BaiduDriveSource('/apps/片刻', transport)

      const result = await source.resolvePlaybackUrl('token', fsId)

      expect(transport).toHaveBeenCalledWith({
        method: 'filemetas',
        access_token: 'token',
        fsids: `[${fsId}]`,
        dlink: 1,
        thumb: 1,
        needmedia: 1
      })
      expect(new URL(result).searchParams.get('access_token')).toBe('token')
    }
  )

  it.each([
    '0',
    '-1',
    '+1',
    '01',
    '1.0',
    '1e3',
    ' 1',
    '1 ',
    '18446744073709551616',
    '99999999999999999999999999999999999999'
  ])('rejects a non-canonical or out-of-range fs_id string: %s', async (fsId) => {
    const transport = vi.fn()
    const source = new BaiduDriveSource('/apps/片刻', transport)

    await expect(source.resolvePlaybackUrl('token', fsId)).rejects.toThrow()
    expect(transport).not.toHaveBeenCalled()
  })

  it.each([
    [
      'one mismatched extra record',
      [
        {
          fs_id: 8,
          path: '/apps/片刻/extra.mp4',
          dlink: 'https://d.pcs.baidu.com/file/extra'
        }
      ]
    ],
    ['one malformed extra record', [null]],
    [
      'duplicated extra records',
      [
        {
          fs_id: 8,
          path: '/apps/片刻/extra.mp4',
          dlink: 'https://d.pcs.baidu.com/file/extra'
        },
        {
          fs_id: 8,
          path: '/apps/片刻/extra.mp4',
          dlink: 'https://d.pcs.baidu.com/file/extra'
        }
      ]
    ]
  ] as const)(
    'rejects filemetas with %s',
    async (_case, extras) => {
      const transport = vi.fn().mockResolvedValue({
        errno: 0,
        list: [
          {
            fs_id: 7,
            path: '/apps/片刻/movie.mp4',
            dlink: 'https://d.pcs.baidu.com/file/valid'
          },
          ...extras
        ]
      })
      const source = new BaiduDriveSource('/apps/片刻', transport)

      const error = await captureSourceRejection(
        source.resolvePlaybackUrl('current-token', 7)
      )

      expect(error).toMatchObject({
        kind: 'response',
        code: 'INVALID_RESPONSE',
        diagnostics: {}
      })
    }
  )

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

function videoRecord(fsId: number | string, path: string) {
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

const unsafeEncodedProviderPaths = [
  '/apps/片刻/%2e%2e/其他/movie.mp4',
  '/apps/片刻/%2E%2E/其他/movie.mp4',
  '/apps/片刻/folder%2fother/movie.mp4',
  '/apps/片刻/folder%2Fother/movie.mp4',
  '/apps/片刻/folder%5cother/movie.mp4',
  '/apps/片刻/folder%5Cother/movie.mp4',
  '/apps/片刻/%252e%252e/其他/movie.mp4',
  '/apps/片刻/%252E%252E/其他/movie.mp4',
  '/apps/片刻/malformed%2/movie.mp4',
  '/apps/片刻/query?.mp4',
  '/apps/片刻/fragment#.mp4'
] as const

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
