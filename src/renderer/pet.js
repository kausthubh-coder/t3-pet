// PetController: behaviour + rendering for the pet inside a container element.
// Used by the Electron overlay (full-screen transparent window) and by preview.html's playground.
// Coordinates are CSS px relative to the container; the host feeds it cursor positions.
(function () {
  'use strict';
  const S = window.T3Sprite, A = window.T3Anims;

  // Art canvas: the pet's feet sit on row AY, body centred on column AX.
  const W = 64, H = 80, AX = 31, AY = 76;
  const SH_W = 44, SH_H = 8;

  const CFG = {
    stopDist: 70, // how close (CSS px at 3x) the pet gets to the cursor
    startDist: 130, // cursor must be at least this far away before it sets off
    walkSpeed: 150,
    runSpeed: 540,
    runAbove: 420, // distance at which it starts running
    gravity: 2600,
    sleepAfter: 30000, // ms without cursor movement
    captionMs: 4500,
    footPad: 2,
    hurtFloorSpeed: 1250, // landing faster than this (px/s at 3x) hurts: a drop from ~1/3 of a 1080p screen
    hurtWallSpeed: 650, // hitting a screen edge faster than this hurts
    pokeWindow: 1200, // ms; 3 clicks inside it make him cry, 5 knock him out
    bandageMs: 20000,
    grumpyMs: 7000,
  };

  const LABEL = { working: 'working', waiting: 'waiting on you', done: 'done', error: 'error' };

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function el(tag, cls) {
    const e = document.createElement(tag);
    e.className = cls;
    e.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;image-rendering:pixelated;will-change:transform;';
    return e;
  }

  class PetController {
    constructor(root, host = {}) {
      this.root = root;
      this.host = host;
      this.shadow = el('canvas', 't3-shadow');
      this.stage = el('canvas', 't3-stage');
      this.bubbleWrap = el('div', 't3-bubble');
      this.bubble = document.createElement('canvas');
      this.bubble.style.cssText = 'display:block;image-rendering:pixelated;transform-origin:50% 100%;';
      this.bubbleWrap.appendChild(this.bubble);
      this.shadow.width = SH_W; this.shadow.height = SH_H;
      this.stage.width = W; this.stage.height = H;
      root.append(this.shadow, this.stage, this.bubbleWrap);
      this.sctx = this.stage.getContext('2d');
      this.shctx = this.shadow.getContext('2d');
      this.bctx = this.bubble.getContext('2d');
      this.buf = new S.Pix(W, H);
      this.shbuf = new S.Pix(SH_W, SH_H);

      this.w = 800; this.h = 600;
      this.x = 400; this.alt = 0; this.vx = 0; this.vy = 0;
      this.mode = 'ground';
      this.cursor = { x: 0, y: 0, has: false, movedAt: performance.now() };
      this.status = { state: 'idle', title: '', key: '', since: 0 };
      this.captionUntil = 0;
      this.paused = false;
      this.asleep = false; this.sleepSince = 0;
      this.timers = { land: Infinity, wake: Infinity, petted: Infinity, hurt: Infinity, ouch: Infinity, drag: 0, fall: 0 };
      this.hurtSide = 0; this.hurtAt = -Infinity; this.grumpyUntil = 0; this.pokes = [];
      this.facing = 0; this.faceHold = 0; this.phase = 0;
      this.chasing = false; this.running = false;
      this.hover = false; this.drag = null;
      this.seed = Math.random() * 100;
      this.last = performance.now();
      this.raf = 0; this.timer = 0;
      this.frame = null;
      this.bubbleKey = '';
      this.kick();
    }

    // ---- host API ---------------------------------------------------------------------
    setBounds(w, h, reason) {
      const first = !this.sized;
      this.w = w; this.h = h; this.sized = true;
      if (first || reason === 'switch') {
        // drop in from above, near the cursor if we know where it is
        const tx = this.cursor.has ? this.cursor.x - CFG.stopDist * this.k() : w * 0.72;
        this.x = clamp(tx, 40, w - 40);
        this.alt = Math.min(h * 0.55, 420);
        this.vy = 0; this.vx = 0;
        this.mode = 'fall'; this.timers.fall = 0;
        this.wakeUp(false);
      } else {
        this.x = clamp(this.x, 30, w - 30);
      }
      this.kick();
    }

    pointer(x, y) {
      const c = this.cursor;
      if (!c.has || Math.abs(x - c.x) + Math.abs(y - c.y) > 2) {
        c.movedAt = performance.now();
        if (this.asleep) this.wakeUp(true);
      }
      c.x = x; c.y = y; c.has = true;
      this.updateHover();
      this.kick();
    }

    pointerDown() {
      if (!this.hover || this.mode === 'drag') return false;
      const feetY = this.groundY() - this.alt;
      this.drag = { gx: this.cursor.x - this.x, gy: this.cursor.y - feetY, sx: this.cursor.x, sy: this.cursor.y, at: performance.now(), moved: false, vx: 0, vy: 0, px: this.x, palt: this.alt, swing: 0 };
      this.prevMode = this.mode;
      this.mode = 'drag'; this.timers.drag = 0;
      if (this.asleep) this.wakeUp(false);
      this.host.setClickable && this.host.setClickable(true);
      this.kick();
      return true;
    }

    pointerUp() {
      const d = this.drag;
      if (!d) return;
      this.drag = null;
      const quick = performance.now() - d.at < 400;
      if (!d.moved && quick) {
        this.mode = d.palt > 1 ? 'fall' : 'ground';
        this.x = d.px; this.alt = d.palt; this.vy = 0;
        this.poke();
      } else {
        this.mode = 'fall'; this.timers.fall = 0;
        this.vx = clamp(d.vx * 0.6, -1400, 1400);
        this.vy = clamp(-d.vy * 0.5, -600, 900);
      }
      this.updateHover();
      this.kick();
    }

    setStatus(s) {
      const state = (s && s.state) || 'idle';
      const key = (s && s.key) || state + ':' + ((s && s.title) || '');
      if (key !== this.status.key || state !== this.status.state) {
        const changed = state !== this.status.state;
        this.status = { state, title: (s && s.title) || '', key, since: performance.now() };
        if (state !== 'idle') this.captionUntil = performance.now() + CFG.captionMs;
        if (changed) this.popBubble();
        if (state !== 'idle' && this.asleep) this.wakeUp(true);
      }
      this.kick();
    }

    setPaused(p) { this.paused = !!p; this.kick(); }

    pet() {
      this.timers.petted = 0;
      this.grumpyUntil = 0; // a pet ends the sulk; the bandage stays
      if (this.asleep) this.wakeUp(false);
      this.kick();
    }

    // A click: gentle ones are pets; too many in a row make him cry, then knock him out.
    poke() {
      const now = performance.now();
      this.pokes = this.pokes.filter((t) => now - t < CFG.pokeWindow);
      this.pokes.push(now);
      if (this.pokes.length >= 5) { this.pokes = []; this.bonk(0); }
      else if (this.pokes.length >= 3) { this.timers.ouch = 0; this.timers.petted = Infinity; this.wakeUp(false); this.kick(); }
      else this.pet();
    }

    // Hit something hard: side -1/1 = a screen edge, 0 = the floor (or poked senseless).
    bonk(side) {
      const T = this.timers;
      T.hurt = 0; T.ouch = Infinity; T.petted = Infinity; T.land = Infinity;
      this.hurtSide = side; this.hurtAt = performance.now();
      this.grumpyUntil = this.hurtAt + CFG.grumpyMs;
      if (this.asleep) this.wakeUp(false);
      this.kick();
    }

    sleepNow() {
      if (this.mode !== 'ground') return;
      this.asleep = true; this.sleepSince = performance.now();
      this.chasing = false; this.vx = 0;
      this.host.setAsleep && this.host.setAsleep(true);
      this.kick();
    }

    // ---- internals --------------------------------------------------------------------
    k() { return this.u() / 3; } // distance scale relative to the 3x design size
    u() {
      const dpr = window.devicePixelRatio || 1;
      const base = this.host.scale ? this.host.scale() : 3;
      const dev = Math.max(2, Math.round(base * dpr));
      return dev / dpr;
    }
    snap(v) { const dpr = window.devicePixelRatio || 1; return Math.round(v * dpr) / dpr; }
    groundY() { return this.h - CFG.footPad; }

    wakeUp(startle) {
      const was = this.asleep;
      this.asleep = false;
      this.cursor.movedAt = performance.now();
      if (was) {
        if (startle) this.timers.wake = 0;
        this.host.setAsleep && this.host.setAsleep(false);
      }
    }

    popBubble() {
      const b = this.bubble;
      if (!b.animate) return;
      b.animate([{ transform: 'scale(0.4)' }, { transform: 'scale(1.12)' }, { transform: 'scale(1)' }], { duration: 220, easing: 'ease-out' });
    }

    petBox() {
      const u = this.u();
      const feetY = this.groundY() - this.alt - (this.frame ? this.frame.offsetY * u : 0);
      return { l: this.x - 17 * u, r: this.x + 17 * u, t: feetY - 37 * u, b: feetY + u };
    }

    updateHover() {
      if (!this.cursor.has) return;
      const b = this.petBox();
      const c = this.cursor;
      const hover = this.mode === 'drag' || (c.x >= b.l && c.x <= b.r && c.y >= b.t && c.y <= b.b);
      if (hover !== this.hover) {
        this.hover = hover;
        this.host.setClickable && this.host.setClickable(hover);
        if (hover && this.status.state !== 'idle') this.captionUntil = Infinity;
        else if (!hover && this.captionUntil === Infinity) this.captionUntil = performance.now() + 1500;
      }
    }

    busyAnim() {
      const t = this.timers;
      if (t.land < A.DURATION.land || t.wake < A.DURATION.wake || t.petted < A.DURATION.petted) return true;
      if (t.hurt < A.DURATION.hurt + A.DURATION.dizzy || t.ouch < A.DURATION.ouch) return true;
      if (this.status.state === 'done' && (performance.now() - this.status.since) / 1000 < 1.2) return true;
      return false;
    }

    update(dt, now) {
      const T = this.timers;
      for (const k of ['land', 'wake', 'petted', 'hurt', 'ouch', 'drag', 'fall']) T[k] += dt;
      const u = this.u(), k = u / 3;
      const ground = this.groundY();
      const c = this.cursor;

      if (this.mode === 'drag' && this.drag) {
        const d = this.drag;
        const nx = c.x - d.gx;
        const nalt = Math.max(0, ground - (c.y - d.gy));
        if (Math.abs(c.x - d.sx) + Math.abs(c.y - d.sy) > 5) d.moved = true;
        const ivx = (nx - this.x) / Math.max(dt, 1 / 240), ivy = (nalt - this.alt) / Math.max(dt, 1 / 240);
        const a = 1 - Math.exp(-dt * 14);
        d.vx += (ivx - d.vx) * a; d.vy += (-ivy - d.vy) * a;
        d.swing += (clamp(d.vx / 700, -1, 1) - d.swing) * (1 - Math.exp(-dt * 8));
        this.x = clamp(nx, 10, this.w - 10); this.alt = nalt;
        this.vx = 0;
        return;
      }

      if (this.mode === 'fall') {
        this.vy -= CFG.gravity * dt; // vy: upward speed
        this.alt += this.vy * dt;
        this.x += this.vx * dt;
        this.vx *= Math.exp(-dt * 0.8);
        for (const side of [-1, 1]) {
          const edge = side < 0 ? 20 * k : this.w - 20 * k;
          if (side * (this.x - edge) <= 0) continue;
          if (Math.abs(this.vx) > CFG.hurtWallSpeed * k && T.hurt > 0.5) this.bonk(side);
          this.x = edge; this.vx = -side * Math.abs(this.vx) * 0.5;
        }
        if (this.alt <= 0) {
          const impact = -this.vy;
          this.alt = 0; this.vy = 0; this.vx *= 0.25;
          this.mode = 'ground';
          if (impact > CFG.hurtFloorSpeed * k && T.hurt > 0.5) this.bonk(0);
          else if (T.hurt > A.DURATION.hurt) T.land = 0;
        }
        return;
      }

      // on the ground: sleep / wake
      const st = this.status.state;
      const idleFor = now - c.movedAt;
      if (!this.asleep && st === 'idle' && !this.chasing && Math.abs(this.vx) < 1 && idleFor > CFG.sleepAfter && !this.busyAnim()) {
        this.asleep = true; this.sleepSince = now;
        this.host.setAsleep && this.host.setAsleep(true);
      }

      // follow the cursor horizontally, keeping a little distance
      let desired = 0;
      const canMove = !this.paused && !this.asleep && c.has && !this.busyAnim() && !this.hover;
      if (canMove) {
        const dx = c.x - this.x;
        const side = dx > 0 ? -1 : 1; // which side of the cursor we're on
        const goal = clamp(c.x + side * CFG.stopDist * k, 24 * k, this.w - 24 * k);
        const err = goal - this.x;
        if (!this.chasing && Math.abs(dx) > CFG.startDist * k && Math.abs(err) > 6) this.chasing = true;
        if (this.chasing) {
          this.running = Math.abs(err) > (this.running ? 160 : CFG.runAbove) * k;
          const vmax = (this.running ? CFG.runSpeed : CFG.walkSpeed) * k;
          desired = clamp(err * 3.2, -vmax, vmax);
          if (Math.abs(err) < 2 && Math.abs(this.vx) < 20 * k) { this.chasing = false; desired = 0; }
        }
      } else this.chasing = false;
      if (!this.chasing) this.running = false;
      this.vx += (desired - this.vx) * (1 - Math.exp(-dt * 7));
      if (!this.chasing && Math.abs(this.vx) < 2) this.vx = 0;
      this.x = clamp(this.x + this.vx * dt, 16 * k, this.w - 16 * k);

      const stride = (this.running ? 20 : 14) * u;
      this.phase = (this.phase + (Math.abs(this.vx) * dt) / stride) % 1;
      if (Math.abs(this.vx) > 25 * k) { this.facing = Math.sign(this.vx); this.faceHold = 0.25; }
      else if ((this.faceHold -= dt) <= 0) this.facing = 0;
    }

    pickAnim(now) {
      const T = this.timers;
      const st = this.status.state;
      const u = this.u();
      const c = this.cursor;
      const feetY = this.groundY() - this.alt;
      const look = c.has ? {
        x: clamp((c.x - this.x) / (90 * u / 3), -1, 1) * 0.99,
        y: c.y < feetY - 60 * u ? -1 : c.y > feetY + 4 * u ? 1 : 0,
      } : { x: 0, y: 0 };
      const ctx = { look, facing: this.facing, phase: this.phase, seed: this.seed };
      if (this.mode === 'drag') return ['picked', T.drag, Object.assign(ctx, { swing: this.drag ? this.drag.swing : 0 })];
      if (T.hurt < A.DURATION.hurt) return ['hurt', T.hurt, Object.assign(ctx, { side: this.hurtSide })];
      if (this.mode === 'fall') return ['fall', T.fall, ctx];
      if (T.hurt < A.DURATION.hurt + A.DURATION.dizzy) return ['dizzy', T.hurt - A.DURATION.hurt, ctx];
      if (T.ouch < A.DURATION.ouch) return ['ouch', T.ouch, ctx];
      if (T.land < A.DURATION.land) return ['land', T.land, ctx];
      if (T.wake < A.DURATION.wake) return ['wake', T.wake, ctx];
      if (T.petted < A.DURATION.petted) return ['petted', T.petted, ctx];
      if (this.asleep) return ['sleep', (now - this.sleepSince) / 1000, ctx];
      if (Math.abs(this.vx) > 12 && this.facing) {
        if (st === 'error') Object.assign(ctx, { brows: 'sad', mouth: 'frown' });
        else if (st === 'waiting') Object.assign(ctx, { brows: 'up', mouth: 'o' });
        else if (st === 'working') Object.assign(ctx, { brows: 'focus', mouth: 'flat' });
        return [this.running ? 'run' : 'walk', now / 1000, ctx];
      }
      const since = (now - this.status.since) / 1000;
      if (st === 'working' || st === 'waiting' || st === 'done' || st === 'error') return [st, since, ctx];
      return ['idle', now / 1000, ctx];
    }

    render(now) {
      const u = this.u();
      const [name, t, ctx] = this.pickAnim(now);
      const f = A.frame(name, t, ctx);
      // after a hurt: bandage for a while, and a sulky face when he's just standing around
      const since = now - this.hurtAt;
      if (since < CFG.bandageMs) f.pose.bandage = true;
      if (now < this.grumpyUntil && name === 'idle') { f.pose.brows = 'focus'; f.pose.mouth = 'frown'; }
      this.frame = f;
      const sit = !!f.pose.sit;

      // pet
      const buf = this.buf;
      buf.clear();
      const info = S.drawPet(buf, f.pose, AX, AY);
      info.ground = AY;
      S.drawFx(buf, f.fx, info);
      buf.toCanvas(this.sctx);

      const ground = this.groundY();
      const lift = f.offsetY * u;
      const left = this.snap(this.x - (AX + 0.5) * u);
      const top = this.snap(ground - this.alt - lift - AY * u);
      this.stage.style.width = W * u + 'px';
      this.stage.style.height = H * u + 'px';
      this.stage.style.transform = `translate3d(${left}px,${top}px,0)`;

      // shadow stays on the ground
      const sb = this.shbuf;
      sb.clear();
      S.drawShadow(sb, SH_W / 2, SH_H / 2, sit ? 36 : 30 + Math.max(0, f.pose.squash || 0) * 30, (this.alt + lift) / u);
      sb.toCanvas(this.shctx);
      this.shadow.style.width = SH_W * u + 'px';
      this.shadow.style.height = SH_H * u + 'px';
      this.shadow.style.transform = `translate3d(${this.snap(this.x - (SH_W / 2) * u)}px,${this.snap(ground - (SH_H / 2 + 1.5) * u)}px,0)`;

      // bubble
      const st = this.status.state;
      const showBubble = st !== 'idle' && !this.asleep;
      if (!showBubble) {
        this.bubbleWrap.style.display = 'none';
        this.bubbleKey = '';
      } else {
        const captionOn = this.status.title && (this.hover || now < this.captionUntil);
        let caption = null;
        if (captionOn) {
          caption = `${LABEL[st]}: ${this.status.title}`;
          if (caption.length > 40) caption = caption.slice(0, 38).trimEnd() + '…';
        }
        const bt = (now - this.status.since) / 1000;
        const key = `${st}|${caption}|${Math.floor(bt * 6) % 4}|${Math.floor(bt * 4) % 2}`;
        if (key !== this.bubbleKey) {
          this.bubbleKey = key;
          const bb = S.renderBubble(st, bt, caption);
          if (this.bubble.width !== bb.w || this.bubble.height !== bb.h) {
            this.bubble.width = bb.w; this.bubble.height = bb.h;
          }
          bb.toCanvas(this.bctx);
          this.bubble.style.width = bb.w * u + 'px';
          this.bubble.style.height = bb.h * u + 'px';
        }
        const bw = this.bubble.width * u, bh = this.bubble.height * u;
        const headTop = top + info.top * u;
        const bl = clamp(this.x - bw / 2, 4, this.w - bw - 4);
        const btop = Math.max(4, headTop - bh - 1 * u);
        this.bubbleWrap.style.display = 'block';
        this.bubbleWrap.style.transform = `translate3d(${this.snap(bl)}px,${this.snap(btop)}px,0)`;
      }
    }

    moving() {
      return this.mode !== 'ground' || this.chasing || Math.abs(this.vx) > 0.5;
    }

    loop(now) {
      this.raf = 0; this.timer = 0;
      const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
      this.last = now;
      this.update(dt, now);
      this.render(now);
      this.updateHover();
      this.schedule();
    }

    // requestAnimationFrame only while something moves; otherwise a slow timer at the
    // animation's own frame rate (pixel art doesn't need 60 fps to idle or sleep).
    schedule() {
      if (this.raf || this.timer) return;
      const f = this.frame;
      if (this.moving() || (f && f.smooth)) this.raf = requestAnimationFrame((n) => this.loop(n));
      else this.timer = setTimeout(() => this.loop(performance.now()), 1000 / ((f && f.fps) || 8));
    }

    kick() {
      if (this.timer) { clearTimeout(this.timer); this.timer = 0; }
      if (!this.raf) this.raf = requestAnimationFrame((n) => this.loop(n));
    }
  }

  window.PetController = PetController;
  window.PetController.CFG = CFG;
})();
