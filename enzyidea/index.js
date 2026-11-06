import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scrapeEnzyIdeas } from './scrape.js';
import { streamlitLogin, CONTENT_PROFILE } from '../enzy/fetch.js';
import { loadContentConfig, ingestIdeas, writeSkill, loadIdeas, readJson, writeJson, AUTH_FILE, DIR } from './store.js';

// Nguồn "Idea Enzy" của "Quét Trend & Tạo Idea": cào các Big Idea trên trang Enzy bằng tài khoản content, lưu kho (loại trùng) và cập nhật skill cho agent.
// Báo cáo idea do daily/index.js tạo (từ các nguồn được chọn); ở đây chỉ có quét, lưu, và đoạn tóm tắt gọn để đưa vào file đính kèm của báo cáo.
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const TODAY_FILE = path.join(DIR, 'today.json');
const SCRAPE_TIMEOUT = 15 * 60 * 1000;
const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const cut = (t, n) => { t = String(t || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
void ROOT;

export function createEnzyIdea({ log = () => {}, scrape = scrapeEnzyIdeas } = {}) {
  let scanning = null, ctl = null;
  const withTimeout = (p, ms, onTimeout) => new Promise((resolve, reject) => {
    const t = setTimeout(() => { try { onTimeout?.(); } catch { /* bỏ qua */ } reject(new Error(`Quá thời gian chờ (${Math.round(ms / 60000)} phút)`)); }, ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });

  /** Cào idea trên trang Enzy → lưu kho (loại trùng) → cập nhật skill → ghi dữ liệu của ngày hôm nay (cho báo cáo). */
  async function scan({ onProgress = () => {} } = {}) {
    if (scanning) throw new Error('Đang quét idea Enzy khác.');
    scanning = { since: Date.now() };
    const c = loadContentConfig();
    try {
      ctl = { stopped: false };
      const scraped = await withTimeout(scrape({ url: c.URL, user: c.USER, pass: c.PASS, brand: c.BRAND, system: c.SYSTEM }, { onProgress, onRetry: (t) => onProgress(t), ctl }), SCRAPE_TIMEOUT, () => { ctl.stopped = true; ctl.browser?.close(); });
      const r = ingestIdeas(scraped);
      const skills = writeSkill();
      writeJson(TODAY_FILE, { day: localDay(), at: new Date().toISOString(), items: scraped, fresh: r.fresh.map((f) => f.title) });
      return { scraped: scraped.length, added: r.added, seen: r.seen, total: r.total, skills };
    } finally { scanning = null; ctl = null; }
  }
  function stop() { if (!scanning) return false; if (ctl) { ctl.stopped = true; ctl.browser?.close(); } return true; }

  /** Đoạn đưa vào file đính kèm của báo cáo: idea MỚI đủ ý chính (≤ ~450 ký tự), idea đã có trong kho chỉ một dòng. */
  function briefText() {
    const t = readJson(TODAY_FILE, null);
    if (!t || !t.items?.length) {
      const bank = loadIdeas().slice(-6).reverse();
      if (!bank.length) return '(Chưa có dữ liệu idea từ trang Enzy.)';
      return ['(Chưa quét idea Enzy hôm nay; dưới đây là vài idea gần nhất trong kho)', ...bank.map((i) => `- ${cut(i.title, 120)}${i.bigIdea ? ` — ${cut(i.bigIdea, 120)}` : ''}`)].join('\n');
    }
    const fresh = new Set(t.fresh || []);
    const L = [`(${t.items.length} idea trên trang Enzy ngày ${t.day}; ${fresh.size} mới so với kho)`];
    t.items.forEach((i, n) => {
      const isNew = fresh.has(i.title);
      L.push(`## ${i.no || n + 1}. ${cut(i.title, 150)} ${isNew ? '[MỚI]' : '[đã có]'}`);
      if (isNew) {
        if (i.bigIdea) L.push(`- Big Idea: ${cut(i.bigIdea, 220)}`);
        for (const [k, v] of Object.entries(i.fields || {}).slice(0, 4)) L.push(`- ${cut(k, 40)}: ${cut(v, 200)}`);
      } else if (i.bigIdea) L.push(`- ${cut(i.bigIdea, 120)}`);
    });
    return L.join('\n');
  }

  // Đăng nhập Streamlit Cloud cho hồ sơ Chrome RIÊNG của tài khoản content (chỉ cần khi ứng dụng Enzy ở chế độ riêng tư).
  const lastAuth = readJson(AUTH_FILE, {});
  const auth = { running: false, msg: lastAuth.msg || '', ok: lastAuth.ok ?? null, at: lastAuth.at || 0, ctl: null };
  function startAuth() {
    if (auth.running || scanning) return false;
    Object.assign(auth, { running: true, msg: 'Đang mở Chrome…', ok: null, ctl: { stopped: false } });
    streamlitLogin({ url: loadContentConfig().URL, say: (t) => { auth.msg = t; }, ctl: auth.ctl, profile: CONTENT_PROFILE })
      .then(() => { auth.ok = true; auth.msg = 'Đã đăng nhập Streamlit cho hồ sơ content và lưu phiên. Có thể quét idea.'; })
      .catch((e) => { auth.ok = false; auth.msg = e.message; })
      .finally(() => {
        auth.running = false; auth.ctl = null; auth.at = Date.now();
        try { writeJson(AUTH_FILE, { ok: auth.ok, msg: auth.msg, at: auth.at }); } catch { /* không ghi được thì bỏ qua */ }
        log(auth.ok ? 'Đăng nhập Streamlit (hồ sơ content): thành công, đã lưu phiên.' : `Đăng nhập Streamlit (hồ sơ content): thất bại — ${auth.msg}`);
      });
    return true;
  }
  const stopAuth = () => { if (!auth.running) return false; auth.ctl.stopped = true; auth.ctl.browser?.close(); return true; };
  const status = () => {
    const c = loadContentConfig();
    return { auth: { running: auth.running, msg: auth.msg, ok: auth.ok, at: auth.at }, scanning: Boolean(scanning), configured: Boolean(c.USER && c.PASS), system: c.SYSTEM, total: loadIdeas().length,
      recent: loadIdeas().slice(-12).reverse().map((i) => ({ id: i.id, title: i.title, tag: i.tag, firstSeen: i.firstSeen, seenCount: i.seenCount })) };
  };
  return { scan, stop, briefText, status, startAuth, stopAuth, running: () => Boolean(scanning) };
}
