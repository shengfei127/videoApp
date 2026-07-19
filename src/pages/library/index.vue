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
} from 'lucide-vue-next'

import BottomNav from '@/components/BottomNav.vue'
import DirectLinkSheet from '@/components/DirectLinkSheet.vue'
import VideoRow from '@/components/VideoRow.vue'
import type { DirectVideoRecord, VideoFolder, VideoItem } from '@/domain/video'
import { DirectLinkService } from '@/features/direct-links/directLinkService'
import { uniStorage } from '@/infrastructure/storage'
import { useAppStore } from '@/stores/appStore'

type LibraryView = 'recent' | 'folders'

const store = useAppStore()
const directLinkService = new DirectLinkService(uniStorage)
const activeView = ref<LibraryView>('recent')
const activeFolderPath = ref(store.folderTree.path)
const importOpen = ref(false)
const editingRecord = ref<DirectVideoRecord | undefined>()
const refreshing = ref(false)
const cooldownClock = ref(Date.now())
let cooldownTimer: ReturnType<typeof setTimeout> | undefined

const hasSearch = computed(() => Boolean(store.searchQuery.trim()))
const listedVideos = computed(() =>
  hasSearch.value ? store.searchResults : store.recentVideos
)
const activeFolder = computed(() =>
  findFolder(store.folderTree, activeFolderPath.value) ?? store.folderTree
)
const breadcrumbs = computed(() =>
  findFolderTrail(store.folderTree, activeFolder.value.path) ?? [store.folderTree]
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

watch(
  () => store.nextSyncAllowedAt,
  (retryAt) => scheduleCooldownClock(retryAt),
  { immediate: true }
)

onUnmounted(() => {
  if (cooldownTimer !== undefined) {
    clearTimeout(cooldownTimer)
  }
})

onLoad((query) => {
  if (query?.openImport === '1') {
    openNewImport()
  }
})

function setView(view: LibraryView): void {
  activeView.value = view
  if (view === 'folders') {
    activeFolderPath.value = store.folderTree.path
  }
}

function enterFolder(folder: VideoFolder): void {
  activeFolderPath.value = folder.path
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
}

function openPlayer(video: VideoItem): void {
  if (typeof video?.id !== 'string' || !video.id) {
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

function countFolderVideos(folder: VideoFolder): number {
  return (
    folder.videos.length +
    folder.folders.reduce(
      (total, child) => total + countFolderVideos(child),
      0
    )
  )
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
  <view class="page-shell library-page">
    <header class="library-header">
      <view class="library-header__copy">
        <text class="library-header__title">视频库</text>
        <text class="library-header__count">
          本机目录 {{ store.mergedVideos.length }} 项
        </text>
      </view>
      <view class="library-header__actions">
        <button
          type="button"
          data-testid="library-refresh"
          class="library-icon-button"
          aria-label="刷新百度视频目录"
          title="刷新"
          :disabled="refreshDisabled"
          @click="refreshCatalog"
        >
          <RefreshCw
            :size="21"
            :class="{ 'library-icon--spinning': refreshing }"
            aria-hidden="true"
          />
        </button>
        <button
          type="button"
          data-testid="library-add"
          class="library-icon-button library-icon-button--primary"
          aria-label="导入媒体直链"
          title="导入媒体直链"
          @click="openNewImport"
        >
          <Plus :size="22" aria-hidden="true" />
        </button>
      </view>
    </header>

    <label class="library-search">
      <Search :size="20" :stroke-width="1.9" aria-hidden="true" />
      <input
        v-model="store.searchQuery"
        data-testid="library-search"
        type="text"
        confirm-type="search"
        autocorrect="off"
        placeholder="搜索已同步的视频"
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
        最近视频
      </button>
      <button
        type="button"
        class="library-segment__button"
        :class="{ 'library-segment__button--active': activeView === 'folders' }"
        :aria-pressed="activeView === 'folders'"
        @click="setView('folders')"
      >
        按文件夹
      </button>
    </view>

    <main class="library-content">
      <template v-if="hasSearch || activeView === 'recent'">
        <view v-if="listedVideos.length" class="library-video-list">
          <view
            v-for="video in listedVideos"
            :key="video.id"
            class="library-video-entry"
          >
            <VideoRow :video="video" @select="openPlayer" />
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
      </template>

      <template v-else>
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
            v-for="folder in activeFolder.folders"
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
            v-for="video in activeFolder.videos"
            :key="video.id"
            class="library-video-entry"
          >
            <VideoRow :video="video" @select="openPlayer" />
          </view>
        </view>

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
  padding-top: max(24rpx, env(safe-area-inset-top));
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
  gap: 20rpx;
  min-height: 92rpx;
}

.library-header__copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 4rpx;
}

.library-header__title {
  font-size: 36rpx;
  font-weight: 760;
  line-height: 1.2;
}

.library-header__count {
  color: $color-muted;
  font-size: 21rpx;
  line-height: 1.35;
}

.library-header__actions {
  flex: 0 0 auto;
  gap: 12rpx;
}

.library-icon-button,
.library-manage-button {
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0;
  padding: 0;
  border: 1px solid $color-border;
  border-radius: $radius-control;
  color: $color-text;
  background: $color-surface;
}

.library-icon-button {
  width: 76rpx;
  height: 76rpx;
}

.library-icon-button--primary {
  border-color: $color-primary;
  color: #ffffff;
  background: $color-primary;
}

.library-icon-button:disabled {
  cursor: not-allowed;
  opacity: 0.46;
}

.library-search {
  box-sizing: border-box;
  gap: 12rpx;
  width: 100%;
  height: 78rpx;
  margin-top: 20rpx;
  padding: 0 18rpx;
  border: 1px solid $color-border;
  border-radius: $radius-control;
  color: $color-muted;
  background: $color-surface;
}

.library-search input {
  min-width: 0;
  flex: 1;
  height: 100%;
  color: $color-text;
  font-size: 24rpx;
}

.library-segment {
  box-sizing: border-box;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  width: 100%;
  height: 76rpx;
  margin-top: 18rpx;
  padding: 4rpx;
  border: 1px solid $color-border;
  border-radius: $radius-control;
  background: #e9ece9;
}

.library-segment__button {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  height: 66rpx;
  margin: 0;
  padding: 0 14rpx;
  border: 0;
  border-radius: 4px;
  color: $color-muted;
  font-size: 23rpx;
  font-weight: 700;
  line-height: 1.2;
  background: transparent;
}

.library-segment__button--active {
  color: $color-primary;
  background: $color-surface;
}

.library-content {
  margin-top: 22rpx;
}

.library-video-list,
.library-folder-list {
  border-top: 1px solid $color-border;
  border-bottom: 1px solid $color-border;
  background: rgba($color-surface, 0.62);
}

.library-video-entry {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12rpx;
  align-items: center;
  padding: 0 18rpx;
}

.library-video-entry + .library-video-entry,
.library-folder-row + .library-folder-row {
  border-top: 1px solid $color-border;
}

.library-video-entry > :only-child {
  grid-column: 1 / -1;
}

.library-manage-button {
  width: 68rpx;
  height: 68rpx;
  color: $color-primary;
}

.library-folder-row {
  box-sizing: border-box;
  gap: 16rpx;
  width: 100%;
  min-height: 92rpx;
  margin: 0;
  padding: 16rpx 18rpx;
  border: 0;
  border-radius: 0;
  color: $color-primary;
  text-align: left;
  background: transparent;
}

.library-folder-row__copy {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 4rpx;
}

.library-folder-row__name {
  overflow: hidden;
  color: $color-text;
  font-size: 26rpx;
  font-weight: 680;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.library-folder-row__count {
  color: $color-muted;
  font-size: 21rpx;
}

.library-breadcrumbs {
  gap: 8rpx;
  overflow-x: auto;
  margin-bottom: 16rpx;
  padding-bottom: 4rpx;
}

.library-breadcrumb {
  flex: 0 0 auto;
  min-height: 58rpx;
  margin: 0;
  padding: 8rpx 14rpx;
  border: 0;
  border-radius: $radius-control;
  color: $color-primary;
  font-size: 22rpx;
  background: transparent;
}

.library-breadcrumb[aria-current='page'] {
  color: $color-text;
  background: $color-primary-soft;
}

.library-empty-band {
  padding: 28rpx 18rpx;
  border-top: 1px solid $color-border;
  border-bottom: 1px solid $color-border;
  color: $color-muted;
  font-size: 23rpx;
  line-height: 1.45;
  background: rgba($color-surface, 0.5);
}

.library-icon--spinning {
  animation: library-spin 0.9s linear infinite;
}

@keyframes library-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
