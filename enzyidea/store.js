import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringifyYaml } from '../yamlmini.js';
import { SKILLS_DIR } from '../skills.js';

// Kho idea Enzy: các "Big Idea có thể triển khai" lấy từ trang Enzy (hệ thống "Nghiên cứu Content"), đã loại trùng.
// Lưu ở data/enzyidea/ideas.json; từ đó sinh skill skills/88-enzy-idea-bank.yaml để agent tra cứu (skill_search) khi viết content.
// Tài khoản/mật khẩu của tài khoản content lưu trong enzy.json (khoá CONTENT, quyền 600, đã gitignore) cùng chỗ với cấu hình báo cáo Enzy.
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DIR = path.join(ROOT, 'data', 'enzyidea');
export const IDEAS_FILE = path.join(DIR, 'ideas.json');
export const STATE_FILE = path.join(DIR, 'state.json');
export const AUTH_FILE = path.join(DIR, 'auth.json');
const CONFIG_FILE = path.join(ROOT, 'enzy.json');
const SKILL_FILE = path.join(SKILLS_DIR, '88-enzy-idea-bank.yaml');
export const DEFAULT_CONTENT = { USER: '', PASS: '', BRAND: 'Enzy', SYSTEM: 'Nghiên cứu Content' };
// Chỉ nạp sẵn vào prompt khi yêu cầu nhắc đúng tên kho này; còn lại agent tự tra bằng skill_search (không tốn token mỗi lượt)
const WHEN = ['kho idea enzy', 'idea bank enzy'];

export const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
export const writeJson = (f, o, mode) => { fs.mkdirSync(path.dirname(f), { recursive: true }); const t = f + '.tmp'; fs.writeFileSync(t, JSON.stringify(o, null, 1) + '\n', mode ? { mode } : undefined); fs.renameSync(t, f); };
export const today = () => new Date().toISOString().slice(0, 10);

/* ---------- cấu hình tài khoản content ---------- */
export function loadContentConfig() {
  const raw = readJson(CONFIG_FILE, {});
  return { URL: raw.URL || 'https://enzyfood.streamlit.app/~/+/', ...DEFAULT_CONTENT, ...(raw.CONTENT || {}) };
}
/** Cấu hình cho giao diện: không bao giờ trả mật khẩu, chỉ báo đã lưu hay chưa. */
export function publicContentConfig() {
  const c = loadContentConfig();
  return { URL: c.URL, USER: c.USER, hasPass: Boolean(c.PASS), BRAND: c.BRAND, SYSTEM: c.SYSTEM };
}
export function saveContentConfig(b) {
  const text = (v, name, max = 200) => { const t = String(v ?? '').trim(); if (!t) throw new Error(`${name} không được để trống.`); if (t.length > max) throw new Error(`${name} quá dài.`); return t; };
  const raw = readJson(CONFIG_FILE, {});
  const cur = { ...DEFAULT_CONTENT, ...(raw.CONTENT || {}) };
  const next = { USER: text(b.USER, 'Tài khoản content'), PASS: cur.PASS, BRAND: text(b.BRAND, 'Thương hiệu', 80), SYSTEM: text(b.SYSTEM, 'Hệ thống làm việc', 80) };
  if (b.clearPass === true) next.PASS = '';
  else if (typeof b.PASS === 'string' && b.PASS !== '') next.PASS = b.PASS.slice(0, 200);
  if (!next.PASS) throw new Error('Chưa có mật khẩu: hãy nhập mật khẩu của tài khoản content.');
  raw.CONTENT = next;
  writeJson(CONFIG_FILE, raw, 0o600);
}

/* ---------- chống trùng ---------- */
export const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const tokens = (s) => new Set(norm(s).split(' ').filter((w) => w.length > 2));
/** Độ giống (0–1) giữa hai đoạn: phần từ chung / số từ của đoạn ngắn hơn. */
export function similarity(a, b) {
  const x = tokens(a), y = tokens(b);
  if (!x.size || !y.size) return 0;
  let n = 0; for (const w of x) if (y.has(w)) n++;
  return n / Math.min(x.size, y.size);
}
const SAME = 0.8;
const sameIdea = (a, b) => norm(a.title) === norm(b.title) || similarity(`${a.title} ${a.bigIdea}`, `${b.title} ${b.bigIdea}`) >= SAME || (a.bigIdea && b.bigIdea && similarity(a.bigIdea, b.bigIdea) >= 0.9);

export const loadIdeas = () => readJson(IDEAS_FILE, { ideas: [] }).ideas;

/** Ghi các idea vừa cào vào kho, bỏ trùng: idea đã có chỉ được ghi nhận "thấy lại" (không thêm bản sao). */
export function ingestIdeas(scraped, day = today()) {
  const all = loadIdeas();
  let added = 0, seen = 0;
  const fresh = [];
  for (const it of scraped) {
    const idea = { title: String(it.title || '').trim(), bigIdea: String(it.bigIdea || '').trim(), tag: String(it.tag || '').trim(), context: String(it.context || '').trim(), why: String(it.why || '').trim(), fields: it.fields || {}, raw: String(it.raw || '').slice(0, 3000) };
    if (idea.title.length < 6) continue;
    const dup = all.find((x) => sameIdea(x, idea));
    if (dup) { if (dup.lastSeen !== day) dup.seenCount = (dup.seenCount || 1) + 1; dup.lastSeen = day; seen++; continue; }   // (đã có: chỉ ghi nhận thấy lại, mỗi ngày tính một lần)
    const rec = { id: `${Date.now().toString(36)}${added}`, firstSeen: day, lastSeen: day, seenCount: 1, ...idea };
    all.push(rec); fresh.push(rec); added++;
  }
  writeJson(IDEAS_FILE, { ideas: all });
  return { added, seen, total: all.length, fresh };
}

/* ---------- skill cho agent ---------- */
const clip = (t, n) => { t = String(t || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
const block = (i) => [
  i.tag && `Nhóm: ${i.tag}`, i.bigIdea && `Big Idea: ${clip(i.bigIdea, 220)}`,
  ...Object.entries(i.fields || {}).slice(0, 3).map(([k, v]) => `${k}: ${clip(v, 200)}`),
  `Từ trang Enzy ${i.firstSeen}${i.seenCount > 1 ? ` (thấy lại ${i.seenCount} lần)` : ''}.`,
].filter(Boolean).join('\n');
/** Ghi skill sinh tự động từ kho idea. Trả về số idea. */
export function writeSkill() {
  const ideas = loadIdeas().slice().reverse();
  const sections = ideas.slice(0, 60).map((i) => ({ id: `idea-${i.id}`.slice(0, 90), title: i.title.slice(0, 160), tags: [i.tag, ...Object.keys(i.fields || {})].filter(Boolean).slice(0, 8), text: block(i) }));
  fs.writeFileSync(SKILL_FILE, '# File SINH TỰ ĐỘNG từ data/enzyidea/ideas.json — không sửa tay.\n' + stringifyYaml({
    id: '88-enzy-idea-bank', title: `Kho idea Enzy đã trích xuất (${ideas.length} idea, từ trang "Nghiên cứu Content")`,
    summary: 'Các Big Idea có thể triển khai mà trang Enzy gợi ý (mâu thuẫn khách hàng, niềm tin cần thay đổi, vai trò riêng của Enzy…). Dùng để HỌC CÁCH LẬP LUẬN và lấy cảm hứng, không chép nguyên văn; tra bằng skill_search.',
    agents: ['signal', 'planner', 'writer', 'analyst', 'manager'], exclude: ['assistant'], when: WHEN, tags: ['idea', 'big idea', 'enzy', 'content'], order: 88, updated: today(),
    sections: sections.length ? sections : [{ id: 'trong', title: 'Chưa có idea', tags: [], text: 'Kho chưa có idea nào. Không bịa idea của Enzy.' }],
  }));
  return ideas.length;
}
