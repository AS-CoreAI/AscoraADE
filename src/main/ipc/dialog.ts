import { ipcMain, dialog, BrowserWindow } from 'electron'
import { basename } from 'node:path'
import { IPC, type Workspace } from '@shared/ipc'
import { getStore } from '../store'

export function registerDialogHandlers(): void {
  ipcMain.handle(IPC.dialog.openFolder, async (e): Promise<Workspace | null> => {
    const win = BrowserWindow.fromWebContents(e.sender) ?? undefined
    const result = await dialog.showOpenDialog(win!, {
      title: 'Open project folder',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const dir = result.filePaths[0]
    // Persist as a workspace so it shows up in the Workspaces rail.
    return getStore().addWorkspace(basename(dir), dir)
  })
}
