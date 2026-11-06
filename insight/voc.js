import { norm } from '../enzy/fetch.js';
import { vnFull } from './store.js';
import { fetchVocExcel, readVocWorkbook } from './excel.js';

// Lấy mục "Ý kiến khách hàng" của trang Enzy (Streamlit) bằng file Excel (xem excel.js), đổi sang danh sách khách + tin nhắn/bình luận để chắt lọc insight.

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

/** Hàng của file Excel "Ý kiến khách hàng" → văn bản cùng định dạng cũ ("--- Khách hàng N [KÊNH] ---" + các dòng "- nội dung") để parseVoc và phần chắt lọc dùng tiếp. */
export function rowsToCode(rows) {
  const cols = Object.keys(rows[0] || {});
  const find = (re) => cols.find((c) => re.test(norm(c)));
  const cCust = find(/^kh[aá]ch h[aà]ng$|^kh[aá]ch$|m[aã] kh[aá]ch|^t[eê]n$/), cChan = find(/k[eê]nh|ngu[oồ]n|channel/), cDate = find(/ng[aà]y|th[oờ]i gian|date/);
  const cText = find(/[yý] ki[eế]n|c[aâ]u h[oỏ]i|n[oộ]i dung|tin nh[aắ]n|b[iì]nh lu[aậ]n/);
  const out = [];
  let last = '';
  rows.forEach((r, i) => {
    const text = String(cText ? r[cText] : Object.values(r).find((v) => typeof v === 'string' && v.length > 8) ?? '').replace(/\s+/g, ' ').trim();
    if (!text) return;
    const cust = String(cCust ? r[cCust] : `dòng ${i + 1}`).replace(/^kh[aá]ch h[aà]ng\s*/i, '').trim() || `dòng ${i + 1}`;
    const chan = String(cChan ? r[cChan] : 'KHÁC').trim().toUpperCase() || 'KHÁC';
    const key = `${cust}|${chan}`;
    if (key !== last) { out.push(`--- Khách hàng ${cust.replace(/\s+/g, '-')} [${chan}] ---`); last = key; }
    out.push(`- ${cDate && r[cDate] ? `[${String(r[cDate]).trim()}] ` : ''}${text}`);
  });
  return out.join('\n');
}

/**
 * opts: { url, user, pass, brand, system, from, to (YYYY-MM-DD), profile, ctl, onRetry } → { code, found, scanned, alerts }
 * Giao diện mục "Ý kiến khách hàng" của trang Enzy đã đổi (chọn khoảng ngày → "Mở dữ liệu đã lưu" / "Quét mới từ Pancake" → "Tải Excel đầy đủ"):
 * lấy file Excel (ưu tiên dữ liệu đã lưu, nhanh; không có thì quét mới từ Pancake) rồi đổi các hàng thành định dạng cũ.
 */
export async function scrapeVoc(opts) {
  let res, mode = 'saved';
  try { res = await fetchVocExcel({ ...opts, mode }); }
  catch (e) {
    if (opts.ctl?.stopped || !/không có dữ liệu|đang hiện khoảng khác|Quá thời gian/i.test(e.message)) throw e;
    mode = 'scan';   // dữ liệu đã lưu chưa có cho khoảng này (vd mới trong ngày): quét mới từ Pancake
    opts.onRetry?.(`Chưa có dữ liệu đã lưu cho ${vnFull(opts.from)}–${vnFull(opts.to)} (${e.message.slice(0, 80)}): quét mới từ Pancake…`);
    res = await fetchVocExcel({ ...opts, mode });
  }
  const w = readVocWorkbook(res.buf);
  const code = rowsToCode(w.rows);
  return { code, found: parseVoc(code).length, scanned: w.rows.length, alerts: [`Excel ${mode === 'scan' ? 'quét mới từ Pancake' : 'dữ liệu đã lưu'}: ${w.rows.length} dòng`] };
}
