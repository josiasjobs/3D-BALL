// Cliente de rede. Imita a interface de Game (players, balloons, bags, events...) para que
// render, HUD e som funcionem igual ao modo local. O servidor manda o estado 30x por segundo;
// os outros jogadores são interpolados e o jogador local é previsto na hora e conferido depois.
import { Game, CFG } from './sim/game.js';

const STEP = 1 / 60;
const SNAP_MS = 1000 / 30;
const lerp = (a, b, t) => a + (b - a) * t;
const wrap = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };

function blankPlayer(id) {
  return {
    id, name: '', color: 0xffffff, isBot: true,
    x: 0, y: 0, z: 0, px: 0, py: 0, pz: 0, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, onGround: true,
    hp: CFG.maxHp, alive: true, respawnT: 0, invuln: 0, ammo: [], charge: 0, charging: false, cooldown: 0,
    score: 0, hits: 0, kos: 0, deaths: 0, out: false,
    sx: 0, sy: 0, sz: 0, tx: 0, ty: 0, tz: 0, syaw: 0, tyaw: 0, spitch: 0, tpitch: 0, has: false, ammoKey: '',
  };
}

export class NetGame {
  constructor() {
    this.helper = new Game(); // só para a física do jogador local e o mapa
    this.map = this.helper.map;
    this.players = []; this.balloons = []; this.balloonById = new Map();
    this.bags = this.map.bagSpots.map((s, id) => ({ id, x: s[0], y: s[1], z: s[2], active: true }));
    this.shirts = this.map.shirtSpots.map((s, id) => ({ id, x: s[0], y: s[1], z: s[2], active: true }));
    this.events = [];
    this.timeLeft = 0; this.ended = false; this.wait = 0; this.endedAt = 0;
    this.localId = -1; this.seq = 0; this.pending = []; this.pred = null; this.snapAt = 0;
    this.ws = null; this.bots = true;
    this.onStart = null; this.onRoster = null; this.onClose = null; this.onLocalThrow = null;
  }

  connect(name, bots = true) {
    return new Promise((resolve, reject) => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}/ws`);
      this.ws = ws;
      let joined = false;
      ws.onopen = () => ws.send(JSON.stringify({ t: 'join', name, bots }));
      ws.onmessage = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.t === 'welcome') {
          this.localId = m.id;
          this.setRoster(m.players);
          this.timeLeft = m.matchTime;
          this.bots = m.bots;
          joined = true;
          resolve();
        } else if (m.t === 'full') {
          reject(new Error('A sala está cheia (8 jogadores).'));
        } else if (m.t === 'roster') {
          this.setRoster(m.players);
          if (this.onRoster) this.onRoster();
        } else if (m.t === 'start') {
          this.setRoster(m.players);
          this.reset();
          if (this.onStart) this.onStart();
        } else if (m.t === 'snap') {
          this.onSnap(m);
        }
      };
      ws.onerror = () => { if (!joined) reject(new Error('Não foi possível conectar ao servidor.')); };
      ws.onclose = () => {
        if (!joined) reject(new Error('Não foi possível conectar ao servidor.'));
        else if (this.onClose) this.onClose();
      };
    });
  }

  close() {
    if (this.ws) { this.ws.onclose = null; this.ws.close(); this.ws = null; }
  }

  reset() {
    this.ended = false; this.wait = 0;
    this.events.length = 0; this.balloons = []; this.balloonById.clear();
    this.pending.length = 0;
    for (const p of this.players) { p.has = false; p.score = p.hits = p.kos = p.deaths = 0; p.hp = CFG.maxHp; p.alive = true; }
  }

  setRoster(list) {
    list.forEach((r, id) => {
      const p = this.players[id] || (this.players[id] = blankPlayer(id));
      p.name = r.name; p.color = r.color; p.isBot = r.isBot; p.out = !!r.out;
    });
    this.players.length = list.length;
    if (!this.pred) this.pred = blankPlayer(this.localId);
  }

  ranking() {
    return this.players.filter((p) => !p.out).sort((a, b) => b.score - a.score || b.kos - a.kos || a.deaths - b.deaths || a.id - b.id);
  }

  launch(p, charge) { return this.helper.launch(p, charge); }

  // Um tick local do jogador: mesmo código de movimento do servidor.
  predict(c, live) {
    const pr = this.pred;
    this.helper.movePlayer(pr, c, STEP);
    if (this.helper.chargeStep(pr, c, STEP)) {
      pr.ammo.shift();
      pr.charging = false; pr.charge = 0; pr.cooldown = CFG.cooldown;
      if (live && this.onLocalThrow) this.onLocalThrow();
    }
  }

  // Chamado 60x por segundo com o comando do jogador.
  tick(cmd) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const c = { seq: ++this.seq, mx: cmd.mx, mz: cmd.mz, yaw: cmd.yaw, pitch: cmd.pitch, jump: cmd.jump, fire: cmd.fire };
    this.ws.send(JSON.stringify({ t: 'cmd', ...c }));
    const me = this.players[this.localId];
    if (!me || !me.alive || this.ended) return;
    this.pending.push(c);
    if (this.pending.length > 120) this.pending.shift();
    this.predict(c, true);
  }

  onSnap(m) {
    const now = performance.now();
    m.p.forEach((a, id) => {
      const p = this.players[id];
      if (!p) return;
      const alive = !!(a[7] & 1);
      p.hp = a[8]; p.respawnT = a[10]; p.invuln = a[7] & 8 ? 1 : 0; p.out = !!(a[7] & 16);
      p.score = a[13]; p.hits = a[14]; p.kos = a[15]; p.deaths = a[16];
      if (id === this.localId) {
        p.alive = alive;
        p.yaw = a[5]; // depois de renascer, é o servidor que diz para onde olhar
        p.ammo = m.you.ammo.slice();
        while (p.ammo.length < a[11]) p.ammo.push(p.ammo[p.ammo.length - 1] ?? 0);
        // confere a previsão: volta ao estado do servidor e refaz os comandos ainda não confirmados
        const pr = this.pred, y = m.you;
        pr.x = y.x; pr.y = y.y; pr.z = y.z; pr.px = y.x; pr.py = y.y; pr.pz = y.z;
        pr.vx = y.vx; pr.vy = y.vy; pr.vz = y.vz;
        pr.onGround = !!(a[7] & 2); pr.charging = !!(a[7] & 4); pr.charge = y.charge; pr.cooldown = y.cd;
        pr.ammo = p.ammo;
        while (this.pending.length && this.pending[0].seq <= y.ack) this.pending.shift();
        if (alive) for (const c of this.pending) this.predict(c, false);
        else this.pending.length = 0;
        return;
      }
      // outros jogadores: guarda de onde e para onde interpolar
      const far = (a[0] - p.x) ** 2 + (a[2] - p.z) ** 2 > 9;
      if (!p.has || far || alive !== p.alive) { p.sx = a[0]; p.sy = a[1]; p.sz = a[2]; p.syaw = a[5]; p.spitch = a[6]; }
      else { p.sx = p.x; p.sy = p.y; p.sz = p.z; p.syaw = p.yaw; p.spitch = p.pitch; }
      p.tx = a[0]; p.ty = a[1]; p.tz = a[2]; p.tyaw = a[5]; p.tpitch = a[6];
      p.vx = a[3]; p.vz = a[4];
      p.alive = alive; p.onGround = !!(a[7] & 2); p.charging = !!(a[7] & 4); p.charge = a[9];
      const key = a[11] + ':' + a[12];
      if (key !== p.ammoKey) { p.ammoKey = key; p.ammo = new Array(a[11]).fill(a[12]); }
      p.has = true;
    });

    const seen = new Set();
    for (const a of m.b) {
      let b = this.balloonById.get(a[0]);
      if (!b) {
        b = { id: a[0], color: a[1], x: a[2], y: a[3], z: a[4], px: a[2], py: a[3], pz: a[4], sx: a[2], sy: a[3], sz: a[4] };
        this.balloonById.set(a[0], b);
      } else { b.sx = b.x; b.sy = b.y; b.sz = b.z; }
      b.tx = a[2]; b.ty = a[3]; b.tz = a[4];
      seen.add(a[0]);
    }
    for (const id of this.balloonById.keys()) if (!seen.has(id)) this.balloonById.delete(id);
    this.balloons = [...this.balloonById.values()];

    for (const b of this.bags) b.active = !!(m.bags & (1 << b.id));
    for (const s of this.shirts) s.active = !!(m.shirts & (1 << s.id));
    this.timeLeft = m.time;
    if (m.ended && !this.ended) { this.wait = m.wait; this.endedAt = now; }
    this.ended = m.ended;
    // o próprio arremesso já foi mostrado na hora, pela previsão
    for (const e of m.ev) if (!(e.type === 'throw' && e.owner === this.localId)) this.events.push(e);
    this.snapAt = now;
  }

  // Antes de desenhar: calcula a posição de cada coisa neste instante.
  frame(alphaLocal) {
    const a = Math.max(0, Math.min(1, (performance.now() - this.snapAt) / SNAP_MS));
    for (const p of this.players) {
      if (p.id === this.localId) {
        const pr = this.pred;
        p.x = lerp(pr.px, pr.x, alphaLocal); p.y = lerp(pr.py, pr.y, alphaLocal); p.z = lerp(pr.pz, pr.z, alphaLocal);
        p.vx = pr.vx; p.vy = pr.vy; p.vz = pr.vz;
        p.onGround = pr.onGround; p.charging = pr.charging; p.charge = pr.charge; p.pitch = pr.pitch;
      } else {
        p.x = lerp(p.sx, p.tx, a); p.y = lerp(p.sy, p.ty, a); p.z = lerp(p.sz, p.tz, a);
        p.yaw = p.syaw + wrap(p.tyaw - p.syaw) * a;
        p.pitch = lerp(p.spitch, p.tpitch, a);
      }
      p.px = p.x; p.py = p.y; p.pz = p.z;
    }
    for (const b of this.balloons) {
      b.x = lerp(b.sx, b.tx, a); b.y = lerp(b.sy, b.ty, a); b.z = lerp(b.sz, b.tz, a);
      b.px = b.x; b.py = b.y; b.pz = b.z;
    }
  }

  // segundos até a próxima partida (depois do fim)
  nextIn() { return Math.max(0, Math.ceil(this.wait - (performance.now() - this.endedAt) / 1000)); }
}
