// Mapas: registro, sanidade do layout (nada nasce dentro de obstáculo, tudo alcançável) e o caráter do Pátio.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MAPS, buildMap, clearLine } from '../src/sim/map.js';
import { Game, CFG } from '../src/sim/game.js';
import { Nav } from '../src/sim/nav.js';
import { BotBrain } from '../src/sim/bot.js';

test('mapas: registro e id desconhecido cai na Praça', () => {
  assert.deepEqual(MAPS.map((m) => m.id), ['praca', 'patio']);
  assert.equal(buildMap().id, 'praca');
  assert.equal(buildMap('xyz').id, 'praca');
  assert.equal(buildMap('patio').id, 'patio');
  assert.equal(new Game({ map: 'patio' }).map.id, 'patio');
});

// caixa que ocupa a altura de quem está no chão, alargada pelo raio do jogador
const blocks = (b, x, z) => b.min[1] < 1.8 && b.max[1] > 0.05
  && x > b.min[0] - CFG.radius && x < b.max[0] + CFG.radius && z > b.min[2] - CFG.radius && z < b.max[2] + CFG.radius;

// pontos no chão: spawns [x,z], sacolas e roupas [x,y,z] com y baixo
const groundPoints = (m) => [
  ...m.spawns.map(([x, z]) => ({ what: 'spawn', x, z })),
  ...m.bagSpots.filter((s) => s[1] < 0.5).map(([x, , z]) => ({ what: 'sacola', x, z })),
  ...m.shirtSpots.filter((s) => s[1] < 0.5).map(([x, , z]) => ({ what: 'roupa', x, z })),
];

for (const { id } of MAPS) {
  test(`mapa ${id}: tudo dentro da arena e nada nasce dentro de obstáculo`, () => {
    const m = buildMap(id);
    const lim = m.half + 1.5;
    for (const b of m.boxes) {
      for (const k of [0, 2]) assert.ok(b.min[k] >= -lim && b.max[k] <= lim, `caixa ${b.kind} fora da arena`);
    }
    assert.equal(m.spawns.length, 8);
    for (const p of groundPoints(m)) {
      const hit = m.boxes.find((b) => blocks(b, p.x, p.z));
      assert.equal(hit, undefined, `${p.what} em (${p.x}, ${p.z}) dentro de ${hit?.kind}`);
    }
  });

  test(`mapa ${id}: bots alcançam spawns, sacolas e roupas`, () => {
    const m = buildMap(id), nav = new Nav(m);
    const [sx, sz] = m.spawns[0];
    for (const p of groundPoints(m)) {
      const path = nav.findPath(sx, sz, p.x, p.z);
      assert.ok(path, `sem caminho até ${p.what} (${p.x}, ${p.z})`);
      const [ex, ez] = path.at(-1);
      assert.ok(Math.hypot(ex - p.x, ez - p.z) < 1.5, `caminho termina longe de ${p.what} (${p.x}, ${p.z})`);
    }
  });
}

// fração de pares de pontos livres, a mais de 20 m, que se enxergam
function longSight(m) {
  const free = [];
  for (let x = -m.half + 2; x <= m.half - 2; x += 3) {
    for (let z = -m.half + 2; z <= m.half - 2; z += 3) if (!m.boxes.some((b) => blocks(b, x, z))) free.push([x, z]);
  }
  let pairs = 0, seen = 0;
  for (let i = 0; i < free.length; i += 2) {
    for (let j = i + 1; j < free.length; j += 3) {
      const [ax, az] = free[i], [bx, bz] = free[j];
      if (Math.hypot(ax - bx, az - bz) <= 20) continue;
      pairs++;
      if (clearLine(m.boxes, ax, 1.6, az, bx, 1.2, bz)) seen++;
    }
  }
  return seen / pairs;
}

test('pátio: visão de longe bem mais curta que a da Praça', () => {
  const praca = longSight(buildMap('praca')), patio = longSight(buildMap('patio'));
  assert.ok(patio < praca * 0.5, `pátio ${patio.toFixed(2)} vs praça ${praca.toFixed(2)}`);
});

test('pátio: caixa-d\'água no centro não é escalável', () => {
  const t = buildMap('patio').boxes.find((b) => b.kind === 'tower');
  assert.ok(t, 'existe a caixa-d\'água');
  assert.ok(t.min[0] < 0 && t.max[0] > 0 && t.min[2] < 0 && t.max[2] > 0, 'no centro');
  assert.ok(t.max[1] - t.min[1] > 3, 'alta demais para subir');
});

test('pátio: partida só com bots termina com pontos', () => {
  const g = new Game({ seed: 3, map: 'patio' });
  const nav = new Nav(g.map);
  const bots = [];
  for (let i = 0; i < 8; i++) bots.push(new BotBrain(g, nav, g.addPlayer({ name: 'b' + i, isBot: true }).id, 'normal'));
  const cmds = [];
  while (!g.ended) { for (const b of bots) cmds[b.id] = b.think(1 / 60); g.step(1 / 60, cmds); g.events.length = 0; }
  assert.ok(g.players.reduce((s, p) => s + p.score, 0) > 0);
});
