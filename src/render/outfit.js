// Roupa e textura do boneco. A malha do manequim não tem roupa, então o material
// "pinta" cada região pela posição na pose base (T): tênis, calça, cinto, camiseta, pele.
// O tecido (trama do jeans, malha da camiseta) também é gerado no shader.
import * as THREE from 'three';

const SKINS = [0xf1c9a5, 0xd9a273, 0xb97c4f, 0x8a5a3a, 0xe8b48c, 0x6e4530];
const HAIRS = [0x2a1d14, 0x4a2f1b, 0x111114, 0x8a5a2b, 0xc9a25a, 0x5b2a1a];
const PANTS = [0x2f4a7a, 0x34363f, 0x5a6a3a, 0x7a6a52, 0x1f2a44, 0x4a3a5a];
const SHOES = [0x2b2b33, 0xe9e6df, 0xb3262e, 0x23406e];

export function outfitFor(player) {
  const i = player.id;
  return {
    shirt: player.color,
    skin: SKINS[(i * 5 + 1) % SKINS.length],
    hair: HAIRS[(i * 3 + 2) % HAIRS.length],
    pants: PANTS[(i * 2 + 1) % PANTS.length],
    shoe: SHOES[i % SHOES.length],
    cap: i % 3 !== 1,      // parte usa boné, parte só cabelo
    long: i % 4 === 2,     // manga comprida
  };
}

export function clothMaterial(o) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0 });
  const u = {
    uShirt: { value: new THREE.Color(o.shirt) },
    uPants: { value: new THREE.Color(o.pants) },
    uSkin: { value: new THREE.Color(o.skin) },
    uShoe: { value: new THREE.Color(o.shoe) },
    uSleeve: { value: o.long ? 0.74 : 0.39 }, // até onde a manga vai no braço (m a partir do centro)
  };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBind;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBind = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vBind;
uniform vec3 uShirt, uPants, uSkin, uShoe;
uniform float uSleeve;
float hash3(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  vec3 b = vBind;
  float ax = abs(b.x);
  float grain = hash3(floor(b * 500.0));
  vec3 c;
  float rough = 0.85;
  if (ax < 0.32 && b.y < 0.115) {
    // tênis: sola clara, cadarço
    c = b.y < 0.035 ? vec3(0.93) : uShoe;
    if (b.y > 0.06 && b.z > 0.06 && abs(fract(b.z * 45.0) - 0.5) < 0.16) c = vec3(0.9);
    rough = 0.6;
  } else if (ax < 0.32 && b.y < 0.985) {
    // calça: trama diagonal + costura lateral + barra
    float twill = sin((b.x + b.y + b.z) * 1100.0) * 0.5 + 0.5;
    c = uPants * (0.8 + 0.2 * twill) * (0.92 + 0.08 * grain);
    float leg = abs(ax - 0.1);
    if (b.y < 0.9 && leg > 0.083 && leg < 0.088 && b.x * sign(b.x) > 0.1) c *= 1.35;
    if (b.y < 0.15) c *= 0.8;
  } else if (ax < 0.32 && b.y < 1.03) {
    // cinto com fivela
    c = vec3(0.09, 0.07, 0.06);
    if (ax < 0.035 && b.z > 0.0) c = vec3(0.75, 0.68, 0.4);
    rough = 0.5;
  } else if (ax < uSleeve && b.y < 1.535) {
    // camiseta: malha fina, faixa no peito, punho e gola
    float knit = sin(b.y * 1400.0) * 0.5 + 0.5;
    c = uShirt * (0.9 + 0.1 * knit) * (0.94 + 0.06 * grain);
    if (ax < 0.215 && b.y > 1.255 && b.y < 1.3) c = vec3(0.95);
    if (ax > uSleeve - 0.025) c = vec3(0.95);
    if (ax < 0.085 && b.y > 1.5) c = vec3(0.95);
    if (ax < 0.215 && b.y < 1.05) c *= 0.85;
  } else {
    c = uSkin * (0.97 + 0.03 * grain);
    rough = 0.6;
  }
  diffuseColor.rgb = c;
  vBindRough = rough;
}`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = vBindRough;')
      .replace('void main() {', 'float vBindRough = 0.85;\nvoid main() {');
  };
  return m;
}

// Cabelo, boné e óculos de proteção, em coordenadas da pose base (cabeça: centro ~ y 1.715).
export function headGear(o) {
  const g = new THREE.Group();
  const mat = (color, rough = 0.8) => new THREE.MeshStandardMaterial({ color, roughness: rough });
  const add = (geo, m, x, y, z, sx = 1, sy = 1, sz = 1) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z); mesh.scale.set(sx, sy, sz); mesh.castShadow = true;
    g.add(mesh);
    return mesh;
  };
  const dome = new THREE.SphereGeometry(1, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.55);
  // cabelo: calota cobrindo o topo e a nuca
  const hair = add(dome, mat(o.hair, 0.95), 0, 1.735, -0.012, 0.097, 0.108, 0.125);
  hair.rotation.x = -0.28;
  if (o.cap) {
    hair.scale.multiplyScalar(0.93); hair.position.y -= 0.022; // cabelo só aparece abaixo do boné
    const cap = mat(o.shirt, 0.7);
    const top = add(dome, cap, 0, 1.752, 0.004, 0.101, 0.092, 0.127);
    top.rotation.x = 0.06;
    add(new THREE.CylinderGeometry(0.075, 0.075, 0.012, 16, 1, false, -Math.PI / 2, Math.PI), cap, 0, 1.757, 0.105, 1, 1, 1.25).rotation.x = 0.12;
  }
  // óculos de proteção: armação escura + lente espelhada + tira
  add(new THREE.BoxGeometry(0.168, 0.058, 0.05), mat(0x1c1b2b, 0.5), 0, 1.705, 0.098);
  add(new THREE.BoxGeometry(0.15, 0.04, 0.012), new THREE.MeshStandardMaterial({ color: 0x66d0ff, roughness: 0.15, metalness: 0.6 }), 0, 1.705, 0.125);
  add(new THREE.CylinderGeometry(0.094, 0.094, 0.022, 20, 1, true), mat(0x1c1b2b, 0.7), 0, 1.705, 0.005, 1, 1, 1.2);
  return g;
}
