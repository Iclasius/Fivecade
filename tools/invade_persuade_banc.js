/* Banc d'essai d'equilibrage (TEMPORAIRE, a supprimer) : joueur-robot +
 * parties accelerees + statistiques. Charge a la main depuis la console. */
(function () {
  window.SIM = {};
  var P = MainScene.prototype;
  if (P.__banc) return;
  P.__banc = true;
  function wrapSrc(name, src) { var o = P[name]; P[name] = function () { SIM.src = typeof src === 'function' ? src.apply(this, arguments) : src; var r = o.apply(this, arguments); SIM.src = null; return r; }; }
  wrapSrc('onEnemyBulletHitsPlayer', function (pl, b) { return 'tir:' + (b.texture && b.texture.key || '?').replace('tex-bullet-', ''); });
  wrapSrc('onChargerTouchesPlayer', 'charge elan');
  wrapSrc('onEnemyTouchesPlayer', 'contact');
  wrapSrc('explodeBarrel', 'baril rouge');
  var oDmg = P.damagePlayer;
  P.damagePlayer = function (a) {
    var st = this.__st, b = [this.player.health, this.player.hp, this.tankHp, this.tankMode];
    var r = oDmg.call(this, a);
    if (st && (b[0] !== this.player.health || b[1] !== this.player.hp || b[2] !== this.tankHp)) {
      var k = (SIM.src || 'autre') + (b[3] ? ' (tank)' : ''); st.hits[k] = (st.hits[k] || 0) + 1;
    }
    return r;
  };
  var oKill = P.killPlayerByMissile;
  P.killPlayerByMissile = function () { var st = this.__st, hp = this.player.hp, go = this.gameOver; var r = oKill.apply(this, arguments); if (st && (this.player.hp !== hp || (!go && this.gameOver))) st.missileDeaths++; return r; };
  var oLaunch = P.launchMissileStrike;
  P.launchMissileStrike = function () { if (this.__st) this.__st.missiles++; return oLaunch.apply(this, arguments); };
  var oPick = P.onPickup;
  P.onPickup = function (pl, pk) {
    var st = this.__st;
    if (st) {
      st.pick[pk.kind] = (st.pick[pk.kind] || 0) + 1;
      if (pk.kind === 'oil-blue') st.healWaste += Math.max(0, this.player.health + OIL_BLUE_HEALTH - PLAYER_HEALTH_MAX);
      if (pk.kind === 'oil-green' && this.player.hp >= this.player.maxHp) st.lifeWaste++;
    }
    return oPick.apply(this, arguments);
  };
  var oDrop = P.spawnTankDrop;
  P.spawnTankDrop = function () { if (this.__st) this.__st.tankDrops++; return oDrop.apply(this, arguments); };
  var oEnter = P.enterTankMode;
  P.enterTankMode = function () { if (this.__st) { this.__st.tankRides++; this.__st.tankStart = this.time.now; } return oEnter.apply(this, arguments); };
  var oExit = P.exitTankMode;
  P.exitTankMode = function () { if (this.__st && this.__st.tankStart) { this.__st.tankTime += (this.time.now - this.__st.tankStart) / 1000; this.__st.tankStart = 0; } return oExit.apply(this, arguments); };
  ['Soldier', 'Heavy', 'Flyer', 'Charger'].forEach(function (t) {
    var o = P['damage' + t];
    P['damage' + t] = function (e) {
      var was = e && e.active, el = e && e.elite; var r = o.apply(this, arguments);
      if (this.__st && was && !e.active) { var k = t === 'Soldier' ? (el ? 'ours' : 'panda') : ({ Heavy: 'dromadaire', Flyer: 'drone', Charger: 'elan' })[t]; this.__st.kills[k] = (this.__st.kills[k] || 0) + 1; }
      return r;
    };
  });
  var oSpawnB = P.spawnBarrel;
  P.spawnBarrel = function () { if (this.__st) this.__st.redBarrels++; return oSpawnB.apply(this, arguments); };

  window.botStep = function (s) {
    var Pl = s.player, now = s.time.now, B = s.__bot, cam = s.cameras.main;
    s.cursors.left.isDown = false; s.cursors.right.isDown = false; s.cursors.down.isDown = false; s.cursors.up.isDown = false; s.jumpKey.isDown = false;
    s.fireKey.isDown = true;
    if (s.gameOver || s.boarding) return;
    var dodge = 0;
    s.missiles.forEach(function (m) {
      if (now - m.startAt > B.react && Math.abs(Pl.x - m.x) <= MISSILE_RADIUS + 45) {
        dodge = (Pl.x < m.x ? -1 : 1);
        if (dodge < 0 && m.x - MISSILE_RADIUS - 60 < cam.scrollX + 20) dodge = 1;
        if (dodge > 0 && m.x + MISSILE_RADIUS + 60 > cam.scrollX + GAME_WIDTH - 20) dodge = -1;
      }
    });
    var enemies = [].concat(s.soldiers.getChildren(), s.heavies.getChildren(), s.chargers.getChildren()).filter(function (e) { return e.active; });
    var ahead = enemies.filter(function (e) { return e.x > Pl.x - 40; }).sort(function (a, b) { return a.x - b.x; });
    var behind = enemies.filter(function (e) { return e.x < Pl.x - 40 && Pl.x - e.x < 350; });
    var dir = 1, aimUp = false;
    var tgt = ahead[0];
    if (dodge) dir = dodge;
    else if (tgt && tgt.x - Pl.x < B.standDist) {
      if (tgt.y < Pl.y - 60) { dir = 1; aimUp = true; } // perche : tir en diagonale en avancant
      else dir = 0;
    }
    if (!dodge && behind.length && (!tgt || tgt.x - Pl.x > 400) && (now % 2000 < 250)) dir = -1;
    if (!dodge && s.tankDrop && s.tankDrop.state === 'parked') { dir = (s.tankDrop.tank.x > Pl.x) ? 1 : -1; aimUp = false; }
    if (dir > 0) s.cursors.right.isDown = true; else if (dir < 0) s.cursors.left.isDown = true;
    var fl = s.flyers.getChildren().find(function (f) { return f.active && Math.abs(f.x - Pl.x) < 130; });
    if ((fl && !dodge && dir === 0) || aimUp) s.cursors.up.isDown = true;
    var ch = s.chargers.getChildren().find(function (c) { return c.active && c.state === 'charge' && Math.abs(c.x - Pl.x) < 190 && Math.sign(Pl.x - c.x) === c.chargeDir; });
    if (ch) { if (!ch.__jd) ch.__jd = Math.random() < B.jumpSkill ? 'yes' : 'no'; if (ch.__jd === 'yes') { s.jumpKey._justDown = true; s.jumpKey.isDown = true; } }
    var bl = s.enemyBullets.getChildren().find(function (b) { return b.active && Math.abs(b.x - Pl.x) < 150 && Math.sign(Pl.x - b.x) === Math.sign(b.body.velocity.x); });
    if (bl && !dodge && dir === 0) { if (B.crouchFor !== bl) { B.crouchFor = bl; B.crouchYes = Math.random() < B.crouchSkill; } if (B.crouchYes) s.cursors.down.isDown = true; }
    var close = enemies.filter(function (e) { return Math.abs(e.x - Pl.x) < 420; }).length;
    if (close >= 3 && s.grenadeCount > 0 && now > B.nextGren && !s.tankMode) { s.readyToThrow = true; s.throwGrenade(450); B.nextGren = now + 4000; }
  };

  window.runSim = async function (opts) {
    opts = opts || {};
    var g = __PHASER_GAME__;
    g.scene.getScenes(true).forEach(function (sc) { if (sc.scene.key !== 'MainScene') sc.scene.stop(); });
    g.scene.start('MainScene');
    await new Promise(function (r) { setTimeout(r, 800); });
    var s = g.scene.getScene('MainScene');
    s.__st = { hits: {}, kills: {}, pick: {}, missiles: 0, missileDeaths: 0, tankDrops: 0, tankRides: 0, tankTime: 0, tankStart: 0, healWaste: 0, lifeWaste: 0, redBarrels: 0, lifeLostAt: [], tankFrames: 0 };
    s.__bot = { react: opts.react || 900, standDist: opts.standDist || 260, jumpSkill: opts.jumpSkill == null ? 0.7 : opts.jumpSkill, crouchSkill: opts.crouchSkill == null ? 0.35 : opts.crouchSkill, nextGren: 0 };
    var orig = s.sys.sceneUpdate;
    s.sys.sceneUpdate = function (t, d) { botStep(s); return orig.call(s, t, d); };
    var realDateNow = Date.now, base = realDateNow(), fake = performance.now(), f0 = fake;
    Date.now = function () { return base + (fake - f0); };
    var oRender = g.scene.render; g.scene.render = function () { s.cameras.cameras.forEach(function (c) { c.preRender(); }); };
    g.loop.sleep();
    var lastHp = s.player.hp, maxSec = opts.maxSec || 600, steps = 0;
    try {
      while (!s.gameOver && s.elapsedSec < maxSec) {
        fake += 16.667; g.loop.delta = 16.667; g.loop.rawDelta = 16.667; g.step(fake, 16.667); steps++;
        if (s.tankMode) s.__st.tankFrames++;
        if (s.player.hp !== lastHp) { if (s.player.hp < lastHp) s.__st.lifeLostAt.push(s.elapsedSec); lastHp = s.player.hp; }
        if (steps % 600 === 0) await new Promise(function (r) { setTimeout(r, 0); });
      }
    } finally { Date.now = realDateNow; g.scene.render = oRender; g.loop.wake(); }
    var st = s.__st; st.tankTime = st.tankFrames / 60;
    return { sec: s.elapsedSec, dist: Math.round(s.player.x), score: s.score, mort: s.gameOver, viesFin: s.player.hp, hits: st.hits, kills: st.kills, pick: st.pick, missiles: st.missiles, mortsMissile: st.missileDeaths, tankDrops: st.tankDrops, tankRides: st.tankRides, tankSec: Math.round(st.tankTime), healGache: st.healWaste, vieGachee: st.lifeWaste, barilsRouges: st.redBarrels, viesPerduesA: st.lifeLostAt };
  };

  window.runMany = async function (n, opts) {
    var runs = [];
    for (var i = 0; i < n; i++) runs.push(await runSim(opts));
    function avg(f) { return Math.round(runs.reduce(function (a, r) { return a + f(r); }, 0) / runs.length * 10) / 10; }
    function sumObj(k) { var o = {}; runs.forEach(function (r) { Object.keys(r[k]).forEach(function (x) { o[x] = (o[x] || 0) + r[k][x]; }); }); Object.keys(o).forEach(function (x) { o[x] = Math.round(o[x] / runs.length * 10) / 10; }); return o; }
    return {
      parties: n, survieSec: runs.map(function (r) { return r.sec; }), survieMoy: avg(function (r) { return r.sec; }), distMoy: avg(function (r) { return r.dist; }), scoreMoy: avg(function (r) { return r.score; }),
      degatsParPartie: sumObj('hits'), killsParPartie: sumObj('kills'), bonusParPartie: sumObj('pick'),
      missiles: avg(function (r) { return r.missiles; }), mortsMissile: avg(function (r) { return r.mortsMissile; }),
      tankDrops: avg(function (r) { return r.tankDrops; }), tankRides: avg(function (r) { return r.tankRides; }), tankSec: avg(function (r) { return r.tankSec; }),
      santeGachee: avg(function (r) { return r.healGache; }), viesGachees: avg(function (r) { return r.vieGachee; }),
      premiereVieperdue: avg(function (r) { return r.viesPerduesA[0] || r.sec; })
    };
  };
  if (window.FiveCadeSound) FiveCadeSound.setMuted(true);
})();
