import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { CONFIG } from './config.js';
import { complete } from './llm.js';
import { skillsText } from './skills.js';

// Trí nhớ dài hạn + kỹ năng tự cập nhật cho từng agent (data/agents/<id>.json):
//  - playbook: ghi chú kinh nghiệm cô đọng (≤ 10 gạch đầu dòng), luôn nạp vào prompt → agent không phải "học lại" từ đầu mỗi lần;
//  - pending: bài học mới sau mỗi lần làm việc (từ yêu cầu sửa của người duyệt, đánh giá của CEO), được hợp nhất vào playbook theo lô (ít token);
//  - recent: gist các việc gần đây, chỉ nạp việc liên quan;
//  - digest: bản nén của skill chung (tạo một lần, dùng lại ở mọi lượt gọi) khi agent đã làm việc đủ nhiều.
// Mọi thứ do hệ thống ghi; agent không có công cụ nào để sửa thư mục này.
const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data', 'agents');
const SETTINGS_FILE = path.join(DIR, '_settings.json');
const PLAYBOOK_MAX = 1600, LESSON_MAX = 240, PENDING_MAX = 40, RECENT_MAX = 12, BATCH = 3;
const DIGEST_MIN_RUNS = 3, DIGEST_MIN_CHARS = 3000;

const clip = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const plain = (s) => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');
const words = (s) => new Set(plain(s).split(/[^a-z0-9]+/).filter((w) => w.length > 2));
const clean = (s, n = LESSON_MAX) => clip(String(s ?? '').replace(/https?:\/\/\S+/g, '').replace(/[`\r\n]+/g, ' ').replace(/\s+/g, ' ').trim(), n);
const keyOf = (s) => plain(s).replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 70);

const cache = new Map();
const dirty = new Set();
let timer = null;
const fileOf = (id) => path.join(DIR, `${id}.json`);
const blank = (id) => ({ id, runs: 0, ok: 0, failed: 0, approvals: 0, revisions: 0, updated: 0, consolidated: 0, runsAtConsolidate: 0, playbook: '', pending: [], recent: [], digest: null });

function load(id) {
  if (!/^[a-z][a-z0-9_]{0,19}$/.test(id)) throw new Error('id agent không hợp lệ.');
  if (cache.has(id)) return cache.get(id);
  let d;
  try { d = { ...blank(id), ...JSON.parse(fs.readFileSync(fileOf(id), 'utf8')) }; } catch { d = blank(id); }
  cache.set(id, d);
  return d;
}
function flushFiles() {
  clearTimeout(timer); timer = null;
  for (const id of dirty) {
    try { fs.mkdirSync(DIR, { recursive: true }); const f = fileOf(id); fs.writeFileSync(f + '.tmp', JSON.stringify(cache.get(id))); fs.renameSync(f + '.tmp', f); } catch (e) { console.warn(`[learn] ${e.message}`); }
  }
  dirty.clear();
}
process.on('exit', flushFiles);
const touch = (d) => { d.updated = Date.now(); dirty.add(d.id); if (!timer) { timer = setTimeout(flushFiles, 800); timer.unref?.(); } };

// ---- Cài đặt chung ----
export function settings() {
  try { const s = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); return { auto: s.auto !== false, digest: s.digest !== false }; } catch { return { auto: true, digest: true }; }
}
export function setSettings(s) {
  const next = { ...settings(), ...(typeof s.auto === 'boolean' ? { auto: s.auto } : {}), ...(typeof s.digest === 'boolean' ? { digest: s.digest } : {}) };
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(next));
  return next;
}

// ---- Ghi nhận sau mỗi lần làm việc (không tốn token) ----
export function recordRun(id, { ok = true } = {}) {
  if (!settings().auto) return;
  const d = load(id);
  d.runs++; ok ? d.ok++ : d.failed++;
  touch(d);
}

// Gist của việc vừa làm: dòng đầu có nghĩa, bỏ bảng/tiêu đề trống.
const gistOf = (text) => clip((String(text).split('\n').map((l) => l.replace(/^[#>*\-\s|]+/, '').replace(/\*\*/g, '').trim()).find((l) => l.length > 12) || ''), 200);
export function recordTask(id, { title, text }) {
  if (!settings().auto || !text) return;
  const d = load(id);
  d.recent.push({ at: Date.now(), title: clip(title, 120), gist: gistOf(text) });
  if (d.recent.length > RECENT_MAX) d.recent.shift();
  touch(d);
}

export function recordVerdict(id, approved) {
  if (!settings().auto) return;
  const d = load(id);
  approved ? d.approvals++ : d.revisions++;
  touch(d);
}

// Thêm một bài học (src: 'review' = người duyệt yêu cầu sửa, 'ceo' = CEO đánh giá/nhập tay, 'auto' = hệ thống). Trùng thì tăng độ ưu tiên.
export function addLesson(id, text, src = 'auto') {
  if (src !== 'ceo' && !settings().auto) return false;
  const t = clean(text);
  if (t.length < 8) return false;
  const d = load(id), k = keyOf(t);
  const same = d.pending.find((p) => keyOf(p.t) === k);
  if (same) { same.n = (same.n || 1) + 1; same.at = Date.now(); touch(d); return true; }
  if (d.playbook.split('\n').some((l) => keyOf(l.replace(/^[-•]\s*/, '')) === k)) return false;
  d.pending.push({ t, src, at: Date.now(), n: 1 });
  while (d.pending.length > PENDING_MAX) { const i = d.pending.findIndex((p) => p.src !== 'ceo'); d.pending.splice(i < 0 ? 0 : i, 1); }
  touch(d);
  return true;
}

// Rút bài học từ nhận xét "YÊU CẦU SỬA" của người duyệt: tối đa 3 ý đầu dòng, không thì đoạn đầu.
export function lessonFromReview(text) {
  const body = String(text).replace(/^.*KẾT LUẬN:[^\n]*\n?/im, '');
  const items = body.split('\n').map((l) => l.trim()).filter((l) => /^([-•*]|\d+[.)])\s+/.test(l)).map((l) => l.replace(/^([-•*]|\d+[.)])\s+/, '').replace(/\*\*/g, '')).slice(0, 3);
  const core = items.length ? items.join('; ') : clip(body.replace(/\s+/g, ' ').trim(), 200);
  return core ? `Người duyệt từng yêu cầu sửa: ${clip(core, 200)}` : '';
}

export function resetAgent(id) { const d = load(id); Object.assign(d, blank(id), { updated: Date.now() }); touch(d); }
export function editPlaybook(id, text) {
  const d = load(id);
  d.playbook = String(text ?? '').split('\n').map((l) => clean(l.replace(/^[-•*]\s*/, ''), 170)).filter(Boolean).slice(0, 14).map((l) => `- ${l}`).join('\n').slice(0, PLAYBOOK_MAX);
  touch(d);
}
export function removePending(id, index) { const d = load(id); if (d.pending[index]) { d.pending.splice(index, 1); touch(d); } }

// ---- Nạp vào prompt ----
// Playbook + bài học chưa hợp nhất + gist việc liên quan; luôn gọn (≤ ~1,8k ký tự).
export function learnedText(agent, command = '') {
  if (!settings().auto) return '';
  const d = load(agent.id);
  const parts = [];
  if (d.playbook) parts.push(d.playbook);
  const fresh = d.pending.slice(-4).map((p) => `- (mới) ${p.t}`);
  if (fresh.length) parts.push(fresh.join('\n'));
  let text = parts.join('\n');
  if (d.recent.length && command) {
    const q = words(command);
    const rel = d.recent.map((r) => ({ r, s: [...words(r.title + ' ' + r.gist)].filter((w) => q.has(w)).length })).filter((x) => x.s >= 2).sort((a, b) => b.s - a.s).slice(0, 2);
    if (rel.length) text += `\nViệc tương tự đã làm: ${rel.map((x) => `${x.r.title} → ${x.r.gist}`).join(' | ')}`;
  }
  return text ? clip(`\n\nKinh nghiệm riêng của bạn (tự cập nhật sau mỗi lần làm việc, hãy tuân thủ):\n${text}`, PLAYBOOK_MAX + 600) : '';
}

// ---- Skill nén ----
const skillHash = (agent) => crypto.createHash('sha1').update(skillsText(agent, 14000)).digest('hex').slice(0, 12);
export function digestFor(agent) {
  if (!settings().digest) return null;
  const d = load(agent.id).digest;
  return d && d.text && d.hash === skillHash(agent) ? `\n\nKiến thức & quy chuẩn của team (bản nén tự động từ skills):\n${d.text}\n---\n` : null;
}

// ---- Hợp nhất / nén bằng AI (hoặc quy tắc đơn giản ở MOCK) ----
const live = () => CONFIG.mode === 'REAL';
const bullets = (text) => String(text).split('\n').map((l) => l.trim()).filter((l) => /^([-•*]|\d+[.)])\s+/.test(l)).map((l) => clean(l.replace(/^([-•*]|\d+[.)])\s+/, ''), 170));

export async function consolidate(agent) {
  const d = load(agent.id);
  if (!d.pending.length) return null;
  const old = bullets(d.playbook);
  let merged;
  if (live()) {
    try {
      const text = await complete({
        agent,
        system: `Bạn biên tập sổ tay kinh nghiệm cho agent #${agent.id} (${agent.role || agent.name}). Hợp nhất "ghi chú hiện tại" và "bài học mới" thành TỐI ĐA 10 gạch đầu dòng, mỗi dòng ≤ 160 ký tự: cụ thể, làm theo được ngay, gộp ý trùng, bỏ ý mâu thuẫn (ưu tiên bài học nguồn CEO, rồi bài học mới), bỏ bài học không liên quan đến vai trò của agent này. Không thêm sự kiện không có trong dữ liệu. Chỉ trả về danh sách gạch đầu dòng.`,
        user: `Ghi chú hiện tại:\n${old.map((l) => `- ${l}`).join('\n') || '(trống)'}\n\nBài học mới:\n${d.pending.map((p) => `- [${p.src}${p.n > 1 ? ` x${p.n}` : ''}] ${p.t}`).join('\n')}`,
        max: 500,
      });
      merged = bullets(text);
    } catch { merged = null; }
  }
  if (!merged?.length) { // dự phòng: ghép thô, bỏ trùng, giữ 10 dòng mới nhất (ưu tiên CEO)
    const all = [...old, ...[...d.pending].sort((a, b) => (a.src === 'ceo') - (b.src === 'ceo')).map((p) => p.t)];
    const seen = new Set();
    merged = all.filter((t) => { const k = keyOf(t); if (seen.has(k)) return false; seen.add(k); return true; }).slice(-10);
  }
  const n = d.pending.length;
  d.playbook = merged.slice(0, 10).map((l) => `- ${l}`).join('\n').slice(0, PLAYBOOK_MAX);
  d.pending = []; d.consolidated = Date.now(); d.runsAtConsolidate = d.runs;
  touch(d);
  return n;
}

export async function compileDigest(agent) {
  const d = load(agent.id), src = skillsText(agent, 14000), hash = skillHash(agent);
  if (src.length < DIGEST_MIN_CHARS || (d.digest?.hash === hash)) return false;
  const target = Math.round(src.length * 0.5);
  let out = '';
  try {
    out = await complete({
      agent,
      system: `Bạn nén tài liệu quy chuẩn thành bản rút gọn KHÔNG MẤT QUY TẮC: giữ nguyên mọi con số, định dạng/cột bắt buộc, điều cấm, tiêu chí đạt/không đạt, tên trường, tên công cụ; bỏ giải thích dài, ví dụ lặp, câu đệm, dòng trống thừa. Giữ tiêu đề từng skill (dạng "--- Skill: … ---"). GIỚI HẠN CỨNG: bản rút gọn tối đa ${target} ký tự (khoảng một nửa bản gốc ${src.length} ký tự). Chỉ trả về bản rút gọn, không bình luận, không rào markdown.`,
      user: src, max: 1800,
    });
  } catch { out = ''; }
  out = String(out).replace(/^```\w*\n?|\n?```$/g, '').trim();
  // Chỉ nhận bản nén hợp lý (20%–80% bản gốc); không thì đánh dấu đã thử để khỏi lặp lại tốn token.
  const ok = out.length > src.length * 0.2 && out.length < src.length * 0.8;
  d.digest = { hash, text: ok ? out : '', from: src.length, to: ok ? out.length : 0, at: Date.now() };
  touch(d);
  return ok;
}

// Chạy sau mỗi yêu cầu: hợp nhất bài học khi đủ lô (hoặc sau ≥ 8 lượt làm việc), nén skill khi agent đã dùng ≥ 3 lượt. Trả về các dòng thông báo.
let busy = false;
export async function flush(agents) {
  if (busy) return [];
  busy = true;
  const out = [];
  try {
    const s = settings();
    for (const a of agents) {
      const d = load(a.id);
      if (s.auto && d.pending.length && (d.pending.length >= BATCH || d.pending.some((p) => p.src === 'ceo') || d.runs - d.runsAtConsolidate >= 8)) {
        const n = await consolidate(a);
        if (n) out.push(`🧠 #${a.id} đã cập nhật kỹ năng (${n} bài học mới)`);
      }
      if (s.digest && live() && d.runs >= DIGEST_MIN_RUNS && skillsText(a, 14000).length >= DIGEST_MIN_CHARS && d.digest?.hash !== skillHash(a)) {
        const ok = await compileDigest(a);
        if (ok) out.push(`🗜️ #${a.id}: đã nén skill (${d.digest.from} → ${d.digest.to} ký tự), các lượt sau tốn ít token hơn`);
      }
    }
  } finally { busy = false; }
  return out;
}

// ---- Dữ liệu cho giao diện ----
export function overview(agents) {
  return {
    settings: settings(), live: live(),
    agents: agents.map((a) => {
      const d = load(a.id), cur = skillsText(a, 14000).length;
      return {
        id: a.id, name: a.name, role: a.role, color: a.color, runs: d.runs, ok: d.ok, failed: d.failed, approvals: d.approvals, revisions: d.revisions,
        updated: d.updated, consolidated: d.consolidated, playbook: d.playbook, pending: d.pending, recent: d.recent.slice(-3).reverse(),
        digest: { ready: Boolean(d.digest?.text && d.digest.hash === skillHash(a)), from: d.digest?.from || cur, to: d.digest?.to || 0, eligible: cur >= DIGEST_MIN_CHARS, runs: d.runs, need: DIGEST_MIN_RUNS },
      };
    }),
  };
}
