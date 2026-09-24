-- Config de la borne Invade and Persuade (voir project-fivcade-benchmark-bornes :
-- deux props reperes pour ce meme jeu, meme logique que Degenatron/Penetrator).
FiveCadeInvadePersuadeConfig = {
    propModels = {
        `ch_prop_arcade_invade_01a`,
        `vw_prop_vw_arcade_01a`,
    },
    -- Distance (metres) a laquelle le prompt d'interaction s'affiche/active
    interactionDistance = 1.5,
    -- Rayon de recherche des props autour du joueur (metres)
    scanRadius = 15.0,
    -- Frequence du scan des props (ms) - pas besoin de chaque frame
    scanIntervalMs = 1000,
}
