// Công cụ make_image: ghép ảnh gốc + các lớp (chữ, hình khối, ảnh phụ) thành banner PNG/JPG/WEBP bằng thư viện `sharp`.
// Chỉ xử lý dữ liệu; việc xin quyền đọc/ghi file do access.js đảm nhiệm.
export const IMG_EXT = /\.(png|jpe?g|webp)$/i;
const MAX_SIDE = 4096, MAX_LAYERS = 30, MAX_TEXT = 2000;
const COLOR = /^(#[0-9a-f]{3,8}|[a-z]{3,20}|rgba?\([\d\s.,%]+\))$/i;
const FONT = /^[\w\s,'"-]{1,80}$/;
const DEFAULT_FONT = "Noto Sans, DejaVu Sans, Arial, Helvetica, sans-serif";

let sharpP;
const loadSharp = () => (sharpP ??= import('sharp').then((m) => m.default));

const num = (v, d, lo = -1e5, hi = 1e5) => (Number.isFinite(Number(v)) && v !== '' && v != null ? Math.min(hi, Math.max(lo, Number(v))) : d);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
const col = (v, d) => (typeof v === 'string' && COLOR.test(v.trim()) ? v.trim() : d);

// Kiểm tra và chuẩn hoá yêu cầu. Trả về { error } hoặc { spec } (spec chưa chứa đường dẫn thật).
export function parseSpec(i) {
  if (!i || typeof i !== 'object') return { error: 'Thiếu tham số.' };
  if (typeof i.output !== 'string' || !IMG_EXT.test(i.output)) return { error: 'output phải là đường dẫn file .png, .jpg hoặc .webp.' };
  const layersIn = Array.isArray(i.layers) ? i.layers : [];
  if (layersIn.length > MAX_LAYERS) return { error: `Tối đa ${MAX_LAYERS} lớp.` };
  const layers = [];
  const ALIAS = { rectangle: 'rect', box: 'rect', shape: 'rect', gradient: 'rect', overlay: 'rect', banner: 'rect', background: 'rect', ellipse: 'circle', dot: 'circle',
    label: 'text', title: 'text', caption: 'text', heading: 'text', subtitle: 'text', photo: 'image', picture: 'image', logo: 'image', img: 'image' };
  const warnings = [];
  for (const [n, l] of layersIn.entries()) {
    const raw = String(l?.type ?? '').toLowerCase();
    const t = ALIAS[raw] || raw;
    if (!['text', 'rect', 'circle', 'image'].includes(t)) { warnings.push(`Bỏ qua lớp ${n + 1}: type "${raw || '(trống)'}" không hợp lệ (chỉ text, rect, circle, image).`); continue; }
    if (t === 'text') {
      const text = String(l.text ?? '').slice(0, MAX_TEXT);
      if (!text.trim()) return { error: `Lớp ${n + 1}: text rỗng.` };
      layers.push({
        type: 'text', text, x: num(l.x, 0), y: num(l.y, 0), size: num(l.size, 48, 8, 600), fill: col(l.fill, '#ffffff'),
        weight: /^(normal|bold|[1-9]00)$/.test(String(l.weight)) ? String(l.weight) : 'bold',
        anchor: ['start', 'middle', 'end'].includes(l.anchor) ? l.anchor : 'start',
        font: typeof l.font === 'string' && FONT.test(l.font) ? l.font + ', ' + DEFAULT_FONT : DEFAULT_FONT,
        stroke: col(l.stroke, ''), strokeWidth: num(l.strokeWidth, 0, 0, 40), opacity: num(l.opacity, 1, 0, 1),
        rotate: num(l.rotate, 0, -360, 360), lineHeight: num(l.lineHeight, 1.2, 0.8, 3), italic: !!l.italic,
      });
    } else if (t === 'rect' || t === 'circle') {
      layers.push({
        type: t, x: num(l.x, 0), y: num(l.y, 0), w: num(l.w, 100, 0), h: num(l.h, 100, 0), r: num(l.r, 50, 0), radius: num(l.radius, 0, 0, 2000),
        fill: col(l.fill, '#000000'), fillTo: col(l.fillTo, ''), opacity: num(l.opacity, 1, 0, 1), opacityTo: num(l.opacityTo, num(l.opacity, 1, 0, 1), 0, 1),
        stroke: col(l.stroke, ''), strokeWidth: num(l.strokeWidth, 0, 0, 100),
      });
    } else if (t === 'image') {
      if (typeof l.path !== 'string' || !l.path.trim()) return { error: `Lớp ${n + 1}: thiếu path ảnh.` };
      layers.push({ type: 'image', path: l.path, x: num(l.x, 0), y: num(l.y, 0), w: l.w ? num(l.w, 0, 1, MAX_SIDE) : 0, h: l.h ? num(l.h, 0, 1, MAX_SIDE) : 0 });
    }
  }
  if (!layers.length && layersIn.length) return { error: warnings.join(' ') };
  return {
    spec: {
      output: i.output, base: typeof i.base === 'string' && i.base.trim() ? i.base : '',
      width: i.width ? Math.round(num(i.width, 0, 64, MAX_SIDE)) : 0, height: i.height ? Math.round(num(i.height, 0, 64, MAX_SIDE)) : 0,
      background: col(i.background, '#ffffff'), layers, warnings,
    },
  };
}

function svgFor(l, W, H, n) {
  const op = (o) => (o === 1 ? '' : ` opacity="${o}"`);
  let body = '', defs = '';
  if (l.type === 'text') {
    const lines = l.text.split(/\r?\n/);
    const tspans = lines.map((ln, k) => `<tspan x="${l.x}" dy="${k ? l.size * l.lineHeight : 0}">${esc(ln)}</tspan>`).join('');
    const st = l.stroke && l.strokeWidth ? ` stroke="${l.stroke}" stroke-width="${l.strokeWidth}" stroke-linejoin="round" paint-order="stroke"` : '';
    const rot = l.rotate ? ` transform="rotate(${l.rotate} ${l.x} ${l.y})"` : '';
    body = `<text x="${l.x}" y="${l.y}" font-family="${esc(l.font)}" font-size="${l.size}" font-weight="${l.weight}" ${l.italic ? 'font-style="italic" ' : ''}fill="${l.fill}" text-anchor="${l.anchor}"${st}${op(l.opacity)}${rot}>${tspans}</text>`;
  } else {
    let fill = l.fill;
    if (l.fillTo) {
      defs = `<defs><linearGradient id="g${n}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${l.fill}" stop-opacity="${l.opacity}"/><stop offset="1" stop-color="${l.fillTo}" stop-opacity="${l.opacityTo}"/></linearGradient></defs>`;
      fill = `url(#g${n})`;
    }
    const st = l.stroke && l.strokeWidth ? ` stroke="${l.stroke}" stroke-width="${l.strokeWidth}"` : '';
    const o = l.fillTo ? '' : op(l.opacity);
    body = l.type === 'rect'
      ? `<rect x="${l.x}" y="${l.y}" width="${l.w}" height="${l.h}" rx="${l.radius}" fill="${fill}"${st}${o}/>`
      : `<circle cx="${l.x}" cy="${l.y}" r="${l.r}" fill="${fill}"${st}${o}/>`;
  }
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${defs}${body}</svg>`);
}

// paths: { base, layers: [đường dẫn thật cho từng lớp image] } đã được access.js cấp quyền đọc.
export async function render(spec, paths, outFile) {
  let sharp;
  try { sharp = await loadSharp(); } catch { return { error: 'Chưa cài thư viện ảnh. Chạy "npm install" trong thư mục app rồi khởi động lại server.' }; }
  try {
    let W = spec.width, H = spec.height, base;
    if (paths.base) {
      const m = await sharp(paths.base).rotate().metadata();
      const [bw, bh] = m.orientation >= 5 ? [m.height, m.width] : [m.width, m.height];
      if (!W && !H) { const k = Math.min(1, MAX_SIDE / Math.max(bw, bh)); W = Math.round(bw * k); H = Math.round(bh * k); }
      else if (!W) W = Math.round(H * bw / bh);
      else if (!H) H = Math.round(W * bh / bw);
      base = await sharp(paths.base).rotate().resize(W, H, { fit: 'cover', position: 'centre' }).png().toBuffer();
    } else {
      W = W || 1080; H = H || 1080;
      base = await sharp({ create: { width: W, height: H, channels: 4, background: spec.background } }).png().toBuffer();
    }
    const comps = [];
    for (const [n, l] of spec.layers.entries()) {
      if (l.type !== 'image') { comps.push({ input: svgFor(l, W, H, n), left: 0, top: 0 }); continue; }
      const p = paths.layers[n];
      let pipe = sharp(p).rotate();
      pipe = l.w || l.h ? pipe.resize(l.w || null, l.h || null, { fit: l.w && l.h ? 'cover' : 'inside' }) : pipe.resize(W, H, { fit: 'inside', withoutEnlargement: true });
      const buf = await pipe.png().toBuffer();
      const { width: w, height: h } = await sharp(buf).metadata();
      const left = Math.round(l.x), top = Math.round(l.y);
      const cx = Math.max(0, -left), cy = Math.max(0, -top);
      const cw = Math.min(w - cx, W - Math.max(0, left)), ch = Math.min(h - cy, H - Math.max(0, top));
      if (cw <= 0 || ch <= 0) continue;
      const input = cx || cy || cw < w || ch < h ? await sharp(buf).extract({ left: cx, top: cy, width: cw, height: ch }).png().toBuffer() : buf;
      comps.push({ input, left: Math.max(0, left), top: Math.max(0, top) });
    }
    let out = sharp(base).composite(comps);
    const ext = outFile.split('.').pop().toLowerCase();
    out = ext === 'png' ? out.png() : ext === 'webp' ? out.webp({ quality: 90 }) : out.flatten({ background: spec.background }).jpeg({ quality: 92 });
    const data = await out.toBuffer();
    return { data, width: W, height: H };
  } catch (e) {
    return { error: `Không tạo được ảnh: ${e.message}` };
  }
}
