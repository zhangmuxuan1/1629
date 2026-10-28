const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('desktopNotifications', {
  openSettings: () => ipcRenderer.invoke('notification:open-settings')
})

contextBridge.exposeInMainWorld('desktopWindow', {
  minimize: () => ipcRenderer.invoke('window:action', 'minimize'),
  toggleMaximize: () => ipcRenderer.invoke('window:action', 'maximize'),
  focus: () => ipcRenderer.invoke('window:action', 'focus'),
  hide: () => ipcRenderer.invoke('window:action', 'hide'),
  quit: () => ipcRenderer.invoke('window:action', 'quit'),
  onCloseRequest: (callback) => {
    const listener = () => callback()
    ipcRenderer.on('window:request-close', listener)
    return () => ipcRenderer.removeListener('window:request-close', listener)
  }
})
