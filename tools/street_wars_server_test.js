/* Test headless du serveur de Street Wars (node) : le vrai server/main.js
 * tourne dans un bac a sable avec de fausses fonctions FiveM et une
 * horloge acceleree. Lancer : node street_wars_server_test.js
 * Verifie : creation/rejoindre, gang deja pris refuse, salon complet
 * refuse, decompte annule si quelqu'un deverrouille, partie en ligne
 * complete jusqu'au retour au salon, joueur deconnecte remplace par un CPU. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..', 'fivecade_street_wars');
let now = 1000000;
let intervalFn = null;
const netHandlers = {}, eventHandlers = {};
const inbox = {}; // src -> [{t, d}]

const ctx = {
  console, Math, JSON, Object, Array, Number, String, Map, Set, Infinity,
  Date: { now: () => now },
  setInterval: (fn) => { intervalFn = fn; return 1; },
  onNet: (name, fn) => { netHandlers[name] = fn; },
  on: (name, fn) => { eventHandlers[name] = fn; },
  emitNet: (name, target, t, d) => { (inbox[target] = inbox[target] || []).push({ t, d: JSON.parse(JSON.stringify(d)) }); },
  GetPlayerName: (src) => 'Joueur' + src,
  source: 0
};
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'html', 'sim.js'), 'utf8'), ctx, { filename: 'sim.js' });
vm.runInContext(fs.readFileSync(path.join(root, 'server', 'main.js'), 'utf8'), ctx, { filename: 'main.js' });

let failures = 0;
function check(cond, msg) { if (!cond) { failures++; console.error('ECHEC :', msg); } else console.log('ok  -', msg); }
function send(src, t, d) { ctx.source = src; netHandlers['fivecade_sw:c2s'](t, d || {}); }
function last(src, t) { const box = (inbox[src] || []).filter(m => m.t === t); return box.length ? box[box.length - 1].d : null; }
function tick(ms) { for (let e = 0; e < ms; e += 50) { now += 50; intervalFn(); } }

// Salon + gangs
send(1, 'hello'); send(2, 'hello'); send(3, 'hello'); send(4, 'hello'); send(5, 'hello');
send(1, 'create');
check(last(1, 'room') && last(1, 'room').isHost, 'le createur est hote du salon');
check(last(2, 'rooms').list.length === 1, 'les autres voient le salon dans la liste');
send(2, 'join', { id: 1 });
send(1, 'lock', { gang: 'purple' });
send(2, 'lock', { gang: 'purple' });
check(last(2, 'err') && /pris/.test(last(2, 'err').msg), 'gang deja pris refuse');
send(2, 'lock', { gang: 'blue', name: '  le <b>Boss</b> du 93 et plus  ' });
check(last(1, 'room').seats[1].nick === 'LE BBOSS/B D', 'nom du perso nettoye (balises, longueur 12, majuscules) : ' + last(1, 'room').seats[1].nick);
send(2, 'addBot');
check(last(1, 'room').seats.length === 2, 'un non-hote ne peut pas ajouter de CPU');
send(3, 'join', { id: 1 }); send(4, 'join', { id: 1 });
send(5, 'join', { id: 1 });
check(last(5, 'err') && /complet/.test(last(5, 'err').msg), 'salon complet refuse');
send(3, 'lock', { gang: 'green' });
send(4, 'lock', { gang: 'yellow' });
check(last(1, 'room').state === 'countdown', 'decompte lance quand les 4 gangs sont verrouilles');
send(4, 'unlock');
check(last(1, 'room').state === 'lobby', 'decompte annule si un joueur deverrouille');
send(4, 'leave');
send(1, 'addBot');
const bot = last(1, 'room').seats.find(s => s.bot);
check(bot && bot.gang === 'yellow', 'le CPU prend le seul gang libre');
check(last(1, 'room').state === 'countdown', 'decompte relance avec le CPU');

// Partie en ligne
tick(5100);
const start1 = last(1, 'start');
check(start1 && start1.seats.length === 4, 'partie lancee pour les humains');
check(start1.seats[1].name === 'LE BBOSS/B D', 'le nom choisi est celui utilise en partie');
check(inbox[1].some(m => m.t === 'snap' && m.d.mp), 'premier snapshot avec la carte');

send(3, 'bye'); // un joueur quitte en pleine partie
const seat3 = 2;
tick(200);
check(last(1, 'snap').pl[seat3][8] === 1, 'le joueur parti est remplace par un CPU');

// Les deux humains restants bougent au hasard pendant toute la partie
const dirs = ['up', 'down', 'left', 'right', ''];
let guard = 0, ended = false;
while (!ended && guard++ < 20 * 60 * 20) {
  if (guard % 7 === 0) send(1, 'dir', { d: dirs[Math.floor(Math.random() * 5)] });
  if (guard % 11 === 0) send(2, 'dir', { d: dirs[Math.floor(Math.random() * 5)] });
  if (guard % 30 === 0) { send(1, 'bomb'); send(2, 'bomb'); }
  tick(50);
  ended = (inbox[1] || []).some(m => m.t === 'end');
}
const snaps = inbox[1].filter(m => m.t === 'snap');
const finalSnap = snaps[snaps.length - 1].d;
console.log(`     partie terminee en ${Math.round(guard * 50 / 1000)} s de jeu, manches ${finalSnap.rd}, vainqueur siege ${finalSnap.mw}, manches ${finalSnap.ws.join('-')}`);
check(ended, 'fin de partie -> message end');
const back = last(1, 'room');
check(back && back.state === 'lobby' && back.seats.filter(s => !s.bot).every(s => !s.locked), 'retour au salon, humains a re-verrouiller');
const sizes = snaps.map(s => JSON.stringify(s.d).length);
console.log(`     taille des snapshots : moyenne ${Math.round(sizes.reduce((a, b) => a + b, 0) / sizes.length)} octets, max ${Math.max(...sizes)}`);

// Deconnexion brutale de tout le monde -> salon supprime
ctx.source = 1; eventHandlers.playerDropped();
ctx.source = 2; eventHandlers.playerDropped();
send(5, 'list');
check(last(5, 'rooms').list.length === 0, 'salon supprime quand tous les humains sont partis');

console.log(failures ? `\n${failures} ECHEC(S)` : '\nOK');
process.exit(failures ? 1 : 0);
