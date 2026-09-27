/* ============================================================
 * FiveCade - Borne Space Monkey 3: Bananas Gone Bad (ch_prop_arcade_space_01a)
 * Runner d'esquive a score infini facon Flappy Bird, moteur Phaser 4
 * (charge en local via phaser.min.js). Construit from scratch, comme
 * les autres bornes.
 *
 * Un seul bouton (ESPACE / HAUT / ENTREE / clic) : une impulsion vers le
 * haut, la gravite fait le reste. Le decor defile tout seul.
 *
 * - Bananes : normale (+1), doree (+10, rare, placee pres des
 *   asteroides), pourrie (-5 et casse le combo).
 * - Combo : chaque serie de 5 bananes normales/dorees sans en rater une
 *   fait monter le multiplicateur (x2 ... x5). En rater une le remet a x1.
 * - Asteroides : murs fixes, puis murs mobiles, puis asteroides en
 *   rotation, puis gros asteroides qui se fragmentent - debloques zone
 *   par zone.
 * - Bonus : bouclier (absorbe un choc), nuke (vide l'ecran).
 * - Dr Dank : passe de temps en temps en haut de l'ecran et lache des
 *   bananes pourries.
 * - Zones : la vitesse et la densite montent avec la DISTANCE parcourue
 *   (pas avec le score : sinon eviter les bananes garderait le jeu
 *   facile), avec un changement de couleur du fond a chaque zone.
 *
 * Toutes les textures sont des formes generees par code pour l'instant,
 * remplacables plus tard par les vrais sprites PixelLab sans toucher a
 * la logique (meme approche que les autres bornes a leurs debuts).
 * ============================================================ */

// Hauteur fixe 720, largeur calculee pour remplir exactement la decoupe du
// cadre de borne (bezel.jpg etire plein ecran : decoupe = 71.40% x 65.11% de
// l'ecran, voir index.html) - pas de bandes noires ni de deformation. En
// 1920x1080 : ~1404 px de large, affiche quasiment a l'echelle 1.
var GAME_HEIGHT = 720;
var GAME_WIDTH = (function () {
  try {
    var ratio = (window.innerWidth * 0.7140) / (window.innerHeight * 0.6511);
    if (!isFinite(ratio) || ratio <= 0) return 1400;
    return Math.round(Math.min(Math.max(GAME_HEIGHT * ratio, 1100), 2000) / 2) * 2;
  } catch (e) {
    return 1400;
  }
})();

// --- Singe ---
var MONKEY_X = 330;
var MONKEY_R = 26;            // rayon de collision (volontairement plus petit que la barque : on pardonne les frolements)
var GRAVITY = 1650;           // px/s^2
var FLAP_VY = -540;           // impulsion d'un appui
var MAX_FALL_VY = 760;
var CEILING_Y = 26;           // le haut de l'ecran bloque (pas de mort), le bas tue

// --- Asteroides ---
var ROCK_R = 34;              // rayon d'un bloc de mur
var ROCK_SCALE = 1.2;         // sprites 64 px (rocher ~56 px) -> ~67 px a l'ecran
var ROCK_STEP = 62;           // ecart vertical entre deux blocs d'un mur
var SPINNER_ARM = 115;        // rayon d'orbite des asteroides en rotation
var FRAG_TRIGGER_X = MONKEY_X + 400; // le gros asteroide eclate a cette distance du singe

// --- Bananes / score ---
var BANANA_R = 17;
var PICKUP_R = 20;
var SCORE_NORMAL = 1;
var SCORE_GOLDEN = 10;
var SCORE_ROTTEN = -5;
var COMBO_STEP = 5;           // bananes d'affilee pour gagner un cran de multiplicateur
var COMBO_MAX = 5;
var GOLDEN_CHANCE = 0.12;     // par motif
var ROTTEN_CHANCE = 0.35;     // par motif, a partir de la zone 2
var SHIELD_EVERY = [9, 14];   // un bouclier tous les 9 a 14 motifs
var NUKE_EVERY = [16, 24];    // une nuke tous les 16 a 24 motifs (a partir de la zone 3)

// --- Dr Dank ---
var DANK_UNLOCK_DIST = 12000;
var DANK_GAP_MS = [32000, 50000];
var DANK_WARN_MS = 1800;
var DANK_CROSS_MS = 5200;
var DANK_BANANA_VY = 170;     // vitesse de chute des bananes lachees
var DANK_DROP_AHEAD = 200;    // ne largue qu'une fois cette avance prise sur le singe
var DANK_MAX_DROPS = 6;       // bananes max par passage
var DANK_MIN_ARRIVAL_GAP = 750; // ms minimum entre deux bananes qui atteignent la colonne du singe
var DANK_CLEAR_MAX_MS = 7000; // attente max que les derniers murs soient passes
var DANK_FIELD_R = 80;        // rayon du champ de force de la soucoupe
/* Le singe ne se deplace QUE verticalement (x fixe = MONKEY_X) : chaque
 * banane doit donc etre esquivable en montant/descendant seulement.
 *  - Une banane lachee en x_d rejoint la colonne du singe apres
 *    (x_d - MONKEY_X) / vitesse_du_decor secondes, en tombant de
 *    DANK_BANANA_VY px/s pendant ce temps : on connait a l'avance QUAND et a
 *    QUELLE HAUTEUR elle traversera. Un largage est refuse si la banane
 *    arriverait moins de DANK_MIN_ARRIVAL_GAP apres la precedente (jamais
 *    deux a la fois : le singe monte au mieux ~540 px/s, redescend 200 px
 *    en ~0.5 s) ou si elle passerait sous l'ecran (inutile).
 *  - Pendant l'attaque, aucun mur d'asteroides ne sort (sinon une banane
 *    pourrait tomber pile dans le trou d'un mur : penalite inevitable). On
 *    attend que les derniers murs soient passes derriere le singe, puis
 *    l'alerte sonne.
 *  - Le Dr Dank arrive par la GAUCHE et depasse le singe (dans l'autre sens,
 *    a ~la vitesse du decor, ses bananes s'empilaient en colonne : vu en
 *    jeu). Sa soucoupe a un champ de force qui pulverise les asteroides
 *    qu'elle touche : c'est ce qui justifie qu'il les traverse. */

// --- Zones (distance en px ; la vitesse est en px/s) ---
var ZONES = [
  { from: 0,     name: 'ORBITE BASSE',          bg: 0x0a0b26, nebula: 0x3a4dff, speed: 250, spacing: 460, gap: 250, types: ['wall'] },
  { from: 8000,  name: 'CEINTURE D\'ASTEROIDES', bg: 0x1a0a2c, nebula: 0xb03aff, speed: 285, spacing: 440, gap: 235, types: ['wall', 'wall', 'moving'] },
  { from: 18000, name: 'NEBULEUSE BANANE',       bg: 0x241a06, nebula: 0xffc23a, speed: 320, spacing: 425, gap: 225, types: ['wall', 'moving', 'spinner'] },
  { from: 30000, name: 'LABO DU DR DANK',        bg: 0x06200f, nebula: 0x3aff7a, speed: 355, spacing: 410, gap: 215, types: ['wall', 'moving', 'spinner', 'frag'] },
  { from: 44000, name: 'TROU NOIR',              bg: 0x14030a, nebula: 0xff3a5e, speed: 390, spacing: 400, gap: 205, types: ['moving', 'spinner', 'frag', 'wall'] }
];
// Au-dela de la derniere zone : +12 px/s tous les 16000 px, plafonne.
var OVERTIME_STEP = 16000;
var OVERTIME_SPEED = 12;
var MAX_SPEED = 480;
var MIN_GAP = 190;

// --- Classement (regle commune a toutes les bornes FiveCade) ---
var SCORES_VISIBLE = 10;
var LEADERBOARD_SIZE = 25;
var latestLeaderboard = null;

var COLORS = {
  ui: '#ffd63a',
  uiDark: '#2a1400',
  text: '#fff3c4',
  combo: '#7affc8',
  bad: '#ff5a7a'
};

function safeCall(fn) {
  try { fn(); } catch (e) { /* ignore - contexte hors FiveM/preview */ }
}
function playSfx(name, opts) {
  if (window.FiveCadeSound) safeCall(function () { window.FiveCadeSound.play(name, opts); });
}
function playMusic(name) {
  if (window.FiveCadeSound) safeCall(function () { window.FiveCadeSound.startMusic(name); });
}
function stopMusic() {
  if (window.FiveCadeSound) safeCall(function () { window.FiveCadeSound.stopMusic(); });
}
function randRange(pair) {
  return Phaser.Math.Between(pair[0], pair[1]);
}

function zoneIndexAt(dist) {
  var idx = 0;
  for (var i = 0; i < ZONES.length; i += 1) if (dist >= ZONES[i].from) idx = i;
  return idx;
}

/* Parametres effectifs a une distance donnee (vitesse, ecart, trou). */
function paramsAt(dist) {
  var z = ZONES[zoneIndexAt(dist)];
  var last = ZONES[ZONES.length - 1];
  var extra = 0;
  if (dist > last.from) extra = Math.floor((dist - last.from) / OVERTIME_STEP);
  return {
    speed: Math.min(MAX_SPEED, z.speed + extra * OVERTIME_SPEED),
    spacing: Math.max(360, z.spacing - extra * 8),
    gap: Math.max(MIN_GAP, z.gap - extra * 4),
    types: z.types
  };
}

/* Champ d'etoiles a 3 couches (parallaxe), partage par les 3 scenes. */
function createStarfield(scene) {
  var layers = [];
  [[70, 1, 0.12, 0.45], [45, 2, 0.3, 0.7], [18, 3, 0.6, 1]].forEach(function (cfg) {
    var stars = [];
    for (var i = 0; i < cfg[0]; i += 1) {
      stars.push(scene.add.rectangle(
        Phaser.Math.Between(0, GAME_WIDTH), Phaser.Math.Between(0, GAME_HEIGHT),
        cfg[1], cfg[1], 0xffffff, cfg[3]));
    }
    layers.push({ stars: stars, factor: cfg[2] });
  });
  return {
    update: function (dx) {
      layers.forEach(function (l) {
        l.stars.forEach(function (s) {
          s.x -= dx * l.factor;
          if (s.x < -4) { s.x += GAME_WIDTH + 8; s.y = Phaser.Math.Between(0, GAME_HEIGHT); }
        });
      });
    }
  };
}

/* ============================================================
 * BootScene - textures provisoires generees par code
 * ============================================================ */
class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
  }

  /* Sprites PixelLab (voir art_sources/space_monkey) regroupes en quelques
   * planches pour limiter le nombre de fichiers telecharges par FiveM. */
  preload() {
    this.load.image('hero', 'sprites/hero.png');
    this.load.image('dank', 'sprites/dank.png');
    this.load.spritesheet('rocks', 'sprites/rocks.png', { frameWidth: 64, frameHeight: 64 });       // 0-7 murs, 8 eclat
    this.load.spritesheet('rockbig', 'sprites/rockbig.png', { frameWidth: 128, frameHeight: 128 }); // 4 etapes de fissure
    this.load.spritesheet('items', 'sprites/items.png', { frameWidth: 32, frameHeight: 32 });       // 0 banane, 1 doree, 2-5 pourries
    this.load.spritesheet('pickups', 'sprites/pickups.png', { frameWidth: 64, frameHeight: 64 });   // 0 bouclier, 1 nuke
    this.load.image('menu-bg', 'menu_bg.jpg');
  }

  create() {
    this.makeGlow('tex-glow', 64);
    // Le fond d'accueil est une illustration (pas du pixel art) : lissage.
    this.textures.get('menu-bg').setFilter(Phaser.Textures.FilterMode.LINEAR);

    window.__fivecadeBootComplete = true;
    // Meme garde-fou que les autres bornes : ne demarrer le menu que si une
    // vraie ouverture a deja ete demandee (pas de son avant l'ouverture).
    if (window.__fivecadeBorneOpenRequested) {
      this.scene.start('MenuScene');
    }
  }

  makeGlow(key, r) {
    var g = this.add.graphics();
    for (var i = r; i > 0; i -= 2) {
      g.fillStyle(0xffffff, 0.04).fillCircle(r, r, i);
    }
    g.generateTexture(key, r * 2, r * 2);
    g.destroy();
  }
}

/* ============================================================
 * MenuScene - NOUVELLE PARTIE / MEILLEURS SCORES / QUITTER
 * ============================================================ */
class MenuScene extends Phaser.Scene {
  constructor() {
    super('MenuScene');
  }

  create() {
    // Fond : l'illustration d'accueil fournie par l'utilisateur (1747x900,
    // meme proportions que la decoupe du cadre), en couverture complete.
    this.cameras.main.setBackgroundColor('#0a0310');
    var bg = this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'menu-bg');
    bg.setScale(Math.max(GAME_WIDTH / bg.width, GAME_HEIGHT / bg.height));

    // Menu dans un panneau sombre a gauche (le titre et le Dr Dank occupent
    // le centre de l'illustration).
    var px = 150, py = GAME_HEIGHT * 0.62;
    this.add.rectangle(px, py, 270, 236, 0x0a0310, 0.78).setStrokeStyle(3, 0xffd63a, 0.9);
    var items = ['JOUER', 'SCORES', 'VOLUME', 'QUITTER'];
    var self = this;
    this.itemTexts = items.map(function (label, i) {
      var t = self.add.text(px + 12, py - 78 + i * 52, label, {
        fontFamily: 'monospace', fontSize: '32px', color: '#ffffff', fontStyle: 'bold',
        stroke: '#10051f', strokeThickness: 6
      }).setOrigin(0.5).setInteractive({ useHandCursor: true });
      t.on('pointerover', function () { self.setSelected(i); });
      t.on('pointerdown', function () { self.activate(i); });
      return t;
    });
    this.cursorMark = this.add.text(0, 0, '>', {
      fontFamily: 'monospace', fontSize: '32px', color: COLORS.ui, fontStyle: 'bold',
      stroke: '#10051f', strokeThickness: 6
    }).setOrigin(0.5);
    this.tweens.add({ targets: this.cursorMark, alpha: 0.35, duration: 380, yoyo: true, repeat: -1 });
    this.selected = 0;
    this.setSelected(0);

    // Regles, dans un panneau a droite (symetrique du menu)
    var rx = GAME_WIDTH - 150;
    this.add.rectangle(rx, py, 270, 200, 0x0a0310, 0.78).setStrokeStyle(3, 0xffd63a, 0.9);
    this.add.image(rx - 100, py - 62, 'items', 0).setScale(1.2);
    this.add.image(rx - 100, py - 22, 'items', 1).setScale(1.2);
    this.add.image(rx - 100, py + 18, 'items', 2).setScale(1.2);
    this.add.image(rx - 100, py + 60, 'rocks', 0).setScale(0.55);
    var rs = { fontFamily: 'monospace', fontSize: '17px', color: COLORS.text, fontStyle: 'bold', stroke: '#10051f', strokeThickness: 3 };
    this.add.text(rx - 76, py - 62, '+1', rs).setOrigin(0, 0.5);
    this.add.text(rx - 76, py - 22, '+10', rs).setOrigin(0, 0.5);
    this.add.text(rx - 76, py + 18, '-5, casse le combo', rs).setOrigin(0, 0.5);
    this.add.text(rx - 76, py + 60, 'a eviter !', rs).setOrigin(0, 0.5);

    // Controles en une ligne, tout en bas
    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT - 16, GAME_WIDTH, 32, 0x0a0310, 0.75);
    this.add.text(GAME_WIDTH / 2, GAME_HEIGHT - 16,
      "ESPACE / HAUT propulser  -  5 bananes d'affilee = multiplicateur  -  M son  -  FLECHES + ENTREE menu", {
        fontFamily: 'monospace', fontSize: '15px', color: COLORS.text
      }).setOrigin(0.5);

    this.input.keyboard.on('keydown', function (ev) { this.onMenuKey(ev.key); }, this);
    this.scoresPanel = null;
    this.scoresListText = null;

    window.FiveCadeGame._registerMenuScene(this);
    playMusic('menu');
    safeCall(function () { window.FiveCadeBridge.requestScores(); });
  }

  setSelected(i) {
    this.selected = i;
    this.itemTexts.forEach(function (t, idx) {
      t.setColor(idx === i ? COLORS.ui : '#ffffff');
    });
    var t = this.itemTexts[i];
    this.cursorMark.setPosition(t.x - t.width / 2 - 26, t.y);
  }

  activate(i) {
    if (this.scoresPanel) return; // le panneau scores absorbe les entrees le temps qu'il est ouvert
    if (i === 0) {
      this.scene.start('MainScene');
    } else if (i === 1) {
      this.toggleScores();
    } else if (i === 2) {
      // Reglage du volume (volume.js, regle commune a toutes les bornes)
      if (window.FiveCadeVolume) window.FiveCadeVolume.open();
    } else {
      safeCall(function () { window.FiveCadeBridge.quit(); });
    }
  }

  /* Navigation sur les EVENEMENTS clavier (jamais Keyboard.JustDown :
   * une frappe tres breve serait perdue - voir regle commune FiveCade). */
  onMenuKey(key) {
    if (this.scoresPanel) {
      if (key === 'ArrowUp') { this.scrollScores(-1); return; }
      if (key === 'ArrowDown') { this.scrollScores(1); return; }
      if (key === 'PageUp') { this.scrollScores(-SCORES_VISIBLE); return; }
      if (key === 'PageDown') { this.scrollScores(SCORES_VISIBLE); return; }
      if (['Enter', ' ', 'Backspace', 'ArrowLeft', 'ArrowRight'].indexOf(key) >= 0) {
        this.closeScores();
        playSfx('menuMove');
      }
      return;
    }
    if (key === 'ArrowUp' || key === 'ArrowLeft') {
      this.setSelected((this.selected + this.itemTexts.length - 1) % this.itemTexts.length);
      playSfx('menuMove');
    } else if (key === 'ArrowDown' || key === 'ArrowRight') {
      this.setSelected((this.selected + 1) % this.itemTexts.length);
      playSfx('menuMove');
    } else if (key === 'Enter' || key === ' ') {
      playSfx('menuConfirm');
      this.activate(this.selected);
    }
  }

  /* Panneau des meilleurs scores DEROULANT (Top 25) : SCORES_VISIBLE lignes,
   * HAUT/BAS ou molette pour defiler, barre a droite. */
  toggleScores() {
    if (this.scoresPanel) {
      this.closeScores();
      return;
    }
    var cx = GAME_WIDTH / 2, cy = GAME_HEIGHT / 2;
    this.scoresList = null;
    this.scoresScroll = 0;
    this.scoresPanel = this.add.rectangle(cx, cy, 540, 470, 0x10051f, 0.96)
      .setStrokeStyle(3, 0xffd63a).setInteractive();
    this.scoresPanel.on('pointerdown', function () { this.closeScores(); }, this);
    this.scoresTitle = this.add.text(cx, cy - 200, 'MEILLEURS SCORES', {
      fontFamily: 'monospace', fontSize: '22px', color: COLORS.ui, fontStyle: 'bold'
    }).setOrigin(0.5);
    this.scoresListText = this.add.text(cx - 230, cy - 162, 'Chargement...', {
      fontFamily: 'monospace', fontSize: '18px', color: '#ffffff', lineSpacing: 8
    }).setOrigin(0, 0);
    this.scoresTrack = this.add.rectangle(cx + 246, cy - 162, 6, SCORES_VISIBLE * 30, 0x3a2a55).setOrigin(0.5, 0).setVisible(false);
    this.scoresThumb = this.add.rectangle(cx + 246, cy - 162, 6, 40, 0xffd63a).setOrigin(0.5, 0).setVisible(false);
    this.scoresBackHint = this.add.text(cx, cy + 208, 'HAUT/BAS defiler  -  ENTREE ou ECHAP pour revenir', {
      fontFamily: 'monospace', fontSize: '14px', color: COLORS.ui
    }).setOrigin(0.5);
    this.scoresWheel = function (pointer, over, dx, dy) { this.scrollScores(dy > 0 ? 3 : -3); };
    this.input.on('wheel', this.scoresWheel, this);
    if (this.latestScores) this.onScoresUpdated(this.latestScores);
    safeCall(function () { window.FiveCadeBridge.requestScores(); });
  }

  closeScores() {
    var self = this;
    ['scoresPanel', 'scoresTitle', 'scoresListText', 'scoresTrack', 'scoresThumb', 'scoresBackHint'].forEach(function (k) {
      if (self[k]) { self[k].destroy(); self[k] = null; }
    });
    if (this.scoresWheel) { this.input.off('wheel', this.scoresWheel, this); this.scoresWheel = null; }
  }

  scrollScores(delta) {
    if (!this.scoresList) return;
    var maxScroll = Math.max(0, this.scoresList.length - SCORES_VISIBLE);
    var next = Phaser.Math.Clamp(this.scoresScroll + delta, 0, maxScroll);
    if (next === this.scoresScroll) return;
    this.scoresScroll = next;
    playSfx('menuMove');
    this.renderScores();
  }

  renderScores() {
    if (!this.scoresListText) return;
    var list = this.scoresList;
    if (!list || list.length === 0) {
      this.scoresListText.setText('Aucun score pour le moment.');
      this.scoresTrack.setVisible(false);
      this.scoresThumb.setVisible(false);
      return;
    }
    var from = this.scoresScroll;
    var lines = list.slice(from, from + SCORES_VISIBLE).map(function (sc, i) {
      var rank = (from + i + 1) + '.';
      var name = String(sc.name || '???').slice(0, 16);
      return rank.padEnd(4, ' ') + ' ' + name.padEnd(17, '.') + ' ' + String(sc.score).padStart(7, ' ');
    });
    this.scoresListText.setText(lines.join('\n'));
    var scrollable = list.length > SCORES_VISIBLE;
    this.scoresTrack.setVisible(scrollable);
    this.scoresThumb.setVisible(scrollable);
    if (scrollable) {
      var trackH = SCORES_VISIBLE * 30;
      var thumbH = Math.max(24, trackH * SCORES_VISIBLE / list.length);
      var t = from / (list.length - SCORES_VISIBLE);
      this.scoresThumb.height = thumbH;
      this.scoresThumb.y = this.scoresTrack.y + (trackH - thumbH) * t;
    }
  }

  onScoresUpdated(scores) {
    this.latestScores = scores || [];
    if (!this.scoresListText) return;
    this.scoresList = this.latestScores;
    this.scoresScroll = Math.min(this.scoresScroll || 0, Math.max(0, this.scoresList.length - SCORES_VISIBLE));
    this.renderScores();
  }
}

/* ============================================================
 * MainScene - la partie
 * ============================================================ */
class MainScene extends Phaser.Scene {
  constructor() {
    super('MainScene');
  }

  create() {
    window.FiveCadeGame._registerMainScene(this);
    playMusic('game');

    this.dist = 0;               // distance parcourue (px)
    this.nextPatternAt = 700;    // premier motif un peu apres le depart
    this.zoneIdx = 0;
    this.score = 0;
    this.streak = 0;             // bananes d'affilee (normales + dorees)
    this.mult = 1;
    this.bestMult = 1;
    this.bananasEaten = 0;
    this.shield = false;
    this.started = false;        // attend le premier appui (comme Flappy Bird)
    this.dead = false;
    this.gameOver = false;
    this.patternCount = 0;
    this.nextShieldIn = randRange(SHIELD_EVERY);
    this.nextNukeIn = randRange(NUKE_EVERY);
    this.nextDankAt = null;      // horodatage (ms de partie) du prochain passage
    this.playTime = 0;
    this.dank = null;

    this.rocks = [];     // { img, r, x, y, update(dt), alive }
    this.items = [];     // { img, kind, x, y, vy, r, counts }

    // Fond : couleur de zone + nebuleuse + etoiles
    this.cameras.main.setBackgroundColor(ZONES[0].bg);
    this.bgColor = Phaser.Display.Color.IntegerToColor(ZONES[0].bg);
    this.nebula = this.add.image(GAME_WIDTH * 0.75, GAME_HEIGHT * 0.35, 'tex-glow').setScale(10).setTint(ZONES[0].nebula).setAlpha(0.3);
    this.stars = createStarfield(this);

    this.rockLayer = this.add.container(0, 0);
    this.itemLayer = this.add.container(0, 0);

    // Singe
    this.monkey = this.add.image(MONKEY_X, GAME_HEIGHT / 2 - 40, 'hero').setScale(1.1);
    this.monkeyVy = 0;
    this.shieldRing = this.add.circle(MONKEY_X, this.monkey.y, 62).setStrokeStyle(4, 0x3ad6ff, 0.9).setFillStyle(0x3ad6ff, 0.12).setVisible(false);
    this.hoverTween = this.tweens.add({ targets: this.monkey, y: this.monkey.y - 14, duration: 520, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });

    // Flammes du reacteur (particules maison, simples rectangles)
    this.puffs = [];

    this.createHud();
    this.showGetReady();

    // Controles : evenement clavier (une frappe = une impulsion, jamais perdue)
    this.input.keyboard.on('keydown', function (ev) {
      if (ev.repeat) return;
      if (ev.key === ' ' || ev.key === 'ArrowUp' || ev.key === 'Enter' || ev.key === 'w' || ev.key === 'W' || ev.key === 'z' || ev.key === 'Z') {
        this.flap();
      }
    }, this);
    this.input.on('pointerdown', function () { this.flap(); }, this);
  }

  /* ---------------- HUD ---------------- */
  createHud() {
    var style = { fontFamily: 'monospace', fontStyle: 'bold', stroke: '#10051f', strokeThickness: 6 };
    this.scoreText = this.add.text(GAME_WIDTH / 2, 20, '0', Object.assign({ fontSize: '48px', color: COLORS.ui }, style)).setOrigin(0.5, 0).setDepth(10);
    this.multText = this.add.text(GAME_WIDTH / 2 + 110, 34, '', Object.assign({ fontSize: '30px', color: COLORS.combo }, style)).setOrigin(0, 0).setDepth(10);
    // jauge du combo : 5 pastilles sous le score
    this.comboDots = [];
    for (var i = 0; i < COMBO_STEP; i += 1) {
      this.comboDots.push(this.add.circle(GAME_WIDTH / 2 - 48 + i * 24, 90, 7, 0x3a2a55).setStrokeStyle(2, 0x10051f).setDepth(10));
    }
    this.zoneText = this.add.text(20, 16, ZONES[0].name, Object.assign({ fontSize: '18px', color: COLORS.text }, style, { strokeThickness: 4 })).setDepth(10);
    this.distText = this.add.text(GAME_WIDTH - 20, 16, '0 m', Object.assign({ fontSize: '20px', color: COLORS.text }, style, { strokeThickness: 4 })).setOrigin(1, 0).setDepth(10);
    this.shieldIcon = this.add.text(GAME_WIDTH - 20, 44, 'BOUCLIER', Object.assign({ fontSize: '16px', color: '#3ad6ff' }, style, { strokeThickness: 4 })).setOrigin(1, 0).setDepth(10).setVisible(false);
    this.updateHud();
  }

  updateHud() {
    this.scoreText.setText(String(this.score));
    this.multText.setText(this.mult > 1 ? 'x' + this.mult : '');
    var filled = this.mult >= COMBO_MAX ? COMBO_STEP : this.streak % COMBO_STEP;
    for (var i = 0; i < COMBO_STEP; i += 1) {
      this.comboDots[i].setFillStyle(i < filled ? 0x7affc8 : 0x3a2a55);
    }
    this.distText.setText(Math.floor(this.dist / 50) + ' m');
    this.shieldIcon.setVisible(this.shield);
  }

  showGetReady() {
    this.readyText = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 40, 'PRET ?', {
      fontFamily: 'monospace', fontSize: '56px', color: COLORS.ui, fontStyle: 'bold', stroke: '#10051f', strokeThickness: 8
    }).setOrigin(0.5).setDepth(10);
    this.readyHint = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 20, 'ESPACE pour propulser le singe', {
      fontFamily: 'monospace', fontSize: '22px', color: COLORS.text, stroke: '#10051f', strokeThickness: 4
    }).setOrigin(0.5).setDepth(10);
    this.tweens.add({ targets: this.readyHint, alpha: 0.3, duration: 450, yoyo: true, repeat: -1 });
  }

  banner(text, color, sub) {
    var t = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 150, text, {
      fontFamily: 'monospace', fontSize: '40px', color: color, fontStyle: 'bold', stroke: '#10051f', strokeThickness: 8
    }).setOrigin(0.5).setDepth(11).setScale(0.6).setAlpha(0);
    var parts = [t];
    if (sub) {
      parts.push(this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 105, sub, {
        fontFamily: 'monospace', fontSize: '20px', color: COLORS.text, stroke: '#10051f', strokeThickness: 4
      }).setOrigin(0.5).setDepth(11).setAlpha(0));
    }
    this.tweens.add({ targets: parts, alpha: 1, scale: 1, duration: 250, ease: 'Back.easeOut' });
    this.tweens.add({ targets: parts, alpha: 0, delay: 1700, duration: 400, onComplete: function () { parts.forEach(function (p) { p.destroy(); }); } });
  }

  floatText(x, y, text, color) {
    var t = this.add.text(x, y, text, {
      fontFamily: 'monospace', fontSize: '22px', color: color, fontStyle: 'bold', stroke: '#10051f', strokeThickness: 5
    }).setOrigin(0.5).setDepth(9);
    this.tweens.add({ targets: t, y: y - 50, alpha: 0, duration: 700, onComplete: function () { t.destroy(); } });
  }

  /* ---------------- Controles ---------------- */
  flap() {
    if (this.dead) return;
    if (!this.started) {
      this.started = true;
      this.hoverTween.stop();
      this.readyText.destroy();
      this.readyHint.destroy();
      this.nextDankAt = null;
    }
    this.monkeyVy = FLAP_VY;
    playSfx('flap');
    // bouffee du reacteur sous/derriere la planche
    for (var i = 0; i < 4; i += 1) {
      var p = this.add.rectangle(this.monkey.x - 52, this.monkey.y + 24, 6, 6, Phaser.Math.RND.pick([0x7ad6ff, 0x3a8aff, 0xffffff]));
      this.tweens.add({
        targets: p, x: p.x - Phaser.Math.Between(30, 70), y: p.y + Phaser.Math.Between(10, 40), alpha: 0, scale: 0.3,
        duration: Phaser.Math.Between(250, 420), onComplete: (function (o) { return function () { o.destroy(); }; })(p)
      });
    }
  }

  /* ---------------- Generation ---------------- */
  spawnPattern() {
    var prm = paramsAt(this.dist);
    var type = Phaser.Math.RND.pick(prm.types);
    var x = GAME_WIDTH + 80;
    var gap = prm.gap;
    // centre du passage : jamais trop loin du precedent (sinon injouable a
    // grande vitesse), et toujours dans l'ecran
    var prev = this.lastGapY || GAME_HEIGHT / 2;
    var gapY = Phaser.Math.Clamp(prev + Phaser.Math.Between(-190, 190), 60 + gap / 2, GAME_HEIGHT - 60 - gap / 2);
    this.lastGapY = gapY;
    this.patternCount += 1;

    if (type === 'wall' || type === 'moving') {
      this.spawnWall(x, gapY, gap, type === 'moving');
      this.spawnBananaArc(x, gapY, 3);
      if (Math.random() < GOLDEN_CHANCE) {
        // doree collee au bord du passage : il faut raser l'asteroide
        var edge = Math.random() < 0.5 ? -1 : 1;
        this.spawnItem('golden', x + 55, gapY + edge * (gap / 2 - 26), type === 'moving' ? this.lastWall : null);
      }
    } else if (type === 'spinner') {
      this.lastWall = null;
      this.spawnSpinner(x + 60, gapY);
      // bananes au-dessus ou en dessous du moulinet
      var side = gapY < GAME_HEIGHT / 2 ? 1 : -1;
      var by = gapY + side * (SPINNER_ARM + 80);
      this.lastGapY = by;
      this.spawnBananaArc(x + 60, by, 3);
      if (Math.random() < GOLDEN_CHANCE * 1.5) this.spawnItem('golden', x + 60, gapY, null); // au centre du moulinet !
    } else if (type === 'frag') {
      this.lastWall = null;
      this.spawnFragmenter(x + 40, gapY);
      var fy = gapY < GAME_HEIGHT / 2 ? gapY + 200 : gapY - 200;
      this.lastGapY = fy;
      this.spawnBananaArc(x + 40, fy, 3);
    }

    // Entre deux motifs : banane pourrie (hors de la ligne), bonus
    var midX = x + prm.spacing / 2;
    if (this.zoneIdx >= 1 && Math.random() < ROTTEN_CHANCE) {
      var ry = Phaser.Math.Clamp(this.lastGapY + Phaser.Math.RND.pick([-120, 120]), 70, GAME_HEIGHT - 70);
      this.spawnItem('rotten', midX, ry, null);
    } else {
      this.spawnItem('normal', midX, this.lastGapY, null);
    }
    this.nextShieldIn -= 1;
    this.nextNukeIn -= 1;
    if (this.nextShieldIn <= 0 && !this.shield) {
      this.nextShieldIn = randRange(SHIELD_EVERY);
      this.spawnItem('shield', midX + 40, this.lastGapY, null);
    } else if (this.nextNukeIn <= 0 && this.zoneIdx >= 2) {
      this.nextNukeIn = randRange(NUKE_EVERY);
      this.spawnItem('nuke', midX + 40, this.lastGapY, null);
    }
  }

  /* frame = image de la planche (rocks : 0-7 murs, 8 eclat ; rockbig : 0-3). */
  addRock(tex, frame, x, y, r, scale) {
    var img = this.add.image(x, y, tex, frame).setScale(scale || 1).setAngle(Phaser.Math.Between(0, 359));
    this.rockLayer.add(img);
    var rock = { img: img, r: r, x: x, y: y, vx: 0, vy: 0, spin: Phaser.Math.FloatBetween(-40, 40), alive: true, update: null };
    this.rocks.push(rock);
    return rock;
  }

  /* Mur vertical d'asteroides avec un passage. moving = le mur entier
   * oscille de haut en bas (le passage aussi). */
  spawnWall(x, gapY, gap, moving) {
    var rocks = [];
    var top = gapY - gap / 2, bottom = gapY + gap / 2;
    // on prolonge au-dela de l'ecran pour que l'oscillation ne revele pas de trou
    for (var y = top - ROCK_R; y > -260; y -= ROCK_STEP) rocks.push(this.addRock('rocks', Phaser.Math.Between(0, 7), x + Phaser.Math.Between(-6, 6), y, ROCK_R, ROCK_SCALE));
    for (var y2 = bottom + ROCK_R; y2 < GAME_HEIGHT + 260; y2 += ROCK_STEP) rocks.push(this.addRock('rocks', Phaser.Math.Between(0, 7), x + Phaser.Math.Between(-6, 6), y2, ROCK_R, ROCK_SCALE));
    this.lastWall = null;
    if (moving) {
      var amp = Math.min(110, gapY - gap / 2 - 30, GAME_HEIGHT - 30 - gapY - gap / 2);
      amp = Math.max(50, amp);
      var wall = { t: Math.random() * 6, amp: amp, speed: Phaser.Math.FloatBetween(1.4, 2.1), offset: 0 };
      rocks.forEach(function (r) {
        r.baseY = r.y;
        r.update = function (dt) { r.y = r.baseY + wall.offset; };
      });
      wall.tick = function (dt) { wall.t += dt * wall.speed; wall.offset = Math.sin(wall.t) * wall.amp; };
      rocks[0].update = (function (first) {
        return function (dt) { wall.tick(dt); first.y = first.baseY + wall.offset; };
      })(rocks[0]);
      this.lastWall = wall;
    }
  }

  /* Moulinet : un gros asteroide au centre, deux petits en orbite. */
  spawnSpinner(x, y) {
    var core = this.addRock('rocks', Phaser.Math.Between(0, 7), x, y, ROCK_R, ROCK_SCALE);
    var state = { a: Math.random() * Math.PI * 2, speed: Phaser.Math.RND.pick([-1, 1]) * Phaser.Math.FloatBetween(1.6, 2.4) };
    [0, Math.PI].forEach(function (off, i) {
      var r = this.addRock('rocks', Phaser.Math.Between(0, 7), x, y, 22, 0.72);
      r.update = function (dt) {
        if (i === 0) state.a += dt * state.speed;
        r.y = core.y + Math.sin(state.a + off) * SPINNER_ARM;
        r.dx = Math.cos(state.a + off) * SPINNER_ARM; // decalage horizontal par rapport au coeur
      };
      r.follow = core;
    }, this);
  }

  /* Gros asteroide qui fonce un peu plus vite que le decor, se fissure,
   * puis eclate en 4 fragments quand il approche du singe. */
  spawnFragmenter(x, y) {
    var big = this.addRock('rockbig', 0, x, y, 58, 1.2);
    big.img.setAngle(0);
    big.spin = 10;
    big.vx = -60;
    big.cracked = false;
    var scene = this;
    big.update = function () {
      // 4 etapes de fissure (images de la planche) avant l'eclatement
      var stage = Phaser.Math.Clamp(Math.floor((FRAG_TRIGGER_X + 420 - big.x) / 140), 0, 3);
      if (stage !== big.stage) {
        big.stage = stage;
        big.img.setFrame(stage);
        if (stage === 3) scene.tweens.add({ targets: big.img, scale: 1.3, duration: 70, yoyo: true, repeat: 3 });
      }
      if (big.x < FRAG_TRIGGER_X) {
        big.alive = false;
        scene.burst(big.x, big.y, 0xc99a80, 14);
        [[-120, -210], [-120, 210], [-40, -120], [-40, 120]].forEach(function (v) {
          var f = scene.addRock('rocks', 8, big.x, big.y, 22, 1.1);
          f.vx = v[0]; f.vy = v[1];
        });
      }
    };
  }

  /* Arc de bananes (3 a 5) centre sur le passage. */
  spawnBananaArc(x, y, n) {
    for (var i = 0; i < n; i += 1) {
      var k = i - (n - 1) / 2;
      this.spawnItem('normal', x + k * 70, y - 18 + Math.abs(k) * 18, this.lastWall);
    }
  }

  spawnItem(kind, x, y, followWall) {
    var frames = { normal: ['items', 0], golden: ['items', 1], rotten: ['items', Phaser.Math.Between(2, 5)], shield: ['pickups', 0], nuke: ['pickups', 1] }[kind];
    var img = this.add.image(x, y, frames[0], frames[1]).setScale(kind === 'shield' || kind === 'nuke' ? 0.85 : 1.35);
    this.itemLayer.add(img);
    var item = { img: img, kind: kind, x: x, y: y, baseY: y, vy: 0, r: kind === 'shield' || kind === 'nuke' ? PICKUP_R : BANANA_R, wall: followWall, alive: true, label: null };
    if (kind === 'golden') {
      img.setScale(1.55);
      item.glow = this.add.image(x, y, 'tex-glow').setScale(0.9).setTint(0xffd63a).setAlpha(0.6).setBlendMode(Phaser.BlendModes.ADD);
      this.itemLayer.addAt(item.glow, 0);
    }
    item.phase = Math.random() * 6;
    this.items.push(item);
    return item;
  }

  burst(x, y, color, n) {
    for (var i = 0; i < n; i += 1) {
      var p = this.add.rectangle(x, y, 7, 7, color);
      var a = Math.random() * Math.PI * 2, d = Phaser.Math.Between(40, 120);
      this.tweens.add({
        targets: p, x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, alpha: 0, angle: 180,
        duration: Phaser.Math.Between(300, 600), onComplete: (function (o) { return function () { o.destroy(); }; })(p)
      });
    }
  }

  /* ---------------- Dr Dank ---------------- */
  scheduleDank() {
    this.nextDankAt = this.playTime + randRange(DANK_GAP_MS);
  }

  startDank() {
    // 1re etape : plus de nouveaux murs, on attend que les derniers passent
    this.dank = { phase: 'clear', t: 0, img: null, field: null, drops: 0, lastArrival: -1e9 };
  }

  updateDank(dt, speed) {
    var d = this.dank;
    d.t += dt * 1000;
    if (d.phase === 'clear') {
      var self = this;
      var blocking = this.rocks.some(function (r) { return r.alive && r.img.x + r.r > MONKEY_X - 40; });
      if (!blocking || d.t >= DANK_CLEAR_MAX_MS) {
        d.phase = 'warn';
        d.t = 0;
        playSfx('dankAlarm');
        this.banner('ALERTE : DR DANK !', COLORS.bad, 'evite ses bananes pourries');
      }
      return;
    }
    if (d.phase === 'warn') {
      if (d.t >= DANK_WARN_MS) {
        d.phase = 'cross';
        d.t = 0;
        d.field = this.add.circle(-90, 86, DANK_FIELD_R, 0x3aff7a, 0.12).setStrokeStyle(3, 0x3aff7a, 0.85).setDepth(5);
        this.tweens.add({ targets: d.field, alpha: 0.55, duration: 180, yoyo: true, repeat: -1 });
        d.img = this.add.image(-90, 86, 'dank').setScale(1.1).setFlipX(true).setDepth(5); // tourne vers la droite
      }
      return;
    }
    var k = d.t / DANK_CROSS_MS;
    d.img.x = -90 + k * (GAME_WIDTH + 260);
    d.img.y = 86 + Math.sin(d.t / 260) * 16;
    d.field.setPosition(d.img.x, d.img.y + 6);

    // Champ de force : pulverise les asteroides touches
    for (var i = 0; i < this.rocks.length; i += 1) {
      var r = this.rocks[i];
      if (!r.alive) continue;
      var ex = r.img.x - d.img.x, ey = r.img.y - d.img.y, rr = DANK_FIELD_R + r.r;
      if (ex * ex + ey * ey < rr * rr) {
        r.alive = false;
        this.burst(r.img.x, r.img.y, 0x3aff7a, 8);
      }
    }

    // Largage calcule pour un singe qui ne bouge que verticalement
    var dropX = d.img.x, dropY = d.img.y + 50;
    if (d.drops < DANK_MAX_DROPS && dropX > MONKEY_X + DANK_DROP_AHEAD && dropX < GAME_WIDTH - 20) {
      var travel = (dropX - MONKEY_X) / speed;                     // s avant d'atteindre la colonne
      var arrival = this.playTime + travel * 1000;                 // instant d'arrivee
      var arrivalY = dropY + DANK_BANANA_VY * travel;              // hauteur a l'arrivee
      if (arrival - d.lastArrival >= DANK_MIN_ARRIVAL_GAP && arrivalY < GAME_HEIGHT - 40) {
        d.lastArrival = arrival;
        d.drops += 1;
        var it = this.spawnItem('rotten', dropX, dropY, null);
        it.vy = DANK_BANANA_VY;
        it.falling = true;
        playSfx('dankDrop');
      }
    }
    if (k >= 1) {
      d.img.destroy();
      d.field.destroy();
      this.dank = null;
      this.nextPatternAt = this.dist + 250; // les murs reprennent
      this.scheduleDank();
    }
  }

  /* ---------------- Evenements de jeu ---------------- */
  collect(item) {
    item.alive = false;
    var x = item.img.x, y = item.img.y;
    if (item.kind === 'normal' || item.kind === 'golden') {
      this.streak += 1;
      this.bananasEaten += 1;
      var newMult = Math.min(COMBO_MAX, 1 + Math.floor(this.streak / COMBO_STEP));
      if (newMult > this.mult) {
        this.mult = newMult;
        this.bestMult = Math.max(this.bestMult, newMult);
        playSfx('comboUp');
        this.floatText(MONKEY_X, this.monkey.y - 70, 'COMBO x' + newMult, COLORS.combo);
        this.tweens.add({ targets: this.multText, scale: 1.5, duration: 120, yoyo: true });
      }
      var pts = (item.kind === 'golden' ? SCORE_GOLDEN : SCORE_NORMAL) * this.mult;
      this.score += pts;
      playSfx(item.kind === 'golden' ? 'golden' : 'banana', { mult: this.mult });
      this.floatText(x, y - 10, '+' + pts, item.kind === 'golden' ? '#ffb300' : COLORS.ui);
      this.burst(x, y, item.kind === 'golden' ? 0xffb300 : 0xffe14a, item.kind === 'golden' ? 12 : 5);
    } else if (item.kind === 'rotten') {
      this.score = Math.max(0, this.score + SCORE_ROTTEN);
      playSfx('rotten');
      this.floatText(x, y - 10, String(SCORE_ROTTEN), COLORS.bad);
      this.burst(x, y, 0x7a8a2a, 8);
      this.cameras.main.shake(120, 0.006);
      this.breakCombo(false);
    } else if (item.kind === 'shield') {
      this.shield = true;
      this.shieldRing.setVisible(true);
      playSfx('shieldGet');
      this.floatText(x, y - 10, 'BOUCLIER', '#3ad6ff');
    } else if (item.kind === 'nuke') {
      this.nuke();
    }
    this.updateHud();
  }

  breakCombo(soft) {
    if (this.streak === 0 && this.mult === 1) return;
    var hadMult = this.mult > 1;
    this.streak = 0;
    this.mult = 1;
    if (hadMult) {
      playSfx('comboLost');
      this.floatText(MONKEY_X, this.monkey.y - 70, 'COMBO PERDU', COLORS.bad);
    } else if (soft) {
      playSfx('missed');
    }
    this.updateHud();
  }

  nuke() {
    playSfx('nuke');
    this.cameras.main.flash(400, 255, 255, 220);
    this.cameras.main.shake(400, 0.012);
    var self = this;
    this.rocks.forEach(function (r) {
      if (r.alive && r.img.x < GAME_WIDTH + 60) {
        r.alive = false;
        self.burst(r.img.x, r.img.y, 0xb3a4b8, 6);
      }
    });
    this.items.forEach(function (it) {
      if (it.alive && it.kind === 'rotten' && it.img.x < GAME_WIDTH + 60) {
        it.alive = false;
        self.burst(it.img.x, it.img.y, 0x7a8a2a, 5);
      }
    });
    this.banner('NUKE !', '#ff8a3a');
  }

  hitRock(rock) {
    if (this.shield) {
      this.shield = false;
      this.shieldRing.setVisible(false);
      rock.alive = false;
      this.burst(rock.img.x, rock.img.y, 0x3ad6ff, 14);
      playSfx('shieldBreak');
      this.cameras.main.shake(150, 0.008);
      this.invulnUntil = this.playTime + 700;
      this.updateHud();
      return;
    }
    this.die();
  }

  die() {
    if (this.dead) return;
    this.dead = true;
    stopMusic();
    playSfx('hit');
    this.cameras.main.shake(350, 0.018);
    this.cameras.main.flash(200, 255, 80, 80);
    this.burst(this.monkey.x, this.monkey.y, 0x6b3e1f, 16);
    this.monkeyVy = -380;
    this.time.delayedCall(1100, this.endGame, [], this);
  }

  endGame() {
    if (this.gameOver) return;
    this.gameOver = true;
    playSfx('gameOver');
    this.scene.start('GameOverScene', {
      score: this.score,
      distance: Math.floor(this.dist / 50),
      bananas: this.bananasEaten,
      bestMult: this.bestMult
    });
  }

  /* Appele par FiveCadeGame.onClose() (Echap) - stoppe tout sans passer
   * par l'ecran de fin. */
  hardStop() {
    stopMusic();
    this.dead = true;
    this.gameOver = true;
    this.time.removeAllEvents();
  }

  checkZone() {
    var idx = zoneIndexAt(this.dist);
    if (idx === this.zoneIdx) return;
    this.zoneIdx = idx;
    var z = ZONES[idx];
    this.zoneText.setText(z.name);
    playSfx('zone');
    this.banner('ZONE ' + (idx + 1), COLORS.ui, z.name);
    // fondu de la couleur de fond vers celle de la zone
    var from = this.bgColor, to = Phaser.Display.Color.IntegerToColor(z.bg);
    var cam = this.cameras.main, self = this;
    this.tweens.addCounter({
      from: 0, to: 100, duration: 1500,
      onUpdate: function (tw) {
        var c = Phaser.Display.Color.Interpolate.ColorWithColor(from, to, 100, tw.getValue());
        cam.setBackgroundColor(Phaser.Display.Color.GetColor(c.r, c.g, c.b));
      },
      onComplete: function () { self.bgColor = to; }
    });
    this.tweens.add({ targets: this.nebula, alpha: 0, duration: 700, yoyo: true, onYoyo: function () { self.nebula.setTint(z.nebula); } });
  }

  /* ---------------- Boucle ---------------- */
  update(time, delta) {
    if (this.gameOver) return;
    var dt = Math.min(delta, 50) / 1000; // evite un saut geant apres un onglet en arriere-plan
    var prm = paramsAt(this.dist);
    var speed = this.started && !this.dead ? prm.speed : (this.dead ? 0 : 60);
    var dx = speed * dt;
    this.stars.update(dx + (this.started ? 0 : 0.5));
    if (!this.started) return;

    this.playTime += delta;

    // --- Singe ---
    this.monkeyVy = Math.min(MAX_FALL_VY, this.monkeyVy + GRAVITY * dt);
    this.monkey.y += this.monkeyVy * dt;
    if (this.dead) {
      this.monkey.angle += 540 * dt;
      this.shieldRing.setVisible(false);
      return;
    }
    if (this.monkey.y < CEILING_Y) { this.monkey.y = CEILING_Y; this.monkeyVy = Math.max(0, this.monkeyVy); }
    this.monkey.angle = Phaser.Math.Clamp(this.monkeyVy / 22, -22, 40);
    this.shieldRing.setPosition(this.monkey.x, this.monkey.y);
    if (this.monkey.y > GAME_HEIGHT + 20) { this.die(); return; }

    // --- Progression ---
    this.dist += dx;
    this.checkZone();
    if (this.dist >= this.nextPatternAt && !this.dank) {
      this.spawnPattern();
      this.nextPatternAt = this.dist + paramsAt(this.dist).spacing;
    }
    if (this.dist >= DANK_UNLOCK_DIST && !this.dank) {
      if (this.nextDankAt === null) this.scheduleDank();
      else if (this.playTime >= this.nextDankAt) this.startDank();
    }
    if (this.dank) this.updateDank(dt, prm.speed);

    var mx = this.monkey.x, my = this.monkey.y;
    var invuln = this.invulnUntil && this.playTime < this.invulnUntil;

    // --- Asteroides ---
    for (var i = 0; i < this.rocks.length; i += 1) {
      var r = this.rocks[i];
      if (!r.alive) continue;
      r.x += r.vx * dt - dx;
      r.y += r.vy * dt;
      if (r.follow && !r.follow.alive) { r.x = r.follow.x + (r.dx || 0); r.follow = null; }
      if (r.update) r.update(dt);
      r.img.x = r.follow ? r.follow.x + (r.dx || 0) : r.x;
      if (r.follow) r.x = r.img.x;
      r.img.y = r.y;
      r.img.angle += r.spin * dt;
      if (!invuln && r.alive) {
        var ddx = r.img.x - mx, ddy = r.img.y - my, rr = r.r + MONKEY_R;
        if (ddx * ddx + ddy * ddy < rr * rr) { this.hitRock(r); if (this.dead) return; }
      }
      if (r.img.x < -160 || r.img.y > GAME_HEIGHT + 400 || r.img.y < -400) r.alive = false;
    }

    // --- Bananes / bonus ---
    for (var j = 0; j < this.items.length; j += 1) {
      var it = this.items[j];
      if (!it.alive) continue;
      it.x -= dx;
      if (it.falling) it.y += it.vy * dt;
      it.phase += dt * 3;
      var yy = (it.wall ? it.y + it.wall.offset : it.y) + Math.sin(it.phase) * 4;
      it.img.setPosition(it.x, yy);
      it.img.angle = Math.sin(it.phase) * 12;
      if (it.glow) it.glow.setPosition(it.x, yy);
      if (it.label) it.label.setPosition(it.x, yy);
      var ex = it.x - mx, ey = yy - my, er = it.r + MONKEY_R + 6;
      if (ex * ex + ey * ey < er * er) {
        this.collect(it);
      } else if (it.x < mx - 40 && !it.passed) {
        it.passed = true;
        // banane normale ratee : le combo retombe (la doree, risquee, ne compte pas)
        if (it.kind === 'normal') this.breakCombo(true);
      }
      if (it.x < -60 || it.y > GAME_HEIGHT + 60) it.alive = false;
    }

    this.cleanup();
    this.updateHudLight();
  }

  updateHudLight() {
    var m = Math.floor(this.dist / 50);
    if (m !== this.lastShownDist) { this.lastShownDist = m; this.distText.setText(m + ' m'); }
  }

  cleanup() {
    this.rocks = this.rocks.filter(function (r) {
      if (!r.alive) { r.img.destroy(); return false; }
      return true;
    });
    this.items = this.items.filter(function (it) {
      if (!it.alive) {
        it.img.destroy();
        if (it.glow) it.glow.destroy();
        if (it.label) it.label.destroy();
        return false;
      }
      return true;
    });
  }
}

/* ============================================================
 * GameOverScene - score -> saisie du nom (si Top 25) -> rejouer,
 * meme sequence que les autres bornes.
 * ============================================================ */
class GameOverScene extends Phaser.Scene {
  constructor() {
    super('GameOverScene');
  }

  init(data) {
    this.finalScore = (data && data.score) || 0;
    this.stats = data || {};
  }

  create() {
    // Fond : l'illustration d'accueil, assombrie pour garder le texte lisible
    this.cameras.main.setBackgroundColor('#0a0310');
    var bg = this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'menu-bg');
    bg.setScale(Math.max(GAME_WIDTH / bg.width, GAME_HEIGHT / bg.height));
    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x05020c, 0.72);

    var best = 0;
    try { best = parseInt(localStorage.getItem('fivecade_spacemonkey_best') || '0', 10) || 0; } catch (e) { /* ignore */ }
    var isNewBest = this.finalScore > best;
    if (isNewBest) {
      try { localStorage.setItem('fivecade_spacemonkey_best', String(this.finalScore)); } catch (e) { /* ignore */ }
    }

    var cx = GAME_WIDTH / 2, cy = GAME_HEIGHT / 2;
    this.add.rectangle(cx, cy - 40, 760, 360, 0x0a0310, 0.88).setStrokeStyle(3, 0xffd63a, 0.9);
    this.add.text(cx, cy - 170, 'GAME OVER', {
      fontFamily: 'monospace', fontSize: '64px', color: COLORS.bad, fontStyle: 'bold', stroke: '#10051f', strokeThickness: 8
    }).setOrigin(0.5);
    this.add.text(cx, cy - 90, 'SCORE : ' + this.finalScore, {
      fontFamily: 'monospace', fontSize: '36px', color: COLORS.ui, fontStyle: 'bold', stroke: '#10051f', strokeThickness: 6
    }).setOrigin(0.5);
    this.add.text(cx, cy - 40,
      (this.stats.distance || 0) + ' m   -   ' + (this.stats.bananas || 0) + ' bananes   -   combo max x' + (this.stats.bestMult || 1), {
        fontFamily: 'monospace', fontSize: '20px', color: COLORS.text
      }).setOrigin(0.5);

    if (isNewBest && this.finalScore > 0) {
      var rec = this.add.text(cx, cy, 'NOUVEAU RECORD !', {
        fontFamily: 'monospace', fontSize: '22px', color: '#7affc8', fontStyle: 'bold'
      }).setOrigin(0.5);
      this.tweens.add({ targets: rec, scale: 1.15, yoyo: true, repeat: -1, duration: 400 });
    } else {
      this.add.text(cx, cy, 'Record : ' + Math.max(best, this.finalScore), {
        fontFamily: 'monospace', fontSize: '18px', color: '#a89ac8'
      }).setOrigin(0.5);
    }

    this.continueHint = this.add.text(cx, cy + 70, 'Appuie sur une touche pour continuer', {
      fontFamily: 'monospace', fontSize: '18px', color: COLORS.text
    }).setOrigin(0.5);
    this.replayHints = [
      this.add.text(cx, cy + 70, 'ENTREE pour rejouer', { fontFamily: 'monospace', fontSize: '18px', color: COLORS.text }).setOrigin(0.5).setVisible(false),
      this.add.text(cx, cy + 100, 'ECHAP pour quitter', { fontFamily: 'monospace', fontSize: '18px', color: COLORS.text }).setOrigin(0.5).setVisible(false)
    ];

    this.stage = 'gameover';
    this.armedAt = this.time.now + 600; // evite qu'un appui de panique en mourant saute l'ecran
    safeCall(function () { window.FiveCadeBridge.requestScores(); });

    var self = this;
    this.input.keyboard.on('keydown', function (ev) {
      if (self.time.now < self.armedAt) return;
      if (self.stage === 'gameover') {
        self.advance();
      } else if (self.stage === 'replay' && (ev.key === 'Enter' || ev.key === ' ')) {
        self.scene.start('MainScene');
      }
    });
  }

  advance() {
    var self = this;
    this.continueHint.setVisible(false);
    if (!this.qualifiesForLeaderboard()) {
      // Pas dans les 25 meilleurs : pas de saisie de nom, score non enregistre.
      if (this.finalScore > 0 && latestLeaderboard && latestLeaderboard.length) {
        var last = latestLeaderboard[latestLeaderboard.length - 1];
        this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 36,
          'Pas assez pour entrer au Top ' + LEADERBOARD_SIZE + ' (25e : ' + last.score + ')', {
            fontFamily: 'monospace', fontSize: '17px', color: '#ff9a7a'
          }).setOrigin(0.5);
      }
      this.replayHints.forEach(function (t) { t.setVisible(true); });
      this.stage = 'replay';
      return;
    }
    this.stage = 'naming';
    window.FiveCadeBridge.promptName(function (chosenName) {
      window.FiveCadeBridge.submitScore(self.finalScore, chosenName);
      self.replayHints.forEach(function (t) { t.setVisible(true); });
      self.stage = 'replay';
      self.armedAt = self.time.now + 250; // l'ENTREE qui valide le nom ne relance pas la partie
    });
  }

  qualifiesForLeaderboard() {
    if (this.finalScore <= 0) return false;
    if (!latestLeaderboard || latestLeaderboard.length < LEADERBOARD_SIZE) return true;
    return this.finalScore > latestLeaderboard[latestLeaderboard.length - 1].score;
  }

}

/* ============================================================
 * Bootstrap - cree le jeu Phaser une seule fois ; FiveCadeGame sert
 * d'interface avec la page NUI (index.html).
 * ============================================================ */
(function () {
  "use strict";

  var game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game-container',
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
    backgroundColor: '#0a0b26',
    pixelArt: true,
    scene: [BootScene, MenuScene, MainScene, GameOverScene]
  });
  window.__PHASER_GAME__ = game;

  var menuSceneRef = null;
  var mainSceneRef = null;
  var currentBorneType = 'spacemonkey';

  // Touche M : coupe / remet le son (sauf pendant la saisie du nom).
  document.addEventListener('keydown', function (ev) {
    if ((ev.key === 'm' || ev.key === 'M') && document.activeElement && document.activeElement.tagName !== 'INPUT' &&
        !(window.FiveCadeVolume && window.FiveCadeVolume.isOpen())) {
      if (window.FiveCadeSound) safeCall(function () { window.FiveCadeSound.toggleMute(); });
    }
  });

  window.FiveCadeGame = {
    // Appele par index.html sur Echap : true = touche consommee ici (panneau
    // des scores referme), la borne ne se ferme pas.
    consumeEscape: function () {
      if (menuSceneRef && menuSceneRef.scoresPanel) {
        menuSceneRef.closeScores();
        return true;
      }
      return false;
    },
    onOpen: function (playerName, borneType) {
      currentBorneType = borneType || 'spacemonkey';
      window.__fivecadeBorneOpenRequested = true;
      if (window.FiveCadeSound) safeCall(function () { window.FiveCadeSound.resume(); });
      if (!window.__fivecadeBootComplete) return;
      game.scene.stop('MainScene');
      game.scene.stop('GameOverScene');
      game.scene.stop('MenuScene');
      game.scene.start('MenuScene');
    },
    onClose: function () {
      window.__fivecadeBorneOpenRequested = false;
      if (window.FiveCadeVolume) window.FiveCadeVolume.close();
      if (menuSceneRef && menuSceneRef.scoresPanel) menuSceneRef.closeScores();
      if (mainSceneRef) mainSceneRef.hardStop();
      game.sound.stopAll();
      if (window.FiveCadeSound) safeCall(function () { window.FiveCadeSound.suspend(); });
      game.scene.stop('MainScene');
      game.scene.stop('GameOverScene');
      game.scene.stop('MenuScene');
      menuSceneRef = null;
      mainSceneRef = null;
    },
    onScoresUpdated: function (scores) {
      latestLeaderboard = scores || [];
      if (menuSceneRef) menuSceneRef.onScoresUpdated(scores);
    },
    getBorneType: function () {
      return currentBorneType;
    },
    _registerMenuScene: function (scene) {
      menuSceneRef = scene;
    },
    _registerMainScene: function (scene) {
      mainSceneRef = scene;
    }
  };
})();
