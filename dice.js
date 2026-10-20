import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export const DIE_TYPES = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20'];

const PHI = (1 + Math.sqrt(5)) / 2;
const TILE = 256; // texture px per face
const RADIUS = { d4: 0.8, d8: 0.8, d10: 0.9, d12: 0.95, d20: 0.95 }; // circumradius, units
const V = (a) => new THREE.Vector3(...a);
const UP = new THREE.Vector3(0, 1, 0);

// ---- solids: vertices + faces (vertex index lists) -------------------------------------------

// faces = for each direction, the vertices farthest along it
const byNormals = (verts, normals) =>
  normals.map((n) => {
    const d = verts.map((v) => v.dot(n));
    const max = Math.max(...d);
    return d.flatMap((x, i) => (x > max - 1e-3 ? [i] : []));
  });

function solid(type) {
  let verts, faces;
  if (type === 'd4') {
    verts = [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]].map(V);
    faces = byNormals(verts, verts.map((v) => v.clone().negate())); // face opposite vertex i
  } else if (type === 'd8') {
    verts = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].map(V);
    const ns = [];
    for (const x of [1, -1]) for (const y of [1, -1]) for (const z of [1, -1]) ns.push(V([x, y, z]));
    faces = byNormals(verts, ns);
  } else if (type === 'd10') {
    // pentagonal trapezohedron; a makes the kites planar (see derivation: h = a(1+c)/(1-c), h = 1)
    const c = Math.cos(Math.PI / 5), a = (1 - c) / (1 + c);
    verts = [V([0, 1, 0]), V([0, -1, 0])];
    for (let k = 0; k < 10; k++) verts.push(V([Math.cos(k * Math.PI / 5), k % 2 ? -a : a, Math.sin(k * Math.PI / 5)]));
    const r = (k) => 2 + (k % 10);
    faces = [];
    for (let j = 0; j < 10; j += 2) {
      faces.push([0, r(j), r(j + 1), r(j + 2)]); // apex first: numbers point at it
      faces.push([1, r(j + 1), r(j + 2), r(j + 3)]);
    }
  } else {
    const ico = [];
    for (const s1 of [1, -1]) for (const s2 of [1, -1]) {
      const [a, b, c] = [0, s1, s2 * PHI];
      ico.push(V([a, b, c]), V([c, a, b]), V([b, c, a]));
    }
    const tris = [];
    for (let i = 0; i < 12; i++) for (let j = i + 1; j < 12; j++) for (let k = j + 1; k < 12; k++) {
      const edge = (p, q) => Math.abs(ico[p].distanceToSquared(ico[q]) - 4) < 1e-3;
      if (edge(i, j) && edge(j, k) && edge(i, k)) tris.push(V([0, 0, 0]).add(ico[i]).add(ico[j]).add(ico[k]));
    }
    // d12 is the dual: vertices = icosahedron face centres, faces = around each icosahedron vertex
    [verts, faces] = type === 'd20' ? [ico, byNormals(ico, tris)] : [tris, byNormals(tris, ico)];
  }
  const k = RADIUS[type] / Math.max(...verts.map((v) => v.length()));
  verts.forEach((v) => v.multiplyScalar(k));
  return { verts, faces };
}

// opposite faces sum to N+1
function pairValues(ns) {
  const val = ns.map(() => 0);
  let v = 1;
  ns.forEach((n, i) => {
    if (val[i]) return;
    val[i] = v;
    val[ns.findIndex((m, j) => !val[j] && m.dot(n) < -0.999)] = ns.length + 1 - v;
    v++;
  });
  return val;
}

// ---- textures --------------------------------------------------------------------------------

// tiles[i] = marks of tile i, relative to tile centre: {x, y, a, t, fs} text or {x, y, r} pip
function makeTex(tiles, cols, rows, bg, fg, srgb) {
  if (typeof document === 'undefined') return null; // headless (selfCheck under node)
  const cv = document.createElement('canvas');
  cv.width = cols * TILE;
  cv.height = rows * TILE;
  const g = cv.getContext('2d');
  g.fillStyle = bg;
  g.fillRect(0, 0, cv.width, cv.height);
  g.fillStyle = fg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = fg;
  g.shadowBlur = 3; // soft engraved edge
  tiles.forEach((marks, i) => {
    for (const m of marks) {
      g.save();
      g.translate((i % cols + 0.5) * TILE + m.x, (Math.floor(i / cols) + 0.5) * TILE + m.y);
      g.rotate(m.a || 0);
      if (m.t) {
        g.font = `bold ${m.fs}px Arial, sans-serif`;
        g.fillText(m.t, 0, 0);
        if (m.t === '6' || m.t === '9') g.fillRect(-g.measureText(m.t).width / 2, m.fs * 0.42, g.measureText(m.t).width, m.fs * 0.07);
      } else {
        g.beginPath();
        g.arc(0, 0, m.r, 0, Math.PI * 2);
        g.fill();
      }
      g.restore();
    }
  });
  const t = new THREE.CanvasTexture(cv);
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// resin look: glossy clearcoat, engraved marks via bumpMap
function material(tiles, cols, rows, color, ink) {
  const map = makeTex(tiles, cols, rows, color, ink, true);
  return new THREE.MeshPhysicalMaterial({
    color: map ? 0xffffff : color,
    map,
    bumpMap: makeTex(tiles, cols, rows, '#fff', '#000'),
    bumpScale: 2,
    roughness: 0.25,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
    ior: 1.5,
  });
}

// ---- dice ------------------------------------------------------------------------------------

const PIPS = [[], [[0, 0]], [[-1, -1], [1, 1]], [[-1, -1], [0, 0], [1, 1]],
  [[-1, -1], [1, -1], [-1, 1], [1, 1]], [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
  [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]]];
// BoxGeometry group order +x -x +y -y +z -z; opposite faces sum to 7
const FACES6 = [[[1, 0, 0], 3], [[-1, 0, 0], 4], [[0, 1, 0], 1], [[0, -1, 0], 6], [[0, 0, 1], 2], [[0, 0, -1], 5]];

function cube(color, ink, size) {
  const mats = FACES6.map(([, v]) => material([PIPS[v].map(([x, y]) => ({ x: x * 0.26 * TILE, y: y * 0.26 * TILE, r: 0.09 * TILE }))], 1, 1, color, ink));
  return {
    geometry: new RoundedBoxGeometry(size, size, size, 4, 0.09 * size),
    mat: mats,
    shape: new CANNON.Box(new CANNON.Vec3(size / 2, size / 2, size / 2)),
    reads: FACES6.map(([n, value]) => ({ n: V(n), value })),
  };
}

function polyhedron(type, color, ink, size) {
  const { verts, faces } = solid(type);
  verts.forEach((v) => v.multiplyScalar(size));
  const N = faces.length;
  const cols = Math.ceil(Math.sqrt(N)), rows = Math.ceil(N / cols);

  // per face: centroid, outward normal, 2D frame (u, w) on the face plane, vertices sorted CCW from outside
  const fd = faces.map((idx) => {
    const pts = idx.map((i) => verts[i]);
    const c = pts.reduce((s, p) => s.add(p), new THREE.Vector3()).divideScalar(pts.length);
    const n = new THREE.Vector3().crossVectors(pts[1].clone().sub(pts[0]), pts[2].clone().sub(pts[0])).normalize();
    if (n.dot(c) < 0) n.negate();
    const ref = Math.abs(n.y) < 0.9 ? UP : V([1, 0, 0]);
    const u = ref.clone().addScaledVector(n, -ref.dot(n)).normalize();
    const w = new THREE.Vector3().crossVectors(n, u);
    const p2 = (i) => { const d = verts[i].clone().sub(c); return { x: d.dot(u), y: d.dot(w) }; };
    const order = idx.slice().sort((i, j) => Math.atan2(p2(i).y, p2(i).x) - Math.atan2(p2(j).y, p2(j).x));
    return { idx, order, n, p2, R: Math.max(...idx.map((i) => Math.hypot(p2(i).x, p2(i).y))) };
  });

  // d4 reads the top vertex; others read the top face
  const reads = type === 'd4'
    ? verts.map((v, i) => ({ n: v.clone().normalize(), value: i + 1 }))
    : pairValues(fd.map((f) => f.n)).map((value, i) => ({ n: fd[i].n, value }));

  const up = (p) => Math.atan2(-p.y, p.x) + Math.PI / 2; // rotation taking canvas "up" toward p
  const tiles = fd.map((f, i) => {
    const s = (0.47 * TILE) / f.R;
    if (type === 'd4') {
      return f.idx.map((vi) => { const p = f.p2(vi); return { x: p.x * s * 0.55, y: -p.y * s * 0.55, a: up(p), t: String(vi + 1), fs: f.R * s * 0.3 }; });
    }
    const label = String(reads[i].value % 10 || (type === 'd10' ? 0 : reads[i].value)); // d10 shows 0 for 10
    const k = { 3: 0.65, 4: 0.5, 5: 0.7 }[f.idx.length] * (label.length > 1 ? 0.8 : 1);
    return [{ x: 0, y: 0, a: up(f.p2(f.idx[0])), t: type === 'd10' ? label : String(reads[i].value), fs: f.R * s * k }];
  });

  const pos = [], uv = [], nor = [];
  fd.forEach((f, fi) => {
    const s = (0.47 * TILE) / f.R;
    const put = (i) => {
      const v = verts[i], p = f.p2(i);
      pos.push(v.x, v.y, v.z);
      uv.push(((fi % cols + 0.5) * TILE + p.x * s) / (cols * TILE), 1 - ((Math.floor(fi / cols) + 0.5) * TILE - p.y * s) / (rows * TILE));
      const nv = f.n.clone().addScaledVector(v.clone().normalize(), 0.3).normalize(); // fake rounded edges
      nor.push(nv.x, nv.y, nv.z);
    };
    for (let t = 1; t < f.order.length - 1; t++) [f.order[0], f.order[t], f.order[t + 1]].forEach(put);
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));

  return {
    geometry,
    mat: material(tiles, cols, rows, color, ink),
    shape: new CANNON.ConvexPolyhedron({
      vertices: verts.map((v) => new CANNON.Vec3(v.x, v.y, v.z)),
      faces: fd.map((f) => f.order),
    }),
    reads,
  };
}

export function createDie(type, { color = '#b3121f', inkColor = '#f5f0e6', size = 1 } = {}) {
  if (!DIE_TYPES.includes(type)) throw new Error(`unknown die type ${type}`);
  const { geometry, mat, shape, reads } = (type === 'd6' ? cube : polyhedron.bind(null, type))(color, inkColor, size);
  const mesh = new THREE.Mesh(geometry, mat);
  mesh.castShadow = mesh.receiveShadow = true;
  const qt = new THREE.Quaternion(), tmp = new THREE.Vector3();
  // [value, how straight it points up]: 1 = flat on the table, lower = cocked against a wall or die
  const top = (q) => {
    qt.set(q.x, q.y, q.z, q.w);
    let best = -2, value = 0;
    for (const r of reads) {
      const y = tmp.copy(r.n).applyQuaternion(qt).y;
      if (y > best) [best, value] = [y, r.value];
    }
    return [value, best];
  };
  const readValue = (q) => top(q)[0];
  const upDot = (q) => top(q)[1];
  return { type, mesh, shape, mass: size ** 3, readValue, upDot, reads };
}

// every face up must read its own value, values must be exactly 1..N
export function selfCheck() {
  for (const type of DIE_TYPES) {
    const die = createDie(type);
    const q = new THREE.Quaternion();
    for (const { n, value } of die.reads) {
      const got = die.readValue(q.setFromUnitVectors(n, UP));
      if (got !== value) throw new Error(`${type}: face value ${value} read as ${got}`);
    }
    const seen = die.reads.map((r) => r.value).sort((a, b) => a - b).join();
    const want = Array.from({ length: die.reads.length }, (_, i) => i + 1).join();
    if (seen !== want) throw new Error(`${type}: values ${seen}, expected ${want}`);
  }
  return true;
}
