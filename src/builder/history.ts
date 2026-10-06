/**
 * Undo history from the old BuilderApp reducer.
 * The tabbed workspaces stayed behind. One label is one step.
 */
import type { BuildingGraph } from './core/buildingGraph';
import {
  reconcileBuilderDocumentSpec,
  type BuilderDocument,
} from './core/document';
import {
  reSnap,
  type FixturePlacement,
  type FixtureSet,
  type FloorPlacement,
  type PlacedFixture,
  type RoofPlacement,
  type WallPlacement,
} from './core/fixtures';
import type { HomeSpec } from './core/spec';
import type { BuilderSite } from './core/site';
import type { SurfaceOverrides } from './core/surfaces';
import { fitPartition, structThicknessOf, type Partition } from './core/walls';

export interface EditorState {
  doc: BuilderDocument;
  past: BuilderDocument[];
  future: BuilderDocument[];
  label: string | null;
  loadEpoch: number;
}

export type EditorAction =
  | { type: 'edit'; spec: HomeSpec; label: string }
  | { type: 'graph'; graph: BuildingGraph; label: string }
  | { type: 'partitions'; partitions: Partition[]; label: string }
  | { type: 'surfaces'; overrides: SurfaceOverrides; label: string }
  | { type: 'fixtures'; fixtures: FixtureSet; label: string }
  | { type: 'comfort'; comfort: BuilderDocument['comfort']; label: string }
  | { type: 'site'; site: BuilderSite | null; label: string }
  | { type: 'load'; doc: BuilderDocument; label: string; quiet?: boolean }
  | { type: 'commit'; doc: BuilderDocument; label: string }
  | { type: 'undo' }
  | { type: 'redo' };

const HISTORY_MAX = 80;

function reconcilePartitions(spec: HomeSpec, list: Partition[]): Partition[] {
  const th = structThicknessOf(spec);
  let changed = false;
  const out = list.map((partition) => {
    const volume = spec.volumes.find((item) => item.id === partition.volumeId);
    if (!volume) return partition;
    const fitted = fitPartition(volume, partition, th);
    if (fitted === null) return partition;
    const moved =
      fitted.atFt !== partition.atFt ||
      fitted.fromFt !== partition.fromFt ||
      fitted.toFt !== partition.toFt ||
      (fitted.door?.atFt ?? null) !== (partition.door?.atFt ?? null) ||
      (fitted.door?.widthFt ?? null) !== (partition.door?.widthFt ?? null);
    if (moved) changed = true;
    return moved ? fitted : partition;
  });
  return changed ? out : list;
}

function samePlacement(a: FixturePlacement, b: FixturePlacement): boolean {
  if (a.mount !== b.mount) return false;
  if (a.mount === 'floor') {
    const next = b as FloorPlacement;
    if (a.host.kind !== next.host.kind) return false;
    if (a.host.kind === 'volume' && next.host.kind === 'volume' && a.host.volumeId !== next.host.volumeId) {
      return false;
    }
    return a.x === next.x && a.z === next.z && a.rotationDeg === next.rotationDeg;
  }
  if (a.mount === 'wall') {
    const next = b as WallPlacement;
    return (
      a.volumeId === next.volumeId &&
      a.wall === next.wall &&
      a.offsetFt === next.offsetFt &&
      a.heightFt === next.heightFt &&
      a.face === next.face
    );
  }
  const next = b as RoofPlacement;
  return a.volumeId === next.volumeId && a.planeIndex === next.planeIndex && a.a === next.a && a.s === next.s;
}

function reconcileFixtures(spec: HomeSpec, set: FixtureSet): FixtureSet {
  let changed = false;
  const items: PlacedFixture[] = set.items.map((item) => {
    const placement = reSnap(spec, item);
    if (samePlacement(item.placement, placement)) return item;
    changed = true;
    return { ...item, placement };
  });
  return changed ? { ...set, items } : set;
}

function commit(state: EditorState, doc: BuilderDocument, label: string): EditorState {
  if (
    doc.spec === state.doc.spec &&
    doc.geometry === state.doc.geometry &&
    doc.partitions === state.doc.partitions &&
    doc.finishes === state.doc.finishes &&
    doc.fixtures === state.doc.fixtures &&
    doc.comfort === state.doc.comfort &&
    doc.quarantine === state.doc.quarantine
  ) {
    return state;
  }
  const coalesce = label === state.label && state.past.length > 0;
  return {
    doc,
    past: coalesce ? state.past : [...state.past, state.doc].slice(-HISTORY_MAX),
    future: [],
    label,
    loadEpoch: state.loadEpoch,
  };
}

function withSpec(doc: BuilderDocument, spec: HomeSpec): BuilderDocument {
  const reconciled = reconcileBuilderDocumentSpec(doc, spec);
  return {
    ...reconciled,
    partitions: reconcilePartitions(reconciled.spec, reconciled.partitions),
    fixtures: reconcileFixtures(reconciled.spec, reconciled.fixtures),
  };
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'edit': {
      if (action.spec === state.doc.spec) return state;
      return commit(state, withSpec(state.doc, action.spec), action.label);
    }
    case 'partitions': {
      if (action.partitions === state.doc.partitions) return state;
      return commit(state, { ...state.doc, partitions: action.partitions }, action.label);
    }
    case 'surfaces': {
      if (action.overrides === state.doc.finishes) return state;
      return commit(state, { ...state.doc, finishes: action.overrides }, action.label);
    }
    case 'fixtures': {
      if (action.fixtures === state.doc.fixtures) return state;
      return commit(state, { ...state.doc, fixtures: action.fixtures }, action.label);
    }
    case 'graph': {
      if (state.doc.geometry.kind !== 'building-graph') return state;
      if (action.graph === state.doc.geometry.graph) return state;
      return commit(
        state,
        { ...state.doc, geometry: { ...state.doc.geometry, graph: action.graph } },
        action.label,
      );
    }
    case 'comfort': {
      if (action.comfort === state.doc.comfort) return state;
      return commit(state, { ...state.doc, comfort: action.comfort }, action.label);
    }
    case 'site': {
      if (action.site === null) {
        if (state.doc.site === undefined) return state;
        const { site: _dropped, ...withoutSite } = state.doc;
        return commit(state, withoutSite, action.label);
      }
      if (action.site === state.doc.site) return state;
      const slope = action.site.parcel?.slope;
      const doc =
        slope && slope !== state.doc.spec.siting.slope
          ? withSpec(state.doc, { ...state.doc.spec, siting: { ...state.doc.spec.siting, slope } })
          : state.doc;
      return commit(state, { ...doc, site: action.site }, action.label);
    }
    case 'load': {
      const next =
        action.doc.geometry.kind === 'building-graph' ? action.doc : withSpec(action.doc, action.doc.spec);
      if (action.quiet) {
        return {
          doc: next,
          past: [],
          future: [],
          label: null,
          loadEpoch: state.loadEpoch + 1,
        };
      }
      const committed = commit(state, next, action.label);
      return committed === state ? state : { ...committed, loadEpoch: state.loadEpoch + 1 };
    }
    case 'commit': {
      const next =
        action.doc.geometry.kind === 'building-graph' ? action.doc : withSpec(action.doc, action.doc.spec);
      return commit(state, next, action.label);
    }
    case 'undo': {
      const previous = state.past[state.past.length - 1];
      if (previous === undefined) return state;
      return {
        doc: previous,
        past: state.past.slice(0, -1),
        future: [state.doc, ...state.future].slice(0, HISTORY_MAX),
        label: null,
        loadEpoch: state.loadEpoch,
      };
    }
    case 'redo': {
      const next = state.future[0];
      if (next === undefined) return state;
      return {
        doc: next,
        past: [...state.past, state.doc].slice(-HISTORY_MAX),
        future: state.future.slice(1),
        label: null,
        loadEpoch: state.loadEpoch,
      };
    }
    default:
      return state;
  }
}
