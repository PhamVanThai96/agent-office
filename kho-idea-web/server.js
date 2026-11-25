// Kho Idea Enzy — website độc lập: đăng nhập riêng, admin toàn quyền, nhân viên chỉ xem.
// Không cần thư viện ngoài: Node >= 22.13 (node:sqlite có sẵn). Dữ liệu nằm trong DATA_DIR (ổ lưu trữ bền trên cloud).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createWriter } from './scriptwriter.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3200;
const DATA_DIR = process.env.DATA_DIR || path.join(HERE, 'data');
const PROD = process.env.NODE_ENV === 'production';
const SESSION_DAYS = 30;
fs.mkdirSync(DATA_DIR, { recursive: true });

// ---------- Cơ sở dữ liệu ----------
const db = new DatabaseSync(path.join(DATA_DIR, 'kho-idea.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL CHECK (role IN ('admin','staff')), pass TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ideas (
    id TEXT PRIMARY KEY, day TEXT NOT NULL, created_at TEXT NOT NULL, data TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS ideas_day ON ideas(day);
  CREATE TABLE IF NOT EXISTS videos (
    id TEXT PRIMARY KEY, url TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', san_pham TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'moi', transcript TEXT NOT NULL DEFAULT '', duration REAL, error TEXT NOT NULL DEFAULT '',
    idea_ids TEXT NOT NULL DEFAULT '[]', added_by TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, used_at TEXT
  );
  CREATE TABLE IF NOT EXISTS scripts (
    id TEXT PRIMARY KEY, idea_id TEXT UNIQUE NOT NULL, created_at TEXT NOT NULL, data TEXT NOT NULL
  );
`);
// Video đang chép lời dở khi máy tắt → chép lại khi mở web.
db.prepare("UPDATE videos SET status = 'moi' WHERE status = 'dang_chep'").run();

// ---------- Video mẫu: tự chép lời bằng công cụ transcript của Agent Office (yt-dlp + Whisper chạy trên máy) ----------
// de_xuat: agent tự tìm, chờ leader chọn (Dùng → chép lời / sẵn sàng; Bỏ → bo, giữ lại để không đề xuất trùng)
const VIDEO_STATUS = ['de_xuat', 'moi', 'dang_chep', 'san_sang', 'loi', 'da_dung', 'bo'];
let transcriber; // undefined: chưa thử; null: máy chưa cài
async function getTranscriber() {
  if (transcriber !== undefined) return transcriber;
  try {
    const m = await import(path.join(HERE, '..', 'transcribe.js'));
    transcriber = m.transcribeReady() ? m.transcribeVideo : null;
  } catch { transcriber = null; }
  return transcriber;
}
let transcribing = false;
async function transcribeQueue() {
  if (transcribing) return;
  transcribing = true;
  try {
    for (;;) {
      const v = db.prepare("SELECT * FROM videos WHERE status = 'moi' ORDER BY created_at LIMIT 1").get();
      if (!v) break;
      const tr = await getTranscriber();
      if (!tr) {
        db.prepare("UPDATE videos SET status = 'loi', error = ? WHERE id = ?").run('Máy chưa cài công cụ chép lời (chạy scripts/setup-media.sh trong Agent Office). Agent vẫn dùng được link + ghi chú.', v.id);
        continue;
      }
      db.prepare("UPDATE videos SET status = 'dang_chep', error = '' WHERE id = ?").run(v.id);
      const r = await tr(v.url, { maxChars: 12000 });
      if (r.error) db.prepare("UPDATE videos SET status = 'loi', error = ? WHERE id = ?").run(String(r.error).slice(0, 500), v.id);
      else db.prepare("UPDATE videos SET status = 'san_sang', transcript = ?, duration = ? WHERE id = ?").run(String(r.text || ''), Number(r.duration) || null, v.id);
    }
  } catch (e) { console.error('[kho-idea] chép lời lỗi', e); }
  finally { transcribing = false; }
}
setTimeout(transcribeQueue, 2000);
const rowToVideo = (r) => ({ id: r.id, url: r.url, note: r.note, sanPham: r.san_pham, status: r.status, transcript: r.transcript, duration: r.duration,
  error: r.error, ideaIds: JSON.parse(r.idea_ids || '[]'), addedBy: r.added_by, createdAt: r.created_at, usedAt: r.used_at });
const VIDEO_URL = /^https:\/\/(?:[\w-]+\.)*(?:facebook\.com|fb\.watch|tiktok\.com|youtube\.com|youtu\.be|instagram\.com)\/\S+$/i;

// ---------- Mật khẩu & phiên đăng nhập ----------
const hashPass = (pw) => {
  const salt = crypto.randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${crypto.scryptSync(String(pw), salt, 64).toString('hex')}`;
};
const checkPass = (pw, stored) => {
  const [, saltHex, hashHex] = String(stored).split('$');
  if (!saltHex || !hashHex) return false;
  const h = crypto.scryptSync(String(pw), Buffer.from(saltHex, 'hex'), 64);
  return crypto.timingSafeEqual(h, Buffer.from(hashHex, 'hex'));
};
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const newId = () => crypto.randomBytes(9).toString('base64url');
const validPassword = (pw) => typeof pw === 'string' && pw.length >= 8 && pw.length <= 200;
const validUsername = (u) => typeof u === 'string' && /^[a-z0-9._-]{3,40}$/.test(u);

function seedAdmin() {
  const hasAdmin = db.prepare("SELECT 1 FROM users WHERE role = 'admin' AND active = 1").get();
  const u = String(process.env.ADMIN_USERNAME || '').trim().toLowerCase(), p = process.env.ADMIN_PASSWORD;
  if (hasAdmin) return;
  if (!validUsername(u) || !validPassword(p)) {
    console.warn('[kho-idea] Chưa có tài khoản admin. Đặt ADMIN_USERNAME (3-40 ký tự a-z 0-9 . _ -) và ADMIN_PASSWORD (>= 8 ký tự) rồi khởi động lại.');
    return;
  }
  db.prepare('INSERT INTO users (id, username, name, role, pass, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(newId(), u, 'Admin', 'admin', hashPass(p), new Date().toISOString());
  console.log(`[kho-idea] Đã tạo admin "${u}".`);
}
seedAdmin();

const cookieName = PROD ? '__Host-kid' : 'kid';
function readCookie(req) {
  const m = new RegExp(`(?:^|;\\s*)${cookieName.replace(/[-]/g, '\\-')}=([^;]+)`).exec(req.headers.cookie || '');
  return m ? m[1] : '';
}
function startSession(res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const exp = Date.now() + SESSION_DAYS * 864e5;
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(sha(token), userId, exp);
  res.setHeader('Set-Cookie', `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${PROD ? '; Secure' : ''}`);
}
function endSession(req, res) {
  const t = readCookie(req);
  if (t) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(t));
  res.setHeader('Set-Cookie', `${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${PROD ? '; Secure' : ''}`);
}
// Người đang gọi: phiên đăng nhập (admin/staff) hoặc token của agent lên idea tự động.
function whoIs(req) {
  const auth = req.headers.authorization || '';
  const agentToken = process.env.AGENT_TOKEN || '';
  if (agentToken.length >= 24 && auth.startsWith('Bearer ')) {
    const got = Buffer.from(sha(auth.slice(7).trim())), want = Buffer.from(sha(agentToken));
    return crypto.timingSafeEqual(got, want) ? { id: 'agent', username: 'agent', name: 'Agent tự động', role: 'agent' } : null;
  }
  const t = readCookie(req);
  if (!t) return null;
  const row = db.prepare(`SELECT u.id, u.username, u.name, u.role, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND u.active = 1`).get(sha(t));
  if (!row || row.expires_at < Date.now()) return null;
  return { id: row.id, username: row.username, name: row.name, role: row.role };
}
setInterval(() => db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now()), 3600e3).unref();

// Chặn dò mật khẩu: tối đa 8 lần sai / 15 phút cho mỗi IP + tên đăng nhập.
const fails = new Map();
const failKey = (req, u) => `${req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress}|${u}`;
const tooMany = (k) => { const f = fails.get(k); return f && f.n >= 8 && Date.now() - f.t < 15 * 60e3; };
const noteFail = (k) => { const f = fails.get(k); fails.set(k, f && Date.now() - f.t < 15 * 60e3 ? { n: f.n + 1, t: f.t } : { n: 1, t: Date.now() }); };

// ---------- Idea ----------
const STR = { thoiGian: 100, loai: 200, mucTieu: 60, idea: 8000, nguoiPhatNgon: 100, tinhTrang: 40, ketQua: 40, linkMau: 2000, linkFinal: 2000, why: 3000, gopY: 3000, sanPham: 80, source: 20 };
const REVIEW = ['cho', 'duyet', 'khong'];
function cleanIdea(input, { partial = false } = {}) {
  const out = {};
  for (const [k, max] of Object.entries(STR)) if (input[k] !== undefined) out[k] = String(input[k] ?? '').slice(0, max);
  if (input.soLuong !== undefined) out.soLuong = Math.min(50, Math.max(1, Number.parseInt(input.soLuong, 10) || 1));
  if (input.duyet !== undefined) out.duyet = REVIEW.includes(input.duyet) ? input.duyet : 'cho';
  if (input.day !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(input.day))) throw new Error('Ngày không hợp lệ (cần YYYY-MM-DD).');
    out.day = String(input.day);
  }
  if (!partial) {
    if (!out.day) throw new Error('Thiếu ngày.');
    if (!String(out.idea || '').trim()) throw new Error('Thiếu nội dung idea.');
  }
  return out;
}
const rowToIdea = (r) => ({ id: r.id, ...JSON.parse(r.data), day: r.day, createdAt: r.created_at });
function listIdeas({ from, limit = 2000 } = {}) {
  const rows = from
    ? db.prepare('SELECT * FROM ideas WHERE day >= ? ORDER BY day DESC, created_at ASC LIMIT ?').all(from, limit)
    : db.prepare('SELECT * FROM ideas ORDER BY day DESC, created_at ASC LIMIT ?').all(limit);
  return rows.map(rowToIdea);
}
function createIdea(input, by) {
  const d = cleanIdea(input);
  const id = /^[A-Za-z0-9_-]{4,60}$/.test(String(input.id || '')) ? String(input.id) : newId();
  if (db.prepare('SELECT 1 FROM ideas WHERE id = ?').get(id)) throw Object.assign(new Error(`Idea ${id} đã có.`), { code: 409 });
  const createdAt = typeof input.createdAt === 'string' && !Number.isNaN(Date.parse(input.createdAt)) ? input.createdAt : new Date().toISOString();
  const data = { tinhTrang: '⏳ Chưa làm', ketQua: '', linkMau: '', linkFinal: '', why: '', gopY: '', soLuong: 1, nguoiPhatNgon: 'Enzy', ...d, duyet: by.role === 'agent' ? 'cho' : (d.duyet || 'cho'), source: d.source || (by.role === 'agent' ? 'agent' : 'tay') };
  delete data.day;
  db.prepare('INSERT INTO ideas (id, day, created_at, data) VALUES (?, ?, ?, ?)').run(id, d.day, createdAt, JSON.stringify(data));
  return rowToIdea(db.prepare('SELECT * FROM ideas WHERE id = ?').get(id));
}
function updateIdea(id, patch, by) {
  const row = db.prepare('SELECT * FROM ideas WHERE id = ?').get(id);
  if (!row) throw Object.assign(new Error('Không tìm thấy idea.'), { code: 404 });
  const d = cleanIdea(patch, { partial: true });
  const data = { ...JSON.parse(row.data), ...d };
  if (d.duyet && d.duyet !== 'cho') { data.duyetLuc = new Date().toISOString(); data.duyetBoi = by.name || by.username; }
  data.updatedAt = new Date().toISOString();
  const day = d.day || row.day;
  delete data.day;
  db.prepare('UPDATE ideas SET day = ?, data = ? WHERE id = ?').run(day, JSON.stringify(data), id);
  return rowToIdea(db.prepare('SELECT * FROM ideas WHERE id = ?').get(id));
}

// ---------- Kịch bản: viết từ idea leader đã duyệt; leader duyệt / không duyệt kịch bản ----------
// Theo sheet kịch bản của team: TÊN CONTENT · VOICE · CẢNH QUAY · TEXT · CAPTION · CTA
const SCRIPT_STR = { daSua: 2000, tieuDe: 300, voice: 12000, canhQuay: 12000, textMH: 500, caption: 6000, cta: 300, thoiLuong: 60, hook: 1000, ghiChu: 4000, kichBan: 20000, gopY: 3000 };
function cleanScenes(list) {
  if (!Array.isArray(list)) return undefined;
  return list.slice(0, 40).map((c) => ({ thoiGian: String(c?.thoiGian ?? '').slice(0, 40), hinhAnh: String(c?.hinhAnh ?? '').slice(0, 2000),
    loiThoai: String(c?.loiThoai ?? '').slice(0, 3000), chu: String(c?.chu ?? '').slice(0, 500) }));
}
function cleanScript(input) {
  const out = {};
  for (const [k, max] of Object.entries(SCRIPT_STR)) if (input[k] !== undefined) out[k] = String(input[k] ?? '').slice(0, max);
  const canh = cleanScenes(input.canh);
  if (canh) out.canh = canh;
  if (Array.isArray(input.hookDuPhong)) out.hookDuPhong = input.hookDuPhong.slice(0, 5).map((h) => String(h).slice(0, 500));
  if (input.duyet !== undefined) out.duyet = REVIEW.includes(input.duyet) ? input.duyet : 'cho';
  return out;
}
const hasBody = (d) => Boolean(String(d.voice || '').trim() || String(d.caption || '').trim() || (d.canh && d.canh.some((c) => c.loiThoai.trim() || c.hinhAnh.trim())) || String(d.kichBan || '').trim());
const rowToScript = (r) => ({ id: r.id, ideaId: r.idea_id, ...JSON.parse(r.data), createdAt: r.created_at });
const BODY_KEYS = ['tieuDe', 'voice', 'canhQuay', 'textMH', 'caption', 'cta', 'thoiLuong', 'hook', 'hookDuPhong', 'canh', 'ghiChu', 'kichBan'];
function createScript(input, by) {
  const ideaId = String(input.ideaId || '');
  const idea = db.prepare('SELECT * FROM ideas WHERE id = ?').get(ideaId);
  if (!idea) throw Object.assign(new Error(`Không có idea ${ideaId}.`), { code: 404 });
  if (JSON.parse(idea.data).duyet !== 'duyet') throw Object.assign(new Error('Chỉ viết kịch bản cho idea leader đã duyệt.'), { code: 400 });
  if (db.prepare('SELECT 1 FROM scripts WHERE idea_id = ?').get(ideaId)) throw Object.assign(new Error(`Idea ${ideaId} đã có kịch bản.`), { code: 409 });
  const d = cleanScript(input);
  if (!hasBody(d)) throw new Error('Thiếu nội dung kịch bản (voice).');
  const id = newId(), now = new Date().toISOString();
  const data = { gopY: '', ...d, duyet: 'cho', version: 1, lichSu: [], source: by.role === 'agent' ? 'agent' : 'tay', updatedAt: now };
  db.prepare('INSERT INTO scripts (id, idea_id, created_at, data) VALUES (?, ?, ?, ?)').run(id, ideaId, now, JSON.stringify(data));
  return rowToScript(db.prepare('SELECT * FROM scripts WHERE id = ?').get(id));
}
function updateScript(id, patch, by) {
  const row = db.prepare('SELECT * FROM scripts WHERE id = ?').get(id);
  if (!row) throw Object.assign(new Error('Không tìm thấy kịch bản.'), { code: 404 });
  const cur = JSON.parse(row.data);
  const d = cleanScript(patch);
  const now = new Date().toISOString();
  const rewrite = BODY_KEYS.some((k) => d[k] !== undefined);
  if (by.role === 'agent') {
    // Agent chỉ được viết lại kịch bản leader không duyệt; bản viết lại quay về Chờ duyệt.
    if (cur.duyet !== 'khong') throw Object.assign(new Error('Agent chỉ viết lại kịch bản bị không duyệt.'), { code: 403 });
    if (!rewrite) throw new Error('Thiếu nội dung viết lại.');
    for (const k of Object.keys(d)) if (!BODY_KEYS.includes(k) && k !== 'daSua') delete d[k];
  }
  const data = { ...cur };
  if (rewrite && (by.role === 'agent' || patch.vietLai)) {
    // Lưu bản cũ + góp ý vào lịch sử, bản mới về Chờ duyệt
    const old = {}; for (const k of BODY_KEYS) if (cur[k] !== undefined) old[k] = cur[k];
    data.lichSu = [...(cur.lichSu || []), { version: cur.version || 1, ...old, gopY: cur.gopY || '', duyet: cur.duyet, luc: now }].slice(-10);
    for (const k of BODY_KEYS) delete data[k];
    const { daSua, ...body } = d;
    Object.assign(data, body, { version: (cur.version || 1) + 1, duyet: 'cho', gopY: '', duyetLuc: undefined, duyetBoi: undefined });
    // Ghi chú để leader nhận ra bản viết lại: góp ý cũ + agent đã sửa gì
    data.vietLai = { gopY: cur.gopY || '', daSua: daSua || '', tuBan: cur.version || 1, luc: now };
  } else if (rewrite) {
    // Leader tự sửa câu chữ: lưu bản trước khi sửa vào lịch sử (agent học cách leader chỉnh), giữ trạng thái duyệt
    const old = {}; for (const k of BODY_KEYS) if (cur[k] !== undefined) old[k] = cur[k];
    const changed = BODY_KEYS.some((k) => d[k] !== undefined && JSON.stringify(d[k]) !== JSON.stringify(cur[k]));
    if (changed) {
      data.lichSu = [...(cur.lichSu || []), { version: cur.version || 1, ...old, gopY: '', duyet: 'sua', luc: now, boi: by.name || by.username }].slice(-10);
      data.version = (cur.version || 1) + 1;
      data.leaderSua = by.name || by.username;
    }
    Object.assign(data, d);
  } else Object.assign(data, d);
  if (d.duyet && d.duyet !== 'cho' && by.role !== 'agent') { data.duyetLuc = now; data.duyetBoi = by.name || by.username; }
  if (!hasBody(data)) throw new Error('Kịch bản không được để trống.');
  data.updatedAt = now;
  db.prepare('UPDATE scripts SET data = ? WHERE id = ?').run(JSON.stringify(data), id);
  return rowToScript(db.prepare('SELECT * FROM scripts WHERE id = ?').get(id));
}

// Agent viết kịch bản ngay khi leader duyệt idea; viết lại khi leader không duyệt kịch bản.
const AGENT = { id: 'agent', username: 'agent', name: 'Agent tự động', role: 'agent' };
const writer = process.env.SCRIPT_WRITER === 'off' ? null : createWriter({
  listIdeas: () => listIdeas(),
  listScripts: () => db.prepare('SELECT * FROM scripts').all().map(rowToScript),
  createScript: (input) => createScript(input, AGENT),
  rewriteScript: (id, input) => updateScript(id, input, AGENT),
  log: (m) => console.log(m),
});
if (writer) writer.kick(5000); // mở web: viết bù cho idea đã duyệt mà chưa có kịch bản

// ---------- HTTP ----------
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  ...(PROD ? { 'Strict-Transport-Security': 'max-age=31536000' } : {}),
};
const send = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...SECURITY_HEADERS }); res.end(JSON.stringify(obj)); };
const fail = (res, code, msg) => send(res, code, { error: msg });
const readBody = (req) => new Promise((resolve, reject) => {
  let s = '';
  req.on('data', (c) => { s += c; if (s.length > 2_000_000) { reject(Object.assign(new Error('Dữ liệu quá lớn.'), { code: 413 })); req.destroy(); } });
  req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch { reject(Object.assign(new Error('JSON không hợp lệ.'), { code: 400 })); } });
  req.on('error', reject);
});
// Chống giả mạo yêu cầu từ trang khác: thao tác ghi bằng cookie phải đến từ chính trang này.
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}
const publicUser = (u) => ({ id: u.id, username: u.username, name: u.name, role: u.role });

async function api(req, res, url) {
  const p = url.pathname;
  const me = whoIs(req);
  if (req.method !== 'GET' && !req.headers.authorization && !sameOrigin(req)) return fail(res, 403, 'Yêu cầu không hợp lệ.');

  if (p === '/api/login' && req.method === 'POST') {
    const b = await readBody(req);
    const u = String(b.username || '').trim().toLowerCase();
    const k = failKey(req, u);
    if (tooMany(k)) return fail(res, 429, 'Sai quá nhiều lần. Thử lại sau 15 phút.');
    const row = db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(u);
    if (!row || !checkPass(b.password || '', row.pass)) { noteFail(k); return fail(res, 401, 'Sai tên đăng nhập hoặc mật khẩu.'); }
    fails.delete(k);
    startSession(res, row.id);
    return send(res, 200, { user: publicUser(row) });
  }
  if (p === '/api/logout' && req.method === 'POST') { endSession(req, res); return send(res, 200, { ok: true }); }
  if (!me) return fail(res, 401, 'Cần đăng nhập.');
  if (p === '/api/me' && req.method === 'GET') return send(res, 200, { user: me });

  const isAdmin = me.role === 'admin';
  // Idea
  if (p === '/api/ideas' && req.method === 'GET') return send(res, 200, { ideas: listIdeas({ from: url.searchParams.get('from') || undefined }) });
  if (p === '/api/ideas' && req.method === 'POST') {
    if (!isAdmin && me.role !== 'agent') return fail(res, 403, 'Chỉ admin được thêm idea.');
    const b = await readBody(req);
    const list = Array.isArray(b.ideas) ? b.ideas : [b];
    if (list.length > 50) return fail(res, 400, 'Tối đa 50 idea mỗi lần.');
    const created = [], errors = [];
    for (const [k, it] of list.entries()) {
      try { created.push(createIdea(it, me)); } catch (e) { errors.push({ index: k, error: e.message }); }
    }
    return send(res, errors.length && !created.length ? 400 : 200, { created, errors });
  }
  const m = /^\/api\/ideas\/([A-Za-z0-9_-]{1,60})$/.exec(p);
  if (m) {
    if (!isAdmin) return fail(res, 403, 'Chỉ admin được sửa hoặc xoá idea.');
    if (req.method === 'PATCH') {
      const idea = updateIdea(m[1], await readBody(req), me);
      if (idea.duyet === 'duyet') writer?.kick();
      return send(res, 200, { idea });
    }
    if (req.method === 'DELETE') {
      const r = db.prepare('DELETE FROM ideas WHERE id = ?').run(m[1]);
      if (r.changes) db.prepare('DELETE FROM scripts WHERE idea_id = ?').run(m[1]);
      return r.changes ? send(res, 200, { ok: true }) : fail(res, 404, 'Không tìm thấy idea.');
    }
  }
  // Kịch bản: mọi người xem; agent/admin viết; admin duyệt, góp ý, sửa, xoá
  if (p === '/api/scripts' && req.method === 'GET') {
    let rows = db.prepare('SELECT * FROM scripts ORDER BY created_at DESC LIMIT 2000').all().map(rowToScript);
    const dv = url.searchParams.get('duyet');
    if (dv && REVIEW.includes(dv)) rows = rows.filter((x) => x.duyet === dv);
    return send(res, 200, { scripts: rows, writer: writer ? writer.status() : { off: true } });
  }
  if (p === '/api/scripts/retry' && req.method === 'POST') {
    if (!isAdmin) return fail(res, 403, 'Chỉ admin.');
    if (!writer) return fail(res, 400, 'Agent viết kịch bản đang tắt.');
    writer.retry(String((await readBody(req)).ideaId || ''));
    return send(res, 200, { ok: true });
  }
  if (p === '/api/scripts' && req.method === 'POST') {
    if (!isAdmin && me.role !== 'agent') return fail(res, 403, 'Chỉ admin hoặc agent được thêm kịch bản.');
    const b = await readBody(req);
    const list = Array.isArray(b.scripts) ? b.scripts : [b];
    if (list.length > 30) return fail(res, 400, 'Tối đa 30 kịch bản mỗi lần.');
    const created = [], errors = [];
    for (const [k, it] of list.entries()) {
      try { created.push(createScript(it, me)); } catch (e) { errors.push({ index: k, ideaId: it?.ideaId, error: e.message }); }
    }
    return send(res, errors.length && !created.length ? 400 : 200, { created, errors });
  }
  const sm = /^\/api\/scripts\/([A-Za-z0-9_-]{1,60})$/.exec(p);
  if (sm) {
    if (req.method === 'PATCH') {
      if (!isAdmin && me.role !== 'agent') return fail(res, 403, 'Chỉ admin được duyệt hoặc sửa kịch bản.');
      const script = updateScript(sm[1], await readBody(req), me);
      if (script.duyet === 'khong') writer?.kick();
      return send(res, 200, { script });
    }
    if (req.method === 'DELETE') {
      if (!isAdmin) return fail(res, 403, 'Chỉ admin được xoá kịch bản.');
      const r = db.prepare('DELETE FROM scripts WHERE id = ?').run(sm[1]);
      return r.changes ? send(res, 200, { ok: true }) : fail(res, 404, 'Không tìm thấy kịch bản.');
    }
  }
  // Video mẫu: mọi người xem; admin thêm/xoá; agent đánh dấu đã dùng
  if (p === '/api/videos' && req.method === 'GET') {
    const s = url.searchParams.get('status');
    const rows = s && VIDEO_STATUS.includes(s)
      ? db.prepare('SELECT * FROM videos WHERE status = ? ORDER BY created_at DESC').all(s)
      : db.prepare('SELECT * FROM videos ORDER BY created_at DESC LIMIT 500').all();
    return send(res, 200, { videos: rows.map(rowToVideo) });
  }
  if (p === '/api/videos' && req.method === 'POST') {
    if (!isAdmin && me.role !== 'agent') return fail(res, 403, 'Chỉ admin được thêm video mẫu.');
    const b = await readBody(req);
    // Agent đề xuất từng video kèm ghi chú + lời thoại (nếu đã chép); luôn vào trạng thái chờ leader chọn
    if (me.role === 'agent') {
      const list = Array.isArray(b.videos) ? b.videos.slice(0, 30) : [];
      const added = [], skipped = [];
      for (const v of list) {
        const u = String(v.url || '').trim();
        if (!/^https:\/\/(?:[\w-]+\.)*facebook\.com\/\S+$/i.test(u) && !VIDEO_URL.test(u)) { skipped.push(u); continue; }
        if (db.prepare('SELECT 1 FROM videos WHERE url = ?').get(u)) { skipped.push(u); continue; }
        const id = newId();
        db.prepare("INSERT INTO videos (id, url, note, san_pham, status, transcript, duration, added_by, created_at) VALUES (?, ?, ?, ?, 'de_xuat', ?, ?, ?, ?)")
          .run(id, u, String(v.note || '').slice(0, 1000), String(v.sanPham || '').slice(0, 80), String(v.transcript || '').slice(0, 20000), Number(v.duration) || null, 'Agent đề xuất', new Date().toISOString());
        added.push(id);
      }
      return send(res, 200, { added: added.length, skipped });
    }
    // Bỏ dấu ngoặc/dấu phẩy dính kèm khi chép từ ô Lark/Google Sheet
    const urls = [...new Set(String(b.urls || b.url || '').split(/[\s,;]+/).map((u) => u.trim().replace(/^["'“”‘’<(\[]+|["'“”‘’>)\].,;]+$/g, '')).filter(Boolean))];
    if (!urls.length) return fail(res, 400, 'Dán ít nhất 1 link video.');
    if (urls.length > 30) return fail(res, 400, 'Tối đa 30 link mỗi lần.');
    const bad = urls.filter((u) => !VIDEO_URL.test(u));
    if (bad.length) return fail(res, 400, `Link không phải video Facebook/TikTok/YouTube/Instagram: ${bad.slice(0, 3).join(', ')}`);
    const added = [], skipped = [];
    for (const u of urls) {
      if (db.prepare('SELECT 1 FROM videos WHERE url = ?').get(u)) { skipped.push(u); continue; }
      const id = newId();
      db.prepare('INSERT INTO videos (id, url, note, san_pham, added_by, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, u, String(b.note || '').slice(0, 1000), String(b.sanPham || '').slice(0, 80), me.name || me.username, new Date().toISOString());
      added.push(id);
    }
    transcribeQueue();
    return send(res, 200, { added: added.length, skipped });
  }
  const vm = /^\/api\/videos\/([A-Za-z0-9_-]{1,40})$/.exec(p);
  if (vm) {
    const v = db.prepare('SELECT * FROM videos WHERE id = ?').get(vm[1]);
    if (!v) return fail(res, 404, 'Không tìm thấy video.');
    if (req.method === 'PATCH') {
      if (!isAdmin && me.role !== 'agent') return fail(res, 403, 'Không có quyền.');
      const b = await readBody(req);
      if (b.status !== undefined) {
        if (!['moi', 'san_sang', 'da_dung', 'bo'].includes(b.status)) return fail(res, 400, 'Trạng thái không hợp lệ.');
        if (b.status === 'bo' && !isAdmin) return fail(res, 403, 'Chỉ admin được bỏ video.');
        // Leader chọn "Dùng" video agent đề xuất: đã có lời thoại thì sẵn sàng luôn, chưa có thì đưa vào hàng chép lời
        if (v.status === 'de_xuat' && b.status === 'moi' && v.transcript) b.status = 'san_sang';
        db.prepare('UPDATE videos SET status = ?, used_at = ? WHERE id = ?').run(b.status, b.status === 'da_dung' ? new Date().toISOString() : null, v.id);
        if (b.status === 'moi') { db.prepare("UPDATE videos SET transcript = '', error = '' WHERE id = ?").run(v.id); transcribeQueue(); }
      }
      // Lời thoại chép theo cách khác (vd video Thư viện quảng cáo lấy qua trình duyệt)
      if (typeof b.transcript === 'string' && b.transcript.trim()) {
        db.prepare("UPDATE videos SET transcript = ?, duration = ?, error = '', status = CASE WHEN status IN ('da_dung', 'de_xuat', 'bo') THEN status ELSE 'san_sang' END WHERE id = ?")
          .run(b.transcript.slice(0, 20000), Number(b.duration) || null, v.id);
      }
      if (Array.isArray(b.ideaIds)) {
        const ids = [...new Set([...JSON.parse(v.idea_ids || '[]'), ...b.ideaIds.map(String)])].slice(0, 100);
        db.prepare('UPDATE videos SET idea_ids = ? WHERE id = ?').run(JSON.stringify(ids), v.id);
      }
      if (isAdmin && b.note !== undefined) db.prepare('UPDATE videos SET note = ? WHERE id = ?').run(String(b.note).slice(0, 1000), v.id);
      if (isAdmin && b.sanPham !== undefined) db.prepare('UPDATE videos SET san_pham = ? WHERE id = ?').run(String(b.sanPham).slice(0, 80), v.id);
      return send(res, 200, { video: rowToVideo(db.prepare('SELECT * FROM videos WHERE id = ?').get(v.id)) });
    }
    if (req.method === 'DELETE') {
      if (!isAdmin) return fail(res, 403, 'Chỉ admin được xoá video mẫu.');
      db.prepare('DELETE FROM videos WHERE id = ?').run(v.id);
      return send(res, 200, { ok: true });
    }
  }
  // Tài khoản (chỉ admin)
  if (p === '/api/users') {
    if (!isAdmin) return fail(res, 403, 'Chỉ admin quản lý tài khoản.');
    if (req.method === 'GET') return send(res, 200, { users: db.prepare('SELECT id, username, name, role, active, created_at FROM users ORDER BY role, username').all() });
    if (req.method === 'POST') {
      const b = await readBody(req);
      const u = String(b.username || '').trim().toLowerCase();
      if (!validUsername(u)) return fail(res, 400, 'Tên đăng nhập 3-40 ký tự, chỉ gồm a-z, 0-9, dấu . _ -');
      if (!validPassword(b.password)) return fail(res, 400, 'Mật khẩu tối thiểu 8 ký tự.');
      const role = b.role === 'admin' ? 'admin' : 'staff';
      if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(u)) return fail(res, 409, 'Tên đăng nhập đã có.');
      const id = newId();
      db.prepare('INSERT INTO users (id, username, name, role, pass, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, u, String(b.name || u).slice(0, 80), role, hashPass(b.password), new Date().toISOString());
      return send(res, 200, { user: { id, username: u, name: String(b.name || u), role, active: 1 } });
    }
  }
  const um = /^\/api\/users\/([A-Za-z0-9_-]{1,40})$/.exec(p);
  if (um) {
    const target = db.prepare('SELECT * FROM users WHERE id = ?').get(um[1]);
    const self = target && target.id === me.id;
    if (!target) return fail(res, 404, 'Không tìm thấy tài khoản.');
    if (!isAdmin && !self) return fail(res, 403, 'Không có quyền.');
    const activeAdmins = () => db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1").get().n;
    if (req.method === 'PATCH') {
      const b = await readBody(req);
      if (b.password !== undefined) {
        if (!validPassword(b.password)) return fail(res, 400, 'Mật khẩu tối thiểu 8 ký tự.');
        if (self && !checkPass(b.currentPassword || '', target.pass)) return fail(res, 400, 'Mật khẩu hiện tại không đúng.');
        db.prepare('UPDATE users SET pass = ? WHERE id = ?').run(hashPass(b.password), target.id);
        db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(target.id, sha(readCookie(req)));
      }
      if (isAdmin && b.name !== undefined) db.prepare('UPDATE users SET name = ? WHERE id = ?').run(String(b.name).slice(0, 80), target.id);
      if (isAdmin && b.active !== undefined) {
        if (!b.active && target.role === 'admin' && activeAdmins() <= 1) return fail(res, 400, 'Không thể khoá admin cuối cùng.');
        db.prepare('UPDATE users SET active = ? WHERE id = ?').run(b.active ? 1 : 0, target.id);
        if (!b.active) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(target.id);
      }
      return send(res, 200, { ok: true });
    }
    if (req.method === 'DELETE') {
      if (!isAdmin) return fail(res, 403, 'Không có quyền.');
      if (target.role === 'admin' && activeAdmins() <= 1) return fail(res, 400, 'Không thể xoá admin cuối cùng.');
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(target.id);
      db.prepare('DELETE FROM users WHERE id = ?').run(target.id);
      return send(res, 200, { ok: true });
    }
  }
  return fail(res, 404, 'Không có đường dẫn này.');
}

const INDEX = path.join(HERE, 'public', 'index.html');
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (req.method === 'GET' && url.pathname === '/healthz') return send(res, 200, { ok: true });
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache', ...SECURITY_HEADERS });
      return fs.createReadStream(INDEX).pipe(res);
    }
    res.writeHead(404, SECURITY_HEADERS); res.end('Not found');
  } catch (e) {
    const code = Number(e.code) >= 400 && Number(e.code) < 600 ? Number(e.code) : (e instanceof SyntaxError || /không hợp lệ|Thiếu/.test(e.message) ? 400 : 500);
    if (code === 500) console.error('[kho-idea]', e);
    if (!res.headersSent) fail(res, code, code === 500 ? 'Lỗi máy chủ.' : e.message);
  }
});
server.listen(PORT, () => console.log(`Kho Idea Enzy: http://localhost:${PORT} (dữ liệu: ${DATA_DIR})`));
