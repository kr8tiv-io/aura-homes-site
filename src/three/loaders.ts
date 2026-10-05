/*
  One loader for the whole site. Draco, KTX2, and Meshopt share a
  LoadingManager, and a URL is fetched only once.
  Call configureRenderer(renderer) before the first KTX2 model.
*/
import * as THREE from 'three';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

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
