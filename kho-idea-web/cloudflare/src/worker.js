// Kho Idea Enzy trên Cloudflare Workers + D1 (miễn phí, chạy 24/7).
// Cùng API với server.js (bản Node): giao diện public/index.html dùng chung.
// Bí mật đặt bằng `wrangler secret`: ADMIN_USERNAME, ADMIN_PASSWORD (tạo admin lần đầu), AGENT_TOKEN (agent đưa idea lên).

const SESSION_DAYS = 30;
const COOKIE = '__Host-kid';
const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const unhex = (h) => new Uint8Array(h.match(/../g).map((x) => parseInt(x, 16)));
const sha = async (s) => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
const rand = (n) => crypto.getRandomValues(new Uint8Array(n));
const b64url = (u8) => btoa(String.fromCharCode(...u8)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const newId = () => b64url(rand(9));
const ITER = 100000; // giới hạn tối đa của PBKDF2 trên Workers

async function pbkdf2(pw, salt) {
  const key = await crypto.subtle.importKey('raw', enc.encode(String(pw)), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITER }, key, 256));
}
async function hashPass(pw) { const salt = rand(16); return `pbkdf2$${ITER}$${hex(salt)}$${hex(await pbkdf2(pw, salt))}`; }
function sameBytes(a, b) { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i]; return d === 0; }
async function checkPass(pw, stored) {
  const [kind, , saltHex, hashHex] = String(stored).split('$');
  if (kind !== 'pbkdf2' || !saltHex || !hashHex) return false;
  return sameBytes(await pbkdf2(pw, unhex(saltHex)), unhex(hashHex));
}
const validPassword = (pw) => typeof pw === 'string' && pw.length >= 8 && pw.length <= 200;
const validUsername = (u) => typeof u === 'string' && /^[a-z0-9._-]{3,40}$/.test(u);

const HEADERS = {
  'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
  'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'same-origin',
};
const json = (code, obj, extra = {}) => new Response(JSON.stringify(obj), { status: code, headers: { ...HEADERS, ...extra } });
const fail = (code, msg) => json(code, { error: msg });
class HttpError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
async function body(req) {
  const t = await req.text();
  if (t.length > 2_000_000) throw new HttpError(413, 'Dữ liệu quá lớn.');
  try { return t ? JSON.parse(t) : {}; } catch { throw new HttpError(400, 'JSON không hợp lệ.'); }
}

async function seedAdmin(env) {
  if (await env.DB.prepare("SELECT 1 FROM users WHERE role = 'admin' AND active = 1").first()) return;
  const u = String(env.ADMIN_USERNAME || '').trim().toLowerCase(), p = env.ADMIN_PASSWORD;
  if (!validUsername(u) || !validPassword(p)) return;
  await env.DB.prepare('INSERT OR IGNORE INTO users (id, username, name, role, pass, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(newId(), u, 'Admin', 'admin', await hashPass(p), new Date().toISOString()).run();
}

function readCookie(req) {
  const m = /(?:^|;\s*)__Host-kid=([^;]+)/.exec(req.headers.get('cookie') || '');
  return m ? m[1] : '';
}
const cookieHeader = (token, maxAge) => `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

async function whoIs(req, env) {
  const auth = req.headers.get('authorization') || '';
  if ((env.AGENT_TOKEN || '').length >= 24 && auth.startsWith('Bearer ')) {
    const ok = sameBytes(unhex(await sha(auth.slice(7).trim())), unhex(await sha(env.AGENT_TOKEN)));
    return ok ? { id: 'agent', username: 'agent', name: 'Agent tự động', role: 'agent' } : null;
  }
  const t = readCookie(req);
  if (!t) return null;
  const row = await env.DB.prepare(`SELECT u.id, u.username, u.name, u.role, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND u.active = 1`).bind(await sha(t)).first();
  if (!row || row.expires_at < Date.now()) return null;
  return { id: row.id, username: row.username, name: row.name, role: row.role };
}

// ---------- Idea ----------
const STR = { thoiGian: 100, loai: 200, mucTieu: 60, idea: 8000, nguoiPhatNgon: 100, tinhTrang: 40, ketQua: 40, linkMau: 2000, linkFinal: 2000, why: 3000, gopY: 3000, sanPham: 80, source: 20 };
const REVIEW = ['cho', 'duyet', 'khong'];
function cleanIdea(input, { partial = false } = {}) {
  const out = {};
  for (const [k, max] of Object.entries(STR)) if (input[k] !== undefined) out[k] = String(input[k] ?? '').slice(0, max);
  if (input.soLuong !== undefined) out.soLuong = Math.min(50, Math.max(1, Number.parseInt(input.soLuong, 10) || 1));
  if (input.duyet !== undefined) out.duyet = REVIEW.includes(input.duyet) ? input.duyet : 'cho';
  if (input.day !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(input.day))) throw new HttpError(400, 'Ngày không hợp lệ (cần YYYY-MM-DD).');
    out.day = String(input.day);
  }
  if (!partial) {
    if (!out.day) throw new HttpError(400, 'Thiếu ngày.');
    if (!String(out.idea || '').trim()) throw new HttpError(400, 'Thiếu nội dung idea.');
  }
  return out;
}
const rowToIdea = (r) => ({ id: r.id, ...JSON.parse(r.data), day: r.day, createdAt: r.created_at });
async function createIdea(env, input, by) {
  const d = cleanIdea(input);
  const id = /^[A-Za-z0-9_-]{4,60}$/.test(String(input.id || '')) ? String(input.id) : newId();
  if (await env.DB.prepare('SELECT 1 FROM ideas WHERE id = ?').bind(id).first()) throw new HttpError(409, `Idea ${id} đã có.`);
  const createdAt = typeof input.createdAt === 'string' && !Number.isNaN(Date.parse(input.createdAt)) ? input.createdAt : new Date().toISOString();
  const data = { tinhTrang: '⏳ Chưa làm', ketQua: '', linkMau: '', linkFinal: '', why: '', gopY: '', soLuong: 1, nguoiPhatNgon: 'Enzy', ...d,
    duyet: by.role === 'agent' ? 'cho' : (d.duyet || 'cho'), source: d.source || (by.role === 'agent' ? 'agent' : 'tay') };
  delete data.day;
  await env.DB.prepare('INSERT INTO ideas (id, day, created_at, data) VALUES (?, ?, ?, ?)').bind(id, d.day, createdAt, JSON.stringify(data)).run();
  return { id, ...data, day: d.day, createdAt };
}
async function updateIdea(env, id, patch, by) {
  const row = await env.DB.prepare('SELECT * FROM ideas WHERE id = ?').bind(id).first();
  if (!row) throw new HttpError(404, 'Không tìm thấy idea.');
  const d = cleanIdea(patch, { partial: true });
  const data = { ...JSON.parse(row.data), ...d };
  if (d.duyet && d.duyet !== 'cho') { data.duyetLuc = new Date().toISOString(); data.duyetBoi = by.name || by.username; }
  data.updatedAt = new Date().toISOString();
  const day = d.day || row.day;
  delete data.day;
  await env.DB.prepare('UPDATE ideas SET day = ?, data = ? WHERE id = ?').bind(day, JSON.stringify(data), id).run();
  return { id, ...data, day, createdAt: row.created_at };
}

const publicUser = (u) => ({ id: u.id, username: u.username, name: u.name, role: u.role });

async function api(req, env, url) {
  const p = url.pathname, method = req.method;
  if (method !== 'GET' && !req.headers.get('authorization')) {
    const origin = req.headers.get('origin');
    if (origin && new URL(origin).host !== url.host) return fail(403, 'Yêu cầu không hợp lệ.');
  }
  if (p === '/api/login' && method === 'POST') {
    await seedAdmin(env);
    const b = await body(req);
    const u = String(b.username || '').trim().toLowerCase();
    const k = `${req.headers.get('cf-connecting-ip') || ''}|${u}`;
    const f = await env.DB.prepare('SELECT n, t FROM login_fails WHERE k = ?').bind(k).first();
    const recent = f && Date.now() - f.t < 15 * 60e3;
    if (recent && f.n >= 8) return fail(429, 'Sai quá nhiều lần. Thử lại sau 15 phút.');
    const row = await env.DB.prepare('SELECT * FROM users WHERE username = ? AND active = 1').bind(u).first();
    if (!row || !(await checkPass(b.password || '', row.pass))) {
      await env.DB.prepare('INSERT INTO login_fails (k, n, t) VALUES (?, 1, ?) ON CONFLICT(k) DO UPDATE SET n = CASE WHEN ? - t < 900000 THEN n + 1 ELSE 1 END, t = CASE WHEN ? - t < 900000 THEN t ELSE ? END')
        .bind(k, Date.now(), Date.now(), Date.now(), Date.now()).run();
      return fail(401, 'Sai tên đăng nhập hoặc mật khẩu.');
    }
    await env.DB.prepare('DELETE FROM login_fails WHERE k = ?').bind(k).run();
    const token = b64url(rand(32));
    await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').bind(await sha(token), row.id, Date.now() + SESSION_DAYS * 864e5).run();
    return json(200, { user: publicUser(row) }, { 'set-cookie': cookieHeader(token, SESSION_DAYS * 86400) });
  }
  if (p === '/api/logout' && method === 'POST') {
    const t = readCookie(req);
    if (t) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha(t)).run();
    return json(200, { ok: true }, { 'set-cookie': cookieHeader('', 0) });
  }
  const me = await whoIs(req, env);
  if (!me) return fail(401, 'Cần đăng nhập.');
  if (p === '/api/me' && method === 'GET') return json(200, { user: me });
  const isAdmin = me.role === 'admin';

  if (p === '/api/ideas' && method === 'GET') {
    const from = url.searchParams.get('from');
    const q = from && /^\d{4}-\d{2}-\d{2}$/.test(from)
      ? env.DB.prepare('SELECT * FROM ideas WHERE day >= ? ORDER BY day DESC, created_at ASC LIMIT 2000').bind(from)
      : env.DB.prepare('SELECT * FROM ideas ORDER BY day DESC, created_at ASC LIMIT 2000');
    return json(200, { ideas: (await q.all()).results.map(rowToIdea) });
  }
  if (p === '/api/ideas' && method === 'POST') {
    if (!isAdmin && me.role !== 'agent') return fail(403, 'Chỉ admin được thêm idea.');
    const b = await body(req);
    const list = Array.isArray(b.ideas) ? b.ideas : [b];
    if (list.length > 50) return fail(400, 'Tối đa 50 idea mỗi lần.');
    const created = [], errors = [];
    for (const [k, it] of list.entries()) {
      try { created.push(await createIdea(env, it, me)); } catch (e) { errors.push({ index: k, error: e.message }); }
    }
    return json(errors.length && !created.length ? 400 : 200, { created, errors });
  }
  const m = /^\/api\/ideas\/([A-Za-z0-9_-]{1,60})$/.exec(p);
  if (m) {
    if (!isAdmin) return fail(403, 'Chỉ admin được sửa hoặc xoá idea.');
    if (method === 'PATCH') return json(200, { idea: await updateIdea(env, m[1], await body(req), me) });
    if (method === 'DELETE') {
      const r = await env.DB.prepare('DELETE FROM ideas WHERE id = ?').bind(m[1]).run();
      return r.meta.changes ? json(200, { ok: true }) : fail(404, 'Không tìm thấy idea.');
    }
  }
  if (p === '/api/users') {
    if (!isAdmin) return fail(403, 'Chỉ admin quản lý tài khoản.');
    if (method === 'GET') return json(200, { users: (await env.DB.prepare('SELECT id, username, name, role, active, created_at FROM users ORDER BY role, username').all()).results });
    if (method === 'POST') {
      const b = await body(req);
      const u = String(b.username || '').trim().toLowerCase();
      if (!validUsername(u)) return fail(400, 'Tên đăng nhập 3-40 ký tự, chỉ gồm a-z, 0-9, dấu . _ -');
      if (!validPassword(b.password)) return fail(400, 'Mật khẩu tối thiểu 8 ký tự.');
      if (await env.DB.prepare('SELECT 1 FROM users WHERE username = ?').bind(u).first()) return fail(409, 'Tên đăng nhập đã có.');
      const role = b.role === 'admin' ? 'admin' : 'staff', id = newId();
      await env.DB.prepare('INSERT INTO users (id, username, name, role, pass, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(id, u, String(b.name || u).slice(0, 80), role, await hashPass(b.password), new Date().toISOString()).run();
      return json(200, { user: { id, username: u, name: String(b.name || u), role, active: 1 } });
    }
  }
  const um = /^\/api\/users\/([A-Za-z0-9_-]{1,40})$/.exec(p);
  if (um) {
    const target = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(um[1]).first();
    if (!target) return fail(404, 'Không tìm thấy tài khoản.');
    const self = target.id === me.id;
    if (!isAdmin && !self) return fail(403, 'Không có quyền.');
    const activeAdmins = async () => (await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1").first()).n;
    if (method === 'PATCH') {
      const b = await body(req);
      if (b.password !== undefined) {
        if (!validPassword(b.password)) return fail(400, 'Mật khẩu tối thiểu 8 ký tự.');
        if (self && !(await checkPass(b.currentPassword || '', target.pass))) return fail(400, 'Mật khẩu hiện tại không đúng.');
        await env.DB.prepare('UPDATE users SET pass = ? WHERE id = ?').bind(await hashPass(b.password), target.id).run();
        await env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').bind(target.id, await sha(readCookie(req))).run();
      }
      if (isAdmin && b.name !== undefined) await env.DB.prepare('UPDATE users SET name = ? WHERE id = ?').bind(String(b.name).slice(0, 80), target.id).run();
      if (isAdmin && b.active !== undefined) {
        if (!b.active && target.role === 'admin' && (await activeAdmins()) <= 1) return fail(400, 'Không thể khoá admin cuối cùng.');
        await env.DB.prepare('UPDATE users SET active = ? WHERE id = ?').bind(b.active ? 1 : 0, target.id).run();
        if (!b.active) await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(target.id).run();
      }
      return json(200, { ok: true });
    }
    if (method === 'DELETE') {
      if (!isAdmin) return fail(403, 'Không có quyền.');
      if (target.role === 'admin' && (await activeAdmins()) <= 1) return fail(400, 'Không thể xoá admin cuối cùng.');
      await env.DB.batch([env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(target.id), env.DB.prepare('DELETE FROM users WHERE id = ?').bind(target.id)]);
      return json(200, { ok: true });
    }
  }
  return fail(404, 'Không có đường dẫn này.');
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req);
    try { return await api(req, env, url); }
    catch (e) {
      if (e instanceof HttpError) return fail(e.code, e.message);
      console.error(e);
      return fail(500, 'Lỗi máy chủ.');
    }
  },
  // Dọn phiên đăng nhập hết hạn mỗi ngày
  async scheduled(_ev, env) {
    await env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(Date.now()).run();
    await env.DB.prepare('DELETE FROM login_fails WHERE t < ?').bind(Date.now() - 864e5).run();
  },
};
