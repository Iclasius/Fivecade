/* ============================================================
 * FiveCade - reglage du volume (module COMMUN a toutes les bornes)
 *
 * Regle FiveCade (demande utilisateur 2026-09-27) : chaque borne, passee
 * et future, propose sur sa page d'accueil une entree "VOLUME" pour
 * monter, baisser ou couper le son avant de lancer la partie. Ce fichier
 * est IDENTIQUE dans toutes les ressources fivecade_* : le modifier ici,
 * puis le recopier dans les autres bornes.
 *
 * - Niveau 0 a 10 + muet, memorises (localStorage, propre a chaque borne).
 * - Panneau HTML par-dessus l'ecran du jeu (#screen-wrap) : FLECHES pour
 *   regler, M / ENTREE / ESPACE pour couper-remettre, ECHAP / RETOUR pour
 *   refermer (sans quitter la borne), souris sur les boutons.
 * - Tant que le panneau est ouvert, il capte le clavier avant le jeu
 *   (ecouteur en phase de capture sur window).
 *
 * API :
 *   FiveCadeVolume.factor()      -> 0..1 a multiplier aux volumes du jeu
 *   FiveCadeVolume.onChange(fn)  -> fn(factor) a chaque changement
 *   FiveCadeVolume.open() / close() / isOpen()
 *   FiveCadeVolume.toggleMute()  -> touche M en jeu
 *   FiveCadeVolume.label()       -> "VOLUME 7/10" ou "SON COUPE"
 * ============================================================ */
(function () {
  "use strict";

  var KEY = 'fivecade_volume';
  var level = 10, muted = false;
  try {
    var saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved && typeof saved.level === 'number') {
      level = Math.max(0, Math.min(10, Math.round(saved.level)));
      muted = !!saved.muted;
    }
  } catch (e) { /* stockage indisponible : valeurs par defaut */ }

  var listeners = [];
  var panel = null, bars = [], stateEl = null, openFlag = false, onCloseCb = null;

  function factor() {
    if (muted || level === 0) return 0;
    return Math.pow(level / 10, 1.6); // courbe proche de l'oreille (les crans bas restent audibles mais doux)
  }

  function label() {
    return (muted || level === 0) ? 'SON COUPE' : 'VOLUME ' + level + '/10';
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify({ level: level, muted: muted })); } catch (e) { /* ignore */ }
  }

  function notify() {
    save();
    render();
    var f = factor();
    listeners.forEach(function (fn) { try { fn(f); } catch (e) { /* un ecouteur en erreur ne bloque pas les autres */ } });
  }

  function set(l) {
    level = Math.max(0, Math.min(10, l));
    if (level > 0) muted = false;
    notify();
  }

  function toggleMute() {
    if (level === 0) { level = 5; muted = false; } else { muted = !muted; }
    notify();
    return muted;
  }

  /* ---------------- panneau ---------------- */
  function injectCss() {
    var css = document.createElement('style');
    css.textContent =
      '#fc-volume{position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.6);z-index:5;font-family:"Courier New",monospace}' +
      '#fc-volume.visible{display:flex}' +
      '#fc-volume .box{background:#0b0716;border:3px solid var(--fc-accent,#ffd63a);border-radius:10px;padding:22px 30px;text-align:center;color:#fff;min-width:340px}' +
      '#fc-volume h2{margin:0 0 16px;font-size:24px;letter-spacing:.12em;color:var(--fc-accent,#ffd63a)}' +
      '#fc-volume .row{display:flex;align-items:center;justify-content:center;gap:12px}' +
      '#fc-volume button{font:bold 22px "Courier New",monospace;width:44px;height:40px;border-radius:6px;border:2px solid var(--fc-accent,#ffd63a);background:#1a1030;color:#fff;cursor:pointer}' +
      '#fc-volume button.mute{width:auto;padding:0 12px;font-size:15px;margin-top:14px}' +
      '#fc-volume .bars{display:flex;gap:4px;align-items:flex-end;height:40px}' +
      '#fc-volume .bars span{width:14px;background:#2a2340;border-radius:2px}' +
      '#fc-volume .bars span.on{background:var(--fc-accent,#ffd63a)}' +
      '#fc-volume .state{margin-top:12px;font-size:18px;font-weight:bold}' +
      '#fc-volume .hint{margin-top:14px;font-size:12px;opacity:.8}';
    document.head.appendChild(css);
  }

  function build() {
    if (panel) return;
    injectCss();
    panel = document.createElement('div');
    panel.id = 'fc-volume';
    panel.innerHTML =
      '<div class="box"><h2>VOLUME</h2>' +
      '<div class="row"><button class="minus" title="Baisser">-</button><div class="bars"></div><button class="plus" title="Monter">+</button></div>' +
      '<div class="state"></div>' +
      '<button class="mute">COUPER / REMETTRE</button>' +
      '<div class="hint">FLECHES regler  -  M ou ENTREE couper  -  ECHAP retour</div></div>';
    var barsEl = panel.querySelector('.bars');
    for (var i = 1; i <= 10; i += 1) {
      var b = document.createElement('span');
      b.style.height = (10 + i * 3) + 'px';
      barsEl.appendChild(b);
      bars.push(b);
    }
    stateEl = panel.querySelector('.state');
    panel.querySelector('.minus').addEventListener('click', function (e) { e.stopPropagation(); set(level - 1); });
    panel.querySelector('.plus').addEventListener('click', function (e) { e.stopPropagation(); set(level + 1); });
    panel.querySelector('.mute').addEventListener('click', function (e) { e.stopPropagation(); toggleMute(); });
    panel.addEventListener('click', function (e) { if (e.target === panel) close(); });
    var host = document.getElementById('screen-wrap') || document.body;
    host.appendChild(panel);
  }

  function render() {
    if (!panel) return;
    var shown = muted ? 0 : level;
    bars.forEach(function (b, i) { b.classList.toggle('on', i < shown); });
    stateEl.textContent = label();
  }

  function open(onClose) {
    build();
    onCloseCb = onClose || null;
    openFlag = true;
    render();
    panel.classList.add('visible');
  }

  function close() {
    if (!openFlag) return;
    openFlag = false;
    panel.classList.remove('visible');
    var cb = onCloseCb; onCloseCb = null;
    if (cb) { try { cb(); } catch (e) { /* ignore */ } }
  }

  // Clavier : capte AVANT le jeu tant que le panneau est ouvert.
  window.addEventListener('keydown', function (e) {
    if (!openFlag) return;
    var k = e.key;
    if (k === 'ArrowLeft' || k === 'ArrowDown' || k === '-') set(level - 1);
    else if (k === 'ArrowRight' || k === 'ArrowUp' || k === '+' || k === '=') set(level + 1);
    else if (k === 'm' || k === 'M' || k === 'Enter' || k === ' ') toggleMute();
    else if (k === 'Escape' || k === 'Backspace') close();
    e.preventDefault();
    e.stopImmediatePropagation();
  }, true);

  window.FiveCadeVolume = {
    factor: factor,
    label: label,
    onChange: function (fn) { listeners.push(fn); },
    set: set,
    change: function (d) { set(level + d); },
    toggleMute: toggleMute,
    open: open,
    close: close,
    isOpen: function () { return openFlag; }
  };
})();
