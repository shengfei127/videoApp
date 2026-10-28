import { expect, test, type Page } from '@playwright/test'

const SEA = 'baidu:1001'
const MOUNTAIN = 'baidu:700000000000000003'
const LIVE = 'direct:00000000-0000-4000-8000-000000000001'
const DRAFT_KEY = 'pianke:course-draft:v1'

async function openManager(page: Page) {
  await page.locator('.bottom-nav').getByLabel('设置').click()
  await page.locator('.settings-menu-row').filter({ hasText: '每日课程' }).click()
  await page.getByTestId('daily-unlock-manage').click()
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 })
})

test('missing draft lessons can be removed individually and together while preserving manual order', async ({ page }) => {
  await page.goto('/?scenario=library#/pages/home/index', { waitUntil: 'domcontentloaded' })
  await expect(page.locator('.bottom-nav')).toBeVisible()
  await page.evaluate(({ key, sea, mountain, live }) => {
    ;(window as any).uni.setStorageSync(key, JSON.stringify({
      name: '恢复后继续学习', selectionMode: 'videos', sourceFolderPath: '',
      dailyEpisodeCount: 1, startEpisodeNumber: 1,
      episodes: [
        { videoId: mountain, name: '第10站·山间.mp4', sourceType: 'baidu', path: '/apps/片刻/旅行10/清晨/第10站·山间.mp4' },
        { videoId: 'baidu:998', name: '失效课程甲', sourceType: 'baidu', path: '/apps/片刻/失效甲.mp4' },
        { videoId: sea, name: '第2站·海边.mp4', sourceType: 'baidu', path: '/apps/片刻/旅行2/第2站·海边.mp4' },
        { videoId: 'baidu:999', name: '失效课程乙', sourceType: 'baidu', path: '/apps/片刻/失效乙.mp4' },
        { videoId: live, name: '示例直播流', sourceType: 'direct' }
      ]
    }))
  }, { key: DRAFT_KEY, sea: SEA, mountain: MOUNTAIN, live: LIVE })
  await openManager(page)
  await page.getByTestId('restore-draft').click()
  await expect(page.getByTestId('draft-missing-sources')).toContainText('2')
  await page.screenshot({ path: 'artifacts/round7/draft-missing-320.png', fullPage: true })
  await page.locator('[data-testid="remove-missing-draft-episode"][data-video-id="baidu:998"]').click()
  await expect(page.getByTestId('draft-missing-sources')).toContainText('1')
  await page.getByTestId('remove-all-missing-draft-episodes').click()
  await expect(page.getByTestId('draft-missing-sources')).toHaveCount(0)
  await page.getByLabel('返回设置', { exact: true }).click()
  await page.getByTestId('daily-unlock-manage').click()
  await page.getByTestId('restore-draft').click()
  await page.getByTestId('create-course').click()
  const ids = await page.evaluate(() => JSON.parse((window as any).uni.getStorageSync('pianke:daily-unlock:v1')).courses[0].episodes.map((episode: any) => episode.videoId))
  expect(ids).toEqual([MOUNTAIN, SEA, LIVE])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  await page.screenshot({ path: 'artifacts/round7/draft-recovered-320.png', fullPage: true })
})

test('leaving immediately after input flushes the debounce and restores the final name', async ({ page }) => {
  await page.goto('/?scenario=library#/pages/home/index', { waitUntil: 'domcontentloaded' })
  await openManager(page)
  await page.clock.install()
  await page.clock.pauseAt(new Date())
  await page.getByTestId('course-name').locator('input').fill('立即返回也要保留的草稿')
  await page.getByLabel('返回设置', { exact: true }).click()
  const saved = await page.evaluate((key) => JSON.parse((window as any).uni.getStorageSync(key)), DRAFT_KEY)
  expect(saved.name).toBe('立即返回也要保留的草稿')
  await page.clock.resume()
  await page.getByTestId('daily-unlock-manage').click()
  await page.getByTestId('restore-draft').click()
  await expect(page.getByTestId('course-name').locator('input')).toHaveValue('立即返回也要保留的草稿')
  await page.screenshot({ path: 'artifacts/round7/draft-immediate-leave-320.png', fullPage: true })
})
