/*
  Obsidian Aura unit for the grass passage (local test).
  A fully modelled black room: glossy obsidian facade, dark reflective glazing,
  warm Halo/Bronze interior glow, thin bronze reveal, low charred deck.
  Procedural geometry and PBR materials only. Length runs along local +Z
  (UNIT_LENGTH), matching the meadow slot. The camera path sees the +Z end
  and the -X long side first, then swings round to the -Z end.
*/
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { UNIT_LENGTH, UNIT_WIDTH } from './meadow-v1/meadow/geometry';

export type ObsidianUnit = {
  object: THREE.Group;
  dispose: () => void;
};

const OBSIDIAN = '#0c0d0e';
const BRONZE = '#9c7a55';
const HALO = '#c4a07a';

/** Body footprint sits inside the meadow's cleared unit rect. */
const W = UNIT_WIDTH + 0.1;
const L = UNIT_LENGTH - 0.3;
const DECK_TOP = 0.16;
const BODY_Y0 = DECK_TOP + 0.02;
const BODY_Y1 = 2.9;
const BODY_H = BODY_Y1 - BODY_Y0;

type Seg = { z0: number; z1: number; kind: 'mirror' | 'clear' };

function contactMap(inner: number, outer: number, peak: number) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 512;
  const g = canvas.getContext('2d');
  if (!g) return null;
  // Rounded-rect falloff: draw many inset rounded rects with growing alpha.
  const steps = 48;
  for (let i = 0; i < steps; i += 1) {
    const t = i / (steps - 1);
    const pad = THREE.MathUtils.lerp(outer, inner, t) * 128;
    g.fillStyle = `rgba(0,0,0,${(peak / steps) * 2.2})`;
    const r = Math.max(4, 60 * (1 - t));
    const x = pad;
    const y = pad;
    const w = 256 - pad * 2;
    const h = 512 - pad * 2;
    g.beginPath();
    g.roundRect(x, y, w, h, r);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Fine vertical grain for the batten faces and charred deck (roughness only). */
function grainMap() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 256;
  const g = canvas.getContext('2d');
  if (!g) return null;
  g.fillStyle = '#9a9a9a';
  g.fillRect(0, 0, 64, 256);
  for (let i = 0; i < 90; i += 1) {
    const x = (i * 37) % 64;
    const v = 120 + ((i * 53) % 90);
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.fillRect(x, 0, 1 + (i % 2), 256);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/**
 * Dark tinted glazing. Reflection is added on top (premultiplied blend) and
 * the room behind shows through at (1 - alpha). Alpha rises to 1 at grazing
 * angles, so the panes go mirror-black side-on, like the real units.
 */
function tintedGlass(baseAlpha: number) {
  const mat = new THREE.MeshPhysicalMaterial({
    color: '#0a0b0c',
    metalness: 0,
    roughness: 0.035,
    ior: 1.9,
    specularIntensity: 1,
    clearcoat: 1,
    clearcoatRoughness: 0.04,
    envMapIntensity: 4.5,
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
  });
  mat.blending = THREE.CustomBlending;
  mat.blendSrc = THREE.OneFactor;
  mat.blendDst = THREE.OneMinusSrcAlphaFactor;
  mat.blendSrcAlpha = THREE.OneFactor;
  mat.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
  mat.name = 'aura-obsidian-glass';
  mat.customProgramCacheKey = () => `aura-obsidian-glass-${baseAlpha}`;
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      `${SKY_STREAK('0.32')}
float auraNV = clamp(abs(dot(normalize(normal), normalize(vViewPosition))), 0.0, 1.0);
float auraF = pow(1.0 - auraNV, 3.0);
float auraA = mix(${baseAlpha.toFixed(3)}, 1.0, auraF);
gl_FragColor = vec4(outgoingLight, auraA);`,
    );
  };
  return mat;
}

/** Vertical cedar boards, brighter toward the ceiling where the cove washes them. */
function cedarMap() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const g = canvas.getContext('2d');
  if (!g) return null;
  const wash = g.createLinearGradient(0, 0, 0, 256);
  wash.addColorStop(0, '#f1c48c');
  wash.addColorStop(0.35, '#c98f58');
  wash.addColorStop(1, '#5a3b22');
  g.fillStyle = wash;
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 16; i += 1) {
    const x = i * 16;
    g.fillStyle = `rgba(40,22,10,${0.18 + ((i * 7) % 5) * 0.03})`;
    g.fillRect(x, 0, 1.5, 256);
    g.fillStyle = `rgba(255,220,170,${0.04 + ((i * 3) % 4) * 0.02})`;
    g.fillRect(x + 3, 0, 9, 256);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}


/**
 * Adds the dusk-sky band the real black panels carry along their top edge:
 * reflections that point upward pick up a pale sky, downward ones stay black.
 */
const SKY_STREAK = (gain: string) => `
vec3 auraV = normalize(vViewPosition);
vec3 auraR = inverseTransformDirection(reflect(-auraV, normalize(normal)), viewMatrix);
float auraUp = smoothstep(-0.04, 0.32, auraR.y);
float auraFr = 0.18 + 0.82 * pow(1.0 - clamp(abs(dot(normalize(normal), auraV)), 0.0, 1.0), 2.0);
outgoingLight = outgoingLight * mix(0.32, 1.0, auraUp) * mix(1.0, 0.7, auraFr * (1.0 - auraUp)) + vec3(0.62, 0.68, 0.78) * auraUp * auraFr * ${gain};
`;

export function createObsidianUnit(): ObsidianUnit {
  const object = new THREE.Group();
  object.name = 'AuraObsidianUnit';
  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const texs: THREE.Texture[] = [];

  const grain = grainMap();
  if (grain) texs.push(grain);

  // Mirror-black facade: the long glossy panels in the real photos.
  const facade = new THREE.MeshPhysicalMaterial({
    color: '#060708',
    metalness: 0.05,
    roughness: 0.035,
    ior: 2.0,
    clearcoat: 1,
    clearcoatRoughness: 0.02,
    envMapIntensity: 2.8,
  });
  facade.customProgramCacheKey = () => 'aura-obsidian-facade';
  facade.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      `${SKY_STREAK('0.42')}
#include <opaque_fragment>`,
    );
  };
  // Satin obsidian battens and frames.
  const satin = new THREE.MeshStandardMaterial({
    color: OBSIDIAN,
    metalness: 0.1,
    roughness: 0.5,
    envMapIntensity: 0.45,
  });
  if (grain) {
    satin.roughnessMap = grain;
  }
  const frame = new THREE.MeshStandardMaterial({ color: '#08090a', metalness: 0.3, roughness: 0.35, envMapIntensity: 0.7 });
  const roofMat = new THREE.MeshStandardMaterial({ color: '#101113', metalness: 0.4, roughness: 0.5, envMapIntensity: 0.9 });
  const bronze = new THREE.MeshStandardMaterial({
    color: BRONZE,
    metalness: 1,
    roughness: 0.28,
    envMapIntensity: 1.6,
    emissive: HALO,
    emissiveIntensity: 0.08,
  });
  const deck = new THREE.MeshStandardMaterial({
    color: '#080706',
    metalness: 0,
    roughness: 0.95,
    envMapIntensity: 0.12,
  });
  const skirt = new THREE.MeshStandardMaterial({ color: '#0a0a0a', roughness: 0.9, metalness: 0 });
  // Hidden base parts sit just under visible surfaces; push them back in depth too.
  skirt.polygonOffset = true;
  skirt.polygonOffsetFactor = 2;
  skirt.polygonOffsetUnits = 2;
  // Warm interior: cedar lined, mostly self-lit so it reads in daylight through tint.
  const boards = cedarMap();
  if (boards) {
    boards.wrapS = THREE.RepeatWrapping;
    boards.repeat.set(2, 1);
    texs.push(boards);
  }
  const cedar = new THREE.MeshStandardMaterial({
    color: '#3a2717',
    map: boards ?? undefined,
    roughness: 0.75,
    metalness: 0,
    emissive: '#ffffff',
    emissiveMap: boards ?? undefined,
    emissiveIntensity: 0.85,
    side: THREE.BackSide,
  });
  const linen = new THREE.MeshStandardMaterial({ color: '#5e5144', roughness: 0.95, emissive: '#9c7a55', emissiveIntensity: 0.3 });
  const cove = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd9a8').multiplyScalar(4), toneMapped: true });
  const glassClear = tintedGlass(0.6);
  mats.push(facade, satin, frame, roofMat, bronze, deck, skirt, cedar, linen, cove, glassClear);

  const box = (
    name: string,
    w: number,
    h: number,
    d: number,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
    opts: { cast?: boolean; receive?: boolean } = {},
  ) => {
    const geo = new THREE.BoxGeometry(w, h, d);
    geos.push(geo);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = name;
    mesh.position.set(x, y, z);
    mesh.castShadow = opts.cast ?? true;
    mesh.receiveShadow = opts.receive ?? true;
    object.add(mesh);
    return mesh;
  };

  const hx = W / 2;
  const hz = L / 2;
  const T = 0.07; // wall thickness
  const midY = (BODY_Y0 + BODY_Y1) / 2;

  // ---------- Deck, skirt, plinth ----------
  const deckW = W + 0.5;
  const deckL = L + 1.3;
  const deckZ = 0.45; // entry deck runs out past the +Z glazed end
  const plankW = 0.145;
  const planks: THREE.BufferGeometry[] = [];
  for (let x = -deckW / 2 + plankW / 2; x <= deckW / 2 - plankW / 2 + 1e-4; x += plankW + 0.012) {
    const g = new THREE.BoxGeometry(plankW, 0.05, deckL);
    g.translate(x, DECK_TOP - 0.025, deckZ);
    planks.push(g);
  }
  const plankGeo = mergeGeometries(planks, false);
  for (const g of planks) g.dispose();
  if (plankGeo) {
    geos.push(plankGeo);
    const m = new THREE.Mesh(plankGeo, deck);
    m.name = 'deck';
    m.castShadow = true;
    m.receiveShadow = true;
    object.add(m);
  }
  // Fascia board and buried skirt so a sloped meadow never shows a gap.
  box('deck-skirt', deckW - 0.04, 0.5, deckL - 0.04, skirt, 0, DECK_TOP - 0.05 - 0.25, deckZ, { cast: false });
  // Recessed plinth: the shadow gap under the body. Its top stops 2 cm under the
  // interior floor (iy0) so the two planes never share a depth and flicker.
  box('plinth', W - 0.12, 0.06, L - 0.12, skirt, 0, BODY_Y0 + 0.03, 0, { cast: false });

  // Warm Halo wash from under the deck lip onto the grass: the luxe cue from the
  // real units' deck lighting, in Aura bronze rather than violet.
  const glowTex = (() => {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 512;
    const g = c.getContext('2d');
    if (!g) return null;
    g.filter = 'blur(10px)';
    g.strokeStyle = 'rgba(255,255,255,1)';
    g.lineWidth = 14;
    g.beginPath();
    g.roundRect(38, 38, 180, 436, 10);
    g.stroke();
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  if (glowTex) {
    texs.push(glowTex);
    // Texture rect inset 38/256 of the plane; size the plane so that rect lands on the deck edge.
    const gx = deckW / (180 / 256);
    const gz = deckL / (436 / 512);
    const geo = new THREE.PlaneGeometry(gx, gz);
    geo.rotateX(-Math.PI / 2);
    geos.push(geo);
    const mat = new THREE.MeshBasicMaterial({
      map: glowTex,
      color: new THREE.Color(HALO).multiplyScalar(0.55),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: true,
    });
    mats.push(mat);
    const wash = new THREE.Mesh(geo, mat);
    wash.name = 'HaloWash';
    wash.position.set(0, 0.035, deckZ);
    wash.renderOrder = 2;
    object.add(wash);
  }

  // ---------- Roof slab with bronze reveal ----------
  const roofT = 0.2;
  box('roof', W + 0.14, roofT, L + 0.14, roofMat, 0, BODY_Y1 + roofT / 2 + 0.018, 0);
  // Thin bronze line between body and roof, all round.
  const rv = 0.03;
  box('bronze-reveal', W + 0.002, rv, L + 0.002, bronze, 0, BODY_Y1 + rv / 2 + 0.001, 0, { cast: false });

  // ---------- Corner posts ----------
  const post = 0.1;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      box('corner', post, BODY_H, post, frame, sx * (hx - post / 2), midY, sz * (hz - post / 2));
    }
  }
  const sillH = 0.12;
  const headH = 0.14;
  const glassY0 = BODY_Y0 + 0.08 + sillH;
  const glassY1 = BODY_Y1 - headH;
  const glassH = glassY1 - glassY0;
  const glassMid = (glassY0 + glassY1) / 2;

  // ---------- Long side, -X (hero side): mirror panels + one warm glazed bay ----------
  const innerZ0 = -hz + post;
  const innerZ1 = hz - post;
  const segsMinus: Seg[] = [
    { z0: innerZ0, z1: -1.15, kind: 'mirror' },
    { z0: -1.15, z1: 0.2, kind: 'mirror' },
    { z0: 0.2, z1: 2.15, kind: 'clear' },
    { z0: 2.15, z1: innerZ1, kind: 'mirror' },
  ];
  const segsPlus: Seg[] = [
    { z0: innerZ0, z1: -0.6, kind: 'mirror' },
    { z0: -0.6, z1: 1.1, kind: 'clear' },
    { z0: 1.1, z1: innerZ1, kind: 'mirror' },
  ];
  const seam = 0.03;
  const longSide = (sx: number, segs: Seg[]) => {
    const x = sx * (hx - T / 2);
    // sill and head bands
    box('sill', T + 0.01, sillH, L - post * 2, frame, x, BODY_Y0 + 0.08 + sillH / 2, 0);
    box('head', T + 0.01, headH, L - post * 2, frame, x, BODY_Y1 - headH / 2, 0);
    for (const s of segs) {
      const len = s.z1 - s.z0 - seam;
      const cz = (s.z0 + s.z1) / 2;
      if (s.kind === 'mirror') {
        box('facade', T, glassH, len, facade, x, glassMid, cz);
      } else {
        const pane = box('glazing', 0.024, glassH, len, glassClear, sx * (hx - T * 0.7), glassMid, cz, { cast: false, receive: false });
        pane.renderOrder = 10;
        // slim mullion in the middle of the bay
        box('mullion', T * 0.9, glassH, 0.04, frame, x, glassMid, cz);
      }
      // dark seam fin between segments
      box('seam', T + 0.012, glassH, seam, frame, x, glassMid, s.z1);
    }
  };
  longSide(-1, segsMinus);
  longSide(1, segsPlus);

  // ---------- +Z end: deep picture-frame portal, full glazing ----------
  const pz = hz;
  const portalD = 0.34;
  const portalT = 0.12;
  box('portal-top', W, portalT, portalD, frame, 0, BODY_Y1 - portalT / 2, pz + portalD / 2 - 0.06);
  box('portal-bottom', W, portalT, portalD, frame, 0, BODY_Y0 + portalT / 2, pz + portalD / 2 - 0.06);
  box('portal-side', portalT, BODY_H, portalD, frame, -hx + portalT / 2, midY, pz + portalD / 2 - 0.06);
  box('portal-side', portalT, BODY_H, portalD, frame, hx - portalT / 2, midY, pz + portalD / 2 - 0.06);
  // Bronze lining just inside the portal mouth.
  const lip = 0.012;
  const lz = pz + portalD - 0.06 - 0.03;
  box('portal-bronze', W - portalT * 2, lip, 0.05, bronze, 0, BODY_Y1 - portalT - lip / 2, lz, { cast: false });
  box('portal-bronze', W - portalT * 2, lip, 0.05, bronze, 0, BODY_Y0 + portalT + lip / 2, lz, { cast: false });
  box('portal-bronze', lip, BODY_H - portalT * 2, 0.05, bronze, -hx + portalT + lip / 2, midY, lz, { cast: false });
  box('portal-bronze', lip, BODY_H - portalT * 2, 0.05, bronze, hx - portalT - lip / 2, midY, lz, { cast: false });
  const endGlassW = W - portalT * 2;
  const endGlassH = BODY_H - portalT * 2;
  const endPane = box('glazing-end', endGlassW, endGlassH, 0.024, glassClear, 0, midY, pz - 0.02, { cast: false, receive: false });
  endPane.renderOrder = 10;
  // Slider: a second pane offset, with a bronze pull.
  box('slider-stile', 0.045, endGlassH, 0.05, frame, endGlassW * 0.08, midY, pz - 0.0);
  box('pull', 0.018, 0.5, 0.03, bronze, endGlassW * 0.08 + 0.05, midY, pz + 0.03, { cast: false });

  // ---------- -Z end: satin battens + tall slot window ----------
  const battens: THREE.BufferGeometry[] = [];
  const bw = 0.05;
  const step = 0.1;
  const slot = { x0: -0.55, x1: 0.55 };
  for (let x = -hx + post + bw / 2; x <= hx - post - bw / 2 + 1e-4; x += step) {
    if (x > slot.x0 - bw && x < slot.x1 + bw) continue;
    const g = new THREE.BoxGeometry(bw, BODY_H - 0.08, 0.035);
    g.translate(x, midY + 0.04, -hz - 0.0175);
    battens.push(g);
  }
  const battenGeo = mergeGeometries(battens, false);
  for (const g of battens) g.dispose();
  if (battenGeo) {
    geos.push(battenGeo);
    const m = new THREE.Mesh(battenGeo, satin);
    m.name = 'battens';
    m.castShadow = true;
    m.receiveShadow = true;
    object.add(m);
  }
  // Backing with a real opening, so the cedar room shows through the end window.
  const bx0 = -hx + post;
  const bx1 = hx - post;
  box('end-backing', slot.x0 - bx0, BODY_H, T, frame, (bx0 + slot.x0) / 2, midY, -hz + T / 2);
  box('end-backing', bx1 - slot.x1, BODY_H, T, frame, (slot.x1 + bx1) / 2, midY, -hz + T / 2);
  const slotW = slot.x1 - slot.x0;
  const slotX = (slot.x0 + slot.x1) / 2;
  box('end-backing', slotW, glassY0 - BODY_Y0, T, frame, slotX, (BODY_Y0 + glassY0) / 2, -hz + T / 2);
  box('end-backing', slotW, BODY_Y1 - glassY1, T, frame, slotX, (glassY1 + BODY_Y1) / 2, -hz + T / 2);
  const slotPane = box('glazing-slot', slotW, glassH, 0.02, glassClear, slotX, glassMid, -hz - 0.03, { cast: false, receive: false });
  slotPane.renderOrder = 10;
  const cedarFront = cedar.clone();
  cedarFront.side = THREE.FrontSide;
  cedarFront.emissiveIntensity = 0.8;
  mats.push(cedarFront);

  // ---------- Interior: cedar box, cove light, bench, bed ----------
  const iw = W - T * 2 - 0.04;
  const il = L - post * 2 - 0.04;
  const iy0 = BODY_Y0 + 0.08;
  const ih = BODY_Y1 - iy0 - 0.02;
  const room = box('interior', iw, ih, il, cedar, 0, iy0 + ih / 2, 0, { cast: false, receive: false });
  room.renderOrder = 0;
  // Cove strips along the ceiling edges.
  box('cove', 0.03, 0.03, il - 0.1, cove, -iw / 2 + 0.06, glassY1 - 0.06, 0, { cast: false, receive: false });
  box('cove', 0.03, 0.03, il - 0.1, cove, iw / 2 - 0.06, glassY1 - 0.06, 0, { cast: false, receive: false });
  box('cove', iw - 0.1, 0.03, 0.03, cove, 0, glassY1 - 0.06, -il / 2 + 0.06, { cast: false, receive: false });
  // Low linen bed toward the back, bench under the -X glazing.
  box('bed', iw - 0.4, 0.42, 1.9, linen, 0, iy0 + 0.21, -il / 2 + 1.1, { cast: false });
  box('bed-head', iw - 0.2, 0.9, 0.08, cedarFront, 0, iy0 + 0.45, -il / 2 + 0.06, { cast: false });
  box('bench', 0.5, 0.3, 1.5, linen, -iw / 2 + 0.3, iy0 + 0.15, 1.2, { cast: false });
  box('bench-strip', 0.02, 0.02, 1.5, cove, -iw / 2 + 0.56, iy0 + 0.05, 1.2, { cast: false, receive: false });

  const glow = new THREE.PointLight('#ffc98a', 7, 5.5, 1.6);
  glow.name = 'ObsidianGlow';
  glow.position.set(0, BODY_Y1 - 0.5, 0.8);
  glow.castShadow = false;
  object.add(glow);
  // Spill onto the entry deck through the +Z glazing.
  const spill = new THREE.SpotLight('#ffcf98', 9, 6, Math.PI / 3.2, 0.8, 1.6);
  spill.position.set(0, BODY_Y1 - 0.3, hz - 0.3);
  spill.target.position.set(0, 0, hz + 1.6);
  spill.castShadow = false;
  object.add(spill, spill.target);

  // ---------- Contact shadows (work with the shadow map off on phones) ----------
  const addContact = (sizeX: number, sizeZ: number, z: number, inner: number, outer: number, peak: number, y: number) => {
    const tex = contactMap(inner, outer, peak);
    if (!tex) return;
    texs.push(tex);
    const geo = new THREE.PlaneGeometry(sizeX, sizeZ);
    geo.rotateX(-Math.PI / 2);
    geos.push(geo);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false, fog: true });
    mats.push(mat);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'ContactShadow';
    mesh.position.set(0, y, z);
    mesh.renderOrder = 1;
    object.add(mesh);
  };
  // Wide soft falloff into the grass, then a tight dark AO lip at the deck edge.
  addContact(deckW + 3.2, deckL + 3.6, deckZ, 0.32, 0.0, 0.7, 0.02);
  addContact(deckW + 0.5, deckL + 0.5, deckZ, 0.12, 0.0, 0.85, 0.025);

  return {
    object,
    dispose() {
      object.removeFromParent();
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
      for (const t of texs) t.dispose();
      geos.length = 0;
      mats.length = 0;
      texs.length = 0;
    },
  };
}
