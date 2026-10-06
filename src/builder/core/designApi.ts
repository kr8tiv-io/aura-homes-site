/**
 * Typed client for the design step — local engine first, service optional.
 *
 * THE INVERSION. This started as a client for the FastAPI service in
 * `design-api/`, and an unreachable service was a dead end. It is not one any
 * more. The service's deterministic path — the part that needs no keys and no
 * network — is ported to TypeScript in `lib/design/`, so a design can always be
 * produced. `requestDesign()` tries the service and falls back to the local
 * engine, and the caller is told, in three distinguishable outcomes, which one
 * answered. aurahomes.fun is a static export: there is no server in production,
 * and the centrepiece of the product still has to work.
 *
 * WHAT THE SERVICE STILL ADDS, when one is connected: an LLM reasons the room
 * PROGRAM (naming, proportion, which rooms want windows), and an image backend
 * produces renders. It never adds accuracy to the drawing — the packer and the
 * drafting code are identical on both paths.
 *
 * The service was already designed to degrade rather than fail: it answers with
 * a full blueprint even when no LLM or image key is configured, and reports
 * which path it took. This client surfaces that instead of hiding it.
 */

export type EcoMaterial = "sip" | "rammed_earth" | "clt" | "timber_frame";
export type HomeStyle =
  | "scandinavian_minimalist"
  | "off_grid_cabin"
  | "passive_solar"
  | "modern_aframe";
export type ClimateZone = "4" | "5" | "6" | "7A" | "7B" | "8";

/* The design-service client was not ported. These two types are what the builder spec imports. */
