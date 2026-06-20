import { ipcMain } from 'electron'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join, basename, extname } from 'node:path'
import { IPC, EXCLUDED_DIRS, type TreeNode, type FileContent } from '@shared/ipc'

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
}
