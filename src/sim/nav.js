// Malha de navegação em grade para os bots (só nível do chão) + A*.
import { segAABB } from './map.js';

const CELL = 1.5;
const CLEAR = 0.55; // folga em relação aos obstáculos

export class Nav {
  constructor(map) {
    this.half = map.half;
    this.n = Math.floor((map.half * 2) / CELL);
    const n = this.n;
    const tall = map.boxes.filter((b) => b.max[1] > 0.35 && b.min[1] < 1.7);
    this.walk = new Uint8Array(n * n);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = this.cx(i), z = this.cx(j);
        let ok = true;
        for (const b of tall) {
          if (x > b.min[0] - CLEAR && x < b.max[0] + CLEAR && z > b.min[2] - CLEAR && z < b.max[2] + CLEAR) { ok = false; break; }
        }
        this.walk[j * n + i] = ok ? 1 : 0;
      }
    }
    // Vizinhos válidos (aresta não atravessa obstáculo)
    this.nbr = new Array(n * n);
    const edgeOk = (x0, z0, x1, z1) => {
      for (const b of tall) if (segAABB(x0, 1, z0, x1 - x0, 0, z1 - z0, b, CLEAR - 0.1)) return false;
      return true;
    };
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const id = j * n + i;
        const list = [];
        if (this.walk[id]) {
          for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
            if (!di && !dj) continue;
            const a = i + di, c = j + dj;
            if (a < 0 || c < 0 || a >= n || c >= n) continue;
            const o = c * n + a;
            if (!this.walk[o]) continue;
            if (edgeOk(this.cx(i), this.cx(j), this.cx(a), this.cx(c))) list.push(o);
          }
        }
        this.nbr[id] = list;
      }
    }
    this.walkable = [];
    for (let id = 0; id < n * n; id++) if (this.walk[id] && this.nbr[id].length) this.walkable.push(id);
    this.gs = new Float32Array(n * n);
    this.fs = new Float32Array(n * n);
    this.came = new Int32Array(n * n);
    this.state = new Uint8Array(n * n);
  }

  cx(i) { return -this.half + (i + 0.5) * CELL; }
  ci(x) { return Math.max(0, Math.min(this.n - 1, Math.floor((x + this.half) / CELL))); }
  point(id) { return [this.cx(id % this.n), this.cx(Math.floor(id / this.n))]; }

  nearest(x, z) {
    const n = this.n, i0 = this.ci(x), j0 = this.ci(z);
    if (this.walk[j0 * n + i0] && this.nbr[j0 * n + i0].length) return j0 * n + i0;
    let best = -1, bd = Infinity;
    for (let r = 1; r < 8 && best < 0; r++) {
      for (let j = j0 - r; j <= j0 + r; j++) for (let i = i0 - r; i <= i0 + r; i++) {
        if (i < 0 || j < 0 || i >= n || j >= n) continue;
        const id = j * n + i;
        if (!this.walk[id] || !this.nbr[id].length) continue;
        const d = (this.cx(i) - x) ** 2 + (this.cx(j) - z) ** 2;
        if (d < bd) { bd = d; best = id; }
      }
    }
    return best;
  }

  randomPoint(rng) {
    return this.point(this.walkable[Math.floor(rng() * this.walkable.length)]);
  }

  // Retorna lista de pontos [x,z] do início ao destino (ou null).
  findPath(sx, sz, gx, gz) {
    const n = this.n;
    const s = this.nearest(sx, sz), g = this.nearest(gx, gz);
    if (s < 0 || g < 0) return null;
    const { gs, fs, came, state } = this;
    state.fill(0);
    const gi = g % n, gj = Math.floor(g / n);
    const h = (id) => Math.hypot((id % n) - gi, Math.floor(id / n) - gj);
    const open = [s];
    gs[s] = 0; fs[s] = h(s); came[s] = -1; state[s] = 1;
    while (open.length) {
      let bi = 0;
      for (let k = 1; k < open.length; k++) if (fs[open[k]] < fs[open[bi]]) bi = k;
      const cur = open[bi];
      open[bi] = open[open.length - 1]; open.pop();
      if (cur === g) {
        const path = [];
        for (let c = g; c !== -1; c = came[c]) path.push(this.point(c));
        path.reverse();
        return path;
      }
      state[cur] = 2;
      const ci = cur % n, cj = Math.floor(cur / n);
      for (const o of this.nbr[cur]) {
        if (state[o] === 2) continue;
        const cost = gs[cur] + Math.hypot((o % n) - ci, Math.floor(o / n) - cj);
        if (state[o] === 0 || cost < gs[o]) {
          gs[o] = cost; fs[o] = cost + h(o); came[o] = cur;
          if (state[o] === 0) { state[o] = 1; open.push(o); }
        }
      }
    }
    return null;
  }
}
