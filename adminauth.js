import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Xác thực quản trị (Admin ID + mật khẩu) cho các thao tác sửa/xoá agent, đổi cấu hình…
//  - Mật khẩu chỉ lưu dạng băm scrypt trong data/admin.json (quyền 600); có thể đặt ADMIN_ID + ADMIN_PASSWORD bằng biến môi trường thay thế.
//  - Thiết lập lần đầu chỉ được làm từ chính máy chạy server (loopback) để người khác trong mạng không chiếm quyền.
//  - Phiên đăng nhập: cookie HttpOnly + SameSite=Strict, hết hạn sau 30 phút không hoạt động; sai 5 lần thì khoá 5 phút theo địa chỉ IP.
const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data', 'admin.json');
const IDLE_MS = 30 * 60 * 1000, MAX_FAILS = 5, LOCK_MS = 5 * 60 * 1000;
const COOKIE = 'ao_admin';
const sessions = new Map();   // token → { id, exp }
const fails = new Map();      // ip → { n, until }

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
const same = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));

function load() {
  const eid = process.env.ADMIN_ID, epw = process.env.ADMIN_PASSWORD;
  if (eid && epw) return { id: eid, env: true, pw: epw };
  try { const j = JSON.parse(fs.readFileSync(FILE, 'utf8')); return j?.id && j.hash && j.salt ? j : null; } catch { return null; }
}
const hash = (pw, salt) => crypto.scryptSync(String(pw), Buffer.from(salt, 'hex'), 64).toString('hex');
function save(id, pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE + '.tmp', JSON.stringify({ id, salt, hash: hash(pw, salt), algo: 'scrypt', updated: new Date().toISOString() }), { mode: 0o600 });
  fs.renameSync(FILE + '.tmp', FILE);
}
function matches(a, id, pw) {
  if (!a) return false;
  const okId = same(id ?? '', a.id);
  const okPw = a.env ? same(pw ?? '', a.pw) : crypto.timingSafeEqual(Buffer.from(hash(pw ?? '', a.salt), 'hex'), Buffer.from(a.hash, 'hex'));
  return okId && okPw;
}

export const isConfigured = () => Boolean(load());
export const ip = (req) => String(req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
// "Từ chính máy này": kết nối đến từ loopback HOẶC từ chính địa chỉ mạng của máy (vd mở bằng http://192.168.x.x:3000 trên cùng máy). Máy khác không thể giả địa chỉ nguồn của máy này.
const ownAddresses = () => new Set(Object.values(os.networkInterfaces()).flat().filter(Boolean).map((i) => i.address.split('%')[0]));
export const isLoopback = (req) => {
  if (req.headers['x-forwarded-for']) return false;
  const a = ip(req);
  return ['127.0.0.1', '::1'].includes(a) || ownAddresses().has(a);
};

const cookieOf = (req) => (String(req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([a-f0-9]{64})`)) || [])[1];
const setCookie = (res, token, maxAge) => res.setHeader('set-cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}`);

export function session(req) {
  const t = cookieOf(req), s = t && sessions.get(t);
  if (!s) return null;
  if (s.exp < Date.now()) { sessions.delete(t); return null; }
  s.exp = Date.now() + IDLE_MS; // gia hạn khi còn hoạt động
  return s;
}
export const check = (req) => Boolean(isConfigured() && session(req));

function start(req, res, id) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { id, exp: Date.now() + IDLE_MS });
  setCookie(res, token, IDLE_MS / 1000);
}

export function status(req) {
  const s = session(req);
  return { configured: isConfigured(), loggedIn: Boolean(s), id: s?.id || '', canSetup: isLoopback(req), env: Boolean(load()?.env) };
}

const validId = (id) => /^[\w.@-]{3,32}$/.test(String(id || ''));
const validPw = (pw) => typeof pw === 'string' && pw.length >= 8 && pw.length <= 200;

// Dùng cho script dòng lệnh (scripts/set-admin.mjs): đặt/đổi Admin trực tiếp trên máy chạy server.
export function setCredentials(id, pw) {
  if (!validId(id)) throw new Error('Admin ID dài 3–32 ký tự (chữ, số, _ . @ -).');
  if (!validPw(pw)) throw new Error('Mật khẩu tối thiểu 8 ký tự.');
  save(id, pw);
}

// Trả về { ok, error?, code? }.
export function setup(req, res, id, pw) {
  if (isConfigured()) return { ok: false, code: 409, error: 'Admin đã được thiết lập.' };
  if (!isLoopback(req)) return { ok: false, code: 403, error: 'Chỉ thiết lập Admin lần đầu từ chính máy chạy server (localhost).' };
  if (!validId(id)) return { ok: false, code: 400, error: 'Admin ID dài 3–32 ký tự (chữ, số, _ . @ -).' };
  if (!validPw(pw)) return { ok: false, code: 400, error: 'Mật khẩu tối thiểu 8 ký tự.' };
  save(id, pw);
  start(req, res, id);
  return { ok: true };
}

export async function login(req, res, id, pw) {
  const key = ip(req), f = fails.get(key);
  if (f && f.until > Date.now()) return { ok: false, code: 429, error: `Sai quá nhiều lần, thử lại sau ${Math.ceil((f.until - Date.now()) / 60000)} phút.` };
  if (!isConfigured()) return { ok: false, code: 409, error: 'Chưa thiết lập Admin.' };
  if (matches(load(), id, pw)) { fails.delete(key); start(req, res, load().id); return { ok: true }; }
  const n = (f?.n || 0) + 1;
  fails.set(key, { n, until: n >= MAX_FAILS ? Date.now() + LOCK_MS : 0 });
  await new Promise((r) => setTimeout(r, 500)); // làm chậm việc dò mật khẩu
  return { ok: false, code: 401, error: n >= MAX_FAILS ? 'Sai quá nhiều lần, đã khoá 5 phút.' : `Admin ID hoặc mật khẩu không đúng (${n}/${MAX_FAILS}).` };
}

// Thao tác nhạy cảm (sửa/xoá agent): ngoài phiên đăng nhập còn phải nhập lại mật khẩu Admin cho CHÍNH thao tác đó.
export const NEEDS_REAUTH = new Set(['/agent/save', '/agent/delete']);
export async function reauth(req, pw) {
  const key = ip(req), f = fails.get(key), a = load();
  if (f && f.until > Date.now()) return { ok: false, error: `Sai quá nhiều lần, thử lại sau ${Math.ceil((f.until - Date.now()) / 60000)} phút.` };
  if (a && typeof pw === 'string' && matches(a, a.id, pw)) { fails.delete(key); return { ok: true }; }
  const n = (f?.n || 0) + 1;
  fails.set(key, { n, until: n >= MAX_FAILS ? Date.now() + LOCK_MS : 0 });
  await new Promise((r) => setTimeout(r, 500));
  return { ok: false, error: 'Mật khẩu Admin không đúng.' };
}

export function logout(req, res) {
  const t = cookieOf(req); if (t) sessions.delete(t);
  setCookie(res, '', 0);
}

// Đổi mật khẩu (và/hoặc Admin ID): cần đang đăng nhập và nhập đúng mật khẩu hiện tại.
export function change(req, res, current, newId, newPw) {
  const s = session(req), a = load();
  if (!s || !a) return { ok: false, code: 401, error: 'Cần đăng nhập Admin.' };
  if (a.env) return { ok: false, code: 400, error: 'Admin đang đặt bằng biến môi trường ADMIN_ID/ADMIN_PASSWORD; hãy đổi ở đó.' };
  if (!matches(a, a.id, current)) return { ok: false, code: 401, error: 'Mật khẩu hiện tại không đúng.' };
  const id = newId ? String(newId) : a.id;
  if (!validId(id)) return { ok: false, code: 400, error: 'Admin ID dài 3–32 ký tự (chữ, số, _ . @ -).' };
  if (newPw && !validPw(newPw)) return { ok: false, code: 400, error: 'Mật khẩu mới tối thiểu 8 ký tự.' };
  save(id, newPw || current);
  sessions.clear();          // buộc đăng nhập lại ở mọi nơi
  start(req, res, id);
  return { ok: true };
}

// Các thao tác cần quyền Admin (sửa/xoá agent, đổi cấu hình, quyền, dữ liệu).
const PROTECTED = new Set(['/agent/save', '/agent/delete', '/config/save', '/auth/connect', '/auth/login/start', '/auth/login/code', '/auth/login/cancel', '/auth/login/status',
  '/enzy/config/save', '/enzy/schedule', '/usage/limit', '/memory/clear', '/revoke', '/reports/delete']);
export function needsAdmin(pathname, body) {
  if (PROTECTED.has(pathname)) return true;
  if (pathname === '/learn/act') return body?.action !== 'feedback'; // đánh giá kết quả của CEO là thao tác thường
  return false;
}
