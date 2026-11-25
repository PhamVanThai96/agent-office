// Viết kịch bản ngay khi leader duyệt idea (hoặc viết lại khi leader không duyệt kịch bản).
// Gọi Claude CLI đã đăng nhập trên máy (không tốn credit API). CLI không được dùng công cụ nào:
// nó chỉ trả về JSON kịch bản, máy chủ tự kiểm tra rồi lưu vào Chờ duyệt.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const KNOWLEDGE = [
  'content-idea-agent/knowledge/kich-ban-mau.md',
  'content-idea-agent/knowledge/cach-spy-video.md',
  'content-idea-agent/knowledge/bai-hoc-duyet.md',
  'content-idea-agent/knowledge/ngay-le.md',
  'content-idea-agent/knowledge/idea-mau.md',
  'skills/03-san-pham-enzy.yaml',
  'skills/02-compliance.yaml',
];
const MODEL = process.env.SCRIPT_MODEL || 'claude-opus-5-5';
const EFFORT = process.env.SCRIPT_EFFORT || 'high';
const TIMEOUT_MS = 12 * 60e3;
const DEBOUNCE_MS = 15e3; // đợi leader duyệt xong một loạt rồi mới bắt đầu
const MAX_FAILS = 2;

function cliEnv() {
  const env = { ...process.env };
  for (const k of Object.keys(env)) {
    if (k === 'CLAUDECODE' || k.startsWith('CLAUDE_CODE_') || ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL'].includes(k)) delete env[k];
  }
  return env;
}
let claudeBin;
function findClaude() {
  if (claudeBin !== undefined) return claudeBin;
  const cands = [process.env.CLAUDE_BIN, path.join(os.homedir(), '.local/bin/claude'), path.join(os.homedir(), '.claude/local/claude'),
    '/opt/homebrew/bin/claude', '/usr/local/bin/claude', 'claude'].filter(Boolean);
  claudeBin = cands.find((c) => spawnSync(c, ['--version'], { stdio: 'ignore', timeout: 10000, env: cliEnv() }).status === 0) || null;
  return claudeBin;
}
const CLI_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kho-idea-kichban-'));

function systemPrompt() {
  const docs = KNOWLEDGE.map((f) => {
    try { return `===== ${f} =====\n${fs.readFileSync(path.join(ROOT, f), 'utf8')}`; } catch { return ''; }
  }).filter(Boolean).join('\n\n');
  return `Bạn là người viết kịch bản content cho Enzy (người đại diện là anh Tiến). Viết tiếng Việt.
Chỉ 2 sản phẩm: Hạt nêm chay Enzy (HNC) và Rắc cơm thuần chay Enzy — luôn gọi là "gia vị rắc cơm" (GVRC).
Tệp khách: khoảng 95% nữ trên 40 tuổi, khó tính, kỹ chuyện ăn uống, sợ hàng trôi nổi (độn bột, chất linh tinh), khó tin quảng cáo, ngại giá.
Làm đúng theo kich-ban-mau.md (format sheet kịch bản của team) và bai-hoc-duyet.md (quy tắc bắt buộc của CEO). Không nêu giá trên 100k, không claim y tế bị cấm, chỉ dùng chương trình sale có thật trong ngay-le.md, không bịa số liệu.
Trả lời DUY NHẤT một khối \`\`\`json chứa object {"tieuDe","voice","canhQuay","textMH","caption","cta","ghiChu"} — không viết gì ngoài khối đó.

TÀI LIỆU:
${docs}`;
}

const ideaBlock = (i) => [
  `Ngày: ${i.day}`, `Sản phẩm: ${i.sanPham || ''}`, `Thời gian: ${i.thoiGian || ''}`, `Dạng content: ${i.loai || ''}`, `Mục tiêu: ${i.mucTieu || ''}`,
  `Người phát ngôn: ${i.nguoiPhatNgon || ''}`, `Idea:\n${i.idea || ''}`, i.why ? `Vì sao chọn: ${i.why}` : '', i.linkMau ? `Link tham khảo: ${i.linkMau}` : '',
  i.gopY ? `Góp ý của leader khi duyệt idea (phải làm theo): ${i.gopY}` : '',
].filter(Boolean).join('\n');
const scriptBlock = (s) => ['tieuDe', 'voice', 'canhQuay', 'textMH', 'caption', 'cta', 'kichBan']
  .filter((k) => s[k]).map((k) => `[${k}]\n${s[k]}`).join('\n\n');

function userPrompt(job, ctx) {
  const parts = [];
  if (ctx.lessons.length) parts.push('Góp ý gần đây của leader cho các kịch bản khác (tránh lặp lỗi):\n' + ctx.lessons.map((g) => '- ' + g).join('\n'));
  if (ctx.edited) parts.push('Leader đã TỰ SỬA câu chữ một kịch bản như dưới đây — học cách hành văn, độ dài và chỗ leader hay sửa:\n--- TRƯỚC KHI SỬA ---\n' + scriptBlock(ctx.edited.before) + '\n--- LEADER SỬA THÀNH ---\n' + scriptBlock(ctx.edited.after));
  if (ctx.approved) parts.push('Một kịch bản leader ĐÃ DUYỆT gần đây (học giọng và độ dài, không chép):\n' + scriptBlock(ctx.approved));
  parts.push('IDEA LEADER ĐÃ DUYỆT:\n' + ideaBlock(job.idea));
  if (job.kind === 'rewrite') {
    parts.push(`KỊCH BẢN BẢN ${job.script.version || 1} BỊ LEADER KHÔNG DUYỆT:\n${scriptBlock(job.script)}`);
    parts.push(`GÓP Ý CỦA LEADER: ${job.script.gopY || '(không ghi)'}\n\nViết lại TOÀN BỘ kịch bản: sửa đúng những điểm được góp ý, giữ phần không bị chê. Thêm trường "daSua": liệt kê ngắn gọn (mỗi ý 1 dòng, bắt đầu bằng "- ") đã sửa những gì theo từng ý góp ý, để leader nhận ra ngay.`);
  } else parts.push('Viết kịch bản hoàn chỉnh cho idea này.');
  return parts.join('\n\n');
}

function runClaude(system, prompt) {
  const bin = findClaude();
  if (!bin) return Promise.reject(new Error('Không tìm thấy lệnh "claude" trên máy.'));
  const args = ['-p', '--output-format', 'json', '--model', MODEL, '--effort', EFFORT, '--system-prompt', system,
    '--tools', '', '--strict-mcp-config', '--setting-sources', '', '--no-session-persistence'];
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd: CLI_DIR, env: cliEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    const t = setTimeout(() => child.kill('SIGTERM'), TIMEOUT_MS);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(t); reject(e); });
    child.on('close', (code) => {
      clearTimeout(t);
      let r = null;
      try { r = JSON.parse(out); } catch {}
      if (r && !r.is_error && typeof r.result === 'string') return resolve(r.result);
      const msg = r?.result || err.trim() || out.trim().slice(0, 300) || `claude thoát với mã ${code}`;
      // Hết lượt dùng Claude của tài khoản (giới hạn phiên/tuần): không tính là lỗi của kịch bản, tạm dừng rồi tự viết tiếp
      if (/session limit|usage limit|rate limit|hit your .*limit|resets \d/i.test(msg)) {
        const m = /resets ([0-9:]+\s*[ap]m)/i.exec(msg);
        return reject(Object.assign(new Error(`Tài khoản Claude đã hết lượt dùng${m ? `, mở lại lúc ${m[1]}` : ''}. Agent sẽ tự viết tiếp khi có lượt.`), { limit: true, resetAt: m ? m[1] : '' }));
      }
      if (/not logged in|authenticat|log ?in|oauth|\/login/i.test(msg)) return reject(Object.assign(new Error('Claude trên máy chưa đăng nhập. Mở Terminal chạy: claude auth login'), { auth: true }));
      reject(new Error(String(msg).slice(0, 400)));
    });
    child.stdin.end(prompt);
  });
}

function parseScript(text) {
  const m = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const raw = (m ? m[1] : text).trim();
  const body = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
  let o;
  try { o = JSON.parse(body); } catch {
    // Model đôi khi để xuống dòng thật trong chuỗi JSON → đổi thành \n rồi đọc lại
    let fixed = '', inStr = false, esc = false;
    for (const ch of body) {
      if (inStr && !esc && (ch === '\n' || ch === '\r' || ch === '\t')) { fixed += ch === '\n' ? '\\n' : ch === '\t' ? '\\t' : ''; continue; }
      if (ch === '"' && !esc) inStr = !inStr;
      esc = inStr && ch === '\\' && !esc;
      fixed += ch;
    }
    o = JSON.parse(fixed);
  }
  const out = {};
  for (const k of ['tieuDe', 'voice', 'canhQuay', 'textMH', 'caption', 'cta', 'ghiChu', 'kichBan', 'daSua']) if (typeof o[k] === 'string') out[k] = o[k].trim();
  if (!out.voice && !out.kichBan && !out.caption) throw new Error('Agent trả về kịch bản rỗng.');
  return out;
}

// Thời gian chờ đến giờ mở lại lượt (vd "7:30pm", giờ máy), cộng 2 phút; không đọc được thì thử lại sau 30 phút
function untilReset(at) {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*([ap]m)$/i.exec(String(at || '').trim());
  if (!m) return 30 * 60e3;
  let h = Number(m[1]) % 12 + (m[3].toLowerCase() === 'pm' ? 12 : 0);
  const t = new Date(); t.setHours(h, Number(m[2] || 0) + 2, 0, 0);
  if (t <= new Date()) t.setDate(t.getDate() + 1);
  return Math.min(t - new Date(), 24 * 3600e3);
}

// api: { listIdeas(), listScripts(), createScript(input), rewriteScript(id, input), log }
export function createWriter(api) {
  const state = { running: false, current: null, errors: new Map(), fails: new Map(), authError: '', lastDone: null };
  let timer = null;

  function pending() {
    const ideas = api.listIdeas();
    const scripts = api.listScripts();
    const has = new Set(scripts.map((s) => s.ideaId));
    const byId = new Map(ideas.map((i) => [i.id, i]));
    const jobs = [];
    for (const s of scripts) {
      if (s.duyet === 'khong' && byId.get(s.ideaId) && (state.fails.get('r:' + s.id + ':' + s.version) || 0) < MAX_FAILS) jobs.push({ kind: 'rewrite', key: 'r:' + s.id + ':' + s.version, idea: byId.get(s.ideaId), script: s });
    }
    for (const i of ideas.filter((x) => x.duyet === 'duyet' && !has.has(x.id)).sort((a, b) => String(a.duyetLuc || a.day).localeCompare(String(b.duyetLuc || b.day)))) {
      if ((state.fails.get('n:' + i.id) || 0) < MAX_FAILS) jobs.push({ kind: 'new', key: 'n:' + i.id, idea: i });
    }
    return jobs;
  }

  async function loop() {
    if (state.running) return;
    state.running = true;
    try {
      for (;;) {
        const job = pending()[0];
        if (!job) break;
        state.current = { kind: job.kind, ideaId: job.idea.id, since: new Date().toISOString() };
        try {
          const scripts = api.listScripts();
          const lessons = scripts.flatMap((s) => [s.duyet === 'khong' ? s.gopY : '', ...(s.lichSu || []).map((h) => h.gopY)]).filter(Boolean).slice(-8);
          const approved = scripts.filter((s) => s.duyet === 'duyet').sort((a, b) => String(b.duyetLuc || '').localeCompare(String(a.duyetLuc || '')))[0];
          const ed = scripts.filter((s) => s.lichSu?.some((h) => h.duyet === 'sua')).sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))[0];
          const edited = ed ? { before: [...ed.lichSu].reverse().find((h) => h.duyet === 'sua'), after: ed } : null;
          const text = await runClaude(systemPrompt(), userPrompt(job, { lessons, approved, edited }));
          const body = parseScript(text);
          if (job.kind === 'rewrite') api.rewriteScript(job.script.id, body);
          else api.createScript({ ideaId: job.idea.id, ...body });
          state.errors.delete(job.idea.id); state.authError = ''; state.lastDone = new Date().toISOString();
          api.log(`[kịch bản] ${job.kind === 'rewrite' ? 'Đã viết lại' : 'Đã viết'} cho idea ${job.idea.id}`);
        } catch (e) {
          if (e.auth) { state.authError = e.message; api.log('[kịch bản] ' + e.message); break; }
          if (e.limit) {
            state.authError = e.message; api.log('[kịch bản] ' + e.message);
            clearTimeout(timer); timer = setTimeout(() => { state.authError = ''; loop(); }, untilReset(e.resetAt));
            break;
          }
          state.fails.set(job.key, (state.fails.get(job.key) || 0) + 1);
          state.errors.set(job.idea.id, String(e.message || e).slice(0, 300));
          api.log(`[kịch bản] Lỗi idea ${job.idea.id}: ${e.message}`);
        }
      }
    } finally { state.running = false; state.current = null; }
  }

  return {
    // Gọi khi leader duyệt idea / không duyệt kịch bản. Đợi một chút để gom nhiều lần duyệt.
    kick(delay = DEBOUNCE_MS) { clearTimeout(timer); timer = setTimeout(loop, delay); },
    retry(ideaId) {
      for (const k of [...state.fails.keys()]) if (k.includes(ideaId)) state.fails.delete(k);
      for (const s of api.listScripts().filter((x) => x.ideaId === ideaId)) state.fails.delete('r:' + s.id + ':' + s.version);
      state.errors.delete(ideaId); state.authError = '';
      this.kick(500);
    },
    status() {
      const jobs = pending();
      return { running: state.running, current: state.current, queue: jobs.map((j) => ({ kind: j.kind, ideaId: j.idea.id })),
        errors: Object.fromEntries(state.errors), authError: state.authError, lastDone: state.lastDone };
    },
  };
}
