fx_version 'cerulean'
game 'gta5'

author 'FiveCade'
description 'FiveCade - Borne Qub3d (puzzle de blocs, moteur Phaser)'
version '1.0.0'

dependency 'fivecade_highscore'

client_scripts {
    'client/config.lua',
    'client/main.lua'
}

ui_page 'html/index.html'

files {
    'html/index.html',
    'html/three.min.js',
    'html/phaser.min.js',
    'html/game.js',
    'html/menu-face.png',
    'html/bezel.png',
    'html/audio/gameplay-theme.mp3',
    'html/audio/gameplay-theme-2.mp3',
    'html/audio/gameplay-theme-3.mp3',
    'html/audio/gameplay-theme-4.mp3',
    'html/audio/gameplay-theme-5.mp3',
    'html/audio/game-over-jingle.mp3'
}
