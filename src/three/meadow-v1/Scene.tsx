"use client";

import { useMemo, useRef, useState, useLayoutEffect } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
/* Html is gone with the hotspot markers — the scene now draws nothing on a
   DOM layer above the canvas, which is also why nothing in the world can
   overlap the copy plates any more. */
import { useGLTF, Sparkles, Environment, Lightformer, SoftShadows } from "@react-three/drei";
import { EffectComposer, Bloom, Vignette, Noise } from "@react-three/postprocessing";
import { withBase } from "../../lib/basePath";
import type { OpeningSceneStage, SceneQuality } from "@/lib/three/sceneQuality";
import { NORDIC_MATERIALS } from "@/lib/three/nordicMaterials";
import { MEADOW_SPARKLE_SPEED } from "@/lib/three/meadow/contract";
/* The home, the deck, the flight, the walkway and the walked route are drawn
   HERE and masked out of the meadow somewhere else. Both halves read the same
   numbers from this module. Two copies of them is how grass shipped standing
   through the deck, and later through the lower treads — a copy in this file
   is the specific defect the module exists to make impossible. */
import {
  BENCH_CENTER,
  DECK_GLASS_BAY,
  DECK_PLANKS,
  DECK_RAIL,
  DECK_RECT,
  DECK_STEPS,
  DECK_STEPS_RAKE,
  FIREPIT_HEARTH,
  HOUSE_SHELL,
  PATH,
  TUB_CENTER,
  WALKWAY_MESH,
} from "@/lib/three/meadow/geometry";
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
  { p: [0.8, 1.8, 8.3], t: [0.2, 2.0, 3.8], fov: 41, ground: 1 }, // 4 PAYMENTS — at the foot of the steps
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

/** Big architectural glass. The full material remains available for an
 * explicit high-quality view; the landing uses the transparent standard
 * shader so four transmission programs cannot block its first frame. */
function useArchGlass(rich: boolean) {
  return useMemo(() => {
    return rich
      ? new THREE.MeshPhysicalMaterial({
          transmission: 0.94,
          roughness: 0.06,
          ior: 1.5,
          thickness: 0.4,
          color: new THREE.Color("#e4f4ee"),
          envMapIntensity: 1.3,
          side: THREE.DoubleSide,
        })
      : new THREE.MeshStandardMaterial({
          transparent: true,
          opacity: 0.3,
          roughness: 0.18,
          color: new THREE.Color("#cfe3dd"),
          side: THREE.DoubleSide,
          depthWrite: false,
        });
  }, [rich]);
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
function useGlassFloor(rich: boolean) {
  return useMemo(
    () =>
      new (rich ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial)({
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
    [rich]
  );
}

/** Roof glazing — the skylight run on the west slope.
 *
 *  THE WHITE STRIPES ON THE ROOF. Critics read hard diagonal white bands
 *  across the upper slope as a broken texture or a UV seam. It was neither:
 *  the skylight was borrowing useGlassFloor(), whose roughness 0.05 /
 *  envMapIntensity 1.5 is tuned for a HORIZONTAL pane seen at a glancing
 *  angle. Tilted up into the key Lightformer, that same material returns a
 *  near-mirror specular and clips to white — while the five dark glazing bars
 *  crossing it stayed dark, turning a window into a set of painted stripes.
 *
 *  Roof glass gets its own material: rougher, far less reflective, and a
 *  fraction more opaque so it still reads as a surface rather than a hole.
 *  It keeps depthWrite and the floor renderOrder, because the sort-thrash and
 *  z-fighting fixes documented above apply to it identically.
 */
function useGlassRoof(rich: boolean) {
  return useMemo(
    () =>
      new (rich ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial)({
        transparent: true,
        opacity: 0.42,
        roughness: 0.22,
        metalness: 0,
        color: new THREE.Color("#cfe3dd"),
        envMapIntensity: 0.5,
        side: THREE.DoubleSide,
        depthWrite: true,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    [rich]
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
function useGlassRail(rich: boolean) {
  return useMemo(
    () =>
      new (rich ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial)({
        transparent: true,
        opacity: 0.11,
        roughness: 0.05,
        metalness: 0,
        color: new THREE.Color("#eaf4f0"),
        envMapIntensity: 0.85,
        side: THREE.FrontSide,
        depthWrite: false,
      }),
    [rich]
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
function Terrain({ segments = 200 }: { segments?: number }) {
  const geo = useMemo(() => {
    const SEG = segments;
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
  }, [segments]);
  /* TEXTURE PASS (Aug 10): sub-vertex ground detail lives in GLSL, not in a
     canvas. The vertex mottle above tops out at the mesh's own frequency —
     one facet per ~0.85 m — so anything the camera reads at 2-20 m was a
     flat painted facet. A CPU-drawn detail texture was the alternative and
     it loses on every axis here: it would need repeat wrapping (visible
     tiling on a 170 m plane), an upload, and filtering; a two-octave value
     noise in the fragment shader is resolution-independent, uploads
     nothing, and costs a handful of ALU. Amplitudes are LOW-CONTRAST value
     moves (±7% patch, ±3% micro) that multiply the approved palette — grain,
     not hue — and each octave fades out past the distance at which its
     features would alias into shimmer, which is what mipmaps do for real
     textures and what raw procedural noise otherwise gets wrong. */
  const mat = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: true,
      roughness: 1,
      metalness: 0,
    });
    m.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vTerraWorld;")
        .replace(
          "#include <begin_vertex>",
          "#include <begin_vertex>\nvTerraWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;"
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>
varying vec3 vTerraWorld;
float terraHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float terraNoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(terraHash(i), terraHash(i + vec2(1.0, 0.0)), u.x),
             mix(terraHash(i + vec2(0.0, 1.0)), terraHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float terraFbm(vec2 p){
  float v = 0.0, a = 0.5;
  for (int k = 0; k < 3; k++) { v += a * terraNoise(p); p = p * 2.13 + 17.0; a *= 0.5; }
  return v;
}
/* A tiny authored tuft atlas evaluated directly in world space. Three
   anti-aliased blades share one deterministic cell, so the terrain reads as
   a planted surface before any progressive instances arrive. This is one
   fragment-shader draw: no canvas upload and no synchronous field rebuild. */
float terraBlade(vec2 p, float lean){
  float stem = abs(p.x - lean * (p.y + 0.42));
  float taper = mix(0.048, 0.012, smoothstep(-0.42, 0.42, p.y));
  float aa = max(fwidth(stem) * 1.35, 0.006);
  float body = 1.0 - smoothstep(taper, taper + aa, stem);
  body *= smoothstep(-0.50, -0.34, p.y) * (1.0 - smoothstep(0.20, 0.48, p.y));
  return body;
}
float terraTuft(vec2 p){
  vec2 cell = floor(p);
  vec2 q = fract(p) - 0.5;
  float a = terraHash(cell + 19.7) * 6.2831853;
  mat2 rot = mat2(cos(a), -sin(a), sin(a), cos(a));
  q = rot * q;
  float left = terraBlade(q + vec2(0.16, 0.02), -0.34);
  float centre = terraBlade(q + vec2(0.00, -0.02), 0.02);
  float right = terraBlade(q + vec2(-0.16, 0.04), 0.32);
  return max(left, max(centre, right));
}
/* Low-poly botanical facets at the scale the opening camera can resolve.
   The diagonal is derivative-antialiased, and the whole pattern is faded at
   both close and far distances so it reads as sward variation rather than a
   screen-space checker or distant shimmer. */
float terraMeadowFacet(vec2 p){
  vec2 cell = floor(p);
  vec2 q = fract(p);
  float diagonal = q.x - q.y;
  float aa = max(fwidth(diagonal) * 1.35, 0.002);
  float split = smoothstep(-aa, aa, diagonal);
  float a = terraHash(cell + vec2(13.7, 31.1));
  float b = terraHash(cell + vec2(79.3, 17.9));
  return mix(a, b, split);
}`
        )
        .replace(
          "#include <color_fragment>",
          `#include <color_fragment>
{
  float terraD = length(vViewPosition);
  // ~0.5 m soil/patch variation, readable to ~60 m
  float terraPatch = terraFbm(vTerraWorld.xz * 2.1);
  float terraFadeP = 1.0 - smoothstep(26.0, 60.0, terraD);
  // ~9 cm micro grain for the ground right under the camera
  float terraMicro = terraNoise(vTerraWorld.xz * 11.0);
  float terraFadeM = 1.0 - smoothstep(10.0, 26.0, terraD);
  diffuseColor.rgb *= 1.0
    + (terraPatch - 0.47) * 0.14 * terraFadeP
    + (terraMicro - 0.5) * 0.06 * terraFadeM;

  /* Cheap meadow understorey. The real hero blades still own silhouettes and
     motion; this surface only closes the pale gaps that made the opening look
     depleted while worker pages were still promoting. It fades before the
     tuft cells become sub-pixel, preventing distant shimmer. */
  float terraRadius = length(vTerraWorld.xz);
  float terraRing = 1.0 - smoothstep(16.0, 46.0, terraRadius);
  float terraCorridor =
    (1.0 - smoothstep(9.0, 18.0, abs(vTerraWorld.x))) *
    smoothstep(5.5, 11.0, vTerraWorld.z) *
    (1.0 - smoothstep(33.0, 41.0, vTerraWorld.z));
  float terraScatter = 0.34 * (1.0 - smoothstep(28.0, 48.0, terraRadius));
  float terraBotanical = max(terraRing, max(terraCorridor, terraScatter));
  terraBotanical *= 1.0 - smoothstep(6.0, 15.0, -vTerraWorld.z);
  terraBotanical *= 1.0 - smoothstep(22.0, 52.0, terraD);
  /* Smaller cells increase apparent density in the distant opening camera
     while reading as finer, calmer ground texture close to the house. */
  float terraUnderstory = terraTuft(vTerraWorld.xz * 3.25) * terraBotanical;
  diffuseColor.rgb *= 1.0 - terraUnderstory * 0.27;
  float terraFacetFade = 1.0 - smoothstep(46.0, 68.0, terraD);
  float terraFacetDetail = (terraMeadowFacet(vTerraWorld.xz * 1.85) - 0.5) * terraFacetFade;
  diffuseColor.rgb *= 1.0 + terraFacetDetail * terraBotanical * 0.48;
}`
        );
    };
    return m;
  }, []);
  return <mesh geometry={geo} material={mat} receiveShadow />;
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

/* ---- texture sharpness plumbing (texture pass, Aug 10) ----
   Two distinct blurs were softening the procedural surfaces:
   1. RASTER BLUR — strokes drawn once into a 256/128 px canvas carry that
      canvas's antialiasing forever; magnified on a near-camera plank the
      smear is the texture. Each detail texture now draws into a backing
      store scaled by 2 x min(devicePixelRatio, 2) (ctx.scale keeps the
      pattern IDENTICAL — same rnd() sequence, same logical coords — only
      the rasterisation gets finer). The DPR term is capped at 2 so a 3x
      phone doesn't quadruple VRAM for texels its screen never resolves;
      the canvas dpr cap in StoryCanvas is 1.75 anyway.
   2. ANISOTROPY — the camera travels low across the deck and the stone
      path, and at grazing angles trilinear filtering alone collapses into
      the smallest mip. Every detail texture takes the GPU max (16 on the
      target AMD), wired from the renderer by Scene below. NOTE the soft
      radial-gradient sprites (smoke, mist, steam, glow, sun shafts) are
      deliberately NOT resized or filtered differently: a smooth gradient
      has no detail above its own smoothness, so a bigger store is the
      same pixels — measured as a no-op and skipped, not forgotten.
   Mip settings are the three.js defaults, asserted here so a future
   refactor cannot silently drop to non-mipped filtering (which is what
   makes mid-distance detail shimmer). colorSpace stays per-texture: sRGB
   where the texture carries colour, linear for the water normal map. */
const texDPR = () =>
  Math.min(Math.max(1, (typeof window !== "undefined" && window.devicePixelRatio) || 1), 2);

let _texAniso = 4;
/** Called by Scene with renderer.capabilities.getMaxAnisotropy(). Upgrades
 *  any texture already built (needsUpdate re-uploads it once). */
export function setProceduralAnisotropy(v: number) {
  _texAniso = v;
  for (const t of [_woodGrain, _stoneMottle, _waterNormal]) {
    if (t && t.anisotropy !== v) {
      t.anisotropy = v;
      t.needsUpdate = true;
    }
  }
}

export function sharpen<T extends THREE.Texture>(t: T): T {
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.anisotropy = _texAniso;
  return t;
}

/** Milled-cedar grain — mostly light, so `map * color` keeps the per-piece
 *  cedar tone and just carves long grain, faint cathedral figure and pore
 *  speckle into it. Streaks run along U, so it is applied ONLY where U is the
 *  plank's length (deck planks, step treads) and the grain direction is right. */
let _woodGrain: THREE.CanvasTexture | null = null;
export function makeWoodGrain(): THREE.CanvasTexture {
  if (_woodGrain) return _woodGrain;
  const c = document.createElement("canvas");
  /* Backing store scaled for sharpness (see the texture-pass note above);
     everything below draws in the original 256x128 logical space. */
  const S = 2 * texDPR();
  c.width = 256 * S;
  c.height = 128 * S;
  const ctx = c.getContext("2d")!;
  ctx.scale(S, S);
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
  sharpen(t);
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
  const S = 2 * texDPR();
  c.width = c.height = 128 * S;
  const ctx = c.getContext("2d")!;
  ctx.scale(S, S);
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
  sharpen(t);
  _stoneMottle = t;
  return t;
}

/** Tileable ripple NORMAL map for the tub water — a few periodic sine bumps
 *  turned into a normal field. Scrolled slowly in the tub's useFrame so the
 *  flat disc catches moving highlights and reads as warm, breathing water. */
let _waterNormal: THREE.CanvasTexture | null = null;
export function makeWaterNormal(): THREE.CanvasTexture {
  if (_waterNormal) return _waterNormal;
  /* 256 flat, no DPR term: the height field is analytic so more pixels are
     genuinely finer ripples, but the tub disc is 1.44 m across and never
     fills more than a fraction of the frame — 256 (2.8 mm/texel) is already
     past what any beat resolves, and the per-pixel JS loop is startup cost
     on phones. Measured reasoning, not an oversight. */
  const S = 256;
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
  // linear colour space (default) — this is a normal map; sRGB here would
  // decode the vectors as colour and flatten every ripple
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(2, 2);
  sharpen(t); // anisotropy matters: the water disc is always seen at an angle
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
  /* The shared sprite texture is near-white (#ecefea) because it was written
     for STEAM off the hot tub. Wood smoke tinted the same white against a
     pale #e3ede7 sky is invisible — which is why the chimney appeared to be
     venting nothing at all in every frame. spriteMaterial.color multiplies
     the map, so one prop lets steam stay white and smoke go grey. */
  color = "#ffffff",
  frozen = false,
}: {
  origin: [number, number, number];
  count?: number;
  rate?: number;
  size?: number;
  rise?: number;
  drift?: number;
  opacity?: number;
  color?: string;
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
          <spriteMaterial
            map={tex}
            color={color}
            transparent
            depthWrite={false}
            /* Frozen (prefers-reduced-motion) the useFrame never runs, so the
               plume would hang as a stack of identical sprites at the origin.
               Opacity 0 hides it; the still frame keeps a clean chimney. */
            opacity={frozen ? 0 : 0.01}
          />
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

/* ------------------------------- birds -------------------------------
   The sky was the stillest region of every frame — a gradient with a few
   clouds and nothing alive in it. A small flock fixes that for one draw
   call and 16 triangles.

   Each bird is a shallow V of two triangles. They ride one slow circling
   path at different radii, heights and phases, so the flock spreads and
   gathers the way a real one does instead of orbiting in formation. The
   "wingbeat" is a scale oscillation on the local X axis — at this distance
   a wing flap and a horizontal squash are indistinguishable, and squash
   costs one multiply against a skeleton's everything.

   FROZEN (prefers-reduced-motion): the matrices are written once on mount
   from t=0, so the still frame shows a composed, spread flock rather than
   sixteen triangles piled at the origin. */
const BIRD_N = 8;

function Birds({ frozen = false }: { frozen?: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    // a flattened V: centre at origin, tips swept back and slightly up
    const v = new Float32Array([
      0, 0, 0, -0.5, 0.16, -0.22, -0.5, 0, 0.02,
      0, 0, 0, 0.5, 0, 0.02, 0.5, 0.16, -0.22,
    ]);
    g.setAttribute("position", new THREE.BufferAttribute(v, 3));
    g.computeVertexNormals();
    return g;
  }, []);

  const place = (t: number) => {
    const m = ref.current;
    if (!m) return;
    for (let i = 0; i < BIRD_N; i++) {
      const phase = (i / BIRD_N) * Math.PI * 2;
      const r = 26 + (i % 4) * 5.5;
      const a = t * 0.055 + phase;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r * 0.72 - 6;
      const y = 17 + Math.sin(a * 1.7 + phase) * 2.6 + (i % 3) * 1.4;
      dummy.position.set(x, y, z);
      // face along the tangent of the circle
      dummy.rotation.set(0, -a + Math.PI / 2, Math.sin(a * 2.2 + phase) * 0.22);
      const beat = 0.72 + Math.sin(t * 6.4 + phase * 3.1) * 0.28;
      dummy.scale.set(1.05 * beat, 1, 1.05);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
  };

  useLayoutEffect(() => place(0), []); // eslint-disable-line react-hooks/exhaustive-deps
  useFrame(({ clock }) => {
    if (frozen) return;
    place(clock.elapsedTime);
  });

  return (
    <instancedMesh ref={ref} args={[geo, undefined, BIRD_N]} frustumCulled={false}>
      {/* unlit and slightly transparent: at 30m a bird is a silhouette, and
          a lit material would just make them flicker as they turn */}
      <meshBasicMaterial color="#3d4a45" transparent opacity={0.55} side={THREE.DoubleSide} />
    </instancedMesh>
  );
}

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

/* The shell's four defining numbers come from the module that also sizes
   HOUSE_RECT, the rect that keeps the meadow out of the house. */
const RIDGE_H = HOUSE_SHELL.ridgeY;
const EAVE = HOUSE_SHELL.halfWidth;
const EAVE_H = HOUSE_SHELL.eaveY;
const DEPTH = HOUSE_SHELL.halfDepth; // half depth
const ROOF_A = Math.atan2(EAVE, RIDGE_H - EAVE_H);
const SLOPE_L = Math.hypot(EAVE, RIDGE_H - EAVE_H);

/** Half-width of the A-frame at height y — the inside of the roof plane.
 *
 *  THE BEAMS THAT COME OUT THE SIDE OF THE ROOF. In an A-frame the usable
 *  width shrinks as you go up, and anything sized by eye rather than by this
 *  function eventually pokes through a roof plane and reads as a stray beam
 *  from the outside. It has happened three times now (the door transom, then
 *  the loft, then the kitchen run), so the rule is: any horizontal element
 *  inside the shell takes its width from halfAt(TOP of that element) — the
 *  top, because that is where the roof is tightest — minus a clearance. */
const halfAt = (y: number) => (EAVE * (RIDGE_H - y)) / (RIDGE_H - EAVE_H);
/** Widest a centred element may be if its top sits at y, with 6cm of air. */
const spanAt = (y: number, clear = 0.06) => Math.max(0, 2 * (halfAt(y) - clear));

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
  const hearth = useRef<THREE.PointLight>(null);
  const firebox = useRef<THREE.MeshStandardMaterial>(null);
  /* The dusk registry is push-only (add/set), so the flicker loop below —
     which needs the CURRENT dusk to scale against — keeps its own mirror
     rather than reaching into the registry's private sink set. */
  const duskAmt = useRef(0);
  useLayoutEffect(
    () =>
      dusk.add((d) => {
        duskAmt.current = d;
        /* Base was 0.15 — effectively unlit until dusk, which is why the
           interior read as a pale VOID in every daylight beat: you looked
           through the glass at unlit boxes and saw fog. A real room is
           visible through glass in daylight too, just outshone by it. */
        if (lamp.current) lamp.current.intensity = 0.55 + d * 2.4;
        if (pendant.current) pendant.current.emissiveIntensity = 0.35 + d * 1.6;
        if (hearth.current) hearth.current.intensity = 0.9 + d * 1.9;
      }),
    [dusk]
  );

  /* The firebox breathes. One sine against one cosine at incommensurate
     rates never repeats on a loop the eye can catch, and it is two multiplies
     a frame. Under prefers-reduced-motion the canvas renders a single frame
     and freezes — so the CONSTRUCTOR values below are the frozen look, and
     they are set to the middle of the flicker range rather than to zero. */
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const f = 0.78 + Math.sin(t * 7.3) * 0.14 + Math.cos(t * 4.1) * 0.08;
    if (firebox.current) firebox.current.emissiveIntensity = 2.1 * f;
    if (hearth.current) hearth.current.intensity = (0.9 + duskAmt.current * 1.9) * f;
  });

  /* Interior floor: real oak, not the pale slab. The structural slab reads
     #c6ccc4 concrete-grey, and through glass that is indistinguishable from
     the fog behind the house — the single biggest reason the home looked
     unbuilt. makeWoodGrain already exists for the deck; the interior gets the
     same grain at a tighter repeat so the boards read narrower indoors. */
  const floorTex = useMemo(() => {
    const t = sharpen(makeWoodGrain());
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(3.2, 2.6);
    return t;
  }, []);

  const mullion = NORDIC_MATERIALS.blackAluminium.color;
  const cedar = [NORDIC_MATERIALS.cedar.color, "#9b7350", "#b0855e"];

  return (
    <group>
      {/* floor slab on screw piles — the piece of the home that touches the
          ground, so it is what HOUSE_SHELL_FOOTPRINT is measured from */}
      <mesh castShadow receiveShadow position={[0, HOUSE_SHELL.slab.y, 0]}>
        <boxGeometry args={[HOUSE_SHELL.slab.width, HOUSE_SHELL.slab.thickness, HOUSE_SHELL.slab.depth]} />
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
            <boxGeometry args={[0.16, SLOPE_L + 0.5, HOUSE_SHELL.roofDepth]} />
            <meshStandardMaterial
              color={NORDIC_MATERIALS.standingSeam.color}
              roughness={NORDIC_MATERIALS.standingSeam.roughness}
              metalness={NORDIC_MATERIALS.standingSeam.metalness}
              flatShading
            />
          </mesh>
        ) : (
          <group key={s} position={[(s * EAVE) / 2, (RIDGE_H + EAVE_H) / 2, 0]} rotation={[0, 0, s * ROOF_A]}>
            {/* solid roof fore and aft of the glazed run */}
            {([[0, 2.53, 1.84], [0, -2.53, 1.84]] as [number, number, number][]).map(([x, z, d], i) => (
              <mesh key={i} castShadow receiveShadow position={[x, 0, z]}>
                <boxGeometry args={[0.16, SLOPE_L + 0.5, d]} />
                <meshStandardMaterial
                  color={NORDIC_MATERIALS.standingSeam.color}
                  roughness={NORDIC_MATERIALS.standingSeam.roughness}
                  metalness={NORDIC_MATERIALS.standingSeam.metalness}
                  flatShading
                />
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

      {/* ---------------------------- THE INTERIOR ----------------------
          This used to be two pale boxes on a concrete slab, and through
          transmissive glass that read as an empty white void — the house
          looked like an unbuilt shell at the exact beat where the camera
          arrives at it. Everything below is seen ONLY through glass from
          outside, so it is deliberately cheap: flat-shaded boxes, no
          subdivision, one texture shared with the deck. What sells a room
          from the outside is not detail, it is TONAL SEPARATION — a warm
          floor against cool glass, a dark hearth, and one light source. */}

      {/* oak floor, laid on top of the structural slab (slab top = y 0.38) */}
      <mesh position={[0, 0.392, 0]} receiveShadow>
        <boxGeometry args={[7.1, 0.03, 6.0]} />
        <meshStandardMaterial map={floorTex} color={NORDIC_MATERIALS.ash.color} roughness={NORDIC_MATERIALS.ash.roughness} />
      </mesh>
      {/* a wool rug: the one soft, light thing in the room, and the reason
          the floor does not read as one flat plank field through the glass */}
      <mesh position={[-0.7, 0.412, 0.5]} receiveShadow>
        <boxGeometry args={[3.0, 0.012, 2.2]} />
        <meshStandardMaterial color={NORDIC_MATERIALS.wool.color} roughness={NORDIC_MATERIALS.wool.roughness} />
      </mesh>

      {/* bed, with linen and a headboard rather than a single beige slab */}
      <mesh position={[-1.9, 0.52, -1.7]} castShadow receiveShadow>
        <boxGeometry args={[1.9, 0.24, 1.55]} />
        <meshStandardMaterial color="#6a5442" roughness={0.9} flatShading />
      </mesh>
      <mesh position={[-1.9, 0.70, -1.7]} castShadow>
        <boxGeometry args={[1.85, 0.16, 1.5]} />
        <meshStandardMaterial color="#eae3d3" roughness={0.96} />
      </mesh>
      <mesh position={[-1.9, 0.80, -2.3]} castShadow>
        <boxGeometry args={[1.85, 0.14, 0.34]} />
        <meshStandardMaterial color="#f4efe4" roughness={0.97} />
      </mesh>
      {/* headboard: kept low and pulled in, because at its old top (y 1.28)
          the roof is only 2.85 m from the centreline and it stood at 3.0 */}
      <mesh position={[-2.79, 0.72, -1.7]} castShadow>
        <boxGeometry args={[0.1, 0.66, 1.6]} />
        <meshStandardMaterial color="#4c4038" roughness={0.9} flatShading />
      </mesh>

      {/* sofa, turned to face the front glass — furniture that faces the view
          is what makes a room look INHABITED rather than furnished */}
      <mesh position={[-0.7, 0.55, 1.55]} castShadow receiveShadow>
        <boxGeometry args={[2.2, 0.3, 0.85]} />
        <meshStandardMaterial color="#5d6b62" roughness={0.94} flatShading />
      </mesh>
      <mesh position={[-0.7, 0.82, 1.9]} castShadow>
        <boxGeometry args={[2.2, 0.55, 0.16]} />
        <meshStandardMaterial color="#68776d" roughness={0.94} flatShading />
      </mesh>

      {/* kitchen run along the east wall, counter + a dark splashback */}
      {/* kitchen run: pulled in from x 2.7 to 2.38. The counter top sits at
          y 1.30, where the roof plane is 2.83 m out — the old 0.74-wide top
          centred at 2.7 reached 3.07 and pushed through the east slope. */}
      <mesh position={[2.38, 0.83, 0.6]} castShadow receiveShadow>
        <boxGeometry args={[0.7, 0.85, 2.6]} />
        <meshStandardMaterial color="#7d6f5d" roughness={0.85} flatShading />
      </mesh>
      <mesh position={[2.38, 1.27, 0.6]} castShadow>
        <boxGeometry args={[0.74, 0.05, 2.66]} />
        <meshStandardMaterial color="#2b302d" roughness={0.4} metalness={0.2} />
      </mesh>

      {/* sleeping loft over the north end, with a ladder. It reads as a dark
          horizontal band high in the gable, which is what gives the interior
          a sense of VOLUME through the glass instead of one flat floor. */}
      {/* Widths come from the gable taper, NOT from eye. Both of these were
          4.4 m — the loft deck reached 0.22 m and its rail 0.42 m THROUGH the
          roof planes on each side, which is the stray beam visible outside
          the house on the roof edge. spanAt() takes the top of each element,
          because that is the height where the A-frame is tightest. */}
      <mesh position={[0, 2.36, -1.95]} castShadow receiveShadow>
        <boxGeometry args={[spanAt(2.42), 0.12, 2.0]} />
        <meshStandardMaterial map={floorTex} color="#9d7b53" roughness={0.78} />
      </mesh>
      {/* THE VIBRATING LOFT, fixed — and it was never an animation.
          The rail sat at y 2.60 / z -0.98, which buried it 0.03 INSIDE the
          deck vertically and 0.06 inside it in z, and left its front face on
          z = -0.950, EXACTLY coplanar with the deck's front face. Two solids
          sharing a face is z-fighting: depth precision flips which one wins
          per pixel as the camera orbits, so the brown deck underneath reads
          as if it is buzzing. Identical failure to the glass bridge above.
          The rail now SITS ON the deck (top 2.420 + half its 0.42 height) and
          its face is pulled 20 mm proud, so nothing is ever coplanar. */}
      <mesh position={[0, 2.63, -1.00]} castShadow>
        <boxGeometry args={[spanAt(2.84), 0.42, 0.06]} />
        <meshStandardMaterial color={mullion} roughness={0.6} metalness={0.2} />
      </mesh>
      {/* Ladder rails: pulled clear of the deck's front face for the same
          reason — they used to land on z = -0.95 too. */}
      {[-0.42, 0.42].map((x) => (
        <mesh key={`ld${x}`} position={[x, 1.38, -0.90]} castShadow>
          <boxGeometry args={[0.07, 1.95, 0.07]} />
          <meshStandardMaterial color="#6a5442" roughness={0.85} />
        </mesh>
      ))}
      {[0.72, 1.14, 1.56, 1.98].map((y) => (
        <mesh key={`lr${y}`} position={[0, y, -0.90]} castShadow>
          <boxGeometry args={[0.84, 0.05, 0.05]} />
          <meshStandardMaterial color="#6a5442" roughness={0.85} />
        </mesh>
      ))}

      {/* wood stove + a real chimney: double-wall flue, storm collar, rain cap,
          topping out above the ridge (not a bare rod poking the roof) */}
      <mesh position={[0.9, 0.78, -2.2]} castShadow>
        <cylinderGeometry args={[0.24, 0.26, 0.85, 10]} />
        <meshStandardMaterial color="#20211f" roughness={0.6} metalness={0.3} flatShading />
      </mesh>
      {/* THE FIRE. The brief promises a wood stove in every home and the
          chimney has been venting invisible smoke this whole time. A glowing
          firebox door facing the front glass is the warmest pixel in the
          frame at dusk, and the thing that says someone lives here. */}
      <mesh position={[0.9, 0.72, -1.945]}>
        <planeGeometry args={[0.26, 0.2]} />
        <meshStandardMaterial
          ref={firebox}
          color="#ff9a3c"
          emissive="#ff7a1a"
          emissiveIntensity={2.1}
          toneMapped={false}
        />
      </mesh>
      <pointLight
        ref={hearth}
        position={[0.9, 0.8, -1.8]}
        color="#ff8c3a"
        intensity={0.9}
        distance={6.5}
        decay={2}
      />
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
  h = DECK_RAIL.height,
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

/** A plumb newel post, sized so the cap rail of a GlassRailRun lands on top
 *  of it rather than crossing it.
 *
 *  Every free end and every corner gets one. A run that simply stops leaves a
 *  pane hanging in mid-air, and two runs meeting at a right angle each stop on
 *  the corner POINT, which leaves a post-section notch of daylight exactly at
 *  the corner. One component so all of them are identical — mismatched posts
 *  are what makes a balustrade read as modelled rather than built.
 *
 *  `base` is the walking surface, `h` the run's rail height; GlassRailRun puts
 *  its cap centre at base + h + 0.03, so the post spans base → that. */
function Newel({
  at,
  base,
  h = DECK_RAIL.height,
}: {
  at: [number, number];
  base: number;
  h?: number;
}) {
  const top = base + h + 0.03;
  return (
    <mesh castShadow position={[at[0], (base + top) / 2, at[1]]}>
      <boxGeometry args={[0.07, top - base, 0.07]} />
      <meshStandardMaterial color="#5d6663" roughness={0.45} metalness={0.55} />
    </mesh>
  );
}

/** A balustrade that DESCENDS with a flight of steps.
 *
 *  WHY v1 LEFT GAPS, because the failure is instructive and easy to repeat.
 *  v1 built the pane, cap and channel as boxes inside ONE group and rotated
 *  the whole group about its centre. Rotating a box rakes its END FACES too —
 *  they come out perpendicular to the slope rather than plumb. On this flight
 *  (0.98 m run, 0.355 m fall) that swung the top of each end 0.29 m along the
 *  run, so the handrail started a third of a metre inboard of its newel and
 *  visibly floated. A real stair balustrade is a PARALLELOGRAM: the top and
 *  bottom edges follow the rake, and the two end edges stay PLUMB.
 *
 *  So nothing here is a rotated box spanning the whole run:
 *   · the pane is explicit geometry — four corners, plumb ends, built from the
 *     two newel lines, so it cannot drift out of contact with them;
 *   · the cap and the channel are boxes that span NEWEL-TOP TO NEWEL-TOP (and
 *     nosing to nosing), each rotated only to align its long axis, and each
 *     over-run slightly at both ends so it dies INTO the newel instead of
 *     stopping on its centreline and leaving a hairline;
 *   · the newels are plumb, and sized so the cap lands on top of them.
 *
 *  `drop` is how far the bottom newel continues past the rail to reach the
 *  ground, since the terrain falls away under the last tread.
 */
function StepRail({
  from,
  to,
  h = 0.9,
  mat,
  drop = 0.55,
}: {
  /** the top of the flight: x, the walking surface's y, z */
  from: [number, number, number];
  /** the bottom of the flight, same convention */
  to: [number, number, number];
  h?: number;
  mat: THREE.Material;
  drop?: number;
}) {
  const POST = 0.07; // newel section
  const CAP_T = 0.06; // cap rail thickness
  const CHAN = 0.07; // base channel thickness

  // The two plumb lines the whole assembly hangs off.
  const topA: [number, number, number] = [from[0], from[1] + h, from[2]];
  const topB: [number, number, number] = [to[0], to[1] + h, to[2]];

  /** A box spanning two points, rotated so its LENGTH lies along the segment.
   *  Only ever a rake here (both ends share x), but solved generally so a
   *  flight that also turns would still be right. `over` extends the piece
   *  equally at both ends so it buries into whatever terminates it. */
  const spanBox = (
    a: [number, number, number],
    b: [number, number, number],
    w: number,
    t: number,
    over: number,
  ) => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const dz = b[2] - a[2];
    const run = Math.hypot(dx, dz);
    const len = Math.hypot(run, dy) + over * 2;
    // yaw puts local +Z along the plan direction; rake tips it to the fall
    const yaw = Math.atan2(dx, dz);
    const rake = Math.atan2(-dy, run);
    return {
      pos: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2] as [number, number, number],
      rot: [rake, yaw, 0] as [number, number, number],
      args: [w, t, len] as [number, number, number],
    };
  };

  const cap = spanBox(topA, topB, POST, CAP_T, POST * 0.5);
  /* The channel is lifted by half its own thickness so its TOP face lands on
     the walking surface + CHAN — which is exactly where the pane's bottom edge
     starts. Centred on the surface instead, it would sink half into the tread
     and leave a 3.5cm slot of daylight under the glass. */
  const channel = spanBox(
    [from[0], from[1] + CHAN / 2, from[2]],
    [to[0], to[1] + CHAN / 2, to[2]],
    0.09,
    CHAN,
    POST * 0.5,
  );

  /* The pane: four explicit corners. Bottom edge rides just above the channel,
     top edge just under the cap, and BOTH end edges are plumb because each is
     simply two points sharing an (x, z). */
  const paneGeo = useMemo(() => {
    const yBot = (p: [number, number, number]) => p[1] + CHAN;
    const yTop = (p: [number, number, number]) => p[1] + h - CAP_T * 0.5;
    const v = new Float32Array([
      // triangle 1
      from[0], yBot(from), from[2],
      to[0], yBot(to), to[2],
      to[0], yTop(to), to[2],
      // triangle 2
      from[0], yBot(from), from[2],
      to[0], yTop(to), to[2],
      from[0], yTop(from), from[2],
    ]);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(v, 3));
    g.computeVertexNormals();
    return g;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from[0], from[1], from[2], to[0], to[1], to[2], h]);

  return (
    <group>
      <mesh geometry={paneGeo} material={mat} renderOrder={RO_GLASS_RAIL} />
      <mesh castShadow position={cap.pos} rotation={cap.rot}>
        <boxGeometry args={cap.args} />
        <meshStandardMaterial color="#5d6663" roughness={0.4} metalness={0.6} />
      </mesh>
      <mesh castShadow position={channel.pos} rotation={channel.rot}>
        <boxGeometry args={channel.args} />
        <meshStandardMaterial color="#5d6663" roughness={0.45} metalness={0.55} />
      </mesh>
      {/* plumb newels. The top one stands on the deck and its top face meets
          the cap; the bottom one runs on past the last tread into the ground. */}
      <mesh castShadow position={[from[0], from[1] + h / 2, from[2]]}>
        <boxGeometry args={[POST, h, POST]} />
        <meshStandardMaterial color="#5d6663" roughness={0.45} metalness={0.55} />
      </mesh>
      <mesh castShadow position={[to[0], to[1] + (h - drop) / 2, to[2]]}>
        <boxGeometry args={[POST, h + drop, POST]} />
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
  /* SEVEN rows, not six. At six the deck stopped at z 5.815 while the front
     balustrade sat at 6.05 and the first tread began at 6.18 — so the rails
     floated 23cm off the edge and a 36cm band of meadow showed through the
     entry, which is the unnatural gap in the approach. The seventh row
     carries the deck to 6.285, the rails now stand ON it, and the top tread
     tucks under the nosing the way a real stair does.

     The row count, pitch and plank size live in DECK_PLANKS so that the
     rect masking this deck moves when the deck does. */
  for (let i = 0; i < DECK_PLANKS.rows; i++) {
    const z = DECK_PLANKS.firstZ + i * DECK_PLANKS.pitch;
    planks.push(
      <mesh key={i} castShadow receiveShadow position={[DECK_PLANKS.centerX, DECK_PLANKS.y, z]}>
        <boxGeometry args={[DECK_PLANKS.width, DECK_PLANKS.thickness, DECK_PLANKS.depth]} />
        <meshStandardMaterial map={grain} color={pieceTone(cedar[i % 3], i)} roughness={0.85} flatShading />
      </mesh>
    );
  }
  return (
    <group>
      {planks}
      {/* rim joist + skirt so the deck reads built, not floating lumber */}
      <mesh castShadow receiveShadow position={[DECK_PLANKS.centerX, 0.29, 4.43]}>
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
      {/* deepened from 2.85 to 3.11 and re-centred so the glass bay ends on
          the SAME line as the new seventh plank row (6.285). They used to
          stop 26cm apart, which put a notch in the deck edge right where the
          balustrade crosses from timber onto glass. */}
      <mesh
        material={glassFloor}
        position={[DECK_GLASS_BAY.centerX, DECK_PLANKS.y, DECK_GLASS_BAY.centerZ]}
        renderOrder={RO_GLASS_FLOOR}
      >
        <boxGeometry args={[DECK_GLASS_BAY.width, DECK_GLASS_BAY.thickness, DECK_GLASS_BAY.depth]} />
      </mesh>
      {/* Frame under glass. It is 10cm deeper than the pane it carries and
          shares its centre, so it ends 3.5cm past DECK_RECT — the module
          measures that overhang as DECK_BAY_FRAME_OVERHANG rather than
          letting it drift unwatched. */}
      <mesh castShadow position={[DECK_GLASS_BAY.centerX, DECK_GLASS_BAY.frameY, DECK_GLASS_BAY.centerZ]}>
        <boxGeometry
          args={[DECK_GLASS_BAY.frameWidth, DECK_GLASS_BAY.frameThickness, DECK_GLASS_BAY.frameDepth]}
        />
        <meshStandardMaterial color="#5d6663" roughness={0.5} metalness={0.5} />
      </mesh>
      {/* glass railings: front edge with a gap for the steps, west edge */}
      {/* Moved out to the new deck line at 6.285 (they sat at 6.05, which was
          23cm past the old edge — a balustrade standing on air).

          base is DECK_RECT.surfaceY, NOT the 0.5 default. The deck's walking
          surface is the plank centre plus half a plank, and GlassRailRun puts
          the bottom of its channel exactly on `base` — so the default left a
          1.5cm slot of daylight running under every pane on the deck. Reading
          it from the module is also what keeps the rails on the deck if the
          plank stack ever changes thickness. */}
      <GlassRailRun from={[DECK_RAIL.westX, DECK_RAIL.frontZ]} to={[DECK_RAIL.gapX0, DECK_RAIL.frontZ]} base={DECK_RECT.surfaceY} mat={glassRail} />
      <GlassRailRun from={[DECK_RAIL.gapX1, DECK_RAIL.frontZ]} to={[DECK_RAIL.eastX, DECK_RAIL.frontZ]} base={DECK_RECT.surfaceY} mat={glassRail} />
      <GlassRailRun from={[DECK_RAIL.westX, DECK_RAIL.backZ]} to={[DECK_RAIL.westX, DECK_RAIL.frontZ]} base={DECK_RECT.surfaceY} mat={glassRail} />
      {/* THE EAST EDGE WAS COMPLETELY UNGUARDED — a 3m open drop along the
          glass bay from the house to the front corner, with nothing on it. The
          two runs below close it, leaving a 1m opening at z 4.15–5.15 where
          the walkway to the hot tub leaves, which is the one place a guard
          should stop. */}
      <GlassRailRun from={[DECK_RAIL.eastX, DECK_RAIL.backZ]} to={[DECK_RAIL.eastX, DECK_RAIL.walkGapZ0]} base={DECK_RECT.surfaceY} mat={glassRail} />
      <GlassRailRun from={[DECK_RAIL.eastX, DECK_RAIL.walkGapZ1]} to={[DECK_RAIL.eastX, DECK_RAIL.frontZ]} base={DECK_RECT.surfaceY} mat={glassRail} />
      {/* A post at every corner, every free end, and both sides of the walkway
          opening. Anything less leaves a pane hanging or a corner notched. */}
      {(
        [
          [DECK_RAIL.westX, DECK_RAIL.frontZ],
          [DECK_RAIL.westX, DECK_RAIL.backZ],
          [DECK_RAIL.eastX, DECK_RAIL.frontZ],
          [DECK_RAIL.eastX, DECK_RAIL.backZ],
          [DECK_RAIL.eastX, DECK_RAIL.walkGapZ0],
          [DECK_RAIL.eastX, DECK_RAIL.walkGapZ1],
        ] as [number, number][]
      ).map((at, i) => (
        <Newel key={`dn${i}`} at={at} base={DECK_RECT.surfaceY} />
      ))}
      {/* Steps to the meadow. DECK_STEPS carries these; read its comment before
          changing anything here — this flight and SceneDetail's EntranceSteps
          describe the same entrance with different numbers, and that
          divergence is recorded rather than silently reconciled. */}
      {Array.from({ length: DECK_STEPS.count }, (_, i) => (
        <mesh
          key={i}
          castShadow
          receiveShadow
          position={[
            DECK_STEPS.originX,
            DECK_STEPS.topY - i * DECK_STEPS.rise,
            DECK_STEPS.firstZ + i * DECK_STEPS.treadDepth,
          ]}
        >
          <boxGeometry args={[DECK_STEPS.width, DECK_STEPS.thickness, DECK_STEPS.treadDepth]} />
          <meshStandardMaterial map={grain} color={pieceTone(cedar[i % 3], i + 11)} roughness={0.85} flatShading />
        </mesh>
      ))}
      {/* Balustrade down BOTH sides of the flight. The entry was the one
          opening in an otherwise continuous guard: the deck rail stopped
          either side of the steps and nothing carried down, so the stair
          read as a plank ramp rather than as the way into the house. The
          runs rake from the deck nosing (y 0.485) to the last tread (0.13)
          and land exactly where the deck rails terminate, so the guard is
          continuous the whole way round. */}
      {/* STRINGERS — the piece whose absence was being read as "gaps in the
          railing". The balustrade correctly follows the NOSING line (the line
          through the front edge of each tread), but on any stair that line
          runs above the tread surfaces behind it, so the flanks of the flight
          are open triangles and you see straight through to the meadow. Every
          real stair closes them with a stringer: the raked board the treads
          land on. Set just outside the 2.1m tread width and just inside the
          newels, so tread edge, stringer and post stack without a seam. */}
      {DECK_STEPS.stringerX.map((x, i) => (
        <group key={`sg${i}`} position={[x, DECK_STEPS.stringerGroupY, DECK_STEPS.stringerGroupZ]} rotation={[DECK_STEPS_RAKE, 0, 0]}>
          <mesh castShadow receiveShadow position={[0, -DECK_STEPS.stringerDrop, 0]}>
            <boxGeometry args={[DECK_STEPS.stringerWidth, DECK_STEPS.stringerHeight, DECK_STEPS.stringerLength]} />
            <meshStandardMaterial map={grain} color={pieceTone("#8a6a4a", i + 21)} roughness={0.88} flatShading />
          </mesh>
        </group>
      ))}
      {/* The flanking rails land on the same two x lines the front rail run
          breaks at, so the guard is continuous round the opening. */}
      <StepRail
        from={[DECK_RAIL.gapX0, DECK_RECT.surfaceY, DECK_RAIL.frontZ]}
        to={[DECK_RAIL.gapX0, DECK_STEPS.footY, DECK_STEPS.footZ]}
        mat={glassRail}
      />
      <StepRail
        from={[DECK_RAIL.gapX1, DECK_RECT.surfaceY, DECK_RAIL.frontZ]}
        to={[DECK_RAIL.gapX1, DECK_STEPS.footY, DECK_STEPS.footZ]}
        mat={glassRail}
      />
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
const WALK_FROM: [number, number] = [WALKWAY_MESH.fromX, WALKWAY_MESH.fromZ];
const WALK_TO: [number, number] = [WALKWAY_MESH.toX, WALKWAY_MESH.toZ];
const WALK_PAD = WALKWAY_MESH.pad;

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
  const half = WALKWAY_MESH.halfWidth;
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
      <group position={[cx, WALKWAY_MESH.glassY, cz]} rotation={[0, ang, 0]}>
        {/* Glass underside sits at 0.385; the frame top used to land on
            exactly 0.385 — coplanar, and the pair z-fought every time the
            camera came near. Frame dropped to -0.085 leaving 5cm of air. */}
        <mesh material={glassFloor} position={[0, 0, 0]} renderOrder={RO_GLASS_FLOOR}>
          <boxGeometry args={[half * 2, WALKWAY_MESH.glassThickness, len + WALK_PAD]} />
        </mesh>
        <mesh castShadow position={[0, -WALKWAY_MESH.frameDrop, 0]}>
          <boxGeometry args={[WALKWAY_MESH.frameWidth, WALKWAY_MESH.frameThickness, len + WALK_PAD + 0.1]} />
          <meshStandardMaterial color="#5d6663" roughness={0.5} metalness={0.5} />
        </mesh>
      </group>
      {/* stone piers grounding the walkway */}
      {(WALKWAY_MESH.piers as readonly (readonly [number, number])[]).map(([x, z], i) => (
        <mesh key={`wp${i}`} castShadow position={[x, 0.18, z]}>
          <cylinderGeometry args={[0.11, 0.15, 0.4, 8]} />
          <meshStandardMaterial color="#848c85" roughness={0.95} flatShading />
        </mesh>
      ))}
      <GlassRailRun from={railA[0]} to={railA[1]} h={WALKWAY_MESH.railHeight} base={WALKWAY_MESH.railBase} mat={glassRail} />
      <GlassRailRun from={railB[0]} to={railB[1]} h={WALKWAY_MESH.railHeight} base={WALKWAY_MESH.railBase} mat={glassRail} />
      {/* A post at BOTH ends of both runs. Only the far ends were posted, so
          each rail began in mid-air where it left the deck — the same
          unfinished-end defect the deck rails had, just less obvious because
          the deck edge is behind it. Same Newel as everywhere else, so the
          walkway's posts match the deck's rather than being their own size. */}
      {[railA[0], railA[1], railB[0], railB[1]].map((at, i) => (
        <Newel key={`nw${i}`} at={at} base={WALKWAY_MESH.railBase} h={WALKWAY_MESH.railHeight} />
      ))}
    </group>
  );
}

function HotTub({ position, dusk, frozen = false }: { position: [number, number, number]; dusk: Dusk; frozen?: boolean }) {
  const water = useRef<THREE.MeshStandardMaterial>(null);
  const waterNormal = useMemo(() => makeWaterNormal(), []);
  const mottle = useMemo(() => makeStoneMottle(), []);
  useLayoutEffect(
    () =>
      dusk.add((d) => {
        if (water.current) water.current.emissiveIntensity = 0.1 + d * 0.26;
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
      {/* stone pad */}
      <mesh receiveShadow castShadow position={[0, 0.1, 0]}>
        <cylinderGeometry args={[1.42, 1.56, 0.22, 12]} />
        <meshStandardMaterial map={mottle} color="#8d968f" roughness={0.95} flatShading />
      </mesh>
      <mesh castShadow receiveShadow position={[0, 0.62, 0]}>
        <cylinderGeometry args={[0.78, 0.72, 0.84, 14, 1, true]} />
        <meshStandardMaterial color="#8d7c66" roughness={0.92} flatShading side={THREE.DoubleSide} />
      </mesh>
      <mesh castShadow position={[0, 1.05, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.76, 0.05, 8, 14]} />
        <meshStandardMaterial color="#6f6152" roughness={0.9} flatShading />
      </mesh>
      <mesh position={[0, 1.0, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.72, 48]} />
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
      <mesh castShadow position={[0.95, 0.75, -0.12]}>
        <cylinderGeometry args={[0.14, 0.14, 0.7, 10]} />
        <meshStandardMaterial color="#565c58" roughness={0.6} metalness={0.5} flatShading />
      </mesh>
      <mesh castShadow position={[0.95, 1.45, -0.12]}>
        <cylinderGeometry args={[0.045, 0.045, 0.8, 8]} />
        <meshStandardMaterial color="#9aa19c" roughness={0.5} metalness={0.6} />
      </mesh>
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
    /* FIREPIT_HEARTH, not a literal: the mask clears a disc around
       FIREPIT_CENTER (-4.7, 6.5) and the hearth is built 0.32 m away at
       (-4.6, 6.2). That gap is documented in the module — neither number was
       changed, because one moves visible fire and the other rebakes the
       atlas — and the spec asserts the ring still sits inside the clearing. */
    useMemo(() => [{ pos: [FIREPIT_HEARTH.x, 0, FIREPIT_HEARTH.z] as [number, number, number], rotY: 0.5 }], [])
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
      {Array.from({ length: FIREPIT_HEARTH.ringStones }).map((_, i) => {
        const a = (i / FIREPIT_HEARTH.ringStones) * Math.PI * 2;
        return (
          <mesh
            key={i}
            castShadow
            position={[
              FIREPIT_HEARTH.x + Math.cos(a) * FIREPIT_HEARTH.ringRadius,
              0.12,
              FIREPIT_HEARTH.z + Math.sin(a) * FIREPIT_HEARTH.ringRadius,
            ]}
            rotation={[0, a, 0]}
          >
            <boxGeometry args={[0.34, 0.24, 0.22]} />
            <meshStandardMaterial map={makeStoneMottle()} color="#7f8781" roughness={0.95} flatShading />
          </mesh>
        );
      })}
      <pointLight ref={light} position={[FIREPIT_HEARTH.x, FIREPIT_HEARTH.lightY, FIREPIT_HEARTH.z]} color="#ffb46b" intensity={1.2} distance={7} decay={2} />
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

/** Stepping stones tracing the walked route: trailhead -> crest -> steps.
 *  The slabs stand on PATH itself — the route the meadow thins toward — so a
 *  stone can never end up beside the mown line instead of on it. */
const PATH_STONES: readonly (readonly [number, number])[] = PATH;

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

/** Safe-tier forest: two instanced draw calls, authored from the same tree
 * placements as the rich GLTF grove. It preserves the alpine silhouette
 * without cloning dozens of multi-material model graphs during the story. */
function LiteForest() {
  const crowns = useRef<THREE.InstancedMesh>(null);
  const trunks = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const placements = useMemo(
    () => [...PATCHES.slice(0, 12), ...TEAL_PINES.slice(0, 9)],
    [],
  );

  useLayoutEffect(() => {
    placements.forEach((placement, index) => {
      const scale = placement.scale ?? 1;
      const height = (index < 12 ? 5.2 : 4.3) * scale;
      const y = terrainH(placement.pos[0], placement.pos[2]);

      dummy.position.set(placement.pos[0], y + height * 0.52, placement.pos[2]);
      dummy.rotation.set(0, placement.rotY ?? 0, 0);
      dummy.scale.set(1.25 * scale, height, 1.25 * scale);
      dummy.updateMatrix();
      crowns.current?.setMatrixAt(index, dummy.matrix);

      dummy.position.set(placement.pos[0], y + height * 0.14, placement.pos[2]);
      dummy.scale.set(0.16 * scale, height * 0.28, 0.16 * scale);
      dummy.updateMatrix();
      trunks.current?.setMatrixAt(index, dummy.matrix);
    });
    if (crowns.current) crowns.current.instanceMatrix.needsUpdate = true;
    if (trunks.current) trunks.current.instanceMatrix.needsUpdate = true;
  }, [dummy, placements]);

  return (
    <group>
      <instancedMesh ref={crowns} args={[undefined, undefined, placements.length]} receiveShadow>
        <coneGeometry args={[1, 1, 6]} />
        <meshStandardMaterial color="#356247" roughness={1} flatShading />
      </instancedMesh>
      <instancedMesh ref={trunks} args={[undefined, undefined, placements.length]}>
        <cylinderGeometry args={[1, 1.18, 1, 6]} />
        <meshStandardMaterial color="#5d4030" roughness={1} flatShading />
      </instancedMesh>
    </group>
  );
}

function Forest({ frozen, densityScale = 1 }: { frozen: boolean; densityScale?: number }) {
  const pines = useGLTF(MODELS.pines);
  const teal = useGLTF(MODELS.pineTeal);
  const rocks = useGLTF(MODELS.rocks);
  const sway = useRef<THREE.Group[]>([]);
  const patchPlacements = useMemo(
    () => PATCHES.slice(0, Math.max(1, Math.ceil(PATCHES.length * densityScale))),
    [densityScale],
  );
  const tealPlacements = useMemo(
    () => TEAL_PINES.slice(0, Math.max(1, Math.ceil(TEAL_PINES.length * densityScale))),
    [densityScale],
  );
  const rockPlacements = useMemo(
    () => ROCKS.slice(0, Math.max(1, Math.ceil(ROCKS.length * densityScale))),
    [densityScale],
  );

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

  const patchClones = useNormalizedClones(pines.scene, 5.2, patchPlacements);
  const tealClones = useNormalizedClones(teal.scene, 4.3, tealPlacements);
  const rockClones = useNormalizedClones(rocks.scene, 1.4, rockPlacements);

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
            if (el) sway.current[patchClones.length + i] = el;
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

/* ---------------------------- hotspots: REMOVED ----------------------
   Three <Html> markers used to float over the glass gable, the solar array
   and the hot tub — a teal dot in a pale ring, drawn on a DOM layer above
   the canvas. They were removed on request: because they are screen-space
   HTML rather than scene geometry they never scaled with distance, so at
   every camera beat they sat on the composition at a fixed 20px like
   interface stuck to a landscape, and they reappeared at intervals through
   the whole scroll.

   WHAT WENT WITH THEM, so it is not silently lost: each carried a one-line
   published spec — triple-glazed south face for passive gain in zone 7A,
   the 6.4 kW array with the honest note that December needs the wood stove,
   and the wood-fired cedar tub drawing no grid power. None of those claims
   are orphaned; all three are stated on /overview and priced on /budget,
   which is where a reader can actually act on them.
------------------------------------------------------------------- */

/* ------------------------------- rig -------------------------------- */

const CAMERA_SETTLE_EPSILON = 0.0015;

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

    /* Demand rendering must still let the damped camera reach its target.
       Each active frame authorizes exactly one successor; convergence stops
       the chain, so an idle landing submits no frames. */
    const cameraSettled =
      Math.abs(r.smooth - progressRef.current) <= CAMERA_SETTLE_EPSILON &&
      Math.abs(r.mx - state.pointer.x) <= CAMERA_SETTLE_EPSILON &&
      Math.abs(r.my - state.pointer.y) <= CAMERA_SETTLE_EPSILON &&
      intro >= 1 - CAMERA_SETTLE_EPSILON;
    const proofWindow = window as typeof window & { __AURA_CAMERA_PROOF_ACTIVE__?: boolean };
    if (proofWindow.__AURA_CAMERA_PROOF_ACTIVE__) {
      window.dispatchEvent(new CustomEvent("aura:camera-progress", {
        detail: {
          current: r.smooth,
          target: progressRef.current,
          pointerError: Math.max(Math.abs(r.mx - state.pointer.x), Math.abs(r.my - state.pointer.y)),
          intro,
          settled: cameraSettled,
        },
      }));
    }
    cameraSettled ? undefined : state.invalidate();
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
  /* Always mounted, faded by opacity: the old `amount < 0.02 → null` meant
     the points program compiled on the FIRST night toggle instead of behind
     the loader. 700 transparent points at opacity 0 cost nothing per frame;
     a first-interaction compile hitch costs the moment the founder shows
     someone the night sky. (NW01 tracks the remaining night-switch stall.) */
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
  shadowMapSize,
  shadows,
  night = 0,
}: {
  progressRef: React.MutableRefObject<number>;
  reduced: boolean;
  dusk: Dusk;
  shadowMapSize: 1024 | 2048;
  shadows: boolean;
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
    if (hemi.current) hemi.current.intensity = (0.5 - d * 0.18) * (1 - night * 0.72);
    const fog = scene.fog as THREE.Fog | null;
    if (fog) {
      _c.lerpColors(cools.fogC, warms.fogC, d);
      _c.lerp(nights.fogC, night);
      fog.color.copy(_c);
    }
  });

  return (
    <>
      <hemisphereLight ref={hemi} args={["#eef7ff", "#94ad8e", 0.5]} />
      <ambientLight intensity={0.14} />
      <directionalLight
        ref={sun}
        castShadow={shadows}
        position={[27, 24, 19.5]}
        color="#fff3dd"
        intensity={2.6}
        shadow-mapSize={[shadowMapSize, shadowMapSize]}
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
      {/* Fill, not a second key. At 0.5 it was bright enough to light tree
          canopies from the opposite side to the one casting the shadows,
          which is the contradiction a viewer reads as "wrong" without being
          able to name it. */}
      <directionalLight position={[-14, 9, -16]} color="#d8ece6" intensity={0.16} />
    </>
  );
}

/* ------------------------------ scene ------------------------------- */

export default function Scene({
  progressRef,
  reduced,
  quality,
  stage,
  lowPower,
  releaseMeadowPromotion,
  night = false,
  onMeadowReady,
}: {
  progressRef: React.MutableRefObject<number>;
  reduced: boolean;
  quality: SceneQuality;
  stage: OpeningSceneStage;
  lowPower: boolean;
  releaseMeadowPromotion: boolean;
  night?: boolean;
  onMeadowReady?: () => void;
}) {
  const dusk = useDuskRegistry();
  const richMaterials = quality.tier === "full";
  const archGlass = useArchGlass(richMaterials);
  const glassFloor = useGlassFloor(richMaterials);
  const glassRoof = useGlassRoof(richMaterials);
  const glassRail = useGlassRail(richMaterials);
  const includeSite = stage !== "core";
  const includeForest = stage === "forest" || stage === "atmosphere" || stage === "meadow";
  const includeAtmosphere = stage === "atmosphere" || stage === "meadow";
  const includeMeadow = stage === "meadow";

  /* Texture pass: every procedural detail texture filters at the GPU's max
     anisotropy (16 on the target hardware). Runs during Scene's own render,
     BEFORE any child builds its textures, so the value is baked in at
     creation; the setter also retro-upgrades any texture that got there
     first. Grazing-angle sharpness on the deck, steps, and stone path for
     what modern GPUs charge for it — effectively nothing. */
  const { gl } = useThree();
  useMemo(() => setProceduralAnisotropy(gl.capabilities.getMaxAnisotropy()), [gl]);

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
      {quality.softShadows ? <SoftShadows size={14} samples={10} focus={0.4} /> : null}
      <LightArc
        progressRef={progressRef}
        reduced={reduced}
        dusk={dusk}
        night={nightAmt}
        shadowMapSize={quality.shadowMapSize}
        shadows={quality.softShadows}
      />

      {includeForest && richMaterials ? (
        <Environment resolution={quality.environmentResolution} frames={1}>
          <mesh scale={90}>
            <sphereGeometry args={[1, 16, 16]} />
            <meshBasicMaterial color="#dcebe2" side={THREE.BackSide} />
          </mesh>
          <Lightformer intensity={3} position={[8, 10, 6]} scale={[8, 6, 1]} color="#fff2d8" />
          <Lightformer intensity={1.2} position={[-8, 6, -6]} scale={[10, 4, 1]} color="#d9f4ea" />
        </Environment>
      ) : null}

      {/* The first painted frame is deliberately architectural. Site and
          atmosphere layers join only after the prior stage has drawn. */}
      {includeAtmosphere ? <StarField amount={nightAmt} /> : null}

      <Terrain segments={quality.tier === "full" ? 200 : 108} />
      {includeForest ? (
        richMaterials
          ? <Forest frozen={reduced} densityScale={1} />
          : <LiteForest />
      ) : null}
      {includeForest && richMaterials ? <Props dusk={dusk} /> : null}

      <AFrameHome dusk={dusk} archGlass={archGlass} glassRoof={glassRoof} />
      <Deck glassFloor={glassFloor} glassRail={glassRail} />
      <Walkway glassFloor={glassFloor} glassRail={glassRail} />

      {/* The additive detail layer — mountains, clouds, grass, steps,
          hammock, netting, wildlife, outdoor lighting, tub steam. */}
      {includeAtmosphere ? (
        <SceneDetail
          frozen={reduced}
          night={nightAmt}
          glassRail={glassRail}
          dusk={dusk}
          qualityScale={quality.grassScale}
          includeMeadow={includeMeadow}
          lite={!richMaterials}
          lowPower={lowPower}
          releaseMeadowPromotion={releaseMeadowPromotion}
          onMeadowReady={onMeadowReady}
        />
      ) : null}
      {includeSite ? <HotTub position={[TUB_CENTER.x, 0, TUB_CENTER.z]} dusk={dusk} frozen={reduced} /> : null}
      {includeForest && richMaterials ? <FirePit dusk={dusk} /> : null}
      {includeSite ? (
        <Bench
          position={[BENCH_CENTER.x, terrainH(BENCH_CENTER.x, BENCH_CENTER.z) - 0.14, BENCH_CENTER.z]}
          rotY={Math.PI * 1.12}
        />
      ) : null}
      {includeSite ? <PathStones /> : null}
      {includeSite ? <Trailhead /> : null}
      {includeSite ? <Fence /> : null}

      {/* string lights: a small canopy over the fire-pit lounge only —
          never crossing the glass facade or the deck framing */}
      {includeSite ? (
        <>
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
        </>
      ) : null}

      {includeSite ? <BeatProps progressRef={progressRef} reduced={reduced} /> : null}

      {/* chimney wisp; tub steam; fire pit smoke */}
      {/* THE CHIMNEY. Was size 0.62 / opacity 0.3 in the shared near-white
          tint, which against the pale #e3ede7 sky rendered as nothing — the
          house has had a lit stove and a dead chimney in every screenshot.
          Grey, denser, taller, and sheared harder by drift. Smoke is the
          cheapest possible signal that a home is occupied, and this plume is
          readable from the crest beat onward. 10 sprites, no new draw call
          class — sprites batch with the two plumes below. */}
      {includeAtmosphere ? (
        <Smoke
          origin={[0.9, 5.28, -2.2]}
          count={10}
          rate={0.13}
          size={0.85}
          rise={4.6}
          drift={0.55}
          opacity={0.6}
          color="#b3bbb8"
          frozen={reduced}
        />
      ) : null}
      {/* hot tub steam and fire-pit smoke: steam stays white (it IS vapour),
          the fire pit goes faintly grey so it separates from the tub */}
      {includeAtmosphere ? <Smoke origin={[5.9, 1.15, 5.4]} count={6} rate={0.2} size={0.44} rise={1.6} drift={0.16} opacity={0.42} frozen={reduced} /> : null}
      {includeAtmosphere ? <Smoke origin={[-4.6, 0.8, 6.2]} count={5} rate={0.13} size={0.5} rise={2.2} drift={0.24} opacity={0.3} color="#c8cdc9" frozen={reduced} /> : null}

      {includeAtmosphere ? <Mist frozen={reduced} /> : null}
      {includeAtmosphere ? <Birds frozen={reduced} /> : null}
      {/* size 2.2 / opacity 0.4 read as UFO orbs once dusk emissives pushed
          them over the bloom threshold — dust motes, not fireflies */}
      {includeAtmosphere ? <Sparkles count={quality.sparkleCount} scale={[28, 8, 28]} position={[0, 3.5, 2]} size={1.6} speed={reduced ? 0 : MEADOW_SPARKLE_SPEED} opacity={0.28} color="#fff6dd" /> : null}
      {includeAtmosphere ? <SunShafts progressRef={progressRef} night={nightAmt} reduced={reduced} /> : null}

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
      {quality.postprocessing ? (
        <EffectComposer multisampling={4}>
          <Bloom mipmapBlur intensity={0.25} luminanceThreshold={0.9} luminanceSmoothing={0.3} />
          <Vignette eskil={false} offset={0.16} darkness={0.26} />
          <Noise opacity={0.03} />
        </EffectComposer>
      ) : null}
    </>
  );
}
