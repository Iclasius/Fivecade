-- Config de la borne Degenatron/Penetrator (voir project-fivcade-benchmark-bornes :
-- les deux props different visuellement mais partagent le meme jeu, decision
-- explicite de l'utilisateur).
FiveCadeDegenatronConfig = {
    propModels = {
        `ch_prop_arcade_degenatron_01a`,
        `ch_prop_arcade_penetrator_01a`,
    },
    -- Distance (metres) a laquelle le prompt d'interaction s'affiche/active
    interactionDistance = 1.5,
    -- Rayon de recherche des props autour du joueur (metres)
    scanRadius = 15.0,
    -- Frequence du scan des props (ms) - pas besoin de chaque frame
    scanIntervalMs = 1000,
}
