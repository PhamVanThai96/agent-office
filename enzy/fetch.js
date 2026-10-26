import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { readXlsxObjects } from './xlsx.js';

// Lấy số liệu từ trang báo cáo Streamlit của Enzy bằng Google Chrome có sẵn trên máy (chạy ẩn).
// Thao tác giống người dùng: đăng nhập → chọn thương hiệu/hệ thống → khoảng thời gian → bật so sánh nhiều tài khoản
// → chọn tài khoản QC → cửa hàng → "Tạo báo cáo" → đọc ô chỉ số, bảng tổng kết theo tài khoản và khối "Prompt phân tích quảng cáo".
const STEP_MS = 60000;
const REPORT_MS = 6 * 60000;
export const norm = (s) => String(s ?? '').normalize('NFC').replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '').replace(/\s+/g, ' ').trim().toLowerCase();

export async function settle(page, ms = 800) {
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
export async function selectBox(page, label, value) {
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

export async function login(page, cfg) {
  const user = page.locator('input[type="text"][aria-label*="Tài khoản"]');
  const appReady = page.locator('[data-testid="stMain"] h1', { hasText: 'Báo Cáo' });
  await Promise.race([user.waitFor({ timeout: 90000 }), appReady.waitFor({ timeout: 90000 })]);
  if (!(await user.count())) return;
  if (!cfg.user || !cfg.pass) throw new Error('Chưa có tài khoản đăng nhập Enzy: điền USER/PASS trong enzy.json (hoặc biến môi trường ENZY_USER/ENZY_PASS).');
  const pass = page.locator('input[type="password"]');
  const submitted = async (ms) => { await page.waitForTimeout(ms); return !(await pass.count()); };
  // Trang Streamlit đôi khi chậm/bỏ qua lần gửi đầu: thử tối đa 3 lần (điền lại cả hai ô) trước khi báo sai tài khoản.
  for (let attempt = 0; attempt < 3 && (await pass.count()); attempt++) {
    await user.fill(cfg.user);
    await user.press('Tab'); // Streamlit chỉ ghi nhận giá trị ô nhập khi rời ô / nhấn Enter; bấm nút ngay sau fill sẽ gửi giá trị cũ (rỗng).
    await settle(page, 400);
    await pass.fill(cfg.pass);
    await pass.press('Enter');
    if (await submitted(3000)) break;
    await page.getByRole('button', { name: 'Đăng nhập' }).click().catch(() => {});
    for (let i = 0; i < 10 && !(await submitted(1500)); i++);
  }
  if (await pass.count()) throw new Error('Đăng nhập Enzy thất bại: kiểm tra USER/PASS (trang không chấp nhận hoặc không phản hồi).');
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

// Nút "Tải về file Excel" của trang: bảng từng quảng cáo (tên đầy đủ, hiển thị, nhấp, lead, đơn, doanh thu) — dùng cho dashboard theo người thực hiện.
async function adsExcel(page) {
  const btn = page.locator('[data-testid="stDownloadButton"] button').first();
  await btn.waitFor({ timeout: STEP_MS });
  await btn.scrollIntoViewIfNeeded();
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 120000 }), btn.click()]);
  const file = await download.path();
  return readXlsxObjects(fs.readFileSync(file));
}

// Chọn khoảng ngày cố định (đầu–cuối kỳ theo lịch) trong ô "Khoảng thời gian" (lựa chọn tuỳ chọn + ô nhập ngày).
// Ô "Từ ngày → đến ngày" của trang là bộ chọn ngày kiểu react-aria: mỗi đầu mút gồm 3 ô số gõ được (ngày/tháng/năm, thứ tự hiển thị tuỳ trang)
// và 2 <input type="date"> ẩn giữ giá trị (đầu tiên = từ ngày, thứ hai = đến ngày). Không gõ được cả chuỗi vào một ô, nên gõ từng ô số.
const p2d = (n) => String(n).padStart(2, '0');
const isoDay = (d) => `${d.getFullYear()}-${p2d(d.getMonth() + 1)}-${p2d(d.getDate())}`;

const parseDay = (iso) => { const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
const addDay = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/**
 * Các bước đặt khoảng ngày để MỌI trạng thái trung gian đều hợp lệ (từ ≤ đến và độ dài ≤ maxDays): trang có thể từ chối/đặt lại
 * khi gặp khoảng không hợp lệ (vd. mục "Ý kiến khách hàng" chỉ cho tối đa 7 ngày). Mỗi bước = một lần sửa 1 đầu mút.
 * cur/want = [from, to] (Date). Trả về [{ which: 'start'|'end', date }].
 */
export function planDateSteps(cur, want, maxDays = Infinity) {
  let [cf, ct] = cur.map((d) => new Date(d));
  const [wf, wt] = want;
  const same = (a, b) => a.getTime() === b.getTime();
  const steps = [];
  const span = maxDays - 1;
  for (let guard = 0; guard < 60 && !(same(cf, wf) && same(ct, wt)); guard++) {
    if (wf < cf || (same(wf, cf) && wt < ct)) {
      // Đích nằm sớm hơn: hạ ngày kết thúc xuống (nhưng không dưới ngày bắt đầu hiện tại), rồi hạ ngày bắt đầu tối đa `span` ngày dưới ngày kết thúc.
      const ne = wt < cf ? cf : wt;
      if (!same(ne, ct)) { steps.push({ which: 'end', date: ne }); ct = ne; }
      const ns = wf < addDay(ct, -span) ? addDay(ct, -span) : wf;
      if (!same(ns, cf)) { steps.push({ which: 'start', date: ns }); cf = ns; }
    } else {
      // Đích nằm muộn hơn: đẩy ngày bắt đầu lên (không quá ngày kết thúc hiện tại), rồi đẩy ngày kết thúc lên tối đa `span` ngày sau ngày bắt đầu.
      const ns = wf > ct ? ct : wf;
      if (!same(ns, cf)) { steps.push({ which: 'start', date: ns }); cf = ns; }
      const ne = wt > addDay(cf, span) ? addDay(cf, span) : wt;
      if (!same(ne, ct)) { steps.push({ which: 'end', date: ne }); ct = ne; }
    }
  }
  return steps;
}

/**
 * Đặt khoảng ngày [from, to] cho bộ chọn "Từ ngày → đến ngày". opts: { maxDays, confirm }.
 * confirm: async () => boolean, kiểm tra TRANG (không chỉ ô nhập) đã nhận đúng khoảng ngày, chờ tối đa 15 giây rồi mới coi là chưa nhận.
 */
/**
 * Chọn khoảng ngày bằng LỊCH (bấm ngày bắt đầu rồi ngày kết thúc). Trên trang không nằm trong form (mục "Ý kiến khách hàng"), gõ vào các ô số chỉ đổi
 * giá trị trong trình duyệt mà trang KHÔNG nhận; chỉ khi chọn xong khoảng trên lịch trang mới cập nhật (đã kiểm tra trên trang thật 25/10).
 * Cần locale vi-VN (nhãn ô ngày dạng "Thứ Bảy, 24 tháng 10, 2026"); tháng đang hiện đọc từ 2 <select> ẩn (giá trị số, không phụ thuộc ngôn ngữ).
 */
async function pickViaCalendar(page, field, from, to) {
  const grid = page.locator('[role="grid"]');
  const open = async () => {
    if (await grid.count()) return;
    await field.locator('[data-testid="stDateInputCalendarButton"]').first().click();
    await grid.first().waitFor({ state: 'visible', timeout: 10000 });
  };
  const shown = () => page.evaluate(() => {
    const v = [...document.querySelectorAll('[role="application"] select')].map((x) => Number(x.value));
    return v.length >= 2 ? { month: v[0], year: v[1] } : null;
  });
  const goTo = async (d) => {
    for (let i = 0; i < 24; i++) {
      const cur = await shown();
      if (!cur) throw new Error('Không đọc được tháng đang hiện trên lịch.');
      const diff = (d.getFullYear() - cur.year) * 12 + (d.getMonth() + 1 - cur.month);
      if (!diff) return;
      const btns = page.locator('[role="application"] button');
      const want = diff < 0 ? /^Previous month$/i : /^Next month$/i;
      const labels = await btns.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') || ''));
      let idx = labels.findIndex((l) => want.test(l));
      if (idx < 0) idx = diff < 0 ? 0 : 3; // dự phòng theo vị trí: [trước, tháng, năm, sau]
      await btns.nth(idx).click();
      await page.waitForTimeout(250);
    }
    throw new Error('Không chuyển được tới tháng cần chọn trên lịch.');
  };
  const clickDay = async (d) => {
    const cell = page.locator(`[role="grid"] [role="button"][aria-label*="${d.getDate()} tháng ${d.getMonth() + 1}"]`).filter({ hasText: new RegExp(`^${d.getDate()}$`) }).first();
    await cell.waitFor({ state: 'visible', timeout: 8000 }).catch(() => { throw new Error(`Không thấy ô ngày ${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()} trên lịch (có thể bị khoá hoặc locale không phải vi-VN).`); });
    await cell.click();
    await page.waitForTimeout(500);
  };
  await open();
  await goTo(from);
  await clickDay(from);
  if (!(await grid.count())) await open(); // lịch đóng sau ngày đầu: mở lại, ngày đầu vẫn được giữ
  await goTo(to);
  await clickDay(to);
  await grid.first().waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
}

export async function fillDateRange(page, from, to, opts = {}) {
  const { maxDays = Infinity, confirm, method = 'type' } = opts;
  const field = page.locator('[data-testid="stMain"] [data-testid="stDateInput"]').filter({ has: page.locator('[data-range-field]') }).first();
  await field.waitFor({ timeout: STEP_MS }).catch(async () => {
    const seen = await page.evaluate(() => [...document.querySelectorAll('input')].filter((i) => i.getBoundingClientRect().width > 0).map((i) => `${i.type}:${i.getAttribute('aria-label') || i.value}`).slice(0, 12));
    throw new Error(`Không thấy ô chọn khoảng ngày (từ → đến) trên trang. Các ô nhập đang thấy: ${seen.join(' | ') || '(không có)'}.`);
  });
  const want = [isoDay(from), isoDay(to)];
  if (to < from) throw new Error('Khoảng ngày không hợp lệ (đến < từ).');
  if (Number.isFinite(maxDays) && Math.round((to - from) / 864e5) + 1 > maxDays) throw new Error(`Khoảng ngày ${want[0]} → ${want[1]} dài hơn ${maxDays} ngày mà trang cho phép.`);
  const read = async () => (await field.locator('input[type="date"]').evaluateAll((els) => els.map((e) => e.value))).map(parseDay);
  const same = (a, b) => a && b && a.getTime() === b.getTime();
  const segVal = (which, kind) => field.locator(`[data-range-field="${which}"] [data-type="${kind}"]`).first().getAttribute('aria-valuenow').then(Number);

  // Gõ từng ô số ngày/tháng/năm, chỉ ô nào khác giá trị hiện tại.
  const setEnd = async (which, d) => {
    for (const [kind, val] of [['year', d.getFullYear()], ['month', d.getMonth() + 1], ['day', d.getDate()]]) {
      if ((await segVal(which, kind).catch(() => NaN)) === val) continue;
      const seg = field.locator(`[data-range-field="${which}"] [data-type="${kind}"]`).first();
      await seg.click();
      await page.keyboard.type(kind === 'year' ? String(val) : p2d(val), { delay: 40 });
    }
  };
  const confirmed = async () => {
    if (!confirm) return true;
    for (let i = 0; i < 15; i++) { if (await confirm().catch(() => false)) return true; await page.waitForTimeout(1000); }
    return false;
  };

  const log = [];
  if (method === 'calendar') {
    for (let round = 0; round < 3; round++) {
      const cur = await read();
      if (!(cur[0] && cur[1] && same(cur[0], from) && same(cur[1], to) && (await confirmed()))) {
        log.push(`vòng ${round + 1}: lịch, đang ${cur.map((d) => (d ? isoDay(d) : '?')).join('→')}`);
        try { await pickViaCalendar(page, field, from, to); } catch (e) { log.push(e.message); }
        await settle(page, 1000);
      }
      const now = await read();
      if (same(now[0], from) && same(now[1], to) && (await confirmed())) return;
    }
    const fin = await read();
    throw new Error(`Không chọn được khoảng ngày ${want[0]} → ${want[1]} trên lịch: ô chọn đang giữ ${fin.map((d) => (d ? isoDay(d) : '?')).join(' → ')} (${log.join('; ')}).`);
  }
  for (let round = 0; round < 4; round++) {
    const cur = await read();
    if (cur.length < 2 || !cur[0] || !cur[1]) throw new Error('Không đọc được khoảng ngày hiện tại của trang.');
    if (!(same(cur[0], from) && same(cur[1], to))) {
      const steps = planDateSteps(cur, [from, to], maxDays);
      log.push(`vòng ${round + 1}: ${isoDay(cur[0])}→${isoDay(cur[1])}, ${steps.length} bước`);
      for (const st of steps) { await setEnd(st.which, st.date); await settle(page, 700); }
    }
    await page.locator('[data-testid="stMain"] h1').first().click({ position: { x: 4, y: 4 } }).catch(() => {}); // rời ô để trang nhận giá trị
    await settle(page, 1000);
    const now = await read();
    if (same(now[0], from) && same(now[1], to) && (await confirmed())) return;
  }
  const fin = await read();
  throw new Error(`Không đặt được khoảng ngày ${want[0]} → ${want[1]}: ô chọn đang giữ ${fin.map((d) => (d ? isoDay(d) : '?')).join(' → ')}${confirm ? ' hoặc trang chưa nhận khoảng này' : ''} (${log.join('; ') || 'không có bước nào'}).`);
}

async function pickDates(page, from, to) {
  const box = combo(page, 'Khoảng thời gian');
  await box.click();
  const opts = page.locator('[role="option"]');
  await opts.first().waitFor({ timeout: STEP_MS });
  const all = await opts.allInnerTexts();
  const i = all.findIndex((t) => /t[uù][yỳ]\s*(ch[oọ]n|ch[iỉ]nh)|tu[ỳy]\s*ch[ọo]n|custom|kho[aả]ng ng[aà]y|ch[oọ]n ng[aà]y/i.test(norm(t)) || /t[ùu]y|tuỳ|custom|ch[ọo]n ng/i.test(t));
  if (i < 0) { await page.keyboard.press('Escape'); throw new Error(`Trang báo cáo không có lựa chọn khoảng ngày tuỳ chọn (các lựa chọn hiện có: ${all.map((t) => t.trim()).join(' | ')}). Cần chọn khoảng ngày cố định ${isoDay(from)} – ${isoDay(to)}.`); }
  await opts.nth(i).click();
  await settle(page, 1200);
  await fillDateRange(page, from, to);
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
    if (opts.dates) await pickDates(page, opts.dates.from, opts.dates.to); else await selectBox(page, 'Khoảng thời gian', opts.range);
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
    let adsRows = null, adsError = '';
    if (opts.wantAds !== false) { try { adsRows = await adsExcel(page); } catch (e) { adsError = e.message; } }
    return { range: opts.range, accounts, grid, adsRows, adsError, ...info };
  } finally {
    await browser.close();
  }
}
