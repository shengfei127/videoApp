<script setup lang="ts">
import { computed, ref } from 'vue'
import { describeLearningBackup, exportLearningBackup, MAX_BACKUP_CHARACTERS, parseLearningBackup, restoreLearningBackup, type LearningBackup } from '@/features/backup/learningBackup'
import { uniStorage } from '@/infrastructure/storage'
import { readBackupHistory, recordBackupOperation, type BackupOperation } from '@/features/backup/backupHistory'

const emit = defineEmits<{ restored: [] }>()
const backupText = ref('')
const importText = ref('')
const preview = ref<LearningBackup>()
const error = ref('')
const message = ref('')
const savedPath = ref('')
const busy = ref(false)
const history = ref(readBackupHistory(uniStorage))
const historyLabels = computed(() => ([
  ['savedAt', '上次文件保存并校验'], ['copiedAt', '上次成功复制'], ['downloadRequestedAt', '上次发起下载（保存结果请查看下载列表）']
] as const).flatMap(([key, label]) => {
  const timestamp = history.value[key]
  return timestamp === undefined ? [] : [`${label}：${formatTime(timestamp)}`]
}))
const counts = computed(() => preview.value ? describeLearningBackup(preview.value) : undefined)
const filename = () => `pianke-learning-${formatTime(Date.now()).slice(0, 10)}.json`

function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  const pad = (number: number) => String(number).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function remember(operation: BackupOperation): void {
  if (recordBackupOperation(uniStorage, operation)) history.value = readBackupHistory(uniStorage)
  else message.value += '；操作时间未能保存，请自行保管备份'
}

function safeError(reason: unknown): string {
  return reason instanceof Error ? reason.message : '操作失败，请稍后重试'
}

function generateBackup(): void {
  error.value = ''
  message.value = ''
  backupText.value = ''
  savedPath.value = ''
  try {
    backupText.value = exportLearningBackup(uniStorage)
    message.value = '备份文本已生成，尚未保存或复制'
  } catch (reason) { error.value = safeError(reason) }
}

function copyBackup(): void {
  if (busy.value) return
  generateBackup()
  if (!backupText.value) return
  busy.value = true
  let settled = false
  try {
    uni.setClipboardData({ data: backupText.value, success: () => {
      if (settled) return
      settled = true
      busy.value = false
      message.value = '备份已复制到剪贴板，尚未保存为文件，请转存到自己的文件或其他设备'
      remember('copiedAt')
    }, fail: () => {
      if (settled) return
      settled = true
      busy.value = false
      error.value = '复制失败，请重试或手动复制下方备份文本'
    } })
  } catch {
    settled = true
    busy.value = false
    error.value = '复制失败，请重试或手动复制下方备份文本'
  }
}

async function saveBackup(): Promise<void> {
  if (busy.value) return
  generateBackup()
  if (!backupText.value) return
  busy.value = true
  savedPath.value = ''
  try {
    // #ifdef H5
    if (typeof plus === 'undefined') {
    const blob = new Blob([backupText.value], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename()
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    message.value = '已发起备份下载，请在浏览器下载列表确认文件已保存；本页无法确认下载结果'
    remember('downloadRequestedAt')
    }
    // #endif
    // #ifdef APP-PLUS
    if (typeof plus !== 'undefined') {
      const path = await saveNativeBackup(backupText.value, filename())
      savedPath.value = path
      message.value = '备份文件已保存并校验内容。文件仍在本机，建议再转存到其他设备'
      remember('savedAt')
    }
    // #endif
  } catch { error.value = '文件保存失败，可以使用“复制备份”保存完整文本' }
  finally { busy.value = false }
}

// #ifdef APP-PLUS
function saveNativeBackup(text: string, name: string): Promise<string> {
  return new Promise((resolve, reject) => {
    plus.io.requestFileSystem(plus.io.PRIVATE_DOC, (filesystem) => {
      filesystem.root!.getDirectory('learning-backups', { create: true }, (directory) => {
        // Unique filename avoids leaving a tail when replacing a larger file.
        directory.getFile(`${Date.now()}-${name}`, { create: true }, (file) => {
          file.createWriter((writer) => {
            writer.onwrite = () => file.file((savedFile) => {
              const reader = new plus.io.FileReader()
              reader.onerror = reject
              reader.onloadend = () => {
                if (reader.result !== text) { reject(new Error('备份文件校验失败')); return }
                resolve(file.toLocalURL())
              }
              reader.readAsText(savedFile, 'utf-8')
            }, reject)
            writer.onerror = reject
            writer.write(text)
          }, reject)
        }, reject)
      }, reject)
    }, reject)
  })
}
// #endif

function chooseBackup(): void {
  error.value = ''
  preview.value = undefined
  // #ifdef H5
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.json,application/json'
  input.onchange = async () => {
    const file = input.files?.[0]
    if (!file) return
    if (file.size > MAX_BACKUP_CHARACTERS) { error.value = '备份过大，请选择小于 8 MB 的文件'; return }
    try { importText.value = await file.text(); inspectBackup() }
    catch { error.value = '文件无法读取，请重新选择或粘贴备份文本' }
  }
  input.click()
  // #endif
  // #ifdef APP-PLUS
  uni.getClipboardData({ success: ({ data }) => { importText.value = data; inspectBackup() }, fail: () => { error.value = '无法读取剪贴板，请在下方粘贴备份文本' } })
  // #endif
}

function inspectBackup(): void {
  error.value = ''
  message.value = ''
  preview.value = undefined
  try { preview.value = parseLearningBackup(importText.value) }
  catch (reason) { error.value = safeError(reason) }
}

function requestRestore(): void {
  if (!preview.value || busy.value) return
  const candidate = preview.value
  let settled = false
  uni.showModal({
    title: '恢复学习备份',
    content: '将替换本机的课程计划、学习状态和播放进度。视频来源和登录状态保持不变。是否继续？',
    confirmText: '确认恢复', cancelText: '取消',
    success: ({ confirm }) => {
      if (settled) return
      settled = true
      if (!confirm) return
      busy.value = true
      try {
        restoreLearningBackup(uniStorage, candidate)
        preview.value = undefined
        importText.value = ''
        message.value = '学习数据已恢复；换设备后请连接视频来源，缺失的视频可在课程中重新关联'
        emit('restored')
      } catch (reason) { error.value = safeError(reason) }
      finally { busy.value = false }
    }
  })
}
</script>

<template>
  <view class="backup-panel">
    <text class="backup-panel__hint">备份课程计划、学习状态和播放进度，不包含账号凭证、视频文件或媒体直链。换设备后需重新连接视频来源。</text>
    <view v-if="historyLabels.length" class="backup-panel__history" data-testid="backup-history"><text v-for="label in historyLabels" :key="label" class="backup-panel__hint">{{ label }}</text></view>
    <view class="backup-panel__actions">
      <button data-testid="backup-export" :disabled="busy" @click="saveBackup">导出备份文件</button>
      <button data-testid="backup-copy" :disabled="busy" @click="copyBackup">复制备份</button>
    </view>
    <text v-if="savedPath" class="backup-panel__path" selectable>{{ savedPath }}</text>
    <textarea v-if="backupText" :value="backupText" :maxlength="-1" class="backup-panel__text" aria-label="导出的备份文本" data-testid="backup-export-text" />
    <view class="backup-panel__actions">
      <!-- #ifdef H5 -->
      <button data-testid="backup-file" @click="chooseBackup">选择备份文件</button>
      <!-- #endif -->
      <!-- #ifdef APP-PLUS -->
      <button data-testid="backup-clipboard" @click="chooseBackup">读取剪贴板备份</button>
      <!-- #endif -->
    </view>
    <textarea v-model="importText" :maxlength="-1" class="backup-panel__text" placeholder="或在这里粘贴完整备份文本" aria-label="备份导入文本" data-testid="backup-import-text" @input="preview = undefined" />
    <button data-testid="backup-inspect" :disabled="!importText.trim() || busy" @click="inspectBackup">检查备份</button>
    <view v-if="counts" class="backup-panel__preview" data-testid="backup-preview">
      <text>{{ counts.courses }} 门课程 · {{ counts.playback }} 条观看记录 · {{ counts.learned }} 节已学完</text>
      <text>恢复会替换本机学习数据，建议先导出当前备份。</text>
      <button data-testid="backup-restore" :disabled="busy" @click="requestRestore">恢复这份备份</button>
    </view>
    <text v-if="error" class="backup-panel__error" role="alert">{{ error }}</text>
    <text v-if="message" class="backup-panel__hint" role="status">{{ message }}</text>
  </view>
</template>

<style scoped lang="scss">
@use '@/styles/tokens.scss' as *;
.backup-panel { padding: 18rpx 0; }
.backup-panel > * + * { margin-top: 16rpx; }
.backup-panel__hint, .backup-panel__path { display: block; font-size: 22rpx; line-height: 1.5; color: $color-muted; overflow-wrap: anywhere; }
.backup-panel__actions { display: flex; flex-wrap: wrap; }
.backup-panel button { box-sizing: border-box; display: flex; align-items: center; justify-content: center; text-align: center; min-height: 44px; min-width: 44px; max-width: 100%; white-space: normal; overflow-wrap: anywhere; margin: 8rpx 12rpx 8rpx 0; padding: 16rpx 20rpx; background: $color-primary-soft; color: $color-primary; border: 0; border-radius: 8px; font-size: 24rpx; line-height: 1.4; }
.backup-panel button[disabled] { opacity: .5; }
.backup-panel__text { box-sizing: border-box; width: 100%; height: 180rpx; padding: 16rpx; border: 1px solid $color-border; border-radius: 8px; background: $color-surface; color: $color-text; font-size: 22rpx; }
.backup-panel__preview { padding: 18rpx; border: 1px solid $color-border; border-radius: 10px; }
.backup-panel__preview > text { display: block; margin-bottom: 10rpx; font-size: 22rpx; line-height: 1.5; }
.backup-panel__error { display: block; color: #b23b2f; font-size: 22rpx; line-height: 1.5; }
</style>
