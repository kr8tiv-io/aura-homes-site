/* ===========================================================================
   THE LIBRARY — designs that survive the tab closing.

   Until this file existed a home lived in exactly two places: React state, and
   a share URL somebody had to think to copy. Close the tab and the afternoon
   was gone. That is the single biggest hole in the builder's usability, and it
   is not a hole that needs a server to fill — the browser has a real database
   in it, and the spec is small, plain, versioned data.

   So: IndexedDB, directly, no dependency. `idb` is a fine 1.1 kB wrapper and
   this file is the reason not to add it — the whole surface we need is `open`,
   `transaction`, `put`, `get`, `getAll`, `delete`, and the request→promise
   adapter at the top of this file is nine lines.

   THREE STORES, AND WHY THE SPLIT IS NOT DECORATION
   -------------------------------------------------
   `designs`  — one metadata record per saved home: name, timestamps, the
                thumbnail, and the derived headline figures.
   `specs`    — the HomeSpec itself, keyed by the same id.
   `autosave` — exactly one record, id `current`, holding the working design.

   The library grid renders from `designs` alone. A cursor over that store
   never deserializes a single HomeSpec, so opening the panel with forty homes
   in it costs forty small records rather than forty buildings. (Honest caveat:
   the thumbnails live in that store too and they are the bulk of the bytes.
   The split buys the parse, not the read.)

   `autosave` is a SEPARATE STORE rather than a reserved id in `designs`,
   because a reserved id is a filter somebody eventually forgets to write, and
   the day it is forgotten the user's crash-recovery scratch copy appears in
   their library as if they had saved it. A different store cannot be listed by
   accident.

   WHAT THIS FILE REFUSES TO DO
   ----------------------------
   1. Load a house it does not fully understand. Every spec coming off disk —
      a saved record, an autosave, a design inside an imported library file —
      goes through `validateHomeSpec` from `share.ts`, the same gate a share
      link comes through. A record stamped with a NEWER SPEC_VERSION is
      refused by version before its contents are read at all, and the library
      card says so in words rather than quietly failing to open.
   2. Pretend storage works when it does not. Private browsing where `open`
      throws, a quota that is full, another tab holding an older schema open —
      each becomes a NAMED failure (`blocked`, `quota`, `version`, ...) with a
      sentence a person can act on, never a silent no-op.
   3. Overwrite anything without being asked. Autosave writes only to its own
      store; restoring it is an explicit press. An imported design whose id
      already exists is given a new id, never merged over the top of the
      original.

   NO CLOCK IN A DERIVED VALUE. Timestamps are facts about when a record was
   written and are read from `Date.now()` at the moment of writing; nothing
   here derives geometry, and `libraryToJson` takes its `exportedAt` as a
   parameter exactly as `drawingSet` takes its issue date, so the same library
   exported twice with the same stamp is byte-identical.
   =========================================================================== */

import {
  SPEC_VERSION,
  groundFootprintSqFt,
  ridgeHeightFt,
  totalFloorAreaSqFt,
  type HomeSpec,
} from "./spec";
import { encodeSpecSync, validateHomeSpec } from "./share";
import {
  BUILDER_DOCUMENT_VERSION,
  builderDocumentFromLegacySpec,
  hashBuilderDocument,
  validateBuilderDocument,
  type BuilderDocument,
} from "./document";
const EXPORT_DISCLAIMER =
  "An Aura design study. Not a construction drawing.";

type ExportArtifact = {
  blob: Blob;
  filename: string;
  mimeType: string;
  byteLength: number;
  note: string;
};

function downloadArtifact(artifact: ExportArtifact): void {
  const url = URL.createObjectURL(artifact.blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = artifact.filename;
  link.click();
  URL.revokeObjectURL(url);
}

/* ---------------------------------------------------------------------------
   the shapes
   --------------------------------------------------------------------------- */

/** The figures the library card prints, every one of them defined in
 *  `spec.ts` and none of them recomputed here. Stored alongside the record so
 *  the grid can render without touching a HomeSpec. */
export interface DesignHeadline {
  /** `totalFloorAreaSqFt` — footprint × storeys, summed */
  floorAreaSqFt: number;
  /** `groundFootprintSqFt` — what the buildable envelope must contain */
  footprintSqFt: number;
  /** the tallest `ridgeHeightFt` in the model, above finished floor */
  ridgeHeightFt: number;
  volumeCount: number;
}

/** What lives in the `designs` store: everything the grid needs, and nothing
 *  that costs a building to read. */
export interface DesignMeta {
  id: string;
  name: string;
  /** stamped separately from the spec so a record written by a future build
   *  can be REFUSED without being parsed */
  specVersion: number;
  /** zero/missing identifies a legacy HomeSpec-only record */
  documentVersion: number;
  /** a data URL, or null when the 3D view could not be read at save time */
  thumbnail: string | null;
  createdAt: number;
  updatedAt: number;
  headline: DesignHeadline;
  /** deterministic content signature — see `specSignature`. Lets the UI mark
   *  the card that is the design currently on screen, without a deep compare. */
  signature: string;
}

/** A row in the library grid. `readable` is a VERSION check only: the spec was
 *  deliberately not loaded to produce this list, so a record can still turn
 *  out to be corrupt when it is opened. That is reported then, not guessed at
 *  now. */
export interface DesignSummary extends DesignMeta {
  readable: boolean;
  /** why it cannot be opened, in a sentence, or null */
  problem: string | null;
}

/** A whole design: the card plus the building. */
export interface SavedDesign extends DesignMeta {
  document: BuilderDocument;
}

/** What `readAutosave` found. Deliberately not `SavedDesign | null` — "there
 *  is a crash copy here and this build cannot read it" is a state the UI has
 *  to be able to say out loud. */
export type AutosaveState =
  | { present: false }
  | { present: true; readable: true; record: SavedDesign }
  | { present: true; readable: false; problem: string; updatedAt: number };

/* ---------------------------------------------------------------------------
   failures, named
   --------------------------------------------------------------------------- */

export type StoreFailure =
  /** no IndexedDB at all: a server render, a worker, a browser without it */
  | "unavailable"
  /** private browsing, partitioned storage, or another tab holding the schema */
  | "blocked"
  /** the disk quota for this origin is full */
  | "quota"
  /** a record written by a newer build of the builder */
  | "version"
  /** a record that is not a house this build understands */
  | "corrupt"
  | "notfound"
  | "unknown";

/** An Error with a machine-readable `kind` on it.
 *
 *  Deliberately NOT `class StoreError extends Error`: this project's tsconfig
 *  sets no `target`, so a downlevel build would break `instanceof` on an Error
 *  subclass silently — the classic ES5 subclassing trap. A tagged plain Error
 *  has no such failure mode and reads the same at every call site. */
export interface StoreError extends Error {
  kind: StoreFailure;
  /** the underlying DOMException name, when there was one */
  detail?: string;
}

const STORE_ERROR_NAME = "AuraStoreError";

function storeError(kind: StoreFailure, message: string, detail?: string): StoreError {
  const e = new Error(message) as StoreError;
  e.name = STORE_ERROR_NAME;
  e.kind = kind;
  if (detail) e.detail = detail;
  return e;
}

export function isStoreError(e: unknown): e is StoreError {
  return e instanceof Error && e.name === STORE_ERROR_NAME && typeof (e as StoreError).kind === "string";
}

/** True for the several spellings of "the disk is full" that browsers use. */
function isQuota(e: unknown): boolean {
  if (typeof DOMException !== "undefined" && e instanceof DOMException) {
    // 22 is the legacy QUOTA_EXCEEDED_ERR; 1014 is Firefox's older NS code
    return e.name === "QuotaExceededError" || e.code === 22 || e.code === 1014;
  }
  return e instanceof Error && e.name === "QuotaExceededError";
}

/** Turn anything thrown anywhere in this file into a named failure. Callers
 *  catch once and print `.message`; nothing has to guess at a DOMException. */
export function explainStoreError(e: unknown): { kind: StoreFailure; message: string } {
  if (isStoreError(e)) return { kind: e.kind, message: e.message };
  if (isQuota(e))
    return {
      kind: "quota",
      message:
        "This browser's storage for the site is full, so nothing was written. Delete a design or two — thumbnails are most of the weight — and try again.",
    };
  if (e instanceof DOMException && (e.name === "SecurityError" || e.name === "InvalidStateError"))
    return {
      kind: "blocked",
      message: `The browser refused access to its database (${e.name}). Private browsing and blocked site data both do this.`,
    };
  return {
    kind: "unknown",
    message: e instanceof Error ? e.message : String(e),
  };
}

/* ---------------------------------------------------------------------------
   the database
   --------------------------------------------------------------------------- */

export const DB_NAME = "aura-builder";
/** Bump ONLY alongside a migration in `onupgradeneeded`. A tab running an
 *  older build will then get a `blocked` failure it can explain, rather than a
 *  store it half-understands. */
export const DB_VERSION = 2;

const STORE_DESIGNS = "designs";
const STORE_SPECS = "specs";
const STORE_DOCUMENTS = "documents";
const STORE_AUTOSAVE = "autosave";

/** The one key in the autosave store. */
export const AUTOSAVE_ID = "current";

/** Safari has shipped, more than once, an IndexedDB whose `open` neither
 *  succeeds nor errors. A promise that never settles is a spinner forever, so
 *  the open is raced against a clock and reports `blocked` instead. */
const OPEN_TIMEOUT_MS = 8_000;

let dbPromise: Promise<IDBDatabase> | null = null;

/** Cheap, synchronous "is there any point trying" — for a first render that
 *  wants to show the right message before any await. */
export function storageAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  const attempt = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(
        storeError(
          "unavailable",
          "This browser has no IndexedDB, so designs cannot be saved here. Use the .json download and the share link instead — both work everywhere.",
        ),
      );
      return;
    }

    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (err) {
      // Firefox in private browsing throws right here rather than erroring
      const { message } = explainStoreError(err);
      reject(storeError("blocked", `The browser would not open its database: ${message}`));
      return;
    }

    const timer = setTimeout(() => {
      reject(
        storeError(
          "blocked",
          `The browser's database did not answer within ${OPEN_TIMEOUT_MS / 1000} seconds. That usually means private browsing or blocked site data.`,
        ),
      );
    }, OPEN_TIMEOUT_MS);

    request.onupgradeneeded = () => {
      const db = request.result;
      /* v1. Every future version adds an `if (event.oldVersion < n)` block
         here — and a store is never dropped, because dropping one is how a
         user's library disappears during what looked like a routine deploy. */
      if (!db.objectStoreNames.contains(STORE_DESIGNS)) {
        const designs = db.createObjectStore(STORE_DESIGNS, { keyPath: "id" });
        designs.createIndex("updatedAt", "updatedAt");
      }
      if (!db.objectStoreNames.contains(STORE_SPECS)) {
        db.createObjectStore(STORE_SPECS, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE_AUTOSAVE)) {
        db.createObjectStore(STORE_AUTOSAVE, { keyPath: "id" });
      }
      /* v2. New writes use complete BuilderDocuments. The v1 `specs` store is
         retained untouched and read as a fallback, so an old project is
         migrated only when it is opened or overwritten and its recovery copy
         remains available. */
      if (!db.objectStoreNames.contains(STORE_DOCUMENTS)) {
        db.createObjectStore(STORE_DOCUMENTS, { keyPath: "id" });
      }
    };

    request.onblocked = () => {
      clearTimeout(timer);
      reject(
        storeError(
          "blocked",
          "Another tab has an older version of this site open and is holding the database. Close the other tabs and reload.",
        ),
      );
    };

    request.onerror = () => {
      clearTimeout(timer);
      const { message } = explainStoreError(request.error);
      reject(storeError("blocked", `The browser's database could not be opened: ${message}`));
    };

    request.onsuccess = () => {
      clearTimeout(timer);
      const db = request.result;
      /* Another tab wanting a newer schema must not be blocked by this one.
         Close on request and forget the handle; the next call reopens. */
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
  });

  dbPromise = attempt;
  // a failed open must not poison every later attempt — private mode can be
  // left, storage can be granted, the other tab can be closed
  attempt.catch(() => {
    if (dbPromise === attempt) dbPromise = null;
  });
  return attempt;
}

/** Request → promise. Awaiting one of these inside a transaction body keeps
 *  the transaction alive, because the continuation runs as a microtask off the
 *  success event — which is the entire reason this adapter is safe to await. */
function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

/** Run a transaction and resolve only when it COMMITS.
 *
 *  Resolving on the last request instead would report success for a write the
 *  browser then aborted on quota — the difference between "saved" and "said
 *  saved". */
function run<T>(
  stores: string[],
  mode: IDBTransactionMode,
  body: (t: IDBTransaction) => Promise<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        let t: IDBTransaction;
        try {
          t = db.transaction(stores, mode);
        } catch (err) {
          const { kind, message } = explainStoreError(err);
          reject(storeError(kind, message));
          return;
        }
        let value: T;
        let failed = false;
        t.oncomplete = () => {
          if (!failed) resolve(value);
        };
        const fail = (err: unknown) => {
          if (failed) return;
          failed = true;
          const { kind, message } = explainStoreError(err);
          reject(storeError(kind, message));
        };
        t.onerror = () => fail(t.error);
        t.onabort = () => fail(t.error ?? storeError("unknown", "The write was aborted by the browser."));
        body(t).then(
          (v) => {
            value = v;
          },
          (err) => {
            /* REPORT FIRST, ABORT SECOND. `abort()` fires `onabort`, which
               would otherwise reject with the generic "aborted by the browser"
               and lose the precise reason the body actually threw. Real
               IndexedDB queues that event, so the order usually works out —
               "usually", across engines, is not a thing to build an error
               message on. */
            fail(err);
            try {
              t.abort();
            } catch {
              /* already finished — the abort is only best effort */
            }
          },
        );
      }),
  );
}

/* ---------------------------------------------------------------------------
   ids, signatures, headlines
   --------------------------------------------------------------------------- */

let idCounter = 0;

/** A record id. Not a geometry or export path — no house's shape and no
 *  exported byte depends on this — and there is no `Math.random` in it either
 *  way: `crypto.randomUUID` where it exists, a monotonic fallback where it
 *  does not (an insecure context, an old browser). */
function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    try {
      return crypto.randomUUID();
    } catch {
      /* fall through */
    }
  }
  idCounter += 1;
  return `d-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

/**
 * A deterministic string that is equal for equal designs.
 *
 * `encodeSpecSync` is already byte-stable for a given spec, in any browser, in
 * any order — it is the share codec's uncompressed form — so it is exactly the
 * content hash this needs and there is no second serializer to disagree with.
 * The JSON fallback exists only for a spec that fails validation, which cannot
 * be stored anyway; it keeps this function total.
 */
export function specSignature(spec: HomeSpec): string {
  try {
    return encodeSpecSync(spec);
  } catch {
    return `invalid:${JSON.stringify(spec)}`;
  }
}

/** Full-document identity used by autosave, library cards, quotes and orders. */
export async function documentSignature(document: BuilderDocument): Promise<string> {
  try {
    return await hashBuilderDocument(document);
  } catch {
    return `invalid:${JSON.stringify(document)}`;
  }
}

/** The card's figures. Every one from `spec.ts`; nothing multiplied out here. */
export function headlineOf(spec: HomeSpec): DesignHeadline {
  return {
    floorAreaSqFt: totalFloorAreaSqFt(spec),
    footprintSqFt: groundFootprintSqFt(spec),
    ridgeHeightFt: spec.volumes.length ? Math.max(...spec.volumes.map(ridgeHeightFt)) : 0,
    volumeCount: spec.volumes.length,
  };
}

/** Longer than this and it is not a name, it is a paste. */
export const MAX_NAME_CHARS = 80;

const cleanName = (name: string, fallback: string): string => {
  const t = name.replace(/\s+/g, " ").trim().slice(0, MAX_NAME_CHARS);
  return t.length > 0 ? t : fallback;
};

/* ---------------------------------------------------------------------------
   reading a record back — the one gate
   --------------------------------------------------------------------------- */

/** Why a stored record cannot be trusted, or null when it can. Version first,
 *  because a future record must be refused BEFORE its contents are read. */
function versionProblem(specVersion: unknown, documentVersion: unknown = 0): string | null {
  if (typeof documentVersion === "number" && Number.isFinite(documentVersion) && documentVersion > 0) {
    if (documentVersion > BUILDER_DOCUMENT_VERSION)
      return `Saved by a newer version of the builder (document v${documentVersion}; this build reads v${BUILDER_DOCUMENT_VERSION}). Refusing to guess at it — update the page, or open it in the browser that wrote it.`;
    /* Older BuilderDocuments are readable only through document.ts's explicit
       migrations. The metadata gate lets them reach that validator; it never
       rewrites their source record merely because they were listed. */
    if (documentVersion < BUILDER_DOCUMENT_VERSION) return null;
    return null;
  }
  if (typeof specVersion !== "number" || !Number.isFinite(specVersion))
    return "This record does not say which spec version wrote it, so it cannot be read safely.";
  if (specVersion > SPEC_VERSION)
    return `Saved by a newer version of the builder (spec v${specVersion}; this build reads v${SPEC_VERSION}). Refusing to guess at it — update the page, or open it in the browser that wrote it.`;
  if (specVersion < SPEC_VERSION)
    return `Saved as spec v${specVersion} and no migration to v${SPEC_VERSION} exists yet, so it is refused rather than mis-read.`;
  return null;
}

/** Meta off disk → the summary the grid renders. Never throws: one unreadable
 *  record must not take the whole library down with it. */
function toSummary(raw: unknown): DesignSummary | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Partial<DesignMeta>;
  if (typeof r.id !== "string" || r.id.length === 0) return null;
  const problem = versionProblem(r.specVersion, r.documentVersion);
  const h = r.headline;
  return {
    id: r.id,
    name: typeof r.name === "string" && r.name.length > 0 ? r.name : "Untitled",
    specVersion: typeof r.specVersion === "number" ? r.specVersion : -1,
    documentVersion: typeof r.documentVersion === "number" ? r.documentVersion : 0,
    thumbnail: typeof r.thumbnail === "string" ? r.thumbnail : null,
    createdAt: typeof r.createdAt === "number" ? r.createdAt : 0,
    updatedAt: typeof r.updatedAt === "number" ? r.updatedAt : 0,
    headline: {
      floorAreaSqFt: typeof h?.floorAreaSqFt === "number" ? h.floorAreaSqFt : 0,
      footprintSqFt: typeof h?.footprintSqFt === "number" ? h.footprintSqFt : 0,
      ridgeHeightFt: typeof h?.ridgeHeightFt === "number" ? h.ridgeHeightFt : 0,
      volumeCount: typeof h?.volumeCount === "number" ? h.volumeCount : 0,
    },
    signature: typeof r.signature === "string" ? r.signature : "",
    readable: problem === null,
    problem,
  };
}

/** A stored spec → a HomeSpec, or a named failure. The SAME gate a share link
 *  comes through, because a record off this browser's disk is exactly as
 *  untrusted as a URL off the internet once anything has ever touched it. */
function readSpec(raw: unknown, specVersion: unknown, where: string): HomeSpec {
  const problem = versionProblem(specVersion);
  if (problem) throw storeError("version", problem);
  if (typeof raw !== "object" || raw === null)
    throw storeError("corrupt", `${where} has no spec stored with it.`);
  const check = validateHomeSpec((raw as { spec?: unknown }).spec);
  if (!check.ok)
    throw storeError(
      "corrupt",
      `${where} is not a house this build understands — ${check.problem}. Nothing was loaded, because a half-read house is worse than no house.`,
    );
  return check.spec;
}

function readDocument(
  rawDocument: unknown,
  rawSpec: unknown,
  summary: Pick<DesignSummary, "name" | "specVersion" | "documentVersion">,
  where: string,
): BuilderDocument {
  const problem = versionProblem(summary.specVersion, summary.documentVersion);
  if (problem) throw storeError("version", problem);

  if (summary.documentVersion > 0) {
    if (typeof rawDocument !== "object" || rawDocument === null)
      throw storeError("corrupt", `${where} has no builder document stored with it.`);
    const value = (rawDocument as { document?: unknown }).document;
    const check = validateBuilderDocument(value);
    if (!check.ok)
      throw storeError(
        check.futureVersion ? "version" : "corrupt",
        `${where} is not a project this build understands — ${check.problem}`,
      );
    return check.document;
  }

  return builderDocumentFromLegacySpec(readSpec(rawSpec, summary.specVersion, where));
}

/* ---------------------------------------------------------------------------
   change notification — one library, however many panels and tabs
   --------------------------------------------------------------------------- */

export const LIBRARY_EVENT = "aura-library-change";

let channel: BroadcastChannel | null = null;
let channelTried = false;

function getChannel(): BroadcastChannel | null {
  if (channelTried) return channel;
  channelTried = true;
  try {
    channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(LIBRARY_EVENT) : null;
  } catch {
    channel = null;
  }
  return channel;
}

/** Announce a mutation. A BroadcastChannel never delivers to the object that
 *  posted, so the same-tab CustomEvent and the cross-tab message cannot double
 *  up on each other. */
function announce(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(LIBRARY_EVENT));
  try {
    getChannel()?.postMessage("changed");
  } catch {
    /* a closed channel is not worth a failed save */
  }
}

/** Subscribe to library changes from this tab and from any other tab on this
 *  origin. Returns an unsubscribe. */
export function onLibraryChange(fn: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const local = () => fn();
  const remote = () => fn();
  window.addEventListener(LIBRARY_EVENT, local);
  const c = getChannel();
  c?.addEventListener("message", remote);
  return () => {
    window.removeEventListener(LIBRARY_EVENT, local);
    c?.removeEventListener("message", remote);
  };
}

/* ---------------------------------------------------------------------------
   THE LIBRARY — list, read, save, rename, duplicate, delete
   --------------------------------------------------------------------------- */

/**
 * Every saved design, newest first.
 *
 * Reads the `designs` store ONLY — no HomeSpec is deserialized to build this
 * list. A record this build cannot read still appears, with `readable: false`
 * and a sentence saying why: a design that vanishes from your library because
 * the software was updated is indistinguishable from a design the software
 * lost.
 */
export async function listDesigns(): Promise<DesignSummary[]> {
  const rows = await run([STORE_DESIGNS], "readonly", async (t) =>
    req<unknown[]>(t.objectStore(STORE_DESIGNS).getAll() as IDBRequest<unknown[]>),
  );
  const out: DesignSummary[] = [];
  for (const row of rows) {
    const s = toSummary(row);
    if (s) out.push(s);
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** One whole design. Throws `notfound`, `version` or `corrupt` — never returns
 *  a partial house. */
export async function readDesign(id: string): Promise<SavedDesign> {
  const { meta, spec, document } = await run(
    [STORE_DESIGNS, STORE_SPECS, STORE_DOCUMENTS],
    "readonly",
    async (t) => ({
    meta: await req<unknown>(t.objectStore(STORE_DESIGNS).get(id) as IDBRequest<unknown>),
    spec: await req<unknown>(t.objectStore(STORE_SPECS).get(id) as IDBRequest<unknown>),
      document: await req<unknown>(t.objectStore(STORE_DOCUMENTS).get(id) as IDBRequest<unknown>),
    }),
  );
  const summary = toSummary(meta);
  if (!summary) throw storeError("notfound", "That design is no longer in this browser's library.");
  const project = readDocument(document, spec, summary, `“${summary.name}”`);
  return {
    id: summary.id,
    name: summary.name,
    specVersion: summary.specVersion,
    documentVersion: summary.documentVersion,
    thumbnail: summary.thumbnail,
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt,
    headline: summary.headline,
    signature: summary.signature,
    document: project,
  };
}

export interface SaveInput {
  /** omit to create a new record; pass one to overwrite that record */
  id?: string;
  /** the library's label. Defaults to the document spec's own name. */
  name?: string;
  document: BuilderDocument;
  /**
   * `undefined` asks the registered viewport for a fresh capture (see
   * `captureThumbnail`); `null` deliberately stores none; a string is used
   * verbatim.
   */
  thumbnail?: string | null;
}

/**
 * Write a design.
 *
 * The spec is validated first and the VALIDATED REBUILD is what gets stored,
 * so nothing that happened to be hanging off the caller's object rides into
 * the database, and every record is guaranteed to round-trip.
 *
 * The stored spec's `name` is set to the record's name, so the card and the
 * home cannot drift apart. The design on screen is not touched — this function
 * saves, it does not edit.
 */
export async function saveDesign(input: SaveInput): Promise<DesignSummary> {
  const check = validateBuilderDocument(input.document);
  if (!check.ok)
    throw storeError("corrupt", `Refusing to save a project this build cannot read back — ${check.problem}`);

  const name = cleanName(input.name ?? check.document.spec.name, "Untitled home");
  const document: BuilderDocument = {
    ...check.document,
    spec: { ...check.document.spec, name },
  };
  const thumbnail = input.thumbnail === undefined ? captureThumbnail() : input.thumbnail;
  const now = Date.now();
  const id = input.id ?? newId();
  const signature = await documentSignature(document);

  const meta: DesignMeta = await run([STORE_DESIGNS, STORE_DOCUMENTS], "readwrite", async (t) => {
    const designs = t.objectStore(STORE_DESIGNS);
    const existing = input.id ? toSummary(await req<unknown>(designs.get(input.id) as IDBRequest<unknown>)) : null;
    if (input.id && !existing)
      throw storeError("notfound", "That design is no longer in this browser's library, so it was not overwritten.");
    const record: DesignMeta = {
      id,
      name,
      specVersion: SPEC_VERSION,
      documentVersion: BUILDER_DOCUMENT_VERSION,
      thumbnail: thumbnail ?? existing?.thumbnail ?? null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      headline: headlineOf(document.spec),
      signature,
    };
    await req(designs.put(record));
    await req(t.objectStore(STORE_DOCUMENTS).put({ id, document }));
    return record;
  });

  announce();
  return { ...meta, readable: true, problem: null };
}

/** Rename a record, and the home inside it, in one transaction. */
export async function renameDesign(id: string, name: string): Promise<DesignSummary> {
  const clean = cleanName(name, "Untitled home");
  const meta = await run(
    [STORE_DESIGNS, STORE_SPECS, STORE_DOCUMENTS],
    "readwrite",
    async (t) => {
    const designs = t.objectStore(STORE_DESIGNS);
    const specs = t.objectStore(STORE_SPECS);
      const documents = t.objectStore(STORE_DOCUMENTS);
    const current = toSummary(await req<unknown>(designs.get(id) as IDBRequest<unknown>));
    if (!current) throw storeError("notfound", "That design is no longer in this browser's library.");
      const [storedSpec, storedDocument] = await Promise.all([
        req<unknown>(specs.get(id) as IDBRequest<unknown>),
        req<unknown>(documents.get(id) as IDBRequest<unknown>),
      ]);
      const document = readDocument(storedDocument, storedSpec, current, `“${current.name}”`);
      const renamed: BuilderDocument = { ...document, spec: { ...document.spec, name: clean } };
    const record: DesignMeta = {
      id,
      name: clean,
      specVersion: SPEC_VERSION,
        documentVersion: BUILDER_DOCUMENT_VERSION,
      thumbnail: current.thumbnail,
      createdAt: current.createdAt,
      updatedAt: Date.now(),
      headline: current.headline,
        signature: await documentSignature(renamed),
    };
    await req(designs.put(record));
      await req(documents.put({ id, document: renamed }));
    return record;
    },
  );
  announce();
  return { ...meta, readable: true, problem: null };
}

/** Copy a design into a new record. The copy keeps the thumbnail — it is a
 *  picture of the same house — and gets its own id and timestamps. */
export async function duplicateDesign(id: string, name?: string): Promise<DesignSummary> {
  const source = await readDesign(id);
  return saveDesign({
    name: cleanName(name ?? `${source.name} copy`, "Untitled home"),
    document: source.document,
    thumbnail: source.thumbnail,
  });
}

/** Remove a design and its spec together. Deleting an id that is not there is
 *  not an error — the end state is the one that was asked for. */
export async function deleteDesign(id: string): Promise<void> {
  await run([STORE_DESIGNS, STORE_SPECS, STORE_DOCUMENTS], "readwrite", async (t) => {
    await req(t.objectStore(STORE_DESIGNS).delete(id));
    await req(t.objectStore(STORE_SPECS).delete(id));
    await req(t.objectStore(STORE_DOCUMENTS).delete(id));
  });
  announce();
}

/** Empty the library. The autosave record is NOT touched: it is the work in
 *  progress, not a saved design, and taking it out from under somebody who
 *  asked to clear their saved list would be a second thing they did not ask
 *  for. */
export async function clearLibrary(): Promise<void> {
  await run([STORE_DESIGNS, STORE_SPECS, STORE_DOCUMENTS], "readwrite", async (t) => {
    await req(t.objectStore(STORE_DESIGNS).clear());
    await req(t.objectStore(STORE_SPECS).clear());
    await req(t.objectStore(STORE_DOCUMENTS).clear());
  });
  announce();
}

/* ---------------------------------------------------------------------------
   AUTOSAVE — the crash copy, and why restoring it is a question
   --------------------------------------------------------------------------- */

/**
 * Write the working design to the autosave slot.
 *
 * One record, one store, overwritten every time. It carries no thumbnail by
 * default: a canvas readback and a JPEG encode every few seconds, forever, to
 * decorate a prompt that may never be shown, is a bad trade. Pass one if the
 * caller wants it.
 */
export async function writeAutosave(
  document: BuilderDocument,
  thumbnail: string | null = null,
): Promise<void> {
  const check = validateBuilderDocument(document);
  if (!check.ok)
    throw storeError("corrupt", `Refusing to autosave an invalid project — ${check.problem}`);
  const now = Date.now();
  const record: SavedDesign = {
    id: AUTOSAVE_ID,
    name: check.document.spec.name,
    specVersion: SPEC_VERSION,
    documentVersion: BUILDER_DOCUMENT_VERSION,
    thumbnail,
    createdAt: now,
    updatedAt: now,
    headline: headlineOf(check.document.spec),
    signature: await documentSignature(check.document),
    document: check.document,
  };
  await run([STORE_AUTOSAVE], "readwrite", async (t) => {
    await req(t.objectStore(STORE_AUTOSAVE).put(record));
  });
  /* No `announce()`. Autosave is not a library change, and a broadcast every
     few seconds would have every open panel re-reading the database for a
     record it does not display. */
}

/**
 * What is in the autosave slot.
 *
 * Returns a STATE rather than a spec, because "there is a crash copy here and
 * this build cannot read it" is a thing the UI has to be able to say. Never
 * throws on a bad record — a corrupt autosave must not stop the builder from
 * loading.
 */
export async function readAutosave(): Promise<AutosaveState> {
  /* A STORAGE failure propagates — "the database would not open" is not the
     same fact as "there is no autosave", and a caller told the second when the
     first is true will happily start writing over a slot it never read. */
  const raw = await run([STORE_AUTOSAVE], "readonly", async (t) =>
    req<unknown>(t.objectStore(STORE_AUTOSAVE).get(AUTOSAVE_ID) as IDBRequest<unknown>),
  );
  if (raw === undefined || raw === null) return { present: false };
  const summary = toSummary(raw);
  const updatedAt = summary?.updatedAt ?? 0;
  if (!summary)
    return { present: true, readable: false, problem: "The autosaved record is unreadable.", updatedAt };
  if (!summary.readable)
    return { present: true, readable: false, problem: summary.problem ?? "Unreadable record.", updatedAt };
  try {
    const document = readDocument(raw, raw, summary, "The autosaved design");
    return {
      present: true,
      readable: true,
      record: {
        id: AUTOSAVE_ID,
        name: summary.name,
        specVersion: summary.specVersion,
        documentVersion: summary.documentVersion,
        thumbnail: summary.thumbnail,
        createdAt: summary.createdAt,
        updatedAt: summary.updatedAt,
        headline: summary.headline,
        signature: summary.signature,
        document,
      },
    };
  } catch (err) {
    return { present: true, readable: false, problem: explainStoreError(err).message, updatedAt };
  }
}

export async function clearAutosave(): Promise<void> {
  await run([STORE_AUTOSAVE], "readwrite", async (t) => {
    await req(t.objectStore(STORE_AUTOSAVE).delete(AUTOSAVE_ID));
  });
}

/* ---------------------------------------------------------------------------
   THUMBNAILS — one helper, and a socket for the viewport to plug into
   --------------------------------------------------------------------------- */

export const THUMBNAIL_WIDTH = 480;
/** 16:10, the aspect the builder's canvas already is. */
export const THUMBNAIL_HEIGHT = 300;

export interface ThumbnailOptions {
  width?: number;
  height?: number;
  /** JPEG by default: a shaded 3D render is photographic, and the PNG of the
   *  same frame is four to eight times the bytes in a quota-limited store. */
  mimeType?: string;
  quality?: number;
  /** set false to keep a uniform image instead of reporting it as a miss */
  requireContent?: boolean;
}

/** Every pixel the same colour means the drawing buffer was empty — see
 *  `canvasThumbnail`. Sampled sparsely; a real render never passes this. */
function looksBlank(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, w, h).data;
  } catch {
    // a tainted canvas cannot be sampled — assume it is fine and let toDataURL
    // report the real problem
    return false;
  }
  const step = 8;
  const first = [data[0], data[1], data[2], data[3]];
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const i = (y * w + x) * 4;
      if (
        Math.abs(data[i] - first[0]) > 2 ||
        Math.abs(data[i + 1] - first[1]) > 2 ||
        Math.abs(data[i + 2] - first[2]) > 2 ||
        Math.abs(data[i + 3] - first[3]) > 2
      )
        return false;
    }
  }
  return true;
}

/**
 * A canvas → a small data URL, cover-cropped to the thumbnail aspect.
 *
 * TIMING IS THE WHOLE TRICK, and it belongs to the CALLER. The builder's
 * `<Canvas>` runs with `frameloop="demand"` and the default
 * `preserveDrawingBuffer: false`, which means the WebGL back buffer is valid
 * only until the browser composites — i.e. until the current task yields. So
 * this must be called in the SAME synchronous turn as the render that produced
 * the frame. That is exactly what `ThumbnailProbe` (in
 * `components/builder/ProjectLibrary.tsx`) does, and it is why this function is
 * synchronous rather than returning a promise.
 *
 * Returns null, with a console warning naming the reason, when there is
 * nothing to capture. A saved design with no thumbnail is honest; a saved
 * design with a black rectangle claiming to be a house is not.
 */
export function canvasThumbnail(source: HTMLCanvasElement, opts: ThumbnailOptions = {}): string | null {
  if (typeof document === "undefined") return null;
  const width = Math.max(16, Math.round(opts.width ?? THUMBNAIL_WIDTH));
  const height = Math.max(16, Math.round(opts.height ?? THUMBNAIL_HEIGHT));
  const sw = source.width;
  const sh = source.height;
  if (!sw || !sh) {
    console.warn("[aura/store] the 3D canvas has no size yet — no thumbnail was captured");
    return null;
  }

  const out = document.createElement("canvas");
  out.width = width;
  out.height = height;
  const ctx = out.getContext("2d");
  if (!ctx) {
    console.warn("[aura/store] no 2D context available — no thumbnail was captured");
    return null;
  }

  // cover, not stretch: a squashed house reads as a modelling mistake
  const scale = Math.max(width / sw, height / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  try {
    ctx.drawImage(source, (width - dw) / 2, (height - dh) / 2, dw, dh);
  } catch (err) {
    console.warn("[aura/store] the 3D canvas could not be read:", err);
    return null;
  }

  if (opts.requireContent !== false && looksBlank(ctx, width, height)) {
    console.warn(
      "[aura/store] the captured frame is a single flat colour, which means the WebGL drawing buffer had already been cleared. Capture in the same turn as the render (see ThumbnailProbe). No thumbnail was stored.",
    );
    return null;
  }

  try {
    return out.toDataURL(opts.mimeType ?? "image/jpeg", opts.quality ?? 0.72);
  } catch (err) {
    console.warn("[aura/store] the thumbnail could not be encoded:", err);
    return null;
  }
}

/** A function that renders a frame and returns a thumbnail data URL for it. */
export type ThumbnailSource = () => string | null;

let thumbnailSource: ThumbnailSource | null = null;

/**
 * The viewport's socket.
 *
 * There is one builder canvas on the page, so there is one slot. Mounting a
 * second source replaces the first and the returned unsubscribe only clears
 * the slot if it still holds the same function — so an unmount racing a mount
 * cannot leave the library with no source.
 */
export function registerThumbnailSource(fn: ThumbnailSource | null): () => void {
  thumbnailSource = fn;
  return () => {
    if (thumbnailSource === fn) thumbnailSource = null;
  };
}

/** Ask the registered viewport for a picture. Null when nothing is registered
 *  or the capture failed — both of which are saved as "no thumbnail". */
export function captureThumbnail(): string | null {
  if (!thumbnailSource) return null;
  try {
    return thumbnailSource();
  } catch (err) {
    console.warn("[aura/store] the thumbnail source threw:", err);
    return null;
  }
}

/* ---------------------------------------------------------------------------
   THE WHOLE LIBRARY AS ONE FILE — because these designs are the user's
   --------------------------------------------------------------------------- */

export const LIBRARY_FORMAT = "aura-design-library";
export const LIBRARY_FILE_VERSION = 1;

export interface LibraryFile {
  format: typeof LIBRARY_FORMAT;
  fileVersion: number;
  /** the spec version the WRITER was built against */
  specVersion: number;
  documentVersion: number;
  generator: string;
  exportedAt: string;
  disclaimer: string;
  designs: SavedDesign[];
}

/** Bigger than this is not a thumbnail. Caps what an imported file can push
 *  into the database in one record (~300 kB of image). */
export const MAX_THUMBNAIL_CHARS = 400_000;

/**
 * The exact text of a library file. `exportedAt` is a PARAMETER, not a clock
 * read — the same designs exported twice with the same stamp are byte-identical,
 * which is the same discipline `drawingSet` keeps with its issue date.
 */
export function libraryToJson(designs: SavedDesign[], exportedAtISO: string): string {
  const file: LibraryFile = {
    format: LIBRARY_FORMAT,
    fileVersion: LIBRARY_FILE_VERSION,
    specVersion: SPEC_VERSION,
    documentVersion: BUILDER_DOCUMENT_VERSION,
    generator: "Aura Homes builder",
    exportedAt: exportedAtISO,
    disclaimer: EXPORT_DISCLAIMER,
    designs,
  };
  return `${JSON.stringify(file, null, 2)}\n`;
}

/** Every readable design, whole, ready to be written to a file. Unreadable
 *  records are SKIPPED and named — exporting a record this build cannot parse
 *  would write a file that claims to contain a house it never read. */
export async function collectLibrary(): Promise<{ designs: SavedDesign[]; skipped: string[] }> {
  const summaries = await listDesigns();
  const designs: SavedDesign[] = [];
  const skipped: string[] = [];
  for (const s of summaries) {
    try {
      designs.push(await readDesign(s.id));
    } catch (err) {
      skipped.push(`${s.name} — ${explainStoreError(err).message}`);
    }
  }
  return { designs, skipped };
}

/** Deterministic filename, for the same reason `exportFilename` is: saving
 *  twice overwrites rather than littering `library (3).json` across a folder. */
export const LIBRARY_FILENAME = "aura-design-library.json";

export function libraryArtifact(designs: SavedDesign[], exportedAtISO: string): ExportArtifact {
  const text = libraryToJson(designs, exportedAtISO);
  const blob = new Blob([text], { type: "application/json" });
  return {
    blob,
    filename: LIBRARY_FILENAME,
    mimeType: "application/json",
    byteLength: blob.size,
    note: `${designs.length} design${designs.length === 1 ? "" : "s"} · document v${BUILDER_DOCUMENT_VERSION} · thumbnails included · re-imports into any browser running this builder`,
  };
}

/** Write the library to the user's downloads. Returns what was written and
 *  what could not be. */
export async function exportLibrary(exportedAtISO: string): Promise<{
  artifact: ExportArtifact;
  skipped: string[];
}> {
  const { designs, skipped } = await collectLibrary();
  const artifact = libraryArtifact(designs, exportedAtISO);
  downloadArtifact(artifact);
  return { artifact, skipped };
}

export interface LibraryParse {
  /** designs that passed the same gate a share link passes */
  designs: SavedDesign[];
  /** one line per design that did not, naming the offending field */
  skipped: string[];
  /** set when the FILE is refused outright; `designs` is then empty */
  problem: string | null;
}

/**
 * Read a library file.
 *
 * Refuses the whole file when it was written by a newer spec version — a file
 * full of houses we would half-understand is not better than no file. Within
 * an acceptable file, a single bad design is skipped and named rather than
 * failing the import: one corrupt record should not cost somebody the other
 * thirty-nine.
 */
export async function parseLibraryFile(text: string): Promise<LibraryParse> {
  const empty = (problem: string): LibraryParse => ({ designs: [], skipped: [], problem });

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return empty(`That file is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    return empty("That file is not an Aura design library.");

  const file = parsed as Partial<LibraryFile>;
  if (file.format !== LIBRARY_FORMAT)
    return empty(
      `That file says it is “${String(file.format)}”, not an Aura design library. Use “Open a .json” in Take it with you for a single-home export.`,
    );
  if (typeof file.specVersion === "number" && file.specVersion > SPEC_VERSION)
    return empty(
      `That library was written by a newer version of the builder (spec v${file.specVersion}; this build reads v${SPEC_VERSION}). Nothing was imported — update the page and try again.`,
    );
  if (
    typeof file.documentVersion === "number" &&
    file.documentVersion > BUILDER_DOCUMENT_VERSION
  )
    return empty(
      `That library was written by a newer version of the builder (document v${file.documentVersion}; this build reads v${BUILDER_DOCUMENT_VERSION}). Nothing was imported — update the page and try again.`,
    );
  if (!Array.isArray(file.designs)) return empty("That library file has no designs array in it.");

  const designs: SavedDesign[] = [];
  const skipped: string[] = [];

  for (let i = 0; i < file.designs.length; i += 1) {
    const entry: unknown = file.designs[i];
    const label = `design ${i + 1}`;
    if (typeof entry !== "object" || entry === null) {
      skipped.push(`${label} is not an object`);
      continue;
    }
    const d = entry as Partial<SavedDesign> & { spec?: unknown };
    const named = typeof d.name === "string" && d.name.length > 0 ? `“${d.name}”` : label;
    const problem = versionProblem(
      typeof d.specVersion === "number" ? d.specVersion : file.specVersion,
      typeof d.documentVersion === "number" ? d.documentVersion : file.documentVersion ?? 0,
    );
    if (problem) {
      skipped.push(`${named} — ${problem}`);
      continue;
    }
    const check = validateBuilderDocument(d.document ?? d.spec);
    if (!check.ok) {
      skipped.push(`${named} — ${check.problem}`);
      continue;
    }
    const name = cleanName(
      typeof d.name === "string" ? d.name : check.document.spec.name,
      "Untitled home",
    );
    const document: BuilderDocument = {
      ...check.document,
      spec: { ...check.document.spec, name },
    };
    let thumbnail: string | null = null;
    if (typeof d.thumbnail === "string" && d.thumbnail.startsWith("data:image/")) {
      if (d.thumbnail.length <= MAX_THUMBNAIL_CHARS) thumbnail = d.thumbnail;
      else skipped.push(`${named} — its thumbnail is oversized and was dropped; the design itself imported`);
    }
    const now = Date.now();
    designs.push({
      id: typeof d.id === "string" && d.id.length > 0 ? d.id : newId(),
      name,
      specVersion: SPEC_VERSION,
      documentVersion: BUILDER_DOCUMENT_VERSION,
      thumbnail,
      createdAt: typeof d.createdAt === "number" && Number.isFinite(d.createdAt) ? d.createdAt : now,
      updatedAt: typeof d.updatedAt === "number" && Number.isFinite(d.updatedAt) ? d.updatedAt : now,
      headline: headlineOf(document.spec),
      signature: await documentSignature(document),
      document,
    });
  }

  return { designs, skipped, problem: null };
}

export type ImportMode = "merge" | "replace";

export interface ImportReport {
  added: number;
  /** ids that collided with an existing design and were given a new one */
  renamed: number;
  /** designs deleted because the caller chose `replace` */
  removed: number;
}

/**
 * Write imported designs into the library.
 *
 * `merge` never overwrites: an incoming design whose id already exists is
 * given a fresh id and a “(imported)” suffix, so two machines that both have
 * an edit of the same design end up with both edits rather than one of them.
 * `replace` empties the library first, and is the caller's explicit choice to
 * make — this function does not decide it.
 */
export async function importDesigns(designs: SavedDesign[], mode: ImportMode): Promise<ImportReport> {
  let removed = 0;
  if (mode === "replace") {
    removed = (await listDesigns()).length;
    await clearLibrary();
  }

  const existing = new Set((await listDesigns()).map((d) => d.id));
  let added = 0;
  let renamed = 0;

  for (const d of designs) {
    const collides = existing.has(d.id);
    const id = collides ? newId() : d.id;
    const name = collides ? cleanName(`${d.name} (imported)`, "Imported home") : d.name;
    if (collides) renamed += 1;
    const document: BuilderDocument = {
      ...d.document,
      spec: { ...d.document.spec, name },
    };
    const meta: DesignMeta = {
      id,
      name,
      specVersion: SPEC_VERSION,
      documentVersion: BUILDER_DOCUMENT_VERSION,
      thumbnail: d.thumbnail,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      headline: headlineOf(document.spec),
      signature: await documentSignature(document),
    };
    // one transaction per design: a quota failure halfway through then leaves
    // the designs that fit, rather than rolling back the whole import
    await run([STORE_DESIGNS, STORE_DOCUMENTS], "readwrite", async (t) => {
      await req(t.objectStore(STORE_DESIGNS).put(meta));
      await req(t.objectStore(STORE_DOCUMENTS).put({ id, document }));
    });
    existing.add(id);
    added += 1;
  }

  announce();
  return { added, renamed, removed };
}

/* ---------------------------------------------------------------------------
   how much room is left
   --------------------------------------------------------------------------- */

export interface StorageEstimate {
  usageBytes: number | null;
  quotaBytes: number | null;
}

/** The browser's own estimate, when it has one. Chrome and Firefox report it;
 *  Safari historically does not, and nulls say so rather than guessing. */
export async function estimateStorage(): Promise<StorageEstimate> {
  if (typeof navigator === "undefined" || !navigator.storage || !navigator.storage.estimate)
    return { usageBytes: null, quotaBytes: null };
  try {
    const e = await navigator.storage.estimate();
    return {
      usageBytes: typeof e.usage === "number" ? e.usage : null,
      quotaBytes: typeof e.quota === "number" ? e.quota : null,
    };
  } catch {
    return { usageBytes: null, quotaBytes: null };
  }
}
