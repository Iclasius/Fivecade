# Outils de développement (hors jeu)

Ces fichiers ne sont PAS des ressources FiveM (aucun `fxmanifest.lua`) : ne pas les `ensure`.

| Fichier | Rôle |
|---|---|
| `invade_persuade_music.py` | Compose et génère les 4 musiques d'Invade and Persuade (`menu.ogg`, `level1-3.ogg`) dans `../fivecade_invade_persuade/html/music/`. Prérequis : Python 3 + numpy + ffmpeg. Lancer : `python invade_persuade_music.py`. |
| `invade_persuade_banc.js` | Banc d'essai d'équilibrage (joueur-robot + parties accélérées + statistiques). Le copier temporairement dans `fivecade_invade_persuade/html/`, ouvrir la page en local, puis dans la console : `eval(await (await fetch('invade_persuade_banc.js')).text()); await runMany(10, {maxSec: 900})`. |
