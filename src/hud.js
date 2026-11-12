// HUD e telas (DOM).
import { PALETTE } from './sim/map.js';
import { CFG } from './sim/game.js';

const $ = (id) => document.getElementById(id);
const hex = (c) => '#' + c.toString(16).padStart(6, '0');
const SHIRT = '<svg viewBox="0 0 28 24"><path d="M8 3 L2 7 L5 12 L8 10 V22 H20 V10 L23 12 L26 7 L20 3 C18 6 10 6 8 3Z"/></svg>';
const CIRC = 150.8;

export class Hud {
  constructor() {
    $('title').innerHTML = [...'TINTA'].map((l) => `<span>${l}</span>`).join('') + '<br>' + [...'NELES!'].map((l) => `<span>${l}</span>`).join('');
    this.msgT = 0;
    this.lastBoard = '';
    this.lastBag = '';
  }

  show(id, on) { $(id).classList.toggle('hidden', !on); }

  start() {
    $('shirtRow').innerHTML = SHIRT.repeat(CFG.maxHp);
    $('feed').innerHTML = '';
    $('splats').innerHTML = '';
    this.lastBoard = this.lastBag = '';
    this.message('');
    this.show('dead', false);
  }

  resetShirts() {
    for (const p of $('shirtRow').querySelectorAll('path')) p.style.fill = '';
  }

  cleanShirt(hp) {
    const s = $('shirtRow').querySelectorAll('path')[hp - 1];
    if (s) s.style.fill = '';
  }

  paintShirt(hpLeft, color) {
    const s = $('shirtRow').querySelectorAll('path')[hpLeft];
    if (s) s.style.fill = hex(PALETTE[color]);
  }

  screenSplat(color) {
    const box = $('splats');
    const c = hex(PALETTE[color]);
    const cx = 15 + Math.random() * 70, cy = 15 + Math.random() * 60;
    for (let i = 0; i < 9; i++) {
      const d = document.createElement('div');
      const big = i === 0;
      const size = big ? 28 + Math.random() * 14 : 3 + Math.random() * 10;
      const a = Math.random() * Math.PI * 2, r = big ? 0 : 12 + Math.random() * 22;
      d.style.cssText = `width:${size}vmin;height:${size * (0.85 + Math.random() * 0.3)}vmin;left:calc(${cx + Math.cos(a) * r}% - ${size / 2}vmin);top:calc(${cy + Math.sin(a) * r}% - ${size / 2}vmin);background:${c};`;
      box.appendChild(d);
      setTimeout(() => d.remove(), 3000);
    }
  }

  hitmark() {
    const h = $('hitmark');
    h.classList.remove('on');
    void h.getBoundingClientRect();
    h.classList.add('on');
  }

  feed(html) {
    const f = $('feed');
    const d = document.createElement('div');
    d.innerHTML = html;
    f.appendChild(d);
    while (f.children.length > 5) f.firstChild.remove();
    setTimeout(() => d.remove(), 5000);
  }

  message(text, secs = 2) {
    $('msg').textContent = text;
    this.show('msg', !!text);
    this.msgT = text ? secs : 0;
  }

  dead(text, sub) {
    this.show('dead', !!text);
    if (text) { $('deadText').textContent = text; $('deadSub').textContent = sub; }
  }

  update(game, me, dt) {
    const t = Math.ceil(game.timeLeft);
    const timer = $('timer');
    timer.textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    timer.classList.toggle('low', t <= 20);

    $('charge').setAttribute('stroke-dashoffset', String(CIRC * (1 - me.charge)));

    const bagKey = me.ammo.length + ':' + me.ammo.slice(0, 7).join(',');
    if (bagKey !== this.lastBag) {
      this.lastBag = bagKey;
      $('bagCount').innerHTML = `${me.ammo.length}<span>/${CFG.bagSize}</span>`;
      $('bag').classList.toggle('empty', me.ammo.length === 0);
      $('bagNext').innerHTML = me.ammo.slice(0, 7).map((c) => `<i style="background:${hex(PALETTE[c])}"></i>`).join('');
    }

    const rank = game.ranking();
    const key = rank.map((p) => `${p.id}:${p.score}:${p.alive ? 1 : 0}`).join('|');
    if (key !== this.lastBoard) {
      this.lastBoard = key;
      $('boardList').innerHTML = rank.map((p) =>
        `<li class="${p.id === me.id ? 'me' : ''} ${p.alive ? '' : 'out'}"><span class="dot" style="background:${hex(p.color)}"></span><span class="nm">${esc(p.name)}</span><span class="pt">${p.score}</span></li>`).join('');
    }

    if (this.msgT > 0) {
      this.msgT -= dt;
      if (this.msgT <= 0) this.message('');
    } else if (me.alive && me.ammo.length === 0) {
      $('msg').textContent = 'Sem bexigas! Procure uma sacola (feixe amarelo)';
      this.show('msg', true);
    } else {
      this.show('msg', false);
    }

    if (!me.alive) $('deadSub').textContent = `Voltando em ${Math.max(1, Math.ceil(me.respawnT))}…`;
  }

  end(game, me) {
    const rank = game.ranking();
    const pos = rank.indexOf(me) + 1;
    $('endTitle').textContent = pos === 1 ? 'Você venceu!' : `Fim de jogo — você ficou em ${pos}º`;
    $('rankBody').innerHTML = rank.map((p, i) =>
      `<tr class="${p === me ? 'me' : ''}"><td>${i + 1}</td><td>${esc(p.name)}</td><td>${p.score}</td><td>${p.hits}</td><td>${p.kos}</td><td>${p.deaths}</td></tr>`).join('');
  }
}

export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
