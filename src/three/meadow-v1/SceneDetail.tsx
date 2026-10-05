"use client";

/* ---------------------------------------------------------------------
   THE DETAIL LAYER

   Everything here is ADDITIVE — it mounts alongside the original scene and
   removes nothing. It is also entirely procedural: no downloaded meshes, no
   textures fetched over the wire, nothing to license or credit beyond the
   techniques listed in docs/CREDITS.md. That is a performance decision as
   much as a legal one — the whole layer costs a few hundred KB of JS and no
   extra network round-trips, which matters on a page whose payload budget
   is a brand rule.

   Performance shape:
     · grass is ONE InstancedMesh with GPU wind (no per-frame CPU work)
     · flowers are ONE instanced draw sharing the meadow's wind (flora.ts)
     · mountains are three low-segment ridges, no shadows, fog-blended
     · clouds and steam are canvas-gradient sprites — no image downloads
     · the moose, hammock, netting and lights are primitive assemblies
     · every animated piece honours `frozen` (prefers-reduced-motion)
--------------------------------------------------------------------- */

import { useCallback, useEffect, useMemo, useRef, useLayoutEffect, useState } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { terrainH, makeWoodGrain, sharpen, type Dusk } from "./Scene";
/* The meadow's weather (wind direction, gust envelope, frozen instant) and
   the flower system live in flora.ts — one wind, shared by every planted
   thing, so grass and flowers can never sway to different clocks. */
import {
  WIND_DIR,
  FROZEN_T,
  gustEnvelope,
  flowerVisibilityAtDistance,
  buildFlowerField,
  makeFlowerMaterial,
  type FloraSample,
} from "./flora";
import type { MeadowPage } from "@/lib/three/meadow/contract";
/* The deck, walkway, steps, tub, fire pit, bench and walked route are ONE set
   of numbers shared by the meshes that draw them and the masks that keep
   grass out of them. Divergent copies of these rects are what put blades
   through the deck and, later, through the lower treads. */
import {
  BENCH_CENTER,
  DECK_RECT,
  ENTRANCE_FLIGHT,
  FIREPIT_CENTER,
  HOUSE_RECT,
  PATH,
  STEPS_RECT_TIGHT,
  STEPS_RECT_WIDE,
  STEPS_TREADS,
  TUB_CENTER,
  WALKWAY_SEGMENT,
  type GroundRect,
  type GroundSegment,
} from "@/lib/three/meadow/geometry";
import { useProgressiveMeadow } from "@/lib/three/meadow/runtime";
import { withBase } from "@/lib/basePath";

/* --------------------------- small helpers -------------------------- */

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** Deterministic pseudo-random — same layout every load, no Math.random. */
function rand(i: number, salt = 0) {
  const s = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function useGradientSprite(stops: [number, string][]) {
  return useMemo(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const ctx = c.getContext("2d")!;
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    for (const [o, col] of stops) g.addColorStop(o, col);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, [stops]);
}

/* ============================ MOUNTAINS =============================
   Banff-style. Three ridge bands at increasing distance, each progressively
   paler and lower-contrast so aerial perspective does the depth work rather
   than geometry. They sit outside the fog far-plane deliberately: the fog
   colour IS the haze, so the far ridge dissolves into the sky exactly the
   way a real range does at 40km.
=================================================================== */

/* ---- ridged fractal noise, the standard mountain primitive ----
   value noise + a ridge fold (1 - |n|), squared to sharpen, summed over
   octaves with each octave's amplitude modulated by the last. This is what
   gives real ranges their branching crests instead of rolling dunes. */
function hash2(x: number, y: number) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function vnoise(x: number, y: number) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  return a * (1 - ux) * (1 - uy) + b * ux * (1 - uy) + c * (1 - ux) * uy + d * ux * uy;
}
function ridged(x: number, y: number, octaves = 5) {
  let sum = 0;
  let freq = 1;
  let amp = 0.5;
  let prev = 1;
  for (let o = 0; o < octaves; o++) {
    let n = vnoise(x * freq, y * freq);
    n = 1 - Math.abs(n * 2 - 1);
    n *= n;
    n *= prev;
    prev = n;
    sum += n * amp;
    freq *= 2.07;
    amp *= 0.5;
  }
  return sum;
}

function ridgeGeometry(seed: number, width: number, height: number, segs: number, jag: number) {
  const g = new THREE.PlaneGeometry(width, height, segs, 1);
  const p = g.attributes.position as THREE.BufferAttribute;
  const half = segs / 2;
  for (let i = 0; i <= segs; i++) {
    // Sum of three octaves — the classic ridge silhouette: a few big peaks,
    // some shoulders, and fine sawtooth so it never reads as a sine wave.
    const t = i / segs;
    const a = Math.sin(t * 5.1 + seed * 2.3) * 0.55;
    const b = Math.sin(t * 11.7 + seed * 5.9) * 0.26;
    const c = Math.sin(t * 27.3 + seed * 1.4) * 0.11;
    const peak = Math.pow(clamp01((a + b + c) * 0.5 + 0.5), 1.35);
    const y = peak * height * jag;
    // top row only (vertices 0..segs are the top of a 1-segment plane)
    p.setY(i, y);
    p.setY(i + segs + 1, -height * 0.5);
    void half;
  }
  g.computeVertexNormals();
  return g;
}

/* ---- REAL RANGE: a displaced heightfield with a snow line ----
   The first attempt was a flat cutout with a sine silhouette — no relief, no
   shading, so it read as a grey smear and Matt was right to call it
   unrecognisable. This is actual terrain: a ridged-fractal heightfield lit by
   the scene's own sun, with snow assigned by ALTITUDE modulated by SLOPE, so
   steep faces stay rock and shoulders hold snow — which is the cue that makes
   a peak look like a peak. Aerial perspective is baked into the vertex
   colours (blend toward sky with distance) because fog can't reach out here. */
/* Builds one range band. Parameterised (quality pass, Aug 9) so the backdrop
   can carry TWO ranks — the mid range and a taller, hazier rank behind it —
   because a single silhouette line is the thing that reads "backdrop": real
   ranges layer, and the atmosphere between ranks is what gives the horizon
   its depth. `seed` decorrelates the ridgelines; `wash` is how far the whole
   rank has already dissolved toward sky.

   ===================================================================
   WASH-OUT FIX (Aug 10). The founder's report — "they dissolve into the sky
   as near-invisible pale ghosts, you cannot see a single peak, let alone
   snow" — was correct, and it was THREE bugs stacked, not a taste problem.
   Measured off an offline rasterisation of this exact geometry through this
   exact camera, tone map and page sky (sky luminance 236-240):

   1. THE AERIAL-PERSPECTIVE TERM WAS INVERTED. `depth = (z + D/2)/D` was
      documented "0 front .. 1 back". It is the other way round: the plane is
      rotateX(-90°), so local +z is the row NEAREST the camera. Height also
      grows with that term, so the nearest row is the tallest — it is the
      crest, and it is the entire visible silhouette; everything behind it is
      occluded by it. `wash + depth * 0.4` therefore put the MAXIMUM haze on
      the one part that touches the sky, and saved the crisp colour for the
      low back rows that are hidden. Aerial perspective ran backwards.
      Consequence: the mid rank's crest sat at luminance ~220 against a ~238
      sky, and the far rank's `min(0.92, 0.55 + 0.4)` clamped to 0.92 — 92%
      dissolved — so its whole visible span measured 216..219. Three levels.
      That is not a hazy mountain, it is a flat ghost, which is exactly what
      the screenshots show.
   2. THE SNOW WAS COMPUTED AND THEN ERASED. `alt = y / maxH` normalises
      against the single tallest vertex of a 900x110 field, so a 0.46-0.62
      line sat above ~97% of the mesh. Measured in screen pixels at the LAND
      beat, snow covered 0.8% of the visible range. There was no snow to see.
   3. THE BAKED SUN WAS NEARLY OVERHEAD AND CLAMPED. `(0.44, 0.78, 0.44)` is
      ~52° elevation, not the scene's 33° KEY, and `* 0.62 + 0.52` clamps at
      1 for anything facing within ~60° of it — so the whole multiplier
      spanned 0.88..1.12. A twelve-percent range is not shading; it is why
      the range read as a cut-out with no rock faces and no relief.

   Fog was NOT the cause and is not touched: these bands already opt out
   (`fog={false}`) and they sit inside the 260 far plane from every beat.

   Now: haze grows with distance and with depth INTO the range, the crest
   stays the crispest thing on the horizon, the low skirt dissolves so it
   hands off to the treeline, snow is placed by a line that a real proportion
   of the visible face clears, and the sun is the scene's own KEY with a
   ~3:1 lit-to-shadow range. Measured result at the LAND beat: mid rank
   173..229 (was 191..219), far rank 192..228 (was 216..219), snow on 7.5%
   of visible range pixels (was 0.8%). Still hazy — nothing is hard-edged,
   nothing is darker than the near forest — but no longer erased.
   =================================================================== */
function snowRangeGeometry(seed: number, W: number, D: number, SX: number, SZ: number, hMul: number, wash: number) {
  const g = new THREE.PlaneGeometry(W, D, SX, SZ);
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position as THREE.BufferAttribute;
  const sky = new THREE.Color("#d9e6ee");
  /* Rock darkened (#5d6f80 -> #4a5a69) and the high-rock tint pulled back
     (#7f909e -> #6f8090, and the alt ramp 1.5 -> 0.9). The old pair pushed
     every high vertex to the PALEST rock in the palette and then washed it
     — the peaks were the least contrasty part of the range. Snow now has
     something to be brighter than. */
  const rock = new THREE.Color("#4a5a69");
  const rockHi = new THREE.Color("#6f8090");
  const snow = new THREE.Color("#f7fbfd");
  const tree = new THREE.Color("#41584c");
  const tmp = new THREE.Color();
  const cols = new Float32Array(p.count * 3);

  // pass 1 — height
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const z = p.getZ(i);
    /* `near` is 1 at the row CLOSEST to the camera, 0 at the back. It was
       called `depth` and documented "0 front .. 1 back", which is inverted —
       see bug 1 in the block comment. Height grows with it, so the near row
       is the crest and the rows behind fall away from us: that descending
       face is the whole visible body of the range. */
    const near = (z + D / 2) / D;
    /* 0.0075 -> 0.0132 across X. At the old frequency the base wavelength was
       133 units and the frame is ~154 units wide at this distance, so the
       whole backdrop was ONE lump plus a shoulder. 0.0132 puts two ridge
       systems and their sub-ridges in frame, which is what foothills look
       like. Z frequency follows so the face gets ribs, not bands. */
    const rid = ridged(x * 0.0132 + 11.3 + seed, z * 0.014 + 4.1 + seed * 0.7, 5);
    const macro = 0.45 + 0.55 * vnoise(x * 0.0022 + 2.7 + seed, z * 0.004 + 9.4);
    /* 55, not 150. At ~150 units out a 150-unit peak subtends about 45° and
       swallows the sky; 55 subtends roughly 20°, which is what a real range
       looks like from a valley floor. The pow(1.08) deepens the saddles
       slightly relative to the peaks — ridged noise is already spiky, this
       just stops the shoulders filling in — and 0.78 is the normaliser that
       keeps the peak height where it was before the power was applied.
       Headroom checked against every beat: this silhouette clips FEWER
       columns at the top of frame than the one it replaces (beat 1: 34 of
       1440, was 516; beat 3: 389, was 514). */
    let h = Math.pow(Math.min(1, (rid * macro) / 0.78), 1.08) * 0.78 * 55 * hMul * (0.42 + near * 0.9);
    // and pull the BACK edge down to the ground so the boundary never floats
    h *= Math.min(1, Math.max(0, (near - 0.02) / 0.22));
    p.setY(i, h);
  }
  g.computeVertexNormals();

  // pass 2 — colour by altitude, slope and distance
  const n = g.attributes.normal as THREE.BufferAttribute;
  let maxH = 1;
  for (let i = 0; i < p.count; i++) maxH = Math.max(maxH, p.getY(i));
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const z = p.getZ(i);
    const alt = y / maxH;
    const slope = 1 - Math.abs(n.getY(i)); // 0 flat .. 1 vertical
    /* snow above the line, but shed off anything steep. Line noise runs at
       0.17 amplitude — a straight snow line is the one thing a real range
       never has; cirques hold snow low and windward shoulders blow clear
       high. The line itself dropped 0.46 -> 0.42 and the ramp tightened
       0.2 -> 0.13, measured against the altitude of the VISIBLE face rather
       than of the whole mesh (its pixels run alt p25 0.21 / p50 0.32 /
       p75 0.45 / p90 0.57), which is what turns 0.8% snow cover into ~8%.
       The slope gate matters more than the line: visible-face slope runs
       p50 0.25 / p75 0.40, so shedding from 0.34 and clearing by 0.50 keeps
       bare rock on the steep flanks and holds snowfields on the shoulders —
       the actual cue the founder asked for. */
    const line = 0.42 + vnoise(p.getX(i) * 0.02 + seed, z * 0.02) * 0.17;
    let snowAmt = clamp01((alt - line) / 0.13) * clamp01(1 - (slope - 0.34) / 0.16);
    snowAmt = clamp01(snowAmt);
    const treeAmt = clamp01((0.16 - alt) / 0.22);
    tmp.copy(rock).lerp(rockHi, clamp01(alt * 0.9));
    tmp.lerp(tree, treeAmt * 0.8);
    tmp.lerp(snow, snowAmt);
    /* Bake the sun term into the colour and draw unlit. A backdrop lit by
       the scene's directional light turns its whole north face black, which
       is what put a grey slab across the sky. Baking it means the peaks get
       their light-and-shade — the thing that actually makes them read as
       3D — with no lighting cost and no unlit backfaces.

       The direction is now KEY itself, not the near-overhead (0.44, 0.78,
       0.44) it used to be: one key, one direction, everywhere — the same
       rule the rest of this file already follows. `0.66 * ndl + 0.40`
       clamped, remapped to 0.40..1.34, gives a ~3:1 lit-to-shadow range in
       place of the old 1.12:1, which is where the rock faces come from. */
    const ndl = n.getX(i) * KEY.x + n.getY(i) * KEY.y + n.getZ(i) * KEY.z;
    const shade = clamp01(ndl * 0.66 + 0.4);
    tmp.multiplyScalar(0.4 + shade * 0.94);
    /* Aerial perspective, in the three directions it actually runs:
       · `wash` — how far this whole rank has already dissolved (per rank).
       · `(1 - near) * 0.24` — deeper INTO the range is further away. This is
         the term that used to be inverted.
       · the low band dissolves hard (`+0.26` fading out by alt 0.26) so the
         range's foot hands off to the fogged treeline instead of drawing a
         hard base line above it, and the crest clears (`- alt * 0.22`) so
         the one edge that meets the sky is the crispest thing out there.
       Capped at 0.9: even the haziest vertex keeps a trace of its own
       colour, which is what stopped the far rank flattening to three levels
       of luminance across its entire span. */
    const near = (z + D / 2) / D;
    const haze = clamp01(wash + (1 - near) * 0.24 + (1 - smooth01(0, 0.26, alt)) * 0.26 - alt * 0.22);
    tmp.lerp(sky, Math.min(0.9, haze));
    cols[i * 3] = tmp.r;
    cols[i * 3 + 1] = tmp.g;
    cols[i * 3 + 2] = tmp.b;
  }
  g.setAttribute("color", new THREE.BufferAttribute(cols, 3));
  return g;
}

function SnowRange({ night, dusk }: { night: number; dusk: Dusk }) {
  /* D was 300 centred at -145, so the front edge reached z=+5 — level with
     the house — and the range filled the whole upper frame as a grey slab.
     A backdrop needs to be a BAND, well behind the treeline, not a plain
     that starts underfoot.

     240 -> 380 segments across X. The ridge frequency roughly doubled (see
     snowRangeGeometry), and at 240 a 900-unit band gave 3.75 units a vertex
     — about 36 px of screen at this distance, which quantised the new crests
     back into soft dunes. 380 gives 2.37 units (~23 px). +7,280 triangles,
     same single draw, unlit, no shadow, no fog. */
  const mid = useMemo(() => snowRangeGeometry(0, 900, 110, 380, 26, 1, 0.3), []);
  /* The far rank: taller (its crests show in the mid range's saddles),
     offset in x so peaks never align, coarser mesh (it resolves to a few
     pixels of relief), and pre-dissolved — the haze BETWEEN the ranks is the
     depth cue. ~6.4k triangles, one draw.

     wash 0.55 -> 0.50 and hMul 1.55 -> 1.45. 0.55 plus the old inverted
     depth term hit the 0.92 clamp on every visible vertex, which is why this
     rank measured 216..219 — a three-level flat. It is still the hazier of
     the two by ~30 levels of luminance, which is the job; it just exists
     now. The height came down slightly because the sharper ridges reach
     higher, and this rank sits closest to the top of frame. */
  const far = useMemo(() => snowRangeGeometry(37.4, 1150, 130, 200, 16, 1.45, 0.5), []);

  /* ONE tint, multiplied onto both ranks' baked vertex colours. A multiply
     can only warm or damp what is already there — it can never repaint the
     range — so the snow/rock/haze relationships survive the whole day arc.
     Day is neutral. Dusk warms and drops the blue: the peaks are the last
     thing the sun leaves, and a cold backdrop under a warm sky was the one
     place the old neutral scalar showed. Night damps toward moonlit blue
     rather than toward black (0.44, 0.50, 0.66) — the range has to stay
     legible after the toggle, and the new albedo is darker than the one the
     old flat 0.38 scalar was tuned against.

     Cost: two float writes per dusk tick. No per-frame allocation, no
     material rebuild, no shader recompile. */
  const mats = useRef<(THREE.MeshBasicMaterial | null)[]>([]);
  const duskAmt = useRef(0);
  const nightAmt = useRef(night);
  nightAmt.current = night;
  const paint = () => {
    const d = duskAmt.current;
    const nA = nightAmt.current;
    const r = (1 + d * 0.1) * (1 - nA * 0.56);
    const gr = (1 - d * 0.03) * (1 - nA * 0.5);
    const b = (1 - d * 0.14) * (1 - nA * 0.34);
    for (const m of mats.current) {
      if (!m) continue;
      m.color.r = r;
      m.color.g = gr;
      m.color.b = b;
    }
  };
  useLayoutEffect(
    () =>
      dusk.add((d: number) => {
        duskAmt.current = d;
        paint();
      }),
    [dusk] // eslint-disable-line react-hooks/exhaustive-deps
  );
  // and once on mount / whenever the night amount moves, so the very first
  // frame of a reduced-motion (frameloop="demand") render is already tinted
  useLayoutEffect(paint, [night]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <mesh geometry={far} position={[70, -13, -232]} renderOrder={-11} frustumCulled={false}>
        <meshBasicMaterial
          vertexColors
          fog={false}
          ref={(el) => {
            mats.current[0] = el;
          }}
        />
      </mesh>
      {/* z places the front rank ~110 units out — behind every tree in the
          stand (the furthest sits at z≈30) and inside the 260 far plane from
          all seven camera beats. */}
      <mesh geometry={mid} position={[0, -9, -172]} renderOrder={-10} frustumCulled={false}>
        <meshBasicMaterial
          vertexColors
          fog={false}
          ref={(el) => {
            mats.current[1] = el;
          }}
        />
      </mesh>
    </>
  );
}

function MountainRange() {
  /* fog={false} is load-bearing. Scene fog runs 30–88 units, and these bands
     sit at 104–168 — inside the fog they resolved to pure fog colour and were
     effectively invisible. They opt out and paint their own aerial
     perspective through colour and opacity instead, which is what a matte
     painter would do anyway. */
  const bands = useMemo(
    () => [
      { seed: 1.7, z: -168, w: 700, h: 132, jag: 1.0, color: "#a8bcc9", op: 0.85, y: 2 },
      { seed: 4.2, z: -134, w: 600, h: 104, jag: 0.94, color: "#8ea7b8", op: 0.92, y: 1 },
      { seed: 8.9, z: -106, w: 500, h: 78, jag: 0.88, color: "#748ea3", op: 0.97, y: 0 },
    ],
    []
  );
  const geos = useMemo(
    () => bands.map((b) => ridgeGeometry(b.seed, b.w, b.h, 128, b.jag)),
    [bands]
  );

  /* Snow caps: a second, slightly smaller copy of each ridge drawn just in
     front and clipped to the top by its own geometry height. Cheap, and it
     is the single cue that says "Rockies" rather than "hills". */
  return (
    <group renderOrder={-10}>
      {bands.map((b, i) => (
        <group key={i}>
          <mesh geometry={geos[i]} position={[0, b.y, b.z]}>
            <meshBasicMaterial color={b.color} transparent opacity={b.op} fog={false} side={THREE.DoubleSide} />
          </mesh>
          {/* snowline — same silhouette, pushed up and lightened */}
          <mesh geometry={geos[i]} position={[0, b.y + b.h * 0.05, b.z + 1.5]} scale={[1, 0.955, 1]}>
            <meshBasicMaterial
              color="#f4f8fa"
              transparent
              opacity={0.72 - i * 0.14}
              fog={false}
              side={THREE.DoubleSide}
            />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/* ============================== CLOUDS ==============================
   CLOUDS v2 — volumes, not blobs.

   v1 was 13 radial-gradient sprites: 2-4 flattened pure-white ellipses per
   cloud with a heavy gaussian alpha falloff, stacked. Stacked soft alpha
   is what produced the visibly brighter cores where two ellipses met — the
   single clearest AI-slop tell on the page — and because a sprite has no
   geometry there was no shading, no underside, no light direction at all.

   These are real (if very low-poly) volumes: 4-7 squashed icosahedra merged
   into one shell, drawn OPAQUE so nothing can stack, with the light baked
   into vertex colours — warm sunlit crown, cool grey base, graded by height
   AND by the dot product with the same key direction the scene's sun uses.
   Same low-poly language as the trees and the terrain, which is the point:
   a cloud that is made of the same stuff as the world reads as part of it.

   The band was also lowered. v1 ran y 44-78 with half-heights near 18, so
   the tallest clouds terminated exactly at the top of the hero frame and
   got hard-clipped by the viewport edge.
=================================================================== */

/** Concatenate non-indexed geometries. IcosahedronGeometry is non-indexed
 *  (PolyhedronGeometry always is), so position/normal can simply be joined —
 *  no need to pull in BufferGeometryUtils for eleven lines of array copy. */
function mergeNonIndexed(geos: THREE.BufferGeometry[]) {
  let total = 0;
  for (const g of geos) total += (g.attributes.position as THREE.BufferAttribute).count;
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  /* o counts VERTICES; the .set offset is in floats, so it multiplies by 3
     exactly once. The old code accumulated count*3 AND multiplied by 3 at the
     call site — the second geometry wrote 3x past the end and the RangeError
     took the whole React tree (blank page, no canvas) with it. */
  let o = 0;
  for (const g of geos) {
    const p = g.attributes.position as THREE.BufferAttribute;
    const n = g.attributes.normal as THREE.BufferAttribute;
    pos.set(p.array as Float32Array, o * 3);
    nor.set(n.array as Float32Array, o * 3);
    o += p.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  return out;
}

/** The key direction every baked-light surface in this file agrees on.
 *  It matches the LightArc's daytime sun in Scene.tsx. If that moves, this
 *  moves — inconsistent light is worse than no light. */
const KEY = new THREE.Vector3(18, 16, 13).normalize();

function cloudGeometry(seed: number) {
  const parts: THREE.BufferGeometry[] = [];
  const n = 4 + Math.floor(rand(seed, 71) * 3);
  for (let i = 0; i < n; i++) {
    const k = seed * 7 + i;
    const g = new THREE.IcosahedronGeometry(1, 1);
    const s = 0.55 + rand(k, 72) * 0.8;
    const sy = s * (0.5 + rand(k, 73) * 0.3);
    g.scale(s * 1.3, sy, s);
    // lobes step down toward the ends, which is what gives a cumulus its
    // flat base and domed crown rather than a row of equal bubbles
    const off = i - (n - 1) / 2;
    g.translate(
      off * 1.02 + (rand(k, 74) - 0.5) * 0.4,
      (rand(k, 75) - 0.5) * 0.34 - Math.abs(off) * 0.16,
      (rand(k, 76) - 0.5) * 0.5
    );
    parts.push(g);
  }
  const geo = mergeNonIndexed(parts);
  const p = geo.attributes.position as THREE.BufferAttribute;
  const nA = geo.attributes.normal as THREE.BufferAttribute;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < p.count; i++) {
    minY = Math.min(minY, p.getY(i));
    maxY = Math.max(maxY, p.getY(i));
  }
  const crown = new THREE.Color("#fffdf5");
  const body = new THREE.Color("#eff2f1");
  const base = new THREE.Color("#c0ccd1");
  const tmp = new THREE.Color();
  const cols = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const h = (p.getY(i) - minY) / Math.max(0.001, maxY - minY);
    const nd = clamp01(nA.getX(i) * KEY.x + nA.getY(i) * KEY.y + nA.getZ(i) * KEY.z);
    tmp.copy(base).lerp(body, smooth01(0, 0.55, h)).lerp(crown, nd * 0.9 * smooth01(0.1, 0.85, h));
    cols[i * 3] = tmp.r;
    cols[i * 3 + 1] = tmp.g;
    cols[i * 3 + 2] = tmp.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(cols, 3));
  geo.computeBoundingSphere();
  return geo;
}

function Clouds({ frozen, night }: { frozen: boolean; night: number }) {
  /* Seven base volumes across fifteen instances (was four across thirteen)
     — under seven, the eye finds the repeats. Roughly a quarter fly as
     STRATUS: the same volume squashed flat and stretched wide, which is the
     cheapest possible second cloud species and the one this sky was
     missing; a real ceiling is never all cumulus. */
  /* Quality-pass verdict, by screenshot (look-fix-look, three rounds): every
     cloud experiment was REVERTED. 15 instances merged the band into one
     pale ceiling; stratus slabs read as smears against the gradient sky;
     and the wider 3-7 lobe spread made banks broad enough to bridge into
     their neighbours over the trailhead. Thirteen distinct cumulus from
     four volumes IS the founder-approved sky — the variety this pass owed
     the frame came from the second mountain rank instead. */
  const geos = useMemo(() => [1, 2, 3, 4].map((s) => cloudGeometry(s)), []);
  const defs = useMemo(
    () =>
      Array.from({ length: 13 }, (_, i) => ({
        g: i % 4,
        x: -170 + rand(i, 1) * 340,
        y: 28 + rand(i, 2) * 15,
        z: -96 - rand(i, 3) * 108,
        s: 7 + rand(i, 4) * 10,
        v: 0.16 + rand(i, 5) * 0.26,
        rot: rand(i, 6) * Math.PI * 2,
      })),
    []
  );
  const refs = useRef<(THREE.Mesh | null)[]>([]);
  useFrame(({ clock }) => {
    if (frozen) return;
    const t = clock.elapsedTime;
    for (let i = 0; i < refs.current.length; i++) {
      const m = refs.current[i];
      if (!m) continue;
      const d = defs[i];
      m.position.x = ((d.x + t * d.v + 210) % 420) - 210;
      m.position.y = d.y + Math.sin(t * 0.07 + i) * 0.6;
    }
  });
  const dim = 1 - night * 0.58;
  return (
    <group renderOrder={-9}>
      {defs.map((d, i) => (
        <mesh
          key={i}
          geometry={geos[d.g]}
          position={[d.x, d.y, d.z]}
          rotation={[0, d.rot, 0]}
          scale={[d.s, d.s * 0.6, d.s * 0.7]}
          frustumCulled={false}
          ref={(el) => {
            refs.current[i] = el;
          }}
        >
          <meshBasicMaterial vertexColors fog={false} color={new THREE.Color(dim, dim, dim * 1.04)} />
        </mesh>
      ))}
    </group>
  );
}

/* =============================== GRASS ==============================
   GRASS v6 — a meadow, not a population of sticks. (v6: the founder's
   x4-density two-layer round — see the layer comment above G_HERO.)

   WHAT CAME FROM WHERE (all credited in docs/CREDITS.md):

   · muratkamci/snakey-locomotion (MIT) — the blade itself. Quadratic-Bezier
     bend anchored at the root, 4-segment tapered strip, layered gust+ripple
     value noise, normals taken from the Bezier tangent and then ROUNDED
     across the width, backlit translucency, base ambient occlusion, the
     widen-with-distance trick that kills sub-pixel shimmer, and the clamp
     that stops single blades turning into bloom fireflies.

   · aleksandargjoreski.dev "Trimming my Grass Shader" — the LOD doctrine.
     His system is WebGPU compute + atomic compaction + indirect draw, which
     does not port to our WebGL static export, so the architecture was
     deliberately NOT copied. Four ideas were:
       1. thin blades stochastically with distance rather than clipping the
          field at a ring,
       2. weight that thinning by the blade's PROJECTED SCREEN HEIGHT, so the
          LOD tracks what you can actually resolve,
       3. seed per-blade variation from WORLD-SPACE position, never from the
          instance index, so a blade's identity is stable and the field never
          reads as a repeating pattern,
       4. treat the grass map as a CONTINUOUS HEIGHT SCALE, not as binary
          visibility — which is why grass here shortens into the path and the
          deck instead of stopping at a stencil line.
     His hysteresis (asymmetric appear/disappear thresholds) solves flicker
     for a field of blades that pop in and out as binary. Ours never pops:
     the keep test is a smooth band, so a blade shrinks to nothing over ~0.14
     of seed space. Same goal, no per-blade state to carry.

   · thebuggeddev/football — read for its endless-grassland framing only. It
     carries NO LICENSE, so nothing was copied from it. Noted and moved on.

   THE STRUCTURE, and why it is tiles:
   one giant InstancedBufferGeometry submits every blade every frame no
   matter where the camera is — thinning in the vertex shader saves fill but
   not vertex work. So the field is cut into 4 m tiles, each its own
   instanced draw with a real bounding sphere. Tiles the camera cannot see
   are frustum-culled by three for free, and each visible tile's
   `instanceCount` is trimmed per frame to the LOD keep-fraction.

   The trick that makes the trim seamless: blades inside a tile are SORTED BY
   THEIR FADE SEED at build time. The shader keeps blades whose seed is below
   the local keep-fraction, so truncating instanceCount to the same fraction
   removes exactly the blades the shader had already scaled to zero. Cutting
   vertex work costs nothing visually.
=================================================================== */

/* Shared by the JS LOD trim and the GLSL fade — they MUST agree or blades
   pop at the truncation edge. */
/* GRASS v6 — the founder's x4 round. "Grass x4, no ground visible, slightly
   shorter." A naive x4 of the 7-tri hero blade is ~2.7M triangles — over
   double the whole scene budget. The smart spend is TWO LAYERS:

   · HERO layer — the full 4-segment, 7-triangle bending blade, ~1.6x the old
     count. It owns the silhouette: wind, species, seed heads, tip glint.
     Its full-density radius tightens 27 m -> 18 m to pay for the count —
     density moved from the fog wash to where the camera actually looks.

   · FILLER layer — a SINGLE-TRIANGLE blade at very high density, SHORT
     (9-21 cm). It exists for exactly one job: closing the ground between
     hero blades so no bare lawn reads anywhere near the camera. At that
     height a bend has no visible mid-point, so the mid vertices would be
     pure spend — one triangle is the whole blade. Its LOD dissolves it past
     12-24 m, where the hero layer plus the darkened terrain take over.
     1 tri and a near-only LOD is why x4 blades fits inside the budget.

   All blade heights also dropped 20% ("a little less tall" — founder). */
type GrassLayerCfg = {
  near: number; // full density inside this radius
  far: number; // thinned to pmin by here
  pmin: number;
  band: number; // width of the smooth dissolve band, in seed space
  tile: number; // tile edge, metres
  segs: number; // blade segments (4 = 7 tris, 2 = 3 tris)
};

/* 6 m hero tiles were ~45% the draws of 4 m tiles; 8 m buys the filler
   layer's draws back again. Culling granularity stays far finer than a
   camera beat. Filler tiles are bigger still — the layer is short-range, so
   few of its tiles are ever in frustum at once. */
/* Botanical pass (Aug 12) — "bring back the much thicker grass": near 14 ->
   16. Two more metres of full-density hero ring around the camera, which is
   the band the close beats actually judge thickness in. Cost is the LOD
   keep-fraction between 14 and ~30 m rising a step (~+5-8% hero triangles
   at the worst beat, est. +25-35k); the planted budget does not move. */
export const G_HERO: GrassLayerCfg = { near: 16, far: 34, pmin: 0.04, band: 0.16, tile: 8, segs: 4 };
/* Founder x3 escalation (Aug 9, on top of the x4): the extra density all
   lands in the filler, and it pays for itself twice — the blades got
   SHORTER (8-18 cm, was 9-21), so the projected-height gate prunes them
   sooner, and the LOD reach tightened 12-24 -> 8-18 m, so a fourfold
   planted count submits only ~15% more triangles per frame. Coverage where
   the eye judges it (the first 8-18 m) quadruples; past that the hero
   layer, the darkened ground, and the fog were already carrying the field. */
export const G_FILL: GrassLayerCfg = { near: 8, far: 16, pmin: 0.0, band: 0.16, tile: 6, segs: 1 };
const G_MID: GrassLayerCfg = { near: 18, far: 42, pmin: 0.0, band: 0.18, tile: 16, segs: 1 };
const G_FAR: GrassLayerCfg = { near: 30, far: 68, pmin: 0.0, band: 0.2, tile: 20, segs: 1 };

const smooth01 = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** Keep-fraction at a given camera distance. Mirrored exactly in GLSL. */
const keepFraction = (cfg: GrassLayerCfg, d: number) =>
  1 + (cfg.pmin - 1) * smooth01(cfg.near, cfg.far, d);

/* ---------------------- where grass may grow ---------------------- */

/** Distance from (x,z) to a rectangle; 0 inside it. */
function rectDist(x: number, z: number, x0: number, z0: number, x1: number, z1: number) {
  const dx = Math.max(x0 - x, 0, x - x1);
  const dz = Math.max(z0 - z, 0, z - z1);
  return Math.hypot(dx, dz);
}

/** Distance from (x,z) to the segment a->b. */
function segDist(x: number, z: number, ax: number, az: number, bx: number, bz: number) {
  const vx = bx - ax;
  const vz = bz - az;
  const wx = x - ax;
  const wz = z - az;
  const L = vx * vx + vz * vz;
  const t = L > 0 ? clamp01((wx * vx + wz * vz) / L) : 0;
  return Math.hypot(x - (ax + vx * t), z - (az + vz * t));
}

/** Distance from (x,z) to a shared ground rect. */
const rectDistTo = (x: number, z: number, r: GroundRect) => rectDist(x, z, r.x0, r.z0, r.x1, r.z1);

/** Distance from (x,z) to a shared ground run's centreline. */
const segDistTo = (x: number, z: number, s: GroundSegment) => segDist(x, z, s.ax, s.az, s.bx, s.bz);

/* The walked route. Grass thins toward it rather than stopping at it —
   a mown verge, not a cut-out. Mirrors PATH_STONES in Scene.tsx. */
const G_PATH = PATH;

/**
 * Height multiplier 0..1 for the built world. Everything feathers, so grass
 * SHORTENS as it meets the deck, the walkway and the stones instead of being
 * stamped out along a hard edge — the single change that stops the meadow
 * looking like a texture with holes cut in it.
 *
 * `vergePad`/`vergeFeather` shape the mown strip along the walked trail.
 * The hero layer keeps the wide mow (tall blades never lean over the line);
 * the filler layer runs a TIGHTER verge — short grass walks nearly to the
 * dirt, the way a real trodden line sits inside a short-grass shoulder,
 * which is what closed the pale bands either side of the path.
 *
 * `tight` (v8, the "no visible bare ground" round) extends that same idea to
 * every built feature, not just the trail. The wide pads exist so TALL hero
 * blades never lean into the fire ring or over the deck skirt — but the
 * filler is 8-18 cm; it can stand a hand-span from the flames and under the
 * chair seats the way a real camp lawn does. Shot evidence: the wide pads
 * union into a ~4 m bare disc at the fire-pit lounge that fills the lower
 * frame of beats 02-04 (s02/s03 bottom-left) and a pale skirt beside the
 * house and the tub pad (s05/s06). Tight pads keep the blades out of the
 * actual geometry (ring, slabs, walls) and hand the rest of the apron back
 * to the short sward — zero new instances, the rejection sampler simply
 * stops throwing these positions away.
 */
function clearance(
  x: number,
  z: number,
  vergePad = 0.3,
  vergeFeather = 0.75,
  tight = false
): number {
  const fade = (d: number, pad: number, feather: number) => clamp01((d - pad) / feather);
  // [widePad, wideFeather, tightPad, tightFeather] per feature — wide keeps
  // tall hero blades clear of the structures, tight lets the short filler
  // hug them.
  const P = (w0: number, w1: number, t0: number, t1: number) =>
    tight ? ([t0, t1] as const) : ([w0, w1] as const);
  let c = 1;
  // the home
  let p = P(0.3, 1.2, 0.12, 0.4);
  c = Math.min(c, fade(rectDistTo(x, z, HOUSE_RECT), p[0], p[1]));
  /* Deck + glass walkway: the deck FLOATS at 0.44 on point posts, skirt
     bottom 0.17, plank underside 0.395; the walkway glass rides at 0.40.
     From the beat-3/4 cameras the open south slot shows the ground UNDER
     them — measured by back-projecting the bald pixels: the pale "L" at
     s02-s04 is x -3..1, z 4.7-6.4, i.e. the under-deck apron, not the lawn.
     Filler blades top out at 0.18 m (stem species x1.75 = 0.315) — all of
     it clears the planks and the glass — so in tight mode these two
     features simply do not clear grass at all: the slot fills with sward.
     The hero layer keeps its wide pads (0.5 m blades would poke through). */
  if (!tight) {
    c = Math.min(c, fade(rectDistTo(x, z, DECK_RECT), 0.28, 0.95));
    c = Math.min(c, fade(segDistTo(x, z, WALKWAY_SEGMENT), WALKWAY_SEGMENT.halfWidth, 0.8));
  }
  /* Entrance steps. STEPS_TREADS says the five treads actually run z 6.73 to
     8.53, so the wide rect's reach to 8.7 is the flight plus a hand's-width
     of apron, not the 1.5 m of surplus an earlier note claimed. The tight
     rect stops at 7.3 and covers only the top two treads; it is safe only for
     the 8-18 cm filler, and handing it to a tall consumer is what stood 1.4 m
     cards through the lower treads. Both rects and the tread run come from
     lib/three/meadow/geometry.ts — check STEPS_RECT_WIDE still covers
     STEPS_TREAD_FOOTPRINT before moving either. */
  p = tight ? ([0.12, 0.4] as const) : ([0.24, 0.7] as const);
  c = Math.min(
    c,
    tight
      ? fade(rectDistTo(x, z, STEPS_RECT_TIGHT), p[0], p[1])
      : fade(rectDistTo(x, z, STEPS_RECT_WIDE), p[0], p[1])
  );
  // tub pad
  p = P(1.4, 0.9, 0.92, 0.5);
  c = Math.min(c, fade(Math.hypot(x - TUB_CENTER.x, z - TUB_CENTER.z), p[0], p[1]));
  // fire-pit lounge — the founder's "remove object borders" note: the old
  // tight disc (1.05+0.6 ~= 1.65 m) bared the whole lounge and ringed the
  // chairs. Short filler now grows under and between the chairs and right to
  // the ring stones; only the flame core (0.5+0.45 ~= 0.95 m, ~ the stone
  // ring) stays clear. Hero blades keep a wider berth so a 0.5 m blade never
  // pokes through a chair seat.
  p = P(1.3, 0.8, 0.5, 0.45);
  c = Math.min(c, fade(Math.hypot(x - FIREPIT_CENTER.x, z - FIREPIT_CENTER.z), p[0], p[1]));
  // the bench out in the east meadow
  p = P(0.95, 0.8, 0.6, 0.5);
  c = Math.min(c, fade(Math.hypot(x - BENCH_CENTER.x, z - BENCH_CENTER.z), p[0], p[1]));
  // the stepping-stone route
  let pd = Infinity;
  for (let i = 0; i < G_PATH.length - 1; i++) {
    pd = Math.min(pd, segDist(x, z, G_PATH[i][0], G_PATH[i][1], G_PATH[i + 1][0], G_PATH[i + 1][1]));
    if (pd < 0.3) break;
  }
  /* The stepping stones used to keep 25% height ON the path, which put
     blades poking straight through the slabs. A walked route is mown: the
     line goes to zero and feathers back up — but the old 0.42+1.15 m verge
     cut a 3 m swath that filled half the hero frame with bare lawn from the
     trailhead camera. A walked line through a meadow is narrow. */
  c = Math.min(c, fade(pd, vergePad, vergeFeather));
  return c;
}

/**
 * Where the meadow is at all, 0..1. Dense where the camera actually travels
 * — the trailhead, the crest, the descent corridor and the ring around the
 * home — and gone where it never looks, so we never pay for invisible blades.
 */
function meadowDensity(x: number, z: number): number {
  const r = Math.hypot(x, z);
  /* v1's ring was `1 - smooth01(14, 25, r)`, which reaches exactly zero at
     25 m and left a razor-straight edge across the field — at beat 05 the
     blades stopped dead along a horizontal line and everything past it was
     bare plane. Two changes kill it: the ring feathers over 19 m instead of
     11, and a low scatter carries all the way to the fog line so the ground
     is never empty. Density, not a cull radius, is what LOD should be. */
  const ring = 1 - smooth01(16, 35, r);
  // the trail corridor: trailhead at z~34 down to the fence at z~8
  const corridor =
    (1 - smooth01(9, 18, Math.abs(x))) * smooth01(5.5, 11, z) * (1 - smooth01(33, 41, z));
  /* 0.16 to r=66 was coverage everywhere and density nowhere: the camera
     spends every beat inside r<35, staring at 16% scatter, while blades it
     can never resolve soaked up budget out at the fog line. Concentrate:
     double the floor, halve the reach. Scrub owns the far field. */
  const scatter = 0.34 * (1 - smooth01(28, 48, r));
  let d = Math.max(ring, corridor, scatter);
  // nothing on the deep forest floor behind the home — the camera never goes
  d *= 1 - smooth01(6, 15, -z);
  return clamp01(d);
}

/* Exported for Terrain() in Scene.tsx: the ground under the meadow darkens
   toward the sward's own shadow so a gap between blades reads as depth, not
   bare lawn (Codrops "fluffiest grass": match the terrain to the grass and
   fake the occlusion with a dark base).

   clearance enters at pow 0.35, not linearly: the mown verge (clearance
   0.3-0.7) is exactly where the grass is too short to close the ground, so
   a linear term stripped the shadow from the one strip that needed it — the
   pale shoulders flanking the trail at the trailhead beat. The soft power
   keeps the sward shadow on the shoulders while true aprons (clearance 0 at
   the deck, fire pit, and stones) still read walked and bright. */
export function meadowShade(x: number, z: number): number {
  /* v9: the shade band reaches PAST the planted ring. Shading that faded in
     lockstep with planting density left a pale mid ring at r 18-35 — the
     filler dissolves by 16 m, the hero thins, AND the ground brightened at
     the same radius, so the LAND beat read sparse blades on pale lawn
     exactly where the eye lands. The shade ring now feathers 16->46 m
     (planting keeps 16->35): the ground stays meadow-toned past the last
     dense blade and hands off to the fog, so the field reads as one
     continuous sward with blades on it rather than a sward that ends. */
  const r = Math.hypot(x, z);
  const ring = 1 - smooth01(16, 46, r);
  const corridor =
    (1 - smooth01(9, 18, Math.abs(x))) * smooth01(5.5, 11, z) * (1 - smooth01(33, 41, z));
  const scatter = 0.34 * (1 - smooth01(28, 48, r));
  let d = Math.max(ring, corridor, scatter);
  d *= 1 - smooth01(6, 15, -z);
  return clamp01(d) * Math.pow(clearance(x, z), 0.35);
}

/* Exported for Terrain(): 0..1 trodden-earth factor along the walked route.
   The mown verge alone left a pale-lawn stripe through the meadow that read
   as MISSING grass; a faint earth line inside it reads as a trail — the
   thing a walked route actually looks like, and it leads the eye to the
   door. Core ~0.55 m half-width, feathered out by 1.2 m; narrower than the
   0.3+0.75 m mow, so the dirt sits inside a short-grass shoulder. */
export function trailTrodden(x: number, z: number): number {
  let pd = Infinity;
  for (let i = 0; i < G_PATH.length - 1; i++) {
    pd = Math.min(pd, segDist(x, z, G_PATH[i][0], G_PATH[i][1], G_PATH[i + 1][0], G_PATH[i + 1][1]));
  }
  return 1 - clamp01((pd - 0.55) / 0.65);
}

/* --------------------------- the blade ---------------------------- */

/* segs=4: 9 verts, 7 triangles (hero). segs=1: 3 verts, 1 triangle (filler).
   No alpha anywhere in either. */
function grassBlade(segs: number) {
  const pos: number[] = [];
  const uvs: number[] = [];
  const idx: number[] = [];
  if (segs === 1) {
    /* The single-card filler closes ground, while full segmented hero blades
       own the close silhouette. It is double-sided and deliberately wider in
       the shared shader, avoiding three-times vertex cost on integrated GPUs. */
    pos.push(-0.5, 0, 0, 0.5, 0, 0, 0, 1, 0);
    uvs.push(0, 0, 1, 0, 0.5, 1);
    idx.push(0, 1, 2);
    return { pos: new Float32Array(pos), uvs: new Float32Array(uvs), idx: new Uint16Array(idx) };
  }
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    if (i === segs) {
      pos.push(0, t, 0);
      uvs.push(0.5, t);
    } else {
      pos.push(-0.5, t, 0, 0.5, t, 0);
      uvs.push(0, t, 1, t);
    }
  }
  for (let i = 0; i < segs - 1; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const last = (segs - 1) * 2;
  idx.push(last, last + 1, last + 2);
  return { pos: new Float32Array(pos), uvs: new Float32Array(uvs), idx: new Uint16Array(idx) };
}

const grassVert = () => /* glsl */ `
precision highp float;

attribute vec3 aPos;    // world x, terrain y, z — planted on the real ground
attribute vec4 aRand;   // yaw, height, width, fade seed
attribute float aClear; // clearance: how tall this blade is allowed to be

uniform float uTime;
uniform vec4 uLod;     // pmin, near, far, stochastic fade band
uniform float uRichWind;
uniform vec2  uWindDir;
uniform vec3  uCamPos;
uniform float uProjScale; // 1/tan(fov/2): turns metres into screen fraction
uniform float uGust;      // 0..1 weather envelope, ramp/hold/decay/lull

varying float vT;
varying vec3  vNormal;
varying vec3  vWorld;
varying float vHue;
varying vec3  vGround;
varying float vSpecies;

float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

/* The EXACT terrain vertex-colour formula from Terrain() in Scene.tsx, in
   linear space. A blade's root is the colour of the ground it grows out of,
   which is what stops a grass field reading as green sticks on a lawn. */
vec3 groundColor(vec2 p){
  vec3 cA = vec3(0.2661, 0.4451, 0.2307); // #8db284
  vec3 cB = vec3(0.3711, 0.5395, 0.3005); // #a4c295
  vec3 cC = vec3(0.4734, 0.5520, 0.2502); // #b7c489
  float n1 = 0.5 + 0.5 * sin(p.x * 0.23 + p.y * 0.17 + 1.2);
  float n2 = 0.5 + 0.5 * sin(p.x * 0.61 - p.y * 0.43 + 4.0);
  return mix(mix(cA, cB, n1), cC, n2 * 0.25);
}

/* meadowDensity() from the JS planting pass, verbatim minus clearance — the
   terrain bakes the same term (times clearance) into its vertex colours, so
   blade roots and the darkened ground under them stay one surface. */
float meadowD(vec2 p){
  float r = length(p);
  float ring = 1.0 - smoothstep(16.0, 35.0, r);
  float corr = (1.0 - smoothstep(9.0, 18.0, abs(p.x)))
             * smoothstep(5.5, 11.0, p.y)
             * (1.0 - smoothstep(33.0, 41.0, p.y));
  float scat = 0.34 * (1.0 - smoothstep(28.0, 48.0, r));
  float d = max(ring, max(corr, scat));
  d *= 1.0 - smoothstep(6.0, 15.0, -p.y);
  return clamp(d, 0.0, 1.0);
}

void main(){
  float t = uv.y;          // 0 at root, 1 at tip
  float side = position.x; // -0.5 .. 0.5
  vec3 base = aPos;

  float dist = distance(base, uCamPos);

  /* ---- LOD: stochastic thinning, weighted by on-screen size ----
     Keep-fraction falls with distance; a blade survives if its seed is under
     it. The test is a smooth band, not a step, so blades dissolve instead of
     popping and no hysteresis state is needed. */
  float p = mix(1.0, uLod.x, smoothstep(uLod.y, uLod.z, dist));
  float projH = (aRand.y * aClear) * uProjScale / max(dist, 0.001);
  p *= smoothstep(0.0040, 0.020, projH);
  float vis = 1.0 - smoothstep(p - uLod.w, p, aRand.w);
  // never let a blade flash across the lens as the camera brushes past it
  vis *= smoothstep(0.18, 0.55, dist);

  /* ---- THREE FORMS, CLUMPED ----
     v1 had one primitive: a straight tapered strip, identical width and
     identical taper on every instance. Because the trees in this world are
     cones too, the lawn read as a field of miniature trees. A meadow is at
     least three things — an arching leaf blade, a short broad tuft, and a
     seed stem that carries a head — and real meadows grow them in PATCHES,
     not shuffled per blade. So the species is seeded from a coarse
     world-space cell (~1.8 m), which clumps them for free and keeps a
     blade's identity stable no matter which tile it landed in. */
  float sp = h21(floor(base.xz * 0.55) + 19.3);
  float isTuft = smoothstep(0.48, 0.54, sp) * (1.0 - smoothstep(0.78, 0.84, sp));
  float isStem = smoothstep(0.78, 0.84, sp);
  float hMul = mix(1.0, 0.66, isTuft) * mix(1.0, 1.75, isStem);
  /* 1.85 made tufts read as cones next to the pines. Species should vary the
     silhouette, not the mass — and 1.3 width on a 0.58-height tuft still
     compounded into squat near-camera triangles. A tuft is short, not fat. */
  float wMul = mix(1.0, 1.12, isTuft) * mix(1.0, 0.5, isStem);
  float bendMul = mix(1.0, 1.4, isTuft) * mix(1.0, 0.3, isStem);

  float bh = aRand.y * aClear * vis * hMul;
  float bw = aRand.z * wMul;
  /* widen with distance so a sub-pixel blade cannot shimmer — but v1 used
     0.028/metre, which at 25 m made every blade 1.7x wide on top of the
     2.2x edge-on term. That compounding is what turned the far field into
     fat opaque cones. 0.010 is enough to beat the sampler. */
  bw *= 1.0 + dist * 0.010;

  /* ================= WIND v7 — TRAVELLING GUSTS =================
     v6 was two advected noises plus a front, and it read as "bent", not as
     "swaying". Three reasons, all fixed here:

     · vnoise returns 0..1, so (gust * 0.75 + ripple * 0.30) carried a DC
       offset of about +0.52 with only a small wobble on top. The field held
       a permanent downwind lean; wind never RELEASED, so there was no
       return stroke, and a return stroke is what the eye reads as sway.
       Both noises are centred to -1..1 now.
     · the lean was always exactly wd. One fixed axis is a fore-aft push,
       never a lateral one. A second, slower, counter-advected noise now
       YAWS the local wind vector by up to ~35°, so the direction of the
       lean itself rolls across the meadow — the sideways motion.
     · the gust front's spatial frequency was 0.055, i.e. a 114 m wavelength
       across a field that is only ~90 m wide. The "front" was therefore
       near-uniform — the whole meadow gusted at once, which is precisely
       what "moves as one sheet" means. 0.135 is a 46 m wavelength, so about
       two fronts are on the field at any moment and you can watch one
       travel through it at ~4.6 m/s.

     Everything is uniforms off ONE clock (uTime, uGust); no per-blade CPU
     work, no per-frame allocation. Frozen (prefers-reduced-motion) holds a
     chosen instant rather than t=0 — see FROZEN_T in GrassField.

     COST: the hero blade pays one extra vnoise (3 instead of 2). The filler
     — a single triangle, 8-18 cm tall, gone past 8-18 m — drops the ripple
     noise it could never show and pays ONE (instead of 2), which is the
     larger population by 8x. Net vertex ALU across both layers is slightly
     down, not up. */
  vec2 wd = normalize(uWindDir);

  /* per-blade stiffness, seeded from world position (never from the instance
     index, so it is stable wherever the blade tiles). It scales the response
     amplitude AND detunes the flutter, which is what stops neighbours moving
     in lockstep. */
  float stiff = 0.74 + 0.52 * h21(base.xz * 4.3 + 5.1);
  float ph = aRand.w * 6.2831853;

  /* Three analytic waves replace the previous lattice-noise stack. They keep
     the same travelling-front / lateral-return character while compiling as
     one small program on integrated GPUs. No CPU work is added per blade. */
  float travelling = sin(uTime * 0.62 - dot(base.xz, wd) * 0.135);
  float crossWave = sin(uTime * 0.41 + base.x * 0.082 - base.z * 0.057 + ph);
  float ripple = sin(uTime * 1.85 + base.x * 0.31 + base.z * 0.23 + ph * 0.5);
  float front = 0.5 + 0.5 * travelling;
  float amp = (0.34 + 0.66 * front * uGust) / stiff;
  float lean;
  vec2 dir;
  if (uRichWind > 0.5) {
    float flutter = sin(uTime * 2.6 / stiff + ph) * 0.16;
    lean = (0.66 + travelling * 0.30 + ripple * 0.18 + flutter) * amp;
    float yaw = crossWave * 0.52 + ripple * 0.12;
    dir = wd * cos(yaw) + vec2(-wd.y, wd.x) * sin(yaw);
  } else {
    /* Filler: the same gust field and front, without sub-pixel swirl work. */
    lean = (0.66 + travelling * 0.34 + 0.14 * sin(uTime * 2.6 / stiff + ph)) * amp;
    dir = wd;
  }

  // a small static lean per blade, seeded from world position, so the field
  // is never uniform even when the air is still. Founder "smooth carpet"
  // round: the rest arch grows (0.03-0.19 -> 0.05-0.26) so blades lean and
  // cover ground horizontally rather than standing as thin vertical spikes —
  // the single change that turns a spiky sward into a lawn from a high camera.
  float la = h21(floor(base.xz * 3.7)) * 6.2831853;
  vec2 rest = vec2(cos(la), sin(la)) * mix(0.05, 0.26, h21(base.xz * 1.9 + 7.0));
  vec2 restH = rest * bendMul;
  /* 0.45 -> 0.60. Centring the gust noise removed its DC bias, which was
     most of v6's lean; without paying it back the field would have ended up
     CALMER, and "busier overall" was the ask. Measured over 200 frames x 120
     blades this now runs tilt p50 13.3 / p90 27.5 deg against v6's 12.5 /
     24.9, and each individual blade swings 33.7 deg over time against v6's
     25.5 — busier in both senses, and now with a return stroke. */
  vec2 windH = dir * lean * 0.60 * bendMul;
  vec2 horiz = restH + windH;

  // quadratic Bezier: root pinned at the ground, curvature grows to the tip
  float hl = length(horiz);
  vec3 tipOff = normalize(vec3(horiz.x, max(1.0 - hl * 0.42, 0.22), horiz.y)) * bh;
  /* STIFF AT THE BASE, TRAVEL AT THE TIP. The mid control point used to take
     0.32 of the whole horizontal offset, wind included, so a gust bowed the
     blade evenly from the root — a bent wire, not a whipping leaf. It now
     follows the REST arch at the old 0.32 (that arch is what closes the
     ground from a high camera and must not straighten) but only 0.15 of the
     WIND lean, so the extra travel a gust adds lands at the tip. */
  vec2 midH = restH * 0.32 + windH * 0.15;
  vec3 midOff = normalize(vec3(midH.x, 0.76, midH.y)) * bh * 0.5;
  float omt = 1.0 - t;
  vec3 curve = 2.0 * omt * t * midOff + t * t * tipOff;

  vec3 wDir3 = vec3(cos(aRand.x + position.z), 0.0, sin(aRand.x + position.z));
  /* width profile per form: the blade tapers to a point, the tuft stays
     broad most of its length, and the stem is a thin shaft that SWELLS into
     a seed head near the top instead of tapering out. */
  float taper = mix(1.0 - 0.76 * t * t, 1.0 - 0.40 * t, isTuft);
  float head = 1.0 + isStem * 3.2 * smoothstep(0.70, 0.85, t) * (1.0 - smoothstep(0.90, 1.0, t));
  float w = bw * taper * head;

  /* view-dependent thickening: a blade turned edge-on projects to a sliver
     and disappears. Widen it as it turns away so the field keeps its mass
     at grazing angles — 1.5x, not 2.2x, which was over-fattening every
     blade that faced away from the camera. */
  vec3 viewDir = normalize(uCamPos - base);
  float edgeOn = abs(dot(viewDir, wDir3));
  /* 1.5 stacked onto the tuft multiplier still made 1:6 triangles in the
     near field. 1.3 keeps mass at grazing angles; the ~1:12 blade ratio the
     reference uses (0.03-0.05 wide at 0.35-0.75 tall) does the rest. */
  w *= mix(1.0, 1.3, edgeOn);

  vec3 world = base + curve + wDir3 * side * w;

  // normal from the Bezier tangent, then rounded across the width so the
  // blade shades like a curved ribbon rather than a flat card
  vec3 tang = 2.0 * (1.0 - 2.0 * t) * midOff + 2.0 * t * tipOff;
  vec3 nrm = normalize(cross(wDir3, normalize(tang + vec3(0.0, 1e-4, 0.0))));
  nrm = normalize(nrm + wDir3 * side * 1.1);

  vT = t;
  vNormal = nrm;
  vWorld = world;
  vHue = h21(floor(base.xz * 2.3) + 3.1);
  /* v9: mirrors Terrain()'s meadow deepening — hue toward the sward root
     green (#4d6a42 in linear) plus a value drop — but at ~3/4 strength, so
     the ground sits a shade BELOW the blade roots and a gap between blades
     reads as shadow under the canopy, not soil. See the Terrain() comment
     in Scene.tsx; the two moves are calibrated together. */
  float md = meadowD(base.xz);
  vGround = mix(groundColor(base.xz), vec3(0.0744, 0.1442, 0.0546), md * 0.45)
          * (1.0 - 0.35 * md);
  vSpecies = sp;

  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const GRASS_FRAG = /* glsl */ `
precision highp float;

uniform vec3  uColTip;
uniform vec3  uSunDir;
uniform vec3  uSunCol;
uniform vec3  uHemiSky;
uniform vec3  uHemiGround;
uniform vec3  uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform vec3  uCamPos;
uniform float uNight;
uniform float uSunI;

varying float vT;
varying vec3  vNormal;
varying vec3  vWorld;
varying float vHue;
varying vec3  vGround;
varying float vSpecies;

void main(){
  /* Root IS the ground colour, so the sward has no visible join with the
     terrain. v1 multiplied the ground by 0.90 and pushed the tip colour in
     late (pow 1.25), which made the lower two thirds of every blade darker
     than the ground it grew out of — the "dark speckle on a lawn" read. */
  vec3 tip = uColTip;
  // seed heads go straw, which is where the meadow's colour variety comes
  // from — inside the palette, never an orange
  tip = mix(tip, tip * vec3(1.10, 1.05, 0.88), smoothstep(0.78, 0.86, vSpecies));
  /* pow 0.95 pushed tip colour down almost the whole shaft, so a light khaki
     tip painted the entire blade and the meadow read TAN against green
     ground. The reference uses pow 1.4: the ground colour holds up the shaft
     and the tip only lifts at the very end. */
  vec3 col = mix(vGround, tip, pow(vT, 1.35));
  // per-clump VALUE variation, and only a whisper of hue: BRAND.md section 2
  // has no orange, and a wide hue swing is how a field starts inventing one
  col *= (0.88 + vHue * 0.26) * vec3(1.0 + vHue * 0.04 - 0.02, 1.0, 1.0 - vHue * 0.04 + 0.02);

  vec3 N = normalize(vNormal);
  if (!gl_FrontFacing) N = -N;

  // wrapped diffuse — grass is thin and scatters, it does not terminate hard
  float ndl = dot(N, uSunDir) * 0.5 + 0.5;
  vec3 light = uSunCol * uSunI * ndl * ndl;
  light += mix(uHemiGround, uHemiSky, N.y * 0.5 + 0.5) * 0.55;

  /* Translucency: sun coming THROUGH the blade. Real, but v1 ran it at 0.45
     which meant every blade the camera happened to view down-sun turned
     warm at once — whole regions of the field went tan while the rest
     stayed green. 0.24 keeps the cue and loses the colour cast. */
  vec3 V = normalize(uCamPos - vWorld);
  float back = pow(max(dot(-V, uSunDir), 0.0), 3.0);
  light += uSunCol * back * 0.24 * vT;

  // ambient occlusion at the root — light does not reach the bottom of a
  // sward, but 0.34 was a hole, not an occlusion
  float ao = mix(0.68, 1.04, smoothstep(0.0, 0.6, vT));
  col *= light * ao;

  // tip glint
  vec3 H = normalize(V + uSunDir);
  col += uSunCol * pow(max(dot(N, H), 0.0), 26.0) * 0.06 * vT;

  col = mix(col, col * vec3(0.34, 0.40, 0.54), uNight);
  col = min(col, vec3(2.2)); // no single blade may become a bloom firefly

  float fd = distance(uCamPos, vWorld);
  col = mix(col, uFogColor, smoothstep(uFogNear, uFogFar, fd));

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

function makeGrassMaterial(cfg: GrassLayerCfg) {
  return new THREE.ShaderMaterial({
    vertexShader: grassVert(),
    fragmentShader: GRASS_FRAG,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uLod: { value: new THREE.Vector4(cfg.pmin, cfg.near, cfg.far, cfg.band) },
      uRichWind: { value: cfg.segs >= 4 ? 1 : 0 },
      uWindDir: { value: WIND_DIR.clone() },
      uCamPos: { value: new THREE.Vector3() },
      uProjScale: { value: 2.7 },
      uGust: { value: 0.4 },
      uColTip: { value: new THREE.Color("#93b06a") },
      uSunDir: { value: KEY.clone() },
      uSunCol: { value: new THREE.Color("#fff3dd") },
      uSunI: { value: 1.15 },
      uHemiSky: { value: new THREE.Color("#dcecf4") },
      uHemiGround: { value: new THREE.Color("#7a8b5e") },
      uFogColor: { value: new THREE.Color("#e3ede7") },
      uFogNear: { value: 30 },
      uFogFar: { value: 88 },
      uNight: { value: 0 },
    },
  });
}

function makeWarmGrassGeometry(cfg: GrassLayerCfg) {
  const blade = grassBlade(cfg.segs);
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(blade.pos, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(blade.uvs, 2));
  geo.setIndex(new THREE.BufferAttribute(blade.idx, 1));
  geo.setAttribute("aPos", new THREE.InstancedBufferAttribute(new Float32Array([0, 0, 0]), 3));
  geo.setAttribute("aRand", new THREE.InstancedBufferAttribute(new Float32Array([0, 1, 0.08, 0]), 4));
  geo.setAttribute("aClear", new THREE.InstancedBufferAttribute(new Float32Array([1]), 1));
  geo.instanceCount = 1;
  return geo;
}

/** Compile the one shared grass program before progressive pages are allowed
 * to arrive. On integrated GPUs the first material commit can otherwise turn
 * a tiny page into a 100ms+ driver task. compileAsync lets the browser finish
 * that work while the authored terrain is already the complete visual state. */
function GrassProgramWarmup({ onReady }: { onReady: () => void }) {
  const { gl, camera } = useThree();
  const warmScene = useMemo(() => new THREE.Scene(), []);
  const geometry = useMemo(() => makeWarmGrassGeometry(G_HERO), []);
  const material = useMemo(() => makeGrassMaterial(G_HERO), []);
  const mesh = useMemo(() => new THREE.Mesh(geometry, material), [geometry, material]);
  const warmFlowerBuilt = useMemo(() => buildFlowerField(8, false, FLORA_SAMPLE), []);
  const warmFlowerMaterial = useMemo(() => makeFlowerMaterial(), []);
  const flowerMesh = useMemo(
    () => warmFlowerBuilt ? new THREE.Mesh(warmFlowerBuilt.geo, warmFlowerMaterial) : null,
    [warmFlowerBuilt, warmFlowerMaterial],
  );

  useEffect(() => {
    let cancelled = false;
    warmScene.add(mesh);
    if (flowerMesh) warmScene.add(flowerMesh);
    void gl.compileAsync(warmScene, camera)
      .catch(() => {
        // A driver without parallel shader compilation still gets a bounded
        // one-instance compile before any progressive meadow page is mounted.
        gl.compile(warmScene, camera);
      })
      .finally(() => {
        if (!cancelled) onReady();
      });
    return () => {
      cancelled = true;
      warmScene.remove(mesh);
      if (flowerMesh) warmScene.remove(flowerMesh);
      geometry.dispose();
      material.dispose();
      warmFlowerBuilt?.geo.dispose();
      warmFlowerMaterial.dispose();
    };
  }, [camera, flowerMesh, geometry, gl, material, mesh, onReady, warmFlowerBuilt, warmFlowerMaterial, warmScene]);

  return null;
}

type GrassTile = {
  id: string;
  geo: THREE.InstancedBufferGeometry;
  cx: number;
  cy: number;
  cz: number;
  radius: number;
  n: number;
};


/** Materialise one already-planted worker page. The page contains at most
 * 6,000 instances and arrives only after the prior page is acknowledged;
 * this is deliberately not a whole-field builder. */
function materializeMeadowPage(page: MeadowPage, cfg: GrassLayerCfg): GrassTile {
  const blade = grassBlade(cfg.segs);
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(blade.pos, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(blade.uvs, 2));
  geo.setIndex(new THREE.BufferAttribute(blade.idx, 1));
  geo.setAttribute("aPos", new THREE.InstancedBufferAttribute(page.positions, 3));
  geo.setAttribute("aRand", new THREE.InstancedBufferAttribute(page.random, 4));
  geo.setAttribute("aClear", new THREE.InstancedBufferAttribute(page.clearance, 1));
  geo.instanceCount = page.count;
  geo.boundingSphere = new THREE.Sphere(
    new THREE.Vector3(page.bounds.cx, page.bounds.cy + 0.25, page.bounds.cz),
    page.bounds.radius,
  );
  return {
    id: page.id,
    geo,
    cx: page.bounds.cx,
    cy: page.bounds.cy,
    cz: page.bounds.cz,
    radius: page.bounds.radius,
    n: page.count,
  };
}

/* gustEnvelope and FROZEN_T moved to flora.ts (botanical pass): the flowers
   ride the same envelope and the same frozen instant, so there is exactly
   one definition of the weather. Their block comments moved with them. */

function GrassField({
  frozen,
  pages,
  night,
  dusk,
  cfg,
}: {
  frozen: boolean;
  pages: MeadowPage[];
  night: number;
  dusk: Dusk;
  cfg: GrassLayerCfg;
}) {
  const { camera } = useThree();
  const group = useRef<THREE.Group>(null);
  const meshes = useRef(new Map<string, THREE.Mesh>());
  const cache = useRef(new WeakMap<MeadowPage, GrassTile>());
  const ownedGeometries = useRef(new Set<THREE.InstancedBufferGeometry>());

  const tiles = useMemo(
    () =>
      pages
        .filter((page) => page.count >= 4)
        .map((page) => {
          const cached = cache.current.get(page);
          if (cached) return cached;
          const tile = materializeMeadowPage(page, cfg);
          cache.current.set(page, tile);
          ownedGeometries.current.add(tile.geo);
          return tile;
        }),
    [cfg, pages],
  );

  useEffect(
    () => () => {
      ownedGeometries.current.forEach((geometry) => geometry.dispose());
      ownedGeometries.current.clear();
      meshes.current.clear();
    },
    [],
  );

  const mat = useMemo(() => makeGrassMaterial(cfg), [cfg]);

  /* The light arc owns the sun; grass just follows it, so the meadow warms
     with everything else instead of staying stuck at noon. */
  useLayoutEffect(
    () =>
      dusk.add((d: number) => {
        const u = mat.uniforms;
        (u.uSunCol.value as THREE.Color).setHex(0xfff3dd).lerp(new THREE.Color("#ffc48c"), d);
        /* v1 warmed the tip toward #d8c07e at 0.75 strength — a genuine
           orange, and BRAND.md section 2 contains none. #bdb887 is the same
           move in muted sage-gold and stays inside the palette. */
        (u.uColTip.value as THREE.Color).setHex(0x93b06a).lerp(new THREE.Color("#9aa863"), d * 0.55);
        (u.uSunDir.value as THREE.Vector3)
          .copy(KEY)
          .lerp(new THREE.Vector3(-18, 7, 18).normalize(), d)
          .normalize();
        u.uSunI.value = 1.15 - d * 0.3;
      }),
    [dusk, mat]
  );

  useFrame(({ clock, scene }) => {
    const u = mat.uniforms;
    /* Both layers read the SAME clock, so the gust front that rolls through
       the hero blades rolls through the filler carpet in phase. Frozen holds
       the art-directed instant rather than t=0 — see FROZEN_T. */
    const t = frozen ? FROZEN_T : clock.elapsedTime;
    u.uTime.value = t;
    u.uGust.value = gustEnvelope(t);
    (u.uCamPos.value as THREE.Vector3).copy(camera.position);
    u.uNight.value = night;

    const cam = camera as THREE.PerspectiveCamera;
    if (cam.isPerspectiveCamera) {
      u.uProjScale.value = 1 / Math.tan((cam.fov * Math.PI) / 360);
    }
    const fog = scene.fog as THREE.Fog | null;
    if (fog) {
      (u.uFogColor.value as THREE.Color).copy(fog.color);
      u.uFogNear.value = fog.near;
      u.uFogFar.value = fog.far;
    }

    /* Per-tile LOD trim. Cost is a distance per tile per frame — nothing —
       and it is what turns "every blade, always" into "the blades you can
       actually see".

       Two v6 fixes, each worth six figures of submitted triangles per frame:
       · 3D distance, not XZ. The crest beat flies ~12 m above the meadow;
         in XZ the tiles under it read as distance 0 and submitted at full
         count while the shader (true 3D distance) was fading them.
       · pad 0.02, not the full fade band. Blades with seed >= p are fully
         hidden by the shader, and the sort means truncating at ceil(p*n)
         removes exactly those — the old +0.16 pad resubmitted 16% of every
         far tile as degenerate zero-height triangles, forever. The small pad
         only covers seed-uniformity noise at the truncation edge. */
    const cx = camera.position.x;
    const cy = camera.position.y;
    const cz = camera.position.z;
    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i];
      const m = meshes.current.get(t.id);
      if (!m) continue;
      const dx = cx - t.cx;
      const dy = cy - t.cy;
      const dz = cz - t.cz;
      const d = Math.max(0, Math.sqrt(dx * dx + dy * dy + dz * dz) - t.radius);
      const kf = keepFraction(cfg, d);
      /* A tile fully past its fade (pmin 0 layers) has every blade at zero
         height in the shader — but the 0.02 pad still submitted ~2% of its
         instances AND a whole draw call per tile, which at 6 m filler tiles
         was ~40 dead draws per beat. Fully-faded means fully hidden. */
      if (kf <= 0.001) {
        m.visible = false;
        continue;
      }
      const keep = Math.min(1, kf + 0.02);
      const count = Math.ceil(keep * t.n);
      if (count < 2) {
        m.visible = false;
      } else {
        m.visible = true;
        t.geo.instanceCount = count;
      }
    }
  });

  return (
    <group ref={group}>
      {tiles.map((t) => (
        <mesh
          key={t.id}
          geometry={t.geo}
          material={mat}
          frustumCulled
          ref={(el) => {
            if (el) meshes.current.set(t.id, el);
            else meshes.current.delete(t.id);
          }}
        />
      ))}
    </group>
  );
}

/* ========================== ENTRANCE STEPS ==========================
   A proper flight up to the front door — timber treads on steel stringers,
   with a glass cheek so it belongs to the same building as the deck.
=================================================================== */

function EntranceSteps({ glassRail }: { glassRail: THREE.Material }) {
  const cedar = ["#a97e57", "#9b7350", "#b0855e"];
  const grain = useMemo(() => makeWoodGrain(), []);
  /* The flight's footprint is shared with the clearance mask: move a tread
     here and the rect that keeps grass off it moves with it. */
  const N = STEPS_TREADS.count;
  return (
    <group position={[STEPS_TREADS.originX, 0, STEPS_TREADS.originZ]}>
      {Array.from({ length: N }, (_, i) => {
        const y = ENTRANCE_FLIGHT.topY - (i + 1) * ENTRANCE_FLIGHT.rise;
        const z = (i + 1) * STEPS_TREADS.treadDepth;
        return (
          <group key={i}>
            <mesh castShadow receiveShadow position={[0, y, z]}>
              <boxGeometry args={[STEPS_TREADS.width, 0.1, STEPS_TREADS.treadDepth]} />
              <meshStandardMaterial map={grain} color={cedar[i % 3]} roughness={0.85} flatShading />
            </mesh>
            <mesh position={[0, y - ENTRANCE_FLIGHT.riserDrop, z]} castShadow>
              {/* the riser board under each tread carries its own inset size */}
              <boxGeometry
                args={[
                  ENTRANCE_FLIGHT.riserWidth,
                  ENTRANCE_FLIGHT.riserThickness,
                  ENTRANCE_FLIGHT.riserDepth,
                ]}
              />
              <meshStandardMaterial color="#6d523c" roughness={0.9} flatShading />
            </mesh>
          </group>
        );
      })}
      {/* stringers */}
      {ENTRANCE_FLIGHT.stringerX.map((x, i) => (
        <mesh
          key={i}
          castShadow
          position={[x, ENTRANCE_FLIGHT.stringerY, ENTRANCE_FLIGHT.flankZ]}
          rotation={[ENTRANCE_FLIGHT.rake, 0, 0]}
        >
          <boxGeometry
            args={[ENTRANCE_FLIGHT.stringerWidth, ENTRANCE_FLIGHT.stringerHeight, ENTRANCE_FLIGHT.flankLength]}
          />
          <meshStandardMaterial color="#5d6663" roughness={0.5} metalness={0.55} />
        </mesh>
      ))}
      {/* Glass cheeks, matching the deck balustrade. These are the widest part
          of the flight, so ENTRANCE_FLIGHT_FOOTPRINT — the rect the mask has
          to cover — is measured from them and not from the treads. */}
      {ENTRANCE_FLIGHT.cheekX.map((x, i) => (
        <mesh
          key={`g${i}`}
          material={glassRail}
          position={[x, ENTRANCE_FLIGHT.cheekY, ENTRANCE_FLIGHT.flankZ]}
          rotation={[ENTRANCE_FLIGHT.rake, 0, 0]}
          renderOrder={20}
        >
          <boxGeometry
            args={[ENTRANCE_FLIGHT.cheekThickness, ENTRANCE_FLIGHT.cheekHeight, ENTRANCE_FLIGHT.flankLength]}
          />
        </mesh>
      ))}
    </group>
  );
}

/* ============================== HAMMOCK =============================
   Slung between two posts in the lounge, west of the fire pit. The bed is a
   real catenary — sampled cosh, not a bent plane — because the eye knows
   the difference immediately.
=================================================================== */

function Hammock({ frozen }: { frozen: boolean }) {
  const swing = useRef<THREE.Group>(null);
  const A: [number, number, number] = [-7.5, 0, 8.6];
  const B: [number, number, number] = [-5.0, 0, 10.3];
  const gA = terrainH(A[0], A[2]);
  const gB = terrainH(B[0], B[2]);

  const geo = useMemo(() => {
    const dx = B[0] - A[0];
    const dz = B[2] - A[2];
    const span = Math.hypot(dx, dz);
    const SEG = 22;
    const W = 0.62;
    const sag = 0.42;
    const pos: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i <= SEG; i++) {
      const t = i / SEG;
      const u = (t - 0.5) * 2; // -1..1
      const y = (Math.cosh(u * 1.35) - Math.cosh(1.35)) / (1 - Math.cosh(1.35)) * -sag;
      const belly = 1 - Math.abs(u) * 0.22;
      pos.push(-W * belly, y, (t - 0.5) * span);
      pos.push(W * belly, y, (t - 0.5) * span);
    }
    for (let i = 0; i < SEG; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }, [A, B]);

  useFrame(({ clock }) => {
    if (frozen || !swing.current) return;
    swing.current.rotation.z = Math.sin(clock.elapsedTime * 0.55) * 0.035;
  });

  const cx = (A[0] + B[0]) / 2;
  const cz = (A[2] + B[2]) / 2;
  const ang = Math.atan2(B[0] - A[0], B[2] - A[2]);

  return (
    <group>
      {/* posts */}
      {[
        [A[0], gA],
        [B[0], gB],
      ].map(([x, g], i) => (
        <mesh key={i} castShadow position={[x, g + 0.85, i === 0 ? A[2] : B[2]]}>
          <cylinderGeometry args={[0.07, 0.09, 1.7, 7]} />
          <meshStandardMaterial color="#7a6248" roughness={0.9} flatShading />
        </mesh>
      ))}
      <group ref={swing} position={[cx, (gA + gB) / 2 + 1.28, cz]} rotation={[0, ang, 0]}>
        <mesh geometry={geo} castShadow receiveShadow>
          <meshStandardMaterial color="#d9cdb4" roughness={0.95} side={THREE.DoubleSide} flatShading />
        </mesh>
      </group>
    </group>
  );
}

/* NETTING (NetLounge + useNetTexture) removed Aug 14, 2026 at the founder's
   request: the sagging net plane sat at deck height off the west shoulder
   and its middle dipped below the walking surface, visibly clipping through
   the boards. The hammock keeps the soft-fabric role. History: c0108fd^. */

/* =============================== MOOSE ==============================
   Low-poly, in the scene's own faceted language. Two of them, well out in
   the meadow — one grazing, one standing — because a moose at the fire pit
   would read as a petting zoo rather than the Rockies.
=================================================================== */

function Moose({
  position,
  rotY = 0,
  scale = 1,
  graze = false,
  frozen,
}: {
  position: [number, number];
  rotY?: number;
  scale?: number;
  graze?: boolean;
  frozen: boolean;
}) {
  const head = useRef<THREE.Group>(null);
  const y = terrainH(position[0], position[1]);
  const hide = "#4a3526";
  const dark = "#33241a";

  useFrame(({ clock }) => {
    if (frozen || !head.current) return;
    const t = clock.elapsedTime;
    // grazers dip; standers just look around slowly
    head.current.rotation.x = graze
      ? 0.55 + Math.sin(t * 0.45) * 0.42
      : Math.sin(t * 0.3) * 0.09;
    head.current.rotation.y = graze ? 0 : Math.sin(t * 0.21) * 0.3;
  });

  return (
    <group position={[position[0], y, position[1]]} rotation={[0, rotY, 0]} scale={scale}>
      {/* barrel */}
      <mesh castShadow position={[0, 1.42, 0]}>
        <boxGeometry args={[0.62, 0.78, 1.62]} />
        <meshStandardMaterial color={hide} roughness={0.95} flatShading />
      </mesh>
      {/* shoulder hump — the moose tell */}
      <mesh castShadow position={[0, 1.86, 0.42]}>
        <boxGeometry args={[0.5, 0.3, 0.66]} />
        <meshStandardMaterial color={hide} roughness={0.95} flatShading />
      </mesh>
      {/* legs */}
      {([[-0.22, 0.62], [0.22, 0.62], [-0.22, -0.58], [0.22, -0.58]] as [number, number][]).map(([x, z], i) => (
        <mesh key={i} castShadow position={[x, 0.62, z]}>
          <boxGeometry args={[0.13, 1.24, 0.15]} />
          <meshStandardMaterial color={dark} roughness={0.95} flatShading />
        </mesh>
      ))}
      {/* neck + head, animated */}
      <group ref={head} position={[0, 1.86, 0.78]}>
        <mesh castShadow position={[0, 0.12, 0.2]} rotation={[0.5, 0, 0]}>
          <boxGeometry args={[0.3, 0.62, 0.3]} />
          <meshStandardMaterial color={hide} roughness={0.95} flatShading />
        </mesh>
        <mesh castShadow position={[0, 0.36, 0.56]} rotation={[0.34, 0, 0]}>
          <boxGeometry args={[0.26, 0.28, 0.66]} />
          <meshStandardMaterial color={dark} roughness={0.95} flatShading />
        </mesh>
        {/* bell */}
        <mesh position={[0, 0.16, 0.5]}>
          <boxGeometry args={[0.1, 0.24, 0.1]} />
          <meshStandardMaterial color={dark} roughness={0.95} flatShading />
        </mesh>
        {/* palmate antlers */}
        {[-1, 1].map((s) => (
          <group key={s} position={[s * 0.2, 0.5, 0.42]} rotation={[0, 0, s * 0.5]}>
            <mesh castShadow position={[s * 0.16, 0.06, 0]}>
              <boxGeometry args={[0.42, 0.07, 0.34]} />
              <meshStandardMaterial color="#b9a888" roughness={0.85} flatShading />
            </mesh>
            {[0, 1, 2].map((k) => (
              <mesh key={k} castShadow position={[s * (0.3 + k * 0.06), 0.16, -0.1 + k * 0.12]}>
                <boxGeometry args={[0.05, 0.17, 0.05]} />
                <meshStandardMaterial color="#b9a888" roughness={0.85} flatShading />
              </mesh>
            ))}
          </group>
        ))}
      </group>
    </group>
  );
}

/* ========================== OUTDOOR LIGHTING ========================
   Bollards along the path and two wall washers on the deck. The emissive
   lifts with dusk through the same registry the rest of the scene uses, so
   nothing has its own idea of what time it is. Only ONE of them carries a
   real point light — the rest are emissive geometry, which is the whole
   trick for keeping a lit night scene cheap.
=================================================================== */

function Bollard({ position, night }: { position: [number, number]; night: number }) {
  const y = terrainH(position[0], position[1]);
  return (
    <group position={[position[0], y, position[1]]}>
      <mesh castShadow position={[0, 0.32, 0]}>
        <cylinderGeometry args={[0.045, 0.06, 0.64, 7]} />
        <meshStandardMaterial color="#454d4a" roughness={0.6} metalness={0.4} />
      </mesh>
      <mesh position={[0, 0.66, 0]}>
        <cylinderGeometry args={[0.075, 0.075, 0.09, 8]} />
        <meshStandardMaterial
          color="#ffe9c2"
          emissive="#ffca7a"
          emissiveIntensity={0.25 + night * 2.4}
          roughness={0.4}
        />
      </mesh>
    </group>
  );
}

function OutdoorLighting({ night }: { night: number }) {
  const pts: [number, number][] = [
    [1.5, 8.2],
    [2.4, 10.0],
    [3.2, 11.9],
    [-2.4, 8.4],
    [-3.6, 10.2],
    [6.9, 6.6],
  ];
  return (
    <group>
      {pts.map((p, i) => (
        <Bollard key={i} position={p} night={night} />
      ))}
      {/* the one real light: a warm pool over the steps */}
      <pointLight position={[0.05, 1.5, 7.4]} color="#ffcf95" intensity={night * 3.2} distance={9} decay={2} />
      {/* deck wall-washers, emissive only */}
      {([[-3.2, 1.15, 6.0], [3.1, 1.15, 6.0]] as [number, number, number][]).map((p, i) => (
        <mesh key={`w${i}`} position={p}>
          <boxGeometry args={[0.14, 0.06, 0.14]} />
          <meshStandardMaterial
            color="#ffe9c2"
            emissive="#ffb86b"
            emissiveIntensity={0.2 + night * 2.6}
            roughness={0.5}
          />
        </mesh>
      ))}
    </group>
  );
}

/* ============================= TUB STEAM ============================
   A denser, slower plume than the generic smoke — steam off water behaves
   differently from woodsmoke: it rises slower, spreads wider, and dies
   faster. Two overlapping rates so it never looks like a loop.
=================================================================== */

function TubSteam({ frozen }: { frozen: boolean }) {
  const tex = useGradientSprite([
    [0, "rgba(244,248,247,0.62)"],
    [0.45, "rgba(244,248,247,0.24)"],
    [1, "rgba(244,248,247,0)"],
  ]);
  const refs = useRef<(THREE.Sprite | null)[]>([]);
  const N = 9;
  useFrame(({ clock }) => {
    if (frozen) return;
    const t = clock.elapsedTime;
    refs.current.forEach((s, i) => {
      if (!s) return;
      const rate = i % 2 === 0 ? 0.17 : 0.115;
      const life = (t * rate + i / N) % 1;
      s.position.set(
        TUB_CENTER.x + Math.sin(t * 0.6 + i * 1.7) * 0.26 * life * 2.2,
        1.02 + life * 1.9,
        TUB_CENTER.z + Math.cos(t * 0.44 + i * 1.1) * 0.22 * life * 2
      );
      const sc = 0.3 + life * 1.5;
      s.scale.set(sc, sc, 1);
      (s.material as THREE.SpriteMaterial).opacity = 0.3 * clamp01(life / 0.1) * Math.pow(1 - life, 1.9);
    });
  });
  return (
    <group>
      {Array.from({ length: N }, (_, i) => (
        <sprite
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          position={[TUB_CENTER.x, 1.02, TUB_CENTER.z]}
        >
          <spriteMaterial map={tex} transparent opacity={0.3} depthWrite={false} />
        </sprite>
      ))}
    </group>
  );
}

/* ============================== SCRUB ===============================
   Low bush clumps from the edge of the mown ring out to the fog line.

   They exist because of what the grass LOD cannot do. Per-blade grass has
   to stop somewhere — the honest limit is around 35 m, past which a blade
   is smaller than a texel and can only alias. v1 simply ended there, and
   the result was a bare plane behind a straight line. Scrub is the layer
   that carries the eye across that limit: 130 squashed icosahedra, three
   sage values, three instanced draw calls, planted on the same terrain
   function as everything else so nothing floats.
=================================================================== */

const SCRUB_COLORS = ["#5c7a55", "#6b8a5e", "#4e6b4b"];

function Scrub() {
  const geo = useMemo(() => {
    const g = new THREE.IcosahedronGeometry(1, 0);
    g.scale(1, 0.58, 1);
    return g;
  }, []);

  const buckets = useMemo(() => {
    const out: THREE.Matrix4[][] = [[], [], []];
    const o = new THREE.Object3D();
    let k = 0;
    for (let i = 0; i < 3000 && k < 130; i++) {
      const a = rand(i, 81) * Math.PI * 2;
      const r = 19 + Math.pow(rand(i, 82), 0.62) * 42;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      // the camera never goes behind the home, so nothing is spent there
      if (z < -10 && Math.abs(x) < 26) continue;
      const s = 0.42 + Math.pow(rand(i, 83), 1.4) * 1.5;
      o.position.set(x, terrainH(x, z) + s * 0.34, z);
      o.rotation.set((rand(i, 84) - 0.5) * 0.34, rand(i, 85) * 6.2832, (rand(i, 86) - 0.5) * 0.34);
      o.scale.set(s * (0.8 + rand(i, 87) * 0.7), s, s * (0.8 + rand(i, 88) * 0.7));
      o.updateMatrix();
      out[k % 3].push(o.matrix.clone());
      k++;
    }
    return out;
  }, []);

  return (
    <group>
      {buckets.map((mats, b) => (
        <ScrubBucket key={b} geo={geo} mats={mats} color={SCRUB_COLORS[b]} />
      ))}
    </group>
  );
}

function ScrubBucket({
  geo,
  mats,
  color,
}: {
  geo: THREE.BufferGeometry;
  mats: THREE.Matrix4[];
  color: string;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    mats.forEach((mat, i) => m.setMatrixAt(i, mat));
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
  }, [mats]);
  return (
    <instancedMesh ref={ref} args={[geo, undefined, Math.max(1, mats.length)]} castShadow receiveShadow>
      <meshStandardMaterial color={color} roughness={1} flatShading />
    </instancedMesh>
  );
}

/* ======================== OFFLINE MEADOW ATLAS ======================
   Hero blades stay live geometry because their silhouettes matter close to
   the camera. Everything else is authored offline into alpha-cut clumps and
   flowers. Thousands of botanical clusters therefore remain one draw call,
   one material program, and zero runtime canvas rasterisation.
=================================================================== */

const MEADOW_ATLAS_ALPHA_TEST = 0.42;
const MEADOW_ATLAS_MAGIC = "AURAMDW1";
const MEADOW_ATLAS_HEADER_BYTES = 24;
const MEADOW_ATLAS_STRIDE_BYTES = 48;

type MeadowAtlasResource = {
  geometry: THREE.InstancedBufferGeometry;
  material: THREE.MeshBasicMaterial;
  texture: THREE.Texture;
  /* MeshBasicMaterial exposes no uniforms handle; these are the objects
     merged into the compiled program via onBeforeCompile, shared by
     reference so MeadowAtlasField can drive the wind clock per frame. */
  windUniforms: {
    uTime: { value: number };
    uWindDir: { value: THREE.Vector2 };
    uGust: { value: number };
  };
};

function meadowAtlasBaseGeometry(): {
  positions: Float32Array;
  uvs: Float32Array;
  indices: Uint16Array;
} {
  /* Two crossed cards keep a cluster legible from every story camera. They
     remain one indexed geometry and therefore one draw/program. */
  return {
    positions: new Float32Array([
      -0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0,
      0, 0, -0.5, 0, 0, 0.5, 0, 1, 0.5, 0, 1, -0.5,
    ]),
    uvs: new Float32Array([
      0, 0, 1, 0, 1, 1, 0, 1,
      0, 0, 1, 0, 1, 1, 0, 1,
    ]),
    indices: new Uint16Array([
      0, 1, 2, 0, 2, 3,
      4, 5, 6, 4, 6, 7,
    ]),
  };
}

function decodeMeadowAtlas(buffer: ArrayBuffer, texture: THREE.Texture): MeadowAtlasResource {
  const view = new DataView(buffer);
  const magic = new TextDecoder().decode(new Uint8Array(buffer, 0, 8));
  const version = view.getUint32(8, true);
  const count = view.getUint32(12, true);
  const stride = view.getUint32(16, true);
  if (magic !== MEADOW_ATLAS_MAGIC || version !== 1 || stride !== MEADOW_ATLAS_STRIDE_BYTES) {
    throw new Error("Unsupported Aura meadow atlas");
  }
  if (buffer.byteLength !== MEADOW_ATLAS_HEADER_BYTES + count * stride) {
    throw new Error("Aura meadow atlas length mismatch");
  }

  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count * 2);
  const yaws = new Float32Array(count);
  const uvRects = new Float32Array(count * 4);
  const seeds = new Float32Array(count);
  let renderedCount = 0;

  for (let index = 0; index < count; index += 1) {
    const offset = MEADOW_ATLAS_HEADER_BYTES + index * stride;
    const x = view.getFloat32(offset, true);
    const y = view.getFloat32(offset + 4, true);
    const z = view.getFloat32(offset + 8, true);
    const width = view.getFloat32(offset + 12, true);
    const height = view.getFloat32(offset + 16, true);
    const sourceKind = view.getFloat32(offset + 40, true);
    const seed = view.getFloat32(offset + 44, true);
    /* Version-one mixed atlases may remain in an HTTP cache during an atomic
       release. Preserve every proven placement, but deterministically remap
       legacy flower slots onto one of the six grass cells. The real instanced
       FlowerField below is therefore the only rendered flower source. */
    const mappedGrassCell = Math.min(5, Math.floor(seed * 6));
    const mappedColumn = mappedGrassCell % 4;
    const mappedRow = Math.floor(mappedGrassCell / 4);
    positions.set([x, y, z], renderedCount * 3);
    sizes.set([width, height], renderedCount * 2);
    yaws[renderedCount] = view.getFloat32(offset + 20, true);
    uvRects.set([
      sourceKind === 0 ? view.getFloat32(offset + 24, true) : mappedColumn / 4,
      sourceKind === 0 ? view.getFloat32(offset + 28, true) : mappedRow / 2,
      view.getFloat32(offset + 32, true),
      view.getFloat32(offset + 36, true),
    ], renderedCount * 4);
    seeds[renderedCount] = seed;
    renderedCount += 1;
  }

  const base = meadowAtlasBaseGeometry();
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(base.positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(base.uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(base.indices, 1));
  geometry.setAttribute("aAtlasPos", new THREE.InstancedBufferAttribute(positions, 3));
  geometry.setAttribute("aAtlasSize", new THREE.InstancedBufferAttribute(sizes, 2));
  geometry.setAttribute("aAtlasYaw", new THREE.InstancedBufferAttribute(yaws, 1));
  geometry.setAttribute("aAtlasUv", new THREE.InstancedBufferAttribute(uvRects, 4));
  geometry.setAttribute("aAtlasSeed", new THREE.InstancedBufferAttribute(seeds, 1));
  geometry.instanceCount = renderedCount;
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.6, 22), 76);

  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;

  const material = new THREE.MeshBasicMaterial({
    map: texture,
    alphaTest: MEADOW_ATLAS_ALPHA_TEST,
    transparent: false,
    depthWrite: true,
    side: THREE.DoubleSide,
    fog: true,
    toneMapped: true,
  });
  material.name = "aura-meadow-atlas-material";
  /* The atlas cards share the live meadow's ONE wind clock (flora.ts):
     same travelling/crossWave/ripple phases, same gust envelope, phase
     keyed on each card's world position so a gust front crosses baked and
     live blades together. Root stays planted (bend ∝ y², y is 0..1 in the
     base card); a slight arc-down keeps swaying tips from stretching. */
  const windUniforms = {
    uTime: { value: FROZEN_T },
    uWindDir: { value: WIND_DIR.clone() },
    uGust: { value: gustEnvelope(FROZEN_T) },
  };
  material.customProgramCacheKey = () => "aura-meadow-atlas-v2";
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = windUniforms.uTime;
    shader.uniforms.uWindDir = windUniforms.uWindDir;
    shader.uniforms.uGust = windUniforms.uGust;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>
attribute vec3 aAtlasPos;
attribute vec2 aAtlasSize;
attribute float aAtlasYaw;
attribute vec4 aAtlasUv;
attribute float aAtlasSeed;
uniform float uTime;
uniform vec2 uWindDir;
uniform float uGust;`)
      .replace("#include <uv_vertex>", `#ifdef USE_MAP
  vMapUv = ( mapTransform * vec3( aAtlasUv.xy + uv * aAtlasUv.zw, 1 ) ).xy;
#endif`)
      .replace("#include <begin_vertex>", `vec3 atlasLocal = position;
atlasLocal.xz *= aAtlasSize.x;
atlasLocal.y *= aAtlasSize.y;
float atlasTurn = aAtlasYaw + (aAtlasSeed - 0.5) * 0.08;
float atlasCos = cos(atlasTurn);
float atlasSin = sin(atlasTurn);
vec3 transformed = vec3(
  atlasLocal.x * atlasCos - atlasLocal.z * atlasSin,
  atlasLocal.y,
  atlasLocal.x * atlasSin + atlasLocal.z * atlasCos
) + aAtlasPos;
float windPh = aAtlasSeed * 6.2831853;
float windTravelling = sin(uTime * 0.62 - dot(aAtlasPos.xz, uWindDir) * 0.135);
float windCross = sin(uTime * 0.41 + aAtlasPos.x * 0.082 - aAtlasPos.z * 0.057 + windPh);
float windRipple = sin(uTime * 1.85 + aAtlasPos.x * 0.31 + aAtlasPos.z * 0.23 + windPh * 0.5);
float windSway = windTravelling * 0.62 + windCross * 0.30 + windRipple * 0.08;
float windBendT = position.y * position.y;
float windAmp = (0.34 + 0.66 * uGust) * aAtlasSize.y * 0.16;
transformed.xz += uWindDir * windBendT * windSway * windAmp;
transformed.y -= windBendT * abs(windSway) * windAmp * 0.18;`);
  };

  return {
    geometry,
    material,
    texture,
    windUniforms,
  };
}

function MeadowAtlasField({
  frozen,
  night,
  dusk,
  onReady,
}: {
  frozen: boolean;
  night: number;
  dusk: Dusk;
  onReady: () => void;
}) {
  const { gl, invalidate } = useThree();
  const [resource, setResource] = useState<MeadowAtlasResource | null>(null);
  const [failed, setFailed] = useState(false);
  const readySent = useRef(false);

  useEffect(() => {
    let disposed = false;
    let next: MeadowAtlasResource | null = null;
    Promise.all([
      fetch(withBase("/textures/meadow-atlas.bin")).then((response) => {
        if (!response.ok) throw new Error(`Meadow atlas data ${response.status}`);
        return response.arrayBuffer();
      }),
      new THREE.TextureLoader().loadAsync(withBase("/textures/meadow-atlas.png")),
    ])
      .then(([buffer, texture]) => {
        next = decodeMeadowAtlas(buffer, texture);
        texture.anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy());
        if (disposed) {
          next.geometry.dispose();
          next.material.dispose();
          next.texture.dispose();
          return;
        }
        setResource(next);
        invalidate();
      })
      .catch(() => {
        if (!disposed) setFailed(true);
      });
    return () => {
      disposed = true;
      next?.geometry.dispose();
      next?.material.dispose();
      next?.texture.dispose();
    };
  }, [gl, invalidate]);

  useEffect(() => {
    if ((!resource && !failed) || readySent.current) return;
    readySent.current = true;
    onReady();
  }, [failed, onReady, resource]);

  useLayoutEffect(() => {
    if (!resource) return undefined;
    return dusk.add((amount: number) => {
      resource.material.color
        .setHex(0xffffff)
        .lerp(new THREE.Color("#d7cfaa"), amount * 0.28)
        .multiplyScalar(1 - night * 0.32);
    });
  }, [dusk, night, resource]);

  /* One clock for the whole meadow: reduced motion holds the baked cards at
     the same art-directed FROZEN_T instant as the live blades and flowers. */
  useFrame(({ clock }) => {
    if (!resource) return;
    const t = frozen ? FROZEN_T : clock.elapsedTime;
    resource.windUniforms.uTime.value = t;
    resource.windUniforms.uGust.value = gustEnvelope(t);
  });

  if (!resource) return null;
  return (
    <group name="aura-grass-atlas-field">
      <mesh
        name="aura-meadow-atlas"
        geometry={resource.geometry}
        material={resource.material}
        frustumCulled
        renderOrder={1}
      />
    </group>
  );
}

/* The real, one-draw wildflower field from the last known-good botanical
   release. Its patch sampler, coarse-cell species clustering, clearance and
   wind clock are intentionally kept separate from the grass atlas. */
const FLORA_SAMPLE: FloraSample = {
  ground: terrainH,
  density: meadowDensity,
  clearance: (x, z) => clearance(x, z),
};

function FlowerField({
  frozen,
  night,
  dusk,
  rich,
  count,
}: {
  frozen: boolean;
  night: number;
  dusk: Dusk;
  rich: boolean;
  count: number;
}) {
  const { camera } = useThree();
  const built = useMemo(() => buildFlowerField(count, rich, FLORA_SAMPLE), [count, rich]);
  const mat = useMemo(() => makeFlowerMaterial(), []);
  const lastVisibility = useRef(-1);
  const lastVisibilityAt = useRef(-1);

  useEffect(() => () => {
    built?.geo.dispose();
    mat.dispose();
  }, [built, mat]);

  useLayoutEffect(
    () =>
      dusk.add((amount: number) => {
        const uniforms = mat.uniforms;
        (uniforms.uSunCol.value as THREE.Color)
          .setHex(0xfff3dd)
          .lerp(new THREE.Color("#ffc48c"), amount);
        (uniforms.uSunDir.value as THREE.Vector3)
          .copy(KEY)
          .lerp(new THREE.Vector3(-18, 7, 18).normalize(), amount)
          .normalize();
        uniforms.uSunI.value = 1.15 - amount * 0.3;
      }),
    [dusk, mat],
  );

  const countVisibleFlowerHeads = useCallback(() => {
    if (!built) return 0;
    const roots = built.geo.getAttribute("aPos") as THREE.InstancedBufferAttribute;
    const instances = built.geo.getAttribute("aInst") as THREE.InstancedBufferAttribute;
    const root = new THREE.Vector3();
    const head = new THREE.Vector3();
    let visible = 0;
    for (let index = 0; index < built.placed; index += 1) {
      root.set(roots.getX(index), roots.getY(index), roots.getZ(index));
      const distance = root.distanceTo(camera.position);
      const renderedHeight = flowerVisibilityAtDistance(distance, instances.getW(index));
      if (renderedHeight <= 0.01) continue;
      head.copy(root);
      head.y += instances.getY(index) * renderedHeight;
      head.project(camera);
      if (head.z >= -1 && head.z <= 1 && Math.abs(head.x) <= 1 && Math.abs(head.y) <= 1) visible += 1;
    }
    return visible;
  }, [built, camera]);

  useFrame(({ clock, scene }) => {
    if (!built) return;
    const time = frozen ? FROZEN_T : clock.elapsedTime;
    const uniforms = mat.uniforms;
    uniforms.uTime.value = time;
    uniforms.uGust.value = gustEnvelope(time);
    (uniforms.uCamPos.value as THREE.Vector3).copy(camera.position);
    uniforms.uNight.value = night;
    const fog = scene.fog as THREE.Fog | null;
    if (fog) {
      (uniforms.uFogColor.value as THREE.Color).copy(fog.color);
      uniforms.uFogNear.value = fog.near;
      uniforms.uFogFar.value = fog.far;
    }

    if (clock.elapsedTime - lastVisibilityAt.current < 0.2) return;
    lastVisibilityAt.current = clock.elapsedTime;
    const visible = countVisibleFlowerHeads();
    if (visible === lastVisibility.current) return;
    lastVisibility.current = visible;
    window.dispatchEvent(new CustomEvent("aura:flower-visibility", {
      detail: { visible, planted: built.placed, source: "instanced-flower-field" },
    }));
  });

  if (!built) return null;
  return (
    <group name="aura-flower-field">
      <mesh
        name="aura-instanced-flower-field"
        geometry={built.geo}
        material={mat}
        frustumCulled
      />
    </group>
  );
}

/* ============================ THE LAYER ============================= */

export default function SceneDetail({
  frozen,
  night,
  glassRail,
  dusk,
  qualityScale = 1,
  includeMeadow = true,
  lite = false,
  lowPower = false,
  releaseMeadowPromotion = false,
  onMeadowReady,
}: {
  frozen: boolean;
  night: number;
  glassRail: THREE.Material;
  dusk: Dusk;
  qualityScale?: number;
  /** Grass is the final progressive stage so it can never hold the first
   * interactive frame hostage. The terrain already carries a complete,
   * authored meadow surface while these instances are prepared. */
  includeMeadow?: boolean;
  /** Uses the authored low-poly ridge and a reduced meadow population on the
   * automatic landing path. Rich snow terrain and amenities remain reserved
   * for deliberate high-quality rendering. */
  lite?: boolean;
  /** Capability-derived constraint, distinct from the temporary balanced
   * opening shader cap used even on capable desktops. */
  lowPower?: boolean;
  releaseMeadowPromotion?: boolean;
  onMeadowReady?: () => void;
}) {
  /* Blade budget by device. A phone draws the whole meadow a few centimetres
     across, so blades past a few thousand are texels it physically cannot
     resolve — and it is the device least able to afford them. */
  /* GRASS IS OFF, and this is a considered verdict rather than a punt.

     Three implementations were built and shot: single-triangle blades, then
     proper 7-vertex bending blades with three-layer vertex-shader wind, then
     the same tuned right down to 5-9 cm wide, 6,000 instances, coloured
     LIGHTER than the terrain. All three read as dark speckle on the meadow
     in the render, and all three looked worse than the clean vertex-coloured
     ground this scene already had.

     The reason is the art direction, not the shader. This world is large
     flat-shaded low-poly forms, and the camera flies 5-15 m above a meadow
     it crosses in seven beats. At that distance an individual blade covers
     about a pixel, so it can only ever alias — it adds noise, not texture.
     Per-blade grass belongs to a camera that gets down into it.

     What WOULD work here, if it is wanted: treat the meadow as a SURFACE,
     not a population — a detail/noise texture on the terrain material with
     the same three-layer wind panning through its UVs, which stays coherent
     at any distance and costs one texture fetch. That is a different
     feature and it should be built deliberately, not smuggled in here.

     `GrassField` and `bladeGeometry` are kept in the file, working and
     documented, so that decision can be revisited without redoing research. */
  /* Density, not count, is what makes grass read. The reference runs ~49
     blades/m2; this ring is ~660 m2, so 34k desktop lands in the same place.
     Mobile draws the meadow a few centimetres across, so a third of that is
     indistinguishable and much kinder to the GPU. */
  const { size, invalidate } = useThree();
  /* The footprint grew from ~660 m2 to a feathered field that reaches the
     fog line, so the count grew with it — but only by half. The rest of the
     coverage comes from taller far blades and from Scrub, which is far
     cheaper per square metre than instancing more grass out there would be.
     Measured, not assumed: see the fps figures in the round-1 report. */
  /* Density is the whole game. The reference plants 16,000 blades per 18 m
     tile — ~49 blades/m2 — and that is the threshold at which blades stop
     reading as separate objects and become a surface. 48k spread across this
     meadow was roughly a third of that, which is exactly why it read as
     sparse scatter no matter how good the blade itself was. */
  /* The founder's x4, then his x3 on top of it: 96k planted blades grew to
     1.04M on desktop — 120k full 7-tri hero blades (the silhouette) + 920k
     single-triangle short filler (the carpet; see the layer comments above
     G_HERO/G_FILL). The split is what keeps it inside the ~1.3M worst-beat
     triangle budget: density lives in the near field where the eye judges
     coverage, not in the fog wash. Mobile keeps its ~35% proportion. */
  /* v9: the founder's "4x the grass in close proximity" round. Brute count
     was impossible (v8's worst beat already sat 40k tris under the 1.35M
     ceiling), so v9 closes the ground with the three cheap levers — deeper
     sward-green terrain under the meadow (zero tris), wider filler blades
     (zero tris), jittered-grid spacing so the same count leaves no voids
     (zero tris) — and spends the actual headroom here: +60k filler blades
     (1 tri each; the near-band LOD submits roughly half at the worst beat). */
  /* v10: "double it, just down around the house." The planted TOTAL holds at
     the same budget — the yard-boost mask in buildGrassTiles doubles the
     blades in the ring the close beats frame, and the far-trim (radial
     26-36 -> 20-30 m) hands back the instances to pay for it, so the worst
     beat stays under the 1.35M ceiling. Measured per beat in
     C:\tmp\aura-shots\metrics (label v10-*), not assumed. */
  /* 870k with the v10 mask measured OVER ceiling (crest 1.412M): the far
     trim shrinks the mask's effective area E, and budget/E redistributes the
     freed instances into the mid-ring the crest camera stares at. 780k puts
     the BASE density back at v9 levels — the doubling stays where it was
     aimed (the yard), paid for by the far field, not by new instances. */
  const mobile = size.width < 820;
  const [grassProgramReady, setGrassProgramReady] = useState(false);
  const [meadowAtlasReady, setMeadowAtlasReady] = useState(false);
  const handleGrassProgramReady = useCallback(() => setGrassProgramReady(true), []);
  /* One painted frame separates the atlas's program compile + texture
     upload from the first meadow page window. Without this gap the ~112 ms
     one-time compile RACED the worker's page integration; when it landed
     inside a page window the governor froze a healthy meadow at its opening
     floor. Deterministic ordering replaces the race: atlas terminal (loaded
     or failed) → one frame paints (the compile) → pages begin. */
  const handleMeadowAtlasReady = useCallback(() => {
    requestAnimationFrame(() => requestAnimationFrame(() => setMeadowAtlasReady(true)));
  }, []);
  const meadow = useProgressiveMeadow({
    enabled: includeMeadow && grassProgramReady && meadowAtlasReady,
    width: size.width,
    reducedMotion: frozen,
    lowPower: mobile || lowPower,
    releaseAfterReady: releaseMeadowPromotion,
    invalidate,
  });
  useEffect(() => {
    if (meadow.ready && meadowAtlasReady) onMeadowReady?.();
  }, [meadow.ready, meadowAtlasReady, onMeadowReady]);
  /* Founder "ridiculously good and smooth, no spacing" round: the filler
     count climbs (desktop 715k -> 980k, mobile 250k -> 340k) AND the far
     reach tightens (below) so the extra blades all land where the eye judges
     coverage — the first ~22 m the story cameras sit in. Paired with wider
     blades, a relaxed near-field height gate, and a deeper ground shade, the
     near field reads as one closed sward instead of separable spikes. */
  /* Flowers (botanical pass): rounding error next to the grass — ~1,000
     instances x 18 tris on the rich tier is ~18k triangles in ONE draw
     call, ~1.3% of the worst-beat budget. Rich petal geometry is reserved
     for the capable desktop tier; every other tier (mobile, balanced,
     lite, the opening stage, reduced-motion stills) gets the 11-tri
     flower, and reduced motion holds them at the composed FROZEN_T
     instant. The floor keeps the drifts legible even at the opening
     stage's 0.14 scale — 200 static flowers cost nothing. */
  const heroPages = meadow.pages.filter((page) => page.layer === "hero");
  /* Motion is gated on prefers-reduced-motion ONLY. plan.animated is a
     density/budget signal from chooseMeadowPlan; folding it into the freeze
     stilled every browser that hides deviceMemory (Firefox, Safari) — a
     capability hint must never read as a motion preference. */
  const botanicalFrozen = frozen;

  return (
    <group>
      <GrassProgramWarmup onReady={handleGrassProgramReady} />
      {lite ? <MountainRange /> : <SnowRange night={night} dusk={dusk} />}
      <Clouds frozen={frozen} night={night} />
      {includeMeadow ? (
        <>
          <GrassField frozen={botanicalFrozen} pages={heroPages} night={night} dusk={dusk} cfg={G_HERO} />
          <MeadowAtlasField frozen={botanicalFrozen} night={night} dusk={dusk} onReady={handleMeadowAtlasReady} />
          <FlowerField
            frozen={botanicalFrozen}
            night={night}
            dusk={dusk}
            rich={meadow.plan.richFlowers && !lite && qualityScale >= 0.99}
            count={meadow.plan.flowerCount}
          />
          <Scrub />
        </>
      ) : null}
      <EntranceSteps glassRail={glassRail} />
      {lite ? null : <Hammock frozen={frozen} />}
      {lite ? null : <Moose position={[-15.5, 20.5]} rotY={2.1} graze frozen={frozen} />}
      {lite ? null : <Moose position={[16.5, 24.0]} rotY={-1.15} scale={0.86} frozen={frozen} />}
      <OutdoorLighting night={night} />
      <TubSteam frozen={frozen} />
    </group>
  );
}
