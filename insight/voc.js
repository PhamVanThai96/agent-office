import { chromium } from 'playwright-core';
import { settle, selectBox, login, fillDateRange } from '../enzy/fetch.js';
import { parseIso, vnFull } from './store.js';

// Cào mục "Ý kiến khách hàng" của trang Enzy (Streamlit): chọn khoảng ngày (tối đa 7 ngày) → "Bắt đầu bóc tách Dữ liệu (Inbox + Comment)"
// → đọc khối "Dữ liệu SẠCH" (danh sách khách + tin nhắn/bình luận chưa insight). Chạy bằng Google Chrome có sẵn, ẩn.
const STEP_MS = 60000;
const SCRAPE_MS = 20 * 60000;

// "--- Khách hàng 06120 [INBOX] | Link: https://pancake.vn/...?c_id=… ---" + các dòng "- nội dung".
export function parseVoc(code) {
  const entries = [];
  let cur = null;
  for (const raw of String(code || '').split(/\r?\n/)) {
    const line = raw.trim();
    const h = line.match(/^---\s*Khách hàng\s+(\S+)\s*\[([^\]]+)\]\s*(?:\|\s*Link:\s*(\S+))?\s*---\s*$/i);
    if (h) {
      const link = h[3] || '';
      const cid = (link.match(/[?&]c_id=([^&\s]+)/) || [])[1];
      cur = { cust: h[1], channel: h[2].toUpperCase(), id: cid || `${h[2].toUpperCase()}:${h[1]}:${link.slice(-24)}`, lines: [] };
      entries.push(cur);
      continue;
    }
    if (!cur || !line) continue;
    cur.lines.push(line.replace(/^[-•]\s*/, ''));
  }
  return entries.filter((e) => e.lines.length);
}

/** opts: { url, user, pass, brand, system, from, to (YYYY-MM-DD), headless } → { code, found, scanned, alerts } */
export async function scrapeVoc(opts) {
  const browser = await chromium.launch({ channel: 'chrome', headless: opts.headless !== false });
  // opts.ctl = { stopped, browser }: nút Dừng đóng trình duyệt này để mọi thao tác đang chờ thoát ngay.
  if (opts.ctl) { opts.ctl.browser = browser; if (opts.ctl.stopped) { await browser.close().catch(() => {}); throw new Error('Đã dừng theo yêu cầu.'); } }
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1200 }, locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh' });
    await page.goto(opts.url, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await login(page, opts);
    await page.locator('[data-testid="stMain"] h1, [data-testid="stMain"] h2').first().waitFor({ timeout: 120000 }).catch(() => {});
    if (opts.brand) await selectBox(page, 'Thương hiệu', opts.brand);
    if (opts.system) await selectBox(page, 'hệ thống làm việc', opts.system);
    await page.getByText(/Chọn khoảng thời gian quét/).first().waitFor({ timeout: STEP_MS });

    const want = `từ ${vnFull(opts.from)} đến ${vnFull(opts.to)}`;
    // Trang chỉ cho tối đa 7 ngày và có thể từ chối khoảng trung gian không hợp lệ → đặt từng bước hợp lệ, rồi chờ dòng "Khoảng thời gian đang chọn" đổi đúng.
    await fillDateRange(page, parseIso(opts.from), parseIso(opts.to), {
      maxDays: 7, method: 'calendar', // trang này không nằm trong form: phải chọn trên lịch thì trang mới nhận
      confirm: () => page.evaluate((w) => (document.querySelector('[data-testid="stMain"]')?.innerText || '').includes(w), want),
    });
    const shown = await page.evaluate(() => document.querySelector('[data-testid="stMain"]')?.innerText || '');
    if (!shown.includes(want)) {
      const got = (shown.match(/Khoảng thời gian đang chọn:[^\n]*/) || ['(không thấy dòng "Khoảng thời gian đang chọn")'])[0];
      throw new Error(`Không chọn được khoảng ngày ${vnFull(opts.from)}–${vnFull(opts.to)} (trang đang hiện: ${got}).`);
    }

    await page.getByRole('button', { name: /Bắt đầu bóc tách/ }).first().click();
    const t0 = Date.now();
    let idle = 0, st = {};
    while (Date.now() - t0 < SCRAPE_MS) {
      await page.waitForTimeout(2500);
      st = await page.evaluate(() => {
        const t = document.querySelector('[data-testid="stMain"]')?.innerText || '';
        return { done: /Dữ liệu SẠCH/i.test(t), scraping: /Đang cào dữ liệu/i.test(t) || !!document.querySelector('[data-testid="stStatusWidget"]') };
      });
      if (st.done && !st.scraping) break;
      idle = st.scraping ? 0 : idle + 1;
      if (!st.done && idle >= 6 && Date.now() - t0 > 20000) break; // không còn xử lý mà cũng không có kết quả: trang báo không có dữ liệu hoặc lỗi
    }
    if (Date.now() - t0 >= SCRAPE_MS) throw new Error('Quá thời gian chờ trang cào dữ liệu (20 phút).');
    await settle(page, 1200);
    return await page.evaluate(() => {
      const main = document.querySelector('[data-testid="stMain"]');
      const text = main?.innerText || '';
      const codes = [...(main?.querySelectorAll('[data-testid="stCode"]') || [])].map((c) => c.innerText);
      return {
        code: codes.find((c) => /---\s*Khách hàng/.test(c)) || '',
        found: Number((text.match(/Tìm thấy\s+(\d+)\s+khách hàng/i) || [])[1] ?? NaN),
        scanned: Number((text.match(/Đã quét\s+(\d+)/i) || [])[1] ?? NaN),
        alerts: [...main.querySelectorAll('[data-testid="stAlert"]')].map((a) => a.innerText.replace(/\s+/g, ' ').trim()).slice(-4),
      };
    });
  } finally {
    await browser.close();
  }
}
