const path = require('path');
const { app, BrowserWindow, session, desktopCapturer, ipcMain, shell } = require('electron');

// Endereço padrão do servidor que aparece na tela de entrada.
// Defina em tempo de build (FALATORIO_SERVER) ou deixe o usuário digitar.
const DEFAULT_SERVER = process.env.FALATORIO_SERVER || '';

/** Fonte escolhida no seletor do renderer, consumida pelo getDisplayMedia. */
let pendingSourceId = null;

function createWindow() {
  const win = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#16181d',
    title: 'Falatório',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Links externos abrem no navegador do sistema, não dentro do app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  return win;
}

app.whenReady().then(() => {
  // Microfone e tela: liberados, já que a origem é o próprio app.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(['media', 'display-capture', 'audioCapture', 'videoCapture'].includes(permission));
  });

  // navigator.mediaDevices.getDisplayMedia() cai aqui. Usamos a fonte que o
  // usuário escolheu no seletor da interface.
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
      const source = sources.find((s) => s.id === pendingSourceId) || sources[0];
      pendingSourceId = null;
      if (!source) return callback({});
      callback({ video: source });
    } catch (err) {
      console.error('display media', err);
      callback({});
    }
  }, { useSystemPicker: false });

  ipcMain.handle('falatorio:get-sources', async () => {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 320, height: 180 },
      fetchWindowIcons: false,
    });
    return sources.map((s) => ({
      id: s.id,
      name: s.name,
      thumbnail: s.thumbnail.toDataURL(),
    }));
  });

  ipcMain.handle('falatorio:choose-source', (_ev, id) => {
    pendingSourceId = id;
    return true;
  });

  ipcMain.handle('falatorio:default-server', () => DEFAULT_SERVER);

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
