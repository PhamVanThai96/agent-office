import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG } from './config.js';
import { parseSpec, render } from './imaging.js';
import { parseDocxInput, imagePaths, buildDocx } from './docx.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const STORE = path.join(ROOT, 'permissions.json');

// Quyền đọc và quyền ghi lưu tách biệt: được đọc không có nghĩa là được ghi.
let allowed = [], allowedWrite = [];
try {
  const saved = JSON.parse(fs.readFileSync(STORE, 'utf8'));
  allowed = saved.allowed || [];
  allowedWrite = saved.allowedWrite || [];
} catch { /* chưa có quyền nào được lưu */ }
const save = () => fs.writeFileSync(STORE, JSON.stringify({ allowed, allowedWrite }, null, 2), { mode: 0o600 });
const MAX_WRITE = 200 * 1024;
const MAX_IMG_OUT = 25 * 1024 * 1024;
// Không cho agent ghi vào file chứa khoá API và kho quyền (tránh tự cấp quyền / lộ khoá).
const ROOT_REAL = (() => { try { return fs.realpathSync(ROOT); } catch { return ROOT; } })();
const PROTECTED = ['config.json', 'config.json.tmp', 'permissions.json', 'memory.json', 'memory.json.tmp'].map((f) => path.join(ROOT_REAL, f));
// Agent không được tự sửa kiến thức nền của chính mình (skills/), agents.json và workflows.json.
const PROTECTED_DIRS = [path.join(ROOT_REAL, 'skills')];
const PROTECTED_FILES = ['agents.json', 'workflows.json', 'enzy.json'].map((f) => path.join(ROOT_REAL, f));
// File chứa khoá API / mật khẩu: agent không được đọc kể cả khi người dùng bấm cho phép.
const SECRET = ['config.json', 'enzy.json', 'permissions.json'].map((f) => path.join(ROOT_REAL, f));

const pending = new Map();
let seq = 0;

// Đường dẫn thật (xử lý .. và symlink) để không né được kiểm tra quyền.
function canon(p) {
  const abs = path.resolve(CONFIG.sourceDir, p);
  try { return fs.realpathSync(abs); } catch { return abs; }
}

// File CEO tự kéo thả vào khi giao việc: cho phép đọc trong phiên chạy server, không ghi vào permissions.json.
const sessionRead = new Set();
export function grantRead(p) { sessionRead.add(canon(p)); }

const covered = (c, mode = 'read') => (mode === 'read' && sessionRead.has(c))
  || (mode === 'write' ? allowedWrite : allowed).some((a) => c === a || c.startsWith(a + path.sep));

export const listAllowed = () => [...allowed.map((p) => ({ path: p, mode: 'read' })), ...allowedWrite.map((p) => ({ path: p, mode: 'write' }))];
export const listPending = () => [...pending.values()].map(({ resolve, ...p }) => p);

export function revoke(p, mode = 'read') {
  if (mode === 'write') allowedWrite = allowedWrite.filter((a) => a !== p);
  else allowed = allowed.filter((a) => a !== p);
  save();
}

export function decide(id, allow) {
  const req = pending.get(id);
  if (!req) return false;
  pending.delete(id);
  if (allow && !covered(req.path, req.mode)) {
    (req.mode === 'write' ? allowedWrite : allowed).push(req.path);
    save();
  }
  req.resolve(allow);
  return true;
}

// Trả về true nếu đã có quyền (đã nhớ) hoặc người dùng vừa cho phép.
async function ensureAccess(agent, p, action, onEvent, mode = 'read', c = canon(p)) {
  if (covered(c, mode)) return c;
  const id = `req${++seq}`;
  onEvent?.({ type: 'status', id: agent.id, status: 'waiting' });
  const granted = await new Promise((resolve) => {
    pending.set(id, { id, agent: agent.name, path: c, action, mode, resolve });
    onEvent?.({ type: 'log', from: agent.name, text: `Xin quyền ${action}: ${c}` });
  });
  onEvent?.({ type: 'status', id: agent.id, status: 'working' });
  onEvent?.({ type: 'log', from: 'Hệ thống', text: `${granted ? 'Đã cho phép (ghi nhớ)' : 'Đã từ chối'}: ${c}` });
  return granted ? c : null;
}

// Chuẩn hoá đường dẫn đích để ghi: xử lý symlink ở thư mục cha, chặn file được bảo vệ và thư mục.
// Tên file trần (không thư mục) có đuôi tài liệu/ảnh thì lưu vào reports/ thay vì vứt ở thư mục gốc mã nguồn.
const DOC_EXT = /\.(md|markdown|csv|html?|svg|png|jpe?g|webp|gif|docx)$/i;
const REPORTS_DIR = path.join(ROOT, 'reports');
const toReports = (p) => (typeof p === 'string' && !path.isAbsolute(p) && !/[\\/]/.test(p) && DOC_EXT.test(p) ? path.join(REPORTS_DIR, p) : p);

function target(p) {
  const abs = path.resolve(CONFIG.sourceDir, toReports(p));
  let dirReal = path.dirname(abs);
  for (let d = dirReal; ; d = path.dirname(d)) {
    try { dirReal = path.join(fs.realpathSync(d), path.relative(d, dirReal)); break; } catch { if (d === path.dirname(d)) break; }
  }
  const c = path.join(dirReal, path.basename(abs));
  if (PROTECTED.includes(c) || PROTECTED_FILES.includes(c) || PROTECTED_DIRS.some((d) => c === d || c.startsWith(d + path.sep))) return { error: 'File này được bảo vệ, agent không được ghi.' };
  let exists = false;
  try { const st = fs.statSync(c); exists = true; if (st.isDirectory()) return { error: 'Đường dẫn là thư mục, không phải file.' }; } catch { /* chưa có */ }
  return { c, exists };
}

export function toolsFor(agent, onEvent) {
  const denied = { error: 'Người dùng đã từ chối quyền truy cập.' };
  return {
    async readFile(p) {
      if (SECRET.includes(canon(p))) return { error: 'File chứa thông tin bí mật, agent không được đọc.' };
      const c = await ensureAccess(agent, p, 'đọc file', onEvent);
      if (!c) return denied;
      try { return { content: fs.readFileSync(c, 'utf8').slice(0, 4000) }; } catch (e) { return { error: e.message }; }
    },
    async writeFile(p, content) {
      if (typeof p !== 'string' || !p.trim()) return { error: 'Thiếu đường dẫn file.' };
      if (typeof content !== 'string') return { error: 'content phải là chuỗi văn bản.' };
      if (Buffer.byteLength(content) > MAX_WRITE) return { error: `Nội dung quá lớn (tối đa ${MAX_WRITE / 1024}KB).` };
      const t = target(p);
      if (t.error) return { error: t.error };
      const { c, exists } = t;
      const kb = (Buffer.byteLength(content) / 1024).toFixed(1);
      const g = await ensureAccess(agent, toReports(p), `ghi file (${exists ? 'ghi đè, sẽ sao lưu .bak' : 'tạo mới'}, ${kb}KB)`, onEvent, 'write', c);
      if (!g) return denied;
      try {
        let backup;
        if (exists) { backup = c + '.bak'; fs.copyFileSync(c, backup); }
        fs.mkdirSync(path.dirname(c), { recursive: true });
        fs.writeFileSync(c, content);
        return { ok: true, path: c, bytes: Buffer.byteLength(content), created: !exists, ...(backup ? { backup } : {}) };
      } catch (e) { return { error: e.message }; }
    },
    async makeImage(input) {
      const parsed = parseSpec(input);
      if (parsed.error) return { error: parsed.error };
      const { spec } = parsed;
      // Xin quyền đọc từng ảnh nguồn (ảnh gốc + ảnh chèn) trước khi ghép.
      const paths = { base: '', layers: [] };
      const readImg = async (p) => {
        const c = await ensureAccess(agent, p, 'đọc ảnh', onEvent);
        if (!c) return null;
        try { if (!fs.statSync(c).isFile()) return { error: `${p} không phải file.` }; } catch { return { error: `Không thấy file ${p}.` }; }
        return c;
      };
      if (spec.base) { const c = await readImg(spec.base); if (!c) return denied; if (c.error) return c; paths.base = c; }
      for (const l of spec.layers) {
        if (l.type !== 'image') { paths.layers.push(null); continue; }
        const c = await readImg(l.path); if (!c) return denied; if (c.error) return c;
        paths.layers.push(c);
      }
      const t = target(spec.output);
      if (t.error) return { error: t.error };
      const { c, exists } = t;
      const g = await ensureAccess(agent, toReports(spec.output), `tạo ảnh (${exists ? 'ghi đè, sẽ sao lưu .bak' : 'tạo mới'})`, onEvent, 'write', c);
      if (!g) return denied;
      const r = await render(spec, paths, c);
      if (r.error) return r;
      if (r.data.length > MAX_IMG_OUT) return { error: 'Ảnh tạo ra quá lớn (>25MB), hãy giảm kích thước.' };
      try {
        let backup;
        if (exists) { backup = c + '.bak'; fs.copyFileSync(c, backup); }
        fs.mkdirSync(path.dirname(c), { recursive: true });
        fs.writeFileSync(c, r.data);
        return { ok: true, path: c, width: r.width, height: r.height, bytes: r.data.length, created: !exists, ...(backup ? { backup } : {}), ...(spec.warnings.length ? { warnings: spec.warnings } : {}) };
      } catch (e) { return { error: e.message }; }
    },
    async makeDocx(input) {
      const parsed = parseDocxInput(input);
      if (parsed.error) return { error: parsed.error };
      const { spec } = parsed;
      const images = new Map();
      for (const p of imagePaths(spec.content).slice(0, 10)) {
        const c = await ensureAccess(agent, p, 'đọc ảnh để chèn vào .docx', onEvent);
        if (!c) return denied;
        try {
          const st = fs.statSync(c);
          if (!st.isFile() || st.size > MAX_IMG_OUT) return { error: `${p} không phải file ảnh hợp lệ (tối đa 25MB).` };
          images.set(p, fs.readFileSync(c));
        } catch { return { error: `Không thấy file ảnh ${p}.` }; }
      }
      const t = target(spec.output);
      if (t.error) return { error: t.error };
      const { c, exists } = t;
      const g = await ensureAccess(agent, toReports(spec.output), `tạo tài liệu Word (${exists ? 'ghi đè, sẽ sao lưu .bak' : 'tạo mới'})`, onEvent, 'write', c);
      if (!g) return denied;
      let r;
      try { r = await buildDocx(spec, images); } catch (e) { return { error: `Không tạo được .docx: ${e.message}` }; }
      if (r.data.length > MAX_IMG_OUT) return { error: 'File .docx quá lớn (>25MB).' };
      try {
        let backup;
        if (exists) { backup = c + '.bak'; fs.copyFileSync(c, backup); }
        fs.mkdirSync(path.dirname(c), { recursive: true });
        fs.writeFileSync(c, r.data);
        return { ok: true, path: c, bytes: r.data.length, created: !exists, ...(backup ? { backup } : {}), ...(r.warnings.length ? { warnings: r.warnings } : {}) };
      } catch (e) { return { error: e.message }; }
    },
    async listDir(p) {
      const c = await ensureAccess(agent, p, 'xem thư mục', onEvent);
      if (!c) return denied;
      try { return { entries: fs.readdirSync(c).slice(0, 100) }; } catch (e) { return { error: e.message }; }
    },
  };
}
