// Chuyển skills/*.md (frontmatter + markdown) sang skills/*.yaml có cấu trúc: tóm tắt, thẻ và các mục (sections) để tra cứu nhanh.
// Chạy: node scripts/convert-skills.mjs   (bản .md gốc được chuyển vào backups/skills-md-<ngày>/)
import fs from 'node:fs';
import path from 'node:path';
import { stringifyYaml } from '../yamlmini.js';

const DIR = new URL('../skills/', import.meta.url).pathname;
const BACKUP = new URL(`../backups/skills-md-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}/`, import.meta.url).pathname;
const plain = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd');
const STOP = new Set('và của cho các những một là để có không được khi với trong theo từ này đó như'.split(' '));
const slug = (s) => plain(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'muc';
const list = (v) => (v ? v.replace(/^\[|\]$/g, '').split(',').map((x) => x.trim().replace(/^["']|["']$/g, '')).filter(Boolean) : []);
const tokens = (t) => [...new Set(t.toLowerCase().replace(/[^\p{L}\p{N}\s/]/gu, ' ').split(/\s+/).filter((w) => w.length >= 3 && !STOP.has(w)))];
const clean = (s) => s.replace(/\*\*/g, '').replace(/^[-•]\s*/, '').replace(/[:.\s]+$/, '').trim();

function titleOf(line, first) {
  const h = line.match(/^#{1,3}\s+(.*)/); if (h) return clean(h[1]);
  const b = line.match(/^(?:\d+\.\s+)?\*\*([^*]+)\*\*/); if (b) return clean(b[1]);
  return first ? 'Tổng quan' : clean(line.slice(0, 50));
}
const isLead = (l) => /^#{1,3}\s/.test(l) || /^(?:\d+\.\s+)?\*\*[^*]+\*\*/.test(l);

function split(body) {
  const lines = body.split('\n'), secs = [];
  let cur = null;
  lines.forEach((l, i) => {
    const startsPara = i === 0 || lines[i - 1].trim() === '';
    // Dòng mở đầu bằng **Tiêu đề** hoặc # luôn bắt đầu một mục; đoạn đầu tiên cũng là một mục.
    if (l.trim() && ((startsPara && !cur) || (/^(#{1,3}\s|\*\*[^*]+\*\*)/.test(l)) )) { cur = { title: titleOf(l, !secs.length && !isLead(l)), lines: [] }; secs.push(cur); }
    cur.lines.push(l);
  });
  // Mục nhiều gạch đầu dòng dài (vd danh sách sản phẩm) → tách từng gạch thành một mục để tra cứu chính xác.
  const out = [];
  for (const s of secs) {
    const bullets = s.lines.filter((l) => /^- /.test(l));
    if (bullets.length >= 5 && bullets.every((l) => l.length > 90)) {
      const head = s.lines.slice(0, s.lines.findIndex((l) => /^- /.test(l)));
      if (head.join('').trim()) out.push({ title: s.title, text: head.join('\n').trim() });
      for (const b of bullets) out.push({ title: clean(b.replace(/^- /, '').split(/[:(]/)[0]).slice(0, 60), text: b });
      const tail = s.lines.slice(s.lines.map((l) => /^- /.test(l)).lastIndexOf(true) + 1).join('\n').trim();
      if (tail) out.push({ title: s.title + ' (tiếp)', text: tail });
    } else out.push({ title: s.title, text: s.lines.join('\n').trim() });
  }
  // Skill gần như không có mục (chỉ danh sách/bảng): tách theo từng mục danh sách để tra cứu được chi tiết.
  if (out.length <= 2) {
    const items = body.split('\n').filter((l) => /^(- |\d+\. )/.test(l));
    if (items.length >= 4) {
      const res = [];
      let cur = null;
      for (const l of body.split('\n')) {
        if (/^(- |\d+\. )/.test(l)) { cur = { title: clean(l.replace(/^(- |\d+\. )/, '').replace(/\*\*/g, '').split(/[:(.]/)[0]).slice(0, 60), text: l }; res.push(cur); }
        else if (cur && l.trim()) cur.text += '\n' + l;
        else if (!cur && l.trim()) { if (!res.length || res[0].title !== 'Tổng quan') res.unshift({ title: 'Tổng quan', text: '' }); res[0].text += (res[0].text ? '\n' : '') + l; }
      }
      return res.filter((s) => s.text.trim());
    }
  }
  return out.filter((s) => s.text);
}

fs.mkdirSync(BACKUP, { recursive: true });
let n = 0;
for (const f of fs.readdirSync(DIR).filter((x) => /\.md$/i.test(x) && x.toLowerCase() !== 'readme.md' && !x.startsWith('_'))) {
  const raw = fs.readFileSync(path.join(DIR, f), 'utf8').replace(/^﻿/, '');
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  const meta = {};
  if (m) for (const line of m[1].split(/\r?\n/)) { const kv = line.match(/^(\w+)\s*:\s*(.*?)\s*(#.*)?$/); if (kv) meta[kv[1]] = kv[2]; }
  const body = (m ? raw.slice(m[0].length) : raw).trim();
  const used = new Set();
  const sections = split(body).map((s) => {
    let id = slug(s.title), k = 2; while (used.has(id)) id = `${slug(s.title)}-${k++}`; used.add(id);
    return { id, title: s.title, tags: tokens(s.title).slice(0, 6), text: s.text };
  });
  const firstText = body.split('\n').map((l) => l.replace(/^[#>*\-\s|]+/, '').replace(/\*\*/g, '').trim()).find((l) => l.length > 20) || '';
  const title = (meta.title || path.basename(f, '.md')).replace(/^["']|["']$/g, '');
  const doc = {
    id: path.basename(f, '.md'), title, summary: firstText.length > 150 ? firstText.slice(0, 147).replace(/\s+\S*$/, '') + '…' : firstText,
    agents: list(meta.agents), ...(list(meta.rooms).length ? { rooms: list(meta.rooms) } : {}), ...(list(meta.exclude).length ? { exclude: list(meta.exclude) } : {}),
    ...(list(meta.when).length ? { when: list(meta.when) } : {}), order: Number.isFinite(Number(meta.order)) ? Number(meta.order) : 100,
    tags: [...new Set(sections.flatMap((s) => s.tags))].slice(0, 12), updated: new Date().toISOString().slice(0, 10), sections,
  };
  fs.writeFileSync(path.join(DIR, path.basename(f, '.md') + '.yaml'), stringifyYaml(doc));
  fs.renameSync(path.join(DIR, f), path.join(BACKUP, f));
  n++; console.log(`${f} → ${sections.length} mục`);
}
console.log(`Đã chuyển ${n} skill; bản .md gốc ở ${BACKUP}`);
