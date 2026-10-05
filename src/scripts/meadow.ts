import * as THREE from 'three';
import { holdPageMotion } from './motion';
import { hideStill, motionTime, onQuality, qualityProfile, showStill, type QualityProfile } from '../three/quality';
import { registerView, type StageTone } from '../three/stage';
import { FAR_SPLINE, GRASS_SPLINE, mountMeadowWorld } from '../three/meadow-v1/world';

let activeProfile: QualityProfile | null = null;
let treeAnchorZ = 0;

function profile(): QualityProfile {
  return activeProfile ?? qualityProfile();
}

/** Scroll-driven passage worlds. Atmosphere only: no cabin mesh. The stage draws them. */

type SceneKey = 'grass' | 'glass' | 'steam' | 'far' | 'snow' | 'slope';

type BuiltScene = {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  geometries: THREE.BufferGeometry[];
  materials: THREE.Material[];
  textures: THREE.Texture[];
  render: (time: number, progress: number) => void;
};

const KEYS: SceneKey[] = ['grass', 'glass', 'steam', 'far', 'snow', 'slope'];

function sceneKey(canvas: HTMLCanvasElement): SceneKey {
  const key = canvas.dataset.scene as SceneKey;
  return KEYS.includes(key) ? key : 'grass';
}

function addRidge(
  scene: THREE.Scene,
  geometries: THREE.BufferGeometry[],
  mat: THREE.Material,
  w: number,
  h: number,
  x: number,
  z: number,
) {
  const shape = new THREE.Shape();
  shape.moveTo(-1, 0);
  shape.lineTo(-0.74, 0.2);
  shape.lineTo(-0.42, 0.58);
  shape.lineTo(-0.08, 0.24);
  shape.lineTo(0.26, 0.74);
  shape.lineTo(0.58, 0.3);
  shape.lineTo(1, 0.06);
  shape.lineTo(1, 0);
  shape.lineTo(-1, 0);
  const geo = new THREE.ShapeGeometry(shape);
  geometries.push(geo);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.scale.set(w, h, 1);
  mesh.position.set(x, 0, z);
  scene.add(mesh);
}

function addTree(
  scene: THREE.Scene,
  geometries: THREE.BufferGeometry[],
  mat: THREE.Material,
  trees: THREE.Object3D[],
  x: number,
  z: number,
  h: number,
) {
  const dist = Math.hypot(x, z - treeAnchorZ);
  if (dist > profile().impostorDistance) {
    const geo = new THREE.ConeGeometry(h * 0.28, h, 5);
    geometries.push(geo);
    const stand = new THREE.Mesh(geo, mat);
    stand.position.set(x, h / 2, z);
    stand.userData.phase = x * 0.2 + z;
    stand.userData.baseX = x;
    scene.add(stand);
    trees.push(stand);
    return;
  }
  const group = new THREE.Group();
  const trunkGeo = new THREE.CylinderGeometry(h * 0.035, h * 0.055, h * 0.5, 6);
  const leafGeo = new THREE.IcosahedronGeometry(1, 0);
  geometries.push(trunkGeo, leafGeo);
  const trunk = new THREE.Mesh(trunkGeo, mat);
  trunk.position.y = h * 0.24;
  trunk.castShadow = true;
  group.add(trunk);
  const blobs: Array<[number, number, number, number]> = [
    [0.22, 0.4, 0.07, 0.02],
    [0.2, 0.5, -0.08, 0.05],
    [0.18, 0.58, 0.03, -0.07],
    [0.15, 0.7, -0.04, 0.03],
    [0.12, 0.82, 0.05, -0.02],
    [0.08, 0.93, 0, 0.02],
  ];
  for (const [scale, y, ox, oz] of blobs) {
    const leaf = new THREE.Mesh(leafGeo, mat);
    leaf.scale.setScalar(h * scale);
    leaf.position.set(ox * h, y * h, oz * h);
    leaf.castShadow = true;
    group.add(leaf);
  }
  group.position.set(x, 0, z);
  group.userData.phase = x * 0.2 + z;
  group.userData.baseX = x;
  scene.add(group);
  trees.push(group);
}

function sway(trees: THREE.Object3D[], t: number, amount = 0.025) {
  for (const tree of trees) {
    const phase = tree.userData.phase as number;
    tree.rotation.z = Math.sin(t * 0.4 + phase) * amount;
    tree.position.x = (tree.userData.baseX as number) + Math.sin(t * 0.33 + phase) * 0.06;
  }
}

function speckle(base: string, fleck: string, repeat = 6) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const g = canvas.getContext('2d');
  if (!g) return null;
  g.fillStyle = base;
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2200; i++) {
    g.globalAlpha = 0.08 + Math.random() * 0.28;
    g.fillStyle = Math.random() > 0.5 ? fleck : base;
    const s = 1 + Math.random() * 2.4;
    g.fillRect(Math.random() * 256, Math.random() * 256, s, s);
  }
  g.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function keep(textures: THREE.Texture[], tex: THREE.Texture | null) {
  if (tex) textures.push(tex);
  return tex ?? undefined;
}

function glassMaterial(color: string, transmission = 0.92, thickness = 0.18) {
  return new THREE.MeshPhysicalMaterial({
    color,
    metalness: 0,
    roughness: 0.03,
    transmission,
    thickness,
    ior: 1.45,
    transparent: true,
    opacity: 1,
    envMapIntensity: 1,
    side: THREE.DoubleSide,
  });
}

function addPost(
  scene: THREE.Scene,
  geometries: THREE.BufferGeometry[],
  mat: THREE.Material,
  x: number,
  z: number,
  h: number,
  y = 0,
) {
  const geo = new THREE.BoxGeometry(0.07, h, 0.07);
  geometries.push(geo);
  const post = new THREE.Mesh(geo, mat);
  post.position.set(x, y + h / 2, z);
  post.castShadow = true;
  scene.add(post);
}

function addBeam(
  scene: THREE.Scene,
  geometries: THREE.BufferGeometry[],
  mat: THREE.Material,
  x: number,
  y: number,
  z: number,
  sx: number,
  sy: number,
  sz: number,
) {
  const geo = new THREE.BoxGeometry(sx, sy, sz);
  geometries.push(geo);
  const beam = new THREE.Mesh(geo, mat);
  beam.position.set(x, y, z);
  beam.castShadow = true;
  beam.receiveShadow = true;
  scene.add(beam);
  return beam;
}

function sunShadow(light: THREE.DirectionalLight, size = 12) {
  const map = profile().shadowMapSize;
  if (map <= 0) {
    light.castShadow = false;
    return;
  }
  light.castShadow = true;
  light.shadow.mapSize.set(map, map);
  light.shadow.bias = -0.0004;
  light.shadow.normalBias = 0.035;
  const cam = light.shadow.camera;
  cam.near = 0.4;
  cam.far = 36;
  cam.left = -size;
  cam.right = size;
  cam.top = size;
  cam.bottom = -size;
}

function rippleTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const g = canvas.getContext('2d');
  if (!g) return null;
  const img = g.createImageData(128, 128);
  for (let y = 0; y < 128; y++) {
    for (let x = 0; x < 128; x++) {
      const n = Math.sin(x * 0.37) * Math.cos(y * 0.29);
      const i = (y * 128 + x) * 4;
      img.data[i] = 128 + n * 48;
      img.data[i + 1] = 128 + Math.cos(x * 0.21 + y * 0.17) * 24;
      img.data[i + 2] = 255;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  return tex;
}

function buildGrass(): BuiltScene {
  const scene = new THREE.Scene();
  const day = new THREE.Color('#6e8494');
  const dusk = new THREE.Color('#142433');
  const bg = day.clone();
  scene.background = bg;
  const fog = new THREE.FogExp2(bg.getHex(), 0.045);
  scene.fog = fog;
  scene.add(new THREE.HemisphereLight(0xd8e6ee, 0x1a2618, 0.62));
  const sun = new THREE.DirectionalLight(0xf2d3b4, 2.1);
  sun.position.set(-12, 8, 6);
  scene.add(sun);

  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 160);
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const textures: THREE.Texture[] = [];

  const groundMat = new THREE.MeshStandardMaterial({
    color: '#4d6250',
    map: keep(textures, speckle('#6a8464', '#314838', 12)),
    roughness: 0.94,
    metalness: 0,
  });
  const ridgeMat = new THREE.MeshStandardMaterial({ color: '#2c4034', roughness: 0.9, metalness: 0 });
  const treeMat = new THREE.MeshStandardMaterial({ color: '#1a2b22', roughness: 0.88, metalness: 0 });
  const shrubMat = new THREE.MeshStandardMaterial({ color: '#4a6248', roughness: 0.9, metalness: 0 });
  const rockMat = new THREE.MeshStandardMaterial({ color: '#3a4036', roughness: 0.78, metalness: 0.06 });
  materials.push(groundMat, ridgeMat, treeMat, shrubMat, rockMat);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(220, 220), groundMat);
  ground.rotation.x = -Math.PI / 2;
  geometries.push(ground.geometry);
  scene.add(ground);

  const tuftGeo = new THREE.ConeGeometry(0.05, 0.34, 4);
  geometries.push(tuftGeo);
  const tuftMat = new THREE.MeshStandardMaterial({ color: '#5c7456', roughness: 0.92 });
  materials.push(tuftMat);
  const tuftCount = Math.max(24, Math.round(380 * profile().grassScale));
  const tufts = new THREE.InstancedMesh(tuftGeo, tuftMat, tuftCount);
  const tuftDummy = new THREE.Object3D();
  let tuftSeed = 0x51ed;
  const tuftRand = () => {
    tuftSeed = (tuftSeed + 0x6d2b79f5) | 0;
    let mix = Math.imul(tuftSeed ^ (tuftSeed >>> 15), 1 | tuftSeed);
    mix = (mix + Math.imul(mix ^ (mix >>> 7), 61 | mix)) ^ mix;
    return ((mix ^ (mix >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = 0; i < tuftCount; i++) {
    const angle = tuftRand() * Math.PI * 2;
    const radius = 1.2 + tuftRand() * 24;
    tuftDummy.position.set(Math.cos(angle) * radius * 0.7, 0.14, -3 - Math.abs(Math.sin(angle)) * radius);
    tuftDummy.rotation.y = tuftRand() * Math.PI;
    const scale = 0.65 + tuftRand() * 1.4;
    tuftDummy.scale.set(scale, 0.55 + tuftRand() * 1.2, scale);
    tuftDummy.updateMatrix();
    tufts.setMatrixAt(i, tuftDummy.matrix);
  }
  scene.add(tufts);

  addRidge(scene, geometries, ridgeMat, 64, 5.2, -10, -22);
  addRidge(scene, geometries, ridgeMat, 96, 8.5, 8, -40);
  addRidge(scene, geometries, ridgeMat, 130, 12, -2, -62);

  const trees: THREE.Object3D[] = [];
  treeAnchorZ = 16;
  const clusters: Array<[number, number, number]> = [
    [-11, -14, 5.4],
    [-8.6, -16.5, 3.6],
    [-13.4, -18, 4.2],
    [-6.2, -12, 2.4],
    [7.5, -15, 6.1],
    [10.2, -17.5, 3.8],
    [5.2, -20, 4.6],
    [12.4, -13, 2.8],
    [-1.2, -26, 7.2],
    [2.4, -29, 4.4],
    [-4.8, -24, 3.1],
    [8.6, -28, 5.2],
  ];
  for (const [x, z, h] of clusters) addTree(scene, geometries, treeMat, trees, x, z, h);

  const shrubs: Array<[number, number, number]> = [
    [-3.2, -7.5, 0.9],
    [-1.4, -6.2, 0.55],
    [2.1, -8.1, 0.7],
    [3.6, -6.4, 0.45],
    [-4.8, -9.2, 1.1],
    [5.2, -9.6, 0.8],
  ];
  for (const [x, z, h] of shrubs) addTree(scene, geometries, shrubMat, trees, x, z, h);

  const rocks: Array<[number, number, number]> = [
    [-2.4, -5.5, 0.55],
    [1.8, -6.8, 0.4],
    [4.2, -5.1, 0.32],
  ];
  for (const [x, z, s] of rocks) {
    const geo = new THREE.SphereGeometry(s, 7, 5);
    geometries.push(geo);
    const rock = new THREE.Mesh(geo, rockMat);
    rock.position.set(x, s * 0.35, z);
    rock.scale.y = 0.45;
    scene.add(rock);
  }

  const flyCount = 22;
  const flyGeo = new THREE.BufferGeometry();
  const flyPos = new Float32Array(flyCount * 3);
  const flyBase = new Float32Array(flyCount * 3);
  for (let i = 0; i < flyCount; i++) {
    flyBase[i * 3] = (Math.random() - 0.5) * 14;
    flyBase[i * 3 + 1] = 0.35 + Math.random() * 1.5;
    flyBase[i * 3 + 2] = -4 - Math.random() * 10;
    flyPos[i * 3] = flyBase[i * 3];
    flyPos[i * 3 + 1] = flyBase[i * 3 + 1];
    flyPos[i * 3 + 2] = flyBase[i * 3 + 2];
  }
  flyGeo.setAttribute('position', new THREE.BufferAttribute(flyPos, 3));
  geometries.push(flyGeo);
  const flyMat = new THREE.PointsMaterial({
    color: 0xf0d2a0,
    size: 0.07,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    fog: false,
  });
  materials.push(flyMat);
  scene.add(new THREE.Points(flyGeo, flyMat));

  const meadowDay = new THREE.Color('#4d6250');
  const meadowDusk = new THREE.Color('#14261c');
  const ridgeDay = new THREE.Color('#2c4034');
  const ridgeDusk = new THREE.Color('#0c1612');

  return {
    scene,
    camera,
    geometries,
    materials,
    textures,
    render(time, progress) {
      const t = motionTime(time);
      const p = 0.35 + progress * 0.65;
      bg.copy(day).lerp(dusk, p);
      scene.background = bg;
      fog.color.copy(bg);
      fog.density = 0.028 + progress * 0.04;
      groundMat.color.copy(meadowDay).lerp(meadowDusk, p);
      ridgeMat.color.copy(ridgeDay).lerp(ridgeDusk, p);
      treeMat.color.copy(ridgeDay).lerp(ridgeDusk, p);
      tuftMat.color.copy(meadowDay).lerp(meadowDusk, p);
      sun.position.x = -12 + Math.sin(t * 0.12) * 2.2;
      const drift = Math.sin(progress * Math.PI) * 2.6 + Math.sin(t * 0.28) * 0.22;
      camera.position.set(drift, 1.95 - progress * 0.5, 16 - progress * 7.5);
      camera.lookAt(progress * 0.8, 1.05, -20);
      sway(trees, t);
      flyMat.opacity = Math.max(0, progress - 0.35) * 0.85;
      const attr = flyGeo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < flyCount; i++) {
        attr.setX(i, flyBase[i * 3] + Math.sin(t * 0.7 + i) * 0.18);
        attr.setY(i, flyBase[i * 3 + 1] + Math.sin(t * 1.3 + i * 0.6) * 0.16);
      }
      attr.needsUpdate = true;
    },
  };
}

function buildGlass(): BuiltScene {
  const scene = new THREE.Scene();
  const bg = new THREE.Color('#c5d2d6');
  scene.background = bg;
  scene.fog = new THREE.FogExp2(0xd7e2e4, 0.02);
  scene.add(new THREE.HemisphereLight(0xf4f7f2, 0x8ea48c, 0.62));
  const sun = new THREE.DirectionalLight(0xfff3dd, 2.35);
  sun.position.set(-9, 8, 7);
  sunShadow(sun, 14);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xd8ece6, 0.22);
  fill.position.set(8, 4, -6);
  scene.add(fill);
  const inside = new THREE.PointLight(0xffc98a, 2.4, 8, 2);
  inside.position.set(3.15, 2.35, -1.7);
  scene.add(inside);

  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 80);
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const textures: THREE.Texture[] = [];
  const groundMat = new THREE.MeshStandardMaterial({
    color: '#d5e0d6',
    map: keep(textures, speckle('#d7e3d6', '#8ea48c', 8)),
    roughness: 0.94,
    metalness: 0,
  });
  const skidMat = new THREE.MeshStandardMaterial({ color: '#2c3438', roughness: 0.55, metalness: 0.42 });
  const woodMat = new THREE.MeshStandardMaterial({ color: '#c4ae96', roughness: 0.55, metalness: 0.02 });
  const deskMat = new THREE.MeshStandardMaterial({ color: '#6e4c34', roughness: 0.48, metalness: 0.04 });
  const wallMat = new THREE.MeshStandardMaterial({ color: '#e6e1d8', roughness: 0.72, metalness: 0.08 });
  const roofMat = new THREE.MeshStandardMaterial({ color: '#2a3136', roughness: 0.48, metalness: 0.46 });
  const glassMat = glassMaterial('#e7f3f4', 0.9, 0.16);
  glassMat.envMapIntensity = 0.55;
  const frameMat = new THREE.MeshStandardMaterial({ color: '#d5dbe0', roughness: 0.32, metalness: 0.62 });
  const ridgeMat = new THREE.MeshStandardMaterial({ color: '#9aada4', roughness: 0.9, metalness: 0 });
  const treeMat = new THREE.MeshStandardMaterial({ color: '#3d564c', roughness: 0.86, metalness: 0 });
  const lampMat = new THREE.MeshStandardMaterial({ color: '#fff1d8', emissive: '#ffc98a', emissiveIntensity: 1.2 });
  materials.push(groundMat, skidMat, woodMat, deskMat, wallMat, roofMat, glassMat, frameMat, ridgeMat, treeMat, lampMat);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(90, 90), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  geometries.push(ground.geometry);
  scene.add(ground);
  addRidge(scene, geometries, ridgeMat, 78, 4.2, 2, -26);

  const length = 6.4;
  const depth = 3.4;
  const baseY = 0.3;
  const wallH = 2.42;
  const cx = length / 2;
  const cz = -depth / 2;
  const roofY = baseY + wallH;

  const skid = new THREE.Mesh(new THREE.BoxGeometry(length + 0.28, 0.28, depth + 0.22), skidMat);
  skid.position.set(cx, 0.14, cz);
  skid.receiveShadow = true;
  skid.castShadow = true;
  geometries.push(skid.geometry);
  scene.add(skid);
  const floor = new THREE.Mesh(new THREE.BoxGeometry(length - 0.16, 0.05, depth - 0.16), woodMat);
  floor.position.set(cx, baseY + 0.02, cz);
  floor.receiveShadow = true;
  geometries.push(floor.geometry);
  scene.add(floor);

  const roof = new THREE.Mesh(new THREE.BoxGeometry(length + 0.46, 0.1, depth + 0.42), roofMat);
  roof.position.set(cx, roofY + 0.05, cz);
  roof.castShadow = true;
  roof.receiveShadow = true;
  geometries.push(roof.geometry);
  scene.add(roof);
  for (const ribX of [1.3, 3.2, 5.1]) {
    addBeam(scene, geometries, frameMat, ribX, roofY + 0.12, cz, 0.04, 0.04, depth + 0.36);
  }

  addPost(scene, geometries, frameMat, 0, 0, wallH, baseY);
  addPost(scene, geometries, frameMat, length, 0, wallH, baseY);
  addPost(scene, geometries, frameMat, 0, -depth, wallH, baseY);
  addPost(scene, geometries, frameMat, length, -depth, wallH, baseY);
  addBeam(scene, geometries, frameMat, cx, roofY, 0, length, 0.06, 0.06);
  addBeam(scene, geometries, frameMat, cx, roofY, -depth, length, 0.06, 0.06);
  addBeam(scene, geometries, frameMat, 0, roofY, cz, 0.06, 0.06, depth);
  addBeam(scene, geometries, frameMat, length, roofY, cz, 0.06, 0.06, depth);

  const frontGeo = new THREE.PlaneGeometry(4.15, wallH - 0.06);
  const doorGeo = new THREE.BoxGeometry(1.85, wallH - 0.06, 0.045);
  doorGeo.translate(-0.925, 0, 0);
  const sideGeo = new THREE.PlaneGeometry(depth - 0.12, wallH - 0.06);
  const backGeo = new THREE.BoxGeometry(length, wallH, 0.1);
  const endGeo = new THREE.BoxGeometry(0.1, wallH, depth);
  geometries.push(frontGeo, doorGeo, sideGeo, backGeo, endGeo);
  const front = new THREE.Mesh(frontGeo, glassMat);
  front.position.set(2.08, baseY + wallH / 2, 0.03);
  scene.add(front);
  const door = new THREE.Mesh(doorGeo, glassMat);
  door.position.set(4.45, baseY + wallH / 2, 0.05);
  door.rotation.y = 0.72;
  scene.add(door);
  const side = new THREE.Mesh(sideGeo, glassMat);
  side.position.set(0.03, baseY + wallH / 2, cz);
  side.rotation.y = Math.PI / 2;
  scene.add(side);
  const back = new THREE.Mesh(backGeo, wallMat);
  back.position.set(cx, baseY + wallH / 2, -depth);
  back.castShadow = true;
  back.receiveShadow = true;
  scene.add(back);
  const end = new THREE.Mesh(endGeo, wallMat);
  end.position.set(length, baseY + wallH / 2, cz);
  end.castShadow = true;
  end.receiveShadow = true;
  scene.add(end);
  for (const mullionX of [1.15, 2.3, 3.4]) {
    addBeam(scene, geometries, frameMat, mullionX, baseY + wallH / 2, 0.05, 0.035, wallH - 0.08, 0.035);
  }
  addBeam(scene, geometries, frameMat, 0.05, baseY + wallH / 2, -1.15, 0.035, wallH - 0.08, 0.035);
  addBeam(scene, geometries, frameMat, 0.05, baseY + wallH / 2, -2.25, 0.035, wallH - 0.08, 0.035);

  const deskTop = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.05, 0.62), deskMat);
  deskTop.position.set(1.55, baseY + 0.76, -2.55);
  deskTop.castShadow = true;
  geometries.push(deskTop.geometry);
  scene.add(deskTop);
  const legGeo = new THREE.BoxGeometry(0.05, 0.7, 0.05);
  geometries.push(legGeo);
  for (const [lx, lz] of [[0.98, -2.78], [2.12, -2.78], [0.98, -2.32], [2.12, -2.32]] as Array<[number, number]>) {
    const leg = new THREE.Mesh(legGeo, deskMat);
    leg.position.set(lx, baseY + 0.38, lz);
    leg.castShadow = true;
    scene.add(leg);
  }
  const lampGeo = new THREE.SphereGeometry(0.07, 12, 10);
  geometries.push(lampGeo);
  const lamp = new THREE.Mesh(lampGeo, lampMat);
  lamp.position.copy(inside.position);
  scene.add(lamp);

  const trees: THREE.Object3D[] = [];
  treeAnchorZ = 8.4;
  for (const [x, z, h] of [
    [-7.5, -9, 4.2],
    [-10, -13, 3.4],
    [11, -8, 4.6],
    [9.4, -13, 3.2],
    [2.2, -16, 5],
  ] as Array<[number, number, number]>) {
    addTree(scene, geometries, treeMat, trees, x, z, h);
  }

  return {
    scene,
    camera,
    geometries,
    materials,
    textures,
    render(time, progress) {
      const t = motionTime(time);
      const dolly = progress * 0.7;
      camera.position.set(-1.6 - dolly * 0.2, 4.35, 8.4 - dolly);
      camera.lookAt(3.1, 1.55, -1.7);
      door.rotation.y = 0.72 + Math.sin(t * 0.28) * 0.012;
      sun.position.x = -9 + Math.sin(t * 0.16) * 1.2;
      inside.intensity = 2.1 + Math.sin(t * 0.9) * 0.25;
      sway(trees, t, 0.01);
    },
  };
}

function buildSteam(): BuiltScene {
  const scene = new THREE.Scene();
  const bg = new THREE.Color('#1c1814');
  scene.background = bg;
  scene.fog = new THREE.FogExp2(0x1c1814, 0.048);
  scene.add(new THREE.HemisphereLight(0x8a7564, 0x2a241c, 0.72));
  const moon = new THREE.DirectionalLight(0xc5d4e6, 0.85);
  moon.position.set(-8, 10, 6);
  sunShadow(moon, 10);
  scene.add(moon);
  const warm = new THREE.DirectionalLight(0xffb46b, 0.7);
  warm.position.set(6, 3.2, 4);
  scene.add(warm);
  const coals = new THREE.PointLight(0xffb46b, 1.1, 2.4, 2);
  coals.position.set(0, 0.42, 0);
  scene.add(coals);

  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 40);
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const textures: THREE.Texture[] = [];
  const groundMat = new THREE.MeshStandardMaterial({
    color: '#1a241c',
    map: keep(textures, speckle('#243028', '#101612', 5)),
    roughness: 0.95,
    metalness: 0,
  });
  const ripple = keep(textures, rippleTexture());
  const tubMat = new THREE.MeshStandardMaterial({ color: '#8d6a48', roughness: 0.82, metalness: 0.02, flatShading: true });
  const rimMat = new THREE.MeshStandardMaterial({ color: '#6f5744', roughness: 0.78, metalness: 0.04 });
  const waterMat = new THREE.MeshStandardMaterial({
    color: '#c9865a',
    roughness: 0.16,
    metalness: 0.08,
    emissive: '#ffb46b',
    emissiveIntensity: 0.28,
    normalMap: ripple,
    normalScale: new THREE.Vector2(0.22, 0.22),
  });
  const glassMat = glassMaterial('#e7eef2', 0.88, 0.12);
  glassMat.roughness = 0.08;
  glassMat.envMapIntensity = 0.28;
  const frameMat = new THREE.MeshStandardMaterial({ color: '#c5ced4', roughness: 0.34, metalness: 0.62 });
  const roofMat = new THREE.MeshStandardMaterial({ color: '#2a3136', roughness: 0.5, metalness: 0.4 });
  const deckMat = new THREE.MeshStandardMaterial({ color: '#3a342c', roughness: 0.72, metalness: 0.12 });
  const stoneMat = new THREE.MeshStandardMaterial({ color: '#8d968f', roughness: 0.94, metalness: 0.02 });
  const pipeMat = new THREE.MeshStandardMaterial({ color: '#8a918c', roughness: 0.42, metalness: 0.62 });
  const treeMat = new THREE.MeshStandardMaterial({ color: '#14201a', roughness: 0.9, metalness: 0 });
  materials.push(groundMat, tubMat, rimMat, waterMat, glassMat, frameMat, roofMat, deckMat, stoneMat, pipeMat, treeMat);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  geometries.push(ground.geometry);
  scene.add(ground);

  const span = 3.5;
  const wallH = 2.2;
  const roofY = 0.16 + wallH;
  const deck = new THREE.Mesh(new THREE.BoxGeometry(span + 0.7, 0.14, span + 0.7), deckMat);
  deck.position.y = 0.07;
  deck.receiveShadow = true;
  deck.castShadow = true;
  geometries.push(deck.geometry);
  scene.add(deck);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(span + 0.45, 0.09, span + 0.45), roofMat);
  roof.position.y = roofY + 0.05;
  roof.castShadow = true;
  roof.receiveShadow = true;
  geometries.push(roof.geometry);
  scene.add(roof);

  for (const [x, z] of [
    [-span / 2, -span / 2],
    [span / 2, -span / 2],
    [-span / 2, span / 2],
    [span / 2, span / 2],
  ] as Array<[number, number]>) {
    addPost(scene, geometries, frameMat, x, z, wallH, 0.14);
  }
  addBeam(scene, geometries, frameMat, 0, roofY, -span / 2, span, 0.055, 0.055);
  addBeam(scene, geometries, frameMat, 0, roofY, span / 2, span, 0.055, 0.055);
  addBeam(scene, geometries, frameMat, -span / 2, roofY, 0, 0.055, 0.055, span);
  addBeam(scene, geometries, frameMat, span / 2, roofY, 0, 0.055, 0.055, span);

  const wallGeo = new THREE.PlaneGeometry(span - 0.16, wallH - 0.08);
  geometries.push(wallGeo);
  const back = new THREE.Mesh(wallGeo, glassMat);
  back.position.set(0, 0.16 + wallH / 2, -span / 2);
  scene.add(back);
  const left = new THREE.Mesh(wallGeo, glassMat);
  left.position.set(-span / 2, 0.16 + wallH / 2, 0);
  left.rotation.y = Math.PI / 2;
  scene.add(left);
  for (const mullion of [-0.7, 0.7]) {
    addBeam(scene, geometries, frameMat, mullion, 0.16 + wallH / 2, -span / 2 + 0.02, 0.03, wallH - 0.12, 0.03);
    addBeam(scene, geometries, frameMat, -span / 2 + 0.02, 0.16 + wallH / 2, mullion, 0.03, wallH - 0.12, 0.03);
  }

  const pad = new THREE.Mesh(new THREE.CylinderGeometry(1.28, 1.4, 0.16, 8), stoneMat);
  pad.position.y = 0.2;
  pad.castShadow = true;
  pad.receiveShadow = true;
  geometries.push(pad.geometry);
  scene.add(pad);
  const tub = new THREE.Mesh(new THREE.CylinderGeometry(0.86, 0.94, 0.7, 14), tubMat);
  tub.position.y = 0.58;
  tub.castShadow = true;
  geometries.push(tub.geometry);
  scene.add(tub);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.055, 8, 16), rimMat);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.94;
  rim.castShadow = true;
  geometries.push(rim.geometry);
  scene.add(rim);
  const water = new THREE.Mesh(new THREE.CircleGeometry(0.8, 28), waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0.88;
  geometries.push(water.geometry);
  scene.add(water);
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.85, 8), pipeMat);
  pipe.position.set(1.05, 0.7, -0.15);
  pipe.castShadow = true;
  geometries.push(pipe.geometry);
  scene.add(pipe);

  const trees: THREE.Object3D[] = [];
  treeAnchorZ = 2.6;
  for (const [x, z, h] of [
    [-4.6, -4.2, 3.6],
    [-5.8, -7, 4.4],
    [4.8, -3.8, 3.3],
    [6, -6.4, 4.6],
    [-2.4, -8.2, 2.8],
    [2.8, -8.6, 3],
  ] as Array<[number, number, number]>) {
    addTree(scene, geometries, treeMat, trees, x, z, h);
  }

  const puffs: THREE.Mesh[] = [];
  const puffGeo = new THREE.SphereGeometry(0.14, 8, 6);
  geometries.push(puffGeo);
  const puffCount = Math.max(8, profile().steamParticles);
  const puffGain = Math.min(1, 10 / puffCount);
  for (let i = 0; i < puffCount; i++) {
    const puffMat = new THREE.MeshBasicMaterial({
      color: '#f4efe8',
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
    });
    materials.push(puffMat);
    const puff = new THREE.Mesh(puffGeo, puffMat);
    puff.userData.phase = i * 0.62;
    scene.add(puff);
    puffs.push(puff);
  }
  const steamNight = new THREE.Color('#100e12');

  return {
    scene,
    camera,
    geometries,
    materials,
    textures,
    render(time, progress) {
      const t = motionTime(time);
      bg.set('#241910').lerp(steamNight, progress);
      scene.background = bg;
      (scene.fog as THREE.FogExp2).color.copy(bg);
      camera.position.set(5.8 - progress * 0.3, 2.55, 2.6 - progress * 0.15);
      camera.lookAt(-0.15, 1.05, -0.35);
      sway(trees, t, 0.012);
      warm.intensity = 0.28 + Math.sin(t * 0.6) * 0.04;
      coals.intensity = 0.9 + Math.sin(t * 1.6) * 0.15;
      if (ripple) ripple.offset.set(t * 0.012, t * 0.018);
      for (const puff of puffs) {
        const phase = puff.userData.phase as number;
        const life = (t * 0.18 + phase) % 1;
        puff.position.set(Math.sin(phase * 3) * 0.35, 0.7 + life * 2.3, Math.cos(phase * 2) * 0.35);
        const s = 0.4 + life * 1.1;
        puff.scale.setScalar(s);
        (puff.material as THREE.MeshBasicMaterial).opacity = (1 - life) * 0.28 * puffGain;
      }
    },
  };
}

function buildFar(): BuiltScene {
  const scene = new THREE.Scene();
  const bg = new THREE.Color('#1c3344');
  scene.background = bg;
  scene.fog = new THREE.FogExp2(0x1c3344, 0.018);
  scene.add(new THREE.HemisphereLight(0x8aa4b8, 0x1a221c, 0.55));
  const moon = new THREE.DirectionalLight(0xc5d4e4, 0.22);
  moon.position.set(-10, 14, -6);
  scene.add(moon);

  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 220);
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const textures: THREE.Texture[] = [];
  const groundMat = new THREE.MeshLambertMaterial({ color: '#24362e' });
  const ridgeMat = new THREE.MeshLambertMaterial({ color: '#1a2c34' });
  const farMat = new THREE.MeshLambertMaterial({ color: '#243848' });
  materials.push(groundMat, ridgeMat, farMat);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(260, 260), groundMat);
  ground.rotation.x = -Math.PI / 2;
  geometries.push(ground.geometry);
  scene.add(ground);
  addRidge(scene, geometries, ridgeMat, 90, 6, -16, -30);
  addRidge(scene, geometries, farMat, 140, 14, 6, -70);
  addRidge(scene, geometries, farMat, 180, 22, -8, -110);

  const count = 180;
  const starGeo = new THREE.BufferGeometry();
  const starPos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const theta = Math.random() * Math.PI * 2;
    const r = 30 + Math.random() * 80;
    starPos[i * 3] = Math.cos(theta) * r * 0.7;
    starPos[i * 3 + 1] = 6 + Math.random() * 48;
    starPos[i * 3 + 2] = -20 - Math.abs(Math.sin(theta)) * r;
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  geometries.push(starGeo);
  const starMat = new THREE.PointsMaterial({
    color: 0xf7f4ee,
    size: 0.16,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    fog: false,
  });
  materials.push(starMat);
  scene.add(new THREE.Points(starGeo, starMat));
  const moonGeo = new THREE.SphereGeometry(1.7, 18, 14);
  geometries.push(moonGeo);
  const moonMat = new THREE.MeshBasicMaterial({ color: '#f6f1e6', fog: false });
  materials.push(moonMat);
  const moonMesh = new THREE.Mesh(moonGeo, moonMat);
  moonMesh.position.set(-16, 18, -46);
  scene.add(moonMesh);

  const night = new THREE.Color('#071018');
  const dayGround = new THREE.Color('#2a4038');
  const groundNight = new THREE.Color('#101816');
  const daySky = new THREE.Color('#1c3344');

  return {
    scene,
    camera,
    geometries,
    materials,
    textures,
    render(time, progress) {
      const t = motionTime(time);
      bg.copy(daySky).lerp(night, progress);
      scene.background = bg;
      (scene.fog as THREE.FogExp2).color.copy(bg);
      (scene.fog as THREE.FogExp2).density = 0.012 + progress * 0.012;
      groundMat.color.copy(dayGround).lerp(groundNight, progress);
      camera.position.set(Math.sin(progress * Math.PI) * 3, 4.2 + progress * 7.5, 24 - progress * 4);
      camera.lookAt(0, 2.2, -48);
      starMat.opacity = 0.22 + progress * 0.62 + Math.sin(t * 1.4) * 0.06;
      moonMesh.position.y = 14 + progress * 12;
      moonMat.color.set('#f3ecdf').multiplyScalar(0.45 + progress * 0.55);
    },
  };
}

function buildSnow(): BuiltScene {
  const scene = new THREE.Scene();
  const bg = new THREE.Color('#c5d4e2');
  scene.background = bg;
  scene.fog = new THREE.FogExp2(0xd5e2ee, 0.02);
  scene.add(new THREE.HemisphereLight(0xf7fbff, 0x9eb0c0, 0.55));
  const sun = new THREE.DirectionalLight(0xfff4e8, 1.85);
  sun.position.set(-12, 9, 8);
  sunShadow(sun, 22);
  scene.add(sun);
  const under = new THREE.PointLight(0x8ec4ff, 4.5, 12, 1.8);
  under.position.set(0, 0.7, -6);
  scene.add(under);

  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 160);
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const textures: THREE.Texture[] = [];
  const snowMat = new THREE.MeshStandardMaterial({ color: '#e7eef3', roughness: 0.92 });
  const ridgeMat = new THREE.MeshStandardMaterial({ color: '#d5e0ea', roughness: 0.9 });
  const peakMat = new THREE.MeshStandardMaterial({ color: '#c3d0dc', roughness: 0.88 });
  const spruceMat = new THREE.MeshStandardMaterial({ color: '#2c3d36', roughness: 0.88 });
  const deckMat = new THREE.MeshStandardMaterial({ color: '#d9cbb8', roughness: 0.62 });
  const glowMat = new THREE.MeshBasicMaterial({ color: '#7eb6ff' });
  const roomGlow = new THREE.MeshBasicMaterial({ color: '#ffd8ae' });
  const pileMat = new THREE.MeshStandardMaterial({ color: '#5c6770', roughness: 0.7, metalness: 0.2 });
  const shellMat = glassMaterial('#e7f2f6', 0.7, 0.12);
  shellMat.envMapIntensity = 0.35;
  const slabMat = new THREE.MeshStandardMaterial({ color: '#e7eef2', roughness: 0.42, metalness: 0.22 });
  const capMat = new THREE.MeshStandardMaterial({ color: '#2c3438', roughness: 0.5, metalness: 0.42 });
  const roomWall = new THREE.MeshStandardMaterial({ color: '#b7b1a8', roughness: 0.72, metalness: 0.06 });
  const frameMat = new THREE.MeshStandardMaterial({ color: '#d5dbe0', roughness: 0.32, metalness: 0.55 });
  materials.push(snowMat, ridgeMat, peakMat, spruceMat, deckMat, glowMat, roomGlow, pileMat, shellMat, slabMat, capMat, roomWall, frameMat);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(180, 180), snowMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  geometries.push(ground.geometry);
  scene.add(ground);
  addRidge(scene, geometries, ridgeMat, 80, 9, -12, -24);
  addRidge(scene, geometries, peakMat, 120, 16, 10, -48);
  addRidge(scene, geometries, peakMat, 150, 22, -4, -78);

  const trees: THREE.Object3D[] = [];
  treeAnchorZ = 14.2;
  for (const [x, z, h] of [
    [-12, -9, 4.4],
    [-14.5, -15, 5.4],
    [-9, -20, 3.8],
    [15.5, -12, 4.6],
    [17, -19, 5.6],
    [14, -27, 4.1],
    [-16, -26, 6.2],
  ] as Array<[number, number, number]>) {
    addTree(scene, geometries, spruceMat, trees, x, z, h);
  }

  const deckGeo = new THREE.BoxGeometry(9.2, 0.16, 5.4);
  const glowGeo = new THREE.BoxGeometry(8.4, 0.06, 4.6);
  const pileGeo = new THREE.CylinderGeometry(0.11, 0.14, 2.02, 8);
  geometries.push(deckGeo, glowGeo, pileGeo);
  const deck = new THREE.Mesh(deckGeo, deckMat);
  deck.position.set(5.4, 2.05, -14);
  scene.add(deck);
  const glow = new THREE.Mesh(glowGeo, glowMat);
  glow.position.set(5.4, 1.9, -14);
  scene.add(glow);
  under.position.set(5.4, 1.2, -14);
  for (const [x, z] of [
    [1.4, -11.6],
    [9.4, -11.6],
    [1.4, -16.4],
    [9.4, -16.4],
  ] as Array<[number, number]>) {
    const pile = new THREE.Mesh(pileGeo, pileMat);
    pile.position.set(x, 1.01, z);
    pile.castShadow = true;
    scene.add(pile);
  }

  const roomY = 2.16;
  const rw = 4.6;
  const rd = 3.05;
  const rh = 2.2;
  const rcx = 4.5;
  const rcz = -14.1;
  for (const [x, z] of [
    [rcx - rw / 2, rcz - rd / 2],
    [rcx + rw / 2, rcz - rd / 2],
    [rcx - rw / 2, rcz + rd / 2],
    [rcx + rw / 2, rcz + rd / 2],
  ] as Array<[number, number]>) {
    addPost(scene, geometries, frameMat, x, z, rh, roomY);
  }
  const roomRoof = new THREE.Mesh(new THREE.BoxGeometry(rw + 0.4, 0.1, rd + 0.36), capMat);
  roomRoof.position.set(rcx, roomY + rh + 0.05, rcz);
  roomRoof.castShadow = true;
  geometries.push(roomRoof.geometry);
  scene.add(roomRoof);
  const frontPane = new THREE.Mesh(new THREE.PlaneGeometry(rw - 0.12, rh - 0.08), shellMat);
  frontPane.position.set(rcx, roomY + rh / 2, rcz + rd / 2);
  geometries.push(frontPane.geometry);
  scene.add(frontPane);
  const sidePane = new THREE.Mesh(new THREE.PlaneGeometry(rd - 0.12, rh - 0.08), shellMat);
  sidePane.position.set(rcx - rw / 2, roomY + rh / 2, rcz);
  sidePane.rotation.y = Math.PI / 2;
  geometries.push(sidePane.geometry);
  scene.add(sidePane);
  const roomBack = new THREE.Mesh(new THREE.BoxGeometry(rw, rh, 0.08), roomWall);
  roomBack.position.set(rcx, roomY + rh / 2, rcz - rd / 2);
  roomBack.castShadow = true;
  geometries.push(roomBack.geometry);
  scene.add(roomBack);
  const roomEnd = new THREE.Mesh(new THREE.BoxGeometry(0.08, rh, rd), roomWall);
  roomEnd.position.set(rcx + rw / 2, roomY + rh / 2, rcz);
  roomEnd.castShadow = true;
  geometries.push(roomEnd.geometry);
  scene.add(roomEnd);
  for (const mx of [-1.15, 0, 1.15]) {
    addBeam(scene, geometries, capMat, rcx + mx, roomY + rh / 2, rcz + rd / 2 + 0.02, 0.05, rh - 0.12, 0.05);
  }

  const levels = 4;
  const tw = 2.6;
  const fh = 2.25;
  const slabGeo = new THREE.BoxGeometry(tw + 0.72, 0.11, tw + 0.72);
  const glassGeo = new THREE.PlaneGeometry(tw - 0.06, fh - 0.16);
  const coreGeo = new THREE.BoxGeometry(0.72, fh - 0.18, 0.72);
  const glowFloor = new THREE.BoxGeometry(tw - 0.4, 0.03, tw - 0.4);
  const capGeo = new THREE.BoxGeometry(tw + 0.96, 0.12, tw + 0.96);
  geometries.push(slabGeo, glassGeo, coreGeo, glowFloor, capGeo);
  const tower = new THREE.Group();
  for (let i = 0; i < levels; i++) {
    const y = i * fh;
    const slab = new THREE.Mesh(slabGeo, slabMat);
    slab.position.y = y;
    slab.castShadow = true;
    slab.receiveShadow = true;
    tower.add(slab);
    const mid = y + fh / 2;
    ([
      [0, mid, tw / 2, 0],
      [0, mid, -tw / 2, 0],
      [tw / 2, mid, 0, Math.PI / 2],
      [-tw / 2, mid, 0, Math.PI / 2],
    ] as Array<[number, number, number, number]>).forEach(([x, yy, z, rot]) => {
      const pane = new THREE.Mesh(glassGeo, shellMat);
      pane.position.set(x, yy, z);
      pane.rotation.y = rot;
      tower.add(pane);
    });
    const core = new THREE.Mesh(coreGeo, roomWall);
    core.position.y = mid;
    tower.add(core);
    const lamp = new THREE.Mesh(glowFloor, roomGlow);
    lamp.position.y = y + 0.14;
    tower.add(lamp);
  }
  const cap = new THREE.Mesh(capGeo, capMat);
  cap.position.y = levels * fh;
  cap.castShadow = true;
  tower.add(cap);
  tower.position.set(10.6, 0, -23);
  scene.add(tower);

  const dusk = new THREE.Color('#8ea4b8');
  const daySky = new THREE.Color('#d5e2ee');

  return {
    scene,
    camera,
    geometries,
    materials,
    textures,
    render(time, progress) {
      const t = motionTime(time);
      bg.copy(daySky).lerp(dusk, progress * 0.55);
      scene.background = bg;
      (scene.fog as THREE.FogExp2).color.copy(bg);
      camera.position.set(1.1 + progress * 3.2, 6.4, 14.2 - progress * 1.4);
      camera.lookAt(6.2, 3.1, -17);
      sway(trees, t, 0.01);
      under.intensity = 3.6 + Math.sin(t * 0.8) * 0.4;
    },
  };
}

function buildSlope(): BuiltScene {
  const scene = new THREE.Scene();
  const bg = new THREE.Color('#b7c8d4');
  scene.background = bg;
  scene.fog = new THREE.FogExp2(0xc5d4e0, 0.022);
  scene.add(new THREE.HemisphereLight(0xeef4f8, 0x8ea0ae, 0.85));
  const sun = new THREE.DirectionalLight(0xfff0e0, 0.28);
  sun.position.set(8, 11, 4);
  scene.add(sun);

  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 120);
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const textures: THREE.Texture[] = [];
  const snowMat = new THREE.MeshLambertMaterial({ color: '#e4ebf0' });
  const ridgeMat = new THREE.MeshLambertMaterial({ color: '#c5d2de' });
  const pileMat = new THREE.MeshLambertMaterial({ color: '#3e4850' });
  const deckMat = new THREE.MeshLambertMaterial({ color: '#d7cfc2' });
  const glowMat = new THREE.MeshBasicMaterial({ color: '#9ec8ea' });
  const treeMat = new THREE.MeshLambertMaterial({ color: '#2a3a44' });
  materials.push(snowMat, ridgeMat, pileMat, deckMat, glowMat, treeMat);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(90, 90), snowMat);
  ground.rotation.x = -1.15;
  ground.position.set(0, -2.2, -6);
  geometries.push(ground.geometry);
  scene.add(ground);
  addRidge(scene, geometries, ridgeMat, 70, 10, -8, -20);
  addRidge(scene, geometries, ridgeMat, 100, 16, 6, -36);

  const up = new THREE.Vector3(0, 1, 0);
  const stilt = (x: number, z0: number, y0: number, z1: number, y1: number) => {
    const dir = new THREE.Vector3(0, y1 - y0, z1 - z0);
    const len = dir.length();
    const geo = new THREE.CylinderGeometry(0.055, 0.075, len, 10);
    geometries.push(geo);
    const pile = new THREE.Mesh(geo, pileMat);
    pile.position.set(x, (y0 + y1) / 2, (z0 + z1) / 2);
    pile.quaternion.setFromUnitVectors(up, dir.normalize());
    scene.add(pile);
    const capGeo = new THREE.CylinderGeometry(0.14, 0.14, 0.06, 10);
    geometries.push(capGeo);
    const cap = new THREE.Mesh(capGeo, pileMat);
    cap.position.set(x, y1, z1);
    scene.add(cap);
  };
  stilt(-0.1, -8.2, 0.35, -12.1, 3.25);
  stilt(3.0, -8.2, 0.35, -12.1, 3.25);
  stilt(-0.1, -10.4, 0.7, -16.3, 3.6);
  stilt(3.0, -10.4, 0.7, -16.3, 3.6);
  const deckGeo = new THREE.BoxGeometry(3.1, 0.1, 4.6);
  const glowGeo = new THREE.BoxGeometry(2.7, 0.05, 4.1);
  geometries.push(deckGeo, glowGeo);
  const deck = new THREE.Mesh(deckGeo, deckMat);
  deck.position.set(1.45, 3.5, -14.2);
  deck.rotation.x = -0.18;
  scene.add(deck);
  const glow = new THREE.Mesh(glowGeo, glowMat);
  glow.position.set(1.45, 3.38, -14.2);
  glow.rotation.x = -0.18;
  scene.add(glow);
  const paneMat = new THREE.MeshPhysicalMaterial({
    color: '#d7eef8',
    roughness: 0.06,
    metalness: 0.04,
    transparent: true,
    opacity: 0.62,
    envMapIntensity: 0.4,
  });
  const railMat = new THREE.MeshStandardMaterial({ color: '#e7eef2', roughness: 0.3, metalness: 0.55 });
  materials.push(paneMat, railMat);
  const paneGeo = new THREE.BoxGeometry(2.9, 0.05, 4.25);
  const railGeo = new THREE.BoxGeometry(0.04, 0.28, 4.25);
  geometries.push(paneGeo, railGeo);
  const pane = new THREE.Mesh(paneGeo, paneMat);
  pane.position.set(1.45, 3.6, -14.2);
  pane.rotation.x = -0.18;
  scene.add(pane);
  for (const x of [0.05, 2.85]) {
    const rail = new THREE.Mesh(railGeo, railMat);
    rail.position.set(x, 3.78, -14.2);
    rail.rotation.x = -0.18;
    scene.add(rail);
  }

  const trees: THREE.Object3D[] = [];
  treeAnchorZ = 8;
  for (const [x, z, h] of [
    [-12, -10, 3.6],
    [-14, -16, 5],
    [10, -12, 4.2],
    [12.5, -18, 5.4],
  ] as Array<[number, number, number]>) {
    addTree(scene, geometries, treeMat, trees, x, z, h);
  }

  return {
    scene,
    camera,
    geometries,
    materials,
    textures,
    render(time, progress) {
      const t = motionTime(time);
      camera.position.set(2.2 - progress * 0.4, 2.4 + progress * 1.6, 8 - progress * 2);
      camera.lookAt(1.6, 2.6 + progress * 1.2, -14);
      sway(trees, t, 0.012);
    },
  };
}

const BUILDERS: Record<SceneKey, () => BuiltScene> = {
  grass: buildGrass,
  glass: buildGlass,
  steam: buildSteam,
  far: buildFar,
  snow: buildSnow,
  slope: buildSlope,
};

const LOOK: Record<SceneKey, { exposure: number; tone: StageTone; hdri: string; env: number; ao: boolean }> = {
  grass: { exposure: 1.02, tone: 'agx', hdri: '/hdri/alps_field_1k.hdr', env: 0.35, ao: false },
  far: { exposure: 1.02, tone: 'agx', hdri: '/hdri/alps_field_1k.hdr', env: 0.35, ao: false },
  slope: { exposure: 0.94, tone: 'agx', hdri: '/hdri/alps_field_1k.hdr', env: 0.35, ao: false },
  snow: { exposure: 0.94, tone: 'agx', hdri: '/hdri/evening_meadow_1k.hdr', env: 0.4, ao: false },
  glass: { exposure: 1.02, tone: 'neutral', hdri: '/hdri/kloofendal_48d_partly_cloudy_puresky_1k.hdr', env: 0.62, ao: true },
  steam: { exposure: 1.08, tone: 'agx', hdri: '/hdri/qwantani_dusk_2_puresky_1k.hdr', env: 0.2, ao: true },
};

function disposeBuilt(built: BuiltScene) {
  built.scene.environment = null;
  built.geometries.forEach((geo) => geo.dispose());
  built.materials.forEach((mat) => mat.dispose());
  built.textures.forEach((tex) => tex.dispose());
  built.scene.clear();
}

function mountMeadowNow(canvas: HTMLCanvasElement, readProgress: () => number) {
  const key = sceneKey(canvas);
  canvas.dataset.sceneLive = key;
  const look = LOOK[key];
  if (key === 'grass' || key === 'far') {
    const world = mountMeadowWorld(canvas, {
      spline: key === 'grass' ? GRASS_SPLINE : FAR_SPLINE,
      timeOfDay: key === 'grass' ? 'day' : 'scroll',
      density: 1,
      exposure: look.exposure,
      tone: look.tone,
      hdri: look.hdri,
      envIntensity: look.env,
      ao: false,
    });
    world.setProgress(readProgress());
    return {
      setProgress(t: number) {
        world.setProgress(t);
      },
      destroy() {
        world.destroy();
      },
    };
  }
  let dead = false;
  let built: BuiltScene | null = null;

  const build = () => {
    activeProfile = qualityProfile();
    return BUILDERS[key]();
  };

  const spec = {
    element: canvas,
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(34, 1, 0.1, 160),
    ao: look.ao,
    exposure: look.exposure,
    tone: look.tone,
    hdri: look.hdri,
    envIntensity: look.env,
    update(progress: number) {
      built?.render(performance.now(), progress);
    },
    suspend() {
      if (!built) return;
      disposeBuilt(built);
      built = null;
    },
    resume() {
      if (built || dead) return;
      built = build();
      spec.scene = built.scene;
      spec.camera = built.camera;
    },
  };
  const view = registerView(spec);

  const rebuild = () => {
    if (!built) return;
    disposeBuilt(built);
    built = build();
    spec.scene = built.scene;
    spec.camera = built.camera;
  };

  built = build();
  spec.scene = built.scene;
  spec.camera = built.camera;
  view.setProgress(readProgress());

  const stop = onQuality((next) => {
    if (dead || next.tier === 'off') return;
    rebuild();
  });

  return {
    setProgress(t: number) {
      view.setProgress(t);
    },
    destroy() {
      if (dead) return;
      dead = true;
      stop();
      view.destroy();
      if (built) disposeBuilt(built);
      built = null;
    },
  };
}

export function mountMeadow(canvas: HTMLCanvasElement) {
  let dead = false;
  let inner: ReturnType<typeof mountMeadowNow> | null = null;
  let progress = 0;

  const boot = () => {
    if (dead || inner) return;
    if (qualityProfile().tier === 'off') {
      showStill(canvas);
      return;
    }
    hideStill(canvas);
    inner = mountMeadowNow(canvas, () => progress);
  };

  const stop = onQuality((next) => {
    if (dead) return;
    if (next.tier === 'off') {
      inner?.destroy();
      inner = null;
      showStill(canvas);
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
