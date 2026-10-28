import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { digestText, loadArticles, loadConfig as loadKnCfg, saveConfig as saveKnCfg } from '../knowledge/store.js';
import { insightConfig, saveInsightStart } from '../insight/index.js';
import { loadKb, TYPE_LABEL, STAGE_LABEL, parseIso, yesterday, vn } from '../insight/store.js';

// "Quét Trend & Tạo Idea": mỗi ngày gom số liệu từ nhiều nguồn (ý kiến khách hàng Enzy, Brands Vietnam 3 ngày gần nhất), nguồn nào lỗi/timeout thì BỎ QUA và làm tiếp nguồn khác,
// rồi giao cho team viết báo cáo trend + idea mới trong ngày. Kho idea đã đề xuất (data/daily/ideas.json) được đưa vào prompt để không lặp lại qua nhiều ngày.
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'data', 'daily');
const HISTORY = path.join(DIR, 'ideas.json');
const STATE = path.join(DIR, 'state.json');
const SOURCE_TIMEOUT = { voc: 15 * 60 * 1000, brands: 20 * 60 * 1000 };
const KEEP_DAYS = 45;
const SCAN = path.join(DIR, 'scan.json');
const DEFAULT_SCAN = { voc: true, brands: true, campaign: true, library: true, from: '', to: '', savedAt: '' };

const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const writeJson = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f + '.tmp', JSON.stringify(o, null, 1)); fs.renameSync(f + '.tmp', f); };
const today = () => new Date().toISOString().slice(0, 10);
const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const tokens = (s) => new Set(norm(s).split(' ').filter((w) => w.length > 2));
const similar = (a, b) => { const x = tokens(a), y = tokens(b); if (!x.size || !y.size) return false; let n = 0; for (const w of x) if (y.has(w)) n++; return n / Math.min(x.size, y.size) >= 0.7; };

// Cấu hình quét (người dùng chọn nguồn + loại bài + khoảng ngày; lưu cần mật khẩu Admin, xem server.js/adminauth.js).
export const loadScan = () => ({ ...DEFAULT_SCAN, ...readJson(SCAN, {}) });
export function validateScan(c) {
  const o = { voc: c.voc === true, brands: c.brands === true, campaign: c.campaign === true, library: c.library === true, from: String(c.from || ''), to: String(c.to || '') };
  if (!o.voc && !o.brands) throw new Error('Chọn ít nhất một nguồn: Ý kiến khách hàng hoặc Brands Vietnam.');
  if (o.brands && !o.campaign && !o.library) throw new Error('Brands Vietnam: chọn Campaign, Library hoặc cả hai.');
  if (!o.brands) { o.campaign = false; o.library = false; }
  if (o.voc) {
    if (!parseIso(o.from) || !parseIso(o.to)) throw new Error('Ý kiến khách hàng: chọn khoảng ngày (từ – đến).');
    if (o.from > o.to) throw new Error('Ngày bắt đầu không được sau ngày kết thúc.');
    if (o.to > yesterday()) throw new Error('Ngày kết thúc không được muộn hơn hôm qua.');
    if (o.from < '2020-01-01') throw new Error('Ngày bắt đầu quá xa.');
  } else { o.from = ''; o.to = ''; }
  return o;
}
export function saveScan(c) { const o = { ...validateScan(c), savedAt: new Date().toISOString() }; writeJson(SCAN, o); return o; }

// Một chỗ cấu hình duy nhất: chọn nguồn + số bài mỗi lượt + tự quét hằng ngày (Brands Vietnam) + mốc ngày bắt đầu cào (Ý kiến khách hàng).
// Phần số bài/tự quét ghi vào cấu hình của kho kiến thức, mốc ngày ghi vào enzy.json (INSIGHT.START) — nơi các module đó vẫn đọc.
export function loadScanAll() {
  const k = loadKnCfg();
  return { ...loadScan(), perRun: k.perRun, autoEnabled: k.enabled, autoTime: k.time, vocStart: insightConfig().START };
}
export function saveScanAll(b) {
  const o = validateScan(b);
  const perRun = Number(b.perRun);
  if (!Number.isInteger(perRun) || perRun < 1 || perRun > 30) throw new Error('Số bài mới mỗi lượt phải từ 1 đến 30.');
  const time = String(b.autoTime || '');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('Giờ tự quét phải có dạng HH:MM.');
  if (o.voc) saveInsightStart(String(b.vocStart || ''));   // tự kiểm tra và ném lỗi TRƯỚC khi ghi bất kỳ thứ gì
  saveKnCfg({ enabled: b.autoEnabled === true, time, perRun });
  saveScan(b);
  return loadScanAll();
}
const brandsSource = (c) => (c.campaign && c.library ? 'all' : c.campaign ? 'campaign' : 'library');

export const loadHistory = () => readJson(HISTORY, { ideas: [] }).ideas;

const HEAD = /^\s{0,3}(?:#{1,6}\s*)?(?:\*\*)?\s*(?:IDEA|Ý\s*tưởng)\s*\d+\s*[:.\-–—)]\s*(.+?)\s*(?:\*\*)?\s*$/iu;
const STATUSES = ['moi', 'se-lam', 'da-dung', 'bo'];

/** Lấy từng idea từ báo cáo: dòng tiêu đề "IDEA n: tên" + phần nội dung bên dưới (insight, hook, CTA) tới tiêu đề kế tiếp. */
export function extractIdeas(text) {
  const out = [];
  let cur = null;
  for (const line of String(text || '').split('\n')) {
    const m = line.match(HEAD);
    if (m && m[1].replace(/\*+/g, '').trim().length > 4) { cur = { title: m[1].replace(/\*+/g, '').trim().slice(0, 160), lines: [] }; out.push(cur); continue; }
    if (cur && (/^\s{0,3}#{1,3}\s/.test(line) || /^\s*---+\s*$/.test(line))) { cur = null; continue; }
    if (cur && line.trim()) cur.lines.push(line.trim());
  }
  const seen = new Set();
  return out.filter((i) => !seen.has(i.title) && seen.add(i.title)).map((i) => ({ title: i.title, detail: i.lines.join('\n').slice(0, 900) }));
}

export function recordIdeas(ideas, report) {
  const cutoff = new Date(Date.now() - KEEP_DAYS * 864e5).toISOString().slice(0, 10);
  const all = loadHistory().filter((i) => i.day >= cutoff || i.status === 'se-lam' || i.status === 'da-dung');
  let added = 0;
  for (const it of ideas) {
    const idea = typeof it === 'string' ? { title: it, detail: '' } : it;
    if (all.some((i) => i.day === today() && similar(i.title, idea.title))) continue;
    all.push({ id: `${Date.now().toString(36)}${added}`, day: today(), title: idea.title, detail: idea.detail || '', report: report || '', status: 'moi', note: '' });
    added++;
  }
  writeJson(HISTORY, { ideas: all });
  return added;
}

export function updateIdea(id, { status, note, delete: del } = {}) {
  const all = loadHistory(), i = all.findIndex((x) => x.id === id);
  if (i < 0) throw new Error('Không thấy idea này.');
  if (del) all.splice(i, 1);
  else {
    if (status !== undefined) { if (!STATUSES.includes(status)) throw new Error('Trạng thái không hợp lệ.'); all[i].status = status; }
    if (note !== undefined) all[i].note = String(note).slice(0, 500);
  }
  writeJson(HISTORY, { ideas: all });
}

const withTimeout = (p, ms, onTimeout) => new Promise((resolve, reject) => {
  const t = setTimeout(() => { try { onTimeout?.(); } catch { /* bỏ qua */ } reject(new Error(`Quá thời gian chờ (${Math.round(ms / 60000)} phút)`)); }, ms);
  p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
});

export function createDaily({ insight, knowledge, submit, isBusy, uploadsDir, log = () => {} }) {
  let running = null, stopReq = false;
  const state = readJson(STATE, { last: null });
  const runLog = [];
  const rl = (text, level = '') => { runLog.push({ at: Date.now(), text: String(text).slice(0, 400), level }); if (runLog.length > 80) runLog.splice(0, runLog.length - 80); };

  async function step(id, label, fn, results) {
    if (stopReq) { results.push({ id, label, status: 'skipped', note: 'Đã dừng' }); return; }
    running = { ...running, step: `${label}…` }; rl(`${label}…`);
    try {
      const r = await fn();
      results.push({ id, label, ...r });
      rl(`${label}: ${r.status === 'ok' ? 'xong' : 'bỏ qua'} — ${r.note}`, r.status === 'ok' ? 'ok' : 'warn');
    } catch (e) {
      results.push({ id, label, status: 'error', note: e.message });
      rl(`${label}: lỗi, bỏ qua (${e.message})`, 'err');
    }
  }

  async function doRun() {
    runLog.length = 0; stopReq = false;
    const results = [], cfg = loadScan();
    await step('voc', 'Ý kiến khách hàng (Enzy)', () => !cfg.voc ? { status: 'skipped', note: 'đang tắt trong cấu hình quét' } : withTimeout((async () => {
      const r = await insight.ensureFresh({ onProgress: (t) => rl(t) });
      if (!r.ok) return { status: 'error', note: `${String(r.error || 'không rõ').slice(0, 160)}; dùng dữ liệu đã lưu` };
      return { status: 'ok', note: r.windows ? `chắt lọc thêm ${r.windows} khoảng, ${r.newCustomers} khách mới` : 'đã cập nhật tới hôm qua' };
    })(), SOURCE_TIMEOUT.voc, () => insight.stop()), results);
    await step('brands', 'Brands Vietnam (3 ngày gần nhất)', async () => {
      if (!cfg.brands) return { status: 'skipped', note: 'đang tắt trong cấu hình quét' };
      const p = knowledge.runNow({ source: brandsSource(cfg), recentDays: 3 });
      if (!p) return { status: 'error', note: 'đang có lượt quét Brands Vietnam khác' };
      const r = await withTimeout(p, SOURCE_TIMEOUT.brands, () => knowledge.stop());
      if (r.stopped) return { status: 'error', note: 'đã dừng' };
      if (!r.ok) return { status: 'error', note: `${String(r.error || '').slice(0, 200)}; dùng kho đã lưu` };
      return { status: 'ok', note: r.added ? `${r.added} bài mới trong 3 ngày` : 'không có bài mới trong 3 ngày' };
    }, results);
    return results;
  }

  function buildBrief(results) {
    const hist = loadHistory().slice(-70);
    const usable = results.some((r) => r.status === 'ok');
    const lines = [
      `# Dữ liệu cho báo cáo trend & idea ngày ${today()}`, '',
      '## Tình trạng các nguồn (nguồn lỗi đã được bỏ qua)',
      ...results.map((r) => `- ${r.label}: ${r.status === 'ok' ? 'OK' : r.status === 'skipped' ? 'BỎ QUA' : 'LỖI'} — ${r.note}`),
      usable ? '' : '\nCẢNH BÁO: không nguồn nào cập nhật được hôm nay; chỉ dùng dữ liệu đã lưu, nêu rõ giới hạn này ở đầu báo cáo.',
      '', '## Digest case-study & trend (Brands Vietnam)', digestText(), '',
      '## Insight khách hàng', insight.context().replace(/^\s*\n*/, '').slice(0, 3200), '',
      `## Idea ĐÃ ĐỀ XUẤT trong ${KEEP_DAYS} ngày qua — TUYỆT ĐỐI không lặp lại (kể cả diễn đạt khác, cùng cơ chế/hook)`,
      ...(hist.length ? hist.map((i) => `- [${i.day}] ${i.title}`) : ['- (chưa có)']),
    ];
    return lines.join('\n').slice(0, 11000);
  }

  const TASK = (day) => `Làm báo cáo trend hiện nay và đề xuất idea content MỚI trong ngày ${day} cho Enzy, dựa trên file đính kèm (tình trạng nguồn, digest case-study Brands Vietnam, insight khách hàng, danh sách idea đã đề xuất).
Yêu cầu: (1) mở đầu nêu rõ nguồn nào cập nhật được/lỗi; (2) radar trend ngắn; (3) 5–7 idea MỚI, KHÔNG trùng hay na ná idea đã đề xuất trước đó; mỗi idea đặt tiêu đề đúng dạng "### IDEA 1: <tên idea>" rồi 3 dòng: insight gốc (nêu chủ đề khách hoặc case-study + nguồn), hook/định dạng/kênh, CTA theo giai đoạn phễu; (4) không bịa số liệu hay trích dẫn; chỉ lấy cảm hứng từ case-study, không sao chép.`;

  async function start() {
    if (running) return false;
    running = { step: 'Đang chuẩn bị…', since: Date.now() };
    runLog.length = 0;
    (async () => {
      try {
        const results = await doRun();
        running = { ...running, step: 'Chờ văn phòng rảnh để viết báo cáo…' };
        for (let i = 0; isBusy() && i < 360 && !stopReq; i++) await new Promise((r) => setTimeout(r, 5000));
        if (stopReq) throw new Error('Đã dừng theo yêu cầu');
        if (isBusy()) throw new Error('Văn phòng bận quá 30 phút, chưa giao được việc.');
        const rel = `daily/trend-idea-${today()}.md`;
        fs.mkdirSync(path.join(uploadsDir, 'daily'), { recursive: true });
        fs.writeFileSync(path.join(uploadsDir, rel), buildBrief(results));
        running = { ...running, step: 'Team đang viết báo cáo trend & idea…' }; rl(running.step);
        let fin = null;
        await submit(TASK(today()), [rel], { onFinal: (ev) => { fin = ev; }, label: `Quét Trend & Tạo Idea ${today()} [📎 dữ liệu các nguồn]` });
        const titles = extractIdeas(fin?.text);
        const n = titles.length ? recordIdeas(titles, fin?.file ? `reports/${encodeURIComponent(fin.file)}` : '') : 0;
        rl(titles.length ? `Đã ghi ${n} idea vào kho chống trùng.` : 'Báo cáo chưa có tiêu đề "### IDEA n:" nên chưa ghi được kho chống trùng.', titles.length ? 'ok' : 'warn');
        state.last = { at: new Date().toISOString(), sources: results.map(({ id, label, status, note }) => ({ id, label, status, note })), ideas: titles.length, report: fin?.file ? `reports/${encodeURIComponent(fin.file)}` : '', ok: Boolean(fin) };
      } catch (e) {
        rl(`Dừng: ${e.message}`, 'err'); log(`Quét Trend & Idea: ${e.message}`);
        state.last = { at: new Date().toISOString(), sources: [], ideas: 0, report: '', ok: false, error: e.message };
      } finally { writeJson(STATE, state); running = null; }
    })();
    return true;
  }


  // ---- Quét dữ liệu theo cấu hình đã lưu: chỉ các nguồn đã chọn; loại trừ trùng lặp (khoảng ngày đã cào, khách/dòng đã thấy, bài đã đọc) ----
  let scanRun = null, scanStop = false;
  const scanLog = [], sl = (text, level = '') => { scanLog.push({ at: Date.now(), text: String(text).slice(0, 400), level }); if (scanLog.length > 80) scanLog.splice(0, scanLog.length - 80); };
  function startScan() {
    if (running || scanRun || insight.running?.() || knowledge.running?.()) return false;
    const c = validateScan(loadScan()), saved = loadScan();
    if (!saved.savedAt) throw new Error('Chưa lưu cấu hình quét. Hãy bấm “Lưu” (cần mật khẩu Admin) trước.');
    scanLog.length = 0; scanStop = false;
    scanRun = { step: 'Đang chuẩn bị…', since: Date.now() };
    (async () => {
      const results = [];
      const one = async (id, label, fn) => {
        if (scanStop) { results.push({ id, label, status: 'skipped', note: 'Đã dừng' }); return; }
        scanRun = { ...scanRun, step: `${label}…` }; sl(`${label}…`);
        try { const r = await fn(); results.push({ id, label, ...r }); sl(`${label}: ${r.status === 'ok' ? 'xong' : 'lỗi'} — ${r.note}`, r.status === 'ok' ? 'ok' : 'err'); }
        catch (e) { results.push({ id, label, status: 'error', note: e.message }); sl(`${label}: lỗi (${e.message})`, 'err'); }
      };
      if (c.voc) await one('voc', `Ý kiến khách hàng ${vn(c.from)}–${vn(c.to)}`, async () => {
        const p = insight.runRange({ from: c.from, to: c.to, onProgress: (t) => { scanRun = { ...scanRun, step: t }; sl(t); } });
        if (!p) return { status: 'error', note: 'đang có lượt cào ý kiến khách hàng khác' };
        const r = await withTimeout(p, SOURCE_TIMEOUT.voc * 4, () => insight.stop());
        if (r.stopped) return { status: 'error', note: 'đã dừng' };
        if (!r.ok) return { status: 'error', note: String(r.error || 'không rõ').slice(0, 200) };
        return { status: 'ok', note: r.windows ? `cào ${r.windows} khoảng, ${r.newCustomers} khách có tin mới (đã loại trừ phần trùng)` : (r.note || 'không có dữ liệu mới (đã loại trừ trùng lặp)') };
      });
      if (c.brands) await one('brands', `Brands Vietnam (${c.campaign && c.library ? 'Campaign + Library' : c.campaign ? 'Campaign' : 'Library'})`, async () => {
        const p = knowledge.runNow({ source: brandsSource(c) });
        if (!p) return { status: 'error', note: 'đang có lượt quét Brands Vietnam khác' };
        const r = await withTimeout(p, SOURCE_TIMEOUT.brands, () => knowledge.stop());
        if (r.stopped) return { status: 'error', note: 'đã dừng' };
        if (!r.ok) return { status: 'error', note: String(r.error || '').slice(0, 200) };
        return { status: 'ok', note: r.added ? `${r.added} bài mới (bài đã đọc được bỏ qua)` : 'không có bài mới (đã loại trừ trùng lặp)' };
      });
      state.lastScan = { at: new Date().toISOString(), config: c, results: results.map(({ id, label, status, note }) => ({ id, label, status, note })), ok: results.every((r) => r.status === 'ok') };
      writeJson(STATE, state); scanRun = null;
    })().catch((e) => { sl(`Dừng: ${e.message}`, 'err'); state.lastScan = { at: new Date().toISOString(), config: c, results: [], ok: false, error: e.message }; writeJson(STATE, state); scanRun = null; });
    return true;
  }

  function stop() {
    if (scanRun && !running) { scanStop = true; scanRun = { ...scanRun, step: 'Đang dừng…' }; sl('Đã nhận yêu cầu dừng.', 'warn'); insight.stop(); knowledge.stop(); return true; }
    if (!running) return false;
    stopReq = true; running = { ...running, step: 'Đang dừng…' }; rl('Đã nhận yêu cầu dừng.', 'warn');
    insight.stop(); knowledge.stop();
    return true;
  }

  // Kho insight: idea đã đề xuất + chủ đề insight khách hàng + case-study đã chắt lọc (để xem/quản lý).
  const vault = () => {
    const kb = loadKb(), arts = loadArticles();
    return {
      ideas: loadHistory().slice().reverse(),
      themes: Object.values(kb.themes).sort((a, b) => b.count - a.count).map((t) => ({ id: t.id, label: t.label, type: TYPE_LABEL[t.type] || t.type, stage: STAGE_LABEL[t.stage] || t.stage, product: t.product, count: t.count, firstSeen: t.firstSeen, lastSeen: t.lastSeen, touchpoint: t.touchpoint, quotes: (t.quotes || []).slice(0, 3) })),
      articles: arts.slice(0, 300).map((a) => ({ id: a.id, source: a.source, title: a.title, brand: a.brand, category: a.category, saved: a.saved, published: a.published, tags: a.tags, insight: a.insight, big_idea: a.big_idea, lessons: a.lessons_for_enzy, angles: a.content_angles, results: a.results, summary: a.summary, url: a.url })),
    };
  };
  const status = () => ({ running, log: runLog.slice(-20), last: state.last, history: loadHistory().slice(-30).reverse(), scan: { config: loadScanAll(), yesterday: yesterday(), running: scanRun, log: scanLog.slice(-20), last: state.lastScan || null } });
  return { start, stop, status, vault, startScan, saveScan: saveScanAll };
}
