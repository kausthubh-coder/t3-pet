// Wires the PetController to the Electron main process (see preload.js).
(function () {
  'use strict';
  const api = window.petAPI;
  const body = document.body;
  let clickable = false;

  const pet = new window.PetController(document.getElementById('root'), {
    setClickable(on) {
      if (on === clickable) return;
      clickable = on;
      body.classList.toggle('grab', on);
      api.setClickable(on);
    },
    setAsleep(asleep) { api.setAsleep(asleep); },
  });

  api.on('display', (d) => pet.setBounds(d.width, d.height, d.reason));
  api.on('cursor', (c) => pet.pointer(c.x, c.y));
  api.on('status', (s) => pet.setStatus(s));
  api.on('paused', (p) => pet.setPaused(p));
  api.on('command', (cmd) => {
    if (cmd === 'sleep') pet.sleepNow();
    else if (cmd === 'pet') pet.pet();
  });

  // While click-through, Electron still forwards mouse moves to us, which makes hover snappy.
  window.addEventListener('mousemove', (e) => pet.pointer(e.clientX, e.clientY));
  window.addEventListener('mousedown', (e) => {
    if (e.button === 0 && pet.pointerDown()) body.classList.add('grabbing');
  });
  window.addEventListener('mouseup', () => { pet.pointerUp(); body.classList.remove('grabbing'); });
  window.addEventListener('blur', () => { pet.pointerUp(); body.classList.remove('grabbing'); });

  api.ready();
})();
