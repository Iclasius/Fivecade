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

### Module partagé — `fivecade_highscore`

Dépendance commune à toutes les bornes FiveCade (présentes et futures) :
classements persistants indexés par borne physique (KVP natif, pas de
base de données), et verrou d'occupation cross-borne. Voir
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
   ```
3. Placer les props en jeu — voir [`COMMANDS.md`](./COMMANDS.md).

## Licence des composants tiers

`fivecade_degenatron_penetrator/html/phaser.min.js` embarque
[Phaser](https://phaser.io/) (licence MIT). Le reste du code (Lua +
JS du jeu) et les assets (sprites, musiques) sont propres à ce projet.
