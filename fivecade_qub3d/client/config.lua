-- Config de la borne Qub3d (puzzle de blocs qui tombent, un seul modele
-- de prop pour l'instant, voir project-fivcade-benchmark-bornes).
FiveCadeQub3dConfig = {
    propModels = {
        `sum_prop_arcade_qub3d_01a`,
    },
    -- Distance (metres) a laquelle le prompt d'interaction s'affiche/active
    interactionDistance = 1.5,
    -- Rayon de recherche des props autour du joueur (metres)
    scanRadius = 15.0,
    -- Frequence du scan des props (ms) - pas besoin de chaque frame
    scanIntervalMs = 1000,
}
