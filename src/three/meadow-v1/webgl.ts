/** Lightweight capability probe used before the heavy story bundle mounts. */
export function probeWebGL(): boolean | null {
  if (typeof document === "undefined") return null;
  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("webgl2") || canvas.getContext("webgl");
    if (!context) return false;
    context.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}
