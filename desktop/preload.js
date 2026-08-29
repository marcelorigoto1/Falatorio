const { contextBridge, ipcRenderer } = require('electron');

// Ponte mínima entre a interface e o processo principal do Electron.
// Só o necessário para o seletor de tela — nada de acesso amplo ao sistema.
contextBridge.exposeInMainWorld('falatorio', {
  isDesktop: true,
  defaultServer: process.env.FALATORIO_SERVER || '',
  getSources: () => ipcRenderer.invoke('falatorio:get-sources'),
  chooseSource: (id, comSom) => ipcRenderer.invoke('falatorio:choose-source', id, !!comSom),

  // Tela cheia pela janela (não pela API HTML): o processo principal garante
  // a saída no Esc e ao perder o foco, para não prender o Alt+Tab.
  setFullScreen: (ligar) => ipcRenderer.invoke('falatorio:set-fullscreen', !!ligar),
  isFullScreen: () => ipcRenderer.invoke('falatorio:is-fullscreen'),
  onFullScreen: (cb) => {
    ipcRenderer.removeAllListeners('falatorio:fullscreen');
    ipcRenderer.on('falatorio:fullscreen', (_ev, valor) => cb(!!valor));
  },
});
