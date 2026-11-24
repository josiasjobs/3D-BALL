# Tinta Neles! (3D-BALL)

Jogo 3D em primeira pessoa para navegador (PC): guerra de bexigas de tinta, todos contra todos.
Tem dois modos: single player local (1 a 7 bots) e multiplayer (servidor autoritativo em Node, salas públicas ou privadas
por código, com ou sem bots completando as vagas).
Textos do jogo e comentários do código em português do Brasil.

## Stack
- JavaScript puro em módulos ES, sem bundler e sem etapa de build.
- Three.js (via npm, carregado por import map em `index.html` a partir de `node_modules/`).
- `ws` (WebSocket) no servidor; o navegador usa o WebSocket nativo.
- Node.js: `server.js` entrega os arquivos e hospeda as salas multiplayer; testes com `node:test`.

## Comandos
- `npm install` — instala Three.js e `ws`.
- `npm start` — sobe jogo + servidor multiplayer em http://localhost:5173 (porta via `PORT`); imprime também o endereço na rede local.
- `npm test` — testes da simulação e da sala multiplayer (rodam em Node, sem navegador nem rede).

Abrir `index.html` direto do disco (`file://`) não funciona: módulos ES exigem o servidor.

## Estrutura
- `index.html` — canvas, HUD, telas (menu com abas Single player / Multiplayer, pausa, fim) e todo o CSS.
  Os seletores de mapa (`.mapSel`) são preenchidos por `main.js` a partir de `MAPS`.
- `src/main.js` — laço principal (passo fixo de 60 Hz), estados da tela, os dois modos (single player local / multiplayer)
  e a lista de salas públicas do menu (busca `/api/rooms` a cada 3 s só com o menu na aba Multiplayer).
- `src/net.js` — `NetGame`: cliente de rede que imita a interface de `Game` para render/HUD/som.
  O mapa da sala chega no `welcome` (`setMap`); quem entra usa o mapa da sala, não o do seu seletor.
- `src/server/lobby.js` — `Lobby`: salas abertas por código (`Map`), criar/entrar/sair, lista das públicas, limite de salas.
- `src/server/room.js` — `Room`: sala autoritativa (simulação, bots nas vagas livres, fila de comandos, envio de estado).
  Não conhece WebSocket (recebe objetos com `send(texto)`), por isso é testável sem rede. `server.js` faz a ponte.
- `src/sim/` — regras do jogo, **sem Three.js e sem DOM**:
  - `map.js` — mapas (`MAPS`: `praca`, `patio`; `buildMap(id)`, id desconhecido → Praça): caixas AABB, spawns,
    pontos de sacola e roupa; paleta; interseção segmento×caixa. `test/map.test.js` confere todo mapa da lista
    (nada nasce dentro de obstáculo, bots alcançam spawns/sacolas/roupas). Mapa novo = função `buildX()` + entrada em `MAPS`.
  - `game.js` — `Game`: jogadores, bexigas, sacolas, pontuação, fila de eventos; constantes em `CFG`.
  - `nav.js` — grade de navegação + A* para os bots.
  - `bot.js` — `BotBrain`: IA que devolve um comando por tick. Os níveis (`SKILLS`: fácil/normal/difícil) mudam mira,
    reação, cadência, previsão, alcance de visão, giro, desvio lateral, esquiva de bexigas, distância de combate e
    velocidade no combate (`mob`; o fácil anda devagar para ser fácil de acertar).
    `test/skill.test.js` garante que os níveis continuam bem separados — ajustou `SKILLS`? Rode os testes.
  - `roster.js` — nomes de bots e cores dos jogadores.
- `src/render/scene.js` — cena Three.js (luzes, manchas, partículas, sacolas, câmera).
- `src/render/world.js` — cenário: veste cada caixa de colisão do mapa com um modelo KayKit e monta a cidade em volta.
- `src/render/characters.js` — `Character`: boneco articulado de cada jogador (inclusive o local, em 1ª pessoa).
- `src/render/outfit.js` — roupa dos personagens: material com shader que pinta tênis, calça, cinto, camiseta e pele
  pela posição do vértice na pose base (T), mais cabelo, boné e óculos presos ao osso da cabeça.
- `assets/mannequin.glb` — boneco + 43 animações (Universal Animation Library, Quaternius, CC0).
  É cópia de `Universal Animation Library/Unreal-Godot/UAL1_Standard.glb`; o jogo só usa a cópia em `assets/`.
- `assets/city/`, `assets/platformer/` — modelos glTF usados dos kits KayKit City Builder Bits e Platformer Pack
  (Kay Lousberg, CC0), copiados de `KayKit 1/` e `KayKit 2/`; o jogo só lê as cópias em `assets/`.
- `src/input.js`, `src/hud.js`, `src/audio.js` — teclado/mouse, DOM do HUD, sons sintetizados em WebAudio.
- `test/` — testes da simulação, da sala/lobby e da diferença entre as dificuldades dos bots.

## Convenções e cuidados
- `src/sim/` precisa continuar rodando em Node puro: nada de `window`, `document` ou `three` ali.
  O servidor roda exatamente esse código.
- Todo jogador (humano local, bot ou remoto) age só por um comando `{ mx, mz, yaw, pitch, jump, fire }`
  passado a `game.step(dt, cmds)`. Não altere o estado de jogadores por fora da simulação.
- A simulação avisa o resto do jogo por `game.events` (`throw`, `splat`, `hit`, `ko`, `respawn`, `pickup`, `bag`, `heal`, `end`);
  quem consome esvazia a lista. Render, HUD e som só leem estado e eventos.
- Aleatoriedade das regras usa `game.rng` (com semente), não `Math.random` — efeitos visuais podem usar `Math.random`.
- Convenção de direção: com `yaw = 0` o jogador olha para `-z`; `pitch` positivo é para cima.
- Colisão é toda por caixas alinhadas aos eixos; degraus de até `CFG.step` são subidos andando.
- Os bots só navegam no nível do chão (não sobem no forte central).
- `window.__tinta` expõe `game`, `state`, `net`, `renderer` e `input` para depuração e testes no navegador.
- `Renderer.setGame(game)` troca o cenário sozinho (`setMap`) quando `game.map.id` muda: obstáculos, piso, sacolas e roupas.
  O piso da Praça é cruzamento de ruas; o do pátio é todo `base` (concreto); bandeiras só aparecem se houver `fort`.
- Rede: várias salas de 8 vagas em `/ws`, mensagens JSON. Cada sala tem um código de 5 letras (`CODE_CHARS`, sem 0/O, 1/I/L);
  pública aparece em `GET /api/rooms`, privada só por código. A sala é apagada quando o último humano sai; máximo `MAX_ROOMS`.
  Cliente manda `create` (`name`, `bots`, `skill`, `map`, `public`) ou `join` (`name`, `code`), depois um `cmd` (com `seq`) por tick;
  servidor responde `welcome` (com `code`, `public`, `bots`, `skill`, `map`) ou `error` (`reason`: `notfound`/`full`/`limit`), `roster` (alguém entrou/saiu),
  `start` (nova partida) e `snap` 30x/s com estado + eventos. Quem entra assume a vaga de um bot; quem sai devolve a vaga a um bot.
- Bots online: quem cria a sala escolhe quantos (`create` com `bots` de 0 a 7) e a dificuldade (`skill`), e vale até a sala
  esvaziar. `Room.assignBots()` põe os bots nas últimas vagas livres; as demais vagas livres ficam com `player.out = true`
  (não jogam, não aparecem, fora do placar). Humano entra numa vaga vazia; se não houver, no lugar de um bot (que volta quando ele sai).
- O jogador local online é previsto no cliente com `Game.movePlayer`/`chargeStep` (os mesmos do servidor) e reconciliado
  a cada `snap` pelo `ack`. Mudou a física do jogador? Mude só nesses métodos, senão cliente e servidor divergem.
- `NetGame` e `Game` precisam expor os mesmos campos que render e HUD leem (`players`, `balloons`, `bags`, `shirts`,
  `events`, `timeLeft`, `ended`, `ranking()`, `launch()`). Campo novo de jogador usado na tela precisa entrar no `snap`.
- Assets externos ficam todos em `assets/` (boneco e kits KayKit); manchas de tinta são geradas em canvas e os sons em WebAudio.
- Cenário: a colisão continua sendo só as caixas de `map.js`. Cada caixa tem um `kind` (`border`, `wall`, `low`, `fort`,
  `step`, `parapet`, `crate`, `pillar`, `dumpster`, `car`, `carTop`, `tower`, `container`, `trash`) que `world.js` traduz em modelo, esticado para caber
  na caixa. Obstáculo novo = caixa nova em `map.js` + entrada na tabela `KIND` de `world.js`.
- O kit de cidade é miniatura: usa escala 5 (uma peça de rua = 10 m). O piso são peças de rua/calçada com o topo em `y = 0`.
- Prédios, postes e mobiliário fora da cerca são só decoração, sem colisão. Para usar outro modelo dos kits,
  copie o `.gltf` + `.bin` para `assets/` e acrescente o nome nas listas `CITY`/`PLAT` de `world.js`.
- Personagens: o corpo usa clipes do GLB (`Idle_Loop`, `Jog_Fwd_Loop`, `Jump_Loop`, `Death01`); o braço direito
  (segurar, armar, lançar) é posado por código em `characters.js`, porque a biblioteca não tem animação de arremesso.
- A malha do manequim não tem textura nem roupa: as regiões de roupa são limites em metros na pose base, definidos em
  `outfit.js`. A camiseta usa a cor do jogador; pele, cabelo, calça e tênis variam pelo `id`.
- O modelo do GLB olha para `+z` (o jogo usa `-z`), por isso é girado 180° dentro do `Character`.
- Em 1ª pessoa o jogador local usa o mesmo boneco: tronco, cabeça e braço esquerdo são encolhidos por escala de osso
  e o ombro direito é reposicionado junto da câmera; ficam visíveis o braço do arremesso e as pernas.
