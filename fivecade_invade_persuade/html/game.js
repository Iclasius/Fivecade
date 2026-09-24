/* ============================================================
 * FiveCade - Borne Invade and Persuade
 * Run and gun infini au sol (horizontal), moteur Phaser 4 (charge en
 * local via phaser.min.js). Construit from scratch (pas de code repris
 * d'un depot tiers) - meme demarche que la borne 1 (Degenatron/
 * Penetrator), qui avait fini par abandonner son moteur open source
 * d'origine pour la meme raison.
 *
 * Pas de niveaux/boss scriptes : un seul mode survie infinie, terrain
 * plat continu (pas de plateformes a sauter - fidele a l'esprit Metal
 * Slug, qui est surtout un couloir au sol, pas un jeu de plateforme),
 * vagues de soldats + vehicules lourds generees proceduralement avec
 * une difficulte qui monte progressivement.
 *
 * Toutes les textures sont des formes generees par code (rectangles
 * colores) pour l'instant - remplacable plus tard par les vrais sprites
 * PixelLab sans toucher a la logique, meme approche que la borne 1 a son
 * tout debut ("placeholder colored-shape textures").
 * ============================================================ */

// Largeur de la vue VARIABLE : hauteur fixe 720, largeur calculee pour
// remplir exactement la decoupe du cadre de borne (index.html, #screen-wrap
// = 77.14% x 62.15% de l'ecran, cadre etire plein ecran) - demande
// utilisateur : pas de bandes noires ni de deformation, on voit juste plus
// loin. ~1590 en 16:9, jamais moins que 1280 (ancien format).
var GAME_HEIGHT = 720;
var GAME_WIDTH = (function () {
  try {
    var ratio = (window.innerWidth * 0.7714) / (window.innerHeight * 0.6215);
    if (!isFinite(ratio) || ratio <= 0) return 1280;
    return Math.round(Phaser.Math.Clamp(GAME_HEIGHT * ratio, 1280, 1920) / 2) * 2;
  } catch (e) {
    return 1280;
  }
})();
// Niveau du sol = bas de la bande de sable du decor (pack desert affiche
// x2, voir DECOR_*) : les personnages marchent sur le sable, les roches du
// decor passent au premier plan dessous (574 -> 720).
var GROUND_Y = 574;

/* --- Decor desert (pack fourni par l'utilisateur) : 3 moments (jour,
 * crepuscule, nuit), chacun decoupe en 4 bandes horizontales qui defilent
 * a des vitesses differentes (parallaxe). Affiche exactement x2 pour
 * garder des pixels nets. Le haut du ciel a ete prolonge de 24 lignes a
 * l'export pour couvrir les 720px. y/h en pixels ECRAN. */
var DECOR_SCALE = 2;
var DECOR_TEX_W = 1536;
var DECOR_BANDS = [
  { name: 'sky', y: 0, h: 308, factor: 0.04 },
  { name: 'mountains', y: 308, h: 72, factor: 0.18 },
  { name: 'plain', y: 380, h: 162, factor: 0.45 },
  { name: 'ground', y: 542, h: 178, factor: 1 }
];
// Cycle jour/nuit (secondes de partie) : fondus entre les 3 moments, le
// crepuscule sert d'etape au milieu de chaque transition (comme les 16
// images de transition du pack, qui ne changent que les couleurs).
var DAYNIGHT_PHASES = [
  { until: 60, dusk: 0, night: 0 },        // jour
  { until: 70, dusk: [0, 1], night: 0 },   // jour -> crepuscule
  { until: 80, dusk: 1, night: [0, 1] },   // crepuscule -> nuit
  { until: 125, dusk: 1, night: 1 },       // nuit
  { until: 135, dusk: 1, night: [1, 0] },  // nuit -> crepuscule
  { until: 145, dusk: [1, 0], night: 0 }   // crepuscule -> jour, puis boucle
];
// Plateformes et saut (reverifies a la demande "sans difficulte, sans
// pesanteur wtf") : gravite du monde INCHANGEE (1200) ; saut -640 = ~170px
// de haut, sommet atteint en ~0.53s. Plateforme fine (PLATFORM_H) : dessous
// a 112px du sol (le commando, 104px, passe dessous), dessus a 130px ->
// ~40px de marge au saut. PLATFORM_Y_OFFSET = hauteur de son CENTRE.
var PLATFORM_W = 260;       // texture provisoire (etiree a la longueur tiree)
var PLATFORM_W_MIN = 180;   // longueur aleatoire par plateforme
var PLATFORM_W_MAX = 340;
var PLATFORM_H = 18;
// Habillage des plateformes (passerelle bois sur echafaudage, PixelLab,
// choisie par l'utilisateur) : bord gauche + troncon de plancher repete +
// bord droit, affiches x3 -> les pieds (43px de cadre) descendent pile du
// dessus du plancher (130px) jusqu'au sable. Derriere les personnages.
var PLATFORM_ART_SCALE = 3;
var PLATFORM_ART_LEFT_W = 21;   // px du cadre
var PLATFORM_ART_RIGHT_W = 22;
var PLATFORM_ART_MID_W = 34;
var PLATFORM_ART_DECK_H = 10;
var PLATFORM_Y_OFFSET = 150 + PLATFORM_H / 2; // releve avec le commando agrandi (passe dessous : 150 px)
var PLAYER_JUMP_VY = -730; // hauteur max ~222 px : plateformes (~159 px) atteignables sans peine
// Tirs ennemis : visent la poitrine du joueur (px au-dessus du centre du
// corps) ; accroupi, les balles qui arrivent dans les 40% hauts du corps
// passent au-dessus (voir isDodgingBullets). La poitrine visee est dans
// cette zone : un tir vise sur un joueur debout rate s'il se baisse.
var PLAYER_AIM_CHEST = 26;
var PLAYER_CROUCH_DUCK = 0.4;
var WORLD_WIDTH = 60000; // assez long pour une session de survie complete

var COLORS = {
  sky: 0x2b2a1f,
  skyTop: 0x2a0f12,
  skyBottom: 0xd98a3a,
  sun: 0xffd27a,
  duneFar: 0x4a2f22,
  duneNear: 0x2e1e18,
  ground: 0x8a7a4a,
  groundTop: 0xa8955c,
  platform: 0x5a5240,
  player: 0x3a5f2b,
  playerTank: 0x5a7a2f,
  playerBullet: 0xffe066,
  soldier: 0x7a2f2f,
  soldierBullet: 0xff8a5c,
  heavy: 0x3f3f33,
  heavyBullet: 0xffcc4d,
  flyer: 0x2f6a7a,
  flyerBullet: 0x6ef0ff,
  heart: 0xff3a5e,
  bomb: 0x2b2b2b,
  rapid: 0x3ad6ff,
  explosion: 0xffe066,
  grenade: 0x4a5a2f,
  pow: 0xe8d9b0,
  elite: 0x8a1f3a,
  barrel: 0xb5541a,
  shotgun: 0xff5ad6,
  chaser: 0x9dff4d
};

/* --- Generation procedurale infinie (vagues d'ennemis + pickups) --- */
var SPAWN_AHEAD = 1500; // distance devant la camera a garder generee
var CLEANUP_BEHIND = 1200; // distance derriere le joueur avant nettoyage
var BASE_SPAWN_INTERVAL = 2200; // ms entre deux vagues au tout debut
var MIN_SPAWN_INTERVAL = 900; // ms entre deux vagues a difficulte max
var DIFFICULTY_RAMP_DISTANCE = 30000; // ~4-5 min de marche pour atteindre la difficulte max (8000 = ~1 min, trop court)
// Au-dela de la difficulte max, le plafond d'ennemis actifs continue de
// monter doucement (+1 tous les OVERTIME_STEP px, jusqu'a +OVERTIME_MAX) :
// une partie finit toujours par se terminer (banc d'essai : 3 parties sur 6
// duraient encore apres 15 min avec l'ancien reglage).
var OVERTIME_STEP = 12000;
var OVERTIME_MAX = 4;
var HEAVY_UNLOCK_DISTANCE = 2500;
var MAX_ACTIVE_ENEMIES = 6; // evite l'entassement si le joueur reste sur place
var SOLDIER_ENGAGE_DISTANCE = 320; // s'arrete pour tirer au lieu de foncer au contact
var HEAVY_ENGAGE_DISTANCE = 420;
var ENEMY_SEPARATION = 80; // ecart minimum vise entre deux ennemis pour eviter qu'ils se superposent (agrandi avec les sprites)
var SOLDIER_RETREAT_DISTANCE = 170; // recule si le joueur s'approche trop (pas les tanks - eux restent agressifs)
/* --- IA "intelligente" : couvert derriere un baril + hauteur sur les
 * plateformes. Pour la hauteur, on a delibere DEUX approches : simuler
 * un vrai saut dynamique (comme le joueur) pendant le combat, ou placer
 * directement un soldat en hauteur des la creation de la plateforme.
 * Mesure empiriquement (voir tests du saut joueur) : la fenetre de
 * timing pour atterrir PILE sur une plateforme en sautant ne represente
 * qu'environ 13% de la distance parcourue pendant le saut - viable pour
 * un joueur qui vise, beaucoup trop fragile pour une IA a chaque vague
 * sans risquer des sauts rates/glissades visibles (exactement le genre
 * de bug qu'on veut eviter). Placement direct choisi a la place : zero
 * risque de desync, meme technique deja fiable que le mode tank. */
var COVER_SEEK_RANGE = 320; // distance a laquelle un soldat repere un baril comme abri potentiel
// COVER_STAND_GAP doit rester SUPERIEUR a BARREL_BLAST_RADIUS (teste :
// a 34px le soldat mourait systematiquement du souffle du baril qui le
// couvrait des qu'un tir le detruisait, rendant le couvert inutile -
// desormais hors du rayon de son propre abri quand il explose, un tir
// qui detruit le baril ne tue plus automatiquement le soldat derriere).
var COVER_STAND_GAP = 150; // distance a laquelle il se poste derriere le baril (cote oppose au joueur)
var PLATFORM_SOLDIER_CHANCE = 0.3;
var SCORES_VISIBLE = 10; // lignes visibles a la fois dans le panneau des scores (deroulant)
// Classement limite aux 25 meilleurs (demande utilisateur) - doit matcher
// MAX_SCORES_PER_BORNE de fivecade_highscore/server.lua. Un score qui ne bat
// pas le 25e n'entre pas : on ne demande alors pas de nom en fin de partie.
var LEADERBOARD_SIZE = 25;
var latestLeaderboard = null; // dernier classement recu du serveur (null = inconnu)
var PERCHED_EDGE_INSET = 40; // centre du panda perche a 40 px du bord gauche (corps entierement sur la plateforme) // probabilite qu'une plateforme genere un soldat en hauteur
var SOLDIER_FIRE_DELAY_MIN = 1000;
var SOLDIER_FIRE_DELAY_MAX = 2100;
// Sprite panda (cadre 64x64) : pieds a 27px sous le centre du cadre, bout
// du canon a (+26, +6) du centre quand il regarde a droite.
var PANDA_FEET_FROM_CENTER = 27;
var PANDA_MUZZLE_X = 26;
var PANDA_MUZZLE_Y = 6;
// Sprite ours polaire (elite, cadre 64x64) : memes reperes que le panda.
var BEAR_FEET_FROM_CENTER = 19;
var BEAR_MUZZLE_X = 24;
var BEAR_MUZZLE_Y = -4;
// Couche a 90deg, le bas visible du panda comme de l'ours est a 21px du
// centre du cadre (demi-largeur du dessin cote dos). En pixels du cadre
// NON agrandi : multiplie par l'echelle de l'unite a l'usage.
var CORPSE_LYING_HALF = 21;

/* --- PASSE D'ECHELLE (validee par l'utilisateur, 2026-09-24) : taille
 * d'affichage de chaque unite, commando = reference x2 (120px, pixels
 * nets comme le decor). Hierarchie : panda < commando < ours, elan gros
 * animal, dromadaire a peu pres a hauteur du commando (tourelle au niveau
 * de sa tete - corrige a la demande). Les corps physiques sont definis en
 * pixels du cadre et grandissent donc avec ces echelles ; tous les reperes
 * (pieds, bout du canon, couche) sont multiplies par elles a l'usage. */
var PLAYER_SCALE = 2.5; // ~150 px (agrandi : unites jugees trop petites en jeu)
var PANDA_SCALE = 2.3; // ~124 px, proche du commando
var BEAR_SCALE = 2.9;
var MOOSE_SCALE = 2.9;
var FLYER_SCALE = 2.0;
var TANK_SCALE = 3.6; // ~162 px de haut : domine le commando (150 px)
// Corps du tank en px du cadre : 36 de haut x 3 = 108px < 117px (dessous
// des plateformes) - le haut de la tourelle ne compte pas, sinon le tank
// ne passait plus sous les plateformes.
var TANK_BODY_W = 78;
var TANK_BODY_H = 36;
var OIL_SCALE = 3.8; // ~99 px de haut : TOUS les barils ont la meme taille, et depassent la ligne de tir debout (~92 px)
// Ennemi lourd = dromadaire a tourelle (cadre 64x64, affiche x CAMEL_SCALE,
// voir la passe d'echelle plus haut). Reperes en pixels du
// cadre NON agrandi : pieds a 26px sous le centre, bout du canon a
// (+13, -14), haut du dessin a 21px au-dessus du centre.
var CAMEL_SCALE = 2.9;
var CAMEL_FEET_FROM_CENTER = 26;
var CAMEL_MUZZLE_X = 13;
var CAMEL_MUZZLE_Y = -14;
var CAMEL_TOP_FROM_CENTER = 21;

/* --- Charge (elan a chapeau de la Police montee) - seul ennemi de corps
 * a corps : il ne tire pas, il oblige a bouger. Cycle : approche au pas ->
 * arret + "!" et clignotement rouge (le signal pour esquiver) -> charge
 * en ligne droite dans une direction FIGEE au depart (on l'esquive en
 * sautant par-dessus ou en le tuant avant) -> recuperation, puis recommence.
 * Pendant la charge il fait sauter les barils qu'il percute. Cadre 64x64
 * (frame 0 = arret, 1-4 = galop), pieds a 21px sous le centre. */
var CHARGER_UNLOCK_DISTANCE = 3000;
var CHARGER_SPAWN_CHANCE = 0.18; // part des vagues "soldat" remplacees par un elan
var CHARGER_HP = 4;
var CHARGER_SCORE = 120;
var CHARGER_APPROACH_SPEED = 55;
var CHARGER_TRIGGER_DISTANCE = 480;
var CHARGER_WINDUP_MS = 650;
var CHARGER_SPEED = 430;
var CHARGER_OVERSHOOT = 260; // continue sur sa lancee apres avoir depasse le joueur
var CHARGER_MAX_CHARGE_MS = 2200;
var CHARGER_RECOVER_MS = 900;
var CHARGER_KNOCKBACK = 50;
var MOOSE_FEET_FROM_CENTER = 21;
var MOOSE_TOP_FROM_CENTER = 21;

/* --- Unite volante (remplace l'ancien sniper statique sur plateforme) -
 * menace aerienne independante des plateformes, hors de portee au corps
 * a corps, qui oblige a viser vers le haut plutot que de juste s'arreter
 * sous une passerelle. Vole a altitude fixe visee (avec un leger
 * flottement sinusoidal purement cosmetique, rappel en douceur via
 * setVelocityY - jamais une ecriture directe de la position, meme
 * principe "toujours passer par la vitesse physique" que le reste du
 * fichier, pour ne pas rejouer le piege du redimensionnement d'
 * accroupissement qui desynchronisait le corps physique). */
var FLYER_UNLOCK_DISTANCE = 1200;
var FLYER_HP = 2;
var FLYER_SCORE = 80;
// Centre du drone au-dessus du sol. Mesure : tete du joueur a 259px au
// sommet du saut ; bas du drone = altitude - 38 (demi-hauteur x1.6) - 26
// (flottement) -> 340 laisse ~17px de marge. Haut du drone a 430 : reste
// sous l'interface.
var FLYER_ALTITUDE_MIN = 340; // hauteur AU-DESSUS du sol
var FLYER_ALTITUDE_MAX = 430;
var FLYER_BOB_AMPLITUDE = 26;
var FLYER_BOB_SPEED = 1.6; // rad/s
var FLYER_SPEED = 90;
var FLYER_ENGAGE_DISTANCE = 260;
var FLYER_FIRE_DELAY_MIN = 900;
var FLYER_FIRE_DELAY_MAX = 1800;

/* --- Accroupissement (touche BAS) - texture alternative (meme cadre
 * 30x52 que tex-player, juste la moitie basse dessinee) + regle logique
 * d'esquive (voir isDodgingBullets), immobile le temps de rester baisse
 * (pas de mouvement accroupi, comme dans le vrai Metal Slug). PAS de
 * setScale ici : teste et confirme que dans ce build, setScale() sur un
 * sprite physique redimensionne reellement le corps Arcade a chaque
 * frame (le corps suit scaleY en continu, pas juste au moment de l'appel)
 * - avec ce build, ca provoquait un veritable passage a travers le sol
 * pres d'un obstacle (le corps retreci perdait le contact, retombait,
 * puis reprenait sa taille pleine en pleine chute, ce qui faisait sauter
 * la detection de collision). Un simple changement de texture, memes
 * dimensions de cadre, laisse le corps physique totalement inchange. */
var STAND_HEIGHT = 52;
var CROUCH_BODY_H = 42; // hauteur du CORPS physique accroupi (cadre), pieds au meme niveau - vraie esquive
var CROUCH_HEIGHT = 28; // hauteur du dessin dans le cadre accroupi (le cadre texture reste 30x52, identique)
var PLAYER_REST_Y = GROUND_Y - STAND_HEIGHT * PLAYER_SCALE / 2; // centre du corps du joueur debout au repos (corps 52px x PLAYER_SCALE)
// Sprite du commando (planche 64x84, oriente vers la droite) : 0 repos,
// 1-2 pas de marche, 3 accroupi, 4 saut, 5 visee haut, 6 visee bas (en
// l'air). 20px de marge en haut du cadre pour le fusil leve. L'ORIGINE du
// sprite est placee au centre du corps physique 30x52 (torse x=28, y=56
// dans le cadre) : player.x/y restent donc exactement le centre du corps
// comme avec l'ancien rectangle, rien d'autre dans le fichier ne bouge
// (PLAYER_REST_Y, esquive, visee ennemie...).
var PLAYER_FRAME_W = 64;
var PLAYER_FRAME_H = 84;
var PLAYER_TORSO_X = 28;
var PLAYER_BODY_CENTER_Y = 56;
// 7/8 : visee en DIAGONALE haut/bas (fusil pivote de 38 deg autour de la
// crosse, derive de l'image 0 - le fusil ne suivait pas le tir en diagonale).
var PLAYER_FRAME = { idle: 0, crouch: 3, jump: 4, aimUp: 5, aimDown: 6, diagUp: 7, diagDown: 8 };
var PLAYER_DIAG_TAN = Math.tan(38 * Math.PI / 180); // angle du tir en diagonale = angle du fusil dessine
var PLAYER_MUZZLE_DIAG_UP = { x: 22.4, y: -31.1 };  // bout du canon, image 7 (repere torse / centre du corps)
var PLAYER_MUZZLE_DIAG_DOWN = { x: 23.6, y: 9.5 };  // image 8
// Bout du canon par rapport au centre du corps (regard a droite).
var PLAYER_MUZZLE_FWD = { x: 30, y: -11 };
var PLAYER_MUZZLE_UP = { x: 9, y: -44 };
var PLAYER_MUZZLE_DOWN = { x: 8, y: 22 };
// Accroupi : le fusil est 11 px (cadre) plus bas que debout (mesure sur la
// planche, image 3) - sans ce repere le tir accroupi partait de la hauteur
// debout et passait au-dessus des barils rouges.
var PLAYER_MUZZLE_CROUCH = { x: 30, y: 8 }; // image accroupie abaissee de 8 px (esquive lisible)
var HERO_HEAD_EXTRA = 6;   // corps physique debout etendu jusqu'au beret (les balles traversaient le chapeau)
var ENEMY_AIM_Y = 66;      // les ennemis visent le haut de la poitrine DEBOUT (P.y - 66) : s'accroupir esquive, meme les tirs montants des pandas

/* --- Interface (fournie par l'utilisateur, EN HAUT de l'ecran) : 4
 * panneaux detoures (la barre rouge d'origine a ete retiree pour mieux
 * s'incruster dans le decor). hud_off.png = voyants eteints, hud_on.png =
 * voyants allumes. Chaque jauge = un morceau de hud_on recadre (setCrop)
 * par-dessus hud_off, a la proportion de la valeur. Texture 1280x89, les
 * panneaux occupent les lignes 20 a 79 : HUD_Y les pose a 8px du haut.
 * Coordonnees en pixels de la texture, mesurees sur l'image. */
var HUD_Y = 8 - 20;
var HUD_X = Math.round((GAME_WIDTH - 1280) / 2); // texture 1280 de large, centree dans la vue (largeur variable)
// Barre de SANTE du joueur : 10 traits (redessinee a partir du trait
// d'origine), 1 coup = 1 trait (voir PLAYER_HEALTH_MAX).
var HUD_HP_SLOTS = [[222, 238], [243, 259], [264, 280], [285, 301], [306, 322], [327, 343], [348, 364], [369, 385], [390, 406], [411, 427]];
var HUD_HP_Y = 37, HUD_HP_H = 22;
// Panneau de droite = vie du TANK, visible seulement dans le tank
// (hud_tank_off.png) : 8 traits = TANK_MAX_HP.
var HUD_TANK_SLOTS = [[874, 912], [918, 956], [962, 1000], [1006, 1044], [1050, 1088], [1094, 1132], [1138, 1176], [1182, 1220]];
var HUD_TANK_Y = 38, HUD_TANK_H = 22;
var HUD_LIVES_SCREEN = { x: 112, y: 47 };                        // petit ecran a cote de l'icone : nombre de vies
var HUD_SCORE_SCREEN = { x0: 534, x1: 772, y: 47 };              // ecran a points (icone $)
var HUD_TEXT_COLOR = '#b6ff4a';

// Sante : barre de 10 traits, 1 coup = 1 trait (degats de la balle).
// Barre vide = une vie perdue (player.hp = nombre de vies) et barre
// rechargee ; barre vide sans vie restante = fin de partie.
var PLAYER_HEALTH_MAX = 10;
var LIFE_LOST_INVULN_MS = 2000;
var LAST_LIFE_INSTANT_DAMAGE = 5; // missile / sol en feu sur la DERNIERE vie : -5 traits au lieu de la mort

/* --- Barils a ramasser, un role par couleur (demande utilisateur) :
 *   jaune "OIL" = des dollars (le score de cette borne),
 *   bleu        = de la sante (traits de la barre),
 *   vert        = +1 vie (plafonne a maxHp), le plus rare.
 * Le baril ROUGE est l'explosif (groupe barrels, pas un bonus) : il
 * saute apres BARREL_HITS tirs. Poses au sol entre deux vagues, en petite
 * rangee, pour recompenser le fait d'avancer et d'aller les chercher. */
var OIL_CHANCE = 0.11;      // par vague - divise par 2 apres test en jeu ("bien trop de barils")
var OIL_ROW_MAX = 2;
var OIL_SPACING = 34;
var OIL_SCORE = 50;
var OIL_BLUE_HEALTH = 4;    // traits rendus par un baril bleu
var OIL_BLUE_CHANCE = 0.20; // part des barils de la rangee
var OIL_GREEN_CHANCE = 0.05; // +1 vie : rare
var BARREL_HITS = 3;        // tirs pour faire sauter un baril rouge (grenade/explosion : immediat)
var BARREL_SCALE = OIL_SCALE; // meme taille que les autres barils ; 86 px > ligne de tir debout (74 px)

/* --- Stabilite du signal "au sol" - teste empiriquement : un joueur
 * parfaitement immobile au repos voit body.blocked.down/touching.down
 * clignoter true/false d'une frame a l'autre (l'engin Arcade Physics ne
 * re-detecte pas toujours le contact quand il n'y a plus de chevauchement
 * a resoudre), alors que la position elle-meme ne bouge pas du tout. Sans
 * lissage, ca faisait clignoter l'accroupissement en boucle (wantsCrouch
 * directement asservi a ce signal). Fenetre de grace courte plutot que de
 * chasser une geometrie de collision exacte, meme philosophie que
 * isDodgingBullets/le redimensionnement d'accroupissement evite plus
 * haut - un vrai saut quitte le sol bien plus longtemps que cette marge. */
var GROUND_GRACE_MS = 120;

/* Les ennemis tirent depuis le bout de leur canon vers la poitrine du
 * joueur (voir fireEnemyBullet) ; l'esquive est la vraie collision, plus
 * l'exception accroupi (voir isDodgingBullets). */

/* --- Rythme calme/intense - evite la monotonie sur une session longue.
 * Se superpose a la rampe de difficulte (DIFFICULTY_RAMP_DISTANCE, qui
 * monte une fois pour toutes) : ceci oscille par-dessus, en continu,
 * pour alterner des passages plus respirables (plus de plateformes/
 * pickups, moins d'ennemis) et des passages plus denses (plus
 * d'ennemis/lourds, cadence de spawn plus serree) meme une fois la
 * difficulte de base au maximum. */
var PACING_CYCLE_DISTANCE = 2600; // distance pour un cycle complet calme -> intense -> calme
var PACING_INTENSE_THRESHOLD = 0.78; // au-dela, declenche l'alerte "RENFORTS ENNEMIS"

/* --- Grenade (arme secondaire) - vrai projectile physique (gravite
 * activee, meme moteur que le saut du joueur, deja verifie precis au
 * pixel pres), pas une animation scriptee. Rebondit puis explose a la
 * mèche, ou immediatement au contact d'un ennemi. */
var GRENADE_VX_MIN = 180; // simple tape (charge quasi nulle)
var GRENADE_VX_MAX = 420; // charge complete
var GRENADE_VY_MIN = -380;
var GRENADE_VY_MAX = -560;
var GRENADE_CHARGE_MAX_MS = 900; // temps de maintien pour la charge complete
var GRENADE_FUSE_MS = 1500;
var GRENADE_BLAST_RADIUS = 125;
var GRENADE_MAX = 3;
// Variante "grenade renforcee" (rayon plus large) volontairement
// abandonnee apres reflexion : a part le rayon, elle n'ouvrait aucune
// nouvelle decision tactique par rapport a la grenade normale, contrairement
// au reste de l'arsenal (fusil/pompe/chasseur/tank/bombe ont chacun un
// vrai role distinct, teste). Pas de quoi justifier un slot de pickup.

/* (Plus de prisonniers a liberer : leur role de recompense est repris par
 * les barils a ramasser, voir OIL_*.) */

/* --- Fusil a pompe (2e arme ramassable) - repense en explosion instantanee
 * a courte portee (cone devant le joueur) plutot qu'en plombs individuels :
 * teste, la dispersion en plombs distincts dependait trop du hasard des
 * positions ennemies (espacement anti-entassement deja en place) pour
 * vraiment toucher plusieurs cibles - une zone garantie est plus fiable
 * et se differencie mieux du fusil normal. Touche aussi les barils dans
 * le cone (meme rayon d'action que la grenade/bombe). */
var SHOTGUN_DURATION_MS = 9000;
var SHOTGUN_RANGE = 190;
var SHOTGUN_CONE_HALF_ANGLE = 0.5; // radians, demi-largeur du cone

/* --- Tir chasseur (3e arme ramassable) - se corrige progressivement vers
 * l'ennemi actif le plus proche apres le depart (vitesse constante, virage
 * limite par frame pour rester lisible, jamais un demi-tour instantane).
 * Utile en particulier contre les unites volantes, plus dures a viser
 * precisement que les ennemis au sol. */
var CHASER_DURATION_MS = 9000;
var CHASER_SPEED = 620;
var CHASER_TURN_RATE = 4.5; // radians/s de correction max
var CHASER_RANGE = 480; // distance max pour accrocher une cible

/* --- Ennemi elite - variante plus costaude d'un soldat normal, pas un
 * boss scripte (juste plus de vie/degats/score), annoncee par son nom
 * pour donner une sensation de mini-evenement. */
var ELITE_HP = 4;
var ELITE_SCORE = 200;

/* --- Baril explosif - obstacle au sol, degats de zone au joueur ET aux
 * ennemis (y compris en chaine avec un autre baril proche). */
var BARREL_BLAST_RADIUS = 130;

/* --- Phase tank : moment fort/addictif periodique, voir spawnWave ---
 * Pas une invincibilite a duree fixe : le tank a sa PROPRE barre de vie
 * (fidele a la vraie borne "Invade and Persuade" vue en jeu, qui
 * affiche une barre distincte pour le tank) - encaisse les degats a sa
 * place tant qu'il tient, puis le joueur est ejecte et repasse a pied. */
var TANK_MAX_HP = 14; // 8 : le tank ne tenait que ~8 s (banc d'essai), trop court pour un moment fort
// Canon du tank : obus qui explose au contact comme une grenade (meme
// rayon/degats, voir blastAt), 1 tir toutes les 1.2s maxi, portee ~1240px.
var TANK_FIRE_COOLDOWN_MS = 1200;
/* --- Arrivee du tank (choix utilisateur) : un avion cargo traverse le
 * haut de l'ecran et le largue sous parachute devant le joueur ; il se
 * pose dans la poussiere avec un panneau "CHAR !" ; le joueur le touche
 * -> animation de montee (saute sur la tourelle, s'enfonce dans
 * l'ecoutille, demarrage). A la destruction : ejection par l'ecoutille et
 * la carcasse explose. */
var PLANE_SCALE = 5.5;           // ~780x210px : un vrai cargo qui domine le tank (agrandi a la demande)
var PLANE_Y = 125;               // hauteur de vol (ecran) - passe en partie derriere l'interface
var PLANE_SPEED = 520;           // px/s (traverse la vue en ~4.5s)
var PLANE_BELLY = 14;            // soute : px du cadre sous le centre de l'avion (point de largage)
var TANK_FREEFALL_MS = 420;      // chute libre avant l'ouverture du parachute
var TANK_FREEFALL_SPEED = 330;   // px/s pendant la chute libre
var CHUTE_SCALE = 3;
var TANK_FALL_SPEED = 120;       // px/s sous parachute
var TANK_DROP_AHEAD = 0.72;      // point de chute : fraction de la largeur de vue
var TANK_HATCH = { x: 3, y: -17 }; // ecoutille (haut de tourelle) / centre du cadre du tank, px du cadre
var TANK_BOARD_MS = 900;         // duree totale de l'animation de montee
var TANK_SHELL_SPEED = 620;
var TANK_SHELL_LIFE_MS = 2000;
var TANK_UNLOCK_DISTANCE = 4000; // premiere phase tank pas immediate, laisse le temps d'etre "juste" un soldat d'abord
var TANK_PICKUP_MIN_GAP = 15000; // 11000 -> 15000 apres test en jeu ("un peu moins de chars") // distance minimum entre deux pickups tank pour rester un evenement rare et attendu
var TANK_EJECT_INVULN_MS = 1200;
// Sprite du tank (cadre 96x64) : bas des chenilles a la ligne 59 (mis a
// niveau a l'export), caisse centree vers x=46, bout du canon a (+45, -8)
// du centre du cadre quand il regarde a droite.
var TANK_TREAD_BOTTOM = 59;
var TANK_HULL_CENTER_X = 46;
var TANK_MUZZLE_X = 45;
var TANK_MUZZLE_Y = -8;
var TANK_UP_ANGLE = 28 * Math.PI / 180;           // canon releve (fleche HAUT en tank)
var TANK_MUZZLE_UP = { x: 42.8, y: -16.9 };       // bout du canon releve / centre du cadre (image 1) // grace period a l'ejection, pour ne pas enchainer sur un coup fatal immediat

/* --- Frappe de missile (demande utilisateur) : a intervalle aleatoire,
 * un missile tombe du ciel sur une portion de la carte. Annonce par une
 * alerte breve + une "aura" rouge au sol qui se resserre, puis impact :
 * etre dans la zone a ce moment = MORT IMMEDIATE (une vie entiere, ou le
 * tank + une vie), quelle que soit la sante. Zone = colonne entiere
 * (sauter ou monter sur une plateforme ne protege pas) : il faut sortir
 * de la zone. Tue aussi les ennemis qui s'y trouvent.
 * Sortie depuis le centre : (MISSILE_RADIUS + 16 px de torse) / 190 px/s
 * de marche ~ 0.6 s sur 3 s de preavis : ~2.4 s pour reagir (2 s etait
 * juge beaucoup trop court par l'utilisateur, "reflexes de fou"). */
/* --- Sequences "SOL EN FEU" (demande utilisateur) : une nappe de petrole
 * enflammee couvre une portion du sol ; seule une chaine de plateformes
 * permet de passer. Toucher le sol en feu = une vie perdue (joueur replace
 * sur la plateforme la plus proche, clignotant). Les ennemis au sol qui y
 * entrent brulent ; aucun ennemi au sol ni missile pendant la traversee.
 * Ecarts entre plateformes 90-150 px (saut max a plat ~200 px). */
var FIRE_UNLOCK_DISTANCE = 3500;
var FIRE_GAP_MIN = 4500;        // distance entre deux sequences
var FIRE_GAP_MAX = 7500;
var FIRE_PLATFORMS_MIN = 5;
var FIRE_PLATFORMS_MAX = 8;
var FIRE_WARN_DISTANCE = 950;   // alerte quand le debut de la nappe arrive a cette distance
var FIRE_MARGIN = 14;           // tolerance aux bords de la nappe
var FIRE_TANK_DAMAGE_MS = 250;  // en tank : 1 point de blindage perdu toutes les 250 ms dans les flammes

var MISSILE_UNLOCK_DISTANCE = 2400;  // pas pendant les premieres secondes de jeu
var MISSILE_RADIUS = 100;            // demi-largeur de la zone mortelle (px)
var MISSILE_WARN_MS = 3000;          // preavis entre l'alerte et l'impact
var MISSILE_FALL_MS = 480;           // descente visible du missile (fin du preavis)
var MISSILE_GAP_MIN_MS = 12000;      // intervalle entre deux frappes au debut...
var MISSILE_GAP_MAX_MS = 20000;
var MISSILE_GAP_HARD_MIN_MS = 7000;  // ...et a difficulte max
var MISSILE_GAP_HARD_MAX_MS = 12000;
var MISSILE_DOUBLE_CHANCE = 0.35;    // a difficulte max : 2 zones a la fois (toujours un couloir sur entre les deux)
var MISSILE_SCALE = 6;
var MISSILE_PLAYER_HALF = 20;       // demi-largeur du torse du commando pour le test de zone

function safeCall(fn) {
  try { fn(); } catch (e) { /* ignore - contexte hors FiveM/preview */ }
}

/* Son (voir audio.js) : jamais bloquant, sans effet si le module manque. */
function playSfx(name, opts) {
  if (window.FiveCadeSound) safeCall(function () { window.FiveCadeSound.play(name, opts); });
}
function playMusic(mode) {
  if (window.FiveCadeSound) safeCall(function () { window.FiveCadeSound.startMusic(mode); });
}
function stopMusic() {
  if (window.FiveCadeSound) safeCall(function () { window.FiveCadeSound.stopMusic(); });
}

/* Decor desert partage par les 3 scenes (menu/partie/game over) - voir
 * DECOR_* en tete de fichier. Empile les 3 moments (jour dessous,
 * crepuscule puis nuit par-dessus en fondu) ; chaque moment = 4 bandes en
 * tileSprite fixes a l'ecran, dont on fait glisser la texture selon la
 * camera (parallaxe). Retourne { update(scrollX, seconds) } ; les scenes
 * menu/fin ne l'appellent pas (decor de jour immobile). */
function drawDesertBackdrop(scene, width) {
  var layers = { day: [], dusk: [], night: [] };
  ['day', 'dusk', 'night'].forEach(function (moment) {
    DECOR_BANDS.forEach(function (band) {
      var ts = scene.add.tileSprite(0, band.y, width, band.h, 'decor-' + moment + '-' + band.name)
        .setOrigin(0, 0).setScrollFactor(0).setDepth(-10);
      ts.setTileScale(DECOR_SCALE, DECOR_SCALE);
      ts.factor = band.factor;
      layers[moment].push(ts);
    });
  });
  function setAlpha(list, a) { list.forEach(function (ts) { ts.setAlpha(a); ts.setVisible(a > 0.001); }); }
  function phaseValue(v, t) { return Array.isArray(v) ? v[0] + (v[1] - v[0]) * t : v; }
  setAlpha(layers.dusk, 0);
  setAlpha(layers.night, 0);
  return {
    update: function (scrollX, seconds) {
      ['day', 'dusk', 'night'].forEach(function (m) {
        layers[m].forEach(function (ts) { ts.tilePositionX = (scrollX * ts.factor) / DECOR_SCALE; });
      });
      var cycle = DAYNIGHT_PHASES[DAYNIGHT_PHASES.length - 1].until;
      var t = seconds % cycle, start = 0;
      for (var i = 0; i < DAYNIGHT_PHASES.length; i += 1) {
        var ph = DAYNIGHT_PHASES[i];
        if (t < ph.until) {
          var k = (t - start) / (ph.until - start);
          setAlpha(layers.dusk, phaseValue(ph.dusk, k));
          setAlpha(layers.night, phaseValue(ph.night, k));
          break;
        }
        start = ph.until;
      }
    }
  };
}

/* ============================================================
 * BootScene - genere les textures placeholder puis attend l'ouverture
 * reelle de la borne avant de demarrer le menu (meme garde-fou que la
 * borne 1 : ne rien lancer tant que personne n'a vraiment interagi).
 * ============================================================ */
class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
  }

  preload() {
    // Premier vrai sprite importe (le reste est encore procedural) -
    // remplace le rectangle placeholder de l'unite volante (voir create()
    // plus bas, tex-flyer n'est plus genere par makeRectTexture).
    this.load.image('tex-flyer', 'sprites/flyer.png');
    // Soldat de base = panda (PixelLab) : frame 0 = repos, 1-4 = marche.
    // Cadres 64x64, oriente vers la droite (flipX pour l'autre sens).
    this.load.spritesheet('tex-soldier', 'sprites/panda.png', { frameWidth: 64, frameHeight: 64 });
    // Elite = ours polaire a chapka, meme format de planche que le panda.
    this.load.spritesheet('tex-soldier-elite', 'sprites/bear.png', { frameWidth: 64, frameHeight: 64 });
    // Ennemi lourd = dromadaire a tourelle, meme format de planche.
    this.load.spritesheet('tex-heavy', 'sprites/camel.png', { frameWidth: 64, frameHeight: 64 });
    // Charge = elan a chapeau de la Police montee.
    this.load.spritesheet('tex-charger', 'sprites/moose.png', { frameWidth: 64, frameHeight: 64 });
    // Tank bonus du joueur (cadre 96x64, oriente vers la droite).
    // Planche 2 images : 0 = canon horizontal, 1 = canon releve (tir en
    // diagonale, fleche HAUT) - image 1 derivee de l'image 0 par rotation
    // du canon (28 deg) autour de sa sortie de tourelle.
    this.load.spritesheet('tex-player-tank', 'sprites/tank_sheet.png', { frameWidth: 96, frameHeight: 64 });
    // Largage du tank : avion cargo + parachute (voir PLANE_* / CHUTE_*).
    this.load.image('tex-plane', 'sprites/plane.png');
    this.load.image('tex-parachute', 'sprites/parachute.png');
    this.load.image('tex-menu-bg', 'sprites/menu_bg.png'); // logo de l'accueil (fourni par l'utilisateur)
    // Commando joueur (voir PLAYER_FRAME en tete de fichier).
    this.load.spritesheet('tex-player', 'sprites/player.png', { frameWidth: PLAYER_FRAME_W, frameHeight: PLAYER_FRAME_H });
    // Interface (voir HUD_* en tete de fichier).
    this.load.image('tex-hud-off', 'sprites/hud_off.png');
    this.load.image('tex-hud-on', 'sprites/hud_on.png');
    this.load.image('tex-hud-tank-off', 'sprites/hud_tank_off.png');
    // Barils (voir OIL_* / BARREL_*) : un role par couleur.
    this.load.image('tex-oil', 'sprites/oil.png');
    // Plateformes : passerelle bois en 3 morceaux (voir PLATFORM_ART_*).
    this.load.image('tex-platform-left', 'sprites/platform_left.png');
    this.load.image('tex-platform-mid', 'sprites/platform_mid.png');
    this.load.image('tex-platform-right', 'sprites/platform_right.png');
    // Decor desert : 3 moments x 4 bandes (voir DECOR_*).
    var self = this;
    ['day', 'dusk', 'night'].forEach(function (moment) {
      DECOR_BANDS.forEach(function (band) {
        self.load.image('decor-' + moment + '-' + band.name, 'sprites/decor/' + moment + '_' + band.name + '.png');
      });
    });
    this.load.image('tex-oil-blue', 'sprites/oil_blue.png');
    this.load.image('tex-oil-green', 'sprites/oil_green.png');
    this.load.image('tex-barrel', 'sprites/barrel_red.png');
  }

  makeRectTexture(key, w, h, color) {
    var g = this.add.graphics();
    g.fillStyle(color, 1);
    g.fillRect(0, 0, w, h);
    g.generateTexture(key, w, h);
    g.destroy();
  }

  /* Petite texture pixel art a partir d'un motif texte (un caractere =
   * un pixel, '.' = transparent), chaque pixel agrandi x scale. */
  makePixelTexture(key, rows, palette, scale) {
    var g = this.add.graphics();
    rows.forEach(function (row, y) {
      for (var x = 0; x < row.length; x += 1) {
        var c = palette[row[x]];
        if (c === undefined) continue;
        g.fillStyle(c, 1);
        g.fillRect(x * scale, y * scale, scale, scale);
      }
    });
    g.generateTexture(key, rows[0].length * scale, rows.length * scale);
    g.destroy();
  }

  /* Caisse 13x13 (x3) : contour sombre, arete claire en haut, ombre en
   * bas, lettre blanche 5x7 ombree au centre. */
  makeCrateTexture(key, letter, base) {
    var GLYPHS = {
      R: ['XXXX.', 'X...X', 'X...X', 'XXXX.', 'X.X..', 'X..X.', 'X...X'],
      G: ['.XXXX', 'X....', 'X....', 'X.XXX', 'X...X', 'X...X', '.XXX.'],
      S: ['.XXXX', 'X....', 'X....', '.XXX.', '....X', '....X', 'XXXX.'],
      C: ['.XXXX', 'X....', 'X....', 'X....', 'X....', 'X....', '.XXXX']
    };
    var glyph = GLYPHS[letter];
    var rows = [];
    for (var y = 0; y < 13; y += 1) {
      var row = '';
      for (var x = 0; x < 13; x += 1) {
        var c;
        if (y === 0 || y === 12 || x === 0 || x === 12) c = 'K';
        else if (y === 1) c = 'L';
        else if (y === 11 || x === 11) c = 'D';
        else c = 'B';
        var gx = x - 4, gy = y - 3;
        if (gx >= 0 && gx < 5 && gy >= 0 && gy < 7 && glyph[gy][gx] === 'X') c = 'W';
        else if (gx - 1 >= 0 && gx - 1 < 5 && gy - 1 >= 0 && gy - 1 < 7 && glyph[gy - 1][gx - 1] === 'X' && c === 'B') c = 'D';
        row += c;
      }
      rows.push(row);
    }
    var col = Phaser.Display.Color.IntegerToColor(base);
    var light = Phaser.Display.Color.GetColor(Math.min(255, col.red + 70), Math.min(255, col.green + 70), Math.min(255, col.blue + 70));
    var dark = Phaser.Display.Color.GetColor(col.red * 0.55 | 0, col.green * 0.55 | 0, col.blue * 0.55 | 0);
    this.makePixelTexture(key, rows, { K: 0x1a1410, L: light, B: base, D: dark, W: 0xfff6e0 }, 3);
  }

  /* Flammes pixel art (64x44, repetable en largeur) : langues rouges ->
   * orange -> jaune, pixels de 2 px pour rester dans le style. */
  makeFireTexture() {
    var g = this.add.graphics();
    var W = 64, H = 44, P = 2;
    var tongues = [[4, 30], [14, 40], [24, 26], [34, 42], [46, 32], [56, 38]];
    [[0xb3261e, 1.0], [0xf06a1e, 0.72], [0xffd24a, 0.42]].forEach(function (layer) {
      g.fillStyle(layer[0], 1);
      tongues.forEach(function (t) {
        var cx = t[0], h = t[1] * layer[1], w = 12 * layer[1] + 4;
        for (var y = 0; y < h; y += P) {
          var k = 1 - y / h;
          var half = Math.max(P, Math.round((w * (0.35 + 0.65 * k)) / 2 / P) * P);
          g.fillRect(cx - half, H - P - y, half * 2, P);
        }
      });
      g.fillRect(0, H - 8 * layer[1], W, 8 * layer[1]);
    });
    g.generateTexture('tex-fire', W, H);
    g.destroy();
  }

  makeBulletTexture(key, w, h, color, core) {
    var g = this.add.graphics();
    g.fillStyle(0x1a0000, 1).fillRoundedRect(0, 0, w, h, h / 2);            // contour
    g.fillStyle(color, 1).fillRoundedRect(2, 2, w - 4, h - 4, (h - 4) / 2);  // corps
    g.fillStyle(core, 1).fillRoundedRect(w * 0.45, h * 0.3, w * 0.45, h * 0.4, h * 0.2); // coeur brillant (avant)
    g.generateTexture(key, w, h);
    g.destroy();
  }

  makeCircleTexture(key, radius, color) {
    var d = radius * 2;
    var g = this.add.graphics();
    g.fillStyle(color, 1);
    g.fillCircle(radius, radius, radius);
    g.generateTexture(key, d, d);
    g.destroy();
  }

  /* Ciel degrade coucher de soleil desertique - identite visuelle propre
   * a cette borne (pas le meme fond plat/sombre que les autres bornes),
   * inspire directement du visuel de la vraie borne "Invade and
   * Persuade" vue en jeu (ciel rouge/orange, horizon dore). */
  makeGradientTexture(key, w, h, colorTop, colorBottom) {
    var g = this.add.graphics();
    g.fillGradientStyle(colorTop, colorTop, colorBottom, colorBottom, 1);
    g.fillRect(0, 0, w, h);
    g.generateTexture(key, w, h);
    g.destroy();
  }

  /* Silhouette de dune (bord superieur ondule plutot qu'un rectangle
   * plat) - tuile en tileSprite pour un horizon desertique credible. */
  makeDuneTexture(key, w, h, color) {
    var g = this.add.graphics();
    g.fillStyle(color, 1);
    g.beginPath();
    g.moveTo(0, h);
    var segments = 5;
    for (var i = 0; i <= segments; i += 1) {
      var x = (w / segments) * i;
      var y = h * (0.3 + 0.22 * Math.sin(i * 1.9 + 0.6));
      g.lineTo(x, y);
    }
    g.lineTo(w, h);
    g.closePath();
    g.fillPath();
    g.generateTexture(key, w, h);
    g.destroy();
  }

  create() {
    // tex-player : vrai sprite (commando) charge dans preload(). L'ancien
    // tex-player-crouch n'existe plus : l'accroupi est une image de la
    // planche (meme cadre, corps physique 30x52 toujours intact).
    this.anims.create({
      key: 'hero-walk',
      frames: this.anims.generateFrameNumbers('tex-player', { frames: [1, 0, 2, 0] }),
      frameRate: 9,
      repeat: -1
    });
    // tex-player-tank : vrai sprite charge dans preload().
    // tex-soldier : vrai sprite (panda) charge dans preload().
    this.anims.create({
      key: 'panda-walk',
      frames: this.anims.generateFrameNumbers('tex-soldier', { start: 1, end: 4 }),
      frameRate: 8,
      repeat: -1
    });
    this.anims.create({
      key: 'bear-walk',
      frames: this.anims.generateFrameNumbers('tex-soldier-elite', { start: 1, end: 4 }),
      frameRate: 7,
      repeat: -1
    });
    this.anims.create({
      key: 'camel-walk',
      frames: this.anims.generateFrameNumbers('tex-heavy', { start: 1, end: 4 }),
      frameRate: 6,
      repeat: -1
    });
    this.anims.create({
      key: 'moose-gallop',
      frames: this.anims.generateFrameNumbers('tex-charger', { start: 1, end: 4 }),
      frameRate: 12,
      repeat: -1
    });
    this.makeCircleTexture('tex-muzzle', 5, COLORS.playerBullet);
    // tex-heavy : vrai sprite (dromadaire) charge dans preload().
    // tex-flyer : vrai sprite charge dans preload(), plus de rectangle ici.
    this.makeRectTexture('tex-bullet-player', 14, 5, COLORS.playerBullet);
    this.makeRectTexture('tex-bullet-tank', 22, 10, COLORS.playerBullet);
    // Balles ennemies : plus grosses, contour sombre + halo + coeur clair
    // (celles des pandas etaient quasi invisibles sur le sable).
    this.makeBulletTexture('tex-bullet-soldier', 18, 9, 0xff3a2a, 0xfff0a0);
    this.makeBulletTexture('tex-bullet-heavy', 26, 15, 0xff7a00, 0xffffc0);
    this.makeBulletTexture('tex-bullet-flyer', 18, 9, 0xd23aff, 0xffd0ff);
    // Plus de coeur ni de bombe : la sante et les vies viennent des barils
    // bleus/verts, et la bombe a ete retiree du jeu (demande utilisateur).
    // Bonus d'arme : caisses pixel art marquees d'une lettre (facon Metal
    // Slug), une couleur par bonus - remplacent les ronds provisoires.
    this.makeCrateTexture('tex-rapid', 'R', 0xd8771c);          // tir rapide
    this.makeCrateTexture('tex-grenade-pickup', 'G', 0x5f7a2c); // +1 grenade
    this.makeCrateTexture('tex-shotgun-pickup', 'S', 0xb3342b); // fusil a pompe
    this.makeCrateTexture('tex-chaser-pickup', 'C', 0x6a3aa8);  // tir chasseur
    this.makeCircleTexture('tex-tank-pickup', 13, COLORS.playerTank);
    // Fleche pixel art "monte ici" au-dessus du tank parachute (J = jaune,
    // S = reflet, K = contour sombre), dessinee pixel par pixel.
    this.makePixelTexture('tex-arrow-down', [
      '..KKKKK..',
      '..KJJSK..',
      '..KJJSK..',
      '..KJJSK..',
      '..KJJSK..',
      'KKKJJSKKK',
      'KJJJJJJSK',
      '.KJJJJJK.',
      '..KJJJK..',
      '...KJK...',
      '....K....'
    ], { K: 0x3a2a00, J: 0xffd23a, S: 0xfff2a8 }, 4);
    // Missile pixel art pointe vers le bas (A = ailerons, G = corps gris,
    // S = reflet, R = bande rouge, K = contour, F = flamme du propulseur).
    this.makePixelTexture('tex-missile', [
      '.F.F.F.',
      '..FFF..',
      'KAKKKAK',
      'KAKGSAK',
      'KKKGSKK',
      '..KGSK.',
      '..KGSK.',
      '..KRRK.',
      '..KGSK.',
      '..KGSK.',
      '..KGSK.',
      '..KRRK.',
      '..KGGK.',
      '...KK..'
    ], { K: 0x1c1c1c, A: 0x7a1a1a, G: 0x8a8f96, S: 0xd6dade, R: 0xd8262b, F: 0xffb23a }, 1);
    this.makeFireTexture();
    this.makeCircleTexture('tex-spark', 4, COLORS.explosion);
    this.makeRectTexture('tex-platform', PLATFORM_W, PLATFORM_H, COLORS.platform);
    // Ciel/soleil/dunes : remplaces par le vrai decor (voir drawDesertBackdrop).

    // Grenade a fragmentation pixel art (K contour, M levier metal, G olive,
    // L reflet, D ombre) - l'ancien rond de 12 px etait juge "pas assez
    // voyant". x3 = 24x30 px.
    this.makePixelTexture('tex-grenade', [
      '...KKK..',
      '..KMMMK.',
      '.KKKKKK.',
      'KGGLGGGK',
      'KGLLGGDK',
      'KGGGGGDK',
      'KGLGGGDK',
      'KGGGGDDK',
      '.KGDDDK.',
      '..KKKK..'
    ], { K: 0x141a0a, M: 0xc9c9bf, G: 0x6f8430, L: 0xa9c457, D: 0x3d4b17 }, 3);
    // tex-soldier-elite : vrai sprite (ours polaire) charge dans preload().
    // tex-barrel : baril explosif rouge charge dans preload().
    this.makeRectTexture('tex-bullet-chaser', 12, 5, COLORS.chaser);

    window.__fivecadeBootComplete = true;
    /* Meme garde-fou que la borne 1 : ne demarrer le menu (et sa future
     * musique) que si une vraie ouverture a deja ete demandee. */
    if (window.__fivecadeBorneOpenRequested) {
      this.scene.start('MenuScene');
    }
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
    // Fond : l'illustration du logo (fournie par l'utilisateur, 991x531).
    // Echelle choisie pour que le logo ENTIER (etoile comprise, x 50..975 et
    // y 165..470 dans l'image) tienne au-dessus du bandeau du menu, tout en
    // couvrant toute la largeur de vue ; on rogne la fumee du haut. Filtre
    // lisse : l'image est deja agrandie, un agrandissement non entier en
    // plus-proche-voisin donnerait des pixels irreguliers.
    this.cameras.main.setBackgroundColor('#1a0503');
    this.textures.get('tex-menu-bg').setFilter(Phaser.Textures.FilterMode.LINEAR);
    var LOGO = { cx: 512, w: 925, bottom: 470, h: 305 };
    var logoBottomY = GAME_HEIGHT - 106;
    var bgScale = Math.max(GAME_WIDTH / 991,
      Math.min(GAME_WIDTH * 0.97 / LOGO.w, (logoBottomY - 20) / LOGO.h));
    var bgLeft = Math.min(0, Math.max(GAME_WIDTH - 991 * bgScale, GAME_WIDTH / 2 - LOGO.cx * bgScale));
    this.add.image(bgLeft, logoBottomY - LOGO.bottom * bgScale, 'tex-menu-bg').setOrigin(0, 0).setScale(bgScale);

    // Braises qui montent des flammes (l'image est fixe, ca la fait vivre).
    for (var e = 0; e < 26; e += 1) {
      var ember = this.add.rectangle(Phaser.Math.Between(0, GAME_WIDTH), GAME_HEIGHT + 10, 4, 4,
        Phaser.Math.RND.pick([0xffd23a, 0xffa12a, 0xff6a2a]));
      this.tweens.add({
        targets: ember, y: Phaser.Math.Between(40, 380), x: '+=' + Phaser.Math.Between(-80, 80), alpha: 0,
        duration: Phaser.Math.Between(3500, 7000), delay: Phaser.Math.Between(0, 6000), repeat: -1,
        onRepeat: (function (o) { return function () { o.x = Phaser.Math.Between(0, GAME_WIDTH); o.alpha = 1; }; })(ember)
      });
    }

    // Menu : une ligne sur un bandeau sombre au-dessus des flammes, sous le
    // logo (qui occupe le centre de l'image).
    var rowY = GAME_HEIGHT - 62;
    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT - 48, GAME_WIDTH, 96, 0x0a0404, 0.82);
    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT - 96, GAME_WIDTH, 3, 0xffcc4d, 0.9);

    var items = ['NOUVELLE PARTIE', 'MEILLEURS SCORES', 'QUITTER'];
    var self = this;
    this.itemTexts = items.map(function (label, i) {
      var t = self.add.text(GAME_WIDTH / 2 + (i - 1) * 360, rowY, label, {
        fontFamily: 'monospace', fontSize: '24px', color: '#ffffff', fontStyle: 'bold',
        stroke: '#1a0804', strokeThickness: 5
      }).setOrigin(0.5).setInteractive({ useHandCursor: true });
      t.on('pointerover', function () { self.setSelected(i); });
      t.on('pointerdown', function () { self.activate(i); });
      return t;
    });
    this.cursorMark = this.add.text(0, 0, '>', {
      fontFamily: 'monospace', fontSize: '24px', color: '#ffcc4d', fontStyle: 'bold',
      stroke: '#1a0804', strokeThickness: 5
    }).setOrigin(0.5);
    this.tweens.add({ targets: this.cursorMark, alpha: 0.35, duration: 380, yoyo: true, repeat: -1 });
    this.selected = 0;
    this.setSelected(0);

    // Rappel des controles (une ligne), sous le menu.
    this.add.text(GAME_WIDTH / 2, GAME_HEIGHT - 26,
      "FLECHES bouger/viser  -  ESPACE saut  -  F tir  -  G grenade  -  BAS s'accroupir  -  M son  -  ENTREE valider", {
        fontFamily: 'monospace', fontSize: '13px', color: '#f0d9a0'
      }).setOrigin(0.5);

    this.navUp = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.UP);
    this.navDown = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.DOWN);
    this.navLeft = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT);
    this.navRight = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT);
    this.navBack = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.BACKSPACE);
    this.input.keyboard.on('keydown', function (ev) { this.onMenuKey(ev.key); }, this);
    this.navConfirmEnter = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER);
    this.navConfirmSpace = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);

    this.scoresPanel = null;
    this.scoresListText = null;

    window.FiveCadeGame._registerMenuScene(this);
    playMusic('menu');
    safeCall(function () { window.FiveCadeBridge.requestScores(); });
  }

  setSelected(i) {
    this.selected = i;
    this.itemTexts.forEach(function (t, idx) {
      t.setColor(idx === i ? '#ffcc4d' : '#ffffff');
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
    } else {
      safeCall(function () { window.FiveCadeBridge.quit(); });
    }
  }

  /* Navigation du menu sur les EVENEMENTS clavier (une frappe = une
   * action), pas sur Keyboard.JustDown : Phaser efface le "juste appuye" au
   * relachement, donc une frappe tres breve (appui + relachement dans la
   * meme image) etait perdue - cause du blocage dans le panneau des scores
   * constate en jeu. */
  onMenuKey(key) {
    if (this.scoresPanel) {
      // N'importe quelle touche de navigation referme le panneau (Echap
      // aussi, voir FiveCadeGame.consumeEscape).
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

  /* Panneau des meilleurs scores, DEROULANT : SCORES_VISIBLE lignes a la
   * fois, HAUT/BAS (ou molette) pour faire defiler toute la liste renvoyee
   * par le serveur (jusqu'a 50 noms, saisis librement en fin de partie),
   * barre de defilement a droite. Entree / Echap / Retour arriere / clic
   * pour revenir au menu. */
  toggleScores() {
    if (this.scoresPanel) {
      this.closeScores();
      return;
    }
    var cx = GAME_WIDTH / 2, cy = GAME_HEIGHT / 2;
    this.scoresList = null;
    this.scoresScroll = 0;
    this.scoresPanel = this.add.rectangle(cx, cy, 520, 460, 0x140a06, 0.95)
      .setStrokeStyle(2, 0xffcc4d).setInteractive();
    this.scoresPanel.on('pointerdown', function () { this.closeScores(); }, this); // un clic referme aussi
    this.scoresTitle = this.add.text(cx, cy - 196, 'MEILLEURS SCORES', {
      fontFamily: 'monospace', fontSize: '20px', color: '#ffcc4d', fontStyle: 'bold'
    }).setOrigin(0.5);
    this.scoresListText = this.add.text(cx - 222, cy - 160, 'Chargement...', {
      fontFamily: 'monospace', fontSize: '17px', color: '#ffffff', lineSpacing: 9
    }).setOrigin(0, 0);
    this.scoresTrack = this.add.rectangle(cx + 236, cy - 160, 6, SCORES_VISIBLE * 30, 0x3a2410).setOrigin(0.5, 0).setVisible(false);
    this.scoresThumb = this.add.rectangle(cx + 236, cy - 160, 6, 40, 0xffcc4d).setOrigin(0.5, 0).setVisible(false);
    this.scoresBackHint = this.add.text(cx, cy + 202, 'HAUT/BAS defiler  -  ENTREE ou ECHAP pour revenir', {
      fontFamily: 'monospace', fontSize: '13px', color: '#ffcc4d'
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
      var money = '$' + sc.score; // le score de cette borne = des dollars
      return rank.padEnd(4, ' ') + ' ' + name.padEnd(17, '.') + ' ' + money.padStart(8, ' ');
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
 * MainScene - la partie elle-meme
 * ============================================================ */
class MainScene extends Phaser.Scene {
  constructor() {
    super('MainScene');
  }

  create() {
    window.FiveCadeGame._registerMainScene(this);
    playMusic('game');

    this.physics.world.setBounds(0, 0, WORLD_WIDTH, GAME_HEIGHT);
    this.cameras.main.setBounds(0, 0, WORLD_WIDTH, GAME_HEIGHT);

    this.backdrop = drawDesertBackdrop(this, GAME_WIDTH);
    // Origine du cycle jour/nuit fixee a la PREMIERE frame (voir update) :
    // au create, l'horloge de scene n'a pas encore sa vraie valeur (elle
    // saute a l'heure du jeu a la premiere mise a jour) - la partie
    // demarrait donc parfois de nuit.
    this.startedAtSec = null;

    // Sol unique, continu sur toute la largeur du monde - pas de trous,
    // pas de plateformes a sauter (voir en-tete du fichier). Corps
    // physique invisible : le sol visible est la bande sable/roches du
    // decor, dont le haut du sable tombe exactement sur GROUND_Y.
    var groundH = GAME_HEIGHT - GROUND_Y;
    var groundBody = this.add.rectangle(WORLD_WIDTH / 2, GROUND_Y + groundH / 2, WORLD_WIDTH, groundH, 0x000000, 0);
    this.physics.add.existing(groundBody, true);
    this.ground = groundBody;

    // Pose pile sur le sol (centre du corps = PLAYER_REST_Y) : un corps qui
    // nait enfonce de plus de quelques px dans le sol statique n'est PAS
    // repousse par arcade et passe au travers (bug vu avec la passe d'echelle).
    this.player = this.physics.add.sprite(120, PLAYER_REST_Y, 'tex-player', PLAYER_FRAME.idle);
    this.player.setScale(PLAYER_SCALE);
    this.player.setCollideWorldBounds(true);
    this.applyHeroBody();
    // Pas de setGravityY ici : la gravite du monde (voir config Phaser.Game
    // plus bas, y=1200) s'applique deja a tous les corps dynamiques. En
    // ajouter une ici la CUMULAIT (1200+1200=2400) sur le joueur seul,
    // invisible a l'oeil au premier abord mais avec deux consequences
    // reelles : la hauteur de saut reelle n'etait que ~48px au lieu des
    // ~96px prevus (PLATFORM_Y_OFFSET, calcule pour g=1200, rendait les
    // plateformes quasi inatteignables), et l'impact au sol plus violent
    // provoquait un leger enfoncement visible avant correction (lecture
    // "les pieds passent a travers le sol").
    this.player.facing = 1;
    this.player.hp = 3;      // nombre de VIES (voir PLAYER_HEALTH_MAX)
    this.player.maxHp = 5;   // plafond de vies
    this.player.health = PLAYER_HEALTH_MAX; // traits de la barre de sante
    this.player.invulnerableUntil = 0;

    this.cameras.main.startFollow(this.player, false, 0.12, 0.12);
    // Joueur un peu a gauche du centre pour voir venir les ennemis ;
    // proportionnel a la largeur de vue (variable, voir GAME_WIDTH).
    this.cameras.main.setFollowOffset(-Math.round(GAME_WIDTH * 0.2), 0);

    this.cursors = this.input.keyboard.createCursorKeys();
    // Disposition choisie par l'utilisateur : ESPACE = saut, F = tir,
    // G = grenade, fleches = deplacement/visee (HAUT/BAS ne servent plus
    // qu'a viser, voir computeAimAngle - jamais partages avec le saut,
    // meme raison que le fix precedent SHIFT : un saut et un tir sur la
    // meme touche cassait la visee horizontale/diagonale).
    this.fireKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.F);
    this.grenadeKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.G);
    this.jumpKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);

    this.playerBullets = this.physics.add.group();
    this.enemyBullets = this.physics.add.group();
    this.soldiers = this.physics.add.group();
    this.heavies = this.physics.add.group();
    // Unite volante - pas de gravite, pas de collider sol/plateforme (vole
    // librement, toujours au-dessus de la hauteur de saut max du joueur,
    // voir spawnFlyer) - se deplace uniquement via setVelocity, jamais une
    // ecriture directe de position (voir commentaire des constantes FLYER_*).
    this.flyers = this.physics.add.group();
    this.chargers = this.physics.add.group(); // elans (voir CHARGER_* en tete de fichier)
    this.pickups = this.physics.add.group();
    this.platforms = this.physics.add.staticGroup();
    this.grenades = this.physics.add.group();
    this.barrels = this.physics.add.staticGroup();

    this.physics.add.collider(this.player, this.ground);
    this.physics.add.collider(this.soldiers, this.ground);
    this.physics.add.collider(this.heavies, this.ground);
    this.physics.add.collider(this.chargers, this.ground);
    this.physics.add.collider(this.pickups, this.ground);
    this.physics.add.collider(this.player, this.platforms);
    this.physics.add.collider(this.soldiers, this.platforms);
    this.physics.add.collider(this.pickups, this.platforms);
    // Grenade : vrai rebond physique sur le sol/les plateformes (meme
    // gravite que le joueur, deja verifiee precise) au lieu d'une
    // trajectoire scriptee - collider (pas overlap) + setBounce sur
    // l'objet lui-meme, voir throwGrenade().
    this.physics.add.collider(this.grenades, this.ground);
    this.physics.add.collider(this.grenades, this.platforms);
    this.physics.add.collider(this.grenades, this.barrels);
    // Un baril a l'air solide, il doit vraiment bloquer le passage -
    // sans ca joueur et ennemis marchaient au travers comme s'il
    // n'existait pas, incoherent avec son aspect d'obstacle.
    this.physics.add.collider(this.player, this.barrels);
    this.physics.add.collider(this.soldiers, this.barrels);
    this.physics.add.collider(this.heavies, this.barrels);

    this.physics.add.overlap(this.playerBullets, this.soldiers, this.onBulletHitsSoldier, null, this);
    this.physics.add.overlap(this.playerBullets, this.heavies, this.onBulletHitsHeavy, null, this);
    this.physics.add.overlap(this.playerBullets, this.flyers, this.onBulletHitsFlyer, null, this);
    this.physics.add.overlap(this.playerBullets, this.chargers, this.onBulletHitsCharger, null, this);
    // Un elan lance a pleine vitesse pulverise le baril qu'il percute (il
    // n'est pas bloque par lui comme les autres ennemis au sol).
    this.physics.add.overlap(this.chargers, this.barrels, this.onChargerHitsBarrel, null, this);
    this.physics.add.overlap(this.playerBullets, this.barrels, this.onBulletHitsBarrel, null, this);
    // TOUS les barils explosent sous les tirs du joueur (demande utilisateur),
    // y compris les barils bonus a ramasser : il faut viser.
    this.physics.add.overlap(this.playerBullets, this.pickups, this.onBulletHitsOilBarrel,
      function (b, pk) { return pk.kind && pk.kind.indexOf('oil') === 0; }, this);
    // Un tir ennemi doit pouvoir declencher un baril aussi (pas juste le
    // joueur) - un soldat qui tire pres d'un baril peut se le faire
    // sauter tout seul, coherent avec un vrai baril explosif partage.
    this.physics.add.overlap(this.enemyBullets, this.barrels, this.onBulletHitsBarrel, null, this);
    this.physics.add.overlap(this.enemyBullets, this.player, this.onEnemyBulletHitsPlayer, null, this);
    // Contact avec un soldat = mise a mort au corps a corps, comme dans
    // le vrai Metal Slug (l'infanterie non blindee meurt au couteau,
    // sans degats pour le joueur) - recompense l'agressivite au lieu de
    // punir tout contact. Les lourds/unites volantes restent dangereux
    // au contact (machines, pas d'infanterie a "poignarder").
    this.physics.add.overlap(this.soldiers, this.player, this.onPlayerMeleesSoldier, null, this);
    this.physics.add.overlap(this.heavies, this.player, this.onEnemyTouchesPlayer, null, this);
    this.physics.add.overlap(this.flyers, this.player, this.onEnemyTouchesPlayer, null, this);
    this.physics.add.overlap(this.chargers, this.player, this.onChargerTouchesPlayer, null, this);
    this.physics.add.overlap(this.pickups, this.player, this.onPickup, null, this);
    this.physics.add.overlap(this.grenades, this.soldiers, this.onGrenadeHitsEnemy, null, this);
    this.physics.add.overlap(this.grenades, this.heavies, this.onGrenadeHitsEnemy, null, this);
    this.physics.add.overlap(this.grenades, this.flyers, this.onGrenadeHitsEnemy, null, this);
    this.physics.add.overlap(this.grenades, this.chargers, this.onGrenadeHitsEnemy, null, this);
    // Une plateforme est un vrai obstacle solide face aux tirs (dans les
    // deux sens, joueur et ennemis) - sans ca, un ennemi au sol pouvait
    // toucher un joueur a couvert sur une plateforme comme si elle etait
    // transparente, ce qui annulait tout interet defensif a en prendre
    // une des lors que les ennemis visent desormais la position reelle
    // du joueur (voir fireEnemyBullet). Le dessous bloque autant que le
    // dessus - une plateforme est solide de partout, pas juste en haut.
    // (Confirme par l'utilisateur : les balles ne traversent PAS les
    // plateformes. Pour toucher un ennemi perche, il faut se placer sur le
    // cote et tirer en diagonale - pas depuis le dessous.)
    this.physics.add.overlap(this.playerBullets, this.platforms, function (b) { if (b.isTankShell) this.explodeShell(b); else b.destroy(); }, null, this);
    this.physics.add.overlap(this.enemyBullets, this.platforms, function (b) { b.destroy(); }, null, this);

    this.score = 0;
    this.streak = 0;
    this.grenadeCount = GRENADE_MAX;
    this.weaponMode = 'rifle';
    this.weaponUntil = 0;
    this.rapidFireUntil = 0;
    this.readyToShoot = true;
    this.readyToThrow = true;
    this.grenadeChargeStart = 0;
    this.crouching = false;
    this.gameOver = false;
    this.nextSpawnX = GAME_WIDTH + 200;
    this.activeChunks = [];
    this.elapsedSec = 0;
    this.tankMode = false;
    this.tankDrop = null;   // largage de tank en cours (voir spawnTankDrop)
    this.boarding = false;  // animation de montee dans le tank en cours
    this.missiles = [];      // frappes de missile annoncees (voir launchMissileStrike)
    this.fireZones = [];     // nappes de petrole en feu (voir createFireZone)
    this.nextFireZoneX = FIRE_UNLOCK_DISTANCE + Phaser.Math.Between(0, 1500);
    this.nextMissileAt = null;
    this.tankHp = 0;
    this.lastTankPickupX = -Infinity;
    this.wasIntensePhase = false;
    this.lastGroundedAt = 0;

    this.createHud();

    // Vignette basse vie - alerte visuelle qui pulse quand il ne reste
    // qu'1 coeur, pour la tension (objectif "addictif" explicite) sans
    // toucher au gameplay/aux degats eux-memes. Cachee par defaut.
    this.lowHpVignette = this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0xff0000, 1)
      .setScrollFactor(0).setDepth(50).setAlpha(0);
    this.lowHpTween = this.tweens.add({
      targets: this.lowHpVignette, alpha: { from: 0, to: 0.16 }, duration: 550,
      yoyo: true, repeat: -1, paused: true
    });
    this.updateHud();

    this.spawnEvent = this.time.addEvent({
      delay: BASE_SPAWN_INTERVAL,
      loop: true,
      callback: this.spawnWave,
      callbackScope: this
    });

    this.secondEvent = this.time.addEvent({
      delay: 1000,
      loop: true,
      callback: this.onSecondTick,
      callbackScope: this
    });

    // Pre-remplit un peu de terrain devant pour ne pas arriver dans le
    // vide a l'ouverture.
    this.spawnWave();
    this.spawnWave();
  }

  /* Interface en haut de l'ecran - voir HUD_* en tete de fichier. */
  createHud() {
    var self = this;
    var depth = 40;
    this.add.image(HUD_X, HUD_Y, 'tex-hud-off').setOrigin(0, 0).setScrollFactor(0).setDepth(depth);
    function litLayer() {
      return self.add.image(HUD_X, HUD_Y, 'tex-hud-on').setOrigin(0, 0).setScrollFactor(0).setDepth(depth + 1);
    }
    var glow = { color: '#6cff00', blur: 6, fill: true, offsetX: 0, offsetY: 0 };
    this.hud = {
      hp: litLayer(),
      // Panneau vie du tank : fond eteint + traits allumes, montres
      // uniquement en mode tank (voir updateHud).
      tankPanel: this.add.image(HUD_X, HUD_Y, 'tex-hud-tank-off').setOrigin(0, 0).setScrollFactor(0).setDepth(depth),
      tankHp: litLayer(),
      lives: this.add.text(HUD_X + HUD_LIVES_SCREEN.x, HUD_Y + HUD_LIVES_SCREEN.y, '', {
        fontFamily: 'monospace', fontSize: '26px', fontStyle: 'bold', color: HUD_TEXT_COLOR, shadow: glow
      }).setOrigin(0.5).setScrollFactor(0).setDepth(depth + 2),
      score: this.add.text(HUD_X + HUD_SCORE_SCREEN.x0, HUD_Y + HUD_SCORE_SCREEN.y, '', {
        fontFamily: 'monospace', fontSize: '24px', fontStyle: 'bold', color: HUD_TEXT_COLOR, shadow: glow
      }).setOrigin(0, 0.5).setScrollFactor(0).setDepth(depth + 2),
      time: this.add.text(HUD_X + HUD_SCORE_SCREEN.x1, HUD_Y + HUD_SCORE_SCREEN.y, '', {
        fontFamily: 'monospace', fontSize: '15px', fontStyle: 'bold', color: HUD_TEXT_COLOR, shadow: glow
      }).setOrigin(1, 0.5).setScrollFactor(0).setDepth(depth + 2)
    };
  }

  /* Allume les N premiers creneaux (tirets/blocs) d'une jauge a cases. */
  setHudSlots(layer, slots, y, h, count) {
    var n = Phaser.Math.Clamp(count, 0, slots.length);
    if (n === 0) { layer.setVisible(false); return; }
    layer.setVisible(true);
    layer.setCrop(slots[0][0], y, slots[n - 1][1] - slots[0][0] + 1, h);
  }

  updateHud() {
    var sec = Math.max(this.elapsedSec, 0);
    this.hud.score.setText('$' + String(Math.max(this.score, 0)).padStart(7, '0')); // le score = des dollars
    this.hud.time.setText(Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0'));
    // Petit ecran : le NOMBRE DE VIES. Barre : la SANTE du joueur, 1 trait
    // par coup (choix utilisateur).
    this.hud.lives.setText(String(Math.max(this.player.hp, 0)));
    this.setHudSlots(this.hud.hp, HUD_HP_SLOTS, HUD_HP_Y, HUD_HP_H, this.player.health);
    // Panneau de droite = vie du tank : apparait en entrant dans le tank,
    // disparait en le quittant.
    this.hud.tankPanel.setVisible(this.tankMode);
    if (this.tankMode) {
      // 8 traits pour TANK_MAX_HP points : affichage a l'echelle (arrondi au
      // superieur, pour ne jamais afficher 0 trait tant que le tank tient).
      var tankSlots = Math.ceil(Math.max(0, this.tankHp) / TANK_MAX_HP * HUD_TANK_SLOTS.length);
      this.setHudSlots(this.hud.tankHp, HUD_TANK_SLOTS, HUD_TANK_Y, HUD_TANK_H, tankSlots);
    } else {
      this.hud.tankHp.setVisible(false);
    }

    // Alerte basse vie : derniere vie et barre presque vide.
    var lowHp = !this.tankMode && this.player.hp <= 0 && this.player.health <= 3;
    if (lowHp && this.lowHpTween.paused) {
      this.lowHpTween.paused = false;
    } else if (!lowHp && !this.lowHpTween.paused) {
      this.lowHpTween.paused = true;
      this.lowHpVignette.setAlpha(0);
    }
  }

  onSecondTick() {
    if (this.gameOver) return;
    this.elapsedSec += 1;
    this.score += 4; // score de survie, en plus des kills/pickups
    this.updateHud();
  }

  difficulty() {
    return Phaser.Math.Clamp(this.player.x / DIFFICULTY_RAMP_DISTANCE, 0, 1);
  }

  /* Cadence de tir des fantassins : plus lente en debut de partie (x1.5),
   * (x1.7) cadence pleine seulement a difficulte max (banc d essai : les tirs de
   * pandas faisaient 75 % des degats, premiere vie perdue des 33 s). */
  soldierFireDelay() {
    var slow = 1.7 - 0.7 * this.difficulty();
    return Math.round(Phaser.Math.Between(SOLDIER_FIRE_DELAY_MIN, SOLDIER_FIRE_DELAY_MAX) * slow);
  }

  /* Plafond d'ennemis actifs : MAX_ACTIVE_ENEMIES, puis +1 par tranche de
   * OVERTIME_STEP px au-dela de la difficulte max (voir OVERTIME_*). */
  enemyCap() {
    var over = Math.max(0, this.player.x - DIFFICULTY_RAMP_DISTANCE);
    return MAX_ACTIVE_ENEMIES + Math.min(OVERTIME_MAX, Math.floor(over / OVERTIME_STEP));
  }

  /* Oscillation continue calme <-> intense (0 = calme, 1 = intense),
   * independante de la rampe de difficulte de base : celle-ci ne monte
   * qu'une fois pour toutes, alors qu'un run long a besoin d'un vrai
   * rythme (tension/relache) pour ne pas devenir plat une fois la
   * difficulte de base au plafond. */
  pacing() {
    return (Math.sin((this.player.x / PACING_CYCLE_DISTANCE) * Math.PI * 2 - Math.PI / 2) + 1) / 2;
  }

  /* Genere une vague d'ennemis/obstacles/pickups devant la camera, et
   * ajuste l'intervalle de la prochaine vague selon la difficulte et le
   * rythme calme/intense - meme principe de rampe que les autres bornes
   * (spawn plus dense et plus dur au fil du temps, jamais un mur
   * infranchissable), avec en plus une respiration periodique. */
  spawnWave() {
    if (this.gameOver) return;
    var diff = this.difficulty();
    var pacing = this.pacing();
    var camRight = this.cameras.main.scrollX + GAME_WIDTH;
    // Borne haute : sans elle, un joueur qui s'arrete voyait nextSpawnX filer
    // (+260..420 px a chaque vague) et les ennemis naitre jusqu'a 10 000 px
    // devant, hors de portee, en occupant tout MAX_ACTIVE_ENEMIES (mesure au
    // banc d'essai : partie "vide" autour du joueur).
    var x = Math.min(Math.max(this.nextSpawnX, camRight + 300), camRight + 700);

    // Nappe en feu en cours devant : pas d'ennemi au sol dedans (au plus un
    // drone de temps en temps).
    if (this.fireZoneAt(x, 250)) {
      if (Math.random() < 0.25 && this.player.x > FLYER_UNLOCK_DISTANCE && this.flyers.getChildren().length < 2) {
        this.activeChunks.push({ x: x, objs: [this.spawnFlyer(x)] });
      }
      return;
    }
    // Nouvelle sequence "sol en feu" ?
    if (this.player.x > FIRE_UNLOCK_DISTANCE && x > this.nextFireZoneX && !this.tankMode && !this.tankDrop) {
      this.createFireZone(x);
      return;
    }

    // Alerte "renforts" au moment ou on bascule vers un pic d'intensite -
    // prevenir juste avant que ca arrive, pas juste subir, fait partie
    // de la tension recherchee.
    var isIntenseNow = pacing >= PACING_INTENSE_THRESHOLD;
    if (isIntenseNow && !this.wasIntensePhase) {
      this.showReinforcementsWarning();
    }
    this.wasIntensePhase = isIntenseNow;

    // Plafond d'ennemis actifs simultanement - sans ca, un joueur qui
    // reste sur place fait continuer a spawner des vagues devant lui
    // indefiniment (le nettoyage ne retire que ce qui est DERRIERE),
    // et les ennemis qui s'arretent tous a la meme distance d'engagement
    // finissent entasses. Si le plafond est atteint, cette vague ne
    // pose que du decor/un pickup, jamais un ennemi de plus.
    var activeEnemies = this.soldiers.getChildren().length + this.heavies.getChildren().length + this.flyers.getChildren().length + this.chargers.getChildren().length;
    var enemyCap = this.enemyCap();
    var atEnemyCap = activeEnemies >= enemyCap;

    var roll = Math.random();
    var chunkObjs = [];

    // Seuils d'ennemis modules par le rythme : plus de soldats/lourds en
    // phase intense (jusqu'a +25pts), plus de plateformes/pickups en
    // phase calme (la place liberee profite directement a ces branches
    // puisque les seuils suivants restent inchanges).
    //
    // Plafonds sur flyerThreshold/barrelThreshold : mesure via une
    // simulation complete (90s de jeu, voir historique de session) - sans
    // plafond, la somme des largeurs de branches (soldat+lourd+volant+
    // baril) depassait 0.8 des la phase intense (jusqu'a ~0.895), ce qui
    // rendait la branche plateforme/pickup partiellement ou totalement
    // INATTEIGNABLE (elle est verifiee apres, dans la chaine if/else-if -
    // un roll qui aurait du y tomber etait deja capte par la branche
    // baril juste avant). Resultat observe en simulation : zero pickup
    // ramasse en 90 secondes. Les plafonds ci-dessous garantissent
    // toujours au moins ~10% de plateformes et ~10% de pickups, meme au
    // pic d'intensite.
    var soldierThreshold = 0.45 + 0.15 * (pacing - 0.5);
    var heavyThreshold = soldierThreshold + 0.15 + 0.10 * (pacing - 0.5);
    var flyerThreshold = Math.min(heavyThreshold + 0.10, 0.72);
    var barrelThreshold = Math.min(flyerThreshold + 0.05, 0.77); // barils rouges : moitie moins (test en jeu)

    // Pickup tank - evenement rare et attendu, jamais pendant une phase
    // tank deja en cours (voir en-tete du fichier pour la philosophie).
    var canOfferTank = !this.tankMode && this.player.x > TANK_UNLOCK_DISTANCE
      && (x - this.lastTankPickupX) > TANK_PICKUP_MIN_GAP;
    var fireNear = this.fireZones.some(function (z) { return z.x1 > this.player.x - 300; }, this) || x > this.nextFireZoneX - 2500;
    if (canOfferTank && !this.tankDrop && !fireNear && Math.random() < 0.1) {
      this.spawnTankDrop();
      this.lastTankPickupX = x;
    } else if (atEnemyCap) {
      // Plafond deja atteint - measure en simulation (150s, joueur
      // invulnerable, juste pour observer la distribution des vagues) :
      // sans ce cas a part, TOUS les rolls qui auraient du etre un
      // soldat/lourd/volant tombaient en cascade sur la branche baril (le
      // seul type "sans plafond" restant dans la chaine), qui sortait
      // alors sur plus de la moitie des vagues. Repartition dediee et
      // volontairement favorable au decor/pickup plutot qu'au baril.
      var decorRoll = Math.random();
      if (decorRoll < 0.12) {
        chunkObjs.push(this.spawnBarrel(x));
      } else if (decorRoll < 0.6) {
        chunkObjs = chunkObjs.concat(this.spawnPlatform(x));
      } else {
        chunkObjs.push(this.spawnRandomPickup(x));
      }
    } else if (roll < soldierThreshold && !atEnemyCap) {
      // Ennemi "elite" plus costaud, plus probable en phase intense - une
      // sensation de mini-evenement sans script de boss (voir en-tete).
      var wantElite = isIntenseNow && this.player.x > HEAVY_UNLOCK_DISTANCE && Math.random() < 0.22;
      var wantCharger = !wantElite && this.player.x > CHARGER_UNLOCK_DISTANCE && Math.random() < CHARGER_SPAWN_CHANCE;
      chunkObjs.push(wantElite ? this.spawnElite(x) : (wantCharger ? this.spawnCharger(x) : this.spawnSoldier(x)));
      if (diff > 0.4 && Math.random() < 0.4 + 0.2 * pacing && activeEnemies + 1 < enemyCap) {
        chunkObjs.push(this.spawnSoldier(x + 90));
      }
    } else if (roll < heavyThreshold && this.player.x > HEAVY_UNLOCK_DISTANCE && !atEnemyCap) {
      chunkObjs.push(this.spawnHeavy(x));
    } else if (roll < flyerThreshold && this.player.x > FLYER_UNLOCK_DISTANCE && !atEnemyCap) {
      // Unite volante - menace aerienne independante des plateformes
      // (remplace l'ancien sniper statique, voir spawnFlyer).
      chunkObjs.push(this.spawnFlyer(x));
    } else if (roll < barrelThreshold) {
      // Baril explosif - obstacle/opportunite tactique, independant du
      // plafond d'ennemis (ce n'est pas un ennemi).
      chunkObjs.push(this.spawnBarrel(x));
    } else if (roll < 0.9) {
      // Passerelle/caisses en hauteur - pure variete visuelle et
      // tactique (se mettre a couvert, sniper le terrain), jamais un
      // passage oblige puisque le sol continu en dessous reste toujours
      // praticable (voir en-tete du fichier).
      var platformObjs = this.spawnPlatform(x);
      chunkObjs = chunkObjs.concat(platformObjs);
    } else {
      chunkObjs.push(this.spawnRandomPickup(x));
    }

    // Rangee de barils de petrole, en plus de ce que la vague a pose
    // (decale pour ne pas tomber sur l'ennemi/le baril explosif du chunk).
    if (Math.random() < OIL_CHANCE) {
      chunkObjs = chunkObjs.concat(this.spawnOilRow(x + Phaser.Math.Between(130, 190)));
    }

    this.activeChunks.push({ x: x, objs: chunkObjs.filter(Boolean) });
    this.nextSpawnX = x + Phaser.Math.Between(260, 420);

    // Rampe de difficulte (une fois pour toutes) + rythme calme/intense
    // (oscille en continu par-dessus) : l'intervalle final reste toujours
    // borne par MIN_SPAWN_INTERVAL, jamais un mur infranchissable meme au
    // pic des deux effets cumules.
    var rampedInterval = BASE_SPAWN_INTERVAL - (BASE_SPAWN_INTERVAL - MIN_SPAWN_INTERVAL) * diff;
    var interval = Math.max(MIN_SPAWN_INTERVAL, rampedInterval * (1 - 0.3 * pacing));
    this.spawnEvent.delay = interval;
    this.spawnEvent.reset({ delay: interval, loop: true, callback: this.spawnWave, callbackScope: this });
  }

  showReinforcementsWarning() {
    playSfx('reinforcements');
    // setScrollFactor(0) : texte fixe a l'ecran, coordonnees en espace
    // ecran directement (pas besoin d'ajouter scrollX).
    var t = this.add.text(GAME_WIDTH / 2, 100, 'RENFORTS ENNEMIS !', {
      fontFamily: 'monospace', fontSize: '20px', color: '#ff3a5e', fontStyle: 'bold'
    }).setOrigin(0.5).setScrollFactor(0);
    this.tweens.add({
      targets: t, alpha: 0, y: 80, duration: 1400, delay: 400,
      onComplete: function () { t.destroy(); }
    });
  }

  spawnSoldier(x, stationary) {
    var s = this.soldiers.create(x, GROUND_Y - PANDA_FEET_FROM_CENTER * PANDA_SCALE, 'tex-soldier', 0);
    s.setScale(PANDA_SCALE);
    // Corps cale sur le torse et les pieds du panda (le cadre 64x64 a des
    // marges vides), en pixels du cadre : arcade applique l'echelle.
    s.body.setSize(28, 53); // jusqu'au chapeau : la ligne de tir debout passe franchement dedans
    s.body.setOffset(18, 32 + PANDA_FEET_FROM_CENTER - 53);
    s.walkAnim = 'panda-walk';
    // Reperes stockes en pixels ECRAN (deja multiplies par l'echelle).
    s.feetFromCenter = PANDA_FEET_FROM_CENTER * PANDA_SCALE;
    s.muzzleX = PANDA_MUZZLE_X * PANDA_SCALE;
    s.muzzleY = PANDA_MUZZLE_Y * PANDA_SCALE;
    s.hp = 1;
    s.fireDelay = this.soldierFireDelay();
    s.nextFireAt = this.time.now + s.fireDelay;
    s.setCollideWorldBounds(false);
    // Soldat en hauteur sur une plateforme (voir spawnPlatform) - reste
    // immobile pour ne jamais marcher hors du bord (pas de patrouille sur
    // la plateforme, meme raison que l'ancien "sniper" avant l'ajout de
    // l'unite volante : place une fois pour toutes, jamais de saut/
    // deplacement dynamique en hauteur, voir PLATFORM_SOLDIER_CHANCE).
    s.stationary = !!stationary;
    return s;
  }

  spawnHeavy(x) {
    var h = this.heavies.create(x, GROUND_Y - CAMEL_FEET_FROM_CENTER * CAMEL_SCALE, 'tex-heavy', 0);
    h.setScale(CAMEL_SCALE);
    // Taille/decalage du corps en pixels du cadre non agrandi (arcade
    // applique l'echelle), pieds poses sur le bas du corps.
    h.body.setSize(60, 40);
    h.body.setOffset(4, 32 + CAMEL_FEET_FROM_CENTER - 40);
    h.hp = 5;
    h.fireDelay = Phaser.Math.Between(1800, 2600);
    h.nextFireAt = this.time.now + h.fireDelay;
    h.setCollideWorldBounds(false);
    return h;
  }

  /* Unite volante - altitude visee tiree au sort une fois au spawn
   * (baseY), toujours hors de portee du saut max du joueur - voir
   * FLYER_ALTITUDE_MIN/MAX. Pas de gravite (vole librement). */
  spawnFlyer(x) {
    var altitude = Phaser.Math.Between(FLYER_ALTITUDE_MIN, FLYER_ALTITUDE_MAX);
    var f = this.flyers.create(x, GROUND_Y - altitude, 'tex-flyer');
    f.setScale(FLYER_SCALE);
    f.body.allowGravity = false;
    f.setCollideWorldBounds(false);
    f.hp = FLYER_HP;
    f.baseY = f.y;
    f.bobPhase = Math.random() * Math.PI * 2;
    f.fireDelay = Phaser.Math.Between(FLYER_FIRE_DELAY_MIN, FLYER_FIRE_DELAY_MAX);
    f.nextFireAt = this.time.now + f.fireDelay;
    return f;
  }

  /* Elan chargeur - voir CHARGER_* en tete de fichier pour le cycle. */
  spawnCharger(x) {
    var c = this.chargers.create(x, GROUND_Y - MOOSE_FEET_FROM_CENTER * MOOSE_SCALE, 'tex-charger', 0);
    c.setScale(MOOSE_SCALE);
    // Corps sur le tronc et les pattes (les bois qui depassent ne comptent
    // pas, sinon on se ferait toucher par du vide au-dessus de sa tete).
    c.body.setSize(36, 34); // garrot + tete : la ligne de tir debout passe franchement dedans
    c.body.setOffset(14, 32 + MOOSE_FEET_FROM_CENTER - 34);
    c.setCollideWorldBounds(false);
    c.hp = CHARGER_HP;
    c.state = 'approach';
    c.stateUntil = 0;
    c.chargeDir = 1;
    // Nettoyage du "!" quelle que soit la cause de disparition (mort,
    // cleanupBehind, fin de partie).
    c.on('destroy', function () { if (c.alertText) c.alertText.destroy(); });
    return c;
  }

  onBulletHitsCharger(bullet, charger) {
    if (bullet.isTankShell) { this.explodeShell(bullet); return; }
    bullet.destroy();
    this.damageCharger(charger, 1);
  }

  damageCharger(c, amount) {
    if (!c.active) return;
    this.spark(c.x, c.y);
    c.hp -= amount;
    this.sfx(c.hp <= 0 ? 'heavyDie' : 'hit', c.x);
    c.setTint(0xff9a9a);
    this.time.delayedCall(80, function () { if (c.active && c.state !== 'windup') c.clearTint(); }, [], this);
    if (c.hp <= 0) {
      this.quadrupedDeathFx(c, MOOSE_SCALE, MOOSE_FEET_FROM_CENTER, MOOSE_TOP_FROM_CENTER);
      c.destroy();
      this.registerKill(c.x, c.y, CHARGER_SCORE);
    }
  }

  /* Ordre des parametres : groupe vs objet unique -> le joueur arrive en
   * premier (voir le piege documente sur onPlayerMeleesSoldier). */
  onChargerTouchesPlayer(player, charger) {
    if (!charger.active) return;
    var wasHittable = this.time.now >= this.player.invulnerableUntil;
    this.damagePlayer(1);
    // Repousse uniquement sur un vrai coup de charge (pas au simple
    // contact pendant l'approche) : petit bond + recul dans le sens de
    // la charge. Le recul passe par la position (l'input ecrase la
    // vitesse X chaque frame), le bond par la vitesse Y.
    if (wasHittable && charger.state === 'charge') {
      this.player.setVelocityY(-280);
      this.player.x += charger.chargeDir * CHARGER_KNOCKBACK;
    }
  }

  onChargerHitsBarrel(charger, barrel) {
    if (charger.state === 'charge') this.explodeBarrel(barrel); // percute a pleine vitesse : explose direct
  }

  /* Ennemi elite - meme groupe/IA qu'un soldat normal (partage donc
   * automatiquement engagement/separation/collisions), juste plus
   * costaud, texture/score distincts, et annonce a l'ecran - donne une
   * sensation de mini-evenement sans script de boss dedie. */
  spawnElite(x) {
    var s = this.soldiers.create(x, GROUND_Y - BEAR_FEET_FROM_CENTER * BEAR_SCALE, 'tex-soldier-elite', 0);
    s.setScale(BEAR_SCALE);
    // Corps cale sur le corps et les pieds de l'ours (arme exclue, elle
    // depasse devant), en pixels du cadre : arcade applique l'echelle.
    s.body.setSize(32, 50);
    s.body.setOffset(14, 32 + BEAR_FEET_FROM_CENTER - 50);
    s.walkAnim = 'bear-walk';
    s.feetFromCenter = BEAR_FEET_FROM_CENTER * BEAR_SCALE;
    s.muzzleX = BEAR_MUZZLE_X * BEAR_SCALE;
    s.muzzleY = BEAR_MUZZLE_Y * BEAR_SCALE;
    s.hp = ELITE_HP;
    s.elite = true;
    s.fireDelay = Phaser.Math.Between(900, 1400);
    s.nextFireAt = this.time.now + s.fireDelay;
    s.setCollideWorldBounds(false);
    var t = this.add.text(x, GROUND_Y - 150, 'LIEUTENANT ENNEMI', {
      fontFamily: 'monospace', fontSize: '12px', color: '#ff3a5e', fontStyle: 'bold'
    }).setOrigin(0.5);
    this.tweens.add({ targets: t, alpha: 0, y: t.y - 20, duration: 1600, delay: 600, onComplete: function () { t.destroy(); } });
    return s;
  }

  spawnPickup(x, texture, kind) {
    var p = this.pickups.create(x, GROUND_Y - 200, texture);
    p.kind = kind;
    p.setBounce(0.3);
    return p;
  }

  /* Tirage d'un pickup "generique" (hors tank/POW, geres a part) - extrait
   * en methode pour etre appelable aussi bien depuis le tirage normal que
   * depuis le cas "plafond d'ennemis atteint" (voir spawnWave). */
  spawnRandomPickup(x) {
    var pickupRoll = Math.random();
    // (Plus de coeur ni de bombe : sante/vies = barils bleus/verts, bombe
    // retiree du jeu.)
    // (Tir chasseur retire : juge inutile par l'utilisateur. Son code reste
    // en place mais plus aucune caisse "C" n'apparait.)
    // (Fusil a pompe "S" retire aussi : juge rate par l'utilisateur.)
    if (pickupRoll < 0.55) return this.spawnPickup(x, 'tex-rapid', 'rapid');
    return this.spawnPickup(x, 'tex-grenade-pickup', 'grenade');
  }

  /* Rangee de 1 a OIL_ROW_MAX barils a ramasser poses au sol, couleur
   * tiree au sort pour chacun (voir OIL_* : jaune $, bleu sante, vert vie). */
  spawnOilRow(x) {
    var n = Phaser.Math.Between(1, OIL_ROW_MAX);
    var objs = [];
    for (var i = 0; i < n; i += 1) {
      var roll = Math.random();
      var kind = roll < OIL_GREEN_CHANCE ? 'oil-green'
        : (roll < OIL_GREEN_CHANCE + OIL_BLUE_CHANCE ? 'oil-blue' : 'oil');
      var tex = kind === 'oil-green' ? 'tex-oil-green' : (kind === 'oil-blue' ? 'tex-oil-blue' : 'tex-oil');
      var o = this.pickups.create(x + i * OIL_SPACING * OIL_SCALE, GROUND_Y - 13 * OIL_SCALE, tex);
      o.setScale(OIL_SCALE);
      o.setDepth(-0.3); // derriere les ennemis (ils passent devant)
      o.kind = kind;
      objs.push(o);
    }
    return objs;
  }


  /* Baril explosif - obstacle statique, degats de zone au tir (voir
   * onBulletHitsBarrel) y compris en chaine sur un autre baril proche. */
  spawnBarrel(x) {
    var b = this.barrels.create(x, 0, 'tex-barrel');
    b.setScale(BARREL_SCALE);
    b.setDepth(-0.3); // derriere les ennemis (ils passent devant)
    b.y = GROUND_Y - b.displayHeight / 2;
    b.refreshBody(); // corps statique recale sur la taille/position agrandie
    b.hp = BARREL_HITS;
    return b;
  }

  /* Habille une plateforme (corps invisible) avec la passerelle en bois :
   * bords a pieds aux extremites, plancher repete entre les deux, dessus
   * du plancher cale sur le dessus du corps. Detruit avec la plateforme. */
  dressPlatform(plat) {
    var S = PLATFORM_ART_SCALE;
    var top = plat.body.top, left = plat.body.left, w = plat.body.width;
    var lw = PLATFORM_ART_LEFT_W * S, rw = PLATFORM_ART_RIGHT_W * S;
    var parts = [
      this.add.image(left, top, 'tex-platform-left').setOrigin(0, 0).setScale(S),
      this.add.image(left + w - rw, top, 'tex-platform-right').setOrigin(0, 0).setScale(S)
    ];
    var midW = Math.max(0, w - lw - rw);
    if (midW > 0) {
      var mid = this.add.tileSprite(left + lw, top, midW / S, PLATFORM_ART_DECK_H, 'tex-platform-mid')
        .setOrigin(0, 0).setScale(S);
      parts.push(mid);
    }
    parts.forEach(function (p) { p.setDepth(-1); });
    plat.on('destroy', function () { parts.forEach(function (p) { p.destroy(); }); });
  }

  spawnPlatform(x, forcedW) {
    var y = GROUND_Y - PLATFORM_Y_OFFSET;
    var plat = this.platforms.create(x, y, 'tex-platform');
    // Longueur aleatoire pour casser la monotonie (demande utilisateur) ;
    // la hauteur reste fixe (atteignable au saut, passage dessous garanti).
    plat.setDisplaySize(forcedW || Phaser.Math.Between(PLATFORM_W_MIN, PLATFORM_W_MAX), PLATFORM_H);
    plat.refreshBody();
    plat.setVisible(false); // corps physique seul : l'habillage est dessine a part
    // Traversable par dessous et par les cotes (comme Metal Slug) : on saute
    // a travers et on atterrit dessus, jamais de "tete cognee" sous le
    // plancher. Seul le dessus est solide.
    plat.body.checkCollision.down = false;
    plat.body.checkCollision.left = false;
    plat.body.checkCollision.right = false;
    this.dressPlatform(plat);
    var objs = [plat];
    // Un soldat peut occuper la plateforme des sa creation (voir
    // PLATFORM_SOLDIER_CHANCE en tete de fichier - placement direct,
    // jamais un saut simule en pleine partie, voir le commentaire a
    // cote de cette constante) - reste immobile en hauteur, vise et
    // tire normalement (fireEnemyBullet vise deja la position reelle du
    // joueur, diagonale comprise). Sinon, chance de pickup a la place.
    var topRoll = Math.random();
    if (topRoll < PLATFORM_SOLDIER_CHANCE
      && this.soldiers.getChildren().length + this.heavies.getChildren().length < this.enemyCap()) {
      // Au BORD de la plateforme cote joueur (il arrive par la gauche), pas au
      // centre : les balles ne traversent pas les plateformes, et a 45 deg un
      // panda au centre etait intouchable depuis le sol (la balle finissait
      // dans le plancher ou passait au-dessus de sa tete). Au bord, il se
      // descend en diagonale a bonne distance, ou en sautant ; dessous, le
      // plancher protege les deux camps.
      var ex = plat.body.left + PERCHED_EDGE_INSET;
      var elevated = this.spawnSoldier(ex, true);
      elevated.y = y - PLATFORM_H / 2 - PANDA_FEET_FROM_CENTER * PANDA_SCALE;
      elevated.body.reset(ex, y - PLATFORM_H / 2 - PANDA_FEET_FROM_CENTER * PANDA_SCALE);
      objs.push(elevated);
    } else if (topRoll < PLATFORM_SOLDIER_CHANCE + 0.3) {
      var kind = Math.random() < 0.5 ? 'grenade' : 'rapid';
      var texture = kind === 'grenade' ? 'tex-grenade-pickup' : 'tex-rapid';
      var p = this.pickups.create(x, y - 40, texture);
      p.kind = kind;
      p.setBounce(0.2);
      objs.push(p);
    }
    return objs;
  }

  cleanupBehind() {
    var limitX = this.player.x - CLEANUP_BEHIND;
    while (this.activeChunks.length && this.activeChunks[0].x < limitX) {
      var chunk = this.activeChunks.shift();
      chunk.objs.forEach(function (o) { if (o && o.destroy) o.destroy(); });
    }
  }

  /* Direction de visee sur 8 axes (haut/bas stricts + diagonales),
   * comme le vrai Metal Slug - meme arme/cadence/degats quel que soit
   * l'angle, donc pas un avantage "cheate", juste plus de flexibilite
   * pour atteindre un ennemi qui n'est pas a la meme hauteur (utile
   * depuis l'ajout des snipers sur plateforme). BAS n'est actif qu'en
   * l'air (au sol, BAS = accroupissement, deja gere ailleurs). */
  computeAimAngle() {
    var onGround = this.player.body.blocked.down || this.player.body.touching.down;
    var up = this.cursors.up.isDown;
    var down = this.cursors.down.isDown && !onGround;
    var horiz = this.cursors.left.isDown || this.cursors.right.isDown;
    var vx = 0, vy = 0;
    if (up) vy = -1;
    else if (down) vy = 1;
    if (!up && !down) vx = this.player.facing;
    else if (horiz) vx = this.player.facing;
    if (vx !== 0 && vy !== 0) return Math.atan2(vy * PLAYER_DIAG_TAN, vx); // 38 deg, comme le fusil dessine
    return Math.atan2(vy, vx);
  }

  firePlayerBullet() {
    if (!this.readyToShoot) return;
    var rapid = this.time.now < this.rapidFireUntil;
    var shotgun = !this.tankMode && this.weaponMode === 'shotgun';
    var chaser = !this.tankMode && this.weaponMode === 'chaser';
    this.readyToShoot = false;
    // Canon du tank : obus explosifs (zone de grenade) mais cadence LENTE
    // (TANK_FIRE_COOLDOWN_MS) pour ne pas pouvoir arroser - demande
    // utilisateur : laisser aux ennemis le temps d'arriver, sinon trop facile.
    var cooldown = this.tankMode ? TANK_FIRE_COOLDOWN_MS : (shotgun ? 480 : (chaser ? 340 : (rapid ? 130 : 320)));
    if (this.tankMode) { this.tankReloadFrom = this.time.now; this.tankReloadUntil = this.time.now + cooldown; this.tankReloadSounded = false; }
    this.sfx(this.tankMode ? 'tankFire' : (shotgun ? 'shotgun' : (chaser ? 'chaser' : (rapid ? 'shootRapid' : 'shoot'))), this.player.x);
    this.time.delayedCall(cooldown, function () { this.readyToShoot = true; }, [], this);

    var dir = this.player.facing;
    // Le tank garde un canon horizontal uniquement (pas de pivot rapide
    // haut/bas, coherent avec un vehicule lourd) - tous les autres modes
    // suivent la visee sur 8 axes.
    // Tank : canon horizontal, ou releve a 28 deg en tenant HAUT (image 1).
    var tankUp = this.tankMode && this.cursors.up.isDown;
    var aim = this.tankMode ? (tankUp ? (dir > 0 ? -TANK_UP_ANGLE : Math.PI + TANK_UP_ANGLE) : (dir > 0 ? 0 : Math.PI)) : this.computeAimAngle();

    if (shotgun) {
      this.fireShotgunBurst(aim, dir);
      return;
    }

    var texture = this.tankMode ? 'tex-bullet-tank' : (chaser ? 'tex-bullet-chaser' : 'tex-bullet-player');
    // Depart des balles au bout du canon dessine : pose visee haut/bas pour
    // les tirs verticaux purs, sinon canon horizontal incline selon l'angle
    // (diagonales) autour de la hauteur du fusil.
    var spawnX, spawnY;
    if (this.tankMode) {
      var tm = tankUp ? TANK_MUZZLE_UP : { x: TANK_MUZZLE_X, y: TANK_MUZZLE_Y };
      spawnX = this.player.x + dir * tm.x * TANK_SCALE;
      spawnY = this.player.y + tm.y * TANK_SCALE;
    } else if (this.crouching && Math.abs(Math.sin(aim)) < 0.01) {
      spawnX = this.player.x + dir * PLAYER_MUZZLE_CROUCH.x * PLAYER_SCALE;
      spawnY = this.player.y + PLAYER_MUZZLE_CROUCH.y * PLAYER_SCALE;
    } else if (Math.abs(Math.cos(aim)) < 0.01) {
      var m = Math.sin(aim) < 0 ? PLAYER_MUZZLE_UP : PLAYER_MUZZLE_DOWN;
      spawnX = this.player.x + dir * m.x * PLAYER_SCALE;
      spawnY = this.player.y + m.y * PLAYER_SCALE;
    } else if (Math.abs(Math.sin(aim)) > 0.05) {
      // Diagonale : bout du canon de l'image 7 / 8.
      var md = Math.sin(aim) < 0 ? PLAYER_MUZZLE_DIAG_UP : PLAYER_MUZZLE_DIAG_DOWN;
      spawnX = this.player.x + dir * md.x * PLAYER_SCALE;
      spawnY = this.player.y + md.y * PLAYER_SCALE;
    } else {
      spawnX = this.player.x + Math.cos(aim) * PLAYER_MUZZLE_FWD.x * PLAYER_SCALE;
      spawnY = this.player.y + (PLAYER_MUZZLE_FWD.y + Math.sin(aim) * PLAYER_MUZZLE_FWD.x) * PLAYER_SCALE;
    }
    var blockedAt = this.segmentHitsPlatform(this.player.x, this.player.y - PLAYER_AIM_CHEST, spawnX, spawnY);
    if (blockedAt) {
      if (this.tankMode) { this.blastAt(blockedAt.x, blockedAt.y); } else { this.spark(blockedAt.x, blockedAt.y); }
      return;
    }
    var speed = this.tankMode ? TANK_SHELL_SPEED : (chaser ? CHASER_SPEED : 720);
    var b = this.playerBullets.create(spawnX, spawnY, texture);
    b.setRotation(aim);
    b.body.allowGravity = false;
    // Vecteur complet base sur l'angle de visee (aim encode deja la
    // direction gauche/droite via player.facing, voir computeAimAngle) -
    // pas seulement l'axe horizontal, sinon un tir vise en diagonale
    // tournait visuellement mais partait tout droit (corrige ici).
    b.setVelocity(Math.cos(aim) * speed, Math.sin(aim) * speed);
    b.flipX = dir < 0;
    b.isTankShell = this.tankMode;
    b.homing = chaser;
    b.homingTarget = null;
    if (this.tankMode) {
      // Coup de canon qui se sent : gros eclair, recul du tank, petite secousse.
      var flash = this.add.image(spawnX, spawnY, 'tex-muzzle');
      this.tweens.add({ targets: flash, scale: 4, alpha: 0, duration: 140, onComplete: function () { flash.destroy(); } });
      this.player.x -= dir * 6;
      this.cameras.main.shake(90, 0.006);
    }
    this.time.delayedCall(this.tankMode ? TANK_SHELL_LIFE_MS : 1200, function () { if (b.active) b.destroy(); }, [], this);
  }

  /* Fusil a pompe - explosion instantanee dans un cone court devant le
   * joueur (zone garantie, pas de projectile a suivre) - voir le
   * commentaire de SHOTGUN_RANGE/SHOTGUN_CONE_HALF_ANGLE en tete de
   * fichier. Meme pattern iterer+verifier+degats que explodeGrenade/
   * explodeBarrel, rien de nouveau a maintenir. */
/* Le segment (x1,y1)->(x2,y2) traverse-t-il une plateforme ? Echantillonne
   * tous les ~6 px (les plateformes font 18 px d'epaisseur). Sert a empecher
   * de tirer A TRAVERS une plateforme quand le canon depasse au-dessus du
   * plancher (joueur debout juste dessous : la plateforme n'est qu'a 121 px
   * du sol, le bout du fusil vise en haut passait de l'autre cote). */
  segmentHitsPlatform(x1, y1, x2, y2) {
    var len = Math.sqrt((x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1));
    var n = Math.max(1, Math.ceil(len / 6));
    var plats = this.platforms.getChildren();
    for (var i = 0; i <= n; i += 1) {
      var t = i / n, px = x1 + (x2 - x1) * t, py = y1 + (y2 - y1) * t;
      for (var k = 0; k < plats.length; k += 1) {
        var b = plats[k].body;
        if (b && px >= b.left && px <= b.right && py >= b.top && py <= b.bottom) return { x: px, y: py };
      }
    }
    return null;
  }

  fireShotgunBurst(aim, dir) {
    var self = this;
    // Depart au bout du fusil (meme repere que les balles, x PLAYER_SCALE).
    var originX = this.player.x + Math.cos(aim) * PLAYER_MUZZLE_FWD.x * PLAYER_SCALE;
    var originY = this.player.y + (PLAYER_MUZZLE_FWD.y + Math.sin(aim) * PLAYER_MUZZLE_FWD.x) * PLAYER_SCALE;

    function inCone(entity) {
      if (self.segmentHitsPlatform(self.player.x, self.player.y - PLAYER_AIM_CHEST, entity.x, entity.y)) return false;
      var dx = entity.x - originX, dy = entity.y - originY;
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > SHOTGUN_RANGE) return false;
      var angleTo = Math.atan2(dy, dx);
      return Math.abs(Phaser.Math.Angle.Wrap(angleTo - aim)) <= SHOTGUN_CONE_HALF_ANGLE;
    }

    this.soldiers.getChildren().slice().forEach(function (s) { if (inCone(s)) self.damageSoldier(s, 1); });
    this.heavies.getChildren().slice().forEach(function (h) { if (inCone(h)) self.damageHeavy(h, 1); });
    this.flyers.getChildren().slice().forEach(function (f) { if (inCone(f)) self.damageFlyer(f, 1); });
    this.chargers.getChildren().slice().forEach(function (c) { if (inCone(c)) self.damageCharger(c, 1); });
    this.barrels.getChildren().slice().forEach(function (b) { if (inCone(b)) self.hitBarrel(b, 1); });

    var flashX = originX + Math.cos(aim) * SHOTGUN_RANGE * 0.5;
    var flashY = originY + Math.sin(aim) * SHOTGUN_RANGE * 0.5;
    var ring = this.add.circle(flashX, flashY, 8, COLORS.shotgun, 0.55);
    this.tweens.add({
      targets: ring, radius: SHOTGUN_RANGE * 0.55, alpha: 0, duration: 160,
      onComplete: function () { ring.destroy(); }
    });
  }

  /* Grenade - vrai projectile physique (gravite du monde deja verifiee
   * precise au pixel pres pour le saut du joueur, meme constante ici),
   * rebondit sur le sol/les plateformes puis explose a la mèche, ou
   * immediatement au contact d'un ennemi (voir onGrenadeHitsEnemy). */
  /* heldMs : duree de maintien de la touche G avant relachement - plus
   * c'est long (jusqu'a GRENADE_CHARGE_MAX_MS), plus vx/vy sont grands
   * et plus la grenade part loin, meme forme d'arc juste mise a
   * l'echelle (voir startGrenadeCharge/update() pour la capture du
   * maintien). */
  throwGrenade(heldMs) {
    if (this.grenadeCount <= 0 || !this.readyToThrow || this.gameOver) return;
    this.grenadeCount -= 1;
    this.readyToThrow = false;
    this.time.delayedCall(300, function () { this.readyToThrow = true; }, [], this);
    this.updateHud();

    var t = Phaser.Math.Clamp((heldMs || 0) / GRENADE_CHARGE_MAX_MS, 0, 1);
    var vx = Phaser.Math.Linear(GRENADE_VX_MIN, GRENADE_VX_MAX, t);
    var vy = Phaser.Math.Linear(GRENADE_VY_MIN, GRENADE_VY_MAX, t);

    var dir = this.player.facing;
    this.sfx('throw', this.player.x);
    var g = this.grenades.create(this.player.x + dir * 18, this.player.y - 10, 'tex-grenade');
    g.setVelocity(vx * dir, vy);
    g.setBounce(0.42);
    g.setCollideWorldBounds(false);
    g.exploded = false;
    g.setAngularVelocity(dir * 620); // tourne sur elle-meme en vol
    g.setAngularDrag(260);            // et ralentit en roulant au sol
    var self = this;
    g.fuseTimer = this.time.delayedCall(GRENADE_FUSE_MS, function () {
      self.explodeGrenade(g);
    });
    // Meche : clignote en rouge de plus en plus vite sur la fin.
    g.blinkTimer = this.time.addEvent({ delay: 60, loop: true, callback: function () {
      if (!g.active) return;
      var left = g.fuseTimer.getRemaining();
      var period = left < 450 ? 90 : (left < 900 ? 180 : 320);
      var on = Math.floor(self.time.now / period) % 2 === 0;
      if (on) g.setTint(0xff5040); else g.clearTint();
    } });
  }

  startGrenadeCharge() {
    if (this.grenadeCount <= 0 || !this.readyToThrow || this.gameOver) return;
    this.grenadeChargeStart = this.time.now;
    this.grenadeChargeBar = this.add.rectangle(this.player.x, this.player.y - 40, 4, 6, 0x8fae5a);
  }

  updateGrenadeChargeBar() {
    if (!this.grenadeChargeBar) return;
    var t = Phaser.Math.Clamp((this.time.now - this.grenadeChargeStart) / GRENADE_CHARGE_MAX_MS, 0, 1);
    this.grenadeChargeBar.setPosition(this.player.x, this.player.y - 40);
    this.grenadeChargeBar.width = 4 + 36 * t;
  }

  releaseGrenadeCharge() {
    if (this.grenadeChargeBar) { this.grenadeChargeBar.destroy(); this.grenadeChargeBar = null; }
    if (this.grenadeChargeStart === 0) return;
    var heldMs = this.time.now - this.grenadeChargeStart;
    this.grenadeChargeStart = 0;
    this.throwGrenade(heldMs);
  }

  explodeGrenade(g) {
    if (!g.active || g.exploded) return;
    g.exploded = true;
    if (g.fuseTimer) g.fuseTimer.remove(false);
    if (g.blinkTimer) g.blinkTimer.remove(false);
    var x = g.x, y = g.y;
    g.destroy();
    this.blastAt(x, y);
  }

  /* Obus du tank : explose au contact (ennemi, baril, plateforme) avec
   * EXACTEMENT l'explosion d'une grenade (demande utilisateur). */
  explodeShell(b) {
    if (!b.active || b.exploded) return;
    b.exploded = true;
    var x = b.x, y = b.y;
    b.destroy();
    this.blastAt(x, y);
  }

  /* Explosion de zone partagee grenade / obus du tank : secousse, onde,
   * degats a tous les ennemis et barils dans GRENADE_BLAST_RADIUS. */
  blastAt(x, y) {
    this.sfx('explosion', x);
    this.cameras.main.shake(240, 0.017);
    this.cameras.main.flash(70, 255, 210, 140);
    // Onde de choc (rayon reel des degats) + boule de feu en couches
    // (rouge -> orange -> coeur blanc) + etincelles + fumee.
    var ring = this.add.circle(x, y, 10).setStrokeStyle(5, 0xffe08a, 0.9).setDepth(26);
    this.tweens.add({
      targets: ring, radius: GRENADE_BLAST_RADIUS, alpha: 0, duration: 320,
      onComplete: function () { ring.destroy(); }
    });
    var R = GRENADE_BLAST_RADIUS;
    [[0xc8321e, 0.62, 560], [0xff8a2a, 0.48, 440], [0xfff0b0, 0.3, 300]].forEach(function (layer, idx) {
      var r = R * layer[1];
      var ball = this.add.circle(x, y - r * 0.3, r * 0.45, layer[0], 1).setDepth(26 + idx * 0.1);
      this.tweens.add({ targets: ball, scale: 2.2, duration: layer[2] * 0.4, ease: 'Quad.Out' });
      this.tweens.add({ targets: ball, alpha: 0, delay: layer[2] * 0.4, duration: layer[2] * 0.6,
        onComplete: function () { ball.destroy(); } });
    }, this);
    for (var sp = 0; sp < 6; sp += 1) this.spark(x + Phaser.Math.Between(-R * 0.6, R * 0.6), y - Phaser.Math.Between(0, R * 0.6));
    for (var sm = 0; sm < 4; sm += 1) {
      var puff = this.add.circle(x + Phaser.Math.Between(-40, 40), y - 10, Phaser.Math.Between(10, 16), 0x3a3230, 0.7).setDepth(24);
      this.tweens.add({ targets: puff, y: puff.y - Phaser.Math.Between(50, 100), scale: 2.2, alpha: 0, duration: 800 + sm * 90,
        onComplete: (function (o) { return function () { o.destroy(); }; })(puff) });
    }

    var self = this;
    this.soldiers.getChildren().slice().forEach(function (s) {
      if (Phaser.Math.Distance.Between(x, y, s.x, s.y) <= GRENADE_BLAST_RADIUS) {
        self.damageSoldier(s, 99);
      }
    });
    this.heavies.getChildren().slice().forEach(function (h) {
      if (Phaser.Math.Distance.Between(x, y, h.x, h.y) <= GRENADE_BLAST_RADIUS) {
        self.damageHeavy(h, 3);
      }
    });
    // Une unite volante trop basse au moment de l'explosion est touchee
    // comme les autres (meme test de distance 2D, l'altitude typique du
    // vol la met hors de portee sauf coincidence de trajectoire).
    this.flyers.getChildren().slice().forEach(function (f) {
      if (Phaser.Math.Distance.Between(x, y, f.x, f.y) <= GRENADE_BLAST_RADIUS) {
        self.damageFlyer(f, 99);
      }
    });
    this.chargers.getChildren().slice().forEach(function (c) {
      if (Phaser.Math.Distance.Between(x, y, c.x, c.y) <= GRENADE_BLAST_RADIUS) {
        self.damageCharger(c, 3);
      }
    });
    // Un baril dans le rayon explose aussi (coherent avec le rebond
    // physique grenade/baril deja en place et la chaine baril-a-baril).
    this.barrels.getChildren().concat(this.oilBarrels()).forEach(function (barrel) {
      if (barrel.active && Phaser.Math.Distance.Between(x, y, barrel.x, barrel.y) <= GRENADE_BLAST_RADIUS) {
        self.explodeBarrel(barrel);
      }
    });
  }

  oilBarrels() {
    return this.pickups.getChildren().filter(function (pk) { return pk.active && pk.kind && pk.kind.indexOf('oil') === 0; });
  }

  onGrenadeHitsEnemy(grenade, enemy) {
    this.explodeGrenade(grenade);
  }

  /* Tir ennemi coherent avec le dessin (demande utilisateur) : la balle
   * part du BOUT DU CANON (muzzle = decalage ecran par rapport au centre
   * du tireur, regard a droite ; miroite selon flipX) et vise la POITRINE
   * du joueur a l'instant du tir (PLAYER_AIM_CHEST). Pas de tete
   * chercheuse : trajectoire figee au depart, donc bouger / sauter /
   * s'accroupir APRES le tir fait vraiment passer la balle a cote - c'est
   * la vraie collision qui decide (voir onEnemyBulletHitsPlayer). */
  fireEnemyBullet(shooter, texture, speed, damage, muzzle) {
    this.sfx(texture === 'tex-bullet-heavy' ? 'heavyShoot' : (texture === 'tex-bullet-flyer' ? 'flyerShoot' : 'enemyShoot'), shooter.x);
    var dir = shooter.flipX ? -1 : 1;
    var ox = shooter.x + (muzzle ? dir * muzzle.x : 0);
    var oy = shooter.y + (muzzle ? muzzle.y : 0);
    var tx = this.player.x;
    // Toujours la poitrine DEBOUT (demande utilisateur : "je n'arrive pas a
    // esquiver en me baissant") : un joueur accroupi voit passer les tirs
    // des ennemis au sol au-dessus de lui. Tank : vise le centre de la caisse.
    var ty = this.tankMode ? this.player.y : this.player.y - ENEMY_AIM_Y;
    var angle = Math.atan2(ty - oy, tx - ox);
    var b = this.enemyBullets.create(ox, oy, texture);
    b.body.allowGravity = false;
    // Collision limitee au coeur visible (la texture a un contour + halo) :
    // une balle qui frole ne compte pas.
    b.body.setSize(b.width * 0.5, b.height * 0.5, true);
    b.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);
    b.setRotation(angle);
    b.damage = damage;
    this.time.delayedCall(2500, function () { if (b.active) b.destroy(); }, [], this);
  }

  /* Tir des soldats a sprite (panda, ours) fait en code (l'IA ne sait pas
   * animer le tir) : eclair au bout du canon + recul de 2px oppose au sens
   * du tir. Le recul passe par la position du sprite, que le corps arcade
   * suit de lui-meme. */
  soldierShotFx(s) {
    var dir = s.flipX ? -1 : 1;
    var flash = this.add.image(s.x + dir * s.muzzleX, s.y + s.muzzleY, 'tex-muzzle');
    this.tweens.add({ targets: flash, scale: 2.2, alpha: 0, duration: 90, onComplete: function () { flash.destroy(); } });
    s.x -= dir * 2;
  }

  /* Mort des soldats a sprite faite en code : flash blanc, projection en
   * arriere, rotation a plat au sol, clignotement puis disparition. Simple
   * image sans physique - le soldat lui-meme est deja detruit (score/
   * collisions inchanges). */
  soldierDeathFx(soldier) {
    var dir = soldier.flipX ? 1 : -1; // regarde vers le joueur, tombe a l'oppose
    var corpse = this.add.image(soldier.x, soldier.y, soldier.texture.key, 0).setScale(soldier.scaleX);
    corpse.flipX = soldier.flipX;
    corpse.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL); // Phaser 4 : setTintFill n'existe plus
    this.time.delayedCall(70, function () { if (corpse.active) corpse.clearTint(); });
    var landY = soldier.y + soldier.feetFromCenter - CORPSE_LYING_HALF * soldier.scaleX;
    var self = this;
    this.tweens.add({ targets: corpse, x: soldier.x + dir * 36, duration: 380, ease: 'Quad.easeOut' });
    this.tweens.add({ targets: corpse, angle: dir * 90, duration: 380, ease: 'Quad.easeIn' });
    this.tweens.add({
      targets: corpse, y: soldier.y - 22, duration: 150, ease: 'Quad.easeOut',
      onComplete: function () {
        self.tweens.add({
          targets: corpse, y: landY, duration: 230, ease: 'Quad.easeIn',
          onComplete: function () {
            self.tweens.add({
              targets: corpse, alpha: 0, duration: 90, yoyo: true, repeat: 3, delay: 350,
              onComplete: function () { corpse.destroy(); }
            });
          }
        });
      }
    });
  }

  /* Tir de la tourelle du dromadaire : gros eclair au bout du canon +
   * recul de 3px, meme principe que soldierShotFx. */
  heavyShotFx(h) {
    var dir = h.flipX ? -1 : 1;
    var flash = this.add.image(h.x + dir * CAMEL_MUZZLE_X * CAMEL_SCALE, h.y + CAMEL_MUZZLE_Y * CAMEL_SCALE, 'tex-muzzle');
    this.tweens.add({ targets: flash, scale: 3.2, alpha: 0, duration: 120, onComplete: function () { flash.destroy(); } });
    h.x -= dir * 3;
  }

  heavyDeathFx(heavy) {
    this.quadrupedDeathFx(heavy, CAMEL_SCALE, CAMEL_FEET_FROM_CENTER, CAMEL_TOP_FROM_CENTER);
  }

  /* Mort d'un quadrupede (dromadaire, elan) : flash blanc, petit bond,
   * culbute sur le dos (pattes en l'air, rotation de 180deg), clignote
   * puis disparait. feet/top en pixels du cadre non agrandi. */
  quadrupedDeathFx(heavy, scale, feetFromCenter, topFromCenter) {
    var corpse = this.add.image(heavy.x, heavy.y, heavy.texture.key, 0).setScale(scale);
    corpse.flipX = heavy.flipX;
    corpse.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
    this.time.delayedCall(90, function () { if (corpse.active) corpse.clearTint(); });
    var groundY = heavy.y + feetFromCenter * scale;
    // A l'envers, le haut du dessin (bosse/tourelle/bois) devient le bas.
    var landY = groundY - topFromCenter * scale;
    var spin = heavy.flipX ? 180 : -180; // bascule vers l'arriere
    var self = this;
    this.tweens.add({ targets: corpse, angle: spin, duration: 460, ease: 'Quad.easeInOut' });
    this.tweens.add({
      targets: corpse, y: heavy.y - 30, duration: 200, ease: 'Quad.easeOut',
      onComplete: function () {
        self.tweens.add({
          targets: corpse, y: landY, duration: 260, ease: 'Quad.easeIn',
          onComplete: function () {
            self.tweens.add({
              targets: corpse, alpha: 0, duration: 100, yoyo: true, repeat: 3, delay: 500,
              onComplete: function () { corpse.destroy(); }
            });
          }
        });
      }
    });
  }

  spark(x, y) {
    var s = this.add.image(x, y, 'tex-spark');
    this.tweens.add({ targets: s, alpha: 0, scale: 3, duration: 220, onComplete: function () { s.destroy(); } });
  }

  onBulletHitsSoldier(bullet, soldier) {
    if (bullet.isTankShell) { this.explodeShell(bullet); return; } // obus : explosion de zone
    bullet.destroy();
    this.damageSoldier(soldier, 1);
  }

  onBulletHitsHeavy(bullet, heavy) {
    if (bullet.isTankShell) { this.explodeShell(bullet); return; }
    bullet.destroy();
    this.damageHeavy(heavy, 1);
  }

  onBulletHitsFlyer(bullet, flyer) {
    if (bullet.isTankShell) { this.explodeShell(bullet); return; }
    bullet.destroy();
    this.damageFlyer(flyer, 1);
  }

  /* Point d'entree unique pour infliger des degats a un soldat/elite -
   * partage par le tir normal, le canon du tank, la grenade et la bombe,
   * pour ne jamais dupliquer la logique de mort/score. */
  damageSoldier(soldier, amount) {
    if (!soldier.active) return;
    this.spark(soldier.x, soldier.y);
    soldier.hp -= amount;
    this.sfx(soldier.hp <= 0 ? 'enemyDie' : 'hit', soldier.x);
    if (soldier.hp <= 0) {
      var isElite = !!soldier.elite;
      if (soldier.walkAnim) this.soldierDeathFx(soldier);
      soldier.destroy();
      this.registerKill(soldier.x, soldier.y, isElite ? ELITE_SCORE : 40);
    }
  }

  damageHeavy(heavy, amount) {
    if (!heavy.active) return;
    this.spark(heavy.x, heavy.y - 10);
    heavy.hp -= amount;
    this.sfx(heavy.hp <= 0 ? 'heavyDie' : 'hit', heavy.x);
    heavy.setTint(0xff9a9a);
    this.time.delayedCall(80, function () { if (heavy.active) heavy.clearTint(); }, [], this);
    if (heavy.hp <= 0) {
      this.heavyDeathFx(heavy);
      heavy.destroy();
      this.cameras.main.shake(140, 0.01); // un tank qui tombe se sent, pas juste un chiffre de score
      this.registerKill(heavy.x, heavy.y, 150);
    }
  }

  damageFlyer(flyer, amount) {
    if (!flyer.active) return;
    this.spark(flyer.x, flyer.y);
    flyer.hp -= amount;
    this.sfx(flyer.hp <= 0 ? 'enemyDie' : 'hit', flyer.x);
    if (flyer.hp <= 0) {
      flyer.destroy();
      this.registerKill(flyer.x, flyer.y, FLYER_SCORE);
    }
  }

  /* Phase tank - voir TANK_MAX_HP en tete de fichier : une vraie barre
   * de vie separee (comme sur la vraie borne), pas une invincibilite a
   * duree fixe. Ejection automatique (exitTankMode) des qu'elle tombe
   * a 0, avec une courte grace period pour ne pas enchainer sur un coup
   * fatal immediat au sol. */
  /* Gabarit "commando" : origine au centre du corps 30x52 (voir
   * PLAYER_TORSO_X/PLAYER_BODY_CENTER_Y), corps cale sur le torse et les
   * pieds. Le decalage X suit le regard : le flipX miroite le dessin dans
   * son cadre, le torse passe donc de x=28 a x=64-28 quand il regarde a
   * gauche - sans ca le corps physique restait 8px a cote du dessin. */
  applyHeroBody() {
    var p = this.player;
    var torsoX = p.flipX ? PLAYER_FRAME_W - PLAYER_TORSO_X : PLAYER_TORSO_X;
    p.setOrigin(torsoX / PLAYER_FRAME_W, PLAYER_BODY_CENTER_Y / PLAYER_FRAME_H);
    // Accroupi : corps VRAIMENT plus bas (CROUCH_BODY_H), bas du corps au
    // meme niveau (pas de perte de contact au sol). Une balle tiree quand
    // le joueur etait debout passe au-dessus ; un tir d'en haut touche.
    var h = this.crouching ? CROUCH_BODY_H : STAND_HEIGHT + HERO_HEAD_EXTRA;
    p.body.setSize(30, h);
    p.body.setOffset(torsoX - 15, PLAYER_BODY_CENTER_Y + STAND_HEIGHT / 2 - h);
  }

  /* Animation du tank (image fixe) faite en code : en roulant au sol, il
   * tressaute (petite rotation, n'affecte pas le corps arcade) et souleve
   * de la poussiere derriere les chenilles. Il garde son saut (choix
   * utilisateur, comme le char de Metal Slug). */
  /* Jauge de recharge au-dessus du tank : visible seulement pendant la
   * recharge du canon (TANK_FIRE_COOLDOWN_MS), se remplit du rouge au
   * vert - montre que le canon "recharge" au lieu de sembler ne pas
   * repondre. */
  updateTankReloadBar() {
    if (!this.tankReloadBar) {
      this.tankReloadBar = this.add.graphics().setDepth(28);
    }
    var g = this.tankReloadBar;
    g.clear();
    if (this.tankMode && !this.tankReloadSounded && this.tankReloadUntil && this.time.now >= this.tankReloadUntil) {
      this.tankReloadSounded = true;
      this.sfx('reloadReady', this.player.x);
    }
    if (!this.tankMode || this.gameOver || this.time.now >= (this.tankReloadUntil || 0)) return;
    var t = Phaser.Math.Clamp((this.time.now - this.tankReloadFrom) / (this.tankReloadUntil - this.tankReloadFrom), 0, 1);
    var w = 70, h = 8;
    var x = this.player.x - w / 2, y = this.player.y + (TANK_HATCH.y - 8) * TANK_SCALE;
    g.fillStyle(0x000000, 0.7).fillRect(x - 2, y - 2, w + 4, h + 4);
    var c = Phaser.Display.Color.Interpolate.ColorWithColor(
      Phaser.Display.Color.ValueToColor(0xd8262b), Phaser.Display.Color.ValueToColor(0x7dff3a), 100, Math.round(t * 100));
    g.fillStyle(Phaser.Display.Color.GetColor(c.r, c.g, c.b), 1).fillRect(x, y, w * t, h);
  }

  updateTankFx(onGround) {
    var p = this.player;
    p.setFrame(this.cursors.up.isDown && !this.boarding ? 1 : 0); // canon releve en tenant HAUT
    var rolling = onGround && Math.abs(p.body.velocity.x) > 5;
    if (!rolling) { p.angle = 0; return; }
    p.angle = Math.sin(this.time.now / 45) * 1.3;
    if (this.time.now < (this.nextTankDustAt || 0)) return;
    this.nextTankDustAt = this.time.now + 70;
    var back = p.flipX ? 1 : -1; // arriere du tank
    var dx = back * (TANK_HULL_CENTER_X - 10) * TANK_SCALE * 0.5 + Phaser.Math.Between(-6, 6);
    var dust = this.add.circle(p.x + dx, p.y + (TANK_TREAD_BOTTOM - 32) * TANK_SCALE - 6,
      Phaser.Math.Between(5, 9), 0xd9b27a, 0.7);
    this.tweens.add({
      targets: dust, x: dust.x + back * Phaser.Math.Between(18, 34), y: dust.y - Phaser.Math.Between(10, 22),
      scale: 2.2, alpha: 0, duration: 420, onComplete: function () { dust.destroy(); }
    });
  }

  /* Choisit l'image du commando selon l'etat : visee haut/bas pure (pas
   * les diagonales, qui gardent la pose normale), accroupi, en l'air,
   * marche ou repos. En mode tank : animation du tank a la place. */
  updateHeroPose(onGround) {
    if (this.tankMode) { this.updateTankFx(onGround); return; }
    var p = this.player;
    var horiz = this.cursors.left.isDown || this.cursors.right.isDown;
    var up = this.cursors.up.isDown && !horiz;
    var down = this.cursors.down.isDown && !onGround && !horiz;
    var frame = null;
    var diagUp = this.cursors.up.isDown && horiz && !this.crouching;
    var diagDown = this.cursors.down.isDown && horiz && !onGround;
    if (diagUp) frame = PLAYER_FRAME.diagUp;
    else if (diagDown) frame = PLAYER_FRAME.diagDown;
    else if (up && !this.crouching) frame = PLAYER_FRAME.aimUp;
    else if (down) frame = PLAYER_FRAME.aimDown;
    else if (this.crouching) frame = PLAYER_FRAME.crouch;
    else if (!onGround) frame = PLAYER_FRAME.jump;
    if (frame === null && Math.abs(p.body.velocity.x) > 5) {
      p.anims.play('hero-walk', true);
    } else {
      if (p.anims.isPlaying) p.anims.stop();
      p.setFrame(frame === null ? PLAYER_FRAME.idle : frame);
    }
    if (p.lastFlipX !== p.flipX) {
      p.lastFlipX = p.flipX;
      this.applyHeroBody();
    }
  }

  enterTankMode() {
    this.tankMode = true;
    this.tankHp = TANK_MAX_HP;
    this.player.anims.stop();
    this.swapPlayerGabarit(function () {
      this.player.setOrigin(0.5, 0.5); // le gabarit tank est centre sur son cadre
      this.player.setScale(TANK_SCALE);
      this.player.setTexture('tex-player-tank');
      // Corps TANK_BODY_W x TANK_BODY_H (pixels du cadre, x TANK_SCALE), bas
      // du corps = bas des chenilles : le tank repose pile sur le sol.
      this.player.body.setSize(TANK_BODY_W, TANK_BODY_H)
        .setOffset(TANK_HULL_CENTER_X - TANK_BODY_W / 2, TANK_TREAD_BOTTOM + 1 - TANK_BODY_H);
    });
    this.cameras.main.flash(150, 255, 240, 180);
    this.updateHud();
  }

  /* Largage du tank - voir PLANE_* / TANK_DROP_* en tete de fichier.
   * L'avion vole en coordonnees ECRAN (traverse toujours la vue, meme si
   * la camera avance) ; le point de chute est fixe dans le MONDE au moment
   * de l'appel, devant le joueur. Un seul largage a la fois (this.tankDrop). */
  spawnTankDrop() {
    var cam = this.cameras.main;
    playSfx('planeFlyby', { dur: 4.5 });
    var planeHalfW = 142 * PLANE_SCALE / 2; // part entierement hors champ (cadre de 142px)
    var plane = this.add.image(GAME_WIDTH + planeHalfW + 40, PLANE_Y, 'tex-plane')
      .setScale(PLANE_SCALE).setScrollFactor(0).setDepth(20);
    this.tankDrop = { state: 'plane', plane: plane, landX: cam.scrollX + GAME_WIDTH * TANK_DROP_AHEAD };
  }

  tankLandY() {
    // Centre du cadre du tank quand le bas des chenilles touche le sol.
    return GROUND_Y - (TANK_TREAD_BOTTOM + 1 - 32) * TANK_SCALE;
  }

  updateTankDrop() {
    var d = this.tankDrop;
    if (!d) return;
    var dt = this.game.loop.delta / 1000;
    var cam = this.cameras.main;
    var S = TANK_SCALE;
    // L'avion continue sa route apres le largage, puis disparait.
    if (d.plane) {
      d.plane.x -= PLANE_SPEED * dt;
      if (d.state === 'plane' && d.plane.x <= d.landX - cam.scrollX) {
        // Lache depuis la soute : le haut du tank part du ventre de l'avion.
        var releaseY = PLANE_Y + PLANE_BELLY * PLANE_SCALE - (15 - 32) * S;
        d.tank = this.add.image(d.landX, releaseY, 'tex-player-tank').setScale(S).setDepth(-0.5);
        // Chute libre un court instant sous la soute, PUIS le parachute
        // s'ouvre (sinon la voile ouverte chevauchait l'avion au largage).
        d.state = 'freefall';
        d.freefallUntil = this.time.now + TANK_FREEFALL_MS;
      }
      if (d.plane.x < -d.plane.displayWidth / 2 - 40) { d.plane.destroy(); d.plane = null; }
    }
    if (d.state === 'freefall') {
      d.tank.y += TANK_FREEFALL_SPEED * dt;
      if (this.time.now >= d.freefallUntil) {
        d.chute = this.add.image(d.tank.x, 0, 'tex-parachute').setScale(CHUTE_SCALE * 0.2, CHUTE_SCALE * 0.1)
          .setOrigin(0.5, 1).setDepth(-0.4);
        this.tweens.add({ targets: d.chute, scaleX: CHUTE_SCALE, scaleY: CHUTE_SCALE, duration: 260, ease: 'Back.easeOut' });
        d.state = 'falling';
        this.sfx('chuteOpen', d.tank.x);
      }
    }
    if (d.state === 'falling') {
      d.tank.y = Math.min(d.tank.y + TANK_FALL_SPEED * dt, this.tankLandY());
      // Suspentes accrochees au sommet de la tourelle.
      d.chute.setPosition(d.tank.x + TANK_HATCH.x * S, d.tank.y + TANK_HATCH.y * S);
      if (d.tank.y >= this.tankLandY()) this.landTankDrop();
    } else if (d.state === 'parked') {
      var P = this.player;
      if (P.x - d.tank.x > CLEANUP_BEHIND) { this.clearTankDrop(); return; } // laisse derriere
      // Montee seulement si le commando est au niveau du char (pas depuis une
      // plateforme au-dessus : il se faisait aspirer dedans).
      var tankTop = d.tank.y + (15 - 32) * S;
      var near = Math.abs(P.x - d.tank.x) < TANK_BODY_W * S / 2 && P.body.bottom > tankTop + 10;
      if (near && !this.tankMode && !this.boarding) this.boardParkedTank();
    }
  }

  /* Atterrissage : poussiere, secousse, parachute qui s'affaisse et
   * panneau "CHAR !" qui clignote au-dessus. */
  landTankDrop() {
    var d = this.tankDrop, t = d.tank, self = this;
    d.state = 'parked';
    this.sfx('tankLand', t.x);
    this.cameras.main.shake(160, 0.008);
    for (var i = 0; i < 8; i += 1) {
      var side = i % 2 === 0 ? -1 : 1;
      var dust = this.add.circle(t.x + side * Phaser.Math.Between(40, 130), GROUND_Y - 8, Phaser.Math.Between(8, 14), 0xd9b27a, 0.75);
      this.tweens.add({ targets: dust, x: dust.x + side * Phaser.Math.Between(30, 70), y: dust.y - Phaser.Math.Between(10, 30),
        scale: 2.4, alpha: 0, duration: 520, onComplete: (function (o) { return function () { o.destroy(); }; })(dust) });
    }
    var chute = d.chute; d.chute = null;
    this.tweens.add({ targets: chute, angle: 35, x: chute.x + 90, y: chute.y + 70, alpha: 0, duration: 700,
      ease: 'Quad.easeIn', onComplete: function () { chute.destroy(); } });
    // Fleche qui pointe vers le tank (demande utilisateur, a la place du
    // texte "CHAR !") : rebondit de haut en bas et clignote legerement.
    var arrowY = t.y + TANK_HATCH.y * TANK_SCALE - 40;
    d.sign = this.add.image(t.x + TANK_HATCH.x * TANK_SCALE, arrowY, 'tex-arrow-down').setOrigin(0.5, 1).setDepth(30);
    d.signTween = this.tweens.add({ targets: d.sign, y: arrowY + 16, alpha: 0.55, duration: 380,
      ease: 'Sine.easeInOut', yoyo: true, repeat: -1 });
  }

  clearTankDrop() {
    var d = this.tankDrop;
    if (!d) return;
    ['plane', 'tank', 'chute', 'sign'].forEach(function (k) { if (d[k]) d[k].destroy(); });
    if (d.signTween) d.signTween.stop();
    this.tankDrop = null;
  }

  /* Montee dans le tank (~TANK_BOARD_MS) : le commando saute sur la
   * tourelle (le tank s'affaisse sous son poids), s'enfonce dans
   * l'ecoutille (dessine DERRIERE le tank pendant qu'il descend), puis
   * le tank demarre (petit bond, fumee, flash). Commandes gelees et
   * joueur invulnerable pendant ce temps (this.boarding). */
  boardParkedTank() {
    var d = this.tankDrop, P = this.player, t = d.tank, S = TANK_SCALE, self = this;
    this.boarding = true;
    d.state = 'boarding';
    this.sfx('tankBoard', t.x);
    if (d.signTween) d.signTween.stop();
    if (d.sign) { d.sign.destroy(); d.sign = null; }
    P.setVelocity(0, 0);
    P.body.enable = false;
    P.invulnerableUntil = this.time.now + TANK_BOARD_MS + 800;
    P.anims.stop();
    P.setFrame(PLAYER_FRAME.jump);
    P.flipX = false;
    var hatchX = t.x + TANK_HATCH.x * S;
    var standY = t.y + TANK_HATCH.y * S - STAND_HEIGHT * PLAYER_SCALE / 2; // pieds sur l'ecoutille
    var peakY = Math.min(P.y, standY) - 70;
    // 1) saut jusqu'a la tourelle
    this.tweens.add({ targets: P, x: hatchX, duration: 320 });
    this.tweens.add({ targets: P, y: peakY, duration: 160, ease: 'Quad.easeOut', onComplete: function () {
      self.tweens.add({ targets: P, y: standY, duration: 160, ease: 'Quad.easeIn', onComplete: function () {
        P.setFrame(PLAYER_FRAME.idle);
        self.tweens.add({ targets: t, scaleY: S * 0.93, duration: 80, yoyo: true }); // le tank encaisse le poids
        // 2) s'enfonce dans l'ecoutille (derriere le tank)
        t.setDepth(5); P.setDepth(4);
        self.tweens.add({ targets: P, y: standY + 80, alpha: 0, duration: 300, delay: 130, ease: 'Quad.easeIn',
          onComplete: function () { self.finishBoarding(); } });
      } });
    } });
  }

  finishBoarding() {
    var d = this.tankDrop, P = this.player, tx = d.tank.x;
    this.clearTankDrop();
    P.alpha = 1;
    P.setDepth(0);
    P.x = tx;
    P.y = PLAYER_REST_Y;
    P.body.enable = true;
    P.body.reset(P.x, P.y);
    P.facing = 1;
    P.flipX = false;
    this.boarding = false;
    this.enterTankMode();
    this.score += 30;
    // 3) demarrage : petit bond + fumee a l'arriere
    P.setVelocityY(-220);
    for (var i = 0; i < 4; i += 1) {
      var puff = this.add.circle(P.x - (TANK_HULL_CENTER_X - 6) * TANK_SCALE * 0.5, P.y + 10 - i * 8, 10 + i * 2, 0x3a3a3a, 0.7);
      this.tweens.add({ targets: puff, x: puff.x - 40 - i * 12, y: puff.y - 30, scale: 2.2, alpha: 0, duration: 600, delay: i * 70,
        onComplete: (function (o) { return function () { o.destroy(); }; })(puff) });
    }
  }

  /* Tank detruit : le commando est ejecte par l'ecoutille et la carcasse
   * explose derriere lui (explosion de zone, comme une grenade). */
  ejectFromTank() {
    var P = this.player, S = TANK_SCALE, self = this;
    this.sfx('eject', P.x);
    var dir = P.flipX ? -1 : 1;
    var wreck = this.add.image(P.x, P.y, 'tex-player-tank').setScale(S).setFlipX(P.flipX).setTint(0x5a5a5a).setDepth(-0.5);
    var hatchX = P.x + dir * TANK_HATCH.x * S, hatchTop = P.y + TANK_HATCH.y * S;
    this.exitTankMode();
    P.x = hatchX;
    P.y = hatchTop - STAND_HEIGHT * PLAYER_SCALE / 2;
    P.body.reset(P.x, P.y);
    P.setVelocityY(-560);
    this.tweens.add({ targets: wreck, x: wreck.x + 4, duration: 50, yoyo: true, repeat: 4 });
    this.time.delayedCall(450, function () {
      self.blastAt(wreck.x, wreck.y);
      self.cameras.main.shake(260, 0.02);
      for (var i = 0; i < 6; i += 1) self.spark(wreck.x + Phaser.Math.Between(-90, 90), wreck.y + Phaser.Math.Between(-40, 30));
      self.tweens.add({ targets: wreck, alpha: 0, duration: 250, onComplete: function () { wreck.destroy(); } });
    });
  }

  /* Change de gabarit (commando <-> tank) en gardant les pieds au meme
   * niveau : les deux corps n'ont pas la meme hauteur, sans ce recalage le
   * nouveau corps pouvait naitre enfonce dans le sol (et passer au travers). */
  swapPlayerGabarit(applyFn) {
    var p = this.player;
    var feetY = p.body.bottom;
    applyFn.call(this);
    p.body.updateFromGameObject();
    p.y += feetY - p.body.bottom;
    p.body.reset(p.x, p.y);
  }

  exitTankMode() {
    this.tankMode = false;
    this.swapPlayerGabarit(function () {
      this.player.setTexture('tex-player', PLAYER_FRAME.idle);
      this.player.setScale(PLAYER_SCALE);
      this.player.angle = 0; // fin du tressautement du tank
      this.applyHeroBody();
    });
    this.player.invulnerableUntil = this.time.now + TANK_EJECT_INVULN_MS;
    this.spark(this.player.x, this.player.y);
    this.cameras.main.shake(220, 0.016);
    this.updateHud();
  }

  /* Serie de kills sans prendre de degats - remise a zero au premier
   * coup encaisse (voir damagePlayer). Objectif explicite : donner
   * envie de "pousser sa chance" plutot qu'un score purement lineaire,
   * sans quoi le jeu tourne vite en routine. */
  registerKill(x, y, baseScore) {
    this.streak = (this.streak || 0) + 1;
    var bonus = Math.min(this.streak - 1, 10) * 5;
    this.score += baseScore + bonus;
    this.updateHud();
    if (this.streak >= 3) {
      this.showComboText(x, y, this.streak);
    }
  }

  showComboText(x, y, streak) {
    var t = this.add.text(x, y - 30, 'COMBO x' + streak, {
      fontFamily: 'monospace', fontSize: '16px', color: '#ffcc4d', fontStyle: 'bold'
    }).setOrigin(0.5);
    this.tweens.add({
      targets: t, y: y - 60, alpha: 0, duration: 500,
      onComplete: function () { t.destroy(); }
    });
  }

  damagePlayer(amount) {
    if (this.time.now < this.player.invulnerableUntil || this.gameOver) return;
    this.streak = 0;
    this.cameras.main.shake(150, 0.014);
    this.cameras.main.flash(90, 200, 40, 40);

    if (this.tankMode) {
      // Le tank encaisse a la place du joueur - courte fenetre anti-cumul
      // (bien plus courte que les 1000ms hors tank) pour eviter qu'un
      // soldat ET un tir touchent au meme instant et retirent 2 points
      // d'un coup, sans pour autant le rendre quasi-invulnerable.
      this.player.invulnerableUntil = this.time.now + 150;
      this.tankHp -= amount;
      this.sfx('tankHit', this.player.x);
      this.updateHud();
      if (this.tankHp <= 0) {
        this.ejectFromTank();
      }
      return;
    }

    // Sante en traits (voir PLAYER_HEALTH_MAX) : 1 coup = 1 trait (x les
    // degats de la balle). Courte fenetre anti-cumul (2 balles au meme
    // instant = 1 seul coup), plus courte que l'ancienne seconde puisqu'on
    // a maintenant 10 traits par vie au lieu d'un coup = une vie.
    this.player.invulnerableUntil = this.time.now + 450;
    this.player.health -= amount;
    this.sfx(this.player.health <= 0 ? 'lifeLost' : 'playerHurt', this.player.x);
    if (this.player.health <= 0) {
      if (this.player.hp <= 0) {
        this.player.health = 0;
        this.updateHud();
        this.endGame();
        return;
      }
      // Barre vide : une vie en moins, barre rechargee, invulnerabilite
      // plus longue pour se remettre (clignotement).
      this.player.hp -= 1;
      this.player.health = PLAYER_HEALTH_MAX;
      this.player.invulnerableUntil = this.time.now + LIFE_LOST_INVULN_MS;
      this.player.lifeLostUntil = this.player.invulnerableUntil;
      this.cameras.main.flash(220, 255, 60, 60);
      this.tweens.add({ targets: this.player, alpha: 0.1, duration: 120, yoyo: true, repeat: 7,
        onComplete: function () { this.player.alpha = 1; }, callbackScope: this });
    }
    this.updateHud();
  }

  /* Esquive REELLE (plus de regle abstraite "invulnerable en l'air") : la
   * balle touche si elle recoupe vraiment le corps. Seule exception, pour
   * l'accroupi (le corps physique ne change pas de taille, voir
   * "wantsCrouch") : une balle qui arrive dans le HAUT du corps
   * (PLAYER_CROUCH_DUCK du haut) passe au-dessus d'un joueur baisse, et
   * continue sa course (plus lisible qu'une balle qui disparait). */
  isDodgingBullets(bullet) {
    // Plus de regle abstraite : l'accroupi abaisse le vrai corps physique
    // (voir applyHeroBody / CROUCH_BODY_H), l'esquive est donc geometrique.
    return false;
  }

  onEnemyBulletHitsPlayer(player, bullet) {
    if (this.isDodgingBullets(bullet)) return;
    var dmg = bullet.damage || 1;
    bullet.destroy();
    this.damagePlayer(dmg);
  }

  onEnemyTouchesPlayer() {
    this.damagePlayer(1);
  }

  /* Mise a mort au corps a corps - meme logique de score que damageSoldier
   * (score elite vs normal) mais tue d'un coup quel que soit le hp restant
   * et n'inflige jamais de degats au joueur (voir le collider ci-dessus).
   * ATTENTION ordre des parametres : teste et confirme empiriquement dans
   * ce build Phaser, un overlap(groupe, objet_unique, callback) livre les
   * parametres INVERSES par rapport a l'ordre d'enregistrement -
   * l'objet unique (ici this.player) arrive TOUJOURS en premier parametre,
   * jamais le membre du groupe. Piege reel rencontre : la premiere version
   * nommait (soldier, player) alors que le premier parametre recevait en
   * realite le joueur - soldier.destroy() detruisait donc le joueur. Le
   * cas groupe-vs-groupe (ex: playerBullets/soldiers) n'a PAS ce probleme,
   * l'ordre d'enregistrement y est respecte normalement - verifie aussi. */
  onPlayerMeleesSoldier(player, soldier) {
    if (!soldier.active) return;
    var isElite = !!soldier.elite;
    var x = soldier.x, y = soldier.y;
    if (soldier.walkAnim) this.soldierDeathFx(soldier);
    soldier.destroy();
    this.spark(x, y);
    this.registerKill(x, y, isElite ? ELITE_SCORE : 40);
  }

  /* Texte qui s'envole au-dessus d'un bonus ramasse (couleur du baril). */
  floatPickupText(x, y, label, color, stroke) {
    var t = this.add.text(x, y - 18, label, {
      fontFamily: 'monospace', fontSize: '14px', fontStyle: 'bold', color: color, stroke: stroke, strokeThickness: 3
    }).setOrigin(0.5);
    this.tweens.add({ targets: t, y: t.y - 30, alpha: 0, duration: 800, onComplete: function () { t.destroy(); } });
  }

  onPickup(player, pickup) {
    var kind = pickup.kind;
    var px = pickup.x, py = pickup.y;
    pickup.destroy();
    if (kind === 'oil') {
      // Jaune : des dollars.
      this.score += OIL_SCORE;
      this.floatPickupText(px, py, '+$' + OIL_SCORE, '#ffd23a', '#3a2a00');
      this.sfx('coin', px);
    } else if (kind === 'oil-blue') {
      // Bleu : de la sante (traits de la barre, plafonnee au max).
      this.player.health = Math.min(this.player.health + OIL_BLUE_HEALTH, PLAYER_HEALTH_MAX);
      this.floatPickupText(px, py, '+SANTE', '#4ad2ff', '#002a3a');
      this.sfx('health', px);
    } else if (kind === 'oil-green') {
      // Vert : une vie (plafonnee a maxHp) - le plus rare.
      var gained = this.player.hp < this.player.maxHp;
      if (gained) this.player.hp += 1;
      this.floatPickupText(px, py, gained ? '+1 VIE' : 'VIES MAX', '#7dff3a', '#0a2a00');
      this.sfx(gained ? 'oneUp' : 'coin', px);
    } else if (kind === 'rapid') {
      this.rapidFireUntil = this.time.now + 8000;
      this.score += 20;
      this.floatPickupText(px, py, 'TIR RAPIDE', '#ffb04a', '#3a1a00');
      this.sfx('weapon', px);
    } else if (kind === 'tank') {
      this.enterTankMode();
      this.score += 30;
    } else if (kind === 'grenade') {
      this.grenadeCount = Math.min(this.grenadeCount + 1, GRENADE_MAX + 2);
      this.floatPickupText(px, py, '+1 GRENADE', '#b8e05a', '#1a2a00');
      this.sfx('coin', px);
    } else if (kind === 'shotgun') {
      this.weaponMode = 'shotgun';
      this.weaponUntil = this.time.now + SHOTGUN_DURATION_MS;
      this.score += 20;
      this.floatPickupText(px, py, 'FUSIL A POMPE', '#ff6a5a', '#3a0000');
      this.sfx('weapon', px);
    } else if (kind === 'chaser') {
      this.weaponMode = 'chaser';
      this.weaponUntil = this.time.now + CHASER_DURATION_MS;
      this.score += 20;
      this.floatPickupText(px, py, 'TIR CHASSEUR', '#c89aff', '#1a003a');
      this.sfx('weapon', px);
    }
    this.updateHud();
  }

  /* Baril explosif - degats de zone au tir, avec chaine possible sur un
   * autre baril dans le rayon (voir en-tete du fichier). */
  onBulletHitsBarrel(bullet, barrel) {
    if (!barrel.active || !bullet.active) return;
    if (this.enemyShieldsBarrel(bullet)) return; // un ennemi devant le baril prend la balle
    if (bullet.isTankShell) { this.explodeShell(bullet); return; } // l'onde fait sauter le baril
    bullet.destroy();
    this.hitBarrel(barrel, 1);
  }

  /* Baril bonus (jaune/bleu/vert) touche : explose d'un seul tir (bonus
   * perdu), memes degats de zone qu'un baril rouge. */
  onBulletHitsOilBarrel(bullet, pickup) {
    if (!pickup.active || !bullet.active) return;
    if (this.enemyShieldsBarrel(bullet)) return;
    if (bullet.isTankShell) { this.explodeShell(bullet); return; }
    bullet.destroy();
    this.explodeBarrel(pickup);
  }

  /* Un ennemi au sol qui passe DEVANT un baril prend la balle a sa place
   * (sinon impossible de tirer sur un ennemi colle a un baril sans le faire
   * sauter). Renvoie true si la balle a ete consommee par l'ennemi. */
  enemyShieldsBarrel(bullet) {
    var bx = bullet.x, by = bullet.y, self = this;
    var groups = [[this.soldiers, 'damageSoldier', 1], [this.heavies, 'damageHeavy', 1], [this.chargers, 'damageCharger', 1]];
    for (var i = 0; i < groups.length; i += 1) {
      var list = groups[i][0].getChildren();
      for (var k = 0; k < list.length; k += 1) {
        var e = list[k];
        if (!e.active || !e.body) continue;
        var b = e.body;
        if (bx >= b.left - 12 && bx <= b.right + 12 && by >= b.top - 6 && by <= b.bottom) {
          if (bullet.isTankShell) { self.explodeShell(bullet); return true; }
          bullet.destroy();
          self[groups[i][1]](e, groups[i][2]);
          return true;
        }
      }
    }
    return false;
  }

  /* Baril rouge : encaisse BARREL_HITS tirs (flash + petite secousse a
   * chaque impact pour montrer qu'il "chauffe"), puis explose. Les
   * explosions (grenade, autre baril) passent par explodeBarrel direct. */
  hitBarrel(barrel, amount) {
    if (!barrel.active) return;
    barrel.hp = (barrel.hp === undefined ? BARREL_HITS : barrel.hp) - amount;
    if (barrel.hp <= 0) { this.explodeBarrel(barrel); return; }
    this.sfx('barrelHit', barrel.x);
    barrel.setTint(0xffe08a);
    this.time.delayedCall(70, function () { if (barrel.active) barrel.clearTint(); });
    this.spark(barrel.x, barrel.y - 6);
  }

  explodeBarrel(barrel) {
    if (!barrel.active) return;
    var x = barrel.x, y = barrel.y;
    barrel.destroy();
    this.sfx('explosion', x);
    this.cameras.main.shake(160, 0.011);
    var ring = this.add.circle(x, y, 10, 0xff8a3a, 0.55);
    this.tweens.add({ targets: ring, radius: BARREL_BLAST_RADIUS, alpha: 0, duration: 240, onComplete: function () { ring.destroy(); } });
    this.spark(x, y);

    var self = this;
    this.soldiers.getChildren().slice().forEach(function (s) {
      if (Phaser.Math.Distance.Between(x, y, s.x, s.y) <= BARREL_BLAST_RADIUS) self.damageSoldier(s, 99);
    });
    this.heavies.getChildren().slice().forEach(function (h) {
      if (Phaser.Math.Distance.Between(x, y, h.x, h.y) <= BARREL_BLAST_RADIUS) self.damageHeavy(h, 3);
    });
    this.chargers.getChildren().slice().forEach(function (c) {
      if (Phaser.Math.Distance.Between(x, y, c.x, c.y) <= BARREL_BLAST_RADIUS) self.damageCharger(c, 3);
    });
    // Reaction en chaine : un autre baril dans le rayon explose a son
    // tour (delai court pour que l'oeil suive l'enchainement).
    this.barrels.getChildren().concat(this.oilBarrels()).forEach(function (other) {
      if (other !== barrel && other.active && Phaser.Math.Distance.Between(x, y, other.x, other.y) <= BARREL_BLAST_RADIUS) {
        self.time.delayedCall(90, function () { self.explodeBarrel(other); });
      }
    });
    // Le joueur trop proche encaisse aussi - meme logique que le vrai
    // Metal Slug (les barils punissent une position trop collee).
    if (Phaser.Math.Distance.Between(x, y, this.player.x, this.player.y) <= BARREL_BLAST_RADIUS) {
      this.damagePlayer(1);
    }
  }

  /* Bruitage place dans l'espace stereo selon la position a l'ecran. */
  sfx(name, x, dur) {
    var pan = x === undefined ? 0
      : Phaser.Math.Clamp((x - this.cameras.main.scrollX - GAME_WIDTH / 2) / (GAME_WIDTH / 2), -1, 1) * 0.7;
    playSfx(name, { pan: pan, dur: dur });
  }

  /* ---------- Sequences "sol en feu" (voir FIRE_* en tete) ---------- */
  fireZoneAt(x, margin) {
    var m = margin || 0;
    for (var i = 0; i < this.fireZones.length; i += 1) {
      var z = this.fireZones[i];
      if (x >= z.x0 - m && x <= z.x1 + m) return z;
    }
    return null;
  }

  /* Chaine de plateformes puis nappe de feu dessous : la premiere plateforme
   * deborde AVANT la nappe (on y saute depuis le sol sain) et la nappe
   * s'arrete au bord droit de la derniere (on redescend sur du sol sain). */
  createFireZone(x) {
    var objs = [];
    var n = Phaser.Math.Between(FIRE_PLATFORMS_MIN, FIRE_PLATFORMS_MAX);
    var left = x;                    // bord gauche de la plateforme courante
    var x0 = x + 50;                 // debut de la nappe : 50 px sous la 1re plateforme
    for (var i = 0; i < n; i += 1) {
      var w = Phaser.Math.Between(170, 280);
      var got = this.spawnPlatform(left + w / 2, w);
      objs = objs.concat(got);
      left += w + Phaser.Math.Between(90, 150);
    }
    var lastPlat = objs.filter(function (o) { return o.body && o.texture && o.texture.key === 'tex-platform'; }).pop();
    var x1 = lastPlat.body.right - 30;
    var z = { x0: x0, x1: x1, warned: false, nextTankTick: 0, nextEmber: 0 };
    // Visuel : sol noirci + deux couches de flammes qui ondulent.
    var w0 = x1 - x0;
    z.scorch = this.add.rectangle(x0 + w0 / 2, GROUND_Y + 30, w0, 60, 0x1a0804, 0.55).setDepth(-0.9);
    z.fireBack = this.add.tileSprite(x0, GROUND_Y + 10, w0, 44, 'tex-fire').setOrigin(0, 1).setDepth(-0.85).setAlpha(0.75);
    z.fireFront = this.add.tileSprite(x0, GROUND_Y + 14, w0, 44, 'tex-fire').setOrigin(0, 1).setDepth(25).setAlpha(0.9).setScale(1, 0.8);
    z.fireFront.tilePositionX = 23;
    objs.push(z.scorch, z.fireBack, z.fireFront);
    this.fireZones.push(z);
    this.activeChunks.push({ x: x1 + 200, objs: objs });
    this.nextSpawnX = x1 + 260;
    this.nextFireZoneX = x1 + Phaser.Math.Between(FIRE_GAP_MIN, FIRE_GAP_MAX);
    return z;
  }

  updateFireZones(onGround) {
    if (!this.fireZones.length) return;
    var now = this.time.now, P = this.player, self = this;
    var dt = this.game.loop.delta / 1000;
    var cam = this.cameras.main;
    this.fireZones = this.fireZones.filter(function (z) {
      if (!z.fireFront || !z.fireFront.active) return false; // nettoyee (derriere le joueur)
      // flammes vivantes
      z.fireBack.tilePositionX += dt * 30;
      z.fireFront.tilePositionX -= dt * 45;
      z.fireFront.scaleY = 1.3 + Math.sin(now / 120) * 0.12;
      z.fireBack.scaleY = 2.0 + Math.sin(now / 150 + 1) * 0.18;
      // alerte a l'approche
      // (pas d'annonce sonore ni visuelle : demande utilisateur, seuls les
      // missiles sont annonces - la nappe se voit arriver a l'ecran)
      // braises qui montent (seulement dans la vue)
      if (now > z.nextEmber && z.x1 > cam.scrollX && z.x0 < cam.scrollX + GAME_WIDTH) {
        z.nextEmber = now + 90;
        var ex = Phaser.Math.Between(Math.max(z.x0, cam.scrollX), Math.min(z.x1, cam.scrollX + GAME_WIDTH));
        var em = self.add.rectangle(ex, GROUND_Y - 10, 4, 4, Phaser.Math.RND.pick([0xffd24a, 0xf06a1e, 0xffe9a0])).setDepth(25);
        self.tweens.add({ targets: em, y: em.y - Phaser.Math.Between(80, 200), x: em.x + Phaser.Math.Between(-30, 30), alpha: 0,
          duration: Phaser.Math.Between(600, 1100), onComplete: function () { em.destroy(); } });
      }
      // ennemis au sol qui entrent dans les flammes : brules
      [self.soldiers, self.heavies, self.chargers].forEach(function (grp) {
        grp.getChildren().slice().forEach(function (e) {
          if (!e.active || !e.body) return;
          if (e.body.bottom >= GROUND_Y - 4 && e.x > z.x0 + FIRE_MARGIN && e.x < z.x1 - FIRE_MARGIN) {
            if (grp === self.soldiers) self.damageSoldier(e, 99);
            else if (grp === self.heavies) self.damageHeavy(e, 99);
            else self.damageCharger(e, 99);
          }
        });
      });
      // joueur au sol dans les flammes
      var inFire = P.body && P.body.bottom >= GROUND_Y - 4 && onGround
        && P.x > z.x0 + FIRE_MARGIN && P.x < z.x1 - FIRE_MARGIN && !self.boarding;
      if (inFire) {
        if (self.tankMode) {
          if (now >= z.nextTankTick) { z.nextTankTick = now + FIRE_TANK_DAMAGE_MS; self.player.invulnerableUntil = 0; self.damagePlayer(1); }
        } else if (now >= (P.lifeLostUntil || 0)) {
          self.killPlayerByFire(z);
        }
      }
      return true;
    });
  }

  showFireWarning() {
    this.sfx('missileAlarm');
    var t = this.add.text(GAME_WIDTH / 2, 170, 'SOL EN FEU ! PRENEZ LES PLATEFORMES', {
      fontFamily: 'monospace', fontSize: '28px', color: '#ffb03a', fontStyle: 'bold', stroke: '#2a0000', strokeThickness: 7
    }).setOrigin(0.5).setScrollFactor(0).setDepth(60);
    this.tweens.add({ targets: t, alpha: 0.25, duration: 180, yoyo: true, repeat: 4,
      onComplete: function () { this.tweens.add({ targets: t, alpha: 0, duration: 400, onComplete: function () { t.destroy(); } }); },
      callbackScope: this });
  }

  /* Toucher le sol en feu : une vie perdue (comme un missile), puis replace
   * sur la plateforme de la nappe la plus proche, clignotant 2 s. */
  killPlayerByFire(z) {
    var P = this.player;
    var burn = this.add.circle(P.x, GROUND_Y - 30, 30, 0xff7a2a, 0.8).setDepth(26);
    this.tweens.add({ targets: burn, scale: 2.2, alpha: 0, duration: 400, onComplete: function () { burn.destroy(); } });
    this.killPlayerByMissile();
    if (this.gameOver) return;
    var best = null, bestD = Infinity;
    this.platforms.getChildren().forEach(function (pl) {
      if (!pl.body || pl.body.right < z.x0 - 80 || pl.body.left > z.x1 + 80) return;
      var d = Math.abs(pl.x - P.x);
      if (d < bestD) { bestD = d; best = pl; }
    });
    if (best) {
      var nx = Phaser.Math.Clamp(P.x, best.body.left + 30, best.body.right - 30);
      var ny = best.body.top - (P.body.height / 2) - 2;
      P.body.reset(nx, ny - (P.body.center.y - P.y));
      P.setVelocity(0, 0);
    }
  }

  /* ---------- Frappes de missile (voir MISSILE_* en tete) ---------- */
  missileGap() {
    var d = this.difficulty();
    return Phaser.Math.Between(
      Math.round(Phaser.Math.Linear(MISSILE_GAP_MIN_MS, MISSILE_GAP_HARD_MIN_MS, d)),
      Math.round(Phaser.Math.Linear(MISSILE_GAP_MAX_MS, MISSILE_GAP_HARD_MAX_MS, d)));
  }

  updateMissiles() {
    var now = this.time.now;
    if (this.nextMissileAt === null) this.nextMissileAt = now + this.missileGap();
    if (now >= this.nextMissileAt && this.fireZoneAt(this.player.x, 500)) this.nextMissileAt = now + 3000; // pas pendant une nappe en feu
    if (now >= this.nextMissileAt && this.player.x > MISSILE_UNLOCK_DISTANCE && !this.boarding) {
      this.launchMissileStrike();
      this.nextMissileAt = now + this.missileGap();
    }
    var skyY = this.cameras.main.scrollY - 70;
    for (var i = this.missiles.length - 1; i >= 0; i -= 1) {
      var m = this.missiles[i];
      if (now < m.startAt) continue;
      var t = Phaser.Math.Clamp((now - m.startAt) / MISSILE_WARN_MS, 0, 1);
      // Aura : zone fixe qui clignote de plus en plus vite + anneau
      // interieur qui se resserre (compte a rebours lisible).
      m.zone.setVisible(true).setAlpha(0.35 + 0.4 * (Math.sin((now - m.startAt) / (150 - 100 * t)) + 1) / 2);
      m.edge.setVisible(true).setAlpha(0.5 + 0.5 * t);
      m.inner.setVisible(true).setScale(Math.max(0.02, 1 - t), 1);
      m.column.setVisible(true).setAlpha(0.08 + 0.16 * t);
      if (!m.missile && now >= m.impactAt - MISSILE_FALL_MS) {
        this.sfx('missileWhistle', m.x, MISSILE_FALL_MS / 1000);
        m.missile = this.add.image(m.x, skyY, 'tex-missile').setScale(MISSILE_SCALE).setOrigin(0.5, 1).setDepth(25);
      }
      if (m.missile) {
        var k = Phaser.Math.Clamp(1 - (m.impactAt - now) / MISSILE_FALL_MS, 0, 1);
        m.missile.y = Phaser.Math.Linear(skyY, GROUND_Y, Math.pow(k, 1.4));
      }
      if (now >= m.impactAt) {
        this.missiles.splice(i, 1);
        this.detonateMissile(m);
      }
    }
  }

  /* 1 (ou 2) zones dans la vue, placees pres du joueur pour le forcer a
   * bouger - jamais de quoi couvrir tout l'ecran. */
  launchMissileStrike() {
    var cam = this.cameras.main;
    var minX = cam.scrollX + MISSILE_RADIUS + 20;
    var maxX = cam.scrollX + GAME_WIDTH - MISSILE_RADIUS - 20;
    var first = Phaser.Math.Clamp(this.player.x + Phaser.Math.Between(-140, 260), minX, maxX);
    var targets = [first];
    if (Math.random() < MISSILE_DOUBLE_CHANCE * this.difficulty()) {
      // Seconde zone separee par un couloir sur d'au moins 180 px.
      var side = Math.random() < 0.5 ? -1 : 1;
      var gap = MISSILE_RADIUS * 2 + 180 + Phaser.Math.Between(0, 160);
      var second = first + side * gap;
      if (second < minX || second > maxX) second = first - side * gap;
      if (second >= minX && second <= maxX) targets.push(second);
    }
    this.showMissileWarning();
    this.sfx('missileAlarm');
    var self = this;
    targets.forEach(function (x, idx) { self.addMissileZone(x, self.time.now + idx * 250); });
  }

  addMissileZone(x, startAt) {
    var w = MISSILE_RADIUS * 2;
    var m = { x: x, startAt: startAt, impactAt: startAt + MISSILE_WARN_MS, missile: null };
    // Colonne tres legere sur toute la hauteur (sauter ne sauve pas) +
    // aura au sol : ellipse pleine, contour, anneau qui se resserre.
    m.column = this.add.rectangle(x, GROUND_Y / 2, w, GROUND_Y, 0xff2a2a, 1).setDepth(-0.8).setVisible(false);
    m.zone = this.add.ellipse(x, GROUND_Y + 8, w, 46, 0xff2a2a, 1).setDepth(-0.7).setVisible(false);
    m.edge = this.add.ellipse(x, GROUND_Y + 8, w, 46).setStrokeStyle(4, 0xff5a3a, 1).setDepth(-0.7).setVisible(false);
    m.inner = this.add.ellipse(x, GROUND_Y + 8, w, 46).setStrokeStyle(3, 0xffe08a, 1).setDepth(-0.7).setVisible(false);
    this.missiles.push(m);
  }

  showMissileWarning() {
    var t = this.add.text(GAME_WIDTH / 2, 140, '/!\\ ALERTE MISSILE /!\\', {
      fontFamily: 'monospace', fontSize: '32px', color: '#ffe23a', fontStyle: 'bold',
      stroke: '#2a0000', strokeThickness: 7
    }).setOrigin(0.5).setScrollFactor(0).setDepth(60);
    this.tweens.add({ targets: t, alpha: 0.2, duration: 160, yoyo: true, repeat: 3,
      onComplete: function () {
        this.tweens.add({ targets: t, alpha: 0, duration: 300, onComplete: function () { t.destroy(); } });
      }, callbackScope: this });
  }

  detonateMissile(m) {
    [m.column, m.zone, m.edge, m.inner, m.missile].forEach(function (o) { if (o) o.destroy(); });
    if (this.gameOver) return;
    var x = m.x, y = GROUND_Y;
    this.sfx('bigExplosion', x);
    // Explosion plus grosse qu'une grenade : boule de feu, onde au sol,
    // etincelles et fumee.
    this.cameras.main.shake(320, 0.022);
    this.cameras.main.flash(120, 255, 200, 120);
    // Boule de feu en couches (rouge -> orange -> coeur blanc), qui gonfle
    // puis s'eteint du coeur vers l'exterieur.
    [[0xc8321e, 1.0, 700], [0xff8a2a, 0.78, 560], [0xfff0b0, 0.5, 380]].forEach(function (layer, idx) {
      var r = MISSILE_RADIUS * layer[1];
      var ball = this.add.ellipse(x, y - r * 0.55, r * 0.8, r * 0.7, layer[0], 1).setDepth(26 + idx * 0.1);
      this.tweens.add({ targets: ball, scaleX: 2.4, scaleY: 2.2, duration: layer[2] * 0.4, ease: 'Quad.Out' });
      this.tweens.add({ targets: ball, alpha: 0, delay: layer[2] * 0.45, duration: layer[2] * 0.55,
        onComplete: function () { ball.destroy(); } });
    }, this);
    var wave = this.add.ellipse(x, y + 6, 40, 20, 0xff7a2a, 0.7).setDepth(-0.6);
    this.tweens.add({ targets: wave, scaleX: MISSILE_RADIUS * 2.4 / 40, scaleY: 2.2, alpha: 0, duration: 380, onComplete: function () { wave.destroy(); } });
    for (var i = 0; i < 8; i += 1) this.spark(x + Phaser.Math.Between(-MISSILE_RADIUS, MISSILE_RADIUS), y - Phaser.Math.Between(0, 120));
    for (var j = 0; j < 5; j += 1) {
      var puff = this.add.circle(x + Phaser.Math.Between(-80, 80), y - 10, Phaser.Math.Between(14, 22), 0x3a3230, 0.75).setDepth(24);
      this.tweens.add({ targets: puff, y: puff.y - Phaser.Math.Between(60, 130), scale: 2.4, alpha: 0, duration: 900 + j * 80,
        onComplete: (function (o) { return function () { o.destroy(); }; })(puff) });
    }

    // Tout ce qui est dans la colonne est detruit.
    var self = this;
    function inZone(o) { return Math.abs(o.x - x) <= MISSILE_RADIUS; }
    this.soldiers.getChildren().slice().forEach(function (s) { if (inZone(s)) self.damageSoldier(s, 99); });
    this.heavies.getChildren().slice().forEach(function (h) { if (inZone(h)) self.damageHeavy(h, 99); });
    this.chargers.getChildren().slice().forEach(function (c) { if (inZone(c)) self.damageCharger(c, 99); });
    this.flyers.getChildren().slice().forEach(function (f) { if (inZone(f)) self.damageFlyer(f, 99); });
    this.barrels.getChildren().slice().forEach(function (b) {
      if (inZone(b)) self.time.delayedCall(60, function () { self.explodeBarrel(b); });
    });

    // Joueur : son torse visible recoupe la zone (le corps physique fait
    // 60 px de large, plus que la silhouette : trop severe a l'oeil).
    if (Math.abs(this.player.x - x) <= MISSILE_RADIUS + MISSILE_PLAYER_HALF * (this.tankMode ? 2.5 : 1)) {
      this.killPlayerByMissile();
    }
  }

  /* Mort immediate, sante ignoree. Seule protection : le clignotement qui
   * suit la perte d'une vie (sinon 2 zones d'affilee = 2 vies). En tank :
   * le tank saute ET le commando perd une vie. */
  killPlayerByMissile() {
    if (this.gameOver || this.time.now < (this.player.lifeLostUntil || 0)) return;
    this.streak = 0;
    if (this.tankMode) {
      this.tankHp = 0;
      this.ejectFromTank();
    }
    if (this.player.hp <= 0) {
      // Derniere vie (compteur a 0) : pas de mort instantanee (demande
      // utilisateur), le coup retire LAST_LIFE_INSTANT_DAMAGE traits ; game
      // over seulement si la barre tombe a zero.
      this.player.health -= LAST_LIFE_INSTANT_DAMAGE;
      if (this.player.health <= 0) {
        this.player.health = 0;
        this.updateHud();
        this.endGame();
        return;
      }
      this.player.invulnerableUntil = this.time.now + LIFE_LOST_INVULN_MS * 0.75;
      this.player.lifeLostUntil = this.player.invulnerableUntil;
      this.sfx('playerHurt', this.player.x);
      this.cameras.main.flash(200, 255, 60, 60);
      this.tweens.add({ targets: this.player, alpha: 0.1, duration: 120, yoyo: true, repeat: 5,
        onComplete: function () { this.player.alpha = 1; }, callbackScope: this });
      this.updateHud();
      return;
    }
    this.player.hp -= 1;
    this.player.health = PLAYER_HEALTH_MAX;
    this.player.invulnerableUntil = this.time.now + LIFE_LOST_INVULN_MS;
    this.player.lifeLostUntil = this.player.invulnerableUntil;
    this.sfx('lifeLost');
    this.cameras.main.flash(260, 255, 60, 60);
    this.tweens.add({ targets: this.player, alpha: 0.1, duration: 120, yoyo: true, repeat: 7,
      onComplete: function () { this.player.alpha = 1; }, callbackScope: this });
    this.updateHud();
  }

  endGame() {
    if (this.gameOver) return;
    this.gameOver = true;
    stopMusic();
    playSfx('gameOver');
    this.cancelPendingTimers();
    if (this.grenadeChargeBar) { this.grenadeChargeBar.destroy(); this.grenadeChargeBar = null; }
    this.player.setVelocity(0, 0);
    this.physics.pause();
    this.time.delayedCall(500, function () {
      this.scene.start('GameOverScene', { score: this.score });
    }, [], this);
  }

  cancelPendingTimers() {
    if (this.spawnEvent) this.spawnEvent.remove(false);
    if (this.secondEvent) this.secondEvent.remove(false);
  }

  /* Appele par FiveCadeGame.onClose() (Echap) - stoppe tout proprement
   * sans attendre le cycle normal de fin de partie. */
  hardStop() {
    this.cancelPendingTimers();
    stopMusic();
    if (this.grenadeChargeBar) { this.grenadeChargeBar.destroy(); this.grenadeChargeBar = null; }
    this.gameOver = true;
  }

  update(time, delta) {
    if (this.gameOver) return;

    // Voir GROUND_GRACE_MS en tete de fichier - le signal brut de la
    // physique clignote au repos, ce lissage le rend stable sans jamais
    // masquer un vrai saut (qui quitte le sol bien plus longtemps que la
    // fenetre de grace).
    var touchingGround = this.player.body.blocked.down || this.player.body.touching.down;
    if (touchingGround) this.lastGroundedAt = this.time.now;
    var onGround = (this.time.now - this.lastGroundedAt) < GROUND_GRACE_MS;

    // Commandes du joueur - gelees pendant la montee dans le tank
    // (animation d'entree, voir boardParkedTank).
    if (!this.boarding) {
      // Accroupissement (BAS) - immobile le temps de rester baisse, pas
      // utilisable en l'air ni en mode tank (deja un autre gabarit).
      // Changement d'IMAGE (accroupi de la planche, meme cadre, voir
      // updateHeroPose) + un flag logique (this.crouching) pour la regle d'esquive dans
      // onEnemyBulletHitsPlayer - voir le commentaire de CROUCH_HEIGHT en
      // tete de fichier : setScale() a ete teste et rejete, il redimensionne
      // reellement le corps physique en continu dans ce build et provoquait
      // un passage a travers le sol pres d'un obstacle. Une texture de meme
      // cadre laisse le corps totalement intact, aucune geometrie de
      // collision a resynchroniser.
      var wantsCrouch = this.cursors.down.isDown && onGround && !this.tankMode;
      if (wantsCrouch !== this.crouching) {
        this.crouching = wantsCrouch; // image affichee par updateHeroPose
        this.applyHeroBody();         // corps physique abaisse / releve
      }

      if (this.crouching) {
        this.player.setVelocityX(0);
      } else if (this.cursors.left.isDown) {
        this.player.setVelocityX(-190);
        this.player.facing = -1;
        this.player.flipX = true;
      } else if (this.cursors.right.isDown) {
        this.player.setVelocityX(190);
        this.player.facing = 1;
        this.player.flipX = false;
      } else {
        this.player.setVelocityX(0);
      }

      if (Phaser.Input.Keyboard.JustDown(this.jumpKey) && onGround && !this.crouching) {
        this.player.setVelocityY(PLAYER_JUMP_VY);
        this.sfx('jump', this.player.x);
      }
      this.updateHeroPose(onGround);

      if (this.fireKey.isDown) {
        this.firePlayerBullet();
      }
      // Grenade a charge : maintenir G envoie plus loin (voir
      // startGrenadeCharge/releaseGrenadeCharge), jusqu'a
      // GRENADE_CHARGE_MAX_MS de maintien pour la portee maximale.
      if (Phaser.Input.Keyboard.JustDown(this.grenadeKey)) {
        this.startGrenadeCharge();
      } else if (this.grenadeKey.isDown) {
        this.updateGrenadeChargeBar();
      } else if (Phaser.Input.Keyboard.JustUp(this.grenadeKey)) {
        this.releaseGrenadeCharge();
      }
    }
    this.updateTankDrop(); // largage / tank gare / montee (tourne aussi pendant la montee)
    this.updateMissiles();
    this.updateFireZones(onGround);
    this.updateTankReloadBar();
    if (this.weaponMode !== 'rifle' && this.time.now > this.weaponUntil) {
      this.weaponMode = 'rifle';
      this.updateHud();
    }

    var self = this;

    // Tir chasseur - correction progressive de la trajectoire vers la
    // cible accrochee (vitesse constante, virage limite par frame, voir
    // CHASER_TURN_RATE en tete de fichier). Reaccroche une nouvelle
    // cible des que l'actuelle meurt ou sort de portee, jamais de
    // demi-tour instantane qui casserait la lisibilite de la trajectoire.
    var homingBullets = this.playerBullets.getChildren().filter(function (b) { return b.homing; });
    if (homingBullets.length) {
      var allTargets = this.soldiers.getChildren()
        .concat(this.heavies.getChildren())
        .concat(this.flyers.getChildren())
        .concat(this.chargers.getChildren());
      homingBullets.forEach(function (b) {
        if (!b.active) return;
        if (!b.homingTarget || !b.homingTarget.active) {
          var best = null, bestDist = CHASER_RANGE;
          allTargets.forEach(function (t) {
            if (!t.active) return;
            var d = Phaser.Math.Distance.Between(b.x, b.y, t.x, t.y);
            if (d < bestDist) { bestDist = d; best = t; }
          });
          b.homingTarget = best;
        }
        if (!b.homingTarget) return;
        var desired = Math.atan2(b.homingTarget.y - b.y, b.homingTarget.x - b.x);
        var current = Math.atan2(b.body.velocity.y, b.body.velocity.x);
        var maxTurn = CHASER_TURN_RATE * (delta / 1000);
        var turn = Phaser.Math.Clamp(Phaser.Math.Angle.Wrap(desired - current), -maxTurn, maxTurn);
        var newAngle = current + turn;
        b.setVelocity(Math.cos(newAngle) * CHASER_SPEED, Math.sin(newAngle) * CHASER_SPEED);
        b.setRotation(newAngle);
      });
    }

    // Liste unique pour la repulsion mutuelle - un soldat evite aussi
    // bien un autre soldat qu'un tank, pas seulement les membres de son
    // propre groupe (voir MAX_ACTIVE_ENEMIES/ENEMY_SEPARATION en tete de
    // fichier : sans ca, plusieurs ennemis qui arrivent en meme temps
    // s'arretaient tous exactement a la meme distance du joueur et se
    // superposaient au meme endroit).
    var allGroundEnemies = this.soldiers.getChildren().concat(this.heavies.getChildren());

    function separationVx(entity) {
      var push = 0;
      for (var i = 0; i < allGroundEnemies.length; i += 1) {
        var other = allGroundEnemies[i];
        if (other === entity || !other.active) continue;
        var d = entity.x - other.x;
        if (Math.abs(d) < ENEMY_SEPARATION) {
          push += (d < 0 ? -1 : 1) * 40;
        }
      }
      return push;
    }

    // Couvert : le baril le plus proche strictement entre le soldat et le
    // joueur (verifie par le signe des deux ecarts), dans la limite de
    // COVER_SEEK_RANGE. Un tir joueur qui traverse cette ligne touche
    // physiquement le baril en premier (deja le cas via onBulletHitsBarrel)
    // avant d'atteindre le soldat - le couvert marche donc via la
    // collision deja existante, cette fonction ne fait que choisir OU se
    // poster, aucune nouvelle regle de degats a maintenir.
    function findCoverBarrel(entity) {
      var best = null, bestDist = COVER_SEEK_RANGE;
      self.barrels.getChildren().forEach(function (barrel) {
        if (!barrel.active) return;
        var between = (barrel.x - self.player.x) * (entity.x - barrel.x) > 0;
        if (!between) return;
        var d = Math.abs(entity.x - barrel.x);
        if (d < bestDist) { bestDist = d; best = barrel; }
      });
      return best;
    }

    this.soldiers.getChildren().slice().forEach(function (s) {
      if (!s.active) return;
      var toPlayer = self.player.x - s.x;
      var dist = Math.abs(toPlayer);
      var vx;
      if (s.stationary) {
        // Soldat en hauteur sur une plateforme (voir spawnPlatform) -
        // ne marche jamais, pour ne pas tomber du bord.
        vx = 0;
      } else if (dist < SOLDIER_RETREAT_DISTANCE) {
        // Priorite absolue : ne jamais rester a bout portant, meme un
        // couvert a proximite ne doit pas empecher ce recul.
        vx = Math.sign(toPlayer) * -70;
      } else {
        var coverBarrel = findCoverBarrel(s);
        if (coverBarrel) {
          // Se poste du cote du baril oppose au joueur, s'arrete une fois
          // en position (pas de va-et-vient une fois le point atteint).
          var coverX = coverBarrel.x + Math.sign(coverBarrel.x - self.player.x) * COVER_STAND_GAP;
          var toCover = coverX - s.x;
          vx = Math.abs(toCover) > 6 ? Math.sign(toCover) * 60 : 0;
        } else if (dist > SOLDIER_ENGAGE_DISTANCE) {
          // S'arrete a distance d'engagement pour tirer, ne fonce pas
          // jusqu'au contact - garde une vraie ligne de front lisible.
          vx = Math.sign(toPlayer) * 60;
        } else {
          vx = 0;
        }
      }
      if (!s.stationary) vx += separationVx(s);
      s.setVelocityX(vx);
      s.flipX = toPlayer < 0;
      if (s.walkAnim) {
        if (Math.abs(vx) > 5) {
          s.anims.play(s.walkAnim, true);
        } else if (s.anims.isPlaying) {
          s.anims.stop();
          s.setFrame(0);
        }
      }
      // Vise directement la position reelle du joueur (voir
      // fireEnemyBullet) - touche donc correctement un joueur sur une
      // plateforme, plus besoin d'attendre une hauteur precise.
      if (dist < 700 && self.time.now >= s.nextFireAt) {
        self.fireEnemyBullet(s, 'tex-bullet-soldier', 360, 1, s.walkAnim ? { x: s.muzzleX, y: s.muzzleY } : null);
        if (s.walkAnim) self.soldierShotFx(s);
        // Re-tire un nouveau delai a chaque coup (pas fixe pour toute la
        // duree de vie du soldat) - rend la cadence moins metronomique,
        // plus imprevisible d'un tir a l'autre.
        s.fireDelay = self.soldierFireDelay();
        s.nextFireAt = self.time.now + s.fireDelay;
      }
    });

    this.heavies.getChildren().slice().forEach(function (h) {
      if (!h.active) return;
      var toPlayer = self.player.x - h.x;
      var dist = Math.abs(toPlayer);
      var vx = dist > HEAVY_ENGAGE_DISTANCE ? Math.sign(toPlayer) * 30 : 0;
      vx += separationVx(h);
      h.setVelocityX(vx);
      h.flipX = toPlayer < 0;
      if (Math.abs(vx) > 5) {
        h.anims.play('camel-walk', true);
      } else if (h.anims.isPlaying) {
        h.anims.stop();
        h.setFrame(0);
      }
      if (dist < 900 && self.time.now >= h.nextFireAt) {
        self.fireEnemyBullet(h, 'tex-bullet-heavy', 260, 2, { x: CAMEL_MUZZLE_X * CAMEL_SCALE, y: CAMEL_MUZZLE_Y * CAMEL_SCALE });
        self.heavyShotFx(h);
        h.nextFireAt = self.time.now + h.fireDelay;
      }
    });

    // Elans - machine a etats (voir CHARGER_* en tete de fichier). La
    // direction de charge est figee au depart : c'est ce qui la rend
    // esquivable (sauter par-dessus, ou le laisser passer et le tirer
    // dans le dos pendant sa recuperation).
    this.chargers.getChildren().slice().forEach(function (c) {
      if (!c.active) return;
      var now = self.time.now;
      var toPlayer = self.player.x - c.x;
      var dist = Math.abs(toPlayer);
      if (c.state === 'approach') {
        c.setVelocityX(Math.sign(toPlayer) * CHARGER_APPROACH_SPEED);
        c.flipX = toPlayer < 0;
        c.anims.play('moose-gallop', true);
        c.anims.timeScale = 0.45; // trot lent avec les images de galop
        if (dist < CHARGER_TRIGGER_DISTANCE) {
          c.state = 'windup';
          self.sfx('moose', c.x); // brame d'avertissement avant la charge
          c.stateUntil = now + CHARGER_WINDUP_MS;
          c.setVelocityX(0);
          c.anims.stop();
          c.setFrame(0);
          c.setTint(0xff5a5a);
          c.alertText = self.add.text(c.x, c.y - 44 * MOOSE_SCALE, '!', {
            fontFamily: 'monospace', fontSize: '26px', color: '#ff3a3a', fontStyle: 'bold'
          }).setOrigin(0.5);
          self.tweens.add({ targets: c, alpha: 0.55, duration: 90, yoyo: true, repeat: 3 });
        }
      } else if (c.state === 'windup') {
        c.setVelocityX(0);
        if (c.alertText) c.alertText.setPosition(c.x, c.y - 44 * MOOSE_SCALE);
        if (now >= c.stateUntil) {
          if (c.alertText) { c.alertText.destroy(); c.alertText = null; }
          c.clearTint();
          c.alpha = 1;
          c.state = 'charge';
          c.chargeDir = toPlayer < 0 ? -1 : 1;
          // Borne au monde : sans ca, pres du debut du niveau, l'elan
          // depassait le bord gauche du sol et tombait dans le vide.
          c.chargeTargetX = Phaser.Math.Clamp(self.player.x + c.chargeDir * CHARGER_OVERSHOOT, 60, WORLD_WIDTH - 60);
          c.stateUntil = now + CHARGER_MAX_CHARGE_MS;
          c.flipX = c.chargeDir < 0;
          c.anims.play('moose-gallop', true);
          c.anims.timeScale = 1;
        }
      } else if (c.state === 'charge') {
        c.setVelocityX(c.chargeDir * CHARGER_SPEED);
        var passed = (c.x - c.chargeTargetX) * c.chargeDir >= 0;
        if (passed || now >= c.stateUntil) {
          c.state = 'recover';
          c.stateUntil = now + CHARGER_RECOVER_MS;
          c.setVelocityX(0);
          c.anims.stop();
          c.setFrame(0);
        }
      } else if (c.state === 'recover') {
        c.setVelocityX(0);
        if (now >= c.stateUntil) c.state = 'approach';
      }
    });

    // Unite volante - engage/degage horizontalement comme un soldat, mais
    // uniquement via setVelocity (X et Y) : le flottement vertical est un
    // simple rappel en douceur vers une trajectoire sinusoidale calculee
    // chaque frame, jamais une ecriture directe de la position (voir
    // commentaire des constantes FLYER_* en tete de fichier).
    this.flyers.getChildren().slice().forEach(function (f) {
      if (!f.active) return;
      var toPlayer = self.player.x - f.x;
      var dist = Math.abs(toPlayer);
      var vx = dist > FLYER_ENGAGE_DISTANCE ? Math.sign(toPlayer) * FLYER_SPEED : 0;
      f.setVelocityX(vx);
      f.flipX = toPlayer < 0;
      var targetY = f.baseY + Math.sin(self.time.now / 1000 * FLYER_BOB_SPEED + f.bobPhase) * FLYER_BOB_AMPLITUDE;
      f.setVelocityY((targetY - f.y) * 6);
      if (dist < 750 && self.time.now >= f.nextFireAt) {
        self.fireEnemyBullet(f, 'tex-bullet-flyer', 320, 1, { x: 0, y: 18 * FLYER_SCALE }); // sous le drone
        f.fireDelay = Phaser.Math.Between(FLYER_FIRE_DELAY_MIN, FLYER_FIRE_DELAY_MAX);
        f.nextFireAt = self.time.now + f.fireDelay;
      }
    });

    if (this.player.x + SPAWN_AHEAD > this.nextSpawnX - 200) {
      // laisse spawnWave() (sur son propre timer) gerer le rythme -
      // ici on s'assure juste que nextSpawnX ne prend jamais de retard
      // sur la camera si le joueur avance tres vite.
      this.nextSpawnX = Math.max(this.nextSpawnX, this.cameras.main.scrollX + GAME_WIDTH + 200);
    }
    this.cleanupBehind();

    // Decor : parallaxe + cycle jour/nuit sur le temps de partie.
    if (this.startedAtSec === null) this.startedAtSec = this.time.now / 1000;
    this.backdrop.update(this.cameras.main.scrollX, this.time.now / 1000 - this.startedAtSec);
  }
}

/* ============================================================
 * GameOverScene - sequence en 3 etapes (score -> saisie du nom ->
 * rejouer/quitter), meme pattern que les autres bornes.
 * ============================================================ */
class GameOverScene extends Phaser.Scene {
  constructor() {
    super('GameOverScene');
  }

  init(data) {
    this.finalScore = (data && data.score) || 0;
  }

  create() {
    drawDesertBackdrop(this, GAME_WIDTH, GAME_HEIGHT);
    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.4);

    // Record personnel (localStorage, propre a ce navigateur/poste) -
    // objectif explicite : donner un objectif concret a battre a chaque
    // partie, pas juste un score qui monte dans le vide.
    var best = 0;
    try { best = parseInt(localStorage.getItem('fivecade_invade_best') || '0', 10) || 0; } catch (e) { /* localStorage indisponible */ }
    var isNewBest = this.finalScore > best;
    if (isNewBest) {
      try { localStorage.setItem('fivecade_invade_best', String(this.finalScore)); } catch (e) { /* ignore */ }
    }

    this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 100, 'GAME OVER', {
      fontFamily: 'monospace', fontSize: '34px', color: '#ff3a5e'
    }).setOrigin(0.5);
    this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 40, 'BUTIN : $' + this.finalScore, {
      fontFamily: 'monospace', fontSize: '18px', color: '#ffffff'
    }).setOrigin(0.5);

    if (isNewBest && this.finalScore > 0) {
      var recordText = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 10, 'NOUVEAU RECORD !', {
        fontFamily: 'monospace', fontSize: '15px', color: '#ffcc4d', fontStyle: 'bold'
      }).setOrigin(0.5);
      this.tweens.add({ targets: recordText, scale: 1.15, yoyo: true, repeat: -1, duration: 400 });
    } else {
      this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 10, 'Record : ' + Math.max(best, this.finalScore), {
        fontFamily: 'monospace', fontSize: '13px', color: '#f0d9a0'
      }).setOrigin(0.5);
    }

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

    this.stage = 'gameover';
    // Classement a jour (un autre joueur a pu entrer entre-temps) : la
    // reponse arrive via FiveCadeGame.onScoresUpdated -> latestLeaderboard.
    safeCall(function () { window.FiveCadeBridge.requestScores(); });

    var self = this;
    this.input.keyboard.once('keydown', function () {
      if (self.stage !== 'gameover') return;
      self.continueHint.setVisible(false);
      if (!self.qualifiesForLeaderboard()) {
        // Pas dans les 25 meilleurs : pas de saisie de nom, score non enregistre.
        var last = latestLeaderboard[latestLeaderboard.length - 1];
        self.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 10,
          'Pas assez pour entrer au Top ' + LEADERBOARD_SIZE + ' (25e : $' + last.score + ')', {
            fontFamily: 'monospace', fontSize: '13px', color: '#ff9a7a'
          }).setOrigin(0.5);
        self.replayHints.forEach(function (t) { t.setVisible(true); });
        self.stage = 'replay';
        return;
      }
      self.stage = 'naming';
      window.FiveCadeBridge.promptName(function (chosenName) {
        window.FiveCadeBridge.submitScore(self.finalScore, chosenName);
        self.replayHints.forEach(function (t) { t.setVisible(true); });
        self.stage = 'replay';
      });
    });
    // Rejouer sur l'evenement clavier (une frappe breve n'est jamais perdue,
    // contrairement a Keyboard.JustDown - meme correctif que le menu).
    this.input.keyboard.on('keydown', function (ev) {
      if (self.stage === 'replay' && (ev.key === 'Enter' || ev.key === ' ')) self.scene.start('MainScene');
    });
  }

  qualifiesForLeaderboard() {
    if (this.finalScore <= 0) return false;
    if (!latestLeaderboard || latestLeaderboard.length < LEADERBOARD_SIZE) return true; // classement inconnu ou pas plein
    return this.finalScore > latestLeaderboard[latestLeaderboard.length - 1].score;
  }

  update() {
    // (rejouer : gere par l'evenement keydown, voir create)
    if (this.stage !== 'replay') return;
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
    backgroundColor: '#2b2a1f',
    // pixelArt : necessaire des le premier vrai sprite importe (flyer.png)
    // pour un rendu net (nearest-neighbor) au lieu d'un lissage flou par
    // defaut lors du scale - n'affecte pas les rectangles/cercles
    // generes par code (couleur plate, pas de difference visible).
    pixelArt: true,
    physics: {
      default: 'arcade',
      arcade: { gravity: { x: 0, y: 1200 }, debug: false }
    },
    scene: [BootScene, MenuScene, MainScene, GameOverScene]
  });
  window.__PHASER_GAME__ = game;

  var menuSceneRef = null;
  var mainSceneRef = null;
  var currentBorneType = 'invade';

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
      currentBorneType = borneType || 'invade';
      window.__fivecadeBorneOpenRequested = true;
      if (window.FiveCadeSound) safeCall(function () { window.FiveCadeSound.resume(); });
      if (!window.__fivecadeBootComplete) {
        return;
      }
      game.scene.stop('MainScene');
      game.scene.stop('GameOverScene');
      game.scene.stop('MenuScene');
      game.scene.start('MenuScene');
    },
    onClose: function () {
      window.__fivecadeBorneOpenRequested = false;
      if (menuSceneRef && menuSceneRef.scoresPanel) {
        menuSceneRef.closeScores();
      }
      if (mainSceneRef) {
        mainSceneRef.hardStop();
      }
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
