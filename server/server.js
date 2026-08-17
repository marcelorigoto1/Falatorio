/**
 * Falatorio - servidor de sinalizacao.
 *
 * Ele NAO transporta audio nem video: as chamadas sao P2P (WebRTC) entre os
 * navegadores/apps. Aqui so passam mensagens de texto e os "apertos de mao"
 * (SDP + ICE) necessarios para os pares se acharem.
 */
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const ROOM = 'geral';
const MAX_USERS = Number(process.env.MAX_USERS || 12);

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.get('/healthz', (_req, res) => res.json({ ok: true, online: users.size }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

/** @type {Map<string, {id:string,name:string,muted:boolean,sharing:boolean}>} */
const users = new Map();

const publicUser = (u) => ({ id: u.id, name: u.name, muted: u.muted, sharing: u.sharing });

function sanitizeName(raw) {
  const name = String(raw || '').replace(/\s+/g, ' ').trim().slice(0, 24);
  return name || 'Anonimo';
}

io.on('connection', (socket) => {
  socket.on('join', (payload = {}, ack) => {
    if (users.has(socket.id)) return;

    if (users.size >= MAX_USERS) {
      if (typeof ack === 'function') ack({ error: `Sala cheia (limite de ${MAX_USERS}).` });
      return;
    }

    const user = {
      id: socket.id,
      name: sanitizeName(payload.name),
      muted: !!payload.muted,
      sharing: false,
    };
    users.set(socket.id, user);
    socket.join(ROOM);

    if (typeof ack === 'function') {
      ack({
        id: socket.id,
        peers: [...users.values()].filter((u) => u.id !== socket.id).map(publicUser),
      });
    }

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
    user.sharing = !!state.sharing;
    io.to(ROOM).emit('peer-state', publicUser(user));
  });

  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    if (!user) return;
    users.delete(socket.id);
    socket.to(ROOM).emit('peer-left', { id: user.id });
    io.to(ROOM).emit('system', `${user.name} saiu da sala`);
  });
});

server.listen(PORT, () => {
  console.log(`Falatorio ouvindo em http://localhost:${PORT}`);
});
