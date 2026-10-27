import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchEnzy } from './fetch.js';
import { parseEnzy, buildDataMarkdown, snapshot, kindLabel } from './metrics.js';
import { normalizeAds, filterByKeywords, groupByKeyword, keywordStats, keywordSummaryMarkdown, criteriaMarkdown, normTargets, groupByOwner, buildOwnerDashboard, ownerSummaryMarkdown } from './owners.js';

// Báo cáo quảng cáo Enzy tự động: lấy số liệu từ trang Streamlit → tính chỉ số, bảng, biểu đồ → giao #analyst viết nhận định.
// Cấu hình ở enzy.json (quyền 600, chứa tài khoản đăng nhập trang báo cáo; agent không được đọc/ghi file này).
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CONFIG_FILE = path.join(ROOT, 'enzy.json');
const DATA = path.join(ROOT, 'data', 'enzy');
const STATE = path.join(DATA, 'state.json');
export const KINDS = ['daily', 'weekly', 'monthly'];
const KIND_LABEL = { daily: 'Báo cáo ngày', weekly: 'Báo cáo tuần', monthly: 'Báo cáo tháng' };
// Nhãn đặt trước tiêu đề báo cáo để dễ tìm/lọc: [Daily] / [Weekly] / [Monthly].
const KIND_TAG = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' };
// Tuần/tháng lấy theo lịch (xem calendarRange), nhãn dưới đây chỉ để hiển thị.
const RANGE = { daily: 'Hôm qua (trọn ngày)', weekly: 'Tuần theo lịch (1–7, 8–14, 15–21, 22–28, 29–cuối tháng)', monthly: 'Tháng dương lịch' };

const DEFAULTS = {
  URL: 'https://enzyfood.streamlit.app/~/+/',
  USER: '', PASS: '',
  BRAND: 'Enzy', SYSTEM: 'Facebook Ads', STORE: 'HNC Vietnam',
  ACCOUNTS: ['Enzy 1', 'Enzy 2', 'Enzy 5', 'Enzy 6', 'Enzy 8'],
  TARGETS: {},         // mục tiêu "Hiệu quả content": { cpa|rev|ns|cpl: { op: '<'|'<='|'>'|'>=', value } } (đ; NS/DT tính %); trống = so với mặt bằng của nhóm
  KEYWORDS: [],        // từ khoá trong TÊN quảng cáo (vd STAC, LNT): chỉ tính quảng cáo có chứa một trong các từ khoá; để trống = chỉ lọc theo người thực hiện
  OWNERS: ['TRÂN', 'NGA'], // người thực hiện: tên nằm cuối tên quảng cáo, vd "… (TRÂN)"; để trống = không tạo dashboard theo người
  PROMPT: 'prompt/daily-report-enzy-data-prompt.md',
  SCHEDULE: { enabled: false, daily: '08:00', weekly: { day: 1, time: '08:30' }, monthly: { day: 1, time: '09:00' } },
};

const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const writeJson = (f, v, mode) => { fs.mkdirSync(path.dirname(f), { recursive: true }); const t = f + '.tmp'; fs.writeFileSync(t, JSON.stringify(v, null, 2) + '\n', mode ? { mode } : undefined); fs.renameSync(t, f); };

// Tạo enzy.json mẫu (USER/PASS để trống cho người dùng tự điền) nếu chưa có.
export function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) writeJson(CONFIG_FILE, DEFAULTS, 0o600);
  const raw = readJson(CONFIG_FILE, {});
  return { ...DEFAULTS, ...raw, SCHEDULE: { ...DEFAULTS.SCHEDULE, ...(raw.SCHEDULE || {}) } };
}

export function saveSchedule(s) {
  const raw = readJson(CONFIG_FILE, { ...DEFAULTS });
  const hhmm = (v, d) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(String(v)) ? String(v) : d);
  const day = (v, lo, hi, d) => { const n = Math.round(Number(v)); return n >= lo && n <= hi ? n : d; };
  const cur = { ...DEFAULTS.SCHEDULE, ...(raw.SCHEDULE || {}) };
  raw.SCHEDULE = {
    enabled: s.enabled === true,
    daily: hhmm(s.daily, cur.daily),
    weekly: { day: day(s.weeklyDay, 0, 6, cur.weekly.day), time: hhmm(s.weeklyTime, cur.weekly.time) },
    monthly: { day: day(s.monthlyDay, 1, 28, cur.monthly.day), time: hhmm(s.monthlyTime, cur.monthly.time) },
  };
  writeJson(CONFIG_FILE, raw, 0o600);
  return raw.SCHEDULE;
}

// Cấu hình hiển thị trên GUI: không bao giờ trả mật khẩu về trình duyệt, chỉ báo đã lưu hay chưa.
export function publicConfig() {
  const c = loadConfig();
  return {
    URL: c.URL, USER: c.USER, hasPass: Boolean(c.PASS), envCreds: Boolean(process.env.ENZY_USER || process.env.ENZY_PASS),
    BRAND: c.BRAND, SYSTEM: c.SYSTEM, STORE: c.STORE, ACCOUNTS: c.ACCOUNTS, OWNERS: c.OWNERS, KEYWORDS: c.KEYWORDS || [], TARGETS: c.TARGETS || {}, PROMPT: c.PROMPT,
  };
}

// Lưu cấu hình từ GUI. PASS để trống = giữ nguyên; lịch chạy do saveSchedule quản lý nên không đụng tới.
export function saveConfig(b) {
  const text = (v, name, max = 200) => {
    const t = String(v ?? '').trim();
    if (!t) throw new Error(`${name} không được để trống.`);
    if (t.length > max) throw new Error(`${name} quá dài.`);
    return t;
  };
  const raw = readJson(CONFIG_FILE, { ...DEFAULTS });
  let u;
  try { u = new URL(text(b.URL, 'URL trang báo cáo', 500)); } catch { throw new Error('URL trang báo cáo không hợp lệ.'); }
  if (!['https:', 'http:'].includes(u.protocol)) throw new Error('URL phải bắt đầu bằng https:// (hoặc http://).');
  const accounts = [...new Set((Array.isArray(b.ACCOUNTS) ? b.ACCOUNTS : String(b.ACCOUNTS || '').split(/[\n,]/)).map((x) => String(x).trim()).filter(Boolean))];
  if (!accounts.length) throw new Error('Cần ít nhất 1 tài khoản quảng cáo.');
  if (accounts.length > 5) throw new Error('Trang báo cáo chỉ so sánh tối đa 5 tài khoản.');
  if (accounts.some((a) => a.length > 80)) throw new Error('Tên tài khoản quảng cáo quá dài.');
  const owners = [...new Set((Array.isArray(b.OWNERS) ? b.OWNERS : String(b.OWNERS || '').split(/[\n,;]/)).map((x) => String(x).trim()).filter(Boolean))];
  if (owners.length > 10) throw new Error('Tối đa 10 người thực hiện.');
  if (owners.some((o) => o.length > 30 || /[()]/.test(o))) throw new Error('Tên người thực hiện tối đa 30 ký tự, không chứa dấu ngoặc.');
  const keywords = [...new Set((Array.isArray(b.KEYWORDS) ? b.KEYWORDS : String(b.KEYWORDS || '').split(/[\n,;]/)).map((x) => String(x).trim()).filter(Boolean))];
  if (keywords.length > 20) throw new Error('Tối đa 20 từ khoá.');
  if (keywords.some((k) => k.length > 40)) throw new Error('Mỗi từ khoá tối đa 40 ký tự.');
  const targets = {};
  for (const k of ['cpa', 'rev', 'ns', 'cpl']) {
    const x = b.TARGETS?.[k];
    if (!x || x.value === '' || x.value == null) continue;
    const v = Number(String(x.value).replace(/[.\s]/g, '').replace(',', '.'));
    if (!['<', '<=', '>', '>='].includes(x.op)) throw new Error('Điều kiện mục tiêu không hợp lệ (chọn <, ≤, >, ≥).');
    if (!Number.isFinite(v) || v < 0 || v > 1e12) throw new Error('Giá trị mục tiêu phải là số không âm.');
    if (k === 'ns' && v > 1000) throw new Error('NS/DT nhập theo % (vd 40).');
    targets[k] = { op: x.op, value: v };
  }
  const prompt = text(b.PROMPT, 'File prompt', 300);
  const abs = path.resolve(ROOT, prompt);
  if (abs !== ROOT && !abs.startsWith(ROOT + path.sep)) throw new Error('File prompt phải nằm trong thư mục dự án.');
  if (!/\.(md|txt)$/i.test(abs)) throw new Error('File prompt phải là .md hoặc .txt.');
  if (!fs.existsSync(abs)) throw new Error(`Không thấy file prompt: ${prompt}`);
  raw.URL = u.toString();
  raw.USER = String(b.USER ?? '').trim().slice(0, 200);
  if (b.clearPass === true) raw.PASS = '';
  else if (typeof b.PASS === 'string' && b.PASS !== '') raw.PASS = b.PASS.slice(0, 200);
  raw.BRAND = text(b.BRAND, 'Thương hiệu', 80);
  raw.SYSTEM = text(b.SYSTEM, 'Hệ thống quảng cáo', 80);
  raw.STORE = text(b.STORE, 'Cửa hàng', 80);
  raw.ACCOUNTS = accounts;
  raw.OWNERS = owners;
  raw.KEYWORDS = keywords;
  raw.TARGETS = targets;
  raw.PROMPT = prompt;
  writeJson(CONFIG_FILE, raw, 0o600);
}

// "00:00 17/10/2026 đến 23:59 23/10/2026" → "17/10 – 23/10/2026"; một ngày → "23/10/2026".
function periodLabel(period) {
  const ds = [...String(period).matchAll(/(\d{2})\/(\d{2})\/(\d{4})/g)].map((m) => m.slice(1));
  if (!ds.length) return String(period || '');
  const [a, b] = [ds[0], ds.at(-1)];
  return a.join('/') === b.join('/') ? b.join('/') : `${a[0]}/${a[1]} – ${b[0]}/${b[1]}/${b[2]}`;
}

// Dashboard content theo người thực hiện (HTML độc lập) từ danh sách từng quảng cáo. Trả về đường dẫn tương đối trong reports/ hoặc ''.
function writeOwnerDashboard(cfg, kind, key, d, rows, write = true) {
  const owners = cfg.OWNERS || [], kws = cfg.KEYWORDS || [];
  if ((!owners.length && !kws.length) || !rows?.length) return '';
  const f = filterByKeywords(normalizeAds(rows), kws);   // từ khoá trống = không lọc
  const lab = periodLabel(d.period);
  const kwTag = f.info.list.length ? ` [${f.info.list.join(', ')}]` : '';
  let g, title, mdAll;
  if (!owners.length) {
    // Chỉ có từ khoá (không có người thực hiện): so sánh hiệu năng các chiến dịch theo từ khoá (STAC vs LNT…).
    g = { ...groupByKeyword(f.ads, kws), kw: f.info, targets: cfg.TARGETS };
    title = `[${KIND_TAG[kind]}] So sánh chiến dịch theo từ khoá ${g.listed.join(' vs ')} — ${kindLabel(kind, d.period)} ${lab}`;
    mdAll = keywordSummaryMarkdown(keywordStats(f.ads, kws), f.info, lab, true);
  } else {
    // Có người thực hiện: so sánh người như cũ; nếu có thêm từ khoá thì bổ sung biểu đồ + số liệu so sánh các từ khoá.
    g = { ...groupByOwner(f.ads, owners), kw: f.info, targets: cfg.TARGETS };
    if (kws.length) g.kwStats = keywordStats(f.ads, kws);
    title = `[${KIND_TAG[kind]}] Dashboard content ${g.listed.join(' + ')} và nhóm còn lại${kwTag} — ${kindLabel(kind, d.period)} ${lab}`;
    mdAll = ownerSummaryMarkdown(g, lab) + (kws.length ? '\n' + keywordSummaryMarkdown(g.kwStats, f.info, lab, false) : '');
  }
  mdAll = criteriaMarkdown(g.rows, undefined, cfg.TARGETS) + '\n' + mdAll;   // panel tiêu chí & ngưỡng đánh giá nằm đầu phần số liệu theo content
  // Chỉ xuất báo cáo (không dashboard): vẫn có bảng so sánh nhưng bỏ dòng link tới dashboard.
  if (!write) return { rel: '', md: mdAll.replace(/^\[📈 Mở Dashboard content[^\n]*\n?/m, '') };
  const dir = path.join(ROOT, 'reports', 'enzy', kind);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${key}-dashboard-content.html`), buildOwnerDashboard({ title, period: lab, updated: d.updated, kindLabel: KIND_LABEL[kind], ...g }));
  return { rel: `reports/enzy/${kind}/${key}-dashboard-content.html`, md: mdAll };
}

// Kỳ theo lịch (không phải "N ngày gần nhất"): tuần = các khối 1–7, 8–14, 15–21, 22–28, 29–cuối tháng; tháng = tháng dương lịch.
// Lấy kỳ chứa "hôm qua" (ngày trọn vẹn gần nhất) và chỉ tính tới hôm qua nếu kỳ chưa kết thúc (vd. hôm nay 6/10 → tuần 1–5/10, tháng 1–5/10).
// Ngày 1 hàng tháng (hoặc ngày đầu khối) thì hôm qua thuộc kỳ trước nên ra trọn kỳ trước. Ngày: null (dùng "Hôm qua").
// pick = { year, month (1–12), week (1–5, chỉ báo cáo tuần) }: người dùng chọn kỳ cụ thể thay vì kỳ gần nhất; kỳ chưa bắt đầu hoặc không tồn tại thì ném lỗi.
const eom = (y, m) => new Date(y, m + 1, 0).getDate();
const fmtDay = (d) => `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}`;
export function calendarRange(kind, now = new Date(), pick = null) {
  if (kind === 'daily') return null;
  const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (pick) {
    const py = Number(pick.year), pm = Number(pick.month) - 1;
    if (!Number.isInteger(py) || py < 2020 || py > 2100 || !Number.isInteger(pm) || pm < 0 || pm > 11) throw new Error('Tháng hoặc năm không hợp lệ.');
    const last = eom(py, pm);
    let from, end, name;
    if (kind === 'monthly') { from = new Date(py, pm, 1); end = new Date(py, pm, last); name = `tháng ${pm + 1}/${py}`; }
    else {
      const w = Number(pick.week);
      if (!Number.isInteger(w) || w < 1 || w > 5) throw new Error('Tuần phải từ 1 đến 5.');
      const st = WEEK_START_DAYS[w - 1];
      if (st > last) throw new Error(`Tháng ${pm + 1}/${py} chỉ có ${last} ngày nên không có tuần ${w}.`);
      from = new Date(py, pm, st); end = new Date(py, pm, w === 5 ? last : st + 6); name = `tuần ${w} tháng ${pm + 1}/${py}`;
    }
    if (from > y) throw new Error(`Chưa có dữ liệu cho ${name}: kỳ bắt đầu từ ${fmtDay(from)}, dữ liệu chỉ có tới hết hôm qua (${fmtDay(y)}).`);
    return { from, to: end > y ? y : end };
  }
  const yy = y.getFullYear(), mm = y.getMonth(), d = y.getDate();
  if (kind === 'monthly') return { from: new Date(yy, mm, 1), to: y };
  const st = d >= 29 ? 29 : Math.floor((d - 1) / 7) * 7 + 1;
  return { from: new Date(yy, mm, st), to: y };
}
export const WEEK_START_DAYS = [1, 8, 15, 22, 29];

const p2 = (n) => String(n).padStart(2, '0');
const pickLabel = (kind, pick) => (!pick ? '' : kind === 'weekly' ? `tuần ${pick.week} tháng ${pick.month}/${pick.year}` : `tháng ${pick.month}/${pick.year}`);
const dayKey = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
// Ngày cuối kỳ từ "00:00 17/10/2026 đến 23:59 23/10/2026" → 20261023
function periodKey(period) {
  const m = [...String(period).matchAll(/(\d{2})\/(\d{2})\/(\d{4})/g)].at(-1);
  if (m) return `${m[3]}${m[2]}${m[1]}`;
  const y = new Date(Date.now() - 864e5);
  return `${y.getFullYear()}${p2(y.getMonth() + 1)}${p2(y.getDate())}`;
}

function history(kind, before) {
  const dir = path.join(DATA, kind);
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => /^\d{8}\.json$/.test(f) && f.slice(0, 8) < before).sort(); } catch { /* chưa có lịch sử */ }
  return files.slice(-13).map((f) => readJson(path.join(dir, f), null)).filter(Boolean);
}

// Prompt gửi #analyst: dòng đầu chỉ định agent + kỳ báo cáo, phần thân lấy từ file prompt (bỏ dòng "/agent" đầu file nếu có).
function buildTask(cfg, kind, d) {
  let body = '';
  try { body = fs.readFileSync(path.resolve(ROOT, cfg.PROMPT), 'utf8').replace(/^\/\w+[^\n]*\n/, '').trim(); } catch { body = 'Viết báo cáo hiệu quả quảng cáo dựa trên file số liệu đính kèm.'; }
  const title = `[${KIND_TAG[kind]}] ${kindLabel(kind, d.period)} quảng cáo Enzy — ${d.period || RANGE[kind]}`;
  return {
    title,
    task: `/analyst ${title}\nKỲ BÁO CÁO: ${kindLabel(kind, d.period).toUpperCase()} (${d.period || RANGE[kind]}). File số liệu đính kèm do hệ thống tự lấy từ trang báo cáo Enzy lúc ${d.updated || 'vừa xong'}; số liệu, bảng và biểu đồ đã được tính sẵn và sẽ tự đính kèm vào báo cáo — dùng đúng các số này, không tự tính lại hay vẽ lại.${(cfg.KEYWORDS || []).length ? `\nCÓ PHẦN "SO SÁNH HIỆU QUẢ THEO TỪ KHOÁ" (${cfg.KEYWORDS.join(' vs ')}) trong file số liệu: hãy nhận xét ngắn so sánh các từ khoá này (chi tiêu, NS/DT, CPA, CPL, số đơn; từ khoá nào hiệu quả hơn và vì sao) và đề xuất hành động, dùng đúng số trong bảng đó.` : ''}\n\n${body}`,
  };
}

/**
 * deps: { isBusy(), submit(task, uploadRelPaths, opts) → Promise (chạy văn phòng tới khi xong), uploadsDir, log(text) }
 */
export function createEnzy(deps) {
  // Nhật ký chạy báo cáo (hiện ở bảng "Tạo báo cáo"): giữ 200 dòng gần nhất, lưu ra data/enzy/log.json để xem lại sau khi khởi động lại server.
  const LOG_FILE = path.join(DATA, 'log.json');
  let logs = readJson(LOG_FILE, []);
  const note = (text, level = '') => {
    logs.push({ at: Date.now(), text: String(text).slice(0, 500), level });
    if (logs.length > 200) logs = logs.slice(-200);
    try { writeJson(LOG_FILE, logs); } catch { /* chỉ để xem lại */ }
    deps.log(text);
  };
  const setStep = (text) => { if (state.running) { state.running.step = text; note(text); } };
  let state = readJson(STATE, { last: {}, running: null });
  state.running = null;
  // Lịch tự động theo dõi riêng (sched) để chạy báo cáo kỳ cũ do người dùng chọn không làm lỡ lần chạy theo lịch hôm nay.
  state.sched ||= Object.fromEntries(Object.entries(state.last || {}).map(([k, v]) => [k, { ok: v.ok, at: v.at, day: v.day }]));
  const save = () => writeJson(STATE, state);
  const queue = [];
  let working = false;

  // dashOnly: chỉ dựng dashboard (không AI). noDash: chỉ báo cáo, không dựng dashboard. Mặc định: cả hai.
  async function runOnce(kind, reason, dashOnly = false, pick = null, noDash = false) {
    const cfg = loadConfig();
    state.running = { kind, dashOnly, label: pickLabel(kind, pick), step: 'Đang lấy số liệu từ trang báo cáo…', since: Date.now() };
    note(`${dashOnly ? 'Dashboard content' : 'Báo cáo Enzy'} (${KIND_LABEL[kind]}, ${reason}): đang lấy số liệu cho ${cfg.ACCOUNTS.join(', ')}…`);
    // ENZY_FAKE_RAW=<file.json>: dùng dữ liệu thô đã lưu thay cho trang thật (chỉ để thử nghiệm).
    const raw = process.env.ENZY_FAKE_RAW ? { ...readJson(process.env.ENZY_FAKE_RAW, {}), range: RANGE[kind] } : await fetchEnzy({
      url: cfg.URL, user: process.env.ENZY_USER || cfg.USER, pass: process.env.ENZY_PASS || cfg.PASS,
      brand: cfg.BRAND, system: cfg.SYSTEM, store: cfg.STORE, accounts: cfg.ACCOUNTS, range: RANGE[kind], dates: calendarRange(kind, new Date(), pick),
    });
    const d = parseEnzy(raw);
    if (d.totals.spend == null) throw new Error('Không đọc được số liệu tổng từ trang báo cáo (cấu trúc trang có thể đã thay đổi).');
    const key = periodKey(d.period);
    if (raw.adsRows?.length) writeJson(path.join(DATA, kind, `${key}-ads.json`), raw.adsRows);
    if (dashOnly) {
      // Chỉ dựng dashboard (không lưu số liệu kỳ, không giao #analyst, không tốn token AI).
      writeJson(path.join(DATA, kind, `${key}-meta.json`), { period: d.period, updated: d.updated });
      if (!raw.adsRows?.length) throw new Error(`Không tải được file Excel từng quảng cáo${raw.adsError ? ` (${raw.adsError})` : ''}.`);
      if (!(cfg.OWNERS || []).length && !(cfg.KEYWORDS || []).length) throw new Error('Chưa cấu hình người thực hiện hoặc từ khoá (📊 Dữ liệu Enzy).');
      return { key, period: d.period, dashboard: writeOwnerDashboard(cfg, kind, key, d, raw.adsRows).rel };
    }
    const md = buildDataMarkdown(kind, d, history(kind, key));
    writeJson(path.join(DATA, kind, `${key}.json`), snapshot(d));
    fs.writeFileSync(path.join(DATA, kind, `${key}-raw.txt`), raw.code || '');
    let dashboard = '', ownerMd = '';
    try { const w = writeOwnerDashboard(cfg, kind, key, d, raw.adsRows, !noDash); dashboard = w?.rel || ''; ownerMd = w?.md || ''; } catch (e) { note(`Dashboard content theo người thực hiện lỗi: ${e.message}`); }
    // Có cấu hình từ khoá nhưng không dựng được so sánh (thiếu dữ liệu từng quảng cáo): nói rõ ngay trong báo cáo thay vì im lặng.
    if (!ownerMd && (cfg.KEYWORDS || []).length) ownerMd = `## So sánh hiệu quả theo từ khoá (${cfg.KEYWORDS.join(' vs ')})\n\nChưa có so sánh theo từ khoá vì không lấy được dữ liệu từng quảng cáo từ file Excel của trang báo cáo${raw.adsError ? ` (${raw.adsError})` : ''}. Thử chạy lại báo cáo.\n`;
    if (raw.adsError) note(`Không tải được file Excel từng quảng cáo (${raw.adsError}); bỏ qua ${noDash ? 'bảng so sánh' : 'dashboard'} theo người thực hiện.`);
    // Số liệu do code tính nằm ngay trong báo cáo cuối (phụ lục), nên KHÔNG tạo file riêng trong danh sách báo cáo; bản lưu nội bộ ở data/enzy/.
    // Bảng so sánh NGA/TRÂN/nhóm còn lại nằm ngay trong báo cáo (link tương đối khác nhau cho file .md và trang báo cáo tổng hợp).
    const mdFile = md + (ownerMd ? '\n' + ownerMd.replace('{{DASH}}', `${key}-dashboard-content.html`) : '');
    const mdApp = md + (ownerMd ? '\n' + ownerMd.replace('{{DASH}}', `enzy/${kind}/${key}-dashboard-content.html`) : '');
    fs.writeFileSync(path.join(DATA, kind, `${key}-so-lieu.md`), mdApp);
    const upRel = `enzy/${kind}-${key}.md`;
    fs.mkdirSync(path.join(deps.uploadsDir, 'enzy'), { recursive: true });
    fs.writeFileSync(path.join(deps.uploadsDir, upRel), mdFile);

    setStep('Chờ văn phòng rảnh để giao #analyst…');
    for (let i = 0; deps.isBusy() && i < 360; i++) await new Promise((r) => setTimeout(r, 5000));
    if (deps.isBusy()) throw new Error('Văn phòng bận quá 30 phút, chưa giao được việc phân tích.');
    setStep('#analyst đang viết nhận định…');
    const { task, title } = buildTask(cfg, kind, d);
    let fin = null;
    await deps.submit(task, [upRel], { onFinal: (ev) => { fin = ev; }, label: `${title} [📎 số liệu tự động]`, appendix: [{ agent: 'Số liệu Enzy (tự động)', title: `${d.range} · ${d.period}`, status: 'done', text: mdApp }], links: dashboard ? [{ label: '📈 Dashboard content: TRÂN · NGA · người còn lại', href: dashboard }] : [] });
    // Không có báo cáo cuối (vd Quản Lí đang offline): giữ bản số liệu trong danh sách báo cáo để vẫn xem được.
    let data = fin?.file ? `reports/${encodeURIComponent(fin.file)}` : '';
    if (!data) {
      const repDir = path.join(ROOT, 'reports', 'enzy', kind);
      fs.mkdirSync(repDir, { recursive: true });
      fs.writeFileSync(path.join(repDir, `${key}-so-lieu.md`), mdFile);
      data = `reports/enzy/${kind}/${key}-so-lieu.md`;
      note('Không tạo được báo cáo cuối; đã lưu riêng bản số liệu trong danh sách báo cáo.');
    }
    return { key, period: d.period, data, dashboard };
  }

  async function pump() {
    if (working) return;
    working = true;
    while (queue.length) {
      const { kind, reason, dashOnly, pick, noDash } = queue.shift();
      const started = Date.now();
      try {
        const r = await runOnce(kind, reason, dashOnly, pick, noDash);
        if (r.dashboard) { (state.dash ||= {})[kind] = { ok: true, at: started, period: r.period, path: r.dashboard }; }
        if (dashOnly) note(`Dashboard content (${KIND_LABEL[kind]}) xong: kỳ ${r.period}. Dashboard: ${r.dashboard}`, 'ok');
        else {
          state.last[kind] = { ok: true, at: started, day: dayKey(new Date(started)), ...r };
          if (!pick) (state.sched ||= {})[kind] = { ok: true, at: started, day: dayKey(new Date(started)) }; // chạy theo kỳ người chọn không tính vào lịch tự động
          note(`Báo cáo Enzy (${KIND_LABEL[kind]}) xong: kỳ ${r.period}. Báo cáo: ${r.data} · Dashboard: ${r.dashboard || 'không tạo'}`, 'ok');
        }
      } catch (e) {
        if (dashOnly) { (state.dash ||= {})[kind] = { ok: false, at: started, error: e.message }; note(`Dashboard content (${KIND_LABEL[kind]}) lỗi: ${e.message}`, 'err'); }
        else {
          state.last[kind] = { ok: false, at: started, day: dayKey(new Date(started)), error: e.message };
          if (!pick) (state.sched ||= {})[kind] = { ok: false, at: started, day: dayKey(new Date(started)) };
          note(`Báo cáo Enzy (${KIND_LABEL[kind]}) lỗi: ${e.message}`, 'err');
        }
      }
      state.running = null;
      save();
    }
    working = false;
  }

  const enqueue = (kind, reason = 'chạy tay', dashOnly = false, pick = null, noDash = false) => {
    if (!KINDS.includes(kind)) throw new Error('Loại báo cáo phải là daily, weekly hoặc monthly.');
    if (kind === 'daily') pick = null;
    else if (pick) { calendarRange(kind, new Date(), pick); pick = { year: Number(pick.year), month: Number(pick.month), ...(kind === 'weekly' ? { week: Number(pick.week) } : {}) }; } // báo lỗi ngay nếu kỳ không hợp lệ/chưa có dữ liệu
    if ((state.running?.kind === kind && !!state.running.dashOnly === dashOnly) || queue.some((q) => q.kind === kind && !!q.dashOnly === dashOnly)) return false;
    queue.push({ kind, reason, dashOnly, pick, noDash: !dashOnly && noDash });
    pump();
    return true;
  };

  // Lịch: mỗi loại chạy tối đa 1 lần/ngày, khi đã qua giờ hẹn (server bật muộn vẫn chạy bù trong ngày).
  function due(now = new Date()) {
    const s = loadConfig().SCHEDULE;
    if (!s.enabled) return [];
    const hm = `${p2(now.getHours())}:${p2(now.getMinutes())}`, today = dayKey(now);
    // Đã chạy hôm nay: thành công thì thôi, lỗi thì thử lại sau mỗi giờ.
    const ran = (k) => state.sched?.[k]?.day === today && (state.sched[k].ok || Date.now() - state.sched[k].at < 3600e3);
    const out = [];
    if (hm >= s.daily && !ran('daily')) out.push('daily');
    if (WEEK_START_DAYS.includes(now.getDate()) && hm >= s.weekly.time && !ran('weekly')) out.push('weekly');
    if (now.getDate() === s.monthly.day && hm >= s.monthly.time && !ran('monthly')) out.push('monthly');
    return out;
  }
  const timer = setInterval(() => { for (const k of due()) enqueue(k, 'theo lịch'); }, 30000);
  timer.unref?.();
  setTimeout(() => { for (const k of due()) enqueue(k, 'theo lịch'); }, 5000).unref?.();

  function status() {
    const cfg = loadConfig();
    return {
      configured: Boolean((process.env.ENZY_USER || cfg.USER) && (process.env.ENZY_PASS || cfg.PASS)),
      accounts: cfg.ACCOUNTS, owners: cfg.OWNERS, schedule: cfg.SCHEDULE, last: state.last, running: state.running, queued: queue.map((q) => (q.dashOnly ? 'dash-' : '') + q.kind), dash: state.dash || {},
    };
  }

  // Dựng lại dashboard từ dữ liệu từng quảng cáo đã lưu của kỳ gần nhất (vd sau khi đổi danh sách người thực hiện), không cần lấy lại từ trang.
  function rebuildDashboards() {
    const cfg = loadConfig(), out = [];
    for (const kind of KINDS) {
      try {
        const files = fs.readdirSync(path.join(DATA, kind)).filter((f) => /^\d{8}-ads\.json$/.test(f)).sort();
        const key = files.at(-1)?.slice(0, 8);
        if (!key) continue;
        const snap = readJson(path.join(DATA, kind, `${key}.json`), null) || readJson(path.join(DATA, kind, `${key}-meta.json`), {});
        const rel = writeOwnerDashboard(cfg, kind, key, snap, readJson(path.join(DATA, kind, files.at(-1)), []))?.rel;
        if (rel) { out.push(rel); if (state.last[kind]) state.last[kind].dashboard = rel; (state.dash ||= {})[kind] = { ok: true, at: Date.now(), period: snap.period, path: rel }; }
      } catch { /* chưa có dữ liệu cho loại báo cáo này */ }
    }
    save();
    return out;
  }

  // Trạng thái đầy đủ cho bảng "Tạo báo cáo" (kèm nhật ký); /poll chỉ dùng status() cho nhẹ.
  const statusFull = () => ({ ...status(), now: Date.now(), log: logs.slice(-200) });

  return { enqueue, status, statusFull, due, rebuildDashboards };
}
