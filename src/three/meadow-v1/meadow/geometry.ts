/**
 * ONE description of the built world's footprint on the ground plane.
 *
 * The steel skid and the tub are the only things the meadow must stay out of.
 * The deck, the glass walkway, the entrance steps, the path, the bench and
 * the fire pit used to carry their own copies of the same numbers, and twice
 * those copies drifted until grass stood through solid geometry. This module
 * is the single list, so the mask and the slots cannot drift apart.
 *
 * RULES FOR THIS FILE
 * - Plain numbers only. No three.js, no React, no runtime dependency of any
 *   kind: scripts/generate-meadow-atlas.mjs imports it directly from Node
 *   (type-stripped), so anything unerasable or importable-only-by-a-bundler
 *   breaks the offline build.
 * - Footprints live here. PADS and FEATHERS do not. Each consumer feathers
 *   its own way (tall hero blades keep a wide berth, short filler hugs the
 *   boxes).
 * - Moving a number here moves the slot and the mask together.
 */

/** Axis-aligned ground rectangle, x0 <= x1 and z0 <= z1. */
export type GroundRect = {
  readonly x0: number;
  readonly z0: number;
  readonly x1: number;
  readonly z1: number;
};

/** A ground point features are measured from. */
export type GroundPoint = { readonly x: number; readonly z: number };

/**
 * The Aura unit: a steel skid, 2.4 m across and 6 m long, sitting where the
 * A-frame stood. Length runs along z, toward the trail. The group named
 * AuraUnitSlot is placed at the centre. Prompts 50 and 51 fill the slot.
 */
export const UNIT_WIDTH = 2.4;
export const UNIT_LENGTH = 6;

export const UNIT_RECT: GroundRect = {
  x0: -UNIT_WIDTH / 2,
  z0: -UNIT_LENGTH / 2,
  x1: UNIT_WIDTH / 2,
  z1: UNIT_LENGTH / 2,
};

/** Centre of the skid, in ground metres. */
export const AURA_UNIT_SLOT: GroundPoint = { x: 0, z: 0 };

/**
 * The tub, about 1.8 m across, beside the skid on the east side. The group
 * named HotTubSlot is placed at this centre. Grass stays outside the disc.
 */
export const TUB_DIAMETER = 1.8;
export const TUB_RADIUS = TUB_DIAMETER / 2;
export const TUB_CENTER: GroundPoint = { x: 5.9, z: 5.4 };
export const HOT_TUB_SLOT: GroundPoint = TUB_CENTER;

/** True when `inner` lies entirely inside `outer`. */
export const rectContains = (outer: GroundRect, inner: GroundRect): boolean =>
  outer.x0 <= inner.x0 && outer.z0 <= inner.z0 && outer.x1 >= inner.x1 && outer.z1 >= inner.z1;

/**
 * Every mesh footprint paired with the mask that has to cover it.
 * The tub is a disc, tested by radius, so it is not in this list.
 */
export const MASKED_FOOTPRINTS: readonly {
  readonly name: string;
  readonly mask: GroundRect;
  readonly mesh: GroundRect;
}[] = [{ name: 'aura unit', mask: UNIT_RECT, mesh: UNIT_RECT }];
