// Scripted demo for recording preview.html's playground (used for the README GIF): evaluate it in the
// page after load. Draws a fake cursor and sends synthetic mouse events so a headless recording shows the
// pet chasing, the agent states, a throw into the wall, a few pokes and a pet. Resolves when done.
(async () => {
  const play = document.getElementById('play');
  const pet = window.__pet;
  const btn = (label) => [...document.querySelectorAll('#stateBtns button')].find((b) => b.textContent === label);
  document.getElementById('stateBtns').scrollIntoView({ block: 'start' });
  window.scrollBy(0, -8);
  document.querySelector('#play .hint')?.remove();

  const cur = document.createElement('div');
  cur.innerHTML = '<svg width="22" height="30" viewBox="0 0 11 15" shape-rendering="crispEdges"><path d="M0 0v12l3-3 2 5 2-1-2-5h4z" fill="#fff" stroke="#111" stroke-width="1"/></svg>';
  Object.assign(cur.style, { position: 'fixed', zIndex: 9999, pointerEvents: 'none', left: 0, top: 0 });
  document.body.append(cur);

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rect = () => play.getBoundingClientRect();
  let cx = 1150, cy = 120;
  const fire = (type, target = play) => {
    const r = rect();
    cur.style.transform = `translate(${r.left + cx}px, ${r.top + cy}px)`;
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: r.left + cx, clientY: r.top + cy }));
  };
  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
  async function moveTo(x, y, ms, curve = ease) {
    const x0 = cx, y0 = cy, start = performance.now();
    for (;;) {
      const t = Math.min(1, (performance.now() - start) / ms);
      cx = x0 + (x - x0) * curve(t); cy = y0 + (y - y0) * curve(t);
      fire('mousemove');
      if (t === 1) return;
      await sleep(16);
    }
  }
  const petCenter = () => ({ x: pet.x, y: pet.groundY() - pet.alt - 40 });
  const click = async () => { fire('mousedown'); await sleep(40); fire('mouseup', window); };

  fire('mousemove');
  await sleep(600);
  await moveTo(700, 140, 800);              // pet runs to the cursor
  await sleep(1400);
  btn('working').click(); await sleep(1800);
  btn('waiting').click(); await sleep(1800);
  btn('done').click(); await sleep(2000);
  btn('idle').click(); await sleep(300);

  let p = petCenter();                       // grab, lift, fling into the left wall
  await moveTo(p.x, p.y, 500); await sleep(150);
  fire('mousedown'); await sleep(100);
  await moveTo(p.x + 60, 70, 600);
  await moveTo(40, 50, 220, (t) => t * t);
  fire('mouseup', window);
  await sleep(3800);                         // OW!, dizzy stars, bandage

  p = petCenter();                           // three quick pokes: he cries
  await moveTo(p.x, p.y, 500); await sleep(150);
  for (let i = 0; i < 3; i++) { await click(); await sleep(170); }
  await sleep(1300);
  await click();                              // a gentle pet: hearts, sulk over
  await sleep(1900);
  await moveTo(p.x + 220, 120, 600);
  await sleep(600);
  return 'done';
})()
