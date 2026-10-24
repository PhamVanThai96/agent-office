import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Cầu nối tới các CLI đã đăng nhập sẵn trên máy (Claude Code, Codex, Gemini CLI).
// Prompt đi qua stdin; CLI chạy trong thư mục tạm rỗng để không tự đọc/sửa file của bạn.
// Mọi truy cập file của agent vẫn đi qua cơ chế xin quyền của ứng dụng.
const WIN = process.platform === 'win32';
const TIMEOUT_MS = 180000;
const MAX_STEPS = 6;
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

function buildArgs(provider, model, sysFile) {
  const m = model ? ['-m', model] : [];
  if (provider === 'claude') {
    return ['-p', 'Follow the instructions given on stdin.', ...(model ? ['--model', model] : []),
      '--system-prompt-file', sysFile, '--disallowedTools', '*'];
  }
  if (provider === 'gpt') return ['exec', '--skip-git-repo-check', '-s', 'read-only', ...m, '-'];
  return ['-p', 'Follow the instructions given on stdin.', ...m];
}

function run({ provider, cmd, model, system, prompt }) {
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
      if (code === 0) finish(resolve, out.trim());
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
    const out = await run({ provider: ai.provider, cmd: ai.cmd, model: ai.model, system: sys, prompt });
    const call = tools.length ? parseToolCall(out, handlers) : null;
    if (!call) return out;
    const result = await handlers[call.name](call.args);
    prompt += `\n\n[Bạn đã gọi ${call.name} với ${JSON.stringify(call.args)}]\n[Kết quả] ${JSON.stringify(result)}\n\nTiếp tục.`;
  }
  return 'Không hoàn tất được sau nhiều bước.';
}
