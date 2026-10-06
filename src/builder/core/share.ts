/* ===========================================================================
   SHARE — a design is a link.

   The founder's promise is that somebody plays with a little thing and walks
   it all the way to production. Halfway along that road they will want to show
   it to a partner, a lender, a designer, or a friend. The cheapest possible
   way to do that on a static site with no server and no account is to put the
   whole house in the URL.

   So this file is a codec: HomeSpec -> URL-safe token -> HomeSpec.

   THREE THINGS IT REFUSES TO DO
   -----------------------------
   1. It will not load a house it does not fully understand. Every field is
      checked on the way in. A token from a FUTURE SPEC_VERSION, a token whose
      roof form is not one of ours, a token with a NaN wall height — each is
      rejected with a named reason on the console and a `null` return. A
      half-read house is worse than no house: it looks like it worked.
   2. It will not silently accept a decompression bomb. A 2 kB token can
      inflate to hundreds of megabytes; the inflater is read with a hard byte
      ceiling and aborts past it.
   3. It will not let unknown keys through. Decoding rebuilds a fresh HomeSpec
      from validated primitives, so nothing rides along into the app.

   NO NEW DEPENDENCY. Everything here is the platform:
   · JSON for the payload
   · a positional (tuple) rewrite of the spec, plus small-integer enums, which
     is where most of the size saving comes from — key names are the bulk of
     JSON and none of them are in the wire form
   · CompressionStream("deflate-raw") when the browser has it, falling back to
     the uncompressed codec when it does not; the token says which it is
   · a hand-written base64url codec, ~40 lines, chosen over `btoa`/`atob`
     because it needs no environment feature-detection at all (this module is
     imported by client code in a static export, and a codec that behaves
     identically everywhere is one less thing that can differ between a
     prerender and the browser)

   MEASURED, not estimated (Node 24, `deflate-raw`, August 2026):

     defaultSpec()                   token 249 raw / 173 compressed
                                     full URL 205 chars
     three-volume L-plan with a
     78-character note               token 642 raw / 379 compressed
                                     full URL 411 chars

   For reference the same default spec is 748 characters as compact JSON and
   1,376 pretty-printed, so the wire form alone (before compression) is about
   a quarter of the JSON it replaces — 184 bytes against 748.

   Both cases sit far inside the ~2,000-character figure that is the safe floor
   across browsers, proxies and chat clients that re-wrap links. A spec would
   need roughly twenty volumes before the URL became a question at all.

   PUT THE TOKEN IN THE FRAGMENT (`#h=`), NOT THE QUERY. A fragment is never
   transmitted to the host, so a shared design does not also land in a
   web-server access log, a CDN log, or a Referer header. On a static export
   nothing server-side needs to read it, so the privacy is free.
   =========================================================================== */

import {
  SPEC_VERSION,
  type Deck,
  type HomeSpec,
  type Opening,
  type OpeningKind,
  type Roof,
  type RoofForm,
  type Siting,
  type Volume,
  type Wall,
} from "./spec";
import {
  BUILDER_DOCUMENT_VERSION,
  builderDocumentFromLegacySpec,
  canonicalBuilderDocumentJson,
  validateBuilderDocument,
  type BuilderDocument,
} from "./document";
import type { ClimateZone, EcoMaterial } from "./designApi";

/* ---------------------------------------------------------------------------
   ENUM TABLES — APPEND-ONLY, FOREVER.

   The wire form stores an INDEX into each of these arrays. That is what makes
   a token short, and it is also a trap with a very long fuse: inserting or
   reordering a value here would silently reinterpret every link ever shared.
   A gable would become an a-frame in somebody's saved URL and nothing would
   report an error.

   The rule, therefore: only ever append. If a value must be removed, leave a
   hole (a value that no longer validates) rather than closing the gap. If the
   ORDER must ever change, that is a SPEC_VERSION bump and a migration, not an
   edit to these lines.
   --------------------------------------------------------------------------- */

const MATERIALS: readonly EcoMaterial[] = ["sip", "rammed_earth", "clt", "timber_frame"];
const CLIMATE_ZONES: readonly ClimateZone[] = ["4", "5", "6", "7A", "7B", "8"];
const ROOF_FORMS: readonly RoofForm[] = ["gable", "a-frame", "shed", "flat", "saltbox"];
const WALLS: readonly Wall[] = ["n", "s", "e", "w"];
const OPENING_KINDS: readonly OpeningKind[] = ["window", "door", "glazing-wall"];
const SLOPES: readonly Siting["slope"][] = ["flat", "gentle", "steep"];

/* ---------------------------------------------------------------------------
   VALIDATION — the gate every untrusted spec comes through.

   Exported because the JSON import path in `exportSpec.ts` needs exactly the
   same gate. One definition, so a file dropped on the page and a link pasted
   into the address bar are held to identical standards.
   --------------------------------------------------------------------------- */

export type SpecValidation =
  | { ok: true; spec: HomeSpec }
  /** `problem` names the offending path, e.g. `volumes[1].roof.pitchDeg`. */
  | { ok: false; problem: string };

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Finite excludes NaN and both infinities. JSON cannot carry either, so this
 *  is really a guard against a string, a null, or a hand-edited payload. */
const isFinite_ = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

const isPositive = (v: unknown): v is number => isFinite_(v) && v > 0;
const isNonNegative = (v: unknown): v is number => isFinite_(v) && v >= 0;

function inTable<T extends string>(table: readonly T[], v: unknown): v is T {
  return typeof v === "string" && (table as readonly string[]).includes(v);
}

function validateRoof(v: unknown, path: string): { ok: true; roof: Roof } | { ok: false; problem: string } {
  if (!isObject(v)) return { ok: false, problem: `${path} is not an object` };
  if (!inTable(ROOF_FORMS, v.form)) return { ok: false, problem: `${path}.form is not a known roof form` };
  /* 0..90 exclusive of 90 is not a style opinion — `ridgeHeightFt()` in
     spec.ts takes tan(pitch), and tan(90°) is infinite. A pitch at or past 90
     produces a house with no computable ridge, which is the definition of a
     spec we do not understand. */
  if (!isFinite_(v.pitchDeg) || v.pitchDeg < 0 || v.pitchDeg >= 90)
    return { ok: false, problem: `${path}.pitchDeg must be a number in [0, 90)` };
  if (!isNonNegative(v.overhangFt)) return { ok: false, problem: `${path}.overhangFt must be >= 0` };
  const roof: Roof = { form: v.form, pitchDeg: v.pitchDeg, overhangFt: v.overhangFt };
  if (v.facing !== undefined) {
    if (!inTable(WALLS, v.facing)) return { ok: false, problem: `${path}.facing is not n/s/e/w` };
    roof.facing = v.facing;
  }
  return { ok: true, roof };
}

function validateOpening(
  v: unknown,
  path: string,
): { ok: true; opening: Opening } | { ok: false; problem: string } {
  if (!isObject(v)) return { ok: false, problem: `${path} is not an object` };
  if (typeof v.id !== "string" || v.id.length === 0)
    return { ok: false, problem: `${path}.id must be a non-empty string` };
  if (!inTable(WALLS, v.wall)) return { ok: false, problem: `${path}.wall is not n/s/e/w` };
  if (!inTable(OPENING_KINDS, v.kind)) return { ok: false, problem: `${path}.kind is not a known opening` };
  if (!isPositive(v.widthFt)) return { ok: false, problem: `${path}.widthFt must be > 0` };
  if (!isPositive(v.heightFt)) return { ok: false, problem: `${path}.heightFt must be > 0` };
  if (!isNonNegative(v.offsetFt)) return { ok: false, problem: `${path}.offsetFt must be >= 0` };
  if (!isNonNegative(v.sillFt)) return { ok: false, problem: `${path}.sillFt must be >= 0` };
  return {
    ok: true,
    opening: {
      id: v.id,
      wall: v.wall,
      kind: v.kind,
      widthFt: v.widthFt,
      heightFt: v.heightFt,
      offsetFt: v.offsetFt,
      sillFt: v.sillFt,
    },
  };
}

function validateVolume(
  v: unknown,
  path: string,
): { ok: true; volume: Volume } | { ok: false; problem: string } {
  if (!isObject(v)) return { ok: false, problem: `${path} is not an object` };
  if (typeof v.id !== "string" || v.id.length === 0)
    return { ok: false, problem: `${path}.id must be a non-empty string` };
  if (typeof v.name !== "string") return { ok: false, problem: `${path}.name must be a string` };
  if (!isPositive(v.widthFt)) return { ok: false, problem: `${path}.widthFt must be > 0` };
  if (!isPositive(v.depthFt)) return { ok: false, problem: `${path}.depthFt must be > 0` };
  if (!isFinite_(v.x)) return { ok: false, problem: `${path}.x must be a number` };
  if (!isFinite_(v.z)) return { ok: false, problem: `${path}.z must be a number` };
  if (!isFinite_(v.rotationDeg)) return { ok: false, problem: `${path}.rotationDeg must be a number` };
  if (v.storeys !== 1 && v.storeys !== 2) return { ok: false, problem: `${path}.storeys must be 1 or 2` };
  if (!isPositive(v.wallHeightFt)) return { ok: false, problem: `${path}.wallHeightFt must be > 0` };

  const roof = validateRoof(v.roof, `${path}.roof`);
  if (!roof.ok) return roof;

  if (!Array.isArray(v.openings)) return { ok: false, problem: `${path}.openings must be an array` };
  const openings: Opening[] = [];
  for (let i = 0; i < v.openings.length; i++) {
    const o = validateOpening(v.openings[i], `${path}.openings[${i}]`);
    if (!o.ok) return o;
    openings.push(o.opening);
  }

  return {
    ok: true,
    volume: {
      id: v.id,
      name: v.name,
      widthFt: v.widthFt,
      depthFt: v.depthFt,
      x: v.x,
      z: v.z,
      rotationDeg: v.rotationDeg,
      storeys: v.storeys,
      wallHeightFt: v.wallHeightFt,
      roof: roof.roof,
      openings,
    },
  };
}

function validateDeck(v: unknown): { ok: true; deck: Deck | null } | { ok: false; problem: string } {
  if (v === null || v === undefined) return { ok: true, deck: null };
  if (!isObject(v)) return { ok: false, problem: "deck is neither null nor an object" };
  if (!inTable(WALLS, v.wall)) return { ok: false, problem: "deck.wall is not n/s/e/w" };
  if (!isPositive(v.widthFt)) return { ok: false, problem: "deck.widthFt must be > 0" };
  if (!isPositive(v.depthFt)) return { ok: false, problem: "deck.depthFt must be > 0" };
  if (typeof v.hotTub !== "boolean") return { ok: false, problem: "deck.hotTub must be a boolean" };
  return { ok: true, deck: { wall: v.wall, widthFt: v.widthFt, depthFt: v.depthFt, hotTub: v.hotTub } };
}

/**
 * Check an unknown value against the frozen HomeSpec contract and, if it
 * passes, return a FRESH spec object built only from validated primitives.
 *
 * The rebuild matters as much as the check. Returning the caller's object
 * would carry any extra keys it happened to have straight into application
 * state; that is how a share link becomes an injection surface, and how a
 * field somebody invented in a hand-edited JSON file starts being honoured by
 * accident.
 *
 * NOTE ON WHAT IS *NOT* CHECKED. This validates the contract, not the
 * building: overlapping volumes, an opening wider than the wall it sits on, a
 * ridge over a height limit. Those are the builder UI's and the plan engine's
 * questions, and inventing them here would put a second, disagreeing opinion
 * about a house into the system.
 */
export function validateHomeSpec(value: unknown): SpecValidation {
  if (!isObject(value)) return { ok: false, problem: "spec is not an object" };

  if (value.version !== SPEC_VERSION)
    return {
      ok: false,
      problem: `spec.version is ${JSON.stringify(value.version)}, this build reads ${SPEC_VERSION}`,
    };
  if (typeof value.name !== "string") return { ok: false, problem: "name must be a string" };
  if (!inTable(MATERIALS, value.material)) return { ok: false, problem: "material is not a known material" };
  if (!inTable(CLIMATE_ZONES, value.climateZone))
    return { ok: false, problem: "climateZone is not a known zone" };
  if (typeof value.notes !== "string") return { ok: false, problem: "notes must be a string" };

  if (!Array.isArray(value.volumes)) return { ok: false, problem: "volumes must be an array" };
  const volumes: Volume[] = [];
  for (let i = 0; i < value.volumes.length; i++) {
    const r = validateVolume(value.volumes[i], `volumes[${i}]`);
    if (!r.ok) return r;
    volumes.push(r.volume);
  }

  const deck = validateDeck(value.deck);
  if (!deck.ok) return deck;

  if (!isObject(value.siting)) return { ok: false, problem: "siting is not an object" };
  if (!isFinite_(value.siting.frontFacesDeg))
    return { ok: false, problem: "siting.frontFacesDeg must be a number" };
  if (!inTable(SLOPES, value.siting.slope)) return { ok: false, problem: "siting.slope is not a known slope" };

  return {
    ok: true,
    spec: {
      version: SPEC_VERSION,
      name: value.name,
      material: value.material,
      climateZone: value.climateZone,
      volumes,
      deck: deck.deck,
      siting: { frontFacesDeg: value.siting.frontFacesDeg, slope: value.siting.slope },
      notes: value.notes,
    },
  };
}

/* ---------------------------------------------------------------------------
   THE COMPACT WIRE FORM

   The spec rewritten as nested arrays with integer enums. Measured at 25-30%
   of the bytes of the equivalent JSON object BEFORE any compression, because
   every key name disappears and key names are most of what JSON weighs.

   The shapes below ARE the format — they are read by position, so the order
   of the entries is as load-bearing as the enum tables above. Adding a field
   means appending to the END of a tuple (an old decoder reads `undefined`,
   which fails validation loudly) or bumping SPEC_VERSION.
   --------------------------------------------------------------------------- */

/** Strip float noise (9.500000000000002) without changing any value a slider
 *  or a text field can produce. 1e-4 ft is 0.0012 inches: below the resolution
 *  of anything in this system, and below the thickness of a drawn line. */
const q = (n: number): number => Math.round(n * 1e4) / 1e4;

type WireRoof = [form: number, pitchDeg: number, overhangFt: number, facing: number];
type WireOpening = [
  id: string,
  wall: number,
  kind: number,
  widthFt: number,
  heightFt: number,
  offsetFt: number,
  sillFt: number,
];
type WireVolume = [
  id: string,
  name: string,
  widthFt: number,
  depthFt: number,
  x: number,
  z: number,
  rotationDeg: number,
  storeys: number,
  wallHeightFt: number,
  roof: WireRoof,
  openings: WireOpening[],
];
/** `deck` is 0 when absent — one character, versus `null`'s four. */
type WireDeck = [wall: number, widthFt: number, depthFt: number, hotTub: number];
type WireSpec = [
  version: number,
  name: string,
  material: number,
  climateZone: number,
  volumes: WireVolume[],
  deck: WireDeck | 0,
  siting: [frontFacesDeg: number, slope: number],
  notes: string,
];

/** `facing` is optional on Roof; -1 is "absent" so the tuple stays fixed-width. */
const NO_FACING = -1;

function toWire(spec: HomeSpec): WireSpec {
  return [
    SPEC_VERSION,
    spec.name,
    MATERIALS.indexOf(spec.material),
    CLIMATE_ZONES.indexOf(spec.climateZone),
    spec.volumes.map(
      (v): WireVolume => [
        v.id,
        v.name,
        q(v.widthFt),
        q(v.depthFt),
        q(v.x),
        q(v.z),
        q(v.rotationDeg),
        v.storeys,
        q(v.wallHeightFt),
        [
          ROOF_FORMS.indexOf(v.roof.form),
          q(v.roof.pitchDeg),
          q(v.roof.overhangFt),
          v.roof.facing === undefined ? NO_FACING : WALLS.indexOf(v.roof.facing),
        ],
        v.openings.map(
          (o): WireOpening => [
            o.id,
            WALLS.indexOf(o.wall),
            OPENING_KINDS.indexOf(o.kind),
            q(o.widthFt),
            q(o.heightFt),
            q(o.offsetFt),
            q(o.sillFt),
          ],
        ),
      ],
    ),
    spec.deck
      ? [WALLS.indexOf(spec.deck.wall), q(spec.deck.widthFt), q(spec.deck.depthFt), spec.deck.hotTub ? 1 : 0]
      : 0,
    [q(spec.siting.frontFacesDeg), SLOPES.indexOf(spec.siting.slope)],
    spec.notes,
  ];
}

/** Index into a table, or `undefined` when the index is out of range. Every
 *  enum in a decoded token comes through here, so a corrupt or crafted index
 *  becomes a named validation failure rather than an `undefined` field. */
function fromTable<T extends string>(table: readonly T[], i: unknown): T | undefined {
  return typeof i === "number" && Number.isInteger(i) && i >= 0 && i < table.length ? table[i] : undefined;
}

/**
 * Wire form back to a plain object shaped like a HomeSpec.
 *
 * Deliberately loose: it reads positions and looks up enums, and anything it
 * cannot read becomes `undefined`. It does NOT decide whether the result is a
 * valid house — `validateHomeSpec` does that, once, for every input path.
 * Two half-validators that disagree is exactly the failure this file exists
 * to prevent.
 */
function fromWire(w: unknown): unknown {
  if (!Array.isArray(w)) return undefined;
  const [version, name, material, climateZone, volumes, deck, siting, notes] = w as WireSpec;

  const readOpening = (o: unknown): unknown => {
    if (!Array.isArray(o)) return undefined;
    const [id, wall, kind, widthFt, heightFt, offsetFt, sillFt] = o as WireOpening;
    return {
      id,
      wall: fromTable(WALLS, wall),
      kind: fromTable(OPENING_KINDS, kind),
      widthFt,
      heightFt,
      offsetFt,
      sillFt,
    };
  };

  const readVolume = (v: unknown): unknown => {
    if (!Array.isArray(v)) return undefined;
    const [id, vname, widthFt, depthFt, x, z, rotationDeg, storeys, wallHeightFt, roof, openings] =
      v as WireVolume;
    const r = Array.isArray(roof) ? (roof as WireRoof) : undefined;
    return {
      id,
      name: vname,
      widthFt,
      depthFt,
      x,
      z,
      rotationDeg,
      storeys,
      wallHeightFt,
      roof: r
        ? {
            form: fromTable(ROOF_FORMS, r[0]),
            pitchDeg: r[1],
            overhangFt: r[2],
            // NO_FACING is absent, not an error; anything else must resolve
            ...(r[3] === NO_FACING ? {} : { facing: fromTable(WALLS, r[3]) }),
          }
        : undefined,
      openings: Array.isArray(openings) ? openings.map(readOpening) : undefined,
    };
  };

  const d = Array.isArray(deck) ? (deck as WireDeck) : undefined;
  const s = Array.isArray(siting) ? (siting as [number, number]) : undefined;

  return {
    version,
    name,
    material: fromTable(MATERIALS, material),
    climateZone: fromTable(CLIMATE_ZONES, climateZone),
    volumes: Array.isArray(volumes) ? volumes.map(readVolume) : undefined,
    deck: d ? { wall: fromTable(WALLS, d[0]), widthFt: d[1], depthFt: d[2], hotTub: d[3] === 1 } : null,
    siting: s ? { frontFacesDeg: s[0], slope: fromTable(SLOPES, s[1]) } : undefined,
    notes,
  };
}

/* ---------------------------------------------------------------------------
   base64url — RFC 4648 §5, no padding.

   Every character of the output alphabet (A-Z a-z 0-9 - _) is an "unreserved"
   character in RFC 3986, so a token needs no percent-encoding at all: it is
   already safe in a query string, in a fragment, in a QR code and in a chat
   message that auto-links URLs. `encodeURIComponent` on one of these tokens is
   a no-op, which is the property we want.
   --------------------------------------------------------------------------- */

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

const B64_INV: Int16Array = (() => {
  const m = new Int16Array(128).fill(-1);
  for (let i = 0; i < 64; i++) m[B64.charCodeAt(i)] = i;
  return m;
})();

function bytesToBase64Url(bytes: Uint8Array): string {
  const n = bytes.length;
  let out = "";
  for (let i = 0; i < n; i += 3) {
    const has1 = i + 1 < n;
    const has2 = i + 2 < n;
    const triple = (bytes[i] << 16) | ((has1 ? bytes[i + 1] : 0) << 8) | (has2 ? bytes[i + 2] : 0);
    out += B64[(triple >>> 18) & 63] + B64[(triple >>> 12) & 63];
    if (has1) out += B64[(triple >>> 6) & 63];
    if (has2) out += B64[triple & 63];
  }
  return out;
}

function base64UrlToBytes(s: string): Uint8Array | null {
  const n = s.length;
  // a base64 group is 2, 3 or 4 characters; a remainder of 1 cannot exist
  if (n % 4 === 1) return null;
  const out = new Uint8Array(Math.floor((n * 3) / 4));
  let o = 0;
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < n; i++) {
    const c = s.charCodeAt(i);
    const v = c < 128 ? B64_INV[c] : -1;
    if (v < 0) return null; // any character outside the alphabet is a corrupt token
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >>> bits) & 0xff;
    }
  }
  return o === out.length ? out : out.subarray(0, o);
}

/* ---------------------------------------------------------------------------
   COMPRESSION — used when the platform has it and when it actually helps
   --------------------------------------------------------------------------- */

/** Anything larger than this, decompressed, is not one of our houses. A
 *  three-volume spec is ~1.3 kB of JSON; 1 MB is a thousandfold headroom and
 *  still small enough that a deflate bomb cannot cost the tab its memory. */
const MAX_INFLATED_BYTES = 1_000_000;

function hasCompressionStreams(): boolean {
  return typeof CompressionStream !== "undefined" && typeof DecompressionStream !== "undefined";
}

async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (!hasCompressionStreams()) return null;
  try {
    // "deflate-raw" (no zlib header, no checksum) is 6 bytes smaller than
    // "deflate" and is what every browser shipping CompressionStream supports.
    const cs = new CompressionStream("deflate-raw");
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(cs);
    const buf = await new Response(stream).arrayBuffer();
    return new Uint8Array(buf);
  } catch {
    // an older browser that has CompressionStream but not the raw format
    return null;
  }
}

/** Inflate with a hard ceiling. Reads chunk by chunk and abandons the stream
 *  the moment the running total passes `MAX_INFLATED_BYTES`, so a crafted
 *  token cannot allocate its way through the tab. */
async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (!hasCompressionStreams()) return null;
  try {
    const ds = new DecompressionStream("deflate-raw");
    const reader = new Blob([bytes as BlobPart]).stream().pipeThrough(ds).getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > MAX_INFLATED_BYTES) {
          await reader.cancel();
          return null;
        }
        chunks.push(value);
      }
    }
    const out = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) {
      out.set(c, at);
      at += c.byteLength;
    }
    return out;
  } catch {
    return null; // not valid deflate data
  }
}

/* ---------------------------------------------------------------------------
   THE TOKEN

     A <version:digits> <codec:letter> <payload:base64url>

   e.g. `A1rW3sxLC...`. The leading `A` makes a token recognisable at a glance
   and stops an arbitrary string from being mistaken for one; the version is
   read BEFORE the payload is touched, so a future link is refused by version
   rather than by a confusing parse failure inside it.

   codec `r` — the payload is UTF-8 JSON of the wire form. Byte-identical on
               every browser for a given spec, which is what makes the sync
               encoder the deterministic one.
   codec `z` — the same bytes, deflate-raw compressed. A few bytes may differ
               between browser deflate implementations; the DECODED spec never
               does, and that is the invariant that matters.
   --------------------------------------------------------------------------- */

const TOKEN_RE = /^A(\d+)([rz])([A-Za-z0-9_-]+)$/;

/** Query/fragment key a share link uses. */
export const SHARE_PARAM = "h";

/** A token longer than this is not one of ours; refused before any work. */
const MAX_TOKEN_CHARS = 64_000;

function encodeBody(spec: HomeSpec): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(toWire(spec)));
}

/**
 * Encode without compression. Synchronous, dependency-free, and BYTE-STABLE:
 * the same spec always produces the same string, in any browser, in any order.
 * That is why this is the one used for tests, fixtures and diffs.
 *
 * Throws — rather than returning a corrupt token — if handed something that is
 * not a valid HomeSpec. Encoding a bad spec is our bug; decoding a bad token
 * is the world's, and the two deserve different treatment.
 */
export function encodeSpecSync(spec: HomeSpec): string {
  const check = validateHomeSpec(spec);
  if (!check.ok) throw new Error(`share.encodeSpec: refusing to encode an invalid spec — ${check.problem}`);
  return `A${SPEC_VERSION}r${bytesToBase64Url(encodeBody(check.spec))}`;
}

/**
 * Encode, compressing when the platform can and when it actually pays.
 *
 * Compression is not unconditional: base64 inflates whatever it wraps by a
 * third, and on a very short spec deflate's own overhead can lose to that. The
 * shorter of the two tokens wins, so this never returns a longer URL than
 * `encodeSpecSync` would have.
 */
export async function encodeSpec(spec: HomeSpec): Promise<string> {
  const raw = encodeSpecSync(spec);
  const packed = await deflateRaw(encodeBody(spec));
  if (!packed) return raw;
  const z = `A${SPEC_VERSION}z${bytesToBase64Url(packed)}`;
  return z.length < raw.length ? z : raw;
}

interface ParsedToken {
  version: number;
  codec: "r" | "z";
  bytes: Uint8Array;
}

/** Everything that can be checked without inflating anything. */
function parseToken(token: unknown): ParsedToken | null {
  if (typeof token !== "string" || token.length === 0) {
    console.error("[aura/share] no token to decode");
    return null;
  }
  if (token.length > MAX_TOKEN_CHARS) {
    console.error(`[aura/share] token is ${token.length} characters — refusing to decode`);
    return null;
  }
  const m = TOKEN_RE.exec(token);
  if (!m) {
    console.error("[aura/share] token is not an Aura design link (expected A<version><codec><payload>)");
    return null;
  }
  const version = Number(m[1]);
  if (version > SPEC_VERSION) {
    console.error(
      `[aura/share] this link was made by a newer version of the builder (spec v${version}, this build reads v${SPEC_VERSION}). Refusing to guess at it.`,
    );
    return null;
  }
  if (version < SPEC_VERSION) {
    /* When SPEC_VERSION is bumped, this is where a migration goes: read the
       old wire form, upgrade it, hand the result to validateHomeSpec. Until
       one exists, an old link is refused out loud rather than mis-read. */
    console.error(
      `[aura/share] this link is spec v${version} and no migration to v${SPEC_VERSION} exists yet.`,
    );
    return null;
  }
  const bytes = base64UrlToBytes(m[3]);
  if (!bytes) {
    console.error("[aura/share] token payload is not valid base64url — the link is truncated or corrupt");
    return null;
  }
  return { version, codec: m[2] as "r" | "z", bytes };
}

function finish(json: Uint8Array): HomeSpec | null {
  if (json.byteLength > MAX_INFLATED_BYTES) {
    console.error(`[aura/share] payload is ${json.byteLength} bytes — refusing to decode`);
    return null;
  }
  let wire: unknown;
  try {
    wire = JSON.parse(new TextDecoder().decode(json));
  } catch (err) {
    console.error("[aura/share] payload is not valid JSON:", err);
    return null;
  }
  const check = validateHomeSpec(fromWire(wire));
  if (!check.ok) {
    console.error(`[aura/share] refusing to load a half-understood house — ${check.problem}`);
    return null;
  }
  return check.spec;
}

/**
 * Decode a share token. **This is the decoder to use** — it handles both
 * codecs.
 *
 * Returns `null`, never a partial house, and always says why on the console
 * first. Every rejection path is deliberate: an unrecognised shape, a future
 * spec version, a corrupt payload, a decompression bomb, a field that is not
 * what the frozen contract says it is.
 */
export async function decodeSpec(token: string): Promise<HomeSpec | null> {
  const p = parseToken(token);
  if (!p) return null;
  if (p.codec === "r") return finish(p.bytes);

  const json = await inflateRaw(p.bytes);
  if (!json) {
    console.error(
      hasCompressionStreams()
        ? "[aura/share] compressed payload would not inflate — the link is corrupt or was truncated"
        : "[aura/share] this link is compressed and this browser has no DecompressionStream",
    );
    return null;
  }
  return finish(json);
}

/* ---------------------------------------------------------------------------
   COMPLETE BUILDER DOCUMENT LINKS

   `A` tokens above remain readable forever as legacy HomeSpec links. New
   links use `D` and carry the validated BuilderDocument, including partitions,
   finishes, fixtures, comfort targets and quarantine. The version is still
   checked before a payload is inflated or parsed.
   --------------------------------------------------------------------------- */

const DOCUMENT_TOKEN_RE = /^D(\d+)([rz])([A-Za-z0-9_-]+)$/;
export const MAX_SHARE_TOKEN_CHARS = 16_000;

function encodeDocumentBody(document: BuilderDocument): Uint8Array {
  return new TextEncoder().encode(canonicalBuilderDocumentJson(document));
}

export function encodeDocumentSync(document: BuilderDocument): string {
  return `D${BUILDER_DOCUMENT_VERSION}r${bytesToBase64Url(encodeDocumentBody(document))}`;
}

export async function encodeDocument(document: BuilderDocument): Promise<string> {
  const raw = encodeDocumentSync(document);
  const packed = await deflateRaw(encodeDocumentBody(document));
  if (!packed) return raw;
  const compressed = `D${BUILDER_DOCUMENT_VERSION}z${bytesToBase64Url(packed)}`;
  return compressed.length < raw.length ? compressed : raw;
}

function parseDocumentToken(token: unknown): ParsedToken | null {
  if (typeof token !== "string" || token.length === 0) {
    console.error("[aura/share] no document token to decode");
    return null;
  }
  if (token.length > MAX_TOKEN_CHARS) {
    console.error(`[aura/share] document token is ${token.length} characters — refusing to decode`);
    return null;
  }
  const match = DOCUMENT_TOKEN_RE.exec(token);
  if (!match) {
    console.error("[aura/share] token is not an Aura project link (expected D<version><codec><payload>)");
    return null;
  }
  const version = Number(match[1]);
  if (version > BUILDER_DOCUMENT_VERSION) {
    console.error(
      `[aura/share] this link was made by a newer version of the builder (document v${version}, this build reads v${BUILDER_DOCUMENT_VERSION}). Refusing to guess at it.`,
    );
    return null;
  }
  // Older durable links reach `validateBuilderDocument`, which owns the
  // explicit migrations. Token framing and document schema are separate
  // boundaries; rejecting here would strand a readable v1 payload.
  if (version < 1) {
    console.error(`[aura/share] document version ${version} is invalid.`);
    return null;
  }
  const bytes = base64UrlToBytes(match[3]);
  if (!bytes) {
    console.error("[aura/share] project payload is not valid base64url — the link is truncated or corrupt");
    return null;
  }
  return { version, codec: match[2] as "r" | "z", bytes };
}

function finishDocument(json: Uint8Array): BuilderDocument | null {
  if (json.byteLength > MAX_INFLATED_BYTES) {
    console.error(`[aura/share] project payload is ${json.byteLength} bytes — refusing to decode`);
    return null;
  }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(json));
  } catch (error) {
    console.error("[aura/share] project payload is not valid JSON:", error);
    return null;
  }
  const checked = validateBuilderDocument(value);
  if (!checked.ok) {
    console.error(`[aura/share] refusing to load a half-understood project — ${checked.problem}`);
    return null;
  }
  return checked.document;
}

export async function decodeDocument(token: string): Promise<BuilderDocument | null> {
  const parsed = parseDocumentToken(token);
  if (!parsed) return null;
  if (parsed.codec === "r") return finishDocument(parsed.bytes);
  const json = await inflateRaw(parsed.bytes);
  if (!json) {
    console.error(
      hasCompressionStreams()
        ? "[aura/share] compressed project payload would not inflate — the link is corrupt or truncated"
        : "[aura/share] this project link is compressed and this browser has no DecompressionStream",
    );
    return null;
  }
  return finishDocument(json);
}

export function decodeDocumentSync(token: string): BuilderDocument | null {
  const parsed = parseDocumentToken(token);
  if (!parsed) return null;
  if (parsed.codec === "z") {
    console.error("[aura/share] this project token is compressed — use decodeDocument()");
    return null;
  }
  return finishDocument(parsed.bytes);
}

/* ---------------------------------------------------------------------------
   URLs
   --------------------------------------------------------------------------- */

/* THE TOKEN GOES IN THE FRAGMENT. A fragment is never transmitted to the
   host, so a design shared with a friend does not also land in a web-server
   access log, a CDN log, or a referrer header. On a static export nothing
   server-side needs to read it anyway, so there is no cost to the privacy.

   Writers for legacy HomeSpec (`A`) links are gone — every new link is a `D`
   document link — but the READERS below accept both forever. */
export async function documentToShareUrl(
  document: BuilderDocument,
  base?: string,
): Promise<string> {
  const token = await encodeDocument(document);
  if (token.length > MAX_SHARE_TOKEN_CHARS) {
    throw new Error(
      `This project needs ${token.length.toLocaleString("en-US")} characters, above Aura's ${MAX_SHARE_TOKEN_CHARS.toLocaleString("en-US")} character share-link limit. Download the .aura.json project file instead; nothing was omitted.`,
    );
  }
  const href = base ?? (typeof window === "undefined" ? "" : window.location.href);
  return `${href.replace(/[?#].*$/, "")}#${SHARE_PARAM}=${token}`;
}

/**
 * Pull a spec out of a URL, a `location.hash`, a `location.search`, or a bare
 * token. Accepts all four because callers will inevitably pass all four.
 *
 * Returns `null` when there is no token present — which is the ordinary case
 * on a first visit, and so is NOT logged as an error. Only a token that is
 * present and unreadable gets shouted about.
 */
export async function specFromShareUrl(source: string): Promise<HomeSpec | null> {
  const token = extractToken(source);
  return token === null ? null : decodeSpec(token);
}

/** The token inside a URL/hash/query, or the input itself if it already is
 *  one, or `null` if there is nothing that looks like a token here. */
export function extractToken(source: string): string | null {
  if (typeof source !== "string" || source.length === 0) return null;
  if (TOKEN_RE.test(source) || DOCUMENT_TOKEN_RE.test(source)) return source;
  const marker = new RegExp(`[?#&]${SHARE_PARAM}=([^&#]+)`);
  const m = marker.exec(source);
  if (!m) return null;
  // decodeURIComponent is a no-op on a well-formed token, but a chat client or
  // a link shortener may have percent-encoded it on the way through.
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

export async function documentFromString(source: string): Promise<BuilderDocument | null> {
  const token = extractToken(source);
  if (token === null) return null;
  if (DOCUMENT_TOKEN_RE.test(token)) return decodeDocument(token);
  const spec = await decodeSpec(token);
  return spec ? builderDocumentFromLegacySpec(spec) : null;
}

/** Checks the fragment first (where the share writers put the token) and the
 *  query second, so a token pasted into `?h=` by hand still works. */
export async function documentFromLocation(): Promise<BuilderDocument | null> {
  if (typeof window === "undefined") return null;
  const { hash, search } = window.location;
  return (await documentFromString(hash)) ?? (await documentFromString(search));
}
