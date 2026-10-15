// Pixel-art renderer for the T3 mascot. Everything is drawn procedurally into a small
// RGBA pixel buffer; callers blit it to a canvas and scale it up with nearest-neighbour.
// Works in the browser (window.T3Sprite) and in Node/Electron main (require).
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.T3Sprite = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---- colours -----------------------------------------------------------------------------
  // Packed as little-endian ABGR so a Uint32Array view over ImageData can take them directly.
  function rgba(hex, a = 255) {
    const n = parseInt(hex.slice(1), 16);
    return (((a & 255) << 24) | ((n & 255) << 16) | (n & 0xff00) | (n >>> 16)) >>> 0;
  }

  const P = {
    outline: rgba('#2b2935'),
    hi: rgba('#ffffff'),
    b0: rgba('#f5f4f9'),
    b1: rgba('#e4e3ec'),
    b2: rgba('#cbcad8'),
    b3: rgba('#a9a8bd'),
    b4: rgba('#8f8ea6'),
    limb: rgba('#f6f5fa'),
    limbBack: rgba('#dcdbe6'),
    ink: rgba('#16151c'),
    iris: rgba('#8a93a3'),
    irisDark: rgba('#5d6576'),
    pupil: rgba('#22212b'),
    glint: rgba('#ffffff'),
    sclera: rgba('#fcfcff'),
    lid: rgba('#45435a'),
    brow: rgba('#6c6a80'),
    mouth: rgba('#ea7f97'),
    mouthDark: rgba('#b8456a'),
    mouthIn: rgba('#7a2440'),
    tongue: rgba('#ff9db4'),
    blush: rgba('#ffb3c7'),
    laptop: rgba('#3b3a4a'),
    laptopHi: rgba('#5a596f'),
    laptopDark: rgba('#26252f'),
    laptopGlow: rgba('#8fd3ff'),
    heart: rgba('#ff5c8d'),
    heartHi: rgba('#ffc0d3'),
    spark: rgba('#ffd23f'),
    sparkHi: rgba('#fffbe0'),
    zz: rgba('#d6defe'),
    sweat: rgba('#7cc7ff'),
    sweatHi: rgba('#e3f4ff'),
    dust: rgba('#eceaf2'),
    dustEdge: rgba('#a3a1b6'),
    alert: rgba('#ff6a3d'),
    white: rgba('#ffffff'),
    bubbleShade: rgba('#dedde8'),
  };

  const ACCENT = {
    idle: rgba('#6f6d86'),
    working: rgba('#4f7dff'),
    waiting: rgba('#f29a1d'),
    done: rgba('#25b865'),
    error: rgba('#ff3b55'),
  };

  // ---- pixel buffer + mask ------------------------------------------------------------------
  class Pix {
    constructor(w, h) {
      this.w = w;
      this.h = h;
      this.d = new Uint32Array(w * h);
    }
    clear() { this.d.fill(0); }
    set(x, y, c) {
      x |= 0; y |= 0;
      if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
      this.d[y * this.w + x] = c;
    }
    get(x, y) {
      if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
      return this.d[y * this.w + x];
    }
    rect(x, y, w, h, c) {
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c);
    }
    // Stamp a pattern: rows of chars, map char -> colour, '.' and ' ' are transparent.
    pattern(x, y, rows, map, flip = false) {
      for (let j = 0; j < rows.length; j++) {
        const r = rows[j];
        for (let i = 0; i < r.length; i++) {
          const ch = r[flip ? r.length - 1 - i : i];
          if (ch === '.' || ch === ' ') continue;
          const c = map[ch];
          if (c !== undefined) this.set(x + i, y + j, c);
        }
      }
    }
    blit(src, dx, dy) {
      for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) {
        const c = src.d[y * src.w + x];
        if (c) this.set(dx + x, dy + y, c);
      }
    }
    // Draw into a 2D canvas context at 1:1 (scale with CSS / drawImage, nearest-neighbour).
    toCanvas(ctx) {
      const img = ctx.createImageData(this.w, this.h);
      new Uint32Array(img.data.buffer).set(this.d);
      ctx.putImageData(img, 0, 0);
    }
    // Plain RGBA bytes (for PNG encoding in Node).
    toRGBA() {
      const out = new Uint8Array(this.w * this.h * 4);
      for (let i = 0; i < this.d.length; i++) {
        const c = this.d[i];
        out[i * 4] = c & 255;
        out[i * 4 + 1] = (c >>> 8) & 255;
        out[i * 4 + 2] = (c >>> 16) & 255;
        out[i * 4 + 3] = c >>> 24;
      }
      return out;
    }
  }

  // A boolean mask we paint shapes into, then fill + outline in one go so overlapping
  // shapes merge into one clean silhouette with a 1px outline.
  class Mask {
    constructor(w, h) { this.w = w; this.h = h; this.m = new Uint8Array(w * h); }
    has(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h && this.m[y * this.w + x] === 1; }
    put(x, y) { if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.m[y * this.w + x] = 1; }
    disk(cx, cy, r) {
      for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
        for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
          const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
          if (dx * dx + dy * dy <= r * r + 1e-6) this.put(x, y);
        }
    }
    ellipse(cx, cy, rx, ry) {
      for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
        for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
          const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
          if (dx * dx + dy * dy <= 1 + 1e-6) this.put(x, y);
        }
    }
    seg(x0, y0, x1, y1, r) {
      const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 3));
      for (let i = 0; i <= n; i++) this.disk(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, r);
    }
    rect(x, y, w, h) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.put(x + i, y + j); }
    pattern(x, y, rows) {
      for (let j = 0; j < rows.length; j++)
        for (let i = 0; i < rows[j].length; i++) if (rows[j][i] !== '.' && rows[j][i] !== ' ') this.put(x + i, y + j);
    }
    // Paint: outline (4-neighbour ring around the mask) then fill via colour function.
    paint(buf, fill, outline = P.outline, keep = null) {
      const { w, h } = this;
      if (outline)
        for (let y = -1; y <= h; y++) for (let x = -1; x <= w; x++) {
          if (this.has(x, y)) continue;
          if (keep && keep.includes(buf.get(x, y))) continue;
          if (this.has(x - 1, y) || this.has(x + 1, y) || this.has(x, y - 1) || this.has(x, y + 1)) buf.set(x, y, outline);
        }
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (!this.m[y * w + x]) continue;
        const c = typeof fill === 'function' ? fill(x, y) : fill;
        if (c) buf.set(x, y, c);
      }
    }
  }

  // ---- glyphs ------------------------------------------------------------------------------
  // The "T3" on the forehead: chunky, flat-topped 3 like the logo.
  const T3_TEXT = [
    '######.#####',
    '######....##',
    '..##.....##.',
    '..##......##',
    '..##..##..##',
    '..##...####.',
  ];
  const T3_TEXT_SMALL = [
    '###.##.',
    '.#....#',
    '.#..##.',
    '.#....#',
    '.#..##.',
  ];

  // 3x5 pixel font (some glyphs wider). Uppercase only; lowercase maps to it.
  const FONT = {
    A: ['.#.', '#.#', '###', '#.#', '#.#'], B: ['##.', '#.#', '##.', '#.#', '##.'],
    C: ['.##', '#..', '#..', '#..', '.##'], D: ['##.', '#.#', '#.#', '#.#', '##.'],
    E: ['###', '#..', '##.', '#..', '###'], F: ['###', '#..', '##.', '#..', '#..'],
    G: ['.##', '#..', '#.#', '#.#', '.##'], H: ['#.#', '#.#', '###', '#.#', '#.#'],
    I: ['###', '.#.', '.#.', '.#.', '###'], J: ['..#', '..#', '..#', '#.#', '.#.'],
    K: ['#.#', '#.#', '##.', '#.#', '#.#'], L: ['#..', '#..', '#..', '#..', '###'],
    M: ['#...#', '##.##', '#.#.#', '#...#', '#...#'], N: ['#..#', '##.#', '#.##', '#..#', '#..#'],
    O: ['.#.', '#.#', '#.#', '#.#', '.#.'], P: ['##.', '#.#', '##.', '#..', '#..'],
    Q: ['.#.', '#.#', '#.#', '##.', '.##'], R: ['##.', '#.#', '##.', '#.#', '#.#'],
    S: ['.##', '#..', '.#.', '..#', '##.'], T: ['###', '.#.', '.#.', '.#.', '.#.'],
    U: ['#.#', '#.#', '#.#', '#.#', '###'], V: ['#.#', '#.#', '#.#', '#.#', '.#.'],
    W: ['#...#', '#...#', '#.#.#', '##.##', '#...#'], X: ['#.#', '#.#', '.#.', '#.#', '#.#'],
    Y: ['#.#', '#.#', '.#.', '.#.', '.#.'], Z: ['###', '..#', '.#.', '#..', '###'],
    0: ['###', '#.#', '#.#', '#.#', '###'], 1: ['.#.', '##.', '.#.', '.#.', '###'],
    2: ['##.', '..#', '.#.', '#..', '###'], 3: ['##.', '..#', '.#.', '..#', '##.'],
    4: ['#.#', '#.#', '###', '..#', '..#'], 5: ['###', '#..', '##.', '..#', '##.'],
    6: ['.##', '#..', '###', '#.#', '###'], 7: ['###', '..#', '.#.', '.#.', '.#.'],
    8: ['###', '#.#', '###', '#.#', '###'], 9: ['###', '#.#', '###', '..#', '##.'],
    ' ': ['..', '..', '..', '..', '..'], '.': ['.', '.', '.', '.', '#'], ',': ['.', '.', '.', '#', '#'],
    ':': ['.', '#', '.', '#', '.'], ';': ['.', '#', '.', '#', '#'], '!': ['#', '#', '#', '.', '#'],
    '?': ['##.', '..#', '.#.', '...', '.#.'], '-': ['...', '...', '###', '...', '...'],
    '_': ['...', '...', '...', '...', '###'], '+': ['...', '.#.', '###', '.#.', '...'],
    "'": ['#', '#', '.', '.', '.'], '"': ['#.#', '#.#', '...', '...', '...'],
    '(': ['.#', '#.', '#.', '#.', '.#'], ')': ['#.', '.#', '.#', '.#', '#.'],
    '/': ['..#', '..#', '.#.', '#..', '#..'], '#': ['#.#', '###', '#.#', '###', '#.#'],
    '&': ['.#.', '#.#', '.#.', '#.#', '.##'], '*': ['...', '#.#', '.#.', '#.#', '...'],
    '…': ['.....', '.....', '.....', '.....', '#.#.#'], '·': ['.', '.', '#', '.', '.'],
    '×': ['...', '#.#', '.#.', '#.#', '...'],
  };
  function glyph(ch) {
    return FONT[ch] || FONT[ch.toUpperCase()] || FONT['?'];
  }
  function textWidth(str) {
    let w = 0;
    for (const ch of str) w += glyph(ch)[0].length + 1;
    return Math.max(0, w - 1);
  }
  function drawText(buf, x, y, str, color) {
    for (const ch of str) {
      const g = glyph(ch);
      buf.pattern(x, y, g, { '#': color });
      x += g[0].length + 1;
    }
    return x;
  }

  // ---- the mascot ------------------------------------------------------------------------
  const L = (() => { const v = [-0.42, -0.58, 0.7]; const n = Math.hypot(...v); return v.map((c) => c / n); })();

  const R = 14.5; // body radius in art pixels: a 29px sphere
  const DEFAULT_ARM = { a: 0.2, len: 10, front: false };

  // Pose fields (all optional):
  //   bob (int, body sinks px), squash (+ = wider/flatter), sit, facing (-1/0/1), lean (px),
  //   shakeX, look {x,y} in -1..1, eyes: open|blink|closed|happy|wide|squint,
  //   brows: null|sad|focus|up, mouth: smile|grin|open|frown|o|flat|wobble, blush,
  //   arms {l:{a,len,front}, r:{...}} (a = radians outward from hanging straight down),
  //   legs {mode: stand|walk|dangle|sit, phase, lift, swing}, prop: null|laptop, typing (0/1)
  function drawPet(buf, pose, ax, ay) {
    const p = pose || {};
    const s = p.squash || 0;
    const rx = R * (1 + s);
    const ry = R * (1 - s);
    const sit = !!p.sit;
    const legVis = sit ? 3 : 6;
    const bob = p.bob || 0;
    const cx = ax + 0.5 + (p.lean || 0) + (p.shakeX || 0);
    const bodyBottom = ay - legVis + bob;
    const cy = bodyBottom - ry;
    const facing = p.facing || 0;
    const fshift = Math.round(facing * 2);
    const W = buf.w, H = buf.h;

    // legs (behind body)
    drawLegs(buf, p, cx, cy, ry, bodyBottom, ay, facing, sit);

    // arms behind body
    const arms = p.arms || {};
    const al = Object.assign({}, DEFAULT_ARM, arms.l), ar = Object.assign({}, DEFAULT_ARM, arms.r);
    const backArms = new Mask(W, H);
    let anyBack = false;
    if (!al.front) { armShape(backArms, cx, cy, rx, ry, -1, al); anyBack = true; }
    if (!ar.front) { armShape(backArms, cx, cy, rx, ry, 1, ar); anyBack = true; }
    if (anyBack) backArms.paint(buf, P.limb);

    // body sphere with banded shading + light ordered dither at band edges
    const body = new Mask(W, H);
    body.ellipse(cx, cy, rx, ry);
    body.paint(buf, (x, y) => {
      const nx = (x + 0.5 - cx) / rx, ny = (y + 0.5 - cy) / ry;
      const d = Math.min(1, nx * nx + ny * ny);
      const nz = Math.sqrt(1 - d);
      let I = nx * L[0] + ny * L[1] + nz * L[2];
      if (d > 0.8 && ny > 0.25) I -= 0.12; // bottom rim / contact shade
      if (I > 0.9) return P.hi;
      if (I > 0.62) return P.b0;
      if (I > 0.36) return P.b1;
      if (I > 0.14) return P.b2;
      if (I > -0.08) return P.b3;
      return P.b4;
    }, P.outline, [P.limb]);

    // face
    const fx = cx + fshift;
    const tx = Math.round(fx - T3_TEXT[0].length / 2);
    const ty = Math.round(cy - ry * 0.7);
    buf.pattern(tx, ty, T3_TEXT, { '#': P.ink });

    const eyeY = Math.round(cy + ry * 0.0);
    const eyeDX = 6.5 * (1 + s * 0.5);
    drawEye(buf, Math.round(fx - eyeDX - 2), eyeY, p, -1);
    drawEye(buf, Math.round(fx + eyeDX - 2), eyeY, p, 1);
    if (p.blush) {
      buf.rect(Math.round(fx - eyeDX - 3), eyeY + 5, 3, 1, P.blush);
      buf.rect(Math.round(fx + eyeDX), eyeY + 5, 3, 1, P.blush);
    }
    drawMouth(buf, Math.round(fx - 0.5), Math.round(cy + ry * 0.42), p.mouth || 'smile');

    // front arms + prop
    const front = new Mask(W, H);
    let anyFront = false;
    if (al.front) { armShape(front, cx, cy, rx, ry, -1, al, p.typing ? (p.typing & 1) : 0); anyFront = true; }
    if (ar.front) { armShape(front, cx, cy, rx, ry, 1, ar, p.typing ? ((p.typing + 1) & 1) : 0); anyFront = true; }
    if (anyFront) front.paint(buf, P.limb);
    if (p.prop === 'laptop') drawLaptop(buf, Math.round(cx - 0.5), ay, p.glow);

    return { top: Math.floor(cy - ry) - 1, cx, cy, rx, ry, bodyBottom };
  }

  function armShape(mask, cx, cy, rx, ry, side, arm, typingLift = 0) {
    // Back arms hang from the sides; front arms (typing) come from lower on the body.
    const sx = cx + side * rx * (arm.front ? 0.72 : 0.86);
    const sy = cy + ry * (arm.front ? 0.42 : 0.12);
    const a = arm.a;
    const len = arm.len;
    const ex = sx + side * Math.sin(a) * len;
    const ey = sy + Math.cos(a) * len - typingLift;
    mask.seg(sx, sy, ex, ey, 0.62);
    mask.disk(ex, ey, arm.front ? 0.9 : 1.0);
  }

  function drawLegs(buf, p, cx, cy, ry, bodyBottom, ay, facing, sit) {
    const legs = p.legs || { mode: sit ? 'sit' : 'stand' };
    const mode = sit ? 'sit' : legs.mode || 'stand';
    const m = new Mask(buf.w, buf.h);
    const hipY = bodyBottom - 2;
    const fdir = facing || 0;
    for (const side of [-1, 1]) {
      const hipX = cx - 0.5 + side * 4.5 + 0.5; // pixel boundary -> 2px wide legs
      if (mode === 'sit') {
        // short legs sticking forward: feet poke out at the bottom corners
        const fx = cx + side * 7.5;
        m.ellipse(fx, ay - 2, 2.6, 1.6);
        continue;
      }
      let footX = hipX + side * 0.5, footY = ay - 2, lift = 0;
      if (mode === 'walk') {
        const ph = legs.phase * Math.PI * 2 + (side > 0 ? Math.PI : 0);
        const amp = legs.amp || 1.5;
        lift = Math.max(0, Math.sin(ph)) * (legs.lift || 2);
        footX += Math.cos(ph) * amp * (fdir || 1);
      } else if (mode === 'dangle') {
        footX = hipX + side * 0.8 + (legs.swing || 0) * 2.5;
        footY = bodyBottom + 6.5 + (side > 0 ? (legs.kick || 0) : -(legs.kick || 0));
      }
      footY -= Math.round(lift);
      footX = Math.round(footX);
      m.seg(hipX, hipY, footX, footY - 0.5, 0.75);
      // little foot, pointing the way we face
      m.ellipse(footX + fdir * 1, footY, 2.4, 1.0);
    }
    m.paint(buf, (x, y) => (y >= ay - 3 && mode !== 'dangle' ? P.limb : P.limbBack));
  }

  function drawEye(buf, x, y, p, side) {
    const kind = p.eyes || 'open';
    const look = p.look || { x: 0, y: 0 };
    let lx = Math.max(-1, Math.min(1, Math.round(look.x || 0)));
    const ly = Math.max(-1, Math.min(1, Math.round(look.y || 0)));
    if (p.facing) lx = p.facing;
    const D = P.lid;
    switch (kind) {
      case 'blink':
        buf.rect(x, y + 2, 4, 1, D);
        break;
      case 'closed': // content, sleeping: little U
        buf.pattern(x, y + 1, ['#..#', '.##.'], { '#': D });
        break;
      case 'happy': // ^ ^
        buf.pattern(x, y + 1, ['.##.', '#..#'], { '#': D });
        break;
      case 'squint': // > <
        buf.pattern(x, y, side < 0 ? ['#...', '.##.', '#...'] : ['...#', '.##.', '...#'], { '#': D });
        break;
      case 'wide': {
        buf.pattern(x, y, ['.aa.', 'awwa', 'awwa', '.aa.'], { a: P.irisDark, w: P.sclera });
        buf.set(x + 1 + (lx > 0 ? 1 : 0), y + 1 + (ly > 0 ? 1 : 0), P.pupil);
        break;
      }
      default: {
        // grey iris ring, dark pupil, white glint top-left
        buf.pattern(x, y, ['.aa.', 'aaaa', 'aaaa', '.aa.'], { a: P.iris });
        const px = x + 1 + lx, py = y + 1 + ly;
        buf.rect(px, py, 2, 2, P.pupil);
        buf.set(px, py, P.glint);
      }
    }
    if (p.brows) {
      // 4px brow; `inner` is the column nearest the nose
      const inner = side < 0 ? 3 : 0;
      for (let i = 0; i < 4; i++) {
        const nearNose = Math.abs(i - inner) < 2;
        let dy = -2;
        if (p.brows === 'sad') dy = nearNose ? -3 : -2;
        else if (p.brows === 'focus') dy = nearNose ? -2 : -3;
        else if (p.brows === 'up') dy = -3;
        buf.set(x + i, y + dy, P.brow);
      }
    }
  }

  function drawMouth(buf, x, y, kind) {
    // x is the centre column
    const M = { p: P.mouth, d: P.mouthDark, i: P.mouthIn, t: P.tongue };
    const rows = {
      smile: ['d.....d', '.ppppp.'],
      grin: ['ddddddd', '.dpppd.', '..ddd..'],
      open: ['.ddddd.', 'diiiiid', '.dtttd.', '..ddd..'],
      frown: ['..ppp..', '.p...p.', 'd.....d'],
      o: ['.ddd.', 'diiid', '.ddd.'],
      flat: ['.ddddd.'],
      wobble: ['.d.d.d.', 'd.d.d.d'],
    }[kind] || ['d.....d', '.ppppp.'];
    buf.pattern(x - Math.floor(rows[0].length / 2), y, rows, M);
  }

  function drawLaptop(buf, cx, ay, glow) {
    // Lid seen from behind, resting on the lap; the screen glows onto the pet.
    const w = 15, h = 9;
    const x = cx - Math.floor(w / 2), y = ay - h - 1;
    const m = new Mask(buf.w, buf.h);
    m.rect(x, y, w, h);
    m.paint(buf, (px, py) => (py === y ? P.laptopHi : py === y + h - 1 ? P.laptopDark : P.laptop));
    // tiny glowing logo on the lid
    buf.pattern(cx - 1, y + 3, ['.#.', '###', '.#.'], { '#': glow ? P.laptopGlow : P.laptopHi });
  }

  // ---- effects --------------------------------------------------------------------------
  const FX = {
    heart: ['.#.#.', '#####', '#####', '.###.', '..#..'],
    heartS: ['#.#', '###', '.#.'],
    Z: ['####', '..#.', '.#..', '####'],
    z: ['###', '.#.', '###'],
    spark: ['..#..', '..#..', '##o##', '..#..', '..#..'],
    sparkS: ['.#.', '#o#', '.#.'],
    sweat: ['.#.', '.#.', '###', '#o#', '.#.'],
    bang: ['##', '##', '##', '##', '..', '##'],
  };

  function fxSprite(buf, name, x, y, fill, hi) {
    const rows = FX[name];
    const m = new Mask(buf.w, buf.h);
    m.pattern(x, y, rows);
    m.paint(buf, (px, py) => {
      const ch = rows[py - y][px - x];
      return ch === 'o' ? hi : fill;
    });
    if (name === 'heart' && hi) buf.set(x + 1, y + 1, hi);
  }

  function puff(buf, x, y, r) {
    const m = new Mask(buf.w, buf.h);
    m.disk(x, y, r);
    m.paint(buf, P.dust, P.dustEdge);
  }

  // Effects are pure functions of time so the preview can show any frame.
  function drawFx(buf, list, info) {
    if (!list) return;
    const top = info.top, cx = info.cx;
    for (const f of list) {
      const t = f.t;
      switch (f.type) {
        case 'z': {
          // three letters drifting up and to the right, staggered
          for (let i = 0; i < 3; i++) {
            const k = ((t / 2.4 + i / 3) % 1 + 1) % 1;
            const x = Math.round(cx + 8 + k * 9 + Math.sin(k * 6.28) * 1.5);
            const y = Math.round(top + 4 - k * 20);
            if (k < 0.08) continue;
            fxSprite(buf, k > 0.45 ? 'Z' : 'z', x, y, P.zz);
          }
          break;
        }
        case 'hearts': {
          const spawns = [[0, -5], [0.25, 6], [0.5, -1], [0.8, 4]];
          for (const [t0, dx] of spawns) {
            const k = (t - t0) / 1.0;
            if (k < 0 || k > 1) continue;
            const x = Math.round(cx + dx + Math.sin(k * 9 + dx) * 1.5 - 2);
            const y = Math.round(top + 2 - k * 22);
            fxSprite(buf, k < 0.15 || k > 0.85 ? 'heartS' : 'heart', x, y, P.heart, P.heartHi);
          }
          break;
        }
        case 'sparkles': {
          const spots = [[-17, -2, 0], [15, 4, 0.3], [-12, 14, 0.55], [18, 18, 0.15], [-3, -6, 0.75], [10, -4, 0.45]];
          for (const [dx, dy, ph] of spots) {
            const k = ((t * 1.3 + ph) % 1 + 1) % 1;
            if (k > 0.7) continue;
            const big = k > 0.2 && k < 0.5;
            const name = big ? 'spark' : 'sparkS';
            const off = big ? 2 : 1;
            fxSprite(buf, name, Math.round(cx + dx - off), Math.round(top + dy - off), P.spark, P.sparkHi);
          }
          break;
        }
        case 'sweat': {
          const k = Math.min(1, t / 0.8);
          fxSprite(buf, 'sweat', Math.round(cx + 11), Math.round(top + 3 + k * 3), P.sweat, P.sweatHi);
          break;
        }
        case 'bang': {
          if (t > 0.9) break;
          const y = Math.round(top - 10 - Math.min(1, t / 0.12) * 2);
          fxSprite(buf, 'bang', Math.round(cx - 1), y, P.alert);
          break;
        }
        case 'dust': {
          if (t > 0.5) break;
          const k = t / 0.5;
          const r = 2.2 * (1 - k) + 0.6;
          const spread = 10 + k * 8;
          const y = info.ground - 2 - k * 2;
          puff(buf, cx - spread, y, r);
          puff(buf, cx + spread, y, r);
          if (k < 0.6) { puff(buf, cx - spread * 0.6, y - 1.5, r * 0.7); puff(buf, cx + spread * 0.6, y - 1.5, r * 0.7); }
          break;
        }
        case 'runDust': {
          // little puffs kicked up behind the feet while running
          const dir = f.dir || 1;
          for (let i = 0; i < 2; i++) {
            const k = ((t * 3 + i * 0.5) % 1 + 1) % 1;
            puff(buf, cx - dir * (8 + k * 9), info.ground - 2 - k * 3, 1.4 * (1 - k) + 0.4);
          }
          break;
        }
      }
    }
  }

  // ---- shadow ----------------------------------------------------------------------------
  // A soft two-tone pixel ellipse. `alt` = altitude in art px; shrinks + fades as it rises.
  function drawShadow(buf, cx, cy, width, alt) {
    const k = 1 / (1 + Math.max(0, alt) / 30);
    const rx = (width / 2) * (0.5 + 0.5 * k);
    const ry = 2.6 * (0.6 + 0.4 * k);
    const a = k * k;
    const tones = [rgba('#000000', Math.round(70 * a + 10)), rgba('#000000', Math.round(46 * a + 8)), rgba('#000000', Math.round(24 * a + 6))];
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
        const d = dx * dx + dy * dy;
        if (d > 1) continue;
        buf.set(x, y, d < 0.35 ? tones[0] : d < 0.7 ? tones[1] : tones[2]);
      }
  }

  // ---- speech bubble ---------------------------------------------------------------------
  const ICONS = {
    '?': ['.###.', '##.##', '...##', '..##.', '..##.', '.....', '..##.'],
    '!': ['##', '##', '##', '##', '##', '..', '##'],
    check: ['......##', '.....##.', '##..##..', '.####...', '..##....', '........', '........'],
    sad: ['.###.', '#...#', '.....', '.###.', '#...#', '.....', '.....'],
  };

  // state: working|waiting|done|error|idle; caption: optional string; t seconds (animates dots)
  function renderBubble(state, t, caption) {
    const accent = ACCENT[state] || ACCENT.idle;
    let iconW, iconRows = null;
    if (state === 'working') iconW = 11;
    else if (state === 'waiting') { iconRows = ICONS['?']; iconW = 5; }
    else if (state === 'done') { iconRows = ICONS.check; iconW = 8; }
    else if (state === 'error') { iconRows = ICONS['!']; iconW = 2; }
    else iconW = 0;
    const text = caption ? caption : '';
    const tw = text ? textWidth(text) : 0;
    const gap = iconW && tw ? 4 : 0;
    const innerW = iconW + gap + tw;
    const padX = 4, padY = 3, contentH = 7;
    const w = innerW + padX * 2 + 2;
    const h = contentH + padY * 2 + 2;
    const tailH = 4;
    const buf = new Pix(w, h + tailH);
    // body (rounded rect) as mask so outline is automatic
    const m = new Mask(w, h + tailH);
    m.rect(1, 1, w - 2, h - 2);
    // round corners
    for (const [x, y] of [[1, 1], [w - 2, 1], [1, h - 2], [w - 2, h - 2]]) m.m[y * w + x] = 0;
    // tail at the centre
    const tc = Math.floor(w / 2);
    m.rect(tc - 2, h - 1, 4, 1);
    m.rect(tc - 1, h, 3, 1);
    m.rect(tc - 1, h + 1, 2, 1);
    m.rect(tc - 1, h + 2, 1, 1);
    m.paint(buf, (x, y) => (y >= h - 3 && y < h - 1 ? P.bubbleShade : P.white));
    // contents
    let x = 1 + padX;
    const y = 1 + padY;
    if (state === 'working') {
      // three dots doing a wave
      const f = Math.floor(t * 6) % 4;
      for (let i = 0; i < 3; i++) {
        const up = f === i ? 2 : f === i + 1 ? 1 : 0;
        buf.rect(x + i * 4, y + 3 - up, 3, 3, accent);
      }
    } else if (iconRows) {
      const bounce = state === 'waiting' ? (Math.floor(t * 4) % 2) : 0;
      buf.pattern(x, y - bounce + (state === 'done' ? 1 : 0), iconRows, { '#': accent });
    }
    x += iconW + gap;
    if (text) {
      // first word (label) in accent colour, rest in ink
      const ci = text.indexOf(':');
      if (ci > 0 && state !== 'idle') {
        x = drawText(buf, x, y + 1, text.slice(0, ci + 1), accent);
        x += 1;
        drawText(buf, x, y + 1, text.slice(ci + 1).trimStart(), P.outline);
      } else drawText(buf, x, y + 1, text, P.outline);
    }
    return buf;
  }

  // ---- tray / app icon -------------------------------------------------------------------
  function renderIcon(size) {
    const buf = new Pix(size, size);
    const r = size / 2 - 1.5;
    const c = size / 2;
    const m = new Mask(size, size);
    m.ellipse(c, c + 0.5, r, r - 0.5);
    m.paint(buf, (x, y) => {
      const nx = (x + 0.5 - c) / r, ny = (y + 0.5 - c) / r;
      const d = Math.min(1, nx * nx + ny * ny);
      const I = nx * L[0] + ny * L[1] + Math.sqrt(1 - d) * L[2];
      return I > 0.85 ? P.hi : I > 0.55 ? P.b0 : I > 0.3 ? P.b1 : I > 0.05 ? P.b2 : P.b3;
    });
    if (size >= 28) {
      buf.pattern(Math.round(c - 6), Math.round(c - r * 0.62), T3_TEXT, { '#': P.ink });
      const ey = Math.round(c + 2);
      buf.pattern(Math.round(c - 7), ey, ['.##.', '#ow#', '#oo#', '.##.'], { '#': P.iris, o: P.pupil, w: P.glint });
      buf.pattern(Math.round(c + 3), ey, ['.##.', '#ow#', '#oo#', '.##.'], { '#': P.iris, o: P.pupil, w: P.glint });
      buf.pattern(Math.round(c - 3), ey + 6, ['d.....d', '.ppppp.'], { d: P.mouthDark, p: P.mouth });
    } else {
      buf.pattern(Math.round(c - 3.5), Math.round(c - r * 0.55), T3_TEXT_SMALL, { '#': P.ink });
      buf.set(Math.round(c - 3), Math.round(c + 3), P.pupil);
      buf.set(Math.round(c + 2), Math.round(c + 3), P.pupil);
    }
    return buf;
  }

  return { Pix, Mask, P, ACCENT, rgba, drawPet, drawFx, drawShadow, renderBubble, renderIcon, textWidth, drawText, R };
});
