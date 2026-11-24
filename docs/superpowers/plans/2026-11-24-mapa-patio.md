# Mapa Pátio de Cargas e seletor de mapa — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Segundo mapa (Pátio de Cargas, 60×60, cobertura densa) e seletor de mapa no single player e na criação de sala.

**Architecture:** `map.js` vira um registro (`MAPS`, `buildMap(id)`); `Game`/`Room`/`Lobby` recebem `map`; o protocolo leva o id do mapa; `Renderer.setMap()` troca o cenário em tempo de execução; o menu ganha o seletor.

**Tech Stack:** JavaScript ES modules, `node:test`, Three.js, `ws`.

**Spec:** `docs/superpowers/specs/2026-11-24-mapa-patio-design.md`

## Global Constraints
- Textos e comentários em português do Brasil.
- `src/sim/` sem DOM/Three. Colisão só por caixas AABB com `kind`.
- Ids: `praca` (padrão, nome "Praça") e `patio` (nome "Pátio de Cargas"). Id desconhecido → `praca`.
- Pátio: `HALF = 30`, 8 spawns, caixa-d'água central não escalável (altura > 3 m), caixas baixas ≤ 1,1 m.
- Teste no navegador: Playwright CLI `--browser chromium`, porta 5199 (nunca 5173), derrubar o servidor ao fim.
- Commits descritivos em português terminando com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus
1. Entrar numa sala de pátio vindo do menu (fundo Praça) e sair de volta: o cenário precisa trocar nas duas direções, sem sobrar obstáculo do mapa anterior nem sacolas/roupas fantasmas.
2. "Jogar de novo" no single player mantém o mapa escolhido.
3. Manchas de tinta usam `map.boxes[e.box]`: com o mapa trocado, índice de caixa do mapa antigo não pode ser usado.
4. Sala de pátio: quem entra depois (lista ou código) recebe o pátio, mesmo que o seletor dele esteja em Praça.
5. Bots no pátio não ficam presos em corredores estreitos (largura mínima de corredor ≥ 2 m).

---

### Task 1: Registro de mapas e layout do Pátio

**Files:**
- Modify: `src/sim/map.js` (atual vira `buildPraca()`; novo `buildPatio()`; `MAPS`; `buildMap(id)`)
- Modify: `src/sim/game.js` (`constructor({ seed, matchTime, map = 'praca' })` → `this.map = buildMap(map)`)
- Test: `test/map.test.js`

**Interfaces:**
- Produces:
  - `export const MAPS = [{ id: 'praca', name: 'Praça' }, { id: 'patio', name: 'Pátio de Cargas' }]`
  - `export function buildMap(id = 'praca') → { id, boxes, spawns, bagSpots, shirtSpots, half }`
  - Novos `kind`: `tower` (caixa-d'água), `container`, `trash`; reaproveita `crate`, `dumpster`, `car`/`carTop`, `border`.
  - `new Game({ map: 'patio' })`.

- [ ] **Step 1: Testes que falham** em `test/map.test.js`:
  - `mapas: id desconhecido cai na Praça` — `buildMap().id === 'praca'`, `buildMap('xyz').id === 'praca'`, `buildMap('patio').id === 'patio'`, `MAPS.map(m => m.id)` igual a `['praca','patio']`.
  - Para cada id de `MAPS`, `mapa <id>: tudo dentro da arena e nada nasce dentro de obstáculo` — toda caixa com `min/max` x,z em `[-half-1.5, half+1.5]`; 8 spawns; nenhum spawn/sacola/roupa no chão (`y < 0.5`) dentro de uma caixa que vá de `y<1.8` a `y>0` ampliada por `CFG.radius`.
  - Para cada id, `mapa <id>: bots alcançam spawns, sacolas e roupas` — `new Nav(map).findPath(spawn0.x, spawn0.z, alvo.x, alvo.z)` não é `null` para todo spawn e todo ponto no chão.
  - `pátio: visão mais curta que a Praça` — amostra a grade de 3 m de pontos livres (fora de caixas), pares com distância > 20 m: fração com `clearLine` livre no pátio `< 0.5 ×` a fração da Praça.
  - `pátio: caixa-d'água não é escalável` — existe caixa `kind === 'tower'` contendo (0,0) com altura `> 3`.
  - `pátio: partida só com bots termina com pontos` — `new Game({ seed: 3, map: 'patio' })` + 8 `BotBrain` normais até `ended`, soma de `score > 0`.
- [ ] **Step 2:** `npm test` → os novos falham (`MAPS` não existe).
- [ ] **Step 3:** Implementar. O layout do pátio é do implementador, respeitando: espelhado nos 4 quadrantes (justo para todos os spawns), corredores ≥ 2 m, contêineres ~2,4 × 6 × 2,6 m em fileiras, pilhas de `crate` puláveis (≤ 1,1 m) ao lado de contêineres, carros (`car()` existente), caçambas e lixeiras, `tower` ~5×5×8 m no centro, borda igual à da Praça.
- [ ] **Step 4:** `npm test` → tudo passa.
- [ ] **Step 5:** Commit.

### Task 2: Mapa na sala, no lobby e no protocolo

**Files:**
- Modify: `src/server/room.js`, `src/server/lobby.js`, `server.js`, `AGENTS.md`
- Test: `test/lobby.test.js`

**Interfaces:**
- Consumes: `buildMap`, `MAPS`, `Game({ map })` (Task 1).
- Produces:
  - `new Room({ map })` (id normalizado: desconhecido → `praca`); `room.mapId`; `Game` e `Nav` da sala usam esse mapa.
  - `Lobby.create(conn, name, { bots, skill, isPublic, map })`.
  - `roster()`/`welcome` levam `map: <id>`; `list()` itens ganham `map`.
  - Cliente → `{ t:'create', ..., map }`.

- [ ] **Step 1: Testes que falham** em `test/lobby.test.js`:
  - `lobby: sala de pátio usa o pátio e anuncia o mapa` — `create(a,'Ana',{ map:'patio' })` → `room.game.map.id === 'patio'`, `a.msgs[0].map === 'patio'`, `list()[0].map === 'patio'`; quem entra pelo código recebe `welcome.map === 'patio'`.
  - `lobby: mapa desconhecido vira Praça` — `create(..., { map:'lua' })` → `room.game.map.id === 'praca'`.
- [ ] **Step 2:** rodar → falham.
- [ ] **Step 3:** Implementar; `server.js` repassa `m.map`. AGENTS.md: protocolo (`map`) e estrutura (`MAPS`, `buildMap(id)`).
- [ ] **Step 4:** `npm test` → passa.
- [ ] **Step 5:** Commit.

### Task 3: Render do pátio e troca de cenário

**Files:**
- Copy: `KayKit 1/Assets/gltf/{watertower,box_A,box_B,trash_A,trash_B,car_stationwagon}.{gltf,bin}` → `assets/city/`
- Modify: `src/render/world.js` (CITY + KIND `tower`/`container`/`trash`; piso do pátio todo em `base`; bandeiras só se houver caixa `fort`)
- Modify: `src/render/scene.js` (`setMap(map)`)

**Interfaces:**
- Consumes: `buildMap('patio')` (Task 1).
- Produces: `Renderer.setMap(map): void` — remove o grupo do cenário anterior (e libera geometrias próprias), chama `buildWorld` com os assets já carregados (guardar em `this.worldAssets` no `load()`), refaz sacolas e roupas para os pontos do mapa novo e zera as manchas. Não faz nada se `map.id` já é o atual.

- [ ] **Step 1:** Copiar os assets (conferir que as texturas referenciadas pelos `.gltf` já estão em `assets/city/`, ex. `citybits_texture.png`).
- [ ] **Step 2:** Implementar `world.js` e `setMap`. `buildBags`/`buildShirts` precisam poder ser refeitos (remover os antigos da cena).
- [ ] **Step 3: Verificar** — expor `renderer` em `window.__tinta` (gancho de depuração). `PORT=5199 npm start`; Playwright:
  `__tinta.renderer.setMap(<buildMap('patio') importado via import('/src/sim/map.js')>)` → screenshot mostra o pátio;
  `setMap` de volta para a Praça → screenshot igual ao menu original. Esperado: zero erros no console.
- [ ] **Step 4:** `npm test` passa; commit.

### Task 4: Seletor de mapa no menu e cliente

**Files:**
- Modify: `index.html` (`#map` no single player, `#netMap` na criação de sala)
- Modify: `src/main.js`, `src/net.js`, `AGENTS.md`

**Interfaces:**
- Consumes: `MAPS` (Task 1), `welcome.map` e `list()[i].map` (Task 2), `Renderer.setMap` (Task 3).
- Produces:
  - `newGame({ withHuman, botCount, skill, name, map })` — cria `Game({ map })`, `Nav` cacheado por id, chama `renderer.setMap(game.map)`.
  - `NetGame`: após `welcome`, `this.helper = new Game({ map: m.map })`, `this.map`, `bags`, `shirts` refeitos para esse mapa; `this.mapId`.
  - Opções do seletor geradas de `MAPS`; lista pública mostra `· <nome do mapa>`; aviso ao entrar: `Sala ABCDE · Pátio de Cargas`.
  - `toMenu()` volta o fundo para a Praça.

- [ ] **Step 1:** Implementar.
- [ ] **Step 2: Verificar no navegador** (5199, Playwright):
  - Single player com Pátio → `__tinta.game.map.id === 'patio'`; screenshot do jogo; "Sair para o menu" → `game.map.id === 'praca'`; "Jogar" de novo com Pátio → pátio; "Jogar de novo" no fim mantém pátio (forçar `game.timeLeft = 0.1`).
  - Página A cria sala de pátio; página B com seletor em Praça entra pela lista → `__tinta.game.map.id === 'patio'` em B; lista mostrava "Pátio de Cargas".
  - Nenhum erro no console. Screenshots do menu e do pátio.
- [ ] **Step 3:** `npm test` passa; AGENTS.md (seletor e `setMap`); commit.
