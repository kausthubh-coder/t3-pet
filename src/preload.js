const { contextBridge, ipcRenderer } = require('electron');

const CHANNELS = ['display', 'cursor', 'status', 'paused', 'command'];

contextBridge.exposeInMainWorld('petAPI', {
  on(channel, cb) {
    if (!CHANNELS.includes(channel)) return;
    ipcRenderer.on(channel, (_e, data) => cb(data));
  },
  setClickable: (on) => ipcRenderer.send('clickable', !!on),
  setAsleep: (asleep) => ipcRenderer.send('asleep', !!asleep),
  ready: () => ipcRenderer.send('ready'),
});
