import path from 'node:path';
import fs from 'node:fs';
import { chromium } from 'playwright-core';

// Đọc Brands Vietnam bằng Chrome CÓ GIAO DIỆN, profile riêng (data/knowledge/profile) để phiên đã xác minh được giữ lại.
// Không vượt Cloudflare: nếu gặp trang xác minh, chỉ chờ NGƯỜI DÙNG tự bấm qua trong cửa sổ Chrome; quá hạn chờ hoặc vẫn bị chặn thì DỪNG.
// Lịch sự: robots.txt cho phép /library/ và /campaign/; mỗi lần 1 trang, nghỉ 4–9 giây giữa các trang.
export const PROFILE_DIR = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'data', 'knowledge', 'profile');
export const LISTINGS = { campaign: 'https://www.brandsvietnam.com/campaign/', library: 'https://www.brandsvietnam.com/library/' };
const ARTICLE_RE = { campaign: /^\/campaign\/[^/?#]+\/?$/, library: /^\/library\/doc\/[^/?#]+\/?$/ };
const HOST = /(^|\.)brandsvietnam\.com$/;
const CHALLENGE = /attention required|just a moment|verify you are human|cloudflare/i;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isBlocked = async (page, status) => { const t = await page.title().catch(() => ''); return status === 403 || status === 429 || status === 503 || CHALLENGE.test(t); };

export async function openBrowser(ctl, rl) {
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
  const context = await chromium.launchPersistentContext(PROFILE_DIR, { channel: 'chrome', headless: false, viewport: { width: 1200, height: 850 }, args: ['--window-size=1200,850'] });
  ctl.browser = context;
  const page = context.pages()[0] || await context.newPage();
  return { context, page };
}

// Mở URL; nếu bị chặn thì chờ người dùng xác minh thủ công tối đa `waitMs`.
export async function gotoPolite(page, url, { ctl, rl, waitMs = 240000 }) {
  const u = new URL(url);
  if (!HOST.test(u.hostname) || !/^\/(campaign|library)(\/|$)/.test(u.pathname)) throw new Error(`Chỉ được đọc /campaign/ và /library/ của brandsvietnam.com (gặp ${url}).`);
  const r = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch((e) => { if (ctl.stopped) throw new Error('stopped'); throw e; });
  await sleep(1500);
  if (!(await isBlocked(page, r?.status()))) return;
  rl(`Brands Vietnam đang yêu cầu xác minh (Cloudflare). Hãy hoàn tất xác minh trong cửa sổ Chrome vừa mở — đang chờ tối đa ${Math.round(waitMs / 60000)} phút…`, 'warn');
  const end = Date.now() + waitMs;
  while (Date.now() < end) {
    if (ctl.stopped) throw new Error('stopped');
    await sleep(2500);
    if (!(await isBlocked(page, 200))) { rl('Đã qua xác minh, tiếp tục.', 'ok'); return; }
  }
  throw new Error('Vẫn bị Cloudflare chặn sau thời gian chờ nên đã dừng (không cố vượt).');
}

/** Danh sách link bài trên trang liệt kê; cuộn vài lần / bấm "xem thêm" để tải thêm. */
export async function listArticles(page, source, { ctl, rl, scrolls = 4 }) {
  const urls = new Set();
  const grab = async () => {
    const hrefs = await page.evaluate(() => [...document.querySelectorAll('a[href]')].map((a) => a.href));
    for (const h of hrefs) { try { const u = new URL(h); if (HOST.test(u.hostname) && ARTICLE_RE[source].test(u.pathname)) urls.add(`https://www.brandsvietnam.com${u.pathname.replace(/\/$/, '')}`); } catch { /* bỏ qua */ } }
  };
  await grab();
  for (let i = 0; i < scrolls && !ctl.stopped; i++) {
    const before = urls.size;
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.locator('text=/xem thêm|load more|tải thêm/i').first().click({ timeout: 1500 }).catch(() => {});
    await sleep(2200);
    await grab();
    if (urls.size === before) break;
  }
  rl(`Trang ${source}: thấy ${urls.size} link bài.`);
  return [...urls];
}

export async function readArticle(page) {
  return page.evaluate(() => {
    const pick = ['article', '.article-content', '.content-detail', '.detail-content', '#content', 'main'].map((s) => document.querySelector(s)).find((e) => e && e.innerText.length > 500) || document.body;
    const clone = pick.cloneNode(true);
    clone.querySelectorAll('script,style,nav,header,footer,aside,form,iframe,.related,.comment,.share,[class*=banner],[class*=advert]').forEach((e) => e.remove());
    const meta = (p) => document.querySelector(`meta[property="${p}"],meta[name="${p}"]`)?.content || '';
    return { title: (document.querySelector('h1')?.innerText || meta('og:title') || document.title).trim(), published: meta('article:published_time') || meta('datePublished') || (document.querySelector('time')?.getAttribute('datetime') || document.querySelector('time')?.innerText || ''), text: clone.innerText.replace(/\n{3,}/g, '\n\n').trim().slice(0, 16000) };
  });
}

export const politeDelay = (ctl) => sleep(4000 + Math.random() * 5000).then(() => { if (ctl.stopped) throw new Error('stopped'); });
