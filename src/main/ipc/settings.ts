import { ipcMain } from 'electron'
import { IPC, type Workspace, type TaskRecord, type TaskSummary } from '@shared/ipc'
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
  ipcMain.handle(IPC.workspace.rename, (_e, id: string, name: string): Workspace | null => {
    const value = name.trim()
    return value ? getStore().renameWorkspace(id, value) : null
  })
  ipcMain.handle(IPC.workspace.tasks, (_e, workspaceId: string, deletedOnly = false): TaskSummary[] =>
    getStore().listTasks(workspaceId, deletedOnly)
  )
  ipcMain.handle(IPC.workspace.task, (_e, taskId: string, includeDeleted = false): TaskRecord | null =>
    getStore().getTask(taskId, includeDeleted)
  )
  ipcMain.handle(IPC.workspace.saveTask, (_e, task: TaskRecord): TaskSummary =>
    getStore().saveTask(task)
  )
  ipcMain.handle(IPC.workspace.deleteTask, (_e, taskId: string): TaskSummary | null =>
    getStore().deleteTask(taskId)
  )
  ipcMain.handle(IPC.workspace.restoreTask, (_e, taskId: string): TaskSummary | null =>
    getStore().restoreTask(taskId)
  )
}
