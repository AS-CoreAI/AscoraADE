import { ipcMain } from 'electron'
import { IPC, type Workspace, type TaskSummary } from '@shared/ipc'
import { getStore } from '../store'
import { basename } from 'node:path'

export function registerSettingsHandlers(): void {
  ipcMain.handle(IPC.settings.get, (_e, key: string) => getStore().getSetting(key))
  ipcMain.handle(IPC.settings.set, (_e, key: string, value: unknown) => {
    getStore().setSetting(key, value)
  })
  ipcMain.handle(IPC.settings.all, () => getStore().allSettings())

  ipcMain.handle(IPC.workspace.list, (): Workspace[] => getStore().listWorkspaces())
  ipcMain.handle(IPC.workspace.add, (_e, path: string): Workspace =>
    getStore().addWorkspace(basename(path), path)
  )
  ipcMain.handle(IPC.workspace.tasks, (_e, workspaceId: string): TaskSummary[] =>
    getStore().listTasks(workspaceId)
  )
}
