import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchEnzy } from './fetch.js';
import { parseEnzy, buildDataMarkdown, snapshot } from './metrics.js';

// Báo cáo quảng cáo Enzy tự động: lấy số liệu từ trang Streamlit → tính chỉ số, bảng, biểu đồ → giao #analyst viết nhận định.
// Cấu hình ở enzy.json (quyền 600, chứa tài khoản đăng nhập trang báo cáo; agent không được đọc/ghi file này).
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CONFIG_FILE = path.join(ROOT, 'enzy.json');
const DATA = path.join(ROOT, 'data', 'enzy');
const STATE = path.join(DATA, 'state.json');
export const KINDS = ['daily', 'weekly', 'monthly'];
const KIND_LABEL = { daily: 'Báo cáo ngày', weekly: 'Báo cáo tuần', monthly: 'Báo cáo tháng' };
const RANGE = { daily: 'Hôm qua (trọn ngày)', weekly: '7 ngày gần nhất (không gồm hôm nay)', monthly: '30 ngày gần nhất (không gồm hôm nay)' };

const DEFAULTS = {
  URL: 'https://enzyfood.streamlit.app/~/+/',
  USER: '', PASS: '',
  BRAND: 'Enzy', SYSTEM: 'Facebook Ads', STORE: 'HNC Vietnam',
  ACCOUNTS: ['Enzy 1', 'Enzy 2', 'Enzy 5', 'Enzy 6', 'Enzy 8'],
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

const p2 = (n) => String(n).padStart(2, '0');
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
  const title = `${KIND_LABEL[kind]} quảng cáo Enzy — ${d.period || RANGE[kind]}`;
  return {
    title,
    task: `/analyst ${title}\nKỲ BÁO CÁO: ${KIND_LABEL[kind].toUpperCase()} (${RANGE[kind]}). File số liệu đính kèm do hệ thống tự lấy từ trang báo cáo Enzy lúc ${d.updated || 'vừa xong'}; số liệu, bảng và biểu đồ đã được tính sẵn và sẽ tự đính kèm vào báo cáo — dùng đúng các số này, không tự tính lại hay vẽ lại.\n\n${body}`,
  };
}

/**
 * deps: { isBusy(), submit(task, uploadRelPaths, opts) → Promise (chạy văn phòng tới khi xong), uploadsDir, log(text) }
 */
export function createEnzy(deps) {
  let state = readJson(STATE, { last: {}, running: null });
  state.running = null;
  const save = () => writeJson(STATE, state);
  const queue = [];
  let working = false;

  async function runOnce(kind, reason) {
    const cfg = loadConfig();
    state.running = { kind, step: 'Đang lấy số liệu từ trang báo cáo…', since: Date.now() };
    deps.log(`Báo cáo Enzy (${KIND_LABEL[kind]}, ${reason}): đang lấy số liệu cho ${cfg.ACCOUNTS.join(', ')}…`);
    // ENZY_FAKE_RAW=<file.json>: dùng dữ liệu thô đã lưu thay cho trang thật (chỉ để thử nghiệm).
    const raw = process.env.ENZY_FAKE_RAW ? { ...readJson(process.env.ENZY_FAKE_RAW, {}), range: RANGE[kind] } : await fetchEnzy({
      url: cfg.URL, user: process.env.ENZY_USER || cfg.USER, pass: process.env.ENZY_PASS || cfg.PASS,
      brand: cfg.BRAND, system: cfg.SYSTEM, store: cfg.STORE, accounts: cfg.ACCOUNTS, range: RANGE[kind],
    });
    const d = parseEnzy(raw);
    if (d.totals.spend == null) throw new Error('Không đọc được số liệu tổng từ trang báo cáo (cấu trúc trang có thể đã thay đổi).');
    const key = periodKey(d.period);
    const md = buildDataMarkdown(kind, d, history(kind, key));
    writeJson(path.join(DATA, kind, `${key}.json`), snapshot(d));
    fs.writeFileSync(path.join(DATA, kind, `${key}-raw.txt`), raw.code || '');
    // Bản số liệu xem được ngay trên trang Báo cáo, kể cả khi bước AI lỗi.
    const repDir = path.join(ROOT, 'reports', 'enzy', kind);
    fs.mkdirSync(repDir, { recursive: true });
    fs.writeFileSync(path.join(repDir, `${key}-so-lieu.md`), md);
    const upRel = `enzy/${kind}-${key}.md`;
    fs.mkdirSync(path.join(deps.uploadsDir, 'enzy'), { recursive: true });
    fs.writeFileSync(path.join(deps.uploadsDir, upRel), md);

    state.running.step = 'Chờ văn phòng rảnh để giao #analyst…';
    for (let i = 0; deps.isBusy() && i < 360; i++) await new Promise((r) => setTimeout(r, 5000));
    if (deps.isBusy()) throw new Error('Văn phòng bận quá 30 phút, chưa giao được việc phân tích.');
    state.running.step = '#analyst đang viết nhận định…';
    const { task, title } = buildTask(cfg, kind, d);
    await deps.submit(task, [upRel], { label: `${title} [📎 số liệu tự động]`, appendix: [{ agent: 'Số liệu Enzy (tự động)', title: `${d.range} · ${d.period}`, status: 'done', text: md }] });
    return { key, period: d.period, data: `reports/enzy/${kind}/${key}-so-lieu.md` };
  }

  async function pump() {
    if (working) return;
    working = true;
    while (queue.length) {
      const { kind, reason } = queue.shift();
      const started = Date.now();
      try {
        const r = await runOnce(kind, reason);
        state.last[kind] = { ok: true, at: started, day: dayKey(new Date(started)), ...r };
        deps.log(`Báo cáo Enzy (${KIND_LABEL[kind]}) xong: kỳ ${r.period}. Số liệu: ${r.data}`);
      } catch (e) {
        state.last[kind] = { ok: false, at: started, day: dayKey(new Date(started)), error: e.message };
        deps.log(`Báo cáo Enzy (${KIND_LABEL[kind]}) lỗi: ${e.message}`);
      }
      state.running = null;
      save();
    }
    working = false;
  }

  const enqueue = (kind, reason = 'chạy tay') => {
    if (!KINDS.includes(kind)) throw new Error('Loại báo cáo phải là daily, weekly hoặc monthly.');
    if (state.running?.kind === kind || queue.some((q) => q.kind === kind)) return false;
    queue.push({ kind, reason });
    pump();
    return true;
  };

  // Lịch: mỗi loại chạy tối đa 1 lần/ngày, khi đã qua giờ hẹn (server bật muộn vẫn chạy bù trong ngày).
  function due(now = new Date()) {
    const s = loadConfig().SCHEDULE;
    if (!s.enabled) return [];
    const hm = `${p2(now.getHours())}:${p2(now.getMinutes())}`, today = dayKey(now);
    // Đã chạy hôm nay: thành công thì thôi, lỗi thì thử lại sau mỗi giờ.
    const ran = (k) => state.last[k]?.day === today && (state.last[k].ok || Date.now() - state.last[k].at < 3600e3);
    const out = [];
    if (hm >= s.daily && !ran('daily')) out.push('daily');
    if (now.getDay() === s.weekly.day && hm >= s.weekly.time && !ran('weekly')) out.push('weekly');
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
      accounts: cfg.ACCOUNTS, schedule: cfg.SCHEDULE, last: state.last, running: state.running, queued: queue.map((q) => q.kind),
    };
  }

  return { enqueue, status, due };
}
