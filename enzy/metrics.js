// Chuyển dữ liệu thô từ trang Enzy thành số liệu có cấu trúc và dựng phần số liệu của báo cáo (bảng + biểu đồ).
// Mọi con số được tính bằng code, AI chỉ diễn giải — tránh AI tự cộng trừ sai.

// "19,660,412đ" / "5.13" (định dạng trong khối prompt) và "7.394.326" / "4,99" / "3,12%" (định dạng bảng AgGrid kiểu Việt Nam).
const numEn = (s) => { const v = Number(String(s ?? '').replace(/[^\d.\-]/g, '')); return Number.isFinite(v) ? v : null; };
const numVi = (s) => {
  const t = String(s ?? '').trim();
  if (!t || t === '—' || t === '-') return null;
  const v = Number(t.replace(/[^\d,.\-]/g, '').replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(v) ? v : null;
};
const vnd = (n) => (n == null ? '–' : Math.round(n).toLocaleString('vi-VN'));
const pct = (n, d = 1) => (n == null || !Number.isFinite(n) ? '–' : `${(n * 100).toFixed(d).replace('.', ',')}%`);
const ratio = (a, b) => (a != null && b ? a / b : null);
const dec = (n, d = 2) => (n == null || !Number.isFinite(n) ? '–' : n.toFixed(d).replace('.', ','));

function section(code, title) {
  const i = code.indexOf(`# ${title}`);
  if (i < 0) return '';
  const rest = code.slice(i + title.length + 2);
  const j = rest.search(/\n# /);
  return j < 0 ? rest : rest.slice(0, j);
}

// Dòng "Chi 19,660,412đ | Lead 301 | ... | ROAS 5.13"
function parseTotals(code) {
  const sec = section(code, 'TỔNG TÀI KHOẢN');
  const line = sec.split('\n').find((l) => /Chi\s+[\d,]+/.test(l)) || '';
  const get = (k) => { const m = line.match(new RegExp(`${k}\\s+([\\d.,]+)`)); return m ? numEn(m[1]) : null; };
  const ads = sec.match(/Số ads có chi tiêu:\s*([\d,]+)\s*\(đang hoạt động:\s*([\d,]+)\)/);
  const zero = sec.match(/Ads có chi nhưng 0 đơn:\s*([\d,]+),\s*tổng chi\s*([\d,]+)/);
  return {
    spend: get('Chi'), leads: get('Lead'), costPerLead: get('Giá/lead'), orders: get('Đơn'), closeRate: get('Tỷ lệ chốt') != null ? get('Tỷ lệ chốt') / 100 : null,
    cpa: get('CPA'), aov: get('Giá trị đơn TB'), revenue: get('Doanh thu'), roas: get('ROAS'),
    adsWithSpend: ads ? numEn(ads[1]) : null, adsActive: ads ? numEn(ads[2]) : null,
    adsZeroOrders: zero ? numEn(zero[1]) : null, spendZeroOrders: zero ? numEn(zero[2]) : null,
  };
}

// "- [Enzy 2] tên chiến dịch: chi 2,508,396đ • lead 37 • đơn 27 • CPA 92,904đ • ROAS 6.26"
function parseCampaigns(code) {
  return section(code, 'THEO CHIẾN DỊCH').split('\n').map((l) => l.match(/^- \[([^\]]+)\] (.+?): chi ([\d,]+)đ • lead ([\d,]+) • đơn ([\d,]+) • CPA ([\d,]+|—)đ? • ROAS ([\d.]+)/))
    .filter(Boolean).map((m) => ({ account: m[1], name: m[2], spend: numEn(m[3]), leads: numEn(m[4]), orders: numEn(m[5]), cpa: m[6] === '—' ? null : numEn(m[6]), roas: numEn(m[7]) }));
}

function parseAccounts(grid) {
  if (!grid || grid.error || !grid.head?.length) return [];
  const cols = grid.head.slice(1); // cột đầu (tên tài khoản) nằm ở vùng ghim bên trái
  return grid.center.map((cells, i) => {
    const row = Object.fromEntries(cols.map((c, j) => [c, cells[j]]));
    const spend = numVi(row['Chi tiêu']), revenue = numVi(row['Doanh thu']), orders = numVi(row['Đơn thực tế']), leads = numVi(row['Lead']);
    return {
      account: grid.left[i] || `#${i + 1}`, status: row['Tình trạng'] || '', ads: numVi(row['Số ads']),
      spend, revenue, orders, leads, costPerLead: numVi(row['Chi phí lead']), cpa: numVi(row['CPA thực tế']) ?? ratio(spend, orders),
      roas: numVi(row['ROAS']) ?? ratio(revenue, spend), impressions: numVi(row['Hiển thị']), linkClicks: numVi(row['Nhấp liên kết']),
      ctr: numVi(row['CTR']) != null ? numVi(row['CTR']) / 100 : null, nsdt: ratio(spend, revenue), closeRate: ratio(orders, leads),
    };
  });
}

export function parseEnzy(raw) {
  const code = raw.code || '';
  const totals = parseTotals(code);
  if (totals.spend == null && raw.metrics?.['Chi tiêu']) totals.spend = numEn(raw.metrics['Chi tiêu']);
  totals.nsdt = ratio(totals.spend, totals.revenue);
  const cpaTarget = numEn((code.match(/CPA mục tiêu:\s*([\d,]+)/) || [])[1]);
  return {
    range: raw.range, period: raw.period, updated: raw.updated, notes: raw.notes,
    selected: raw.accounts?.selected || [], missing: raw.accounts?.missing || [],
    cpaTarget, totals, accounts: parseAccounts(raw.grid), campaigns: parseCampaigns(code),
  };
}

const KIND_LABEL = { daily: 'Báo cáo ngày', weekly: 'Báo cáo tuần', monthly: 'Báo cáo tháng' };

// "Báo cáo tuần 1 tháng 10/2026" khi kỳ đúng là một khối tuần theo lịch (1–7, 8–14, 15–21, 22–28, 29–cuối tháng); tháng: "Báo cáo tháng 10/2026".
// Kỳ không khớp (vd. khoảng nhiều tháng) thì dùng nhãn chung.
export function kindLabel(kind, period) {
  const base = KIND_LABEL[kind];
  const ds = [...String(period || '').matchAll(/(\d{2})\/(\d{2})\/(\d{4})/g)].map((m) => ({ d: +m[1], m: +m[2], y: +m[3] }));
  if (kind === 'daily' || ds.length < 2) return base;
  const a = ds[0], b = ds.at(-1);
  if (a.m !== b.m || a.y !== b.y) return base;
  if (kind === 'monthly') return a.d === 1 ? `${base} ${a.m}/${a.y}` : base;
  const starts = [1, 8, 15, 22, 29];
  return starts.includes(a.d) ? `${base} ${starts.indexOf(a.d) + 1} tháng ${a.m}/${a.y}` : base;
}
const KIND_TAG = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' };
const delta = (cur, prev) => (cur == null || prev == null || !prev ? '–' : cur === prev ? '=' : `${cur > prev ? '▲' : '▼'} ${pct(Math.abs(cur - prev) / Math.abs(prev), 0)}`);
const chart = (spec) => '```chart\n' + JSON.stringify(spec) + '\n```';

/**
 * Phần số liệu của báo cáo (markdown có bảng và khối ```chart mà report.js tự vẽ).
 * history: các snapshot cùng loại trước đó (mới nhất cuối), dùng để so sánh và vẽ xu hướng.
 */
export function buildDataMarkdown(kind, d, history = []) {
  const t = d.totals, prev = history.at(-1)?.totals;
  const target = d.cpaTarget;
  const L = [];
  L.push(`# [${KIND_TAG[kind]}] ${kindLabel(kind, d.period)} quảng cáo Enzy — ${d.period || d.range}`);
  L.push(`Nguồn: enzyfood.streamlit.app · Khoảng: ${d.range} · Cập nhật lúc ${d.updated || '–'} · Tài khoản: ${d.selected.join(', ') || '–'}`);
  if (d.missing.length) L.push(`⚠️ Không chọn được tài khoản: ${d.missing.join(', ')} (không có trong danh sách của trang).`);
  if (d.notes) L.push(`⚠️ ${d.notes}`);
  L.push('', '## Chỉ số tổng', '', `| Chỉ số | Giá trị | So với kỳ trước${prev ? ` (${history.at(-1).period || ''})` : ''} |`, '|---|---|---|');
  const rows = [
    ['Doanh thu (đ)', vnd(t.revenue), delta(t.revenue, prev?.revenue)],
    ['Chi tiêu (đ, gồm 10% thuế)', vnd(t.spend), delta(t.spend, prev?.spend)],
    ['NS/DT (Chi ÷ Doanh thu)', pct(t.nsdt), delta(t.nsdt, prev?.nsdt)],
    ['ROAS (Doanh thu ÷ Chi)', dec(t.roas), delta(t.roas, prev?.roas)],
    ['Đơn thực tế', vnd(t.orders), delta(t.orders, prev?.orders)],
    [`CPA (đ)${target ? ` — mục tiêu ${vnd(target)}` : ''}`, `${vnd(t.cpa)}${target && t.cpa ? (t.cpa <= target ? ' ✅' : ' 🔴') : ''}`, delta(t.cpa, prev?.cpa)],
    ['Lead (tin nhắn mới)', vnd(t.leads), delta(t.leads, prev?.leads)],
    ['Giá/lead (đ)', vnd(t.costPerLead), delta(t.costPerLead, prev?.costPerLead)],
    ['Tỷ lệ chốt (Đơn ÷ Lead)', pct(t.closeRate), delta(t.closeRate, prev?.closeRate)],
    ['Giá trị đơn TB (đ)', vnd(t.aov), delta(t.aov, prev?.aov)],
    ['Ads có chi / đang chạy', `${vnd(t.adsWithSpend)} / ${vnd(t.adsActive)}`, ''],
    ['Ads có chi nhưng 0 đơn', `${vnd(t.adsZeroOrders)} ads · ${vnd(t.spendZeroOrders)}đ (${pct(ratio(t.spendZeroOrders, t.spend), 0)} chi)`, ''],
  ];
  for (const r of rows) L.push(`| ${r.join(' | ')} |`);

  const acc = d.accounts.filter((a) => a.spend);
  if (acc.length) {
    L.push('', '## Theo tài khoản QC', '', '| Tài khoản | Chi tiêu | Doanh thu | NS/DT | ROAS | Đơn | CPA | Lead | Giá/lead | Tỷ lệ chốt | CTR |', '|---|---|---|---|---|---|---|---|---|---|---|');
    for (const a of acc) L.push(`| ${a.account} | ${vnd(a.spend)} | ${vnd(a.revenue)} | ${pct(a.nsdt)} | ${dec(a.roas)} | ${vnd(a.orders)} | ${vnd(a.cpa)}${target && a.cpa ? (a.cpa <= target ? ' ✅' : ' 🔴') : ''} | ${vnd(a.leads)} | ${vnd(a.costPerLead)} | ${pct(a.closeRate)} | ${pct(a.ctr, 2)} |`);
    const labels = acc.map((a) => a.account);
    L.push('', chart({ type: 'bar', title: 'Chi tiêu và doanh thu theo tài khoản', labels, series: [{ name: 'Chi tiêu', data: acc.map((a) => Math.round(a.spend)) }, { name: 'Doanh thu', data: acc.map((a) => Math.round(a.revenue || 0)) }], unit: 'đ' }));
    L.push('', chart({ type: 'bar', title: `CPA theo tài khoản${target ? ` (mục tiêu ${vnd(target)}đ)` : ''}`, labels, series: [{ name: 'CPA', data: acc.map((a) => Math.round(a.cpa || 0)) }], unit: 'đ' }));
    L.push('', chart({ type: 'pie', title: 'Tỷ trọng chi tiêu theo tài khoản', labels, series: [{ name: 'Chi tiêu', data: acc.map((a) => Math.round(a.spend)) }] }));
  }

  const trend = [...history.slice(-13), { period: d.period, totals: t }].filter((h) => h.totals?.spend != null);
  if (trend.length >= 3) {
    const labels = trend.map((h) => (h.period || '').replace(/^.*?(\d{2}\/\d{2})\/\d{4}$/, '$1') || '?');
    L.push('', '## Xu hướng các kỳ gần nhất', '', chart({ type: 'line', title: 'Chi tiêu và doanh thu qua các kỳ', labels, series: [{ name: 'Chi tiêu', data: trend.map((h) => Math.round(h.totals.spend)) }, { name: 'Doanh thu', data: trend.map((h) => Math.round(h.totals.revenue || 0)) }], unit: 'đ' }));
    L.push('', chart({ type: 'line', title: 'ROAS qua các kỳ', labels, series: [{ name: 'ROAS', data: trend.map((h) => Number((h.totals.roas || 0).toFixed(2))) }] }));
  }

  const camps = d.campaigns.filter((c) => c.spend > 0);
  if (camps.length) {
    const minSpend = (t.spend || 0) * 0.02;
    // Cần xem lại: 0 đơn, CPA vượt mục tiêu, hoặc ROAS dưới 70% mức chung. Hiệu quả: có đơn, không thuộc nhóm trên.
    const bad = (c) => !c.orders || (target && c.cpa > target) || (t.roas && c.roas < t.roas * 0.7);
    const big = camps.filter((c) => c.spend >= minSpend);
    const best = big.filter((c) => c.orders > 0 && !bad(c)).sort((a, b) => b.roas - a.roas).slice(0, 5);
    const worst = big.filter(bad).sort((a, b) => b.spend - a.spend).slice(0, 5);
    const table = (list) => ['| Tài khoản | Chiến dịch | Chi | Lead | Đơn | CPA | ROAS |', '|---|---|---|---|---|---|---|',
      ...list.map((c) => `| ${c.account} | ${c.name.replace(/\|/g, '/')} | ${vnd(c.spend)} | ${c.leads} | ${c.orders} | ${vnd(c.cpa)} | ${dec(c.roas)} |`)];
    L.push('', '## Chiến dịch hiệu quả nhất (chi ≥ 2% tổng, xếp theo ROAS)', '', ...(best.length ? table(best) : ['Không có chiến dịch đạt tiêu chí.']));
    L.push('', `## Chiến dịch cần xem lại (chi ≥ 2% tổng; 0 đơn${target ? ', CPA > mục tiêu' : ''} hoặc ROAS < 70% mức chung; xếp theo chi)`, '', ...(worst.length ? table(worst) : ['Không có chiến dịch cần xem lại.']));
  }
  return L.join('\n') + '\n';
}

// Bản rút gọn để lưu lịch sử (so sánh kỳ sau, vẽ xu hướng).
export const snapshot = (d) => ({ period: d.period, range: d.range, updated: d.updated, cpaTarget: d.cpaTarget, totals: d.totals,
  accounts: d.accounts.map(({ account, spend, revenue, orders, leads, cpa, roas, nsdt }) => ({ account, spend, revenue, orders, leads, cpa, roas, nsdt })) });
