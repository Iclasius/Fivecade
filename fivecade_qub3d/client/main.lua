-- FiveCade - Borne Qub3d
-- Meme pattern que fivecade_degenatron_penetrator/client/main.lua (detection
-- de prop, prompt d'interaction, verrou d'occupation, pont NUI) - seule la
-- borneId change de prefixe. Un seul modele de prop pour cette borne, pas
-- besoin de GetBorneType ici.

local isNuiOpen = false
local activeBorneId = nil

--------------------------------------------------------------------------
-- Verrou d'occupation (regle commune a toutes les bornes, voir
-- fivecade_highscore/server.lua) - occupiedBornes est un cache local
-- alimente par la diffusion serveur, jamais la source de verite (le
-- serveur tranche toujours en cas de course entre deux joueurs).
--------------------------------------------------------------------------
local occupiedBornes = {} -- [borneId] = holderName
local pendingLock = nil -- { borneId } en attente de reponse serveur

--------------------------------------------------------------------------
-- Identifiant de borne stable, derive des coordonnees du prop (chaque
-- borne physiquement posee garde son propre classement, meme si deux
-- bornes Qub3d sont posees sur le meme serveur).
--------------------------------------------------------------------------
local function GetBorneId(entity)
    local coords = GetEntityCoords(entity)
    return ("qub3d_%d_%d_%d"):format(
        math.floor(coords.x * 10),
        math.floor(coords.y * 10),
        math.floor(coords.z * 10)
    )
end

--------------------------------------------------------------------------
-- Recherche des props de borne a proximite du joueur
--------------------------------------------------------------------------
local function FindNearbyBorne(playerCoords)
    local closest, closestDist = nil, FiveCadeQub3dConfig.scanRadius
    for _, obj in ipairs(GetGamePool('CObject')) do
        local model = GetEntityModel(obj)
        for _, wantedModel in ipairs(FiveCadeQub3dConfig.propModels) do
            if model == wantedModel then
                local dist = #(playerCoords - GetEntityCoords(obj))
                if dist < closestDist then
                    closest, closestDist = obj, dist
                end
                break
            end
        end
    end
    return closest, closestDist
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
local function OpenGame(borneId)
    activeBorneId = borneId
    isNuiOpen = true
    SetNuiFocus(true, true)
    SendNUIMessage({
        type = "fivecade_open",
        borneId = borneId,
        borneType = "qub3d",
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
-- Verrou d'occupation - doit rester APRES OpenGame/CloseGame ci-dessus
-- (portee locale Lua).
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
    pendingLock = nil
    if granted then
        OpenGame(borneId)
    end
    -- Refuse : occupiedBornes sera de toute facon mis a jour par le
    -- broadcast fivecade:borneOccupancyChanged.
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
-- Boucle principale : detection des props + prompt + interaction
--------------------------------------------------------------------------
Citizen.CreateThread(function()
    while true do
        local sleep = FiveCadeQub3dConfig.scanIntervalMs
        if not isNuiOpen then
            local playerCoords = GetEntityCoords(PlayerPedId())
            local borne, dist = FindNearbyBorne(playerCoords)
            if borne ~= nil and dist <= FiveCadeQub3dConfig.interactionDistance then
                sleep = 0
                local borneId = GetBorneId(borne)
                local borneCoords = GetEntityCoords(borne)
                local holderName = occupiedBornes[borneId]
                if holderName ~= nil then
                    DrawText3D(borneCoords + vector3(0.0, 0.0, 0.5), ("~r~Occupee~s~ (%s)"):format(holderName))
                else
                    DrawText3D(borneCoords + vector3(0.0, 0.0, 0.5), "~g~[E]~s~ Jouer")
                    if IsControlJustPressed(0, 38) and pendingLock == nil then -- INPUT_PICKUP (E)
                        pendingLock = { borneId = borneId }
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
