-- Config de la borne Space Monkey (voir project-fivcade-benchmark-bornes :
-- cabine Pixtro "Space Monkey 3", jeu = runner d'esquive facon Flappy Bird).
FiveCadeSpaceMonkeyConfig = {
    propModels = {
        `ch_prop_arcade_space_01a`,
    },
    -- Distance (metres) a laquelle le prompt d'interaction s'affiche/active
    interactionDistance = 1.5,
    -- Rayon de recherche des props autour du joueur (metres)
    scanRadius = 15.0,
    -- Frequence du scan des props (ms) - pas besoin de chaque frame
    scanIntervalMs = 1000,
}
