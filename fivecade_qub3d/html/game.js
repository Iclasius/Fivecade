/* ============================================================
 * FiveCade - Borne Qub3d
 * Puzzle de blocs qui tombent (Tetris-like). Plateau et pieces rendus en
 * vrai 3D live (Three.js, module ThreeBoard plus bas) sur un canvas
 * separe superpose au canvas Phaser 4 (charge en local via phaser.min.js
 * + three.min.js), qui ne garde que le HUD/menu et le fond decoratif
 * (starfield anime + grille synthwave 3D autour du plateau).
 * ============================================================ */

var GAME_WIDTH = 720;
var GAME_HEIGHT = 960;

var COLS = 6;
var ROWS = 9;
var CELL = 32;

/* Musiques d'ambiance (Suno, meme workflow que Bornes 1/2) : plusieurs
 * pistes de partie jouees en rotation aleatoire avec fondu enchaine
 * (jamais de coupure nette), + un jingle court a la fin. */
var GAMEPLAY_TRACKS = [
  'music-gameplay', 'music-gameplay-2', 'music-gameplay-3',
  'music-gameplay-4', 'music-gameplay-5'
];
/* Le vrai "Qub3d Menu Theme" a ete genere dans Suno mais son
 * telechargement est bloque par le quota mensuel du compte (0 restant) -
 * en attendant, on reutilise Mellow Bits (piste de jeu la plus calme,
 * deja telechargee) comme theme d'accueil temporaire. A remplacer par
 * 'music-menu' + audio/menu-theme.mp3 des que le quota se recharge. */
var MENU_THEME_KEY = 'music-gameplay-4';
var ALL_MUSIC_KEYS = GAMEPLAY_TRACKS.concat(['music-game-over']);
var MUSIC_VOLUME = 0.3;
var MUSIC_CROSSFADE_MS = 3000;

/* Wrappers defensifs autour du SoundManager de Phaser - si une piste
 * n'est pas encore prete (decodage audio pas termine, cle absente du
 * cache, contexte verrouille...), une erreur ici ne doit jamais stopper
 * net le reste du create() de la scene (HUD/menu/jeu jamais affiches).
 * La musique est un bonus, jamais bloquant pour l'affichage du jeu. */
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
 * ThreeBoard - le plateau et les pieces en VRAI 3D live (Three.js),
 * pas du Canvas 2D/Graphics Phaser approxime. Rendu sur un canvas
 * separe (#three-canvas) superpose au canvas Phaser (qui ne garde que
 * le sol decoratif + le HUD) - voir index.html pour l'empilement des
 * deux canvas. Camera en perspective legerement au-dessus/derriere,
 * regardant vers le fond de la grille COLSxROWS.
 * ============================================================ */
/* Aretes d'un cube unite : X = largeur (demi-etendue), Z = profondeur
 * (demi-etendue, volontairement plus etroite que X pour ne pas paraitre
 * allonge vers l'arriere en perspective), Y = hauteur totale (0..CUBE_H,
 * pile posee sur le sol a Y=0 - pas de fentes en dessous). Les 3 valeurs
 * sont proches pour un vrai cube plutot qu'un pave plat. */
/* H reduit d'environ 18% sous la largeur d'une case de la grille (qui
 * fait 1 unite, cf gridToWorld) - un H = 1.0 pile donnait des pave
 * verticaux un peu hauts par rapport aux cases au sol. */
var CUBE_HX = 0.42, CUBE_HZ = 0.34, CUBE_H = 0.82;
/* Petit recul en Z applique a toutes les pieces pour que la rangee la
 * plus proche de la camera ne deborde plus de la derniere ligne blanche
 * du plateau (l'avant du cube se rapprochait trop de la ligne). */
var CUBE_Z_NUDGE = -0.05;
var CUBE_CORNERS = (function () {
  var arr = [];
  for (var i = 0; i < 8; i++) {
    arr.push(new THREE.Vector3(
      (i & 1) ? CUBE_HX : -CUBE_HX,
      (i & 2) ? CUBE_H : 0,
      (i & 4) ? CUBE_HZ : -CUBE_HZ
    ));
  }
  return arr;
})();
var EDGE_PAIRS = [
  [0, 1], [2, 3], [4, 5], [6, 7],
  [0, 2], [1, 3], [4, 6], [5, 7],
  [0, 4], [1, 5], [2, 6], [3, 7]
];
/* Cadre NEXT dans le HUD - memes coordonnees logiques (espace 720x960)
 * que le rectangle dessine par MainScene.create ; sert a decouper la
 * sous-region ecran (scissor) ou l'on rend la mini-scene 3D dediee a la
 * piece suivante (voir syncNext/animate) - vrai fil de fer Three.js,
 * pas une icone 2D approximee. */
var NEXT_BOX = { x: 24, y: 160, w: 90, h: 70 };

var ThreeBoard = (function () {
  var renderer, scene, camera;
  var nextScene, nextCamera, nextGroup;
  var boardGroup, lockedGroup, pieceGroup, ghostGroup, fallingGroup, holesGroup;
  var holeOutlineGeo, holeFillGeo;
  var edgeGeoThin, edgeGeoGlow, jointGeoThin, jointGeoGlow, faceGeo;
  var ready = false;
  var active = false;

  function gridToWorld(row, col) {
    return { x: col - COLS / 2, z: row };
  }

  /* Aretes en vrais TUBES epais (cylindres), pas des THREE.Line - le
   * "linewidth" de LineBasicMaterial est ignore par la plupart des
   * navigateurs en WebGL, un cylindre est la seule facon fiable d'avoir
   * une vraie epaisseur. Double passe (halo large additif + coeur fin
   * opaque) pour simuler un glow neon sans post-processing. */
  function buildCubeGroup(color, opacity) {
    var a = opacity === undefined ? 1 : opacity;
    var group = new THREE.Group();
    var mainMat = new THREE.MeshBasicMaterial({ color: color, transparent: a < 1, opacity: a });
    var glowMat = new THREE.MeshBasicMaterial({
      color: color, transparent: true, opacity: a * 0.4,
      blending: THREE.AdditiveBlending, depthWrite: false
    });

    /* Fond SOMBRE (pas colore comme le cube) tres legerement opaque sur
     * les faces : occupe le depth-buffer (depthWrite:true) pour masquer
     * partiellement les aretes d'un cube plus lointain qui, sinon, se
     * melangeaient dans les interstices entre les 12 aretes et
     * donnaient une "cage en fer" confuse quand plusieurs cubes se
     * touchent/se superposent. */
    var faceMat = new THREE.MeshBasicMaterial({
      color: 0x0a0a14, transparent: true, opacity: a * 0.4, depthWrite: true
    });
    var faceMesh = new THREE.Mesh(faceGeo, faceMat);
    faceMesh.position.set(0, CUBE_H / 2, 0);
    group.add(faceMesh);

    function addEdges(geo, mat) {
      EDGE_PAIRS.forEach(function (pair) {
        var pA = CUBE_CORNERS[pair[0]], pB = CUBE_CORNERS[pair[1]];
        var mesh = new THREE.Mesh(geo, mat);
        var mid = new THREE.Vector3().addVectors(pA, pB).multiplyScalar(0.5);
        mesh.position.copy(mid);
        mesh.scale.y = pA.distanceTo(pB);
        mesh.quaternion.setFromUnitVectors(
          new THREE.Vector3(0, 1, 0),
          new THREE.Vector3().subVectors(pB, pA).normalize()
        );
        group.add(mesh);
      });
    }
    function addJoints(geo, mat) {
      CUBE_CORNERS.forEach(function (p) {
        var mesh = new THREE.Mesh(geo, mat);
        mesh.position.copy(p);
        group.add(mesh);
      });
    }

    addEdges(edgeGeoGlow, glowMat);
    addJoints(jointGeoGlow, glowMat);
    addEdges(edgeGeoThin, mainMat);
    addJoints(jointGeoThin, mainMat);
    return group;
  }

  function placeCubeAt(group, x, y, z, color, opacity) {
    var cube = buildCubeGroup(color, opacity);
    cube.position.set(x, y, z);
    group.add(cube);
    return cube;
  }

  function addCubeAt(group, row, col, color, opacity) {
    var pos = gridToWorld(row, col);
    placeCubeAt(group, pos.x + 0.5, 0, pos.z + 0.5 + CUBE_Z_NUDGE, color, opacity);
  }

  /* Sol OPAQUE (pas juste des lignes) - sinon le fond du canvas Phaser
   * brille a travers le bas des cubes. */
  function buildFloorPlane() {
    var geo = new THREE.PlaneGeometry(COLS, ROWS);
    var mat = new THREE.MeshBasicMaterial({ color: 0x0a0c16, side: THREE.DoubleSide });
    var mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(0, -0.01, ROWS / 2);
    return mesh;
  }

  function buildFloorGrid() {
    var g = new THREE.Group();
    var mat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
    var r, c, pts, geo;
    for (r = 0; r <= ROWS; r++) {
      pts = [new THREE.Vector3(-COLS / 2, 0, r), new THREE.Vector3(COLS / 2, 0, r)];
      geo = new THREE.BufferGeometry().setFromPoints(pts);
      g.add(new THREE.Line(geo, mat));
    }
    for (c = 0; c <= COLS; c++) {
      pts = [new THREE.Vector3(c - COLS / 2, 0, 0), new THREE.Vector3(c - COLS / 2, 0, ROWS)];
      geo = new THREE.BufferGeometry().setFromPoints(pts);
      g.add(new THREE.Line(geo, mat));
    }
    return g;
  }

  function lerpHex(c1, c2, t) {
    var r1 = (c1 >> 16) & 255, g1 = (c1 >> 8) & 255, b1 = c1 & 255;
    var r2 = (c2 >> 16) & 255, g2 = (c2 >> 8) & 255, b2 = c2 & 255;
    var r = Math.round(r1 + (r2 - r1) * t), g = Math.round(g1 + (g2 - g1) * t), b = Math.round(b1 + (b2 - b1) * t);
    return (r << 16) | (g << 8) | b;
  }

  /* Environnement synthwave : UNE grande grille violette/magenta au sol,
   * dans le MEME plan Y=0 et la MEME camera/projection que le plateau -
   * pas un decor 2D plaque derriere. Le plateau blanc (COLSxROWS) est
   * une zone au centre de ce grand sol : on evide donc son emprise
   * exacte. IMPORTANT : rien ne doit exister a Z < 0 (au-dela du bord
   * lointain du plateau, qui EST la ligne d'horizon) - un point plus
   * loin que ce bord se projetterait forcement plus haut a l'ecran, donc
   * par-dessus le HUD. La grille reste donc entre Z=0 (horizon) et
   * l'avant (borne a ce que le champ de vision peut montrer), et fond
   * vers le noir/transparent a mesure qu'elle approche Z=0 pour une
   * transition douce avec le ciel etoile pur au-dessus. */
  function buildOuterFloorGrid() {
    var g = new THREE.Group();
    var bHalfW = COLS / 2;
    var zMax = ROWS + 3;
    var halfW = 20;
    /* Cellules plus petites que celles du plateau (qui restent a 1 unite)
     * pour la grille d'environnement - demande explicite ("les carres
     * trop gros"). */
    var step = 0.5;
    var nearColor = 0xff2ad0, farColor = 0x6a2aff;

    function fadeAt(z) {
      return Math.max(0, Math.min(1, z / zMax));
    }
    function addSeg(x1, z1, x2, z2, zForFade, baseOpacity) {
      var f = fadeAt(zForFade);
      if (f <= 0.02) { return; } // fondu total dans le noir pres de l'horizon, rien a tracer
      var pts = [new THREE.Vector3(x1, 0, z1), new THREE.Vector3(x2, 0, z2)];
      var geo = new THREE.BufferGeometry().setFromPoints(pts);
      var mat = new THREE.LineBasicMaterial({
        color: lerpHex(farColor, nearColor, f), transparent: true, opacity: baseOpacity * f
      });
      g.add(new THREE.Line(geo, mat));
    }

    var z, x;
    /* Lignes "horizontales" (Z constant, span en X), une par palier -
     * evidees sur la largeur du plateau tant que z <= ROWS. */
    for (z = 0; z <= zMax + 0.0001; z += step) {
      if (z <= ROWS) {
        addSeg(-halfW, z, -bHalfW, z, z, 0.75);
        addSeg(bHalfW, z, halfW, z, z, 0.75);
      } else {
        addSeg(-halfW, z, halfW, z, z, 0.75);
      }
    }
    /* Lignes "verticales" (X constant) construites PAR SEGMENT (pas une
     * seule longue ligne) pour un fondu progressif le long de la ligne,
     * de l'horizon (invisible) jusqu'a l'avant. Sur la largeur du
     * plateau, la ligne ne commence qu'apres son bord avant (z >= ROWS)
     * - jamais derriere/dedans. */
    for (x = -halfW; x <= halfW + 0.0001; x += step) {
      var zFrom = (x >= -bHalfW && x <= bHalfW) ? ROWS : 0;
      for (z = zFrom; z < zMax; z += step) {
        addSeg(x, z, x, z + step, z + step / 2, 0.6);
      }
    }
    return g;
  }

  function resize() {
    if (!ready) { return; }
    var canvas = renderer.domElement;
    var w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) { return; }
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  /* Rendu de la mini-scene NEXT dans une sous-region (scissor+viewport)
   * du MEME canvas/renderer - vrai fil de fer 3D Three.js recadre dans
   * le cadre HUD, pas une icone 2D. Les coordonnees logiques du cadre
   * (espace Phaser 720x960) sont converties en pixels reels du canvas,
   * car le canvas Three.js n'a pas forcement la meme resolution interne
   * que l'espace logique du jeu (il suit sa propre taille CSS). */
  function renderNextViewport() {
    var w = renderer.domElement.width, h = renderer.domElement.height;
    if (!w || !h) { return; }
    var sx = (NEXT_BOX.x / GAME_WIDTH) * w;
    var sw = (NEXT_BOX.w / GAME_WIDTH) * w;
    var sh = (NEXT_BOX.h / GAME_HEIGHT) * h;
    var sTop = (NEXT_BOX.y / GAME_HEIGHT) * h;
    var sy = h - sTop - sh; // origine bas-gauche pour scissor/viewport WebGL
    var aspect = sw / sh;
    if (nextCamera.aspect !== aspect) {
      nextCamera.aspect = aspect;
      nextCamera.updateProjectionMatrix();
    }
    renderer.setScissorTest(true);
    renderer.setScissor(sx, sy, sw, sh);
    renderer.setViewport(sx, sy, sw, sh);
    renderer.render(nextScene, nextCamera);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, w, h);
  }

  function animate() {
    requestAnimationFrame(animate);
    if (!ready) { return; }
    renderer.render(scene, camera);
    renderNextViewport();
  }

  function init() {
    if (ready) { resize(); return; }
    var canvas = document.getElementById('three-canvas');
    renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: true });
    renderer.setClearColor(0x000000, 0);

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
    camera.position.set(0, 8.96, 18.5);
    camera.lookAt(0, 0, ROWS * 0.5);

    /* Sol + grille dans un groupe dedie (boardGroup) pour pouvoir les
     * masquer d'un coup : le canvas Three.js est un calque UNIQUE et
     * persistant au-dessus de TOUT le Phaser (menu, jeu, game over) -
     * sans ca, le plateau restait visible et masquait le texte de
     * GameOverScene une fois la partie terminee. */
    boardGroup = new THREE.Group();
    boardGroup.add(buildFloorPlane());
    boardGroup.add(buildFloorGrid());
    boardGroup.add(buildOuterFloorGrid());
    scene.add(boardGroup);
    lockedGroup = new THREE.Group(); scene.add(lockedGroup);
    pieceGroup = new THREE.Group(); scene.add(pieceGroup);
    ghostGroup = new THREE.Group(); scene.add(ghostGroup);
    fallingGroup = new THREE.Group(); scene.add(fallingGroup);
    holesGroup = new THREE.Group(); scene.add(holesGroup);

    /* Mini-scene dediee au cadre NEXT du HUD - meme angle de vue que le
     * plateau principal pour rester coherent, cadree pour contenir la
     * plus large piece (I, 4 colonnes) avec un peu de marge. */
    nextScene = new THREE.Scene();
    nextCamera = new THREE.PerspectiveCamera(34, NEXT_BOX.w / NEXT_BOX.h, 0.1, 20);
    nextCamera.position.set(0, 3.6, 5.4);
    nextCamera.lookAt(0, 0, 0);
    nextGroup = new THREE.Group();
    nextScene.add(nextGroup);

    /* Coeur fin/net + halo large/additif (glow) - deux jeux de geometrie
     * de meme forme (cylindre/sphere) mais de rayon different. */
    edgeGeoThin = new THREE.CylinderGeometry(0.018, 0.018, 1, 6, 1, true);
    edgeGeoGlow = new THREE.CylinderGeometry(0.05, 0.05, 1, 8, 1, true);
    jointGeoThin = new THREE.SphereGeometry(0.02, 8, 8);
    jointGeoGlow = new THREE.SphereGeometry(0.055, 8, 8);
    faceGeo = new THREE.BoxGeometry(CUBE_HX * 2, CUBE_H, CUBE_HZ * 2);
    /* Marqueur de "trou" (case vide couverte par un bloc au-dessus, cf.
     * syncBoard/findHoles) - simple carre plat au sol (contour + remplissage
     * tres sombre), pour bien distinguer visuellement "case vide sous
     * surplomb" d'un vrai bug/cube manquant. Legerement plus petit qu'une
     * case (0.4 de demi-cote, case = 0.5) pour laisser les lignes de la
     * grille visibles autour. */
    var hs = 0.4;
    holeOutlineGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-hs, 0, -hs), new THREE.Vector3(hs, 0, -hs),
      new THREE.Vector3(hs, 0, hs), new THREE.Vector3(-hs, 0, hs),
      new THREE.Vector3(-hs, 0, -hs)
    ]);
    holeFillGeo = new THREE.PlaneGeometry(hs * 2, hs * 2);

    ready = true;
    resize();
    window.addEventListener('resize', resize);
    animate();
  }

  function syncBoard(board) {
    if (!ready || !active) { return; }
    lockedGroup.clear();
    holesGroup.clear();
    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++) {
        var cell = board[r][c];
        if (!cell) { continue; }
        addCubeAt(lockedGroup, r, c, cell.color, 1);
      }
    }
    /* Marque les "trous" (case vide sous un surplomb, cf. commentaire sur
     * holeOutlineGeo) - sans ca, le style filaire (aucune ombre, aucun
     * indice de profondeur) rendait impossible de distinguer "case
     * vraiment vide sous un bloc qui deborde" d'un bug visuel (retour
     * utilisateur, confirme sur un clip : un surplomb Tetris normal —
     * une piece qui deborde d'un terrain irregulier a la pose, comme
     * n'importe quel Tetris — donnait l'impression d'un cube "qui ne
     * tombe pas"). Un trou = case vide avec au moins un bloc au-dessus
     * (rangee plus petite) dans la meme colonne. */
    for (var c2 = 0; c2 < COLS; c2++) {
      var seenBlockAbove = false;
      for (var r2 = 0; r2 < ROWS; r2++) {
        if (board[r2][c2]) { seenBlockAbove = true; continue; }
        if (seenBlockAbove) { addHoleMarkerAt(r2, c2); }
      }
    }
  }

  function addHoleMarkerAt(row, col) {
    var pos = gridToWorld(row, col);
    var cx = pos.x + 0.5, cz = pos.z + 0.5 + CUBE_Z_NUDGE;
    var fill = new THREE.Mesh(holeFillGeo, new THREE.MeshBasicMaterial({
      color: 0xff6a3d, transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false
    }));
    fill.rotation.x = -Math.PI / 2;
    fill.position.set(cx, 0.015, cz);
    holesGroup.add(fill);

    var outline = new THREE.LineLoop(holeOutlineGeo, new THREE.LineBasicMaterial({
      color: 0xff6a3d, transparent: true, opacity: 0.5
    }));
    outline.position.set(cx, 0.02, cz);
    holesGroup.add(outline);
  }

  function easeInCubic(t) { return t * t * t; }
  /* Rebond elastique classique (depasse 1 puis revient) - utilise pour le
   * ressaut a l'atterrissage, pas pour la chute elle-meme. */
  function easeOutBack(t) {
    var c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  }

  /* Anime la chute des blocs restants apres une ligne effacee (gravite
   * par colonne, voir MainScene.dropColumnsToFillGaps/computeFallMoves) -
   * demande explicite de l'utilisateur : la retombee etait instantanee et
   * peu marquee visuellement ("plus lent et marque visuellement"). Deux
   * temps : (1) chute en acceleration (ease-in, comme une vraie gravite -
   * lent au depart, rapide a l'arrivee, PAS l'inverse) avec un etirement
   * progressif dans le sens du mouvement (squash&stretch, plus le cube va
   * vite plus il s'aplatit/s'allonge) ; (2) ecrasement a l'impact suivi
   * d'un ressaut elastique qui depasse legerement la taille normale avant
   * de se stabiliser - classique "squash & stretch" d'animation pour
   * rendre l'atterrissage satisfaisant plutot que sec. Utilise SA PROPRE
   * boucle requestAnimationFrame (independante de Phaser, meme pattern
   * que animate() ci-dessus) - tourne donc sans souci meme quand la
   * logique de jeu Phaser est ralentie/throttled. `moves` = liste de
   * {col, fromRow, toRow, color} (voir computeFallMoves cote MainScene) -
   * pendant l'anim, ces cellules sont dessinees UNIQUEMENT dans
   * fallingGroup (jamais dans lockedGroup, pour ne pas les voir en double
   * a la fois a l'ancienne ET la nouvelle position). */
  function animateFall(moves, durationMs, onComplete) {
    if (!ready || !active || !moves || moves.length === 0) {
      if (onComplete) { onComplete(); }
      return;
    }
    fallingGroup.clear();
    var items = moves.map(function (m) {
      var fromPos = gridToWorld(m.fromRow, m.col);
      var toPos = gridToWorld(m.toRow, m.col);
      var fromZ = fromPos.z + 0.5 + CUBE_Z_NUDGE;
      var toZ = toPos.z + 0.5 + CUBE_Z_NUDGE;
      var cube = placeCubeAt(fallingGroup, fromPos.x + 0.5, 0, fromZ, m.color, 1);
      return { cube: cube, fromZ: fromZ, toZ: toZ };
    });

    function applySquash(cube, sy) {
      var sxz = 1 + (1 - sy) * 0.35; // s'elargit legerement quand il s'aplatit (volume percu constant)
      cube.scale.set(sxz, sy, sxz);
    }

    var FALL_FRACTION = 0.6; // part de durationMs passee a vraiment tomber, le reste = ressaut a l'atterrissage
    var fallMs = durationMs * FALL_FRACTION;
    var bounceMs = durationMs - fallMs;
    var start = null;

    function step(now) {
      if (start === null) { start = now; }
      var elapsed = now - start;
      if (elapsed <= fallMs) {
        var t = elapsed / fallMs;
        var eased = easeInCubic(t);
        items.forEach(function (it) {
          it.cube.position.z = it.fromZ + (it.toZ - it.fromZ) * eased;
          applySquash(it.cube, 1 - t * 0.18);
        });
        requestAnimationFrame(step);
      } else if (elapsed <= durationMs) {
        var u = (elapsed - fallMs) / bounceMs;
        var sy = u < 0.3
          ? 0.82 - (u / 0.3) * 0.27               // continue de s'ecraser a l'impact : 0.82 -> 0.55
          : 0.55 + 0.45 * easeOutBack((u - 0.3) / 0.7); // ressaut elastique jusqu'a 1 (avec leger depassement)
        items.forEach(function (it) {
          it.cube.position.z = it.toZ;
          applySquash(it.cube, sy);
        });
        requestAnimationFrame(step);
      } else {
        items.forEach(function (it) { it.cube.scale.set(1, 1, 1); it.cube.position.z = it.toZ; });
        fallingGroup.clear();
        if (onComplete) { onComplete(); }
      }
    }
    requestAnimationFrame(step);
  }

  function syncPiece(cells, ghostCells, color) {
    if (!ready || !active) { return; }
    pieceGroup.clear();
    ghostGroup.clear();
    if (ghostCells) {
      ghostCells.forEach(function (c) { addCubeAt(ghostGroup, c.row, c.col, color, 0.25); });
    }
    if (cells) {
      cells.forEach(function (c) { addCubeAt(pieceGroup, c.row, c.col, color, 1); });
    }
  }

  function clear() {
    if (!ready) { return; }
    /* "active" coupe court a TOUT appel syncBoard/syncPiece/syncNext
     * ulterieur (meme un appel errant/en retard, ex. un delayedCall de
     * clignotement de ligne qui se termine apres coup) - le canvas
     * Three.js est un calque UNIQUE partage par toutes les scenes
     * Phaser, donc sans ce verrou un appel tardif peut repeupler le
     * plateau alors que GameOverScene/MenuScene est deja affichee. */
    active = false;
    lockedGroup.clear();
    pieceGroup.clear();
    ghostGroup.clear();
    fallingGroup.clear();
    holesGroup.clear();
    nextGroup.clear();
    boardGroup.visible = false;
  }

  /* Reaffiche le sol/la grille et reautorise syncBoard/syncPiece/syncNext
   * (coupes par clear()) - a appeler a chaque debut de partie. */
  function show() {
    if (!ready) { return; }
    active = true;
    boardGroup.visible = true;
  }

  /* Piece suivante en vrai fil de fer 3D, centree dans son cadre (voir
   * NEXT_BOX/renderNextViewport) - shape = PIECE_SHAPES[type][0]. */
  function syncNext(type, color) {
    if (!ready || !active) { return; }
    nextGroup.clear();
    if (!type) { return; }
    var shape = PIECE_SHAPES[type][0];
    var minC = Math.min.apply(null, shape.map(function (rc) { return rc[1]; }));
    var maxC = Math.max.apply(null, shape.map(function (rc) { return rc[1]; }));
    var minR = Math.min.apply(null, shape.map(function (rc) { return rc[0]; }));
    var maxR = Math.max.apply(null, shape.map(function (rc) { return rc[0]; }));
    var cx = (minC + maxC) / 2, cyR = (minR + maxR) / 2;
    shape.forEach(function (rc) {
      placeCubeAt(nextGroup, rc[1] - cx, cyR - rc[0], 0, color, 1);
    });
  }

  return {
    init: init, syncBoard: syncBoard, syncPiece: syncPiece, syncNext: syncNext,
    resize: resize, clear: clear, show: show, animateFall: animateFall
  };
})();

/* Couleurs standard par type de piece (convention Tetris Guideline). */
var PIECE_TYPES = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];
var PIECE_COLORS = {
  I: 0x00f0ff,
  O: 0xfff200,
  T: 0xc300ff,
  S: 0x00ff66,
  Z: 0xff1053,
  J: 0x2050ff,
  L: 0xff8c00
};

/* Formes SRS standard (4 etats de rotation, coordonnees [ligne,colonne]
 * dans une boite 4x4) - regles publiques du genre, pas de code tiers. */
var PIECE_SHAPES = {
  I: [
    [[1, 0], [1, 1], [1, 2], [1, 3]],
    [[0, 2], [1, 2], [2, 2], [3, 2]],
    [[2, 0], [2, 1], [2, 2], [2, 3]],
    [[0, 1], [1, 1], [2, 1], [3, 1]]
  ],
  O: [
    [[0, 1], [0, 2], [1, 1], [1, 2]],
    [[0, 1], [0, 2], [1, 1], [1, 2]],
    [[0, 1], [0, 2], [1, 1], [1, 2]],
    [[0, 1], [0, 2], [1, 1], [1, 2]]
  ],
  T: [
    [[0, 1], [1, 0], [1, 1], [1, 2]],
    [[0, 1], [1, 1], [1, 2], [2, 1]],
    [[1, 0], [1, 1], [1, 2], [2, 1]],
    [[0, 1], [1, 0], [1, 1], [2, 1]]
  ],
  S: [
    [[0, 1], [0, 2], [1, 0], [1, 1]],
    [[0, 1], [1, 1], [1, 2], [2, 2]],
    [[1, 1], [1, 2], [2, 0], [2, 1]],
    [[0, 0], [1, 0], [1, 1], [2, 1]]
  ],
  Z: [
    [[0, 0], [0, 1], [1, 1], [1, 2]],
    [[0, 2], [1, 1], [1, 2], [2, 1]],
    [[1, 0], [1, 1], [2, 1], [2, 2]],
    [[0, 1], [1, 0], [1, 1], [2, 0]]
  ],
  J: [
    [[0, 0], [1, 0], [1, 1], [1, 2]],
    [[0, 1], [0, 2], [1, 1], [2, 1]],
    [[1, 0], [1, 1], [1, 2], [2, 2]],
    [[0, 1], [1, 1], [2, 0], [2, 1]]
  ],
  L: [
    [[0, 2], [1, 0], [1, 1], [1, 2]],
    [[0, 1], [1, 1], [2, 1], [2, 2]],
    [[1, 0], [1, 1], [1, 2], [2, 0]],
    [[0, 0], [0, 1], [1, 1], [2, 1]]
  ]
};

/* Petits decalages essayes en cascade quand une rotation directe est
 * bloquee (wall-kick simplifie, pas la table SRS officielle complete -
 * suffisant pour un jeu d'arcade, pas competitif). */
var KICK_OFFSETS = [[0, 0], [-1, 0], [1, 0], [0, -1], [-1, -1], [1, -1], [0, 1], [-2, 0], [2, 0]];

var LINE_SCORES = [0, 100, 300, 500, 800];
/* Bonus simplifie (demande explicite : le systeme de capacites
 * speciales - bombe/purge/ligne, touche MAJ, cellule bonus a viser dans
 * la piece - "prenait la tete" et rendait le jeu difficile a comprendre).
 * Remplace par un mecanisme entierement automatique et passif : chaque
 * ligne effacee remplit POWER ; POWER plein => une pastille de bonus
 * s'allume (jusqu'a MAX_BONUS_PIPS) ; une fois les 3 pastilles allumees,
 * la PROCHAINE ligne effacee declenche un bonus de points (voir
 * runCascade) et les pastilles se reinitialisent. Aucune touche, aucun
 * choix du joueur, aucun effet qui modifie le plateau - juste une
 * recompense pour avoir enchaine des lignes. */
var POWER_PER_LINES = [0, 8, 16, 24, 36];
var POWER_MONO_BONUS = 15;
var POWER_MAX = 100;
var MAX_BONUS_PIPS = 3;
var BONUS_POINTS_PER_LEVEL = 500;
/* Delai de verrouillage genereux : quand la piece touche un appui mais
 * qu'il reste un espace etroit pour la glisser dedans, le joueur doit
 * avoir le temps d'ajuster (plusieurs petits deplacements/rotations)
 * avant que la position se verrouille - augmente ici suite a un retour
 * explicite ("pas le temps de la placer"). */
var LOCK_DELAY_MS = 800;
var LOCK_RESET_LIMIT = 40;
var LINES_PER_LEVEL = 10;

/* Dernier classement recu du serveur (via onScoresUpdated) - permet a
 * GameOverScene de savoir immediatement si un score entre dans le top 10
 * sans attendre un aller-retour reseau supplementaire. */
var latestScores = [];
/* Classement (regle commune a toutes les bornes FiveCade) : Top 25 par
 * borne (MAX_SCORES_PER_BORNE de fivecade_highscore), liste DEROULANTE de
 * SCORES_VISIBLE lignes ; un score qui ne bat pas le 25e n'entre pas. */
var LEADERBOARD_SIZE = 25;
var SCORES_VISIBLE = 10;

function fallDelayForLevel(level) {
  return Math.max(140, 800 - (level - 1) * 55);
}

/* ============================================================
 * Fond decoratif : starfield (voir drawStarfield pres de BootScene) EN
 * ARRIERE-PLAN - la grille violette synthwave n'est PAS dessinee ici en
 * 2D : elle est generee en vraie geometrie 3D dans le meme plan que le
 * plateau (voir buildOuterFloorGrid dans ThreeBoard, plus haut), pour
 * qu'elle s'etende en perspective coherente depuis le bord du plateau.
 * ============================================================ */

/* ============================================================
 * BootScene - genere la tuile starfield utilitaire (les cubes eux-memes
 * sont rendus en vrai 3D par ThreeBoard, voir plus haut), puis lance
 * MenuScene.
 * ============================================================ */
function BootScene() {
  Phaser.Scene.call(this, { key: 'BootScene' });
}
BootScene.prototype = Object.create(Phaser.Scene.prototype);
BootScene.prototype.constructor = BootScene;

BootScene.prototype.preload = function () {
  this.load.image('menu-face', 'menu-face.png');

  /* Musiques d'ambiance (generees via Suno, voir GAMEPLAY_TRACKS) - pas
   * de theme menu pour l'instant (telechargement bloque par le quota du
   * compte Suno, a ajouter plus tard : 'music-menu' + audio/menu-theme.mp3). */
  this.load.audio('music-gameplay', 'audio/gameplay-theme.mp3');
  this.load.audio('music-gameplay-2', 'audio/gameplay-theme-2.mp3');
  this.load.audio('music-gameplay-3', 'audio/gameplay-theme-3.mp3');
  this.load.audio('music-gameplay-4', 'audio/gameplay-theme-4.mp3');
  this.load.audio('music-gameplay-5', 'audio/gameplay-theme-5.mp3');
  this.load.audio('music-game-over', 'audio/game-over-jingle.mp3');
};

BootScene.prototype.create = function () {
  /* Tuile d'etoiles (points de tailles/eclats varies sur fond
   * transparent) repetee via un TileSprite et deroulee en continu dans
   * MainScene/GameOverScene.update - remplace la grille violette de
   * fond, demande explicite pour un simple fond sombre + starfield. */
  var starTile = this.make.graphics({ x: 0, y: 0, add: false });
  var STAR_TILE_SIZE = 320;
  for (var si = 0; si < 90; si++) {
    var sx = Math.random() * STAR_TILE_SIZE;
    var sy = Math.random() * STAR_TILE_SIZE;
    var sr = Math.random() * 1.3 + 0.3;
    var salpha = Math.random() * 0.6 + 0.3;
    starTile.fillStyle(0xffffff, salpha);
    starTile.fillCircle(sx, sy, sr);
  }
  starTile.generateTexture('starfield-tile', STAR_TILE_SIZE, STAR_TILE_SIZE);
  starTile.destroy();

  window.__fivecadeBootComplete = true;
  if (window.__fivecadeBorneOpenRequested) {
    this.scene.start('MenuScene');
  }
};

/* Fond sombre uni + starfield anime qui defile lentement vers le bas -
 * remplace la grille violette decorative (demande explicite : "vire
 * cette grille violette, met juste un fond sombre avec un starfield
 * anime qui defile"). Retourne le TileSprite pour que la scene fasse
 * defiler tilePositionY dans son update(). */
function drawStarfield(scene) {
  scene.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x03040a, 1).setDepth(-11);
  var field = scene.add.tileSprite(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 'starfield-tile');
  field.setDepth(-10);
  return field;
}

/* ============================================================
 * MenuScene
 * ============================================================ */
function MenuScene() {
  Phaser.Scene.call(this, { key: 'MenuScene' });
}
MenuScene.prototype = Object.create(Phaser.Scene.prototype);
MenuScene.prototype.constructor = MenuScene;

MenuScene.prototype.create = function () {
  /* Coupe d'abord tout ce qui pourrait trainer (retour depuis une partie/
   * game over) avant de lancer le theme d'accueil (voir MENU_THEME_KEY). */
  ALL_MUSIC_KEYS.forEach(function (key) { safeStopMusic(this, key); }, this);
  safePlayMusic(this, MENU_THEME_KEY, { loop: true, volume: MUSIC_VOLUME });

  /* Pas de grille de sol ici - demande explicite : la page d'accueil ne
   * garde que l'image fournie par l'utilisateur, rien d'autre en fond. */

  /* Visuel d'accueil fourni par l'utilisateur (mascotte QUB3D, deja son
   * propre wordmark stylise integre a l'image) - une seule composition
   * centree, pas de titre texte separe qui ferait doublon. */
  this.add.image(GAME_WIDTH / 2, 0, 'menu-face').setOrigin(0.5, 0).setScale(0.34);

  var items = ['NOUVELLE PARTIE', 'MEILLEURS SCORES', 'QUITTER'];
  var self = this;
  this.menuTexts = [];
  this.selectedIndex = 0;

  items.forEach(function (label, i) {
    var t = self.add.text(GAME_WIDTH / 2, 610 + i * 58, label, {
      fontFamily: 'Courier New', fontSize: '28px', fontStyle: 'bold', color: '#3ff2ff'
    }).setOrigin(0.5).setShadow(0, 0, '#00eaff', 14, true, true).setInteractive({ useHandCursor: true });
    t.on('pointerover', function () { self.setSelected(i); });
    t.on('pointerdown', function () { self.activateItem(i); });
    self.menuTexts.push(t);
  });
  this.setSelected(0);
  /* "NOUVELLE PARTIE" cycle en arc-en-ciel neon (demande explicite) -
   * throttle a 10x/s (voir update) pour une animation legere, pas un
   * recalcul de texture Phaser a chaque frame. */
  this.rainbowTimer = 0;

  this.add.text(GAME_WIDTH / 2, GAME_HEIGHT - 50, 'FLECHES + ENTREE pour naviguer', {
    fontFamily: 'Courier New', fontSize: '13px', color: '#7fa8c9'
  }).setOrigin(0.5);

  /* Panneau meilleurs scores (masque par defaut). */
  var panelBg = this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, 460, 520, 0x05070f, 0.97)
    .setStrokeStyle(2, 0x39e5ff).setVisible(false);
  var scoresTitle = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 230, 'MEILLEURS SCORES', {
    fontFamily: 'Courier New', fontSize: '24px', color: '#39e5ff'
  }).setOrigin(0.5).setVisible(false);
  var scoresText = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 190, 'Chargement...', {
    fontFamily: 'Courier New', fontSize: '17px', color: '#e8edf7', align: 'left', lineSpacing: 10
  }).setOrigin(0.5, 0).setVisible(false);
  var scoresHint = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 230, 'HAUT/BAS defiler  -  ECHAP ou ENTREE pour revenir', {
    fontFamily: 'Courier New', fontSize: '12px', color: '#7fa8c9'
  }).setOrigin(0.5).setVisible(false);
  this.scoresTrack = this.add.rectangle(GAME_WIDTH / 2 + 212, GAME_HEIGHT / 2 - 190, 5, SCORES_VISIBLE * 30, 0x14304a).setOrigin(0.5, 0).setVisible(false);
  this.scoresThumb = this.add.rectangle(GAME_WIDTH / 2 + 212, GAME_HEIGHT / 2 - 190, 5, 40, 0x39e5ff).setOrigin(0.5, 0).setVisible(false);
  this.scoresScroll = 0;

  this.panelBg = panelBg;
  this.scoresTitle = scoresTitle;
  this.scoresText = scoresText;
  this.scoresHint = scoresHint;
  this.scoresPanel = false;

  this.cursors = this.input.keyboard.createCursorKeys();
  this.enterKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER);
  this.escKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
  // Navigation sur les EVENEMENTS clavier : Keyboard.JustDown perd une
  // frappe tres breve (appui + relachement dans la meme image).
  this.input.keyboard.on('keydown', function (ev) { this.onMenuKey(ev.key); }, this);
  this.input.on('wheel', function (p, o, dx, dy) { if (this.scoresPanel) this.scrollScores(dy > 0 ? 3 : -3); }, this);

  if (window.FiveCadeBridge) {
    window.FiveCadeBridge.requestScores();
  }

  window.FiveCadeGame._registerMenuScene(this);
};

MenuScene.prototype.setSelected = function (i) {
  this.selectedIndex = i;
  this.menuTexts.forEach(function (t, idx) {
    /* L'item 0 ("NOUVELLE PARTIE") garde sa couleur arc-en-ciel animee
     * (voir update) - seule l'echelle marque la selection pour lui. */
    if (idx !== 0) { t.setColor(idx === i ? '#ffffff' : '#3ff2ff'); }
    t.setScale(idx === i ? 1.08 : 1.0);
  });
};

/* Degrade HSV -> hex, s et v fixes a 1 pour des teintes neon vives et
 * saturees (pas de blanc/gris delave dans le cycle). */
function hsvToHex(h) {
  var i = Math.floor(h * 6);
  var f = h * 6 - i;
  var q = 1 - f, t = f;
  var r, g, b;
  switch (i % 6) {
    case 0: r = 1; g = t; b = 0; break;
    case 1: r = q; g = 1; b = 0; break;
    case 2: r = 0; g = 1; b = t; break;
    case 3: r = 0; g = q; b = 1; break;
    case 4: r = t; g = 0; b = 1; break;
    default: r = 1; g = 0; b = q; break;
  }
  var hex = ((Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255));
  return '#' + hex.toString(16).padStart(6, '0');
}

MenuScene.prototype.activateItem = function (i) {
  if (this.scoresPanel) { return; }
  if (i === 0) {
    this.scene.start('MainScene');
  } else if (i === 1) {
    this.openScores();
  } else if (i === 2) {
    if (window.FiveCadeBridge) { window.FiveCadeBridge.quit(); }
  }
};

MenuScene.prototype.openScores = function () {
  this.scoresPanel = true;
  this.scoresScroll = 0;
  this.panelBg.setVisible(true);
  this.scoresTitle.setVisible(true);
  this.scoresText.setVisible(true);
  this.scoresHint.setVisible(true);
  this.menuTexts.forEach(function (t) { t.setVisible(false); });
  this.renderScores(latestScores);
};

MenuScene.prototype.closeScores = function () {
  this.scoresPanel = false;
  this.panelBg.setVisible(false);
  this.scoresTitle.setVisible(false);
  this.scoresText.setVisible(false);
  this.scoresHint.setVisible(false);
  this.scoresTrack.setVisible(false);
  this.scoresThumb.setVisible(false);
  this.menuTexts.forEach(function (t) { t.setVisible(true); });
};

MenuScene.prototype.scrollScores = function (delta) {
  var maxScroll = Math.max(0, latestScores.length - SCORES_VISIBLE);
  var next = Phaser.Math.Clamp(this.scoresScroll + delta, 0, maxScroll);
  if (next === this.scoresScroll) { return; }
  this.scoresScroll = next;
  this.renderScores(latestScores);
};

MenuScene.prototype.onMenuKey = function (key) {
  if (this.scoresPanel) {
    if (key === 'ArrowUp') { this.scrollScores(-1); }
    else if (key === 'ArrowDown') { this.scrollScores(1); }
    else if (key === 'PageUp') { this.scrollScores(-SCORES_VISIBLE); }
    else if (key === 'PageDown') { this.scrollScores(SCORES_VISIBLE); }
    else if (['Enter', ' ', 'Backspace', 'ArrowLeft', 'ArrowRight'].indexOf(key) >= 0) { this.closeScores(); }
    return;
  }
  if (key === 'ArrowUp') { this.setSelected((this.selectedIndex + 2) % 3); }
  else if (key === 'ArrowDown') { this.setSelected((this.selectedIndex + 1) % 3); }
  else if (key === 'Enter') { this.activateItem(this.selectedIndex); }
};

MenuScene.prototype.renderScores = function (scores) {
  var scrollable = !!scores && scores.length > SCORES_VISIBLE && this.scoresPanel;
  this.scoresTrack.setVisible(scrollable);
  this.scoresThumb.setVisible(scrollable);
  if (!scores || scores.length === 0) {
    this.scoresText.setText('Aucun score pour le moment.');
    return;
  }
  this.scoresScroll = Math.min(this.scoresScroll || 0, Math.max(0, scores.length - SCORES_VISIBLE));
  var from = this.scoresScroll;
  var lines = scores.slice(from, from + SCORES_VISIBLE).map(function (s, i) {
    var rank = (from + i + 1) + '.';
    return rank.padEnd(4, ' ') + String(s.name || '???').slice(0, 16).padEnd(17, ' ') + s.score;
  });
  this.scoresText.setText(lines.join('\n'));
  if (scrollable) {
    var trackH = SCORES_VISIBLE * 30;
    var thumbH = Math.max(24, trackH * SCORES_VISIBLE / scores.length);
    this.scoresThumb.height = thumbH;
    this.scoresThumb.y = this.scoresTrack.y + (trackH - thumbH) * (from / (scores.length - SCORES_VISIBLE));
  }
};

MenuScene.prototype.onScoresUpdated = function (scores) {
  latestScores = scores || [];
  if (this.scoresPanel) {
    this.renderScores(latestScores);
  }
};

MenuScene.prototype.update = function (time) {
  if (this.menuTexts && this.menuTexts[0] && time > this.rainbowTimer) {
    this.rainbowTimer = time + 100;
    var color = hsvToHex((time % 3000) / 3000);
    this.menuTexts[0].setColor(color);
    this.menuTexts[0].setShadow(0, 0, color, 14, true, true);
  }
  // (navigation : evenements clavier, voir onMenuKey)
};

/* ============================================================
 * MainScene - le jeu lui-meme.
 * ============================================================ */
function MainScene() {
  Phaser.Scene.call(this, { key: 'MainScene' });
}
MainScene.prototype = Object.create(Phaser.Scene.prototype);
MainScene.prototype.constructor = MainScene;

MainScene.prototype.create = function () {
  this.starfield = drawStarfield(this);

  this.board = [];
  for (var r = 0; r < ROWS; r++) {
    this.board.push(new Array(COLS).fill(null));
  }
  this.score = 0;
  this.level = 1;
  this.linesCleared = 0;
  this.power = 0;
  this.bonusPips = 0;
  this.bag = [];
  this.fallTimer = 0;
  this.fallDelay = fallDelayForLevel(1);
  this.lockTimer = null;
  this.lockResets = 0;
  this.gameOver = false;
  this.musicTimer = null;

  /* Rotation de musiques de partie (voir GAMEPLAY_TRACKS/startGameplayMusic) -
   * coupe d'abord tout ce qui pourrait trainer d'une session precedente. */
  ALL_MUSIC_KEYS.forEach(function (key) { safeStopMusic(this, key); }, this);
  safeStopMusic(this, 'music-game-over');
  this.startGameplayMusic();

  /* Plateau + cubes : rendu en vrai 3D live via Three.js (ThreeBoard),
   * pas en Graphics Phaser - voir le module ThreeBoard plus haut dans ce
   * fichier. Phaser garde uniquement le sol decoratif (violet, deja en
   * fond) et le HUD. */
  ThreeBoard.init();
  ThreeBoard.show();

  /* --- HUD gauche : POWER / BONUS / NEXT - directement sur le fond,
   * sans cadres/encadres (demande explicite) : barre POWER en capsule
   * fine, BONUS en 3 simples pastilles rondes, NEXT sans boite. Bonus
   * simplifie (voir MAX_BONUS_PIPS) : chaque ligne effacee remplit
   * POWER, POWER plein allume une pastille, 3 pastilles allumees =
   * la prochaine ligne donne un bonus de points (voir runCascade). --- */
  this.add.text(24, 16, 'POWER', { fontFamily: 'Courier New', fontSize: '13px', color: '#ffffff' });
  var POWER_BAR_X = 24, POWER_BAR_Y = 34, POWER_BAR_W = 96, POWER_BAR_H = 10;
  this.add.graphics()
    .fillStyle(0xffffff, 0.18)
    .fillRoundedRect(POWER_BAR_X, POWER_BAR_Y, POWER_BAR_W, POWER_BAR_H, POWER_BAR_H / 2);
  this.powerFillGraphics = this.add.graphics();
  this.powerBar = { x: POWER_BAR_X, y: POWER_BAR_Y, w: POWER_BAR_W, h: POWER_BAR_H };

  this.add.text(24, 60, 'BONUS', { fontFamily: 'Courier New', fontSize: '13px', color: '#ffffff' });
  this.bonusPipShapes = [];
  for (var s = 0; s < MAX_BONUS_PIPS; s++) {
    var pip = this.add.circle(24 + 9 + s * 26, 80 + 8, 8, 0xffe14d, 1).setAlpha(0.25);
    this.bonusPipShapes.push(pip);
  }

  this.add.text(24, 140, 'NEXT', { fontFamily: 'Courier New', fontSize: '13px', color: '#ffffff' });
  /* Pas de boite/fond ici : la piece est rendue en vrai fil de fer 3D
   * par ThreeBoard (mini-scene Three.js decoupee via scissor sur cette
   * meme zone, voir NEXT_BOX/renderNextViewport), a fond transparent -
   * elle apparait directement sur le starfield/la grille, comme le
   * reste du HUD. */

  /* --- HUD droite : SCORE / HI-SCORE / LEVEL --- */
  this.add.text(GAME_WIDTH - 24, 14, 'SCORE', {
    fontFamily: 'Courier New', fontSize: '13px', color: '#ffffff', align: 'right'
  }).setOrigin(1, 0);
  this.scoreText = this.add.text(GAME_WIDTH - 24, 30, '000000', {
    fontFamily: 'Courier New', fontSize: '20px', fontStyle: 'bold', color: '#ffffff', align: 'right'
  }).setOrigin(1, 0);

  this.add.text(GAME_WIDTH - 24, 62, 'HI-SCORE', {
    fontFamily: 'Courier New', fontSize: '13px', color: '#ffffff', align: 'right'
  }).setOrigin(1, 0);
  var hiScoreVal = (latestScores && latestScores[0]) ? latestScores[0].score : 0;
  this.hiScore = hiScoreVal;
  this.hiScoreText = this.add.text(GAME_WIDTH - 24, 78, String(hiScoreVal).padStart(6, '0'), {
    fontFamily: 'Courier New', fontSize: '20px', fontStyle: 'bold', color: '#ffffff', align: 'right'
  }).setOrigin(1, 0);

  this.add.text(GAME_WIDTH - 24, 110, 'LEVEL', {
    fontFamily: 'Courier New', fontSize: '13px', color: '#ffffff', align: 'right'
  }).setOrigin(1, 0);
  this.levelText = this.add.text(GAME_WIDTH - 24, 126, '01', {
    fontFamily: 'Courier New', fontSize: '20px', fontStyle: 'bold', color: '#ffffff', align: 'right'
  }).setOrigin(1, 0);

  /* Texte "COMBO xN" - affiche brievement au-dessus du plateau quand une
   * chute par colonne fait apparaitre une nouvelle ligne complete en
   * cascade (voir runCascade). Vide/invisible tant qu'aucune chaine n'est
   * en cours. */
  this.comboText = this.add.text(GAME_WIDTH / 2, 250, '', {
    fontFamily: 'Courier New', fontSize: '26px', fontStyle: 'bold', color: '#ffe14d'
  }).setOrigin(0.5).setShadow(0, 0, '#ff8c00', 12, true, true).setAlpha(0).setDepth(15);

  /* Texte "BONUS !" - affiche brievement quand les 3 pastilles etaient
   * pleines et qu'une ligne vient de consommer le bonus (voir
   * MAX_BONUS_PIPS/showBonusText). */
  this.bonusText = this.add.text(GAME_WIDTH / 2, 300, 'BONUS !', {
    fontFamily: 'Courier New', fontSize: '30px', fontStyle: 'bold', color: '#ffe14d'
  }).setOrigin(0.5).setShadow(0, 0, '#ff8c00', 14, true, true).setAlpha(0).setDepth(15);

  this.add.text(GAME_WIDTH / 2, GAME_HEIGHT - 30,
    'GAUCHE/DROITE deplacer - BAS descendre - ESPACE tourner', {
      fontFamily: 'Courier New', fontSize: '11px', color: '#7fa8c9'
    }).setOrigin(0.5);

  this.cursors = this.input.keyboard.createCursorKeys();
  this.spaceKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
  this.moveRepeatTimer = 0;
  this.dropRepeatTimer = 0;

  this.spawnBag();
  this.nextType = this.bag.shift();
  this.spawnPiece();
  this.renderNext();

  window.FiveCadeGame._registerMainScene(this);
};

MainScene.prototype.spawnBag = function () {
  var bag = PIECE_TYPES.slice();
  for (var i = bag.length - 1; i > 0; i--) {
    var j = Phaser.Math.Between(0, i);
    var tmp = bag[i]; bag[i] = bag[j]; bag[j] = tmp;
  }
  this.bag = this.bag.concat(bag);
};

MainScene.prototype.spawnPiece = function () {
  if (this.bag.length < 1) { this.spawnBag(); }
  var type = this.nextType;
  this.nextType = this.bag.shift();
  this.renderNext();

  /* Colonne de spawn = 1, pas 3 : les formes sont definies dans une grille
   * locale large de 4 colonnes (offsets 0-3 pour I) et le plateau ne fait
   * que COLS=6 de large - a col:3, I (offsets 0-3) deborde en colonne 6
   * (hors plateau) et declenche un game over instantane des l'apparition
   * (bug reel, ~1 partie sur 7 selon le sac melange). col:1 centre
   * correctement toutes les pieces (max offset 3 pour I -> colonnes 1-4,
   * toujours dans 0-5). */
  this.piece = {
    type: type,
    rot: 0,
    row: -1,
    col: 1
  };

  if (this.checkCollision(this.piece, 0, 0, 0)) {
    this.endGame();
    return;
  }
  this.lockTimer = null;
  this.lockResets = 0;
  this.redrawPiece();
};

MainScene.prototype.cellsFor = function (piece, rot, row, col) {
  var shape = PIECE_SHAPES[piece.type][((rot % 4) + 4) % 4];
  return shape.map(function (rc) {
    return { row: row + rc[0], col: col + rc[1] };
  });
};

MainScene.prototype.checkCollision = function (piece, dRow, dCol, dRot) {
  var rot = ((piece.rot + dRot) % 4 + 4) % 4;
  var cells = this.cellsFor(piece, rot, piece.row + dRow, piece.col + dCol);
  for (var i = 0; i < cells.length; i++) {
    var c = cells[i];
    if (c.col < 0 || c.col >= COLS || c.row >= ROWS) { return true; }
    if (c.row >= 0 && this.board[c.row][c.col]) { return true; }
  }
  return false;
};

MainScene.prototype.tryMove = function (dCol) {
  if (!this.piece || this.gameOver) { return; }
  if (!this.checkCollision(this.piece, 0, dCol, 0)) {
    this.piece.col += dCol;
    this.onPieceMoved();
  }
};

MainScene.prototype.tryRotate = function () {
  if (!this.piece || this.gameOver) { return; }
  var p = this.piece;
  for (var i = 0; i < KICK_OFFSETS.length; i++) {
    var off = KICK_OFFSETS[i];
    if (!this.checkCollision(p, off[1], off[0], 1)) {
      p.rot = (p.rot + 1) % 4;
      p.row += off[1];
      p.col += off[0];
      this.onPieceMoved();
      return;
    }
  }
};

MainScene.prototype.onPieceMoved = function () {
  this.redrawPiece();
  if (this.checkCollision(this.piece, 1, 0, 0)) {
    if (this.lockResets < LOCK_RESET_LIMIT) {
      this.lockTimer = this.time.now + LOCK_DELAY_MS;
      this.lockResets++;
    }
  } else {
    this.lockTimer = null;
  }
};

/* Descend la piece d'UNE case (pas de chute instantanee) - appele a
 * chaque pression/repetition de BAS, comme tryMove pour GAUCHE/DROITE. */
MainScene.prototype.tryDrop = function () {
  if (!this.piece || this.gameOver) { return; }
  if (!this.checkCollision(this.piece, 1, 0, 0)) {
    this.piece.row += 1;
    this.score += 1;
    this.redrawPiece();
    this.lockTimer = null;
  }
};

MainScene.prototype.lockPiece = function () {
  var p = this.piece;
  var cells = this.cellsFor(p, p.rot, p.row, p.col);
  var color = PIECE_COLORS[p.type];
  var minRow = 0;
  for (var i = 0; i < cells.length; i++) {
    var c = cells[i];
    if (c.row < minRow) { minRow = c.row; }
    if (c.row < 0) { continue; }
    this.board[c.row][c.col] = { color: color };
  }
  this.piece = null;
  this.redrawBoard();

  /* Nombre de lignes qu'il faudrait effacer pour que la piece tienne
   * entierement dans le plateau visible (0 si elle y tenait deja). Si
   * la piece deborde par le haut, on verifie/credite quand meme une
   * eventuelle ligne (ou chaine de lignes, voir runCascade) qu'elle
   * vient de completer - le Game Over n'est declenche qu'APRES, et
   * seulement si le debord n'est pas entierement resorbe par le total
   * de lignes effacees (toutes vagues de la chaine confondues). */
  var linesNeededToFit = -minRow;
  var self = this;
  this.runCascade(function (totalLinesCleared) {
    if (totalLinesCleared < linesNeededToFit) {
      self.endGame();
    } else if (!self.gameOver) {
      self.spawnPiece();
    }
  });
};

/* Fait tomber chaque COLONNE independamment pour combler les trous
 * laisses par des cellules retirees (contrairement a une gravite "ligne
 * entiere" classique façon Tetris) - c'est ce qui permet a des morceaux
 * de pieces differentes de se reassembler en une nouvelle ligne complete
 * apres qu'une chute ait bouge des blocs, cf. runCascade ci-dessous.
 * Meme logique que l'ancien code par-colonne des capacites speciales,
 * generalisee a tout le plateau. */
MainScene.prototype.dropColumnsToFillGaps = function () {
  for (var c = 0; c < COLS; c++) {
    var kept = [];
    for (var r = 0; r < ROWS; r++) {
      if (this.board[r][c]) { kept.push(this.board[r][c]); }
    }
    var newCol = new Array(ROWS - kept.length).fill(null).concat(kept);
    for (var r2 = 0; r2 < ROWS; r2++) { this.board[r2][c] = newCol[r2]; }
  }
};

/* Calcule, PAR COLONNE et AVANT tout appel a dropColumnsToFillGaps, quelle
 * cellule finira a quelle nouvelle rangee - meme algorithme de tassement
 * (l'ordre relatif de haut en bas est preserve), donc l'appariement
 * ancien-rang/nouveau-rang est garanti exact. Sert uniquement a piloter
 * l'animation visuelle de chute (ThreeBoard.animateFall) - la donnee reelle
 * du plateau, elle, est toujours mise a jour instantanement par
 * dropColumnsToFillGaps juste apres. */
MainScene.prototype.computeFallMoves = function () {
  var moves = [];
  for (var c = 0; c < COLS; c++) {
    var filledRows = [];
    for (var r = 0; r < ROWS; r++) { if (this.board[r][c]) { filledRows.push(r); } }
    var n = filledRows.length;
    for (var i = 0; i < n; i++) {
      var fromRow = filledRows[i];
      var toRow = ROWS - n + i;
      if (fromRow !== toRow) {
        var cell = this.board[fromRow][c];
        moves.push({ col: c, fromRow: fromRow, toRow: toRow, color: cell.color });
      }
    }
  }
  return moves;
};

MainScene.prototype.findFullRows = function () {
  var found = [];
  for (var r = ROWS - 1; r >= 0; r--) {
    var full = true;
    var mono = true;
    var firstColor = this.board[r][0] ? this.board[r][0].color : null;
    for (var c = 0; c < COLS; c++) {
      var cell = this.board[r][c];
      if (!cell) { full = false; break; }
      if (cell.color !== firstColor) { mono = false; }
    }
    if (full) { found.push({ row: r, mono: mono }); }
  }
  return found;
};

/* Coeur du systeme de "combo" a la Tetris + reaction en chaine physique
 * (demande explicite de l'utilisateur : "les formes de cubes devraient
 * pouvoir se casser si des lignes ont ete formees et comboees pour que
 * les morceaux se reassemblent et fassent a nouveau des lignes"). Boucle
 * tant que des lignes completes sont trouvees : clignote, credite le
 * score (bonus croissant par vague via COMBO_BONUS_PER_WAVE), vide les
 * cellules concernees, fait retomber chaque colonne (dropColumnsToFillGaps)
 * - ce qui peut faire naitre une NOUVELLE ligne complete a partir de
 * morceaux de colonnes differentes qui viennent de se reassembler - puis
 * revérifie. S'arrete des qu'une vague ne trouve plus rien.
 * onComplete(totalLinesCleared) recoit le total toutes vagues confondues. */
var COMBO_BONUS_PER_WAVE = 150;

MainScene.prototype.runCascade = function (onComplete) {
  var self = this;
  var wave = 0;
  var totalLinesCleared = 0;

  function step() {
    var full = self.findFullRows();
    if (full.length === 0) {
      if (wave > 0) { self.hideComboText(); }
      onComplete(totalLinesCleared);
      return;
    }
    wave++;

    var rowsIdx = full.map(function (f) { return f.row; });
    var originalColors = {};
    rowsIdx.forEach(function (r) {
      originalColors[r] = self.board[r].map(function (cell) { return cell ? cell.color : null; });
    });

    var FLASH_TOGGLES = 4, FLASH_STEP_MS = 70;
    var toggle = 0;

    function setFlash(on) {
      rowsIdx.forEach(function (r) {
        for (var c = 0; c < COLS; c++) {
          if (self.board[r][c]) { self.board[r][c].color = on ? 0xffffff : originalColors[r][c]; }
        }
      });
      self.redrawBoard();
    }

    function flashTick() {
      setFlash(toggle % 2 === 0);
      toggle++;
      if (toggle <= FLASH_TOGGLES) {
        self.time.delayedCall(FLASH_STEP_MS, flashTick);
      } else {
        setFlash(false);
        applyWave();
      }
    }

    function applyWave() {
      var n = full.length;
      self.score += LINE_SCORES[n] * self.level + (wave - 1) * COMBO_BONUS_PER_WAVE * self.level;

      /* Bonus simplifie (voir MAX_BONUS_PIPS) : si les 3 pastilles etaient
       * DEJA allumees avant cette vague, cette ligne-ci declenche le bonus
       * de points et reinitialise les pastilles - avant de calculer le
       * gain de POWER de cette meme vague (qui, lui, sert deja au
       * PROCHAIN cycle de pastilles). */
      var bonusReady = self.bonusPips >= MAX_BONUS_PIPS;
      var powerGain = POWER_PER_LINES[n];
      full.forEach(function (f) {
        if (f.mono) { self.score += 200 * self.level; powerGain += POWER_MONO_BONUS; }
      });
      if (bonusReady) {
        self.score += BONUS_POINTS_PER_LEVEL * self.level;
        self.bonusPips = 0;
        self.showBonusText();
      }
      self.power += powerGain;
      while (self.power >= POWER_MAX && self.bonusPips < MAX_BONUS_PIPS) {
        self.power -= POWER_MAX;
        self.bonusPips++;
      }
      if (self.bonusPips >= MAX_BONUS_PIPS) { self.power = POWER_MAX; } // barre "pleine" tant que le bonus attend d'etre consomme

      full.forEach(function (f) {
        for (var c = 0; c < COLS; c++) { self.board[f.row][c] = null; }
      });
      /* Calcule les trajets de chute AVANT de tasser les colonnes (la
       * donnee, elle, change instantanement - seul le rendu 3D est
       * anime en fondu ci-dessous). Retour utilisateur : la retombee
       * etait un teleportage instantane, "pas agreable" a regarder. */
      var fallMoves = self.computeFallMoves();
      self.dropColumnsToFillGaps();

      totalLinesCleared += n;
      self.linesCleared += n;
      var newLevel = Math.floor(self.linesCleared / LINES_PER_LEVEL) + 1;
      if (newLevel !== self.level) {
        self.level = newLevel;
        self.fallDelay = fallDelayForLevel(self.level);
      }

      /* Pendant l'anim de chute, les cellules en mouvement sont dessinees
       * UNIQUEMENT par ThreeBoard.animateFall (calque separe) - le rendu
       * "statique" instantane ci-dessous exclut donc ces positions pour
       * ne pas afficher un cube en double (un immobile a l'arrivee + un
       * autre qui tombe vers ce meme point). */
      var movingTo = {};
      fallMoves.forEach(function (m) { movingTo[m.toRow + ',' + m.col] = true; });
      var staticBoard = self.board.map(function (row, r) {
        return row.map(function (cell, c) { return movingTo[r + ',' + c] ? null : cell; });
      });
      ThreeBoard.syncBoard(staticBoard);
      self.updateHud();
      if (wave > 1) { self.showComboText(wave); }

      var FALL_ANIM_MS = 380;
      ThreeBoard.animateFall(fallMoves, FALL_ANIM_MS, function () {
        self.redrawBoard();
        self.time.delayedCall(0, step);
      });
    }

    flashTick();
  }

  step();
};

MainScene.prototype.showComboText = function (wave) {
  if (!this.comboText) { return; }
  this.comboText.setText('COMBO x' + wave + ' !');
  this.comboText.setAlpha(1);
  this.comboText.setScale(1.3);
  this.tweens.add({ targets: this.comboText, scale: 1, duration: 180 });
};

MainScene.prototype.showBonusText = function () {
  if (!this.bonusText) { return; }
  this.bonusText.setAlpha(1).setScale(1.4);
  this.tweens.add({ targets: this.bonusText, scale: 1, duration: 200 });
  this.tweens.add({ targets: this.bonusText, alpha: 0, duration: 300, delay: 600 });
};

MainScene.prototype.hideComboText = function () {
  if (!this.comboText) { return; }
  this.tweens.add({ targets: this.comboText, alpha: 0, duration: 250, delay: 300 });
};

MainScene.prototype.redrawBoard = function () {
  ThreeBoard.syncBoard(this.board);
};

MainScene.prototype.redrawPiece = function () {
  if (!this.piece) { ThreeBoard.syncPiece(null, null, null); return; }
  var p = this.piece;
  var color = PIECE_COLORS[p.type];

  /* Pas de piece fantome (previsualisation de l'atterrissage) - demande
   * explicite, ca donnait l'impression de voir deux fois le meme bloc. */
  var cells = this.cellsFor(p, p.rot, p.row, p.col).filter(function (c) { return c.row >= 0; });
  ThreeBoard.syncPiece(cells, null, color);
};

MainScene.prototype.renderNext = function () {
  ThreeBoard.syncNext(this.nextType, this.nextType ? PIECE_COLORS[this.nextType] : null);
};

MainScene.prototype.updateHud = function () {
  this.scoreText.setText(String(Math.min(999999, this.score)).padStart(6, '0'));
  if (this.score > this.hiScore) { this.hiScore = this.score; }
  this.hiScoreText.setText(String(Math.min(999999, this.hiScore)).padStart(6, '0'));
  this.levelText.setText(String(this.level).padStart(2, '0'));

  var bar = this.powerBar;
  var ratio = Phaser.Math.Clamp(this.power / POWER_MAX, 0, 1);
  this.powerFillGraphics.clear();
  if (ratio > 0.01) {
    var fillW = Math.max(bar.h, bar.w * ratio);
    this.powerFillGraphics.fillStyle(0xffffff, 1).fillRoundedRect(bar.x, bar.y, fillW, bar.h, bar.h / 2);
  }

  /* Pastilles bonus : entierement automatique, rien a activer - chaque
   * ligne effacee remplit POWER, POWER plein allume une pastille, 3
   * pastilles allumees = la prochaine ligne donne un bonus de points
   * (voir runCascade/MAX_BONUS_PIPS). Systeme volontairement simplifie -
   * l'ancien (capacites bombe/purge/ligne, touche MAJ, cellule speciale a
   * viser dans la piece) rendait le jeu difficile a comprendre (retour
   * utilisateur explicite). */
  for (var i = 0; i < MAX_BONUS_PIPS; i++) {
    this.bonusPipShapes[i].setAlpha(i < this.bonusPips ? 1 : 0.25);
  }
};

/* Lance la rotation de musiques de partie : ordre melange, une piste a
 * la fois, chainee via queueNextGameplayTrack (fondu enchaine, jamais
 * de coupure nette entre deux morceaux) - meme logique que Bornes 1/2. */
MainScene.prototype.startGameplayMusic = function () {
  this.musicPlaylist = Phaser.Utils.Array.Shuffle(GAMEPLAY_TRACKS.slice());
  this.musicIndex = 0;
  this.currentMusic = null;
  this.queueNextGameplayTrack(true);
};

MainScene.prototype.queueNextGameplayTrack = function (isFirst) {
  var key = this.musicPlaylist[this.musicIndex];
  var sound = safeAddMusic(this, key, { loop: false, volume: isFirst ? MUSIC_VOLUME : 0 });
  if (!sound) {
    /* Piste pas prete/indisponible - retente au prochain morceau au lieu
     * de casser toute la boucle de rotation. */
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
};

MainScene.prototype.cancelPendingTimers = function () {
  this.lockTimer = null;
  if (this.musicTimer) { this.musicTimer.remove(false); }
};

MainScene.prototype.hardStop = function () {
  if (this.gameOver) { return; }
  this.gameOver = true;
  this.cancelPendingTimers();
  ALL_MUSIC_KEYS.forEach(function (key) { safeStopMusic(this, key); }, this);
  ThreeBoard.clear();
};

MainScene.prototype.endGame = function () {
  if (this.gameOver) { return; }
  this.gameOver = true;
  this.finalScore = this.score;
  this.cancelPendingTimers();
  ALL_MUSIC_KEYS.forEach(function (key) { safeStopMusic(this, key); }, this);
  /* Le plateau Three.js tourne independamment de Phaser (sa propre
   * boucle requestAnimationFrame) - sans ce clear(), les cubes restent
   * affiches par-dessus l'ecran GameOverScene (canvas Three.js au-dessus
   * du canvas Phaser) et masquent son texte. */
  ThreeBoard.clear();
  this.scene.start('GameOverScene', { score: this.score });
};

MainScene.prototype.update = function (time, delta) {
  if (this.starfield) { this.starfield.tilePositionY -= delta * 0.03; }
  if (this.gameOver || !this.piece) { return; }

  if (Phaser.Input.Keyboard.JustDown(this.cursors.left)) {
    this.tryMove(-1);
    this.moveRepeatTimer = time + 220;
  } else if (Phaser.Input.Keyboard.JustDown(this.cursors.right)) {
    this.tryMove(1);
    this.moveRepeatTimer = time + 220;
  } else if (this.cursors.left.isDown && time > this.moveRepeatTimer) {
    this.tryMove(-1);
    this.moveRepeatTimer = time + 60;
  } else if (this.cursors.right.isDown && time > this.moveRepeatTimer) {
    this.tryMove(1);
    this.moveRepeatTimer = time + 60;
  }

  /* ESPACE tourne la piece (HAUT n'est plus utilise). */
  if (Phaser.Input.Keyboard.JustDown(this.spaceKey)) {
    this.tryRotate();
  }

  /* BAS accelere la chute pas a pas (une case par pression/repetition),
   * plus de chute instantanee "d'un coup" - meme cadence DAS que
   * GAUCHE/DROITE, avec son propre timer de repetition pour ne pas
   * entrer en conflit avec un mouvement lateral tenu en meme temps. */
  if (Phaser.Input.Keyboard.JustDown(this.cursors.down)) {
    this.tryDrop();
    this.dropRepeatTimer = time + 220;
  } else if (this.cursors.down.isDown && time > this.dropRepeatTimer) {
    this.tryDrop();
    this.dropRepeatTimer = time + 60;
  }

  if (time > this.fallTimer) {
    this.fallTimer = time + this.fallDelay;
    if (!this.checkCollision(this.piece, 1, 0, 0)) {
      this.piece.row += 1;
      this.redrawPiece();
      this.lockTimer = null;
    } else if (this.lockTimer === null) {
      this.lockTimer = time + LOCK_DELAY_MS;
    }
  }

  if (this.lockTimer !== null && time > this.lockTimer && this.checkCollision(this.piece, 1, 0, 0)) {
    this.lockPiece();
  }

  this.updateHud();
};

/* ============================================================
 * GameOverScene
 * ============================================================ */
function GameOverScene() {
  Phaser.Scene.call(this, { key: 'GameOverScene' });
}
GameOverScene.prototype = Object.create(Phaser.Scene.prototype);
GameOverScene.prototype.constructor = GameOverScene;

GameOverScene.prototype.create = function (data) {
  this.starfield = drawStarfield(this);
  var score = (data && data.score) || 0;

  /* La musique de partie est deja coupee par endGame() (voir MainScene)
   * avant la transition ici - il ne reste qu'a jouer le jingle, une
   * seule fois (pas de loop). */
  safePlayMusic(this, 'music-game-over', { loop: false, volume: 0.45 });

  this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 100, 'GAME OVER', {
    fontFamily: 'Courier New', fontSize: '48px', fontStyle: 'bold', color: '#ff3a5e'
  }).setOrigin(0.5).setShadow(0, 0, '#ff3a5e', 16, true, true);

  this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 30, 'SCORE : ' + score, {
    fontFamily: 'Courier New', fontSize: '24px', color: '#e8edf7'
  }).setOrigin(0.5);

  this.continueHint = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 40, 'Un instant...', {
    fontFamily: 'Courier New', fontSize: '14px', color: '#7fa8c9'
  }).setOrigin(0.5);

  this.enterKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER);
  this.readyForInput = false;
  var self = this;

  /* Ecran de saisie du nom seulement si le score entre reellement dans
   * le top 10 de cette borne (moins de 10 scores enregistres, ou score
   * strictement superieur au dernier du classement connu) - pas a
   * chaque partie, demande explicite de l'utilisateur. */
  var qualifies = latestScores.length < LEADERBOARD_SIZE || score > latestScores[latestScores.length - 1].score;

  function showContinueHint() {
    self.continueHint.setText('ENTREE pour rejouer   -   ECHAP pour quitter');
    self.readyForInput = true;
  }

  if (qualifies && score > 0 && window.FiveCadeBridge) {
    window.FiveCadeBridge.promptName(function (name) {
      window.FiveCadeBridge.submitScore(score, name);
      showContinueHint();
    });
  } else {
    if (score > 0 && !qualifies) {
      this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 8,
        'Pas assez pour entrer au Top ' + LEADERBOARD_SIZE + ' (25e : ' + latestScores[latestScores.length - 1].score + ')', {
          fontFamily: 'Courier New', fontSize: '14px', color: '#ff9a7a'
        }).setOrigin(0.5);
    }
    showContinueHint();
  }
  this.input.keyboard.on('keydown', function (ev) {
    if (self.readyForInput && ev.key === 'Enter') { self.scene.start('MenuScene'); }
  });
};

GameOverScene.prototype.update = function (time, delta) {
  if (this.starfield) { this.starfield.tilePositionY -= delta * 0.03; }
  // (rejouer : evenement keydown, voir create)
};

/* ============================================================
 * Bootstrap - cree le jeu Phaser une seule fois, le pont HTML
 * (FiveCadeGame) sert d'interface avec la NUI shell. Meme structure que
 * fivecade_degenatron_penetrator/html/game.js.
 * ============================================================ */
(function () {
  "use strict";

  var game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game-container',
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
    backgroundColor: '#05060f',
    scene: [BootScene, MenuScene, MainScene, GameOverScene]
  });
  window.__PHASER_GAME__ = game;

  var menuSceneRef = null;
  var mainSceneRef = null;

  window.FiveCadeGame = {
    onOpen: function () {
      window.__fivecadeBorneOpenRequested = true;
      if (!window.__fivecadeBootComplete) { return; }
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
      /* hardStop() ne coupe la musique que si une partie a demarre
       * (mainSceneRef existe) - si le joueur ferme depuis le menu, rien
       * d'autre n'arreterait le theme d'accueil (MENU_THEME_KEY). */
      ALL_MUSIC_KEYS.concat([MENU_THEME_KEY]).forEach(function (key) {
        try { game.sound.stopByKey(key); } catch (e) { /* ignore */ }
      });
      game.scene.stop('MainScene');
      game.scene.stop('GameOverScene');
      game.scene.stop('MenuScene');
      menuSceneRef = null;
      mainSceneRef = null;
    },
    // Appele par index.html sur Echap : true = panneau des scores referme,
    // la borne ne se ferme pas.
    consumeEscape: function () {
      if (menuSceneRef && menuSceneRef.scoresPanel) {
        menuSceneRef.closeScores();
        return true;
      }
      return false;
    },
    onScoresUpdated: function (scores) {
      latestScores = scores || [];
      if (menuSceneRef) {
        menuSceneRef.onScoresUpdated(scores);
      }
    },
    getBorneType: function () {
      return 'qub3d';
    },
    _registerMenuScene: function (scene) {
      menuSceneRef = scene;
    },
    _registerMainScene: function (scene) {
      mainSceneRef = scene;
    }
  };
})();
