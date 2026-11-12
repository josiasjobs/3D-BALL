// Bonecos articulados (Universal Animation Library, Quaternius, CC0).
// Corpo: animações do arquivo (parado, corrida, pulo, queda).
// Braço direito: pose de arremesso calculada aqui, para seguir a mira e a força.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { CFG } from '../sim/game.js';
import { outfitFor, clothMaterial, headGear } from './outfit.js';

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (t) => t * t * (3 - 2 * t);

const Y = new THREE.Vector3(0, 1, 0);
const X = new THREE.Vector3(1, 0, 0);
const GRIP = [0.35, 0.6, 0.45]; // quanto cada falange dobra segurando a bexiga (rad)
const _qw = new THREE.Quaternion(), _qp = new THREE.Quaternion(), _qd = new THREE.Quaternion();
const _a = new THREE.Vector3(), _b = new THREE.Vector3();
const _fwd = new THREE.Vector3(), _right = new THREE.Vector3(), _up = new THREE.Vector3();

// Poses do braço como direções [frente, cima, direita] do braço e do antebraço.
const HOLD = { u: [0.8, -0.5, 0.1], f: [0.8, 0.55, -0.15] };   // bexiga pronta, à frente do ombro
const WIND = { u: [0.2, 0.35, 0.7], f: [-0.35, 0.9, 0.1] };    // braço armado atrás da cabeça
const WIND_FP = { u: [0.75, 0.1, 0.45], f: [0.35, 0.9, -0.2] }; // versão que continua visível em 1ª pessoa
const REL = { u: [0.9, 0.3, 0.05], f: [0.95, -0.05, -0.05] };  // braço esticado no lançamento

export async function loadCharacterAsset() {
  const gltf = await new GLTFLoader().loadAsync('./assets/mannequin.glb');
  const clips = {};
  for (const c of gltf.animations) clips[c.name] = c;
  return { scene: gltf.scene, clips };
}

// Gira um osso no espaço do mundo.
function worldRotate(bone, qDelta) {
  bone.getWorldQuaternion(_qw);
  bone.parent.getWorldQuaternion(_qp);
  bone.quaternion.copy(_qp.invert()).multiply(_qd.copy(qDelta).multiply(_qw));
}

// Aponta o eixo do osso (Y local) para uma direção do mundo.
function aimBone(bone, dir) {
  bone.getWorldQuaternion(_qw);
  _a.copy(Y).applyQuaternion(_qw);
  _qd.setFromUnitVectors(_a, dir);
  bone.parent.getWorldQuaternion(_qp);
  bone.quaternion.copy(_qp.invert()).multiply(_qd.multiply(_qw));
}

const _q = new THREE.Quaternion();

export class Character {
  constructor(asset, player, { local, balloonGeo, balloonMats, nameSprite }) {
    this.local = local;
    this.balloonMats = balloonMats;
    this.root = new THREE.Group();
    const model = SkeletonUtils.clone(asset.scene);
    model.rotation.y = Math.PI; // o arquivo olha para +z; o jogo usa -z como frente
    this.root.add(model);

    const outfit = outfitFor(player);
    const cloth = clothMaterial(outfit);
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.material = cloth;
      o.castShadow = true;
      o.frustumCulled = false;
    });

    const bone = (n) => model.getObjectByName(n);
    this.head = bone('Head');
    // cabelo/boné/óculos: montados na pose base e depois presos ao osso da cabeça
    const gear = headGear(outfit);
    model.add(gear);
    model.updateMatrixWorld(true);
    this.head.attach(gear);
    this.spine1 = bone('spine_01'); this.spine2 = bone('spine_02'); this.chest = bone('spine_03');
    this.upper = bone('upperarm_r'); this.fore = bone('lowerarm_r'); this.hand = bone('hand_r');

    this.held = new THREE.Mesh(balloonGeo, balloonMats[0]);
    // bexiga pequena encostada na palma (a palma fica no lado -x do osso da mão)
    this.held.scale.set(0.36, 0.42, 0.36);
    this.held.position.set(-0.062, 0.1, -0.004);
    this.held.castShadow = true;
    this.hand.add(this.held);

    // dedos da mão direita: guardam a pose de repouso para fechar em volta da bexiga
    this.fingers = [];
    for (const f of ['index', 'middle', 'ring', 'pinky']) {
      for (let i = 1; i <= 3; i++) {
        const b = bone(`${f}_0${i}_r`);
        this.fingers.push({ bone: b, rest: b.quaternion.clone(), curl: GRIP[i - 1] });
      }
    }

    this.blobs = [];
    if (nameSprite) this.root.add(nameSprite);

    this.mixer = new THREE.AnimationMixer(model);
    const act = (name) => { const a = this.mixer.clipAction(asset.clips[name]); a.play(); a.setEffectiveWeight(0); return a; };
    this.idle = act('Idle_Loop');
    this.jog = act('Jog_Fwd_Loop');
    this.jump = act('Jump_Loop');
    this.death = this.mixer.clipAction(asset.clips.Death01);
    this.death.setLoop(THREE.LoopOnce, 1);
    this.death.clampWhenFinished = true;
    this.idle.time = Math.random() * 2;

    this.move = 0; this.air = 0; this.twist = 0; this.dir = 1;
    this.throwT = 0; this.hitT = 0; this.dead = false; this.bob = 0;
    this.curU = new THREE.Vector3(); this.curF = new THREE.Vector3();
    this.startU = new THREE.Vector3(); this.startF = new THREE.Vector3();
  }

  onThrow() {
    this.throwT = 1;
    this.startU.copy(this.curU); this.startF.copy(this.curF);
  }

  onHit(e, p, blobMat) {
    this.hitT = 1;
    // mancha de tinta presa ao peito, do lado em que a bexiga bateu
    let dx = e.x - p.x, dz = e.z - p.z;
    const l = Math.hypot(dx, dz) || 1;
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), blobMat);
    b.scale.set(1, 1.3, 1);
    b.position.set(p.x + (dx / l) * 0.13, p.y + clamp(e.y - p.y, 1.0, 1.45), p.z + (dz / l) * 0.13);
    this.chest.worldToLocal(b.position);
    this.chest.add(b);
    this.blobs.push(b);
  }

  // trocou de roupa: some a mancha mais antiga
  onHeal() {
    const b = this.blobs.shift();
    if (b) this.chest.remove(b);
  }

  onRespawn() {
    for (const b of this.blobs) this.chest.remove(b);
    this.blobs.length = 0;
    this.hitT = 0; this.throwT = 0;
  }

  // p: jogador na simulação; look: { yaw, pitch } para onde ele mira
  update(p, dt, alpha, look) {
    const yaw = look.yaw, pitch = look.pitch;
    const sy = Math.sin(yaw), cy = Math.cos(yaw);

    // --- corpo: mistura parado / corrida / pulo, ou queda ---
    if (!p.alive && !this.dead) {
      this.dead = true;
      this.death.reset().play();
      this.death.setEffectiveWeight(1);
      this.idle.setEffectiveWeight(0); this.jog.setEffectiveWeight(0); this.jump.setEffectiveWeight(0);
    } else if (p.alive && this.dead) {
      this.dead = false;
      this.death.stop();
    }
    this.head.scale.setScalar(this.local && p.alive ? 0.001 : 1);

    if (!this.dead) {
      const fs = p.vx * -sy + p.vz * -cy;  // velocidade para frente
      const ss = p.vx * cy + p.vz * -sy;   // velocidade para a direita
      const sp = Math.hypot(fs, ss);
      let ang = 0;
      if (sp > 0.6) {
        ang = Math.atan2(ss, fs);
        this.dir = 1;
        if (Math.abs(ang) > Math.PI * 0.6) { ang -= Math.sign(ang) * Math.PI; this.dir = -1; } // andando de costas
        ang = clamp(ang, -1.1, 1.1);
      }
      const k = 1 - Math.exp(-10 * dt);
      this.twist += (ang - this.twist) * k;
      this.move += (clamp(sp / 4, 0, 1) - this.move) * k;
      this.air += ((p.onGround ? 0 : 1) - this.air) * (1 - Math.exp(-14 * dt));
      this.idle.setEffectiveWeight((1 - this.move) * (1 - this.air));
      this.jog.setEffectiveWeight(this.move * (1 - this.air));
      this.jump.setEffectiveWeight(this.air);
      this.jog.timeScale = this.dir * clamp(sp / 4.6, 0.6, 1.6);
      this.bob += dt * clamp(sp / 4.6, 0, 1.6) * (p.onGround ? 1 : 0);
    }
    this.mixer.update(dt);

    // --- posição e giro: as pernas viram para onde anda, o tronco continua na mira ---
    const tw = this.dead ? 0 : this.twist;
    const back = this.local ? 0.18 : 0; // em 1ª pessoa o corpo fica atrás da câmera
    this.root.position.set(
      lerp(p.px, p.x, alpha) + sy * back,
      lerp(p.py, p.y, alpha),
      lerp(p.pz, p.z, alpha) + cy * back,
    );
    this.root.rotation.y = yaw - tw;
    if (this.dead) { this.held.visible = false; return; }

    this.root.updateMatrixWorld(true);
    _right.set(cy, 0, -sy);
    this.hitT = Math.max(0, this.hitT - dt * 3.5);
    if (this.local) {
      // 1ª pessoa: some com tronco, cabeça e braço esquerdo (encolhidos num ponto);
      // ficam as pernas e o braço do arremesso, que é reposicionado junto da câmera
      this.spine1.scale.setScalar(0.01);
      this.upper.scale.setScalar(100);
    } else {
      worldRotate(this.spine1, _q.setFromAxisAngle(Y, tw));
      const lean = pitch * 0.45 - Math.sin(this.hitT * Math.PI) * 0.3;
      if (lean) worldRotate(this.spine2, _q.setFromAxisAngle(_right, lean));
    }

    // --- braço do arremesso ---
    const cp = Math.cos(pitch);
    _fwd.set(-sy * cp, Math.sin(pitch), -cy * cp);
    _up.crossVectors(_right, _fwd);
    const dirOf = (v, out) => out.set(0, 0, 0).addScaledVector(_fwd, v[0]).addScaledVector(_up, v[1]).addScaledVector(_right, v[2]).normalize();

    if (this.local) {
      // em 1ª pessoa o ombro acompanha a câmera, como se o braço saísse de baixo do olhar
      _a.copy(this.root.position);
      _a.x -= sy * back; _a.z -= cy * back; _a.y += CFG.eye; // posição da câmera
      _a.addScaledVector(_fwd, 0.08).addScaledVector(_right, 0.2).addScaledVector(_up, -0.24);
      this.upper.parent.updateWorldMatrix(true, false);
      this.upper.position.copy(this.upper.parent.worldToLocal(_a));
    }
    const wind = this.local ? WIND_FP : WIND;

    if (this.throwT > 0) {
      this.throwT = Math.max(0, this.throwT - dt * 2.4);
      const t = 1 - this.throwT;
      if (t < 0.3) {
        const s = smooth(t / 0.3);
        this.curU.copy(this.startU).lerp(dirOf(REL.u, _a), s).normalize();
        this.curF.copy(this.startF).lerp(dirOf(REL.f, _b), s).normalize();
      } else {
        const s = smooth((t - 0.3) / 0.7);
        dirOf(REL.u, this.curU).lerp(dirOf(HOLD.u, _a), s).normalize();
        dirOf(REL.f, this.curF).lerp(dirOf(HOLD.f, _b), s).normalize();
      }
    } else {
      const s = smooth(p.charge);
      dirOf(HOLD.u, this.curU).lerp(dirOf(wind.u, _a), s).normalize();
      dirOf(HOLD.f, this.curF).lerp(dirOf(wind.f, _b), s).normalize();
    }
    aimBone(this.upper, this.curU);
    aimBone(this.fore, this.curF);
    aimBone(this.hand, this.curF);

    this.held.visible = p.ammo.length > 0 && this.throwT < 0.45;
    // dedos: curvados em volta da bexiga, ou mão mais fechada quando está vazia
    const grip = this.held.visible ? 1 : 1.9;
    for (const f of this.fingers) {
      f.bone.quaternion.copy(f.rest).multiply(_q.setFromAxisAngle(X, f.curl * grip));
    }
    if (p.ammo.length) this.held.material = this.balloonMats[p.ammo[0]];
  }
}
