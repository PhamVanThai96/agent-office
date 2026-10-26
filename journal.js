import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Nhật ký làm việc THẬT của đội agent (ngày · agent · việc): mỗi task xong được ghi tự động bởi code, không do AI tự khai.
// Dùng để CEO xem đội đã làm gì theo ngày/tuần, và để cấp mã kịch bản (ENZ-001…) không trùng.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const DIR = path.join(ROOT, 'data', 'journal');
const LOG = path.join(DIR, 'log.jsonl');
const COUNTER = path.join(DIR, 'counter.json');
const p2 = (n) => String(n).padStart(2, '0');
const day = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;

// Tuần theo chuẩn ISO ("W43"), như cách đội mẫu gọi sprint tuần.
export function isoWeek(d = new Date()) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const n = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - n);
  return Math.ceil(((t - new Date(Date.UTC(t.getUTCFullYear(), 0, 1))) / 864e5 + 1) / 7);
}

const clean = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/** entry: { agent, name, title, kind?: 'task'|'verdict', verdict?, code? } */
export function addEntry(entry, now = new Date()) {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    const e = { at: now.toISOString(), day: day(now), week: isoWeek(now), agent: entry.agent, name: clean(entry.name, 40), title: clean(entry.title, 180), kind: entry.kind || 'task', ...(entry.verdict ? { verdict: entry.verdict } : {}), ...(entry.code ? { code: entry.code } : {}) };
    fs.appendFileSync(LOG, JSON.stringify(e) + '\n');
    return e;
  } catch { return null; } // nhật ký lỗi không được làm hỏng việc chính
}

export function list({ limit = 200, from = '', to = '', agent = '' } = {}) {
  let rows = [];
  try { rows = fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { /* chưa có nhật ký */ }
  if (from) rows = rows.filter((r) => r.day >= from);
  if (to) rows = rows.filter((r) => r.day <= to);
  if (agent) rows = rows.filter((r) => r.agent === agent);
  return rows.slice(-Math.min(Math.max(limit, 1), 2000)).reverse();
}

// Mã kịch bản tăng dần, không trùng (ENZ-001, ENZ-002…), lưu bền ở data/journal/counter.json.
export function nextScriptCode(prefix = 'ENZ') {
  let c = {};
  try { c = JSON.parse(fs.readFileSync(COUNTER, 'utf8')); } catch { /* bắt đầu từ 1 */ }
  const n = (c[prefix] || 0) + 1;
  try { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(COUNTER, JSON.stringify({ ...c, [prefix]: n })); } catch { /* không lưu được: vẫn trả mã */ }
  return `${prefix}-${String(n).padStart(3, '0')}`;
}

// Kết luận của người duyệt: DUYỆT / DUYỆT CÓ ĐIỀU KIỆN / YÊU CẦU SỬA (hoặc ĐẠT / ĐẠT CÓ ĐIỀU KIỆN / KHÔNG ĐẠT).
export function verdictOf(text) {
  const m = String(text || '').match(/K[ẾE]T LU[ẬA]N\s*:\s*([^\n.]{2,40})/i);
  return m ? clean(m[1], 40).toUpperCase() : '';
}
