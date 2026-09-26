/* Banc d'essai headless de Street Wars (node) : cartes + parties 100 % CPU.
 * Lancer : node street_wars_sim_test.js [nbParties]
 * Verifie : symetrie/connexite des cartes, fin de partie atteinte, pas
 * d'exception, et sort quelques stats d'equilibrage (duree, raisons de fin,
 * auto-eliminations des CPU). */
'use strict';
const path = require('path');
const Sim = require(path.join(__dirname, '..', 'fivecade_street_wars', 'html', 'sim.js'));

const W = Sim.W, H = Sim.H;
let failures = 0;
function fail(msg) { failures++; console.error('ECHEC :', msg); }

// 1. Cartes : symetrie + connexite, pour chaque type.
for (const type of Sim.MAP_TYPES) {
  let buildings = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const map = Sim._buildMap(type, Sim._makeRng(seed));
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const k = map.kind[y * W + x];
      if (k !== map.kind[y * W + (W - 1 - x)] || k !== map.kind[(H - 1 - y) * W + x]) {
        fail(`carte ${type.id} graine ${seed} non symetrique en ${x},${y}`); y = H; break;
      }
    }
    const b = map.bases[0];
    if (!Sim._isConnected(map.kind.map(k => k), b.sx, b.sy)) {
      // les cours interieures (cites) sont enfermees : on tolere, pas les autres
      if (type.yard === 0) fail(`carte ${type.id} graine ${seed} non connexe`);
    }
    buildings += map.kind.filter(k => k === 1).length;
  }
  console.log(`carte ${type.id.padEnd(11)} : ${(buildings / 200).toFixed(0)} cases de batiment en moyenne / ${W * H}`);
}

// Apercu ASCII d'une carte de chaque type
for (const type of Sim.MAP_TYPES) {
  const map = Sim._buildMap(type, Sim._makeRng(7));
  console.log(`\n${type.label}`);
  for (let y = 0; y < H; y++) {
    let line = '';
    for (let x = 0; x < W; x++) { const k = map.kind[y * W + x]; line += k === 1 ? '#' : k === 2 ? 'Q' : k === 3 ? 'X' : '.'; }
    console.log(line);
  }
}

// 2. Parties completes entre 4 CPU.
const games = Number(process.argv[2] || 20);
const stats = { crush: 0, drop: 0, rounds: 0, survie: 0, territoire: 0, egalite: 0, selfHits: 0, hits: 0, elims: 0, ms: 0, bombs: 0, bonus: 0, picks: 0 };
for (let g = 0; g < games; g++) {
  const m = Sim.createMatch({
    seed: 1000 + g,
    seats: Sim.GANGS.map(ga => ({ gang: ga.id, name: 'CPU', bot: true }))
  });
  let ticks = 0;
  while (!m.finished && ticks < 20 * 60 * 30) {
    Sim.step(m, Sim.TICK_MS);
    ticks++;
    const snap = Sim.snapshot(m);
    for (const e of snap.ev) {
      if (e.t === 'hit') { stats.hits++; if (e.by === e.s) stats.selfHits++; }
      if (e.t === 'elim') stats.elims++;
      if (e.t === 'round_end') { stats.rounds++; stats[e.reason]++; }
      if (e.t === 'bomb') stats.bombs++;
      if (e.t === 'bonus') stats.bonus++;
      if (e.t === 'pick') stats.picks++;
      if (e.t === 'crush') stats.crush++;
      if (e.t === 'drop') stats.drop++;
    }
    if (snap.ph === 'play') stats.ms += Sim.TICK_MS;
  }
  if (!m.finished) fail(`partie ${g} jamais terminee (manche ${m.round}, phase ${m.phase})`);
  const wins = m.seats.map(s => s.wins).join('-');
  console.log(`partie ${g}: ${m.round} manches, vainqueur ${m.matchWinner >= 0 ? Sim.GANGS[m.matchWinner].label : 'EGALITE'} (${wins})`);
}
console.log('\nStats sur', games, 'parties :');
console.log(`  manches ${stats.rounds}, duree moyenne de jeu ${(stats.ms / stats.rounds / 1000).toFixed(1)} s`);
console.log(`  fins : survie ${stats.survie}, territoire ${stats.territoire}, egalite ${stats.egalite}`);
console.log(`  vies perdues ${stats.hits} (dont ${stats.selfHits} par sa propre bombe), eliminations ${stats.elims}`);
console.log(`  bombes ${stats.bombs}, bonus apparus ${stats.bonus}, ramasses ${stats.picks}, laches apres une vie perdue ${stats.drop}`);
console.log(`  ecrases par la police ${stats.crush}`);
console.log(failures ? `\n${failures} ECHEC(S)` : '\nOK');
process.exit(failures ? 1 : 0);
