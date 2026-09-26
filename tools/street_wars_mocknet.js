/* Faux serveur FiveM pour tester le mode en ligne de Street Wars dans un
 * navigateur, hors jeu. Charge par index.html UNIQUEMENT avec ?mocknet=1,
 * juste avant ../server/main.js (le vrai code serveur, sans modification).
 *
 * Page servie depuis D:\FiveCade\resources :
 *   /fivecade_street_wars/html/index.html?autoopen=1&mocknet=1
 * La page = joueur 1. Des faux joueurs se pilotent depuis la console :
 *   var ami = mockFriend(2); ami.send('join', {id: 1}); ami.send('lock', {gang: 'blue'});
 *   ami.inbox()  -> derniers messages recus par ce faux joueur
 *   ami.drop()   -> simule une deconnexion
 */
(function () {
  'use strict';
  var handlers = {}, dropHandlers = [], inbox = {};
  var names = { 1: 'Moi', 2: 'Ami', 3: 'Pote', 4: 'Cousin' };
  var LATENCY_MS = 30;

  window.onNet = function (name, fn) { handlers[name] = fn; };
  window.on = function (name, fn) { if (name === 'playerDropped') dropHandlers.push(fn); };
  window.GetPlayerName = function (src) { return names[src] || ('Joueur' + src); };

  window.emitNet = function (name, target, t, d) {
    var payload = JSON.parse(JSON.stringify(d)); // comme le vrai reseau : copie
    if (Number(target) === 1) {
      setTimeout(function () { window.postMessage({ type: 'sw', t: t, d: payload }, '*'); }, LATENCY_MS);
    } else {
      var box = inbox[target] = inbox[target] || [];
      box.push({ t: t, d: payload });
      if (box.length > 60) box.shift();
    }
  };

  function call(src, t, d) {
    window.source = src;
    handlers['fivecade_sw:c2s'](t, JSON.parse(JSON.stringify(d || {})));
  }

  window.SWMockNet = {
    fromClient: function (t, d) { setTimeout(function () { call(1, t, d); }, LATENCY_MS); }
  };

  window.mockFriend = function (src) {
    return {
      send: function (t, d) { call(src, t, d); },
      inbox: function () { return inbox[src] || []; },
      drop: function () { window.source = src; dropHandlers.forEach(function (f) { f(); }); }
    };
  };
})();
