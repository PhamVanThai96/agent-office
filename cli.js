import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { record, estimate } from './usage.js';

// Cầu nối tới các CLI đã đăng nhập sẵn trên máy (Claude Code, Codex, Gemini CLI).
// Prompt đi qua stdin; CLI chạy trong thư mục tạm rỗng để không tự đọc/sửa file của bạn.
// Mọi truy cập file của agent vẫn đi qua cơ chế xin quyền của ứng dụng.
const WIN = process.platform === 'win32';
const TIMEOUT_MS = 420000; // báo cáo dài (trend, kế hoạch content) có thể mất vài phút
const MAX_STEPS = 6;
const FINAL_NOTE = '\n\n[Hệ thống] Đã hết lượt gọi công cụ. KHÔNG gọi công cụ nữa: hãy trả lời NGAY bằng thông tin đã thu thập được (kể cả skill/đồng nghiệp), nêu rõ phần nào chưa xác thực và vì sao.';
const SAFE_MODEL = /^[A-Za-z0-9][\w.:/-]*$/;
const SECRET_ENV = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY'];

// GUI apps và tiến trình con đôi khi nhận PATH ngắn hơn terminal. Tìm executable
// trong PATH hiện tại và các vị trí cài phổ biến; không dùng shell để phân giải tên.
export function resolveCommand(cmd) {
  if (typeof cmd !== 'string' || !cmd.trim()) return null;
  const name = cmd.trim();
  const candidates = [];
  const suffixes = WIN && !path.extname(name) ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';') : [''];
  const add = (candidate) => { for (const suffix of suffixes) candidates.push(candidate + suffix); };
  if (path.isAbsolute(name) || name.includes(path.sep)) add(name);
  else {
    for (const dir of (process.env.PATH || '').split(path.delimiter).filter(Boolean)) add(path.join(dir, name));
    if (process.platform === 'darwin') {
      // Đường dẫn cài kèm chỉ dành cho đúng lệnh của nó, tránh "claude" bị phân giải thành codex.
      if (name === 'codex') {
        const bundled = path.join(os.homedir(), 'Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex');
        candidates.push('/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex', bundled);
      }
      if (name === 'claude') candidates.push(path.join(os.homedir(), '.claude/local/claude'));
      candidates.push('/opt/homebrew/bin/' + name, '/usr/local/bin/' + name);
    }
    if (!WIN) {
      // Bộ cài chính thức của Claude Code đặt CLI ở ~/.local/bin; npm global có thể ở ~/.npm-global hoặc nvm.
      const home = os.homedir();
      candidates.push(path.join(home, '.local/bin', name), path.join(home, '.npm-global/bin', name));
      try {
        const nvm = path.join(home, '.nvm/versions/node');
        for (const v of fs.readdirSync(nvm).sort().reverse()) candidates.push(path.join(nvm, v, 'bin', name));
      } catch { /* không có nvm */ }
    }
  }
  for (const candidate of candidates) {
    try { fs.accessSync(candidate, WIN ? fs.constants.F_OK : fs.constants.X_OK); return candidate; } catch { /* thử vị trí khác */ }
  }
  return null;
}

// Xoá khoá API khỏi môi trường của CLI để nó dùng phiên đăng nhập thay vì tính tiền theo API.
const childEnv = () => {
  const env = { ...process.env };
  for (const k of SECRET_ENV) delete env[k];
  return env;
};

// Trên Windows lệnh như claude.cmd cần shell, nên tự đặt ngoặc kép cho tham số có khoảng trắng.
const quote = (a) => (WIN && /[\s"*]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);

export function detect(cmd) {
  const executable = resolveCommand(cmd);
  if (!executable) return false;
  const r = spawnSync(executable, ['--version'], { shell: WIN, timeout: 10000, env: childEnv(), stdio: 'ignore' });
  return r.status === 0;
}

// Kiểm tra phiên đăng nhập sẵn có của CLI. Không trả stdout/stderr về giao diện
// vì một số phiên bản có thể in thông tin tài khoản hoặc cấu hình.
export function authStatus(provider, cmd) {
  const args = provider === 'gpt' ? ['login', 'status'] : ['auth', 'status'];
  return new Promise((resolve) => {
    const executable = resolveCommand(cmd);
    if (!executable) { resolve(false); return; }
    let done = false;
    const child = spawn(executable, args, { env: childEnv(), stdio: ['ignore', 'ignore', 'ignore'], shell: WIN });
    const finish = (ok) => { if (done) return; done = true; clearTimeout(timer); resolve(ok); };
    const timer = setTimeout(() => { child.kill(); finish(false); }, 15000);
    child.on('error', () => finish(false));
    child.on('close', (code) => finish(code === 0));
  });
}

// Đăng nhập CLI ngay từ giao diện: chạy `claude auth login` / `codex login` trên máy server.
// CLI tự mở trình duyệt; ta chỉ bắt đường link (để mở lại nếu cần) và chuyển mã dán vào stdin.
// Không trả stdout/stderr thô về giao diện — chỉ URL https và trạng thái.
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;
let login = null;

export function loginStart(provider, cmd) {
  if (login?.state === 'running') return loginInfo();
  const executable = resolveCommand(cmd);
  if (!executable) throw new Error(`Không tìm thấy CLI "${cmd}".`);
  const args = provider === 'gpt' ? ['login'] : ['auth', 'login'];
  const child = spawn(executable, args, { env: childEnv(), stdio: ['pipe', 'pipe', 'pipe'], shell: WIN });
  const s = login = { provider, state: 'running', url: '', child };
  const onData = (d) => {
    if (s.url) return;
    const m = d.toString().replace(ANSI, '').match(/https:\/\/[^\s"'<>]+/);
    if (m) s.url = m[0];
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.stdin.on('error', () => { /* CLI đã thoát */ });
  const timer = setTimeout(() => { if (s.state === 'running') { s.state = 'failed'; child.kill(); } }, LOGIN_TIMEOUT_MS);
  child.on('error', () => { clearTimeout(timer); if (s.state === 'running') s.state = 'failed'; });
  child.on('close', (code) => { clearTimeout(timer); if (s.state === 'running') s.state = code === 0 ? 'done' : 'failed'; });
  return loginInfo();
}

export const loginInfo = () => (login ? { provider: login.provider, state: login.state, url: login.url } : { state: 'idle', url: '' });

export function loginCode(code) {
  if (login?.state !== 'running') throw new Error('Chưa có phiên đăng nhập đang chạy.');
  if (!/^[\w#.~%=+\/-]{6,600}$/.test(code)) throw new Error('Mã không hợp lệ.');
  login.child.stdin.write(code + '\n');
}

export function loginCancel() {
  if (login?.state === 'running') { login.state = 'failed'; login.child.kill(); }
}

// Claude CLI trả JSON {result, modelUsage}: lấy văn bản trả lời và ghi nhớ model thật đã chạy để giao diện hiển thị.
const MODEL_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data', 'cli-models.json');
let usedModel = {};
try { usedModel = JSON.parse(fs.readFileSync(MODEL_FILE, 'utf8')); } catch { /* chưa có */ }
let onModel = () => {};
export const onModelFound = (fn) => { onModel = fn; };
export const lastModel = (provider) => usedModel[provider] || '';
function rememberModel(provider, m) {
  if (!m || usedModel[provider] === m) return;
  usedModel[provider] = m;
  try { fs.mkdirSync(path.dirname(MODEL_FILE), { recursive: true }); fs.writeFileSync(MODEL_FILE, JSON.stringify(usedModel)); } catch { /* chỉ là bộ nhớ đệm */ }
  onModel();
}
// Gọi một lượt rất ngắn để biết CLI đang dùng model nào (chỉ khi chưa biết).
export async function discoverModel(provider, cmd) {
  if (provider !== 'claude' || usedModel.claude) return;
  try { await run({ provider, cmd, model: '', system: 'Reply with one word.', prompt: 'ok' }); } catch { /* không sao, thử lại lần sau */ }
}
function claudeResult(out, rec) {
  try {
    const o = JSON.parse(out);
    if (typeof o?.result !== 'string') return out;
    const mu = Object.entries(o.modelUsage || {});
    rememberModel('claude', mu[0]?.[0]);
    for (const [model, u] of mu) {
      rec({ model, input: (u.inputTokens || 0) + (u.cacheReadInputTokens || 0) + (u.cacheCreationInputTokens || 0), cached: u.cacheReadInputTokens, output: u.outputTokens });
    }
    if (!mu.length && o.usage) rec({ model: '', input: (o.usage.input_tokens || 0) + (o.usage.cache_read_input_tokens || 0) + (o.usage.cache_creation_input_tokens || 0), cached: o.usage.cache_read_input_tokens, output: o.usage.output_tokens });
    return o.result.trim();
  } catch { return out; }
}

// Codex/Gemini CLI không trả JSON: đọc dòng "tokens used N" nếu có, không thì ước tính theo độ dài (đánh dấu ước tính).
function otherUsage(provider, model, text, err, input, rec) {
  const all = `${err}\n${text}`;
  const total = Number((all.match(/tokens used\D{0,10}([\d][\d,.]*)/i)?.[1] || '').replace(/[,.]/g, ''));
  const m = model || all.match(/^model:\s*(\S+)/mi)?.[1] || '';
  if (total > 0) rec({ model: m, other: total });
  else rec({ model: m, input: estimate(input), output: estimate(text), estimated: true });
}

function buildArgs(provider, model, sysFile) {
  const m = model ? ['-m', model] : [];
  if (provider === 'claude') {
    return ['-p', 'Follow the instructions given on stdin.', '--output-format', 'json', ...(model ? ['--model', model] : []),
      '--system-prompt-file', sysFile, '--disallowedTools', '*'];
  }
  if (provider === 'gpt') return ['exec', '--skip-git-repo-check', '-s', 'read-only', ...m, '-'];
  return ['-p', 'Follow the instructions given on stdin.', ...m];
}

function run({ provider, cmd, model, system, prompt, agentId }) {
  if (model && !SAFE_MODEL.test(model)) return Promise.reject(new Error(`Tên model "${model}" không hợp lệ.`));
  const executable = resolveCommand(cmd);
  if (!executable) return Promise.reject(new Error(`Không tìm thấy CLI "${cmd}" trong PATH của server.`));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-office-'));
  const sysFile = path.join(dir, 'system.txt');
  fs.writeFileSync(sysFile, system);
  // Claude nhận system prompt qua file; hai CLI còn lại không có cờ này nên ghép vào stdin.
  const stdin = provider === 'claude' ? prompt : `${system}\n\n${prompt}`;
  const args = buildArgs(provider, model, sysFile).map(quote);
  return new Promise((resolve, reject) => {
    const child = spawn(WIN ? quote(executable) : executable, args, { cwd: dir, shell: WIN, env: childEnv() });
    let out = '', err = '', done = false;
    const finish = (fn, v) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      fs.rmSync(dir, { recursive: true, force: true });
      fn(v);
    };
    const timer = setTimeout(() => { child.kill(); finish(reject, new Error(`${cmd} quá thời gian chờ ${TIMEOUT_MS / 1000}s.`)); }, TIMEOUT_MS);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => finish(reject, new Error(`Không chạy được "${cmd}": ${e.message}`)));
    child.on('close', (code) => {
      if (code === 0) {
        const rec = (u) => record({ provider, via: 'cli', agent: agentId, ...u });
        const text = provider === 'claude' ? claudeResult(out.trim(), rec) : out.trim();
        if (provider !== 'claude') otherUsage(provider, model, text, err, `${system}\n${prompt}`, rec);
        finish(resolve, text);
      }
      else {
        const detail = (err || out).replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '').trim();
        const tail = detail.length > 1400 ? `…${detail.slice(-1400)}` : detail;
        const authHint = /not logged in|unauthori[sz]ed|authentication required|login required|401/i.test(detail)
          ? ` Hãy chạy "${provider === 'claude' ? `${cmd} auth login` : `${cmd} login`}" trong terminal để xác thực lại.` : '';
        finish(reject, new Error(`${cmd} lỗi (mã ${code})${tail ? `: ${tail}` : '.'}${authHint}`));
      }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(stdin);
  });
}

// CLI không có function-calling kiểu API, nên dùng giao thức văn bản: trả một đối tượng JSON {"tool","args"} để gọi công cụ.
function toolGuide(tools) {
  const list = tools.map((t) => `- ${t.name}: ${t.description} Tham số: ${JSON.stringify(t.parameters.properties)}`).join('\n');
  return `\n\nBạn có thể dùng công cụ. Để gọi công cụ, chỉ trả lời đúng một đối tượng JSON dạng {"tool":"<tên>","args":{...}} và không viết gì khác. ` +
    `Sau đó bạn nhận kết quả và tiếp tục. Khi đã đủ thông tin, trả lời bình thường (không phải JSON công cụ).\nCông cụ:\n${list}`;
}

function parseToolCall(text, handlers) {
  const body = text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  try {
    const o = JSON.parse(body);
    if (o && typeof o.tool === 'string' && handlers[o.tool]) return { name: o.tool, args: o.args && typeof o.args === 'object' ? o.args : {} };
  } catch { /* không phải lời gọi công cụ */ }
  return null;
}

export async function cliComplete({ system, user, tools, handlers, ai }) {
  const sys = system + (tools.length ? toolGuide(tools) : '');
  let prompt = user;
  for (let i = 0; i < MAX_STEPS; i++) {
    // Lượt cuối: buộc trả lời bằng thông tin đã có (trước đây hết lượt công cụ chỉ trả "Không hoàn tất" dù đã tốn rất nhiều token).
    const last = i === MAX_STEPS - 1 && tools.length > 0;
    const out = await run({ provider: ai.provider, cmd: ai.cmd, model: ai.model, system: sys, prompt: last ? prompt + FINAL_NOTE : prompt, agentId: ai.agentId });
    const call = tools.length && !last ? parseToolCall(out, handlers) : null;
    if (last && parseToolCall(out, handlers)) return 'Không hoàn tất được sau nhiều bước: agent vẫn cố gọi công cụ ở lượt cuối.';
    if (!call) return out;
    const result = await handlers[call.name](call.args);
    prompt += `\n\n[Bạn đã gọi ${call.name} với ${JSON.stringify(call.args)}]\n[Kết quả] ${JSON.stringify(result)}\n\nTiếp tục.`;
  }
  return 'Không hoàn tất được sau nhiều bước.';
}
