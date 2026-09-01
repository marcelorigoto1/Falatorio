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

  // Som de um aplicativo só: o processo principal captura pelo Windows e
  // manda o áudio bruto para cá, onde ele vira uma faixa da chamada.
  appAudio: {
    status: () => ipcRenderer.invoke('falatorio:app-audio-status'),
    listar: () => ipcRenderer.invoke('falatorio:app-audio-list'),
    iniciar: (pid) => ipcRenderer.invoke('falatorio:app-audio-start', pid),
    parar: () => ipcRenderer.invoke('falatorio:app-audio-stop'),
    aoReceber: (cb) => {
      ipcRenderer.removeAllListeners('falatorio:app-audio-chunk');
      ipcRenderer.on('falatorio:app-audio-chunk', (_ev, chunk) => cb(chunk));
    },
  },
});
