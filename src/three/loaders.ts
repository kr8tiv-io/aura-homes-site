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

let ktxReady = false;

/** Tell the KTX2 transcoder which GPU formats this renderer can use. */
export function configureRenderer(renderer: THREE.WebGLRenderer): void {
  if (ktxReady) return;
  ktx2Loader.detectSupport(renderer);
  ktxReady = true;
}

export function loadModel(url: string): Promise<GLTF> {
  const cached = modelCache.get(url);
  if (cached) return cached;
  const pending = gltfLoader.loadAsync(url);
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
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = pmrem.fromEquirectangular(hdr).texture;
    hdr.dispose();
    pmrem.dispose();
    return env;
  });
  envCache.set(url, pending);
  pending.catch(() => {
    if (envCache.get(url) === pending) envCache.delete(url);
  });
  return pending;
}

export { dracoLoader, gltfLoader, hdrLoader, ktx2Loader, loadingManager };
