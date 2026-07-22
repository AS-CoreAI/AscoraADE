import { ipcMain } from 'electron'
import { spawn, spawnSync } from 'node:child_process'
import { accessSync, constants } from 'node:fs'
import { getuid } from 'node:process'
import {
  DEVELOPER_TOOL_IDS,
  IPC,
  type DeveloperToolId,
  type DeveloperToolsInfo,
  type DeveloperToolsInstallResult,
  type DeveloperToolsManager
} from '@shared/ipc'

interface ManagerChoice {
  name: DeveloperToolsManager
  file: string
}

interface CommandResult {
  ok: boolean
  detail?: string
}

const TOOL_ID_SET = new Set<string>(DEVELOPER_TOOL_IDS)

const TOOL_PROBES: Record<DeveloperToolId, string[]> = {
  ripgrep: ['rg'],
  fd: ['fd', 'fdfind'],
  jq: ['jq'],
  sevenZip: ['7z', '7zz', '7za'],
  llvm: ['clang'],
  pandoc: ['pandoc'],
  libreOffice: ['soffice', 'libreoffice'],
  imageMagick: ['magick', 'convert'],
  qpdf: ['qpdf'],
  poppler: ['pdftotext'],
  graphviz: ['dot'],
  tesseract: ['tesseract']
}

const PACKAGES: Record<DeveloperToolsManager, Record<DeveloperToolId, string[]>> = {
  winget: {
    ripgrep: ['BurntSushi.ripgrep.MSVC'],
    fd: ['sharkdp.fd'],
    jq: ['jqlang.jq'],
    sevenZip: ['7zip.7zip'],
    llvm: ['LLVM.LLVM'],
    pandoc: ['JohnMacFarlane.Pandoc'],
    libreOffice: ['TheDocumentFoundation.LibreOffice'],
    imageMagick: ['ImageMagick.ImageMagick'],
    qpdf: ['QPDF.QPDF'],
    poppler: ['oschwartz10612.Poppler'],
    graphviz: ['Graphviz.Graphviz'],
    tesseract: ['UB-Mannheim.TesseractOCR']
  },
  brew: {
    ripgrep: ['ripgrep'],
    fd: ['fd'],
    jq: ['jq'],
    sevenZip: ['sevenzip'],
    llvm: ['llvm'],
    pandoc: ['pandoc'],
    libreOffice: ['libreoffice'],
    imageMagick: ['imagemagick'],
    qpdf: ['qpdf'],
    poppler: ['poppler'],
    graphviz: ['graphviz'],
    tesseract: ['tesseract']
  },
  apt: {
    ripgrep: ['ripgrep'],
    fd: ['fd-find'],
    jq: ['jq'],
    sevenZip: ['p7zip-full'],
    llvm: ['clang'],
    pandoc: ['pandoc'],
    libreOffice: ['libreoffice'],
    imageMagick: ['imagemagick'],
    qpdf: ['qpdf'],
    poppler: ['poppler-utils'],
    graphviz: ['graphviz'],
    tesseract: ['tesseract-ocr']
  },
  dnf: {
    ripgrep: ['ripgrep'],
    fd: ['fd-find'],
    jq: ['jq'],
    sevenZip: ['p7zip', 'p7zip-plugins'],
    llvm: ['clang'],
    pandoc: ['pandoc'],
    libreOffice: ['libreoffice'],
    imageMagick: ['ImageMagick'],
    qpdf: ['qpdf'],
    poppler: ['poppler-utils'],
    graphviz: ['graphviz'],
    tesseract: ['tesseract']
  },
  pacman: {
    ripgrep: ['ripgrep'],
    fd: ['fd'],
    jq: ['jq'],
    sevenZip: ['7zip'],
    llvm: ['clang'],
    pandoc: ['pandoc-cli'],
    libreOffice: ['libreoffice-fresh'],
    imageMagick: ['imagemagick'],
    qpdf: ['qpdf'],
    poppler: ['poppler'],
    graphviz: ['graphviz'],
    tesseract: ['tesseract']
  }
}

function commandWorks(file: string): boolean {
  const result = spawnSync(file, ['--version'], {
    encoding: 'utf8',
    timeout: 2_000,
    windowsHide: true
  })
  return !result.error && result.status === 0
}

function commandOutput(file: string, args: string[]): string {
  const result = spawnSync(file, args, {
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
    timeout: 15_000,
    windowsHide: true
  })
  if (result.error || result.status !== 0) return ''
  return `${result.stdout || ''}\n${result.stderr || ''}`.toLowerCase()
}

function executableFile(candidates: string[]): string | undefined {
  for (const candidate of candidates) {
    if (candidate.includes('/') || candidate.includes('\\')) {
      try {
        accessSync(candidate, constants.X_OK)
        return candidate
      } catch {
        continue
      }
    }
    if (commandWorks(candidate)) return candidate
  }
  return undefined
}

function managerChoice(): ManagerChoice | undefined {
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA
    const winget = executableFile([
      'winget',
      ...(localAppData ? [`${localAppData}\\Microsoft\\WindowsApps\\winget.exe`] : [])
    ])
    return winget ? { name: 'winget', file: winget } : undefined
  }

  if (process.platform === 'darwin') {
    const brew = executableFile(['/opt/homebrew/bin/brew', '/usr/local/bin/brew', 'brew'])
    return brew ? { name: 'brew', file: brew } : undefined
  }

  if (process.platform === 'linux') {
    for (const [name, file] of [
      ['apt', 'apt-get'],
      ['dnf', 'dnf'],
      ['pacman', 'pacman']
    ] as const) {
      if (commandWorks(file)) return { name, file }
    }
  }
  return undefined
}

function installedPackages(manager?: ManagerChoice): string {
  if (!manager) return ''
  if (manager.name === 'winget') {
    return commandOutput(manager.file, ['list', '--disable-interactivity'])
  }
  if (manager.name === 'brew') {
    return `${commandOutput(manager.file, ['list', '--formula'])}\n${commandOutput(manager.file, ['list', '--cask'])}`
  }
  if (manager.name === 'apt') {
    return commandOutput('dpkg-query', ['-W', '-f=${binary:Package}\n'])
  }
  if (manager.name === 'dnf') {
    return commandOutput('rpm', ['-qa', '--qf', '%{NAME}\n'])
  }
  return commandOutput(manager.file, ['-Qq'])
}

function packageIsListed(packageList: string, name: string): boolean {
  const expected = name.toLowerCase()
  return packageList.split(/\r?\n/).some((line) =>
    line.trim().split(/\s+/).some((token) => token === expected || token.startsWith(`${expected}:`))
  )
}

function inspectTools(): DeveloperToolsInfo {
  const manager = managerChoice()
  const packageList = installedPackages(manager)
  return {
    platform: process.platform,
    manager: manager?.name,
    available: !!manager,
    tools: DEVELOPER_TOOL_IDS.map((id) => ({
      id,
      installed:
        TOOL_PROBES[id].some(commandWorks) ||
        !!manager && PACKAGES[manager.name][id].some((name) => packageIsListed(packageList, name))
    })),
    error: manager ? undefined : 'No supported package manager was found.'
  }
}

function runCommand(file: string, args: string[]): Promise<CommandResult> {
  return new Promise((resolve) => {
    let settled = false
    let detail = ''
    let child
    try {
      child = spawn(file, args, {
        windowsHide: true,
        env: { ...process.env }
      })
    } catch (error) {
      resolve({ ok: false, detail: error instanceof Error ? error.message : String(error) })
      return
    }

    const append = (chunk: Buffer | string): void => {
      detail = `${detail}${String(chunk)}`.slice(-16_000)
    }
    child.stdout?.on('data', append)
    child.stderr?.on('data', append)
    child.once('error', (error) => {
      if (settled) return
      settled = true
      resolve({ ok: false, detail: error.message })
    })
    child.once('close', (code) => {
      if (settled) return
      settled = true
      resolve({ ok: code === 0, detail: code === 0 ? undefined : detail.trim() })
    })
  })
}

function installCommand(manager: ManagerChoice, args: string[]): Promise<CommandResult> {
  if (process.platform !== 'linux' || getuid?.() === 0) {
    return runCommand(manager.file, args)
  }
  return runCommand('pkexec', [manager.file, ...args])
}

async function installTools(requested: unknown): Promise<DeveloperToolsInstallResult> {
  const ids = Array.isArray(requested)
    ? [...new Set(requested.filter((id): id is DeveloperToolId => typeof id === 'string' && TOOL_ID_SET.has(id)))]
    : []
  if (ids.length === 0) {
    return { ok: false, installed: [], failed: [], error: 'No valid tools were selected.' }
  }

  const manager = managerChoice()
  if (!manager) {
    return {
      ok: false,
      installed: [],
      failed: ids,
      error: 'No supported package manager was found.'
    }
  }

  const installed: DeveloperToolId[] = []
  const failed: DeveloperToolId[] = []
  let lastError: string | undefined

  if (manager.name === 'winget') {
    for (const id of ids) {
      const result = await runCommand(manager.file, [
        'install',
        '--id',
        PACKAGES.winget[id][0],
        '-e',
        '--accept-package-agreements',
        '--accept-source-agreements'
      ])
      ;(result.ok ? installed : failed).push(id)
      if (!result.ok) lastError = result.detail
    }
  } else if (manager.name === 'brew') {
    const formulaIds = ids.filter((id) => id !== 'libreOffice')
    if (formulaIds.length > 0) {
      const result = await runCommand(manager.file, [
        'install',
        ...formulaIds.flatMap((id) => PACKAGES.brew[id])
      ])
      ;(result.ok ? installed : failed).push(...formulaIds)
      if (!result.ok) lastError = result.detail
    }
    if (ids.includes('libreOffice')) {
      const result = await runCommand(manager.file, ['install', '--cask', 'libreoffice'])
      ;(result.ok ? installed : failed).push('libreOffice')
      if (!result.ok) lastError = result.detail
    }
  } else {
    const packages = ids.flatMap((id) => PACKAGES[manager.name][id])
    const args = manager.name === 'pacman'
      ? ['-S', '--needed', '--noconfirm', ...packages]
      : ['install', '-y', ...packages]
    const result = await installCommand(manager, args)
    ;(result.ok ? installed : failed).push(...ids)
    if (!result.ok) lastError = result.detail
  }

  return {
    ok: failed.length === 0,
    installed,
    failed,
    error: failed.length > 0 ? lastError || 'One or more packages could not be installed.' : undefined
  }
}

export function registerDeveloperToolsHandlers(): void {
  ipcMain.handle(IPC.developerTools.inspect, () => inspectTools())
  ipcMain.handle(IPC.developerTools.install, (_event, ids: unknown) => installTools(ids))
}
