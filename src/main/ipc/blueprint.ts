import { ipcMain } from 'electron'
import {
  IPC,
  type BlueprintDefinition,
  type BlueprintRunRequest,
  type BlueprintRunResult
} from '@shared/ipc'
import {
  listBlueprints,
  removeBlueprint,
  restoreBlueprintSchedules,
  saveBlueprint,
  startBlueprint,
  stopBlueprint
} from '../blueprint/runner'

export function registerBlueprintHandlers(): void {
  ipcMain.handle(IPC.blueprint.list, () => listBlueprints())
  ipcMain.handle(IPC.blueprint.save, (_event, blueprint: BlueprintDefinition) =>
    saveBlueprint(blueprint)
  )
  ipcMain.handle(IPC.blueprint.remove, (_event, id: string): boolean => removeBlueprint(id))
  ipcMain.handle(
    IPC.blueprint.run,
    (event, request: BlueprintRunRequest): BlueprintRunResult =>
      startBlueprint(request, event.sender)
  )
  ipcMain.handle(IPC.blueprint.stop, (_event, id: string): boolean => stopBlueprint(id))
  restoreBlueprintSchedules()
}
