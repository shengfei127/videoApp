const OAUTH_WEBVIEW_ID = 'pianke-baidu-oauth'
const MOCK_ACCESS_TOKEN = 'mock-baidu-access-token'

export interface OpenOAuthWebviewOptions {
  authorizeUrl: string
  redirectUri: string
  mockMode?: boolean
  onCallback: (callbackUrl: string) => void | Promise<void>
  createPendingState: () => void
  clearPendingState: () => void
  onCancel?: () => void
  onCallbackFailure?: () => void
}

export interface OAuthWebviewHandle {
  readonly enabled: boolean
  close(): void
}

interface AppOAuthWebview {
  overrideUrlLoading(
    options: Record<string, string>,
    callback: (event: { url: string }) => void
  ): void
  addEventListener(event: string, callback: () => void): void
  show(animation?: string): void
  close(animation?: string): void
}

interface AppWebviewApi {
  create(
    url: string,
    id: string,
    styles: Record<string, unknown>
  ): AppOAuthWebview
  getWebviewById?(id: string): AppOAuthWebview | null
}

let activeHandle: OAuthWebviewHandle | null = null

export function isRegisteredOAuthCallback(
  candidateUrl: string,
  registeredRedirectUri: string
): boolean {
  try {
    const candidate = new URL(candidateUrl)
    const registered = new URL(registeredRedirectUri)

    return (
      candidate.origin === registered.origin &&
      candidate.pathname === registered.pathname
    )
  } catch {
    return false
  }
}

export function openOAuthWebview(
  options: OpenOAuthWebviewOptions
): OAuthWebviewHandle {
  activeHandle?.close()
  activeHandle = null

  // #ifdef APP-PLUS
  if (typeof plus !== 'undefined') {
    const handle = openAppOAuthWebview(options)
    if (handle.enabled) {
      activeHandle = handle
    }
    return handle
  }
  // #endif

  const handle = openH5OAuthMock(options)
  if (handle.enabled) {
    activeHandle = handle
  }
  return handle
}

function openAppOAuthWebview(
  options: OpenOAuthWebviewOptions
): OAuthWebviewHandle {
  const webviewApi = plus.webview as unknown as AppWebviewApi
  const staleWebview = webviewApi.getWebviewById?.(OAUTH_WEBVIEW_ID)

  if (staleWebview) {
    let staleStateCleared = false
    try {
      staleStateCleared = clearPendingStateSafely(options)
    } finally {
      safeClose(staleWebview)
    }

    if (!staleStateCleared) {
      return createDisabledHandle()
    }
  }

  if (!createPendingStateSafely(options)) {
    return createDisabledHandle()
  }

  const webview = webviewApi.create(options.authorizeUrl, OAUTH_WEBVIEW_ID, {
    titleNView: {
      titleText: '连接百度网盘',
      autoBackButton: true
    }
  })
  let settled = false
  let handle: OAuthWebviewHandle

  const release = (): void => {
    if (activeHandle === handle) {
      activeHandle = null
    }
  }

  const cancel = (): void => {
    if (settled) {
      return
    }

    settled = true
    release()
    if (!clearPendingStateSafely(options)) {
      return
    }

    notifyCancellationSafely(options)
  }

  handle = {
    enabled: true,
    close: (): void => {
      if (settled) {
        return
      }

      try {
        cancel()
      } finally {
        safeClose(webview)
      }
    }
  }

  webview.addEventListener('close', cancel)
  webview.overrideUrlLoading(
    {
      mode: 'reject',
      match: buildRedirectMatchPattern(options.redirectUri)
    },
    (event) => {
      if (
        settled ||
        !isRegisteredOAuthCallback(event.url, options.redirectUri)
      ) {
        return
      }

      settled = true
      release()
      if (!clearPendingStateSafely(options)) {
        safeClose(webview)
        return
      }

      Promise.resolve()
        .then(() => options.onCallback(event.url))
        .catch(() => notifyCallbackFailureSafely(options))
        .finally(() => safeClose(webview))
    }
  )
  webview.show('slide-in-right')

  return handle
}

function openH5OAuthMock(
  options: OpenOAuthWebviewOptions
): OAuthWebviewHandle {
  if (!options.mockMode) {
    return createDisabledHandle()
  }

  if (!createPendingStateSafely(options)) {
    return createDisabledHandle()
  }

  let settled = false
  let handle: OAuthWebviewHandle
  const release = (): void => {
    if (activeHandle === handle) {
      activeHandle = null
    }
  }

  handle = {
    enabled: true,
    close: (): void => {
      if (settled) {
        return
      }

      settled = true
      release()
      if (!clearPendingStateSafely(options)) {
        return
      }

      notifyCancellationSafely(options)
    }
  }

  Promise.resolve()
    .then(() => {
      if (settled) {
        return
      }

      settled = true
      release()
      if (!clearPendingStateSafely(options)) {
        return
      }

      return options.onCallback(createMockCallbackUrl(options))
    })
    .catch(() => notifyCallbackFailureSafely(options))

  return handle
}

function createMockCallbackUrl(options: OpenOAuthWebviewOptions): string {
  let state = ''

  try {
    state = new URL(options.authorizeUrl).searchParams.get('state') ?? ''
  } catch {
    // The pure callback parser will reject the empty synthetic state safely.
  }

  const callback = new URL(options.redirectUri)
  callback.hash = new URLSearchParams({
    access_token: MOCK_ACCESS_TOKEN,
    expires_in: '3600',
    scope: 'basic netdisk',
    state
  }).toString()
  return callback.toString()
}

function buildRedirectMatchPattern(redirectUri: string): string {
  const redirect = new URL(redirectUri)
  const exactPrefix = `${redirect.origin}${redirect.pathname}`
  return `^${escapeRegularExpression(exactPrefix)}(?:[?#]|$)`
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

function safeClose(webview: AppOAuthWebview): void {
  try {
    webview.close('slide-out-right')
  } catch {
    // Closing is best-effort during lifecycle cleanup.
  }
}

function clearPendingStateSafely(options: OpenOAuthWebviewOptions): boolean {
  return invokeSynchronousLifecycle(options.clearPendingState, options)
}

function createPendingStateSafely(options: OpenOAuthWebviewOptions): boolean {
  return invokeSynchronousLifecycle(options.createPendingState, options)
}

function invokeSynchronousLifecycle(
  callback: () => void,
  options: OpenOAuthWebviewOptions
): boolean {
  try {
    const result = (callback as () => unknown)()
    if (isThenable(result)) {
      containRejection(result)
      notifyCallbackFailureSafely(options)
      return false
    }

    return true
  } catch {
    notifyCallbackFailureSafely(options)
    return false
  }
}

function createDisabledHandle(): OAuthWebviewHandle {
  return {
    enabled: false,
    close: () => undefined
  }
}

function notifyCancellationSafely(options: OpenOAuthWebviewOptions): void {
  try {
    const result = (options.onCancel as (() => unknown) | undefined)?.()
    if (isThenable(result)) {
      containRejection(result, () => notifyCallbackFailureSafely(options))
    }
  } catch {
    notifyCallbackFailureSafely(options)
  }
}

function notifyCallbackFailureSafely(options: OpenOAuthWebviewOptions): void {
  try {
    const result = (
      options.onCallbackFailure as (() => unknown) | undefined
    )?.()
    if (isThenable(result)) {
      containRejection(result)
    }
  } catch {
    // User callbacks never escape lifecycle cleanup or expose their details.
  }
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    value !== null &&
    (typeof value === 'object' || typeof value === 'function') &&
    typeof (value as { then?: unknown }).then === 'function'
  )
}

function containRejection(
  value: PromiseLike<unknown>,
  onRejected?: () => void
): void {
  void Promise.resolve(value).catch(() => onRejected?.())
}
