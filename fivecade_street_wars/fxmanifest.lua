fx_version 'cerulean'
game 'gta5'

author 'FiveCade'
description 'FiveCade - Borne Street Wars, Gang Wars Edition (bombes + conquete de territoire, 4 joueurs en ligne)'
version '0.1.0'

-- Verrou d'occupation des bornes (commun a toutes les bornes FiveCade).
-- Pas de classement sur cette borne : le module ne sert qu'au verrou.
dependency 'fivecade_highscore'

client_scripts {
    'client/config.lua',
    'client/main.lua'
}

-- Le moteur de jeu (html/sim.js) est partage : le serveur l'execute pour
-- les parties en ligne, la NUI pour les parties contre les CPU.
server_scripts {
    'html/sim.js',
    'server/main.js'
}

ui_page 'html/index.html'

files {
    'html/index.html',
    'html/phaser.min.js',
    'html/sim.js',
    'html/game.js',
    'html/audio.js',
    'html/music/menu.ogg',
    'html/music/game.ogg',
    'html/portraits.webp',
    'html/hud.webp',
    'html/city.webp',
    'html/home_bg.webp',
    'html/props.png',
    'html/chars_green.png',
    'html/chars_purple.png',
    'html/chars_yellow.png',
    'html/chars_blue.png',
    'html/bezel_green.webp',
    'html/bezel_purple.webp',
    'html/bezel_yellow.webp',
    'html/bezel_blue.webp'
}
