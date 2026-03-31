/**
 * LOFI.MIXER — grid.js
 * Animated retrowave perspective grid.
 * Vanishing point tracks mouse / touch for subtle parallax.
 */
(() => {
  const canvas = document.getElementById('grid-canvas');
  if (!canvas) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (window.matchMedia('(hover: none)').matches) return;

  const ctx = canvas.getContext('2d');

  let W, H;
  let mx = 0.5, my = 0.5;   // raw mouse/touch (0-1)
  let svpX, svpY;            // smoothed vanishing point (px)
  let offset = 0;
  const SPEED = 0.0022;      // horizontal line scroll speed

  // ---------- Resize ----------
  function resize() {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
    svpX = W * 0.5;
    svpY = H * 0.52;
  }
  window.addEventListener('resize', resize);
  resize();

  // ---------- Input ----------
  document.addEventListener('mousemove', e => {
    mx = e.clientX / W;
    my = e.clientY / H;
  });
  document.addEventListener('touchmove', e => {
    if (!e.touches.length) return;
    mx = e.touches[0].clientX / W;
    my = e.touches[0].clientY / H;
  }, { passive: true });

  // ---------- Draw ----------
  function draw() {
    ctx.clearRect(0, 0, W, H);

    // Ease vanishing point toward target
    const tX = W * (0.5  + (mx - 0.5) * 0.18);
    const tY = H * (0.52 + (my - 0.5) * 0.11);
    svpX += (tX - svpX) * 0.055;
    svpY += (tY - svpY) * 0.055;

    const vpX   = svpX;
    const vpY   = svpY;
    const floor = H * 1.06;   // extend grid slightly below screen edge

    // ── Horizon glow ────────────────────────────────────────────────────
    const hg = ctx.createLinearGradient(0, vpY - 55, 0, vpY + 55);
    hg.addColorStop(0,    'rgba(232, 0, 110, 0)');
    hg.addColorStop(0.42, 'rgba(232, 0, 110, 0.125)');
    hg.addColorStop(0.5,  'rgba(232, 0, 110, 0.20)');
    hg.addColorStop(0.58, 'rgba(232, 0, 110, 0.125)');
    hg.addColorStop(1,    'rgba(232, 0, 110, 0)');
    ctx.fillStyle = hg;
    ctx.fillRect(0, vpY - 55, W, 110);

    // ── Vertical lines (converge to vanishing point) ─────────────────────
    const NUM_V = 22;
    for (let i = 0; i <= NUM_V; i++) {
      const t      = i / NUM_V;                        // 0 → 1
      const spread = (t - 0.5) * 3.4;                 // –1.7 → 1.7
      const bx     = vpX + spread * W * 0.65;

      // Lines near the centre are brighter
      const centre = 1 - Math.abs(t - 0.5) * 2;
      const alpha  = 0.12 + centre * 0.40;

      const g = ctx.createLinearGradient(vpX, vpY, bx, floor);
      g.addColorStop(0,    `rgba(232,  0, 110, 0)`);
      g.addColorStop(0.12, `rgba(210,  0, 150, ${alpha * 0.45})`);
      g.addColorStop(1,    `rgba(150,  0, 220, ${alpha})`);

      ctx.beginPath();
      ctx.moveTo(vpX, vpY);
      ctx.lineTo(bx,  floor);
      ctx.strokeStyle = g;
      ctx.lineWidth   = 0.75;
      ctx.stroke();
    }

    // ── Horizontal lines (scroll toward viewer) ──────────────────────────
    const NUM_H = 20;
    for (let i = 0; i < NUM_H; i++) {
      const raw = ((i / NUM_H) + offset) % 1;

      // Perspective compression: lines cluster near horizon
      const t  = Math.pow(raw, 2.4);
      const y  = vpY + (floor - vpY) * t;
      if (y <= vpY || y > H + 8) continue;

      const dt     = (y - vpY) / (floor - vpY);   // 0 = horizon, 1 = bottom
      const halfW  = dt * W * 1.12;
      const alpha  = dt * 0.70;

      const hl = ctx.createLinearGradient(vpX - halfW, y, vpX + halfW, y);
      hl.addColorStop(0,    `rgba(150,  0, 220, 0)`);
      hl.addColorStop(0.10, `rgba(200,  0, 160, ${alpha})`);
      hl.addColorStop(0.5,  `rgba(232,  0, 110, ${alpha * 1.2})`);
      hl.addColorStop(0.90, `rgba(200,  0, 160, ${alpha})`);
      hl.addColorStop(1,    `rgba(150,  0, 220, 0)`);

      ctx.beginPath();
      ctx.moveTo(vpX - halfW, y);
      ctx.lineTo(vpX + halfW, y);
      ctx.strokeStyle = hl;
      ctx.lineWidth   = 0.5 + dt * 1.5;
      ctx.stroke();
    }

    offset = (offset + SPEED) % 1;
    requestAnimationFrame(draw);
  }

  draw();
})();
