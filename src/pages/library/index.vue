<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import {
  ChevronRight,
  Folder,
  Pencil,
  Plus,
  RefreshCw,
  Search
} from '@/components/icons'

import BottomNav from '@/components/BottomNav.vue'
import DirectLinkSheet from '@/components/DirectLinkSheet.vue'
import VideoRow from '@/components/VideoRow.vue'
import type { DirectVideoRecord, VideoFolder, VideoItem } from '@/domain/video'
import { DirectLinkService } from '@/features/direct-links/directLinkService'
import { useDailyUnlockClock } from '@/features/daily-unlock/dailyUnlockClock'
import { uniStorage } from '@/infrastructure/storage'
import { useAppStore } from '@/stores/appStore'

type LibraryView = 'recent' | 'folders'

const LIBRARY_BATCH_SIZE = 50
const SEARCH_DEBOUNCE_MS = 200

const store = useAppStore()
const directLinkService = new DirectLinkService(uniStorage)
const activeView = ref<LibraryView>('recent')
const activeFolderPath = ref(store.folderTree.path)
const searchInput = ref(store.searchQuery)
const importOpen = ref(false)
const editingRecord = ref<DirectVideoRecord | undefined>()
const refreshing = ref(false)
const cooldownClock = ref(Date.now())
const visibleLimit = ref(LIBRARY_BATCH_SIZE)
let cooldownTimer: ReturnType<typeof setTimeout> | undefined
let searchTimer: ReturnType<typeof setTimeout> | undefined

const hasSearch = computed(() => Boolean(store.searchQuery.trim()))
const listedVideos = computed(() =>
  hasSearch.value ? store.searchResults : store.catalogRecentVideos
)
const visibleListedVideos = computed(() =>
  listedVideos.value.slice(0, visibleLimit.value)
)
const activeFolder = computed(() =>
  findFolder(store.folderTree, activeFolderPath.value) ?? store.folderTree
)
const breadcrumbs = computed(() =>
  findFolderTrail(store.folderTree, activeFolder.value.path) ?? [store.folderTree]
)
const visibleFolders = computed(() =>
  activeFolder.value.folders.slice(0, visibleLimit.value)
)
const visibleRootFolders = computed(() =>
  store.folderTree.folders.slice(0, visibleLimit.value)
)
const visibleFolderVideos = computed(() =>
  activeFolder.value.videos.slice(
    0,
    Math.max(0, visibleLimit.value - visibleFolders.value.length)
  )
)
const hasMoreFolderEntries = computed(
  () =>
    visibleFolders.value.length + visibleFolderVideos.value.length <
    activeFolder.value.folders.length + activeFolder.value.videos.length
)
const refreshDisabled = computed(() => {
  const retryAt = store.nextSyncAllowedAt
  return (
    !store.authSession ||
    refreshing.value ||
    store.syncStatus === 'syncing' ||
    (typeof retryAt === 'number' && retryAt > cooldownClock.value)
  )
})

useDailyUnlockClock((now) => store.refreshDailyUnlockClock(now))

watch(
  () => store.nextSyncAllowedAt,
  (retryAt) => scheduleCooldownClock(retryAt),
  { immediate: true }
)

watch(searchInput, (query) => {
  resetVisibleLimit()
  scheduleSearch(query)
})

onUnmounted(() => {
  if (cooldownTimer !== undefined) {
    clearTimeout(cooldownTimer)
  }
  if (searchTimer !== undefined) {
    clearTimeout(searchTimer)
  }
})

onLoad((query) => {
  if (query?.openImport === '1') {
    openNewImport()
  }
})

function setView(view: LibraryView): void {
  activeView.value = view
  resetVisibleLimit()
  activeFolderPath.value = store.folderTree.path
}

function enterFolder(folder: VideoFolder): void {
  activeView.value = 'folders'
  activeFolderPath.value = folder.path
  resetVisibleLimit()
}

function openNewImport(): void {
  editingRecord.value = undefined
  importOpen.value = true
}

function editDirect(video: VideoItem): void {
  const record = store.directRecords.find(
    (candidate) => candidate.id === video.sourceId
  )
  if (!record) {
    return
  }

  editingRecord.value = { ...record }
  importOpen.value = true
}

function closeImport(): void {
  importOpen.value = false
  editingRecord.value = undefined
}

function reloadDirectCatalog(): void {
  store.reloadDirectRecords()
  resetVisibleLimit()
}

function openPlayer(video: VideoItem): void {
  if (typeof video?.id !== 'string' || !video.id) {
    return
  }

  const unlockStatus = store.videoUnlockStatus(video.id)
  if (unlockStatus.locked) {
    uni.showToast({
      title: `第${unlockStatus.episodeNumber ?? ''}集将于 ${formatUnlockTime(unlockStatus.unlockAt)} 解锁`,
      icon: 'none'
    })
    return
  }

  uni.navigateTo({
    url: `/pages/player/index?id=${encodeURIComponent(video.id)}`
  })
}

async function refreshCatalog(): Promise<void> {
  if (refreshDisabled.value) {
    return
  }

  refreshing.value = true
  try {
    const result = await store.syncBaidu(true)
    if (result.ok) {
      uni.showToast({ title: '目录已更新', icon: 'none' })
      return
    }

    const title =
      result.reason === 'cooldown'
        ? '刷新过于频繁，请稍后再试'
        : result.reason === 'no-session' || result.reason === 'authorization'
          ? '请先连接百度网盘'
          : '目录刷新失败，请稍后重试'
    uni.showToast({ title, icon: 'none' })
  } catch {
    uni.showToast({ title: '目录刷新失败，请稍后重试', icon: 'none' })
  } finally {
    refreshing.value = false
  }
}

function formatUnlockTime(timestamp: number | undefined): string {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) return '后续日期零点'
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} 00:00`
}

function countFolderVideos(folder: VideoFolder): number {
  return (
    folder.videos.length +
    folder.folders.reduce(
      (total, child) => total + countFolderVideos(child),
      0
    )
  )
}

function loadMore(): void {
  visibleLimit.value += LIBRARY_BATCH_SIZE
}

function resetVisibleLimit(): void {
  visibleLimit.value = LIBRARY_BATCH_SIZE
}

function scheduleSearch(query: string): void {
  if (searchTimer !== undefined) {
    clearTimeout(searchTimer)
  }

  searchTimer = setTimeout(() => {
    store.searchQuery = query
    searchTimer = undefined
  }, SEARCH_DEBOUNCE_MS)

  const timerWithUnref = searchTimer as unknown as { unref?: () => void }
  timerWithUnref.unref?.()
}

function scheduleCooldownClock(retryAt: number | null): void {
  if (cooldownTimer !== undefined) {
    clearTimeout(cooldownTimer)
    cooldownTimer = undefined
  }

  cooldownClock.value = Date.now()
  if (typeof retryAt !== 'number' || retryAt <= cooldownClock.value) {
    return
  }

  cooldownTimer = setTimeout(() => {
    cooldownClock.value = Date.now()
    cooldownTimer = undefined
  }, retryAt - cooldownClock.value + 1)

  const timerWithUnref = cooldownTimer as unknown as { unref?: () => void }
  timerWithUnref.unref?.()
}

function findFolder(root: VideoFolder, path: string): VideoFolder | undefined {
  if (root.path === path) {
    return root
  }

  for (const child of root.folders) {
    const match = findFolder(child, path)
    if (match) {
      return match
    }
  }

  return undefined
}

function findFolderTrail(
  root: VideoFolder,
  path: string
): VideoFolder[] | undefined {
  if (root.path === path) {
    return [root]
  }

  for (const child of root.folders) {
    const childTrail = findFolderTrail(child, path)
    if (childTrail) {
      return [root, ...childTrail]
    }
  }

  return undefined
}
</script>

<template>
  <view class="page-shell library-page library-page--premium">
    <header class="library-header library-header--premium">
      <view class="library-header__copy">
        <text class="library-header__title">视频库</text>
      </view>
      <view class="library-header__actions">
        <button type="button" data-testid="library-refresh" class="library-refresh-button" aria-label="刷新百度视频目录" title="刷新" :disabled="refreshDisabled" @click="refreshCatalog">
          <RefreshCw :size="18" :class="{ 'library-icon--spinning': refreshing }" aria-hidden="true" />
        </button>
        <button
        type="button"
        data-testid="library-add"
        class="library-add-button"
        aria-label="导入媒体直链"
        title="导入媒体直链"
        @click="openNewImport"
      >
        <Plus :size="23" aria-hidden="true" />
        </button>
      </view>
    </header>

    <label class="library-search">
      <Search :size="20" :stroke-width="1.9" aria-hidden="true" />
      <input
        v-model="searchInput"
        data-testid="library-search"
        type="text"
        confirm-type="search"
        autocorrect="off"
        placeholder="搜索视频或文件夹"
        aria-label="搜索本地视频名称或路径"
      />
    </label>

    <view class="library-segment" role="group" aria-label="视频库视图">
      <button
        type="button"
        class="library-segment__button"
        :class="{ 'library-segment__button--active': activeView === 'recent' }"
        :aria-pressed="activeView === 'recent'"
        @click="setView('recent')"
      >
        最近
      </button>
      <button
        type="button"
        class="library-segment__button"
        :class="{ 'library-segment__button--active': activeView === 'folders' }"
        :aria-pressed="activeView === 'folders'"
        @click="setView('folders')"
      >
        文件夹
      </button>
    </view>

    <main class="library-content">
      <template v-if="hasSearch || activeView === 'recent'">
        <view v-if="listedVideos.length" class="library-video-list library-video-grid">
          <view
            v-for="video in visibleListedVideos"
            :key="video.id"
            class="library-video-entry"
          >
            <VideoRow :video="video" display="card" :unlock-status="store.videoUnlockStatus(video.id)" @select="openPlayer" />
            <button
              v-if="video.sourceType === 'direct'"
              type="button"
              data-testid="manage-direct-link"
              class="library-manage-button"
              :aria-label="`编辑媒体直链：${video.name}`"
              title="编辑媒体直链"
              @click="editDirect(video)"
            >
              <Pencil :size="19" aria-hidden="true" />
            </button>
          </view>
        </view>
        <view
          v-else
          :data-testid="hasSearch ? 'library-empty-search' : undefined"
          class="library-empty-band"
        >
          {{ hasSearch ? '没有找到匹配的视频' : '暂无视频' }}
        </view>
        <button
          v-if="visibleListedVideos.length < listedVideos.length"
          type="button"
          data-testid="library-load-more"
          class="library-load-more"
          @click="loadMore"
        >
          加载更多
        </button>

        <section v-if="!hasSearch && store.folderTree.folders.length" class="library-folder-section" aria-labelledby="library-folder-title">
          <view class="library-section-heading">
            <text id="library-folder-title">文件夹</text>
          </view>
          <view class="library-folder-list library-folder-list--home">
            <button
              v-for="folder in visibleRootFolders"
              :key="folder.path"
              type="button"
              data-testid="folder-row"
              class="library-folder-row"
              :aria-label="`打开文件夹 ${folder.name}`"
              @click="enterFolder(folder)"
            >
              <Folder :size="19" aria-hidden="true" />
              <view class="library-folder-row__copy">
                <text class="library-folder-row__name">{{ folder.name }}</text>
                <text class="library-folder-row__count">{{ countFolderVideos(folder) }} 个视频</text>
              </view>
              <ChevronRight :size="18" aria-hidden="true" />
            </button>
          </view>
        </section>
      </template>

      <template v-else>
        <view class="library-section-heading library-section-heading--folder-view">
          <text>文件夹</text>
          <view class="library-section-heading__actions">
          </view>
        </view>
        <nav class="library-breadcrumbs" aria-label="文件夹路径">
          <button
            v-for="folder in breadcrumbs"
            :key="folder.path"
            type="button"
            data-testid="breadcrumb"
            class="library-breadcrumb"
            :aria-current="folder.path === activeFolder.path ? 'page' : undefined"
            @click="enterFolder(folder)"
          >
            {{ folder.name }}
          </button>
        </nav>

        <view v-if="activeFolder.folders.length" class="library-folder-list">
          <button
            v-for="folder in visibleFolders"
            :key="folder.path"
            type="button"
            data-testid="folder-row"
            class="library-folder-row"
            :aria-label="`打开文件夹 ${folder.name}`"
            @click="enterFolder(folder)"
          >
            <Folder :size="22" aria-hidden="true" />
            <view class="library-folder-row__copy">
              <text class="library-folder-row__name">{{ folder.name }}</text>
              <text class="library-folder-row__count">
                {{ countFolderVideos(folder) }} 个视频
              </text>
            </view>
            <ChevronRight :size="20" aria-hidden="true" />
          </button>
        </view>

        <view v-if="activeFolder.videos.length" class="library-video-list">
          <view
            v-for="video in visibleFolderVideos"
            :key="video.id"
            class="library-video-entry"
          >
            <VideoRow :video="video" display="card" :unlock-status="store.videoUnlockStatus(video.id)" @select="openPlayer" />
          </view>
        </view>

        <button
          v-if="hasMoreFolderEntries"
          type="button"
          data-testid="library-load-more"
          class="library-load-more"
          @click="loadMore"
        >
          加载更多
        </button>

        <view
          v-if="!activeFolder.folders.length && !activeFolder.videos.length"
          class="library-empty-band"
        >
          此文件夹暂无视频
        </view>
      </template>
    </main>

    <BottomNav active="library" />
    <DirectLinkSheet
      :open="importOpen"
      :record="editingRecord"
      :service="directLinkService"
      @close="closeImport"
      @saved="reloadDirectCatalog"
      @deleted="reloadDirectCatalog"
    />
  </view>
</template>

<style scoped lang="scss">
@use '@/styles/tokens.scss' as *;

.library-page {
  padding-top: calc(max(var(--status-bar-height, 0px), env(safe-area-inset-top, 0px)) + 26rpx);
}

.library-header,
.library-header__actions,
.library-search,
.library-folder-row,
.library-breadcrumbs {
  display: flex;
  align-items: center;
}

.library-header {
  justify-content: space-between;
  min-height: 88rpx;
}

.library-header__copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.library-header__title {
  color: $color-text;
  font-size: 38rpx;
  font-weight: 680;
  line-height: 1.2;
}

.library-header__count {
  margin-top: 5rpx;
  color: $color-muted;
  font-size: 20rpx;
  line-height: 1.4;
}

.library-header__actions { display: flex; align-items: center; flex: 0 0 auto; }

.library-add-button,
.library-refresh-button {
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0;
  padding: 0;
  border: 0;
  color: $color-text;
  background: transparent;
}

.library-add-button { width: 54rpx; height: 54rpx; color: $color-primary; }
.library-add-button--small { width: 48rpx; height: 48rpx; }
.library-refresh-button { width: 46rpx; height: 46rpx; color: $color-muted; }
.library-section-heading { display: flex; align-items: center; justify-content: space-between; margin: 24rpx 2rpx 8rpx; color: $color-text; font-size: 24rpx; font-weight: 650; }
.library-section-heading--folder-view { margin-top: 18rpx; }
.library-section-heading__actions { display: flex; align-items: center; }
.library-folder-list--home { border: 0; border-radius: 0; background: transparent; }
.library-folder-list--home .library-folder-row { min-height: 78rpx; padding: 12rpx 2rpx; }
.library-folder-list--home .library-folder-row + .library-folder-row { border-top: 1px solid $color-border; }

.library-icon-button,
.library-manage-button {
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0;
  padding: 0;
  border: 1px solid $color-border;
  border-radius: 14px;
  color: $color-text;
  background: $color-surface;
}

.library-icon-button {
  width: 74rpx;
  height: 74rpx;
  margin-left: 10rpx;
}

.library-icon-button--primary {
  border-color: $color-primary;
  color: #fff;
  background: $color-primary;
}

.library-icon-button:disabled {
  opacity: 0.46;
}

.library-search {
  box-sizing: border-box;
  width: 100%;
  height: 64rpx;
  margin-top: 8rpx;
  padding: 0 20rpx;
  border: 1px solid $color-border;
  border-radius: 16px;
  color: $color-muted;
  background: #efede5;
  box-shadow: none;
}

.library-search input {
  min-width: 0;
  flex: 1;
  height: 100%;
  margin-left: 12rpx;
  color: $color-text;
  font-size: 23rpx;
}

.library-segment {
  box-sizing: border-box;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  width: 100%;
  height: 78rpx;
  margin-top: 8rpx;
  padding: 0;
  border-radius: 0;
  background: transparent;
}

.library-segment__button {
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  min-width: 0;
  height: 66rpx;
  margin: 0;
  padding: 0 14rpx;
  border: 0;
  border-radius: 12px;
  color: $color-muted;
  font-size: 22rpx;
  font-weight: 560;
  line-height: 1.2;
  background: transparent;
}

.library-segment__button { position: relative; font-size: 26rpx; }
.library-segment__button--active { color: $color-primary; font-weight: 650; }
.library-segment__button--active::before { position: absolute; bottom: 4rpx; left: 41%; right: 41%; height: 3rpx; background: $color-primary; content: ''; }

.library-content {
  margin-top: 4rpx;
}

.library-video-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-items: start;
  margin: -7rpx;
}

.library-video-entry {
  position: relative;
  min-width: 0;
  margin: 7rpx;
  overflow: hidden;
  border: 0;
  border-radius: 0;
  background: transparent;
}

.library-video-entry :deep(.video-row--card) { width: 100%; }

.library-video-entry :deep(.video-thumbnail) { padding-bottom: 40%; border-radius: 6px; }

.library-video-entry :deep(.video-row__content) { margin-top: 8rpx; }

.library-video-entry :deep(.video-row__name) { font-size: 27rpx; line-height: 1.3; }
.library-video-entry :deep(.video-row__metadata) { font-size: 21rpx; }

.library-video-entry :deep(.video-row__unlock) {
  margin-top: 7rpx;
}

.library-manage-button {
  position: absolute;
  top: 16rpx;
  right: 16rpx;
  width: 58rpx;
  height: 58rpx;
  border-color: rgba(255, 254, 249, 0.8);
  border-radius: 50%;
  color: $color-primary;
  background: rgba($color-surface, 0.94);
  box-shadow: 0 4rpx 14rpx rgba(22, 47, 37, 0.14);
}

.library-folder-list { overflow: hidden; border: 0; border-radius: 0; background: transparent; }

.library-folder-row {
  box-sizing: border-box;
  width: 100%;
  min-height: 84rpx;
  margin: 0;
  padding: 18rpx 20rpx;
  border: 0;
  border-radius: 0;
  color: $color-primary;
  text-align: left;
  background: transparent;
}

.library-folder-row + .library-folder-row {
  border-top: 1px solid $color-border;
}

.library-folder-row__copy {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  margin: 0 14rpx;
}

.library-folder-row__name {
  overflow: hidden;
  color: $color-text;
  font-size: 24rpx;
  font-weight: 620;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.library-folder-row__count {
  margin-top: 5rpx;
  color: $color-muted;
  font-size: 19rpx;
}

.library-breadcrumbs {
  overflow-x: auto;
  margin-bottom: 14rpx;
}

.library-breadcrumb {
  flex: 0 0 auto;
  min-height: 58rpx;
  margin: 0 6rpx 0 0;
  padding: 8rpx 14rpx;
  border: 0;
  border-radius: 999px;
  color: $color-muted;
  font-size: 20rpx;
  background: transparent;
}

.library-breadcrumb[aria-current='page'] {
  color: $color-primary;
  background: $color-primary-soft;
}

.library-empty-band {
  padding: 36rpx 24rpx;
  border: 1px dashed $color-border;
  border-radius: 16px;
  color: $color-muted;
  font-size: 22rpx;
  line-height: 1.5;
  text-align: center;
  background: rgba($color-surface, 0.64);
}

.library-load-more {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-height: 72rpx;
  margin: 18rpx 0 0;
  padding: 10rpx 18rpx;
  border: 1px solid $color-border;
  border-radius: 14px;
  color: $color-primary;
  font-size: 21rpx;
  font-weight: 620;
  background: $color-primary-soft;
}

.library-icon--spinning {
  animation: library-spin 0.9s linear infinite;
}



@keyframes library-spin {
  to { transform: rotate(360deg); }
}
</style>
