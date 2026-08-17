const { contextBridge, ipcRenderer } = require('electron');

// Ponte mínima entre a interface e o processo principal do Electron.
// Só o necessário para o seletor de tela — nada de acesso amplo ao sistema.
contextBridge.exposeInMainWorld('falatorio', {
  isDesktop: true,
  defaultServer: process.env.FALATORIO_SERVER || '',
  getSources: () => ipcRenderer.invoke('falatorio:get-sources'),
  chooseSource: (id) => ipcRenderer.invoke('falatorio:choose-source', id),
});
