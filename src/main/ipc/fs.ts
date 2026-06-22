import { ipcMain, shell } from 'electron'
import { mkdir, readdir, readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { join, basename, dirname, extname } from 'node:path'
import {
  IPC,
  EXCLUDED_DIRS,
  type TreeNode,
  type FileActionResult,
  type FileContent
} from '@shared/ipc'

/** Max file size we'll read into the editor (2 MB) before flagging as truncated. */
const MAX_FILE_BYTES = 2 * 1024 * 1024

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
