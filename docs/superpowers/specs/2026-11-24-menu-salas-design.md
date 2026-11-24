# Nova tela inicial e salas multiplayer — design

## Intenção
Separar claramente o jogo sozinho (contra bots) do multiplayer, e permitir várias salas
simultâneas — públicas (listadas) ou privadas (por código) — em vez da sala única de hoje.

## Objetivos
- Tela inicial com dois caminhos: **Single player** e **Multiplayer**.
- Single player: escolher de **1 a 7 bots** (e a dificuldade, que já existe).
- Multiplayer:
  - **Criar sala**: pública ou privada, com bots ou sem bots.
  - **Entrar em sala**: digitando o código, ou escolhendo uma sala pública numa lista.
- O código da sala fica visível durante a partida (tela de pausa) para chamar amigos.

## Fora do escopo (por enquanto)
- Hospedagem na nuvem / acesso pela internet. O servidor roda no PC do usuário (`npm start`),
  acessível na rede local. Deploy (provável Fly.io) fica para depois — nada no design deve impedir isso.
- Contas, senhas de sala, chat, escolher mapa ou tempo de partida.

## Restrições
- Máximo de 8 jogadores por partida (8 spawns e 8 cores no mapa) — por isso até 7 bots.
- `src/sim/` não muda; `Room` continua sem conhecer WebSocket e testável em Node.

## Abordagens consideradas (hospedagem)
- Fly.io/Railway (~US$5/mês, sempre ligado) — recomendada para quando for online.
- Render grátis — dorme após 15 min, contraria "sempre ligado".
- VPS própria — mais manutenção.
- **Escolhida agora: o PC do usuário**, só rede local; a nuvem fica para uma etapa futura.

## Como fica

### Tela inicial
```
 TINTA NELES!
 Seu nome [Você      ]

 [ Single player ]   → Bots [1..7]  Dificuldade [Normal]  [Jogar]
 [ Multiplayer   ]   → [Criar sala] [Entrar com código] + lista de salas públicas
```
- Duas abas/blocos; o multiplayer mostra:
  - Criar: `Pública | Privada`, `Com bots | Sem bots`, botão **Criar sala**.
  - Entrar: campo de código (5 caracteres) + **Entrar**.
  - Lista de salas públicas: nome (apelido de quem criou), jogadores humanos/8, com/sem bots,
    botão Entrar. Atualiza sozinha a cada ~3 s enquanto o bloco está aberto.

### Servidor
- `server.js` guarda um `Map<código, Room>` em vez de uma sala única.
- Código: 5 caracteres de um alfabeto sem ambíguos (sem 0/O, 1/I/L). Toda sala tem código;
  "pública" só significa que aparece na lista.
- Mensagens WS: `{t:'create', name, bots, public}` e `{t:'join', name, code}`.
  Respostas: `welcome` (agora com `code`, `public`), `full`, `notfound`.
- `GET /api/rooms` devolve as salas públicas `{code, host, humans, slots, bots}`.
- Sala é apagada quando o último humano sai. O laço de simulação faz `tick()` em todas.
- Limite de salas simultâneas (ex.: 20) para não estourar o PC; acima disso, `create` responde erro.
- Bots online seguem a regra atual: preenchem todas as vagas livres (com bots) ou ficam de fora (sem bots).

### Cliente
- `NetGame.connect` passa a aceitar `{create:{bots,public}}` ou `{code}`.
- Pausa mostra "Sala ABCDE" (e se é pública/privada). Mensagens de erro em `#netStatus`
  (código inexistente, sala cheia, limite de salas).

## Decisões do builder (minhas escolhas, corrigíveis)
- Dificuldade dos bots no multiplayer fica "normal" (sem seletor).
- Nome da sala na lista = apelido de quem criou.
- Testes em `node:test` para: criar/entrar/sair, sala apagada ao esvaziar, código inexistente, lista pública sem as privadas.
