// Servidor do jogo: entrega os arquivos e hospeda a sala multiplayer por WebSocket (/ws).
import http from 'node:http';
import os from 'node:os';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Room, TICK } from './src/server/room.js';

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

const server = http.createServer(async (req, res) => {
  let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
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
const room = new Room();
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 2048 });

wss.on('connection', (ws) => {
  let id = -1;
  const conn = { send: (text) => { if (ws.readyState === ws.OPEN) ws.send(text); } };
  ws.on('message', (data) => {
    let m;
    try { m = JSON.parse(data); } catch { return; }
    if (!m || typeof m !== 'object') return;
    if (m.t === 'join' && id < 0) {
      id = room.join(conn, m.name, { bots: m.bots !== false });
      if (id < 0) { conn.send(JSON.stringify({ t: 'full' })); ws.close(); }
      else console.log(`+ ${room.slots[id].name} entrou (${room.humans} conectado(s))`);
    } else if (m.t === 'cmd' && id >= 0) {
      room.onCmd(id, m);
    }
  });
  ws.on('close', () => {
    if (id < 0) return;
    console.log(`- ${room.slots[id].name} saiu`);
    room.leave(id);
    id = -1;
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
  while (acc >= TICK && n++ < 8) { acc -= TICK; room.tick(); }
  if (n >= 8) acc = 0;
}, 1000 / 120);

server.listen(PORT, () => {
  console.log(`Tinta Neles! rodando em http://localhost:${PORT}`);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) console.log(`  na rede local: http://${a.address}:${PORT}`);
  }
});
