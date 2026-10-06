/**
 * The durable Aura builder document.
 *
 * UI state never belongs here. A selected tab, camera, active season, hover,
 * or heatmap toggle may change how this document is viewed, but none changes
 * the building a person has asked Aura to remember, export, quote, or hash.
 */

import {
  legacySpecToBuildingGraph,
  validateBuildingGraph,
  type BuildingGraph,
} from "./buildingGraph";

import {
  DEFAULT_SETTINGS,
  type ComfortSettings,
  type ComfortTarget,
} from "./comfortTypes";
import {
  FIXTURES_VERSION,
  emptyFixtureSet,
  validateFixtureSet,
  type FixtureSet,
  type PlacedFixture,
} from "./fixtures";
import { defaultSpec, type HomeSpec } from "./spec";
import {
  NO_OVERRIDES,
  pruneOverrides,
  validateOverrides,
  type MaterialId,
  type SurfaceOverrides,
} from "./surfaces";
import { validateHomeSpec } from "./share";
import { validateBuilderSite, type BuilderSite } from "./site";
import type { Partition, PartitionDoor } from "./walls";

export const BUILDER_DOCUMENT_FORMAT = "aura-builder-document" as const;
export const BUILDER_DOCUMENT_VERSION = 2 as const;

/**
 * Version 1 still derives its shell geometry from `spec.volumes`. Naming that
 * source explicitly prevents a future graph document from being guessed at
 * or half-read as legacy massing.
 */
export interface LegacyVolumeGeometry {
  kind: "legacy-volumes";
  source: "spec.volumes";
}

export interface PlanarGraphGeometry {
  kind: "building-graph";
  graph: BuildingGraph;
  /** Exact pre-conversion geometry for recovery and future migrations. */
  legacyRecovery: HomeSpec;
  migrationWarnings: string[];
}

export type BuilderGeometry = LegacyVolumeGeometry | PlanarGraphGeometry;

export type QuarantineEntry =
  | { kind: "partition"; reason: string; value: Partition }
  | {
      kind: "finish";
      reason: string;
      value: { surfaceId: string; materialId: MaterialId };
    }
  | { kind: "fixture"; reason: string; value: PlacedFixture }
  | {
      kind: "comfort-target";
      reason: string;
      value: { roomId: string; target: ComfortTarget };
    };

export interface BuilderQuarantine {
  entries: QuarantineEntry[];
}

/**
 * The cost-model truth attached when a person starts from a catalog plan.
 * It is optional so existing v2 documents remain byte-for-byte canonical;
 * once present it travels with the design into save, share, budget and quote
 * hashes instead of being rediscovered from a mutable catalog entry.
 */
export interface BuilderPlanCostBasis {
  status: "modelled" | "proxy";
  label: string;
  note: string;
}

export interface BuilderPlanOrigin {
  templateId: string;
  templateTitle: string;
  costBasis: BuilderPlanCostBasis;
}

export interface BuilderDocument {
  format: typeof BUILDER_DOCUMENT_FORMAT;
  version: typeof BUILDER_DOCUMENT_VERSION;
  spec: HomeSpec;
  geometry: BuilderGeometry;
  partitions: Partition[];
  finishes: SurfaceOverrides;
  fixtures: FixtureSet;
  comfort: ComfortSettings;
  quarantine: BuilderQuarantine;
  planOrigin?: BuilderPlanOrigin;
  /** B-P1: the land under the home. OPTIONAL by the planOrigin precedent —
   * absent on every pre-site document, so v2 files and their hashes stay
   * byte-identical and share tokens (spec-level) are untouched. */
  site?: BuilderSite;
}

export type BuilderDocumentMigration =
  | "home-spec"
  | "editor-doc"
  | "builder-document-v1"
  | null;

export type BuilderDocumentValidation =
  | {
      ok: true;
      document: BuilderDocument;
      migratedFrom: BuilderDocumentMigration;
    }
  | {
      ok: false;
      problem: string;
      futureVersion?: number;
    };

const geometryFromLegacySpec = (): LegacyVolumeGeometry => ({
  kind: "legacy-volumes",
  source: "spec.volumes",
});

const emptyQuarantine = (): BuilderQuarantine => ({ entries: [] });

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

function validatePlanOrigin(raw: unknown):
  | { ok: true; planOrigin?: BuilderPlanOrigin }
  | { ok: false; problem: string } {
  if (raw === undefined) return { ok: true };
  if (!isObject(raw)) return { ok: false, problem: "planOrigin is not an object" };
  if (typeof raw.templateId !== "string" || raw.templateId.trim().length === 0) {
    return { ok: false, problem: "planOrigin.templateId must be a non-empty string" };
  }
  if (typeof raw.templateTitle !== "string" || raw.templateTitle.trim().length === 0) {
    return { ok: false, problem: "planOrigin.templateTitle must be a non-empty string" };
  }
  if (!isObject(raw.costBasis)) {
    return { ok: false, problem: "planOrigin.costBasis is not an object" };
  }
  if (raw.costBasis.status !== "modelled" && raw.costBasis.status !== "proxy") {
    return { ok: false, problem: "planOrigin.costBasis.status is not supported" };
  }
  if (typeof raw.costBasis.label !== "string" || raw.costBasis.label.trim().length === 0) {
    return { ok: false, problem: "planOrigin.costBasis.label must be a non-empty string" };
  }
  if (typeof raw.costBasis.note !== "string" || raw.costBasis.note.trim().length === 0) {
    return { ok: false, problem: "planOrigin.costBasis.note must be a non-empty string" };
  }
  return {
    ok: true,
    planOrigin: {
      templateId: raw.templateId,
      templateTitle: raw.templateTitle,
      costBasis: {
        status: raw.costBasis.status,
        label: raw.costBasis.label,
        note: raw.costBasis.note,
      },
    },
  };
}

function cloneComfortTarget(raw: unknown, path: string): { ok: true; target: ComfortTarget } | { ok: false; problem: string } {
  if (!isObject(raw)) return { ok: false, problem: `${path} is not an object` };
  const keys = [
    "winterMinC",
    "winterMaxC",
    "summerMinC",
    "summerMaxC",
    "humidityMinPct",
    "humidityMaxPct",
    "illuminanceMinLux",
  ] as const;
  for (const key of keys) {
    if (!isFiniteNumber(raw[key])) return { ok: false, problem: `${path}.${key} must be a finite number` };
  }
  const target: ComfortTarget = {
    winterMinC: raw.winterMinC as number,
    winterMaxC: raw.winterMaxC as number,
    summerMinC: raw.summerMinC as number,
    summerMaxC: raw.summerMaxC as number,
    humidityMinPct: raw.humidityMinPct as number,
    humidityMaxPct: raw.humidityMaxPct as number,
    illuminanceMinLux: raw.illuminanceMinLux as number,
  };
  if (target.winterMinC > target.winterMaxC)
    return { ok: false, problem: `${path}.winterMinC must not exceed winterMaxC` };
  if (target.summerMinC > target.summerMaxC)
    return { ok: false, problem: `${path}.summerMinC must not exceed summerMaxC` };
  if (
    target.humidityMinPct < 0 ||
    target.humidityMaxPct > 100 ||
    target.humidityMinPct > target.humidityMaxPct
  ) {
    return { ok: false, problem: `${path} has an invalid humidity band` };
  }
  if (target.illuminanceMinLux < 0)
    return { ok: false, problem: `${path}.illuminanceMinLux must not be negative` };
  return { ok: true, target };
}

function validateComfort(raw: unknown): { ok: true; settings: ComfortSettings } | { ok: false; problem: string } {
  if (!isObject(raw)) return { ok: false, problem: "comfort is not an object" };
  if (!isObject(raw.conditions)) return { ok: false, problem: "comfort.conditions is not an object" };
  const conditionKeys = [
    "winterIndoorC",
    "winterRhPct",
    "summerIndoorC",
    "summerRhPct",
  ] as const;
  for (const key of conditionKeys) {
    if (!isFiniteNumber(raw.conditions[key])) {
      return { ok: false, problem: `comfort.conditions.${key} must be a finite number` };
    }
  }
  const winterRhPct = raw.conditions.winterRhPct as number;
  const summerRhPct = raw.conditions.summerRhPct as number;
  if (winterRhPct < 0 || winterRhPct > 100)
    return { ok: false, problem: "comfort.conditions.winterRhPct must be between 0 and 100" };
  if (summerRhPct < 0 || summerRhPct > 100)
    return { ok: false, problem: "comfort.conditions.summerRhPct must be between 0 and 100" };
  if (!isObject(raw.targets)) return { ok: false, problem: "comfort.targets is not an object" };

  const targets: Record<string, ComfortTarget> = {};
  for (const roomId of Object.keys(raw.targets).sort()) {
    if (roomId.length === 0) return { ok: false, problem: "comfort.targets has an empty room id" };
    const result = cloneComfortTarget(raw.targets[roomId], `comfort.targets.${roomId}`);
    if (!result.ok) return result;
    targets[roomId] = result.target;
  }

  return {
    ok: true,
    settings: {
      conditions: {
        winterIndoorC: raw.conditions.winterIndoorC as number,
        winterRhPct,
        summerIndoorC: raw.conditions.summerIndoorC as number,
        summerRhPct,
      },
      targets,
    },
  };
}

function cloneDoor(raw: unknown, path: string): { ok: true; door: PartitionDoor | null } | { ok: false; problem: string } {
  if (raw === null) return { ok: true, door: null };
  if (!isObject(raw)) return { ok: false, problem: `${path} is not an object or null` };
  if (!isFiniteNumber(raw.atFt)) return { ok: false, problem: `${path}.atFt must be a finite number` };
  if (!isFiniteNumber(raw.widthFt) || raw.widthFt <= 0)
    return { ok: false, problem: `${path}.widthFt must be a positive finite number` };
  return { ok: true, door: { atFt: raw.atFt, widthFt: raw.widthFt } };
}

function clonePartition(raw: unknown, path: string): { ok: true; partition: Partition } | { ok: false; problem: string } {
  if (!isObject(raw)) return { ok: false, problem: `${path} is not an object` };
  if (typeof raw.id !== "string" || raw.id.length === 0)
    return { ok: false, problem: `${path}.id must be a non-empty string` };
  if (typeof raw.volumeId !== "string" || raw.volumeId.length === 0)
    return { ok: false, problem: `${path}.volumeId must be a non-empty string` };
  if (raw.axis !== "x" && raw.axis !== "z")
    return { ok: false, problem: `${path}.axis must be x or z` };
  for (const key of ["atFt", "fromFt", "toFt", "thicknessFt"] as const) {
    if (!isFiniteNumber(raw[key])) return { ok: false, problem: `${path}.${key} must be a finite number` };
  }
  if ((raw.thicknessFt as number) <= 0)
    return { ok: false, problem: `${path}.thicknessFt must be positive` };
  const door = cloneDoor(raw.door, `${path}.door`);
  if (!door.ok) return door;
  return {
    ok: true,
    partition: {
      id: raw.id,
      volumeId: raw.volumeId,
      axis: raw.axis,
      atFt: raw.atFt as number,
      fromFt: Math.min(raw.fromFt as number, raw.toFt as number),
      toFt: Math.max(raw.fromFt as number, raw.toFt as number),
      thicknessFt: raw.thicknessFt as number,
      door: door.door,
    },
  };
}

function validatePartitions(raw: unknown): { ok: true; partitions: Partition[] } | { ok: false; problem: string } {
  if (!Array.isArray(raw)) return { ok: false, problem: "partitions is not an array" };
  const partitions: Partition[] = [];
  const ids = new Set<string>();
  for (let index = 0; index < raw.length; index += 1) {
    const result = clonePartition(raw[index], `partitions[${index}]`);
    if (!result.ok) return result;
    if (ids.has(result.partition.id))
      return { ok: false, problem: `partitions contains duplicate id ${result.partition.id}` };
    ids.add(result.partition.id);
    partitions.push(result.partition);
  }
  return { ok: true, partitions };
}

function validateFinishes(raw: unknown): { ok: true; finishes: SurfaceOverrides } | { ok: false; problem: string } {
  if (!isObject(raw)) return { ok: false, problem: "finishes is not an object" };
  const finishes = validateOverrides(raw);
  const keys = Object.keys(raw);
  if (Object.keys(finishes).length !== keys.length || keys.some((key) => finishes[key] !== raw[key])) {
    return { ok: false, problem: "finishes contains an unknown surface id or material" };
  }
  return { ok: true, finishes };
}

function containsNonFiniteOrCycle(value: unknown, seen = new WeakSet<object>()): boolean {
  if (typeof value === "number") return !Number.isFinite(value);
  if (typeof value !== "object" || value === null) return false;
  if (seen.has(value)) return true;
  seen.add(value);
  const children = Array.isArray(value) ? value : Object.values(value);
  return children.some((child) => containsNonFiniteOrCycle(child, seen));
}

function validateFixtures(raw: unknown): { ok: true; fixtures: FixtureSet } | { ok: false; problem: string } {
  if (!isObject(raw) || !Array.isArray(raw.items))
    return { ok: false, problem: "fixtures is not a fixture set" };
  if (containsNonFiniteOrCycle(raw))
    return { ok: false, problem: "fixtures contains a non-finite number or circular value" };
  const fixtures = validateFixtureSet(raw);
  if (!fixtures || fixtures.items.length !== raw.items.length)
    return { ok: false, problem: "fixtures contains an invalid or unsupported fixture" };
  const ids = new Set(fixtures.items.map((item) => item.id));
  if (ids.size !== fixtures.items.length)
    return { ok: false, problem: "fixtures contains duplicate ids" };
  return { ok: true, fixtures };
}

function validateQuarantine(raw: unknown): { ok: true; quarantine: BuilderQuarantine } | { ok: false; problem: string } {
  if (!isObject(raw) || !Array.isArray(raw.entries))
    return { ok: false, problem: "quarantine.entries is not an array" };
  const entries: QuarantineEntry[] = [];
  for (let index = 0; index < raw.entries.length; index += 1) {
    const entry = raw.entries[index];
    const path = `quarantine.entries[${index}]`;
    if (!isObject(entry) || typeof entry.reason !== "string")
      return { ok: false, problem: `${path} is invalid` };
    if (entry.kind === "partition") {
      const result = clonePartition(entry.value, `${path}.value`);
      if (!result.ok) return result;
      entries.push({ kind: "partition", reason: entry.reason, value: result.partition });
      continue;
    }
    if (entry.kind === "finish") {
      if (!isObject(entry.value) || typeof entry.value.surfaceId !== "string" || typeof entry.value.materialId !== "string")
        return { ok: false, problem: `${path}.value is not a finish` };
      const one = validateFinishes({ [entry.value.surfaceId]: entry.value.materialId });
      if (!one.ok) return { ok: false, problem: `${path}.value is not a known finish` };
      entries.push({
        kind: "finish",
        reason: entry.reason,
        value: {
          surfaceId: entry.value.surfaceId,
          materialId: entry.value.materialId as MaterialId,
        },
      });
      continue;
    }
    if (entry.kind === "fixture") {
      const one = validateFixtures({ version: FIXTURES_VERSION, items: [entry.value] });
      if (!one.ok) return { ok: false, problem: `${path}.value is not a fixture` };
      entries.push({ kind: "fixture", reason: entry.reason, value: one.fixtures.items[0] });
      continue;
    }
    if (entry.kind === "comfort-target") {
      if (!isObject(entry.value) || typeof entry.value.roomId !== "string" || entry.value.roomId.length === 0)
        return { ok: false, problem: `${path}.value is not a comfort target` };
      const target = cloneComfortTarget(entry.value.target, `${path}.value.target`);
      if (!target.ok) return target;
      entries.push({
        kind: "comfort-target",
        reason: entry.reason,
        value: { roomId: entry.value.roomId, target: target.target },
      });
      continue;
    }
    return { ok: false, problem: `${path}.kind is not supported` };
  }
  return { ok: true, quarantine: { entries } };
}

function validateGeometry(raw: unknown): { ok: true; geometry: BuilderGeometry } | { ok: false; problem: string } {
  if (!isObject(raw)) return { ok: false, problem: "geometry is not an object" };
  if (raw.kind === "legacy-volumes" && raw.source === "spec.volumes") {
    return { ok: true, geometry: geometryFromLegacySpec() };
  }
  if (raw.kind !== "building-graph")
    return { ok: false, problem: "geometry is not a supported builder geometry" };
  const recovery = validateHomeSpec(raw.legacyRecovery);
  if (!recovery.ok) return { ok: false, problem: `geometry.legacyRecovery: ${recovery.problem}` };
  if (!Array.isArray(raw.migrationWarnings) || raw.migrationWarnings.some((item) => typeof item !== "string"))
    return { ok: false, problem: "geometry.migrationWarnings is not a string array" };
  let graph;
  try {
    graph = validateBuildingGraph(raw.graph as BuildingGraph);
  } catch (cause) {
    return {
      ok: false,
      problem: `geometry.graph could not be validated: ${cause instanceof Error ? cause.message : String(cause)}`,
    };
  }
  if (!graph.ok) return { ok: false, problem: `geometry.graph: ${graph.problem}` };
  return {
    ok: true,
    geometry: {
      kind: "building-graph",
      graph: graph.graph,
      legacyRecovery: recovery.spec,
      migrationWarnings: [...raw.migrationWarnings],
    },
  };
}

function assembleDocument(
  source: Record<string, unknown>,
  migratedFrom: BuilderDocumentMigration,
): BuilderDocumentValidation {
  const spec = validateHomeSpec(source.spec);
  if (!spec.ok) return { ok: false, problem: `spec: ${spec.problem}` };

  const geometry = validateGeometry(source.geometry);
  if (!geometry.ok) return geometry;
  const partitions = validatePartitions(source.partitions);
  if (!partitions.ok) return partitions;
  const finishes = validateFinishes(source.finishes);
  if (!finishes.ok) return finishes;
  const fixtures = validateFixtures(source.fixtures);
  if (!fixtures.ok) return fixtures;
  const comfort = validateComfort(source.comfort);
  if (!comfort.ok) return comfort;
  const quarantine = validateQuarantine(source.quarantine);
  if (!quarantine.ok) return quarantine;
  const planOrigin = validatePlanOrigin(source.planOrigin);
  if (!planOrigin.ok) return planOrigin;
  const site = validateBuilderSite(source.site);
  if (!site.ok) return { ok: false, problem: site.problem };

  return {
    ok: true,
    migratedFrom,
    document: {
      format: BUILDER_DOCUMENT_FORMAT,
      version: BUILDER_DOCUMENT_VERSION,
      spec: spec.spec,
      geometry: geometry.geometry,
      partitions: partitions.partitions,
      finishes: finishes.finishes,
      fixtures: fixtures.fixtures,
      comfort: comfort.settings,
      quarantine: quarantine.quarantine,
      ...(planOrigin.planOrigin ? { planOrigin: planOrigin.planOrigin } : {}),
      ...(site.site ? { site: site.site } : {}),
    },
  };
}

export function builderDocumentFromLegacySpec(spec: HomeSpec): BuilderDocument {
  const result = validateHomeSpec(spec);
  if (!result.ok) throw new Error(`Cannot create a builder document from this spec: ${result.problem}`);
  return {
    format: BUILDER_DOCUMENT_FORMAT,
    version: BUILDER_DOCUMENT_VERSION,
    spec: result.spec,
    geometry: geometryFromLegacySpec(),
    partitions: [],
    finishes: NO_OVERRIDES,
    fixtures: emptyFixtureSet(),
    comfort: {
      conditions: { ...DEFAULT_SETTINGS.conditions },
      targets: {},
    },
    quarantine: emptyQuarantine(),
  };
}

export function defaultBuilderDocument(): BuilderDocument {
  return builderDocumentFromLegacySpec(defaultSpec());
}

export function validateBuilderDocument(value: unknown): BuilderDocumentValidation {
  if (!isObject(value)) return { ok: false, problem: "builder document is not an object" };

  if (value.format === BUILDER_DOCUMENT_FORMAT) {
    if (typeof value.version === "number" && value.version > BUILDER_DOCUMENT_VERSION) {
      return {
        ok: false,
        problem: `This project was written by a newer version of the builder (document v${value.version}; this build reads v${BUILDER_DOCUMENT_VERSION}). Nothing was imported or overwritten.`,
        futureVersion: value.version,
      };
    }
    if (value.version === 1) {
      return assembleDocument(value, "builder-document-v1");
    }
    if (value.version !== BUILDER_DOCUMENT_VERSION) {
      return {
        ok: false,
        problem: `document.version is ${JSON.stringify(value.version)}, this build reads ${BUILDER_DOCUMENT_VERSION}`,
      };
    }
    return assembleDocument(value, null);
  }

  const legacySpec = validateHomeSpec(value);
  if (legacySpec.ok) {
    return {
      ok: true,
      migratedFrom: "home-spec",
      document: builderDocumentFromLegacySpec(legacySpec.spec),
    };
  }

  if ("spec" in value) {
    const legacy: Record<string, unknown> = {
      spec: value.spec,
      geometry: geometryFromLegacySpec(),
      partitions: value.partitions ?? [],
      finishes: value.finishes ?? value.overrides ?? {},
      fixtures: value.fixtures ?? emptyFixtureSet(),
      comfort: value.comfort ?? DEFAULT_SETTINGS,
      quarantine: value.quarantine ?? emptyQuarantine(),
    };
    return assembleDocument(legacy, "editor-doc");
  }

  if (typeof value.format === "string") {
    return { ok: false, problem: `Unsupported project format ${JSON.stringify(value.format)}` };
  }
  return { ok: false, problem: "That value is neither an Aura builder document nor a legacy HomeSpec" };
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!isObject(value)) return value;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) out[key] = canonicalValue(value[key]);
  return out;
}

export function canonicalBuilderDocumentJson(document: BuilderDocument): string {
  const checked = validateBuilderDocument(document);
  if (!checked.ok) throw new Error(`Cannot serialize an invalid builder document: ${checked.problem}`);
  return JSON.stringify(canonicalValue(checked.document));
}

export async function hashBuilderDocument(document: BuilderDocument): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalBuilderDocumentJson(document));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fixtureHostExists(spec: HomeSpec, fixture: PlacedFixture): boolean {
  const placement = fixture.placement;
  if (placement.mount === "floor") {
    const host = placement.host;
    if (host.kind === "deck") return spec.deck !== null;
    return spec.volumes.some((volume) => volume.id === host.volumeId);
  }
  return spec.volumes.some((volume) => volume.id === placement.volumeId);
}

function finishExists(spec: HomeSpec, surfaceId: string, materialId: MaterialId): boolean {
  const candidate = { [surfaceId]: materialId } as SurfaceOverrides;
  return Object.keys(pruneOverrides(spec, candidate)).length === 1;
}

/**
 * Change the legacy spec while moving anything whose semantic host vanished
 * into quarantine. Nothing is destroyed and nothing is silently reattached to
 * a newly reused id.
 */
export function reconcileBuilderDocumentSpec(
  document: BuilderDocument,
  nextSpec: HomeSpec,
): BuilderDocument {
  if (document.geometry.kind === "building-graph") {
    throw new Error(
      "This project uses BuildingGraph geometry. Edit the graph rather than its recovery HomeSpec.",
    );
  }
  const specResult = validateHomeSpec(nextSpec);
  if (!specResult.ok) throw new Error(`Cannot apply an invalid spec: ${specResult.problem}`);
  const spec = specResult.spec;
  const volumeIds = new Set(spec.volumes.map((volume) => volume.id));
  const quarantined: QuarantineEntry[] = [];

  const partitions = document.partitions.filter((partition) => {
    if (volumeIds.has(partition.volumeId)) return true;
    quarantined.push({
      kind: "partition",
      reason: `Volume ${partition.volumeId} no longer exists in the edited geometry.`,
      value: partition,
    });
    return false;
  });

  const finishPairs: Array<readonly [string, MaterialId]> = [];
  for (const [surfaceId, materialId] of Object.entries(document.finishes)) {
    if (finishExists(spec, surfaceId, materialId)) {
      finishPairs.push([surfaceId, materialId]);
    } else {
      quarantined.push({
        kind: "finish",
        reason: `Surface ${surfaceId} no longer exists in the edited geometry.`,
        value: { surfaceId, materialId },
      });
    }
  }
  const finishes = Object.fromEntries(finishPairs) as SurfaceOverrides;

  const fixtureItems = document.fixtures.items.filter((fixture) => {
    if (fixtureHostExists(spec, fixture)) return true;
    quarantined.push({
      kind: "fixture",
      reason: `The host for fixture ${fixture.id} no longer exists in the edited geometry.`,
      value: fixture,
    });
    return false;
  });

  // The default document has no per-room targets. Avoid running the comfort
  // plan solver on every geometry drag until there is durable room data to
  // reconcile.
  const solvedRooms =
    Object.keys(document.comfort.targets).length === 0
      ? new Set<string>()
      : new Set(spec.volumes.map((volume) => volume.id));
  const targets: Record<string, ComfortTarget> = {};
  for (const roomId of Object.keys(document.comfort.targets).sort()) {
    const target = document.comfort.targets[roomId];
    if (solvedRooms.has(roomId)) {
      targets[roomId] = target;
    } else {
      quarantined.push({
        kind: "comfort-target",
        reason: `Solved room ${roomId} no longer exists after the geometry edit.`,
        value: { roomId, target },
      });
    }
  }

  return {
    ...document,
    spec,
    partitions,
    finishes,
    fixtures: { version: FIXTURES_VERSION, items: fixtureItems },
    comfort: { conditions: document.comfort.conditions, targets },
    quarantine: {
      // Existing entries may deliberately share a semantic id with a newer
      // edit. Preserve both values; collapsing by id would silently discard
      // one version of the user's work.
      entries: [...document.quarantine.entries, ...quarantined],
    },
  };
}

export type RestoreQuarantineResult =
  | { ok: true; document: BuilderDocument }
  | { ok: false; problem: string };

/** Restore one quarantined value only when its original semantic host exists. */
export function restoreQuarantinedEntry(
  document: BuilderDocument,
  index: number,
): RestoreQuarantineResult {
  const entry = document.quarantine.entries[index];
  if (!entry) return { ok: false, problem: "That quarantined item no longer exists." };
  if (document.geometry.kind === "building-graph") {
    return {
      ok: false,
      problem:
        "This item belongs to the legacy volume model and cannot be placed reliably on the planar graph yet. Its recovery source is still retained.",
    };
  }
  const remaining = document.quarantine.entries.filter((_, itemIndex) => itemIndex !== index);

  if (entry.kind === "partition") {
    if (!document.spec.volumes.some((volume) => volume.id === entry.value.volumeId))
      return { ok: false, problem: "Its original volume has not returned yet." };
    if (document.partitions.some((partition) => partition.id === entry.value.id))
      return { ok: false, problem: "A partition with that id is already active." };
    return {
      ok: true,
      document: {
        ...document,
        partitions: [...document.partitions, entry.value],
        quarantine: { entries: remaining },
      },
    };
  }

  if (entry.kind === "finish") {
    if (!finishExists(document.spec, entry.value.surfaceId, entry.value.materialId))
      return { ok: false, problem: "Its original surface has not returned yet." };
    if (document.finishes[entry.value.surfaceId] !== undefined)
      return { ok: false, problem: "That surface already has an active finish." };
    return {
      ok: true,
      document: {
        ...document,
        finishes: {
          ...document.finishes,
          [entry.value.surfaceId]: entry.value.materialId,
        },
        quarantine: { entries: remaining },
      },
    };
  }

  if (entry.kind === "fixture") {
    if (!fixtureHostExists(document.spec, entry.value))
      return { ok: false, problem: "Its original fixture host has not returned yet." };
    if (document.fixtures.items.some((fixture) => fixture.id === entry.value.id))
      return { ok: false, problem: "A fixture with that id is already active." };
    return {
      ok: true,
      document: {
        ...document,
        fixtures: {
          version: FIXTURES_VERSION,
          items: [...document.fixtures.items, entry.value],
        },
        quarantine: { entries: remaining },
      },
    };
  }

  const rooms = new Set(document.spec.volumes.map((volume) => volume.id));
  if (!rooms.has(entry.value.roomId))
    return { ok: false, problem: "Its original solved room has not returned yet." };
  if (document.comfort.targets[entry.value.roomId] !== undefined)
    return { ok: false, problem: "That room already has an active comfort target." };
  return {
    ok: true,
    document: {
      ...document,
      comfort: {
        ...document.comfort,
        targets: {
          ...document.comfort.targets,
          [entry.value.roomId]: entry.value.target,
        },
      },
      quarantine: { entries: remaining },
    },
  };
}

export function discardQuarantinedEntry(
  document: BuilderDocument,
  index: number,
): BuilderDocument {
  if (!document.quarantine.entries[index]) return document;
  return {
    ...document,
    quarantine: {
      entries: document.quarantine.entries.filter((_, itemIndex) => itemIndex !== index),
    },
  };
}

export type ConvertBuilderDocumentToGraphResult =
  | { ok: true; document: BuilderDocument }
  | { ok: false; problem: string; document: BuilderDocument };

/**
 * Explicit, loss-aware geometry migration. Legacy sidecars are held for
 * repair because silently reattaching them to new graph ids would be a guess.
 */
export function convertBuilderDocumentToGraph(
  source: BuilderDocument,
  wallThicknessFt: number,
): ConvertBuilderDocumentToGraphResult {
  const checked = validateBuilderDocument(source);
  if (!checked.ok) return { ok: false, problem: checked.problem, document: source };
  const document = checked.document;
  if (document.geometry.kind === "building-graph") return { ok: true, document };
  const converted = legacySpecToBuildingGraph(document.spec, wallThicknessFt);
  if (!converted.ok) return { ok: false, problem: converted.problem, document };

  const held: QuarantineEntry[] = [
    ...document.quarantine.entries,
    ...document.partitions.map(
      (value): QuarantineEntry => ({
        kind: "partition",
        reason: "Held during planar graph conversion; its volume-local axis is not a graph wall id.",
        value,
      }),
    ),
    ...Object.entries(document.finishes).map(
      ([surfaceId, materialId]): QuarantineEntry => ({
        kind: "finish",
        reason: "Held during planar graph conversion; its legacy surface id is not a graph surface id.",
        value: { surfaceId, materialId },
      }),
    ),
    ...document.fixtures.items.map(
      (value): QuarantineEntry => ({
        kind: "fixture",
        reason: "Held during planar graph conversion; its legacy host has no verified graph placement.",
        value,
      }),
    ),
    ...Object.entries(document.comfort.targets).map(
      ([roomId, target]): QuarantineEntry => ({
        kind: "comfort-target",
        reason: "Held during planar graph conversion; solved legacy rooms do not map to graph room faces by id.",
        value: { roomId, target },
      }),
    ),
  ];

  const candidate: BuilderDocument = {
    ...document,
    geometry: {
      kind: "building-graph",
      graph: converted.graph,
      legacyRecovery: converted.legacyRecovery,
      migrationWarnings: converted.warnings,
    },
    partitions: [],
    finishes: NO_OVERRIDES,
    fixtures: emptyFixtureSet(),
    comfort: { ...document.comfort, targets: {} },
    quarantine: { entries: held },
  };
  const result = validateBuilderDocument(candidate);
  return result.ok
    ? { ok: true, document: result.document }
    : { ok: false, problem: result.problem, document };
}
