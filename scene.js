import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const HALF_X = 10, HALF_Z = 7, WALL_H = 1.5, RIM = 1.6;

function canvasTexture(size, paint, srgb = true) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  paint(g, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// per-pixel noise: base colour +/- amount
function noiseFill(g, size, base, amount) {
  const img = g.createImageData(size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * amount;
    img.data[i] = base[0] + n;
    img.data[i + 1] = base[1] + n;
    img.data[i + 2] = base[2] + n;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
}

function feltMaps() {
  const map = canvasTexture(512, (g, s) => {
    noiseFill(g, s, [18, 82, 52], 46);
    // short fibres
    g.globalAlpha = 0.12;
    for (let i = 0; i < 6000; i++) {
      g.strokeStyle = Math.random() < 0.5 ? '#0b3a22' : '#2c8a5a';
      const x = Math.random() * s, y = Math.random() * s, a = Math.random() * 6.28;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * 4, y + Math.sin(a) * 4); g.stroke();
    }
  });
  const rough = canvasTexture(256, (g, s) => noiseFill(g, s, [235, 235, 235], 40), false);
  for (const t of [map, rough]) t.repeat.set(10, 7);
  return { map, rough };
}

function woodMap() {
  return canvasTexture(512, (g, s) => {
    g.fillStyle = '#4a2512';
    g.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y++) {
      const v = Math.sin(y * 0.15 + Math.sin(y * 0.021) * 5) * 0.5 + 0.5;
      g.fillStyle = `rgba(${20 + v * 50},${8 + v * 20},0,${0.25 + Math.random() * 0.15})`;
      g.fillRect(0, y, s, 1);
    }
  });
}

export function createScene(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x070605);
  scene.fog = new THREE.Fog(0x070605, 35, 70);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.45;

  // camera: ~55 deg above the table
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
  camera.position.set(0, 15, 10.5);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI / 2 - 0.08;
  controls.minDistance = 8;
  controls.maxDistance = 40;
  controls.enablePan = false;
  controls.update();

  // lights: warm key with soft shadow, cool fill
  const key = new THREE.DirectionalLight(0xffe2b8, 3.2);
  key.position.set(7, 22, 9);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -14, right: 14, top: 10, bottom: -10, near: 5, far: 50 });
  key.shadow.radius = 4;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x9db8ff, 0.5);
  fill.position.set(-12, 10, -6);
  scene.add(fill);

  // felt table
  const { map, rough } = feltMaps();
  const felt = new THREE.Mesh(
    new THREE.PlaneGeometry(HALF_X * 2 + RIM * 2, HALF_Z * 2 + RIM * 2),
    new THREE.MeshStandardMaterial({ map, roughnessMap: rough, roughness: 1, bumpMap: rough, bumpScale: 0.6, metalness: 0 })
  );
  felt.rotation.x = -Math.PI / 2;
  felt.receiveShadow = true;
  scene.add(felt);

  // polished wood rim: inner faces at x +/-10, z +/-7
  const wood = woodMap();
  const woodMat = new THREE.MeshPhysicalMaterial({ map: wood, roughness: 0.35, clearcoat: 0.8, clearcoatRoughness: 0.15 });
  const w = HALF_X * 2 + RIM * 2, d = HALF_Z * 2 + RIM * 2;
  for (const [sx, sz, px, pz] of [
    [w, RIM, 0, -(HALF_Z + RIM / 2)], [w, RIM, 0, HALF_Z + RIM / 2],
    [RIM, HALF_Z * 2, -(HALF_X + RIM / 2), 0], [RIM, HALF_Z * 2, HALF_X + RIM / 2, 0],
  ]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, WALL_H, sz), woodMat);
    m.position.set(px, WALL_H / 2, pz);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
  }

  // dark floor under the table, fades into fog
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 200),
    new THREE.MeshStandardMaterial({ color: 0x0c0a09, roughness: 0.9 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.5;
  floor.receiveShadow = true;
  scene.add(floor);

  // portrait screens look along the table's long side; back off until its width (17 units + rim) fits
  function setSize(wd, ht) {
    renderer.setSize(wd, ht);
    camera.aspect = wd / ht;
    camera.updateProjectionMatrix();
    const halfH = Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect);
    const dist = Math.min(controls.maxDistance, Math.max(18.3, 9 / Math.tan(halfH)));
    const dir = camera.aspect < 1 ? new THREE.Vector3(0.574, 0.819, 0) : new THREE.Vector3(0, 0.819, 0.574);
    camera.position.copy(dir.multiplyScalar(dist));
    controls.update();
  }
  setSize(container.clientWidth || window.innerWidth, container.clientHeight || window.innerHeight);

  function render() {
    controls.update();
    renderer.render(scene, camera);
  }

  return { scene, camera, renderer, controls, render, setSize };
}
