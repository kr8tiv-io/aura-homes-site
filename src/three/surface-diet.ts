/*
  Which maps a material fetches. Desktop `full` returns the caller's list
  unchanged. Phones keep the diffuse map and skip the multi-megabyte normals.
*/
import { tierAssets } from './tier-assets';

export function surfaceFiles(full: readonly string[]): string[] {
  const pack = tierAssets().surfaces;
  if (pack === 'off') return [];
  if (pack === 'full') return [...full];
  return full.filter((name) => name === 'diff');
}
