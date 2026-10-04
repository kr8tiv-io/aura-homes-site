/** Optional forest loop. Off until a person asks, then remembered on this browser. */

const KEY = 'aura-ambient';
const EVENT = 'aura-ambient';

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function ambientWanted(): boolean {
  return storage()?.getItem(KEY) === 'on';
}

function audio(): HTMLAudioElement | null {
  const el = document.getElementById('ambient-audio');
  return el instanceof HTMLAudioElement ? el : null;
}

function paint(on: boolean) {
  document.querySelectorAll<HTMLButtonElement>('[data-ambient]').forEach((button) => {
    button.setAttribute('aria-pressed', on ? 'true' : 'false');
    button.setAttribute('aria-label', on ? 'Forest sound, on' : 'Forest sound, off');
  });
  document.dispatchEvent(new CustomEvent(EVENT, { detail: { on } }));
}

let resumePointer: ((event: Event) => void) | null = null;
let resumeKey: ((event: Event) => void) | null = null;

function disarmResume() {
  if (resumePointer) window.removeEventListener('pointerdown', resumePointer, true);
  if (resumeKey) window.removeEventListener('keydown', resumeKey, true);
  resumePointer = null;
  resumeKey = null;
}

function fromToggle(event: Event): boolean {
  const target = event.target;
  return target instanceof Element && !!target.closest('[data-ambient]');
}

function armResume() {
  if (resumePointer) return;
  resumePointer = (event: Event) => {
    if (fromToggle(event)) return;
    disarmResume();
    if (ambientWanted()) void play();
  };
  resumeKey = (event: Event) => {
    if (fromToggle(event)) return;
    disarmResume();
    if (ambientWanted()) void play();
  };
  window.addEventListener('pointerdown', resumePointer, true);
  window.addEventListener('keydown', resumeKey, true);
}

async function play(): Promise<boolean> {
  const el = audio();
  if (!el) return false;
  el.loop = true;
  el.volume = 0.35;
  if (!el.paused && el.currentTime > 0) return true;
  try {
    await el.play();
    return true;
  } catch {
    armResume();
    return false;
  }
}

/** Turns the shared loop on or off. The returned flag is the saved preference. */
export async function setAmbient(on: boolean): Promise<boolean> {
  const el = audio();
  storage()?.setItem(KEY, on ? 'on' : 'off');
  if (!on) {
    disarmResume();
    el?.pause();
    paint(false);
    return false;
  }
  paint(true);
  await play();
  return true;
}

export function bindAmbient() {
  const button = document.querySelector<HTMLButtonElement>('[data-ambient]');
  if (button && button.dataset.bound !== 'yes') {
    button.dataset.bound = 'yes';
    button.addEventListener('click', () => {
      void setAmbient(!ambientWanted());
    });
  }
  if (!ambientWanted()) {
    paint(false);
    return;
  }
  paint(true);
  void play();
}
