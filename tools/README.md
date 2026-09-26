# Outils de développement (hors jeu)

Ces fichiers ne sont PAS des ressources FiveM (aucun `fxmanifest.lua`) : ne pas les `ensure`.

| Fichier | Rôle |
|---|---|
| `invade_persuade_music.py` | Compose et génère les 4 musiques d'Invade and Persuade (`menu.ogg`, `level1-3.ogg`) dans `../fivecade_invade_persuade/html/music/`. Prérequis : Python 3 + numpy + ffmpeg. Lancer : `python invade_persuade_music.py`. |
| `invade_persuade_banc.js` | Banc d'essai d'équilibrage (joueur-robot + parties accélérées + statistiques). Le copier temporairement dans `fivecade_invade_persuade/html/`, ouvrir la page en local, puis dans la console : `eval(await (await fetch('invade_persuade_banc.js')).text()); await runMany(10, {maxSec: 900})`. |
| `street_wars_sim_test.js` | Banc d'essai du moteur de Street Wars (cartes symétriques et connexes, parties 100 % CPU jusqu'à la victoire, statistiques d'équilibrage). Lancer : `node street_wars_sim_test.js 20`. |
| `street_wars_server_test.js` | Test du vrai `server/main.js` de Street Wars avec de fausses fonctions FiveM : salons, gangs déjà pris, salon complet, décompte, partie en ligne complète, joueur remplacé par un CPU. Lancer : `node street_wars_server_test.js`. |
| `street_wars_mocknet.js` | Faux serveur FiveM pour tester le mode en ligne dans un navigateur : servir `D:\FiveCade\resources` puis ouvrir `/fivecade_street_wars/html/index.html?autoopen=1&mocknet=1` (faux joueurs pilotables depuis la console, voir l'en-tête du fichier). |
| `street_wars_chars.py` | Transforme un export PixelLab (« Spritesheet PNG + JSON ») d'un personnage de Street Wars en planche compacte pour le jeu (`html/chars_<gang>.png`). Lancer : `python street_wars_chars.py <export.zip> <green\|purple\|yellow\|blue>`. |
| `street_wars_music.py` | Compose et génère les 2 musiques de Street Wars (`html/music/menu.ogg`, `game.ogg`), en boucles parfaites et sans aigus agressifs. Prérequis : Python 3 + numpy + ffmpeg. Lancer : `python street_wars_music.py`. |
