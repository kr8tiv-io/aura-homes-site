"use client";

/* ===========================================================================
   THE VIEWPORT — the HomeSpec, on screen, while you are still changing it.

   `lib/builder/geometry.ts` decides the SHAPE and this file decides the LOOK,
   and the `surface` tag on each part is the entire contract between them. That
   split is why a roof can change form without a single colour moving, and why
   a night palette is eleven lines rather than a rewrite.

   THE VISUAL LANGUAGE is the one `components/story/Scene.tsx` established for
   the landing page: flat-shaded low-poly, standard materials, roughness doing
   the work, no textures, no post-processing. This builder has to look like it
   belongs to the same world as the home on the front page, because it is
   supposed to be the same home.

   THREE THINGS THIS FILE IS CAREFUL ABOUT
   ---------------------------------------
   1. IT OWNS NO GEOMETRY. Every BufferGeometry arrives built and is disposed
      by whoever built it (`BuilderApp`), so every mesh here carries
      `dispose={null}` — without it R3F would free buffers the builder still
      holds a reference to, and the model would vanish mid-drag.
   2. THE HOUSE GROUP IS THE EXPORT ROOT. `houseRef` wraps the volumes, the
      deck and whatever `houseChildren` puts beside them — and NOTHING else:
      no ground, no grid, no sun, no selection glow. That is what makes the
      .glb a building rather than a screenshot of an editor. The editor
      furniture also carries `EXPORT_IGNORE` as a second belt, in case
      somebody later hands a wider subtree to the exporter.
   3. IT RENDERS ON DEMAND. `frameloop="demand"` means no frame is drawn
      unless something changed — a 3D view idling at 60fps on a laptop for the
      twenty minutes somebody spends reading the plan below it is a battery
      bill for nothing. `<Refresh>` invalidates whenever React re-renders the
      scene, and drei's OrbitControls invalidates while you drag.

      VW03 — WHAT THE PHONE GETS, DECIDED RATHER THAN INHERITED. The three
      options on the table were a still image, a poster frame you tap to
      start, and a live canvas that does not animate. It is the third, and the
      reason is rule 2 above rather than anything about phones: this canvas is
      the EXPORT ROOT. Swapping it for an <img> below some width means the
      .glb and .obj writers have no group to serialise and the project library
      has no scene to thumbnail, on exactly the device most likely to be the
      only one somebody owns. So it stays live, and the cost that would have
      justified removing it — a WebGL context redrawing sixty times a second in
      a pocket — is the cost `frameloop="demand"` was already not paying:
      `BuilderSceneQuality.frameloop` in `lib/three/sceneQuality.ts` is typed
      to the literal `"demand"`, so no capability tier can turn this into an
      animation loop.

      That was TRUE and UNASSERTED, which is the same as unowned. It is now
      measured from the outside in `tests/builder-mobile.spec.ts`: the spec
      counts real WebGL draw calls at 390x844, proves the counter moves when
      the model is orbited, and then proves it does not move at all while the
      page sits idle.

   FINISHES ARE OPTIONAL AND ADDITIVE (added when the surface picker landed).
   The `SURFACES` table below is still the whole look of this file when no
   `surfaces` prop is passed — the default look, the night glass glow, the
   flat shading, the no-shadow rule for glass and water, all unchanged. When
   the prop IS passed, `materialForPart` answers the same question with one
   extra step: a per-surface override if the person set one, otherwise the
   surface's default — and `DEFAULT_MATERIAL` in `lib/builder/surfaces.ts`
   reproduces this table value for value, so passing the prop with an empty
   override map renders exactly what it rendered before.
   =========================================================================== */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ElementRef,
  type MutableRefObject,
  type ReactNode,
} from "react";
import { Canvas, useThree, type ThreeEvent } from "@react-three/fiber";
import { ContactShadows, Environment, Lightformer, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import {
  cameraFrameForSummary,
  GRADE_Y_FT,
  type HomeGeometry,
  type Part,
  type Surface,
  type VolumeGeometry,
  type VolumeSummary,
} from "../core/geometry";
import { EXPORT_IGNORE } from "./exportMark";
import type { BuilderSite } from "../core/site";
import { gradeHeightFt } from "./gradeStub";
import type { ComfortPlate } from "./comfortPlate";
import {
  materialForPart,
  type SurfaceId,
  type SurfaceIndex,
  type SurfaceOverrides,
} from "../core/surfaces";
import { currentTheme, onThemeChange, type Theme } from "./theme";
import { NORDIC_MATERIALS } from "./nordicMaterials";
import {
  degradeBuilderSceneQuality,
  selectBuilderSceneQuality,
  type BuilderSceneQuality,
} from "./sceneQuality";
import { ThumbnailProbe } from "./ProjectLibrary";
import { SurfacePickLayer } from "./SurfacePicker";
import { bearingWords, hourLabel, type SunPosition } from "./sun";

/* ------------------------------------------------------------- finishes */

/** Everything the viewport needs to let somebody paint one surface. Optional
 *  as a whole: omit it and this file behaves exactly as it did before the
 *  picker existed. */
export interface ViewportSurfaces {
  index: SurfaceIndex;
  overrides: SurfaceOverrides;
  picked: SurfaceId | null;
  onPick: (id: SurfaceId | null) => void;
  /** false while the 2D plan is the visible view — the canvas is still
   *  mounted (it is the export root) but a click on it is not a pick. */
  enabled: boolean;
}

/* ------------------------------------------------------------ comfort layer

   Everything the viewport needs to tint the solved rooms by comfort deviation.
   Optional as a whole, and `null` is the OFF state: `BuilderApp` owns the
   toggle and the toggle starts off, so the model reads as a house until
   somebody asks it not to.

   `conditions` is not decoration. A colour on screen with no assumption beside
   it is exactly the thing `lib/builder/comfort.ts` exists to prevent, so the
   legend cannot render without one and the prop is required. */

export interface ViewportComfort {
  /** room floor rectangles, already in the site frame — see `comfortPlates` */
  plates: readonly ComfortPlate[];
  /** the assumed temperature and humidity these colours were computed from */
  conditions: string;
  /** "Winter" / "Summer" — which set of assumptions is being shown */
  seasonLabel: string;
}

/* ------------------------------------------------------------- viewer tools

   VW02. Two ways of interrogating the model rather than orbiting it, both
   derived in `lib/three/viewerTools.ts` and both purely a VIEW: neither one
   touches the document, the geometry or the export.

   THE CUT IS A MATERIAL PROPERTY, NOT A RENDERER SETTING. `localClippingEnabled`
   is the only renderer state touched, and the planes are attached to the house
   materials alone — so the ground, the grid, the comfort plates and the sun
   marker are never sliced, and the geometry the .glb writer serialises is
   untouched by a cut that only ever lived in a fragment shader.

   THE ISOLATION GHOSTS, IT DOES NOT HIDE. `soloVolumeIds` names the volumes
   that stay solid and the rest are drawn at `GHOST_OPACITY` with no shadow —
   deliberately NOT `visible={false}`, because three's GLTFExporter defaults to
   `onlyVisible: true` and `exportGlb` passes that default through, so hiding a
   floor to look at another one would quietly ship half a house in the .glb. */

export interface ViewportTools {
  /** empty for no cut; at most one plane today */
  clipPlanes: THREE.Plane[];
  /** volumes that stay solid, or null for "all of them" */
  soloVolumeIds: string[] | null;
}

/** How faint a floor gets when another floor is the one being looked at.
 *  Faint enough to read past, present enough to keep the massing legible. */
const GHOST_OPACITY = 0.07;

/* ---------------------------------------------------------------- palette

   One palette, two lights. The night mode does NOT recolour the building —
   a cedar deck is the same cedar after dark — it changes the sky, the ground
   and what is coming out of the windows, which is what actually changes.  */

interface SurfaceStyle {
  color: string;
  roughness: number;
  metalness: number;
  /** translucent surfaces: glass and the water in the tub */
  opacity?: number;
  transmission?: number;
  ior?: number;
  clearcoat?: number;
  /** flat shading is the low-poly language; smooth is for the cylinders */
  smooth?: boolean;
  noShadow?: boolean;
}

const SURFACES: Record<Surface, SurfaceStyle> = {
  wall: NORDIC_MATERIALS.limeRender,
  floor: NORDIC_MATERIALS.ash,
  roof: NORDIC_MATERIALS.standingSeam,
  trim: { ...NORDIC_MATERIALS.blackAluminium, color: "#8f9a94", metalness: 0.6 },
  glass: { ...NORDIC_MATERIALS.glass, noShadow: true },
  door: { ...NORDIC_MATERIALS.cedar, color: "#6a5442" },
  frame: NORDIC_MATERIALS.blackAluminium,
  sill: NORDIC_MATERIALS.stone,
  pile: { color: "#6c7370", roughness: 0.6, metalness: 0.35, smooth: true },
  deck: NORDIC_MATERIALS.cedar,
  tub: { color: "#6d523c", roughness: 0.9, metalness: 0, smooth: true },
  water: { ...NORDIC_MATERIALS.water, smooth: true, noShadow: true },
};

/** The two worlds the site already has: paper daylight, and the night the
 *  landing page's NIGHT button flips to. */
const WORLD = {
  light: {
    sky: "#dcecf3",
    ground: "#7d8f6e",
    grid: "#93a689",
    gridAxis: "#5f7355",
    sun: "#fff4de",
    hemi: 0.55,
    ambient: 0.16,
    key: 2.2,
    /** what a window looks like from outside when nothing is lit inside */
    glow: 0,
  },
  dark: {
    sky: "#1b2733",
    ground: "#2c3630",
    grid: "#3c4a42",
    gridAxis: "#55665c",
    sun: "#9fb6d8",
    hemi: 0.26,
    ambient: 0.1,
    key: 0.5,
    glow: 0.9,
  },
} as const;

/* --------------------------------------------------------- the heat ramp

   Three-stop diverging ramp for the comfort overlay, and it is the ONLY new
   palette in this file. It follows the same rule everything above it does:
   three.js material colours live here as constants and never as a literal
   inside a className or a style attribute.

   THE VALUES ARE THE SITE'S OWN. Each stop is the hex the tonal ladder in
   `app/globals.css` already resolves for that accent in that theme —
   `--tone-teal-mark`, `--tone-emerald-bright` and `--tone-violet`. Mirroring
   them rather than inventing three new colours is what lets the legend below
   use the ordinary `bg-aura-*` utilities and still match the plates in the
   scene: one palette, painted twice, by the two mechanisms each side of the
   canvas boundary understands.

   COLD to WARM, not GOOD to BAD. The ramp is signed — teal is a room the
   index calls cool, violet is one it calls warm, emerald is neutral — because
   "0.9 off" tells you nothing about which way to move the thermostat. */

interface HeatStops {
  cold: string;
  neutral: string;
  warm: string;
}

const HEAT: Record<Theme, HeatStops> = {
  light: { cold: "#0d9488", neutral: "#10b981", warm: "#7c3aed" },
  dark: { cold: "#2dd4bf", neutral: "#6ee7b7", warm: "#a78bfa" },
};

/** Where the ramp saturates. Beyond ±3 the seven-point scale has no more
 *  words, so neither does the colour. */
const HEAT_FULL_SCALE = 3;

/** Finished floor in the site frame. `geometry.ts` places every volume's local
 *  origin at "footprint centre, finished floor", and grade is BELOW it at
 *  `GRADE_Y_FT` — so zero is the floor and the plates sit a hair above it. */
const FINISHED_FLOOR_Y_FT = 0;
const PLATE_LIFT_FT = 0.05;

/** Signed sPMV to a colour on the ramp. Pure, and clamped at both ends. */
function heatColor(sPmv: number, theme: Theme): THREE.Color {
  const stops = HEAT[theme];
  const v = Number.isFinite(sPmv) ? sPmv : 0;
  const t = Math.min(1, Math.abs(v) / HEAT_FULL_SCALE);
  const end = v < 0 ? stops.cold : stops.warm;
  return new THREE.Color(stops.neutral).lerp(new THREE.Color(end), t);
}

/* ------------------------------------------------------------------ theme */

function useTheme(): Theme {
  // Starts light and corrects after mount: `currentTheme()` reads the DOM, and
  // this component is client-only, but the first render still has to be
  // deterministic for React to be happy about it.
  const [theme, setTheme] = useState<Theme>("light");
  useEffect(() => {
    setTheme(currentTheme());
    return onThemeChange(setTheme);
  }, []);
  return theme;
}

interface NavigatorWithMemory extends Navigator {
  deviceMemory?: number;
}

function runtimeBuilderQuality(): BuilderSceneQuality {
  if (typeof window === "undefined") {
    return selectBuilderSceneQuality({
      width: 1280,
      devicePixelRatio: 1,
      reducedMotion: false,
    });
  }

  const nav = navigator as NavigatorWithMemory;
  return selectBuilderSceneQuality({
    width: window.innerWidth,
    devicePixelRatio: window.devicePixelRatio || 1,
    deviceMemoryGb: nav.deviceMemory,
    hardwareConcurrency: nav.hardwareConcurrency,
    reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  });
}

/* ------------------------------------------------------------------ parts */

function PartMesh({
  part,
  night,
  surfaces,
  clipPlanes = null,
  ghost = false,
}: {
  part: Part;
  night: boolean;
  surfaces: ViewportSurfaces | null;
  /** the section cut, or null. A material property — see the tools note. */
  clipPlanes?: THREE.Plane[] | null;
  /** another floor is being looked at; this one stays in the scene, faintly */
  ghost?: boolean;
}) {
  /* `SurfaceMaterial` and `SurfaceStyle` are the same five fields under the
     same names, so the override path and the default path produce the same
     shape and everything below is untouched. */
  const s: SurfaceStyle = surfaces
    ? materialForPart(part, surfaces.index, surfaces.overrides)
    : SURFACES[part.surface];
  const lit = night && part.surface === "glass" && !ghost;
  const physical = part.surface === "glass" || part.surface === "water";
  const clip = clipPlanes && clipPlanes.length > 0 ? clipPlanes : null;
  return (
    <mesh
      geometry={part.geometry}
      /* the geometry belongs to BuilderApp — see rule 1 in the header */
      dispose={null}
      castShadow={!s.noShadow && !ghost}
      receiveShadow={!s.noShadow && !ghost}
    >
      {physical ? (
        <meshPhysicalMaterial
          color={s.color}
          roughness={s.roughness}
          metalness={s.metalness}
          flatShading={false}
          transparent
          opacity={ghost ? GHOST_OPACITY : s.opacity ?? 0.88}
          depthWrite={!ghost}
          transmission={part.surface === "glass" ? Math.min(0.42, s.transmission ?? 0.28) : 0}
          thickness={part.surface === "glass" ? 0.12 : 0.04}
          ior={s.ior ?? 1.4}
          clearcoat={s.clearcoat ?? (part.surface === "water" ? 0.72 : 0.35)}
          clearcoatRoughness={part.surface === "water" ? 0.08 : 0.22}
          emissive={lit ? "#ffc98a" : "#000000"}
          emissiveIntensity={lit ? WORLD.dark.glow : 0}
          side={THREE.DoubleSide}
          clippingPlanes={clip}
          clipShadows={clip !== null}
        />
      ) : (
        <meshStandardMaterial
          color={s.color}
          roughness={s.roughness}
          metalness={s.metalness}
          flatShading={!s.smooth}
          transparent={ghost}
          opacity={ghost ? GHOST_OPACITY : 1}
          depthWrite={!ghost}
          emissive={lit ? "#ffc98a" : "#000000"}
          emissiveIntensity={lit ? WORLD.dark.glow : 0}
          clippingPlanes={clip}
          clipShadows={clip !== null}
        />
      )}
    </mesh>
  );
}

function VolumeGroup({
  volume,
  night,
  onSelect,
  surfaces,
  clipPlanes = null,
  ghost = false,
}: {
  volume: VolumeGeometry;
  night: boolean;
  onSelect: (id: string) => void;
  surfaces: ViewportSurfaces | null;
  clipPlanes?: THREE.Plane[] | null;
  ghost?: boolean;
}) {
  return (
    <group
      position={[volume.origin[0], volume.origin[1], volume.origin[2]]}
      rotation={[0, volume.rotationY, 0]}
      onClick={(e: ThreeEvent<MouseEvent>) => {
        // Without stopPropagation the click also reaches the volume behind
        // this one and selection flickers between the two.
        e.stopPropagation();
        onSelect(volume.id);
      }}
    >
      {volume.parts.map((p) => (
        <PartMesh
          key={p.id}
          part={p}
          night={night}
          surfaces={surfaces}
          clipPlanes={clipPlanes}
          ghost={ghost}
        />
      ))}
    </group>
  );
}

/**
 * The one piece of renderer state a section cut needs.
 *
 * `localClippingEnabled` lives on the WebGLRenderer, and R3F builds exactly one
 * renderer per `<Canvas>` — this component is inside the BUILDER's canvas, so
 * the flag it sets is the builder renderer's own. The landing page's story
 * scene is a different `<Canvas>` with a different renderer and cannot see it.
 * The previous value is restored on unmount rather than assumed false, so this
 * stays true even if something else ever wants clipping in the same scene.
 */
function ClippingRig({ enabled }: { enabled: boolean }) {
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    const previous = gl.localClippingEnabled;
    gl.localClippingEnabled = enabled;
    invalidate();
    return () => {
      gl.localClippingEnabled = previous;
      invalidate();
    };
  }, [gl, enabled, invalidate]);
  return null;
}

/* -------------------------------------------------------------- furniture */

/** The ground the home stands on, and the grid that gives the eye a scale.
 *  Both carry EXPORT_IGNORE — a .glb of an Aura home does not contain a lawn. */
function Site({ theme, site }: { theme: Theme; site?: BuilderSite | null }) {
  const w = WORLD[theme];
  /* B-P1: the ground follows the site's slope answer. A flat site keeps the
     single quad it always had; a sloped one gets a displaced grid, built
     once per site from the pure gradeHeightFt so the render and the pile
     schedule are measuring the same surface. */
  const groundGeometry = useMemo(() => {
    if (!site || site.grade === "flat" || !site.parcel || site.parcel.slope === "flat") return null;
    const SPAN = 600;
    const SEGMENTS = 96;
    const geometry = new THREE.PlaneGeometry(SPAN, SPAN, SEGMENTS, SEGMENTS);
    const position = geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < position.count; i += 1) {
      /* The plane is authored in its own XY and rotated -90° about X below,
         so its local +y becomes world −z. */
      const x = position.getX(i);
      const z = -position.getY(i);
      position.setZ(i, gradeHeightFt(x, z, site));
    }
    position.needsUpdate = true;
    geometry.computeVertexNormals();
    return geometry;
  }, [site]);

  useEffect(() => () => groundGeometry?.dispose(), [groundGeometry]);

  return (
    <group userData={{ [EXPORT_IGNORE]: true }}>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, GRADE_Y_FT, 0]}
        receiveShadow
        userData={{ [EXPORT_IGNORE]: true }}
        {...(groundGeometry ? { geometry: groundGeometry } : {})}
      >
        {groundGeometry ? null : <planeGeometry args={[600, 600]} />}
        <meshStandardMaterial color={w.ground} roughness={1} metalness={0} />
      </mesh>
      {/* 5-foot squares out to 200 feet: a scale you can count, not a texture */}
      <gridHelper
        args={[400, 80, w.gridAxis, w.grid]}
        position={[0, GRADE_Y_FT + 0.03, 0]}
        userData={{ [EXPORT_IGNORE]: true }}
      />
      {/* North. The site frame fixes north at −Z (geometry.ts), and every
          solar claim on this page depends on the viewer knowing which way
          that is. */}
      <mesh position={[0, GRADE_Y_FT + 0.05, -60]} userData={{ [EXPORT_IGNORE]: true }}>
        <boxGeometry args={[0.6, 0.08, 120]} />
        <meshBasicMaterial color={w.gridAxis} />
      </mesh>
    </group>
  );
}

/** The selection: a soft plate on the ground under the chosen volume, at its
 *  own rotation. Not an outline — an outline on a rotated rectangle is a
 *  hand-built LineLoop with its own disposal problem, and this reads better.
 *
 *  The plate's size comes off the summary's world plan corners rather than
 *  from the spec, so this component needs nothing but the geometry it is
 *  already given. Edge 0→1 of that ring is always the volume's WIDTH edge
 *  (`volumeCornersPlan` emits width first, and `ccw` can only reverse the
 *  ring, which maps edge 0→1 onto the opposite width edge). */
function SelectionPlate({
  volume,
  summary,
}: {
  volume: VolumeGeometry;
  summary: VolumeSummary;
}) {
  const p = summary.plan;
  if (p.length !== 4) return null;
  const widthFt = Math.hypot(p[1][0] - p[0][0], p[1][1] - p[0][1]);
  const depthFt = Math.hypot(p[2][0] - p[1][0], p[2][1] - p[1][1]);
  return (
    <group
      position={[volume.origin[0], GRADE_Y_FT + 0.08, volume.origin[2]]}
      rotation={[0, volume.rotationY, 0]}
      userData={{ [EXPORT_IGNORE]: true }}
    >
      {/* the group yaws, the mesh lies down — composing both on one Euler is
          where a sign error would hide */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} userData={{ [EXPORT_IGNORE]: true }}>
        <planeGeometry args={[widthFt + 3, depthFt + 3]} />
        <meshBasicMaterial color="#10b981" transparent opacity={0.18} />
      </mesh>
    </group>
  );
}

/**
 * The comfort heatmap: one plate per solved room, on the finished floor.
 *
 * THREE THINGS IT IS CAREFUL ABOUT, and they are the same three the rest of
 * this file keeps:
 *
 * 1. IT IS A SIBLING OF THE EXPORT ROOT, never a child, and every mesh carries
 *    `EXPORT_IGNORE`. A .glb of an Aura home does not contain a comfort study
 *    any more than it contains the lawn or the selection glow.
 * 2. IT OWNS ITS GEOMETRY THE WAY `Site` AND `SelectionPlate` DO — an inline
 *    `planeGeometry`, built and freed by R3F. Rule 1 in the header is about
 *    the BufferGeometries `BuilderApp` hands over; nothing here is one.
 * 3. IT DOES NOT LIGHT. `meshBasicMaterial`, so a plate reads as the same
 *    colour at midnight as at noon — a heatmap that changed hue with the sun
 *    slider would be a heatmap you could not read.
 *
 * IT IS AN X-RAY, AND THAT IS THE ONLY WAY IT WORKS. The plates lie on the
 * FINISHED FLOOR, which is inside the shell, under the roof — depth-tested
 * they would be invisible from every camera position this viewport allows.
 * So `depthTest` is off and `renderOrder` puts them last: the overlay draws
 * over the building, the way an analysis layer in any BIM viewer does. It is
 * unmistakably a diagram rather than a surface of the house, which is exactly
 * what it is, and it is off by default so the model still reads as a house.
 *
 * The plates are inset a few inches so two rooms sharing a wall read as two
 * rooms rather than one wash of colour.
 */
function ComfortLayer({ comfort, theme }: { comfort: ViewportComfort; theme: Theme }) {
  return (
    <group
      position={[0, FINISHED_FLOOR_Y_FT + PLATE_LIFT_FT, 0]}
      userData={{ [EXPORT_IGNORE]: true }}
    >
      {comfort.plates.map((p) => {
        const w = Math.max(0.25, p.widthFt - 0.35);
        const d = Math.max(0.25, p.depthFt - 0.35);
        return (
          <mesh
            key={p.id}
            position={[p.xFt, 0, p.zFt]}
            rotation={[-Math.PI / 2, 0, 0]}
            renderOrder={10}
            userData={{ [EXPORT_IGNORE]: true }}
          >
            <planeGeometry args={[w, d]} />
            <meshBasicMaterial
              color={
                p.modelled ? heatColor(p.sPmv, theme) : theme === "light" ? "#817f76" : "#858a84"
              }
              transparent
              /* louder when the room misses its target, quieter when it meets
                 — the colour says which way, the weight says whether */
              opacity={p.meets === null ? 0.24 : p.meets ? 0.4 : 0.62}
              depthTest={false}
              depthWrite={false}
            />
          </mesh>
        );
      })}
    </group>
  );
}

/** The sun itself, so the slider moves something visible rather than a number. */
function SunMarker({ sun, distance, theme }: { sun: SunPosition; distance: number; theme: Theme }) {
  if (!sun.aboveHorizon) return null;
  const [x, y, z] = sun.direction;
  return (
    <mesh
      position={[x * distance, y * distance, z * distance]}
      userData={{ [EXPORT_IGNORE]: true }}
    >
      <sphereGeometry args={[distance * 0.035, 16, 12]} />
      <meshBasicMaterial color={WORLD[theme].sun} />
    </mesh>
  );
}

/**
 * The geometry currently in the scene, named in one string.
 *
 * It is a PROJECTION of the built `HomeGeometry`, never a second measurement
 * of it: every field is read straight off the summary `geometry.ts` produced,
 * so it cannot disagree with what the canvas is drawing. Two readers share it
 * — the contact-shadow key, which has to re-bake when the massing moves, and
 * the `data-scene-geometry` attribute a test can watch to see an edit arrive.
 * One source, two readers, rather than two formulas for one fact.
 *
 * WHAT IT DOES NOT COVER, deliberately: finishes, comfort plates, the sun and
 * the ground are not geometry, and a signature that moved when a wall was
 * repainted would tell a reader the shape had changed when it had not.
 */
function sceneSignature(home: HomeGeometry): string {
  const b = home.summary.boundsWithRoof;
  return `${home.volumes.length}-${b.minX}-${b.maxX}-${b.minZ}-${b.maxZ}-${home.summary.totalFloorAreaSqFt}`;
}

/** Draw one frame whenever React commits a change to the scene. This is what
 *  makes `frameloop="demand"` safe: every slider, every theme flip and every
 *  rebuild passes through a render of this component's parent. */
function Refresh() {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    invalidate();
  });
  return null;
}

/* ------------------------------------------------------------- the scene */

function Scene({
  home,
  sun,
  theme,
  selectedId,
  onSelect,
  houseRef,
  surfaces,
  comfort,
  houseChildren,
  quality,
  site,
  tools,
}: {
  home: HomeGeometry;
  sun: SunPosition;
  theme: Theme;
  selectedId: string | null;
  onSelect: (id: string) => void;
  houseRef: MutableRefObject<THREE.Group | null>;
  surfaces: ViewportSurfaces | null;
  comfort: ViewportComfort | null;
  houseChildren: ReactNode;
  quality: BuilderSceneQuality;
  site: BuilderSite | null;
  tools: ViewportTools | null;
}) {
  const w = WORLD[theme];
  const night = theme === "dark";
  const selected = home.volumes.find((v) => v.id === selectedId) ?? null;
  const selectedSummary = home.summary.volumes.find((v) => v.id === selectedId) ?? null;

  /* The shadow camera is sized from the model rather than fixed, because a
     14-foot cabin and a 70-foot cluster want very different boxes: too big and
     every shadow is a soft grey smear, too small and half the house casts
     nothing at all. */
  const b = home.summary.boundsWithRoof;
  const radius = Math.max(
    24,
    Math.abs(b.minX),
    Math.abs(b.maxX),
    Math.abs(b.minZ),
    Math.abs(b.maxZ),
    home.summary.maxRidgeHeightFt,
  );
  const shadowSpan = radius + 25;
  const sunDistance = Math.max(150, radius * 4);
  const [sx, sy, sz] = sun.direction;
  const shadowKey = sceneSignature(home);

  /* The tools, unpacked once. `solo === null` is the ordinary state and every
     volume is solid; a non-null list names the floor being looked at. */
  const clipPlanes = tools && tools.clipPlanes.length > 0 ? tools.clipPlanes : null;
  const solo = tools?.soloVolumeIds ?? null;
  const isGhost = (id: string) => solo !== null && !solo.includes(id);

  return (
    <>
      <Refresh />
      <ClippingRig enabled={clipPlanes !== null} />
      <color attach="background" args={[w.sky]} />
      <fog attach="fog" args={[w.sky, Math.max(120, radius * 4), Math.max(700, radius * 18)]} />

      <Environment resolution={quality.environmentResolution} frames={1}>
        <mesh scale={90}>
          <sphereGeometry args={[1, 12, 12]} />
          <meshBasicMaterial color={w.sky} side={THREE.BackSide} />
        </mesh>
        <Lightformer intensity={night ? 0.7 : 2.2} position={[8, 12, 7]} scale={[10, 7, 1]} color={w.sun} />
        <Lightformer intensity={night ? 0.35 : 0.8} position={[-10, 6, -8]} scale={[12, 5, 1]} color={w.sky} />
      </Environment>

      <hemisphereLight color={w.sky} groundColor={w.ground} intensity={w.hemi} />
      <ambientLight intensity={w.ambient} />
      <directionalLight
        castShadow={sun.aboveHorizon}
        position={[sx * sunDistance, Math.max(sy, 0.02) * sunDistance, sz * sunDistance]}
        color={w.sun}
        /* Below the horizon the key is off, not dim: a sun that lights the
           south wall at midnight would quietly undo the whole point of the
           slider. What is left is sky and ambient, which is what dusk is. */
        intensity={sun.aboveHorizon ? w.key * Math.min(1, 0.35 + sun.altitudeDeg / 45) : 0}
        shadow-mapSize={[quality.shadowMapSize, quality.shadowMapSize]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
        shadow-camera-left={-shadowSpan}
        shadow-camera-right={shadowSpan}
        shadow-camera-top={shadowSpan}
        shadow-camera-bottom={-shadowSpan}
        shadow-camera-near={1}
        shadow-camera-far={sunDistance * 2.4}
      />
      {/* North fill, so the shaded elevations read as surfaces rather than as
          holes. Deliberately weak — it is not a second sun. */}
      <directionalLight position={[-radius, radius * 1.4, -radius * 1.6]} color={w.sky} intensity={0.18} />

      <Site theme={theme} site={site} />
      <ContactShadows
        key={shadowKey}
        position={[0, GRADE_Y_FT + 0.045, 0]}
        scale={shadowSpan * 2}
        opacity={night ? 0.58 : 0.38}
        blur={2.6}
        far={Math.max(45, radius * 3)}
        resolution={quality.contactShadowResolution}
        frames={1}
        color={night ? "#050807" : "#314137"}
      />
      <SunMarker sun={sun} distance={sunDistance} theme={theme} />
      {selected && selectedSummary ? (
        <SelectionPlate volume={selected} summary={selectedSummary} />
      ) : null}
      {comfort ? <ComfortLayer comfort={comfort} theme={theme} /> : null}

      {/* THE EXPORT ROOT — volumes and deck, nothing else. */}
      <group ref={houseRef}>
        {home.volumes.map((v) => (
          <VolumeGroup
            key={v.id}
            volume={v}
            night={night}
            onSelect={onSelect}
            surfaces={surfaces}
            clipPlanes={clipPlanes}
            ghost={isGhost(v.id)}
          />
        ))}
        {home.deck ? (
          <group
            position={[home.deck.origin[0], home.deck.origin[1], home.deck.origin[2]]}
            rotation={[0, home.deck.rotationY, 0]}
          >
            {home.deck.parts.map((p) => (
              <PartMesh
                key={p.id}
                part={p}
                night={night}
                surfaces={surfaces}
                clipPlanes={clipPlanes}
                /* the deck belongs to no storey, so an isolated floor ghosts
                   it rather than pretending it is on that floor */
                ghost={solo !== null}
              />
            ))}
          </group>
        ) : null}
        {/* Anything the builder places INSIDE the home — today the fixture
            layer. It belongs in here so a .glb of an Aura home contains the
            wood stove; the clearance boxes that come with it carry
            EXPORT_IGNORE and stay behind, which is the whole reason
            `FixtureLayer` renders them as siblings of the fixture. */}
        {houseChildren}
      </group>

      {/* The pick layer is a SIBLING of the export root, never a child: it
          washes the picked surface in emerald, and a .glb of an Aura home
          does not contain a selection glow. It raycasts `houseRef` only, so
          the ground, the grid and its own highlight can never be picked. */}
      {surfaces ? (
        <SurfacePickLayer
          home={home}
          index={surfaces.index}
          root={houseRef}
          picked={surfaces.picked}
          onPick={surfaces.onPick}
          enabled={surfaces.enabled}
          clipPlanes={clipPlanes}
        />
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------- the canvas */

/** Applies the framing whenever a WHOLE document arrives (plan chosen,
 *  project opened, link imported). Lives inside the Canvas because the
 *  `camera` prop is mount-only and the demand frameloop needs the poke.
 *  `saveState()` is the important line: it re-bases the "Frame the home"
 *  button so reset() restores the NEW home's framing, not the first one's. */
function ReframeOnLoad({
  epoch,
  initial,
  controls,
}: {
  epoch: number;
  initial: {
    distance: number;
    height: number;
    position: [number, number, number];
    target: [number, number, number];
  };
  controls: MutableRefObject<ElementRef<typeof OrbitControls> | null>;
}) {
  const { camera, invalidate } = useThree();
  useEffect(() => {
    camera.position.set(...initial.position);
    const orbit = controls.current;
    if (orbit) {
      orbit.target.set(...initial.target);
      orbit.update();
      orbit.saveState();
    }
    invalidate();
    // `initial` changes identity exactly when `epoch` does; both listed so a
    // future refactor of either cannot silently detach the reframe.
  }, [camera, controls, epoch, initial, invalidate]);
  return null;
}

export default function Viewport({
  home,
  sun,
  hour,
  selectedId,
  onSelect,
  houseRef,
  loadEpoch = 0,
  surfaces = null,
  comfort = null,
  houseChildren = null,
  site = null,
  tools = null,
}: {
  home: HomeGeometry;
  sun: SunPosition;
  hour: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  houseRef: MutableRefObject<THREE.Group | null>;
  /** The land under the home. Null keeps the flat datum the builder has
   *  always drawn; a sloped site displaces the ground under it. */
  site?: BuilderSite | null;
  /** bumped by BuilderApp only when a whole document loads — the one signal
   *  the camera reframes on. Edits and undo never move it. */
  loadEpoch?: number;
  /** omit for the plain viewport; pass it to make surfaces pickable */
  surfaces?: ViewportSurfaces | null;
  /** omit — or pass `null` — for no heatmap, which is the default state */
  comfort?: ViewportComfort | null;
  /** R3F nodes to mount INSIDE the export root, beside the volumes and the
   *  deck. `BuilderApp` passes the fixture layer here. */
  houseChildren?: ReactNode;
  /** the section cut and the floor isolation, already derived. Omit — or pass
   *  `null` — for the plain viewport, which is the default state. */
  tools?: ViewportTools | null;
}) {
  const theme = useTheme();
  const controls = useRef<ElementRef<typeof OrbitControls>>(null);
  const runtimeDegraded = useRef(false);
  const [quality, setQuality] = useState<BuilderSceneQuality>(runtimeBuilderQuality);

  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const refreshQuality = () => {
      const next = runtimeBuilderQuality();
      setQuality(runtimeDegraded.current ? degradeBuilderSceneQuality(next) : next);
    };
    refreshQuality();
    window.addEventListener("resize", refreshQuality, { passive: true });
    motion.addEventListener("change", refreshQuality);
    return () => {
      window.removeEventListener("resize", refreshQuality);
      motion.removeEventListener("change", refreshQuality);
    };
  }, []);

  /* The camera is framed per LOADED DOCUMENT, and the orbit TARGET is fixed
     with it. Re-deriving on every edit would yank the view out from under
     somebody nudging a slider — so the deps are the load epoch, never the
     home: choosing a plan or opening a project reframes to fit the new
     massing, while every slider drag inside a document leaves the camera
     exactly where it was. "Frame the home" restores this framing. */
  const initial = useMemo(() => {
    return cameraFrameForSummary(home.summary);
    // `home` deliberately unlisted: the epoch names the moments a reframe is
    // wanted, and the closure reads the home THAT load delivered.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadEpoch]);

  const frame = () => controls.current?.reset();

  return (
    <div
      data-builder-quality={quality.tier}
      data-load-epoch={loadEpoch}
      /* The shape on screen, readable from outside the canvas. WebGL renders
         to pixels a test cannot ask questions of, so the geometry the scene
         was handed is published here instead — it moves the moment an edit
         reaches the viewer and holds still when nothing about the shape
         changed. */
      data-scene-geometry={sceneSignature(home)}
      /* What the viewer tools are doing to that geometry, published for the
         same reason: a cut and a ghosted floor are invisible to a test that
         can only read pixels. Deliberately SEPARATE from the signature above —
         a tool changes what is drawn, never what was built. */
      data-section-planes={tools ? tools.clipPlanes.length : 0}
      data-solo-volumes={tools?.soloVolumeIds ? tools.soloVolumeIds.join(" ") : "all"}
      data-frame-target-x={initial.target[0].toFixed(3)}
      data-frame-target-z={initial.target[2].toFixed(3)}
      className="builder-viewport relative overflow-hidden rounded-2xl bg-aura-sunken"
    >
      {/* The class is the layout hook the builder stage sizes against; the
          utilities remain the default shape wherever no stage rule applies. */}
      <div className="builder-viewport__stage aspect-[16/10] min-h-[22rem] w-full lg:aspect-[16/9] lg:min-h-[34rem]">
        <Canvas
          shadows
          dpr={[1, quality.maxDpr]}
          /* nothing in this scene animates on its own — see rule 3 */
          frameloop={quality.frameloop}
          camera={{
            fov: 38,
            near: 1,
            far: 3000,
            position: initial.position,
          }}
          gl={{ antialias: true, powerPreference: "high-performance" }}
          onCreated={({ gl }) => {
            gl.toneMapping = THREE.ACESFilmicToneMapping;
            gl.toneMappingExposure = 1.05;
            const context = gl.getContext();
            const debug = context.getExtension("WEBGL_debug_renderer_info");
            const renderer = String(
              debug
                ? context.getParameter(debug.UNMASKED_RENDERER_WEBGL)
                : context.getParameter(context.RENDERER),
            );
            if (/swiftshader|llvmpipe|software/i.test(renderer)) {
              runtimeDegraded.current = true;
              setQuality((current) => degradeBuilderSceneQuality(current));
            }
          }}
        >
          <Scene
            home={home}
            sun={sun}
            theme={theme}
            selectedId={selectedId}
            onSelect={onSelect}
            houseRef={houseRef}
            surfaces={surfaces}
            comfort={comfort}
            houseChildren={houseChildren}
            quality={quality}
            site={site}
            tools={tools}
          />
          {/* Renders nothing. It registers the capture the project library
              asks for when it saves a thumbnail, and it has to be INSIDE this
              canvas: `frameloop="demand"` with the default
              `preserveDrawingBuffer: false` means the back buffer is only
              readable in the same synchronous turn as the draw. */}
          <ThumbnailProbe />
          <ReframeOnLoad epoch={loadEpoch} initial={initial} controls={controls} />
          <OrbitControls
            ref={controls}
            makeDefault
            enableDamping
            dampingFactor={0.09}
            target={initial.target}
            minDistance={12}
            maxDistance={900}
            /* stop just short of level so the camera never drops below grade
               and looks up at the underside of the world */
            maxPolarAngle={Math.PI / 2 - 0.035}
          />
        </Canvas>
      </div>

      {/* ---------------------------------------------------------- overlay */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-wrap items-start justify-between gap-3 p-3">
        <div className="rounded-md border aura-hairline bg-aura-panel/85 px-3 py-2 backdrop-blur">
          <p className="font-mono text-[0.6rem] uppercase tracking-label text-aura-emerald">
            {hourLabel(hour)} solar
          </p>
          <p className="mt-1 font-mono text-[0.65rem] tabular-nums text-aura-text/70">
            {sun.aboveHorizon
              ? `sun ${Math.round(sun.altitudeDeg)}° up, ${bearingWords(sun.azimuthDeg)}`
              : "sun below the horizon"}
          </p>
          {/* WHAT THE TOOLS ARE DOING, ON THE VIEW ITSELF. A cut face is not
              capped, so the inside of a wall reads as hollow — somebody who
              cannot see that sentence will believe the wall is empty. */}
          {tools && tools.clipPlanes.length > 0 ? (
            <p className="mt-1.5 max-w-[16rem] font-mono text-[0.55rem] leading-relaxed text-aura-violet">
              Section cut · the cut face is not capped, so a wall reads hollow where the plane
              crosses it
            </p>
          ) : null}
          {tools?.soloVolumeIds ? (
            <p className="mt-1.5 max-w-[16rem] font-mono text-[0.55rem] leading-relaxed text-aura-violet">
              One floor isolated · the others are ghosted, not removed, and every export still
              contains the whole home
            </p>
          ) : null}
        </div>
        <div className="pointer-events-auto flex gap-2">
          <button
            type="button"
            onClick={frame}
            data-cursor="Select"
            className="rounded-full border aura-hairline bg-aura-panel/85 px-3 py-1.5 font-mono text-[0.6rem] uppercase tracking-label text-aura-text/70 backdrop-blur transition-colors hover:border-aura-teal hover:text-aura-text"
          >
            Frame the home
          </button>
        </div>
      </div>

      {comfort ? <ComfortLegend comfort={comfort} /> : null}

      <p className="pointer-events-none absolute inset-x-0 bottom-0 p-3 text-center font-mono text-[0.6rem] uppercase tracking-label text-aura-text/45">
        Drag to orbit · scroll to zoom · click a volume to select it
        {surfaces?.enabled ? " · a click also picks that surface for the materials panel" : ""} ·
        north is away from you at the start
      </p>
    </div>
  );
}

/* ------------------------------------------------------------- the legend

   HTML, not R3F: it is chrome over the canvas, so it is styled with the same
   theme-aware `aura-*` utilities every other overlay on this page uses and
   there is not a literal colour in it. The three swatches resolve through the
   tonal ladder to the SAME hexes `HEAT` mirrors for the scene, which is what
   keeps a legend swatch and the plate it describes the same colour in both
   themes.

   THE ASSUMPTIONS ARE IN THE LEGEND, not in a panel three tabs away. A colour
   scale for a comfort figure is meaningless without the temperature and the
   humidity that produced it, so they are printed here, on the view, every
   time the overlay is on. */
function ComfortLegend({ comfort }: { comfort: ViewportComfort }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-9 flex justify-center p-3">
      <div className="max-w-lg rounded-md border aura-hairline bg-aura-panel/85 px-3 py-2 backdrop-blur">
        <p className="font-mono text-[0.6rem] uppercase tracking-label text-aura-emerald">
          {comfort.seasonLabel} comfort · sPMV
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
          <Swatch tone="bg-aura-teal-mark" label="cool −3" />
          <Swatch tone="bg-aura-emerald-bright" label="neutral 0" />
          <Swatch tone="bg-aura-violet" label="warm +3" />
        </div>
        <p className="mt-1.5 font-mono text-[0.6rem] leading-relaxed text-aura-text/70">
          {comfort.conditions}
        </p>
        <p className="mt-1 font-mono text-[0.55rem] leading-relaxed text-aura-text/45">
          Assumed conditions you set — not a prediction. The plan engine&rsquo;s solved rooms, on
          the finished floor at the site origin, drawn over the massing rather than inside it.
        </p>
      </div>
    </div>
  );
}

function Swatch({ tone, label }: { tone: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span aria-hidden className={`h-2 w-4 rounded-sm ${tone}`} />
      <span className="font-mono text-[0.55rem] uppercase tracking-label text-aura-text/70">
        {label}
      </span>
    </span>
  );
}
