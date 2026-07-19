import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import DirectLinkSheet from '@/components/DirectLinkSheet.vue'
import type { DirectVideoRecord } from '@/domain/video'
import { DirectLinkService } from '@/features/direct-links/directLinkService'
import { createMemoryStorage } from '@/infrastructure/storage'

describe('DirectLinkSheet', () => {
  beforeEach(() => {
    vi.stubGlobal('crypto', {
      randomUUID: vi.fn(() => 'direct-test-id')
    })
  })

  it('uses a plain URL field with correction disabled and accepts an optional name', async () => {
    const { wrapper } = mountSheet()
    const url = wrapper.get('[data-testid="direct-url"]')
    const name = wrapper.get('[data-testid="direct-name"]')

    expect(url.attributes('type')).toBe('text')
    expect(url.attributes('autocorrect')).toBe('off')
    expect(url.attributes('autocapitalize')).toBe('off')
    expect(name.attributes('required')).toBeUndefined()

    await url.setValue('https://cdn.example.test/movie.mp4')
    await name.setValue('  周末电影  ')
    await wrapper.get('[data-testid="direct-save"]').trigger('click')

    const saved = wrapper.emitted<DirectVideoRecord[]>('saved')?.[0]?.[0]
    expect(saved).toMatchObject({
      id: 'direct-test-id',
      name: '周末电影',
      mediaKind: 'mp4'
    })
  })

  it('rejects HTTP permanently without probing or offering force add', async () => {
    const probe = vi.fn()
    const { wrapper, service } = mountSheet({ probe })

    await wrapper.get('[data-testid="direct-url"]').setValue(
      'http://cdn.example.test/movie.mp4?secret=never-render'
    )
    await wrapper.get('[data-testid="direct-save"]').trigger('click')

    expect(wrapper.get('[role="alert"]').text()).toBe(
      '请输入有效的 HTTPS 媒体链接'
    )
    expect(wrapper.find('[data-testid="direct-force"]').exists()).toBe(false)
    expect(probe).not.toHaveBeenCalled()
    expect(service.list()).toEqual([])
  })

  it('accepts known MP4 and M3U8 paths immediately without a HEAD probe', async () => {
    const probe = vi.fn()
    const { wrapper, service } = mountSheet({ probe })

    await wrapper.get('[data-testid="direct-url"]').setValue(
      'https://cdn.example.test/live/index.m3u8?signature=private'
    )
    await wrapper.get('[data-testid="direct-save"]').trigger('click')

    expect(probe).not.toHaveBeenCalled()
    expect(service.list()).toMatchObject([{ mediaKind: 'hls' }])
    expect(wrapper.emitted('saved')).toHaveLength(1)
  })

  it('shows loading while probing and accepts a supported Content-Type', async () => {
    const pending = deferred<string | undefined>()
    const probe = vi.fn(() => pending.promise)
    const { wrapper, service } = mountSheet({ probe })

    await wrapper.get('[data-testid="direct-url"]').setValue(
      'https://cdn.example.test/media?id=private'
    )
    void wrapper.get('[data-testid="direct-save"]').trigger('click')
    await wrapper.vm.$nextTick()

    expect(wrapper.get('[data-testid="direct-save"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[data-testid="direct-save"]').text()).toContain('正在验证')

    pending.resolve('Video/MP4; charset=utf-8')
    await flushPromises()

    expect(probe).toHaveBeenCalledWith(
      'https://cdn.example.test/media?id=private'
    )
    expect(service.list()).toMatchObject([{ mediaKind: 'mp4' }])
    expect(wrapper.emitted('saved')).toHaveLength(1)
  })

  it('rejects an unknown webpage first, redacts its query in errors, then stores explicit unverified state', async () => {
    const probe = vi.fn().mockResolvedValue('text/html; charset=utf-8')
    const { wrapper, service } = mountSheet({ probe })
    const privateQuery = 'private-query-must-not-appear'

    await wrapper.get('[data-testid="direct-url"]').setValue(
      `https://example.test/watch?token=${privateQuery}`
    )
    await wrapper.get('[data-testid="direct-save"]').trigger('click')
    await flushPromises()

    const errorText = wrapper.get('[role="alert"]').text()
    expect(errorText).toBe('无法确认该链接是可播放的媒体链接')
    expect(errorText).not.toContain(privateQuery)
    expect(service.list()).toEqual([])

    await wrapper.get('[data-testid="direct-force"]').trigger('click')

    expect(service.list()).toMatchObject([{ mediaKind: 'unverified' }])
    expect(wrapper.emitted('saved')).toHaveLength(1)
  })

  it('offers force add only after a failed probe and never includes the thrown value in the error', async () => {
    const probe = vi.fn().mockRejectedValue(
      new Error('https://private.test/?access_token=do-not-render')
    )
    const { wrapper } = mountSheet({ probe })

    await wrapper.get('[data-testid="direct-url"]').setValue(
      'https://cdn.example.test/opaque?signature=private'
    )
    expect(wrapper.find('[data-testid="direct-force"]').exists()).toBe(false)

    await wrapper.get('[data-testid="direct-save"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[role="alert"]').text()).toBe(
      '无法确认该链接是可播放的媒体链接'
    )
    expect(wrapper.get('[role="alert"]').text()).not.toContain('access_token')
    expect(wrapper.find('[data-testid="direct-force"]').exists()).toBe(true)
  })

  it('treats a non-success HEAD response as unverified even with a media Content-Type', async () => {
    const { wrapper, service } = mountSheet()

    await wrapper.get('[data-testid="direct-url"]').setValue(
      'https://cdn.example.test/opaque?signature=private'
    )
    void wrapper.get('[data-testid="direct-save"]').trigger('click')
    await wrapper.vm.$nextTick()

    const requestOptions = vi.mocked(uni.request).mock.calls[0]?.[0]
    expect(requestOptions).toBeDefined()
    requestOptions?.success?.({
      data: '',
      statusCode: 404,
      header: { 'content-type': 'video/mp4' },
      cookies: []
    } as UniApp.RequestSuccessCallbackResult)
    await flushPromises()

    expect(service.list()).toEqual([])
    expect(wrapper.get('[role="alert"]').text()).toBe(
      '无法确认该链接是可播放的媒体链接'
    )
    expect(wrapper.find('[data-testid="direct-force"]').exists()).toBe(true)
  })

  it('invalidates a pending probe when closed and reopened with the same URL', async () => {
    const pending = deferred<string | undefined>()
    const { wrapper, service } = mountSheet({
      probe: vi.fn(() => pending.promise)
    })
    const candidate = 'https://cdn.example.test/same-stream'

    await wrapper.get('[data-testid="direct-url"]').setValue(candidate)
    void wrapper.get('[data-testid="direct-save"]').trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true })
    await wrapper.get('[data-testid="direct-url"]').setValue(candidate)

    pending.resolve('video/mp4')
    await flushPromises()

    expect(service.list()).toEqual([])
    expect(wrapper.emitted('saved')).toBeUndefined()
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="direct-save"]').attributes('disabled')).toBeUndefined()
  })

  it('invalidates a pending probe when switching records that share a URL', async () => {
    const randomUUID = vi
      .fn()
      .mockReturnValueOnce('record-1')
      .mockReturnValueOnce('record-2')
    vi.stubGlobal('crypto', { randomUUID })
    const service = new DirectLinkService(createMemoryStorage(), { now: () => 1000 })
    const sharedUrl = 'https://cdn.example.test/shared-stream'
    const first = service.add({ url: sharedUrl, name: 'First' }, 'video/mp4')
    const second = service.add({ url: sharedUrl, name: 'Second' }, 'video/mp4')
    const pending = deferred<string | undefined>()
    const wrapper = mount(DirectLinkSheet, {
      props: {
        open: true,
        service,
        record: first,
        probe: vi.fn(() => pending.promise)
      }
    })

    await wrapper.get('[data-testid="direct-name"]').setValue('Stale edit')
    void wrapper.get('[data-testid="direct-save"]').trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.setProps({ record: second })
    pending.resolve('video/mp4')
    await flushPromises()

    expect(service.list().map(({ id, name }) => ({ id, name }))).toEqual([
      { id: 'record-1', name: 'First' },
      { id: 'record-2', name: 'Second' }
    ])
    expect(wrapper.emitted('saved')).toBeUndefined()
  })

  it('keeps the newer probe loading and ignores out-of-order older resolution', async () => {
    const first = deferred<string | undefined>()
    const second = deferred<string | undefined>()
    const probe = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const { wrapper, service } = mountSheet({ probe })

    await wrapper.get('[data-testid="direct-url"]').setValue(
      'https://cdn.example.test/first-stream'
    )
    void wrapper.get('[data-testid="direct-save"]').trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.get('[data-testid="direct-url"]').setValue(
      'https://cdn.example.test/second-stream'
    )
    await wrapper.get('[data-testid="direct-save"]').trigger('click')

    expect(probe).toHaveBeenCalledTimes(2)
    first.resolve('video/mp4')
    await flushPromises()

    expect(service.list()).toEqual([])
    expect(wrapper.get('[data-testid="direct-save"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[data-testid="direct-save"]').text()).toContain('正在验证')

    second.resolve('application/x-mpegurl')
    await flushPromises()

    expect(service.list()).toMatchObject([
      {
        url: 'https://cdn.example.test/second-stream',
        mediaKind: 'hls'
      }
    ])
  })

  it('invalidates a pending probe when the service instance changes', async () => {
    const pending = deferred<string | undefined>()
    const firstService = new DirectLinkService(createMemoryStorage(), { now: () => 1000 })
    const secondService = new DirectLinkService(createMemoryStorage(), { now: () => 1000 })
    const wrapper = mount(DirectLinkSheet, {
      props: {
        open: true,
        service: firstService,
        probe: vi.fn(() => pending.promise)
      }
    })

    await wrapper.get('[data-testid="direct-url"]').setValue(
      'https://cdn.example.test/service-stream'
    )
    void wrapper.get('[data-testid="direct-save"]').trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.setProps({ service: secondService })
    pending.resolve('video/mp4')
    await flushPromises()

    expect(firstService.list()).toEqual([])
    expect(secondService.list()).toEqual([])
    expect(wrapper.emitted('saved')).toBeUndefined()
  })

  it('does not save or emit after unmounting while a probe is pending', async () => {
    const pending = deferred<string | undefined>()
    const { wrapper, service } = mountSheet({
      probe: vi.fn(() => pending.promise)
    })

    await wrapper.get('[data-testid="direct-url"]').setValue(
      'https://cdn.example.test/unmounted-stream'
    )
    void wrapper.get('[data-testid="direct-save"]').trigger('click')
    await wrapper.vm.$nextTick()
    wrapper.unmount()
    pending.resolve('video/mp4')
    await flushPromises()

    expect(service.list()).toEqual([])
    expect(wrapper.emitted('saved')).toBeUndefined()
  })

  it('edits a record while preserving its ID and original addedAt', async () => {
    const storage = createMemoryStorage()
    const service = new DirectLinkService(storage, { now: () => 1000 })
    const original = service.add({
      url: 'https://cdn.example.test/original.mp4',
      name: 'Original'
    })
    const wrapper = mount(DirectLinkSheet, {
      props: { open: true, service, record: original }
    })

    await wrapper.get('[data-testid="direct-url"]').setValue(
      'https://cdn.example.test/replacement.m3u8'
    )
    await wrapper.get('[data-testid="direct-name"]').setValue('Replacement')
    await wrapper.get('[data-testid="direct-save"]').trigger('click')

    expect(wrapper.emitted<DirectVideoRecord[]>('saved')?.[0]?.[0]).toEqual({
      id: original.id,
      name: 'Replacement',
      url: 'https://cdn.example.test/replacement.m3u8',
      mediaKind: 'hls',
      addedAt: original.addedAt
    })
  })

  it('deletes only after confirmation and emits the deleted ID', async () => {
    const storage = createMemoryStorage()
    const service = new DirectLinkService(storage, { now: () => 1000 })
    const original = service.add({
      url: 'https://cdn.example.test/original.mp4'
    })
    vi.mocked(uni.showModal).mockImplementation((options) => {
      options?.success?.({ confirm: true, cancel: false } as UniApp.ShowModalRes)
      return undefined as never
    })
    const wrapper = mount(DirectLinkSheet, {
      props: { open: true, service, record: original }
    })

    await wrapper.get('[data-testid="direct-delete"]').trigger('click')

    expect(uni.showModal).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '删除媒体直链',
        confirmText: '删除'
      })
    )
    expect(service.list()).toEqual([])
    expect(wrapper.emitted('deleted')).toEqual([[original.id]])
  })
})

function mountSheet(options: {
  probe?: (url: string) => Promise<string | undefined>
} = {}) {
  const service = new DirectLinkService(createMemoryStorage(), {
    now: () => 1000
  })
  const wrapper = mount(DirectLinkSheet, {
    props: {
      open: true,
      service,
      ...(options.probe ? { probe: options.probe } : {})
    }
  })

  return { wrapper, service }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}
