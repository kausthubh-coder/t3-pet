// Animation poses for the T3 pet. Each animation is a pure function of time (seconds since it
// started) plus a small context, returning a pose for T3Sprite.drawPet together with effects,
// a vertical hop offset and how fast it needs to be redrawn. Shared by the overlay and preview.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.T3Anims = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

  // Blink roughly every 2.5-5 s, with an occasional double blink.
  function blinking(t, seed = 0) {
    const period = 3.6;
    const k = Math.floor(t / period);
    const off = hash(k + seed) * 2.2;
    const local = t - k * period - off;
    if (local >= 0 && local < 0.13) return true;
    if (hash(k * 3.1 + seed) > 0.72 && local >= 0.3 && local < 0.42) return true;
    return false;
  }

  const hang = (a = 0.2) => ({ a, len: 10 });
  const look = (c) => (c && c.look) || { x: 0, y: 0 };

  // Parabolic hop: returns height (art px) for t in [0, dur].
  const hop = (t, dur, h) => (t < 0 || t > dur ? 0 : 4 * h * (t / dur) * (1 - t / dur));

  const ANIMS = {
    idle(t, c) {
      const breath = Math.floor(t / 0.9) % 2;
      return {
        pose: {
          bob: breath, look: look(c),
          eyes: blinking(t, c && c.seed) ? 'blink' : 'open',
          mouth: 'smile',
          arms: { l: hang(0.2 + breath * 0.04), r: hang(0.2 + breath * 0.04) },
        },
        fps: 8,
      };
    },

    walk(t, c) {
      const ph = c && c.phase != null ? c.phase : t * 1.8;
      const facing = (c && c.facing) || 1;
      const sw = Math.sin(ph * TAU);
      const contact = Math.abs(Math.cos(ph * TAU)) > 0.7 ? 0 : 1;
      return {
        pose: {
          facing, bob: contact,
          eyes: blinking(t, c && c.seed) ? 'blink' : 'open',
          mouth: (c && c.mouth) || 'smile', brows: c && c.brows,
          arms: { l: hang(0.25 + sw * 0.35), r: hang(0.25 - sw * 0.35) },
          legs: { mode: 'walk', phase: ph, amp: 1.5, lift: 2 },
        },
        fps: 60, smooth: true,
      };
    },

    run(t, c) {
      const ph = c && c.phase != null ? c.phase : t * 3;
      const facing = (c && c.facing) || 1;
      const sw = Math.sin(ph * TAU);
      const contact = Math.abs(Math.cos(ph * TAU)) > 0.6 ? 0 : 1;
      return {
        pose: {
          facing, bob: contact, lean: facing, squash: contact ? 0.03 : -0.03,
          eyes: (c && c.eyes) || 'open', mouth: (c && c.mouth) || 'grin', brows: c && c.brows,
          arms: { l: { a: 0.9 + sw * 0.7, len: 9 }, r: { a: 0.9 - sw * 0.7, len: 9 } },
          legs: { mode: 'walk', phase: ph, amp: 2.5, lift: 3 },
        },
        fx: [{ type: 'runDust', t, dir: facing }],
        fps: 60, smooth: true,
      };
    },

    sleep(t) {
      const breath = Math.floor(t / 1.4) % 2;
      return {
        pose: {
          sit: true, bob: breath, squash: 0.03 + breath * 0.02,
          eyes: 'closed', mouth: breath ? 'o' : 'flat',
          arms: { l: hang(0.45), r: hang(0.45) },
        },
        fx: [{ type: 'z', t }],
        fps: 5,
      };
    },

    working(t, c) {
      const glance = (t % 6) > 5.1; // looks up at you now and then
      const typing = Math.floor(t * 7) % 2 + 1;
      return {
        pose: {
          sit: true, prop: 'laptop', glow: Math.floor(t * 2) % 2 === 0,
          look: glance ? look(c) : { x: 0, y: 1 },
          eyes: blinking(t, 5) ? 'blink' : 'open',
          brows: glance ? null : 'focus', mouth: glance ? 'smile' : 'flat',
          arms: { l: { a: -0.75, len: 5, front: true }, r: { a: -0.75, len: 5, front: true } },
          typing: glance ? 0 : typing,
        },
        fps: 10,
      };
    },

    waiting(t, c) {
      const cyc = t % 1.6;
      const h = hop(cyc, 0.4, 5);
      const pre = cyc > 1.45 ? 1 : 0; // anticipation crouch
      const land = cyc > 0.4 && cyc < 0.52 ? 1 : 0;
      const wave = Math.sin(t * 14);
      return {
        pose: {
          look: look(c), eyes: h > 0 ? 'wide' : blinking(t, 2) ? 'blink' : 'open', brows: 'up',
          mouth: h > 0 ? 'open' : 'o',
          squash: h > 0 ? -0.06 : (pre || land) ? 0.1 : 0, bob: pre || land,
          arms: { l: hang(0.3), r: { a: 2.55 + wave * 0.35, len: 10 } },
          legs: h > 0 ? { mode: 'dangle', swing: 0 } : null,
        },
        offsetY: h, fps: 60, smooth: true,
      };
    },

    done(t, c) {
      // anticipation, big jump, landing squash, a second little hop, then a happy loop
      let h = 0, squash = 0, bob = 0, air = false;
      if (t < 0.14) { squash = 0.14; bob = 2; }
      else if (t < 0.62) { h = hop(t - 0.14, 0.48, 13); squash = -0.08; air = true; }
      else if (t < 0.78) { const k = (t - 0.62) / 0.16; squash = 0.18 * (1 - k); bob = Math.round(2 * (1 - k)); }
      else if (t < 1.08) { h = hop(t - 0.78, 0.3, 5); squash = -0.04; air = true; }
      else if (t < 1.2) { squash = 0.08; bob = 1; }
      const settled = t >= 1.2;
      const arm = settled ? 2.3 + Math.sin(t * 6) * 0.2 : air ? 2.7 : 1.2;
      return {
        pose: {
          squash, bob: settled ? Math.floor(t / 0.5) % 2 : bob,
          eyes: 'happy', mouth: air ? 'open' : 'grin', blush: true,
          arms: { l: { a: arm, len: 10 }, r: { a: settled ? 2.3 - Math.sin(t * 6) * 0.2 : arm, len: 10 } },
          legs: air ? { mode: 'dangle', swing: 0, kick: Math.sin(t * 20) } : null,
        },
        offsetY: h,
        fx: [{ type: 'sparkles', t }].concat(t > 0.62 && t < 1.2 ? [{ type: 'dust', t: t - 0.62 }] : []),
        fps: settled ? 12 : 60, smooth: !settled,
      };
    },

    error(t, c) {
      const shake = t < 0.45 ? (Math.floor(t * 24) % 2 ? 1 : -1) : 0;
      const sigh = (t % 3) > 2.4 ? 1 : 0;
      return {
        pose: {
          shakeX: shake, bob: 1 + sigh, squash: 0.04 + sigh * 0.03,
          look: { x: 0, y: 1 }, eyes: t < 0.45 ? 'squint' : blinking(t, 7) ? 'blink' : 'open', brows: 'sad',
          mouth: t < 0.45 ? 'wobble' : 'frown',
          arms: { l: hang(0.06), r: hang(0.06) },
        },
        fx: [{ type: 'sweat', t: t % 2.2 }],
        fps: t < 0.5 ? 30 : 10, smooth: t < 0.5,
      };
    },

    picked(t, c) {
      const swing = clamp((c && c.swing) || 0, -1, 1);
      const flail = Math.sin(t * 16);
      return {
        pose: {
          squash: -0.07, eyes: 'wide', mouth: Math.abs(swing) > 0.4 ? 'open' : 'o', look: { x: -Math.round(swing), y: 1 },
          arms: { l: { a: 1.3 + flail * 0.3, len: 10 }, r: { a: 1.3 - flail * 0.3, len: 10 } },
          legs: { mode: 'dangle', swing: -swing, kick: Math.sin(t * 9) },
        },
        fps: 60, smooth: true,
      };
    },

    fall(t) {
      return {
        pose: {
          squash: -0.1, eyes: 'wide', mouth: 'open',
          arms: { l: { a: 2.6 + Math.sin(t * 25) * 0.2, len: 10 }, r: { a: 2.6 - Math.sin(t * 25) * 0.2, len: 10 } },
          legs: { mode: 'dangle', swing: 0, kick: Math.sin(t * 18) },
        },
        fps: 60, smooth: true,
      };
    },

    land(t, c) {
      // damped spring squash
      const s = 0.26 * Math.exp(-t * 7) * Math.cos(t * 20);
      return {
        pose: {
          squash: s, bob: Math.max(0, Math.round(s * 12)),
          eyes: t < 0.14 ? 'squint' : 'open', mouth: t < 0.14 ? 'flat' : 'smile', look: look(c),
          arms: { l: hang(0.2 + Math.max(0, s) * 4), r: hang(0.2 + Math.max(0, s) * 4) },
        },
        fx: [{ type: 'dust', t }],
        fps: 60, smooth: true,
      };
    },

    petted(t) {
      const s = 0.1 * Math.sin(t * 13) * Math.exp(-t * 2.2);
      return {
        pose: {
          squash: s, bob: s > 0.03 ? 1 : 0,
          eyes: 'happy', mouth: 'grin', blush: true,
          arms: { l: hang(0.55 + Math.sin(t * 10) * 0.15), r: hang(0.55 - Math.sin(t * 10) * 0.15) },
        },
        fx: [{ type: 'hearts', t }],
        fps: 30, smooth: true,
      };
    },

    wake(t, c) {
      const h = hop(t, 0.3, 4);
      return {
        pose: {
          eyes: 'wide', mouth: 'o', brows: 'up', squash: h > 0 ? -0.06 : t < 0.45 ? 0.08 : 0, look: look(c),
          arms: { l: { a: 1.0, len: 10 }, r: { a: 1.0, len: 10 } },
          legs: h > 0 ? { mode: 'dangle', swing: 0 } : null,
        },
        offsetY: h, fx: [{ type: 'bang', t }],
        fps: 60, smooth: true,
      };
    },
  };

  const DURATION = { petted: 1.6, land: 0.5, wake: 0.7 };

  function frame(name, t, ctx) {
    const fn = ANIMS[name] || ANIMS.idle;
    const f = fn(Math.max(0, t), ctx || {});
    f.offsetY = f.offsetY || 0;
    return f;
  }

  return { frame, names: Object.keys(ANIMS), DURATION, blinking };
});
