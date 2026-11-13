import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, CFG } from '../src/sim/game.js';
import { Nav } from '../src/sim/nav.js';
import { BotBrain } from '../src/sim/bot.js';

function runMatch(seed, skill, seconds = 240) {
  const game = new Game({ seed, matchTime: seconds });
  const nav = new Nav(game.map);
  const bots = [];
  for (let i = 0; i < 8; i++) {
    game.addPlayer({ name: 'Bot' + i, isBot: true });
    bots.push(new BotBrain(game, nav, i, skill));
  }
  const count = {};
  const dt = 1 / 60;
  const cmds = [];
  while (!game.ended) {
    for (const b of bots) cmds[b.id] = b.think(dt);
    game.step(dt, cmds);
    for (const e of game.events) count[e.type] = (count[e.type] || 0) + 1;
    game.events.length = 0;
    for (const p of game.players) {
      assert.ok(Number.isFinite(p.x + p.y + p.z), 'posição inválida');
      assert.ok(Math.abs(p.x) <= game.map.half && Math.abs(p.z) <= game.map.half, 'saiu da arena');
      assert.ok(p.y >= 0 && p.y < 4, 'altura inválida: ' + p.y);
      assert.ok(p.ammo.length <= CFG.bagSize);
    }
  }
  return { game, count };
}

test('partida completa só com bots', () => {
  const { game, count } = runMatch(7, 'normal');
  const thrown = game.players.reduce((s, p) => s + p.thrown, 0);
  const hits = game.players.reduce((s, p) => s + p.hits, 0);
  console.log('eventos', count, 'arremessos', thrown, 'acertos', hits, 'taxa', (hits / thrown).toFixed(2));
  console.log(game.ranking().map((p) => `${p.name}:${p.score}`).join(' '));
  assert.ok(thrown > 100, 'bots arremessam');
  assert.ok(hits > 20, 'bots acertam');
  assert.ok(count.ko > 3, 'há eliminações');
  assert.ok(count.pickup > 3, 'bots recarregam nas sacolas');
  assert.ok(count.respawn >= count.ko - 8);
});

test('jogador começa com 20 bexigas e recarrega na sacola', () => {
  const game = new Game({ seed: 3 });
  const p = game.addPlayer({ name: 'Eu' });
  assert.equal(p.ammo.length, 20);
  p.invuln = 0;
  // arremessa uma
  const cmd = { mx: 0, mz: 0, yaw: p.yaw, pitch: 0.3, jump: false, fire: true };
  for (let i = 0; i < 30; i++) game.step(1 / 60, [cmd]);
  cmd.fire = false;
  game.step(1 / 60, [cmd]);
  assert.equal(p.ammo.length, 19);
  assert.equal(game.balloons.length, 1);
  // encosta numa sacola
  p.x = 14; p.z = 14; p.y = 0;
  game.step(1 / 60, [cmd]);
  assert.equal(p.ammo.length, 20);
  assert.equal(game.bags[1].active, false);
});

test('três acertos eliminam e o jogador renasce', () => {
  const game = new Game({ seed: 5 });
  const a = game.addPlayer({ name: 'A' });
  const b = game.addPlayer({ name: 'B' });
  a.invuln = b.invuln = 0;
  a.x = 0; a.z = 11; b.x = 0; b.z = 6; // A olha para -z, B está à frente
  const cmds = [{ mx: 0, mz: 0, yaw: 0, pitch: 0.12, jump: false, fire: false }, { mx: 0, mz: 0, yaw: 0, pitch: 0, jump: false, fire: false }];
  let guard = 0;
  while (b.alive && guard++ < 2000) {
    cmds[0].fire = guard % 40 < 8;
    b.x = 0; b.z = 6;
    game.step(1 / 60, cmds);
  }
  assert.equal(b.alive, false);
  assert.equal(a.kos, 1);
  assert.equal(a.score, 5); // 3 acertos + 2 da eliminação
  for (let i = 0; i < 200; i++) game.step(1 / 60, cmds);
  assert.equal(b.alive, true);
  assert.equal(b.hp, 3);
});

test('roupa limpa devolve uma vida só a quem levou tinta', () => {
  const game = new Game({ seed: 9 });
  const p = game.addPlayer({ name: 'Eu' });
  const spot = game.shirts[0];
  const cmd = { mx: 0, mz: 0, yaw: 0, pitch: 0, jump: false, fire: false };
  // com as 3 vidas, não pega
  p.x = spot.x; p.z = spot.z;
  game.step(1 / 60, [cmd]);
  assert.equal(spot.active, true);
  // com 1 vida, pega e volta para 2
  p.hp = 1;
  game.step(1 / 60, [cmd]);
  assert.equal(p.hp, 2);
  assert.equal(spot.active, false);
  // a roupa reaparece depois de um tempo
  p.x = 0; p.z = 26;
  for (let i = 0; i < 60 * (CFG.shirtRespawn + 1); i++) game.step(1 / 60, [cmd]);
  assert.equal(spot.active, true);
});

// ---------- multiplayer ----------
import { Room } from '../src/server/room.js';

function fakeConn() {
  const c = { msgs: [], send(text) { c.msgs.push(JSON.parse(text)); } };
  return c;
}

test('sala: jogador entra no lugar de um bot, anda e recebe o estado', () => {
  const room = new Room({ slots: 4 });
  const a = fakeConn();
  const id = room.join(a, '  Ana <b>  ');
  assert.equal(id, 0);
  assert.equal(a.msgs[0].t, 'welcome');
  assert.equal(a.msgs[0].players.length, 4);
  assert.equal(a.msgs[0].players[0].isBot, false);
  assert.equal(room.slots[0].name, 'Ana b');
  const p = room.game.players[0];
  const z0 = p.z, x0 = p.x;
  for (let i = 1; i <= 60; i++) {
    room.onCmd(0, { seq: i, mx: 0, mz: 1, yaw: p.yaw, pitch: 0, jump: false, fire: false });
    room.tick();
  }
  assert.ok(Math.hypot(p.x - x0, p.z - z0) > 3, 'andou para frente');
  const snaps = a.msgs.filter((m) => m.t === 'snap');
  assert.ok(snaps.length >= 29, 'recebe ~30 estados por segundo');
  const lastSnap = snaps[snaps.length - 1];
  assert.equal(lastSnap.you.ack, 60);
  assert.equal(lastSnap.p.length, 4);
  assert.ok(Math.abs(lastSnap.you.x - p.x) < 1e-9);
});

test('sala: segundo jogador, sala cheia e saída devolvem a vaga ao bot', () => {
  const room = new Room({ slots: 2 });
  const a = fakeConn(), b = fakeConn(), c = fakeConn();
  assert.equal(room.join(a, 'A'), 0);
  assert.equal(room.join(b, 'B'), 1);
  assert.equal(a.msgs.at(-1).t, 'roster');
  assert.equal(room.join(c, 'C'), -1);
  room.leave(1);
  assert.equal(room.game.players[1].isBot, true);
  assert.equal(room.humans, 1);
  assert.equal(room.join(c, 'C'), 1);
});

test('sala: fim de partida, intervalo e nova partida mantendo os jogadores', () => {
  const room = new Room({ slots: 3, matchTime: 1 });
  const a = fakeConn();
  room.join(a, 'A');
  for (let i = 0; i < 70; i++) room.tick();
  assert.equal(room.phase, 'intermission');
  assert.ok(a.msgs.some((m) => m.t === 'snap' && m.ended && m.ev.some((e) => e.type === 'end')));
  for (let i = 0; i < 60 * 12 + 10; i++) room.tick();
  assert.equal(room.phase, 'playing');
  assert.equal(a.msgs.filter((m) => m.t === 'start').length, 1);
  assert.equal(room.game.players[0].name, 'A');
  assert.equal(room.game.players[0].isBot, false);
});

test('sala sem bots: só os humanos jogam, e a escolha é de quem abre a sala', () => {
  const room = new Room({ slots: 4 });
  const a = fakeConn(), b = fakeConn();
  assert.equal(room.join(a, 'A', { bots: false }), 0);
  assert.equal(room.useBots, false);
  assert.equal(a.msgs.find((m) => m.t === 'welcome').bots, false);
  assert.deepEqual(room.game.ranking().map((p) => p.name), ['A']);
  // o segundo pede bots, mas a sala já está aberta sem
  assert.equal(room.join(b, 'B', { bots: true }), 1);
  assert.equal(room.useBots, false);
  for (let i = 0; i < 120; i++) room.tick();
  const snap = a.msgs.filter((m) => m.t === 'snap').at(-1);
  assert.deepEqual(snap.p.map((p) => (p[7] & 16) !== 0), [false, false, true, true]);
  assert.ok(room.game.players.slice(2).every((p) => !p.alive && p.out));
  // B sai: a vaga fica vazia, não vira bot
  room.leave(1);
  assert.equal(room.game.players[1].out, true);
  assert.equal(room.game.ranking().length, 1);
  // sala esvazia e o próximo a abrir escolhe de novo
  room.leave(0);
  assert.equal(room.join(b, 'B', { bots: true }), 0);
  assert.equal(room.useBots, true);
  assert.equal(room.game.ranking().length, 4);
});
