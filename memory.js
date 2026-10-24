// Bộ nhớ phiên dùng chung: lưu kết quả các lần giao việc trước (memory.json) để lần sau agent dùng lại ngữ cảnh thay vì tìm hiểu lại từ đầu.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripData } from './report.js';

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'memory.json');
const MAX_ENTRIES = 30;

const plain = (s) => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');
const STOP = new Set(['hay', 'cho', 'toi', 'cua', 'cac', 'nhung', 'mot', 'va', 'la', 've', 'de', 'hom', 'nay', 'lai', 'bao', 'cao', 'lap', 'tao', 'viet', 'lam', 'gui', 'file', 'the', 'and', 'for']);
const words = (s) => new Set(plain(s).split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w)));
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

function load() {
  try { const l = JSON.parse(fs.readFileSync(FILE, 'utf8')); return Array.isArray(l) ? l : []; } catch { return []; }
}
const save = (list) => {
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(list, null, 1));
  fs.renameSync(tmp, FILE);
};

// items: [{ agent, title, status, text }]
export function remember({ command, summary, items = [], artifacts = [] }) {
  const entry = {
    ts: new Date().toISOString(), command: clip(command, 300), summary: clip(stripData(summary || ''), 1500),
    notes: items.filter((i) => i.status === 'done').map((i) => ({ agent: i.agent, note: clip(stripData(i.text || ''), 700) })),
    files: [...new Set(artifacts)].slice(0, 10),
  };
  save([...load(), entry].slice(-MAX_ENTRIES));
}

// Chọn tối đa 2 lần làm việc trước có liên quan (trùng từ khoá); lệnh ngắn kiểu "tiếp tục/cập nhật" thì lấy lần gần nhất.
export function recall(command) {
  const list = load();
  if (!list.length) return '';
  const q = words(command);
  let picks = list.map((e, i) => ({ e, i, s: [...words(e.command)].filter((w) => q.has(w)).length }))
    .filter((x) => x.s > 0).sort((a, b) => b.s - a.s || b.i - a.i).slice(0, 2).map((x) => x.e);
  if (!picks.length && q.size <= 4) picks = [list[list.length - 1]];
  if (!picks.length) return '';
  const body = picks.map((e) => `• [${new Date(e.ts).toLocaleString('vi-VN')}] Lệnh: ${e.command}\n  Kết quả: ${clip(e.summary, 700)}\n${e.notes.map((n) => `  - ${n.agent}: ${clip(n.note, 300)}`).join('\n')}${e.files.length ? `\n  File: ${e.files.join(', ')}` : ''}`).join('\n');
  return `\n\nBỘ NHỚ CHUNG (kết quả các lần làm việc trước, mốc thời gian ghi ở từng mục): dùng lại phần bối cảnh, phương pháp, kết luận, nguồn và file đã có để khỏi tìm hiểu lại từ đầu. Số liệu thay đổi theo thời gian từ bộ nhớ có thể đã cũ: nếu cần số hiện tại thì vẫn phải cập nhật bằng web_search.\n${body}`;
}

export const clearMemory = () => save([]);
export const memorySize = () => load().length;
