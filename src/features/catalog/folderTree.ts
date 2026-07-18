import type { VideoFolder, VideoItem } from '@/domain/video'

const CONTROL_CHARACTER = /[\u0000-\u001F\u007F]/u
const COLLATION_OPTIONS: Intl.CollatorOptions = { numeric: true }

export function buildFolderTree(
  root: string,
  videos: readonly VideoItem[]
): VideoFolder {
  const rootNode = createFolder(finalSegment(root), root)

  if (!isSafeAbsolutePath(root)) {
    return rootNode
  }

  const nodes = new Map<string, VideoFolder>([[root, rootNode]])
  const seenSourceIds = new Set<string>()
  const rootPrefix = `${root}/`

  for (const video of videos) {
    if (
      video.sourceType !== 'baidu' ||
      typeof video.sourceId !== 'string' ||
      !video.sourceId.trim() ||
      !isAcceptedVideoPath(video.path, rootPrefix)
    ) {
      continue
    }

    if (seenSourceIds.has(video.sourceId)) {
      continue
    }
    seenSourceIds.add(video.sourceId)

    const relativeSegments = video.path.slice(rootPrefix.length).split('/')
    const folderSegments = relativeSegments.slice(0, -1)
    let parent = rootNode
    let currentPath = root

    for (const segment of folderSegments) {
      currentPath = `${currentPath}/${segment}`
      let node = nodes.get(currentPath)

      if (!node) {
        node = createFolder(segment, currentPath)
        nodes.set(currentPath, node)
        parent.folders.push(node)
      }

      parent = node
    }

    parent.videos.push({ ...video })
  }

  sortRecursively(rootNode)
  return rootNode
}

function createFolder(name: string, path: string): VideoFolder {
  return { name, path, folders: [], videos: [] }
}

function finalSegment(path: string): string {
  const separator = path.lastIndexOf('/')
  return separator >= 0 ? path.slice(separator + 1) : path
}

function isAcceptedVideoPath(path: string, rootPrefix: string): boolean {
  if (
    typeof path !== 'string' ||
    !path.startsWith(rootPrefix) ||
    !isSafeAbsolutePath(path)
  ) {
    return false
  }

  const relativePath = path.slice(rootPrefix.length)
  return Boolean(relativePath) && relativePath.split('/').every(Boolean)
}

function isSafeAbsolutePath(path: string): boolean {
  if (
    typeof path !== 'string' ||
    !path.startsWith('/') ||
    path === '/' ||
    CONTROL_CHARACTER.test(path) ||
    path.includes('\\') ||
    path.includes('?') ||
    path.includes('#') ||
    hasAmbiguousPercentEscape(path)
  ) {
    return false
  }

  return path
    .split('/')
    .slice(1)
    .every((segment) => Boolean(segment) && segment !== '.' && segment !== '..')
}

function hasAmbiguousPercentEscape(path: string): boolean {
  for (let index = 0; index < path.length; index += 1) {
    if (
      path[index] === '%' &&
      path[index + 1] !== undefined &&
      /[0-9A-F]/iu.test(path[index + 1]!)
    ) {
      return true
    }
  }

  return false
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, 'zh-CN', COLLATION_OPTIONS)
}

function compareVideos(left: VideoItem, right: VideoItem): number {
  return (
    compareText(left.name, right.name) ||
    compareText(left.path, right.path) ||
    compareText(left.sourceId, right.sourceId) ||
    compareText(left.id, right.id)
  )
}

function sortRecursively(folder: VideoFolder): void {
  folder.folders.sort(
    (left, right) =>
      compareText(left.name, right.name) || compareText(left.path, right.path)
  )
  folder.videos.sort(compareVideos)

  for (const child of folder.folders) {
    sortRecursively(child)
  }
}
