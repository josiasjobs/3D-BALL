// Servidor do jogo: entrega os arquivos e hospeda a sala multiplayer por WebSocket (/ws).
import http from 'node:http';
import os from 'node:os';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { TICK } from './src/server/room.js';
import { Lobby } from './src/server/lobby.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 5173;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
};

const lobby = new Lobby();

const server = http.createServer(async (req, res) => {
  let rel;
  try { rel = decodeURIComponent(new URL(req.url, 'http://x').pathname); }
  catch { res.writeHead(400).end(); return; } // URL malformada não pode derrubar o servidor (e todas as salas)
  if (rel === '/api/rooms') { // salas públicas para a lista do menu
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(lobby.list()));
    return;
  }
  if (rel === '/') rel = '/index.html';
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403).end(); return; }
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  } catch {
    res.writeHead(404).end('Não encontrado');
  }
});

// ---------- multiplayer ----------
// Cada conexão cria uma sala ({t:'create'}) ou entra numa pelo código ({t:'join'}).
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 2048 });

wss.on('connection', (ws) => {
  let room = null, id = -1;
  const conn = { send: (text) => { if (ws.readyState === ws.OPEN) ws.send(text); } };
  ws.on('message', (data) => {
    let m;
    try { m = JSON.parse(data); } catch { return; }
    if (!m || typeof m !== 'object') return;
    if ((m.t === 'create' || m.t === 'join') && !room) {
      const r = m.t === 'create'
        ? lobby.create(conn, m.name, { bots: m.bots, skill: m.skill, isPublic: m.public !== false })
        : lobby.join(conn, m.name, m.code);
      if (r.error) { conn.send(JSON.stringify({ t: 'error', reason: r.error })); ws.close(); return; }
      room = r.room; id = r.id;
      console.log(`+ ${room.slots[id].name} ${m.t === 'create' ? 'criou' : 'entrou em'} ${room.code} (${room.humans} na sala, ${lobby.rooms.size} sala(s))`);
    } else if (m.t === 'cmd' && room) {
      room.onCmd(id, m);
    }
  });
  ws.on('close', () => {
    if (!room) return;
    console.log(`- ${room.slots[id].name} saiu de ${room.code}`);
    lobby.leave(room, id);
    room = null; id = -1;
  });
  ws.on('error', () => {});
});

// laço de simulação em passo fixo
let last = performance.now(), acc = 0;
setInterval(() => {
  const now = performance.now();
  acc += Math.min(0.25, (now - last) / 1000);
  last = now;
  let n = 0;
  while (acc >= TICK && n++ < 8) { acc -= TICK; lobby.tick(); }
  if (n >= 8) acc = 0;
}, 1000 / 120);

server.listen(PORT, () => {
  console.log(`Tinta Neles! rodando em http://localhost:${PORT}`);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) console.log(`  na rede local: http://${a.address}:${PORT}`);
  }
});
