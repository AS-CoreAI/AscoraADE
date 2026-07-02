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

  ipcMain.handle(IPC.dialog.openFiles, async (e): Promise<string[] | null> => {
    const win = BrowserWindow.fromWebContents(e.sender) ?? undefined
    const result = await dialog.showOpenDialog(win!, {
      title: 'Attach files',
      properties: ['openFile', 'multiSelections', 'showHiddenFiles'],
      filters: [
        {
          name: 'Files and images',
          extensions: [
            'png',
            'jpg',
            'jpeg',
            'gif',
            'webp',
            'svg',
            'bmp',
            'txt',
            'md',
            'json',
            'csv',
            'pdf',
            '*'
          ]
        }
      ]
    })
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths
  })
}
