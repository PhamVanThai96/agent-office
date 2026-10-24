import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Thư mục skills/: kiến thức dùng chung, độc lập với agents.json. Mỗi file tự khai báo áp dụng cho ai
// (agents: [id] | ["*"], rooms: [tên phòng]) nên thêm/sửa/xoá agent không làm mất hay hỏng skill.
export const SKILLS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'skills');
const FILE_MAX = 6000;
const TOTAL_MAX = 14000;
const cache = new Map();

// Đọc mảng kiểu YAML một dòng: [a, "b c"] hoặc a, b
const list = (v) => (v ? v.replace(/^\[|\]$/g, '').split(',').map((x) => x.trim().replace(/^["']|["']$/g, '')).filter(Boolean) : []);

function parse(file) {
  const raw = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  const meta = {};
  if (m) for (const line of m[1].split(/\r?\n/)) { const kv = line.match(/^(\w+)\s*:\s*(.*?)\s*(#.*)?$/); if (kv) meta[kv[1]] = kv[2]; }
  let body = (m ? raw.slice(m[0].length) : raw).trim();
  if (body.length > FILE_MAX) body = body.slice(0, FILE_MAX) + '\n…(đã cắt bớt)';
  return {
    name: path.basename(file), title: (meta.title || path.basename(file, '.md')).replace(/^["']|["']$/g, ''),
    agents: list(meta.agents), rooms: list(meta.rooms), order: meta.order !== undefined && Number.isFinite(Number(meta.order)) ? Number(meta.order) : 100, body,
  };
}

// Danh sách skill hiện có (đọc lại file nào thay đổi). Bỏ README.md và file bắt đầu bằng "_".
export function loadSkills() {
  let names;
  try { names = fs.readdirSync(SKILLS_DIR).filter((f) => /\.(md|markdown|txt)$/i.test(f) && !f.startsWith('_') && f.toLowerCase() !== 'readme.md'); } catch { return []; }
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

export const skillsFor = (agent) => loadSkills().filter((s) => s.agents.includes('*') || s.agents.includes(agent.id) || s.rooms.includes(agent.room));

// Văn bản skill đưa vào system prompt, giới hạn tổng độ dài (skill có order lớn bị cắt trước).
export function skillsText(agent, max = TOTAL_MAX) {
  let text = '', used = 0;
  for (const s of skillsFor(agent)) {
    const block = `\n\n--- Skill: ${s.title} ---\n${s.body}`;
    if (used + block.length > max) { text += `\n\n(Bỏ bớt skill do giới hạn độ dài từ: ${s.title})`; break; }
    text += block; used += block.length;
  }
  return text ? `\n\nKiến thức & quy chuẩn của team (skills):${text}\n--- Hết skills ---\n` : '';
}
