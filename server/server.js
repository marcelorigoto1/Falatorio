/**
 * Falatorio - servidor de sinalizacao.
 *
 * Ele NAO transporta audio nem video: as chamadas sao P2P (WebRTC) entre os
 * navegadores/apps. Aqui so passam mensagens de texto e os "apertos de mao"
 * (SDP + ICE) necessarios para os pares se acharem.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');
const musica = require('./musica');

// ── Segredos ──────────────────────────────────────────────
// A senha NUNCA fica no código. Ela vem de uma variável de ambiente
// (no Render: Environment → ROOM_PASSWORD) ou de um arquivo .env local,
// que o .gitignore mantém fora do repositório.
function loadDotEnv() {
  const file = path.join(__dirname, '.env');
  if (!fs.existsSync(file)) return;
  for (const linha of fs.readFileSync(file, 'utf8').split('\n')) {
    const limpa = linha.trim();
    if (!limpa || limpa.startsWith('#')) continue;
    const i = limpa.indexOf('=');
    if (i < 1) continue;
    const chave = limpa.slice(0, i).trim();
    const valor = limpa.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    if (!(chave in process.env)) process.env[chave] = valor;
  }
}
loadDotEnv();

const PORT = process.env.PORT || 3000;
const ROOM = 'geral';
const MAX_USERS = Number(process.env.MAX_USERS || 12);
const ROOM_PASSWORD = String(process.env.ROOM_PASSWORD || '').trim();

/** Comparação de tamanho constante: não entrega dicas pelo tempo de resposta. */
function senhaConfere(enviada) {
  const a = Buffer.from(String(enviada || ''));
  const b = Buffer.from(ROOM_PASSWORD);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// Freio contra tentativa e erro: por IP, 8 erros travam a porta por 10 minutos.
const MAX_TENTATIVAS = 8;
const CASTIGO_MS = 10 * 60 * 1000;
const tentativas = new Map(); // ip -> { erros, ate }

function estaBloqueado(ip) {
  const t = tentativas.get(ip);
  if (!t) return 0;
  if (t.ate && t.ate > Date.now()) return Math.ceil((t.ate - Date.now()) / 60000);
  if (t.ate && t.ate <= Date.now()) tentativas.delete(ip);
  return 0;
}

function registrarErro(ip) {
  const t = tentativas.get(ip) || { erros: 0, ate: 0 };
  t.erros += 1;
  if (t.erros >= MAX_TENTATIVAS) t.ate = Date.now() + CASTIGO_MS;
  tentativas.set(ip, t);
}

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.get('/healthz', (_req, res) => res.json({ ok: true, online: users.size }));

// A interface pergunta aqui se precisa mostrar o campo de senha.
app.get('/config', (_req, res) => res.json({
  precisaSenha: ROOM_PASSWORD.length > 0,
  buscaDeMusica: musica.temChave(),
}));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

/** @type {Map<string, {id:string,name:string,muted:boolean,sharing:boolean}>} */
const users = new Map();

const publicUser = (u) => ({
  id: u.id, name: u.name, muted: u.muted, sharing: u.sharing,
  deafened: u.deafened, sharingAudio: u.sharingAudio, camera: u.camera,
});

function sanitizeName(raw) {
  const name = String(raw || '').replace(/\s+/g, ' ').trim().slice(0, 24);
  return name || 'Anonimo';
}

io.on('connection', (socket) => {
  socket.on('join', (payload = {}, ack) => {
    if (users.has(socket.id)) return;
    const responder = (r) => { if (typeof ack === 'function') ack(r); };
    const ip = socket.handshake.address;

    if (ROOM_PASSWORD) {
      const minutos = estaBloqueado(ip);
      if (minutos) {
        responder({ error: `Muitas tentativas. Tente de novo em ${minutos} min.` });
        return;
      }
      if (!senhaConfere(payload.password)) {
        registrarErro(ip);
        // Pequena espera: torna a tentativa em massa inviável.
        setTimeout(() => responder({ error: 'Senha incorreta.', precisaSenha: true }), 600);
        return;
      }
      tentativas.delete(ip);
    }

    if (users.size >= MAX_USERS) {
      responder({ error: `Sala cheia (limite de ${MAX_USERS}).` });
      return;
    }

    const user = {
      id: socket.id,
      name: sanitizeName(payload.name),
      muted: !!payload.muted,
      deafened: !!payload.deafened,
      sharing: false,
      sharingAudio: false,
      camera: false,
    };
    users.set(socket.id, user);
    socket.join(ROOM);

    responder({
      id: socket.id,
      peers: [...users.values()].filter((u) => u.id !== socket.id).map(publicUser),
    });

    // Quem chega já recebe a música no ponto exato em que ela está.
    socket.emit('musica:estado', musica.publico());

    socket.to(ROOM).emit('peer-joined', publicUser(user));
    io.to(ROOM).emit('system', `${user.name} entrou na sala`);
  });

  // Relay puro de SDP/ICE entre dois pares.
  socket.on('signal', ({ to, description, candidate } = {}) => {
    if (!users.has(socket.id) || !users.has(to)) return;
    io.to(to).emit('signal', { from: socket.id, description, candidate });
  });

  socket.on('chat', (raw) => {
    const user = users.get(socket.id);
    if (!user) return;
    const text = String(raw || '').slice(0, 2000).trim();
    if (!text) return;
    io.to(ROOM).emit('chat', { id: user.id, name: user.name, text, ts: Date.now() });
  });

  socket.on('state', (state = {}) => {
    const user = users.get(socket.id);
    if (!user) return;
    user.muted = !!state.muted;
    user.deafened = !!state.deafened;
    user.sharing = !!state.sharing;
    user.sharingAudio = !!state.sharingAudio;
    user.camera = !!state.camera;
    io.to(ROOM).emit('peer-state', publicUser(user));
  });

  // ── Música ──────────────────────────────────────────────
  const avisarMusica = () => io.to(ROOM).emit('musica:estado', musica.publico());
  const naSala = () => users.has(socket.id);

  socket.on('musica:buscar', async (termo, ack) => {
    if (!naSala() || typeof ack !== 'function') return;
    ack(await musica.buscar(termo));
  });

  socket.on('musica:add', (item, ack) => {
    const user = users.get(socket.id);
    if (!user || !item || !item.videoId) return;
    const r = musica.adicionar(item, user.name);
    if (typeof ack === 'function') ack(r);
    if (r.ok) {
      avisarMusica();
      io.to(ROOM).emit('system', `${user.name} colocou "${r.entrada.titulo}" na fila`);
    }
  });

  socket.on('musica:pular', () => {
    const user = users.get(socket.id);
    if (!user) return;
    const antes = musica.publico().atual;
    musica.pular();
    avisarMusica();
    if (antes) io.to(ROOM).emit('system', `${user.name} pulou "${antes.titulo}"`);
  });

  socket.on('musica:pausar', (valor) => {
    if (!naSala()) return;
    musica.pausar(valor);
    avisarMusica();
  });

  socket.on('musica:seek', (segundos) => {
    if (!naSala()) return;
    musica.irPara(segundos);
    avisarMusica();
  });

  socket.on('musica:remover', (id) => {
    if (!naSala()) return;
    musica.remover(id);
    avisarMusica();
  });

  socket.on('musica:limpar', () => {
    if (!naSala()) return;
    musica.limpar();
    avisarMusica();
  });

  // O player de cada pessoa avisa quando o vídeo acaba; o servidor confere
  // se realmente acabou antes de passar para a próxima.
  socket.on('musica:fim', (videoId) => {
    if (!naSala()) return;
    if (musica.terminou(videoId)) avisarMusica();
  });

  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    if (!user) return;
    users.delete(socket.id);
    socket.to(ROOM).emit('peer-left', { id: user.id });
    io.to(ROOM).emit('system', `${user.name} saiu da sala`);

    // Sala vazia: a fila de música é zerada. Sem isso, quem entrasse horas
    // depois cairia no meio da música que o pessoal deixou tocando.
    if (users.size === 0) musica.limpar();
  });
});

// Batida de sincronia: de tempos em tempos o servidor diz onde a música
// está, e cada player corrige a defasagem se tiver escorregado.
setInterval(() => {
  const estado = musica.publico();
  if (!estado.atual || estado.pausado || users.size === 0) return;
  io.to(ROOM).emit('musica:tique', { videoId: estado.atual.videoId, posicao: estado.posicao });
}, 5000);

server.listen(PORT, () => {
  console.log(`Falatorio ouvindo em http://localhost:${PORT}`);
  console.log(ROOM_PASSWORD
    ? 'Sala protegida por senha (ROOM_PASSWORD definida).'
    : 'ATENCAO: sala aberta, sem senha. Defina ROOM_PASSWORD para exigir senha.');
});
