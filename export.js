// Xuất file trong reports/ sang định dạng khác (Word, Markdown, HTML, văn bản, ảnh, CSV) khi người dùng bấm "Xuất file".
import fs from 'node:fs';
import path from 'node:path';
import { mdPage, csvRows } from './report.js';
import { buildDocx } from './docx.js';

const F = {
  docx: { label: 'Word (.docx)', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  md: { label: 'Markdown (.md)', mime: 'text/markdown; charset=utf-8' },
  html: { label: 'Trang web (.html)', mime: 'text/html; charset=utf-8' },
  txt: { label: 'Văn bản (.txt)', mime: 'text/plain; charset=utf-8' },
  csv: { label: 'CSV cho Excel (.csv)', mime: 'text/csv; charset=utf-8' },
  png: { label: 'Ảnh PNG (.png)', mime: 'image/png' },
  jpg: { label: 'Ảnh JPG (.jpg)', mime: 'image/jpeg' },
  webp: { label: 'Ảnh WEBP (.webp)', mime: 'image/webp' },
  svg: { label: 'Ảnh vector (.svg)', mime: 'image/svg+xml' },
};
const BY_EXT = {
  html: ['docx', 'md', 'txt', 'html'], htm: ['docx', 'md', 'txt', 'html'],
  md: ['docx', 'html', 'txt', 'md'], markdown: ['docx', 'html', 'txt', 'md'],
  csv: ['csv', 'docx', 'md', 'html'],
  svg: ['png', 'jpg', 'svg'],
  png: ['png', 'jpg', 'webp'], jpg: ['jpg', 'png', 'webp'], jpeg: ['jpg', 'png', 'webp'], webp: ['webp', 'png', 'jpg'], gif: ['png', 'jpg', 'webp'],
};
export const FILE_EXT = (name) => path.extname(name).slice(1).toLowerCase();
export const formatsFor = (name) => (BY_EXT[FILE_EXT(name)] || []).map((id) => ({ id, label: F[id].label }));

let sharpP;
const loadSharp = () => (sharpP ??= import('sharp').then((m) => m.default));

const decode = (s) => s.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const cell = (s) => decode(s.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')).replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
const mdTable = (rows) => {
  if (!rows.length) return '';
  const w = Math.max(...rows.map((r) => r.length));
  const pad = (r) => Array.from({ length: w }, (_, i) => (r[i] ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' '));
  const line = (r) => `| ${pad(r).join(' | ')} |`;
  return [line(rows[0]), `|${' --- |'.repeat(w)}`, ...rows.slice(1).map(line)].join('\n');
};

async function svgToPng(svg) {
  const vb = svg.match(/viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/);
  const sharp = await loadSharp();
  const fixed = vb ? svg.replace(/width="100%"[^>]*?(?=\sfont-family|>)/, `width="${vb[1] * 2}" height="${vb[2] * 2}"`) : svg;
  return sharp(Buffer.from(fixed), { density: 144 }).flatten({ background: '#ffffff' }).png().toBuffer();
}

// HTML (báo cáo do app dựng hoặc HTML đơn giản) → markdown; ảnh/biểu đồ thành ![..](img:N) kèm Map<img:N, Buffer>.
export async function htmlToMd(html) {
  const images = new Map();
  let n = 0;
  const addImg = (buf, alt) => { const k = `img:${++n}`; images.set(k, buf); return `\n\n![${alt}](${k})\n\n`; };
  let s = String(html).replace(/<!--[\s\S]*?-->/g, '').replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, '');
  const jobs = [];
  const hold = (promise) => { jobs.push(promise); return `\u0001${jobs.length - 1}\u0001`; };
  s = s.replace(/<svg[\s\S]*?<\/svg>/gi, (m) => hold(svgToPng(m).then((b) => addImg(b, 'Biểu đồ')).catch(() => '')));
  s = s.replace(/<img\b[^>]*>/gi, (m) => {
    const src = m.match(/src="data:image\/[\w+.-]+;base64,([^"]+)"/);
    const alt = decode(m.match(/alt="([^"]*)"/)?.[1] || 'Hình');
    return src ? hold(Promise.resolve(addImg(Buffer.from(src[1], 'base64'), alt))) : '';
  });
  s = s.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_, c) => `\n\n\`\`\`\n${decode(c.replace(/<[^>]+>/g, ''))}\n\`\`\`\n\n`);
  s = s.replace(/<table[\s\S]*?<\/table>/gi, (t) => {
    const rows = [...t.matchAll(/<tr[\s\S]*?<\/tr>/gi)].map((r) => [...r[0].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((c) => cell(c[1])));
    return `\n\n${mdTable(rows)}\n\n`;
  });
  s = s.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, l, c) => `\n\n${'#'.repeat(Math.min(4, Math.max(1, l - 1)))} ${decode(c.replace(/<[^>]+>/g, '')).trim()}\n\n`);
  s = s.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_, c) => { let i = 0; return `\n\n${c.replace(/<li[^>]*>/gi, () => `\n${++i}. `)}\n\n`; });
  s = s.replace(/<li[^>]*>/gi, '\n- ').replace(/<\/?(ul|ol)[^>]*>/gi, '\n');
  s = s.replace(/<(b|strong)[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**').replace(/<(i|em)[^>]*>([\s\S]*?)<\/\1>/gi, '*$2*').replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`');
  s = s.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|figure|figcaption|section)>/gi, '\n\n').replace(/<(p|div|figure|figcaption|section)[^>]*>/gi, '\n');
  s = decode(s.replace(/<[^>]+>/g, ''));
  const done = await Promise.all(jobs);
  s = s.replace(/\u0001(\d+)\u0001/g, (_, i) => done[Number(i)]);
  return { md: s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim() + '\n', images };
}

const mdToText = (md) => md.replace(/```chart[\s\S]*?```/g, '[biểu đồ]').replace(/^```.*$/gm, '').replace(/!\[([^\]]*)\]\([^)]*\)/g, '[Hình: $1]')
  .replace(/^#{1,6}\s+/gm, '').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1');

// Trả { data: Buffer, mime, name } hoặc { error }.
export async function exportFile(abs, fmt) {
  const ext = FILE_EXT(abs), base = path.basename(abs, path.extname(abs));
  if (!(BY_EXT[ext] || []).includes(fmt)) return { error: 'Định dạng này không hỗ trợ cho loại file.' };
  const out = (data) => ({ data, mime: F[fmt].mime, name: `${base}.${fmt}` });
  const raw = fs.readFileSync(abs);
  if (['png', 'jpg', 'webp', 'svg'].includes(fmt)) {
    if (fmt === ext || (fmt === 'jpg' && ext === 'jpeg')) return out(raw);
    const sharp = await loadSharp();
    let img;
    if (ext === 'svg') img = sharp(await svgToPng(raw.toString('utf8')));
    else img = sharp(raw);
    img = img.flatten({ background: '#ffffff' });
    return out(await (fmt === 'jpg' ? img.jpeg({ quality: 92 }) : fmt === 'webp' ? img.webp({ quality: 90 }) : img.png()).toBuffer());
  }
  const text = raw.toString('utf8').replace(/^\uFEFF/, '');
  let md, images = new Map(), html;
  if (ext === 'csv') { const rows = csvRows(text); md = mdTable(rows) + '\n'; if (fmt === 'csv') return out(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text)])); }
  else if (ext === 'html' || ext === 'htm') { ({ md, images } = await htmlToMd(text)); html = text; }
  else md = text;
  if (fmt === 'md') return out(Buffer.from(md.replace(/!\[([^\]]*)\]\(img:\d+\)/g, '*[Hình: $1]*')));
  if (fmt === 'txt') return out(Buffer.from(mdToText(md)));
  if (fmt === 'html') return out(Buffer.from(html ?? mdPage(base, md)));
  const r = await buildDocx({ title: '', content: md }, images);
  return out(r.data);
}
