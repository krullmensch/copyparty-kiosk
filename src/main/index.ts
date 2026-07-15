import { app, shell, BrowserWindow, ipcMain } from 'electron'

app.commandLine.appendSwitch('force-device-scale-factor', '1.4')
// Exposes HTMLMediaElement.audioTracks so the video.js player can list and
// switch the embedded audio languages of a DVD rip (off by default in Chromium).
app.commandLine.appendSwitch('enable-experimental-web-platform-features')
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { registerDrivesIpc } from './ipc/drives'
import { registerFsIpc } from './ipc/fs'
import { registerCppIpc } from './ipc/copyparty'
import { registerAgoraIpc } from './ipc/agora'
import { registerMetadataIpc } from './ipc/metadata'
import { registerAppIconIpc } from './ipc/appicon'
import { registerCdBurnIpc } from './ipc/cdburn'
import { registerDvdRipIpc } from './ipc/dvdrip'
import { registerStreamProtocolHandler, registerStreamProtocolSchemes } from './stream-protocol'
import { getMediaBase, startMediaServer } from './media-server'

// MUST run before app 'ready': privileged scheme registration.
registerStreamProtocolSchemes()

// Renderer reads the media server base synchronously at preload time so
// streamUrl() can build URLs without an async round-trip.
ipcMain.on('get-media-base', (e) => {
  e.returnValue = getMediaBase()
})

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1920,
    height: 1080,
    fullscreen: true,
    frame: false,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#000000',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  registerDrivesIpc(mainWindow)
  registerFsIpc()
  registerCppIpc(mainWindow)
  registerAgoraIpc()
  registerMetadataIpc()
  registerAppIconIpc()
  registerCdBurnIpc(mainWindow)
  registerDvdRipIpc(mainWindow)
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.electron')

  registerStreamProtocolHandler()
  // Start the loopback media server before the window loads so getMediaBase()
  // has a real port when the preload reads it.
  await startMediaServer()

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  ipcMain.on('ping', () => console.log('pong'))

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
