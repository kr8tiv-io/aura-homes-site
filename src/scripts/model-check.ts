/*
  Studio turntable for a GLB dropped in public/models/custom.
  The page is not linked from the nav. A missing file leaves the stand empty.
*/
import * as THREE from 'three';
import { configureRenderer, hdrLoader, loadEnvironment } from '../three/loaders';
import {
  CUSTOM_BUDGET_BYTES,
  CUSTOM_NAMES,
  CUSTOM_TEXTURE_EDGE,
  isCustomName,
  loadCustomModel,
  placeCustomModel,
  resolveCustom,
  type CustomName,
} from '../three/custom-models';
import { createPolycarbonateMaterial } from '../three/aura-unit';
import { createTubWaterMaterial } from '../three/hot-tub';

const TURN = Math.PI * 2 / 48;

function asset(file: string) {
  const base = import.meta.env.BASE_URL || '/';
  const prefix = base.endsWith('/') ? base : `${base}/`;
  return prefix + file.replace(/^\//, '');
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatCount(value: number) {
  return Math.round(value).toLocaleString('en-CA');
}

function edgesOf(root: THREE.Object3D) {
  const seen = new Set<string>();
  const edges: number[] = [];
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of list) {
      if (!mat) continue;
      for (const key of Object.keys(mat) as (keyof THREE.Material)[]) {
        const value = mat[key];
        if (!(value instanceof THREE.Texture) || seen.has(value.uuid)) continue;
        seen.add(value.uuid);
        const image = value.image as { width?: number; height?: number } | undefined;
        const edge = Math.max(image?.width ?? 0, image?.height ?? 0);
        if (edge > 0) edges.push(edge);
      }
    }
  });
  return edges;
}

function trianglesOf(root: THREE.Object3D) {
  let count = 0;
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const position = mesh.geometry.getAttribute('position');
    if (!position) return;
    count += mesh.geometry.index ? mesh.geometry.index.count / 3 : position.count / 3;
  });
  return count;
}

type Readout = {
  empty: HTMLElement;
  stats: HTMLElement;
  warn: HTMLElement;
};

function writeReadout(readout: Readout, lines: { stats: string[]; warnings: string[] }) {
  const hasModel = lines.stats.length > 0;
  readout.empty.hidden = hasModel;
  readout.stats.hidden = !hasModel;
  readout.stats.replaceChildren();
  for (const line of lines.stats) {
    const [term, detail] = line.split('|');
    const row = document.createElement('div');
    const dt = document.createElement('dt');
    dt.textContent = term;
    const dd = document.createElement('dd');
    dd.textContent = detail;
    row.append(dt, dd);
    readout.stats.append(row);
  }
  readout.warn.replaceChildren();
  for (const warning of lines.warnings) {
    const item = document.createElement('li');
    item.textContent = warning;
    readout.warn.append(item);
  }
}

function start(host: HTMLElement) {
  const canvas = host.querySelector<HTMLCanvasElement>('[data-model-canvas]');
  const pick = host.querySelector<HTMLElement>('[data-model-pick]');
  const empty = host.querySelector<HTMLElement>('[data-model-empty]');
  const stats = host.querySelector<HTMLElement>('[data-model-stats]');
  const warn = host.querySelector<HTMLElement>('[data-model-warn]');
  if (!canvas || !pick || !empty || !stats || !warn) return () => {};
  const readout = { empty, stats, warn };

  const reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  let reduced = reducedQuery.matches;
  let disposed = false;
  let frame = 0;
  let last = performance.now();
  let shown: CustomName = 'aura-unit';
  let release = () => {};
  let waterTime: { value: number } | null = null;
  const owned: THREE.Material[] = [];
  const textures: THREE.Texture[] = [];
  const params = new URLSearchParams(window.location.search);
  const requested = params.get('model');
  if (requested && isCustomName(requested)) shown = requested;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setClearColor('#0c0d0e');
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 1.06;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  configureRenderer(renderer);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#0c0d0e');
  const camera = new THREE.PerspectiveCamera(32, 1, 0.08, 80);
  camera.position.set(3.2, 1.8, 6.4);

  const pivot = new THREE.Group();
  pivot.name = 'Turntable';
  scene.add(pivot);

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(1, 64),
    new THREE.MeshStandardMaterial({ color: '#141311', roughness: 0.92, metalness: 0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.004;
  ground.receiveShadow = true;
  ground.scale.setScalar(4);
  scene.add(ground);

  const sun = new THREE.DirectionalLight('#fff2df', 1.35);
  sun.position.set(7.2, 9.4, 5.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 40;
  sun.shadow.camera.left = -8;
  sun.shadow.camera.right = 8;
  sun.shadow.camera.top = 8;
  sun.shadow.camera.bottom = -8;
  scene.add(sun);
  scene.add(new THREE.HemisphereLight('#f4f3ef', '#2a241c', 0.18));

  const hdriUrl = asset('hdri/evening_meadow_1k.hdr');
  let backdrop: THREE.Texture | null = null;
  void loadEnvironment(renderer, hdriUrl).then((env) => {
    if (disposed) return;
    scene.environment = env;
    scene.environmentIntensity = 1;
  }).catch(() => undefined);
  void hdrLoader.loadAsync(hdriUrl).then((hdr) => {
    if (disposed) {
      hdr.dispose();
      return;
    }
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    backdrop = hdr;
    scene.background = hdr;
  }).catch(() => undefined);

  const resize = () => {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width < 2 || height < 2) return;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();

  const frameObject = (object: THREE.Object3D) => {
    object.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z, 0.8);
    camera.position.set(center.x + radius * 0.9, center.y + radius * 0.38, center.z + radius * 1.75);
    camera.near = Math.max(0.02, radius / 80);
    camera.far = radius * 24;
    camera.lookAt(center);
    camera.updateProjectionMatrix();
    ground.scale.setScalar(Math.max(radius * 1.6, 2.4));
    sun.target.position.copy(center);
    sun.target.updateMatrixWorld();
  };

  const clearModel = () => {
    release();
    release = () => {};
    waterTime = null;
    for (const mat of owned) mat.dispose();
    for (const tex of textures) tex.dispose();
    owned.length = 0;
    textures.length = 0;
    for (const child of [...pivot.children]) child.removeFromParent();
    pivot.rotation.y = 0;
  };

  const show = async (name: CustomName) => {
    shown = name;
    for (const button of pick.querySelectorAll<HTMLButtonElement>('[data-slot]')) {
      button.setAttribute('aria-pressed', button.dataset.slot === name ? 'true' : 'false');
    }
    const url = new URL(window.location.href);
    url.searchParams.set('model', name);
    window.history.replaceState(null, '', url);
    clearModel();
    empty.textContent = 'Looking for the file.';
    writeReadout(readout, { stats: [], warnings: [] });
    const chosen = await resolveCustom(name, 'full');
    if (disposed || shown !== name) return;
    if (!chosen) {
      empty.textContent = 'Nothing is in this slot. The site keeps the procedural model.';
      writeReadout(readout, {
        stats: [],
        warnings: [`Drop ${name}.glb into public/models/custom, then run npm run assets.`],
      });
      return;
    }
    const sceneRoot = await loadCustomModel(name, 'full');
    if (disposed || shown !== name) return;
    if (!sceneRoot) {
      empty.textContent = 'The file was found, and then it could not be read.';
      return;
    }
    let water: ReturnType<typeof createTubWaterMaterial> | null = null;
    const localOwned: THREE.Material[] = [];
    const localTextures: THREE.Texture[] = [];
    const placed = placeCustomModel(sceneRoot, name, {
      polycarbonate: () => {
        const mat = createPolycarbonateMaterial();
        localOwned.push(mat);
        return mat;
      },
      water: () => {
        if (!water) {
          water = createTubWaterMaterial();
          localOwned.push(water.material);
          localTextures.push(...water.textures);
          if (!reduced) waterTime = water.uniforms.uWaterTime;
        }
        return water.material;
      },
    });
    if (disposed || shown !== name) {
      placed.release();
      for (const mat of localOwned) mat.dispose();
      for (const tex of localTextures) tex.dispose();
      waterTime = null;
      return;
    }
    release = placed.release;
    owned.push(...localOwned);
    textures.push(...localTextures);
    pivot.add(placed.object);
    frameObject(placed.object);

    const sidecar = await fetch(asset(`models/custom/${name}.json`), { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null);
    if (disposed || shown !== name) return;

    const publish = () => {
      if (disposed || shown !== name) return;
      const spin = pivot.rotation.y;
      pivot.rotation.y = 0;
      pivot.updateMatrixWorld(true);
      const tris = trianglesOf(placed.object);
      const edges = edgesOf(placed.object);
      const fitted = new THREE.Box3().setFromObject(placed.object);
      pivot.rotation.y = spin;
      pivot.updateMatrixWorld(true);
      const fittedSize = fitted.getSize(new THREE.Vector3());
      const fittedCenter = fitted.getCenter(new THREE.Vector3());
      const warnings: string[] = [];
      if (chosen.bytes != null && chosen.bytes > CUSTOM_BUDGET_BYTES) {
        warnings.push(`This file is ${formatBytes(chosen.bytes)}. Keep it under about 8 MB after npm run assets.`);
      }
      const widest = edges.reduce((max, edge) => Math.max(max, edge), 0);
      if (widest > CUSTOM_TEXTURE_EDGE) {
        warnings.push(`A texture is ${formatCount(widest)} px on its long side. The pipeline keeps maps to ${CUSTOM_TEXTURE_EDGE} px.`);
      }
      if (Math.abs(fitted.min.y) > 0.02 || Math.abs(fittedCenter.x) > 0.02 || Math.abs(fittedCenter.z) > 0.02) {
        warnings.push('The model did not settle on the ground centre.');
      }
      if (!sidecar) warnings.push(`Add ${name}.json beside the model so the credits page can list it.`);
      const textureLine = edges.length
        ? edges.map((edge) => `${formatCount(edge)} px`).join(', ')
        : 'None yet';
      const credit = sidecar && typeof sidecar.name === 'string' && typeof sidecar.author === 'string'
        ? `${sidecar.name}, by ${sidecar.author}`
        : 'No sidecar yet';
      writeReadout(readout, {
        stats: [
          `Triangles|${formatCount(tris)}`,
          `Footprint|${fittedSize.x.toFixed(2)} m wide, ${fittedSize.z.toFixed(2)} m long`,
          `File|${chosen.bytes == null ? 'Size unavailable' : formatBytes(chosen.bytes)}`,
          `Variant|${chosen.level}`,
          `Textures|${textureLine}`,
          `Credits|${credit}`,
        ],
        warnings,
      });
    };
    publish();
    window.setTimeout(publish, 400);
  };

  const onPick = (event: Event) => {
    const button = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>('[data-slot]');
    if (!button?.dataset.slot || !isCustomName(button.dataset.slot)) return;
    void show(button.dataset.slot);
  };
  pick.addEventListener('click', onPick);

  const onMotion = () => {
    reduced = reducedQuery.matches;
    if (reduced) waterTime = null;
  };
  reducedQuery.addEventListener('change', onMotion);

  const tick = (now: number) => {
    if (disposed) return;
    frame = requestAnimationFrame(tick);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!reduced && pivot.children.length) pivot.rotation.y += dt * TURN;
    if (waterTime) waterTime.value += dt;
    renderer.render(scene, camera);
  };
  frame = requestAnimationFrame(tick);
  void show(shown);

  return () => {
    disposed = true;
    cancelAnimationFrame(frame);
    pick.removeEventListener('click', onPick);
    reducedQuery.removeEventListener('change', onMotion);
    observer.disconnect();
    clearModel();
    ground.geometry.dispose();
    (ground.material as THREE.Material).dispose();
    backdrop?.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  };
}

let stop = () => {};
let current: HTMLElement | null = null;

function boot() {
  const host = document.querySelector<HTMLElement>('[data-model-check]');
  if (!host || host === current) return;
  stop();
  current = host;
  stop = start(host);
}

document.addEventListener('astro:page-load', boot);
document.addEventListener('astro:before-swap', () => {
  stop();
  stop = () => {};
  current = null;
});
boot();
