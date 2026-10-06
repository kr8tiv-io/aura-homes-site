/* ===========================================================================
   UNITS — the one place feet become words.

   Before this file there were six feet-and-inches formatters: ecoSpec (UI),
   blueprint (design sheet), drawings/kit (plan set), toPlan, parcel, and the
   fixtures prose variant. Five printed `34'-6"`; each existed because of a
   layering rule — `lib` must not depend on `components` — that the original
   (`components/design/ecoSpec.ts`) could not satisfy. This module lives in
   `lib`, so the rule is satisfied for every consumer and the copies can
   delegate instead of diverge. One of them had already diverged the way
   copies do: `blueprint.fmtFt` never handled a negative value and printed
   `-3'--6"`.

   THE ROUNDER IS A PARAMETER, NOT A POLICY. The drawing pipeline rounds
   halves to even (each drawing module keeps its own deliberate `pyRound`
   copy — see the header in `lib/builder/axon.ts` for why) because it is a
   port of Python and its sheets are golden-tested to the byte. The UI and
   report formatters round halves up with `Math.round`, and their outputs are
   pinned by their own specs. Consolidating the BODY while letting each call
   site keep its rounder means this file changes zero bytes of output
   anywhere — except the negative-sign bug, which was never a byte anybody
   wanted.
   =========================================================================== */

/** Feet-and-inches the way a drawing's dimension strings read: `34'-6"`.
 *  Sign-safe: the sign is printed once, in front, never inside the inches. */
export function formatFeetInches(v: number, round: (x: number) => number = Math.round): string {
  const sign = v < 0 ? "-" : "";
  const abs = Math.abs(v);
  let whole = Math.floor(abs + 1e-9);
  let inches = round((abs - whole) * 12);
  if (inches === 12) {
    whole += 1;
    inches = 0;
  }
  return `${sign}${whole}'-${inches}"`;
}

/** The same value as prose — `34 ft 6 in` — for sentences a clearance report
 *  speaks, where prime marks read as typos. Whole feet drop the inches. */
export function formatFeetInchesWords(v: number, round: (x: number) => number = Math.round): string {
  const sign = v < 0 ? "-" : "";
  const abs = Math.abs(v);
  let whole = Math.floor(abs + 1e-9);
  let inches = round((abs - whole) * 12);
  if (inches === 12) {
    whole += 1;
    inches = 0;
  }
  return inches === 0 ? `${sign}${whole} ft` : `${sign}${whole} ft ${inches} in`;
}
