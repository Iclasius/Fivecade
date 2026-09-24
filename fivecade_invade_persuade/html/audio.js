/* ============================================================
 * Invade and Persuade - son (bruitages + musique), 100% genere par code
 * via Web Audio : aucun fichier audio, aucune licence a gerer.
 *
 * - Bruitages facon jsfxr (oscillateurs + bruit blanc + enveloppes),
 *   joues par FiveCadeSound.play(nom, { pan }) depuis game.js.
 * - Musique chiptune originale (La mineur, marche militaire arcade) :
 *   sequenceur a anticipation (planifie les notes ~120 ms en avance sur
 *   l'horloge audio, pas sur les timers JS, donc sans a-coups).
 *   Deux modes : 'menu' (basse + batterie, plus lent) et 'game'.
 *   Sert de secours : si html/music/*.mp3 existent (morceaux Suno), ils
 *   sont joues a la place (voir "musique en fichiers" plus bas).
 * - Touche M : coupe / remet le son.
 *
 * Le contexte audio est cree/relance au premier appui clavier (regle
 * d'autoplay du navigateur/CEF) et suspendu a la fermeture de la borne.
 * ============================================================ */
(function () {
  "use strict";

  var ctx = null, master = null, sfxBus = null, musicBus = null;
  var noiseBuf = null, pulseWave = null;
  var muted = false;
  try { muted = localStorage.getItem('fivecade_invade_muted') === '1'; } catch (e) { /* ignore */ }

  var MASTER_VOL = 0.65, SFX_VOL = 0.9, MUSIC_VOL = 0.42;
  // Musique chiptune de secours desactivee : juge desagreable a l'ecoute
  // par l'utilisateur ("ca fait mal au crane"). Sans fichiers dans
  // html/music/, la partie est sans musique (bruitages seuls). Remettre a
  // true pour la reactiver.
  var CHIP_MUSIC_FALLBACK = false;

  function ensureCtx() {
    if (ctx) return ctx;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    var comp = ctx.createDynamicsCompressor(); // evite la saturation quand tout explose en meme temps
    comp.threshold.value = -14; comp.knee.value = 12; comp.ratio.value = 6;
    comp.attack.value = 0.003; comp.release.value = 0.15;
    comp.connect(ctx.destination);
    master = ctx.createGain(); master.gain.value = muted ? 0 : MASTER_VOL; master.connect(comp);
    var soften = ctx.createBiquadFilter(); // retire les aigus stridents des ondes carrees
    soften.type = 'lowpass'; soften.frequency.value = 3200; soften.Q.value = 0.5;
    soften.connect(master);
    sfxBus = ctx.createGain(); sfxBus.gain.value = SFX_VOL; sfxBus.connect(soften);
    musicBus = ctx.createGain(); musicBus.gain.value = MUSIC_VOL; musicBus.connect(master);

    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    var d = noiseBuf.getChannelData(0);
    for (var i = 0; i < d.length; i += 1) d[i] = Math.random() * 2 - 1;

    // Onde "pulse" 25% (son NES typique) par serie de Fourier.
    var N = 32, real = new Float32Array(N), imag = new Float32Array(N);
    for (var n = 1; n < N; n += 1) real[n] = (2 / (n * Math.PI)) * Math.sin(n * Math.PI * 0.25);
    pulseWave = ctx.createPeriodicWave(real, imag);
    return ctx;
  }

  function resume() {
    if (!ensureCtx()) return;
    if (ctx.state === 'suspended') ctx.resume();
  }
  window.addEventListener('keydown', resume, true);
  window.addEventListener('pointerdown', resume, true);

  function now() { return ctx.currentTime; }

  /* ---------- briques de synthese ---------- */

  // Sortie d'un son : gain d'enveloppe -> panoramique -> bus.
  function out(dest, pan) {
    if (pan && ctx.createStereoPanner) {
      var p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      p.connect(dest);
      return p;
    }
    return dest;
  }

  // Note/balayage d'oscillateur : f0 -> f1 (exponentiel) sur dur.
  function tone(o) {
    var t = o.t !== undefined ? o.t : now();
    var osc = ctx.createOscillator();
    if (o.type === 'pulse') osc.setPeriodicWave(pulseWave); else osc.type = o.type || 'square';
    osc.frequency.setValueAtTime(o.f0, t);
    if (o.f1 && o.f1 !== o.f0) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f1), t + o.dur);
    var g = ctx.createGain();
    var vol = o.vol || 0.2, a = o.attack || 0.004;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + a);
    if (o.hold) g.gain.setValueAtTime(vol, t + a + o.hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    osc.connect(g); g.connect(out(o.dest || sfxBus, o.pan));
    osc.start(t); osc.stop(t + o.dur + 0.02);
  }

  // Bruit filtre (explosions, souffle, caisse claire...) avec balayage
  // optionnel de la frequence du filtre fr0 -> fr1.
  function noise(o) {
    var t = o.t !== undefined ? o.t : now();
    var src = ctx.createBufferSource();
    src.buffer = noiseBuf; src.loop = true;
    var f = ctx.createBiquadFilter();
    f.type = o.filter || 'lowpass';
    f.frequency.setValueAtTime(o.fr0 || 2000, t);
    if (o.fr1) f.frequency.exponentialRampToValueAtTime(o.fr1, t + o.dur);
    if (o.q) f.Q.value = o.q;
    var g = ctx.createGain();
    var vol = o.vol || 0.3;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + (o.attack || 0.003));
    if (o.hold) g.gain.setValueAtTime(vol, t + (o.attack || 0.003) + o.hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    src.connect(f); f.connect(g); g.connect(out(o.dest || sfxBus, o.pan));
    src.start(t, Math.random() * 0.5); src.stop(t + o.dur + 0.02);
  }

  // Voix synthetique : dent de scie (cordes vocales) filtree par des
  // formants (passe-bandes = la voyelle), glissando + vibrato.
  function voice(o) {
    var t = now(), dur = o.dur;
    var osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(o.f0, t);
    osc.frequency.exponentialRampToValueAtTime(o.f1, t + dur);
    var lfo = null;
    if (o.vib) {
      lfo = ctx.createOscillator(); lfo.frequency.value = o.vib;
      var lg = ctx.createGain(); lg.gain.value = o.vibAmt || 8;
      lfo.connect(lg); lg.connect(osc.frequency);
    }
    var env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(o.vol, t + (o.attack || 0.012));
    env.gain.setValueAtTime(o.vol, t + dur * (o.hold || 0.45));
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.formants.forEach(function (fm) {
      var bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = fm[0]; bp.Q.value = fm[1];
      var gg = ctx.createGain(); gg.gain.value = fm[2];
      osc.connect(bp); bp.connect(gg); gg.connect(env);
    });
    env.connect(out(sfxBus, o.pan));
    osc.start(t); osc.stop(t + dur + 0.05);
    if (lfo) { lfo.start(t); lfo.stop(t + dur + 0.05); }
  }

  var NOTE = {};
  (function () {
    var names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    for (var oct = 1; oct <= 7; oct += 1) {
      for (var i = 0; i < 12; i += 1) {
        NOTE[names[i] + oct] = 440 * Math.pow(2, ((oct - 4) * 12 + i - 9) / 12);
      }
    }
  })();

  // Petite melodie : liste de [note, duree] jouee a la suite.
  function jingle(notes, type, vol, step, pan) {
    var t = now();
    notes.forEach(function (n) {
      if (n[0]) tone({ t: t, f0: NOTE[n[0]], dur: n[1] * step * 0.95, type: type, vol: vol, hold: n[1] * step * 0.5, pan: pan });
      t += n[1] * step;
    });
  }

  /* ---------- catalogue de bruitages ---------- */
  var SFX = {
    shoot: function (p) {
      tone({ f0: 900, f1: 240, dur: 0.07, type: 'pulse', vol: 0.16, pan: p });
      noise({ fr0: 5000, fr1: 1500, dur: 0.04, vol: 0.08, filter: 'highpass', pan: p });
    },
    shootRapid: function (p) {
      tone({ f0: 1100, f1: 380, dur: 0.05, type: 'pulse', vol: 0.12, pan: p });
    },
    shotgun: function (p) {
      noise({ fr0: 3500, fr1: 300, dur: 0.28, vol: 0.55, pan: p });
      tone({ f0: 180, f1: 55, dur: 0.18, type: 'square', vol: 0.25, pan: p });
    },
    chaser: function (p) {
      tone({ f0: 500, f1: 1300, dur: 0.11, type: 'sawtooth', vol: 0.1, pan: p });
    },
    tankFire: function (p) {
      noise({ fr0: 1400, fr1: 70, dur: 0.6, vol: 0.85, pan: p });
      tone({ f0: 120, f1: 32, dur: 0.45, type: 'sine', vol: 0.9, pan: p });
      tone({ f0: 240, f1: 60, dur: 0.12, type: 'square', vol: 0.25, pan: p });
    },
    reloadReady: function (p) {
      tone({ f0: 1300, dur: 0.03, type: 'square', vol: 0.07, pan: p });
      tone({ t: now() + 0.06, f0: 1800, dur: 0.04, type: 'square', vol: 0.07, pan: p });
    },
    enemyShoot: function (p) {
      tone({ f0: 560, f1: 200, dur: 0.07, type: 'square', vol: 0.07, pan: p });
    },
    heavyShoot: function (p) {
      tone({ f0: 320, f1: 80, dur: 0.14, type: 'square', vol: 0.12, pan: p });
      noise({ fr0: 1800, fr1: 200, dur: 0.14, vol: 0.18, pan: p });
    },
    flyerShoot: function (p) {
      tone({ f0: 1400, f1: 600, dur: 0.07, type: 'sawtooth', vol: 0.06, pan: p });
    },
    hit: function (p) {
      tone({ f0: 1500, f1: 900, dur: 0.035, type: 'square', vol: 0.07, pan: p });
    },
    enemyDie: function (p) {
      tone({ f0: 420, f1: 70, dur: 0.2, type: 'square', vol: 0.12, pan: p });
      noise({ fr0: 2500, fr1: 300, dur: 0.12, vol: 0.12, pan: p });
    },
    heavyDie: function (p) {
      tone({ f0: 260, f1: 40, dur: 0.4, type: 'square', vol: 0.16, pan: p });
      noise({ fr0: 1500, fr1: 100, dur: 0.4, vol: 0.4, pan: p });
    },
    explosion: function (p) {
      noise({ fr0: 2200, fr1: 90, dur: 0.65, vol: 0.9, pan: p });
      tone({ f0: 90, f1: 28, dur: 0.5, type: 'sine', vol: 0.75, pan: p });
    },
    bigExplosion: function (p) {
      noise({ fr0: 3200, fr1: 50, dur: 1.3, vol: 1, hold: 0.08, pan: p });
      tone({ f0: 70, f1: 20, dur: 1.1, type: 'sine', vol: 1, pan: p });
      noise({ t: now() + 0.12, fr0: 900, fr1: 60, dur: 0.9, vol: 0.5, pan: p });
    },
    barrelHit: function (p) {
      tone({ f0: 1900, f1: 1700, dur: 0.05, type: 'square', vol: 0.08, pan: p });
      tone({ f0: 620, f1: 560, dur: 0.12, type: 'triangle', vol: 0.18, pan: p });
    },
    throw: function (p) {
      noise({ fr0: 400, fr1: 1800, dur: 0.18, vol: 0.45, filter: 'bandpass', q: 2, pan: p });
    },
    jump: function (p) {
      tone({ f0: 280, f1: 620, dur: 0.1, type: 'pulse', vol: 0.09, pan: p });
    },
    playerHurt: function (p) {
      // Bref grognement de douleur ("heuh !"), hauteur legerement variable
      // pour ne pas sonner repetitif, + petit choc sourd de l'impact.
      var k = 0.92 + Math.random() * 0.16;
      voice({ f0: 175 * k, f1: 112 * k, dur: 0.17, vol: 0.55, attack: 0.008, hold: 0.3,
        formants: [[520, 5, 1.0], [950, 7, 0.55], [2300, 9, 0.15]], pan: p });
      noise({ fr0: 900, fr1: 200, dur: 0.07, vol: 0.18, pan: p });
    },
    tankHit: function (p) {
      tone({ f0: 900, f1: 700, dur: 0.08, type: 'square', vol: 0.12, pan: p });
      noise({ fr0: 4000, fr1: 1200, dur: 0.12, vol: 0.2, filter: 'bandpass', q: 2, pan: p });
    },
    lifeLost: function () {
      // Cri de mort ("aaargh" qui retombe, avec tremolo) - bien distinct du
      // grognement de douleur - puis le petit jingle descendant.
      voice({ f0: 250, f1: 88, dur: 0.8, vol: 0.6, attack: 0.02, hold: 0.35, vib: 7, vibAmt: 14,
        formants: [[780, 5, 1.0], [1180, 6, 0.7], [2500, 9, 0.2]] });
      noise({ fr0: 1600, fr1: 500, dur: 0.6, vol: 0.08, filter: 'bandpass', q: 1.2 });
      var t0 = now();
      [['E5', 1], ['C5', 1], ['A4', 1], ['E4', 3]].reduce(function (t, n) {
        tone({ t: t, f0: NOTE[n[0]], dur: n[1] * 0.08 * 0.95, type: 'pulse', vol: 0.12, hold: n[1] * 0.04 });
        return t + n[1] * 0.08;
      }, t0 + 0.55);
    },
    coin: function (p) {
      tone({ f0: NOTE.B5, dur: 0.06, type: 'pulse', vol: 0.14, pan: p });
      tone({ t: now() + 0.06, f0: NOTE.E6, dur: 0.22, type: 'pulse', vol: 0.14, hold: 0.06, pan: p });
    },
    health: function () {
      jingle([['C5', 1], ['E5', 1], ['G5', 1], ['C6', 2]], 'triangle', 0.25, 0.055);
      jingle([['C5', 1], ['E5', 1], ['G5', 1], ['C6', 2]], 'pulse', 0.06, 0.055);
    },
    oneUp: function () {
      jingle([['C5', 1], ['G5', 1], ['C6', 1], ['E6', 1], ['G6', 4]], 'pulse', 0.15, 0.07);
    },
    weapon: function () {
      tone({ f0: 300, f1: 1200, dur: 0.22, type: 'sawtooth', vol: 0.1 });
      jingle([[null, 3], ['A5', 1], ['E6', 3]], 'pulse', 0.13, 0.06);
    },
    missileAlarm: function () {
      var t = now();
      for (var i = 0; i < 8; i += 1) {
        tone({ t: t + i * 0.18, f0: i % 2 ? 660 : 880, dur: 0.17, type: 'square', vol: 0.2, hold: 0.12 });
      }
    },
    missileWhistle: function (p, dur) {
      tone({ f0: 2200, f1: 450, dur: dur || 0.48, type: 'sine', vol: 0.16, attack: 0.05, hold: (dur || 0.48) * 0.6, pan: p });
    },
    reinforcements: function () {
      jingle([['E4', 1], ['E4', 1], ['A4', 3]], 'pulse', 0.12, 0.09);
    },
    planeFlyby: function (p, dur) {
      var d = dur || 4.5;
      tone({ f0: 55, f1: 48, dur: d, type: 'sawtooth', vol: 0.12, attack: d * 0.35, hold: d * 0.2 });
      noise({ fr0: 500, fr1: 300, dur: d, vol: 0.22, attack: d * 0.35, hold: d * 0.2 });
    },
    chuteOpen: function (p) {
      noise({ fr0: 700, fr1: 300, dur: 0.3, vol: 0.7, filter: 'bandpass', q: 1.2, pan: p });
    },
    tankLand: function (p) {
      tone({ f0: 95, f1: 38, dur: 0.35, type: 'sine', vol: 0.8, pan: p });
      noise({ fr0: 700, fr1: 90, dur: 0.4, vol: 0.5, pan: p });
    },
    tankBoard: function (p) {
      var t = now();
      [0, 0.12, 0.3].forEach(function (dt) { noise({ t: t + dt, fr0: 3000, dur: 0.04, vol: 0.2, filter: 'highpass', pan: p }); });
      tone({ t: t + 0.45, f0: 50, f1: 130, dur: 0.6, type: 'sawtooth', vol: 0.18, attack: 0.1, pan: p });
    },
    moose: function (p) {
      // Brame avant la charge de l'elan : signal sonore pour esquiver.
      tone({ f0: 150, f1: 95, dur: 0.5, type: 'sawtooth', vol: 0.16, attack: 0.05, hold: 0.25, pan: p });
      tone({ f0: 152, f1: 97, dur: 0.5, type: 'square', vol: 0.06, attack: 0.05, hold: 0.25, pan: p });
    },
    eject: function (p) {
      tone({ f0: 220, f1: 950, dur: 0.3, type: 'pulse', vol: 0.14, pan: p });
    },
    menuMove: function () {
      tone({ f0: 660, dur: 0.045, type: 'pulse', vol: 0.1 });
    },
    menuConfirm: function () {
      tone({ f0: 880, f1: 1320, dur: 0.14, type: 'pulse', vol: 0.12 });
    },
    gameOver: function () {
      jingle([['E5', 2], ['D5', 2], ['C5', 2], ['B4', 2], ['A4', 8]], 'pulse', 0.16, 0.12);
      jingle([['A2', 8], ['E2', 8]], 'triangle', 0.3, 0.12);
    }
  };

  // Anti-rafale : un meme bruitage n'est pas relance plus souvent que ca
  // (10 pandas qui tirent ensemble = un seul "pan", pas un mur de bruit).
  var MIN_GAP = { enemyShoot: 0.06, heavyShoot: 0.08, flyerShoot: 0.06, hit: 0.03, enemyDie: 0.04,
    explosion: 0.07, shoot: 0.03, shootRapid: 0.03, barrelHit: 0.03, coin: 0.04, playerHurt: 0.08 };
  var lastPlayed = {};

  function play(name, opts) {
    if (muted || !SFX[name]) return;
    if (!ensureCtx() || ctx.state !== 'running') return;
    var t = now();
    if (MIN_GAP[name] && lastPlayed[name] && t - lastPlayed[name] < MIN_GAP[name]) return;
    lastPlayed[name] = t;
    try { SFX[name](opts && opts.pan, opts && opts.dur); } catch (e) { /* jamais bloquer le jeu pour un son */ }
  }

  /* ---------- musique ---------- */
  // 16 mesures de 16 doubles-croches. Accords (basse) par mesure.
  var CHORDS = ['A', 'A', 'F', 'G', 'A', 'A', 'F', 'E', 'D', 'A', 'F', 'G', 'D', 'A', 'E', 'E'];
  var BASS_ROOT = { A: 'A2', F: 'F2', G: 'G2', E: 'E2', D: 'D2' };
  // Melodie : par mesure, [pas, note, duree en pas].
  var LEAD = [
    [[0, 'A4', 3], [3, 'C5', 1], [4, 'E5', 4], [8, 'D5', 2], [10, 'C5', 2], [12, 'B4', 2], [14, 'C5', 2]],
    [[0, 'A4', 6], [6, 'E4', 2], [8, 'A4', 2], [10, 'B4', 2], [12, 'C5', 4]],
    [[0, 'C5', 3], [3, 'A4', 1], [4, 'F5', 4], [8, 'E5', 2], [10, 'D5', 2], [12, 'C5', 4]],
    [[0, 'B4', 3], [3, 'G4', 1], [4, 'D5', 4], [8, 'C5', 2], [10, 'B4', 2], [12, 'G4', 4]],
    [[0, 'A4', 3], [3, 'C5', 1], [4, 'E5', 4], [8, 'D5', 2], [10, 'C5', 2], [12, 'B4', 2], [14, 'C5', 2]],
    [[0, 'A4', 4], [4, 'C5', 2], [6, 'E5', 2], [8, 'A5', 8]],
    [[0, 'A5', 2], [2, 'G5', 2], [4, 'F5', 4], [8, 'E5', 2], [10, 'D5', 2], [12, 'C5', 4]],
    [[0, 'B4', 4], [4, 'G#4', 4], [8, 'E4', 4], [12, 'G#4', 2], [14, 'B4', 2]],
    [[0, 'D5', 2], [2, 'F5', 2], [4, 'A5', 4], [8, 'G5', 2], [10, 'F5', 2], [12, 'E5', 4]],
    [[0, 'E5', 2], [2, 'C5', 2], [4, 'A4', 4], [8, 'C5', 2], [10, 'E5', 2], [12, 'A5', 4]],
    [[0, 'A5', 2], [2, 'G5', 2], [4, 'F5', 2], [6, 'E5', 2], [8, 'F5', 4], [12, 'C5', 4]],
    [[0, 'D5', 2], [2, 'E5', 2], [4, 'D5', 2], [6, 'B4', 2], [8, 'G4', 4], [12, 'B4', 4]],
    [[0, 'F5', 4], [4, 'E5', 2], [6, 'D5', 2], [8, 'A5', 6], [14, 'G5', 2]],
    [[0, 'E5', 4], [4, 'C5', 2], [6, 'A4', 2], [8, 'E5', 8]],
    [[0, 'E5', 2], [2, 'F5', 2], [4, 'E5', 2], [6, 'D5', 2], [8, 'C5', 2], [10, 'B4', 2], [12, 'A4', 2], [14, 'G#4', 2]],
    [[0, 'B4', 8], [8, 'E5', 4]]
  ];
  var BASS_PATTERN = [0, 2, 4, 6, 8, 10, 12, 14]; // croches
  var BASS_OCTAVE = { 4: 1, 10: 1, 14: 1 };       // pas joues a l'octave (pompe)
  var TOTAL_STEPS = 16 * 16;

  var music = { mode: null, timer: null, step: 0, next: 0 };

  function octaveUp(note) { return note.replace(/\d/, function (d) { return String(+d + 1); }); }

  function kick(t) { tone({ t: t, f0: 150, f1: 42, dur: 0.14, type: 'sine', vol: 0.85, dest: musicBus }); }
  function snare(t, v) {
    noise({ t: t, fr0: 1200, dur: 0.13, vol: v || 0.4, filter: 'highpass', dest: musicBus });
    tone({ t: t, f0: 190, f1: 150, dur: 0.07, type: 'triangle', vol: 0.3, dest: musicBus });
  }
  function hat(t) { noise({ t: t, fr0: 7500, dur: 0.035, vol: 0.12, filter: 'highpass', dest: musicBus }); }

  function playStep(step, t, stepDur) {
    var bar = Math.floor(step / 16), s = step % 16;
    var game = music.mode === 'game';
    // Batterie : grosse caisse sur les temps forts, caisse claire 2 et 4,
    // charleston sur les contretemps, roulement militaire en fin de phrase.
    var fill = game && (bar === 7 || bar === 15) && s >= 12;
    if (s === 0 || s === 8 || (game && s === 10 && bar % 2 === 1)) kick(t);
    if (fill) snare(t, 0.22 + (s - 12) * 0.06);
    else if (s === 4 || s === 12) snare(t);
    if (s % 2 === 1) hat(t);
    // Basse "pompe" en croches.
    if (BASS_PATTERN.indexOf(s) >= 0) {
      var root = BASS_ROOT[CHORDS[bar]];
      var n = BASS_OCTAVE[s] ? octaveUp(root) : root;
      tone({ t: t, f0: NOTE[n], dur: stepDur * 1.8, type: 'square', vol: 0.15, hold: stepDur, dest: musicBus });
    }
    // Melodie (partie de jeu uniquement).
    if (game) {
      LEAD[bar].forEach(function (ev) {
        if (ev[0] !== s) return;
        var d = ev[2] * stepDur;
        tone({ t: t, f0: NOTE[ev[1]], dur: d * 0.92, type: 'pulse', vol: 0.13, hold: d * 0.6, dest: musicBus });
        // Leger echo une octave dessous pour epaissir.
        tone({ t: t, f0: NOTE[ev[1]] / 2, dur: d * 0.9, type: 'triangle', vol: 0.08, hold: d * 0.6, dest: musicBus });
      });
    }
  }

  function schedule() {
    if (!ctx || ctx.state !== 'running') return;
    var stepDur = 60 / (music.mode === 'game' ? 150 : 112) / 4;
    // Onglet longtemps en pause (timer JS ralenti) : on se recale au lieu
    // de rattraper d'un coup toutes les notes en retard.
    if (music.next < now() - 0.25) music.next = now() + 0.05;
    while (music.next < now() + 0.12) {
      playStep(music.step, music.next, stepDur);
      music.next += stepDur;
      music.step = (music.step + 1) % TOTAL_STEPS;
    }
  }

  /* ---------- musique en fichiers ----------
   * html/music/menu.ogg       -> accueil, en boucle
   * html/music/level1.ogg, level2.ogg, level3.ogg... -> partie : chaque
   *   morceau tourne LOOPS_PER_TRACK fois, puis fondu vers le suivant, et on
   *   reboucle sur level1 (autant de morceaux que voulu, numerotes a la suite).
   * Morceaux composes et rendus par tools/invade_persuade_music.py (boucles
   * parfaites). Decodes en Web Audio et joues en AudioBuffer boucle : aucun
   * blanc a la jonction (contrairement a <audio loop>). Un .mp3 du meme nom
   * est accepte aussi. Passent par le meme graphe (touche M, compresseur). */
  var FILE_MUSIC_VOL = 0.55;
  var LOOPS_PER_TRACK = 3;
  var FADE_S = 1.2;
  var track = { mode: null, index: 1, src: null, gain: null, timer: null, token: 0 };
  var bufferCache = {};

  function loadTrack(name) { // -> Promise<AudioBuffer|null>
    if (bufferCache[name] !== undefined) return Promise.resolve(bufferCache[name]);
    function tryExt(exts) {
      if (!exts.length) return Promise.resolve(null);
      return fetch('music/' + name + '.' + exts[0])
        .then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.arrayBuffer(); })
        .then(function (ab) { return new Promise(function (res, rej) { ctx.decodeAudioData(ab, res, rej); }); })
        .catch(function () { return tryExt(exts.slice(1)); });
    }
    return tryExt(['ogg', 'mp3']).then(function (buf) { bufferCache[name] = buf; return buf; });
  }

  function fadeOutCurrent() {
    if (!ctx || !track.src) return;
    var src = track.src, g = track.gain, t = now();
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(Math.max(g.gain.value, 0.0001), t);
    g.gain.linearRampToValueAtTime(0.0001, t + FADE_S * 0.5);
    try { src.stop(t + FADE_S * 0.5 + 0.05); } catch (e) { /* deja arrete */ }
    track.src = null;
    track.gain = null;
  }

  function playTrack(i) {
    var token = ++track.token;
    var name = track.mode === 'menu' ? 'menu' : 'level' + i;
    loadTrack(name).then(function (buf) {
      if (token !== track.token || !track.mode) return; // arrete ou change entre-temps
      if (!buf) {
        if (track.mode === 'game' && i > 1) { playTrack(1); return; } // fin de la liste : on reboucle
        var m = track.mode;
        track.mode = null;
        if (CHIP_MUSIC_FALLBACK) startChip(m);
        return;
      }
      fadeOutCurrent();
      track.index = i;
      var src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      var g = ctx.createGain();
      var t = now();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(FILE_MUSIC_VOL, t + FADE_S);
      src.connect(g); g.connect(master);
      src.start(t);
      track.src = src;
      track.gain = g;
      if (track.timer) clearTimeout(track.timer);
      track.timer = null;
      if (track.mode === 'game') {
        track.timer = setTimeout(function () {
          if (token === track.token) playTrack(i + 1);
        }, Math.max(5, buf.duration * LOOPS_PER_TRACK - FADE_S) * 1000);
        loadTrack('level' + (i + 1)); // prechargement du suivant
      }
    });
  }

  function startMusic(mode) {
    if ((track.mode === mode) || (music.mode === mode && music.timer)) return;
    stopMusic();
    if (!ensureCtx()) return;
    track.mode = mode;
    playTrack(1);
  }

  function startChip(mode) {
    if (music.mode === mode && music.timer) return;
    stopChip();
    music.mode = mode;
    music.step = 0;
    music.next = now() + 0.08;
    musicBus.gain.cancelScheduledValues(now());
    musicBus.gain.setValueAtTime(MUSIC_VOL, now());
    music.timer = setInterval(schedule, 25);
  }

  function stopChip() {
    if (music.timer) clearInterval(music.timer);
    music.timer = null;
    music.mode = null;
  }

  function stopMusic() {
    stopChip();
    track.mode = null;
    track.token += 1;
    if (track.timer) clearTimeout(track.timer);
    track.timer = null;
    fadeOutCurrent();
  }

  function setMuted(m) {
    muted = m;
    try { localStorage.setItem('fivecade_invade_muted', m ? '1' : '0'); } catch (e) { /* ignore */ }
    if (master) master.gain.setTargetAtTime(m ? 0 : MASTER_VOL, now(), 0.02);
  }

  window.addEventListener('keydown', function (e) {
    if ((e.key === 'm' || e.key === 'M') && !(e.target && e.target.tagName === 'INPUT')) setMuted(!muted);
  });

  window.FiveCadeSound = {
    play: play,
    startMusic: startMusic,
    stopMusic: stopMusic,
    setMuted: setMuted,
    isMuted: function () { return muted; },
    resume: resume,
    suspend: function () { stopMusic(); if (ctx && ctx.state === 'running') ctx.suspend(); },
    // Diagnostic (tests en navigateur) : etat du contexte et de la musique.
    _debug: function () { return { ctx: ctx, master: master, music: music, track: track }; }
  };
})();
