// Cenário montado com os kits KayKit (Kay Lousberg, CC0):
//  - City Builder Bits: ruas, calçadas, prédios, carros, caçambas, postes
//  - Platformer Pack: barreiras acolchoadas, plataformas, pilares, caixotes, bandeiras
// Cada caixa de colisão do mapa (src/sim/map.js) recebe um modelo esticado para caber nela,
// então o que se vê bate com o que colide. O resto (prédios, postes) é só decoração.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const CITY = ['base', 'road_straight', 'road_straight_crossing', 'road_junction',
  'building_A', 'building_B', 'building_C', 'building_D', 'building_E', 'building_F', 'building_G', 'building_H',
  'car_taxi', 'car_police', 'car_sedan', 'car_hatchback',
  'streetlight', 'bush', 'firehydrant', 'bench', 'dumpster', 'trafficlight_A'];
const PLAT = ['barrier_4x1x2', 'barrier_4x1x4', 'pillar_1x1x4', 'platform_wood_1x1x1', 'cone',
  'platform_6x6x2_blue', 'platform_2x2x1_blue',
  'barrier_4x1x1_blue', 'barrier_4x1x1_red', 'barrier_4x1x1_yellow', 'barrier_4x1x1_green',
  'flag_A_blue', 'flag_A_red', 'flag_A_yellow', 'flag_A_green'];

const CITY_SCALE = 5;   // o kit de cidade é miniatura: 1 peça de rua = 2 unidades = 10 m
const TILE = 10;

// kind da caixa -> modelo e comprimento de cada peça repetida
const KIND = {
  border: { model: 'barrier_4x1x2', tile: 4 },
  wall: { model: 'barrier_4x1x4', tile: 4 },
  low: { model: (b) => `barrier_4x1x1_${b.color || 'blue'}`, tile: 6 },
  parapet: { model: 'barrier_4x1x1_blue', tile: 4 },
  fort: { model: 'platform_6x6x2_blue' },
  step: { model: 'platform_2x2x1_blue' },
  crate: { model: 'platform_wood_1x1x1' },
  pillar: { model: 'pillar_1x1x4' },
  dumpster: { model: 'dumpster' },
};

export async function loadWorldAssets() {
  const loader = new GLTFLoader();
  const out = {};
  const load = async (dir, name) => {
    const g = await loader.loadAsync(`./assets/${dir}/${name}.gltf`);
    g.scene.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(g.scene);
    out[name] = { scene: g.scene, min: bb.min.clone(), size: bb.getSize(new THREE.Vector3()) };
  };
  await Promise.all([...CITY.map((n) => load('city', n)), ...PLAT.map((n) => load('platformer', n))]);
  return out;
}

function shadows(obj, cast, receive) {
  obj.traverse((o) => { if (o.isMesh) { o.castShadow = cast; o.receiveShadow = receive; } });
  return obj;
}

// Clona um modelo e o estica para ocupar exatamente (lx, h, lz), com a base em y=0 e centrado.
function fitted(asset, lx, h, lz) {
  const m = asset.scene.clone(true);
  const sx = lx / asset.size.x, sy = h / asset.size.y, sz = lz / asset.size.z;
  m.scale.set(sx, sy, sz);
  m.position.set(
    -(asset.min.x + asset.size.x / 2) * sx,
    -asset.min.y * sy,
    -(asset.min.z + asset.size.z / 2) * sz,
  );
  const g = new THREE.Group();
  g.add(m);
  return g;
}

// Modelo do kit de cidade em escala uniforme, apoiado no chão.
function cityProp(assets, name, x, z, rot = 0, y = 0, scale = CITY_SCALE) {
  const a = assets[name];
  const m = a.scene.clone(true);
  m.scale.setScalar(scale);
  m.position.y = -a.min.y * scale;
  const g = new THREE.Group();
  g.add(m);
  g.position.set(x, y, z);
  g.rotation.y = rot;
  return g;
}

export function buildWorld(scene, map, assets) {
  const world = new THREE.Group();
  scene.add(world);

  // chão de fundo, por baixo de tudo
  const under = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshLambertMaterial({ color: 0x6f747c }));
  under.rotation.x = -Math.PI / 2; under.position.y = -0.2;
  world.add(under);

  // --- piso: cruzamento de duas ruas, calçada nos quatro cantos ---
  for (let i = -3; i <= 3; i++) {
    for (let j = -3; j <= 3; j++) {
      let name = 'base', rot = 0;
      if (i === 0 && j === 0) name = 'road_junction';
      else if (i === 0) { name = Math.abs(j) === 1 ? 'road_straight_crossing' : 'road_straight'; }
      else if (j === 0) { name = Math.abs(i) === 1 ? 'road_straight_crossing' : 'road_straight'; rot = Math.PI / 2; }
      const a = assets[name];
      const m = a.scene.clone(true);
      // só x/z em escala de cidade; a altura fica a original para o meio-fio ter ~3 cm
      m.scale.set(CITY_SCALE, 1, CITY_SCALE);
      m.position.set(i * TILE, -(a.min.y + a.size.y), j * TILE);
      m.rotation.y = rot;
      world.add(shadows(m, false, true));
    }
  }

  // --- obstáculos: um modelo por caixa de colisão ---
  for (const b of map.boxes) {
    const cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2;
    const lx = b.max[0] - b.min[0], lz = b.max[2] - b.min[2], h = b.max[1] - b.min[1];
    if (b.kind === 'carTop') continue; // a cabine já faz parte do modelo do carro
    if (b.kind === 'car') {
      world.add(shadows(cityProp(assets, b.model, cx, cz, b.along === 'x' ? Math.PI / 2 : 0), true, true));
      continue;
    }
    const spec = KIND[b.kind] || KIND.wall;
    const asset = assets[typeof spec.model === 'function' ? spec.model(b) : spec.model];
    const alongZ = lz > lx;
    const modelAlongX = asset.size.x >= asset.size.z;
    const L = alongZ ? lz : lx, T = alongZ ? lx : lz;
    const n = spec.tile ? Math.max(1, Math.round(L / spec.tile)) : 1;
    for (let k = 0; k < n; k++) {
      const piece = L / n;
      // o modelo tem o lado comprido em x; se a caixa é comprida em z, gira 90°
      const g = modelAlongX ? fitted(asset, piece, h, T) : fitted(asset, T, h, piece);
      const off = -L / 2 + piece * (k + 0.5);
      if (alongZ === modelAlongX) g.rotation.y = Math.PI / 2;
      g.position.set(cx + (alongZ ? 0 : off), b.min[1], cz + (alongZ ? off : 0));
      world.add(shadows(g, b.kind !== 'border', true));
    }
  }

  // --- bandeiras nos cantos do forte ---
  const flags = ['red', 'yellow', 'green', 'blue'];
  let f = 0;
  for (const sx of [1, -1]) for (const sz of [1, -1]) {
    const a = assets[`flag_A_${flags[f++]}`];
    const m = a.scene.clone(true);
    m.position.set(sx * 3.8, 2.7, sz * 3.8);
    m.rotation.y = Math.atan2(sx, sz);
    world.add(shadows(m, true, false));
  }

  // --- cidade em volta: prédios, postes e mobiliário de rua, fora da cerca ---
  const builds = ['building_A', 'building_B', 'building_C', 'building_D', 'building_E', 'building_F', 'building_G', 'building_H'];
  let bi = 0;
  for (let i = -4; i <= 4; i++) {
    for (let j = -4; j <= 4; j++) {
      if (Math.abs(i) !== 4 && Math.abs(j) !== 4) continue;
      const x = i * TILE, z = j * TILE;
      if ((i === 0 || j === 0)) {
        // as ruas continuam para fora da arena
        const a = assets.road_straight;
        const m = a.scene.clone(true);
        m.scale.set(CITY_SCALE, 1, CITY_SCALE);
        m.position.set(x, -(a.min.y + a.size.y), z);
        m.rotation.y = j === 0 ? Math.PI / 2 : 0;
        world.add(shadows(m, false, true));
        continue;
      }
      // fachada virada para a arena
      const rot = Math.abs(i) === 4 ? (i > 0 ? -Math.PI / 2 : Math.PI / 2) : (j > 0 ? Math.PI : 0);
      world.add(shadows(cityProp(assets, builds[(bi++ * 3) % builds.length], x, z, rot, -0.5), false, true));
    }
  }
  const E = map.half + 2.6; // faixa de calçada entre a cerca e os prédios
  for (const s of [1, -1]) {
    for (const t of [-22, -8, 8, 22]) {
      world.add(shadows(cityProp(assets, 'streetlight', t, s * E, s > 0 ? Math.PI / 2 : -Math.PI / 2), false, false));
      world.add(shadows(cityProp(assets, 'streetlight', s * E, t, s > 0 ? Math.PI : 0), false, false));
    }
    for (const t of [-16, 16]) {
      world.add(cityProp(assets, 'bush', t, s * (E + 1)));
      world.add(cityProp(assets, 'bench', s * (E + 1), t, Math.PI / 2));
      world.add(cityProp(assets, 'firehydrant', t + 3, s * (E + 0.5)));
    }
    world.add(cityProp(assets, 'trafficlight_A', s * 6.5, s * E, s > 0 ? Math.PI : 0));
    world.add(cityProp(assets, 'trafficlight_A', -s * E, s * 6.5, s > 0 ? Math.PI / 2 : -Math.PI / 2));
  }
  return world;
}
