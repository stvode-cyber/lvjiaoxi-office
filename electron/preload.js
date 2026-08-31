// 绿角犀 Office · Electron 预加载脚本
// 在隔离上下文中向渲染进程暴露最小能力：调用主进程 IPC、打开外部链接、订阅主进程推送事件。
const { contextBridge, ipcRenderer } = require("electron");

// 维护监听器映射，保证 removeListener 能精确移除（否则每次 on 都生成新包装函数导致无法移除）
const listeners = new Map();

contextBridge.exposeInMainWorld("electronAPI", {
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  openExternal: (url) => ipcRenderer.send("shell:open-external", url),
  // 订阅主进程主动推送（如 updater:available / updater:progress / updater:downloaded / updater:error）
  on: (channel, cb) => {
    const wrapped = (e, ...args) => cb(...args);
    listeners.set(cb, wrapped);
    ipcRenderer.on(channel, wrapped);
  },
  removeListener: (channel, cb) => {
    const wrapped = listeners.get(cb);
    if (wrapped) { ipcRenderer.removeListener(channel, wrapped); listeners.delete(cb); }
  }
});
