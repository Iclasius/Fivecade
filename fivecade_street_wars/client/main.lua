-- FiveCade - Borne Street Wars, Gang Wars Edition
-- Detecte les props de borne places dans le monde (aucun spawn en dur),
-- affiche le prompt [E], ouvre la NUI, et sert de simple relais entre la
-- NUI et le serveur (server/main.js fait autorite sur les salons et les
-- parties en ligne). Meme structure que les autres bornes FiveCade.

local isNuiOpen = false
local activeBorneId = nil
local staticBornes = {} -- bornes natives de map/MLO (voir fivecade_staticbornes)

local occupiedBornes = {} -- [borneId] = holderName (cache, le serveur tranche)
local pendingLock = nil -- { borneId } en attente de reponse serveur

Citizen.CreateThread(function()
    TriggerServerEvent("fivecade:requestStaticBornes", GetCurrentResourceName())
end)

RegisterNetEvent("fivecade:staticBornesLoaded")
AddEventHandler("fivecade:staticBornesLoaded", function(resourceName, list)
    if resourceName == GetCurrentResourceName() then
        staticBornes = list or {}
    end
end)

local function GetBorneIdFromCoords(coords)
    return ("streetwars_%d_%d_%d"):format(
        math.floor(coords.x * 10),
        math.floor(coords.y * 10),
        math.floor(coords.z * 10)
    )
end

-- Couleur d'une borne native : accepte green/purple/yellow/blue, les noms
-- francais (vert/violet/jaune/bleu) ou le suffixe du modele (02a..02d).
local COLOR_ALIASES = {
    green = 'green', vert = 'green', ['02a'] = 'green',
    purple = 'purple', violet = 'purple', ['02b'] = 'purple',
    yellow = 'yellow', jaune = 'yellow', ['02c'] = 'yellow',
    blue = 'blue', bleu = 'blue', ['02d'] = 'blue',
}
local function NormalizeColor(value)
    return COLOR_ALIASES[string.lower(tostring(value or ''))] or 'green'
end

local function FindNearbyBorne(playerCoords)
    local closestCoords, closestDist, closestColor = nil, FiveCadeStreetWarsConfig.scanRadius, nil

    for _, obj in ipairs(GetGamePool('CObject')) do
        local model = GetEntityModel(obj)
        for _, entry in ipairs(FiveCadeStreetWarsConfig.propModels) do
            if model == entry.model then
                local coords = GetEntityCoords(obj)
                local dist = #(playerCoords - coords)
                if dist < closestDist then
                    closestCoords, closestDist, closestColor = coords, dist, entry.color
                end
                break
            end
        end
    end

    -- Bornes natives de map : la couleur est le "borneType" enregistre.
    for _, entry in ipairs(staticBornes) do
        local coords = vector3(entry.x, entry.y, entry.z)
        local dist = #(playerCoords - coords)
        if dist < closestDist then
            closestCoords, closestDist, closestColor = coords, dist, NormalizeColor(entry.borneType)
        end
    end

    return closestCoords, closestDist, closestColor
end

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
local function OpenGame(borneId, borneColor)
    activeBorneId = borneId
    isNuiOpen = true
    -- Tout se joue au clavier : focus clavier sur la NUI, pas de curseur souris.
    SetNuiFocus(true, false)
    SendNUIMessage({
        type = "fivecade_open",
        borneId = borneId,
        borneColor = borneColor or 'green',
    })
end

local function CloseGame()
    isNuiOpen = false
    -- Quitter la borne = quitter le salon / la partie (le gang passe en CPU).
    TriggerServerEvent("fivecade_sw:c2s", "bye", {})
    if activeBorneId ~= nil then
        TriggerServerEvent("fivecade:releaseBorne", activeBorneId)
    end
    activeBorneId = nil
    SetNuiFocus(false, false)
    SendNUIMessage({ type = "fivecade_close" })
end

RegisterNetEvent("fivecade:borneOccupancyChanged")
AddEventHandler("fivecade:borneOccupancyChanged", function(borneId, isOccupied, holderName)
    occupiedBornes[borneId] = isOccupied and holderName or nil
end)

RegisterNetEvent("fivecade:borneLockResult")
AddEventHandler("fivecade:borneLockResult", function(borneId, granted)
    if pendingLock == nil or pendingLock.borneId ~= borneId then
        return
    end
    local borneColor = pendingLock.borneColor
    pendingLock = nil
    if granted then
        OpenGame(borneId, borneColor)
    end
end)

RegisterNUICallback("fivecade_close", function(_, cb)
    CloseGame()
    cb({ ok = true })
end)

--------------------------------------------------------------------------
-- Relais NUI <-> serveur (salons, selection des gangs, touches en partie)
--------------------------------------------------------------------------
RegisterNUICallback("sw_send", function(data, cb)
    if isNuiOpen and type(data) == "table" and type(data.t) == "string" then
        TriggerServerEvent("fivecade_sw:c2s", data.t, data.d or {})
    end
    cb({ ok = true })
end)

RegisterNetEvent("fivecade_sw:s2c")
AddEventHandler("fivecade_sw:s2c", function(t, d)
    if isNuiOpen then
        SendNUIMessage({ type = "sw", t = t, d = d })
    end
end)

--------------------------------------------------------------------------
-- Boucle principale : detection + prompt + interaction
--------------------------------------------------------------------------
Citizen.CreateThread(function()
    while true do
        local sleep = FiveCadeStreetWarsConfig.scanIntervalMs
        if not isNuiOpen then
            local playerCoords = GetEntityCoords(PlayerPedId())
            local borneCoords, dist, borneColor = FindNearbyBorne(playerCoords)
            if borneCoords ~= nil and dist <= FiveCadeStreetWarsConfig.interactionDistance then
                sleep = 0
                local borneId = GetBorneIdFromCoords(borneCoords)
                local holderName = occupiedBornes[borneId]
                if holderName ~= nil then
                    DrawText3D(borneCoords + vector3(0.0, 0.0, 0.5), ("~r~Occupee~s~ (%s)"):format(holderName))
                else
                    DrawText3D(borneCoords + vector3(0.0, 0.0, 0.5), "~g~[E]~s~ Jouer")
                    if IsControlJustPressed(0, 38) and pendingLock == nil then -- INPUT_PICKUP (E)
                        pendingLock = { borneId = borneId, borneColor = borneColor }
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
