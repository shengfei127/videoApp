import { expect, test, type Page } from '@playwright/test'

const BAIDU_RESUME_VIDEO_ID = 'baidu:1001'
const BAIDU_RESUME_PATH = '/apps/片刻/旅行2/第2站·海边.mp4'

async function openScenario(
  page: Page,
  scenario: 'first-run' | 'library' | 'resume' | 'baidu-error',
  route: string
): Promise<void> {
  await page.goto(`/?scenario=${scenario}#${route}`, {
    waitUntil: 'domcontentloaded'
  })
}

async function mockBaiduPlayback(
  page: Page,
  onMultimediaRequest?: () => void
): Promise<void> {
  await page.route('**/rest/2.0/xpan/multimedia**', async (route) => {
    onMultimediaRequest?.()
    const fsId = new URL(route.request().url()).searchParams.get('fsids')?.slice(1, -1)
    const path = fsId === '700000000000000003'
      ? '/apps/片刻/旅行10/清晨/第10站·山间.mp4'
      : BAIDU_RESUME_PATH
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        errno: 0,
        list: [
          {
            fs_id: fsId,
            path,
            dlink: 'https://d.pcs.baidu.com/file/playwright-resume.mp4'
          }
        ]
      })
    })
  })
  await page.route('https://d.pcs.baidu.com/**', async (route) => {
    // Keep the media element mounted while this UI test supplies metadata.
    await new Promise<void>(() => {})
  })
}

async function acceptNativeModal(page: Page): Promise<void> {
  await page.evaluate(() => {
    const h5Uni = (window as unknown as { uni: unknown }).uni as {
      showModal?: (options: {
        success?: (result: { confirm: boolean; cancel: boolean }) => void
      }) => void
    }

    h5Uni.showModal = (options) => {
      options.success?.({ confirm: true, cancel: false })
    }
  })
}

test('first-run home keeps history empty and source actions remain reachable', async ({ page }) => {
  await openScenario(page, 'first-run', '/pages/home/index')
  await expect(page.getByText('最近看过', { exact: true })).toHaveCount(0)
  await expect(page.locator('.home-sources')).toHaveCount(0)
  await page.locator('.bottom-nav').getByLabel('视频库').click()
  await expect(page.getByTestId('library-add')).toBeVisible()
  await page.locator('.bottom-nav').getByLabel('设置').click()
  await page.locator('.settings-menu-row').filter({hasText:'百度网盘'}).click()
  await expect(page.locator('[aria-label="连接百度网盘"]')).toBeVisible()
})

test('mock OAuth returns to a connected home', async ({ page }) => {
  await openScenario(page, 'first-run', '/pages/home/index')

  await page.locator('.bottom-nav').getByLabel('设置').click()
  await page.locator('.settings-menu-row').filter({hasText:'百度网盘'}).click()
  await page.locator('[aria-label="连接百度网盘"]').click()
  await page.getByTestId('oauth-start').click()
  await expect(page).toHaveURL(/#(?:\/|\/pages\/home\/index)$/u)
  await expect(
    page.locator('[aria-label="连接百度网盘"]')
  ).toHaveCount(0)

  await expect(page.locator('.home-header__status')).toHaveCount(0)

  await page.locator('[aria-label="设置"]').click()
  await expect(page.locator('.settings-menu-row').getByText('已连接', { exact: true })).toBeVisible()
})

test('library switches views and filters a Chinese video title', async ({ page }) => {
  await openScenario(page, 'library', '/pages/library/index')

  const recent = page.locator('.library-segment__button', {
    hasText: '最近'
  })
  const folders = page.locator('.library-segment__button', {
    hasText: '文件夹'
  })
  await expect(recent).toHaveAttribute('aria-pressed', 'true')
  await expect(
    page.locator('[aria-label="播放视频：城市漫步.mp4"]')
  ).toBeVisible()

  await folders.click()
  await expect(folders).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('folder-row')).toHaveCount(2)

  await recent.click()
  await page.getByTestId('library-search').locator('input').fill('城市漫步')
  await expect(
    page.locator('[aria-label="播放视频：城市漫步.mp4"]')
  ).toBeVisible()
  await expect(
    page.locator('[aria-label="播放视频：第2站·海边.mp4"]')
  ).toHaveCount(0)
})

test('home hides empty history and avoids repeating the current resume video', async ({ page }) => {
  await mockBaiduPlayback(page)
  await openScenario(page, 'library', '/pages/home/index')

  const recentSection = page.locator('[data-home-section="recent"]')
  await expect(recentSection).toHaveCount(0)
  await expect(recentSection.locator('.video-row')).toHaveCount(0)

  await page.locator('.bottom-nav__item').nth(1).click()
  await page.locator('[aria-label="播放视频：第2站·海边.mp4"]').click()
  await expect(page.locator('video[data-testid="player-video"]')).toBeVisible()

  await page.locator('video[data-testid="player-video"]').evaluate((element) => {
    const media = element as HTMLVideoElement
    Object.defineProperty(media, 'duration', {
      configurable: true,
      value: 1560
    })
    Object.defineProperty(media, 'currentTime', {
      configurable: true,
      get: () => 386
    })
    media.dispatchEvent(new Event('loadedmetadata', { bubbles: true }))
    media.dispatchEvent(new Event('play', { bubbles: true }))
    const update = new Event('timeupdate', { bubbles: true })
    Object.defineProperty(update, 'detail', {
      value: { currentTime: 386, duration: 1560 }
    })
    media.dispatchEvent(update)
  })
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const records = JSON.parse(
          localStorage.getItem('pianke:progress:v1') ?? '[]'
        ) as Array<{ videoId: string }>
        return records.map((record) => record.videoId)
      })
    )
    .toContain(BAIDU_RESUME_VIDEO_ID)

  await page.locator('[data-testid="player-back"]').click()
  await page.locator('.bottom-nav__item').nth(0).click()
  await expect(recentSection).toHaveCount(0)
  await expect(page.locator('[data-home-section="continue"]')).toContainText('第2站·海边.mp4')
  await expect(
    recentSection.locator('[aria-label="播放视频：城市漫步.mp4"]')
  ).toHaveCount(0)
})

test('daily course locks the next episode until local midnight', async ({ page }, testInfo) => {
  let multimediaRequests = 0
  await page.clock.install({
    time: await page.evaluate(() => {
      const date = new Date()
      date.setFullYear(2026, 9, 27)
      date.setHours(12, 0, 0, 0)
      return date.getTime()
    })
  })
  await mockBaiduPlayback(page, () => {
    multimediaRequests += 1
  })
  await openScenario(page, 'library', '/pages/home/index')

  await page.locator('.bottom-nav').getByLabel('设置').click()
  await page.locator('.settings-menu-row').filter({hasText:'每日课程'}).click()
  await page.getByRole('switch', { name: '每日解锁课程' }).click()
  await page.screenshot({ path: testInfo.outputPath('settings.png'), fullPage: true })
  await page.getByTestId('daily-unlock-manage').click()
  await page.getByTestId('mode-videos').click()
  await page.getByTestId('course-name').locator('input').fill('每日试听课')
  await page.locator('[data-video-id="baidu:1001"]').click()
  await page.locator('[data-video-id="baidu:700000000000000003"]').click()
  await expect(page.getByTestId('episode-preview')).toContainText('1. 第2站·海边.mp4')
  await expect(page.getByTestId('episode-preview')).toContainText('2. 第10站·山间.mp4')
  await page.getByTestId('create-course').click()
  await expect(page.getByTestId('course-card')).toContainText('已开放 1 / 2 集')
  await expect(page.getByTestId('course-card')).toContainText('下一集 2026-10-28 00:00 开放')
  await page.screenshot({ path: testInfo.outputPath('course.png'), fullPage: true })

  await page.locator('[aria-label="返回设置"]').click()
  await page.locator('.bottom-nav').getByLabel('首页').click()
  await expect(page.locator('.bottom-nav__item')).toHaveCount(3)
  const todayLearning = page.locator('[data-home-section="today"]')
  await expect(todayLearning).toContainText('每日试听课 · 第 1 集')
  await expect(todayLearning).toContainText('第2站·海边.mp4')
  await expect(todayLearning).not.toContainText('第10站·山间.mp4')
  await page.screenshot({ path: testInfo.outputPath('home-today.png'), fullPage: true })
  await page.locator('.bottom-nav__item').nth(1).click()
  await page.locator('[aria-label="播放视频：第2站·海边.mp4"]').click()
  await expect(page.locator('video[data-testid="player-video"]')).toBeVisible()
  await expect.poll(() => multimediaRequests).toBe(1)
  await page.locator('[data-testid="player-back"]').click()

  const lockedEpisode = page.locator(
    '[aria-label="播放视频：第10站·山间.mp4（第2集待解锁）"]'
  )
  await expect(lockedEpisode).toBeVisible()
  const libraryUrl = page.url()
  await lockedEpisode.click()
  await expect(page).toHaveURL(libraryUrl)
  expect(multimediaRequests).toBe(1)

  await page.evaluate((videoId) => {
    const h5Uni = (window as unknown as {
      uni: { navigateTo: (options: { url: string }) => unknown }
    }).uni
    h5Uni.navigateTo({
      url: `/pages/player/index?id=${encodeURIComponent(videoId)}`
    })
  }, 'baidu:700000000000000003')
  await expect(page.getByTestId('player-locked')).toContainText('2026-10-28 00:00 解锁')
  expect(multimediaRequests).toBe(1)
  await page.clock.fastForward(12 * 60 * 60 * 1000)
  await expect(page.getByTestId('player-unlocked')).toBeVisible()
  expect(multimediaRequests).toBe(1)
  await page.getByTestId('player-start-unlocked').click()
  await expect(page.locator('video[data-testid="player-video"]')).toBeVisible()
  await expect.poll(() => multimediaRequests).toBe(2)
  await page.getByTestId('player-back').click()

  const availableEpisode = page.getByLabel('播放视频：第10站·山间.mp4', { exact: true })
  await expect(availableEpisode).toBeVisible()
  await page.locator('[aria-label="播放视频：第2站·海边.mp4"]').click()
  await expect(page.locator('video[data-testid="player-video"]')).toBeVisible()
  await expect.poll(() => multimediaRequests).toBe(3)
})

test('direct-link import rejects HTTP and accepts an HTTPS M3U8', async ({ page }) => {
  await openScenario(page, 'library', '/pages/library/index')

  await page.getByTestId('library-add').click()
  await expect(page.getByRole('dialog', { name: '导入媒体直链' })).toBeVisible()

  await page
    .getByTestId('direct-url')
    .locator('input')
    .fill('http://media.example.test/video.m3u8')
  await page.getByTestId('direct-save').click()
  await expect(page.getByRole('alert')).toHaveText('请输入有效的 HTTPS 媒体链接')

  await page
    .getByTestId('direct-url')
    .locator('input')
    .fill('https://media.example.test/剧集.m3u8')
  await page.getByTestId('direct-name').locator('input').fill('E2E HTTPS M3U8')
  await page.getByTestId('direct-save').click()
  await expect(page.getByRole('dialog', { name: '导入媒体直链' })).toHaveCount(0)
  await expect(
    page.locator('[aria-label="播放视频：E2E HTTPS M3U8"]')
  ).toBeVisible()
})

test('immersive player stage fills the viewport without CSS aspect-ratio', async ({ page }) => {
  await mockBaiduPlayback(page)
  await openScenario(
    page,
    'resume',
    `/pages/player/index?id=${encodeURIComponent(BAIDU_RESUME_VIDEO_ID)}`
  )
  await page.addStyleTag({
    content: '.player-stage { aspect-ratio: auto !important; }'
  })

  const stage = page.locator('.player-stage')
  await expect(stage).toBeVisible()
  await expect
    .poll(() => stage.evaluate((element) => element.getBoundingClientRect().height))
    .toBeGreaterThan(200)
})

test('resume dialog shows the exact timestamp and both choices', async ({ page }) => {
  const consoleErrors: string[] = []
  const pageErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text())
    }
  })
  page.on('pageerror', (error) => pageErrors.push(error.message))

  await mockBaiduPlayback(page)
  await openScenario(
    page,
    'resume',
    `/pages/player/index?id=${encodeURIComponent(BAIDU_RESUME_VIDEO_ID)}`
  )

  const video = page.locator('video[data-testid="player-video"]')
  await expect(video).toBeVisible()
  await video.evaluate((element) => {
    Object.defineProperty(element, 'duration', {
      configurable: true,
      value: 1560
    })
    element.dispatchEvent(new Event('loadedmetadata', { bubbles: true }))
  })

  await expect(page.getByTestId('resume-saved-position')).toHaveText(
    '上次看到 06:26'
  )
  await expect(page.getByTestId('resume-continue')).toBeVisible()
  await expect(page.getByTestId('resume-restart')).toBeVisible()
  expect(
    await page.evaluate(() =>
      document.activeElement?.getAttribute('data-testid')
    )
  ).toBe('resume-continue')
  await page.keyboard.press('Tab')
  expect(
    await page.evaluate(() =>
      document.activeElement?.getAttribute('data-testid')
    )
  ).toBe('resume-restart')
  await page.keyboard.press('Shift+Tab')
  expect(
    await page.evaluate(() =>
      document.activeElement?.getAttribute('data-testid')
    )
  ).toBe('resume-continue')
  await video.evaluate((element) => {
    const media = element as HTMLVideoElement
    let currentTime = 0
    Object.defineProperty(media, 'currentTime', {
      configurable: true,
      get: () => currentTime,
      set: (value: number) => {
        currentTime = value
      }
    })
    media.play = () => Promise.resolve()
  })
  await page.getByTestId('resume-continue').click()
  await expect
    .poll(() => video.evaluate((element) => (element as HTMLVideoElement).currentTime))
    .toBe(386)
  expect(pageErrors).toEqual([])
  expect(consoleErrors).toEqual([])
})

test('disconnecting Baidu keeps direct links and playback progress', async ({ page }) => {
  await mockBaiduPlayback(page)
  await openScenario(page, 'resume', '/pages/library/index')
  await page.getByTestId('library-add').click()
  await page
    .getByTestId('direct-url')
    .locator('input')
    .fill('https://media.example.test/preserved.m3u8')
  await page.getByTestId('direct-name').locator('input').fill('断开后保留')
  await page.getByTestId('direct-save').click()

  await openScenario(
    page,
    'resume',
    `/pages/player/index?id=${encodeURIComponent(BAIDU_RESUME_VIDEO_ID)}`
  )
  const video = page.locator('video[data-testid="player-video"]')
  await video.waitFor()
  await video.evaluate((element) => {
    Object.defineProperty(element, 'duration', {
      configurable: true,
      value: 1560
    })
    element.dispatchEvent(new Event('loadedmetadata', { bubbles: true }))
    Object.defineProperty(element, 'currentTime', { configurable: true, writable: true, value: 0 })
    ;(element as HTMLVideoElement).play = () => Promise.resolve()
  })
  await page.getByTestId('resume-continue').click()
  await video.evaluate((element) => {
    element.dispatchEvent(new Event('play', { bubbles: true }))
    const pause = new Event('pause', { bubbles: true })
    Object.defineProperty(pause, 'detail', {
      value: { currentTime: 420, duration: 1560 }
    })
    element.dispatchEvent(pause)
  })

  await openScenario(page, 'resume', '/pages/settings/index')
  await expect(page.getByText('1 条', { exact: true })).toHaveCount(2)
  const storedBeforeDisconnect = await page.evaluate(() => ({
    direct: localStorage.getItem('pianke:direct-videos:v1'),
    progress: localStorage.getItem('pianke:progress:v1')
  }))
  expect(storedBeforeDisconnect.direct).not.toBeNull()
  expect(storedBeforeDisconnect.progress).not.toBeNull()

  await acceptNativeModal(page)
  await page.locator('.settings-menu-row').filter({hasText:'百度网盘'}).click()
  await page.getByTestId('settings-disconnect').click()

  await expect(page.locator('.settings-menu-row').getByText('未连接', { exact: true })).toBeVisible()
  await expect(page.getByText('1 条', { exact: true })).toHaveCount(2)
  expect(
    await page.evaluate(() => ({
      direct: localStorage.getItem('pianke:direct-videos:v1'),
      progress: localStorage.getItem('pianke:progress:v1')
    }))
  ).toEqual(storedBeforeDisconnect)
})

test('long direct-link names do not overlap their edit button', async ({ page }) => {
  const longName = `${'超长中文视频名称'.repeat(10)}.m3u8`
  await openScenario(page, 'library', '/pages/library/index')

  await page.getByTestId('library-add').click()
  await page
    .getByTestId('direct-url')
    .locator('input')
    .fill('https://media.example.test/long-name.m3u8')
  await page.getByTestId('direct-name').locator('input').fill(longName)
  await page.getByTestId('direct-save').click()

  const videoRow = page.locator(`[aria-label="播放视频：${longName}"]`)
  const editButton = page.locator(`[aria-label="编辑媒体直链：${longName}"]`)
  await expect(videoRow).toBeVisible()
  await expect(editButton).toBeVisible()

  const [nameBox, editBox] = await Promise.all([
    videoRow.locator('.video-row__name').boundingBox(),
    editButton.boundingBox()
  ])
  expect(nameBox).not.toBeNull()
  expect(editBox).not.toBeNull()
  expect(nameBox!.y).toBeGreaterThanOrEqual(editBox!.y + editBox!.height)
})


test('course source labels stay centered in both selection states', async ({ page }) => {
  await openScenario(page, 'library', '/pages/daily-unlock/index')
  for (const selected of ['mode-folder', 'mode-videos', 'mode-folder']) {
    await page.getByTestId(selected).click()
    await expect(page.getByTestId(selected)).toHaveAttribute('aria-pressed', 'true')
    for (const id of ['mode-folder', 'mode-videos']) {
      const offset = await page.getByTestId(id).evaluate((button) => {
        const bounds = button.getBoundingClientRect()
        const range = document.createRange()
        range.selectNodeContents(button)
        const label = range.getBoundingClientRect()
        return {
          x: Math.abs(label.x + label.width / 2 - bounds.x - bounds.width / 2),
          y: Math.abs(label.y + label.height / 2 - bounds.y - bounds.height / 2)
        }
      })
      expect(offset.x, `${id} horizontal center`).toBeLessThan(2)
      expect(offset.y, `${id} vertical center`).toBeLessThan(2)
    }
  }
})
