const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vfs', {
  list: (path) => ipcRenderer.invoke('vfs:list', { path }),
  readFile: (path, opts) => ipcRenderer.invoke('vfs:read', { path, opts }),
  writeFile: (path, data, meta) => ipcRenderer.invoke('vfs:write', { path, data, meta }),
  mkdir: (path) => ipcRenderer.invoke('vfs:mkdir', { path }),
  rename: (parent, oldName, newName) => ipcRenderer.invoke('vfs:rename', { parent, oldName, newName }),
  delete: (parent, name, opts) => ipcRenderer.invoke('vfs:delete', { parent, name, opts }),
  move: (srcParent, name, destParent) => ipcRenderer.invoke('vfs:move', { srcParent, name, destParent }),
  copy: (srcParent, name, destParent) => ipcRenderer.invoke('vfs:copy', { srcParent, name, destParent }),
  exists: (path) => ipcRenderer.invoke('vfs:exists', { path }),
  statType: (path) => ipcRenderer.invoke('vfs:statType', { path }),
  lookupById: (id) => ipcRenderer.invoke('vfs:lookupById', { id }),
});

contextBridge.exposeInMainWorld('net', {
  fetchJson: (url, options) => ipcRenderer.invoke('net:fetch', { url, options })
});

contextBridge.exposeInMainWorld('apps', {
  list: () => ipcRenderer.invoke('apps:list'),
  launch: (appId, args) => ipcRenderer.invoke('apps:launch', { appId, args })
});

contextBridge.exposeInMainWorld('inputAgent', {
  getScreenSize: () => ipcRenderer.invoke('input:getScreenSize'),
  move: (x, y) => ipcRenderer.invoke('input:move', { x, y }),
  click: (button = 'left') => ipcRenderer.invoke('input:click', { button }),
  down: (button = 'left') => ipcRenderer.invoke('input:down', { button }),
  up: (button = 'left') => ipcRenderer.invoke('input:up', { button }),
  scroll: (dx = 0, dy = 0) => ipcRenderer.invoke('input:scroll', { dx, dy }),
  keyTap: (key) => ipcRenderer.invoke('input:keyTap', { key }),
  keyDown: (key) => ipcRenderer.invoke('input:keyDown', { key }),
  keyUp: (key) => ipcRenderer.invoke('input:keyUp', { key }),
  typeText: (text) => ipcRenderer.invoke('input:typeText', { text })
});
