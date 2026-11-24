# Mapa "Pátio de Cargas" e seletor de mapa — design

## Intenção
Ter um segundo mapa com outra cara de jogo — combate de perto, cobertura densa, caçada entre corredores —
e deixar o jogador (ou quem cria a sala) escolher o mapa.

## Objetivos
- Novo mapa **Pátio de Cargas**, 60×60 m (mesmo `HALF = 30` da Praça).
  - Chão cheio de cobertura na altura do peito/cabeça: fileiras de caixas e "contêineres" (caixas esticadas),
    carros parados, caçambas, lixeiras; caixa-d'água no centro.
  - Linhas de visão curtas: de qualquer ponto aberto, pouca coisa visível a mais de ~20 m.
  - 8 spawns (cantos e laterais), sacolas extras e roupas limpas espalhadas pelos corredores.
- **Seletor de mapa** (opção A):
  - Single player: campo "Mapa" ao lado de Bots/Dificuldade.
  - Multiplayer: quem cria a sala escolhe; o mapa aparece na lista de salas públicas e no aviso ao entrar.
  - Mapas na lista: "Praça" (atual, padrão) e "Pátio de Cargas".

## Fora do escopo
- Rodízio ou mapa aleatório; trocar o mapa de uma sala já aberta.
- Bots subindo em lugares altos (continuam só no chão).
- Pacotes de modelos novos (usar só City Builder Bits e Platformer Pack).

## Restrições
- Colisão só por caixas AABB; cada caixa tem um `kind` que `world.js` veste com um modelo esticado.
- Caixa-d'água é obstáculo, não dá para subir. Caixas baixas (≤ 1,1 m) continuam puláveis.
- `src/sim/` segue sem DOM/Three; servidor e cliente rodam o mesmo `buildMap(id)`.
- Todos os pontos de spawn, sacola e roupa precisam ser alcançáveis andando (a navegação dos bots chega até eles).

## Abordagens consideradas
- A. Seletor (escolhida): previsível, mapa novo = mais uma opção.
- B. Rodízio por partida: variedade, mas ninguém escolhe e trocar cenário no meio da sala é mais trabalhoso.
- C. Seletor + "Aleatório": possível depois, por cima de A.

## Como fica
- `map.js`: `MAPS = [{ id: 'praca', name: 'Praça' }, { id: 'patio', name: 'Pátio de Cargas' }]` e
  `buildMap(id = 'praca')` (id desconhecido → Praça). O mapa devolvido tem `id`.
- `Game({ map })`, `Room({ map })`, `Lobby.create(..., { map })`; `roster()/welcome` e `GET /api/rooms` levam `map`.
- `NetGame` usa o mapa que veio no `welcome`.
- `Renderer.setMap(map)` troca o cenário (descarta o anterior, monta o novo, refaz sacolas/roupas) sem recarregar.
  O fundo do menu continua sendo a Praça.
- Novos `kind`s em `world.js` para os modelos do pátio (ex.: `container`, `tower`, `trash`), copiando os `.gltf/.bin`
  necessários de `KayKit 1/` para `assets/city/` (caixa-d'água, caixas, lixeiras, perua).

## Decisões minhas (corrigíveis)
- O seletor vem com "Praça" selecionado por padrão.
- O pátio usa a mesma decoração de prédios em volta da cerca que a Praça.

## Testes
- Pátio: todas as caixas dentro da arena; spawns/sacolas/roupas fora de caixas e alcançáveis pela navegação;
  partida só com bots termina com pontos (como o teste atual da Praça).
- Seletor: `buildMap('xyz')` → Praça; sala criada com `map: 'patio'` usa o pátio e anuncia no `welcome` e na lista.
