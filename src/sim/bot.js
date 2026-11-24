// IA dos bots. Lê o estado do jogo e devolve um comando, igual a um jogador humano.
import { CFG, throwPower } from './game.js';
import { clearLine } from './map.js';

// Níveis dos bots. errYaw/errPitch: erro de mira (rad); react: segundos vendo o alvo antes de armar;
// pause: espera entre arremessos; lead: quanto prevê o movimento do alvo (0 a 1); view: distância
// em que enxerga alguém (m); turn: velocidade de virar a mira (rad/s); strafe: quanto anda de lado
// no combate (0 a 1); dodge: chance de desviar de uma bexiga vindo na sua direção;
// near/far: distância que tenta manter do alvo no combate (perto = mais acertos);
// mob: fração da velocidade com que se mexe no combate (1 = correndo, menor = alvo mais fácil).
export const SKILLS = {
  facil: { errYaw: 0.2, errPitch: 0.12, react: 1.3, pause: 2, lead: 0.2, view: 18, turn: 3, strafe: 0.35, dodge: 0, near: 9, far: 16, mob: 0.4 },
  normal: { errYaw: 0.15, errPitch: 0.09, react: 1, pause: 1.6, lead: 0.35, view: 22, turn: 4, strafe: 0.5, dodge: 0, near: 8, far: 14, mob: 0.55 },
  dificil: { errYaw: 0.02, errPitch: 0.015, react: 0.2, pause: 0.4, lead: 1, view: 34, turn: 10, strafe: 1, dodge: 0.75, near: 4, far: 9, mob: 1 },
};

const wrap = (a) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};

// Ângulo de lançamento (arco baixo) para atingir distância d e desnível h com velocidade v.
function solvePitch(d, h, v, g) {
  const v2 = v * v;
  const disc = v2 * v2 - g * (g * d * d + 2 * h * v2);
  if (disc < 0) return null;
  return Math.atan((v2 - Math.sqrt(disc)) / (g * d));
}

export class BotBrain {
  constructor(game, nav, id, skill = 'normal') {
    this.game = game; this.nav = nav; this.id = id;
    this.skill = SKILLS[skill] || SKILLS.normal;
    this.cmd = { mx: 0, mz: 0, yaw: 0, pitch: 0, jump: false, fire: false };
    this.synced = false;
    this.reset();
  }

  reset() {
    this.target = -1; this.scanT = 0; this.seenT = 0;
    this.path = null; this.pathI = 0; this.pathT = 0; this.goal = null; this.roamT = 0;
    this.strafe = 1; this.strafeT = 0;
    this.holding = false; this.wantCharge = 0; this.holdT = 0; this.waitT = 0.5;
    this.errYaw = 0; this.errPitch = 0;
    this.stuckT = 0; this.sx = 0; this.sz = 0;
    this.dodgeT = 0; this.dodgeX = 0; this.dodgeZ = 0; this.judged = new Set();
    this.synced = false;
  }

  gauss() {
    const r = this.game.rng;
    return (r() + r() + r() - 1.5) * 1.15;
  }

  sees(p, o) {
    return clearLine(this.game.map.boxes, p.x, p.y + CFG.eye, p.z, o.x, o.y + 1.2, o.z);
  }

  pickTarget(p) {
    let best = -1, bd = this.skill.view ** 2;
    for (const o of this.game.players) {
      if (o === p || !o.alive) continue;
      let d = (o.x - p.x) ** 2 + (o.z - p.z) ** 2;
      if (o.id === this.target) d *= 0.6; // prefere manter o alvo atual
      if (d < bd && this.sees(p, o)) { bd = d; best = o.id; }
    }
    if (best !== this.target) { this.seenT = 0; this.holding = false; }
    this.target = best;
  }

  nearestShirt(p, maxDist) {
    let best = null, bd = maxDist * maxDist;
    for (const s of this.game.shirts) {
      if (!s.active) continue;
      const d = (s.x - p.x) ** 2 + (s.z - p.z) ** 2;
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  nearestBag(p, maxDist) {
    let best = null, bd = maxDist * maxDist;
    for (const b of this.game.bags) {
      if (!b.active || b.y > 0.5) continue;
      const d = (b.x - p.x) ** 2 + (b.z - p.z) ** 2;
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  // Direção (no mundo) para seguir até o objetivo, usando o caminho da grade.
  steerTo(p, gx, gz, dt, out) {
    this.pathT -= dt;
    const changed = !this.goal || (this.goal[0] - gx) ** 2 + (this.goal[1] - gz) ** 2 > 4;
    if (!this.path || changed || this.pathT <= 0) {
      this.path = this.nav.findPath(p.x, p.z, gx, gz);
      this.pathI = 1; this.pathT = 1.5 + this.game.rng();
      this.goal = [gx, gz];
    }
    let tx = gx, tz = gz;
    if (this.path) {
      while (this.pathI < this.path.length) {
        const w = this.path[this.pathI];
        if ((w[0] - p.x) ** 2 + (w[1] - p.z) ** 2 < 0.5) this.pathI++; else break;
      }
      if (this.pathI < this.path.length) { tx = this.path[this.pathI][0]; tz = this.path[this.pathI][1]; }
    }
    const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
    if (d < 0.05) { out[0] = 0; out[1] = 0; } else { out[0] = dx / d; out[1] = dz / d; }
  }

  // Olha as bexigas dos outros: se uma vai passar perto em menos de 0,8 s, decide (uma vez por bexiga,
  // com chance sk.dodge) dar um passo para o lado, saindo da linha dela.
  watchBalloons(p, dt) {
    this.dodgeT -= dt;
    if (this.judged.size > 64) this.judged.clear();
    for (const b of this.game.balloons) {
      if (b.dead || b.owner === this.id || this.judged.has(b.id)) continue;
      const rx = p.x - b.x, rz = p.z - b.z, v2 = b.vx * b.vx + b.vz * b.vz;
      if (v2 < 1) continue;
      const tc = (rx * b.vx + rz * b.vz) / v2; // instante de maior aproximação
      if (tc <= 0 || tc > 0.8) continue;
      const cx = rx - b.vx * tc, cz = rz - b.vz * tc; // onde ele fica em relação à trajetória
      if (cx * cx + cz * cz > 1.6 * 1.6) continue;
      this.judged.add(b.id);
      if (this.game.rng() >= this.skill.dodge) continue;
      const v = Math.sqrt(v2);
      let nx = -b.vz / v, nz = b.vx / v; // perpendicular à bexiga, para o lado em que ele já está
      if (nx * cx + nz * cz < 0) { nx = -nx; nz = -nz; }
      this.dodgeX = nx; this.dodgeZ = nz; this.dodgeT = 0.4;
    }
  }

  think(dt) {
    const g = this.game, p = g.players[this.id], cmd = this.cmd, rng = g.rng, sk = this.skill;
    cmd.mx = 0; cmd.mz = 0; cmd.jump = false; cmd.fire = false;
    if (!p.alive) { if (this.synced) this.reset(); return cmd; }
    if (!this.synced) { cmd.yaw = p.yaw; cmd.pitch = 0; this.synced = true; this.sx = p.x; this.sz = p.z; }

    this.scanT -= dt;
    if (this.scanT <= 0) { this.scanT = 0.2 + rng() * 0.1; this.pickTarget(p); }
    let t = this.target >= 0 ? g.players[this.target] : null;
    if (t && !t.alive) { t = null; this.target = -1; this.holding = false; }

    const move = [0, 0];
    const lowAmmo = p.ammo.length <= 3;
    let bag = lowAmmo ? this.nearestBag(p, 100) : p.ammo.length < 12 ? this.nearestBag(p, 9) : null;
    // sujo de tinta: busca uma roupa limpa (de longe se estiver por um fio)
    if (!lowAmmo && p.hp < CFG.maxHp) bag = this.nearestShirt(p, p.hp === 1 ? 26 : 9) || bag;
    let dist = 0;
    if (t) dist = Math.hypot(t.x - p.x, t.z - p.z);

    if (bag) {
      this.steerTo(p, bag.x, bag.z, dt, move);
    } else if (t) {
      // combate: mantém distância e anda de lado
      this.strafeT -= dt;
      if (this.strafeT <= 0) { this.strafeT = 0.7 + rng() * 1.4; this.strafe = rng() < 0.5 ? -1 : 1; }
      const ux = (t.x - p.x) / (dist || 1), uz = (t.z - p.z) / (dist || 1);
      const radial = dist > sk.far ? 1 : dist < sk.near ? -1 : 0;
      move[0] = ux * radial - uz * this.strafe * sk.strafe;
      move[1] = uz * radial + ux * this.strafe * sk.strafe;
      const ml = (Math.hypot(move[0], move[1]) || 1) / sk.mob;
      move[0] /= ml; move[1] /= ml;
      this.path = null;
      if (rng() < 0.004) cmd.jump = true;
    } else {
      // passeio
      this.roamT -= dt;
      if (!this.roam || this.roamT <= 0 || (this.roam[0] - p.x) ** 2 + (this.roam[1] - p.z) ** 2 < 4) {
        this.roam = this.nav.randomPoint(rng);
        this.roamT = 12;
      }
      this.steerTo(p, this.roam[0], this.roam[1], dt, move);
    }

    // esquiva: passo para o lado quando uma bexiga vem na direção dele
    if (sk.dodge > 0) this.watchBalloons(p, dt);
    if (this.dodgeT > 0) { move[0] = this.dodgeX; move[1] = this.dodgeZ; this.path = null; }

    // mira
    let wantYaw = cmd.yaw, wantPitch = 0, canShoot = false;
    if (t && p.ammo.length > 0) {
      this.seenT += dt;
      if (!this.holding) {
        this.wantCharge = Math.max(0.1, Math.min(1, (dist * 0.95 - 3) / (CFG.maxPow - CFG.minPow)));
      }
      const v = throwPower(Math.max(this.wantCharge, p.charge));
      // prevê onde o alvo vai estar
      let ax = t.x, az = t.z, d = dist, pitch = 0.2;
      for (let i = 0; i < 2; i++) {
        const sol = solvePitch(d, t.y + 0.9 - (p.y + CFG.eye - 0.1), v, CFG.balloonG);
        pitch = sol === null ? 0.7 : sol;
        const time = d / (v * Math.cos(pitch));
        ax = t.x + t.vx * time * sk.lead; az = t.z + t.vz * time * sk.lead;
        d = Math.hypot(ax - p.x, az - p.z);
      }
      wantYaw = Math.atan2(-(ax - p.x), -(az - p.z)) + this.errYaw;
      wantPitch = pitch + this.errPitch;
      canShoot = true;
    } else {
      this.seenT = 0;
      if (move[0] || move[1]) wantYaw = Math.atan2(-move[0], -move[1]);
    }

    const dy = wrap(wantYaw - cmd.yaw);
    cmd.yaw = wrap(cmd.yaw + Math.max(-sk.turn * dt, Math.min(sk.turn * dt, dy)));
    const dp = wantPitch - cmd.pitch, pt = sk.turn * 0.7 * dt;
    cmd.pitch += Math.max(-pt, Math.min(pt, dp));

    // arremesso
    this.waitT -= dt;
    if (canShoot) {
      if (!this.holding && this.waitT <= 0 && this.seenT >= sk.react && p.cooldown <= 0) {
        this.holding = true; this.holdT = 0;
        this.errYaw = this.gauss() * sk.errYaw;
        this.errPitch = this.gauss() * sk.errPitch;
      }
      if (this.holding) {
        this.holdT += dt;
        const aligned = Math.abs(dy) < 0.05 && Math.abs(dp) < 0.05;
        if ((p.charge >= this.wantCharge && aligned) || this.holdT > 1.8) {
          this.holding = false; // solta => lança
          this.waitT = sk.pause * (0.6 + rng() * 0.8);
        } else {
          cmd.fire = true;
        }
      }
    } else {
      this.holding = false;
    }

    // converte a direção do mundo para "frente/lado" relativo ao olhar
    const sy = Math.sin(cmd.yaw), cy = Math.cos(cmd.yaw);
    cmd.mz = move[0] * -sy + move[1] * -cy;
    cmd.mx = move[0] * cy + move[1] * -sy;

    // destrava se ficou preso
    this.stuckT += dt;
    if (this.stuckT > 1) {
      const moved = Math.hypot(p.x - this.sx, p.z - this.sz);
      if ((move[0] || move[1]) && moved < 0.4) {
        cmd.jump = true; this.strafe = -this.strafe; this.path = null; this.roam = null;
      }
      this.stuckT = 0; this.sx = p.x; this.sz = p.z;
    }
    return cmd;
  }
}
