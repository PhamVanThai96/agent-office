import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildReport, mdPage } from './report.js';
import { clearMemory, memorySize } from './memory.js';
import { exportFile, formatsFor } from './export.js';
import { AGENTS, ROOMS, aiLabel, rawAgents, setAgents } from './agents.js';
import { CONFIG, settings, saveSettings, connectCLI } from './config.js';
import { createOrchestrator } from './orchestrator.js';
import { withRequest, summary as usageSummary, mini as usageMini, setLimit as setUsageLimit } from './usage.js';
import { makeZip } from './zip.js';
import * as learn from './learn.js';
import * as adminAuth from './adminauth.js';
import { listPending, decide, listAllowed, revoke, grantRead } from './access.js';
import { authStatus, detect, discoverModel, lastModel, onModelFound, loginStart, loginInfo, loginCode, loginCancel } from './cli.js';
import { templates } from './routing.js';
import { skillsFor } from './skills.js';
import { createEnzy, saveSchedule, saveConfig as saveEnzyConfig, publicConfig as enzyConfig } from './enzy/index.js';
import { createInsight, saveInsightStart } from './insight/index.js';

const dir = path.dirname(fileURLToPath(import.meta.url));
const PORT = CONFIG.port;
const history = [];
const state = Object.fromEntries(AGENTS.map((a) => [a.id, { status: 'idle', report: '' }]));
let busy = false;
let agentsVer = 1;
const REPORTS = path.join(dir, 'reports');
fs.mkdirSync(REPORTS, { recursive: true });
let lastCommand = '';
// File kéo thả khi giao việc được lưu ở uploads/<ngày>/; agent chỉ được đọc file đính kèm của task đó.
const UPLOADS = path.join(dir, 'uploads');
const MAX_UPLOAD = 20 * 1024 * 1024;
const MAX_FILES = 10;
const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|srt|vtt|html?|xml|yaml|yml)$/i;
const PREVIEW = 3000;

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (d) => { size += d.length; if (size > limit) { reject(new Error(`File quá lớn (tối đa ${limit / 1024 / 1024}MB).`)); req.destroy(); } else chunks.push(d); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const sameOrigin = (req) => { try { return new URL(req.headers.origin).host === req.headers.host; } catch { return false; } };

async function saveUpload(req) {
  let name;
  try { name = decodeURIComponent(String(req.headers['x-file-name'] || '')); } catch { name = ''; }
  name = path.basename(name).replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_').trim().slice(-120);
  if (!name || name.startsWith('.')) throw new Error('Tên file không hợp lệ.');
  const data = await readBody(req, MAX_UPLOAD);
  if (!data.length) throw new Error('File rỗng.');
  const t = new Date(), p2 = (n) => String(n).padStart(2, '0');
  const day = `${t.getFullYear()}${p2(t.getMonth() + 1)}${p2(t.getDate())}`;
  const rel = `${day}/${p2(t.getHours())}${p2(t.getMinutes())}${p2(t.getSeconds())}-${Math.random().toString(36).slice(2, 6)}-${name}`;
  fs.mkdirSync(path.join(UPLOADS, day), { recursive: true });
  fs.writeFileSync(path.join(UPLOADS, rel), data);
  return { id: rel, name, size: data.length };
}

// Kiểm tra danh sách file đính kèm (chỉ nhận file trong uploads/), cấp quyền đọc và lấy trích đoạn file văn bản.
function attachmentsOf(ids) {
  if (!Array.isArray(ids)) return [];
  return ids.slice(0, MAX_FILES).map((id) => {
    const f = path.join(UPLOADS, path.normalize(String(id)));
    if (!f.startsWith(UPLOADS + path.sep) || !fs.existsSync(f) || !fs.statSync(f).isFile()) throw new Error(`Không thấy file đính kèm "${id}".`);
    grantRead(f);
    const size = fs.statSync(f).size;
    const preview = TEXT_EXT.test(f) ? fs.readFileSync(f, 'utf8').slice(0, PREVIEW) + (size > PREVIEW ? '\n…' : '') : '';
    return { name: path.basename(f).replace(/^\d{6}-[a-z0-9]{4}-/, ''), path: f, size, preview };
  });
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Tiêu đề báo cáo: dòng đầu của lệnh (bỏ "/agent"), để biết nội dung báo cáo chứ không chỉ ngày giờ.
const reportTitle = (cmd) => {
  const t = String(cmd || '').split('\n')[0].replace(/^\/\w+\s+/, '').replace(/\s+/g, ' ').trim();
  return t.length > 100 ? t.slice(0, 99) + '…' : t || 'Báo cáo';
};
const slug = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50).replace(/-+$/, '');

async function saveReport(ev) {
  const t = new Date(), p2 = (n) => String(n).padStart(2, '0');
  const title = reportTitle(lastCommand);
  const name = `bao-cao-${t.getFullYear()}${p2(t.getMonth() + 1)}${p2(t.getDate())}-${p2(t.getHours())}${p2(t.getMinutes())}${p2(t.getSeconds())}${slug(title) ? '-' + slug(title) : ''}.html`;
  fs.writeFileSync(path.join(REPORTS, name), await buildReport(ev, lastCommand, t.toLocaleString('vi-VN'), title));
  ev.title = title;
  return name;
}

// Tiêu đề hiển thị trong danh sách: <title> / "Lệnh:" của báo cáo HTML, dòng "# " đầu của file markdown.
// Báo cáo Enzy tự động được gắn nhãn [Daily]/[Weekly]/[Monthly] ở đầu tiêu đề (cả báo cáo cũ chưa có nhãn) để dễ tìm.
function tagKind(rel, title) {
  if (!title || /^\[(Daily|Weekly|Monthly)\]/.test(title)) return title;
  const k = rel.match(/^enzy\/(daily|weekly|monthly)\//)?.[1]
    || { 'ngày': 'daily', 'tuần': 'weekly', 'tháng': 'monthly' }[(title.match(/Báo cáo (ngày|tuần|tháng) quảng cáo Enzy/i) || [])[1]?.toLowerCase()];
  return k ? `[${k[0].toUpperCase()}${k.slice(1)}] ${title}` : title;
}
function titleOf(rel) { return tagKind(rel, rawTitleOf(rel)); }
function rawTitleOf(rel) {
  try {
    if (!/\.(html?|md)$/i.test(rel)) return '';
    const fd = fs.openSync(path.join(REPORTS, rel), 'r'), buf = Buffer.alloc(24576), n = fs.readSync(fd, buf, 0, 24576, 0); fs.closeSync(fd);
    const head = buf.toString('utf8', 0, n);
    const un = (x) => x.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&').trim();
    if (/\.md$/i.test(rel)) return head.match(/^#\s+(.+)$/m)?.[1].trim() || '';
    const t = head.match(/<title>([^<]*)<\/title>/i)?.[1];
    if (t && un(t) && un(t) !== 'Báo cáo') return un(t);
    const c = head.match(/<b>Lệnh:<\/b>\s*([^<]*)/);
    return c ? reportTitle(un(c[1])) : '';
  } catch { return ''; }
}

// Dashboard do chính app dựng (enzy/**/…-dashboard-content.html): được chạy script trong sandbox không cùng origin.
const DASH = /^enzy\/[^/]+\/\d{8}-dashboard-content\.html$/;

// Ngày của báo cáo để phân loại theo tháng: ngày trong tên file (bao-cao-20261024-…, 20261023-so-lieu…) nếu có, không thì ngày sửa file.
function dayOf(rel, mtime) {
  const m = path.basename(rel).match(/(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(mtime), p2 = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}

// Đường dẫn báo cáo do trình duyệt gửi lên → đường dẫn thật trong reports/ (file thường, không thoát khỏi thư mục).
function reportFiles(list) {
  const out = [];
  for (const raw of Array.isArray(list) ? list.slice(0, 300) : []) {
    const rel = path.normalize(String(raw)), f = path.join(REPORTS, rel);
    if (!f.startsWith(REPORTS + path.sep) || rel.split(path.sep).some((x) => x.startsWith('.'))) continue;
    try { if (fs.statSync(f).isFile()) out.push({ rel: rel.split(path.sep).join('/'), f }); } catch { /* không còn */ }
  }
  return out;
}

function listReports(base = '') {
  const out = [];
  for (const e of fs.readdirSync(path.join(REPORTS, base), { withFileTypes: true })) {
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.name.startsWith('.')) continue;
    if (e.isDirectory()) out.push(...listReports(rel));
    else { const st = fs.statSync(path.join(REPORTS, rel)); out.push({ name: rel, title: titleOf(rel), day: dayOf(rel, st.mtimeMs), size: st.size, mtime: st.mtimeMs, formats: formatsFor(rel) }); }
  }
  return out;
}

let lastAgents = []; // agent tham gia yêu cầu gần nhất (để áp dụng đánh giá của CEO)
function emit(event) {
  if (event.type === 'plan') lastAgents = [...new Set((event.tasks || []).map((t) => t.assignee))];
  if (event.type === 'msg' && event.kind === 'command') lastCommand = event.text;
  if (event.type === 'final') {
    // Dựng báo cáo (có ảnh/bảng/biểu đồ) rồi mới gửi sự kiện, bỏ phần chi tiết nặng khỏi luồng gửi trình duyệt.
    return saveReport(event).catch((e) => console.warn(`[report] ${e.message}`)).then((file) => {
      if (file) event.file = file;
      delete event.details; delete event.artifacts;
      history.push(event);
    });
  }
  if (event.type === 'status') state[event.id] = { status: event.status, report: event.report ?? state[event.id].report };
  history.push(event);
}

// Câu hỏi làm rõ gửi CEO (lên idea mà thiếu thông tin): chờ trả lời trên giao diện, hết hạn sau 2 giờ.
const asks = new Map();
let askSeq = 0;
const askCeo = (payload) => new Promise((resolve) => {
  const id = `ask${++askSeq}`;
  const timer = setTimeout(() => { if (asks.delete(id)) { emit({ type: 'log', from: 'Hệ thống', text: 'Câu hỏi làm rõ đã hết hạn chờ (2 giờ).' }); resolve(null); } }, 2 * 3600e3);
  asks.set(id, { id, ...payload, resolve, timer });
});
// Kho "Ý kiến khách hàng" (cào tuần tự ≤ 7 ngày, chắt lọc thành insight): xem insight/index.js.
const insight = createInsight({ log: (text) => emit({ type: 'log', from: 'Insight', text }), wrap: (label, fn) => withRequest(label, fn) });
const run = createOrchestrator({ emit, state, ask: askCeo, insight });

// Sau mỗi yêu cầu: agent tự cập nhật kỹ năng (hợp nhất bài học, nén skill khi đủ điều kiện) — chạy nền, token ghi riêng trong dashboard.
function scheduleLearn() {
  const t = setTimeout(() => {
    withRequest('Học: agent tự cập nhật kỹ năng', () => learn.flush(AGENTS))
      .then((lines) => lines.forEach((text) => emit({ type: 'log', from: 'Học', text })))
      .catch((e) => console.warn(`[learn] ${e.message}`));
  }, 1500);
  t.unref?.();
}

// Chạy một yêu cầu cho văn phòng (mỗi lần một yêu cầu). Trả Promise xong khi văn phòng xử lý xong.
function startRun(task, files, opts) {
  busy = true;
  return withRequest(opts?.label || task, () => run(task, files, opts))
    .catch((e) => emit({ type: 'log', from: 'Hệ thống', text: `Lỗi: ${e.message}` }))
    .finally(() => { busy = false; emit({ type: 'done' }); scheduleLearn(); });
}

// Báo cáo quảng cáo Enzy tự động (lịch ngày/tuần/tháng, xem enzy/index.js).
const enzy = createEnzy({
  isBusy: () => busy,
  submit: (task, ids, opts) => startRun(task, attachmentsOf(ids), opts),
  uploadsDir: UPLOADS,
  log: (text) => emit({ type: 'log', from: 'Enzy', text }),
});

const readJson = (req) => new Promise((resolve) => {
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve({}); } });
});

const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };
const rmime = {
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.csv': 'text/csv; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');

  if (req.method === 'GET' && url.pathname === '/learn') {
    const o = learn.overview(AGENTS), use = {};
    for (const r of usageSummary().requests) for (const [id, n] of Object.entries(r.agents || {})) { const u = use[id] ||= { tokens: 0, requests: 0 }; u.tokens += n; u.requests++; }
    for (const a of o.agents) a.usage = use[a.id] || { tokens: 0, requests: 0 };
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }).end(JSON.stringify(o));
    return;
  }
  if (req.method === 'GET' && url.pathname === '/admin/status') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }).end(JSON.stringify(adminAuth.status(req)));
    return;
  }
  if (req.method === 'GET' && url.pathname === '/enzy/status') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }).end(JSON.stringify(enzy.statusFull()));
    return;
  }
  if (req.method === 'GET' && url.pathname === '/usage') {
    const mo = url.searchParams.get('month') || '';
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }).end(JSON.stringify(usageSummary(/^\d{4}-\d{2}$/.test(mo) ? mo : undefined)));
    return;
  }
  if (req.method === 'GET' && url.pathname === '/poll') {
    const since = Number(url.searchParams.get('since')) || 0;
    const full = Number(url.searchParams.get('ver')) !== agentsVer;
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({
      next: history.length, mode: CONFIG.mode, connection: CONFIG.connection, provider: CONFIG.provider, model: CONFIG.model, modelLabel: CONFIG.model || (CONFIG.connection === 'CLI' && lastModel(CONFIG.provider)) || CONFIG.modelLabel, sourceDir: CONFIG.sourceDir, modeNote: CONFIG.note, pending: listPending(), allowed: listAllowed(),
      agentsVer,
      agents: full ? AGENTS.map(({ prompt, basePrompt, ...a }) => ({ ...a, prompt: basePrompt, ai: aiLabel(a), skillFiles: skillsFor(a).map((s) => s.title) })) : undefined,
      state: full ? state : undefined,
      rooms: full ? ROOMS : undefined,
      settings: full ? settings() : undefined,
      templates: full ? templates() : undefined,
      enzy: enzy.status(),
      insight: insight.status(),
      asks: [...asks.values()].map(({ resolve, timer, ...a }) => a),
      usage: usageMini(),
      keys: full ? Object.fromEntries(Object.entries(CONFIG.connection === 'CLI' ? CONFIG.cliOk : CONFIG.keys).map(([k, v]) => [k, Boolean(v)])) : undefined,
      events: history.slice(since),
    }));
    return;
  }

  if (req.method === 'GET' && (url.pathname === '/reports' || url.pathname === '/reports/')) {
    if (url.searchParams.has('list')) {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify(listReports().sort((a, b) => b.day.slice(0, 7).localeCompare(a.day.slice(0, 7)) || b.mtime - a.mtime)));
    } else {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      fs.createReadStream(path.join(dir, 'public', 'reports.html')).pipe(res);
    }
    return;
  }
  if (req.method === 'GET' && url.pathname.startsWith('/reports/')) {
    let rel;
    try { rel = decodeURIComponent(url.pathname.slice(9)); } catch { rel = ''; }
    const f = path.join(REPORTS, path.normalize(rel));
    if (!rel || !f.startsWith(REPORTS + path.sep) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404).end('not found'); return; }
    const fmt = url.searchParams.get('export');
    if (fmt) {
      let r;
      try { r = await exportFile(f, fmt); } catch (e) { r = { error: e.message }; }
      if (r.error) { res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }).end(r.error); return; }
      res.writeHead(200, { 'content-type': r.mime, 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(r.name)}`, 'x-content-type-options': 'nosniff', 'cache-control': 'no-store', 'content-length': r.data.length });
      res.end(r.data);
      return;
    }
    // sandbox: HTML/SVG trong reports không chạy script với quyền của trang chính
    if (/\.(md|markdown)$/i.test(f) && !url.searchParams.has('download')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': 'sandbox allow-popups', 'x-content-type-options': 'nosniff', 'cache-control': 'no-store' });
      res.end(mdPage(path.basename(f), fs.readFileSync(f, 'utf8')));
      return;
    }
    const dl = url.searchParams.has('download') ? { 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(f))}` } : {};
    res.writeHead(200, {
      ...dl,
      'content-type': rmime[path.extname(f).toLowerCase()] || 'application/octet-stream',
      'content-security-policy': DASH.test(rel) ? 'sandbox allow-popups allow-scripts' : 'sandbox allow-popups', 'x-content-type-options': 'nosniff', 'cache-control': 'no-store',
    });
    // Excel chỉ nhận đúng UTF-8 khi CSV có BOM; thêm khi tải về nếu file chưa có.
    if (dl['content-disposition'] && path.extname(f).toLowerCase() === '.csv') {
      const head = Buffer.alloc(3); const fd = fs.openSync(f, 'r'); fs.readSync(fd, head, 0, 3, 0); fs.closeSync(fd);
      if (!head.equals(Buffer.from([0xef, 0xbb, 0xbf]))) res.write(Buffer.from([0xef, 0xbb, 0xbf]));
    }
    fs.createReadStream(f).pipe(res);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/upload') {
    if (!sameOrigin(req)) { res.writeHead(403).end('Yêu cầu phải xuất phát từ giao diện cùng máy chủ.'); return; }
    try {
      const r = await saveUpload(req);
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify(r));
    } catch (e) { res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }).end(e.message); }
    return;
  }

  if (req.method === 'POST') {
    const b = await readJson(req);
    // Đăng nhập / thiết lập / đổi mật khẩu Admin.
    if (url.pathname.startsWith('/admin/')) {
      if (!sameOrigin(req)) { res.writeHead(403).end('Yêu cầu phải xuất phát từ giao diện cùng máy chủ.'); return; }
      const out = url.pathname === '/admin/login' ? await adminAuth.login(req, res, String(b.id ?? ''), String(b.password ?? ''))
        : url.pathname === '/admin/setup' ? adminAuth.setup(req, res, String(b.id ?? ''), String(b.password ?? ''))
        : url.pathname === '/admin/change' ? adminAuth.change(req, res, String(b.current ?? ''), b.newId ? String(b.newId) : '', b.newPassword ? String(b.newPassword) : '')
        : url.pathname === '/admin/logout' ? (adminAuth.logout(req, res), { ok: true }) : { ok: false, code: 404, error: 'not found' };
      res.writeHead(out.ok ? 200 : out.code || 400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }).end(JSON.stringify(out));
      return;
    }
    // Thao tác sửa/xoá agent, đổi cấu hình… yêu cầu phiên Admin hợp lệ (cùng Origin).
    if (adminAuth.needsAdmin(url.pathname, b)) {
      if (!sameOrigin(req)) { res.writeHead(403).end('Yêu cầu phải xuất phát từ giao diện cùng máy chủ.'); return; }
      if (!adminAuth.check(req)) {
        const st = adminAuth.status(req);
        res.writeHead(401, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify({ error: st.configured ? 'admin_required' : 'admin_setup_required', canSetup: st.canSetup, message: st.configured ? 'Cần đăng nhập Admin để thực hiện thao tác này.' : 'Chưa thiết lập Admin. Hãy tạo Admin ID và mật khẩu (làm từ máy chạy server).' }));
        return;
      }
      if (adminAuth.NEEDS_REAUTH.has(url.pathname)) {
        const ra = await adminAuth.reauth(req, b.adminPassword);
        if (!ra.ok) { res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify({ error: 'admin_password_wrong', message: ra.error })); return; }
        delete b.adminPassword;
      }
    }
    if (url.pathname === '/learn/act') {
      if (!sameOrigin(req)) { res.writeHead(403).end('Yêu cầu phải xuất phát từ giao diện cùng máy chủ.'); return; }
      const ok = (o = {}) => res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify({ ok: true, ...o }));
      try {
        const id = String(b.id || ''), known = AGENTS.some((a) => a.id === id);
        switch (b.action) {
          case 'settings': ok({ settings: learn.setSettings(b) }); return;
          case 'edit': if (!known) throw new Error('Không có agent này.'); learn.editPlaybook(id, b.playbook); ok(); return;
          case 'lesson': if (!known) throw new Error('Không có agent này.'); if (!learn.addLesson(id, b.text, 'ceo')) throw new Error('Bài học quá ngắn hoặc đã có.'); ok(); return;
          case 'remove': if (!known) throw new Error('Không có agent này.'); learn.removePending(id, Number(b.index)); ok(); return;
          case 'reset': if (!known) throw new Error('Không có agent này.'); learn.resetAgent(id); ok(); return;
          case 'consolidate': {
            const list = b.id === 'all' ? AGENTS : AGENTS.filter((a) => a.id === id);
            if (!list.length) throw new Error('Không có agent này.');
            let n = 0;
            await withRequest('Học: hợp nhất kỹ năng agent', async () => { for (const a of list) n += (await learn.consolidate(a)) || 0; });
            ok({ merged: n }); return;
          }
          case 'feedback': {
            // CEO đánh giá kết quả gần nhất: 👍 ghi nhận được duyệt; 👎 hoặc có nhận xét thì thành bài học cho các agent đã tham gia.
            const who = lastAgents.filter((x) => x !== 'manager' && AGENTS.some((a) => a.id === x));
            if (!who.length) throw new Error('Chưa có yêu cầu nào để đánh giá.');
            const good = b.rating === 'good', note = String(b.text || '').trim();
            const subject = lastCommand ? `"${String(lastCommand).replace(/\s+/g, ' ').slice(0, 60)}"` : 'yêu cầu trước';
            for (const x of who) {
              learn.recordVerdict(x, good);
              if (note) learn.addLesson(x, `CEO ${good ? 'khen' : 'chưa hài lòng'} khi làm ${subject}: ${note}`, 'ceo');
              else if (!good) learn.addLesson(x, `CEO chưa hài lòng với kết quả ${subject}: cần chính xác/ngắn gọn/đúng yêu cầu hơn.`, 'ceo');
            }
            scheduleLearn();
            ok({ agents: who }); return;
          }
          default: throw new Error('Thao tác không hợp lệ.');
        }
      } catch (e) { res.writeHead(400).end(e.message); }
      return;
    }
    if (url.pathname === '/usage/limit') {
      if (!sameOrigin(req)) { res.writeHead(403).end('Yêu cầu phải xuất phát từ giao diện cùng máy chủ.'); return; }
      try { const v = setUsageLimit(b.limit); agentsVer++; res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify({ limit: v })); } catch (e) { res.writeHead(400).end(e.message); }
      return;
    }
    if (url.pathname === '/reports/zip' || url.pathname === '/reports/delete') {
      if (!sameOrigin(req)) { res.writeHead(403).end('Yêu cầu phải xuất phát từ giao diện cùng máy chủ.'); return; }
      const files = reportFiles(b.files);
      if (!files.length) { res.writeHead(400).end('Không có báo cáo nào được chọn.'); return; }
      if (url.pathname === '/reports/zip') {
        const total = files.reduce((n, x) => n + fs.statSync(x.f).size, 0);
        if (total > 200 * 1024 * 1024) { res.writeHead(413).end('Các file chọn quá lớn (tối đa 200MB mỗi lần tải).'); return; }
        const t = new Date(), p2 = (n) => String(n).padStart(2, '0');
        const zip = makeZip(files.map((x) => ({ name: x.rel, data: fs.readFileSync(x.f), mtime: fs.statSync(x.f).mtime })));
        res.writeHead(200, { 'content-type': 'application/zip', 'content-disposition': `attachment; filename="bao-cao-${t.getFullYear()}${p2(t.getMonth() + 1)}${p2(t.getDate())}-${p2(t.getHours())}${p2(t.getMinutes())}.zip"`, 'content-length': zip.length, 'cache-control': 'no-store' }).end(zip);
        return;
      }
      let deleted = 0;
      const failed = [];
      for (const x of files) {
        try {
          fs.unlinkSync(x.f); deleted++;
          // Dọn thư mục con đã rỗng (vd reports/enzy/weekly), không đụng thư mục gốc reports/.
          for (let d = path.dirname(x.f); d !== REPORTS && d.startsWith(REPORTS + path.sep); d = path.dirname(d)) { if (fs.readdirSync(d).length) break; fs.rmdirSync(d); }
        } catch (e) { failed.push(x.rel); }
      }
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }).end(JSON.stringify({ deleted, failed }));
      return;
    }
    if (url.pathname.startsWith('/auth/login')) {
      if (!sameOrigin(req)) { res.writeHead(403).end('Yêu cầu phải xuất phát từ giao diện cùng máy chủ.'); return; }
      const json = (o, code = 200) => res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }).end(JSON.stringify(o));
      const provider = b.provider;
      try {
        if (url.pathname === '/auth/login/start') {
          if (!['claude', 'gpt'].includes(provider)) { res.writeHead(400).end('Chọn Claude hoặc Codex.'); return; }
          const cmd = CONFIG.cliCmd[provider];
          if (!detect(cmd)) { res.writeHead(400).end(`Không tìm thấy CLI "${cmd}". Hãy cài CLI trên máy đang chạy server.`); return; }
          if (busy) { res.writeHead(409).end('Văn phòng đang xử lý yêu cầu; hãy thử lại sau.'); return; }
          json(loginStart(provider, cmd)); return;
        }
        if (url.pathname === '/auth/login/code') { loginCode(String(b.code || '').trim()); json({ ok: true }); return; }
        if (url.pathname === '/auth/login/cancel') { loginCancel(); json(loginInfo()); return; }
        if (url.pathname === '/auth/login/status') {
          const info = loginInfo();
          // CLI thoát mã 0 chưa chắc đã có phiên: xác nhận lại bằng lệnh status trước khi bật REAL.
          if (info.state === 'done' && ['claude', 'gpt'].includes(info.provider) && await authStatus(info.provider, CONFIG.cliCmd[info.provider])) {
            connectCLI(info.provider); agentsVer++;
            json({ ...info, connected: true, message: `${info.provider === 'gpt' ? 'Codex' : 'Claude'} đã đăng nhập. Đã bật REAL qua CLI.` }); return;
          }
          json(info); return;
        }
      } catch (e) { res.writeHead(400).end(e.message); return; }
      res.writeHead(404).end('not found'); return;
    }
    if (url.pathname === '/auth/connect') {
      const provider = b.provider;
      if (!['claude', 'gpt'].includes(provider)) { res.writeHead(400).end('Chọn Claude hoặc Codex.'); return; }
      const origin = req.headers.origin;
      let sameOrigin = false;
      try { sameOrigin = Boolean(origin) && new URL(origin).host === req.headers.host; } catch { /* Origin sai định dạng */ }
      if (!sameOrigin) { res.writeHead(403).end('Yêu cầu phải xuất phát từ giao diện cùng máy chủ.'); return; }
      const cmd = CONFIG.cliCmd[provider];
      if (!detect(cmd)) { res.writeHead(400).end(`Không tìm thấy CLI "${cmd}". Hãy cài CLI và đăng nhập trên máy đang chạy server.`); return; }
      if (busy) { res.writeHead(409).end('Văn phòng đang xử lý yêu cầu; hãy thử kết nối lại sau.'); return; }
      const authenticated = await authStatus(provider, cmd);
      if (!authenticated) {
        const login = provider === 'gpt' ? 'codex login' : 'claude auth login';
        res.writeHead(401).end(`Chưa xác thực được tài khoản. Trên máy đang chạy server, hãy đăng nhập bằng lệnh: ${login}`);
        return;
      }
      try {
        connectCLI(provider);
      } catch (e) { res.writeHead(500).end(`Không lưu được cấu hình: ${e.message}`); return; }
      agentsVer++;
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        .end(JSON.stringify({ ok: true, provider, message: `${provider === 'gpt' ? 'Codex' : 'Claude'} đã xác thực. Đã bật REAL qua CLI.` }));
      return;
    }
    if (url.pathname === '/task') {
      const task = typeof b.task === 'string' ? b.task.trim() : '';
      if (!task) { res.writeHead(400).end('missing task'); return; }
      if (busy) { res.writeHead(409).end('office is busy'); return; }
      let files;
      try { files = attachmentsOf(b.files); } catch (e) { res.writeHead(400).end(e.message); return; }
      startRun(task, files);
      res.writeHead(202).end('ok');
      return;
    }
    if (url.pathname === '/agent/save' || url.pathname === '/agent/delete') {
      if (busy) { res.writeHead(409).end('Văn phòng đang xử lý yêu cầu, hãy chỉnh sửa sau khi xong.'); return; }
      const list = rawAgents();
      const id = String(b.agent?.id ?? b.id ?? '');
      const i = list.findIndex((a) => a.id === id);
      try {
        if (url.pathname === '/agent/delete') {
          if (i < 0) throw new Error('Không có agent này.');
          if (id === 'manager') throw new Error('Không thể xoá agent điều phối (manager).');
          list.splice(i, 1);
        } else if (b.isNew) {
          if (i >= 0) throw new Error(`id "${id}" đã tồn tại.`);
          list.push(b.agent);
        } else {
          if (i < 0) throw new Error('Không có agent này.');
          list[i] = { ...list[i], ...b.agent, id };
        }
        setAgents(list);
      } catch (e) { res.writeHead(400).end(e.message); return; }
      for (const a of AGENTS) state[a.id] ??= { status: 'idle', report: '' };
      for (const k of Object.keys(state)) if (!AGENTS.some((a) => a.id === k)) delete state[k];
      agentsVer++;
      res.writeHead(200).end('ok');
      return;
    }
    if (url.pathname === '/enzy/run' || url.pathname === '/enzy/schedule' || url.pathname === '/enzy/config/get' || url.pathname === '/enzy/config/save') {
      if (!sameOrigin(req)) { res.writeHead(403).end('Yêu cầu phải xuất phát từ giao diện cùng máy chủ.'); return; }
      try {
        if (url.pathname === '/enzy/run') {
          // Tính kết quả TRƯỚC khi ghi header: enqueue ném lỗi khi kỳ/loại báo cáo không hợp lệ, lúc đó phải trả 400 chứ không được làm sập server.
          // output: 'both' (mặc định: báo cáo + dashboard) | 'report' (chỉ báo cáo) | 'dashboard' (chỉ dashboard, không AI); `dashboard:true` là cách gọi cũ.
          const out = String(b.output || '').toLowerCase();
          const queued = enzy.enqueue(String(b.kind), 'chạy tay', out === 'dashboard' || b.dashboard === true, b.pick && typeof b.pick === 'object' ? b.pick : null, out === 'report');
          res.writeHead(200).end(queued ? 'ok' : 'Báo cáo này đang chạy hoặc đã xếp hàng.');
        }
        else if (url.pathname === '/enzy/config/get') res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }).end(JSON.stringify(enzyConfig()));
        else if (url.pathname === '/enzy/config/save') { saveEnzyConfig(b); const made = enzy.rebuildDashboards(); agentsVer++; res.writeHead(200).end(made.length ? `ok: đã dựng lại ${made.length} dashboard` : 'ok'); }
        else { saveSchedule(b); res.writeHead(200).end('ok'); }
      } catch (e) { if (!res.headersSent) res.writeHead(400); res.end(e.message); }
      return;
    }
    if (url.pathname === '/ask/answer') {
      if (!sameOrigin(req)) { res.writeHead(403).end('Yêu cầu phải xuất phát từ giao diện cùng máy chủ.'); return; }
      const a = asks.get(String(b.id));
      if (!a) { res.writeHead(404).end('Câu hỏi không còn hiệu lực.'); return; }
      asks.delete(a.id); clearTimeout(a.timer);
      a.resolve(b.cancel === true ? null : (b.answers && typeof b.answers === 'object' ? b.answers : {}));
      res.writeHead(200).end('ok');
      return;
    }
    if (url.pathname === '/insight/run' || url.pathname === '/insight/config' || url.pathname === '/insight/stop') {
      if (!sameOrigin(req)) { res.writeHead(403).end('Yêu cầu phải xuất phát từ giao diện cùng máy chủ.'); return; }
      try {
        if (url.pathname === '/insight/stop') { const stopped = insight.stop(); res.writeHead(200).end(stopped ? 'ok' : 'Không có lượt cào nào đang chạy.'); }
        else if (url.pathname === '/insight/run') { const started = insight.start(String(b.mode)); res.writeHead(200).end(started ? 'ok' : 'Đang cào ý kiến khách hàng, hãy chờ xong.'); }
        else { saveInsightStart(b.start); res.writeHead(200).end('ok'); }
      } catch (e) { if (!res.headersSent) res.writeHead(400); res.end(e.message); }
      return;
    }
    if (url.pathname === '/memory/clear') { clearMemory(); res.writeHead(200).end('ok'); return; }
    if (url.pathname === '/config/save') {
      const origin = req.headers.origin;
      if (origin && new URL(origin).host !== req.headers.host && !req.headers['x-forwarded-host']) { res.writeHead(403).end('forbidden'); return; }
      if (busy) { res.writeHead(409).end('Văn phòng đang xử lý yêu cầu, hãy đổi cấu hình sau khi xong.'); return; }
      try { saveSettings(b); } catch (e) { res.writeHead(400).end(e.message); return; }
      agentsVer++;
      res.writeHead(200).end('ok');
      return;
    }
    if (url.pathname === '/permission') { res.writeHead(decide(b.id, b.allow === true, b.remember !== false) ? 200 : 404).end(); return; }
    if (url.pathname === '/revoke') { revoke(String(b.path), b.mode === 'write' ? 'write' : b.mode === 'exec' ? 'exec' : 'read'); res.writeHead(200).end('ok'); return; }
    if (url.pathname === '/online') {
      const cur = state[b.id]?.status;
      if (!cur || cur === 'working' || cur === 'waiting') { res.writeHead(409).end('agent unavailable or busy'); return; }
      emit({ type: 'status', id: b.id, status: b.online ? 'idle' : 'offline' });
      res.writeHead(200).end('ok');
      return;
    }
    res.writeHead(404).end('not found');
    return;
  }

  const pub = path.join(dir, 'public');
  const file = path.join(pub, url.pathname === '/' ? 'index.html' : path.normalize(url.pathname));
  if (!file.startsWith(pub + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

// Cổng đang bận (vd chạy 2 bản, hoặc app khác giữ cổng 3000) thì tự thử cổng kế tiếp thay vì báo lỗi.
server.once('listening', () => {
  const port = server.address().port;
  server.removeAllListeners('error');
  console.log(`Agent Office: http://localhost:${port}  (MODE=${CONFIG.mode}, ${CONFIG.connection} ${CONFIG.provider}/${CONFIG.modelLabel || CONFIG.model}, SOURCE_DIR=${CONFIG.sourceDir})`);
});
function listen(port, tries = 0) {
  server.once('error', (e) => {
    if (e.code === 'EADDRINUSE' && tries < 10) { console.log(`Cổng ${port} đang bận, thử cổng ${port + 1}…`); listen(port + 1, tries + 1); } else throw e;
  });
  server.listen(port);
}
listen(PORT);
// Model CLI đang dùng: ghi nhớ lại khi biết để dialog cấu hình hiển thị; chưa biết thì hỏi CLI một lượt ngắn sau khi khởi động.
onModelFound(() => { agentsVer++; });
if (CONFIG.mode === 'REAL' && CONFIG.connection === 'CLI' && !CONFIG.model) setTimeout(() => discoverModel(CONFIG.provider, CONFIG.cliCmd[CONFIG.provider]), 3000);
