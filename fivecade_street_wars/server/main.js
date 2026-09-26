/* ==========================================================================
 * Street Wars, Gang Wars Edition - serveur (salons + parties en ligne)
 *
 * Fait autorite sur tout : les bornes n'envoient que leurs touches
 * (direction tenue, bombe) et affichent l'etat recu. Aucune borne n'est
 * liee a une couleur : n'importe qui cree ou rejoint un salon depuis
 * n'importe quelle borne, et choisit son gang sur la page de selection
 * (un gang = un seul joueur, c'est ce serveur qui tranche).
 *
 * Protocole (un seul evenement dans chaque sens, via client/main.lua) :
 *   borne -> serveur : fivecade_sw:c2s (type, data)
 *   serveur -> borne : fivecade_sw:s2c (type, data)
 * ========================================================================== */
'use strict';

const Sim = (typeof StreetWarsSim !== 'undefined')
  ? StreetWarsSim
  : require(GetResourcePath(GetCurrentResourceName()) + '/html/sim.js');

const EV_C2S = 'fivecade_sw:c2s';
const EV_S2C = 'fivecade_sw:s2c';
const MAX_SEATS = 4;
const COUNTDOWN_MS = 5000;     // decompte une fois les 4 gangs verrouilles
const RATE_PER_SEC = 60;       // anti-flood par joueur (messages/s)
const MAX_CATCHUP_STEPS = 4;   // rattrapage max si le serveur a eu un a-coup

const clients = new Map(); // src -> { src, name, roomId, tokens }
const rooms = new Map();   // id  -> room
let nextRoomId = 1;
let lastTick = Date.now();

function send(src, t, d) { emitNet(EV_S2C, src, t, d === undefined ? {} : d); }

function gangValid(g) { return Sim.gangIndex(g) >= 0; }

/* Nom choisi par le joueur pour son perso : 12 caracteres, sans caracteres
 * de controle ni balises (il est affiche chez tous les joueurs du salon). */
const NICK_MAX = 12;
function cleanNick(v) {
  if (typeof v !== 'string') return '';
  return v.replace(/[\u0000-\u001f<>"'`\\]/g, '').replace(/\s+/g, ' ').trim().toUpperCase().substring(0, NICK_MAX);
}

/* ---------------------------------------------------------------- salons */

function seatsOf(room) {
  return room.members.map(m => ({ name: m.name, nick: m.nick || '', gang: m.gang || '', locked: m.locked, bot: false, src: m.src }))
    .concat(room.bots.map(b => ({ name: 'CPU', nick: '', gang: b.gang, locked: true, bot: true, src: -1 })));
}

function gangTaken(room, gang, exceptSrc) {
  return room.members.some(m => m.locked && m.gang === gang && m.src !== exceptSrc)
    || room.bots.some(b => b.gang === gang);
}

function roomView(room, forSrc) {
  const host = room.members.find(m => m.src === room.hostSrc);
  return {
    id: room.id,
    host: host ? host.name : '?',
    isHost: room.hostSrc === forSrc,
    state: room.state,
    cd: Math.max(0, Math.ceil(room.countdownMs)),
    seats: seatsOf(room).map(s => ({ name: s.name, nick: s.nick, gang: s.gang, locked: s.locked, bot: s.bot, me: s.src === forSrc }))
  };
}

function broadcastRoom(room) {
  room.members.forEach(m => send(m.src, 'room', roomView(room, m.src)));
}

function roomList() {
  return Array.from(rooms.values()).map(r => {
    const host = r.members.find(m => m.src === r.hostSrc);
    return { id: r.id, host: host ? host.name : '?', n: r.members.length + r.bots.length, state: r.state };
  });
}

function broadcastList() {
  const list = roomList();
  clients.forEach(c => { if (c.roomId === null) send(c.src, 'rooms', { list: list }); });
}

function totalSeats(room) { return room.members.length + room.bots.length; }

/* Les 4 places remplies et verrouillees -> decompte ; sinon on l'annule. */
function checkReady(room) {
  if (room.state === 'playing') return;
  const ready = totalSeats(room) === MAX_SEATS
    && room.members.every(m => m.locked) && room.bots.every(b => b.gang);
  if (ready && room.state !== 'countdown') { room.state = 'countdown'; room.countdownMs = COUNTDOWN_MS; }
  else if (!ready && room.state === 'countdown') { room.state = 'lobby'; room.countdownMs = 0; }
}

function createRoom(client) {
  const room = {
    id: nextRoomId++, hostSrc: client.src,
    members: [{ src: client.src, name: client.name, gang: null, locked: false }],
    bots: [], state: 'lobby', countdownMs: 0,
    match: null, seatSrc: [], acc: 0, lastCdSecond: -1
  };
  rooms.set(room.id, room);
  client.roomId = room.id;
  broadcastRoom(room);
  broadcastList();
}

function joinRoom(client, id) {
  const room = rooms.get(Number(id));
  if (!room) return send(client.src, 'err', { msg: 'Ce salon n\'existe plus.' });
  if (room.state === 'playing') return send(client.src, 'err', { msg: 'Partie déjà en cours.' });
  if (totalSeats(room) >= MAX_SEATS) return send(client.src, 'err', { msg: 'Salon complet.' });
  room.members.push({ src: client.src, name: client.name, gang: null, locked: false });
  client.roomId = room.id;
  checkReady(room);
  broadcastRoom(room);
  broadcastList();
}

function leaveRoom(src) {
  const client = clients.get(src);
  if (!client || client.roomId === null) return;
  const room = rooms.get(client.roomId);
  client.roomId = null;
  if (!room) return;
  room.members = room.members.filter(m => m.src !== src);

  if (room.state === 'playing' && room.match) {
    // En pleine partie : le gang continue, pilote par un CPU.
    const seat = room.seatSrc.indexOf(src);
    if (seat >= 0) { room.seatSrc[seat] = -1; Sim.setBot(room.match, seat, true); }
  }
  if (room.members.length === 0) {
    rooms.delete(room.id);
  } else {
    if (room.hostSrc === src) room.hostSrc = room.members[0].src;
    checkReady(room);
    broadcastRoom(room);
  }
  broadcastList();
}

/* ---------------------------------------------------------------- partie */

function startMatch(room) {
  const seats = seatsOf(room);
  room.seatSrc = seats.map(s => s.src);
  room.match = Sim.createMatch({
    seed: ((Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0),
    seats: seats.map(s => ({ gang: s.gang, name: s.bot ? 'CPU' : (s.nick || 'JOUEUR'), bot: s.bot }))
  });
  room.state = 'playing';
  room.countdownMs = 0;
  room.acc = 0;
  const pub = seats.map(s => ({ name: s.bot ? 'CPU' : (s.nick || 'JOUEUR'), nick: s.nick, gang: s.gang, bot: s.bot }));
  room.members.forEach(m => send(m.src, 'start', { seat: room.seatSrc.indexOf(m.src), seats: pub }));
  broadcastList();
}

function endMatch(room) {
  room.match = null;
  room.seatSrc = [];
  room.state = 'lobby';
  // Retour a la selection : les humains re-verrouillent, les CPU restent.
  room.members.forEach(m => { m.gang = null; m.locked = false; });
  room.members.forEach(m => send(m.src, 'end', {}));
  broadcastRoom(room);
  broadcastList();
}

function tickRoom(room, elapsed) {
  if (room.state === 'countdown') {
    room.countdownMs -= elapsed;
    const sec = Math.ceil(room.countdownMs / 1000);
    if (room.countdownMs <= 0) { startMatch(room); return; }
    if (sec !== room.lastCdSecond) { room.lastCdSecond = sec; broadcastRoom(room); }
    return;
  }
  if (room.state !== 'playing' || !room.match) return;
  room.acc += elapsed;
  let steps = 0;
  while (room.acc >= Sim.TICK_MS && steps < MAX_CATCHUP_STEPS) {
    Sim.step(room.match, Sim.TICK_MS);
    room.acc -= Sim.TICK_MS;
    steps++;
  }
  if (room.acc > Sim.TICK_MS * MAX_CATCHUP_STEPS) room.acc = 0; // gros a-coup : on lache le retard
  if (steps === 0) return;
  const snap = Sim.snapshot(room.match);
  room.members.forEach(m => send(m.src, 'snap', snap));
  if (room.match.finished) endMatch(room);
}

setInterval(() => {
  const now = Date.now();
  const elapsed = Math.min(1000, now - lastTick);
  lastTick = now;
  rooms.forEach(room => tickRoom(room, elapsed));
  // recharge de l'anti-flood
  clients.forEach(c => { c.tokens = Math.min(RATE_PER_SEC, c.tokens + RATE_PER_SEC * elapsed / 1000); });
}, Sim.TICK_MS);

/* ---------------------------------------------------------------- reseau */

function memberOf(client) {
  const room = client.roomId !== null ? rooms.get(client.roomId) : null;
  if (!room) return null;
  const member = room.members.find(m => m.src === client.src);
  return member ? { room: room, member: member } : null;
}

const handlers = {
  hello(client) { send(client.src, 'rooms', { list: roomList() }); },
  list(client) { send(client.src, 'rooms', { list: roomList() }); },
  create(client) { if (client.roomId === null) createRoom(client); },
  join(client, d) { if (client.roomId === null && d) joinRoom(client, d.id); },
  leave(client) {
    leaveRoom(client.src);
    send(client.src, 'left', {});
    send(client.src, 'rooms', { list: roomList() });
  },
  lock(client, d) {
    const mm = memberOf(client);
    if (!mm || mm.room.state === 'playing' || !d || !gangValid(d.gang)) return;
    if (gangTaken(mm.room, d.gang, client.src)) {
      send(client.src, 'err', { msg: 'Ce gang est déjà pris.' });
      broadcastRoom(mm.room);
      return;
    }
    mm.member.gang = d.gang;
    mm.member.nick = cleanNick(d.name);
    mm.member.locked = true;
    checkReady(mm.room);
    broadcastRoom(mm.room);
  },
  unlock(client) {
    const mm = memberOf(client);
    if (!mm || mm.room.state === 'playing') return;
    mm.member.gang = null;
    mm.member.locked = false;
    checkReady(mm.room);
    broadcastRoom(mm.room);
  },
  addBot(client) {
    const mm = memberOf(client);
    if (!mm || mm.room.hostSrc !== client.src || mm.room.state === 'playing') return;
    if (totalSeats(mm.room) >= MAX_SEATS) return;
    const free = Sim.GANGS.map(g => g.id).filter(g => !gangTaken(mm.room, g, -1));
    if (!free.length) return;
    mm.room.bots.push({ gang: free[Math.floor(Math.random() * free.length)] });
    checkReady(mm.room);
    broadcastRoom(mm.room);
    broadcastList();
  },
  removeBot(client) {
    const mm = memberOf(client);
    if (!mm || mm.room.hostSrc !== client.src || mm.room.state === 'playing') return;
    if (!mm.room.bots.length) return;
    mm.room.bots.pop();
    checkReady(mm.room);
    broadcastRoom(mm.room);
    broadcastList();
  },
  dir(client, d) {
    const mm = memberOf(client);
    if (!mm || !mm.room.match) return;
    const seat = mm.room.seatSrc.indexOf(client.src);
    if (seat >= 0) Sim.setInput(mm.room.match, seat, d && typeof d.d === 'string' ? d.d : null);
  },
  bomb(client) {
    const mm = memberOf(client);
    if (!mm || !mm.room.match) return;
    const seat = mm.room.seatSrc.indexOf(client.src);
    if (seat >= 0) Sim.pressBomb(mm.room.match, seat);
  },
  bye(client) {
    leaveRoom(client.src);
    clients.delete(client.src);
    broadcastList();
  }
};

onNet(EV_C2S, (t, d) => {
  const src = Number(source);
  if (typeof t !== 'string' || !Object.prototype.hasOwnProperty.call(handlers, t)) return;
  let client = clients.get(src);
  if (!client) {
    if (t === 'bye') return;
    // Le nom FiveM n'est jamais utilise : seul le nom tape en jeu s'affiche.
    client = { src: src, name: 'JOUEUR', roomId: null, tokens: RATE_PER_SEC };
    clients.set(src, client);
  }
  if (client.tokens < 1) return;
  client.tokens -= 1;
  handlers[t](client, d);
});

on('playerDropped', () => {
  const src = Number(source);
  if (!clients.has(src)) return;
  leaveRoom(src);
  clients.delete(src);
  broadcastList();
});
