// Simulação do jogo. Sem Three.js e sem DOM: roda igual no navegador e em Node,
// para no futuro virar o servidor autoritativo do multiplayer.
//
// Cada jogador (humano, bot ou, depois, remoto) é movido por um "comando":
//   { mx, mz, yaw, pitch, jump, fire }
// mx/mz = andar de lado/para frente (-1..1); fire = botão de arremesso segurado.
import { buildMap, segAABB, clearLine, PALETTE } from './map.js';

export const CFG = {
  speed: 6.2, jump: 6.5, gravity: 20,
  radius: 0.4, height: 1.8, eye: 1.6, step: 0.35,
  bagSize: 20, maxHp: 3, respawn: 3, invuln: 2,
  chargeTime: 0.8, minPow: 11, maxPow: 26, cooldown: 0.4,
  balloonG: 14, balloonR: 0.14, splash: 1.2,
  bagRespawn: 12, shirtRespawn: 25, matchTime: 240,
};

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const throwPower = (charge) => CFG.minPow + (CFG.maxPow - CFG.minPow) * charge;

const EMPTY_CMD = { mx: 0, mz: 0, yaw: 0, pitch: 0, jump: false, fire: false };

export class Game {
  constructor({ seed = 1, matchTime = CFG.matchTime } = {}) {
    this.map = buildMap();
    this.rng = mulberry32(seed);
    this.players = [];
    this.balloons = [];
    this.bags = this.map.bagSpots.map((s, id) => ({ id, x: s[0], y: s[1], z: s[2], active: true, timer: 0 }));
    this.shirts = this.map.shirtSpots.map((s, id) => ({ id, x: s[0], y: s[1], z: s[2], active: true, timer: 0 }));
    this.events = []; // quem consome (render/áudio/HUD) esvazia
    this.timeLeft = matchTime;
    this.ended = false;
    this.nextBalloonId = 1;
  }

  addPlayer({ name, isBot = false, color = 0xffffff }) {
    const id = this.players.length;
    const p = {
      id, name, isBot, color,
      x: 0, y: 0, z: 0, px: 0, py: 0, pz: 0,
      vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, onGround: true,
      hp: CFG.maxHp, alive: true, respawnT: 0, invuln: CFG.invuln,
      ammo: [], charge: 0, charging: false, cooldown: 0,
      score: 0, hits: 0, kos: 0, deaths: 0, thrown: 0,
    };
    this.players.push(p);
    const s = this.map.spawns[id % this.map.spawns.length];
    this.placeAt(p, s);
    return p;
  }

  fillBag(p) {
    while (p.ammo.length < CFG.bagSize) p.ammo.push(Math.floor(this.rng() * PALETTE.length));
  }

  placeAt(p, s) {
    p.x = p.px = s[0]; p.z = p.pz = s[1]; p.y = p.py = 0;
    p.vx = p.vy = p.vz = 0;
    p.yaw = Math.atan2(p.x, p.z); // olhando para o centro
    p.pitch = 0;
    p.hp = CFG.maxHp; p.alive = true; p.invuln = CFG.invuln;
    p.charge = 0; p.charging = false; p.cooldown = 0;
    p.ammo.length = 0;
    this.fillBag(p);
  }

  respawn(p) {
    // ponto de nascimento mais longe dos adversários
    let best = this.map.spawns[0], bd = -1;
    for (const s of this.map.spawns) {
      let near = Infinity;
      for (const o of this.players) {
        if (o === p || !o.alive) continue;
        near = Math.min(near, (o.x - s[0]) ** 2 + (o.z - s[1]) ** 2);
      }
      near += this.rng() * 20;
      if (near > bd) { bd = near; best = s; }
    }
    this.placeAt(p, best);
    this.events.push({ type: 'respawn', id: p.id, yaw: p.yaw });
  }

  step(dt, cmds) {
    if (this.ended) return;
    for (const p of this.players) this.stepPlayer(p, (cmds && cmds[p.id]) || EMPTY_CMD, dt);
    for (const b of this.balloons) this.stepBalloon(b, dt);
    if (this.balloons.some((b) => b.dead)) this.balloons = this.balloons.filter((b) => !b.dead);
    for (const bag of this.bags) this.stepBag(bag, dt);
    for (const sh of this.shirts) this.stepShirt(sh, dt);
    this.timeLeft -= dt;
    if (this.timeLeft <= 0) {
      this.timeLeft = 0;
      this.ended = true;
      this.events.push({ type: 'end' });
    }
  }

  ranking() {
    return [...this.players].sort((a, b) => b.score - a.score || b.kos - a.kos || a.deaths - b.deaths || a.id - b.id);
  }

  // ---------- jogadores ----------
  stepPlayer(p, cmd, dt) {
    p.px = p.x; p.py = p.y; p.pz = p.z;
    if (!p.alive) {
      p.respawnT -= dt;
      if (p.respawnT <= 0) this.respawn(p);
      return;
    }
    if (p.invuln > 0) p.invuln -= dt;
    this.movePlayer(p, cmd, dt);
    if (this.chargeStep(p, cmd, dt)) this.throwBalloon(p);
  }

  // Movimento de um jogador por um tick. Não cria nada no jogo, então o cliente
  // de rede também usa isto para prever o próprio movimento sem esperar o servidor.
  movePlayer(p, cmd, dt) {
    p.px = p.x; p.py = p.y; p.pz = p.z;
    p.yaw = cmd.yaw;
    p.pitch = Math.max(-1.5, Math.min(1.5, cmd.pitch));

    let mx = cmd.mx, mz = cmd.mz;
    const ml = Math.hypot(mx, mz);
    if (ml > 1) { mx /= ml; mz /= ml; }
    const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
    const sp = CFG.speed * (p.charging ? 0.8 : 1);
    const tx = (-sy * mz + cy * mx) * sp;
    const tz = (-cy * mz - sy * mx) * sp;
    const k = 1 - Math.exp(-(p.onGround ? 14 : 3) * dt);
    p.vx += (tx - p.vx) * k;
    p.vz += (tz - p.vz) * k;

    const wasGround = p.onGround;
    let jumped = false;
    if (cmd.jump && p.onGround) { p.vy = CFG.jump; p.onGround = false; jumped = true; }
    p.vy -= CFG.gravity * dt;
    p.x += p.vx * dt; p.z += p.vz * dt; p.y += p.vy * dt;

    this.collidePlayer(p);

    const lim = this.map.half - CFG.radius;
    p.x = Math.max(-lim, Math.min(lim, p.x));
    p.z = Math.max(-lim, Math.min(lim, p.z));

    const gy = this.groundUnder(p);
    const snapDown = wasGround && !jumped && gy >= p.y - CFG.step;
    if (p.y <= gy || snapDown) {
      p.y = gy; p.vy = 0; p.onGround = true;
    } else {
      p.onGround = false;
    }

  }

  // Arremesso: segura para carregar, solta para lançar. Devolve true no tick do lançamento.
  chargeStep(p, cmd, dt) {
    if (p.cooldown > 0) p.cooldown -= dt;
    if (cmd.fire && p.ammo.length > 0 && p.cooldown <= 0) {
      p.charging = true;
      p.charge = Math.min(1, p.charge + dt / CFG.chargeTime);
    } else if (p.charging) {
      const thrown = !cmd.fire && p.ammo.length > 0;
      if (!thrown) { p.charging = false; p.charge = 0; p.cooldown = CFG.cooldown; }
      return thrown;
    }
    return false;
  }

  collidePlayer(p) {
    const r = CFG.radius, boxes = this.map.boxes;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < boxes.length; i++) {
        const b = boxes[i];
        if (b.max[1] <= p.y + CFG.step || b.min[1] >= p.y + CFG.height) continue;
        const qx = Math.max(b.min[0], Math.min(b.max[0], p.x));
        const qz = Math.max(b.min[2], Math.min(b.max[2], p.z));
        const dx = p.x - qx, dz = p.z - qz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        if (d2 > 1e-10) {
          const d = Math.sqrt(d2), push = r - d;
          p.x += (dx / d) * push; p.z += (dz / d) * push;
        } else {
          // centro dentro da caixa: sai pelo lado mais próximo
          const l = p.x - b.min[0], rr = b.max[0] - p.x, n = p.z - b.min[2], f = b.max[2] - p.z;
          const m = Math.min(l, rr, n, f);
          if (m === l) p.x = b.min[0] - r;
          else if (m === rr) p.x = b.max[0] + r;
          else if (m === n) p.z = b.min[2] - r;
          else p.z = b.max[2] + r;
        }
      }
    }
  }

  groundUnder(p) {
    let gy = 0;
    const r = CFG.radius * 0.7, boxes = this.map.boxes;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (b.max[1] <= gy || b.max[1] > p.y + CFG.step + 1e-3) continue;
      const qx = Math.max(b.min[0], Math.min(b.max[0], p.x));
      const qz = Math.max(b.min[2], Math.min(b.max[2], p.z));
      if ((p.x - qx) ** 2 + (p.z - qz) ** 2 < r * r) gy = b.max[1];
    }
    return gy;
  }

  // Ponto e velocidade de saída de uma bexiga (também usado pela prévia da mira).
  launch(p, charge) {
    const pow = throwPower(charge);
    const cp = Math.cos(p.pitch);
    const dx = -Math.sin(p.yaw) * cp, dy = Math.sin(p.pitch), dz = -Math.cos(p.yaw) * cp;
    return {
      x: p.x + dx * 0.3, y: p.y + CFG.eye - 0.1 + dy * 0.3, z: p.z + dz * 0.3,
      vx: dx * pow, vy: dy * pow, vz: dz * pow,
    };
  }

  throwBalloon(p) {
    const color = p.ammo.shift();
    const l = this.launch(p, p.charge);
    this.balloons.push({
      id: this.nextBalloonId++, owner: p.id, color,
      x: l.x, y: l.y, z: l.z, px: l.x, py: l.y, pz: l.z,
      vx: l.vx, vy: l.vy, vz: l.vz, life: 0, dead: false,
    });
    p.thrown++;
    p.charging = false; p.charge = 0; p.cooldown = CFG.cooldown;
    this.events.push({ type: 'throw', owner: p.id, x: l.x, y: l.y, z: l.z });
  }

  // ---------- bexigas ----------
  stepBalloon(b, dt) {
    b.px = b.x; b.py = b.y; b.pz = b.z;
    b.vy -= CFG.balloonG * dt;
    const dx = b.vx * dt, dy = b.vy * dt, dz = b.vz * dt;
    const R = CFG.balloonR, boxes = this.map.boxes;

    let best = 1, axis = -2, sign = 0, boxId = -1;
    if (dy < 0 && b.y + dy < R) {
      best = Math.max(0, Math.min(1, (b.y - R) / -dy));
      axis = 1; sign = 1;
    }
    for (let i = 0; i < boxes.length; i++) {
      const h = segAABB(b.x, b.y, b.z, dx, dy, dz, boxes[i], R);
      if (h && h.t < best) { best = h.t; axis = h.axis; sign = h.sign; boxId = i; }
    }

    // acerto direto em jogador
    const len = Math.hypot(dx, dy, dz) * best;
    const n = Math.max(1, Math.ceil(len / 0.2));
    const hitR2 = (CFG.radius + 0.02 + R) ** 2;
    for (let k = 1; k <= n; k++) {
      const t = (k / n) * best;
      const x = b.x + dx * t, y = b.y + dy * t, z = b.z + dz * t;
      for (const p of this.players) {
        if (!p.alive || p.id === b.owner) continue;
        const cy = Math.max(p.y + 0.35, Math.min(p.y + 1.45, y));
        if ((x - p.x) ** 2 + (y - cy) ** 2 + (z - p.z) ** 2 < hitR2) {
          b.dead = true;
          this.events.push({ type: 'splat', x, y, z, nx: 0, ny: 1, nz: 0, color: b.color, box: -1, axis: -1, victim: p.id });
          this.damage(p, b, x, y, z);
          return;
        }
      }
    }

    b.x += dx * best; b.y += dy * best; b.z += dz * best;
    if (axis !== -2) {
      b.dead = true;
      let nx = 0, ny = 0, nz = 0;
      if (axis === 0) nx = sign; else if (axis === 1) ny = sign; else if (axis === 2) nz = sign;
      else ny = 1; // nasceu dentro de uma parede
      this.events.push({ type: 'splat', x: b.x, y: b.y, z: b.z, nx, ny, nz, color: b.color, box: boxId, axis, victim: -1 });
      // respingo em quem estiver perto
      const ox = b.x + nx * 0.1, oy = b.y + ny * 0.1, oz = b.z + nz * 0.1;
      for (const p of this.players) {
        if (!p.alive || p.id === b.owner) continue;
        const cy = Math.max(p.y + 0.35, Math.min(p.y + 1.45, b.y));
        const d2 = (b.x - p.x) ** 2 + (b.y - cy) ** 2 + (b.z - p.z) ** 2;
        if (d2 < CFG.splash ** 2 && clearLine(boxes, ox, oy, oz, p.x, p.y + 1.0, p.z)) {
          this.damage(p, b, b.x, b.y, b.z);
        }
      }
      return;
    }
    b.life += dt;
    if (b.life > 6 || Math.abs(b.x) > this.map.half + 15 || Math.abs(b.z) > this.map.half + 15) b.dead = true;
  }

  damage(victim, balloon, x, y, z) {
    if (victim.invuln > 0) return;
    const by = this.players[balloon.owner];
    victim.hp--;
    by.hits++; by.score += 1;
    this.events.push({ type: 'hit', victim: victim.id, by: by.id, color: balloon.color, hp: victim.hp, x, y, z });
    if (victim.hp <= 0) {
      victim.alive = false;
      victim.respawnT = CFG.respawn;
      victim.deaths++;
      victim.charging = false; victim.charge = 0;
      by.kos++; by.score += 2;
      this.events.push({ type: 'ko', victim: victim.id, by: by.id, color: balloon.color });
    }
  }

  // ---------- roupas limpas: devolvem uma vida a quem já levou tinta ----------
  stepShirt(sh, dt) {
    if (!sh.active) {
      sh.timer -= dt;
      if (sh.timer <= 0) sh.active = true;
      return;
    }
    for (const p of this.players) {
      if (!p.alive || p.hp >= CFG.maxHp) continue;
      if ((p.x - sh.x) ** 2 + (p.z - sh.z) ** 2 < 1.3 * 1.3 && Math.abs(p.y - sh.y) < 1.2) {
        p.hp++;
        sh.active = false;
        sh.timer = CFG.shirtRespawn;
        this.events.push({ type: 'heal', id: p.id, shirt: sh.id, hp: p.hp });
        return;
      }
    }
  }

  // ---------- sacolas ----------
  stepBag(bag, dt) {
    if (!bag.active) {
      bag.timer -= dt;
      if (bag.timer <= 0) { bag.active = true; this.events.push({ type: 'bag', bag: bag.id }); }
      return;
    }
    for (const p of this.players) {
      if (!p.alive || p.ammo.length >= CFG.bagSize) continue;
      if ((p.x - bag.x) ** 2 + (p.z - bag.z) ** 2 < 1.3 * 1.3 && Math.abs(p.y - bag.y) < 1.2) {
        this.fillBag(p);
        bag.active = false;
        bag.timer = CFG.bagRespawn;
        this.events.push({ type: 'pickup', id: p.id, bag: bag.id });
        return;
      }
    }
  }
}
