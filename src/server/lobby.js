// Lobby do servidor: guarda as salas abertas por código. Pública = aparece na lista;
// privada = só entra quem tem o código. A sala é apagada quando o último humano sai.
// Como a Room, não conhece WebSocket (recebe "conn" com send(texto)).
import { Room, cleanName } from './room.js';

export const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sem 0/O e 1/I/L
export const MAX_ROOMS = 20;

export function normCode(s) {
  return String(s || '').toUpperCase().replace(/\s/g, '');
}

export class Lobby {
  constructor({ maxRooms = MAX_ROOMS, roomOpts = {} } = {}) {
    this.maxRooms = maxRooms; this.roomOpts = roomOpts;
    this.rooms = new Map();
  }

  newCode() {
    let code;
    do {
      code = '';
      for (let i = 0; i < 5; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    } while (this.rooms.has(code));
    return code;
  }

  // Abre uma sala nova com quem criou dentro. Devolve { room, id } ou { error: 'limit' }.
  create(conn, name, { bots, skill, isPublic = true, map } = {}) {
    if (this.rooms.size >= this.maxRooms) return { error: 'limit' };
    const room = new Room({ ...this.roomOpts, map });
    room.code = this.newCode(); room.isPublic = !!isPublic; room.host = cleanName(name, 'Anônimo');
    this.rooms.set(room.code, room);
    const id = room.join(conn, name, { bots, skill });
    return { room, id };
  }

  // Entra numa sala existente. Devolve { room, id } ou { error: 'notfound' | 'full' }.
  join(conn, name, code) {
    const room = this.rooms.get(normCode(code));
    if (!room) return { error: 'notfound' };
    const id = room.join(conn, name);
    if (id < 0) return { error: 'full' };
    return { room, id };
  }

  leave(room, id) {
    room.leave(id);
    if (room.humans === 0) this.rooms.delete(room.code);
  }

  list() {
    const out = [];
    for (const r of this.rooms.values()) {
      if (r.isPublic) out.push({ code: r.code, host: r.host, humans: r.humans, slots: r.slots.length, bots: r.botCount, skill: r.skill, map: r.mapId });
    }
    return out;
  }

  tick() {
    for (const r of this.rooms.values()) r.tick();
  }
}
