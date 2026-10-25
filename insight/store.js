import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { plain } from '../skills.js';

// Bộ nhớ "Ý kiến khách hàng" (Voice of Customer) — cấu trúc để agent ngày càng hiểu khách hơn mà không tốn token:
//  - ledger.json : các khoảng ngày ĐÃ cào (mỗi khoảng ≤ 7 ngày, không chồng nhau) → biết cào tiếp từ đâu.
//  - seen.json   : băm (id hội thoại + dòng) đã xử lý → khách cũ nhắn lại chỉ tính phần MỚI, không đếm trùng.
//  - raw/        : dữ liệu thô từng khoảng (để chưng cất lại khi cần). Chứa link hội thoại: chỉ ở máy này (data/ không đưa lên git).
//  - kb.json     : kho chủ đề đã chắt lọc (đếm khách theo tuần, trích dẫn ẩn danh, điểm chạm gợi ý, cụm từ khách hay dùng).
//  - digest      : bản tóm tắt ngắn (≤ ~2.800 ký tự) sinh từ kb.json — đây là phần duy nhất đưa vào prompt agent; chi tiết tra bằng insight_search.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DIR = path.join(ROOT, 'data', 'insight');
export const RAW_DIR = path.join(DIR, 'raw');
export const DIGEST_FILE = path.join(ROOT, 'reports', 'insight', 'digest.md');
const KB_FILE = path.join(DIR, 'kb.json');
const LEDGER_FILE = path.join(DIR, 'ledger.json');
const SEEN_FILE = path.join(DIR, 'seen.json');

const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const writeJson = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); const t = f + '.tmp'; fs.writeFileSync(t, JSON.stringify(v)); fs.renameSync(t, f); };

// ---- Ngày (YYYY-MM-DD, giờ địa phương) ----
const p2 = (n) => String(n).padStart(2, '0');
export const iso = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
export const parseIso = (s) => { const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
export const addDays = (s, n) => { const d = parseIso(s); d.setDate(d.getDate() + n); return iso(d); };
export const dayDiff = (a, b) => Math.round((parseIso(b) - parseIso(a)) / 864e5);
export const vn = (s) => { const d = parseIso(s); return d ? `${p2(d.getDate())}/${p2(d.getMonth() + 1)}` : s; };
export const vnFull = (s) => { const d = parseIso(s); return d ? `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}` : s; };
export const yesterday = (now = new Date()) => iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));

// ---- Sổ các khoảng đã cào ----
export const WINDOW_DAYS = 7; // trang chỉ cho cào tối đa 7 ngày mỗi lần
export const loadLedger = () => { const l = readJson(LEDGER_FILE, null); return l && Array.isArray(l.windows) ? l : { start: '', windows: [], lastError: '' }; };
export const saveLedger = (l) => writeJson(LEDGER_FILE, l);

export function recordWindow(ledger, w) {
  ledger.windows = ledger.windows.filter((x) => !(x.from === w.from && x.to === w.to));
  ledger.windows.push(w);
  ledger.windows.sort((a, b) => a.from.localeCompare(b.from));
  return ledger;
}

// Các khoảng chưa cào trong [from, to], cắt thành cửa sổ ≤ 7 ngày, xếp từ cũ đến mới, KHÔNG chồng lên khoảng đã cào.
export function nextWindows(ledger, from, to, limit = 1) {
  if (!from || !to || from > to) return [];
  const done = ledger.windows.filter((w) => w.status !== 'error');
  const out = [];
  let cur = from;
  while (cur <= to && out.length < limit) {
    const hit = done.find((w) => w.from <= cur && cur <= w.to);
    if (hit) { cur = addDays(hit.to, 1); continue; }
    // Ngày kết thúc: tối đa 7 ngày, dừng trước khoảng đã cào kế tiếp và không vượt quá `to`.
    const nextDone = done.filter((w) => w.from > cur).map((w) => w.from).sort()[0];
    let end = addDays(cur, WINDOW_DAYS - 1);
    if (end > to) end = to;
    if (nextDone && end >= nextDone) end = addDays(nextDone, -1);
    out.push({ from: cur, to: end });
    cur = addDays(end, 1);
  }
  return out;
}

export function coverage(ledger) {
  const ok = ledger.windows.filter((w) => w.status !== 'error');
  if (!ok.length) return null;
  return { from: ok[0].from, to: ok.at(-1).to, windows: ok.length, customers: ok.reduce((s, w) => s + (w.customers || 0), 0) };
}

// ---- Dấu vết đã xử lý (chống đếm trùng) ----
export const lineHash = (cid, line) => crypto.createHash('sha1').update(`${cid}|${String(line).trim().toLowerCase()}`).digest('hex').slice(0, 12);
export const loadSeen = () => new Set(readJson(SEEN_FILE, []));
export const saveSeen = (set) => writeJson(SEEN_FILE, [...set]);

// ---- Ẩn danh: bỏ link, email, số điện thoại, dãy số dài, @tên, cắt độ dài ----
export function scrub(text, max = 140) {
  let t = String(text ?? '')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, ' ')
    .replace(/(?:\+?84|0)[\s.-]?\d(?:[\s.-]?\d){7,9}/g, ' ')
    .replace(/\d[\d\s.,-]{6,}\d/g, ' ')
    .replace(/@\w+/g, ' ')
    .replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

// ---- Kho chủ đề ----
export const TYPE_LABEL = { 'cau-hoi': 'Câu hỏi', 'lo-ngai': 'Lo ngại', 'mong-muon': 'Mong muốn', 'phan-doi': 'Phản đối', 'tinh-huong': 'Tình huống dùng', 'ngon-ngu': 'Cách nói' };
export const STAGE_LABEL = { 'nhan-biet': 'Nhận biết', 'can-nhac': 'Cân nhắc', 'quyet-dinh': 'Quyết định', 'sau-mua': 'Sau mua' };
const TYPES = Object.keys(TYPE_LABEL), STAGES = Object.keys(STAGE_LABEL);
const MAX_THEMES = 80, MAX_VOCAB = 60, MAX_QUOTES = 4, MAX_SUMMARIES = 12;

export const loadKb = () => { const k = readJson(KB_FILE, null); return k && k.themes ? k : { version: 1, updated: '', themes: {}, vocab: {}, summaries: [] }; };
export const saveKb = (kb) => { kb.updated = new Date().toISOString(); writeJson(KB_FILE, kb); };
// Thông tin nhẹ cho trạng thái (giao diện poll mỗi 0,6s): chỉ đọc lại kb.json khi file đổi.
let kbInfoCache = { m: -1, v: { themes: 0, updated: '' } };
export function kbInfo() {
  try {
    const m = fs.statSync(KB_FILE).mtimeMs;
    if (m !== kbInfoCache.m) { const k = loadKb(); kbInfoCache = { m, v: { themes: Object.keys(k.themes).length, updated: k.updated } }; }
  } catch { return { themes: 0, updated: '' }; }
  return kbInfoCache.v;
}

const tokens = (s) => new Set(plain(s).replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 1));
const jacc = (a, b) => { let i = 0; for (const x of a) if (b.has(x)) i++; return i / (a.size + b.size - i || 1); };
const slug = (s) => plain(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'chu-de';

function findTheme(kb, o) {
  if (o.theme && kb.themes[o.theme]) return kb.themes[o.theme];
  const t = tokens(o.label);
  let best = null, bs = 0;
  for (const th of Object.values(kb.themes)) { const s = jacc(t, tokens(th.label)); if (s > bs) { bs = s; best = th; } }
  return bs >= 0.6 ? best : null;
}

const weeksBetween = (from, to) => Math.max(0, dayDiff(from, to) / 7);
// Điểm "gần đây": số khách theo từng tuần, tuần càng cũ càng giảm (×0,85 mỗi tuần).
export const recentScore = (th, asOf) => Object.entries(th.byWindow || {}).reduce((s, [w, n]) => s + n * 0.85 ** weeksBetween(w, asOf), 0);

/**
 * Hợp nhất kết quả chưng cất của một khoảng vào kho. win = { from, to }.
 * obs: [{ theme?, label, type, stage, product, count, quotes[], touchpoint }]. Trả về { merged, created }.
 */
export function mergeObservations(kb, win, obs = [], vocab = [], summary = '') {
  let merged = 0, created = 0;
  for (const raw of obs) {
    const label = String(raw?.label || '').trim().slice(0, 80);
    const count = Math.max(1, Math.round(Number(raw?.count) || 1));
    if (!label) continue;
    const o = { ...raw, label, count };
    let th = findTheme(kb, o);
    if (!th) {
      let id = slug(label), n = 2;
      while (kb.themes[id]) id = `${slug(label)}-${n++}`;
      th = kb.themes[id] = { id, label, type: TYPES.includes(o.type) ? o.type : 'cau-hoi', stage: STAGES.includes(o.stage) ? o.stage : 'can-nhac', product: '', count: 0, firstSeen: win.from, lastSeen: win.to, byWindow: {}, quotes: [], touchpoint: '' };
      created++;
    }
    th.count += count;
    th.byWindow[win.from] = (th.byWindow[win.from] || 0) + count;
    if (win.from < th.firstSeen) th.firstSeen = win.from;
    if (win.to > th.lastSeen) th.lastSeen = win.to;
    if (o.product && !th.product) th.product = String(o.product).slice(0, 60);
    if (TYPES.includes(o.type) && th.count === count) th.type = o.type;
    if (STAGES.includes(o.stage) && th.count === count) th.stage = o.stage;
    const tp = String(o.touchpoint || '').trim().slice(0, 200);
    if (tp && (!th.touchpoint || count >= 3)) th.touchpoint = tp;
    for (const q of (Array.isArray(o.quotes) ? o.quotes : []).slice(0, 2)) {
      const c = scrub(q, 120);
      if (c.length >= 6 && !th.quotes.some((x) => plain(x.t) === plain(c))) th.quotes.unshift({ t: c, w: win.from });
    }
    th.quotes = th.quotes.slice(0, MAX_QUOTES);
    merged++;
  }
  for (const v of vocab) {
    const k = scrub(v, 50).toLowerCase();
    if (k.length >= 3) kb.vocab[k] = (kb.vocab[k] || 0) + 1;
  }
  if (summary) kb.summaries = [{ from: win.from, to: win.to, text: String(summary).slice(0, 400) }, ...kb.summaries.filter((s) => s.from !== win.from)].slice(0, MAX_SUMMARIES);
  prune(kb, win.to);
  return { merged, created };
}

// Chắt lọc: giữ kho gọn và phản ánh hiện tại — bỏ chủ đề cũ, lẻ tẻ; giữ tối đa MAX_THEMES chủ đề điểm cao nhất.
export function prune(kb, asOf) {
  const ths = Object.values(kb.themes);
  for (const th of ths) {
    const old = dayDiff(th.lastSeen, asOf) > 42;
    if (th.count <= 1 && old) delete kb.themes[th.id];
  }
  const rest = Object.values(kb.themes).sort((a, b) => recentScore(b, asOf) - recentScore(a, asOf));
  for (const th of rest.slice(MAX_THEMES)) if (th.count < 3) delete kb.themes[th.id];
  const v = Object.entries(kb.vocab).sort((a, b) => b[1] - a[1]).slice(0, MAX_VOCAB);
  kb.vocab = Object.fromEntries(v);
}

const arrow = (th, asOf, lastFrom) => {
  const cur = th.byWindow?.[lastFrom] || 0;
  const prev = Object.entries(th.byWindow || {}).filter(([w]) => w < lastFrom).sort().at(-1)?.[1] || 0;
  if (th.firstSeen >= lastFrom && cur) return ' 🆕';
  if (cur >= 3 && cur > prev * 1.5) return ' ↑';
  if (prev >= 3 && cur < prev * 0.5) return ' ↓';
  return '';
};

/** Bản tóm tắt đưa vào prompt (ngắn). Rỗng nếu chưa có dữ liệu. */
export function digestText(kb, ledger, maxChars = 2800) {
  const cov = coverage(ledger);
  const ths = Object.values(kb.themes);
  if (!cov || !ths.length) return '';
  // Mốc "tuần gần nhất" = khoảng cuối cùng có khách MỚI (khoảng rỗng/trùng không làm mọi chủ đề hiện ↓).
  const okWins = ledger.windows.filter((w) => w.status !== 'error');
  const asOf = cov.to, lastFrom = (okWins.filter((w) => w.newCustomers > 0).at(-1) || okWins.at(-1)).from;
  const ranked = ths.map((t) => ({ t, s: recentScore(t, asOf) })).sort((a, b) => b.s - a.s);
  const L = [`Nguồn: ý kiến khách hàng thật (Inbox + Comment) ${vnFull(cov.from)} – ${vnFull(cov.to)}, ${cov.customers} khách, ${ths.length} chủ đề (con số = số khách nhắc tới, không phải toàn bộ khách).`];
  L.push('Chủ đề nổi bật (điểm gần đây giảm dần):');
  ranked.slice(0, 10).forEach(({ t }, i) => {
    const q = t.quotes[0] ? ` — khách nói: "${t.quotes[0].t}"` : '';
    L.push(`${i + 1}. [${TYPE_LABEL[t.type]} · ${STAGE_LABEL[t.stage]}${t.product ? ` · ${t.product}` : ''}] ${t.label} — ${t.count} khách${arrow(t, asOf, lastFrom)}${t.touchpoint ? ` · điểm chạm: ${t.touchpoint}` : ''}${q}`);
  });
  const rising = ranked.filter(({ t }) => arrow(t, asOf, lastFrom).trim() && /↑|🆕/.test(arrow(t, asOf, lastFrom))).slice(0, 4).map(({ t }) => t.label);
  if (rising.length) L.push(`Mới nổi tuần gần nhất (${vn(lastFrom)}–${vn(cov.to)}): ${rising.join('; ')}.`);
  const byStage = {};
  for (const t of ths) byStage[t.stage] = (byStage[t.stage] || 0) + t.count;
  L.push(`Theo giai đoạn phễu (số khách nhắc): ${Object.entries(byStage).sort((a, b) => b[1] - a[1]).map(([s, n]) => `${STAGE_LABEL[s]} ${n}`).join(' · ')}.`);
  const sum = kb.summaries?.[0];
  if (sum?.text) L.push(`Tóm tắt khoảng gần nhất (${vn(sum.from)}–${vn(sum.to)}): ${sum.text}`);
  const vocab = Object.entries(kb.vocab).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k]) => `"${k}"`);
  if (vocab.length) L.push(`Cách khách hay nói: ${vocab.join(', ')}.`);
  L.push('Tra chi tiết/trích dẫn bằng công cụ insight_search; không suy diễn ngoài các con số trên.');
  let out = L.join('\n');
  if (out.length > maxChars) out = out.slice(0, maxChars - 1) + '…';
  return out;
}

export function writeDigest(kb, ledger) {
  const text = digestText(kb, ledger);
  try {
    fs.mkdirSync(path.dirname(DIGEST_FILE), { recursive: true });
    fs.writeFileSync(DIGEST_FILE, `# Insight khách hàng (tự cập nhật)\n\n${text || 'Chưa có dữ liệu.'}\n`);
  } catch { /* chỉ để xem trên trang Báo cáo */ }
  return text;
}

/** Tra cứu chủ đề trong kho (cho công cụ insight_search). */
export function searchKb(kb, ledger, query, limit = 5) {
  const cov = coverage(ledger);
  const asOf = cov?.to || iso(new Date());
  const q = plain(query || '');
  const terms = [...new Set(q.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length >= 2))];
  const score = (t) => {
    const hay = plain(`${t.label} ${t.product} ${t.touchpoint} ${TYPE_LABEL[t.type]} ${STAGE_LABEL[t.stage]} ${t.quotes.map((x) => x.t).join(' ')}`);
    return terms.reduce((s, w) => s + (hay.includes(w) ? (plain(t.label).includes(w) ? 3 : 1) : 0), 0);
  };
  const all = Object.values(kb.themes);
  const hits = (terms.length ? all.map((t) => ({ t, s: score(t) })).filter((x) => x.s > 0) : all.map((t) => ({ t, s: recentScore(t, asOf) })))
    .sort((a, b) => b.s - a.s || b.t.count - a.t.count).slice(0, Math.min(Math.max(Number(limit) || 5, 1), 8));
  return hits.map(({ t }) => ({
    label: t.label, type: TYPE_LABEL[t.type], stage: STAGE_LABEL[t.stage], product: t.product || undefined, customers: t.count,
    firstSeen: vnFull(t.firstSeen), lastSeen: vnFull(t.lastSeen), perWeek: Object.fromEntries(Object.entries(t.byWindow).sort().slice(-6).map(([w, n]) => [vn(w), n])),
    touchpoint: t.touchpoint || undefined, quotes: t.quotes.map((x) => x.t),
  }));
}
