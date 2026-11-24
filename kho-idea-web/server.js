// Kho Idea Enzy — website độc lập: đăng nhập riêng, admin toàn quyền, nhân viên chỉ xem.
// Không cần thư viện ngoài: Node >= 22.13 (node:sqlite có sẵn). Dữ liệu nằm trong DATA_DIR (ổ lưu trữ bền trên cloud).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

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
`);

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
    if (req.method === 'PATCH') return send(res, 200, { idea: updateIdea(m[1], await readBody(req), me) });
    if (req.method === 'DELETE') {
      const r = db.prepare('DELETE FROM ideas WHERE id = ?').run(m[1]);
      return r.changes ? send(res, 200, { ok: true }) : fail(res, 404, 'Không tìm thấy idea.');
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
