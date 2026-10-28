// Dashboard content theo người thực hiện: lọc quảng cáo có tên người ở cuối ("... 13.08_HNC TẠI SAO ĐẮT (TRÂN)"),
// gom theo content (phần "dd.mm_TÊN CONTENT"), tính chỉ số bằng code và dựng một trang HTML độc lập (có lọc/sắp xếp).

const plain = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toUpperCase().replace(/\s+/g, ' ').trim();
const num = (v) => {
  if (typeof v === 'number') return v;
  const t = String(v ?? '').trim();
  if (!t || t === '—' || t === '-') return 0;
  const n = Number(t.replace(/,/g, '').replace(/[^\d.\-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const TAIL = /\(\s*([^()]+?)\s*\)\s*$/;

export const ownerOf = (adName) => (String(adName ?? '').match(TAIL)?.[1] || '').trim();

// "…CT WIN 1 - 13.08_HNC TẠI SAO ĐẮT (TRÂN)" → "13.08_HNC TẠI SAO ĐẮT"
export function contentOf(adName) {
  const s = String(adName ?? '').replace(TAIL, '').replace(/\s+/g, ' ').trim();
  const m = s.match(/\d{1,2}\.\d{1,2}_.*$/);
  return (m ? m[0] : s.split(' - ').pop() || s).trim();
}

// rows: các hàng của file Excel "Tải về file Excel" trên trang báo cáo. Trả về tất cả ads đã chuẩn hoá.
export function normalizeAds(rows) {
  return (rows || []).map((r) => ({
    account: String(r['Tài khoản QC'] ?? ''), name: String(r['Tên quảng cáo'] ?? ''),
    sp: num(r['Ads đã chi']), im: num(r['Lượt hiển thị']), ck: num(r['Click (all)']), lk: num(r['Lượt nhấp liên kết']),
    ld: num(r['Số lead']), od: num(r['Số đơn hàng']), rv: num(r['Doanh thu trong kỳ']),
  })).filter((a) => a.name);
}

// owners: ["TRÂN","NGA"] (không phân biệt hoa thường/dấu). Người còn lại (và quảng cáo chưa gắn tên) được gộp thành nhóm "KHÁC" để so sánh.
export const OTHER = 'KHÁC';
// Từ khoá khớp trong TÊN quảng cáo (không phân biệt hoa/thường và dấu; khớp theo từ/cụm từ trọn vẹn, vd "STAC" không khớp "STACK").
const kwRegex = (k) => new RegExp(`(^|[^A-Z0-9])${plain(k).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^A-Z0-9])`);
const cleanKw = (keywords) => [...new Set((keywords || []).map((k) => String(k).trim()).filter(Boolean))];
export function keywordsOf(name, keywords) {
  const n = plain(name);
  return cleanKw(keywords).filter((k) => kwRegex(k).test(n));
}
// Lọc quảng cáo: giữ quảng cáo khớp BẤT KỲ từ khoá nào. Danh sách từ khoá rỗng = không lọc.
export function filterByKeywords(ads, keywords) {
  const list = cleanKw(keywords);
  const total = ads.reduce((t, a) => t + a.sp, 0), revTotal = ads.reduce((t, a) => t + a.rv, 0);   // revAll/spendAll = TOÀN tài khoản (trước khi lọc từ khoá) để báo cáo luôn có tổng đúng
  if (!list.length) return { ads, info: { list: [], matched: ads.length, all: ads.length, spendMatched: total, spendAll: total, revMatched: revTotal, revAll: revTotal } };
  const kept = ads.filter((a) => keywordsOf(a.name, list).length);
  return { ads: kept, info: { list, matched: kept.length, all: ads.length, spendMatched: kept.reduce((t, a) => t + a.sp, 0), spendAll: total, revMatched: kept.reduce((t, a) => t + a.rv, 0), revAll: revTotal } };
}

const sumOf = (rows) => rows.reduce((t, r) => ({ n: t.n + 1, sp: t.sp + r.sp, im: t.im + r.im, ck: t.ck + r.ck, lk: t.lk + r.lk, od: t.od + r.od, ld: t.ld + r.ld, rv: t.rv + r.rv }), { n: 0, sp: 0, im: 0, ck: 0, lk: 0, od: 0, ld: 0, rv: 0 });
const ratio = (a, b) => (b ? a / b : null);
// Số liệu từng từ khoá (KHÔNG loại trừ: quảng cáo chứa nhiều từ khoá được tính ở mỗi từ khoá). Dùng để so sánh hiệu quả STAC vs LNT.
export function keywordStats(ads, keywords) {
  const list = cleanKw(keywords);
  return list.map((k) => {
    const sel = ads.filter((a) => keywordsOf(a.name, [k]).length), t = sumOf(sel);
    return { k: k.toUpperCase(), ...t, ns: ratio(t.sp, t.rv), roas: ratio(t.rv, t.sp), cpa: ratio(t.sp, t.od), cpl: ratio(t.sp, t.ld), ctr: ratio(t.ck, t.im), cv: ratio(t.od, t.ld), top: [...sel].sort((x, y) => y.rv - x.rv).slice(0, 3).map((a) => ({ n: a.name, sp: a.sp, rv: a.rv, od: a.od })) };
  });
}
// Nhóm theo từ khoá (khi KHÔNG có người thực hiện): mỗi quảng cáo gán cho từ khoá ĐẦU TIÊN (theo thứ tự cấu hình) mà nó chứa → cùng hình dạng với groupByOwner.
export function groupByKeyword(ads, keywords) {
  const list = cleanKw(keywords), map = new Map();
  let total = 0, multi = 0;
  for (const a of ads) {
    const hit = keywordsOf(a.name, list);
    if (!hit.length) continue;
    total += a.sp; if (hit.length > 1) multi++;
    const grp = hit[0].toUpperCase(), content = contentOf(a.name), key = `${grp}|${content}`;
    if (!map.has(key)) map.set(key, { o: grp, who: [], n: content, sp: 0, im: 0, ck: 0, lk: 0, od: 0, ld: 0, rv: 0, ad: 0, ads: [] });
    const g = map.get(key);
    const w = ownerOf(a.name); if (w && !/^\d+$/.test(w) && !g.who.includes(w.toUpperCase())) g.who.push(w.toUpperCase());
    for (const k of ['sp', 'im', 'ck', 'lk', 'od', 'ld', 'rv']) g[k] += a[k];
    if (a.sp > 0) g.ad++;
    g.ads.push({ a: a.account, n: a.name, sp: a.sp, od: a.od, rv: a.rv });
  }
  const rows = [...map.values()].filter((g) => g.sp > 0);
  for (const g of rows) { g.ads.sort((x, y) => y.sp - x.sp); g.who = g.who.join(', '); }
  const names = list.map((k) => k.toUpperCase()).filter((k) => rows.some((r) => r.o === k));
  return { rows, total, owned: total, owners: names, listed: list.map((k) => k.toUpperCase()), multi, mode: 'kw' };
}

// Mục tiêu "Hiệu quả content" cấu hình ở GUI: TARGETS = { cpa|rev|ns|cpl: { op: '<'|'<='|'>'|'>=', value } } (CPA, doanh thu, CPL tính bằng đồng; NS/DT tính bằng %).
// Trả về danh sách mục tiêu hợp lệ [{ k, op, v }] (ns đổi sang tỉ lệ 0–1). Rỗng = đánh giá theo mặt bằng của nhóm như cũ.
export const TARGET_LABEL = { cpa: 'CPA', rev: 'Doanh thu', ns: 'NS/DT', cpl: 'CPL' };
export function normTargets(t) {
  const out = [];
  for (const k of ['cpa', 'rev', 'ns', 'cpl']) {
    const x = t?.[k], v = Number(x?.value);
    if (x && ['<', '<=', '>', '>='].includes(x.op) && x.value !== '' && x.value != null && Number.isFinite(v) && v >= 0) out.push({ k, op: x.op, v: k === 'ns' ? v / 100 : v });
  }
  return out;
}
const cmpOp = (a, op, b) => (op === '<' ? a < b : op === '<=' ? a <= b : op === '>' ? a > b : a >= b);
const OPV = { '<': '<', '<=': '≤', '>': '>', '>=': '≥' };

// Đánh giá content (cùng quy tắc với dashboard) cho một tập content: trung vị chi tiêu, ngưỡng CPA/NS-DT/tỷ lệ đơn-lead của nhóm, mức đánh giá và chỉ số cần tối ưu.
export function evaluateContents(rows, targets = []) {
  const tg = normTargets(Array.isArray(targets) ? Object.fromEntries(targets.map((x) => [x.k, { op: x.op, value: x.k === 'ns' ? x.v * 100 : x.v }])) : targets);
  const t = sumOf(rows), cpa = ratio(t.sp, t.od), ns = ratio(t.sp, t.rv), cv = ratio(t.od, t.ld);
  const sp = rows.map((r) => r.sp).sort((a, b) => a - b), h = sp.length >> 1;
  const med = sp.length ? (sp.length % 2 ? sp[h] : (sp[h - 1] + sp[h]) / 2) : 0;
  const vnd = (n) => Math.round(n).toLocaleString('vi-VN'), pc = (n) => `${(n * 100).toFixed(1).replace('.', ',')}%`;
  const items = rows.map((r) => {
    const rc = ratio(r.sp, r.od), rn = ratio(r.sp, r.rv), rv = ratio(r.od, r.ld), rl = ratio(r.sp, r.ld), bad = [];
    let k;
    if (tg.length) {
      // Theo mục tiêu đã cấu hình: đạt TẤT CẢ → Hiệu quả; đạt một phần → Cần tối ưu (ghi chỉ số chưa đạt); không đạt cái nào hoặc chưa có đơn → Chưa hiệu quả.
      const val = { cpa: rc, rev: r.rv, ns: rn, cpl: rl };
      for (const x of tg) {
        const v = val[x.k];
        if (v != null && cmpOp(v, x.op, x.v)) continue;
        const money = x.k !== 'ns';
        bad.push({ m: TARGET_LABEL[x.k], text: `${TARGET_LABEL[x.k]} ${v == null ? 'chưa có số liệu' : money ? vnd(v) + 'đ' : pc(v)} (mục tiêu ${OPV[x.op]} ${money ? vnd(x.v) + 'đ' : pc(x.v)})` });
      }
      k = r.sp < med ? 1 : r.od === 0 ? 3 : bad.length === 0 ? 0 : bad.length >= tg.length ? 3 : 2;
    } else {
      if (rc != null && cpa != null && rc > cpa) bad.push({ m: 'CPA', text: `CPA ${vnd(rc)}đ (ngưỡng ${vnd(cpa)}đ)` });
      if (rn != null && ns != null && rn > ns) bad.push({ m: 'NS/DT', text: `NS/DT ${pc(rn)} (ngưỡng ${pc(ns)})` });
      if (rv != null && cv != null && rv < cv) bad.push({ m: 'Tỷ lệ đơn/lead', text: `Tỷ lệ đơn/lead ${pc(rv)} (ngưỡng ${pc(cv)})` });
      k = r.sp < med ? 1 : r.od === 0 ? 3 : bad.length === 0 ? 0 : bad.length >= 3 ? 3 : 2;
    }
    return { ...r, k, bad };
  });
  return { items, med, cpa, ns, cv, targets: tg, counts: [0, 1, 2, 3].map((k) => items.filter((i) => i.k === k).length) };
}
export const LEVELS = ['Hiệu quả', 'Cần theo dõi', 'Cần tối ưu', 'Chưa hiệu quả'];
// Panel tiêu chí + ngưỡng (khối ```panel: report.js vẽ thành hộp nền tối viền vàng, tương phản cao) + danh sách content cần tối ưu.
export function criteriaMarkdown(rows, scopeLabel = 'toàn bộ content trong báo cáo', targets = null) {
  if (!rows?.length) return '';
  const ev = evaluateContents(rows, targets || []);
  const vnd = (n) => Math.round(n).toLocaleString('vi-VN'), pc = (n) => (n == null ? '–' : `${(n * 100).toFixed(1).replace('.', ',')}%`), tr = (n) => `${(n / 1e6).toFixed(2).replace('.', ',')} tr`;
  const tgText = ev.targets.map((x) => `${TARGET_LABEL[x.k]} ${OPV[x.op]} ${x.k === 'ns' ? pc(x.v) : vnd(x.v) + 'đ'}`).join(' · ');
  const L = ['```panel', '## 📏 TIÊU CHÍ & NGƯỠNG ĐÁNH GIÁ CONTENT', ''];
  if (ev.targets.length) {
    L.push(`Áp dụng cho **${scopeLabel}** (${rows.length} content). Đánh giá theo **mục tiêu "Hiệu quả content" đã cấu hình** (📊 Dữ liệu Enzy).`, '',
      `**Hiệu quả khi đạt TẤT CẢ:** ${tgText}`, '', `**Chi tiêu trung vị:** ${tr(ev.med)} (content chi tiêu thấp hơn mức này chỉ ở mức "Cần theo dõi")`, '',
      '| Mức đánh giá | Điều kiện | Số content |', '|---|---|---|',
      `| ✅ Hiệu quả | Chi tiêu ≥ trung vị và đạt TẤT CẢ mục tiêu trên | ${ev.counts[0]} |`,
      `| 👀 Cần theo dõi | Chi tiêu < trung vị: chưa đủ dữ liệu để kết luận | ${ev.counts[1]} |`,
      `| 🛠 Cần tối ưu | Đủ chi tiêu, đạt MỘT PHẦN mục tiêu (ghi rõ chỉ số chưa đạt) | ${ev.counts[2]} |`,
      `| ⛔ Chưa hiệu quả | Đủ chi tiêu nhưng chưa có đơn, hoặc không đạt mục tiêu nào | ${ev.counts[3]} |`, '');
  } else {
    L.push(`Áp dụng cho **${scopeLabel}** (${rows.length} content). Ngưỡng là mặt bằng của chính nhóm này, chưa phải KPI mục tiêu (có thể cấu hình mục tiêu ở 📊 Dữ liệu Enzy).`, '',
      `**Ngưỡng hiện tại:** chi tiêu trung vị **${tr(ev.med)}** · CPA nhóm **${ev.cpa == null ? '–' : vnd(ev.cpa) + 'đ'}** · NS/DT nhóm **${pc(ev.ns)}** · tỷ lệ đơn/lead nhóm **${pc(ev.cv)}**`, '',
      '| Mức đánh giá | Điều kiện | Số content |', '|---|---|---|',
      `| ✅ Hiệu quả | Chi tiêu ≥ trung vị và KHÔNG có chỉ số nào xấu hơn mặt bằng nhóm | ${ev.counts[0]} |`,
      `| 👀 Cần theo dõi | Chi tiêu < trung vị: chưa đủ dữ liệu để kết luận | ${ev.counts[1]} |`,
      `| 🛠 Cần tối ưu | Đủ chi tiêu, có 1–2 chỉ số xấu hơn mặt bằng nhóm (ghi rõ chỉ số cần tối ưu) | ${ev.counts[2]} |`,
      `| ⛔ Chưa hiệu quả | Đủ chi tiêu nhưng chưa có đơn, hoặc cả 3 chỉ số đều xấu hơn mặt bằng nhóm | ${ev.counts[3]} |`, '',
      '**3 chỉ số xét tối ưu:** (1) CPA cao hơn CPA nhóm → giảm chi phí mỗi đơn (đổi hook/creative, thu hẹp tệp, dừng nhóm kém); (2) NS/DT cao hơn nhóm → chi nhiều so với doanh thu (tăng giá trị đơn/combo hoặc giảm ngân sách); (3) tỷ lệ đơn/lead thấp hơn nhóm → lead chưa chốt được (cải thiện kịch bản tư vấn, chất lượng lead).', '');
  }
  L.push('```', '');
  const need = ev.items.filter((i) => i.k === 2 || i.k === 3).sort((a, b) => b.sp - a.sp).slice(0, 10);
  if (need.length) {
    L.push('### Content cần tối ưu / chưa hiệu quả — chỉ số cần cải thiện', '', '| Content | Người | Chi tiêu (đ) | Mức | Chỉ số cần tối ưu |', '|---|---|---|---|---|');
    for (const i of need) L.push(`| ${i.n.length > 48 ? i.n.slice(0, 47) + '…' : i.n} | ${i.o === OTHER ? 'Khác' : i.o} | ${vnd(i.sp)} | ${LEVELS[i.k]} | ${i.od === 0 ? 'Chưa có đơn nào' : i.bad.map((b) => b.text).join('; ')} |`);
    L.push('');
  }
  return L.join('\n');
}

// Bảng + biểu đồ so sánh các từ khoá (markdown; khối ```chart do report.js tự vẽ).
export function keywordSummaryMarkdown(stats, info, periodLabel, link = false) {
  const vnd = (n) => Math.round(n).toLocaleString('vi-VN');
  const pct = (a, b) => (b ? `${(a / b * 100).toFixed(1).replace('.', ',')}%` : '–');
  const x = (v) => (v == null ? '–' : vnd(v));
  const chart = (spec) => '```chart\n' + JSON.stringify(spec) + '\n```';
  const labels = stats.map((t) => t.k), all = info?.spendAll || 0;
  const L = [`## So sánh hiệu quả theo từ khoá (${labels.join(' vs ')})${periodLabel ? ` — ${periodLabel}` : ''}`, '',
    'Quảng cáo được xếp vào từ khoá khi TÊN quảng cáo chứa từ khoá đó (quảng cáo chứa nhiều từ khoá được tính ở mỗi từ khoá).', '',
    '| Từ khoá | Quảng cáo | Chi tiêu (đ) | % chi tiêu | Doanh thu (đ) | NS/DT | ROAS | Đơn | CPA (đ) | Lead | CPL (đ) | CTR |', '|---|---|---|---|---|---|---|---|---|---|---|---|'];
  for (const t of stats) L.push(`| ${t.k} | ${t.n} | ${vnd(t.sp)} | ${pct(t.sp, all)} | ${vnd(t.rv)} | ${t.ns == null ? '–' : pct(t.sp, t.rv)} | ${t.roas == null ? '–' : t.roas.toFixed(2).replace('.', ',')} | ${t.od} | ${x(t.cpa)} | ${t.ld} | ${x(t.cpl)} | ${t.ctr == null ? '–' : (t.ctr * 100).toFixed(2).replace('.', ',') + '%'} |`);
  L.push('');
  if (stats.length && stats.every((t) => !t.n)) L.push('**Không có quảng cáo nào có tên chứa các từ khoá này trong kỳ** — kiểm tra lại chính tả từ khoá (cấu hình ở 📊 Dữ liệu Enzy).', '');
  if (stats.length) {
    L.push(chart({ type: 'bar', title: 'Chi tiêu và doanh thu theo từ khoá', labels, series: [{ name: 'Chi tiêu', data: stats.map((t) => Math.round(t.sp)) }, { name: 'Doanh thu', data: stats.map((t) => Math.round(t.rv)) }], unit: 'đ' }), '');
    L.push(chart({ type: 'bar', title: 'CPA và CPL theo từ khoá', labels, series: [{ name: 'CPA', data: stats.map((t) => Math.round(t.cpa || 0)) }, { name: 'CPL', data: stats.map((t) => Math.round(t.cpl || 0)) }], unit: 'đ' }), '');
  }
  for (const t of stats) if (t.top.length) L.push(`**Top quảng cáo ${t.k}:** ` + t.top.map((a) => `${a.n.length > 60 ? a.n.slice(0, 59) + '…' : a.n} (DT ${(a.rv / 1e6).toFixed(1).replace('.', ',')} tr, ${a.od} đơn)`).join(' · '), '');
  if (link) L.push('[📈 Mở Dashboard content (lọc, sắp xếp, xem từng quảng cáo)]({{DASH}})', '');
  return L.join('\n');
}

export function groupByOwner(ads, owners) {
  const want = new Map(owners.map((o) => [plain(o), o.trim().toUpperCase()]));
  const map = new Map();
  let total = 0, owned = 0;
  for (const a of ads) {
    total += a.sp;
    const tag = ownerOf(a.name), label = want.get(plain(tag));
    if (label) owned += a.sp;
    const grp = label || OTHER, content = contentOf(a.name), key = `${grp}|${content}`;
    if (!map.has(key)) map.set(key, { o: grp, who: [], n: content, sp: 0, im: 0, ck: 0, lk: 0, od: 0, ld: 0, rv: 0, ad: 0, ads: [] });
    const g = map.get(key);
    if (!label) { const w = tag && !/^\d+$/.test(tag) ? tag.toUpperCase() : 'chưa gắn tên'; if (!g.who.includes(w)) g.who.push(w); }
    for (const k of ['sp', 'im', 'ck', 'lk', 'od', 'ld', 'rv']) g[k] += a[k];
    if (a.sp > 0) g.ad++;
    g.ads.push({ a: a.account, n: a.name, sp: a.sp, od: a.od, rv: a.rv });
  }
  const rows = [...map.values()].filter((g) => g.sp > 0);
  for (const g of rows) { g.ads.sort((x, y) => y.sp - x.sp); g.who = g.who.join(', '); }
  const names = [...new Set([...want.values()])];
  if (rows.some((g) => g.o === OTHER)) names.push(OTHER);
  return { rows, total, owned, owners: names, listed: [...new Set([...want.values()])] };
}

// Bảng so sánh các nhóm người thực hiện dạng markdown (đưa thẳng vào báo cáo tuần/tháng và cho #analyst đọc). {{DASH}} = đường dẫn tới dashboard.
export function ownerSummaryMarkdown(g, periodLabel) {
  const vnd = (n) => Math.round(n).toLocaleString('vi-VN');
  const pct = (a, b) => (b ? `${(a / b * 100).toFixed(1).replace('.', ',')}%` : '–');
  const sum = (rows) => rows.reduce((t, r) => ({ sp: t.sp + r.sp, rv: t.rv + r.rv, od: t.od + r.od, ld: t.ld + r.ld, n: t.n + 1 }), { sp: 0, rv: 0, od: 0, ld: 0, n: 0 });
  const all = sum(g.rows);
  const line = (name, t) => `| ${name} | ${pct(t.sp, all.sp)} | ${t.n} | ${vnd(t.sp)} | ${vnd(t.rv)} | ${pct(t.sp, t.rv)} | ${t.od} | ${t.od ? vnd(t.sp / t.od) : '–'} | ${t.ld} | ${t.ld ? vnd(t.sp / t.ld) : '–'} |`;
  const L = [`## So sánh người thực hiện${periodLabel ? ` — ${periodLabel}` : ''}`, '',
    'Gán theo tên người ở cuối tên quảng cáo; người khác hoặc chưa gắn tên gộp thành "Người còn lại".', '',
    ...(g.kw?.list?.length ? [`**Chỉ tính quảng cáo có từ khoá trong tên: ${g.kw.list.join(', ')}** — ${g.kw.matched}/${g.kw.all} quảng cáo, chi tiêu ${vnd(g.kw.spendMatched)}/${vnd(g.kw.spendAll)} đ (${pct(g.kw.spendMatched, g.kw.spendAll)} tổng chi tiêu), doanh thu ${vnd(g.kw.revMatched || 0)}/${vnd(g.kw.revAll || 0)} đ. **Doanh thu toàn tài khoản (mọi quảng cáo): ${vnd(g.kw.revAll || 0)} đ.**`, ''] : []),
    '| Nhóm | % chi tiêu | Content | Chi tiêu (đ) | Doanh thu (đ) | NS/DT | Đơn | CPA (đ) | Lead | CPL (đ) |', '|---|---|---|---|---|---|---|---|---|---|'];
  for (const o of g.owners) L.push(line(o === OTHER ? 'Người còn lại' : o, sum(g.rows.filter((r) => r.o === o))));
  L.push(line(g.kw?.list?.length ? '**Tổng quảng cáo khớp từ khoá**' : '**Toàn bộ tài khoản**', all), '');
  for (const o of g.listed) {
    const top = g.rows.filter((r) => r.o === o).sort((a, b) => b.rv - a.rv).slice(0, 3);
    if (top.length) L.push(`**Top content ${o}:** ` + top.map((r) => `${r.n} (DT ${(r.rv / 1e6).toFixed(1).replace('.', ',')} tr, NS/DT ${pct(r.sp, r.rv)}, ${r.od} đơn)`).join(' · '), '');
  }
  L.push('[📈 Mở Dashboard content (lọc, sắp xếp, xem từng quảng cáo)]({{DASH}})', '');
  return L.join('\n');
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const json = (o) => JSON.stringify(o).replace(/</g, '\\u003c').replace(new RegExp('[\\u2028\\u2029]', 'g'), ' ');

const CSS = `:root{--bg:#f4f6f8;--panel:#fff;--ink:#16202b;--mute:#5d6b7a;--line:#dde3ea;--spend:#8aa1b8;--rev:#1f5fbf;--good:#14795f;--goodbg:#d9f1e9;--bad:#b3261e;--badbg:#fbe0dd;--warn:#8a5a00;--warnbg:#fbeccb;--mid:#a15c00;--midbg:#fde4cc;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#10151b;--panel:#1a222b;--ink:#e8edf2;--mute:#9aa8b6;--line:#2c3743;--spend:#5f7893;--rev:#6ea2f0;--good:#5fd1b0;--goodbg:#14352c;--bad:#ff9b92;--badbg:#3d1d1b;--warn:#f0c463;--warnbg:#3a2e10;--mid:#ffb867;--midbg:#3b2a12;color-scheme:dark}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:400 15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;font-variant-numeric:tabular-nums}
main{max-width:1080px;margin:0 auto;padding:28px 18px 48px}
header{display:flex;flex-wrap:wrap;justify-content:space-between;gap:6px 16px;align-items:baseline;border-bottom:1px solid var(--line);padding-bottom:14px}
h1{font-size:20px;font-weight:700;margin:0}.sub{color:var(--mute);font-size:13px}
.hero{padding:26px 0 20px}.hero p{font-size:clamp(24px,5vw,38px);line-height:1.15;font-weight:700;margin:0;max-width:22em;letter-spacing:-.01em}
.hero .n{color:var(--rev)}.hero small{display:block;margin-top:10px;font-size:14px;color:var(--mute);font-weight:400}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(138px,1fr));border:1px solid var(--line);background:var(--panel);border-radius:8px}
.kpi{padding:14px 16px;border-right:1px solid var(--line);border-bottom:1px solid var(--line);margin:0 -1px -1px 0}
.kpi b{display:block;font-size:21px;font-weight:600}.kpi span{font-size:12.5px;color:var(--mute)}
h2{font-size:16px;margin:34px 0 4px;font-weight:600}.note{color:var(--mute);font-size:13px;margin:0 0 12px}
.critpanel{background:#0d2540;color:#fff;border:3px solid #ffc83d;border-radius:14px;padding:18px 20px 20px;margin:22px 0 8px;box-shadow:0 6px 22px rgba(13,37,64,.35)}
.critpanel h2{margin:0 0 4px;font-size:20px;color:#ffc83d;font-weight:800}.critpanel .cs{color:#cfe0f5;font-size:13.5px;margin:0 0 14px}
.critpanel .th{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 14px}.critpanel .th span{background:#173a63;border:1px solid #2f5f96;border-radius:8px;padding:6px 10px;font-size:13.5px}.critpanel .th b{color:#ffc83d}
.critpanel .lv{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:10px}
.critpanel .lc{border-radius:10px;padding:12px 14px;color:#fff;border:2px solid rgba(255,255,255,.35)}.critpanel .lc>b{display:block;font-size:15px;margin-bottom:4px}.critpanel .lc p b{display:inline;font-size:inherit;margin:0}.critpanel .lc p{margin:0;font-size:13px;line-height:1.4}.critpanel .lc .ct{float:right;font-size:22px;font-weight:800}
.lc.l0{background:#0d7a4f}.lc.l1{background:#5b6b7e}.lc.l2{background:#b45309}.lc.l3{background:#b3261e}
.critpanel .hint{margin:14px 0 0;font-size:13px;color:#cfe0f5;line-height:1.5}.critpanel .hint b{color:#fff}
.why{margin:6px 0 0;font-size:12.5px;color:var(--mute)}.why b{color:var(--bad)}.why.w2{background:var(--warnbg);color:var(--warn);border-radius:6px;padding:4px 8px}.why.w2 b{color:var(--warn)}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0 14px}.chips[hidden]{display:none}.chl{align-self:center;font-size:12.5px;font-weight:700;color:var(--mute)}.kwc{border-color:#ffc83d;border-width:2px}.kwc[aria-pressed="true"]{background:#ffc83d;color:#0d2540;border-color:#ffc83d;font-weight:700}
.chip{border:1px solid var(--line);background:var(--panel);color:var(--ink);border-radius:999px;padding:6px 14px;font:inherit;font-size:13px;cursor:pointer}
.chip[aria-pressed="true"]{background:var(--ink);color:var(--bg);border-color:var(--ink)}
.chip:focus-visible,th button:focus-visible{outline:2px solid var(--rev);outline-offset:2px}
.row{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:14px 16px;margin-bottom:10px;display:grid;grid-template-columns:minmax(0,1fr) 190px;gap:8px 22px}
.row h3{margin:0 0 8px;font-size:14.5px;font-weight:600;overflow-wrap:anywhere}
.bar{display:flex;align-items:center;gap:8px;margin:4px 0;font-size:12.5px}.bar i{display:block;height:12px;border-radius:2px;min-width:2px}
.bar .sp{background:var(--spend)}.bar .rv{background:var(--rev)}.bar em{font-style:normal;color:var(--mute);white-space:nowrap}
.side{font-size:13px;display:grid;grid-template-columns:1fr auto;gap:2px 8px;align-content:start}.side span{color:var(--mute)}.side b{text-align:right}
.hi{color:var(--bad)}.lo{color:var(--good)}
.badge{display:inline-block;font-size:12px;font-weight:600;padding:2px 9px;border-radius:999px;margin-left:8px;vertical-align:1px}
.own{display:inline-block;font-size:11px;font-weight:700;padding:1px 8px;border-radius:4px;margin-right:8px;background:var(--line);color:var(--ink);vertical-align:1px}
.b0{background:var(--goodbg);color:var(--good)}.b1{background:var(--warnbg);color:var(--warn)}.b2{background:var(--midbg);color:var(--mid)}.b3{background:var(--badbg);color:var(--bad)}
.legend{display:flex;gap:16px;font-size:12.5px;color:var(--mute);margin-bottom:10px}.legend i{display:inline-block;width:11px;height:11px;border-radius:2px;margin-right:5px;vertical-align:-1px}
.tw{overflow-x:auto;border:1px solid var(--line);border-radius:8px;background:var(--panel)}
table{border-collapse:collapse;width:100%;min-width:980px;font-size:13px}
th,td{padding:9px 11px;text-align:right;border-bottom:1px solid var(--line);white-space:nowrap}
th:first-child,td:first-child{text-align:left;white-space:normal;min-width:210px}
th{font-weight:600;color:var(--mute)}th button{all:unset;cursor:pointer}th button:hover{color:var(--ink)}
tfoot td,tr.tot td{font-weight:600;border-bottom:0;background:var(--bg)}
.cmpcards{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px;margin-bottom:14px}
.cc{padding:14px 16px}.cc h3{margin:0 0 8px;font-size:15px}.cc .sub{font-weight:400;font-size:12.5px}
.cc .side{margin-top:8px}td.c{text-align:center}
details{grid-column:1/-1;font-size:12.5px;color:var(--mute)}summary{cursor:pointer}
details table{min-width:0;margin-top:6px}details td{white-space:normal;font-size:12px;padding:5px 8px}
.foot{margin-top:26px;color:var(--mute);font-size:12.5px}.foot p{margin:4px 0}
@media (max-width:640px){.row{grid-template-columns:1fr}}`;

// Mã chạy trong trang (không phụ thuộc thư viện). DATA = { title, sub, owners, rows, coverage }.
const APP = `
var NA="N/A",$=function(i){return document.getElementById(i)};
function esc(s){return String(s).replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]})}
function sum(a,k){return a.reduce(function(s,x){return s+x[k]},0)}
function div(a,b){return b>0?a/b:null}
function num(n){return n==null?NA:Math.round(n).toLocaleString("vi-VN")}
function pct(n,d){return n==null?NA:(n*100).toLocaleString("vi-VN",{minimumFractionDigits:d,maximumFractionDigits:d})+"%"}
function mil(n){return (n/1e6).toLocaleString("vi-VN",{minimumFractionDigits:2,maximumFractionDigits:2})+" tr"}
function calc(x){x.ctr=div(x.ck,x.im);x.ctl=div(x.lk,x.im);x.cpa=div(x.sp,x.od);x.cpl=div(x.sp,x.ld);x.ns=div(x.sp,x.rv);x.cv=div(x.od,x.ld);return x}
function tot(a){return calc({sp:sum(a,"sp"),im:sum(a,"im"),ck:sum(a,"ck"),lk:sum(a,"lk"),od:sum(a,"od"),ld:sum(a,"ld"),rv:sum(a,"rv"),ad:sum(a,"ad")})}
var ALL=DATA.rows.map(calc),OW=DATA.owners,own="ALL",D=[],T=null,MED=0,flt=-1,sortK="rv",asc=false;
var TL={cpa:"CPA",rev:"Doanh thu",ns:"NS/DT",cpl:"CPL"},OPV={"<":"<","<=":"≤",">":">",">=":"≥"};
function cmpOp(a,op,b){return op=="<"?a<b:op=="<="?a<=b:op==">"?a>b:a>=b}
var LAB=["Content hiệu quả","Cần theo dõi","Cần tối ưu","Chưa hiệu quả"],CL=["b0","b1","b2","b3"];
var kwsel="";
function inOwn(x){return own=="ALL"||x.o==own}
function scope(){return ALL.filter(function(x){return inOwn(x)&&(!kwsel||(x.kws||[]).indexOf(kwsel)>=0)})}
function label(){var b=own=="ALL"?(DATA.mode=="kw"?"các từ khoá đang lọc":"toàn bộ tài khoản"):own=="KHÁC"?"nhóm người còn lại":own;return kwsel?b+" · từ khoá "+kwsel:b}
function prep(){
  D=scope();T=tot(D);
  var sp=D.map(function(x){return x.sp}).sort(function(a,b){return a-b}),h=sp.length>>1;MED=sp.length?(sp.length%2?sp[h]:(sp[h-1]+sp[h])/2):0;
  D.forEach(function(x){
    x.bad=[];
    var tg=DATA.targets||[];
    if(tg.length){
      var val={cpa:x.cpa,rev:x.rv,ns:x.ns,cpl:x.cpl};
      tg.forEach(function(t){var v=val[t.k];if(v!=null&&cmpOp(v,t.op,t.v))return;var money=t.k!="ns";x.bad.push(TL[t.k]+" "+(v==null?"chưa có số liệu":(money?num(v)+"đ":pct(v,1)))+" (mục tiêu "+OPV[t.op]+" "+(money?num(t.v)+"đ":pct(t.v,1))+")")});
      var s2=x.bad.length;x.sig=s2;x.k=x.sp<MED?1:(x.od==0?3:(s2==0?0:(s2>=tg.length?3:2)));
      return;
    }
    if(x.cpa!=null&&T.cpa!=null&&x.cpa>T.cpa)x.bad.push("CPA "+num(x.cpa)+"đ (ngưỡng "+num(T.cpa)+"đ)");
    if(x.ns!=null&&T.ns!=null&&x.ns>T.ns)x.bad.push("NS/DT "+pct(x.ns,1)+" (ngưỡng "+pct(T.ns,1)+")");
    if(x.cv!=null&&T.cv!=null&&x.cv<T.cv)x.bad.push("Tỷ lệ đơn/lead "+pct(x.cv,1)+" (ngưỡng "+pct(T.cv,1)+")");
    var s=x.bad.length;x.sig=s;x.k=x.sp<MED?1:(x.od==0?3:(s==0?0:(s>=3?3:2)));
  });
}
function why(x){
  if(x.k==2)return '<div class="why w2"><b>Cần tối ưu chỉ số:</b> '+x.bad.map(esc).join(" · ")+'</div>';
  if(x.k==3)return '<div class="why"><b>Chưa hiệu quả:</b> '+(x.od==0?"chi tiêu đủ lớn nhưng chưa có đơn nào":((DATA.targets||[]).length?"không đạt mục tiêu nào — ":"cả 3 chỉ số đều kém hơn mặt bằng — ")+x.bad.map(esc).join(" · "))+'</div>';
  if(x.k==1)return '<div class="why">Chi tiêu '+mil(x.sp)+' thấp hơn trung vị '+mil(MED)+' — chưa đủ dữ liệu để kết luận</div>';
  return '<div class="why">'+((DATA.targets||[]).length?"Đạt tất cả mục tiêu Hiệu quả content":"Đạt cả 3 chỉ số so với mặt bằng của nhóm")+'</div>';
}
function crit(){
  var n=[0,0,0,0];D.forEach(function(x){n[x.k]++});
  var tg=DATA.targets||[],hasT=tg.length>0;
  var th="";
  if(hasT)th='<span>Hiệu quả khi đạt <b>TẤT CẢ</b>:</span>'+tg.map(function(t){var money=t.k!="ns";return '<span>'+TL[t.k]+' <b>'+OPV[t.op]+' '+(money?num(t.v)+"đ":pct(t.v,1))+'</b></span>'}).join("")+(D.length?'<span>Chi tiêu trung vị: <b>'+mil(MED)+'</b></span>':"");
  else th=D.length?('<span>Chi tiêu trung vị: <b>'+mil(MED)+'</b></span><span>CPA nhóm: <b>'+(T.cpa==null?NA:num(T.cpa)+"đ")+'</b></span><span>NS/DT nhóm: <b>'+pct(T.ns,1)+'</b></span><span>Tỷ lệ đơn/lead nhóm: <b>'+pct(T.cv,1)+'</b></span>'):"";
  var L=hasT?[["Hiệu quả","Đủ chi tiêu (≥ trung vị) và đạt <b>tất cả</b> mục tiêu đã cấu hình."],["Cần theo dõi","Chi tiêu <b>dưới trung vị</b> của nhóm: chưa đủ dữ liệu để kết luận, tiếp tục theo dõi."],["Cần tối ưu","Đủ chi tiêu nhưng chỉ đạt <b>một phần</b> mục tiêu. Mỗi content ghi rõ <b>chỉ số chưa đạt</b>."],["Chưa hiệu quả","Đủ chi tiêu nhưng <b>chưa có đơn</b>, hoặc <b>không đạt mục tiêu nào</b>."]]:
   [["Hiệu quả","Đủ chi tiêu (≥ trung vị) và <b>không</b> có chỉ số nào xấu hơn mặt bằng nhóm."],["Cần theo dõi","Chi tiêu <b>dưới trung vị</b> của nhóm: chưa đủ dữ liệu để kết luận, tiếp tục theo dõi."],["Cần tối ưu","Đủ chi tiêu và có <b>1–2</b> chỉ số xấu hơn mặt bằng nhóm. Mỗi content ghi rõ <b>chỉ số cần tối ưu</b>."],["Chưa hiệu quả","Đủ chi tiêu nhưng <b>chưa có đơn</b>, hoặc <b>cả 3</b> chỉ số đều xấu hơn mặt bằng nhóm."]];
  var hint=hasT?'<p class="hint"><b>Mục tiêu do bạn cấu hình</b> (📊 Dữ liệu Enzy → "Hiệu quả content"): content được xét theo đúng các điều kiện trên, không so với mặt bằng nhóm. Chỉ số chưa đạt được ghi ngay dưới từng content.</p>':
   '<p class="hint"><b>3 chỉ số xét tối ưu:</b> (1) <b>CPA</b> cao hơn CPA nhóm → giảm chi phí mỗi đơn (đổi hook/creative, thu hẹp tệp, dừng nhóm kém); (2) <b>NS/DT</b> cao hơn nhóm → chi nhiều so với doanh thu (tăng giá trị đơn/combo hoặc giảm ngân sách); (3) <b>Tỷ lệ đơn/lead</b> thấp hơn nhóm → lead chưa chốt được (cải thiện kịch bản tư vấn, chất lượng lead). Muốn đặt mục tiêu riêng (vd CPA &lt; 170.000đ): cấu hình ở 📊 Dữ liệu Enzy.</p>';
  $("crit").innerHTML='<h2>📏 Tiêu chí &amp; ngưỡng đánh giá content</h2><p class="cs">Áp dụng cho <b>'+esc(label())+'</b> ('+D.length+' content). '+(hasT?'Đánh giá theo <b>mục tiêu bạn đã cấu hình</b>.':'Ngưỡng là mặt bằng của chính nhóm đang xem (đổi nhóm → ngưỡng đổi theo), chưa phải KPI mục tiêu.')+'</p>'+
   '<div class="th">'+th+'</div><div class="lv">'+L.map(function(l,i){return '<div class="lc l'+i+'"><span class="ct">'+n[i]+'</span><b>'+l[0]+'</b><p>'+l[1]+'</p></div>'}).join("")+'</div>'+hint;
}
function chips(){
  var po=[["ALL","Tất cả ("+ALL.length+")"]].concat(OW.map(function(o){return [o,o+" ("+ALL.filter(function(x){return x.o==o}).length+")"]}));
  $("owners").innerHTML=po.map(function(c){return '<button class="chip" data-o="'+esc(c[0])+'" aria-pressed="'+(own==c[0])+'">'+esc(c[1])+'</button>'}).join("");
  var KW=DATA.kw||[];
  $("kwchips").hidden=!KW.length||DATA.mode=="kw";
  if(!$("kwchips").hidden)$("kwchips").innerHTML='<span class="chl">Lọc nhanh theo từ khoá:</span>'+[["","Tất cả"]].concat(KW.map(function(k){return [k,k]})).map(function(c){var n=ALL.filter(function(x){return inOwn(x)&&(!c[0]||(x.kws||[]).indexOf(c[0])>=0)}).length;return '<button class="chip kwc" data-w="'+esc(c[0])+'" aria-pressed="'+(kwsel==c[0])+'">'+esc(c[1])+' ('+n+')</button>'}).join("");
  var CH=[["Tất cả",-1]].concat(LAB.map(function(l,i){return [l,i]}));
  $("chips").innerHTML=CH.map(function(c){var n=c[1]<0?D.length:D.filter(function(x){return x.k==c[1]}).length;return '<button class="chip" data-k="'+c[1]+'" aria-pressed="'+(flt==c[1])+'">'+c[0]+' ('+n+')</button>'}).join("");
}
function head(){
  crit();
  var n=D.reduce(function(s,x){return s+x.ad},0);
  $("sub").textContent=DATA.period+" · "+n+" quảng cáo, "+D.length+" content";
  if(!D.length){$("hero").innerHTML='Chưa có quảng cáo có chi tiêu cho <span class="n">'+esc(label())+'</span> trong kỳ này.';$("kpis").innerHTML="";return}
  $("hero").innerHTML='Cứ 100đ doanh thu, '+esc(label())+' chi <span class="n">'+(T.ns==null?NA:Math.round(T.ns*100)+'đ')+'</span>.<small>Chi '+mil(T.sp)+' cho doanh thu '+mil(T.rv)+', được '+T.od+' đơn và '+T.ld+' lead.'+(DATA.acct?'<br><b>Toàn tài khoản (tất cả '+DATA.acct.ads+' quảng cáo, mọi người thực hiện): doanh thu '+mil(DATA.acct.rev)+', chi '+mil(DATA.acct.sp)+'.</b>':'')+'</small>';
  var K=[["Ngân sách đã chi",mil(T.sp)],["Doanh thu",mil(T.rv)],["Ngân sách/Doanh thu",pct(T.ns,1)],["CPA",T.cpa==null?NA:num(T.cpa)+"đ"],["CPL",T.cpl==null?NA:num(T.cpl)+"đ"],["CTR",pct(T.ctr,2)],["CTR link",pct(T.ctl,2)],["Lượt mua / Lead",T.od+" / "+T.ld]];
  $("kpis").innerHTML=K.map(function(k){return '<div class="kpi"><b>'+k[1]+'</b><span>'+k[0]+'</span></div>'}).join("");
}
function compare(){
  var rows=OW.map(function(o){var a=ALL.filter(function(x){return x.o==o});var t=tot(a);t.n=o=="KHÁC"?"Người còn lại":o;t.cnt=a.length;return t});
  var all=tot(ALL);all.n=DATA.mode=="kw"?"Tổng các từ khoá":"Toàn bộ tài khoản";all.cnt=ALL.length;
  var mxs=Math.max.apply(null,rows.map(function(t){return Math.max(t.sp,t.rv)}).concat([1]));
  $("cmpcards").innerHTML=rows.map(function(t){
    var ns=t.ns==null||all.ns==null?"":(t.ns>all.ns?"hi":"lo"),cp=t.cpa==null||all.cpa==null?"":(t.cpa>all.cpa?"hi":"lo");
    return '<div class="card cc"><h3>'+esc(t.n)+'<span class="sub"> · '+pct(div(t.sp,all.sp),0)+' chi tiêu</span></h3>'+
    '<div class="bar"><i class="sp" style="width:'+(t.sp/mxs*100*.7)+'%"></i><em>'+mil(t.sp)+'</em></div>'+
    '<div class="bar"><i class="rv" style="width:'+(t.rv/mxs*100*.7)+'%"></i><em>'+mil(t.rv)+'</em></div>'+
    '<div class="side"><span>NS/DT</span><b class="'+ns+'">'+pct(t.ns,1)+'</b><span>CPA</span><b class="'+cp+'">'+(t.cpa==null?NA:num(t.cpa)+"đ")+'</b><span>CPL</span><b>'+(t.cpl==null?NA:num(t.cpl)+"đ")+'</b><span>Đơn / lead</span><b>'+t.od+" / "+t.ld+'</b></div></div>'}).join("");
  var one=function(t,b){return '<tr'+(b?' class="tot"':'')+'><td>'+esc(t.n)+'</td><td>'+pct(div(t.sp,all.sp),1)+'</td><td>'+t.cnt+'</td><td>'+t.ad+'</td><td>'+num(t.sp)+'</td><td>'+num(t.rv)+'</td><td>'+pct(t.ns,1)+'</td><td>'+t.od+'</td><td>'+(t.cpa==null?NA:num(t.cpa))+'</td><td>'+t.ld+'</td><td>'+(t.cpl==null?NA:num(t.cpl))+'</td><td>'+pct(t.cv,1)+'</td><td>'+pct(t.ctr,2)+'</td></tr>'};
  $("cmp").innerHTML='<tr><th>'+(DATA.mode=="kw"?"Từ khoá":"Nhóm")+'</th><th>% chi tiêu</th><th>Content</th><th>Quảng cáo</th><th>Chi tiêu</th><th>Doanh thu</th><th>NS/DT</th><th>Lượt mua</th><th>CPA</th><th>Lead</th><th>CPL</th><th>Đơn/Lead</th><th>CTR</th></tr>'+rows.map(function(t){return one(t,false)}).join("")+one(all,true);
}
function draw(){
  var L=D.filter(function(x){return flt<0||x.k==flt}).sort(function(a,b){var u=a[sortK],v=b[sortK];if(u==null)return 1;if(v==null)return -1;var r=typeof u=="string"?u.localeCompare(v):u-v;return asc?r:-r});
  var mx=Math.max.apply(null,D.map(function(x){return Math.max(x.sp,x.rv)}).concat([1]));
  $("rows").innerHTML=L.map(function(x){
    var cp=x.cpa==null||T.cpa==null?"":(x.cpa>T.cpa?"hi":"lo"),nn=x.ns==null||T.ns==null?"":(x.ns>T.ns?"hi":"lo");
    var ads='<details><summary>'+x.ads.length+' quảng cáo</summary><table><tbody>'+x.ads.map(function(a){return '<tr><td>'+esc(a.n)+'</td><td>'+esc(a.a)+'</td><td>'+num(a.sp)+'</td><td>'+a.od+' đơn</td><td>'+num(a.rv)+'</td></tr>'}).join("")+'</tbody></table></details>';
    return '<div class="row"><div><h3><span class="own">'+esc(x.o)+(x.who?' · '+esc(x.who):'')+'</span>'+esc(x.n)+'<span class="badge '+CL[x.k]+'">'+LAB[x.k]+'</span></h3>'+
    '<div class="bar"><i class="sp" style="width:'+(x.sp/mx*100*.72)+'%"></i><em>'+mil(x.sp)+'</em></div>'+
    '<div class="bar"><i class="rv" style="width:'+(x.rv/mx*100*.72)+'%"></i><em>'+mil(x.rv)+'</em></div>'+why(x)+'</div>'+
    '<div class="side"><span>NS/DT</span><b class="'+nn+'">'+pct(x.ns,1)+'</b><span>CPA</span><b class="'+cp+'">'+(x.cpa==null?NA:num(x.cpa)+"đ")+'</b><span>CPL</span><b>'+(x.cpl==null?NA:num(x.cpl)+"đ")+'</b><span>Đơn / lead</span><b>'+x.od+" / "+x.ld+'</b></div>'+ads+'</div>';
  }).join("")||'<p class="note">Không có content nào trong nhóm này.</p>';
  $("thead").innerHTML='<tr>'+COLS.map(function(c){return '<th aria-sort="'+(c[0]==sortK?(asc?"ascending":"descending"):"none")+'"><button data-k="'+c[0]+'">'+c[1]+(c[0]==sortK?(asc?" ▲":" ▼"):"")+'</button></th>'}).join("")+'</tr>';
  $("tbody").innerHTML=L.map(function(x){return '<tr>'+COLS.map(function(c){return '<td'+(c[0]=="k"?' class="c"':"")+'>'+cell(c[0],x)+'</td>'}).join("")+'</tr>'}).join("");
  var t=tot(L);t.n="Tổng ("+L.length+" content)";t.o="";t.k=-1;
  $("tfoot").innerHTML='<tr>'+COLS.map(function(c){return '<td>'+(c[0]=="k"?"":cell(c[0],t))+'</td>'}).join("")+'</tr>';
}
function all(){prep();head();chips();draw()}
$("owners").onclick=function(e){var b=e.target.closest(".chip");if(!b)return;own=b.dataset.o;flt=-1;all()};
$("kwchips").onclick=function(e){var b=e.target.closest(".chip");if(!b)return;kwsel=b.dataset.w;flt=-1;all()};
$("chips").onclick=function(e){var b=e.target.closest(".chip");if(!b)return;flt=+b.dataset.k;chips();draw()};
$("thead").onclick=function(e){var b=e.target.closest("button");if(!b)return;var k=b.dataset.k;if(k==sortK)asc=!asc;else{sortK=k;asc=(k=="n"||k=="o"||k=="cpa"||k=="cpl"||k=="ns")}draw()};
compare();all();
`;

/**
 * data: { title, period, updated, kindLabel, owners, rows, total, owned } (kết quả groupByOwner + thông tin kỳ).
 * Trả về chuỗi HTML hoàn chỉnh, không gọi tài nguyên ngoài.
 */
export function buildOwnerDashboard(data) {
  const kwMode = data.mode === 'kw';
  const share = data.total ? Math.round((data.owned / data.total) * 100) : 0;
  const kwList = data.kw?.list || [];
  const rowsOut = data.rows.map((r) => ({ ...r, kws: [...new Set(r.ads.flatMap((a) => keywordsOf(a.n, kwList)))] }));   // từ khoá có trong tên (ít nhất một quảng cáo của content) → nút lọc nhanh
  const payload = { period: data.period, owners: data.owners, rows: rowsOut, mode: data.mode || 'owner', kw: kwList, targets: normTargets(data.targets), acct: kwList.length && data.kw ? { rev: data.kw.revAll || 0, sp: data.kw.spendAll || 0, ads: data.kw.all || 0 } : null };   // acct = tổng TOÀN tài khoản (trước khi lọc từ khoá)
  const vnd = (n) => Math.round(n).toLocaleString('vi-VN');
  const pc = (n, d = 1) => (n == null ? '–' : `${(n * 100).toFixed(d).replace('.', ',')}%`);
  // Phần "So sánh hiệu quả theo từ khoá" (tĩnh, SVG): khi lọc cả từ khoá lẫn người thực hiện.
  const kwBlock = (() => {
    const st = data.kwStats;
    if (kwMode || !st?.length) return '';
    const W = 760, H = 24 * st.length * 2 + 40, mx = Math.max(1, ...st.flatMap((t) => [t.sp, t.rv])), bw = (v) => Math.max(2, (v / mx) * (W - 230));
    const bars = st.map((t, i) => { const y = 14 + i * 56; return `<text x="0" y="${y + 14}" font-weight="700" font-size="13" fill="currentColor">${esc(t.k)}</text><rect x="110" y="${y}" width="${bw(t.sp)}" height="18" rx="4" fill="var(--spend)"/><text x="${116 + bw(t.sp)}" y="${y + 13}" font-size="12" fill="currentColor">${esc(vnd(t.sp / 1e3))}k</text><rect x="110" y="${y + 22}" width="${bw(t.rv)}" height="18" rx="4" fill="var(--rev)"/><text x="${116 + bw(t.rv)}" y="${y + 35}" font-size="12" fill="currentColor">${esc(vnd(t.rv / 1e3))}k</text>`; }).join('');
    const rows = st.map((t) => `<tr><td>${esc(t.k)}</td><td>${t.n}</td><td>${vnd(t.sp)}</td><td>${vnd(t.rv)}</td><td>${pc(ratio(t.sp, t.rv))}</td><td>${t.roas == null ? '–' : t.roas.toFixed(2).replace('.', ',')}</td><td>${t.od}</td><td>${t.cpa == null ? '–' : vnd(t.cpa)}</td><td>${t.ld}</td><td>${t.cpl == null ? '–' : vnd(t.cpl)}</td><td>${pc(t.ctr, 2)}</td></tr>`).join('');
    return `<h2>So sánh hiệu quả theo từ khoá (${esc(st.map((t) => t.k).join(' vs '))})</h2>
<p class="note">Quảng cáo thuộc từ khoá khi tên quảng cáo chứa từ khoá đó (quảng cáo chứa nhiều từ khoá được tính ở mỗi từ khoá). Số liệu gồm mọi người thực hiện; phần bên dưới vẫn so sánh theo người.</p>
<div class="legend"><span><i style="background:var(--spend)"></i>Chi tiêu</span><span><i style="background:var(--rev)"></i>Doanh thu</span></div>
<div class="tw"><svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W}px;display:block" role="img" aria-label="Chi tiêu và doanh thu theo từ khoá">${bars}</svg></div>
<div class="tw"><table style="min-width:760px"><thead><tr><th>Từ khoá</th><th>Quảng cáo</th><th>Chi tiêu</th><th>Doanh thu</th><th>NS/DT</th><th>ROAS</th><th>Đơn</th><th>CPA</th><th>Lead</th><th>CPL</th><th>CTR</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  })();
  return `<!DOCTYPE html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(data.title)}</title>
<style>${CSS}</style></head><body><main>
<header><h1>${kwMode ? `So sánh chiến dịch theo từ khoá ${esc(data.listed.join(' vs '))} – hiệu quả quảng cáo` : `Content ${esc(data.listed.join(' & '))} và nhóm còn lại – theo dõi hiệu quả quảng cáo`}</h1><span class="sub" id="sub"></span></header>
<section class="hero"><p id="hero"></p></section>
<section class="critpanel" id="crit" aria-label="Tiêu chí và ngưỡng đánh giá content"></section>
<div class="kpis" id="kpis"></div>
${data.kw?.list?.length ? `<p class="note"><b>Lọc theo từ khoá trong tên quảng cáo: ${esc(data.kw.list.join(', '))}</b> — chỉ tính ${data.kw.matched}/${data.kw.all} quảng cáo khớp (chi tiêu ${Math.round(data.kw.spendMatched).toLocaleString('vi-VN')}/${Math.round(data.kw.spendAll).toLocaleString('vi-VN')} đ).</p>
<p class="note tot"><b>💰 Doanh thu toàn tài khoản (tất cả ${data.kw.all} quảng cáo, mọi người thực hiện): ${Math.round(data.kw.revAll || 0).toLocaleString('vi-VN')} đ</b> · chi tiêu ${Math.round(data.kw.spendAll).toLocaleString('vi-VN')} đ${data.kw.revAll ? ` · ROAS ${(data.kw.revAll / data.kw.spendAll).toFixed(2).replace('.', ',')}` : ''}. Nhóm đang lọc [${esc(data.kw.list.join(', '))}] có doanh thu ${Math.round(data.kw.revMatched || 0).toLocaleString('vi-VN')} đ${data.kw.revAll ? ` (${((data.kw.revMatched || 0) / data.kw.revAll * 100).toFixed(1).replace('.', ',')}% doanh thu toàn tài khoản)` : ''}.</p>` : ''}
${kwBlock}
${kwMode ? '<h2>So sánh các từ khoá</h2>' : '<h2>So sánh các nhóm người thực hiện</h2>'}
${kwMode ? `<p class="note">Mỗi quảng cáo được xếp vào từ khoá đầu tiên (theo thứ tự cấu hình) mà tên quảng cáo chứa; ${data.multi || 0} quảng cáo chứa nhiều từ khoá chỉ tính một lần. Lọc nhóm bằng các nút bên dưới.</p>` : `<p class="note">Quảng cáo được gán cho người có tên ở cuối tên quảng cáo, ví dụ “… 13.08_HNC TẠI SAO ĐẮT (${esc(data.listed[0] || 'TÊN')})”. ${esc(data.listed.join(' + '))} chiếm ${share}% tổng chi tiêu; ${100 - share}% còn lại (người khác hoặc chưa gắn tên) được gộp thành nhóm “Người còn lại” để đối chiếu. Màu đỏ/xanh so với mặt bằng toàn tài khoản.</p>`}
<div class="cmpcards" id="cmpcards"></div>
<div class="tw"><table id="cmp" style="min-width:860px"></table></div>
<h2>Chi tiêu và doanh thu theo content</h2>
<p class="note">Lọc theo ${kwMode ? 'từ khoá' : 'người thực hiện, từ khoá (nút vàng)'} và nhóm. Phân loại là so sánh tương đối giữa các content trong nhóm đang xem, chưa có KPI mục tiêu.</p>
<div class="chips" id="owners"></div><div class="chips kwrow" id="kwchips" hidden></div><div class="chips" id="chips"></div>
<div class="legend"><span><i style="background:var(--spend)"></i>Chi tiêu</span><span><i style="background:var(--rev)"></i>Doanh thu</span></div>
<div id="rows"></div>
<h2>Bảng chỉ số đầy đủ</h2>
<p class="note">Bấm tiêu đề cột để sắp xếp. Dòng tổng tính theo các content đang hiển thị.</p>
<div class="tw"><table><thead id="thead"></thead><tbody id="tbody"></tbody><tfoot id="tfoot"></tfoot></table></div>
<div class="foot">
<p>${esc(data.kindLabel)} · cập nhật lúc ${esc(data.updated || '–')} · nguồn: file Excel của trang báo cáo Enzy (từng quảng cáo, gồm 10% thuế).</p>
<p>Phân loại: chi tiêu dưới mức trung vị của các content trong nhóm → Cần theo dõi. Đủ chi tiêu: so với mặt bằng của nhóm, đếm số tín hiệu xấu (CPA cao hơn, NS/DT cao hơn, tỷ lệ đơn/lead thấp hơn): 0 → Hiệu quả, 1–2 → Cần tối ưu, 3 → Chưa hiệu quả; 0 đơn → Chưa hiệu quả.</p>
<p>CTR = nhấp ÷ hiển thị, CTR link = nhấp link ÷ hiển thị, CPA = chi tiêu ÷ lượt mua, CPL = chi tiêu ÷ lead, NS/DT = chi tiêu ÷ doanh thu. Tất cả tính từ tổng.</p>
</div></main>
<script>var DATA=${json(payload)};${APP}</script></body></html>
`;
}
