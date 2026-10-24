import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

// Công cụ "run_command" cho agent: chạy lệnh trong thư mục dự án để đọc, chẩn đoán lỗi và tạo file mới.
// Phân loại mỗi lệnh trước khi chạy:
//  - safe: lệnh chỉ đọc (ls, cat, grep, find, git status/diff, node --check…) hoặc chỉ TẠO MỚI (mkdir, touch, cp sang đường dẫn chưa có) trong thư mục dự án → chạy ngay,
//          đã kiểm tra từng token (không để lọt ;, &&, >, $(), backtick…) và dựng lại câu lệnh an toàn;
//  - ask : mọi lệnh khác (có thể sửa/xoá file có sẵn, cài gói, mạng…) → phải được người dùng cho phép đúng câu lệnh đó;
//  - deny: nguy hiểm (sudo, rm -rf /, đọc biến môi trường chứa khoá, chạm file được bảo vệ…) → không bao giờ chạy.
const WIN = process.platform === 'win32';
const OUT_HEAD = 4000, OUT_TAIL = 1500, ERR_MAX = 2500;
const DEFAULT_TIMEOUT = 15, MAX_TIMEOUT = 60;

// Biến môi trường có thể chứa khoá/mật khẩu: không đưa vào tiến trình con.
const ENV_KEEP = ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TMPDIR', 'USER', 'SHELL', 'TERM'];
const cleanEnv = () => Object.fromEntries(ENV_KEEP.filter((k) => process.env[k]).map((k) => [k, process.env[k]]));

// Chặn tuyệt đối, kể cả khi người dùng muốn cho phép.
const CMD = String.raw`(^|[|;&(]\s*)`;
const DENY = [
  [new RegExp(CMD + String.raw`(sudo|doas|su)(\s|$)`), 'Không chạy lệnh nâng quyền (sudo/su).'],
  [new RegExp(CMD + String.raw`(mkfs\S*|fdisk|shutdown|reboot|halt|poweroff|diskutil\s+erase\w*)(\s|$)`), 'Lệnh đĩa/tắt máy bị chặn.'],
  [/\bdd\s+[^|]*\bof=/, 'Lệnh dd ghi đè thiết bị/file bị chặn.'],
  [/:\(\)\s*\{/, 'Mẫu fork bomb bị chặn.'],
  [/\brm\s+(-[a-zA-Z]*\s+)*(\/|~|\$HOME|\.\.)(\s|$|\/\*)/, 'Không xoá thư mục gốc/thư mục nhà/thư mục cha.'],
  [/(curl|wget)[^|]*\|\s*(sh|bash|zsh|python3?|node)\b/, 'Không tải rồi chạy thẳng mã từ mạng.'],
  [new RegExp(CMD + String.raw`(printenv|env|set|export|declare|compgen)(\s|$)`), 'Không xem biến môi trường (có thể chứa khoá API).'],
  [/(^|[\s/])(config\.json|enzy\.json|permissions\.json|agents\.json|workflows\.json|admin\.json)\b/i, 'File cấu hình/khoá được bảo vệ, agent không được đọc hay sửa.'],
  [/(^|[\s/])(data\/agents|data\/usage|skills)(\/|\s|$)/, 'Thư mục kỹ năng/trí nhớ của agent được bảo vệ.'],
  [/(^|[\s/])(\.env[\w.]*|id_rsa[\w.]*|[\w.-]*\.pem|\.ssh|\.aws|\.npmrc|\.netrc)(\s|$|\/)/i, 'File khoá/bí mật được bảo vệ.'],
];

const NO_PATH = { paths: 'none' };
const SAFE = {
  ls: { paths: 'all' }, cat: { paths: 'all' }, head: { paths: 'all', val: ['-n', '-c'] }, tail: { paths: 'all', val: ['-n', '-c'], deny: [/^-f$|^-F$|^--follow/] },
  wc: { paths: 'all' }, stat: { paths: 'all' }, file: { paths: 'all' }, du: { paths: 'all', val: ['-d', '--max-depth'] }, diff: { paths: 'all' },
  realpath: { paths: 'all' }, basename: NO_PATH, dirname: NO_PATH, tree: { paths: 'all', val: ['-L'] },
  grep: { paths: 'rest', val: ['-m', '-A', '-B', '-C', '--max-count'], deny: [/^-[a-zA-Z]*[ef]$|^--(regexp|file)/] },
  find: { paths: 'find', deny: [/^-(exec|execdir|ok|okdir|delete|fprint\w*|fls)$/] },
  pwd: NO_PATH, echo: NO_PATH, date: { paths: 'none', deny: [/^-s$|^--set/] }, which: NO_PATH, whoami: NO_PATH, uname: NO_PATH,
  sort: { paths: 'all', val: ['-k', '-t'], deny: [/^-o$|^--output/] }, uniq: { paths: 'all' }, cut: { paths: 'all', val: ['-d', '-f', '-c'] }, tr: { paths: 'all' },
};
const GIT_OK = new Set(['status', 'log', 'diff', 'show', 'branch', 'rev-parse', 'ls-files', 'blame', 'shortlog', 'describe']);

// ---- Tách lệnh thành các đoạn (cách nhau bởi |) và token; mọi ký tự điều khiển shell ngoài dấu nháy → "phức tạp" ----
function tokenize(command) {
  const segs = [[]];
  let cur = null, quote = '', complex = '';
  const push = () => { if (cur) { segs.at(-1).push(cur); cur = null; } };
  const add = (ch, q) => { cur ||= { text: '', quoted: false, glob: false }; cur.text += ch; if (q) cur.quoted = true; };
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (quote === "'") { if (ch === "'") quote = ''; else add(ch, true); continue; }
    if (quote === '"') {
      if (ch === '"') quote = '';
      else if (ch === '$' || ch === '`' || ch === '\\') complex ||= `ký tự "${ch}" trong dấu nháy kép`;
      else add(ch, true);
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; cur ||= { text: '', quoted: true, glob: false }; cur.quoted = true; continue; }
    if (/\s/.test(ch)) { if (ch === '\n') complex ||= 'xuống dòng'; push(); continue; }
    if (ch === '|') { if (command[i + 1] === '|') { complex ||= '||'; i++; } push(); segs.push([]); continue; }
    if (';&<>(){}`$\\!#'.includes(ch)) { complex ||= `ký tự điều khiển "${ch}"`; add(ch, false); continue; }
    if (ch === '*' || ch === '?' || ch === '[' || ch === ']') { add(ch, false); cur.glob = true; continue; }
    if (ch === '~' && !cur) { complex ||= 'dấu ~'; add(ch, false); continue; }
    add(ch, false);
  }
  if (quote) complex ||= 'dấu nháy chưa đóng';
  push();
  return { segs, complex };
}

const shq = (t) => `'${String(t).replace(/'/g, `'\\''`)}'`;

/**
 * ctx: { root (thư mục dự án, đã realpath), cwd, resolve(p) → đường dẫn thật, isSecret(c), isProtected(c) }
 * Trả về { level: 'safe'|'ask'|'deny', reason, shell? } — shell là câu lệnh đã dựng lại an toàn (khi safe).
 */
export function classify(command, ctx) {
  const text = String(command ?? '').trim();
  if (!text) return { level: 'deny', reason: 'Lệnh trống.' };
  if (text.length > 600) return { level: 'deny', reason: 'Lệnh quá dài (tối đa 600 ký tự).' };
  if (WIN) return { level: 'deny', reason: 'run_command chưa hỗ trợ Windows.' };
  for (const [re, reason] of DENY) if (re.test(text)) return { level: 'deny', reason };

  const { segs, complex } = tokenize(text);
  if (complex) return { level: 'ask', reason: `Lệnh dùng ${complex} nên không thể kiểm tra tự động.` };
  if (segs.some((s) => !s.length)) return { level: 'ask', reason: 'Lệnh có đoạn trống.' };
  const inside = (c) => c === ctx.root || c.startsWith(ctx.root + path.sep);
  const pathBad = (tok, { mustNotExist = false } = {}) => {
    const c = ctx.resolve(tok.text);
    if (!inside(c)) return `Đường dẫn ngoài thư mục dự án: ${tok.text}`;
    if (ctx.isSecret(c)) return `File bí mật, không được đọc: ${tok.text}`;
    if (mustNotExist && (ctx.isProtected(c) || fs.existsSync(c))) return `Đã có hoặc được bảo vệ (cần xin quyền): ${tok.text}`;
    return '';
  };
  const parts = [];
  for (const seg of segs) {
    const prog = seg[0].text, args = seg.slice(1);
    if (seg[0].quoted || seg[0].glob || /[\\/]/.test(prog)) return { level: 'ask', reason: `Chương trình "${prog}" không nằm trong danh sách chạy tự động.` };
    const bad = (why) => ({ level: 'ask', reason: why });
    const opts = args.filter((a) => !a.quoted && a.text.startsWith('-'));

    if (prog === 'mkdir' || prog === 'touch') {
      const targets = args.filter((a) => !(a.text.startsWith('-') && !a.quoted));
      if (!targets.length) return bad(`${prog} thiếu đường dẫn.`);
      if (opts.some((o) => !/^-(p|v)$/.test(o.text))) return bad(`${prog} có tuỳ chọn ngoài danh sách tự động.`);
      for (const t of targets) { const e = t.glob ? 'Không dùng ký tự đại diện khi tạo.' : pathBad(t, { mustNotExist: prog === 'touch' }); if (e) return bad(e); if (prog === 'mkdir' && ctx.isProtected(ctx.resolve(t.text))) return bad(`Thư mục được bảo vệ: ${t.text}`); }
    } else if (prog === 'cp') {
      const files = args.filter((a) => !(a.text.startsWith('-') && !a.quoted));
      if (files.length !== 2 || opts.some((o) => !/^-(r|R|v)$/.test(o.text)) || files.some((f) => f.glob)) return bad('cp chỉ tự động khi sao chép 1 nguồn sang 1 đường dẫn chưa có.');
      const e = pathBad(files[0]) || pathBad(files[1], { mustNotExist: true });
      if (e) return bad(e);
    } else if (prog === 'node') {
      if (!(args.length === 2 && /^(--check|-c)$/.test(args[0].text)) && !(args.length === 1 && /^(--version|-v)$/.test(args[0].text))) return bad('node chỉ tự động với --check <file> hoặc --version.');
      if (args.length === 2) { const e = pathBad(args[1]); if (e) return bad(e); }
    } else if (prog === 'npm') {
      if (!['ls', 'list', 'outdated', '--version', '-v'].includes(args[0]?.text) || args.some((a) => /^--(prefix|global|registry|userconfig)/.test(a.text))) return bad('npm chỉ tự động với ls / outdated / --version.');
    } else if (prog === 'git') {
      const sub = args[0]?.text;
      if (!GIT_OK.has(sub) && !(sub === 'remote' && args[1]?.text === '-v')) return bad('git chỉ tự động với các lệnh xem (status, log, diff, show, branch…).');
      if (args.some((a) => /^(--output|-o$|--ext-diff|--textconv|-c$|--exec-path|--upload-pack)/.test(a.text))) return bad('git có tuỳ chọn không tự động.');
      for (const a of args.slice(1)) if (!a.text.startsWith('-') && /[\\/]/.test(a.text) && !a.glob) { const e = pathBad(a); if (e) return bad(e); }
    } else {
      const spec = SAFE[prog];
      if (!spec) return bad(`Chương trình "${prog}" không nằm trong danh sách chạy tự động.`);
      if (spec.deny && opts.some((o) => spec.deny.some((re) => re.test(o.text)))) return bad(`${prog} có tuỳ chọn không tự động.`);
      const pathArgs = [];
      if (spec.paths === 'find') { // đối số trước tuỳ chọn/biểu thức đầu tiên là đường dẫn
        for (const a of args) { if ((!a.quoted && a.text.startsWith('-')) || a.text === '!' || a.text === '(') break; pathArgs.push(a); }
        if (!pathArgs.length) pathArgs.push({ text: '.', quoted: true });
      } else {
        let skip = false, pattern = spec.paths !== 'rest';
        for (const a of args) {
          if (skip) { skip = false; continue; }
          if (!a.quoted && a.text.startsWith('-')) { if (spec.val?.includes(a.text)) skip = true; continue; }
          if (!pattern) { pattern = true; continue; } // grep: đối số đầu là mẫu tìm, các đối số sau là file
          if (spec.paths === 'all' || spec.paths === 'rest') pathArgs.push(a);
        }
      }
      for (const a of pathArgs) { if (a.glob && !/^[\w./*?\[\]-]+$/.test(a.text)) return bad('Ký tự đại diện không hợp lệ.'); const e = pathBad(a.glob ? { text: a.text.replace(/[*?[\]].*$/, '') || '.' } : a); if (e) return bad(e); }
    }
    parts.push([seg[0], ...args].map((t) => (t.glob && !t.quoted ? t.text : shq(t.text))).join(' '));
  }
  return { level: 'safe', shell: parts.join(' | ') };
}

// Phát hiện lệnh có thể làm thay đổi/xoá để ghi rõ cho người dùng khi xin quyền.
export const risky = (command) => /\b(rm|mv|sed\s+-i|truncate|chmod|chown|npm\s+(install|i|uninstall|update)|pip|git\s+(commit|push|reset|checkout|clean|rebase|merge)|tee)\b|>/.test(command);

// ---- Chạy lệnh (đã được phân loại/cho phép) ----
export function execute(shell, { cwd, timeoutS = DEFAULT_TIMEOUT }) {
  const limit = Math.min(Math.max(Number(timeoutS) || DEFAULT_TIMEOUT, 1), MAX_TIMEOUT) * 1000;
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn('sh', ['-c', shell], { cwd, env: cleanEnv(), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    let out = '', err = '', outBytes = 0, timedOut = false, done = false;
    const kill = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* đã thoát */ } } };
    const timer = setTimeout(() => { timedOut = true; kill(); }, limit);
    const take = (chunk, which) => {
      outBytes += chunk.length;
      if (outBytes > 2_000_000) { kill(); return; }
      if (which === 'out') { if (out.length < OUT_HEAD * 8) out += chunk; } else if (err.length < ERR_MAX * 4) err += chunk;
    };
    child.stdout.on('data', (d) => take(d.toString('utf8'), 'out'));
    child.stderr.on('data', (d) => take(d.toString('utf8'), 'err'));
    const finish = (code, signal, spawnErr) => {
      if (done) return; done = true; clearTimeout(timer);
      resolve({ exitCode: spawnErr ? 126 : code ?? (signal ? 128 : 0), signal: signal || undefined, timedOut, stdout: out, stderr: spawnErr ? spawnErr.message : err, ms: Date.now() - t0 });
    };
    child.on('error', (e) => finish(null, null, e));
    child.on('close', (code, signal) => finish(code, signal));
  });
}

const trimOut = (s) => (s.length > OUT_HEAD + OUT_TAIL ? `${s.slice(0, OUT_HEAD)}\n…(bỏ ${s.length - OUT_HEAD - OUT_TAIL} ký tự)…\n${s.slice(-OUT_TAIL)}` : s);

// Mã nguồn quanh dòng lỗi (file:dòng) để agent chẩn đoán mà không phải gọi thêm công cụ.
function snippet(file, line, ctx) {
  try {
    const c = ctx.resolve(file);
    if (!(c === ctx.root || c.startsWith(ctx.root + path.sep)) || ctx.isSecret(c)) return '';
    const lines = fs.readFileSync(c, 'utf8').split('\n');
    const from = Math.max(0, line - 3), to = Math.min(lines.length, line + 2);
    return lines.slice(from, to).map((l, i) => `${from + i + 1}${from + i + 1 === line ? '>' : ' '} ${l.slice(0, 160)}`).join('\n');
  } catch { return ''; }
}

// Gợi ý chẩn đoán lỗi bằng quy tắc (không tốn token): nguyên nhân khả dĩ + hướng xử lý.
export function hints(r, command, ctx) {
  const out = [], e = `${r.stderr}\n${r.stdout}`;
  if (r.timedOut) out.push('Lệnh quá thời gian và đã bị dừng: có thể đang chờ nhập, quét thư mục quá lớn hoặc treo. Thu hẹp phạm vi (thêm đường dẫn/đối số) hoặc tăng timeout_s.');
  if (r.exitCode === 127 || /command not found|not found$/m.test(r.stderr)) out.push('Không có chương trình này trên máy (hoặc sai tên). Kiểm tra bằng "which <tên>"; dùng lệnh thay thế có sẵn (vd grep/find/cat) hoặc báo người dùng cài đặt.');
  if (/No such file or directory|ENOENT|cannot access|không tồn tại/i.test(e)) out.push(`Đường dẫn không tồn tại (thư mục đang chạy: ${ctx.cwdRel || '.'}). Dùng "ls" xem thư mục, kiểm tra chính tả/chữ hoa thường và đường dẫn tương đối.`);
  if (/Permission denied|EACCES|EPERM|Operation not permitted/i.test(e)) out.push('Không đủ quyền truy cập. Đừng tự đổi quyền hệ thống; hãy báo người dùng hoặc dùng đường dẫn khác trong thư mục dự án.');
  const mod = e.match(/Cannot find (?:module|package) '([^']+)'/);
  if (mod) out.push(`Thiếu module "${mod[1]}": kiểm tra tên import/đường dẫn; nếu là gói npm thì cần "npm install ${mod[1]}" (cần người dùng cho phép).`);
  if (/EADDRINUSE/.test(e)) out.push('Cổng đang được tiến trình khác dùng. Đổi cổng hoặc dừng tiến trình cũ (hỏi người dùng).');
  if (/ENOSPC|No space left/i.test(e)) out.push('Hết dung lượng đĩa. Báo người dùng dọn dẹp (uploads/, reports/, data/).');
  if (/SyntaxError|Unexpected token|Unexpected end of|Unterminated/i.test(e)) {
    out.push('Lỗi cú pháp trong mã/dữ liệu. Xem đoạn mã quanh dòng lỗi bên dưới, kiểm tra dấu ngoặc/dấu nháy/dấu phẩy.');
    const m = e.match(/([\w./-]+\.(?:js|mjs|cjs|json|py)):(\d+)/);
    if (m) { const s = snippet(m[1], Number(m[2]), ctx); if (s) out.push(`Mã quanh ${m[1]}:${m[2]}:\n${s}`); }
  }
  const jp = e.match(/in JSON at position (\d+)|JSON\.parse|Unexpected token .* is not valid JSON/);
  if (jp && /json/i.test(command)) out.push('File JSON sai định dạng: kiểm tra dấu phẩy thừa/thiếu, dấu nháy kép, dấu ngoặc đóng.');
  if (/not a git repository/i.test(e)) out.push('Thư mục này không phải kho git (hoặc chưa git init).');
  if (/^Traceback/m.test(e)) out.push('Python báo lỗi: đọc dòng cuối của Traceback để biết nguyên nhân.');
  if (r.exitCode === 1 && !r.stderr.trim() && /\bgrep\b/.test(command)) out.push('grep không tìm thấy kết quả khớp (không phải lỗi hệ thống). Thử từ khoá khác hoặc bỏ -w/-x.');
  if (r.exitCode === 0 && !out.length) return [];
  if (!out.length && r.exitCode !== 0) out.push(`Lệnh kết thúc với mã ${r.exitCode}. Đọc stderr để biết nguyên nhân; thử chạy phần nhỏ hơn của lệnh để khoanh vùng.`);
  return out.slice(0, 5);
}

export function formatResult(r, command, ctx) {
  const h = hints(r, command, ctx);
  return {
    exitCode: r.exitCode, ok: r.exitCode === 0 && !r.timedOut, ms: r.ms,
    stdout: trimOut(r.stdout), ...(r.stderr.trim() ? { stderr: r.stderr.slice(0, ERR_MAX) } : {}),
    ...(h.length ? { hints: h } : {}),
  };
}
