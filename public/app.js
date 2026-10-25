const $ = (id) => document.getElementById(id);
const office = $('office'), world = $('world'), stage = $('stage'), svg = $('links'), bubbles = $('bubbles'), logEl = $('log'), go = $('go');
const WORLD_W = 1100, WORLD_H = 670;

// ---- Bố cục văn phòng (toạ độ trong khung 1100×670) ----
const POS = { user: [790, 12] };
// 4 khu vực theo thứ tự "rooms" trong agents.json; mỗi khu 3 chỗ ngồi, agent xếp theo thứ tự khai báo.
const SLOTS = [
  { x: [60, 230, 400], y: 192 },
  { x: [610, 770, 930], y: 192 },
  { x: [60, 230, 400], y: 440 },
  { x: [610, 770, 930], y: 440 },
];
const WALLS = [
  [0, 160, 520, 8], [600, 160, 500, 8], [556, 168, 8, 100], [556, 330, 8, 50],
  [0, 398, 230, 8], [290, 398, 230, 8], [600, 398, 230, 8], [890, 398, 210, 8],
  [556, 406, 8, 110], [556, 580, 8, 90],
];
const ZONES = [
  { label: [24, 176], rug: [14, 172, 530, 222], color: '#e9e0c8' },
  { label: [584, 176], rug: [572, 172, 520, 222], color: '#d3e5ee' },
  { label: [24, 414], rug: [14, 410, 530, 250], color: '#efd9d4' },
  { label: [584, 414], rug: [572, 410, 520, 250], color: '#d9e7d6' },
];
const DECOR = [
  ['shelf', 30, 24], ['board', 200, 24], ['plant', 300, 40], ['plant', 1040, 16],
  ['sofa', 940, 56, 120, 54], ['plant', 20, 340], ['plant', 510, 330], ['plant', 1040, 340],
  ['plant', 20, 612], ['plant', 520, 612], ['plant', 1040, 612], ['cooler', 527, 372],
];

// ---- Avatar khuôn mặt tròn riêng cho từng agent ----
const AV = {
  user: { skin: '#f2c9a0', hair: '#c0392b', style: 'cap', shirt: '#d6584b' },
  manager: { skin: '#e0a878', hair: '#2b2b2b', style: 'short', glasses: true, shirt: '#2f3a52' },
  secretary: { skin: '#f5d6b8', hair: '#6b3f2a', style: 'long', shirt: '#d08aa0' },
  reviewer: { skin: '#c68a5e', hair: '#1f1f1f', style: 'short', glasses: true, shirt: '#7fae8f' },
  rag: { skin: '#f2c9a0', hair: '#d9a441', style: 'bun', shirt: '#5fa8b8' },
  analyst: { skin: '#8d5a3b', hair: '#141414', style: 'curly', shirt: '#8f86c9' },
  designer: { skin: '#e0a878', hair: '#c0508a', style: 'long', shirt: '#d48b7e' },
  content: { skin: '#f2c9a0', hair: '#e8a33d', style: 'bun', glasses: true, shirt: '#e8a33d' },
  writer: { skin: '#f2c9a0', hair: '#e8a33d', style: 'bun', glasses: true, shirt: '#e8a33d' },
  dev: { skin: '#c68a5e', hair: '#2b2b2b', style: 'cap', shirt: '#6b93d6' },
  tester: { skin: '#f2c9a0', hair: '#4a2c1a', style: 'curly', shirt: '#5fb3a1' },
  ops: { skin: '#8d5a3b', hair: '#1a1a1a', style: 'short', shirt: '#d19a66' },
  planner: { skin: '#f5d6b8', hair: '#6b3f2a', style: 'long', shirt: '#d08aa0' },
  signal: { skin: '#f2c9a0', hair: '#d9a441', style: 'bun', shirt: '#5fa8b8' },
  video: { skin: '#c68a5e', hair: '#2b2b2b', style: 'cap', shirt: '#d48b7e' },
  script_review: { skin: '#c68a5e', hair: '#1f1f1f', style: 'short', glasses: true, shirt: '#7fae8f' },
  video_review: { skin: '#f2c9a0', hair: '#4a2c1a', style: 'curly', glasses: true, shirt: '#5fb3a1' },
};

// Agent mới (không có trong AV) nhận avatar cố định sinh từ id.
function autoAvatar(id, color) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const pick = (arr, n) => arr[(h >>> n) % arr.length];
  return {
    skin: pick(['#f5d6b8', '#f2c9a0', '#e0a878', '#c68a5e', '#8d5a3b'], 0),
    hair: pick(['#2b2b2b', '#6b3f2a', '#d9a441', '#c0508a', '#141414'], 3),
    style: pick(['short', 'long', 'bun', 'curly', 'cap'], 6),
    glasses: (h >>> 9) % 2 === 0, shirt: color,
  };
}

function faceSvg(id, bg) {
  const a = AV[id] || autoAvatar(id, bg);
  const top = {
    short: `<path d="M13.5 21c0-8 4-12 10.5-12s10.5 4 10.5 12c-3-4-7-5.5-10.5-5.5S16.5 17 13.5 21z" fill="${a.hair}"/>`,
    long: `<path d="M12 24c0-10 5-15 12-15s12 5 12 15v13H12z" fill="${a.hair}"/>`,
    bun: `<circle cx="24" cy="7" r="4.5" fill="${a.hair}"/><path d="M13.5 21c0-8 4-12 10.5-12s10.5 4 10.5 12c-3-4-7-5.5-10.5-5.5S16.5 17 13.5 21z" fill="${a.hair}"/>`,
    curly: `<g fill="${a.hair}"><circle cx="15" cy="15" r="5"/><circle cx="21" cy="11" r="5"/><circle cx="28" cy="11" r="5"/><circle cx="33" cy="16" r="5"/></g>`,
    cap: `<path d="M13 20c1-8 5-11 11-11s10 3 11 11z" fill="${a.hair}"/><rect x="10" y="19" width="28" height="3.2" rx="1.6" fill="${a.hair}"/>`,
  }[a.style];
  const glasses = a.glasses ? '<g fill="none" stroke="#2b2b2b" stroke-width="1.2"><circle cx="20" cy="24" r="3.4"/><circle cx="28" cy="24" r="3.4"/><path d="M23.4 24h1.2"/></g>' : '';
  return `<svg viewBox="0 0 48 48"><rect width="48" height="48" fill="${bg}" fill-opacity=".4"/>` +
    `<path d="M5 50c2-10 9-14 19-14s17 4 19 14z" fill="${a.shirt}"/>` +
    (a.style === 'long' ? top : '') +
    `<circle cx="24" cy="24" r="10.5" fill="${a.skin}"/>` +
    (a.style === 'long' ? `<path d="M13.5 24c0-6 4-9 10.5-9s10.5 3 10.5 9c-2-3-6-4-10.5-4s-8.5 1-10.5 4z" fill="${a.hair}"/>` : top) +
    '<circle cx="20" cy="24.5" r="1.3" fill="#2b2b2b"/><circle cx="28" cy="24.5" r="1.3" fill="#2b2b2b"/>' + glasses +
    '<path d="M21 29.5q3 2.6 6 0" stroke="#7a4a3a" fill="none" stroke-width="1.4" stroke-linecap="round"/></svg>';
}

const KIND = {
  command: { c: '#475569', l: 'ra lệnh' },
  assign: { c: '#e09a1a', l: 'giao task' },
  handoff: { c: '#3b82f6', l: 'bàn giao' },
  question: { c: '#f2711c', l: 'hỏi' },
  answer: { c: '#22b35e', l: 'trả lời' },
  report: { c: '#0fa3a3', l: 'báo cáo' },
  revise: { c: '#d43f3a', l: 'yêu cầu sửa' },
  final: { c: '#c2410c', l: 'báo cáo cuối' },
};
const STATUS = { idle: '○ rảnh', working: '● đang làm', waiting: '⏳ chờ quyền', offline: '⏻ offline', error: '⚠ lỗi' };

const els = {}, meta = { user: { name: 'CEO', color: '#c0392b' } }, info = {};
let replaying = true, selected = null, agentsVer = 0;
const agentData = {};
let cfg = { rooms: [], keys: {}, settings: null };

$('legend').innerHTML = Object.values(KIND).map((k) => `<span><i style="border-color:${k.c}"></i>${k.l}</span>`).join('');

function fit() {
  const s = Math.min(1.25, (office.clientWidth - 36) / WORLD_W);
  world.style.transform = `scale(${s})`;
  stage.style.width = WORLD_W * s + 'px';
  stage.style.height = WORLD_H * s + 'px';
}
addEventListener('resize', fit);

// ---- Dựng văn phòng ----
const div = (cls, x, y, w, h) => {
  const d = document.createElement('div');
  d.className = cls;
  Object.assign(d.style, { left: x + 'px', top: y + 'px' });
  if (w) { d.style.width = w + 'px'; d.style.height = h + 'px'; }
  return d;
};

function buildScenery() {
  for (const el of [...world.querySelectorAll('.wall,.rug,.zone-label,.shelf,.board,.plant,.cooler,.sofa,.unit')]) el.remove();
  const floor = $('floor');
  ZONES.forEach((z, i) => {
    const r = div('rug', ...z.rug); r.style.background = z.color; r.style.opacity = '.7';
    const l = div('zone-label', ...z.label); l.textContent = cfg.rooms[i] || '';
    floor.after(r, l);
  });
  for (const w of WALLS) floor.after(div('wall', ...w));
  for (const [kind, x, y, w, h] of DECOR) floor.after(div(kind, x, y, w, h));
}

function unit(id, name, color, boss) {
  const [x, y] = POS[id];
  const u = div('unit', x, y);
  u.style.setProperty('--c', color);
  u.innerHTML = `<div class="monitor"></div><div class="desk"></div><div class="chair"></div>` +
    `<div class="avatar">${faceSvg(id, color)}</div><div class="tag"></div>` +
    (boss ? '' : '<div class="meta"><code></code><span class="badge"></span></div>') + '<div class="talk"></div><div class="think" hidden><div class="th"><span class="ti">💬 Suy nghĩ</span><span class="pill"></span><span class="car">⌄</span></div><div class="tlog"></div></div>';
  u.querySelector('.tag').textContent = name;
  if (!boss) u.querySelector('code').textContent = '#' + id;
  world.insertBefore(u, svg);
  return u;
}

function build(agents, state) {
  buildScenery();
  closePop();
  for (const k of Object.keys(els)) delete els[k];
  for (const k of Object.keys(POS)) if (k !== 'user') delete POS[k];
  for (const k of Object.keys(meta)) if (k !== 'user') delete meta[k];
  for (const k of Object.keys(info)) delete info[k];
  meta.user = { name: 'CEO', color: '#c0392b' };
  const bu = unit('user', 'CEO', '#c0392b', true);
  els.user = { root: bu, talk: bu.querySelector('.talk') };
  bu.onclick = (e) => { e.stopPropagation(); showUserPop(); };
  const used = {};
  for (const a of agents) {
    const slot = SLOTS[Math.max(0, cfg.rooms.indexOf(a.room))];
    const n = used[a.room] = (used[a.room] || 0) + 1;
    if (n > slot.x.length) continue;
    POS[a.id] = [slot.x[n - 1], slot.y];
    meta[a.id] = { name: a.name, color: a.color, role: a.role, skills: a.skills || [], ai: a.ai, skillFiles: a.skillFiles || [] };
    agentData[a.id] = a;
    const u = unit(a.id, a.name, a.color, false);
    els[a.id] = { root: u, talk: u.querySelector('.talk'), badge: u.querySelector('.badge'), think: u.querySelector('.think') };
    u.querySelector('.think').onclick = (e) => { e.stopPropagation(); toggleThink(a.id); };
    u.onclick = (e) => { e.stopPropagation(); showPop(a.id); };
    setAgent(a.id, state[a.id].status, state[a.id].report);
  }
  fit();
}

// Biểu tượng tiến trình: hiện ở "Bảng task" khi có agent đang làm (tạo báo cáo, giao việc…).
function updateBusy() {
  const w = Object.entries(info).filter(([, v]) => v.status === 'working' || v.status === 'waiting').map(([id]) => meta[id]?.name || id);
  const h = document.querySelector('#board h4');
  if (!h) return;
  let b = h.querySelector('.busy');
  if (!w.length) { b?.remove(); return; }
  if (!b) { b = document.createElement('span'); b.className = 'busy'; h.append(b); }
  b.replaceChildren(Object.assign(document.createElement('i'), { className: 'spin' }), document.createTextNode(` Đang xử lý (${w.length} agent)…`));
}
function setAgent(id, status, report) {
  const el = els[id];
  if (!el) return;
  const prev = info[id]?.status;
  info[id] = { status, report: report || info[id]?.report || '' };
  if (status === 'working' && prev !== 'working' && el.think) { el.think.querySelector('.tlog').replaceChildren(); el.think.classList.remove('open'); el.root.classList.remove('thinkOpen'); thinkHide(id, false); }
  if (status !== 'working' && status !== 'waiting' && el.think && prev) thinkHide(id, true);
  for (const s of Object.keys(STATUS)) el.root.classList.toggle(s, s === status);
  updateBusy();
  el.badge.className = 'badge st-' + status;
  el.badge.textContent = STATUS[status] || status;
  if (el.think) { const pl = el.think.querySelector('.pill'); pl.textContent = STATUS[status] || status; pl.className = 'pill st-' + status; }
  if (selected === id) showPop(id);
}

// ---- Thẻ thông tin agent ----
function showPop(id) {
  selected = id;
  document.querySelectorAll('.unit.sel').forEach((u) => u.classList.remove('sel'));
  els[id].root.classList.add('sel');
  const m = meta[id], st = info[id] || { status: 'idle', report: '' };
  const pop = $('pop');
  pop.replaceChildren();
  const h = document.createElement('h5'); h.textContent = m.name;
  const r = document.createElement('div'); r.className = 'r'; r.textContent = `#${id} · ${m.role}`;
  const b = document.createElement('span'); b.className = 'badge st-' + st.status; b.textContent = STATUS[st.status];
  const sk = document.createElement('div'); sk.className = 'r';
  sk.textContent = (m.skills.length ? `Skill: ${m.skills.join(', ')} · ` : '') + `AI: ${m.ai}`;
  const sf = document.createElement('div'); sf.className = 'r';
  sf.textContent = m.skillFiles.length ? `Skills (thư mục skills/): ${m.skillFiles.join(' · ')}` : 'Chưa có skill trong thư mục skills/.';
  const rep = document.createElement('div'); rep.className = 'rep'; rep.textContent = st.report || 'Chưa có báo cáo.';
  const tog = document.createElement('button');
  const off = st.status === 'offline';
  tog.textContent = off ? 'Bật online' : 'Tắt (offline)';
  tog.className = 'pbtn ' + (off ? '' : 'off');
  tog.disabled = st.status === 'working' || st.status === 'waiting';
  tog.onclick = async () => {
    const res = await fetch('online', { method: 'POST', body: JSON.stringify({ id, online: off }) });
    if (!res.ok) addSys(await res.text());
  };
  const x = document.createElement('button'); x.className = 'x'; x.textContent = '×';
  x.onclick = closePop;
  const ed = document.createElement('button'); ed.textContent = '✎ Sửa'; ed.className = 'pbtn sec';
  ed.onclick = () => { closePop(); openEditor(id); };
  const box = document.createElement('div'); box.className = 'pbtns'; box.append(ed, tog);
  pop.append(x, h, r, sk, sf, b, rep, box);
  const [ux, uy] = POS[id];
  pop.style.left = (ux + 140 + 250 > WORLD_W ? ux - 260 : ux + 140) + 'px';
  pop.style.top = uy + 'px';
  pop.hidden = false;
  fitPop(uy);
}
// ---- Hộp suy nghĩ trên đầu agent: gọn (2 dòng mới nhất), bấm vào để xem log đầy đủ ----
const thinkTimers = {};
function thinkHide(id, delay) {
  clearTimeout(thinkTimers[id]);
  const el = els[id]?.think;
  if (!el) return;
  // Đang mở xem log đầy đủ thì giữ nguyên, người dùng tự bấm để đóng.
  if (delay) thinkTimers[id] = setTimeout(() => { if (!el.classList.contains('open')) el.hidden = true; }, 4000);
  else el.hidden = !el.querySelector('.tlog').childElementCount;
}
// Giữ hộp suy nghĩ trong khung bản đồ (agent sát mép trái/phải).
function clampThink(el) {
  el.style.left = '';
  const world = $('world'), wr = world.getBoundingClientRect(), r = el.getBoundingClientRect();
  const k = wr.width / world.offsetWidth || 1, base = parseFloat(getComputedStyle(el).left) || 0;
  let dx = 0;
  if (r.left < wr.left + 6) dx = wr.left + 6 - r.left;
  else if (r.right > wr.right - 6) dx = wr.right - 6 - r.right;
  if (dx) el.style.left = (base + dx / k) + 'px';
}
function toggleThink(id) {
  const el = els[id]?.think;
  if (!el) return;
  const open = el.classList.toggle('open');
  el.querySelector('.car').textContent = open ? '⌃' : '⌄';
  const world = el.closest('.unit');
  world?.classList.toggle('thinkOpen', open); // gần mép trên bản đồ thì mở xuống dưới để không bị cắt
  el.classList.toggle('down', open && world && world.offsetTop < 250);
  clampThink(el);
  clearTimeout(thinkTimers[id]);
  const log = el.querySelector('.tlog');
  if (open) log.scrollTop = log.scrollHeight;
  else if (!['working', 'waiting'].includes(info[id]?.status)) thinkHide(id, true);
}
function addThink(id, text, detail) {
  const el = els[id]?.think;
  if (!el) return;
  clearTimeout(thinkTimers[id]);
  const log = el.querySelector('.tlog');
  const atEnd = log.scrollHeight - log.scrollTop - log.clientHeight < 12;
  const line = document.createElement('div');
  line.className = 'tl';
  const ts = document.createElement('time'); ts.textContent = new Date().toTimeString().slice(0, 8);
  const tx = document.createElement('span'); tx.textContent = text;
  line.append(ts, tx);
  if (detail) { const dt = document.createElement('div'); dt.className = 'dt'; dt.textContent = detail; line.append(dt); line.classList.add('has'); }
  log.append(line);
  while (log.childElementCount > 120) log.firstChild.remove();
  if (el.hidden) { el.hidden = false; clampThink(el); }
  log.querySelectorAll('.tl.last').forEach((n) => n.classList.remove('last'));
  line.classList.add('last');
  if (atEnd || !el.classList.contains('open')) log.scrollTop = log.scrollHeight;
}

function showUserPop() {
  selected = 'user';
  document.querySelectorAll('.unit.sel').forEach((u) => u.classList.remove('sel'));
  els.user.root.classList.add('sel');
  const pop = $('pop');
  pop.replaceChildren();
  const x = document.createElement('button'); x.className = 'x'; x.textContent = '×'; x.onclick = closePop;
  const h = document.createElement('h5'); h.textContent = 'CEO';
  const r = document.createElement('div'); r.className = 'r'; r.textContent = 'Người ra lệnh · nhận báo cáo';
  const rep = document.createElement('a'); rep.className = 'pbtn'; rep.href = 'reports/'; rep.target = '_blank'; rep.textContent = 'Xem báo cáo';
  const box = document.createElement('div'); box.className = 'pbtns col'; box.append(rep);
  pop.append(x, h, r, box);
  const [ux, uy] = POS.user;
  pop.style.left = (ux - 260) + 'px';
  pop.style.top = uy + 'px';
  pop.hidden = false;
  fitPop(uy);
}
// Giữ popover trong khung bản đồ: đẩy lên nếu tràn đáy, và cho cuộn khi vẫn quá cao.
function fitPop(top) {
  const pop = $('pop');
  const max = WORLD_H - 16;
  pop.style.maxHeight = max + 'px';
  pop.style.overflowY = 'auto';
  const h = Math.min(pop.offsetHeight, max);
  pop.style.top = Math.max(8, Math.min(top, WORLD_H - h - 8)) + 'px';
}

function closePop() {
  selected = null;
  $('pop').hidden = true;
  document.querySelectorAll('.unit.sel').forEach((u) => u.classList.remove('sel'));
}
document.addEventListener('click', (e) => { if (!e.target.closest('#pop')) closePop(); });

// ---- Link nét đứt phát sáng + hộp thoại ----
const NS = 'http://www.w3.org/2000/svg';
const mk = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };
const center = (id) => (POS[id] ? { x: POS[id][0] + 65, y: POS[id][1] + 20 } : null);

const links = {}, bubs = [];
function drawLink(from, to, kind, text) {
  const a = center(from), b = center(to);
  if (!a || !b) return;
  const col = KIND[kind].c, key = `${from}>${to}`;
  links[key]?.forEach((n) => n.remove());

  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
  const off = Math.min(60, len * 0.18);
  const cx = (a.x + b.x) / 2 - (dy / len) * off, cy = (a.y + b.y) / 2 + (dx / len) * off;
  const d = `M${a.x},${a.y} Q${cx},${cy} ${b.x},${b.y}`;

  const g = mk('g', { class: 'link' });
  g.append(
    mk('path', { d, fill: 'none', stroke: col, 'stroke-width': 9, 'stroke-opacity': 0.4, filter: 'url(#glow)' }),
    mk('path', { d, fill: 'none', stroke: col, 'stroke-width': 3, class: 'dash', style: `filter:drop-shadow(0 0 4px ${col})` }),
    mk('circle', { cx: a.x, cy: a.y, r: 5, fill: col }),
    mk('circle', { cx: b.x, cy: b.y, r: 5, fill: col }),
  );
  const pk = mk('circle', { r: 5.5, fill: '#fff', stroke: col, 'stroke-width': 2.5 });
  pk.append(mk('animateMotion', { dur: '1.2s', repeatCount: '3', path: d }));
  g.append(pk);
  svg.append(g);

  let bx = 0.25 * a.x + 0.5 * cx + 0.25 * b.x, by = 0.25 * a.y + 0.5 * cy + 0.25 * b.y;
  bx = Math.max(125, Math.min(WORLD_W - 125, bx));
  by = Math.max(45, Math.min(WORLD_H - 45, by));
  for (let i = 0; i < 4 && bubs.some((o) => Math.abs(o.x - bx) < 190 && Math.abs(o.y - by) < 50); i++) by += 52;
  const bub = document.createElement('div');
  bub.className = 'bub';
  bub.style.cssText = `left:${bx}px;top:${by}px;--k:${col}`;
  const bh = document.createElement('div'); bh.className = 'bh';
  const chip = document.createElement('span'); chip.className = 'chip'; chip.textContent = KIND[kind].l;
  bh.append(chip, document.createTextNode(`${meta[from]?.name || from} → ${meta[to]?.name || to}`));
  const bt = document.createElement('div'); bt.className = 'bt';
  bt.textContent = text.length > 56 ? text.slice(0, 55) + '…' : text;
  bub.append(bh, bt);
  bubbles.append(bub);

  const rec = { x: bx, y: by };
  bubs.push(rec);
  links[key] = [g, bub];
  setTimeout(() => {
    g.remove(); bub.remove();
    bubs.splice(bubs.indexOf(rec), 1);
    if (links[key]?.[0] === g) delete links[key];
  }, 4100);
}

const talkTimers = {};
function markTalking(id, partner) {
  const el = els[id];
  if (!el) return;
  el.root.classList.add('talking');
  el.talk.textContent = `↔ ${meta[partner]?.name || partner}`;
  clearTimeout(talkTimers[id]);
  talkTimers[id] = setTimeout(() => { el.root.classList.remove('talking'); el.talk.textContent = ''; }, 5000);
}

const queue = [];
setInterval(() => {
  const m = queue.shift();
  if (!m) return;
  drawLink(m.from, m.to, m.kind, m.text);
  markTalking(m.from, m.to);
  markTalking(m.to, m.from);
}, 450);

// ---- Nhật ký, bảng task, báo cáo ----
function addFeed(from, to, kind, text) {
  const d = document.createElement('div');
  d.className = 'msg'; d.style.setProperty('--k', KIND[kind].c);
  const h = document.createElement('div'); h.className = 'mh';
  const chip = document.createElement('span'); chip.className = 'chip'; chip.textContent = KIND[kind].l;
  h.append(document.createTextNode(`${meta[from]?.name || from} → ${meta[to]?.name || to}`), chip);
  d.append(h, document.createTextNode(text));
  logEl.append(d);
  logEl.scrollTop = logEl.scrollHeight;
}
function addSys(text) {
  const d = document.createElement('div'); d.className = 'sys'; d.textContent = text;
  logEl.append(d);
  logEl.scrollTop = logEl.scrollHeight;
}

const taskRows = {};
function renderPlan(tasks) {
  $('tasks').replaceChildren();
  for (const t of tasks) {
    const row = document.createElement('div'); row.className = 'trow';
    const dot = document.createElement('span'); dot.className = 'dot';
    const code = document.createElement('code'); code.textContent = '#' + t.assignee;
    const round = document.createElement('span'); round.className = 'round';
    row.append(dot, code, document.createTextNode(t.title), round);
    $('tasks').append(row);
    taskRows[t.id] = { dot, round };
  }
}

function handle(m) {
  switch (m.type) {
    case 'status': setAgent(m.id, m.status, m.report); break;
    case 'think': if (!replaying) addThink(m.id, m.text, m.detail); break;
    case 'log': addSys(`${m.from}: ${m.text}`); break;
    case 'msg':
      if (m.kind === 'command') { $('final').hidden = true; $('tasks').replaceChildren(); }
      addFeed(m.from, m.to, m.kind, m.text);
      if (!replaying) queue.push(m);
      break;
    case 'plan': renderPlan(m.tasks); break;
    case 'task':
      if (!taskRows[m.id]) break;
      taskRows[m.id].dot.className = 'dot ' + m.status;
      if (m.round) taskRows[m.id].round.textContent = `sửa lần ${m.round}`;
      break;
    case 'final':
      $('final').hidden = false; $('final').classList.remove('min'); $('finalText').textContent = m.text;
      fbPick(''); $('fbMsg').textContent = ''; $('fbText').value = '';
      $('finalTitle').textContent = m.title ? `Báo cáo: ${m.title}` : 'Báo cáo gửi CEO';
      $('finalLink').hidden = !m.file;
      $('finalLinks').replaceChildren(...(m.links || []).map((l) => { const a = document.createElement('a'); a.href = l.href; a.target = '_blank'; a.rel = 'noopener'; a.className = 'flink'; a.textContent = l.label; return a; }));
      if (m.file) $('finalLink').href = 'reports/' + encodeURIComponent(m.file);
      break;
    case 'done': go.dataset.idle = '1'; go.disabled = uploading > 0; break;
  }
}

// ---- Quyền truy cập ----
// Mọi POST đi qua adminFetch: thao tác cần Admin (sửa/xoá agent, đổi cấu hình…) sẽ tự hỏi Admin ID + mật khẩu rồi thử lại.
const post = (url, body) => adminFetch(url, { method: 'POST', body: JSON.stringify(body) });
let permKey = '';
function renderPerm(pending, allowed) {
  const key = JSON.stringify([pending.map((p) => p.id), allowed]);
  if (key === permKey) return;
  permKey = key;
  const box = $('perm');
  box.replaceChildren();
  for (const p of pending) {
    const d = document.createElement('div'); d.className = 'req';
    const t = document.createElement('div');
    const exec = p.mode === 'exec';
    t.append(document.createTextNode(`${exec ? '⌨' : p.mode === 'write' ? '✎' : '🔒'} ${p.agent} xin quyền ${p.action}: `));
    const c = document.createElement('code'); c.textContent = exec ? p.command : p.path; t.append(c);
    if (exec) {
      const w = document.createElement('div'); w.className = 'why';
      w.textContent = `${p.risky ? '⚠ Có thể thay đổi/xoá file hoặc hệ thống. ' : ''}${p.reason || ''} Thư mục chạy: ${p.path}`; t.append(w);
    }
    const btns = document.createElement('div'); btns.className = 'btns';
    const no = document.createElement('button'); no.textContent = 'Từ chối'; no.className = 'no';
    no.onclick = () => post('permission', { id: p.id, allow: false });
    if (exec) {
      const once = document.createElement('button'); once.textContent = 'Cho phép lần này';
      const always = document.createElement('button'); always.textContent = 'Luôn cho phép lệnh này'; always.className = 'alt';
      once.onclick = () => post('permission', { id: p.id, allow: true, remember: false });
      always.onclick = () => post('permission', { id: p.id, allow: true, remember: true });
      btns.append(once, always, no);
    } else {
      const yes = document.createElement('button'); yes.textContent = 'Cho phép & ghi nhớ';
      yes.onclick = () => post('permission', { id: p.id, allow: true });
      btns.append(yes, no);
    }
    d.append(t, btns); box.append(d);
  }
  const al = $('allowed');
  al.replaceChildren();
  if (allowed.length) al.append(document.createTextNode('Đã cho phép: '));
  for (const a of allowed) {
    const s = document.createElement('div'); s.textContent = (a.mode === 'write' ? '[ghi] ' : a.mode === 'exec' ? '[lệnh] ' : '[đọc] ') + a.path;
    const x = document.createElement('button'); x.textContent = 'thu hồi';
    x.onclick = () => post('revoke', { path: a.path, mode: a.mode });
    s.append(x); al.append(s);
  }
}

let since = 0;
async function poll() {
  try {
    const d = await (await fetch(`poll?since=${since}&ver=${agentsVer}`)).json();
    if (d.agents) {
      for (const k of Object.keys(agentData)) delete agentData[k];
      cfg = { rooms: d.rooms, keys: d.keys, settings: d.settings };
      renderTemplates(d.templates || []);
      agentsVer = d.agentsVer;
      build(d.agents, d.state);
      renderMode(d);
      renderTokens(d.usage);
    }
    renderReportBtn(d.enzy);
    renderVoc(d.insight);
    renderAsks(d.asks || []);
    d.events.forEach(handle);
    renderPerm(d.pending, d.allowed);
    since = d.next;
    replaying = false;
  } catch (e) { /* server tạm thời không phản hồi, thử lại */ }
  setTimeout(poll, 600);
}
poll();

// ---- Câu hỏi làm rõ của team gửi CEO (lên idea mà thiếu thông tin: không giả định, hỏi đến khi đủ) ----
let asksKey = '';
function renderAsks(list) {
  const key = list.map((a) => a.id).join(',');
  if (key === asksKey) return; // chỉ dựng lại khi có câu hỏi mới/đã xong, để không mất chữ CEO đang gõ
  asksKey = key;
  const box = $('asks');
  box.replaceChildren();
  for (const a of list) {
    const card = document.createElement('div'); card.className = 'ask';
    const h = document.createElement('h5'); h.textContent = `❓ ${a.title || 'Cần làm rõ'}${a.round > 1 ? ` (lần ${a.round})` : ''}`;
    const p = document.createElement('p'); p.textContent = `${a.agent || 'Content Lead'}: ${a.intro || ''}`;
    card.append(h, p);
    const inputs = {};
    for (const q of a.questions || []) {
      const wrap = document.createElement('label'); wrap.className = 'aq';
      const t = document.createElement('b'); t.textContent = `${q.label}${q.required ? ' *' : ''}`;
      const s = document.createElement('span'); s.textContent = q.question;
      const inp = document.createElement('input'); inp.type = 'text'; inp.placeholder = q.placeholder || ''; inp.maxLength = 400; inp.autocomplete = 'off';
      inputs[q.key] = inp;
      wrap.append(t, s);
      if (q.options?.length) {
        const chips = document.createElement('div'); chips.className = 'achips';
        for (const o of q.options) {
          const c = document.createElement('button'); c.type = 'button'; c.className = 'tchip'; c.textContent = o;
          c.onclick = () => {
            if (!q.multi) { inp.value = o; return; }
            const parts = inp.value.split(',').map((x) => x.trim()).filter(Boolean);
            inp.value = (parts.includes(o) ? parts.filter((x) => x !== o) : [...parts, o]).join(', ');
          };
          chips.append(c);
        }
        wrap.append(chips);
      }
      wrap.append(inp);
      card.append(wrap);
    }
    const err = document.createElement('div'); err.className = 'aerr';
    const btns = document.createElement('div'); btns.className = 'btns';
    const send = document.createElement('button'); send.type = 'button'; send.textContent = 'Gửi trả lời';
    const no = document.createElement('button'); no.type = 'button'; no.className = 'no'; no.textContent = 'Huỷ yêu cầu';
    send.onclick = async () => {
      const miss = (a.questions || []).filter((q) => q.required && !inputs[q.key].value.trim());
      if (miss.length) { err.textContent = `Cần trả lời: ${miss.map((q) => q.label).join(', ')} (nếu muốn team tự đề xuất, ghi "để team đề xuất").`; inputs[miss[0].key].focus(); return; }
      send.disabled = no.disabled = true;
      const r = await post('ask/answer', { id: a.id, answers: Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k, el.value.trim()])) });
      if (!r.ok) { err.textContent = await r.text(); send.disabled = no.disabled = false; }
    };
    no.onclick = async () => { send.disabled = no.disabled = true; await post('ask/answer', { id: a.id, cancel: true }); };
    btns.append(send, no);
    card.append(err, btns);
    box.append(card);
  }
}

// ---- Ý kiến khách hàng: cào tuần tự ≤ 7 ngày, chắt lọc vào kho insight ----
let vocKey = '';
const vnDate = (s) => (s ? s.split('-').reverse().join('/') : '');
function renderVoc(v) {
  if (!v) return;
  const key = JSON.stringify(v);
  if (key === vocKey) return;
  vocKey = key;
  $('voc').hidden = false;
  const box = $('vocStatus');
  box.replaceChildren();
  const line = (text, cls) => { const d = document.createElement('div'); d.textContent = text; if (cls) d.className = cls; box.append(d); return d; };
  if (!v.configured) line('Chưa có tài khoản đăng nhập trang Enzy: bấm ⚙ → 📊 Dữ liệu Enzy để nhập.', 'warn');
  if (v.coverage) line(`Đã cào: ${vnDate(v.coverage.from)} → ${vnDate(v.coverage.to)} · ${v.coverage.customers} khách · ${v.themes} chủ đề`, '');
  else line('Chưa cào lần nào.', 'muted');
  if (v.running) { const d = line(` ${v.running.step}`, 'run'); const sp = document.createElement('i'); sp.className = 'spin'; d.prepend(sp); }
  else if (v.next) line(`Khoảng kế tiếp: ${vnDate(v.next.from)} → ${vnDate(v.next.to)}${v.behindDays > 7 ? ` · còn ${v.behindDays} ngày chưa cào` : ''}`, 'muted');
  else line('Đã cập nhật tới hôm qua ✅', 'muted');
  line(`Khi lên idea, team tự cập nhật tối đa ${v.autoWindows} khoảng ngày mới nhất.`, 'muted');
  if (v.lastError && !v.running) line(`⚠️ Lỗi gần nhất: ${v.lastError}`, 'warn'); // lỗi cũ được xoá khi bắt đầu lượt cào mới
  // Nhật ký của lượt cào hiện tại/gần nhất (server xoá nhật ký cũ mỗi khi bắt đầu lượt mới).
  const lg = $('vocLog'), rows = v.log || [];
  lg.hidden = !rows.length;
  lg.replaceChildren(...rows.map((e) => { const d = document.createElement('div'); if (e.level) d.className = e.level; const t = new Date(e.at); d.textContent = `${t.toTimeString().slice(0, 8)} ${e.text}`; return d; }));
  lg.scrollTop = lg.scrollHeight;
  const sb = $('vocStop'); sb.hidden = !v.running; sb.disabled = Boolean(v.running?.stopping); sb.textContent = v.running?.stopping ? 'Đang dừng…' : '■ Dừng';
  const a = $('vocDigest'); a.hidden = !v.digest; if (v.digest) a.href = v.digest;
  document.querySelectorAll('#voc button[data-voc]').forEach((b) => { b.disabled = !v.configured || Boolean(v.running) || (!v.next && !v.running); });
  if (document.activeElement !== $('vocStart')) $('vocStart').value = v.start || '';
}
$('vocStop').onclick = async () => { $('vocStop').disabled = true; const r = await post('insight/stop', {}); const t = await r.text(); if (t !== 'ok') addSys(t); };
document.querySelectorAll('#voc button[data-voc]').forEach((b) => {
  b.onclick = async () => { b.disabled = true; const r = await post('insight/run', { mode: b.dataset.voc }); const t = await r.text(); if (t !== 'ok') addSys(t); };
});
$('vocStartSave').onclick = async () => {
  const r = await post('insight/config', { start: $('vocStart').value });
  const t = await r.text(); addSys(t === 'ok' ? 'Đã lưu ngày bắt đầu cào ý kiến khách hàng.' : t);
};

// ---- Nút "Tạo báo cáo": mở bảng riêng (enzyreport.html) để chọn kỳ, tạo báo cáo/dashboard và xem nhật ký ----
function renderReportBtn(e) {
  const b = $('openReport');
  if (!e || !b) return;
  const busy = Boolean(e.running) || e.queued.length > 0;
  b.classList.toggle('busy', busy);
  b.querySelector('i').textContent = busy ? '⏳' : '📈';
  b.title = busy ? `Đang tạo báo cáo${e.running?.label ? ` (${e.running.label})` : ''}: ${e.running?.step || 'đang chờ trong hàng đợi'}` : 'Tạo báo cáo quảng cáo Enzy theo ngày / tuần / tháng, xem nhật ký';
}
$('openReport').onclick = () => { $('erFrame').src = 'enzyreport.html'; $('erDlg').showModal(); };
$('erClose').onclick = () => $('erDlg').close();
$('erDlg').addEventListener('close', () => { $('erFrame').removeAttribute('src'); });

// Bảng "Cấu hình Office": gom Thêm agent / Cấu hình AI / Dữ liệu Enzy; bấm một mục thì đóng bảng rồi mở mục đó.
$('openOffice').onclick = () => $('offDlg').showModal();
$('openAdmin').onclick = () => adminPanel();
$('offClose').onclick = () => $('offDlg').close();
$('offGrid').addEventListener('click', (e) => { if (e.target.closest('button')) $('offDlg').close(); }, true);

// Trí nhớ & kỹ năng agent: hộp thoại nhúng memory.html.
$('openMemory').onclick = () => { $('memFrame').src = 'memory.html'; $('memDlg').showModal(); };
$('memClose').onclick = () => $('memDlg').close();
$('memDlg').addEventListener('close', () => { $('memFrame').removeAttribute('src'); });

// Đánh giá của CEO cho kết quả vừa xong → bài học cho các agent đã tham gia.
let fbRating = '';
const fbPick = (r) => { fbRating = r; $('fbGood').classList.toggle('on', r === 'good'); $('fbBad').classList.toggle('on', r === 'bad'); };
$('fbGood').onclick = () => fbPick('good');
$('fbBad').onclick = () => fbPick('bad');
$('fbSend').onclick = async () => {
  if (!fbRating) { $('fbMsg').textContent = 'Chọn 👍 Tốt hoặc 👎 Chưa tốt trước.'; return; }
  const r = await post('learn/act', { action: 'feedback', rating: fbRating, text: $('fbText').value });
  if (r.ok) { const j = await r.json(); $('fbMsg').textContent = `Đã ghi nhớ cho ${j.agents.map((x) => '#' + x).join(', ')}. Các agent sẽ tự cập nhật kỹ năng.`; $('fbText').value = ''; fbPick(''); }
  else $('fbMsg').textContent = await r.text();
};

// Dashboard giám sát token: hộp thoại lớn nhúng usage.html (nạp lại mỗi lần mở, dừng tự cập nhật khi đóng).
$('openUsage').onclick = () => { $('usFrame').src = 'usage.html'; $('usDlg').showModal(); };
$('usClose').onclick = () => $('usDlg').close();
$('usDlg').addEventListener('close', () => { $('usFrame').removeAttribute('src'); });

// Cấu hình dữ liệu Enzy ngay trên GUI (ghi vào enzy.json, áp dụng cho lần chạy kế tiếp).
const ezDlg = $('ezDlg');
async function openEnzyCfg() {
  $('ezErr').textContent = '';
  const r = await post('enzy/config/get', {});
  if (!r.ok) { addSys(await r.text()); return; }
  const c = await r.json();
  $('ezUrl').value = c.URL; $('ezUser').value = c.USER; $('ezPass').value = ''; $('ezClear').checked = false;
  $('ezPass').placeholder = c.hasPass ? 'Đã lưu — để trống = giữ nguyên' : 'Nhập mật khẩu';
  $('ezClearRow').hidden = !c.hasPass;
  $('ezBrand').value = c.BRAND; $('ezSystem').value = c.SYSTEM; $('ezStore').value = c.STORE;
  $('ezAccounts').value = c.ACCOUNTS.join('\n'); $('ezPrompt').value = c.PROMPT; $('ezOwners').value = (c.OWNERS || []).join(', ');
  $('ezNote').textContent = (c.envCreds ? 'Đang có biến môi trường ENZY_USER/ENZY_PASS: biến này được ưu tiên hơn giá trị ở đây. ' : '') + 'Mật khẩu lưu trong enzy.json (quyền 600), không gửi lại về trình duyệt.';
  ezDlg.showModal();
}
$('openEnzy').onclick = openEnzyCfg;
$('openCfg').onclick = () => openConfig();
$('ezCancel').onclick = () => ezDlg.close();
$('ezForm').onsubmit = async (ev) => {
  ev.preventDefault();
  const r = await post('enzy/config/save', {
    URL: $('ezUrl').value, USER: $('ezUser').value, PASS: $('ezPass').value, clearPass: $('ezClear').checked,
    BRAND: $('ezBrand').value, SYSTEM: $('ezSystem').value, STORE: $('ezStore').value, ACCOUNTS: $('ezAccounts').value, OWNERS: $('ezOwners').value, PROMPT: $('ezPrompt').value,
  });
  if (r.ok) { const t = await r.text(); $('ezPass').value = ''; ezDlg.close(); addSys('Đã lưu cấu hình Enzy. Áp dụng từ lần chạy báo cáo kế tiếp.' + (t.startsWith('ok:') ? ' ' + t.slice(4) + '.' : '')); } else $('ezErr').textContent = await r.text();
};

// ---- Ô giao việc: nhiều dòng, mẫu quy trình, đính kèm file (kéo thả / dán / chọn) ----
const input = $('task');
const files = []; // { id, name, size, status: 'up'|'ok'|'err', el }
let uploading = 0;

function autosize() { input.style.height = 'auto'; input.style.height = Math.min(Math.max(input.scrollHeight + 2, 76), innerHeight * 0.45) + 'px'; }
input.addEventListener('input', autosize);
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('f').requestSubmit(); }
});

function renderTemplates(list) {
  const box = $('tpl');
  box.replaceChildren(...list.map((t) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'tchip'; b.textContent = t.name; b.title = t.text;
    b.onclick = () => { input.value = t.text; input.focus(); input.setSelectionRange(input.value.length, input.value.length); autosize(); };
    return b;
  }));
  box.hidden = !list.length;
}

const fmtSize = (n) => (n < 1024 ? `${n}B` : n < 1048576 ? `${Math.round(n / 1024)}KB` : `${(n / 1048576).toFixed(1)}MB`);
function renderFiles() {
  $('files').replaceChildren(...files.map((f) => f.el));
  $('files').hidden = !files.length;
  go.disabled = uploading > 0 || !go.dataset.idle;
}
async function upload(file) {
  const f = { name: file.name, size: file.size, status: 'up' };
  f.el = document.createElement('span'); f.el.className = 'fchip up';
  const label = document.createElement('span'); label.textContent = `${file.type.startsWith('image/') ? '🖼' : '📄'} ${file.name} · ${fmtSize(file.size)}`;
  const x = document.createElement('button'); x.type = 'button'; x.textContent = '×'; x.title = 'Bỏ file này';
  x.onclick = () => { files.splice(files.indexOf(f), 1); renderFiles(); };
  f.el.append(label, x);
  files.push(f); uploading++; renderFiles();
  try {
    const r = await fetch('upload', { method: 'POST', headers: { 'x-file-name': encodeURIComponent(file.name) }, body: file });
    if (!r.ok) throw new Error(await r.text());
    f.id = (await r.json()).id; f.status = 'ok'; f.el.className = 'fchip';
  } catch (e) {
    f.status = 'err'; f.el.className = 'fchip err'; label.textContent += ` — ${e.message}`;
  } finally { uploading--; renderFiles(); }
}
const addFiles = (list) => { for (const file of list) if (file.size) upload(file); };

$('attach').onclick = () => $('picker').click();
$('picker').onchange = () => { addFiles($('picker').files); $('picker').value = ''; };
input.addEventListener('paste', (e) => { if (e.clipboardData?.files?.length) { e.preventDefault(); addFiles(e.clipboardData.files); } });
{
  // Kéo file vào bất kỳ đâu trên trang: hiện vùng thả, thả xong tự tải lên và gắn vào lệnh giao việc.
  let depth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); depth++; document.body.classList.add('dropping'); });
  addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  addEventListener('dragleave', (e) => { if (!hasFiles(e)) return; if (--depth <= 0) { depth = 0; document.body.classList.remove('dropping'); } });
  addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault(); depth = 0; document.body.classList.remove('dropping');
    addFiles(e.dataTransfer.files); input.focus();
  });
}

go.dataset.idle = '1';
$('f').onsubmit = async (e) => {
  e.preventDefault();
  const task = input.value.trim();
  if (!task || uploading) return;
  const ready = files.filter((f) => f.status === 'ok');
  go.disabled = true; delete go.dataset.idle;
  const r = await post('task', { task, files: ready.map((f) => f.id) });
  if (r.ok) { input.value = ''; autosize(); files.length = 0; renderFiles(); }
  else { go.dataset.idle = '1'; go.disabled = false; addSys(await r.text()); }
};

// ---- Thêm / sửa / xoá agent ----
const ed = $('ed');
let editingId = null;
const PROVIDER_LABEL = { claude: 'Claude', gpt: 'GPT', gemini: 'Gemini' };

function openEditor(id) {
  editingId = id || null;
  const a = id ? agentData[id] : { room: cfg.rooms[0], color: '#6b93d6', skills: [] };
  $('edTitle').textContent = id ? `Sửa agent #${id}` : 'Thêm agent mới';
  $('edId').value = id || ''; $('edId').readOnly = Boolean(id);
  $('edName').value = a.name || ''; $('edRole').value = a.role || '';
  $('edRoom').replaceChildren(...cfg.rooms.map((r) => new Option(r, r)));
  $('edRoom').value = a.room;
  $('edColor').value = a.color;
  $('edSkills').value = (a.skills || []).join(', ');
  $('edPrompt').value = a.prompt || '';
  $('edSkillFile').value = a.fileSkill || '';
  $('edAsk').value = a.canAsk ? (a.canAsk.length ? a.canAsk.join(', ') : '-') : '';
  fillTools(a.tools);
  $('edGate').checked = Boolean(a.gate);
  $('edProvider').replaceChildren(new Option('Mặc định (config.json)', ''),
    ...Object.entries(PROVIDER_LABEL).map(([k, v]) => new Option(v + (cfg.keys[k] ? '' : ' (chưa dùng được)'), k)));
  $('edProvider').value = a.provider || '';
  $('edModel').value = a.model || '';
  $('edDel').hidden = !id || id === 'manager';
  $('edErr').textContent = '';
  ed.showModal();
}

async function sendAgent(url, body) {
  const del = url === 'agent/delete';
  const pw = await adminConfirm(del ? 'Xoá agent' : 'Lưu thay đổi agent', del ? `Xoá agent #${body.id} không thể hoàn tác. Nhập mật khẩu Admin để xác nhận.` : 'Nhập mật khẩu Admin để lưu thay đổi agent.');
  if (!pw) return;
  const r = await post(url, { ...body, adminPassword: pw });
  if (r.ok) { ed.close(); return; }
  let msg = await r.text();
  try { msg = JSON.parse(msg).message || msg; } catch {}
  $('edErr').textContent = msg;
}

const TOOL_LABELS = [['read_file', 'Đọc file'], ['write_file', 'Ghi file'], ['run_command', 'Chạy lệnh (đọc/chẩn đoán/tạo mới)'], ['list_dir', 'Xem thư mục'], ['skill_search', 'Tra cứu nhanh kỹ năng (skills)'], ['trend_scan', 'Quét trend thời gian thực'], ['web_search', 'Tìm web'], ['web_fetch', 'Đọc trang web'], ['make_image', 'Tạo ảnh'], ['make_docx', 'Tạo Word'], ['ask_colleague', 'Hỏi đồng nghiệp']];
function fillTools(tools) {
  $('edTools').replaceChildren(...TOOL_LABELS.map(([id, label]) => {
    const l = document.createElement('label'); l.className = 'tl2';
    const c = document.createElement('input'); c.type = 'checkbox'; c.value = id; c.checked = !tools || tools.includes(id);
    l.append(c, document.createTextNode(' ' + label)); return l;
  }));
}
const pickedTools = () => { const all = [...$('edTools').querySelectorAll('input')]; const on = all.filter((c) => c.checked).map((c) => c.value); return on.length === all.length ? null : on; };
$('addAgent').onclick = () => openEditor();
$('edCancel').onclick = () => ed.close();
$('edDel').onclick = () => {
  if (confirm(`Xoá agent #${editingId}?`)) sendAgent('agent/delete', { id: editingId });
};
$('edForm').onsubmit = (e) => {
  e.preventDefault();
  const agent = {
    id: editingId || $('edId').value.trim(), name: $('edName').value, role: $('edRole').value,
    room: $('edRoom').value, color: $('edColor').value, prompt: $('edPrompt').value,
    skills: $('edSkills').value.split(',').map((x) => x.trim()).filter(Boolean),
    canAsk: $('edAsk').value.trim() === '' ? null : $('edAsk').value.split(',').map((x) => x.trim()).filter((x) => x && x !== '-'),
    'file-skill': $('edSkillFile').value.trim(), gate: $('edGate').checked, tools: pickedTools(),
    provider: $('edProvider').value || undefined, model: $('edModel').value.trim() || undefined,
  };
  sendAgent('agent/save', { agent, isNew: !editingId });
};

// ---- Đổi kích thước panel (lưu lại trong trình duyệt) ----
const LS = {
  get: (k) => { try { return localStorage.getItem('ao.' + k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem('ao.' + k, v); } catch { /* bỏ qua */ } },
};
{
  const side = $('side'), split = $('split');
  const w = Number(LS.get('sideW'));
  if (w) side.style.setProperty('--sw', w + 'px');
  split.onpointerdown = (e) => {
    split.setPointerCapture(e.pointerId);
    split.classList.add('drag'); document.body.classList.add('dragging');
    split.onpointermove = (ev) => {
      const nw = Math.max(260, Math.min(innerWidth - 320, innerWidth - ev.clientX));
      side.style.setProperty('--sw', nw + 'px');
      fit();
    };
    split.onpointerup = () => {
      split.onpointermove = split.onpointerup = null;
      split.classList.remove('drag'); document.body.classList.remove('dragging');
      LS.set('sideW', parseInt(side.style.getPropertyValue('--sw')));
    };
  };
  for (const id of ['finalText', 'tasks']) {
    const el = $(id), h = Number(LS.get(id + 'H'));
    if (h) el.style.height = h + 'px';
    new ResizeObserver(() => { if (el.offsetHeight > 0) LS.set(id + 'H', el.offsetHeight); }).observe(el);
  }
  $('finalToggle').onclick = () => {
    const m = $('final').classList.toggle('min');
    $('finalToggle').textContent = m ? '▸' : '▾';
  };
}

// Bảng trạng thái: xanh lá khi REAL (AI thật), đỏ nhạt khi MOCK (giả lập).
function renderMode(d) {
  const box = $('mode'), real = d.mode === 'REAL';
  box.className = 'mp ' + (real ? 'real' : 'mock');
  const row = (k, v) => { const r = document.createElement('div'); r.className = 'mr'; const a = document.createElement('span'); a.textContent = k; const b = document.createElement('b'); b.textContent = v; r.append(a, b); return r; };
  const h = document.createElement('div'); h.className = 'mh';
  const dot = document.createElement('i'); dot.className = 'dot';
  const t = document.createElement('b'); t.textContent = real ? 'REAL' : 'MOCK';
  const sub = document.createElement('span'); sub.textContent = real ? 'đang chạy AI thật' : 'phản hồi giả lập, không gọi AI';
  h.append(dot, t, sub);
  box.replaceChildren(h, row('Kết nối', d.connection), row('AI', `${d.provider}/${d.modelLabel || d.model}`), row('Thư mục', d.sourceDir));
  if (d.modeNote) { const n = document.createElement('div'); n.className = 'mn'; n.textContent = d.modeNote; box.append(n); }
}
// Thanh token còn lại của tháng (hạn mức do người dùng tự đặt trong dashboard giám sát token).
const cmp = (n) => (n >= 1e6 ? (n / 1e6).toLocaleString('vi-VN', { maximumFractionDigits: 2 }) + ' tr' : n >= 1e3 ? (n / 1e3).toLocaleString('vi-VN', { maximumFractionDigits: 1 }) + ' k' : String(Math.round(n)));
function renderTokens(u) {
  const box = $('tkn');
  if (!u) return;
  box.hidden = false;
  const lim = u.limit || 0, ratio = lim ? u.used / lim : 0;
  box.className = 'tk' + (lim ? (ratio >= 0.9 ? ' bad' : ratio >= 0.7 ? ' warn' : ' ok') : '');
  const head = document.createElement('div'); head.className = 'th2';
  const a = document.createElement('b'); a.textContent = '🪙 Token tháng ' + u.month.slice(5) + '/' + u.month.slice(0, 4);
  const c = document.createElement('span'); c.textContent = lim ? `còn ${cmp(u.remaining)}` : `đã dùng ${cmp(u.used)}`;
  head.append(a, c);
  const sub = document.createElement('div'); sub.className = 'ts';
  sub.textContent = lim ? `Đã dùng ${cmp(u.used)} / ${cmp(lim)} (${Math.round(ratio * 100)}%)${u.projected > lim ? ' · dự kiến vượt hạn mức' : ''}` : 'Chưa đặt hạn mức tháng — bấm để đặt';
  const kids = [head];
  if (lim) { const m = document.createElement('div'); m.className = 'tm'; const i = document.createElement('i'); i.style.width = Math.min(100, ratio * 100) + '%'; m.append(i); kids.push(m); }
  kids.push(sub);
  box.replaceChildren(...kids);
}
$('tkn').onclick = () => $('openUsage').click();
$('tkn').onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('openUsage').click(); } };

// ---- Cấu hình AI (CEO) ----
const cd = $('cfgDlg');
function fillProvider() {
  const S = cfg.settings, p = S.providers[$('cfProvider').value], cli = $('cfConn').value === 'CLI';
  // CLI để trống model: hiển thị model CLI thực sự đang dùng (nếu đã biết) thay vì ô rỗng.
  $('cfModel').value = cli ? (p.cliModel || p.cliDetected || '') : p.model;
  $('cfModel').dataset.auto = cli && !p.cliModel && p.cliDetected ? p.cliDetected : '';
  $('cfModel').placeholder = cli ? `Đang dùng: ${p.cliDefault}` : '';
  $('cfKeyRow').hidden = $('cfClearRow').hidden = cli;
  $('cfKey').value = ''; $('cfClear').checked = false;
  $('cfKey').placeholder = p.hasKey ? `Đã lưu (${p.keyHint}) — để trống = giữ nguyên` : `Dán ${p.keyName}`;
  $('cfClearRow').hidden = cli || !p.hasKey;
  $('cfNote').textContent = cli
    ? `CLI "${p.cliCmd}": ${p.cliOk ? 'đã phát hiện' : 'chưa phát hiện (cài và đăng nhập, rồi chọn Lưu để kiểm tra lại)'}.`
    : 'Key lưu trong config.json (quyền 600) và không bao giờ gửi lại về trình duyệt.';
  $('cfAuth').hidden = !['claude', 'gpt'].includes($('cfProvider').value);
  $('cfAuthNote').textContent = `Sẽ xác thực ${$('cfProvider').value === 'gpt' ? 'Codex' : 'Claude'} trên máy đang chạy server; nếu thành công sẽ tự bật REAL qua CLI.`;
}
function openConfig() {
  const S = cfg.settings;
  $('cfProvider').value = S.provider; $('cfConn').value = S.connection; $('cfMode').value = S.mode;
  $('cfErr').textContent = S.note || '';
  $('cfDetail').value = S.detail; $('cfWorkMax').value = S.workMax; $('cfSumMax').value = S.sumMax;
  fillProvider();
  cd.showModal();
}
$('cfProvider').onchange = fillProvider;
$('cfDetail').onchange = () => { const b = $('cfDetail').value === 'brief'; $('cfWorkMax').value = b ? 1500 : 4000; $('cfSumMax').value = b ? 500 : 2500; };
$('cfConn').onchange = fillProvider;
$('cfAuth').onclick = async () => {
  const button = $('cfAuth'), provider = $('cfProvider').value;
  button.disabled = true; $('cfErr').textContent = 'Đang kiểm tra phiên đăng nhập trên máy chạy server…';
  try {
    const r = await post('auth/connect', { provider });
    const message = await r.text();
    if (r.status === 401) { await startLogin(provider); return; }
    if (!r.ok) { $('cfErr').textContent = message; return; }
    $('cfErr').textContent = JSON.parse(message).message;
    setTimeout(() => cd.close(), 1200);
  } catch { $('cfErr').textContent = 'Không kết nối được tới server.'; }
  finally { button.disabled = false; }
};
// Đăng nhập CLI từ giao diện: server chạy lệnh login, CLI tự mở trình duyệt; ở đây chỉ theo dõi và chuyển mã dán.
let loginTimer = null;
const loginUi = (show, msg = '', url = '') => {
  $('cfLogin').hidden = !show; $('cfLoginMsg').textContent = msg;
  $('cfLoginUrl').hidden = !url; if (url) $('cfLoginUrl').href = url;
  if (!show) $('cfLoginCode').value = '';
};
async function startLogin(provider) {
  clearInterval(loginTimer);
  const r = await post('auth/login/start', { provider });
  if (!r.ok) { $('cfErr').textContent = await r.text(); return; }
  $('cfErr').textContent = '';
  loginUi(true, 'Đang mở trang đăng nhập trên máy chạy server… hãy đăng nhập trong cửa sổ trình duyệt vừa mở.');
  loginTimer = setInterval(async () => {
    try {
      const s = await (await post('auth/login/status', { provider })).json();
      if (s.connected) { clearInterval(loginTimer); loginUi(false); $('cfErr').textContent = s.message; setTimeout(() => cd.close(), 1200); }
      else if (s.state === 'failed') { clearInterval(loginTimer); loginUi(false); $('cfErr').textContent = 'Đăng nhập chưa thành công hoặc đã hết thời gian. Bấm "Đăng nhập / xác thực" để thử lại.'; }
      else if (s.state === 'done') loginUi(true, 'Đang xác nhận phiên đăng nhập…');
      else loginUi(true, 'Đăng nhập trong trình duyệt. Nếu trang hiện mã xác thực, dán vào ô bên dưới.', s.url);
    } catch { /* thử lại ở lượt sau */ }
  }, 1500);
}
$('cfLoginSend').onclick = async () => {
  const r = await post('auth/login/code', { code: $('cfLoginCode').value.trim() });
  if (r.ok) { $('cfLoginCode').value = ''; $('cfErr').textContent = 'Đã gửi mã, đang xác nhận…'; } else $('cfErr').textContent = await r.text();
};
$('cfLoginCancel').onclick = async () => {
  clearInterval(loginTimer); await post('auth/login/cancel', {}); loginUi(false); $('cfErr').textContent = 'Đã dừng đăng nhập.';
};
$('cfCancel').onclick = () => cd.close();
$('cfgForm').onsubmit = async (e) => {
  e.preventDefault();
  const r = await post('config/save', {
    provider: $('cfProvider').value, connection: $('cfConn').value, mode: $('cfMode').value,
    model: $('cfModel').value === $('cfModel').dataset.auto ? '' : $('cfModel').value, detail: $('cfDetail').value, workMax: $('cfWorkMax').value, sumMax: $('cfSumMax').value, apiKey: $('cfKey').value, clearKey: $('cfClear').checked,
  });
  if (r.ok) { $('cfKey').value = ''; cd.close(); } else $('cfErr').textContent = await r.text();
};
