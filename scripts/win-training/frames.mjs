import { chromium } from '../../node_modules/playwright-core/index.mjs';
import { createRequire } from 'node:module';
const sharp = createRequire(new URL('../../package.json', import.meta.url))('sharp');
import fs from 'node:fs';
const SP = new URL('../../data/win-training/', import.meta.url).pathname;
const vids = JSON.parse(fs.readFileSync(SP + 'top_videos.json', 'utf8'));
fs.mkdirSync(SP + 'frames', { recursive: true });
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await b.newContext({ viewport: { width: 900, height: 1100 }, locale: 'vi-VN' });
let n = 0;
for (const v of vids) {
  n++;
  const page = await ctx.newPage();
  try {
    await page.goto(v.link, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(6000);
    const dur = await page.evaluate(() => { const e = document.querySelector('video'); if (!e) return 0; e.muted = true; e.play().catch(() => {}); return e.duration || 0; });
    if (!dur) { console.log(n, 'no video'); await page.close(); continue; }
    const times = [0.4, 2, 5, 10, 20, Math.min(40, dur * 0.7)].filter((t) => t < dur - 1);
    const shots = [];
    for (const t of times) {
      await page.evaluate((tt) => { const e = document.querySelector('video'); e.currentTime = tt; e.pause(); }, t);
      await page.waitForTimeout(900);
      // Đóng hộp thoại mời đăng nhập (chỉ đóng cửa sổ nhắc, không đăng nhập) để thấy khung hình.
      await page.evaluate(() => { document.querySelectorAll('[role=dialog]').forEach((d) => d.remove()); }).catch(() => {});
      await page.waitForTimeout(200);
      const el = await page.$('video');
      shots.push(await el.screenshot({ type: 'jpeg', quality: 70 }));
    }
    const W = 200, tiles = [];
    for (const s of shots) tiles.push(await sharp(s).resize({ width: W, height: 360, fit: 'cover' }).jpeg({ quality: 70 }).toBuffer());
    const sheet = await sharp({ create: { width: W * tiles.length, height: 360, channels: 3, background: '#222' } }).composite(tiles.map((t, i) => ({ input: t, left: i * W, top: 0 }))).jpeg({ quality: 72 }).toBuffer();
    fs.writeFileSync(SP + `frames/v${n}.jpg`, sheet);
    console.log(n, v.content.slice(0, 30), 'dur', Math.round(dur), 'frames', times.map((t) => Math.round(t)).join(','));
  } catch (e) { console.log(n, 'ERR', String(e.message).slice(0, 80)); }
  await page.close().catch(() => {});
}
await b.close();
