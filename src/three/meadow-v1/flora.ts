"use client";

/* ---------------------------------------------------------------------
   FLORA — the botanical layer's shared core.

   Two things live here, deliberately together:

   1. THE MEADOW'S WIND, as module constants. The grass layers and the
      flowers must move in ONE weather — a flower swaying to its own clock
      next to grass swaying to another is the kind of wrongness a viewer
      feels before they can name it. So the wind direction, the gust
      envelope, and the reduced-motion frozen instant are defined once here
      and imported by every planted thing. SceneDetail's grass reads these;
      the flower material reads these; there is no second copy to drift.

   2. THE FLOWER SYSTEM — geometry, deterministic clustered placement, and
      the shader pair. One InstancedBufferGeometry, one ShaderMaterial, ONE
      draw call for every flower in the scene.

   Idea credit (owed a row in docs/CREDITS.md at integration): the
   clustered instanced-wildflower approach — low-poly petal rings on bent
   stems, planted in species-clumped drifts — was studied in
   siliconjungle/inkwell-webgpu-flowers (MIT). Ideas only: theirs is a
   WebGPU renderer with its own atlas; ours is Three/R3F GLSL and every
   vertex below is generated in code. No source or assets were copied.

   Everything is deterministic — the same hash-noise idiom the rest of the
   scene uses (sin·43758.5453), never Math.random — so the meadow is the
   same meadow on every load.
--------------------------------------------------------------------- */

import * as THREE from "three";

/* --------------------------- shared helpers ------------------------- */

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

const smooth01 = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** Deterministic pseudo-random — same layout every load, no Math.random.
 *  Identical formula to SceneDetail's rand(); duplicated here because this
 *  module sits BELOW SceneDetail in the import graph and must not create a
 *  cycle for eleven characters of arithmetic. */
function rand(i: number, salt = 0) {
  const s = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

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

/* ------------------------- THE SHARED WEATHER ----------------------- */

/** The one wind direction. Every planted thing leans along this vector's
 *  gust field. Clone before assigning to a uniform — uniforms mutate. */
export const WIND_DIR = new THREE.Vector2(0.82, 0.57).normalize();

/** Weather: ramp -> hold -> decay -> lull, so gusts arrive rather than loop.
 *  11 s -> 9 s ("busier overall" — founder). The lull returning 0 does NOT
 *  stop the meadow: the envelope only gates the gust FRONT, and the advected
 *  gust field underneath keeps travelling on the same clock, so a lull reads
 *  as the air going soft rather than as the animation pausing. */
export function gustEnvelope(t: number) {
  const T = 9.0;
  const u = (t % T) / T;
  if (u < 0.18) return smooth01(0, 1, u / 0.18);
  if (u < 0.46) return 1;
  if (u < 0.78) return 1 - smooth01(0, 1, (u - 0.46) / 0.32);
  return 0;
}

/** Mirror the vertex shader's per-instance distance fade for diagnostics.
 *  Keeping this pure helper next to the shader makes release telemetry count
 *  flowers that still have rendered height, rather than every planted root
 *  that merely falls inside the camera frustum. */
export function flowerVisibilityAtDistance(distance: number, fadeSeed: number) {
  const keep = 1 - smooth01(18, 30, distance);
  const visible = 1 - smooth01(keep - 0.16, keep, fadeSeed);
  return visible * smooth01(0.25, 0.6, distance);
}

/* THE FROZEN INSTANT. prefers-reduced-motion sets frameloop="demand": the
   canvas renders exactly one frame and stops, so whatever the wind uniforms
   hold at that moment is the picture forever. t=0 is the worst possible
   choice — every advected noise is at its unshifted origin and the gust
   envelope is at zero, i.e. the field is caught in a dead lull with no gust
   anywhere. 5.6 s lands mid-decay of the second gust (envelope ~0.49), which
   is a composed frame: a wave part-way across the meadow, blades leaning at
   a range of angles and none of them at full whip — and the flowers, on the
   same clock, caught mid-nod with it. */
export const FROZEN_T = 5.6;

/** The key direction every baked/analytic light in the story scene agrees
 *  on — matches SceneDetail's KEY and the LightArc's daytime sun. */
const KEY = new THREE.Vector3(18, 16, 13).normalize();

/* ============================== FLOWERS =============================
   A wildflower is three parts: a stem, a ring of petals, a centre disc.
   Two geometry tiers share one shader:

   · RICH (capable desktop, full quality): 6 diamond petals (2 tris each),
     crossed tapered stem quads, centre quad — 18 triangles, 32 vertices.
   · LOW (everything else — mobile, balanced, lite, the opening stage):
     5 single-triangle petals, same stem cross, centre quad — 11 triangles.

   Colour is species-driven in the vertex shader from three muted alpine
   families — cream, lavender, straw-gold — clumped per ~3 m world cell so
   a drift reads as one kind of flower, the way real meadows grow. No
   orange anywhere (BRAND.md section 2 has none), and values stay a step
   below the sky so heads never bloom into fireflies.

   Near/mid/far: flowers dissolve per-instance over 18–30 m of camera
   distance using the grass layers' own smooth fade-seed band (no pop, no
   hysteresis state), with the grass's anti-shimmer distance widening on
   the way out. Past 30 m the meadow surface and the grass carry the field
   — a 4 cm petal head is sub-texel out there and could only alias.
=================================================================== */

function flowerGeometry(rich: boolean) {
  const pos: number[] = [];
  const part: number[] = []; // 0 stem, 1 petal, 2 centre
  const idx: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[], p: number) => {
    const o = pos.length / 3;
    pos.push(...a, ...b, ...c, ...d);
    part.push(p, p, p, p);
    idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
  };
  const tri = (a: number[], b: number[], c: number[], p: number) => {
    const o = pos.length / 3;
    pos.push(...a, ...b, ...c);
    part.push(p, p, p);
    idx.push(o, o + 1, o + 2);
  };

  /* Stem: two crossed, slightly tapered quads. A single quad vanishes
     edge-on; the cross keeps presence from every camera yaw for 2 extra
     triangles — cheaper than the shader-side view widening the grass needs,
     because a stem, unlike a blade, is one instance per flower. */
  const w0 = 0.03;
  const w1 = 0.02;
  quad([-w0, 0, 0], [w0, 0, 0], [w1, 1, 0], [-w1, 1, 0], 0);
  quad([0, 0, w0], [0, 0, -w0], [0, 1, -w1], [0, 1, w1], 0);

  /* Petals: a ring, cupped upward — tips ride higher than roots, which is
     what separates a flower from a pinwheel when the camera is low. */
  const petals = rich ? 6 : 5;
  for (let k = 0; k < petals; k++) {
    const a = (k / petals) * Math.PI * 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    // point at radius r, height y, offset off across the petal's own axis
    const P = (r: number, y: number, off: number) => [ca * r - sa * off, y, sa * r + ca * off];
    if (rich) {
      // diamond petal, 2 tris: inner -> side -> tip -> side
      quad(P(0.03, 1.0, 0), P(0.095, 1.03, 0.042), P(0.165, 1.06, 0), P(0.095, 1.03, -0.042), 1);
    } else {
      // one triangle is the whole petal — the low tier's entire job is to
      // read as a fleck of colour on the sward, not to model botany
      tri(P(0.03, 1.0, -0.036), P(0.03, 1.0, 0.036), P(0.155, 1.045, 0), 1);
    }
  }

  // centre disc
  const cy = rich ? 1.045 : 1.02;
  const cw = 0.04;
  quad([-cw, cy, -cw], [-cw, cy, cw], [cw, cy, cw], [cw, cy, -cw], 2);

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return {
    pos: (g.attributes.position as THREE.BufferAttribute).array as Float32Array,
    nrm: (g.attributes.normal as THREE.BufferAttribute).array as Float32Array,
    part: new Float32Array(part),
    idx: new Uint16Array(idx),
    tris: idx.length / 3,
  };
}

/* ------------------------- placement sampling ----------------------- */

/** The world-sampling functions the field plants against. Passed in by
 *  SceneDetail (which owns the meadow mask and the clearance aprons) so
 *  this module never has to import it — one-way dependency, no cycle. */
export type FloraSample = {
  /** terrain height at (x, z) */
  ground: (x: number, z: number) => number;
  /** meadow density mask 0..1 — where grass grows at all */
  density: (x: number, z: number) => number;
  /** built-world clearance 0..1 — 0 at the fire ring, the deck, the path */
  clearance: (x: number, z: number) => number;
};

/**
 * Plant the flowers. Deterministic rejection sampling against:
 *   · the meadow density mask (flowers only grow where grass does),
 *   · a low-frequency value-noise PATCH mask — flowers come in drifts,
 *     not confetti; ~35% of the meadow carries a patch and the rest is
 *     deliberately bare so the drifts read as places,
 *   · a yard weighting toward the home — the same redistribution idea as
 *     the grass filler's yard boost, because beats 01–06 all frame that
 *     ring and a flower at the fog line is budget nobody sees,
 *   · the clearance aprons at HERO width — flowers never hug structures
 *     or lean over the walked line; unlike grass they do not shorten,
 *     they simply step back (a mown verge has no half-height flowers).
 *
 * Species is seeded from a coarse (~3 m) world cell, so each drift blooms
 * predominantly one colour — the same clumping trick the grass species
 * use, and the thing that stops the field reading as noise.
 */
export function buildFlowerField(count: number, rich: boolean, sample: FloraSample) {
  const base = flowerGeometry(rich);
  const X0 = -30;
  const X1 = 30;
  const Z0 = -6;
  const Z1 = 40;
  const posA: number[] = [];
  const instA: number[] = [];
  let placed = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  const MAX_TRIES = count * 60;
  for (let i = 0; i < MAX_TRIES && placed < count; i++) {
    const x = X0 + rand(i, 211) * (X1 - X0);
    const z = Z0 + rand(i, 212) * (Z1 - Z0);
    const patch = smooth01(0.52, 0.72, vnoise(x * 0.13 + 7.7, z * 0.13 + 3.9));
    if (patch <= 0.01) continue;
    const yard = 1 - smooth01(8, 24, Math.hypot(x, z - 4));
    const dens = sample.density(x, z) * patch * (0.25 + 0.75 * yard);
    if (dens < 0.02 || rand(i, 213) > dens) continue;
    if (sample.clearance(x, z) < 0.45) continue;

    posA.push(x, sample.ground(x, z) - 0.01, z);
    instA.push(
      rand(i, 214) * Math.PI * 2, // yaw
      0.16 + Math.pow(rand(i, 215), 1.4) * 0.16, // stem height, metres — the proven clustered field range
      hash2(Math.floor(x * 0.35), Math.floor(z * 0.35)), // species, clumped per ~3 m cell
      rand(i, 216) // fade seed + sway phase
    );
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
    minY = Math.min(minY, posA[placed * 3 + 1]);
    maxY = Math.max(maxY, posA[placed * 3 + 1]);
    placed++;
  }
  if (placed < 8) return null;

  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(base.pos, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(base.nrm, 3));
  geo.setAttribute("aPart", new THREE.BufferAttribute(base.part, 1));
  geo.setIndex(new THREE.BufferAttribute(base.idx, 1));
  geo.setAttribute("aPos", new THREE.InstancedBufferAttribute(new Float32Array(posA), 3));
  geo.setAttribute("aInst", new THREE.InstancedBufferAttribute(new Float32Array(instA), 4));
  geo.instanceCount = placed;

  /* Keep a compact CPU-side head list for the release proof and accessible
     diagnostics. It is derived from the exact planted roots and stem heights,
     never from a second sampler, so visibility evidence cannot drift from the
     geometry on screen. */
  const heads = new Float32Array(placed * 3);
  for (let index = 0; index < placed; index += 1) {
    heads[index * 3] = posA[index * 3];
    heads[index * 3 + 1] = posA[index * 3 + 1] + instA[index * 4 + 1];
    heads[index * 3 + 2] = posA[index * 3 + 2];
  }

  // attributes are absolute world coords, so the mesh stays at the origin
  // and the bounding sphere is given in those coords; +1 m of margin covers
  // stem height plus the deepest wind lean
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const cy = (minY + maxY) / 2;
  geo.boundingSphere = new THREE.Sphere(
    new THREE.Vector3(cx, cy + 0.2, cz),
    Math.hypot(maxX - cx, maxZ - cz) + 1
  );

  return { geo, heads, placed, tris: placed * base.tris };
}

/* ----------------------------- shaders ------------------------------ */

const FLOWER_VERT = /* glsl */ `
precision highp float;

attribute vec3  aPos;   // world root position, planted on the real ground
attribute vec4  aInst;  // yaw, stem height (m), species, fade/phase seed
attribute float aPart;  // 0 stem, 1 petal, 2 centre

uniform float uTime;
uniform vec2  uWindDir;
uniform float uGust;
uniform vec3  uCamPos;

varying vec3  vColor;
varying vec3  vNormal;
varying vec3  vWorld;
varying float vPart;

float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), u.x),
             mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), u.x), u.y);
}

void main(){
  float yaw = aInst.x;
  float c = cos(yaw), s = sin(yaw);
  vec3 lp = vec3(position.x * c - position.z * s, position.y, position.x * s + position.z * c);
  vec3 nl = vec3(normal.x * c - normal.z * s, normal.y, normal.x * s + normal.z * c);

  float dist = distance(aPos, uCamPos);

  /* near/mid/far — the grass layers' own dissolve idiom: a smooth band on
     the per-instance fade seed, so flowers thin out individually over
     18..30 m instead of a whole field popping at a ring. The near guard
     stops a head flashing across the lens as the camera brushes past. */
  float keep = 1.0 - smoothstep(18.0, 30.0, dist);
  float vis = 1.0 - smoothstep(keep - 0.16, keep, aInst.w);
  vis *= smoothstep(0.25, 0.6, dist);

  float h = aInst.y * vis;

  // anti-shimmer widening with distance — same trick, slightly stronger
  // than the grass's 0.010/m because stems are narrower than blades
  lp.xz *= 1.0 + dist * 0.014;

  /* ---- WIND: the meadow's field, not a private one ----
     Use the hero grass's exact three analytic travelling/cross/ripple
     phases. Flowers remain stiffer and respond at lower amplitude, but a
     gust now reaches every planted layer at the same world position and
     time instead of crossing two different procedural weather fields. */
  vec2 wd = normalize(uWindDir);
  float stiff = 1.15 + 0.55 * h21(aPos.xz * 4.3 + 5.1);
  float ph = aInst.w * 6.2831853;
  float travelling = sin(uTime * 0.62 - dot(aPos.xz, wd) * 0.135);
  float crossWave = sin(uTime * 0.41 + aPos.x * 0.082 - aPos.z * 0.057 + ph);
  float ripple = sin(uTime * 1.85 + aPos.x * 0.31 + aPos.z * 0.23 + ph * 0.5);
  float front = 0.5 + 0.5 * travelling;
  float amp = (0.34 + 0.66 * front * uGust) / stiff;
  float flutter = sin(uTime * 2.6 / stiff + ph) * 0.14;
  float lean = (0.55 + travelling * 0.30 + ripple * 0.10 + flutter) * amp * 0.5;
  float windYaw = crossWave * 0.30 + ripple * 0.06;
  vec2 windDir = wd * cos(windYaw) + vec2(-wd.y, wd.x) * sin(windYaw);

  // a small static lean per flower, seeded from world position, so the
  // drift is never a grid of verticals even in still air — the grass's
  // rest-arch idea at flower stiffness
  float la = h21(floor(aPos.xz * 3.7)) * 6.2831853;
  vec2 sway = vec2(cos(la), sin(la)) * (0.04 + 0.10 * h21(aPos.xz * 1.9 + 7.0)) + windDir * lean;

  /* root-pinned quadratic bend: the base stays planted, travel grows with
     the square of height, and the head drops slightly as it leans — a stem
     arcs, it does not hinge. */
  float yy = max(lp.y, 0.0);
  vec3 bent = lp * h;
  bent.xz += sway * yy * yy * h;
  bent.y -= length(sway) * 0.30 * yy * yy * h;

  vec3 world = aPos + bent;

  /* ---- species colour, in linear space ----
     Three muted alpine families, clumped per drift by the JS sampler:
       cream   #f2f1e4 · lavender #9c8fc9 · straw-gold #dcc884
     centre #cfa54e, stem sward-green #5c7a48 — all inside the scene's
     palette, nothing orange, nothing brighter than the sky. */
  float sp = aInst.z;
  vec3 petal = vec3(0.886, 0.877, 0.772);
  petal = mix(petal, vec3(0.340, 0.280, 0.592), smoothstep(0.42, 0.50, sp) * (1.0 - smoothstep(0.74, 0.82, sp)));
  petal = mix(petal, vec3(0.723, 0.586, 0.235), smoothstep(0.74, 0.82, sp));
  petal *= 0.90 + 0.20 * h21(aPos.xz * 2.1); // per-flower value jitter
  vec3 col = mix(vec3(0.106, 0.197, 0.062), petal, step(0.5, aPart));
  col = mix(col, vec3(0.633, 0.384, 0.074), step(1.5, aPart));

  vColor = col;
  vNormal = nl;
  vWorld = world;
  vPart = aPart;

  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const FLOWER_FRAG = /* glsl */ `
precision highp float;

uniform vec3  uSunDir;
uniform vec3  uSunCol;
uniform float uSunI;
uniform vec3  uHemiSky;
uniform vec3  uHemiGround;
uniform vec3  uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform vec3  uCamPos;
uniform float uNight;

varying vec3  vColor;
varying vec3  vNormal;
varying vec3  vWorld;
varying float vPart;

void main(){
  vec3 N = normalize(vNormal);
  if (!gl_FrontFacing) N = -N;

  // wrapped diffuse + hemisphere — the exact light model the grass uses,
  // so a flower sits IN the sward rather than pasted on it
  float ndl = dot(N, uSunDir) * 0.5 + 0.5;
  vec3 light = uSunCol * uSunI * ndl * ndl;
  light += mix(uHemiGround, uHemiSky, N.y * 0.5 + 0.5) * 0.55;

  vec3 col = vColor * light;
  // petals scatter a little — a whisper of lift so heads read against the
  // green, held well under the grass's bloom clamp
  col *= 1.0 + 0.10 * step(0.5, vPart);

  col = mix(col, col * vec3(0.34, 0.40, 0.54), uNight);
  col = min(col, vec3(2.2));

  float fd = distance(uCamPos, vWorld);
  col = mix(col, uFogColor, smoothstep(uFogNear, uFogFar, fd));

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** The one flower material. Wind uniforms are fed by the caller from the
 *  same clock and envelope as the grass materials — see SceneDetail's
 *  FlowerField, which drives uTime/uGust/uCamPos per frame and lerps the
 *  sun uniforms through the dusk registry exactly as GrassField does. */
export function makeFlowerMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: FLOWER_VERT,
    fragmentShader: FLOWER_FRAG,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uWindDir: { value: WIND_DIR.clone() },
      uGust: { value: 0.4 },
      uCamPos: { value: new THREE.Vector3() },
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
