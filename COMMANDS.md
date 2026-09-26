# FiveCade — commandes utiles

Commandes serveur/console pour installer une borne et gérer les
classements. À utiliser depuis la console du serveur (ou en jeu pour
les commandes de placement, en tant qu'admin).

## Placer une borne (outil `arcadem_devtools_propplacer`)

Cet outil est temporaire (dev uniquement) — à retirer du serveur une
fois toutes les bornes définitivement placées. Toutes les commandes
ci-dessous se tapent dans le chat/console **en jeu**.

| Commande | Effet |
|---|---|
| `devtools_tp_borne` | Téléporte au point de test par défaut. |
| `devtools_spawnprop [model]` | Fait apparaître une préview du prop à la position du joueur (modèle par défaut : `ch_prop_arcade_degenatron_01a`). Se déplace/pivote ensuite normalement pour ajuster. |
| `devtools_menu` | Ouvre un petit menu NUI pour ajuster finement la préview (nécessite d'avoir fait `devtools_spawnprop` avant). |
| `devtools_deleteprop` | Supprime la préview en cours (ne touche pas aux bornes déjà sauvegardées). |
| `devtools_saveprop` | Rend la préview actuelle permanente (sauvegardée côté serveur, recréée à chaque connexion) et affiche les coordonnées finales dans la console. |
| `devtools_saveprop_at <model> <x> <y> <z> <heading>` | Sauvegarde directement une borne à des coordonnées précises, sans préview manuelle (utile pour re-créer une borne effacée par erreur). |
| `devtools_removelastprop` | Retire la dernière borne permanente ajoutée. |
| `devtools_clearprops` | Retire **toutes** les bornes permanentes. |
| `devtools_resetall` | Réinitialisation complète (préviews + bornes permanentes). |

**Modèles de prop disponibles** :
- `ch_prop_arcade_degenatron_01a` — borne 1, Degenatron (voir `fivecade_degenatron_penetrator/client/config.lua`)
- `ch_prop_arcade_penetrator_01a` — borne 2, Penetrator (même resource/config que ci-dessus)
- `sum_prop_arcade_qub3d_01a` — borne 3, Qub3d (voir `fivecade_qub3d/client/config.lua`)
- `ch_prop_arcade_invade_01a` — Invade and Persuade (voir `fivecade_invade_persuade/client/config.lua`)
- `vw_prop_vw_arcade_02a` / `02b` / `02c` / `02d` — Street Wars, Gang Wars Edition (voir ci-dessous)

## Street Wars, Gang Wars Edition : les 4 bornes

Les 4 variantes du même meuble lancent toutes le même jeu (4 joueurs en
ligne, une borne par joueur). La couleur de la borne donne seulement le
cadre affiché à l'écran et le gang proposé en premier ; le gang se
choisit ensuite en jeu. On les pose **une par une**, en jeu :

| Borne | Couleur (gang) | Commandes |
|---|---|---|
| `vw_prop_vw_arcade_02a` | **Vert** | `devtools_spawnprop vw_prop_vw_arcade_02a` puis `devtools_saveprop` |
| `vw_prop_vw_arcade_02b` | **Violet** | `devtools_spawnprop vw_prop_vw_arcade_02b` puis `devtools_saveprop` |
| `vw_prop_vw_arcade_02c` | **Jaune** | `devtools_spawnprop vw_prop_vw_arcade_02c` puis `devtools_saveprop` |
| `vw_prop_vw_arcade_02d` | **Bleu** | `devtools_spawnprop vw_prop_vw_arcade_02d` puis `devtools_saveprop` |

### Borne déjà présente dans une map/MLO

Une borne posée par une map/MLO n'est pas détectée automatiquement (ce
n'est pas un objet dynamique). On l'enregistre une fois, en jeu, avec le
module `fivecade_staticbornes` (qui doit être démarré) : se placer
**devant l'écran de la borne**, là où le joueur se tiendra, puis taper la
commande correspondant à sa couleur :

| Borne dans la MLO | Commande |
|---|---|
| Verte (`02a`) | `fivecade_registerstatic fivecade_street_wars green` |
| Violette (`02b`) | `fivecade_registerstatic fivecade_street_wars purple` |
| Jaune (`02c`) | `fivecade_registerstatic fivecade_street_wars yellow` |
| Bleue (`02d`) | `fivecade_registerstatic fivecade_street_wars blue` |

La borne devient jouable immédiatement pour tous les joueurs connectés
(les noms français `vert`/`violet`/`jaune`/`bleu` marchent aussi).
Vérifier : `fivecade_liststatic fivecade_street_wars` — retirer :
`fivecade_removestatic fivecade_street_wars <numéro>`. Commandes réservées
aux admins (ACE `command.fivecade_registerstatic`, etc., voir
`fivecade_staticbornes/server.lua`).

Degenatron et Penetrator partagent exactement le même jeu/logique —
seule la direction artistique (visuel du menu, sprites d'ennemis,
teinte du vaisseau, musique) change selon le modèle posé, détecté
automatiquement à l'ouverture. Qub3d est une resource/un jeu à part
entière.

## Classements : règle commune à toutes les bornes

- **Top 25** par borne (`MAX_SCORES_PER_BORNE` dans `fivecade_highscore/server.lua`).
- Panneau **Meilleurs scores** déroulant : HAUT/BAS (ou molette) pour faire défiler, ENTRÉE ou ÉCHAP pour revenir au menu (Échap ne ferme plus la borne quand le panneau est ouvert).
- En fin de partie, si le score ne bat pas le 25e, aucun nom n'est demandé et le score n'est pas enregistré.
- Toute nouvelle borne doit reprendre ce fonctionnement.

## Nettoyer les classements (`fivecade_highscore`)

```
fivecade_wipe_scores
```

Console serveur **uniquement** (refusé si tapé en jeu). Efface tous les
classements de toutes les bornes (utile avant une vraie session, pour
ne pas laisser les scores de test visibles aux joueurs). Chaque borne
physique garde son propre classement indépendant (indexé par position,
pas par type de jeu) — cette commande les efface tous en une fois, il
n'y a pas de commande pour cibler une seule borne à ce jour.

## Verrou d'occupation des bornes

Aucune commande nécessaire — automatique. Tant qu'un joueur a une borne
ouverte, un second joueur voit `Occupée (nom du joueur)` au lieu du
`[E] Jouer` et ne peut pas la lancer. Se libère à la fermeture normale,
à la fin de partie, ou automatiquement si le joueur se déconnecte/crash
sans fermer proprement.
