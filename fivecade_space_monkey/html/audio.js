/* ============================================================
 * Space Monkey - bruitages 100% generes par code via Web Audio :
 * aucun fichier audio, aucune licence a gerer (meme demarche que les
 * autres bornes).
 * Musique : html/music/menu.ogg et game.ogg, composees par
 * resources/tools/space_monkey_music.py. Jouees en boucle par Web Audio
 * (AudioBufferSourceNode.loop) pour un enchainement sans blanc, ce que
 * l'element <audio loop> ne garantit pas.
 *
 * API : FiveCadeSound.play(nom), startMusic('menu'|'game'), stopMusic(),
 * resume(), suspend(), toggleMute().
 * Touche M : coupe / remet le son.
 * ============================================================ */
(function () {
  "use strict";

  var ctx = null, master = null, noiseBuf = null, musicBus = null;
  var MUSIC_VOL = 0.42; // la v2 de la musique est bien plus dense : un peu moins fort pour laisser passer les bruitages
  var musicBuffers = {}, musicLoading = {}, musicSrc = null, wantedMusic = null;
  var MASTER_VOL = 0.55;
  // Volume general regle par le joueur (volume.js, commun a toutes les bornes)
  function vf() { return window.FiveCadeVolume ? window.FiveCadeVolume.factor() : 1; }
  function applyVolume() {
    if (master) master.gain.value = MASTER_VOL * vf();
    if (musicBus) musicBus.gain.value = MUSIC_VOL * vf();
  }
  if (window.FiveCadeVolume) window.FiveCadeVolume.onChange(applyVolume);

  function ensureCtx() {
    if (ctx) return ctx;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    var comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 6;
    comp.connect(ctx.destination);
    var soften = ctx.createBiquadFilter();
    soften.type = 'lowpass'; soften.frequency.value = 3600;
    soften.connect(comp);
    master = ctx.createGain();
    master.gain.value = MASTER_VOL * vf();
    master.connect(soften);
    // la musique ne passe pas par le passe-bas des bruitages (deja douce)
    musicBus = ctx.createGain();
    musicBus.gain.value = MUSIC_VOL * vf();
    musicBus.connect(comp);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    var d = noiseBuf.getChannelData(0);
    for (var i = 0; i < d.length; i += 1) d[i] = Math.random() * 2 - 1;
    return ctx;
  }

  function resume() {
    if (!ensureCtx()) return;
    if (ctx.state === 'suspended') ctx.resume();
  }
  window.addEventListener('keydown', resume, true);
  window.addEventListener('pointerdown', resume, true);

  /* Une note : frequence qui glisse de f0 a f1, enveloppe attaque/chute. */
  function tone(type, f0, f1, dur, vol, delay) {
    var t = ctx.currentTime + (delay || 0);
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  /* Bruit filtre (explosions, souffle). */
  function noise(dur, vol, freq, delay) {
    var t = ctx.currentTime + (delay || 0);
    var src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = noiseBuf;
    f.type = 'lowpass';
    f.frequency.setValueAtTime(freq, t);
    f.frequency.exponentialRampToValueAtTime(80, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t); src.stop(t + dur + 0.02);
  }

  var SOUNDS = {
    flap: function () { tone('triangle', 260, 520, 0.09, 0.25); noise(0.06, 0.08, 2400); },
    banana: function (o) {
      // monte d'un cran avec le multiplicateur : l'oreille "sent" le combo
      var step = Math.min(4, (o && o.mult ? o.mult : 1) - 1);
      var base = 880 * Math.pow(1.12246, step * 2);
      tone('square', base, base, 0.06, 0.12);
      tone('square', base * 1.5, base * 1.5, 0.08, 0.1, 0.05);
    },
    golden: function () {
      [0, 4, 7, 12].forEach(function (s, i) {
        var f = 988 * Math.pow(2, s / 12);
        tone('square', f, f, 0.09, 0.12, i * 0.055);
      });
    },
    rotten: function () { tone('sawtooth', 330, 110, 0.3, 0.2); tone('square', 220, 90, 0.3, 0.1, 0.04); },
    comboUp: function () { tone('square', 660, 1320, 0.18, 0.14); },
    comboLost: function () { tone('triangle', 440, 220, 0.2, 0.14); },
    missed: function () { tone('triangle', 300, 240, 0.08, 0.06); },
    shieldGet: function () { tone('sine', 400, 1200, 0.35, 0.22); tone('triangle', 600, 1800, 0.35, 0.1, 0.05); },
    shieldBreak: function () { noise(0.35, 0.35, 5000); tone('square', 900, 200, 0.3, 0.12); },
    nuke: function () { noise(1.2, 0.6, 3000); tone('sawtooth', 120, 30, 1.0, 0.3); },
    dankAlarm: function () {
      for (var i = 0; i < 3; i += 1) {
        tone('square', 740, 740, 0.14, 0.12, i * 0.32);
        tone('square', 554, 554, 0.14, 0.12, i * 0.32 + 0.16);
      }
    },
    dankDrop: function () { tone('triangle', 500, 250, 0.12, 0.08); },
    zone: function () {
      [0, 5, 7, 12].forEach(function (s, i) {
        var f = 523 * Math.pow(2, s / 12);
        tone('triangle', f, f, 0.16, 0.16, i * 0.09);
      });
    },
    hit: function () { noise(0.6, 0.55, 2500); tone('square', 300, 60, 0.5, 0.2); },
    gameOver: function () {
      [0, -3, -7, -12].forEach(function (s, i) {
        var f = 440 * Math.pow(2, s / 12);
        tone('square', f, f * 0.98, 0.22, 0.14, 0.4 + i * 0.2);
      });
    },
    menuMove: function () { tone('square', 660, 660, 0.04, 0.08); },
    menuConfirm: function () { tone('square', 880, 1320, 0.1, 0.12); }
  };

  function loadMusic(name, then) {
    if (musicBuffers[name]) { then(); return; }
    if (musicLoading[name]) return;
    musicLoading[name] = true;
    fetch('music/' + name + '.ogg')
      .then(function (r) { return r.arrayBuffer(); })
      .then(function (data) { return ctx.decodeAudioData(data); })
      .then(function (buf) { musicBuffers[name] = buf; musicLoading[name] = false; then(); })
      .catch(function () { musicLoading[name] = false; /* fichier absent : pas de musique */ });
  }

  function stopMusic() {
    wantedMusic = null;
    if (musicSrc) {
      try { musicSrc.stop(); } catch (e) { /* deja arretee */ }
      musicSrc = null;
    }
  }

  function startMusic(name) {
    if (!ensureCtx()) return;
    if (wantedMusic === name && musicSrc) return;
    stopMusic();
    wantedMusic = name;
    loadMusic(name, function () {
      if (wantedMusic !== name || musicSrc) return; // on a change d'avis pendant le chargement
      var src = ctx.createBufferSource();
      src.buffer = musicBuffers[name];
      src.loop = true;
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(1, ctx.currentTime + 0.6); // petit fondu d'entree
      src.connect(g); g.connect(musicBus);
      src.start();
      musicSrc = src;
    });
  }

  window.FiveCadeSound = {
    startMusic: startMusic,
    stopMusic: stopMusic,
    play: function (name, opts) {
      if (vf() === 0 || !ensureCtx() || ctx.state !== 'running') return;
      var fn = SOUNDS[name];
      if (fn) fn(opts);
    },
    resume: resume,
    suspend: function () {
      stopMusic();
      if (ctx && ctx.state === 'running') ctx.suspend();
    },
    toggleMute: function () {
      // la touche M passe par le reglage commun (meme etat que le panneau VOLUME)
      return window.FiveCadeVolume ? window.FiveCadeVolume.toggleMute() : false;
    },
    isMuted: function () { return vf() === 0; },
    // etat de la musique (verification depuis la console)
    musicState: function () { return { wanted: wantedMusic, playing: !!musicSrc, ctx: ctx ? ctx.state : 'none' }; }
  };
})();
