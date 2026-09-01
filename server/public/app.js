/* Falatório — cliente (navegador e Electron).
 *
 * Voz e tela viajam P2P via WebRTC (malha: cada um conecta com cada um).
 * O servidor só faz sinalização e chat. Ideal até ~8 pessoas por sala.
 */
(() => {
  'use strict';

  // ── Configuração ─────────────────────────────────────────
  const ICE_SERVERS = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:global.stun.twilio.com:3478'] },
    // TURN público de cortesia (Open Relay). Troque pelo seu se quiser mais
    // estabilidade — veja o README.
    {
      urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443'],
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
  ];

  // Presets de qualidade do compartilhamento de tela.
  //  - contentHint 'detail' preserva nitidez de texto; 'motion' prioriza fluidez.
  const QUALITY = {
    leve: { label: 'Leve', width: 1280, height: 720, fps: 15, bitrate: 800e3, hint: 'detail' },
    media: { label: 'Equilibrada', width: 1920, height: 1080, fps: 30, bitrate: 2.5e6, hint: 'motion' },
    alta: { label: 'Alta', width: 1920, height: 1080, fps: 60, bitrate: 5e6, hint: 'motion' },
  };

  const desktop = window.falatorio || null; // ponte do Electron (preload.js)
  // ?debug=1 na URL liga os logs de sinalização no console.
  const DEBUG = /[?&]debug=1/.test(location.search);
  const log = (...a) => DEBUG && console.log('[falatorio]', ...a);
  const LS_NAME = 'falatorio.name';
  const LS_SERVER = 'falatorio.server';
  const LS_QUALITY = 'falatorio.quality';
  const LS_BUFFER = 'falatorio.buffer';
  const LS_SOM = 'falatorio.som';
  const LS_SAIDA = 'falatorio.saida';
  const LS_CHAT = 'falatorio.chat';
  const LS_FIORE = 'falatorio.fiore';
  const LS_CAM = 'falatorio.camera';
  const LS_MUSICA = 'falatorio.painelMusica';
  const LS_VOL_MUSICA = 'falatorio.volumeMusica';

  // ── Elementos ────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);
  const el = {
    gate: $('gate'), gateForm: $('gate-form'), gateError: $('gate-error'),
    nameInput: $('name-input'), serverInput: $('server-input'),
    serverHint: $('server-hint'), joinBtn: $('join-btn'),
    passwordRow: $('password-row'), passwordInput: $('password-input'),
    app: $('app'), main: $('main'), connDot: $('conn-dot'),
    channelBtn: $('channel-btn'), chatBadge: $('chat-badge'), chatChevron: $('chat-chevron'),
    peers: $('peers'), peerCount: $('peer-count'),
    micBtn: $('mic-btn'), micIcon: $('mic-icon'), micLabel: $('mic-label'),
    deafBtn: $('deaf-btn'), deafIcon: $('deaf-icon'), deafLabel: $('deaf-label'),
    shareBtn: $('share-btn'), shareLabel: $('share-label'), leaveBtn: $('leave-btn'),
    camBtn: $('cam-btn'), camLabel: $('cam-label'),
    camRow: $('cam-row'), camSelect: $('cam-select'),
    fioreBtn: $('fiore-btn'), fioreLabel: $('fiore-label'),
    quality: $('quality-select'), buffer: $('buffer-select'),
    outputRow: $('output-row'), output: $('output-select'), viewBar: $('view-bar'),
    grid: $('grid'), stageEmpty: $('stage-empty'),
    messages: $('messages'), chatForm: $('chat-form'), chatInput: $('chat-input'),
    audioSink: $('audio-sink'),
    musicBtn: $('music-btn'), musicBadge: $('music-badge'), musicChevron: $('music-chevron'),
    musicPanel: $('music-panel'), musicClose: $('music-close'), musicFrame: $('music-frame'),
    musicVazio: $('music-vazio'), musicNow: $('music-now'), musicTitle: $('music-title'),
    musicSub: $('music-sub'), musicFill: $('music-fill'), musicPlay: $('music-play'),
    musicNext: $('music-next'), musicTime: $('music-time'), musicVolume: $('music-volume'),
    musicForm: $('music-form'), musicInput: $('music-input'), musicResults: $('music-results'),
    musicQueue: $('music-queue'), musicCount: $('music-count'), musicClear: $('music-clear'),
    picker: $('picker'), pickerList: $('picker-list'), pickerCancel: $('picker-cancel'),
    pickerOk: $('picker-ok'), pickerTitle: $('picker-title'), pickerWarn: $('picker-warn'),
    soundNote: $('sound-note'), optApp: $('opt-app'), appSelect: $('app-select'),
  };

  // ── Estado ───────────────────────────────────────────────
  let socket = null;
  let myId = null;
  let myName = '';
  let micStream = null;      // MediaStream do microfone
  let screenStream = null;   // MediaStream da tela (quando compartilhando)
  let muted = false;
  let deafened = false;        // não escuto ninguém
  let mutedAntesDeSurdo = false;
  let sharing = false;
  let sharingAudio = false;    // estou enviando o som da minha tela
  let camStream = null;        // MediaStream da webcam (quando ligada)
  let camAtiva = false;        // estou enviando a minha câmera
  let camId = localStorage.getItem(LS_CAM) || '';  // qual câmera usar
  let quality = localStorage.getItem(LS_QUALITY) || 'media';
  let bufferMs = Number(localStorage.getItem(LS_BUFFER) ?? 500);
  let viewing = 'todos';       // 'todos' ou o id de quem eu quero assistir
  let maximizado = null;       // id da transmissão ocupando a tela toda
  let chatVisivel = localStorage.getItem(LS_CHAT) !== 'nao';
  let naoLidas = 0;

  /** peerId -> { name, muted, deafened, sharing, silenciado, pc, offerer, queue,
   *              makingOffer, ignoreOffer, videoTransceiver, videoStream,
   *              audioEl, watchdog } */
  const peers = new Map();

  const sendState = () => socket
    && socket.emit('state', { muted, deafened, sharing, sharingAudio, camera: camAtiva });

  // ── Utilidades ───────────────────────────────────────────
  const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const initials = (name) => name.trim().slice(0, 2).toUpperCase();

  function colorFor(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360;
    return `hsl(${h} 55% 45%)`;
  }

  const hhmm = (ts) => new Date(ts)
    .toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  // ── Tela de entrada ──────────────────────────────────────
  function defaultServer() {
    const saved = localStorage.getItem(LS_SERVER);
    if (saved) return saved;
    if (desktop && desktop.defaultServer) return desktop.defaultServer;
    if (location.protocol.startsWith('http')) return location.origin;
    return '';
  }

  el.nameInput.value = localStorage.getItem(LS_NAME) || '';
  el.serverInput.value = defaultServer();
  el.serverHint.textContent = desktop
    ? 'Endereço do servidor onde vocês se encontram (o mesmo para todos).'
    : 'Deixe como está para usar este mesmo servidor.';

  // Pergunta ao servidor se a sala tem senha, para mostrar o campo certo.
  async function checarSenhaNecessaria(url) {
    if (!url) return;
    try {
      const resp = await fetch(url.replace(/\/$/, '') + '/config', { cache: 'no-store' });
      const cfg = await resp.json();
      pedirSenha(!!cfg.precisaSenha);
    } catch { /* servidor fora do ar ou antigo: descobrimos ao entrar */ }
  }

  function pedirSenha(precisa) {
    el.passwordRow.hidden = !precisa;
  }

  checarSenhaNecessaria(el.serverInput.value.trim());
  el.serverInput.addEventListener('change', () => checarSenhaNecessaria(el.serverInput.value.trim()));

  el.gateForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    el.gateError.hidden = true;
    el.joinBtn.disabled = true;
    el.joinBtn.textContent = 'Conectando…';
    try {
      await join(
        el.nameInput.value.trim(),
        el.serverInput.value.trim(),
        el.passwordInput.value,
      );
    } catch (err) {
      el.gateError.textContent = err.message || String(err);
      el.gateError.hidden = false;
      if (err.precisaSenha) {
        pedirSenha(true);
        el.passwordInput.value = '';
        el.passwordInput.focus();
      }
      el.joinBtn.disabled = false;
      el.joinBtn.textContent = 'Entrar na sala';
    }
  });

  // ── Entrar ───────────────────────────────────────────────
  let minhaSenha = '';

  async function join(name, serverUrl, password) {
    if (!name) throw new Error('Escolha um nome.');
    if (!serverUrl) throw new Error('Informe o endereço do servidor.');
    minhaSenha = password || '';

    // Microfone antes de tudo: sem ele não há voz.
    if (!micStream) {
      try {
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          video: false,
        });
      } catch {
        throw new Error('Não consegui acessar o microfone. Verifique a permissão do sistema.');
      }
    }

    myName = name;
    localStorage.setItem(LS_NAME, name);
    localStorage.setItem(LS_SERVER, serverUrl);

    socket = io(serverUrl, { transports: ['websocket', 'polling'] });

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Servidor não respondeu. Confira o endereço.')), 12000);
      socket.on('connect_error', (err) => {
        clearTimeout(timer);
        reject(new Error(`Não foi possível conectar: ${err.message}`));
      });
      socket.on('connect', () => {
        socket.emit('join', { name, muted, deafened, password: minhaSenha }, (res) => {
          clearTimeout(timer);
          if (res && res.error) {
            const erro = new Error(res.error);
            erro.precisaSenha = !!res.precisaSenha;
            socket.disconnect(); // não deixa a conexão pendurada após recusa
            socket = null;
            return reject(erro);
          }
          myId = res.id;
          res.peers.forEach((p) => addPeer(p));
          resolve();
        });
      });
    });

    wireSocket();
    watchSpeaking(micStream, 'me');

    el.gate.hidden = true;
    el.app.hidden = false;
    el.connDot.classList.add('on');
    renderPeers();
    aplicarLayout();
    aplicarFiore();
    abrirPainelDeMusica(musica.painelAberto);
    tocarFiore('entrar'); // a sua própria chegada também é anunciada
    listarSaidas().catch(() => {});
    systemMessage(`Você entrou como ${name}.`);
    el.chatInput.focus();
  }

  function wireSocket() {
    socket.on('disconnect', () => {
      el.connDot.classList.remove('on');
      el.connDot.classList.add('off');
      systemMessage('Conexão com o servidor caiu. Tentando voltar…');
    });

    socket.io.on('reconnect', () => {
      el.connDot.classList.remove('off');
      el.connDot.classList.add('on');
      systemMessage('Reconectado.');
      socket.emit('join', { name: myName, muted, deafened, password: minhaSenha }, (res) => {
        if (!res || res.error) {
          if (res && res.error) systemMessage(`Não consegui voltar para a sala: ${res.error}`);
          return;
        }
        myId = res.id;
        peers.forEach((_, id) => removePeer(id));
        res.peers.forEach((p) => addPeer(p));
        renderPeers();
      });
    });

    socket.on('peer-joined', (p) => { addPeer(p); renderPeers(); tocarFiore('entrar'); });

    socket.on('peer-left', ({ id }) => { removePeer(id); renderPeers(); tocarFiore('sair'); });

    socket.on('peer-state', (p) => {
      const peer = peers.get(p.id);
      if (!peer) return;
      // Efeitos do modo Fiore nas viradas: começou a transmitir, ficou mudo.
      if (!peer.sharing && p.sharing) tocarFiore('stream');
      if (!peer.muted && p.muted) tocarFiore('mutado');
      peer.muted = p.muted;
      peer.deafened = p.deafened;
      // Quem parou de compartilhar zera o "fechei essa": a próxima
      // transmissão dela começa aberta de novo.
      if (peer.sharing && !p.sharing) peer.fechada = false;
      peer.sharing = p.sharing;
      peer.sharingAudio = p.sharingAudio;
      // Idem para a câmera: desligou, some o "fechei essa".
      if (peer.camera && !p.camera) peer.camFechada = false;
      peer.camera = p.camera;
      syncTile(peer);
      syncCamTile(peer);
      renderPeers();
    });

    socket.on('chat', (m) => appendMessage(m));
    socket.on('system', (text) => systemMessage(text));
    socket.on('signal', onSignal);

    socket.on('musica:estado', (estado) => {
      const trocou = !musica.estado.atual || !estado.atual
        || musica.estado.atual.videoId !== estado.atual.videoId;
      musica.estado = estado;
      musica.posicaoLocal = estado.posicao;
      aplicarMusica();
      if (trocou && estado.atual && !musica.painelAberto) {
        musica.naoVistas += 1;
        el.musicBadge.textContent = String(musica.naoVistas);
        el.musicBadge.hidden = false;
      }
    });

    // Correção de defasagem: se o player local escorregou mais de 1,5s do
    // que o servidor diz, ele volta para o lugar certo.
    socket.on('musica:tique', ({ videoId, posicao }) => {
      musica.estado.posicao = posicao;
      if (!musica.playerPronto || musica.videoCarregado !== videoId) return;
      const fora = Math.abs(musica.posicaoLocal - posicao);
      if (fora > 1.5) {
        log(`música fora de sincronia por ${fora.toFixed(1)}s — corrigindo`);
        aoPlayer({ tipo: 'seek', posicao });
      }
    });
  }

  // Toda a sinalização de um par passa por esta fila. Sem isso, uma oferta
  // pode ser criada no meio da aplicação de outra descrição (as chamadas do
  // WebRTC são assíncronas) e a conexão trava em "new" para sempre.
  function enqueue(peer, task) {
    peer.queue = peer.queue
      .then(task)
      .catch((err) => console.error('sinalização', err));
    return peer.queue;
  }

  // ── WebRTC: um RTCPeerConnection por participante ─────────
  //
  // Duas decisões deixam a malha estável:
  //  1. Cada par tem UM ofertante fixo (o de id menor). Sem disputa de quem
  //     oferece, não existe colisão de ofertas nem rollback.
  //  2. O espaço do vídeo já nasce reservado (transceiver de vídeo criado na
  //     hora da conexão). Compartilhar a tela vira um replaceTrack, sem
  //     renegociar nada — que era justamente onde a conexão travava.
  function addPeer(info) {
    if (peers.has(info.id) || info.id === myId) return;

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS, bundlePolicy: 'max-bundle' });

    const peer = {
      ...info,
      pc,
      offerer: myId < info.id,
      queue: Promise.resolve(),
      makingOffer: false,
      ignoreOffer: false,
      settingRemoteAnswer: false,
      videoTransceiver: null,
      screenAudioTransceiver: null,
      camTransceiver: null,
      videoStream: null,
      camStream: null,
      audioEl: null,          // voz da pessoa
      screenAudioEl: null,    // som da tela que ela compartilha
      volume: 1,
      screenAudioMuted: false,
    };
    peers.set(info.id, peer);

    // Ordem importa: canal 1 = voz, canal 2 = som da tela, canal 3 = tela,
    // canal 4 = câmera. Os dois lados montam na mesma ordem, então as
    // m-lines batem certinho.
    micStream.getAudioTracks().forEach((t) => pc.addTrack(t, micStream));

    // Quem oferece cria os espaços; quem responde adota os que vêm na oferta
    // (adoptChannels). Assim ninguém precisa renegociar depois.
    if (peer.offerer) {
      peer.screenAudioTransceiver = pc.addTransceiver('audio', { direction: 'sendrecv' });
      peer.videoTransceiver = pc.addTransceiver('video', { direction: 'sendrecv' });
      peer.camTransceiver = pc.addTransceiver('video', { direction: 'sendrecv' });
      applyShareTo(peer);
      applyBufferTo(peer);
    }

    async function negotiate() {
      if (pc.signalingState !== 'stable' || pc.connectionState === 'closed') return;
      try {
        peer.makingOffer = true;
        await pc.setLocalDescription();
        log('enviando', pc.localDescription.type, 'para', info.name);
        socket.emit('signal', { to: info.id, description: pc.localDescription });
      } finally {
        peer.makingOffer = false;
      }
    }

    pc.onnegotiationneeded = () => {
      if (!peer.offerer) return; // o outro lado é quem oferece
      enqueue(peer, negotiate);
    };

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) socket.emit('signal', { to: info.id, candidate });
    };

    pc.onconnectionstatechange = () => {
      log('estado com', info.name, '=', pc.connectionState);
      if (pc.connectionState === 'failed') {
        console.warn('conexão falhou com', info.name, '— tentando ICE restart');
        try { pc.restartIce(); } catch { /* navegador antigo */ }
        if (peer.offerer) enqueue(peer, negotiate);
      }
    };

    // Rede de segurança: se em 8s nem começou a conectar, tenta de novo.
    peer.watchdog = setInterval(() => {
      if (!peers.has(info.id)) return clearInterval(peer.watchdog);
      if (['connected', 'connecting', 'closed'].includes(pc.connectionState)) return;
      if (!peer.offerer) return;
      log('watchdog: reofertando para', info.name, pc.connectionState, pc.signalingState);
      enqueue(peer, negotiate);
    }, 8000);

    pc.ontrack = (ev) => {
      const track = ev.track;
      const stream = ev.streams[0] || new MediaStream([track]);

      if (track.kind === 'video') {
        // Dois canais de vídeo chegam, na mesma ordem dos dois lados:
        // o primeiro é a tela compartilhada, o segundo é a câmera.
        const canaisDeVideo = pc.getTransceivers()
          .filter((t) => t.receiver && t.receiver.track && t.receiver.track.kind === 'video');
        const ehCamera = canaisDeVideo.indexOf(ev.transceiver) === 1;

        // A faixa chega logo na conexão e fica em silêncio até a pessoa
        // ligar aquilo; o quadro só aparece quando ela liga.
        // Os eventos de mute/unmute da faixa só pedem uma reavaliação: quem
        // manda é o estado anunciado pela pessoa. Um "mute" atrasado do
        // compartilhamento anterior não pode derrubar o quadro do novo.
        if (ehCamera) {
          peer.camStream = stream;
          track.addEventListener('unmute', () => syncCamTile(peer));
          track.addEventListener('mute', () => syncCamTile(peer));
          syncCamTile(peer);
        } else {
          peer.videoStream = stream;
          track.addEventListener('unmute', () => syncTile(peer));
          track.addEventListener('mute', () => syncTile(peer));
          syncTile(peer);
        }
        return;
      }

      // Dois canais de áudio chegam: o primeiro é a voz, o segundo é o som
      // da tela compartilhada. A ordem é a mesma nos dois lados.
      const canaisDeAudio = pc.getTransceivers()
        .filter((t) => t.receiver && t.receiver.track && t.receiver.track.kind === 'audio');
      const ehVoz = canaisDeAudio.indexOf(ev.transceiver) <= 0;

      if (ehVoz) {
        if (!peer.audioEl) {
          peer.audioEl = document.createElement('audio');
          peer.audioEl.autoplay = true;
          el.audioSink.appendChild(peer.audioEl);
          rotearPlayer(peer.audioEl);
        }
        peer.audioEl.srcObject = stream;
        peer.audioEl.muted = deafened || !!peer.silenciado;
        peer.audioEl.play().catch(() => {});
        watchSpeaking(stream, info.id);
      } else {
        if (!peer.screenAudioEl) {
          peer.screenAudioEl = document.createElement('audio');
          peer.screenAudioEl.autoplay = true;
          el.audioSink.appendChild(peer.screenAudioEl);
          rotearPlayer(peer.screenAudioEl);
        }
        peer.screenAudioEl.srcObject = stream;
        peer.screenAudioEl.volume = peer.volume;
        peer.screenAudioEl.muted = deafened || peer.screenAudioMuted;
        peer.screenAudioEl.play().catch(() => {});
        track.addEventListener('unmute', () => syncTile(peer));
        track.addEventListener('mute', () => syncTile(peer));
      }
    };
  }

  /**
   * Localiza os canais já associados a m-lines e garante que possam enviar.
   * Precisa rodar ANTES de criar a resposta, senão a resposta sai como
   * "só recebo" e nunca conseguimos mandar nossa tela nem o som dela.
   */
  function adoptChannels(peer) {
    const ts = peer.pc.getTransceivers();
    const audios = ts.filter((t) => t.receiver && t.receiver.track && t.receiver.track.kind === 'audio');
    const videos = ts.filter((t) => t.receiver && t.receiver.track && t.receiver.track.kind === 'video');

    if (videos[0]) peer.videoTransceiver = videos[0];  // tela
    if (videos[1]) peer.camTransceiver = videos[1];    // câmera
    if (audios[1]) peer.screenAudioTransceiver = audios[1]; // audios[0] = voz

    [peer.videoTransceiver, peer.camTransceiver, peer.screenAudioTransceiver].forEach((t) => {
      if (t && t.direction !== 'sendrecv') t.direction = 'sendrecv';
    });

    applyShareTo(peer);
    applyBufferTo(peer);
  }

  /**
   * O som que acompanha a transmissão pode vir de dois lugares: da captura de
   * tela (mistura do sistema) ou da captura nativa de um aplicativo só.
   */
  function faixaDeSomDaTransmissao() {
    if (audioDeApp && audioDeApp.track && audioDeApp.track.readyState === 'live') return audioDeApp.track;
    return screenStream ? screenStream.getAudioTracks()[0] || null : null;
  }

  /** Deixa o que estamos (ou não) compartilhando refletido neste par. */
  function applyShareTo(peer) {
    const trocar = (transceiver, track) => {
      if (!transceiver || !transceiver.sender) return false;
      if (transceiver.sender.track === track) return false;
      transceiver.sender.replaceTrack(track)
        .catch((err) => console.error('replaceTrack', err));
      return true;
    };

    const video = sharing && screenStream ? screenStream.getVideoTracks()[0] || null : null;
    const som = sharing ? faixaDeSomDaTransmissao() : null;
    const cam = camAtiva && camStream ? camStream.getVideoTracks()[0] || null : null;

    const mudouVideo = trocar(peer.videoTransceiver, video);
    trocar(peer.screenAudioTransceiver, som);
    const mudouCam = trocar(peer.camTransceiver, cam);
    if (mudouVideo && video) applyQuality();
    if (mudouCam && cam) limitarCamera(peer);
  }

  /**
   * A câmera tem banda própria, bem menor que a da tela: mesmo em "Alta",
   * um rostinho em 720p não precisa roubar espaço da transmissão do jogo.
   */
  function limitarCamera(peer) {
    const sender = peer.camTransceiver && peer.camTransceiver.sender;
    if (!sender) return;
    const params = sender.getParameters();
    if (!params.encodings || !params.encodings.length) params.encodings = [{}];
    params.encodings[0].maxBitrate = 1.2e6;
    params.encodings[0].maxFramerate = 30;
    params.degradationPreference = 'balanced';
    sender.setParameters(params).catch((err) => log('setParameters câmera', err.message));
  }

  /**
   * Buffer de reprodução: segura a tela (e o som dela) por alguns
   * milissegundos antes de exibir, o que absorve os engasgos da internet.
   * A voz fica de fora de propósito — conversa precisa ser em tempo real.
   */
  function applyBufferTo(peer) {
    // A câmera fica de fora junto com a voz: rosto e voz precisam andar
    // no mesmo passo, senão a boca descola do som.
    [peer.videoTransceiver, peer.screenAudioTransceiver].forEach((t) => {
      if (!t || !t.receiver) return;
      try {
        if ('jitterBufferTarget' in t.receiver) t.receiver.jitterBufferTarget = bufferMs;
        else if ('playoutDelayHint' in t.receiver) t.receiver.playoutDelayHint = bufferMs / 1000;
      } catch (err) {
        log('buffer não aplicado', err.message);
      }
    });
  }

  /** Mostra ou esconde o quadro da tela de um participante. */
  function syncTile(peer) {
    if (peer.sharing && peer.videoStream && !peer.fechada) {
      addTile(peer.id, peer.name, peer.videoStream, { peer });
      syncTileAudio(peer);
    } else {
      removeTile(peer.id);
    }
  }

  /** O mesmo para a câmera: quadro à parte, do lado da tela dela. */
  function syncCamTile(peer) {
    const id = idDaCamera(peer.id);
    if (peer.camera && peer.camStream && !peer.camFechada) {
      addTile(id, `${peer.name} — câmera`, peer.camStream, { tipo: 'camera' });
    } else {
      removeTile(id);
    }
  }

  // Os quadros de câmera dividem a mesma grade dos de tela; o prefixo
  // "cam:" mantém os dois de uma pessoa como quadros separados.
  const idDaCamera = (id) => `cam:${id}`;
  const ehIdDeCamera = (id) => String(id).startsWith('cam:');
  const idBase = (id) => String(id).replace(/^cam:/, '');

  function onSignal({ from, description, candidate }) {
    const peer = peers.get(from);
    if (!peer) { log('sinal de par desconhecido', from, description && description.type); return; }

    enqueue(peer, async () => {
      const pc = peer.pc;
      if (pc.connectionState === 'closed') return;
      log('recebi', description ? description.type : 'candidate', 'de', peer.name, pc.signalingState);

      if (description) {
        // Só existe um ofertante por par, então uma oferta chegando enquanto
        // não estamos em "stable" é sinal de mensagem antiga: descartamos.
        if (description.type === 'offer' && pc.signalingState !== 'stable') {
          log('oferta fora de hora de', peer.name, '- ignorada');
          peer.ignoreOffer = true;
          return;
        }
        if (description.type === 'answer' && pc.signalingState !== 'have-local-offer') {
          log('resposta fora de hora de', peer.name, '- ignorada');
          return;
        }
        peer.ignoreOffer = false;

        await pc.setRemoteDescription(description);
        adoptChannels(peer);

        if (description.type === 'offer') {
          await pc.setLocalDescription();
          socket.emit('signal', { to: from, description: pc.localDescription });
        }
      } else if (candidate) {
        try {
          await pc.addIceCandidate(candidate);
        } catch (err) {
          // candidato de uma descrição que descartamos: pode ignorar
          if (!peer.ignoreOffer) throw err;
        }
      }
    });
  }

  function removePeer(id) {
    const peer = peers.get(id);
    if (!peer) return;
    clearInterval(peer.watchdog);
    try { peer.pc.close(); } catch { /* já fechado */ }
    if (peer.audioEl) peer.audioEl.remove();
    if (peer.screenAudioEl) peer.screenAudioEl.remove();
    removeTile(id);
    removeTile(idDaCamera(id));
    peers.delete(id);
  }

  function peerName(id) {
    const base = idBase(id);
    const nome = base === myId ? `${myName} (você)` : (peers.get(base)?.name || 'Alguém');
    return ehIdDeCamera(id) ? `${nome} 📷` : nome;
  }

  // ── Microfone ────────────────────────────────────────────
  function setMuted(value) {
    muted = value;
    micStream.getAudioTracks().forEach((t) => { t.enabled = !muted; });
    el.micBtn.classList.toggle('muted', muted);
    el.micIcon.textContent = muted ? '🔇' : '🎙️';
    el.micLabel.textContent = muted ? 'Ativar microfone' : 'Mudo';
  }

  el.micBtn.addEventListener('click', () => {
    setMuted(!muted);
    if (muted) tocarFiore('mutado');            // o seu mudo também conta
    if (!muted && deafened) setDeafened(false); // falar de novo tira o surdo
    sendState();
    renderPeers();
  });

  // ── Ensurdecer: parar de ouvir todo mundo ────────────────
  //
  // Como no Discord, ensurdecer também fecha o seu microfone: se você não
  // está ouvindo, não faz sentido continuar sendo ouvido sem saber.
  function setDeafened(value) {
    if (deafened === value) return;
    deafened = value;
    if (deafened) {
      mutedAntesDeSurdo = muted;
      setMuted(true);
    } else {
      setMuted(mutedAntesDeSurdo);
    }
    el.deafBtn.classList.toggle('muted', deafened);
    el.deafIcon.textContent = deafened ? '🔇' : '🔈';
    el.deafLabel.textContent = deafened ? 'Voltar a ouvir' : 'Ensurdecer';
    applyAudioRouting();
  }

  el.deafBtn.addEventListener('click', () => {
    setDeafened(!deafened);
    sendState();
    renderPeers();
  });

  /** Aplica quem eu escuto: o surdo global e os silenciados individualmente. */
  function applyAudioRouting() {
    peers.forEach((peer) => {
      if (peer.audioEl) peer.audioEl.muted = deafened || !!peer.silenciado;
      if (peer.screenAudioEl) {
        peer.screenAudioEl.muted = deafened || peer.screenAudioMuted;
        peer.screenAudioEl.volume = peer.volume;
      }
    });
  }

  /** Silencia (ou volta a ouvir) uma pessoa específica — só para mim. */
  function togglePeerMute(id) {
    const peer = peers.get(id);
    if (!peer) return;
    peer.silenciado = !peer.silenciado;
    applyAudioRouting();
    renderPeers();
    systemMessage(peer.silenciado
      ? `Você silenciou ${peer.name} (só para você).`
      : `Você voltou a ouvir ${peer.name}.`);
  }

  el.peers.addEventListener('click', (e) => {
    const btn = e.target.closest('.peer-mute');
    if (btn) togglePeerMute(btn.dataset.id);
  });

  // ── Compartilhamento de tela ─────────────────────────────
  el.shareBtn.addEventListener('click', () => (sharing ? stopShare() : startShare()));

  async function startShare() {
    // A escolha do som acontece aqui, junto com a escolha da tela.
    const escolha = await abrirDialogo();
    if (!escolha) return;
    localStorage.setItem(LS_SOM, escolha.som);
    const querSom = escolha.som === 'sistema';   // mistura do sistema, na captura de tela
    const querSomDoApp = escolha.som === 'app';  // captura nativa de um programa só

    // No app, a escolha da janela é entregue ao processo principal. Precisa
    // ser refeita a cada tentativa: ela é consumida assim que a captura pede.
    const armarFonte = () => (desktop ? desktop.chooseSource(escolha.fonte, querSom) : Promise.resolve());

    try {
      const q = QUALITY[quality];
      const video = {
        width: { ideal: q.width, max: q.width },
        height: { ideal: q.height, max: q.height },
        frameRate: { ideal: q.fps, max: q.fps },
      };
      // IMPORTANTE: aqui vai "audio: true", puro. Um objeto de restrições
      // (echoCancellation e afins) faz o Chromium recusar a captura de som do
      // sistema — era por isso que só o áudio de guia do navegador funcionava.
      // Som de tela não passa por filtro de voz nenhum, então não perdemos nada.
      const opcoes = { video, audio: querSom };
      // Dica ao navegador: sem "sistema" na lista quando não queremos som.
      if (querSom) opcoes.systemAudio = 'include';

      await armarFonte();
      try {
        screenStream = await navigator.mediaDevices.getDisplayMedia(opcoes);
      } catch (err) {
        // Alguns sistemas recusam a captura quando pedimos som junto.
        if (querSom && err.name !== 'NotAllowedError') {
          log('captura com som falhou, tentando sem:', err.message);
          await armarFonte();
          screenStream = await navigator.mediaDevices.getDisplayMedia({ video, audio: false });
        } else throw err;
      }
    } catch (err) {
      if (err && err.name === 'NotAllowedError') return; // cancelou, tudo bem
      systemMessage(`Não deu para compartilhar a tela: ${err.message}`);
      return;
    }

    const track = screenStream.getVideoTracks()[0];
    track.addEventListener('ended', () => stopShare());

    // Som de um aplicativo só: captura nativa, à parte da captura de tela.
    let erroDoApp = '';
    if (querSomDoApp && escolha.app) {
      const r = await iniciarSomDoApp(escolha.app);
      if (!r.ok) erroDoApp = r.erro;
    }

    const somDaTela = faixaDeSomDaTransmissao();
    sharingAudio = !!somDaTela;
    if (somDaTela) somDaTela.addEventListener('ended', () => { sharingAudio = false; sendState(); });

    sharing = true;
    previaFechada = false;
    // Sem renegociar: as faixas entram nos espaços já negociados.
    peers.forEach(applyShareTo);
    await applyQuality();

    el.shareBtn.classList.add('active');
    el.shareLabel.textContent = 'Parar de compartilhar';
    addTile(myId, `${myName} (você)`, screenStream, { isLocal: true });
    sendState();
    renderPeers();
    tocarFiore('stream');

    if (querSomDoApp) {
      if (erroDoApp) systemMessage(`Compartilhando sem som: ${erroDoApp}`);
      else if (somDaTela) systemMessage(`Compartilhando com o som de ${audioDeApp.nome} — só desse programa, sem as vozes da chamada.`);
      else systemMessage('Compartilhando sem som: a captura do aplicativo não entregou áudio.');
    } else if (querSom && !somDaTela) explicarFaltaDeSom(track);
    else if (querSom && somDaTela) {
      systemMessage('Compartilhando com o som do computador. Lembre: sai a mistura inteira da máquina, inclusive as vozes da chamada.');
    }
  }

  /**
   * Quando o som não vem, o motivo depende do que foi compartilhado. Dizer
   * exatamente qual é evita a caçada às cegas.
   */
  function explicarFaltaDeSom(track) {
    const tipo = (track.getSettings && track.getSettings().displaySurface) || 'desconhecido';

    if (desktop) {
      systemMessage(/win/i.test(navigator.userAgent)
        ? 'A tela foi compartilhada, mas o Windows não entregou o som. Verifique se a saída de áudio padrão do sistema é a mesma em que o jogo está tocando.'
        : 'A tela foi compartilhada sem som: a captura de som do sistema só funciona no Windows.');
      return;
    }

    if (tipo === 'window') {
      systemMessage('Sem som: o Chrome não captura o som de janelas soltas — só de telas inteiras e de guias. Para enviar o som, pare e compartilhe a TELA INTEIRA (marcando "Compartilhar áudio do sistema") ou uma GUIA do navegador (marcando "Compartilhar áudio da guia").');
    } else if (tipo === 'monitor') {
      systemMessage('Sem som: faltou marcar "Compartilhar áudio do sistema" na janelinha do Chrome — a caixinha fica no canto de baixo dela. Isso só existe no Windows.');
    } else if (tipo === 'browser') {
      systemMessage('Sem som: faltou marcar "Compartilhar áudio da guia" na janelinha do Chrome.');
    } else {
      systemMessage('A tela foi compartilhada, mas sem som.');
    }
  }

  function stopShare() {
    if (!sharing) return;
    sharing = false;
    sharingAudio = false;
    pararSomDoApp();
    peers.forEach(applyShareTo);
    if (screenStream) screenStream.getTracks().forEach((t) => t.stop());
    screenStream = null;
    el.shareBtn.classList.remove('active');
    el.shareLabel.textContent = 'Compartilhar tela';
    removeTile(myId);
    sendState();
    renderPeers();
  }

  // ── Webcam ───────────────────────────────────────────────
  //
  // A câmera vai pelo quarto canal, que já nasce reservado na conexão. Ligar
  // e desligar é só trocar a faixa: ninguém renegocia nada, e quem está
  // assistindo a uma tela não perde o quadro por causa disso.
  el.camBtn.addEventListener('click', () => (camAtiva ? desligarCamera() : ligarCamera()));

  async function ligarCamera() {
    if (camAtiva) return;
    try {
      camStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          ...(camId ? { deviceId: { exact: camId } } : {}),
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30, max: 30 },
        },
      });
    } catch (err) {
      // A câmera escolhida pode ter sido desconectada: tenta a padrão.
      if (camId) {
        camId = '';
        localStorage.removeItem(LS_CAM);
        return ligarCamera();
      }
      systemMessage(err && err.name === 'NotAllowedError'
        ? 'Não deu para ligar a câmera: falta permissão. Libere o acesso à câmera e tente de novo.'
        : `Não deu para ligar a câmera: ${err.message}`);
      return;
    }

    const track = camStream.getVideoTracks()[0];
    if (!track) { camStream = null; systemMessage('Nenhuma câmera encontrada.'); return; }
    track.contentHint = 'motion';
    track.addEventListener('ended', () => desligarCamera());
    // Lembra qual câmera deu certo, para a próxima vez.
    const usada = track.getSettings && track.getSettings().deviceId;
    if (usada) { camId = usada; localStorage.setItem(LS_CAM, usada); }

    camAtiva = true;
    camFechadaLocal = false;
    peers.forEach(applyShareTo);
    peers.forEach(limitarCamera);

    el.camBtn.classList.add('active');
    el.camLabel.textContent = 'Desligar câmera';
    addTile(idDaCamera(myId), `${myName} (você) — câmera`, camStream, { tipo: 'camera', isLocal: true });
    sendState();
    renderPeers();
    listarCameras().catch(() => {});
  }

  function desligarCamera() {
    if (!camAtiva) return;
    camAtiva = false;
    peers.forEach(applyShareTo);
    if (camStream) camStream.getTracks().forEach((t) => t.stop());
    camStream = null;
    el.camBtn.classList.remove('active');
    el.camLabel.textContent = 'Ligar câmera';
    removeTile(idDaCamera(myId));
    sendState();
    renderPeers();
  }

  /** Só mostra o seletor quando existe mais de uma câmera para escolher. */
  async function listarCameras() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    const todas = (await navigator.mediaDevices.enumerateDevices())
      .filter((d) => d.kind === 'videoinput');
    el.camRow.hidden = todas.length < 2;
    if (todas.length < 2) return;

    el.camSelect.innerHTML = '';
    todas.forEach((d, i) => {
      const opt = document.createElement('option');
      opt.value = d.deviceId;
      opt.textContent = d.label || `Câmera ${i + 1}`;
      if (d.deviceId === camId) opt.selected = true;
      el.camSelect.appendChild(opt);
    });
  }

  el.camSelect.addEventListener('change', async () => {
    camId = el.camSelect.value;
    localStorage.setItem(LS_CAM, camId);
    if (!camAtiva) return;
    // Troca a câmera sem piscar o botão: desliga a faixa antiga e liga a nova.
    const antiga = camStream;
    camAtiva = false;
    await ligarCamera();
    if (antiga) antiga.getTracks().forEach((t) => t.stop());
  });

  if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
    navigator.mediaDevices.addEventListener('devicechange', () => {
      listarCameras().catch(() => {});
    });
  }

  // ── Som de um aplicativo só (Windows, via app desktop) ───
  //
  // O áudio bruto chega do processo principal em pedaços de PCM. Aqui ele
  // entra num AudioWorklet, que o transforma numa faixa de mídia igual a
  // qualquer outra — e essa faixa vai pelo canal de som da transmissão que
  // já existe na conexão, sem renegociar nada.
  const CODIGO_DO_WORKLET = `
    class FilaDePCM extends AudioWorkletProcessor {
      constructor() {
        super();
        this.fila = [];
        this.quadrosNaFila = 0;
        this.maximo = sampleRate * 0.4; // 400 ms: além disso, atraso demais
        this.port.onmessage = (e) => {
          const amostras = e.data;             // Int16Array intercalado
          const quadros = amostras.length / 2;
          const esq = new Float32Array(quadros);
          const dir = new Float32Array(quadros);
          for (let i = 0; i < quadros; i++) {
            esq[i] = amostras[i * 2] / 32768;
            dir[i] = amostras[i * 2 + 1] / 32768;
          }
          this.fila.push([esq, dir, 0]);
          this.quadrosNaFila += quadros;
          while (this.quadrosNaFila > this.maximo && this.fila.length > 1) {
            const [e0] = this.fila.shift();
            this.quadrosNaFila -= e0.length;
          }
        };
      }
      process(_entradas, saidas) {
        const saida = saidas[0];
        const esqOut = saida[0];
        const dirOut = saida[1] || saida[0];
        let escrito = 0;
        while (escrito < esqOut.length && this.fila.length) {
          const item = this.fila[0];
          const [esq, dir] = item;
          let pos = item[2];
          const copiar = Math.min(esqOut.length - escrito, esq.length - pos);
          for (let i = 0; i < copiar; i++) {
            esqOut[escrito + i] = esq[pos + i];
            dirOut[escrito + i] = dir[pos + i];
          }
          escrito += copiar;
          pos += copiar;
          this.quadrosNaFila -= copiar;
          if (pos >= esq.length) this.fila.shift(); else item[2] = pos;
        }
        for (let i = escrito; i < esqOut.length; i++) { esqOut[i] = 0; dirOut[i] = 0; }
        return true;
      }
    }
    registerProcessor('fila-de-pcm', FilaDePCM);
  `;

  let audioDeApp = null; // { ctx, node, stream, track, pid, nome }

  async function iniciarSomDoApp(app) {
    const status = await desktop.appAudio.status();
    if (!status.disponivel) return { ok: false, erro: status.motivo };

    const resposta = await desktop.appAudio.iniciar(app.pid);
    if (!resposta || !resposta.ok) return { ok: false, erro: (resposta && resposta.erro) || 'falha desconhecida' };

    const ctx = new AudioContext({ sampleRate: status.formato.taxa });
    const blob = new Blob([CODIGO_DO_WORKLET], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    try {
      await ctx.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }

    const node = new AudioWorkletNode(ctx, 'fila-de-pcm', { outputChannelCount: [2] });
    const destino = ctx.createMediaStreamDestination();
    node.connect(destino);
    await ctx.resume().catch(() => {});

    desktop.appAudio.aoReceber((chunk) => {
      // Chega como bytes; viram amostras de 16 bits sem cópia extra.
      const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
      const amostras = new Int16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
      node.port.postMessage(amostras, [amostras.buffer]);
    });

    audioDeApp = {
      ctx,
      node,
      stream: destino.stream,
      track: destino.stream.getAudioTracks()[0],
      pid: app.pid,
      nome: app.titulo || app.nome,
    };
    return { ok: true };
  }

  function pararSomDoApp() {
    if (!audioDeApp) return;
    try { audioDeApp.track.stop(); } catch { /* já parada */ }
    try { audioDeApp.node.disconnect(); } catch { /* já solta */ }
    audioDeApp.ctx.close().catch(() => {});
    audioDeApp = null;
    if (desktop && desktop.appAudio) desktop.appAudio.parar().catch(() => {});
  }

  // ── Qualidade do compartilhamento ────────────────────────
  //
  // Dois ajustes, sem renegociar nada:
  //  - applyConstraints: manda a captura entregar menos pixels/quadros;
  //  - setParameters: põe um teto de banda no envio para cada pessoa.
  el.quality.value = quality;
  el.quality.addEventListener('change', async () => {
    quality = el.quality.value;
    localStorage.setItem(LS_QUALITY, quality);
    await applyQuality();
    if (sharing) systemMessage(`Qualidade do compartilhamento: ${QUALITY[quality].label}.`);
  });

  // ── Onde ouvir a chamada ─────────────────────────────────
  //
  // Existe um motivo prático forte para isso: o "som do computador" que a
  // captura envia é a mistura final da saída padrão. Se as vozes da chamada
  // saírem por OUTRO aparelho (um fone, por exemplo), elas ficam de fora da
  // captura — e a transmissão leva só o som do jogo, sem eco.
  async function listarSaidas() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    const els = document.createElement('audio');
    if (typeof els.setSinkId !== 'function') return; // navegador sem suporte

    const dispositivos = (await navigator.mediaDevices.enumerateDevices())
      .filter((d) => d.kind === 'audiooutput');
    if (dispositivos.length < 2) { el.outputRow.hidden = true; return; }

    const salvo = localStorage.getItem(LS_SAIDA) || 'default';
    el.output.innerHTML = '';
    dispositivos.forEach((d, i) => {
      const opt = document.createElement('option');
      opt.value = d.deviceId;
      opt.textContent = d.label || `Saída ${i + 1}`;
      el.output.appendChild(opt);
    });
    el.output.value = [...el.output.options].some((o) => o.value === salvo) ? salvo : 'default';
    el.outputRow.hidden = false;
    aplicarSaida();
  }

  async function aplicarSaida() {
    const id = el.output.value;
    localStorage.setItem(LS_SAIDA, id);
    const players = [...el.audioSink.querySelectorAll('audio')];
    await Promise.all(players.map((p) => (p.setSinkId ? p.setSinkId(id).catch(() => {}) : null)));
  }

  el.output.addEventListener('change', async () => {
    await aplicarSaida();
    const nome = el.output.options[el.output.selectedIndex].textContent;
    systemMessage(`Você passou a ouvir a chamada em: ${nome}.`);
  });

  /** Todo player novo já nasce apontando para a saída escolhida. */
  function rotearPlayer(player) {
    const id = localStorage.getItem(LS_SAIDA);
    if (id && player.setSinkId) player.setSinkId(id).catch(() => {});
  }

  // ── Buffer de reprodução (suavidade) ─────────────────────
  el.buffer.value = String(bufferMs);
  el.buffer.addEventListener('change', () => {
    bufferMs = Number(el.buffer.value);
    localStorage.setItem(LS_BUFFER, String(bufferMs));
    peers.forEach(applyBufferTo);
    systemMessage(bufferMs === 0
      ? 'Telas exibidas em tempo real (pode engasgar se a internet oscilar).'
      : `Telas exibidas com ${(bufferMs / 1000).toFixed(1).replace('.', ',')}s de atraso, para ficarem mais suaves.`);
  });

  async function applyQuality() {
    const q = QUALITY[quality];

    if (screenStream) {
      const track = screenStream.getVideoTracks()[0];
      if (track) {
        track.contentHint = q.hint;
        try {
          await track.applyConstraints({
            width: { max: q.width },
            height: { max: q.height },
            frameRate: { max: q.fps },
          });
        } catch (err) {
          log('applyConstraints falhou', err.message);
        }
      }
    }

    peers.forEach((peer) => {
      const sender = peer.videoTransceiver && peer.videoTransceiver.sender;
      if (!sender) return;
      const params = sender.getParameters();
      if (!params.encodings || !params.encodings.length) params.encodings = [{}];
      params.encodings[0].maxBitrate = q.bitrate;
      params.encodings[0].maxFramerate = q.fps;
      // Em tela compartilhada, nitidez costuma importar mais que fluidez.
      params.degradationPreference = q.hint === 'detail' ? 'maintain-resolution' : 'balanced';
      sender.setParameters(params).catch((err) => log('setParameters', err.message));
    });
  }

  /**
   * Diálogo único de compartilhamento: escolhe a tela (no app) e o som.
   * Resolve com { fonte, som } ou null se a pessoa desistir.
   */
  async function abrirDialogo() {
    let fonte = null;
    let nomeDaFonte = '';

    // Lista de programas para o som por aplicativo (só o app desktop tem).
    let apps = [];
    let podeSomDeApp = false;
    if (desktop && desktop.appAudio) {
      try {
        const status = await desktop.appAudio.status();
        podeSomDeApp = !!status.disponivel;
        if (podeSomDeApp) apps = await desktop.appAudio.listar();
      } catch (err) {
        log('som por aplicativo indisponível', err.message);
      }
    }
    el.optApp.hidden = !podeSomDeApp || apps.length === 0;

    /** Pré-seleciona o programa cuja janela é a que está sendo compartilhada. */
    const casarComAJanela = () => {
      if (!apps.length || !nomeDaFonte) return;
      const igual = apps.find((a) => a.titulo === nomeDaFonte)
        || apps.find((a) => nomeDaFonte && a.titulo.includes(nomeDaFonte))
        || apps.find((a) => nomeDaFonte.includes(a.titulo));
      if (igual) el.appSelect.value = String(igual.pid);
    };

    el.appSelect.innerHTML = '';
    apps.forEach((a) => {
      const opt = document.createElement('option');
      opt.value = String(a.pid);
      opt.textContent = a.titulo === a.nome ? a.titulo : `${a.titulo} — ${a.nome}`;
      el.appSelect.appendChild(opt);
    });

    el.pickerList.innerHTML = '';
    if (desktop) {
      el.pickerTitle.textContent = 'O que você quer compartilhar?';
      const fontes = await desktop.getSources();
      fontes.forEach((s, i) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'picker-item' + (i === 0 ? ' on' : '');
        btn.innerHTML = `<img src="${s.thumbnail}" alt="" /><span>${escapeHtml(s.name)}</span>`;
        btn.addEventListener('click', () => {
          fonte = s.id;
          nomeDaFonte = s.name;
          casarComAJanela();
          [...el.pickerList.children].forEach((c) => c.classList.toggle('on', c === btn));
        });
        el.pickerList.appendChild(btn);
      });
      fonte = fontes.length ? fontes[0].id : null;
      nomeDaFonte = fontes.length ? fontes[0].name : '';
      casarComAJanela();
      el.pickerList.hidden = false;
    } else {
      el.pickerTitle.textContent = 'Compartilhar tela';
      el.pickerList.hidden = true;
    }

    // Textos honestos sobre o que cada sistema consegue capturar.
    const win = /win/i.test(navigator.platform) || /Windows/i.test(navigator.userAgent);
    el.soundNote.textContent = desktop
      ? (win ? 'Sai a mistura da máquina inteira.' : 'Só funciona no Windows; aqui deve vir sem som.')
      : 'O Chrome pergunta na janelinha dele; funciona para tela inteira e guias.';

    el.pickerWarn.textContent = 'O computador não sabe separar o som de um programa só: o que vai é a mistura inteira da saída de áudio — inclusive as vozes desta chamada, que voltam como eco para os outros. Para mandar só o som do jogo, escolha na barra lateral ouvir a chamada em outro aparelho (um fone), deixando o jogo na saída principal.';

    // Só as opções realmente oferecidas. Cuidado: aqui o próprio diálogo
    // ainda está escondido, então a checagem tem que ser da opção em si.
    const radios = [...document.querySelectorAll('input[name="share-sound"]')]
      .filter((r) => {
        const opcao = r.closest('.sound-opt');
        return !opcao || !opcao.hidden;
      });
    let salvo = localStorage.getItem(LS_SOM) || 'nenhum';
    if (!radios.some((r) => r.value === salvo)) salvo = 'nenhum';
    radios.forEach((r) => { r.checked = r.value === salvo; });

    const atualizarAviso = () => {
      const escolhido = radios.find((r) => r.checked);
      el.pickerWarn.hidden = !escolhido || escolhido.value !== 'sistema';
      el.appSelect.disabled = !escolhido || escolhido.value !== 'app';
    };
    radios.forEach((r) => r.addEventListener('change', atualizarAviso));
    // Mexer no seletor de aplicativo já escolhe aquela opção de som.
    el.appSelect.addEventListener('focus', () => {
      const opcao = radios.find((r) => r.value === 'app');
      if (opcao && !opcao.checked) { opcao.checked = true; atualizarAviso(); }
    });
    atualizarAviso();

    return new Promise((resolve) => {
      const fechar = (valor) => {
        el.picker.hidden = true;
        el.pickerOk.removeEventListener('click', ok);
        el.pickerCancel.removeEventListener('click', cancelar);
        document.removeEventListener('keydown', tecla);
        resolve(valor);
      };
      const ok = () => {
        const escolhido = radios.find((r) => r.checked);
        const som = escolhido ? escolhido.value : 'nenhum';
        const app = som === 'app'
          ? apps.find((a) => String(a.pid) === el.appSelect.value) || apps[0]
          : null;
        fechar({ fonte, som, app });
      };
      const cancelar = () => fechar(null);
      const tecla = (e) => {
        if (e.key === 'Escape') cancelar();
        if (e.key === 'Enter') { e.preventDefault(); ok(); }
      };

      el.pickerOk.addEventListener('click', ok);
      el.pickerCancel.addEventListener('click', cancelar);
      document.addEventListener('keydown', tecla);
      el.picker.hidden = false;
      el.pickerOk.focus();
    });
  }

  // ── Grade de telas ───────────────────────────────────────
  function addTile(id, label, stream, { isLocal = false, peer = null, tipo = 'tela' } = {}) {
    const existente = el.grid.querySelector(`.tile[data-peer="${CSS.escape(String(id))}"]`);
    if (existente) {
      // Já está na tela. Só a fonte pode ter mudado (trocar de câmera, por
      // exemplo) — nesse caso basta reapontar o vídeo, sem refazer o quadro.
      const v = existente.querySelector('video');
      if (v && v.srcObject !== stream) { v.srcObject = stream; v.play().catch(() => {}); }
      return;
    }

    const ehCamera = tipo === 'camera';
    const tile = document.createElement('div');
    tile.className = 'tile' + (ehCamera ? ' camera' : '');
    tile.dataset.peer = id;
    tile.dataset.tipo = tipo;
    tile.title = ehCamera ? 'Clique para ver só esta câmera' : 'Clique para ver só esta tela';

    const video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true; // o áudio vem pelos elementos <audio>
    video.srcObject = stream;
    // A sua própria câmera aparece espelhada, como num espelho de verdade —
    // é o que todo mundo espera ao se ver na tela.
    if (ehCamera && isLocal) video.classList.add('espelhado');
    video.play().catch(() => {});

    const tag = document.createElement('div');
    tag.className = 'tile-label';
    tag.textContent = isLocal && !ehCamera ? `${label} — compartilhando` : label;

    const hint = document.createElement('div');
    hint.className = 'tile-hint';
    hint.textContent = 'clique = focar · 2 cliques = maximizar';

    // Ferramentas do quadro: maximizar, tela cheia e fechar
    const tools = document.createElement('div');
    tools.className = 'tile-tools';

    const btnMax = document.createElement('button');
    btnMax.type = 'button';
    btnMax.className = 'btn-max';
    btnMax.textContent = '⤢';
    btnMax.title = 'Maximizar: ocupa a tela toda, sem chat (F)';
    btnMax.addEventListener('click', (e) => { e.stopPropagation(); alternarMaximizado(id); });

    const btnFull = document.createElement('button');
    btnFull.type = 'button';
    btnFull.textContent = '⛶';
    btnFull.title = 'Tela cheia do sistema (Shift+F)';
    btnFull.addEventListener('click', (e) => { e.stopPropagation(); alternarTelaCheia(tile); });

    const btnFechar = document.createElement('button');
    btnFechar.type = 'button';
    btnFechar.className = 'close';
    btnFechar.textContent = '✕';
    btnFechar.title = isLocal
      ? 'Esconder a sua prévia'
      : (ehCamera ? 'Esconder esta câmera' : 'Sair desta transmissão (parar de assistir)');
    btnFechar.addEventListener('click', (e) => { e.stopPropagation(); fecharTransmissao(id); });

    tools.append(btnMax, btnFull, btnFechar);
    tile.append(video, tag, hint, tools);
    tile.addEventListener('dblclick', (e) => { e.preventDefault(); alternarMaximizado(id); });

    // Volume do som daquela transmissão, só para quem assiste.
    if (peer) {
      const box = document.createElement('div');
      box.className = 'tile-audio';
      box.hidden = true;

      const botao = document.createElement('button');
      botao.type = 'button';
      botao.textContent = '🔊';
      botao.title = 'Silenciar o som desta transmissão';

      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = '0';
      slider.max = '100';
      slider.value = String(Math.round(peer.volume * 100));
      slider.title = 'Volume desta transmissão';

      const aplicar = () => {
        if (!peer.screenAudioEl) return;
        peer.screenAudioEl.volume = peer.volume;
        peer.screenAudioEl.muted = deafened || peer.screenAudioMuted;
        botao.textContent = peer.screenAudioMuted || peer.volume === 0 ? '🔇' : '🔊';
      };

      slider.addEventListener('input', () => {
        peer.volume = Number(slider.value) / 100;
        peer.screenAudioMuted = false;
        aplicar();
      });
      botao.addEventListener('click', () => {
        peer.screenAudioMuted = !peer.screenAudioMuted;
        aplicar();
      });
      // Mexer no volume não deve mudar o que estou assistindo.
      box.addEventListener('click', (e) => e.stopPropagation());

      box.append(botao, slider);
      tile.append(box);
      peer.audioBox = box;
      peer.aplicarVolume = aplicar;
    }

    tile.addEventListener('click', () => setViewing(viewing === id ? 'todos' : id));

    el.grid.appendChild(tile);
    applyView();
    atualizarBotoesDosQuadros();
  }

  /** Mostra o controle de volume só quando a transmissão tem som mesmo. */
  function syncTileAudio(peer) {
    if (!peer.audioBox) return;
    const faixa = peer.screenAudioEl && peer.screenAudioEl.srcObject
      ? peer.screenAudioEl.srcObject.getAudioTracks()[0]
      : null;
    const temSom = !!(peer.sharingAudio && faixa && !faixa.muted);
    peer.audioBox.hidden = !temSom;
    if (temSom && peer.aplicarVolume) peer.aplicarVolume();
  }

  function removeTile(id) {
    const tile = el.grid.querySelector(`.tile[data-peer="${CSS.escape(String(id))}"]`);

    // A transmissão que estava em tela cheia acabou: sair antes de tirar o
    // quadro, senão a janela fica cobrindo o sistema sem nada dentro.
    if (tile && (document.fullscreenElement === tile || (telaCheiaDaJanela && maximizado === id))) {
      sairDaTelaCheia();
    }

    if (tile) tile.remove();
    if (viewing === id) viewing = 'todos';
    // Se a transmissão maximizada acabou, o layout volta ao normal sozinho.
    if (maximizado === id) { maximizado = null; aplicarLayout(); }
    applyView();
  }

  // ── Modo Fiore: efeitos sonoros nos acontecimentos ───────
  //
  // Tudo local: cada pessoa liga ou desliga para si, e nada disso trafega
  // pela chamada — o som toca no alto-falante de quem ativou.
  const SONS_FIORE = {
    entrar: ['sons/entrar.ogg'],
    sair: ['sons/sair.mp3'],
    stream: ['sons/stream-1.ogg', 'sons/stream-2.ogg'],
    mutado: ['sons/mutado.ogg'],
  };

  const fiore = {
    ligado: localStorage.getItem(LS_FIORE) === 'sim',
    audios: {},          // evento -> [Audio]
    ultimoDe: {},        // evento -> instante
    ultimoQualquer: 0,
  };

  function prepararSonsFiore() {
    if (Object.keys(fiore.audios).length) return;
    const base = (localStorage.getItem(LS_SERVER) || location.origin).replace(/\/$/, '');
    Object.entries(SONS_FIORE).forEach(([evento, arquivos]) => {
      fiore.audios[evento] = arquivos.map((nome) => {
        const a = new Audio(`${base}/${nome}`);
        a.preload = 'auto';
        a.volume = 0.75;
        rotearPlayer(a); // sai pelo mesmo aparelho escolhido para a chamada
        return a;
      });
    });
  }

  /**
   * Toca o efeito do acontecimento. Os freios existem porque em bagunça
   * (todo mundo entrando junto, alguém batendo no mudo) isso viraria uma
   * salada de áudio.
   */
  function tocarFiore(evento) {
    if (!fiore.ligado || deafened) return;
    const agora = Date.now();
    if (agora - fiore.ultimoQualquer < 700) return;          // um de cada vez
    if (agora - (fiore.ultimoDe[evento] || 0) < 2500) return; // sem repetir na hora
    const opcoes = fiore.audios[evento];
    if (!opcoes || !opcoes.length) return;

    fiore.ultimoQualquer = agora;
    fiore.ultimoDe[evento] = agora;

    const som = opcoes[Math.floor(Math.random() * opcoes.length)];
    try { som.currentTime = 0; } catch { /* ainda carregando */ }
    som.play().catch((err) => log('som do fiore não tocou:', err.message));
  }

  function aplicarFiore() {
    el.fioreBtn.classList.toggle('active', fiore.ligado);
    el.fioreLabel.textContent = fiore.ligado ? 'Modo Fiore ligado' : 'Modo Fiore';
    if (fiore.ligado) prepararSonsFiore();
  }

  el.fioreBtn.addEventListener('click', () => {
    fiore.ligado = !fiore.ligado;
    localStorage.setItem(LS_FIORE, fiore.ligado ? 'sim' : 'nao');
    aplicarFiore();
    systemMessage(fiore.ligado
      ? 'Modo Fiore ligado — só você ouve os efeitos.'
      : 'Modo Fiore desligado.');
    if (fiore.ligado) tocarFiore('entrar'); // amostra na hora de ligar
  });

  // ── Música: fila compartilhada, tocada em sincronia ──────
  //
  // O servidor não toca nada: ele guarda o que está tocando e em que segundo.
  // Cada pessoa reproduz o mesmo trecho no player oficial do YouTube, que
  // vive num quadro à parte (player.html) servido pelo próprio servidor —
  // é o que permite o app desktop embutir o player.
  const musica = {
    estado: { atual: null, fila: [], pausado: false, posicao: 0 },
    painelAberto: localStorage.getItem(LS_MUSICA) === 'sim',
    playerPronto: false,
    videoCarregado: null,
    posicaoLocal: 0,
    naoVistas: 0,
    volume: Number(localStorage.getItem(LS_VOL_MUSICA) ?? 60) / 100,
  };

  const tempoBonito = (s) => {
    const seg = Math.max(0, Math.floor(s || 0));
    return `${Math.floor(seg / 60)}:${String(seg % 60).padStart(2, '0')}`;
  };

  function aoPlayer(msg) {
    if (!el.musicFrame.contentWindow) return;
    el.musicFrame.contentWindow.postMessage({ falatorio: true, ...msg }, '*');
  }

  function abrirPainelDeMusica(abrir) {
    musica.painelAberto = abrir;
    localStorage.setItem(LS_MUSICA, abrir ? 'sim' : 'nao');
    el.musicPanel.hidden = !abrir;
    el.app.classList.toggle('com-musica', abrir);
    el.musicChevron.style.transform = abrir ? '' : 'rotate(-90deg)';
    if (abrir) {
      musica.naoVistas = 0;
      el.musicBadge.hidden = true;
      garantirPlayer();
    }
  }

  /** O quadro do player só é criado quando alguém abre a música. */
  function garantirPlayer() {
    if (el.musicFrame.src) return;
    const base = (localStorage.getItem(LS_SERVER) || location.origin).replace(/\/$/, '');
    const url = new URL(`${base}/player.html`);
    if (DEBUG) url.searchParams.set('debug', '1');
    // O modo de teste do app vale também para o quadro do player.
    if (/[?&]teste=1/.test(location.search)) url.searchParams.set('teste', '1');
    el.musicFrame.src = url.toString();
    el.musicFrame.hidden = false;
  }

  el.musicBtn.addEventListener('click', () => abrirPainelDeMusica(!musica.painelAberto));
  el.musicClose.addEventListener('click', () => abrirPainelDeMusica(false));

  // Mensagens vindas do quadro do player
  window.addEventListener('message', (ev) => {
    const msg = ev.data;
    if (!msg || !msg.falatorio || ev.source !== el.musicFrame.contentWindow) return;

    if (msg.tipo === 'pronto') {
      musica.playerPronto = true;
      aoPlayer({ tipo: 'volume', valor: musica.volume });
      aplicarMusica(true);
    } else if (msg.tipo === 'tempo') {
      musica.posicaoLocal = msg.posicao;
      atualizarBarraDeMusica();
    } else if (msg.tipo === 'fim') {
      if (socket) socket.emit('musica:fim', msg.videoId);
    } else if (msg.tipo === 'erro') {
      log('player:', msg.codigo, msg.detalhe || '');
      if (msg.codigo === 101 || msg.codigo === 150) {
        systemMessage('Esse vídeo não pode tocar fora do YouTube — pulando.');
        if (socket) socket.emit('musica:pular');
      }
    }
  });

  /** Põe o player local no mesmo ponto que o servidor manda. */
  function aplicarMusica(forcar = false) {
    const e = musica.estado;
    desenharMusica();

    if (!musica.playerPronto) return;

    if (!e.atual) {
      if (musica.videoCarregado) { aoPlayer({ tipo: 'parar' }); musica.videoCarregado = null; }
      return;
    }

    if (musica.videoCarregado !== e.atual.videoId || forcar) {
      musica.videoCarregado = e.atual.videoId;
      aoPlayer({ tipo: 'carregar', videoId: e.atual.videoId, posicao: e.posicao });
      if (e.pausado) aoPlayer({ tipo: 'pausar' });
      return;
    }

    aoPlayer({ tipo: e.pausado ? 'pausar' : 'tocar' });
  }

  function atualizarBarraDeMusica() {
    const e = musica.estado;
    if (!e.atual) return;
    const dur = e.atual.duracao || 0;
    el.musicTime.textContent = tempoBonito(musica.posicaoLocal);
    el.musicFill.style.width = dur ? `${Math.min(100, (musica.posicaoLocal / dur) * 100)}%` : '0%';
  }

  function desenharMusica() {
    const e = musica.estado;

    el.musicNow.hidden = !e.atual;
    el.musicVazio.hidden = !!e.atual;
    el.musicPlay.textContent = e.pausado ? '▶' : '⏸';
    el.musicPlay.title = e.pausado ? 'Voltar a tocar para todos' : 'Pausar para todos';

    if (e.atual) {
      el.musicTitle.textContent = e.atual.titulo;
      const partes = [e.atual.canal, e.atual.por ? `pedida por ${e.atual.por}` : ''].filter(Boolean);
      el.musicSub.textContent = partes.join(' · ');
      if (e.atual.duracao) el.musicTime.textContent = tempoBonito(e.posicao);
    }

    el.musicCount.textContent = String(e.fila.length);
    el.musicQueue.innerHTML = '';
    e.fila.forEach((item, i) => {
      const li = document.createElement('li');
      li.innerHTML = `
        <span class="pos">${i + 1}</span>
        <span class="info">
          <span class="nome">${escapeHtml(item.titulo)}</span>
          <span class="quem">${escapeHtml(item.por || '')}</span>
        </span>
        <button class="tirar" type="button" data-id="${item.id}" title="Tirar da fila">✕</button>`;
      el.musicQueue.appendChild(li);
    });
  }

  el.musicQueue.addEventListener('click', (ev) => {
    const btn = ev.target.closest('.tirar');
    if (btn && socket) socket.emit('musica:remover', Number(btn.dataset.id));
  });

  el.musicPlay.addEventListener('click', () => {
    if (socket) socket.emit('musica:pausar', !musica.estado.pausado);
  });
  el.musicNext.addEventListener('click', () => socket && socket.emit('musica:pular'));
  el.musicClear.addEventListener('click', () => socket && socket.emit('musica:limpar'));

  el.musicVolume.value = String(Math.round(musica.volume * 100));
  el.musicVolume.addEventListener('input', () => {
    musica.volume = Number(el.musicVolume.value) / 100;
    localStorage.setItem(LS_VOL_MUSICA, String(el.musicVolume.value));
    aoPlayer({ tipo: 'volume', valor: musica.volume });
  });

  // ── Busca e pedidos ──────────────────────────────────────
  el.musicForm.addEventListener('submit', (ev) => {
    ev.preventDefault();
    pedirMusica(el.musicInput.value.trim());
  });

  function pedirMusica(termo) {
    if (!termo || !socket) return;
    el.musicResults.hidden = false;
    el.musicResults.innerHTML = '<div class="music-erro">Procurando…</div>';
    if (!musica.painelAberto) abrirPainelDeMusica(true);

    socket.emit('musica:buscar', termo, (resposta) => {
      el.musicResults.innerHTML = '';
      if (!resposta || resposta.erro) {
        el.musicResults.innerHTML = `<div class="music-erro">${escapeHtml((resposta && resposta.erro) || 'Busca falhou.')}</div>`;
        return;
      }
      const achados = resposta.resultados || [];
      if (!achados.length) {
        el.musicResults.innerHTML = '<div class="music-erro">Não achei nada com esse nome.</div>';
        return;
      }
      // Link colado: já entra na fila, sem escolher.
      if (achados.length === 1) {
        adicionarMusica(achados[0]);
        return;
      }
      achados.forEach((r) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'music-result';
        btn.innerHTML = `${escapeHtml(r.titulo)}<span>${escapeHtml(r.canal)}${r.duracao ? ' · ' + tempoBonito(r.duracao) : ''}</span>`;
        btn.addEventListener('click', () => adicionarMusica(r));
        el.musicResults.appendChild(btn);
      });
    });
  }

  function adicionarMusica(item) {
    socket.emit('musica:add', item);
    el.musicResults.hidden = true;
    el.musicResults.innerHTML = '';
    el.musicInput.value = '';
    garantirPlayer();
  }

  // ── Chat retrátil ────────────────────────────────────────
  //
  // Clicar em "# geral" abre e fecha o chat. Quando ele está fechado, o
  // palco ocupa também o espaço dele — é o mesmo mecanismo do maximizar.
  function aplicarLayout() {
    const esconderChat = !chatVisivel || !!maximizado;
    el.main.classList.toggle('sem-chat', esconderChat);
    el.main.classList.toggle('maximizado', !!maximizado);
    el.app.classList.toggle('sem-chat', esconderChat);

    if (!esconderChat) {
      naoLidas = 0;
      el.chatBadge.hidden = true;
      el.messages.scrollTop = el.messages.scrollHeight;
    }
    el.channelBtn.title = esconderChat
      ? 'Clique para mostrar o chat'
      : 'Clique para esconder o chat e dar mais espaço às telas';
    atualizarBotoesDosQuadros();
  }

  el.channelBtn.addEventListener('click', () => {
    if (maximizado && !chatVisivel) {
      // Estava maximizado: pedir o chat de volta desfaz o maximizar.
      restaurar();
      chatVisivel = true;
    } else {
      chatVisivel = !chatVisivel;
    }
    localStorage.setItem(LS_CHAT, chatVisivel ? 'sim' : 'nao');
    aplicarLayout();
  });

  function marcarNaoLida() {
    if (chatVisivel && !maximizado) return;
    naoLidas += 1;
    el.chatBadge.textContent = naoLidas > 99 ? '99+' : String(naoLidas);
    el.chatBadge.hidden = false;
  }

  // ── Maximizar uma transmissão dentro do app ──────────────
  function maximizar(id) {
    maximizado = id;
    setViewing(id);
    aplicarLayout();
  }

  function restaurar() {
    if (!maximizado) return;
    maximizado = null;
    setViewing('todos');
    aplicarLayout();
  }

  function alternarMaximizado(id) {
    if (maximizado === id) restaurar();
    else maximizar(id);
  }

  /** Mantém os ícones dos quadros coerentes com o estado atual. */
  function atualizarBotoesDosQuadros() {
    el.grid.querySelectorAll('.tile').forEach((tile) => {
      const btn = tile.querySelector('.btn-max');
      if (!btn) return;
      const ativo = maximizado === tile.dataset.peer;
      btn.textContent = ativo ? '⤡' : '⤢';
      btn.title = ativo ? 'Voltar ao tamanho normal (Esc)' : 'Maximizar: ocupa a tela toda, sem chat (F)';
      tile.classList.toggle('maximizado', ativo);
    });
  }

  // ── Tela cheia ───────────────────────────────────────────
  //
  // No app desktop NÃO usamos a API de tela cheia do HTML. Ela deixava a
  // janela cobrindo o sistema sem um caminho confiável de volta — daí o
  // Alt+Tab e o botão Windows parecerem travados durante e depois da
  // transmissão. Agora quem manda é a janela, e o processo principal garante
  // a saída no Esc, ao perder o foco e quando a transmissão acaba.
  let telaCheiaDaJanela = false;

  if (desktop && desktop.onFullScreen) {
    desktop.onFullScreen((ligada) => {
      telaCheiaDaJanela = ligada;
      if (!ligada && maximizado) restaurar();
      atualizarBotoesDosQuadros();
    });
  }

  async function alternarTelaCheia(tile) {
    const id = tile.dataset.peer;
    const video = tile.querySelector('video');
    if (video) video.play().catch(() => {});

    if (desktop && desktop.setFullScreen) {
      const ligar = !telaCheiaDaJanela;
      if (ligar) maximizar(id); else restaurar();
      telaCheiaDaJanela = await desktop.setFullScreen(ligar);
      return;
    }

    if (document.fullscreenElement === tile) {
      document.exitFullscreen().catch(() => {});
      return;
    }
    const pedir = tile.requestFullscreen || tile.webkitRequestFullscreen;
    if (!pedir) { systemMessage('Este navegador não permite tela cheia.'); return; }
    pedir.call(tile).catch((err) => systemMessage(`Não deu para abrir em tela cheia: ${err.message}`));
  }

  /** Sai de qualquer tela cheia, seja da janela ou do navegador. */
  function sairDaTelaCheia() {
    if (desktop && desktop.setFullScreen && telaCheiaDaJanela) {
      desktop.setFullScreen(false).catch(() => {});
      return true;
    }
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
      return true;
    }
    return false;
  }

  // Esc desfaz, em ordem: tela cheia, depois o maximizado.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (sairDaTelaCheia()) return;
    if (maximizado) restaurar();
  });

  // Rede extra: se a janela do app perder o foco (Alt+Tab), a tela cheia sai.
  // O processo principal já faz isso; aqui garantimos também no navegador.
  window.addEventListener('blur', () => {
    if (!desktop && document.fullscreenElement) document.exitFullscreen().catch(() => {});
  });

  // F maximiza/restaura; Shift+F usa a tela cheia do sistema.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'f' && e.key !== 'F') return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) return;
    if (!el.app || el.app.hidden) return;

    const visiveis = [...el.grid.querySelectorAll('.tile')].filter((t) => !t.hidden);
    const alvo = document.fullscreenElement || visiveis[0];
    if (!alvo) return;
    e.preventDefault();

    if (e.shiftKey) alternarTelaCheia(alvo);
    else alternarMaximizado(alvo.dataset.peer);
  });

  // ── Sair de uma transmissão (parar de assistir) ──────────
  let previaFechada = false;
  let camFechadaLocal = false;

  function fecharTransmissao(id) {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    const base = idBase(id);
    const camera = ehIdDeCamera(id);

    if (base === myId) {
      if (camera) { camFechadaLocal = true; removeTile(id); return; }
      previaFechada = true;
      removeTile(myId);
      systemMessage('Prévia escondida. Você continua compartilhando para os outros.');
      return;
    }
    const peer = peers.get(base);
    if (!peer) return;
    if (camera) {
      peer.camFechada = true;
      removeTile(id);
      systemMessage(`Você escondeu a câmera de ${peer.name}. Para voltar, use a barra "Assistindo".`);
      return;
    }
    peer.fechada = true;
    if (peer.screenAudioEl) peer.screenAudioEl.muted = true;
    removeTile(id);
    systemMessage(`Você saiu da transmissão de ${peer.name}. Para voltar, use a barra "Assistindo".`);
  }

  function reabrirTransmissao(id) {
    const base = idBase(id);
    const camera = ehIdDeCamera(id);

    if (base === myId) {
      if (camera) {
        camFechadaLocal = false;
        if (camAtiva && camStream) {
          addTile(idDaCamera(myId), `${myName} (você) — câmera`, camStream, { tipo: 'camera', isLocal: true });
        }
      } else {
        previaFechada = false;
        if (sharing && screenStream) addTile(myId, `${myName} (você)`, screenStream, { isLocal: true });
      }
      setViewing('todos');
      return;
    }
    const peer = peers.get(base);
    if (!peer) return;
    if (camera) {
      peer.camFechada = false;
      syncCamTile(peer);
    } else {
      peer.fechada = false;
      if (peer.screenAudioEl) peer.screenAudioEl.muted = deafened || peer.screenAudioMuted;
      syncTile(peer);
    }
    // Voltar a assistir não deve esconder as outras: mostramos todas de novo.
    setViewing('todos');
  }

  /** O que está no ar mas está fechado por mim (telas e câmeras). */
  const fechadas = () => {
    const lista = [];
    peers.forEach((p) => {
      if (p.sharing && p.fechada) lista.push({ id: p.id, nome: p.name });
      if (p.camera && p.camFechada) lista.push({ id: idDaCamera(p.id), nome: `${p.name} 📷` });
    });
    if (camAtiva && camFechadaLocal) lista.unshift({ id: idDaCamera(myId), nome: `${myName} (você) 📷` });
    if (sharing && previaFechada) lista.unshift({ id: myId, nome: `${myName} (você)` });
    return lista;
  };

  // ── Escolher qual tela assistir ──────────────────────────
  function setViewing(target) {
    viewing = target;
    applyView();
  }

  /** Reconstrói a barra de abas e mostra/esconde os quadros conforme a escolha. */
  function applyView() {
    const tiles = [...el.grid.querySelectorAll('.tile')];

    // Se quem eu assistia parou de compartilhar, volto para "Todos".
    if (viewing !== 'todos' && !tiles.some((t) => t.dataset.peer === viewing)) {
      viewing = 'todos';
    }

    tiles.forEach((tile) => {
      const focado = viewing === 'todos' || tile.dataset.peer === viewing;
      tile.hidden = !focado;
      tile.classList.toggle('focused', viewing === tile.dataset.peer);
      const video = tile.querySelector('video');
      // Pausar o que não está à vista poupa CPU (a faixa continua chegando).
      if (video) { if (focado) video.play().catch(() => {}); else video.pause(); }
    });

    el.grid.classList.toggle('focus-mode', viewing !== 'todos');
    // Quadro sozinho no palco pode esticar e usar todo o espaço.
    const visiveis = tiles.filter((t) => !t.hidden).length;
    el.grid.classList.toggle('esticar', visiveis === 1);

    const semAssistir = fechadas();
    el.stageEmpty.hidden = tiles.length > 0 || semAssistir.length > 0;

    // A barra aparece quando há escolha a fazer: duas ou mais telas, ou
    // alguma transmissão que você fechou e pode reabrir.
    if (tiles.length < 2 && semAssistir.length === 0) {
      el.viewBar.hidden = true;
      el.viewBar.innerHTML = '';
      return;
    }

    el.viewBar.hidden = false;
    el.viewBar.innerHTML = '<span class="view-label">Assistindo</span>';

    if (tiles.length >= 2) {
      el.viewBar.appendChild(criarAba('todos', `Todas (${tiles.length})`, false));
    }
    tiles.forEach((t) => {
      el.viewBar.appendChild(criarAba(t.dataset.peer, peerName(t.dataset.peer), false));
    });
    semAssistir.forEach(({ id, nome }) => {
      el.viewBar.appendChild(criarAba(id, nome, true));
    });
  }

  function criarAba(id, nome, fechada) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'view-tab' + (viewing === id && !fechada ? ' on' : '') + (fechada ? ' fechada' : '');
    btn.textContent = nome;
    btn.title = fechada ? 'Você saiu desta transmissão — clique para voltar a assistir' : '';
    btn.addEventListener('click', () => (fechada ? reabrirTransmissao(id) : setViewing(id)));
    return btn;
  }

  // ── Chat ─────────────────────────────────────────────────
  el.chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = el.chatInput.value.trim();
    if (!text) return;

    // Atalhos de música direto no chat, como nos bots.
    const pedido = /^\/(?:tocar|play|musica|música)\s+(.+)$/i.exec(text);
    if (pedido) { pedirMusica(pedido[1].trim()); el.chatInput.value = ''; return; }
    if (/^\/(?:pular|skip)$/i.test(text)) { socket.emit('musica:pular'); el.chatInput.value = ''; return; }
    if (/^\/(?:pausar|pause)$/i.test(text)) { socket.emit('musica:pausar', true); el.chatInput.value = ''; return; }
    if (/^\/(?:voltar|resume)$/i.test(text)) { socket.emit('musica:pausar', false); el.chatInput.value = ''; return; }
    if (/^\/(?:fila|queue)$/i.test(text)) { abrirPainelDeMusica(true); el.chatInput.value = ''; return; }

    socket.emit('chat', text);
    el.chatInput.value = '';
  });

  function appendMessage({ id, name, text, ts }) {
    if (id !== myId) marcarNaoLida();
    const wrap = document.createElement('div');
    wrap.className = 'msg';
    wrap.innerHTML = `
      <div class="avatar" style="background:${colorFor(name)}">${escapeHtml(initials(name))}</div>
      <div class="msg-body">
        <div class="msg-head">
          <span class="msg-author">${escapeHtml(name)}${id === myId ? ' (você)' : ''}</span>
          <span class="msg-time">${hhmm(ts)}</span>
        </div>
        <div class="msg-text">${escapeHtml(text)}</div>
      </div>`;
    pushMessage(wrap);
  }

  function systemMessage(text) {
    const div = document.createElement('div');
    div.className = 'msg-system';
    div.textContent = text;
    pushMessage(div);
  }

  function pushMessage(node) {
    const atBottom = el.messages.scrollHeight - el.messages.scrollTop - el.messages.clientHeight < 60;
    el.messages.appendChild(node);
    if (atBottom) el.messages.scrollTop = el.messages.scrollHeight;
  }

  // ── Lista de participantes ───────────────────────────────
  const speaking = new Set();

  function renderPeers() {
    const all = [
      { id: myId, name: `${myName} (você)`, muted, deafened, sharing, sharingAudio, camera: camAtiva, eu: true },
      ...[...peers.values()].map((p) => ({
        id: p.id, name: p.name, muted: p.muted, deafened: p.deafened,
        sharing: p.sharing, sharingAudio: p.sharingAudio, camera: p.camera,
        silenciado: p.silenciado,
      })),
    ];
    el.peerCount.textContent = String(all.length);
    el.peers.innerHTML = '';

    all.forEach((p) => {
      const li = document.createElement('li');
      if (p.eu) li.classList.add('self');
      if (speaking.has(p.eu ? 'me' : p.id) && !p.muted && !p.silenciado) li.classList.add('speaking');

      const tags = [
        p.camera ? '📷' : '',
        p.sharing ? '🖥️' : '',
        p.sharing && p.sharingAudio ? '🔊' : '',
        p.deafened ? '🎧' : '',
        p.muted ? '🔇' : '',
      ].join('');

      // O botão de silenciar não existe na sua própria linha: não faz
      // sentido, e ainda atrapalharia quem lê a linha (inclusive os testes).
      const botao = p.eu ? '' : `
        <button class="peer-mute${p.silenciado ? ' on' : ''}" type="button" data-id="${p.id}"
                title="${p.silenciado ? 'Voltar a ouvir' : 'Silenciar só para mim'}">
          ${p.silenciado ? '🔇' : '🔊'}
        </button>`;

      li.innerHTML = `
        <span class="avatar" style="background:${colorFor(p.name)}">${escapeHtml(initials(p.name))}</span>
        <span class="peer-name">${escapeHtml(p.name)}</span>
        <span class="peer-tags">${tags}</span>${botao}`;
      el.peers.appendChild(li);
    });
  }

  // Destaque de quem está falando (só visual, roda localmente).
  function watchSpeaking(stream, key) {
    if (!stream.getAudioTracks().length) return;
    let ctx;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch { return; }
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    src.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    let wasActive = false;

    setInterval(() => {
      analyser.getByteFrequencyData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i];
      const active = sum / data.length > 12;
      if (active === wasActive) return;
      wasActive = active;
      if (active) speaking.add(key); else speaking.delete(key);
      renderPeers();
    }, 250);
  }

  // ── Sair ─────────────────────────────────────────────────
  el.leaveBtn.addEventListener('click', () => {
    stopShare();
    desligarCamera();
    peers.forEach((_, id) => removePeer(id));
    if (micStream) micStream.getTracks().forEach((t) => t.stop());
    if (socket) socket.disconnect();
    location.reload();
  });

  window.addEventListener('beforeunload', () => {
    if (socket) socket.disconnect();
  });
})();
