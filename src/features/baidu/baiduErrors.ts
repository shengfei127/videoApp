export type BaiduErrorKind =
  | 'validation'
  | 'authorization'
  | 'quota'
  | 'rate-limit'
  | 'permission'
  | 'network-timeout'
  | 'network'
  | 'http'
  | 'provider'
  | 'response'

export type BaiduErrorCode =
  | number
  | 'INVALID_REQUEST'
  | 'INVALID_RESPONSE'
  | 'NETWORK_TIMEOUT'
  | 'NETWORK_FAILURE'

export interface BaiduErrorDiagnostics {
  readonly errno?: number
  readonly status?: number
  readonly request_id?: string
}

const PROVIDER_MESSAGES: Readonly<Record<number, string>> = {
  20011: '当前应用的测试用户数量已满',
  20012: '请求过于频繁，请稍后再试',
  20013: '百度接口尚未开通或应用需要审核'
}

const AUTHORIZATION_ERRNOS = new Set([-6, 110, 111])
const SAFE_REQUEST_ID = /^[A-Za-z0-9_-]{1,128}$/u

export class BaiduError extends Error {
  readonly kind: BaiduErrorKind
  readonly code: BaiduErrorCode
  readonly requestId?: string
  readonly diagnostics: Readonly<BaiduErrorDiagnostics>

  constructor(
    kind: BaiduErrorKind,
    code: BaiduErrorCode,
    diagnostics: BaiduErrorDiagnostics = {}
  ) {
    super(publicMessage(kind, code))
    this.name = 'BaiduError'
    this.kind = kind
    this.code = code

    const safeDiagnostics = sanitizeDiagnostics(diagnostics)
    this.diagnostics = Object.freeze(safeDiagnostics)
    this.requestId = safeDiagnostics.request_id
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      kind: this.kind,
      code: this.code,
      message: this.message,
      requestId: this.requestId,
      diagnostics: this.diagnostics
    }
  }
}

export function toBaiduError(
  errno: number,
  requestId?: unknown
): BaiduError {
  if (!Number.isSafeInteger(errno)) {
    return toBaiduResponseError()
  }

  const diagnostics: BaiduErrorDiagnostics = {
    errno,
    ...(safeRequestId(requestId)
      ? { request_id: safeRequestId(requestId) }
      : {})
  }

  if (AUTHORIZATION_ERRNOS.has(errno)) {
    return new BaiduError('authorization', errno, diagnostics)
  }
  if (errno === 20011) {
    return new BaiduError('quota', errno, diagnostics)
  }
  if (errno === 20012) {
    return new BaiduError('rate-limit', errno, diagnostics)
  }
  if (errno === 20013) {
    return new BaiduError('permission', errno, diagnostics)
  }

  return new BaiduError('provider', errno, diagnostics)
}

export function toBaiduNetworkError(
  failure: 'timeout' | 'failure'
): BaiduError {
  return failure === 'timeout'
    ? new BaiduError('network-timeout', 'NETWORK_TIMEOUT')
    : new BaiduError('network', 'NETWORK_FAILURE')
}

export function toBaiduHttpError(status: number): BaiduError {
  if (!Number.isSafeInteger(status) || status < 100 || status > 599) {
    return toBaiduResponseError()
  }

  return new BaiduError('http', status, { status })
}

export function toBaiduValidationError(): BaiduError {
  return new BaiduError('validation', 'INVALID_REQUEST')
}

export function toBaiduResponseError(): BaiduError {
  return new BaiduError('response', 'INVALID_RESPONSE')
}

export function normalizeBaiduError(error: unknown): BaiduError {
  return error instanceof BaiduError
    ? error
    : toBaiduNetworkError('failure')
}

function publicMessage(
  kind: BaiduErrorKind,
  code: BaiduErrorCode
): string {
  if (typeof code === 'number' && PROVIDER_MESSAGES[code]) {
    return PROVIDER_MESSAGES[code]
  }

  switch (kind) {
    case 'validation':
      return '百度网盘请求参数无效'
    case 'authorization':
      return '百度网盘授权已过期，请重新连接'
    case 'network-timeout':
      return '连接百度网盘超时，请稍后再试'
    case 'network':
      return '无法连接百度网盘，请检查网络后重试'
    case 'http':
      return code === 403
        ? '百度网盘拒绝了本次请求，请稍后再试'
        : '百度网盘服务暂时不可用'
    case 'response':
      return '百度网盘返回了无效数据'
    default:
      return '百度网盘暂时无法访问'
  }
}

function safeRequestId(value: unknown): string | undefined {
  if (typeof value === 'string' && SAFE_REQUEST_ID.test(value)) {
    return value
  }

  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return String(value)
  }

  return undefined
}

function sanitizeDiagnostics(
  diagnostics: BaiduErrorDiagnostics
): BaiduErrorDiagnostics {
  const safe: {
    errno?: number
    status?: number
    request_id?: string
  } = {}

  if (Number.isSafeInteger(diagnostics.errno)) {
    safe.errno = diagnostics.errno
  }
  if (
    Number.isSafeInteger(diagnostics.status) &&
    diagnostics.status !== undefined &&
    diagnostics.status >= 100 &&
    diagnostics.status <= 599
  ) {
    safe.status = diagnostics.status
  }

  const requestId = safeRequestId(diagnostics.request_id)
  if (requestId) {
    safe.request_id = requestId
  }

  return safe
}
