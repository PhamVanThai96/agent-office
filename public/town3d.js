// Thị trấn 3D (three.js) cho Agent Office: đảo nổi pastel, 4 khu làm việc, nhân vật chibi nguyên bản.
// Tiết kiệm tài nguyên để chạy nhiều giờ trên MacBook:
//  - vẽ THEO YÊU CẦU: không có agent đang làm và không kéo chuột → vòng lặp dừng hẳn (0% CPU/GPU); có agent làm thì ~30 khung/giây;
//  - toàn bộ cảnh tĩnh gộp thành 2 mesh (vài chục draw call), bóng đổ vẽ MỘT lần (không cập nhật mỗi khung), không hậu kỳ;
//  - độ phân giải vẽ ≤ 1,5× màn hình, powerPreference low-power; dừng khi ẩn tab/ẩn thị trấn; dọn tài nguyên khi mất ngữ cảnh WebGL.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const town = document.getElementById('town');
if (town) init();

function init() {
  const $ = (id) => document.getElementById(id);
  const glBox = $('townGL'), labelBox = $('townLabels'), card = $('townCard');
  const stage = $('stage'), legend = $('legend'), sw = $('viewSw'), loading = $('townLoading');
  const showLoading = () => loading.classList.remove('done');
  const hideLoading = () => loading.classList.add('done');

  let renderer = null, scene = null, camera = null, controls = null;
  let active = false, raf = 0, dirty = true, lastT = 0, selected = '', builtKey = '', failed = false;
  let locked = false;        // cố định góc nhìn (không xoay/zoom/kéo)
  try { locked = localStorage.getItem('ao.town.lock') === '1'; } catch { /* mặc định: không khoá */ }
  let ceo = null;            // nhân vật CEO (người dùng)
  const chars = {};          // id → { group, arms, head, screen, hit, ring, label, say, baseY }
  const hitList = [];
  const ICON = { working: '💻', waiting: '⏳', error: '⚠️', offline: '💤', idle: '' };
  const SAY_MAX = 64;

  // ---------- tiện ích dựng hình ----------
  const mulberry = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const hashStr = (s) => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), V = new THREE.Vector3(), S = new THREE.Vector3(1, 1, 1);

  // Gom nhiều hình (mỗi hình một màu đỉnh) thành một mesh duy nhất.
  class Parts {
    constructor() { this.list = []; }
    add(g, color, pos = [0, 0, 0], rot = [0, 0, 0], scl = [1, 1, 1]) {
      let geo = g.index ? g.toNonIndexed() : g.clone();
      geo.deleteAttribute('uv');
      V.set(pos[0], pos[1], pos[2]); Q.setFromEuler(E.set(rot[0], rot[1], rot[2])); S.set(scl[0], scl[1], scl[2]);
      geo.applyMatrix4(M.compose(V, Q, S));
      const n = geo.attributes.position.count, c = new Float32Array(n * 3), k = new THREE.Color(color);
      for (let i = 0; i < n; i++) { c[i * 3] = k.r; c[i * 3 + 1] = k.g; c[i * 3 + 2] = k.b; }
      geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
      this.list.push(geo);
      if (g.index) g.dispose?.();
      return this;
    }
    mesh(material, shadows = true) {
      const m = new THREE.Mesh(mergeGeometries(this.list, false), material);
      m.castShadow = shadows; m.receiveShadow = true;
      this.list.forEach((g) => g.dispose());
      return m;
    }
  }
  const box = (w, h, d, r = 0.05) => new RoundedBoxGeometry(w, h, d, 2, r);
  const cyl = (rt, rb, h, seg = 20) => new THREE.CylinderGeometry(rt, rb, h, seg);
  const sph = (r, ws = 18, hs = 14) => new THREE.SphereGeometry(r, ws, hs);

  // ---------- nhân vật chibi (nguyên bản) ----------
  const SKIN = ['#ffe0c4', '#f7d2b0', '#ecc19b', '#fbd9c0'];
  const HAIR = ['#3b2a2a', '#5a3b2b', '#2c3550', '#7a4a3a', '#c98f4a', '#4a3a5c', '#283a36', '#8a5a6a'];
  const soft = (hex, t = 0.12) => '#' + new THREE.Color(hex).lerp(new THREE.Color('#ffffff'), t).getHexString();

  function makeCharacter(a, stand = false) {
    const h = hashStr(a.id), skin = SKIN[h % SKIN.length], hair = HAIR[(h >> 3) % HAIR.length], shirt = soft(a.color || '#6a8fd0', 0.1), acc = a.id === 'ceo' ? 'tophat' : a.id === 'manager' ? 'crown' : ['glasses', 'headphones', 'bow', 'cap', 'ahoge', 'none'][(h >> 7) % 6];
    const body = new Parts();
    // thân + cổ áo + chân ngồi
    body.add(new THREE.CapsuleGeometry(0.27, 0.34, 6, 14), shirt, [0, 0.83, 0]);
    body.add(cyl(0.2, 0.2, 0.06), '#ffffff', [0, 1.1, 0.02]);
    for (const sx of [-1, 1]) {
      if (stand) {   // đứng thẳng (CEO): chân dài thẳng xuống sàn
        body.add(box(0.2, 0.5, 0.2, 0.07), '#3a4256', [sx * 0.13, 0.25, 0.02]);
        body.add(box(0.22, 0.1, 0.32, 0.05), '#2b2f3a', [sx * 0.13, 0.05, 0.08]);
      } else {
        body.add(box(0.2, 0.18, 0.55, 0.07), '#4c5a78', [sx * 0.13, 0.58, 0.28]);
        body.add(box(0.2, 0.5, 0.2, 0.07), '#4c5a78', [sx * 0.13, 0.3, 0.55]);
        body.add(box(0.22, 0.1, 0.32, 0.05), '#f4f1ea', [sx * 0.13, 0.05, 0.62]);
      }
    }
    if (acc === 'tophat') { body.add(box(0.1, 0.46, 0.04, 0.02), '#d63b3b', [0, 0.88, 0.27]); body.add(new THREE.ConeGeometry(0.09, 0.14, 4), '#d63b3b', [0, 0.6, 0.27], [Math.PI, 0, 0]); body.add(box(0.5, 0.06, 0.1, 0.02), '#f2b632', [0, 1.12, 0.26]); }
    if (acc === 'crown') body.add(cyl(0.05, 0.05, 0.06), '#f2b632', [0, 1.02, 0.28]);
    // đầu
    const head = new Parts();
    head.add(sph(0.42, 24, 18), skin, [0, 0, 0], [0, 0, 0], [1, 0.96, 0.98]);
    head.add(new THREE.SphereGeometry(0.455, 24, 14, 0, Math.PI * 2, 0, 1.78), hair, [0, 0.03, -0.02], [-0.28, 0, 0]);
    head.add(sph(0.2, 12, 10), hair, [0, 0.27, 0.3], [0, 0, 0], [1.5, 0.55, 0.7]);
    for (const sx of [-1, 1]) {
      head.add(sph(0.16, 10, 8), hair, [sx * 0.37, -0.05, -0.05], [0, 0, 0], [0.8, 1.35, 0.9]);
      head.add(sph(0.062, 12, 10), '#2a2d38', [sx * 0.15, -0.04, 0.37], [0, 0, 0], [0.9, 1.25, 0.6]);
      head.add(sph(0.022, 8, 6), '#ffffff', [sx * 0.135, 0.0, 0.405]);
      head.add(cyl(0.07, 0.07, 0.01, 14), '#ffb3ba', [sx * 0.25, -0.15, 0.33], [Math.PI / 2 - 0.25, 0, 0]);
      head.add(box(0.12, 0.02, 0.02, 0.01), hair, [sx * 0.15, 0.1, 0.39], [0, 0, sx * -0.12]);
    }
    head.add(sph(0.03, 8, 6), '#c4645e', [0, -0.2, 0.405], [0, 0, 0], [1.6, 0.7, 0.5]);
    if (acc === 'glasses') for (const sx of [-1, 1]) head.add(new THREE.TorusGeometry(0.1, 0.014, 8, 20), '#2a2d38', [sx * 0.15, -0.04, 0.39]);
    if (acc === 'glasses') head.add(box(0.07, 0.014, 0.014, 0.005), '#2a2d38', [0, -0.04, 0.4]);
    if (acc === 'headphones') {
      head.add(new THREE.TorusGeometry(0.45, 0.035, 8, 24, Math.PI), '#3a3f4e', [0, 0.02, 0], [0, 0, 0]);
      for (const sx of [-1, 1]) head.add(cyl(0.12, 0.12, 0.08, 16), '#f26d6d', [sx * 0.45, 0.02, 0], [0, 0, Math.PI / 2]);
    }
    if (acc === 'bow') for (const sx of [-1, 1]) head.add(new THREE.ConeGeometry(0.1, 0.2, 10), '#ff8fb0', [sx * 0.15 + 0.2, 0.43, 0.08], [0, 0, sx * -1.35]);
    if (acc === 'cap') { head.add(cyl(0.3, 0.38, 0.2, 20), '#e86a50', [0, 0.38, 0.0]); head.add(box(0.4, 0.04, 0.3, 0.02), '#e86a50', [0, 0.3, 0.38]); }
    if (acc === 'ahoge') { head.add(cyl(0.012, 0.012, 0.3, 6), hair, [0, 0.55, 0.05]); head.add(sph(0.05, 8, 6), '#ffd66b', [0, 0.72, 0.05]); }
    if (acc === 'tophat') { head.add(cyl(0.3, 0.3, 0.42, 20), '#2b2f3a', [0, 0.62, 0]); head.add(cyl(0.45, 0.45, 0.05, 24), '#2b2f3a', [0, 0.42, 0]); head.add(cyl(0.31, 0.31, 0.08, 20), '#d63b3b', [0, 0.5, 0]); head.add(sph(0.06, 8, 6), '#f2b632', [0.3, 0.55, 0.2]); }
    if (acc === 'crown') for (let i = -1; i <= 1; i++) head.add(new THREE.ConeGeometry(0.06, 0.16, 6), '#f2b632', [i * 0.14, 0.52, 0.12]);
    const sleeve = (sx) => new Parts().add(new THREE.CapsuleGeometry(0.085, 0.3, 4, 10), shirt, [0, -0.2, 0]).add(sph(0.095, 10, 8), skin, [0, -0.42, 0]);
    const g = new THREE.Group();
    const bodyMesh = body.mesh(matSmooth), headMesh = head.mesh(matSmooth);
    headMesh.position.set(0, 1.5, 0.02);
    g.add(bodyMesh, headMesh);
    const arms = [-1, 1].map((sx) => { const p = new THREE.Group(); p.position.set(sx * 0.33, 1.02, 0.05); const m = sleeve(sx).mesh(matSmooth); p.add(m); p.rotation.x = stand ? 0 : -1.1; g.add(p); return p; });
    return { group: g, head: headMesh, arms };
  }

  // ---------- vật liệu ----------
  let matSmooth = null, matFlat = null, matGlass = null;

  // ---------- dựng toàn bộ thị trấn ----------
  function roomsOf() { return (typeof cfg !== 'undefined' && cfg.rooms && cfg.rooms.length ? cfg.rooms : ['Khu 1', 'Khu 2', 'Khu 3', 'Khu 4']).slice(0, 4); }
  const ROOM_COLORS = ['#cfe3f7', '#fde6c8', '#e6dcf6', '#d3efdd'];
  const ROOM_ACC = ['#7fb0e8', '#f2a65a', '#a98ae0', '#6cc59a'];
  const ROOM_CTR = [[-5.6, -5.0], [5.6, -5.0], [-5.6, 5.0], [5.6, 5.0]];   // [x, z] tâm từng khu (khu 0,1 phía sau, 2,3 phía gần camera)
  const SEAT_X = [-2.5, 0, 2.5];

  function nameTexture(text, color) {
    const c = document.createElement('canvas'); c.width = 512; c.height = 128;
    const x = c.getContext('2d');
    x.fillStyle = color; x.beginPath(); x.roundRect(6, 14, 500, 100, 40); x.fill();
    x.fillStyle = '#ffffff'; x.font = '700 54px system-ui, -apple-system, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(String(text).toUpperCase().slice(0, 18), 256, 66);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
  }

  function buildWorld(agents) {
    const rnd = mulberry(20261026);
    const smooth = new Parts(), flat = new Parts(), glass = new Parts();
    // đảo nổi
    flat.add(cyl(16.4, 16.4, 0.9, 64), '#9fd18f', [0, -0.45, 0]);
    flat.add(cyl(16.9, 16.9, 0.5, 64), '#86bd7c', [0, -0.95, 0]);
    flat.add(new THREE.ConeGeometry(16.4, 7, 40), '#c9a27a', [0, -4.7, 0], [Math.PI, 0, 0]);
    flat.add(new THREE.ConeGeometry(10, 5, 30), '#b88d68', [0, -7.2, 0], [Math.PI, 0, 0]);
    // quảng trường + lối đi chữ thập
    flat.add(cyl(3.3, 3.3, 0.06, 40), '#efe6d2', [0, 0.03, 0]);
    flat.add(cyl(2.6, 2.6, 0.07, 40), '#e4d7bb', [0, 0.04, 0]);
    flat.add(box(2.2, 0.06, 26, 0.02), '#f1e5c6', [0, 0.03, 0]);
    flat.add(box(26, 0.06, 2.2, 0.02), '#f1e5c6', [0, 0.03, 0]);
    // chỗ đứng của CEO: sát đầu đường phía nam, gần hồ nước (ngoài các khu văn phòng), thảm đỏ + cờ
    flat.add(cyl(1.05, 1.05, 0.05, 32), '#c0392b', [-1.7, 0.04, 12.2]); flat.add(cyl(0.82, 0.82, 0.06, 32), '#e25d4d', [-1.7, 0.05, 12.2]);
    smooth.add(cyl(0.05, 0.06, 3.0, 8), '#c9ced8', [-0.4, 1.5, 11.5]); smooth.add(box(0.05, 0.7, 1.0, 0.02), '#d63b3b', [-0.4, 2.5, 12.0]);
    // đài phun nước
    smooth.add(cyl(1.5, 1.7, 0.5, 28), '#d9dde4', [0, 0.28, 0]);
    smooth.add(cyl(1.25, 1.25, 0.1, 28), '#7cc8ee', [0, 0.52, 0]);
    smooth.add(cyl(0.18, 0.28, 1.4, 12), '#cfd5de', [0, 1.1, 0]);
    smooth.add(cyl(0.7, 0.4, 0.2, 20), '#d9dde4', [0, 1.7, 0]);
    smooth.add(sph(0.26, 14, 10), '#9fdcf5', [0, 2.0, 0]);
    // các khu làm việc
    const rooms = roomsOf(), labels = [];
    rooms.forEach((name, ri) => {
      const [cx, cz] = ROOM_CTR[ri], tint = ROOM_COLORS[ri], acc = ROOM_ACC[ri];
      smooth.add(box(9, 0.34, 8, 0.12), tint, [cx, 0.17, cz]);                         // sàn
      smooth.add(box(9.2, 0.1, 8.2, 0.05), '#ffffff', [cx, 0.02, cz]);                  // viền sàn
      const plain = String(name).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      const openWest = /kiem duyet|insight/.test(plain);   // hai khu này không có vách trái (che tầm nhìn ra quảng trường)
      const WH = 1.25, wy = 0.34 + WH / 2, ty = 0.34 + WH + 0.04;   // vách thấp: nhìn rõ nhân vật phía sau
      smooth.add(box(9, WH, 0.28, 0.08), '#fff6e6', [cx, wy, cz - 4.0]);                // vách sau
      smooth.add(box(9.1, 0.14, 0.4, 0.06), acc, [cx, ty, cz - 4.0]);                    // gờ màu
      if (!openWest) {
        smooth.add(box(0.28, WH, 8, 0.08), '#fff1dc', [cx - 4.5, wy, cz]);               // vách trái
        smooth.add(box(0.4, 0.14, 8.1, 0.06), acc, [cx - 4.5, ty, cz]);
        smooth.add(box(0.5, 1.0, 2.4, 0.05), '#b98354', [cx - 4.2, 0.84, cz - 0.6]);       // kệ sách thấp gắn vách trái
        ['#e8776d', '#f2c14e', '#6fa8e0', '#7cc9a0', '#b48be0'].forEach((c, i) => { for (let r = 0; r < 2; r++) smooth.add(box(0.34, 0.36, 0.22, 0.02), c, [cx - 3.95, 0.66 + r * 0.46, cz - 1.5 + i * 0.5 + (r % 2) * 0.05]); });
      }
      // tranh nhỏ trên vách sau thay cho cửa sổ (vách đã thấp)
      for (const wx of [-2.5, 0, 2.5]) { smooth.add(box(1.0, 0.55, 0.06, 0.03), '#ffffff', [cx + wx, wy + 0.05, cz - 3.84]); glass.add(box(0.82, 0.38, 0.04, 0.02), '#bfe6f7', [cx + wx, wy + 0.05, cz - 3.8]); }
      // thảm tròn + cây chậu + đèn đứng
      flat.add(cyl(1.5, 1.5, 0.04, 28), acc, [cx + 2.8, 0.36, cz + 2.4]);
      smooth.add(cyl(0.3, 0.24, 0.45, 14), '#d9825b', [cx + 3.7, 0.55, cz - 2.9]);
      for (let i = 0; i < 5; i++) smooth.add(sph(0.3 - i * 0.02, 10, 8), i % 2 ? '#6fc287' : '#5bb176', [cx + 3.7 + (rnd() - 0.5) * 0.4, 1.0 + i * 0.22, cz - 2.9 + (rnd() - 0.5) * 0.4]);
      smooth.add(cyl(0.04, 0.04, 1.4, 8), '#8a8f9c', [cx - 3.9, 1.0, cz + 3.0]); smooth.add(sph(0.22, 12, 10), '#ffe9a8', [cx - 3.9, 1.8, cz + 3.0]);
      // bàn làm việc + ghế (mỗi chỗ ngồi)
      SEAT_X.forEach((sx) => {
        const x = cx + sx, z = cz - 0.2;
        smooth.add(box(2.0, 0.12, 0.95, 0.05), '#f0b565', [x, 1.0, z + 0.85]);
        smooth.add(box(0.1, 0.8, 0.8, 0.03), '#d99a47', [x - 0.9, 0.62, z + 0.85]); smooth.add(box(0.1, 0.8, 0.8, 0.03), '#d99a47', [x + 0.9, 0.62, z + 0.85]);
        smooth.add(cyl(0.1, 0.12, 0.28, 10), '#30343f', [x, 1.19, z + 0.85]); smooth.add(box(0.92, 0.6, 0.07, 0.03), '#30343f', [x, 1.65, z + 0.85]);   // chân + khung màn hình
        smooth.add(box(0.55, 0.04, 0.2, 0.02), '#e9e6df', [x - 0.05, 1.08, z + 1.1]);
        smooth.add(cyl(0.07, 0.07, 0.13, 10), '#ffffff', [x + 0.7, 1.12, z + 1.0]);
        smooth.add(cyl(0.34, 0.34, 0.1, 16), acc, [x, 0.72, z - 0.05]); smooth.add(box(0.55, 0.5, 0.1, 0.04), acc, [x, 1.05, z - 0.4]); smooth.add(cyl(0.05, 0.05, 0.4, 8), '#555b69', [x, 0.5, z - 0.05]);   // ghế
      });
      // biển tên khu (treo trên tường sau)
      labels.push({ name, cx, cz, acc });
    });
    // cây kẹo/cây hoa anh đào/bụi cây quanh đảo, tránh khu làm việc và lối đi
    const inRoom = (x, z) => ROOM_CTR.some(([cx, cz]) => Math.abs(x - cx) < 5.4 && Math.abs(z - cz) < 4.8);
    const onPath = (x, z) => Math.abs(x) < 1.7 || Math.abs(z) < 1.7 || Math.hypot(x, z) < 3.6;
    const pastel = ['#8fd19e', '#a7dc9a', '#f4b6cc', '#f6c9a0', '#b7d8f5', '#c9b6ec'];
    let placed = 0;
    for (let i = 0; i < 400 && placed < 26; i++) {
      const ang = rnd() * Math.PI * 2, rad = 3 + rnd() * 12.4, x = Math.cos(ang) * rad, z = Math.sin(ang) * rad;
      if (inRoom(x, z) || onPath(x, z) || Math.hypot(x, z) > 15.2) continue;
      const k = rnd(), s = 0.8 + rnd() * 0.7;
      if (k < 0.45) { flat.add(cyl(0.12 * s, 0.16 * s, 1.1 * s, 7), '#a8764d', [x, 0.55 * s, z]); flat.add(new THREE.IcosahedronGeometry(0.95 * s, 1), pastel[Math.floor(rnd() * 3) + (rnd() < 0.4 ? 3 : 0)], [x, 1.55 * s, z]); }
      else if (k < 0.7) { flat.add(cyl(0.1 * s, 0.14 * s, 1.5 * s, 7), '#b07f56', [x, 0.75 * s, z]); flat.add(sph(0.8 * s, 12, 10), '#f4b6cc', [x, 1.8 * s, z]); flat.add(sph(0.5 * s, 10, 8), '#f8cddd', [x + 0.4 * s, 1.55 * s, z + 0.2 * s]); }
      else if (k < 0.88) { flat.add(new THREE.IcosahedronGeometry(0.55 * s, 1), '#7fc78c', [x, 0.4 * s, z]); flat.add(new THREE.IcosahedronGeometry(0.4 * s, 1), '#95d49d', [x + 0.5 * s, 0.3 * s, z + 0.2]); }
      else { flat.add(new THREE.DodecahedronGeometry(0.5 * s, 0), '#b9bfc9', [x, 0.3 * s, z], [rnd(), rnd(), 0]); }
      placed++;
    }
    // hoa nhỏ rải trên cỏ
    for (let i = 0; i < 70; i++) {
      const ang = rnd() * Math.PI * 2, rad = 3 + rnd() * 12.6, x = Math.cos(ang) * rad, z = Math.sin(ang) * rad;
      if (inRoom(x, z) || onPath(x, z) || Math.hypot(x, z) > 15.6) continue;
      const c = ['#ffd166', '#ff8fa3', '#ffffff', '#b794f4'][Math.floor(rnd() * 4)];
      flat.add(cyl(0.015, 0.015, 0.2, 5), '#6fb36a', [x, 0.1, z]); flat.add(sph(0.075, 7, 6), c, [x, 0.24, z]);
    }
    // ao nước nhỏ có đá và bèo
    flat.add(cyl(2.2, 2.2, 0.06, 32), '#8ed3f0', [-12.4, 0.03, 12.4]); flat.add(cyl(2.5, 2.5, 0.04, 32), '#e9f6ea', [-12.4, 0.02, 12.4]);
    [[-11.2, 13.4], [-13.5, 11.5], [-12.4, 14.4]].forEach(([x, z], i) => flat.add(new THREE.DodecahedronGeometry(0.35 + i * 0.07, 0), '#b9bfc9', [x, 0.25, z], [i, 1, 0]));
    flat.add(cyl(0.4, 0.4, 0.03, 12), '#79c58a', [-13, 0.08, 12.9]);
    // đèn đường và ghế đá dọc lối đi
    [[-1.9, -9], [1.9, 9], [9, 1.9], [-9, -1.9]].forEach(([x, z]) => { smooth.add(cyl(0.05, 0.07, 2.2, 8), '#6b7180', [x, 1.1, z]); smooth.add(sph(0.26, 12, 10), '#ffe08a', [x, 2.35, z]); });
    [[-1.7, 2.4, 0], [1.7, -2.4, Math.PI]].forEach(([x, z, r]) => { smooth.add(box(1.4, 0.12, 0.45, 0.04), '#b98354', [x, 0.5, z], [0, r, 0]); smooth.add(box(1.4, 0.4, 0.08, 0.03), '#b98354', [x, 0.78, z - Math.cos(r) * 0.2], [0, r, 0]); smooth.add(box(0.1, 0.5, 0.4, 0.02), '#8a8f9c', [x - 0.55, 0.25, z], [0, r, 0]); smooth.add(box(0.1, 0.5, 0.4, 0.02), '#8a8f9c', [x + 0.55, 0.25, z], [0, r, 0]); });
    // mây tĩnh và bóng bay
    [[-16, 14, -6], [13, 16, -14], [18, 12, 10], [-9, 15, 16]].forEach(([x, y, z]) => { for (let i = 0; i < 5; i++) glass.add(sph(1.4 - Math.abs(i - 2) * 0.28, 12, 10), '#ffffff', [x + (i - 2) * 1.4, y + (i % 2) * 0.3, z]); });
    [[-12, 6.5, -12, '#ff8fa3'], [12.5, 7.2, 3, '#ffd166'], [3, 6.5, 12.5, '#8fd0ff']].forEach(([x, y, z, c]) => { smooth.add(sph(0.62, 14, 12), c, [x, y, z], [0, 0, 0], [1, 1.2, 1]); smooth.add(cyl(0.008, 0.008, 5.6, 4), '#ffffff', [x, y - 3.4, z]); });

    const group = new THREE.Group();
    group.add(smooth.mesh(matSmooth), flat.mesh(matFlat));
    const gm = glass.mesh(matGlass, false); gm.receiveShadow = false; group.add(gm);
    // biển tên từng khu
    labels.forEach((l) => {
      const spr = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 1.15), new THREE.MeshBasicMaterial({ map: nameTexture(l.name, l.acc), transparent: true, toneMapped: false }));
      spr.position.set(l.cx, 2.55, l.cz - 3.9); group.add(spr);
    });
    return group;
  }

  // ---------- khởi tạo three.js ----------
  function setup() {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power', preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.shadowMap.autoUpdate = false;
    glBox.appendChild(renderer.domElement);
    renderer.domElement.addEventListener('webglcontextlost', (e) => { e.preventDefault(); cancelAnimationFrame(raf); raf = 0; });
    renderer.domElement.addEventListener('webglcontextrestored', () => { renderer.shadowMap.needsUpdate = true; request(); });
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(32, 1, 0.5, 200);
    if (!restoreCam()) resetCamera(false, false);
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false;                  // không quán tính → thả chuột là vòng lặp dừng ngay
    controls.minDistance = 7; controls.maxDistance = 64; controls.minPolarAngle = 0.35; controls.maxPolarAngle = 1.3;
    controls.enablePan = true; controls.screenSpacePanning = false;
    controls.addEventListener('start', () => { userMoved = true; });
    controls.addEventListener('change', () => { clampPan(); request(); });
    applyLock();
    scene.add(new THREE.HemisphereLight(0xffffff, 0xcfe3d4, 1.25));
    const sun = new THREE.DirectionalLight(0xfff1d6, 2.1);
    sun.position.set(14, 22, 10); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
    Object.assign(sun.shadow.camera, { left: -20, right: 20, top: 20, bottom: -20, near: 4, far: 60 });
    scene.add(sun);
    matSmooth = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0 });
    matFlat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, flatShading: true });
    matGlass = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0, emissive: 0xffffff, emissiveIntensity: 0.18 });
    const ro = new ResizeObserver(() => { fitRenderer(); request(); }); ro.observe(town);
    renderer.domElement.addEventListener('pointermove', onHover);
    renderer.domElement.addEventListener('click', onClick);
  }
  // Tự canh khung: tìm điểm nhìn + khoảng cách để toàn bộ nhóm điểm (khu văn phòng, hoặc cả đảo khi cố định góc xa) nằm gọn giữa khung,
  // với mọi tỉ lệ khung hình (không còn lệch xuống dưới hay bị cắt).
  const DIR = new THREE.Vector3(0.58, 0.54, 0.66).normalize();
  let nearPts = null, farPts = null, userMoved = false;
  function framePoints(far) {
    if (far) {
      if (!farPts) { farPts = []; for (let i = 0; i < 28; i++) { const t = (i / 28) * Math.PI * 2; farPts.push(new THREE.Vector3(Math.cos(t) * 15.8, -0.9, Math.sin(t) * 15.8)); } farPts.push(new THREE.Vector3(-1.7, 3.8, 12.2), new THREE.Vector3(0, 4.5, 0)); }
      return farPts;
    }
    if (!nearPts) { nearPts = []; for (const [cx, cz] of ROOM_CTR) for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (const y of [0.1, 2.4]) nearPts.push(new THREE.Vector3(cx + sx * 4.7, y, cz + sz * 4.2)); }
    return nearPts;
  }
  function frameCamera(far) {
    if (!camera) return;
    const pts = framePoints(far), margin = far ? 0.9 : 0.86, aspect = camera.aspect || 1.5, vh = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const target = new THREE.Vector3(); pts.forEach((p) => target.add(p)); target.multiplyScalar(1 / pts.length);
    let dist = 34;
    const right = new THREE.Vector3(), up = new THREE.Vector3(), v = new THREE.Vector3();
    for (let i = 0; i < 30; i++) {
      camera.position.copy(target).addScaledVector(DIR, dist); camera.lookAt(target); camera.updateMatrixWorld(); camera.updateProjectionMatrix();
      let minX = 9, maxX = -9, minY = 9, maxY = -9;
      for (const p of pts) { v.copy(p).project(camera); minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x); minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y); }
      const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, ex = (maxX - minX) / 2, ey = (maxY - minY) / 2;
      right.setFromMatrixColumn(camera.matrixWorld, 0); up.setFromMatrixColumn(camera.matrixWorld, 1);
      target.addScaledVector(right, cx * vh * aspect * dist).addScaledVector(up, cy * vh * dist);
      dist = Math.min(60, Math.max(12, dist * Math.max(ex, ey) / margin));
    }
    camera.position.copy(target).addScaledVector(DIR, dist); camera.lookAt(target);
    if (controls) { controls.target.copy(target); controls.update(); }
  }
  // Đang cố định: khôi phục đúng góc nhìn/zoom đã lưu lúc bấm cố định.
  function restoreCam() {
    if (!locked) return false;
    try { const c = JSON.parse(localStorage.getItem('ao.town.cam') || 'null'); if (Array.isArray(c) && c.length === 6 && c.every(Number.isFinite)) { camera.position.set(c[0], c[1], c[2]); camera.lookAt(c[3], c[4], c[5]); if (controls) { controls.target.set(c[3], c[4], c[5]); controls.update(); } userMoved = true; return true; } } catch { /* bỏ qua */ }
    return false;
  }
  function resetCamera(redraw = true, far = false) {
    if (!camera) return;
    userMoved = false;
    frameCamera(far);
    if (redraw) request();
  }
  function clampPan() { const t = controls.target; const r = Math.hypot(t.x, t.z); if (r > 14) { t.x *= 14 / r; t.z *= 14 / r; } }
  function fitRenderer() {
    if (!renderer) return;
    const w = glBox.clientWidth || town.clientWidth, h = glBox.clientHeight || town.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false); renderer.domElement.style.width = w + 'px'; renderer.domElement.style.height = h + 'px';
    camera.aspect = w / h; camera.updateProjectionMatrix();
    if (!userMoved && !locked) frameCamera(false);
  }

  // ---------- dựng danh sách agent ----------
  function build(agents) {
    const key = JSON.stringify(agents.map((a) => [a.id, a.name, a.room, a.color])) + JSON.stringify(typeof cfg !== 'undefined' ? cfg.rooms : '');
    if (key === builtKey) return;
    builtKey = key;
    if (failed) return;
    showLoading();
    if (!renderer) { try { setup(); } catch (e) { failed = true; console.warn('[town3d] không khởi tạo được WebGL:', e.message); hideLoading(); if (active) setView(false); return; } }
    // dọn cảnh cũ
    for (const o of [...scene.children]) if (o.userData.town) { scene.remove(o); o.traverse((n) => { n.geometry?.dispose(); if (n.material?.map) n.material.map.dispose(); if (n.material && n.material !== matSmooth && n.material !== matFlat && n.material !== matGlass) n.material.dispose(); }); }
    labelBox.replaceChildren(); hitList.length = 0; ceo = null; for (const k of Object.keys(chars)) delete chars[k];
    const world = buildWorld(agents); world.userData.town = true; scene.add(world);
    // nhân vật theo khu
    const rooms = roomsOf(), used = {};
    const seatsGroup = new THREE.Group(); seatsGroup.userData.town = true; scene.add(seatsGroup);
    agents.forEach((a) => {
      const ri = Math.max(0, rooms.indexOf(a.room)), n = used[ri] = (used[ri] || 0);
      if (n >= SEAT_X.length) return;
      used[ri]++;
      const [cx, cz] = ROOM_CTR[ri], ch = makeCharacter(a);
      ch.group.position.set(cx + SEAT_X[n], 0.34, cz - 0.2);
      ch.group.rotation.y = -0.18; ch.group.scale.setScalar(1.18);
      ch.group.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.5), new THREE.MeshStandardMaterial({ color: 0x3a4660, emissive: 0x2a3550, emissiveIntensity: 0.6, roughness: 0.4 }));
      screen.position.set(cx + SEAT_X[n], 1.67, cz - 0.2 + 0.85 - 0.04); screen.rotation.y = Math.PI;
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.05, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color(a.color || '#6a8fd0'), transparent: true, opacity: 0.9 }));
      ring.rotation.x = -Math.PI / 2; ring.position.set(cx + SEAT_X[n], 0.4, cz - 0.1); ring.visible = false;
      const hit = new THREE.Mesh(new THREE.BoxGeometry(1.3, 2.4, 1.3), new THREE.MeshBasicMaterial({ visible: false }));
      hit.position.set(cx + SEAT_X[n], 1.5, cz - 0.1); hit.userData.agent = a.id;
      seatsGroup.add(ch.group, screen, ring, hit); hitList.push(hit);
      const label = document.createElement('div'); label.className = 'tlabel'; label.textContent = a.name; label.style.setProperty('--c', a.color || '#6a8fd0');
      const say = document.createElement('div'); say.className = 'tsay'; say.hidden = true; say.style.setProperty('--c', a.color || '#6a8fd0');
      labelBox.append(say, label);
      label.onclick = () => select(a.id);
      chars[a.id] = { ...ch, screen, ring, hit, label, say, base: ch.group.position.clone() };
    });
    // CEO (người dùng): nhân vật đứng vẫy tay ở quảng trường; bấm vào để giao việc
    const cm = makeCharacter({ id: 'ceo', name: 'CEO', color: '#c0392b' }, true);
    cm.group.position.set(-1.7, 0.08, 12.2); cm.group.rotation.y = 1.1; cm.group.scale.setScalar(1.3);
    cm.group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    cm.arms[1].rotation.z = -2.5; cm.arms[0].rotation.z = 0.12;
    const chit = new THREE.Mesh(new THREE.BoxGeometry(1.5, 2.8, 1.5), new THREE.MeshBasicMaterial({ visible: false }));
    chit.position.set(-1.7, 1.6, 12.2); chit.userData.agent = 'ceo';
    seatsGroup.add(cm.group, chit); hitList.push(chit);
    const clabel = document.createElement('div'); clabel.className = 'tlabel ceo'; clabel.textContent = '🎩 CEO (bạn)'; clabel.style.setProperty('--c', '#c0392b');
    const csay = document.createElement('div'); csay.className = 'tsay'; csay.hidden = true; csay.style.setProperty('--c', '#c0392b');
    labelBox.append(csay, clabel); clabel.onclick = () => select('ceo');
    ceo = { ...cm, label: clabel, say: csay, hit: chit, base: cm.group.position.clone() };
    renderer.shadowMap.needsUpdate = true;   // vẽ lại bóng đúng MỘT lần sau khi dựng
    fitRenderer(); refresh(); request();
    for (const ms of [120, 500]) setTimeout(() => { fitRenderer(); request(); }, ms);   // vẽ lại sau khi bố cục ổn định
  }

  // ---------- vòng lặp vẽ theo yêu cầu ----------
  const proj = new THREE.Vector3();
  function placeLabels() {
    const w = glBox.clientWidth, h = glBox.clientHeight;
    for (const c of [...Object.values(chars), ...(ceo ? [ceo] : [])]) {
      proj.set(c.base.x, c.base.y + (c === ceo ? 3.5 : 2.55), c.base.z).project(camera);
      const x = (proj.x * 0.5 + 0.5) * w, y = (-proj.y * 0.5 + 0.5) * h, vis = proj.z < 1;
      c.label.style.transform = `translate(-50%,-100%) translate(${x.toFixed(1)}px,${y.toFixed(1)}px)`;
      c.say.style.transform = `translate(-50%,-100%) translate(${x.toFixed(1)}px,${(y - 26).toFixed(1)}px)`;
      c.label.style.display = vis ? '' : 'none';
    }
  }
  const busy = () => Object.keys(chars).some((id) => { const s = typeof info !== 'undefined' && info[id]?.status; return s === 'working' || s === 'waiting'; });
  function animate(t) {
    const sec = t / 1000;
    if (ceo) { ceo.arms[1].rotation.z = -2.5 + Math.sin(sec * 5) * 0.25; ceo.head.rotation.z = Math.sin(sec * 1.6) * 0.06; }
    for (const id of Object.keys(chars)) {
      const c = chars[id], s = (typeof info !== 'undefined' && info[id]?.status) || 'idle';
      if (s === 'working') {
        c.arms[0].rotation.x = -1.15 + Math.sin(sec * 11) * 0.12; c.arms[1].rotation.x = -1.15 + Math.sin(sec * 11 + 2) * 0.12;
        c.head.rotation.x = Math.sin(sec * 2.2) * 0.05; c.group.position.y = c.base.y + Math.abs(Math.sin(sec * 2.2)) * 0.015;
      } else if (s === 'waiting') {
        c.head.rotation.z = Math.sin(sec * 3) * 0.08; c.arms[0].rotation.x = c.arms[1].rotation.x = -1.1;
      } else { c.head.rotation.set(0, 0, 0); c.arms[0].rotation.x = c.arms[1].rotation.x = -1.1; c.group.position.y = c.base.y; }
    }
  }
  function frame(t) {
    raf = 0;
    if (!active || document.hidden || !renderer) return;
    const animating = busy() && !still;
    if (animating && !dirty && t - lastT < 32) { raf = requestAnimationFrame(frame); return; }   // ~30 khung/giây khi đang có agent làm việc
    lastT = t;
    if (animating) animate(t); else if (dirty) animate(t);
    renderer.render(scene, camera);
    placeLabels();
    hideLoading();
    dirty = false;
    if (animating) raf = requestAnimationFrame(frame);
  }
  // Yêu cầu vẽ lại. Ngoài requestAnimationFrame còn có đường dự phòng 150ms: nếu trình duyệt trì hoãn rAF (tab nền, khung chưa được ghép) thì vẫn vẽ
  // được khung hiện tại, nên cảnh luôn hiện và biểu tượng loading luôn tắt.
  let fallback = 0;
  function request() {
    dirty = true;
    if (!active || !renderer || document.hidden) return;
    if (!raf) raf = requestAnimationFrame(frame);
    clearTimeout(fallback);
    fallback = setTimeout(() => { if (dirty && active && renderer && !document.hidden) { cancelAnimationFrame(raf); raf = 0; frame(performance.now()); } }, 150);
  }

  // ---------- tương tác ----------
  const ray = new THREE.Raycaster(), pt = new THREE.Vector2();
  function pick(e) {
    const r = renderer.domElement.getBoundingClientRect();
    pt.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(pt, camera);
    return ray.intersectObjects(hitList, false)[0]?.object.userData.agent || '';
  }
  let hoverTimer = 0;
  function onHover(e) { if (hoverTimer || e.buttons) return; hoverTimer = setTimeout(() => { hoverTimer = 0; }, 80); renderer.domElement.style.cursor = pick(e) ? 'pointer' : (locked ? 'default' : 'grab'); }
  function onClick(e) { const id = pick(e); if (id) select(id); }

  // ---------- HUD, thẻ agent, thanh chọn ----------
  function refresh() {
    if (typeof info === 'undefined') return;
    const counts = { working: 0, waiting: 0, idle: 0, error: 0 };
    for (const id of Object.keys(chars)) {
      const s = info[id]?.status || 'idle', c = chars[id];
      if (counts[s] !== undefined) counts[s]++; else if (s === 'offline') counts.idle++;
      const rep = info[id]?.report || '', showSay = (s === 'working' || s === 'waiting') && rep;
      c.say.hidden = !showSay; c.say.textContent = showSay ? `${ICON[s] || ''} ${rep.replace(/\s+/g, ' ').slice(0, SAY_MAX)}${rep.length > SAY_MAX ? '…' : ''}` : '';
      c.label.classList.toggle('off', s === 'offline'); c.label.dataset.st = s;
      const lit = s === 'working';
      c.screen.material.color.setHex(lit ? 0x8ff0bd : s === 'error' ? 0xe0524d : s === 'offline' ? 0x20242c : 0x3a4660);
      c.screen.material.emissive.setHex(lit ? 0x4ede98 : s === 'error' ? 0xa02a25 : s === 'offline' ? 0x000000 : 0x2a3550);
      c.screen.material.emissiveIntensity = lit ? 0.9 : 0.5;
      c.ring.visible = id === selected;
    }
    if (ceo) { const n = counts.working + counts.waiting; ceo.say.hidden = !n; ceo.say.textContent = n ? `👀 Đang theo dõi ${n} agent làm việc` : ''; }
    if (selected) fillCard(selected);
    request();
  }
  const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  function select(id) {
    selected = id; card.hidden = false; refresh();
  }
  function fillCard(id) {
    if (id === 'ceo') {
      card.replaceChildren();
      const x = mk('button', 'x', '×'); x.onclick = () => { selected = ''; card.hidden = true; refresh(); };
      const go = mk('a', 'pb', '📄 Xem báo cáo'); go.href = 'reports/'; go.target = '_blank'; go.rel = 'noopener';
      card.append(x, mk('h5', '', 'CEO (bạn)'), mk('div', 'r', 'Người giao việc cho Content Lead và duyệt kết quả.'), mk('div', 'rep', 'Mở danh sách báo cáo đã hoàn thành của team (theo tháng, có tìm kiếm và tải về).'), go);
      return;
    }
    const m = (typeof meta !== 'undefined' && meta[id]) || {}, st = info[id] || { status: 'idle', report: '' };
    card.replaceChildren();
    const x = mk('button', 'x', '×'); x.onclick = () => { selected = ''; card.hidden = true; refresh(); };
    const ed = mk('button', 'pb', '✎ Sửa'); ed.onclick = () => openEditor(id);
    card.append(x, mk('h5', '', m.name || id), mk('div', 'r', `#${id} · ${m.role || ''} · ${STATUS[st.status] || st.status}`),
      mk('div', 'r', `${m.skills?.length ? 'Skill: ' + m.skills.join(', ') + ' · ' : ''}AI: ${m.ai || ''}`), mk('div', 'rep', st.report || 'Chưa có báo cáo.'), ed);
  }

  // ---------- công tắc 2D/3D, dừng chuyển động ----------
  let still = false;
  try { still = !!localStorage.getItem('ao.town.still'); } catch { /* bỏ qua */ }
  const lockBox = $('townLock'), fixBtn = $('townFix');
  const paintLock = () => { if (lockBox) lockBox.checked = locked; if (fixBtn) { fixBtn.textContent = locked ? '🔓 Bỏ cố định góc nhìn' : '🔒 Cố định góc nhìn'; fixBtn.classList.toggle('on', locked); } if (controls) controls.enabled = !locked; if (renderer) renderer.domElement.style.cursor = locked ? 'default' : 'grab'; };
  // Bật cố định: về góc nhìn xa rồi khoá; tắt: mở khoá tại chỗ.
  const saveCam = () => { try { localStorage.setItem('ao.town.cam', JSON.stringify([...camera.position.toArray(), ...controls.target.toArray()].map((n) => +n.toFixed(3)))); } catch { /* bỏ qua */ } };
  const setLocked = (v) => { locked = v; try { localStorage.setItem('ao.town.lock', v ? '1' : '0'); } catch { /* bỏ qua */ } if (v && camera) saveCam(); paintLock(); };
  if (lockBox) lockBox.onchange = () => setLocked(lockBox.checked);
  if (fixBtn) fixBtn.onclick = () => setLocked(!locked);
  const applyLock = paintLock;
  const stillBtn = $('townStill');
  const paintStill = () => { stillBtn.textContent = still ? '▶ Bật chuyển động' : '⏸ Dừng chuyển động'; };
  paintStill();
  stillBtn.onclick = () => { still = !still; paintStill(); try { localStorage.setItem('ao.town.still', still ? '1' : ''); } catch { /* bỏ qua */ } if (!still) request(); };

  function setView(v3d) {
    active = v3d && !failed; town.hidden = !active; stage.hidden = active; legend.hidden = active;
    for (const b of sw.children) b.classList.toggle('on', (b.dataset.v === '3d') === active);
    try { localStorage.setItem('ao.view', active ? '3d' : '2d'); } catch { /* bỏ qua */ }
    if (active) { showLoading(); pendingAgents = window.aoAgents || pendingAgents; if (pendingAgents) build(pendingAgents); fitRenderer(); refresh(); request(); }
    else { cancelAnimationFrame(raf); raf = 0; }
  }
  for (const b of sw.children) b.onclick = () => { setView(b.dataset.v === '3d'); const d = document.getElementById('offDlg'); if (d?.open) d.close(); };
  document.addEventListener('visibilitychange', () => { if (active && !document.hidden) { refresh(); request(); } });

  // app.js gọi khi dựng lại danh sách agent / đổi trạng thái (chỉ dựng cảnh 3D khi đang xem, để không tốn GPU/RAM lúc ở chế độ 2D)
  let pendingAgents = window.aoAgents || null;   // app.js có thể đã dựng xong danh sách trước khi module này nạp
  window.townBuild = (agents) => { pendingAgents = agents; if (active) build(agents); else builtKey = ''; };
  window.townRefresh = () => { if (active) refresh(); };
  window.addEventListener('resize', () => { if (active) { fitRenderer(); request(); } });
  window.townReady = true;
  try { if (window.__townWant || localStorage.getItem('ao.view') === '3d') setTimeout(() => setView(true), 0); } catch { if (window.__townWant) setView(true); }
}
