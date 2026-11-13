// Sala de jogo do servidor: roda a simulação (autoritativa), preenche as vagas livres com bots
// e manda o estado para cada jogador conectado. Não conhece WebSocket: recebe objetos "conn"
// com um método send(texto), o que permite testar sem rede.
import { Game, CFG } from '../sim/game.js';
import { Nav } from '../sim/nav.js';
import { BotBrain } from '../sim/bot.js';
import { BOT_NAMES, PLAYER_COLORS } from '../sim/roster.js';

export const TICK = 1 / 60;
const SNAP_EVERY = 2;      // manda estado a cada 2 ticks (30 vezes por segundo)
const INTERMISSION = 12;   // segundos de placar entre partidas
const EMPTY = { seq: 0, mx: 0, mz: 0, yaw: 0, pitch: 0, jump: false, fire: false };
const r2 = (v) => Math.round(v * 100) / 100;
const num = (v, lo, hi) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : 0);

export class Room {
  constructor({ slots = 8, matchTime = CFG.matchTime, skill = 'normal' } = {}) {
    this.matchTime = matchTime; this.skill = skill;
    this.useBots = true; // quem abre a sala (primeiro a entrar) escolhe
    this.slots = [];
    for (let i = 0; i < slots; i++) this.slots.push({ name: '', color: PLAYER_COLORS[i % PLAYER_COLORS.length], conn: null });
    for (const s of this.slots) s.name = this.freeBotName();
    this.nav = null;
    this.newMatch();
  }

  get humans() { return this.slots.reduce((n, s) => n + (s.conn ? 1 : 0), 0); }

  freeBotName() {
    const used = new Set(this.slots.map((s) => s.name));
    const free = BOT_NAMES.filter((n) => !used.has(n));
    return free[Math.floor(Math.random() * free.length)] || 'Bot';
  }

  roster() {
    return {
      players: this.slots.map((s) => ({ name: s.name, color: s.color, isBot: !s.conn, out: !s.conn && !this.useBots })),
      matchTime: this.matchTime, bots: this.useBots,
    };
  }

  broadcast(obj) {
    const text = JSON.stringify(obj);
    for (const s of this.slots) if (s.conn) s.conn.send(text);
  }

  newMatch() {
    this.game = new Game({ seed: (Date.now() & 0xffffff) || 1, matchTime: this.matchTime });
    if (!this.nav) this.nav = new Nav(this.game.map);
    this.bots = []; this.queues = []; this.last = []; this.cmds = [];
    this.slots.forEach((s, id) => {
      const p = this.game.addPlayer({ name: s.name, isBot: !s.conn, color: s.color });
      const bot = !s.conn && this.useBots;
      if (!s.conn && !this.useBots) this.game.setOut(p, true);
      this.bots[id] = bot ? new BotBrain(this.game, this.nav, id, this.skill) : null;
      this.queues[id] = []; this.last[id] = EMPTY;
    });
    this.phase = 'playing'; this.wait = 0; this.ticks = 0; this.pendingEvents = [];
    this.broadcast({ t: 'start', ...this.roster() });
  }

  // Jogador entra no lugar de um bot. Devolve o id da vaga, ou -1 se a sala está cheia.
  // Quem entra numa sala vazia decide se ela tem bots; a escolha vale até a sala esvaziar.
  join(conn, name, { bots = true } = {}) {
    const id = this.slots.findIndex((s) => !s.conn);
    if (id < 0) return -1;
    if (this.humans === 0) {
      this.useBots = !!bots;
      this.newMatch(); // sala estava parada: começa uma partida nova já com a escolha
    }
    const slot = this.slots[id];
    slot.conn = conn;
    slot.name = String(name || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 12) || `Jogador ${id + 1}`;
    const p = this.game.players[id];
    p.name = slot.name; p.isBot = false; p.out = false;
    p.score = p.hits = p.kos = p.deaths = p.thrown = 0;
    this.bots[id] = null; this.queues[id] = []; this.last[id] = EMPTY;
    if (!this.game.ended) this.game.respawn(p);
    conn.send(JSON.stringify({ t: 'welcome', id, ...this.roster() }));
    for (const s of this.slots) if (s.conn && s.conn !== conn) s.conn.send(JSON.stringify({ t: 'roster', ...this.roster() }));
    return id;
  }

  // Jogador saiu: a vaga volta a ser um bot.
  leave(id) {
    const slot = this.slots[id];
    if (!slot || !slot.conn) return;
    slot.conn = null;
    slot.name = this.freeBotName();
    const p = this.game.players[id];
    p.name = slot.name; p.isBot = true;
    if (this.useBots) this.bots[id] = new BotBrain(this.game, this.nav, id, this.skill);
    else this.game.setOut(p, true);
    this.broadcast({ t: 'roster', ...this.roster() });
  }

  onCmd(id, m) {
    const q = this.queues[id];
    if (!q || !this.slots[id].conn) return;
    q.push({
      seq: Number.isInteger(m.seq) ? m.seq : 0,
      mx: num(m.mx, -1, 1), mz: num(m.mz, -1, 1),
      yaw: num(m.yaw, -1e6, 1e6), pitch: num(m.pitch, -1.5, 1.5),
      jump: !!m.jump, fire: !!m.fire,
    });
  }

  // Um tick de 1/60 s. Sem ninguém conectado a sala fica parada.
  tick() {
    if (this.humans === 0) return;
    if (this.phase === 'intermission') {
      this.wait -= TICK;
      if (this.wait <= 0) this.newMatch();
      return;
    }
    const g = this.game;
    for (let id = 0; id < this.slots.length; id++) {
      if (this.bots[id]) { this.cmds[id] = this.bots[id].think(TICK); continue; }
      if (!this.slots[id].conn) { this.cmds[id] = EMPTY; continue; } // vaga vazia
      const q = this.queues[id];
      if (q.length > 8) q.splice(0, q.length - 2); // cliente adiantado: descarta o excesso
      if (q.length) this.last[id] = q.shift();
      this.cmds[id] = this.last[id];
    }
    g.step(TICK, this.cmds);
    for (const e of g.events) this.pendingEvents.push(e);
    g.events.length = 0;
    this.ticks++;
    if (g.ended) { this.phase = 'intermission'; this.wait = INTERMISSION; }
    if (this.ticks % SNAP_EVERY === 0 || g.ended) this.sendSnapshots();
  }

  sendSnapshots() {
    const g = this.game;
    const common = {
      time: Math.round(g.timeLeft * 10) / 10, ended: g.ended, wait: g.ended ? INTERMISSION : 0,
      p: g.players.map((p) => [
        r2(p.x), r2(p.y), r2(p.z), r2(p.vx), r2(p.vz), r2(p.yaw), r2(p.pitch),
        (p.alive ? 1 : 0) | (p.onGround ? 2 : 0) | (p.charging ? 4 : 0) | (p.invuln > 0 ? 8 : 0) | (p.out ? 16 : 0),
        p.hp, r2(p.charge), r2(Math.max(0, p.respawnT)), p.ammo.length, p.ammo.length ? p.ammo[0] : 0,
        p.score, p.hits, p.kos, p.deaths,
      ]),
      b: g.balloons.map((b) => [b.id, b.color, r2(b.x), r2(b.y), r2(b.z)]),
      bags: g.bags.reduce((m, b) => m | (b.active ? 1 << b.id : 0), 0),
      shirts: g.shirts.reduce((m, s) => m | (s.active ? 1 << s.id : 0), 0),
      ev: this.pendingEvents,
    };
    const tail = JSON.stringify(common).slice(1);
    this.pendingEvents = [];
    this.slots.forEach((s, id) => {
      if (!s.conn) return;
      const p = g.players[id];
      // estado exato do próprio jogador, para o cliente conferir a previsão dele
      const you = { ack: this.last[id].seq, x: p.x, y: p.y, z: p.z, vx: p.vx, vy: p.vy, vz: p.vz, cd: p.cooldown, charge: p.charge, ammo: p.ammo.slice(0, 7) };
      s.conn.send(`{"t":"snap","you":${JSON.stringify(you)},${tail}`);
    });
  }
}
