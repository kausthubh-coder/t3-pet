// Scripted demo for recording preview.html's playground: paste into the page (or evaluate it) after load.
// Draws a fake cursor and sends synthetic mouse events so a headless recording shows the pet chasing,
// changing state, being dragged and dropped, petted and falling asleep. Resolves when the run ends.
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
  let cx = 120, cy = 160;
  const fire = (type, target = play) => {
    const r = rect();
    cur.style.transform = `translate(${r.left + cx}px, ${r.top + cy}px)`;
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: r.left + cx, clientY: r.top + cy }));
  };
  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
  async function moveTo(x, y, ms) {
    const x0 = cx, y0 = cy, start = performance.now();
    for (;;) {
      const t = Math.min(1, (performance.now() - start) / ms);
      cx = x0 + (x - x0) * ease(t); cy = y0 + (y - y0) * ease(t);
      fire('mousemove');
      if (t === 1) return;
      await sleep(16);
    }
  }
  const petCenter = () => ({ x: pet.x, y: pet.groundY() - pet.alt - 40 });

  fire('mousemove');
  await sleep(1500);
  await moveTo(1080, 120, 900);            // pet runs right
  await sleep(2200);
  btn('working').click(); await sleep(3000);
  await moveTo(560, 200, 1100);            // walks back while working
  await sleep(1800);
  btn('waiting').click(); await sleep(2800);
  btn('done').click(); await sleep(3000);
  btn('error').click(); await sleep(2600);
  btn('idle').click(); await sleep(800);

  let p = petCenter();                     // pick it up and throw it
  await moveTo(p.x, p.y, 700); await sleep(250);
  fire('mousedown'); await sleep(150);
  await moveTo(p.x - 120, 60, 900); await sleep(700);
  await moveTo(p.x + 140, 50, 350);
  fire('mouseup', window);
  await sleep(2600);

  p = petCenter();                         // pet it
  await moveTo(p.x, p.y, 600); await sleep(200);
  fire('mousedown'); fire('mouseup', window);
  await sleep(2200);
  await moveTo(p.x + 260, 110, 700);
  await sleep(1200);
  btn('sleep now').click(); await sleep(3500);
  return 'done';
})()
