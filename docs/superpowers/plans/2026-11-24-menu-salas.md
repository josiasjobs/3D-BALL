# Nova tela inicial e salas multiplayer — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menu com Single player (1–7 bots) e Multiplayer (criar sala pública/privada com ou sem bots, entrar por código ou pela lista pública), com o servidor hospedando várias salas.

**Architecture:** Um `Lobby` novo (`src/server/lobby.js`, sem WebSocket, testável em Node) guarda as salas `Room` por código. `server.js` só traduz mensagens WS/HTTP para o `Lobby`. O cliente (`net.js`, `main.js`, `index.html`) ganha o novo menu e manda `create` ou `join` com código.

**Tech Stack:** JavaScript ES modules puro, Node `node:test`, `ws`, Three.js (inalterado).

**Spec:** `docs/superpowers/specs/2026-11-24-menu-salas-design.md`

## Global Constraints
- Textos do jogo e comentários em português do Brasil.
- `src/sim/` não muda. `Room` e `Lobby` não importam `ws` nem `http`.
- 8 vagas por sala; single player de 1 a 7 bots.
- Código de sala: 5 caracteres do alfabeto `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (sem 0/O, 1/I/L).
- Máximo de 20 salas simultâneas.
- Bots no multiplayer: dificuldade `normal`, preenchem todas as vagas livres (ou nenhuma).
- Teste no navegador: usar Playwright CLI com `--browser chromium`, numa porta própria (ex.: `PORT=5199`), nunca a 5173.
- Commits descritivos em português, terminando com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus
1. Código digitado em minúsculas ou com espaços (`" abcde "`) deve achar a sala `ABCDE`.
2. Apelido de quem criou aparece na lista pública: precisa ser escapado (`esc`) — um nome com `<img>` não pode virar HTML.
3. Clicar numa sala da lista que acabou de ser apagada → mensagem "Sala não encontrada", sem travar o menu.
4. Conexão WS que cai antes de criar/entrar, ou o último humano saindo, não pode deixar sala órfã rodando.
5. Sala privada nunca aparece em `GET /api/rooms`, nem enquanto está cheia ou em intervalo.

---

### Task 1: `Lobby` com várias salas

**Files:**
- Create: `src/server/lobby.js`
- Modify: `src/server/room.js` (campos `code`, `isPublic`, `host`; incluir `code` e `public` em `roster()`)
- Test: `test/lobby.test.js`

**Interfaces:**
- Produces:
  - `export const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'`, `export const MAX_ROOMS = 20`
  - `export function normCode(s: any): string` — `String(s||'').toUpperCase().replace(/\s/g,'')`
  - `class Lobby { constructor({ maxRooms = MAX_ROOMS, roomOpts = {} } = {}) }`
    - `rooms: Map<string, Room>`
    - `create(conn, name, { bots = true, isPublic = true } = {}) → { room, id } | { error: 'limit' }` — gera código único, `room.host` = nome limpo, depois `room.join(conn, name, { bots })`.
    - `join(conn, name, code) → { room, id } | { error: 'notfound' | 'full' }`
    - `leave(room, id): void` — `room.leave(id)`; se `room.humans === 0`, remove do mapa.
    - `list() → Array<{ code, host, humans, slots, bots }>` só das públicas.
    - `tick(): void` — `room.tick()` em todas.
  - `Room`: `code: string`, `isPublic: boolean`, `host: string`; `roster()` passa a ter `code`, `public`.

- [ ] **Step 1: Testes que falham** em `test/lobby.test.js` (reaproveite o `fakeConn` de `test/sim.test.js`, copiando-o):
  - `lobby: cria sala pública com código válido` — `create(a,'Ana',{isPublic:true})` → `id === 0`, `room.code` casa `/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$/`, `a.msgs[0].t === 'welcome'`, `a.msgs[0].code === room.code`, `a.msgs[0].public === true`.
  - `lobby: entra pelo código, normalizando` — `join(b,'Bia', ' ' + code.toLowerCase() + ' ')` → `id === 1`, mesma `room`.
  - `lobby: código inexistente e sala cheia` — `join(c,'C','ZZZZZ').error === 'notfound'`; com `roomOpts:{slots:1}`, segundo `join` → `'full'`.
  - `lobby: privada fora da lista` — uma pública e uma privada → `list().length === 1`, `list()[0]` igual a `{ code, host:'Ana', humans:1, slots:8, bots:true }`.
  - `lobby: sala some quando o último sai` — dois entram, `leave` de um → `rooms.size === 1`; `leave` do outro → `rooms.size === 0`.
  - `lobby: limite de salas` — `new Lobby({maxRooms:2})`, terceira `create` → `{ error:'limit' }`.
  - `lobby: tick roda só as salas existentes` — após `create` e alguns `tick()`, a conexão recebe `snap`.

- [ ] **Step 2:** `npm test` → os novos testes falham (módulo inexistente); os antigos passam.
- [ ] **Step 3:** Implementar `src/server/lobby.js` e os campos em `room.js` conforme Interfaces. Código gerado com `Math.random` sobre `CODE_CHARS`, repetindo se já existe. Limpeza do nome do host: mesma regra de `Room.join` (extrair para função `cleanName(name, fallback)` exportada de `room.js` e usar nos dois).
- [ ] **Step 4:** `npm test` → todos passam.
- [ ] **Step 5:** Commit (`Lobby com várias salas por código ...`).

### Task 2: `server.js` usa o `Lobby`

**Files:**
- Modify: `server.js`
- Modify: `AGENTS.md` (seção Rede: várias salas, mensagens novas, `/api/rooms`)

**Interfaces:**
- Consumes: `Lobby` da Task 1.
- Produces (protocolo):
  - Cliente → `{ t:'create', name, bots: boolean, public: boolean }` ou `{ t:'join', name, code }`.
  - Servidor → `welcome` (com `code`, `public`) ou `{ t:'error', reason: 'notfound'|'full'|'limit' }` e fecha a conexão.
  - `GET /api/rooms` → `200 application/json` com `lobby.list()`.

- [ ] **Step 1:** Trocar `room` por `lobby = new Lobby()`; cada conexão guarda `{ room, id }`; `cmd` vai para `room.onCmd(id, m)`; `close` chama `lobby.leave(room, id)`; o `setInterval` chama `lobby.tick()`. Logs com o código da sala.
- [ ] **Step 2:** Rota `/api/rooms` antes da entrega de arquivos.
- [ ] **Step 3: Verificar** — `PORT=5199 npm start` em background e um script de fumaça no scratchpad (Node + `ws`) que: cria sala privada → recebe `welcome` com código; segundo cliente `join` com o código em minúsculas → `welcome` com `id 1`; `curl localhost:5199/api/rooms` → `[]`; cria pública → aparece; `join` com `ZZZZZ` → `{t:'error',reason:'notfound'}`; fecha todos → `/api/rooms` volta `[]`. Esperado: todas as checagens imprimem OK. Derrubar o servidor da porta 5199.
- [ ] **Step 4:** Atualizar `AGENTS.md` (Rede) e commit.

### Task 3: Novo menu e cliente

**Files:**
- Modify: `index.html` (markup e CSS do menu; `#pauseTag` continua)
- Modify: `src/net.js` (`connect`)
- Modify: `src/main.js` (`startTraining`, `startOnline`, lista pública)
- Modify: `AGENTS.md` (Estrutura/descrição do menu, se mudou algo)

**Interfaces:**
- Consumes: protocolo da Task 2.
- Produces:
  - `NetGame.connect(name: string, opts: { create?: { bots: boolean, public: boolean }, code?: string }) → Promise<void>`; após `welcome` expõe `this.code`, `this.isPublic`, `this.bots`. Erros: `notfound` → "Sala não encontrada.", `full` → "A sala está cheia (8 jogadores).", `limit` → "O servidor já tem salas demais. Tente mais tarde."

- [ ] **Step 1: Markup** — menu com campo **Seu nome** e dois blocos (abas `Single player` | `Multiplayer`, só um visível):
  - Single player: `#bots` com opções 1–7 (padrão 7), `#skill` (já existe), botão **Jogar** (submit).
  - Multiplayer: `#roomVis` (Pública/Privada), `#netBots` (Com bots/Sem bots), botão `#create` **Criar sala**; `#code` (maxlength 5, `autocapitalize="characters"`) + botão `#joinCode` **Entrar**; lista `#roomList` (vazia → "Nenhuma sala pública aberta."); `#netStatus` (já existe). Seguir o estilo atual (`.opts`, `button.go`, `button.go.alt`).
- [ ] **Step 2: `net.js`** — `connect(name, opts)` conforme Interfaces; mensagem `error` rejeita com o texto acima.
- [ ] **Step 3: `main.js`** —
  - `startOnline(opts)` recebe `{create}` ou `{code}`; remove o aviso "sala já aberta com/sem bots" e o `wantBots` antigo; mantém "Sala sem bots: esperando outros jogadores".
  - `#pauseTag`: `Sala ${code} (${pública|privada}) — a partida continua rolando enquanto você está aqui.`
  - Lista pública: `refreshRooms()` faz `fetch('/api/rooms')` e desenha cada sala `host · humans/slots · com|sem bots` + botão Entrar (`startOnline({code})`), escapando o host com `esc`. Roda a cada 3 s só com `state === 'menu'` e a aba Multiplayer aberta; para nos outros casos. Falha de rede → mostra "Não foi possível listar as salas."
- [ ] **Step 4: Verificar no navegador** — `PORT=5199 npm start` em background; Playwright CLI `--browser chromium`:
  - Single player com 1 bot → `window.__tinta.game.players.length === 2`.
  - Aba 2: criar sala pública → `window.__tinta.net.code` com 5 letras; numa segunda página, a lista mostra a sala; clicar Entrar → `localId === 1`.
  - Segunda página: código `zzzzz` → `#netStatus` = "Sala não encontrada."
  - Screenshot do menu nas duas abas para conferência visual. Derrubar o servidor da 5199.
- [ ] **Step 5:** `npm test` passa; atualizar `AGENTS.md`; commit.
