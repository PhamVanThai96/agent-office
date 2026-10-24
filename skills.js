import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseYaml } from './yamlmini.js';

// Định dạng chính của skill là YAML (skills/*.yaml: tóm tắt, thẻ, các mục có id/tiêu đề/thẻ/nội dung → tra cứu nhanh bằng skill_search);
// vẫn đọc được file .md cũ (frontmatter + markdown). Thư mục skills/: kiến thức dùng chung, độc lập với agents.json. Mỗi file tự khai báo áp dụng cho ai
// (agents: [id] | ["*"], rooms: [tên phòng]) nên thêm/sửa/xoá agent không làm mất hay hỏng skill.
export const SKILLS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'skills');
const FILE_MAX = 6000;
const TOTAL_MAX = 14000;
const cache = new Map();
// Không dấu, chữ thường: để so khớp từ khoá `when` với yêu cầu của CEO.
export const plain = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');

// Đọc mảng kiểu YAML một dòng: [a, "b c"] hoặc a, b
const list = (v) => (v ? v.replace(/^\[|\]$/g, '').split(',').map((x) => x.trim().replace(/^["']|["']$/g, '')).filter(Boolean) : []);

const arr = (v) => (Array.isArray(v) ? v.map(String) : v ? [String(v)] : []);

function parseYamlSkill(file) {
  const d = parseYaml(fs.readFileSync(file, 'utf8'));
  const sections = (Array.isArray(d.sections) ? d.sections : []).map((x, i) => ({
    id: String(x.id || `muc-${i + 1}`), title: String(x.title || ''), tags: arr(x.tags), text: String(x.text ?? '').trim(),
  })).filter((x) => x.text);
  if (!sections.length && d.body) sections.push({ id: 'noi-dung', title: 'Nội dung', tags: [], text: String(d.body).trim() });
  let body = sections.map((x) => x.text).join('\n\n');
  if (body.length > FILE_MAX) body = body.slice(0, FILE_MAX) + '\n…(đã cắt bớt)';
  return {
    name: path.basename(file), id: String(d.id || path.basename(file).replace(/\.ya?ml$/i, '')), title: String(d.title || path.basename(file)),
    summary: String(d.summary || ''), tags: arr(d.tags), sections,
    agents: arr(d.agents), rooms: arr(d.rooms), exclude: arr(d.exclude), when: arr(d.when).map(plain),
    order: Number.isFinite(Number(d.order)) ? Number(d.order) : 100, body,
  };
}

function parse(file) {
  if (/\.ya?ml$/i.test(file)) return parseYamlSkill(file);
  const raw = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  const meta = {};
  if (m) for (const line of m[1].split(/\r?\n/)) { const kv = line.match(/^(\w+)\s*:\s*(.*?)\s*(#.*)?$/); if (kv) meta[kv[1]] = kv[2]; }
  let body = (m ? raw.slice(m[0].length) : raw).trim();
  if (body.length > FILE_MAX) body = body.slice(0, FILE_MAX) + '\n…(đã cắt bớt)';
  return {
    name: path.basename(file), id: path.basename(file, path.extname(file)), title: (meta.title || path.basename(file, '.md')).replace(/^["']|["']$/g, ''), summary: '', tags: [],
    sections: [{ id: 'noi-dung', title: 'Nội dung', tags: [], text: body }],
    agents: list(meta.agents), rooms: list(meta.rooms), exclude: list(meta.exclude), when: list(meta.when).map(plain), order: meta.order !== undefined && Number.isFinite(Number(meta.order)) ? Number(meta.order) : 100, body,
  };
}

// Danh sách skill hiện có (đọc lại file nào thay đổi). Bỏ README.md và file bắt đầu bằng "_".
export function loadSkills() {
  let names;
  try { names = fs.readdirSync(SKILLS_DIR).filter((f) => /\.(ya?ml|md|markdown|txt)$/i.test(f) && !f.startsWith('_') && f.toLowerCase() !== 'readme.md'); } catch { return []; }
  // Có cả .yaml và .md cùng tên thì chỉ dùng .yaml.
  names = names.filter((f) => /\.ya?ml$/i.test(f) || !names.some((g) => /\.ya?ml$/i.test(g) && g.replace(/\.ya?ml$/i, '') === f.replace(/\.[^.]+$/, '')));
  const out = [];
  for (const n of names) {
    const f = path.join(SKILLS_DIR, n);
    try {
      const mt = fs.statSync(f).mtimeMs, c = cache.get(f);
      if (c?.mt === mt) { out.push(c.skill); continue; }
      const skill = parse(f);
      cache.set(f, { mt, skill });
      out.push(skill);
    } catch (e) { console.warn(`[skills] không đọc được ${n}: ${e.message}`); }
  }
  return out.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

export const skillsFor = (agent) => loadSkills().filter((s) => !s.exclude.includes(agent.id) && (s.agents.includes('*') || s.agents.includes(agent.id) || s.rooms.includes(agent.room)));

// Skill có `when: [từ khoá]` chỉ được nạp khi yêu cầu/task nhắc tới từ khoá đó (giữ prompt gọn): skillsText() bỏ qua chúng, contextSkillsText() nạp chúng theo ngữ cảnh.
const matches = (s, ctx) => { const t = plain(ctx); return s.when.some((k) => k && t.includes(k)); };
export function contextSkillsText(agent, ctx, max = 8500) {
  let text = '', used = 0;
  for (const s of skillsFor(agent).filter((x) => x.when.length && matches(x, ctx))) {
    const block = `\n\n--- Skill (theo ngữ cảnh): ${s.title} ---\n${s.body}`;
    if (used + block.length > max) continue; // skill này không còn chỗ: thử skill nhỏ hơn phía sau
    text += block; used += block.length;
  }
  return text ? `\n\nKỹ năng chuyên môn cho việc này:${text}\n--- Hết ---\n` : '';
}

// Văn bản skill đưa vào system prompt, giới hạn tổng độ dài (skill có order lớn bị cắt trước).
export function skillsText(agent, max = TOTAL_MAX) {
  let text = '', used = 0;
  for (const s of skillsFor(agent).filter((x) => !x.when.length)) {
    const block = `\n\n--- Skill: ${s.title} ---\n${s.body}`;
    if (used + block.length > max) { text += `\n\n(Bỏ bớt skill do giới hạn độ dài từ: ${s.title})`; break; }
    text += block; used += block.length;
  }
  return text ? `\n\nKiến thức & quy chuẩn của team (skills):${text}\n--- Hết skills ---\n` : '';
}

// Tra cứu nhanh trong các skill agent được dùng (kể cả skill chỉ nạp theo ngữ cảnh): trả về các mục khớp nhất, không cần nạp cả skill.
const QSTOP = new Set(['va', 'cua', 'cho', 'cac', 'nhung', 'mot', 'la', 'de', 'co', 'khong', 'duoc', 'khi', 'voi', 'trong', 'theo', 'tu', 'nay', 'do', 'nhu', 'the', 'nao', 'gi', 'sao', 'bao', 'nhieu']);
export function searchSkills(agent, query, limit = 3) {
  const q = plain(query).replace(/[^a-z0-9/\s.]/g, ' ').trim();
  const terms = [...new Set(q.split(/\s+/).filter((w) => w.length >= 2 && !QSTOP.has(w)))];
  if (!terms.length) return [];
  const hits = [];
  for (const sk of skillsFor(agent)) {
    const skillText = plain(`${sk.title} ${sk.summary} ${sk.tags.join(' ')}`);
    for (const sec of sk.sections) {
      const title = plain(sec.title), tags = plain(sec.tags.join(' ')), text = plain(sec.text);
      let score = 0;
      for (const t of terms) {
        if (title.includes(t)) score += 4;
        if (tags.includes(t)) score += 3;
        if (skillText.includes(t)) score += 1;
        const c = text.split(t).length - 1;
        if (c) score += Math.min(c, 4);
      }
      if (terms.length > 1 && text.includes(q)) score += 6;
      if (score >= Math.max(2, terms.length)) hits.push({ skill: sk.title, skillId: sk.id, section: sec.title, id: sec.id, text: sec.text.length > 1000 ? sec.text.slice(0, 999) + '…' : sec.text, score });
    }
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, Math.min(Math.max(Number(limit) || 3, 1), 5));
}
