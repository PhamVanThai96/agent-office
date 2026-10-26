import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, CONFIG_FILE } from '../enzy/index.js';
import { scrapeVoc, parseVoc } from './voc.js';
import { distill } from './distill.js';
import { fetchVocExcel, readVocWorkbook, vocToYaml, saveVocYaml, VOC_DIR } from './excel.js';
import * as S from './store.js';

// Ý kiến khách hàng: cào TUẦN TỰ từng khoảng ≤ 7 ngày (không chồng nhau) → chưng cất → hợp nhất vào kho insight (insight/store.js).
// Dùng 3 cách: nút "Cào 7 ngày kế tiếp" (lấp khoảng cũ nhất chưa cào), "Cào bù tới hôm qua", và tự cập nhật các ngày mới nhất khi CEO nhờ lên idea (ensureFresh).
const DEFAULT_BACKFILL_DAYS = 28;
const CATCHUP_MAX = 8;

const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };

export function insightConfig() {
  const c = loadConfig(), i = c.INSIGHT || {};
  const n = Math.round(Number(i.AUTO_WINDOWS));
  return {
    START: /^\d{4}-\d{2}-\d{2}$/.test(i.START || '') ? i.START : '',
    SYSTEM: String(i.SYSTEM || 'Ý kiến khách hàng'),
    AUTO_WINDOWS: Number.isFinite(n) ? Math.min(Math.max(n, 0), 4) : 2,
    creds: { user: process.env.ENZY_USER || c.USER, pass: process.env.ENZY_PASS || c.PASS }, c,
  };
}

// Ngày bắt đầu cào (YYYY-MM-DD, không muộn hơn hôm qua). Chỉ ghi INSIGHT.START, không đụng các trường khác của enzy.json.
export function saveInsightStart(start) {
  const s = String(start || '').trim();
  if (s && !/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error('Ngày bắt đầu phải có dạng YYYY-MM-DD.');
  if (s && (!S.parseIso(s) || s > S.yesterday())) throw new Error('Ngày bắt đầu không được muộn hơn hôm qua.');
  if (s && s < '2020-01-01') throw new Error('Ngày bắt đầu quá xa.');
  const raw = readJson(CONFIG_FILE, {});
  raw.INSIGHT = { ...(raw.INSIGHT || {}), START: s };
  const t = CONFIG_FILE + '.tmp';
  fs.writeFileSync(t, JSON.stringify(raw, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(t, CONFIG_FILE);
}

export function createInsight({ log = () => {}, wrap = (label, fn) => fn() } = {}) {
  let running = null;
  let ctl = null;          // điều khiển lượt cào hiện tại: { stopped, browser }
  let stopReq = false;     // bấm Dừng khi lượt cào còn đang xếp hàng
  const runLog = [];       // nhật ký lượt cào hiện tại/gần nhất; được xoá khi bắt đầu lượt mới
  const rl = (text, level = '') => { runLog.push({ at: Date.now(), text: String(text).slice(0, 400), level }); if (runLog.length > 80) runLog.splice(0, runLog.length - 80); };
  let chain = Promise.resolve();
  const exclusive = (fn) => { const p = chain.then(fn); chain = p.catch(() => {}); return p; };

  // Dữ liệu của một khoảng: thật (Chrome) hoặc giả lập khi thử (INSIGHT_FAKE_DIR/<từ-ngày>.txt hoặc default.txt).
  async function fetchWindow(cfg, win, c) {
    const dir = process.env.INSIGHT_FAKE_DIR;
    if (dir) {
      // INSIGHT_FAKE_DELAY_MS: giả lập trang chậm để thử nút Dừng.
      for (let t = 0; t < (Number(process.env.INSIGHT_FAKE_DELAY_MS) || 0) && !c.stopped; t += 100) await new Promise((r) => setTimeout(r, 100));
      const f = [path.join(dir, `${win.from}.txt`), path.join(dir, 'default.txt')].find((x) => fs.existsSync(x));
      const code = f ? fs.readFileSync(f, 'utf8') : '';
      return { code, found: parseVoc(code).length, scanned: NaN, alerts: [] };
    }
    const { user, pass } = cfg.creds;
    if (!user || !pass) throw new Error('Chưa có tài khoản đăng nhập trang Enzy (điền USER/PASS ở 📊 Dữ liệu Enzy).');
    return scrapeVoc({ url: cfg.c.URL, user, pass, brand: cfg.c.BRAND, system: cfg.SYSTEM, from: win.from, to: win.to, ctl: c });
  }

  function planWindows(mode, cfg, ledger, max) {
    const yest = S.yesterday();
    if (!ledger.start) ledger.start = cfg.START || S.addDays(yest, -(DEFAULT_BACKFILL_DAYS - 1));
    if (cfg.START) ledger.start = cfg.START;
    let from = ledger.start, limit = 1;
    if (mode === 'catchup') limit = CATCHUP_MAX;
    if (mode === 'fresh') { limit = Math.max(1, max || cfg.AUTO_WINDOWS || 1); const h = S.addDays(yest, -(S.WINDOW_DAYS * limit) + 1); from = h > from ? h : from; }
    return S.nextWindows(ledger, from, yest, limit);
  }

  async function doRun(mode, { max, onProgress } = {}) {
    runLog.length = 0; // xoá nhật ký cũ trước khi bắt đầu lượt mới
    ctl = { stopped: stopReq, browser: null };
    stopReq = false;
    const cfg = insightConfig();
    const ledger = S.loadLedger();
    const wins = planWindows(mode, cfg, ledger, max);
    if (ledger.lastError) { ledger.lastError = ''; S.saveLedger(ledger); } // lỗi cũ không còn hiển thị khi đã bắt đầu lượt mới
    if (!wins.length) { running = null; ctl = null; rl('Đã cập nhật tới hôm qua, không có khoảng nào cần cào.', 'ok'); return { ok: true, windows: 0, customers: 0, note: 'Đã cập nhật tới hôm qua.' }; }
    const done = { ok: true, windows: 0, customers: 0, newCustomers: 0, themes: 0, via: '', notes: [] };
    rl(`Bắt đầu cào ${wins.length} khoảng: ${wins.map((w) => `${S.vn(w.from)}–${S.vn(w.to)}`).join(', ')}.`);
    for (const [i, win] of wins.entries()) {
      const label = `${S.vn(win.from)}–${S.vn(win.to)}`;
      if (ctl.stopped) { done.stopped = true; break; }
      running = { mode, step: `Đang cào ý kiến khách hàng ${label} (${i + 1}/${wins.length})…`, since: Date.now(), window: win };
      rl(running.step);
      onProgress?.(running.step);
      try {
        const res = await fetchWindow(cfg, win, ctl);
        if (ctl.stopped) { done.stopped = true; break; }
        const entries = parseVoc(res.code);
        rl(`Trang trả về ${entries.length} khách cho ${label}.`);
        if (!entries.length && Number.isNaN(res.found) && !(res.alerts || []).some((a) => /không\s+(tìm thấy|có)/i.test(a))) {
          throw new Error(`Trang không trả kết quả cho ${label}${res.alerts?.length ? ` (${res.alerts.join(' | ').slice(0, 200)})` : ''}.`);
        }
        running = { ...running, step: `Đang chắt lọc ${entries.length} khách ${label}…` };
        rl(running.step);
        onProgress?.(running.step);
        const seen = S.loadSeen();
        const fresh = entries.map((e) => ({ ...e, lines: e.lines.filter((l) => !seen.has(S.lineHash(e.id, l))) })).filter((e) => e.lines.length);
        const kb = S.loadKb();
        const d = await distill(fresh, win, Object.values(kb.themes).map(({ id, label: lb, type }) => ({ id, label: lb, type })));
        if (ctl.stopped) { done.stopped = true; break; } // khoảng đang dở chưa ghi vào kho nên không để lại dữ liệu nửa chừng
        const m = S.mergeObservations(kb, win, d.observations, d.vocab, d.summary);
        for (const e of fresh) for (const l of e.lines) seen.add(S.lineHash(e.id, l));
        fs.mkdirSync(S.RAW_DIR, { recursive: true });
        fs.writeFileSync(path.join(S.RAW_DIR, `${win.from}_${win.to}.json`), JSON.stringify({ from: win.from, to: win.to, at: new Date().toISOString(), entries: entries.map(({ id, cust, channel, lines }) => ({ id, cust, channel, lines })) }));
        S.saveKb(kb); S.saveSeen(seen);
        S.recordWindow(ledger, { ...win, at: new Date().toISOString(), status: 'ok', customers: entries.length, newCustomers: fresh.length, lines: entries.reduce((s, e) => s + e.lines.length, 0), newLines: fresh.reduce((s, e) => s + e.lines.length, 0), themes: m.merged, via: d.via });
        ledger.lastError = '';
        S.saveLedger(ledger);
        rl(`Xong ${label}: ${entries.length} khách (${fresh.length} có tin mới), ${m.merged} chủ đề cập nhật${d.via === 'rule' ? ' (bộ quy tắc từ khoá)' : ''}.`, 'ok');
        done.windows++; done.customers += entries.length; done.newCustomers += fresh.length; done.themes += m.merged; done.via = d.via;
        if (d.note) done.notes.push(d.note);
      } catch (e) {
        if (ctl.stopped) { done.stopped = true; break; } // lỗi do đóng trình duyệt khi bấm Dừng, không phải lỗi thật
        ledger.lastError = `${label}: ${e.message}`;
        S.saveLedger(ledger);
        rl(`Lỗi ${label}: ${e.message}`, 'err');
        done.ok = false; done.error = ledger.lastError;
        break; // dừng ở khoảng lỗi để không để lại khoảng trống giữa các khoảng đã cào
      }
    }
    if (done.stopped) { done.ok = false; done.error = 'Đã dừng theo yêu cầu'; rl(`Đã dừng theo yêu cầu${done.windows ? `; ${done.windows} khoảng đã xong trước đó vẫn được giữ` : ''}.`, 'warn'); }
    running = null; ctl = null;
    const kb = S.loadKb(), l2 = S.loadLedger();
    S.writeDigest(kb, l2);
    l2.lastRun = { at: new Date().toISOString(), mode, windows: done.windows, customers: done.customers, newCustomers: done.newCustomers, ok: done.ok, stopped: done.stopped || undefined };
    S.saveLedger(l2);
    return done;
  }

  function status() {
    const cfg = insightConfig(), ledger = S.loadLedger(), kb = S.kbInfo(), yest = S.yesterday();
    const start = cfg.START || ledger.start || S.addDays(yest, -(DEFAULT_BACKFILL_DAYS - 1));
    const wins = S.nextWindows(ledger, start, yest, 400);
    const behind = wins.reduce((s, w) => s + S.dayDiff(w.from, w.to) + 1, 0);
    return {
      configured: Boolean(cfg.creds.user && cfg.creds.pass) || Boolean(process.env.INSIGHT_FAKE_DIR),
      start, coverage: S.coverage(ledger), next: wins[0] || null, behindDays: behind, themes: kb.themes, updated: kb.updated,
      running, log: runLog.slice(-14), lastError: ledger.lastError || '', lastRun: ledger.lastRun || null, autoWindows: cfg.AUTO_WINDOWS,
      digest: fs.existsSync(S.DIGEST_FILE) ? 'reports/insight/digest.md' : '',
      excel: fs.existsSync(path.join(VOC_DIR, 'latest.yaml')) ? (fs.readFileSync(path.join(VOC_DIR, 'latest.yaml'), 'utf8').match(/^tu_ngay: (\S+)\nden_ngay: (\S+)/m) || []).slice(1).join(' → ') || 'có' : '',
    };
  }

  // Bấm nút trên giao diện: chạy nền, trả false nếu đang cào.
  function start(mode) {
    if (!['next', 'catchup'].includes(mode)) throw new Error('mode phải là next hoặc catchup.');
    if (running) return false;
    runLog.length = 0; // xoá nhật ký cũ ngay khi bấm cào (trước cả khi lượt cào bắt đầu)
    running = { mode, step: 'Đang chuẩn bị…', since: Date.now() };
    exclusive(() => wrap('Cào ý kiến khách hàng', () => doRun(mode, { onProgress: (t) => log(t) })))
      .then((r) => log(r.stopped ? `Ý kiến khách hàng: đã dừng${r.windows ? `, ${r.windows} khoảng đã xong vẫn được giữ` : ''}.` : r.ok ? (r.windows ? `Ý kiến khách hàng: đã chắt lọc ${r.windows} khoảng, ${r.newCustomers}/${r.customers} khách mới, ${r.themes} chủ đề cập nhật.` : r.note) : `Ý kiến khách hàng lỗi: ${r.error}`))
      .catch((e) => { running = null; ctl = null; log(`Ý kiến khách hàng lỗi: ${e.message}`); });
    return true;
  }

  /** Lấy Excel "Tải Excel đầy đủ" cho một khoảng ngày bất kỳ → lưu YAML ẩn danh (data/insight/voc/). Chạy nền; false nếu đang bận. */
  function startExcel({ from, to, mode = 'saved' } = {}) {
    if (!S.parseIso(from) || !S.parseIso(to) || from > to) throw new Error('Khoảng ngày không hợp lệ (cần dạng YYYY-MM-DD, từ ≤ đến).');
    if (to > S.yesterday()) throw new Error('Ngày kết thúc không được muộn hơn hôm qua.');
    if (!['saved', 'scan'].includes(mode)) throw new Error('mode phải là saved hoặc scan.');
    if (mode === 'scan' && S.dayDiff(from, to) + 1 > S.WINDOW_DAYS) throw new Error(`Quét mới từ Pancake chỉ tối đa ${S.WINDOW_DAYS} ngày.`);
    if (running) return false;
    runLog.length = 0;
    running = { mode: 'excel', step: 'Đang chuẩn bị…', since: Date.now() };
    ctl = { stopped: stopReq, browser: null }; stopReq = false;
    const label = `${S.vn(from)}–${S.vn(to)}`;
    exclusive(() => wrap('Lấy Excel ý kiến khách hàng', async () => {
      try {
        const cfg = insightConfig();
        if (!cfg.creds.user || !cfg.creds.pass) throw new Error('Chưa có tài khoản đăng nhập trang Enzy (điền USER/PASS ở 📊 Dữ liệu Enzy).');
        running = { ...running, step: `Đang tải Excel ý kiến khách hàng ${label} (${mode === 'scan' ? 'quét mới' : 'dữ liệu đã lưu'})…` };
        rl(running.step); log(running.step);
        const res = await fetchVocExcel({ url: cfg.c.URL, user: cfg.creds.user, pass: cfg.creds.pass, brand: cfg.c.BRAND, system: cfg.SYSTEM, from, to, mode, ctl });
        const w = readVocWorkbook(res.buf);
        const y = vocToYaml({ rows: w.rows, from, to, mode, metrics: { ...res.metrics, ...w.info } });
        const file = saveVocYaml(y);
        rl(`Xong ${label}: ${y.items} ý kiến → ${path.relative(S.DIR, file)} (cũng lưu latest.yaml).`, 'ok');
        log(`Ý kiến khách hàng: đã lưu ${y.items} ý kiến (${label}) dạng YAML: data/insight/voc/latest.yaml`);
      } catch (e) {
        rl(ctl?.stopped ? 'Đã dừng theo yêu cầu.' : `Lỗi ${label}: ${e.message}`, ctl?.stopped ? 'warn' : 'err');
        log(`Ý kiến khách hàng (Excel) lỗi: ${ctl?.stopped ? 'đã dừng' : e.message}`);
      } finally { running = null; ctl = null; }
    }));
    return true;
  }

  /** Nút Dừng: đóng trình duyệt đang cào; khoảng đang dở bị bỏ, các khoảng đã xong trước đó vẫn được giữ. */
  function stop() {
    if (!running || running.stopping) return Boolean(running);
    running = { ...running, step: 'Đang dừng…', stopping: true };
    rl('Đã nhận yêu cầu dừng, đang đóng trình duyệt…', 'warn');
    if (ctl) { ctl.stopped = true; ctl.browser?.close().catch(() => {}); } else stopReq = true;
    return true;
  }

  /** Khi CEO nhờ lên idea: cập nhật các ngày mới nhất (tối đa `max` khoảng) rồi dùng kho. Không bao giờ ném lỗi. */
  async function ensureFresh({ max, onProgress } = {}) {
    try {
      const cfg = insightConfig();
      const n = max ?? cfg.AUTO_WINDOWS;
      if (!n) return { ok: true, windows: 0, note: 'Tự cập nhật đang tắt.' };
      return await exclusive(() => doRun('fresh', { max: n, onProgress }));
    } catch (e) {
      running = null; ctl = null;
      return { ok: false, windows: 0, error: e.message };
    }
  }

  /** Khối văn bản cho agent: bản tóm tắt kho + cảnh báo nếu dữ liệu cũ/không cập nhật được. */
  function context(extraNote = '') {
    const kb = S.loadKb(), ledger = S.loadLedger();
    const text = S.digestText(kb, ledger);
    const cov = S.coverage(ledger);
    const stale = cov ? S.dayDiff(cov.to, S.yesterday()) : null;
    if (!text) return `\n\n--- Insight khách hàng ---\nCHƯA CÓ dữ liệu ý kiến khách hàng đã chắt lọc${extraNote ? ` (${extraNote})` : ''}. Nói rõ điều này với CEO; TUYỆT ĐỐI không bịa insight hay trích dẫn khách.\n--- Hết ---\n`;
    const warn = stale > 7 ? `\nLƯU Ý: dữ liệu mới nhất chỉ tới ${S.vnFull(cov.to)} (cách hôm qua ${stale} ngày)${extraNote ? `; ${extraNote}` : ''}. Nêu rõ giới hạn này.` : extraNote ? `\nLƯU Ý: ${extraNote}` : '';
    const xl = fs.existsSync(path.join(VOC_DIR, 'latest.yaml')) ? '\nÝ kiến gốc từng dòng (ẩn danh, từ file Excel): data/insight/voc/latest.yaml — chỉ đọc (read_file) khi cần trích dẫn/ví dụ cụ thể.' : '';
    return `\n\n--- Insight khách hàng (từ ý kiến thật, đã chắt lọc) ---\n${text}${warn}${xl}\n--- Hết ---\n`;
  }

  const search = (query, limit) => S.searchKb(S.loadKb(), S.loadLedger(), query, limit);

  return { status, start, startExcel, stop, ensureFresh, context, search, running: () => running };
}
