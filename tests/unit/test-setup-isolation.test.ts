import { describe, expect, it } from 'vitest'

type RequestMock = {
  (...args: unknown[]): unknown
  mockImplementation(implementation: (...args: unknown[]) => unknown): void
}

function getRequestMock(): RequestMock {
  return (globalThis as unknown as { uni: { request: unknown } }).uni
    .request as RequestMock
}

describe('test setup isolation', () => {
  it('allows a test to replace the request mock implementation', () => {
    const request = getRequestMock()
    request.mockImplementation(() => 'changed')

    expect(request()).toBe('changed')
  })

  it('provides a new default request mock to the following test', () => {
    expect(getRequestMock()()).toBeUndefined()
  })
})
