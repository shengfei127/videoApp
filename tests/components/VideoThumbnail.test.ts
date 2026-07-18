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
    expect(fallback.find('svg').exists()).toBe(true)
  })

  it.each([
    undefined,
    '',
    'http://images.example.test/still.jpg',
    'https://viewer:secret@images.example.test/still.jpg',
    'https://images.example.test/still.jpg#private',
    'https://images.example.test/still.jpg?access_token=secret',
    'https://images.example.test/still.jpg?ACCESS_TOKEN=secret'
  ])('starts in fallback mode for an unsafe or missing source: %s', (src) => {
    const wrapper = mount(VideoThumbnail, {
      props: { src, alt: '无封面视频' }
    })

    expect(wrapper.find('[data-testid="video-thumbnail-image"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="video-thumbnail-fallback"]').attributes('aria-label')).toBe(
      '无封面视频的缩略图不可用'
    )
  })
})
