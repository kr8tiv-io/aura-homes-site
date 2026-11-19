/*
  One loader for the whole site. Draco, KTX2, and Meshopt share a
  LoadingManager. File bytes are fetched once per page view.

  THREE.Cache stays off. KTX2 and Draco transfer the ArrayBuffer to a
  worker, which detaches it. A cache of that same buffer would hand the
  next caller an empty file. Callers receive a copy instead.

  The glass sky starts its HDR while the passage is still below the fold.
  The PMREM environment for the same file starts only once the canvas is
  on screen. On a phone those two requests do not overlap, and FileLoader
  only collapses in-flight duplicates, so kloofendal was downloaded twice.
  Forrest ground is the same story across passages: each world called
  ktx2Loader.loadAsync after the previous download had already finished.
*/
import * as THREE from 'three';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { ImageLoader } from 'three';
import { isPhoneClass } from './quality';

const loadingManager = new THREE.LoadingManager();

const dracoLoader = new DRACOLoader(loadingManager);
dracoLoader.setDecoderPath('/decoders/draco/');

const ktx2Loader = new KTX2Loader(loadingManager);
ktx2Loader.setTranscoderPath('/decoders/basis/');

const gltfLoader = new GLTFLoader(loadingManager);
gltfLoader.setDRACOLoader(dracoLoader);
gltfLoader.setKTX2Loader(ktx2Loader);
gltfLoader.setMeshoptDecoder(MeshoptDecoder);

/** RGBELoader is the old name. three now reads .hdr files with HDRLoader. */
const hdrLoader = new HDRLoader(loadingManager);

const modelCache = new Map<string, Promise<GLTF>>();
const envCache = new Map<string, Promise<THREE.Texture>>();

let pmrem: THREE.PMREMGenerator | null = null;
let pmremRenderer: THREE.WebGLRenderer | null = null;

function environmentGenerator(renderer: THREE.WebGLRenderer): THREE.PMREMGenerator {
  if (pmrem && pmremRenderer === renderer) return pmrem;
  pmrem?.dispose();
  pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  pmremRenderer = renderer;
  return pmrem;
}

let boundRenderer: THREE.WebGLRenderer | null = null;
let markKtx2Ready: () => void = () => {};
const ktx2Ready = new Promise<void>((resolve) => {
  markKtx2Ready = resolve;
});

/** Resolves once the live renderer has told KTX2 which formats it can use. */
export function whenKtx2(): Promise<void> {
  return ktx2Ready;
}

/** Tell the KTX2 transcoder which GPU formats this renderer can use. */
export function configureRenderer(renderer: THREE.WebGLRenderer): void {
  if (boundRenderer !== renderer) {
    ktx2Loader.detectSupport(renderer);
    boundRenderer = renderer;
  }
  markKtx2Ready();
}

export function loadModel(url: string): Promise<GLTF> {
  const cached = modelCache.get(url);
  if (cached) return cached;
  const pending = ktx2Ready.then(() => gltfLoader.loadAsync(url));
  modelCache.set(url, pending);
  pending.catch(() => {
    if (modelCache.get(url) === pending) modelCache.delete(url);
  });
  return pending;
}

/**
 * Load an equirectangular HDR once and return a PMREM environment map.
 * The same URL always resolves to the same texture.
 */
export function loadEnvironment(renderer: THREE.WebGLRenderer, url: string): Promise<THREE.Texture> {
  const cached = envCache.get(url);
  if (cached) return cached;
  const pending = hdrLoader.loadAsync(url).then((hdr) => {
    const env = environmentGenerator(renderer).fromEquirectangular(hdr).texture;
    hdr.dispose();
    return env;
  });
  envCache.set(url, pending);
  pending.catch(() => {
    if (envCache.get(url) === pending) envCache.delete(url);
  });
  return pending;
}

/** Drop cached environment maps when the shared renderer goes away. */
export function releaseEnvironment(): void {
  for (const pending of envCache.values()) {
    pending.then((texture) => texture.dispose()).catch(() => {});
  }
  envCache.clear();
  pmrem?.dispose();
  pmrem = null;
  pmremRenderer = null;
}

export { dracoLoader, gltfLoader, hdrLoader, ktx2Loader, loadingManager };

const ASSET_URL = /\/(?:hdri|textures|models|decoders)\/[^?#]+\.(?:hdr|ktx2|glb|gltf|bin|jpg|jpeg|png|webp|wasm|js|json)(?:[?#]|$)/i;

const byteCache = new Map<string, Promise<ArrayBuffer>>();
const imageCache = new Map<string, Promise<HTMLImageElement>>();
const keptBlobUrls = new Set<string>();

let originalFetch: typeof fetch | null = null;

function absoluteUrl(url: string): string {
  try {
    return new URL(url, document.baseURI).href;
  } catch {
    return url;
  }
}

function isAssetUrl(url: string): boolean {
  return ASSET_URL.test(url) || ASSET_URL.test(absoluteUrl(url));
}

function resourceSettled(url: string): boolean {
  if (url.startsWith('blob:') || url.startsWith('data:')) return true;
  let abs = url;
  try {
    abs = new URL(url, document.baseURI).href;
  } catch {
    return false;
  }
  const listed = performance.getEntriesByName(abs);
  for (const entry of listed) {
    if ((entry as PerformanceResourceTiming).responseEnd > 0) return true;
  }
  return false;
}

/**
 * On a phone, 3D bytes wait until on-screen and next-up photos and posters
 * have finished. Desktop does not wait. A stuck image cannot hold the scenes
 * forever, and it cannot restart that wait for every file.
 */
export function visualsPending(): boolean {
  if (typeof window === 'undefined' || !isPhoneClass()) return false;
  const vh = window.innerHeight || 1;
  const lead = vh * 2.2;
  const nodes = document.querySelectorAll('img, video, .passage.is-still');
  for (const node of nodes) {
    if (!(node instanceof HTMLElement)) continue;
    const box = node.getBoundingClientRect();
    if (box.bottom < -24 || box.top > vh + lead) continue;
    const style = getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden') continue;
    if (node instanceof HTMLImageElement) {
      if (box.width < 48 || box.height < 48) continue;
      if (node.loading === 'lazy' && !node.complete) node.loading = 'eager';
      if (node.complete && node.naturalWidth > 0) continue;
      const src = node.currentSrc || node.getAttribute('src') || '';
      if (!src) continue;
      if (node.complete && node.loading === 'lazy') node.loading = 'eager';
      return true;
    }
    if (node instanceof HTMLVideoElement) {
      if (box.width < 48 || box.height < 48) continue;
      const poster = node.getAttribute('poster') || '';
      if (poster.startsWith('blob:') || node.dataset.posterReady === 'yes') continue;
      if (poster && !resourceSettled(poster)) return true;
      if (!poster && node.dataset.poster) return true;
      continue;
    }
    if (!node.classList.contains('is-still')) continue;
    const background = style.backgroundImage;
    const matched = /url\((['"]?)(.*?)\1\)/.exec(background);
    if (matched && matched[2] && matched[2] !== 'none') {
      if (matched[2].startsWith('blob:') || matched[2].startsWith('data:')) continue;
      if (!resourceSettled(matched[2])) return true;
      continue;
    }
    // The still is assigned, and the blob has not been painted yet.
    if (node.dataset.stillPoster) return true;
  }
  return false;
}

let quietWait: Promise<void> | null = null;
let quietArmed = true;

function whenVisualsQuiet(): Promise<void> {
  if (typeof window === 'undefined' || !isPhoneClass()) return Promise.resolve();
  if (!visualsPending()) {
    quietArmed = true;
    return Promise.resolve();
  }
  // The clock already ran out on this busy stretch. Wait again only after
  // a quiet gap, so the next file does not pay another 12 seconds.
  if (!quietArmed) return Promise.resolve();
  if (quietWait) return quietWait;
  quietWait = new Promise((resolve) => {
    const started = performance.now();
    const tick = () => {
      if (!visualsPending()) {
        quietWait = null;
        quietArmed = true;
        resolve();
        return;
      }
      if (performance.now() - started > 12000) {
        quietWait = null;
        quietArmed = false;
        resolve();
        return;
      }
      window.setTimeout(tick, 120);
    };
    tick();
  });
  return quietWait;
}

function loadMaster(url: string): Promise<ArrayBuffer> {
  const key = absoluteUrl(url);
  const cached = byteCache.get(key);
  if (cached) return cached;
  const pending = (async () => {
    await whenVisualsQuiet();
    const fetchImpl = originalFetch ?? window.fetch.bind(window);
    const init: RequestInit = { credentials: 'same-origin' };
    if (isPhoneClass()) (init as RequestInit & { priority?: string }).priority = 'low';
    const response = await fetchImpl(key, init);
    if (!response.ok && response.status !== 0) throw new Error(`asset ${response.status} ${key}`);
    return response.arrayBuffer();
  })();
  byteCache.set(key, pending);
  pending.catch(() => {
    if (byteCache.get(key) === pending) byteCache.delete(key);
  });
  return pending;
}

/** A fresh copy, so a worker transfer cannot empty the cached file. */
export function loadBytes(url: string): Promise<ArrayBuffer> {
  return loadMaster(url).then((buffer) => buffer.slice(0));
}

function loadImageOnce(url: string): Promise<HTMLImageElement> {
  const key = absoluteUrl(url);
  const cached = imageCache.get(key);
  if (cached) return cached;
  const pending = loadMaster(key).then(
    (buffer) =>
      new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        const blobUrl = URL.createObjectURL(new Blob([buffer]));
        keptBlobUrls.add(blobUrl);
        image.onload = () => resolve(image);
        image.onerror = () => {
          URL.revokeObjectURL(blobUrl);
          keptBlobUrls.delete(blobUrl);
          reject(new Error(`image ${key}`));
        };
        image.src = blobUrl;
      }),
  );
  imageCache.set(key, pending);
  pending.catch(() => {
    if (imageCache.get(key) === pending) imageCache.delete(key);
  });
  return pending;
}

function installAssetFetch() {
  if (typeof window === 'undefined') return;
  const host = window as Window & { __auraAssetFetch?: boolean };
  if (host.__auraAssetFetch) return;
  host.__auraAssetFetch = true;
  originalFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const method = (
      init?.method ||
      (typeof Request !== 'undefined' && input instanceof Request ? input.method : 'GET')
    ).toUpperCase();
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (method === 'HEAD' || !isAssetUrl(raw)) return originalFetch!(input, init);
    return loadBytes(raw).then((copy) => {
      // Content-Length is a forbidden header on a bare Headers object.
      // The Response constructor accepts it, and FileLoader reads it for progress.
      try {
        return new Response(copy, {
          status: 200,
          statusText: 'OK',
          headers: { 'Content-Length': String(copy.byteLength) },
        });
      } catch {
        return new Response(copy, { status: 200, statusText: 'OK' });
      }
    });
  };
}

installAssetFetch();

const originalImageLoad = ImageLoader.prototype.load;
ImageLoader.prototype.load = function loadImage(
  this: ImageLoader,
  url: string,
  onLoad?: (image: HTMLImageElement) => void,
  onProgress?: (event: ProgressEvent) => void,
  onError?: (error: unknown) => void,
) {
  let resolved = url || '';
  if (this.path) resolved = this.path + resolved;
  resolved = this.manager.resolveURL(resolved);
  if (!isAssetUrl(resolved) || resolved.startsWith('data:') || resolved.startsWith('blob:')) {
    return originalImageLoad.call(this, url, onLoad, onProgress, onError);
  }
  this.manager.itemStart(resolved);
  loadImageOnce(resolved)
    .then((image) => {
      onLoad?.(image);
      this.manager.itemEnd(resolved);
    })
    .catch((error: unknown) => {
      onError?.(error);
      this.manager.itemError(resolved);
      this.manager.itemEnd(resolved);
    });
  return new Image();
};
