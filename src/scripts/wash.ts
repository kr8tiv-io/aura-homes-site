import * as THREE from 'three';
import { holdPageMotion } from './motion';
import { motionTime, onQuality, qualityProfile } from '../three/quality';
import { registerView, stagePageScroll } from '../three/stage';

/** Faint meadow for the cream sections. Drawn by the shared stage. */
function mountWashNow(canvas: HTMLCanvasElement) {
  const theme = canvas.dataset.wash || 'room';
  const look =
    theme === 'resort'
      ? { fog: 0xe6eef4, ground: '#d5e2ea', tree: '#5c7382', radius: 0.2 }
      : theme === 'glass'
        ? { fog: 0xe8eef0, ground: '#d4e0e2', tree: '#6e868c', radius: 0.22 }
        : { fog: 0xf4f3ef, ground: '#d5e0d2', tree: '#5d7a62', radius: 0.34 };

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(look.fog, 0.018);
  scene.add(new THREE.HemisphereLight(0xf7f4ee, 0xc5d0c2, 1.15));
  const sun = new THREE.DirectionalLight(0xf3ead8, 0.35);
  sun.position.set(-8, 10, 6);
  scene.add(sun);

  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 80);
  camera.position.set(0, 2.15, 11);

  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const textures: THREE.Texture[] = [];

  const groundMat = new THREE.MeshLambertMaterial({
    color: look.ground,
    transparent: true,
    opacity: 0.16,
  });
  materials.push(groundMat);
  const groundGeo = new THREE.PlaneGeometry(80, 28);
  geometries.push(groundGeo);
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, 0, -2);
  scene.add(ground);

  const card = document.createElement('canvas');
  card.width = 64;
  card.height = 128;
  const paint = card.getContext('2d');
  if (paint) {
    paint.clearRect(0, 0, 64, 128);
    paint.fillStyle = '#ffffff';
    paint.beginPath();
    paint.moveTo(32, 6);
    paint.quadraticCurveTo(60, 46, 48, 86);
    paint.quadraticCurveTo(32, 74, 16, 86);
    paint.quadraticCurveTo(4, 46, 32, 6);
    paint.fill();
    paint.fillRect(29, 82, 6, 40);
  }
  const cardTex = new THREE.CanvasTexture(card);
  cardTex.colorSpace = THREE.SRGBColorSpace;
  textures.push(cardTex);
  const treeMat = new THREE.MeshBasicMaterial({
    map: cardTex,
    color: look.tree,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  materials.push(treeMat);
  const treeGeo = new THREE.PlaneGeometry(1, 1);
  geometries.push(treeGeo);
  const trees: THREE.Mesh[] = [];
  const spots: Array<[number, number, number, number]> = [
    [-7.4, -6.2, 2.3, 0.2],
    [-5.2, -8.4, 1.7, 1.1],
    [-8.8, -9.6, 2.8, 2.2],
    [6.8, -6.4, 2.1, 1.6],
    [4.6, -8.8, 1.6, 2.8],
    [8.6, -10, 2.7, 0.7],
    [-1.6, -11.5, 1.5, 0.4],
    [1.4, -12.2, 1.8, 1.9],
  ];
  for (const [x, z, h, phase] of spots) {
    const tree = new THREE.Mesh(treeGeo, treeMat);
    tree.scale.set(h * look.radius * 2.2, h, 1);
    tree.position.set(x, h / 2, z);
    tree.userData.phase = phase;
    tree.userData.baseX = x;
    scene.add(tree);
    trees.push(tree);
  }

  let dead = false;
  const view = registerView({
    element: canvas,
    scene,
    camera,
    layer: 'wash',
    draw: () => stagePageScroll() >= window.innerHeight * 0.82,
    update(progress) {
      const t = motionTime(performance.now());
      const drift = progress * 1.6;
      camera.position.set(-0.2 + drift + Math.sin(t * 0.22) * 0.22, 1.45, 8);
      camera.lookAt(drift * 0.2, 3.15, -4);
      for (const tree of trees) {
        const phase = tree.userData.phase as number;
        tree.rotation.z = Math.sin(t * 0.45 + phase) * 0.03;
        tree.position.x = (tree.userData.baseX as number) + Math.sin(t * 0.3 + phase) * 0.08;
      }
    },
  });

  const api = {
    setProgress(t: number) {
      view.setProgress(t);
    },
    destroy() {
      if (dead) return;
      dead = true;
      view.destroy();
      geometries.forEach((geo) => geo.dispose());
      materials.forEach((mat) => mat.dispose());
      textures.forEach((tex) => tex.dispose());
    },
  };
  return api;
}

export function mountWash(canvas: HTMLCanvasElement) {
  let dead = false;
  let inner: ReturnType<typeof mountWashNow> | null = null;
  let progress = 0;

  const boot = () => {
    if (dead || inner || qualityProfile().tier === 'off') return;
    inner = mountWashNow(canvas);
    inner.setProgress(progress);
  };

  const stop = onQuality((next) => {
    if (dead) return;
    if (next.tier === 'off') {
      inner?.destroy();
      inner = null;
      return;
    }
    if (!inner) boot();
  });

  boot();

  const api = {
    setProgress(t: number) {
      progress = t;
      inner?.setProgress(t);
    },
    destroy() {
      if (dead) return;
      dead = true;
      stop();
      inner?.destroy();
      inner = null;
    },
  };
  holdPageMotion(api.destroy);
  return api;
}
