// Liga tudo: simulação em passo fixo, entrada, render, HUD e som.
// Dois modos: treino local (a simulação roda aqui, com bots) e online (roda no servidor).
import { Game } from './sim/game.js';
import { Nav } from './sim/nav.js';
import { BotBrain } from './sim/bot.js';
import { PALETTE, buildMap } from './sim/map.js';
import { BOT_NAMES, PLAYER_COLORS } from './sim/roster.js';
import { NetGame } from './net.js';
import { Renderer } from './render/scene.js';
import { Input } from './input.js';
import { Hud, esc } from './hud.js';
import { initAudio, sfx } from './audio.js';

const STEP = 1 / 60;
const $ = (id) => document.getElementById(id);
const hex = (c) => '#' + c.toString(16).padStart(6, '0');

const canvas = $('c');
const hud = new Hud();
const input = new Input(canvas);

let game, nav, bots = [], renderer, localId = -1;
let net = null;         // NetGame quando online
let state = 'menu';     // menu | playing | paused | ended
let acc = 0, last = performance.now();
const cmds = [];
const IDLE = { mx: 0, mz: 0, yaw: 0, pitch: 0, jump: false, fire: false };

// ---------- partida local (treino e demonstração do menu) ----------
function newGame({ withHuman, botCount, skill, name }) {
  game = new Game({ seed: (Date.now() & 0xffffff) || 1 });
  if (!nav) nav = new Nav(game.map);
  bots = [];
  localId = -1;
  if (withHuman) localId = game.addPlayer({ name: name || 'Você', color: PLAYER_COLORS[0] }).id;
  const names = [...BOT_NAMES].sort(() => Math.random() - 0.5);
  for (let i = 0; i < botCount; i++) {
    const p = game.addPlayer({ name: names[i], isBot: true, color: PLAYER_COLORS[game.players.length % PLAYER_COLORS.length] });
    bots.push(new BotBrain(game, nav, p.id, skill));
  }
  renderer.setGame(game, localId);
  if (withHuman) {
    const me = game.players[localId];
    input.yaw = me.yaw; input.pitch = 0;
  }
  acc = 0;
}

function tag(p) { return `<b style="color:${hex(p.color)}">${esc(p.name)}</b>`; }

function handleEvents() {
  const me = localId >= 0 ? game.players[localId] : null;
  const cam = renderer.camera.position;
  for (const e of game.events) {
    renderer.handle(e);
    if (!me) continue; // modo demonstração: só o visual
    switch (e.type) {
      case 'throw':
        sfx.throw(e.owner === localId ? 1 : 0.35 / (1 + Math.hypot(e.x - cam.x, e.z - cam.z) * 0.15));
        break;
      case 'splat':
        sfx.splat(1 / (1 + Math.hypot(e.x - cam.x, e.y - cam.y, e.z - cam.z) * 0.14));
        break;
      case 'hit':
        if (e.victim === localId) { hud.screenSplat(e.color); hud.paintShirt(e.hp, e.color); sfx.hurt(); }
        if (e.by === localId) { hud.hitmark(); sfx.hit(); }
        break;
      case 'ko': {
        const v = game.players[e.victim], by = game.players[e.by];
        hud.feed(`${tag(by)} <span style="color:${hex(PALETTE[e.color])}">●</span> pintou ${tag(v)}`);
        if (e.victim === localId) hud.dead(`${by.name} te encharcou de tinta!`, '');
        if (e.by === localId) { hud.message(`Você eliminou ${v.name}! +2`, 1.8); sfx.ko(); }
        break;
      }
      case 'respawn':
        if (e.id === localId) { hud.dead(''); hud.resetShirts(); input.yaw = e.yaw ?? me.yaw; input.pitch = 0; }
        break;
      case 'pickup':
        if (e.id === localId) { hud.message('Sacola cheia! 20 bexigas', 1.6); sfx.pickup(); }
        break;
      case 'heal':
        renderer.models[e.id].onHeal();
        if (e.id === localId) { hud.cleanShirt(e.hp); hud.message('Roupa limpa! +1 vida', 1.6); sfx.pickup(); }
        break;
      case 'end':
        finish();
        break;
    }
  }
  game.events.length = 0;
}

function tick() {
  if (net) {
    // online: manda o comando; parado (pausa, placar) manda comando vazio mantendo a mira
    let c = input.command();
    if (state !== 'playing') { IDLE.yaw = input.yaw; IDLE.pitch = input.pitch; c = IDLE; }
    net.tick(c);
  } else {
    if (localId >= 0) cmds[localId] = input.command();
    for (const b of bots) cmds[b.id] = b.think(STEP);
    game.step(STEP, cmds);
  }
  handleEvents();
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  // online a partida nunca para; no treino, pausa e placar congelam o jogo
  const running = net ? true : (state === 'playing' || state === 'menu');
  if (running) {
    acc += dt;
    let n = 0;
    while (acc >= STEP && n++ < 6) { acc -= STEP; tick(); }
    if (n >= 6) acc = 0;
    // no menu a partida de demonstração recomeça sozinha
    if (state === 'menu' && game.ended) newGame({ withHuman: false, botCount: 8, skill: 'normal' });
  }
  if (state === 'playing' || (net && state === 'paused')) hud.update(game, game.players[localId], dt);
  if (net) {
    net.frame(acc / STEP);
    if (state === 'ended') updateEndButton();
    renderer.render(dt, 1, input);
  } else {
    renderer.render(running ? dt : 0, running ? acc / STEP : 1, input);
  }
}

// ---------- telas ----------
function showPlaying() {
  hud.start();
  hud.show('menu', false); hud.show('end', false); hud.show('pause', false); hud.show('hud', true);
  state = 'playing';
  input.lock();
}

function startTraining() {
  initAudio();
  leaveOnline();
  newGame({
    withHuman: true,
    botCount: Number($('bots').value),
    skill: $('skill').value,
    name: $('nick').value.trim().slice(0, 12),
  });
  $('pauseTag').textContent = 'Clique para voltar à guerra.';
  $('again').disabled = false; $('again').textContent = 'Jogar de novo';
  showPlaying();
}

async function startOnline() {
  initAudio();
  const status = $('netStatus'), btn = $('online');
  status.textContent = 'Conectando…';
  btn.disabled = true;
  const n = new NetGame();
  const wantBots = $('netBots').value === '1';
  try {
    await n.connect($('nick').value.trim().slice(0, 12), wantBots);
  } catch (err) {
    status.textContent = err.message;
    btn.disabled = false;
    return;
  }
  status.textContent = '';
  btn.disabled = false;
  net = n; game = n; localId = n.localId; bots = []; acc = 0;
  renderer.setGame(game, localId);
  n.onLocalThrow = () => { renderer.models[localId].onThrow(); sfx.throw(1); };
  n.onRoster = () => renderer.setGame(game, localId); // alguém entrou ou saiu: refaz os bonecos
  n.onStart = () => {
    // nova partida no servidor
    renderer.setGame(game, localId);
    hud.start();
    if (state === 'ended') updateEndButton();
  };
  n.onClose = () => { toMenu(); $('netStatus').textContent = 'A conexão com o servidor caiu.'; };
  $('pauseTag').textContent = 'A partida continua rolando enquanto você está aqui.';
  showPlaying();
  // a sala já estava aberta por outra pessoa com a opção contrária
  if (n.bots !== wantBots) hud.message(n.bots ? 'Esta sala já está aberta com bots' : 'Esta sala já está aberta sem bots', 4);
  else if (!n.bots && game.ranking().length === 1) hud.message('Sala sem bots: esperando outros jogadores', 4);
}

function leaveOnline() {
  if (net) { net.close(); net = null; }
}

function finish() {
  state = 'ended';
  input.unlock();
  hud.end(game, game.players[localId]);
  hud.show('hud', false); hud.show('pause', false); hud.show('end', true);
  if (net) updateEndButton();
}

// online: o botão do placar só libera quando o servidor começa a próxima partida
function updateEndButton() {
  const b = $('again');
  if (game.ended) { b.disabled = true; b.textContent = `Próxima partida em ${net.nextIn()}s`; }
  else { b.disabled = false; b.textContent = 'Entrar na partida'; }
}

function toMenu() {
  leaveOnline();
  state = 'menu';
  input.unlock();
  newGame({ withHuman: false, botCount: 8, skill: 'normal' });
  hud.show('hud', false); hud.show('pause', false); hud.show('end', false); hud.show('menu', true);
}

input.onLockChange = (locked) => {
  if (!locked && state === 'playing') { state = 'paused'; hud.show('pause', true); }
  else if (locked && state === 'paused') { state = 'playing'; hud.show('pause', false); }
};

$('form').addEventListener('submit', (e) => { e.preventDefault(); startTraining(); });
$('online').addEventListener('click', startOnline);
$('again').addEventListener('click', () => { if (net) showPlaying(); else startTraining(); });
$('resume').addEventListener('click', () => input.lock());
$('quit').addEventListener('click', (e) => { e.preventDefault(); toMenu(); });
$('endQuit').addEventListener('click', (e) => { e.preventDefault(); toMenu(); });
canvas.addEventListener('click', () => {
  if (state === 'playing' && !input.locked) input.lock();
});
canvas.addEventListener('mousedown', () => {
  if (state === 'playing' && input.locked && game.players[localId].ammo.length === 0) sfx.empty();
});

renderer = new Renderer(canvas, buildMap());
await renderer.load(); // boneco, animações e cenário
newGame({ withHuman: false, botCount: 8, skill: 'normal' });
last = performance.now();
requestAnimationFrame(frame);

// gancho para depuração/testes automatizados
window.__tinta = { get game() { return game; }, get state() { return state; }, get localId() { return localId; }, get net() { return net; }, input };
