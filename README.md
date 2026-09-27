# FiveCade

Bornes d'arcade jouables pour FiveM — chaque borne est une ressource
FiveM indépendante (prop détectable + interaction `[E]` + mini-jeu en
NUI), posable n'importe où sur la carte via
[`arcadem_devtools_propplacer`](./COMMANDS.md) (outil de dev, à retirer
une fois les emplacements définitifs choisis).

Ce dépôt grandit borne par borne : chaque nouvelle borne n'est ajoutée
ici qu'une fois validée en jeu.

## Bornes disponibles

### Degenatron / Penetrator — `fivecade_degenatron_penetrator`

Shoot 'em up vertical (bullet-hell) façon arcade 80s, moteur
[Phaser](https://phaser.io/) chargé en local dans la NUI. Une seule
ressource fait fonctionner **deux bornes physiques distinctes** qui
partagent exactement le même jeu/logique mais avec une direction
artistique propre à chacune (détectée automatiquement au modèle de prop
posé) :

- **Degenatron** — ambiance plus posée, vaisseau bleu/blanc.
- **Penetrator** — ambiance plus agressive (musique, ennemis, teinte
  du vaisseau rouge/noir).

Fonctionnalités : 3 armes réellement différentes (tir en éventail,
laser perforant, missile à explosion en zone), objets bombe et bouclier,
difficulté progressive, classement partagé par borne physique (persistant,
stocké en KVP serveur), verrou d'occupation (une borne = un joueur à la
fois, valable pour toutes les bornes FiveCade via le module partagé
ci-dessous), musiques d'ambiance générées (plusieurs pistes en rotation
aléatoire par borne, plus agressives sur Penetrator que sur Degenatron).

### Qub3d — `fivecade_qub3d`

Puzzle de blocs qui tombent façon Tetris (plateau 6×9), rendu en vraie
3D (Three.js) sous un HUD 2D (Phaser) — cadre d'arcade "Pixtro" dédié,
toujours à ratio correct quelle que soit la résolution du joueur (pas
de déformation, letterbox si besoin).

- **Gravité par colonne + réactions en chaîne physiques** : contrairement
  au Tetris classique (gravité ligne entière), effacer une ligne fait
  tomber chaque colonne indépendamment — des morceaux de pièces
  différentes peuvent alors se réassembler en une nouvelle ligne
  complète, déclenchant un vrai combo en cascade (affiché à l'écran,
  score bonus croissant par vague).
- **Bonus automatique et simple** : chaque ligne effacée remplit une
  jauge ; jauge pleine = une pastille s'allume (jusqu'à 3) ; les 3
  pastilles allumées, la ligne suivante déclenche un bonus de points.
  Aucune touche à retenir, aucun effet complexe.
- **Trous visuellement identifiés** : une case vide couverte par un
  surplomb (normal dans n'importe quel Tetris) est marquée au sol pour
  ne jamais être confondue avec un bug d'affichage.
- Chute des blocs animée (accélération + rebond à l'atterrissage),
  classement partagé par borne et musiques d'ambiance générées, mêmes
  mécaniques transverses que les autres bornes (verrou d'occupation,
  classement KVP).

### Invade and Persuade — `fivecade_invade_persuade`

Run and gun infini façon Metal Slug dans le désert, moteur Phaser en
local dans la NUI, sous le cadre d'arcade de la borne. Le commando
affronte des pandas, des ours polaires à chapka, des dromadaires à
tourelle, des élans « police montée » qui chargent et des drones rouillés.

- **Tir sur 8 directions** (poses de visée haut, bas et diagonales),
  saut, accroupi qui esquive réellement les tirs des ennemis au sol,
  grenades à charger.
- **Char parachuté** de temps en temps : on grimpe dedans (animation),
  canon lent mais explosif, inclinable en diagonale, blindage propre
  affiché dans l'interface, éjection et explosion quand il est détruit.
- **Barils** : jaune = $, bleu = santé, vert = +1 vie, rouge = explosif.
  Tous explosent si on leur tire dessus (un ennemi placé devant prend la
  balle à leur place).
- **Dangers** : frappes de missiles annoncées (zone au sol, mort
  immédiate sauf sur la dernière vie) et nappes de pétrole en feu à
  traverser par les plateformes.
- Cycle jour/nuit, difficulté progressive, 10 traits de santé par vie,
  bruitages et 4 musiques 16 bits originales (accueil + 3 niveaux en
  rotation), touche **M** pour couper le son.

### Street Wars, Gang Wars Edition — `fivecade_street_wars`

Bomberman de conquête de territoire à **4 joueurs en ligne** (une borne
par joueur, CPU pour compléter), sur les 4 variantes du même meuble :
`vw_prop_vw_arcade_02a` (vert), `02b` (violet), `02c` (jaune), `02d` (bleu).
Commandes de placement dans [`COMMANDS.md`](./COMMANDS.md).

- Salons ouverts depuis n'importe quelle borne, gang unique par partie,
  nom de joueur facultatif tapé en jeu, compte à rebours quand les 4
  places sont verrouillées ; un joueur qui quitte est remplacé par un CPU.
- Les bombes colorent chaque case traversée ; bâtiments destructibles case
  par case, murs blindés indestructibles, bonus portée / bombe / vitesse.
- 5 vies par manche, 4 manches : les cases de chaque gang encore en vie
  s'additionnent, départage aux kills. Descente de police en 3 vagues à
  la fin de chaque manche.
- Moteur partagé (`html/sim.js`) entre le serveur JS et la NUI, tout au
  clavier, musiques hip-hop et bruitages générés, **M** coupe le son.
- Les portraits (`html/portraits.webp`) ne sont pas publiés : les ajouter
  localement.

### Space Monkey 3: Bananas Gone Bad — `fivecade_space_monkey`

Runner d'esquive à score infini façon Flappy Bird, sur la cabine Pixtro
`ch_prop_arcade_space_01a`. Une seule touche (ESPACE / HAUT) propulse le
singe dans sa barque à roquettes : il ne se déplace que verticalement.

- Bananes : normale (+1), dorée (+10, collée aux astéroïdes), pourrie
  (−5, casse le combo). 5 bananes d'affilée = multiplicateur (jusqu'à x5).
- 5 zones de plus en plus rapides (la difficulté suit la distance) :
  murs d'astéroïdes fixes, puis mobiles, en rotation, et gros astéroïdes
  qui se fissurent puis éclatent.
- Bonus bouclier et nuke. Le Dr Dank passe de temps en temps : les murs
  s'arrêtent, sa soucoupe (champ de force qui pulvérise les astéroïdes)
  lâche des bananes pourries calculées pour être toujours esquivables en
  montant ou en descendant.
- Sprites PixelLab, cadre et écran d'accueil fournis, musiques « jungle
  spatiale » générées par `tools/space_monkey_music.py`.

### Réglage du volume (toutes les bornes)

Chaque borne propose une entrée **VOLUME** sur sa page d'accueil : barre
de 10 crans (flèches ou souris), **M** / **ENTRÉE** pour couper, **ÉCHAP**
pour revenir au menu. Le réglage est mémorisé par borne et s'applique à
la musique comme aux bruitages. Module commun `html/volume.js`, identique
dans chaque ressource.

### Bornes natives — `fivecade_staticbornes`

Permet d'enregistrer des bornes déjà présentes dans une map/MLO (sans
les poser avec l'outil de placement), par coordonnées exactes.

### Module partagé — `fivecade_highscore`

Dépendance commune à toutes les bornes FiveCade (présentes et futures) :
classements persistants indexés par borne physique (KVP natif, pas de
base de données), et verrou d'occupation cross-borne. Règle commune à
toutes les bornes : **Top 25** par borne, affiché dans un panneau
déroulant (haut/bas), et pas de saisie de nom si le score ne bat pas le
25e. Voir
[`COMMANDS.md`](./COMMANDS.md) pour la commande de nettoyage des
classements.

## Installation

```
dependency 'fivecade_highscore'  -- déjà déclaré dans chaque borne
```

1. Copier `fivecade_highscore` et la (les) borne(s) voulue(s) dans le
   dossier `resources` du serveur.
2. Les ajouter dans `server.cfg` :
   ```
   ensure fivecade_highscore
   ensure fivecade_degenatron_penetrator
   ensure fivecade_qub3d
   ensure fivecade_invade_persuade
   ensure fivecade_street_wars
   ensure fivecade_space_monkey
   ```
3. Placer les props en jeu — voir [`COMMANDS.md`](./COMMANDS.md).

## Licence des composants tiers

`fivecade_degenatron_penetrator/html/phaser.min.js`,
`fivecade_qub3d/html/phaser.min.js`,
`fivecade_invade_persuade/html/phaser.min.js`,
`fivecade_street_wars/html/phaser.min.js` et
`fivecade_space_monkey/html/phaser.min.js` embarquent [Phaser](https://phaser.io/)
(licence MIT). `fivecade_qub3d/html/three.min.js` embarque
[Three.js](https://threejs.org/) (licence MIT). Le reste du code
(Lua + JS du jeu) et les assets (sprites, musiques) sont propres à ce
projet.
