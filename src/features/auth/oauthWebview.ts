import { OAuthCancellationError } from './oauth'

const OAUTH_WEBVIEW_ID = 'pianke-baidu-oauth'
const MOCK_ACCESS_TOKEN = 'mock-baidu-access-token'

export interface OAuthPendingState {
  state: string
}

export interface OpenOAuthWebviewOptions {
  authorizeUrl: string
  redirectUri: string
  mockMode?: boolean
  onCallback: (
    callbackUrl: string,
    pendingState: OAuthPendingState
  ) => void | Promise<void>
  createPendingState: () => OAuthPendingState
  consumePendingState: () => OAuthPendingState | null
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

type FailureNotifier = () => void

type SynchronousResult<T> =
  | { ok: true; value: T }
  | { ok: false }

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
  const notifyFailure = createFailureNotifier(options)
  const authorizeState = readAuthorizeState(options.authorizeUrl)

  if (!authorizeState) {
    rollbackPendingState(options)
    notifyFailure()
    return createDisabledHandle()
  }

  const webviewApi = plus.webview as unknown as AppWebviewApi
  let staleWebview: AppOAuthWebview | null | undefined

  try {
    staleWebview = webviewApi.getWebviewById?.(OAUTH_WEBVIEW_ID)
  } catch {
    rollbackPendingState(options)
    notifyFailure()
    return createDisabledHandle()
  }

  if (staleWebview) {
    const staleStateCleared = callSynchronously(
      options.clearPendingState
    ).ok
    const staleWebviewClosed = safeClose(staleWebview)

    if (!staleStateCleared || !staleWebviewClosed) {
      notifyFailure()
      return createDisabledHandle()
    }
  }

  const createdPending = createPendingState(
    options,
    authorizeState,
    notifyFailure
  )
  if (!createdPending) {
    return createDisabledHandle()
  }

  let webview: AppOAuthWebview
  try {
    webview = webviewApi.create(options.authorizeUrl, OAUTH_WEBVIEW_ID, {
      titleNView: {
        titleText: '连接百度网盘',
        autoBackButton: true
      }
    })
  } catch {
    rollbackPendingState(options)
    notifyFailure()
    return createDisabledHandle()
  }

  let settled = false
  let closeAttempted = false
  let handle: OAuthWebviewHandle

  const release = (): void => {
    if (activeHandle === handle) {
      activeHandle = null
    }
  }

  const closeWebviewOnce = (): boolean => {
    if (closeAttempted) {
      return true
    }

    closeAttempted = true
    return safeClose(webview)
  }

  const cancel = (alreadyClosed: boolean): void => {
    if (settled) {
      return
    }

    settled = true
    release()
    if (alreadyClosed) {
      closeAttempted = true
    }

    const pendingCleared = clearPendingState(options, notifyFailure)
    const webviewClosed = alreadyClosed || closeWebviewOnce()
    if (!pendingCleared || !webviewClosed) {
      if (!webviewClosed) {
        notifyFailure()
      }
      return
    }

    notifyCancellationSafely(options, notifyFailure)
  }

  const acceptCallback = (event: { url: string }): void => {
    if (
      settled ||
      !isRegisteredOAuthCallback(event.url, options.redirectUri)
    ) {
      return
    }

    settled = true
    release()
    const consumedPending = consumePendingState(
      options,
      createdPending,
      notifyFailure
    )
    const webviewClosed = closeWebviewOnce()

    if (!consumedPending || !webviewClosed) {
      if (!webviewClosed) {
        notifyFailure()
      }
      return
    }

    invokeOAuthCallback(
      options,
      event.url,
      consumedPending,
      notifyFailure
    )
  }

  handle = {
    enabled: true,
    close: (): void => cancel(false)
  }

  const failLaunch = (): OAuthWebviewHandle => {
    if (!settled) {
      settled = true
      release()
      rollbackPendingState(options)
      closeWebviewOnce()
      notifyFailure()
    }
    return createDisabledHandle()
  }

  try {
    webview.addEventListener('close', () => cancel(true))
    if (settled) {
      return createDisabledHandle()
    }

    webview.overrideUrlLoading(
      {
        mode: 'reject',
        match: buildRedirectMatchPattern(options.redirectUri)
      },
      acceptCallback
    )
    if (settled) {
      return createDisabledHandle()
    }

    webview.show('slide-in-right')
    if (settled) {
      return createDisabledHandle()
    }
  } catch {
    return failLaunch()
  }

  return handle
}

function openH5OAuthMock(
  options: OpenOAuthWebviewOptions
): OAuthWebviewHandle {
  if (!options.mockMode) {
    return createDisabledHandle()
  }

  const notifyFailure = createFailureNotifier(options)
  const authorizeState = readAuthorizeState(options.authorizeUrl)
  if (!authorizeState) {
    rollbackPendingState(options)
    notifyFailure()
    return createDisabledHandle()
  }

  const createdPending = createPendingState(
    options,
    authorizeState,
    notifyFailure
  )
  if (!createdPending) {
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
      if (!clearPendingState(options, notifyFailure)) {
        return
      }

      notifyCancellationSafely(options, notifyFailure)
    }
  }

  Promise.resolve().then(() => {
    if (settled) {
      return
    }

    settled = true
    release()
    const consumedPending = consumePendingState(
      options,
      createdPending,
      notifyFailure
    )
    if (!consumedPending) {
      return
    }

    invokeOAuthCallback(
      options,
      createMockCallbackUrl(options),
      consumedPending,
      notifyFailure
    )
  })

  return handle
}

function createPendingState(
  options: OpenOAuthWebviewOptions,
  authorizeState: string,
  notifyFailure: FailureNotifier
): OAuthPendingState | null {
  const result = callSynchronously(options.createPendingState)
  const pending = result.ok ? validatePendingState(result.value) : null

  if (!pending || pending.state !== authorizeState) {
    rollbackPendingState(options)
    notifyFailure()
    return null
  }

  return pending
}

function consumePendingState(
  options: OpenOAuthWebviewOptions,
  createdPending: OAuthPendingState,
  notifyFailure: FailureNotifier
): OAuthPendingState | null {
  const result = callSynchronously(options.consumePendingState)
  const pending = result.ok ? validatePendingState(result.value) : null

  if (!pending || pending.state !== createdPending.state) {
    rollbackPendingState(options)
    notifyFailure()
    return null
  }

  return pending
}

function clearPendingState(
  options: OpenOAuthWebviewOptions,
  notifyFailure: FailureNotifier
): boolean {
  const succeeded = callSynchronously(options.clearPendingState).ok
  if (!succeeded) {
    notifyFailure()
  }
  return succeeded
}

function rollbackPendingState(options: OpenOAuthWebviewOptions): void {
  callSynchronously(options.clearPendingState)
}

function validatePendingState(value: unknown): OAuthPendingState | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const pending = value as Record<string, unknown>
  return typeof pending.state === 'string' && pending.state.trim()
    ? (value as OAuthPendingState)
    : null
}

function callSynchronously<T>(callback: () => T): SynchronousResult<T> {
  try {
    const value = (callback as () => unknown)()
    if (isThenable(value)) {
      containRejection(value)
      return { ok: false }
    }

    return { ok: true, value: value as T }
  } catch {
    return { ok: false }
  }
}

function invokeOAuthCallback(
  options: OpenOAuthWebviewOptions,
  callbackUrl: string,
  pendingState: OAuthPendingState,
  notifyFailure: FailureNotifier
): void {
  void Promise.resolve()
    .then(() => options.onCallback(callbackUrl, pendingState))
    .catch((error: unknown) => {
      if (error instanceof OAuthCancellationError) {
        notifyCancellationSafely(options, notifyFailure)
        return
      }

      notifyFailure()
    })
}

function createFailureNotifier(
  options: OpenOAuthWebviewOptions
): FailureNotifier {
  let notified = false

  return (): void => {
    if (notified) {
      return
    }

    notified = true
    invokeOptionalCallback(options.onCallbackFailure)
  }
}

function notifyCancellationSafely(
  options: OpenOAuthWebviewOptions,
  notifyFailure: FailureNotifier
): void {
  try {
    const result = (options.onCancel as (() => unknown) | undefined)?.()
    if (isThenable(result)) {
      containRejection(result, notifyFailure)
    }
  } catch {
    notifyFailure()
  }
}

function invokeOptionalCallback(callback: (() => void) | undefined): void {
  try {
    const result = (callback as (() => unknown) | undefined)?.()
    if (isThenable(result)) {
      containRejection(result)
    }
  } catch {
    // User callback errors are intentionally contained and redacted.
  }
}

function readAuthorizeState(authorizeUrl: string): string | null {
  try {
    const state = new URL(authorizeUrl).searchParams.get('state')
    return state?.trim() ? state : null
  } catch {
    return null
  }
}

function createMockCallbackUrl(options: OpenOAuthWebviewOptions): string {
  const state = readAuthorizeState(options.authorizeUrl) ?? ''
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

function safeClose(webview: AppOAuthWebview): boolean {
  try {
    webview.close('slide-out-right')
    return true
  } catch {
    return false
  }
}

function createDisabledHandle(): OAuthWebviewHandle {
  return {
    enabled: false,
    close: () => undefined
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
