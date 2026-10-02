"use client";

import { useMemo, useRef, useState, useLayoutEffect } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { useGLTF, Sparkles, Html, Environment, SoftShadows } from "@react-three/drei";
import { EffectComposer, Bloom, Vignette, Noise } from "@react-three/postprocessing";
const withBase = (p: string) => p.replace("/models/", "/models/builder/");
import SceneDetail, { meadowShade, trailTrodden } from "./SceneDetail";

/* ------------------------------------------------------------------ */
/* One continuous camera journey (kage-inspired motion, ours in every  */
/* other way): a CatmullRom spline over real topography — start low    */
/* behind the ridge, crest it to reveal the home, descend, approach,   */
/* rise onto the deck, glide the glass walkway to the tub, settle.     */
/* Beats land exactly on even-indexed control points.                  */
/* ------------------------------------------------------------------ */

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const near = (prog: number, k: number, width = 0.85) => smoothstep(0, 1, clamp01(1 - Math.abs(prog - k) / width));

/* Deterministic terrain height — shared by the mesh, the props, and the rig.
   Exported so the detail layer plants on exactly the same ground. */
export function terrainH(x: number, z: number): number {
  const r = Math.hypot(x, z);
  const ridge =
    4.6 *
    Math.exp(-Math.pow(z - 25, 2) / (2 * 5.5 * 5.5)) *
    (1 - clamp01((Math.abs(x) - 16) / 24) * 0.75);
  const t = clamp01((r - 13) / 30);
  let roll =
    t *
    t *
    (Math.sin(x * 0.16 + 1.7) * Math.cos(z * 0.13 - 0.6) +
      0.5 * Math.sin(x * 0.31 - 2.2) * Math.sin(z * 0.27 + 1.1)) *
    1.5;
  roll *= 1 - clamp01(ridge / 1.2) * 0.85;
  return ridge + roll;
}

type Ctrl = { p: [number, number, number]; t: [number, number, number]; fov: number; ground?: number };

/* 13 control points; beats at even indices (hero=0 … end=12). `ground`
   means the y given is an eye-height offset above the terrain.
   The whole journey stays on the FRONT side of the home — the camera never
   crosses the building, so the spline can never clip the roof. */
const CTRL: Ctrl[] = [
  { p: [-2.0, 2.5, 31.5], t: [0.4, 4.7, 20.0], fov: 36, ground: 1 }, // 0 hero — low at the trailhead
  { p: [-0.8, 2.4, 27.5], t: [0.2, 4.9, 18.5], fov: 36, ground: 1 }, //   climbing
  { p: [0.6, 2.6, 23.5], t: [0.0, 1.6, 0.0], fov: 40, ground: 1 }, // 1 LAND — crest reveal
  { p: [-3.4, 2.2, 17.4], t: [0.0, 2.0, 0.8], fov: 41, ground: 1 }, //   descending past the pines
  { p: [-5.2, 2.0, 12.2], t: [0.5, 2.6, 1.8], fov: 41, ground: 1 }, // 2 DESIGN — front-left; lounge stays left-of-frame
  { p: [-1.0, 3.0, 12.6], t: [0.4, 1.9, 1.4], fov: 43, ground: 1 }, //   swinging across the lawn
  { p: [7.4, 5.6, 13.6], t: [0.0, 1.8, 1.6], fov: 44 }, // 3 BUDGET — elevated 3/4, whole property
  { p: [4.4, 2.2, 9.8], t: [0.6, 1.8, 4.4], fov: 42, ground: 1 }, //   coming down to the lawn
  { p: [0.8, 1.8, 8.3], t: [0.2, 2.0, 3.8], fov: 41, ground: 1 }, // 4 ESCROW — at the foot of the steps
  { p: [0.3, 2.35, 5.7], t: [4.6, 1.1, 5.3], fov: 42 }, //   up the steps, eyes on the walkway
  { p: [5.6, 2.0, 7.6], t: [0.6, 2.1, 2.8], fov: 42 }, // 5 BUILD — past the tub, looking back home
  { p: [7.4, 2.4, 9.4], t: [0.4, 2.2, 1.8], fov: 40 }, //   drifting out the northeast corner
  { p: [9.4, 4.3, 13.4], t: [0.2, 2.2, 1.2], fov: 37 }, // 6 END — settle, dusk
];

const REDUCED_SHOT = { p: [9.4, 4.3, 13.4], t: [0.2, 2.2, 1.2], fov: 38 } as const;

/* ------------------------------ assets ------------------------------ */

const MODELS = {
  cabin: withBase("/models/cabin.glb"),
  pines: withBase("/models/pines.glb"),
  pineTeal: withBase("/models/pine-teal.glb"),
  campfire: withBase("/models/campfire.glb"),
  rocks: withBase("/models/rocks.glb"),
  lantern: withBase("/models/lantern.glb"),
};

useGLTF.preload(MODELS.cabin);
useGLTF.preload(MODELS.pines);
useGLTF.preload(MODELS.pineTeal);
useGLTF.preload(MODELS.campfire);
useGLTF.preload(MODELS.rocks);
useGLTF.preload(MODELS.lantern);

function useNormalizedClones(
  src: THREE.Object3D,
  height: number,
  placements: { pos: [number, number, number]; rotY?: number; scale?: number }[],
  opts: { shadows?: boolean; ground?: boolean } = {}
) {
  const { shadows = true, ground = true } = opts;
  return useMemo(() => {
    const box = new THREE.Box3().setFromObject(src);
    const size = new THREE.Vector3();
    box.getSize(size);
    const center = new THREE.Vector3();
    box.getCenter(center);
    const k = height / (size.y || 1);
    return placements.map(({ pos, rotY = 0, scale = 1 }) => {
      const obj = src.clone(true);
      obj.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          o.castShadow = shadows;
          o.receiveShadow = shadows;
        }
      });
      const g = new THREE.Group();
      obj.position.set(-center.x * k * scale, -box.min.y * k * scale, -center.z * k * scale);
      obj.scale.setScalar(k * scale);
      g.add(obj);
      const y = ground ? terrainH(pos[0], pos[2]) - 0.06 + pos[1] : pos[1];
      g.position.set(pos[0], y, pos[2]);
      g.rotation.y = rotY;
      return g;
    });
  }, [src, height, placements, shadows, ground]);
}

/* ----------------------------- materials ---------------------------- */

/** Big architectural glass — real transmission, used only on the gables. */
function useArchGlass() {
  return useMemo(() => {
    const m = new THREE.MeshPhysicalMaterial({
      transmission: 0.94,
      roughness: 0.06,
      ior: 1.5,
      thickness: 0.4,
      color: new THREE.Color("#e4f4ee"),
      envMapIntensity: 1.3,
      side: THREE.DoubleSide,
    });
    return m;
  }, []);
}

/* ---------------------------------------------------------------------
   GLASS, AND THE BRIDGE FLICKER

   The walkway to the tub used to strobe as you approached it. Two separate
   bugs stacked, and both had to go:

   1. SORT THRASH. One shared material with `depthWrite:false` meant every
      glass surface — walkway deck, its two rails, the deck panel, the deck
      rails — landed in three's transparent bucket and got re-sorted by
      centroid distance EVERY frame. Walking the bridge swept the camera
      through the point where those centroids swap, so the order flipped
      back and forth and the panels visibly popped over each other.
   2. Z-FIGHTING. The walkway glass spanned y 0.385–0.455 and its steel
      frame 0.335–0.385 — coplanar to the micron at 0.385. The deck panel
      (0.40–0.48) and its frame (0.35–0.41) actually interpenetrated.

   The fix is to stop treating structural glass and balustrade glass as the
   same thing. Floors are walked on and read as solid: they write depth and
   carry a pinned renderOrder, so their order is deterministic instead of
   camera-dependent. Rails are thin and must layer, so they keep depthWrite
   off — but they sit in a later renderOrder band, so they always resolve
   after the floors rather than racing them. polygonOffset pushes the glass
   a hair off any frame it shares a plane with, and the frames below were
   dropped to leave real air between the surfaces.
--------------------------------------------------------------------- */

/** Structural glass — walkway deck, deck floor panel. Writes depth. */
function useGlassFloor() {
  return useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        transparent: true,
        opacity: 0.34,
        roughness: 0.05,
        metalness: 0,
        color: new THREE.Color("#dcf5ec"),
        envMapIntensity: 1.5,
        side: THREE.DoubleSide,
        depthWrite: true,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    []
  );
}

/** Balustrade glass — rails only. Thin, layered, never writes depth.
 *
 *  THE "TWO-TONE DECK". Critics read the deck as pale beige on the left and
 *  saturated orange on the right, butted along a razor-straight vertical
 *  seam, and called it a UV or material-assignment bug. It is not: the deck
 *  is one run of planks with one material. The seam is THIS glass. The front
 *  balustrade runs x -3.6 to -1.1 and stops at the step opening, and every
 *  plank behind it was being tinted by a pane the viewer could not see —
 *  DoubleSide meant each ray crossed two rendered faces, so an "0.2" pane
 *  was really ~0.36, and envMapIntensity 1.6 added a bright reflective wash
 *  on top. The pane ends at x -1.1; so did the wash. Fixed at the cause:
 *  single-sided, 0.11, and a calmer reflection. Verified by cropping the
 *  seam, not by assuming.
 */
function useGlassRail() {
  return useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        transparent: true,
        opacity: 0.11,
        roughness: 0.05,
        metalness: 0,
        color: new THREE.Color("#eaf4f0"),
        envMapIntensity: 0.85,
        side: THREE.FrontSide,
        depthWrite: false,
      }),
    []
  );
}

/* Deterministic transparent ordering. Floors resolve before rails, always. */
const RO_GLASS_FLOOR = 10;
const RO_GLASS_RAIL = 20;

/* ----------------------------- terrain ------------------------------ */

/* TERRAIN v2.

   Per-blade grass can only reach so far before a blade is smaller than a
   texel; past that the ground has to carry the meadow by itself, and v1's
   ground was two very low-frequency sine waves — smooth enough that the
   far field read as a bare painted plane. The tint function keeps those two
   waves EXACTLY (the grass shader mirrors them in GLSL so a blade's root is
   the colour of the soil it grows from, and the two must not drift), and
   adds a high-frequency mottle on top plus a per-facet value jitter. At
   ~0.8 m per vertex that mottle is what a meadow looks like from 40 m. */
function Terrain() {
  const floor = useMemo(() => makeMeadowFloor(), []);
  const geo = useMemo(() => {
    const SEG = 200;
    const g = new THREE.PlaneGeometry(170, 170, SEG, SEG);
    g.rotateX(-Math.PI / 2);
    const p = g.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(p.count * 3);
    const cA = new THREE.Color("#8db284");
    const cB = new THREE.Color("#a4c295");
    const cC = new THREE.Color("#b7c489");
    /* Trodden earth for the walked trail — pale straw-tan, inside the
       scene's warm-neutral family (cedar/stone), never orange. */
    const cEarth = new THREE.Color("#b9aa8a");
    /* v9: the sward's own root green. The lawn palette above is a PALE
       YELLOW-sage — correct for open lawn, but between blades it read as
       dirt showing through and the founder called the whole field patchy.
       Where the meadow grows, the ground now shifts HUE toward this deep
       blade-root green as well as dropping in value (below), so a gap
       between blades is the colour of shadowed understorey, not soil.
       GRASS_VERT's vGround mirrors this exact linear value. */
    const cSward = new THREE.Color("#4d6a42");
    const tmp = new THREE.Color();
    const hash = (x: number, z: number) => {
      const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
      return s - Math.floor(s);
    };
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const z = p.getZ(i);
      p.setY(i, terrainH(x, z));
      // — the shared base, mirrored verbatim in GRASS_VERT.groundColor —
      const n1 = 0.5 + 0.5 * Math.sin(x * 0.23 + z * 0.17 + 1.2);
      const n2 = 0.5 + 0.5 * Math.sin(x * 0.61 - z * 0.43 + 4.0);
      tmp.copy(cA).lerp(cB, n1).lerp(cC, n2 * 0.25);
      /* the walked line earths over — a trail, not a stripe of missing
         grass. Slightly noise-broken edge so it never reads vector-crisp. */
      const trod = trailTrodden(x, z);
      if (trod > 0) tmp.lerp(cEarth, trod * (0.68 + 0.14 * Math.sin(x * 3.1 + z * 2.3)));
      // — meadow mottle: two high frequencies plus per-facet jitter —
      const m =
        0.5 * Math.sin(x * 1.9 + z * 1.4) +
        0.3 * Math.sin(x * 4.3 - z * 3.1 + 2.2) +
        0.7 * (hash(Math.floor(x * 1.3), Math.floor(z * 1.3)) - 0.5);
      const v = 1 + m * 0.075;
      /* Where the meadow grows, the ground darkens toward the sward's own
         shadow (Codrops fluffiest-grass: match terrain to grass, dark base
         as fake AO). Gaps between blades then read as depth under the
         canopy instead of bare lawn. clearance() keeps the mown path, the
         deck aprons and the fire-pit ring at full lawn brightness, so the
         walked places still read walked.

         v9 REPLACES the old "0.22 MUST match vGround's 0.22" invariant.
         The founder's v8 verdict — "I can still see the ground and it looks
         really patchy" — was the pale-yellow lawn tone showing between
         blades. Matching terrain to blade ROOTS exactly is what kept the
         gaps as bright as the sward; the Codrops technique wants the ground
         BELOW the root tone so a gap is a shadow. So the meadow ground now
         (a) hue-shifts toward cSward and (b) drops ~32% in value, while
         vGround in GRASS_VERT does the same move at ~3/4 strength — blade
         roots sit a shade ABOVE the ground they grow from, and the gap
         reads as depth under the canopy. Deliberate offset, not drift. */
      const ms = meadowShade(x, z);
      /* Founder "smooth, no spacing" round: the ground under the meadow drops
         deeper toward the sward's own shadow (hue 0.45->0.52, value 0.32->0.40)
         so the pale terrain that used to peek between blades now reads as
         understorey shadow. GRASS_VERT.vGround deepens in lockstep at ~3/4
         strength so a blade root still sits a shade ABOVE the ground it grows
         from — gaps are shadow, not soil, not bare lawn. */
      tmp.lerp(cSward, ms * 0.55);
      const shade = 1 - 0.44 * ms;
      colors[i * 3] = tmp.r * v * shade;
      colors[i * 3 + 1] = tmp.g * (1 + m * 0.055) * shade;
      colors[i * 3 + 2] = tmp.b * v * shade;
    }
    g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    g.computeVertexNormals();
    return g;
  }, []);
  return (
    <mesh geometry={geo} receiveShadow>
      <meshStandardMaterial map={floor} vertexColors flatShading roughness={1} metalness={0} />
    </mesh>
  );
}

/* --------------------------- soft sprites --------------------------- */

function useSoftTexture(stops: [number, string][]) {
  return useMemo(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const ctx = c.getContext("2d")!;
    const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    for (const [o, col] of stops) grad.addColorStop(o, col);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, [stops]);
}

/* ------------------------ procedural materials ----------------------
   The founder's "texture pass on everything else" round. The built world
   was flat-shaded solid colour, which reads as plastic next to the grass.
   These three factories add procedural surface detail — no downloaded
   textures, no payload, nothing to credit. Each is built once and shared.
   All are LOW-CONTRAST and multiply the existing palette colour, so the
   light/emerald brand is untouched: they add grain and life, not hue. */

const _hash = (seed: number) => {
  let s = seed;
  return () => {
    s = Math.sin(s * 91.7 + 13.1) * 43758.5453;
    return s - Math.floor(s);
  };
};

/** Milled-cedar grain — mostly light, so `map * color` keeps the per-piece
 *  cedar tone and just carves long grain, faint cathedral figure and pore
 *  speckle into it. Streaks run along U, so it is applied ONLY where U is the
 *  plank's length (deck planks, step treads) and the grain direction is right. */
let _woodGrain: THREE.CanvasTexture | null = null;
export function makeWoodGrain(): THREE.CanvasTexture {
  if (_woodGrain) return _woodGrain;
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  const rnd = _hash(7.13);
  ctx.fillStyle = "#f0f0f0";
  ctx.fillRect(0, 0, 256, 128);
  // long grain lines, gently wavering so they are never ruler-straight
  for (let i = 0; i < 52; i++) {
    const y = rnd() * 128;
    const g = Math.floor((0.78 + rnd() * 0.18) * 255);
    ctx.strokeStyle = `rgba(${g},${g},${g},${0.22 + rnd() * 0.4})`;
    ctx.lineWidth = 0.5 + rnd() * 1.5;
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= 256; x += 16) ctx.lineTo(x, y + Math.sin(x * 0.05 + i) * (1.0 + rnd()));
    ctx.stroke();
  }
  // a few darker cathedral arcs for figure
  for (let i = 0; i < 3; i++) {
    const cy = 20 + rnd() * 88;
    ctx.strokeStyle = "rgba(150,138,124,0.10)";
    ctx.lineWidth = 2 + rnd() * 3;
    ctx.beginPath();
    for (let x = 0; x <= 256; x += 8) ctx.lineTo(x, cy + Math.sin(x * 0.017 + i * 2) * 20);
    ctx.stroke();
  }
  // fine pore speckle
  for (let i = 0; i < 1100; i++) {
    const g = 205 + Math.floor(rnd() * 40);
    ctx.fillStyle = `rgba(${g},${g},${g},0.10)`;
    ctx.fillRect(rnd() * 256, rnd() * 128, 1, 1);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 1.4);
  t.anisotropy = 4;
  _woodGrain = t;
  return t;
}

/** Quarried-stone mottle — soft isotropic blotches, so it can go on rock
 *  faces at any orientation. Multiplies the grey stone colour to break the
 *  dead-flat facets into weathered stone without shifting hue. */
let _stoneMottle: THREE.CanvasTexture | null = null;
export function makeStoneMottle(): THREE.CanvasTexture {
  if (_stoneMottle) return _stoneMottle;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d")!;
  const rnd = _hash(3.7);
  ctx.fillStyle = "#ededed";
  ctx.fillRect(0, 0, 128, 128);
  // soft blotches, darker and lighter, wrapped by drawing 3x3 tiled offsets
  for (let i = 0; i < 120; i++) {
    const x = rnd() * 128;
    const y = rnd() * 128;
    const r = 4 + rnd() * 20;
    const dark = rnd() < 0.55;
    const v = dark ? 0.72 + rnd() * 0.14 : 0.98 + rnd() * 0.04;
    const g = Math.min(255, Math.floor(v * 255));
    for (let ox = -1; ox <= 1; ox++)
      for (let oy = -1; oy <= 1; oy++) {
        const grad = ctx.createRadialGradient(x + ox * 128, y + oy * 128, 0, x + ox * 128, y + oy * 128, r);
        grad.addColorStop(0, `rgba(${g},${g},${g},0.5)`);
        grad.addColorStop(1, `rgba(${g},${g},${g},0)`);
        ctx.fillStyle = grad;
        ctx.fillRect(x + ox * 128 - r, y + oy * 128 - r, r * 2, r * 2);
      }
  }
  // fine grit
  for (let i = 0; i < 700; i++) {
    const g = 190 + Math.floor(rnd() * 50);
    ctx.fillStyle = `rgba(${g},${g},${g},0.12)`;
    ctx.fillRect(rnd() * 128, rnd() * 128, 1, 1);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1.6, 1.6);
  _stoneMottle = t;
  return t;
}

/** Tileable meadow floor. Near-white so it only whispers through the vertex
 *  colours: short grass strokes, plus a little gravel grit. Periodic sines,
 *  so the repeat has no seam and no image file to ship. */
let _meadowFloor: THREE.CanvasTexture | null = null;
export function makeMeadowFloor(): THREE.CanvasTexture {
  if (_meadowFloor) return _meadowFloor;
  const S = 256;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(S, S);
  const TAU = Math.PI * 2;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const v = y / S;
      const grass =
        Math.sin(u * TAU * 8 + v * 1.7) * 0.45 +
        Math.sin(v * TAU * 13 + u * 0.6) * 0.28 +
        Math.sin((u * 3 + v * 5) * TAU) * 0.18;
      const blades = Math.pow(Math.abs(Math.sin(u * TAU * 18 + v * 2.2)), 10);
      const grit = Math.sin(u * TAU * 23) * Math.sin(v * TAU * 19);
      const shade = 0.94 + grass * 0.03 - blades * 0.045 + grit * 0.018;
      const value = Math.max(0, Math.min(255, Math.round(shade * 255)));
      const i = (y * S + x) * 4;
      img.data[i] = value;
      img.data[i + 1] = Math.min(255, value + 2);
      img.data[i + 2] = Math.max(0, value - 3);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(42, 42);
  t.anisotropy = 4;
  _meadowFloor = t;
  return t;
}

/** Vertical cedar staves for the barrel. One wrap is one ring of staves. */
let _staveMap: THREE.CanvasTexture | null = null;
function makeStaveMap(): THREE.CanvasTexture {
  if (_staveMap) return _staveMap;
  const S = 256;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(S, S);
  const staves = 18;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const v = y / S;
      const around = Math.abs(Math.sin(u * Math.PI * staves));
      const seam = Math.min(1, around * 7);
      const grain = 0.5 + 0.5 * Math.sin(v * Math.PI * 46 + u * 8);
      const shade = 0.84 + seam * 0.14 + (grain - 0.5) * 0.05;
      const value = Math.max(0, Math.min(255, Math.round(shade * 255)));
      const i = (y * S + x) * 4;
      img.data[i] = value;
      img.data[i + 1] = Math.max(0, value - 6);
      img.data[i + 2] = Math.max(0, value - 14);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  _staveMap = t;
  return t;
}

/** Tileable ripple NORMAL map for the tub water — a few periodic sine bumps
 *  turned into a normal field. Scrolled slowly in the tub's useFrame so the
 *  flat disc catches moving highlights and reads as warm, breathing water. */
let _waterNormal: THREE.CanvasTexture | null = null;
export function makeWaterNormal(): THREE.CanvasTexture {
  if (_waterNormal) return _waterNormal;
  const S = 128;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(S, S);
  const TAU = Math.PI * 2;
  const height = (x: number, y: number) => {
    const u = (x / S) * TAU;
    const v = (y / S) * TAU;
    return (
      Math.sin(u * 3 + Math.cos(v * 2)) * 0.5 +
      Math.sin(v * 4 - Math.cos(u * 3)) * 0.35 +
      Math.sin((u + v) * 5) * 0.2
    );
  };
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const hL = height((x - 1 + S) % S, y);
      const hR = height((x + 1) % S, y);
      const hD = height(x, (y - 1 + S) % S);
      const hU = height(x, (y + 1) % S);
      const nx = (hL - hR) * 0.5;
      const ny = (hD - hU) * 0.5;
      const nz = 1.0;
      const len = Math.hypot(nx, ny, nz);
      const i = (y * S + x) * 4;
      img.data[i] = Math.floor(((nx / len) * 0.5 + 0.5) * 255);
      img.data[i + 1] = Math.floor(((ny / len) * 0.5 + 0.5) * 255);
      img.data[i + 2] = Math.floor(((nz / len) * 0.5 + 0.5) * 255);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(2, 2);
  _waterNormal = t;
  return t;
}

/* Kept below bloom threshold so smoke never reads as a glowing orb. */
const SMOKE_STOPS: [number, string][] = [
  [0, "rgba(236,238,234,0.7)"],
  [0.45, "rgba(236,238,234,0.28)"],
  [1, "rgba(236,238,234,0)"],
];

function Smoke({
  origin,
  count = 7,
  rate = 0.16,
  size = 1,
  rise = 3.6,
  drift = 0.3,
  opacity = 0.5,
  frozen = false,
}: {
  origin: [number, number, number];
  count?: number;
  rate?: number;
  size?: number;
  rise?: number;
  drift?: number;
  opacity?: number;
  frozen?: boolean;
}) {
  const refs = useRef<(THREE.Sprite | null)[]>([]);
  const tex = useSoftTexture(SMOKE_STOPS);
  useFrame(({ clock }) => {
    if (frozen) return;
    const t = clock.elapsedTime;
    refs.current.forEach((s, i) => {
      if (!s) return;
      const life = (t * rate + i / count) % 1;
      s.position.set(
        origin[0] + Math.sin(t * 0.5 + i * 2.1) * drift * life * 2,
        origin[1] + life * rise,
        origin[2] + Math.cos(t * 0.4 + i * 1.3) * drift * life
      );
      const sc = size * (0.45 + life * 1.9);
      s.scale.set(sc, sc, 1);
      const m = s.material as THREE.SpriteMaterial;
      m.opacity = opacity * clamp01(life / 0.12) * Math.pow(1 - life, 1.5);
    });
  });
  return (
    <group>
      {Array.from({ length: count }).map((_, i) => (
        <sprite
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          position={origin}
        >
          <spriteMaterial map={tex} transparent depthWrite={false} opacity={frozen ? 0 : 0.01} />
        </sprite>
      ))}
    </group>
  );
}

/* ---------------------------- sun shafts ----------------------------
   Light through the pines at the reveal beats. Matte-painter volumetrics:
   crossed additive gradient quads aligned to the SAME key vector every
   baked light in the scene uses, living only among the tree stands the
   crest and descent cameras actually face. A real screen-space god-ray
   pass was researched and rejected: the sun is off-frame at every beat
   that matters, and on a light scene the radial blur reads as haze smear
   rather than rays. Cheap quads aimed by hand read better and cost ~8
   triangles. Opacity is driven by scroll progress so the shafts belong to
   the morning reveal (beats 1-2) and are gone before dusk. */
const SHAFTS: { pos: [number, number]; w: number; len: number; o: number; rot: number }[] = [
  { pos: [-10.6, -3.6], w: 2.3, len: 9.5, o: 1.0, rot: 0.3 },
  { pos: [-13.4, 4.8], w: 1.7, len: 8.0, o: 0.8, rot: 1.2 },
  { pos: [9.6, -4.2], w: 2.5, len: 9.0, o: 0.9, rot: -0.4 },
  { pos: [5.4, -9.6], w: 1.9, len: 8.5, o: 0.7, rot: 0.8 },
];

function SunShafts({
  progressRef,
  night,
  reduced,
}: {
  progressRef: React.MutableRefObject<number>;
  night: number;
  reduced: boolean;
}) {
  const tex = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 64;
    c.height = 256;
    const ctx = c.getContext("2d")!;
    /* lengthwise: a whisper at the ground, peak mid-shaft, dissolving into
       the canopy; crosswise: soft edges so the quad never reads as a card */
    const v = ctx.createLinearGradient(0, 256, 0, 0);
    v.addColorStop(0, "rgba(255,238,200,0.14)");
    v.addColorStop(0.45, "rgba(255,238,200,0.55)");
    v.addColorStop(0.85, "rgba(255,238,200,0.10)");
    v.addColorStop(1, "rgba(255,238,200,0)");
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, 64, 256);
    const h = ctx.createLinearGradient(0, 0, 64, 0);
    h.addColorStop(0, "rgba(0,0,0,0)");
    h.addColorStop(0.3, "rgba(0,0,0,1)");
    h.addColorStop(0.7, "rgba(0,0,0,1)");
    h.addColorStop(1, "rgba(0,0,0,0)");
    ctx.globalCompositeOperation = "destination-in";
    ctx.fillStyle = h;
    ctx.fillRect(0, 0, 64, 256);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, []);
  const mats = useRef<(THREE.MeshBasicMaterial | null)[]>([]);
  /* +Y of each shaft group points AT the sun, so the quad lies along the
     actual light path — the one angle at which a fake shaft reads true. */
  const q = useMemo(
    () =>
      new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        new THREE.Vector3(18, 16, 13).normalize()
      ),
    []
  );
  useFrame(() => {
    if (reduced) return;
    const p = progressRef.current;
    const win = smoothstep(0.55, 1.3, p) * (1 - smoothstep(2.6, 3.4, p));
    const o = win * (1 - night);
    mats.current.forEach((m, i) => {
      if (m) m.opacity = o * SHAFTS[i].o * 0.32;
    });
  });
  if (reduced) return null;
  return (
    <group>
      {SHAFTS.map((s, i) => (
        <group
          key={i}
          position={[s.pos[0], terrainH(s.pos[0], s.pos[1]) + 0.1, s.pos[1]]}
          quaternion={q}
        >
          {[0, 1.25].map((ry, j) => (
            <mesh key={j} position={[0, s.len / 2, 0]} rotation={[0, s.rot + ry, 0]}>
              <planeGeometry args={[s.w, s.len]} />
              {j === 0 ? (
                <meshBasicMaterial
                  ref={(el) => {
                    mats.current[i] = el;
                  }}
                  map={tex}
                  transparent
                  opacity={0}
                  blending={THREE.AdditiveBlending}
                  depthWrite={false}
                  side={THREE.DoubleSide}
                  fog={false}
                />
              ) : (
                <ShaftFollower map={tex} host={mats} idx={i} />
              )}
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

/** Second quad of the cross shares the first quad's animated opacity. */
function ShaftFollower({
  map,
  host,
  idx,
}: {
  map: THREE.Texture;
  host: React.MutableRefObject<(THREE.MeshBasicMaterial | null)[]>;
  idx: number;
}) {
  const ref = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(() => {
    const h = host.current[idx];
    if (ref.current && h) ref.current.opacity = h.opacity * 0.8;
  });
  return (
    <meshBasicMaterial
      ref={ref}
      map={map}
      transparent
      opacity={0}
      blending={THREE.AdditiveBlending}
      depthWrite={false}
      side={THREE.DoubleSide}
      fog={false}
    />
  );
}

const MIST_STOPS: [number, string][] = [
  [0, "rgba(244,250,246,0.5)"],
  [0.6, "rgba(244,250,246,0.18)"],
  [1, "rgba(244,250,246,0)"],
];

const MIST: { pos: [number, number, number]; scale: number; speed: number }[] = [
  { pos: [-15, 1.4, -7], scale: 16, speed: 0.05 },
  { pos: [13, 1.0, -11], scale: 14, speed: 0.035 },
  { pos: [-6, 0.9, -17], scale: 18, speed: 0.045 },
  { pos: [10, 1.6, 8], scale: 12, speed: 0.03 },
  { pos: [-17, 1.2, 9], scale: 13, speed: 0.04 },
];

function Mist({ frozen = false }: { frozen?: boolean }) {
  const refs = useRef<(THREE.Sprite | null)[]>([]);
  const tex = useSoftTexture(MIST_STOPS);
  useFrame(({ clock }) => {
    if (frozen) return;
    const t = clock.elapsedTime;
    refs.current.forEach((s, i) => {
      if (!s) return;
      const m = MIST[i];
      s.position.x = m.pos[0] + Math.sin(t * m.speed * 2 + i * 1.8) * 2.4;
      s.position.y = m.pos[1] + Math.sin(t * m.speed + i) * 0.3;
    });
  });
  return (
    <group>
      {MIST.map((m, i) => (
        <sprite
          key={i}
          position={m.pos}
          scale={[m.scale, m.scale * 0.4, 1]}
          ref={(el) => {
            refs.current[i] = el;
          }}
        >
          <spriteMaterial map={tex} transparent depthWrite={false} opacity={0.15} />
        </sprite>
      ))}
    </group>
  );
}

/* ------------------------- dusk-aware registry ---------------------- */
/* Materials/lights that warm up as the journey ends register here.     */

type DuskSink = (d: number) => void;

function useDuskRegistry() {
  return useMemo(() => {
    const sinks = new Set<DuskSink>();
    return {
      add: (s: DuskSink) => {
        sinks.add(s);
        return () => {
          sinks.delete(s);
        };
      },
      set: (d: number) => sinks.forEach((s) => s(d)),
    };
  }, []);
}
export type Dusk = ReturnType<typeof useDuskRegistry>;

/* ------------------------------ the home ---------------------------- */

const RIDGE_H = 4.8;
const EAVE = 3.6;
const EAVE_H = 0.35;
const DEPTH = 3.0; // half depth
const ROOF_A = Math.atan2(EAVE, RIDGE_H - EAVE_H);
const SLOPE_L = Math.hypot(EAVE, RIDGE_H - EAVE_H);

function GableGlass({ z, mat }: { z: number; mat: THREE.Material }) {
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const v = new Float32Array([-EAVE, EAVE_H, 0, EAVE, EAVE_H, 0, 0, RIDGE_H, 0]);
    g.setAttribute("position", new THREE.BufferAttribute(v, 3));
    g.computeVertexNormals();
    return g;
  }, []);
  return <mesh geometry={geo} material={mat} position={[0, 0, z]} />;
}

function AFrameHome({ dusk, archGlass, glassRoof }: { dusk: Dusk; archGlass: THREE.Material; glassRoof: THREE.Material }) {
  const lamp = useRef<THREE.PointLight>(null);
  const pendant = useRef<THREE.MeshStandardMaterial>(null);
  useLayoutEffect(
    () =>
      dusk.add((d) => {
        if (lamp.current) lamp.current.intensity = 0.15 + d * 2.2;
        if (pendant.current) pendant.current.emissiveIntensity = 0.2 + d * 1.5;
      }),
    [dusk]
  );

  const mullion = "#20261f";
  const cedar = ["#a97e57", "#9b7350", "#b0855e"];

  return (
    <group>
      {/* floor slab on screw piles */}
      <mesh castShadow receiveShadow position={[0, 0.22, 0]}>
        <boxGeometry args={[7.5, 0.32, 6.4]} />
        <meshStandardMaterial color="#c6ccc4" roughness={0.9} flatShading />
      </mesh>
      {([[-3.2, -2.6], [3.2, -2.6], [-3.2, 2.6], [3.2, 2.6], [0, -2.6], [0, 2.6]] as [number, number][]).map(
        ([x, z], i) => (
          <mesh key={i} position={[x, 0.05, z]} castShadow>
            <cylinderGeometry args={[0.1, 0.12, 0.24, 8]} />
            <meshStandardMaterial color="#6c7370" roughness={0.7} metalness={0.3} flatShading />
          </mesh>
        )
      )}

      {/* Roof panes — dark standing seam. The WEST slope (s = -1) carries a
          glazed band: the solid pane is split fore and aft and a run of
          skylight glass sits between them, so the loft gets the afternoon
          sun without touching the east slope's shading or the silhouette. */}
      {[1, -1].map((s) =>
        s === 1 ? (
          <mesh
            key={s}
            castShadow
            receiveShadow
            position={[(s * EAVE) / 2, (RIDGE_H + EAVE_H) / 2, 0]}
            rotation={[0, 0, s * ROOF_A]}
          >
            <boxGeometry args={[0.16, SLOPE_L + 0.5, 6.9]} />
            <meshStandardMaterial color="#242a27" roughness={0.5} metalness={0.35} flatShading />
          </mesh>
        ) : (
          <group key={s} position={[(s * EAVE) / 2, (RIDGE_H + EAVE_H) / 2, 0]} rotation={[0, 0, s * ROOF_A]}>
            {/* solid roof fore and aft of the glazed run */}
            {([[0, 2.53, 1.84], [0, -2.53, 1.84]] as [number, number, number][]).map(([x, z, d], i) => (
              <mesh key={i} castShadow receiveShadow position={[x, 0, z]}>
                <boxGeometry args={[0.16, SLOPE_L + 0.5, d]} />
                <meshStandardMaterial color="#242a27" roughness={0.5} metalness={0.35} flatShading />
              </mesh>
            ))}
            {/* the glazing itself, inset so the seam frames read proud of it */}
            <mesh material={glassRoof} position={[0, 0, 0]} renderOrder={RO_GLASS_FLOOR}>
              <boxGeometry args={[0.1, SLOPE_L + 0.36, 3.2]} />
            </mesh>
            {/* glazing bars across the run */}
            {[-1.5, -0.75, 0, 0.75, 1.5].map((z, i) => (
              <mesh key={`gb${i}`} position={[0.04, 0, z]} castShadow>
                <boxGeometry args={[0.11, SLOPE_L + 0.4, 0.07]} />
                <meshStandardMaterial color={mullion} roughness={0.6} metalness={0.3} />
              </mesh>
            ))}
            {/* head and sill flashing */}
            {[[0, (SLOPE_L + 0.36) / 2], [0, -(SLOPE_L + 0.36) / 2]].map(([x, y], i) => (
              <mesh key={`fl${i}`} position={[0.03, y, 0]} castShadow>
                <boxGeometry args={[0.14, 0.1, 3.3]} />
                <meshStandardMaterial color="#1c211f" roughness={0.5} metalness={0.4} />
              </mesh>
            ))}
          </group>
        )
      )}
      {/* ridge cap */}
      <mesh castShadow position={[0, RIDGE_H + 0.06, 0]}>
        <boxGeometry args={[0.3, 0.12, 6.9]} />
        <meshStandardMaterial color="#1c211f" roughness={0.5} metalness={0.4} />
      </mesh>

      {/* glass gables, front and back */}
      <GableGlass z={DEPTH} mat={archGlass} />
      <GableGlass z={-DEPTH} mat={archGlass} />

      {/* mullions + door, front */}
      {[-1.3, 1.3].map((x) => (
        <mesh key={x} castShadow position={[x, (EAVE_H + RIDGE_H - (Math.abs(x) * (RIDGE_H - EAVE_H)) / EAVE) / 2, DEPTH]}>
          <boxGeometry args={[0.08, RIDGE_H - EAVE_H - (Math.abs(x) * (RIDGE_H - EAVE_H)) / EAVE, 0.1]} />
          <meshStandardMaterial color={mullion} roughness={0.6} metalness={0.2} />
        </mesh>
      ))}
      {/* transom over the door. Its width is COMPUTED from the gable taper —
          it was a hardcoded 4.6, but the A-frame at y=2.5 is only ~3.7 wide,
          so the bar ran out through both roof planes and read as a stray
          beam from every front and three-quarter camera. It now terminates
          0.14 inside the roof line, where a real transom meets the rafters. */}
      <mesh castShadow position={[0, 2.5, DEPTH]}>
        <boxGeometry args={[2 * ((EAVE * (RIDGE_H - 2.5)) / (RIDGE_H - EAVE_H) - 0.14), 0.08, 0.1]} />
        <meshStandardMaterial color={mullion} roughness={0.6} metalness={0.2} />
      </mesh>
      {/* door frame + handle */}
      {[-0.62, 0.62].map((x) => (
        <mesh key={x} castShadow position={[x, 1.35, DEPTH + 0.02]}>
          <boxGeometry args={[0.09, 2.1, 0.12]} />
          <meshStandardMaterial color={mullion} roughness={0.6} metalness={0.2} />
        </mesh>
      ))}
      <mesh castShadow position={[0, 2.36, DEPTH + 0.02]}>
        <boxGeometry args={[1.33, 0.09, 0.12]} />
        <meshStandardMaterial color={mullion} roughness={0.6} metalness={0.2} />
      </mesh>
      <mesh position={[0.42, 1.25, DEPTH + 0.06]}>
        <boxGeometry args={[0.05, 0.5, 0.05]} />
        <meshStandardMaterial color="#8f9a94" roughness={0.35} metalness={0.7} />
      </mesh>

      {/* interior — silhouettes of a life, lit warm at dusk */}
      <mesh position={[-1.5, 0.56, -1.2]} castShadow>
        <boxGeometry args={[1.9, 0.36, 1.5]} />
        <meshStandardMaterial color="#e8e2d4" roughness={0.95} />
      </mesh>
      <mesh position={[-2.6, 0.75, 0.9]} castShadow>
        <boxGeometry args={[0.9, 0.74, 1.9]} />
        <meshStandardMaterial color="#4c4038" roughness={0.9} />
      </mesh>
      {/* wood stove + a real chimney: double-wall flue, storm collar, rain cap,
          topping out above the ridge (not a bare rod poking the roof) */}
      <mesh position={[0.9, 0.78, -2.2]} castShadow>
        <cylinderGeometry args={[0.24, 0.26, 0.85, 10]} />
        <meshStandardMaterial color="#20211f" roughness={0.6} metalness={0.3} flatShading />
      </mesh>
      <mesh position={[0.9, 3.15, -2.2]} castShadow>
        <cylinderGeometry args={[0.085, 0.085, 3.8, 10]} />
        <meshStandardMaterial color="#2e3230" roughness={0.45} metalness={0.6} />
      </mesh>
      {/* storm collar at the roof penetration */}
      <mesh position={[0.9, 3.72, -2.2]}>
        <cylinderGeometry args={[0.1, 0.2, 0.16, 10]} />
        <meshStandardMaterial color="#232725" roughness={0.5} metalness={0.55} />
      </mesh>
      {/* rain cap */}
      <mesh position={[0.9, 5.08, -2.2]} castShadow>
        <cylinderGeometry args={[0.15, 0.15, 0.04, 10]} />
        <meshStandardMaterial color="#232725" roughness={0.5} metalness={0.55} />
      </mesh>
      <mesh position={[0.9, 5.16, -2.2]}>
        <coneGeometry args={[0.17, 0.12, 10]} />
        <meshStandardMaterial color="#2e3230" roughness={0.45} metalness={0.6} />
      </mesh>
      <pointLight ref={lamp} position={[0, 2.5, -0.4]} color="#ffc98a" intensity={0.2} distance={10} decay={2} />
      <mesh position={[0, 3.0, -0.4]}>
        <sphereGeometry args={[0.09, 10, 10]} />
        <meshStandardMaterial ref={pendant} color="#fff3da" emissive="#ffd9a0" emissiveIntensity={0.3} />
      </mesh>

      {/* solar array on the east pane */}
      <group position={[EAVE / 2, (RIDGE_H + EAVE_H) / 2, 0]} rotation={[0, 0, ROOF_A]}>
        <mesh position={[0.16, 0.1, 0]} castShadow>
          <boxGeometry args={[0.07, 2.6, 3.6]} />
          <meshStandardMaterial color="#16233c" roughness={0.25} metalness={0.65} />
        </mesh>
      </group>
    </group>
  );
}

/* ----------------------- deck, walkway, hot tub --------------------- */

function GlassRailRun({
  from,
  to,
  h = 0.98,
  base = 0.5,
  mat,
}: {
  from: [number, number];
  to: [number, number];
  h?: number;
  base?: number;
  mat: THREE.Material;
}) {
  const dx = to[0] - from[0];
  const dz = to[1] - from[1];
  const len = Math.hypot(dx, dz);
  const ang = Math.atan2(dx, dz);
  const cx = (from[0] + to[0]) / 2;
  const cz = (from[1] + to[1]) / 2;
  return (
    <group position={[cx, base, cz]} rotation={[0, ang, 0]}>
      <mesh material={mat} position={[0, h / 2, 0]} renderOrder={RO_GLASS_RAIL}>
        <boxGeometry args={[0.05, h, len]} />
      </mesh>
      <mesh position={[0, h + 0.03, 0]} castShadow>
        <boxGeometry args={[0.07, 0.06, len + 0.05]} />
        <meshStandardMaterial color="#5d6663" roughness={0.4} metalness={0.6} />
      </mesh>
      {/* base channel — without it the pane floats and the whole balustrade
          reads as a tint rather than as glass held in a frame */}
      <mesh position={[0, 0.035, 0]} castShadow>
        <boxGeometry args={[0.09, 0.07, len + 0.05]} />
        <meshStandardMaterial color="#5d6663" roughness={0.45} metalness={0.55} />
      </mesh>
    </group>
  );
}

/** Deterministic per-piece lumber/stone tone (quality pass, Aug 9). Real
 *  wood varies piece to piece; a strict 3-colour rota reads as tiling the
 *  moment two same-tone boards land side by side. Same board, same colour,
 *  every load — no Math.random. */
function pieceTone(base: string, i: number, dl = 0.05, dh = 0.012) {
  const r1 = (() => {
    const s = Math.sin(i * 127.1 + 71.7) * 43758.5453;
    return s - Math.floor(s);
  })();
  const r2 = (() => {
    const s = Math.sin(i * 311.7 + 13.9) * 43758.5453;
    return s - Math.floor(s);
  })();
  const c = new THREE.Color(base);
  c.offsetHSL((r2 - 0.5) * dh, 0, (r1 - 0.5) * dl);
  return c;
}

function Deck({ glassFloor, glassRail }: { glassFloor: THREE.Material; glassRail: THREE.Material }) {
  const cedar = ["#a97e57", "#9b7350", "#b0855e"];
  const grain = useMemo(() => makeWoodGrain(), []);
  const planks = [];
  for (let i = 0; i < 6; i++) {
    const z = 3.25 + i * 0.47;
    planks.push(
      <mesh key={i} castShadow receiveShadow position={[-1.15, 0.44, z]}>
        <boxGeometry args={[4.9, 0.09, 0.43]} />
        <meshStandardMaterial map={grain} color={pieceTone(cedar[i % 3], i)} roughness={0.85} flatShading />
      </mesh>
    );
  }
  return (
    <group>
      {planks}
      {/* rim joist + skirt so the deck reads built, not floating lumber */}
      <mesh castShadow receiveShadow position={[-1.15, 0.29, 4.43]}>
        <boxGeometry args={[4.72, 0.24, 2.62]} />
        <meshStandardMaterial map={grain} color="#6d523c" roughness={0.9} flatShading />
      </mesh>
      {([[-3.35, 3.35], [0.95, 3.35], [-3.35, 5.6], [0.95, 5.6]] as [number, number][]).map(([x, z], i) => (
        <mesh key={`dp${i}`} castShadow position={[x, 0.14, z]}>
          <cylinderGeometry args={[0.07, 0.09, 0.3, 8]} />
          <meshStandardMaterial color="#5a4632" roughness={0.9} flatShading />
        </mesh>
      ))}
      {/* glass-floored section, east side, feeding the walkway.
          Frame dropped to 0.345 (top 0.37) so it clears the glass underside
          at 0.40 — they used to interpenetrate between 0.40 and 0.41. */}
      <mesh material={glassFloor} position={[2.4, 0.44, 4.6]} renderOrder={RO_GLASS_FLOOR}>
        <boxGeometry args={[2.1, 0.08, 2.85]} />
      </mesh>
      {/* frame under glass */}
      <mesh castShadow position={[2.4, 0.345, 4.6]}>
        <boxGeometry args={[2.2, 0.05, 2.95]} />
        <meshStandardMaterial color="#5d6663" roughness={0.5} metalness={0.5} />
      </mesh>
      {/* glass railings: front edge with a gap for the steps, west edge */}
      <GlassRailRun from={[-3.6, 6.05]} to={[-1.1, 6.05]} mat={glassRail} />
      <GlassRailRun from={[1.2, 6.05]} to={[3.45, 6.05]} mat={glassRail} />
      <GlassRailRun from={[-3.6, 3.15]} to={[-3.6, 6.05]} mat={glassRail} />
      {/* steps to the meadow */}
      {[0, 1, 2].map((i) => (
        <mesh key={i} castShadow receiveShadow position={[0.05, 0.34 - i * 0.13, 6.35 + i * 0.34]}>
          <boxGeometry args={[2.1, 0.1, 0.34]} />
          <meshStandardMaterial map={grain} color={pieceTone(cedar[i % 3], i + 11)} roughness={0.85} flatShading />
        </mesh>
      ))}
    </group>
  );
}

/* THE BRIDGE, AND THE BEAMS THROUGH THE HOT TUB.

   v1 ran the walkway from the deck edge (3.45, 4.65) to (5.9, 5.35) — which
   is the CENTRE of the hot tub, not its edge — and then padded the deck box
   by another 0.4 m. Its two handrails were offset by an eyeballed (-0.35,
   +0.42) instead of a real perpendicular, so both of them ended up inside
   the 0.78 m barrel: the "two grey beams passing straight through the tub
   wall and out the other side". Now the landing point is solved rather than
   guessed — the deck stops 0.96 m short of the tub centre (the barrel is
   0.78) and the rails are offset along the true perpendicular, so every
   piece clears the staves and lands on the stone pad instead.
*/
const WALK_FROM: [number, number] = [3.45, 4.65];
const WALK_TO: [number, number] = [4.85, 5.06];
const WALK_PAD = 0.3;

function Walkway({ glassFloor, glassRail }: { glassFloor: THREE.Material; glassRail: THREE.Material }) {
  const from = WALK_FROM;
  const to = WALK_TO;
  const dx = to[0] - from[0];
  const dz = to[1] - from[1];
  const len = Math.hypot(dx, dz);
  const ux = dx / len;
  const uz = dz / len;
  // true perpendicular in the ground plane
  const px = -uz;
  const pz = ux;
  const half = 0.5;
  const cx = (from[0] + to[0]) / 2;
  const cz = (from[1] + to[1]) / 2;
  const ang = Math.atan2(dx, dz);
  const railA: [[number, number], [number, number]] = [
    [from[0] + px * half, from[1] + pz * half],
    [to[0] + px * half, to[1] + pz * half],
  ];
  const railB: [[number, number], [number, number]] = [
    [from[0] - px * half, from[1] - pz * half],
    [to[0] - px * half, to[1] - pz * half],
  ];
  return (
    <group>
      <group position={[cx, 0.42, cz]} rotation={[0, ang, 0]}>
        {/* Glass underside sits at 0.385; the frame top used to land on
            exactly 0.385 — coplanar, and the pair z-fought every time the
            camera came near. Frame dropped to -0.085 leaving 5cm of air. */}
        <mesh material={glassFloor} position={[0, 0, 0]} renderOrder={RO_GLASS_FLOOR}>
          <boxGeometry args={[1.0, 0.07, len + WALK_PAD]} />
        </mesh>
        <mesh castShadow position={[0, -0.085, 0]}>
          <boxGeometry args={[1.08, 0.05, len + WALK_PAD + 0.1]} />
          <meshStandardMaterial color="#5d6663" roughness={0.5} metalness={0.5} />
        </mesh>
      </group>
      {/* stone piers grounding the walkway */}
      {([[4.0, 4.77], [4.72, 4.98]] as [number, number][]).map(([x, z], i) => (
        <mesh key={`wp${i}`} castShadow position={[x, 0.18, z]}>
          <cylinderGeometry args={[0.11, 0.15, 0.4, 8]} />
          <meshStandardMaterial color="#848c85" roughness={0.95} flatShading />
        </mesh>
      ))}
      <GlassRailRun from={railA[0]} to={railA[1]} h={0.62} base={0.45} mat={glassRail} />
      <GlassRailRun from={railB[0]} to={railB[1]} h={0.62} base={0.45} mat={glassRail} />
      {/* newel posts terminate the run instead of leaving a rail in mid-air */}
      {[railA[1], railB[1]].map(([x, z], i) => (
        <mesh key={`nw${i}`} castShadow position={[x, 0.72, z]}>
          <boxGeometry args={[0.07, 0.62, 0.07]} />
          <meshStandardMaterial color="#5d6663" roughness={0.45} metalness={0.55} />
        </mesh>
      ))}
    </group>
  );
}

function HotTub({ position, dusk, frozen = false }: { position: [number, number, number]; dusk: Dusk; frozen?: boolean }) {
  const water = useRef<THREE.MeshStandardMaterial>(null);
  const stoveGlow = useRef<THREE.MeshStandardMaterial>(null);
  const waterNormal = useMemo(() => makeWaterNormal(), []);
  const mottle = useMemo(() => makeStoneMottle(), []);
  const staves = useMemo(() => makeStaveMap(), []);
  const barrel = useMemo(() => {
    const pts: THREE.Vector2[] = [];
    const steps = 12;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const y = 0.2 + t * 0.84;
      /* Coopered bulge. The widest point stays at 0.78 so the walkway,
         which stops 0.96 from the centre, still clears the staves. */
      const r = 0.66 + Math.sin(t * Math.PI) * 0.12;
      pts.push(new THREE.Vector2(r, y));
    }
    return new THREE.LatheGeometry(pts, 28);
  }, []);
  const hoops = useMemo(
    () =>
      [0.22, 0.5, 0.78].map((t) => ({
        y: 0.2 + t * 0.84,
        r: 0.66 + Math.sin(t * Math.PI) * 0.12 + 0.012,
      })),
    []
  );
  useLayoutEffect(
    () =>
      dusk.add((d) => {
        if (water.current) water.current.emissiveIntensity = 0.1 + d * 0.26;
        if (stoveGlow.current) stoveGlow.current.emissiveIntensity = 0.18 + d * 0.45;
      }),
    [dusk]
  );
  /* Water life: the ripple normal map drifts slowly so the flat disc catches
     moving highlights and reads as warm, breathing water instead of a painted
     lid. Sub-4px ambient drift (BRAND.md §8), so it is fine under reduced
     motion — but it still parks on `frozen` for a dead-still first frame. */
  useFrame(({ clock }) => {
    if (frozen) return;
    const t = clock.elapsedTime;
    waterNormal.offset.set(t * 0.014, t * 0.02);
  });
  /* THE LOUDEST OBJECT IN EVERY FRAME. The tub carried a bright cyan water
     disc (#1d8f86) over saturated orange staves (#8a5a3a) — neither hue is
     in BRAND.md section 2, and together they out-shouted the A-frame, which
     is the actual product. Section 6: one dominant accent per surface. The
     water settles toward the palette teal #0d9488 at low saturation and the
     staves go to a neutral warm timber, so the tub becomes the quiet detail
     it should always have been. */
  return (
    <group position={position}>
      {/* stone pad, wide enough for the stove */}
      <mesh receiveShadow castShadow position={[0.15, 0.1, 0]}>
        <cylinderGeometry args={[1.7, 1.84, 0.22, 16]} />
        <meshStandardMaterial map={mottle} color="#8d968f" roughness={0.95} flatShading />
      </mesh>
      <mesh geometry={barrel} castShadow receiveShadow>
        <meshStandardMaterial map={staves} color="#8d7c66" roughness={0.88} metalness={0.02} />
      </mesh>
      {hoops.map((hoop) => (
        <mesh key={hoop.y} castShadow position={[0, hoop.y, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[hoop.r, 0.016, 6, 28]} />
          <meshStandardMaterial color="#5e574f" roughness={0.42} metalness={0.62} />
        </mesh>
      ))}
      <mesh castShadow position={[0, 1.04, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.67, 0.038, 8, 28]} />
        <meshStandardMaterial map={staves} color="#6f6152" roughness={0.86} />
      </mesh>
      <mesh position={[0, 0.98, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.6, 40]} />
        <meshStandardMaterial
          ref={water}
          color="#4f8d86"
          roughness={0.14}
          metalness={0.12}
          emissive="#0d9488"
          emissiveIntensity={0.12}
          normalMap={waterNormal}
          normalScale={new THREE.Vector2(0.18, 0.18)}
        />
      </mesh>
      {/* wood stove, set clear of the staves, with a short flue */}
      <group position={[1.22, 0, -0.08]}>
        {[-0.16, 0.16].map((x) =>
          [-0.12, 0.12].map((z) => (
            <mesh key={`${x}${z}`} castShadow position={[x, 0.28, z]}>
              <boxGeometry args={[0.04, 0.16, 0.04]} />
              <meshStandardMaterial color="#3a3834" roughness={0.55} metalness={0.4} />
            </mesh>
          ))
        )}
        <mesh castShadow receiveShadow position={[0, 0.52, 0]}>
          <boxGeometry args={[0.46, 0.36, 0.34]} />
          <meshStandardMaterial color="#3e3934" roughness={0.62} metalness={0.38} />
        </mesh>
        <mesh position={[0, 0.5, 0.175]}>
          <boxGeometry args={[0.22, 0.16, 0.02]} />
          <meshStandardMaterial
            ref={stoveGlow}
            color="#6a4a32"
            emissive="#e39a55"
            emissiveIntensity={0.22}
            roughness={0.8}
          />
        </mesh>
        <mesh castShadow position={[0.04, 1.05, 0]}>
          <cylinderGeometry args={[0.045, 0.05, 0.72, 10]} />
          <meshStandardMaterial color="#8e948f" roughness={0.45} metalness={0.55} />
        </mesh>
        <mesh castShadow position={[0.04, 1.4, 0]}>
          <cylinderGeometry args={[0.07, 0.07, 0.04, 10]} />
          <meshStandardMaterial color="#6e756f" roughness={0.4} metalness={0.6} />
        </mesh>
      </group>
    </group>
  );
}

/* -------------------- fire pit, chairs, string lights ---------------- */

/* THE CHAIR. v1 read as a set of disconnected slabs: a thin seat plate, a
   back tilted 0.3 rad floating 33 cm behind and above it with nothing
   joining the two, and armrests hanging in space at a third height. From an
   elevated camera it looked like a board leaning in mid-air. This is a
   proper Adirondack — the back sits ON the seat's rear edge, the arms land
   on real front posts, and there is a front apron, so every part touches
   another part from every angle the camera visits. It is also planted on
   the terrain rather than on y=0. */
function LoungeChair({
  position,
  rotY,
  cushion = "#e8e2d4",
}: {
  position: [number, number];
  rotY: number;
  cushion?: string;
}) {
  const [x, z] = position;
  const wood = "#9b7350";
  const woodDark = "#7c5c3f";
  return (
    <group position={[x, terrainH(x, z), z]} rotation={[0, rotY, 0]}>
      {/* rear legs / stringers */}
      {[-0.29, 0.29].map((sx) => (
        <mesh key={`r${sx}`} castShadow position={[sx, 0.19, -0.2]}>
          <boxGeometry args={[0.06, 0.38, 0.07]} />
          <meshStandardMaterial color={woodDark} roughness={0.9} flatShading />
        </mesh>
      ))}
      {/* front posts run all the way to the armrest, which is what makes the
          arm look supported instead of hovering */}
      {[-0.31, 0.31].map((sx) => (
        <mesh key={`f${sx}`} castShadow position={[sx, 0.27, 0.26]}>
          <boxGeometry args={[0.06, 0.54, 0.07]} />
          <meshStandardMaterial color={woodDark} roughness={0.9} flatShading />
        </mesh>
      ))}
      {/* front apron ties the two front posts together */}
      <mesh castShadow position={[0, 0.36, 0.28]}>
        <boxGeometry args={[0.62, 0.08, 0.05]} />
        <meshStandardMaterial color={woodDark} roughness={0.9} flatShading />
      </mesh>
      {/* seat: three slats, sloping back into the frame */}
      {[-0.2, 0, 0.2].map((sz) => (
        <mesh key={`s${sz}`} castShadow receiveShadow position={[0, 0.4 + sz * 0.09, sz]} rotation={[-0.09, 0, 0]}>
          <boxGeometry args={[0.62, 0.045, 0.17]} />
          <meshStandardMaterial color={wood} roughness={0.88} flatShading />
        </mesh>
      ))}
      {/* cushion sits in the seat, not above it */}
      <mesh castShadow position={[0, 0.44, -0.01]} rotation={[-0.09, 0, 0]}>
        <boxGeometry args={[0.55, 0.05, 0.48]} />
        <meshStandardMaterial color={cushion} roughness={0.96} />
      </mesh>
      {/* back: four slats rising from the seat's rear edge, no gap */}
      {[-0.21, -0.07, 0.07, 0.21].map((sx) => (
        <mesh key={`b${sx}`} castShadow position={[sx, 0.62, -0.31]} rotation={[0.3, 0, 0]}>
          <boxGeometry args={[0.11, 0.6, 0.045]} />
          <meshStandardMaterial color={wood} roughness={0.88} flatShading />
        </mesh>
      ))}
      <mesh castShadow position={[0, 0.86, -0.39]} rotation={[0.3, 0, 0]}>
        <boxGeometry args={[0.62, 0.09, 0.05]} />
        <meshStandardMaterial color={woodDark} roughness={0.88} flatShading />
      </mesh>
      {/* armrests landing on the front posts */}
      {[-0.34, 0.34].map((sx) => (
        <mesh key={`a${sx}`} castShadow position={[sx, 0.56, 0.02]}>
          <boxGeometry args={[0.11, 0.045, 0.62]} />
          <meshStandardMaterial color="#8a6647" roughness={0.85} flatShading />
        </mesh>
      ))}
    </group>
  );
}

function FirePit({ dusk }: { dusk: Dusk }) {
  const fire = useGLTF(MODELS.campfire);
  const clones = useNormalizedClones(
    fire.scene,
    0.75,
    useMemo(() => [{ pos: [-4.6, 0, 6.2] as [number, number, number], rotY: 0.5 }], [])
  );
  const light = useRef<THREE.PointLight>(null);
  useLayoutEffect(
    () =>
      dusk.add((d) => {
        if (light.current) light.current.intensity = 0.8 + d * 1.8;
      }),
    [dusk]
  );
  useFrame(({ clock }) => {
    if (light.current) {
      const t = clock.elapsedTime;
      light.current.intensity *= 1 + Math.sin(t * 9.3) * 0.045 + Math.sin(t * 23.7) * 0.03;
    }
  });
  return (
    <group>
      <primitive object={clones[0]} />
      {/* stone ring */}
      {Array.from({ length: 9 }).map((_, i) => {
        const a = (i / 9) * Math.PI * 2;
        return (
          <mesh key={i} castShadow position={[-4.6 + Math.cos(a) * 0.85, 0.12, 6.2 + Math.sin(a) * 0.85]} rotation={[0, a, 0]}>
            <boxGeometry args={[0.34, 0.24, 0.22]} />
            <meshStandardMaterial map={makeStoneMottle()} color="#7f8781" roughness={0.95} flatShading />
          </mesh>
        );
      })}
      <pointLight ref={light} position={[-4.6, 1.0, 6.2]} color="#ffb46b" intensity={1.2} distance={7} decay={2} />
      {/* pulled in off the fence line at z=8.5 — the middle chair's back used
          to reach into the rails */}
      {([
        [-6.35, 5.9, 1.4],
        [-5.1, 7.6, 2.86],
        [-3.05, 6.9, -2.05],
      ] as const).map(([x, z, rot], i) => (
        <LoungeChair key={i} position={[x, z]} rotY={rot} cushion={i === 1 ? "#cfe4dc" : undefined} />
      ))}
      {/* log side table */}
      <mesh castShadow position={[-3.7, terrainH(-3.7, 5.35) + 0.19, 5.35]}>
        <cylinderGeometry args={[0.22, 0.24, 0.38, 9]} />
        <meshStandardMaterial color="#8a6647" roughness={0.95} flatShading />
      </mesh>
    </group>
  );
}

/** Catenary string lights: sagging wire + warm bulbs that rise at dusk. */
function StringLights({ points, dusk }: { points: [number, number, number][]; dusk: Dusk }) {
  const { wire, bulbs } = useMemo(() => {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < points.length - 1; i++) {
      const a = new THREE.Vector3(...points[i]);
      const b = new THREE.Vector3(...points[i + 1]);
      const mid = a.clone().lerp(b, 0.5);
      mid.y -= a.distanceTo(b) * 0.12;
      if (i === 0) pts.push(a);
      pts.push(mid, b);
    }
    const curve = new THREE.CatmullRomCurve3(pts, false, "catmullrom", 0.6);
    const wire = new THREE.TubeGeometry(curve, 64, 0.013, 4, false);
    const L = curve.getLength();
    const n = Math.floor(L / 0.55);
    const bulbs: THREE.Vector3[] = [];
    for (let i = 1; i < n; i++) {
      const p = curve.getPointAt(i / n);
      p.y -= 0.06;
      bulbs.push(p);
    }
    return { wire, bulbs };
  }, [points]);
  const mat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#efe6d2", emissive: "#ffcf8a", emissiveIntensity: 0.03, roughness: 0.4 }),
    []
  );
  useLayoutEffect(
    () =>
      dusk.add((d) => {
        /* bulbs are OFF in daylight and come up with the dusk */
        mat.emissiveIntensity = 0.03 + d * 1.7;
      }),
    [dusk, mat]
  );
  return (
    <group>
      <mesh geometry={wire}>
        <meshStandardMaterial color="#2c2f2d" roughness={0.7} />
      </mesh>
      {bulbs.map((p, i) => (
        <mesh key={i} position={p} material={mat}>
          <sphereGeometry args={[0.034, 8, 8]} />
        </mesh>
      ))}
    </group>
  );
}

function LightPole({ position }: { position: [number, number, number] }) {
  return (
    <mesh castShadow position={[position[0], position[1] / 2, position[2]]}>
      <cylinderGeometry args={[0.035, 0.055, position[1], 7]} />
      <meshStandardMaterial color="#4c4038" roughness={0.9} flatShading />
    </mesh>
  );
}

/* --------------------------- crest bench ---------------------------- */

function Bench({ position, rotY }: { position: [number, number, number]; rotY: number }) {
  return (
    <group position={position} rotation={[0, rotY, 0]}>
      {[0, 1].map((i) => (
        <mesh key={i} castShadow position={[0, 0.4, -0.09 + i * 0.2]}>
          <boxGeometry args={[1.4, 0.06, 0.16]} />
          <meshStandardMaterial color="#a97e57" roughness={0.85} flatShading />
        </mesh>
      ))}
      {[0, 1].map((i) => (
        <mesh key={i} castShadow position={[0, 0.62 + i * 0.18, -0.3 - i * 0.05]} rotation={[0.24, 0, 0]}>
          <boxGeometry args={[1.4, 0.12, 0.05]} />
          <meshStandardMaterial color="#9b7350" roughness={0.85} flatShading />
        </mesh>
      ))}
      {[-0.55, 0.55].map((x) => (
        <mesh key={x} castShadow position={[x, 0.19, -0.05]}>
          <boxGeometry args={[0.08, 0.38, 0.34]} />
          <meshStandardMaterial color="#6d4429" roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
}

/** Stepping stones tracing the walked route: trailhead -> crest -> steps. */
const PATH_STONES: [number, number][] = [
  [-2.4, 33.0], [-2.1, 31.2], [-1.6, 29.2], [-0.6, 27.4], [0.3, 25.6], [0.9, 23.8], [0.6, 21.8],
  [-0.4, 19.6], [-1.4, 17.2], [-2.0, 14.8], [-1.9, 12.4], [-1.3, 10.4],
  [-0.5, 8.9], [0.1, 7.7],
];

/* TUFTS (28 clusters x five 4-sided cones at the trailhead) are GONE.
   They predate the instanced meadow, which now grows denser, better-shaped
   blades over exactly that ground — and at beat 0 the camera stood right in
   them, so their 0.14 m-wide flat-shaded cones were the single worst
   "chunky triangle" offender in the hero frame. Removing them also returns
   ~140 draw calls. */

/** Wildflower clusters — quiet color, trail-side only. */
const FLOWERS: { pos: [number, number]; tint: string }[] = [
  { pos: [-1.5, 32.6], tint: "#f3f0e2" },
  { pos: [0.9, 31.2], tint: "#ffd98a" },
  { pos: [-3.4, 30.9], tint: "#c9b8ee" },
  { pos: [1.8, 28.4], tint: "#f3f0e2" },
  { pos: [-1.0, 27.0], tint: "#ffd98a" },
  { pos: [-4.6, 28.4], tint: "#f3f0e2" },
  { pos: [2.6, 30.8], tint: "#c9b8ee" },
  { pos: [0.3, 33.4], tint: "#ffd98a" },
];

/** Small boulders framing the first steps of the trail. */
const TRAIL_ROCKS: { pos: [number, number]; s: number }[] = [
  { pos: [-3.3, 31.9], s: 0.32 },
  { pos: [1.7, 32.7], s: 0.24 },
  { pos: [-0.9, 29.6], s: 0.2 },
  { pos: [3.6, 29.4], s: 0.36 },
  { pos: [-5.2, 29.0], s: 0.28 },
];

function Trailhead() {
  return (
    <group>
      {FLOWERS.map(({ pos: [x, z], tint }, i) => (
        <group key={`f${i}`} position={[x, terrainH(x, z) - 0.02, z]} rotation={[0, i * 1.9, 0]}>
          {/* v1 put 5-6 cm balls on sub-pixel stems at 16-34 cm — from the
              hero camera the stems vanished and the heads read as floating
              orbs. A wildflower in a sward is knee-high with a small head on
              a stem thick enough to resolve at 3 m. */}
          {[0, 1, 2].map((j) => {
            const h = 0.09 + (((i * 5 + j * 3) % 4) * 0.03);
            return (
              <group
                key={j}
                position={[
                  (j - 1) * 0.14 + Math.sin(i * 2.7 + j * 4.1) * 0.07,
                  0,
                  Math.cos(i * 1.9 + j * 2.3) * 0.11,
                ]}
                rotation={[Math.sin(i + j) * 0.14, 0, Math.cos(i * 2 + j) * 0.14]}
              >
                <mesh position={[0, h / 2, 0]}>
                  <cylinderGeometry args={[0.012, 0.016, h, 4]} />
                  <meshStandardMaterial color="#6f9c5e" roughness={1} />
                </mesh>
                <mesh position={[0, h + 0.01, 0]}>
                  <sphereGeometry args={[0.013 + ((i + j) % 2) * 0.004, 6, 5]} />
                  <meshStandardMaterial color={tint} roughness={0.9} />
                </mesh>
              </group>
            );
          })}
        </group>
      ))}
      {TRAIL_ROCKS.map(({ pos: [x, z], s }, i) => (
        <mesh key={`tr${i}`} castShadow receiveShadow position={[x, terrainH(x, z) + s * 0.28, z]} rotation={[0, i * 2.3, 0]}>
          <dodecahedronGeometry args={[s, 0]} />
          <meshStandardMaterial map={makeStoneMottle()} color="#8f9890" roughness={0.95} flatShading />
        </mesh>
      ))}
      {/* trail sign */}
      <group position={[-3.1, terrainH(-3.1, 30.6), 30.6]} rotation={[0, 0.5, 0]}>
        <mesh castShadow position={[0, 0.5, 0]}>
          <cylinderGeometry args={[0.045, 0.055, 1.0, 6]} />
          <meshStandardMaterial color="#6d5844" roughness={0.9} flatShading />
        </mesh>
        <mesh castShadow position={[0.14, 0.86, 0]} rotation={[0, 0, -0.04]}>
          <boxGeometry args={[0.52, 0.16, 0.04]} />
          <meshStandardMaterial color="#8a7358" roughness={0.9} flatShading />
        </mesh>
      </group>
    </group>
  );
}

/** Split-rail fence along the parcel's front line, gap at the trail gate. */
function Fence() {
  const posts: [number, number][] = [];
  for (let x = -10.5; x <= 10.6; x += 2.1) {
    if (x > -1.6 && x < 1.6) continue; // gate gap where the path crosses
    posts.push([x, 8.5]);
  }
  const rails: { a: [number, number]; b: [number, number] }[] = [];
  for (let i = 0; i < posts.length - 1; i++) {
    const [ax] = posts[i];
    const [bx] = posts[i + 1];
    if (bx - ax > 2.2) continue; // skip the gate span
    rails.push({ a: posts[i], b: posts[i + 1] });
  }
  return (
    <group>
      {/* split rails silver unevenly in the weather — per-piece tone drift,
          a touch wider than the deck's (fence lumber is never matched) */}
      {posts.map(([x, z], i) => (
        <mesh key={`p${i}`} castShadow position={[x, terrainH(x, z) + 0.42, z]}>
          <boxGeometry args={[0.11, 0.9, 0.11]} />
          <meshStandardMaterial color={pieceTone("#84735e", i + 29, 0.08)} roughness={0.95} flatShading />
        </mesh>
      ))}
      {rails.map(({ a, b }, i) => {
        const ya = terrainH(a[0], a[1]);
        const yb = terrainH(b[0], b[1]);
        return [0.3, 0.62].map((h, j) => {
          const cx = (a[0] + b[0]) / 2;
          const cy = (ya + yb) / 2 + h;
          const len = Math.hypot(b[0] - a[0], yb - ya);
          const tilt = Math.atan2(yb - ya, b[0] - a[0]);
          return (
            <mesh key={`r${i}-${j}`} castShadow position={[cx, cy, a[1]]} rotation={[0, 0, tilt]}>
              <boxGeometry args={[len + 0.15, 0.07, 0.07]} />
              <meshStandardMaterial color={pieceTone("#8d7c66", i * 2 + j + 53, 0.07)} roughness={0.95} flatShading />
            </mesh>
          );
        });
      })}
    </group>
  );
}

function PathStones() {
  return (
    <group>
      {PATH_STONES.map(([x, z], i) => {
        const r = 0.22 + ((i * 7) % 3) * 0.04;
        return (
          <mesh
            key={i}
            receiveShadow
            castShadow
            position={[x + Math.sin(i * 3.7) * 0.15, terrainH(x, z) - 0.03, z]}
            rotation={[0, i * 1.3, 0]}
          >
            <cylinderGeometry args={[r, r + 0.05, 0.14, 7]} />
            {/* quarried stone is never one grey — per-slab value drift + mottle */}
            <meshStandardMaterial map={makeStoneMottle()} color={pieceTone("#9aa39b", i + 83, 0.06, 0.006)} roughness={0.95} flatShading />
          </mesh>
        );
      })}
    </group>
  );
}

/* --------------------------- beat props ----------------------------- */

function BeatProps({ progressRef, reduced }: { progressRef: React.MutableRefObject<number>; reduced: boolean }) {
  const parcelMat = useRef<THREE.LineBasicMaterial>(null);
  const stakes = useRef<THREE.Group>(null);
  const ringMat = useRef<THREE.MeshBasicMaterial>(null);
  const ring = useRef<THREE.Group>(null);

  const parcelGeo = useMemo(() => {
    const w = 10.5, d = 8.5, y = 0.09;
    const pts = [
      new THREE.Vector3(-w, y, -d), new THREE.Vector3(w, y, -d),
      new THREE.Vector3(w, y, -d), new THREE.Vector3(w, y, d),
      new THREE.Vector3(w, y, d), new THREE.Vector3(-w, y, d),
      new THREE.Vector3(-w, y, d), new THREE.Vector3(-w, y, -d),
    ];
    return new THREE.BufferGeometry().setFromPoints(pts);
  }, []);

  useFrame(() => {
    if (reduced) return;
    const p = progressRef.current;
    const land = near(p, 1);
    const design = near(p, 2);
    if (parcelMat.current) parcelMat.current.opacity = land * 0.85;
    if (stakes.current) stakes.current.visible = land > 0.02;
    if (ringMat.current) ringMat.current.opacity = design * 0.8;
    if (ring.current) {
      ring.current.visible = design > 0.02;
      const s = 0.92 + 0.08 * easeOutCubic(design);
      ring.current.scale.set(s, 1, s);
    }
  });

  return (
    <group>
      <lineSegments geometry={parcelGeo}>
        <lineBasicMaterial ref={parcelMat} color="#84b32c" transparent opacity={0} depthWrite={false} />
      </lineSegments>
      <group ref={stakes} visible={false}>
        {([[-10.5, -8.5], [10.5, -8.5], [10.5, 8.5], [-10.5, 8.5]] as [number, number][]).map(([x, z], i) => (
          <mesh key={i} position={[x, terrainH(x, z) + 0.3, z]} castShadow>
            <cylinderGeometry args={[0.05, 0.07, 0.6, 6]} />
            <meshStandardMaterial color="#84b32c" roughness={0.8} flatShading />
          </mesh>
        ))}
      </group>
      <group ref={ring} visible={false}>
        <mesh position={[0, 0.08, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[7.0, 7.18, 80]} />
          <meshBasicMaterial ref={ringMat} color="#10b981" transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      </group>
    </group>
  );
}

/* ------------------------------ forest ------------------------------ */

const PATCHES: { pos: [number, number, number]; rotY?: number; scale?: number }[] = [
  { pos: [-23, 0, -14], rotY: 0.3, scale: 1.3 },
  { pos: [20, 0, -18], rotY: 1.2, scale: 1.35 },
  { pos: [-11, 0, -24], rotY: 2.1, scale: 1.5 },
  { pos: [28, 0, -8], rotY: 0.6, scale: 1.25 },
  { pos: [-31, 0, -4], rotY: 2.8, scale: 1.4 },
  { pos: [4, 0, -26], rotY: 5.0, scale: 1.6 },
  { pos: [30, 0, -24], rotY: 3.4, scale: 1.8 },
  { pos: [-33, 0, -20], rotY: 1.7, scale: 1.85 },
  { pos: [-26, 0, 16], rotY: 0.9, scale: 1.1 },
  { pos: [30, 0, 14], rotY: 5.6, scale: 1.15 },
  { pos: [-17, 0, -33], rotY: 4.1, scale: 1.9 },
  { pos: [15, 0, -34], rotY: 0.2, scale: 2.0 },
  { pos: [-13, 0, 27], rotY: 2.4, scale: 1.05 },
  { pos: [15, 0, 28], rotY: 3.9, scale: 1.1 },
  { pos: [-9, 0, 33], rotY: 1.4, scale: 1.0 },
  { pos: [10, 0, 34], rotY: 4.6, scale: 0.95 },
];

const TEAL_PINES: { pos: [number, number, number]; rotY?: number; scale?: number }[] = [
  { pos: [-10.5, 0, -5], rotY: 0.4, scale: 1.0 },
  { pos: [9.5, 0, -4.5], rotY: 1.9, scale: 0.9 },
  { pos: [-13.5, 0, 5.5], rotY: 3.1, scale: 1.1 },
  { pos: [5, 0, -10], rotY: 2.2, scale: 1.05 },
  { pos: [-5.5, 0, -11.5], rotY: 4.4, scale: 0.9 },
  { pos: [14.5, 0, -10], rotY: 5.1, scale: 1.2 },
  { pos: [12.5, 0, 15.5], rotY: 1.1, scale: 0.85 },
  { pos: [-11.5, 0, 17.5], rotY: 4.9, scale: 0.9 },
  { pos: [-6.5, 0, 24.5], rotY: 2.6, scale: 0.8 },
  { pos: [9.0, 0, 25.5], rotY: 5.7, scale: 0.75 },
  { pos: [-5.0, 0, 28.5], rotY: 1.3, scale: 0.85 },
  { pos: [6.0, 0, 29.5], rotY: 3.8, scale: 0.7 },
];

const ROCKS: { pos: [number, number, number]; rotY?: number; scale?: number }[] = [
  { pos: [3.8, 0, 8.6], rotY: 0.7, scale: 0.45 },
  { pos: [-6.4, 0, 3.4], rotY: 2.4, scale: 0.32 },
  { pos: [7.6, 0, -2.6], rotY: 1.1, scale: 0.6 },
  { pos: [-8.6, 0, -6.2], rotY: 3.8, scale: 0.85 },
  { pos: [2.1, 0, -6.6], rotY: 5.2, scale: 0.4 },
  { pos: [-2.9, 0, 9.8], rotY: 0.2, scale: 0.24 },
  { pos: [4.6, 0, 11.8], rotY: 1.6, scale: 0.4 },
];

/* Garden lanterns at the places a person would put them: flanking the
   steps, at the gate, by the tub, and one at the trail sign. */
const LANTERNS: { pos: [number, number, number]; rotY?: number; scale?: number }[] = [
  { pos: [1.15, 0, 7.15], rotY: 0.4, scale: 1 },
  { pos: [-1.05, 0, 7.05], rotY: 2.2, scale: 1 },
  { pos: [1.35, 0, 8.75], rotY: 1.1, scale: 1 },
  { pos: [4.75, 0, 6.9], rotY: 5.2, scale: 1 },
  { pos: [-2.65, 0, 30.15], rotY: 2.8, scale: 1 },
];

function Forest({ frozen }: { frozen: boolean }) {
  const pines = useGLTF(MODELS.pines);
  const teal = useGLTF(MODELS.pineTeal);
  const rocks = useGLTF(MODELS.rocks);
  const sway = useRef<THREE.Group[]>([]);

  useLayoutEffect(() => {
    /* The GLTF pines shipped glossy: env-map specular painted white glints
       across every canopy facet, which paled the stands toward the grass's
       yellow-green — from the trailhead the treeline read as a row of giant
       blades. Matte them fully, mute the env reflection, and deepen the
       green a step darker and cooler than any blade tip so the two
       silhouettes separate by VALUE, not just shape. */
    pines.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        const mat = m.material as THREE.MeshStandardMaterial;
        if (mat.name === "Green") mat.color.set("#356247");
        if (mat.name === "Wood") mat.color.set("#5d4030");
        mat.roughness = 1;
        mat.metalness = 0;
        mat.envMapIntensity = 0.3;
      }
    });
    teal.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        const mat = m.material as THREE.MeshStandardMaterial;
        mat.roughness = 1;
        mat.metalness = 0;
        mat.envMapIntensity = 0.35;
      }
    });
    rocks.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) (m.material as THREE.MeshStandardMaterial).color.set("#828d84");
    });
  }, [pines.scene, teal.scene, rocks.scene]);

  const patchClones = useNormalizedClones(pines.scene, 5.2, PATCHES);
  const tealClones = useNormalizedClones(teal.scene, 4.3, TEAL_PINES);
  const rockClones = useNormalizedClones(rocks.scene, 1.4, ROCKS);

  /* WIND v2 — a single direction, so trees BEND instead of bobbing.
     v1's mistake was driving rotation.z and rotation.x from two independent
     sine waves with different phases. rotation.x tips a tree toward and away
     from the camera, and when it is out of phase with the sideways lean the
     canopy appears to bob up and down rather than lean in a breeze.
     Real wind has one direction at a time. Here one scalar `lean` — slow
     sway plus a rolling gust front plus a small per-tree offset — is
     projected onto the two axes through a FIXED wind heading, so every tree
     leans the same way at the same moment and the stand moves as a stand.
     The clone groups are already planted with their origin at the trunk
     base, so rotating the group is a trunk-anchored bend. */
  const WIND_DIR = 0.62; // heading in radians, blowing across the meadow
  const wcos = Math.cos(WIND_DIR);
  const wsin = Math.sin(WIND_DIR);

  useFrame(({ clock }) => {
    if (frozen) return;
    const t = clock.elapsedTime;
    sway.current.forEach((g, i) => {
      if (!g) return;
      const phase = i * 0.7;
      const slow = Math.sin(t * 0.42 + phase) * 0.5 + 0.5; // 0..1
      const gustFront = Math.sin(t * 0.85 - g.position.x * 0.12 - g.position.z * 0.09);
      const gust = Math.max(0, gustFront) * 0.55;
      const lean = (0.007 + slow * 0.005 + gust * 0.011) * 1.0;
      g.rotation.z = -lean * wcos;
      g.rotation.x = lean * wsin;
    });
  });

  return (
    <group>
      {patchClones.map((g, i) => (
        <group
          key={`p${i}`}
          ref={(el) => {
            if (el) sway.current[i] = el;
          }}
        >
          <primitive object={g} />
        </group>
      ))}
      {tealClones.map((g, i) => (
        <group
          key={`t${i}`}
          ref={(el) => {
            if (el) sway.current[PATCHES.length + i] = el;
          }}
        >
          <primitive object={g} />
        </group>
      ))}
      {rockClones.map((g, i) => (
        <primitive key={`r${i}`} object={g} />
      ))}
    </group>
  );
}

function Props({ dusk }: { dusk: Dusk }) {
  const cabin = useGLTF(MODELS.cabin);
  const lantern = useGLTF(MODELS.lantern);
  const glowTex = useSoftTexture(
    useMemo<[number, string][]>(
      () => [
        [0, "rgba(255,205,130,0.9)"],
        [0.5, "rgba(255,205,130,0.25)"],
        [1, "rgba(255,205,130,0)"],
      ],
      []
    )
  );
  const glows = useRef<(THREE.SpriteMaterial | null)[]>([]);
  useLayoutEffect(
    () =>
      dusk.add((d) => {
        glows.current.forEach((m) => {
          if (m) m.opacity = 0.04 + d * 0.28;
        });
      }),
    [dusk]
  );

  // The old log cabin lives on at the forest edge — depth and a story.
  const cabinClones = useNormalizedClones(
    cabin.scene,
    2.9,
    useMemo(() => [{ pos: [-17.5, 0, 10.5] as [number, number, number], rotY: 1.9, scale: 1 }], [])
  );
  const lanternClones = useNormalizedClones(lantern.scene, 0.38, LANTERNS);

  return (
    <group>
      <primitive object={cabinClones[0]} />
      {lanternClones.map((g, i) => (
        <group key={i}>
          <primitive object={g} />
          <sprite position={[g.position.x, g.position.y + 0.24, g.position.z]} scale={[0.5, 0.5, 1]}>
            <spriteMaterial
              ref={(el) => {
                glows.current[i] = el;
              }}
              map={glowTex}
              transparent
              depthWrite={false}
              opacity={0.06}
            />
          </sprite>
        </group>
      ))}
    </group>
  );
}

/* ------------------------------ hotspots ---------------------------- */

const HOTSPOTS = [
  {
    id: "glass",
    pos: [0, 2.7, 3.15] as [number, number, number],
    label: "Glass gable",
    spec: "Triple-glazed units on the south face — passive gain, zone 7A honest.",
  },
  {
    id: "solar",
    pos: [2.7, 3.4, 0] as [number, number, number],
    label: "Solar array",
    spec: "6.4 kW roof array with battery. December needs the wood stove — published, not hidden.",
  },
  {
    id: "tub",
    pos: [5.9, 1.5, 5.4] as [number, number, number],
    label: "Wood-fired tub",
    spec: "Cedar tub, wood-fired — no grid draw, snow optional.",
  },
];

function Hotspots() {
  const [active, setActive] = useState<string | null>(null);
  return (
    <group>
      {HOTSPOTS.map((h) => (
        <Html key={h.id} position={h.pos} center occlude zIndexRange={[2, 2]}>
          <div className={`story-hotspot ${active === h.id ? "on" : ""}`}>
            <button
              type="button"
              aria-label={h.label}
              onClick={() => setActive(active === h.id ? null : h.id)}
            >
              <i />
            </button>
            <div className="story-hotspot-chip" role="status">
              <strong>{h.label}</strong>
              <span>{h.spec}</span>
            </div>
          </div>
        </Html>
      ))}
    </group>
  );
}

/* ------------------------------- rig -------------------------------- */

function CameraRig({ progressRef, reduced }: { progressRef: React.MutableRefObject<number>; reduced: boolean }) {
  const { camera } = useThree();
  const rig = useRef({ smooth: 0, mx: 0, my: 0, started: -1, lastDusk: -1 });
  const curves = useMemo(() => {
    const P = new THREE.CatmullRomCurve3(
      CTRL.map((c) => new THREE.Vector3(c.p[0], c.ground ? terrainH(c.p[0], c.p[2]) + c.p[1] : c.p[1], c.p[2])),
      false,
      "catmullrom",
      0.38
    );
    const T = new THREE.CatmullRomCurve3(CTRL.map((c) => new THREE.Vector3(...c.t)), false, "catmullrom", 0.38);
    return { P, T };
  }, []);
  const _p = useMemo(() => new THREE.Vector3(), []);
  const _t = useMemo(() => new THREE.Vector3(), []);
  const _d = useMemo(() => new THREE.Vector3(), []);

  useLayoutEffect(() => {
    if (reduced) {
      camera.position.set(...REDUCED_SHOT.p);
      camera.lookAt(new THREE.Vector3(...REDUCED_SHOT.t));
      (camera as THREE.PerspectiveCamera).fov = REDUCED_SHOT.fov;
      camera.updateProjectionMatrix();
      document.documentElement.style.setProperty("--st-dusk", "1");
    }
  }, [camera, reduced]);

  useFrame((state, dt) => {
    if (reduced) return;
    const r = rig.current;
    const d = Math.min(dt, 1 / 20);
    r.smooth = THREE.MathUtils.damp(r.smooth, progressRef.current, 5, d);
    r.mx = THREE.MathUtils.damp(r.mx, state.pointer.x, 3, d);
    r.my = THREE.MathUtils.damp(r.my, state.pointer.y, 3, d);
    if (r.started < 0) r.started = state.clock.elapsedTime;
    const intro = easeOutCubic(clamp01((state.clock.elapsedTime - r.started) / 2.2));

    const N = 6; // beats 0..6
    const u = clamp01(r.smooth / N);
    curves.P.getPoint(u, _p);
    curves.T.getPoint(u, _t);
    // fov follows the even-indexed beat controls
    const fi = Math.min(Math.floor(r.smooth), N - 1);
    const ff = clamp01(r.smooth - fi);
    let fov = THREE.MathUtils.lerp(CTRL[fi * 2].fov, CTRL[Math.min(fi + 1, N) * 2].fov, ff);

    // Tall-frame fix: step back along the view axis and open the lens.
    const aspect = state.size.width / state.size.height;
    const nf = clamp01((1.55 - aspect) / 1.0);
    if (nf > 0) {
      _d.subVectors(_p, _t).normalize();
      _p.addScaledVector(_d, nf * 5.5);
      _p.y += nf * 0.8;
      fov *= 1 + nf * 0.32;
    }

    // Opening dolly.
    const io = 1 - intro;
    _p.z += io * 4.2;
    _p.y += io * 0.5;
    fov += io * 6;

    // Pointer parallax — hand-held, fading deeper into the journey.
    const par = 1 - clamp01(r.smooth / 1.6) * 0.5;
    _p.x += r.mx * 0.5 * par;
    _p.y += r.my * 0.28 * par;
    _t.x -= r.mx * 0.16 * par;
    _t.y -= r.my * 0.09 * par;

    // Never sink into the terrain.
    const minY = terrainH(_p.x, _p.z) + 0.7;
    if (_p.y < minY) _p.y = minY;

    camera.position.copy(_p);
    camera.lookAt(_t);
    const pc = camera as THREE.PerspectiveCamera;
    if (Math.abs(pc.fov - fov) > 1e-4) {
      pc.fov = fov;
      pc.updateProjectionMatrix();
    }

    // Publish dusk to the DOM sky (throttled).
    const dusk = smoothstep(4.0, 6.0, r.smooth);
    if (Math.abs(dusk - r.lastDusk) > 0.01) {
      r.lastDusk = dusk;
      document.documentElement.style.setProperty("--st-dusk", dusk.toFixed(3));
    }
  });
  return null;
}

/* ------------------------- atmosphere / light ------------------------ */

/* Night sky. One Points cloud on a dome, built once, opacity-faded by the
   night amount so switching modes costs nothing but a uniform. */
function StarField({ amount }: { amount: number }) {
  const geo = useMemo(() => {
    const N = 700;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const s = Math.sin(i * 91.7) * 43758.5453;
      const a = (s - Math.floor(s)) * Math.PI * 2;
      const t = Math.sin(i * 33.1) * 43758.5453;
      const el = 0.08 + (t - Math.floor(t)) * 0.72;
      const r = 190;
      pos[i * 3] = Math.cos(a) * Math.cos(el) * r;
      pos[i * 3 + 1] = Math.sin(el) * r;
      pos[i * 3 + 2] = Math.sin(a) * Math.cos(el) * r;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    return g;
  }, []);
  if (amount < 0.02) return null;
  return (
    <points geometry={geo} renderOrder={-11}>
      <pointsMaterial size={1.15} sizeAttenuation color="#dfe9f5" transparent opacity={amount * 0.95} fog={false} />
    </points>
  );
}

function LightArc({
  progressRef,
  reduced,
  dusk,
  night = 0,
}: {
  progressRef: React.MutableRefObject<number>;
  reduced: boolean;
  dusk: Dusk;
  night?: number;
}) {
  const sun = useRef<THREE.DirectionalLight>(null);
  const hemi = useRef<THREE.HemisphereLight>(null);
  const { scene } = useThree();
  const rig = useRef({ smooth: 0 });
  /* THE KEY. It used to sit at (16, 26, 12) — 52 degrees of elevation, which
     is nearly overhead: every prop's shadow collapsed underneath it and only
     the deck, which is large, showed any contact at all. Rocks, fence posts,
     lanterns and chairs looked pasted on. (18, 16, 13) is 33 degrees, so a
     0.5 m rock throws a 0.8 m shadow the camera can actually see. The same
     vector is the baked light in SceneDetail's KEY — one key, one direction,
     everywhere. */
  const cools = useMemo(
    () => ({
      sunP: new THREE.Vector3(18, 16, 13).multiplyScalar(1.5),
      sunC: new THREE.Color("#fff3dd"),
      fogC: new THREE.Color("#e3ede7"),
    }),
    []
  );
  const warms = useMemo(
    () => ({
      sunP: new THREE.Vector3(-18, 7, 18),
      sunC: new THREE.Color("#ffb46b"),
      fogC: new THREE.Color("#eedcc6"),
    }),
    []
  );
  const nights = useMemo(
    () => ({
      sunP: new THREE.Vector3(-14, 30, -10), // moon
      sunC: new THREE.Color("#9fb6d8"),
      fogC: new THREE.Color("#161f2b"),
    }),
    []
  );
  const _c = useMemo(() => new THREE.Color(), []);
  const _v = useMemo(() => new THREE.Vector3(), []);

  useFrame((state, dt) => {
    const target = reduced ? 6 : progressRef.current;
    rig.current.smooth = reduced ? 6 : THREE.MathUtils.damp(rig.current.smooth, target, 5, Math.min(dt, 1 / 20));
    /* The scroll dusk arc and the night toggle compose rather than compete:
       night FLOORS the arc at full, so flipping to night at the top of the
       page lands in the same warm-then-dark place the journey would have. */
    const d = Math.max(smoothstep(4.0, 6.0, rig.current.smooth), night);
    dusk.set(d);
    if (sun.current) {
      _v.lerpVectors(cools.sunP, warms.sunP, d);
      // moon rides higher and colder than the setting sun
      _v.lerp(nights.sunP, night);
      sun.current.position.copy(_v);
      _c.lerpColors(cools.sunC, warms.sunC, d);
      _c.lerp(nights.sunC, night);
      sun.current.color.copy(_c);
      sun.current.intensity = (2.6 - d * 0.9) * (1 - night * 0.82);
    }
    if (hemi.current) hemi.current.intensity = (0.32 - d * 0.08) * (1 - night * 0.72);
    /* The sky bake is the soft fill. It eases down with dusk, and almost
       leaves once night takes the moon. */
    scene.environmentIntensity = (0.62 - d * 0.1) * (1 - night * 0.86);
    const fog = scene.fog as THREE.Fog | null;
    if (fog) {
      _c.lerpColors(cools.fogC, warms.fogC, d);
      _c.lerp(nights.fogC, night);
      fog.color.copy(_c);
    }
  });

  return (
    <>
      <hemisphereLight ref={hemi} args={["#d5e4ee", "#8ea184", 0.32]} />
      <ambientLight intensity={0.05} />
      <directionalLight
        ref={sun}
        castShadow
        position={[27, 24, 19.5]}
        color="#fff3dd"
        intensity={2.6}
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.00025}
        shadow-normalBias={0.012}
        /* tightened from +/-30 to +/-24: the story never leaves this box,
           and 48 m across a 2048 map is 2.3 cm a texel instead of 2.9 —
           which is the difference between a fence post casting something
           and casting nothing. */
        shadow-camera-left={-24}
        shadow-camera-right={24}
        shadow-camera-top={24}
        shadow-camera-bottom={-24}
        shadow-camera-near={1}
        shadow-camera-far={90}
      />
    </>
  );
}

/* Outdoor sky, baked once on the page renderer. Values above 1 in the sun
   disc are the HDR highlight. No rectangular softboxes. */
const SKY_VERT = `
  varying vec3 vPos;
  void main() {
    vPos = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const SKY_FRAG = `
  varying vec3 vPos;
  void main() {
    vec3 n = normalize(vPos);
    float h = n.y;
    vec3 zenith = vec3(0.70, 0.82, 0.90);
    vec3 horizon = vec3(0.97, 0.90, 0.78);
    vec3 ground = vec3(0.42, 0.50, 0.36);
    vec3 sky = mix(horizon, zenith, smoothstep(0.0, 0.62, h));
    vec3 col = mix(ground, sky, smoothstep(-0.18, 0.06, h));
    vec3 sunDir = normalize(vec3(0.55, 0.48, 0.42));
    float glow = pow(max(dot(n, sunDir), 0.0), 3.5);
    float sun = pow(max(dot(n, sunDir), 0.0), 36.0);
    col += vec3(1.05, 0.82, 0.55) * glow * 0.28;
    col += vec3(1.35, 1.05, 0.72) * sun * 2.1;
    gl_FragColor = vec4(col, 1.0);
  }
`;

function OutdoorSky() {
  return (
    <mesh scale={90}>
      <sphereGeometry args={[1, 20, 14]} />
      <shaderMaterial side={THREE.BackSide} depthWrite={false} vertexShader={SKY_VERT} fragmentShader={SKY_FRAG} />
    </mesh>
  );
}

/* ------------------------------ scene ------------------------------- */

export default function Scene({
  progressRef,
  reduced,
  night = false,
}: {
  progressRef: React.MutableRefObject<number>;
  reduced: boolean;
  night?: boolean;
}) {
  const dusk = useDuskRegistry();
  const archGlass = useArchGlass();
  const glassFloor = useGlassFloor();
  const glassRail = useGlassRail();

  /* Night is a target the whole scene damps toward rather than a hard swap,
     so the toggle reads as the sun going down instead of a light switch.
     The scroll-driven dusk arc still runs underneath it — night simply
     floors it at full, which is why the two never fight. */
  const nightRef = useRef(0);
  const [nightAmt, setNightAmt] = useState(0);
  useFrame((_, dt) => {
    const target = night ? 1 : 0;
    const v = THREE.MathUtils.damp(nightRef.current, target, 2.2, Math.min(dt, 1 / 20));
    if (Math.abs(v - nightRef.current) > 0.0005) {
      nightRef.current = v;
      setNightAmt(Number(v.toFixed(3)));
      document.documentElement.style.setProperty("--st-night", v.toFixed(3));
    }
  });

  return (
    <>
      <fog attach="fog" args={["#e3ede7", 30, 88]} />
      {/* PCSS — the sun key gets a real penumbra: crisp at the caster's
          foot, softening with distance, which is the single strongest
          "expensive light" cue a shadow can carry. Mounted with the scene
          so shaders compile once, naturally. */}
      <SoftShadows size={14} samples={10} focus={0.4} />
      <LightArc progressRef={progressRef} reduced={reduced} dusk={dusk} night={nightAmt} />

      <Environment resolution={64} frames={1}>
        <OutdoorSky />
      </Environment>

      {/* Stars — only ever built once, faded in by the night amount. */}
      <StarField amount={nightAmt} />

      <Terrain />
      <Forest frozen={reduced} />
      <Props dusk={dusk} />

      <AFrameHome dusk={dusk} archGlass={archGlass} glassRoof={glassFloor} />
      <Deck glassFloor={glassFloor} glassRail={glassRail} />
      <Walkway glassFloor={glassFloor} glassRail={glassRail} />

      {/* The additive detail layer — mountains, clouds, grass, steps,
          hammock, netting, wildlife, outdoor lighting, tub steam. */}
      <SceneDetail frozen={reduced} night={nightAmt} glassRail={glassRail} dusk={dusk} />
      <HotTub position={[5.9, 0, 5.4]} dusk={dusk} frozen={reduced} />
      <FirePit dusk={dusk} />
      <Bench position={[8.6, terrainH(8.6, 18.0) - 0.14, 18.0]} rotY={Math.PI * 1.12} />
      <PathStones />
      <Trailhead />
      <Fence />

      {/* string lights: a small canopy over the fire-pit lounge only —
          never crossing the glass facade or the deck framing */}
      <LightPole position={[-3.95, 2.5, 3.1]} />
      <LightPole position={[-6.7, 2.4, 5.3]} />
      <LightPole position={[-4.7, 2.45, 8.1]} />
      <StringLights
        points={[
          [-3.95, 2.46, 3.1],
          [-6.7, 2.36, 5.3],
          [-4.7, 2.41, 8.1],
        ]}
        dusk={dusk}
      />

      <BeatProps progressRef={progressRef} reduced={reduced} />
      <Hotspots />

      {/* chimney wisp; tub steam; fire pit smoke */}
      <Smoke origin={[0.9, 5.3, -2.2]} size={0.62} rise={3.0} opacity={0.3} frozen={reduced} />
      <Smoke origin={[7.16, 1.5, 5.32]} count={4} rate={0.2} size={0.32} rise={1.4} drift={0.1} opacity={0.22} frozen={reduced} />
      <Smoke origin={[-4.6, 0.8, 6.2]} count={5} rate={0.13} size={0.5} rise={2.2} drift={0.2} opacity={0.22} frozen={reduced} />

      <Mist frozen={reduced} />
      {/* size 2.2 / opacity 0.4 read as UFO orbs once dusk emissives pushed
          them over the bloom threshold — dust motes, not fireflies */}
      <Sparkles count={80} scale={[28, 8, 28]} position={[0, 3.5, 2]} size={1.6} speed={reduced ? 0 : 0.25} opacity={0.28} color="#fff6dd" />
      <SunShafts progressRef={progressRef} night={nightAmt} reduced={reduced} />

      <CameraRig progressRef={progressRef} reduced={reduced} />

      {/* N8AO was trialled here (round1–2b) and REJECTED. Its grounding gain was
          subtle, but the n8ao pass resolves a depth-STENCIL buffer that this AMD
          driver rejects with GL_INVALID_OPERATION on glBlitFramebuffer ~256x per
          frame — independent of halfRes or the composer's multisampling, so not
          fixable from the app side — and its full-res mode nearly halved the
          frame rate. Grounding is carried instead by the real directional
          shadows (now PCSS-softened) and the terrain's meadow-shade fake AO.
          MSAA 4 stays: it super-samples the thin grass/tree silhouettes better
          than a post SMAA pass could, and with no depth-reading effect in the
          chain it is completely clean. */}
      <EffectComposer multisampling={4}>
        <Bloom mipmapBlur intensity={0.25} luminanceThreshold={0.9} luminanceSmoothing={0.3} />
        <Vignette eskil={false} offset={0.16} darkness={0.26} />
        <Noise opacity={0.03} />
      </EffectComposer>
    </>
  );
}
