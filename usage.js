import fs from 'node:fs';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { fileURLToPath } from 'node:url';

// Giám sát token: ghi mọi lượt gọi AI (API hoặc CLI) theo model, theo yêu cầu và theo ngày.
// Mỗi tháng một file data/usage/YYYY-MM.json — sang tháng mới tự bắt đầu file mới (số liệu "reset"), tháng cũ vẫn xem lại được.
const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data', 'usage');
const MAX_REQUESTS = 500;
const als = new AsyncLocalStorage();

const p2 = (n) => String(n).padStart(2, '0');
export const monthKey = (d = new Date()) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}`;
const dayKey = (d = new Date()) => `${monthKey(d)}-${p2(d.getDate())}`;
const fileOf = (month) => path.join(DIR, `${month}.json`);
const int = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.round(Number(v)) : 0);

const cache = new Map();
let timer = null;
const dirty = new Set();

const empty = (month) => ({ month, totals: { in: 0, out: 0, other: 0, cached: 0, calls: 0, estCalls: 0 }, models: {}, days: {}, requests: [] });
function load(month) {
  if (cache.has(month)) return cache.get(month);
  let m;
  try { m = JSON.parse(fs.readFileSync(fileOf(month), 'utf8')); } catch { m = null; }
  m = m && m.month === month ? m : empty(month);
  cache.set(month, m);
  return m;
}
function flush() {
  clearTimeout(timer); timer = null;
  for (const month of dirty) {
    try { fs.mkdirSync(DIR, { recursive: true }); const f = fileOf(month); fs.writeFileSync(f + '.tmp', JSON.stringify(cache.get(month))); fs.renameSync(f + '.tmp', f); } catch (e) { console.warn(`[usage] ${e.message}`); }
  }
  dirty.clear();
}
process.on('exit', flush);

// Gom các lượt gọi AI thuộc cùng một yêu cầu của CEO (kể cả bước lập kế hoạch, hỏi đồng nghiệp, tổng hợp).
let seq = 0;
export function withRequest(label, fn) {
  const id = `${Date.now().toString(36)}${(seq++).toString(36)}`;
  return als.run({ id, label: String(label || '').replace(/\s+/g, ' ').trim().slice(0, 160) || '(không tên)' }, fn);
}

export const estimate = (text) => Math.ceil(String(text || '').length / 4);

/**
 * u: { provider, model, via: 'api'|'cli', input, output, other (tổng không tách vào/ra), cached (phần input đọc từ cache), agent, estimated }
 */
export function record(u) {
  const input = int(u.input), output = int(u.output), other = int(u.other), cached = Math.min(int(u.cached), input);
  if (!input && !output && !other) return;
  const now = new Date(), month = monthKey(now), m = load(month);
  const model = String(u.model || '').trim() || 'mặc định của CLI', provider = String(u.provider || '?'), via = u.via === 'cli' ? 'cli' : 'api';
  const key = `${provider}|${model}|${via}`;
  const t = m.totals; t.in += input; t.out += output; t.other += other; t.cached += cached; t.calls++; if (u.estimated) t.estCalls++;
  const e = m.models[key] ||= { provider, model, via, in: 0, out: 0, other: 0, cached: 0, calls: 0, estCalls: 0 };
  e.in += input; e.out += output; e.other += other; e.cached += cached; e.calls++; if (u.estimated) e.estCalls++;
  const d = ((m.days[dayKey(now)] ||= {})[key] ||= { i: 0, o: 0 });
  d.i += input; d.o += output + other;
  const ctx = als.getStore() || { id: 'ngoai-yeu-cau', label: '(ngoài yêu cầu của CEO)' };
  let r = m.requests.find((x) => x.id === ctx.id);
  if (!r) { r = { id: ctx.id, at: now.getTime(), label: ctx.label, in: 0, out: 0, other: 0, calls: 0, models: {}, agents: {} }; m.requests.push(r); if (m.requests.length > MAX_REQUESTS) m.requests.shift(); }
  r.in += input; r.out += output; r.other += other; r.calls++; r.last = now.getTime();
  const rm = r.models[key] ||= { in: 0, out: 0, other: 0 }; rm.in += input; rm.out += output; rm.other += other;
  const ag = String(u.agent || 'hệ thống'); r.agents[ag] = (r.agents[ag] || 0) + input + output + other;
  dirty.add(month);
  if (!timer) { timer = setTimeout(flush, 800); timer.unref?.(); }
}

export function months() {
  try { return fs.readdirSync(DIR).map((f) => f.match(/^(\d{4}-\d{2})\.json$/)?.[1]).filter(Boolean).sort(); } catch { return []; }
}

const sum = (t) => t.in + t.out + t.other;

// Hạn mức token/tháng do người dùng tự đặt (app không đọc được số dư thật của gói Claude/ChatGPT); 0 = chưa đặt.
const SETTINGS = path.join(DIR, 'settings.json');
export function getLimit() {
  try { const n = Number(JSON.parse(fs.readFileSync(SETTINGS, 'utf8')).monthlyLimit); return Number.isFinite(n) && n > 0 ? Math.round(n) : 0; } catch { return 0; }
}
export function setLimit(n) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v) || v < 0 || v > 1e12) throw new Error('Hạn mức không hợp lệ.');
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(SETTINGS, JSON.stringify({ monthlyLimit: v }));
  return v;
}

// Số liệu gọn cho thanh theo dõi ở màn hình chính: đã dùng, hạn mức, còn lại, dự kiến cả tháng.
export function mini() {
  const now = new Date(), m = load(monthKey(now)), used = sum(m.totals), limit = getLimit();
  const dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const projected = Math.round(used / Math.max(1, now.getDate() - 1 + (now.getHours() + 1) / 24) * dim);
  return { month: m.month, used, limit, remaining: limit ? Math.max(0, limit - used) : null, projected, calls: m.totals.calls };
}
// Dữ liệu cho dashboard: tháng được chọn (mặc định tháng hiện tại) + tổng từ trước đến nay (cộng mọi tháng, không bị reset).
export function summary(month = monthKey()) {
  const cur = monthKey();
  const list = [...new Set([...months(), cur])].sort();
  if (!list.includes(month)) month = cur;
  const m = load(month);
  const all = list.map((k) => ({ month: k, total: sum(load(k).totals), calls: load(k).totals.calls }));
  const now = new Date(), nextReset = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime();
  return {
    month, current: cur, months: list, totals: m.totals, models: Object.values(m.models), days: m.days,
    requests: [...m.requests].sort((a, b) => b.at - a.at),
    allTime: { total: all.reduce((s, x) => s + x.total, 0), calls: all.reduce((s, x) => s + x.calls, 0), months: all },
    nextReset, limit: getLimit(), mini: mini(),
  };
}
