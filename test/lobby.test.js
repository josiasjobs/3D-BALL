// Testes do Lobby: várias salas por código, públicas e privadas.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Lobby, CODE_CHARS } from '../src/server/lobby.js';

function fakeConn() {
  const c = { msgs: [], send(text) { c.msgs.push(JSON.parse(text)); } };
  return c;
}
const CODE_RE = new RegExp(`^[${CODE_CHARS}]{5}$`);

test('lobby: cria sala pública com código válido', () => {
  const lobby = new Lobby();
  const a = fakeConn();
  const r = lobby.create(a, 'Ana', { isPublic: true });
  assert.equal(r.id, 0);
  assert.match(r.room.code, CODE_RE);
  assert.equal(a.msgs[0].t, 'welcome');
  assert.equal(a.msgs[0].code, r.room.code);
  assert.equal(a.msgs[0].public, true);
  assert.equal(lobby.rooms.get(r.room.code), r.room);
});

test('lobby: entra pelo código, normalizando maiúsculas e espaços', () => {
  const lobby = new Lobby();
  const { room } = lobby.create(fakeConn(), 'Ana', { isPublic: false });
  const b = fakeConn();
  const r = lobby.join(b, 'Bia', ' ' + room.code.toLowerCase() + ' ');
  assert.equal(r.id, 1);
  assert.equal(r.room, room);
  assert.equal(b.msgs[0].public, false);
});

test('lobby: código inexistente e sala cheia', () => {
  const lobby = new Lobby({ roomOpts: { slots: 1 } });
  assert.equal(lobby.join(fakeConn(), 'C', 'ZZZZZ').error, 'notfound');
  assert.equal(lobby.join(fakeConn(), 'C', '').error, 'notfound');
  const { room } = lobby.create(fakeConn(), 'Ana');
  assert.equal(lobby.join(fakeConn(), 'Bia', room.code).error, 'full');
});

test('lobby: sala privada fica fora da lista pública', () => {
  const lobby = new Lobby();
  const pub = lobby.create(fakeConn(), 'Ana', { isPublic: true, bots: 3, skill: 'facil' }).room;
  lobby.create(fakeConn(), 'Bia', { isPublic: false });
  assert.deepEqual(lobby.list(), [{ code: pub.code, host: 'Ana', humans: 1, slots: 8, bots: 3, skill: 'facil', map: 'praca' }]);
});

test('lobby: nome do anfitrião é limpo como o do jogador', () => {
  const lobby = new Lobby();
  lobby.create(fakeConn(), '  <img src=x>  ');
  assert.equal(lobby.list()[0].host, 'img src=x');
});

test('lobby: sala some quando o último humano sai', () => {
  const lobby = new Lobby();
  const a = lobby.create(fakeConn(), 'Ana');
  const b = lobby.join(fakeConn(), 'Bia', a.room.code);
  lobby.leave(a.room, a.id);
  assert.equal(lobby.rooms.size, 1);
  lobby.leave(b.room, b.id);
  assert.equal(lobby.rooms.size, 0);
  assert.equal(lobby.join(fakeConn(), 'C', a.room.code).error, 'notfound');
});

test('lobby: limite de salas simultâneas', () => {
  const lobby = new Lobby({ maxRooms: 2 });
  lobby.create(fakeConn(), 'A');
  lobby.create(fakeConn(), 'B');
  assert.deepEqual(lobby.create(fakeConn(), 'C'), { error: 'limit' });
});

test('lobby: tick faz as salas rodarem e mandarem estado', () => {
  const lobby = new Lobby();
  const a = fakeConn();
  lobby.create(a, 'Ana');
  for (let i = 0; i < 4; i++) lobby.tick();
  assert.ok(a.msgs.some((m) => m.t === 'snap'));
});

test('lobby: sala de pátio usa o pátio e anuncia o mapa', () => {
  const lobby = new Lobby();
  const a = fakeConn(), b = fakeConn();
  const { room } = lobby.create(a, 'Ana', { map: 'patio' });
  assert.equal(room.game.map.id, 'patio');
  assert.equal(a.msgs[0].map, 'patio');
  assert.equal(lobby.list()[0].map, 'patio');
  lobby.join(b, 'Bia', room.code);
  assert.equal(b.msgs[0].map, 'patio');
  // nova partida na mesma sala continua no pátio
  room.newMatch();
  assert.equal(room.game.map.id, 'patio');
});

test('lobby: mapa desconhecido vira Praça', () => {
  const lobby = new Lobby();
  const { room } = lobby.create(fakeConn(), 'Ana', { map: 'lua' });
  assert.equal(room.game.map.id, 'praca');
  assert.equal(lobby.list()[0].map, 'praca');
});
