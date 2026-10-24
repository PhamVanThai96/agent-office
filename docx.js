// Công cụ make_docx: chuyển markdown (tiêu đề, đoạn, danh sách, bảng, ```chart, ![ảnh](đường dẫn)) thành file Word .docx bằng thư viện `docx`.
import path from 'node:path';
import { chartSvg } from './report.js';

let libP, sharpP;
const lib = () => (libP ??= import('docx'));
const loadSharp = () => (sharpP ??= import('sharp').then((m) => m.default));

const MAX_W = 600; // px, vừa khổ A4 có lề
const cells = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
const isSep = (line) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line) && line.includes('-');

// Danh sách đường dẫn ảnh ![alt](path) trong nội dung (không tính link http).
export function imagePaths(content) {
  const out = [];
  for (const m of String(content ?? '').matchAll(/^\s*!\[[^\]]*\]\(([^)]+)\)\s*$/gm)) {
    const p = m[1].trim();
    if (!/^https?:/i.test(p) && !out.includes(p)) out.push(p);
  }
  return out;
}

export function parseDocxInput(input) {
  const output = typeof input?.output === 'string' ? input.output.trim() : '';
  if (!output) return { error: 'Thiếu "output" (đường dẫn file .docx).' };
  if (!/\.docx$/i.test(output)) return { error: 'File đầu ra phải có đuôi .docx.' };
  const content = typeof input?.content === 'string' ? input.content : '';
  if (!content.trim()) return { error: 'Thiếu "content" (nội dung markdown của tài liệu).' };
  if (content.length > 300000) return { error: 'Nội dung quá dài (>300KB).' };
  const title = typeof input?.title === 'string' ? input.title.trim().slice(0, 200) : '';
  return { spec: { output, title, content } };
}

async function toPng(buf) {
  const sharp = await loadSharp();
  const { data, info } = await sharp(buf).png().toBuffer({ resolveWithObject: true });
  const w = Math.min(MAX_W, info.width), h = Math.round(info.height * (w / info.width));
  return { data, w, h };
}

async function chartPng(json) {
  let svg;
  try { svg = chartSvg(JSON.parse(json)); } catch { return null; }
  if (!svg) return null;
  const vb = svg.match(/viewBox="0 0 (\d+) (\d+)"/);
  if (!vb) return null;
  const sharp = await loadSharp();
  svg = svg.replace(/width="100%" style="[^"]*"/, `width="${vb[1] * 2}" height="${vb[2] * 2}"`);
  return toPng(await sharp(Buffer.from(svg)).png().toBuffer());
}

// images: Map<đường dẫn như trong markdown, Buffer>
export async function buildDocx({ title, content }, images = new Map()) {
  const D = await lib();
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, ImageRun, ShadingType, AlignmentType, BorderStyle } = D;
  const warnings = [];

  const runs = (text, base = {}) => {
    const out = [];
    for (const part of String(text).split(/(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`)/g)) {
      if (!part) continue;
      if (/^\*\*[^*]+\*\*$/.test(part)) out.push(new TextRun({ ...base, text: part.slice(2, -2), bold: true }));
      else if (/^\*[^*]+\*$/.test(part)) out.push(new TextRun({ ...base, text: part.slice(1, -1), italics: true }));
      else if (/^`[^`]+`$/.test(part)) out.push(new TextRun({ ...base, text: part.slice(1, -1), font: 'Consolas' }));
      else out.push(new TextRun({ ...base, text: part }));
    }
    return out;
  };
  const para = (text, opts = {}) => new Paragraph({ children: runs(text), spacing: { after: 120 }, ...opts });
  const picture = (img, caption) => {
    const items = [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 120, after: 60 }, children: [new ImageRun({ type: 'png', data: img.data, transformation: { width: img.w, height: img.h }, altText: { title: caption || 'hình', description: caption || 'hình', name: 'hình' } })] })];
    if (caption) items.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 160 }, children: [new TextRun({ text: caption, italics: true, size: 18, color: '6B7280' })] }));
    return items;
  };
  const line = { style: BorderStyle.SINGLE, size: 4, color: 'BFC5CE' };
  const borders = { top: line, bottom: line, left: line, right: line };
  const table = (head, rows) => new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [head, ...rows].map((r, ri) => new TableRow({
      tableHeader: ri === 0,
      children: head.map((_, ci) => {
        const v = r[ci] ?? '';
        const num = ri > 0 && /^[-+]?[\d.,\s]+%?$/.test(v) && /\d/.test(v);
        return new TableCell({
          borders, margins: { top: 60, bottom: 60, left: 100, right: 100 },
          shading: ri === 0 ? { type: ShadingType.CLEAR, fill: 'EEF1F6', color: 'auto' } : undefined,
          children: [new Paragraph({ alignment: num ? AlignmentType.RIGHT : AlignmentType.LEFT, children: runs(v, ri === 0 ? { bold: true } : {}) })],
        });
      }),
    })),
  });

  const kids = [];
  if (title) kids.push(new Paragraph({ heading: HeadingLevel.TITLE, spacing: { after: 240 }, children: [new TextRun({ text: title })] }));
  const lines = content.replace(/\r/g, '').split('\n');
  const heads = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4];
  let buf = [];
  const flush = () => { if (buf.length) kids.push(para(buf.join(' '))); buf = []; };
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    const fence = ln.match(/^\s*```\s*(\w*)/);
    if (fence) {
      flush();
      const code = [];
      for (i++; i < lines.length && !/^\s*```/.test(lines[i]); i++) code.push(lines[i]);
      if (fence[1].toLowerCase() === 'chart') {
        const img = await chartPng(code.join('\n')).catch(() => null);
        if (img) kids.push(...picture(img, ''));
        else warnings.push('Một khối ```chart sai định dạng nên bị bỏ qua.');
      } else code.forEach((c) => kids.push(new Paragraph({ children: [new TextRun({ text: c || ' ', font: 'Consolas', size: 20 })], shading: { type: ShadingType.CLEAR, fill: 'F3F4F6', color: 'auto' } })));
      continue;
    }
    if (ln.includes('|') && i + 1 < lines.length && isSep(lines[i + 1]) && !isSep(ln)) {
      flush();
      const head = cells(ln), rows = [];
      for (i += 2; i < lines.length && lines[i].includes('|') && lines[i].trim(); i++) rows.push(cells(lines[i]));
      i--;
      kids.push(table(head, rows), new Paragraph({ spacing: { after: 120 }, children: [] }));
      continue;
    }
    const im = ln.match(/^\s*!\[([^\]]*)\]\(([^)]+)\)\s*$/);
    if (im) {
      flush();
      const key = im[2].trim(), data = images.get(key);
      if (data) {
        try { kids.push(...picture(await toPng(data), im[1])); } catch { warnings.push(`Không đọc được ảnh ${key}.`); }
      } else kids.push(para(`[Hình: ${im[1] || key}]`, { alignment: AlignmentType.CENTER }));
      continue;
    }
    const h = ln.match(/^(#{1,4})\s+(.*)$/);
    if (h) { flush(); kids.push(new Paragraph({ heading: heads[h[1].length - 1], spacing: { before: 240, after: 120 }, children: runs(h[2].replace(/\*\*/g, '')) })); continue; }
    const li = ln.match(/^(\s*)([-*•]|\d+[.)])\s+(.*)$/);
    if (li) {
      flush();
      const level = Math.min(2, Math.floor(li[1].replace(/\t/g, '  ').length / 2));
      kids.push(/\d/.test(li[2])
        ? new Paragraph({ children: runs(`${li[2]} ${li[3]}`), indent: { left: 360 + level * 360, hanging: 260 }, spacing: { after: 60 } })
        : new Paragraph({ children: runs(li[3]), bullet: { level }, spacing: { after: 60 } }));
      continue;
    }
    if (!ln.trim()) { flush(); continue; }
    buf.push(ln.trim());
  }
  flush();

  const doc = new Document({
    title: title || path.basename('tài liệu'),
    creator: 'Agent Office',
    styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } },
    sections: [{ properties: { page: { margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } }, children: kids }],
  });
  return { data: await Packer.toBuffer(doc), warnings };
}
