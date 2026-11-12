// Teclado + mouse do jogador local. Gera o mesmo tipo de comando que os bots.
const SENS = 0.0022;

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.yaw = 0; this.pitch = 0;
    this.fire = false;
    this.locked = false;
    this.onLockChange = null;
    this.cmd = { mx: 0, mz: 0, yaw: 0, pitch: 0, jump: false, fire: false };

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) { this.keys.clear(); this.fire = false; }
      if (this.onLockChange) this.onLockChange(this.locked);
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.yaw -= e.movementX * SENS;
      this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch - e.movementY * SENS));
    });
    canvas.addEventListener('mousedown', (e) => { if (e.button === 0 && this.locked) this.fire = true; });
    document.addEventListener('mouseup', (e) => { if (e.button === 0) this.fire = false; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('keydown', (e) => {
      if (!this.locked) return;
      this.keys.add(e.code);
      if (e.code === 'Space' || e.code === 'Tab') e.preventDefault();
    });
    document.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.fire = false; });
  }

  lock() {
    try {
      const r = this.canvas.requestPointerLock();
      if (r && r.catch) r.catch(() => {});
    } catch { /* sem pointer lock (ex.: navegador headless) */ }
  }

  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }

  command() {
    const k = this.keys, c = this.cmd;
    c.mx = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    c.mz = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    c.yaw = this.yaw; c.pitch = this.pitch;
    c.jump = k.has('Space');
    c.fire = this.fire;
    return c;
  }
}
