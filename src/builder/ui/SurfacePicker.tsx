"use client";

/* ===========================================================================
   THE SURFACE PICKER — click a surface, choose what it is made of.

   `lib/builder/surfaces.ts` owns the thinking: what a surface is CALLED, how
   that name survives an edit, which material it wears, and how a ray turns
   back into a name. This file owns none of that. It is two pieces of interface
   over that module and nothing more:

     <SurfacePickLayer>  goes INSIDE the <Canvas>. It turns a click on the
                         canvas into a surface id, and washes the picked
                         surface in the same emerald mark the volume selection
                         plate uses so the choice is visible in the model.
     <SurfacePicker>     the DOM panel. Shows what is picked, offers materials,
                         lists every assignment made so far, and undoes any of
                         them.

   WIRING, because this component owns no state (`BuilderApp` owns the spec,
   and the same rule applies here):

       const index = useMemo(() => buildSurfaceIndex(home, spec), [home, spec]);
       const [overrides, setOverrides] = useState(NO_OVERRIDES);
       const [picked, setPicked] = useState<SurfaceId | null>(null);
       useEffect(() => setOverrides((o) => pruneOverrides(spec, o)), [spec]);

   inside <Canvas>, as a SIBLING of the house group — never inside it, because
   the house group is the export root and a .glb of an Aura home does not
   contain a selection glow:

       <SurfacePickLayer home={home} index={index} root={houseRef}
                         picked={picked} onPick={setPicked} />

   and in the page:

       <SurfacePicker index={index} overrides={overrides} picked={picked}
                      onPick={setPicked} onChange={setOverrides} />

   The viewport then asks `materialForPart(part, index, overrides)` instead of
   reading its own `SURFACES` table, and that is the whole integration.

   TWO THINGS THIS FILE IS CAREFUL ABOUT
   -------------------------------------
   1. NOT A COLOUR IN A className OR A style. The whole panel is the aura-*
      tonal ladder, so it repaints correctly at 2 a.m. like the rest of the
      site. The one place a real colour has to appear is a material swatch —
      and a swatch is a DRAWING of the material, so it is drawn: an inline
      <svg> whose fill is the palette value, with its border in `currentColor`
      so the chrome round it still follows the theme. A charred-timber chip
      that turned pale at night would be lying about the material.
   2. IT OWNS NO GEOMETRY. The highlight meshes reuse the builder's own
      BufferGeometry instances, so every one carries `dispose={null}` — the
      same rule `Viewport.tsx` keeps, and for the same reason: R3F would
      otherwise free buffers the model is still drawing with.
   =========================================================================== */

import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { HomeGeometry, Part } from "../core/geometry";
import { EXPORT_IGNORE } from "./exportMark";
import {
  MATERIALS,
  PICK_HIGHLIGHT_COLOR,
  countOverrides,
  isOverridden,
  materialForRef,
  materialsFor,
  overrideEntries,
  pickSurface,
  setSurfaceMaterial,
  type SurfaceId,
  type SurfaceIndex,
  type SurfaceMaterial,
  type SurfaceOverrides,
  type SurfaceRef,
} from "../core/surfaces";
import { restrictRayToSection } from "./viewerTools";
import { Panel } from "./ui";

/* ===========================================================================
   THE CANVAS SIDE
   =========================================================================== */

/** How far the pointer may travel between down and up and still count as a
 *  click rather than an orbit. Four pixels is below what a hand does when it
 *  means to click and well under what a drag does. */
const CLICK_SLOP_PX = 4;

export function SurfacePickLayer({
  home,
  index,
  root,
  picked,
  onPick,
  enabled = true,
  clipPlanes = null,
}: {
  home: HomeGeometry;
  index: SurfaceIndex;
  /** the export root: the group holding the volumes and the deck, nothing else */
  root: MutableRefObject<THREE.Group | null>;
  picked: SurfaceId | null;
  onPick: (id: SurfaceId | null) => void;
  enabled?: boolean;
  /** VW02's section cut. Clipping happens in the fragment shader and the
   *  raycaster knows nothing about it, so without this a click over a cut
   *  home would pick the wall the cut just took away. */
  clipPlanes?: THREE.Plane[] | null;
}) {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);

  /* Our own raycaster rather than R3F's shared one: this fires from a DOM
     event outside the render loop, and mutating the instance the renderer is
     about to use is the kind of shared state that works until it does not. */
  const ray = useMemo(() => new THREE.Raycaster(), []);
  const ndc = useMemo(() => new THREE.Vector2(), []);
  const down = useRef<{ x: number; y: number } | null>(null);

  /* The index is rebuilt on every edit and `onPick` may well arrive as an
     inline arrow, so both are read through a ref. Otherwise the listener would
     detach and reattach on every frame of a slider drag — harmless in cost,
     but it makes the subscription depend on the caller's memoisation habits,
     and a picker that quietly stops working because somebody inlined a
     callback is a bad afternoon. */
  const live = useRef({ index, onPick, clipPlanes });
  live.current = { index, onPick, clipPlanes };

  useEffect(() => {
    if (!enabled) return;
    const el = gl.domElement;

    const onDown = (e: PointerEvent) => {
      down.current = e.button === 0 ? { x: e.clientX, y: e.clientY } : null;
    };

    const onUp = (e: PointerEvent) => {
      const start = down.current;
      down.current = null;
      if (!start || e.button !== 0) return;
      // An orbit drag is not a pick. Without this, letting go of the camera
      // repaints whatever happened to be under the cursor.
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > CLICK_SLOP_PX) return;

      const group = root.current;
      if (!group) return;

      const rect = el.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      ndc.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      ray.setFromCamera(ndc, camera);

      // The section cut, honoured for picking as well as for drawing.
      // `false` means the ray never reaches the half that is still on screen.
      if (!restrictRayToSection(ray, live.current.clipPlanes ?? [])) {
        live.current.onPick(null);
        invalidate();
        return;
      }

      const hit = pickSurface(live.current.index, ray, group);
      // A click on the sky clears the selection, which is what every editor
      // does and what makes "nothing is picked" reachable without a button.
      live.current.onPick(hit ? hit.ref.id : null);
      invalidate();
    };

    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointerup", onUp);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointerup", onUp);
    };
  }, [enabled, gl, camera, root, invalidate, ray, ndc]);

  /* ---- the highlight -------------------------------------------------- */

  if (!picked) return null;

  const wash = (parts: readonly Part[], key: string, origin: readonly [number, number, number], rotationY: number) => {
    const mine = parts.filter((p) => index.byGeometry.get(p.geometry)?.id === picked);
    if (mine.length === 0) return null;
    return (
      <group
        key={key}
        position={[origin[0], origin[1], origin[2]]}
        rotation={[0, rotationY, 0]}
        userData={{ [EXPORT_IGNORE]: true }}
      >
        {mine.map((p) => (
          <mesh key={p.id} geometry={p.geometry} dispose={null} userData={{ [EXPORT_IGNORE]: true }}>
            {/* Pulled toward the camera and writing no depth, so it washes the
                surface it is copying instead of fighting it — and depth TEST
                stays on, so a highlighted wall is still hidden by the one in
                front of it. */}
            <meshBasicMaterial
              color={PICK_HIGHLIGHT_COLOR}
              transparent
              opacity={0.38}
              depthWrite={false}
              toneMapped={false}
              polygonOffset
              polygonOffsetFactor={-4}
              polygonOffsetUnits={-4}
              /* the wash is a copy of the surface, so it is cut with it —
                 otherwise a highlight floats in the air over the cut face */
              clippingPlanes={clipPlanes && clipPlanes.length > 0 ? clipPlanes : null}
            />
          </mesh>
        ))}
      </group>
    );
  };

  return (
    <group userData={{ [EXPORT_IGNORE]: true }}>
      {home.volumes.map((v) => wash(v.parts, v.id, v.origin, v.rotationY))}
      {home.deck ? wash(home.deck.parts, "deck", home.deck.origin, home.deck.rotationY) : null}
    </group>
  );
}

/* ===========================================================================
   THE SWATCH — the only place a real colour is drawn, and it is drawn
   =========================================================================== */

function Swatch({ material, size = 22 }: { material: SurfaceMaterial; size?: number }) {
  const translucent = material.opacity !== undefined;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      className="shrink-0"
    >
      {/* a tonal backing, so a translucent material reads as translucent
          against the panel it is sitting on rather than as a pale solid */}
      {translucent ? (
        <rect x="0.5" y="0.5" width="23" height="23" rx="5" fill="currentColor" fillOpacity="0.14" />
      ) : null}
      <rect
        x="0.5"
        y="0.5"
        width="23"
        height="23"
        rx="5"
        fill={material.color}
        fillOpacity={material.opacity ?? 1}
      />
      {/* the sheen a low-roughness surface has, and a rough one does not */}
      <path
        d="M0.5 12 L12 0.5 L23.5 0.5 L23.5 5 L5 23.5 L0.5 23.5 Z"
        fill="#ffffff"
        fillOpacity={Math.max(0, 0.42 * (1 - material.roughness))}
      />
      <rect
        x="0.5"
        y="0.5"
        width="23"
        height="23"
        rx="5"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.22"
      />
    </svg>
  );
}

/* ===========================================================================
   THE PANEL
   =========================================================================== */

function MaterialChip({
  material,
  active,
  onChoose,
}: {
  material: SurfaceMaterial;
  active: boolean;
  onChoose: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onChoose}
      aria-pressed={active}
      title={material.note}
      data-cursor="Select"
      className={`flex items-center gap-2.5 rounded-md border px-3 py-2 text-left text-xs transition-colors ${
        active
          ? "border-aura-emerald text-aura-text"
          : "aura-hairline text-aura-text/65 hover:text-aura-text"
      }`}
    >
      <Swatch material={material} />
      <span className="leading-tight">{material.label}</span>
    </button>
  );
}

/** Every surface on the model, grouped, as buttons.
 *
 *  This exists because a <canvas> is not reachable from a keyboard. Somebody
 *  who cannot click a wall in a 3D view can still select it here and paint it,
 *  which is the difference between a feature and a feature for some people. */
function SurfaceList({
  index,
  overrides,
  picked,
  onPick,
}: {
  index: SurfaceIndex;
  overrides: SurfaceOverrides;
  picked: SurfaceId | null;
  onPick: (id: SurfaceId) => void;
}) {
  const groups = useMemo(() => {
    const order: string[] = [];
    const bucket: Record<string, SurfaceRef[]> = {};
    for (const ref of index.surfaces) {
      if (!bucket[ref.group]) {
        bucket[ref.group] = [];
        order.push(ref.group);
      }
      bucket[ref.group].push(ref);
    }
    return order.map((name) => ({ name, refs: bucket[name] }));
  }, [index]);

  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <div key={g.name}>
          <p className="aura-label mb-2">{g.name}</p>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {g.refs.map((ref) => {
              const on = ref.id === picked;
              const changed = isOverridden(ref.id, overrides);
              const material = materialForRef(ref, overrides);
              return (
                <button
                  key={ref.id}
                  type="button"
                  onClick={() => onPick(ref.id)}
                  aria-pressed={on}
                  title={ref.id}
                  data-cursor="Select"
                  className={`flex items-center gap-2.5 rounded-md border px-3 py-2 text-left text-xs transition-colors ${
                    on
                      ? "border-aura-emerald text-aura-text"
                      : "aura-hairline text-aura-text/65 hover:text-aura-text"
                  }`}
                >
                  <Swatch material={material} size={18} />
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className="block truncate">{ref.label}</span>
                    <span
                      className={`block truncate font-mono text-[0.6rem] ${
                        changed ? "text-aura-emerald" : "text-aura-text/45"
                      }`}
                    >
                      {material.label}
                      {changed ? " · changed" : ""}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function SurfacePicker({
  index,
  overrides,
  picked,
  onPick,
  onChange,
}: {
  index: SurfaceIndex;
  overrides: SurfaceOverrides;
  picked: SurfaceId | null;
  onPick: (id: SurfaceId | null) => void;
  onChange: (next: SurfaceOverrides) => void;
}) {
  const ref = picked ? index.byId.get(picked) ?? null : null;
  const current = ref ? materialForRef(ref, overrides) : null;
  const palette = useMemo(() => (ref ? materialsFor(ref.surface) : null), [ref]);
  const applied = overrideEntries(overrides);
  const changedCount = countOverrides(overrides);

  const assign = (material: SurfaceMaterial | null) => {
    if (!picked) return;
    onChange(setSurfaceMaterial(overrides, picked, material ? material.id : null));
  };

  return (
    <Panel
      label="Materials"
      hint={
        <>
          Click any surface in the view above — a wall, the roof, a window frame, the deck — and
          choose what it is made of. Assignments are held against the SURFACE, not against its
          size: resize the volume, change the roof form, move a window to another elevation, and
          the finish stays where you put it.
        </>
      }
      right={
        changedCount > 0 ? (
          <span className="font-mono text-[0.6rem] uppercase tracking-label text-aura-emerald">
            {changedCount} surface{changedCount === 1 ? "" : "s"} changed
          </span>
        ) : null
      }
    >
      <div className="space-y-6">
        {/* ------------------------------------------------ what is picked */}
        <div className="rounded-md border aura-hairline px-4 py-3">
          {picked && !ref ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs leading-relaxed text-aura-text/70">
                That surface is not on the model any more. It may belong to a volume you removed,
                or to a wall a change of roof form took away.
              </p>
              <button
                type="button"
                onClick={() => onPick(null)}
                data-cursor="Select"
                className="rounded-full border aura-hairline px-4 py-1.5 font-mono text-xs uppercase tracking-label text-aura-text/70 transition-colors hover:border-aura-teal hover:text-aura-text"
              >
                Clear
              </button>
            </div>
          ) : ref && current ? (
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex min-w-0 items-center gap-3">
                <Swatch material={current} size={30} />
                <div className="min-w-0">
                  <p className="truncate text-sm text-aura-text">
                    {ref.label}
                    <span className="text-aura-text/45"> · {ref.group}</span>
                  </p>
                  <p className="mt-0.5 truncate font-mono text-[0.6rem] uppercase tracking-label text-aura-text/45">
                    {current.label} · {ref.partCount} piece{ref.partCount === 1 ? "" : "s"}
                  </p>
                </div>
              </div>
              {isOverridden(ref.id, overrides) ? (
                <button
                  type="button"
                  onClick={() => assign(null)}
                  data-cursor="Select"
                  className="rounded-full border aura-hairline px-4 py-1.5 font-mono text-xs uppercase tracking-label text-aura-text/70 transition-colors hover:border-aura-teal hover:text-aura-text"
                >
                  Use the default
                </button>
              ) : null}
            </div>
          ) : (
            <p className="text-xs leading-relaxed text-aura-text/60">
              Nothing is picked. Click a surface in the view above, or choose one from the list
              further down — the list is there because a 3D canvas cannot be reached from a
              keyboard.
            </p>
          )}
        </div>

        {/* ------------------------------------------------- the materials */}
        {ref && current && palette ? (
          <div className="space-y-4">
            <div>
              <p className="aura-label mb-2">For this surface</p>
              <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                {palette.recommended.map((m) => (
                  <MaterialChip
                    key={m.id}
                    material={m}
                    active={m.id === current.id}
                    onChoose={() => assign(m)}
                  />
                ))}
              </div>
              <p className="mt-2 text-xs leading-snug text-aura-text/55">{current.note}</p>
            </div>

            {palette.others.length > 0 ? (
              <details className="rounded-md border aura-hairline px-4 py-3">
                <summary
                  data-cursor="Select"
                  className="cursor-pointer font-mono text-[0.6rem] uppercase tracking-label text-aura-text/55"
                >
                  Everything else in the palette
                </summary>
                <div className="mt-3 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                  {palette.others.map((m) => (
                    <MaterialChip
                      key={m.id}
                      material={m}
                      active={m.id === current.id}
                      onChoose={() => assign(m)}
                    />
                  ))}
                </div>
                <p className="mt-3 text-xs leading-relaxed text-aura-text/55">
                  Nothing is withheld. These are the materials that are unusual on this kind of
                  surface, not the ones that are wrong — a charred-timber soffit is a decision, and
                  the tool should not argue with it.
                </p>
              </details>
            ) : null}
          </div>
        ) : null}

        {/* ------------------------------------------- everything on the model */}
        <details className="rounded-md border aura-hairline px-4 py-3" open={!picked}>
          <summary
            data-cursor="Select"
            className="cursor-pointer font-mono text-[0.6rem] uppercase tracking-label text-aura-text/55"
          >
            Every surface on this home ({index.surfaces.length})
          </summary>
          <div className="mt-4">
            <SurfaceList index={index} overrides={overrides} picked={picked} onPick={onPick} />
          </div>
        </details>

        {/* -------------------------------------------------- what changed */}
        {applied.length > 0 ? (
          <div className="rounded-md border border-aura-emerald px-4 py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <p className="aura-label text-aura-emerald">Your finishes</p>
              <button
                type="button"
                onClick={() => onChange({})}
                data-cursor="Select"
                className="rounded-full border aura-hairline px-4 py-1 font-mono text-[0.6rem] uppercase tracking-label text-aura-text/70 transition-colors hover:border-aura-teal hover:text-aura-text"
              >
                Reset all
              </button>
            </div>
            <ul className="mt-3 space-y-1.5">
              {applied.map(({ id, material }) => {
                const target = index.byId.get(id);
                return (
                  <li key={id} className="flex items-center gap-3 text-xs text-aura-text/80">
                    <Swatch material={material} size={16} />
                    <span className="min-w-0 flex-1 truncate">
                      {target ? target.label + ", " + target.group : id}
                      <span className="text-aura-text/45"> — {material.label}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => onChange(setSurfaceMaterial(overrides, id, null))}
                      title="Back to the default"
                      data-cursor="Select"
                      className="shrink-0 font-mono text-[0.6rem] uppercase tracking-label text-aura-text/50 transition-colors hover:text-aura-text"
                    >
                      Undo
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        {/* THE HONESTY LINE. Two different things are called "material" in this
            tool and confusing them would be expensive. */}
        <p className="border-t aura-hairline pt-4 text-xs leading-relaxed text-aura-text/60">
          These are FINISHES, and they change what the model looks like. They do not change the
          structural material of the home — that is the panel choice above, and it is what sets
          wall thickness, the R-value, the plan and the price. Nothing on this panel moves a
          number on the drawing, and no finish here has been checked against a fire, exposure or
          cladding requirement.
        </p>
      </div>
    </Panel>
  );
}

/* ===========================================================================
   THE QUICK SWITCH — the same feature, at arm's length from the model

   VW02 asked for a material switch in the viewer's tool row. This is NOT a
   second material system: it is the same `materialsFor` palette, the same
   `MaterialChip`, the same `setSurfaceMaterial` writer and the same override
   map the panel below the model edits. Painting here and painting there are
   one undo step apart and byte-identical in the document, because they are
   literally the same call.

   WHAT IT ADDS over the panel is reach. The panel lives in the controls column
   and the model lives in the view column; on a phone that is a scroll away.
   Clicking a wall and then choosing cedar should not require leaving the wall.

   `unavailable` IS THE HONEST STATE, not a disabled button. Finishes are a
   legacy-geometry feature today — see the note in `BuilderApp` — and a chip
   row greyed out with no explanation is exactly the thing this project keeps
   refusing to ship. */

export function SurfaceQuickSwitch({
  index,
  overrides,
  picked,
  onChange,
  unavailable = null,
}: {
  index: SurfaceIndex;
  overrides: SurfaceOverrides;
  picked: SurfaceId | null;
  onChange: (next: SurfaceOverrides) => void;
  /** why finishes cannot be assigned on this document, or null when they can */
  unavailable?: string | null;
}) {
  const ref = picked ? index.byId.get(picked) ?? null : null;
  const current = ref ? materialForRef(ref, overrides) : null;
  const palette = useMemo(() => (ref ? materialsFor(ref.surface) : null), [ref]);

  if (unavailable) {
    return (
      <p className="text-xs leading-relaxed text-aura-text/60" data-tool-finishes="unavailable">
        {unavailable}
      </p>
    );
  }

  if (!ref || !current || !palette) {
    return (
      <p className="text-xs leading-relaxed text-aura-text/60" data-tool-finishes="unpicked">
        Click any surface in the model to change what it is made of. Every choice is also in the
        materials panel below, which is reachable from a keyboard.
      </p>
    );
  }

  return (
    <div className="space-y-2" data-tool-finishes="picked" data-tool-surface={ref.id}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 truncate text-xs text-aura-text/80">
          {ref.label}
          <span className="text-aura-text/45"> · {ref.group}</span>
        </p>
        {isOverridden(ref.id, overrides) ? (
          <button
            type="button"
            onClick={() => onChange(setSurfaceMaterial(overrides, ref.id, null))}
            data-cursor="Select"
            className="shrink-0 font-mono text-[0.6rem] uppercase tracking-label text-aura-text/50 transition-colors hover:text-aura-text"
          >
            Use the default
          </button>
        ) : null}
      </div>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {palette.recommended.map((m) => (
          <MaterialChip
            key={m.id}
            material={m}
            active={m.id === current.id}
            onChoose={() => onChange(setSurfaceMaterial(overrides, ref.id, m.id))}
          />
        ))}
      </div>
    </div>
  );
}

/* Re-exported so a caller can hold the whole feature from one import. */
export { MATERIALS };
