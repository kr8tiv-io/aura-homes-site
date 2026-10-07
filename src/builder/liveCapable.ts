import { qualityProfile, type QualityTier } from '../three/quality';

const LIVE_TIERS = new Set<QualityTier>(['medium', 'high', 'ultra']);

function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function wideScreen(): boolean {
  return window.matchMedia('(min-width: 1024px)').matches;
}

function finePointer(): boolean {
  return window.matchMedia('(pointer: fine)').matches;
}

/** A finger, and no mouse or trackpad. A laptop with a touch screen stays a desktop. */
function touchOnly(): boolean {
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const fine = window.matchMedia('(any-pointer: fine)').matches;
  return coarse && !fine;
}

/**
 * Whether the meadow stage should open on its own.
 * Desktop, a fine pointer, a medium-or-better tier, and motion allowed.
 * Prompt 65 can loosen this for a lighter live stage on capable phones.
 */
export function liveCapable(): boolean {
  if (typeof window === 'undefined') return false;
  if (reducedMotion()) return false;
  if (!wideScreen() || !finePointer()) return false;
  return LIVE_TIERS.has(qualityProfile().tier);
}

/**
 * A touch device whose quality tier is still on. The stage stays behind a tap.
 * Phones are tier off today, so this stays false until that gate moves.
 */
export function liveOptInAvailable(): boolean {
  if (typeof window === 'undefined') return false;
  if (liveCapable()) return false;
  if (!touchOnly()) return false;
  return qualityProfile().tier !== 'off';
}
