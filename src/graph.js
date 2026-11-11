// The Map: a force-directed graph of notes (dots) and [[links]] (lines), drawn on a canvas.
// Pan by dragging the background, zoom with the wheel, drag a dot to move it, click a dot to select it.
(function () {
  const ACCENT = '#E0A458', FG = '#EEE8DF', NODE = '#8F887E', ORPHAN = '#5A554E';

  function create(canvas, data, opts) {
    const ctx = canvas.getContext('2d');
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const n = data.nodes.length;
    const nodes = data.nodes.map((d, i) => {
      const a = i * 2.399963, r = 26 * Math.sqrt(i + 1); // sunflower start: spread out, deterministic
      return { ...d, i, x: Math.cos(a) * r, y: Math.sin(a) * r, vx: 0, vy: 0, deg: 0, nb: new Set() };
    });
    const edges = data.edges.map(([a, b]) => { nodes[a].deg++; nodes[b].deg++; nodes[a].nb.add(b); nodes[b].nb.add(a); return [nodes[a], nodes[b]]; });
    nodes.forEach((d) => { d.r = 3 + Math.min(9, Math.sqrt(d.deg) * 1.7); });

    let scale = 1, tx = 0, ty = 0, alpha = 1, raf = 0, dead = false;
    let hover = null, selected = null, filter = '', drag = null, moved = false, w = 0, h = 0;

    function tick() {
      const sample = n > 900 ? 220 : 0; // big vaults: repel against a random sample each tick
      for (let i = 0; i < n; i++) {
        const a = nodes[i];
        const count = sample || n;
        for (let k = 0; k < count; k++) {
          const b = sample ? nodes[(Math.random() * n) | 0] : nodes[k];
          if (b === a) continue;
          let dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy;
          if (d2 < 1) { dx = Math.random() - .5; dy = Math.random() - .5; d2 = 1; }
          if (d2 > 160000) continue;
          const f = (sample ? 2600 * (n / sample) : 2600) / d2 * alpha;
          a.vx += dx * f * 0.05; a.vy += dy * f * 0.05;
        }
        a.vx -= a.x * 0.004 * alpha; a.vy -= a.y * 0.004 * alpha; // gentle pull to the middle
      }
      for (const [a, b] of edges) {
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
        const f = (d - 95) * 0.012 * alpha, fx = dx / d * f, fy = dy / d * f;
        a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
      }
      for (const d of nodes) {
        if (drag && drag.node === d) { d.vx = d.vy = 0; continue; }
        d.vx *= 0.82; d.vy *= 0.82;
        d.x += Math.max(-30, Math.min(30, d.vx)); d.y += Math.max(-30, Math.min(30, d.vy));
      }
      alpha *= 0.985;
    }

    function fit() {
      if (!n) return;
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const d of nodes) { x0 = Math.min(x0, d.x); x1 = Math.max(x1, d.x); y0 = Math.min(y0, d.y); y1 = Math.max(y1, d.y); }
      const pad = 90;
      scale = Math.max(0.15, Math.min(2.2, Math.min((w - pad * 2) / Math.max(1, x1 - x0), (h - pad * 2) / Math.max(1, y1 - y0))));
      tx = w / 2 - (x0 + x1) / 2 * scale; ty = h / 2 - (y0 + y1) / 2 * scale;
    }

    function draw() {
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.translate(tx, ty); ctx.scale(scale, scale);
      const focus = hover || selected;
      const lit = (d) => !focus || d === focus || focus.nb.has(d.i);
      const match = (d) => !filter || d.title.toLowerCase().includes(filter);
      ctx.lineWidth = 1 / scale;
      for (const [a, b] of edges) {
        const on = focus && (a === focus || b === focus);
        ctx.strokeStyle = on ? 'rgba(224,164,88,.7)' : focus || (filter && !(match(a) && match(b))) ? 'rgba(255,255,255,.035)' : 'rgba(255,255,255,.11)';
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      for (const d of nodes) {
        const dim = !lit(d) || !match(d);
        ctx.globalAlpha = dim ? 0.22 : 1;
        ctx.fillStyle = d === focus || d === selected || (filter && match(d)) ? ACCENT : d.deg ? NODE : ORPHAN;
        ctx.beginPath(); ctx.arc(d.x, d.y, d.r / Math.sqrt(scale), 0, Math.PI * 2); ctx.fill();
        if (d === selected) { ctx.strokeStyle = ACCENT; ctx.lineWidth = 1.5 / scale; ctx.beginPath(); ctx.arc(d.x, d.y, d.r / Math.sqrt(scale) + 4 / scale, 0, Math.PI * 2); ctx.stroke(); ctx.lineWidth = 1 / scale; }
      }
      ctx.globalAlpha = 1;
      // labels: the focused note and its neighbours, filter matches, and (when zoomed in) well-connected notes
      ctx.font = `${12 / scale}px "Instrument Sans", system-ui, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      for (const d of nodes) {
        const show = focus ? (d === focus || focus.nb.has(d.i)) : filter ? match(d) : (scale > 1.25 || d.deg >= 4 || n <= 40);
        if (!show) continue;
        ctx.fillStyle = d === focus ? FG : 'rgba(238,232,223,.72)';
        const t = d.title.length > 30 ? d.title.slice(0, 29) + '…' : d.title;
        ctx.fillText(t, d.x, d.y + d.r / Math.sqrt(scale) + 5 / scale);
      }
    }

    function frame() {
      raf = 0;
      if (dead) return;
      if (alpha > 0.02) { tick(); if (!userMoved) fit(); }
      draw();
      if (alpha > 0.02 || drag) raf = requestAnimationFrame(frame);
    }
    let userMoved = false;
    const kick = () => { if (!raf && !dead) raf = requestAnimationFrame(frame); };

    function resize() {
      const r = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
      if (!r.width || !r.height) return;
      const first = !w;
      w = r.width; h = r.height;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      if (first) fit();
      draw();
    }
    const ro = new ResizeObserver(resize); ro.observe(canvas);

    const toWorld = (e) => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left - tx) / scale, y: (e.clientY - r.top - ty) / scale }; };
    function pick(e) {
      const p = toWorld(e); let best = null, bd = Infinity;
      for (const d of nodes) {
        const dx = d.x - p.x, dy = d.y - p.y, dist = Math.sqrt(dx * dx + dy * dy), reach = d.r / Math.sqrt(scale) + 6 / scale;
        if (dist < reach && dist < bd) { best = d; bd = dist; }
      }
      return best;
    }
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId); moved = false;
      const node = pick(e);
      drag = { node, sx: e.clientX, sy: e.clientY, tx, ty };
      canvas.classList.add('grabbing');
    });
    canvas.addEventListener('pointermove', (e) => {
      if (drag) {
        if (Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) > 4) moved = true;
        if (drag.node) { const p = toWorld(e); drag.node.x = p.x; drag.node.y = p.y; if (moved) alpha = Math.max(alpha, 0.25); }
        else { tx = drag.tx + e.clientX - drag.sx; ty = drag.ty + e.clientY - drag.sy; userMoved = true; }
        kick(); draw(); return;
      }
      const hit = pick(e);
      if (hit !== hover) { hover = hit; canvas.classList.toggle('pointing', !!hit); draw(); }
    });
    canvas.addEventListener('pointerup', (e) => {
      const d = drag; drag = null; canvas.classList.remove('grabbing');
      if (d && !moved) { selected = d.node || null; opts.onSelect && opts.onSelect(selected ? info(selected) : null); draw(); }
    });
    canvas.addEventListener('pointerleave', () => { if (hover && !drag) { hover = null; draw(); } });
    canvas.addEventListener('dblclick', (e) => { const d = pick(e); if (d && opts.onOpen) opts.onOpen(d.id); });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
      zoomAt(mx, my, Math.exp(-e.deltaY * 0.0015));
    }, { passive: false });
    function zoomAt(mx, my, k) {
      const ns = Math.max(0.1, Math.min(5, scale * k));
      tx = mx - (mx - tx) * (ns / scale); ty = my - (my - ty) * (ns / scale); scale = ns; userMoved = true; draw();
    }
    const info = (d) => ({ id: d.id, title: d.title, folder: d.folder, links: d.deg });

    if (reduce) { for (let k = 0; k < 260; k++) tick(); alpha = 0; }
    resize(); kick();

    return {
      destroy() { dead = true; cancelAnimationFrame(raf); ro.disconnect(); },
      zoom(k) { zoomAt(w / 2, h / 2, k); },
      fit() { userMoved = false; fit(); draw(); },
      setFilter(q) { filter = String(q || '').toLowerCase().trim(); draw(); },
      select(id) {
        const d = nodes.find((x) => x.id === id) || null;
        selected = d; opts.onSelect && opts.onSelect(d ? info(d) : null);
        if (d) { fit(); userMoved = true; scale = Math.min(1.6, Math.max(scale, 1.15)); tx = w / 2 - d.x * scale; ty = h / 2 - d.y * scale; }
        draw();
      },
      settle() { for (let k = 0; k < 260; k++) tick(); alpha = 0; fit(); draw(); },
      counts: { notes: n, links: edges.length }
    };
  }
  window.RookGraph = { create };
})();
