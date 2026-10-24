// Bộ đọc/ghi YAML tối giản (không cần thư viện ngoài) cho file skill. Hỗ trợ đúng phần cần dùng:
//  - khoá: giá trị chuỗi/số/true/false/null, chuỗi có nháy kép "…" hoặc nháy đơn '…'
//  - danh sách một dòng [a, "b c"] và danh sách gạch đầu dòng (- mục)
//  - danh sách các đối tượng (- khoá: giá trị, các khoá còn lại thụt vào)
//  - khối chữ nhiều dòng "|" và "|-" (giữ nguyên xuống dòng)
//  - dòng chú thích bắt đầu bằng #
// Không hỗ trợ neo/alias/tag/flow-map {…}: file skill do hệ thống sinh ra và chỉ dùng cú pháp trên.

const indentOf = (l) => l.match(/^ */)[0].length;
const isBlank = (l) => !l.trim();
const isComment = (l) => /^\s*#/.test(l);

function splitInline(s) {
  const out = [];
  let cur = '', q = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { cur += c; if (c === '\\' && q === '"') { cur += s[++i] ?? ''; } else if (c === q) q = ''; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === ',') { out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim() || out.length) out.push(cur.trim());
  return out.filter((x) => x !== '');
}

function scalar(raw) {
  const s = raw.trim();
  if (s === '') return '';
  if (s[0] === '"') { try { return JSON.parse(s); } catch { return s.slice(1, -1); } }
  if (s[0] === "'") return s.slice(1, -1).replace(/''/g, "'");
  if (s[0] === '[' && s.endsWith(']')) return splitInline(s.slice(1, -1)).map(scalar);
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null' || s === '~') return null;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  return s;
}

// Tìm dấu ":" tách khoá/giá trị (ngoài dấu nháy): "khoá: giá trị" hoặc "khoá:".
function keyValue(line) {
  const m = line.match(/^([^\s:#"'\[\]-][^:]*?|"[^"]*"|'[^']*')\s*:(?:\s+(.*))?$/);
  if (!m) return null;
  const k = m[1].trim();
  return { key: k[0] === '"' || k[0] === "'" ? k.slice(1, -1) : k, rest: m[2] ?? '' };
}

export function parseYaml(src) {
  const lines = String(src).replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
  let i = 0;

  function skip() { while (i < lines.length && (isBlank(lines[i]) || isComment(lines[i]))) i++; }

  function block(headerRest, parentIndent) {
    // headerRest: "|" hoặc "|-" (có thể kèm số thụt lề)
    const strip = /-/.test(headerRest);
    const body = [];
    let ind = null;
    while (i < lines.length) {
      const l = lines[i];
      if (isBlank(l)) { body.push(''); i++; continue; }
      const n = indentOf(l);
      if (n <= parentIndent) break;
      if (ind === null) ind = n;
      if (n < ind) break;
      body.push(l.slice(ind)); i++;
    }
    while (body.length && body.at(-1) === '') body.pop();
    return body.join('\n') + (strip || !body.length ? '' : '\n');
  }

  function value(rest, indent) {
    const r = rest.trim();
    if (/^[|>][+-]?\d*$/.test(r)) return block(r, indent);
    if (r === '') return nested(indent);
    return scalar(r);
  }

  function nested(parentIndent) {
    skip();
    if (i >= lines.length || indentOf(lines[i]) <= parentIndent) return null;
    const ind = indentOf(lines[i]);
    return /^\s*- /.test(lines[i]) || /^\s*-$/.test(lines[i]) ? list(ind) : map(ind);
  }

  function map(ind) {
    const o = {};
    for (;;) {
      skip();
      if (i >= lines.length || indentOf(lines[i]) !== ind || /^\s*-( |$)/.test(lines[i])) break;
      const kv = keyValue(lines[i].trim());
      if (!kv) throw new Error(`YAML: dòng ${i + 1} không hợp lệ: ${lines[i].trim().slice(0, 60)}`);
      i++;
      o[kv.key] = value(kv.rest, ind);
    }
    return o;
  }

  function list(ind) {
    const out = [];
    for (;;) {
      skip();
      if (i >= lines.length || indentOf(lines[i]) !== ind || !/^\s*-( |$)/.test(lines[i])) break;
      const rest = lines[i].trim().slice(1).trim();
      if (rest === '') { i++; out.push(nested(ind)); continue; }
      const kv = keyValue(rest);
      if (kv && !/^["'\[]/.test(rest)) {
        // phần tử là đối tượng: "- khoá: giá trị" rồi các khoá tiếp theo thụt vào ind+2
        const o = {};
        const inner = ind + 2;
        lines[i] = ' '.repeat(inner) + rest; // coi như dòng đầu của map thụt vào inner
        Object.assign(o, map(inner));
        out.push(o);
      } else { i++; out.push(scalar(rest)); }
    }
    return out;
  }

  skip();
  if (i >= lines.length) return {};
  const first = lines[i];
  const result = /^\s*- /.test(first) ? list(indentOf(first)) : map(indentOf(first));
  skip();
  if (i < lines.length) throw new Error(`YAML: dòng ${i + 1} thụt lề không đúng: ${lines[i].trim().slice(0, 60)}`);
  return result;
}

// ---- Ghi ----
const plainSafe = (s) => s !== '' && !/^[\s\-?:,\[\]{}#&*!|>'"%@`~]/.test(s) && !/(: |\s#|:$)/.test(s) && !/\s$/.test(s)
  && !/^(true|false|null|~|-?\d+(\.\d+)?)$/i.test(s) && !s.includes('\n');
const str = (s) => (plainSafe(s) ? s : JSON.stringify(s));

function emit(v, ind, out, key) {
  const pad = ' '.repeat(ind);
  if (typeof v === 'string' && v.includes('\n') && /^\s/.test(v)) out.push(`${pad}${key}: ${JSON.stringify(v)}`); // bắt đầu bằng khoảng trắng: ghi dạng chuỗi có thoát
  else if (typeof v === 'string' && v.includes('\n')) {
    out.push(`${pad}${key}: |-`);
    for (const l of v.replace(/\n+$/, '').split('\n')) out.push(l === '' ? '' : `${pad}  ${l}`);
  } else if (Array.isArray(v)) {
    if (v.every((x) => typeof x !== 'object' || x === null)) out.push(`${pad}${key}: ${v.length ? `[${v.map((x) => (typeof x === 'string' ? (/[,\[\]]/.test(x) ? JSON.stringify(x) : str(x)) : String(x))).join(', ')}]` : '[]'}`);
    else {
      out.push(`${pad}${key}:`);
      for (const item of v) {
        const sub = [];
        for (const [k, val] of Object.entries(item)) emit(val, ind + 4, sub, k);
        // dòng đầu của đối tượng đi liền với "- "
        sub[0] = `${pad}  - ${sub[0].slice(ind + 4)}`;
        out.push(...sub);
      }
    }
  } else if (v && typeof v === 'object') {
    out.push(`${pad}${key}:`);
    for (const [k, val] of Object.entries(v)) emit(val, ind + 2, out, k);
  } else out.push(`${pad}${key}: ${typeof v === 'string' ? str(v) : v === null ? 'null' : String(v)}`);
}

export function stringifyYaml(obj) {
  const out = [];
  for (const [k, v] of Object.entries(obj)) emit(v, 0, out, k);
  return out.join('\n') + '\n';
}
