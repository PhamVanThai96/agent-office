import { chromium } from '../../node_modules/playwright-core/index.mjs';
import fs from 'node:fs';
const SP = new URL('../../data/win-training/', import.meta.url).pathname;
const list = JSON.parse(fs.readFileSync(SP + 'crawl_list.json', 'utf8')).filter((r) => r.link.startsWith('http'));
const out = fs.existsSync(SP + 'fb_raw.json') ? JSON.parse(fs.readFileSync(SP + 'fb_raw.json', 'utf8')) : {};
const b = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await b.newContext({ viewport: { width: 1280, height: 1000 }, locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh' });
async function one(r) {
  const page = await ctx.newPage();
  try {
    await page.goto(r.link, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(8000);
    // Mở phần "Xem thêm" của caption để lấy đủ nội dung.
    await page.evaluate(() => { const e = [...document.querySelectorAll('div[role=button],span')].find((x) => x.innerText && x.innerText.trim() === 'Xem thêm'); e?.click(); }).catch(() => {});
    await page.waitForTimeout(700);
    return await page.evaluate(() => {
      const v = document.querySelector('video');
      const og = (p) => document.querySelector(`meta[property="og:${p}"]`)?.content || '';
      return { link: location.href, title: document.title, ogTitle: og('title'), ogDesc: og('description'), dur: v && isFinite(v.duration) ? Math.round(v.duration) : null, text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 3200) };
    });
  } catch (e) { return { error: String(e.message).slice(0, 100) }; }
  finally { await page.close().catch(() => {}); }
}
const todo = list.filter((r) => !out[r.link] || out[r.link].error);
let i = 0, done = 0;
async function worker() {
  while (i < todo.length) {
    const r = todo[i++];
    out[r.link] = await one(r);
    if (++done % 5 === 0) { fs.writeFileSync(SP + 'fb_raw.json', JSON.stringify(out)); console.log(`progress ${done}/${todo.length}`); }
    await new Promise((x) => setTimeout(x, 800 + Math.random() * 1200));
  }
}
await Promise.all([worker(), worker(), worker()]);
fs.writeFileSync(SP + 'fb_raw.json', JSON.stringify(out));
console.log('DONE', Object.keys(out).length);
await b.close();
