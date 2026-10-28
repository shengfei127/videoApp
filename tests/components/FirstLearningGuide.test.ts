import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import FirstLearningGuide from '@/components/FirstLearningGuide.vue'
import { readLearningGuideStatus } from '@/features/onboarding/learningGuide'
import { uniStorage } from '@/infrastructure/storage'

describe('FirstLearningGuide', () => {
  it('routes each stage without prematurely completing onboarding', async () => {
    const wrapper = mount(FirstLearningGuide, { props: { hasVideos: false, hasCourses: false } })
    await wrapper.get('[data-testid="learning-guide-start"]').trigger('click')
    expect(uni.navigateTo).toHaveBeenLastCalledWith({ url: '/pages/library/index?learningGuide=1' })
    await wrapper.setProps({ hasVideos: true })
    await wrapper.get('[data-testid="learning-guide-start"]').trigger('click')
    expect(uni.navigateTo).toHaveBeenLastCalledWith({ url: '/pages/daily-unlock/index?learningGuide=1' })
    expect(readLearningGuideStatus(uniStorage)).toBe('active')
    await wrapper.setProps({ hasCourses: true })
    expect(wrapper.find('[data-testid="learning-guide"]').exists()).toBe(false)
    expect(readLearningGuideStatus(uniStorage)).toBe('completed')
  })
  it('retains skipping across remounts', async () => {
    const props = { hasVideos: false, hasCourses: false }
    const wrapper = mount(FirstLearningGuide, { props })
    await wrapper.get('[data-testid="learning-guide-skip"]').trigger('click')
    wrapper.unmount()
    expect(mount(FirstLearningGuide, { props }).find('[data-testid="learning-guide"]').exists()).toBe(false)
  })
  it('keeps the guide visible when skipping cannot be persisted', async () => {
    vi.spyOn(uni, 'setStorageSync').mockImplementation(() => { throw new Error('full') })
    const wrapper = mount(FirstLearningGuide, { props: { hasVideos: false, hasCourses: false } })
    await wrapper.get('[data-testid="learning-guide-skip"]').trigger('click')
    expect(wrapper.get('[role="alert"]').text()).toContain('暂未能保存')
    expect(wrapper.find('[data-testid="learning-guide"]').exists()).toBe(true)
  })
  it('does not ask existing-course users to onboard again', () => {
    const wrapper = mount(FirstLearningGuide, { props: { hasVideos: true, hasCourses: true } })
    expect(wrapper.find('[data-testid="learning-guide"]').exists()).toBe(false)
    expect(readLearningGuideStatus(uniStorage)).toBe('completed')
  })
})
