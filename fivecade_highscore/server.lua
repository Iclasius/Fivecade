-- FiveCade - module partage entre toutes les bornes : highscores +
-- verrou d'occupation (une borne = un joueur a la fois). Stockage KVP
-- natif (SetResourceKvp/GetResourceKvpString) pour les scores, indexe par
-- borneId (jamais par type de jeu) - permet a plusieurs bornes physiques
-- du meme jeu de garder chacune leur propre classement independant.

local MAX_SCORES_PER_BORNE = 25 -- Top 25 (demande utilisateur) ; Invade and Persuade l'affiche en deroulant, les autres bornes montrent les 10 premiers
-- Plafond de plausibilite, pas un vrai calcul de score max theorique -
-- juste large assez pour ne jamais gener un score legitime, mais assez
-- serre pour empecher un score fabrique a la main (appel direct de
-- window.FiveCadeBridge.submitScore(...) depuis la console du
-- navigateur NUI, si jamais accessible) de polluer indefiniment le
-- classement partage avec tous les autres joueurs.
local MAX_PLAUSIBLE_SCORE = 999999
local MAX_NAME_LENGTH = 16 -- doit matcher maxlength sur #name-entry-input (index.html)

local function kvpKey(borneId)
    return ('fivecade_scores_%s'):format(borneId)
end

local function loadScores(borneId)
    local raw = GetResourceKvpString(kvpKey(borneId))
    if not raw then
        return {}
    end

    local ok, data = pcall(json.decode, raw)
    if not ok or type(data) ~= 'table' then
        return {}
    end
    return data
end

local function saveScores(borneId, scores)
    SetResourceKvp(kvpKey(borneId), json.encode(scores))
end

RegisterNetEvent('fivecade:submitScore', function(borneId, playerName, score)
    if type(borneId) ~= 'string' or type(score) ~= 'number' then
        return
    end
    -- Le client (NUI JS + Lua) ne validait rien avant cette version -
    -- un score negatif/NaN/astronomique ou un nom demesure envoye via
    -- un appel direct au pont NUI (hors du flux normal du jeu) aurait
    -- ete accepte tel quel et affiche a tous les joueurs sur ce
    -- classement partage. Le serveur est la seule autorite qui compte
    -- ici, donc c'est lui qui doit trancher, pas juste faire confiance
    -- au client.
    score = math.floor(score)
    if score ~= score or score < 0 or score > MAX_PLAUSIBLE_SCORE then
        return
    end
    local name = tostring(playerName or '???'):sub(1, MAX_NAME_LENGTH)
    if name == '' then
        name = '???'
    end

    local scores = loadScores(borneId)
    table.insert(scores, { name = name, score = score })
    table.sort(scores, function(a, b) return a.score > b.score end)

    while #scores > MAX_SCORES_PER_BORNE do
        table.remove(scores)
    end

    saveScores(borneId, scores)
    TriggerClientEvent('fivecade:scoresUpdated', -1, borneId, scores)
end)

RegisterNetEvent('fivecade:requestScores', function(borneId)
    if type(borneId) ~= 'string' then
        return
    end
    TriggerClientEvent('fivecade:scoresUpdated', source, borneId, loadScores(borneId))
end)

--------------------------------------------------------------------------
-- Nettoyage des classements - utilitaire de dev/admin, PAS appelable par
-- un joueur (console uniquement, source ~= 0 refuse). Utile pour repartir
-- d'un classement vierge avant une vraie session (les scores accumules
-- pendant les tests de developpement ne doivent pas rester visibles aux
-- joueurs). Itere les cles KVP via StartFindKvp/FindKvp (prefixe
-- "fivecade_scores_") plutot que de deviner les borneId a la main.
--------------------------------------------------------------------------
RegisterCommand('fivecade_wipe_scores', function(source)
    if source ~= 0 then
        return
    end

    local prefix = 'fivecade_scores_'
    local keys = {}
    local handle = StartFindKvp(prefix)
    if handle ~= -1 then
        local key = FindKvp(handle)
        while key do
            table.insert(keys, key)
            key = FindKvp(handle)
        end
        EndFindKvp(handle)
    end

    for _, key in ipairs(keys) do
        DeleteResourceKvp(key)
    end

    print(('[fivecade_highscore] %d classement(s) de borne efface(s).'):format(#keys))
end, true)

--------------------------------------------------------------------------
-- Verrou d'occupation des bornes - regle demandee pour TOUTES les bornes
-- FiveCade (pas seulement Degenatron/Penetrator) : tant qu'un joueur
-- utilise une borne, un second ne peut pas la lancer en meme temps.
-- Vit ici (module partage par toutes les bornes, deja une dependency
-- commune) plutot que dans chaque resource de jeu.
--
-- Purement en memoire, jamais persiste (KVP) : un redemarrage de
-- ressource ou du serveur doit toujours repartir a zero, jamais garder
-- un joueur deconnecte comme "occupant" fantome d'une borne.
--------------------------------------------------------------------------
local occupiedBornes = {} -- [borneId] = { source = playerSrc, name = playerName }

local function releaseBorne(borneId, src)
    local holder = occupiedBornes[borneId]
    if holder == nil or holder.source ~= src then
        return
    end
    occupiedBornes[borneId] = nil
    TriggerClientEvent('fivecade:borneOccupancyChanged', -1, borneId, false, nil)
end

RegisterNetEvent('fivecade:tryLockBorne', function(borneId)
    local src = source
    if type(borneId) ~= 'string' then
        return
    end

    local holder = occupiedBornes[borneId]
    if holder ~= nil and holder.source ~= src then
        TriggerClientEvent('fivecade:borneLockResult', src, borneId, false, holder.name)
        return
    end

    local playerName = GetPlayerName(src) or '???'
    occupiedBornes[borneId] = { source = src, name = playerName }
    TriggerClientEvent('fivecade:borneLockResult', src, borneId, true)
    TriggerClientEvent('fivecade:borneOccupancyChanged', -1, borneId, true, playerName)
end)

RegisterNetEvent('fivecade:releaseBorne', function(borneId)
    if type(borneId) ~= 'string' then
        return
    end
    releaseBorne(borneId, source)
end)

-- Filet de securite : deconnexion (crash, ALT-F4, timeout...) sans passer
-- par un fivecade:releaseBorne explicite ne doit jamais laisser une
-- borne verrouillee indefiniment.
AddEventHandler('playerDropped', function()
    local src = source
    for borneId, holder in pairs(occupiedBornes) do
        if holder.source == src then
            releaseBorne(borneId, src)
        end
    end
end)
