import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openBrowser, gotoPolite, listArticles, readArticle, politeDelay, LISTINGS } from './crawl.js';
import { distillArticle } from './distill.js';
import * as S from './store.js';

// Quét Brands Vietnam (campaign + library) → bản tóm tắt YAML → 2 skill cho agent. Chạy nền, có nút Dừng, mỗi lượt đọc tối đa `perRun` bài MỚI.
// Cấu hình quét chung (data/daily/scan.json): lịch tự quét chỉ chạy khi Brands Vietnam được bật và chỉ quét loại bài đã chọn.
const SCAN_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'daily', 'scan.json');
function scheduledSource() {
  let c = null; try { c = JSON.parse(fs.readFileSync(SCAN_FILE, 'utf8')); } catch { /* chưa có cấu hình: quét cả hai */ }
  if (!c) return 'all';
  if (c.brands === false) return '';
  return c.campaign && c.library ? 'all' : c.campaign ? 'campaign' : c.library ? 'library' : 'all';
}
export function createKnowledge({ log = () => {}, wrap = (label, fn) => fn() } = {}) {
  let running = null, ctl = null, stopReq = false, lastRun = null, lastDay = '';
  const runLog = [];
  const rl = (text, level = '') => { runLog.push({ at: Date.now(), text: String(text).slice(0, 400), level }); if (runLog.length > 80) runLog.splice(0, runLog.length - 80); };

  async function doRun(sources, perRun, recentDays = 0) {
    runLog.length = 0;
    ctl = { stopped: stopReq, browser: null }; stopReq = false;
    const done = { ok: true, added: 0, errors: 0, old: 0, failed: [] };
    const cutoff = recentDays ? Date.now() - recentDays * 864e5 : 0;
    let ctx;
    try {
      rl('Mở Chrome (profile riêng)…');
      ctx = await openBrowser(ctl, rl);
      const ix = S.loadIndex();
      for (const source of sources) {
        if (ctl.stopped || done.added >= perRun) break;
        let oldRun = 0; // tối đa 3 bài liên tiếp cũ hơn `recentDays` thì thôi nguồn này (danh sách xếp mới → cũ)
        try {
        running = { ...running, step: `Đang xem danh sách ${source}…` }; rl(running.step);
        await gotoPolite(ctx.page, LISTINGS[source], { ctl, rl });
        const fresh = (await listArticles(ctx.page, source, { ctl, rl })).filter((u) => !ix.articles[u]);
        rl(`${fresh.length} bài mới chưa đọc trong ${source}.`);
        for (const url of fresh) {
          if (ctl.stopped || done.added >= perRun) break;
          await politeDelay(ctl);
          running = { ...running, step: `Đang đọc ${url.replace('https://www.brandsvietnam.com', '')} (${done.added + 1}/${perRun})…` }; rl(running.step);
          try {
            await gotoPolite(ctx.page, url, { ctl, rl });
            const a = await readArticle(ctx.page);
            const pt = Date.parse(a.published);
            if (cutoff && Number.isFinite(pt) && pt < cutoff) { ix.articles[url] = { source, old: true, at: S.today() }; S.saveIndex(ix); done.old++; if (++oldRun >= 3) { rl(`Các bài tiếp theo của ${source} đã cũ hơn ${recentDays} ngày, dừng nguồn này.`); break; } continue; }
            oldRun = 0;
            if (a.text.length < 400) { rl(`Bỏ qua (nội dung quá ngắn/không đọc được): ${url}`, 'warn'); ix.articles[url] = { source, skipped: true, at: S.today() }; S.saveIndex(ix); continue; }
            const d = await distillArticle({ source, title: a.title, text: a.text });
            const r = S.saveArticle({ source, url, title: a.title, published: a.published, distilled: d, via: d.via });
            ix.articles[url] = { source, id: r.id, title: a.title, at: S.today(), file: r.file };
            S.saveIndex(ix); done.added++;
            rl(`Đã lưu: ${a.title.slice(0, 80)} → knowledge/data/${r.file}${d.via === 'rule' ? ' (trích đoạn, chưa có AI)' : ''}`, 'ok');
          } catch (e) { if (ctl.stopped || e.message === 'stopped') break; if (/Cloudflare|Chỉ được đọc/.test(e.message)) throw e; done.errors++; rl(`Lỗi ${url}: ${e.message}`, 'err'); if (done.errors >= 3) throw new Error('Quá nhiều lỗi liên tiếp, đã dừng.'); }
        }
        } catch (e) { if (ctl.stopped || e.message === 'stopped') break; done.failed.push(`${source}: ${e.message}`); rl(`Bỏ qua nguồn ${source}: ${e.message}`, 'err'); }
      }
    } catch (e) { if (!ctl?.stopped && e.message !== 'stopped') { done.ok = false; done.error = e.message; rl(e.message, 'err'); } }
    finally { try { await ctx?.context.close(); } catch { /* đã đóng */ } }
    if (done.failed.length && !done.added) { done.ok = false; done.error = done.failed.join(' | '); }
    if (ctl?.stopped) { done.ok = false; done.stopped = true; done.error = 'Đã dừng theo yêu cầu'; rl('Đã dừng theo yêu cầu; bài đã lưu vẫn được giữ.', 'warn'); }
    const total = S.writeSkills();
    rl(`Đã cập nhật kho (${total} bài) và 2 skill cho agent.`, 'ok');
    lastRun = { at: new Date().toISOString(), added: done.added, ok: done.ok, stopped: done.stopped || undefined, error: done.error };
    running = null; ctl = null;
    return done;
  }

  /** Chạy ngay; trả false nếu đang bận, ngược lại Promise<kết quả> (không bao giờ ném lỗi). */
  function runNow({ source = 'all', perRun, recentDays = 0 } = {}) {
    if (running) return false;
    const sources = source === 'all' ? ['campaign', 'library'] : [source];
    if (sources.some((s) => !LISTINGS[s])) throw new Error('source phải là campaign, library hoặc all.');
    const n = Math.min(Math.max(Math.round(Number(perRun)) || S.loadConfig().perRun, 1), 30);
    runLog.length = 0;
    running = { step: 'Đang chuẩn bị…', since: Date.now() };
    return wrap('Quét Brands Vietnam', () => doRun(sources, n, recentDays))
      .then((r) => { log(r.stopped ? 'Brands Vietnam: đã dừng.' : r.ok ? `Brands Vietnam: đã lưu ${r.added} bài mới.` : `Brands Vietnam lỗi: ${r.error}`); return r; })
      .catch((e) => { running = null; ctl = null; log(`Brands Vietnam lỗi: ${e.message}`); return { ok: false, added: 0, error: e.message }; });
  }
  const start = (o) => Boolean(runNow(o));

  function stop() {
    if (!running || running.stopping) return Boolean(running);
    running = { ...running, step: 'Đang dừng…', stopping: true };
    rl('Đã nhận yêu cầu dừng, đang đóng Chrome…', 'warn');
    if (ctl) { ctl.stopped = true; ctl.browser?.close().catch(() => {}); } else stopReq = true;
    return true;
  }

  // Lịch (mặc định tắt): mỗi ngày đúng giờ cấu hình mở Chrome quét; cần có người ở máy nếu Cloudflare đòi xác minh (không thì tự dừng sau 4 phút).
  const timer = setInterval(() => {
    const c = S.loadConfig(), now = new Date(), hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`, day = S.today();
    if (c.enabled && !running && hm >= c.time && lastDay !== day) { lastDay = day; const src = scheduledSource(); if (src) start({ source: src }); }
  }, 30000);
  timer.unref?.();

  const status = () => {
    const ix = S.loadIndex(), arts = S.loadArticles(), c = S.loadConfig();
    const by = (s) => arts.filter((a) => a.source === s).length;
    return { running, log: runLog.slice(-16), lastRun, config: c, total: arts.length, campaign: by('campaign'), library: by('library'), week: arts.filter((a) => a.saved >= new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10)).length, updated: ix.updated, recent: arts.slice(0, 12).map((a) => ({ title: a.title, brand: a.brand, source: a.source, saved: a.saved, url: a.url, insight: a.insight || a.summary })) };
  };

  return { start, runNow, stop, status, rebuild: S.writeSkills, running: () => running };
}
