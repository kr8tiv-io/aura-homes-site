const KEY = 'aura-ridge';

export function bindRidgeLoad() {
  const load = document.querySelector<HTMLElement>('[data-ridge-load]');
  if (!load || load.dataset.bound === 'yes') return;
  load.dataset.bound = 'yes';
  if (document.documentElement.classList.contains('ridge-seen')) return;
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    /* the moment can play without a memory */
  }
  let closed = false;
  const done = () => {
    if (closed) return;
    closed = true;
    document.documentElement.classList.add('ridge-seen');
  };
  load.addEventListener('animationend', (event) => {
    if (event.target === load) done();
  });
  window.setTimeout(done, 1100);
}
