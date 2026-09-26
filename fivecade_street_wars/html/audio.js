/* ==========================================================================
 * Street Wars - son : musiques (music/*.ogg, generees par
 * tools/street_wars_music.py) et bruitages synthetises en direct (Web
 * Audio, aucun fichier). Volumes volontairement moderes, sons ronds
 * (sinus, triangles, bruit filtre) : rien de strident.
 * Touche M : couper / remettre le son.
 * ========================================================================== */
(function () {
  'use strict';

  var ctx = null, master = null, muted = false;
  var MUSIC_VOL = 0.32;
  var music = { name: null, el: null };
  var lastPlay = {};

  function ac() {
    if (!ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.55;
      // filtre general : coupe le haut du spectre (confort d'ecoute)
      var lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 7000;
      master.connect(lp); lp.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function tone(type, f0, f1, dur, vol, when) {
    var c = ac(); if (!c) return;
    var t = c.currentTime + (when || 0);
    var o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  var noiseBuf = null;
  function noise(dur, vol, filterType, freq, freqEnd, when) {
    var c = ac(); if (!c) return;
    if (!noiseBuf) {
      noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
      var d = noiseBuf.getChannelData(0);
      for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    var t = c.currentTime + (when || 0);
    var src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    src.buffer = noiseBuf; src.loop = true;
    f.type = filterType; f.frequency.setValueAtTime(freq, t);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t); src.stop(t + dur + 0.02);
  }

  /* Evite l'empilement quand beaucoup d'evenements arrivent ensemble. */
  function throttled(name, ms) {
    var now = performance.now();
    if (lastPlay[name] && now - lastPlay[name] < ms) return true;
    lastPlay[name] = now;
    return false;
  }

  var SFX = {
    move: function () { tone('sine', 700, 700, 0.05, 0.05); },
    select: function () { tone('triangle', 520, 520, 0.07, 0.08); tone('triangle', 780, 780, 0.1, 0.08, 0.06); },
    back: function () { tone('triangle', 600, 380, 0.12, 0.07); },
    lock: function () { [523, 659, 784].forEach(function (f, i) { tone('triangle', f, f, 0.12, 0.08, i * 0.06); }); },
    bomb: function () { if (throttled('bomb', 60)) return; tone('sine', 180, 90, 0.09, 0.18); noise(0.03, 0.05, 'highpass', 2500); },
    boom: function () {
      if (throttled('boom', 70)) return;
      noise(0.55, 0.32, 'lowpass', 900, 120);
      tone('sine', 110, 38, 0.45, 0.4);
    },
    crumble: function () { if (throttled('crumble', 90)) return; noise(0.35, 0.12, 'bandpass', 700, 250); tone('triangle', 140, 70, 0.2, 0.06, 0.05); },
    pick: function () { [659, 880, 1175].forEach(function (f, i) { tone('triangle', f, f, 0.09, 0.07, i * 0.05); }); },
    drop: function () { tone('triangle', 700, 400, 0.15, 0.06); },
    hit: function () { tone('triangle', 440, 140, 0.3, 0.14); noise(0.15, 0.06, 'lowpass', 1200); },
    elim: function () { tone('triangle', 520, 90, 0.7, 0.14); noise(0.5, 0.08, 'lowpass', 800, 150); },
    back_base: function () { tone('sine', 400, 800, 0.2, 0.06); },
    beep: function () { tone('sine', 520, 520, 0.14, 0.12); },
    go: function () { tone('triangle', 784, 784, 0.12, 0.12); tone('triangle', 1046, 1046, 0.25, 0.12, 0.1); },
    police: function () { // sirene deux tons, adoucie
      for (var i = 0; i < 4; i++) {
        tone('triangle', 620, 620, 0.32, 0.07, i * 0.34);
        tone('triangle', 830, 830, 0.32, 0.07, i * 0.34 + 0.17);
      }
    },
    barricade: function () { if (throttled('barricade', 150)) return; noise(0.25, 0.14, 'lowpass', 600, 150); tone('sine', 90, 50, 0.25, 0.2); },
    round: function () { [523, 659, 784, 1046].forEach(function (f, i) { tone('triangle', f, f, 0.18, 0.09, i * 0.09); }); },
    draw: function () { tone('triangle', 440, 330, 0.3, 0.08); tone('triangle', 330, 262, 0.35, 0.08, 0.25); },
    victory: function () {
      var notes = [523, 659, 784, 1046, 784, 1046, 1318];
      notes.forEach(function (f, i) { tone('triangle', f, f, i === notes.length - 1 ? 0.8 : 0.16, 0.1, i * 0.12); });
      tone('sine', 262, 262, 1.2, 0.08, 0.5);
    }
  };

  function playMusic(name) {
    if (music.name === name && music.el) return;
    stopMusic();
    var el = new Audio('music/' + name + '.ogg');
    el.loop = true;
    el.volume = muted ? 0 : MUSIC_VOL;
    var p = el.play();
    if (p && p.catch) p.catch(function () { /* lecture bloquee avant un geste du joueur */ });
    music = { name: name, el: el };
  }

  function stopMusic() {
    if (music.el) { music.el.pause(); music.el.src = ''; }
    music = { name: null, el: null };
  }

  window.SWSound = {
    sfx: function (name) { if (muted || !SFX[name]) return; try { SFX[name](); } catch (e) { /* audio indisponible */ } },
    music: playMusic,
    stopMusic: stopMusic,
    unlock: function () { ac(); if (music.el && music.el.paused) { var p = music.el.play(); if (p && p.catch) p.catch(function () {}); } },
    toggleMute: function () {
      muted = !muted;
      if (master) master.gain.value = muted ? 0 : 0.55;
      if (music.el) music.el.volume = muted ? 0 : MUSIC_VOL;
      return muted;
    },
    isMuted: function () { return muted; }
  };
})();
