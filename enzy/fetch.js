import { chromium } from 'playwright-core';

// Lấy số liệu từ trang báo cáo Streamlit của Enzy bằng Google Chrome có sẵn trên máy (chạy ẩn).
// Thao tác giống người dùng: đăng nhập → chọn thương hiệu/hệ thống → khoảng thời gian → bật so sánh nhiều tài khoản
// → chọn tài khoản QC → cửa hàng → "Tạo báo cáo" → đọc ô chỉ số, bảng tổng kết theo tài khoản và khối "Prompt phân tích quảng cáo".
const STEP_MS = 60000;
const REPORT_MS = 6 * 60000;
const norm = (s) => String(s ?? '').normalize('NFC').replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '').replace(/\s+/g, ' ').trim().toLowerCase();

async function settle(page, ms = 800) {
  await page.waitForTimeout(ms);
  await page.waitForFunction(() => !document.querySelector('[data-testid="stStatusWidget"]'), null, { timeout: REPORT_MS }).catch(() => {});
  await page.waitForTimeout(300);
}

const combo = (page, label) => page.locator(`input[role="combobox"][aria-label*="${label}"]`).first();

async function pickOption(page, text) {
  const want = norm(text);
  const opts = page.locator('[role="option"]');
  await opts.first().waitFor({ timeout: STEP_MS });
  const all = await opts.allInnerTexts();
  let i = all.findIndex((t) => norm(t) === want);
  if (i < 0) i = all.findIndex((t) => norm(t).startsWith(want));
  if (i < 0) i = all.findIndex((t) => norm(t).includes(want));
  if (i < 0) { await page.keyboard.press('Escape'); return null; }
  await opts.nth(i).click();
  return all[i];
}

// Chọn giá trị cho selectbox nếu đang khác (so sánh bỏ emoji, không phân biệt hoa thường).
async function selectBox(page, label, value) {
  const box = combo(page, label);
  await box.waitFor({ timeout: STEP_MS });
  if (norm(await box.inputValue()).includes(norm(value))) return true;
  await box.click();
  const ok = await pickOption(page, value);
  await settle(page);
  if (!ok) throw new Error(`Không tìm thấy lựa chọn "${value}" trong ô "${label}".`);
  return true;
}

const tags = (page) => page.locator('[data-testid="stMultiSelect"] span[title]').evaluateAll((els) => els.map((e) => e.title));

// Đặt đúng danh sách tài khoản QC: bỏ tài khoản thừa, thêm tài khoản thiếu bằng cách bấm đúng tên (không gõ tìm, tránh chọn nhầm "Enzy 12").
async function setAccounts(page, accounts) {
  const missing = new Set();
  for (let attempt = 0; attempt < 3; attempt++) {
    for (const t of await tags(page)) {
      if (accounts.includes(t)) continue;
      await page.locator(`[data-testid="stMultiSelect"] button[aria-label="Remove ${t}"]`).click();
      await settle(page);
    }
    for (const a of accounts) {
      if ((await tags(page)).includes(a) || missing.has(a)) continue;
      await page.locator('[data-testid="stMultiSelect"] input[role="combobox"]').click();
      const opts = page.locator('[role="option"]');
      await opts.first().waitFor({ timeout: STEP_MS });
      const all = await opts.allInnerTexts();
      const i = all.findIndex((t) => t.trim() === a);
      if (i < 0) { missing.add(a); await page.keyboard.press('Escape'); continue; }
      await opts.nth(i).click();
      await page.keyboard.press('Escape');
      await settle(page);
    }
    const now = await tags(page);
    if (accounts.every((a) => now.includes(a) || missing.has(a)) && now.every((t) => accounts.includes(t))) return { selected: now, missing: [...missing] };
  }
  const now = await tags(page);
  throw new Error(`Không chọn được đúng tài khoản QC (đang chọn: ${now.join(', ')}).`);
}

async function login(page, cfg) {
  const user = page.locator('input[type="text"][aria-label*="Tài khoản"]');
  const appReady = page.locator('[data-testid="stMain"] h1', { hasText: 'Báo Cáo' });
  await Promise.race([user.waitFor({ timeout: 90000 }), appReady.waitFor({ timeout: 90000 })]);
  if (!(await user.count())) return;
  if (!cfg.user || !cfg.pass) throw new Error('Chưa có tài khoản đăng nhập Enzy: điền USER/PASS trong enzy.json (hoặc biến môi trường ENZY_USER/ENZY_PASS).');
  await user.fill(cfg.user);
  await page.locator('input[type="password"]').fill(cfg.pass);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await settle(page, 1500);
  if (await page.locator('input[type="password"]').count()) throw new Error('Đăng nhập Enzy thất bại: kiểm tra USER/PASS trong enzy.json.');
}

async function toggleCompare(page) {
  const sw = page.locator('input[role="switch"][aria-label*="So sánh nhiều tài khoản"]');
  if (!(await sw.count())) return;
  if (await sw.isChecked()) return;
  await page.locator('[data-testid="stCheckbox"]').filter({ hasText: 'So sánh nhiều tài khoản' }).locator('label').click();
  await settle(page, 1200);
  await page.locator('[data-testid="stMultiSelect"]').first().waitFor({ timeout: STEP_MS });
}

// Bảng "Tổng kết theo tài khoản" (AgGrid trong iframe). Viewport rộng để hiện đủ cột.
async function accountGrid(page) {
  const frameEl = page.locator('iframe[src*="st_aggrid"]').first();
  await frameEl.waitFor({ timeout: STEP_MS });
  const frame = await (await frameEl.elementHandle()).contentFrame();
  await frame.waitForSelector('.ag-center-cols-container .ag-row', { timeout: STEP_MS });
  await page.waitForTimeout(800);
  return frame.evaluate(() => {
    const head = [...document.querySelectorAll('.ag-header-row-column .ag-header-cell')].map((h) => h.innerText.trim());
    const left = [...document.querySelectorAll('.ag-pinned-left-cols-container .ag-row')].map((r) => r.innerText.trim());
    const center = [...document.querySelectorAll('.ag-center-cols-container .ag-row')].map((r) => [...r.querySelectorAll('.ag-cell')].map((c) => c.innerText.trim()));
    const total = [...document.querySelectorAll('.ag-floating-bottom-container .ag-row')].map((r) => [...r.querySelectorAll('.ag-cell')].map((c) => c.innerText.trim()))[0] || null;
    return { head, left, center, total };
  });
}

/**
 * opts: { url, user, pass, brand, system, store, accounts: [], range: 'Hôm qua (trọn ngày)', headless }
 * Trả về dữ liệu thô: { range, period, updated, metrics, grid, code, notes, accounts: {selected, missing} }
 */
export async function fetchEnzy(opts) {
  const browser = await chromium.launch({ channel: 'chrome', headless: opts.headless !== false });
  try {
    const page = await browser.newPage({ viewport: { width: 3600, height: 1400 }, locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh' });
    await page.goto(opts.url, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await login(page, opts);
    await page.locator('[data-testid="stMain"] h1', { hasText: 'Báo Cáo' }).first().waitFor({ timeout: 120000 }).catch(() => {});
    if (opts.brand) await selectBox(page, 'Thương hiệu', opts.brand);
    if (opts.system) await selectBox(page, 'hệ thống làm việc', opts.system);
    await page.locator('[data-testid="stMain"] h1', { hasText: 'Báo Cáo Quảng Cáo' }).first().waitFor({ timeout: STEP_MS });
    await selectBox(page, 'Khoảng thời gian', opts.range);
    await toggleCompare(page);
    const accounts = await setAccounts(page, opts.accounts);
    if (opts.store) await selectBox(page, 'Cửa hàng', opts.store);
    await page.getByRole('button', { name: /Tạo báo cáo/ }).first().click();
    await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="stCode"]')].some((c) => c.innerText.includes('# TỔNG TÀI KHOẢN')), null, { timeout: REPORT_MS });
    await settle(page, 1500);
    const info = await page.evaluate(() => {
      const main = document.querySelector('[data-testid="stMain"]');
      const text = main.innerText;
      return {
        metrics: Object.fromEntries([...main.querySelectorAll('[data-testid="stMetric"]')].map((m) => [m.querySelector('[data-testid="stMetricLabel"]')?.innerText.trim(), m.querySelector('[data-testid="stMetricValue"]')?.innerText.trim()])),
        code: [...main.querySelectorAll('[data-testid="stCode"]')].map((c) => c.innerText).find((t) => t.includes('# TỔNG TÀI KHOẢN')) || '',
        period: (text.match(/Dữ liệu được lấy từ ([^\n(]+)/) || [])[1]?.trim() || '',
        updated: (text.match(/Cập nhật lúc ([^\n]+)/) || [])[1]?.trim() || '',
        notes: (text.match(/Một số tài khoản chưa được ghép:[^\n]+/) || [])[0] || '',
      };
    });
    const grid = await accountGrid(page).catch((e) => ({ error: e.message }));
    return { range: opts.range, accounts, grid, ...info };
  } finally {
    await browser.close();
  }
}
