// Tudo que é visual (Three.js). Só lê o estado da simulação; nunca o altera.
import * as THREE from 'three';
import { PALETTE } from '../sim/map.js';
import { CFG } from '../sim/game.js';
import { loadCharacterAsset, Character } from './characters.js';
import { loadWorldAssets, buildWorld } from './world.js';

const lerp = (a, b, t) => a + (b - a) * t;
const DECAL_CAP = 320;
const PART_CAP = 400;
const ARC_N = 26;

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _v = new THREE.Vector3(), _s = new THREE.Vector3(), _n = new THREE.Vector3();
const _c = new THREE.Color();
const Z = new THREE.Vector3(0, 0, 1);

function splatTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  const blob = (x, y, r) => { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); };
  blob(128, 128, 52);
  const lobes = 9 + Math.floor(Math.random() * 5);
  for (let i = 0; i < lobes; i++) {
    const a = (i / lobes) * Math.PI * 2 + Math.random() * 0.5;
    const len = 44 + Math.random() * 46;
    const r = 12 + Math.random() * 16;
    for (let k = 0; k <= 6; k++) {
      const d = 30 + (len - 30) * (k / 6);
      blob(128 + Math.cos(a) * d, 128 + Math.sin(a) * d, lerp(r, r * 0.55, k / 6));
    }
    blob(128 + Math.cos(a) * len, 128 + Math.sin(a) * len, r * 0.8);
  }
  for (let i = 0; i < 16; i++) {
    const a = Math.random() * Math.PI * 2, d = 78 + Math.random() * 40;
    blob(128 + Math.cos(a) * d, 128 + Math.sin(a) * d, 2 + Math.random() * 6);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function nameSprite(name, color) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.font = '900 34px ui-rounded, "Trebuchet MS", system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 7; g.strokeStyle = 'rgba(20,20,35,0.9)'; g.lineJoin = 'round';
  g.strokeText(name, 128, 34);
  g.fillStyle = '#' + color.toString(16).padStart(6, '0');
  g.fillText(name, 128, 34);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false }));
  s.scale.set(1.9, 0.475, 1);
  s.position.y = 2.2;
  return s;
}

export class Renderer {
  constructor(canvas, map) {
    this.map = map;
    this.r = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.r.shadowMap.enabled = true;
    this.r.shadowMap.type = THREE.PCFShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xa9dcff);
    this.scene.fog = new THREE.Fog(0xa9dcff, 55, 130);
    this.camera = new THREE.PerspectiveCamera(75, 1, 0.05, 250);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xd9d6cf, 1.7));
    const sun = new THREE.DirectionalLight(0xfff4e6, 1.6);
    sun.position.set(24, 40, 14);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = sc.bottom = -44; sc.right = sc.top = 44; sc.near = 1; sc.far = 110;
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
    this.scene.add(sun);

    this.balloonGeo = new THREE.SphereGeometry(CFG.balloonR, 14, 10);
    this.balloonMats = PALETTE.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.22, metalness: 0.05 }));
    this.blobMats = PALETTE.map((c) => new THREE.MeshLambertMaterial({ color: c }));

    this.buildDecals();
    this.buildParticles();
    this.buildBags();
    this.buildShirts();
    this.buildArc();

    this.dynamic = new THREE.Group();
    this.scene.add(this.dynamic);
    this.models = [];
    this.balloonMeshes = new Map();
    this.balloonPool = [];
    this.time = 0;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  async load() {
    const [chars, world] = await Promise.all([loadCharacterAsset(), loadWorldAssets()]);
    this.asset = chars;
    buildWorld(this.scene, this.map, world);
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.r.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ---------- efeitos ----------
  buildDecals() {
    const geo = new THREE.PlaneGeometry(1, 1);
    this.decals = [];
    for (let i = 0; i < 3; i++) {
      const mat = new THREE.MeshLambertMaterial({
        map: splatTexture(), transparent: true, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
      });
      const mesh = new THREE.InstancedMesh(geo, mat, DECAL_CAP);
      mesh.frustumCulled = false;
      mesh.receiveShadow = true;
      mesh.count = 0;
      mesh.setColorAt(0, _c.set(0xffffff));
      mesh.userData.total = 0;
      this.scene.add(mesh);
      this.decals.push(mesh);
    }
    this.decalSeq = 0;
  }

  addDecal(e) {
    let size = 1.5 + Math.random() * 1.3;
    let x = e.x, y = e.y, z = e.z;
    const R = CFG.balloonR;
    x -= e.nx * R; y -= e.ny * R; z -= e.nz * R; // encosta na superfície
    if (e.box >= 0 && e.axis >= 0) {
      // mantém a mancha dentro da face atingida
      const b = this.map.boxes[e.box];
      const pos = [x, y, z];
      for (let j = 0; j < 3; j++) {
        if (j === e.axis) continue;
        size = Math.min(size, (b.max[j] - b.min[j]) * 1.15);
      }
      for (let j = 0; j < 3; j++) {
        if (j === e.axis) continue;
        const h = size * 0.38, lo = b.min[j] + h, hi = b.max[j] - h;
        pos[j] = lo > hi ? (b.min[j] + b.max[j]) / 2 : Math.max(lo, Math.min(hi, pos[j]));
      }
      [x, y, z] = pos;
    }
    const seq = this.decalSeq++;
    const lift = 0.012 + (seq % 60) * 0.0005;
    _n.set(e.nx, e.ny, e.nz);
    _q.setFromUnitVectors(Z, _n);
    _q2.setFromAxisAngle(Z, Math.random() * Math.PI * 2);
    _q.multiply(_q2);
    _v.set(x + e.nx * lift, y + e.ny * lift, z + e.nz * lift);
    _s.set(size, size, 1);
    _m.compose(_v, _q, _s);
    const mesh = this.decals[seq % this.decals.length];
    const i = mesh.userData.total % DECAL_CAP;
    mesh.userData.total++;
    mesh.count = Math.min(mesh.userData.total, DECAL_CAP);
    mesh.setMatrixAt(i, _m);
    mesh.setColorAt(i, _c.set(PALETTE[e.color]));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
  }

  buildParticles() {
    const mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.06, 6, 5), new THREE.MeshLambertMaterial(), PART_CAP);
    mesh.frustumCulled = false;
    _m.makeScale(0, 0, 0);
    for (let i = 0; i < PART_CAP; i++) { mesh.setMatrixAt(i, _m); mesh.setColorAt(i, _c.set(0xffffff)); }
    this.scene.add(mesh);
    this.parts = { mesh, next: 0, data: Array.from({ length: PART_CAP }, () => ({ life: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, s: 1 })) };
  }

  burst(e) {
    const P = this.parts;
    for (let k = 0; k < 16; k++) {
      const i = P.next; P.next = (P.next + 1) % PART_CAP;
      const d = P.data[i];
      d.life = 0.45 + Math.random() * 0.35;
      d.x = e.x; d.y = e.y; d.z = e.z;
      d.vx = e.nx * 3 + (Math.random() - 0.5) * 7;
      d.vy = e.ny * 3 + Math.random() * 5;
      d.vz = e.nz * 3 + (Math.random() - 0.5) * 7;
      d.s = 0.6 + Math.random() * 1.3;
      P.mesh.setColorAt(i, _c.set(PALETTE[e.color]));
    }
    P.mesh.instanceColor.needsUpdate = true;
  }

  updateParticles(dt) {
    const P = this.parts;
    for (let i = 0; i < PART_CAP; i++) {
      const d = P.data[i];
      if (d.life <= 0) continue;
      d.life -= dt;
      d.vy -= 16 * dt;
      d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
      const s = d.life <= 0 || d.y < 0 ? 0 : d.s * Math.min(1, d.life * 4);
      if (s === 0) d.life = 0;
      _m.makeScale(s, s, s).setPosition(d.x, d.y, d.z);
      P.mesh.setMatrixAt(i, _m);
    }
    P.mesh.instanceMatrix.needsUpdate = true;
  }

  // Roupas limpas: camiseta branca girando, com anel e feixe azul-claro
  buildShirts() {
    const sh = new THREE.Shape();
    const pts = [[-0.3, 0.42], [-0.62, 0.2], [-0.46, -0.06], [-0.3, 0.04], [-0.3, -0.5], [0.3, -0.5], [0.3, 0.04], [0.46, -0.06], [0.62, 0.2], [0.3, 0.42]];
    sh.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) sh.lineTo(pts[i][0], pts[i][1]);
    sh.quadraticCurveTo(0, 0.24, -0.3, 0.42); // gola
    const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.1, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 2 });
    geo.translate(0, 0, -0.05);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, emissive: 0x2a4a66, emissiveIntensity: 0.35 });
    this.shirtModels = this.map.shirtSpots.map((s) => {
      const root = new THREE.Group();
      root.position.set(s[0], s[1], s[2]);
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.75, 0.95, 28),
        new THREE.MeshBasicMaterial({ color: 0x5ad1ff, transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
      );
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03;
      const body = new THREE.Mesh(geo, mat);
      body.scale.setScalar(0.8);
      body.castShadow = true;
      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.3, 0.3, 9, 16, 1, true),
        new THREE.MeshBasicMaterial({ color: 0x5ad1ff, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide }),
      );
      beam.position.y = 5.5;
      root.add(ring, body, beam);
      this.scene.add(root);
      return { body, beam, ring };
    });
  }

  buildBags() {
    this.bagModels = this.map.bagSpots.map((s) => {
      const root = new THREE.Group();
      root.position.set(s[0], s[1], s[2]);
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.75, 0.95, 28),
        new THREE.MeshBasicMaterial({ color: 0xffb300, transparent: true, opacity: 0.8, side: THREE.DoubleSide }),
      );
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03;
      root.add(ring);
      const body = new THREE.Group();
      const sack = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 12), new THREE.MeshLambertMaterial({ color: 0xc79a5e }));
      sack.scale.set(1, 0.85, 0.8); sack.castShadow = true;
      body.add(sack);
      const strap = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.035, 8, 20, Math.PI), new THREE.MeshLambertMaterial({ color: 0x7a5a30 }));
      strap.position.y = 0.22;
      body.add(strap);
      for (let i = 0; i < 5; i++) {
        const b = new THREE.Mesh(this.balloonGeo, this.balloonMats[(i * 3 + Math.floor(s[0] + s[2] + 40)) % PALETTE.length]);
        const a = (i / 5) * Math.PI * 2;
        b.position.set(Math.cos(a) * 0.18, 0.3 + (i % 2) * 0.07, Math.sin(a) * 0.14);
        body.add(b);
      }
      root.add(body);
      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.3, 0.3, 9, 16, 1, true),
        new THREE.MeshBasicMaterial({ color: 0xffc400, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide }),
      );
      beam.position.y = 5.5;
      root.add(beam);
      this.scene.add(root);
      return { root, body, beam, ring };
    });
  }

  buildArc() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ARC_N * 3), 3));
    this.arc = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0x1c1b2b, size: 0.1, transparent: true, opacity: 0.75, depthWrite: false }));
    this.arc.frustumCulled = false;
    this.arc.visible = false;
    this.scene.add(this.arc);
  }

  // ---------- partida ----------
  setGame(game, localId) {
    this.game = game; this.localId = localId;
    this.dynamic.clear();
    this.models = [];
    this.balloonMeshes.clear();
    this.balloonPool = [];
    for (const d of this.decals) { d.count = 0; d.userData.total = 0; }
    for (const d of this.parts.data) d.life = 0;
    _m.makeScale(0, 0, 0);
    for (let i = 0; i < PART_CAP; i++) this.parts.mesh.setMatrixAt(i, _m);
    for (const p of game.players) {
      const local = p.id === localId;
      const c = new Character(this.asset, p, {
        local, balloonGeo: this.balloonGeo, balloonMats: this.balloonMats,
        nameSprite: local ? null : nameSprite(p.name, p.color),
      });
      this.dynamic.add(c.root);
      this.models.push(c);
    }
  }

  handle(e) {
    if (e.type === 'splat') {
      this.burst(e);
      if (e.victim < 0) this.addDecal(e);
    } else if (e.type === 'hit') {
      this.models[e.victim].onHit(e, this.game.players[e.victim], this.blobMats[e.color]);
    } else if (e.type === 'respawn') {
      this.models[e.id].onRespawn();
    } else if (e.type === 'throw') {
      this.models[e.owner].onThrow();
    }
  }

  // ---------- quadro ----------
  render(dt, alpha, view) {
    const g = this.game;
    this.time += dt;
    const t = this.time;

    for (const p of g.players) {
      const m = this.models[p.id];
      const local = p.id === this.localId;
      if (p.out) { m.root.visible = false; continue; } // vaga vazia
      m.root.visible = !p.alive || local || !(p.invuln > 0 && Math.floor(t * 12) % 2 === 0);
      m.update(p, dt, alpha, local && p.alive ? view : p);
    }

    // bexigas no ar
    const seen = new Set();
    for (const b of g.balloons) {
      let mesh = this.balloonMeshes.get(b.id);
      if (!mesh) {
        mesh = this.balloonPool.pop() || new THREE.Mesh(this.balloonGeo, this.balloonMats[0]);
        mesh.material = this.balloonMats[b.color];
        mesh.castShadow = true;
        mesh.scale.set(0.75, 0.88, 0.75);
        this.dynamic.add(mesh);
        this.balloonMeshes.set(b.id, mesh);
      }
      mesh.position.set(lerp(b.px, b.x, alpha), lerp(b.py, b.y, alpha), lerp(b.pz, b.z, alpha));
      mesh.rotation.x += dt * 9;
      seen.add(b.id);
    }
    for (const [id, mesh] of this.balloonMeshes) {
      if (!seen.has(id)) { this.dynamic.remove(mesh); this.balloonPool.push(mesh); this.balloonMeshes.delete(id); }
    }

    for (const sh of g.shirts) {
      const m = this.shirtModels[sh.id];
      m.body.visible = m.beam.visible = sh.active;
      m.ring.material.opacity = sh.active ? 0.85 : 0.2;
      m.body.position.y = 1.0 + Math.sin(t * 2.2 + sh.id * 1.7) * 0.12;
      m.body.rotation.y = t * 1.5 + sh.id;
    }
    for (const bag of g.bags) {
      const m = this.bagModels[bag.id];
      m.body.visible = m.beam.visible = bag.active;
      m.ring.material.opacity = bag.active ? 0.8 : 0.2;
      m.body.position.y = 0.75 + Math.sin(t * 2.2 + bag.id) * 0.12;
      m.body.rotation.y = t * 1.3 + bag.id;
    }

    this.updateParticles(dt);

    const me = this.localId >= 0 ? g.players[this.localId] : null;
    if (me) {
      const x = lerp(me.px, me.x, alpha), y = lerp(me.py, me.y, alpha), z = lerp(me.pz, me.z, alpha);
      if (me.alive) {
        // balanço leve da cabeça ao correr
        const m = this.models[me.id];
        const bob = Math.sin(m.bob * 13.5) * 0.028 * m.move * (1 - m.air);
        this.camera.position.set(x, y + CFG.eye + bob, z);
        this.camera.rotation.set(view.pitch, view.yaw, 0);
      } else {
        // câmera sobe e olha o próprio boneco caído enquanto espera renascer
        const k = 1 - Math.max(0, me.respawnT) / CFG.respawn;
        this.camera.position.set(x, y + CFG.eye + k * 4, z);
        this.camera.rotation.set(lerp(view.pitch, -1.4, Math.min(1, k * 2.5)), view.yaw, 0);
      }
      this.updateArc(me);
    } else {
      // modo demonstração: câmera girando em volta da arena
      const a = t * 0.12;
      this.camera.position.set(Math.cos(a) * 36, 19, Math.sin(a) * 36);
      this.camera.lookAt(0, 1, 0);
      this.arc.visible = false;
    }
    this.r.render(this.scene, this.camera);
  }

  updateArc(me) {
    const show = me.alive && me.charging;
    this.arc.visible = show;
    if (!show) return;
    const l = this.game.launch(me, me.charge);
    const pos = this.arc.geometry.attributes.position;
    const h = 0.045;
    let x = l.x, y = l.y, z = l.z, vy = l.vy, stop = false;
    for (let i = -4; i < ARC_N; i++) { // pula o trecho colado na câmera
      if (!stop) {
        vy -= CFG.balloonG * h;
        x += l.vx * h; y += vy * h; z += l.vz * h;
        if (y < 0.05) { y = 0.05; stop = true; }
      }
      if (i >= 0) pos.setXYZ(i, x, y, z);
    }
    pos.needsUpdate = true;
  }
}
