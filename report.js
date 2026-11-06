// Dựng báo cáo HTML tự chứa (không cần file ngoài): chữ, bảng markdown, biểu đồ ```chart (SVG) và ảnh agent đã tạo.
import fs from 'node:fs';
import path from 'node:path';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const PALETTE = ['#4f7cff', '#ff8a3d', '#2fb67c', '#c35bd6', '#e5484d', '#e0b300', '#18a0c8', '#8a8f98'];
const fmt = (n) => (Number.isFinite(n) ? n.toLocaleString('vi-VN', { maximumFractionDigits: 2 }) : '');
const IMG_MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml' };

// ---------- Biểu đồ ----------
// Cú pháp trong câu trả lời của agent: ```chart {"type":"bar|line|pie","title":"..","labels":[..],"series":[{"name":"..","data":[..]}],"unit":".."} ```
function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v)), f = v / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}

export function chartSvg(spec) {
  const type = ['bar', 'line', 'pie'].includes(spec?.type) ? spec.type : 'bar';
  const labels = (Array.isArray(spec?.labels) ? spec.labels : []).slice(0, 30).map(String);
  const series = (Array.isArray(spec?.series) ? spec.series : []).slice(0, 6)
    .map((s, i) => ({ name: String(s?.name ?? `Chuỗi ${i + 1}`), data: (Array.isArray(s?.data) ? s.data : []).slice(0, labels.length).map(Number) }))
    .filter((s) => s.data.length && s.data.every(Number.isFinite));
  if (!labels.length || !series.length) return null;
  const W = 680, H = 340, unit = spec.unit ? ` ${esc(spec.unit)}` : '';
  const title = spec.title ? `<text x="${W / 2}" y="24" text-anchor="middle" font-size="16" font-weight="700" fill="#232834">${esc(spec.title)}</text>` : '';
  let body = '';
  if (type === 'pie') {
    const data = series[0].data.map((v) => Math.max(0, v)), total = data.reduce((a, b) => a + b, 0);
    if (!total) return null;
    const cx = 190, cy = 190, r = 120;
    let a0 = -Math.PI / 2;
    data.forEach((v, i) => {
      const a1 = a0 + (v / total) * 2 * Math.PI, large = a1 - a0 > Math.PI ? 1 : 0;
      const c = PALETTE[i % PALETTE.length];
      body += data.length === 1 || v === total
        ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${c}"/>`
        : `<path d="M${cx} ${cy} L${cx + r * Math.cos(a0)} ${cy + r * Math.sin(a0)} A${r} ${r} 0 ${large} 1 ${cx + r * Math.cos(a1)} ${cy + r * Math.sin(a1)}Z" fill="${c}" stroke="#fff" stroke-width="2"/>`;
      body += `<rect x="370" y="${70 + i * 24}" width="14" height="14" rx="3" fill="${c}"/><text x="392" y="${82 + i * 24}" font-size="13" fill="#3a4150">${esc(labels[i])}: ${fmt(v)}${unit} (${Math.round((v / total) * 100)}%)</text>`;
      a0 = a1;
    });
  } else {
    const L = 64, R = 20, T = 44, B = 56 + (series.length > 1 ? 18 : 0), pw = W - L - R, ph = H - T - B;
    const all = series.flatMap((s) => s.data), lo = Math.min(0, ...all), hi = niceMax(Math.max(...all, 0)), span = hi - lo || 1;
    const y = (v) => T + ph - ((v - lo) / span) * ph;
    for (let k = 0; k <= 5; k++) {
      const v = lo + (span * k) / 5, yy = y(v);
      body += `<line x1="${L}" y1="${yy}" x2="${W - R}" y2="${yy}" stroke="#e6e3da"/><text x="${L - 8}" y="${yy + 4}" text-anchor="end" font-size="11" fill="#6b7280">${fmt(v)}</text>`;
    }
    const step = pw / labels.length;
    labels.forEach((lb, i) => {
      const x = L + step * i + step / 2, t = lb.length > 12 ? lb.slice(0, 11) + '…' : lb;
      body += `<text x="${x}" y="${T + ph + 18}" text-anchor="middle" font-size="11" fill="#6b7280"${labels.length > 10 ? ` transform="rotate(-35 ${x} ${T + ph + 18})" text-anchor="end"` : ''}>${esc(t)}</text>`;
    });
    if (type === 'bar') {
      const gw = Math.min(step * 0.8, 70 * series.length), bw = gw / series.length;
      series.forEach((s, si) => s.data.forEach((v, i) => {
        const x = L + step * i + (step - gw) / 2 + bw * si, y0 = y(Math.max(v, 0)), h = Math.abs(y(v) - y(0));
        body += `<rect x="${x}" y="${y0}" width="${bw - 2}" height="${Math.max(h, 1)}" rx="3" fill="${PALETTE[si % PALETTE.length]}"/>`;
        if (labels.length <= 12 && series.length <= 2) body += `<text x="${x + (bw - 2) / 2}" y="${y0 - 5}" text-anchor="middle" font-size="11" fill="#3a4150">${fmt(v)}</text>`;
      }));
    } else {
      series.forEach((s, si) => {
        const c = PALETTE[si % PALETTE.length], pts = s.data.map((v, i) => [L + step * i + step / 2, y(v)]);
        body += `<polyline points="${pts.map((p) => p.join(',')).join(' ')}" fill="none" stroke="${c}" stroke-width="2.5" stroke-linejoin="round"/>`;
        pts.forEach(([px, py], i) => {
          body += `<circle cx="${px}" cy="${py}" r="3.5" fill="${c}"/>`;
          if (labels.length <= 12 && series.length === 1) body += `<text x="${px}" y="${py - 8}" text-anchor="middle" font-size="11" fill="#3a4150">${fmt(s.data[i])}</text>`;
        });
      });
    }
    if (series.length > 1) {
      let x = L;
      series.forEach((s, si) => { body += `<rect x="${x}" y="${H - 18}" width="12" height="12" rx="3" fill="${PALETTE[si % PALETTE.length]}"/><text x="${x + 17}" y="${H - 8}" font-size="12" fill="#3a4150">${esc(s.name)}</text>`; x += 40 + s.name.length * 7; });
    }
    if (spec.unit) body += `<text x="${L}" y="${T - 10}" font-size="11" fill="#6b7280">Đơn vị: ${esc(spec.unit)}</text>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W}px;background:#fff;border:1px solid #e6e3da;border-radius:10px" font-family="system-ui,Segoe UI,Arial,sans-serif">${title}${body}</svg>`;
}

// ---------- Markdown rút gọn ----------
const inline = (s) => esc(s)
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
  .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|[\w./-]+\.html)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

const cells = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
const isSep = (line) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line) && line.includes('-');

function tableHtml(head, rows) {
  const num = (v) => /^[-+]?[\d.,\s]+%?$/.test(v) && /\d/.test(v);
  return `<div class="tw"><table><thead><tr>${head.map((h) => `<th>${inline(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${head.map((_, i) => `<td${num(r[i] ?? '') ? ' class="n"' : ''}>${inline(r[i] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

// images: Map<đường dẫn | tên file, dataURI>; dùng để thay ![alt](path). used: Set đánh dấu ảnh đã chèn trong thân báo cáo.
export function mdHtml(text, images = new Map(), used = new Set()) {
  const lines = String(text ?? '').replace(/\r/g, '').split('\n');
  const out = [];
  let para = [], list = null;
  const flush = () => { if (para.length) out.push(`<p>${para.map(inline).join('<br>')}</p>`); para = []; };
  const endList = () => { if (list) out.push(`</${list}>`); list = null; };
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    const fence = ln.match(/^\s*```\s*(\w*)/);
    if (fence) {
      flush(); endList();
      const buf = [];
      for (i++; i < lines.length && !/^\s*```/.test(lines[i]); i++) buf.push(lines[i]);
      if (fence[1].toLowerCase() === 'chart') {
        let svg = null;
        try { svg = chartSvg(JSON.parse(buf.join('\n'))); } catch { /* JSON sai: hiện như mã */ }
        out.push(svg ? `<figure class="chart">${svg}</figure>` : `<pre>${esc(buf.join('\n'))}</pre>`);
      } else if (fence[1].toLowerCase() === 'panel') out.push(`<aside class="panel-hi">${mdHtml(buf.join('\n'), images, used)}</aside>`);
      else out.push(`<pre>${esc(buf.join('\n'))}</pre>`);
      continue;
    }
    if (ln.includes('|') && i + 1 < lines.length && isSep(lines[i + 1]) && !isSep(ln)) {
      flush(); endList();
      const head = cells(ln), rows = [];
      for (i += 2; i < lines.length && lines[i].includes('|') && lines[i].trim(); i++) rows.push(cells(lines[i]));
      i--;
      out.push(tableHtml(head, rows));
      continue;
    }
    const img = ln.match(/^\s*!\[([^\]]*)\]\(([^)]+)\)\s*$/);
    if (img) {
      flush(); endList();
      const key = img[2].trim(), uri = images.get(key) || images.get(path.basename(key));
      if (uri) { used.add(images.get(key) ? key : path.basename(key)); out.push(`<figure><img src="${uri}" alt="${esc(img[1])}"><figcaption>${esc(img[1])}</figcaption></figure>`); }
      else out.push(`<p><i>[Hình: ${esc(img[1] || key)}]</i></p>`);
      continue;
    }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(ln)) { flush(); endList(); out.push('<hr>'); continue; }
    const h = ln.match(/^(#{1,4})\s+(.*)$/);
    if (h) { flush(); endList(); out.push(`<h${h[1].length + 2}>${inline(h[2])}</h${h[1].length + 2}>`); continue; }
    const li = ln.match(/^\s*([-*•]|\d+[.)])\s+(.*)$/);
    if (li) {
      flush();
      const kind = /\d/.test(li[1]) ? 'ol' : 'ul';
      if (list !== kind) { endList(); out.push(`<${kind}>`); list = kind; }
      out.push(`<li>${inline(li[2])}</li>`);
      continue;
    }
    if (!ln.trim()) { flush(); endList(); continue; }
    endList(); para.push(ln);
  }
  flush(); endList();
  return out.join('\n');
}

// Rút gọn bảng/biểu đồ thành nhãn ngắn để Quản Lí tổng hợp mà không tốn token cho dữ liệu chi tiết.
export function stripData(text) {
  return String(text ?? '')
    .replace(/```chart\s*([\s\S]*?)```/gi, (_, j) => { try { return `[biểu đồ: ${JSON.parse(j).title || 'không tên'}]`; } catch { return '[biểu đồ]'; } })
    .replace(/```panel\s*([\s\S]*?)```/gi, '[bảng tiêu chí đánh giá content]')
    .replace(/(^\|.*\|\s*\n){2,}/gm, '[bảng dữ liệu]\n');
}

// ---------- Ảnh / tệp đính kèm ----------
async function imageUri(file) {
  const ext = path.extname(file).toLowerCase();
  if (!IMG_MIME[ext]) return null;
  let st; try { st = fs.statSync(file); } catch { return null; }
  if (!st.isFile() || st.size > 30 * 1024 * 1024) return null;
  if (ext === '.svg' || ext === '.gif') return st.size <= 1024 * 1024 ? `data:${IMG_MIME[ext]};base64,${fs.readFileSync(file).toString('base64')}` : null;
  try {
    const sharp = (await import('sharp')).default;
    const png = ext === '.png';
    const buf = await sharp(file).rotate().resize({ width: 1000, withoutEnlargement: true })[png ? 'png' : 'jpeg'](png ? {} : { quality: 85 }).toBuffer();
    return `data:${png ? 'image/png' : 'image/jpeg'};base64,${buf.toString('base64')}`;
  } catch {
    return st.size <= 3 * 1024 * 1024 ? `data:${IMG_MIME[ext]};base64,${fs.readFileSync(file).toString('base64')}` : null;
  }
}

export function csvRows(text) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',' || c === ';') { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (c !== '\r') cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}

const CSS = `:root{color-scheme:light;--ink:#1f2630;--mute:#667085;--line:#e6e2d6;--bg:#f4f2ec;--card:#fff;--accent:#c4621a;--accent-soft:#fff4e8;--ok:#1f8a63;--bad:#c0392b}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.7 "Be Vietnam Pro",system-ui,-apple-system,"Segoe UI",Arial,sans-serif;-webkit-font-smoothing:antialiased}
.rp{max-width:860px;margin:28px auto;padding:34px 44px 40px;background:var(--card);border:1px solid var(--line);border-radius:18px;box-shadow:0 8px 30px rgba(40,36,24,.07)}
.rp-head{padding-bottom:18px;margin-bottom:22px;border-bottom:2px solid var(--line)}
.rp-kind{display:inline-block;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--accent);background:var(--accent-soft);border-radius:99px;padding:3px 12px}
h1{margin:10px 0 6px;font-size:27px;line-height:1.3;letter-spacing:-.01em}
.meta{color:var(--mute);font-size:13.5px;line-height:1.6;margin:0}.rp-links{margin:12px 0 0;font-size:14px}.rp-links a{color:var(--accent);font-weight:600}
h2{margin:34px 0 12px;padding-left:12px;border-left:5px solid var(--accent);font-size:21px;line-height:1.35}
h3{margin:26px 0 8px;font-size:18px;line-height:1.4}h4{margin:20px 0 6px;font-size:16.5px}h5{margin:18px 0 6px;font-size:16px}
p{margin:10px 0}ul,ol{margin:8px 0 12px;padding-left:22px}li{margin:6px 0}li::marker{color:var(--accent)}
li>b:first-child,li>strong:first-child{color:#8a4310}
hr{border:0;border-top:1px dashed var(--line);margin:22px 0}
a{color:var(--accent)}code{background:#f3f0e8;padding:1px 6px;border-radius:5px;font-size:.92em}pre{white-space:pre-wrap;background:#f6f4ee;padding:12px 14px;border-radius:10px;font-size:13.5px}
.tw{overflow-x:auto;margin:12px 0}table{border-collapse:collapse;width:100%;font-size:14.5px}th,td{border:1px solid var(--line);padding:8px 12px;text-align:left;vertical-align:top}th{background:#f6f3ea;font-weight:600}td.n{text-align:right;font-variant-numeric:tabular-nums}tbody tr:nth-child(even){background:#fbfaf6}
figure{margin:16px 0}figure img{max-width:100%;border-radius:12px;border:1px solid var(--line)}figcaption{color:var(--mute);font-size:12.5px;margin-top:4px}
.sum{background:#f3f8ef;border:1px solid #dbe9cf;border-left:5px solid var(--ok);border-radius:12px;padding:6px 20px 8px;margin:8px 0 6px}
.agent{margin:8px 0 0}.agent>h2{margin-top:30px}
details.ask-in{margin:4px 0 12px;font-size:13px;color:var(--mute)}details.ask-in summary{cursor:pointer;width:max-content}details.ask-in div{margin-top:6px;padding:8px 12px;background:#f7f5ef;border-radius:8px}
.idea{margin:20px 0;padding:2px 22px 14px;background:#fffdf8;border:1px solid #ecdcc4;border-left:6px solid var(--accent);border-radius:14px}
.idea h5{margin:14px 0 8px;font-size:18px;line-height:1.4}.idea .no{display:inline-block;margin-right:8px;font-size:12px;font-weight:700;letter-spacing:.05em;color:#fff;background:var(--accent);border-radius:99px;padding:2px 11px;vertical-align:2px}
.idea ul{padding-left:20px}
.srcs{margin:2px 0 12px;padding:9px 14px 8px;background:#fbf6ea;border:1px dashed #e3cfa5;border-radius:10px}.srcs-h{font-size:11.5px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#9a6a1c;margin-bottom:4px}
.idea .srcs ul{list-style:none;margin:0;padding:0}.idea .srcs li{display:flex;gap:8px;align-items:baseline;margin:5px 0;font-size:14px}.idea .srcs li::marker{content:''}
.tg{flex:none;display:inline-block;font-size:12px;font-weight:700;line-height:1.5;border-radius:99px;padding:1px 10px;white-space:nowrap}
.tg.brands{background:#ffe9d6;color:#a64b0c}.tg.ykien{background:#dff4e8;color:#17724f}.tg.ideaenzy{background:#e8e6fb;color:#4a3fb4}.tg.tuduy{background:#ececec;color:#555}
.src-link{margin-left:6px;font-weight:600;white-space:normal}
.panel-hi{background:#0d2540;color:#fff;border:3px solid #ffc83d;border-radius:14px;padding:6px 20px 14px;margin:20px 0;box-shadow:0 6px 18px rgba(13,37,64,.3)}
.panel-hi h3,.panel-hi h4{color:#ffc83d;border:0;margin:12px 0 6px}.panel-hi p{margin:8px 0}.panel-hi strong,.panel-hi b{color:#ffd978}
.panel-hi table{background:#12345a;color:#fff}.panel-hi th{background:#1d4a7e;color:#fff;border-color:#3b6ba3}.panel-hi td{border-color:#3b6ba3}.panel-hi tbody tr:nth-child(even){background:#173f6a}
.st{font-size:11.5px;font-weight:600;color:#fff;border-radius:99px;padding:1px 9px;vertical-align:2px;margin-left:6px}.st.done{background:var(--ok)}.st.failed{background:var(--bad)}.st.skipped{background:#8a8f98}.fail{color:var(--bad)}
.tasks{font-size:13.5px}.tasks h2{font-size:16px;border-left-color:#c9c3b2;margin-top:34px}
@media(max-width:700px){.rp{margin:0;padding:22px 16px 28px;border-radius:0;border:0}h1{font-size:23px}.idea{padding:2px 14px 12px}}
@media print{body{background:#fff}.rp{margin:0;max-width:none;border:0;box-shadow:none;padding:0}.idea{break-inside:avoid}}`;

// Trang HTML cho file markdown trong reports/ (bảng, biểu đồ ```chart, danh sách).
export function mdPage(title, text) {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${CSS}</style>\n<article class="rp">${ideaCards(mdHtml(text))}</article>`;
}

// ---- Nguồn ý tưởng của từng idea ----
// Agent ghi một dòng cuối mỗi idea: "- Nguồn: #brands: OMO — [Tên case](link) ; #ykien: Lo hàng giả (11 khách) ; #idea: gợi ý số 2" (#tuduy = tự suy luận).
// Báo cáo hiện thành các thẻ hashtag kèm chú thích; case Brands Vietnam có link để bấm đọc (không ghi link thì tự tra trong danh sách bài đã đọc `refs`).
const TAGS = {
  brands: { cls: 'brands', label: '#Brands', title: 'Brands Vietnam' },
  ykien: { cls: 'ykien', label: '#ÝKiếnKháchHàng', title: 'Ý kiến khách hàng' },
  idea: { cls: 'ideaenzy', label: '#IdeaEnzy', title: 'Idea Enzy (trang nội bộ)' },
  tuduy: { cls: 'tuduy', label: '#TựSuyLuận', title: 'Team tự suy luận' },
};
const ALIAS = { brands: 'brands', brand: 'brands', ykien: 'ykien', voc: 'ykien', khachhang: 'ykien', idea: 'idea', ideaenzy: 'idea', enzy: 'idea', tuduy: 'tuduy' };
const plainText = (h) => String(h).replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
const fold = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, ' ').trim();
// Tìm bài Brands Vietnam đã đọc khớp nhất với phần chú thích (theo tên thương hiệu + từ trong tiêu đề)
function resolveRef(note, refs) {
  const n = ` ${fold(note)} `;
  let best = null, bestScore = 0;
  for (const r of refs || []) {
    if (!r?.url) continue;
    const brand = fold(r.brand), words = fold(r.title).split(' ').filter((w) => w.length > 3);
    let sc = brand && n.includes(` ${brand} `) ? 2 : 0;
    for (const w of new Set(words)) if (n.includes(` ${w} `)) sc += 1;
    if (sc > bestScore) { best = r; bestScore = sc; }
  }
  return bestScore >= 3 ? best : null;
}
function sourceItems(liHtml, refs) {
  const body = liHtml.replace(/^\s*(?:<b>|<strong>)?\s*Ngu[oồ]n[^:<]*:?\s*(?:<\/b>|<\/strong>)?\s*:?\s*/i, '');
  const parts = body.split(/(?=#[A-Za-zÀ-ỹ]+\s*:)/).map((x) => x.trim()).filter(Boolean);
  const out = [];
  for (const part of parts) {
    const m = /^#([A-Za-zÀ-ỹ]+)\s*:?\s*([\s\S]*)$/.exec(part);
    if (!m) continue;
    const key = ALIAS[fold(m[1]).replace(/ /g, '')];
    if (!key) continue;
    let rest = m[2].replace(/[;·\s]+$/, ''), url = '', label = '';
    const a = /<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(rest);
    if (a) { url = a[1].replace(/&amp;/g, '&'); label = plainText(a[2]); rest = rest.replace(a[0], ' '); }
    else { const u = /(https?:\/\/[^\s<>;|)]+)/.exec(plainText(rest)); if (u) { url = u[1]; rest = rest.replace(url, ' '); } }
    let note = plainText(rest).replace(/^[\s—–\-|:]+|[\s—–\-|:(]+$/g, '').trim();
    if (key === 'brands' && !url) { const r = resolveRef(`${note} ${label}`, refs); if (r) { url = r.url; label = label || r.title; } }
    if (key === 'brands' && url && !/^https?:\/\//i.test(url)) url = '';
    out.push({ key, note, url, label });
  }
  return out;
}
function sourceBlock(items) {
  if (!items.length) return '';
  const rows = items.map((i) => {
    const t = TAGS[i.key];
    const link = i.url ? ` <a class="src-link" href="${esc(i.url)}" target="_blank" rel="noopener" title="${esc(i.label || i.url)}">↗ ${i.key === 'brands' ? 'Đọc case gốc' : 'Mở nguồn'}</a>` : '';
    return `<li><span class="tg ${t.cls}" title="${esc(t.title)}">${t.label}</span><span class="src-note">${esc(i.note || t.title)}${link}</span></li>`;
  }).join('');
  return `<div class="srcs"><div class="srcs-h">Ý tưởng lấy từ</div><ul>${rows}</ul></div>`;
}

// Mỗi "IDEA n: tên" (tiêu đề h5 do mdHtml dựng từ "### IDEA n: …") cùng phần nội dung bên dưới thành một thẻ riêng, số thứ tự nổi bật; dòng "Nguồn:" thành khối hashtag nguồn.
export function ideaCards(html, refs = []) {
  const re = /<h5>\s*((?:IDEA|Ý\s*tưởng)\s*\d+)\s*[:.\-–—)]\s*([\s\S]*?)<\/h5>/gi;
  const marks = [...html.matchAll(re)];
  if (!marks.length) return html;
  let out = html.slice(0, marks[0].index);
  marks.forEach((m, i) => {
    const end = i + 1 < marks.length ? marks[i + 1].index : html.length;
    let body = html.slice(m.index + m[0].length, end), tail = '';
    const cut = body.search(/<h[2-4][\s>]/);   // gặp tiêu đề cấp cao hơn (mục mới) thì kết thúc thẻ
    if (cut >= 0) { tail = body.slice(cut); body = body.slice(0, cut); }
    let srcs = '';
    body = body.replace(/<li>([\s\S]*?)<\/li>/gi, (all, inner) => {
      if (!/^\s*(?:<b>|<strong>)?\s*Ngu[oồ]n\b/i.test(inner)) return all;
      srcs += sourceBlock(sourceItems(inner, refs));
      return '';
    }).replace(/<ul>\s*<\/ul>/g, '');
    out += `<section class="idea"><h5><span class="no">${m[1].toUpperCase()}</span>${m[2]}</h5>${srcs}${body}</section>${tail}`;
  });
  return out;
}

// ev: { text, tasks, details:[{id,agent,title,status,text}], artifacts:[đường dẫn file agent đã tạo], focus:[id agent] }
// Có ev.focus (và agent đó đã làm xong): báo cáo CHỈ hiển thị kết quả của agent đó — không có phần tổng hợp của Quản Lí, các agent khác và bảng công việc.
export async function buildReport(ev, command, when, title = '') {
  const images = new Map(), used = new Set(), attach = [], tables = [];
  for (const f of [...new Set(ev.artifacts || [])]) {
    const ext = path.extname(f).toLowerCase();
    if (IMG_MIME[ext]) { const uri = await imageUri(f); if (uri) { images.set(f, uri); images.set(path.basename(f), uri); attach.push({ f, uri }); } }
    else if (ext === '.csv') { try { tables.push({ f, rows: csvRows(fs.readFileSync(f, 'utf8').replace(/^﻿/, '')).slice(0, 200) }); } catch { /* bỏ qua */ } }
  }
  const all = ev.details || [];
  const focus = Array.isArray(ev.focus) && ev.focus.length ? all.filter((d) => ev.focus.includes(d.id) && d.status === 'done') : [];
  const only = focus.length > 0;
  const shown = only ? focus : all;
  const section = (d) => `<section class="agent"><h2>${esc(d.agent)}${only ? '' : ` <span class="st ${esc(d.status)}">${esc(d.status)}</span>`}</h2>${d.title ? `<details class="ask-in"><summary>Yêu cầu giao cho ${esc(d.agent)}</summary><div>${esc(d.title)}</div></details>` : ''}${
    d.status === 'done' ? ideaCards(mdHtml(d.text, images, used), ev.refs) : `<p class="fail">${esc(d.text)}</p>`}</section>`;
  const detail = shown.map(section).join('\n');
  const summary = only ? '' : mdHtml(ev.text, images, used);
  const left = attach.filter((a) => !used.has(a.f) && !used.has(path.basename(a.f)));
  const files = left.map((a) => `<figure><img src="${a.uri}" alt=""><figcaption>${esc(a.f)}</figcaption></figure>`).join('')
    + tables.filter((t) => t.rows.length > 1).map((t) => `<div class="meta">${esc(t.f)}</div>${tableHtml(t.rows[0], t.rows.slice(1))}`).join('');
  const rows = (ev.tasks || []).map((x) => `<tr><td>${esc(x.agent)}</td><td>${esc(x.title)}</td><td>${esc(x.status)}</td></tr>`).join('');
  // Liên kết kèm theo (vd Dashboard content): href tính từ gốc web ("reports/…") nên đổi sang đường dẫn tương đối trong thư mục reports.
  const links = (ev.links || []).filter((l) => l?.href).map((l) => `<a href="${esc(String(l.href).replace(/^reports\//, ''))}">${esc(l.label || l.href)}</a>`).join(' &nbsp;·&nbsp; ');
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title || 'Báo cáo')}</title>
<style>${CSS}</style>
<article class="rp">
<header class="rp-head"><span class="rp-kind">${only ? esc(focus[0].agent) : 'Báo cáo gửi CEO'}</span><h1>${esc(title || 'Báo cáo gửi CEO')}</h1><p class="meta">${esc(when)}<br><b>Lệnh:</b> ${esc(command)}</p>${links ? `<p class="rp-links">${links}</p>` : ''}</header>
${summary ? `<section class="sum">${summary}</section>` : ''}
${files ? `<h2>Hình ảnh &amp; dữ liệu đính kèm</h2>${files}` : ''}
${detail}
${only ? '' : `<section class="tasks"><h2>Danh sách công việc</h2><div class="tw"><table><tr><th>Agent</th><th>Task</th><th>Trạng thái</th></tr>${rows}</table></div></section>`}
</article>`;
}
