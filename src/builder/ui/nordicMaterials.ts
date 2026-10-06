/**
 * Shared visual material vocabulary for the story world and the builder.
 *
 * These are rendering profiles, not structural specifications or quote inputs.
 * `detail.scaleM` records the real-world size a procedural/owned map adapter
 * must use. The story already supplies authored procedural maps; the builder
 * currently shares the physical response while its mixed Box/Extrude UVs are
 * normalised in a later geometry pass. Keeping the intended scale here makes
 * that boundary explicit instead of stretching a decorative map dishonestly.
 */
export type NordicDetailKind =
  | "wood-grain"
  | "standing-seam"
  | "mineral-mottle"
  | "stone-variation"
  | "metal-brush"
  | "glass-imperfection"
  | "woven-fibre"
  | "water-ripple"
  | "soil-grain"
  | "vegetation";

export interface NordicMaterialProfile {
  color: string;
  roughness: number;
  metalness: number;
  opacity?: number;
  transmission?: number;
  ior?: number;
  clearcoat?: number;
  detail: { kind: NordicDetailKind; scaleM: number; strength: number };
}

export const NORDIC_MATERIALS = {
  cedar: {
    color: "#a97e57",
    roughness: 0.86,
    metalness: 0,
    detail: { kind: "wood-grain", scaleM: 0.18, strength: 0.34 },
  },
  ash: {
    color: "#b08a5e",
    roughness: 0.74,
    metalness: 0,
    detail: { kind: "wood-grain", scaleM: 0.14, strength: 0.24 },
  },
  standingSeam: {
    color: "#242a27",
    roughness: 0.5,
    metalness: 0.38,
    detail: { kind: "standing-seam", scaleM: 0.42, strength: 0.22 },
  },
  limeRender: {
    color: "#e7e1d5",
    roughness: 0.94,
    metalness: 0,
    detail: { kind: "mineral-mottle", scaleM: 0.08, strength: 0.12 },
  },
  stone: {
    color: "#8d968f",
    roughness: 0.95,
    metalness: 0,
    detail: { kind: "stone-variation", scaleM: 0.22, strength: 0.3 },
  },
  blackAluminium: {
    color: "#20261f",
    roughness: 0.56,
    metalness: 0.38,
    detail: { kind: "metal-brush", scaleM: 0.012, strength: 0.08 },
  },
  glass: {
    color: "#a8cfd4",
    roughness: 0.1,
    metalness: 0.05,
    opacity: 0.38,
    transmission: 0.62,
    ior: 1.45,
    clearcoat: 0.42,
    detail: { kind: "glass-imperfection", scaleM: 0.035, strength: 0.035 },
  },
  wool: {
    color: "#cbbfa6",
    roughness: 0.98,
    metalness: 0,
    detail: { kind: "woven-fibre", scaleM: 0.006, strength: 0.18 },
  },
  water: {
    color: "#4f8d86",
    roughness: 0.18,
    metalness: 0.08,
    opacity: 0.9,
    clearcoat: 0.8,
    detail: { kind: "water-ripple", scaleM: 0.09, strength: 0.26 },
  },
  soil: {
    color: "#6d5844",
    roughness: 1,
    metalness: 0,
    detail: { kind: "soil-grain", scaleM: 0.045, strength: 0.18 },
  },
  vegetation: {
    color: "#6f9c5e",
    roughness: 1,
    metalness: 0,
    detail: { kind: "vegetation", scaleM: 0.025, strength: 0.22 },
  },
} as const satisfies Record<string, NordicMaterialProfile>;
