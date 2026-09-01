const path = require('path');
const { app, BrowserWindow, session, desktopCapturer, ipcMain, shell } = require('electron');
const appAudio = require('./app-audio');

// Endereço padrão do servidor que aparece na tela de entrada.
// Defina em tempo de build (FALATORIO_SERVER) ou deixe o usuário digitar.
const DEFAULT_SERVER = process.env.FALATORIO_SERVER || '';

/** Escolhas feitas no diálogo da interface, consumidas pelo getDisplayMedia. */
let pendingSourceId = null;
let pendingWithAudio = false;

/** Liga/desliga a tela cheia da JANELA e avisa a interface. */
function definirTelaCheia(win, ligar) {
  if (!win || win.isDestroyed()) return false;
  if (win.isFullScreen() !== ligar) win.setFullScreen(ligar);
  if (!win.webContents.isDestroyed()) {
    win.webContents.send('falatorio:fullscreen', win.isFullScreen());
  }
  return win.isFullScreen();
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#16181d',
    title: 'Falatório',
    autoHideMenuBar: true,
    fullscreenable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // A música da sala começa a tocar sozinha quando alguém põe na fila;
      // sem isso o Chromium exigiria um clique dentro do quadro do player.
      autoplayPolicy: 'no-user-gesture-required',
    },
  });

  // A janela nunca fica por cima de tudo: em tela cheia, isso é o que faz o
  // Alt+Tab e o menu Iniciar parecerem "travados" no Windows.
  win.setAlwaysOnTop(false);

  // ── Saídas garantidas da tela cheia ───────────────────────
  // Três redes de segurança para a janela nunca ficar presa cobrindo o
  // sistema: Esc, perder o foco (Alt+Tab) e o fechamento pela própria janela.
  win.webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape' && win.isFullScreen()) {
      definirTelaCheia(win, false);
    }
  });

  win.on('blur', () => {
    if (win.isFullScreen()) definirTelaCheia(win, false);
  });

  win.on('enter-full-screen', () => win.webContents.send('falatorio:fullscreen', true));
  win.on('leave-full-screen', () => win.webContents.send('falatorio:fullscreen', false));

  // Se a página tentar a tela cheia por conta própria (API HTML), devolvemos
  // ao controle da janela, que é o caminho que sabemos desfazer.
  win.on('leave-html-full-screen', () => definirTelaCheia(win, false));

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
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
      const source = sources.find((s) => s.id === pendingSourceId) || sources[0];
      const querSom = pendingWithAudio;
      pendingSourceId = null;
      pendingWithAudio = false;
      if (!source) return callback({});

      // Som do que está tocando ("loopback"): é a mistura final da saída de
      // áudio, e o Chromium só sabe capturar isso no Windows. Não existe
      // captura por aplicativo — por isso a interface explica o que vai junto.
      const podeSom = querSom && request.audioRequested !== false && process.platform === 'win32';
      callback(podeSom ? { video: source, audio: 'loopback' } : { video: source });
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

  ipcMain.handle('falatorio:choose-source', (_ev, id, comSom) => {
    pendingSourceId = id;
    pendingWithAudio = !!comSom;
    return true;
  });

  ipcMain.handle('falatorio:default-server', () => DEFAULT_SERVER);

  // Tela cheia controlada pela janela, e não pela API HTML: assim o app
  // sempre sabe como sair, inclusive quando a transmissão acaba sozinha.
  ipcMain.handle('falatorio:set-fullscreen', (ev, ligar) =>
    definirTelaCheia(BrowserWindow.fromWebContents(ev.sender), !!ligar));

  ipcMain.handle('falatorio:is-fullscreen', (ev) => {
    const win = BrowserWindow.fromWebContents(ev.sender);
    return !!win && !win.isDestroyed() && win.isFullScreen();
  });

  // ── Som de um aplicativo só (Windows) ─────────────────────
  ipcMain.handle('falatorio:app-audio-status', () => ({
    disponivel: appAudio.disponivel(),
    motivo: appAudio.motivo(),
    formato: appAudio.FORMATO,
  }));

  ipcMain.handle('falatorio:app-audio-list', () => appAudio.listarAplicativos());

  ipcMain.handle('falatorio:app-audio-start', (ev, pid) => {
    const wc = ev.sender;
    return appAudio.iniciar(pid, (chunk) => {
      if (!wc.isDestroyed()) wc.send('falatorio:app-audio-chunk', chunk);
    });
  });

  ipcMain.handle('falatorio:app-audio-stop', () => { appAudio.parar(); return true; });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  appAudio.parar();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => appAudio.parar());
