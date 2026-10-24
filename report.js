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
  .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

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
      } else out.push(`<pre>${esc(buf.join('\n'))}</pre>`);
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

const CSS = `body{font:15px/1.55 system-ui,Segoe UI,Arial,sans-serif;max-width:900px;margin:28px auto;padding:0 18px;color:#232834}
h2{margin:0 0 4px}h3{margin:26px 0 8px;padding-top:6px;border-top:1px solid #e6e3da}h4,h5{margin:16px 0 6px}
.meta{color:#6b7280;font-size:13px}.tw{overflow-x:auto;margin:10px 0}table{border-collapse:collapse;width:100%}
th,td{border:1px solid #ddd;padding:6px 10px;text-align:left}th{background:#f1efe8}td.n{text-align:right;font-variant-numeric:tabular-nums}
tbody tr:nth-child(even){background:#faf9f5}pre{white-space:pre-wrap;background:#f6f4ee;padding:12px;border-radius:8px}code{background:#f1efe8;padding:1px 5px;border-radius:4px}
figure{margin:14px 0}figure img{max-width:100%;border-radius:10px;border:1px solid #e6e3da}figcaption{color:#6b7280;font-size:12.5px;margin-top:4px}
.sum{background:#f3f7ee;border:1px solid #dbe7cc;border-radius:10px;padding:4px 16px}.st{font-size:12px;color:#fff;border-radius:99px;padding:1px 8px}
.st.done{background:#2fb67c}.st.failed{background:#e5484d}.st.skipped{background:#8a8f98}.fail{color:#b42318}`;

// Trang HTML cho file markdown trong reports/ (bảng, biểu đồ ```chart, danh sách).
export function mdPage(title, text) {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${CSS}</style>\n${mdHtml(text)}`;
}

// ev: { text, tasks, details:[{agent,title,status,text}], artifacts:[đường dẫn file agent đã tạo] }
export async function buildReport(ev, command, when) {
  const images = new Map(), used = new Set(), attach = [], tables = [];
  for (const f of [...new Set(ev.artifacts || [])]) {
    const ext = path.extname(f).toLowerCase();
    if (IMG_MIME[ext]) { const uri = await imageUri(f); if (uri) { images.set(f, uri); images.set(path.basename(f), uri); attach.push({ f, uri }); } }
    else if (ext === '.csv') { try { tables.push({ f, rows: csvRows(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, '')).slice(0, 200) }); } catch { /* bỏ qua */ } }
  }
  const detail = (ev.details || []).map((d) => `<h3>${esc(d.agent)} <span class="st ${esc(d.status)}">${esc(d.status)}</span></h3><div class="meta">${esc(d.title)}</div>${
    d.status === 'done' ? mdHtml(d.text, images, used) : `<p class="fail">${esc(d.text)}</p>`}`).join('\n');
  const summary = mdHtml(ev.text, images, used);
  const left = attach.filter((a) => !used.has(a.f) && !used.has(path.basename(a.f)));
  const files = left.map((a) => `<figure><img src="${a.uri}" alt=""><figcaption>${esc(a.f)}</figcaption></figure>`).join('')
    + tables.filter((t) => t.rows.length > 1).map((t) => `<div class="meta">${esc(t.f)}</div>${tableHtml(t.rows[0], t.rows.slice(1))}`).join('');
  const rows = (ev.tasks || []).map((x) => `<tr><td>${esc(x.agent)}</td><td>${esc(x.title)}</td><td>${esc(x.status)}</td></tr>`).join('');
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Báo cáo</title>
<style>${CSS}</style>
<h2>Báo cáo gửi CEO</h2><p class="meta"><b>Lệnh:</b> ${esc(command)}<br>${esc(when)}</p>
<div class="sum">${summary}</div>
${files ? `<h3>Hình ảnh &amp; dữ liệu đính kèm</h3>${files}` : ''}
${detail}
<h3>Danh sách công việc</h3><div class="tw"><table><tr><th>Agent</th><th>Task</th><th>Trạng thái</th></tr>${rows}</table></div>`;
}
