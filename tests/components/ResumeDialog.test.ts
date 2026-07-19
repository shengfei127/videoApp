import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import ResumeDialog from '@/components/ResumeDialog.vue'
import type { PlaybackProgress } from '@/domain/video'

const resumable: PlaybackProgress = {
  videoId: 'baidu:episode-1',
  positionSeconds: 386,
  durationSeconds: 1_560,
  updatedAt: 1_800_000_000_000,
  completed: false
}

describe('ResumeDialog', () => {
  it('shows the saved position with continue then restart controls when progress is resumable', () => {
    const wrapper = mount(ResumeDialog, {
      props: { open: true, progress: resumable }
    })

    expect(wrapper.get('[role="dialog"]').attributes('aria-modal')).toBe('true')
    expect(wrapper.get('h2').text()).toBe('继续播放')
    expect(wrapper.get('[data-testid="resume-saved-position"]').text()).toBe(
      '上次看到 06:26'
    )
    const buttons = wrapper.findAll('button')
    expect(buttons.map((button) => button.text())).toEqual([
      expect.stringContaining('继续播放'),
      expect.stringContaining('从头播放')
    ])
    expect(buttons.map((button) => button.attributes('data-testid'))).toEqual([
      'resume-continue',
      'resume-restart'
    ])
    expect(wrapper.find('.resume-dialog__panel').classes()).toContain(
      'resume-dialog__panel'
    )
    expect(wrapper.findAll('.resume-dialog__panel .resume-dialog__panel')).toHaveLength(0)
  })

  it('emits the selected action once without rendering invalid progress as resumable', async () => {
    const wrapper = mount(ResumeDialog, {
      props: { open: true, progress: resumable }
    })

    await wrapper.get('[data-testid="resume-continue"]').trigger('click')
    await wrapper.get('[data-testid="resume-restart"]').trigger('click')

    expect(wrapper.emitted('continue')).toEqual([[]])
    expect(wrapper.emitted('restart')).toEqual([[]])

    await wrapper.setProps({
      progress: {
        ...resumable,
        positionSeconds: 29
      }
    })
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
  })
})
