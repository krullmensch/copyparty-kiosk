import { app, shell, BrowserWindow, ipcMain, globalShortcut } from 'electron'

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
import { registerShareIpc } from './ipc/share'
import { registerAgoraIpc } from './ipc/agora'
import { registerConfigIpc } from './ipc/config'
import { registerMetadataIpc } from './ipc/metadata'
import { registerAppIconIpc } from './ipc/appicon'
import { registerCdBurnIpc } from './ipc/cdburn'
import { registerDvdVideoBurnIpc } from './ipc/dvdburn'
import { registerDvdRipIpc } from './ipc/dvdrip'
import { registerCdRipIpc } from './ipc/cdrip'
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
    // Kiosk hardening: only ever hand http(s) links to the OS. A file:// URL
    // (e.g. from an embedded viewer) would open a file manager and expose the
    // bare kiosk filesystem to a public visitor.
    let scheme = ''
    try {
      scheme = new URL(details.url).protocol
    } catch {
      scheme = ''
    }
    if (scheme === 'http:' || scheme === 'https:') {
      shell.openExternal(details.url)
    }
    return { action: 'deny' }
  })

  // Kiosk hardening: kill the native context menu everywhere (including inside
  // the OnlyOffice iframe). Otherwise "Save image as…" / "Open link" open a
  // native file chooser that lets a visitor browse the kiosk filesystem.
  mainWindow.webContents.on('context-menu', (e) => e.preventDefault())

  // Kiosk hardening: the top frame must never navigate away from the app
  // (blocks file:// / external navigation triggered from embedded content).
  mainWindow.webContents.on('will-navigate', (e, url) => {
    const current = mainWindow.webContents.getURL()
    if (url !== current) e.preventDefault()
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  registerDrivesIpc(mainWindow)
  registerFsIpc()
  registerCppIpc(mainWindow)
  registerShareIpc()
  registerAgoraIpc()
  registerConfigIpc()
  registerMetadataIpc()
  registerAppIconIpc()
  registerCdBurnIpc(mainWindow)
  registerDvdVideoBurnIpc(mainWindow)
  registerDvdRipIpc(mainWindow)
  registerCdRipIpc(mainWindow)
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

  // Kiosk hardening: block Alt+F4 to prevent closing the app
  globalShortcut.register('Alt+F4', () => {
    // do nothing
  })

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
