import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringifyYaml } from '../yamlmini.js';
import { SKILLS_DIR } from '../skills.js';

// Kho kiến thức marketing từ Brands Vietnam: mỗi bài là một file YAML (knowledge/data/<nguồn>/<id>.yaml) chỉ chứa BẢN TÓM TẮT + link nguồn (không chép nguyên văn).
// Từ kho này sinh 2 skill để agent dùng: skills/86-knowledge-casestudies.yaml (tra cứu bằng skill_search) và skills/87-knowledge-digest.yaml (digest ngày/tuần).
export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data');
export const INDEX_FILE = path.join(ROOT, 'index.json');
export const CONFIG_FILE = path.join(ROOT, 'config.json');
export const SOURCES = { campaign: 'Chiến dịch (Campaign case-study)', library: 'Thư viện tài liệu (Library)' };
const CASES_SKILL = path.join(SKILLS_DIR, '86-knowledge-casestudies.yaml');
const DIGEST_SKILL = path.join(SKILLS_DIR, '87-knowledge-digest.yaml');
const WHEN = ['case study', 'casestudy', 'chien dich', 'campaign', 'trend', 'xu huong', 'idea', 'y tuong', 'insight', 'brandsvietnam', 'kien thuc marketing', 'ke hoach tuan'];

const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const writeJson = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f + '.tmp', JSON.stringify(o, null, 1)); fs.renameSync(f + '.tmp', f); };
export const today = () => new Date().toISOString().slice(0, 10);

export const loadIndex = () => readJson(INDEX_FILE, { articles: {}, updated: '' }); // articles[url] = { source, id, title, at, file }
export const saveIndex = (ix) => { ix.updated = new Date().toISOString(); writeJson(INDEX_FILE, ix); };

export const DEFAULT_CONFIG = { enabled: false, time: '07:30', perRun: 8, weeklyDay: 1 };
export function loadConfig() {
  const c = { ...DEFAULT_CONFIG, ...readJson(CONFIG_FILE, {}) };
  c.perRun = Math.min(Math.max(Math.round(Number(c.perRun)) || 8, 1), 30);
  if (!/^\d{2}:\d{2}$/.test(c.time)) c.time = DEFAULT_CONFIG.time;
  c.weeklyDay = Math.min(Math.max(Math.round(Number(c.weeklyDay)), 0), 6) || 0;
  c.enabled = c.enabled === true;
  return c;
}
export function saveConfig(b) {
  const c = { ...loadConfig(), ...b };
  if (b.time !== undefined && !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(b.time))) throw new Error('Giờ phải có dạng HH:MM.');
  writeJson(CONFIG_FILE, { enabled: c.enabled === true, time: c.time, perRun: Math.min(Math.max(Math.round(Number(c.perRun)) || 8, 1), 30), weeklyDay: Math.min(Math.max(Math.round(Number(c.weeklyDay)) || 0, 0), 6) });
}

const slug = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
export const idOf = (url) => slug(new URL(url).pathname.split('/').filter(Boolean).slice(1).join('-')) || slug(url);
const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const list = (v, n = 6, m = 200) => (Array.isArray(v) ? v : v ? [v] : []).map((x) => clip(x, m)).filter(Boolean).slice(0, n);

/** Chuẩn hoá một bài đã chưng cất → file YAML. */
export function saveArticle({ source, url, title, published, distilled, via }) {
  const id = idOf(url), d = distilled || {};
  const rec = {
    id, source, url, title: clip(title, 200), published: clip(published, 40), saved: today(), via: via || 'rule',
    brand: clip(d.brand, 80), category: clip(d.category, 80), tags: list(d.tags, 8, 40),
    summary: clip(d.summary, 600), insight: clip(d.insight, 400), big_idea: clip(d.big_idea, 400), execution: list(d.execution, 6, 220),
    results: list(d.results, 5, 200), lessons_for_enzy: list(d.lessons_for_enzy, 4, 240), content_angles: list(d.content_angles, 4, 200),
  };
  const dir = path.join(ROOT, source);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${id}.yaml`);
  fs.writeFileSync(file, `# Tóm tắt từ Brands Vietnam — bản quyền nội dung gốc thuộc nguồn; chỉ dùng nội bộ để tham khảo.\n` + stringifyYaml(rec));
  return { id, file: path.relative(ROOT, file), rec };
}

export function loadArticles() {
  const out = [];
  for (const src of Object.keys(SOURCES)) {
    let names = [];
    try { names = fs.readdirSync(path.join(ROOT, src)).filter((f) => f.endsWith('.yaml')); } catch { continue; }
    for (const n of names) {
      try { const t = fs.readFileSync(path.join(ROOT, src, n), 'utf8'); out.push(parseLite(t)); } catch { /* bỏ qua file hỏng */ }
    }
  }
  return out.sort((a, b) => (b.saved + b.id).localeCompare(a.saved + a.id));
}

// Đọc nhanh file bài (cùng định dạng với saveArticle) bằng yamlmini.
import { parseYaml } from '../yamlmini.js';
const parseLite = (t) => { const d = parseYaml(t); for (const k of ['tags', 'execution', 'results', 'lessons_for_enzy', 'content_angles']) d[k] = Array.isArray(d[k]) ? d[k].map(String) : d[k] ? [String(d[k])] : []; return d; };

const block = (a) => [
  a.brand || a.category ? `Thương hiệu/ngành: ${[a.brand, a.category].filter(Boolean).join(' · ')}` : '',
  a.summary && `Tóm tắt: ${a.summary}`, a.insight && `Insight: ${a.insight}`, a.big_idea && `Big idea: ${a.big_idea}`,
  a.execution.length && `Triển khai: ${a.execution.join('; ')}`, a.results.length && `Kết quả: ${a.results.join('; ')}`,
  a.lessons_for_enzy.length && `Bài học cho Enzy: ${a.lessons_for_enzy.join('; ')}`, a.content_angles.length && `Góc content: ${a.content_angles.join('; ')}`,
  `Nguồn: ${a.url}`,
].filter(Boolean).join('\n');

/** Ghi lại 2 skill sinh tự động. Trả về số bài. */
export function writeSkills() {
  const arts = loadArticles();
  const sections = arts.slice(0, 300).map((a) => ({ id: `${a.source}-${a.id}`.slice(0, 90), title: a.title, tags: [a.brand, a.category, ...a.tags].filter(Boolean), text: block(a) }));
  const head = { agents: ['signal', 'planner', 'writer', 'analyst'], exclude: ['assistant'], when: WHEN, tags: ['case study', 'chiến dịch', 'trend', 'brandsvietnam'] };
  fs.writeFileSync(CASES_SKILL, '# File SINH TỰ ĐỘNG từ knowledge/data — không sửa tay.\n' + stringifyYaml({
    id: '86-knowledge-casestudies', title: `Kho case-study & kiến thức marketing (${arts.length} bài, Brands Vietnam)`,
    summary: 'Tóm tắt case-study, phân tích chiến dịch, kiến thức marketing đã đọc; tra bằng skill_search để lấy cảm hứng/ví dụ có nguồn. Không sao chép nguyên văn, luôn dẫn link nguồn.',
    ...head, order: 86, updated: today(), sections: sections.length ? sections : [{ id: 'trong', title: 'Chưa có bài', tags: [], text: 'Kho chưa có bài nào. Không bịa case-study.' }],
  }));
  const dg = digestText(arts);
  fs.writeFileSync(DIGEST_SKILL, '# File SINH TỰ ĐỘNG — digest ngày/tuần từ kho case-study.\n' + stringifyYaml({
    id: '87-knowledge-digest', title: 'Digest case-study & trend marketing (hôm nay / tuần này)',
    summary: 'Bản tóm tắt các case-study và bài học mới đọc gần đây để lên idea và nhìn trend hằng ngày/tuần.',
    ...head, order: 87, updated: today(), sections: [{ id: 'digest', title: 'Digest gần đây', tags: ['digest', 'trend'], text: dg }],
  }));
  return arts.length;
}

const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
export function digestText(arts = loadArticles()) {
  if (!arts.length) return 'Chưa có bài nào trong kho. Không bịa case-study hay trend.';
  const day = arts.filter((a) => a.saved >= daysAgo(1)), week = arts.filter((a) => a.saved >= daysAgo(7));
  const line = (a) => `- ${a.title}${a.brand ? ` (${a.brand})` : ''}: ${a.insight || a.summary}${a.lessons_for_enzy[0] ? ` → ${a.lessons_for_enzy[0]}` : ''} [${a.url}]`;
  const tagCount = {};
  for (const a of week) for (const t of a.tags) tagCount[t] = (tagCount[t] || 0) + 1;
  const top = Object.entries(tagCount).sort((x, y) => y[1] - x[1]).slice(0, 8).map(([t, n]) => `${t} (${n})`).join(', ');
  const parts = [`Tổng kho: ${arts.length} bài. Cập nhật ${today()}.`];
  parts.push(`HÔM QUA–HÔM NAY (${day.length} bài mới):\n${day.slice(0, 6).map(line).join('\n') || '- (không có bài mới)'}`);
  parts.push(`TUẦN NÀY (${week.length} bài mới)${top ? `; chủ đề lặp lại: ${top}` : ''}:\n${week.slice(0, 12).map(line).join('\n') || '- (không có bài mới)'}`);
  parts.push('Cách dùng: lấy CẢM HỨNG và cơ chế, không sao chép ý tưởng; nêu nguồn khi nhắc case-study; dùng skill_search để xem chi tiết.');
  return parts.join('\n\n').slice(0, 5500);
}
