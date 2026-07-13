import { ipcMain, nativeImage, shell } from 'electron'
import { constants as fsConstants } from 'node:fs'
import { copyFile, mkdir, readdir, readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { join, basename, dirname, extname, isAbsolute, relative, resolve } from 'node:path'
import {
  IPC,
  EXCLUDED_DIRS,
  type TreeNode,
  type FileActionResult,
  type FileContent,
  type AttachmentFile,
  type AttachmentImportResult
} from '@shared/ipc'

/** Max file size we'll read into the editor (2 MB) before flagging as truncated. */
const MAX_FILE_BYTES = 2 * 1024 * 1024
const ATTACHMENTS_DIR = '.ascora-attachments'
const ATTACHMENT_PREVIEW_SIZE = 96
const MAX_ATTACHMENT_PREVIEW_BYTES = 20 * 1024 * 1024
const MAX_ATTACHMENT_PREVIEW_PIXELS = 20_000_000
const MAX_ATTACHMENT_PREVIEW_DIMENSION = 12_000
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.ico', '.avif'])
const PORTABLE_PREVIEW_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg'])
const JPEG_SIZE_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])

/**
 * Read one directory level into TreeNodes, excluding ignored dirs (spec 5.1).
 * Directories are listed before files; both alphabetical. Children of
 * directories are loaded lazily by the renderer on expand.
 */
async function readDir(dir: string): Promise<TreeNode[]> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const nodes: TreeNode[] = []
  for (const entry of entries) {
    const isDir = entry.isDirectory()
    if (isDir && EXCLUDED_DIRS.has(entry.name)) continue
    if (entry.name.startsWith('.') && EXCLUDED_DIRS.has(entry.name)) continue
    nodes.push({
      name: entry.name,
      path: join(dir, entry.name),
      type: isDir ? 'directory' : 'file',
      ...(isDir ? { children: undefined } : {})
    })
  }
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  return nodes
}

const LANG_BY_EXT: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.json': 'json',
  '.html': 'html',
  '.htm': 'html',
  '.css': 'css',
  '.scss': 'scss',
  '.less': 'less',
  '.md': 'markdown',
  '.py': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.cs': 'csharp',
  '.php': 'php',
  '.rb': 'ruby',
  '.sh': 'shell',
  '.yml': 'yaml',
  '.yaml': 'yaml',
  '.xml': 'xml',
  '.sql': 'sql',
  '.toml': 'ini',
  '.ini': 'ini'
}

function languageFor(filePath: string): string {
  return LANG_BY_EXT[extname(filePath).toLowerCase()] ?? 'plaintext'
}

function safeEntryName(name: string): string | null {
  const trimmed = name.trim()
  if (
    !trimmed ||
    trimmed === '.' ||
    trimmed === '..' ||
    trimmed !== basename(trimmed) ||
    trimmed.includes('/') ||
    trimmed.includes('\\') ||
    trimmed.includes('\0')
  ) {
    return null
  }
  return trimmed
}

function toWorkspacePath(path: string): string {
  return path.replace(/\\/g, '/')
}

function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child)
  return rel === '' || (!!rel && !rel.startsWith('..') && !isAbsolute(rel))
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function copyIntoAttachments(root: string, source: string, name: string): Promise<string> {
  const dir = join(root, ATTACHMENTS_DIR)
  await mkdir(dir, { recursive: true })
  const safeName = safeEntryName(name) ?? 'attachment'
  const ext = extname(safeName)
  const stem = ext ? safeName.slice(0, -ext.length) : safeName
  for (let i = 1; ; i += 1) {
    const target = join(dir, i === 1 ? safeName : `${stem}-${i}${ext}`)
    try {
      await copyFile(source, target, fsConstants.COPYFILE_EXCL)
      return target
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
    }
  }
}

function encodedImageDimensions(buffer: Buffer, extension: string): { width: number; height: number } | null {
  if (
    extension === '.png' &&
    buffer.length >= 24 &&
    buffer[0] === 0x89 &&
    buffer.subarray(1, 4).toString('ascii') === 'PNG'
  ) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
  }
  if ((extension === '.jpg' || extension === '.jpeg') && buffer.length >= 10 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2
    while (offset + 8 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset += 1
        continue
      }
      while (offset < buffer.length && buffer[offset] === 0xff) offset += 1
      if (offset >= buffer.length) break
      const marker = buffer[offset]
      offset += 1
      if (marker === 0xd9 || marker === 0xda) break
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue
      if (offset + 1 >= buffer.length) break
      const segmentLength = buffer.readUInt16BE(offset)
      if (segmentLength < 2 || offset + segmentLength > buffer.length) break
      if (JPEG_SIZE_MARKERS.has(marker) && segmentLength >= 7) {
        return {
          width: buffer.readUInt16BE(offset + 5),
          height: buffer.readUInt16BE(offset + 3)
        }
      }
      offset += segmentLength
    }
  }
  return null
}

async function hasSafePortableImageDimensions(filePath: string, extension: string): Promise<boolean> {
  if (!PORTABLE_PREVIEW_EXTENSIONS.has(extension)) return false
  const dimensions = encodedImageDimensions(await readFile(filePath), extension)
  if (!dimensions || dimensions.width < 1 || dimensions.height < 1) return false
  return (
    dimensions.width <= MAX_ATTACHMENT_PREVIEW_DIMENSION &&
    dimensions.height <= MAX_ATTACHMENT_PREVIEW_DIMENSION &&
    dimensions.width * dimensions.height <= MAX_ATTACHMENT_PREVIEW_PIXELS
  )
}

async function attachmentPreviewDataUrl(filePath: string, fileSize: number): Promise<string | undefined> {
  const extension = extname(filePath).toLowerCase()
  if (fileSize > MAX_ATTACHMENT_PREVIEW_BYTES || !IMAGE_EXTENSIONS.has(extension)) {
    return undefined
  }
  try {
    if (process.platform === 'win32' || process.platform === 'darwin') {
      const thumbnail = await nativeImage.createThumbnailFromPath(filePath, {
        width: ATTACHMENT_PREVIEW_SIZE,
        height: ATTACHMENT_PREVIEW_SIZE
      })
      return thumbnail.isEmpty() ? undefined : thumbnail.toDataURL()
    }
    if (!(await hasSafePortableImageDimensions(filePath, extension))) return undefined
    const image = nativeImage.createFromPath(filePath)
    if (image.isEmpty()) return undefined
    const { width, height } = image.getSize()
    if (width < 1 || height < 1) return undefined
    const scale = Math.min(1, ATTACHMENT_PREVIEW_SIZE / Math.max(width, height))
    const thumbnail = scale < 1
      ? image.resize({
          width: Math.max(1, Math.round(width * scale)),
          height: Math.max(1, Math.round(height * scale)),
          quality: 'good'
        })
      : image
    return thumbnail.toDataURL()
  } catch {
    // Unsupported or corrupt images remain usable as ordinary file attachments.
    return undefined
  }
}

async function attachmentFile(
  root: string,
  filePath: string,
  fileSize: number,
  sourcePath: string
): Promise<AttachmentFile> {
  const previewDataUrl = await attachmentPreviewDataUrl(filePath, fileSize)
  return {
    name: basename(filePath),
    sourcePath,
    path: toWorkspacePath(relative(root, filePath)),
    absolutePath: filePath,
    ...(previewDataUrl ? { previewDataUrl } : {})
  }
}

export function registerFsHandlers(): void {
  ipcMain.handle(IPC.fs.readTree, async (_e, dir: string): Promise<TreeNode[]> => {
    return readDir(dir)
  })

  ipcMain.handle(IPC.fs.readFile, async (_e, filePath: string): Promise<FileContent> => {
    const info = await stat(filePath)
    if (info.size > MAX_FILE_BYTES) {
      return {
        path: filePath,
        content: `// ${basename(filePath)} is ${(info.size / 1024 / 1024).toFixed(1)} MB — too large to display.`,
        language: 'plaintext',
        truncated: true
      }
    }
    const buf = await readFile(filePath)
    // Heuristic binary check: a NUL byte in the first 8 KB.
    const sample = buf.subarray(0, 8192)
    const looksBinary = sample.includes(0)
    if (looksBinary) {
      return {
        path: filePath,
        content: `// ${basename(filePath)} appears to be a binary file.`,
        language: 'plaintext',
        truncated: true
      }
    }
    return {
      path: filePath,
      content: buf.toString('utf8'),
      language: languageFor(filePath),
      truncated: false
    }
  })

  ipcMain.handle(IPC.fs.openPath, async (_e, targetPath: string): Promise<string> => {
    const info = await stat(targetPath)
    if (info.isFile()) return shell.openPath(dirname(targetPath))
    if (!info.isDirectory()) return 'The selected path is not a file or directory.'
    return shell.openPath(targetPath)
  })

  ipcMain.handle(
    IPC.fs.importFiles,
    async (_e, rootPath: string, filePaths: string[]): Promise<AttachmentImportResult> => {
      try {
        const root = resolve(rootPath)
        const rootInfo = await stat(root)
        if (!rootInfo.isDirectory()) return { ok: false, error: 'The workspace root is not a directory.' }
        const files: AttachmentFile[] = []
        const seen = new Set<string>()

        for (const filePath of filePaths) {
          const source = resolve(filePath)
          if (seen.has(source)) continue
          seen.add(source)

          const info = await stat(source)
          if (!info.isFile()) return { ok: false, error: `${basename(source)} is not a file.` }

          if (isInside(root, source)) {
            files.push(await attachmentFile(root, source, info.size, source))
            continue
          }

          const target = await copyIntoAttachments(root, source, basename(source))
          files.push(await attachmentFile(root, target, info.size, source))
        }

        return { ok: true, files }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )

  ipcMain.handle(
    IPC.fs.movePath,
    async (_e, sourcePath: string, targetDirectoryPath: string): Promise<FileActionResult> => {
      try {
        const source = resolve(sourcePath)
        const targetDirectory = resolve(targetDirectoryPath)
        const sourceInfo = await stat(source)
        const targetInfo = await stat(targetDirectory)
        if (!sourceInfo.isFile() && !sourceInfo.isDirectory()) {
          return { ok: false, error: 'The selected path is not a file or directory.' }
        }
        if (!targetInfo.isDirectory()) return { ok: false, error: 'The target path is not a directory.' }
        if (sourceInfo.isDirectory() && isInside(source, targetDirectory)) {
          return { ok: false, error: 'Cannot move a folder into itself.' }
        }
        const nextPath = join(targetDirectory, basename(source))
        if (resolve(nextPath) === source) return { ok: true, path: nextPath }
        if (await pathExists(nextPath)) {
          return { ok: false, error: `${basename(nextPath)} already exists in the target folder.` }
        }
        await rename(source, nextPath)
        return { ok: true, path: nextPath }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )

  ipcMain.handle(
    IPC.fs.renameFile,
    async (_e, filePath: string, newName: string): Promise<FileActionResult> => {
      try {
        const trimmed = safeEntryName(newName)
        if (!trimmed) return { ok: false, error: 'Invalid file name.' }
        const info = await stat(filePath)
        if (!info.isFile()) return { ok: false, error: 'The selected path is not a file.' }
        const nextPath = join(dirname(filePath), trimmed)
        if (nextPath !== filePath) await rename(filePath, nextPath)
        return { ok: true, path: nextPath }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )

  ipcMain.handle(IPC.fs.deleteFile, async (_e, filePath: string): Promise<FileActionResult> => {
    try {
      const info = await stat(filePath)
      if (!info.isFile()) return { ok: false, error: 'The selected path is not a file.' }
      await unlink(filePath)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(
    IPC.fs.createFile,
    async (_e, parentPath: string, name: string): Promise<FileActionResult> => {
      try {
        const safeName = safeEntryName(name)
        if (!safeName) return { ok: false, error: 'Invalid file name.' }
        const parent = await stat(parentPath)
        if (!parent.isDirectory()) return { ok: false, error: 'The parent path is not a directory.' }
        const nextPath = join(parentPath, safeName)
        // 'wx' fails if the file already exists, so we never clobber.
        await writeFile(nextPath, '', { flag: 'wx' })
        return { ok: true, path: nextPath }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )

  ipcMain.handle(
    IPC.fs.createDirectory,
    async (_e, parentPath: string, name: string): Promise<FileActionResult> => {
      try {
        const safeName = safeEntryName(name)
        if (!safeName) return { ok: false, error: 'Invalid folder name.' }
        const parent = await stat(parentPath)
        if (!parent.isDirectory()) return { ok: false, error: 'The parent path is not a directory.' }
        const nextPath = join(parentPath, safeName)
        await mkdir(nextPath)
        return { ok: true, path: nextPath }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )

  ipcMain.handle(
    IPC.fs.renameDirectory,
    async (_e, directoryPath: string, newName: string): Promise<FileActionResult> => {
      try {
        const safeName = safeEntryName(newName)
        if (!safeName) return { ok: false, error: 'Invalid folder name.' }
        const info = await stat(directoryPath)
        if (!info.isDirectory()) return { ok: false, error: 'The selected path is not a directory.' }
        const nextPath = join(dirname(directoryPath), safeName)
        if (nextPath !== directoryPath) await rename(directoryPath, nextPath)
        return { ok: true, path: nextPath }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )

  ipcMain.handle(
    IPC.fs.deleteDirectory,
    async (_e, directoryPath: string): Promise<FileActionResult> => {
      try {
        const info = await stat(directoryPath)
        if (!info.isDirectory()) return { ok: false, error: 'The selected path is not a directory.' }
        await rm(directoryPath, { recursive: true, force: false })
        return { ok: true }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )
}
