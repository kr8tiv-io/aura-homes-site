/*
  One fixed canvas. Headings warm up on hover, then cool.
  Simplex noise is Ian McEwan / Ashima Arts, maintained by Stefan Gustavson (MIT):
  https://github.com/stegu/webgl-noise
  The splash wordmark is never registered.
*/
import { gsap } from 'gsap';
import { onQuality, qualityProfile } from '../three/quality';

const SLOTS = 4;
const HEAT_IN = 1.2;
const HEAT_OUT = 2.4;

type Mode = 'webgl' | 'css';

type Item = {
  el: HTMLElement;
  heat: number;
  dark: boolean;
  pointer: boolean;
  focus: boolean;
  token: number;
  tween: gsap.core.Tween | null;
};

const VERT = /* glsl */ `#version 100
attribute vec2 a;
void main() {
  gl_Position = vec4(a, 0.0, 1.0);
}
`;

const FRAG = /* glsl */ `#version 100
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform vec4 uRect[4];
uniform float uHeat[4];
uniform float uDark[4];

vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute(vec3 x) { return mod289(((x * 34.0) + 10.0) * x); }

float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod289(i);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m;
  m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

void main() {
  vec2 frag = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec3 color = vec3(0.0);
  float alpha = 0.0;
  for (int i = 0; i < 4; i++) {
    float heat = uHeat[i];
    vec4 rect = uRect[i];
    float live = step(0.001, heat) * step(1.0, rect.z) * step(1.0, rect.w);
    vec2 center = rect.xy + rect.zw * 0.5;
    vec2 halfSize = max(rect.zw * 0.5, vec2(8.0));
    vec2 reach = halfSize * vec2(0.92, 1.08) + vec2(42.0, 30.0);
    vec2 p = (frag - center) / reach;
    float n1 = snoise(p * 1.35 + vec2(uTime * 0.045, -uTime * 0.03));
    float n2 = snoise(vec2(p.y * 1.8 + 3.2, p.x * 1.5) + vec2(uTime * 0.02, uTime * 0.05));
    p += vec2(n1, n2) * 0.1;
    float dist = dot(p, p);
    float edge = smoothstep(1.02, 0.16, dist);
    float core = smoothstep(0.72, 0.0, dist);
    vec3 amber = vec3(0.722, 0.392, 0.165);
    vec3 gold = vec3(0.949, 0.761, 0.478);
    vec3 col = mix(gold, amber, core);
    float amount = edge * heat * mix(0.3, 0.46, uDark[i]) * live;
    color += col * amount;
    alpha += amount;
  }
  alpha = clamp(alpha, 0.0, 0.62);
  vec3 straight = color / max(alpha, 0.0008);
  gl_FragColor = vec4(clamp(straight, 0.0, 1.0), alpha);
}
`;

const heats = new Map<HTMLElement, Item>();
const rectData = new Float32Array(SLOTS * 4);
const heatData = new Float32Array(SLOTS);
const darkData = new Float32Array(SLOTS);

let booted = false;
let bound = false;
let mode: Mode = 'css';
let ears = new AbortController();
let bootAbort = new AbortController();
let stopQuality: (() => void) | null = null;
let raf = 0;
let canvas: HTMLCanvasElement | null = null;
let gl: WebGL2RenderingContext | null = null;
let program: WebGLProgram | null = null;
let uRes: WebGLUniformLocation | null = null;
let uTime: WebGLUniformLocation | null = null;
let uRect: WebGLUniformLocation | null = null;
let uHeat: WebGLUniformLocation | null = null;
let uDark: WebGLUniformLocation | null = null;

function canvasEl(): HTMLCanvasElement | null {
  const node = document.getElementById('warmth-canvas');
  return node instanceof HTMLCanvasElement ? node : null;
}

function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function touchOnly(): boolean {
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const fine = window.matchMedia('(any-pointer: fine)').matches;
  return coarse && !fine;
}

function compile(context: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
  const shader = context.createShader(type);
  if (!shader) return null;
  context.shaderSource(shader, source);
  context.compileShader(shader);
  if (!context.getShaderParameter(shader, context.COMPILE_STATUS)) {
    console.warn(context.getShaderInfoLog(shader));
    context.deleteShader(shader);
    return null;
  }
  return shader;
}

function linkProgram(): boolean {
  if (!gl || !canvas) return false;
  const vs = compile(gl, gl.VERTEX_SHADER, VERT);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
  const next = gl.createProgram();
  if (!vs || !fs || !next) return false;
  gl.attachShader(next, vs);
  gl.attachShader(next, fs);
  gl.linkProgram(next);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(next, gl.LINK_STATUS)) {
    console.warn(gl.getProgramInfoLog(next));
    gl.deleteProgram(next);
    return false;
  }
  if (program) gl.deleteProgram(program);
  program = next;
  gl.useProgram(program);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(program, 'a');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  uRes = gl.getUniformLocation(program, 'uRes');
  uTime = gl.getUniformLocation(program, 'uTime');
  uRect = gl.getUniformLocation(program, 'uRect[0]');
  uHeat = gl.getUniformLocation(program, 'uHeat[0]');
  uDark = gl.getUniformLocation(program, 'uDark[0]');
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.BLEND);
  return true;
}

function ensureGl(): boolean {
  const node = canvasEl();
  if (!node) return false;
  if (node === canvas && gl && program) return true;
  canvas = node;
  gl = node.getContext('webgl2', {
    alpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: true,
    powerPreference: 'low-power',
  });
  if (!gl) return false;
  return linkProgram();
}

function isDark(el: HTMLElement): boolean {
  const parts = getComputedStyle(el).color.match(/[\d.]+/g);
  if (!parts || parts.length < 3) return false;
  const r = Number(parts[0]) / 255;
  const g = Number(parts[1]) / 255;
  const b = Number(parts[2]) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.62;
}

function collect(): HTMLElement[] {
  const list: HTMLElement[] = [];
  document.querySelectorAll('h1, h2').forEach((node) => {
    if (!(node instanceof HTMLElement)) return;
    if (node.closest('.splash, .site-nav, .site-foot, #story-menu, [hidden]')) return;
    list.push(node);
  });
  return list;
}

function releaseHeads() {
  ears.abort();
  ears = new AbortController();
  for (const item of heats.values()) {
    item.tween?.kill();
    item.el.classList.remove('heading-heat');
    delete item.el.dataset.heatTone;
  }
  heats.clear();
  bound = false;
}

function bindHeads() {
  releaseHeads();
  const signal = ears.signal;
  for (const el of collect()) {
    const item: Item = {
      el,
      heat: 0,
      dark: isDark(el),
      pointer: false,
      focus: false,
      token: 0,
      tween: null,
    };
    heats.set(el, item);
    el.classList.add('heading-heat');
    el.dataset.heatTone = item.dark ? 'dark' : 'light';
    if (mode !== 'webgl') continue;
    el.addEventListener('pointerenter', () => {
      item.pointer = true;
      sync(item);
    }, { signal });
    el.addEventListener('pointerleave', () => {
      item.pointer = false;
      sync(item);
    }, { signal });
  }
  bound = true;
}

function itemFromFocus(target: EventTarget | null): Item | null {
  if (!(target instanceof Element)) return null;
  if (target instanceof HTMLElement && heats.has(target)) return heats.get(target) ?? null;
  const host = target.closest('h1, h2');
  if (host instanceof HTMLElement && heats.has(host)) return heats.get(host) ?? null;
  if (target instanceof HTMLAnchorElement) {
    const nested = target.querySelector('h1, h2');
    if (nested instanceof HTMLElement && heats.has(nested)) return heats.get(nested) ?? null;
  }
  return null;
}

function easeTo(item: Item, target: number) {
  if (mode !== 'webgl') return;
  if (!item.tween && Math.abs(item.heat - target) < 0.001) return;
  item.token += 1;
  const token = item.token;
  item.tween?.kill();
  const rising = target > item.heat;
  item.tween = gsap.to(item, {
    heat: target,
    duration: rising ? HEAT_IN : HEAT_OUT,
    ease: rising ? 'power2.out' : 'power1.inOut',
    overwrite: true,
    onComplete: () => {
      if (item.token === token) item.tween = null;
    },
  });
  wake();
}

function sync(item: Item) {
  easeTo(item, item.pointer || item.focus ? 1 : 0);
}

function onFocusIn(event: FocusEvent) {
  if (mode !== 'webgl') return;
  const item = itemFromFocus(event.target);
  if (!item) return;
  item.focus = true;
  sync(item);
}

function onFocusOut(event: FocusEvent) {
  if (mode !== 'webgl') return;
  const item = itemFromFocus(event.target);
  if (!item) return;
  const next = event.relatedTarget;
  if (next instanceof Node && (item.el.contains(next) || next.contains(item.el))) return;
  item.focus = false;
  sync(item);
}

function fitCanvas() {
  if (!gl || !canvas) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  const width = Math.max(1, Math.floor(canvas.clientWidth * dpr));
  const height = Math.max(1, Math.floor(canvas.clientHeight * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
    gl.viewport(0, 0, width, height);
  }
}

function clearGlow() {
  canvas?.classList.remove('is-live', 'is-screen');
  if (!gl) return;
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
}

function paint(now: number) {
  if (!gl || !program || !canvas) return;
  fitCanvas();
  const hot: Item[] = [];
  for (const item of heats.values()) {
    if (item.heat > 0.004 && item.el.isConnected) hot.push(item);
  }
  hot.sort((a, b) => b.heat - a.heat);
  const draw = hot.slice(0, SLOTS);
  rectData.fill(0);
  heatData.fill(0);
  darkData.fill(0);
  const scaleX = canvas.clientWidth > 0 ? canvas.width / canvas.clientWidth : 1;
  const scaleY = canvas.clientHeight > 0 ? canvas.height / canvas.clientHeight : 1;
  let darkLead = false;
  draw.forEach((item, index) => {
    const rect = item.el.getBoundingClientRect();
    rectData[index * 4] = rect.left * scaleX;
    rectData[index * 4 + 1] = rect.top * scaleY;
    rectData[index * 4 + 2] = rect.width * scaleX;
    rectData[index * 4 + 3] = rect.height * scaleY;
    heatData[index] = item.heat;
    darkData[index] = item.dark ? 1 : 0;
    if (item.dark && item.heat > 0.08) darkLead = true;
  });
  canvas.classList.toggle('is-live', draw.length > 0);
  canvas.classList.toggle('is-screen', darkLead);
  gl.useProgram(program);
  gl.uniform2f(uRes, canvas.width, canvas.height);
  gl.uniform1f(uTime, now * 0.001);
  gl.uniform4fv(uRect, rectData);
  gl.uniform1fv(uHeat, heatData);
  gl.uniform1fv(uDark, darkData);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

function busy(): boolean {
  for (const item of heats.values()) {
    if (item.heat > 0.004 || item.tween) return true;
  }
  return false;
}

function frame(now: number) {
  raf = 0;
  if (document.hidden || mode !== 'webgl') return;
  paint(now);
  if (busy()) raf = requestAnimationFrame(frame);
  else clearGlow();
}

function wake() {
  if (mode !== 'webgl' || raf || document.hidden) return;
  raf = requestAnimationFrame(frame);
}

function quench() {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  for (const item of heats.values()) {
    item.tween?.kill();
    item.tween = null;
    item.heat = 0;
    item.pointer = false;
    item.focus = false;
  }
  clearGlow();
}

function resolveMode(): Mode {
  if (reducedMotion()) return 'css';
  if (window.innerWidth < 1024) return 'css';
  if (touchOnly()) return 'css';
  if (document.body.classList.contains('is-builder')) return 'css';
  if (qualityProfile().tier === 'off') return 'css';
  if (!canvasEl()) return 'css';
  return 'webgl';
}

function refresh(rebind: boolean) {
  const previous = mode;
  mode = resolveMode();
  if (mode === 'webgl' && !ensureGl()) mode = 'css';
  document.documentElement.dataset.headingGlow = mode;
  if (rebind || mode !== previous || !bound) bindHeads();
  if (mode !== 'webgl') quench();
}

function onVisibility() {
  if (document.hidden) {
    for (const item of heats.values()) item.tween?.pause();
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    return;
  }
  for (const item of heats.values()) item.tween?.resume();
  wake();
}

function watch() {
  const signal = bootAbort.signal;
  const queries = [
    '(prefers-reduced-motion: reduce)',
    '(min-width: 1024px)',
    '(pointer: coarse)',
    '(any-pointer: fine)',
  ];
  for (const query of queries) {
    window.matchMedia(query).addEventListener('change', () => refresh(false), { signal });
  }
  window.addEventListener('resize', () => refresh(false), { passive: true, signal });
  stopQuality = onQuality(() => refresh(false));
  document.addEventListener('visibilitychange', onVisibility, { signal });
  document.addEventListener('focusin', onFocusIn, { signal });
  document.addEventListener('focusout', onFocusOut, { signal });
  document.addEventListener('astro:before-swap', () => releaseHeads(), { signal });
  let skip = true;
  document.addEventListener('astro:page-load', () => {
    if (skip) {
      skip = false;
      return;
    }
    refresh(true);
  }, { signal });
}

/** Shared heading heat. Safe to call again after a view transition. */
export function bindHeadingGlow() {
  if (!booted) {
    booted = true;
    watch();
  }
  refresh(true);
}

export function disposeHeadingGlow() {
  bootAbort.abort();
  bootAbort = new AbortController();
  stopQuality?.();
  stopQuality = null;
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  releaseHeads();
  clearGlow();
  if (gl && program) gl.deleteProgram(program);
  program = null;
  gl = null;
  canvas = null;
  booted = false;
}
