// Efeitos sonoros sintetizados (WebAudio), sem arquivos de áudio.
let ctx = null, noise = null, master = null;

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);
  noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}

function burst(vol, dur, type, f0, f1) {
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noise;
  src.playbackRate.value = 0.7 + Math.random() * 0.6;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(f0, t);
  f.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t, Math.random() * 0.5, dur + 0.05);
}

function tone(vol, dur, wave, f0, f1, delay = 0) {
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  o.type = wave;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(master);
  o.start(t); o.stop(t + dur + 0.02);
}

export const sfx = {
  throw(vol = 1) { if (ctx) burst(0.25 * vol, 0.18, 'bandpass', 500, 2200); },
  splat(vol = 1) {
    if (!ctx || vol < 0.03) return;
    burst(0.7 * vol, 0.22, 'lowpass', 2600, 250);
    tone(0.35 * vol, 0.12, 'sine', 190, 60);
  },
  hit() { if (ctx) { tone(0.3, 0.09, 'triangle', 880, 1320); tone(0.25, 0.12, 'triangle', 1320, 1760, 0.07); } },
  hurt() { if (ctx) { tone(0.5, 0.25, 'sawtooth', 220, 70); burst(0.5, 0.2, 'lowpass', 900, 200); } },
  ko() { if (ctx) { tone(0.3, 0.12, 'square', 523, 523); tone(0.3, 0.12, 'square', 659, 659, 0.1); tone(0.3, 0.22, 'square', 784, 784, 0.2); } },
  pickup() { if (ctx) { tone(0.3, 0.1, 'triangle', 440, 660); tone(0.3, 0.1, 'triangle', 660, 990, 0.08); tone(0.3, 0.16, 'triangle', 990, 1320, 0.16); } },
  empty() { if (ctx) tone(0.2, 0.06, 'square', 140, 110); },
};
