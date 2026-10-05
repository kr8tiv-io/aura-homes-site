/*
  A small sun flare. The halo falloff is the geLC curve from
  Anderson Mancini's CC0 lens-flare shader:
  https://github.com/ektogamat/R3F-Ultimate-Lens-Flare
*/
import { BlendFunction, Effect } from 'postprocessing';
import { Uniform, Vector2, Vector3, type Camera } from 'three';

const FRAGMENT = /* glsl */ `
uniform vec2 uSun;
uniform float uGain;
uniform float uAspect;

float flareHalo(vec2 uv, vec2 sun) {
  vec2 delta = uv - sun;
  delta.x *= uAspect;
  float radius = length(delta);
  float core = pow(max(0.0, 1.0 - radius / 0.028), 10.0);
  float ghost = pow(max(0.0, 1.0 - abs(radius - 0.07) / 0.018), 2.0) * 0.22;
  return core + ghost;
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  float mask = flareHalo(uv, uSun);
  vec3 warm = vec3(1.0, 0.74, 0.38) * mask * uGain;
  outputColor = vec4(inputColor.rgb + warm, inputColor.a);
}
`;

export class TinySunFlareEffect extends Effect {
  private readonly sun: Vector3;
  private readonly camera: Camera;
  private readonly scratch = new Vector3();

  constructor(sun: Vector3, camera: Camera) {
    super('TinySunFlareEffect', FRAGMENT, {
      blendFunction: BlendFunction.SRC,
      uniforms: new Map<string, Uniform>([
        ['uSun', new Uniform(new Vector2(2, 2))],
        ['uGain', new Uniform(0.42)],
        ['uAspect', new Uniform(1)],
      ]),
    });
    this.sun = sun;
    this.camera = camera;
  }

  update() {
    const point = this.scratch.copy(this.sun).project(this.camera);
    const sun = this.uniforms.get('uSun') as Uniform<Vector2> | undefined;
    const aspect = this.uniforms.get('uAspect') as Uniform<number> | undefined;
    if (!sun || !aspect) return;
    const view = this.camera as Camera & { aspect?: number };
    aspect.value = view.aspect || 1;
    if (point.z > 1) sun.value.set(2, 2);
    else sun.value.set(point.x * 0.5 + 0.5, point.y * 0.5 + 0.5);
  }
}
