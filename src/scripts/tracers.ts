/*
  One full-viewport canvas. Faint star heads walk the edges of a few rules
  and outlines, then rest. The same WebGL context used to draw full-screen
  bands. No three.js here.

  Low and medium tiers leave that context to the meadow stage and draw the
  SVG fallback instead, so a phone keeps a single live WebGL context.
*/
import { qualityProfile } from '../three/quality';

type Kind = 'edge' | 'rule' | 'outline' | 'underline';
type Side = 'top' | 'bottom' | 'text' | 'mid' | 'box';
type RGB = [number, number, number];

type Target = {
  el: HTMLElement;
  kind: Kind;
  side: Side;
  visible: boolean;
  light: boolean;
  fixed: boolean;
  docX: number;
  docY: number;
  w: number;
  h: number;
  r: number;
  len: number;
  font: number;
  cool: number;
};

type Comet = {
  target: Target;
  start: number;
  dir: 1 | -1;
  travel: number;
  tail: number;
  born: number;
  life: number;
  head: RGB;
};

type Box = {
  el: HTMLElement;
  docX: number;
  docY: number;
  w: number;
  h: number;
  fixed: boolean;
};

const IVORY: RGB = [0.957, 0.953, 0.937];
const HALO: RGB = [0.769, 0.627, 0.478];
const BRONZE: RGB = [0.612, 0.478, 0.333];

const LOCKED: ReadonlyArray<{ sel: string; kind: Kind; side: Side }> = [
  { sel: '.nav-words a[aria-current="page"]', kind: 'underline', side: 'mid' },
  { sel: '.nav-quote', kind: 'outline', side: 'box' },
  { sel: '.ways > ol > li', kind: 'rule', side: 'top' },
  { sel: '.site-foot', kind: 'rule', side: 'top' },
];

const SKIP = '.splash, .passage, .living-hero, .nav-panel, .aura-logo, .nav-brand, .foot-brand, #cabin-film';
const BLOCKERS = '#cabin-film, .splash-film, .splash-stage, .splash, .passage, .living-hero, canvas.stage-canvas';

const MAX_POINTS = 220;
const STRIDE = 7;
const FADE_MS = 1500;

const VERT = `
attribute vec2 aPos;
attribute float aSize;
attribute vec4 aColor;
uniform vec2 uCss;
uniform float uDpr;
varying vec4 vColor;
void main() {
  vec2 ndc = vec2((aPos.x / uCss.x) * 2.0 - 1.0, 1.0 - (aPos.y / uCss.y) * 2.0);
  gl_Position = vec4(ndc, 0.0, 1.0);
  gl_PointSize = max(aSize * uDpr, 1.0);
  vColor = aColor;
}
`;

const FRAG = `
precision mediump float;
varying vec4 vColor;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  float core = smoothstep(0.16, 0.0, r);
  float halo = smoothstep(1.0, 0.2, r);
  float alpha = (core * 0.9 + halo * 0.46) * vColor.a;
  if (alpha < 0.004) discard;
  gl_FragColor = vec4(vColor.rgb * alpha, alpha);
}
`;

const GL_ATTR: WebGLContextAttributes = {
  alpha: true,
  antialias: false,
  premultipliedAlpha: true,
  depth: false,
  stencil: false,
};

const targets: Target[] = [];
const byEl = new Map<HTMLElement, Target>();
const comets: Comet[] = [];
const blockers: Box[] = [];
const points = new Float32Array(MAX_POINTS * STRIDE);
const fallbacks: HTMLElement[] = [];

let canvasEl: HTMLCanvasElement | null = null;
let gl: WebGLRenderingContext | null = null;
let program: WebGLProgram | null = null;
let buffer: WebGLBuffer | null = null;
let uCss: WebGLUniformLocation | null = null;
let uDpr: WebGLUniformLocation | null = null;
let maxPoint = 64;
let cssW = 1;
let cssH = 1;
let ratioNow = 1;
let io: IntersectionObserver | null = null;
let ro: ResizeObserver | null = null;
let barObs: MutationObserver | null = null;
let hooked: { off?: (name: string, cb: (event: { scroll: number }) => void) => void } | null = null;
let onLenisScroll: ((event: { scroll: number }) => void) | null = null;
let listening = false;
let raf = 0;
let spawnTimer = 0;
let pass = 0;
let mode: 'webgl' | 'css' | 'off' = 'off';
let reduced = false;
let nextSpawn = 0;
let lastScroll = 0;
let boxesAt = 0;
let splashDocBottom = -1;
let lastTarget: Target | null = null;

function rand(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function ease(t: number) {
  const x = Math.min(1, Math.max(0, t));
  return x < 0.5 ? 4 * x * x * x : 1 - ((-2 * x + 2) ** 3) / 2;
}

function fade(elapsed: number, life: number) {
  const inn = Math.min(1, elapsed / FADE_MS);
  const out = Math.min(1, (life - elapsed) / FADE_MS);
  const edge = Math.max(0, Math.min(inn, out));
  return edge * edge * (3 - 2 * edge);
}

function phoneLike() {
  return window.matchMedia('(max-width: 759px), (pointer: coarse)').matches;
}

function cap() {
  return phoneLike() ? 2 : 4;
}

function pixelRatio() {
  const raw = window.devicePixelRatio || 1;
  return window.matchMedia('(max-width: 759px)').matches ? 1 : Math.min(raw, 1.5);
}

function scrollNow() {
  return window.__lenis?.scroll ?? window.scrollY;
}

function splashBlocks(scroll: number) {
  if (location.pathname !== '/') return false;
  if (splashDocBottom < 0) return false;
  return splashDocBottom - scroll > 16;
}

function readLight(el: HTMLElement) {
  if (el.closest('.enquire, .site-foot, .passage')) return false;
  let node: HTMLElement | null = el;
  for (let i = 0; i < 5 && node; i += 1) {
    const bg = getComputedStyle(node).backgroundColor;
    const match = bg.match(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+))?/);
    if (match) {
      const alpha = match[4] === undefined ? 1 : Number(match[4]);
      if (alpha > 0.35) {
        const lum = (0.2126 * Number(match[1]) + 0.7152 * Number(match[2]) + 0.0722 * Number(match[3])) / 255;
        return lum > 0.62;
      }
    }
    node = node.parentElement;
  }
  return true;
}

function inferSide(el: HTMLElement, kind: Kind): Side {
  if (kind === 'underline') return 'mid';
  if (kind === 'edge' || kind === 'outline') return 'box';
  const style = getComputedStyle(el);
  const top = parseFloat(style.borderTopWidth) || 0;
  const bottom = parseFloat(style.borderBottomWidth) || 0;
  if (top > 0 && bottom === 0) return 'top';
  if (bottom > 0 && top === 0) return 'bottom';
  if (top > 0 && bottom > 0) return 'top';
  return 'text';
}

function geom(target: Target) {
  if (target.side !== 'box') return { w: target.w, h: target.h, r: 0, inset: 0 };
  const inset = 0.6;
  const w = Math.max(1, target.w - inset * 2);
  const h = Math.max(1, target.h - inset * 2);
  const r = Math.max(0, Math.min(target.r - inset, w / 2, h / 2));
  return { w, h, r, inset };
}

function pathLength(target: Target) {
  const box = geom(target);
  if (target.side !== 'box') return Math.max(0, target.w);
  const top = Math.max(0, box.w - 2 * box.r);
  const side = Math.max(0, box.h - 2 * box.r);
  return 2 * (top + side) + 2 * Math.PI * box.r;
}

function place(target: Target, rect: DOMRect | DOMRectReadOnly) {
  const scroll = scrollNow();
  const style = getComputedStyle(target.el);
  target.fixed = style.position === 'fixed' || style.position === 'sticky' || !!target.el.closest('.site-nav, .topbar');
  target.font = parseFloat(style.fontSize) || 16;
  target.r = Math.max(0, Math.min(parseFloat(style.borderTopLeftRadius) || 0, rect.width / 2, rect.height / 2));
  target.docX = rect.left;
  target.docY = target.fixed ? rect.top : rect.top + scroll;
  target.w = rect.width;
  target.h = rect.height;
  if (target.side === 'text') {
    const range = document.createRange();
    range.selectNodeContents(target.el);
    const text = range.getBoundingClientRect();
    if (text.width > 8 && text.height > 2) {
      target.docX = text.left;
      target.docY = target.fixed ? text.bottom - 1 : text.bottom - 1 + scroll;
      target.w = text.width;
      target.h = 1;
    }
  }
  target.len = pathLength(target);
  target.light = readLight(target.el);
}

function origin(target: Target, scroll: number) {
  return {
    x: target.docX,
    y: target.fixed ? target.docY : target.docY - scroll,
  };
}

function roundRect(x: number, y: number, w: number, h: number, r: number, dist: number) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  const top = Math.max(0, w - 2 * radius);
  const side = Math.max(0, h - 2 * radius);
  const arc = (Math.PI / 2) * radius;
  const len = 2 * (top + side) + 4 * arc;
  let d = len > 0 ? ((dist % len) + len) % len : 0;
  const corner = (cx: number, cy: number, a0: number, travel: number) => {
    const a = a0 + (arc > 0 ? (travel / arc) * (Math.PI / 2) : 0);
    return { x: cx + Math.cos(a) * radius, y: cy + Math.sin(a) * radius };
  };
  if (d <= top) return { x: x + radius + d, y };
  d -= top;
  if (d <= arc) return corner(x + w - radius, y + radius, -Math.PI / 2, d);
  d -= arc;
  if (d <= side) return { x: x + w, y: y + radius + d };
  d -= side;
  if (d <= arc) return corner(x + w - radius, y + h - radius, 0, d);
  d -= arc;
  if (d <= top) return { x: x + w - radius - d, y: y + h };
  d -= top;
  if (d <= arc) return corner(x + radius, y + h - radius, Math.PI / 2, d);
  d -= arc;
  if (d <= side) return { x, y: y + h - radius - d };
  d -= side;
  return corner(x + radius, y + radius, Math.PI, d);
}

function pointAt(target: Target, dist: number, scroll: number) {
  const o = origin(target, scroll);
  const box = geom(target);
  if (target.side === 'box') return roundRect(o.x + box.inset, o.y + box.inset, box.w, box.h, box.r, dist);
  let y = o.y;
  if (target.side === 'top') y = o.y + 0.5;
  else if (target.side === 'bottom') y = o.y + target.h - 0.5;
  else if (target.side === 'text') y = o.y;
  else y = o.y + target.h * 0.5 + target.font * 0.62;
  const span = Math.max(target.len, 1);
  return { x: o.x + Math.min(Math.max(dist, 0), span), y };
}

function storeBox(el: HTMLElement): Box {
  const rect = el.getBoundingClientRect();
  const scroll = scrollNow();
  const fixed = getComputedStyle(el).position === 'fixed';
  return {
    el,
    docX: rect.left,
    docY: fixed ? rect.top : rect.top + scroll,
    w: rect.width,
    h: rect.height,
    fixed,
  };
}

function boxView(box: Box, scroll: number) {
  const top = box.fixed ? box.docY : box.docY - scroll;
  return { left: box.docX, top, right: box.docX + box.w, bottom: top + box.h };
}

function hitsBlocker(x: number, y: number, w: number, h: number, scroll: number) {
  for (const box of blockers) {
    const view = boxView(box, scroll);
    if (view.bottom < 0 || view.top > window.innerHeight) continue;
    if (x < view.right && x + w > view.left && y < view.bottom && y + h > view.top) return true;
  }
  return false;
}

function pointBlocked(x: number, y: number, scroll: number) {
  for (const box of blockers) {
    const view = boxView(box, scroll);
    if (x >= view.left && x <= view.right && y >= view.top && y <= view.bottom) return true;
  }
  return false;
}

function measureSplash() {
  if (location.pathname !== '/') {
    splashDocBottom = -1;
    return;
  }
  const spacer = document.querySelector<HTMLElement>('[data-splash-spacer]');
  if (!spacer) {
    splashDocBottom = -1;
    return;
  }
  const rect = spacer.getBoundingClientRect();
  splashDocBottom = rect.bottom + scrollNow();
}

function refreshBoxes() {
  boxesAt = performance.now();
  for (const target of targets) {
    if (target.fixed || target.visible) place(target, target.el.getBoundingClientRect());
  }
  for (let i = 0; i < blockers.length; i += 1) {
    const next = storeBox(blockers[i].el);
    blockers[i] = next;
  }
  measureSplash();
}

function compile(context: WebGLRenderingContext, type: number, source: string) {
  const shader = context.createShader(type);
  if (!shader) return null;
  context.shaderSource(shader, source);
  context.compileShader(shader);
  if (!context.getShaderParameter(shader, context.COMPILE_STATUS)) {
    context.deleteShader(shader);
    return null;
  }
  return shader;
}

function releaseGl() {
  if (gl && program) gl.deleteProgram(program);
  if (gl && buffer) gl.deleteBuffer(buffer);
  program = null;
  buffer = null;
  gl = null;
  uCss = null;
  uDpr = null;
}

function linkProgram(context: WebGLRenderingContext) {
  const vs = compile(context, context.VERTEX_SHADER, VERT);
  const fs = compile(context, context.FRAGMENT_SHADER, FRAG);
  const next = context.createProgram();
  if (!vs || !fs || !next) return false;
  context.attachShader(next, vs);
  context.attachShader(next, fs);
  context.linkProgram(next);
  context.deleteShader(vs);
  context.deleteShader(fs);
  if (!context.getProgramParameter(next, context.LINK_STATUS)) {
    context.deleteProgram(next);
    return false;
  }
  program = next;
  context.useProgram(program);
  buffer = context.createBuffer();
  context.bindBuffer(context.ARRAY_BUFFER, buffer);
  context.bufferData(context.ARRAY_BUFFER, points.byteLength, context.DYNAMIC_DRAW);
  const stride = STRIDE * 4;
  const aPos = context.getAttribLocation(program, 'aPos');
  const aSize = context.getAttribLocation(program, 'aSize');
  const aColor = context.getAttribLocation(program, 'aColor');
  context.enableVertexAttribArray(aPos);
  context.vertexAttribPointer(aPos, 2, context.FLOAT, false, stride, 0);
  context.enableVertexAttribArray(aSize);
  context.vertexAttribPointer(aSize, 1, context.FLOAT, false, stride, 8);
  context.enableVertexAttribArray(aColor);
  context.vertexAttribPointer(aColor, 4, context.FLOAT, false, stride, 12);
  uCss = context.getUniformLocation(program, 'uCss');
  uDpr = context.getUniformLocation(program, 'uDpr');
  context.enable(context.BLEND);
  context.blendFuncSeparate(context.ONE, context.ONE, context.ONE, context.ONE_MINUS_SRC_ALPHA);
  const range = context.getParameter(context.ALIASED_POINT_SIZE_RANGE) as number[];
  maxPoint = range?.[1] || 64;
  return true;
}

function resize() {
  if (!gl || !canvasEl) return;
  ratioNow = pixelRatio();
  cssW = Math.max(1, canvasEl.clientWidth || window.innerWidth);
  cssH = Math.max(1, canvasEl.clientHeight || window.innerHeight);
  const w = Math.max(1, Math.floor(cssW * ratioNow));
  const h = Math.max(1, Math.floor(cssH * ratioNow));
  if (canvasEl.width !== w || canvasEl.height !== h) {
    canvasEl.width = w;
    canvasEl.height = h;
  }
  gl.viewport(0, 0, canvasEl.width, canvasEl.height);
}

function clearCanvas() {
  if (!gl) return;
  resize();
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
}

function pushPoint(count: number, x: number, y: number, size: number, rgb: RGB, alpha: number) {
  if (count >= MAX_POINTS) return count;
  const sizePx = Math.min(size, maxPoint / Math.max(ratioNow, 0.5));
  const i = count * STRIDE;
  points[i] = x;
  points[i + 1] = y;
  points[i + 2] = sizePx;
  points[i + 3] = rgb[0];
  points[i + 4] = rgb[1];
  points[i + 5] = rgb[2];
  points[i + 6] = alpha;
  return count + 1;
}

function cometPoints(comet: Comet, now: number, scroll: number, count: number) {
  const elapsed = now - comet.born;
  const envelope = fade(elapsed, comet.life);
  if (envelope <= 0) return count;
  const along = comet.start + comet.dir * comet.travel * ease(elapsed / comet.life);
  const peak = (comet.target.light ? 0.5 : 0.56) * envelope;
  const gap = 3.6;
  let next = count;
  for (let dist = 0; dist <= comet.tail && next < MAX_POINTS; dist += gap) {
    const sample = along - comet.dir * dist;
    if (comet.target.side !== 'box' && (sample < -2 || sample > comet.target.len + 2)) continue;
    const p = pointAt(comet.target, sample, scroll);
    if (p.x < -30 || p.y < -30 || p.x > cssW + 30 || p.y > cssH + 30) continue;
    if (pointBlocked(p.x, p.y, scroll)) continue;
    const t = comet.tail > 0 ? dist / comet.tail : 1;
    const alpha = peak * (dist === 0 ? 1 : (1 - t) * (1 - t) * 0.72);
    const size = dist === 0 ? 18 : Math.max(4.5, 12.5 * (1 - t));
    next = pushPoint(next, p.x, p.y, size, mix(comet.head, BRONZE, dist === 0 ? 0.08 : t), alpha);
  }
  return next;
}

function flush(count: number) {
  if (!gl || !program) return;
  resize();
  gl.useProgram(program);
  gl.uniform2f(uCss, cssW, cssH);
  gl.uniform1f(uDpr, ratioNow);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  if (count <= 0) return;
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, points.subarray(0, count * STRIDE));
  gl.drawArrays(gl.POINTS, 0, count);
}

function drawMoving(now: number) {
  const scroll = scrollNow();
  let count = 0;
  for (const comet of comets) count = cometPoints(comet, now, scroll, count);
  flush(count);
}

function drawStatic() {
  if (mode !== 'webgl') return;
  const scroll = scrollNow();
  const rules = targets.filter((target) => target.visible && target.side !== 'box' && target.len > 24 && onScreen(target, scroll) && !hitsBlocker(origin(target, scroll).x, origin(target, scroll).y, target.w, Math.max(target.h, 2), scroll));
  let count = 0;
  for (const target of rules.slice(0, 2)) {
    const at = target.len * 0.34;
    const peak = target.light ? 0.4 : 0.46;
    for (let dist = 0; dist <= 22; dist += 3.6) {
      const p = pointAt(target, at - dist, scroll);
      if (pointBlocked(p.x, p.y, scroll)) continue;
      const t = dist / 22;
      count = pushPoint(count, p.x, p.y, dist === 0 ? 14 : 8 * (1 - t), mix(HALO, BRONZE, t), peak * (1 - t));
    }
  }
  flush(count);
}

function edgeY(target: Target, scroll: number) {
  const o = origin(target, scroll);
  if (target.side === 'top') return o.y + 0.5;
  if (target.side === 'bottom') return o.y + target.h - 0.5;
  if (target.side === 'mid') return o.y + target.h * 0.5 + target.font * 0.62;
  return o.y;
}

function onScreen(target: Target, scroll: number) {
  const o = origin(target, scroll);
  const viewH = window.innerHeight;
  const viewW = window.innerWidth;
  if (o.x + target.w < 8 || o.x > viewW - 8) return false;
  if (target.side === 'box') return o.y + target.h > 28 && o.y < viewH - 28;
  const y = edgeY(target, scroll);
  return y > 18 && y < viewH - 18;
}

function eligible(target: Target, now: number, scroll: number) {
  if (!target.visible || now < target.cool || target.len < 24 || target.w < 8) return false;
  if (!target.el.isConnected || target.el.closest('[hidden]')) return false;
  if (!onScreen(target, scroll)) return false;
  const o = origin(target, scroll);
  if (hitsBlocker(o.x, o.y, target.w, Math.max(target.h, 2), scroll)) return false;
  return true;
}

function spawn(now: number) {
  const scroll = scrollNow();
  if (splashBlocks(scroll) || document.hidden) return false;
  const pool = targets.filter((target) => target !== lastTarget && eligible(target, now, scroll));
  const source = pool.length > 0 ? pool : targets.filter((target) => eligible(target, now, scroll));
  if (source.length === 0) return false;
  const target = source[Math.floor(Math.random() * source.length)];
  const tail = Math.min(rand(40, 120), Math.max(28, target.len * 0.72));
  const travel = Math.min(target.len * (target.side === 'box' ? 0.5 : 0.92), Math.max(tail * 2.3, Math.min(target.len, 150)));
  let speed = rand(20, 60);
  let life = (travel / speed) * 1000;
  if (life < 3400) {
    life = 3400 + rand(0, 900);
    speed = travel / (life / 1000);
  }
  life += FADE_MS * 0.35;
  const dir: 1 | -1 = Math.random() < 0.5 ? 1 : -1;
  let start = 0;
  if (target.side === 'box') start = Math.random() * target.len;
  else if (dir > 0) start = Math.random() * Math.max(1, target.len - travel);
  else start = travel + Math.random() * Math.max(1, target.len - travel);
  comets.push({
    target,
    start,
    dir,
    travel,
    tail,
    born: now,
    life,
    head: target.light ? (Math.random() < 0.25 ? IVORY : HALO) : (Math.random() < 0.5 ? IVORY : HALO),
  });
  lastTarget = target;
  return true;
}

function stopRaf() {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
}

function clearTimer() {
  if (spawnTimer) window.clearTimeout(spawnTimer);
  spawnTimer = 0;
}

function arm(delay: number) {
  if (spawnTimer || reduced || document.hidden) return;
  spawnTimer = window.setTimeout(() => {
    spawnTimer = 0;
    wake();
  }, delay);
}

function frame(gen: number, now: number) {
  if (gen !== pass || document.hidden || reduced || mode !== 'webgl') {
    raf = 0;
    return;
  }
  const scroll = scrollNow();
  if (splashBlocks(scroll)) {
    comets.length = 0;
    clearCanvas();
    raf = 0;
    arm(1600);
    return;
  }
  for (let i = comets.length - 1; i >= 0; i -= 1) {
    const comet = comets[i];
    if (now >= comet.born + comet.life) {
      comet.target.cool = now + rand(9000, 19000);
      comets.splice(i, 1);
    }
  }
  if (comets.length < cap() && now >= nextSpawn) {
    if (spawn(now)) nextSpawn = now + rand(3200, 6800);
    else nextSpawn = now + 1400;
  }
  if (comets.length === 0) {
    clearCanvas();
    raf = 0;
    if (targets.some((target) => target.visible)) arm(Math.max(400, nextSpawn - now));
    return;
  }
  drawMoving(now);
  raf = requestAnimationFrame((time) => frame(gen, time));
}

function wake() {
  if (mode !== 'webgl' || reduced || document.hidden) return;
  if (splashBlocks(scrollNow())) {
    arm(1600);
    return;
  }
  if (comets.length === 0 && !targets.some((target) => target.visible)) return;
  if (raf) return;
  const gen = pass;
  raf = requestAnimationFrame((time) => frame(gen, time));
}

function onIo(entries: IntersectionObserverEntry[]) {
  let changed = false;
  for (const entry of entries) {
    const target = byEl.get(entry.target as HTMLElement);
    if (!target) continue;
    const next = entry.isIntersecting;
    if (next !== target.visible) changed = true;
    target.visible = next;
    if (next) place(target, entry.boundingClientRect);
  }
  if (!changed) return;
  if (reduced) drawStatic();
  else wake();
}

function onRo(entries: ResizeObserverEntry[]) {
  for (const entry of entries) {
    const target = byEl.get(entry.target as HTMLElement);
    if (!target) continue;
    place(target, target.el.getBoundingClientRect());
  }
  if (reduced) drawStatic();
}

function clearFallback() {
  for (const node of fallbacks) node.remove();
  fallbacks.length = 0;
  document.querySelectorAll('.tracer-host').forEach((el) => el.classList.remove('tracer-host'));
  if (document.documentElement.dataset.tracers === 'css') delete document.documentElement.dataset.tracers;
}

function mountFallback() {
  clearFallback();
  document.documentElement.dataset.tracers = 'css';
  const hosts = Array.from(document.querySelectorAll<HTMLElement>('[data-tracer]')).filter((el) => !el.closest(SKIP) && !el.closest('[hidden]')).slice(0, 3);
  for (const el of hosts) {
    const kind = el.getAttribute('data-tracer');
    const rect = el.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 2) continue;
    if (getComputedStyle(el).position === 'static') el.classList.add('tracer-host');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'tracer-fallback');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('viewBox', `0 0 ${rect.width} ${rect.height}`);
    const open = kind === 'rule' || kind === 'underline';
    const shape = document.createElementNS('http://www.w3.org/2000/svg', open ? 'line' : 'rect');
    shape.setAttribute('class', 'tracer-stroke');
    shape.setAttribute('pathLength', '100');
    if (open) {
      const y = kind === 'underline' ? String(rect.height * 0.72) : String(Math.max(0.75, rect.height - 0.75));
      shape.setAttribute('x1', '0');
      shape.setAttribute('x2', String(rect.width));
      shape.setAttribute('y1', y);
      shape.setAttribute('y2', y);
    } else {
      const radius = Math.min(parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0, rect.width / 2, rect.height / 2);
      shape.setAttribute('x', '0.75');
      shape.setAttribute('y', '0.75');
      shape.setAttribute('width', String(Math.max(1, rect.width - 1.5)));
      shape.setAttribute('height', String(Math.max(1, rect.height - 1.5)));
      shape.setAttribute('rx', String(Math.max(0, radius - 0.75)));
    }
    svg.appendChild(shape);
    el.appendChild(svg);
    fallbacks.push(svg);
  }
}

function collect() {
  io?.disconnect();
  ro?.disconnect();
  targets.length = 0;
  byEl.clear();
  comets.length = 0;
  blockers.length = 0;
  lastTarget = null;
  if (!io) io = new IntersectionObserver(onIo, { threshold: 0 });
  if (!ro) ro = new ResizeObserver(onRo);
  const seen = new Set<HTMLElement>();
  const take = (el: Element, kind: Kind, side?: Side) => {
    if (!(el instanceof HTMLElement) || seen.has(el)) return;
    if (el.closest(SKIP) || el.closest('[hidden]')) return;
    seen.add(el);
    const target: Target = {
      el,
      kind,
      side: side ?? inferSide(el, kind),
      visible: false,
      light: true,
      fixed: false,
      docX: 0,
      docY: 0,
      w: 0,
      h: 0,
      r: 0,
      len: 0,
      font: 16,
      cool: 0,
    };
    place(target, el.getBoundingClientRect());
    if (target.len < 20 || target.w < 8) return;
    targets.push(target);
    byEl.set(el, target);
    io?.observe(el);
    ro?.observe(el);
  };
  document.querySelectorAll('[data-tracer]').forEach((el) => {
    const kind = el.getAttribute('data-tracer');
    if (kind === 'edge' || kind === 'rule' || kind === 'outline' || kind === 'underline') take(el, kind);
  });
  for (const lock of LOCKED) document.querySelectorAll(lock.sel).forEach((el) => take(el, lock.kind, lock.side));
  document.querySelectorAll<HTMLElement>(BLOCKERS).forEach((el) => blockers.push(storeBox(el)));
  measureSplash();
  boxesAt = performance.now();
}

function hookLenis() {
  const lenis = window.__lenis;
  if (!lenis || lenis === hooked) return;
  if (hooked && onLenisScroll) {
    try {
      hooked.off?.('scroll', onLenisScroll);
    } catch {
      /* the previous smooth scroll was already destroyed */
    }
  }
  onLenisScroll = (event) => onScrollFrom(event.scroll);
  lenis.on('scroll', onLenisScroll);
  hooked = lenis;
}

function onScrollFrom(y: number) {
  if (Math.abs(y - lastScroll) < 0.4) return;
  lastScroll = y;
  const now = performance.now();
  if (now - boxesAt > 480) refreshBoxes();
  if (reduced) drawStatic();
  else if (!raf && !spawnTimer && !splashBlocks(y)) wake();
}

function onWindowScroll() {
  if (window.__lenis) return;
  onScrollFrom(window.scrollY);
}

function dropBar() {
  barObs?.disconnect();
  barObs = null;
}

function watchBar() {
  dropBar();
  const bar = document.querySelector('.topbar');
  if (!bar) return;
  barObs = new MutationObserver(() => {
    refreshBoxes();
    if (reduced) drawStatic();
  });
  barObs.observe(bar, { attributes: true, attributeFilter: ['class'] });
}

function applyMotion() {
  reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  comets.length = 0;
  stopRaf();
  clearTimer();
  if (mode !== 'webgl') return;
  if (reduced) drawStatic();
  else {
    clearCanvas();
    nextSpawn = performance.now() + rand(700, 1400);
    wake();
  }
}

function listen() {
  if (listening) return;
  listening = true;
  const reduceMq = window.matchMedia('(prefers-reduced-motion: reduce)');
  reduceMq.addEventListener('change', applyMotion);
  window.matchMedia('(max-width: 759px)').addEventListener('change', () => {
    resize();
    if (comets.length > cap()) comets.length = cap();
  });
  window.matchMedia('(pointer: coarse)').addEventListener('change', () => {
    if (comets.length > cap()) comets.length = cap();
  });
  window.addEventListener('resize', () => {
    resize();
    refreshBoxes();
    if (mode === 'css') mountFallback();
    else if (reduced) drawStatic();
  }, { passive: true });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopRaf();
      clearTimer();
      return;
    }
    if (reduced) drawStatic();
    else wake();
  });
  window.addEventListener('scroll', onWindowScroll, { passive: true });
  document.addEventListener('astro:before-swap', () => {
    disposeTracers();
  });
  document.addEventListener('astro:page-load', () => {
    const gen = pass;
    requestAnimationFrame(() => {
      if (gen !== pass) return;
      bindTracers();
    });
  });
}

function ensureGl(canvas: HTMLCanvasElement) {
  if (gl && canvasEl === canvas && program && !gl.isContextLost()) return true;
  releaseGl();
  canvasEl = canvas;
  const next = canvas.getContext('webgl', GL_ATTR);
  if (!next) return false;
  gl = next;
  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    releaseGl();
    mode = 'css';
    mountFallback();
  }, { once: true });
  return linkProgram(next);
}

/** Bind the persisted canvas to the edges on this page. Safe to call again. */
export function bindTracers() {
  listen();
  if (document.body.classList.contains('is-builder')) {
    quiet();
    return;
  }
  const canvas = document.getElementById('tracers-canvas');
  if (!(canvas instanceof HTMLCanvasElement)) return;
  clearFallback();
  canvasEl = canvas;
  const tier = qualityProfile().tier;
  if (tier === 'low' || tier === 'medium') {
    mode = 'css';
    collect();
    mountFallback();
    return;
  }
  if (!ensureGl(canvas)) {
    mode = 'css';
    collect();
    mountFallback();
    return;
  }
  mode = 'webgl';
  resize();
  collect();
  hookLenis();
  watchBar();
  applyMotion();
}

function quiet() {
  pass += 1;
  stopRaf();
  clearTimer();
  comets.length = 0;
  io?.disconnect();
  ro?.disconnect();
  dropBar();
  targets.length = 0;
  byEl.clear();
  blockers.length = 0;
  clearFallback();
  clearCanvas();
  mode = 'off';
}

/** Stop the loop and drop page targets. The canvas context stays for the next page. */
export function disposeTracers() {
  pass += 1;
  stopRaf();
  clearTimer();
  comets.length = 0;
  io?.disconnect();
  ro?.disconnect();
  dropBar();
  targets.length = 0;
  byEl.clear();
  blockers.length = 0;
  clearFallback();
  clearCanvas();
  mode = 'off';
}
