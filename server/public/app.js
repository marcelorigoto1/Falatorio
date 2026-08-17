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

  // ── Elementos ────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);
  const el = {
    gate: $('gate'), gateForm: $('gate-form'), gateError: $('gate-error'),
    nameInput: $('name-input'), serverInput: $('server-input'),
    serverHint: $('server-hint'), joinBtn: $('join-btn'),
    app: $('app'), connDot: $('conn-dot'),
    peers: $('peers'), peerCount: $('peer-count'),
    micBtn: $('mic-btn'), micIcon: $('mic-icon'), micLabel: $('mic-label'),
    deafBtn: $('deaf-btn'), deafIcon: $('deaf-icon'), deafLabel: $('deaf-label'),
    shareBtn: $('share-btn'), shareLabel: $('share-label'), leaveBtn: $('leave-btn'),
    quality: $('quality-select'), viewBar: $('view-bar'),
    grid: $('grid'), stageEmpty: $('stage-empty'),
    messages: $('messages'), chatForm: $('chat-form'), chatInput: $('chat-input'),
    audioSink: $('audio-sink'),
    picker: $('picker'), pickerList: $('picker-list'), pickerCancel: $('picker-cancel'),
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
  let quality = localStorage.getItem(LS_QUALITY) || 'media';
  let viewing = 'todos';       // 'todos' ou o id de quem eu quero assistir

  /** peerId -> { name, muted, deafened, sharing, silenciado, pc, offerer, queue,
   *              makingOffer, ignoreOffer, videoTransceiver, videoStream,
   *              audioEl, watchdog } */
  const peers = new Map();

  const sendState = () => socket && socket.emit('state', { muted, deafened, sharing });

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

  el.gateForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    el.gateError.hidden = true;
    el.joinBtn.disabled = true;
    el.joinBtn.textContent = 'Conectando…';
    try {
      await join(el.nameInput.value.trim(), el.serverInput.value.trim());
    } catch (err) {
      el.gateError.textContent = err.message || String(err);
      el.gateError.hidden = false;
      el.joinBtn.disabled = false;
      el.joinBtn.textContent = 'Entrar na sala';
    }
  });

  // ── Entrar ───────────────────────────────────────────────
  async function join(name, serverUrl) {
    if (!name) throw new Error('Escolha um nome.');
    if (!serverUrl) throw new Error('Informe o endereço do servidor.');

    // Microfone antes de tudo: sem ele não há voz.
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
    } catch {
      throw new Error('Não consegui acessar o microfone. Verifique a permissão do sistema.');
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
        socket.emit('join', { name, muted, deafened }, (res) => {
          clearTimeout(timer);
          if (res && res.error) return reject(new Error(res.error));
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
      socket.emit('join', { name: myName, muted, deafened }, (res) => {
        if (!res || res.error) return;
        myId = res.id;
        peers.forEach((_, id) => removePeer(id));
        res.peers.forEach((p) => addPeer(p));
        renderPeers();
      });
    });

    socket.on('peer-joined', (p) => { addPeer(p); renderPeers(); });

    socket.on('peer-left', ({ id }) => { removePeer(id); renderPeers(); });

    socket.on('peer-state', (p) => {
      const peer = peers.get(p.id);
      if (!peer) return;
      peer.muted = p.muted;
      peer.deafened = p.deafened;
      peer.sharing = p.sharing;
      syncTile(peer);
      renderPeers();
    });

    socket.on('chat', (m) => appendMessage(m));
    socket.on('system', (text) => systemMessage(text));
    socket.on('signal', onSignal);
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
      videoStream: null,
      audioEl: null,
    };
    peers.set(info.id, peer);

    micStream.getAudioTracks().forEach((t) => pc.addTrack(t, micStream));

    // Quem oferece cria o espaço do vídeo; quem responde adota o espaço que
    // vem na oferta (adoptVideo). Assim os dois lados usam a mesma m-line e
    // conseguem enviar tela sem renegociar.
    if (peer.offerer) {
      peer.videoTransceiver = pc.addTransceiver('video', { direction: 'sendrecv' });
      applyShareTo(peer);
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

      if (track.kind === 'audio') {
        if (!peer.audioEl) {
          peer.audioEl = document.createElement('audio');
          peer.audioEl.autoplay = true;
          el.audioSink.appendChild(peer.audioEl);
        }
        peer.audioEl.srcObject = stream;
        peer.audioEl.muted = deafened || !!peer.silenciado;
        peer.audioEl.play().catch(() => {});
        watchSpeaking(stream, info.id);
      } else {
        // A faixa de vídeo chega logo na conexão e fica em silêncio até a
        // pessoa compartilhar; o quadro só aparece quando ela compartilha.
        peer.videoStream = stream;
        track.addEventListener('unmute', () => syncTile(peer));
        track.addEventListener('mute', () => removeTile(info.id));
        syncTile(peer);
      }
    };
  }

  /**
   * Localiza o transceiver de vídeo já associado a uma m-line e garante que
   * ele possa enviar. Precisa rodar ANTES de criar a resposta, senão a
   * resposta sai como "recvonly" e nunca conseguimos mandar nossa tela.
   */
  function adoptVideo(peer) {
    const t = peer.pc.getTransceivers().find((x) =>
      (x.receiver && x.receiver.track && x.receiver.track.kind === 'video')
      || (x.sender && x.sender.track && x.sender.track.kind === 'video'));
    if (!t) return;
    peer.videoTransceiver = t;
    if (t.direction !== 'sendrecv') t.direction = 'sendrecv';
    applyShareTo(peer);
  }

  /** Deixa o que estamos (ou não) compartilhando refletido neste par. */
  function applyShareTo(peer) {
    const t = peer.videoTransceiver;
    if (!t || !t.sender) return;
    const track = sharing && screenStream ? screenStream.getVideoTracks()[0] : null;
    if (t.sender.track === track) return;
    t.sender.replaceTrack(track)
      .then(() => { if (track) applyQuality(); })
      .catch((err) => console.error('replaceTrack', err));
  }

  /** Mostra ou esconde o quadro da tela de um participante. */
  function syncTile(peer) {
    if (peer.sharing && peer.videoStream) addTile(peer.id, peer.name, peer.videoStream);
    else removeTile(peer.id);
  }

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
        adoptVideo(peer);

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
    removeTile(id);
    peers.delete(id);
  }

  const peerName = (id) => (id === myId ? `${myName} (você)` : (peers.get(id)?.name || 'Alguém'));

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
    try {
      if (desktop) {
        const sources = await desktop.getSources();
        const chosen = await pickSource(sources);
        if (!chosen) return;
        await desktop.chooseSource(chosen);
      }
      const q = QUALITY[quality];
      screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: q.width, max: q.width },
          height: { ideal: q.height, max: q.height },
          frameRate: { ideal: q.fps, max: q.fps },
        },
        audio: false,
      });
    } catch (err) {
      if (err && err.name === 'NotAllowedError') return; // cancelou, tudo bem
      systemMessage(`Não deu para compartilhar a tela: ${err.message}`);
      return;
    }

    const track = screenStream.getVideoTracks()[0];
    track.addEventListener('ended', () => stopShare());

    sharing = true;
    // Sem renegociar: a faixa entra no espaço de vídeo já negociado.
    peers.forEach(applyShareTo);
    await applyQuality();

    el.shareBtn.classList.add('active');
    el.shareLabel.textContent = 'Parar de compartilhar';
    addTile(myId, `${myName} (você)`, screenStream, true);
    sendState();
    renderPeers();
  }

  function stopShare() {
    if (!sharing) return;
    sharing = false;
    peers.forEach(applyShareTo);
    if (screenStream) screenStream.getTracks().forEach((t) => t.stop());
    screenStream = null;
    el.shareBtn.classList.remove('active');
    el.shareLabel.textContent = 'Compartilhar tela';
    removeTile(myId);
    sendState();
    renderPeers();
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

  // Seletor de janela/tela do Electron
  function pickSource(sources) {
    return new Promise((resolve) => {
      el.pickerList.innerHTML = '';
      sources.forEach((s) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'picker-item';
        btn.innerHTML = `<img src="${s.thumbnail}" alt="" /><span>${escapeHtml(s.name)}</span>`;
        btn.addEventListener('click', () => { close(s.id); });
        el.pickerList.appendChild(btn);
      });
      const close = (value) => {
        el.picker.hidden = true;
        el.pickerCancel.removeEventListener('click', onCancel);
        resolve(value);
      };
      const onCancel = () => close(null);
      el.pickerCancel.addEventListener('click', onCancel);
      el.picker.hidden = false;
    });
  }

  // ── Grade de telas ───────────────────────────────────────
  function addTile(id, label, stream, isLocal = false) {
    removeTile(id);
    const tile = document.createElement('div');
    tile.className = 'tile';
    tile.dataset.peer = id;
    tile.title = 'Clique para ver só esta tela';

    const video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true; // o áudio vem pelos elementos <audio>
    video.srcObject = stream;
    video.play().catch(() => {});

    const tag = document.createElement('div');
    tag.className = 'tile-label';
    tag.textContent = isLocal ? `${label} — compartilhando` : label;

    const hint = document.createElement('div');
    hint.className = 'tile-hint';
    hint.textContent = 'clique para focar';

    tile.append(video, tag, hint);
    tile.addEventListener('click', () => setViewing(viewing === id ? 'todos' : id));

    el.grid.appendChild(tile);
    applyView();
  }

  function removeTile(id) {
    const tile = el.grid.querySelector(`.tile[data-peer="${CSS.escape(String(id))}"]`);
    if (tile) tile.remove();
    if (viewing === id) viewing = 'todos';
    applyView();
  }

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
    el.stageEmpty.hidden = tiles.length > 0;

    // Abas: só fazem sentido com duas ou mais telas.
    if (tiles.length < 2) {
      el.viewBar.hidden = true;
      el.viewBar.innerHTML = '';
      return;
    }

    el.viewBar.hidden = false;
    el.viewBar.innerHTML = '<span class="view-label">Assistindo</span>';
    const abas = [{ id: 'todos', nome: `Todas (${tiles.length})` }]
      .concat(tiles.map((t) => ({ id: t.dataset.peer, nome: peerName(t.dataset.peer) })));

    abas.forEach(({ id, nome }) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'view-tab' + (viewing === id ? ' on' : '');
      btn.textContent = nome;
      btn.addEventListener('click', () => setViewing(id));
      el.viewBar.appendChild(btn);
    });
  }

  // ── Chat ─────────────────────────────────────────────────
  el.chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = el.chatInput.value.trim();
    if (!text) return;
    socket.emit('chat', text);
    el.chatInput.value = '';
  });

  function appendMessage({ id, name, text, ts }) {
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
      { id: myId, name: `${myName} (você)`, muted, deafened, sharing, eu: true },
      ...[...peers.values()].map((p) => ({
        id: p.id, name: p.name, muted: p.muted, deafened: p.deafened,
        sharing: p.sharing, silenciado: p.silenciado,
      })),
    ];
    el.peerCount.textContent = String(all.length);
    el.peers.innerHTML = '';

    all.forEach((p) => {
      const li = document.createElement('li');
      if (p.eu) li.classList.add('self');
      if (speaking.has(p.eu ? 'me' : p.id) && !p.muted && !p.silenciado) li.classList.add('speaking');

      const tags = [
        p.sharing ? '🖥️' : '',
        p.deafened ? '🎧' : '',
        p.muted ? '🔇' : '',
      ].join('');

      li.innerHTML = `
        <span class="avatar" style="background:${colorFor(p.name)}">${escapeHtml(initials(p.name))}</span>
        <span class="peer-name">${escapeHtml(p.name)}</span>
        <span class="peer-tags">${tags}</span>
        <button class="peer-mute${p.silenciado ? ' on' : ''}" type="button" data-id="${p.id}"
                title="${p.silenciado ? 'Voltar a ouvir' : 'Silenciar só para mim'}">
          ${p.silenciado ? '🔇' : '🔊'}
        </button>`;
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
    peers.forEach((_, id) => removePeer(id));
    if (micStream) micStream.getTracks().forEach((t) => t.stop());
    if (socket) socket.disconnect();
    location.reload();
  });

  window.addEventListener('beforeunload', () => {
    if (socket) socket.disconnect();
  });
})();
