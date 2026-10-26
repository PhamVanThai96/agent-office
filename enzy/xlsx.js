import zlib from 'node:zlib';

// Đọc sheet đầu tiên của file .xlsx (zip + XML) mà không cần thư viện ngoài.
// Hỗ trợ chuỗi inline, sharedStrings và ô số; trả về mảng các hàng (mảng ô).
function unzip(buf) {
  let e = buf.length - 22;
  while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) throw new Error('File Excel không hợp lệ.');
  const n = buf.readUInt16LE(e + 10);
  let p = buf.readUInt32LE(e + 16);
  const files = {};
  for (let i = 0; i < n; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    const lh = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
    files[name] = () => { const raw = buf.subarray(lh, lh + csize); return method === 0 ? raw : zlib.inflateRawSync(raw); };
    p += 46 + nlen + xlen + clen;
  }
  return files;
}

const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&amp;/g, '&');
const texts = (xml) => [...xml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => unesc(m[1])).join('');
const colIndex = (ref) => [...ref.replace(/\d+/g, '')].reduce((a, c) => a * 26 + c.charCodeAt(0) - 64, 0) - 1;

// Tên các sheet theo thứ tự trong workbook ("sheet1.xml" ↔ phần tử đầu...), dùng khi file có nhiều sheet.
export function xlsxSheetNames(buf) {
  const files = unzip(buf);
  const wb = files['xl/workbook.xml']?.().toString('utf8') || '';
  return [...wb.matchAll(/<sheet\b[^>]*\bname="([^"]*)"/g)].map((m) => unesc(m[1]));
}

export function readXlsx(buf, sheetIndex = 0) {
  const files = unzip(buf);
  const sheetName = Object.keys(files).filter((f) => /^xl\/worksheets\/sheet\d+\.xml$/.test(f)).sort((a, b) => parseInt(a.match(/\d+/g).pop()) - parseInt(b.match(/\d+/g).pop()))[sheetIndex];
  if (!sheetName) throw new Error('Không thấy sheet trong file Excel.');
  const shared = files['xl/sharedStrings.xml'] ? [...files['xl/sharedStrings.xml']().toString('utf8').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => texts(m[1])) : [];
  const xml = files[sheetName]().toString('utf8');
  const rows = [];
  for (const r of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = [];
    for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1], body = c[2] || '';
      const ref = attrs.match(/\br="([A-Z]+\d+)"/)?.[1];
      if (!ref) continue;
      const t = attrs.match(/\bt="(\w+)"/)?.[1];
      const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      let val = null;
      if (t === 'inlineStr') val = texts(body);
      else if (t === 's') val = v != null ? shared[+v] ?? '' : null;
      else if (t === 'str') val = v != null ? unesc(v) : null;
      else if (v != null) val = Number(v);
      row[colIndex(ref)] = val;
    }
    rows.push(row);
  }
  return rows;
}

// Hàng đầu là tiêu đề → mảng đối tượng {tiêu đề: giá trị}.
export function readXlsxObjects(buf, sheetIndex = 0) {
  const [head, ...rows] = readXlsx(buf, sheetIndex);
  if (!head) return [];
  return rows.filter((r) => r.some((v) => v != null && v !== '')).map((r) => Object.fromEntries(head.map((h, i) => [String(h ?? '').trim(), r[i] ?? null])));
}
