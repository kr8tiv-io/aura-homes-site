import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';


const DUSK = 0x151c26;
const MODEL_URL = '/models/aura-sanctuary.glb';

type Shot = {
  pos: THREE.Vector3;
  look: THREE.Vector3;
  fov: number;
};

type HouseScene = {
  setProgress: (t: number) => void;
  setPointer: (nx: number, ny: number) => void;
  destroy: () => void;
  ready: Promise<void>;
};

function easeInOut(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function steamTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d');
  if (!g) return new THREE.Texture();
  const grd = g.createRadialGradient(32, 40, 4, 32, 28, 30);
  grd.addColorStop(0, 'rgba(236, 240, 245, 0.55)');
  grd.addColorStop(0.45, 'rgba(210, 220, 230, 0.18)');
  grd.addColorStop(1, 'rgba(180, 196, 210, 0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeSky() {
  const skyGeo = new THREE.SphereGeometry(120, 32, 20);
  const skyCol = new Float32Array(skyGeo.attributes.position.count * 3);
  const topC = new THREE.Color(0x1a2838);
  const midC = new THREE.Color(0x4a6074);
  const horC = new THREE.Color(0x7a8a96);
  const grdC = new THREE.Color(0x1a1e16);
  const posAttr = skyGeo.attributes.position;
  const tmpC = new THREE.Color();
  for (let i = 0; i < posAttr.count; i++) {
    const y = posAttr.getY(i) / 120;
    if (y < 0) {
      tmpC.copy(grdC).lerp(horC, THREE.MathUtils.smoothstep(y, -0.12, 0.0));
    } else {
      tmpC.copy(horC).lerp(midC, THREE.MathUtils.smoothstep(y, 0.0, 0.18));
      tmpC.lerp(topC, THREE.MathUtils.smoothstep(y, 0.18, 0.85));
    }
    skyCol[i * 3] = tmpC.r;
    skyCol[i * 3 + 1] = tmpC.g;
    skyCol[i * 3 + 2] = tmpC.b;
  }
  skyGeo.setAttribute('color', new THREE.BufferAttribute(skyCol, 3));
  return new THREE.Mesh(
    skyGeo,
    new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, depthWrite: false, fog: false }),
  );
}

function makeField() {
  const geo = new THREE.CircleGeometry(90, 72);
  const col = new Float32Array(geo.attributes.position.count * 3);
  const inner = new THREE.Color(0x3e4430);
  const outer = new THREE.Color(0x1c2016);
  const tmp = new THREE.Color();
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const r = Math.hypot(pos.getX(i), pos.getY(i)) / 90;
    tmp.copy(inner).lerp(outer, THREE.MathUtils.smoothstep(r, 0.12, 0.85));
    col[i * 3] = tmp.r;
    col[i * 3 + 1] = tmp.g;
    col[i * 3 + 2] = tmp.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({ vertexColors: true, fog: true }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = -0.03;
  return mesh;
}

function addHill(scene: THREE.Scene, x: number, z: number, sx: number, sy: number, sz: number, hex: number) {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(1, 18, 12),
    new THREE.MeshBasicMaterial({ color: hex, fog: true }),
  );
  mesh.position.set(x, sy * 0.22, z);
  mesh.scale.set(sx, sy, sz);
  mesh.raycast = () => {};
  scene.add(mesh);
  return mesh;
}

export function mountHouseScene(canvas: HTMLCanvasElement): HouseScene {
  const parent = canvas.parentElement ?? canvas;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const narrow = window.matchMedia('(max-width: 1023px)').matches;
  const X_SHIFT = narrow ? 0.35 : -1.85;

  RectAreaLightUniformsLib.init();

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: !coarse,
    alpha: false,
    powerPreference: 'high-performance',
    stencil: false,
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.82;
  renderer.shadowMap.enabled = !coarse;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.setClearColor(DUSK, 1);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(DUSK);
  scene.fog = new THREE.Fog(0x3a4a58, 32, 88);

  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 180);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.background = new THREE.Color(0x243044);
  envScene.add(new THREE.HemisphereLight(0x8aa0b8, 0x1a140c, 0.55));
  const envSun = new THREE.DirectionalLight(0xc4b49a, 0.2);
  envSun.position.set(-6, 8, -10);
  envScene.add(envSun);
  const envTex = pmrem.fromScene(envScene, 0.08).texture;
  scene.environment = envTex;
  scene.environmentIntensity = 0.05;
  envScene.background = null;

  scene.add(new THREE.HemisphereLight(0x7a8ea4, 0x1c1a14, 0.32));

  const moon = new THREE.DirectionalLight(0xc5d0e2, 0.22);
  moon.position.set(-8, 14, -10);
  scene.add(moon);

  const fill = new THREE.DirectionalLight(0xc9a078, 0.1);
  fill.position.set(8, 4, -6);
  scene.add(fill);

  const key = new THREE.DirectionalLight(0xffe2c0, 0.14);
  key.position.set(-7, 9, -12);
  key.castShadow = !coarse;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.bias = -0.00028;
  key.shadow.normalBias = 0.04;
  const span = 16;
  key.shadow.camera.left = -span;
  key.shadow.camera.right = span;
  key.shadow.camera.top = span;
  key.shadow.camera.bottom = -span;
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 46;
  scene.add(key);

  const interior = new THREE.PointLight(0xffc27a, 6.5, 7, 1.6);
  scene.add(interior);
  const cove = new THREE.PointLight(0xffd09a, 2.6, 5, 1.8);
  scene.add(cove);
  const sofaLamp = new THREE.PointLight(0xffe0b0, 1.3, 4, 1.9);
  scene.add(sofaLamp);
  const led = new THREE.PointLight(0x6a58ff, 5.5, 6, 1.6);
  scene.add(led);
  const fire = new THREE.PointLight(0xff6a22, 9, 4.2, 1.6);
  scene.add(fire);
  const tubFill = new THREE.PointLight(0xffd0a0, 3.2, 3.8, 1.8);
  scene.add(tubFill);
  const nestLamp = new THREE.PointLight(0xffe6c8, 2.4, 3.6, 1.8);
  scene.add(nestLamp);
  const bay = new THREE.RectAreaLight(0xffc27a, 6.5, 1.45, 2.15);
  scene.add(bay);
  const ledBar = new THREE.RectAreaLight(0x5a4ae8, 4.5, 5.6, 0.14);
  scene.add(ledBar);

  scene.add(makeSky());
  scene.add(makeField());
  addHill(scene, -22, 36, 20, 3.2, 9, 0x243028);
  addHill(scene, 8, 42, 26, 4.0, 12, 0x1e2822);
  addHill(scene, 28, 32, 16, 2.8, 8, 0x26322a);

  const root = new THREE.Group();
  scene.add(root);

  const steam = new THREE.Group();
  const steamSprites: { sprite: THREE.Sprite; phase: number; radius: number; speed: number }[] = [];
  const steamMap = steamTexture();
  for (let i = 0; i < 18; i++) {
    const mat = new THREE.SpriteMaterial({
      map: steamMap,
      color: 0xd8e2ea,
      transparent: true,
      depthWrite: false,
      opacity: 0.22,
      fog: true,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.setScalar(0.4 + Math.random() * 0.45);
    steam.add(sprite);
    steamSprites.push({
      sprite,
      phase: Math.random(),
      radius: 0.12 + Math.random() * 0.16,
      speed: 0.09 + Math.random() * 0.07,
    });
  }
  scene.add(steam);

  const dummyA = new THREE.Vector3(4, 1.4, -9);
  const dummyB = new THREE.Vector3(-2, 0.8, -2);
  const path = {
    shots: [
      { pos: dummyA.clone(), look: dummyB.clone(), fov: 36 },
      { pos: dummyA.clone().add(new THREE.Vector3(-1, 0, 1)), look: dummyB.clone(), fov: 34 },
    ] as Shot[],
    pos: new THREE.CatmullRomCurve3([dummyA.clone(), dummyB.clone()], false, 'catmullrom', 0.12),
    look: new THREE.CatmullRomCurve3([dummyB.clone(), dummyB.clone()], false, 'catmullrom', 0.12),
  };

  const rig = {
    progress: 0,
    pointer: new THREE.Vector2(0, 0),
    pointerTarget: new THREE.Vector2(0, 0),
    t0: performance.now(),
  };

  const camPos = new THREE.Vector3();
  const camLook = new THREE.Vector3();
  const tmpA = new THREE.Vector3();

  let swing: THREE.Object3D | null = null;
  const fireMats: THREE.MeshStandardMaterial[] = [];
  const ledMats: THREE.Material[] = [];

  function rebuildPath(shots: Shot[]) {
    path.shots = shots;
    path.pos = new THREE.CatmullRomCurve3(
      shots.map((s) => s.pos.clone()),
      false,
      'catmullrom',
      0.18,
    );
    path.look = new THREE.CatmullRomCurve3(
      shots.map((s) => s.look.clone()),
      false,
      'catmullrom',
      0.18,
    );
  }

  function sampleShot(t: number, outPos: THREE.Vector3, outLook: THREE.Vector3) {
    const u = THREE.MathUtils.clamp(t, 0, 1);
    const e = easeInOut(u);
    path.pos.getPointAt(e, outPos);
    path.look.getPointAt(e, outLook);
    const shots = path.shots;
    const n = shots.length - 1;
    const x = e * n;
    const i = Math.min(Math.floor(x), n - 1);
    const f = x - i;
    camera.fov = THREE.MathUtils.lerp(shots[i].fov, shots[i + 1].fov, f);
    camera.updateProjectionMatrix();
  }

  function placeCamera() {
    sampleShot(rig.progress, camPos, camLook);
    tmpA.copy(camPos);
    tmpA.x += rig.pointer.x * 0.38;
    tmpA.y += rig.pointer.y * 0.16;
    camera.position.copy(tmpA);
    camera.lookAt(camLook);
    camera.rotateZ(Math.sin(rig.progress * Math.PI) * 0.016);
  }

  function resize() {
    const rect = parent.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width));
    const h = Math.max(1, Math.floor(rect.height));
    const dpr = Math.min(window.devicePixelRatio || 1, coarse ? 1.25 : 1.6);
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    placeCamera();
    renderer.render(scene, camera);
  }

  let visible = true;
  let raf = 0;
  let disposed = false;

  function tick() {
    if (disposed) return;
    raf = requestAnimationFrame(tick);
    if (!visible) return;
    const t = (performance.now() - rig.t0) / 1000;
    rig.pointer.x += (rig.pointerTarget.x - rig.pointer.x) * 0.07;
    rig.pointer.y += (rig.pointerTarget.y - rig.pointer.y) * 0.07;

    if (swing) {
      swing.rotation.z = Math.sin(t * 0.62) * 0.055 + rig.pointer.x * 0.035;
      swing.rotation.x = Math.sin(t * 0.47 + 0.6) * 0.028 + rig.pointer.y * 0.02;
    }

    const flicker = 0.82 + Math.sin(t * 11.3) * 0.12 + Math.sin(t * 23.0) * 0.06;
    fire.intensity = 9 * flicker;
    for (const m of fireMats) m.emissiveIntensity = 1.35 * flicker;

    const pulse = 0.78 + Math.sin(t * 1.15) * 0.18;
    led.intensity = 5.2 * pulse;
    ledBar.intensity = 4.2 * pulse;
    for (const m of ledMats) {
      const std = m as THREE.MeshStandardMaterial;
      if ('emissiveIntensity' in std) std.emissiveIntensity = 1.6 * pulse;
    }

    interior.intensity = 6.2 + Math.sin(t * 0.35) * 0.4;
    bay.intensity = 6.2 + Math.sin(t * 0.35) * 0.4;

    for (const p of steamSprites) {
      const u = (p.phase + t * p.speed) % 1;
      const rise = u * 1.15;
      p.sprite.position.set(
        Math.sin(u * 6.2 + p.phase * 8) * p.radius,
        rise,
        Math.cos(u * 5.1 + p.phase) * p.radius * 0.7,
      );
      const fade = Math.sin(u * Math.PI);
      p.sprite.material.opacity = 0.05 + fade * 0.16;
      const sc = 0.35 + u * 0.85;
      p.sprite.scale.set(sc, sc * 1.35, 1);
    }

    placeCamera();
    renderer.render(scene, camera);
  }

  const ready = new Promise<void>((resolve, reject) => {
    const loader = new GLTFLoader();
    loader.load(
      MODEL_URL,
      (gltf) => {
        const model = gltf.scene;
        const landmarks: Record<string, number[]> = {};
        const seen = new Set<THREE.Material>();

        model.traverse((obj) => {
          const mesh = obj as THREE.Mesh;
          if (obj.name === 'SwingPivot') swing = obj;

          if (!mesh.isMesh) return;
          const nm = (mesh.name || '').toLowerCase();
          if (
            nm.includes('soil') ||
            nm.includes('meadow') ||
            nm.includes('downlight') ||
            nm.includes('covelight') ||
            nm.includes('candle') ||
            nm.includes('trunk') ||
            nm.includes('canopy') ||
            nm.includes('bark')
          ) {
            mesh.visible = false;
            return;
          }
          mesh.castShadow = !coarse && !nm.includes('glass') && !nm.includes('water') && !nm.includes('hill');
          mesh.receiveShadow = true;

          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (let i = 0; i < mats.length; i++) {
            const src = mats[i] as THREE.MeshStandardMaterial;
            const name = `${src.name || ''} ${mesh.name || ''}`.toLowerCase();

            if (src.map) {
              src.map.anisotropy = renderer.capabilities.getMaxAnisotropy();
              src.map.colorSpace = THREE.SRGBColorSpace;
            }

            if (name.includes('glass') || name.includes('water')) {
              const water = name.includes('water');
              mats[i] = new THREE.MeshPhysicalMaterial({
                color: water ? 0x14181c : 0x0a0c10,
                metalness: water ? 0.02 : 0.22,
                roughness: water ? 0.14 : 0.08,
                transmission: 0,
                transparent: true,
                opacity: water ? 0.62 : 0.96,
                ior: water ? 1.33 : 1.5,
                envMapIntensity: water ? 0.25 : 0.22,
                side: THREE.FrontSide,
              });
              continue;
            }
            if (name.includes('hill')) {
              mats[i] = new THREE.MeshBasicMaterial({ color: 0x243028 });
              continue;
            }
            if (name.includes('meadow') || name.includes('grass')) {
              mats[i] = new THREE.MeshBasicMaterial({ color: 0x2a2e1c });
              continue;
            }
            if (name.includes('deck')) {
              mats[i] = new THREE.MeshLambertMaterial({
                color: 0x16130f,
                map: src.map ?? null,
              });
              continue;
            }
            if (name.includes('velvet')) {
              const teal = name.includes('gold') ? 0x6a5a30 : name.includes('grey') || name.includes('gray') ? 0x2a2c30 : 0x0a4a52;
              mats[i] = new THREE.MeshBasicMaterial({ color: teal });
              continue;
            }
            if (name.includes('cedar') || name.includes('stave') || name.includes('hottub')) {
              mats[i] = new THREE.MeshLambertMaterial({
                color: 0x4a2c16,
                map: src.map ?? null,
              });
              continue;
            }
            if (name.includes('arch') || name.includes('frame') || name.includes('roof') || name.includes('wall') || name.includes('seam') || name.includes('blackmetal') || name.includes('black metal')) {
              mats[i] = new THREE.MeshBasicMaterial({ color: 0x0c0e12 });
              continue;
            }
            if (name.includes('led') || name.includes('violet')) {
              const ledMat = new THREE.MeshStandardMaterial({
                color: 0x1a1040,
                emissive: new THREE.Color(0x4a38ff),
                emissiveIntensity: 0.7,
                roughness: 0.4,
                metalness: 0,
              });
              mats[i] = ledMat;
              ledMats.push(ledMat);
              continue;
            }
            if (name.includes('ember') || name.includes('fireplane') || name.includes('fireglow') || name.includes('stovedoor')) {
              const fireMat = new THREE.MeshStandardMaterial({
                color: 0xff4a12,
                emissive: new THREE.Color(0xff4a12),
                emissiveIntensity: 1.05,
                roughness: 0.45,
              });
              mats[i] = fireMat;
              fireMats.push(fireMat);
              continue;
            }

            if (seen.has(src)) continue;
            seen.add(src);

            if (name.includes('warmlight') || name.includes('sconce')) {
              src.emissive = new THREE.Color(0xffc27a);
              src.emissiveIntensity = 0.28;
              src.color.setHex(0x3a2a18);
            } else if (name.includes('chrome') || name.includes('brass') || name.includes('chain')) {
              src.color.setHex(name.includes('brass') ? 0x5a4020 : 0x2a2c2e);
              src.metalness = 0.72;
              src.roughness = 0.38;
              src.envMapIntensity = 0.28;
            } else if (name.includes('oak') || name.includes('liner') || name.includes('cabinet')) {
              src.color.setHex(0x7a542c);
              src.roughness = 0.74;
              src.metalness = 0;
              src.envMapIntensity = 0.04;
            } else if (name.includes('black') || name.includes('metal')) {
              src.color.setHex(0x101216);
              src.metalness = 0.08;
              src.roughness = 0.62;
              src.envMapIntensity = 0.05;
              src.map = null;
            } else if (name.includes('linen') || name.includes('fur') || name.includes('pillow') || name.includes('sofa')) {
              src.color.setHex(name.includes('fur') ? 0x6a6458 : 0xb4a488);
              src.roughness = 0.9;
              src.metalness = 0;
              src.envMapIntensity = 0.03;
            } else if (name.includes('stone')) {
              src.color.setHex(0x6a665c);
              src.roughness = 0.92;
              src.envMapIntensity = 0.03;
            } else {
              src.envMapIntensity = 0.06;
            }
            src.needsUpdate = true;
          }
          if (Array.isArray(mesh.material)) mesh.material = mats;
          else mesh.material = mats[0];
        });

        model.scale.x = -1;
        root.position.x = X_SHIFT;
        root.add(model);
        root.updateMatrixWorld(true);

        const worldOf = (name: string) => {
          const o = model.getObjectByName(name);
          const p = new THREE.Vector3();
          if (o) o.getWorldPosition(p);
          landmarks[name] = p.toArray();
          return p;
        };

        const tub = worldOf('HotTub');
        const arch = worldOf('Arch');
        const roof = worldOf('CabinRoof');
        const deck = worldOf('DeckSub');
        worldOf('DaybedCushion');

        interior.position.set(roof.x + 0.35, 1.48, roof.z - 0.25);
        cove.position.set(roof.x, 2.05, roof.z + 0.85);
        sofaLamp.position.set(roof.x - 0.7, 1.12, roof.z - 0.1);
        led.position.set(deck.x, 0.08, deck.z);
        fire.position.set(tub.x - 0.55, 0.52, tub.z);
        tubFill.position.set(tub.x + 0.15, 1.22, tub.z - 0.85);
        nestLamp.position.set(arch.x, 2.05, arch.z);
        bay.position.set(roof.x + 0.55, 1.38, 0.12);
        bay.lookAt(roof.x + 0.55, 1.1, -2.2);
        ledBar.position.set(deck.x, 0.04, deck.z - 1.15);
        ledBar.lookAt(deck.x, -1.2, deck.z - 1.15);
        steam.position.set(tub.x + 0.05, 0.95, tub.z - 0.08);

        const blobMat = new THREE.MeshBasicMaterial({
          color: 0x000000,
          transparent: true,
          opacity: 0.28,
          depthWrite: false,
        });
        const putBlob = (x: number, z: number, sx: number, sz: number, op: number) => {
          const m = new THREE.Mesh(new THREE.CircleGeometry(1, 28), blobMat.clone());
          (m.material as THREE.MeshBasicMaterial).opacity = op;
          m.rotation.x = -Math.PI / 2;
          m.position.set(x, 0.012, z);
          m.scale.set(sx, sz, 1);
          scene.add(m);
        };
        putBlob(deck.x, deck.z, 4.2, 2.4, 0.32);
        putBlob(tub.x, tub.z, 1.6, 1.5, 0.28);
        putBlob(arch.x, arch.z, 1.8, 1.8, 0.22);

        const fovBump = narrow ? 6 : 0;
        const cap = (n: number) => Math.min(n + fovBump, 46);
        rebuildPath([
          {
            pos: new THREE.Vector3(tub.x + 1.15, 1.58, tub.z - 6.85),
            look: new THREE.Vector3(arch.x * 0.38 + roof.x * 0.62, 0.92, 0.15),
            fov: cap(32),
          },
          {
            pos: new THREE.Vector3(deck.x + 1.85, 1.08, deck.z - 5.65),
            look: new THREE.Vector3(deck.x - 0.35, 0.52, 0.35),
            fov: cap(32),
          },
          {
            pos: new THREE.Vector3(arch.x + 3.85, 1.22, arch.z - 5.25),
            look: new THREE.Vector3(arch.x + 0.15, 0.98, arch.z + 0.2),
            fov: cap(32),
          },
          {
            pos: new THREE.Vector3(roof.x + 0.85, 1.32, -6.85),
            look: new THREE.Vector3(roof.x + 0.15, 1.18, 0.55),
            fov: cap(30),
          },
          {
            pos: new THREE.Vector3(tub.x + 1.85, 1.92, tub.z - 8.65),
            look: new THREE.Vector3(roof.x - 1.15, 0.95, -0.85),
            fov: cap(32),
          },
        ]);

        const api = {
          size: new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3()).toArray(),
          landmarks,
          cam: () => camera.position.toArray(),
          look: () => camLook.toArray(),
          swing: !!swing,
          setProgress(t: number) {
            rig.progress = THREE.MathUtils.clamp(t, 0, 1);
            placeCamera();
          },
        };
        (window as unknown as { __sanctuary: typeof api }).__sanctuary = api;

        placeCamera();
        resize();
        parent.classList.add('is-ready');
        parent.closest('[data-house-stage]')?.classList.add('is-ready');
        resolve();
      },
      undefined,
      (err) => reject(err),
    );
  });

  const ro = new ResizeObserver(resize);
  ro.observe(parent);

  const io = new IntersectionObserver(
    (entries) => {
      visible = entries.some((e) => e.isIntersecting);
    },
    { threshold: 0.02 },
  );
  io.observe(parent);

  const onPointer = (event: PointerEvent) => {
    const rect = parent.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    rig.pointerTarget.set(
      ((event.clientX - rect.left) / rect.width - 0.5) * 2,
      ((event.clientY - rect.top) / rect.height - 0.5) * -2,
    );
  };
  const onLeave = () => rig.pointerTarget.set(0, 0);
  parent.addEventListener('pointermove', onPointer, { passive: true });
  parent.addEventListener('pointerleave', onLeave);

  resize();
  if (!reduce) tick();
  else {
    placeCamera();
    renderer.render(scene, camera);
  }

  return {
    ready,
    setProgress(t: number) {
      rig.progress = THREE.MathUtils.clamp(t, 0, 1);
      if (reduce) {
        placeCamera();
        renderer.render(scene, camera);
      }
    },
    setPointer(nx: number, ny: number) {
      rig.pointerTarget.set(nx, ny);
    },
    destroy() {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      parent.removeEventListener('pointermove', onPointer);
      parent.removeEventListener('pointerleave', onLeave);
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (!mat) return;
        const list = Array.isArray(mat) ? mat : [mat];
        for (const m of list) {
          const std = m as THREE.MeshStandardMaterial;
          std.map?.dispose();
          m.dispose();
        }
      });
      steamMap.dispose();
      envTex.dispose();
      pmrem.dispose();
      renderer.dispose();
    },
  };
}
