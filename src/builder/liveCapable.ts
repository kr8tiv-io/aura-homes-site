import { isPhoneClass, qualityProfile, type QualityTier } from '../three/quality';

const LIVE_TIERS = new Set<QualityTier>(['medium', 'high', 'ultra']);
const PHONE_TIERS = new Set<QualityTier>(['low', 'medium']);

function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function wideScreen(): boolean {
  return window.matchMedia('(min-width: 1024px)').matches;
}

function finePointer(): boolean {
  return window.matchMedia('(pointer: fine)').matches;
}

/**
 * Whether the meadow stage should open on its own.
 * Desktop, a fine pointer, a medium-or-better tier, and motion allowed.
 */
export function liveCapable(): boolean {
  if (typeof window === 'undefined') return false;
  if (reducedMotion()) return false;
  if (!wideScreen() || !finePointer()) return false;
  return LIVE_TIERS.has(qualityProfile().tier);
}

/**
 * A capable phone (low or medium, motion allowed) may open a light stage.
 * The button stays off while the desktop view is already live.
 */
export function liveOptInAvailable(): boolean {
  if (typeof window === 'undefined') return false;
  if (reducedMotion()) return false;
  if (liveCapable()) return false;
  if (!isPhoneClass()) return false;
  return PHONE_TIERS.has(qualityProfile().tier);
}
