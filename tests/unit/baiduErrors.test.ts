import { describe, expect, it, vi } from 'vitest'

import {
  BaiduError,
  normalizeBaiduError,
  toBaiduError,
  toBaiduHttpError,
  toBaiduNetworkError
} from '@/features/baidu/baiduErrors'
import {
  BAIDU_FILE_ENDPOINT,
  BAIDU_MULTIMEDIA_ENDPOINT,
  createBaiduTransport,
  requestBaiduJson
} from '@/features/baidu/baiduTransport'

describe('Baidu public errors', () => {
  it.each([
    [20011, 'quota', '当前应用的测试用户数量已满'],
    [20012, 'rate-limit', '请求过于频繁，请稍后再试'],
    [20013, 'permission', '百度接口尚未开通或应用需要审核']
  ] as const)(
    'maps provider errno %s to a stable public error',
    (errno, kind, message) => {
      const error = toBaiduError(errno, 'request-123')

      expect(error).toBeInstanceOf(BaiduError)
      expect(error).toMatchObject({
        kind,
        code: errno,
        message,
        requestId: 'request-123',
        diagnostics: { errno, request_id: 'request-123' }
      })
    }
  )

  it.each([-6, 110, 111])(
    'maps invalid or expired authorization errno %s to reconnect guidance',
    (errno) => {
      const error = toBaiduError(errno)

      expect(error.kind).toBe('authorization')
      expect(error.code).toBe(errno)
      expect(error.message).toContain('授权已过期')
      expect(error.message).toContain('重新连接')
    }
  )

  it('maps an unknown errno without exposing provider-owned text', () => {
    const error = toBaiduError(987654, 'safe-request-id')

    expect(error).toMatchObject({
      kind: 'provider',
      code: 987654,
      message: '百度网盘暂时无法访问',
      diagnostics: {
        errno: 987654,
        request_id: 'safe-request-id'
      }
    })
  })

  it.each([
    ['timeout', 'network-timeout', 'NETWORK_TIMEOUT'],
    ['failure', 'network', 'NETWORK_FAILURE']
  ] as const)(
    'maps a network %s without raw request diagnostics',
    (failure, kind, code) => {
      const error = toBaiduNetworkError(failure)

      expect(error).toMatchObject({ kind, code, diagnostics: {} })
    }
  )

  it('maps HTTP 403 with status-only diagnostics', () => {
    const error = toBaiduHttpError(403)

    expect(error).toMatchObject({
      kind: 'http',
      code: 403,
      diagnostics: { status: 403 }
    })
    expect(error.message).toContain('拒绝')
    expect(Object.keys(error.diagnostics)).toEqual(['status'])
  })

  it('redacts arbitrary thrown values from messages and serialization', () => {
    const sentinelToken = 'sentinel-access-token-DO-NOT-LEAK'
    const sentinelUrl =
      'https://d.pcs.baidu.com/file?access_token=sentinel-url-token'
    const sentinelBody = '{"secret":"sentinel-response-body"}'
    const raw = {
      message: `provider leaked ${sentinelToken}`,
      error_description: sentinelUrl,
      body: sentinelBody
    }

    const error = normalizeBaiduError(raw)
    const publicRepresentations = [
      error.message,
      String(error),
      JSON.stringify(error),
      JSON.stringify(error.diagnostics)
    ].join('\n')

    expect(error).toBeInstanceOf(BaiduError)
    expect(publicRepresentations).not.toContain(sentinelToken)
    expect(publicRepresentations).not.toContain(sentinelUrl)
    expect(publicRepresentations).not.toContain('sentinel-url-token')
    expect(publicRepresentations).not.toContain(sentinelBody)
    expect(publicRepresentations).not.toContain('sentinel-response-body')
    expect(publicRepresentations).not.toContain('error_description')
  })

  it('drops an unsafe request_id instead of serializing it', () => {
    const error = toBaiduError(
      20012,
      'request-id?access_token=sentinel-request-token'
    )

    expect(error.requestId).toBeUndefined()
    expect(error.diagnostics).toEqual({ errno: 20012 })
    expect(JSON.stringify(error)).not.toContain('sentinel-request-token')
  })
})

describe('Baidu uni.request transport', () => {
  it('routes filemetas data to the fixed multimedia endpoint', async () => {
    const request = vi.fn()
    const transport = createBaiduTransport(request)
    const data = {
      method: 'filemetas' as const,
      access_token: 'sentinel-routing-token',
      fsids: '[7]',
      dlink: 1 as const,
      thumb: 1 as const,
      needmedia: 1 as const
    }
    const pending = transport(data)

    expect(request).toHaveBeenCalledOnce()
    expect(request.mock.calls[0][0]).toMatchObject({
      url: BAIDU_MULTIMEDIA_ENDPOINT,
      data
    })
    requestOptions(request).success({
      statusCode: 200,
      data: { errno: 0, list: [] }
    })
    await expect(pending).resolves.toEqual({ errno: 0, list: [] })
  })

  it('sends a fixed endpoint, GET method, required header, and 15s timeout', async () => {
    const request = vi.fn()
    const data = {
      method: 'videolist',
      access_token: 'sentinel-transport-token',
      parent_path: '/apps/片刻'
    }
    const pending = requestBaiduJson(
      { endpoint: BAIDU_FILE_ENDPOINT, data },
      request
    )

    expect(request).toHaveBeenCalledOnce()
    expect(request).toHaveBeenCalledWith({
      url: BAIDU_FILE_ENDPOINT,
      method: 'GET',
      data,
      header: { 'User-Agent': 'pan.baidu.com' },
      timeout: 15_000,
      dataType: 'json',
      success: expect.any(Function),
      fail: expect.any(Function)
    })

    requestOptions(request).success({
      statusCode: 200,
      data: { errno: 0, info: [] }
    })
    await expect(pending).resolves.toEqual({ errno: 0, info: [] })
  })

  it('parses a JSON string only for a successful 2xx response', async () => {
    const request = vi.fn()
    const pending = requestBaiduJson(
      {
        endpoint: BAIDU_FILE_ENDPOINT,
        data: { method: 'videolist' }
      },
      request
    )

    requestOptions(request).success({
      statusCode: 299,
      data: '{"errno":0,"info":[]}'
    })

    await expect(pending).resolves.toEqual({ errno: 0, info: [] })
  })

  it('rejects HTTP 403 with status-only diagnostics and no response body', async () => {
    const request = vi.fn()
    const pending = requestBaiduJson(
      {
        endpoint: BAIDU_FILE_ENDPOINT,
        data: {
          method: 'videolist',
          access_token: 'sentinel-http-token'
        }
      },
      request
    )

    requestOptions(request).success({
      statusCode: 403,
      data: {
        message: 'sentinel-provider-message',
        body: 'sentinel-arbitrary-body'
      }
    })

    const error = await captureRejection(pending)
    expect(error).toMatchObject({
      kind: 'http',
      code: 403,
      diagnostics: { status: 403 }
    })
    const serialized = JSON.stringify(error)
    expect(serialized).not.toContain('sentinel-http-token')
    expect(serialized).not.toContain('sentinel-provider-message')
    expect(serialized).not.toContain('sentinel-arbitrary-body')
  })

  it.each([
    ['request:fail timeout sentinel-network-detail', 'network-timeout'],
    ['request:fail sentinel-network-detail', 'network']
  ])('rejects a safe typed network error for %s', async (errMsg, kind) => {
    const request = vi.fn()
    const pending = requestBaiduJson(
      {
        endpoint: BAIDU_FILE_ENDPOINT,
        data: {
          method: 'videolist',
          access_token: 'sentinel-network-token'
        }
      },
      request
    )

    requestOptions(request).fail({ errMsg })

    const error = await captureRejection(pending)
    expect(error).toMatchObject({ kind, diagnostics: {} })
    expect(JSON.stringify(error)).not.toContain('sentinel-network')
  })

  it('wraps a synchronous request failure without stringifying it', async () => {
    const request = vi.fn(() => {
      throw new Error('sentinel-synchronous-transport-secret')
    })

    const error = await captureRejection(
      requestBaiduJson(
        {
          endpoint: BAIDU_FILE_ENDPOINT,
          data: { method: 'videolist' }
        },
        request
      )
    )

    expect(error).toMatchObject({ kind: 'network', diagnostics: {} })
    expect(JSON.stringify(error)).not.toContain(
      'sentinel-synchronous-transport-secret'
    )
  })

  it('settles only once when a request adapter fires multiple callbacks', async () => {
    const request = vi.fn((options: TestRequestOptions) => {
      options.success({ statusCode: 200, data: { errno: 0 } })
      options.fail({ errMsg: 'request:fail sentinel-late-secret' })
      options.success({
        statusCode: 500,
        data: { body: 'sentinel-late-body' }
      })
    })

    await expect(
      requestBaiduJson(
        {
          endpoint: BAIDU_FILE_ENDPOINT,
          data: { method: 'videolist' }
        },
        request
      )
    ).resolves.toEqual({ errno: 0 })
  })

  it('rejects a secret-bearing or unknown endpoint before uni.request', async () => {
    const request = vi.fn()
    const endpoint =
      `${BAIDU_FILE_ENDPOINT}?access_token=sentinel-endpoint-token` as typeof BAIDU_FILE_ENDPOINT

    const error = await captureRejection(
      requestBaiduJson(
        { endpoint, data: { method: 'videolist' } },
        request
      )
    )

    expect(request).not.toHaveBeenCalled()
    expect(error).toMatchObject({
      kind: 'validation',
      code: 'INVALID_REQUEST',
      diagnostics: {}
    })
    expect(JSON.stringify(error)).not.toContain('sentinel-endpoint-token')
  })
})

interface TestRequestOptions {
  success: (response: { statusCode: number; data: unknown }) => void
  fail: (failure: { errMsg?: string }) => void
}

function requestOptions(request: ReturnType<typeof vi.fn>): TestRequestOptions {
  return request.mock.calls[0][0] as TestRequestOptions
}

async function captureRejection(promise: Promise<unknown>): Promise<BaiduError> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(BaiduError)
    return error as BaiduError
  }

  throw new Error('Expected promise to reject')
}
