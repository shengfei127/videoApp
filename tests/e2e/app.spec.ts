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

async function mockBaiduPlayback(page: Page): Promise<void> {
  await page.route('**/rest/2.0/xpan/multimedia**', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        errno: 0,
        list: [
          {
            fs_id: BAIDU_RESUME_VIDEO_ID.slice('baidu:'.length),
            path: BAIDU_RESUME_PATH,
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

test('first-run source actions are visible without scrolling', async ({ page }) => {
  await openScenario(page, 'first-run', '/pages/home/index')

  const connect = page.locator('[aria-label="连接百度网盘"]')
  const importLink = page.locator('[aria-label="导入媒体直链"]')
  await expect(connect).toBeVisible()
  await expect(importLink).toBeVisible()
  await expect(connect).toHaveAttribute('aria-label', '连接百度网盘')
  await expect(importLink).toHaveAttribute('aria-label', '导入媒体直链')
  expect(await page.evaluate(() => window.scrollY)).toBe(0)

  const viewport = page.viewportSize()
  const [connectBox, importBox] = await Promise.all([
    connect.boundingBox(),
    importLink.boundingBox()
  ])
  expect(viewport).not.toBeNull()
  expect(connectBox).not.toBeNull()
  expect(importBox).not.toBeNull()
  expect(connectBox!.y + connectBox!.height).toBeLessThanOrEqual(
    viewport!.height
  )
  expect(importBox!.y + importBox!.height).toBeLessThanOrEqual(
    viewport!.height
  )
})

test('mock OAuth returns to a connected home', async ({ page }) => {
  await openScenario(page, 'first-run', '/pages/home/index')

  await page.locator('[aria-label="连接百度网盘"]').click()
  await expect(page).toHaveURL(/#(?:\/|\/pages\/home\/index)$/u)
  await expect(
    page.locator('[aria-label="连接百度网盘"]')
  ).toHaveCount(0)

  await expect(page.getByText('同步状态：已同步', { exact: true })).toBeVisible()

  await page.locator('[aria-label="设置"]').click()
  await expect(page.getByText('已连接', { exact: true })).toBeVisible()
})

test('library switches views and filters a Chinese video title', async ({ page }) => {
  await openScenario(page, 'library', '/pages/library/index')

  const recent = page.locator('.library-segment__button', {
    hasText: '最近视频'
  })
  const folders = page.locator('.library-segment__button', {
    hasText: '按文件夹'
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

test('player stage stays 16:9 when CSS aspect-ratio is unavailable', async ({ page }) => {
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
  await page.getByTestId('settings-disconnect').click()

  await expect(page.getByText('未连接', { exact: true })).toBeVisible()
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

  const [rowBox, editBox] = await Promise.all([
    videoRow.boundingBox(),
    editButton.boundingBox()
  ])
  expect(rowBox).not.toBeNull()
  expect(editBox).not.toBeNull()
  expect(rowBox!.x + rowBox!.width).toBeLessThanOrEqual(editBox!.x + 1)
})
