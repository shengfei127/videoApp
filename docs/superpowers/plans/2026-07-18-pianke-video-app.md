# Pianke Video App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (<code>- [ ]</code>) syntax for tracking.

**Goal:** Build the Android-first uni-app “片刻”, supporting Baidu OAuth access to videos inside the app-specific folder, HTTPS MP4/M3U8 direct links, local playback history, and explicit resume playback.

**Architecture:** Vue pages consume one normalized video catalog. Baidu, direct-link, OAuth, storage, and playback concerns remain behind small adapters so the UI never handles tokens or provider response shapes. The H5 target uses guarded mock data for automated tests; Android App uses the real OAuth WebView, XPan APIs, and system video component.

**Tech Stack:** uni-app 3, Vue 3.4, TypeScript 5.4, Pinia 2, Vite 5.2, Vitest 1.6, Vue Test Utils, Playwright, Sass, lucide-vue-next

---

## Source Of Truth

Implement against <code>docs/superpowers/specs/2026-07-18-pianke-video-app-design.md</code>. The non-negotiable provider boundary is <code>/apps/{Baidu application name}</code>. Do not add share-link scraping, whole-drive playback, SecretKey use, a backend, or Baidu transcoding APIs.

## File Map

### Project and tooling

- Create <code>package.json</code>: pinned runtime, build, test, and security scripts.
- Create <code>.gitignore</code>: exclude dependencies, generated builds, local environment, npm cache, Playwright output, and visual-companion files.
- Create <code>.env.example</code>: public AppKey slot, app-folder name, OAuth callback, and mock toggle.
- Create <code>tsconfig.json</code>, <code>vite.config.ts</code>, <code>vitest.config.ts</code>, <code>playwright.config.ts</code>, <code>env.d.ts</code>: compile and test configuration.
- Create <code>index.html</code>, <code>src/main.ts</code>, <code>src/App.vue</code>, <code>src/pages.json</code>, <code>src/manifest.json</code>, <code>src/uni.scss</code>: minimal uni-app shell.
- Create <code>src/styles/tokens.scss</code>, <code>src/styles/global.scss</code>: “清爽影院” design tokens and global layout rules.

### Domain and infrastructure

- Create <code>src/config/runtime.ts</code>: validated build-time configuration.
- Create <code>src/domain/video.ts</code>: normalized video, folder, auth, direct-link, and progress types.
- Create <code>src/infrastructure/storage.ts</code>: typed, versioned wrapper around uni storage.
- Create <code>src/features/playback/progressPolicy.ts</code>: resume and completion rules.
- Create <code>src/features/playback/progressRepository.ts</code>: local progress persistence.
- Create <code>src/features/direct-links/directLinkService.ts</code>: URL validation and local direct-link records.
- Create <code>src/features/auth/oauth.ts</code>: pure OAuth URL, state, and callback logic.
- Create <code>src/features/auth/authRepository.ts</code>: pending OAuth and session persistence.
- Create <code>src/features/auth/oauthWebview.ts</code>: App WebView lifecycle and callback interception.
- Create <code>src/features/baidu/baiduErrors.ts</code>: public error mapping and token-safe diagnostics.
- Create <code>src/features/baidu/baiduTransport.ts</code>: injectable uni.request transport.
- Create <code>src/features/baidu/baiduDriveSource.ts</code>: videolist and filemetas operations.
- Create <code>src/features/catalog/folderTree.ts</code>: local folder tree derived from video paths.
- Create <code>src/features/catalog/catalogCache.ts</code>: 15-minute cache and 60-second refresh guard.
- Create <code>src/stores/appStore.ts</code>: orchestration across auth, providers, catalog, and progress.
- Create <code>src/mocks/fixtures.ts</code>, <code>src/mocks/bootstrap.ts</code>: H5-only deterministic scenarios.

### UI

- Create <code>src/components/BottomNav.vue</code>: icon navigation for home, library, and settings.
- Create <code>src/components/VideoThumbnail.vue</code>: provider thumbnail with stable fallback.
- Create <code>src/components/VideoRow.vue</code>: reusable video row.
- Create <code>src/components/DirectLinkSheet.vue</code>: validated import bottom sheet.
- Create <code>src/components/ResumeDialog.vue</code>: continue/from-start modal.
- Create <code>src/pages/home/index.vue</code>: source onboarding, continue watching, recent items.
- Create <code>src/pages/library/index.vue</code>: search and recent/folder segmented views.
- Create <code>src/pages/player/index.vue</code>: source resolution, video lifecycle, progress persistence.
- Create <code>src/pages/settings/index.vue</code>: connection status, privacy, cache, and destructive actions.
- Create <code>src/pages/oauth/index.vue</code>: launch and monitor the App OAuth WebView.

### Verification

- Create focused tests under <code>tests/unit</code> and <code>tests/components</code>.
- Create <code>tests/e2e/app.spec.ts</code>: mocked first-run, import, catalog, and resume flows.
- Create <code>scripts/scan-secrets.mjs</code>: repository/build secret-pattern scan.

---

### Task 1: Scaffold The uni-app Project And Test Harness

**Files:**
- Create: <code>package.json</code>
- Create: <code>.gitignore</code>
- Create: <code>.env.example</code>
- Create: <code>tsconfig.json</code>
- Create: <code>vite.config.ts</code>
- Create: <code>vitest.config.ts</code>
- Create: <code>env.d.ts</code>
- Create: <code>index.html</code>
- Create: <code>src/main.ts</code>
- Create: <code>src/App.vue</code>
- Create: <code>src/pages.json</code>
- Create: <code>src/manifest.json</code>
- Create: <code>src/uni.scss</code>
- Create: <code>src/styles/tokens.scss</code>
- Create: <code>src/styles/global.scss</code>
- Test: <code>tests/unit/runtime-config.test.ts</code>

- [ ] **Step 1: Add pinned package and script configuration**

Create <code>package.json</code> with this dependency set. Keep all DCloud packages on the same build number.

~~~json
{
  "name": "pianke-video-app",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "dev:h5": "uni",
    "build:h5": "uni build",
    "build:app": "uni build -p app",
    "type-check": "vue-tsc --noEmit -p tsconfig.json",
    "test": "vitest",
    "test:run": "vitest run",
    "test:coverage": "vitest run --coverage",
    "e2e": "playwright test",
    "security:scan": "node scripts/scan-secrets.mjs",
    "check": "npm run type-check && npm run test:run && npm run build:h5 && npm run security:scan"
  },
  "dependencies": {
    "@dcloudio/uni-app": "3.0.0-5010520260709002",
    "@dcloudio/uni-app-plus": "3.0.0-5010520260709002",
    "@dcloudio/uni-components": "3.0.0-5010520260709002",
    "@dcloudio/uni-h5": "3.0.0-5010520260709002",
    "lucide-vue-next": "0.468.0",
    "pinia": "2.1.7",
    "vue": "3.4.21",
    "vue-i18n": "9.14.5"
  },
  "devDependencies": {
    "@dcloudio/types": "3.4.31",
    "@dcloudio/uni-cli-shared": "3.0.0-5010520260709002",
    "@dcloudio/vite-plugin-uni": "3.0.0-5010520260709002",
    "@playwright/test": "1.49.1",
    "@types/node": "20.14.2",
    "@vitejs/plugin-vue": "5.0.4",
    "@vitest/coverage-v8": "1.6.1",
    "@vue/test-utils": "2.4.6",
    "@vue/tsconfig": "0.5.1",
    "cross-env": "7.0.3",
    "happy-dom": "14.12.3",
    "sass": "1.77.8",
    "typescript": "5.4.5",
    "vite": "5.2.8",
    "vitest": "1.6.1",
    "vue-tsc": "2.0.19"
  }
}
~~~

- [ ] **Step 2: Add ignore and local environment contracts**

~~~gitignore
node_modules/
dist/
coverage/
playwright-report/
test-results/
.npm-cache/
.superpowers/
.env
.env.*
!.env.example
*.local
~~~

~~~dotenv
VITE_BAIDU_APP_KEY=
VITE_BAIDU_APP_FOLDER=片刻
VITE_BAIDU_REDIRECT_URI=https://localhost/pianke/oauth/baidu
VITE_USE_MOCKS=false
~~~

- [ ] **Step 3: Add compiler and runner configuration**

Use uni only for production builds and the standard Vue plugin for Vitest component compilation.

~~~ts
// vite.config.ts
import { defineConfig } from 'vite'
import uni from '@dcloudio/vite-plugin-uni'

export default defineConfig({ plugins: [uni()] })
~~~

~~~ts
// vitest.config.ts
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['tests/setup.ts'],
    coverage: { reporter: ['text', 'html'], include: ['src/**/*.ts'] }
  },
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } }
})
~~~

~~~json
{
  "extends": "@vue/tsconfig/tsconfig.json",
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "types": ["@dcloudio/types", "vitest/globals", "node"],
    "baseUrl": ".",
    "paths": { "@/*": ["src/*"] }
  },
  "include": ["src/**/*.ts", "src/**/*.vue", "tests/**/*.ts", "env.d.ts"]
}
~~~

Create <code>env.d.ts</code> with typed environment and App WebView globals.

~~~ts
/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_BAIDU_APP_KEY?: string
  readonly VITE_BAIDU_APP_FOLDER?: string
  readonly VITE_BAIDU_REDIRECT_URI?: string
  readonly VITE_USE_MOCKS?: string
}
interface ImportMeta { readonly env: ImportMetaEnv }
declare const plus: {
  webview: {
    create(url: string, id: string, styles: Record<string, unknown>): {
      overrideUrlLoading(options: Record<string, string>, callback: (event: { url: string }) => void): void
      show(animation?: string): void
      close(animation?: string): void
    }
  }
}
~~~

Create <code>tests/setup.ts</code> with a deterministic uni mock.

~~~ts
import { beforeEach, vi } from 'vitest'

const values = new Map<string, unknown>()
vi.stubGlobal('uni', {
  getStorageSync: (key: string) => values.get(key),
  setStorageSync: (key: string, value: unknown) => values.set(key, value),
  removeStorageSync: (key: string) => values.delete(key),
  navigateTo: vi.fn(),
  redirectTo: vi.fn(),
  navigateBack: vi.fn(),
  showToast: vi.fn(),
  showModal: vi.fn(),
  request: vi.fn()
})
beforeEach(() => values.clear())
~~~

- [ ] **Step 4: Add the minimal uni-app shell**

Create five entries in <code>src/pages.json</code>: home, library, player, settings, and oauth. Use custom navigation on every page because the UI supplies its own compact headers.

~~~json
{
  "pages": [
    { "path": "pages/home/index", "style": { "navigationStyle": "custom" } },
    { "path": "pages/library/index", "style": { "navigationStyle": "custom" } },
    { "path": "pages/player/index", "style": { "navigationStyle": "custom" } },
    { "path": "pages/settings/index", "style": { "navigationStyle": "custom" } },
    { "path": "pages/oauth/index", "style": { "navigationStyle": "custom" } }
  ],
  "globalStyle": {
    "backgroundColor": "#f4f5f2",
    "navigationBarTextStyle": "black",
    "navigationBarTitleText": "片刻"
  }
}
~~~

Create <code>src/manifest.json</code> with an empty DCloud appid for local resource builds.

~~~json
{
  "name": "片刻",
  "appid": "",
  "description": "播放应用专属网盘目录与媒体直链，并保留本机播放进度",
  "versionName": "1.0.0",
  "versionCode": "100",
  "transformPx": false,
  "app-plus": {
    "usingComponents": true,
    "screenOrientation": ["portrait-primary", "landscape-primary", "landscape-secondary"],
    "distribute": {
      "android": {
        "permissions": [
          "<uses-permission android:name=\"android.permission.INTERNET\"/>",
          "<uses-permission android:name=\"android.permission.ACCESS_NETWORK_STATE\"/>"
        ]
      }
    }
  }
}
~~~

~~~ts
// src/main.ts
import { createSSRApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import './styles/global.scss'

export function createApp() {
  const app = createSSRApp(App)
  app.use(createPinia())
  return { app }
}
~~~

~~~vue
<!-- src/App.vue -->
<script lang="ts">
export default {}
</script>

<style lang="scss">
@use '@/styles/tokens.scss' as *;
</style>
~~~

- [ ] **Step 5: Add the visual tokens**

Use fixed typography and balanced neutral, green, and coral colors. Do not use gradients, viewport-scaled fonts, or card nesting.

~~~scss
// src/styles/tokens.scss
$color-bg: #f4f5f2;
$color-surface: #ffffff;
$color-text: #17211c;
$color-muted: #6f7973;
$color-border: #dce2de;
$color-primary: #1d8a62;
$color-primary-soft: #e9f5f0;
$color-progress: #e66a4f;
$color-player: #0d100e;
$radius-control: 6px;
$radius-card: 8px;
$shadow-panel: 0 8px 24px rgba(23, 33, 28, 0.1);
~~~

~~~scss
// src/styles/global.scss
page {
  min-height: 100%;
  background: #f4f5f2;
  color: #17211c;
  font-family: Inter, "PingFang SC", "Microsoft YaHei", sans-serif;
  letter-spacing: 0;
}
button::after { border: 0; }
.page-shell { min-height: 100vh; padding: 0 24rpx 132rpx; box-sizing: border-box; }
.section-title { margin: 28rpx 0 16rpx; font-size: 28rpx; font-weight: 700; }
.muted { color: #6f7973; }
~~~

- [ ] **Step 6: Install dependencies with a writable local cache**

Run:

~~~powershell
npm install --cache .npm-cache
~~~

Expected: <code>package-lock.json</code> is created and npm exits 0.

- [ ] **Step 7: Write and run the first failing runtime-config test**

~~~ts
// tests/unit/runtime-config.test.ts
import { describe, expect, it } from 'vitest'
import { parseRuntimeConfig } from '@/config/runtime'

describe('parseRuntimeConfig', () => {
  it('normalizes the Baidu app folder into an allowed root', () => {
    expect(parseRuntimeConfig({
      VITE_BAIDU_APP_KEY: 'public-key',
      VITE_BAIDU_APP_FOLDER: '片刻',
      VITE_BAIDU_REDIRECT_URI: 'https://localhost/pianke/oauth/baidu',
      VITE_USE_MOCKS: 'false'
    }).baiduRoot).toBe('/apps/片刻')
  })
})
~~~

Run: <code>npm run test:run -- tests/unit/runtime-config.test.ts</code>

Expected: FAIL because <code>src/config/runtime.ts</code> does not exist.

- [ ] **Step 8: Implement runtime configuration and verify the shell**

~~~ts
// src/config/runtime.ts
export interface RuntimeConfig {
  baiduAppKey: string
  baiduAppFolder: string
  baiduRoot: string
  baiduRedirectUri: string
  useMocks: boolean
}

export function parseRuntimeConfig(env: Record<string, string | undefined>): RuntimeConfig {
  const folder = (env.VITE_BAIDU_APP_FOLDER || '片刻').trim().replace(/^\/+|\/+$/g, '')
  const redirect = env.VITE_BAIDU_REDIRECT_URI || 'https://localhost/pianke/oauth/baidu'
  return {
    baiduAppKey: (env.VITE_BAIDU_APP_KEY || '').trim(),
    baiduAppFolder: folder,
    baiduRoot: '/apps/' + folder,
    baiduRedirectUri: redirect,
    useMocks: env.VITE_USE_MOCKS === 'true'
  }
}

export const runtimeConfig = parseRuntimeConfig(import.meta.env as Record<string, string | undefined>)
~~~

Run:

~~~powershell
npm run test:run -- tests/unit/runtime-config.test.ts
npm run type-check
~~~

Expected: one passing test and no type errors. The first H5 build runs after all page files exist.

- [ ] **Step 9: Commit the scaffold**

~~~powershell
git add .gitignore .env.example package.json package-lock.json tsconfig.json vite.config.ts vitest.config.ts env.d.ts index.html src tests/setup.ts tests/unit/runtime-config.test.ts
git commit -m "build: scaffold pianke uni-app"
~~~

---

### Task 2: Add Domain Types, Typed Storage, And Progress Rules

**Files:**
- Create: <code>src/domain/video.ts</code>
- Create: <code>src/infrastructure/storage.ts</code>
- Create: <code>src/features/playback/progressPolicy.ts</code>
- Create: <code>src/features/playback/progressRepository.ts</code>
- Test: <code>tests/unit/storage.test.ts</code>
- Test: <code>tests/unit/progressPolicy.test.ts</code>

- [ ] **Step 1: Write failing progress-policy tests**

~~~ts
import { describe, expect, it } from 'vitest'
import { classifyProgress } from '@/features/playback/progressPolicy'

describe('classifyProgress', () => {
  it('does not offer resume before 30 seconds', () => {
    expect(classifyProgress(29, 600)).toEqual({ resumable: false, completed: false })
  })
  it('offers resume for an unfinished middle position', () => {
    expect(classifyProgress(120, 600)).toEqual({ resumable: true, completed: false })
  })
  it('marks 95 percent as completed', () => {
    expect(classifyProgress(570, 600)).toEqual({ resumable: false, completed: true })
  })
  it('marks the final 30 seconds as completed', () => {
    expect(classifyProgress(571, 600)).toEqual({ resumable: false, completed: true })
  })
})
~~~

Run: <code>npm run test:run -- tests/unit/progressPolicy.test.ts</code>

Expected: FAIL because the policy module does not exist.

- [ ] **Step 2: Add exact domain types and minimal progress policy**

~~~ts
// src/domain/video.ts
export type VideoSourceType = 'baidu' | 'direct'
export interface VideoItem {
  id: string
  sourceType: VideoSourceType
  sourceId: string
  name: string
  path: string
  sizeBytes?: number
  durationSeconds?: number
  thumbnailUrl?: string
  modifiedAt?: number
}
export interface DirectVideoRecord { id: string; name: string; url: string; addedAt: number }
export interface PlaybackProgress {
  videoId: string
  positionSeconds: number
  durationSeconds: number
  updatedAt: number
  completed: boolean
}
export interface BaiduAuthSession { accessToken: string; expiresAt: number; scope: string[] }
export interface VideoFolder { name: string; path: string; folders: VideoFolder[]; videos: VideoItem[] }
~~~

~~~ts
// src/features/playback/progressPolicy.ts
export function classifyProgress(positionSeconds: number, durationSeconds: number) {
  const validDuration = Number.isFinite(durationSeconds) && durationSeconds > 0
  const completed = validDuration &&
    (positionSeconds / durationSeconds >= 0.95 || durationSeconds - positionSeconds <= 30)
  return {
    completed,
    resumable: !completed && positionSeconds >= 30 && validDuration && durationSeconds - positionSeconds > 30
  }
}
~~~

Run: <code>npm run test:run -- tests/unit/progressPolicy.test.ts</code>

Expected: four passing tests.

- [ ] **Step 3: Write failing typed-storage and repository tests**

The tests must verify malformed JSON falls back without deleting unrelated storage and that completed progress remains available in history but not in resumable results.

~~~ts
import { describe, expect, it } from 'vitest'
import { createMemoryStorage } from '@/infrastructure/storage'
import { ProgressRepository } from '@/features/playback/progressRepository'

describe('ProgressRepository', () => {
  it('keeps completed history out of resumable results', () => {
    const repository = new ProgressRepository(createMemoryStorage())
    repository.save('video-1', 590, 600, 1000)
    expect(repository.get('video-1')?.completed).toBe(true)
    expect(repository.listResumable()).toEqual([])
  })
})
~~~

Run: <code>npm run test:run -- tests/unit/storage.test.ts</code>

Expected: FAIL because the storage and repository modules do not exist.

- [ ] **Step 4: Implement versioned storage and the progress repository**

Define <code>KeyValueStorage</code> with <code>read&lt;T&gt;(key, fallback)</code>, <code>write</code>, and <code>remove</code>. Production storage delegates to uni synchronous storage; memory storage uses a Map for tests. <code>ProgressRepository.save</code> calls <code>classifyProgress</code>, rounds seconds to integers, clamps position to zero/duration, and stores under <code>pianke:progress:v1</code>.

~~~ts
export interface KeyValueStorage {
  read<T>(key: string, fallback: T): T
  write<T>(key: string, value: T): void
  remove(key: string): void
}

export function createMemoryStorage(): KeyValueStorage {
  const data = new Map<string, string>()
  return {
    read: (key, fallback) => {
      try { return data.has(key) ? JSON.parse(data.get(key) as string) : fallback }
      catch { return fallback }
    },
    write: (key, value) => data.set(key, JSON.stringify(value)),
    remove: key => { data.delete(key) }
  }
}
~~~

Run: <code>npm run test:run -- tests/unit/storage.test.ts tests/unit/progressPolicy.test.ts</code>

Expected: all storage and progress tests pass.

- [ ] **Step 5: Commit domain and persistence**

~~~powershell
git add src/domain src/infrastructure src/features/playback tests/unit/storage.test.ts tests/unit/progressPolicy.test.ts
git commit -m "feat: add local playback progress"
~~~

---

### Task 3: Add Direct-Link Validation And Persistence

**Files:**
- Create: <code>src/features/direct-links/directLinkService.ts</code>
- Test: <code>tests/unit/directLinkService.test.ts</code>

- [ ] **Step 1: Write failing direct-link tests**

Cover HTTPS MP4, HTTPS M3U8 with signed query parameters, HTTP rejection, ordinary webpage rejection, optional Content-Type acceptance, UUID persistence, edit, and delete.

~~~ts
import { describe, expect, it } from 'vitest'
import { classifyDirectUrl } from '@/features/direct-links/directLinkService'

describe('classifyDirectUrl', () => {
  it('accepts an HTTPS M3U8 URL with query parameters', () => {
    expect(classifyDirectUrl('https://cdn.example.test/live/index.m3u8?sig=abc')).toBe('hls')
  })
  it('rejects non-HTTPS and ordinary webpages', () => {
    expect(classifyDirectUrl('http://cdn.example.test/video.mp4')).toBe('invalid')
    expect(classifyDirectUrl('https://example.test/watch/123')).toBe('unknown')
  })
})
~~~

Run: <code>npm run test:run -- tests/unit/directLinkService.test.ts</code>

Expected: FAIL because the direct-link service does not exist.

- [ ] **Step 2: Implement validation and CRUD**

<code>classifyDirectUrl</code> returns <code>mp4</code>, <code>hls</code>, <code>unknown</code>, or <code>invalid</code>. The service accepts an optional probe result so <code>video/mp4</code> and <code>application/vnd.apple.mpegurl</code> can approve extensionless HTTPS URLs. Store records under <code>pianke:direct-videos:v1</code>. Generate IDs with <code>crypto.randomUUID()</code>; throw a user-facing secure-runtime error if unavailable rather than using a predictable ID.

~~~ts
export type DirectUrlKind = 'mp4' | 'hls' | 'unknown' | 'invalid'

export function classifyDirectUrl(value: string): DirectUrlKind {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:') return 'invalid'
    const path = url.pathname.toLowerCase()
    if (path.endsWith('.mp4')) return 'mp4'
    if (path.endsWith('.m3u8')) return 'hls'
    return 'unknown'
  } catch {
    return 'invalid'
  }
}
~~~

Run: <code>npm run test:run -- tests/unit/directLinkService.test.ts</code>

Expected: all direct-link tests pass.

- [ ] **Step 3: Commit direct links**

~~~powershell
git add src/features/direct-links tests/unit/directLinkService.test.ts
git commit -m "feat: add direct video links"
~~~

---

### Task 4: Add Secure OAuth Callback And Session Handling

**Files:**
- Create: <code>src/features/auth/oauth.ts</code>
- Create: <code>src/features/auth/authRepository.ts</code>
- Create: <code>src/features/auth/oauthWebview.ts</code>
- Test: <code>tests/unit/oauth.test.ts</code>
- Test: <code>tests/unit/authRepository.test.ts</code>

- [ ] **Step 1: Write failing OAuth tests**

Tests must cover exact authorize parameters, state mismatch, wrong callback origin/path, missing netdisk scope, expiration conversion, access-denied cancellation, and redacted errors.

~~~ts
import { describe, expect, it } from 'vitest'
import { buildAuthorizeUrl, parseOAuthCallback } from '@/features/auth/oauth'

const config = {
  appKey: 'public-key',
  redirectUri: 'https://localhost/pianke/oauth/baidu'
}

describe('Baidu OAuth', () => {
  it('builds implicit authorization with netdisk scope', () => {
    const url = new URL(buildAuthorizeUrl(config, 'state-123'))
    expect(url.searchParams.get('response_type')).toBe('token')
    expect(url.searchParams.get('scope')).toBe('basic,netdisk')
    expect(url.searchParams.get('state')).toBe('state-123')
  })
  it('rejects a mismatched state', () => {
    expect(() => parseOAuthCallback(
      'https://localhost/pianke/oauth/baidu#access_token=token&expires_in=3600&scope=basic+netdisk&state=bad',
      config.redirectUri,
      'good',
      1000
    )).toThrow('授权校验失败')
  })
})
~~~

Run: <code>npm run test:run -- tests/unit/oauth.test.ts</code>

Expected: FAIL because OAuth modules do not exist.

- [ ] **Step 2: Implement pure OAuth logic**

Use <code>URL</code> and <code>URLSearchParams</code>; never parse callback data with ad hoc string splitting. Compare callback origin and pathname to the registered redirect. Convert <code>expires_in</code> to an absolute millisecond timestamp and require both <code>basic</code> and <code>netdisk</code> scopes.

~~~ts
export function buildAuthorizeUrl(config: { appKey: string; redirectUri: string }, state: string) {
  const url = new URL('https://openapi.baidu.com/oauth/2.0/authorize')
  url.search = new URLSearchParams({
    response_type: 'token',
    client_id: config.appKey,
    redirect_uri: config.redirectUri,
    scope: 'basic,netdisk',
    display: 'mobile',
    state
  }).toString()
  return url.toString()
}
~~~

- [ ] **Step 3: Implement pending-state and session persistence**

Persist pending OAuth state with <code>createdAt</code> under <code>pianke:oauth-pending:v1</code> and reject it after ten minutes. Persist valid sessions under <code>pianke:auth:v1</code>. <code>getValidSession(now)</code> returns null and removes only auth data when expired; it never clears catalog cache, direct links, or progress.

Run: <code>npm run test:run -- tests/unit/oauth.test.ts tests/unit/authRepository.test.ts</code>

Expected: all OAuth/session tests pass.

- [ ] **Step 4: Add the App-only OAuth WebView adapter**

Use conditional compilation. On App, create a dedicated plus WebView, call <code>overrideUrlLoading</code> for the exact redirect prefix, forward the captured URL to the pure parser, and close the WebView on success, cancellation, or user back. On H5, the adapter is disabled unless mock mode is enabled; it must not redirect the Playwright test runner to Baidu.

~~~ts
export function openOAuthWebview(authorizeUrl: string, redirectUri: string, onCallback: (url: string) => void) {
  // #ifdef APP-PLUS
  const view = plus.webview.create(authorizeUrl, 'pianke-baidu-oauth', {
    titleNView: { titleText: '连接百度网盘', autoBackButton: true }
  })
  view.overrideUrlLoading({ mode: 'reject', match: redirectUri + '*' }, event => {
    onCallback(event.url)
    view.close('slide-out-right')
  })
  view.show('slide-in-right')
  // #endif
}
~~~

- [ ] **Step 5: Commit OAuth**

~~~powershell
git add src/features/auth tests/unit/oauth.test.ts tests/unit/authRepository.test.ts
git commit -m "feat: add baidu oauth session"
~~~

---

### Task 5: Add The Restricted Baidu Video Provider

**Files:**
- Create: <code>src/features/baidu/baiduErrors.ts</code>
- Create: <code>src/features/baidu/baiduTransport.ts</code>
- Create: <code>src/features/baidu/baiduDriveSource.ts</code>
- Test: <code>tests/unit/baiduDriveSource.test.ts</code>
- Test: <code>tests/unit/baiduErrors.test.ts</code>

- [ ] **Step 1: Write failing provider-contract tests**

Use an injected transport spy. Assert every list request uses the configured app root, recursion, web thumbnails, and page size 1000. Assert responses outside the root are discarded. Assert <code>filemetas</code> requests include exactly one fs_id, <code>dlink=1</code>, <code>thumb=1</code>, and <code>needmedia=1</code>. Assert the final download URL receives the current access token without persisting it.

~~~ts
import { describe, expect, it, vi } from 'vitest'
import { BaiduDriveSource } from '@/features/baidu/baiduDriveSource'

describe('BaiduDriveSource', () => {
  it('confines video listing to the app root', async () => {
    const transport = vi.fn().mockResolvedValue({ errno: 0, info: [] })
    const source = new BaiduDriveSource('/apps/片刻', transport)
    await source.listPage('token', 1)
    expect(transport).toHaveBeenCalledWith(expect.objectContaining({
      method: 'videolist',
      parent_path: '/apps/片刻',
      recursion: 1,
      num: 1000
    }))
  })
})
~~~

Run: <code>npm run test:run -- tests/unit/baiduDriveSource.test.ts</code>

Expected: FAIL because the provider does not exist.

- [ ] **Step 2: Implement public error mapping**

Map <code>20011</code>, <code>20012</code>, <code>20013</code>, expired/invalid token, network timeout, 403, and unknown errno to typed errors with user messages. Diagnostics may include errno and request_id only. Never include access tokens, dlink query strings, or raw request URLs.

~~~ts
const publicMessages: Record<number, string> = {
  20011: '当前应用的测试用户数量已满',
  20012: '请求过于频繁，请稍后再试',
  20013: '百度接口尚未开通或应用需要审核'
}

export function toBaiduError(errno: number, requestId?: string) {
  return {
    code: errno,
    requestId,
    message: publicMessages[errno] || '百度网盘暂时无法访问'
  }
}
~~~

- [ ] **Step 3: Implement the injectable transport**

Wrap <code>uni.request</code> in a Promise, send <code>User-Agent: pan.baidu.com</code>, use a 15-second timeout, reject non-2xx responses, and return parsed JSON. Transport input contains only a base endpoint and a data object; token-safe logging belongs outside this module.

- [ ] **Step 4: Implement videolist mapping and filemetas playback resolution**

Map <code>fs_id</code> to <code>baidu:{fsId}</code>. Preserve name, full path, size, modified time, duration, and the largest available thumbnail. Use <code>startsWith(root + '/')</code> or exact root checks before accepting any response. When resolving playback, get a fresh dlink and add <code>access_token</code> through <code>URL.searchParams</code>.

Run: <code>npm run test:run -- tests/unit/baiduDriveSource.test.ts tests/unit/baiduErrors.test.ts</code>

Expected: provider and error tests pass with no token values in snapshots.

- [ ] **Step 5: Commit the Baidu provider**

~~~powershell
git add src/features/baidu tests/unit/baiduDriveSource.test.ts tests/unit/baiduErrors.test.ts
git commit -m "feat: add restricted baidu video source"
~~~

---

### Task 6: Build The Catalog, Folder Tree, Cache, And Store

**Files:**
- Create: <code>src/features/catalog/folderTree.ts</code>
- Create: <code>src/features/catalog/catalogCache.ts</code>
- Create: <code>src/stores/appStore.ts</code>
- Create: <code>src/mocks/fixtures.ts</code>
- Create: <code>src/mocks/bootstrap.ts</code>
- Modify: <code>src/App.vue</code>
- Test: <code>tests/unit/folderTree.test.ts</code>
- Test: <code>tests/unit/catalogCache.test.ts</code>
- Test: <code>tests/unit/appStore.test.ts</code>

- [ ] **Step 1: Write failing folder-tree tests**

Verify nested paths, Chinese names, files directly at the root, deterministic folder/name ordering, duplicate fs_id removal, and exclusion of folders containing no videos.

~~~ts
import { describe, expect, it } from 'vitest'
import { buildFolderTree } from '@/features/catalog/folderTree'

describe('buildFolderTree', () => {
  it('reconstructs folders from video paths', () => {
    const tree = buildFolderTree('/apps/片刻', [{
      id: 'baidu:1',
      sourceType: 'baidu',
      sourceId: '1',
      name: '第一集.mp4',
      path: '/apps/片刻/课程/第一集.mp4'
    }])
    expect(tree.folders[0].path).toBe('/apps/片刻/课程')
    expect(tree.folders[0].videos[0].name).toBe('第一集.mp4')
  })
})
~~~

Run: <code>npm run test:run -- tests/unit/folderTree.test.ts</code>

Expected: FAIL because folder-tree code does not exist.

- [ ] **Step 2: Implement the pure folder tree**

Split paths only after removing the exact root prefix. Build nodes in a Map keyed by absolute folder path, attach children once, sort folders and videos with <code>localeCompare('zh-CN', { numeric: true })</code>, and return a root <code>VideoFolder</code>.

- [ ] **Step 3: Write failing cache timing tests**

Use an injected clock. Assert cache younger than 15 minutes skips network, older cache is returned while refresh is allowed, and forced refresh is rejected if the last request started less than 60 seconds ago.

- [ ] **Step 4: Implement cache policy and the Pinia store**

The store state contains auth session, merged videos, folder tree, direct records, sync status, last error, and progress. <code>initialize()</code> loads local records, optionally seeds mock scenarios, and uses fresh cache without a request. <code>syncBaidu(force)</code> paginates until a page returns fewer than 1000 items, atomically replaces cache only after complete success, and leaves stale cache visible on failure.

Modify <code>src/App.vue</code> only after the store exists:

~~~vue
<script setup lang="ts">
import { onLaunch } from '@dcloudio/uni-app'
import { useAppStore } from '@/stores/appStore'

onLaunch(() => {
  void useAppStore().initialize()
})
</script>

<style lang="scss">
@use '@/styles/tokens.scss' as *;
</style>
~~~

Store getters:

- <code>recentVideos</code>: all sources sorted by modified/added time descending.
- <code>continueWatching</code>: resumable progress joined to existing videos and sorted by progress update time.
- <code>searchResults</code>: case-insensitive name/path search over the local catalog.
- <code>folderTree</code>: Baidu-only tree rooted at the configured app folder.

- [ ] **Step 5: Add guarded H5 fixtures**

Create three realistic mock videos with local paths and stable Unsplash image URLs, one direct M3U8, one resumable progress record, and scenarios <code>first-run</code>, <code>library</code>, <code>resume</code>, and <code>baidu-error</code>. <code>bootstrapMocks</code> returns data only when <code>runtimeConfig.useMocks</code> is true; production builds return null.

Run:

~~~powershell
npm run test:run -- tests/unit/folderTree.test.ts tests/unit/catalogCache.test.ts tests/unit/appStore.test.ts
~~~

Expected: all catalog/store tests pass.

- [ ] **Step 6: Commit catalog orchestration**

~~~powershell
git add src/features/catalog src/stores src/mocks tests/unit/folderTree.test.ts tests/unit/catalogCache.test.ts tests/unit/appStore.test.ts
git commit -m "feat: add unified video catalog"
~~~

---

### Task 7: Build Shared UI And The Home Page

**Files:**
- Create: <code>src/components/BottomNav.vue</code>
- Create: <code>src/components/VideoThumbnail.vue</code>
- Create: <code>src/components/VideoRow.vue</code>
- Create: <code>src/pages/home/index.vue</code>
- Test: <code>tests/components/VideoThumbnail.test.ts</code>
- Test: <code>tests/components/home.test.ts</code>

- [ ] **Step 1: Write failing component tests**

Mount <code>VideoThumbnail</code> with a valid URL and trigger image error to assert the Film icon fallback. Mount home with an empty store to assert “连接百度网盘” and “导入媒体直链”; mount resume scenario to assert “接着看” and the saved timestamp.

Run: <code>npm run test:run -- tests/components/VideoThumbnail.test.ts tests/components/home.test.ts</code>

Expected: FAIL because components/pages do not exist.

- [ ] **Step 2: Implement compact icon navigation**

Use lucide <code>House</code>, <code>LibraryBig</code>, and <code>Settings</code>. Each item is a stable 88rpx touch target, uses <code>uni.redirectTo</code>, has an aria label, and does not resize when active.

~~~vue
<script setup lang="ts">
import { House, LibraryBig, Settings } from 'lucide-vue-next'
const props = defineProps<{ active: 'home' | 'library' | 'settings' }>()
const items = [
  { key: 'home', label: '首页', path: '/pages/home/index', icon: House },
  { key: 'library', label: '视频库', path: '/pages/library/index', icon: LibraryBig },
  { key: 'settings', label: '设置', path: '/pages/settings/index', icon: Settings }
] as const
function navigate(path: string, key: string) {
  if (key !== props.active) uni.redirectTo({ url: path })
}
</script>
~~~

- [ ] **Step 3: Implement stable thumbnails and rows**

<code>VideoThumbnail</code> uses <code>aspect-ratio: 16 / 9</code>, lazy image loading, and a solid near-black fallback with a Film icon. <code>VideoRow</code> keeps a fixed thumbnail track, truncates long names to two lines, shows path and duration, and emits one click without embedding its own card.

- [ ] **Step 4: Implement the actual first screen**

Home must not be a landing page. When there are no sources, render two operational source rows with Cloud and Link icons. When progress exists, render one large continue-watching item with thumbnail, timestamp, coral progress bar, and Play icon. Below it show at most six recent videos and current sync state.

Use these exact actions:

- Connect: navigate to <code>/pages/oauth/index</code>.
- Import: navigate to <code>/pages/library/index?openImport=1</code>; Task 8 reads this query and opens the completed import sheet.
- Resume/video click: navigate to player with <code>id</code> encoded through <code>encodeURIComponent</code>.

Run: <code>npm run test:run -- tests/components/VideoThumbnail.test.ts tests/components/home.test.ts</code>

Expected: all shared/home tests pass.

- [ ] **Step 5: Commit shared UI and home**

~~~powershell
git add src/components/BottomNav.vue src/components/VideoThumbnail.vue src/components/VideoRow.vue src/pages/home tests/components
git commit -m "feat: build pianke home screen"
~~~

---

### Task 8: Build Library, Direct-Link Sheet, Settings, And OAuth Page

**Files:**
- Create: <code>src/components/DirectLinkSheet.vue</code>
- Create: <code>src/pages/library/index.vue</code>
- Create: <code>src/pages/settings/index.vue</code>
- Create: <code>src/pages/oauth/index.vue</code>
- Test: <code>tests/components/DirectLinkSheet.test.ts</code>
- Test: <code>tests/components/library.test.ts</code>
- Test: <code>tests/components/settings.test.ts</code>

- [ ] **Step 1: Write failing direct-link sheet tests**

Verify HTTPS validation, rejected HTTP, rejected webpage without successful probe, optional display name, loading state, successful add, edit preservation of ID, and delete confirmation.

Run: <code>npm run test:run -- tests/components/DirectLinkSheet.test.ts</code>

Expected: FAIL because the sheet does not exist.

- [ ] **Step 2: Implement the import bottom sheet**

Use <code>Link</code>, <code>X</code>, and <code>Check</code> icons. The URL input uses <code>type="text"</code> and disables autocorrection. Submit performs HEAD probe through a small injectable function, accepts known extension immediately, offers “仍然尝试添加” only for an unknown HTTPS URL after probe failure, and never accepts HTTP.

- [ ] **Step 3: Write failing library tests**

Assert the segmented control switches recent/folder views, search filters name and path locally, breadcrumbs navigate the reconstructed folder tree, refresh is disabled during cooldown, and the add button opens the sheet.

- [ ] **Step 4: Implement library views**

The page header contains title, Search icon field, Refresh icon button with tooltip, and Plus icon button. The segmented control has fixed two-column dimensions. Folder rows use Folder icon and counts; video rows reuse <code>VideoRow</code>. Empty searches display one unframed empty band, not a decorative card.

- [ ] **Step 5: Implement settings and OAuth launcher**

Settings displays Baidu connection status, app-folder path, token expiration date without token value, direct-link count, cache timestamp, privacy summary, and version. Destructive actions use confirmation modals:

- Disconnect removes only auth session.
- Clear cache removes only catalog cache.
- Clear history removes only progress after a second explicit confirmation.

OAuth page checks for AppKey before opening. Missing AppKey shows “尚未配置百度 AppKey” and allows returning. Mock mode completes immediately. App mode creates pending state, launches the WebView, parses callback, saves the session, syncs, and redirects home.

Run:

~~~powershell
npm run test:run -- tests/components/DirectLinkSheet.test.ts tests/components/library.test.ts tests/components/settings.test.ts
~~~

Expected: all library/settings/import tests pass.

- [ ] **Step 6: Commit library and source management**

~~~powershell
git add src/components/DirectLinkSheet.vue src/pages/library src/pages/settings src/pages/oauth tests/components
git commit -m "feat: add library and source management"
~~~

---

### Task 9: Build The Player And Resume Lifecycle

**Files:**
- Create: <code>src/components/ResumeDialog.vue</code>
- Create: <code>src/features/playback/playbackResolver.ts</code>
- Create: <code>src/pages/player/index.vue</code>
- Test: <code>tests/unit/playbackResolver.test.ts</code>
- Test: <code>tests/components/ResumeDialog.test.ts</code>
- Test: <code>tests/components/player.test.ts</code>

- [ ] **Step 1: Write failing resolver tests**

Verify direct links return unchanged HTTPS URLs, Baidu items request a fresh dlink every time, one 403 triggers exactly one re-resolve, a second failure stops retrying, and missing items return a typed not-found error.

- [ ] **Step 2: Implement source resolution**

<code>PlaybackResolver.resolve(item, session)</code> delegates by source type. Direct items return their saved URL. Baidu items require a valid session and call <code>BaiduDriveSource.resolvePlaybackUrl</code>. <code>retryAfterAuthorizationFailure</code> permits one retry per player load and never loops.

- [ ] **Step 3: Write failing resume-dialog and player lifecycle tests**

Test continue seeks to the saved second, from-start seeks to zero and immediately saves zero, time updates save at most once every five seconds, pause/save is immediate, hide/unload is immediate, and ended marks complete.

~~~ts
import { describe, expect, it } from 'vitest'
import { classifyProgress } from '@/features/playback/progressPolicy'

describe('player completion', () => {
  it('removes a nearly finished item from continue watching', () => {
    expect(classifyProgress(3571, 3600).completed).toBe(true)
  })
})
~~~

- [ ] **Step 4: Implement the resume dialog**

The modal has one heading, saved timestamp, primary “继续播放” button with Play icon, secondary “从头播放” button with RotateCcw icon, fixed dimensions, focus order, and no nested cards.

- [ ] **Step 5: Implement the player page**

Use uni-app <code>video</code> with stable 16:9 portrait dimensions, native controls, <code>enable-play-gesture</code>, <code>show-center-play-btn</code>, and fullscreen support. Use <code>uni.createVideoContext</code> for seek and playback rate. Show title, source/path, “原始画质” for Baidu or “媒体直链” for direct URLs, speed menu, and retry/back actions.

Lifecycle rules:

- Start save timer only after metadata and playback begin.
- Save every five seconds only when position changed.
- Save immediately on pause, seek completion, <code>onHide</code>, and <code>onUnload</code>.
- On ended, save duration as completed.
- If system reports unsupported format, show file path and return action.
- Do not print the player URL or token.

Run:

~~~powershell
npm run test:run -- tests/unit/playbackResolver.test.ts tests/components/ResumeDialog.test.ts tests/components/player.test.ts
~~~

Expected: resolver, resume, and lifecycle tests pass.

- [ ] **Step 6: Commit playback**

~~~powershell
git add src/features/playback src/components/ResumeDialog.vue src/pages/player tests/unit/playbackResolver.test.ts tests/components/ResumeDialog.test.ts tests/components/player.test.ts
git commit -m "feat: add playback and resume flow"
~~~

---

### Task 10: Add E2E Coverage, Security Scan, And Final Visual Verification

**Files:**
- Create: <code>playwright.config.ts</code>
- Create: <code>tests/e2e/app.spec.ts</code>
- Create: <code>scripts/scan-secrets.mjs</code>
- Modify: <code>README.md</code> or create it if absent
- Modify: implementation files only for issues revealed by verification

- [ ] **Step 1: Add the Playwright H5 server**

~~~ts
// playwright.config.ts
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: 'tests/e2e',
  use: { baseURL: 'http://127.0.0.1:5173', trace: 'retain-on-failure' },
  projects: [
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
    { name: 'desktop', use: { viewport: { width: 1280, height: 900 } } }
  ],
  webServer: {
    command: 'cross-env VITE_USE_MOCKS=true npm run dev:h5 -- --host 127.0.0.1 --port 5173',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: false
  }
})
~~~

- [ ] **Step 2: Write E2E flows**

<code>tests/e2e/app.spec.ts</code> must verify:

1. First-run source actions are visible without scrolling.
2. Mock OAuth transitions to connected home.
3. Library switches between recent and folder views.
4. Search filters a Chinese video title.
5. Direct-link sheet rejects HTTP and accepts HTTPS M3U8.
6. Resume scenario shows the exact continue timestamp and both choices.
7. Settings disconnect preserves direct links and progress.
8. Long names do not overlap buttons at Pixel 7 and 1280×900 viewports.

Run: <code>npm run e2e</code>

Expected: all tests pass in mobile and desktop projects.

- [ ] **Step 3: Add a token-aware security scanner**

~~~js
// scripts/scan-secrets.mjs
import fs from 'node:fs'
import path from 'node:path'

const roots = ['src', 'dist']
const forbidden = [
  /VITE_BAIDU_(SECRET|SIGN)/i,
  /client_secret\s*[:=]/i,
  /access_token=[A-Za-z0-9._-]{20,}/i
]
const findings = []
function walk(target) {
  if (!fs.existsSync(target)) return
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    const full = path.join(target, entry.name)
    if (entry.isDirectory()) walk(full)
    else {
      const text = fs.readFileSync(full, 'utf8')
      for (const pattern of forbidden) if (pattern.test(text)) findings.push(full + ': ' + pattern)
    }
  }
}
roots.forEach(walk)
if (findings.length) {
  console.error(findings.join('\n'))
  process.exit(1)
}
console.log('No forbidden credential patterns found.')
~~~

Run: <code>npm run security:scan</code>

Expected: <code>No forbidden credential patterns found.</code>

- [ ] **Step 4: Run the complete automated verification**

~~~powershell
npm run type-check
npm run test:coverage
npm run build:h5
npm run build:app
npm run security:scan
npm run e2e
~~~

Expected: all commands exit 0. Coverage includes OAuth parsing, path restrictions, progress policy, direct-link validation, cache policy, provider mapping, and playback resolution.

- [ ] **Step 5: Perform visual QA with browser screenshots**

Start the H5 server and inspect these exact routes in the in-app browser:

- <code>/?scenario=first-run#/pages/home/index</code>
- <code>/?scenario=library#/pages/library/index</code>
- <code>/?scenario=resume#/pages/player/index?id=baidu%3A1001</code>
- <code>/?scenario=baidu-error#/pages/settings/index</code>

Capture screenshots at 390×844 and 1280×900. Check:

- No text/button/nav overlap.
- No horizontal scroll.
- All icon buttons have stable touch targets and accessible names.
- Long Chinese filenames wrap to two lines without shifting rows.
- Player is nonblank and correctly framed.
- Continue card leaves room for the next section.
- Palette is not dominated by one hue.
- No gradient, decorative orb, nested card, or marketing hero appears.

Use browser console inspection to confirm there are no uncaught errors. Fix any issue, rerun the affected component/E2E test, and capture a replacement screenshot.

- [ ] **Step 6: Document run and configuration instructions**

Create <code>README.md</code> with:

- Node 20+ and <code>npm install --cache .npm-cache</code>.
- H5 mock command and URL.
- New <code>.env.local</code> containing only AppKey, app-folder name, callback, and mock flag.
- Required Baidu callback <code>https://localhost/pianke/oauth/baidu</code>.
- Requirement to recreate exposed credentials before live tests.
- Requirement to place legal H.264/AAC MP4 files in <code>/apps/片刻</code>.
- HBuilderX/DCloud AppID requirement for APK packaging.
- Unreviewed-app 10-user and 10-request/hour constraints.
- Original-file codec limitation and absence of Baidu transcoding.

- [ ] **Step 7: Run final status checks and commit**

~~~powershell
git diff --check
git status --short
git add playwright.config.ts tests/e2e scripts/scan-secrets.mjs README.md
git add src tests package.json package-lock.json
git commit -m "test: verify pianke app flows"
~~~

Expected: commit succeeds; only intentionally ignored local files remain outside version control.

---

## Final Acceptance Checklist

- [ ] Android-first uni-app project builds App resources.
- [ ] H5 mock app starts and is usable at the reported local URL.
- [ ] APK source contains AppKey only when configured, never SecretKey or SignKey.
- [ ] OAuth callback validates exact redirect and state.
- [ ] Every Baidu path is restricted to the configured app folder.
- [ ] Catalog supports recent and reconstructed folder views.
- [ ] HTTPS MP4/M3U8 direct links import, edit, delete, and play.
- [ ] Progress saves on all required lifecycle events.
- [ ] Resume and completion thresholds match the design.
- [ ] Error messages distinguish token, quota, permission, network, link, and codec failures.
- [ ] Unit, component, E2E, H5 build, App resource build, and security scan pass.
- [ ] Mobile and desktop screenshots pass the visual QA checklist.
