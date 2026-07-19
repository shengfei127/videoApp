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
