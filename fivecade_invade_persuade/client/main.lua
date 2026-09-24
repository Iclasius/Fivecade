-- FiveCade - Borne Invade and Persuade
-- Detecte les props de borne places dans le monde (par n'importe quel
-- outil de placement du serveur - pas de spawn en dur ici, voir principe
-- "poser une borne n'importe ou" de project-fivcade-reset-principles),
-- affiche un prompt d'interaction a proximite, et ouvre la NUI du jeu.
--
-- Deux sources de bornes valides :
--   1. Props dynamiques places via arcadem_devtools_propplacer (ou tout
--      autre outil), detectes par modele - comportement d'origine.
--   2. Bornes natives deja presentes dans une map/MLO (donc jamais
--      "posees"), enregistrees par coordonnees exactes via
--      /fivecade_registerstatic (voir fivecade_staticbornes) - pas de
--      scan par modele pour celles-ci, une MLO peut reutiliser le meme
--      modele pour de la pure deco.

local isNuiOpen = false
local activeBorneId = nil
local staticBornes = {} -- charge au demarrage depuis fivecade_staticbornes

--------------------------------------------------------------------------
-- Verrou d'occupation (regle commune a toutes les bornes, voir
-- fivecade_highscore/server.lua) - occupiedBornes est un cache local
-- alimente par la diffusion serveur, jamais la source de verite (le
-- serveur tranche toujours en cas de course entre deux joueurs).
--------------------------------------------------------------------------
local occupiedBornes = {} -- [borneId] = holderName
local pendingLock = nil -- { borneId, borneType } en attente de reponse serveur

--------------------------------------------------------------------------
-- Chargement des bornes statiques (natives, voir fivecade_staticbornes) -
-- demande au demarrage de la ressource, pas besoin d'attendre une
-- interaction du joueur.
--------------------------------------------------------------------------
Citizen.CreateThread(function()
    TriggerServerEvent("fivecade:requestStaticBornes", GetCurrentResourceName())
end)

RegisterNetEvent("fivecade:staticBornesLoaded")
AddEventHandler("fivecade:staticBornesLoaded", function(resourceName, list)
    if resourceName == GetCurrentResourceName() then
        staticBornes = list or {}
    end
end)

--------------------------------------------------------------------------
-- Identifiant de borne stable, derive des coordonnees (chaque borne
-- physiquement presente garde son propre classement, meme si plusieurs
-- bornes du meme type sont presentes sur le meme serveur) - fonctionne
-- pareil pour un prop dynamique ou une borne statique enregistree.
--------------------------------------------------------------------------
local function GetBorneIdFromCoords(coords)
    return ("invade_%d_%d_%d"):format(
        math.floor(coords.x * 10),
        math.floor(coords.y * 10),
        math.floor(coords.z * 10)
    )
end

--------------------------------------------------------------------------
-- Recherche de la borne la plus proche, tous types confondus (prop
-- dynamique detecte par modele + bornes statiques enregistrees par
-- coordonnees). Retourne les coordonnees plutot qu'une entite : une
-- borne statique n'a pas d'entite associee.
--------------------------------------------------------------------------
local function FindNearbyBorne(playerCoords)
    local closestCoords, closestDist, closestType = nil, FiveCadeInvadePersuadeConfig.scanRadius, nil

    for _, obj in ipairs(GetGamePool('CObject')) do
        local model = GetEntityModel(obj)
        for _, wantedModel in ipairs(FiveCadeInvadePersuadeConfig.propModels) do
            if model == wantedModel then
                local coords = GetEntityCoords(obj)
                local dist = #(playerCoords - coords)
                if dist < closestDist then
                    -- Les deux props partagent pour l'instant la meme DA
                    -- ("invade") - a differencier plus tard si besoin,
                    -- meme mecanisme que Penetrator sur la borne 1.
                    closestCoords, closestDist, closestType = coords, dist, "invade"
                end
                break
            end
        end
    end

    for _, entry in ipairs(staticBornes) do
        local coords = vector3(entry.x, entry.y, entry.z)
        local dist = #(playerCoords - coords)
        if dist < closestDist then
            closestCoords, closestDist, closestType = coords, dist, entry.borneType or "invade"
        end
    end

    return closestCoords, closestDist, closestType
end

--------------------------------------------------------------------------
-- Affichage du texte 3D d'interaction
--------------------------------------------------------------------------
local function DrawText3D(coords, text)
    local onScreen, x, y = World3dToScreen2d(coords.x, coords.y, coords.z)
    if not onScreen then
        return
    end
    SetTextScale(0.35, 0.35)
    SetTextFont(4)
    SetTextProportional(true)
    SetTextColour(255, 255, 255, 215)
    SetTextEntry("STRING")
    SetTextCentre(true)
    AddTextComponentString(text)
    DrawText(x, y)
end

--------------------------------------------------------------------------
-- Ouverture / fermeture de la NUI
--------------------------------------------------------------------------
local function OpenGame(borneId, borneType)
    activeBorneId = borneId
    isNuiOpen = true
    SetNuiFocus(true, true)
    SendNUIMessage({
        type = "fivecade_open",
        borneId = borneId,
        borneType = borneType,
        playerName = GetPlayerName(PlayerId()),
    })
end

local function CloseGame()
    isNuiOpen = false
    -- Libere le verrou d'occupation (voir fivecade_highscore/server.lua) -
    -- que la partie soit finie ou quittee au milieu, la borne doit
    -- redevenir disponible pour quelqu'un d'autre des la fermeture.
    if activeBorneId ~= nil then
        TriggerServerEvent("fivecade:releaseBorne", activeBorneId)
    end
    activeBorneId = nil
    SetNuiFocus(false, false)
    SendNUIMessage({ type = "fivecade_close" })
end

--------------------------------------------------------------------------
-- Verrou d'occupation (regle commune a toutes les bornes, voir
-- fivecade_highscore/server.lua) - doit rester APRES OpenGame/CloseGame
-- ci-dessus (portee locale Lua).
--------------------------------------------------------------------------
RegisterNetEvent("fivecade:borneOccupancyChanged")
AddEventHandler("fivecade:borneOccupancyChanged", function(borneId, isOccupied, holderName)
    occupiedBornes[borneId] = isOccupied and holderName or nil
end)

RegisterNetEvent("fivecade:borneLockResult")
AddEventHandler("fivecade:borneLockResult", function(borneId, granted, holderName)
    if pendingLock == nil or pendingLock.borneId ~= borneId then
        return -- reponse perimee (le joueur a change de cible entre-temps)
    end
    local borneType = pendingLock.borneType
    pendingLock = nil
    if granted then
        OpenGame(borneId, borneType)
    end
end)

RegisterNUICallback("fivecade_close", function(_, cb)
    CloseGame()
    cb({ ok = true })
end)

RegisterNUICallback("fivecade_submitScore", function(data, cb)
    if activeBorneId == nil then
        cb({ ok = false, error = "no_active_borne" })
        return
    end
    TriggerServerEvent("fivecade:submitScore", activeBorneId, data.playerName, data.score)
    cb({ ok = true })
end)

RegisterNUICallback("fivecade_requestScores", function(_, cb)
    if activeBorneId == nil then
        cb({ ok = false, error = "no_active_borne" })
        return
    end
    TriggerServerEvent("fivecade:requestScores", activeBorneId)
    cb({ ok = true })
end)

RegisterNetEvent("fivecade:scoresUpdated")
AddEventHandler("fivecade:scoresUpdated", function(borneId, scores)
    if borneId == activeBorneId then
        SendNUIMessage({ type = "fivecade_scoresUpdated", scores = scores })
    end
end)

--------------------------------------------------------------------------
-- Boucle principale : detection des props/bornes statiques + prompt +
-- interaction
--------------------------------------------------------------------------
Citizen.CreateThread(function()
    while true do
        local sleep = FiveCadeInvadePersuadeConfig.scanIntervalMs
        if not isNuiOpen then
            local playerCoords = GetEntityCoords(PlayerPedId())
            local borneCoords, dist, borneType = FindNearbyBorne(playerCoords)
            if borneCoords ~= nil and dist <= FiveCadeInvadePersuadeConfig.interactionDistance then
                sleep = 0
                local borneId = GetBorneIdFromCoords(borneCoords)
                local holderName = occupiedBornes[borneId]
                if holderName ~= nil then
                    DrawText3D(borneCoords + vector3(0.0, 0.0, 0.5), ("~r~Occupee~s~ (%s)"):format(holderName))
                else
                    DrawText3D(borneCoords + vector3(0.0, 0.0, 0.5), "~g~[E]~s~ Jouer")
                    if IsControlJustPressed(0, 38) and pendingLock == nil then -- INPUT_PICKUP (E)
                        pendingLock = { borneId = borneId, borneType = borneType }
                        TriggerServerEvent("fivecade:tryLockBorne", borneId)
                    end
                end
            end
        end
        Citizen.Wait(sleep)
    end
end)

AddEventHandler("onResourceStop", function(resourceName)
    if GetCurrentResourceName() == resourceName and isNuiOpen then
        CloseGame()
    end
end)
