-- FiveCade - Bornes statiques (natives dans une map/MLO)
--
-- Certaines bornes d'arcade peuvent deja exister "en dur" dans le decor
-- (posees par une map/MLO telechargee), sans avoir ete placees via
-- arcadem_devtools_propplacer. La detection habituelle (scanner les
-- objets dynamiques GetGamePool('CObject') par modele, voir client/main.lua
-- de chaque borne) ne les trouve pas : un prop statique de map n'est pas
-- un CObject dynamique.
--
-- Ce module offre une alternative independante du modele : un admin se
-- place pres de la borne native en jeu et l'enregistre par coordonnees
-- exactes via une commande. Volontairement PAS de scan automatique par
-- modele sur toute la carte (une MLO peut reutiliser le meme modele pour
-- de la pure deco, un scan automatique risquerait de rendre jouable un
-- objet qui n'est pas une vraie borne).
--
-- Reutilisable par n'importe quelle ressource FiveCade : la cle de
-- stockage est indexee par nom de ressource (chaque borne gere sa propre
-- liste), le point enregistre porte en plus un "borneType" optionnel
-- pour les bornes a plusieurs DA (ex: Degenatron/Penetrator).

local KVP_PREFIX = "fivecade_staticbornes_"

local function KvpKey(resourceName)
    return KVP_PREFIX .. tostring(resourceName)
end

local function LoadStatic(resourceName)
    local raw = GetResourceKvpString(KvpKey(resourceName))
    if not raw then
        return {}
    end
    local ok, decoded = pcall(json.decode, raw)
    if not ok or type(decoded) ~= "table" then
        return {}
    end
    return decoded
end

local function SaveStatic(resourceName, list)
    SetResourceKvp(KvpKey(resourceName), json.encode(list))
end

local function Notify(src, msg)
    TriggerClientEvent("chat:addMessage", src, { args = { "^3FiveCade", msg } })
end

--------------------------------------------------------------------------
-- Commandes admin (restreintes via l'ACE standard "command.<nom>" grace
-- au 3e argument `true` de RegisterCommand - pas de systeme de
-- permission maison, on reste sur le mecanisme natif FiveM. Donner
-- l'ACE via server.cfg, ex:
--   add_ace group.admin command.fivecade_registerstatic allow
--   add_ace group.admin command.fivecade_liststatic allow
--   add_ace group.admin command.fivecade_removestatic allow
--------------------------------------------------------------------------

RegisterCommand("fivecade_registerstatic", function(source, args)
    local src = source
    if src == 0 then
        print("[fivecade_staticbornes] a executer en jeu (pres de la borne), pas depuis la console serveur")
        return
    end
    local resourceName = args[1]
    if not resourceName then
        Notify(src, "Usage: /fivecade_registerstatic <nom_ressource> [borneType]")
        return
    end
    local borneType = args[2] -- optionnel, utile pour les bornes multi-DA (Degenatron/Penetrator)

    local ped = GetPlayerPed(src)
    local coords = GetEntityCoords(ped)
    local heading = GetEntityHeading(ped)

    local list = LoadStatic(resourceName)
    table.insert(list, {
        x = coords.x, y = coords.y, z = coords.z, heading = heading,
        borneType = borneType,
    })
    SaveStatic(resourceName, list)
    Notify(src, ("Borne statique enregistree pour '%s' (%d au total)."):format(resourceName, #list))
end, true)

RegisterCommand("fivecade_liststatic", function(source, args)
    local src = source
    local resourceName = args[1]
    if not resourceName then
        Notify(src, "Usage: /fivecade_liststatic <nom_ressource>")
        return
    end
    local list = LoadStatic(resourceName)
    if #list == 0 then
        Notify(src, ("Aucune borne statique enregistree pour '%s'."):format(resourceName))
        return
    end
    for i, entry in ipairs(list) do
        Notify(src, ("[%d] x=%.1f y=%.1f z=%.1f%s"):format(
            i, entry.x, entry.y, entry.z,
            entry.borneType and (" type=" .. entry.borneType) or ""
        ))
    end
end, true)

RegisterCommand("fivecade_removestatic", function(source, args)
    local src = source
    local resourceName = args[1]
    local index = tonumber(args[2])
    if not resourceName or not index then
        Notify(src, "Usage: /fivecade_removestatic <nom_ressource> <index (voir /fivecade_liststatic)>")
        return
    end
    local list = LoadStatic(resourceName)
    if not list[index] then
        Notify(src, "Index invalide.")
        return
    end
    table.remove(list, index)
    SaveStatic(resourceName, list)
    Notify(src, ("Borne statique #%d retiree de '%s' (%d restantes)."):format(index, resourceName, #list))
end, true)

--------------------------------------------------------------------------
-- API pour les ressources borne (client/main.lua de chaque borne
-- demande sa propre liste au demarrage, voir la fonction partagee dans
-- chaque borne).
--------------------------------------------------------------------------
RegisterNetEvent("fivecade:requestStaticBornes")
AddEventHandler("fivecade:requestStaticBornes", function(resourceName)
    local src = source
    TriggerClientEvent("fivecade:staticBornesLoaded", src, resourceName, LoadStatic(resourceName))
end)
