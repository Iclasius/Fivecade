/* ============================================================
 * FiveCade - Borne Degenatron/Penetrator
 * Shoot em up spatial VERTICAL (haut -> bas), moteur Phaser 4 (charge
 * en local via phaser.min.js). L'ecran/cadre reste large (bezel plein
 * ecran), mais le gameplay lui-meme defile de haut en bas - une autre
 * borne future utilisera le mode gauche->droite, celle-ci reste
 * verticale (et les sprites vaisseaux "art_raw" sont dessines nez en
 * haut, coherent avec ce sens). Toutes les textures sont generees par
 * code (formes/couleurs) - pas d'images pour le moment, remplacable
 * plus tard par les sprites deja migres sans toucher a la logique.
 *
 * Architecture inspiree des templates Phaser "space shooter"
 * classiques (ex. Ezelia/Phaser3-Space-Shooter-Template) : une scene
 * par ecran (Boot, Menu, Main, GameOver).
 * ============================================================ */

/* Paysage, taille calee sur la decoupe transparente du cadre borne
 * (bezel.png, decoupe native ~1242x844 dans une image 1448x1086),
 * agrandi (facteur 0.9669 au lieu de 0.6906) - ecran juge trop petit
 * a la taille d'origine. */
var GAME_WIDTH = 1201;
var GAME_HEIGHT = 816;

/* Note : les ennemis/le joueur sont maintenant de vrais sprites
 * art_raw (plus des formes generees) - seules les couleurs de TIRS
 * restent utilisees ici (setTint sur le sprite generique shot_generic),
 * plus les couleurs de corps d'ennemis d'origine. */
var COLORS = {
  player: 0x3ad6ff,
  playerBullet: 0xffffff,
  gruntBullet: 0xff8a8a,
  zigzagBullet: 0xffd23a,
  bossBullet: 0x9dffce,
  laser: 0xff5ad6,
  missile: 0xff8c3a,
  explosion: 0xffffff
};

/* Palette de fonds spatiaux coherents (variations sombres/bleutees,
 * jamais criardes) entre lesquels le fond de la partie derive lentement
 * - evite la lassitude visuelle sur une session longue (pas de niveaux,
 * ca s'enchaine tant qu'on est en vie) sans jamais casser l'ambiance. */
var SPACE_PALETTE = [
  { r: 5, g: 6, b: 20 },   // bleu nuit (teinte d'origine)
  { r: 14, g: 6, b: 26 },  // violet sombre
  { r: 4, g: 16, b: 22 },  // teal sombre
  { r: 10, g: 6, b: 28 }   // indigo
];

/* Plusieurs pistes de musique de partie (Suno, meme thematique/BPM)
 * jouees en rotation aleatoire avec fondu enchaine - meme logique que
 * la colorimetrie, pour qu'une session longue ne tourne pas en boucle
 * sur un seul morceau. Meme principe que ENEMY_ASSETS/PLAYER_SHIP_ASSETS :
 * musiques dediees par borne (meme thematique spatiale, mais Penetrator
 * plus agressif - demande explicite). */
var MUSIC_ASSETS = {
  degenatron: {
    menu: 'music-menu',
    gameplay: [
      'music-gameplay', 'music-gameplay-2', 'music-gameplay-3', 'music-gameplay-4',
      'music-gameplay-5', 'music-gameplay-6', 'music-gameplay-7', 'music-gameplay-8', 'music-gameplay-9'
    ]
  },
  penetrator: {
    menu: 'music-menu-penetrator',
    gameplay: [
      'music-gameplay-penetrator', 'music-gameplay-penetrator-2', 'music-gameplay-penetrator-3', 'music-gameplay-penetrator-4',
      'music-gameplay-penetrator-5', 'music-gameplay-penetrator-6', 'music-gameplay-penetrator-7', 'music-gameplay-penetrator-8', 'music-gameplay-penetrator-9'
    ]
  }
};
/* Liste a plat de toutes les cles audio des deux bornes, utilisee
 * uniquement pour tout couper proprement au changement de scene (une
 * seule borne active a la fois, mais autant etre exhaustif). */
var ALL_MUSIC_KEYS = [MUSIC_ASSETS.degenatron.menu, MUSIC_ASSETS.penetrator.menu]
  .concat(MUSIC_ASSETS.degenatron.gameplay)
  .concat(MUSIC_ASSETS.penetrator.gameplay);
var MUSIC_VOLUME = 0.3;
var MUSIC_CROSSFADE_MS = 3000;

/* Meme jeu/logique sur les deux bornes, mais DA (sprites ennemis/boss)
 * differente par borne physique - Degenatron garde son roster d'origine,
 * Penetrator a ses coccinelles + boss "yeux" (voir borneType, connu a
 * l'ouverture via FiveCadeGame.getBorneType). */
var ENEMY_ASSETS = {
  degenatron: {
    grunt: { texture: 'enemy-grunt', scale: 1.0 },
    zigzag: { texture: 'enemy-zigzag', scale: 1.0 },
    charger: { texture: 'enemy-charger', scale: 1.05 },
    boss: { texture: 'enemy-boss', scale: 0.5 }
  },
  penetrator: {
    /* Sprites natifs plus petits (~30-42px) que le roster Degenatron -
     * scale ajuste pour retomber sur une taille affichee similaire
     * (~40px pour les ennemis de base). */
    grunt: { texture: 'enemy-grunt-penetrator', scale: 1.25 },
    zigzag: { texture: 'enemy-zigzag-penetrator', scale: 1.35 },
    charger: { texture: 'enemy-charger-penetrator', scale: 1.3 },
    boss: { texture: 'enemy-boss-penetrator', scale: 0.5 }
  }
};

/* Meme principe pour le vaisseau joueur - identique en tout (taille,
 * comportement) sauf la teinte : bleu/blanc sur Degenatron, rouge/noir
 * sur Penetrator (demande explicite, uniquement borne 2). */
var PLAYER_SHIP_ASSETS = {
  degenatron: { texture: 'player-ship', scale: 0.32 },
  penetrator: { texture: 'player-ship-penetrator', scale: 0.32 }
};

/* Champ d'etoiles partage Menu/Main - plusieurs couches de taille
 * (petites/loin/lentes -> grosses/proches/rapides + quelques teintees)
 * pour un effet de profondeur, un simple semis de points plats
 * paraissait trop vide sur le grand ecran plein cadre. */
function createStarfield(scene, count) {
  var group = scene.add.group();
  var tints = [0xffffff, 0xffffff, 0xffffff, 0x9be7ff, 0xffd9a0];
  for (var i = 0; i < count; i++) {
    var size = Phaser.Math.Between(1, 4);
    var star = scene.add.rectangle(
      Phaser.Math.Between(0, GAME_WIDTH), Phaser.Math.Between(0, GAME_HEIGHT),
      size, size,
      Phaser.Utils.Array.GetRandom(tints), Phaser.Math.FloatBetween(0.25, 1)
    );
    star.speed = 15 + size * 25;
    group.add(star);
  }
  return group;
}

function updateStarfield(group, dt) {
  group.getChildren().forEach(function (star) {
    star.y += star.speed * dt;
    if (star.y > GAME_HEIGHT) {
      star.y = 0;
      star.x = Phaser.Math.Between(0, GAME_WIDTH);
    }
  });
}

/* Jingle "game over" synthetise directement en Web Audio (oscillateurs,
 * pas de fichier son) - petite gamme descendante en onde carree, style
 * bip d'arcade retro, evite tout souci de droits pour un son aussi
 * court. Musiques d'ambiance (menu/partie) prevues separement, celles-
 * la seront de vrais fichiers generes via Suno. */
function playGameOverJingle() {
  try {
    var AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) { return; }
    if (!window.__fivecadeAudioCtx) {
      window.__fivecadeAudioCtx = new AudioCtx();
    }
    var ctx = window.__fivecadeAudioCtx;
    if (ctx.state === 'suspended') {
      ctx.resume();
    }
    var notes = [392.00, 329.63, 261.63, 196.00]; // Sol4, Mi4, Do4, Sol3
    var noteDur = 0.16;
    var gap = 0.14;
    notes.forEach(function (freq, i) {
      var t0 = ctx.currentTime + i * gap;
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(freq, t0);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.22, t0 + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + noteDur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + noteDur + 0.02);
    });
  } catch (e) {
    /* best-effort - une politique autoplay ou un navigateur sans
     * Web Audio ne doit jamais casser le jeu. */
  }
}

/* Wrappers defensifs autour du SoundManager de Phaser - si une piste
 * n'est pas encore prete (decodage audio pas termine, cle absente du
 * cache, contexte verrouille...), une erreur ici stopperait net le
 * reste du create() de la scene (menu/HUD jamais affiches). La musique
 * est un bonus, jamais bloquant pour l'affichage du jeu. */
function safeStopMusic(scene, key) {
  try { scene.sound.stopByKey(key); } catch (e) { /* ignore */ }
}
function safePlayMusic(scene, key, config) {
  try { return scene.sound.play(key, config); } catch (e) { return null; }
}
function safeAddMusic(scene, key, config) {
  try {
    var sound = scene.sound.add(key, config);
    sound.play();
    return sound;
  } catch (e) {
    return null;
  }
}

/* ============================================================
 * BootScene - genere toutes les textures placeholder une seule fois
 * ============================================================ */
class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
  }

  preload() {
    /* Visuel "hero" de l'accueil - image peinte/comic generee (pas de
     * pixel art), chargee comme vraie texture (pas une forme generee).
     * Les deux bornes (Degenatron/Penetrator) partagent cette meme
     * resource/NUI persistante - on charge les deux visuels au boot et
     * MenuScene choisit lequel afficher selon borneType (connu a
     * l'ouverture, voir FiveCadeGame.getBorneType). */
    this.load.image('menu-face', 'menu-face.png');
    this.load.image('menu-face-penetrator', 'menu-face-penetrator.png');

    /* Vrais sprites (issus de la bibliotheque art_raw deja preparee) qui
     * remplacent les formes generees pour le vaisseau joueur et les 4
     * types d'ennemis - reste de la logique (spawn/IA/collisions)
     * inchangee, seule la texture change. */
    this.load.image('player-ship', 'sprites/player_ship.png');
    this.load.image('player-ship-penetrator', 'sprites/player_ship_penetrator.png');
    this.load.image('enemy-grunt', 'sprites/enemy_grunt.png');
    this.load.image('enemy-zigzag', 'sprites/enemy_zigzag.png');
    this.load.image('enemy-charger', 'sprites/enemy_charger.png');
    this.load.image('enemy-boss', 'sprites/enemy_boss.png');

    /* Meme jeu, DA differente sur la borne Penetrator (coccinelles +
     * boss "yeux" plutot que les ennemis Degenatron ci-dessus). */
    this.load.image('enemy-grunt-penetrator', 'sprites/enemy_grunt_penetrator.png');
    this.load.image('enemy-zigzag-penetrator', 'sprites/enemy_zigzag_penetrator.png');
    this.load.image('enemy-charger-penetrator', 'sprites/enemy_charger_penetrator.png');
    this.load.image('enemy-boss-penetrator', 'sprites/enemy_boss_penetrator.png');

    /* Bonus (armes + vie) et tir generique - un seul sprite de tir
     * reutilise pour toutes les factions/armes via teinte (setTint),
     * plutot que de multiplier les fichiers pour une simple couleur. */
    this.load.image('pickup-vulcan', 'sprites/pickup_vulcan.png');
    this.load.image('pickup-laser', 'sprites/pickup_laser.png');
    this.load.image('pickup-missile', 'sprites/pickup_missile.png');
    this.load.image('pickup-life', 'sprites/pickup_life.png');
    this.load.image('pickup-bomb', 'sprites/pickup_bomb.png');
    this.load.image('pickup-shield', 'sprites/pickup_shield.png');
    this.load.image('shot-generic', 'sprites/shot_generic.png');

    /* Musiques d'ambiance (generees via Suno) - une pour l'accueil, une
     * pour la partie, en boucle, volume bas pour rester en fond derriere
     * les effets. */
    this.load.audio('music-menu', 'audio/menu-theme.mp3');
    this.load.audio('music-gameplay', 'audio/gameplay-theme.mp3');
    this.load.audio('music-gameplay-2', 'audio/gameplay-theme-2.mp3');
    this.load.audio('music-gameplay-3', 'audio/gameplay-theme-3.mp3');
    this.load.audio('music-gameplay-4', 'audio/gameplay-theme-4.mp3');
    /* 5 pistes de plus (meme style/BPM ~155, meme prompt Suno reutilise
     * tel quel) - demande explicite : garder le meme theme musical deja
     * etabli, juste plus de variete dans la rotation aleatoire. */
    this.load.audio('music-gameplay-5', 'audio/gameplay-theme-5.mp3');
    this.load.audio('music-gameplay-6', 'audio/gameplay-theme-6.mp3');
    this.load.audio('music-gameplay-7', 'audio/gameplay-theme-7.mp3');
    this.load.audio('music-gameplay-8', 'audio/gameplay-theme-8.mp3');
    this.load.audio('music-gameplay-9', 'audio/gameplay-theme-9.mp3');

    /* Musiques dediees Penetrator (meme thematique spatiale, son plus
     * agressif - voir MUSIC_ASSETS). */
    this.load.audio('music-menu-penetrator', 'audio/menu-theme-penetrator.mp3');
    this.load.audio('music-gameplay-penetrator', 'audio/gameplay-theme-penetrator.mp3');
    this.load.audio('music-gameplay-penetrator-2', 'audio/gameplay-theme-penetrator-2.mp3');
    this.load.audio('music-gameplay-penetrator-3', 'audio/gameplay-theme-penetrator-3.mp3');
    this.load.audio('music-gameplay-penetrator-4', 'audio/gameplay-theme-penetrator-4.mp3');
    /* 5 pistes de plus, meme style/BPM ~170 (plus agressif que Degenatron,
     * principe deja etabli) reutilise tel quel. */
    this.load.audio('music-gameplay-penetrator-5', 'audio/gameplay-theme-penetrator-5.mp3');
    this.load.audio('music-gameplay-penetrator-6', 'audio/gameplay-theme-penetrator-6.mp3');
    this.load.audio('music-gameplay-penetrator-7', 'audio/gameplay-theme-penetrator-7.mp3');
    this.load.audio('music-gameplay-penetrator-8', 'audio/gameplay-theme-penetrator-8.mp3');
    this.load.audio('music-gameplay-penetrator-9', 'audio/gameplay-theme-penetrator-9.mp3');
  }

  create() {
    this.makeCircleTexture('tex-spark', 3, COLORS.explosion);
    window.__fivecadeBootComplete = true;
    /* Ne demarre PAS le menu (donc sa musique) tant que le joueur n'a
     * pas reellement ouvert une borne : cette page NUI est chargee et
     * tourne en fond des le demarrage de la resource / la connexion du
     * joueur, bien avant toute interaction - #app est juste masque en
     * CSS (display:none), ce qui ne coupe ni le JS ni le son. Sans ce
     * garde-fou, la musique du menu se lancait toute seule des que le
     * preload finissait, meme si le joueur n'avait jamais approche une
     * borne (bug remonte par l'utilisateur : "j'entends la musique a
     * peine connecte, je joue meme pas"). onOpen() met ce flag a true et
     * demarrera lui-meme MenuScene si le boot est deja fini a ce
     * moment-la ; sinon, si le boot finit avant toute ouverture, on
     * reste simplement inactif ici (aucune scene, aucun son) jusqu'au
     * premier vrai onOpen(). */
    if (window.__fivecadeBorneOpenRequested) {
      this.scene.start('MenuScene');
    }
  }

  makeCircleTexture(key, radius, color) {
    var d = radius * 2;
    var g = this.add.graphics();
    g.fillStyle(color, 1);
    g.fillCircle(radius, radius, radius);
    g.generateTexture(key, d, d);
    g.destroy();
  }
}

/* ============================================================
 * MenuScene - PLAY / MEILLEURS SCORES / QUITTER
 * ============================================================ */
class MenuScene extends Phaser.Scene {
  constructor() {
    super('MenuScene');
  }

  create() {
    /* Borne physique qui a ouvert le menu (meme resource partagee par
     * les deux bornes) - determine a la fois le visage affiche et la
     * musique d'accueil jouee ci-dessous. */
    var borneType = (window.FiveCadeGame && window.FiveCadeGame.getBorneType) ? window.FiveCadeGame.getBorneType() : 'degenatron';
    var musicAssets = MUSIC_ASSETS[borneType] || MUSIC_ASSETS.degenatron;

    /* Musique d'ambiance accueil (Suno) - coupe toutes les musiques des
     * deux bornes si l'une tournait encore, repart toujours du debut a
     * l'entree du menu. Best-effort (safePlayMusic) : un souci audio ne
     * doit jamais empecher le reste du menu (visage/items) de s'afficher. */
    ALL_MUSIC_KEYS.forEach(function (key) { safeStopMusic(this, key); }, this);
    safePlayMusic(this, musicAssets.menu, { loop: true, volume: 0.35 });

    /* Fond anime (etoiles qui defilent) plutot qu'un ecran vide -
     * meme effet que MainScene, pour que le menu ait un peu de vie. */
    this.starLayer = createStarfield(this, 220);

    /* Visuel "hero" (visage/titre genere, style peint/comic assorti au
     * cadre) centre en haut de l'ecran, menu centre juste en dessous -
     * UNE SEULE composition/page (pas un visage a gauche et un menu a
     * droite qui se lisait comme deux zones separees). Pas de titre
     * "DEGENATRON"/"PENETRATOR" en texte ici, le logo/marquee est deja
     * porte par cette image + le cadre (bezel.png). */
    var faceKey = (borneType === 'penetrator' && this.textures.exists('menu-face-penetrator')) ? 'menu-face-penetrator' : 'menu-face';
    var faceTargetHeight = 560;
    this.faceImage = this.add.image(GAME_WIDTH / 2, 20, faceKey).setOrigin(0.5, 0);
    this.faceImage.setScale(faceTargetHeight / this.faceImage.height);

    this.items = ['NOUVELLE PARTIE', 'MEILLEURS SCORES', 'QUITTER'];
    this.selected = 0;
    this.texts = [];
    var self = this;
    var menuX = GAME_WIDTH / 2;
    var firstItemY = 620;

    this.items.forEach(function (label, i) {
      var t = self.add.text(menuX, firstItemY + i * 36, label, {
        fontFamily: 'monospace', fontSize: '18px', color: '#ffffff'
      }).setOrigin(0.5).setInteractive({ useHandCursor: true });

      t.on('pointerover', function () { self.setSelected(i); });
      t.on('pointerdown', function () { self.activate(i); });

      self.texts.push(t);
    });

    /* Controles affiches directement a l'accueil plutot qu'en option
     * de menu a part - plus simple, tout de suite visible. Remonte par
     * rapport au tout bord bas de l'ecran : le hint HTML "ECHAP pour
     * quitter" (#hint, index.html) est positionne en absolu tout en bas
     * du cadre et se superposait/melangeait illisiblement avec ce texte
     * quand les deux etaient a la meme hauteur. */
    this.add.text(GAME_WIDTH / 2, GAME_HEIGHT - 50, 'FLECHES pour se deplacer   -   ESPACE pour tirer', {
      fontFamily: 'monospace', fontSize: '12px', color: '#9be7ff'
    }).setOrigin(0.5);

    /* Panneau dimensionne pour 10 lignes pleines sans chevaucher le
     * rappel du bas - avec le score list au complet, ca debordait
     * avant (texte illisible, empile sur le hint). */
    this.scoresPanel = this.add.container(0, 0).setVisible(false);
    var panelBg = this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, 400, 430, 0x05070f, 1)
      .setStrokeStyle(2, COLORS.player);
    this.scoresTitle = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 195, 'MEILLEURS SCORES', {
      fontFamily: 'monospace', fontSize: '16px', color: '#3ad6ff'
    }).setOrigin(0.5);
    this.scoresText = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 160, 'Chargement...', {
      fontFamily: 'monospace', fontSize: '13px', color: '#dff6ff', align: 'center', lineSpacing: 8
    }).setOrigin(0.5, 0);
    this.scoresHint = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 198, 'ECHAP ou ENTREE pour revenir', {
      fontFamily: 'monospace', fontSize: '10px', color: '#9be7ff'
    }).setOrigin(0.5);
    this.scoresPanel.add([panelBg, this.scoresTitle, this.scoresText, this.scoresHint]);

    this.keys = this.input.keyboard.addKeys('UP,DOWN,ENTER,SPACE,ESC');
    this.setSelected(0);

    this.latestScores = [];
    window.FiveCadeGame._registerMenuScene(this);

    /* Vitrine de sprites hors FiveM uniquement (?showcase=1). */
    if (/[?&]showcase=1/.test(location.search)) {
      this.scene.start('MainScene');
    }
  }

  setSelected(i) {
    this.selected = i;
    this.texts.forEach(function (t, idx) {
      t.setColor(idx === i ? '#3aff8e' : '#ffffff');
      t.setScale(idx === i ? 1.08 : 1);
    });
  }

  activate(i) {
    if (this.scoresPanel.visible) {
      return;
    }
    if (i === 0) {
      this.scene.start('MainScene');
    } else if (i === 1) {
      this.openScores();
    } else if (i === 2) {
      window.FiveCadeBridge.quit();
    }
  }

  openScores() {
    this.scoresPanel.setVisible(true);
    this.texts.forEach(function (t) { t.setVisible(false); });
    this.faceImage.setVisible(false);
    this.renderScores();
    window.FiveCadeBridge.requestScores();
  }

  closeScores() {
    this.scoresPanel.setVisible(false);
    this.texts.forEach(function (t) { t.setVisible(true); });
    this.faceImage.setVisible(true);
  }

  onScoresUpdated(scores) {
    this.latestScores = scores || [];
    if (this.scoresPanel.visible) {
      this.renderScores();
    }
  }

  renderScores() {
    if (!this.latestScores.length) {
      this.scoresText.setText('Aucun score enregistre');
      return;
    }
    var lines = this.latestScores.slice(0, 10).map(function (s, i) {
      var rank = (i + 1) + '.';
      return rank.padEnd(4) + (s.name || '???').padEnd(14) + s.score;
    });
    this.scoresText.setText(lines.join('\n'));
  }

  update(time, delta) {
    updateStarfield(this.starLayer, delta / 1000);

    if (this.scoresPanel.visible) {
      if (Phaser.Input.Keyboard.JustDown(this.keys.ESC) || Phaser.Input.Keyboard.JustDown(this.keys.ENTER)) {
        this.closeScores();
      }
      return;
    }
    if (Phaser.Input.Keyboard.JustDown(this.keys.UP)) {
      this.setSelected((this.selected + this.items.length - 1) % this.items.length);
    } else if (Phaser.Input.Keyboard.JustDown(this.keys.DOWN)) {
      this.setSelected((this.selected + 1) % this.items.length);
    } else if (Phaser.Input.Keyboard.JustDown(this.keys.ENTER) || Phaser.Input.Keyboard.JustDown(this.keys.SPACE)) {
      this.activate(this.selected);
    }
  }
}

/* ============================================================
 * MainScene - le jeu lui-meme : enfer de balles, IA agressives,
 * bonus d'armes.
 * ============================================================ */
/* Trois armes vraiment distinctes (pas juste des paliers du meme
 * tir) - chaque pickup porte un type ; en ramasser un du meme type
 * que l'arme en cours augmente son niveau (jusqu'a 3), un type
 * different bascule dessus au niveau 1. */
var WEAPON_TYPES = {
  vulcan: {
    label: 'VULCAIN',
    bulletColor: COLORS.playerBullet,
    bulletScale: 0.28,
    bulletSpeed: 420,
    damage: 1,
    levels: [
      { fireDelay: 260, pattern: 'single' },
      { fireDelay: 220, pattern: 'spread3' },
      { fireDelay: 160, pattern: 'spread5' }
    ]
  },
  /* Laser = perce plusieurs ennemis alignes au lieu de s'arreter au
   * premier (voir "pierce" ci-dessous, gere dans onBulletHitsEnemy) -
   * avant ca ne changeait que la cadence de tir, sans identite propre
   * ("a part tirer rapidement je suis pas convaincu de son interet",
   * retour utilisateur). Le nombre d'ennemis transperces augmente avec
   * le niveau (2 au niveau 1, jusqu'a 4 au niveau 3). */
  laser: {
    label: 'LASER',
    bulletColor: COLORS.laser,
    bulletScale: 0.26,
    bulletSpeed: 600,
    damage: 1,
    levels: [
      { fireDelay: 140, pattern: 'single', pierce: 1 },
      { fireDelay: 100, pattern: 'single', pierce: 2 },
      { fireDelay: 60, pattern: 'single', pierce: 3 }
    ]
  },
  /* Missile = explosion a l'impact qui degate aussi les ennemis proches
   * (voir "splashRadius" ci-dessous) - avant l'unique difference etait
   * un degat double invisible en pratique (la plupart des ennemis n'ont
   * qu'1 PV, donc 1 ou 2 degats tue pareil) : "je sais meme pas l'effet
   * qu'elle a", retour utilisateur. Le rayon de l'explosion grandit avec
   * le niveau. */
  missile: {
    label: 'MISSILES',
    bulletColor: COLORS.missile,
    bulletScale: 0.42,
    bulletSpeed: 300,
    damage: 2,
    levels: [
      { fireDelay: 420, pattern: 'single', splashRadius: 55 },
      { fireDelay: 340, pattern: 'spread3', splashRadius: 70 },
      { fireDelay: 260, pattern: 'spread3', splashRadius: 85 }
    ]
  }
};
var WEAPON_TYPE_KEYS = Object.keys(WEAPON_TYPES);

/* Bombe et bouclier (voir useBomb/onPlayerHit) : stocks volontairement
 * bas - "quelques tirs ignores, mais pas trop" et une bombe reste un
 * evenement rare, jamais un outil qu'on spamme. */
var MAX_BOMBS = 3;
var MAX_SHIELD_CHARGES = 3;

class MainScene extends Phaser.Scene {
  constructor() {
    super('MainScene');
  }

  create() {
    /* DA ennemis/boss selon la borne physique qui a ouvert le menu
     * (meme jeu/logique, sprites differents). */
    var borneType = (window.FiveCadeGame && window.FiveCadeGame.getBorneType) ? window.FiveCadeGame.getBorneType() : 'degenatron';
    this.enemyAssets = ENEMY_ASSETS[borneType] || ENEMY_ASSETS.degenatron;
    this.playerShipAsset = PLAYER_SHIP_ASSETS[borneType] || PLAYER_SHIP_ASSETS.degenatron;

    /* Musique d'ambiance partie (Suno) - plusieurs pistes dediees a la
     * borne (voir MUSIC_ASSETS) en rotation avec fondu enchaine (voir
     * startGameplayMusic), coupe toutes les musiques des deux bornes.
     * Best-effort : un souci audio ne doit jamais bloquer le jeu. */
    this.gameplayTracks = (MUSIC_ASSETS[borneType] || MUSIC_ASSETS.degenatron).gameplay;
    ALL_MUSIC_KEYS.forEach(function (key) { safeStopMusic(this, key); }, this);
    this.startGameplayMusic();

    /* Fond spatial : derive lentement entre quelques teintes sombres
     * coherentes (voir SPACE_PALETTE) pour eviter la lassitude visuelle
     * sur une session longue (pas de niveaux, ca s'enchaine tant qu'on
     * reste en vie). */
    this.bgColor = { r: SPACE_PALETTE[0].r, g: SPACE_PALETTE[0].g, b: SPACE_PALETTE[0].b };
    this.bgColorIndex = 0;
    this.cameras.main.setBackgroundColor(Phaser.Display.Color.GetColor(this.bgColor.r, this.bgColor.g, this.bgColor.b));
    this.colorDriftEvent = this.time.addEvent({
      delay: 50000, loop: true, callback: this.driftBackgroundColor, callbackScope: this
    });

    this.starLayer = createStarfield(this, 90);

    this.score = 0;
    this.lives = 3;
    this.weaponType = 'vulcan';
    this.weaponLevel = 0;
    this.invulnerableUntil = 0;
    this.gameOver = false;
    /* Bombe (a la Raiden) : reserve d'usage limite, hors rotation des 3
     * armes, declenchee par une touche dediee (B) - voir useBomb(). */
    this.bombs = 0;
    this.bombKey = this.input.keyboard.addKey('B');
    /* Bouclier : absorbe un nombre limite de coups avant de casser (voir
     * onPlayerHit) - la bulle visuelle suit le joueur en update(). */
    this.shieldCharges = 0;
    this.shieldVisual = null;
    /* Identifiant stable par ennemi (voir spawnGrunt/Zigzag/Charger/Boss)
     * - sert uniquement au laser perforant a ne pas re-toucher le meme
     * ennemi plusieurs fois de suite tant que le tir le traverse encore
     * (les deux corps restent en overlap plusieurs frames de suite). */
    this.enemyUidSeq = 0;

    this.player = this.physics.add.sprite(GAME_WIDTH / 2, GAME_HEIGHT - 70, this.playerShipAsset.texture);
    /* Le sprite (art_raw/player_ship) est deja dessine nez en haut -
     * contrairement a l'ancien triangle placeholder, aucune rotation
     * n'est necessaire ici. */
    this.player.setScale(this.playerShipAsset.scale);
    this.player.setCollideWorldBounds(true);
    this.physics.world.setBounds(20, 20, GAME_WIDTH - 40, GAME_HEIGHT - 40);

    this.playerBullets = this.physics.add.group();
    this.enemyBullets = this.physics.add.group();
    this.enemies = this.physics.add.group();
    this.pickups = this.physics.add.group();

    this.cursors = this.input.keyboard.createCursorKeys();
    this.wasd = this.input.keyboard.addKeys('W,A,S,D,SPACE');

    this.lastFire = 0;

    this.scoreText = this.add.text(10, 6, 'SCORE 0', {
      fontFamily: 'monospace', fontSize: '14px', color: '#ffffff'
    });
    this.livesText = this.add.text(GAME_WIDTH - 10, 6, 'VIES 3', {
      fontFamily: 'monospace', fontSize: '14px', color: '#ffffff'
    }).setOrigin(1, 0);
    this.weaponText = this.add.text(10, GAME_HEIGHT - 20, 'VULCAIN NIV.1', {
      fontFamily: 'monospace', fontSize: '11px', color: '#9be7ff'
    });
    this.bombText = this.add.text(GAME_WIDTH - 10, GAME_HEIGHT - 20, 'BOMBES 0 (B)', {
      fontFamily: 'monospace', fontSize: '11px', color: '#ffb347'
    }).setOrigin(1, 0);

    /* Depart plus calme (1300ms, un ennemi a la fois - voir spawnWave)
     * qu'avant (900ms avec formations de plusieurs ennemis possibles
     * des le debut) - retour utilisateur : "c'est difficile quand meme"
     * des l'ouverture. La difficulte grimpe ensuite progressivement via
     * rampDifficulty. */
    this.spawnEvent = this.time.addEvent({
      delay: 1300, loop: true, callback: this.spawnWave, callbackScope: this
    });
    this.difficultyEvent = this.time.addEvent({
      delay: 5000, loop: true, callback: this.rampDifficulty, callbackScope: this
    });
    window.FiveCadeGame._registerMainScene(this);

    this.physics.add.overlap(this.playerBullets, this.enemies, this.onBulletHitsEnemy, null, this);
    this.physics.add.overlap(this.player, this.enemyBullets, this.onPlayerHit, null, this);
    this.physics.add.overlap(this.player, this.enemies, this.onPlayerHit, null, this);
    this.physics.add.overlap(this.player, this.pickups, this.onPickup, null, this);

    /* Vitrine de sprites pour capture d'ecran/preview hors FiveM
     * uniquement (?showcase=1) - sans effet en jeu normal. */
    if (/[?&]showcase=1/.test(location.search)) {
      this.spawnEvent.remove(false);
      this.difficultyEvent.remove(false);
      /* Le boss est place a la meme coordonnee X que le joueur
       * (GAME_WIDTH/2 des deux cotes) - un de ses 10 tirs radiaux part
       * donc pile droit vers le bas et finit toujours par toucher le
       * joueur au bout de quelques secondes, meme si "rien ne bouge"
       * en apparence. Invulnerabilite permanente ici, purement pour la
       * vitrine de dev - sans effet en jeu normal. */
      this.invulnerableUntil = Infinity;
      /* setPosition() ne touche pas la velocite : sans ce re-zero, ces
       * ennemis "poses" gardaient leur vitesse de spawn (et le charger
       * son comportement de fonçage vers le joueur programme dans
       * spawnCharger), donc continuaient a avancer et finissaient par
       * toucher le joueur quelques secondes apres l'affichage - la
       * vitrine n'etait donc pas vraiment statique. */
      this.spawnGrunt(220); this.enemies.getChildren()[0].setPosition(220, 220).setVelocity(0, 0);
      this.spawnZigzag(500); this.enemies.getChildren()[1].setPosition(500, 220).setVelocity(0, 0);
      this.spawnCharger(); this.enemies.getChildren()[2].setPosition(780, 220).setVelocity(0, 0);
      this.time.delayedCall(950, function () {
        var chargerEnemy = this.enemies.getChildren()[2];
        if (chargerEnemy && chargerEnemy.active) {
          chargerEnemy.setPosition(780, 220).setVelocity(0, 0);
        }
      }, null, this);
      this.spawnBoss();

      var showcasePickups = ['vulcan', 'laser', 'missile'];
      var self = this;
      showcasePickups.forEach(function (t, i) {
        var p = self.pickups.create(300 + i * 150, 400, 'pickup-' + t);
        p.setScale(0.7);
        p.weaponType = t;
        p.setVelocity(0, 0);
      });
      var lifeShowcase = this.pickups.create(750, 400, 'pickup-life');
      lifeShowcase.setScale(0.5);
      lifeShowcase.isLifePickup = true;
      lifeShowcase.setVelocity(0, 0);
      var bombShowcase = this.pickups.create(850, 400, 'pickup-bomb');
      bombShowcase.setScale(0.6);
      bombShowcase.isBombPickup = true;
      bombShowcase.setVelocity(0, 0);
      var shieldShowcase = this.pickups.create(950, 400, 'pickup-shield');
      shieldShowcase.setScale(0.6);
      shieldShowcase.isShieldPickup = true;
      shieldShowcase.setVelocity(0, 0);

      this.fireEnemyBullet(300, 520, 0, 0, COLORS.gruntBullet);
      this.fireEnemyBullet(400, 520, 0, 0, COLORS.zigzagBullet);
      this.fireEnemyBullet(500, 520, 0, 0, COLORS.bossBullet);
      var bv = this.playerBullets.create(600, 520, 'shot-generic');
      bv.setScale(WEAPON_TYPES.vulcan.bulletScale); bv.setTint(WEAPON_TYPES.vulcan.bulletColor); bv.setVelocity(0, 0);
      var bl = this.playerBullets.create(680, 520, 'shot-generic');
      bl.setScale(WEAPON_TYPES.laser.bulletScale); bl.setTint(WEAPON_TYPES.laser.bulletColor); bl.setVelocity(0, 0);
      var bm = this.playerBullets.create(760, 520, 'shot-generic');
      bm.setScale(WEAPON_TYPES.missile.bulletScale); bm.setTint(WEAPON_TYPES.missile.bulletColor); bm.setVelocity(0, 0);
    }
  }

  /* Lance la rotation de musiques de partie : ordre melange, une piste a
   * la fois, chainee via queueNextGameplayTrack (fondu enchaine, jamais
   * de coupure nette entre deux morceaux). */
  startGameplayMusic() {
    this.musicPlaylist = Phaser.Utils.Array.Shuffle(this.gameplayTracks.slice());
    this.musicIndex = 0;
    this.currentMusic = null;
    this.queueNextGameplayTrack(true);
  }

  queueNextGameplayTrack(isFirst) {
    var key = this.musicPlaylist[this.musicIndex];
    var sound = safeAddMusic(this, key, { loop: false, volume: isFirst ? MUSIC_VOLUME : 0 });
    if (!sound) {
      /* Piste pas prete/indisponible - retente au prochain morceau au
       * lieu de casser toute la boucle de rotation. */
      var retrySelf = this;
      this.musicTimer = this.time.delayedCall(2000, function () {
        retrySelf.queueNextGameplayTrack(isFirst);
      });
      return;
    }

    var oldMusic = this.currentMusic;
    this.currentMusic = sound;

    if (oldMusic) {
      this.tweens.add({
        targets: oldMusic, volume: 0, duration: MUSIC_CROSSFADE_MS,
        onComplete: function () { oldMusic.stop(); oldMusic.destroy(); }
      });
    }
    if (!isFirst) {
      this.tweens.add({ targets: sound, volume: MUSIC_VOLUME, duration: MUSIC_CROSSFADE_MS });
    }

    var self = this;
    var durationMs = (sound.duration || 150) * 1000;
    var delay = Math.max(2000, durationMs - MUSIC_CROSSFADE_MS);
    this.musicTimer = this.time.delayedCall(delay, function () {
      self.musicIndex = (self.musicIndex + 1) % self.musicPlaylist.length;
      if (self.musicIndex === 0) {
        self.musicPlaylist = Phaser.Utils.Array.Shuffle(self.musicPlaylist);
      }
      self.queueNextGameplayTrack(false);
    });
  }

  /* Fait deriver le fond spatial vers la teinte suivante de la palette,
   * en fondu doux (jamais de coupure brutale) - purement decoratif,
   * n'affecte ni le gameplay ni la lisibilite (les teintes restent
   * toutes tres sombres). */
  driftBackgroundColor() {
    this.bgColorIndex = (this.bgColorIndex + 1) % SPACE_PALETTE.length;
    var target = SPACE_PALETTE[this.bgColorIndex];
    var self = this;
    this.tweens.add({
      targets: this.bgColor, r: target.r, g: target.g, b: target.b,
      duration: 6000, ease: 'Sine.easeInOut',
      onUpdate: function () {
        self.cameras.main.setBackgroundColor(
          Phaser.Display.Color.GetColor(Math.round(self.bgColor.r), Math.round(self.bgColor.g), Math.round(self.bgColor.b))
        );
      }
    });
  }

  /* Courbe de difficulte etalee sur ~95s (1300ms -> 350ms par paliers de
   * 50ms toutes les 5s, 19 paliers) plutot que ~45s (900->380 par -60) -
   * laisse largement le temps de s'habituer avant que ca devienne
   * vraiment intense, tout en gardant un plafond legerement plus corse
   * en fin de ramp pour compenser le depart plus doux. */
  rampDifficulty() {
    if (this.spawnEvent.delay > 350) {
      this.spawnEvent.delay -= 50;
      this.spawnEvent.remove(false);
      this.spawnEvent = this.time.addEvent({
        delay: this.spawnEvent.delay || 1300, loop: true, callback: this.spawnWave, callbackScope: this
      });
    }
  }

  spawnWave() {
    if (this.gameOver) {
      return;
    }
    var bossThreshold = this.score > 0 && this.score % 500 < 20;
    if (bossThreshold && !this.bossActive) {
      this.spawnBoss();
      return;
    }

    /* Vraie variete "procedurale" : parfois une formation groupee
     * (plusieurs ennemis d'un coup) plutot qu'un seul ennemi isole -
     * mais seulement une fois la cadence deja bien montee (voir
     * rampDifficulty) : les autoriser des le tout debut de partie
     * cumulait plusieurs ennemis d'un coup avant meme que le joueur
     * ait pu s'echauffer, ce qui rendait l'ouverture disproportionnee-
     * ment dure par rapport au reste de la courbe. */
    if (this.spawnEvent.delay <= 700) {
      var formationRoll = Math.random();
      if (formationRoll < 0.22) {
        this.spawnFormation('grunt-row');
        return;
      } else if (formationRoll < 0.36) {
        this.spawnFormation('zigzag-pair');
        return;
      }
    }

    var roll = Math.random();
    if (roll < 0.45) {
      this.spawnGrunt();
    } else if (roll < 0.8) {
      this.spawnZigzag();
    } else {
      this.spawnCharger();
    }
  }

  spawnFormation(kind) {
    if (kind === 'grunt-row') {
      var count = Phaser.Math.Between(3, 4);
      var spacing = GAME_WIDTH / (count + 1);
      for (var i = 1; i <= count; i++) {
        this.spawnGrunt(spacing * i);
      }
    } else if (kind === 'zigzag-pair') {
      var baseX = Phaser.Math.Between(80, GAME_WIDTH - 80);
      this.spawnZigzag(baseX - 40);
      this.spawnZigzag(baseX + 40);
    }
  }

  spawnGrunt(fixedX) {
    var x = fixedX !== undefined ? fixedX : Phaser.Math.Between(30, GAME_WIDTH - 30);
    var e = this.enemies.create(x, -20, this.enemyAssets.grunt.texture);
    e.setScale(this.enemyAssets.grunt.scale);
    e.enemyType = 'grunt';
    e.uid = ++this.enemyUidSeq;
    e.hp = 1;
    e.setVelocityY(Phaser.Math.Between(70, 110));
    e.fireEvent = this.time.addEvent({
      delay: Phaser.Math.Between(900, 1400), loop: true,
      callback: function () {
        if (!e.active) { return; }
        this.fireEnemyBullet(e.x, e.y, 0, 220, COLORS.gruntBullet);
      }, callbackScope: this
    });
  }

  spawnZigzag(fixedX) {
    var x = fixedX !== undefined ? fixedX : Phaser.Math.Between(40, GAME_WIDTH - 40);
    var e = this.enemies.create(x, -20, this.enemyAssets.zigzag.texture);
    e.setScale(this.enemyAssets.zigzag.scale);
    e.enemyType = 'zigzag';
    e.uid = ++this.enemyUidSeq;
    e.hp = 2;
    e.baseX = x;
    e.oscillation = Phaser.Math.FloatBetween(2, 4);
    e.setVelocityY(Phaser.Math.Between(60, 90));
    e.fireEvent = this.time.addEvent({
      delay: Phaser.Math.Between(1100, 1600), loop: true,
      callback: function () {
        if (!e.active) { return; }
        var dx = this.player.x - e.x;
        var dy = this.player.y - e.y;
        var len = Math.sqrt(dx * dx + dy * dy) || 1;
        this.fireEnemyBullet(e.x, e.y, (dx / len) * 200, (dy / len) * 200, COLORS.zigzagBullet);
      }, callbackScope: this
    });
  }

  spawnCharger() {
    var x = Phaser.Math.Between(30, GAME_WIDTH - 30);
    var e = this.enemies.create(x, -20, this.enemyAssets.charger.texture);
    e.setScale(this.enemyAssets.charger.scale);
    e.enemyType = 'charger';
    e.uid = ++this.enemyUidSeq;
    e.hp = 1;
    e.charging = false;
    e.setVelocityY(40);
    this.time.delayedCall(Phaser.Math.Between(500, 900), function () {
      if (!e.active) { return; }
      e.charging = true;
      var dx = this.player.x - e.x;
      var dy = this.player.y - e.y;
      var len = Math.sqrt(dx * dx + dy * dy) || 1;
      e.setVelocity((dx / len) * 320, (dy / len) * 320);
    }, null, this);
  }

  spawnBoss() {
    this.bossActive = true;
    var e = this.enemies.create(GAME_WIDTH / 2, 90, this.enemyAssets.boss.texture);
    e.setScale(this.enemyAssets.boss.scale);
    e.enemyType = 'boss';
    e.uid = ++this.enemyUidSeq;
    e.hp = 40;
    e.maxHp = 40;
    e.setImmovable(true);
    e.body.setVelocity(0, 0);
    e.moveDir = 1;
    e.hpBar = this.add.rectangle(GAME_WIDTH / 2, 16, 200, 6, 0xff3a5e).setDepth(5);
    e.hpBarBg = this.add.rectangle(GAME_WIDTH / 2, 16, 200, 6).setStrokeStyle(1, 0xffffff).setDepth(4);
    e.fireEvent = this.time.addEvent({
      delay: 1400, loop: true,
      callback: function () {
        if (!e.active) { return; }
        var bulletCount = 10;
        for (var i = 0; i < bulletCount; i++) {
          var angle = (Math.PI * 2 * i) / bulletCount;
          this.fireEnemyBullet(e.x, e.y, Math.cos(angle) * 150, Math.sin(angle) * 150, COLORS.bossBullet);
        }
      }, callbackScope: this
    });
  }

  fireEnemyBullet(x, y, vx, vy, color) {
    /* Un seul sprite de tir generique (art_raw/vfx), teinte par
     * faction plutot qu'un fichier different par couleur. */
    var b = this.enemyBullets.create(x, y, 'shot-generic');
    b.setScale(0.24);
    b.setTint(color);
    b.setVelocity(vx, vy);
  }

  firePlayerBullet() {
    var weapon = WEAPON_TYPES[this.weaponType];
    var level = weapon.levels[this.weaponLevel];
    var angles;
    if (level.pattern === 'single') {
      angles = [0];
    } else if (level.pattern === 'spread3') {
      angles = [-0.12, 0, 0.12];
    } else {
      angles = [-0.24, -0.12, 0, 0.12, 0.24];
    }
    var self = this;
    angles.forEach(function (a) {
      var b = self.playerBullets.create(self.player.x, self.player.y - 16, 'shot-generic');
      b.setTint(weapon.bulletColor);
      b.damage = weapon.damage;
      /* Effets propres a chaque arme (voir onBulletHitsEnemy) : le
       * laser transperce plusieurs ennemis, le missile explose en zone
       * a l'impact - hitSet evite qu'un tir perforant re-degate le
       * meme ennemi plusieurs frames de suite tant qu'il le traverse. */
      b.pierceLeft = level.pierce || 0;
      b.hitSet = {};
      b.splashRadius = level.splashRadius || 0;
      /* Forme du projectile selon l'arme, pour que chacune se
       * reconnaisse d'un coup d'oeil (retour utilisateur : le laser
       * "ne fait que tirer vite", sans identite visuelle) - le sprite
       * generique (une ellipse) est simplement etire different : le
       * laser en long trait fin façon rayon, le missile plus massif,
       * le vulcain legerement etire pour un peu plus de "punch" qu'un
       * simple point rond. setRotation(a) aligne l'etirement sur la
       * direction reelle du tir (utile pour les tirs en eventail). */
      if (self.weaponType === 'laser') {
        b.setScale(weapon.bulletScale * 0.5, weapon.bulletScale * 2.8);
      } else if (self.weaponType === 'missile') {
        b.setScale(weapon.bulletScale * 1.1);
      } else {
        b.setScale(weapon.bulletScale * 0.9, weapon.bulletScale * 1.4);
      }
      b.setRotation(a);
      /* angle 0 = tout droit vers le haut ; +-a devie sur les cotes */
      b.setVelocity(Math.sin(a) * weapon.bulletSpeed, -Math.cos(a) * weapon.bulletSpeed);
    });
  }

  onBulletHitsEnemy(bullet, enemy) {
    /* Un tir perforant (laser) reste en overlap avec le meme ennemi
     * plusieurs frames de suite tant qu'il le traverse - hitSet evite
     * de lui infliger les degats une deuxieme fois pendant ce passage. */
    if (bullet.hitSet[enemy.uid]) {
      return;
    }
    bullet.hitSet[enemy.uid] = true;

    enemy.hp -= (bullet.damage || 1);
    if (enemy.hp <= 0) {
      this.killEnemy(enemy);
    } else if (enemy.enemyType === 'boss') {
      enemy.hpBar.width = 200 * Math.max(enemy.hp, 0) / enemy.maxHp;
    }

    if (bullet.splashRadius > 0) {
      this.splashDamage(bullet.x, bullet.y, bullet.splashRadius, enemy);
    }

    if (bullet.pierceLeft > 0) {
      bullet.pierceLeft -= 1;
    } else {
      bullet.destroy();
    }
  }

  /* Missile : explosion en zone a l'impact - degate (et peut achever)
   * tous les ennemis proches en plus de celui touche directement,
   * avec un anneau visuel qui grandit et s'efface pour bien montrer le
   * rayon de l'explosion (l'effet etait invisible avant : un simple
   * degat double ne se voit pas quand la plupart des ennemis n'ont
   * qu'1 PV). */
  splashDamage(x, y, radius, excludeEnemy) {
    /* Flash bref et lumineux au centre (le "boom") en plus de l'anneau
     * qui trace le rayon - l'anneau seul se lisait bien en demo statique
     * mais passait presque inapercu en plein combat, retour utilisateur
     * sur le manque de "punch" visuel des armes. */
    var flash = this.add.circle(x, y, radius * 0.35, 0xffe0a3, 0.95).setDepth(7);
    this.tweens.add({
      targets: flash, radius: radius * 0.9, alpha: 0, duration: 160,
      onComplete: function (tw, targets) { targets[0].destroy(); }
    });
    var ring = this.add.circle(x, y, 4, 0xffffff, 0).setStrokeStyle(4, COLORS.missile, 1).setDepth(6);
    this.tweens.add({
      targets: ring, radius: radius, alpha: 0, duration: 260,
      onComplete: function (tw, targets) { targets[0].destroy(); }
    });

    var self = this;
    this.enemies.getChildren().forEach(function (other) {
      if (other === excludeEnemy || !other.active) {
        return;
      }
      var d = Phaser.Math.Distance.Between(x, y, other.x, other.y);
      if (d > radius) {
        return;
      }
      other.hp -= 1;
      if (other.hp <= 0) {
        self.killEnemy(other);
      } else if (other.enemyType === 'boss') {
        other.hpBar.width = 200 * Math.max(other.hp, 0) / other.maxHp;
      }
    });
  }

  killEnemy(enemy) {
    this.spawnExplosion(enemy.x, enemy.y);
    var points = enemy.enemyType === 'boss' ? 500 : (enemy.enemyType === 'zigzag' ? 30 : 15);
    this.addScore(points);

    if (enemy.enemyType === 'boss') {
      this.bossActive = false;
      if (enemy.hpBar) { enemy.hpBar.destroy(); }
      if (enemy.hpBarBg) { enemy.hpBarBg.destroy(); }
    }
    if (enemy.fireEvent) {
      enemy.fireEvent.remove(false);
    }
    /* Table de drop a un seul tirage cumulatif (plutot que plusieurs
     * Math.random() independants) pour que chaque pourcentage soit
     * exact et facile a retoucher : vie 4%, bombe 3%, bouclier 5%, arme
     * 14% (26% de drop au total), 74% rien - assez genereux pour rester
     * jouable malgre la difficulte, sans noyer le joueur en bonus
     * (bombe/bouclier restent volontairement plus rares qu'une arme). */
    var roll = Math.random();
    if (roll < 0.04) {
      var lifeUp = this.pickups.create(enemy.x, enemy.y, 'pickup-life');
      lifeUp.setScale(0.5);
      lifeUp.isLifePickup = true;
      lifeUp.setVelocity(0, 55);
    } else if (roll < 0.07) {
      var bombUp = this.pickups.create(enemy.x, enemy.y, 'pickup-bomb');
      bombUp.setScale(0.6);
      bombUp.isBombPickup = true;
      bombUp.setVelocity(0, 55);
    } else if (roll < 0.12) {
      var shieldUp = this.pickups.create(enemy.x, enemy.y, 'pickup-shield');
      shieldUp.setScale(0.6);
      shieldUp.isShieldPickup = true;
      shieldUp.setVelocity(0, 55);
    } else if (roll < 0.26) {
      var pickType = Phaser.Utils.Array.GetRandom(WEAPON_TYPE_KEYS);
      var p = this.pickups.create(enemy.x, enemy.y, 'pickup-' + pickType);
      p.setScale(0.7);
      p.weaponType = pickType;
      p.setVelocity(0, 60);
    }
    enemy.destroy();
  }

  spawnExplosion(x, y) {
    for (var i = 0; i < 8; i++) {
      var spark = this.add.image(x, y, 'tex-spark');
      var angle = Math.random() * Math.PI * 2;
      var dist = Phaser.Math.Between(10, 26);
      this.tweens.add({
        targets: spark,
        x: x + Math.cos(angle) * dist,
        y: y + Math.sin(angle) * dist,
        alpha: 0,
        duration: 260,
        onComplete: function (tw, targets) { targets[0].destroy(); }
      });
    }
  }

  onPlayerHit(player, danger) {
    if (this.time.now < this.invulnerableUntil || this.gameOver) {
      return;
    }
    if (danger.enemyType) {
      this.killEnemy(danger);
    } else {
      danger.destroy();
    }
    /* Bouclier : absorbe ce coup au lieu de faire perdre une vie -
     * verifie avant loseLife(), jamais les deux sur le meme coup. Une
     * courte invulnerabilite (plus courte que celle d'une vie perdue)
     * evite qu'un second tir simultane ne consomme une deuxieme charge
     * dans la meme frame. */
    if (this.shieldCharges > 0) {
      this.shieldCharges -= 1;
      this.invulnerableUntil = this.time.now + 500;
      this.updateShieldVisual();
      return;
    }
    this.loseLife();
  }

  /* Cree/retire/redimensionne la bulle translucide autour du joueur
   * selon shieldCharges - une seule bulle visuelle pour tout le stock
   * (pas une par charge), qui s'eclaircit avec le nombre de charges
   * restantes et disparait a 0. */
  updateShieldVisual() {
    if (this.shieldCharges <= 0) {
      if (this.shieldVisual) {
        this.shieldVisual.destroy();
        this.shieldVisual = null;
      }
      return;
    }
    if (!this.shieldVisual) {
      this.shieldVisual = this.add.circle(this.player.x, this.player.y, 34, 0x3ad6ff, 0.16)
        .setStrokeStyle(2, 0x9be7ff, 0.9).setDepth(3);
    }
    this.shieldVisual.setFillStyle(0x3ad6ff, 0.1 + 0.1 * this.shieldCharges);
  }

  /* Bombe (a la Raiden) : nettoie tous les tirs ennemis a l'ecran et
   * inflige de gros degats a tout ce qui est present - tue les ennemis
   * courants d'un coup mais ne rase PAS un boss (40 PV) en un seul
   * usage, deliberement (pas d'arme cheatee, voir retour utilisateur). */
  useBomb() {
    this.bombs -= 1;
    this.bombText.setText('BOMBES ' + this.bombs + ' (B)');

    this.enemyBullets.getChildren().slice().forEach(function (b) { b.destroy(); });

    var flash = this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0xffffff, 0.85).setDepth(10);
    this.tweens.add({
      targets: flash, alpha: 0, duration: 400,
      onComplete: function (tw, targets) { targets[0].destroy(); }
    });

    var self = this;
    this.enemies.getChildren().slice().forEach(function (e) {
      e.hp -= 8;
      if (e.hp <= 0) {
        self.killEnemy(e);
      } else if (e.enemyType === 'boss') {
        e.hpBar.width = 200 * Math.max(e.hp, 0) / e.maxHp;
      }
    });
  }

  loseLife() {
    this.lives -= 1;
    this.livesText.setText('VIES ' + Math.max(this.lives, 0));
    this.invulnerableUntil = this.time.now + 1500;
    this.spawnExplosion(this.player.x, this.player.y);

    this.tweens.add({
      targets: this.player, alpha: 0.2, duration: 100, yoyo: true, repeat: 6,
      onComplete: function (tw, targets) { targets[0].setAlpha(1); }
    });

    /* VIES 0 est encore une vie en cours (convention arcade classique :
     * l'affichage montre les vies EN PLUS de celle en train d'etre
     * jouee) - le vrai game over n'arrive qu'en perdant CETTE derniere
     * vie, donc au coup suivant (lives passe sous 0), pas au moment ou
     * l'affichage atteint 0. Demande explicite : "vie = 0 n'est pas un
     * game over tant que la vie 0 n'a pas ete perdue". */
    if (this.lives < 0) {
      this.endGame();
    }
  }

  onPickup(player, pickup) {
    pickup.destroy();
    if (pickup.isLifePickup) {
      this.lives = Math.min(this.lives + 1, 5);
      this.livesText.setText('VIES ' + this.lives);
      this.addScore(50);
      return;
    }
    if (pickup.isBombPickup) {
      this.bombs = Math.min(this.bombs + 1, MAX_BOMBS);
      this.bombText.setText('BOMBES ' + this.bombs + ' (B)');
      this.addScore(50);
      return;
    }
    if (pickup.isShieldPickup) {
      this.shieldCharges = Math.min(this.shieldCharges + 1, MAX_SHIELD_CHARGES);
      this.updateShieldVisual();
      this.addScore(50);
      return;
    }
    var maxLevel = WEAPON_TYPES[pickup.weaponType].levels.length - 1;
    if (pickup.weaponType === this.weaponType) {
      this.weaponLevel = Math.min(this.weaponLevel + 1, maxLevel);
    } else {
      this.weaponType = pickup.weaponType;
      this.weaponLevel = 0;
    }
    this.weaponText.setText(WEAPON_TYPES[this.weaponType].label + ' NIV.' + (this.weaponLevel + 1));
    this.addScore(25);
  }

  addScore(n) {
    this.score += n;
    this.scoreText.setText('SCORE ' + this.score);
  }

  /* Annule toutes les minuteries de cette scene (spawn, difficulte,
   * rotation musicale, derive de fond, tirs ennemis) - necessaire avant
   * toute sortie de MainScene (game over normal OU fermeture prematuree
   * de la borne), car un scene.stop() seul ne suffit pas : un
   * this.time.delayedCall deja arme continue de se declencher meme sur
   * une scene arretee (confirme par le bug crossfade-apres-game-over
   * plus haut), ce qui relancerait de la musique/logique sur une scene
   * qu'on croit pourtant terminee. */
  cancelPendingTimers() {
    this.spawnEvent.remove(false);
    this.difficultyEvent.remove(false);
    if (this.musicTimer) { this.musicTimer.remove(false); }
    if (this.colorDriftEvent) { this.colorDriftEvent.remove(false); }
    this.enemies.getChildren().forEach(function (e) {
      if (e.fireEvent) { e.fireEvent.remove(false); }
    });
  }

  endGame() {
    this.gameOver = true;
    this.cancelPendingTimers();
    this.scene.start('GameOverScene', { score: this.score });
  }

  /* Appele quand le joueur ferme la borne (Echap) en pleine partie -
   * meme nettoyage qu'endGame() mais sans transition vers GameOverScene :
   * onOpen() redemarrera de toute facon sur un MenuScene tout neuf a la
   * prochaine ouverture, jamais sur la partie en cours. */
  hardStop() {
    if (this.gameOver) {
      return;
    }
    this.gameOver = true;
    this.cancelPendingTimers();
  }

  update(time, delta) {
    if (this.gameOver) {
      return;
    }

    var dt = delta / 1000;
    updateStarfield(this.starLayer, dt);

    var vx = 0, vy = 0;
    var speed = 220;
    if (this.cursors.left.isDown || this.wasd.A.isDown) { vx = -speed; }
    else if (this.cursors.right.isDown || this.wasd.D.isDown) { vx = speed; }
    if (this.cursors.up.isDown || this.wasd.W.isDown) { vy = -speed; }
    else if (this.cursors.down.isDown || this.wasd.S.isDown) { vy = speed; }
    this.player.setVelocity(vx, vy);

    if (Phaser.Input.Keyboard.JustDown(this.bombKey) && this.bombs > 0) {
      this.useBomb();
    }
    if (this.shieldVisual) {
      this.shieldVisual.setPosition(this.player.x, this.player.y);
    }

    if ((this.cursors.space.isDown || this.wasd.SPACE.isDown) && time > this.lastFire) {
      this.firePlayerBullet();
      this.lastFire = time + WEAPON_TYPES[this.weaponType].levels[this.weaponLevel].fireDelay;
    }

    this.cleanupOffscreen(this.playerBullets, function (o) { return o.y < -20; });
    this.cleanupOffscreen(this.enemyBullets, function (o) {
      return o.x < -20 || o.x > GAME_WIDTH + 20 || o.y < -20 || o.y > GAME_HEIGHT + 20;
    });
    this.cleanupOffscreen(this.enemies, function (o) { return o.y > GAME_HEIGHT + 60; });
    this.cleanupOffscreen(this.pickups, function (o) { return o.y > GAME_HEIGHT + 20; });

    this.enemies.getChildren().forEach(function (e) {
      if (e.enemyType === 'zigzag') {
        e.x = e.baseX + Math.sin(time / 250 * e.oscillation) * 40;
      }
      if (e.enemyType === 'boss') {
        e.x += e.moveDir * 60 * dt;
        if (e.x < 60 || e.x > GAME_WIDTH - 60) { e.moveDir *= -1; }
      }
    });
  }

  cleanupOffscreen(group, predicate) {
    group.getChildren().slice().forEach(function (o) {
      if (predicate(o)) {
        if (o.fireEvent) { o.fireEvent.remove(false); }
        o.destroy();
      }
    });
  }
}

/* ============================================================
 * GameOverScene
 * ============================================================ */
class GameOverScene extends Phaser.Scene {
  constructor() {
    super('GameOverScene');
  }

  init(data) {
    this.finalScore = (data && data.score) || 0;
  }

  create() {
    ALL_MUSIC_KEYS.forEach(function (key) { safeStopMusic(this, key); }, this);
    playGameOverJingle();

    this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 80, 'GAME OVER', {
      fontFamily: 'monospace', fontSize: '32px', color: '#ff3a5e'
    }).setOrigin(0.5);
    this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 20, 'SCORE : ' + this.finalScore, {
      fontFamily: 'monospace', fontSize: '18px', color: '#ffffff'
    }).setOrigin(0.5);

    /* Ecran GAME OVER seul d'abord (une touche pour continuer),
     * PUIS la saisie du nom, PUIS les options rejouer/quitter -
     * sequence en 3 etapes demandee explicitement, pas tout en meme
     * temps comme avant. */
    this.continueHint = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 40, 'Appuie sur une touche pour continuer', {
      fontFamily: 'monospace', fontSize: '13px', color: '#9be7ff'
    }).setOrigin(0.5);

    this.replayHints = [
      this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 40, 'ENTREE pour rejouer', {
        fontFamily: 'monospace', fontSize: '13px', color: '#9be7ff'
      }).setOrigin(0.5).setVisible(false),
      this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 64, 'ECHAP pour quitter', {
        fontFamily: 'monospace', fontSize: '13px', color: '#9be7ff'
      }).setOrigin(0.5).setVisible(false)
    ];

    this.keys = this.input.keyboard.addKeys('ENTER,SPACE');
    this.stage = 'gameover';

    var self = this;
    this.input.keyboard.once('keydown', function () {
      if (self.stage !== 'gameover') {
        return;
      }
      self.stage = 'naming';
      self.continueHint.setVisible(false);

      /* Nom libre pour le classement plutot que force au nom du
       * personnage FiveM - demande explicitement par l'utilisateur. */
      window.FiveCadeBridge.promptName(function (chosenName) {
        window.FiveCadeBridge.submitScore(self.finalScore, chosenName);
        self.replayHints.forEach(function (t) { t.setVisible(true); });
        self.stage = 'replay';
      });
    });
  }

  update() {
    if (this.stage !== 'replay') {
      return;
    }
    if (Phaser.Input.Keyboard.JustDown(this.keys.ENTER) || Phaser.Input.Keyboard.JustDown(this.keys.SPACE)) {
      this.scene.start('MainScene');
    }
  }
}

/* ============================================================
 * Bootstrap - cree le jeu Phaser une seule fois, le pont HTML
 * (FiveCadeGame) sert d'interface avec la NUI shell.
 * ============================================================ */
(function () {
  "use strict";

  var game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game-container',
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
    backgroundColor: '#050614',
    /* PAS pixelArt:true - l'art (vaisseau/ennemis/UI) est de
     * l'illustration detaillee, pas du vrai pixel art 8-bit, et le
     * canvas est mis a l'echelle (souvent vers le bas) dans le cadre :
     * le filtrage "nearest" que pixelArt active rendait le texte
     * illisible/deforme une fois redimensionne (voir aussi le CSS
     * canvas dans index.html) et cranelait les sprites au lieu de les
     * garder nets. */
    physics: {
      default: 'arcade',
      arcade: { gravity: { x: 0, y: 0 }, debug: false }
    },
    scene: [BootScene, MenuScene, MainScene, GameOverScene]
  });
  window.__PHASER_GAME__ = game;

  var menuSceneRef = null;
  var mainSceneRef = null;

  var currentBorneType = 'degenatron';

  window.FiveCadeGame = {
    onOpen: function (playerName, borneType) {
      /* borneType n'est connu qu'a l'ouverture (message NUI venu de
       * main.lua) - on le stocke toujours immediatement. */
      currentBorneType = borneType || 'degenatron';
      /* Marque qu'une ouverture reelle a ete demandee - lu par
       * BootScene.create() pour savoir s'il doit demarrer MenuScene (et
       * donc sa musique) des que le preload finit, voir le commentaire
       * la-bas. Sans ca la musique demarrait toute seule des la fin du
       * chargement, meme sans qu'aucun joueur n'ait jamais ouvert la
       * borne (page NUI chargee et active en fond des la connexion). */
      window.__fivecadeBorneOpenRequested = true;

      /* Si le boot (preload de tous les visuels/musiques, plusieurs Mo)
       * n'est pas encore termine, ne PAS forcer un scene.start('MenuScene')
       * ici : BootScene.create() la demarrera lui-meme une fois le
       * chargement reellement fini, et MenuScene.create() lira alors
       * currentBorneType (deja a jour ci-dessus) au bon moment. Forcer
       * le start trop tot faisait tourner MenuScene.create() AVANT que
       * les textures soient dans le cache Phaser (glitch texture
       * "manquante" repere en jeu reel juste apres un restart de la
       * resource, quand le joueur interagit avec la borne pendant que
       * le preload tourne encore). */
      if (!window.__fivecadeBootComplete) {
        return;
      }
      game.scene.stop('MainScene');
      game.scene.stop('GameOverScene');
      game.scene.stop('MenuScene');
      game.scene.start('MenuScene');
    },
    /* Fermeture de la borne (Echap) - doit couper la musique tout de
     * suite (pas juste masquer la NUI, sinon l'ambiance tourne dans le
     * vide en fond) et garantir qu'une prochaine ouverture retombe
     * toujours sur le menu, jamais sur la partie en cours ni sur l'ecran
     * de saisie du nom (si le joueur n'a pas valide son nom a temps,
     * tant pis, aucun score n'est envoye - voir cancelNamePrompt cote
     * index.html). */
    onClose: function () {
      window.__fivecadeBorneOpenRequested = false;
      if (menuSceneRef && menuSceneRef.scoresPanel) {
        menuSceneRef.closeScores();
      }
      if (mainSceneRef) {
        mainSceneRef.hardStop();
      }
      game.sound.stopAll();
      game.scene.stop('MainScene');
      game.scene.stop('GameOverScene');
      game.scene.stop('MenuScene');
      menuSceneRef = null;
      mainSceneRef = null;
    },
    onScoresUpdated: function (scores) {
      if (menuSceneRef) {
        menuSceneRef.onScoresUpdated(scores);
      }
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
