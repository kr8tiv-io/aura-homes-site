import { gsap } from 'gsap';
import { SplitText } from 'gsap/SplitText';
import { ScrollTrigger, duration, ease, holdPageMotion, prefersReducedMotion } from './motion';

gsap.registerPlugin(SplitText, ScrollTrigger);

const DISPLAY_PX = 40;
const TRACK_EM = 0.03;
const RISE = 125;

type Job = {
  heading: HTMLElement;
  split: SplitText | null;
  tween: gsap.core.Animation | null;
  watch: MutationObserver | null;
  done: boolean;
};

const jobs = new Set<Job>();

let refreshQueued = false;

function queueRefresh() {
  if (refreshQueued) return;
  refreshQueued = true;
  requestAnimationFrame(() => {
    refreshQueued = false;
    resync();
  });
}

/** A heading can cross the start line before its pictures take their height. Rewind it. */
function resync() {
  ScrollTrigger.refresh();
  const limit = window.innerHeight * 0.9;
  for (const job of jobs) {
    const tween = job.tween;
    const trigger = tween?.scrollTrigger;
    if (job.done || !tween || !trigger) continue;
    if (tween.progress() === 0) continue;
    if (job.heading.getBoundingClientRect().top <= limit) continue;
    trigger.disable(false);
    tween.pause(0);
    delete job.heading.dataset.revealPlayed;
    trigger.enable();
  }
}

let loadHooked = false;

function hookLoad() {
  if (loadHooked || typeof window === 'undefined') return;
  loadHooked = true;
  window.addEventListener('load', () => resync(), { once: true });
}

function release(job: Job) {
  if (job.done) return;
  job.done = true;
  job.watch?.disconnect();
  job.watch = null;
  const reactOwned = Boolean(job.heading.closest('#byo-root'));
  if (reactOwned) job.split?.kill();
  else job.split?.revert();
  job.split = null;
  jobs.delete(job);
}

function ensureJob(heading: HTMLElement) {
  for (const job of jobs) {
    if (job.heading === heading && !job.done) return job;
  }
  const job: Job = { heading, split: null, tween: null, watch: null, done: false };
  jobs.add(job);
  holdPageMotion(() => release(job));
  return job;
}

function dropDetached() {
  for (const job of jobs) {
    if (!job.heading.isConnected) release(job);
  }
}

function isDisplay(heading: HTMLElement, target: HTMLElement) {
  const flag = heading.dataset.revealDisplay;
  if (flag === 'yes') return true;
  if (flag === 'no') return false;
  if (heading.tagName === 'H1') return true;
  return (parseFloat(getComputedStyle(target).fontSize) || 0) >= DISPLAY_PX;
}

function tracking(target: HTMLElement) {
  const style = getComputedStyle(target);
  const font = parseFloat(style.fontSize) || 16;
  const raw = style.letterSpacing;
  const current = raw === 'normal' || raw === '' ? 0 : parseFloat(raw);
  const to = Number.isFinite(current) ? current : 0;
  return { from: `${to + font * TRACK_EM}px`, to: `${to}px` };
}

function settle(lines: Element[], display: boolean, track: { to: string }) {
  gsap.set(lines, {
    yPercent: 0,
    ...(display ? { letterSpacing: track.to } : {}),
  });
}

function armVisible(job: Job, host: HTMLElement, tween: { play: () => unknown }) {
  const play = () => {
    if (job.done || job.heading.dataset.revealPlayed === 'yes') return;
    const style = getComputedStyle(host);
    const opacity = parseFloat(style.opacity);
    if (style.visibility === 'hidden' || !Number.isFinite(opacity) || opacity < 0.2) return;
    tween.play();
  };
  job.watch?.disconnect();
  const observer = new MutationObserver(play);
  job.watch = observer;
  observer.observe(host, { attributes: true, attributeFilter: ['style', 'class'] });
  play();
}

function watchHidden(heading: HTMLElement, hidden: HTMLElement) {
  if (heading.dataset.revealWatch === 'yes') return;
  heading.dataset.revealWatch = 'yes';
  const job = ensureJob(heading);
  const observer = new MutationObserver(() => {
    if (hidden.hasAttribute('hidden')) return;
    observer.disconnect();
    job.watch = null;
    delete heading.dataset.revealWatch;
    mount(heading);
    queueRefresh();
  });
  job.watch = observer;
  observer.observe(hidden, { attributes: true, attributeFilter: ['hidden'] });
}

function mount(heading: HTMLElement) {
  if (!heading.isConnected) return;
  if (heading.dataset.revealBound === 'yes') return;
  if (prefersReducedMotion()) {
    heading.dataset.revealBound = 'yes';
    heading.dataset.revealReady = 'yes';
    return;
  }

  const hidden = heading.closest<HTMLElement>('[hidden]');
  if (hidden) {
    watchHidden(heading, hidden);
    return;
  }

  if (document.fonts && document.fonts.status === 'loading') {
    if (heading.dataset.revealWait === 'yes') return;
    heading.dataset.revealWait = 'yes';
    document.fonts.ready.then(() => {
      delete heading.dataset.revealWait;
      mount(heading);
    });
    return;
  }

  const target = heading.querySelector<HTMLElement>('[data-reveal-target]') ?? heading;
  if (!target.textContent?.trim()) return;
  const tries = Number(heading.dataset.revealTries || '0');
  if (target.offsetWidth < 2) {
    if (tries >= 8) {
      heading.dataset.revealBound = 'yes';
      heading.dataset.revealReady = 'yes';
      return;
    }
    heading.dataset.revealTries = String(tries + 1);
    requestAnimationFrame(() => mount(heading));
    return;
  }

  const display = isDisplay(heading, target);
  const track = tracking(target);
  const job = ensureJob(heading);
  heading.dataset.revealBound = 'yes';

  const split = SplitText.create(target, {
    type: 'lines,words',
    mask: 'lines',
    linesClass: 'reveal-line',
    wordsClass: 'reveal-word',
    aria: target.closest('button') ? 'none' : 'auto',
    autoSplit: true,
    deepSlice: true,
    onSplit(self) {
      job.watch?.disconnect();
      job.watch = null;
      const lines = self.lines;
      if (!lines.length) {
        heading.dataset.revealReady = 'yes';
        return;
      }
      if (heading.dataset.revealPlayed === 'yes') {
        settle(lines, display, track);
        job.tween = null;
        heading.dataset.revealReady = 'yes';
        return;
      }
      const from: gsap.TweenVars = { yPercent: RISE };
      const to: gsap.TweenVars = { yPercent: 0 };
      if (display) {
        from.letterSpacing = track.from;
        to.letterSpacing = track.to;
      }
      const visibleHost =
        heading.dataset.revealWhen === 'visible'
          ? heading.closest<HTMLElement>('.b-plate')
          : null;
      const tween = gsap.fromTo(lines, from, {
        ...to,
        duration: duration.rise,
        ease: ease.out,
        stagger: 0.06,
        immediateRender: true,
        paused: Boolean(visibleHost),
        onComplete() {
          heading.dataset.revealPlayed = 'yes';
        },
        ...(visibleHost
          ? {}
          : {
              scrollTrigger: {
                trigger: heading,
                start: 'top 86%',
                toggleActions: 'play none none none',
              },
            }),
      });
      job.tween = tween;
      if (visibleHost) armVisible(job, visibleHost, tween);
      heading.dataset.revealReady = 'yes';
      return tween;
    },
  });
  job.split = split;
}

/** Split every reveal heading under root. Safe to call again after a swap. */
export function bindRevealHeadings(root: ParentNode = document) {
  dropDetached();
  const headings = root.querySelectorAll<HTMLElement>('[data-reveal-heading]');
  let made = false;
  headings.forEach((heading) => {
    if (heading.dataset.revealBound === 'yes' || heading.dataset.revealWatch === 'yes') return;
    made = true;
    mount(heading);
  });
  if (made) {
    hookLoad();
    queueRefresh();
  }
}
