import { ipcMain, app } from 'electron'
import { IpcChannels, type PreviewSource } from '../../shared/types'

export function registerAppIconIpc(): void {
  ipcMain.handle(
    IpcChannels.PreviewIcon,
    async (_, source: PreviewSource): Promise<string | null> => {
      if (source.kind === 'remote') {
        return null
      }

      try {
        const icon = await app.getFileIcon(source.path, { size: 'large' })
        return icon.toDataURL()
      } catch {
        return null
      }
    }
  )
}
