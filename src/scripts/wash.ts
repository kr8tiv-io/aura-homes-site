import * as THREE from 'three';

/** Faint meadow for the cream sections. One fixed canvas, alpha only. */
export function mountWash(canvas: HTMLCanvasElement) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

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

  const treeMat = new THREE.MeshLambertMaterial({
    color: look.tree,
    transparent: true,
    opacity: 0.72,
  });
  materials.push(treeMat);
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
    const geo = new THREE.ConeGeometry(h * look.radius, h, 6);
    geometries.push(geo);
    const tree = new THREE.Mesh(geo, treeMat);
    tree.position.set(x, h / 2, z);
    tree.userData.phase = phase;
    tree.userData.baseX = x;
    scene.add(tree);
    trees.push(tree);
  }

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
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };

  const render = (time = performance.now()) => {
    const lenis = (window as Window & { __lenis?: { scroll?: number } }).__lenis;
    const y = lenis?.scroll ?? window.scrollY;
    if (y < window.innerHeight * 0.82) return;
    resize();
    const t = time * 0.001;
    const drift = progress * 1.6;
    camera.position.set(-0.2 + drift + Math.sin(t * 0.22) * 0.22, 1.45, 8);
    camera.lookAt(drift * 0.2, 3.15, -4);
    for (const tree of trees) {
      const phase = tree.userData.phase as number;
      tree.rotation.z = Math.sin(t * 0.45 + phase) * 0.03;
      tree.position.x = (tree.userData.baseX as number) + Math.sin(t * 0.3 + phase) * 0.08;
    }
    renderer.render(scene, camera);
  };

  render();

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let visible = true;
  const observer = new IntersectionObserver((entries) => {
    visible = entries.some((entry) => entry.isIntersecting);
  });
  observer.observe(canvas);

  let raf = 0;
  const tick = (time: number) => {
    raf = requestAnimationFrame(tick);
    if (!visible || document.hidden) return;
    render(time);
  };
  if (!reduce) raf = requestAnimationFrame(tick);

  return {
    setProgress(t: number) {
      progress = Math.min(Math.max(t, 0), 1);
      if (reduce) render();
    },
    destroy() {
      cancelAnimationFrame(raf);
      observer.disconnect();
      geometries.forEach((geo) => geo.dispose());
      materials.forEach((mat) => mat.dispose());
      renderer.dispose();
    },
  };
}
