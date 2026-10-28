<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  Cloud,
  CalendarDays,
  Folder,
  ChevronRight,
  Database,
  History,
  Link,
  LogOut,
  ShieldCheck,
  Trash2
} from '@/components/icons'

import BottomNav from '@/components/BottomNav.vue'
import LearningRecoveryNotice from '@/components/LearningRecoveryNotice.vue'
import BackupPanel from '@/components/BackupPanel.vue'
import { runtimeConfig } from '@/config/runtime'
import { getNextCourseUnlockAt } from '@/features/daily-unlock/dailyUnlockPolicy'
import { useDailyUnlockClock } from '@/features/daily-unlock/dailyUnlockClock'
import { useAppStore } from '@/stores/appStore'
import type { StorageAudit } from '@/features/playback/storageAudit'

const appVersion = __PIANKE_APP_VERSION__
const store = useAppStore()
const expandedSection = ref('')
const storageAudit = ref<StorageAudit | null>(null)
const storageAuditError = ref('')
const storageAuditResult = ref('')
function inspectStorage(): void {
  storageAuditResult.value = ''
  storageAudit.value = store.inspectLearningStorage()
  storageAuditError.value = storageAudit.value ? '' : '读取存储信息失败，请重试'
}
function compactStorage(): void {
  const result = store.compactLearningStorage()
  storageAuditResult.value = ''
  if (!result) {
    storageAuditError.value = '整理失败，请重试；未确认完成清理'
    return
  }
  storageAudit.value = result
  storageAuditError.value = ''
  storageAuditResult.value = result.removedRecords > 0
    ? `已清理 ${result.removedRecords} 条完全重复记录，节省 ${formatStorageBytes(result.savedBytes)}。学习状态和播放历史已保留。`
    : '没有需要清理的重复记录，学习状态和播放历史已保留。'
}
function formatStorageBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
function toggleSection(section: string): void {
  expandedSection.value = expandedSection.value === section ? '' : section
  if (expandedSection.value === 'local') inspectStorage()
}

const connectionStatus = computed(() =>
  store.authSession ? '已连接' : '未连接'
)
const expiresText = computed(() =>
  store.authSession
    ? formatDateTime(store.authSession.expiresAt)
    : '连接后显示'
)
const cacheText = computed(() =>
  store.baiduCacheSavedAt === null
    ? '尚未同步'
    : formatDateTime(store.baiduCacheSavedAt)
)

const dailyUnlockCourses = computed(() => store.dailyUnlockSettings.courses)
const dailyUnlockSummary = computed(() => {
  if (!dailyUnlockCourses.value.length) return '0 门课程'
  const paused = dailyUnlockCourses.value.filter((course) => course.pausedAt !== undefined).length
  return `${dailyUnlockCourses.value.length} 门课程${paused ? ` · ${paused} 门已暂停` : ''}`
})
const nextDailyUnlockText = computed(() => {
  if (!store.dailyUnlockSettings.enabled) return '每日解锁已关闭，所有视频均可播放'
  if (!dailyUnlockCourses.value.length) return '创建课程后按本机自然日解锁'
  const timestamps = dailyUnlockCourses.value
    .map((course) => getNextCourseUnlockAt(course, store.dailyUnlockNow))
    .filter((value): value is number => typeof value === 'number')
  if (!timestamps.length) return dailyUnlockCourses.value.some((course) => course.pausedAt !== undefined)
    ? '暂无新的开放安排，可在管理课程中恢复暂停的计划'
    : '全部课程已开放，可前往首页补学或复习'
  return `下次解锁 ${formatDateTime(Math.min(...timestamps))}`
})

useDailyUnlockClock((now) => store.refreshDailyUnlockClock(now))

function toggleDailyUnlock(): void {
  const succeeded = store.setDailyUnlockEnabled(!store.dailyUnlockSettings.enabled)
  if (!succeeded) {
    uni.showToast({ title: '每日解锁设置保存失败', icon: 'none' })
  }
}

function openDailyUnlockManager(): void {
  uni.navigateTo({
    url: '/pages/daily-unlock/index',
    animationType: 'slide-in-bottom'
  })
}

function refreshLearningData(): void {
  store.reloadDailyUnlockSettings()
  store.reloadProgress()
}

function connectBaidu(): void {
  uni.navigateTo({ url: '/pages/oauth/index' })
}

function requestDisconnect(): void {
  let settled = false
  uni.showModal({
    title: '断开百度网盘',
    content: '将删除本机保存的百度授权，直链、目录缓存和播放历史会保留。',
    confirmText: '断开',
    confirmColor: '#c44732',
    cancelText: '取消',
    success: ({ confirm }) => {
      if (settled) {
        return
      }
      settled = true

      if (!confirm) {
        return
      }

      showDestructiveResult(
        () => store.disconnectBaidu(),
        '已断开百度网盘',
        '断开失败，请稍后重试'
      )
    }
  })
}

function requestClearCache(): void {
  let settled = false
  uni.showModal({
    title: '清除目录缓存',
    content: '只清除已同步到本机的百度视频目录，不会断开授权或删除播放历史。',
    confirmText: '清除',
    confirmColor: '#c44732',
    cancelText: '取消',
    success: ({ confirm }) => {
      if (settled) {
        return
      }
      settled = true

      if (!confirm) {
        return
      }

      showDestructiveResult(
        () => store.clearCatalogCache(),
        '目录缓存已清除',
        '目录缓存清除失败，请稍后重试'
      )
    }
  })
}

function requestClearHistory(): void {
  let settled = false
  uni.showModal({
    title: '清除播放历史',
    content: '将永久删除本机保存的全部播放位置和续播记录。',
    confirmText: '继续',
    confirmColor: '#c44732',
    cancelText: '取消',
    success: ({ confirm }) => {
      if (settled) {
        return
      }
      settled = true

      if (confirm) {
        requestSecondHistoryConfirmation()
      }
    }
  })
}

function requestSecondHistoryConfirmation(): void {
  let settled = false
  uni.showModal({
    title: '再次确认清除',
    content: '播放历史清除后无法恢复。确认永久清除？',
    confirmText: '永久清除',
    confirmColor: '#c44732',
    cancelText: '取消',
    success: ({ confirm }) => {
      if (settled) {
        return
      }
      settled = true

      if (!confirm) {
        return
      }

      showDestructiveResult(
        () => store.clearProgress(),
        '播放历史已清除',
        '播放历史清除失败，请稍后重试'
      )
    }
  })
}

function showDestructiveResult(
  action: () => boolean,
  successTitle: string,
  failureTitle: string
): void {
  let succeeded = false
  try {
    succeeded = action()
  } catch {
    succeeded = false
  }

  uni.showToast({
    title: succeeded ? successTitle : failureTitle,
    icon: 'none'
  })
}

function formatDateTime(value: number): string {
  if (!Number.isFinite(value) || value < 0) {
    return '时间未知'
  }

  try {
    return new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(new Date(value))
  } catch {
    // App service engines without Intl still support local Date accessors.
    const date = new Date(value)
    if (!Number.isFinite(date.getTime())) return '时间未知'
    const pad = (part: number): string => String(part).padStart(2, '0')
    return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
  }
}
</script>

<template>
  <view class="page-shell settings-page settings-page--premium">
    <header class="settings-header">
      <text class="settings-header__title">设置</text>

    </header>

    <main class="settings-content settings-menu">
      <section class="settings-section" aria-labelledby="settings-baidu-title">
        <button class="settings-menu-row" :aria-expanded="expandedSection === 'baidu'" @click="toggleSection('baidu')">
          <Cloud :size="23" aria-hidden="true" />
          <view class="settings-menu-row__copy"><text id="settings-baidu-title">百度网盘</text><text class="settings-menu-row__detail">{{ connectionStatus }}</text></view>
          <ChevronRight :size="18" aria-hidden="true" />
        </button>
        <view v-show="expandedSection === 'baidu'" class="settings-expanded">
        <view class="settings-band">
          <view class="settings-row">
            <text class="settings-row__label">连接状态</text>
            <text class="settings-row__value settings-row__value--strong">
              {{ connectionStatus }}
            </text>
          </view>
          <view class="settings-row">
            <text class="settings-row__label">应用目录</text>
            <text class="settings-row__value">{{ runtimeConfig.baiduRoot }}</text>
          </view>
          <view class="settings-row">
            <text class="settings-row__label">授权有效期</text>
            <text class="settings-row__value">{{ expiresText }}</text>
          </view>
          <view class="settings-row">
            <text class="settings-row__label">上次目录缓存</text>
            <text class="settings-row__value">{{ cacheText }}</text>
          </view>
        </view>
        <button
          v-if="store.authSession"
          type="button"
          data-testid="settings-disconnect"
          class="settings-action settings-action--danger"
          aria-label="断开百度网盘连接"
          @click="requestDisconnect"
        >
          <LogOut :size="19" aria-hidden="true" />
          <text>断开连接</text>
        </button>
        <button
          v-else
          type="button"
          class="settings-action settings-action--primary"
          aria-label="连接百度网盘"
          @click="connectBaidu"
        >
          <Cloud :size="19" aria-hidden="true" />
          <text>连接百度网盘</text>
        </button>
        </view>
      </section>

      <section class="settings-section" aria-labelledby="settings-daily-unlock-title">
        <button class="settings-menu-row" :aria-expanded="expandedSection === 'daily'" @click="toggleSection('daily')">
          <CalendarDays :size="23" aria-hidden="true" />
          <view class="settings-menu-row__copy"><text id="settings-daily-unlock-title">每日课程</text><text class="settings-menu-row__detail">学习计划与课程管理</text></view>
          <ChevronRight :size="18" aria-hidden="true" />
        </button>
        <view v-show="expandedSection === 'daily'" class="settings-expanded">
        <view class="settings-band daily-unlock-band">
          <view class="daily-unlock-row">
            <view class="daily-unlock-copy">
              <text class="daily-unlock-title">每日解锁课程</text>
              <text class="daily-unlock-description">开启后，按各门课程设置的每日集数，在本机零点开放新内容；暂停的课程不再新增内容</text>
            </view>
            <button
              type="button"
              role="switch"
              data-testid="daily-unlock-toggle"
              class="daily-unlock-switch"
              :class="{ 'daily-unlock-switch--on': store.dailyUnlockSettings.enabled }"
              :aria-checked="store.dailyUnlockSettings.enabled"
              aria-label="每日解锁课程"
              @click="toggleDailyUnlock"
            >
              <view class="daily-unlock-switch__thumb" />
            </button>
          </view>
          <view class="daily-unlock-status">
            <text>{{ dailyUnlockSummary }}</text>
            <text>{{ nextDailyUnlockText }}</text>
          </view>
        </view>
        <button
          type="button"
          data-testid="daily-unlock-manage"
          class="settings-action settings-action--secondary daily-unlock-manage"
          @click="openDailyUnlockManager"
        >
          <History :size="18" aria-hidden="true" />
          <text>管理课程</text>
        </button>
        </view>
      </section>

      <section class="settings-section" aria-labelledby="settings-local-title">
        <button class="settings-menu-row" data-testid="settings-local" :aria-expanded="expandedSection === 'local'" @click="toggleSection('local')">
          <Folder :size="23" aria-hidden="true" />
          <view class="settings-menu-row__copy"><text id="settings-local-title">本地数据</text><text class="settings-menu-row__detail">视频缓存与存储</text></view>
          <ChevronRight :size="18" aria-hidden="true" />
        </button>
        <view v-show="expandedSection === 'local'" class="settings-expanded">
        <view class="settings-band">
          <view class="settings-row">
            <view class="settings-row__label-with-icon">
              <Link :size="18" aria-hidden="true" />
              <text>媒体直链</text>
            </view>
            <text class="settings-row__value">
              {{ store.directRecords.length }} 条
            </text>
          </view>
          <view class="settings-row">
            <view class="settings-row__label-with-icon">
              <History :size="18" aria-hidden="true" />
              <text>播放历史</text>
            </view>
            <text class="settings-row__value">
              {{ store.progressHistory.length }} 条
            </text>
          </view>
        </view>
        <view class="settings-storage-audit" data-testid="storage-audit">
          <text class="settings-storage-audit__title">学习数据存储</text>
          <template v-if="storageAudit">
            <text>播放记录 {{ storageAudit.playbackRecords }} 条 · 学习记录 {{ storageAudit.learningRecords }} 条</text>
            <text>课程与记录约占 {{ formatStorageBytes(storageAudit.bytes) }} · 完全重复 {{ storageAudit.duplicateRecords }} 条</text>
          </template>
          <text>仅整理完全重复的记录，保留学习状态、播放历史和课程安排，不按时间删除旧记录。</text>
          <text v-if="storageAuditError" class="settings-storage-audit__error" role="alert">{{ storageAuditError }}</text>
          <text v-if="storageAuditResult" role="status" data-testid="storage-audit-result">{{ storageAuditResult }}</text>
          <view class="settings-action-row">
            <button class="settings-action settings-action--secondary" data-testid="storage-inspect" @click="inspectStorage">刷新统计</button>
            <button v-if="storageAudit && storageAudit.duplicateRecords > 0" class="settings-action settings-action--secondary" data-testid="storage-compact" @click="compactStorage">清理重复记录</button>
          </view>
        </view>
        <view class="settings-action-row">
          <button
            type="button"
            data-testid="settings-clear-cache"
            class="settings-action settings-action--secondary"
            aria-label="清除百度目录缓存"
            @click="requestClearCache"
          >
            <Database :size="18" aria-hidden="true" />
            <text>清除目录缓存</text>
          </button>
          <button
            type="button"
            data-testid="settings-clear-history"
            class="settings-action settings-action--danger"
            aria-label="永久清除本机播放历史"
            @click="requestClearHistory"
          >
            <Trash2 :size="18" aria-hidden="true" />
            <text>清除播放历史</text>
          </button>
        </view>
        </view>
      </section>

      <LearningRecoveryNotice />
      <section class="settings-section" aria-labelledby="settings-backup-title">
        <button class="settings-menu-row" data-testid="settings-backup" :aria-expanded="expandedSection === 'backup'" @click="toggleSection('backup')">
          <Database :size="23" aria-hidden="true" />
          <view class="settings-menu-row__copy"><text id="settings-backup-title">学习数据备份</text><text class="settings-menu-row__detail">导出与恢复课程、学习状态和播放进度</text></view>
          <ChevronRight :size="18" aria-hidden="true" />
        </button>
        <view v-if="expandedSection === 'backup'" class="settings-expanded"><BackupPanel @restored="refreshLearningData" /></view>
      </section>

      <section class="settings-section" aria-labelledby="settings-privacy-title">
        <button class="settings-menu-row" :aria-expanded="expandedSection === 'privacy'" @click="toggleSection('privacy')">
          <ShieldCheck :size="23" aria-hidden="true" />
          <view class="settings-menu-row__copy"><text id="settings-privacy-title">隐私保护</text><text class="settings-menu-row__detail">权限与数据安全</text></view>
          <ChevronRight :size="18" aria-hidden="true" />
        </button>
        <view v-show="expandedSection === 'privacy'" class="settings-privacy-band">
          <text>播放进度和媒体直链仅保存在本机。</text>
          <text>百度授权仅用于访问应用专属目录，不显示或记录访问凭证。</text>
        </view>
      </section>

      <button class="settings-menu-row settings-menu-row--short" aria-label="清除百度目录缓存" @click="requestClearCache">
        <Trash2 :size="23" aria-hidden="true" />
        <view class="settings-menu-row__copy"><text>清除缓存</text></view>
        <text class="settings-menu-row__detail">{{ store.baiduVideos.length }} 个视频</text>
      </button>
      <button class="settings-menu-row settings-menu-row--short" :aria-expanded="expandedSection === 'about'" @click="toggleSection('about')">
        <text class="settings-info-icon" aria-hidden="true">i</text>
        <view class="settings-menu-row__copy"><text>关于片刻</text></view>
        <ChevronRight :size="18" aria-hidden="true" />
      </button>
      <view v-show="expandedSection === 'about'" class="settings-version" aria-label="应用版本"><text>片刻</text><text>版本 {{ appVersion }}</text></view>
    </main>

    <BottomNav active="settings" />
  </view>
</template>

<style scoped lang="scss">
@use '@/styles/tokens.scss' as *;
.settings-storage-audit { display: flex; flex-direction: column; padding: 18rpx 0; color: $color-muted; font-size: 23rpx; line-height: 1.6; overflow-wrap: anywhere; }
.settings-storage-audit > * + * { margin-top: 10rpx; }
.settings-storage-audit__title { color: $color-text; font-weight: 600; }
.settings-storage-audit__error { color: #a43b2c; }
.settings-storage-audit .settings-action { min-height: 44px; white-space: normal; }

.settings-page {
  padding-top: calc(max(var(--status-bar-height, 0px), env(safe-area-inset-top, 0px)) + 24rpx);
}

.settings-header {
  display: flex;
  min-height: 92rpx;
  flex-direction: column;
  justify-content: center;
}

.settings-header > * + * { margin-top: 4rpx; }

.settings-header__title {
  font-size: 36rpx;
  font-weight: 760;
  line-height: 1.2;
}

.settings-header__subtitle {
  color: $color-muted;
  font-size: 21rpx;
  line-height: 1.35;
}

.settings-content {
  display: flex;
  flex-direction: column;
  margin-top: 20rpx;
}

.settings-content > * + * { margin-top: 0; }

.settings-section {
  display: flex;
  flex-direction: column;
}

.settings-section > * + * { margin-top: 0; }

.settings-section__heading,
.settings-row,
.settings-row__label-with-icon,
.settings-action,
.settings-version {
  display: flex;
  align-items: center;
}

.settings-action-row {
  display: grid;
}

.settings-section__heading {
  color: $color-text;
  font-size: 27rpx;
  font-weight: 720;
}

.settings-section__heading .app-icon { margin-right: 10rpx; }

.settings-band {
  border-top: 1px solid $color-border;
  border-bottom: 1px solid $color-border;
  background: rgba($color-surface, 0.64);
}

.daily-unlock-band {
  padding: 18rpx;
}

.daily-unlock-row,
.daily-unlock-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
}


.daily-unlock-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.daily-unlock-copy > * + * { margin-top: 6rpx; }

.daily-unlock-title {
  color: $color-text;
  font-size: 24rpx;
  font-weight: 700;
}

.daily-unlock-description,
.daily-unlock-status {
  color: $color-muted;
  font-size: 21rpx;
  line-height: 1.45;
}

.daily-unlock-status {
  align-items: flex-start;
  flex-direction: column;
  margin-top: 16rpx;
  padding-top: 14rpx;
  border-top: 1px solid $color-border;
}

.daily-unlock-status > * + * { margin-top: 4rpx; }

/* Keep the visual track compact inside a 44px touch target. */
.daily-unlock-switch {
  box-sizing: border-box;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 52px;
  width: 52px;
  height: 44px;
  min-height: 44px;
  margin: 0 0 0 18rpx;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: transparent;
}

.daily-unlock-switch::before {
  position: absolute;
  top: 50%;
  left: 0;
  width: 100%;
  height: 32px;
  border-radius: 999px;
  background: #c9cfca;
  content: '';
  transform: translateY(-50%);
  transition: background-color 160ms ease;
}

.daily-unlock-switch--on::before {
  background: $color-primary;
}

.daily-unlock-switch__thumb {
  position: absolute;
  top: 50%;
  left: 4px;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 2rpx 8rpx rgba(26, 41, 34, 0.2);
  transform: translateY(-50%);
  transition: left 160ms ease;
}

.daily-unlock-switch--on .daily-unlock-switch__thumb {
  left: calc(100% - 28px);
}

.daily-unlock-manage {
  width: 100%;
  margin: 0;
}

.daily-unlock-switch:focus-visible,
.daily-unlock-manage:focus-visible {
  outline: 2px solid $color-primary;
  outline-offset: 3px;
}

.settings-row {
  box-sizing: border-box;
  justify-content: space-between;
  min-height: 78rpx;
  padding: 14rpx 18rpx;
}

.settings-row + .settings-row {
  border-top: 1px solid $color-border;
}

.settings-row__label,
.settings-row__label-with-icon {
  min-width: 0;
  color: $color-muted;
  font-size: 23rpx;
  line-height: 1.4;
}

.settings-row__label-with-icon .app-icon { margin-right: 10rpx; }

.settings-row__value {
  max-width: 62%;
  margin-left: 24rpx;
  overflow-wrap: anywhere;
  color: $color-text;
  font-size: 23rpx;
  line-height: 1.4;
  text-align: right;
}

.settings-row__value--strong {
  color: $color-primary;
  font-weight: 720;
}

.settings-action-row {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  margin: -6rpx;
}

.settings-action {
  white-space: normal;
  overflow-wrap: anywhere;
  text-align: center;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  min-height: max(44px, 74rpx);
  margin: 6rpx;
  padding: 12rpx 18rpx;
  border: 1px solid $color-border;
  border-radius: $radius-control;
  font-size: 22rpx;
  font-weight: 700;
  line-height: 1.3;
}

.settings-action .app-icon { margin-right: 8rpx; }

.settings-action--primary {
  border-color: $color-primary;
  color: #ffffff;
  background: $color-primary;
}

.settings-action--secondary {
  color: $color-primary;
  background: $color-primary-soft;
}

.settings-action--danger {
  border-color: #e4b9b1;
  color: #a43b2c;
  background: #fff6f4;
}

.settings-privacy-band {
  display: flex;
  flex-direction: column;
  padding: 20rpx 18rpx;
  border-top: 1px solid $color-border;
  border-bottom: 1px solid $color-border;
  color: $color-muted;
  font-size: 22rpx;
  line-height: 1.55;
  background: rgba($color-surface, 0.5);
}

.settings-privacy-band > * + * { margin-top: 10rpx; }

.settings-version {
  justify-content: space-between;
  padding: 4rpx 2rpx 16rpx;
  color: $color-muted;
  font-size: 21rpx;
}

@media (max-width: 420px) {
  .settings-action-row {
    grid-template-columns: minmax(0, 1fr);
  }

  .settings-row {
    align-items: center;
    flex-direction: row;
  }

  .settings-row__value {
    max-width: 62%;
    text-align: right;
  }
}

.settings-content { margin-top: 12rpx; }
.settings-header { min-height: 78rpx; }
.settings-menu-row { box-sizing: border-box; white-space: normal; display: flex; align-items: center; width: 100%; min-height: 132rpx; margin: 0; padding: 24rpx 0; border: 0; border-bottom: 1px solid rgba($color-border, .65); border-radius: 0; color: $color-text; text-align: left; background: transparent; line-height: 1.35; }
.settings-menu-row__copy { overflow-wrap: anywhere; display: flex; min-width: 0; flex: 1; flex-direction: column; margin: 0 28rpx; font-size: 27rpx; font-weight: 600; }
.settings-menu-row__detail { margin-top: 5rpx; color: $color-muted; font-size: 22rpx; font-weight: 400; }
.settings-menu-row--short { min-height: 98rpx; border-bottom: 0; padding: 20rpx 0; }
.settings-expanded { padding: 8rpx 0 24rpx; }
.settings-info-icon { display: flex; align-items: center; justify-content: center; width: 19px; height: 19px; border: 2px solid currentColor; border-radius: 50%; font-size: 15px; font-family: serif; line-height: 1; }
</style>
