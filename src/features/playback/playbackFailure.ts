import { BaiduError } from '@/features/baidu/baiduErrors'
import { PlaybackResolutionError } from './playbackResolver'

export type PlaybackFailureKind = 'network' | 'missing' | 'forbidden' | 'unsupported' | 'unknown'
export interface PlaybackFailure { kind: PlaybackFailureKind; message: string }

export function classifyPlaybackFailure(error: unknown, mediaMessage = ''): PlaybackFailure {
  // A URL path/query can contain misleading numbers and words; never classify from it.
  const message = mediaMessage.replace(/https?:\/\/\S+/giu, '')
  if ((error instanceof BaiduError && (error.kind === 'network' || error.kind === 'network-timeout')) || /network|offline|connection|timed?\s*out|网络|断网/iu.test(message)) {
    return { kind: 'network', message: '网络连接失败，请检查网络后重试' }
  }
  if ((error instanceof PlaybackResolutionError && error.code === 'not-found') || (error instanceof BaiduError && error.kind === 'http' && error.code === 404) || /(?:^|\s)(?:HTTP\s*)?404(?:\s|$)|file not found/iu.test(message)) {
    return { kind: 'missing', message: '找不到视频文件，可能已移动或删除，请检查来源或重新关联' }
  }
  if ((error instanceof BaiduError && error.kind === 'http' && (error.code === 401 || error.code === 403)) || /(?:^|\s)(?:HTTP\s*)?(?:401|403)(?:\s|$)|forbidden/iu.test(message)) {
    return { kind: 'forbidden', message: '播放地址拒绝访问，可能需要更新链接；请检查来源或重新关联' }
  }
  if (/unsupported(?:\s+(?:video|media))?\s+format|codec.*not supported/iu.test(message)) {
    return { kind: 'unsupported', message: '设备无法播放此视频格式' }
  }
  return { kind: 'unknown', message: '播放失败，暂时无法确定原因，请重试或检查视频来源' }
}
