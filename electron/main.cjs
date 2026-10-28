const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  nativeImage,
  screen,
  session,
  shell,
  ipcMain
} = require('electron')
const path = require('node:path')

const APP_ID = 'com.1629.todolist'
const startHidden = process.argv.includes('--hidden')
const hasSingleInstanceLock = app.requestSingleInstanceLock()
let mainWindow
let tray
let isQuitting = false

function isAppPage(url) {
  return url.startsWith('file://') || url.startsWith('http://127.0.0.1:1998/')
}

function setApplicationMenu() {
  const template = [
    {
      label: '文件',
      submenu: [
        {
          label: '关闭窗口',
          click: () => mainWindow?.webContents.send('window:request-close')
        },
        { type: 'separator' },
        { label: '退出应用', role: 'quit' }
      ]
    },
    {
      label: '查看',
      submenu: [
        { label: '重新加载', role: 'reload' },
        { label: '强制重新加载', role: 'forceReload' },
        { type: 'separator' },
        { label: '放大', role: 'zoomIn' },
        { label: '缩小', role: 'zoomOut' },
        { label: '恢复默认缩放', role: 'resetZoom' },
        { type: 'separator' },
        { label: '切换全屏', role: 'togglefullscreen' }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function showMainWindow() {
  if (!mainWindow) {
    createWindow(true)
    return
  }
  mainWindow.show()
  mainWindow.focus()
}

function createTray() {
  const icon = nativeImage.createFromPath(getIconPath('tray-icon.png'))
  if (icon.isEmpty()) {
    throw new Error(`Unable to load tray icon: ${getIconPath('tray-icon.png')}`)
  }
  tray = new Tray(icon)
  tray.setImage(icon)
  tray.setToolTip('1296Todolist')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开 1296Todolist', click: showMainWindow },
    { type: 'separator' },
    {
      label: '退出软件',
      click: () => {
        isQuitting = true
        app.quit()
      }
    }
  ]))
  tray.on('click', showMainWindow)
  tray.on('double-click', showMainWindow)
}

function getIconPath(filename) {
  return app.isPackaged
    ? path.join(process.resourcesPath, filename)
    : path.join(__dirname, '..', 'assets', filename)
}

function createWindow(show = !startHidden) {
  const { width: displayWidth } = screen.getPrimaryDisplay().workAreaSize
  const appIcon = nativeImage.createFromPath(getIconPath('app-icon.png'))
  if (appIcon.isEmpty()) {
    throw new Error(`Unable to load application icon: ${getIconPath('app-icon.png')}`)
  }

  mainWindow = new BrowserWindow({
    width: Math.max(800, Math.min(1900, Math.floor(displayWidth * 0.95))),
    height: 850,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    icon: appIcon,
    show,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWindow.on('close', () => {
    isQuitting = true
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  if (app.isPackaged) {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  } else {
    mainWindow.loadURL('http://127.0.0.1:1998')
  }
}

app.whenReady().then(() => {
  if (!hasSingleInstanceLock) return
  app.setAppUserModelId(APP_ID)
  if (process.platform === 'win32' && app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: true, args: ['--hidden'] })
  }
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(permission === 'notifications' && isAppPage(webContents.getURL()))
  })
  ipcMain.handle('notification:open-settings', (event) => {
    if (!isAppPage(event.senderFrame?.url || event.sender.getURL())) {
      throw new Error('Notification settings can only be opened by the desktop app.')
    }
    return shell.openExternal('ms-settings:notifications')
  })
  ipcMain.handle('window:action', (event, action) => {
    if (event.sender !== mainWindow?.webContents) {
      throw new Error('Window actions can only be requested by the desktop app.')
    }
    if (action === 'minimize') {
      mainWindow.minimize()
      return
    }
    if (action === 'maximize') {
      if (mainWindow.isMaximized()) mainWindow.unmaximize()
      else mainWindow.maximize()
      return
    }
    if (action === 'focus') {
      mainWindow.show()
      mainWindow.focus()
      return
    }
    if (action === 'hide') {
      mainWindow.hide()
      return
    }
    if (action === 'quit') {
      isQuitting = true
      app.quit()
      return
    }
    throw new Error(`Unsupported window action: ${action}`)
  })
  setApplicationMenu()
  createTray()
  createWindow()

  app.on('activate', () => {
    showMainWindow()
  })
})

app.on('second-instance', () => {
  if (hasSingleInstanceLock) showMainWindow()
})

if (!hasSingleInstanceLock) app.quit()

app.on('before-quit', () => {
  isQuitting = true
})

app.on('window-all-closed', () => {
  if (isQuitting) {
    if (tray) tray.destroy()
    app.quit()
  }
})
