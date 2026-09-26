-- Config de la borne Street Wars, Gang Wars Edition.
-- Les 4 variantes du meme meuble lancent toutes ce jeu : aucune borne
-- n'impose de gang (le choix se fait en jeu). La couleur de chaque variante
-- (verifiee sur les textures du modele) ne sert qu'au cadre affiche a
-- l'ecran et au curseur de depart sur la page de selection.
FiveCadeStreetWarsConfig = {
    propModels = {
        { model = `vw_prop_vw_arcade_02a`, color = 'green' },
        { model = `vw_prop_vw_arcade_02b`, color = 'purple' },
        { model = `vw_prop_vw_arcade_02c`, color = 'yellow' },
        { model = `vw_prop_vw_arcade_02d`, color = 'blue' },
    },
    -- Distance (metres) a laquelle le prompt d'interaction s'affiche/active
    interactionDistance = 1.5,
    -- Rayon de recherche des props autour du joueur (metres)
    scanRadius = 15.0,
    -- Frequence du scan des props (ms) - pas besoin de chaque frame
    scanIntervalMs = 1000,
}
