/* ==========================================================================
 * Street Wars, Gang Wars Edition - NUI (Phaser)
 *
 * SQUELETTE : toute la logique et tous les ecrans fonctionnent, mais le
 * rendu n'utilise que des formes et du texte provisoires. Les sprites, les
 * sons et l'habillage des pages viendront par-dessus sans toucher a la
 * logique (tout le jeu est dans sim.js, ici on ne fait qu'afficher).
 *
 * Pages : Menu -> Salons en ligne -> Selection du gang -> Partie
 *                 \-> Contre le CPU -> Selection du gang -> Partie
 * En ligne, l'ecran de jeu affiche les snapshots du serveur ; contre le
 * CPU, il fait tourner sim.js localement et affiche SES snapshots : un
 * seul chemin de rendu pour les deux modes.
 * ========================================================================== */
(function () {
  'use strict';

  var Sim = window.StreetWarsSim;
  var GANGS = Sim.GANGS;
  var GAME_W = 1280, GAME_H = 704, HUD_H = 64; // format de l'ecran de la borne (≈ 1,8:1)
  var CELL = Math.floor(Math.min((GAME_W - 32) / Sim.W, (GAME_H - HUD_H - 12) / Sim.H));
  var OX = Math.floor((GAME_W - CELL * Sim.W) / 2);
  var OY = HUD_H + Math.floor((GAME_H - HUD_H - CELL * Sim.H) / 2);
  var INTERP_MS = 70; // retard d'affichage pour interpoler entre deux snapshots
  var FONT = '"Courier New", monospace';

  var COLORS = {
    road: 0x4b4e55, roadLine: 0x3f4248, baseFloor: 0x25252c,
    asphalt: 0x656d7b, asphaltDark: 0x59606c, asphaltLight: 0x717987, laneMark: 0xe9e6dc,
    rubble: 0x4d4944, rubbleLight: 0x7a746c, rubbleDark: 0x2f2c29,
    buildings: [0x3b4252, 0x46394a, 0x2f4848, 0x4a4436, 0x3a3a46],
    roofLight: 0x9aa3b6, roofDark: 0x16181d,
    armored: 0x1d2027, armoredEdge: 0xc9d1dc, armoredStripe: 0x2c313b,
    police: 0xe8e8ee, policeRed: 0xd62828, policeBlue: 0x1f4fd6,
    hudBg: 0x0b0b12, lifeOff: 0x2c2c34
  };

  /* Nom de gang affiche en bas de chaque portrait (les gangs n'ont pas de
   * nom propre : couleur + symbole suffisent). En haut du portrait : le nom
   * tape par le joueur, "CPU" pour un CPU, rien sinon. */
  var CHARACTERS = {
    green:  { crew: 'GANG VERT' },
    purple: { crew: 'GANG VIOLET' },
    yellow: { crew: 'GANG JAUNE' },
    blue:   { crew: 'GANG BLEU' }
  };
  function seatLabel(seat) { return !seat ? '' : seat.bot ? 'CPU' : (seat.nick || ''); }

  /* portraits.webp = les 4 portraits cote a cote (720 px de haut) :
   * [x, largeur] de chacun, meme ordre que Sim.GANGS. */
  var PORTRAIT_FRAMES = [[0, 298], [298, 290], [588, 290], [878, 297]];
  var PORTRAIT_H = 720;

  /* HUD : hud.webp regroupe les pieces fournies (plaques nettoyees de leur
   * barre et de leur chiffre, barres de vie, fond du chrono, point). */
  var HUD_FRAMES = {"plate_green": [0, 0, 499, 121], "plate_purple": [501, 0, 495, 120], "plate_yellow": [0, 123, 494, 120], "plate_blue": [496, 123, 490, 121], "bar_green": [0, 246, 228, 51], "bar_purple": [230, 246, 238, 51], "bar_yellow": [470, 246, 234, 53], "bar_blue": [706, 246, 237, 52], "timer": [0, 301, 361, 119], "dot": [363, 301, 50, 60]};
  var HUD_PLATES = {"green": {"w": 499, "h": 121, "bar0": 141, "dig": [412, 436]}, "purple": {"w": 495, "h": 120, "bar0": 138, "dig": [401, 427]}, "yellow": {"w": 494, "h": 120, "bar0": 139, "dig": [404, 428]}, "blue": {"w": 490, "h": 121, "bar0": 133, "dig": [396, 423]}};          // position de la barre et du chiffre dans chaque plaque
  var HUD_SEG_ENDS = {"green": [27, 49, 70, 91, 112, 133, 154, 175, 196, 218], "purple": [28, 50, 72, 95, 117, 139, 161, 183, 205, 227], "yellow": [27, 49, 72, 94, 117, 139, 162, 184, 207, 230], "blue": [31, 54, 76, 98, 121, 143, 165, 188, 209, 231]};        // fin (px) de chacun des 10 segments de chaque barre
  var HUD_SCALE = 0.47;         // les pieces sont dessinees pour du 1920x1080

  /* Ville : city.webp = les tuiles de batiments fournies (une image = un
   * pate de maisons entier, trottoir compris), rognees de leurs bandes
   * de decoupe. Les routes sont dessinees en code (couleurs prises sur les
   * tuiles de route fournies). */
  var CITY_FRAMES = {"batiment_L_gris_01": [0, 0, 190, 153], "batiment_L_gris_02": [192, 0, 190, 156], "batiment_L_gris_03": [384, 0, 190, 170], "batiment_bloc_brun_01": [576, 0, 190, 153], "batiment_bureaux_gris_01": [768, 0, 187, 156], "batiment_bureaux_gris_02": [0, 172, 190, 156], "batiment_centre_rouge_01": [192, 172, 190, 153], "batiment_complexe_blanc_rose_01": [384, 172, 185, 153], "batiment_complexe_blanc_rose_02": [571, 172, 190, 170], "batiment_complexe_vert_bleu_01": [763, 172, 185, 170], "batiment_cour_bleu_01": [0, 344, 190, 152], "batiment_cour_bleu_02": [192, 344, 190, 156], "batiment_parking_gris_01": [384, 344, 178, 170], "batiment_tech_blanc_01": [564, 344, 185, 156], "batiment_toit_noir_blanc_01": [751, 344, 190, 152], "batiment_toit_noir_blanc_02": [0, 516, 190, 170], "parking_entree_01": [192, 516, 159, 159], "place_arbres_01": [353, 516, 157, 140], "quartier_residentiel_01": [512, 516, 190, 156], "quartier_residentiel_02": [704, 516, 190, 170]};
  var CITY_POOLS = {             // ambiance de chaque type de carte
    downtown:   ['batiment_bureaux_gris_01', 'batiment_bureaux_gris_02', 'batiment_centre_rouge_01', 'batiment_tech_blanc_01',
                 'batiment_L_gris_01', 'batiment_L_gris_02', 'batiment_complexe_vert_bleu_01', 'batiment_complexe_blanc_rose_01'],
    suburbs:    ['quartier_residentiel_01', 'quartier_residentiel_02', 'batiment_bloc_brun_01', 'batiment_cour_bleu_01'],
    industrial: ['batiment_parking_gris_01', 'batiment_L_gris_03', 'batiment_bureaux_gris_01', 'batiment_tech_blanc_01', 'batiment_L_gris_02'],
    projects:   ['batiment_cour_bleu_01', 'batiment_cour_bleu_02', 'batiment_bloc_brun_01', 'batiment_complexe_blanc_rose_02', 'batiment_centre_rouge_01']
  };
  var CITY_ARMORED = ['batiment_toit_noir_blanc_01', 'batiment_toit_noir_blanc_02'];
  var CITY_BASE = 'place_arbres_01';

  /* Objets (generes sous PixelLab, props.png) : barrages, bombe, bonus,
   * gravats, brulure, feu. Pixel art ~22 px agrandi sans lissage. */
  var PROP_FRAMES = {"barricade": [0, 0, 20, 20], "barricade_cones": [21, 0, 23, 22], "bomb": [45, 0, 18, 23], "bonus_range": [64, 0, 22, 22], "bonus_bomb": [87, 0, 22, 22], "bonus_speed": [110, 0, 21, 22], "rubble_0": [132, 0, 23, 21], "rubble_1": [156, 0, 22, 20], "rubble_2": [179, 0, 21, 17], "rubble_3": [201, 0, 21, 19], "rubble_4": [223, 0, 22, 21], "rubble_5": [0, 24, 22, 19], "rubble_6": [23, 24, 20, 19], "scorch": [44, 24, 13, 13], "fire_0": [58, 24, 22, 20], "fire_1": [81, 24, 20, 20]};
  var RUBBLE = ['rubble_0', 'rubble_1', 'rubble_2', 'rubble_3', 'rubble_4', 'rubble_5', 'rubble_6'];
  var BONUS_FRAME = { 1: 'bonus_range', 2: 'bonus_bomb', 3: 'bonus_speed' };

  /* Reserve de sprites reutilises a chaque image (evite de creer/detruire
   * des objets en continu) : begin() puis get() autant que besoin, end()
   * cache ceux qui n'ont pas servi. */
  function SpritePool(scene, texture, depth) {
    this.scene = scene; this.texture = texture; this.depth = depth;
    this.items = []; this.used = 0;
  }
  SpritePool.prototype.begin = function () { this.used = 0; };
  SpritePool.prototype.get = function (frame) {
    var sp = this.items[this.used];
    if (!sp) {
      sp = this.scene.add.image(0, 0, this.texture, frame).setDepth(this.depth);
      this.items.push(sp);
    }
    this.used++;
    return sp.setFrame(frame).setVisible(true).setAlpha(1).setAngle(0).clearTint();
  };
  SpritePool.prototype.end = function () {
    for (var i = this.used; i < this.items.length; i++) this.items[i].setVisible(false);
  };

  var CODE_DIR = {
    ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
    ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right'
  };

  function arr(x) { return Array.isArray(x) ? x : []; }
  function sfx(name) { if (window.SWSound) window.SWSound.sfx(name); }
  function music(name) { if (window.SWSound) { if (name) window.SWSound.music(name); else window.SWSound.stopMusic(); } }
  function hex(c) { return '#' + ('000000' + c.toString(16)).slice(-6); }
  function gangOf(id) { return GANGS[Sim.gangIndex(id)] || null; }
  function isUp(ev) { return ev.code === 'ArrowUp' || ev.code === 'KeyW'; }
  function isDown(ev) { return ev.code === 'ArrowDown' || ev.code === 'KeyS'; }
  function isOk(ev) { return ev.code === 'Enter' || ev.code === 'NumpadEnter' || ev.code === 'Space'; }
  function fmtTime(ms) {
    var s = Math.ceil(Math.max(0, ms) / 1000);
    return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);
  }

  function txt(scene, x, y, s, size, color) {
    // Style commun des textes : lettres epaisses facon borne, contour noir
    return scene.add.text(x, y, s, {
      fontFamily: '"Arial Black", Impact, sans-serif', fontSize: size + 'px', color: color || '#ffffff',
      align: 'center', stroke: '#000000', strokeThickness: Math.max(3, Math.round(size / 7))
    }).setOrigin(0.5, 0.5);
  }

  /* ----------------------------------------------------------------------
   * Session + routage des messages serveur vers la page affichee
   * ---------------------------------------------------------------------- */
  var Session = { playerName: '???', room: null, borneColor: 'green' };

  var Net = {
    handler: null,
    owner: null,
    earlySnaps: [], // snapshots recus pendant le passage a l'ecran de jeu
    send: function (t, d) { window.FiveCadeBridge.send(t, d); },
    listen: function (scene, fn) {
      Net.owner = scene;
      Net.handler = fn.bind(scene);
      scene.events.once('shutdown', function () {
        if (Net.owner === scene) { Net.owner = null; Net.handler = null; }
      });
    },
    dispatch: function (t, d) {
      if (t === 'room') Session.room = d; // toujours a jour, meme hors page salon
      if (t === 'snap' && !(Net.owner && Net.owner.scene.key === 'GameScene')) {
        Net.earlySnaps.push(d);
        if (Net.earlySnaps.length > 40) Net.earlySnaps.shift();
        return;
      }
      if (Net.handler) Net.handler(t, d);
    }
  };

  /* ----------------------------------------------------------------------
   * Habillage commun des pages : ville de nuit qui defile lentement,
   * degrade, lignes d'ecran cathodique, vignettage.
   * ---------------------------------------------------------------------- */
  function drawBackdrop(scene, dim) {
    scene.cameras.main.setBackgroundColor('#05040b');
    if (dim === undefined) dim = 0.62; // pages secondaires : fond assombri
    // Illustration de la rue (home_bg.webp), tres lent zoom avant/arriere
    var bg = scene.add.image(GAME_W / 2, GAME_H / 2, 'homebg').setDepth(-11);
    bg.setScale(Math.max(GAME_W / bg.width, GAME_H / bg.height));
    var base = bg.scale;
    scene.tweens.add({ targets: bg, scale: base * 1.06, duration: 22000, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    var shade = scene.add.graphics().setDepth(-10);
    shade.fillStyle(0x05040b, dim).fillRect(0, 0, GAME_W, GAME_H);
    shade.fillGradientStyle(0x05040b, 0x05040b, 0x05040b, 0x05040b, 0, 0, 0.55, 0.55).fillRect(0, GAME_H * 0.55, GAME_W, GAME_H * 0.45);
    var fx = scene.add.graphics().setDepth(50);
    fx.fillStyle(0x000000, 0.13);
    for (var y = 0; y < GAME_H; y += 3) fx.fillRect(0, y, GAME_W, 1);
    for (var k = 0; k < 60; k++) { // vignettage
      fx.lineStyle(2, 0x000000, 0.02 + k * 0.006).strokeRect(k * 2, k * 2, GAME_W - k * 4, GAME_H - k * 4);
    }
    scene.cameras.main.fadeIn(250, 0, 0, 0);
  }

  /* Logo facon borne : STREET WARS dore, GANG WARS rouge, EDITION blanc. */
  function drawLogo(scene, cx, cy, scale) {
    scale = scale || 1;
    var t1 = goldText(scene, cx, cy, 'STREET WARS', Math.round(78 * scale)).setDepth(5);
    var t2 = scene.add.text(cx + 8 * scale, cy + 58 * scale, 'GANG WARS', {
      fontFamily: 'Impact, "Arial Black", sans-serif', fontSize: Math.round(56 * scale) + 'px', fontStyle: 'italic',
      color: '#ff2a3a', stroke: '#ffffff', strokeThickness: Math.max(3, Math.round(5 * scale))
    }).setOrigin(0.5, 0.5).setAngle(-4).setDepth(6);
    t2.setShadow(4, 5, '#000000', 0, true, true);
    var t3 = scene.add.text(cx, cy + 104 * scale, 'E D I T I O N', {
      fontFamily: '"Arial Black", Impact, sans-serif', fontSize: Math.round(20 * scale) + 'px',
      color: '#ffffff', stroke: '#000000', strokeThickness: 5
    }).setOrigin(0.5, 0.5).setDepth(6);
    scene.tweens.add({ targets: t2, scale: { from: 1, to: 1.04 }, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    return [t1, t2, t3];
  }

  /* Menu vertical en boutons neon (HAUT/BAS + ENTREE). */
  function makeMenu(scene, labels, y0, spacing, onPick, width) {
    width = width || 440;
    var menu = { index: 0, texts: [], disabled: [], g: scene.add.graphics().setDepth(7) };
    menu.set = function (newLabels, disabled) {
      menu.texts.forEach(function (t) { t.destroy(); });
      menu.texts = newLabels.map(function (l, i) {
        return scene.add.text(GAME_W / 2, y0 + i * spacing, l, {
          fontFamily: '"Arial Black", Impact, sans-serif', fontSize: '22px', color: '#ffffff',
          stroke: '#000000', strokeThickness: 4
        }).setOrigin(0.5, 0.5).setDepth(8);
      });
      menu.disabled = disabled || [];
      if (menu.index >= menu.texts.length) menu.index = Math.max(0, menu.texts.length - 1);
      menu.refresh();
    };
    menu.refresh = function () {
      var g = menu.g, h = Math.min(48, spacing - 8);
      g.clear();
      menu.texts.forEach(function (t, i) {
        var sel = i === menu.index, off = menu.disabled[i], x = GAME_W / 2 - width / 2, y = t.y - h / 2;
        g.fillStyle(sel ? 0x2a0b33 : 0x0c0a16, sel ? 0.92 : 0.78).fillRoundedRect(x, y, width, h, 10);
        g.lineStyle(sel ? 3 : 1, sel ? 0xff3fb4 : 0x3a3a5a, 1).strokeRoundedRect(x, y, width, h, 10);
        if (sel) {
          g.lineStyle(8, 0xff3fb4, 0.18).strokeRoundedRect(x - 3, y - 3, width + 6, h + 6, 12);
          g.fillStyle(0xffd23f, 1).fillTriangle(x + 18, t.y - 9, x + 18, t.y + 9, x + 32, t.y);
        }
        t.setColor(off ? '#5a5a70' : (sel ? '#ffd23f' : '#e8e4f4'));
      });
    };
    menu.key = function (ev) {
      var n = menu.texts.length;
      if (!n) return;
      if (isUp(ev)) { menu.index = (menu.index + n - 1) % n; menu.refresh(); sfx('move'); }
      else if (isDown(ev)) { menu.index = (menu.index + 1) % n; menu.refresh(); sfx('move'); }
      else if (isOk(ev) && !ev.repeat && !menu.disabled[menu.index]) { sfx('select'); onPick(menu.index); }
    };
    menu.set(labels);
    return menu;
  }

  /* Bandeau de titre des pages secondaires (petit logo + titre de page). */
  function drawTitle(scene, subtitle) {
    drawLogo(scene, GAME_W / 2, 58, 0.55);
    if (subtitle) {
      var t = scene.add.text(GAME_W / 2, 158, subtitle, {
        fontFamily: '"Arial Black", Impact, sans-serif', fontSize: '26px', color: '#3ad6ff',
        stroke: '#000000', strokeThickness: 5
      }).setOrigin(0.5, 0.5).setDepth(6);
      t.setShadow(0, 0, '#3ad6ff', 12, true, true);
    }
  }

  /* Ligne d'aide en bas de page. */
  function drawHelp(scene, text) {
    var g = scene.add.graphics().setDepth(7);
    g.fillStyle(0x000000, 0.55).fillRect(0, GAME_H - 34, GAME_W, 34);
    return scene.add.text(GAME_W / 2, GAME_H - 17, text, {
      fontFamily: '"Arial Black", Impact, sans-serif', fontSize: '13px', color: '#a9a6c4'
    }).setOrigin(0.5, 0.5).setDepth(8);
  }

  /* ======================================================================
   * Page vide (avant ouverture de la borne)
   * ====================================================================== */
  class IdleScene extends Phaser.Scene {
    constructor() { super('IdleScene'); }
    preload() {
      this.load.image('portraits', 'portraits.webp');
      this.load.image('hud', 'hud.webp');
      this.load.image('city', 'city.webp');
      this.load.image('homebg', 'home_bg.webp'); // illustration de la rue (fond des pages)
      this.load.image('props', 'props.png');
      // Personnages (PixelLab) : cases 68x68, voir tools/street_wars_chars.py
      GANGS.forEach(function (g) {
        this.load.spritesheet('chars_' + g.id, 'chars_' + g.id + '.png', { frameWidth: 68, frameHeight: 68 });
      }, this);
    }
    create() {
      var tex = this.textures.get('portraits');
      PORTRAIT_FRAMES.forEach(function (f, i) { tex.add('p' + i, 0, f[0], 0, f[1], PORTRAIT_H); });
      var props = this.textures.get('props');
      Object.keys(PROP_FRAMES).forEach(function (k) { var f = PROP_FRAMES[k]; props.add(k, 0, f[0], f[1], f[2], f[3]); });
      props.setFilter(Phaser.Textures.FilterMode.NEAREST); // pixel art net
      var city = this.textures.get('city');
      Object.keys(CITY_FRAMES).forEach(function (k) { var f = CITY_FRAMES[k]; city.add(k, 0, f[0], f[1], f[2], f[3]); });
      var hud = this.textures.get('hud');
      Object.keys(HUD_FRAMES).forEach(function (k) { var f = HUD_FRAMES[k]; hud.add(k, 0, f[0], f[1], f[2], f[3]); });
      // Images pretes : on lance ce qui attendait (ouverture de la borne tres tot).
      assetsReady = true;
      var todo = pendingStart; pendingStart = null;
      if (todo) todo();
    }
  }

  /* Texte "lettres d'or" facon borne 80s (degrade + contour + ombre). */
  function goldText(scene, x, y, str, size) {
    var t = scene.add.text(x, y, str, {
      fontFamily: '"Arial Black", Impact, sans-serif', fontSize: size + 'px',
      stroke: '#3a1600', strokeThickness: Math.round(size / 4.5), align: 'center'
    }).setOrigin(0.5, 0.5);
    t.setShadow(3, 4, '#000000', 0, true, true);
    var grad = t.context.createLinearGradient(0, 0, 0, t.height);
    grad.addColorStop(0.15, '#fff6a8');
    grad.addColorStop(0.5, '#ffc21a');
    grad.addColorStop(0.85, '#d86a00');
    t.setFill(grad);
    return t;
  }

  /* ======================================================================
   * Menu principal
   * ====================================================================== */
  class MenuScene extends Phaser.Scene {
    constructor() { super('MenuScene'); }
    create() {
      var self = this;
      Session.room = null;
      drawBackdrop(this, 0.18);
      music('menu');
      drawLogo(this, GAME_W / 2, 230, 1.15);
      this.menu = makeMenu(this, ['JOUER EN LIGNE', 'CONTRE LE CPU', 'QUITTER'], 470, 62, function (i) {
        if (i === 0) self.scene.start('OnlineScene');
        else if (i === 1) self.scene.start('RoomScene', { mode: 'solo' });
        else window.FiveCadeBridge.quit();
      });
      drawHelp(this, 'HAUT / BAS  choisir      ENTR\u00c9E  valider      M  couper le son      \u00c9CHAP  quitter la borne');
    }
    onKeyDown(ev) { this.menu.key(ev); }
    onEscape() { return false; } // Echap depuis le menu = quitter la borne
  }

  /* ======================================================================
   * Liste des salons en ligne
   * ====================================================================== */
  class OnlineScene extends Phaser.Scene {
    constructor() { super('OnlineScene'); }
    create() {
      var self = this;
      this.rooms = [];
      drawBackdrop(this);
      music('menu');
      drawTitle(this, 'SALONS EN LIGNE');
      this.panel = this.add.graphics().setDepth(4);
      this.panel.fillStyle(0x07060f, 0.82).fillRoundedRect(GAME_W / 2 - 330, 196, 660, 420, 14);
      this.panel.lineStyle(2, 0x3ad6ff, 0.5).strokeRoundedRect(GAME_W / 2 - 330, 196, 660, 420, 14);
      this.dots = this.add.graphics().setDepth(9);
      this.status = this.add.text(GAME_W / 2, 590, 'Connexion au serveur...', {
        fontFamily: '"Arial Black", Impact, sans-serif', fontSize: '15px', color: '#9be7ff'
      }).setOrigin(0.5, 0.5).setDepth(8);
      this.menu = makeMenu(this, ['+  CR\u00c9ER UN SALON'], 238, 54, function (i) {
        if (i === 0) Net.send('create');
        else Net.send('join', { id: self.rooms[i - 1].id });
      }, 600);
      drawHelp(this, 'HAUT / BAS  choisir      ENTR\u00c9E  cr\u00e9er ou rejoindre      \u00c9CHAP  retour');
      Net.listen(this, this.onNet);
      if (!window.FiveCadeBridge.isFiveM()) {
        this.status.setText('Hors FiveM : mode en ligne indisponible').setColor('#ff9a9a');
      }
      Net.send('hello');
      this.time.addEvent({ delay: 4000, loop: true, callback: function () { Net.send('list'); } }); // liste a jour
    }
    onNet(t, d) {
      var self = this;
      if (t === 'rooms') {
        this.rooms = arr(d.list).slice(0, 6);
        var labels = ['+  CR\u00c9ER UN SALON'], disabled = [false];
        this.rooms.forEach(function (r) {
          var busy = r.state === 'playing', full = r.n >= 4;
          labels.push('SALON N\u00b0' + r.id + (busy ? '   \u2022 EN PARTIE' : full ? '   \u2022 COMPLET' : ''));
          disabled.push(busy || full);
        });
        this.menu.set(labels, disabled);
        // 4 pastilles : places occupees
        this.dots.clear();
        this.rooms.forEach(function (r, i) {
          var y = 238 + (i + 1) * 54;
          for (var k = 0; k < 4; k++) {
            self.dots.fillStyle(k < r.n ? GANGS[k].color : 0x2a2a3a, 1).fillCircle(GAME_W / 2 + 230 + k * 16, y, 5);
          }
        });
        this.status.setText(this.rooms.length ? '' : 'Aucun salon ouvert : cr\u00e9e le tien !').setColor('#9be7ff');
      } else if (t === 'room') {
        this.scene.start('RoomScene', { mode: 'online' });
      } else if (t === 'err') {
        this.status.setText(d.msg || 'Erreur').setColor('#ff9a9a');
        Net.send('list');
      }
    }
    onKeyDown(ev) { this.menu.key(ev); }
    onEscape() { this.scene.start('MenuScene'); return true; }
  }

  /* ======================================================================
   * Selection du gang (salon en ligne OU partie contre le CPU)
   * Un gang = un seul joueur. La partie part apres un decompte, une fois
   * les 4 gangs verrouilles.
   * ====================================================================== */
  class RoomScene extends Phaser.Scene {
    constructor() { super('RoomScene'); }
    init(data) { this.mode = data.mode; }
    create() {
      var self = this;
      this.cursor = Math.max(0, Sim.gangIndex(Session.borneColor)); // gang de la borne

      if (this.mode === 'solo') {
        this.local = {
          isHost: true, state: 'lobby', cd: 0,
          seats: [{ name: '', gang: '', locked: false, bot: false, me: true }]
        };
      }
      drawBackdrop(this);
      music('menu');
      var head = this.add.text(GAME_W / 2, 32, this.mode === 'solo' ? 'CONTRE LE CPU  \u2022  CHOISIS TON GANG' : 'CHOISIS TON GANG', {
        fontFamily: '"Arial Black", Impact, sans-serif', fontSize: '24px', color: '#3ad6ff', stroke: '#000000', strokeThickness: 5
      }).setOrigin(0.5, 0.5).setDepth(6);
      head.setShadow(0, 0, '#3ad6ff', 12, true, true);

      // 4 portraits cote a cote, prenom en haut, nom du gang en bas.
      var top = 62, height = 470, scale = height / PORTRAIT_H, gap = 12;
      var widths = PORTRAIT_FRAMES.map(function (f) { return Math.round(f[1] * scale); });
      var x = Math.round((GAME_W - widths.reduce(function (a, b) { return a + b; }, 0) - gap * 3) / 2);
      this.panelTop = top; this.panelH = height;
      this.cards = GANGS.map(function (g, i) {
        var w = widths[i], card = { x: x, w: w, cx: x + w / 2 };
        card.img = self.add.image(x, top, 'portraits', 'p' + i).setOrigin(0, 0).setScale(scale);
        card.shade = self.add.rectangle(x, top, w, height, 0x000000, 0).setOrigin(0, 0);
        card.hero = self.add.text(card.cx, top + 26, '', {
          fontFamily: '"Arial Black", Impact, sans-serif', fontSize: '20px', color: '#ffffff',
          stroke: '#000000', strokeThickness: 5
        }).setOrigin(0.5, 0.5);
        card.crew = goldText(self, card.cx, top + height - 42, CHARACTERS[g.id].crew, 24);
        card.stamp = txt(self, card.cx, top + height / 2, '', 22, '#ffffff').setStroke('#000000', 5);
        x += w + gap;
        return card;
      });
      // Lignes de balayage (effet ecran cathodique) par-dessus les portraits
      var scan = this.add.graphics();
      scan.fillStyle(0x000000, 0.14);
      for (var y = top; y < top + height; y += 3) scan.fillRect(this.cards[0].x, y, x - gap - this.cards[0].x, 1);
      this.g = this.add.graphics(); // cadres de selection, au-dessus de tout

      this.playersText = txt(this, GAME_W / 2, 560, '', 15, '#d8d8e8');
      this.stateText = txt(this, GAME_W / 2, 596, '', 26, '#ffd23f');
      this.msgText = txt(this, GAME_W / 2, 630, '', 15, '#ff9a9a');
      this.helpText = txt(this, GAME_W / 2, 668, '', 13, '#8888aa');
      this.hostText = txt(this, GAME_W / 2, 694, '', 13, '#8888aa');
      if (this.mode === 'online') Net.listen(this, this.onNet);
      this.render();
    }

    view() { return this.mode === 'online' ? (Session.room || { seats: [], state: 'lobby', cd: 0 }) : this.local; }
    mySeat(v) { return arr(v.seats).filter(function (s) { return s.me; })[0] || null; }
    takenBy(v, gangId) {
      return arr(v.seats).filter(function (s) { return s.locked && s.gang === gangId; })[0] || null;
    }

    render() {
      var v = this.view(), me = this.mySeat(v), g = this.g;
      g.clear();
      var locked = me && me.locked;
      this.cards.forEach(function (c, i) {
        var gang = GANGS[i], t = this.takenBy(v, gang.id);
        var mine = t && t.me, selected = i === this.cursor && !locked;
        // Assombri : pris par un autre (fort), ou simplement pas sous le curseur.
        var shade = t && !mine ? 0.68 : (selected || mine ? 0 : 0.38);
        c.shade.setFillStyle(0x000000, shade);
        c.img.setTint(t && !mine ? 0x9a9a9a : 0xffffff);
        if (selected || mine) {
          g.lineStyle(5, mine ? 0xffffff : gang.color, 1).strokeRect(c.x - 2, this.panelTop - 2, c.w + 4, this.panelH + 4);
        }
        c.stamp.setText(!t ? '' : (mine ? 'TOI \u2714' : (t.bot ? '' : String(t.nick || '').toUpperCase()))); // "CPU" est deja en haut du portrait
        // Nom en haut du portrait : celui choisi par le joueur, sinon le prenom par defaut.
        c.hero.setText(seatLabel(t));
      }, this);

      var seats = arr(v.seats);
      this.playersText.setText('JOUEURS (' + seats.length + '/4) : ' + seats.map(function (s) {
        return (s.bot ? 'CPU' : String(s.nick || 'JOUEUR')) + (s.locked ? ' ✔' : ' …');
      }).join('   '));

      if (v.state === 'countdown') this.stateText.setText('DÉPART DANS ' + Math.max(1, Math.ceil(v.cd / 1000)));
      else if (seats.length < 4) this.stateText.setText('EN ATTENTE DE JOUEURS');
      else this.stateText.setText('EN ATTENTE DU VERROUILLAGE');

      this.helpText.setText('GAUCHE/DROITE choisir   ENTRÉE verrouiller   RETOUR déverrouiller   ÉCHAP ' +
        (this.mode === 'online' ? 'quitter le salon' : 'retour'));
      this.hostText.setText(this.mode === 'online' && v.isHost ? 'HÔTE : C ajouter un CPU   X retirer un CPU' : '');
    }

    onKeyDown(ev) {
      var v = this.view(), me = this.mySeat(v);
      if (ev.code === 'ArrowLeft' || ev.code === 'KeyA') { this.cursor = (this.cursor + 3) % 4; this.render(); sfx('move'); }
      else if (ev.code === 'ArrowRight' || ev.code === 'KeyD') { this.cursor = (this.cursor + 1) % 4; this.render(); sfx('move'); }
      else if (isOk(ev) && !ev.repeat) {
        if (me && me.locked) return;
        var gang = GANGS[this.cursor].id, self = this;
        if (this.takenBy(v, gang)) { this.msgText.setText('Ce gang est déjà pris.'); return; }
        this.msgText.setText('');
        // Le joueur donne son nom a son perso avant de verrouiller.
        this.naming = true;
        window.FiveCadeBridge.promptName('TON NOM (FACULTATIF)', function (name) {
          self.naming = false;
          if (!self.scene.isActive()) return;
          if (self.takenBy(self.view(), gang)) { self.msgText.setText('Ce gang vient d\'être pris.'); return; }
          sfx('lock');
          if (self.mode === 'online') Net.send('lock', { gang: gang, name: name });
          else self.soloLock(gang, name);
        }, function () { self.naming = false; });
      } else if (ev.code === 'Backspace') {
        if (!me || !me.locked) return;
        if (this.mode === 'online') Net.send('unlock');
        else this.soloUnlock();
      } else if (this.mode === 'online' && v.isHost && ev.code === 'KeyC') Net.send('addBot');
      else if (this.mode === 'online' && v.isHost && ev.code === 'KeyX') Net.send('removeBot');
    }

    /* Contre le CPU : les 3 CPU prennent les gangs restants. */
    soloLock(gang, name) {
      var me = this.local.seats[0];
      me.gang = gang; me.locked = true; me.nick = name || '';
      var free = GANGS.map(function (g) { return g.id; }).filter(function (id) { return id !== gang; });
      this.local.seats = [me].concat(free.map(function (id) {
        return { name: 'CPU', gang: id, locked: true, bot: true, me: false };
      }));
      this.local.state = 'countdown';
      this.local.cd = 3000;
      this.render();
    }
    soloUnlock() {
      var me = this.local.seats[0];
      me.gang = ''; me.locked = false;
      this.local.seats = [me];
      this.local.state = 'lobby';
      this.render();
    }

    update(time, delta) {
      if (this.mode !== 'solo' || this.local.state !== 'countdown') return;
      var before = Math.ceil(this.local.cd / 1000);
      this.local.cd -= delta;
      if (this.local.cd <= 0) {
        this.local.state = 'playing';
        this.scene.start('GameScene', {
          mode: 'solo', seat: 0,
          seats: this.local.seats.map(function (s) { return { gang: s.gang, name: s.bot ? 'CPU' : (s.nick || 'JOUEUR'), nick: s.nick || '', bot: s.bot }; })
        });
      } else if (Math.ceil(this.local.cd / 1000) !== before) this.render();
    }

    onNet(t, d) {
      if (t === 'room') this.render();
      else if (t === 'start') this.scene.start('GameScene', { mode: 'online', seat: d.seat, seats: arr(d.seats) });
      else if (t === 'left') this.scene.start('OnlineScene');
      else if (t === 'err') { this.msgText.setText(d.msg || 'Erreur'); this.render(); }
    }

    onEscape() {
      if (this.naming) return true; // la saisie du nom gere son propre Echap
      if (this.mode === 'online') { Net.send('leave'); this.scene.start('OnlineScene'); }
      else this.scene.start('MenuScene');
      return true;
    }
  }

  /* ======================================================================
   * Partie
   * ====================================================================== */
  class GameScene extends Phaser.Scene {
    constructor() { super('GameScene'); }
    init(data) {
      this.mode = data.mode;
      this.seat = data.seat; // -1 = spectateur (demo 4 CPU)
      this.seats = data.seats;
      this.speed = data.speed || 1;
      this.demo = !!data.demo;
      this.cfg = data.cfg || null; // reglages de demo (ex. manche raccourcie)
    }

    create() {
      var self = this;
      this.map = null; this.mapRound = -1; this.grid = null;
      this.buf = []; this.last = null;
      this.dirStack = []; this.lastDir = null;
      this.escArmedUntil = 0;
      this.leaving = false;

      this.gRoad = this.add.graphics().setDepth(0);      // routes (sous les batiments)
      this.cityImages = [];                                // un batiment par pate de maisons
      this.gStatic = this.add.graphics().setDepth(0.8);  // gravats, couleurs, police (au-dessus)
      this.staticProps = new SpritePool(this, 'props', 0.85);  // tas de gravats, barrages
      this.dynProps = new SpritePool(this, 'props', 2.2);      // bonus, bombes, feu
      this.baseTexts = [];
      this.gDyn = this.add.graphics().setDepth(2);
      this.playerSprites = this.seats.map(function (s) {
        return self.add.sprite(0, 0, 'chars_' + s.gang, 0).setOrigin(0.5, 0.62).setDepth(3).setVisible(false);
      });
      this.playerTexts = this.seats.map(function (s) {
        var g = gangOf(s.gang);
        return txt(self, 0, 0, g ? g.symbol : '?', Math.round(CELL * 0.5), '#000000').setDepth(3);
      });
      this.qgText = txt(this, 0, 0, 'TON QG', 18, '#ffffff').setDepth(4).setVisible(false);

      // HUD : vert, violet | chrono | jaune, bleu (disposition de l'image de reference)
      var S = HUD_SCALE, top = 4;
      this.gHud = this.add.graphics().setDepth(13); // couronne du leader
      var timerW = HUD_FRAMES.timer[2] * S;
      var pw = function (id) { return HUD_FRAMES['plate_' + id][2] * S; };
      var gapX = 14, mid = GAME_W / 2;
      var left = {};
      left.purple = mid - timerW / 2 - gapX - pw('purple');
      left.green = left.purple - gapX - pw('green');
      left.yellow = mid + timerW / 2 + gapX;
      left.blue = left.yellow + pw('yellow') + gapX;
      this.hudSlots = GANGS.map(function (g) {
        var P = HUD_PLATES[g.id], x = left[g.id], cy = top + P.h / 2 * S;
        var barW = HUD_FRAMES['bar_' + g.id][2];
        var bs = (P.dig[0] - 22 - P.bar0) / barW * S; // la barre remplit l'espace jusqu'au chiffre
        var slot = { x: x, gang: g, P: P, seat: self.seats.map(function (st) { return st.gang; }).indexOf(g.id) };
        slot.plate = self.add.image(x, top, 'hud', 'plate_' + g.id).setOrigin(0, 0).setScale(S).setDepth(10);
        // Un trait = une vie : on garde autant de segments dessines que de vies
        // (5 sur les 10 de la barre) et on les etire sur toute la largeur.
        var segs = HUD_SEG_ENDS[g.id], nv = Math.min(10, Sim.CFG.lives);
        slot.segW = segs[nv - 1] + 2;
        var bsx = bs * barW / slot.segW, frameH = HUD_FRAMES['bar_' + g.id][3];
        slot.barGhost = self.add.image(x + P.bar0 * S, cy, 'hud', 'bar_' + g.id).setOrigin(0, 0.5).setScale(bsx, bs).setAlpha(0.16).setDepth(11);
        slot.barGhost.setCrop(0, 0, slot.segW, frameH);
        slot.bar = self.add.image(x + P.bar0 * S, cy, 'hud', 'bar_' + g.id).setOrigin(0, 0.5).setScale(bsx, bs).setDepth(12);
        slot.lastLives = -1; slot.flashUntil = 0;
        // Gros chiffre : bombes posables en ce moment
        slot.bombs = self.add.text(x + ((P.dig[0] + P.dig[1]) / 2 - 6) * S, cy, '1', {
          fontFamily: '"Arial Black", Impact, sans-serif', fontSize: Math.round(84 * S) + 'px',
          color: hex(g.color), stroke: '#000000', strokeThickness: 7
        }).setOrigin(0.5, 0.5).setDepth(12);
        slot.bombs.setShadow(2, 3, '#000000', 0, true, true);
        slot.me = txt(self, x + pw(g.id) / 2, top + P.h * S + 3, '', 10, '#ffffff').setDepth(12);
        return slot;
      });
      // Chrono : fond nettoye + temps + 4 points de manches
      this.timerPlate = this.add.image(mid - timerW / 2, top, 'hud', 'timer').setOrigin(0, 0).setScale(S).setDepth(10);
      this.timerText = this.add.text(mid, top + HUD_FRAMES.timer[3] * S * 0.64, '2:00', {
        fontFamily: '"Arial Black", Impact, sans-serif', fontSize: Math.round(60 * S) + 'px',
        color: '#ffffff', stroke: '#000000', strokeThickness: 6
      }).setOrigin(0.5, 0.5).setDepth(12);
      this.roundDots = [0, 1, 2, 3].map(function (i) {
        return self.add.image(mid + (i - 1.5) * 32 * S, top + 26 * S, 'hud', 'dot').setScale(0.5 * S).setDepth(12);
      });

      // Surimpressions (intro de manche, fin de manche, victoire)
      this.gOverlay = this.add.graphics().setDepth(20);
      this.ovTitle = txt(this, GAME_W / 2, OY + 200, '', 40, '#ffffff').setDepth(21);
      this.ovSub = txt(this, GAME_W / 2, OY + 260, '', 22, '#d8d8e8').setDepth(21);
      this.ovBig = txt(this, GAME_W / 2, OY + 360, '', 96, '#ffd23f').setDepth(21);
      // Ecran de victoire : portrait du chef du gang vainqueur
      this.ovPortrait = this.add.image(GAME_W / 2, GAME_H / 2 + 60, 'portraits', 'p0').setDepth(20.5).setVisible(false);
      this.ovFrame = this.add.graphics().setDepth(20.6);
      this.ovLines = [0, 1, 2, 3].map(function (i) { return txt(self, GAME_W / 2, OY + 330 + i * 34, '', 22, '#ffffff').setDepth(21); });
      this.flashText = txt(this, GAME_W / 2, OY + 40, '', 26, '#ffffff').setDepth(22).setAlpha(0);
      // Bandeau du joueur elimine : il regarde la fin de la manche et revient a la suivante
      this.gSpect = this.add.graphics().setDepth(21);
      this.spectText = txt(this, GAME_W / 2, GAME_H - 44, '', 20, '#ffffff').setDepth(22);

      this.onBlur = function () { self.dirStack = []; self.sendDir(); };
      window.addEventListener('blur', this.onBlur);
      this.events.once('shutdown', function () {
        window.removeEventListener('blur', self.onBlur);
        if (self.mode === 'online' && !self.leaving) Net.send('dir', { d: '' });
      });

      music('game');
      this.lastBeep = -1;
      if (this.mode === 'solo') {
        this.sim = Sim.createMatch({ seed: (Math.random() * 0x7fffffff) >>> 0, seats: this.seats, cfg: this.cfg });
        this.acc = 0;
        this.onSnap(Sim.snapshot(this.sim));
      } else {
        Net.listen(this, this.onNet);
        var early = Net.earlySnaps; Net.earlySnaps = [];
        early.forEach(function (s) { self.onSnap(s); });
      }
    }

    /* ---------------------------------------------------------- reseau */
    onNet(t, d) {
      if (t === 'snap') this.onSnap(d);
      else if (t === 'end') { this.leaving = true; this.scene.start('RoomScene', { mode: 'online' }); }
      else if (t === 'left') { this.leaving = true; this.scene.start('OnlineScene'); }
    }

    onSnap(s) {
      if (s.mp && s.rd !== this.mapRound) this.buildMap(s.mp, s.rd);
      if (!this.map) return; // pas encore de carte : on attend le prochain envoi complet
      if (typeof s.g === 'string' && s.g !== this.grid) { this.grid = s.g; this.drawStatic(); }
      this.buf.push({ t: performance.now(), s: s });
      if (this.buf.length > 5) this.buf.shift();
      this.last = s;
      arr(s.ev).forEach(this.onEvent, this);
      this.updateHud(s);
      this.updateOverlay(s);
    }

    /* Evenements : pour l'instant de simples messages, plus tard les sons/effets. */
    onEvent(e) {
      var g;
      var SOUND = { bomb: 'bomb', boom: 'boom', 'break': 'crumble', drop: 'drop', go: 'go', police: 'police', police_drop: 'barricade' };
      if (SOUND[e.t]) sfx(SOUND[e.t]);
      if (e.t === 'pick' && e.s === this.seat) sfx('pick');
      if (e.t === 'hit' && e.s === this.seat) sfx('hit');
      if (e.t === 'elim') sfx('elim');
      if (e.t === 'round_end') sfx(e.w >= 0 ? 'round' : 'draw');
      if (e.t === 'match_end') { music(null); sfx('victory'); }
      if (e.t === 'go') this.flash('GO !', '#ffffff');
      else if (e.t === 'hit' && e.s === this.seat) this.flash('TOUCHÉ ! -1 VIE', '#ff5a5a');
      else if (e.t === 'elim') {
        g = gangOf(this.seats[e.s].gang);
        this.flash(e.s === this.seat ? 'TU ES ÉLIMINÉ' : 'GANG ' + g.label + ' ÉLIMINÉ', hex(g.color), 2000, true);
      } else if (e.t === 'pick' && e.s === this.seat) {
        this.flash(e.k === 1 ? '+1 PORT\u00c9E' : e.k === 2 ? '+1 BOMBE' : '+1 VITESSE', '#ffd23f');
      } else if (e.t === 'police') {
        this.flash(e.w === 0 ? 'DESCENTE DE POLICE !' : 'LA POLICE RESSERRE LE P\u00c9RIM\u00c8TRE !', '#ff4040', 4000, true);
      }
      else if (e.t === 'crush' && e.s === this.seat) this.flash('\u00c9CRAS\u00c9 PAR LA POLICE', '#ff4040', 2500, true);
    }

    /* Message central. hold = temps d'affichage plein (ms) ; un message
     * important (prio) n'est pas ecrase par un petit message (+1 bombe...). */
    flash(text, color, hold, prio) {
      var now = performance.now();
      if (!prio && now < (this.flashLockUntil || 0)) return;
      hold = hold || 900;
      this.flashLockUntil = prio ? now + hold : 0;
      this.flashText.setText(text).setColor(color).setFontSize(prio ? 44 : 28).setY(prio ? OY + 60 : OY + 40).setAlpha(1);
      this.tweens.killTweensOf(this.flashText);
      this.tweens.add({ targets: this.flashText, alpha: 0, delay: hold, duration: 600 });
    }

    /* ---------------------------------------------------------- carte */
    buildMap(mp, round) {
      var self = this;
      this.map = mp;
      this.mapRound = round;
      this.grid = null;
      this.buf = [];
      this.cityBuilt = false;
      this.baseTexts.forEach(function (t) { t.destroy(); });
      this.baseTexts = arr(mp.bases).map(function (b) {
        var g = gangOf(self.seats[b.seat].gang);
        var cx = OX + (b.x0 + b.x1 + 1) / 2 * CELL, cy = OY + (b.y0 + b.y1 + 1) / 2 * CELL;
        var size = Math.round(Math.min(b.x1 - b.x0 + 1, b.y1 - b.y0 + 1) * CELL * 0.7);
        return txt(self, cx, cy, g.symbol, size, hex(g.color)).setDepth(1).setAlpha(0.9);
      });
    }

    /* Pose la ville une fois par manche : un batiment (image) par pate de
     * maisons, la place aux arbres sous chaque QG, les routes en dessous. */
    buildCity() {
      var self = this, grid = this.grid, bld = arr(this.map.bld), W = Sim.W, H = Sim.H;
      this.cityImages.forEach(function (im) { im.destroy(); });
      this.cityImages = [];
      this.blocks = {};
      this.origBuilding = [];
      this.origRoad = [];
      for (var i = 0; i < W * H; i++) {
        var ch = grid.charAt(i), id = bld[i];
        this.origBuilding[i] = ch === '#' || ch === 'X' ? id : -1;
        this.origRoad[i] = ch !== '#' && ch !== 'X' && ch !== 'B';
        if (this.origBuilding[i] < 0) continue;
        var x = i % W, y = (i - x) / W, b = this.blocks[id];
        if (!b) b = this.blocks[id] = { id: id, x0: x, y0: y, x1: x, y1: y, armored: ch === 'X' };
        b.x0 = Math.min(b.x0, x); b.y0 = Math.min(b.y0, y); b.x1 = Math.max(b.x1, x); b.y1 = Math.max(b.y1, y);
      }
      // Les cours interieures (cases vides dans un pate) ne sont pas des routes.
      Object.keys(this.blocks).forEach(function (k) {
        var b = self.blocks[k];
        for (var y = b.y0; y <= b.y1; y++) for (var x = b.x0; x <= b.x1; x++) {
          if (self.origBuilding[y * W + x] < 0) { self.origRoad[y * W + x] = false; self.origBuilding[y * W + x] = -2; }
        }
      });
      var pool = CITY_POOLS[this.map.type] || CITY_POOLS.downtown;
      Object.keys(this.blocks).forEach(function (k) {
        var b = self.blocks[k];
        var list = b.armored ? CITY_ARMORED : pool;
        var frame = list[(b.id * 7 + self.mapRound * 13 + b.x0 * 3 + b.y0) % list.length];
        self.cityImages.push(self.add.image(OX + b.x0 * CELL, OY + b.y0 * CELL, 'city', frame).setOrigin(0, 0)
          .setDisplaySize((b.x1 - b.x0 + 1) * CELL, (b.y1 - b.y0 + 1) * CELL).setDepth(0.5));
      });
      arr(this.map.bases).forEach(function (b) {
        self.cityImages.push(self.add.image(OX + b.x0 * CELL, OY + b.y0 * CELL, 'city', CITY_BASE).setOrigin(0, 0)
          .setDisplaySize((b.x1 - b.x0 + 1) * CELL, (b.y1 - b.y0 + 1) * CELL).setDepth(0.5));
      });
      this.drawRoads();
      this.cityBuilt = true;
    }

    /* Routes : asphalte legerement granuleux + marquage blanc en pointilles
     * dans l'axe ; rien aux croisements. */
    drawRoads() {
      var g = this.gRoad, W = Sim.W, H = Sim.H, road = this.origRoad;
      var isRoad = function (x, y) { return x >= 0 && y >= 0 && x < W && y < H && road[y * W + x]; };
      g.clear();
      g.fillStyle(COLORS.asphalt, 1).fillRect(OX, OY, W * CELL, H * CELL);
      for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
        var px = OX + x * CELL, py = OY + y * CELL;
        // grain de l'asphalte (deterministe)
        for (var k = 0; k < 6; k++) {
          var h = (x * 73856093 ^ y * 19349663 ^ k * 83492791) >>> 0;
          g.fillStyle(k % 2 ? COLORS.asphaltDark : COLORS.asphaltLight, 1)
            .fillRect(px + (h % (CELL - 3)), py + ((h >>> 8) % (CELL - 3)), 3, 2);
        }
        if (!isRoad(x, y)) continue;
        var hz = isRoad(x - 1, y) || isRoad(x + 1, y), vt = isRoad(x, y - 1) || isRoad(x, y + 1);
        g.fillStyle(COLORS.laneMark, 0.85);
        if (hz && !vt) g.fillRect(px + CELL / 2 - 8, py + CELL / 2 - 1, 16, 2);
        else if (vt && !hz) g.fillRect(px + CELL / 2 - 1, py + CELL / 2 - 8, 2, 16);
      }
    }

    /* Par-dessus la ville : gravats des cases de batiment detruites, couleur
     * des gangs, barrages de police, liseres des QG et des blindes. */
    drawStatic() {
      if (!this.cityBuilt) this.buildCity();
      var g = this.gStatic, grid = this.grid, W = Sim.W, H = Sim.H, self = this, orig = this.origBuilding;
      g.clear();
      this.staticProps.begin();
      for (var y = 0; y < H; y++) {
        for (var x = 0; x < W; x++) {
          var i = y * W + x, ch = grid.charAt(i), px = OX + x * CELL, py = OY + y * CELL;
          if (ch === 'P') {
            // Barrage de police sur l'asphalte
            g.fillStyle(COLORS.asphaltDark, 1).fillRect(px, py, CELL, CELL);
            var bp = this.staticProps.get((x + y) % 3 === 0 ? 'barricade_cones' : 'barricade');
            bp.setPosition(px + CELL / 2, py + CELL / 2).setDisplaySize(CELL - 4, CELL - 4);
            continue;
          }
          if (ch === '#' || ch === 'X' || ch === 'B') continue;
          var colored = ch >= '0' && ch <= '3';
          var owner = colored ? gangOf(self.seats[Number(ch)].gang) : null;
          if (orig[i] >= 0) {
            // Case de batiment detruite : le batiment reste visible mais en
            // ruine (noirci, brulure au centre, gravats par-dessus).
            g.fillStyle(0x000000, 0.5).fillRect(px, py, CELL, CELL);
            g.fillStyle(0x140d08, 0.55).fillEllipse(px + CELL / 2, py + CELL / 2, CELL * 0.9, CELL * 0.8);
            if (colored) g.fillStyle(owner.color, 0.38).fillRect(px, py, CELL, CELL);
            g.lineStyle(2, 0x0b0b0b, 0.9).strokeRect(px + 1, py + 1, CELL - 2, CELL - 2);
            var hr = (x * 7 + y * 13) >>> 0;
            this.staticProps.get(RUBBLE[hr % RUBBLE.length]).setPosition(px + CELL / 2, py + CELL / 2)
              .setDisplaySize(CELL - 6, CELL - 8).setAngle((hr % 4) * 90);
          } else {
            if (orig[i] === -2) g.fillStyle(COLORS.rubble, 1).fillRect(px, py, CELL, CELL); // cour interieure
            if (colored) {
              // Route prise par un gang : couleur franche + lisere en bordure de territoire
              g.fillStyle(owner.color, 0.62).fillRect(px, py, CELL, CELL);
              var same = function (xx, yy) { return xx >= 0 && yy >= 0 && xx < W && yy < H && grid.charAt(yy * W + xx) === ch; };
              g.fillStyle(owner.color, 1);
              if (!same(x, y - 1)) g.fillRect(px, py, CELL, 3);
              if (!same(x, y + 1)) g.fillRect(px, py + CELL - 3, CELL, 3);
              if (!same(x - 1, y)) g.fillRect(px, py, 3, CELL);
              if (!same(x + 1, y)) g.fillRect(px + CELL - 3, py, 3, CELL);
            }
          }
        }
      }
      Object.keys(this.blocks).forEach(function (k) {
        var b = self.blocks[k];
        if (b.armored) self.drawArmored(g, OX + b.x0 * CELL, OY + b.y0 * CELL, (b.x1 - b.x0 + 1) * CELL, (b.y1 - b.y0 + 1) * CELL);
      });
      arr(this.map.bases).forEach(function (b) {
        var gang = gangOf(self.seats[b.seat].gang);
        g.lineStyle(4, gang.color, 1).strokeRect(OX + b.x0 * CELL + 2, OY + b.y0 * CELL + 2,
          (b.x1 - b.x0 + 1) * CELL - 4, (b.y1 - b.y0 + 1) * CELL - 4);
      });
      this.staticProps.end();
    }

    /* Mur blinde (indestructible) : voile acier, bordure de chantier
     * jaune/noire et rivets aux coins, pour qu'on le repere d'un coup d'oeil. */
    drawArmored(g, x, y, w, h) {
      var t = 7, step = 10;
      g.fillStyle(0x9aa6b8, 0.22).fillRect(x, y, w, h);
      g.fillStyle(0x111111, 1);
      g.fillRect(x, y, w, t); g.fillRect(x, y + h - t, w, t);
      g.fillRect(x, y, t, h); g.fillRect(x + w - t, y, t, h);
      g.fillStyle(0xf2c200, 1);
      var k, i = 0;
      for (k = 0; k < w; k += step, i++) if (i % 2 === 0) {
        g.fillRect(x + k, y, Math.min(step, w - k), t); g.fillRect(x + k, y + h - t, Math.min(step, w - k), t);
      }
      for (k = t, i = 1; k < h - t; k += step, i++) if (i % 2 === 0) {
        g.fillRect(x, y + k, t, Math.min(step, h - t - k)); g.fillRect(x + w - t, y + k, t, Math.min(step, h - t - k));
      }
      g.lineStyle(1, 0x000000, 1).strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      g.fillStyle(0xd8dee8, 1);
      [[x + t + 5, y + t + 5], [x + w - t - 5, y + t + 5], [x + t + 5, y + h - t - 5], [x + w - t - 5, y + h - t - 5]]
        .forEach(function (r) { g.fillCircle(r[0], r[1], 3); });
    }

    /* Positions des persos interpolees entre les deux derniers snapshots. */
    playerPositions() {
      var buf = this.buf, last = this.last;
      var renderT = performance.now() - INTERP_MS, a = null, b = null;
      for (var k = buf.length - 1; k > 0; k--) {
        if (buf[k - 1].t <= renderT) { a = buf[k - 1]; b = buf[k]; break; }
      }
      var solo = this.mode === 'solo', me = this.seat, lastT = buf.length ? buf[buf.length - 1].t : 0;
      var prev = buf.length > 1 ? buf[buf.length - 2].s : null, stepMs = Sim.CFG.stepMs, self = this;
      return arr(last.pl).map(function (p, i) {
        if (solo) {
          var mv = prev && prev.pl[i] && (prev.pl[i][0] !== p[0] || prev.pl[i][1] !== p[1]);
          return { x: p[0] / 100, y: p[1] / 100, p: p, moving: !!mv || (self.sim && self.sim.players[i] && self.sim.players[i].moving) };
        }
        if (i === me && prev && prev.pl[i] && p[2] === 0) {
          var q = prev.pl[i], ddx = Math.sign(p[0] - q[0]), ddy = Math.sign(p[1] - q[1]);
          if (ddx || ddy) {
            // on prolonge jusqu'au centre de la case visee, jamais au-dela
            var stepEff = stepMs * (1 - Sim.CFG.speedStep * (p[9] || 0)), ahead = Math.min(1, (performance.now() - lastT) / stepEff) * 100;
            var x = p[0] + ddx * ahead, y = p[1] + ddy * ahead;
            if (ddx > 0) x = Math.min(x, Math.ceil(p[0] / 100) * 100); if (ddx < 0) x = Math.max(x, Math.floor(p[0] / 100) * 100);
            if (ddy > 0) y = Math.min(y, Math.ceil(p[1] / 100) * 100); if (ddy < 0) y = Math.max(y, Math.floor(p[1] / 100) * 100);
            return { x: x / 100, y: y / 100, p: p, moving: true };
          }
          return { x: p[0] / 100, y: p[1] / 100, p: p, moving: false };
        }
        if (!a) return { x: p[0] / 100, y: p[1] / 100, p: p, moving: false };
        var pa = a.s.pl[i], pb = b.s.pl[i];
        if (!pa || !pb) return { x: p[0] / 100, y: p[1] / 100, p: p, moving: false };
        var moving = pa[0] !== pb[0] || pa[1] !== pb[1];
        var alpha = Math.min(1, Math.max(0, (renderT - a.t) / Math.max(1, b.t - a.t)));
        var jump = pa[2] !== pb[2] || Math.abs(pa[0] - pb[0]) + Math.abs(pa[1] - pb[1]) > 200;
        if (jump) return { x: pb[0] / 100, y: pb[1] / 100, p: pb, moving: false };
        return { x: (pa[0] + (pb[0] - pa[0]) * alpha) / 100, y: (pa[1] + (pb[1] - pa[1]) * alpha) / 100, p: pb, moving: moving };
      });
    }

    drawDynamic(now) {
      var g = this.gDyn, s = this.last, self = this;
      g.clear();
      if (!s || !this.map) return;
      var c = function (v) { return v * CELL + CELL / 2; };

      var dp = this.dynProps;
      dp.begin();
      // Bonus : icones PixelLab, leger flottement
      arr(s.bn).forEach(function (b) {
        var bob = Math.sin(now / 250 + b[0] + b[1]) * 2;
        dp.get(BONUS_FRAME[b[2]] || 'bonus_bomb').setPosition(OX + c(b[0]), OY + c(b[1]) + bob).setDisplaySize(CELL - 8, CELL - 8);
      });

      // Police : l'anneau annonce clignote (rouge/bleu) jusqu'a la chute des barrages
      var siren = Math.floor(now / 200) % 2 === 0 ? COLORS.policeRed : COLORS.policeBlue;
      arr(s.pw).forEach(function (i) {
        var x = i % Sim.W, y = Math.floor(i / Sim.W);
        g.fillStyle(siren, 0.35).fillRect(OX + x * CELL, OY + y * CELL, CELL, CELL);
        g.lineStyle(2, siren, 1).strokeRect(OX + x * CELL + 2, OY + y * CELL + 2, CELL - 4, CELL - 4);
      });

      // Bombes : anneau a la couleur du poseur + bombe qui pulse de plus en plus vite
      arr(s.bm).forEach(function (b) {
        var gang = gangOf(self.seats[b[2]].gang);
        var speed = b[3] < 600 ? 45 : 130, k = 1 + 0.08 * Math.sin(now / speed);
        g.lineStyle(3, gang.color, 0.9).strokeCircle(OX + c(b[0]), OY + c(b[1]) + 3, CELL * 0.36);
        dp.get('bomb').setPosition(OX + c(b[0]), OY + c(b[1])).setDisplaySize(CELL * 0.7 * k, CELL * 0.85 * k);
      });

      // Flammes : feu anime (deux images en alternance) sur chaque case touchee
      var fireFrame = Math.floor(now / 80) % 2 ? 'fire_0' : 'fire_1';
      var orig = this.origBuilding || [];
      arr(s.fl).forEach(function (f) {
        var cx = OX + c(f[0]), cy = OY + c(f[1]), m = f[3], h = CELL / 2;
        if (orig[f[1] * Sim.W + f[0]] >= 0) {
          // batiment touche : grosse boule de feu qui deborde de la case
          dp.get(fireFrame).setPosition(cx, cy - 4).setDisplaySize(CELL * 1.5, CELL * 1.5).setAngle(0);
          return;
        }
        // route : trainee de feu fine le long de la flamme
        g.fillStyle(0xff7a1a, 0.9);
        if (m & 1) g.fillRect(cx - 5, cy - h, 10, h);
        if (m & 2) g.fillRect(cx - 5, cy, 10, h);
        if (m & 4) g.fillRect(cx - h, cy - 5, h, 10);
        if (m & 8) g.fillRect(cx, cy - 5, h, 10);
        g.fillStyle(0xfff0a0, 1);
        if (m & 1) g.fillRect(cx - 2, cy - h, 4, h);
        if (m & 2) g.fillRect(cx - 2, cy, 4, h);
        if (m & 4) g.fillRect(cx - h, cy - 2, h, 4);
        if (m & 8) g.fillRect(cx, cy - 2, h, 4);
        if ((m & 3) && (m & 12) || m === 15 || !m) { // centre de l'explosion : petite flambee
          dp.get(fireFrame).setPosition(cx, cy).setDisplaySize(CELL * 0.8, CELL * 0.8).setAngle(0);
        }
      });
      dp.end();

      // Mon QG pendant l'intro (personne ne sait a l'avance ou il sera)
      var myBase = arr(this.map.bases).filter(function (b) { return b.seat === self.seat; })[0];
      if (s.ph === 'intro' && myBase) {
        var pulse = 0.5 + 0.5 * Math.sin(now / 150);
        g.lineStyle(4, 0xffffff, 0.4 + 0.6 * pulse).strokeRect(OX + myBase.x0 * CELL - 4, OY + myBase.y0 * CELL - 4,
          (myBase.x1 - myBase.x0 + 1) * CELL + 8, (myBase.y1 - myBase.y0 + 1) * CELL + 8);
        var above = myBase.y0 > 2;
        this.qgText.setPosition(OX + (myBase.x0 + myBase.x1 + 1) / 2 * CELL,
          OY + (above ? myBase.y0 * CELL - 20 : (myBase.y1 + 1) * CELL + 20)).setVisible(true);
      } else this.qgText.setVisible(false);

      // Personnages : planche PixelLab (arret / marche sud, est, nord ; l'ouest
      // est l'est en miroir). Cercle a la couleur du gang sous les pieds.
      var positions = this.playerPositions();
      var walkFrame = Math.floor(now / 85) % 8;
      positions.forEach(function (pos, i) {
        var p = pos.p, sp = self.playerSprites[i];
        self.playerTexts[i].setVisible(false);
        var gang = gangOf(self.seats[i].gang);
        if (!p || p[2] === 2) { sp.setVisible(false); return; } // elimine
        var px = OX + c(pos.x), py = OY + c(pos.y);
        var alpha = p[2] === 1 ? 0.45 : (p[5] && Math.floor(now / 90) % 2 ? 0.3 : 1);
        g.fillStyle(gang.color, 0.55 * alpha).fillEllipse(px, py + CELL * 0.3, CELL * 0.72, CELL * 0.3);
        g.lineStyle(2, gang.color, alpha).strokeEllipse(px, py + CELL * 0.3, CELL * 0.72, CELL * 0.3);
        // facing : 0 haut (nord), 1 bas (sud), 2 gauche (ouest = est en miroir), 3 droite (est)
        var col = [2, 0, 1, 1][p[4]], row = [3, 1, 2, 2][p[4]];
        var walking = pos.moving || p[2] === 1;
        sp.setFrame(walking ? row * 8 + walkFrame : col).setFlipX(p[4] === 2)
          .setPosition(px, py).setDisplaySize(CELL * 2.05, CELL * 2.05).setAlpha(alpha).setVisible(true)
          .setDepth(3 + pos.y / 100); // les persos plus bas passent devant
        if (i === self.seat && p[2] === 0) { // repere "c'est moi"
          var ty = py - CELL * 1.25;
          g.fillStyle(0xffffff, 1).fillTriangle(px - 7, ty, px + 7, ty, px, ty + 10);
        }
      });
    }

    /* ---------------------------------------------------------- HUD */
    updateHud(s) {
      var g = this.gHud, self = this, S = HUD_SCALE;
      g.clear();
      // Couronne : gang seul en tete au territoire (au moins une case)
      var leader = -1, best = 0, tie = false;
      arr(s.tr).forEach(function (v, seat) {
        if (v > best) { best = v; leader = seat; tie = false; } else if (v === best && v > 0) tie = true;
      });
      if (tie) leader = -1;
      this.hudSlots.forEach(function (slot) {
        var p = s.pl[slot.seat];
        var dead = !p || p[2] === 2, alpha = dead ? 0.35 : 1;
        // 10 traits dessines, repartis sur les vies (5 vies = 2 traits par vie)
        var lives = p ? Math.max(0, Math.min(10, p[3])) : 0;
        var frameH = HUD_FRAMES['bar_' + slot.gang.id][3], now = performance.now();
        // Barre : un trait par vie, les vies perdues disparaissent par la droite
        if (lives > 0) slot.bar.setCrop(0, 0, HUD_SEG_ENDS[slot.gang.id][lives - 1] + 2, frameH).setVisible(true);
        else slot.bar.setVisible(false);
        if (slot.lastLives >= 0 && lives < slot.lastLives) slot.flashUntil = now + 900; // vie perdue : la plaque clignote
        slot.lastLives = lives;
        var flash = now < slot.flashUntil && Math.floor(now / 110) % 2 === 0;
        slot.plate.setAlpha(alpha).setTint(flash ? 0xff5555 : 0xffffff);
        slot.barGhost.setAlpha(0.16 * alpha); slot.bar.setAlpha(flash ? 0.25 : alpha);
        slot.bombs.setText(String(p ? p[6] : 1)).setAlpha(alpha); // capacite de bombes : 1 + bonus
        slot.me.setText(slot.seat === self.seat ? '\u25b2 TOI' : '');
        if (slot.seat === leader) { // couronne au-dessus du portrait
          var cx = slot.x + 85 * S;
          g.fillStyle(0xffd23f, 1).fillRect(cx - 10, 6, 20, 5);
          g.fillTriangle(cx - 10, 6, cx - 10, -1, cx - 4, 6);
          g.fillTriangle(cx - 5, 6, cx, -2, cx + 5, 6);
          g.fillTriangle(cx + 4, 6, cx + 10, -1, cx + 10, 6);
        }
      });
      this.timerText.setText(fmtTime(s.tm)).setColor(s.ph === 'play' && s.tm <= Sim.CFG.policeWaves[0] + Sim.CFG.policeWarnMs ? '#ff4040' : '#ffffff');
      // Points : couleur du gang gagnant de chaque manche jouee, blanc = egalite,
      // manche en cours a moitie allumee, manches a venir eteintes.
      var rh = arr(s.rh);
      this.roundDots.forEach(function (dot, i) {
        if (i < rh.length) {
          var w = rh[i] >= 0 ? gangOf(self.seats[rh[i]].gang) : null;
          if (w) dot.setTint(w.color); else dot.clearTint();
          dot.setAlpha(1);
        } else {
          dot.clearTint();
          dot.setAlpha(i === rh.length && s.ph !== 'matchEnd' ? 0.6 : 0.2);
        }
      });
    }

    /* ---------------------------------------------------------- surimpressions */
    updateOverlay(s) {
      var g = this.gOverlay, self = this;
      g.clear();
      [this.ovTitle, this.ovSub, this.ovBig].concat(this.ovLines).forEach(function (t) { t.setText(''); });
      this.ovTitle.setY(OY + 200); this.ovSub.setY(OY + 260); this.ovLines[3].setY(OY + 330 + 3 * 34);
      this.ovPortrait.setVisible(false); this.ovFrame.clear();
      if (s.ph === 'roundEnd' || s.ph === 'matchEnd') { // pas de message de jeu par-dessus les ecrans de fin
        this.tweens.killTweensOf(this.flashText);
        this.flashText.setAlpha(0);
      }
      var gridH = Sim.H * CELL;
      var gangLabel = function (seat) { return seat >= 0 ? gangOf(self.seats[seat].gang) : null; };

      var meDead = this.seat >= 0 && s.pl[this.seat] && s.pl[this.seat][2] === 2 && s.ph === 'play';
      this.gSpect.clear();
      this.spectText.setText('');
      if (meDead) {
        this.gSpect.fillStyle(0x000000, 0.7).fillRect(0, GAME_H - 70, GAME_W, 52);
        this.gSpect.fillStyle(0xff3a3a, 1).fillRect(0, GAME_H - 70, GAME_W, 3);
        this.spectText.setText('ÉLIMINÉ  •  tu regardes la fin de la manche  •  tu reviens à la prochaine');
      }
      if (s.ph === 'intro') {
        g.fillStyle(0x000000, 0.35).fillRect(OX, OY, Sim.W * CELL, gridH);
        this.ovTitle.setText('MANCHE ' + s.rd).setColor('#ffffff');
        this.ovSub.setText(this.map ? this.map.label : '');
        var sec = Math.max(1, Math.ceil(s.pm / 1000));
        this.ovBig.setText(String(sec)).setColor('#ffd23f');
        if (sec !== this.lastBeep) { this.lastBeep = sec; sfx('beep'); }
      } else if (s.ph === 'roundEnd') {
        this.lastBeep = -1;
        g.fillStyle(0x000000, 0.65).fillRect(OX, OY, Sim.W * CELL, gridH);
        var w = gangLabel(s.rw);
        this.ovTitle.setText(w ? 'MANCHE POUR LE GANG ' + w.label : 'ÉGALITÉ').setColor(w ? hex(w.color) : '#ffffff');
        this.ovSub.setText('MANCHE ' + s.rd + ' / ' + Sim.CFG.maxRounds + '  \u2022  ' +
          (s.rr === 'survie' ? 'DERNIER SURVIVANT' : s.rr === 'territoire' ? 'PLUS GRAND TERRITOIRE' : 'PERSONNE NE L\'EMPORTE'));
        // Cases marquees cette manche (0 si elimine) et total cumule, classement au total
        var tot = arr(s.tot), rs = arr(s.rs), kl = arr(s.kl);
        var order = [0, 1, 2, 3].filter(function (i) { return i < self.seats.length; })
          .sort(function (a, b) { return ((tot[b] || 0) - (tot[a] || 0)) || ((kl[b] || 0) - (kl[a] || 0)); });
        order.forEach(function (seat, k) {
          var gang = gangOf(self.seats[seat].gang), dead = s.pl[seat] && s.pl[seat][2] === 2;
          self.ovLines[k].setText((k + 1) + '.  ' + gang.symbol + ' GANG ' + gang.label + '     ' +
            (dead ? '\u00c9LIMIN\u00c9 : +0' : '+' + (rs[seat] || 0) + ' cases') + '     TOTAL ' + (tot[seat] || 0) + '     KILLS ' + (kl[seat] || 0))
            .setColor(hex(gang.color));
        });
      } else if (s.ph === 'matchEnd') {
        g.fillStyle(0x000000, 0.8).fillRect(0, 0, GAME_W, GAME_H);
        var mw = gangLabel(s.mw);
        this.ovTitle.setText(mw ? 'VICTOIRE DU GANG ' + mw.label : 'ÉGALITÉ PARFAITE').setColor(mw ? hex(mw.color) : '#ffffff');
        if (mw) {
          var gi = Sim.gangIndex(this.seats[s.mw].gang), ph = 330, sc = ph / PORTRAIT_H;
          var pw = PORTRAIT_FRAMES[gi][1] * sc, py = GAME_H / 2 + 50;
          this.ovPortrait.setFrame('p' + gi).setScale(sc).setPosition(GAME_W / 2, py).setVisible(true);
          this.ovFrame.lineStyle(5, mw.color, 1).strokeRect(GAME_W / 2 - pw / 2 - 3, py - ph / 2 - 3, pw + 6, ph + 6);
          this.ovFrame.lineStyle(14, mw.color, 0.25).strokeRect(GAME_W / 2 - pw / 2 - 9, py - ph / 2 - 9, pw + 18, ph + 18);
          this.ovTitle.setY(90); this.ovSub.setY(140);
        }
        // Sous le titre : le nom du perso vainqueur ; en bas : la suite.
        var ws = mw ? this.seats[s.mw] : null;
        var wl = seatLabel(ws);
        this.ovSub.setText(ws ? (wl ? wl + '  \u2022  ' : '') + (arr(s.tot)[s.mw] || 0) + ' CASES AU TOTAL' : '');
        this.ovLines[3].setText(this.mode === 'solo' ? 'ENTRÉE : retour au menu' : 'Retour au salon...').setColor('#d8d8e8').setY(GAME_H - 40);
      }
    }

    /* ---------------------------------------------------------- touches */
    onKeyDown(ev) {
      var d = CODE_DIR[ev.code];
      if (d) {
        if (this.dirStack.indexOf(d) < 0) { this.dirStack.push(d); this.sendDir(); }
        return;
      }
      if (isOk(ev) && !ev.repeat) {
        if (this.mode === 'solo' && this.last && this.last.ph === 'matchEnd') { this.scene.start('MenuScene'); return; }
        if (this.mode === 'solo') Sim.pressBomb(this.sim, this.seat);
        else Net.send('bomb');
      }
    }
    onKeyUp(ev) {
      var d = CODE_DIR[ev.code];
      if (!d) return;
      this.dirStack = this.dirStack.filter(function (x) { return x !== d; });
      this.sendDir();
    }
    /* Direction tenue = derniere touche enfoncee encore tenue. */
    sendDir() {
      var cur = this.dirStack.length ? this.dirStack[this.dirStack.length - 1] : null;
      if (cur === this.lastDir) return;
      this.lastDir = cur;
      if (this.mode === 'solo') Sim.setInput(this.sim, this.seat, cur);
      else Net.send('dir', { d: cur || '' });
    }

    /* Echap : un premier appui previent, le second abandonne la partie. */
    onEscape() {
      var now = performance.now();
      if (now < this.escArmedUntil) {
        this.leaving = true;
        if (this.mode === 'online') { Net.send('leave'); this.scene.start('OnlineScene'); }
        else this.scene.start('MenuScene');
        return true;
      }
      this.escArmedUntil = now + 2500;
      this.flash('ÉCHAP encore pour abandonner', '#ffffff');
      return true;
    }

    update(time, delta) {
      if (this.mode === 'solo' && this.sim) {
        var left = Math.min(delta, 250) * this.speed;
        while (left > 0.5) { var dt = Math.min(left, Sim.TICK_MS); Sim.step(this.sim, dt); left -= dt; }
        this.onSnap(Sim.snapshot(this.sim));
        if (this.sim.finished) {
          if (this.demo) window.FiveCadeGame.startDemo(this.speed, this.cfg); // la demo tourne en boucle
          else this.scene.start('MenuScene');
          return;
        }
      }
      this.drawDynamic(performance.now());
    }
  }

  /* ======================================================================
   * Demarrage + pont avec index.html
   * ====================================================================== */
  var game = new Phaser.Game({
    type: Phaser.AUTO,
    banner: false, // pas de pub Phaser dans la console F8
    parent: 'game-container',
    width: GAME_W,
    height: GAME_H,
    backgroundColor: '#07070c',
    input: { keyboard: false }, // voir routeKey plus bas
    scene: [IdleScene, MenuScene, OnlineScene, RoomScene, GameScene]
  });
  window.__PHASER_GAME__ = game;

  var SCENES = ['MenuScene', 'OnlineScene', 'RoomScene', 'GameScene'];

  /* Rien ne s'affiche avant que les images (portraits, HUD) soient chargees. */
  var assetsReady = false, pendingStart = null;
  function whenReady(fn) { if (assetsReady) fn(); else pendingStart = fn; }

  function activeScene() {
    for (var i = 0; i < SCENES.length; i++) {
      if (game.scene.isActive(SCENES[i])) return game.scene.getScene(SCENES[i]);
    }
    return null;
  }

  /* Clavier : un seul ecouteur DOM pour toutes les pages, route vers la page
   * active. (Le clavier de Phaser, relance a chaque ouverture de la borne,
   * finissait par recevoir chaque touche en double.) Echap est gere par
   * index.html -> consumeEscape. */
  var appEl = document.getElementById('app');
  var GAME_KEYS = /^(Arrow|Space$|Enter$|NumpadEnter$|Backspace$)/;
  function routeKey(ev, method) {
    if (!appEl.classList.contains('visible') || ev.key === 'Escape') return;
    if (method === 'onKeyDown' && window.SWSound) {
      window.SWSound.unlock();
      if (ev.code === 'KeyM' && !ev.repeat && !(document.activeElement && document.activeElement.tagName === 'INPUT')) {
        window.SWSound.toggleMute();
        return;
      }
    }
    if (document.activeElement && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)) return;
    if (GAME_KEYS.test(ev.code)) ev.preventDefault();
    var s = activeScene();
    if (s && s[method]) s[method](ev);
  }
  document.addEventListener('keydown', function (ev) { routeKey(ev, 'onKeyDown'); });
  document.addEventListener('keyup', function (ev) { routeKey(ev, 'onKeyUp'); });

  function stopAll() {
    SCENES.forEach(function (k) { game.scene.stop(k); });
    Net.handler = null; Net.owner = null; Net.earlySnaps = [];
  }

  window.FiveCadeGame = {
    consumeEscape: function () {
      var s = activeScene();
      return !!(s && s.onEscape && s.onEscape());
    },
    onOpen: function (playerName, borneColor) {
      Session.playerName = playerName || '???';
      Session.borneColor = borneColor || 'green';
      stopAll();
      whenReady(function () { game.scene.start('MenuScene'); });
    },
    onClose: function () {
      pendingStart = null;
      music(null);
      stopAll();
      Session.room = null;
    },
    onNet: function (t, d) { Net.dispatch(t, d); },
    /* Demo (previsualisation hors jeu, ?demo=1) : 4 CPU s'affrontent. */
    startDemo: function (speed, cfg) {
      stopAll();
      whenReady(function () { game.scene.start('GameScene', {
        mode: 'solo', seat: -1, demo: true, speed: speed || 1, cfg: cfg || null,
        seats: GANGS.map(function (g) { return { gang: g.id, name: 'CPU', bot: true }; })
      }); });
    }
  };
})();
