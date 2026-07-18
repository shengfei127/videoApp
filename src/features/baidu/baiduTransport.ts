import {
  toBaiduHttpError,
  toBaiduNetworkError,
  toBaiduResponseError,
  toBaiduValidationError
} from './baiduErrors'

export const BAIDU_FILE_ENDPOINT =
  'https://pan.baidu.com/rest/2.0/xpan/file' as const
export const BAIDU_MULTIMEDIA_ENDPOINT =
  'https://pan.baidu.com/rest/2.0/xpan/multimedia' as const

export type BaiduEndpoint =
  | typeof BAIDU_FILE_ENDPOINT
  | typeof BAIDU_MULTIMEDIA_ENDPOINT

export interface BaiduHttpRequest {
  readonly endpoint: BaiduEndpoint
  readonly data: Readonly<Record<string, unknown>>
}

export type BaiduVideolistRequest = Readonly<{
  method: 'videolist'
  access_token: string
  parent_path: string
  recursion: 1
  web: 1
  num: 1000
  page: number
}>

export type BaiduFilemetasRequest = Readonly<{
  method: 'filemetas'
  access_token: string
  fsids: string
  dlink: 1
  thumb: 1
  needmedia: 1
}>

export type BaiduApiRequest =
  | BaiduVideolistRequest
  | BaiduFilemetasRequest

export type BaiduTransport = (request: BaiduApiRequest) => Promise<unknown>

interface UniSuccessResponse {
  readonly statusCode: number
  readonly data: unknown
}

interface UniFailureResponse {
  readonly errMsg?: string
}

interface UniRequestOptions {
  readonly url: string
  readonly method: 'GET'
  readonly data: Readonly<Record<string, unknown>>
  readonly header: Readonly<{ 'User-Agent': 'pan.baidu.com' }>
  readonly timeout: 15_000
  readonly dataType: 'json'
  readonly success: (response: UniSuccessResponse) => void
  readonly fail: (failure: UniFailureResponse) => void
}

export type UniRequestAdapter = (options: UniRequestOptions) => unknown

export function createBaiduTransport(
  request: UniRequestAdapter = defaultUniRequest
): BaiduTransport {
  return (data) => {
    const endpoint =
      data.method === 'videolist'
        ? BAIDU_FILE_ENDPOINT
        : BAIDU_MULTIMEDIA_ENDPOINT

    return requestBaiduJson({ endpoint, data }, request)
  }
}

export const baiduTransport: BaiduTransport = createBaiduTransport()

export function requestBaiduJson(
  input: BaiduHttpRequest,
  request: UniRequestAdapter = defaultUniRequest
): Promise<unknown> {
  if (!isAllowedEndpoint(input?.endpoint) || !isRecord(input?.data)) {
    return Promise.reject(toBaiduValidationError())
  }

  return new Promise((resolve, reject) => {
    let settled = false

    const resolveOnce = (value: unknown): void => {
      if (settled) {
        return
      }
      settled = true
      resolve(value)
    }
    const rejectOnce = (error: unknown): void => {
      if (settled) {
        return
      }
      settled = true
      reject(error)
    }

    const success = (response: UniSuccessResponse): void => {
      if (settled) {
        return
      }

      try {
        const status = response?.statusCode
        if (
          !Number.isSafeInteger(status) ||
          status < 200 ||
          status >= 300
        ) {
          rejectOnce(
            Number.isSafeInteger(status) && status >= 100 && status <= 599
              ? toBaiduHttpError(status)
              : toBaiduResponseError()
          )
          return
        }

        const parsed = parseJson(response.data)
        if (!isRecord(parsed)) {
          rejectOnce(toBaiduResponseError())
          return
        }

        resolveOnce(parsed)
      } catch {
        rejectOnce(toBaiduResponseError())
      }
    }

    const fail = (failure: UniFailureResponse): void => {
      if (settled) {
        return
      }

      let timedOut = false
      try {
        timedOut =
          typeof failure?.errMsg === 'string' &&
          /timeout/iu.test(failure.errMsg)
      } catch {
        timedOut = false
      }

      rejectOnce(toBaiduNetworkError(timedOut ? 'timeout' : 'failure'))
    }

    try {
      request({
        url: input.endpoint,
        method: 'GET',
        data: input.data,
        header: { 'User-Agent': 'pan.baidu.com' },
        timeout: 15_000,
        dataType: 'json',
        success,
        fail
      })
    } catch {
      rejectOnce(toBaiduNetworkError('failure'))
    }
  })
}

function defaultUniRequest(options: UniRequestOptions): unknown {
  return (uni.request as unknown as UniRequestAdapter)(options)
}

function isAllowedEndpoint(value: unknown): value is BaiduEndpoint {
  return (
    value === BAIDU_FILE_ENDPOINT || value === BAIDU_MULTIMEDIA_ENDPOINT
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value
  }

  return JSON.parse(value) as unknown
}
