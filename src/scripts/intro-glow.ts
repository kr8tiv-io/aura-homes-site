/** Soft Halo/Bronze bloom and a lerped cursor follow for the ceremonial intro. */
export function bindIntroGlow(root: HTMLElement): () => void {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  let targetX = 0.5;
  let targetY = 0.5;
  let x = 0.5;
  let y = 0.5;
  let raf = 0;
  let visible = true;
  const t0 = performance.now();

  const apply = () => {
    root.style.setProperty('--intro-mx', x.toFixed(4));
    root.style.setProperty('--intro-my', y.toFixed(4));
    root.style.setProperty('--intro-lift-x', `${((x - 0.5) * 6).toFixed(2)}px`);
    root.style.setProperty('--intro-lift-y', `${((y - 0.5) * 4).toFixed(2)}px`);
  };

  const tick = (now: number) => {
    if (!visible) {
      raf = 0;
      return;
    }
    if (!fine) {
      const t = (now - t0) / 1000;
      targetX = 0.5 + Math.sin(t * 0.32) * 0.07;
      targetY = 0.5 + Math.cos(t * 0.26) * 0.05;
    }
    x += (targetX - x) * 0.07;
    y += (targetY - y) * 0.07;
    apply();
    raf = requestAnimationFrame(tick);
  };

  const startLoop = () => {
    if (reduce || raf) return;
    raf = requestAnimationFrame(tick);
  };

  apply();
  if (reduce) return () => {};

  const onMove = (event: PointerEvent) => {
    const box = root.getBoundingClientRect();
    const w = box.width || 1;
    const h = box.height || 1;
    targetX = Math.min(1, Math.max(0, (event.clientX - box.left) / w));
    targetY = Math.min(1, Math.max(0, (event.clientY - box.top) / h));
  };
  if (fine) root.addEventListener('pointermove', onMove, { passive: true });

  const io = new IntersectionObserver(
    (entries) => {
      visible = entries.some((entry) => entry.isIntersecting);
      if (visible) startLoop();
    },
    { threshold: 0.05 },
  );
  io.observe(root);
  startLoop();

  return () => {
    io.disconnect();
    if (fine) root.removeEventListener('pointermove', onMove);
    if (raf) cancelAnimationFrame(raf);
  };
}
