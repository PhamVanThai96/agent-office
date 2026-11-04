// Agent Office: đường nối nét đứt mảnh giữa hai agent khi giao việc / bàn giao / hỏi đáp (bridge.js gọi window.__officeLink).
// Một đường cong nhẹ từ đầu người giao tới đầu người nhận, màu theo loại tin, mờ dần sau vài giây rồi biến mất.
import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { renderer, scene } from '../scene/renderer.js';
import { workers } from './workers.js';
import { DOOR_IN } from './navigation.js';

const COLOR = { command: '#B9C4D6', assign: '#F2B544', handoff: '#6AAEFF', question: '#FF9A5C', answer: '#3DDC84', report: '#2DD4BF', revise: '#FF5F5F', final: '#EF8A5F' };
const TTL = 7, FADE = 1.6, SEG = 28, HEAD = 1.75;
const links = [];
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _p = new THREE.Vector3();

function endpoint(id, out) {
  const w = workers.get(id);
  if (w) return out.set(w.pos.x, HEAD, w.pos.y);
  if (id === 'user' && DOOR_IN) return out.set(DOOR_IN.x, HEAD, DOOR_IN.z);   // (CEO: ở cửa vào, không có nhân vật)
  return null;
}
const _pts = new Float32Array((SEG + 1) * 3), _res = new THREE.Vector2();
function shape(l) {
  if (!endpoint(l.from, _a) || !endpoint(l.to, _b)) return false;
  const lift = 0.5 + 0.1 * _a.distanceTo(_b);
  for (let i = 0; i <= SEG; i++) {
    const t = i / SEG;
    _p.lerpVectors(_a, _b, t); _p.y += Math.sin(Math.PI * t) * lift;
    _pts[i * 3] = _p.x; _pts[i * 3 + 1] = _p.y; _pts[i * 3 + 2] = _p.z;
  }
  l.line.geometry.setPositions(_pts); l.line.computeLineDistances();
  return true;
}
function drop(i) { const l = links[i]; scene.remove(l.line); l.line.geometry.dispose(); l.line.material.dispose(); links.splice(i, 1); }
export function addLink(from, to, kind) {
  if (!from || !to || from === to) return;
  for (let i = links.length - 1; i >= 0; i--) if (links[i].from === from && links[i].to === to) drop(i);   // (cùng cặp: thay đường cũ)
  if (links.length > 8) drop(0);
  const geo = new LineGeometry();
  // đường mảnh (2 px màn hình, không đổi theo độ zoom), nét đứt ngắn
  const mat = new LineMaterial({ color: new THREE.Color(COLOR[kind] || '#B9C4D6'), linewidth: 2, dashed: true, dashSize: 0.15, gapSize: 0.1, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false });
  const line = new Line2(geo, mat);
  line.renderOrder = 20; line.frustumCulled = false; line.userData.noMerge = true;
  const l = { from, to, line, life: TTL };
  if (!shape(l)) { geo.dispose(); mat.dispose(); return; }
  scene.add(line); links.push(l);
}
export const linksActive = () => links.length > 0;
export function updateLinks(dt, follow) {
  if (links.length) renderer.getSize(_res);
  for (let i = links.length - 1; i >= 0; i--) {
    const l = links[i]; l.life -= dt;
    if (l.life <= 0) { drop(i); continue; }
    l.line.material.opacity = 0.95 * Math.min(1, l.life / FADE); l.line.material.resolution.copy(_res);
    if (follow) shape(l);
  }
}
window.__officeLink = addLink;
window.__officeLinks = links;   // (kiểm tra: số đường đang hiện)
