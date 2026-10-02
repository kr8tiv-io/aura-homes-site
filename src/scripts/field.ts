import * as THREE from 'three';

/** Soft light in the cream space, plus a slow highlight under each marked heading. */
export function mountField(canvas: HTMLCanvasElement) {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  camera.position.z = 2;

  const theme = canvas.dataset.field || 'room';
  const mist = theme === 'glass' ? [0.86, 0.9, 0.91] : theme === 'resort' ? [0.84, 0.86, 0.9] : [0.91, 0.9, 0.87];
  const far = theme === 'glass' ? [0.74, 0.82, 0.86] : theme === 'resort' ? [0.7, 0.76, 0.84] : [0.8, 0.83, 0.82];
  const mid = theme === 'glass' ? [0.62, 0.72, 0.78] : theme === 'resort' ? [0.55, 0.62, 0.74] : [0.7, 0.74, 0.71];
  const near = theme === 'glass' ? [0.42, 0.54, 0.62] : theme === 'resort' ? [0.34, 0.42, 0.56] : [0.48, 0.54, 0.52];

  const bgMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uScroll: { value: 0 },
      uPointer: { value: new THREE.Vector2() },
      uMist: { value: new THREE.Vector3(...mist) },
      uFar: { value: new THREE.Vector3(...far) },
      uMid: { value: new THREE.Vector3(...mid) },
      uNear: { value: new THREE.Vector3(...near) },
      uSharp: { value: theme === 'resort' ? 1.55 : theme === 'glass' ? 1.22 : 1 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      uniform float uTime;
      uniform float uScroll;
      uniform vec2 uPointer;
      uniform vec3 uMist;
      uniform vec3 uFar;
      uniform vec3 uMid;
      uniform vec3 uNear;
      uniform float uSharp;
      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }
      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        float a = hash(i);
        float b = hash(i + vec2(1.0, 0.0));
        float c = hash(i + vec2(0.0, 1.0));
        float d = hash(i + vec2(1.0, 1.0));
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
      }
      float fbm(vec2 p) {
        float v = 0.0;
        float a = 0.5;
        for (int i = 0; i < 3; i++) {
          v += a * noise(p);
          p = p * 2.02 + vec2(1.7, 9.2);
          a *= 0.5;
        }
        return v;
      }
      float ridge(float x, float k) {
        float s = max(uSharp, 0.4);
        return sin(x * 2.4 * s + k) * 0.55 + sin(x * 5.1 * s + k * 1.6) * 0.28 + sin(x * 9.4 * s - k) * 0.12;
      }
      float cover(float y, float h) {
        return 1.0 - smoothstep(h - 0.01, h + 0.028, y);
      }
      void main() {
        vec2 p = vUv + uPointer * vec2(0.035, 0.012);
        float drift = uTime * 0.012;
        float lift = uScroll * 0.035;
        float farH = 0.34 + lift + ridge(p.x * 0.85 + drift * 0.35, 2.1) * 0.045;
        float midH = 0.24 + lift * 0.6 + ridge(p.x * 1.15 + drift * 0.55 + uPointer.x * 0.08, 1.2) * 0.055;
        float nearH = 0.12 + ridge(p.x * 1.45 + drift, 0.4) * 0.04;
        float sFar = cover(p.y, farH);
        float sMid = cover(p.y, midH);
        float sNear = cover(p.y, nearH);
        float n = fbm(vec2(p.x * 1.4 + drift, p.y * 0.7 - drift * 0.35 + uScroll * 0.12));
        float mistAmt = smoothstep(0.38, 0.78, n);
        float low = smoothstep(0.62, 0.02, p.y);
        float sides = smoothstep(0.46, 0.0, p.x) + smoothstep(0.62, 1.0, p.x);
        float reading = smoothstep(0.0, 0.02, p.x) * smoothstep(0.58, 0.36, p.x);
        reading *= smoothstep(0.08, 0.2, p.y) * smoothstep(0.86, 0.52, p.y);
        vec3 col = uMist;
        col = mix(col, uFar, sFar * (0.45 + mistAmt * 0.2));
        col = mix(col, uMid, sMid * 0.62);
        col = mix(col, uNear, sNear * 0.7);
        col = mix(col, uMist, mistAmt * low * 0.55);
        float alpha = low * 0.11 + sides * 0.08 + sFar * 0.1 + sMid * 0.14 + sNear * 0.18 + mistAmt * low * 0.07;
        alpha *= 1.0 - reading * 0.94;
        float traces = 0.0;
        for (int i = 0; i < 3; i++) {
          float fi = float(i);
          float slide = fract(uTime * (0.015 + fi * 0.005) + fi * 0.29);
          vec2 origin = vec2(slide * 1.5 - 0.25, 0.18 + fi * 0.22);
          vec2 dir = normalize(vec2(0.86, 0.22 + fi * 0.07));
          float d = abs(dot(p - origin, vec2(-dir.y, dir.x)));
          traces += exp(-d * d * (380.0 - fi * 50.0));
        }
        col = mix(col, vec3(0.93, 0.84, 0.7), traces * 0.28);
        alpha += traces * 0.04;
        gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.36));
      }
    `,
  });
  const bg = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), bgMat);
  bg.position.z = -0.4;
  scene.add(bg);

  const slots = Array.from({ length: 20 }, () => {
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uColor: { value: new THREE.Color(theme === 'resort' ? 0x9eb4d4 : theme === 'glass' ? 0xb7c6d0 : 0xc4a07a) },
        uAlpha: { value: 0 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec2 vUv;
        uniform vec3 uColor;
        uniform float uAlpha;
        void main() {
          float x = smoothstep(0.0, 0.18, vUv.x) * smoothstep(1.0, 0.42, vUv.x);
          float y = smoothstep(0.0, 0.45, vUv.y) * smoothstep(1.0, 0.2, vUv.y);
          float a = x * y * uAlpha;
          if (a < 0.008) discard;
          gl_FragColor = vec4(uColor, a);
        }
      `,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.04), mat);
    scene.add(mesh);
    return { mesh, mat };
  });

  let progress = 0;
  let lastW = 0;
  let lastH = 0;
  const resize = () => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w < 2 || h < 2 || (w === lastW && h === lastH)) return;
    lastW = w;
    lastH = h;
    renderer.setSize(w, h, false);
  };

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const pointer = new THREE.Vector2();
  const aim = new THREE.Vector2();
  const onPointer = (event: PointerEvent) => {
    aim.set((event.clientX / window.innerWidth) * 2 - 1, (event.clientY / window.innerHeight) * -2 + 1);
  };
  if (!reduce) window.addEventListener('pointermove', onPointer, { passive: true });
  let raf = 0;
  let cleared = false;
  const pageScroll = () => {
    const lenis = (window as Window & { __lenis?: { scroll?: number } }).__lenis;
    return lenis?.scroll ?? window.scrollY;
  };

  const roomBands =
    theme === 'room'
      ? [
          { mist: [0.91, 0.9, 0.87], far: [0.8, 0.83, 0.82], mid: [0.7, 0.74, 0.71], near: [0.48, 0.54, 0.52] },
          { mist: [0.86, 0.9, 0.91], far: [0.74, 0.82, 0.86], mid: [0.62, 0.72, 0.78], near: [0.42, 0.54, 0.62] },
          { mist: [0.9, 0.86, 0.82], far: [0.78, 0.74, 0.68], mid: [0.64, 0.58, 0.52], near: [0.46, 0.4, 0.36] },
          { mist: [0.84, 0.88, 0.92], far: [0.66, 0.74, 0.84], mid: [0.5, 0.58, 0.7], near: [0.34, 0.42, 0.54] },
        ]
      : null;
  const roomStops = [0, 0.3, 0.58, 1];
  const mixBand = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t);

  const render = (time = performance.now()) => {
    pointer.lerp(aim, 0.04);
    if (pageScroll() < window.innerHeight * 0.82) {
      if (!cleared) {
        renderer.clear();
        cleared = true;
      }
      return;
    }
    cleared = false;
    resize();
    if (roomBands) {
      let band = 0;
      while (band < roomStops.length - 2 && progress > roomStops[band + 1]) band += 1;
      const span = roomStops[band + 1] - roomStops[band] || 1;
      const blend = Math.min(1, Math.max(0, (progress - roomStops[band]) / span));
      const from = roomBands[band];
      const to = roomBands[band + 1];
      bgMat.uniforms.uMist.value.set(...mixBand(from.mist, to.mist, blend));
      bgMat.uniforms.uFar.value.set(...mixBand(from.far, to.far, blend));
      bgMat.uniforms.uMid.value.set(...mixBand(from.mid, to.mid, blend));
      bgMat.uniforms.uNear.value.set(...mixBand(from.near, to.near, blend));
    }
    bgMat.uniforms.uTime.value = time * 0.001;
    bgMat.uniforms.uScroll.value = progress;
    bgMat.uniforms.uPointer.value.copy(pointer);
    const marks = canvas.ownerDocument.querySelectorAll<HTMLElement>('[data-glow]');
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    slots.forEach((slot, i) => {
      const el = marks[i];
      if (!el) {
        slot.mat.opacity = 0;
        return;
      }
      const rect = el.getBoundingClientRect();
      const entered = 1 - Math.min(1, Math.max(0, (rect.top - h * 0.78) / (h * 0.32)));
      const lift = entered * entered * (3 - 2 * entered);
      const cx = ((rect.left + rect.width * 0.32) / w) * 2 - 1;
      const cy = -(((rect.bottom - 4) / h) * 2 - 1);
      slot.mesh.position.set(cx, cy - (1 - lift) * 0.05, 0);
      slot.mesh.scale.set(Math.max(0.45, (rect.width / w) * 2.4), 0.85 + lift * 0.35, 1);
      slot.mat.uniforms.uAlpha.value = lift * 0.26;
    });
    renderer.render(scene, camera);
  };

  const tick = (time: number) => {
    raf = requestAnimationFrame(tick);
    if (document.hidden) return;
    render(time);
  };
  if (reduce) render();
  else raf = requestAnimationFrame(tick);

  return {
    setProgress(t: number) {
      progress = Math.min(1, Math.max(0, t));
      if (reduce) render();
    },
    destroy() {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onPointer);
      bg.geometry.dispose();
      bgMat.dispose();
      slots.forEach((slot) => {
        slot.mesh.geometry.dispose();
        slot.mat.dispose();
      });
      renderer.dispose();
    },
  };
}
