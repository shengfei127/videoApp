import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import VideoThumbnail from '@/components/VideoThumbnail.vue'

describe('VideoThumbnail', () => {
  it('replaces a failed safe HTTPS image with a stable accessible Film fallback', async () => {
    const src = 'https://images.example.test/still.jpg?width=640'
    const wrapper = mount(VideoThumbnail, {
      props: { src, alt: '海边散步' }
    })

    const image = wrapper.get('[data-testid="video-thumbnail-image"]')
    expect(image.attributes('src')).toBe(src)
    expect(image.attributes('mode')).toBe('aspectFill')
    expect(image.attributes('lazy-load')).toBe('true')
    expect(wrapper.find('[data-testid="video-thumbnail-fallback"]').exists()).toBe(false)

    await image.trigger('error')

    expect(wrapper.find('[data-testid="video-thumbnail-image"]').exists()).toBe(false)
    const fallback = wrapper.get('[data-testid="video-thumbnail-fallback"]')
    expect(fallback.attributes('role')).toBe('img')
    expect(fallback.attributes('aria-label')).toBe('海边散步的缩略图不可用')
    expect(fallback.find('image').attributes('src')).toBe('/static/icons/Film.png')
  })

  it('retries when a failed source is replaced by a different safe URL', async () => {
    const failedSrc = 'https://images.example.test/failed.jpg'
    const replacementSrc = 'https://images.example.test/replacement.jpg?quality=80'
    const wrapper = mount(VideoThumbnail, {
      props: { src: failedSrc, alt: '可恢复封面' }
    })

    await wrapper.get('[data-testid="video-thumbnail-image"]').trigger('error')
    expect(wrapper.find('[data-testid="video-thumbnail-image"]').exists()).toBe(false)

    await wrapper.setProps({ src: replacementSrc })

    const replacement = wrapper.find('[data-testid="video-thumbnail-image"]')
    expect(replacement.exists()).toBe(true)
    expect(replacement.attributes('src')).toBe(replacementSrc)
    expect(wrapper.find('[data-testid="video-thumbnail-fallback"]').exists()).toBe(false)
  })

  it.each([
    undefined,
    '',
    'http://images.example.test/still.jpg',
    'https://viewer:secret@images.example.test/still.jpg',
    'https://images.example.test/still.jpg#private',
    'https://images.example.test/still.jpg?access_token=secret',
    'https://images.example.test/still.jpg?ACCESS_TOKEN=secret',
    'https://images.example.test/still.jpg?ToKeN=secret',
    'https://images.example.test/still.jpg?SESSION_TOKEN=secret',
    'https://images.example.test/still.jpg?session-ToKeN=secret',
    'https://images.example.test/still.jpg?Authorization=Bearer%20secret',
    'https://images.example.test/still.jpg?DLINK=signed-download',
    'https://images.example.test/still.jpg?next=access_token%3Dsecret',
    'https://images.example.test/still.jpg?next=https%3A%2F%2Fexample.test%2Faccess_token%3Dsecret',
    'https://images.example.test/still.jpg?next=ToKeN%3Dsecret',
    'https://images.example.test/still.jpg?next=session_token%3Dsecret',
    'https://images.example.test/still.jpg?next=session-token%3Dsecret',
    'https://images.example.test/still.jpg?header=AUTHORIZATION%3DBearer%20secret',
    'https://images.example.test/still.jpg?next=dLiNk%3Dsigned-download',
    'https://images.example.test/still.jpg?header=Bearer%20secret'
  ])('starts in fallback mode for an unsafe or missing source: %s', (src) => {
    const wrapper = mount(VideoThumbnail, {
      props: { src, alt: '无封面视频' }
    })

    expect(wrapper.find('[data-testid="video-thumbnail-image"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="video-thumbnail-fallback"]').attributes('aria-label')).toBe(
      '无封面视频的缩略图不可用'
    )
  })

  it('keeps benign sign, signature, and quality query parameters visible', () => {
    const src =
      'https://images.example.test/still.jpg?sign=thumbnail-sign&signature=thumbnail-signature&quality=80'
    const wrapper = mount(VideoThumbnail, {
      props: { src, alt: '可用封面' }
    })

    expect(wrapper.get('[data-testid="video-thumbnail-image"]').attributes('src')).toBe(
      src
    )
    expect(wrapper.find('[data-testid="video-thumbnail-fallback"]').exists()).toBe(false)
  })
})
