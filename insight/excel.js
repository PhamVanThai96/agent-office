import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { settle, selectBox, login, fillDateRange, norm } from '../enzy/fetch.js';
import { readXlsxObjects, xlsxSheetNames } from '../enzy/xlsx.js';
import { stringifyYaml } from '../yamlmini.js';
import { parseIso, vnFull, scrub, DIR } from './store.js';

// Lấy ý kiến khách hàng bằng file Excel của trang Enzy (Streamlit): hệ thống "Ý kiến khách hàng" → chọn khoảng ngày
// → "Mở dữ liệu đã lưu" (dữ liệu đã quét sẵn, chọn được khoảng dài) hoặc "Quét mới từ Pancake" (≤ 7 ngày, chậm) → "Tải Excel đầy đủ".
// Kết quả lưu YAML ẩn danh (bỏ tên/SĐT/link khách) ở data/insight/voc/ để agent dùng khi lên idea.
const STEP_MS = 60000;
const LOAD_MS = 10 * 60000;
export const VOC_DIR = path.join(DIR, 'voc');
const DROP = /^(kh[aá]ch h[aà]ng|nh[aâ]n vi[eê]n|t[eê]n|ho t[eê]n|sdt|s[oố] ?đi[eệ]n tho[aạ]i|phone|email|link|url|c_id|id|uid|psid|m[aã] h[oộ]i tho[aạ]i|th[uư][oơ]ng hi[eệ]u|ngu[oồ]n)\b/i; // thông tin cá nhân hoặc cột hằng số

/** opts: { url, user, pass, brand, system, from, to (YYYY-MM-DD), mode: 'saved'|'scan', ctl } → { rows, shown, metrics } */
export async function fetchVocExcel(opts) {
  const browser = await chromium.launch({ channel: 'chrome', headless: opts.headless !== false });
  if (opts.ctl) { opts.ctl.browser = browser; if (opts.ctl.stopped) { await browser.close().catch(() => {}); throw new Error('Đã dừng theo yêu cầu.'); } }
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1200 }, locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh', acceptDownloads: true });
    await page.goto(opts.url, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await login(page, opts);
    await page.locator('[data-testid="stMain"] h1, [data-testid="stMain"] h2').first().waitFor({ timeout: 120000 }).catch(() => {});
    if (opts.brand) await selectBox(page, 'Thương hiệu', opts.brand);
    await selectBox(page, 'hệ thống làm việc', opts.system || 'Ý kiến khách hàng');
    await page.getByText(/Khoảng thời gian/).first().waitFor({ timeout: STEP_MS });
    await fillDateRange(page, parseIso(opts.from), parseIso(opts.to), { method: 'calendar' });
    const btn = opts.mode === 'scan' ? /Quét mới từ Pancake/ : /Mở dữ liệu đã lưu/;
    await page.getByRole('button', { name: btn }).first().click();
    const want = `${vnFull(opts.from)} đến ${vnFull(opts.to)}`;
    const t0 = Date.now();
    let text = '';
    for (;;) {
      await page.waitForTimeout(2500);
      text = await page.evaluate(() => document.querySelector('[data-testid="stMain"]')?.innerText || '');
      const busy = await page.evaluate(() => !!document.querySelector('[data-testid="stStatusWidget"]'));
      if (!busy && /Đang xem từ/.test(text) && (await page.getByRole('button', { name: /Tải Excel đầy đủ/ }).count())) break;
      if (!busy && Date.now() - t0 > 20000 && /Không có dữ liệu|không tìm thấy|chưa có dữ liệu/i.test(text)) throw new Error(`Trang báo không có dữ liệu cho ${want}.`);
      if (Date.now() - t0 > LOAD_MS) throw new Error('Quá thời gian chờ trang tải dữ liệu ý kiến khách hàng.');
    }
    const shown = (text.match(/Đang xem từ[^\n]*/) || [''])[0];
    if (!shown.includes(want)) throw new Error(`Trang đang hiện khoảng khác (${shown.slice(0, 80)}), mong muốn ${want}.`);
    const metrics = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-testid="stMain"] [data-testid="stMetric"]')].map((m) => [m.querySelector('[data-testid="stMetricLabel"]')?.innerText.trim(), m.querySelector('[data-testid="stMetricValue"]')?.innerText.trim()])));
    await settle(page, 800);
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 180000 }),
      page.getByRole('button', { name: /Tải Excel đầy đủ/ }).first().click(),
    ]);
    const buf = fs.readFileSync(await download.path());
    if (opts.saveTo) fs.writeFileSync(opts.saveTo, buf);
    return { buf, shown, metrics };
  } finally {
    await browser.close();
  }
}

// File Excel có nhiều sheet (vd "Thông tin" chỉ là siêu dữ liệu: cột Thông tin/Giá trị): chọn sheet dữ liệu ý kiến = sheet nhiều dòng nhất không phải sheet thông tin.
export function readVocWorkbook(buf) {
  const names = xlsxSheetNames(buf);
  const sheets = (names.length ? names : ['Sheet1']).map((name, i) => { let rows = []; try { rows = readXlsxObjects(buf, i); } catch { /* sheet lỗi: bỏ qua */ } return { name, rows }; });
  const isInfo = (sh) => /th[oô]ng tin|info/i.test(norm(sh.name)) || (Object.keys(sh.rows[0] || {}).length === 2 && /^th[oô]ng tin$/i.test(norm(Object.keys(sh.rows[0])[0])));
  const data = sheets.filter((sh) => !isInfo(sh)).sort((a, b) => b.rows.length - a.rows.length)[0];
  if (!data || !data.rows.length) throw new Error(`File Excel không có sheet dữ liệu (các sheet: ${sheets.map((x) => `${x.name}=${x.rows.length} dòng`).join(', ')}).`);
  const info = Object.fromEntries((sheets.find(isInfo)?.rows || []).map((r) => { const v = Object.values(r); return [String(v[0] ?? '').trim(), v[1]]; }).filter(([k]) => k));
  return { rows: data.rows, sheet: data.name, info };
}

const pickCol = (cols, re) => cols.find((c) => re.test(norm(c)));

/** Hàng Excel → tài liệu YAML ẩn danh (không tên/SĐT/link khách). */
export function vocToYaml({ rows, from, to, mode, metrics = {} }) {
  const cols = Object.keys(rows[0] || {});
  const cDate = pickCol(cols, /ng[aà]y|th[oờ]i gian|date/), cChan = pickCol(cols, /k[eê]nh|ngu[oồ]n|channel/);
  const cText = pickCol(cols, /[yý] ki[eế]n|c[aâ]u h[oỏ]i|n[oộ]i dung|tin nh[aắ]n|b[iì]nh lu[aậ]n/), cTopic = pickCol(cols, /ch[uủ] đ[eề]|topic/);
  const keep = cols.filter((c) => ![cDate, cChan, cText, cTopic].includes(c) && !DROP.test(norm(c)));
  const count = (col) => { const o = {}; for (const r of rows) { const k = String(r[col] ?? '').trim() || '(trống)'; o[k] = (o[k] || 0) + 1; } return Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 25)); };
  const items = rows.map((r, i) => {
    const it = { n: i + 1 };
    if (cDate) it.date = String(r[cDate] ?? '').trim();
    if (cChan) it.channel = String(r[cChan] ?? '').trim();
    if (cTopic && String(r[cTopic] ?? '').trim()) it.topic = String(r[cTopic]).trim();
    it.text = scrub(cText ? r[cText] : Object.values(r).filter((v) => typeof v === 'string').join(' | '), 700);
    for (const c of keep) if (r[c] != null && r[c] !== '') it[c] = typeof r[c] === 'string' ? scrub(r[c], 300) : r[c];
    return it;
  }).filter((it) => it.text);
  return {
    doc: {
      nguon: 'enzyfood.streamlit.app · Ý kiến khách hàng (Excel đầy đủ)',
      tu_ngay: from, den_ngay: to, che_do: mode === 'scan' ? 'quét mới từ Pancake' : 'dữ liệu đã lưu',
      lay_luc: new Date().toISOString(), so_dong: items.length, cot_goc: cols,
      ghi_chu: 'Đã ẩn danh: bỏ tên, SĐT, link khách; link/số dài trong nội dung bị xoá.',
      chi_so_trang: metrics,
      ...(cChan ? { theo_kenh: count(cChan) } : {}), ...(cTopic && rows.some((r) => String(r[cTopic] ?? '').trim()) ? { theo_chu_de: count(cTopic) } : {}),
      // Cột phân loại ít giá trị (Nhóm dữ liệu, Mức quan tâm, Kết quả, Vấn đề…) → thống kê để thấy nhanh bức tranh chung.
      ...Object.fromEntries(keep.filter((c) => { const v = new Set(rows.map((r) => String(r[c] ?? '').trim()).filter(Boolean)); return v.size > 0 && v.size <= 15 && !/th[oờ]i gian|link/i.test(norm(c)); }).map((c) => [`theo_${norm(c).replace(/\s+/g, '_')}`, count(c)])),
      y_kien: items,
    },
    items: items.length,
  };
}

export function saveVocYaml(res) {
  fs.mkdirSync(VOC_DIR, { recursive: true });
  const text = '# Ý kiến khách hàng Enzy (ẩn danh) — dùng khi lên idea content; xem thêm skill 07-y-kien-khach-hang\n' + stringifyYaml(res.doc);
  const file = path.join(VOC_DIR, `${res.doc.tu_ngay}_${res.doc.den_ngay}.yaml`);
  fs.writeFileSync(file, text);
  fs.writeFileSync(path.join(VOC_DIR, 'latest.yaml'), text);
  return file;
}
