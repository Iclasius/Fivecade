fx_version 'cerulean'
game 'gta5'

author 'FiveCade'
description 'FiveCade - Borne Space Monkey (runner d esquive facon Flappy Bird, moteur Phaser)'
version '0.1.0'

dependency 'fivecade_highscore'

client_scripts {
    'client/config.lua',
    'client/main.lua'
}

ui_page 'html/index.html'

files {
    'html/index.html',
    'html/bezel.jpg',
    'html/menu_bg.jpg',
    'html/sprites/*.png',
    'html/music/*.ogg',
    'html/phaser.min.js',
    'html/game.js',
    'html/audio.js',
    'html/volume.js'
}
