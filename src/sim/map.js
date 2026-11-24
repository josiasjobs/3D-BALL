// Mapa da arena. Dados puros (sem Three.js, sem DOM) para rodar também em Node.

export const HALF = 30; // metade do lado da arena, em metros

// Cores das bexigas de tinta.
export const PALETTE = [
  0xff2d55, 0xff8a00, 0xffd60a, 0x34c759,
  0x00c7be, 0x0a84ff, 0xbf5af2, 0xff5fc8,
];

// kind diz ao render qual modelo usar; extra leva dados só visuais (cor, modelo, giro).
function box(cx, cz, sx, sz, h, y0 = 0, kind = 'wall', extra = null) {
  return {
    min: [cx - sx / 2, y0, cz - sz / 2],
    max: [cx + sx / 2, y0 + h, cz + sz / 2],
    kind, ...extra,
  };
}

const QUAD_COLORS = ['red', 'yellow', 'green', 'blue'];

// Mapas disponíveis (o primeiro é o padrão).
export const MAPS = [
  { id: 'praca', name: 'Praça' },
  { id: 'patio', name: 'Pátio de Cargas' },
];

// Monta o mapa pelo id; id desconhecido cai no padrão.
export function buildMap(id = 'praca') {
  const m = id === 'patio' ? buildPatio() : buildPraca();
  return { ...m, id: id === 'patio' ? 'patio' : 'praca' };
}

// Ferramentas de montagem comuns aos mapas.
function builder() {
  const boxes = [];
  const add = (...a) => boxes.push(box(...a));
  // Espelha uma peça nos 4 quadrantes.
  const quad = (cx, cz, sx, sz, h, y0, kind) => {
    let q = 0;
    for (const mx of [1, -1]) for (const mz of [1, -1]) add(cx * mx, cz * mz, sx, sz, h, y0, kind, { color: QUAD_COLORS[q++] });
  };
  // Carro: capô/porta-malas baixos (dá para subir) + cabine mais alta. along = 'x' ou 'z'.
  const car = (cx, cz, along, model) => {
    const L = 4.7, Wd = 2.1;
    if (along === 'z') {
      add(cx, cz, Wd, L, 1.0, 0, 'car', { model, along });
      add(cx, cz, Wd - 0.2, 2.2, 0.6, 1.0, 'carTop');
    } else {
      add(cx, cz, L, Wd, 1.0, 0, 'car', { model, along });
      add(cx, cz, 2.2, Wd - 0.2, 0.6, 1.0, 'carTop');
    }
  };
  // Muros do perímetro
  const border = () => {
    const W = HALF * 2 + 2;
    add(0, HALF + 0.5, W, 1, 3, 0, 'border');
    add(0, -HALF - 0.5, W, 1, 3, 0, 'border');
    add(HALF + 0.5, 0, 1, W, 3, 0, 'border');
    add(-HALF - 0.5, 0, 1, W, 3, 0, 'border');
  };
  return { boxes, add, quad, car, border };
}

// Praça: cruzamento de ruas aberto, com um forte elevado no centro.
function buildPraca() {
  const { boxes, add, quad, car, border } = builder();
  border();
  // Forte central: plataforma elevada com escadas nos lados +x e -x
  add(0, 0, 8, 8, 1.8, 0, 'fort');
  for (const s of [1, -1]) {
    for (let k = 1; k <= 5; k++) {
      add(s * (4 + (5 - k) * 0.6 + 0.3), 0, 0.6, 3, 0.3 * k, 0, 'step');
    }
    // parapeitos
    add(0, s * 3.8, 8, 0.4, 0.9, 1.8, 'parapet');
    add(s * 3.8, 2.75, 0.4, 2.5, 0.9, 1.8, 'parapet');
    add(s * 3.8, -2.75, 0.4, 2.5, 0.9, 1.8, 'parapet');
  }

  // Paredes altas
  quad(14, 8, 0.6, 8, 3, 0, 'wall');
  quad(8, 16, 8, 0.6, 3, 0, 'wall');
  for (const s of [1, -1]) {
    add(0, s * 19, 6, 0.6, 3, 0, 'wall');
    add(s * 20, 0, 0.6, 6, 3, 0, 'wall');
  }

  // Caixotes (o baixo dá para pular; do baixo se alcança o alto)
  quad(17, 22, 2, 2, 2.2, 0, 'crate');
  quad(18.6, 22.4, 1.2, 1.2, 1.0, 0, 'crate');
  quad(6, 24, 1.6, 1.6, 1.0, 0, 'crate');
  quad(24.5, 9, 1.7, 2.8, 1.6, 0, 'dumpster');

  // Muretas e pilares
  quad(22, 5, 5, 0.6, 1.1, 0, 'low');
  quad(15, 25, 1.2, 1.2, 4, 0, 'pillar');
  quad(26, 15, 1.2, 1.2, 4, 0, 'pillar');
  quad(9, 9, 1.2, 1.2, 4, 0, 'pillar');

  // Carros parados nas duas ruas que se cruzam no centro
  car(2.5, 15, 'z', 'car_taxi');
  car(-2.5, -15, 'z', 'car_police');
  car(15, -2.5, 'x', 'car_sedan');
  car(-15, 2.5, 'x', 'car_hatchback');

  const spawns = [
    [26, 26], [-26, -26], [26, -26], [-26, 26],
    [0, 26], [0, -26], [26, 0], [-26, 0],
  ];

  // Sacolas extras: [x, y, z]
  const bagSpots = [
    [0, 1.8, 0],
    [14, 0, 14], [-14, 0, 14], [14, 0, -14], [-14, 0, -14],
    [0, 0, 12], [0, 0, -12],
  ];

  // Roupas limpas (devolvem uma vida): [x, y, z]
  const shirtSpots = [
    [10.5, 0, 21], [-10.5, 0, 21], [10.5, 0, -21], [-10.5, 0, -21],
  ];

  return { boxes, spawns, bagSpots, shirtSpots, half: HALF };
}


// Pátio de Cargas: chão tomado por contêineres, caixas, carros e caçambas; caixa-d'água no centro.
// Combate de perto, visão curta. Montado no quadrante +x/+z e espelhado nos outros três.
// Corredores com pelo menos 2 m; peças baixas encostadas nos contêineres para não criar frestas.
function buildPatio() {
  const { boxes, add, quad, car, border } = builder();
  border();

  // Caixa-d'água no centro: alta demais para subir
  add(0, 0, 5, 5, 8, 0, 'tower');

  // Contêineres (2,6 m de altura): [cx, cz, sx, sz]
  for (const [cx, cz, sx, sz] of [
    [9, 4.6, 2.4, 5.2], [4.5, 10.5, 6, 2.4], [17, 9, 6, 2.4], [23.4, 4, 2.4, 6],
    [9, 18, 2.4, 6], [16, 16, 6, 2.4], [21.5, 21, 6, 2.4], [15, 24, 2.4, 6], [4.8, 21, 6, 2.4],
  ]) quad(cx, cz, sx, sz, 2.6, 0, 'container');

  // Caixotes baixos (1 m, dá para pular) encostados nos contêineres
  quad(4.5, 12.4, 1.2, 1.4, 1.0, 0, 'crate');
  quad(17, 11, 1.4, 1.6, 1.0, 0, 'crate');
  quad(8.5, 21.8, 1.4, 1.6, 1.0, 0, 'crate'); // fecha o canto entre dois contêineres
  quad(21.6, 18.9, 1.2, 1.8, 1.0, 0, 'crate');

  // Lixeiras e caçambas
  quad(24, 10, 0.9, 0.9, 1.2, 0, 'trash');
  quad(9, 14.55, 0.9, 0.9, 1.2, 0, 'trash');
  quad(29.15, 8, 1.7, 2.8, 1.6, 0, 'dumpster');

  // Carros parados
  const models = ['car_stationwagon', 'car_sedan', 'car_hatchback', 'car_taxi'];
  let q = 0;
  for (const mx of [1, -1]) for (const mz of [1, -1]) {
    car(14.6 * mx, 3.5 * mz, 'x', models[q % 4]);
    car(26 * mx, 15 * mz, 'z', models[(q + 2) % 4]);
    q++;
  }

  const spawns = [
    [26, 26], [-26, -26], [26, -26], [-26, 26],
    [0, 26], [0, -26], [26, 0], [-26, 0],
  ];
  const bagSpots = [
    [12, 0, 12], [-12, 0, 12], [12, 0, -12], [-12, 0, -12],
    [0, 0, 13], [0, 0, -13],
  ];
  const shirtSpots = [
    [18, 0, 12.5], [-18, 0, 12.5], [18, 0, -12.5], [-18, 0, -12.5],
  ];
  return { boxes, spawns, bagSpots, shirtSpots, half: HALF };
}

// Interseção segmento x caixa (método das fatias). O segmento vai de p até p+d.
// Retorna null ou { t (0..1), axis (0,1,2 ou -1 se começou dentro), sign }.
export function segAABB(px, py, pz, dx, dy, dz, b, pad = 0) {
  let tmin = 0, tmax = 1, axis = -1, sign = 0;
  for (let i = 0; i < 3; i++) {
    const p = i === 0 ? px : i === 1 ? py : pz;
    const d = i === 0 ? dx : i === 1 ? dy : dz;
    const lo = b.min[i] - pad, hi = b.max[i] + pad;
    if (Math.abs(d) < 1e-9) {
      if (p < lo || p > hi) return null;
    } else {
      let t1 = (lo - p) / d, t2 = (hi - p) / d, s = -1;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; s = 1; }
      if (t1 > tmin) { tmin = t1; axis = i; sign = s; }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return null;
    }
  }
  return { t: tmin, axis, sign };
}

// Há linha de visão livre entre dois pontos?
export function clearLine(boxes, ax, ay, az, bx, by, bz, pad = 0) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  for (let i = 0; i < boxes.length; i++) {
    if (segAABB(ax, ay, az, dx, dy, dz, boxes[i], pad)) return false;
  }
  return true;
}
