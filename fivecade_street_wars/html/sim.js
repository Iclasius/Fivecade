/* ==========================================================================
 * Street Wars, Gang Wars Edition - moteur de simulation (partage)
 *
 * Le MEME fichier tourne a deux endroits :
 *   - cote serveur FiveM (server/main.js) : fait autorite en multijoueur ;
 *   - dans la NUI (game.js) : partie contre les CPU, sans aucun serveur.
 * Logique pure : ni Phaser, ni API FiveM, aucun rendu.
 *
 * Grille (kind) : 0 = route, 1 = batiment intact, 2 = QG,
 *                 3 = batiment blinde (mur eternel : ni casse, ni colorie),
 *                 4 = barrage de police (descente de fin de manche, idem 3).
 * Couleur (owner) : -1 = neutre, sinon index de siege 0..3.
 * Un batiment couvre plusieurs cases : chaque branche de flamme n'en
 * detruit qu'UNE, quelle que soit la portee.
 * ========================================================================== */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  root.StreetWarsSim = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var TICK_MS = 33; // pas de simulation fixe (30 Hz)
  var W = 29, H = 15, N = W * H; // taillee pour l'ecran large de la borne (≈ 1,8:1)

  /* Reglages par defaut (equilibrage : voir feedback-fivcade-game-balance). */
  var CFG = {
    roundMs: 120000,       // duree d'une manche
    introMs: 3000,         // decompte avant chaque manche
    roundEndMs: 4500,      // ecran de fin de manche
    matchEndMs: 7000,      // ecran "VICTOIRE DU GANG X"
    winsToMatch: 3,        // (inutilise : la partie se joue toujours en 4 manches)
    maxRounds: 4,          // 4 manches maximum (les 4 points du chrono)
    lives: 5,              // la barre du HUD (10 traits) est repartie sur les vies
    botHunt: 1.0,          // gout des CPU pour la traque des autres joueurs
    fuseMs: 1500,          // delai court : la bombe revient vite dans la poche
    flameMs: 500,          // duree de vie d'une flamme (mortelle)
    stepMs: 150,           // temps pour traverser une case
    startBombs: 1, startRange: 2,
    maxBombs: 6, maxRange: 8,
    bonusChance: 0.2,      // chance de bonus par case de batiment detruite
    returnCellsPerSec: 10, // retour automatique au QG apres une vie perdue
    respawnInvulnMs: 1500, // protection a l'arrivee au QG
    botBlunder: 0.03,      // part d'erreurs volontaires des CPU
    policeWaves: [30000, 20000, 10000], // descente de police : un anneau par vague (chrono restant)
    policeWarnMs: 3000,    // l'anneau clignote 3 s avant de tomber
    maxSpeed: 3,           // niveaux de bonus vitesse (baskets)
    speedStep: 0.12,       // -12 % de temps par case a chaque niveau
    aliveOnlyTerritoryWin: true // au chrono, seuls les survivants peuvent gagner
  };

  var GANGS = [
    { id: 'green',  label: 'VERT',   color: 0x3dff6e, symbol: '$' },
    { id: 'purple', label: 'VIOLET', color: 0xb84dff, symbol: 'Ⓐ' },
    { id: 'yellow', label: 'JAUNE',  color: 0xffd23f, symbol: '★' },
    { id: 'blue',   label: 'BLEU',   color: 0x3d6bff, symbol: '☠' }
  ];

  /* Types de cartes : meme regle, disposition differente.
   * cols/rows = tailles de pates de maisons possibles sur chaque axe.
   * armored = part des pates (hors QG) blindes, murs eternels recopies en
   * miroir : zone industrielle la plus blindee, banlieue presque pas. */
  var MAP_TYPES = [
    { id: 'downtown',   label: 'CENTRE-VILLE',      cols: [3],       rows: [3, 4],    avenue: 0,    remove: 0,    merge: 0,    yard: 0,   armored: 0.2 },
    { id: 'suburbs',    label: 'BANLIEUE',          cols: [2, 3],    rows: [2, 3], avenue: 0,    remove: 0.12, merge: 0,    yard: 0,   armored: 0.1 },
    { id: 'industrial', label: 'ZONE INDUSTRIELLE', cols: [3, 4, 5], rows: [3, 4, 5], avenue: 0.15, remove: 0.05, merge: 0.3,  yard: 0,   armored: 0.4 },
    { id: 'projects',   label: 'LES CITÉS',    cols: [3, 4],    rows: [3, 4],    avenue: 0,    remove: 0.1,  merge: 0.15, yard: 0.6, armored: 0.2 }
  ];

  var DIRS = {
    up:    { x: 0,  y: -1, bit: 1, opp: 2 },
    down:  { x: 0,  y: 1,  bit: 2, opp: 1 },
    left:  { x: -1, y: 0,  bit: 4, opp: 8 },
    right: { x: 1,  y: 0,  bit: 8, opp: 4 }
  };
  var DIR_LIST = ['up', 'down', 'left', 'right'];
  var FACING_CODE = { up: 0, down: 1, left: 2, right: 3 };
  var STATE_CODE = { alive: 0, returning: 1, dead: 2 };

  function isWall(k) { return k === 1 || k === 3 || k === 4; }
  function isEternal(k) { return k === 3 || k === 4; } // ni casse, ni colorie

  function fill(n, v) { var a = new Array(n); for (var i = 0; i < n; i++) a[i] = v; return a; }
  function inside(x, y) { return x >= 0 && y >= 0 && x < W && y < H; }

  /* PRNG deterministe (mulberry32) : meme graine = meme suite de cartes. */
  function makeRng(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      var t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(arr, rng) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  /* ======================================================================
   * Generation de carte
   * ====================================================================== */

  /* Decoupe un axe en routes (0) et pates de maisons (1), symetrique, avec
   * une route sur chaque bord. Retourne la liste des pates [debut, fin]. */
  function genAxis(n, sizes, avenue, rng) {
    var minS = Math.min.apply(null, sizes), maxS = Math.max.apply(null, sizes);
    for (var attempt = 0; attempt < 400; attempt++) {
      var arr = fill(n, 0);
      var pos = 1, lastEnd = 0;
      for (var guard = 0; guard < 40; guard++) {
        var w = sizes[Math.floor(rng() * sizes.length)];
        var end = pos + w - 1;
        if (n - 2 * (end + 1) < 1) break; // ne tient plus sans chevaucher son miroir
        for (var k = pos; k <= end; k++) { arr[k] = 1; arr[n - 1 - k] = 1; }
        lastEnd = end;
        pos = end + 1 + (rng() < avenue ? 2 : 1);
      }
      var gap = n - 2 * (lastEnd + 1); // espace central restant (toujours impair)
      if (gap >= 3) {
        var c = gap - 2; // pate central entoure d'une route de chaque cote
        if (c < minS || c > maxS + 1) continue;
        for (var k2 = lastEnd + 2; k2 < lastEnd + 2 + c; k2++) arr[k2] = 1;
      }
      var runs = axisRuns(arr);
      if (runs.length >= 3) return runs;
    }
    // Repli (tailles impossibles pour cette longueur) : on elargit le choix.
    if (sizes.length < 4) return genAxis(n, [2, 3, 4, 5], avenue, rng);
    throw new Error('genAxis: aucune decoupe possible pour ' + n);
  }

  function axisRuns(arr) {
    var runs = [], start = -1;
    for (var i = 0; i <= arr.length; i++) {
      var v = i < arr.length ? arr[i] : 0;
      if (v === 1 && start < 0) start = i;
      if (v !== 1 && start >= 0) { runs.push([start, i - 1]); start = -1; }
    }
    return runs;
  }

  function fillRect(kind, x0, y0, x1, y1, v) {
    for (var y = y0; y <= y1; y++) for (var x = x0; x <= x1; x++) kind[y * W + x] = v;
  }

  /* Toutes les cases praticables (hors batiments) sont-elles reliees ? */
  function isConnected(kind, sx, sy) {
    var seen = fill(N, false), stack = [sy * W + sx], count = 0, total = 0;
    for (var i = 0; i < N; i++) if (!isWall(kind[i])) total++;
    seen[stack[0]] = true;
    while (stack.length) {
      var c = stack.pop(); count++;
      var cx = c % W, cy = (c - cx) / W;
      for (var d = 0; d < 4; d++) {
        var v = DIRS[DIR_LIST[d]], nx = cx + v.x, ny = cy + v.y;
        if (!inside(nx, ny)) continue;
        var ni = ny * W + nx;
        if (seen[ni] || isWall(kind[ni])) continue;
        seen[ni] = true; stack.push(ni);
      }
    }
    return count === total;
  }

  /* Numerote les batiments (composantes connexes) pour le rendu. */
  function labelBuildings(kind) {
    var bld = fill(N, -1), id = 0;
    for (var i = 0; i < N; i++) {
      if (!isWall(kind[i]) || bld[i] >= 0) continue;
      var stack = [i]; bld[i] = id;
      while (stack.length) {
        var c = stack.pop(), cx = c % W, cy = (c - cx) / W;
        for (var d = 0; d < 4; d++) {
          var v = DIRS[DIR_LIST[d]], nx = cx + v.x, ny = cy + v.y;
          if (!inside(nx, ny)) continue;
          var ni = ny * W + nx;
          if (kind[ni] === kind[i] && bld[ni] < 0) { bld[ni] = id; stack.push(ni); }
        }
      }
      id++;
    }
    return bld;
  }

  /* Carte symetrique sur les deux axes : chaque coin (QG tire au sort)
   * a exactement les memes chances. */
  function buildMap(type, rng) {
    for (var attempt = 0; attempt < 80; attempt++) {
      var colRuns = genAxis(W, type.cols, type.avenue, rng);
      var rowRuns = genAxis(H, type.rows, type.avenue, rng);
      var nc = colRuns.length, nr = rowRuns.length;
      var kind = fill(N, 0);
      var present = [];
      for (var j = 0; j < nr; j++) present.push(fill(nc, true));

      var hc = Math.floor((nc - 1) / 2), hr = Math.floor((nr - 1) / 2);
      var isCorner = function (i, j) { return (i === 0 || i === nc - 1) && (j === 0 || j === nr - 1); };
      var mirror = function (i, j, fn) {
        fn(i, j); fn(nc - 1 - i, j); fn(i, nr - 1 - j); fn(nc - 1 - i, nr - 1 - j);
      };

      // Places / terrains vagues (pates retires)
      for (var jj = 0; jj <= hr; jj++) {
        for (var ii = 0; ii <= hc; ii++) {
          if (isCorner(ii, jj) || rng() >= type.remove) continue;
          mirror(ii, jj, function (i, j) { present[j][i] = false; });
        }
      }

      // Batiments blindes : quelques pates entiers, en miroir.
      var armored = [];
      for (j = 0; j < nr; j++) armored.push(fill(nc, false));
      var quarter = [];
      for (jj = 0; jj <= hr; jj++) for (ii = 0; ii <= hc; ii++) {
        if (!isCorner(ii, jj) && present[jj][ii]) quarter.push([ii, jj]);
      }
      shuffle(quarter, rng);
      var nArmored = Math.floor(type.armored * quarter.length + rng()); // arrondi aleatoire
      quarter.slice(0, nArmored).forEach(function (q) {
        mirror(q[0], q[1], function (i, j) { armored[j][i] = true; });
      });

      for (j = 0; j < nr; j++) {
        for (var i = 0; i < nc; i++) {
          if (!present[j][i]) continue;
          fillRect(kind, colRuns[i][0], rowRuns[j][0], colRuns[i][1], rowRuns[j][1], isCorner(i, j) ? 2 : (armored[j][i] ? 3 : 1));
        }
      }

      // Fusions : un batiment enjambe la route entre deux pates voisins.
      var bridge = function (i, j, horizontal) {
        var i2 = horizontal ? i + 1 : i, j2 = horizontal ? j : j + 1;
        if (i2 >= nc || j2 >= nr) return;
        if (!present[j][i] || !present[j2][i2] || isCorner(i, j) || isCorner(i2, j2)) return;
        if (armored[j][i] || armored[j2][i2]) return; // un blinde ne fusionne pas
        if (horizontal) fillRect(kind, colRuns[i][1] + 1, rowRuns[j][0], colRuns[i2][0] - 1, rowRuns[j][1], 1);
        else fillRect(kind, colRuns[i][0], rowRuns[j][1] + 1, colRuns[i][1], rowRuns[j2][0] - 1, 1);
      };
      if (type.merge > 0) {
        for (jj = 0; jj <= hr; jj++) {
          for (ii = 0; ii <= hc; ii++) {
            if (rng() < type.merge) {
              var hz = rng() < 0.5;
              bridge(ii, jj, hz);
              // miroirs du couple (i, i+1) ou (j, j+1)
              if (hz) { bridge(nc - 2 - ii, jj, true); bridge(ii, nr - 1 - jj, true); bridge(nc - 2 - ii, nr - 1 - jj, true); }
              else { bridge(nc - 1 - ii, jj, false); bridge(ii, nr - 2 - jj, false); bridge(nc - 1 - ii, nr - 2 - jj, false); }
            }
          }
        }
      }

      // QG : pates des 4 coins (ordre : haut-gauche, haut-droite, bas-gauche, bas-droite)
      var cornerIdx = [[0, 0], [nc - 1, 0], [0, nr - 1], [nc - 1, nr - 1]];
      var bases = cornerIdx.map(function (ci) {
        var x0 = colRuns[ci[0]][0], x1 = colRuns[ci[0]][1], y0 = rowRuns[ci[1]][0], y1 = rowRuns[ci[1]][1];
        // Point d'apparition : la case du QG la plus proche du centre.
        var sx = ci[0] === 0 ? x1 : x0, sy = ci[1] === 0 ? y1 : y0;
        return { x0: x0, y0: y0, x1: x1, y1: y1, sx: sx, sy: sy, seat: -1 };
      });

      if (!isConnected(kind, bases[0].sx, bases[0].sy)) continue;

      // Cours interieures (cites) : cases vides enfermees, a liberer a la bombe.
      if (type.yard > 0) {
        for (jj = 0; jj <= hr; jj++) {
          for (ii = 0; ii <= hc; ii++) {
            if (isCorner(ii, jj) || !present[jj][ii] || armored[jj][ii] || rng() >= type.yard) continue;
            mirror(ii, jj, function (i, j) {
              var x0 = colRuns[i][0], x1 = colRuns[i][1], y0 = rowRuns[j][0], y1 = rowRuns[j][1];
              if (x1 - x0 < 2 || y1 - y0 < 2) return;
              for (var y = y0 + 1; y < y1; y++) for (var x = x0 + 1; x < x1; x++) {
                if (kind[y * W + x] === 1) kind[y * W + x] = 0;
              }
            });
          }
        }
      }

      var total = 0;
      for (var c = 0; c < N; c++) if (kind[c] !== 2 && kind[c] !== 3) total++;
      return {
        type: type.id, label: type.label, w: W, h: H,
        kind: kind, bld: labelBuildings(kind), owner: fill(N, -1),
        bases: bases, total: total
      };
    }
    // Ne devrait jamais arriver : repli sur le centre-ville (toujours valide).
    return buildMap(MAP_TYPES[0], rng);
  }

  /* ======================================================================
   * Partie / manches
   * ====================================================================== */

  function createMatch(opts) {
    var cfg = {};
    for (var k in CFG) cfg[k] = CFG[k];
    if (opts.cfg) for (var k2 in opts.cfg) cfg[k2] = opts.cfg[k2];
    var m = {
      cfg: cfg,
      rng: makeRng(opts.seed || 1),
      seats: opts.seats.map(function (s) {
        return { gang: s.gang, name: s.name || 'CPU', bot: !!s.bot, wins: 0, totalTerr: 0, kills: 0, input: null };
      }),
      round: 0, tick: 0,
      phase: 'intro', phaseMs: 0, timeMs: 0,
      map: null, lastType: null,
      players: [], bombs: [],
      flameMs: fill(N, 0), flameOwner: fill(N, -1), flameMask: fill(N, 0),
      bonus: fill(N, 0),
      terr: [0, 0, 0, 0],
      roundWinner: -1, roundReason: '', roundWinners: [], matchWinner: -1, matchOver: false, finished: false,
      police: { rings: [], ring: [], wave: 0, warned: -1 },
      events: [], mapDirty: true, gridDirty: true
    };
    startRound(m);
    return m;
  }

  function newPlayer(m, seat, base) {
    var cfg = m.cfg, s = m.seats[seat];
    return {
      seat: seat, bot: s.bot,
      cx: base.sx, cy: base.sy, dx: 0, dy: 0, p: 0, moving: false,
      facing: base.sy > H / 2 ? 'up' : 'down',
      state: 'alive', lives: cfg.lives,
      maxBombs: cfg.startBombs, range: cfg.startRange, speed: 0,
      invulnMs: 0, rx: base.sx, ry: base.sy,
      input: s.bot ? null : s.input, wantBomb: false,
      ai: newAi()
    };
  }

  function startRound(m) {
    m.round++;
    // Type de carte tire au sort, jamais deux fois le meme d'affilee.
    var choices = MAP_TYPES.filter(function (t) { return t.id !== m.lastType; });
    var type = choices[Math.floor(m.rng() * choices.length)];
    m.lastType = type.id;
    m.map = buildMap(type, m.rng);

    // QG secrets : coin tire au sort a chaque manche.
    var corners = shuffle([0, 1, 2, 3], m.rng);
    m.players = [];
    for (var s = 0; s < m.seats.length; s++) {
      var base = m.map.bases[corners[s]];
      base.seat = s;
      m.players.push(newPlayer(m, s, base));
    }

    m.bombs = [];
    m.flameMs = fill(N, 0); m.flameOwner = fill(N, -1); m.flameMask = fill(N, 0);
    m.bonus = fill(N, 0);
    m.phase = 'intro'; m.phaseMs = m.cfg.introMs; m.timeMs = m.cfg.roundMs;
    m.roundWinner = -1; m.roundReason = '';
    var rings = [], ring = fill(N, false);
    for (var r = 0; r < m.cfg.policeWaves.length; r++) {
      rings.push(ringCells(r));
      rings[r].forEach(function (i) { ring[i] = true; });
    }
    m.police = { rings: rings, ring: ring, wave: 0, warned: -1 };
    m.mapDirty = true; m.gridDirty = true;
    recountTerritory(m);
    m.events.push({ t: 'round_start', r: m.round });
  }

  function baseOf(m, seat) {
    var b = m.map.bases;
    for (var i = 0; i < b.length; i++) if (b[i].seat === seat) return b[i];
    return b[0];
  }

  /* Cases de l'anneau r (0 = le bord de la carte). */
  function ringCells(r) {
    var out = [];
    for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
      if (Math.min(x, y, W - 1 - x, H - 1 - y) === r) out.push(y * W + x);
    }
    return out;
  }

  function stepOf(m, pl) { return m.cfg.stepMs * (1 - m.cfg.speedStep * pl.speed); }

  /* Case la plus proche de (x, y) ou l'on peut se tenir (pas un mur). */
  function nearestFree(m, x, y, extraTest) {
    var start = y * W + x, seen = fill(N, false), queue = [start], head = 0;
    seen[start] = true;
    while (head < queue.length) {
      var c = queue[head++];
      if (!isWall(m.map.kind[c]) && (!extraTest || extraTest(c))) return c;
      var cx = c % W, cy = (c - cx) / W;
      for (var d = 0; d < 4; d++) {
        var v = DIRS[DIR_LIST[d]], nx = cx + v.x, ny = cy + v.y;
        if (!inside(nx, ny)) continue;
        var ni = ny * W + nx;
        if (!seen[ni]) { seen[ni] = true; queue.push(ni); }
      }
    }
    return -1;
  }

  /* Point de retour au QG ; si la police l'a recouvert, la case libre la plus proche. */
  function respawnCell(m, seat) {
    var b = baseOf(m, seat), i = b.sy * W + b.sx;
    if (!isWall(m.map.kind[i])) return { x: b.sx, y: b.sy };
    var c = nearestFree(m, b.sx, b.sy, null);
    return c < 0 ? { x: b.sx, y: b.sy } : { x: c % W, y: Math.floor(c / W) };
  }

  function recountTerritory(m) {
    var t = [0, 0, 0, 0], o = m.map.owner;
    for (var i = 0; i < N; i++) if (o[i] >= 0) t[o[i]]++;
    m.terr = t;
  }

  function bombAt(m, x, y) {
    for (var i = 0; i < m.bombs.length; i++) {
      var b = m.bombs[i];
      if (!b.done && b.x === x && b.y === y) return b;
    }
    return null;
  }

  function activeBombs(m, seat) {
    var n = 0;
    for (var i = 0; i < m.bombs.length; i++) if (m.bombs[i].s === seat && !m.bombs[i].done) n++;
    return n;
  }

  function canEnter(m, x, y) {
    if (!inside(x, y)) return false;
    if (isWall(m.map.kind[y * W + x])) return false;
    return !bombAt(m, x, y);
  }

  /* Case "occupee" : celle ou se trouve le centre du personnage. */
  function occupied(pl) {
    if (pl.moving && pl.p >= 0.5) return { x: pl.cx + pl.dx, y: pl.cy + pl.dy };
    return { x: pl.cx, y: pl.cy };
  }

  function position(pl) {
    if (pl.state === 'returning') return { x: pl.rx, y: pl.ry };
    return { x: pl.cx + pl.dx * (pl.moving ? pl.p : 0), y: pl.cy + pl.dy * (pl.moving ? pl.p : 0) };
  }

  function tryPlaceBomb(m, pl) {
    if (pl.state !== 'alive') return;
    if (activeBombs(m, pl.seat) >= pl.maxBombs) return;
    var c = occupied(pl);
    if (isWall(m.map.kind[c.y * W + c.x]) || bombAt(m, c.x, c.y)) return; // une bombe par case
    m.bombs.push({ x: c.x, y: c.y, s: pl.seat, fuse: m.cfg.fuseMs, range: pl.range, done: false });
    m.events.push({ t: 'bomb', x: c.x, y: c.y, s: pl.seat });
  }

  function paint(m, i, seat) {
    if (m.map.kind[i] === 2 || isEternal(m.map.kind[i])) return; // ni QG, ni mur eternel
    if (m.map.owner[i] !== seat) { m.map.owner[i] = seat; m.gridDirty = true; }
  }

  function addFlame(m, i, seat) {
    m.flameMs[i] = m.cfg.flameMs;
    m.flameOwner[i] = seat;
  }

  function explodeBomb(m, b, queue, spawns) {
    var map = m.map, center = b.y * W + b.x;
    addFlame(m, center, b.s);
    paint(m, center, b.s);
    m.events.push({ t: 'boom', x: b.x, y: b.y, s: b.s });
    for (var d = 0; d < 4; d++) {
      var v = DIRS[DIR_LIST[d]], prev = center;
      for (var r = 1; r <= b.range; r++) {
        var x = b.x + v.x * r, y = b.y + v.y * r;
        if (!inside(x, y)) break;
        var i = y * W + x;
        if (isEternal(map.kind[i])) break; // mur eternel : la flamme s'y ecrase
        if (map.kind[i] === 1) {
          // Batiment : une seule case detruite par branche, puis la flamme s'arrete.
          map.kind[i] = 0; map.bld[i] = -1; m.gridDirty = true;
          addFlame(m, i, b.s); paint(m, i, b.s);
          m.flameMask[prev] |= v.bit; m.flameMask[i] |= v.opp;
          spawns.push(i);
          m.events.push({ t: 'break', x: x, y: y });
          break;
        }
        var other = bombAt(m, x, y);
        if (other) { // reaction en chaine, la flamme s'arrete sur la bombe
          if (other.fuse > 0) { other.fuse = 0; queue.push(other); }
          break;
        }
        addFlame(m, i, b.s); paint(m, i, b.s);
        m.flameMask[prev] |= v.bit; m.flameMask[i] |= v.opp;
        if (m.bonus[i]) { // bonus au sol detruit, la flamme s'arrete dessus
          m.bonus[i] = 0;
          m.events.push({ t: 'bonus_gone', x: x, y: y });
          break;
        }
        prev = i;
      }
    }
  }

  function resolveExplosions(m) {
    var queue = [];
    for (var i = 0; i < m.bombs.length; i++) if (m.bombs[i].fuse <= 0) queue.push(m.bombs[i]);
    if (!queue.length) return;
    var spawns = [];
    while (queue.length) {
      var b = queue.shift();
      if (b.done) continue;
      b.done = true;
      explodeBomb(m, b, queue, spawns);
    }
    m.bombs = m.bombs.filter(function (b2) { return !b2.done; });
    // Les bonus apparaissent APRES toutes les explosions du tick : celle qui
    // vient de casser la case ne peut pas les detruire.
    for (var s = 0; s < spawns.length; s++) {
      if (m.rng() < m.cfg.bonusChance) {
        var r = m.rng(), idx = spawns[s];
        var k = r < 0.4 ? 1 : (r < 0.8 ? 2 : 3); // 1 = portee, 2 = bombe, 3 = vitesse
        m.bonus[idx] = k;
        m.events.push({ t: 'bonus', x: idx % W, y: Math.floor(idx / W), k: k });
      }
    }
  }

  /* Une vie perdue fait tomber un des bonus du joueur, pres de lui : le
   * premier qui passe le ramasse. */
  function dropBonus(m, pl) {
    var cfg = m.cfg, opts = [];
    if (pl.range > cfg.startRange) opts.push(1);
    if (pl.maxBombs > cfg.startBombs) opts.push(2);
    if (pl.speed > 0) opts.push(3);
    if (!opts.length) return;
    var k = opts[Math.floor(m.rng() * opts.length)];
    if (k === 1) pl.range--; else if (k === 2) pl.maxBombs--; else pl.speed--;
    var c = occupied(pl);
    var idx = nearestFree(m, c.x, c.y, function (i) {
      return !m.bonus[i] && m.map.kind[i] !== 2 && !bombAt(m, i % W, Math.floor(i / W));
    });
    if (idx < 0) return;
    m.bonus[idx] = k;
    m.events.push({ t: 'drop', s: pl.seat, k: k, x: idx % W, y: Math.floor(idx / W) });
  }

  function hitPlayer(m, pl, by) {
    pl.lives--;
    // Kill : une vie retiree a un AUTRE joueur (se toucher soi-meme ne compte pas)
    if (by >= 0 && by !== pl.seat && m.seats[by]) m.seats[by].kills++;
    m.events.push({ t: 'hit', s: pl.seat, by: by });
    // Les bonus sont conserves jusqu'a la fin de la manche (plus de perte a la mort).
    var pos = position(pl);
    pl.moving = false; pl.p = 0; pl.dx = 0; pl.dy = 0; pl.wantBomb = false;
    if (pl.lives <= 0) {
      pl.state = 'dead';
      pl.rx = pos.x; pl.ry = pos.y;
      m.events.push({ t: 'elim', s: pl.seat, by: by });
    } else {
      // Retour visible au QG : invincible et passe-muraille jusqu'a l'arrivee.
      pl.state = 'returning';
      pl.rx = pos.x; pl.ry = pos.y;
    }
  }

  function updatePlayer(m, pl, dt) {
    if (pl.invulnMs > 0) pl.invulnMs = Math.max(0, pl.invulnMs - dt);
    if (pl.state === 'dead') return;

    if (pl.state === 'returning') {
      var base = respawnCell(m, pl.seat);
      var dx = base.x - pl.rx, dy = base.y - pl.ry, dist = Math.sqrt(dx * dx + dy * dy);
      var stepLen = m.cfg.returnCellsPerSec * dt / 1000;
      if (dist <= stepLen) {
        pl.state = 'alive';
        pl.cx = base.x; pl.cy = base.y; pl.rx = base.x; pl.ry = base.y;
        pl.invulnMs = m.cfg.respawnInvulnMs;
        pl.ai.goal = -1;
        m.events.push({ t: 'back', s: pl.seat });
      } else {
        pl.rx += dx / dist * stepLen; pl.ry += dy / dist * stepLen;
      }
      return;
    }

    if (pl.tapMs > 0) { pl.tapMs -= dt; if (pl.tapMs <= 0) pl.tap = null; }
    var budget = dt / stepOf(m, pl);
    for (var guard = 0; budget > 1e-9 && guard < 4; guard++) {
      if (pl.moving) {
        var want = pl.input || pl.tap;
        // Demi-tour autorise en plein pas.
        if (want && DIRS[want].x === -pl.dx && DIRS[want].y === -pl.dy) {
          pl.cx += pl.dx; pl.cy += pl.dy; pl.dx = -pl.dx; pl.dy = -pl.dy;
          pl.p = 1 - pl.p; pl.facing = want; pl.tap = null;
        }
        var need = 1 - pl.p;
        if (budget < need) { pl.p += budget; budget = 0; }
        else {
          budget -= need;
          pl.cx += pl.dx; pl.cy += pl.dy; pl.p = 0; pl.moving = false;
        }
      } else {
        if (pl.bot) botThink(m, pl, dt);
        var d = pl.input || pl.tap;
        if (!d) break;
        pl.tap = null;
        pl.facing = d;
        var v = DIRS[d];
        if (!canEnter(m, pl.cx + v.x, pl.cy + v.y)) break;
        pl.dx = v.x; pl.dy = v.y; pl.p = 0; pl.moving = true;
      }
    }
  }

  function stepPlay(m, dt) {
    var cfg = m.cfg, i;
    m.timeMs = Math.max(0, m.timeMs - dt);
    stepPolice(m);

    for (i = 0; i < m.players.length; i++) {
      var pl = m.players[i];
      if (pl.wantBomb) { pl.wantBomb = false; tryPlaceBomb(m, pl); }
    }

    for (i = 0; i < N; i++) {
      if (m.flameMs[i] > 0) {
        m.flameMs[i] -= dt;
        if (m.flameMs[i] <= 0) { m.flameMs[i] = 0; m.flameOwner[i] = -1; m.flameMask[i] = 0; }
      }
    }

    for (i = 0; i < m.bombs.length; i++) m.bombs[i].fuse -= dt;
    resolveExplosions(m);

    for (i = 0; i < m.players.length; i++) updatePlayer(m, m.players[i], dt);

    for (i = 0; i < m.players.length; i++) {
      var p = m.players[i];
      if (p.state !== 'alive') continue;
      var c = occupied(p), ci = c.y * W + c.x;
      if (m.bonus[ci]) {
        if (m.bonus[ci] === 1) p.range = Math.min(cfg.maxRange, p.range + 1);
        else if (m.bonus[ci] === 2) p.maxBombs = Math.min(cfg.maxBombs, p.maxBombs + 1);
        else p.speed = Math.min(cfg.maxSpeed, p.speed + 1);
        m.events.push({ t: 'pick', s: p.seat, k: m.bonus[ci], x: c.x, y: c.y });
        m.bonus[ci] = 0;
      }
      if (m.flameMs[ci] > 0 && p.invulnMs <= 0) hitPlayer(m, p, m.flameOwner[ci]);
    }

    if (m.gridDirty) recountTerritory(m);
    checkRoundEnd(m);
  }

  /* ======================================================================
   * Descente de police : le perimetre se resserre par vagues. A chaque
   * vague, un anneau entier de la carte clignote 3 s, puis les barrages
   * tombent partout en meme temps (les 4 coins sont touches ensemble :
   * aucun QG n'est defavorise). Murs eternels ; quiconque est dessous est
   * elimine. La carte retrecit et la survie redevient une facon de gagner.
   * ====================================================================== */
  function stepPolice(m) {
    var cfg = m.cfg, pol = m.police, waves = cfg.policeWaves;
    while (pol.wave < waves.length && m.timeMs <= waves[pol.wave]) {
      pol.rings[pol.wave].forEach(function (i) { dropBarricade(m, i); });
      m.events.push({ t: 'police_drop', w: pol.wave });
      pol.wave++;
    }
    if (pol.wave < waves.length && pol.warned < pol.wave && m.timeMs <= waves[pol.wave] + cfg.policeWarnMs) {
      pol.warned = pol.wave;
      m.events.push({ t: 'police', w: pol.wave });
    }
  }

  function dropBarricade(m, i) {
    var map = m.map, x = i % W, y = Math.floor(i / W);
    map.kind[i] = 4; map.owner[i] = -1; map.bld[i] = -1;
    m.bonus[i] = 0;
    m.flameMs[i] = 0; m.flameOwner[i] = -1; m.flameMask[i] = 0;
    m.bombs = m.bombs.filter(function (b) { return !(b.x === x && b.y === y); });
    m.gridDirty = true;
    m.players.forEach(function (pl) {
      if (pl.state !== 'alive') return; // le retour au QG est intouchable
      // Un pas en cours vers cette case est annule (retour sur la case de depart).
      if (pl.moving && pl.cx + pl.dx === x && pl.cy + pl.dy === y && pl.p < 0.5) {
        pl.moving = false; pl.p = 0; pl.dx = 0; pl.dy = 0;
      }
      var c = occupied(pl);
      if (c.x !== x || c.y !== y) return;
      var pos = position(pl);
      pl.lives = 0; pl.state = 'dead'; pl.moving = false; pl.p = 0;
      pl.rx = pos.x; pl.ry = pos.y;
      m.events.push({ t: 'crush', s: pl.seat });
      m.events.push({ t: 'elim', s: pl.seat, by: -2 });
    });
  }

  function checkRoundEnd(m) {
    var alive = m.players.filter(function (p) { return p.state !== 'dead'; });
    if (alive.length <= 1) {
      endRound(m, alive.length ? alive[0].seat : -1, alive.length ? 'survie' : 'egalite');
      return;
    }
    if (m.timeMs <= 0) {
      var pool = m.cfg.aliveOnlyTerritoryWin ? alive : m.players;
      var best = -1, bestVal = -1, tie = false;
      pool.forEach(function (p) {
        var v = m.terr[p.seat];
        if (v > bestVal) { best = p.seat; bestVal = v; tie = false; }
        else if (v === bestVal) tie = true;
      });
      endRound(m, tie ? -1 : best, tie ? 'egalite' : 'territoire');
    }
  }

  /* Regle de la partie (choix de l'utilisateur) : les 4 manches se jouent
   * toujours ; a la fin de chaque manche, chaque gang ENCORE EN VIE ajoute a
   * son total les cases qu'il possede (un gang elimine ne marque rien pour
   * cette manche). Apres la derniere manche, le plus gros total gagne. Le
   * gagnant de manche (survie / territoire) reste affiche pour info. */
  function endRound(m, winner, reason) {
    m.phase = 'roundEnd';
    m.phaseMs = m.cfg.roundEndMs;
    m.roundWinner = winner;
    m.roundReason = reason;
    m.roundWinners.push(winner);
    m.roundScores = m.seats.map(function (st, i) {
      var alive = m.players[i] && m.players[i].state !== 'dead';
      return alive ? (m.terr[i] || 0) : 0;
    });
    m.seats.forEach(function (st, i) { st.totalTerr += m.roundScores[i]; });
    if (winner >= 0) m.seats[winner].wins++;
    if (m.round >= m.cfg.maxRounds) {
      // Plus gros total de cases ; a egalite, le plus de kills ; sinon egalite.
      var best = -1, bestT = -1, bestK = -1, tie = false;
      m.seats.forEach(function (st, i) {
        if (st.totalTerr > bestT || (st.totalTerr === bestT && st.kills > bestK)) {
          best = i; bestT = st.totalTerr; bestK = st.kills; tie = false;
        } else if (st.totalTerr === bestT && st.kills === bestK) tie = true;
      });
      m.matchWinner = tie ? -1 : best;
      m.matchOver = true;
    }
    m.events.push({ t: 'round_end', w: winner, reason: reason });
  }

  /* Avance la partie d'un pas fixe (TICK_MS). Les evenements s'accumulent
   * jusqu'au prochain snapshot(). */
  function step(m, dt) {
    dt = dt || TICK_MS;
    m.tick++;
    if (m.phase === 'intro') {
      m.phaseMs -= dt;
      if (m.phaseMs <= 0) { m.phase = 'play'; m.phaseMs = 0; m.events.push({ t: 'go' }); }
    } else if (m.phase === 'play') {
      stepPlay(m, dt);
    } else if (m.phase === 'roundEnd') {
      m.phaseMs -= dt;
      if (m.phaseMs <= 0) {
        if (m.matchOver) {
          m.phase = 'matchEnd'; m.phaseMs = m.cfg.matchEndMs;
          m.events.push({ t: 'match_end', w: m.matchWinner });
        } else {
          startRound(m);
        }
      }
    } else if (m.phase === 'matchEnd') {
      m.phaseMs -= dt;
      if (m.phaseMs <= 0) m.finished = true;
    }
  }

  /* ======================================================================
   * Entrees
   * ====================================================================== */

  function setInput(m, seat, dir) {
    if (dir && !DIRS[dir]) dir = null;
    var s = m.seats[seat];
    if (!s) return;
    s.input = dir || null;
    var pl = m.players[seat];
    if (pl && !pl.bot) {
      pl.input = s.input;
      if (dir) { pl.tap = dir; pl.tapMs = 250; } // appui bref : memorise jusqu'au prochain pas
    }
  }

  function pressBomb(m, seat) {
    var pl = m.players[seat];
    if (pl && !pl.bot && m.phase === 'play') pl.wantBomb = true;
  }

  /* Un joueur qui quitte en pleine partie est remplace par un CPU. */
  function setBot(m, seat, on) {
    var s = m.seats[seat];
    if (!s) return;
    s.bot = !!on;
    s.input = null;
    var pl = m.players[seat];
    if (pl) { pl.bot = !!on; pl.input = null; pl.wantBomb = false; pl.ai = newAi(); }
  }

  /* ======================================================================
   * IA des CPU
   *
   * Carte de danger (quand chaque case va bruler), puis parcours en
   * largeur qui evite les cases qui bruleront au moment du passage.
   * Priorites : fuir le danger > ramasser un bonus > poser une bombe
   * rentable (territoire a peindre, batiments, adversaires) mais
   * seulement si une sortie existe.
   * ====================================================================== */

  function blastCells(m, bx, by, range, bombs) {
    var cells = [by * W + bx], hits = [];
    for (var d = 0; d < 4; d++) {
      var v = DIRS[DIR_LIST[d]];
      for (var r = 1; r <= range; r++) {
        var x = bx + v.x * r, y = by + v.y * r;
        if (!inside(x, y)) break;
        var i = y * W + x;
        if (isEternal(m.map.kind[i])) break;
        if (m.map.kind[i] === 1) { cells.push(i); break; }
        var j = -1;
        for (var k = 0; k < bombs.length; k++) if (bombs[k].x === x && bombs[k].y === y) { j = k; break; }
        if (j >= 0) { hits.push(j); break; }
        cells.push(i);
        if (m.bonus[i]) break;
      }
    }
    return { cells: cells, hits: hits };
  }

  /* now[i] > 0 : flamme active (ms restantes) ; at[i] : ms avant explosion. */
  function computeDanger(m, extra) {
    var now = fill(N, 0), at = fill(N, Infinity), i;
    for (i = 0; i < N; i++) if (m.flameMs[i] > 0) now[i] = m.flameMs[i];
    var bombs = m.bombs.map(function (b) { return { x: b.x, y: b.y, t: Math.max(0, b.fuse), range: b.range }; });
    if (extra) bombs.push(extra);
    var blasts = bombs.map(function (b) { return blastCells(m, b.x, b.y, b.range, bombs); });
    for (var pass = 0; pass < bombs.length; pass++) { // reactions en chaine
      var changed = false;
      for (i = 0; i < bombs.length; i++) {
        blasts[i].hits.forEach(function (j) {
          if (bombs[j].t > bombs[i].t) { bombs[j].t = bombs[i].t; changed = true; }
        });
      }
      if (!changed) break;
    }
    for (i = 0; i < bombs.length; i++) {
      var t = bombs[i].t;
      blasts[i].cells.forEach(function (c) { if (t < at[c]) at[c] = t; });
    }
    // Barrages de police : a l'approche de la descente, chaque anneau
    // restant est connu avec son heure de chute. Une case de ces anneaux
    // n'est alors plus jamais "sure", on ne s'y refugie plus.
    var block = fill(N, Infinity), pol = m.police, waves = m.cfg.policeWaves;
    if (pol.wave < waves.length && m.timeMs <= waves[0] + m.cfg.policeWarnMs + 8000) {
      for (var w = pol.wave; w < waves.length; w++) {
        var wait = Math.max(0, m.timeMs - waves[w]);
        pol.rings[w].forEach(function (c) { block[c] = Math.min(block[c], wait); });
      }
    }
    return { now: now, at: at, block: block };
  }

  function unsafeAt(m, dg, i, T, margin) {
    if (T > dg.block[i] - margin) return true;
    if (dg.now[i] > 0 && T < dg.now[i] + margin) return true;
    if (dg.at[i] !== Infinity && T > dg.at[i] - margin && T < dg.at[i] + m.cfg.flameMs + margin) return true;
    return false;
  }

  function isSafeForever(dg, i) { return dg.now[i] <= 0 && dg.at[i] === Infinity && dg.block[i] === Infinity; }

  function bfs(m, sx, sy, dg, maxDepth, extraBlock, stepMs) {
    var dist = fill(N, -1), first = fill(N, null);
    var start = sy * W + sx, queue = [start], head = 0;
    dist[start] = 0;
    while (head < queue.length) {
      var c = queue[head++];
      if (dist[c] >= maxDepth) continue;
      var cx = c % W, cy = (c - cx) / W;
      for (var d = 0; d < 4; d++) {
        var name = DIR_LIST[d], v = DIRS[name], nx = cx + v.x, ny = cy + v.y;
        if (!inside(nx, ny)) continue;
        var ni = ny * W + nx;
        if (dist[ni] >= 0 || isWall(m.map.kind[ni]) || bombAt(m, nx, ny) || ni === extraBlock) continue;
        if (unsafeAt(m, dg, ni, (dist[c] + 1) * stepMs, stepMs)) continue;
        dist[ni] = dist[c] + 1;
        first[ni] = c === start ? name : first[c];
        queue.push(ni);
      }
    }
    return { dist: dist, first: first };
  }

  function hasEscape(m, pl) {
    if (Math.random() < m.cfg.botBlunder) return true; // erreur humaine volontaire
    var start = pl.cy * W + pl.cx;
    var dg = computeDanger(m, { x: pl.cx, y: pl.cy, t: m.cfg.fuseMs, range: pl.range });
    var r = bfs(m, pl.cx, pl.cy, dg, 12, start, stepOf(m, pl));
    for (var i = 0; i < N; i++) if (r.dist[i] > 0 && isSafeForever(dg, i)) return true;
    return false;
  }

  function bombValue(m, pl, bx, by, enemyAt, hunt) {
    var seat = pl.seat;
    var paintVal = function (i) {
      if (m.map.kind[i] === 2 || isEternal(m.map.kind[i])) return 0;
      var o = m.map.owner[i];
      return o === seat ? 0 : (o < 0 ? 1 : 1.5); // voler du territoire rapporte plus
    };
    var val = paintVal(by * W + bx);
    for (var d = 0; d < 4; d++) {
      var v = DIRS[DIR_LIST[d]];
      for (var r = 1; r <= pl.range; r++) {
        var x = bx + v.x * r, y = by + v.y * r;
        if (!inside(x, y)) break;
        var i = y * W + x;
        if (isEternal(m.map.kind[i])) break;
        if (m.map.kind[i] === 1) { val += 3; break; }
        if (bombAt(m, x, y)) break;
        if (m.bonus[i]) { val -= 3; break; }
        val += paintVal(i);
        if (enemyAt[i]) val += enemyAt[i] * 8 * (0.5 + hunt);
      }
    }
    return val;
  }

  /* Chaque CPU a son temperament : certains repeignent, d'autres chassent. */
  function newAi() { return { goal: -1, idleMs: 0, aggro: 0.6 + Math.random() * 0.8 }; }

  /* Cases libres autour d'un joueur : moins il en a, plus il est piegeable. */
  function freeAround(m, x, y) {
    var n = 0;
    for (var d = 0; d < 4; d++) {
      var v = DIRS[DIR_LIST[d]], nx = x + v.x, ny = y + v.y;
      if (inside(nx, ny) && !isWall(m.map.kind[ny * W + nx]) && !bombAt(m, nx, ny)) n++;
    }
    return n;
  }

  function botThink(m, pl, dt) {
    pl.input = null;
    if (m.phase !== 'play' || pl.state !== 'alive') return;
    var start = pl.cy * W + pl.cx;
    var dg = computeDanger(m, null);
    var r = bfs(m, pl.cx, pl.cy, dg, 30, -1, stepOf(m, pl));
    var i;

    // 1. Sur une case qui va bruler : fuir vers la case sure la plus proche.
    if (!isSafeForever(dg, start)) {
      var best = -1, bd = 1e9, fallback = -1, fbT = -1;
      for (i = 0; i < N; i++) {
        if (r.dist[i] <= 0) continue;
        if (isSafeForever(dg, i) && r.dist[i] < bd) { best = i; bd = r.dist[i]; }
        var tt = dg.at[i] === Infinity ? 1e9 : dg.at[i];
        if (tt > fbT) { fbT = tt; fallback = i; }
      }
      if (best < 0) best = fallback;
      if (best >= 0) pl.input = r.first[best];
      return;
    }

    // 2. Choix d'un objectif.
    var enemyAt = fill(N, 0), foes = [], leadSeat = -1, leadT = 0;
    m.players.forEach(function (o) {
      if (o.state === 'alive' && (m.terr[o.seat] || 0) > leadT) { leadT = m.terr[o.seat]; leadSeat = o.seat; }
    });
    m.players.forEach(function (o) {
      if (o.seat === pl.seat || o.state !== 'alive' || o.invulnMs > 0) return;
      var c = occupied(o), w = 1;
      if (o.seat === leadSeat) w += 0.6;          // celui qui a la couronne
      if (o.lives <= 2) w += 0.4;                 // presque elimine
      if (freeAround(m, c.x, c.y) <= 2) w += 0.5; // dans un cul-de-sac
      enemyAt[c.y * W + c.x] = Math.max(enemyAt[c.y * W + c.x], w);
      if (o.moving) {                             // la ou il va
        var tx = o.cx + o.dx, ty = o.cy + o.dy;
        if (inside(tx, ty)) enemyAt[ty * W + tx] = Math.max(enemyAt[ty * W + tx], w * 0.8);
      }
      foes.push({ x: c.x, y: c.y, w: w });
    });
    var hunt = m.cfg.botHunt * pl.ai.aggro;
    var canBomb = activeBombs(m, pl.seat) < pl.maxBombs;
    var policeSoon = m.timeMs <= m.cfg.policeWaves[0] + m.cfg.policeWarnMs + 5000;
    var bestI = -1, bestScore = -1e9, bestBomb = 0;
    for (i = 0; i < N; i++) {
      if (r.dist[i] < 0 || r.dist[i] > 14 || !isSafeForever(dg, i)) continue;
      var x = i % W, y = (i - x) / W;
      var sc = -r.dist[i];
      if (m.bonus[i]) sc += 25;
      var bv = (canBomb && !bombAt(m, x, y)) ? bombValue(m, pl, x, y, enemyAt, hunt) : 0;
      sc += bv;
      // Traque : se rapprocher des adversaires (surtout s'il reste des bombes)
      if (canBomb) for (var f = 0; f < foes.length; f++) {
        var md = Math.abs(foes[f].x - x) + Math.abs(foes[f].y - y);
        if (md < 6) sc += (6 - md) * 0.9 * foes[f].w * hunt;
      }
      if (i === pl.ai.goal) sc += 3; // un peu de constance
      if (policeSoon && m.police.ring[i]) sc -= 15; // la police arrive : vers le centre
      sc += Math.random() * 1.5;
      if (sc > bestScore) { bestScore = sc; bestI = i; bestBomb = bv; }
    }
    pl.ai.goal = bestI;

    if (bestI === start || bestI < 0) {
      if (canBomb && bestBomb >= 2 && hasEscape(m, pl)) { pl.wantBomb = true; pl.ai.idleMs = 0; return; }
      // Rien d'interessant ici : errer un peu plutot que rester plante.
      pl.ai.idleMs += dt;
      if (pl.ai.idleMs > 600) {
        var opts = [];
        for (i = 0; i < N; i++) if (r.dist[i] > 0 && r.dist[i] <= 6 && isSafeForever(dg, i)) opts.push(i);
        if (opts.length) { pl.ai.goal = opts[Math.floor(Math.random() * opts.length)]; pl.input = r.first[pl.ai.goal]; }
        pl.ai.idleMs = 0;
      }
      return;
    }
    pl.ai.idleMs = 0;
    pl.input = r.first[bestI];
  }

  /* ======================================================================
   * Etat envoye aux ecrans (serveur -> clients, ou local -> rendu)
   * ====================================================================== */

  function mapInfo(m) {
    return {
      type: m.map.type, label: m.map.label, w: W, h: H, total: m.map.total,
      bld: m.map.bld.slice(),
      bases: m.map.bases.map(function (b) {
        return { x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1, sx: b.sx, sy: b.sy, seat: b.seat };
      })
    };
  }

  function gridString(m) {
    var out = '';
    for (var i = 0; i < N; i++) {
      var k = m.map.kind[i];
      out += k === 1 ? '#' : k === 2 ? 'B' : k === 3 ? 'X' : k === 4 ? 'P' : (m.map.owner[i] < 0 ? '.' : String(m.map.owner[i]));
    }
    return out;
  }

  /* Snapshot compact (pas de null dans les tableaux : le relais Lua les
   * transformerait en trous). Vide les evenements accumules. */
  function snapshot(m) {
    var s = {
      ph: m.phase, pm: Math.max(0, Math.round(m.phaseMs)), tm: Math.round(m.timeMs),
      rd: m.round, rw: m.roundWinner, rr: m.roundReason, mw: m.matchWinner,
      ws: m.seats.map(function (x) { return x.wins; }),
      rh: m.roundWinners.slice(), // gagnant de chaque manche jouee (-1 = egalite)
      tot: m.seats.map(function (x) { return x.totalTerr; }), // cases cumulees (survivants)
      kl: m.seats.map(function (x) { return x.kills; }),      // kills (vies retirees aux autres)
      rs: (m.roundScores || [0, 0, 0, 0]).slice(),             // cases marquees a la derniere manche
      tr: m.terr.slice(), tt: m.map.total,
      pl: m.players.map(function (p) {
        var pos = position(p);
        return [Math.round(pos.x * 100), Math.round(pos.y * 100), STATE_CODE[p.state], p.lives,
          FACING_CODE[p.facing], p.invulnMs > 0 ? 1 : 0, p.maxBombs, p.range, p.bot ? 1 : 0, p.speed,
          Math.max(0, p.maxBombs - activeBombs(m, p.seat))]; // [10] bombes posables maintenant
      }),
      bm: m.bombs.map(function (b) { return [b.x, b.y, b.s, Math.max(0, Math.round(b.fuse))]; }),
      fl: [], bn: [], pw: [], ev: m.events
    };
    // Anneau annonce par la police (clignote a l'ecran jusqu'a sa chute)
    if (m.police.warned === m.police.wave && m.police.wave < m.police.rings.length) {
      s.pw = m.police.rings[m.police.wave].slice();
    }
    for (var i = 0; i < N; i++) {
      if (m.flameMs[i] > 0) s.fl.push([i % W, Math.floor(i / W), m.flameOwner[i], m.flameMask[i]]);
      if (m.bonus[i]) s.bn.push([i % W, Math.floor(i / W), m.bonus[i]]);
    }
    // Carte a chaque nouvelle manche + toutes les 2 s (un ecran qui arrive
    // en retard ou rate un envoi se recale tout seul).
    if (m.mapDirty || m.tick % 40 === 0) { s.mp = mapInfo(m); m.mapDirty = false; m.gridDirty = true; }
    // Grille complete a chaque changement (et avec chaque envoi de carte).
    if (m.gridDirty) { s.g = gridString(m); m.gridDirty = false; }
    m.events = [];
    return s;
  }

  function gangIndex(id) {
    for (var i = 0; i < GANGS.length; i++) if (GANGS[i].id === id) return i;
    return -1;
  }

  return {
    TICK_MS: TICK_MS, W: W, H: H, CFG: CFG, GANGS: GANGS, MAP_TYPES: MAP_TYPES,
    DIR_LIST: DIR_LIST,
    createMatch: createMatch, step: step, snapshot: snapshot,
    setInput: setInput, pressBomb: pressBomb, setBot: setBot,
    gangIndex: gangIndex,
    // exposes pour les tests
    _buildMap: buildMap, _makeRng: makeRng, _isConnected: isConnected,
    _ai: { computeDanger: computeDanger, bfs: bfs, stepOf: stepOf, isSafeForever: isSafeForever }
  };
});
