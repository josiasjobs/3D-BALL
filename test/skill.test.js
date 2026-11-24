// Dificuldade dos bots: cada nível precisa ser claramente diferente, não só na mira.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, CFG } from '../src/sim/game.js';
import { Nav } from '../src/sim/nav.js';
import { BotBrain, SKILLS } from '../src/sim/bot.js';

const DT = 1 / 60;
const IDLE = { mx: 0, mz: 0, yaw: 0, pitch: 0, jump: false, fire: false };

// coloca dois jogadores em linha reta no corredor sul (z = -26), sem obstáculos entre eles
function pair(dist, skill) {
  const g = new Game({ seed: 5, matchTime: 9999 });
  const nav = new Nav(g.map);
  const a = g.addPlayer({ name: 'A' }), b = g.addPlayer({ name: 'B', isBot: true });
  a.x = a.px = -26; a.z = a.pz = -26; b.x = b.px = -26 + dist; b.z = b.pz = -26;
  g.fillBag(b); // com bexigas na mão o bot mira no alvo
  return { g, nav, a, b, brain: new BotBrain(g, nav, b.id, skill) };
}

test('dificuldade: fácil não enxerga tão longe quanto o difícil', () => {
  for (const [skill, sees] of [['facil', false], ['dificil', true]]) {
    const { g, brain, b } = pair(24, skill);
    assert.ok(brain.sees(b, g.players[0]), 'linha de visão livre');
    brain.pickTarget(b);
    assert.equal(brain.target >= 0, sees, `${skill} a 24 m`);
  }
});

test('dificuldade: fácil vira a mira mais devagar que o difícil', () => {
  const turn = (skill) => {
    const { brain, b } = pair(10, skill);
    b.yaw = -Math.PI / 2; // de costas para o alvo (yaw = 0 olha para -z)
    brain.think(DT);
    const y0 = brain.cmd.yaw;
    brain.scanT = 0; brain.think(DT); brain.think(DT);
    return Math.abs(brain.cmd.yaw - y0);
  };
  assert.ok(turn('facil') <= SKILLS.facil.turn * DT * 2 + 1e-9);
  assert.ok(turn('dificil') > turn('facil') * 2);
});

// Atirador normal contra um bot que não atira (só se mexe como o nível dele), 60 s por semente.
function hitsTaken(skill, seeds = 12) {
  let hits = 0;
  for (let s = 1; s <= seeds; s++) {
    const g = new Game({ seed: s * 7919, matchTime: 9999 });
    const nav = new Nav(g.map);
    const sh = g.addPlayer({ name: 'S', isBot: true }), tg = g.addPlayer({ name: 'T', isBot: true });
    const shooter = new BotBrain(g, nav, sh.id, 'normal'), target = new BotBrain(g, nav, tg.id, skill);
    for (let i = 0; i < 60 / DT; i++) {
      const c = target.think(DT); c.fire = false;
      tg.invuln = 0; tg.hp = CFG.maxHp; tg.ammo.length = 20; // não morre: medimos só o desvio
      g.step(DT, [shooter.think(DT), c]);
      for (const e of g.events) if (e.type === 'hit' && e.victim === tg.id) hits++;
      g.events.length = 0;
    }
  }
  return hits;
}

test('dificuldade: bot difícil desvia de bexigas e é bem menos atingido', () => {
  const normal = hitsTaken('normal'), dificil = hitsTaken('dificil');
  assert.ok(dificil < normal * 0.75, `difícil levou ${dificil}, normal ${normal}`);
});

// Duelo contra alvo que anda de lado: acertos do bot em 90 s, somados em várias sementes.
function duelHits(skill, seeds = 12) {
  let hits = 0;
  for (let s = 1; s <= seeds; s++) {
    const g = new Game({ seed: s * 104729, matchTime: 9999 });
    const nav = new Nav(g.map);
    const h = g.addPlayer({ name: 'H' }), b = g.addPlayer({ name: 'B', isBot: true });
    const brain = new BotBrain(g, nav, b.id, skill);
    const hc = { ...IDLE };
    let dir = 1;
    for (let i = 0; i < 90 / DT; i++) {
      if (i % 50 === 0) dir = g.rng() < 0.5 ? -1 : 1;
      hc.mx = dir; hc.yaw = Math.atan2(-(b.x - h.x), -(b.z - h.z));
      h.invuln = 0; h.hp = CFG.maxHp;
      g.step(DT, [hc, brain.think(DT)]);
      for (const e of g.events) if (e.type === 'hit' && e.by === b.id) hits++;
      g.events.length = 0;
    }
  }
  return hits;
}

test('dificuldade: níveis bem separados contra um alvo em movimento', () => {
  const f = duelHits('facil'), n = duelHits('normal'), d = duelHits('dificil');
  assert.ok(f * 3 <= n, `fácil ${f} deveria acertar no máximo 1/3 do normal ${n}`);
  assert.ok(d >= n * 1.5, `difícil ${d} deveria acertar ao menos 1,5x o normal ${n}`);
});

// Quanta tinta um "jogador" (que só anda, sem atirar) leva no meio de 7 bots do nível, por minuto.
function felt(skill, seeds = 6) {
  let hits = 0;
  for (let s = 1; s <= seeds; s++) {
    const g = new Game({ seed: s * 31337, matchTime: 60 });
    const nav = new Nav(g.map);
    const me = g.addPlayer({ name: 'Eu' });
    const walker = new BotBrain(g, nav, me.id, 'facil');
    const bots = [];
    for (let i = 0; i < 7; i++) bots.push(new BotBrain(g, nav, g.addPlayer({ name: 'b' + i, isBot: true }).id, skill));
    const cmds = [];
    while (!g.ended) {
      const c = walker.think(DT); c.fire = false; cmds[0] = c;
      for (const b of bots) cmds[b.id] = b.think(DT);
      g.step(DT, cmds);
      for (const e of g.events) if (e.type === 'hit' && e.victim === me.id) hits++;
      g.events.length = 0;
    }
  }
  return hits / seeds;
}

test('dificuldade: o jogador sente a diferença (tinta recebida no meio de 7 bots)', () => {
  const f = felt('facil'), n = felt('normal'), d = felt('dificil');
  assert.ok(f * 2 <= n, `fácil ${f.toFixed(1)}/min deveria ser no máximo metade do normal ${n.toFixed(1)}`);
  assert.ok(d >= n * 1.5, `difícil ${d.toFixed(1)}/min deveria ser ao menos 1,5x o normal ${n.toFixed(1)}`);
});
