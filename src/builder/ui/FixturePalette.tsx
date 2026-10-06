"use client";

/* ===========================================================================
   THE FIXTURE PALETTE — and the layer that draws what it places.

   Two exports, one file, on purpose:

     <FixturePalette>  the DOM panel. Add a fixture, morph its named
                       dimensions, move it, and read its clearances with the
                       provenance of every number attached.
     <FixtureLayer>    the R3F group. Mount it inside the viewport's export
                       root; it renders `buildFixtureGeometry`'s output.

   They share no state. Both are controlled: the FixtureSet lives in the
   integrator's reducer beside the HomeSpec, and every edit here comes back as
   a whole new set through `onChange`. `lib/builder/fixtures.ts` owns the
   snapping, the clearances and the schedule; this file owns none of that and
   deliberately recomputes nothing.

   THE COLOUR RULE. Not one hex value in a className or a style attribute —
   everything resolves through the aura-* tonal ladder, so the panel repaints
   correctly when the site flips to night. The only literal colours in this
   file are three.js material colours in `SURFACES` below, which is exactly
   where `components/builder/Viewport.tsx` keeps its own: a cedar tub is the
   same cedar after dark, and a WebGL material is not a CSS class.

   THE CLEARANCE RULE. A clearance box is a piece of the ROOM, not a piece of
   the object, so it is rendered as a SIBLING of the fixture group at the host
   frame — see `FixtureGroup` in fixtures.ts. Nesting it would apply the
   fixture's transform twice. Every clearance mesh also carries EXPORT_IGNORE:
   a .glb of an Aura home contains a wood stove, and does not contain the four
   feet of air around it.
   =========================================================================== */

import { useMemo, type ReactNode } from "react";
import type { ThreeEvent } from "@react-three/fiber";

import { EXPORT_IGNORE } from "./exportMark";
import type { HomeSpec, Wall } from "../core/spec";
import {
  CLEARANCE_BASIS_LABEL,
  FIXTURE_CATALOG,
  SOURCE_HONESTY,
  addFixture,
  bestRoofSlot,
  buildFixtureGeometry,
  clearanceSources,
  clearanceText,
  defaultDims,
  defaultOpts,
  feetInches,
  fixtureSchedule,
  floorRegions,
  isFurnitureKind,
  kindsByMount,
  morph,
  removeFixture,
  resolveFixtures,
  roofSlots,
  updateFixture,
  wallSlots,
  type FixtureGeometry,
  type FixtureGroup,
  type FixtureHost,
  type FixtureKind,
  type FixtureKindId,
  type FixtureMount,
  type FixturePart,
  type FixtureResolution,
  type FixtureSet,
  type FixtureSurface,
  type PlacedFixture,
} from "../core/fixtures";
import { Button, Notice, Panel, Segmented, Slider, TextInput } from "./ui";

/* ===========================================================================
   THE 3D LAYER
   =========================================================================== */

interface SurfaceStyle {
  color: string;
  roughness: number;
  metalness: number;
  opacity?: number;
  smooth?: boolean;
  noShadow?: boolean;
}

/* The same flat-shaded low-poly language as `components/story/Scene.tsx` and
   `Viewport.tsx`: standard materials, roughness doing the work, no textures.
   These are indicative objects, not product CAD. */
const SURFACES: Record<FixtureSurface, SurfaceStyle> = {
  stove: { color: "#23262a", roughness: 0.72, metalness: 0.28 },
  steel: { color: "#8d968f", roughness: 0.42, metalness: 0.6 },
  cabinet: { color: "#b9bdb6", roughness: 0.72, metalness: 0.14 },
  wood: { color: "#a97e57", roughness: 0.88, metalness: 0 },
  fabric: { color: "#9aa294", roughness: 0.96, metalness: 0 },
  porcelain: { color: "#e4e6e1", roughness: 0.24, metalness: 0.04, smooth: true },
  water: { color: "#4f8d86", roughness: 0.2, metalness: 0.1, opacity: 0.88, smooth: true, noShadow: true },
  pv: { color: "#1b2634", roughness: 0.18, metalness: 0.42 },
  glass: { color: "#a8cfd4", roughness: 0.08, metalness: 0.15, opacity: 0.4, noShadow: true },
  clearance: { color: "#10b981", roughness: 1, metalness: 0, opacity: 0.1, noShadow: true },
  "clearance-alert": { color: "#7c3aed", roughness: 1, metalness: 0, opacity: 0.22, noShadow: true },
};

function FixtureMesh({ part, selected }: { part: FixturePart; selected: boolean }) {
  const s = SURFACES[part.surface];
  return (
    <mesh
      geometry={part.geometry}
      /* the geometry belongs to whoever called buildFixtureGeometry — the same
         contract Viewport.tsx keeps with the shell */
      dispose={null}
      castShadow={!s.noShadow}
      receiveShadow={!s.noShadow}
    >
      <meshStandardMaterial
        color={s.color}
        roughness={s.roughness}
        metalness={s.metalness}
        flatShading={!s.smooth}
        transparent={s.opacity !== undefined}
        opacity={s.opacity ?? 1}
        emissive={selected ? "#10b981" : "#000000"}
        emissiveIntensity={selected ? 0.35 : 0}
      />
    </mesh>
  );
}

function ClearanceMesh({ part }: { part: FixturePart }) {
  const s = SURFACES[part.surface];
  return (
    <mesh geometry={part.geometry} dispose={null} userData={{ [EXPORT_IGNORE]: true }}>
      <meshBasicMaterial color={s.color} transparent opacity={s.opacity ?? 0.15} depthWrite={false} />
    </mesh>
  );
}

function Group({
  group,
  selected,
  onSelect,
}: {
  group: FixtureGroup;
  selected: boolean;
  onSelect?: (id: string) => void;
}) {
  return (
    <group position={[group.frame.origin[0], group.frame.origin[1], group.frame.origin[2]]} rotation={[0, group.frame.rotationY, 0]}>
      <group
        position={[group.position[0], group.position[1], group.position[2]]}
        rotation={[group.rotation[0], group.rotation[1], group.rotation[2]]}
        onClick={
          onSelect
            ? (e: ThreeEvent<MouseEvent>) => {
                // Without this the click also reaches the volume behind the
                // fixture and selection flickers between the two.
                e.stopPropagation();
                onSelect(group.id);
              }
            : undefined
        }
      >
        {group.parts.map((p) => (
          <FixtureMesh key={p.id} part={p} selected={selected} />
        ))}
      </group>
      {/* SIBLINGS, not children — see the header. */}
      {group.clearanceParts.map((p) => (
        <ClearanceMesh key={p.id} part={p} />
      ))}
    </group>
  );
}

/**
 * Every placed fixture, in one group per fixture.
 *
 * Mount it INSIDE the viewport's export root so fixtures travel with the .glb;
 * the clearance boxes carry EXPORT_IGNORE and will not.
 */
export function FixtureLayer({
  geometry,
  selectedId,
  onSelect,
}: {
  geometry: FixtureGeometry;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
}) {
  return (
    <>
      {geometry.groups.map((g) => (
        <Group key={g.id} group={g} selected={g.id === selectedId} onSelect={onSelect} />
      ))}
    </>
  );
}

/** Build the meshes for a spec + set in one call, memoised on the inputs.
 *  The caller still owns disposal — `disposeFixtureGeometry` in fixtures.ts. */
export function useFixtureGeometry(
  spec: HomeSpec,
  set: FixtureSet,
  showClearances: boolean,
): { resolution: FixtureResolution; geometry: FixtureGeometry } {
  return useMemo(() => {
    const resolution = resolveFixtures(spec, set);
    return { resolution, geometry: buildFixtureGeometry(resolution, { clearances: showClearances }) };
  }, [spec, set, showClearances]);
}

/* ===========================================================================
   THE PANEL
   =========================================================================== */

const MOUNT_LABEL: Record<FixtureMount, string> = {
  floor: "On the floor",
  wall: "On a wall",
  roof: "On the roof",
};

const MOUNT_HINT: Record<FixtureMount, string> = {
  floor: "Snaps to the floor and flat against a wall. Nothing can be placed outside the envelope.",
  wall: "Slides along a wall's run at a height. Windows and doors are NOT here — they are openings on the home itself.",
  roof: "Lands on a roof plane at that plane's own pitch.",
};

function Chip({ children, tone = "quiet" }: { children: ReactNode; tone?: "quiet" | "loud" | "alert" }) {
  const tones = {
    quiet: "border-aura-hairline text-aura-text/55",
    loud: "border-aura-emerald text-aura-emerald",
    alert: "border-aura-violet text-aura-violet",
  } as const;
  return (
    <span className={`rounded-full border px-2 py-0.5 font-mono text-[0.6rem] uppercase tracking-label ${tones[tone]}`}>
      {children}
    </span>
  );
}

function dimDisplay(unit: string): (v: number) => string {
  if (unit === "ft") return (v) => feetInches(v);
  if (unit === "count") return (v) => String(Math.round(v));
  return (v) => `${Number(v.toFixed(2))} ${unit}`;
}

const hostKey = (h: FixtureHost): string => (h.kind === "deck" ? "deck" : `v:${h.volumeId}`);
const hostFromKey = (key: string): FixtureHost =>
  key === "deck" ? { kind: "deck" } : { kind: "volume", volumeId: key.slice(2) };

/**
 * The palette.
 *
 * Controlled in full: it holds no fixture state of its own, so the integrator
 * can put the set in the same reducer as the HomeSpec, undo it with the same
 * history and put it in the same share link.
 */
export default function FixturePalette({
  spec,
  value,
  onChange,
  selectedId,
  onSelect,
  showClearances,
  onShowClearances,
  resolution,
}: {
  spec: HomeSpec;
  value: FixtureSet;
  onChange: (next: FixtureSet) => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  showClearances: boolean;
  onShowClearances: (next: boolean) => void;
  /** pass the resolution the viewport already built, so the panel and the
   *  scene can never disagree about what collides with what */
  resolution?: FixtureResolution;
}) {
  const res = useMemo(() => resolution ?? resolveFixtures(spec, value), [resolution, spec, value]);
  const rows = useMemo(() => fixtureSchedule(res), [res]);
  const sources = useMemo(() => clearanceSources(res), [res]);
  const regions = useMemo(() => floorRegions(spec), [spec]);

  const selected = value.items.find((i) => i.id === selectedId) ?? null;
  const selectedRow = rows.find((r) => r.id === selectedId) ?? null;
  const selectedResolved = res.items.find((r) => r.fixture.id === selectedId) ?? null;

  const blocked = res.issues.filter((i) => i.severity === "blocked");
  const checks = res.issues.filter((i) => i.severity === "check");

  const add = (kindId: FixtureKindId) => {
    const out = addFixture(spec, value, kindId);
    if (out.problem) return;
    onChange(out.set);
    if (out.id) onSelect(out.id);
  };

  const patch = (change: Partial<PlacedFixture>) => {
    if (!selected) return;
    onChange(updateFixture(spec, value, selected.id, change));
  };

  return (
    <div className="space-y-5">
      {/* --------------------------------------------------------- add ---- */}
      <Panel
        label="Fixtures"
        hint={
          <>
            The things an Aura home actually contains, placed against the shell rather than imagined onto it. Every
            one carries its clearances as data, and the clearance is what moves the plan.
          </>
        }
        right={
          <Button tone={showClearances ? "loud" : "quiet"} onClick={() => onShowClearances(!showClearances)}>
            {showClearances ? "Clearances on" : "Clearances off"}
          </Button>
        }
      >
        <div className="space-y-5">
          {(["floor", "wall", "roof"] as FixtureMount[]).map((mount) => {
            /* Split by `isFurnitureKind` rather than appending. The catalogue is
               mostly plant and mostly furniture at the same time, and a single
               flat wrap of twenty-odd buttons is a wall a person reads past —
               the two sub-lists below are the whole reason the grouping exists.
               Nothing is filtered OUT here: every kind of this mount lands in
               one of the two groups, so a new kind can never fall through. */
            const kinds = kindsByMount(mount);
            const groups: { key: string; label: string; items: FixtureKind[] }[] = [
              { key: "furniture", label: "Furniture", items: kinds.filter((k) => isFurnitureKind(k.id)) },
              { key: "systems", label: "Systems and equipment", items: kinds.filter((k) => !isFurnitureKind(k.id)) },
            ];
            return (
              <div key={mount}>
                <p className="aura-label">{MOUNT_LABEL[mount]}</p>
                <p className="mt-1.5 text-xs leading-snug text-aura-text/55">{MOUNT_HINT[mount]}</p>
                {groups
                  .filter((g) => g.items.length > 0)
                  .map((g) => (
                    <div key={g.key} className="mt-3">
                      {/* Only worth a heading when there is something to tell apart. */}
                      {groups.every((other) => other.items.length > 0) ? (
                        <p className="font-mono text-[0.6rem] uppercase tracking-label text-aura-text/45">{g.label}</p>
                      ) : null}
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {g.items.map((k) => (
                          <button
                            key={k.id}
                            type="button"
                            onClick={() => add(k.id)}
                            title={k.blurb}
                            data-cursor="Select"
                            className="rounded-md border aura-hairline px-3 py-2 text-left text-xs text-aura-text/70 transition-colors hover:border-aura-teal hover:text-aura-text"
                          >
                            <span className="font-mono text-[0.6rem] uppercase tracking-label text-aura-emerald">
                              {k.tag}
                            </span>
                            <span className="ml-2">{k.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
              </div>
            );
          })}
        </div>
      </Panel>

      {/* ------------------------------------------------------- placed ---- */}
      {rows.length > 0 ? (
        <Panel label={`Placed — ${rows.length}`} hint="Select one to morph it, move it, and read its clearances.">
          <ul className="space-y-1.5">
            {rows.map((r) => {
              const on = r.id === selectedId;
              const bad = res.issues.some((i) => i.fixtureId === r.id && i.severity === "blocked");
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(on ? null : r.id)}
                    data-cursor="Select"
                    className={`w-full rounded-md border px-3 py-2.5 text-left transition-colors ${
                      on ? "border-aura-emerald" : "aura-hairline hover:border-aura-teal"
                    }`}
                  >
                    <span className="flex flex-wrap items-baseline gap-2">
                      <span className="font-mono text-[0.6rem] uppercase tracking-label text-aura-emerald">{r.tag}</span>
                      <span className="text-sm text-aura-text">{r.label}</span>
                      {bad ? <Chip tone="alert">Clash</Chip> : null}
                    </span>
                    <span className="mt-1 block text-xs leading-snug text-aura-text/55">{r.location}</span>
                    <span className="mt-0.5 block font-mono text-[0.65rem] tabular-nums text-aura-text/45">
                      {r.sizeText}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Panel>
      ) : null}

      {/* ------------------------------------------------------- editor ---- */}
      {selected && selectedRow && selectedResolved ? (
        <Panel
          label={`${selectedRow.tag} · ${FIXTURE_CATALOG[selected.kind].label}`}
          hint={FIXTURE_CATALOG[selected.kind].blurb}
          right={
            <Button
              tone="danger"
              onClick={() => {
                onChange(removeFixture(value, selected.id));
                onSelect(null);
              }}
            >
              Remove
            </Button>
          }
        >
          <div className="space-y-6">
            <TextInput
              label="Label"
              value={selected.label}
              placeholder={FIXTURE_CATALOG[selected.kind].label}
              maxLength={60}
              onChange={(label) => patch({ label })}
            />

            {/* ---- morph -------------------------------------------------- */}
            <div className="space-y-4">
              <p className="aura-label">Dimensions</p>
              <p className="-mt-2 text-xs leading-snug text-aura-text/55">
                Each slider changes ONE named dimension and the object is rebuilt from the set. Nothing here scales a
                mesh, which is why a longer sofa keeps its arms and a taller cabinet keeps its plinth.
              </p>
              {FIXTURE_CATALOG[selected.kind].dimensions.map((d) => (
                <Slider
                  key={d.key}
                  label={d.label}
                  value={selected.dims[d.key] ?? d.default}
                  min={d.min}
                  max={d.max}
                  step={d.step}
                  hint={d.hint}
                  display={dimDisplay(d.unit)}
                  onChange={(v) =>
                    patch({ dims: morph(FIXTURE_CATALOG[selected.kind], selected.dims, d.key, v) })
                  }
                />
              ))}
              {FIXTURE_CATALOG[selected.kind].dimensions.length === 0 ? (
                <p className="text-xs text-aura-text/55">This fixture has no adjustable dimensions.</p>
              ) : null}
            </div>

            {/* ---- options ------------------------------------------------ */}
            {FIXTURE_CATALOG[selected.kind].options.map((o) => (
              <Segmented
                key={o.key}
                label={o.label}
                hint={
                  <>
                    {o.hint ? `${o.hint} ` : null}
                    {o.choices.find((c) => c.id === (selected.options[o.key] ?? o.default))?.note}
                  </>
                }
                value={selected.options[o.key] ?? o.default}
                options={o.choices.map((c) => ({ id: c.id, label: c.label, title: c.note }))}
                onChange={(v) => patch({ options: { ...selected.options, [o.key]: v } })}
              />
            ))}

            {/* ---- placement ---------------------------------------------- */}
            <PlacementEditor
              spec={spec}
              item={selected}
              kind={FIXTURE_CATALOG[selected.kind]}
              regions={regions}
              onPatch={patch}
            />

            {/* ---- facts --------------------------------------------------- */}
            {selectedRow.facts.length > 0 ? (
              <div>
                <p className="aura-label">What that means</p>
                <ul className="mt-2.5 space-y-2.5">
                  {selectedRow.facts.map((f) => (
                    <li key={f.key} className="rounded-md border aura-hairline px-3.5 py-2.5">
                      <p className="aura-label text-aura-teal">{f.label}</p>
                      <p className="mt-1 text-sm text-aura-text">{f.text}</p>
                      {f.note ? (
                        <p className="mt-1 text-xs leading-relaxed text-aura-text/55">{f.note}</p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {/* ---- clearances ---------------------------------------------- */}
            {selectedRow.clearances.length > 0 ? (
              <div>
                <p className="aura-label">Clearances</p>
                <ul className="mt-2.5 space-y-2.5">
                  {selectedRow.clearances.map((c) => (
                    <li
                      key={c.key}
                      className={`rounded-md border px-3.5 py-2.5 ${
                        c.satisfied ? "aura-hairline" : "border-aura-violet"
                      }`}
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="text-sm text-aura-text">{c.label}</p>
                        <p className="font-mono text-xs tabular-nums text-aura-text/70">{c.text}</p>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <Chip tone={c.basis === "code" ? "loud" : "quiet"}>{CLEARANCE_BASIS_LABEL[c.basis]}</Chip>
                        <Chip tone={c.satisfied ? "quiet" : "alert"}>{c.satisfied ? "Clear" : "Obstructed"}</Chip>
                      </div>
                      <p className="mt-2 text-xs leading-relaxed text-aura-text/60">
                        <span className="text-aura-text/45">Source: </span>
                        {c.source}
                      </p>
                      <p className="mt-1.5 text-xs leading-relaxed text-aura-text/60">{c.note}</p>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {selectedResolved.notes.length > 0 ? (
              <ul className="space-y-1.5">
                {selectedResolved.notes.map((n) => (
                  <li key={n} className="text-xs leading-relaxed text-aura-text/55">
                    {n}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </Panel>
      ) : null}

      {/* ------------------------------------------------------ problems ---- */}
      <Notice title="Clashes" items={blocked.map((i) => i.message)} />
      <Notice title="Worth checking" items={checks.map((i) => i.message)} />
      <Notice title="About this set" items={res.warnings} />

      {/* ------------------------------------------------------- honesty ---- */}
      {rows.length > 0 ? (
        <Panel label="Where these numbers came from">
          <p className="text-xs leading-relaxed text-aura-text/70">{SOURCE_HONESTY}</p>
          {sources.length > 0 ? (
            <ul className="mt-4 space-y-2">
              {sources.map((s) => (
                <li key={`${s.basis}::${s.source}`} className="flex flex-wrap items-baseline gap-2">
                  <Chip tone={s.basis === "code" ? "loud" : "quiet"}>{s.basis}</Chip>
                  <span className="text-xs leading-relaxed text-aura-text/60">{s.source}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </Panel>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------- placement UI */

function PlacementEditor({
  spec,
  item,
  kind,
  regions,
  onPatch,
}: {
  spec: HomeSpec;
  item: PlacedFixture;
  kind: FixtureKind;
  regions: ReturnType<typeof floorRegions>;
  onPatch: (change: Partial<PlacedFixture>) => void;
}) {
  const p = item.placement;

  if (p.mount === "floor") {
    const region = regions.find((r) => hostKey(r.host) === hostKey(p.host)) ?? regions[0];
    if (!region) return null;
    return (
      <div className="space-y-4">
        <p className="aura-label">Where it stands</p>
        <Segmented
          label="Room"
          value={hostKey(p.host)}
          options={regions.map((r) => ({ id: hostKey(r.host), label: r.label }))}
          onChange={(key) => onPatch({ placement: { ...p, host: hostFromKey(key) } })}
        />
        <Slider
          label="East–west"
          value={p.x}
          min={Number(region.minX.toFixed(2))}
          max={Number(region.maxX.toFixed(2))}
          step={0.25}
          display={feetInches}
          onChange={(x) => onPatch({ placement: { ...p, x } })}
        />
        <Slider
          label="North–south"
          value={p.z}
          min={Number(region.minZ.toFixed(2))}
          max={Number(region.maxZ.toFixed(2))}
          step={0.25}
          display={feetInches}
          onChange={(z) => onPatch({ placement: { ...p, z } })}
        />
        <Slider
          label="Facing"
          value={p.rotationDeg}
          min={0}
          max={345}
          step={15}
          display={(v) => `${v}°`}
          hint="Drag it within a foot or so of a wall and it turns square and seats flat against it."
          onChange={(rotationDeg) => onPatch({ placement: { ...p, rotationDeg } })}
        />
      </div>
    );
  }

  if (p.mount === "wall") {
    const slots = wallSlots(spec, p.volumeId);
    const slot = slots.find((s) => s.wall === p.wall) ?? slots[0];
    if (!slot) return null;
    return (
      <div className="space-y-4">
        <p className="aura-label">Where it hangs</p>
        {spec.volumes.length > 1 ? (
          <Segmented
            label="Volume"
            value={p.volumeId}
            options={spec.volumes.map((v) => ({ id: v.id, label: v.name }))}
            onChange={(volumeId) => onPatch({ placement: { ...p, volumeId } })}
          />
        ) : null}
        <Segmented
          label="Wall"
          value={p.wall}
          columns={4}
          options={slots.map((s) => ({
            id: s.wall,
            label: s.wall.toUpperCase(),
            title: s.built ? `${feetInches(s.runFt)} of built wall` : "This roof form builds no wall here",
          }))}
          onChange={(wall) => onPatch({ placement: { ...p, wall: wall as Wall } })}
        />
        <Segmented
          label="Face"
          value={p.face}
          options={[
            { id: "inside", label: "Inside" },
            { id: "outside", label: "Outside" },
          ]}
          onChange={(face) => onPatch({ placement: { ...p, face: face as "inside" | "outside" } })}
        />
        <Slider
          label="Along the wall"
          value={p.offsetFt}
          min={0}
          max={Number(slot.runFt.toFixed(2))}
          step={0.25}
          display={feetInches}
          hint="From the left end, looking at the wall from outside — the same origin an opening's offset uses."
          onChange={(offsetFt) => onPatch({ placement: { ...p, offsetFt } })}
        />
        <Slider
          label="Height above floor"
          value={p.heightFt}
          min={0}
          max={Number(Math.max(1, slot.topProfile[slot.topProfile.length - 1]?.[1] ?? 9).toFixed(2))}
          step={0.25}
          display={feetInches}
          hint="Centre of the fixture. It is held under the wall's top edge, which slopes on a gable end."
          onChange={(heightFt) => onPatch({ placement: { ...p, heightFt } })}
        />
      </div>
    );
  }

  const slots = roofSlots(spec, p.volumeId);
  const slot = slots[p.planeIndex] ?? slots[0];
  if (!slot) return null;
  const best = bestRoofSlot(spec, p.volumeId);
  const aMin = Math.min(slot.plane.a0, slot.plane.a1);
  const aMax = Math.max(slot.plane.a0, slot.plane.a1);
  return (
    <div className="space-y-4">
      <p className="aura-label">Which roof plane</p>
      {spec.volumes.length > 1 ? (
        <Segmented
          label="Volume"
          value={p.volumeId}
          options={spec.volumes.map((v) => ({ id: v.id, label: v.name }))}
          onChange={(volumeId) => onPatch({ placement: { ...p, volumeId, planeIndex: 0 } })}
        />
      ) : null}
      <Segmented
        label="Plane"
        value={String(p.planeIndex)}
        options={slots.map((s) => ({
          id: String(s.planeIndex),
          label: `${s.pitchDeg.toFixed(0)}° ${compass(s.azimuthDeg)}`,
          title: `${s.areaSqFt.toFixed(0)} sq ft of roof measured on the slope`,
        }))}
        hint={
          best
            ? `The most southerly plane on this volume faces ${compass(best.azimuthDeg)} at ${best.pitchDeg.toFixed(0)}°. An array's yield is not estimated here — tilt, azimuth, shading and snow all decide it.`
            : undefined
        }
        onChange={(v) => onPatch({ placement: { ...p, planeIndex: Number(v) } })}
      />
      <Slider
        label="Up / down the slope"
        value={p.a}
        min={Number(aMin.toFixed(2))}
        max={Number(aMax.toFixed(2))}
        step={0.25}
        display={feetInches}
        onChange={(a) => onPatch({ placement: { ...p, a } })}
      />
      <Slider
        label="Across the slope"
        value={p.s}
        min={Number(slot.plane.s0.toFixed(2))}
        max={Number(slot.plane.s1.toFixed(2))}
        step={0.25}
        display={feetInches}
        onChange={(s) => onPatch({ placement: { ...p, s } })}
      />
      <p className="text-xs leading-relaxed text-aura-text/55">
        {kind.label} sits at the plane&rsquo;s own pitch of {slot.pitchDeg.toFixed(1)}°. It is held inside an edge
        setback; fire-service access setbacks are set by the authority having jurisdiction and are not assumed here.
      </p>
    </div>
  );
}

function compass(deg: number): string {
  const d = ((deg % 360) + 360) % 360;
  return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(d / 45) % 8];
}

/* Re-exported so an integrator wiring this panel does not have to import from
   two places to get the one call it needs alongside it. */
export { defaultDims, defaultOpts, clearanceText };
